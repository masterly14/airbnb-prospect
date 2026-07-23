export type ResendEmailInput = {
  to: string | string[]
  subject: string
  text: string
  html?: string
}

export type ResendEmailResult =
  | { sent: true; id?: string }
  | { sent: false; reason: 'missing_api_key' | 'request_failed'; error?: string }

function resolveFromAddress(): string | null {
  return process.env.RESEND_FROM?.trim() || null
}

/** Destinatario de alertas operativas (captcha / sesión manual / cooldown). */
function resolveAlertRecipient(): string {
  return (
    process.env.OPERATIONAL_ALERT_EMAIL?.trim() ||
    process.env.HANDOFF_EMAIL?.trim() ||
    'svaron066@gmail.com'
  )
}

export async function sendResendEmail(input: ResendEmailInput): Promise<ResendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = resolveFromAddress()

  if (!apiKey || !from) {
    return { sent: false, reason: 'missing_api_key' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return { sent: false, reason: 'request_failed', error }
    }

    const payload = (await response.json()) as { id?: string }
    return { sent: true, id: payload.id }
  } catch (error) {
    return {
      sent: false,
      reason: 'request_failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function getOperationalAlertRecipient(): string {
  return resolveAlertRecipient()
}
