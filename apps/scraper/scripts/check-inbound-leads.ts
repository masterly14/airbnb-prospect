import dotenv from 'dotenv'
import path from 'path'
import { db, LeadStatus } from '@repo/db'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const INBOUND_STATUSES: LeadStatus[] = [
  LeadStatus.INITIAL_MSG_SENT,
  LeadStatus.FOLLOW_UP_1_SENT,
  LeadStatus.FOLLOW_UP_2_SENT,
  LeadStatus.FOLLOW_UP_3_SENT,
  LeadStatus.REPLIED_IN_PROGRESS,
]

async function main() {
  const total = await db.lead.count()
  const byStatus = await db.lead.groupBy({ by: ['status'], _count: true })
  console.log('Total leads:', total)
  console.log('Por status:', byStatus)

  const sample = await db.lead.findMany({
    take: 10,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      status: true,
      threadId: true,
      primaryListingName: true,
      totalProperties: true,
    },
  })
  console.log('\nTodos los leads:')
  for (const l of sample) console.log(JSON.stringify(l))

  const leads = await db.lead.findMany({
    where: { threadId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    take: 15,
    select: {
      id: true,
      name: true,
      status: true,
      threadId: true,
      botReplyCount: true,
      calLinkSent: true,
      _count: { select: { messages: true } },
    },
  })

  console.log('=== Leads con threadId ===')
  for (const l of leads) {
    console.log(
      JSON.stringify({
        id: l.id,
        name: l.name,
        status: l.status,
        msgs: l._count.messages,
        botReplies: l.botReplyCount,
        calLink: l.calLinkSent,
        eligible: INBOUND_STATUSES.includes(l.status),
      }),
    )
  }

  const inbound = leads.filter((l) => INBOUND_STATUSES.includes(l.status))
  console.log('\nElegibles inbound:', inbound.length)

  if (inbound[0]) {
    const msgs = await db.message.findMany({
      where: { leadId: inbound[0].id },
      orderBy: { sentAt: 'asc' },
      select: { direction: true, content: true, aiIntent: true },
    })
    console.log('\nHistorial de', inbound[0].name, `(${inbound[0].id}):`)
    for (const m of msgs) {
      console.log(`  [${m.direction}] ${m.aiIntent ?? '-'}: ${m.content.slice(0, 100)}`)
    }
  }

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
