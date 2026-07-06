import dotenv from 'dotenv'
import path from 'path'
import { chromium } from 'playwright'
import {
  getAirbnbBaseUrl,
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../src/scraping/airbnb-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
const AUTH = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')

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
  await page.waitForTimeout(1500)

  const textarea = page.locator('textarea[aria-label*="mensaje"]').first()
  await textarea.fill('Hola, prueba fechas — ignorar.')

  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(2000)

  const buttons = await page.locator('button:visible').allTextContents()
  console.log('Buttons after calendar open:', buttons.map((b) => b.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 40))

  const calendarCells = await page.locator('[role="gridcell"] button, td[role="button"], [data-testid*="calendar"] button').evaluateAll((els) =>
    els.slice(0, 20).map((el) => ({
      text: (el.textContent ?? '').trim(),
      aria: el.getAttribute('aria-label'),
      disabled: (el as HTMLButtonElement).disabled,
    })),
  )
  console.log('Calendar cells:', JSON.stringify(calendarCells.slice(0, 15), null, 2))

  await page.screenshot({ path: path.resolve(__dirname, '../playwright/.auth/probe-calendar.png'), fullPage: true })

  await browser.close()
}

main().catch(console.error)
