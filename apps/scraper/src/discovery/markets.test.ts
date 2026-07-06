import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HARVEST_MARKETS, resolveHarvestMarkets } from './markets'

describe('resolveHarvestMarkets', () => {
  it('defaults to Bogotá and Medellín without Cartagena', () => {
    const previousMarket = process.env.HARVEST_MARKET
    const previousMarkets = process.env.HARVEST_MARKETS
    const previousOptional = process.env.ICP_INCLUDE_OPTIONAL_MARKETS

    delete process.env.HARVEST_MARKET
    delete process.env.HARVEST_MARKETS
    delete process.env.ICP_INCLUDE_OPTIONAL_MARKETS

    const markets = resolveHarvestMarkets()
    assert.deepEqual(
      markets.map((market) => market.name),
      ['Bogotá', 'Medellín'],
    )

    if (previousMarket) process.env.HARVEST_MARKET = previousMarket
    if (previousMarkets) process.env.HARVEST_MARKETS = previousMarkets
    if (previousOptional) process.env.ICP_INCLUDE_OPTIONAL_MARKETS = previousOptional
  })

  it('includes optional markets when flag is enabled', () => {
    const previousOptional = process.env.ICP_INCLUDE_OPTIONAL_MARKETS
    delete process.env.HARVEST_MARKET
    delete process.env.HARVEST_MARKETS
    process.env.ICP_INCLUDE_OPTIONAL_MARKETS = 'true'

    const markets = resolveHarvestMarkets()
    assert.deepEqual(markets.map((market) => market.name), [
      'Bogotá',
      'Medellín',
      'Cali',
      'Bucaramanga',
    ])

    if (previousOptional) {
      process.env.ICP_INCLUDE_OPTIONAL_MARKETS = previousOptional
    } else {
      delete process.env.ICP_INCLUDE_OPTIONAL_MARKETS
    }
  })

  it('keeps Cartagena available for explicit HARVEST_MARKETS override', () => {
    const previousMarkets = process.env.HARVEST_MARKETS
    process.env.HARVEST_MARKETS = 'Cartagena'

    const markets = resolveHarvestMarkets()
    assert.equal(markets.length, 1)
    assert.equal(markets[0]?.name, 'Cartagena')

    if (previousMarkets) {
      process.env.HARVEST_MARKETS = previousMarkets
    } else {
      delete process.env.HARVEST_MARKETS
    }
  })
})

describe('HARVEST_MARKETS', () => {
  it('defines Cali and Bucaramanga as opt-in markets', () => {
    const names = HARVEST_MARKETS.map((market) => market.name)
    assert.ok(names.includes('Cali'))
    assert.ok(names.includes('Bucaramanga'))
  })
})
