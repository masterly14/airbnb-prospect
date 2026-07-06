import { runProfiler } from '@repo/ai'
import { harvestLog } from '../logging/harvest-logger'
import type { HarvestContext, LeadEnrichment } from '../persistence/lead-repository'
import {
  getHarvestContextForLead,
  updateLeadEnrichment,
} from '../persistence/lead-repository'

export type EnrichLeadInput = {
  id: string
  name: string
  totalProperties: number
  companyName: string | null
  primaryListingName: string | null
}

export async function enrichLeadRecord(
  lead: EnrichLeadInput,
  harvestContext?: HarvestContext | null,
): Promise<boolean> {
  const context = harvestContext ?? (await getHarvestContextForLead(lead.id))

  try {
    const enrichment = await runProfiler({
      name: lead.name,
      totalProperties: lead.totalProperties,
      companyName: lead.companyName,
      primaryListingName: lead.primaryListingName,
      listingDescription: context?.listingDescription,
      listingAmenities: context?.listingAmenities,
      hostBioSnippet: context?.hostBioSnippet,
      reviewSnippets: context?.reviewSnippets,
    })

    await updateLeadEnrichment(lead.id, enrichment)
    harvestLog('enrich.success', { leadId: lead.id, name: lead.name })
    return true
  } catch (error) {
    harvestLog('enrich.failed', { leadId: lead.id, error: String(error) })
    return false
  }
}

export function isSyncEnrichmentEnabled(): boolean {
  return process.env.HARVEST_ENRICH_SYNC === 'true' && Boolean(process.env.DEEPSEEK_API_KEY)
}

export async function maybeEnrichAfterHarvest(
  result: {
    id?: string
    action: string
    name?: string
    totalProperties?: number
  },
  harvestContext: HarvestContext,
  companyName?: string | null,
  primaryListingName?: string | null,
): Promise<boolean> {
  if (!isSyncEnrichmentEnabled()) return false
  if (!result.id || (result.action !== 'created' && result.action !== 'updated')) {
    return false
  }

  return enrichLeadRecord(
    {
      id: result.id,
      name: result.name ?? 'Unknown host',
      totalProperties: result.totalProperties ?? 1,
      companyName: companyName ?? null,
      primaryListingName: primaryListingName ?? null,
    },
    harvestContext,
  )
}

export type { LeadEnrichment }
