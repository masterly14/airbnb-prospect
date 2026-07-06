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
  await page.waitForTimeout(1500)
  await page.locator('textarea[aria-label*="mensaje"]').first().fill('probe pick dates')
  await page.getByRole('button', { name: /^enviar mensaje$/i }).click()
  await page.waitForTimeout(2000)

  const dayCells = page.locator(
    '[role="gridcell"] button, td[role="button"], [data-testid*="calendar"] button',
  )
  const count = await dayCells.count()
  console.log('cells', count, 'url', page.url())

  for (let i = 0; i < count - 1; i++) {
    const first = dayCells.nth(i)
    const text1 = ((await first.textContent()) ?? '').trim()
    if (!/^\d{1,2}$/.test(text1)) continue
    if (await first.isDisabled().catch(() => false)) continue
    console.log('try check-in', text1, 'idx', i)
    await first.click()
    await page.waitForTimeout(400)
    for (let j = i + 1; j < Math.min(i + 5, count); j++) {
      const second = dayCells.nth(j)
      const text2 = ((await second.textContent()) ?? '').trim()
      if (!/^\d{1,2}$/.test(text2)) continue
      if (await second.isDisabled().catch(() => false)) continue
      console.log(' try check-out', text2, 'idx', j)
      await second.click()
      await page.waitForTimeout(400)
      const save = page.getByRole('button', { name: /^guarda$|^save$/i })
      console.log(' save visible', await save.isVisible().catch(() => false))
      if (await save.isVisible().catch(() => false)) {
        await save.click()
        await page.waitForTimeout(1500)
        console.log('SUCCESS url', page.url())
        await browser.close()
        return
      }
    }
  }
  console.log('FAILED')
  await browser.close()
}

main().catch(console.error)
