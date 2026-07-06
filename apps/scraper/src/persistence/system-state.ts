import { db } from '@repo/db'

export const PLAYWRIGHT_MUTEX_KEY = 'IS_PLAYWRIGHT_RUNNING'
export const PLAYWRIGHT_ACTIVE_ACCOUNT_KEY = 'PLAYWRIGHT_ACTIVE_ACCOUNT'
export const HARVEST_LAST_MARKET_INDEX_KEY = 'HARVEST_LAST_MARKET_INDEX'
export const ACCOUNTS_LAST_DAILY_RESET_KEY = 'ACCOUNTS_LAST_DAILY_RESET'

export async function acquirePlaywrightMutex(): Promise<boolean> {
  const existing = await db.systemState.findUnique({
    where: { key: PLAYWRIGHT_MUTEX_KEY },
  })

  if (existing?.value === 'true') {
    return false
  }

  await db.systemState.upsert({
    where: { key: PLAYWRIGHT_MUTEX_KEY },
    create: { key: PLAYWRIGHT_MUTEX_KEY, value: 'true' },
    update: { value: 'true' },
  })

  return true
}

export async function releasePlaywrightMutex(): Promise<void> {
  await db.systemState.upsert({
    where: { key: PLAYWRIGHT_MUTEX_KEY },
    create: { key: PLAYWRIGHT_MUTEX_KEY, value: 'false' },
    update: { value: 'false' },
  })

  await setActivePlaywrightAccount(null)
}

export async function setActivePlaywrightAccount(accountId: string | null): Promise<void> {
  if (!accountId) {
    await db.systemState.deleteMany({ where: { key: PLAYWRIGHT_ACTIVE_ACCOUNT_KEY } })
    return
  }

  await db.systemState.upsert({
    where: { key: PLAYWRIGHT_ACTIVE_ACCOUNT_KEY },
    create: { key: PLAYWRIGHT_ACTIVE_ACCOUNT_KEY, value: accountId },
    update: { value: accountId },
  })
}

export async function getActivePlaywrightAccountId(): Promise<string | null> {
  const row = await db.systemState.findUnique({
    where: { key: PLAYWRIGHT_ACTIVE_ACCOUNT_KEY },
  })
  return row?.value ?? null
}

export async function getNextMarketIndex(marketCount: number): Promise<number> {
  if (marketCount <= 0) return 0

  const row = await db.systemState.findUnique({
    where: { key: HARVEST_LAST_MARKET_INDEX_KEY },
  })

  const lastIndex = row ? Number.parseInt(row.value, 10) : -1
  const nextIndex = Number.isFinite(lastIndex)
    ? (lastIndex + 1) % marketCount
    : 0

  await db.systemState.upsert({
    where: { key: HARVEST_LAST_MARKET_INDEX_KEY },
    create: { key: HARVEST_LAST_MARKET_INDEX_KEY, value: String(nextIndex) },
    update: { value: String(nextIndex) },
  })

  return nextIndex
}
