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

const LISTING = process.argv[2] ?? '1715477827914576124'

async function snapshot(page: Page) {
  const cells = page.locator(
    '[role="gridcell"] button, td[role="button"], [data-testid*="calendar"] button',
  )
  const count = await cells.count()
  const days: { day: number; available: boolean }[] = []
  for (let i = 0; i < count; i++) {
    const cell = cells.nth(i)
    const text = ((await cell.textContent()) ?? '').trim()
    if (!/^\d{1,2}$/.test(text)) continue
    const disabled = await cell.isDisabled().catch(() => false)
    const aria = (await cell.getAttribute('aria-label')) ?? ''
    const blocked = disabled || /no está disponible|not available/i.test(aria)
    days.push({ day: Number(text), available: !blocked })
  }
  return days
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...getChromeChannelOption() })
  const page = await (
    await browser.newContext({ storageState: AUTH, ...getColombiaContextOptions() })
  ).newPage()
  await page.goto(`${getAirbnbBaseUrl()}/contact_host/${LISTING}/send_message`, {
    waitUntil: 'domcontentloaded',
  })
  await dismissBlockingOverlays(page)
  await page.mouse.wheel(0, 1200)
  await page.waitForTimeout(1500)
  await page.locator('textarea[aria-label*="mensaje"]').first().fill('probe disponibilidad')
  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(2000)

  for (let m = 0; m < 6; m++) {
    const days = await snapshot(page)
    const avail = days.filter((d) => d.available).map((d) => d.day)
    // detect consecutive pair
    let consec = false
    for (let i = 0; i < days.length - 1; i++) {
      if (days[i].available && days[i + 1].available && days[i + 1].day === days[i].day + 1) {
        consec = true
        break
      }
    }
    console.log(`Month +${m}: total=${days.length} available=${avail.length} consecutivePair=${consec} days=[${avail.join(',')}]`)

    const next = page
      .getByRole('button', { name: /flecha de la derecha|next month|mes siguiente/i })
      .first()
    if (!(await next.isVisible({ timeout: 2000 }).catch(() => false))) {
      console.log('No next-month button; stopping.')
      break
    }
    await next.click()
    await page.waitForTimeout(900)
  }

  await browser.close()
}

main().catch(console.error)
