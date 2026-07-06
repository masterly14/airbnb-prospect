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
import { db } from '@repo/db'
import {
  assertAccountSessionValid,
  openAccountBrowserSession,
} from '../src/accounts/account-browser-session'
import { isMvpSingleAccountMode, loadMvpAccount, mvpModeLogContext } from '../src/accounts/mvp-mode'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const AUTH_FILE = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')
const THREAD_DELAY_MS = Number.parseInt(process.env.INBOUND_THREAD_DELAY_MS ?? '2000', 10)
const BATCH_SIZE = Number.parseInt(process.env.INBOUND_BATCH_SIZE ?? '10', 10)

export type InboundReport = {
  timestamp: string
  mvpMode?: boolean
  accountId?: string
  accountLabel?: string
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

export async function runInbound(
  options: { writeReport?: boolean } = {},
): Promise<InboundReport> {
  const writeReport = options.writeReport ?? true
  const mvpMode = isMvpSingleAccountMode()
  const mvpAccount = mvpMode ? await loadMvpAccount() : null

  if (!mvpMode && !fs.existsSync(AUTH_FILE)) {
    throw new HarvestAuthMissingError()
  }

  const mutexAcquired = await acquirePlaywrightMutex()
  if (!mutexAcquired) {
    throw new HarvestMutexBusyError()
  }

  inboundLog('inbound.start', mvpModeLogContext())

  const report: InboundReport = {
    timestamp: new Date().toISOString(),
    mvpMode,
    accountId: mvpAccount?.id,
    accountLabel: mvpAccount?.label,
    polled: 0,
    inboundNew: 0,
    leadsReplied: 0,
    synced: 0,
    failed: 0,
    leads: [],
  }

  const browser = mvpAccount
    ? null
    : await chromium.launch({
        headless: process.env.INBOUND_HEADED !== 'true',
        ...getChromeChannelOption(),
      })

  try {
    let page

    if (mvpAccount) {
      const session = await openAccountBrowserSession(mvpAccount, {
        headless: process.env.INBOUND_HEADED !== 'true',
      })
      await assertAccountSessionValid(session.page)
      page = session.page

      const sessionBrowser = session.browser
      try {
        await pollInboundLeads(page, report, mvpAccount.id)
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

      await pollInboundLeads(page, report)
    }

    inboundLog('inbound.complete', {
      ...mvpModeLogContext(),
      polled: report.polled,
      inboundNew: report.inboundNew,
      leadsReplied: report.leadsReplied,
    })
  } catch (error) {
    inboundLog('inbound.error', { ...mvpModeLogContext(), error: String(error) })
    throw error
  } finally {
    if (browser) {
      await browser.close()
    }
    await releasePlaywrightMutex()
    await db.$disconnect()
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

async function pollInboundLeads(
  page: Awaited<ReturnType<typeof openAccountBrowserSession>>['page'],
  report: InboundReport,
  prospectAccountId?: string,
): Promise<void> {
  const leads = await findLeadsForInboundPoll(BATCH_SIZE, prospectAccountId)

  if (leads.length === 0) {
    console.log('No leads with threadId eligible for inbound poll.')
  }

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
