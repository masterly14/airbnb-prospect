const DEFAULT_AIRBNB_BASE = "https://www.airbnb.com.co"

export function parseHostAirbnbId(value: string): string | null {
  const match = value.match(/\/users\/show\/(\d+)/i)
  return match?.[1] ?? null
}

export function parseListingId(value: string): string | null {
  const match = value.match(/\/rooms\/(\d+)/i)
  return match?.[1] ?? null
}

export function parseThreadId(value: string): string | null {
  const match = value.match(/\/guest\/messages\/(\d+)/i)
  return match?.[1] ?? null
}

export function normalizeAirbnbUrl(value: string, baseUrl = DEFAULT_AIRBNB_BASE): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const absolute = trimmed.startsWith("http") ? trimmed : new URL(trimmed, baseUrl).href
  return absolute.split(/[?#]/)[0] ?? absolute
}

export function slugifyHostName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

export type ParsedManualLeadRefs = {
  hostAirbnbId: string
  hostProfileUrl: string
  primaryListingUrl: string
  threadId: string | null
}

export function resolveManualLeadRefs(input: {
  name: string
  hostProfileUrl?: string
  primaryListingUrl?: string
  threadUrl?: string
  airbnbBaseUrl?: string
}): ParsedManualLeadRefs {
  const airbnbBaseUrl = input.airbnbBaseUrl ?? DEFAULT_AIRBNB_BASE
  const profileUrl = input.hostProfileUrl?.trim()
    ? normalizeAirbnbUrl(input.hostProfileUrl, airbnbBaseUrl)
    : null
  const listingUrl = input.primaryListingUrl?.trim()
    ? normalizeAirbnbUrl(input.primaryListingUrl, airbnbBaseUrl)
    : null
  const threadUrl = input.threadUrl?.trim()
    ? normalizeAirbnbUrl(input.threadUrl, airbnbBaseUrl)
    : null

  const hostFromProfile = profileUrl ? parseHostAirbnbId(profileUrl) : null
  const listingId = listingUrl ? parseListingId(listingUrl) : null
  const threadNumericId = threadUrl ? parseThreadId(threadUrl) : null

  let hostAirbnbId: string
  if (hostFromProfile) {
    hostAirbnbId = hostFromProfile
  } else if (listingId) {
    hostAirbnbId = `manual:listing-${listingId}`
  } else if (threadNumericId) {
    hostAirbnbId = `manual:thread-${threadNumericId}`
  } else {
    const slug = slugifyHostName(input.name)
    if (!slug) {
      throw new Error("El nombre del anfitrión es obligatorio.")
    }
    hostAirbnbId = `manual:name-${slug}`
  }

  const hostProfileUrl =
    profileUrl ??
    (hostFromProfile ? `${airbnbBaseUrl}/users/show/${hostFromProfile}` : listingUrl ?? threadUrl ?? "")

  const primaryListingUrl = listingUrl ?? profileUrl ?? threadUrl ?? hostProfileUrl

  return {
    hostAirbnbId,
    hostProfileUrl,
    primaryListingUrl,
    threadId: threadUrl,
  }
}

export type LeadLookupHints = {
  textQuery?: string
  hostAirbnbId?: string
  listingId?: string
  threadId?: string
  threadUrl?: string
  profileUrl?: string
  listingUrl?: string
}

export function parseLeadLookupQuery(raw: string): LeadLookupHints {
  const trimmed = raw.trim()
  if (!trimmed) return {}

  const hostAirbnbId = parseHostAirbnbId(trimmed)
  const listingId = parseListingId(trimmed)
  const threadNumericId = parseThreadId(trimmed)

  if (hostAirbnbId || listingId || threadNumericId) {
    return {
      hostAirbnbId: hostAirbnbId ?? undefined,
      listingId: listingId ?? undefined,
      threadId: threadNumericId ?? undefined,
      threadUrl: threadNumericId ? normalizeAirbnbUrl(trimmed) : undefined,
      profileUrl: hostAirbnbId ? normalizeAirbnbUrl(trimmed) : undefined,
      listingUrl: listingId ? normalizeAirbnbUrl(trimmed) : undefined,
    }
  }

  if (/^manual:/i.test(trimmed)) {
    return { hostAirbnbId: trimmed }
  }

  if (/^\d{6,}$/.test(trimmed)) {
    return { hostAirbnbId: trimmed, threadId: trimmed }
  }

  return { textQuery: trimmed }
}
