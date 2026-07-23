import { AccountStatus, BlockType, db, type ProspectAccount } from '@repo/db'
import { notifyManualSessionRequired } from '../notifications/notify'
import { recordBlockEvent } from './account-repository'

export type ManualSessionReason = 'captcha' | 'session_expired' | 'login_failed'

export class ManualSessionRequiredError extends Error {
  readonly reason: ManualSessionReason
  readonly accountId: string

  constructor(accountId: string, reason: ManualSessionReason, message: string) {
    super(message)
    this.name = 'ManualSessionRequiredError'
    this.accountId = accountId
    this.reason = reason
  }
}

const ALERT_DEDUP_HOURS = 4

export function classifyManualSessionReason(error: unknown): ManualSessionReason | null {
  const msg = error instanceof Error ? error.message : String(error)

  if (
    /verificaci[oó]n de seguridad|security verification|arkose|funcaptcha|recargar desaf[ií]o|timeout esperando.*seguridad/i.test(
      msg,
    )
  ) {
    return 'captcha'
  }

  if (
    /iniciar sesi[oó]n o registrarse|no se pudo confirmar sesi[oó]n|sesi[oó]n no se valid|login fall[oó]/i.test(
      msg,
    )
  ) {
    return 'login_failed'
  }

  if (/session.*expir|session missing|HarvestSessionExpired|fuera de rotaci[oó]n/i.test(msg)) {
    return 'session_expired'
  }

  return null
}

export function buildVerifyAccountCommand(airbnbEmail: string): string {
  return `npm run auth:verify-account -- --email ${airbnbEmail} --headed`
}

export function buildManualSessionEmailText(input: {
  label: string
  airbnbEmail: string
  accountId: string
  reason: ManualSessionReason
  message: string
  job?: string
  proxyHost?: string | null
  proxyPort?: number | null
}): { subject: string; text: string } {
  const reasonLabel =
    input.reason === 'captcha'
      ? 'Captcha / Verificación de seguridad (Arkose)'
      : input.reason === 'session_expired'
        ? 'Sesión Airbnb expirada o inválida'
        : 'Login automático falló (sin sesión activa)'

  const command = buildVerifyAccountCommand(input.airbnbEmail)
  const proxy =
    input.proxyHost && input.proxyPort
      ? `${input.proxyHost}:${input.proxyPort}`
      : input.proxyHost ?? '—'

  const subject = `[Agent Pilot] Acción requerida: sesión manual — ${input.label}`
  const text = [
    'Airbnb requiere intervención manual para reanudar esta cuenta.',
    '',
    `Motivo: ${reasonLabel}`,
    `Cuenta: ${input.label}`,
    `Email Airbnb: ${input.airbnbEmail}`,
    `Account ID: ${input.accountId}`,
    `Proxy: ${proxy}`,
    input.job ? `Job: ${input.job}` : null,
    `Detalle: ${input.message}`,
    '',
    'Qué hacer:',
    '1. En PowerShell, desde la raíz del repo:',
    `   ${command}`,
    '2. Si aparece "Verificación de seguridad", resuélvela en el browser.',
    '3. Completa OTP si Airbnb lo pide (Gmail vía Composio).',
    '4. Confirma que el log diga login exitoso / cuenta ACTIVE.',
    '',
    'La cuenta quedó fuera de rotación automática hasta que la sesión se renueve.',
  ]
    .filter((line) => line !== null)
    .join('\n')

  return { subject, text }
}

async function wasRecentlyAlerted(accountId: string, withinHours = ALERT_DEDUP_HOURS): Promise<boolean> {
  const since = new Date(Date.now() - withinHours * 60 * 60 * 1000)
  const recent = await db.accountBlockEvent.findFirst({
    where: {
      accountId,
      type: { in: [BlockType.CAPTCHA, BlockType.OTHER] },
      occurredAt: { gte: since },
      message: { contains: '[MANUAL_SESSION]' },
    },
    orderBy: { occurredAt: 'desc' },
  })
  return Boolean(recent)
}

/**
 * Pausa la cuenta y envía email operativo (dedupe 4h) para re-auth headed.
 * Nunca lanza.
 */
export async function requestManualSessionRemediation(input: {
  account: Pick<
    ProspectAccount,
    'id' | 'label' | 'airbnbEmail' | 'proxyHost' | 'proxyPort'
  >
  reason: ManualSessionReason
  message: string
  job?: string
}): Promise<{ alerted: boolean; skippedReason?: string }> {
  try {
    if (await wasRecentlyAlerted(input.account.id)) {
      return { alerted: false, skippedReason: 'deduped' }
    }

    const blockType =
      input.reason === 'captcha' ? BlockType.CAPTCHA : BlockType.OTHER
    const taggedMessage = `[MANUAL_SESSION] ${input.reason}: ${input.message}`.slice(0, 2000)

    await recordBlockEvent(input.account.id, blockType, taggedMessage)

    // Fuera de rotación hasta re-auth exitoso (verify-account → ACTIVE).
    await db.prospectAccount.update({
      where: { id: input.account.id },
      data: {
        status: AccountStatus.PENDING_CREDENTIALS,
        cooldownUntil: null,
      },
    })

    const { subject, text } = buildManualSessionEmailText({
      label: input.account.label,
      airbnbEmail: input.account.airbnbEmail,
      accountId: input.account.id,
      reason: input.reason,
      message: input.message,
      job: input.job,
      proxyHost: input.account.proxyHost,
      proxyPort: input.account.proxyPort,
    })

    await notifyManualSessionRequired({ subject, text, accountId: input.account.id })

    return { alerted: true }
  } catch (error) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'manual_session.remediation_failed',
        accountId: input.account.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return { alerted: false, skippedReason: 'error' }
  }
}

/** Clasifica el error de login y dispara remediation si aplica. */
export async function maybeRemediateLoginFailure(
  account: ProspectAccount,
  error: unknown,
  job = 'login',
): Promise<ManualSessionReason | null> {
  const reason =
    classifyManualSessionReason(error) ??
    // Cualquier fallo de auto-login deja la cuenta sin sesión usable.
    ('login_failed' as const)

  await requestManualSessionRemediation({
    account,
    reason,
    message: error instanceof Error ? error.message : String(error),
    job,
  })

  return reason
}
