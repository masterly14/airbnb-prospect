/**
 * Diagnóstico del flujo contact_host → composer → send.
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { db } from '@repo/db'
import {
  getAirbnbBaseUrl,
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../src/scraping/airbnb-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const AUTH_FILE = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')
const OUT_DIR = path.resolve(__dirname, '../playwright/.auth')

async function dumpPage(page: import('playwright').Page, label: string) {
  const screenshot = path.join(OUT_DIR, `probe-${label}.png`)
  await page.screenshot({ path: screenshot, fullPage: false })
  console.log(`\n=== ${label} ===`)
  console.log(`URL: ${page.url()}`)
  console.log(`Screenshot: ${screenshot}`)

  const buttons = await page.locator('button:visible').allTextContents()
  console.log('Buttons:', buttons.slice(0, 30).map((t) => `"${t.trim().replace(/\s+/g, ' ')}"`).join(' | '))

  const textareas = await page.locator('textarea:visible').evaluateAll((els) =>
    els.map((el) => ({
      placeholder: el.getAttribute('placeholder'),
      testid: el.getAttribute('data-testid'),
      name: el.getAttribute('name'),
    })),
  )
  console.log('Textareas:', JSON.stringify(textareas))

  const inputs = await page.locator('[contenteditable="true"]:visible, input[type="text"]:visible').evaluateAll((els) =>
    els.map((el) => ({
      tag: el.tagName,
      placeholder: el.getAttribute('placeholder'),
      testid: el.getAttribute('data-testid'),
      role: el.getAttribute('role'),
    })),
  )
  console.log('Inputs/contenteditable:', JSON.stringify(inputs))
}

async function main() {
  const leadId = process.argv[2] ?? '2b2d86f6-8828-47fd-9ddc-63597a99b1cd'
  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead?.primaryListingUrl) process.exit(1)

  const browser = await chromium.launch({ headless: false, ...getChromeChannelOption() })
  const context = await browser.newContext({ storageState: AUTH_FILE, ...getColombiaContextOptions() })
  const page = await context.newPage()

  await page.goto(lead.primaryListingUrl, { waitUntil: 'domcontentloaded' })
  await dismissBlockingOverlays(page)
  await dumpPage(page, 'listing')

  const link = page.locator('a[href*="/contact_host/"]').first()
  await link.click({ timeout: 10_000 })
  await page.waitForTimeout(2_000)
  await dismissBlockingOverlays(page)
  await dumpPage(page, 'after-contact-click')

  const match = lead.primaryListingUrl.match(/\/rooms\/(\d+)/)
  if (match) {
    const base = getAirbnbBaseUrl()
    await page.goto(`${base}/contact_host/${match[1]}/send_message`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2_000)
    await dismissBlockingOverlays(page)
    await dumpPage(page, 'direct-contact-url')
  }

  await page.waitForTimeout(8_000)
  await browser.close()
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
