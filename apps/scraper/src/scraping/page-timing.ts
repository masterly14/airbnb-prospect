import type { BrowserContext, Page } from 'playwright'

function slowMultiplier(): number {
  return process.env.PLAYWRIGHT_SLOW_NETWORK === 'true' ? 2 : 1
}

function envMs(key: string, defaultMs: number): number {
  const raw = process.env[key]?.trim()
  if (!raw) return defaultMs * slowMultiplier()
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs * slowMultiplier()
}

/** Timeout de `page.goto` y navegaciones (default 60s; 120s con PLAYWRIGHT_SLOW_NETWORK). */
export function getNavigationTimeoutMs(): number {
  return envMs('PLAYWRIGHT_NAV_TIMEOUT_MS', 60_000)
}

/** Timeout de clics, fill, waitFor, etc. (default 45s; 90s en modo lento). */
export function getActionTimeoutMs(): number {
  return envMs('PLAYWRIGHT_ACTION_TIMEOUT_MS', 45_000)
}

/** Cuánto esperar a que la red quede idle tras una navegación. */
export function getNetworkIdleTimeoutMs(): number {
  return envMs('PLAYWRIGHT_NETWORK_IDLE_MS', 25_000)
}

/** Pausa extra tras load/networkidle para que el SPA termine de renderizar. */
export function getSettleDelayMs(): number {
  return envMs('PLAYWRIGHT_SETTLE_DELAY_MS', 2_500)
}

export function applyContextTimeouts(context: BrowserContext): void {
  context.setDefaultTimeout(getActionTimeoutMs())
  context.setDefaultNavigationTimeout(getNavigationTimeoutMs())
}

export function applyPageTimeouts(page: Page): void {
  page.setDefaultTimeout(getActionTimeoutMs())
  page.setDefaultNavigationTimeout(getNavigationTimeoutMs())
}

/**
 * Espera a que la página termine de cargar en conexiones lentas:
 * load → networkidle (best effort) → pausa de asentamiento.
 */
export async function waitForUiSettle(page: Page): Promise<void> {
  await page.waitForLoadState('load', { timeout: getNavigationTimeoutMs() }).catch(() => {})
  await page
    .waitForLoadState('networkidle', { timeout: getNetworkIdleTimeoutMs() })
    .catch(() => {})
  const delay = getSettleDelayMs()
  if (delay > 0) {
    await page.waitForTimeout(delay)
  }
}

export async function gotoAndSettle(
  page: Page,
  url: string,
  options: {
    waitUntil?: 'domcontentloaded' | 'load' | 'networkidle'
    /** `fast` evita networkidle (Airbnb casi nunca queda idle; bloqueaba 25–50s). */
    settle?: 'full' | 'fast'
  } = {},
): Promise<void> {
  await page.goto(url, {
    waitUntil: options.waitUntil ?? 'domcontentloaded',
    timeout: getNavigationTimeoutMs(),
  })
  if (options.settle === 'fast') {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(Math.min(getSettleDelayMs(), 1_200))
    return
  }
  await waitForUiSettle(page)
}
