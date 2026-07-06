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

async function selectContactDates(page: Page): Promise<void> {
  const calendarVisible =
    page.url().includes('availability-calendar') ||
    (await page.getByText(/selecciona las fechas|select dates/i).isVisible({ timeout: 2_000 }).catch(() => false)) ||
    (await page.getByRole('button', { name: /^guarda$|^save$/i }).isVisible({ timeout: 2_000 }).catch(() => false))

  console.log('calendarVisible:', calendarVisible)
  if (!calendarVisible) return

  const dayCells = () =>
    page.locator('[role="gridcell"] button, td[role="button"], [data-testid*="calendar"] button')
  const saveButton = page.getByRole('button', { name: /^guarda$|^save$/i })

  const snapshotDays = async () => {
    const count = await dayCells().count()
    const days: { index: number; day: number; available: boolean }[] = []
    for (let i = 0; i < count; i++) {
      const cell = dayCells().nth(i)
      const text = ((await cell.textContent()) ?? '').trim()
      if (!/^\d{1,2}$/.test(text)) continue
      const disabled =
        (await cell.isDisabled().catch(() => false)) ||
        (await cell.getAttribute('aria-disabled').catch(() => null)) === 'true'
      const aria = (await cell.getAttribute('aria-label')) ?? ''
      const blocked = disabled || /no está disponible|not available/i.test(aria)
      days.push({ index: i, day: Number(text), available: !blocked })
    }
    return days
  }

  for (let month = 0; month < 8; month++) {
    const days = await snapshotDays()
    const firstAvailable = days.find((d) => d.available)
    console.log(`month ${month}: ${days.length} cells, ${days.filter((d) => d.available).length} available, firstAvailable=${firstAvailable?.day} idx=${firstAvailable?.index}`)

    if (firstAvailable) {
      await dayCells().nth(firstAvailable.index).click({ timeout: 5_000 })
      await page.waitForTimeout(700)

      const afterCheckIn = await snapshotDays()
      const checkOut = afterCheckIn.find((d) => d.available && d.index > firstAvailable.index)
      console.log(`  after check-in: ${afterCheckIn.filter((d) => d.available).length} available, checkOut=${checkOut?.day} idx=${checkOut?.index}`)

      if (checkOut) {
        await dayCells().nth(checkOut.index).click({ timeout: 5_000 })
        await page.waitForTimeout(700)
        await page.screenshot({ path: path.resolve(__dirname, '../playwright/.auth/probe-after-range.png'), fullPage: true })
        const allButtons = await page.locator('button:visible').allTextContents()
        console.log('  buttons now:', allButtons.map((b) => b.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 30))
        console.log('  url:', page.url())
        const vis = await saveButton.isVisible({ timeout: 2_000 }).catch(() => false)
        console.log(`    save visible: ${vis}`)
        if (vis) {
          await saveButton.click({ timeout: 5_000 })
          await page.waitForTimeout(1_000)
          console.log('  SAVED. url:', page.url())
          return
        }
      }
    }

    const nextMonth = page.getByRole('button', { name: /flecha de la derecha|next month|mes siguiente/i }).first()
    if (!(await nextMonth.isVisible({ timeout: 2_000 }).catch(() => false))) {
      console.log('  no next month button')
      break
    }
    await nextMonth.click({ timeout: 5_000 })
    await page.waitForTimeout(800)
  }
  throw new Error('Could not select available dates')
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
  await page.mouse.wheel(0, 1200)
  await page.waitForTimeout(1500)
  await page.locator('textarea[aria-label*="mensaje"]').first().fill('probe select-dates logic')
  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(2000)

  await selectContactDates(page)

  await page.waitForTimeout(1000)
  console.log('Final URL:', page.url())
  await browser.close()
}

main().catch((e) => {
  console.error('ERR:', e.message)
  process.exit(1)
})
