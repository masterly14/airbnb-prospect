/**
 * Auditoría de producción: ningún lead contactado puede recibir frío.
 *
 * Verifica contra la DB real:
 *  - HostContact ledger → duplicado sintético bloqueado
 *  - Cola findEligibleColdLeads → cero contactados en cluster
 *  - Leads con status avanzado → assertColdOutbound bloqueado
 *  - Hilos sync Michell → lookup contactado
 */
import dotenv from 'dotenv'
import path from 'path'
import { LeadStatus, MessageDirection, type Lead } from '@repo/db'
import { db } from '@repo/db'
import {
  assertColdOutboundAllowed,
  isClusterContacted,
  isLeadContacted,
  listingHostId,
  registerIdentityAlias,
  resolveLeadIdentityCluster,
} from '@repo/lead-contact'
import { findEligibleColdLeads } from '../src/persistence/outbound-pipeline'
import { prismaLeadRepository } from '../../web/lib/leads/prisma-repository'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

const MICHELL_THREADS = [
  { name: 'Sebastian', leadId: '608364f9-b2ab-4376-8192-8ee57c178df0', listingId: '1599591058979163729' },
  { name: 'Roció', leadId: '302b5ea8-f905-4818-808d-2edc8a9beb18' },
  { name: 'Juanita', leadId: 'a7006129-928a-4f55-863c-1cfa5376230d' },
  { name: 'Paula Andrea', leadId: 'ae82b8fb-36ae-45dc-871d-631b38c6816f' },
]

type Failure = { check: string; detail: string }

async function assertSyntheticDuplicateBlocked(canonical: Lead, failures: Failure[]): Promise<void> {
  const fakeListingId = `999000${canonical.id.replace(/\D/g, '').slice(0, 8)}`
  const syntheticId = `dedup-matrix-${canonical.id.slice(0, 8)}`

  await db.lead.deleteMany({ where: { id: syntheticId } }).catch(() => {})

  await registerIdentityAlias(db, {
    aliasId: listingHostId(fakeListingId),
    canonicalId: canonical.hostAirbnbId,
    leadId: canonical.id,
  })

  await db.lead.create({
    data: {
      id: syntheticId,
      hostAirbnbId: listingHostId(fakeListingId),
      name: canonical.name,
      hostProfileUrl: `https://www.airbnb.com.co/rooms/${fakeListingId}`,
      primaryListingUrl: `https://www.airbnb.com.co/rooms/${fakeListingId}`,
      totalProperties: 15,
      isSuperhost: true,
      status: LeadStatus.LEAD_DISCOVERED,
    },
  })

  const cold = await assertColdOutboundAllowed(db, syntheticId)
  const eligible = await findEligibleColdLeads(200)
  const inQueue = eligible.some((lead) => lead.id === syntheticId)

  await db.lead.delete({ where: { id: syntheticId } }).catch(() => {})

  if (cold.allowed) {
    failures.push({
      check: 'synthetic_duplicate_assertColdOutbound',
      detail: `${canonical.name} (${canonical.id}): duplicato permitido`,
    })
  }
  if (inQueue) {
    failures.push({
      check: 'synthetic_duplicate_cold_queue',
      detail: `${canonical.name} (${canonical.id}): duplicato en cola fría`,
    })
  }
}

async function main() {
  const failures: Failure[] = []
  const stats = {
    hostContacts: 0,
    contactedLeads: 0,
    coldQueueChecked: 0,
    michellThreadsChecked: 0,
    syntheticDuplicatesTested: 0,
  }

  const hostContacts = await db.hostContact.findMany({
    include: { lead: true },
  })
  stats.hostContacts = hostContacts.length

  for (const contact of hostContacts) {
    stats.syntheticDuplicatesTested++
    await assertSyntheticDuplicateBlocked(contact.lead, failures)
  }

  const contactedLeads = await db.lead.findMany({
    where: {
      OR: [
        { status: { not: LeadStatus.LEAD_DISCOVERED } },
        { threadId: { not: null } },
        { hostContact: { isNot: null } },
        { messages: { some: { direction: MessageDirection.OUTBOUND } } },
      ],
    },
  })
  stats.contactedLeads = contactedLeads.length

  for (const lead of contactedLeads) {
    if (lead.status === LeadStatus.LEAD_DISCOVERED) {
      const cold = await assertColdOutboundAllowed(db, lead.id)
      if (cold.allowed) {
        failures.push({
          check: 'contacted_lead_assertColdOutbound',
          detail: `${lead.name} (${lead.id}) status=${lead.status} permitido`,
        })
      }
    } else {
      const cold = await assertColdOutboundAllowed(db, lead.id)
      if (cold.allowed) {
        failures.push({
          check: 'advanced_status_assertColdOutbound',
          detail: `${lead.name} (${lead.id}) status=${lead.status} permitido`,
        })
      }
    }
  }

  const coldQueue = await findEligibleColdLeads(500)
  stats.coldQueueChecked = coldQueue.length

  for (const candidate of coldQueue) {
    const cluster = await resolveLeadIdentityCluster(db, candidate)
    const clusterStatus = await isClusterContacted(db, cluster)
    if (clusterStatus.contacted) {
      failures.push({
        check: 'cold_queue_cluster_contacted',
        detail: `${candidate.name} (${candidate.id}) en cola pero cluster contactado: ${clusterStatus.reason}`,
      })
    }
    if (isLeadContacted(candidate)) {
      failures.push({
        check: 'cold_queue_isLeadContacted',
        detail: `${candidate.name} (${candidate.id}) en cola pero isLeadContacted=true`,
      })
    }
  }

  for (const thread of MICHELL_THREADS) {
    stats.michellThreadsChecked++
    const lead = await db.lead.findUnique({ where: { id: thread.leadId } })
    if (!lead) {
      failures.push({ check: 'michell_thread_exists', detail: `Lead ${thread.leadId} no encontrado` })
      continue
    }
    if (!isLeadContacted(lead)) {
      failures.push({
        check: 'michell_thread_contacted',
        detail: `${thread.name} no marcado como contactado`,
      })
    }
    if (thread.listingId) {
      const lookup = await prismaLeadRepository.lookupLeads(
        `https://www.airbnb.com.co/rooms/${thread.listingId}`,
      )
      if (!lookup.some((match) => match.contacted)) {
        failures.push({
          check: 'michell_listing_lookup',
          detail: `Listing ${thread.listingId} (${thread.name}) lookup sin contacted`,
        })
      }
    }
    const lookupByName = await prismaLeadRepository.lookupLeads(thread.name)
    if (!lookupByName.some((match) => match.id === thread.leadId && match.contacted)) {
      failures.push({
        check: 'michell_name_lookup',
        detail: `${thread.name} lookup por nombre sin match contactado`,
      })
    }
  }

  const passed = failures.length === 0

  console.log(
    JSON.stringify(
      {
        stats,
        failures,
        passed,
        summary: passed
          ? `OK: ${stats.hostContacts} HostContact, ${stats.contactedLeads} contactados, ${stats.coldQueueChecked} en cola fría — ninguno expuesto`
          : `${failures.length} fallo(s) de dedup`,
      },
      null,
      2,
    ),
  )

  await db.$disconnect()
  if (!passed) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
