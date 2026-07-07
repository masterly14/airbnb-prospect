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

const HARVEST_PAGE_PREFIX = 'HARVEST_SEARCH_PAGE:'

/** Página numerada del buscador desde la que continuar por mercado (1-based). */
export async function getHarvestSearchPage(marketKey: string): Promise<number> {
  const key = `${HARVEST_PAGE_PREFIX}${marketKey}`
  const row = await db.systemState.findUnique({ where: { key } })
  const value = row ? Number.parseInt(row.value, 10) : 1
  return Number.isFinite(value) && value >= 1 ? value : 1
}

export async function setHarvestSearchPage(marketKey: string, pageNum: number): Promise<void> {
  const key = `${HARVEST_PAGE_PREFIX}${marketKey}`
  const value = String(Math.max(1, pageNum))
  await db.systemState.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
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
