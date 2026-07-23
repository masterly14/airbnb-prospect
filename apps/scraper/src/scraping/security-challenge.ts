import type { Page } from 'playwright'
import { authLog } from '../../tests/helpers/auth-logger'

const SECURITY_CHALLENGE_RE =
  /verificaci[oó]n de seguridad|security verification|recargar desaf[ií]o|reload challenge|funcaptcha|arkose/i

const CHALLENGE_BROKEN_RE =
  /algo ha salido mal|something went wrong|vuelva a cargar el desaf[ií]o|reload the challenge/i

export function looksLikeSecurityChallenge(text: string): boolean {
  return SECURITY_CHALLENGE_RE.test(text)
}

export async function isSecurityChallengeVisible(page: Page): Promise<boolean> {
  const body = await page.locator('body').innerText().catch(() => '')
  if (looksLikeSecurityChallenge(body)) return true

  const heading = page.getByText(/verificaci[oó]n de seguridad|security verification/i).first()
  return heading.isVisible({ timeout: 500 }).catch(() => false)
}

/**
 * Airbnb (Arkose) a veces muestra el modal pero el puzzle no carga.
 * Un reload suele bastar si el proxy/assets ya están bien.
 */
export async function tryReloadBrokenChallenge(page: Page): Promise<boolean> {
  const body = await page.locator('body').innerText().catch(() => '')
  if (!CHALLENGE_BROKEN_RE.test(body) && !looksLikeSecurityChallenge(body)) {
    return false
  }

  const reload = page
    .getByRole('button', { name: /recargar desaf[ií]o|reload challenge/i })
    .or(page.getByText(/recargar desaf[ií]o|reload challenge/i))
    .first()

  if (!(await reload.isVisible({ timeout: 1_500 }).catch(() => false))) {
    return false
  }

  authLog('security-challenge', 'Desafío roto — pulsando Recargar desafío')
  await reload.click({ timeout: 5_000 }).catch(() => undefined)
  await page.waitForTimeout(2_500)
  return true
}

export type WaitSecurityChallengeOptions = {
  /** Default: true si el browser no es headless. */
  headed?: boolean
  /** Tiempo máximo esperando resolución manual. Default 5 min. */
  timeoutMs?: number
  pollMs?: number
}

/**
 * Si aparece Arkose / "Verificación de seguridad":
 * - headed → espera a que el humano lo resuelva
 * - headless → falla con instrucción clara
 *
 * No intenta resolver el puzzle por software (solo pause + reload).
 */
export async function waitForSecurityChallengeIfPresent(
  page: Page,
  options: WaitSecurityChallengeOptions = {},
): Promise<boolean> {
  if (!(await isSecurityChallengeVisible(page))) {
    return false
  }

  const headed =
    options.headed ??
    (process.env.OUTBOUND_HEADED === 'true' ||
      process.env.LOGIN_HEADED === 'true' ||
      process.env.PLAYWRIGHT_HEADED === 'true')

  await tryReloadBrokenChallenge(page)

  if (!(await isSecurityChallengeVisible(page))) {
    authLog('security-challenge', 'Desafío desapareció tras reload')
    return true
  }

  if (!headed) {
    throw new Error(
      'Airbnb pidió "Verificación de seguridad" (Arkose). ' +
        'Relanza en headed y resuélvela a mano: ' +
        '$env:OUTBOUND_HEADED="true"; npm run auth:verify-account -- --email <email>. ' +
        'También: desactiva PLAYWRIGHT_BLOCK_HEAVY_ASSETS en login (ya off) y usa Decodo country=co.',
    )
  }

  const timeoutMs = options.timeoutMs ?? 5 * 60_000
  const pollMs = options.pollMs ?? 2_000
  const deadline = Date.now() + timeoutMs

  authLog(
    'security-challenge',
    `⚠️ Verificación de seguridad visible. Resuélvela en el browser (timeout ${Math.round(timeoutMs / 1000)}s)…`,
  )

  let reloaded = false
  while (Date.now() < deadline) {
    if (!(await isSecurityChallengeVisible(page))) {
      authLog('security-challenge', 'Verificación resuelta — continuando')
      return true
    }

    if (!reloaded) {
      reloaded = await tryReloadBrokenChallenge(page)
    }

    await page.waitForTimeout(pollMs)
  }

  throw new Error(
    'Timeout esperando que resuelvas la Verificación de seguridad de Airbnb. ' +
      'Si el puzzle no carga: cambia Decodo a Location=Colombia (DECODO_COUNTRY=co), ' +
      'reasigna proxy y reintenta. No uses la misma IP/session entre cuentas.',
  )
}
