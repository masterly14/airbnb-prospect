import fs from 'fs'
import path from 'path'
import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright'
import type { ProspectAccount } from '@repo/db'
import { decryptSecret } from '@repo/crypto'
import { getChromeChannelOption, getColombiaContextOptions } from './airbnb-context'
import { outboundLog } from '../logging/outbound-logger'

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

export function buildProxyOption(
  account: ProspectAccount,
): NonNullable<LaunchOptions['proxy']> | undefined {
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
    proxyHost: account.proxyHost ?? null,
    proxyPort: account.proxyPort ?? null,
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
  const storageState = resolveSessionPathForAccount(account)

  outboundLog('playwright.context_launch', {
    accountId: account.id,
    accountLabel: account.label,
    sessionPath: storageState,
  })

  return browser.newContext({
    storageState,
    ...getColombiaContextOptions(),
  })
}
