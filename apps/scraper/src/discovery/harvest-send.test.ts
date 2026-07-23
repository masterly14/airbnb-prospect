import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getHarvestSendMax,
  isHarvestSendImmediateEnabled,
  isHarvestSendUntilBlocked,
} from './harvest-send'

describe('harvest send immediate policy', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    delete process.env.HARVEST_SEND_IMMEDIATE
    delete process.env.HARVEST_SEND_MAX
    delete process.env.HARVEST_SEND_UNTIL_BLOCKED
  })

  afterEach(() => {
    process.env = { ...envBackup }
  })

  it('is enabled by default (ICP → write immediately)', () => {
    assert.equal(isHarvestSendImmediateEnabled(), true)
  })

  it('can be disabled explicitly', () => {
    process.env.HARVEST_SEND_IMMEDIATE = 'false'
    assert.equal(isHarvestSendImmediateEnabled(), false)
  })

  it('caps sends per harvest run', () => {
    assert.equal(getHarvestSendMax(), 10)
    process.env.HARVEST_SEND_MAX = '2'
    assert.equal(getHarvestSendMax(), 2)
  })

  it('until-blocked raises the send safety cap', () => {
    assert.equal(isHarvestSendUntilBlocked(), false)
    process.env.HARVEST_SEND_UNTIL_BLOCKED = 'true'
    assert.equal(isHarvestSendUntilBlocked(), true)
    assert.equal(getHarvestSendMax(), 200)
    process.env.HARVEST_SEND_MAX = '80'
    assert.equal(getHarvestSendMax(), 80)
  })
})
