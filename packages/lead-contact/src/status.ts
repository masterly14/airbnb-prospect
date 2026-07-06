import { LeadStatus } from '@repo/db'

export const CONTACTED_STATUSES: LeadStatus[] = [
  LeadStatus.INITIAL_MSG_SENT,
  LeadStatus.FOLLOW_UP_1_SENT,
  LeadStatus.FOLLOW_UP_2_SENT,
  LeadStatus.FOLLOW_UP_3_SENT,
  LeadStatus.REPLIED_IN_PROGRESS,
  LeadStatus.HUMAN_TAKEOVER,
  LeadStatus.CLOSED_WON,
  LeadStatus.CLOSED_LOST,
]

export const STATUS_RANK: Record<LeadStatus, number> = {
  [LeadStatus.LEAD_DISCOVERED]: 0,
  [LeadStatus.INITIAL_MSG_SENT]: 1,
  [LeadStatus.FOLLOW_UP_1_SENT]: 2,
  [LeadStatus.FOLLOW_UP_2_SENT]: 3,
  [LeadStatus.FOLLOW_UP_3_SENT]: 4,
  [LeadStatus.REPLIED_IN_PROGRESS]: 5,
  [LeadStatus.HUMAN_TAKEOVER]: 6,
  [LeadStatus.CLOSED_WON]: 7,
  [LeadStatus.CLOSED_LOST]: 7,
}

export function isLeadContacted(lead: {
  status: LeadStatus
  threadId?: string | null
}): boolean {
  if (lead.status !== LeadStatus.LEAD_DISCOVERED) return true
  if (lead.threadId) return true
  return false
}

export function compareLeadStatus(a: LeadStatus, b: LeadStatus): number {
  return STATUS_RANK[a] - STATUS_RANK[b]
}

export function pickAdvancedStatus(a: LeadStatus, b: LeadStatus): LeadStatus {
  return compareLeadStatus(a, b) >= 0 ? a : b
}
