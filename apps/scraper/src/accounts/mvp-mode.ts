import { db, type ProspectAccount } from '@repo/db'
import { OPERATIONS } from '../discovery/icp'

/** Cuenta Michell — default operativa para el MVP de una sola cuenta. */
export const DEFAULT_MVP_ACCOUNT_ID = '69b667ad-a532-444e-a084-44ac7943daa8'

export function getMvpAccountId(): string | null {
  const explicit = process.env.MVP_ACCOUNT_ID?.trim()
  if (explicit) return explicit

  if (process.env.MVP_SINGLE_ACCOUNT === 'true') {
    return DEFAULT_MVP_ACCOUNT_ID
  }

  return null
}

export function isMvpSingleAccountMode(): boolean {
  return getMvpAccountId() !== null
}

export function getProspectAccountTarget(): number {
  return isMvpSingleAccountMode() ? 1 : OPERATIONS.PROSPECT_ACCOUNTS
}

export function mvpModeLogContext(): Record<string, unknown> {
  const accountId = getMvpAccountId()
  if (!accountId) return { mvpMode: false }
  return { mvpMode: true, mvpAccountId: accountId }
}

export async function loadMvpAccount(): Promise<ProspectAccount> {
  const accountId = getMvpAccountId()
  if (!accountId) {
    throw new Error('MVP mode is not configured (set MVP_ACCOUNT_ID or MVP_SINGLE_ACCOUNT=true)')
  }

  const account = await db.prospectAccount.findUnique({ where: { id: accountId } })
  if (!account) {
    throw new Error(`MVP account ${accountId} not found in ProspectAccount`)
  }

  return account
}

export function resolveDefaultSyncAccountIds(fallbackIds: readonly string[]): string[] {
  const mvpId = getMvpAccountId()
  if (mvpId) return [mvpId]
  return [...fallbackIds]
}
