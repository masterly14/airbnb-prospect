/**
 * Sincroniza el inbox de una o varias cuentas de prospección manuales con el CRM.
 *
 * Motivación (ver docs/OPERACION-PROSPECCION.md §2.4 Tracking):
 *   Hay cuentas que prospectaron a mano. Si el sistema automático les vuelve a
 *   escribir, perdemos mensajes y tiempo. Este script recorre el inbox real de
 *   cada cuenta, reconstruye cada conversación en Neon y deja un ESTADO por
 *   prospecto (analizado por IA) para que el pipeline no vuelva a contactarlos
 *   por error.
 *
 * IMPORTANTE: este script es SOLO LECTURA sobre Airbnb. Nunca envía mensajes.
 *   - Por defecto opera SIN proxy de cuenta (red directa); independiente de IP
 *     residencial. Usa storageState + auto-login si la sesión expiró.
 *   - Lista los threads de /guest/messages.
 *   - Resuelve el hostAirbnbId de cada conversación.
 *   - Upserta el Lead y sincroniza el historial de mensajes.
 *   - Si el host ya respondió, la IA (Triaje) clasifica la conversación y se
 *     fija un LeadStatus. Los que interactuaron van a HUMAN_TAKEOVER (para que
 *     un humano continúe el hilo manual); los rechazos a CLOSED_LOST; los que
 *     aún no responden a INITIAL_MSG_SENT.
 *
 * Uso:
 *   npx tsx apps/scraper/scripts/sync-account-conversations.ts [accountId...] [--headed] [--headless] [--max N] [--no-ai] [--use-account-proxy]
 *
 * Sin sesión en disco abre Chromium visible por defecto (SYNC_HEADED=false para desactivar).
 *
 * Sin argumentos usa las dos cuentas manuales conocidas.
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import type { Page } from 'playwright'
import { db, ContactSource, LeadStatus, MessageDirection, type Lead, type ProspectAccount } from '@repo/db'
import {
  extractListingIdsFromText,
  legacyThreadHostId,
  listingHostId,
  markHostContacted,
  isLeadContacted,
  registerIdentityAlias,
  threadHostId,
} from '@repo/lead-contact'
import { getAirbnbBaseUrl } from '../src/scraping/airbnb-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'
import { parseHostAirbnbId, normalizeProfileUrl } from '../src/scraping/airbnb-host'
import { scrapeThreadMessages, collectInboxThreads } from '../src/messaging/airbnb-inbox'
import { syncThreadMessages } from '../src/persistence/inbound-pipeline'
import {
  findDuplicateLeadForCanonicalHost,
  mergeLeadIntoCanonical,
} from '../src/persistence/lead-identity-merge'
import { runTriage, type TriageResult } from '@repo/ai'
import { classifyHostReply } from '../src/conversation/reply-intent'
import { hydrateLeadAgentContext } from '../src/conversation/lead-agent-context'
import {
  getSyncAccountDelayMs,
  openSyncAccountSession,
  type SyncNetworkMode,
  type SyncSessionSource,
} from '../src/sync/sync-playwright-context'
import {
  acquirePlaywrightMutex,
  releasePlaywrightMutex,
} from '../src/persistence/system-state'
import {
  DEFAULT_MVP_ACCOUNT_ID,
  resolveDefaultSyncAccountIds,
} from '../src/accounts/mvp-mode'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

/** Cuentas manuales conocidas (default si no se pasan argumentos y no hay MVP). */
const LEGACY_DEFAULT_ACCOUNT_IDS = [
  DEFAULT_MVP_ACCOUNT_ID,
  'a23d0b7c-3998-406a-a7b5-0445760f6ef3',
]

/** Cuántos threads del inbox procesar por cuenta como máximo. */
const DEFAULT_MAX_THREADS = Number.parseInt(process.env.SYNC_MAX_THREADS ?? '200', 10)

type ThreadRef = {
  url: string
  rawText: string
  hostName: string
  threadId?: string
}

type SyncThreadOutcome = {
  threadUrl: string
  hostName: string
  hostAirbnbId: string | null
  leadId?: string
  hostReplied: boolean
  inboundNew: number
  outboundSynced: number
  status?: LeadStatus
  triageIntent?: string
  aiFallback?: boolean
  action: 'created' | 'updated' | 'skipped_terminal' | 'error'
  error?: string
}

type AccountSyncReport = {
  accountId: string
  label: string
  networkMode: SyncNetworkMode
  sessionSource: SyncSessionSource
  threadsFound: number
  processed: number
  created: number
  updated: number
  errors: number
  threads: SyncThreadOutcome[]
}

function parseArgs() {
  const args = process.argv.slice(2)
  const headed =
    !args.includes('--headless') &&
    (args.includes('--headed') ||
      process.env.SYNC_HEADED === 'true' ||
      process.env.INBOUND_HEADED === 'true')
  const useAi = !args.includes('--no-ai')
  const useAccountProxy = args.includes('--use-account-proxy')

  const maxIdx = args.indexOf('--max')
  const maxThreads =
    maxIdx >= 0 && args[maxIdx + 1]
      ? Number.parseInt(args[maxIdx + 1], 10)
      : DEFAULT_MAX_THREADS

  const positional = args.filter((a, i) => {
    if (a.startsWith('--')) return false
    if (maxIdx >= 0 && i === maxIdx + 1) return false
    return true
  })

  const accountIds =
    positional.length > 0
      ? positional
      : resolveDefaultSyncAccountIds(LEGACY_DEFAULT_ACCOUNT_IDS)
  return { headed, useAi, useAccountProxy, maxThreads, accountIds }
}

type SyncOptions = {
  headed: boolean
  useAi: boolean
  useAccountProxy: boolean
  maxThreads: number
}

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Lista los threads del inbox vía collectInboxThreads (data-testid inbox_list_*). */
async function listInboxThreads(page: Page, maxThreads: number): Promise<ThreadRef[]> {
  const threads = await collectInboxThreads(page, maxThreads)
  return threads.map((t) => ({
    url: t.url,
    rawText: t.rawText,
    hostName: t.hostName,
    threadId: t.threadId,
  }))
}

/** Extrae el hostAirbnbId buscando links a /users/show/{id} en DOM y HTML. */
async function extractHostAirbnbId(page: Page): Promise<{ id: string; profileUrl: string } | null> {
  const hrefs = await page.locator('a[href*="/users/show/"]').evaluateAll((anchors) =>
    anchors
      .map((anchor) => anchor.getAttribute('href') ?? '')
      .filter(Boolean),
  )

  for (const href of hrefs) {
    const id = parseHostAirbnbId(href)
    if (id) {
      return {
        id,
        profileUrl: normalizeProfileUrl(href),
      }
    }
  }

  const html = await page.content()
  const id = parseHostAirbnbId(html)
  if (!id) return null

  const match = html.match(/\/users\/show\/\d+/)
  const profileUrl = match ? normalizeProfileUrl(match[0]) : `${getAirbnbBaseUrl()}/users/show/${id}`
  return { id, profileUrl }
}

async function upsertLeadForThread(
  thread: ThreadRef,
  host: { id: string; profileUrl: string } | null,
): Promise<{ lead: Lead; created: boolean }> {
  const existingByThread = await db.lead.findUnique({ where: { threadId: thread.url } })
  if (existingByThread) {
    return { lead: existingByThread, created: false }
  }

  const threadShortId = thread.url.split('/').pop() ?? thread.url

  if (host) {
    const duplicate = await findDuplicateLeadForCanonicalHost(host.id, thread.url, thread.url)
    const existingByHost = await db.lead.findUnique({ where: { hostAirbnbId: host.id } })
    const target = existingByHost ?? duplicate

    if (target) {
      if (duplicate && duplicate.id !== target.id && duplicate.hostAirbnbId !== host.id) {
        const merged = await mergeLeadIntoCanonical(target, duplicate, host.id)
        const updated = await db.lead.update({
          where: { id: merged.id },
          data: { threadId: thread.url },
        })
        return { lead: updated, created: false }
      }

      const updated = await db.lead.update({
        where: { id: target.id },
        data: { threadId: thread.url },
      })
      return { lead: updated, created: false }
    }
  }

  const legacyHostId = legacyThreadHostId(threadShortId)
  const normalizedThreadHostId = threadHostId(threadShortId)
  const existingByLegacy = await db.lead.findFirst({
    where: {
      OR: [
        { hostAirbnbId: legacyHostId },
        { hostAirbnbId: normalizedThreadHostId },
      ],
    },
  })
  if (existingByLegacy) {
    const updated = await db.lead.update({
      where: { id: existingByLegacy.id },
      data: { threadId: thread.url },
    })
    return { lead: updated, created: false }
  }

  const hostAirbnbId = host?.id ?? normalizedThreadHostId
  const hostProfileUrl = host?.profileUrl ?? thread.url

  const created = await db.lead.create({
    data: {
      hostAirbnbId,
      threadId: thread.url,
      name: thread.hostName,
      hostProfileUrl,
      primaryListingUrl: thread.url,
      primaryListingName: null,
      totalProperties: 1,
      status: LeadStatus.LEAD_DISCOVERED,
    },
  })

  if (!host) {
    await registerIdentityAlias(db, {
      aliasId: legacyHostId,
      canonicalId: normalizedThreadHostId,
      leadId: created.id,
    })
  }

  return { lead: created, created: true }
}

async function enrichLeadListingAliases(
  page: Page,
  lead: Lead,
  scrapedMessageText: string,
): Promise<Lead> {
  const html = await page.content()
  const listingIds = new Set(extractListingIdsFromText(`${html}\n${scrapedMessageText}`))
  let primaryListingUrl = lead.primaryListingUrl
  let updatedLead = lead

  for (const listingId of listingIds) {
    await registerIdentityAlias(db, {
      aliasId: listingHostId(listingId),
      canonicalId: lead.hostAirbnbId,
      leadId: lead.id,
    })

    const listingUrl = `${getAirbnbBaseUrl()}/rooms/${listingId}`
    if (primaryListingUrl.includes('/guest/messages/')) {
      primaryListingUrl = listingUrl
    }
  }

  if (primaryListingUrl !== lead.primaryListingUrl) {
    updatedLead = await db.lead.update({
      where: { id: lead.id },
      data: { primaryListingUrl },
    })
  }

  return updatedLead
}

async function attributeMessagesToAccount(leadId: string, accountId: string): Promise<void> {
  await db.message.updateMany({
    where: { leadId, prospectAccountId: null },
    data: { prospectAccountId: accountId },
  })
}

async function classifyConversation(
  leadId: string,
  useAi: boolean,
): Promise<{ triage?: TriageResult; intent: string; fallback: boolean }> {
  if (useAi) {
    try {
      const context = await hydrateLeadAgentContext(leadId)
      if (context) {
        const triage = await runTriage(context)
        return { triage, intent: triage.intent, fallback: false }
      }
    } catch (error) {
      log('sync.triage.fallback', {
        leadId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const lastInbound = await db.message.findFirst({
    where: { leadId, direction: MessageDirection.INBOUND },
    orderBy: { sentAt: 'desc' },
  })
  const regex = classifyHostReply(lastInbound?.content ?? '')
  const intentMap: Record<string, string> = {
    interested: 'INTERESADO',
    rejected: 'RECHAZO',
    ambiguous: 'AMBIGUO',
  }
  return { intent: intentMap[regex.intent] ?? 'AMBIGUO', fallback: true }
}

function resolveStatus(
  intent: string,
  triage: TriageResult | undefined,
  hostReplied: boolean,
): LeadStatus {
  if (!hostReplied) return LeadStatus.INITIAL_MSG_SENT
  if (intent === 'RECHAZO' || triage?.shouldCloseLead) return LeadStatus.CLOSED_LOST
  return LeadStatus.HUMAN_TAKEOVER
}

async function applyManualSyncState(
  leadId: string,
  status: LeadStatus,
  summary: string,
  accountId: string,
): Promise<void> {
  await db.message.create({
    data: {
      leadId,
      direction: MessageDirection.SYSTEM,
      content: `Sync inbox manual — ${summary}`,
      aiIntent: 'MANUAL_SYNC',
    },
  })

  const updated = await db.lead.update({
    where: { id: leadId },
    data: {
      status,
      nextFollowUpAt: null,
      lastContactedAt: new Date(),
    },
  })

  if (isLeadContacted(updated)) {
    await markHostContacted(db, {
      lead: updated,
      source: ContactSource.MANUAL_SYNC,
      firstContactAccountId: accountId,
    })
  }
}

async function tagLatestInbound(leadId: string, intent: string): Promise<void> {
  const latest = await db.message.findFirst({
    where: { leadId, direction: MessageDirection.INBOUND },
    orderBy: { sentAt: 'desc' },
  })
  if (latest && !latest.aiIntent) {
    await db.message.update({ where: { id: latest.id }, data: { aiIntent: intent } })
  }
}

async function syncThread(
  page: Page,
  account: ProspectAccount,
  thread: ThreadRef,
  useAi: boolean,
): Promise<SyncThreadOutcome> {
  const outcome: SyncThreadOutcome = {
    threadUrl: thread.url,
    hostName: thread.hostName,
    hostAirbnbId: null,
    hostReplied: false,
    inboundNew: 0,
    outboundSynced: 0,
    action: 'updated',
  }

  try {
    await page.goto(thread.url, { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)
    await page.waitForTimeout(1_500)

    const host = await extractHostAirbnbId(page)
    outcome.hostAirbnbId = host?.id ?? null
    if (!host) {
      log('sync.host_id_unresolved', { threadUrl: thread.url, hostName: thread.hostName })
    }

    let { lead, created } = await upsertLeadForThread(thread, host)
    outcome.leadId = lead.id
    outcome.action = created ? 'created' : 'updated'

    if (lead.status === LeadStatus.CLOSED_WON) {
      outcome.action = 'skipped_terminal'
      outcome.status = lead.status
      return outcome
    }

    const leadForScrape: Lead = { ...lead, threadId: thread.url }
    const scraped = await scrapeThreadMessages(page, leadForScrape)
    const sync = await syncThreadMessages(lead.id, scraped)
    outcome.inboundNew = sync.inboundNew
    outcome.outboundSynced = sync.outboundSynced

    const scrapedText = scraped.map((message) => message.content).join('\n')
    lead = await enrichLeadListingAliases(page, lead, scrapedText)

    await attributeMessagesToAccount(lead.id, account.id)

    const inboundCount = await db.message.count({
      where: { leadId: lead.id, direction: MessageDirection.INBOUND },
    })
    const hostReplied = inboundCount > 0
    outcome.hostReplied = hostReplied

    if (!hostReplied) {
      await applyManualSyncState(
        lead.id,
        LeadStatus.INITIAL_MSG_SENT,
        'contacto manual enviado; host aún no responde',
        account.id,
      )
      outcome.status = LeadStatus.INITIAL_MSG_SENT
      return outcome
    }

    const { triage, intent, fallback } = await classifyConversation(lead.id, useAi)
    outcome.triageIntent = intent
    outcome.aiFallback = fallback

    const status = resolveStatus(intent, triage, hostReplied)
    const reason = triage?.reason ?? `clasificación ${fallback ? 'regex' : 'IA'}: ${intent}`
    const summary = `intent=${intent}${triage?.confidence ? ` conf=${triage.confidence}` : ''} → ${status}. ${reason}`

    await tagLatestInbound(lead.id, intent)
    await applyManualSyncState(lead.id, status, summary, account.id)
    outcome.status = status

    return outcome
  } catch (error) {
    outcome.action = 'error'
    outcome.error = error instanceof Error ? error.message : String(error)
    return outcome
  }
}

async function syncAccount(
  accountId: string,
  options: SyncOptions,
): Promise<AccountSyncReport> {
  const account = await db.prospectAccount.findUnique({ where: { id: accountId } })
  if (!account) {
    throw new Error(`ProspectAccount no encontrada: ${accountId}`)
  }

  const report: AccountSyncReport = {
    accountId: account.id,
    label: account.label,
    networkMode: 'direct',
    sessionSource: 'reused',
    threadsFound: 0,
    processed: 0,
    created: 0,
    updated: 0,
    errors: 0,
    threads: [],
  }

  log('sync.account.start', { accountId: account.id, label: account.label })

  const session = await openSyncAccountSession(
    account,
    { headed: options.headed, useAccountProxy: options.useAccountProxy },
    log,
  )

  report.networkMode = session.networkMode
  report.sessionSource = session.sessionSource

  const { browser, page } = session

  try {
    const threads = await listInboxThreads(page, options.maxThreads)
    report.threadsFound = threads.length
    log('sync.account.threads', { accountId: account.id, count: threads.length })

    for (const thread of threads) {
      const outcome = await syncThread(page, account, thread, options.useAi)
      report.threads.push(outcome)
      report.processed++

      if (outcome.action === 'created') report.created++
      else if (outcome.action === 'updated') report.updated++
      if (outcome.action === 'error') report.errors++

      log('sync.thread.done', {
        accountId: account.id,
        host: outcome.hostName,
        hostAirbnbId: outcome.hostAirbnbId,
        status: outcome.status,
        intent: outcome.triageIntent,
        action: outcome.action,
        error: outcome.error,
      })

      await page.waitForTimeout(1_500)
    }
  } finally {
    if (options.headed) {
      await sleep(5_000)
    }
    await browser.close()
  }

  log('sync.account.complete', {
    accountId: account.id,
    networkMode: report.networkMode,
    sessionSource: report.sessionSource,
    processed: report.processed,
    created: report.created,
    updated: report.updated,
    errors: report.errors,
  })

  return report
}

async function main() {
  const { headed, useAi, useAccountProxy, maxThreads, accountIds } = parseArgs()
  const accountDelayMs = getSyncAccountDelayMs()

  log('sync.start', {
    accountIds,
    headed,
    useAi,
    useAccountProxy,
    maxThreads,
    accountDelayMs,
  })

  const mutexAcquired = await acquirePlaywrightMutex()
  if (!mutexAcquired) {
    console.error('Mutex Playwright ocupado. Espera o libera IS_PLAYWRIGHT_RUNNING.')
    process.exit(1)
  }

  const reports: AccountSyncReport[] = []

  try {
    for (let i = 0; i < accountIds.length; i++) {
      const accountId = accountIds[i]

      if (i > 0 && accountDelayMs > 0) {
        log('sync.account.delay', { ms: accountDelayMs, beforeAccountId: accountId })
        await sleep(accountDelayMs)
      }

      try {
        const report = await syncAccount(accountId, {
          headed,
          useAi,
          useAccountProxy,
          maxThreads,
        })
        reports.push(report)
      } catch (error) {
        log('sync.account.error', {
          accountId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    await releasePlaywrightMutex()
  }

  const reportsDir = path.resolve(__dirname, '../reports')
  fs.mkdirSync(reportsDir, { recursive: true })
  const reportPath = path.join(reportsDir, `sync-accounts-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), reports }, null, 2))

  console.log('\n========== RESUMEN ==========')
  for (const r of reports) {
    console.log(
      `${r.label} (${r.accountId}): ${r.processed} threads, ${r.created} creados, ${r.updated} actualizados, ${r.errors} errores [${r.networkMode}/${r.sessionSource}]`,
    )
  }
  console.log(`\nReporte: ${reportPath}`)

  await db.$disconnect()
}

main().catch(async (error) => {
  console.error('sync-account-conversations failed:', error)
  await db.$disconnect()
  process.exit(1)
})
