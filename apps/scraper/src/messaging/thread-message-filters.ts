/** Texto de UI/sistema de Airbnb que no es respuesta real del host. */
const AIRBNB_NOISE_PATTERNS: RegExp[] = [
  // Anclas de inicio (legado)
  /^consulta enviada\b/i,
  /^novedad de airbnb/i,
  /^se envi[oó] tu consulta/i,
  /^completa la reservaci[oó]n/i,
  /^reservar$/i,
  /^solicita\s+(reservar|una\s+reservaci[oó]n)/i,
  /^reserva\s+ahora/i,
  /^reserva\s+ahora\s+mismo/i,
  /^tiempo de respuesta/i,
  /^le[ií]do por\b/i,
  /^no le[ií]do$/i,
  /^traducci[oó]n activada$/i,
  /^consulta enviada$/i,
  /^\d+\s*[–-]\s*\d+\s*de\s+\w/i,
  /^[\d\s–-]+de\s+jul\b/i,
  /^[\d\s–-]+·\s*/i,
  /\bhu[eé]sped el \d/i,
  /^[\w\s,]+ y \d+ m[aá]s\.?$/i,
  /^invitaci[oó]n para reservar\b/i,
  /\bte invitamos a hacer una reservaci[oó]n\b/i,
  /\bel estado de la reservaci[oó]n\b/i,
  /^reserva una oferta especial\b/i,
  /\breservaci[oó]n pendiente\b/i,
  /\breservaci[oó]n del \d/i,
  /^t[uú]\s*:\s*consulta enviada\b/i,
  /\bconsulta enviada\b.*\breservaci[oó]n\b/i,
  /\binvitaci[oó]n para reservar\b.*\breservaci[oó]n\b/i,
  /^reservaci[oó]n$/i,
  /^enviando\.{0,3}$/i,
]

/**
 * Substrings de UI de reserva/estado. El DOM a menudo concatena sin espacios
 * (`Consulta enviadaLoft…`), así que NO basta con anclar al inicio.
 */
const AIRBNB_NOISE_CONTAINS: RegExp[] = [
  /consulta\s*enviada/i,
  /nueva\s+solicitud\s+de\s+reservaci/i,
  /estad[ií]a\s+en\s+curso/i,
  /reservaci[oó]n\s*pendiente/i,
  /completa\s+la\s+reservaci/i,
  /solicita\s+reservar/i,
  /el\s+anfitri[oó]n\s+dispone/i,
  /tienes\s+hasta\s+el\b/i,
  /muestra\s+(la\s+)?reservaci/i,
  /muestra\s+el\s+anuncio/i,
  /return\s+to\s+inbox/i,
  /tiempo\s+de\s+respuesta\s+t[ií]pico/i,
  /error\s+de\s+conexi[oó]n/i,
  /actualiza\s+la\s+p[aá]gina/i,
  /escribe\s+un\s+mensaje/i,
  /\bconfirmada\s*[·•]/i,
  /^confirmada\b/i,
  /se\s+envi[oó]\s+tu\s+consulta/i,
  /novedad\s+de\s+airbnb/i,
  /invitaci[oó]n\s+para\s+reservar/i,
  /te\s+invitamos\s+a\s+hacer\s+una\s+reservaci/i,
  /el\s+estado\s+de\s+la\s+reservaci/i,
  /reserva\s+una\s+oferta\s+especial/i,
  /hay\s+algo\s+que\s+no\s+est[aá]\s+bien/i,
]

function isNameListOnly(text: string): boolean {
  if (!/,/.test(text)) return false
  if (/[.!?¿]/.test(text)) return false
  if (/\b(hola|s[ií]|no|dale|ok|gracias|cu[eé]ntame|interesa|requerimos|funciona)\b/i.test(text)) {
    return false
  }
  const parts = text.split(/\s*,\s*/)
  return (
    parts.length >= 2 &&
    parts.every((part) => part.length > 0 && part.length <= 40 && /^[\p{L}\s'-]+$/u.test(part))
  )
}

/** Título/nombre de host sin frase conversacional (UI del hilo). */
function isHostLabelOnly(text: string): boolean {
  if (
    /\b(hola|buenas|buen\s+|s[ií]|no|dale|ok|gracias|cu[eé]ntame|interesa|info|precio|funciona|reuni[oó]n|ma[nñ]ana|claro|perfecto)\b/i.test(
      text,
    )
  ) {
    return false
  }
  if (/[.!?¿]/.test(text)) return false
  if (text.length > 70) return false
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 8) return false
  return /[-–—·]|manager|host|group|living|place|sas|coanfitri|anfitri/i.test(text)
}

/** Copia de mensajes outbound del bot que a veces se scrapean mal como INBOUND. */
const OUTBOUND_TEMPLATE_MARKERS =
  /\b(superanfitri[oó]n|property managers|libera m[aá]s de \d+ horas|hemos implementado)\b/i
const CURIOSITY_TEMPLATE_MARKERS =
  /\bexcelente,?\s*te\s+comento\b|\borquesta hu[eé]spedes, limpiezas, inventario\b/i

export function isOutboundTemplateEcho(text: string): boolean {
  const normalized = text.trim()
  return (
    OUTBOUND_TEMPLATE_MARKERS.test(normalized) ||
    CURIOSITY_TEMPLATE_MARKERS.test(normalized)
  )
}

export function isAirbnbThreadNoise(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length < 2) return true

  if (isOutboundTemplateEcho(normalized)) return true
  if (isNameListOnly(normalized)) return true
  if (isHostLabelOnly(normalized)) return true

  for (const pattern of AIRBNB_NOISE_PATTERNS) {
    if (pattern.test(normalized)) return true
  }
  for (const pattern of AIRBNB_NOISE_CONTAINS) {
    if (pattern.test(normalized)) return true
  }

  // Líneas muy cortas sin signos de frase (= UI, no conversación)
  if (normalized.length < 12 && !/[.!?¿]/.test(normalized) && !/\?/.test(normalized)) {
    const wordCount = normalized.split(/\s+/).length
    if (wordCount <= 4 && !/\b(hola|s[ií]|no|dale|ok|gracias|cu[eé]ntame)\b/i.test(normalized)) {
      return true
    }
  }

  return false
}

/**
 * Quita headers de burbuja Airbnb (`Name · Anfitrión16:27…`, `Leído por…`)
 * y devuelve solo el habla del host, o null si queda ruido/vacío.
 */
export function normalizeScrapedHostBubble(text: string): string | null {
  let t = text.trim().replace(/\s+/g, ' ')
  if (!t) return null

  // "Name · Anfitrión16:27" / "Name · Coanfitrión 16:28" (con o sin espacio)
  t = t.replace(
    /^[\p{L}\d\s.',&/\-]{1,90}·\s*(?:Co)?[Aa]nfitri[oó]n\s*\d{1,2}:\d{2}\s*/u,
    '',
  )
  t = t.replace(
    /^[\p{L}\d\s.',&/\-]{1,90}·\s*(?:Co)?[Aa]nfitri[oó]n\d{1,2}:\d{2}/u,
    '',
  )

  t = t.replace(/\s*Le[ií]do por\b.*$/i, '').trim()
  t = t.replace(/\s*Traducci[oó]n activada\b.*$/i, '').trim()
  t = t.replace(/\s*Tiempo de respuesta t[ií]pico:.*$/i, '').trim()

  if (!t || isAirbnbThreadNoise(t)) return null
  return t
}

const SIMULATED_INTENTS = new Set(['SIMULATED_DRY_RUN', 'DRY_RUN'])

export function isSimulatedCrmMessage(message: {
  aiIntent?: string | null
}): boolean {
  return Boolean(message.aiIntent && SIMULATED_INTENTS.has(message.aiIntent))
}

export function filterMeaningfulThreadMessages<
  T extends { content: string; direction: string; aiIntent?: string | null },
>(messages: T[]): T[] {
  const out: T[] = []
  for (const m of messages) {
    if (isSimulatedCrmMessage(m)) continue
    const content = m.content.trim()
    if (!content) continue

    if (m.direction === 'INBOUND') {
      const speech = normalizeScrapedHostBubble(content)
      if (!speech) continue
      out.push(speech === content ? m : { ...m, content: speech })
      continue
    }

    if (isAirbnbThreadNoise(content)) continue
    if (isOutboundTemplateEcho(content)) continue
    out.push(m)
  }
  return out
}

/**
 * Último inbound real del host.
 * Si hay outbound del bot después (p. ej. CURIOSITY_REPLY), igual se usa el
 * último inbound previo — la decisión de “ya respondimos” es aparte.
 */
export function lastMeaningfulInbound<
  T extends { content: string; direction: string; aiIntent?: string | null },
>(messages: T[]): T | null {
  const meaningful = filterMeaningfulThreadMessages(messages)
  for (let i = meaningful.length - 1; i >= 0; i--) {
    if (meaningful[i].direction === 'INBOUND') return meaningful[i]
  }
  return null
}

/**
 * Respuesta del host que debe gobernar el turno:
 * inbound posterior al cold outbound y anterior al CURIOSITY_REPLY (si existe).
 */
export function lastHostReplyForTurn<
  T extends { content: string; direction: string; aiIntent?: string | null },
>(messages: T[]): T | null {
  const meaningful = filterMeaningfulThreadMessages(messages)

  let coldIdx = -1
  let curiosityIdx = -1
  for (let i = 0; i < meaningful.length; i++) {
    const m = meaningful[i]
    if (m.direction !== 'OUTBOUND') continue
    if (m.aiIntent === 'PHASE_1_COLD' || m.aiIntent === 'THREAD_SYNC' || !m.aiIntent) {
      coldIdx = i
    }
    if (m.aiIntent === 'CURIOSITY_REPLY') {
      curiosityIdx = i
    }
  }

  const start = coldIdx
  const end = curiosityIdx === -1 ? meaningful.length : curiosityIdx
  for (let i = end - 1; i > start; i--) {
    if (meaningful[i].direction === 'INBOUND') return meaningful[i]
  }

  return lastMeaningfulInbound(meaningful)
}

/** Extrae el último snippet del host desde el preview del inbox (lista izquierda). */
export function extractHostReplyFromInboxPreview(
  rawText: string,
  hostName: string,
): string | null {
  const normalized = rawText.replace(/\s+/g, ' ').trim()
  if (!normalized) return null

  const fromBubble = normalizeScrapedHostBubble(normalized)
  if (fromBubble && fromBubble !== normalized) return fromBubble

  const hostFirst = hostName.split(/[,\s]/)[0]?.trim()
  if (hostFirst) {
    const named = new RegExp(
      `${hostFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.+?)(?:\\s*[·•]|$)`,
      'i',
    )
    const match = normalized.match(named)
    if (match?.[1]) {
      const snippet = normalizeScrapedHostBubble(match[1].trim())
      if (snippet && !/^(tú|tu|you)\b/i.test(snippet)) {
        return snippet
      }
    }
  }

  for (const match of normalized.matchAll(
    /\b([\p{L}][\p{L}\s'.-]{1,30})\s*:\s*([^·•]{1,160})/gu,
  )) {
    const speaker = match[1]?.trim() ?? ''
    const snippetRaw = match[2]?.trim() ?? ''
    if (!speaker || !snippetRaw) continue
    if (/^(tú|tu|you)$/i.test(speaker)) continue
    const snippet = normalizeScrapedHostBubble(snippetRaw)
    if (!snippet) continue
    return snippet
  }

  return normalizeScrapedHostBubble(normalized)
}
