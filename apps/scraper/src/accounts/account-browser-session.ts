import fs from 'fs'
import type { Browser, BrowserContext, Page } from 'playwright'
import type { ProspectAccount } from '@repo/db'
import { dismissBlockingOverlays } from '../scraping/airbnb-scraper'
import { isSessionValid } from '../scraping/session-utils'
import { setActivePlaywrightAccount } from '../persistence/system-state'
import {
  accountSessionPath,
  createContextForAccount,
  launchBrowserForAccount,
} from '../scraping/playwright-context'
import { isAutoLoginEnabled, loginAccountAndSaveSession } from './account-login'
import { markAccountSessionActive } from './account-repository'

export type AccountBrowserSession = {
  browser: Browser
  context: BrowserContext
  page: Page
}

function baseUrl(): string {
  return process.env.AIRBNB_BASE_URL ?? 'https://www.airbnb.com.co'
}

export async function openAccountBrowserSession(
  account: ProspectAccount,
  options: { headless?: boolean } = {},
): Promise<AccountBrowserSession> {
  await setActivePlaywrightAccount(account.id)

  const browser = await launchBrowserForAccount(account, {
    headless: options.headless ?? true,
  })
  const context = await createContextForAccount(browser, account)
  const page = await context.newPage()

  await page.goto(baseUrl(), { waitUntil: 'domcontentloaded' })
  await dismissBlockingOverlays(page)

  return { browser, context, page }
}

/**
 * Abre una sesión de navegador para la cuenta y garantiza que quede logueada:
 * usa la sesión en disco si es válida y, si expiró o no existe, intenta un
 * auto-login (cuando está habilitado). Es el equivalente para harvest/inbound
 * del `prepareAccountContext` que usa outbound, para que la rotación de cuentas
 * pueda recuperar sesiones caídas sin intervención manual.
 */
export async function openAccountBrowserSessionWithLogin(
  account: ProspectAccount,
  options: { headless?: boolean } = {},
): Promise<AccountBrowserSession> {
  await setActivePlaywrightAccount(account.id)

  const browser = await launchBrowserForAccount(account, {
    headless: options.headless ?? true,
  })

  try {
    const hasSession =
      Boolean(account.sessionPath && fs.existsSync(account.sessionPath)) ||
      fs.existsSync(accountSessionPath(account.id))

    if (hasSession) {
      const context = await createContextForAccount(browser, account)
      const page = await context.newPage()

      await page.goto(baseUrl(), { waitUntil: 'domcontentloaded' })
      await dismissBlockingOverlays(page)

      if (await isSessionValid(page)) {
        return { browser, context, page }
      }

      // Sesión en disco pero expirada: cerrar contexto y reintentar login limpio.
      await context.close()
    }

    if (!isAutoLoginEnabled()) {
      const { HarvestSessionExpiredError } = await import('../harvest/errors')
      throw new HarvestSessionExpiredError()
    }

    const { context, page, sessionPath } = await loginAccountAndSaveSession(
      browser,
      account,
    )
    await markAccountSessionActive(account.id, sessionPath)

    await page.goto(baseUrl(), { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)

    return { browser, context, page }
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }
}

export async function assertAccountSessionValid(page: Page): Promise<void> {
  if (!(await isSessionValid(page))) {
    const { HarvestSessionExpiredError } = await import('../harvest/errors')
    throw new HarvestSessionExpiredError()
  }
}
