import type { Page } from 'playwright'
import type { HarvestContext, HarvestResult } from '../persistence/lead-repository'
import { findRecentIcpSkip, upsertDiscoveredLead } from '../persistence/lead-repository'
import { maybeEnrichAfterHarvest } from '../enrichment/enrich-lead'
import {
  harvestLog,
  harvestTrace,
  parseListingIdFromUrl,
} from '../logging/harvest-logger'
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
import {
  getHarvestSendMax,
  isHarvestSendImmediateEnabled,
  sendColdImmediatelyAfterHarvest,
  type HarvestSendOutcome,
} from './harvest-send'

const LISTING_DELAY_MS = 2_000
const ICP_SKIP_TTL_DAYS = Number.parseInt(process.env.HARVEST_ICP_SKIP_TTL_DAYS ?? '30', 10)
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
  /** Resultado del cold send inmediato (si HARVEST_SEND_IMMEDIATE está activo). */
  sendOutcome?: HarvestSendOutcome
}

export type HarvestListingOptions = {
  market?: string
  /** Cuenta que harvestea; requerida para envío inmediato. */
  accountId?: string
  /** Si false, no envía aunque el flag global esté on (p. ej. dry-run). */
  sendImmediate?: boolean
}

export async function harvestListingLead(
  page: Page,
  listing: ScrapedListing,
  marketOrOptions?: string | HarvestListingOptions,
): Promise<HarvestListingOutcome> {
  const options: HarvestListingOptions =
    typeof marketOrOptions === 'string' || marketOrOptions === undefined
      ? { market: marketOrOptions }
      : marketOrOptions
  const market = options.market
  const searchListingId = parseListingIdFromUrl(listing.url)

  harvestLog('harvest.listing.start', {
    searchTitle: listing.title,
    searchUrl: listing.url,
    listingId: searchListingId,
    market,
  })

  try {
    await gotoWithRetry(page, listing.url)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('page_blocked:')) {
      const blocker = error.message.split(':')[1]
      harvestLog('harvest.blocked', {
        url: listing.url,
        listingId: searchListingId,
        searchTitle: listing.title,
        blocker,
      })
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

  const pageListingId = parseListingIdFromUrl(page.url())
  if (searchListingId && pageListingId && searchListingId !== pageListingId) {
    harvestLog('harvest.send.listing_mismatch', {
      stage: 'after_goto_listing',
      expectedListingId: searchListingId,
      actualListingId: pageListingId,
      searchTitle: listing.title,
      searchUrl: listing.url,
      pageUrl: page.url(),
    })
  }

  const host = await extractHostFromListingPage(page)
  if (!host) {
    harvestLog('harvest.listing.host', {
      ok: false,
      listingId: searchListingId,
      searchTitle: listing.title,
      searchUrl: listing.url,
      pageUrl: page.url(),
    })
    return { result: null }
  }

  harvestLog('harvest.listing.host', {
    ok: true,
    listingId: searchListingId,
    searchTitle: listing.title,
    searchUrl: listing.url,
    hostAirbnbId: host.hostAirbnbId,
    hostName: host.name,
    hostProfileUrl: host.hostProfileUrl,
    pageUrl: page.url(),
  })

  // Caché de descartes ICP: si este host ya fue evaluado y descartado dentro
  // del TTL, saltar antes del scrape caro del perfil (evita el bucle de
  // re-prospectar los mismos anuncios cada corrida).
  const cachedSkip = await findRecentIcpSkip(host.hostAirbnbId, ICP_SKIP_TTL_DAYS)
  if (cachedSkip) {
    harvestLog('lead.skipped', {
      hostAirbnbId: host.hostAirbnbId,
      hostName: host.name,
      reason: cachedSkip.reason,
      cached: true,
      listingId: searchListingId,
      searchTitle: listing.title,
      searchUrl: listing.url,
    })
    return {
      result: {
        hostAirbnbId: host.hostAirbnbId,
        name: host.name,
        action: 'skipped',
        reason: cachedSkip.reason,
      },
    }
  }

  const harvestContext = await collectHarvestContext(page)
  const detailTitle = (await page.locator('h1').first().innerText().catch(() => '')).trim()
  const primaryListingName = detailTitle || listing.title

  harvestLog('harvest.listing.detail', {
    listingId: searchListingId,
    searchTitle: listing.title,
    detailTitle: detailTitle || null,
    titleMismatch:
      Boolean(detailTitle) &&
      detailTitle.toLowerCase() !== listing.title.trim().toLowerCase(),
    searchUrl: listing.url,
    pageUrl: page.url(),
    hostAirbnbId: host.hostAirbnbId,
  })

  await gotoWithRetry(page, host.hostProfileUrl)
  const stats = await scrapeHostProfileStats(page)
  const hostBio = await scrapeHostBio(page)

  if (hostBio) {
    harvestContext.hostBioSnippet = hostBio
  }

  harvestTrace('profile_stats', {
    hostAirbnbId: host.hostAirbnbId,
    totalProperties: stats.totalProperties,
    confidence: stats.confidence,
    isSuperhost: stats.isSuperhost,
    companyName: stats.companyName,
    countCandidates: stats.countCandidates,
    listingTitlesSample: stats.listingTitles.slice(0, 5),
  })

  if (stats.confidence === 'unknown') {
    harvestLog('lead.skipped', {
      hostAirbnbId: host.hostAirbnbId,
      hostName: host.name,
      reason: 'properties_count_uncertain',
      totalProperties: stats.totalProperties,
      countCandidates: stats.countCandidates,
      listingId: searchListingId,
      searchTitle: listing.title,
      detailTitle: primaryListingName,
      searchUrl: listing.url,
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
      primaryListingName,
      totalProperties: stats.totalProperties,
      companyName: stats.companyName,
      isSuperhost: stats.isSuperhost,
      market,
      hostListingNames: stats.listingTitles,
    },
    { harvestContext },
  )

  harvestLog('harvest.listing.icp', {
    hostAirbnbId: result.hostAirbnbId,
    hostName: result.name,
    action: result.action,
    reason: result.reason ?? null,
    totalProperties: result.totalProperties ?? stats.totalProperties,
    isSuperhost: stats.isSuperhost,
    listingId: searchListingId,
    searchTitle: listing.title,
    detailTitle: primaryListingName,
    searchUrl: listing.url,
    leadId: result.id ?? null,
  })

  if (result.action === 'created') {
    harvestLog('lead.created', {
      hostAirbnbId: result.hostAirbnbId,
      name: result.name,
      listingId: searchListingId,
      primaryListingUrl: listing.url,
      primaryListingName,
    })
  } else if (result.action === 'updated') {
    harvestLog('lead.updated', {
      hostAirbnbId: result.hostAirbnbId,
      listingId: searchListingId,
      primaryListingUrl: listing.url,
      primaryListingName,
    })
  } else if (result.action === 'skipped') {
    harvestLog('lead.skipped', {
      hostAirbnbId: result.hostAirbnbId,
      hostName: result.name,
      reason: result.reason,
      totalProperties: result.totalProperties,
      listingId: searchListingId,
      searchTitle: listing.title,
      detailTitle: primaryListingName,
      searchUrl: listing.url,
    })
  } else {
    harvestLog('lead.unchanged', {
      hostAirbnbId: result.hostAirbnbId,
      listingId: searchListingId,
      searchUrl: listing.url,
    })
  }

  let enriched: boolean | undefined
  if (result.action === 'created' || result.action === 'updated') {
    const syncEnabled = process.env.HARVEST_ENRICH_SYNC === 'true' && Boolean(process.env.DEEPSEEK_API_KEY)
    if (syncEnabled) {
      enriched = await maybeEnrichAfterHarvest(
        result,
        harvestContext,
        stats.companyName,
        primaryListingName,
      )
    }
  }

  // ICP ya validado en upsert: si el lead quedó creado/actualizado y sigue
  // contactable, escribir en la misma sesión (sin cola intermedia).
  let sendOutcome: HarvestSendOutcome | undefined
  const shouldSend =
    options.sendImmediate !== false &&
    isHarvestSendImmediateEnabled() &&
    Boolean(options.accountId) &&
    Boolean(result.id) &&
    (result.action === 'created' || result.action === 'updated')

  if (shouldSend && options.accountId && result.id) {
    harvestLog('harvest.listing.bind', {
      leadId: result.id,
      hostAirbnbId: result.hostAirbnbId,
      harvestListingId: searchListingId,
      harvestListingUrl: listing.url,
      harvestListingTitle: primaryListingName,
      searchTitle: listing.title,
    })
    sendOutcome = await sendColdImmediatelyAfterHarvest(page, result.id, options.accountId, {
      listingUrl: listing.url,
      listingTitle: primaryListingName,
      listingId: searchListingId ?? undefined,
    })
  }

  return { result, enriched, sendOutcome }
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

export type HarvestListingsOptions = {
  maxListings?: number
  market?: string
  accountId?: string
  sendImmediate?: boolean
}

export async function harvestListings(
  page: Page,
  listings: ScrapedListing[],
  maxListingsOrOptions?: number | HarvestListingsOptions,
  market?: string,
): Promise<{
  results: HarvestResult[]
  enriched: number
  enrichFailed: number
  sent: number
  sendFailed: number
  sendBlocked: boolean
}> {
  const options: HarvestListingsOptions =
    typeof maxListingsOrOptions === 'number' || maxListingsOrOptions === undefined
      ? { maxListings: maxListingsOrOptions, market }
      : maxListingsOrOptions

  const limit =
    options.maxListings ??
    Number.parseInt(process.env.HARVEST_MAX_LISTINGS ?? '20', 10)
  const sendMax = getHarvestSendMax()

  const seenHosts = new Set<string>()
  const results: HarvestResult[] = []
  let enriched = 0
  let enrichFailed = 0
  let sent = 0
  let sendFailed = 0
  let sendBlocked = false

  const skipCounts: Record<string, number> = {}
  const batchListings = listings.slice(0, limit)

  for (let index = 0; index < batchListings.length; index++) {
    const listing = batchListings[index]!
    if (sendBlocked) break
    if (sent >= sendMax && isHarvestSendImmediateEnabled()) {
      harvestLog('harvest.send.cap_reached', { sent, sendMax })
      // Seguir harvestando sin enviar más (solo descubrir) no tiene sentido
      // en modo inmediato: cortar el run de listings.
      break
    }

    harvestTrace('listing_index', {
      index: index + 1,
      of: batchListings.length,
      listingId: parseListingIdFromUrl(listing.url),
      title: listing.title,
      url: listing.url,
    })

    const outcome = await harvestListingLead(page, listing, {
      market: options.market,
      accountId: options.accountId,
      sendImmediate: options.sendImmediate,
    }).catch((error) => {
      harvestLog('harvest.error', {
        url: listing.url,
        listingId: parseListingIdFromUrl(listing.url),
        searchTitle: listing.title,
        error: String(error),
      })
      return { result: null } satisfies HarvestListingOutcome
    })

    const result = outcome.result
    if (outcome.enriched === true) enriched++
    else if (outcome.enriched === false) enrichFailed++

    if (outcome.sendOutcome === 'sent') sent++
    else if (outcome.sendOutcome === 'failed') sendFailed++
    else if (outcome.sendOutcome === 'blocked') {
      sendBlocked = true
    }

    if (!result) {
      skipCounts.no_host = (skipCounts.no_host ?? 0) + 1
      harvestLog('harvest.error', {
        reason: 'no_host_extracted',
        url: listing.url,
        listingId: parseListingIdFromUrl(listing.url),
        searchTitle: listing.title,
      })
      continue
    }

    if (
      result.action === 'skipped' &&
      result.reason &&
      ICP_SKIP_REASONS.has(result.reason)
    ) {
      skipCounts[result.reason] = (skipCounts[result.reason] ?? 0) + 1
      results.push(result)
      continue
    }

    if (result.hostAirbnbId && seenHosts.has(result.hostAirbnbId)) {
      skipCounts.duplicate_in_run = (skipCounts.duplicate_in_run ?? 0) + 1
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

  harvestLog('harvest.page_summary', {
    market: options.market,
    listingsTried: batchListings.length,
    created: results.filter((r) => r.action === 'created').length,
    updated: results.filter((r) => r.action === 'updated').length,
    unchanged: results.filter((r) => r.action === 'unchanged').length,
    sent,
    sendFailed,
    sendBlocked,
    skipCounts,
  })

  return { results, enriched, enrichFailed, sent, sendFailed, sendBlocked }
}
