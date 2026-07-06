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
  await page.goto(`${base}/guest/messages`, { waitUntil: 'domcontentloaded' })
  await dismissBlockingOverlays(page)
  await page.waitForTimeout(3_000)

  const links = await page.locator('a[href*="/guest/messages/"]').evaluateAll((els) =>
    els.slice(0, 15).map((el) => ({
      href: el.getAttribute('href'),
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 100),
    })),
  )
  console.log('Thread links:', JSON.stringify(links, null, 2))
  console.log('URL:', page.url())

  await page.screenshot({ path: path.resolve(__dirname, '../playwright/.auth/probe-inbox.png') })
  await browser.close()
}

main().catch(console.error)
