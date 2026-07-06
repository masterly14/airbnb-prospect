import { db, MessageDirection } from '@repo/db'

export type HandoffLeadContext = {
  id: string
  name: string
  hostAirbnbId: string
  hostProfileUrl: string
  threadId: string | null
  totalProperties: number
  market: string | null
}

export type HandoffProspectAccount = {
  label: string
  airbnbEmail: string
}

export type HandoffContext = {
  lead: HandoffLeadContext
  lastInboundMessage: string | null
  prospectAccount: HandoffProspectAccount | null
  reason: string
}

const MAX_INBOUND_PREVIEW = 500

export function resolveDashboardLeadUrl(leadId: string): string {
  const base = (
    process.env.DASHBOARD_URL ??
    process.env.APP_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '')
  return `${base}/pipeline?leadId=${encodeURIComponent(leadId)}`
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}…`
}

export function buildHandoffEmail(context: HandoffContext): {
  subject: string
  text: string
} {
  const { lead, lastInboundMessage, prospectAccount, reason } = context
  const market = lead.market ?? 'sin mercado'
  const subject = `[Handoff] ${lead.name} — ${lead.totalProperties} props — ${market}`

  const accountLine = prospectAccount
    ? `${prospectAccount.label} (${prospectAccount.airbnbEmail})`
    : 'desconocida'

  const threadLine = lead.threadId ?? 'no disponible'
  const inboundLine = lastInboundMessage
    ? truncateText(lastInboundMessage, MAX_INBOUND_PREVIEW)
    : 'no disponible'

  const dashboardUrl = resolveDashboardLeadUrl(lead.id)

  const text = [
    'Handoff — requiere intervención humana',
    '',
    `Motivo: ${reason}`,
    '',
    '--- Lead ---',
    `Lead ID: ${lead.id}`,
    `Host Airbnb ID: ${lead.hostAirbnbId}`,
    `Perfil: ${lead.hostProfileUrl}`,
    `Thread: ${threadLine}`,
    `Propiedades: ${lead.totalProperties}`,
    `Mercado: ${market}`,
    '',
    '--- Último mensaje del host ---',
    inboundLine,
    '',
    '--- Cuenta de prospección ---',
    accountLine,
    '',
    '--- Dashboard ---',
    dashboardUrl,
  ].join('\n')

  return { subject, text }
}

export async function loadHandoffContext(
  leadId: string,
  reason: string,
): Promise<HandoffContext | null> {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      name: true,
      hostAirbnbId: true,
      hostProfileUrl: true,
      threadId: true,
      totalProperties: true,
      market: true,
    },
  })

  if (!lead) return null

  const lastInbound = await db.message.findFirst({
    where: { leadId, direction: MessageDirection.INBOUND },
    orderBy: { sentAt: 'desc' },
    select: { content: true },
  })

  const lastOutboundWithAccount = await db.message.findFirst({
    where: {
      leadId,
      direction: MessageDirection.OUTBOUND,
      prospectAccountId: { not: null },
    },
    orderBy: { sentAt: 'desc' },
    select: {
      prospectAccount: {
        select: { label: true, airbnbEmail: true },
      },
    },
  })

  return {
    lead,
    lastInboundMessage: lastInbound?.content ?? null,
    prospectAccount: lastOutboundWithAccount?.prospectAccount ?? null,
    reason,
  }
}
