import type { Page } from 'playwright'
import { ContactSource, LeadStatus, type Lead } from '@repo/db'
import { parseThreadId } from '@repo/airbnb-parse'
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
import { mergeLeadIntoCanonical } from '../persistence/lead-identity-merge'

/**
 * Busca un lead distinto al actual que ya sea dueño del hilo (`threadId` es
 * `@unique`). Si existe, el lead en curso es un duplicado del anfitrión ya
 * contactado y no puede reclamar el mismo `threadId`.
 */
async function findThreadOwnerLead(threadUrl: string, currentLeadId: string): Promise<Lead | null> {
  const threadNumericId = parseThreadId(threadUrl)
  if (!threadNumericId) return null

  return db.lead.findFirst({
    where: {
      NOT: { id: currentLeadId },
      threadId: { contains: threadNumericId },
    },
    orderBy: { updatedAt: 'desc' },
  })
}

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
  const listingIds = extractListingIdsFromText(scraped.map((m) => m.content).join('\n'))

  // El hilo ya pertenece a otro lead: este lead es un duplicado del anfitrión
  // ya contactado. Fusionar en el canónico en vez de reclamar el `threadId`
  // (que dispararía P2002 y dejaría el lead en LEAD_DISCOVERED en bucle).
  const ownerLead = await findThreadOwnerLead(threadUrl, lead.id)
  if (ownerLead) {
    outboundLog('outbound.presend.duplicate_thread', {
      leadId: lead.id,
      canonicalLeadId: ownerLead.id,
      threadId: threadUrl,
    })

    await syncThreadMessages(ownerLead.id, scraped)

    for (const listingId of listingIds) {
      await registerIdentityAlias(db, {
        aliasId: listingHostId(listingId),
        canonicalId: ownerLead.hostAirbnbId,
        leadId: ownerLead.id,
      })
    }

    const merged = await mergeLeadIntoCanonical(ownerLead, lead, ownerLead.hostAirbnbId)

    await markHostContacted(db, {
      lead: merged,
      source: ContactSource.AIRBNB_PRESEND_GUARD,
      firstContactAccountId: prospectAccountId ?? null,
    })

    return merged
  }

  await syncThreadMessages(lead.id, scraped)

  for (const listingId of listingIds) {
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
