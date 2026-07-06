import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createWorkerRequestListener, type WorkerJobResult } from './worker-http'

describe('worker-http', () => {
  const originalSecret = process.env.CRON_SECRET

  before(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  after(() => {
    process.env.CRON_SECRET = originalSecret
  })

  function request(
    server: http.Server,
    pathname: string,
    token?: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Server not listening'))
        return
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: pathname,
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 500,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          })
        },
      )

      req.on('error', reject)
      req.end()
    })
  }

  it('returns 401 without bearer token', async () => {
    const server = http.createServer(
      createWorkerRequestListener({
        harvest: async () => ({
          timestamp: new Date().toISOString(),
          markets: [],
          created: 0,
          updated: 0,
          unchanged: 0,
          skipped: 0,
          errors: 0,
          enriched: 0,
          enrichFailed: 0,
          blockedMarkets: [],
          leads: [],
        }),
        enrich: async () => ({
          timestamp: new Date().toISOString(),
          processed: 0,
          success: 0,
          failed: 0,
        }),
      }),
    )

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const response = await request(server, '/run/harvest')
    server.close()

    assert.equal(response.status, 401)
  })

  it('returns 409 when a Playwright job is already running', async () => {
    // harvest handler cuelga para mantener el worker ocupado durante el test.
    let releaseHarvest: (() => void) | undefined
    const harvestGate = new Promise<void>((resolve) => {
      releaseHarvest = resolve
    })

    const server = http.createServer(
      createWorkerRequestListener({
        harvest: async () => {
          await harvestGate
          return {
            timestamp: new Date().toISOString(),
            accountsUsed: [],
            rotations: 0,
            markets: [],
            created: 0,
            updated: 0,
            unchanged: 0,
            skipped: 0,
            errors: 0,
            enriched: 0,
            enrichFailed: 0,
            blockedMarkets: [],
            leads: [],
          }
        },
        enrich: async () => ({
          timestamp: new Date().toISOString(),
          processed: 0,
          success: 0,
          failed: 0,
        }),
      }),
    )

    await new Promise<void>((resolve) => server.listen(0, resolve))

    // Primera llamada: aceptada (202) y corriendo en background.
    const first = await request(server, '/run/harvest', 'test-secret')
    assert.equal(first.status, 202)
    assert.match(first.body, /accepted/)

    // Segunda llamada mientras la primera sigue: rechazada por ocupado (409).
    const second = await request(server, '/run/harvest', 'test-secret')
    assert.equal(second.status, 409)
    assert.match(second.body, /busy/i)

    releaseHarvest?.()
    server.close()
  })

  it('accepts enrich job (202) and runs it in background', async () => {
    let settled: WorkerJobResult | undefined
    let resolveSettled: (() => void) | undefined
    const done = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })

    const listener = createWorkerRequestListener(
      {
        harvest: async () => ({
          timestamp: new Date().toISOString(),
          accountsUsed: [],
          rotations: 0,
          markets: [],
          created: 0,
          updated: 0,
          unchanged: 0,
          skipped: 0,
          errors: 0,
          enriched: 0,
          enrichFailed: 0,
          blockedMarkets: [],
          leads: [],
        }),
        enrich: async () => ({
          timestamp: new Date().toISOString(),
          processed: 2,
          success: 2,
          failed: 0,
        }),
      },
      {
        onSettled: (result) => {
          settled = result
          resolveSettled?.()
        },
      },
    )

    const server = http.createServer(listener)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const response = await request(server, '/run/enrich', 'test-secret')

    assert.equal(response.status, 202)
    const body = JSON.parse(response.body) as { ok: boolean; status: string }
    assert.equal(body.ok, true)
    assert.equal(body.status, 'accepted')

    await done
    server.close()

    assert.ok(settled)
    assert.equal(settled?.ok, true)
    const summary = settled?.summary as { success: number }
    assert.equal(summary.success, 2)
  })
})
