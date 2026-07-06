import { db, LeadStatus, MessageDirection, type Lead } from '@repo/db'

export const INBOUND_POLL_STATUSES: LeadStatus[] = [
  LeadStatus.INITIAL_MSG_SENT,
  LeadStatus.FOLLOW_UP_1_SENT,
  LeadStatus.FOLLOW_UP_2_SENT,
  LeadStatus.FOLLOW_UP_3_SENT,
  LeadStatus.REPLIED_IN_PROGRESS,
]

export const OUTBOUND_ACTIVE_STATUSES: LeadStatus[] = [
  LeadStatus.INITIAL_MSG_SENT,
  LeadStatus.FOLLOW_UP_1_SENT,
  LeadStatus.FOLLOW_UP_2_SENT,
  LeadStatus.FOLLOW_UP_3_SENT,
]

export type ScrapedThreadMessage = {
  direction: 'INBOUND' | 'OUTBOUND'
  content: string
  sentAt?: Date
}

export type SyncThreadResult = {
  inboundNew: number
  outboundSynced: number
  hostReplied: boolean
}

export function normalizeMessageContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function messageContentKey(direction: MessageDirection, content: string): string {
  return `${direction}:${normalizeMessageContent(content)}`
}

export async function isDuplicateMessage(
  leadId: string,
  direction: MessageDirection,
  content: string,
): Promise<boolean> {
  const normalized = normalizeMessageContent(content)
  const existing = await db.message.findMany({
    where: {
      leadId,
      direction,
    },
    select: { content: true },
  })

  return existing.some((m) => normalizeMessageContent(m.content) === normalized)
}

export async function findLeadsForInboundPoll(
  limit: number,
  prospectAccountId?: string,
): Promise<Lead[]> {
  const batchSize =
    limit ?? Number.parseInt(process.env.INBOUND_BATCH_SIZE ?? '10', 10)

  return db.lead.findMany({
    where: {
      threadId: { not: null },
      status: { in: INBOUND_POLL_STATUSES },
      ...(prospectAccountId
        ? {
            OR: [
              { prospectAccountId },
              { hostContact: { firstContactAccountId: prospectAccountId } },
            ],
          }
        : {}),
    },
    take: batchSize,
    orderBy: { lastContactedAt: 'asc' },
  })
}

export async function recordInboundMessage(
  leadId: string,
  content: string,
  aiIntent?: string,
): Promise<void> {
  await db.message.create({
    data: {
      leadId,
      direction: MessageDirection.INBOUND,
      content,
      aiIntent,
    },
  })
}

export async function recordOutboundSyncMessage(
  leadId: string,
  content: string,
): Promise<boolean> {
  if (await isDuplicateMessage(leadId, MessageDirection.OUTBOUND, content)) {
    return false
  }

  await db.message.create({
    data: {
      leadId,
      direction: MessageDirection.OUTBOUND,
      content,
      aiIntent: 'THREAD_SYNC',
    },
  })
  return true
}

export async function applyInboundDetected(
  leadId: string,
  detectedAt: Date,
): Promise<Lead | null> {
  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) return null

  if (!OUTBOUND_ACTIVE_STATUSES.includes(lead.status)) {
    return lead
  }

  return db.lead.update({
    where: { id: leadId },
    data: {
      status: LeadStatus.REPLIED_IN_PROGRESS,
      nextFollowUpAt: null,
      lastContactedAt: detectedAt,
    },
  })
}

export async function syncThreadMessages(
  leadId: string,
  scraped: ScrapedThreadMessage[],
): Promise<SyncThreadResult> {
  let inboundNew = 0
  let outboundSynced = 0
  let hostReplied = false

  for (const msg of scraped) {
    const content = msg.content.trim()
    if (!content || content.length < 2) continue

    if (msg.direction === 'INBOUND') {
      if (await isDuplicateMessage(leadId, MessageDirection.INBOUND, content)) {
        continue
      }
      await recordInboundMessage(leadId, content)
      inboundNew++
      hostReplied = true
    } else {
      const created = await recordOutboundSyncMessage(leadId, content)
      if (created) outboundSynced++
    }
  }

  return { inboundNew, outboundSynced, hostReplied }
}

export async function updateLastContactedIfInbound(
  leadId: string,
  detectedAt: Date,
): Promise<void> {
  await db.lead.update({
    where: { id: leadId },
    data: { lastContactedAt: detectedAt },
  })
}
