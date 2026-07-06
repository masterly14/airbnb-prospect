import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStatus, BlockType } from '@repo/db'
import {
  classifyBlockType,
  detectSendBlocker,
} from '../messaging/airbnb-messaging'
import {
  addHours,
  computeAccountStatusAfterBlock,
} from '../accounts/account-repository'
import { OPERATIONS } from '../discovery/icp'

describe('classifyBlockType', () => {
  it('maps Airbnb host-contact rate limit copy to RATE_LIMIT', () => {
    const message =
      'Airbnb rate limit: demasiados mensajes a anfitriones hoy. Espera unas horas e intenta de nuevo.'
    assert.equal(classifyBlockType(message), BlockType.RATE_LIMIT)
  })

  it('maps identity verification copy to IDENTITY', () => {
    const message = 'Airbnb requiere verificación de identidad antes de enviar mensajes.'
    assert.equal(classifyBlockType(message), BlockType.IDENTITY)
  })

  it('maps captcha copy to CAPTCHA', () => {
    assert.equal(classifyBlockType('Please complete the captcha challenge'), BlockType.CAPTCHA)
  })

  it('falls back to OTHER', () => {
    assert.equal(classifyBlockType('Unknown blocker'), BlockType.OTHER)
  })
})

describe('computeAccountStatusAfterBlock', () => {
  it('sets COOLDOWN with cooldownUntil for rate limits', () => {
    const from = new Date('2026-07-04T12:00:00Z')
    const next = computeAccountStatusAfterBlock(BlockType.RATE_LIMIT, from)

    assert.equal(next.status, AccountStatus.COOLDOWN)
    assert.equal(next.rateLimitedAt.toISOString(), from.toISOString())
    assert.equal(
      next.cooldownUntil?.toISOString(),
      addHours(from, OPERATIONS.COOLDOWN_HOURS).toISOString(),
    )
  })

  it('blocks identity verification without cooldown', () => {
    const from = new Date('2026-07-04T12:00:00Z')
    const next = computeAccountStatusAfterBlock(BlockType.IDENTITY, from)

    assert.equal(next.status, AccountStatus.BLOCKED)
    assert.equal(next.cooldownUntil, null)
  })
})

describe('detectSendBlocker contract', () => {
  it('exports detectSendBlocker for runtime probes', () => {
    assert.equal(typeof detectSendBlocker, 'function')
  })
})
