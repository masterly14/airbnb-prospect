/**
 * Abre la sesión de Michell, revisa inbox y listing para un ID dado.
 */
import dotenv from 'dotenv'
import path from 'path'
import { chromium } from 'playwright'
import { db } from '@repo/db'
import { getAirbnbBaseUrl, getChromeChannelOption, getColombiaContextOptions } from '../src/scraping/airbnb-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'
import { collectInboxThreads } from '../src/messaging/airbnb-inbox'
import { parseHostAirbnbId } from '../src/scraping/airbnb-host'

dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false })

const MICHELL_ID = '69b667ad-a532-444e-a084-44ac7943daa8'
const LISTING_ID = process.argv[2] ?? '1599591058979163729'

async function main() {
  const account = await db.prospectAccount.findUnique({ where: { id: MICHELL_ID } })
  if (!account?.sessionPath) throw new Error('Michell account/session not found')

  const browser = await chromium.launch({ headless: true, ...getChromeChannelOption() })
  const context = await browser.newContext({
    storageState: account.sessionPath,
    ...getColombiaContextOptions(),
  })
  const page = await context.newPage()
  const base = getAirbnbBaseUrl()

  console.log('=== Session check ===')
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await dismissBlockingOverlays(page)
  console.log('Home URL:', page.url())
  console.log('Logged in:', !page.url().includes('/login'))

  console.log('\n=== Inbox threads (search listing id) ===')
  await page.goto(`${base}/guest/messages`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await dismissBlockingOverlays(page)
  await page.waitForTimeout(3_000)
  const threads = await collectInboxThreads(page, 50)
  const matching = threads.filter((t) => t.rawText.includes(LISTING_ID) || t.url.includes(LISTING_ID))
  console.log('Total threads:', threads.length)
  console.log('Matching listing:', JSON.stringify(matching, null, 2))
  if (matching.length === 0) {
    console.log('All thread previews:')
    for (const t of threads.slice(0, 10)) {
      console.log(`- ${t.hostName}: ${t.rawText.slice(0, 120).replace(/\s+/g, ' ')}`)
    }
  }

  console.log('\n=== Listing page ===')
  const listingUrl = `${base}/rooms/${LISTING_ID}`
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await dismissBlockingOverlays(page)
  await page.waitForTimeout(2_000)
  console.log('Listing URL:', page.url())
  console.log('Title:', await page.title())

  const hostLink = page.locator('a[href*="/users/show/"]').first()
  const hostHref = (await hostLink.count()) > 0 ? await hostLink.getAttribute('href') : null
  const hostName = (await hostLink.count()) > 0 ? (await hostLink.textContent())?.trim() : null
  const hostAirbnbId = hostHref ? parseHostAirbnbId(hostHref) : null
  console.log('Host:', { hostName, hostHref, hostAirbnbId })

  const contactButtons = await page.locator('button, a').evaluateAll((els) =>
    els
      .map((el) => ({
        tag: el.tagName,
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        href: el.getAttribute('href') ?? '',
        testid: el.getAttribute('data-testid') ?? '',
      }))
      .filter((x) => /contact|mensaje|message|anfitri/i.test(`${x.text} ${x.href} ${x.testid}`))
      .slice(0, 15),
  )
  console.log('Contact-related UI:', JSON.stringify(contactButtons, null, 2))

  console.log('\n=== contact_host flow ===')
  await page.goto(`${base}/contact_host/${LISTING_ID}/send_message`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await dismissBlockingOverlays(page)
  await page.waitForTimeout(3_000)
  console.log('Contact URL:', page.url())
  const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1500)
  console.log('Body snippet:', bodyText)

  const hostFromJson = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script')]
    for (const s of scripts) {
      const t = s.textContent ?? ''
      const m = t.match(/"userId"\s*:\s*"(\d+)"/) ?? t.match(/"hostId"\s*:\s*"(\d+)"/)
      if (m) return m[1]
    }
    return null
  })
  console.log('Host ID from page JSON:', hostFromJson)

  await browser.close()
  await db.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
