import fs from 'fs'
import path from 'path'
import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright'
import { db, type ProspectAccount } from '@repo/db'
import { decryptSecret, encryptSecret } from '@repo/crypto'
import { getChromeChannelOption, getColombiaContextOptions } from './airbnb-context'
import { outboundLog } from '../logging/outbound-logger'

/** storageState de Playwright (cookies + origins) como objeto en memoria. */
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>

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

export function accountSessionPath(accountId: string): string {
  return path.resolve(__dirname, `../../playwright/.auth/account-${accountId}.json`)
}

/** Por defecto red directa. Proxy residencial solo con PLAYWRIGHT_USE_ACCOUNT_PROXY=true. */
export function shouldUseAccountProxy(): boolean {
  return process.env.PLAYWRIGHT_USE_ACCOUNT_PROXY === 'true'
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

export function buildProxyOption(
  account: ProspectAccount,
): NonNullable<LaunchOptions['proxy']> | undefined {
  if (!shouldUseAccountProxy()) return undefined

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

/**
 * Un browser por cuenta, con el proxy a nivel de launch.
 *
 * Chromium ignora `proxy` por-contexto salvo que el browser se haya lanzado
 * con una opción proxy; lanzar por cuenta garantiza que cada cuenta sale por
 * su IP de EProxies (y la cascada es serial, así que el costo es marginal).
 */
export async function launchBrowserForAccount(
  account: ProspectAccount,
  options: { headless?: boolean } = {},
): Promise<Browser> {
  const proxy = buildProxyOption(account)

  outboundLog('playwright.browser_launch', {
    accountId: account.id,
    accountLabel: account.label,
    networkMode: shouldUseAccountProxy() ? 'account_proxy' : 'direct',
    proxyHost: shouldUseAccountProxy() ? (account.proxyHost ?? null) : null,
    proxyPort: shouldUseAccountProxy() ? (account.proxyPort ?? null) : null,
  })

  return chromium.launch({
    headless: options.headless ?? true,
    ...getChromeChannelOption(),
    ...(proxy ? { proxy } : {}),
  })
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
  })

  return browser.newContext({
    storageState,
    ...getColombiaContextOptions(),
  })
}
