/**
 * Smoke: lookup CRM por listing URL + alias/cluster en DB.
 *
 * Uso:
 *   npx tsx apps/scraper/scripts/test-listing-dedup.ts [listingIdOrUrl]
 */
import dotenv from 'dotenv'
import path from 'path'
import { db } from '@repo/db'
import { findLeadsByListingId, listingHostId } from '@repo/lead-contact'
import { prismaLeadRepository } from '../../web/lib/leads/prisma-repository'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

const DEFAULT_LISTING_ID = process.env.DEDUP_TEST_LISTING_ID ?? '1599591058979163729'

function resolveListingInput(raw?: string): { listingId: string; listingUrl: string } {
  const input = raw ?? DEFAULT_LISTING_ID
  const match = input.match(/rooms\/(\d+)/)
  const listingId = match?.[1] ?? input.replace(/\D/g, '')
  return {
    listingId,
    listingUrl: `https://www.airbnb.com.co/rooms/${listingId}`,
  }
}

async function main() {
  const { listingId, listingUrl } = resolveListingInput(process.argv[2])

  const lookup = await prismaLeadRepository.lookupLeads(listingUrl)
  const clusterLeads = await findLeadsByListingId(db, listingId)
  const alias = await db.leadIdentityAlias.findUnique({
    where: { aliasId: listingHostId(listingId) },
  })

  const passed = lookup.some((match) => match.contacted) && clusterLeads.length > 0

  console.log(
    JSON.stringify(
      {
        listingId,
        listingUrl,
        lookupMatches: lookup.map((m) => ({
          id: m.id,
          name: m.name,
          contacted: m.contacted,
          hostAirbnbId: m.hostAirbnbId,
        })),
        clusterLeadIds: clusterLeads.map((lead) => lead.id),
        listingAlias: alias
          ? { aliasId: alias.aliasId, canonicalId: alias.canonicalId, leadId: alias.leadId }
          : null,
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
