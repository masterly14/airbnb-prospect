import type { Page } from '@playwright/test'

/**
 * Botón del menú de perfil en el header de Airbnb.
 * Usar data-testid: el role+name ambiguo también matchea otros botones del nav
 * (p. ej. "Conviértete en anfitrión") vía `.or(nav button last)` → strict mode.
 */
export function headerProfileMenuButton(page: Page) {
  return page
    .getByTestId('cypress-headernav-profile')
    .or(
      page.getByRole('button', {
        name: /main navigation menu|menú de navegación principal/i,
      }),
    )
    .first()
}

export function guestLoginMenuItem(page: Page) {
  return page
    .getByRole('menuitem', {
      name: /iniciar sesión|log in|sign in|registrarse|sign up/i,
    })
    .or(
      page.getByRole('link', {
        name: /iniciar sesión|log in|sign in|registrarse|sign up/i,
      }),
    )
    .first()
}

export async function isLoggedInViaHeader(page: Page): Promise<boolean> {
  const profileLink = page
    .locator('a[href="/users/profile"]')
    .or(page.locator('a[href*="/users/show/"]'))
    .or(page.locator('a[href*="/account-settings"]'))
  if (await profileLink.first().isVisible({ timeout: 4_000 }).catch(() => false)) {
    return true
  }

  const menu = headerProfileMenuButton(page)
  if (!(await menu.isVisible({ timeout: 8_000 }).catch(() => false))) {
    return false
  }

  // Si el menú ya está abierto (aria-expanded), no re-clickear.
  const expanded = await menu.getAttribute('aria-expanded').catch(() => null)
  if (expanded !== 'true') {
    await menu.click({ timeout: 8_000 }).catch(() => undefined)
  }

  const hasGuestLogin = await guestLoginMenuItem(page)
    .isVisible({ timeout: 3_000 })
    .catch(() => false)

  await page.keyboard.press('Escape').catch(() => undefined)
  return !hasGuestLogin
}
