import { toComposioUserId } from '@repo/composio'
import {
  AccountStatus,
  BlockType,
  type AccountBlockEvent,
  type ProspectAccount,
  db,
} from '@repo/db'
import { OPERATIONS } from '../discovery/icp'
import { notifyAccountCooldown } from '../notifications/notify'

export function addHours(date: Date, hours: number): Date {
  const result = new Date(date)
  result.setTime(result.getTime() + hours * 60 * 60 * 1000)
  return result
}

export function computeAccountStatusAfterBlock(blockType: BlockType, from = new Date()): {
  status: AccountStatus
  rateLimitedAt: Date
  cooldownUntil: Date | null
} {
  if (blockType === BlockType.IDENTITY) {
    return {
      status: AccountStatus.BLOCKED,
      rateLimitedAt: from,
      cooldownUntil: null,
    }
  }

  return {
    status: AccountStatus.COOLDOWN,
    rateLimitedAt: from,
    cooldownUntil: addHours(from, OPERATIONS.COOLDOWN_HOURS),
  }
}

export async function recordBlockEvent(
  accountId: string,
  type: BlockType,
  message: string,
  occurredAt = new Date(),
): Promise<AccountBlockEvent> {
  return db.accountBlockEvent.create({
    data: {
      accountId,
      type,
      message,
      occurredAt,
    },
  })
}

export async function pauseAccountAfterBlock(
  accountId: string,
  blockType: BlockType,
  from = new Date(),
): Promise<ProspectAccount> {
  const next = computeAccountStatusAfterBlock(blockType, from)

  return db.prospectAccount.update({
    where: { id: accountId },
    data: next,
  })
}

export async function handleAccountBlock(
  accountId: string,
  message: string,
  blockType: BlockType,
): Promise<{ event: AccountBlockEvent; account: ProspectAccount }> {
  const event = await recordBlockEvent(accountId, blockType, message)
  const account = await pauseAccountAfterBlock(accountId, blockType)

  await notifyAccountCooldown({
    accountId: account.id,
    label: account.label,
    airbnbEmail: account.airbnbEmail,
    blockType,
    message,
    status: account.status,
    cooldownUntil: account.cooldownUntil,
  })

  return { event, account }
}

/** @deprecated Use pickNextAccount from account-selector.ts */
export async function resolveOutboundProspectAccount(): Promise<ProspectAccount | null> {
  const now = new Date()

  return db.prospectAccount.findFirst({
    where: {
      OR: [
        { status: AccountStatus.ACTIVE },
        {
          status: AccountStatus.COOLDOWN,
          OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
        },
      ],
    },
    orderBy: [{ waveMessagesSent: 'asc' }, { createdAt: 'asc' }],
  })
}

/**
 * Saca la cuenta de rotación cuando su sesión Playwright es inválida
 * (archivo perdido o login expirado): requiere re-login manual.
 */
export async function markAccountSessionInvalid(accountId: string): Promise<ProspectAccount> {
  return db.prospectAccount.update({
    where: { id: accountId },
    data: { status: AccountStatus.PENDING_CREDENTIALS },
  })
}

/**
 * Persiste la sesión recién generada por auto-login y devuelve la cuenta a
 * rotación activa.
 */
export async function markAccountSessionActive(
  accountId: string,
  sessionPath: string,
): Promise<ProspectAccount> {
  return db.prospectAccount.update({
    where: { id: accountId },
    data: {
      sessionPath,
      status: AccountStatus.ACTIVE,
    },
  })
}

export async function assertAccountCanSend(account: ProspectAccount): Promise<void> {
  if (account.status === AccountStatus.BLOCKED) {
    throw new Error(`Prospect account "${account.label}" is blocked (identity verification required).`)
  }

  if (
    account.status === AccountStatus.COOLDOWN &&
    account.cooldownUntil &&
    account.cooldownUntil > new Date()
  ) {
    throw new Error(
      `Prospect account "${account.label}" is in cooldown until ${account.cooldownUntil.toISOString()}.`,
    )
  }
}

export type LegacyAccountSeedInput = {
  label?: string
  airbnbEmail: string
  sessionPath: string
}

export async function upsertLegacyProspectAccount(
  input: LegacyAccountSeedInput,
): Promise<ProspectAccount> {
  const account = await db.prospectAccount.upsert({
    where: { airbnbEmail: input.airbnbEmail },
    create: {
      label: input.label ?? 'Legacy',
      airbnbEmail: input.airbnbEmail,
      sessionPath: input.sessionPath,
      status: AccountStatus.ACTIVE,
    },
    update: {
      label: input.label ?? 'Legacy',
      sessionPath: input.sessionPath,
    },
  })

  const composioUserId = toComposioUserId(account.id)
  if (account.composioUserId === composioUserId) {
    return account
  }

  return db.prospectAccount.update({
    where: { id: account.id },
    data: { composioUserId },
  })
}

export async function ensureLegacyProspectAccount(
  sessionPath: string,
): Promise<ProspectAccount | null> {
  const email = process.env.AIRBNB_EMAIL?.trim()
  if (!email) return null

  return upsertLegacyProspectAccount({
    airbnbEmail: email,
    sessionPath,
    label: process.env.PROSPECT_ACCOUNT_LABEL?.trim() || 'Legacy',
  })
}
