import { parseListingId, parseThreadId } from '@repo/airbnb-parse'
import { db, LeadStatus, MessageDirection, type Lead } from '@repo/db'
import {
  legacyThreadHostId,
  listingHostId,
  pickAdvancedStatus,
  threadHostId,
} from '@repo/lead-contact'

export function isManualHostId(hostAirbnbId: string): boolean {
  return hostAirbnbId.startsWith('manual:')
}

export function isNumericHostId(hostAirbnbId: string): boolean {
  return /^\d+$/.test(hostAirbnbId)
}

export async function findDuplicateLeadForCanonicalHost(
  canonicalHostId: string,
  primaryListingUrl: string,
  threadId?: string | null,
): Promise<Lead | null> {
  const listingId = parseListingId(primaryListingUrl)
  const threadNumericId = threadId ? parseThreadId(threadId) : null
  const orConditions: Array<{
    hostAirbnbId?: string
    primaryListingUrl?: { contains: string }
    threadId?: { contains: string }
  }> = [{ hostAirbnbId: canonicalHostId }]

  if (listingId) {
    orConditions.push(
      { hostAirbnbId: listingHostId(listingId) },
      { primaryListingUrl: { contains: `/rooms/${listingId}` } },
    )
  }

  if (threadNumericId) {
    orConditions.push(
      { hostAirbnbId: threadHostId(threadNumericId) },
      { hostAirbnbId: legacyThreadHostId(threadNumericId) },
      { threadId: { contains: threadNumericId } },
    )
  }

  const aliasMatches = await db.leadIdentityAlias.findMany({
    where: {
      OR: [{ canonicalId: canonicalHostId }, { aliasId: canonicalHostId }],
    },
    select: { aliasId: true, leadId: true },
  })

  for (const alias of aliasMatches) {
    orConditions.push({ hostAirbnbId: alias.aliasId })
  }

  const leads = await db.lead.findMany({
    where: { OR: orConditions },
    orderBy: { updatedAt: 'desc' },
  })

  if (leads.length === 0) return null

  return leads.sort((a, b) => {
    if (a.hostAirbnbId === canonicalHostId) return -1
    if (b.hostAirbnbId === canonicalHostId) return 1
    return 0
  })[0]
}

export async function mergeLeadIntoCanonical(
  canonicalLead: Lead,
  duplicateLead: Lead,
  canonicalHostId: string,
): Promise<Lead> {
  if (canonicalLead.id === duplicateLead.id) {
    return canonicalLead
  }

  return db.$transaction(async (tx) => {
    await tx.message.updateMany({
      where: { leadId: duplicateLead.id },
      data: { leadId: canonicalLead.id },
    })

    const duplicateContact = await tx.hostContact.findUnique({
      where: { leadId: duplicateLead.id },
    })
    const canonicalContact = await tx.hostContact.findUnique({
      where: { leadId: canonicalLead.id },
    })

    if (duplicateContact) {
      if (canonicalContact) {
        await tx.hostContact.delete({ where: { leadId: duplicateLead.id } })
      } else {
        await tx.hostContact.update({
          where: { leadId: duplicateLead.id },
          data: {
            leadId: canonicalLead.id,
            hostAirbnbId: canonicalHostId,
          },
        })
      }
    }

    if (duplicateLead.hostAirbnbId !== canonicalHostId) {
      await tx.leadIdentityAlias.upsert({
        where: { aliasId: duplicateLead.hostAirbnbId },
        create: {
          aliasId: duplicateLead.hostAirbnbId,
          canonicalId: canonicalHostId,
          leadId: canonicalLead.id,
        },
        update: {
          canonicalId: canonicalHostId,
          leadId: canonicalLead.id,
        },
      })
    }

    const mergedStatus = pickAdvancedStatus(canonicalLead.status, duplicateLead.status)

    const updated = await tx.lead.update({
      where: { id: canonicalLead.id },
      data: {
        hostAirbnbId: canonicalHostId,
        status: mergedStatus,
        threadId: canonicalLead.threadId ?? duplicateLead.threadId,
        totalProperties: Math.max(canonicalLead.totalProperties, duplicateLead.totalProperties),
        isSuperhost: canonicalLead.isSuperhost || duplicateLead.isSuperhost,
        market: canonicalLead.market ?? duplicateLead.market,
        lastContactedAt: canonicalLead.lastContactedAt ?? duplicateLead.lastContactedAt,
        companyName: canonicalLead.companyName ?? duplicateLead.companyName,
        // Preferir el listing del lead canónico (el recién cosechado) para no
        // escribir a un primaryListingUrl viejo del alias/duplicate.
        primaryListingUrl:
          canonicalLead.primaryListingUrl || duplicateLead.primaryListingUrl,
        primaryListingName:
          canonicalLead.primaryListingName ?? duplicateLead.primaryListingName,
      },
    })

    await tx.lead.delete({ where: { id: duplicateLead.id } })

    return updated
  })
}

export async function resolveCanonicalLeadForHarvest(
  input: {
    hostAirbnbId: string
    primaryListingUrl: string
  },
  createLead: () => Promise<Lead>,
): Promise<{ lead: Lead; merged: boolean }> {
  if (!isNumericHostId(input.hostAirbnbId)) {
    const lead = await createLead()
    return { lead, merged: false }
  }

  const duplicate = await findDuplicateLeadForCanonicalHost(
    input.hostAirbnbId,
    input.primaryListingUrl,
  )

  if (!duplicate) {
    const lead = await createLead()
    return { lead, merged: false }
  }

  if (duplicate.hostAirbnbId === input.hostAirbnbId) {
    return { lead: duplicate, merged: false }
  }

  const placeholder = await createLead()
  const merged = await mergeLeadIntoCanonical(placeholder, duplicate, input.hostAirbnbId)
  return { lead: merged, merged: true }
}

export async function fixInconsistentDiscoveredLead(leadId: string): Promise<Lead | null> {
  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead || lead.status !== LeadStatus.LEAD_DISCOVERED) return lead

  const outboundCount = await db.message.count({
    where: { leadId, direction: MessageDirection.OUTBOUND },
  })

  if (!lead.threadId && outboundCount === 0) {
    return lead
  }

  return db.lead.update({
    where: { id: leadId },
    data: {
      status: LeadStatus.INITIAL_MSG_SENT,
      lastContactedAt: lead.lastContactedAt ?? new Date(),
    },
  })
}
