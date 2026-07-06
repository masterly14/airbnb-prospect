import type { Lead, Message } from "@repo/db/client"

export type { Lead, Message }

export enum LeadStatus {
  LEAD_DISCOVERED = "LEAD_DISCOVERED",
  INITIAL_MSG_SENT = "INITIAL_MSG_SENT",
  FOLLOW_UP_1_SENT = "FOLLOW_UP_1_SENT",
  FOLLOW_UP_2_SENT = "FOLLOW_UP_2_SENT",
  FOLLOW_UP_3_SENT = "FOLLOW_UP_3_SENT",
  REPLIED_IN_PROGRESS = "REPLIED_IN_PROGRESS",
  HUMAN_TAKEOVER = "HUMAN_TAKEOVER",
  CLOSED_WON = "CLOSED_WON",
  CLOSED_LOST = "CLOSED_LOST",
}

export enum MessageDirection {
  INBOUND = "INBOUND",
  OUTBOUND = "OUTBOUND",
  SYSTEM = "SYSTEM",
}

export type LeadSummary = Pick<
  Lead,
  | "id"
  | "name"
  | "status"
  | "totalProperties"
  | "primaryListingName"
  | "executiveSummary"
  | "calLinkSent"
  | "isSuperhost"
  | "market"
  | "createdAt"
  | "nextFollowUpAt"
>

export type LeadDetail = Lead & {
  messages: Message[]
}

export interface LeadFilters {
  q?: string
  status?: LeadStatus[]
  minProperties?: number
  maxProperties?: number
  superhostOnly?: boolean
  alertsOnly?: boolean
}

export type CreateManualLeadInput = {
  name: string
  companyName?: string
  hostProfileUrl?: string
  primaryListingUrl?: string
  threadUrl?: string
  market?: string
  status?: LeadStatus
  notes?: string
}

export type LeadLookupMatch = {
  id: string
  name: string
  companyName: string | null
  status: LeadStatus
  hostAirbnbId: string
  hostProfileUrl: string
  primaryListingUrl: string
  threadId: string | null
  market: string | null
  lastContactedAt: Date | null
  contacted: boolean
  matchReasons: string[]
}
