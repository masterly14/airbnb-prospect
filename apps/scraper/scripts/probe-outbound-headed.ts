/**
 * Prueba visible del pipeline outbound: cuenta por email, sin proxy.
 * Muestra leads elegibles, abre inbox en "Modo viajero" e intenta 1 envío.
 *
 * Uso:
 *   npx tsx scripts/probe-outbound-headed.ts
 *   npx tsx scripts/probe-outbound-headed.ts --email svaron066@gmail.com
 *   npx tsx scripts/probe-outbound-headed.ts --dry-run
 */
import dotenv from 'dotenv'
import path from 'path'
import { chromium } from 'playwright'
import { db, LeadStatus } from '@repo/db'
import { openAccountBrowserSessionWithLogin } from '../src/accounts/account-browser-session'
import {
  findEligibleOutboundLeads,
  hasEligibleOutboundLeads,
  phaseForStatus,
  countColdPipeline,
} from '../src/persistence/outbound-pipeline'
import { getMarketsAtQuota } from '../src/persistence/daily-outbound-stats'
import { collectInboxThreads } from '../src/messaging/airbnb-inbox'
import { buildOutboundMessage } from '../src/messaging/outbound-templates'
import { sendOutboundMessage } from '../src/messaging/airbnb-messaging'
import {
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../src/scraping/airbnb-context'
import { applyContextTimeouts } from '../src/scraping/page-timing'
import { loginAirbnb, resolveAccountAuthConfig } from '../tests/helpers/airbnb-auth'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return null
  return process.argv[idx + 1]?.trim() || null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

async function resolveAccountByEmail(email: string) {
  const account = await db.prospectAccount.findFirst({
    where: { airbnbEmail: { equals: email, mode: 'insensitive' } },
  })
  if (!account) {
    throw new Error(`ProspectAccount no encontrada para ${email}`)
  }
  return account
}

async function logPipelineStats() {
  const coldCount = await countColdPipeline()
  const hasLeads = await hasEligibleOutboundLeads()
  const marketsAtQuota = await getMarketsAtQuota()
  const leads = await findEligibleOutboundLeads(5, { excludeMarketsAtQuota: marketsAtQuota })

  console.log('\n=== Pipeline outbound ===')
  console.log(`Leads fríos en cola (sin cluster): ${coldCount}`)
  console.log(`¿Hay leads elegibles ahora?: ${hasLeads}`)
  console.log(`Mercados en cuota diaria: ${marketsAtQuota.join(', ') || '(ninguno)'}`)
  console.log(`Próximos ${leads.length} leads:`)
  for (const lead of leads) {
    const phase = phaseForStatus(lead.status)
    console.log(
      `  - ${lead.name} | ${lead.market} | ${lead.status} | phase=${phase} | props=${lead.totalProperties} | listing=${lead.primaryListingUrl?.slice(0, 60)}...`,
    )
  }
  console.log('')
  return leads
}

async function openEnvLoginSession() {
  const config = resolveAccountAuthConfig()
  const browser = await chromium.launch({ headless: false, ...getChromeChannelOption() })
  const context = await browser.newContext(getColombiaContextOptions())
  applyContextTimeouts(context)
  const page = await context.newPage()
  await loginAirbnb(page, config)
  return { browser, page, email: config.email }
}

async function main() {
  const email = readArg('--email') ?? process.env.AIRBNB_EMAIL?.trim()
  if (!email) {
    throw new Error('Indica --email o configura AIRBNB_EMAIL en .env')
  }

  process.env.OUTBOUND_HEADED = 'true'
  process.env.PLAYWRIGHT_USE_ACCOUNT_PROXY = 'false'
  process.env.OUTBOUND_USE_ACCOUNT_PROXY = 'false'
  process.env.LOGIN_USE_ACCOUNT_PROXY = 'false'
  process.env.PLAYWRIGHT_SLOW_NETWORK = process.env.PLAYWRIGHT_SLOW_NETWORK ?? 'true'

  const dryRun = hasFlag('--dry-run')
  let noDb = hasFlag('--no-db')

  console.log(`\n=== Probe outbound headed ===`)
  console.log(`Email: ${email} | Proxy: OFF | dry-run: ${dryRun} | no-db: ${noDb}`)

  let leads: Awaited<ReturnType<typeof logPipelineStats>> = []
  let account: Awaited<ReturnType<typeof resolveAccountByEmail>> | null = null

  if (!noDb) {
    try {
      account = await resolveAccountByEmail(email)
      console.log(`Cuenta CRM: ${account.label} (${account.id})`)
      leads = await logPipelineStats()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/Can't reach database|DATABASE_URL|ECONNREFUSED/i.test(message)) {
        console.warn(`\n[warn] DB no disponible — continuando con login por .env (${message.slice(0, 80)})`)
        noDb = true
      } else {
        throw error
      }
    }
  }

  let browser: Awaited<ReturnType<typeof openEnvLoginSession>>['browser'] | null = null
  let page: Awaited<ReturnType<typeof openEnvLoginSession>>['page']

  try {
    if (noDb || !account) {
      const session = await openEnvLoginSession()
      browser = session.browser
      page = session.page
    } else {
      const session = await openAccountBrowserSessionWithLogin(account, {
        headless: false,
        job: 'outbound',
      })
      browser = session.browser
      page = session.page
    }

    console.log('=== Inbox (Modo viajero) ===')
    const threads = await collectInboxThreads(page, 15)
    console.log(`Threads encontrados: ${threads.length}`)
    for (const thread of threads.slice(0, 8)) {
      console.log(`  - ${thread.threadId} | ${thread.hostName} | ${thread.rawText.slice(0, 80)}`)
    }

    if (dryRun || noDb || !account) {
      console.log('\n[dry-run / sin DB] No se envía mensaje.')
      await page.waitForTimeout(12_000)
      return
    }

    const target = leads.find((l) => l.status === LeadStatus.LEAD_DISCOVERED) ?? leads[0]
    if (!target) {
      console.log('\nNo hay leads elegibles para enviar.')
      await page.waitForTimeout(5_000)
      return
    }

    const phase = phaseForStatus(target.status)
    if (!phase) {
      console.log(`\nLead ${target.id} sin fase outbound (${target.status})`)
      return
    }

    const isCold = target.status === LeadStatus.LEAD_DISCOVERED
    const text = buildOutboundMessage(target, phase)

    console.log(`\n=== Enviando a ${target.name} (${phase}) ===`)
    console.log(`Mensaje (${text.length} chars): ${text.slice(0, 120)}...`)

    const result = await sendOutboundMessage(page, target, text, isCold, phase, {
      prospectAccountId: account.id,
    })

    console.log('\n=== Resultado ===')
    console.log(JSON.stringify(result, null, 2))
    await page.waitForTimeout(10_000)
  } finally {
    if (browser) await browser.close()
    await db.$disconnect()
  }
}

main().catch(async (error) => {
  console.error('probe-outbound-headed failed:', error instanceof Error ? error.message : error)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
