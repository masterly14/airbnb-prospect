import type { Page, Response } from 'playwright'
import { getAirbnbBaseUrl } from './airbnb-context'

export type ScrapedListing = {
  title: string
  price: string
  url: string
  rating?: string
}

export type ScrapedListingDetail = {
  title: string
  price: string
  url: string
  host?: string
  amenities: string[]
  description?: string
}

export type ScrapingReport = {
  timestamp: string
  destination: string
  steps: {
    homepage: boolean
    search: boolean
    results: boolean
    listingDetail: boolean
  }
  listingsFound: number
  listings: ScrapedListing[]
  listingDetail: ScrapedListingDetail | null
  apiEndpoints: string[]
  blockers: string[]
  viability: 'high' | 'medium' | 'low'
  notes: string[]
}

const PRICING_MODAL_TEXT =
  /incluye todas las tarifas|includes all fees|all fees|precio que verás/i

async function dismissPricingDialog(page: Page): Promise<boolean> {
  const dialog = page
    .getByRole('dialog', { name: PRICING_MODAL_TEXT })
    .or(
      page
        .locator('[data-testid="modal-container"]')
        .filter({ hasText: PRICING_MODAL_TEXT }),
    )
    .first()

  if (!(await dialog.isVisible({ timeout: 1_500 }).catch(() => false))) {
    return false
  }

  const entendido = dialog.getByRole('button', { name: /^entendido$|^got it$/i })
  if (await entendido.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await entendido.click({ timeout: 5_000 })
  } else {
    const closeButton = dialog
      .getByRole('button', { name: /^close$|^cerrar$/i })
      .or(dialog.locator('button[aria-label*="Close"], button[aria-label*="Cerrar"]'))
    if (await closeButton.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
      await closeButton.first().click({ timeout: 5_000 })
    } else {
      return false
    }
  }

  await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  return true
}

async function dismissTranslationDialog(page: Page): Promise<boolean> {
  const dialog = page
    .getByRole('dialog')
    .filter({ hasText: /traducción activada|translation turned on|translation enabled/i })
    .or(page.locator('[data-testid="modal-container"]').filter({ hasText: /traducción activada/i }))
    .first()

  if (!(await dialog.isVisible({ timeout: 1_500 }).catch(() => false))) {
    return false
  }

  const closeButton = dialog
    .getByRole('button', { name: /^close$|^cerrar$/i })
    .or(dialog.locator('button[aria-label*="Close"], button[aria-label*="Cerrar"]'))
    .first()

  if (await closeButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await closeButton.click({ timeout: 5_000 })
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
    return true
  }

  await page.keyboard.press('Escape').catch(() => {})
  return true
}

export async function dismissBlockingOverlays(page: Page) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let dismissed = false

    if (await dismissPricingDialog(page)) {
      dismissed = true
    }

    if (await dismissTranslationDialog(page)) {
      dismissed = true
    }

    const pricingNotice = page.getByText(PRICING_MODAL_TEXT)
    if (!dismissed && (await pricingNotice.isVisible({ timeout: 1_000 }).catch(() => false))) {
      const entendido = page.getByRole('button', { name: /^entendido$|^got it$/i })
      if (await entendido.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await entendido.click({ timeout: 5_000 })
        dismissed = true
      }
    }

    const dismissActions = [
      () => page.getByRole('button', { name: /^entendido$/i }),
      () => page.getByRole('button', { name: /^got it$/i }),
      () => page.getByRole('button', { name: /accept all|aceptar todo|aceptar|accept/i }),
      () =>
        page
          .locator('[data-testid="modal-container"]')
          .getByRole('button', { name: /entendido|got it|aceptar|accept/i }),
      () => page.getByRole('button', { name: /^close$|^cerrar$/i }),
    ]

    if (!dismissed) {
      for (const getLocator of dismissActions) {
        const button = getLocator().first()
        try {
          if (await button.isVisible({ timeout: 1_500 })) {
            await button.click({ timeout: 5_000 })
            dismissed = true
            break
          }
        } catch {
          // Modal may detach while closing.
        }
      }
    }

    const modal = page.locator('[data-testid="modal-container"]')
    const dialog = page.getByRole('dialog').first()
    const blockingVisible =
      (await modal.isVisible({ timeout: 500 }).catch(() => false)) ||
      (await dialog.isVisible({ timeout: 500 }).catch(() => false))

    if (!blockingVisible) {
      return
    }

    if (!dismissed) {
      await page.keyboard.press('Escape').catch(() => {})
    }

    await modal.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {})
    await page.waitForTimeout(500)
  }
}

export async function ensureHomepageReady(page: Page) {
  await page.waitForLoadState('domcontentloaded')

  const deadline = Date.now() + 18_000

  while (Date.now() < deadline) {
    const entendido = page.getByRole('button', { name: /^entendido$|^got it$/i }).first()
    if (await entendido.isVisible({ timeout: 800 }).catch(() => false)) {
      await entendido.click({ timeout: 5_000 })
      await page
        .locator('[data-testid="modal-container"]')
        .waitFor({ state: 'hidden', timeout: 8_000 })
        .catch(() => {})
      continue
    }

    const modal = page.locator('[data-testid="modal-container"]')
    const dialog = page.getByRole('dialog', { name: PRICING_MODAL_TEXT })

    const blocked =
      (await modal.isVisible({ timeout: 500 }).catch(() => false)) ||
      (await dialog.isVisible({ timeout: 500 }).catch(() => false))

    if (!blocked) {
      await page.waitForTimeout(900)
      const stillBlocked =
        (await modal.isVisible({ timeout: 500 }).catch(() => false)) ||
        (await dialog.isVisible({ timeout: 500 }).catch(() => false))
      if (!stillBlocked) {
        return
      }
      continue
    }

    await dismissBlockingOverlays(page)
    await page.waitForTimeout(400)
  }

  const modal = page.locator('[data-testid="modal-container"]')
  if (await modal.isVisible({ timeout: 500 }).catch(() => false)) {
    throw new Error('El modal de tarifas sigue bloqueando la homepage')
  }
}

export async function dismissCookieBanner(page: Page) {
  await dismissBlockingOverlays(page)
}

export async function searchDestination(page: Page, destination: string) {
  await dismissCookieBanner(page)

  const where = page.locator('[data-testid="structured-search-input-field-query"]')
  await where.waitFor({ state: 'visible', timeout: 15_000 })
  await where.fill(destination, { force: true })

  const suggestion = page.getByRole('option', {
    name: new RegExp(destination, 'i'),
  })
  await suggestion.first().waitFor({ state: 'visible', timeout: 10_000 })
  await suggestion.first().click({ force: true })

  await page.getByRole('button', { name: /^search$|^buscar$/i }).click({ force: true })
  await page.waitForURL(/\/s\//, { timeout: 20_000 })
}

export function trackApiResponses(page: Page): string[] {
  const endpoints = new Set<string>()

  page.on('response', (response: Response) => {
    const url = response.url()
    if (
      url.includes('/api/v3/') ||
      url.includes('/api/v2/') ||
      url.includes('StaysSearch') ||
      url.includes('PdpListing') ||
      url.includes('ExploreSections')
    ) {
      endpoints.add(url.split('?')[0])
    }
  })

  return endpoints as unknown as string[]
}

export function collectEndpoints(endpoints: Set<string>): string[] {
  return [...endpoints].sort()
}

function roomIdFromUrl(href: string): string | null {
  const match = href.match(/\/rooms\/(\d+)/)
  return match?.[1] ?? null
}

async function parseListingFromLink(
  page: Page,
  link: ReturnType<Page['locator']>,
  seen: Set<string>,
): Promise<ScrapedListing | null> {
  const href = (await link.getAttribute('href')) ?? ''
  const roomId = roomIdFromUrl(href)
  if (!roomId || seen.has(roomId)) return null
  seen.add(roomId)

  const url = `${getAirbnbBaseUrl()}/rooms/${roomId}`

  const card = link.locator('xpath=ancestor::div[@itemprop="itemListElement"][1]')
  const cardScope = (await card.count()) > 0 ? card : link.locator('xpath=ancestor::div[3]')

  const title =
    (await link.getAttribute('aria-label')) ??
    (await cardScope.locator('[data-testid="listing-card-title"]').innerText().catch(() => '')) ??
    (await link.innerText().catch(() => '')) ??
    'Unknown'

  const cardText = await cardScope.innerText().catch(() => '')
  const priceMatch = cardText.match(/\$[\d,.]+(?:\s*\w+)?(?:\s+for\s+\d+\s+nights?)?/i)
  const ratingMatch = cardText.match(/\b(\d\.\d{1,2})\b/)

  return {
    title: title.trim().split('\n')[0],
    price: priceMatch?.[0] ?? 'N/A',
    url,
    rating: ratingMatch?.[1],
  }
}

export async function scrapeSearchResults(page: Page): Promise<ScrapedListing[]> {
  return scrapeSearchResultsPaginated(page, { maxPages: 1, maxListings: 10 })
}

export type PaginatedScrapeOptions = {
  maxPages?: number
  maxListings?: number
}

/**
 * Scrapea los anuncios de la página de resultados **actual**. Airbnb los carga
 * de forma perezosa, así que hace scroll hasta que el número de tarjetas se
 * estabiliza antes de recolectar. La navegación entre páginas se hace por URL
 * (cursor de Airbnb), no aquí.
 */
export async function scrapeSearchResultsPaginated(
  page: Page,
  options: PaginatedScrapeOptions = {},
): Promise<ScrapedListing[]> {
  const maxListings =
    options.maxListings ??
    Number.parseInt(process.env.HARVEST_MAX_LISTINGS ?? '20', 10)

  await page.waitForLoadState('domcontentloaded')

  const listingLinks = page.locator('a[href*="/rooms/"]')
  await listingLinks.first().waitFor({ timeout: 30_000 }).catch(() => {})

  // Scroll hasta estabilizar la grilla (lazy-load). No cortar en la primera
  // estabilización: Airbnb suele mostrar 1 tarjeta al cargar y el resto al
  // hacer scroll; exigimos rondas mínimas y 2 lecturas iguales con inventario.
  let prevCount = -1
  let stableRounds = 0
  const minScrollRounds = 5
  for (let s = 0; s < 15; s++) {
    const current = await listingLinks.count()
    if (current === prevCount) {
      stableRounds++
      const enoughInventory = current >= 12 || s >= minScrollRounds
      if (stableRounds >= 2 && enoughInventory) break
    } else {
      stableRounds = 0
    }
    prevCount = current
    await page.mouse.wheel(0, 2_500)
    await page.waitForTimeout(800)
  }

  const listings: ScrapedListing[] = []
  const seen = new Set<string>()
  const count = await listingLinks.count()

  for (let i = 0; i < count && listings.length < maxListings; i++) {
    const parsed = await parseListingFromLink(page, listingLinks.nth(i), seen)
    if (parsed) listings.push(parsed)
  }

  return listings
}

export async function scrapeListingDetail(page: Page): Promise<ScrapedListingDetail> {
  await page.waitForLoadState('domcontentloaded')
  await page.mouse.wheel(0, 800)
  await page.waitForTimeout(800)

  const title = await page
    .locator('h1')
    .first()
    .innerText({ timeout: 15_000 })
    .catch(() => 'Unknown')

  const price = await page
    .locator('[data-testid="book-it-default"]')
    .or(page.locator('[data-section-id="BOOK_IT_SIDEBAR"]'))
    .innerText({ timeout: 10_000 })
    .catch(() => '')
    .then((text) => {
      const match = text.match(/\$[\d,.]+(?:\s*\w+)?/)
      return match?.[0] ?? 'N/A'
    })

  const host = await page
    .locator(
      '[data-section-id="HOST_PROFILE_DEFAULT"] h2, [data-section-id="HOST_PROFILE_DEFAULT"] [data-testid="host-name"]',
    )
    .first()
    .innerText({ timeout: 5_000 })
    .catch(() => undefined)

  const amenityNodes = page.locator(
    '[data-section-id="AMENITIES_DEFAULT"] li, [data-testid="amenity-item"], [data-testid="amenities-list"] div',
  )
  const amenityCount = await amenityNodes.count()
  const amenities: string[] = []
  for (let i = 0; i < Math.min(amenityCount, 12); i++) {
    const text = (await amenityNodes.nth(i).innerText()).trim()
    if (text && text.length < 80) amenities.push(text)
  }

  const description = await page
    .locator('[data-section-id="DESCRIPTION_DEFAULT"], [data-section-id="DESCRIPTION_MODAL"]')
    .innerText({ timeout: 5_000 })
    .catch(() => undefined)

  return {
    title: title.trim(),
    price,
    url: page.url(),
    host: host?.trim(),
    amenities,
    description: description?.slice(0, 1_500),
  }
}

export async function scrapeListingReviews(
  page: Page,
  limit = 5,
): Promise<string[]> {
  const reviews: string[] = []
  const capturedFromApi: string[] = []

  const onResponse = async (response: Response) => {
    const url = response.url()
    if (!/(PdpReviews|StaysPdpReviews|Reviews|graphql)/i.test(url)) return
    if (response.status() !== 200) return

    try {
      const json = await response.json()
      collectReviewTexts(json, capturedFromApi, limit)
    } catch {
      // Non-JSON
    }
  }

  page.on('response', onResponse)

  try {
    await page.mouse.wheel(0, 1_500)
    await page.waitForTimeout(800)

    const reviewsSection = page.locator(
      '[data-section-id="REVIEWS_DEFAULT"], [data-testid="reviews-section"]',
    )
    if (await reviewsSection.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await reviewsSection.scrollIntoViewIfNeeded().catch(() => {})
      await page.waitForTimeout(500)
    }

    const reviewNodes = page.locator(
      '[data-testid="review"], [data-review-id], [data-section-id="REVIEWS_DEFAULT"] li',
    )
    const count = await reviewNodes.count()

    for (let i = 0; i < count && reviews.length < limit; i++) {
      const text = (await reviewNodes.nth(i).innerText()).trim()
      if (text.length > 20) {
        reviews.push(text.slice(0, 400))
      }
    }

    if (reviews.length === 0 && capturedFromApi.length > 0) {
      return capturedFromApi.slice(0, limit)
    }

    return reviews.slice(0, limit)
  } finally {
    page.off('response', onResponse)
  }
}

function collectReviewTexts(payload: unknown, out: string[], limit: number): void {
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

    if (typeof record.comments === 'string' && record.comments.length > 20) {
      out.push(record.comments.slice(0, 400))
    }
    if (typeof record.comment === 'string' && record.comment.length > 20) {
      out.push(record.comment.slice(0, 400))
    }

    queue.push(...Object.values(record))
  }
}

export function buildReport(
  partial: Omit<ScrapingReport, 'viability' | 'notes' | 'timestamp'>,
): ScrapingReport {
  const notes: string[] = []
  const blockers = [...partial.blockers]

  if (partial.listingsFound >= 5) {
    notes.push('Search results expose title, price, URL and rating via DOM.')
  } else if (partial.listingsFound > 0) {
    notes.push('Search results are scrapeable; pagination/infinite scroll needed for bulk extraction.')
  }
  if (partial.apiEndpoints.length > 0) {
    notes.push(
      `Detected ${partial.apiEndpoints.length} internal API endpoints (GraphQL/REST).`,
    )
  }
  if (partial.listingDetail) {
    notes.push('Listing detail page exposes title, price, host, amenities and description.')
  }

  let viability: ScrapingReport['viability'] = 'low'
  const stepsOk = Object.values(partial.steps).filter(Boolean).length

  if (stepsOk === 4 && partial.listingsFound >= 5 && partial.listingDetail) {
    viability = 'high'
  } else if (stepsOk >= 2 && partial.listingsFound > 0) {
    viability = 'medium'
  }

  if (blockers.some((b) => /captcha|blocked|denied|robot/i.test(b))) {
    viability = 'low'
    notes.push('Bot detection or CAPTCHA may block automated scraping at scale.')
  }

  notes.push('Playwright can navigate Airbnb without login for public listing data.')
  notes.push('Rate limiting and ToS apply — use delays and respect robots.txt.')

  return {
    ...partial,
    timestamp: new Date().toISOString(),
    viability,
    notes,
  }
}
