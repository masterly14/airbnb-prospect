/**
 * Controles negativos: leads genuinamente nuevos NO deben bloquearse por error.
 */
import dotenv from 'dotenv'
import path from 'path'
import crypto from 'crypto'
import { db, LeadStatus } from '@repo/db'
import {
  assertColdOutboundAllowed,
  isClusterContacted,
  listingHostId,
  resolveLeadIdentityCluster,
} from '@repo/lead-contact'
import { findEligibleColdLeads } from '../src/persistence/outbound-pipeline'
import { prismaLeadRepository } from '../../web/lib/leads/prisma-repository'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

async function main() {
  const failures: string[] = []
  const suffix = crypto.randomBytes(4).toString('hex')
  const listingId = `888777${suffix}`
  const syntheticId = `dedup-negative-${suffix}`
  const listingUrl = `https://www.airbnb.com.co/rooms/${listingId}`

  await db.lead.deleteMany({ where: { id: syntheticId } }).catch(() => {})

  await db.lead.create({
    data: {
      id: syntheticId,
      hostAirbnbId: listingHostId(listingId),
      name: `Host Prueba ${suffix}`,
      hostProfileUrl: listingUrl,
      primaryListingUrl: listingUrl,
      totalProperties: 15,
      isSuperhost: true,
      status: LeadStatus.LEAD_DISCOVERED,
    },
  })

  const cluster = await resolveLeadIdentityCluster(db, {
    id: syntheticId,
    hostAirbnbId: listingHostId(listingId),
    primaryListingUrl: listingUrl,
    threadId: null,
  })
  const clusterStatus = await isClusterContacted(db, cluster)
  const cold = await assertColdOutboundAllowed(db, syntheticId)
  const lookup = await prismaLeadRepository.lookupLeads(listingUrl)
  const eligible = await findEligibleColdLeads(200)
  const inQueue = eligible.some((lead) => lead.id === syntheticId)

  await db.lead.delete({ where: { id: syntheticId } }).catch(() => {})

  if (clusterStatus.contacted) {
    failures.push(`cluster contactado inesperadamente: ${clusterStatus.reason}`)
  }
  if (!cold.allowed) {
    failures.push(`assertColdOutbound bloqueó lead nuevo: ${cold.reason}`)
  }
  if (lookup.some((match) => match.contacted)) {
    failures.push('lookup marcó contacted en lead nuevo')
  }
  if (!inQueue) {
    failures.push('lead ICP-eligible no apareció en findEligibleColdLeads')
  }

  const passed = failures.length === 0

  console.log(
    JSON.stringify(
      {
        syntheticLead: { id: syntheticId, listingId },
        clusterContacted: clusterStatus.contacted,
        assertColdOutboundAllowed: cold.allowed,
        inColdQueue: inQueue,
        lookupMatches: lookup.length,
        failures,
        passed,
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
