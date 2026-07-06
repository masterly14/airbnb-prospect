import { db, LeadStatus, MessageDirection } from '@repo/db'
import { evaluateLeadIcp, ICP, type IcpSkipReason } from '../discovery/icp'
import {
  findDuplicateLeadForCanonicalHost,
  isNumericHostId,
  mergeLeadIntoCanonical,
} from './lead-identity-merge'

export const HARVEST_CONTEXT_PREFIX = 'HARVEST_CONTEXT:'

export type HarvestContext = {
  listingDescription?: string
  listingAmenities?: string[]
  hostBioSnippet?: string
  reviewSnippets?: string[]
}

export type DiscoveredLeadInput = {
  hostAirbnbId: string
  name: string
  hostProfileUrl: string
  primaryListingUrl: string
  primaryListingName?: string | null
  totalProperties: number
  companyName?: string | null
  isSuperhost: boolean
  market?: string | null
}

export type HarvestSkipReason =
  | IcpSkipReason
  | 'properties_count_uncertain'
  | 'no_host'
  | 'duplicate_in_run'
  | 'page_blocked'

export type HarvestResult = {
  id?: string
  hostAirbnbId?: string
  name?: string
  totalProperties?: number
  action: 'created' | 'updated' | 'unchanged' | 'skipped'
  reason?: HarvestSkipReason
}

export type UpsertDiscoveredLeadOptions = {
  harvestContext?: HarvestContext
}

export type LeadEnrichment = {
  businessScale: string
  painPoints: string
  executiveSummary: string
}

export function serializeHarvestContext(context: HarvestContext): string {
  return `${HARVEST_CONTEXT_PREFIX}${JSON.stringify(context)}`
}

export function parseHarvestContext(content: string): HarvestContext | null {
  if (!content.startsWith(HARVEST_CONTEXT_PREFIX)) return null
  try {
    return JSON.parse(content.slice(HARVEST_CONTEXT_PREFIX.length)) as HarvestContext
  } catch {
    return null
  }
}

export async function saveHarvestContextMessage(
  leadId: string,
  context: HarvestContext,
): Promise<void> {
  await db.message.create({
    data: {
      leadId,
      direction: MessageDirection.SYSTEM,
      content: serializeHarvestContext(context),
    },
  })
}

export async function getHarvestContextForLead(
  leadId: string,
): Promise<HarvestContext | null> {
  const message = await db.message.findFirst({
    where: {
      leadId,
      direction: MessageDirection.SYSTEM,
      content: { startsWith: HARVEST_CONTEXT_PREFIX },
    },
    orderBy: { sentAt: 'asc' },
  })

  if (!message) return null
  return parseHarvestContext(message.content)
}

function buildIcpInput(input: DiscoveredLeadInput, harvestContext?: HarvestContext) {
  return {
    totalProperties: input.totalProperties,
    isSuperhost: input.isSuperhost,
    market: input.market,
    primaryListingName: input.primaryListingName,
    companyName: input.companyName,
    hostBioSnippet: harvestContext?.hostBioSnippet,
  }
}

export async function upsertDiscoveredLead(
  input: DiscoveredLeadInput,
  options: UpsertDiscoveredLeadOptions = {},
): Promise<HarvestResult> {
  const icp = evaluateLeadIcp(buildIcpInput(input, options.harvestContext))

  if (!icp.eligible) {
    return {
      hostAirbnbId: input.hostAirbnbId,
      name: input.name,
      totalProperties: input.totalProperties,
      action: 'skipped',
      reason: icp.skipReason,
    }
  }

  const existing = await db.lead.findUnique({
    where: { hostAirbnbId: input.hostAirbnbId },
  })

  if (
    !existing &&
    isNumericHostId(input.hostAirbnbId)
  ) {
    const duplicate = await findDuplicateLeadForCanonicalHost(
      input.hostAirbnbId,
      input.primaryListingUrl,
    )

    if (duplicate && duplicate.hostAirbnbId !== input.hostAirbnbId) {
      const lead = await db.lead.create({
        data: {
          hostAirbnbId: input.hostAirbnbId,
          name: input.name,
          hostProfileUrl: input.hostProfileUrl,
          primaryListingUrl: input.primaryListingUrl,
          primaryListingName: input.primaryListingName ?? null,
          totalProperties: input.totalProperties,
          companyName: input.companyName ?? null,
          isSuperhost: input.isSuperhost,
          market: input.market ?? null,
          icpSkipReason: null,
          status: LeadStatus.LEAD_DISCOVERED,
        },
      })

      const merged = await mergeLeadIntoCanonical(lead, duplicate, input.hostAirbnbId)

      if (options.harvestContext) {
        await saveHarvestContextMessage(merged.id, options.harvestContext)
      }

      return {
        id: merged.id,
        hostAirbnbId: merged.hostAirbnbId,
        name: merged.name,
        totalProperties: merged.totalProperties,
        action: 'updated',
      }
    }
  }

  if (!existing) {
    const lead = await db.lead.create({
      data: {
        hostAirbnbId: input.hostAirbnbId,
        name: input.name,
        hostProfileUrl: input.hostProfileUrl,
        primaryListingUrl: input.primaryListingUrl,
        primaryListingName: input.primaryListingName ?? null,
        totalProperties: input.totalProperties,
        companyName: input.companyName ?? null,
        isSuperhost: input.isSuperhost,
        market: input.market ?? null,
        icpSkipReason: null,
        status: LeadStatus.LEAD_DISCOVERED,
      },
    })

    if (options.harvestContext) {
      await saveHarvestContextMessage(lead.id, options.harvestContext)
    }

    return {
      id: lead.id,
      hostAirbnbId: lead.hostAirbnbId,
      name: lead.name,
      totalProperties: lead.totalProperties,
      action: 'created',
    }
  }

  const totalProperties = Math.max(existing.totalProperties, input.totalProperties)

  if (existing.status === LeadStatus.LEAD_DISCOVERED) {
    const lead = await db.lead.update({
      where: { hostAirbnbId: input.hostAirbnbId },
      data: {
        name: input.name,
        hostProfileUrl: input.hostProfileUrl,
        primaryListingUrl: input.primaryListingUrl,
        primaryListingName: input.primaryListingName ?? null,
        totalProperties,
        companyName: input.companyName ?? existing.companyName,
        isSuperhost: input.isSuperhost || existing.isSuperhost,
        market: input.market ?? existing.market,
        icpSkipReason: null,
      },
    })

    if (options.harvestContext && !existing.businessScale) {
      const hasContext = await db.message.findFirst({
        where: {
          leadId: existing.id,
          content: { startsWith: HARVEST_CONTEXT_PREFIX },
        },
      })
      if (!hasContext) {
        await saveHarvestContextMessage(lead.id, options.harvestContext)
      }
    }

    return {
      id: lead.id,
      hostAirbnbId: lead.hostAirbnbId,
      name: lead.name,
      totalProperties: lead.totalProperties,
      action: 'updated',
    }
  }

  if (
    totalProperties > existing.totalProperties ||
    (input.isSuperhost && !existing.isSuperhost)
  ) {
    const lead = await db.lead.update({
      where: { hostAirbnbId: input.hostAirbnbId },
      data: {
        totalProperties,
        ...(input.isSuperhost && !existing.isSuperhost ? { isSuperhost: true } : {}),
        ...(input.market && !existing.market ? { market: input.market } : {}),
      },
    })

    return {
      id: lead.id,
      hostAirbnbId: lead.hostAirbnbId,
      name: lead.name,
      totalProperties: lead.totalProperties,
      action: 'updated',
    }
  }

  return {
    id: existing.id,
    hostAirbnbId: existing.hostAirbnbId,
    name: existing.name,
    totalProperties: existing.totalProperties,
    action: 'unchanged',
  }
}

export async function updateLeadEnrichment(
  leadId: string,
  enrichment: LeadEnrichment,
): Promise<void> {
  await db.lead.update({
    where: { id: leadId },
    data: {
      businessScale: enrichment.businessScale,
      painPoints: enrichment.painPoints,
      executiveSummary: enrichment.executiveSummary,
    },
  })

  await db.message.create({
    data: {
      leadId,
      direction: MessageDirection.SYSTEM,
      content: 'Perfilador: enriquecido',
    },
  })
}

export async function findLeadsPendingEnrichment(limit: number) {
  return db.lead.findMany({
    where: {
      businessScale: null,
      status: LeadStatus.LEAD_DISCOVERED,
      totalProperties: {
        gte: ICP.MIN_PROPERTIES,
        lte: ICP.MAX_PROPERTIES,
      },
      isSuperhost: true,
      icpSkipReason: null,
    },
    take: limit,
    orderBy: { createdAt: 'asc' },
  })
}
