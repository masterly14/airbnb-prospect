import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright'
import type { ProspectAccount } from '@repo/db'
import {
  isAutoLoginEnabled,
  loginAccountAndSaveSession,
} from '../accounts/account-login'
import { markAccountSessionActive } from '../accounts/account-repository'
import {
  getAirbnbBaseUrl,
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../scraping/airbnb-context'
import { dismissBlockingOverlays } from '../scraping/airbnb-scraper'
import {
  buildProxyOption,
  resolveSessionPathForAccount,
} from '../scraping/playwright-context'

export type SyncNetworkMode = 'direct' | 'account_proxy'
export type SyncSessionSource = 'reused' | 'auto_login'

export type SyncSessionOptions = {
  headed: boolean
  useAccountProxy: boolean
  /** Abre Chromium visible cuando hace falta auto-login (default: true salvo SYNC_HEADED=false). */
  headedOnLogin?: boolean
}

export type SyncSessionResult = {
  browser: Browser
  context: BrowserContext
  page: Page
  networkMode: SyncNetworkMode
  sessionSource: SyncSessionSource
}

/** Airbnb bloqueó logins consecutivos desde la misma IP. */
export class SyncRateLimitError extends Error {
  constructor(
    public readonly accountId: string,
    label: string,
  ) {
    super(
      `Airbnb rate-limit para "${label}" (${accountId}). Espera 2–4 h y reintenta solo esta cuenta.`,
    )
    this.name = 'SyncRateLimitError'
  }
}

const RATE_LIMIT_PATTERN = /l[ií]mite de intentos|too many attempts|try again later/i

export function resolveSyncProxyMode(cliUseAccountProxy: boolean): boolean {
  if (cliUseAccountProxy) return true
  return process.env.SYNC_USE_ACCOUNT_PROXY === 'true'
}

export function getSyncAccountDelayMs(): number {
  return Number.parseInt(process.env.SYNC_ACCOUNT_DELAY_MS ?? '45000', 10)
}

export function resolveHeadedForSync(options: SyncSessionOptions, needsLogin: boolean): boolean {
  if (options.headed) return true
  if (process.env.SYNC_HEADED === 'false') return false
  if (process.env.SYNC_HEADED === 'true') return true
  // Sin sesión en disco o login probable: abrir navegador visible por defecto.
  if (needsLogin) return true
  return false
}

function sessionPathIfExists(account: ProspectAccount): string | null {
  try {
    return resolveSessionPathForAccount(account)
  } catch {
    return null
  }
}

function wrapLoginError(account: ProspectAccount, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (RATE_LIMIT_PATTERN.test(message)) {
    throw new SyncRateLimitError(account.id, account.label)
  }
  throw error instanceof Error ? error : new Error(message)
}

/**
 * Verifica acceso real al inbox: navega a /guest/messages y confirma que Airbnb
 * NO redirige a la pantalla de login.
 */
export async function canAccessInbox(page: Page): Promise<boolean> {
  const base = getAirbnbBaseUrl()
  await page.goto(`${base}/guest/messages`, { waitUntil: 'domcontentloaded' })
  await dismissBlockingOverlays(page)
  await page.waitForTimeout(2_000)
  return !/\/login/.test(page.url())
}

export async function launchBrowserForSync(options: {
  headed: boolean
  proxy?: NonNullable<LaunchOptions['proxy']>
}): Promise<Browser> {
  return chromium.launch({
    headless: !options.headed,
    ...getChromeChannelOption(),
    ...(options.proxy ? { proxy: options.proxy } : {}),
  })
}

/**
 * Abre browser+context para sync:
 *   1. Por defecto sin proxy (red directa).
 *   2. Reutiliza sesión si el inbox es accesible.
 *   3. Si no, auto-login vía Composio y persiste sesión.
 */
export async function openSyncAccountSession(
  account: ProspectAccount,
  options: SyncSessionOptions,
  log: (event: string, data?: Record<string, unknown>) => void,
): Promise<SyncSessionResult> {
  const useAccountProxy = resolveSyncProxyMode(options.useAccountProxy)
  const networkMode: SyncNetworkMode = useAccountProxy ? 'account_proxy' : 'direct'
  const proxy = useAccountProxy ? buildProxyOption(account) : undefined

  const existingSession = sessionPathIfExists(account)
  let headed = resolveHeadedForSync(options, !existingSession)

  log('sync.network_mode', {
    accountId: account.id,
    networkMode,
    useAccountProxy,
    headed,
    hasSessionFile: Boolean(existingSession),
  })

  let browser = await launchBrowserForSync({ headed, proxy })

  if (existingSession) {
    const context = await browser.newContext({
      storageState: existingSession,
      ...getColombiaContextOptions(),
    })
    const page = await context.newPage()

    if (await canAccessInbox(page)) {
      log('sync.account.session_reused', { accountId: account.id, path: existingSession })
      return { browser, context, page, networkMode, sessionSource: 'reused' }
    }

    log('sync.account.session_invalid', {
      accountId: account.id,
      reason: 'inbox_redirects_to_login',
    })
    await context.close()

    // Sesión en disco inválida: relanzar visible para auto-login si estaba headless.
    if (!headed) {
      await browser.close()
      headed = true
      log('sync.browser.relaunch_headed', { accountId: account.id, reason: 'auto_login' })
      browser = await launchBrowserForSync({ headed: true, proxy })
    }
  }

  if (!isAutoLoginEnabled()) {
    await browser.close()
    throw new Error(
      `Sesión ausente/expirada para "${account.label}" y auto-login deshabilitado (OUTBOUND_AUTO_LOGIN=false).`,
    )
  }

  log('sync.account.auto_login', { accountId: account.id, label: account.label })

  let session: { context: BrowserContext; page: Page; sessionPath: string }
  try {
    session = await loginAccountAndSaveSession(browser, account)
  } catch (error) {
    await browser.close().catch(() => {})
    wrapLoginError(account, error)
  }

  await markAccountSessionActive(account.id, session.sessionPath)

  if (!(await canAccessInbox(session.page))) {
    await browser.close().catch(() => {})
    throw new Error(`Auto-login completado pero el inbox no es accesible para "${account.label}".`)
  }

  log('sync.account.auto_login_ok', {
    accountId: account.id,
    sessionPath: session.sessionPath,
  })

  return {
    browser,
    context: session.context,
    page: session.page,
    networkMode,
    sessionSource: 'auto_login',
  }
}
