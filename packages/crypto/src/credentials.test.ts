import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { decryptSecret, encryptSecret } from './index'

describe('credentials encryption', () => {
  const previous = process.env.CREDENTIALS_ENCRYPTION_KEY

  before(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  })

  after(() => {
    if (previous) {
      process.env.CREDENTIALS_ENCRYPTION_KEY = previous
    } else {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY
    }
  })

  it('round-trips plaintext secrets', () => {
    const secret = 'airbnb-password-123!'
    const encrypted = encryptSecret(secret)
    assert.notEqual(encrypted, secret)
    assert.equal(decryptSecret(encrypted), secret)
  })
})
