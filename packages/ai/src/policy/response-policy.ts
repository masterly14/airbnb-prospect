/**
 * Política de respuesta + sanitizador (Post-LLM, determinístico).
 *
 * La salida del LLM se trata como NO confiable hasta pasar por aquí
 * (Principio 5). Reglas del canal Airbnb:
 *  - Sin `https://` en links (Cal.com va como `cal.com/...`).
 *  - Sin markdown ni listas.
 *  - Máximo una pregunta.
 *  - El link de Cal.com solo se permite en el "momento debido".
 *  - Sin jerga interna, UUIDs ni nombres de estados del CRM.
 */

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

const INTERNAL_PHRASE_RES: RegExp[] = [
  /seg[uú]n mi prompt/gi,
  /system prompt/gi,
  /\bprompt\b/gi,
  /\bherramienta\b/gi,
  /lead status/gi,
  /botReplyCount/gi,
  /human[_\s]?takeover/gi,
  /closed[_\s]?(won|lost)/gi,
  /replied[_\s]?in[_\s]?progress/gi,
  /lead_discovered/gi,
  /\bleadId\b/gi,
  /\bthreadId\b/gi,
]

const CAL_LINK_RE = /cal\.com[^\s)]*/gi

export type PolicyOptions = {
  /** El "momento debido": si false, se elimina cualquier link de Cal.com. */
  allowCalLink: boolean
  /** Tope de longitud opcional (espejo de longitud). */
  maxChars?: number
}

export type PolicyResult = {
  text: string
  includesCalLink: boolean
  removedCalLink: boolean
  flags: string[]
}

/** Detecta si el texto contiene un link de Cal.com. */
export function includesCalLink(text: string): boolean {
  return /cal\.com/i.test(text)
}

/** Elimina el protocolo de cualquier URL (Airbnb no tolera https://). */
export function stripHttps(text: string): string {
  return text.replace(/https?:\/\//gi, '')
}

/** Elimina markdown básico y viñetas de lista. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-•]\s+/gm, '')
}

/** Sanitiza jerga interna, UUIDs y nombres de estados del CRM. Preserva URLs cal.com. */
export function sanitize(text: string): string {
  const preservedCal: string[] = []
  let out = text.replace(CAL_LINK_RE, (match) => {
    preservedCal.push(match)
    return `__CAL_PRESERVE_${preservedCal.length - 1}__`
  })

  out = out.replace(UUID_RE, '')
  for (const re of INTERNAL_PHRASE_RES) {
    out = out.replace(re, '')
  }
  out = out.replace(/__CAL_PRESERVE_(\d+)__/g, (_, idx) => preservedCal[Number(idx)] ?? '')

  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;!?])/g, '$1').trim()
}

function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace, so tokens
  // like "cal.com/agent-pilot" stay intact (no space after the internal dot).
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** ¿Pregunta al host? Ignora `?` dentro de URLs de Cal.com (p. ej. ?metadata=). */
function hasHostQuestion(sentence: string): boolean {
  const withoutCalUrls = sentence.replace(/cal\.com[^\s]*/gi, '')
  return withoutCalUrls.includes('?')
}

/** Conserva como máximo una pregunta (la primera). */
export function enforceSingleQuestion(text: string): string {
  const sentences = splitSentences(text)
  let questionSeen = false
  const kept: string[] = []
  for (const sentence of sentences) {
    if (hasHostQuestion(sentence)) {
      if (questionSeen) continue
      questionSeen = true
    }
    kept.push(sentence)
  }
  return kept.join(' ').trim()
}

/** Elimina las oraciones que contienen el link de Cal.com. */
export function removeCalLinkSentences(text: string): string {
  const sentences = splitSentences(text)
  const kept = sentences.filter((s) => !/cal\.com/i.test(s))
  return kept.join(' ').trim()
}

function mirrorLength(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const sentences = splitSentences(text)
  let acc = ''
  for (const sentence of sentences) {
    if ((acc + ' ' + sentence).trim().length > maxChars) break
    acc = (acc + ' ' + sentence).trim()
  }
  return acc || text.slice(0, maxChars).trim()
}

/**
 * Aplica la política completa sobre el borrador del LLM. Idempotente.
 */
export function applyPolicy(rawText: string, options: PolicyOptions): PolicyResult {
  const flags: string[] = []
  let text = (rawText ?? '').trim()

  const hadCalLink = includesCalLink(text)

  text = sanitize(text)
  text = stripMarkdown(text)
  text = stripHttps(text)

  let removedCalLink = false
  if (!options.allowCalLink && includesCalLink(text)) {
    text = removeCalLinkSentences(text)
    removedCalLink = true
    flags.push('cal_link_removed_not_due_moment')
  }

  const beforeQuestion = text
  text = enforceSingleQuestion(text)
  if (text !== beforeQuestion) flags.push('extra_questions_removed')

  if (options.maxChars && text.length > options.maxChars) {
    text = mirrorLength(text, options.maxChars)
    flags.push('length_mirrored')
  }

  text = text.replace(/\s{2,}/g, ' ').trim()

  if (hadCalLink && !includesCalLink(text) && options.allowCalLink) {
    flags.push('cal_link_lost_after_policy')
  }

  return {
    text,
    includesCalLink: includesCalLink(text),
    removedCalLink,
    flags,
  }
}
