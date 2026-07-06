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
const OUT = path.resolve(__dirname, '../playwright/.auth')

async function pickDates(page: Page) {
  const dayCells = () =>
    page.locator('[role="gridcell"] button, td[role="button"], [data-testid*="calendar"] button')
  const snap = async () => {
    const count = await dayCells().count()
    const days: { index: number; day: number; available: boolean }[] = []
    for (let i = 0; i < count; i++) {
      const cell = dayCells().nth(i)
      const text = ((await cell.textContent()) ?? '').trim()
      if (!/^\d{1,2}$/.test(text)) continue
      const disabled =
        (await cell.isDisabled().catch(() => false)) ||
        (await cell.getAttribute('aria-disabled').catch(() => null)) === 'true'
      days.push({ index: i, day: Number(text), available: !disabled })
    }
    return days
  }
  const ci = (await snap()).find((d) => d.available)!
  await dayCells().nth(ci.index).click()
  await page.waitForTimeout(700)
  const co = (await snap()).find((d) => d.available && d.index > ci.index)!
  await dayCells().nth(co.index).click()
  await page.waitForTimeout(700)
  console.log('dates url:', page.url())
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...getChromeChannelOption() })
  const page = await (
    await browser.newContext({ storageState: AUTH, ...getColombiaContextOptions() })
  ).newPage()
  const listingId = process.argv[2] ?? '1715477827914576124'
  await page.goto(`${getAirbnbBaseUrl()}/contact_host/${listingId}/send_message`, {
    waitUntil: 'domcontentloaded',
  })
  await dismissBlockingOverlays(page)
  await page.mouse.wheel(0, 1200)
  await page.waitForTimeout(1500)

  const ta = page.locator('textarea[aria-label*="mensaje"]').first()
  await ta.fill('Hola Juanfe, prueba automatizada de contacto. Por favor ignora este mensaje.')
  console.log('textarea value after fill:', await ta.inputValue())

  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(2000)
  console.log('after first send click, url:', page.url())

  await pickDates(page)

  // textarea value still there?
  const taAfter = page.locator('textarea[aria-label*="mensaje"]').first()
  const stillVisible = await taAfter.isVisible().catch(() => false)
  console.log('textarea visible after dates:', stillVisible, stillVisible ? 'value=' + (await taAfter.inputValue()) : '')

  await page.screenshot({ path: path.join(OUT, 'probe-before-final-send.png'), fullPage: true })

  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(4000)
  console.log('after final send click, url:', page.url())

  const buttons = await page.locator('button:visible').allTextContents()
  console.log('buttons after final send:', buttons.map((b) => b.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 25))

  const dialogs = await page.locator('[role="dialog"], [data-testid="modal-container"]').allTextContents()
  console.log('dialogs:', dialogs.map((d) => d.slice(0, 150)))

  await page.screenshot({ path: path.join(OUT, 'probe-after-final-send.png'), fullPage: true })

  await page.goto(`${getAirbnbBaseUrl()}/guest/messages`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const inbox = await page.locator('body').innerText()
  console.log('inbox snippet:', inbox.slice(0, 400))

  await browser.close()
}

main().catch((e) => console.error('ERR', e))
