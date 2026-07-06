/**
 * E2E dedup report: listing vs CRM vs outbound guards (Michell / Sebastian case).
 *
 * Uso:
 *   npx tsx apps/scraper/scripts/test-listing-e2e.ts
 *   npx tsx apps/scraper/scripts/test-listing-e2e.ts --skip-browser
 */
import dotenv from 'dotenv'
import path from 'path'
import { chromium } from 'playwright'
import { db, LeadStatus, MessageDirection } from '@repo/db'
import {
  assertColdOutboundAllowed,
  isLeadContacted,
  listingHostId,
} from '@repo/lead-contact'
import { prismaLeadRepository } from '../../web/lib/leads/prisma-repository'
import { findExistingThreadForLead } from '../src/messaging/thread-detection'
import { getChromeChannelOption, getColombiaContextOptions } from '../src/scraping/airbnb-context'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

const MICHELL_ID = '69b667ad-a532-444e-a084-44ac7943daa8'
const LISTING_ID = process.env.DEDUP_TEST_LISTING_ID ?? '1599591058979163729'
const LISTING_URL = `https://www.airbnb.com.co/rooms/${LISTING_ID}`
const SEBASTIAN_LEAD_ID = '608364f9-b2ab-4376-8192-8ee57c178df0'
const skipBrowser = process.argv.includes('--skip-browser')

async function main() {
  const listingLookup = await prismaLeadRepository.lookupLeads(LISTING_URL)
  const sebastianLead = await db.lead.findUnique({ where: { id: SEBASTIAN_LEAD_ID } })
  const coldCheck = sebastianLead
    ? await assertColdOutboundAllowed(db, sebastianLead.id)
    : null

  const account = await db.prospectAccount.findUnique({ where: { id: MICHELL_ID } })
  let threadGuard: string | null = null

  if (!skipBrowser && account?.sessionPath && sebastianLead) {
    const browser = await chromium.launch({ headless: true, ...getChromeChannelOption() })
    const page = await (
      await browser.newContext({ storageState: account.sessionPath, ...getColombiaContextOptions() })
    ).newPage()
    const syntheticHarvestLead = {
      ...sebastianLead,
      id: '00000000-0000-0000-0000-000000000001',
      status: LeadStatus.LEAD_DISCOVERED,
      threadId: null,
      hostAirbnbId: listingHostId(LISTING_ID),
      primaryListingUrl: LISTING_URL,
      primaryListingName: 'Gran apartamento Aeropuerto Jo Embassy WiFi @Bogotá',
      name: 'Sebastian',
    }
    threadGuard = await findExistingThreadForLead(page, syntheticHarvestLead)
    await browser.close()
  }

  const listingContacted = listingLookup.some((match) => match.contacted)
  const extensionVerdict = listingContacted
    ? 'EN CRM / YA CONTACTADO'
    : listingLookup.length === 0
      ? 'LIBRE (no match) — falso negativo'
      : 'EN CRM sin contactar'

  const passed =
    listingContacted &&
    coldCheck?.allowed === false &&
    (skipBrowser || threadGuard != null)

  console.log(
    JSON.stringify(
      {
        listing: { id: LISTING_ID, url: LISTING_URL },
        crm: {
          listingLookup: listingLookup.map((m) => ({
            id: m.id,
            name: m.name,
            status: m.status,
            contacted: m.contacted,
            hostAirbnbId: m.hostAirbnbId,
          })),
          sebastianLead: sebastianLead
            ? {
                id: sebastianLead.id,
                status: sebastianLead.status,
                isLeadContacted: isLeadContacted(sebastianLead),
              }
            : null,
        },
        guards: {
          assertColdOutboundBlocked: coldCheck?.allowed === false,
          findExistingThreadForSyntheticHarvestLead: threadGuard,
          browserSkipped: skipBrowser,
        },
        verdict: {
          extensionOnListingWouldShow: extensionVerdict,
          outboundColdWouldBlockByStatus: coldCheck?.allowed === false,
          outboundPreSendWouldFindExistingThread: skipBrowser ? 'skipped' : threadGuard != null,
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
