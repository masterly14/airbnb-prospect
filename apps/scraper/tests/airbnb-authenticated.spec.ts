import { test, expect } from '@playwright/test';
import { getAirbnbBaseUrl } from './helpers/airbnb-context';
import { dismissBlockingOverlays } from './helpers/airbnb-scraper';

test.describe('Airbnb authenticated session', () => {
  test('reuses saved session without login prompt', async ({ page }) => {
    await page.goto(getAirbnbBaseUrl(), { waitUntil: 'domcontentloaded' });
    await dismissBlockingOverlays(page);

    const userMenu = page.getByRole('button', {
      name: /main navigation menu|menú de navegación principal|menú principal/i,
    });
    await userMenu.click();

    await expect(
      page.getByRole('menuitem', { name: /iniciar sesión|log in|sign in/i }),
    ).toHaveCount(0);
  });
});
