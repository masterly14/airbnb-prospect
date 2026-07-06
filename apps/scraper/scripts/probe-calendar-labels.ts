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
  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(1500)

  const labels = await page.locator('button[aria-label]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label')).filter(Boolean),
  )
  console.log('button aria-labels:', labels)

  await browser.close()
}

main().catch(console.error)
