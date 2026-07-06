import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveIdleSleepMs,
  resolveOrchestratorConfig,
  type OrchestratorConfig,
} from './orchestrator'

const baseConfig: OrchestratorConfig = {
  enabled: true,
  minSleepMs: 15_000,
  maxSleepMs: 6 * 60 * 60 * 1_000,
  activePauseMs: 30_000,
  noAccountsSleepMs: 5 * 60 * 1_000,
  errorBackoffMs: 60_000,
  harvestPipelineMin: 40,
  inboundPollMs: 5 * 60 * 1_000,
}

describe('resolveIdleSleepMs', () => {
  it('sleeps the no-accounts fallback when nothing is usable (null)', () => {
    assert.equal(resolveIdleSleepMs(null, baseConfig), baseConfig.noAccountsSleepMs)
  })

  it('sleeps the minimum when an account is already available (0)', () => {
    assert.equal(resolveIdleSleepMs(0, baseConfig), baseConfig.minSleepMs)
  })

  it('sleeps until the next unblock, clamped to the minimum', () => {
    assert.equal(resolveIdleSleepMs(5_000, baseConfig), baseConfig.minSleepMs)
  })

  it('sleeps until the next unblock when within bounds', () => {
    assert.equal(resolveIdleSleepMs(90_000, baseConfig), 90_000)
  })

  it('caps very long cooldowns at maxSleepMs for periodic re-check', () => {
    const tenHours = 10 * 60 * 60 * 1_000
    assert.equal(resolveIdleSleepMs(tenHours, baseConfig), baseConfig.maxSleepMs)
  })
})

describe('resolveOrchestratorConfig', () => {
  it('is enabled by default', () => {
    assert.equal(resolveOrchestratorConfig({}).enabled, true)
  })

  it('can be disabled via ORCHESTRATOR_ENABLED=false', () => {
    assert.equal(resolveOrchestratorConfig({ ORCHESTRATOR_ENABLED: 'false' }).enabled, false)
  })

  it('reads overrides from the environment', () => {
    const config = resolveOrchestratorConfig({
      HARVEST_PIPELINE_MIN: '100',
      ORCHESTRATOR_MIN_SLEEP_MS: '5000',
    })
    assert.equal(config.harvestPipelineMin, 100)
    assert.equal(config.minSleepMs, 5_000)
  })

  it('falls back to defaults for invalid values', () => {
    const config = resolveOrchestratorConfig({ HARVEST_PIPELINE_MIN: 'abc' })
    assert.equal(config.harvestPipelineMin, 40)
  })

  it('defaults inbound poll cadence to 5 minutes', () => {
    assert.equal(resolveOrchestratorConfig({}).inboundPollMs, 5 * 60 * 1_000)
  })

  it('reads the inbound poll cadence override', () => {
    const config = resolveOrchestratorConfig({ ORCHESTRATOR_INBOUND_POLL_MS: '120000' })
    assert.equal(config.inboundPollMs, 120_000)
  })
})
