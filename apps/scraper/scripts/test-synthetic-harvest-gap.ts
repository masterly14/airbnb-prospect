/**
 * Simula un lead cosechado duplicado por listing y verifica guards de outbound.
 */
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })
import { db, LeadStatus } from '@repo/db'
import { assertColdOutboundAllowed, listingHostId } from '@repo/lead-contact'
import { findEligibleColdLeads } from '../src/persistence/outbound-pipeline'

const LISTING_ID = process.env.DEDUP_TEST_LISTING_ID ?? '1599591058979163729'
const SYNTHETIC_ID = 'test-synthetic-listing-lead'

async function main() {
  await db.lead.deleteMany({ where: { id: SYNTHETIC_ID } }).catch(() => {})

  const created = await db.lead.create({
    data: {
      id: SYNTHETIC_ID,
      hostAirbnbId: listingHostId(LISTING_ID),
      name: 'Sebastian',
      hostProfileUrl: `https://www.airbnb.com.co/rooms/${LISTING_ID}`,
      primaryListingUrl: `https://www.airbnb.com.co/rooms/${LISTING_ID}`,
      totalProperties: 15,
      isSuperhost: true,
      status: LeadStatus.LEAD_DISCOVERED,
    },
  })

  const eligible = await findEligibleColdLeads(50)
  const picked = eligible.some((lead) => lead.id === SYNTHETIC_ID)
  const cold = await assertColdOutboundAllowed(db, SYNTHETIC_ID)

  await db.lead.delete({ where: { id: SYNTHETIC_ID } })

  const passed =
    !picked &&
    cold.allowed === false &&
    cold.reason === 'cluster_already_contacted'

  console.log(
    JSON.stringify(
      {
        listingId: LISTING_ID,
        syntheticLead: { id: created.id, hostAirbnbId: created.hostAirbnbId },
        pickedByFindEligibleColdLeads: picked,
        assertColdOutboundAllowed: {
          allowed: cold.allowed,
          reason: 'reason' in cold ? cold.reason : null,
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
