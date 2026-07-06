export const ICP = {
  MIN_PROPERTIES: 10,
  MAX_PROPERTIES: 25,
  REQUIRE_SUPERHOST: true,
  MARKETS: ['Bogotá', 'Medellín'] as const,
  OPTIONAL_MARKETS: ['Cali', 'Bucaramanga'] as const,
  EXCLUDED_KEYWORDS: [
    'hotel',
    'hostel',
    'aparta hotel',
    'apartahotel',
    'loft industrial',
    'resort',
    'motel',
  ] as const,
} as const

export const OPERATIONS = {
  PROSPECT_ACCOUNTS: 5,
  MSGS_PER_WAVE: 10,
  WAVES_PER_DAY_TARGET: 2,
  COOLDOWN_HOURS: 5,
  CITY_DAILY_QUOTA: { Bogotá: 43, Medellín: 43 } as const,
} as const

export type IcpMarket = (typeof ICP.MARKETS)[number] | (typeof ICP.OPTIONAL_MARKETS)[number]

export type IcpSkipReason =
  | 'below_min'
  | 'above_max'
  | 'not_superhost'
  | 'hotel_loft'
  | 'wrong_market'

export type LeadIcpInput = {
  totalProperties: number
  isSuperhost: boolean
  market?: string | null
  primaryListingName?: string | null
  companyName?: string | null
  hostBioSnippet?: string | null
}

export type IcpEvaluation = {
  eligible: boolean
  skipReason?: IcpSkipReason
}

export function resolveActiveMarkets(): readonly string[] {
  if (process.env.ICP_INCLUDE_OPTIONAL_MARKETS === 'true') {
    return [...ICP.MARKETS, ...ICP.OPTIONAL_MARKETS]
  }
  return ICP.MARKETS
}

export function textContainsExcludedKeyword(text: string): boolean {
  const normalized = text.toLowerCase()
  return ICP.EXCLUDED_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))
}

export function hasExcludedBusinessKeywords(input: {
  primaryListingName?: string | null
  companyName?: string | null
  hostBioSnippet?: string | null
}): boolean {
  const combined = [input.primaryListingName, input.companyName, input.hostBioSnippet]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' ')

  if (!combined) return false
  return textContainsExcludedKeyword(combined)
}

export function evaluateLeadIcp(input: LeadIcpInput): IcpEvaluation {
  if (input.totalProperties < ICP.MIN_PROPERTIES) {
    return { eligible: false, skipReason: 'below_min' }
  }

  if (input.totalProperties > ICP.MAX_PROPERTIES) {
    return { eligible: false, skipReason: 'above_max' }
  }

  if (ICP.REQUIRE_SUPERHOST && !input.isSuperhost) {
    return { eligible: false, skipReason: 'not_superhost' }
  }

  if (hasExcludedBusinessKeywords(input)) {
    return { eligible: false, skipReason: 'hotel_loft' }
  }

  if (input.market) {
    const activeMarkets = resolveActiveMarkets()
    const normalizedMarket = input.market.trim()
    const allowed = activeMarkets.some(
      (market) => market.toLowerCase() === normalizedMarket.toLowerCase(),
    )
    if (!allowed) {
      return { eligible: false, skipReason: 'wrong_market' }
    }
  }

  return { eligible: true }
}

export function isLeadOutboundEligible(lead: {
  totalProperties: number
  isSuperhost: boolean
  market?: string | null
  primaryListingName?: string | null
  companyName?: string | null
  icpSkipReason?: string | null
}): boolean {
  if (lead.icpSkipReason) return false

  return evaluateLeadIcp({
    totalProperties: lead.totalProperties,
    isSuperhost: lead.isSuperhost,
    market: lead.market,
    primaryListingName: lead.primaryListingName,
    companyName: lead.companyName,
  }).eligible
}
