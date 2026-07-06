import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { withRetry } from './retry'

describe('withRetry', () => {
  it('returns on first success', async () => {
    let calls = 0
    const value = await withRetry(
      async () => {
        calls++
        return 'ok'
      },
      { maxAttempts: 3, baseDelayMs: 1 },
    )

    assert.equal(value, 'ok')
    assert.equal(calls, 1)
  })

  it('retries transient errors', async () => {
    let calls = 0
    const value = await withRetry(
      async () => {
        calls++
        if (calls < 3) throw new Error('net::ERR_CONNECTION_RESET')
        return 'recovered'
      },
      { maxAttempts: 3, baseDelayMs: 1 },
    )

    assert.equal(value, 'recovered')
    assert.equal(calls, 3)
  })

  it('does not retry when retryOn returns false', async () => {
    let calls = 0

    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++
            throw new Error('page_blocked:captcha')
          },
          {
            maxAttempts: 3,
            baseDelayMs: 1,
            retryOn: (error) =>
              error instanceof Error && !error.message.startsWith('page_blocked:'),
          },
        ),
      /page_blocked:captcha/,
    )

    assert.equal(calls, 1)
  })
})
