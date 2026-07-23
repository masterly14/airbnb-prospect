import fs from 'fs'
import path from 'path'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type Route,
} from 'playwright'
import { db, type ProspectAccount } from '@repo/db'
import { decryptSecret, encryptSecret } from '@repo/crypto'
import { getChromeChannelOption, getColombiaContextOptions } from './airbnb-context'
import { outboundLog } from '../logging/outbound-logger'
import { applyContextTimeouts } from './page-timing'

/** storageState de Playwright (cookies + origins) como objeto en memoria. */
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>

/**
 * Job que abre Playwright. Define el default de proxy:
 * - outbound / login → proxy si PLAYWRIGHT_USE_ACCOUNT_PROXY=true
 * - harvest / inbound / sync → red directa (ahorra GB de Decodo)
 */
export type PlaywrightJob = 'outbound' | 'harvest' | 'inbound' | 'login' | 'sync'

/** La sesión de la cuenta no existe en disco: requiere re-login manual. */
export class AccountSessionMissingError extends Error {
  constructor(
    public readonly accountId: string,
    label: string,
  ) {
    super(
      `Session file missing for account "${label}" (${accountId}). Run auth login for this account.`,
    )
    this.name = 'AccountSessionMissingError'
  }
}

/** Proxy configurado pero inutilizable (p. ej. password que no descifra). */
export class AccountProxyConfigError extends Error {
  constructor(
    public readonly accountId: string,
    message: string,
  ) {
    super(message)
    this.name = 'AccountProxyConfigError'
  }
}

const JOB_PROXY_ENV: Record<PlaywrightJob, string> = {
  outbound: 'OUTBOUND_USE_ACCOUNT_PROXY',
  harvest: 'HARVEST_USE_ACCOUNT_PROXY',
  inbound: 'INBOUND_USE_ACCOUNT_PROXY',
  login: 'LOGIN_USE_ACCOUNT_PROXY',
  sync: 'SYNC_USE_ACCOUNT_PROXY',
}

const HEAVY_RESOURCE_TYPES = new Set(['image', 'media', 'font'])

const TRACKER_URL_RE =
  /google-analytics|googletagmanager|googleadservices|doubleclick|facebook\.net|facebook\.com\/tr|hotjar|segment\.(io|com)|sentry\.io|newrelic|clarity\.ms|adservice|adsystem|scorecardresearch|bat\.bing/i

/** CDN de fotos de Airbnb: bloquear aunque el resourceType no sea `image`. */
const AIRBNB_IMAGE_CDN_RE = /muscache\.com\/(?:im\/|pictures\/|airbnb-platform-assets\/.*\.(?:png|jpe?g|webp|gif))/i

export function accountSessionPath(accountId: string): string {
  return path.resolve(__dirname, `../../playwright/.auth/account-${accountId}.json`)
}

/** Master switch legacy: habilita proxy por defecto en outbound/login. */
export function shouldUseAccountProxy(): boolean {
  return process.env.PLAYWRIGHT_USE_ACCOUNT_PROXY === 'true'
}

/**
 * ¿Este job debe salir por el proxy residencial de la cuenta?
 *
 * Override explícito por env del job (`true`/`false`). Si no hay override:
 * - outbound / login → siguen `PLAYWRIGHT_USE_ACCOUNT_PROXY`
 * - harvest / inbound / sync → `false` (ahorro de tráfico)
 */
export function shouldUseAccountProxyForJob(job: PlaywrightJob): boolean {
  const explicit = process.env[JOB_PROXY_ENV[job]]?.trim().toLowerCase()
  if (explicit === 'true') return true
  if (explicit === 'false') return false

  if (job === 'outbound' || job === 'login') {
    return shouldUseAccountProxy()
  }

  return false
}

/** Bloqueo de assets pesados activo por defecto; desactivar con PLAYWRIGHT_BLOCK_HEAVY_ASSETS=false. */
export function shouldBlockHeavyAssets(): boolean {
  return process.env.PLAYWRIGHT_BLOCK_HEAVY_ASSETS !== 'false'
}

export function shouldBlockResource(resourceType: string, url: string): boolean {
  if (HEAVY_RESOURCE_TYPES.has(resourceType)) return true
  if (TRACKER_URL_RE.test(url)) return true
  if (AIRBNB_IMAGE_CDN_RE.test(url)) return true
  return false
}

/**
 * Aborta imágenes, media, fuentes, trackers y CDN de fotos de Airbnb.
 * El scrape/mensajería siguen funcionando con HTML + GraphQL + CSS/JS.
 */
export async function installBandwidthSaver(context: BrowserContext): Promise<void> {
  if (!shouldBlockHeavyAssets()) return

  await context.route('**/*', (route: Route) => {
    const request = route.request()
    if (shouldBlockResource(request.resourceType(), request.url())) {
      return route.abort()
    }
    return route.continue()
  })
}

/**
 * Nunca cae a la sesión legacy de otra cuenta: enviar con la identidad
 * equivocada es peor que no enviar (cross-account leakage).
 */
export function resolveSessionPathForAccount(account: ProspectAccount): string {
  if (account.sessionPath && fs.existsSync(account.sessionPath)) {
    return account.sessionPath
  }

  const defaultPath = accountSessionPath(account.id)
  if (fs.existsSync(defaultPath)) {
    return defaultPath
  }

  throw new AccountSessionMissingError(account.id, account.label)
}

/**
 * ¿La cuenta tiene una sesión utilizable sin re-login?
 * Fuente de verdad: Neon (`sessionStateEnc`); fallback a archivo local (dev).
 * No depende de volúmenes: la sesión vive cifrada en la DB.
 */
export function accountHasStoredSession(account: ProspectAccount): boolean {
  if (account.sessionStateEnc) return true
  if (account.sessionPath && fs.existsSync(account.sessionPath)) return true
  return fs.existsSync(accountSessionPath(account.id))
}

/**
 * Resuelve el storageState de la cuenta priorizando Neon (objeto en memoria,
 * cero volumen). Si no hay blob en DB, cae al archivo local (dev/legacy).
 * Nunca reutiliza la sesión de otra cuenta (cross-account leakage).
 */
export function resolveSessionStateForAccount(
  account: ProspectAccount,
): StorageState | string {
  if (account.sessionStateEnc) {
    try {
      return JSON.parse(decryptSecret(account.sessionStateEnc)) as StorageState
    } catch (error) {
      outboundLog('account.session_decrypt_failed', {
        accountId: account.id,
        accountLabel: account.label,
        error: error instanceof Error ? error.message : String(error),
      })
      // El blob está corrupto: cae al archivo o fuerza re-login.
    }
  }

  return resolveSessionPathForAccount(account)
}

/**
 * Persiste el storageState actual del contexto en Neon (cifrado). Se llama tras
 * un login exitoso y, oportunamente, al cerrar, para refrescar cookies rotadas
 * y así alargar la vida de la sesión sin intervención manual.
 */
export async function persistAccountSessionState(
  accountId: string,
  context: BrowserContext,
): Promise<void> {
  const state = await context.storageState()
  const sessionStateEnc = encryptSecret(JSON.stringify(state))
  await db.prospectAccount.update({
    where: { id: accountId },
    data: { sessionStateEnc },
  })
}

export type BuildProxyOptions = {
  /** Si se omite, usa el master `PLAYWRIGHT_USE_ACCOUNT_PROXY`. */
  useProxy?: boolean
}

export function buildProxyOption(
  account: ProspectAccount,
  options: BuildProxyOptions = {},
): NonNullable<LaunchOptions['proxy']> | undefined {
  const useProxy = options.useProxy ?? shouldUseAccountProxy()
  if (!useProxy) return undefined

  if (!account.proxyHost || !account.proxyPort) return undefined

  const proxy: NonNullable<LaunchOptions['proxy']> = {
    server: `http://${account.proxyHost}:${account.proxyPort}`,
  }

  if (account.proxyUser) {
    proxy.username = account.proxyUser
  }

  if (account.proxyPassEnc) {
    try {
      proxy.password = decryptSecret(account.proxyPassEnc)
    } catch (error) {
      // Sin password el proxy respondería 407 en cada request: mejor fallar
      // rápido y sacar la cuenta de rotación que quemar la oleada.
      throw new AccountProxyConfigError(
        account.id,
        `Cannot decrypt proxy password for account "${account.label}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return proxy
}

export type LaunchAccountBrowserOptions = {
  headless?: boolean
  /** Job que define la política de proxy por defecto. */
  job?: PlaywrightJob
  /** Override explícito del proxy (tiene prioridad sobre `job`). */
  useProxy?: boolean
}

/**
 * En Docker/Railway no hay DISPLAY: Chromium headed aborta con
 * `browserType.launch: Target page, context or browser…`. Forzamos headless
 * salvo que exista un display o se pida explícitamente HEADLESS=false en local.
 */
export function resolveHeadless(requestedHeadless = true): boolean {
  if (requestedHeadless) return true

  const hasDisplay = Boolean(process.env.DISPLAY?.trim())
  const inCiOrDocker =
    process.env.CI === 'true' ||
    process.env.RAILWAY_ENVIRONMENT !== undefined ||
    fs.existsSync('/.dockerenv')

  if (inCiOrDocker && !hasDisplay) {
    outboundLog('playwright.force_headless', {
      reason: 'no_display_in_container',
      requestedHeadless,
      CI: process.env.CI ?? null,
      RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT ?? null,
    })
    return true
  }

  return false
}

/**
 * Un browser por cuenta, con el proxy a nivel de launch cuando el job lo pide.
 *
 * Chromium ignora `proxy` por-contexto salvo que el browser se haya lanzado
 * con una opción proxy; lanzar por cuenta garantiza que cada cuenta sale por
 * su IP de Decodo (y la cascada es serial, así que el costo es marginal).
 */
export async function launchBrowserForAccount(
  account: ProspectAccount,
  options: LaunchAccountBrowserOptions = {},
): Promise<Browser> {
  const job = options.job ?? 'outbound'
  const useProxy = options.useProxy ?? shouldUseAccountProxyForJob(job)
  const proxy = buildProxyOption(account, { useProxy })
  const headless = resolveHeadless(options.headless ?? true)

  outboundLog('playwright.browser_launch', {
    accountId: account.id,
    accountLabel: account.label,
    job,
    headless,
    networkMode: useProxy ? 'account_proxy' : 'direct',
    blockHeavyAssets: shouldBlockHeavyAssets(),
    proxyHost: useProxy ? (account.proxyHost ?? null) : null,
    proxyPort: useProxy ? (account.proxyPort ?? null) : null,
  })

  try {
    return await chromium.launch({
      headless,
      ...getChromeChannelOption(),
      ...(proxy ? { proxy } : {}),
    })
  } catch (error) {
    outboundLog('playwright.browser_launch_failed', {
      accountId: account.id,
      accountLabel: account.label,
      job,
      headless,
      networkMode: useProxy ? 'account_proxy' : 'direct',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 6) : null,
    })
    throw error
  }
}

export async function createContextForAccount(
  browser: Browser,
  account: ProspectAccount,
): Promise<BrowserContext> {
  const storageState = resolveSessionStateForAccount(account)

  outboundLog('playwright.context_launch', {
    accountId: account.id,
    accountLabel: account.label,
    sessionSource: typeof storageState === 'string' ? 'file' : 'neon',
    blockHeavyAssets: shouldBlockHeavyAssets(),
  })

  const context = await browser.newContext({
    storageState,
    ...getColombiaContextOptions(),
  })

  applyContextTimeouts(context)
  await installBandwidthSaver(context)
  return context
}
