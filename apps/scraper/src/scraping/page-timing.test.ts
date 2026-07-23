import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getActionTimeoutMs,
  getNavigationTimeoutMs,
  getSettleDelayMs,
} from '../scraping/page-timing'

describe('page-timing slow network', () => {
  const previous = process.env.PLAYWRIGHT_SLOW_NETWORK

  afterEach(() => {
    if (previous === undefined) delete process.env.PLAYWRIGHT_SLOW_NETWORK
    else process.env.PLAYWRIGHT_SLOW_NETWORK = previous
    delete process.env.PLAYWRIGHT_NAV_TIMEOUT_MS
    delete process.env.PLAYWRIGHT_ACTION_TIMEOUT_MS
    delete process.env.PLAYWRIGHT_SETTLE_DELAY_MS
  })

  it('doubles default timeouts when PLAYWRIGHT_SLOW_NETWORK=true', () => {
    process.env.PLAYWRIGHT_SLOW_NETWORK = 'true'
    assert.equal(getNavigationTimeoutMs(), 120_000)
    assert.equal(getActionTimeoutMs(), 90_000)
    assert.equal(getSettleDelayMs(), 5_000)
  })

  it('respects explicit env overrides', () => {
    process.env.PLAYWRIGHT_NAV_TIMEOUT_MS = '75000'
    assert.equal(getNavigationTimeoutMs(), 75_000)
  })
})
