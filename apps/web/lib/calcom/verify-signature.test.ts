import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyCalComSignature } from './verify-signature'

describe('verifyCalComSignature', () => {
  it('accepts valid HMAC signature', () => {
    const secret = 'test-secret'
    const rawBody = '{"triggerEvent":"BOOKING_CREATED"}'
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex')

    assert.equal(verifyCalComSignature(rawBody, signature, secret), true)
  })

  it('rejects invalid signature', () => {
    const secret = 'test-secret'
    const rawBody = '{"triggerEvent":"BOOKING_CREATED"}'

    assert.equal(verifyCalComSignature(rawBody, 'bad-signature', secret), false)
  })

  it('rejects when secret or header missing', () => {
    assert.equal(verifyCalComSignature('{}', null, 'secret'), false)
    assert.equal(verifyCalComSignature('{}', 'abc', undefined), false)
  })
})
