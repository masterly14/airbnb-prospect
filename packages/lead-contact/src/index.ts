import {
  ContactSource,
  LeadStatus,
  MessageDirection,
  type Lead,
  type PrismaClient,
} from '@repo/db'
import { isClusterContacted, resolveLeadIdentityCluster } from './cluster'
import { resolveCanonicalHostIds } from './host-ids'
import {
  compareLeadStatus,
  CONTACTED_STATUSES,
  isLeadContacted,
  pickAdvancedStatus,
  STATUS_RANK,
} from './status'

export { ContactSource }
export { CONTACTED_STATUSES, STATUS_RANK, compareLeadStatus, isLeadContacted, pickAdvancedStatus }
export { resolveCanonicalHostIds }

export type ContactBlockReason =
  | 'status_not_discovered'
  | 'thread_exists'
  | 'outbound_message_exists'
  | 'host_contact_ledger'
  | 'cluster_already_contacted'
  | 'icp_ineligible'

export {
  type LeadIdentityCluster,
  type ClusterContactedResult,
  listingHostId,
  threadHostId,
  legacyThreadHostId,
  isLegacyManualThreadId,
  extractListingIdsFromText,
  collectListingIdsFromLead,
  collectThreadIdsFromLead,
  registerIdentityAlias,
  resolveLeadIdentityCluster,
  findLeadsByListingId,
  isClusterContacted,
} from './cluster'

export function evaluateContactBlock(input: {
  lead: Pick<Lead, 'status' | 'threadId'>
  hasOutboundMessage: boolean
  hasHostContact: boolean
}): ContactBlockReason | null {
  if (input.lead.status !== LeadStatus.LEAD_DISCOVERED) {
    return 'status_not_discovered'
  }
  if (input.lead.threadId) {
    return 'thread_exists'
  }
  if (input.hasOutboundMessage) {
    return 'outbound_message_exists'
  }
  if (input.hasHostContact) {
    return 'host_contact_ledger'
  }
  return null
}

export type AssertColdOutboundResult =
  | { allowed: true; lead: Lead }
  | { allowed: false; reason: ContactBlockReason; lead: Lead }

export async function assertColdOutboundAllowed(
  db: PrismaClient,
  leadId: string,
  options: { isIcpEligible?: (lead: Lead) => boolean } = {},
): Promise<AssertColdOutboundResult> {
  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) {
    throw new Error(`Lead not found: ${leadId}`)
  }

  if (options.isIcpEligible && !options.isIcpEligible(lead)) {
    return { allowed: false, reason: 'icp_ineligible', lead }
  }

  const [outboundCount, hostContact] = await Promise.all([
    db.message.count({
      where: { leadId, direction: MessageDirection.OUTBOUND },
    }),
    db.hostContact.findUnique({ where: { leadId } }),
  ])

  const reason = evaluateContactBlock({
    lead,
    hasOutboundMessage: outboundCount > 0,
    hasHostContact: hostContact != null,
  })

  if (reason) {
    return { allowed: false, reason, lead }
  }

  const cluster = await resolveLeadIdentityCluster(db, lead)
  const clusterStatus = await isClusterContacted(db, cluster)
  if (clusterStatus.contacted) {
    const canonicalLead =
      clusterStatus.canonicalLeadId != null
        ? await db.lead.findUnique({ where: { id: clusterStatus.canonicalLeadId } })
        : null
    return {
      allowed: false,
      reason: 'cluster_already_contacted',
      lead: canonicalLead ?? lead,
    }
  }

  return { allowed: true, lead }
}

export async function markHostContacted(
  db: PrismaClient,
  input: {
    lead: Pick<Lead, 'id' | 'hostAirbnbId'>
    source: ContactSource
    firstContactAccountId?: string | null
    firstContactedAt?: Date
  },
): Promise<void> {
  const firstContactedAt = input.firstContactedAt ?? new Date()

  await db.hostContact.upsert({
    where: { leadId: input.lead.id },
    create: {
      hostAirbnbId: input.lead.hostAirbnbId,
      leadId: input.lead.id,
      firstContactedAt,
      firstContactAccountId: input.firstContactAccountId ?? null,
      source: input.source,
    },
    update: {},
  })
}

export async function inferContactSourceFromLead(
  db: PrismaClient,
  leadId: string,
): Promise<ContactSource> {
  const systemMessage = await db.message.findFirst({
    where: {
      leadId,
      direction: MessageDirection.SYSTEM,
      aiIntent: { in: ['MANUAL_SYNC', 'MANUAL_REGISTER'] },
    },
    orderBy: { sentAt: 'asc' },
  })

  if (systemMessage?.aiIntent === 'MANUAL_SYNC') {
    return ContactSource.MANUAL_SYNC
  }
  if (systemMessage?.aiIntent === 'MANUAL_REGISTER') {
    return ContactSource.MANUAL_REGISTER
  }

  const outbound = await db.message.findFirst({
    where: { leadId, direction: MessageDirection.OUTBOUND },
    orderBy: { sentAt: 'asc' },
  })

  if (outbound) {
    return ContactSource.OUTBOUND
  }

  return ContactSource.BACKFILL
}
