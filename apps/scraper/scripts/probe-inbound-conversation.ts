/**
 * Valida respuestas reales de hosts: sync inbox → clasificación → mensaje 2.
 *
 * Uso:
 *   npx tsx scripts/probe-inbound-conversation.ts --headed
 *   npx tsx scripts/probe-inbound-conversation.ts --headed --lead-id <uuid>
 *   npx tsx scripts/probe-inbound-conversation.ts --headed --send   # envía mensaje 2 si aplica
 */
import dotenv from 'dotenv'
import path from 'path'
import { db, LeadStatus, MessageDirection, type Lead } from '@repo/db'
import { pollLeadThread } from '../src/messaging/airbnb-inbox'
import { runConversationTurn } from '../src/conversation/run-conversation-turn'
import { classifyHostReply, intentToAiTag } from '../src/conversation/reply-intent'
import { buildCuriosityReplyMessage } from '../src/messaging/outbound-templates'
import { lastMeaningfulInbound } from '../src/messaging/thread-message-filters'
import { hydrateLeadAgentContext } from '../src/conversation/lead-agent-context'
import { findLeadsForInboundPoll } from '../src/persistence/inbound-pipeline'
import { openAccountBrowserSessionWithLogin } from '../src/accounts/account-browser-session'
import { isMvpSingleAccountMode, loadMvpAccount } from '../src/accounts/mvp-mode'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return null
  return process.argv[idx + 1]?.trim() || null
}

function isValidThreadId(threadId: string | null | undefined): boolean {
  return Boolean(threadId && /\/guest\/messages\/\d+/.test(threadId))
}

async function resolveLead(): Promise<Lead> {
  const leadId = readArg('--lead-id')
  if (leadId) {
    const lead = await db.lead.findUnique({ where: { id: leadId } })
    if (!lead) throw new Error(`Lead no encontrado: ${leadId}`)
    return lead
  }

  const candidates = await findLeadsForInboundPoll(20)
  const withThread = candidates.filter((l) => isValidThreadId(l.threadId))
  if (withThread.length === 0) {
    throw new Error('No hay leads elegibles con threadId válido para inbound')
  }

  // Priorizar REPLIED_IN_PROGRESS o leads con inbound ya en CRM
  for (const lead of withThread) {
    const inbound = await db.message.findFirst({
      where: { leadId: lead.id, direction: MessageDirection.INBOUND },
    })
    if (inbound || lead.status === LeadStatus.REPLIED_IN_PROGRESS) {
      return lead
    }
  }

  return withThread[0]
}

async function printLeadAnalysis(lead: Lead): Promise<void> {
  const ctx = await hydrateLeadAgentContext(lead.id)
  const messages = ctx?.recentMessages ?? []

  console.log('\n=== Historial CRM ===')
  for (const m of messages) {
    console.log(`  [${m.direction}] ${m.aiIntent ?? '-'}: ${m.content.slice(0, 120)}`)
  }

  const lastInbound = lastMeaningfulInbound(messages)
  if (!lastInbound) {
    console.log('\n⚠ Sin mensajes INBOUND en CRM todavía.')
    return
  }

  const classification = classifyHostReply(lastInbound.content)
  console.log('\n=== Clasificación (último INBOUND) ===')
  console.log(`Host dijo: "${lastInbound.content.slice(0, 200)}"`)
  console.log(JSON.stringify({ ...classification, aiTag: intentToAiTag(classification.intent) }, null, 2))

  const curiositySent = messages.some(
    (m) => m.direction === 'OUTBOUND' && m.aiIntent === 'CURIOSITY_REPLY',
  )

  console.log('\n=== Acción esperada ===')
  if (classification.intent === 'rejected') {
    console.log('→ CLOSED_LOST (no envía mensaje)')
  } else if (curiositySent) {
    console.log('→ Mensaje 2 ya enviado; evaluar reunión o esperar humano')
  } else if (classification.intent === 'interested') {
    console.log(`→ Enviaría mensaje 2 (CURIOSITY_REPLY) [${classification.matchedPattern}]:`)
    console.log('\n' + buildCuriosityReplyMessage(lead))
  } else {
    console.log('→ Sin texto usable (no envía)')
  }
}

async function main() {
  const headed = hasFlag('--headed')
  const send = hasFlag('--send')

  process.env.INBOUND_HEADED = headed ? 'true' : 'false'
  process.env.PLAYWRIGHT_SLOW_NETWORK = process.env.PLAYWRIGHT_SLOW_NETWORK ?? 'true'

  const lead = await resolveLead()
  console.log(`\n=== Lead: ${lead.name} (${lead.id}) ===`)
  console.log(`Status: ${lead.status} | thread: ${lead.threadId}`)

  await printLeadAnalysis(lead)

  if (!isValidThreadId(lead.threadId)) {
    console.error('\n✗ threadId inválido — corrige en CRM antes de poll en Airbnb.')
    await db.$disconnect()
    process.exit(1)
  }

  const account = isMvpSingleAccountMode()
    ? await loadMvpAccount()
    : await db.prospectAccount.findFirst({ where: { airbnbEmail: process.env.AIRBNB_EMAIL } })

  if (!account) {
    throw new Error('No se encontró cuenta de prospección (MVP o AIRBNB_EMAIL)')
  }

  console.log(`\n=== Poll Airbnb (${account.label}) ===`)

  const session = await openAccountBrowserSessionWithLogin(account, {
    headless: !headed,
    job: 'inbound',
  })

  try {
    const pollResult = await pollLeadThread(session.page, lead)
    console.log('\n=== Resultado poll ===')
    console.log(JSON.stringify(pollResult, null, 2))

    await printLeadAnalysis(await db.lead.findUniqueOrThrow({ where: { id: lead.id } }))

    if (send && pollResult.success) {
      // pollLeadThread ya ejecuta el turno si hay reply scrapado.
      // Solo reintentamos si el poll no cerró/envió (p. ej. scrape vacío).
      console.log('\n=== Reintento runConversationTurn si el poll no envió ===')
      const hostFromCrm = lastMeaningfulInbound(
        (await hydrateLeadAgentContext(lead.id))?.recentMessages ?? [],
      )?.content
      console.log('hostReply (CRM):', hostFromCrm)
      const turn = await runConversationTurn(session.page, lead.id, {
        scrapedHostReply: hostFromCrm,
      })
      console.log(JSON.stringify(turn, null, 2))
      if (headed) await session.page.waitForTimeout(12_000)
    } else if (headed) {
      console.log('\n[headed] Browser abierto 15s para inspección (sin --send no envía).')
      await session.page.waitForTimeout(15_000)
    }
  } finally {
    await session.browser.close()
    await db.$disconnect()
  }
}

main().catch(async (error) => {
  console.error('probe-inbound-conversation failed:', error instanceof Error ? error.message : error)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
