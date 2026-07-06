import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateLeadIcp,
  hasExcludedBusinessKeywords,
  ICP,
  isLeadOutboundEligible,
  textContainsExcludedKeyword,
} from './icp'

describe('evaluateLeadIcp', () => {
  const baseInput = {
    totalProperties: 15,
    isSuperhost: true,
    market: 'Bogotá',
    primaryListingName: 'Apartamento en Chapinero',
    companyName: null,
    hostBioSnippet: null,
  }

  it('accepts 15 superhost properties in Bogotá', () => {
    const result = evaluateLeadIcp(baseInput)
    assert.equal(result.eligible, true)
    assert.equal(result.skipReason, undefined)
  })

  it('skips 9 properties as below_min', () => {
    const result = evaluateLeadIcp({ ...baseInput, totalProperties: 9 })
    assert.equal(result.eligible, false)
    assert.equal(result.skipReason, 'below_min')
  })

  it('skips 30 properties as above_max', () => {
    const result = evaluateLeadIcp({ ...baseInput, totalProperties: 30 })
    assert.equal(result.eligible, false)
    assert.equal(result.skipReason, 'above_max')
  })

  it('skips non-superhost when REQUIRE_SUPERHOST is true', () => {
    const result = evaluateLeadIcp({ ...baseInput, isSuperhost: false })
    assert.equal(result.eligible, false)
    assert.equal(result.skipReason, 'not_superhost')
  })

  it('skips hotel keywords in listing name', () => {
    const result = evaluateLeadIcp({
      ...baseInput,
      primaryListingName: 'Hotel XYZ Centro',
    })
    assert.equal(result.eligible, false)
    assert.equal(result.skipReason, 'hotel_loft')
  })

  it('skips excluded keywords in company name', () => {
    const result = evaluateLeadIcp({
      ...baseInput,
      companyName: 'Aparta Hotel Norte',
    })
    assert.equal(result.eligible, false)
    assert.equal(result.skipReason, 'hotel_loft')
  })

  it('skips wrong market when market is provided', () => {
    const result = evaluateLeadIcp({ ...baseInput, market: 'Cartagena' })
    assert.equal(result.eligible, false)
    assert.equal(result.skipReason, 'wrong_market')
  })

  it('accepts leads without market (market check skipped)', () => {
    const result = evaluateLeadIcp({ ...baseInput, market: null })
    assert.equal(result.eligible, true)
  })
})

describe('textContainsExcludedKeyword', () => {
  it('detects hotel and loft industrial', () => {
    assert.equal(textContainsExcludedKeyword('Hotel boutique'), true)
    assert.equal(textContainsExcludedKeyword('Loft industrial en Laureles'), true)
    assert.equal(textContainsExcludedKeyword('Apartamento familiar'), false)
  })
})

describe('hasExcludedBusinessKeywords', () => {
  it('checks listing, company and bio together', () => {
    assert.equal(
      hasExcludedBusinessKeywords({ hostBioSnippet: 'Operamos un resort en la costa' }),
      true,
    )
    assert.equal(
      hasExcludedBusinessKeywords({ primaryListingName: 'Casa campestre' }),
      false,
    )
  })
})

describe('isLeadOutboundEligible', () => {
  it('rejects leads with icpSkipReason set', () => {
    assert.equal(
      isLeadOutboundEligible({
        totalProperties: 15,
        isSuperhost: true,
        icpSkipReason: 'below_min',
      }),
      false,
    )
  })

  it('accepts in-range superhost leads', () => {
    assert.equal(
      isLeadOutboundEligible({
        totalProperties: ICP.MIN_PROPERTIES,
        isSuperhost: true,
        market: 'Medellín',
      }),
      true,
    )
  })
})
