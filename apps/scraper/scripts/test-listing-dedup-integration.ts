/**
 * Integration check: Sebastian/Michell listing dedup after identity aliases.
 */
import dotenv from 'dotenv'
import path from 'path'
import { db, LeadStatus } from '@repo/db'
import {
  assertColdOutboundAllowed,
  listingHostId,
  registerIdentityAlias,
} from '@repo/lead-contact'
import { prismaLeadRepository } from '../../web/lib/leads/prisma-repository'
import { findEligibleColdLeads } from '../src/persistence/outbound-pipeline'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

const LISTING_ID = '1599591058979163729'
const LISTING_URL = `https://www.airbnb.com.co/rooms/${LISTING_ID}`
const SEBASTIAN_LEAD_ID = '608364f9-b2ab-4376-8192-8ee57c178df0'
const SYNTHETIC_ID = 'test-synthetic-listing-lead'

async function ensureSebastianListingAlias(): Promise<void> {
  const sebastian = await db.lead.findUnique({ where: { id: SEBASTIAN_LEAD_ID } })
  if (!sebastian) return

  await registerIdentityAlias(db, {
    aliasId: listingHostId(LISTING_ID),
    canonicalId: sebastian.hostAirbnbId,
    leadId: sebastian.id,
  })
}

async function main() {
  await ensureSebastianListingAlias()

  const listingLookup = await prismaLeadRepository.lookupLeads(LISTING_URL)
  const listingMatched = listingLookup.some((match) => match.contacted)

  await db.lead.deleteMany({ where: { id: SYNTHETIC_ID } }).catch(() => {})
  await db.lead.create({
    data: {
      id: SYNTHETIC_ID,
      hostAirbnbId: listingHostId(LISTING_ID),
      name: 'Sebastian',
      hostProfileUrl: LISTING_URL,
      primaryListingUrl: LISTING_URL,
      totalProperties: 15,
      isSuperhost: true,
      status: LeadStatus.LEAD_DISCOVERED,
    },
  })

  const coldEligible = await findEligibleColdLeads(50)
  const pickedByColdQuery = coldEligible.some((lead) => lead.id === SYNTHETIC_ID)
  const coldCheck = await assertColdOutboundAllowed(db, SYNTHETIC_ID)

  await db.lead.delete({ where: { id: SYNTHETIC_ID } })

  const passed =
    listingMatched &&
    !pickedByColdQuery &&
    coldCheck.allowed === false &&
    coldCheck.reason === 'cluster_already_contacted'

  console.log(
    JSON.stringify(
      {
        listingLookupContacted: listingMatched,
        pickedByFindEligibleColdLeads: pickedByColdQuery,
        assertColdOutboundAllowed: {
          allowed: coldCheck.allowed,
          reason: 'reason' in coldCheck ? coldCheck.reason : null,
        },
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
