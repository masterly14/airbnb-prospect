import http from 'node:http'
import dotenv from 'dotenv'
import path from 'path'
import { runOrchestrator } from './orchestrator'
import { isMvpSingleAccountMode, mvpModeLogContext } from '../accounts/mvp-mode'

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

/**
 * Servidor HTTP mínimo: SOLO health checks para Railway/monitoring. No expone
 * triggers de jobs — el worker se auto-gobierna con el orquestador interno.
 */
export function createHealthServer(): http.Server {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          ok: true,
          service: 'scraper-worker',
          mode: isMvpSingleAccountMode() ? 'mvp-single-account' : 'multi-account',
          ts: new Date().toISOString(),
        }),
      )
      return
    }

    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ok: false, error: 'Not found' }))
  })
}

async function main() {
  const port = Number.parseInt(process.env.WORKER_PORT ?? '8080', 10)
  const controller = new AbortController()

  const server = createHealthServer()
  server.listen(port, () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'worker.start',
        port,
        ...mvpModeLogContext(),
      }),
    )
  })

  const shutdown = (sig: string) => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'worker.shutdown', sig }))
    controller.abort()
    server.close()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  await runOrchestrator(controller.signal)
}

if (require.main === module) {
  main().catch((error) => {
    console.error('worker-daemon failed:', error)
    process.exit(1)
  })
}
