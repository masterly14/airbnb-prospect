/**
 * Demo del flujo post-respuesta sin Playwright (regex → mensaje 2 estático).
 *
 * Por defecto NO escribe en la DB. Usa --write solo si quieres simular un INBOUND.
 *
 * Uso:
 *   npx tsx scripts/conversation-dry-run.ts <leadId> ["texto del host"]
 *   npx tsx scripts/conversation-dry-run.ts <leadId> "No" --write
 */
import dotenv from 'dotenv'
import path from 'path'
import { db, LeadStatus, MessageDirection } from '@repo/db'
import { hydrateLeadAgentContext } from '../src/conversation/lead-agent-context'
import {
  classifyHostReply,
  intentToAiTag,
  isMeetingAffirmative,
} from '../src/conversation/reply-intent'
import { buildCuriosityReplyMessage } from '../src/messaging/outbound-templates'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const args = process.argv.slice(2).filter((a) => a !== '--write')
const writeToDb = process.argv.includes('--write')
const DEFAULT_HOST_REPLY = args[1] ?? 'Dale, cuéntame más'

async function main() {
  const leadId = args[0]

  let id = leadId
  if (!id || id === '--pick') {
    const lead = await db.lead.findFirst({
      where: { totalProperties: { gte: 2 } },
      orderBy: { totalProperties: 'desc' },
    })
    if (!lead) {
      console.error('No hay leads')
      process.exit(1)
    }
    id = lead.id
    console.log(`Lead: ${lead.name} (${lead.totalProperties} props) — ${id}\n`)
  }

  const lead = await db.lead.findUnique({ where: { id } })
  if (!lead) {
    console.error('Lead not found')
    process.exit(1)
  }

  let hostText = DEFAULT_HOST_REPLY

  if (writeToDb) {
    const hasInbound = await db.message.findFirst({
      where: { leadId: id, direction: MessageDirection.INBOUND },
    })
    if (!hasInbound) {
      await db.message.create({
        data: {
          leadId: id,
          direction: MessageDirection.INBOUND,
          content: DEFAULT_HOST_REPLY,
          aiIntent: 'SIMULATED_DRY_RUN',
        },
      })
      await db.lead.update({
        where: { id },
        data: { status: LeadStatus.REPLIED_IN_PROGRESS, nextFollowUpAt: null },
      })
      console.log(`→ INBOUND simulado (--write): "${DEFAULT_HOST_REPLY}"\n`)
    }
  } else {
    const ctx = await hydrateLeadAgentContext(id)
    const lastInbound = [...(ctx?.recentMessages ?? [])]
      .reverse()
      .find((m) => m.direction === 'INBOUND' && m.aiIntent !== 'SIMULATED_DRY_RUN')
    if (lastInbound?.content) {
      hostText = lastInbound.content
    } else {
      console.log(
        `(Sin INBOUND en CRM; clasificando texto de argumento/default. No se escribe en DB sin --write.)\n`,
      )
    }
  }

  const ctx = await hydrateLeadAgentContext(id)
  if (!ctx && writeToDb) {
    console.error('No se pudo hidratar contexto')
    process.exit(1)
  }

  const lastInbound = [...(ctx?.recentMessages ?? [])]
    .reverse()
    .find((m) => m.direction === 'INBOUND')
  if (writeToDb && lastInbound?.content) {
    hostText = lastInbound.content
  }

  console.log('========== RESPUESTA DEL HOST ==========')
  console.log(hostText)

  const classification = classifyHostReply(hostText)
  console.log('\n========== CLASIFICACIÓN (regex) ==========')
  console.log(JSON.stringify({ ...classification, aiTag: intentToAiTag(classification.intent) }, null, 2))

  if (classification.intent === 'rejected') {
    console.log('\n→ RECHAZO: no se envía mensaje. Lead → CLOSED_LOST.')
    await db.$disconnect()
    return
  }

  const curiosityAlreadySent = (ctx?.recentMessages ?? []).some(
    (m) => m.direction === 'OUTBOUND' && m.aiIntent === 'CURIOSITY_REPLY',
  )

  if (curiosityAlreadySent && isMeetingAffirmative(hostText)) {
    console.log('\n→ REUNIÓN ACEPTADA: notificar admin (HUMAN_TAKEOVER).')
    await db.$disconnect()
    return
  }

  if (classification.intent !== 'interested') {
    console.log('\n→ Sin texto de host usable: no se responde automáticamente.')
    await db.$disconnect()
    return
  }

  if (curiosityAlreadySent) {
    console.log('\n→ Mensaje 2 ya enviado; sin acción automática.')
    await db.$disconnect()
    return
  }

  console.log('\n========== MENSAJE 2 (lo que se enviaría) ==========')
  console.log(`(pattern: ${classification.matchedPattern})`)
  console.log(buildCuriosityReplyMessage(lead))

  console.log('\n(Dry-run: no se envió por Airbnb.)')

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
