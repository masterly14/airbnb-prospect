import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStatus, type ProspectAccount } from '@repo/db'
import {
  buildProxyOption,
  shouldBlockHeavyAssets,
  shouldBlockResource,
  shouldUseAccountProxy,
  shouldUseAccountProxyForJob,
} from './playwright-context'

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
    proxyProvider: 'decodo',
    proxySessionId: 'acct1',
    proxyCountry: 'co',
    sessionPath: 'playwright/.auth/account-acc-1.json',
    sessionStateEnc: null,
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
    delete process.env.OUTBOUND_USE_ACCOUNT_PROXY
    delete process.env.HARVEST_USE_ACCOUNT_PROXY
    delete process.env.INBOUND_USE_ACCOUNT_PROXY
    delete process.env.LOGIN_USE_ACCOUNT_PROXY
    delete process.env.SYNC_USE_ACCOUNT_PROXY
    delete process.env.PLAYWRIGHT_BLOCK_HEAVY_ASSETS
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

  it('outbound/login follow master flag; harvest/inbound/sync default to direct', () => {
    process.env.PLAYWRIGHT_USE_ACCOUNT_PROXY = 'true'
    assert.equal(shouldUseAccountProxyForJob('outbound'), true)
    assert.equal(shouldUseAccountProxyForJob('login'), true)
    assert.equal(shouldUseAccountProxyForJob('harvest'), false)
    assert.equal(shouldUseAccountProxyForJob('inbound'), false)
    assert.equal(shouldUseAccountProxyForJob('sync'), false)
  })

  it('allows per-job override over master flag', () => {
    process.env.PLAYWRIGHT_USE_ACCOUNT_PROXY = 'true'
    process.env.HARVEST_USE_ACCOUNT_PROXY = 'true'
    process.env.OUTBOUND_USE_ACCOUNT_PROXY = 'false'
    assert.equal(shouldUseAccountProxyForJob('harvest'), true)
    assert.equal(shouldUseAccountProxyForJob('outbound'), false)
  })

  it('buildProxyOption respects explicit useProxy even if master is off', () => {
    process.env.PLAYWRIGHT_USE_ACCOUNT_PROXY = 'false'
    const account = { ...makeAccount(), proxyPassEnc: null }
    const proxy = buildProxyOption(account, { useProxy: true })
    assert.ok(proxy)
    assert.equal(proxy!.server, 'http://proxy.example.com:8080')
    assert.equal(proxy!.username, 'user')
  })
})

describe('playwright bandwidth saver', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    delete process.env.PLAYWRIGHT_BLOCK_HEAVY_ASSETS
  })

  afterEach(() => {
    process.env = { ...envBackup }
  })

  it('blocks heavy assets by default', () => {
    assert.equal(shouldBlockHeavyAssets(), true)
  })

  it('can disable heavy asset blocking', () => {
    process.env.PLAYWRIGHT_BLOCK_HEAVY_ASSETS = 'false'
    assert.equal(shouldBlockHeavyAssets(), false)
  })

  it('blocks images, media, fonts and trackers', () => {
    assert.equal(shouldBlockResource('image', 'https://example.com/a.jpg'), true)
    assert.equal(shouldBlockResource('media', 'https://example.com/a.mp4'), true)
    assert.equal(shouldBlockResource('font', 'https://example.com/a.woff2'), true)
    assert.equal(
      shouldBlockResource('script', 'https://www.google-analytics.com/analytics.js'),
      true,
    )
    assert.equal(
      shouldBlockResource(
        'xhr',
        'https://a0.muscache.com/im/pictures/abc.jpg?im_w=720',
      ),
      true,
    )
  })

  it('allows document/xhr/script needed for scraping', () => {
    assert.equal(shouldBlockResource('document', 'https://www.airbnb.com.co/rooms/1'), false)
    assert.equal(
      shouldBlockResource('xhr', 'https://www.airbnb.com.co/api/v2/graphql'),
      false,
    )
    assert.equal(
      shouldBlockResource('script', 'https://www.airbnb.com.co/static/app.js'),
      false,
    )
  })
})
