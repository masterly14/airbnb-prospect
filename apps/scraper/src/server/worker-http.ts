import http from 'node:http'
import dotenv from 'dotenv'
import path from 'path'
import type { EnrichReport } from '../../scripts/enrich-leads'
import type { HarvestReport } from '../../scripts/harvest-run'
import {
  HarvestAuthMissingError,
  HarvestMutexBusyError,
  HarvestSearchBlockedError,
  HarvestSessionExpiredError,
} from '../harvest/errors'
import { sendAlert } from '../notifications/notify'

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

export type WorkerJob = 'harvest' | 'enrich' | 'outbound' | 'inbound' | 'account-reaper'

export type WorkerHandlers = {
  harvest: () => Promise<HarvestReport>
  enrich: () => Promise<EnrichReport>
  outbound?: () => Promise<unknown>
  inbound?: () => Promise<unknown>
  accountReaper?: () => Promise<unknown>
}

export type WorkerResponseBody = {
  ok: boolean
  job: WorkerJob
  durationMs: number
  summary?: unknown
  error?: string
}

function getBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith('Bearer ')) return null
  return authorization.slice(7).trim()
}

function isAuthorized(request: http.IncomingMessage): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  const bearer = getBearerToken(request.headers.authorization)
  return bearer === cronSecret
}

function mapJobPath(pathname: string): WorkerJob | null {
  switch (pathname) {
    case '/run/harvest':
      return 'harvest'
    case '/run/enrich':
      return 'enrich'
    case '/run/outbound':
      return 'outbound'
    case '/run/inbound':
      return 'inbound'
    case '/run/account-reaper':
      return 'account-reaper'
    default:
      return null
  }
}

function mapErrorStatus(error: unknown): number {
  if (error instanceof HarvestMutexBusyError) return 409
  if (error instanceof HarvestAuthMissingError) return 503
  if (error instanceof HarvestSessionExpiredError) return 503
  if (error instanceof HarvestSearchBlockedError) return 503
  return 500
}

async function maybeAlertOnError(job: WorkerJob, error: unknown): Promise<void> {
  // El mutex ocupado es transitorio: no alertar.
  if (error instanceof HarvestMutexBusyError) return

  if (error instanceof HarvestSearchBlockedError) {
    await sendAlert({
      kind: 'BLOCKED',
      title: `Airbnb bloqueó el job ${job} (${error.blocker}).`,
      details: { job },
    })
    return
  }

  if (
    error instanceof HarvestSessionExpiredError ||
    error instanceof HarvestAuthMissingError
  ) {
    await sendAlert({
      kind: 'SESSION_EXPIRED',
      title: `Sesión de Airbnb inválida en job ${job}. Ejecuta auth:login.`,
      details: { job },
    })
    return
  }

  await sendAlert({
    kind: 'AGENT_ERROR',
    title: `Job ${job} falló: ${error instanceof Error ? error.message : String(error)}`,
    details: { job },
  })
}

export function createWorkerRequestListener(handlers: WorkerHandlers) {
  return async (request: http.IncomingMessage, response: http.ServerResponse) => {
    if (request.method !== 'POST') {
      response.writeHead(405, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
      return
    }

    if (!isAuthorized(request)) {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: 'Unauthorized' }))
      return
    }

    const url = new URL(request.url ?? '/', 'http://localhost')
    const job = mapJobPath(url.pathname)
    if (!job) {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: 'Not found' }))
      return
    }

    const startedAt = Date.now()

    try {
      let summary: unknown

      switch (job) {
        case 'harvest':
          summary = await handlers.harvest()
          break
        case 'enrich':
          summary = await handlers.enrich()
          break
        case 'outbound':
          if (!handlers.outbound) throw new Error('Outbound handler not configured')
          summary = await handlers.outbound()
          break
        case 'inbound':
          if (!handlers.inbound) throw new Error('Inbound handler not configured')
          summary = await handlers.inbound()
          break
        case 'account-reaper':
          if (!handlers.accountReaper) throw new Error('Account reaper handler not configured')
          summary = await handlers.accountReaper()
          break
      }

      const body: WorkerResponseBody = {
        ok: true,
        job,
        durationMs: Date.now() - startedAt,
        summary,
      }

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    } catch (error) {
      const status = mapErrorStatus(error)
      const body: WorkerResponseBody = {
        ok: false,
        job,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }

      await maybeAlertOnError(job, error)

      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }
  }
}

export function startWorkerServer(
  handlers: WorkerHandlers,
  port = Number.parseInt(process.env.WORKER_PORT ?? '8080', 10),
): http.Server {
  const server = http.createServer((request, response) => {
    void createWorkerRequestListener(handlers)(request, response)
  })

  server.listen(port, () => {
    console.log(`Worker HTTP listening on port ${port}`)
  })

  return server
}

async function main() {
  const { runHarvest } = await import('../../scripts/harvest-run')
  const { runEnrichment } = await import('../../scripts/enrich-leads')
  const { runOutbound } = await import('../../scripts/outbound-run')
  const { runInbound } = await import('../../scripts/inbound-run')
  const { runAccountReaper } = await import('../../scripts/account-reaper')
  const { isMvpSingleAccountMode, mvpModeLogContext } = await import('../accounts/mvp-mode')

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'worker.start',
      port: Number.parseInt(process.env.WORKER_PORT ?? '8080', 10),
      ...mvpModeLogContext(),
    }),
  )

  if (isMvpSingleAccountMode()) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'worker.mvp_mode',
        message: 'Single-account MVP: rotation disabled; all jobs use MVP_ACCOUNT_ID',
      }),
    )
  }

  startWorkerServer({
    harvest: () => runHarvest({ writeReport: true }),
    enrich: () => runEnrichment(),
    outbound: () => runOutbound({ writeReport: true }),
    inbound: () => runInbound({ writeReport: true }),
    accountReaper: () => runAccountReaper(),
  })
}

if (require.main === module) {
  main().catch((error) => {
    console.error('worker-http failed:', error)
    process.exit(1)
  })
}
