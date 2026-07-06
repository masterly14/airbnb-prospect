/**
 * Diagnóstico: abre un listing y lista botones/links visibles relacionados con mensajes.
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import { db } from '@repo/db'
import {
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../src/scraping/airbnb-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const AUTH_FILE = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')
const OUT_DIR = path.resolve(__dirname, '../playwright/.auth')

async function main() {
  const leadId = process.argv[2]
  const lead = leadId
    ? await db.lead.findUnique({ where: { id: leadId } })
    : await db.lead.findFirst({ where: { totalProperties: { gte: 2 } }, orderBy: { totalProperties: 'desc' } })

  if (!lead?.primaryListingUrl) {
    console.error('Lead not found or missing listing URL')
    process.exit(1)
  }

  if (!fs.existsSync(AUTH_FILE)) {
    console.error('No session file. Run: npm run auth:login')
    process.exit(1)
  }

  console.log(`Probing: ${lead.name} → ${lead.primaryListingUrl}`)

  const browser = await chromium.launch({
    headless: false,
    ...getChromeChannelOption(),
  })
  const context = await browser.newContext({
    ...getColombiaContextOptions(),
    storageState: AUTH_FILE,
  })
  const page = await context.newPage()

  await page.goto(lead.primaryListingUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await dismissBlockingOverlays(page)
  await page.waitForTimeout(2_000)

  const screenshot = path.join(OUT_DIR, 'probe-listing.png')
  await page.screenshot({ path: screenshot, fullPage: false })
  console.log(`Screenshot: ${screenshot}`)
  console.log(`URL: ${page.url()}`)
  console.log(`Title: ${await page.title()}`)

  const buttons = await page.locator('button:visible').allTextContents()
  console.log('\n--- Visible buttons (first 40) ---')
  buttons.slice(0, 40).forEach((t, i) => console.log(`${i + 1}. "${t.trim().replace(/\s+/g, ' ')}"`))

  const links = await page.locator('a:visible').evaluateAll((els) =>
    els
      .map((el) => ({ text: (el.textContent ?? '').trim().replace(/\s+/g, ' '), href: el.getAttribute('href') ?? '' }))
      .filter((l) => /contact|mensaje|message|host|anfitri/i.test(l.text + l.href))
      .slice(0, 20),
  )
  console.log('\n--- Links matching contact/message ---')
  links.forEach((l) => console.log(`"${l.text}" → ${l.href}`))

  const dataTestIds = await page.locator('[data-testid*="message"], [data-testid*="contact"], [data-testid*="host"]').evaluateAll((els) =>
    els.map((el) => ({
      testid: el.getAttribute('data-testid'),
      tag: el.tagName,
      text: (el.textContent ?? '').trim().slice(0, 80),
    })),
  )
  console.log('\n--- data-testid message/contact/host ---')
  dataTestIds.forEach((d) => console.log(JSON.stringify(d)))

  await page.waitForTimeout(5_000)
  await browser.close()
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
