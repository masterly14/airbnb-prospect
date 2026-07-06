import { AccountStatus, type Prisma } from "@repo/db"
import { encryptSecret } from "@repo/crypto"
import { toComposioUserId } from "@repo/composio"
import { db } from "@/lib/db"
import type {
  AccountBlockSummary,
  CreateAccountInput,
  ProspectAccountSummary,
  UpdateAccountInput,
} from "./types"

function toSummary(
  account: Prisma.ProspectAccountGetPayload<{ include: { blockEvents: true } }>,
): ProspectAccountSummary {
  return {
    id: account.id,
    label: account.label,
    airbnbEmail: account.airbnbEmail,
    market: account.market as ProspectAccountSummary["market"],
    composioUserId: account.composioUserId,
    composioConnectionId: account.composioConnectionId,
    composioConnectedAt: account.composioConnectedAt,
    proxyHost: account.proxyHost,
    proxyPort: account.proxyPort,
    proxyUser: account.proxyUser,
    sessionPath: account.sessionPath,
    messagesSentToday: account.messagesSentToday,
    waveMessagesSent: account.waveMessagesSent,
    status: account.status,
    rateLimitedAt: account.rateLimitedAt,
    cooldownUntil: account.cooldownUntil,
    lastWaveStartedAt: account.lastWaveStartedAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    recentBlocks: account.blockEvents.map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      occurredAt: event.occurredAt,
    })),
  }
}

export async function listAccounts(): Promise<ProspectAccountSummary[]> {
  const accounts = await db.prospectAccount.findMany({
    include: {
      blockEvents: {
        orderBy: { occurredAt: "desc" },
        take: 3,
      },
    },
    orderBy: [{ status: "asc" }, { label: "asc" }],
  })

  return accounts.map(toSummary)
}

export async function createAccount(input: CreateAccountInput): Promise<ProspectAccountSummary> {
  let status: AccountStatus = AccountStatus.PENDING_GMAIL
  if (input.sessionPath) {
    status = AccountStatus.ACTIVE
  }

  const account = await db.prospectAccount.create({
    data: {
      label: input.label.trim(),
      airbnbEmail: input.airbnbEmail.trim().toLowerCase(),
      market: input.market,
      airbnbPasswordEnc: input.password ? encryptSecret(input.password) : null,
      proxyHost: input.proxyHost?.trim() || null,
      proxyPort: input.proxyPort ?? null,
      proxyUser: input.proxyUser?.trim() || null,
      proxyPassEnc: input.proxyPass ? encryptSecret(input.proxyPass) : null,
      sessionPath: input.sessionPath?.trim() || null,
      status,
    },
    include: {
      blockEvents: { orderBy: { occurredAt: "desc" }, take: 3 },
    },
  })

  return toSummary(account)
}

export async function updateAccount(
  id: string,
  input: UpdateAccountInput,
): Promise<ProspectAccountSummary | null> {
  const exists = await db.prospectAccount.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return null

  const data: Prisma.ProspectAccountUpdateInput = {}

  if (input.label !== undefined) data.label = input.label.trim()
  if (input.status !== undefined) data.status = input.status
  if (input.market !== undefined) data.market = input.market
  if (input.proxyHost !== undefined) data.proxyHost = input.proxyHost
  if (input.proxyPort !== undefined) data.proxyPort = input.proxyPort
  if (input.proxyUser !== undefined) data.proxyUser = input.proxyUser
  if (input.sessionPath !== undefined) data.sessionPath = input.sessionPath
  if (input.proxyPass) data.proxyPassEnc = encryptSecret(input.proxyPass)

  const account = await db.prospectAccount.update({
    where: { id },
    data,
    include: {
      blockEvents: { orderBy: { occurredAt: "desc" }, take: 3 },
    },
  })

  return toSummary(account)
}

export async function listAccountBlocks(accountId: string): Promise<AccountBlockSummary[]> {
  const events = await db.accountBlockEvent.findMany({
    where: { accountId },
    orderBy: { occurredAt: "desc" },
    take: 50,
  })

  return events.map((event) => ({
    id: event.id,
    type: event.type,
    message: event.message,
    occurredAt: event.occurredAt,
  }))
}

export async function getAccountById(id: string): Promise<ProspectAccountSummary | null> {
  const account = await db.prospectAccount.findUnique({
    where: { id },
    include: {
      blockEvents: { orderBy: { occurredAt: "desc" }, take: 3 },
    },
  })

  return account ? toSummary(account) : null
}

function resolveStatusAfterGmailConnect(account: {
  sessionPath: string | null
  airbnbPasswordEnc: string | null
}): AccountStatus {
  if (account.sessionPath) return AccountStatus.ACTIVE
  if (account.airbnbPasswordEnc) return AccountStatus.PENDING_CREDENTIALS
  return AccountStatus.PENDING_CREDENTIALS
}

export async function markComposioConnected(
  accountId: string,
  input: { composioUserId: string; composioConnectionId: string },
): Promise<ProspectAccountSummary | null> {
  const existing = await db.prospectAccount.findUnique({
    where: { id: accountId },
    select: { id: true, sessionPath: true, airbnbPasswordEnc: true },
  })
  if (!existing) return null

  const account = await db.prospectAccount.update({
    where: { id: accountId },
    data: {
      composioUserId: input.composioUserId,
      composioConnectionId: input.composioConnectionId,
      composioConnectedAt: new Date(),
      status: resolveStatusAfterGmailConnect(existing),
    },
    include: {
      blockEvents: { orderBy: { occurredAt: "desc" }, take: 3 },
    },
  })

  return toSummary(account)
}

export async function disconnectComposio(accountId: string): Promise<ProspectAccountSummary | null> {
  const existing = await db.prospectAccount.findUnique({
    where: { id: accountId },
    select: { id: true, sessionPath: true },
  })
  if (!existing) return null

  const account = await db.prospectAccount.update({
    where: { id: accountId },
    data: {
      composioUserId: null,
      composioConnectionId: null,
      composioConnectedAt: null,
      status: existing.sessionPath ? AccountStatus.PENDING_CREDENTIALS : AccountStatus.PENDING_GMAIL,
    },
    include: {
      blockEvents: { orderBy: { occurredAt: "desc" }, take: 3 },
    },
  })

  return toSummary(account)
}

export function expectedComposioUserId(accountId: string): string {
  return toComposioUserId(accountId)
}
