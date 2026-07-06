import fs from 'fs'
import path from 'path'
import type { Browser, BrowserContext, Page } from 'playwright'
import { toComposioUserId } from '@repo/composio'
import { decryptSecret } from '@repo/crypto'
import type { ProspectAccount } from '@repo/db'
import { loginAirbnb, type AccountAuthConfig } from '../../tests/helpers/airbnb-auth'
import { getColombiaContextOptions } from '../scraping/airbnb-context'
import { accountSessionPath, persistAccountSessionState } from '../scraping/playwright-context'
import { outboundLog } from '../logging/outbound-logger'

/**
 * La cuenta no tiene con qué re-loguearse por sí sola: falta contraseña
 * cifrada o el Gmail de Composio para resolver el OTP de Airbnb.
 */
export class AccountLoginPrerequisitesError extends Error {
  constructor(
    public readonly accountId: string,
    label: string,
    reason: string,
  ) {
    super(`Cannot auto-login account "${label}" (${accountId}): ${reason}`)
    this.name = 'AccountLoginPrerequisitesError'
  }
}

export function isAutoLoginEnabled(): boolean {
  return process.env.OUTBOUND_AUTO_LOGIN !== 'false'
}

/**
 * Traduce una cuenta de DB a la config que consume `loginAirbnb`, descifrando
 * la contraseña y adjuntando la identidad Composio de la cuenta para el OTP.
 */
export function buildAccountAuthConfig(account: ProspectAccount): AccountAuthConfig {
  if (!account.airbnbPasswordEnc) {
    throw new AccountLoginPrerequisitesError(
      account.id,
      account.label,
      'missing encrypted Airbnb password',
    )
  }

  if (!account.composioConnectionId) {
    throw new AccountLoginPrerequisitesError(
      account.id,
      account.label,
      'Gmail not connected in Composio (connect it in /settings/accounts)',
    )
  }

  let password: string
  try {
    password = decryptSecret(account.airbnbPasswordEnc)
  } catch (error) {
    throw new AccountLoginPrerequisitesError(
      account.id,
      account.label,
      `cannot decrypt Airbnb password: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return {
    accountId: account.id,
    email: account.airbnbEmail,
    password,
    composioUserId: toComposioUserId(account.id),
    composioConnectionId: account.composioConnectionId,
    sessionPath: accountSessionPath(account.id),
  }
}

/**
 * Abre un contexto limpio (sin storageState), realiza el login completo de
 * Airbnb con 2FA vía Composio y persiste el storageState en disco.
 *
 * El browser debe haberse lanzado con el proxy de la cuenta (ver
 * `launchBrowserForAccount`) para que el login salga por su IP.
 */
export async function loginAccountAndSaveSession(
  browser: Browser,
  account: ProspectAccount,
): Promise<{ context: BrowserContext; page: Page; sessionPath: string }> {
  const config = buildAccountAuthConfig(account)
  const sessionPath = accountSessionPath(account.id)

  outboundLog('account.auto_login_start', {
    accountId: account.id,
    accountLabel: account.label,
    composioUserId: config.composioUserId ?? null,
    hasComposioConnection: Boolean(config.composioConnectionId),
  })

  const context = await browser.newContext(getColombiaContextOptions())
  const page = await context.newPage()

  try {
    await loginAirbnb(page, config)
  } catch (error) {
    await context.close()
    outboundLog('account.auto_login_failed', {
      accountId: account.id,
      accountLabel: account.label,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
  await context.storageState({ path: sessionPath })

  // Fuente de verdad: Neon. El archivo queda solo como conveniencia de dev;
  // la sesión sobrevive reinicios sin volumen porque vive cifrada en la DB.
  await persistAccountSessionState(account.id, context)

  outboundLog('account.auto_login_success', {
    accountId: account.id,
    accountLabel: account.label,
    sessionPath,
    persistedToNeon: true,
  })

  return { context, page, sessionPath }
}
