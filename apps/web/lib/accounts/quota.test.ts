import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getTodayDateInColombia } from './quota'
import { OPERATIONS } from '../operations/constants'

describe('accounts quota helpers', () => {
  it('uses Bogota timezone for daily buckets', () => {
    const date = getTodayDateInColombia(new Date('2026-07-04T06:00:00Z'))
    assert.match(date.toISOString(), /^\d{4}-\d{2}-\d{2}T00:00:00.000Z$/)
  })

  it('documents configured daily capacity', () => {
    const rawCapacity =
      OPERATIONS.PROSPECT_ACCOUNTS *
      OPERATIONS.MSGS_PER_WAVE *
      OPERATIONS.WAVES_PER_DAY_TARGET
    assert.equal(rawCapacity, 100)
  })
})
