type KnownOutboundLogEvent =
  | 'outbound.start'
  | 'outbound.complete'
  | 'outbound.error'
  | 'outbound.send.start'
  | 'outbound.send.success'
  | 'outbound.send.failed'
  | 'outbound.skipped'
  | 'outbound.blocked'
  | 'outbound.no_accounts'
  | 'outbound.failure_cap'
  | 'outbound.wave_complete'
  | 'outbound.account_quarantined'
  | 'playwright.browser_launch'
  | 'playwright.context_launch'
  | 'account.session_expired_retry_login'
  | 'account.auto_login_start'
  | 'account.auto_login_success'
  | 'account.auto_login_failed'
  | 'account.auto_login_error'
  | 'account.auto_login_skipped'
  | 'account.auto_login_disabled'

// Se permite cualquier string para no romper el runtime con eventos nuevos,
// pero los conocidos dan autocompletado.
type OutboundLogEvent = KnownOutboundLogEvent | (string & {})

export function outboundLog(
  event: OutboundLogEvent,
  data: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...data,
    }),
  )
}
