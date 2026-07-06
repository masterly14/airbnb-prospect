import { ICP } from './icp'

export type HarvestMarket = {
  name: string
  slug: string
  placeId: string
}

export const HARVEST_MARKETS: HarvestMarket[] = [
  {
    name: 'Medellín',
    slug: 'Medellín--Antioquia',
    placeId: 'ChIJBa0PuN8oRI4RVju1x_x8E0I',
  },
  {
    name: 'Bogotá',
    slug: 'Bogotá--Colombia',
    placeId: 'ChIJW4W14q1aP44RQVz3aA6qPQw',
  },
  {
    name: 'Cali',
    slug: 'Cali--Valle-del-Cauca',
    placeId: 'ChIJ2-_J8Cw9QI4R2fRSlU0C7k0',
  },
  {
    name: 'Bucaramanga',
    slug: 'Bucaramanga--Santander',
    placeId: 'ChIJ7cD1r7Vxho8Rd2xIUFE5UHU',
  },
  {
    name: 'Cartagena',
    slug: 'Cartagena--Bolívar',
    placeId: 'ChIJo4F7rj8Zp44R6c9lQ1BqPj0',
  },
]

function defaultMarkets(): HarvestMarket[] {
  const defaultNames = [...ICP.MARKETS]
  if (process.env.ICP_INCLUDE_OPTIONAL_MARKETS === 'true') {
    defaultNames.push(...ICP.OPTIONAL_MARKETS)
  }

  return defaultNames
    .map((name) => HARVEST_MARKETS.find((market) => market.name === name))
    .filter((market): market is HarvestMarket => market !== undefined)
}

export function resolveHarvestMarkets(): HarvestMarket[] {
  const single = process.env.HARVEST_MARKET?.trim()
  if (single) {
    const found = HARVEST_MARKETS.find(
      (m) => m.name.toLowerCase() === single.toLowerCase() || m.slug === single,
    )
    if (found) return [found]
    throw new Error(
      `Unknown HARVEST_MARKET "${single}". Valid: ${HARVEST_MARKETS.map((m) => m.name).join(', ')}`,
    )
  }

  const list = process.env.HARVEST_MARKETS?.trim()
  if (list) {
    const names = list.split(',').map((s) => s.trim())
    const resolved = names.map((name) => {
      const found = HARVEST_MARKETS.find(
        (m) => m.name.toLowerCase() === name.toLowerCase() || m.slug === name,
      )
      if (!found) {
        throw new Error(`Unknown market in HARVEST_MARKETS: "${name}"`)
      }
      return found
    })
    return resolved
  }

  return defaultMarkets()
}
