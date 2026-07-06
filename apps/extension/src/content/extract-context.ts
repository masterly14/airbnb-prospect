import {
  normalizeAirbnbUrl,
  parseHostAirbnbId,
  parseListingId,
  parseThreadId,
} from "@repo/airbnb-parse"

export type AirbnbPageType = "messages" | "listing" | "profile"

export type AirbnbPageContext = {
  pageType: AirbnbPageType
  sourceUrl: string
  lookupQueries: string[]
  name: string
  market?: string
  hostProfileUrl?: string
  primaryListingUrl?: string
  threadUrl?: string
  confidence: "high" | "medium" | "low"
}

const DEFAULT_HOST_NAME = "Anfitrión"

export function extractPageContext(documentRef: Document, locationRef: Location): AirbnbPageContext | null {
  const sourceUrl = normalizeAirbnbUrl(locationRef.href)
  const pathname = locationRef.pathname

  if (parseThreadId(pathname)) {
    return extractMessageContext(documentRef, sourceUrl)
  }

  if (parseListingId(pathname)) {
    return extractListingContext(documentRef, sourceUrl)
  }

  if (parseHostAirbnbId(pathname)) {
    return extractProfileContext(documentRef, sourceUrl)
  }

  return null
}

function extractMessageContext(documentRef: Document, sourceUrl: string): AirbnbPageContext {
  const name =
    pickText(documentRef, [
      '[data-testid*="thread"] h1',
      '[data-testid*="message"] h1',
      'main h1',
      'header h1',
      'h1',
    ]) ?? DEFAULT_HOST_NAME

  return {
    pageType: "messages",
    sourceUrl,
    lookupQueries: [sourceUrl],
    name,
    threadUrl: sourceUrl,
    confidence: name === DEFAULT_HOST_NAME ? "medium" : "high",
  }
}

function extractListingContext(documentRef: Document, sourceUrl: string): AirbnbPageContext {
  const hostProfileUrl = findAirbnbHref(documentRef, "/users/show/", new URL(sourceUrl).origin)
  const name = extractListingHostName(documentRef) ?? DEFAULT_HOST_NAME
  const market = extractListingMarket(documentRef)

  return {
    pageType: "listing",
    sourceUrl,
    lookupQueries: unique([sourceUrl, hostProfileUrl]),
    name,
    market,
    hostProfileUrl,
    primaryListingUrl: sourceUrl,
    confidence: hostProfileUrl && name !== DEFAULT_HOST_NAME ? "high" : "medium",
  }
}

function extractProfileContext(documentRef: Document, sourceUrl: string): AirbnbPageContext {
  const name =
    cleanHostName(
      pickText(documentRef, [
        '[data-testid*="profile"] h1',
        '[data-testid*="host"] h1',
        "main h1",
        "h1",
      ]),
    ) ?? DEFAULT_HOST_NAME

  return {
    pageType: "profile",
    sourceUrl,
    lookupQueries: [sourceUrl],
    name,
    hostProfileUrl: sourceUrl,
    confidence: name === DEFAULT_HOST_NAME ? "medium" : "high",
  }
}

function pickText(documentRef: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const element = documentRef.querySelector(selector)
    const text = cleanText(element?.textContent)
    if (text) return text
  }
  return null
}

function findAirbnbHref(documentRef: Document, pathFragment: string, baseUrl: string): string | undefined {
  const link = documentRef.querySelector<HTMLAnchorElement>(`a[href*="${pathFragment}"]`)
  const href = link?.getAttribute("href")
  return href ? normalizeAirbnbUrl(href, baseUrl) : undefined
}

const GENERIC_HOST_LABELS = [
  /^conoce al anfitri[oó]n$/i,
  /^conoce a(l)?\s+anfitri[oó]n$/i,
  /^meet the host$/i,
  /^anfitri[oó]n$/i,
  /^host$/i,
  /^hosted by$/i,
  /^ver perfil$/i,
  /^show profile$/i,
]

const HOST_LABEL_PATTERN = /anfitri[oó]n(?:a)?\s*[:.]?\s*(.+)/i

function extractListingHostName(documentRef: Document): string | null {
  const overview = documentRef.querySelector('[data-section-id="HOST_OVERVIEW_DEFAULT"]')
  if (overview) {
    for (const node of overview.querySelectorAll("*")) {
      if (node.children.length > 0) continue
      const text = cleanText(node.textContent)
      const labelled = text?.match(HOST_LABEL_PATTERN)?.[1]
      const name = cleanHostName(labelled ?? null)
      if (name) return name
    }
  }

  const meetHost = documentRef.querySelector('[data-section-id="MEET_YOUR_HOST"]')
  if (meetHost) {
    for (const node of meetHost.querySelectorAll("h1, h2, h3, div, span")) {
      if (node.children.length > 0) continue
      const name = cleanHostName(node.textContent)
      if (name) return name
    }
  }

  const hostLinks = [...documentRef.querySelectorAll<HTMLAnchorElement>('a[href*="/users/show/"]')]
  for (const link of hostLinks) {
    const name =
      cleanHostName(link.textContent) ??
      cleanHostName(link.getAttribute("aria-label")) ??
      cleanHostName(link.querySelector("img")?.getAttribute("alt") ?? null)
    if (name) return name
  }

  const sectionText = pickText(documentRef, [
    '[data-section-id*="HOST"] [data-testid*="name"]',
    '[data-testid*="host-profile"]',
    '[data-testid*="host"]',
  ])
  const cleanedSection = cleanHostName(sectionText)
  if (cleanedSection) return cleanedSection

  return null
}

function extractListingMarket(documentRef: Document): string | undefined {
  const subtitle = cleanText(
    documentRef.querySelector('[data-section-id="OVERVIEW_DEFAULT_V2"] h2')?.textContent,
  )
  const fromSubtitle = marketFromLocationText(subtitle)
  if (fromSubtitle) return fromSubtitle

  const locationText = pickText(documentRef, [
    'button[data-testid*="location"]',
    '[data-testid="listing-location"]',
    '[data-section-id="LOCATION_DEFAULT"] h2',
    '[data-section-id="LOCATION_DEFAULT"]',
  ])
  const fromLocation = marketFromLocationText(locationText) ?? normalizeMarket(locationText)
  if (fromLocation) return fromLocation

  const title = pickText(documentRef, ["h1"])
  const atCity = title?.match(/@\s*([A-Za-zÁÉÍÓÚáéíóúÑñ.\s]+)/)?.[1]?.trim()
  if (atCity) return normalizeMarket(atCity) ?? atCity

  return undefined
}

function marketFromLocationText(value: string | null): string | undefined {
  const text = cleanText(value)
  if (!text) return undefined
  const afterEn = text.match(/\ben\s+(.+)$/i)?.[1]
  const normalized = normalizeMarket(afterEn ?? null)
  return normalized ?? undefined
}

function normalizeMarket(value: string | null): string | null {
  const text = cleanText(value)
  if (!text) return null
  const city = text.split(",")[0]?.trim()
  return city || null
}

function cleanHostName(value: string | null): string | null {
  const text = cleanText(value)
  if (!text) return null

  const normalized = text
    .replace(/^hosted by\s+/i, "")
    .replace(/^anfitri[oó]n(?:a)?[:\s]+/i, "")
    .replace(/^conoce al?\s+/i, "")
    .replace(/^meet the host\s*/i, "")
    .trim()

  if (!normalized || GENERIC_HOST_LABELS.some((pattern) => pattern.test(normalized))) {
    return null
  }

  return normalized
}

function cleanText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim()
  return text || null
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter(Boolean) as string[])]
}
