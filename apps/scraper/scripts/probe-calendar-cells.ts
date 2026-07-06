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
  await page.goto(`${getAirbnbBaseUrl()}/contact_host/1715477827914576124/send_message`, {
    waitUntil: 'domcontentloaded',
  })
  await dismissBlockingOverlays(page)
  await page.mouse.wheel(0, 1200)
  await page.waitForTimeout(1500)

  const textarea = page.locator('textarea[aria-label*="mensaje"]').first()
  await textarea.waitFor({ state: 'visible', timeout: 15_000 })
  await textarea.fill('Hola, prueba fechas — ignorar.')
  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(2000)

  const calText = await page.getByText(/selecciona las fechas|select dates/i).isVisible().catch(() => false)
  console.log('Calendar visible:', calText)

  const cells = page.locator(
    '[role="gridcell"] button, td[role="button"], [data-testid*="calendar"] button',
  )
  const count = await cells.count()
  console.log('Cell count:', count)

  const sample = []
  for (let i = 0; i < Math.min(count, 90); i++) {
    const cell = cells.nth(i)
    sample.push({
      text: ((await cell.textContent()) ?? '').trim(),
      aria: ((await cell.getAttribute('aria-label')) ?? '').slice(0, 80),
      disabled: await cell.isDisabled().catch(() => false),
    })
  }
  console.log(JSON.stringify(sample, null, 2))

  await browser.close()
}

main().catch(console.error)
