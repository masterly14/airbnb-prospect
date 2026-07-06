import dotenv from 'dotenv'
import path from 'path'
import { chromium, type Page } from 'playwright'
import { db } from '@repo/db'
import {
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../src/scraping/airbnb-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
const AUTH = path.resolve(__dirname, '../playwright/.auth/airbnb-session.json')

async function pickDates(page: Page) {
  const dayCells = () =>
    page.locator('[role="gridcell"] button, td[role="button"], [data-testid*="calendar"] button')
  const snap = async () => {
    const count = await dayCells().count()
    const days: { index: number; available: boolean }[] = []
    for (let i = 0; i < count; i++) {
      const cell = dayCells().nth(i)
      const text = ((await cell.textContent()) ?? '').trim()
      if (!/^\d{1,2}$/.test(text)) continue
      const disabled =
        (await cell.isDisabled().catch(() => false)) ||
        (await cell.getAttribute('aria-disabled').catch(() => null)) === 'true'
      days.push({ index: i, available: !disabled })
    }
    return days
  }
  const ci = (await snap()).find((d) => d.available)
  if (!ci) return false
  await dayCells().nth(ci.index).click()
  await page.waitForTimeout(700)
  const co = (await snap()).find((d) => d.available && d.index > ci.index)
  if (!co) return false
  await dayCells().nth(co.index).click()
  await page.waitForTimeout(700)
  return /check_in=.*check_out=/.test(page.url())
}

async function testListing(page: Page, name: string, listingUrl: string) {
  const m = listingUrl.match(/\/rooms\/(\d+)/)
  if (!m) {
    console.log(`${name}: no room id in ${listingUrl}`)
    return
  }
  const contactUrl = `https://www.airbnb.com.co/contact_host/${m[1]}/send_message`
  await page.goto(contactUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await dismissBlockingOverlays(page)
  await page.waitForTimeout(1500)

  const ta = page.locator('textarea[aria-label*="mensaje"]').first()
  if (!(await ta.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log(`${name}: no message textarea (listing may be inactive)`)
    return
  }
  await ta.fill('Hola, prueba automatizada — ignorar por favor.')

  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(2000)

  // If calendar required, pick dates
  if (page.url().includes('availability-calendar') || (await page.getByText(/selecciona las fechas/i).isVisible({ timeout: 1500 }).catch(() => false))) {
    const ok = await pickDates(page)
    if (!ok) {
      console.log(`${name}: could not pick dates`)
      return
    }
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
    await page.waitForTimeout(3500)
  }

  const idGate = await page.getByText(/documento de identidad|identity document|verifica tu identidad/i).isVisible({ timeout: 2000 }).catch(() => false)
  const url = page.url()
  console.log(`${name}: idGate=${idGate} finalUrl=${url}`)
}

async function main() {
  const leads = await db.lead.findMany({ select: { name: true, primaryListingUrl: true } })
  const browser = await chromium.launch({ headless: true, ...getChromeChannelOption() })
  const page = await (
    await browser.newContext({ storageState: AUTH, ...getColombiaContextOptions() })
  ).newPage()

  for (const lead of leads) {
    if (!lead.primaryListingUrl) continue
    try {
      await testListing(page, lead.name, lead.primaryListingUrl)
    } catch (e) {
      console.log(`${lead.name}: ERR ${(e as Error).message.slice(0, 80)}`)
    }
  }

  await browser.close()
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
