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
  }: {
    slug?: string
    checkin: string
    checkout: string
    placeId?: string
  },
  baseUrl = getAirbnbBaseUrl(),
): string {
  const params = new URLSearchParams({
    checkin,
    checkout,
    refinement_paths: '/homes',
    place_id: placeId,
  })
  return `${baseUrl}/s/${encodeURIComponent(slug)}/homes?${params.toString()}`
}
