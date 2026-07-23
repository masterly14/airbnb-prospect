import type { Page } from 'playwright'
import { ensureHomepageReady } from './airbnb-scraper'
import { waitForSecurityChallengeIfPresent } from './security-challenge'
import { isLoggedInViaHeader } from '../../tests/helpers/airbnb-header'

export async function isSessionValid(page: Page): Promise<boolean> {
  await ensureHomepageReady(page).catch(() => {})
  await waitForSecurityChallengeIfPresent(page).catch(() => {})
  return isLoggedInViaHeader(page)
}
