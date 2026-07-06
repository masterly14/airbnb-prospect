import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { HarvestMutexBusyError } from '../harvest/errors'
import { createWorkerRequestListener } from './worker-http'

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

  it('returns 409 when harvest mutex is busy', async () => {
    const server = http.createServer(
      createWorkerRequestListener({
        harvest: async () => {
          throw new HarvestMutexBusyError()
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
    const response = await request(server, '/run/harvest', 'test-secret')
    server.close()

    assert.equal(response.status, 409)
    assert.match(response.body, /mutex busy/i)
  })

  it('runs enrich job with valid auth', async () => {
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
          processed: 2,
          success: 2,
          failed: 0,
        }),
      }),
    )

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const response = await request(server, '/run/enrich', 'test-secret')
    server.close()

    assert.equal(response.status, 200)
    const body = JSON.parse(response.body) as { ok: boolean; summary: { success: number } }
    assert.equal(body.ok, true)
    assert.equal(body.summary.success, 2)
  })
})
