import { getAirbnbBaseUrl } from '../scraping/airbnb-context'

export const MEDELLIN_PLACE_ID = 'ChIJBa0PuN8oRI4RVju1x_x8E0I'
export const MEDELLIN_SEARCH_SLUG = 'Medellín--Antioquia'

export type SearchDateRange = {
  checkin: string
  checkout: string
}

export type SearchWithDatesOptions = {
  destination?: string
  nights?: number
  timezone?: string
}

export type SearchWithDatesResult = SearchDateRange & {
  resultsUrl: string
}

const DEFAULT_TIMEZONE = 'America/Bogota'

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

function addDays(iso: string, days: number, timezone: string): string {
  const { year, month, day } = parseIsoDate(iso)
  const utc = Date.UTC(year, month - 1, day)
  const next = new Date(utc + days * 86_400_000)
  return next.toLocaleDateString('en-CA', { timeZone: timezone })
}

export function getSearchDates(
  nights = 7,
  timezone = DEFAULT_TIMEZONE,
): SearchDateRange {
  const checkin = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const checkout = addDays(checkin, nights, timezone)
  return { checkin, checkout }
}

export function buildSearchResultsUrl(
  {
    slug = MEDELLIN_SEARCH_SLUG,
    checkin,
    checkout,
    placeId = MEDELLIN_PLACE_ID,
    itemsOffset = 0,
    query,
  }: {
    slug?: string
    checkin: string
    checkout: string
    placeId?: string
    itemsOffset?: number
    /**
     * Búsqueda por texto libre (zona/barrio). Cuando se provee, Airbnb
     * geocodifica el texto y se omite `place_id` para no fijar la ciudad
     * completa.
     */
    query?: string
  },
  baseUrl = getAirbnbBaseUrl(),
): string {
  const params = new URLSearchParams({
    checkin,
    checkout,
    refinement_paths: '/homes',
  })

  if (query) {
    params.set('query', query)
  } else if (placeId) {
    params.set('place_id', placeId)
  }

  // Paginación profunda: avanzar el offset entre corridas para alcanzar
  // inventario nuevo en vez de re-prospectar los primeros resultados.
  if (itemsOffset > 0) {
    params.set('items_offset', String(itemsOffset))
    params.set('pagination_search', 'true')
  }

  const pathSlug = query ? query : slug
  return `${baseUrl}/s/${encodeURIComponent(pathSlug)}/homes?${params.toString()}`
}
