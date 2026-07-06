import type { Page } from 'playwright'
import type { Lead } from '@repo/db'
import { BlockType } from '@repo/db'
import { outboundLog } from '../logging/outbound-logger'
import { dismissBlockingOverlays } from '../scraping/airbnb-scraper'
import { getAirbnbBaseUrl } from '../scraping/airbnb-context'
import { syncExistingColdThread } from './existing-thread-sync'
import { extractThreadUrl, findExistingThreadForLead } from './thread-detection'
import { collectInboxThreads } from './airbnb-inbox'

const TYPE_DELAY_MS = 45
const MESSAGES_BASE_PATH = '/guest/messages'

export class AirbnbSendBlockedError extends Error {
  readonly blockType: BlockType

  constructor(message: string, blockType: BlockType) {
    super(message)
    this.name = 'AirbnbSendBlockedError'
    this.blockType = blockType
  }
}

export function classifyBlockType(message: string): BlockType {
  const lower = message.toLowerCase()

  if (
    /rate limit|demasiados mensajes|already contacted several hosts|wait a few hours|ya le has escrito a varios anfitriones/i.test(
      lower,
    )
  ) {
    return BlockType.RATE_LIMIT
  }

  if (
    /documento de identidad|identity document|verificaci[oó]n de identidad|verifica tu identidad|verify your identity/i.test(
      lower,
    )
  ) {
    return BlockType.IDENTITY
  }

  if (/captcha|robot|unusual traffic|comprueba que no eres un robot/i.test(lower)) {
    return BlockType.CAPTCHA
  }

  return BlockType.OTHER
}

/** Airbnb blocks sends with identity verification or daily host-contact limits. */
export async function detectSendBlocker(page: Page): Promise<string | null> {
  const rateLimit = page.getByText(
    /ya le has escrito a varios anfitriones|already contacted several hosts|wait a few hours before sending/i,
  )
  if (await rateLimit.isVisible({ timeout: 1_500 }).catch(() => false)) {
    return 'Airbnb rate limit: demasiados mensajes a anfitriones hoy. Espera unas horas e intenta de nuevo.'
  }

  const identity = page.getByText(
    /documento de identidad|identity document|verifica tu identidad|verify your identity/i,
  )
  if (await identity.isVisible({ timeout: 1_500 }).catch(() => false)) {
    return 'Airbnb requiere verificación de identidad antes de enviar mensajes.'
  }

  return null
}

async function assertSendNotBlocked(page: Page): Promise<void> {
  const blocker = await detectSendBlocker(page)
  if (blocker) {
    throw new AirbnbSendBlockedError(blocker, classifyBlockType(blocker))
  }
}

export type SendOutboundResult = {
  success: boolean
  threadId?: string
  error?: string
  skippedReason?: 'existing_thread'
}

export type ColdSendOptions = {
  prospectAccountId?: string
}

async function findMessageComposer(page: Page) {
  const textarea = page
    .locator(
      'textarea[aria-label*="mensaje"], textarea[aria-label*="message"], textarea[data-testid="message-input"], textarea[placeholder*="mensaje"], textarea[placeholder*="message"], [data-testid="thread-message-input"] textarea, form textarea',
    )
    .first()

  if (await textarea.isVisible({ timeout: 5_000 }).catch(() => false)) {
    return textarea
  }

  return page.locator('textarea').first()
}

async function clickSendButton(page: Page): Promise<void> {
  const sendButton = page
    .getByRole('button', { name: /^enviar mensaje$|^send message$|^enviar$|^send$/i })
    .or(page.locator('[data-testid="message-send-button"]'))
    .first()

  await sendButton.waitFor({ state: 'visible', timeout: 15_000 })
  await sendButton.click({ timeout: 10_000 })
}

async function typeMessageHuman(page: Page, text: string): Promise<void> {
  const composer = await findMessageComposer(page)
  await composer.waitFor({ state: 'visible', timeout: 15_000 })
  await composer.click({ timeout: 5_000 })
  await composer.fill('')
  await composer.pressSequentially(text, { delay: TYPE_DELAY_MS })
}

function extractThreadUrlFromPage(pageUrl: string): string | null {
  return extractThreadUrl(pageUrl)
}

async function selectContactDates(page: Page): Promise<void> {
  const calendarVisible =
    page.url().includes('availability-calendar') ||
    (await page
      .getByText(/selecciona las fechas|select dates/i)
      .isVisible({ timeout: 2_000 })
      .catch(() => false)) ||
    (await page
      .getByRole('button', { name: /^guarda$|^save$/i })
      .isVisible({ timeout: 2_000 })
      .catch(() => false))

  if (!calendarVisible) {
    return
  }

  const dayCells = () =>
    page.locator('[role="gridcell"] button, td[role="button"], [data-testid*="calendar"] button')

  const saveButton = page.getByRole('button', { name: /^guarda$|^save$/i })

  // Snapshot every numeric day cell and whether it is selectable right now.
  // Listings can enforce a minimum stay, so the valid check-out only becomes
  // clear after a check-in is chosen and the calendar re-renders.
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

    if (firstAvailable) {
      await dayCells().nth(firstAvailable.index).click({ timeout: 5_000 })
      await page.waitForTimeout(700)

      // Re-read: minimum-stay rules disable invalid check-outs after check-in.
      const afterCheckIn = await snapshotDays()
      const checkOut = afterCheckIn.find(
        (d) => d.available && d.index > firstAvailable.index,
      )

      if (checkOut) {
        await dayCells().nth(checkOut.index).click({ timeout: 5_000 })
        await page.waitForTimeout(700)

        // A "Guarda" button only appears in the modal/popover variant. In the
        // inline contact form, picking the range applies it directly (the URL
        // gains check_in / check_out params) and the calendar closes.
        if (await saveButton.isVisible({ timeout: 1_500 }).catch(() => false)) {
          await saveButton.click({ timeout: 5_000 })
          await page.waitForTimeout(1_000)
          return
        }

        if (/check_in=.*check_out=/.test(page.url())) {
          return
        }
      }
    }

    const nextMonth = page
      .getByRole('button', { name: /flecha de la derecha|next month|mes siguiente/i })
      .first()
    if (!(await nextMonth.isVisible({ timeout: 2_000 }).catch(() => false))) break
    await nextMonth.click({ timeout: 5_000 })
    await page.waitForTimeout(800)
  }

  throw new Error('Could not select available dates for contact message')
}

async function resolveThreadFromInboxAfterSend(page: Page, lead: Lead): Promise<string | null> {
  const threads = await collectInboxThreads(page, 50)
  const hostFirst = lead.name.split(' ')[0]?.toLowerCase() ?? ''
  const snippet = lead.primaryListingName?.slice(0, 24).toLowerCase() ?? ''

  for (const thread of threads) {
    const nameLower = thread.hostName.toLowerCase()
    if (hostFirst && nameLower.includes(hostFirst)) return thread.url
    if (snippet && thread.rawText.toLowerCase().includes(snippet)) return thread.url
  }

  return threads[0]?.url ?? null
}

async function waitForThreadUrl(page: Page, timeoutMs = 15_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const url = extractThreadUrlFromPage(page.url())
    if (url) return url
    await page.waitForTimeout(500)
  }

  return extractThreadUrlFromPage(page.url())
}

async function openContactFromListing(page: Page): Promise<void> {
  const listingMatch = page.url().match(/\/rooms\/(\d+)/)
  if (listingMatch) {
    const base = getAirbnbBaseUrl()
    await page.goto(`${base}/contact_host/${listingMatch[1]}/send_message`, {
      waitUntil: 'domcontentloaded',
    })
    await dismissBlockingOverlays(page)
    await page.waitForTimeout(1_500)
    return
  }

  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(800)

  const contactLink = page
    .locator('a[href*="/contact_host/"]')
    .or(
      page.getByRole('link', {
        name: /mensajea con el anfitrión|message the host|contactar al anfitrión|contact host|enviar mensaje/i,
      }),
    )
    .first()

  await contactLink.scrollIntoViewIfNeeded()
  await contactLink.click({ timeout: 10_000 })
  await page.waitForTimeout(1_500)
}

export async function sendColdOutboundMessage(
  page: Page,
  lead: Lead,
  text: string,
  options: ColdSendOptions = {},
): Promise<SendOutboundResult> {
  outboundLog('outbound.send.start', {
    leadId: lead.id,
    phase: 'PHASE_1_COLD',
    listingUrl: lead.primaryListingUrl,
  })

  try {
    await page.goto(lead.primaryListingUrl, { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)
    await page.waitForTimeout(1_500)
    await openContactFromListing(page)
    await page.mouse.wheel(0, 800)
    await page.waitForTimeout(1_500)

    let existingThread =
      extractThreadUrlFromPage(page.url()) ?? (await findExistingThreadForLead(page, lead))

    if (existingThread) {
      outboundLog('outbound.presend.existing_thread', {
        leadId: lead.id,
        threadId: existingThread,
      })
      await syncExistingColdThread(page, lead, existingThread, options.prospectAccountId)
      return {
        success: false,
        error: 'existing_thread',
        threadId: existingThread,
        skippedReason: 'existing_thread',
      }
    }

    await typeMessageHuman(page, text)
    await clickSendButton(page)
    await page.waitForTimeout(2_000)
    await assertSendNotBlocked(page)
    await selectContactDates(page)
    await page.waitForTimeout(1_000)
    await clickSendButton(page)
    await page.waitForTimeout(2_000)
    await assertSendNotBlocked(page)
    await page.waitForTimeout(1_000)

    let threadId = await waitForThreadUrl(page, 10_000)

    if (!threadId) {
      threadId = await resolveThreadFromInboxAfterSend(page, lead)
    }

    if (!threadId) {
      return {
        success: false,
        error: 'Could not capture thread URL after cold send',
      }
    }

    outboundLog('outbound.send.success', { leadId: lead.id, threadId })
    return { success: true, threadId }
  } catch (error) {
    if (error instanceof AirbnbSendBlockedError) throw error
    const message = error instanceof Error ? error.message : String(error)
    outboundLog('outbound.send.failed', { leadId: lead.id, error: message })
    return { success: false, error: message }
  }
}

export async function sendThreadOutboundMessage(
  page: Page,
  lead: Lead,
  text: string,
  phase: string,
): Promise<SendOutboundResult> {
  if (!lead.threadId) {
    return { success: false, error: 'Missing threadId for follow-up' }
  }

  outboundLog('outbound.send.start', {
    leadId: lead.id,
    phase,
    threadId: lead.threadId,
  })

  try {
    await page.goto(lead.threadId, { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)
    await page.waitForTimeout(1_500)
    await typeMessageHuman(page, text)
    await clickSendButton(page)
    await page.waitForTimeout(2_000)
    await assertSendNotBlocked(page)

    const threadId = extractThreadUrlFromPage(page.url()) ?? lead.threadId
    outboundLog('outbound.send.success', { leadId: lead.id, threadId })
    return { success: true, threadId }
  } catch (error) {
    if (error instanceof AirbnbSendBlockedError) throw error
    const message = error instanceof Error ? error.message : String(error)
    outboundLog('outbound.send.failed', { leadId: lead.id, error: message })
    return { success: false, error: message }
  }
}

export async function sendOutboundMessage(
  page: Page,
  lead: Lead,
  text: string,
  isCold: boolean,
  phase: string,
  options: ColdSendOptions = {},
): Promise<SendOutboundResult> {
  if (isCold) {
    return sendColdOutboundMessage(page, lead, text, options)
  }
  return sendThreadOutboundMessage(page, lead, text, phase)
}
