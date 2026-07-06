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
  })
  await dismissBlockingOverlays(page)
  await page.mouse.wheel(0, 1200)
  await page.waitForTimeout(1500)

  const textarea = page.locator('textarea[aria-label*="mensaje"]').first()
  await textarea.waitFor({ state: 'visible', timeout: 15_000 })
  await textarea.fill('Hola, prueba automatizada — ignorar.')
  await page.waitForTimeout(500)

  const sendBtn = page.getByRole('button', { name: /^enviar mensaje$/i })
  const disabled = await sendBtn.isDisabled().catch(() => null)
  console.log('Send disabled?', disabled)

  await sendBtn.click({ timeout: 10_000 })
  await page.waitForTimeout(4000)
  console.log('After send URL:', page.url())

  const dialogs = await page.locator('[role="dialog"], [data-testid="modal-container"]').allTextContents()
  console.log('Dialogs:', dialogs.map((d) => d.slice(0, 200)))

  await page.screenshot({ path: path.resolve(__dirname, '../playwright/.auth/probe-after-send.png') })

  await page.goto(`${base}/guest/messages`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const inboxText = await page.locator('body').innerText()
  console.log('Inbox snippet:', inboxText.slice(0, 600))

  await browser.close()
}

main().catch(console.error)
