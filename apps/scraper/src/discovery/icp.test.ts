import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateLeadIcp,
  hasExcludedBusinessKeywords,
  hasHomogeneousListingBranding,
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

  it('skips commercial operators with homogeneous listing branding (NJ Group / Movistar Arena)', () => {
    const njGroupTitles = [
      'Nuevo Apt, Central, Moderno, Movistar Arena.',
      'New Apt Moderno, Gran Ubicación Movistar Arena',
      'NUEVO y elegante, cerca de Movistar Arena',
      'New Apt, moderno Movistar Arena',
      'NUEVO APARTAMENTO junto a Movistar Arena',
      'New Apt a pasos de Movistar Arena',
    ]

    assert.equal(hasHomogeneousListingBranding(njGroupTitles), true)

    const result = evaluateLeadIcp({
      ...baseInput,
      totalProperties: 20,
      companyName: 'NJ Group',
      hostListingNames: njGroupTitles,
    })
    assert.equal(result.eligible, false)
    assert.equal(result.skipReason, 'hotel_loft')
  })

  it('accepts hosts with varied listing names', () => {
    const variedTitles = [
      'Apartamento en Chapinero con terraza',
      'Loft en Usaquén cerca del parque',
      'Estudio moderno en La Candelaria',
      'Casa campestre en Suba',
    ]

    assert.equal(hasHomogeneousListingBranding(variedTitles), false)
    const result = evaluateLeadIcp({
      ...baseInput,
      hostListingNames: variedTitles,
    })
    assert.equal(result.eligible, true)
  })

  it('does not flag homogeneous branding with fewer than 3 listings', () => {
    assert.equal(
      hasHomogeneousListingBranding([
        'New Apt Movistar Arena',
        'Nuevo Apt Movistar Arena',
      ]),
      false,
    )
  })
})

describe('textContainsExcludedKeyword', () => {
  it('detects hotel and loft industrial', () => {
    assert.equal(textContainsExcludedKeyword('Hotel boutique'), true)
    assert.equal(textContainsExcludedKeyword('Loft industrial en Laureles'), true)
    assert.equal(textContainsExcludedKeyword('Apartamento familiar'), false)
  })

  it('detects aparthotel and hostal variants', () => {
    assert.equal(textContainsExcludedKeyword('Aparta Hotel Norte'), true)
    assert.equal(textContainsExcludedKeyword('Aparthotel ejecutivo'), true)
    assert.equal(textContainsExcludedKeyword('Hostal La Candelaria'), true)
  })

  it('does not match hotel as a substring of another word', () => {
    assert.equal(textContainsExcludedKeyword('Apartamento en zona hotelera remodelado'), false)
  })

  it('does not exclude apartments that only reference a nearby hotel (landmark)', () => {
    assert.equal(
      textContainsExcludedKeyword('Apartamento cerca del Hotel Tequendama'),
      false,
    )
    assert.equal(
      textContainsExcludedKeyword('Moderno apto a pasos del Hotel Dann'),
      false,
    )
    assert.equal(
      textContainsExcludedKeyword('Cozy studio next to Hotel Marriott'),
      false,
    )
  })

  it('still excludes when the listing itself is the hotel despite a landmark elsewhere', () => {
    assert.equal(
      textContainsExcludedKeyword('Hotel boutique cerca del Parque Lleras'),
      true,
    )
  })

  it('does not exclude apartaestudio (valid property type)', () => {
    assert.equal(textContainsExcludedKeyword('Apartaestudio en Chapinero'), false)
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
