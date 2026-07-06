import { parseListingId, parseThreadId } from '@repo/airbnb-parse'
import {
  LeadStatus,
  MessageDirection,
  type Lead,
  type PrismaClient,
} from '@repo/db'
import { resolveCanonicalHostIds } from './host-ids'
import { isLeadContacted, pickAdvancedStatus } from './status'

export type LeadIdentityCluster = {
  seedLeadId: string
  leadIds: string[]
  hostAirbnbIds: string[]
  listingIds: string[]
  threadIds: string[]
}

export type ClusterContactedResult = {
  contacted: boolean
  reason?: 'status_not_discovered' | 'thread_exists' | 'host_contact_ledger' | 'outbound_message_exists'
  canonicalLeadId?: string
}

export function listingHostId(listingId: string): string {
  return `manual:listing-${listingId}`
}

export function threadHostId(threadId: string): string {
  return `manual:thread-${threadId}`
}

/** Legacy sync format: manual:{numericThreadId} without thread- prefix. */
export function legacyThreadHostId(threadId: string): string {
  return `manual:${threadId}`
}

export function isLegacyManualThreadId(hostAirbnbId: string): boolean {
  return /^manual:\d+$/.test(hostAirbnbId)
}

export function extractListingIdsFromText(text: string): string[] {
  const ids = new Set<string>()
  for (const match of text.matchAll(/\/(?:rooms|contact_host)\/(\d+)/g)) {
    if (match[1]) ids.add(match[1])
  }
  return [...ids]
}

export function collectListingIdsFromLead(lead: Pick<Lead, 'hostAirbnbId' | 'primaryListingUrl'>): string[] {
  const ids = new Set<string>()
  const fromUrl = parseListingId(lead.primaryListingUrl)
  if (fromUrl) ids.add(fromUrl)
  const listingMatch = lead.hostAirbnbId.match(/^manual:listing-(\d+)$/)
  if (listingMatch?.[1]) ids.add(listingMatch[1])
  return [...ids]
}

export function collectThreadIdsFromLead(
  lead: Pick<Lead, 'hostAirbnbId' | 'threadId'>,
): string[] {
  const ids = new Set<string>()
  const fromUrl = lead.threadId ? parseThreadId(lead.threadId) : null
  if (fromUrl) ids.add(fromUrl)
  const threadMatch = lead.hostAirbnbId.match(/^manual:thread-(\d+)$/)
  if (threadMatch?.[1]) ids.add(threadMatch[1])
  if (isLegacyManualThreadId(lead.hostAirbnbId)) {
    ids.add(lead.hostAirbnbId.slice('manual:'.length))
  }
  return [...ids]
}

export async function registerIdentityAlias(
  db: PrismaClient,
  input: { aliasId: string; canonicalId: string; leadId?: string | null },
): Promise<void> {
  if (input.aliasId === input.canonicalId) return

  await db.leadIdentityAlias.upsert({
    where: { aliasId: input.aliasId },
    create: {
      aliasId: input.aliasId,
      canonicalId: input.canonicalId,
      leadId: input.leadId ?? null,
    },
    update: {
      canonicalId: input.canonicalId,
      leadId: input.leadId ?? null,
    },
  })
}

export async function resolveLeadIdentityCluster(
  db: PrismaClient,
  lead: Pick<Lead, 'id' | 'hostAirbnbId' | 'primaryListingUrl' | 'threadId'>,
): Promise<LeadIdentityCluster> {
  const hostAirbnbIds = new Set<string>([lead.hostAirbnbId])
  const listingIds = new Set(collectListingIdsFromLead(lead))
  const threadIds = new Set(collectThreadIdsFromLead(lead))
  const leadIds = new Set<string>([lead.id])

  for (const listingId of listingIds) {
    hostAirbnbIds.add(listingHostId(listingId))
  }
  for (const threadId of threadIds) {
    hostAirbnbIds.add(threadHostId(threadId))
    hostAirbnbIds.add(legacyThreadHostId(threadId))
  }

  const expandedHostIds = new Set<string>()
  for (const hostId of hostAirbnbIds) {
    for (const id of await resolveCanonicalHostIds(db, hostId)) {
      expandedHostIds.add(id)
    }
  }

  const aliasRows = await db.leadIdentityAlias.findMany({
    where: {
      OR: [
        { aliasId: { in: [...expandedHostIds] } },
        { canonicalId: { in: [...expandedHostIds] } },
      ],
    },
  })

  for (const alias of aliasRows) {
    expandedHostIds.add(alias.aliasId)
    expandedHostIds.add(alias.canonicalId)
    if (alias.leadId) leadIds.add(alias.leadId)
    const listingMatch = alias.aliasId.match(/^manual:listing-(\d+)$/)
    if (listingMatch?.[1]) listingIds.add(listingMatch[1])
    const threadMatch = alias.aliasId.match(/^manual:thread-(\d+)$/)
    if (threadMatch?.[1]) threadIds.add(threadMatch[1])
    if (isLegacyManualThreadId(alias.aliasId)) {
      threadIds.add(alias.aliasId.slice('manual:'.length))
    }
  }

  const relatedLeads = await db.lead.findMany({
    where: {
      OR: [
        { hostAirbnbId: { in: [...expandedHostIds] } },
        { id: { in: [...leadIds] } },
        ...[...listingIds].map((listingId) => ({
          primaryListingUrl: { contains: `/rooms/${listingId}` },
        })),
        ...[...threadIds].flatMap((threadId) => [
          { threadId: { contains: threadId } },
          { hostAirbnbId: threadHostId(threadId) },
          { hostAirbnbId: legacyThreadHostId(threadId) },
        ]),
      ],
    },
  })

  for (const related of relatedLeads) {
    leadIds.add(related.id)
    expandedHostIds.add(related.hostAirbnbId)
    for (const listingId of collectListingIdsFromLead(related)) {
      listingIds.add(listingId)
      expandedHostIds.add(listingHostId(listingId))
    }
    for (const threadId of collectThreadIdsFromLead(related)) {
      threadIds.add(threadId)
      expandedHostIds.add(threadHostId(threadId))
      expandedHostIds.add(legacyThreadHostId(threadId))
    }
  }

  return {
    seedLeadId: lead.id,
    leadIds: [...leadIds],
    hostAirbnbIds: [...expandedHostIds],
    listingIds: [...listingIds],
    threadIds: [...threadIds],
  }
}

export async function findLeadsByListingId(
  db: PrismaClient,
  listingId: string,
): Promise<Lead[]> {
  const aliasRows = await db.leadIdentityAlias.findMany({
    where: { aliasId: listingHostId(listingId) },
  })

  const hostIds = new Set<string>([listingHostId(listingId)])
  for (const alias of aliasRows) {
    hostIds.add(alias.canonicalId)
    for (const id of await resolveCanonicalHostIds(db, alias.canonicalId)) {
      hostIds.add(id)
    }
  }

  return db.lead.findMany({
    where: {
      OR: [
        { hostAirbnbId: { in: [...hostIds] } },
        { primaryListingUrl: { contains: `/rooms/${listingId}` } },
        ...(aliasRows
          .map((alias) => alias.leadId)
          .filter((id): id is string => id != null)
          .map((id) => ({ id }))),
      ],
    },
    orderBy: { updatedAt: 'desc' },
  })
}

export async function isClusterContacted(
  db: PrismaClient,
  cluster: LeadIdentityCluster,
): Promise<ClusterContactedResult> {
  if (cluster.leadIds.length === 0) {
    return { contacted: false }
  }

  const leads = await db.lead.findMany({
    where: { id: { in: cluster.leadIds } },
  })

  let canonicalLead: Lead | null = null
  for (const clusterLead of leads) {
    if (isLeadContacted(clusterLead)) {
      if (!canonicalLead || pickAdvancedStatus(clusterLead.status, canonicalLead.status) === clusterLead.status) {
        canonicalLead = clusterLead
      }
      if (clusterLead.status !== LeadStatus.LEAD_DISCOVERED) {
        return {
          contacted: true,
          reason: 'status_not_discovered',
          canonicalLeadId: clusterLead.id,
        }
      }
      if (clusterLead.threadId) {
        return {
          contacted: true,
          reason: 'thread_exists',
          canonicalLeadId: clusterLead.id,
        }
      }
    }
  }

  const hostContact = await db.hostContact.findFirst({
    where: {
      OR: [
        { leadId: { in: cluster.leadIds } },
        { hostAirbnbId: { in: cluster.hostAirbnbIds } },
      ],
    },
  })
  if (hostContact) {
    return {
      contacted: true,
      reason: 'host_contact_ledger',
      canonicalLeadId: hostContact.leadId,
    }
  }

  const outbound = await db.message.findFirst({
    where: {
      leadId: { in: cluster.leadIds },
      direction: MessageDirection.OUTBOUND,
    },
  })
  if (outbound) {
    return {
      contacted: true,
      reason: 'outbound_message_exists',
      canonicalLeadId: outbound.leadId,
    }
  }

  return { contacted: false }
}
