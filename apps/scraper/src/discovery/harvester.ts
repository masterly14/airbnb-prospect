import type { Page } from 'playwright'
import type { HarvestContext, HarvestResult } from '../persistence/lead-repository'
import { upsertDiscoveredLead } from '../persistence/lead-repository'
import { maybeEnrichAfterHarvest } from '../enrichment/enrich-lead'
import { harvestLog } from '../logging/harvest-logger'
import { withRetry } from '../resilience/retry'
import { detectPageBlockers } from '../scraping/blockers'
import {
  scrapeHostProfileStats,
  extractHostFromListingPage,
  scrapeHostBio,
} from '../scraping/airbnb-host'
import {
  dismissBlockingOverlays,
  scrapeListingDetail,
  scrapeListingReviews,
  type ScrapedListing,
} from '../scraping/airbnb-scraper'

const LISTING_DELAY_MS = 2_000
const LISTING_RETRIES = Number.parseInt(process.env.HARVEST_LISTING_RETRIES ?? '3', 10)
const LISTING_RETRY_DELAY_MS = Number.parseInt(
  process.env.HARVEST_LISTING_RETRY_DELAY_MS ?? '2000',
  10,
)

async function gotoWithRetry(page: Page, url: string): Promise<void> {
  await withRetry(
    async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await dismissBlockingOverlays(page)
      const blocker = await detectPageBlockers(page)
      if (blocker === 'captcha' || blocker === 'session_expired') {
        throw new Error(`page_blocked:${blocker}`)
      }
      if (blocker === 'network') {
        throw new Error('network error loading page')
      }
    },
    {
      maxAttempts: LISTING_RETRIES,
      baseDelayMs: LISTING_RETRY_DELAY_MS,
      retryOn: (error) => {
        if (!(error instanceof Error)) return false
        const message = error.message.toLowerCase()
        if (message.startsWith('page_blocked:')) return false
        return (
          message.includes('timeout') ||
          message.includes('net::') ||
          message.includes('network error')
        )
      },
    },
  )
}

async function collectHarvestContext(page: Page): Promise<HarvestContext> {
  const detail = await scrapeListingDetail(page)
  const reviews = await scrapeListingReviews(page, 5)

  return {
    listingDescription: detail.description,
    listingAmenities: detail.amenities,
    reviewSnippets: reviews.length > 0 ? reviews : undefined,
  }
}

export type HarvestListingOutcome = {
  result: HarvestResult | null
  enriched?: boolean
}

export async function harvestListingLead(
  page: Page,
  listing: ScrapedListing,
  market?: string,
): Promise<HarvestListingOutcome> {
  try {
    await gotoWithRetry(page, listing.url)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('page_blocked:')) {
      const blocker = error.message.split(':')[1]
      harvestLog('harvest.blocked', { url: listing.url, blocker })
      return {
        result: {
          action: 'skipped',
          reason: 'page_blocked',
          name: listing.title,
        },
      }
    }
    throw error
  }

  const host = await extractHostFromListingPage(page)
  if (!host) return { result: null }

  const harvestContext = await collectHarvestContext(page)

  await gotoWithRetry(page, host.hostProfileUrl)
  const stats = await scrapeHostProfileStats(page)
  const hostBio = await scrapeHostBio(page)

  if (hostBio) {
    harvestContext.hostBioSnippet = hostBio
  }

  if (stats.confidence === 'unknown') {
    harvestLog('lead.skipped', {
      hostAirbnbId: host.hostAirbnbId,
      reason: 'properties_count_uncertain',
      totalProperties: stats.totalProperties,
    })
    return {
      result: {
        hostAirbnbId: host.hostAirbnbId,
        name: host.name,
        totalProperties: stats.totalProperties,
        action: 'skipped',
        reason: 'properties_count_uncertain',
      },
    }
  }

  const result = await upsertDiscoveredLead(
    {
      hostAirbnbId: host.hostAirbnbId,
      name: host.name,
      hostProfileUrl: host.hostProfileUrl,
      primaryListingUrl: listing.url,
      primaryListingName: listing.title,
      totalProperties: stats.totalProperties,
      companyName: stats.companyName,
      isSuperhost: stats.isSuperhost,
      market,
      hostListingNames: stats.listingTitles,
    },
    { harvestContext },
  )

  if (result.action === 'created') {
    harvestLog('lead.created', { hostAirbnbId: result.hostAirbnbId, name: result.name })
  } else if (result.action === 'updated') {
    harvestLog('lead.updated', { hostAirbnbId: result.hostAirbnbId })
  } else if (result.action === 'skipped') {
    harvestLog('lead.skipped', {
      hostAirbnbId: result.hostAirbnbId,
      reason: result.reason,
      totalProperties: result.totalProperties,
    })
  } else {
    harvestLog('lead.unchanged', { hostAirbnbId: result.hostAirbnbId })
  }

  if (result.action === 'created' || result.action === 'updated') {
    const syncEnabled = process.env.HARVEST_ENRICH_SYNC === 'true' && Boolean(process.env.DEEPSEEK_API_KEY)
    if (syncEnabled) {
      const ok = await maybeEnrichAfterHarvest(
        result,
        harvestContext,
        stats.companyName,
        listing.title,
      )
      return { result, enriched: ok }
    }
  }

  return { result }
}

const ICP_SKIP_REASONS = new Set([
  'below_min',
  'above_max',
  'not_superhost',
  'hotel_loft',
  'wrong_market',
  'properties_count_uncertain',
  'page_blocked',
])

export async function harvestListings(
  page: Page,
  listings: ScrapedListing[],
  maxListings?: number,
  market?: string,
): Promise<{ results: HarvestResult[]; enriched: number; enrichFailed: number }> {
  const limit =
    maxListings ??
    Number.parseInt(process.env.HARVEST_MAX_LISTINGS ?? '20', 10)

  const seenHosts = new Set<string>()
  const results: HarvestResult[] = []
  let enriched = 0
  let enrichFailed = 0

  for (const listing of listings.slice(0, limit)) {
    const outcome = await harvestListingLead(page, listing, market).catch((error) => {
      harvestLog('harvest.error', { url: listing.url, error: String(error) })
      return { result: null } satisfies HarvestListingOutcome
    })

    const result = outcome.result
    if (outcome.enriched === true) enriched++
    else if (outcome.enriched === false) enrichFailed++

    if (!result) {
      console.warn(`No host extracted for listing: ${listing.title} (${listing.url})`)
      continue
    }

    if (
      result.action === 'skipped' &&
      result.reason &&
      ICP_SKIP_REASONS.has(result.reason)
    ) {
      results.push(result)
      continue
    }

    if (result.hostAirbnbId && seenHosts.has(result.hostAirbnbId)) {
      results.push({
        ...result,
        action: 'skipped',
        reason: 'duplicate_in_run',
      })
      continue
    }

    if (result.hostAirbnbId) seenHosts.add(result.hostAirbnbId)
    results.push(result)
    await page.waitForTimeout(LISTING_DELAY_MS)
  }

  return { results, enriched, enrichFailed }
}
