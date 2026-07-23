import type { AccountStatus, BlockType } from '@repo/db'
import { buildHandoffEmail, loadHandoffContext } from './handoff-email'
import { getOperationalAlertRecipient, sendResendEmail } from './resend'

/**
 * Notificaciones operativas vía Resend.
 *
 * Centraliza alertas mínimas: handoff humano, bloqueos Airbnb, cooldown de
 * cuentas, sesión expirada y errores del agente. Nunca lanza.
 */

export type AlertKind =
  | 'HUMAN_TAKEOVER'
  | 'BLOCKED'
  | 'ACCOUNT_COOLDOWN'
  | 'SESSION_EXPIRED'
  | 'MANUAL_SESSION_REQUIRED'
  | 'POLICY_BLOCK'
  | 'MUTEX_STUCK'
  | 'AGENT_ERROR'

export type AlertPayload = {
  kind: AlertKind
  title: string
  details?: Record<string, unknown>
}

function formatEmailText(payload: AlertPayload): string {
  const detailLines = payload.details
    ? Object.entries(payload.details).map(([k, v]) => `- ${k}: ${String(v)}`)
    : []
  return [`Agent Pilot — ${payload.kind}`, payload.title, ...detailLines].filter(Boolean).join('\n')
}

export async function sendAlert(payload: AlertPayload): Promise<void> {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'alert',
      ...payload,
    }),
  )

  const resend = await sendResendEmail({
    to: getOperationalAlertRecipient(),
    subject: `[Agent Pilot] ${payload.kind}`,
    text: formatEmailText(payload),
  })

  if (!resend.sent) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'alert.resend_skipped',
        reason: resend.reason,
        error: resend.error,
      }),
    )
  }
}

export async function notifyHandoffEmail(leadId: string, reason: string): Promise<void> {
  const context = await loadHandoffContext(leadId, reason)
  if (!context) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'handoff.email_skipped',
        leadId,
        reason: 'lead_not_found',
      }),
    )
    return
  }

  const { subject, text } = buildHandoffEmail(context)
  const resend = await sendResendEmail({
    to: getOperationalAlertRecipient(),
    subject,
    text,
  })

  if (resend.sent) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'handoff.email_sent',
        leadId,
        resendId: resend.id,
      }),
    )
    return
  }

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'handoff.email_skipped',
      leadId,
      reason: resend.reason,
      error: resend.error,
    }),
  )
}

/** @deprecated Use notifyHandoffEmail — kept for backward compatibility. */
export function notifyHumanTakeover(
  leadId: string,
  _name: string,
  reason: string,
): Promise<void> {
  return notifyHandoffEmail(leadId, reason)
}

export function notifyBlocked(
  blocker: string,
  context?: Record<string, unknown>,
): Promise<void> {
  return sendAlert({
    kind: 'BLOCKED',
    title: `Airbnb bloqueó la automatización (${blocker}).`,
    details: context,
  })
}

export type AccountCooldownAlert = {
  accountId: string
  label: string
  airbnbEmail: string
  blockType: BlockType
  message: string
  status: AccountStatus
  cooldownUntil: Date | null
}

export function notifyAccountCooldown(input: AccountCooldownAlert): Promise<void> {
  return sendAlert({
    kind: 'ACCOUNT_COOLDOWN',
    title: `Cuenta "${input.label}" pausada tras bloqueo ${input.blockType}.`,
    details: {
      accountId: input.accountId,
      airbnbEmail: input.airbnbEmail,
      blockType: input.blockType,
      status: input.status,
      cooldownUntil: input.cooldownUntil?.toISOString() ?? 'manual/until identity verified',
      message: input.message,
    },
  })
}

export function notifyAgentError(
  scope: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  return sendAlert({
    kind: 'AGENT_ERROR',
    title: `Error en ${scope}: ${message}`,
    details: context,
  })
}

/**
 * Alerta de acción humana: captcha Arkose o sesión muerta.
 * Siempre va a OPERATIONAL_ALERT_EMAIL / HANDOFF_EMAIL (default svaron066@gmail.com).
 */
export async function notifyManualSessionRequired(input: {
  subject: string
  text: string
  accountId: string
}): Promise<void> {
  const to = getOperationalAlertRecipient()

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'alert',
      kind: 'MANUAL_SESSION_REQUIRED',
      accountId: input.accountId,
      to,
    }),
  )

  const resend = await sendResendEmail({
    to,
    subject: input.subject,
    text: input.text,
  })

  if (resend.sent) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'alert.manual_session_sent',
        accountId: input.accountId,
        resendId: resend.id,
        to,
      }),
    )
    return
  }

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'alert.manual_session_skipped',
      accountId: input.accountId,
      reason: resend.reason,
      error: resend.error,
      to,
    }),
  )
}
