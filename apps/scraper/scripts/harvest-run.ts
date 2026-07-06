import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { harvestListings } from '../src/discovery/harvester'
import { resolveHarvestMarkets } from '../src/discovery/markets'
import {
  HarvestAuthMissingError,
  HarvestMutexBusyError,
  HarvestSearchBlockedError,
  HarvestSessionExpiredError,
} from '../src/harvest/errors'
import { harvestLog } from '../src/logging/harvest-logger'
import {
  buildSearchResultsUrl,
  getSearchDates,
} from '../src/scraping/airbnb-search'
import { scrapeSearchResultsPaginated } from '../src/scraping/airbnb-scraper'
import {
  acquirePlaywrightMutex,
  getNextMarketIndex,
  releasePlaywrightMutex,
} from '../src/persistence/system-state'
import {
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../src/scraping/airbnb-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'
import { detectPageBlockers } from '../src/scraping/blockers'
import { isSessionValid } from '../src/scraping/session-utils'
import { sleep } from '../src/resilience/retry'
import { db } from '@repo/db'
import {
  assertAccountSessionValid,
  openAccountBrowserSession,
} from '../src/accounts/account-browser-session'
import { isMvpSingleAccountMode, loadMvpAccount, mvpModeLogContext } from '../src/accounts/mvp-mode'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const AUTH_FILE = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')
const MUTEX_RETRIES = Number.parseInt(process.env.HARVEST_MUTEX_RETRIES ?? '3', 10)
const MUTEX_RETRY_DELAY_MS = Number.parseInt(
  process.env.HARVEST_MUTEX_RETRY_DELAY_MS ?? '30000',
  10,
)

export type HarvestReport = {
  timestamp: string
  mvpMode?: boolean
  accountId?: string
  accountLabel?: string
  markets: string[]
  created: number
  updated: number
  unchanged: number
  skipped: number
  errors: number
  enriched: number
  enrichFailed: number
  blockedMarkets: string[]
  leads: Array<{
    hostAirbnbId?: string
    name?: string
    action: string
    reason?: string
  }>
}

async function acquireMutexWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= MUTEX_RETRIES; attempt++) {
    const acquired = await acquirePlaywrightMutex()
    if (acquired) return

    if (attempt >= MUTEX_RETRIES) {
      throw new HarvestMutexBusyError()
    }

    harvestLog('harvest.mutex_retry', { attempt, maxAttempts: MUTEX_RETRIES })
    await sleep(MUTEX_RETRY_DELAY_MS)
  }
}

function writeHarvestReport(report: HarvestReport): string {
  const reportsDir = path.resolve(__dirname, '../reports')
  fs.mkdirSync(reportsDir, { recursive: true })
  const reportPath = path.join(reportsDir, `harvest-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  return reportPath
}

export async function runHarvest(options: { writeReport?: boolean } = {}): Promise<HarvestReport> {
  const writeReport = options.writeReport ?? true
  const mvpMode = isMvpSingleAccountMode()
  const mvpAccount = mvpMode ? await loadMvpAccount() : null

  if (!mvpMode && !fs.existsSync(AUTH_FILE)) {
    throw new HarvestAuthMissingError()
  }

  await acquireMutexWithRetry()
  harvestLog('harvest.start', mvpModeLogContext())

  const report: HarvestReport = {
    timestamp: new Date().toISOString(),
    mvpMode,
    accountId: mvpAccount?.id,
    accountLabel: mvpAccount?.label,
    markets: [],
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: 0,
    enriched: 0,
    enrichFailed: 0,
    blockedMarkets: [],
    leads: [],
  }

  const browser = mvpAccount
    ? null
    : await chromium.launch({
        headless: process.env.HARVEST_HEADED !== 'true',
        ...getChromeChannelOption(),
      })

  try {
    let page

    if (mvpAccount) {
      const session = await openAccountBrowserSession(mvpAccount, {
        headless: process.env.HARVEST_HEADED !== 'true',
      })
      report.accountId = mvpAccount.id
      report.accountLabel = mvpAccount.label
      await assertAccountSessionValid(session.page)
      page = session.page

      // Cerrar browser al final vía session.browser
      const sessionBrowser = session.browser
      try {
        await runHarvestMarkets(page, report, mvpAccount.market)
      } finally {
        await sessionBrowser.close()
      }
    } else {
      const context = await browser!.newContext({
        storageState: AUTH_FILE,
        ...getColombiaContextOptions(),
      })
      page = await context.newPage()

      const baseUrl = process.env.AIRBNB_BASE_URL ?? 'https://www.airbnb.com.co'
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
      await dismissBlockingOverlays(page)

      if (!(await isSessionValid(page))) {
        throw new HarvestSessionExpiredError()
      }

      await runHarvestMarkets(page, report)
    }

    harvestLog('harvest.complete', {
      ...mvpModeLogContext(),
      created: report.created,
      updated: report.updated,
      skipped: report.skipped,
      enriched: report.enriched,
    })
  } catch (error) {
    report.errors++
    harvestLog('harvest.error', { ...mvpModeLogContext(), error: String(error) })
    throw error
  } finally {
    if (browser) {
      await browser.close()
    }
    await releasePlaywrightMutex()
    await db.$disconnect()
  }

  if (writeReport) {
    const reportPath = writeHarvestReport(report)
    console.log(`Harvest report written to ${reportPath}`)
  }

  return report
}

async function runHarvestMarkets(
  page: Awaited<ReturnType<typeof openAccountBrowserSession>>['page'],
  report: HarvestReport,
  accountMarket?: string | null,
): Promise<void> {
  let markets = resolveHarvestMarkets()
  const rotate = process.env.HARVEST_ROTATE_MARKETS === 'true'

  if (accountMarket && !process.env.HARVEST_MARKET && !process.env.HARVEST_MARKETS) {
    markets = markets.filter((market) => market.name === accountMarket)
    if (markets.length === 0) {
      throw new Error(`MVP account market "${accountMarket}" is not a valid harvest market`)
    }
  }

  if (rotate && markets.length > 1) {
    const index = await getNextMarketIndex(markets.length)
    markets = [markets[index]]
  }

  report.markets = markets.map((market) => market.name)
  const { checkin, checkout } = getSearchDates(7)

  for (const market of markets) {
    harvestLog('harvest.market', { market: market.name, ...mvpModeLogContext() })

    const searchUrl = buildSearchResultsUrl({
      slug: market.slug,
      placeId: market.placeId,
      checkin,
      checkout,
    })

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)

    const searchBlocker = await detectPageBlockers(page)
    if (searchBlocker === 'captcha' || searchBlocker === 'network') {
      report.blockedMarkets.push(market.name)
      harvestLog('harvest.market_blocked', { market: market.name, blocker: searchBlocker })
      throw new HarvestSearchBlockedError(searchBlocker, market.name)
    }
    if (searchBlocker === 'session_expired') {
      throw new HarvestSessionExpiredError()
    }

    const listings = await scrapeSearchResultsPaginated(page)
    const batch = await harvestListings(page, listings, undefined, market.name)
    report.enriched += batch.enriched
    report.enrichFailed += batch.enrichFailed

    for (const result of batch.results) {
      report.leads.push({
        hostAirbnbId: result.hostAirbnbId,
        name: result.name,
        action: result.action,
        reason: result.reason,
      })

      if (result.action === 'created') report.created++
      else if (result.action === 'updated') report.updated++
      else if (result.action === 'unchanged') report.unchanged++
      else if (result.action === 'skipped') report.skipped++
    }
  }
}

async function main() {
  try {
    await runHarvest()
  } catch (error) {
    console.error('harvest-run failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}
