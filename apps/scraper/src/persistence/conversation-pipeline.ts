import { db, LeadStatus, MessageDirection, type Lead } from '@repo/db'
import { includesCalLink } from '@repo/ai'
import { notifyHandoffEmail } from '../notifications/notify'

/**
 * Persistencia de las transiciones conversacionales (Triaje + Negociador).
 * Toda decisión de estado vive en código; estas funciones son los únicos
 * puntos que escriben el resultado de un turno en el CRM.
 */

const NON_TERMINAL_FOR_CLOSE: LeadStatus[] = [
  LeadStatus.REPLIED_IN_PROGRESS,
  LeadStatus.HUMAN_TAKEOVER,
]

/** Cierra el lead como perdido (rechazo explícito del host). */
export async function applyCloseLost(
  leadId: string,
  reason: string,
): Promise<Lead | null> {
  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) return null

  await db.message.create({
    data: {
      leadId,
      direction: MessageDirection.SYSTEM,
      content: `Triaje: cierre por rechazo — ${reason}`,
      aiIntent: 'CLOSE_LOST',
    },
  })

  return db.lead.update({
    where: { id: leadId },
    data: {
      status: LeadStatus.CLOSED_LOST,
      nextFollowUpAt: null,
    },
  })
}

/** Pasa el lead a intervención humana (kill switch o complejidad comercial). */
export async function applyHumanTakeover(
  leadId: string,
  reason: string,
): Promise<Lead | null> {
  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) return null

  if (lead.status === LeadStatus.HUMAN_TAKEOVER) {
    return lead
  }

  await db.message.create({
    data: {
      leadId,
      direction: MessageDirection.SYSTEM,
      content: `IA pausada — se requiere intervención humana: ${reason}`,
      aiIntent: 'HUMAN_TAKEOVER',
    },
  })

  const updated = await db.lead.update({
    where: { id: leadId },
    data: {
      status: LeadStatus.HUMAN_TAKEOVER,
      nextFollowUpAt: null,
    },
  })

  try {
    await notifyHandoffEmail(leadId, reason)
  } catch (error) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'handoff.resend_failed',
        leadId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  return updated
}

/**
 * Registra la respuesta del bot enviada por Airbnb e incrementa el contador
 * del kill switch. Marca `calLinkSent` si el mensaje incluyó el link.
 */
export async function recordBotReply(
  leadId: string,
  content: string,
  aiIntent: string,
  sentAt: Date = new Date(),
): Promise<Lead> {
  await db.message.create({
    data: {
      leadId,
      direction: MessageDirection.OUTBOUND,
      content,
      aiIntent,
    },
  })

  const data: {
    botReplyCount: { increment: number }
    lastContactedAt: Date
    calLinkSent?: boolean
  } = {
    botReplyCount: { increment: 1 },
    lastContactedAt: sentAt,
  }

  if (includesCalLink(content)) {
    data.calLinkSent = true
  }

  return db.lead.update({ where: { id: leadId }, data })
}

/**
 * Etiqueta el último mensaje INBOUND sin intención con el resultado del Triaje,
 * para visibilidad en el dashboard.
 */
export async function tagLatestInboundIntent(
  leadId: string,
  intent: string,
): Promise<void> {
  const latestInbound = await db.message.findFirst({
    where: { leadId, direction: MessageDirection.INBOUND },
    orderBy: { sentAt: 'desc' },
  })

  if (latestInbound && !latestInbound.aiIntent) {
    await db.message.update({
      where: { id: latestInbound.id },
      data: { aiIntent: intent },
    })
  }
}

export function isAiPausedStatus(status: LeadStatus): boolean {
  return (
    status === LeadStatus.HUMAN_TAKEOVER ||
    status === LeadStatus.CLOSED_WON ||
    status === LeadStatus.CLOSED_LOST
  )
}

export { NON_TERMINAL_FOR_CLOSE }
