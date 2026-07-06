import type { Page, Response } from 'playwright'
import { LeadStatus, type Lead } from '@repo/db'
import { inboundLog } from '../logging/inbound-logger'
import {
  applyInboundDetected,
  OUTBOUND_ACTIVE_STATUSES,
  type ScrapedThreadMessage,
  syncThreadMessages,
  updateLastContactedIfInbound,
} from '../persistence/inbound-pipeline'
import { runConversationTurn } from '../conversation/run-conversation-turn'
import { getAirbnbBaseUrl } from '../scraping/airbnb-context'
import { dismissBlockingOverlays } from '../scraping/airbnb-scraper'

export type InboxThreadRef = {
  url: string
  threadId: string
  hostName: string
  rawText: string
}

/** Extrae threadId desde data-testid="inbox_list_{id}". */
export function parseInboxListThreadId(testId: string): string | null {
  const match = testId.match(/^inbox_list_(\d+)$/)
  return match?.[1] ?? null
}

async function collectVisibleInboxListItems(
  page: Page,
): Promise<Array<{ testid: string; text: string }>> {
  return page.locator('[data-testid^="inbox_list_"]').evaluateAll((els) =>
    els.map((el) => ({
      testid: el.getAttribute('data-testid') ?? '',
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' '),
    })),
  )
}

/** Desplaza el panel del inbox (lista virtual) para cargar más conversaciones. */
export async function scrollInboxDown(page: Page): Promise<void> {
  const items = page.locator('[data-testid^="inbox_list_"]')
  const count = await items.count()
  if (count > 0) {
    await items.nth(count - 1).scrollIntoViewIfNeeded()
  }

  await page.evaluate(() => {
    const items = document.querySelectorAll('[data-testid^="inbox_list_"]')
    const last = items[items.length - 1] as HTMLElement | undefined
    if (last) {
      last.scrollIntoView({ block: 'end' })
    }

    let scrollRoot: HTMLElement | null = null
    let probe: Element | null = last ?? document.querySelector('[data-testid="inbox-container-marker"]')

    while (probe) {
      if (probe instanceof HTMLElement) {
        const overflowY = window.getComputedStyle(probe).overflowY
        if (/(auto|scroll|overlay)/.test(overflowY) && probe.scrollHeight > probe.clientHeight + 4) {
          scrollRoot = probe
          break
        }
      }
      probe = probe.parentElement
    }

    if (scrollRoot) {
      scrollRoot.scrollTop += Math.max(400, scrollRoot.clientHeight * 0.85)
    } else {
      window.scrollBy(0, 900)
    }
  })

  if (count > 0) {
    await items.nth(count - 1).press('PageDown').catch(() => {})
  }
}

type InboxScrollOptions = {
  maxStableRounds?: number
  maxAttempts?: number
  pauseMs?: number
}

/**
 * Recorre el inbox con scroll infinito y acumula threads únicos.
 * Airbnb virtualiza la lista: hay que ir bajando y guardar IDs en un Map.
 */
export async function scrollInboxUntilStable(
  page: Page,
  options: InboxScrollOptions = {},
): Promise<Map<string, { testid: string; text: string }>> {
  const maxStableRounds = options.maxStableRounds ?? 8
  const maxAttempts = options.maxAttempts ?? 150
  const pauseMs = options.pauseMs ?? 450

  const seen = new Map<string, { testid: string; text: string }>()
  let stableRounds = 0
  let lastSize = 0

  for (let attempt = 0; attempt < maxAttempts && stableRounds < maxStableRounds; attempt++) {
    const batch = await collectVisibleInboxListItems(page)
    for (const item of batch) {
      const threadId = parseInboxListThreadId(item.testid)
      if (threadId) {
        seen.set(threadId, item)
      }
    }

    if (seen.size === lastSize) {
      stableRounds += 1
    } else {
      stableRounds = 0
      lastSize = seen.size
    }

    await scrollInboxDown(page)
    await page.waitForTimeout(pauseMs)
  }

  return seen
}

/** Extrae nombre del host desde el preview del inbox ("Conversación con Roció. ..."). */
export function deriveHostNameFromInboxPreview(rawText: string): string {
  const normalized = rawText.trim().replace(/\s+/g, ' ')
  const convMatch = normalized.match(/conversaci[oó]n con (.+?)\./i)
  if (convMatch?.[1]) {
    return convMatch[1].trim().slice(0, 60)
  }
  const firstLine = normalized.split(/[·|•]/)[0]?.trim() ?? normalized
  return firstLine.slice(0, 40).trim() || 'Host desconocido'
}

/**
 * Lista conversaciones del inbox. Airbnb SPA usa data-testid="inbox_list_{threadId}"
 * con href="#" (no anchors /guest/messages/{id} en el listado).
 */
export async function collectInboxThreads(
  page: Page,
  maxThreads: number,
): Promise<InboxThreadRef[]> {
  const base = getAirbnbBaseUrl()
  await page.goto(`${base}/guest/messages`, { waitUntil: 'domcontentloaded' })
  await dismissBlockingOverlays(page)

  await page
    .locator('[data-testid^="inbox_list_"], [data-testid="inbox-container-marker"]')
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
    .catch(() => {})

  await page.waitForTimeout(2_000)

  if (/\/login/.test(page.url())) {
    throw new Error('Inbox redirige a /login: sesión no autenticada.')
  }

  const scrollOptions = {
    maxStableRounds: Number.parseInt(process.env.INBOX_SCROLL_STABLE_ROUNDS ?? '8', 10),
    maxAttempts: Number.parseInt(process.env.INBOX_SCROLL_MAX_ATTEMPTS ?? '150', 10),
    pauseMs: Number.parseInt(process.env.INBOX_SCROLL_PAUSE_MS ?? '450', 10),
  }

  const collected = await scrollInboxUntilStable(page, scrollOptions)
  const threads: InboxThreadRef[] = []

  for (const [threadId, { text }] of collected) {
    threads.push({
      threadId,
      url: `${base}/guest/messages/${threadId}`,
      hostName: deriveHostNameFromInboxPreview(text),
      rawText: text,
    })

    if (threads.length >= maxThreads) break
  }

  // Fallback legacy: anchors con href real (UI antigua).
  if (threads.length === 0) {
    const legacy = await page.locator('a[href*="/guest/messages/"]').evaluateAll((els) =>
      els.map((el) => ({
        href: el.getAttribute('href') ?? '',
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' '),
      })),
    )

    const seen = new Set<string>()
    for (const { href, text } of legacy) {
      if (!href || !/\/guest\/messages\/[^/?#]+/.test(href)) continue
      const url = href.startsWith('http')
        ? href.split(/[?#]/)[0]!
        : `${base}${href.split(/[?#]/)[0]}`
      const threadId = url.split('/').pop() ?? url
      if (seen.has(threadId)) continue
      seen.add(threadId)
      threads.push({
        threadId,
        url,
        hostName: deriveHostNameFromInboxPreview(text),
        rawText: text,
      })
      if (threads.length >= maxThreads) break
    }
  }

  return threads
}

const SELF_MARKERS = /^(tú|tu|you|me|yo)\b/i

export function classifyMessageDirection(
  text: string,
  hostName: string,
): 'INBOUND' | 'OUTBOUND' {
  const normalized = text.trim()
  const firstLine = normalized.split('\n')[0]?.trim() ?? ''

  if (SELF_MARKERS.test(firstLine)) {
    return 'OUTBOUND'
  }

  const hostFirstName = hostName.split(' ')[0]?.toLowerCase()
  if (hostFirstName && firstLine.toLowerCase().startsWith(hostFirstName)) {
    return 'INBOUND'
  }

  if (/^(tú|you):/i.test(normalized)) {
    return 'OUTBOUND'
  }

  if (new RegExp(`^${escapeRegex(hostFirstName)}`, 'i').test(firstLine)) {
    return 'INBOUND'
  }

  // Default: assume host message if no self marker
  return 'INBOUND'
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectMessagesFromPayload(
  payload: unknown,
  hostName: string,
  out: ScrapedThreadMessage[],
  limit: number,
): void {
  if (out.length >= limit) return
  const queue: unknown[] = [payload]

  while (queue.length > 0 && out.length < limit) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    const record = current as Record<string, unknown>

    const body =
      (typeof record.body === 'string' && record.body) ||
      (typeof record.messageBody === 'string' && record.messageBody) ||
      (typeof record.content === 'string' && record.content) ||
      (typeof record.text === 'string' && record.text)

    if (body && body.trim().length > 2) {
      const isSelf =
        record.isSelf === true ||
        record.isOwnMessage === true ||
        record.role === 'SENDER' ||
        record.authorRole === 'GUEST'

      out.push({
        direction: isSelf ? 'OUTBOUND' : classifyMessageDirection(body, hostName),
        content: body.trim(),
      })
    }

    queue.push(...Object.values(record))
  }
}

export async function scrapeThreadMessages(
  page: Page,
  lead: Lead,
): Promise<ScrapedThreadMessage[]> {
  const maxMessages = Number.parseInt(
    process.env.INBOUND_MAX_MESSAGES_PER_THREAD ?? '30',
    10,
  )

  const fromApi: ScrapedThreadMessage[] = []

  const onResponse = async (response: Response) => {
    const url = response.url()
    if (!/(Messages|Thread|Inbox|graphql)/i.test(url)) return
    if (response.status() !== 200) return

    try {
      const json = await response.json()
      collectMessagesFromPayload(json, lead.name, fromApi, maxMessages)
    } catch {
      // Non-JSON
    }
  }

  page.on('response', onResponse)

  try {
    await page.goto(lead.threadId!, { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)
    await page.waitForTimeout(1_500)

    const messageNodes = page.locator(
      '[data-testid="message"], [data-testid="thread-message"], [data-testid="msg-content"], [class*="message"]',
    )

    await page.mouse.wheel(0, 800)
    await page.waitForTimeout(800)

    const count = await messageNodes.count()
    const domMessages: ScrapedThreadMessage[] = []

    for (let i = 0; i < count && domMessages.length < maxMessages; i++) {
      const node = messageNodes.nth(i)
      const text = (await node.innerText().catch(() => '')).trim()
      if (!text || text.length < 2) continue

      domMessages.push({
        direction: classifyMessageDirection(text, lead.name),
        content: text,
      })
    }

    if (domMessages.length > 0) {
      return domMessages.slice(-maxMessages)
    }

    if (fromApi.length > 0) {
      return fromApi.slice(-maxMessages)
    }

    const fallbackNodes = page.locator('main li, [role="listitem"]')
    const fallbackCount = await fallbackNodes.count()

    for (let i = 0; i < fallbackCount && domMessages.length < maxMessages; i++) {
      const text = (await fallbackNodes.nth(i).innerText().catch(() => '')).trim()
      if (!text || text.length < 5) continue
      domMessages.push({
        direction: classifyMessageDirection(text, lead.name),
        content: text,
      })
    }

    return domMessages.slice(-maxMessages)
  } finally {
    page.off('response', onResponse)
  }
}

export type PollLeadResult = {
  success: boolean
  inboundNew: number
  outboundSynced: number
  replied: boolean
  error?: string
}

export async function pollLeadThread(page: Page, lead: Lead): Promise<PollLeadResult> {
  inboundLog('inbound.poll.start', { leadId: lead.id, threadId: lead.threadId })

  try {
    const scraped = await scrapeThreadMessages(page, lead)
    const syncResult = await syncThreadMessages(lead.id, scraped)

    inboundLog('inbound.sync.complete', {
      leadId: lead.id,
      inboundNew: syncResult.inboundNew,
      outboundSynced: syncResult.outboundSynced,
    })

    let replied = false

    if (syncResult.hostReplied) {
      const detectedAt = new Date()

      if (OUTBOUND_ACTIVE_STATUSES.includes(lead.status)) {
        await applyInboundDetected(lead.id, detectedAt)
        replied = true
        inboundLog('inbound.lead.replied', {
          leadId: lead.id,
          name: lead.name,
          previousStatus: lead.status,
        })
        // 2.4 — Primer reply: clasifica (Triaje) y responde (Negociador).
        await runConversationTurn(page, lead.id)
      } else if (lead.status === LeadStatus.REPLIED_IN_PROGRESS) {
        await updateLastContactedIfInbound(lead.id, detectedAt)
        inboundLog('inbound.message.new', { leadId: lead.id, count: syncResult.inboundNew })
        // 2.4 — Multi-turno: el host volvió a escribir mientras la IA tiene el control.
        if (syncResult.inboundNew > 0) {
          await runConversationTurn(page, lead.id)
        }
      }
    }

    if (syncResult.inboundNew > 0) {
      inboundLog('inbound.message.new', {
        leadId: lead.id,
        inboundNew: syncResult.inboundNew,
      })
    }

    return {
      success: true,
      inboundNew: syncResult.inboundNew,
      outboundSynced: syncResult.outboundSynced,
      replied,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    inboundLog('inbound.error', { leadId: lead.id, error: message })
    return {
      success: false,
      inboundNew: 0,
      outboundSynced: 0,
      replied: false,
      error: message,
    }
  }
}
