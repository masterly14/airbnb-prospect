import type { Browser, BrowserContext, Page } from 'playwright'
import type { ProspectAccount } from '@repo/db'
import { dismissBlockingOverlays } from '../scraping/airbnb-scraper'
import { isSessionValid } from '../scraping/session-utils'
import { setActivePlaywrightAccount } from '../persistence/system-state'
import {
  createContextForAccount,
  launchBrowserForAccount,
} from '../scraping/playwright-context'

export type AccountBrowserSession = {
  browser: Browser
  context: BrowserContext
  page: Page
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

  const baseUrl = process.env.AIRBNB_BASE_URL ?? 'https://www.airbnb.com.co'
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await dismissBlockingOverlays(page)

  return { browser, context, page }
}

export async function assertAccountSessionValid(page: Page): Promise<void> {
  if (!(await isSessionValid(page))) {
    const { HarvestSessionExpiredError } = await import('../harvest/errors')
    throw new HarvestSessionExpiredError()
  }
}
