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

/** Anuncios por página del buscador de Airbnb (tamaño del cursor). */
export const SEARCH_PAGE_SIZE = 18

/**
 * Cursor de paginación de Airbnb: base64 de `{section_offset, items_offset,
 * version}`. La página N (1-based) usa `items_offset = SEARCH_PAGE_SIZE*(N-1)`.
 * Confirmado inspeccionando el `href` del control "Siguiente" en vivo.
 */
export function buildSearchCursor(page: number): string {
  const itemsOffset = SEARCH_PAGE_SIZE * Math.max(0, page - 1)
  const payload = JSON.stringify({
    section_offset: 0,
    items_offset: itemsOffset,
    version: 1,
  })
  return Buffer.from(payload, 'utf8').toString('base64')
}

export function buildSearchResultsUrl(
  {
    slug = MEDELLIN_SEARCH_SLUG,
    checkin,
    checkout,
    placeId = MEDELLIN_PLACE_ID,
    page = 1,
  }: {
    slug?: string
    checkin: string
    checkout: string
    placeId?: string
    /** Página numerada de resultados (1-based). Usa el cursor de Airbnb. */
    page?: number
  },
  baseUrl = getAirbnbBaseUrl(),
): string {
  const params = new URLSearchParams({
    checkin,
    checkout,
    refinement_paths: '/homes',
  })

  if (placeId) {
    params.set('place_id', placeId)
  }

  // Paginación profunda vía cursor (página > 1) para recorrer todo el inventario.
  if (page > 1) {
    params.set('cursor', buildSearchCursor(page))
    params.set('pagination_search', 'true')
  }

  return `${baseUrl}/s/${encodeURIComponent(slug)}/homes?${params.toString()}`
}
