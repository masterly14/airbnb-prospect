import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStatus, type ProspectAccount } from '@repo/db'
import { buildProxyOption, shouldUseAccountProxy } from './playwright-context'

function makeAccount(): ProspectAccount {
  const now = new Date()
  return {
    id: 'acc-1',
    label: 'Test',
    airbnbEmail: 'test@example.com',
    composioUserId: null,
    composioConnectionId: null,
    composioConnectedAt: null,
    airbnbPasswordEnc: null,
    proxyHost: 'proxy.example.com',
    proxyPort: 8080,
    proxyUser: 'user',
    proxyPassEnc: 'enc',
    sessionPath: 'playwright/.auth/account-acc-1.json',
    market: 'Bogotá',
    messagesSentToday: 0,
    waveMessagesSent: 0,
    status: AccountStatus.ACTIVE,
    rateLimitedAt: null,
    cooldownUntil: null,
    lastWaveStartedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('playwright proxy policy', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    delete process.env.PLAYWRIGHT_USE_ACCOUNT_PROXY
  })

  afterEach(() => {
    process.env = { ...envBackup }
  })

  it('uses direct network by default even when account has proxy fields', () => {
    assert.equal(shouldUseAccountProxy(), false)
    assert.equal(buildProxyOption(makeAccount()), undefined)
  })

  it('enables account proxy only when PLAYWRIGHT_USE_ACCOUNT_PROXY=true', () => {
    process.env.PLAYWRIGHT_USE_ACCOUNT_PROXY = 'true'
    assert.equal(shouldUseAccountProxy(), true)
  })
})
