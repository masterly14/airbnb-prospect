import { Page } from '@playwright/test'
import {
  buildSearchResultsUrl,
  getSearchDates,
  MEDELLIN_PLACE_ID,
  MEDELLIN_SEARCH_SLUG,
  type SearchDateRange,
  type SearchWithDatesOptions,
  type SearchWithDatesResult,
} from '../../src/scraping/airbnb-search'
import { dismissBlockingOverlays, ensureHomepageReady } from './airbnb-scraper'

export {
  buildSearchResultsUrl,
  getSearchDates,
  MEDELLIN_PLACE_ID,
  MEDELLIN_SEARCH_SLUG,
  type SearchDateRange,
  type SearchWithDatesOptions,
  type SearchWithDatesResult,
}

const DEFAULT_TIMEZONE = 'America/Bogota'

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

function dayButtonPattern(iso: string): RegExp {
  const { year, month: monthNum, day } = parseIsoDate(iso)
  const date = new Date(Date.UTC(year, monthNum - 1, day))
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(date)
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(date)

  return new RegExp(`^${day}, ${weekday}, ${month} ${year}\\b`, 'i')
}

async function isCalendarVisible(page: Page): Promise<boolean> {
  return page
    .getByRole('application', { name: /calendario|calendar/i })
    .isVisible({ timeout: 1_500 })
    .catch(() => false)
}

async function waitForCalendar(page: Page) {
  await page
    .getByRole('application', { name: /calendario|calendar/i })
    .waitFor({ state: 'visible', timeout: 10_000 })
}

async function openExpandedSearch(page: Page) {
  if (await isCalendarVisible(page)) {
    return
  }

  const triggers = [
    page.getByRole('searchbox', { name: /dónde|where/i }).first(),
    page.getByText(/^dónde$|^where$/i).first(),
    page.locator('[data-testid="structured-search-input-field-query"]').first(),
    page.getByRole('button', { name: /fechas.*agrega fechas|dates.*add dates/i }).first(),
  ]

  for (const trigger of triggers) {
    if (!(await trigger.isVisible({ timeout: 1_000 }).catch(() => false))) {
      continue
    }
    await trigger.click({ timeout: 5_000 })
    if (await isCalendarVisible(page)) {
      return
    }
  }

  await waitForCalendar(page)
}

async function openDatesPicker(page: Page) {
  if (await isCalendarVisible(page)) {
    return
  }

  await openExpandedSearch(page)

  if (await isCalendarVisible(page)) {
    return
  }

  const datesField = page
    .getByRole('button', { name: /fechas.*agrega fechas|dates.*add dates/i })
    .or(page.locator('[data-testid="structured-search-input-field-split-dates-0"]'))
    .first()

  await datesField.click({ timeout: 10_000 })
  await waitForCalendar(page)
}

async function advanceCalendarMonth(page: Page) {
  const next = page
    .getByRole('button', {
      name: /flecha de la derecha para cambiar al mes siguiente|next month/i,
    })
    .first()

  await next.click({ timeout: 5_000 })
  await page.waitForTimeout(400)
}

async function clickCalendarDay(page: Page, iso: string) {
  const byDateAttr = page.locator(
    `button[data-state--date-string="${iso}"]:not([disabled])`,
  )
  const dayPattern = dayButtonPattern(iso)

  for (let attempt = 0; attempt < 8; attempt++) {
    if (await byDateAttr.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
      await byDateAttr.first().click({ force: true, timeout: 5_000 })
      return
    }

    const dayButton = page.getByRole('button', { name: dayPattern, disabled: false }).first()
    if (await dayButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await dayButton.click({ force: true, timeout: 5_000 })
      return
    }

    const next = page.getByRole('button', {
      name: /flecha de la derecha para cambiar al mes siguiente|next month/i,
    }).first()

    if (await next.isEnabled({ timeout: 500 }).catch(() => false)) {
      await advanceCalendarMonth(page)
      continue
    }

    await page.waitForTimeout(400)
  }

  throw new Error(`No se pudo seleccionar el día ${iso} en el calendario`)
}

async function fechasAlreadySelected(
  page: Page,
  { checkin, checkout }: SearchDateRange,
): Promise<boolean> {
  const fechasButton = page.getByRole('button', { name: /fechas/i }).first()
  if (!(await fechasButton.isVisible({ timeout: 1_000 }).catch(() => false))) {
    return false
  }

  const label = (await fechasButton.innerText()).toLowerCase()
  const checkinDay = parseIsoDate(checkin).day.toString()
  const checkoutDay = parseIsoDate(checkout).day.toString()

  return label.includes(checkinDay) && label.includes(checkoutDay)
}

export async function selectDateRange(
  page: Page,
  { checkin, checkout }: SearchDateRange,
  _timezone = DEFAULT_TIMEZONE,
) {
  if (await fechasAlreadySelected(page, { checkin, checkout })) {
    return
  }

  await openDatesPicker(page)
  await clickCalendarDay(page, checkin)
  await page.waitForTimeout(400)

  if (!(await isCalendarVisible(page))) {
    await openDatesPicker(page)
  }

  if (!(await fechasAlreadySelected(page, { checkin, checkout }))) {
    await clickCalendarDay(page, checkout)
  }
}

async function fillDestination(page: Page, destination: string) {
  const where = page.getByRole('searchbox', { name: /dónde|where/i }).first()
  await where.waitFor({ state: 'visible', timeout: 15_000 })
  await where.click({ timeout: 10_000 })
  await where.fill('')
  await where.pressSequentially(destination, { delay: 40 })

  const suggestion = page.getByRole('option').first()
  await suggestion.waitFor({ state: 'visible', timeout: 10_000 })
  await suggestion.click()

  await isCalendarVisible(page).then((open) => open || openDatesPicker(page))
}

export async function searchWithDates(
  page: Page,
  {
    destination = 'Medellin',
    nights = 7,
    timezone = DEFAULT_TIMEZONE,
  }: SearchWithDatesOptions = {},
): Promise<SearchWithDatesResult> {
  const dates = getSearchDates(nights, timezone)

  await ensureHomepageReady(page)
  await fillDestination(page, destination)
  await selectDateRange(page, dates, timezone)

  const searchButton = page.getByRole('button', { name: /^buscar$|^search$/i })
  await searchButton.click({ timeout: 10_000 })

  await page.waitForURL(/\/s\/.*\/homes/, { timeout: 30_000 })
  await dismissBlockingOverlays(page)

  return {
    ...dates,
    resultsUrl: page.url(),
  }
}
