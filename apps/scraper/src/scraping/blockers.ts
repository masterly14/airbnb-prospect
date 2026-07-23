import type { Page } from 'playwright'

export type PageBlocker = 'ok' | 'captcha' | 'session_expired' | 'network'

export function detectBlockersFromText(bodyText: string): PageBlocker {
  if (
    /captcha|verify you are human|access denied|robot check|not a robot|verificaci[oó]n de seguridad|security verification|recargar desaf[ií]o|funcaptcha|arkose/i.test(
      bodyText,
    )
  ) {
    return 'captcha'
  }

  if (/log in to continue|inicia sesión para continuar|sign in to continue/i.test(bodyText)) {
    return 'session_expired'
  }

  if (/something went wrong|try again later|network error|connection reset/i.test(bodyText)) {
    return 'network'
  }

  return 'ok'
}

export async function detectPageBlockers(page: Page): Promise<PageBlocker> {
  const bodyText = await page.locator('body').innerText().catch(() => '')
  return detectBlockersFromText(bodyText)
}
