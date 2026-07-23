import type { Browser, BrowserContext, Page } from 'playwright'
import type { ProspectAccount } from '@repo/db'
import { dismissBlockingOverlays } from '../scraping/airbnb-scraper'
import { isSessionValid } from '../scraping/session-utils'
import { setActivePlaywrightAccount } from '../persistence/system-state'
import {
  accountHasStoredSession,
  createContextForAccount,
  launchBrowserForAccount,
  shouldUseAccountProxyForJob,
  type PlaywrightJob,
} from '../scraping/playwright-context'
import { isAutoLoginEnabled, loginAccountAndSaveSession } from './account-login'
import { markAccountSessionActive } from './account-repository'
import { outboundLog } from '../logging/outbound-logger'

export type AccountBrowserSession = {
  browser: Browser
  context: BrowserContext
  page: Page
}

export type OpenAccountSessionOptions = {
  headless?: boolean
  /** harvest | inbound — define si usa proxy (default: red directa). */
  job?: Extract<PlaywrightJob, 'harvest' | 'inbound'>
}

function baseUrl(): string {
  return process.env.AIRBNB_BASE_URL ?? 'https://www.airbnb.com.co'
}

export async function openAccountBrowserSession(
  account: ProspectAccount,
  options: OpenAccountSessionOptions = {},
): Promise<AccountBrowserSession> {
  await setActivePlaywrightAccount(account.id)

  const job = options.job ?? 'harvest'
  const browser = await launchBrowserForAccount(account, {
    headless: options.headless ?? true,
    job,
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
 *
 * Si el job opera en red directa pero el login requiere proxy, relanza el
 * browser con job=login para anclar la sesión a la IP residencial.
 */
export async function openAccountBrowserSessionWithLogin(
  account: ProspectAccount,
  options: OpenAccountSessionOptions = {},
): Promise<AccountBrowserSession> {
  await setActivePlaywrightAccount(account.id)

  const job = options.job ?? 'harvest'
  const headless = options.headless ?? true
  let browser = await launchBrowserForAccount(account, { headless, job })

  try {
    const hasSession = accountHasStoredSession(account)

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

    // Login debe salir por proxy sticky aunque harvest/inbound vayan en directo.
    const jobUsesProxy = shouldUseAccountProxyForJob(job)
    const loginUsesProxy = shouldUseAccountProxyForJob('login')
    if (loginUsesProxy && !jobUsesProxy) {
      outboundLog('playwright.relaunch_for_login_proxy', {
        accountId: account.id,
        accountLabel: account.label,
        previousJob: job,
      })
      await browser.close()
      browser = await launchBrowserForAccount(account, { headless, job: 'login' })
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
