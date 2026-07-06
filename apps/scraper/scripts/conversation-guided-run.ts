/**
 * Corrida guiada del pipeline conversacional (Triaje → Negociador → policy → send).
 *
 * Uso:
 *   npx tsx apps/scraper/scripts/conversation-guided-run.ts <leadId>
 *   npx tsx apps/scraper/scripts/conversation-guided-run.ts --headed <leadId>
 *   npx tsx apps/scraper/scripts/conversation-guided-run.ts --headed --pick
 *   npx tsx apps/scraper/scripts/conversation-guided-run.ts --headed <leadId>
 *
 * Si el lead no tiene threadId, ejecuta outbound frío primero.
 * Inserta un mensaje INBOUND simulado (laboratorio) para disparar la IA
 * sin esperar respuesta real del host en Airbnb.
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { db, LeadStatus, MessageDirection } from '@repo/db'
import { runConversationTurn } from '../src/conversation/run-conversation-turn'
import { sendColdOutboundMessage } from '../src/messaging/airbnb-messaging'
import { buildOutboundMessage } from '../src/messaging/outbound-templates'
import {
  applyOutboundTransition,
  recordOutboundMessage,
} from '../src/persistence/outbound-pipeline'
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

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

const AUTH_FILE = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')

/** Mensaje simulado del host para la demo (interés + duda técnica). */
const SIMULATED_HOST_REPLY =
  'Dale, cuéntame más. ¿Cómo funciona con la coordinación de limpiezas?'

async function pickBestLead() {
  return db.lead.findFirst({
    where: { totalProperties: { gte: 2 } },
    orderBy: { totalProperties: 'desc' },
  })
}

function isValidThreadId(threadId: string | null | undefined): boolean {
  if (!threadId) return false
  return /\/guest\/messages\/[^/]+/.test(threadId)
}

async function ensureThread(page: import('playwright').Page, leadId: string) {
  let lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new Error(`Lead not found: ${leadId}`)

  if (isValidThreadId(lead.threadId)) {
    console.log(`\n✓ Lead ya tiene threadId: ${lead.threadId}`)
    return lead
  }

  if (lead.threadId && !isValidThreadId(lead.threadId)) {
    console.log(`\n→ threadId inválido (${lead.threadId}); se reenviará mensaje frío.`)
    await db.lead.update({
      where: { id: leadId },
      data: { threadId: null },
    })
    lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } })
  }

  if (lead.status !== LeadStatus.LEAD_DISCOVERED) {
    console.log(
      `\n→ Lead sin threadId pero en ${lead.status}; reseteo a LEAD_DISCOVERED para envío frío.`,
    )
    await db.lead.update({
      where: { id: leadId },
      data: {
        status: LeadStatus.LEAD_DISCOVERED,
        botReplyCount: 0,
        calLinkSent: false,
        nextFollowUpAt: null,
      },
    })
    lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } })
  }

  console.log(`\n→ Enviando mensaje frío a ${lead.name} (${lead.primaryListingName})...`)
  const text = buildOutboundMessage(lead, 'PHASE_1_COLD')
  console.log(`  Plantilla:\n  "${text.slice(0, 120)}..."\n`)

  const result = await sendColdOutboundMessage(page, lead, text)
  if (!result.success || !result.threadId) {
    throw new Error(`Cold send failed: ${result.error ?? 'no threadId'}`)
  }

  await recordOutboundMessage(lead.id, text, 'PHASE_1_COLD')
  await applyOutboundTransition(lead.id, 'PHASE_1_COLD', {
    content: text,
    threadId: result.threadId,
    sentAt: new Date(),
  })

  console.log(`✓ Mensaje frío enviado. threadId=${result.threadId}`)
  return db.lead.findUniqueOrThrow({ where: { id: leadId } })
}

async function seedSimulatedHostReply(leadId: string) {
  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new Error('Lead not found')

  // Evitar duplicar el mensaje simulado en re-runs
  const existing = await db.message.findFirst({
    where: {
      leadId,
      direction: MessageDirection.INBOUND,
      content: SIMULATED_HOST_REPLY,
    },
  })

  if (!existing) {
    await db.message.create({
      data: {
        leadId,
        direction: MessageDirection.INBOUND,
        content: SIMULATED_HOST_REPLY,
      },
    })
    console.log('\n→ Mensaje INBOUND simulado insertado en Neon:')
    console.log(`  "${SIMULATED_HOST_REPLY}"`)
  } else {
    console.log('\n→ Mensaje INBOUND simulado ya existía en Neon (reutilizando).')
  }

  if (lead.status !== LeadStatus.REPLIED_IN_PROGRESS) {
    await db.lead.update({
      where: { id: leadId },
      data: {
        status: LeadStatus.REPLIED_IN_PROGRESS,
        nextFollowUpAt: null,
        lastContactedAt: new Date(),
      },
    })
    console.log('✓ Lead actualizado a REPLIED_IN_PROGRESS')
  }
}

async function main() {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed') || process.env.INBOUND_HEADED === 'true'
  const positional = args.filter((a) => !a.startsWith('--'))
  const arg = positional[0]

  if (!fs.existsSync(AUTH_FILE)) {
    console.error('No hay sesión Airbnb. Ejecuta: npm run auth:login')
    process.exit(1)
  }

  let leadId = arg
  if (arg === '--pick' || !arg) {
    const picked = await pickBestLead()
    if (!picked) {
      console.error('No hay leads en Neon. Ejecuta harvest:run primero.')
      process.exit(1)
    }
    leadId = picked.id
    console.log(`Lead seleccionado: ${picked.name} (${picked.totalProperties} props) — ${leadId}`)
  }

  const mutexAcquired = await acquirePlaywrightMutex()
  if (!mutexAcquired) {
    console.error('Mutex Playwright ocupado. Espera o libera IS_PLAYWRIGHT_RUNNING.')
    process.exit(1)
  }

  console.log(`\n🌐 Navegador: ${headed ? 'visible (--headed)' : 'headless (usa --headed para ver)'}`)

  const browser = await chromium.launch({
    headless: !headed,
    slowMo: headed ? 80 : 0,
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
      console.error('Sesión Airbnb expirada. Ejecuta: npm run auth:login')
      process.exit(1)
    }

    console.log('\n========== PASO 1: Asegurar thread ==========')
    const lead = await ensureThread(page, leadId)

    console.log('\n========== PASO 2: Simular respuesta del host ==========')
    await seedSimulatedHostReply(lead.id)

    console.log('\n========== PASO 3: Regex → Mensaje 2 (si hay interés) ==========')
    console.log('(Sin IA: rechazo = cierre; interés = plantilla estática #2)\n')

    const result = await runConversationTurn(page, lead.id)

    console.log('\n========== RESULTADO ==========')
    console.log(JSON.stringify(result, null, 2))

    const updated = await db.lead.findUnique({
      where: { id: lead.id },
      include: {
        messages: { orderBy: { sentAt: 'asc' }, take: 20 },
      },
    })

    if (updated) {
      console.log('\n========== ESTADO CRM ==========')
      console.log({
        status: updated.status,
        botReplyCount: updated.botReplyCount,
        calLinkSent: updated.calLinkSent,
      })

      console.log('\n========== HISTORIAL DE MENSAJES ==========')
      for (const m of updated.messages) {
        const tag = m.aiIntent ? ` [${m.aiIntent}]` : ''
        console.log(`[${m.direction}]${tag}: ${m.content.slice(0, 200)}`)
      }
    }

    if (result.outcome === 'replied') {
      console.log('\n✅ ÉXITO: la IA analizó, pasó policy y envió mensaje por Airbnb.')
    } else if (result.outcome === 'human_takeover') {
      console.log('\n⚠️ Escalado a HUMAN_TAKEOVER (revisar motivo en logs conversation.*).')
    } else if (result.outcome === 'closed_lost') {
      console.log('\n⚠️ Lead cerrado como CLOSED_LOST.')
    } else {
      console.log(`\n⚠️ Outcome: ${result.outcome}${result.error ? ` — ${result.error}` : ''}`)
    }
  } finally {
    if (headed) {
      console.log('\n👀 Navegador abierto 90s para inspección. Cierra la ventana o espera...')
      await new Promise((r) => setTimeout(r, 90_000))
    }
    await browser.close()
    await releasePlaywrightMutex()
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error('conversation-guided-run failed:', error)
  process.exit(1)
})
