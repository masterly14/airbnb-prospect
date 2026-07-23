import type { Locator, Page } from 'playwright'
import { getAirbnbBaseUrl } from '../scraping/airbnb-context'
import { dismissBlockingOverlays } from '../scraping/airbnb-scraper'
import { getActionTimeoutMs, gotoAndSettle } from '../scraping/page-timing'
import { ensureTravelerInboxFilter } from './inbox-navigation'

const COMPOSER_SELECTORS = [
  '[data-testid="messaging-compose-bar"] [contenteditable="true"]',
  '[data-testid="messaging-compose-bar"] [role="textbox"]',
  '[data-testid="thread-message-input"] [contenteditable="true"]',
  '[data-testid="thread-message-input"] textarea',
  '[contenteditable="true"][role="textbox"]',
  'textarea[aria-label*="mensaje" i]',
  'textarea[aria-label*="message" i]',
  '[data-testid="message-input"]',
] as const

const QUICK_VISIBLE_MS = 200

export function parseThreadIdFromUrl(threadUrl: string): string | null {
  const match = threadUrl.match(/\/guest\/messages\/(\d+)/)
  return match?.[1] ?? null
}

export function normalizeThreadUrl(threadUrl: string): string {
  const threadId = parseThreadIdFromUrl(threadUrl)
  if (!threadId) return threadUrl.split(/[?#]/)[0]!
  return `${getAirbnbBaseUrl()}/guest/messages/${threadId}`
}

async function isComposerVisible(page: Page): Promise<boolean> {
  for (const selector of COMPOSER_SELECTORS) {
    if (await page.locator(selector).first().isVisible({ timeout: QUICK_VISIBLE_MS }).catch(() => false)) {
      return true
    }
  }
  return page
    .getByPlaceholder(/escribe un mensaje|write a message/i)
    .first()
    .isVisible({ timeout: QUICK_VISIBLE_MS })
    .catch(() => false)
}

async function selectThreadInInbox(page: Page, threadId: string): Promise<void> {
  await ensureTravelerInboxFilter(page)
  await page.waitForTimeout(800)

  const threadItem = page.locator(`[data-testid="inbox_list_${threadId}"]`).first()
  if (await threadItem.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await threadItem.click({ timeout: 8_000 })
    await page.waitForTimeout(800)
  }
}

export type OpenThreadOptions = {
  /**
   * Si true (default al enviar), espera/foca el compositor.
   * Para scrape basta cargar el hilo sin tocar el input.
   */
  readyForSend?: boolean
}

/** Abre un hilo. Navegación rápida (sin networkidle). */
export async function openThreadForMessaging(
  page: Page,
  threadUrl: string,
  options: OpenThreadOptions = {},
): Promise<void> {
  const readyForSend = options.readyForSend !== false
  const normalized = normalizeThreadUrl(threadUrl)
  const threadId = parseThreadIdFromUrl(normalized)

  await gotoAndSettle(page, normalized, { settle: 'fast' })
  await dismissBlockingOverlays(page)

  if (/\/login/.test(page.url())) {
    throw new Error('Thread redirige a /login: sesión no autenticada.')
  }

  if (!(await isComposerVisible(page)) && threadId) {
    await selectThreadInInbox(page, threadId)

    if (!(await isComposerVisible(page))) {
      await gotoAndSettle(page, normalized, { settle: 'fast' })
      await dismissBlockingOverlays(page)
    }
  }

  if (readyForSend) {
    await waitForThreadComposer(page)
  }
}

export async function waitForThreadComposer(page: Page): Promise<Locator> {
  const timeout = Math.min(getActionTimeoutMs(), 30_000)
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const composer = await findMessageComposer(page)
    if (composer) return composer

    const placeholder = page.getByPlaceholder(/escribe un mensaje|write a message/i).first()
    if (await placeholder.isVisible({ timeout: QUICK_VISIBLE_MS }).catch(() => false)) {
      await placeholder.click({ timeout: 3_000 }).catch(() => {})
      await page.waitForTimeout(200)
      const afterClick = await findMessageComposer(page)
      if (afterClick) return afterClick
      return placeholder
    }

    await page.waitForTimeout(300)
  }

  throw new Error('Message composer not visible in thread')
}

export async function findMessageComposer(page: Page): Promise<Locator | null> {
  for (const selector of COMPOSER_SELECTORS) {
    const locator = page.locator(selector).first()
    if (await locator.isVisible({ timeout: QUICK_VISIBLE_MS }).catch(() => false)) {
      return locator
    }
  }

  const roleTextbox = page
    .getByRole('textbox', { name: /escribe un mensaje|write a message|mensaje/i })
    .first()
  if (await roleTextbox.isVisible({ timeout: QUICK_VISIBLE_MS }).catch(() => false)) {
    return roleTextbox
  }

  const placeholder = page.getByPlaceholder(/escribe un mensaje|write a message/i).first()
  if (await placeholder.isVisible({ timeout: QUICK_VISIBLE_MS }).catch(() => false)) {
    return placeholder
  }

  return null
}

async function readComposerText(composer: Locator): Promise<string> {
  return composer
    .evaluate((el) => {
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        return el.value
      }
      return ((el as HTMLElement).innerText || el.textContent || '').trim()
    })
    .catch(() => '')
}

async function composerHasText(composer: Locator, text: string): Promise<boolean> {
  const current = (await readComposerText(composer)).replace(/\s+/g, ' ').trim()
  const sample = text.replace(/\s+/g, ' ').trim().slice(0, 40)
  return sample.length > 0 && current.includes(sample)
}

async function withShortTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Escribe en el compositor. Nunca usa fill() largo (se cuelga en Airbnb).
 */
export async function typeInComposer(
  composer: Locator,
  page: Page,
  text: string,
  _delayMs: number,
): Promise<void> {
  await withShortTimeout(composer.click({ timeout: 4_000 }), 5_000)
  await page.waitForTimeout(120)

  const active = (await findMessageComposer(page)) ?? composer
  await withShortTimeout(active.click({ timeout: 3_000 }), 4_000)

  const injected = await active
    .evaluate((el, value) => {
      const target = el as HTMLElement
      target.focus()

      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        const proto =
          target instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        setter?.call(target, value)
        target.dispatchEvent(new Event('input', { bubbles: true }))
        target.dispatchEvent(new Event('change', { bubbles: true }))
        return target.value.length >= Math.min(20, value.length)
      }

      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(target)
      selection?.removeAllRanges()
      selection?.addRange(range)

      let ok = false
      try {
        ok = document.execCommand('insertText', false, value)
      } catch {
        ok = false
      }

      if (!ok || !(target.innerText || target.textContent || '').includes(value.slice(0, 20))) {
        target.textContent = value
        target.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: value,
          }),
        )
      }

      const got = (target.innerText || target.textContent || '').replace(/\s+/g, ' ')
      return got.includes(value.replace(/\s+/g, ' ').slice(0, 20))
    })
    .catch(() => false)

  if (injected && (await composerHasText(active, text))) return

  await page.keyboard.press('Control+A').catch(() => {})
  await page.keyboard.press('Backspace').catch(() => {})
  await withShortTimeout(page.keyboard.insertText(text), 5_000)
  await page.waitForTimeout(200)

  if (await composerHasText(active, text)) return
  if (await composerHasText(composer, text)) return

  const got = (await readComposerText(active)) || (await readComposerText(composer))
  throw new Error(`No se pudo escribir en el compositor del hilo (len=${got.trim().length}).`)
}

export async function clickThreadSendButton(page: Page): Promise<void> {
  const timeout = Math.min(getActionTimeoutMs(), 20_000)
  const deadline = Date.now() + timeout

  const candidates = [
    page.locator('[data-testid="messaging-compose-bar"] button[type="submit"]'),
    page.locator('[data-testid="message-send-button"]'),
    page.locator('[data-testid="messaging-compose-bar"] button[aria-label*="nviar" i]'),
    page.locator('[data-testid="messaging-compose-bar"] button[aria-label*="send" i]'),
    page.locator('[data-testid="messaging-compose-bar"] button:not([disabled])').last(),
    page.getByRole('button', { name: /enviar mensaje|send message|^enviar$|^send$/i }),
  ]

  while (Date.now() < deadline) {
    for (const locator of candidates) {
      const btn = locator.first()
      const visible = await btn.isVisible({ timeout: QUICK_VISIBLE_MS }).catch(() => false)
      if (!visible) continue

      const disabled =
        (await btn.isDisabled().catch(() => false)) ||
        (await btn.getAttribute('aria-disabled').catch(() => null)) === 'true'
      if (disabled) continue

      const clicked = await withShortTimeout(btn.click({ timeout: 5_000 }), 6_000)
      if (clicked !== null) return
    }

    await page.keyboard.press('Enter').catch(() => {})
    await page.waitForTimeout(350)

    const composer = await findMessageComposer(page)
    if (composer) {
      const remaining = (await readComposerText(composer)).trim()
      if (remaining.length < 8) return
    }
  }

  throw new Error('Send button not clickable in thread (composer may be empty or button disabled)')
}
