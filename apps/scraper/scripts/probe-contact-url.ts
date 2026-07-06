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
    timeout: 60_000,
  })
  await dismissBlockingOverlays(page)
  await page.waitForTimeout(3_000)

  const out = path.resolve(__dirname, '../playwright/.auth/probe-contact-url.png')
  await page.screenshot({ path: out })

  const buttons = await page.locator('button:visible').allTextContents()
  console.log('URL:', page.url())
  console.log('Title:', await page.title())
  console.log(
    'Buttons:',
    buttons
      .map((t) => t.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, 30),
  )

  const composers = await page
    .locator('textarea, [contenteditable="true"], input[type="text"]')
    .evaluateAll((els) =>
      els.map((el) => ({
        tag: el.tagName,
        placeholder: el.getAttribute('placeholder'),
        testid: el.getAttribute('data-testid'),
        ariaLabel: el.getAttribute('aria-label'),
        visible: (el as HTMLElement).offsetParent !== null,
      })),
    )
  console.log('Composers:', JSON.stringify(composers, null, 2))

  const html = await page.locator('body').innerText()
  console.log('Body snippet:', html.slice(0, 800))

  await browser.close()
}

main().catch(console.error)
