import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { chromium, type Response } from 'playwright'
import {
  getAirbnbBaseUrl,
  getChromeChannelOption,
  getColombiaContextOptions,
} from '../src/scraping/airbnb-context'
import { dismissBlockingOverlays } from '../src/scraping/airbnb-scraper'
import {
  collectInboxThreads,
  scrollInboxDown,
  scrollInboxUntilStable,
} from '../src/messaging/airbnb-inbox'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const ACCOUNT_ID = process.argv[2]?.trim() ?? 'a23d0b7c-3998-406a-a7b5-0445760f6ef3'
const AUTH = path.resolve(__dirname, `../playwright/.auth/account-${ACCOUNT_ID}.json`)

function walk(value: unknown, visit: (obj: Record<string, unknown>) => void): void {
  const queue: unknown[] = [value]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }
    const record = current as Record<string, unknown>
    visit(record)
    queue.push(...Object.values(record))
  }
}

function extractThreadIdsFromPayload(payload: unknown): string[] {
  const ids = new Set<string>()
  walk(payload, (record) => {
    for (const key of ['threadId', 'messageThreadId', 'id']) {
      const value = record[key]
      if (typeof value === 'string' && /^\d{8,}$/.test(value)) {
        ids.add(value)
      }
      if (typeof value === 'number' && value > 10_000_000) {
        ids.add(String(value))
      }
    }
    if (record.__typename === 'MessageThread' && typeof record.id === 'string') {
      ids.add(record.id)
    }
  })
  return [...ids]
}

async function main() {
  if (!fs.existsSync(AUTH)) {
    console.error(`Session not found: ${AUTH}`)
    process.exit(1)
  }

  const browser = await chromium.launch({ headless: true, ...getChromeChannelOption() })
  const page = await (
    await browser.newContext({ storageState: AUTH, ...getColombiaContextOptions() })
  ).newPage()

  const apiThreadIds = new Set<string>()
  const apiUrls: string[] = []

  page.on('response', async (response: Response) => {
    const url = response.url()
    if (!/(graphql|Messages|Inbox|Thread|messaging)/i.test(url)) return
    if (response.status() !== 200) return
    try {
      const json = await response.json()
      const ids = extractThreadIdsFromPayload(json)
      if (ids.length > 0) {
        apiUrls.push(`${url.split('?')[0]} (+${ids.length} ids)`)
        for (const id of ids) apiThreadIds.add(id)
      }
    } catch {
      // ignore
    }
  })

  const base = getAirbnbBaseUrl()
  await page.goto(`${base}/guest/messages`, { waitUntil: 'domcontentloaded' })
  await dismissBlockingOverlays(page)
  await page.waitForTimeout(2_000)

  const scrollMeta = await page.evaluate(() => {
    const marker = document.querySelector('[data-testid="inbox-container-marker"]')
    const items = document.querySelectorAll('[data-testid^="inbox_list_"]')
    const scrollables: Array<{ tag: string; testid: string | null; oy: string; sh: number; ch: number; st: number }> = []

    let probe: Element | null = marker ?? items[items.length - 1] ?? null
    while (probe) {
      if (probe instanceof HTMLElement) {
        const oy = window.getComputedStyle(probe).overflowY
        if (/(auto|scroll|overlay)/.test(oy) && probe.scrollHeight > probe.clientHeight + 4) {
          scrollables.push({
            tag: probe.tagName,
            testid: probe.getAttribute('data-testid'),
            oy,
            sh: probe.scrollHeight,
            ch: probe.clientHeight,
            st: probe.scrollTop,
          })
        }
      }
      probe = probe.parentElement
    }

    return {
      url: location.href,
      itemCount: items.length,
      scrollables,
    }
  })

  console.log('Initial DOM meta:', JSON.stringify(scrollMeta, null, 2))
  console.log('Initial API thread ids:', apiThreadIds.size)

  const collected = await scrollInboxUntilStable(page, {
    maxStableRounds: 12,
    maxAttempts: 200,
    pauseMs: 600,
  })

  const domCount = collected.size
  const afterScrollDom = await page.locator('[data-testid^="inbox_list_"]').count()

  const scrollState = await page.evaluate(() => {
    const marker = document.querySelector('[data-testid="inbox-container-marker"]')
    let probe: Element | null = marker
    let best: HTMLElement | null = null
    while (probe) {
      if (probe instanceof HTMLElement) {
        const oy = window.getComputedStyle(probe).overflowY
        if (/(auto|scroll|overlay)/.test(oy) && probe.scrollHeight > probe.clientHeight + 4) {
          best = probe
          break
        }
      }
      probe = probe.parentElement
    }
    if (!best) return null
    return {
      scrollTop: best.scrollTop,
      scrollHeight: best.scrollHeight,
      clientHeight: best.clientHeight,
      atBottom: best.scrollTop + best.clientHeight >= best.scrollHeight - 8,
    }
  })

  console.log('After scroll collected map:', domCount)
  console.log('After scroll visible DOM items:', afterScrollDom)
  console.log('Scroll container state:', scrollState)
  console.log('API thread ids total:', apiThreadIds.size)
  console.log('Unique API urls with ids:', [...new Set(apiUrls)].slice(0, 20))

  const threads = await collectInboxThreads(page, 500)
  console.log('collectInboxThreads returned:', threads.length)

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
