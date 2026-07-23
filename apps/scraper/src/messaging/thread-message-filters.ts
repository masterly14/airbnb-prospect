/** Texto de UI/sistema de Airbnb que no es respuesta real del host. */
const AIRBNB_NOISE_PATTERNS: RegExp[] = [
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

  // Invitación / estado de reserva (muy común tras cold outreach)
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

  for (const pattern of AIRBNB_NOISE_PATTERNS) {
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

const SIMULATED_INTENTS = new Set(['SIMULATED_DRY_RUN', 'DRY_RUN'])

export function isSimulatedCrmMessage(message: {
  aiIntent?: string | null
}): boolean {
  return Boolean(message.aiIntent && SIMULATED_INTENTS.has(message.aiIntent))
}

export function filterMeaningfulThreadMessages<
  T extends { content: string; direction: string; aiIntent?: string | null },
>(messages: T[]): T[] {
  return messages.filter((m) => {
    if (isSimulatedCrmMessage(m)) return false
    const content = m.content.trim()
    if (!content) return false
    if (m.direction === 'OUTBOUND') return !isAirbnbThreadNoise(content)
    if (isAirbnbThreadNoise(content)) return false
    if (isOutboundTemplateEcho(content)) return false
    return true
  })
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

  // Si el preview termina en nuestro mensaje, no hay reply nuevo del host ahí.
  if (/\b(tú|tu|you)\s*:/i.test(normalized) && !/:/.test(normalized.split(/\b(tú|tu|you)\s*:/i)[0] ?? '')) {
    // still try host-named match below
  }

  const hostFirst = hostName.split(/[,\s]/)[0]?.trim()
  if (hostFirst) {
    const named = new RegExp(
      `${hostFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.+?)(?:\\s*[·•]|$)`,
      'i',
    )
    const match = normalized.match(named)
    if (match?.[1]) {
      const snippet = match[1].trim()
      if (snippet && !/^(tú|tu|you)\b/i.test(snippet) && !isAirbnbThreadNoise(snippet)) {
        return snippet
      }
    }
  }

  for (const match of normalized.matchAll(
    /\b([\p{L}][\p{L}\s'.-]{1,30})\s*:\s*([^·•]{1,160})/gu,
  )) {
    const speaker = match[1]?.trim() ?? ''
    const snippet = match[2]?.trim() ?? ''
    if (!speaker || !snippet) continue
    if (/^(tú|tu|you)$/i.test(speaker)) continue
    if (isAirbnbThreadNoise(snippet)) continue
    return snippet
  }

  return null
}
