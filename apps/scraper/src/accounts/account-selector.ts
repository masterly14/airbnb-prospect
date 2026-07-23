import { AccountStatus, type ProspectAccount, db } from '@repo/db'
import { OPERATIONS } from '../discovery/icp'
import { addHours } from './account-repository'
import { getMvpAccountId, isMvpSingleAccountMode, loadMvpAccount } from './mvp-mode'
import { outboundLog } from '../logging/outbound-logger'

/** Tope diario por cuenta: 2 oleadas × 10 msgs (objetivo operativo §2.3). */
export function getDailyMessageCap(): number {
  return OPERATIONS.MSGS_PER_WAVE * OPERATIONS.WAVES_PER_DAY_TARGET
}

function autoLoginEnabled(): boolean {
  return process.env.OUTBOUND_AUTO_LOGIN !== 'false'
}

/**
 * ¿La cuenta puede operar sin intervención manual? Basta con que tenga una
 * sesión persistida (en Neon o archivo) o credenciales para auto-loguearse.
 * Así una cuenta recién creada (con credenciales) entra a rotación y hace su
 * primer login sola, sin depender de volúmenes ni de subir la sesión a mano.
 */
export function accountCanEstablishSession(account: ProspectAccount): boolean {
  if (account.sessionStateEnc) return true
  if (account.sessionPath) return true
  if (autoLoginEnabled() && account.airbnbPasswordEnc && account.composioConnectionId) {
    return true
  }
  return false
}

/** Fragmento Prisma equivalente a `accountCanEstablishSession` (sesión o credenciales). */
function sessionOrCredentialsWhere() {
  return {
    OR: [
      { sessionStateEnc: { not: null } },
      { sessionPath: { not: null } },
      ...(autoLoginEnabled()
        ? [
            {
              AND: [
                { airbnbPasswordEnc: { not: null } },
                { composioConnectionId: { not: null } },
              ],
            },
          ]
        : []),
    ],
  }
}

export function explainAccountPickSkip(
  account: ProspectAccount,
  now = new Date(),
): string | null {
  if (account.status === AccountStatus.BLOCKED) return 'blocked'
  if (account.status === AccountStatus.PENDING_CREDENTIALS) return 'pending_credentials'
  if (account.status === AccountStatus.PENDING_GMAIL) return 'pending_gmail'
  if (account.status === AccountStatus.VERIFYING) return 'verifying'
  if (!accountCanEstablishSession(account)) return 'no_session_or_credentials'
  if (!account.market) return 'no_market'
  if (account.messagesSentToday >= getDailyMessageCap()) return 'daily_cap'
  if (
    account.status === AccountStatus.COOLDOWN &&
    account.cooldownUntil &&
    account.cooldownUntil > now
  ) {
    return 'cooldown_active'
  }
  if (account.status !== AccountStatus.ACTIVE && account.status !== AccountStatus.COOLDOWN) {
    return `status_${account.status}`
  }
  return null
}

export function isAccountEligibleForPick(
  account: ProspectAccount,
  now = new Date(),
): boolean {
  return explainAccountPickSkip(account, now) === null
}

export function sortAccountsForPick(accounts: ProspectAccount[]): ProspectAccount[] {
  return [...accounts].sort((a, b) => {
    if (a.waveMessagesSent !== b.waveMessagesSent) {
      return a.waveMessagesSent - b.waveMessagesSent
    }
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
}

/**
 * Vuelve a ACTIVE las cuentas que quedaron en PENDING_CREDENTIALS aunque ya
 * tienen sesión reutilizable en Neon (p. ej. verify-account restauró cookies
 * pero el status no se actualizó, o un falso login_failed).
 */
export async function recoverReusableSessionAccounts(): Promise<{
  recovered: Array<{ id: string; label: string; from: AccountStatus }>
}> {
  if (isMvpSingleAccountMode()) {
    return { recovered: [] }
  }

  const stuck = await db.prospectAccount.findMany({
    where: {
      status: AccountStatus.PENDING_CREDENTIALS,
      OR: [{ sessionStateEnc: { not: null } }, { sessionPath: { not: null } }],
      market: { not: null },
    },
  })

  const recovered: Array<{ id: string; label: string; from: AccountStatus }> = []
  for (const account of stuck) {
    await db.prospectAccount.update({
      where: { id: account.id },
      data: {
        status: AccountStatus.ACTIVE,
        cooldownUntil: null,
      },
    })
    recovered.push({
      id: account.id,
      label: account.label,
      from: AccountStatus.PENDING_CREDENTIALS,
    })
  }

  if (recovered.length > 0) {
    outboundLog('account.rotation_recovered', {
      count: recovered.length,
      accounts: recovered,
    })
  }

  return { recovered }
}

/**
 * BLOCKED solo debería usarse para IDENTITY. Si una cuenta quedó BLOCKED por
 * un fallo de browser/login, la bajamos a PENDING_CREDENTIALS para que un
 * verify-account la pueda reactivar (no la metemos a rotación sola).
 */
export async function softenFalseIdentityBlocks(): Promise<{
  softened: Array<{ id: string; label: string }>
}> {
  if (isMvpSingleAccountMode()) {
    return { softened: [] }
  }

  const blocked = await db.prospectAccount.findMany({
    where: { status: AccountStatus.BLOCKED },
  })

  const softened: Array<{ id: string; label: string }> = []
  for (const account of blocked) {
    const identityHit = await db.accountBlockEvent.findFirst({
      where: { accountId: account.id, type: 'IDENTITY' },
      select: { id: true },
    })
    if (identityHit) continue

    await db.prospectAccount.update({
      where: { id: account.id },
      data: {
        status: AccountStatus.PENDING_CREDENTIALS,
        cooldownUntil: null,
      },
    })
    softened.push({ id: account.id, label: account.label })
  }

  if (softened.length > 0) {
    outboundLog('account.false_block_softened', {
      count: softened.length,
      accounts: softened,
    })
  }

  return { softened }
}

export async function logAccountRotationPool(now = new Date()): Promise<void> {
  const accounts = await db.prospectAccount.findMany({
    orderBy: { createdAt: 'asc' },
  })

  outboundLog('account.rotation_pool', {
    mvpMode: isMvpSingleAccountMode(),
    accounts: accounts.map((account) => {
      const skip = explainAccountPickSkip(account, now)
      return {
        id: account.id,
        label: account.label,
        status: account.status,
        market: account.market,
        messagesSentToday: account.messagesSentToday,
        waveMessagesSent: account.waveMessagesSent,
        cooldownUntil: account.cooldownUntil?.toISOString() ?? null,
        hasSession: Boolean(account.sessionStateEnc || account.sessionPath),
        eligible: skip === null,
        skipReason: skip,
      }
    }),
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
      market: { not: null },
      messagesSentToday: { lt: getDailyMessageCap() },
      ...(excludeAccountIds.length > 0 ? { id: { notIn: excludeAccountIds } } : {}),
      AND: [
        { OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }] },
        sessionOrCredentialsWhere(),
      ],
    },
  })

  const eligible = sortAccountsForPick(
    candidates.filter((account) => isAccountEligibleForPick(account, now)),
  )

  const picked = eligible[0] ?? null
  if (picked) {
    outboundLog('account.picked', {
      accountId: picked.id,
      accountLabel: picked.label,
      market: picked.market,
      waveMessagesSent: picked.waveMessagesSent,
      eligibleCount: eligible.length,
      eligibleLabels: eligible.map((a) => a.label),
    })
  }

  return picked
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

/** Colombia no tiene DST: offset fijo UTC-5. */
const COLOMBIA_UTC_OFFSET_HOURS = -5

/** Próxima medianoche de Colombia (cuando se resetea `messagesSentToday`), en UTC. */
export function nextColombiaMidnightUtc(now = new Date()): Date {
  const offsetMs = COLOMBIA_UTC_OFFSET_HOURS * 60 * 60 * 1000
  const colombiaNow = new Date(now.getTime() + offsetMs)
  const nextMidnightColombiaMs = Date.UTC(
    colombiaNow.getUTCFullYear(),
    colombiaNow.getUTCMonth(),
    colombiaNow.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  )
  return new Date(nextMidnightColombiaMs - offsetMs)
}

/**
 * Momento en que una cuenta (con sesión y mercado) vuelve a estar disponible:
 * - ahora mismo si está activa y bajo el tope diario → `now`
 * - al vencer el cooldown si está en COOLDOWN
 * - en el reset diario de Colombia si alcanzó el tope de mensajes del día
 * Devuelve `null` si la cuenta nunca podrá elegirse (bloqueada, sin sesión, etc.).
 */
export function accountNextAvailableAt(
  account: ProspectAccount,
  now = new Date(),
): Date | null {
  if (account.status === AccountStatus.BLOCKED) return null
  if (
    account.status === AccountStatus.PENDING_CREDENTIALS ||
    account.status === AccountStatus.PENDING_GMAIL ||
    account.status === AccountStatus.VERIFYING
  ) {
    return null
  }
  if (!accountCanEstablishSession(account) || !account.market) return null

  if (account.messagesSentToday >= getDailyMessageCap()) {
    return nextColombiaMidnightUtc(now)
  }

  if (
    account.status === AccountStatus.COOLDOWN &&
    account.cooldownUntil &&
    account.cooldownUntil > now
  ) {
    return account.cooldownUntil
  }

  return now
}

/**
 * Milisegundos hasta que la próxima cuenta esté disponible (el "momento de
 * desbloqueo" que usa el orquestador para dormir sin depender de crons).
 * - `0` si ya hay una cuenta lista ahora.
 * - `null` si ninguna cuenta podrá estar disponible (todas bloqueadas/sin sesión).
 */
export async function computeNextAvailabilityMs(now = new Date()): Promise<number | null> {
  if (isMvpSingleAccountMode()) {
    const account = await loadMvpAccount().catch(() => null)
    if (!account) return null
    const at = accountNextAvailableAt(account, now)
    return at ? Math.max(0, at.getTime() - now.getTime()) : null
  }

  const accounts = await db.prospectAccount.findMany({
    where: {
      market: { not: null },
      status: { in: [AccountStatus.ACTIVE, AccountStatus.COOLDOWN] },
      ...sessionOrCredentialsWhere(),
    },
  })

  let soonest: number | null = null
  for (const account of accounts) {
    const at = accountNextAvailableAt(account, now)
    if (!at) continue
    const ms = Math.max(0, at.getTime() - now.getTime())
    if (ms === 0) return 0
    soonest = soonest === null ? ms : Math.min(soonest, ms)
  }

  return soonest
}

/**
 * Cuentas aptas para *leer* inbox (no gated por cooldown/tope diario: leer
 * respuestas no consume cuota de envío). Requiere sesión y no estar bloqueada.
 */
export async function listInboundAccounts(): Promise<ProspectAccount[]> {
  if (isMvpSingleAccountMode()) {
    const account = await loadMvpAccount().catch(() => null)
    return account ? [account] : []
  }

  return db.prospectAccount.findMany({
    where: {
      status: {
        in: [AccountStatus.ACTIVE, AccountStatus.COOLDOWN],
      },
      ...sessionOrCredentialsWhere(),
    },
    orderBy: { createdAt: 'asc' },
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
