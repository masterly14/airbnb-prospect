export const ICP = {
  MIN_PROPERTIES: 10,
  MAX_PROPERTIES: 25,
  REQUIRE_SUPERHOST: true,
  MARKETS: ['Bogotá', 'Medellín'] as const,
  OPTIONAL_MARKETS: ['Cali', 'Bucaramanga'] as const,
  /**
   * Términos que identifican al alojamiento *en sí* como hotelero/no-ICP. Se
   * matchean por palabra completa (no substring) y con guard de cercanía: si el
   * término aparece como punto de referencia ("cerca del hotel X") NO excluye.
   */
  EXCLUDED_KEYWORDS: [
    'hotel',
    'hoteles',
    'hostel',
    'hostal',
    'aparta hotel',
    'apartahotel',
    'apart hotel',
    'aparthotel',
    'loft industrial',
    'resort',
    'motel',
  ] as const,
  /** Operadores comerciales que repiten el mismo branding en casi todos sus anuncios. */
  HOMOGENEOUS_BRANDING: {
    MIN_LISTINGS: 3,
    MAJORITY_RATIO: 0.6,
    MIN_PHRASE_WORDS: 2,
    MIN_PHRASE_CHARS: 6,
  } as const,
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
  /** Títulos de anuncios visibles en el perfil del host (muestra para branding homogéneo). */
  hostListingNames?: string[] | null
}

export type IcpEvaluation = {
  eligible: boolean
  skipReason?: IcpSkipReason
}

/**
 * ¿Exigir badge de Superhost en el ICP? Por decisión de negocio ya NO se exige
 * por defecto (dejaba fuera operadores de tamaño ideal 10-25 props sin badge).
 * Se puede reactivar con `ICP_REQUIRE_SUPERHOST=true`.
 */
export function requireSuperhost(): boolean {
  return process.env.ICP_REQUIRE_SUPERHOST === 'true'
}

export function resolveActiveMarkets(): readonly string[] {
  if (process.env.ICP_INCLUDE_OPTIONAL_MARKETS === 'true') {
    return [...ICP.MARKETS, ...ICP.OPTIONAL_MARKETS]
  }
  return ICP.MARKETS
}

/**
 * Frases que indican que el término hotelero es un *punto de referencia*
 * cercano, no la naturaleza del alojamiento. Ej: "Apartamento cerca del Hotel
 * Tequendama" es ICP válido; "Hotel Tequendama" no lo es.
 */
const LANDMARK_PROXIMITY_PREFIXES = [
  'cerca de',
  'cerca del',
  'cerca a',
  'cercano a',
  'cercano al',
  'junto a',
  'junto al',
  'al lado de',
  'al lado del',
  'frente a',
  'frente al',
  'a pasos de',
  'a pasos del',
  'a minutos de',
  'a minutos del',
  'vista a',
  'vista al',
  'near',
  'next to',
  'close to',
  'steps from',
  'beside',
  'across from',
]

/** Palabras hoteleras que suelen usarse como punto de referencia (landmark). */
const LANDMARK_PRONE_KEYWORDS = new Set(['hotel', 'hoteles', 'resort', 'motel'])

function normalizeForKeywordMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function keywordMatchesAsWord(text: string, keyword: string): RegExpMatchArray[] {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu')
  return [...text.matchAll(regex)]
}

function isLandmarkReference(text: string, matchIndex: number): boolean {
  const preceding = text.slice(Math.max(0, matchIndex - 24), matchIndex).trimEnd()
  return LANDMARK_PROXIMITY_PREFIXES.some((prefix) => preceding.endsWith(prefix))
}

export function textContainsExcludedKeyword(text: string): boolean {
  const normalized = normalizeForKeywordMatch(text)
  if (!normalized) return false

  for (const keyword of ICP.EXCLUDED_KEYWORDS) {
    const normalizedKeyword = normalizeForKeywordMatch(keyword)
    const matches = keywordMatchesAsWord(normalized, normalizedKeyword)
    if (matches.length === 0) continue

    // Palabras propensas a ser landmark sólo excluyen si al menos una aparición
    // NO es un punto de referencia. El resto de términos excluyen directo.
    if (!LANDMARK_PRONE_KEYWORDS.has(normalizedKeyword)) return true

    const hasNonLandmark = matches.some(
      (match) => !isLandmarkReference(normalized, match.index ?? 0),
    )
    if (hasNonLandmark) return true
  }

  return false
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

const PHRASE_STOPWORDS = new Set([
  'nuevo',
  'new',
  'nuev',
  'apt',
  'apartamento',
  'apartment',
  'moderno',
  'modern',
  'central',
  'gran',
  'great',
  'ubicacion',
  'ubicación',
  'location',
  'cerca',
  'near',
  'junto',
  'next',
  'pasos',
  'steps',
  'elegante',
  'elegant',
  'todo',
  'el',
  'la',
  'de',
  'en',
  'y',
  'a',
  'con',
  'para',
  'the',
  'and',
  'for',
  'top',
  'rated',
  'superhost',
  'habitacion',
  'habitación',
  'room',
  'lugar',
  'place',
  'entire',
  'completo',
  'comoda',
  'cómoda',
  'comfortable',
  'hermoso',
  'beautiful',
  'lindo',
  'nice',
])

function normalizeListingTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeTitle(title: string): string[] {
  return normalizeListingTitle(title)
    .split(' ')
    .filter((word) => word.length > 1)
}

function isSignificantPhrase(phrase: string): boolean {
  const words = phrase.split(' ').filter(Boolean)
  if (words.length < ICP.HOMOGENEOUS_BRANDING.MIN_PHRASE_WORDS) return false
  if (phrase.length < ICP.HOMOGENEOUS_BRANDING.MIN_PHRASE_CHARS) return false
  return words.some((word) => !PHRASE_STOPWORDS.has(word))
}

function extractCandidatePhrases(title: string): string[] {
  const words = tokenizeTitle(title)
  const phrases: string[] = []
  const maxN = Math.min(4, words.length)

  for (let n = ICP.HOMOGENEOUS_BRANDING.MIN_PHRASE_WORDS; n <= maxN; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(' ')
      if (isSignificantPhrase(phrase)) phrases.push(phrase)
    }
  }

  return phrases
}

/**
 * Detecta operadores tipo hotel/residencia: si la mayoría de anuncios del perfil
 * comparten la misma frase de branding (p. ej. "Movistar Arena" en NJ Group).
 */
export function hasHomogeneousListingBranding(listingNames: string[]): boolean {
  const titles = listingNames.map((name) => name.trim()).filter(Boolean)
  if (titles.length < ICP.HOMOGENEOUS_BRANDING.MIN_LISTINGS) return false

  const threshold = Math.ceil(titles.length * ICP.HOMOGENEOUS_BRANDING.MAJORITY_RATIO)
  const phraseHits = new Map<string, number>()

  for (const title of titles) {
    for (const phrase of new Set(extractCandidatePhrases(title))) {
      phraseHits.set(phrase, (phraseHits.get(phrase) ?? 0) + 1)
    }
  }

  for (const [phrase, hits] of phraseHits) {
    if (hits >= threshold) return true
  }

  return false
}

export function evaluateLeadIcp(input: LeadIcpInput): IcpEvaluation {
  if (input.totalProperties < ICP.MIN_PROPERTIES) {
    return { eligible: false, skipReason: 'below_min' }
  }

  if (input.totalProperties > ICP.MAX_PROPERTIES) {
    return { eligible: false, skipReason: 'above_max' }
  }

  if (requireSuperhost() && !input.isSuperhost) {
    return { eligible: false, skipReason: 'not_superhost' }
  }

  if (hasExcludedBusinessKeywords(input)) {
    return { eligible: false, skipReason: 'hotel_loft' }
  }

  if (input.hostListingNames && hasHomogeneousListingBranding(input.hostListingNames)) {
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
  hostListingNames?: string[] | null
}): boolean {
  if (lead.icpSkipReason) return false

  return evaluateLeadIcp({
    totalProperties: lead.totalProperties,
    isSuperhost: lead.isSuperhost,
    market: lead.market,
    primaryListingName: lead.primaryListingName,
    companyName: lead.companyName,
    hostListingNames: lead.hostListingNames,
  }).eligible
}
