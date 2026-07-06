import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractHostFromPayload,
  extractListingCountFromPayload,
  extractSuperhostFromPayload,
  parseSuperhostFromText,
  parseTotalPropertiesFromText,
  resolveTotalProperties,
} from './airbnb-host'

describe('parseTotalPropertiesFromText', () => {
  it('parses Spanish listing count', () => {
    const text = 'Juan administra 5 alojamientos en Medellín'
    assert.equal(parseTotalPropertiesFromText(text), 5)
  })

  it('parses administra pattern', () => {
    assert.equal(parseTotalPropertiesFromText('María administra 3 propiedades'), 3)
  })

  it('returns null when no match', () => {
    assert.equal(parseTotalPropertiesFromText('Sin información'), null)
  })
})

describe('resolveTotalProperties', () => {
  it('uses explicit graphql or regex values', () => {
    const result = resolveTotalProperties({ graphql: 4, regex: 3, grid: 1 })
    assert.equal(result.totalProperties, 4)
    assert.equal(result.confidence, 'explicit')
  })

  it('marks single grid card as unknown', () => {
    const result = resolveTotalProperties({ graphql: null, regex: null, grid: 1 })
    assert.equal(result.confidence, 'unknown')
    assert.equal(result.totalProperties, 1)
  })

  it('infers from multiple grid cards', () => {
    const result = resolveTotalProperties({ graphql: null, regex: null, grid: 3 })
    assert.equal(result.confidence, 'inferred')
    assert.equal(result.totalProperties, 3)
  })

  it('returns unknown when there are no signals', () => {
    const result = resolveTotalProperties({ graphql: null, regex: null, grid: 0 })
    assert.equal(result.confidence, 'unknown')
    assert.equal(result.totalProperties, 0)
  })
})
describe('extractListingCountFromPayload', () => {
  it('finds listingCount in nested JSON', () => {
    const payload = {
      data: {
        user: {
          listingCount: 8,
        },
      },
    }
    assert.equal(extractListingCountFromPayload(payload), 8)
  })

  it('finds activeListingCount', () => {
    const payload = { activeListingCount: '12' }
    assert.equal(extractListingCountFromPayload(payload), 12)
  })
})

describe('extractSuperhostFromPayload', () => {
  it('finds isSuperhost in nested JSON', () => {
    const payload = { data: { user: { isSuperhost: true } } }
    assert.equal(extractSuperhostFromPayload(payload), true)
  })

  it('returns null when superhost flag is absent', () => {
    assert.equal(extractSuperhostFromPayload({ user: { id: '1' } }), null)
  })
})

describe('parseSuperhostFromText', () => {
  it('detects superhost badges in Spanish and English', () => {
    assert.equal(parseSuperhostFromText('Ana es Superanfitriona desde 2020'), true)
    assert.equal(parseSuperhostFromText('Regular host profile'), false)
  })
})

describe('extractHostFromPayload', () => {
  it('extracts host from User typename', () => {
    const payload = {
      __typename: 'User',
      id: '12345678',
      firstName: 'Ana',
      lastName: 'García',
    }
    const host = extractHostFromPayload(payload)
    assert.ok(host)
    assert.equal(host.hostAirbnbId, '12345678')
    assert.equal(host.name, 'Ana García')
  })
})
