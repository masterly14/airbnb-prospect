import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { isSyncEnrichmentEnabled } from './enrich-lead'

describe('isSyncEnrichmentEnabled', () => {
  const originalSync = process.env.HARVEST_ENRICH_SYNC
  const originalKey = process.env.DEEPSEEK_API_KEY

  beforeEach(() => {
    delete process.env.HARVEST_ENRICH_SYNC
    delete process.env.DEEPSEEK_API_KEY
  })

  afterEach(() => {
    if (originalSync === undefined) delete process.env.HARVEST_ENRICH_SYNC
    else process.env.HARVEST_ENRICH_SYNC = originalSync

    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  })

  it('is false by default', () => {
    assert.equal(isSyncEnrichmentEnabled(), false)
  })

  it('requires both flag and API key', () => {
    process.env.HARVEST_ENRICH_SYNC = 'true'
    assert.equal(isSyncEnrichmentEnabled(), false)

    process.env.DEEPSEEK_API_KEY = 'test-key'
    assert.equal(isSyncEnrichmentEnabled(), true)
  })
})
