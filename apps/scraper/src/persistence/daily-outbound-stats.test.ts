import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getCityDailyQuota,
  getTodayDateInColombia,
} from './daily-outbound-stats'

describe('daily outbound stats', () => {
  it('resolves Colombia calendar date', () => {
    const date = getTodayDateInColombia(new Date('2026-07-05T06:00:00Z'))
    assert.equal(date.toISOString().slice(0, 10), '2026-07-05')
  })

  it('returns configured city quotas', () => {
    assert.equal(getCityDailyQuota('Bogotá'), 43)
    assert.equal(getCityDailyQuota('Medellín'), 43)
    assert.equal(getCityDailyQuota('Cali'), null)
  })
})
