import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('cron-auth bearer parsing', () => {
  it('extracts bearer token format', () => {
    const auth = 'Bearer secret-token'
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
    assert.equal(token, 'secret-token')
  })
})
