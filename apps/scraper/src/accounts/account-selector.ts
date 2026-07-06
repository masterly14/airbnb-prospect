import { AccountStatus, type ProspectAccount, db } from '@repo/db'
import { OPERATIONS } from '../discovery/icp'
import { addHours } from './account-repository'
import { getMvpAccountId, isMvpSingleAccountMode, loadMvpAccount } from './mvp-mode'

/** Tope diario por cuenta: 2 oleadas × 10 msgs (objetivo operativo §2.3). */
export function getDailyMessageCap(): number {
  return OPERATIONS.MSGS_PER_WAVE * OPERATIONS.WAVES_PER_DAY_TARGET
}

export function isAccountEligibleForPick(
  account: ProspectAccount,
  now = new Date(),
): boolean {
  if (account.status === AccountStatus.BLOCKED) return false
  if (
    account.status === AccountStatus.PENDING_CREDENTIALS ||
    account.status === AccountStatus.PENDING_GMAIL ||
    account.status === AccountStatus.VERIFYING
  ) {
    return false
  }

  if (!account.sessionPath) return false
  if (!account.market) return false

  if (account.messagesSentToday >= getDailyMessageCap()) return false

  if (
    account.status === AccountStatus.COOLDOWN &&
    account.cooldownUntil &&
    account.cooldownUntil > now
  ) {
    return false
  }

  return account.status === AccountStatus.ACTIVE || account.status === AccountStatus.COOLDOWN
}

export function sortAccountsForPick(accounts: ProspectAccount[]): ProspectAccount[] {
  return [...accounts].sort((a, b) => {
    if (a.waveMessagesSent !== b.waveMessagesSent) {
      return a.waveMessagesSent - b.waveMessagesSent
    }
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
}

export async function pickNextAccount(
  options: { excludeAccountIds?: string[] } = {},
): Promise<ProspectAccount | null> {
  const now = new Date()
  const excludeAccountIds = options.excludeAccountIds ?? []

  if (isMvpSingleAccountMode()) {
    const account = await loadMvpAccount()
    if (excludeAccountIds.includes(account.id)) return null
    return isAccountEligibleForPick(account, now) ? account : null
  }

  const candidates = await db.prospectAccount.findMany({
    where: {
      status: { in: [AccountStatus.ACTIVE, AccountStatus.COOLDOWN] },
      sessionPath: { not: null },
      market: { not: null },
      messagesSentToday: { lt: getDailyMessageCap() },
      ...(excludeAccountIds.length > 0 ? { id: { notIn: excludeAccountIds } } : {}),
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
    },
  })

  const eligible = sortAccountsForPick(
    candidates.filter((account) => isAccountEligibleForPick(account, now)),
  )

  return eligible[0] ?? null
}

export async function startWave(accountId: string): Promise<ProspectAccount> {
  const account = await db.prospectAccount.findUniqueOrThrow({ where: { id: accountId } })
  const isNewWave =
    account.waveMessagesSent >= OPERATIONS.MSGS_PER_WAVE || !account.lastWaveStartedAt

  return db.prospectAccount.update({
    where: { id: accountId },
    data: {
      lastWaveStartedAt: new Date(),
      ...(isNewWave ? { waveMessagesSent: 0 } : {}),
      status: AccountStatus.ACTIVE,
      cooldownUntil: null,
    },
  })
}

export async function incrementWaveProgress(accountId: string): Promise<ProspectAccount> {
  return db.prospectAccount.update({
    where: { id: accountId },
    data: {
      waveMessagesSent: { increment: 1 },
      messagesSentToday: { increment: 1 },
    },
  })
}

export async function completeWave(
  accountId: string,
  from = new Date(),
): Promise<ProspectAccount> {
  return db.prospectAccount.update({
    where: { id: accountId },
    data: {
      status: AccountStatus.COOLDOWN,
      cooldownUntil: addHours(from, OPERATIONS.COOLDOWN_HOURS),
      waveMessagesSent: 0,
    },
  })
}

export async function reactivateExpiredCooldowns(now = new Date()): Promise<number> {
  const mvpAccountId = getMvpAccountId()

  const result = await db.prospectAccount.updateMany({
    where: {
      status: AccountStatus.COOLDOWN,
      cooldownUntil: { lte: now },
      ...(mvpAccountId ? { id: mvpAccountId } : {}),
    },
    data: {
      status: AccountStatus.ACTIVE,
      cooldownUntil: null,
      waveMessagesSent: 0,
    },
  })

  return result.count
}
