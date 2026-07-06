import dotenv from 'dotenv'
import path from 'path'
import { db } from '@repo/db'
import { reactivateExpiredCooldowns } from '../src/accounts/account-selector'
import { getMvpAccountId, isMvpSingleAccountMode, mvpModeLogContext } from '../src/accounts/mvp-mode'
import { getTodayDateInColombia } from '../src/persistence/daily-outbound-stats'
import {
  ACCOUNTS_LAST_DAILY_RESET_KEY,
} from '../src/persistence/system-state'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

export type AccountReaperReport = {
  timestamp: string
  mvpMode?: boolean
  mvpAccountId?: string
  reactivated: number
  dailyResetApplied: boolean
  accountsReset: number
}

export async function maybeResetDailyMessageCounts(now = new Date()): Promise<{
  applied: boolean
  count: number
}> {
  const today = getTodayDateInColombia(now).toISOString().slice(0, 10)
  const row = await db.systemState.findUnique({
    where: { key: ACCOUNTS_LAST_DAILY_RESET_KEY },
  })

  if (row?.value === today) {
    return { applied: false, count: 0 }
  }

  const mvpAccountId = getMvpAccountId()

  const result = await db.prospectAccount.updateMany({
    where: {
      ...(mvpAccountId ? { id: mvpAccountId } : {}),
    },
    data: { messagesSentToday: 0 },
  })

  await db.systemState.upsert({
    where: { key: ACCOUNTS_LAST_DAILY_RESET_KEY },
    create: { key: ACCOUNTS_LAST_DAILY_RESET_KEY, value: today },
    update: { value: today },
  })

  return { applied: true, count: result.count }
}

export async function runAccountReaper(): Promise<AccountReaperReport> {
  const reactivated = await reactivateExpiredCooldowns()
  const dailyReset = await maybeResetDailyMessageCounts()

  const report: AccountReaperReport = {
    timestamp: new Date().toISOString(),
    mvpMode: isMvpSingleAccountMode(),
    mvpAccountId: getMvpAccountId() ?? undefined,
    reactivated,
    dailyResetApplied: dailyReset.applied,
    accountsReset: dailyReset.count,
  }

  console.log(JSON.stringify({ event: 'account-reaper.complete', ...report, ...mvpModeLogContext() }))

  await db.$disconnect()
  return report
}

if (require.main === module) {
  runAccountReaper().catch((error) => {
    console.error('account-reaper failed:', error)
    process.exit(1)
  })
}
