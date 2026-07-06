import { db, type Lead } from '@repo/db'
import type {
  LeadAgentContext,
  LeadAgentMessage,
  LeadStatusValue,
} from '@repo/ai'
import { DEFAULT_CHANNEL_CONSTRAINTS } from '@repo/ai'

const DEFAULT_HISTORY_LIMIT = Number.parseInt(
  process.env.CONVERSATION_HISTORY_LIMIT ?? '20',
  10,
)

function toAgentMessages(
  rows: Array<{
    direction: string
    content: string
    aiIntent: string | null
    sentAt: Date
  }>,
): LeadAgentMessage[] {
  return rows.map((row) => ({
    direction: row.direction as LeadAgentMessage['direction'],
    content: row.content,
    aiIntent: row.aiIntent,
    sentAt: row.sentAt,
  }))
}

export function mapLeadToContext(
  lead: Lead,
  recentMessages: LeadAgentMessage[],
): LeadAgentContext {
  return {
    lead: {
      id: lead.id,
      hostAirbnbId: lead.hostAirbnbId,
      name: lead.name,
      hostProfileUrl: lead.hostProfileUrl,
      primaryListingUrl: lead.primaryListingUrl,
      primaryListingName: lead.primaryListingName,
      totalProperties: lead.totalProperties,
      companyName: lead.companyName,
      status: lead.status as LeadStatusValue,
      businessScale: lead.businessScale,
      painPoints: lead.painPoints,
      executiveSummary: lead.executiveSummary,
      threadId: lead.threadId,
      botReplyCount: lead.botReplyCount,
      calLinkSent: lead.calLinkSent,
      lastContactedAt: lead.lastContactedAt,
      nextFollowUpAt: lead.nextFollowUpAt,
    },
    recentMessages,
    channel: {
      name: 'airbnb',
      locale: 'es-CO',
      constraints: DEFAULT_CHANNEL_CONSTRAINTS,
    },
  }
}

/**
 * Carga el lead de Prisma + su contexto de agente. Devuelve ambos para que el
 * orquestador pueda reusar el `Lead` (p. ej. para enviar por Playwright) sin
 * volver a consultar la base de datos.
 */
export async function loadLeadConversation(
  leadId: string,
  maxMessages = DEFAULT_HISTORY_LIMIT,
): Promise<{ lead: Lead; context: LeadAgentContext } | null> {
  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) return null

  const rows = await db.message.findMany({
    where: { leadId },
    orderBy: { sentAt: 'desc' },
    take: maxMessages,
    select: { direction: true, content: true, aiIntent: true, sentAt: true },
  })

  // Recuperados en orden descendente; los devolvemos ascendente para el prompt.
  const recentMessages = toAgentMessages(rows.reverse())

  return { lead, context: mapLeadToContext(lead, recentMessages) }
}

/**
 * Hidrata solo el contexto del lead desde Prisma (datos del lead + últimos N
 * mensajes ordenados cronológicamente). El LLM no debe consultar estos datos
 * en caliente: se resuelven aquí antes de inferir.
 */
export async function hydrateLeadAgentContext(
  leadId: string,
  maxMessages = DEFAULT_HISTORY_LIMIT,
): Promise<LeadAgentContext | null> {
  const loaded = await loadLeadConversation(leadId, maxMessages)
  return loaded?.context ?? null
}
