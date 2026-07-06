import type { Page, Response } from 'playwright'
import { getAirbnbBaseUrl } from './airbnb-context'
import { dismissBlockingOverlays } from './airbnb-scraper'

export function parseHostAirbnbId(href: string): string | null {
  const match = href.match(/\/users\/show\/(\d+)/)
  return match?.[1] ?? null
}

export function normalizeProfileUrl(href: string): string {
  const base = getAirbnbBaseUrl()
  const absolute = href.startsWith('http') ? href : new URL(href, base).href
  return absolute.split('?')[0]
}

export type ScrapedHostIdentity = {
  hostAirbnbId: string
  name: string
  hostProfileUrl: string
}

const LISTING_COUNT_KEYS = [
  'listingCount',
  'activeListingCount',
  'totalListings',
  'listingsCount',
  'activeListingsCount',
]

export function extractListingCountFromPayload(payload: unknown): number | null {
  const queue: unknown[] = [payload]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    const record = current as Record<string, unknown>

    for (const key of LISTING_COUNT_KEYS) {
      const value = record[key]
      if (typeof value === 'number' && value > 0) return value
      if (typeof value === 'string' && /^\d+$/.test(value)) {
        const parsed = Number.parseInt(value, 10)
        if (parsed > 0) return parsed
      }
    }

    queue.push(...Object.values(record))
  }

  return null
}

const TOTAL_PROPERTIES_PATTERNS = [
  /(\d+)\s+(alojamientos|anuncios|listings|propiedades|listado[s]?|places|homes|hospedajes)/i,
  /administra\s+(\d+)/i,
  /manages?\s+(\d+)/i,
  /(\d+)\s+listing[s]?\s+managed/i,
  /superhost.*?(\d+)\s+(alojamientos|listings|propiedades)/i,
]

export function parseTotalPropertiesFromText(bodyText: string): number | null {
  for (const pattern of TOTAL_PROPERTIES_PATTERNS) {
    const match = bodyText.match(pattern)
    if (!match) continue
    const parsed = Number.parseInt(match[1], 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

export type PropertyCountConfidence = 'explicit' | 'inferred' | 'unknown'

export type PropertyCountResult = {
  totalProperties: number
  confidence: PropertyCountConfidence
}

export type PropertyCountCandidates = {
  graphql: number | null
  regex: number | null
  grid: number
}

export function resolveTotalProperties(
  candidates: PropertyCountCandidates,
): PropertyCountResult {
  const { graphql, regex, grid } = candidates

  if (graphql !== null || regex !== null) {
    const values = [graphql, regex, grid > 1 ? grid : null].filter(
      (value): value is number => value !== null && value > 0,
    )
    return {
      totalProperties: Math.max(...values),
      confidence: 'explicit',
    }
  }

  if (grid > 1) {
    return {
      totalProperties: grid,
      confidence: 'inferred',
    }
  }

  if (grid === 1) {
    return {
      totalProperties: 1,
      confidence: 'unknown',
    }
  }

  return {
    totalProperties: 0,
    confidence: 'unknown',
  }
}

function hostNameFromRecord(record: Record<string, unknown>): string | null {
  if (typeof record.firstName === 'string' && record.firstName.trim()) {
    const last =
      typeof record.lastName === 'string' ? ` ${record.lastName.trim()}` : ''
    return `${record.firstName.trim()}${last}`
  }
  if (typeof record.displayName === 'string' && record.displayName.trim()) {
    return record.displayName.trim()
  }
  if (typeof record.name === 'string' && record.name.trim()) {
    return record.name.trim()
  }
  return null
}

export function extractHostFromPayload(payload: unknown): ScrapedHostIdentity | null {
  const queue: unknown[] = [payload]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    const record = current as Record<string, unknown>
    const candidateIds = [
      record.hostUserId,
      record.hostId,
      record.userId,
      record.id,
    ].filter((value): value is string => typeof value === 'string' && /^\d{5,}$/.test(value))

    for (const hostAirbnbId of candidateIds) {
      const name = hostNameFromRecord(record)
      const typename = record.__typename
      const looksLikeUser =
        typename === 'User' ||
        typename === 'Host' ||
        record.hostUserId === hostAirbnbId ||
        record.isSuperhost !== undefined

      if (name && (looksLikeUser || record.hostUserId === hostAirbnbId)) {
        const base = getAirbnbBaseUrl()
        return {
          hostAirbnbId,
          name,
          hostProfileUrl: `${base}/users/show/${hostAirbnbId}`,
        }
      }
    }

    queue.push(...Object.values(record))
  }

  return null
}

function extractHostFromHtml(html: string): ScrapedHostIdentity | null {
  const profileMatch = html.match(/href="([^"]*\/users\/show\/(\d+)[^"]*)"/)
  if (profileMatch) {
    const hostAirbnbId = profileMatch[2]
    const nameMatch =
      html.match(/"firstName"\s*:\s*"([^"]+)"/) ??
      html.match(/"displayName"\s*:\s*"([^"]+)"/)
    return {
      hostAirbnbId,
      name: nameMatch?.[1]?.trim() ?? 'Unknown host',
      hostProfileUrl: normalizeProfileUrl(profileMatch[1]),
    }
  }

  const embeddedId =
    html.match(/"hostUserId"\s*:\s*"(\d+)"/) ??
    html.match(/"hostId"\s*:\s*"(\d+)"/)
  if (!embeddedId) return null

  const hostAirbnbId = embeddedId[1]
  const nameMatch =
    html.match(/"firstName"\s*:\s*"([^"]+)"/) ??
    html.match(/"displayName"\s*:\s*"([^"]+)"/)

  const base = getAirbnbBaseUrl()
  return {
    hostAirbnbId,
    name: nameMatch?.[1]?.trim() ?? 'Unknown host',
    hostProfileUrl: `${base}/users/show/${hostAirbnbId}`,
  }
}

async function readHostName(page: Page): Promise<string> {
  const name =
    (await page
      .locator(
        '[data-section-id="HOST_PROFILE_DEFAULT"] [data-testid="host-name"], [data-section-id="HOST_PROFILE_DEFAULT"] h2, [data-plugin-in-point-id="HOST_PROFILE_DEFAULT"] h2',
      )
      .first()
      .innerText({ timeout: 5_000 })
      .catch(() => null)) ?? 'Unknown host'

  return name.trim()
}

export async function scrapeHostFromListingDom(
  page: Page,
): Promise<ScrapedHostIdentity | null> {
  await page.waitForLoadState('domcontentloaded')
  await dismissBlockingOverlays(page)
  await page.mouse.wheel(0, 1_200)
  await page.waitForTimeout(1_500)

  const profileLink = page
    .locator('[data-section-id="HOST_PROFILE_DEFAULT"] a[href*="/users/show/"]')
    .first()
    .or(page.locator('a[href*="/users/show/"]').first())

  let href = await profileLink.getAttribute('href', { timeout: 8_000 }).catch(() => null)

  if (!href) {
    const html = await page.content()
    const fromHtml = extractHostFromHtml(html)
    if (fromHtml) return fromHtml
    return null
  }

  const hostAirbnbId = parseHostAirbnbId(href)
  if (!hostAirbnbId) return null

  return {
    hostAirbnbId,
    name: await readHostName(page),
    hostProfileUrl: normalizeProfileUrl(href),
  }
}

export async function extractHostFromListingPage(
  page: Page,
): Promise<ScrapedHostIdentity | null> {
  let captured: ScrapedHostIdentity | null = null

  const onResponse = async (response: Response) => {
    if (captured) return
    const url = response.url()
    if (!/(PdpListing|StaysPdp|pdp|Listing|graphql)/i.test(url)) return
    if (response.status() !== 200) return

    try {
      const json = await response.json()
      const host = extractHostFromPayload(json)
      if (host) captured = host
    } catch {
      // Non-JSON response
    }
  }

  page.on('response', onResponse)

  try {
    await page.waitForTimeout(3_000)

    if (captured) return captured

    const html = await page.content()
    const fromHtml = extractHostFromHtml(html)
    if (fromHtml) return fromHtml

    return scrapeHostFromListingDom(page)
  } finally {
    page.off('response', onResponse)
  }
}

export async function captureHostFromListingPage(
  page: Page,
  listingUrl: string,
): Promise<ScrapedHostIdentity | null> {
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded' })
  await dismissBlockingOverlays(page)
  return extractHostFromListingPage(page)
}

const SUPERHOST_PAYLOAD_KEYS = ['isSuperhost', 'isSuperHost', 'superhost'] as const

export function extractSuperhostFromPayload(payload: unknown): boolean | null {
  const queue: unknown[] = [payload]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    const record = current as Record<string, unknown>

    for (const key of SUPERHOST_PAYLOAD_KEYS) {
      const value = record[key]
      if (typeof value === 'boolean') return value
    }

    queue.push(...Object.values(record))
  }

  return null
}

export function parseSuperhostFromText(bodyText: string): boolean {
  return /super\s*host|superanfitri[oó]n/i.test(bodyText)
}

export type HostProfileStats = {
  totalProperties: number
  companyName?: string
  confidence: PropertyCountConfidence
  isSuperhost: boolean
}

async function collectUniqueRoomIds(page: Page): Promise<number> {
  const links = page.locator('a[href*="/rooms/"]')
  const count = await links.count()
  const seen = new Set<string>()

  for (let i = 0; i < count; i++) {
    const href = (await links.nth(i).getAttribute('href')) ?? ''
    const match = href.match(/\/rooms\/(\d+)/)
    if (match) seen.add(match[1])
  }

  return seen.size
}

async function countProfileListingCards(page: Page): Promise<number> {
  await page.mouse.wheel(0, 1_200)
  await page.waitForTimeout(800)
  const firstPass = await collectUniqueRoomIds(page)

  await page.mouse.wheel(0, 1_800)
  await page.waitForTimeout(800)
  const secondPass = await collectUniqueRoomIds(page)

  return Math.max(firstPass, secondPass)
}

export async function scrapeHostProfileStats(page: Page): Promise<HostProfileStats> {
  await page.waitForLoadState('domcontentloaded')
  await dismissBlockingOverlays(page)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(800)

  let graphqlCount: number | null = null
  let graphqlSuperhost: boolean | null = null

  const onResponse = async (response: Response) => {
    const url = response.url()
    if (!/(graphql|UserProfile|HostProfile|users\/show)/i.test(url)) return
    if (response.status() !== 200) return

    try {
      const json = await response.json()
      if (graphqlCount === null) {
        const count = extractListingCountFromPayload(json)
        if (count !== null) graphqlCount = count
      }
      if (graphqlSuperhost === null) {
        const superhost = extractSuperhostFromPayload(json)
        if (superhost !== null) graphqlSuperhost = superhost
      }
    } catch {
      // Non-JSON
    }
  }

  page.on('response', onResponse)

  try {
    await page.waitForTimeout(1_500)

    const bodyText = await page.locator('body').innerText()
    const regexCount = parseTotalPropertiesFromText(bodyText)
    const gridCount = await countProfileListingCards(page)
    const resolved = resolveTotalProperties({
      graphql: graphqlCount,
      regex: regexCount,
      grid: gridCount,
    })

    const companyMatch = bodyText.match(/(?:Empresa|Company|Agencia)[:\s]+([^\n]+)/i)
    const isSuperhost =
      graphqlSuperhost === true ||
      (graphqlSuperhost !== false && parseSuperhostFromText(bodyText))

    return {
      totalProperties: resolved.totalProperties,
      confidence: resolved.confidence,
      companyName: companyMatch?.[1]?.trim(),
      isSuperhost,
    }
  } finally {
    page.off('response', onResponse)
  }
}

export async function scrapeHostBio(page: Page): Promise<string | undefined> {
  const bioSection = page
    .locator(
      '[data-section-id="HOST_PROFILE_DEFAULT"], [data-plugin-in-point-id="HOST_PROFILE_DEFAULT"]',
    )
    .first()

  const text = await bioSection.innerText({ timeout: 5_000 }).catch(() => null)
  if (text && text.length > 20) {
    return text.slice(0, 800)
  }

  const bodyText = await page.locator('body').innerText()
  const aboutMatch = bodyText.match(/(?:Sobre|About)\s+\w+[^\n]*\n([\s\S]{20,500})/i)
  return aboutMatch?.[1]?.trim().slice(0, 800)
}

export const scrapeHostFromListing = scrapeHostFromListingDom
