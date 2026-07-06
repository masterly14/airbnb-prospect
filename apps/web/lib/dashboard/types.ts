import type { AccountStatus, BlockType, LeadStatus } from "@repo/db/client"

export type PeriodMetrics = {
  coldMessagesSent: number
  leadsDiscovered: number
  firstContacts: number
  repliesReceived: number
  humanTakeovers: number
  closedLost: number
  closedWon: number
  replyRate: number | null
  handoffRate: number | null
}

export type DashboardTargets = {
  dailyColdMessages: number
  weeklyColdMessages: number
  monthlyColdMessages: number
  dailyPerCity: Record<string, number>
}

export type CityQuotaSnapshot = {
  sent: number
  quota: number
  pct: number
}

export type IcpPipelineMarket = {
  market: string
  discovered: number
  daysOfRunway: number | null
  lowRunway: boolean
}

export type TrendPoint = {
  date: string
  label: string
  cold: number
  replies: number
  handoffs: number
}

export type AccountSnapshot = {
  id: string
  label: string
  status: AccountStatus
  market: string | null
  messagesSentToday: number
  waveMessagesSent: number
  cooldownUntil: string | null
}

export type BlockEventSnapshot = {
  id: string
  accountLabel: string
  type: BlockType
  occurredAt: string
}

export type DashboardAlerts = {
  humanTakeover: number
  overdueFollowUps: number
  lowRunwayMarkets: string[]
}

export type FunnelSnapshot = {
  total: number
  contacted: number
  replied: number
  handoff: number
  won: number
}

export type StatusCount = {
  status: LeadStatus
  count: number
}

export type DashboardStats = {
  generatedAt: string
  targets: DashboardTargets
  periods: {
    day: PeriodMetrics
    week: PeriodMetrics
    month: PeriodMetrics
  }
  cityQuotas: Record<string, CityQuotaSnapshot>
  icpPipeline: IcpPipelineMarket[]
  pipelineByStatus: StatusCount[]
  trend: TrendPoint[]
  accounts: AccountSnapshot[]
  recentBlocks: BlockEventSnapshot[]
  alerts: DashboardAlerts
  funnel: FunnelSnapshot
}
