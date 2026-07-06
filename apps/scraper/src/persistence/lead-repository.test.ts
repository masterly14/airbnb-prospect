import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseHarvestContext,
  serializeHarvestContext,
  HARVEST_CONTEXT_PREFIX,
} from '../persistence/lead-repository'

describe('harvest context serialization', () => {
  it('round-trips harvest context', () => {
    const context = {
      listingDescription: 'Hermoso apartamento',
      listingAmenities: ['Wifi', 'Cocina'],
      reviewSnippets: ['Excelente lugar'],
    }

    const serialized = serializeHarvestContext(context)
    assert.ok(serialized.startsWith(HARVEST_CONTEXT_PREFIX))

    const parsed = parseHarvestContext(serialized)
    assert.deepEqual(parsed, context)
  })

  it('returns null for invalid content', () => {
    assert.equal(parseHarvestContext('invalid'), null)
  })
})
