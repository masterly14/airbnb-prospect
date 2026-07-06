import { db, LeadStatus, MessageDirection, type Lead } from '@repo/db'
import { isClusterContacted, isLeadContacted, resolveLeadIdentityCluster } from '@repo/lead-contact'
import { ICP, isLeadOutboundEligible } from '../discovery/icp'
import { getMarketsAtQuota, incrementColdSent } from './daily-outbound-stats'

export type OutboundPhase =
  | 'PHASE_1_COLD'
  | 'PHASE_2_OPS'
  | 'PHASE_3_BI'
  | 'PHASE_4_BREAKUP'

export const STATUS_TO_PHASE: Partial<Record<LeadStatus, OutboundPhase>> = {
  [LeadStatus.LEAD_DISCOVERED]: 'PHASE_1_COLD',
  [LeadStatus.INITIAL_MSG_SENT]: 'PHASE_2_OPS',
  [LeadStatus.FOLLOW_UP_1_SENT]: 'PHASE_3_BI',
  [LeadStatus.FOLLOW_UP_2_SENT]: 'PHASE_4_BREAKUP',
}

export const PHASE_TRANSITIONS: Record<
  OutboundPhase,
  { nextStatus: LeadStatus; delayEnvKey: string; defaultDelayDays: number }
> = {
  PHASE_1_COLD: {
    nextStatus: LeadStatus.INITIAL_MSG_SENT,
    delayEnvKey: 'OUTBOUND_FU1_DELAY_DAYS',
    defaultDelayDays: 3,
  },
  PHASE_2_OPS: {
    nextStatus: LeadStatus.FOLLOW_UP_1_SENT,
    delayEnvKey: 'OUTBOUND_FU2_DELAY_DAYS',
    defaultDelayDays: 5,
  },
  PHASE_3_BI: {
    nextStatus: LeadStatus.FOLLOW_UP_2_SENT,
    delayEnvKey: 'OUTBOUND_FU3_DELAY_DAYS',
    defaultDelayDays: 7,
  },
  PHASE_4_BREAKUP: {
    nextStatus: LeadStatus.CLOSED_LOST,
    delayEnvKey: '',
    defaultDelayDays: 0,
  },
}

function requireEnrichment(): boolean {
  return process.env.OUTBOUND_REQUIRE_ENRICHMENT === 'true'
}

function delayDays(envKey: string, defaultDays: number): number {
  if (!envKey) return 0
  const raw = process.env[envKey]
  const parsed = raw ? Number.parseInt(raw, 10) : defaultDays
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultDays
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function includesCalLink(text: string): boolean {
  return text.toLowerCase().includes('cal.com')
}

export function phaseForStatus(status: LeadStatus): OutboundPhase | null {
  return STATUS_TO_PHASE[status] ?? null
}

export function nextFollowUpForPhase(phase: OutboundPhase, from: Date): Date | null {
  const transition = PHASE_TRANSITIONS[phase]
  if (phase === 'PHASE_4_BREAKUP') return null
  const days = delayDays(transition.delayEnvKey, transition.defaultDelayDays)
  return addDays(from, days)
}

export function isColdLeadEligible(lead: Lead): boolean {
  return isLeadOutboundEligible(lead)
}

export type EligibleLeadOptions = {
  excludeMarketsAtQuota?: string[]
  /** Leads que ya fallaron/saltaron en este run: evita reintentos infinitos. */
  excludeLeadIds?: string[]
  /** Solo leads de esta ciudad (cuenta de prospección). */
  market?: string
}

export async function findEligibleColdLeads(
  limit: number,
  options: EligibleLeadOptions = {},
): Promise<Lead[]> {
  const where: {
    status: LeadStatus
    threadId: null
    totalProperties: { gte: number; lte: number }
    isSuperhost: boolean
    icpSkipReason: null
    businessScale?: { not: null }
    market?: { notIn: string[] }
    id?: { notIn: string[] }
    hostContact?: { is: null }
    messages?: { none: { direction: MessageDirection } }
  } = {
    status: LeadStatus.LEAD_DISCOVERED,
    threadId: null,
    totalProperties: {
      gte: ICP.MIN_PROPERTIES,
      lte: ICP.MAX_PROPERTIES,
    },
    isSuperhost: ICP.REQUIRE_SUPERHOST,
    icpSkipReason: null,
    hostContact: { is: null },
    messages: { none: { direction: MessageDirection.OUTBOUND } },
  }


  if (requireEnrichment()) {
    where.businessScale = { not: null }
  }

  if (options.market) {
    where.market = options.market
  } else if (options.excludeMarketsAtQuota && options.excludeMarketsAtQuota.length > 0) {
    where.market = { notIn: options.excludeMarketsAtQuota }
  }

  if (options.excludeLeadIds && options.excludeLeadIds.length > 0) {
    where.id = { notIn: options.excludeLeadIds }
  }

  const leads = await db.lead.findMany({
    where,
    take: limit * 4,
    orderBy: [{ market: 'asc' }, { createdAt: 'asc' }],
  })

  const eligible: Lead[] = []
  for (const lead of leads) {
    if (!isColdLeadEligible(lead) || isLeadContacted(lead)) continue
    const cluster = await resolveLeadIdentityCluster(db, lead)
    const clusterStatus = await isClusterContacted(db, cluster)
    if (clusterStatus.contacted) continue
    eligible.push(lead)
    if (eligible.length >= limit) break
  }

  return eligible
}

export async function findEligibleFollowUpLeads(
  limit: number,
  options: Pick<EligibleLeadOptions, 'excludeLeadIds' | 'market'> = {},
): Promise<Lead[]> {
  return db.lead.findMany({
    where: {
      status: {
        in: [
          LeadStatus.INITIAL_MSG_SENT,
          LeadStatus.FOLLOW_UP_1_SENT,
          LeadStatus.FOLLOW_UP_2_SENT,
        ],
      },
      threadId: { not: null },
      nextFollowUpAt: { lte: new Date() },
      ...(options.market ? { market: options.market } : {}),
      ...(options.excludeLeadIds && options.excludeLeadIds.length > 0
        ? { id: { notIn: options.excludeLeadIds } }
        : {}),
    },
    take: limit,
    orderBy: { nextFollowUpAt: 'asc' },
  })
}

export async function findEligibleOutboundLeads(
  limit: number,
  options: EligibleLeadOptions = {},
): Promise<Lead[]> {
  const batchSize = limit
  const followUps = await findEligibleFollowUpLeads(batchSize, options)
  const remaining = batchSize - followUps.length

  if (remaining <= 0) return followUps

  const cold = await findEligibleColdLeads(remaining, options)
  return [...followUps, ...cold]
}

/**
 * Conteo ligero de leads fríos elegibles en cola (mismo filtro base que
 * `findEligibleColdLeads`, sin la verificación por cluster). Lo usa el
 * orquestador para decidir si el pipeline está bajo y debe hacer harvest.
 */
export async function countColdPipeline(): Promise<number> {
  const where: {
    status: LeadStatus
    threadId: null
    totalProperties: { gte: number; lte: number }
    isSuperhost: boolean
    icpSkipReason: null
    businessScale?: { not: null }
    hostContact: { is: null }
    messages: { none: { direction: MessageDirection } }
  } = {
    status: LeadStatus.LEAD_DISCOVERED,
    threadId: null,
    totalProperties: {
      gte: ICP.MIN_PROPERTIES,
      lte: ICP.MAX_PROPERTIES,
    },
    isSuperhost: ICP.REQUIRE_SUPERHOST,
    icpSkipReason: null,
    hostContact: { is: null },
    messages: { none: { direction: MessageDirection.OUTBOUND } },
  }

  if (requireEnrichment()) {
    where.businessScale = { not: null }
  }

  return db.lead.count({ where })
}

export async function hasEligibleOutboundLeads(
  options: Pick<EligibleLeadOptions, 'excludeLeadIds' | 'market'> = {},
): Promise<boolean> {
  const followUps = await findEligibleFollowUpLeads(1, options)
  if (followUps.length > 0) return true

  const marketsAtQuota = await getMarketsAtQuota()
  const cold = await findEligibleColdLeads(1, {
    excludeMarketsAtQuota: marketsAtQuota,
    excludeLeadIds: options.excludeLeadIds,
  })
  return cold.length > 0
}

export async function recordOutboundMessage(
  leadId: string,
  content: string,
  phase: OutboundPhase,
  options: { prospectAccountId?: string; market?: string | null } = {},
): Promise<void> {
  await db.message.create({
    data: {
      leadId,
      direction: MessageDirection.OUTBOUND,
      content,
      aiIntent: phase,
      prospectAccountId: options.prospectAccountId ?? null,
    },
  })

  if (phase === 'PHASE_1_COLD' && options.market) {
    await incrementColdSent(options.market)
  }
}

/** Marca `aiIntent` para contar fallos de envío en frío por lead. */
export const COLD_SEND_FAILURE_INTENT = 'COLD_SEND_FAILURE'

/**
 * Tope de fallos de envío en frío antes de sacar el lead de la cola. Evita que
 * un anuncio irresoluble (sin compositor, retirado, timeout de locator) se
 * reintente en cada oleada y consuma un turno indefinidamente.
 */
export const MAX_COLD_SEND_FAILURES = Number.parseInt(
  process.env.OUTBOUND_MAX_COLD_SEND_FAILURES ?? '3',
  10,
)

export type ColdSendFailureResult = {
  failures: number
  quarantined: boolean
}

/**
 * Registra un fallo de envío en frío y, al alcanzar `MAX_COLD_SEND_FAILURES`,
 * mueve el lead a `CLOSED_LOST` para que no se vuelva a seleccionar.
 */
export async function registerColdSendFailure(
  leadId: string,
  error: string,
): Promise<ColdSendFailureResult> {
  await db.message.create({
    data: {
      leadId,
      direction: MessageDirection.SYSTEM,
      content: error.slice(0, 2_000),
      aiIntent: COLD_SEND_FAILURE_INTENT,
    },
  })

  const failures = await db.message.count({
    where: {
      leadId,
      direction: MessageDirection.SYSTEM,
      aiIntent: COLD_SEND_FAILURE_INTENT,
    },
  })

  if (failures < MAX_COLD_SEND_FAILURES) {
    return { failures, quarantined: false }
  }

  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (lead && lead.status === LeadStatus.LEAD_DISCOVERED) {
    await db.lead.update({
      where: { id: leadId },
      data: { status: LeadStatus.CLOSED_LOST, nextFollowUpAt: null },
    })
  }

  return { failures, quarantined: true }
}

export type ApplyOutboundTransitionInput = {
  threadId?: string | null
  sentAt?: Date
  content: string
}

export async function applyOutboundTransition(
  leadId: string,
  phase: OutboundPhase,
  input: ApplyOutboundTransitionInput,
): Promise<Lead> {
  const sentAt = input.sentAt ?? new Date()
  const transition = PHASE_TRANSITIONS[phase]
  const nextFollowUpAt = nextFollowUpForPhase(phase, sentAt)
  const calLinkInMessage = includesCalLink(input.content)

  const data: {
    status: LeadStatus
    lastContactedAt: Date
    nextFollowUpAt: Date | null
    threadId?: string
    calLinkSent?: boolean
  } = {
    status: transition.nextStatus,
    lastContactedAt: sentAt,
    nextFollowUpAt,
  }

  if (input.threadId) {
    data.threadId = input.threadId
  }

  if (calLinkInMessage) {
    data.calLinkSent = true
  }

  return db.lead.update({
    where: { id: leadId },
    data,
  })
}
