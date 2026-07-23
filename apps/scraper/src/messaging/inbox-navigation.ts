import type { Page } from 'playwright'
import { outboundLog } from '../logging/outbound-logger'
import { getAirbnbBaseUrl } from '../scraping/airbnb-context'
import { dismissBlockingOverlays } from '../scraping/airbnb-scraper'
import { gotoAndSettle, waitForUiSettle } from '../scraping/page-timing'

/** Etiquetas del filtro de inbox cuando la cuenta es coanfitrión/anfitrión. */
const TRAVELER_FILTER_PATTERN = /^modo viajero$|^traveler mode$/i
const INBOX_FILTER_BUTTON_PATTERN =
  /^todos$|^all$|^anfitri[oó]n$|^host$|^modo viajero$|^traveler mode$|^coanfitri[oó]n$|^co-host$|^asistencia$|^support$/i

export function isTravelerInboxFilterLabel(label: string): boolean {
  const normalized = label.trim().replace(/\s+/g, ' ')
  return TRAVELER_FILTER_PATTERN.test(normalized)
}

/**
 * En cuentas coanfitrión/anfitrión, Airbnb mezcla hilos de anfitrión y viajero.
 * Los mensajes del sistema de prospección viven en "Modo viajero".
 */
export async function ensureTravelerInboxFilter(page: Page): Promise<boolean> {
  const filterButton = page.getByRole('button', { name: INBOX_FILTER_BUTTON_PATTERN }).first()

  const hasFilter = await filterButton.isVisible({ timeout: 4_000 }).catch(() => false)
  if (!hasFilter) return false

  const currentLabel = (await filterButton.innerText()).trim().replace(/\s+/g, ' ')
  if (isTravelerInboxFilterLabel(currentLabel)) {
    outboundLog('inbox.filter.already_traveler', { label: currentLabel })
    return true
  }

  outboundLog('inbox.filter.open', { currentLabel })
  await filterButton.click()
  await page.waitForTimeout(600)

  const travelerOption = page
    .getByRole('menuitem', { name: TRAVELER_FILTER_PATTERN })
    .or(page.getByRole('option', { name: TRAVELER_FILTER_PATTERN }))
    .or(
      page
        .locator('[role="menuitem"], [role="option"], [role="listitem"]')
        .filter({ hasText: TRAVELER_FILTER_PATTERN }),
    )
    .first()

  if (await travelerOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await travelerOption.click()
  } else {
    const fallback = page
      .locator('[role="menu"], [role="listbox"], ul')
      .locator('li, button, a, div')
      .filter({ hasText: TRAVELER_FILTER_PATTERN })
      .first()

    if (await fallback.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await fallback.click()
    } else {
      await page.keyboard.press('Escape').catch(() => {})
      outboundLog('inbox.filter.traveler_option_missing', { currentLabel })
      return false
    }
  }

  await page.waitForTimeout(1_000)
  outboundLog('inbox.filter.traveler_selected')
  return true
}

export async function navigateToGuestInbox(page: Page): Promise<void> {
  const base = getAirbnbBaseUrl()
  await gotoAndSettle(page, `${base}/guest/messages`)
  await dismissBlockingOverlays(page)
  await ensureTravelerInboxFilter(page)
  await waitForUiSettle(page)
}
