import type { Page } from 'playwright'
import type { Lead } from '@repo/db'
import { BlockType } from '@repo/db'
import { outboundLog } from '../logging/outbound-logger'
import { dismissBlockingOverlays } from '../scraping/airbnb-scraper'
import { getAirbnbBaseUrl } from '../scraping/airbnb-context'
import { syncExistingColdThread } from './existing-thread-sync'
import { extractThreadUrl } from './thread-detection'
import { collectInboxThreads } from './airbnb-inbox'
import {
  clickThreadSendButton,
  findMessageComposer,
  openThreadForMessaging,
  typeInComposer,
  waitForThreadComposer,
} from './thread-compose'
import { getActionTimeoutMs } from '../scraping/page-timing'

/** Delay solo para fallback de tipeo; el path principal usa insertText/fill. */
const TYPE_DELAY_MS = 12
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

  if (
    /captcha|robot|unusual traffic|comprueba que no eres un robot|verificaci[oó]n de seguridad|security verification|recargar desaf[ií]o|funcaptcha|arkose/i.test(
      lower,
    )
  ) {
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
  /** Listing ID esperado (rooms/X → contact_host/X). Si diverge, se loguea mismatch. */
  expectedListingId?: string
  prospectAccountId?: string
}

const COMPOSER_SELECTOR =
  'textarea[aria-label*="mensaje"], textarea[aria-label*="message"], textarea[data-testid="message-input"], textarea[placeholder*="mensaje"], textarea[placeholder*="message"], [data-testid="thread-message-input"] textarea, form textarea, [data-testid="messaging-compose-bar"] [contenteditable="true"], [contenteditable="true"][role="textbox"]'

/** Sonda rápida: ¿el anuncio expone un compositor de mensaje? */
const COMPOSER_PROBE_MS = 8_000

async function findContactComposer(page: Page) {
  const composer = await findMessageComposer(page)
  if (composer) return composer

  const contactOnly = page.locator(`${COMPOSER_SELECTOR}, textarea`).first()
  if (await contactOnly.isVisible({ timeout: 5_000 }).catch(() => false)) {
    return contactOnly
  }

  return page.locator('textarea').first()
}

/**
 * Comprueba en un tiempo corto si la página de contacto tiene un compositor
 * (o botón de envío). Evita esperar los 15s de cada `waitFor` en anuncios no
 * contactables (retirados, solo-reserva, layout sin mensajería).
 */
async function hasContactComposer(page: Page, timeoutMs = COMPOSER_PROBE_MS): Promise<boolean> {
  const composer = page.locator(`${COMPOSER_SELECTOR}, textarea`).first()
  if (await composer.isVisible({ timeout: timeoutMs }).catch(() => false)) {
    return true
  }

  const sendButton = page
    .getByRole('button', { name: /^enviar mensaje$|^send message$|^enviar$|^send$/i })
    .or(page.locator('[data-testid="message-send-button"]'))
    .first()
  return sendButton.isVisible({ timeout: 1_500 }).catch(() => false)
}

async function clickSendButton(page: Page): Promise<void> {
  const sendButton = page
    .getByRole('button', { name: /^enviar mensaje$|^send message$|^enviar$|^send$/i })
    .or(page.locator('[data-testid="message-send-button"]'))
    .first()

  await sendButton.waitFor({ state: 'visible', timeout: 15_000 })
  await sendButton.click({ timeout: 10_000 })
}

async function typeMessageHuman(page: Page, text: string, options: { thread?: boolean } = {}): Promise<void> {
  const composer = options.thread
    ? await waitForThreadComposer(page)
    : await findContactComposer(page)
  await composer.waitFor({ state: 'visible', timeout: getActionTimeoutMs() })
  await typeInComposer(composer, page, text, TYPE_DELAY_MS)
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

function buildContactHostUrl(listingUrl: string): string | null {
  const listingMatch = listingUrl.match(/\/rooms\/(\d+)/)
  if (!listingMatch) return null
  return `${getAirbnbBaseUrl()}/contact_host/${listingMatch[1]}/send_message`
}

async function openContactFromListing(page: Page, listingUrl: string): Promise<string> {
  const contactUrl = buildContactHostUrl(listingUrl) ?? buildContactHostUrl(page.url())
  if (contactUrl) {
    await page.goto(contactUrl, { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)
    await page.waitForTimeout(1_500)
    return contactUrl
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
  return page.url()
}

/**
 * Garantiza que seguimos en el formulario de contacto del listing.
 * Nunca abrir el inbox aquí: roba el tab y el cold send termina tipando
 * en un chat viejo (o esperando un textarea que no es el del host).
 */
async function ensureOnContactHostPage(page: Page, contactUrl: string): Promise<void> {
  if (/\/contact_host\/\d+/.test(page.url())) return

  outboundLog('outbound.send.recover_contact_page', {
    fromUrl: page.url(),
    contactUrl,
  })
  await page.goto(contactUrl, { waitUntil: 'domcontentloaded' })
  await dismissBlockingOverlays(page)
  await page.waitForTimeout(1_500)
}

function listingIdFromUrl(url: string): string | null {
  return url.match(/\/rooms\/(\d+)/)?.[1] ?? url.match(/\/contact_host\/(\d+)/)?.[1] ?? null
}

export async function sendColdOutboundMessage(
  page: Page,
  lead: Lead,
  text: string,
  options: ColdSendOptions = {},
): Promise<SendOutboundResult> {
  const expectedListingId =
    options.expectedListingId ?? listingIdFromUrl(lead.primaryListingUrl) ?? undefined

  outboundLog('outbound.send.start', {
    leadId: lead.id,
    phase: 'PHASE_1_COLD',
    listingUrl: lead.primaryListingUrl,
    listingName: lead.primaryListingName,
    hostAirbnbId: lead.hostAirbnbId,
    hostName: lead.name,
    expectedListingId: expectedListingId ?? null,
  })

  try {
    await page.goto(lead.primaryListingUrl, { waitUntil: 'domcontentloaded' })
    await dismissBlockingOverlays(page)
    await page.waitForTimeout(1_500)

    const pageListingId = listingIdFromUrl(page.url())
    const pageTitle = (await page.locator('h1').first().innerText().catch(() => '')).trim()
    outboundLog('outbound.send.listing_page', {
      leadId: lead.id,
      expectedListingId: expectedListingId ?? null,
      pageListingId,
      pageUrl: page.url(),
      pageTitle: pageTitle || null,
      leadListingName: lead.primaryListingName,
      titleMismatch:
        Boolean(pageTitle) &&
        Boolean(lead.primaryListingName) &&
        pageTitle.toLowerCase() !== lead.primaryListingName!.trim().toLowerCase(),
      listingIdMismatch:
        Boolean(expectedListingId) &&
        Boolean(pageListingId) &&
        expectedListingId !== pageListingId,
    })

    if (
      expectedListingId &&
      pageListingId &&
      expectedListingId !== pageListingId
    ) {
      outboundLog('outbound.send.listing_mismatch', {
        stage: 'listing_page',
        leadId: lead.id,
        expectedListingId,
        pageListingId,
        listingUrl: lead.primaryListingUrl,
        pageUrl: page.url(),
      })
    }

    const contactUrl = await openContactFromListing(page, lead.primaryListingUrl)
    const contactListingId = listingIdFromUrl(page.url()) ?? listingIdFromUrl(contactUrl)
    outboundLog('outbound.send.contact_page', {
      leadId: lead.id,
      url: page.url(),
      contactUrl,
      expectedListingId: expectedListingId ?? null,
      contactListingId,
      listingIdMismatch:
        Boolean(expectedListingId) &&
        Boolean(contactListingId) &&
        expectedListingId !== contactListingId,
    })

    if (
      expectedListingId &&
      contactListingId &&
      expectedListingId !== contactListingId
    ) {
      outboundLog('outbound.send.listing_mismatch', {
        stage: 'contact_page',
        leadId: lead.id,
        expectedListingId,
        contactListingId,
        contactUrl,
        pageUrl: page.url(),
      })
      return { success: false, error: 'listing_id_mismatch' }
    }

    // Airbnb redirige contact_host → /guest/messages/{id} si ya existe hilo.
    // NO escanear el inbox proactivamente: collectInboxThreads() navega allí y
    // deja la página en un chat viejo (p. ej. David/Esteban), rompiendo el envío.
    const redirectedThread = extractThreadUrlFromPage(page.url())
    if (redirectedThread) {
      outboundLog('outbound.presend.existing_thread', {
        leadId: lead.id,
        threadId: redirectedThread,
        source: 'contact_host_redirect',
      })
      await syncExistingColdThread(page, lead, redirectedThread, options.prospectAccountId)
      return {
        success: false,
        error: 'existing_thread',
        threadId: redirectedThread,
        skippedReason: 'existing_thread',
      }
    }

    await ensureOnContactHostPage(page, contactUrl)
    await page.mouse.wheel(0, 800)
    await page.waitForTimeout(1_000)

    // Fallar rápido si el anuncio no es contactable, en vez de agotar los 15s
    // de cada locator de envío. Un blocker (rate limit/identidad) tiene
    // prioridad y se propaga como AirbnbSendBlockedError.
    if (!(await hasContactComposer(page))) {
      await assertSendNotBlocked(page)
      outboundLog('outbound.send.not_contactable', {
        leadId: lead.id,
        listingUrl: lead.primaryListingUrl,
        url: page.url(),
      })
      return { success: false, error: 'listing_not_contactable' }
    }

    // Última salvaguarda: si el compositor está en /guest/messages, es el inbox
    // equivocado — no escribir ahí.
    if (/\/guest\/messages\//.test(page.url())) {
      outboundLog('outbound.send.refusing_inbox_composer', {
        leadId: lead.id,
        url: page.url(),
      })
      await ensureOnContactHostPage(page, contactUrl)
      if (!(await hasContactComposer(page)) || /\/guest\/messages\//.test(page.url())) {
        return { success: false, error: 'listing_not_contactable' }
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

    // Airbnb a veces deja la confirmación "Mensaje enviado" en contact_host
    // sin redirigir aún a /guest/messages/{id}.
    const confirmedOnContact = await page
      .getByRole('heading', { name: /mensaje enviado|message sent/i })
      .or(page.getByText(/mensaje enviado|message sent/i))
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false)

    if (confirmedOnContact) {
      outboundLog('outbound.send.confirmation_seen', {
        leadId: lead.id,
        url: page.url(),
      })
      const doneBtn = page.getByRole('button', { name: /^listo$|^done$/i }).first()
      if (await doneBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await doneBtn.click().catch(() => {})
        await page.waitForTimeout(1_000)
      }
    }

    let threadId = await waitForThreadUrl(page, confirmedOnContact ? 5_000 : 10_000)

    if (!threadId) {
      threadId = await resolveThreadFromInboxAfterSend(page, lead)
    }

    if (!threadId) {
      return {
        success: false,
        error: 'Could not capture thread URL after cold send',
      }
    }

    outboundLog('outbound.send.success', {
      leadId: lead.id,
      threadId,
      confirmationSeen: confirmedOnContact,
    })
    return { success: true, threadId }
  } catch (error) {
    if (error instanceof AirbnbSendBlockedError) throw error
    const message = error instanceof Error ? error.message : String(error)
    outboundLog('outbound.send.failed', {
      leadId: lead.id,
      error: message,
      url: page.url(),
    })
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
    await openThreadForMessaging(page, lead.threadId)
    await typeMessageHuman(page, text, { thread: true })
    // Confirmar que el compositor tiene texto antes de pulsar enviar (botón flecha).
    const composer = await findMessageComposer(page)
    const typed = composer
      ? ((await composer.innerText().catch(() => '')) || '').trim()
      : ''
    if (typed.length < 20) {
      throw new Error(`Composer vacío tras tipeo (len=${typed.length}); no se envía.`)
    }
    await clickThreadSendButton(page)
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
