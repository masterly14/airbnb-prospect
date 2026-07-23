import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import type { Browser, BrowserContext, Page } from 'playwright'
import {
  AirbnbSendBlockedError,
  sendOutboundMessage,
} from '../src/messaging/airbnb-messaging'
import { buildOutboundMessage } from '../src/messaging/outbound-templates'
import { outboundLog } from '../src/logging/outbound-logger'
import {
  applyOutboundTransition,
  findEligibleOutboundLeads,
  hasEligibleOutboundLeads,
  phaseForStatus,
  recordOutboundMessage,
  registerColdSendFailure,
} from '../src/persistence/outbound-pipeline'
import { getMarketsAtQuota } from '../src/persistence/daily-outbound-stats'
import {
  acquirePlaywrightMutex,
  releasePlaywrightMutex,
  setActivePlaywrightAccount,
} from '../src/persistence/system-state'
import {
  completeWave,
  incrementWaveProgress,
  pickNextAccount,
  startWave,
} from '../src/accounts/account-selector'
import { isMvpSingleAccountMode, mvpModeLogContext } from '../src/accounts/mvp-mode'
import {
  ensureLegacyProspectAccount,
  handleAccountBlock,
  markAccountSessionActive,
  markAccountSessionInvalid,
} from '../src/accounts/account-repository'
import {
  AccountLoginPrerequisitesError,
  isAutoLoginEnabled,
  loginAccountAndSaveSession,
} from '../src/accounts/account-login'
import { OPERATIONS, isLeadOutboundEligible } from '../src/discovery/icp'
import {
  AccountProxyConfigError,
  AccountSessionMissingError,
  accountHasStoredSession,
  createContextForAccount,
  launchBrowserForAccount,
} from '../src/scraping/playwright-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'
import { isSessionValid } from '../src/scraping/session-utils'
import { requestManualSessionRemediation } from '../src/accounts/manual-session-remediation'
import {
  HarvestAuthMissingError,
  HarvestMutexBusyError,
  HarvestSessionExpiredError,
} from '../src/harvest/errors'
import { db, ContactSource, LeadStatus, type Lead, type ProspectAccount } from '@repo/db'
import {
  assertColdOutboundAllowed,
  markHostContacted,
  type ContactBlockReason,
} from '@repo/lead-contact'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const LEGACY_AUTH_FILE = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')
const LEAD_DELAY_MS = Number.parseInt(process.env.OUTBOUND_LEAD_DELAY_MS ?? '3000', 10)
// Fallos consecutivos (no bloqueos) antes de rotar de cuenta: cada fallo es
// una interacción visible para Airbnb; insistir quema la cuenta.
const MAX_CONSECUTIVE_FAILURES = Number.parseInt(
  process.env.OUTBOUND_MAX_CONSECUTIVE_FAILURES ?? '3',
  10,
)

export type OutboundReport = {
  timestamp: string
  mvpMode?: boolean
  accountId?: string
  accountLabel?: string
  accountsUsed: string[]
  accountsSkipped: Array<{ accountId: string; reason: string }>
  wavesCompleted: number
  rotations: number
  blocked?: boolean
  blockType?: string
  sent: number
  failed: number
  skipped: number
  skippedAlreadyContacted: number
  byPhase: Record<string, number>
  leads: Array<{
    leadId: string
    name: string
    phase?: string
    accountId?: string
    action: 'sent' | 'failed' | 'skipped'
    error?: string
    contactBlockReason?: ContactBlockReason | 'existing_thread'
  }>
}

async function ensureAtLeastOneAccount(): Promise<void> {
  const total = await db.prospectAccount.count()
  if (total > 0) return

  if (fs.existsSync(LEGACY_AUTH_FILE)) {
    await ensureLegacyProspectAccount(LEGACY_AUTH_FILE)
    return
  }

  throw new HarvestAuthMissingError()
}

/**
 * Auto-login por cuenta: cuando no hay sesión válida en disco, reintenta el
 * login completo de Airbnb usando las credenciales de la cuenta y su Gmail de
 * Composio para el OTP. Devuelve un contexto listo o `null` si no procede
 * (auto-login desactivado o faltan prerequisitos), dejando que el caller
 * ponga la cuenta en cuarentena.
 */
async function attemptAccountAutoLogin(
  browser: Browser,
  account: ProspectAccount,
): Promise<{ context: BrowserContext; page: Page } | null> {
  if (!isAutoLoginEnabled()) {
    outboundLog('account.auto_login_disabled', { accountId: account.id })
    return null
  }

  try {
    const { context, page, sessionPath } = await loginAccountAndSaveSession(browser, account)
    await markAccountSessionActive(account.id, sessionPath)
    return { context, page }
  } catch (error) {
    if (error instanceof AccountLoginPrerequisitesError) {
      outboundLog('account.auto_login_skipped', {
        accountId: account.id,
        reason: error.message,
      })
      return null
    }
    // Login abierto que falló (OTP no llegó, captcha, etc.): no reventar el run
    // completo; que el caller ponga la cuenta en cuarentena y siga con otras.
    outboundLog('account.auto_login_error', {
      accountId: account.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function prepareAccountContext(
  browser: Browser,
  account: ProspectAccount,
): Promise<{ context: BrowserContext; page: Page }> {
  await setActivePlaywrightAccount(account.id)
  await startWave(account.id)

  const hasSession = accountHasStoredSession(account)

  if (hasSession) {
    const context = await createContextForAccount(browser, account)
    const page = await context.newPage()

    const baseUrl = process.env.AIRBNB_BASE_URL ?? 'https://www.airbnb.com.co'
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)

    if (await isSessionValid(page)) {
      return { context, page }
    }

    // Sesión en disco pero expirada: cerrar y reintentar login limpio.
    await context.close()
    outboundLog('account.session_expired_retry_login', { accountId: account.id })
  }

  const reloggedIn = await attemptAccountAutoLogin(browser, account)
  if (reloggedIn) {
    return reloggedIn
  }

  throw new HarvestSessionExpiredError()
}

/**
 * Sesión inválida o proxy roto: sacar la cuenta de rotación, alertar y dejar
 * que el run continúe con las demás cuentas en cascada.
 */
async function quarantineAccount(
  account: ProspectAccount,
  reason: string,
  report: OutboundReport,
): Promise<void> {
  await markAccountSessionInvalid(account.id)
  report.accountsSkipped.push({ accountId: account.id, reason })

  outboundLog('outbound.account_quarantined', {
    accountId: account.id,
    accountLabel: account.label,
    reason,
  })

  await requestManualSessionRemediation({
    account,
    reason: 'session_expired',
    message: reason,
    job: 'outbound',
  })
}

async function sendLeadWithAccount(
  page: Page,
  lead: Lead,
  account: ProspectAccount,
  report: OutboundReport,
): Promise<'sent' | 'failed' | 'blocked' | 'skipped'> {
  const coldCheck = await assertColdOutboundAllowed(db, lead.id, {
    isIcpEligible: isLeadOutboundEligible,
  })

  if (!coldCheck.allowed && lead.status === LeadStatus.LEAD_DISCOVERED) {
    report.skipped++
    if (coldCheck.reason !== 'icp_ineligible') {
      report.skippedAlreadyContacted++
    }
    report.leads.push({
      leadId: lead.id,
      name: lead.name,
      accountId: account.id,
      action: 'skipped',
      error: coldCheck.reason === 'icp_ineligible' ? 'icp_ineligible' : 'already_contacted',
      contactBlockReason: coldCheck.reason,
    })
    outboundLog('outbound.skip.already_contacted', {
      leadId: lead.id,
      reason: coldCheck.reason,
      accountId: account.id,
    })
    return 'skipped'
  }

  const freshLead = coldCheck.allowed ? coldCheck.lead : await db.lead.findUniqueOrThrow({ where: { id: lead.id } })
  const phase = phaseForStatus(freshLead.status)

  if (!phase) {
    report.skipped++
    report.leads.push({
      leadId: freshLead.id,
      name: freshLead.name,
      accountId: account.id,
      action: 'skipped',
      error: `No outbound phase for status ${freshLead.status}`,
    })
    outboundLog('outbound.skipped', { leadId: freshLead.id, status: freshLead.status, accountId: account.id })
    return 'skipped'
  }

  const text = buildOutboundMessage(freshLead, phase)
  const isCold = freshLead.status === LeadStatus.LEAD_DISCOVERED

  let result
  try {
    result = await sendOutboundMessage(page, freshLead, text, isCold, phase, {
      prospectAccountId: account.id,
    })

    const nonRetryable =
      result.skippedReason === 'existing_thread' || result.error === 'listing_not_contactable'
    if (!result.success && !nonRetryable) {
      result = await sendOutboundMessage(page, freshLead, text, isCold, phase, {
        prospectAccountId: account.id,
      })
    }
  } catch (error) {
    if (error instanceof AirbnbSendBlockedError) {
      await handleAccountBlock(account.id, error.message, error.blockType)
      report.blocked = true
      report.blockType = error.blockType
      report.failed++
      report.leads.push({
        leadId: lead.id,
        name: lead.name,
        phase,
        accountId: account.id,
        action: 'failed',
        error: error.message,
      })
      outboundLog('outbound.blocked', {
        accountId: account.id,
        blockType: error.blockType,
        message: error.message,
      })
      return 'blocked'
    }
    throw error
  }

  if (!result.success) {
    if (result.skippedReason === 'existing_thread' || result.error === 'existing_thread') {
      report.skipped++
      report.skippedAlreadyContacted++
      report.leads.push({
        leadId: freshLead.id,
        name: freshLead.name,
        phase,
        accountId: account.id,
        action: 'skipped',
        error: 'existing_thread',
        contactBlockReason: 'existing_thread',
      })
      outboundLog('outbound.skip.already_contacted', {
        leadId: freshLead.id,
        reason: 'existing_thread',
        threadId: result.threadId,
        accountId: account.id,
      })
      return 'skipped'
    }

    report.failed++
    report.leads.push({
      leadId: freshLead.id,
      name: freshLead.name,
      phase,
      accountId: account.id,
      action: 'failed',
      error: result.error,
    })

    if (isCold) {
      const failure = await registerColdSendFailure(freshLead.id, result.error ?? 'unknown')
      outboundLog('outbound.cold_send_failure', {
        leadId: freshLead.id,
        accountId: account.id,
        failures: failure.failures,
        quarantined: failure.quarantined,
        error: result.error,
      })
    }

    return 'failed'
  }

  if (!result.threadId && isCold) {
    report.failed++
    report.leads.push({
      leadId: freshLead.id,
      name: freshLead.name,
      phase,
      accountId: account.id,
      action: 'failed',
      error: 'threadId not captured after cold send',
    })
    return 'failed'
  }

  const sentAt = new Date()
  await recordOutboundMessage(freshLead.id, text, phase, {
    prospectAccountId: account.id,
    market: freshLead.market,
  })
  await applyOutboundTransition(freshLead.id, phase, {
    content: text,
    sentAt,
    threadId: result.threadId ?? freshLead.threadId,
  })
  if (isCold) {
    const updatedLead = await db.lead.findUniqueOrThrow({ where: { id: freshLead.id } })
    await markHostContacted(db, {
      lead: updatedLead,
      source: ContactSource.OUTBOUND,
      firstContactAccountId: account.id,
      firstContactedAt: sentAt,
    })
  }
  await incrementWaveProgress(account.id)

  report.sent++
  report.byPhase[phase] = (report.byPhase[phase] ?? 0) + 1
  report.leads.push({
    leadId: freshLead.id,
    name: freshLead.name,
    phase,
    accountId: account.id,
    action: 'sent',
  })

  await page.waitForTimeout(LEAD_DELAY_MS)
  return 'sent'
}

export async function runOutbound(
  options: { writeReport?: boolean; disconnectDb?: boolean } = {},
): Promise<OutboundReport> {
  const writeReport = options.writeReport ?? true
  const disconnectDb = options.disconnectDb ?? true

  const mutexAcquired = await acquirePlaywrightMutex()
  if (!mutexAcquired) {
    throw new HarvestMutexBusyError()
  }

  const report: OutboundReport = {
    timestamp: new Date().toISOString(),
    mvpMode: isMvpSingleAccountMode(),
    accountsUsed: [],
    accountsSkipped: [],
    wavesCompleted: 0,
    rotations: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    skippedAlreadyContacted: 0,
    byPhase: {},
    leads: [],
  }

  // Leads fallidos/saltados y cuentas en cuarentena dentro de este run.
  const excludedLeadIds = new Set<string>()
  const excludedAccountIds = new Set<string>()

  try {
    outboundLog('outbound.start', mvpModeLogContext())
    await ensureAtLeastOneAccount()

    while (await hasEligibleOutboundLeads({ excludeLeadIds: [...excludedLeadIds] })) {
      const account = await pickNextAccount({ excludeAccountIds: [...excludedAccountIds] })
      if (!account) {
        outboundLog('outbound.no_accounts', {
          ...mvpModeLogContext(),
          quarantined: excludedAccountIds.size,
        })
        break
      }

      report.accountId = account.id
      report.accountLabel = account.label
      if (!report.accountsUsed.includes(account.id)) {
        report.accountsUsed.push(account.id)
      }

      // Evita relanzar browser en bucle cuando hay leads globales (p. ej. Bogotá)
      // pero ninguno para el market de esta cuenta (p. ej. Legacy = Medellín).
      {
        const marketsAtQuota = await getMarketsAtQuota()
        const preview = await findEligibleOutboundLeads(1, {
          excludeMarketsAtQuota: marketsAtQuota,
          excludeLeadIds: [...excludedLeadIds],
          market: account.market ?? undefined,
        })
        if (preview.length === 0) {
          excludedAccountIds.add(account.id)
          outboundLog('outbound.no_leads_for_account', {
            accountId: account.id,
            accountLabel: account.label,
            market: account.market,
          })
          continue
        }
      }

      let browser: Browser | null = null
      let sentInWave = 0

      try {
        browser = await launchBrowserForAccount(account, {
          headless: process.env.OUTBOUND_HEADED !== 'true',
          job: 'outbound',
        })
        const { page } = await prepareAccountContext(browser, account)

        let consecutiveFailures = 0
        const maxSends = Math.min(
          OPERATIONS.MSGS_PER_WAVE,
          Number.parseInt(process.env.OUTBOUND_MAX_SENDS ?? String(OPERATIONS.MSGS_PER_WAVE), 10),
        )

        while (sentInWave < maxSends) {
          const marketsAtQuota = await getMarketsAtQuota()
          const leads = await findEligibleOutboundLeads(1, {
            excludeMarketsAtQuota: marketsAtQuota,
            excludeLeadIds: [...excludedLeadIds],
            market: account.market ?? undefined,
          })

          if (leads.length === 0) {
            excludedAccountIds.add(account.id)
            outboundLog('outbound.no_leads_for_account', {
              accountId: account.id,
              accountLabel: account.label,
              market: account.market,
              sentInWave,
            })
            break
          }

          const outcome = await sendLeadWithAccount(page, leads[0], account, report)

          if (outcome === 'blocked') break

          if (outcome === 'sent') {
            sentInWave++
            consecutiveFailures = 0
            continue
          }

          excludedLeadIds.add(leads[0].id)

          if (outcome === 'failed') {
            consecutiveFailures++
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              outboundLog('outbound.failure_cap', {
                accountId: account.id,
                consecutiveFailures,
              })
              break
            }
          }
        }

        if (sentInWave >= OPERATIONS.MSGS_PER_WAVE) {
          await completeWave(account.id)
          report.wavesCompleted++
          outboundLog('outbound.wave_complete', { accountId: account.id, sentInWave })
        }
      } catch (error) {
        if (
          error instanceof HarvestSessionExpiredError ||
          error instanceof AccountSessionMissingError ||
          error instanceof AccountProxyConfigError
        ) {
          excludedAccountIds.add(account.id)
          await quarantineAccount(
            account,
            error instanceof Error ? error.message : String(error),
            report,
          )
          if (isMvpSingleAccountMode()) break
          continue
        }
        throw error
      } finally {
        if (browser) {
          await browser.close()
        }
        report.rotations++
      }

      // MVP: una sola cuenta — no rotar a otras aunque queden leads en cola.
      if (isMvpSingleAccountMode()) break
    }

    outboundLog('outbound.complete', {
      sent: report.sent,
      failed: report.failed,
      skipped: report.skipped,
      skippedAlreadyContacted: report.skippedAlreadyContacted,
      accountsUsed: report.accountsUsed.length,
      accountsSkipped: report.accountsSkipped.length,
      wavesCompleted: report.wavesCompleted,
    })
  } catch (error) {
    outboundLog('outbound.error', { error: String(error) })
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
    const reportPath = path.join(reportsDir, `outbound-${Date.now()}.json`)
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`Outbound report written to ${reportPath}`)
  }

  return report
}

if (require.main === module) {
  runOutbound().catch((error) => {
    console.error('outbound-run failed:', error)
    process.exit(1)
  })
}
