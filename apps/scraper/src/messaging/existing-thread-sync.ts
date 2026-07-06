import type { Page } from 'playwright'
import { ContactSource, LeadStatus, type Lead } from '@repo/db'
import {
  extractListingIdsFromText,
  listingHostId,
  markHostContacted,
  registerIdentityAlias,
} from '@repo/lead-contact'
import { db } from '@repo/db'
import { outboundLog } from '../logging/outbound-logger'
import { scrapeThreadMessages } from './airbnb-inbox'
import { syncThreadMessages } from '../persistence/inbound-pipeline'

export async function syncExistingColdThread(
  page: Page,
  lead: Lead,
  threadUrl: string,
  prospectAccountId?: string,
): Promise<Lead> {
  outboundLog('outbound.presend.sync_thread', {
    leadId: lead.id,
    threadUrl,
    accountId: prospectAccountId ?? null,
  })

  await page.goto(threadUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1_000)

  const leadForScrape: Lead = { ...lead, threadId: threadUrl }
  const scraped = await scrapeThreadMessages(page, leadForScrape)
  await syncThreadMessages(lead.id, scraped)

  for (const listingId of extractListingIdsFromText(scraped.map((m) => m.content).join('\n'))) {
    await registerIdentityAlias(db, {
      aliasId: listingHostId(listingId),
      canonicalId: lead.hostAirbnbId,
      leadId: lead.id,
    })
  }

  const hasOutbound = scraped.some((message) => message.direction === 'OUTBOUND')
  const hasInbound = scraped.some((message) => message.direction === 'INBOUND')

  let nextStatus = LeadStatus.INITIAL_MSG_SENT
  if (hasInbound && lead.status === LeadStatus.LEAD_DISCOVERED) {
    nextStatus = LeadStatus.REPLIED_IN_PROGRESS
  } else if (!hasOutbound && lead.status === LeadStatus.LEAD_DISCOVERED) {
    nextStatus = LeadStatus.INITIAL_MSG_SENT
  } else if (lead.status !== LeadStatus.LEAD_DISCOVERED) {
    nextStatus = lead.status
  }

  const updated = await db.lead.update({
    where: { id: lead.id },
    data: {
      threadId: threadUrl,
      status: nextStatus,
      lastContactedAt: new Date(),
      nextFollowUpAt: null,
    },
  })

  await markHostContacted(db, {
    lead: updated,
    source: ContactSource.AIRBNB_PRESEND_GUARD,
    firstContactAccountId: prospectAccountId ?? null,
  })

  return updated
}
