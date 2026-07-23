import type { Page } from 'playwright'
import { ContactSource, LeadStatus, db, type Lead } from '@repo/db'
import { assertColdOutboundAllowed, markHostContacted } from '@repo/lead-contact'
import {
  AirbnbSendBlockedError,
  sendColdOutboundMessage,
} from '../messaging/airbnb-messaging'
import { buildOutboundMessage } from '../messaging/outbound-templates'
import {
  applyOutboundTransition,
  registerColdSendFailure,
  recordOutboundMessage,
} from '../persistence/outbound-pipeline'
import { handleAccountBlock } from '../accounts/account-repository'
import { incrementWaveProgress, startWave } from '../accounts/account-selector'
import { isLeadOutboundEligible } from './icp'
import {
  harvestLog,
  harvestTrace,
  parseContactHostListingId,
  parseListingIdFromUrl,
} from '../logging/harvest-logger'

export type HarvestSendOutcome =
  | 'sent'
  | 'skipped'
  | 'failed'
  | 'blocked'
  | 'disabled'

export type HarvestSendListingBind = {
  /** Listing que se acaba de cosechar — debe ser el destino del cold send. */
  listingUrl: string
  listingTitle?: string
  listingId?: string
}

export function isHarvestSendImmediateEnabled(): boolean {
  // Producto: al encontrar ICP → escribir ya. Opt-out explícito.
  return process.env.HARVEST_SEND_IMMEDIATE !== 'false'
}

/** Modo “seguir escribiendo hasta rate-limit / identity block”. */
export function isHarvestSendUntilBlocked(): boolean {
  return process.env.HARVEST_SEND_UNTIL_BLOCKED === 'true'
}

export function getHarvestSendMax(): number {
  // Hasta bloqueo: tope alto solo como safety; el corte real es sendBlocked.
  if (isHarvestSendUntilBlocked()) {
    const raw = Number.parseInt(process.env.HARVEST_SEND_MAX ?? '200', 10)
    if (!Number.isFinite(raw) || raw < 1) return 200
    return Math.min(raw, 500)
  }

  const raw = Number.parseInt(process.env.HARVEST_SEND_MAX ?? '10', 10)
  if (!Number.isFinite(raw) || raw < 1) return 10
  return Math.min(raw, 50)
}

/**
 * Fuerza que el lead apunte al listing cosechado en esta iteración.
 * Evita escribir a un primaryListingUrl viejo tras merges / rediscovery.
 */
async function bindLeadToHarvestListing(
  lead: Lead,
  bind: HarvestSendListingBind,
): Promise<Lead> {
  const harvestListingId =
    bind.listingId ?? parseListingIdFromUrl(bind.listingUrl)
  const leadListingId = parseListingIdFromUrl(lead.primaryListingUrl)

  if (
    harvestListingId &&
    leadListingId &&
    harvestListingId !== leadListingId
  ) {
    harvestLog('harvest.send.listing_mismatch', {
      stage: 'before_send_bind',
      leadId: lead.id,
      hostAirbnbId: lead.hostAirbnbId,
      leadListingId,
      leadListingUrl: lead.primaryListingUrl,
      leadListingName: lead.primaryListingName,
      harvestListingId,
      harvestListingUrl: bind.listingUrl,
      harvestListingTitle: bind.listingTitle ?? null,
    })
  }

  if (
    lead.primaryListingUrl === bind.listingUrl &&
    (!bind.listingTitle || lead.primaryListingName === bind.listingTitle)
  ) {
    return lead
  }

  const updated = await db.lead.update({
    where: { id: lead.id },
    data: {
      primaryListingUrl: bind.listingUrl,
      ...(bind.listingTitle ? { primaryListingName: bind.listingTitle } : {}),
    },
  })

  harvestLog('harvest.listing.bind', {
    stage: 'lead_updated',
    leadId: updated.id,
    hostAirbnbId: updated.hostAirbnbId,
    fromListingId: leadListingId,
    toListingId: harvestListingId,
    toListingUrl: bind.listingUrl,
    toListingTitle: bind.listingTitle ?? updated.primaryListingName,
  })

  return updated
}

/**
 * Tras un lead ICP-válido en harvest: envía el cold message en la misma sesión
 * (sin dejarlo en cola LEAD_DISCOVERED para un outbound posterior).
 */
export async function sendColdImmediatelyAfterHarvest(
  page: Page,
  leadId: string,
  accountId: string,
  listingBind?: HarvestSendListingBind,
): Promise<HarvestSendOutcome> {
  if (!isHarvestSendImmediateEnabled()) return 'disabled'

  const coldCheck = await assertColdOutboundAllowed(db, leadId, {
    isIcpEligible: isLeadOutboundEligible,
  })

  if (!coldCheck.allowed) {
    harvestLog('harvest.send.skipped', {
      leadId,
      reason: coldCheck.reason,
      accountId,
      harvestListingUrl: listingBind?.listingUrl,
      harvestListingId: listingBind?.listingId,
    })
    return 'skipped'
  }

  let lead = coldCheck.lead
  if (lead.status !== LeadStatus.LEAD_DISCOVERED) {
    harvestLog('harvest.send.skipped', {
      leadId,
      reason: `status_${lead.status}`,
      accountId,
      harvestListingUrl: listingBind?.listingUrl,
    })
    return 'skipped'
  }

  if (listingBind) {
    lead = await bindLeadToHarvestListing(lead, listingBind)
  }

  const text = buildOutboundMessage(lead, 'PHASE_1_COLD')
  const expectedListingId =
    listingBind?.listingId ?? parseListingIdFromUrl(lead.primaryListingUrl)

  harvestLog('harvest.send.start', {
    leadId: lead.id,
    name: lead.name,
    hostAirbnbId: lead.hostAirbnbId,
    listingUrl: lead.primaryListingUrl,
    listingId: expectedListingId,
    listingName: lead.primaryListingName,
    harvestListingUrl: listingBind?.listingUrl ?? null,
    harvestListingTitle: listingBind?.listingTitle ?? null,
    accountId,
    messagePreview: text.slice(0, 120),
  })

  await startWave(accountId)

  let result
  try {
    result = await sendColdOutboundMessage(page, lead, text, {
      prospectAccountId: accountId,
      expectedListingId: expectedListingId ?? undefined,
    })
    if (
      !result.success &&
      result.skippedReason !== 'existing_thread' &&
      result.error !== 'listing_not_contactable'
    ) {
      harvestTrace('send_retry', {
        leadId: lead.id,
        firstError: result.error,
        listingId: expectedListingId,
      })
      result = await sendColdOutboundMessage(page, lead, text, {
        prospectAccountId: accountId,
        expectedListingId: expectedListingId ?? undefined,
      })
    }
  } catch (error) {
    if (error instanceof AirbnbSendBlockedError) {
      await handleAccountBlock(accountId, error.message, error.blockType)
      harvestLog('harvest.send.blocked', {
        leadId: lead.id,
        accountId,
        blockType: error.blockType,
        message: error.message,
        listingId: expectedListingId,
        listingUrl: lead.primaryListingUrl,
      })
      return 'blocked'
    }
    throw error
  }

  const contactListingId = parseContactHostListingId(page.url())
  if (
    expectedListingId &&
    contactListingId &&
    expectedListingId !== contactListingId
  ) {
    harvestLog('harvest.send.listing_mismatch', {
      stage: 'after_send_attempt',
      leadId: lead.id,
      expectedListingId,
      contactListingId,
      pageUrl: page.url(),
      listingUrl: lead.primaryListingUrl,
    })
  }

  if (result.skippedReason === 'existing_thread' || result.error === 'existing_thread') {
    harvestLog('harvest.send.skipped', {
      leadId: lead.id,
      reason: 'existing_thread',
      threadId: result.threadId,
      accountId,
      listingId: expectedListingId,
      listingUrl: lead.primaryListingUrl,
    })
    return 'skipped'
  }

  if (!result.success || !result.threadId) {
    const failure = await registerColdSendFailure(lead.id, result.error ?? 'unknown')
    harvestLog('harvest.send.failed', {
      leadId: lead.id,
      accountId,
      error: result.error,
      failures: failure.failures,
      quarantined: failure.quarantined,
      listingId: expectedListingId,
      listingUrl: lead.primaryListingUrl,
      pageUrl: page.url(),
    })
    return 'failed'
  }

  const sentAt = new Date()
  await recordOutboundMessage(lead.id, text, 'PHASE_1_COLD', {
    prospectAccountId: accountId,
    market: lead.market,
  })
  await applyOutboundTransition(lead.id, 'PHASE_1_COLD', {
    content: text,
    sentAt,
    threadId: result.threadId,
  })

  const updatedLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } })
  await markHostContacted(db, {
    lead: updatedLead,
    source: ContactSource.OUTBOUND,
    firstContactAccountId: accountId,
    firstContactedAt: sentAt,
  })
  await incrementWaveProgress(accountId)

  harvestLog('harvest.send.success', {
    leadId: lead.id,
    name: lead.name,
    hostAirbnbId: lead.hostAirbnbId,
    threadId: result.threadId,
    accountId,
    listingId: expectedListingId,
    listingUrl: lead.primaryListingUrl,
    listingName: lead.primaryListingName,
  })

  return 'sent'
}
