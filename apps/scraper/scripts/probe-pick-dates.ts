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

async function openCalendar(page: Page) {
  await page.mouse.wheel(0, 1200)
  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(1500)
}

async function listCells(page: Page) {
  return page.locator('[role="gridcell"] button, td[role="button"]').evaluateAll((els) =>
    els
      .map((el) => ({
        text: (el.textContent ?? '').trim(),
        aria: el.getAttribute('aria-label') ?? '',
        disabled: (el as HTMLButtonElement).disabled,
      }))
      .filter((c) => /^\d+$/.test(c.text)),
  )
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...getChromeChannelOption() })
  const page = await (
    await browser.newContext({ storageState: AUTH, ...getColombiaContextOptions() })
  ).newPage()
  await page.goto(`${getAirbnbBaseUrl()}/contact_host/1715477827914576124/send_message`, {
    waitUntil: 'domcontentloaded',
  })
  await dismissBlockingOverlays(page)
  await openCalendar(page)

  for (let month = 0; month < 6; month++) {
    const cells = await listCells(page)
    const available = cells.filter(
      (c) => !c.disabled && !/no está disponible|not available|fecha inválida/i.test(c.aria),
    )
    console.log(`Month offset ${month}: total=${cells.length} available=${available.length}`)
    if (available.length >= 2) {
      console.log('Pick:', available.slice(0, 5))
      break
    }
    const next = page.locator('button[aria-label*="derecha"], button[aria-label*="next month"]').first()
    await next.click()
    await page.waitForTimeout(800)
  }

  await browser.close()
}

main().catch(console.error)
