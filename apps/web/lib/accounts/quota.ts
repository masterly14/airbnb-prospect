import { db } from "@/lib/db"
import { OPERATIONS } from "@/lib/operations/constants"

const COLOMBIA_TZ = "America/Bogota"

export function getTodayDateInColombia(now = new Date()): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: COLOMBIA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const dateKey = formatter.format(now)
  return new Date(`${dateKey}T00:00:00.000Z`)
}

export async function getColdQuotaSnapshot(now = new Date()): Promise<
  Record<string, { sent: number; quota: number }>
> {
  const date = getTodayDateInColombia(now)
  const rows = await db.dailyOutboundStats.findMany({ where: { date } })
  const sentByMarket = Object.fromEntries(
    rows.map((row) => [row.market, row.coldMessagesSent]),
  )

  return Object.fromEntries(
    Object.entries(OPERATIONS.CITY_DAILY_QUOTA).map(([market, quota]) => [
      market,
      { sent: sentByMarket[market] ?? 0, quota },
    ]),
  )
}
