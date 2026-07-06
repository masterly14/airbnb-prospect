import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectBlockersFromText } from './blockers'

describe('detectBlockersFromText', () => {
  it('detects captcha copy', () => {
    assert.equal(
      detectBlockersFromText('Please verify you are human to continue'),
      'captcha',
    )
  })

  it('detects network errors', () => {
    assert.equal(
      detectBlockersFromText('Something went wrong. Try again later.'),
      'network',
    )
  })

  it('returns ok for normal content', () => {
    assert.equal(
      detectBlockersFromText('Anfitrión con 5 alojamientos en Medellín'),
      'ok',
    )
  })
})
