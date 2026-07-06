import { LeadStatus } from "./types"

export const LEAD_STATUS_ORDER: LeadStatus[] = [
  LeadStatus.LEAD_DISCOVERED,
  LeadStatus.INITIAL_MSG_SENT,
  LeadStatus.FOLLOW_UP_1_SENT,
  LeadStatus.FOLLOW_UP_2_SENT,
  LeadStatus.FOLLOW_UP_3_SENT,
  LeadStatus.REPLIED_IN_PROGRESS,
  LeadStatus.HUMAN_TAKEOVER,
  LeadStatus.CLOSED_WON,
  LeadStatus.CLOSED_LOST,
]

export const STATUS_LABELS: Record<LeadStatus, string> = {
  [LeadStatus.LEAD_DISCOVERED]: "Descubierto",
  [LeadStatus.INITIAL_MSG_SENT]: "Primer contacto",
  [LeadStatus.FOLLOW_UP_1_SENT]: "Follow-up 1",
  [LeadStatus.FOLLOW_UP_2_SENT]: "Follow-up 2",
  [LeadStatus.FOLLOW_UP_3_SENT]: "Follow-up 3",
  [LeadStatus.REPLIED_IN_PROGRESS]: "En conversación",
  [LeadStatus.HUMAN_TAKEOVER]: "Requiere humano",
  [LeadStatus.CLOSED_WON]: "Ganado",
  [LeadStatus.CLOSED_LOST]: "Perdido",
}

export const STATUS_COLORS: Record<LeadStatus, string> = {
  [LeadStatus.LEAD_DISCOVERED]: "border-white/10",
  [LeadStatus.INITIAL_MSG_SENT]: "border-white/10",
  [LeadStatus.FOLLOW_UP_1_SENT]: "border-white/10",
  [LeadStatus.FOLLOW_UP_2_SENT]: "border-white/10",
  [LeadStatus.FOLLOW_UP_3_SENT]: "border-white/10",
  [LeadStatus.REPLIED_IN_PROGRESS]: "border-primary/50",
  [LeadStatus.HUMAN_TAKEOVER]: "border-destructive",
  [LeadStatus.CLOSED_WON]: "border-emerald-500/50",
  [LeadStatus.CLOSED_LOST]: "border-white/10 opacity-50",
}
