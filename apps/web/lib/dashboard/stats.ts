import {
  LeadStatus,
  MessageDirection,
} from "@repo/db"
import { db } from "@/lib/db"
import { getColdQuotaSnapshot } from "@/lib/accounts/quota"
import { OPERATIONS } from "@/lib/operations/constants"
import { ICP, ICP_PIPELINE_WEEK_THRESHOLD, icpEligibleLeadWhere } from "./icp"
import {
  formatColombiaDate,
  getPeriodStart,
  getTodayDateInColombia,
  getTrendDays,
} from "./time-range"
import type {
  DashboardStats,
  PeriodMetrics,
  StatusCount,
} from "./types"

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

async function countColdMessagesSince(since: Date): Promise<number> {
  const rows = await db.dailyOutboundStats.findMany({
    where: { date: { gte: since } },
    select: { coldMessagesSent: true },
  })
  return rows.reduce((sum, row) => sum + row.coldMessagesSent, 0)
}

async function buildPeriodMetrics(since: Date): Promise<PeriodMetrics> {
  const [
    coldMessagesSent,
    leadsDiscovered,
    firstContacts,
    repliesReceived,
    humanTakeovers,
    closedLost,
    closedWon,
  ] = await Promise.all([
    countColdMessagesSince(since),
    db.lead.count({ where: { createdAt: { gte: since } } }),
    db.hostContact.count({ where: { firstContactedAt: { gte: since } } }),
    db.message.count({
      where: { direction: MessageDirection.INBOUND, sentAt: { gte: since } },
    }),
    db.lead.count({
      where: { status: LeadStatus.HUMAN_TAKEOVER, updatedAt: { gte: since } },
    }),
    db.lead.count({
      where: { status: LeadStatus.CLOSED_LOST, updatedAt: { gte: since } },
    }),
    db.lead.count({
      where: { status: LeadStatus.CLOSED_WON, updatedAt: { gte: since } },
    }),
  ])

  const contactedInPeriod = firstContacts
  const repliedStatuses = [
    LeadStatus.REPLIED_IN_PROGRESS,
    LeadStatus.HUMAN_TAKEOVER,
    LeadStatus.CLOSED_WON,
  ] as const

  const repliedLeads = await db.lead.count({
    where: {
      status: { in: [...repliedStatuses] },
      messages: {
        some: {
          direction: MessageDirection.INBOUND,
          sentAt: { gte: since },
        },
      },
    },
  })

  return {
    coldMessagesSent,
    leadsDiscovered,
    firstContacts: contactedInPeriod,
    repliesReceived,
    humanTakeovers,
    closedLost,
    closedWon,
    replyRate: rate(repliedLeads, contactedInPeriod),
    handoffRate: rate(humanTakeovers, repliedLeads),
  }
}

async function buildIcpPipeline(): Promise<DashboardStats["icpPipeline"]> {
  const markets = [...ICP.MARKETS]
  const counts = await Promise.all(
    markets.map(async (market) => {
      const discovered = await db.lead.count({
        where: { ...icpEligibleLeadWhere(), market },
      })
      const dailyQuota = OPERATIONS.CITY_DAILY_QUOTA[market as keyof typeof OPERATIONS.CITY_DAILY_QUOTA] ?? 0
      const daysOfRunway =
        dailyQuota > 0 ? Math.round((discovered / dailyQuota) * 10) / 10 : null
      return {
        market,
        discovered,
        daysOfRunway,
        lowRunway: daysOfRunway != null && daysOfRunway < ICP_PIPELINE_WEEK_THRESHOLD,
      }
    }),
  )
  return counts
}

async function buildTrend(): Promise<DashboardStats["trend"]> {
  const days = getTrendDays(14)
  const start = days[0] ?? getTodayDateInColombia()

  const [coldRows, inboundMessages, handoffLeads] = await Promise.all([
    db.dailyOutboundStats.findMany({
      where: { date: { gte: start } },
      select: { date: true, coldMessagesSent: true },
    }),
    db.message.findMany({
      where: {
        direction: MessageDirection.INBOUND,
        sentAt: { gte: start },
      },
      select: { sentAt: true },
    }),
    db.lead.findMany({
      where: {
        status: LeadStatus.HUMAN_TAKEOVER,
        updatedAt: { gte: start },
      },
      select: { updatedAt: true },
    }),
  ])

  const coldByDay = new Map<string, number>()
  for (const row of coldRows) {
    const key = row.date.toISOString().slice(0, 10)
    coldByDay.set(key, (coldByDay.get(key) ?? 0) + row.coldMessagesSent)
  }

  const repliesByDay = new Map<string, number>()
  for (const message of inboundMessages) {
    const day = getTodayDateInColombia(message.sentAt).toISOString().slice(0, 10)
    repliesByDay.set(day, (repliesByDay.get(day) ?? 0) + 1)
  }

  const handoffsByDay = new Map<string, number>()
  for (const lead of handoffLeads) {
    const day = getTodayDateInColombia(lead.updatedAt).toISOString().slice(0, 10)
    handoffsByDay.set(day, (handoffsByDay.get(day) ?? 0) + 1)
  }

  return days.map((day) => {
    const key = day.toISOString().slice(0, 10)
    return {
      date: key,
      label: formatColombiaDate(day),
      cold: coldByDay.get(key) ?? 0,
      replies: repliesByDay.get(key) ?? 0,
      handoffs: handoffsByDay.get(key) ?? 0,
    }
  })
}

async function buildPipelineByStatus(): Promise<StatusCount[]> {
  const grouped = await db.lead.groupBy({
    by: ["status"],
    _count: { _all: true },
  })

  const order = Object.values(LeadStatus)
  return order
    .map((status) => ({
      status,
      count: grouped.find((row) => row.status === status)?._count._all ?? 0,
    }))
    .filter((row) => row.count > 0)
}

async function buildAlerts(): Promise<DashboardStats["alerts"]> {
  const now = new Date()
  const [humanTakeover, overdueFollowUps, icpPipeline] = await Promise.all([
    db.lead.count({ where: { status: LeadStatus.HUMAN_TAKEOVER } }),
    db.lead.count({
      where: {
        status: {
          notIn: [LeadStatus.HUMAN_TAKEOVER, LeadStatus.CLOSED_WON, LeadStatus.CLOSED_LOST],
        },
        nextFollowUpAt: { lt: now },
      },
    }),
    buildIcpPipeline(),
  ])

  return {
    humanTakeover,
    overdueFollowUps,
    lowRunwayMarkets: icpPipeline.filter((m) => m.lowRunway).map((m) => m.market),
  }
}

async function buildFunnel(): Promise<DashboardStats["funnel"]> {
  const [total, discovered, replied, handoff, won] = await Promise.all([
    db.lead.count(),
    db.lead.count({ where: { status: LeadStatus.LEAD_DISCOVERED } }),
    db.lead.count({
      where: {
        status: {
          in: [
            LeadStatus.REPLIED_IN_PROGRESS,
            LeadStatus.HUMAN_TAKEOVER,
            LeadStatus.CLOSED_WON,
          ],
        },
      },
    }),
    db.lead.count({ where: { status: LeadStatus.HUMAN_TAKEOVER } }),
    db.lead.count({ where: { status: LeadStatus.CLOSED_WON } }),
  ])

  return {
    total,
    contacted: total - discovered,
    replied,
    handoff,
    won,
  }
}

export async function getDashboardStats(now = new Date()): Promise<DashboardStats> {
  const dailyTarget = Object.values(OPERATIONS.CITY_DAILY_QUOTA).reduce(
    (sum, quota) => sum + quota,
    0,
  )

  const [
    day,
    week,
    month,
    cityQuotasRaw,
    icpPipeline,
    pipelineByStatus,
    trend,
    accountsRaw,
    recentBlocksRaw,
    alerts,
    funnel,
  ] = await Promise.all([
    buildPeriodMetrics(getPeriodStart("day", now)),
    buildPeriodMetrics(getPeriodStart("week", now)),
    buildPeriodMetrics(getPeriodStart("month", now)),
    getColdQuotaSnapshot(now),
    buildIcpPipeline(),
    buildPipelineByStatus(),
    buildTrend(),
    db.prospectAccount.findMany({
      orderBy: [{ status: "asc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        status: true,
        market: true,
        messagesSentToday: true,
        waveMessagesSent: true,
        cooldownUntil: true,
      },
    }),
    db.accountBlockEvent.findMany({
      orderBy: { occurredAt: "desc" },
      take: 8,
      include: { account: { select: { label: true } } },
    }),
    buildAlerts(),
    buildFunnel(),
  ])

  const cityQuotas = Object.fromEntries(
    Object.entries(cityQuotasRaw).map(([market, { sent, quota }]) => [
      market,
      { sent, quota, pct: quota > 0 ? Math.min(100, Math.round((sent / quota) * 100)) : 0 },
    ]),
  )

  return {
    generatedAt: now.toISOString(),
    targets: {
      dailyColdMessages: dailyTarget,
      weeklyColdMessages: dailyTarget * 7,
      monthlyColdMessages: dailyTarget * 30,
      dailyPerCity: { ...OPERATIONS.CITY_DAILY_QUOTA },
    },
    periods: { day, week, month },
    cityQuotas,
    icpPipeline,
    pipelineByStatus,
    trend,
    accounts: accountsRaw.map((account) => ({
      id: account.id,
      label: account.label,
      status: account.status,
      market: account.market,
      messagesSentToday: account.messagesSentToday,
      waveMessagesSent: account.waveMessagesSent,
      cooldownUntil: account.cooldownUntil?.toISOString() ?? null,
    })),
    recentBlocks: recentBlocksRaw.map((event) => ({
      id: event.id,
      accountLabel: event.account.label,
      type: event.type,
      occurredAt: event.occurredAt.toISOString(),
    })),
    alerts,
    funnel,
  }
}
