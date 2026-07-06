/**
 * Contexto hidratado del lead para los agentes conversacionales (Triaje y
 * Negociador). El LLM NO debe adivinar estos datos: se resuelven antes de
 * inferir (Principio 1: hidratar antes de inferir).
 *
 * Este paquete no depende de @repo/db para mantenerse puro (igual que el
 * Perfilador). El worker del scraper mapea `Lead` de Prisma a este contrato.
 */

import { prefetchKnowledge } from '../knowledge/agent-pilot-kb.js'

export type LeadStatusValue =
  | 'LEAD_DISCOVERED'
  | 'INITIAL_MSG_SENT'
  | 'FOLLOW_UP_1_SENT'
  | 'FOLLOW_UP_2_SENT'
  | 'FOLLOW_UP_3_SENT'
  | 'REPLIED_IN_PROGRESS'
  | 'HUMAN_TAKEOVER'
  | 'CLOSED_WON'
  | 'CLOSED_LOST'

export type LeadAgentMessage = {
  direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM'
  content: string
  aiIntent?: string | null
  sentAt: Date
}

export type LeadAgentContext = {
  lead: {
    id: string
    hostAirbnbId: string
    name: string
    hostProfileUrl: string
    primaryListingUrl: string
    primaryListingName?: string | null
    totalProperties: number
    companyName?: string | null
    status: LeadStatusValue
    businessScale?: string | null
    painPoints?: string | null
    executiveSummary?: string | null
    threadId?: string | null
    botReplyCount: number
    calLinkSent: boolean
    lastContactedAt?: Date | null
    nextFollowUpAt?: Date | null
  }
  recentMessages: LeadAgentMessage[]
  channel: {
    name: 'airbnb'
    locale: 'es-CO'
    constraints: string[]
  }
}

export const DEFAULT_CHANNEL_CONSTRAINTS = [
  'Marketplace de Airbnb: sin markdown, sin listas, sin enlaces con https://.',
  'Mensajes breves, tono humano, máximo una pregunta o CTA.',
]

/** Límite de respuestas del bot tras enviar el link (kill switch). */
export function botReplyLimit(): number {
  const raw = process.env.CONVERSATION_BOT_REPLY_LIMIT
  const parsed = raw ? Number.parseInt(raw, 10) : 2
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2
}

export function firstName(ctx: LeadAgentContext): string {
  return ctx.lead.name.split(' ')[0] || ctx.lead.name
}

export function lastInboundMessage(ctx: LeadAgentContext): LeadAgentMessage | null {
  for (let i = ctx.recentMessages.length - 1; i >= 0; i--) {
    if (ctx.recentMessages[i].direction === 'INBOUND') return ctx.recentMessages[i]
  }
  return null
}

/**
 * Kill switch determinístico: tras enviar Cal.com, la IA puede responder como
 * máximo `botReplyLimit()` veces. Alcanzado el límite, no debe responder más.
 */
export function isKillSwitchTriggered(ctx: LeadAgentContext): boolean {
  return ctx.lead.calLinkSent && ctx.lead.botReplyCount >= botReplyLimit()
}

/** Bloque de datos operativos verbatim (Capa A5). */
export function formatLeadFacts(ctx: LeadAgentContext): string {
  const l = ctx.lead
  const lines = [
    `Nombre del host: ${l.name}`,
    `Propiedades administradas: ${l.totalProperties}`,
  ]
  if (l.companyName) lines.push(`Empresa/Agencia: ${l.companyName}`)
  if (l.primaryListingName) lines.push(`Anuncio de referencia: ${l.primaryListingName}`)
  if (l.businessScale) lines.push(`Escala de negocio: ${l.businessScale}`)
  if (l.painPoints) lines.push(`Dolores observados: ${l.painPoints}`)
  lines.push(`Ya se envió el link de Cal.com: ${l.calLinkSent ? 'sí' : 'no'}`)
  lines.push(`Respuestas previas del bot: ${l.botReplyCount}`)
  return `DATOS DEL LEAD (verdad, no inventar):\n${lines.join('\n')}`
}

/** Historial reciente como texto (Capa: historial). */
export function formatHistory(ctx: LeadAgentContext, maxTurns = 12): string {
  const recent = ctx.recentMessages.slice(-maxTurns)
  if (recent.length === 0) return 'HISTORIAL: (sin mensajes previos)'
  const labelFor = (d: LeadAgentMessage['direction']) =>
    d === 'INBOUND' ? 'Host' : d === 'OUTBOUND' ? 'Nosotros' : 'Sistema'
  const lines = recent
    .filter((m) => m.direction !== 'SYSTEM')
    .map((m) => `${labelFor(m.direction)}: ${m.content}`)
  return `HISTORIAL RECIENTE:\n${lines.join('\n')}`
}

export type TurnBriefing = {
  activeTopic: string | null
  knownFacts: string[]
  calLinkAlreadySent: boolean
  killSwitchImminent: boolean
  directives: string[]
}

/**
 * Briefing del turno (Capa B, heurístico sin LLM). Resume qué importa AHORA
 * para reducir alucinaciones y repreguntas.
 */
export function buildBriefing(ctx: LeadAgentContext): TurnBriefing {
  const lastInbound = lastInboundMessage(ctx)
  const topics = prefetchKnowledge(lastInbound?.content ?? '', 1)
  const limit = botReplyLimit()

  const knownFacts: string[] = [
    `El host administra ${ctx.lead.totalProperties} propiedades.`,
  ]
  if (ctx.lead.painPoints) knownFacts.push(`Dolores: ${ctx.lead.painPoints}`)
  if (ctx.lead.businessScale) knownFacts.push(`Escala: ${ctx.lead.businessScale}`)

  const directives: string[] = [
    'Responde la duda o el interés del host en una sola idea concreta.',
    'No repreguntes datos que ya conoces del lead.',
  ]

  const killSwitchImminent =
    ctx.lead.calLinkSent && ctx.lead.botReplyCount >= Math.max(0, limit - 1)

  if (ctx.lead.calLinkSent) {
    directives.push(
      'El link de Cal.com YA fue enviado: no lo repitas salvo que el host lo pida explícitamente.',
    )
  }
  if (killSwitchImminent) {
    directives.push(
      'Estás cerca del límite de respuestas: si el host no agenda, pasa a intervención humana.',
    )
  }

  return {
    activeTopic: topics[0]?.topic ?? null,
    knownFacts,
    calLinkAlreadySent: ctx.lead.calLinkSent,
    killSwitchImminent,
    directives,
  }
}

export function formatBriefing(briefing: TurnBriefing): string {
  const parts = [
    'LECTURA DEL TURNO (uso interno, no mostrar al host):',
    briefing.activeTopic ? `- Tema activo: ${briefing.activeTopic}` : '- Tema activo: general',
    `- Datos ya conocidos: ${briefing.knownFacts.join(' | ')}`,
    `- Link Cal.com ya enviado: ${briefing.calLinkAlreadySent ? 'sí' : 'no'}`,
    `- Directivas: ${briefing.directives.join(' ')}`,
  ]
  return parts.join('\n')
}
