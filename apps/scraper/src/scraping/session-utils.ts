import type { Page } from 'playwright'
import { ensureHomepageReady } from './airbnb-scraper'

export async function isSessionValid(page: Page): Promise<boolean> {
  await ensureHomepageReady(page).catch(() => {})

  const profileLink = page.locator('a[href="/users/profile"]')
  if (await profileLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
    return true
  }

  const loginLink = page.getByRole('menuitem', { name: /iniciar sesión|log in|sign in/i })
  const userMenu = page
    .getByRole('button', {
      name: /main navigation menu|menú de navegación principal|menú principal/i,
    })
    .or(page.locator('nav').getByRole('button').last())

  if (!(await userMenu.isVisible({ timeout: 8_000 }).catch(() => false))) {
    return false
  }

  await userMenu.click({ timeout: 5_000 }).catch(() => {})
  const hasLogin = await loginLink.isVisible({ timeout: 3_000 }).catch(() => false)
  await page.keyboard.press('Escape').catch(() => {})

  return !hasLogin
}
