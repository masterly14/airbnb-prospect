const COLOMBIA_TZ = "America/Bogota"

export type DashboardPeriod = "day" | "week" | "month"

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

export function getPeriodStart(period: DashboardPeriod, now = new Date()): Date {
  const today = getTodayDateInColombia(now)
  if (period === "day") return today

  const start = new Date(today)
  if (period === "week") {
    start.setUTCDate(start.getUTCDate() - 6)
    return start
  }

  start.setUTCDate(start.getUTCDate() - 29)
  return start
}

export function formatColombiaDate(date: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: COLOMBIA_TZ,
    day: "numeric",
    month: "short",
  }).format(date)
}

export function getTrendDays(count: number, now = new Date()): Date[] {
  const today = getTodayDateInColombia(now)
  const days: Date[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const day = new Date(today)
    day.setUTCDate(day.getUTCDate() - offset)
    days.push(day)
  }
  return days
}
