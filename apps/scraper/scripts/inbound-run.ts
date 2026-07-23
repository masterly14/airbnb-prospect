import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { pollLeadThread } from '../src/messaging/airbnb-inbox'
import { inboundLog } from '../src/logging/inbound-logger'
import { findLeadsForInboundPoll } from '../src/persistence/inbound-pipeline'
import {
  acquirePlaywrightMutex,
  releasePlaywrightMutex,
} from '../src/persistence/system-state'
import {
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../src/scraping/airbnb-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'
import { isSessionValid } from '../src/scraping/session-utils'
import {
  HarvestAuthMissingError,
  HarvestMutexBusyError,
  HarvestSessionExpiredError,
} from '../src/harvest/errors'
import { db, type ProspectAccount } from '@repo/db'
import {
  openAccountBrowserSession,
  openAccountBrowserSessionWithLogin,
} from '../src/accounts/account-browser-session'
import { listInboundAccounts } from '../src/accounts/account-selector'
import { isMvpSingleAccountMode, mvpModeLogContext } from '../src/accounts/mvp-mode'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const AUTH_FILE = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')
const THREAD_DELAY_MS = Number.parseInt(process.env.INBOUND_THREAD_DELAY_MS ?? '2000', 10)
const BATCH_SIZE = Number.parseInt(process.env.INBOUND_BATCH_SIZE ?? '10', 10)

export type InboundReport = {
  timestamp: string
  mvpMode?: boolean
  accountId?: string
  accountLabel?: string
  accountsPolled: string[]
  polled: number
  inboundNew: number
  leadsReplied: number
  synced: number
  failed: number
  leads: Array<{
    leadId: string
    name: string
    inboundNew: number
    replied: boolean
    error?: string
  }>
}

export type RunInboundOptions = {
  writeReport?: boolean
  /** Cierra la conexión Prisma al terminar (default true). El daemon lo desactiva. */
  disconnectDb?: boolean
}

export async function runInbound(options: RunInboundOptions = {}): Promise<InboundReport> {
  const writeReport = options.writeReport ?? true
  const disconnectDb = options.disconnectDb ?? true
  const mvpMode = isMvpSingleAccountMode()

  const mutexAcquired = await acquirePlaywrightMutex()
  if (!mutexAcquired) {
    throw new HarvestMutexBusyError()
  }

  inboundLog('inbound.start', mvpModeLogContext())

  const report: InboundReport = {
    timestamp: new Date().toISOString(),
    mvpMode,
    accountsPolled: [],
    polled: 0,
    inboundNew: 0,
    leadsReplied: 0,
    synced: 0,
    failed: 0,
    leads: [],
  }

  try {
    const accounts = await listInboundAccounts()

    if (accounts.length > 0) {
      report.accountId = accounts[0].id
      report.accountLabel = accounts[0].label
      for (const account of accounts) {
        await pollAccountInbox(account, report)
      }
    } else {
      // Modo legado sin cuentas de prospección: sesión única en disco.
      if (!fs.existsSync(AUTH_FILE)) {
        throw new HarvestAuthMissingError()
      }
      await pollLegacyInbox(report)
    }

    inboundLog('inbound.complete', {
      ...mvpModeLogContext(),
      accountsPolled: report.accountsPolled.length,
      polled: report.polled,
      inboundNew: report.inboundNew,
      leadsReplied: report.leadsReplied,
    })
  } catch (error) {
    inboundLog('inbound.error', { ...mvpModeLogContext(), error: String(error) })
    throw error
  } finally {
    await releasePlaywrightMutex()
    if (disconnectDb) {
      await db.$disconnect()
    }
  }

  if (writeReport) {
    const reportsDir = path.resolve(__dirname, '../reports')
    fs.mkdirSync(reportsDir, { recursive: true })
    const reportPath = path.join(reportsDir, `inbound-${Date.now()}.json`)
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`Inbound report written to ${reportPath}`)
  }

  return report
}

/** Poll del inbox de una cuenta usando su propia sesión (con auto-login si expiró). */
async function pollAccountInbox(
  account: ProspectAccount,
  report: InboundReport,
): Promise<void> {
  const leads = await findLeadsForInboundPoll(BATCH_SIZE, account.id)
  if (leads.length === 0) return

  let session
  try {
    session = await openAccountBrowserSessionWithLogin(account, {
      headless: process.env.INBOUND_HEADED !== 'true',
      job: 'inbound',
    })
  } catch (error) {
    inboundLog('inbound.account_session_failed', {
      accountId: account.id,
      accountLabel: account.label,
      error: error instanceof Error ? error.message : String(error),
    })
    // No reventar el poll de las demás cuentas por una sesión caída.
    return
  }

  report.accountsPolled.push(account.id)

  try {
    await pollLeadThreads(session.page, report, leads)
  } finally {
    await session.browser.close().catch(() => {})
  }
}

/** Modo legado: sesión única `airbnb-session.json`, sin cuentas de prospección. */
async function pollLegacyInbox(report: InboundReport): Promise<void> {
  const browser = await chromium.launch({
    headless: process.env.INBOUND_HEADED !== 'true',
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

    const leads = await findLeadsForInboundPoll(BATCH_SIZE)
    await pollLeadThreads(page, report, leads)
  } finally {
    await browser.close()
  }
}

async function pollLeadThreads(
  page: Awaited<ReturnType<typeof openAccountBrowserSession>>['page'],
  report: InboundReport,
  leads: Awaited<ReturnType<typeof findLeadsForInboundPoll>>,
): Promise<void> {
  for (const lead of leads) {
    report.polled++

    let result = await pollLeadThread(page, lead)
    if (!result.success) {
      result = await pollLeadThread(page, lead)
    }

    if (!result.success) {
      report.failed++
      report.leads.push({
        leadId: lead.id,
        name: lead.name,
        inboundNew: 0,
        replied: false,
        error: result.error,
      })
      continue
    }

    report.inboundNew += result.inboundNew
    report.synced += result.outboundSynced
    if (result.replied) report.leadsReplied++

    report.leads.push({
      leadId: lead.id,
      name: lead.name,
      inboundNew: result.inboundNew,
      replied: result.replied,
    })

    await page.waitForTimeout(THREAD_DELAY_MS)
  }
}

if (require.main === module) {
  runInbound().catch((error) => {
    console.error('inbound-run failed:', error)
    process.exit(1)
  })
}
