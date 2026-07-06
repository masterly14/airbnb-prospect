import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { chromium, type Page } from 'playwright'
import { BlockType, db, type ProspectAccount } from '@repo/db'
import { harvestListings } from '../src/discovery/harvester'
import {
  resolveHarvestMarketForAccount,
  resolveHarvestMarkets,
  type HarvestMarket,
} from '../src/discovery/markets'
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
import { AccountSessionMissingError, AccountProxyConfigError } from '../src/scraping/playwright-context'
import { AccountLoginPrerequisitesError } from '../src/accounts/account-login'
import { openAccountBrowserSessionWithLogin } from '../src/accounts/account-browser-session'
import { pickNextAccount } from '../src/accounts/account-selector'
import { handleAccountBlock, markAccountSessionInvalid } from '../src/accounts/account-repository'
import { sendAlert } from '../src/notifications/notify'
import {
  isMvpSingleAccountMode,
  mvpModeLogContext,
} from '../src/accounts/mvp-mode'

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
  accountsUsed: string[]
  rotations: number
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

/** ¿Hay cuentas de prospección en DB para operar por cuenta (con rotación)? */
async function hasProspectAccounts(): Promise<boolean> {
  if (isMvpSingleAccountMode()) return true
  const count = await db.prospectAccount.count()
  return count > 0
}

export async function runHarvest(
  options: { writeReport?: boolean; disconnectDb?: boolean } = {},
): Promise<HarvestReport> {
  const writeReport = options.writeReport ?? true
  const disconnectDb = options.disconnectDb ?? true
  const mvpMode = isMvpSingleAccountMode()

  const useAccounts = await hasProspectAccounts()

  if (!useAccounts && !fs.existsSync(AUTH_FILE)) {
    throw new HarvestAuthMissingError()
  }

  await acquireMutexWithRetry()
  harvestLog('harvest.start', mvpModeLogContext())

  const report: HarvestReport = {
    timestamp: new Date().toISOString(),
    mvpMode,
    accountsUsed: [],
    rotations: 0,
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

  try {
    if (useAccounts) {
      await harvestWithAccountRotation(report, mvpMode)
    } else {
      await harvestWithLegacySession(report)
    }

    harvestLog('harvest.complete', {
      ...mvpModeLogContext(),
      created: report.created,
      updated: report.updated,
      skipped: report.skipped,
      enriched: report.enriched,
      rotations: report.rotations,
    })
  } catch (error) {
    report.errors++
    harvestLog('harvest.error', { ...mvpModeLogContext(), error: String(error) })
    throw error
  } finally {
    await releasePlaywrightMutex()
    if (disconnectDb) {
      await db.$disconnect()
    }
  }

  if (writeReport) {
    const reportPath = writeHarvestReport(report)
    console.log(`Harvest report written to ${reportPath}`)
  }

  return report
}

/**
 * Recorre las cuentas elegibles hasta lograr un harvest exitoso. Ante un
 * bloqueo de Airbnb pone la cuenta en cooldown y rota a la siguiente; si la
 * sesión expiró intenta auto-login y, si no puede, la saca de rotación. Cuando
 * ninguna cuenta queda elegible termina el run: el account-reaper reactivará
 * los cooldowns vencidos para el siguiente ciclo del cron.
 */
async function harvestWithAccountRotation(
  report: HarvestReport,
  mvpMode: boolean,
): Promise<void> {
  const excluded = new Set<string>()
  const headless = process.env.HARVEST_HEADED !== 'true'

  while (true) {
    const account = await pickNextAccount({ excludeAccountIds: [...excluded] })
    if (!account) {
      harvestLog('harvest.no_accounts', {
        ...mvpModeLogContext(),
        quarantined: excluded.size,
      })
      break
    }

    report.accountId = account.id
    report.accountLabel = account.label
    if (!report.accountsUsed.includes(account.id)) {
      report.accountsUsed.push(account.id)
    }

    // Validar el mercado de la cuenta antes de abrir navegador: si está mal
    // configurado, no bloquear al resto de cuentas por ello.
    let market: HarvestMarket
    try {
      market = resolveHarvestMarketForAccount(account.market)
    } catch (error) {
      excluded.add(account.id)
      harvestLog('harvest.account_market_invalid', {
        accountId: account.id,
        accountLabel: account.label,
        market: account.market,
        error: String(error),
      })
      if (mvpMode) break
      continue
    }

    let browser: Awaited<
      ReturnType<typeof openAccountBrowserSessionWithLogin>
    >['browser'] | null = null

    try {
      const session = await openAccountBrowserSessionWithLogin(account, { headless })
      browser = session.browser

      await harvestSingleMarket(session.page, report, market)

      harvestLog('harvest.account_complete', {
        accountId: account.id,
        accountLabel: account.label,
        market: market.name,
        ...mvpModeLogContext(),
      })
      // Un harvest exitoso por corrida es suficiente.
      break
    } catch (error) {
      if (error instanceof HarvestSearchBlockedError) {
        const blockType =
          error.blocker === 'captcha' ? BlockType.CAPTCHA : BlockType.OTHER
        await handleAccountBlock(account.id, error.message, blockType)
        if (!report.blockedMarkets.includes(market.name)) {
          report.blockedMarkets.push(market.name)
        }
        excluded.add(account.id)
        harvestLog('harvest.account_blocked_rotating', {
          accountId: account.id,
          accountLabel: account.label,
          blocker: error.blocker,
          blockType,
        })
        if (mvpMode) break
        continue
      }

      if (
        error instanceof HarvestSessionExpiredError ||
        error instanceof AccountSessionMissingError ||
        error instanceof AccountLoginPrerequisitesError ||
        error instanceof AccountProxyConfigError
      ) {
        await markAccountSessionInvalid(account.id)
        excluded.add(account.id)
        harvestLog('harvest.account_quarantined', {
          accountId: account.id,
          accountLabel: account.label,
          reason: error instanceof Error ? error.message : String(error),
        })
        await sendAlert({
          kind: 'SESSION_EXPIRED',
          title: `Cuenta "${account.label}" fuera de harvest`,
          details: {
            accountId: account.id,
            airbnbEmail: account.airbnbEmail,
            reason: error instanceof Error ? error.message : String(error),
          },
        })
        if (mvpMode) break
        continue
      }

      throw error
    } finally {
      if (browser) {
        await browser.close().catch(() => {})
      }
      report.rotations++
    }
  }
}

/** Modo legado sin cuentas de prospección: usa el archivo de sesión único. */
async function harvestWithLegacySession(report: HarvestReport): Promise<void> {
  const browser = await chromium.launch({
    headless: process.env.HARVEST_HEADED !== 'true',
    ...getChromeChannelOption(),
  })

  try {
    const context = await browser.newContext({
      storageState: AUTH_FILE,
      ...getColombiaContextOptions(),
    })
    const page = await context.newPage()

    const baseUrl = process.env.AIRBNB_BASE_URL ?? 'https://www.airbnb.com.co'
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)

    if (!(await isSessionValid(page))) {
      throw new HarvestSessionExpiredError()
    }

    for (const market of await resolveLegacyMarkets()) {
      await harvestSingleMarket(page, report, market)
    }
  } finally {
    await browser.close()
  }
}

async function resolveLegacyMarkets(): Promise<HarvestMarket[]> {
  const markets = resolveHarvestMarkets()
  const rotate = process.env.HARVEST_ROTATE_MARKETS === 'true'
  if (rotate && markets.length > 1) {
    const index = await getNextMarketIndex(markets.length)
    return [markets[index]]
  }
  return markets
}

async function harvestSingleMarket(
  page: Page,
  report: HarvestReport,
  market: HarvestMarket,
): Promise<void> {
  if (!report.markets.includes(market.name)) {
    report.markets.push(market.name)
  }

  harvestLog('harvest.market', { market: market.name, ...mvpModeLogContext() })

  const { checkin, checkout } = getSearchDates(7)
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
    harvestLog('harvest.market_blocked', {
      market: market.name,
      blocker: searchBlocker,
    })
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
