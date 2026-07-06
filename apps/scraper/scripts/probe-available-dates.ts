import dotenv from 'dotenv'
import path from 'path'
import { chromium, type Page } from 'playwright'
import {
  getAirbnbBaseUrl,
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../src/scraping/airbnb-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
const AUTH = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')

async function listAvailable(page: Page) {
  const cells = page.locator('td[role="button"], [role="gridcell"] button').filter({
    hasNotText: /^$/,
  })
  const count = await cells.count()
  const available: string[] = []
  for (let i = 0; i < count; i++) {
    const cell = cells.nth(i)
    const aria = (await cell.getAttribute('aria-label')) ?? ''
    const text = ((await cell.textContent()) ?? '').trim()
    if (!text || !/^\d+$/.test(text)) continue
    if (/no está disponible|not available|invalid/i.test(aria)) continue
    available.push(`${text}:${aria.slice(0, 60)}`)
  }
  return available
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...getChromeChannelOption() })
  const page = await (
    await browser.newContext({ storageState: AUTH, ...getColombiaContextOptions() })
  ).newPage()

  const base = getAirbnbBaseUrl()
  await page.goto(`${base}/contact_host/1715477827914576124/send_message`, {
    waitUntil: 'domcontentloaded',
  })
  await dismissBlockingOverlays(page)
  await page.mouse.wheel(0, 1200)
  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(1500)

  console.log('June available:', await listAvailable(page))

  for (let m = 0; m < 4; m++) {
    const next = page
      .locator('button[aria-label*="siguiente"], button[aria-label*="next"], button[aria-label*="derecha"]')
      .first()
    if (!(await next.isVisible().catch(() => false))) break
    await next.click()
    await page.waitForTimeout(800)
    const avail = await listAvailable(page)
    console.log(`Month+${m + 1} available (${avail.length}):`, avail.slice(0, 10))
    if (avail.length >= 2) break
  }

  await browser.close()
}

main().catch(console.error)
