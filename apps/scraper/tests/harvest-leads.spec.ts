import { test, expect } from '@playwright/test'
import { db } from './helpers/db-client'
import { buildSearchResultsUrl, getSearchDates } from './helpers/airbnb-search'
import {
  dismissBlockingOverlays,
  scrapeSearchResultsPaginated,
} from './helpers/airbnb-scraper'
import { harvestListings } from './helpers/harvester'
import { HARVEST_CONTEXT_PREFIX } from './helpers/lead-repository'

const MAX_LISTINGS = Number.parseInt(process.env.HARVEST_MAX_LISTINGS ?? '5', 10)

test.describe.configure({ mode: 'serial' })

test.describe('Lead harvester', () => {
  test.afterAll(async () => {
    await db.$disconnect()
  })

  test('discovers hosts from Medellín search and upserts leads', async ({ page }) => {
    test.setTimeout(300_000)

    const { checkin, checkout } = getSearchDates(7)
    const searchUrl = buildSearchResultsUrl({ checkin, checkout })

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)

    const listings = await scrapeSearchResultsPaginated(page, {
      maxPages: 1,
      maxListings: MAX_LISTINGS,
    })
    expect(listings.length).toBeGreaterThan(0)

    const harvested = await harvestListings(page, listings, MAX_LISTINGS)
    const persisted = harvested.filter(
      (h) => h.action === 'created' || h.action === 'updated' || h.action === 'unchanged',
    )
    expect(persisted.length).toBeGreaterThan(0)

    console.log('\n--- Harvest results ---')
    for (const lead of harvested) {
      console.log(
        `${lead.action.toUpperCase()}${lead.reason ? ` (${lead.reason})` : ''}: ${lead.name ?? 'N/A'} (${lead.hostAirbnbId ?? 'N/A'}) — ${lead.totalProperties ?? '?'} propiedades`,
      )
    }

    const stored = await db.lead.findMany({
      where: { hostAirbnbId: { in: persisted.map((h) => h.hostAirbnbId!).filter(Boolean) } },
      select: {
        id: true,
        hostAirbnbId: true,
        name: true,
        status: true,
        totalProperties: true,
        primaryListingName: true,
      },
    })

    expect(stored.length).toBe(persisted.length)
    for (const lead of stored) {
      expect(lead.status).toBe('LEAD_DISCOVERED')
      expect(lead.totalProperties).toBeGreaterThanOrEqual(2)

      const contextMsg = await db.message.findFirst({
        where: {
          leadId: lead.id,
          content: { startsWith: HARVEST_CONTEXT_PREFIX },
        },
      })
      expect(contextMsg).toBeTruthy()
    }
  })
})
