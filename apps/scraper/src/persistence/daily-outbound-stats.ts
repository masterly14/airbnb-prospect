import { db } from '@repo/db'
import { OPERATIONS } from '../discovery/icp'

const COLOMBIA_TZ = 'America/Bogota'

export function getTodayDateInColombia(now = new Date()): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: COLOMBIA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const dateKey = formatter.format(now)
  return new Date(`${dateKey}T00:00:00.000Z`)
}

/** Una sola query para todos los mercados del día (evita N+1 por mensaje). */
export async function getColdSentByMarket(now = new Date()): Promise<Record<string, number>> {
  const date = getTodayDateInColombia(now)
  const rows = await db.dailyOutboundStats.findMany({ where: { date } })
  return Object.fromEntries(rows.map((row) => [row.market, row.coldMessagesSent]))
}

export async function getColdSentToday(market: string, now = new Date()): Promise<number> {
  const sentByMarket = await getColdSentByMarket(now)
  return sentByMarket[market] ?? 0
}

export function getCityDailyQuota(market: string): number | null {
  const quota = OPERATIONS.CITY_DAILY_QUOTA[market as keyof typeof OPERATIONS.CITY_DAILY_QUOTA]
  return quota ?? null
}

export async function getMarketsAtQuota(now = new Date()): Promise<string[]> {
  const sentByMarket = await getColdSentByMarket(now)

  return Object.entries(OPERATIONS.CITY_DAILY_QUOTA)
    .filter(([market, quota]) => (sentByMarket[market] ?? 0) >= quota)
    .map(([market]) => market)
}

export async function incrementColdSent(market: string, now = new Date()): Promise<void> {
  const date = getTodayDateInColombia(now)

  await db.dailyOutboundStats.upsert({
    where: { date_market: { date, market } },
    create: { date, market, coldMessagesSent: 1 },
    update: { coldMessagesSent: { increment: 1 } },
  })
}

export async function getColdQuotaSnapshot(now = new Date()): Promise<
  Record<string, { sent: number; quota: number }>
> {
  const sentByMarket = await getColdSentByMarket(now)

  return Object.fromEntries(
    Object.entries(OPERATIONS.CITY_DAILY_QUOTA).map(([market, quota]) => [
      market,
      { sent: sentByMarket[market] ?? 0, quota },
    ]),
  )
}
