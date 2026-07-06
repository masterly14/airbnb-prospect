import { test, expect } from '@playwright/test';

test.describe('Airbnb', () => {
  test('loads the homepage', async ({ page }) => {
    await page.goto('https://www.airbnb.com/', {
      waitUntil: 'domcontentloaded',
    });

    await expect(page).toHaveTitle(/Airbnb/i);
    await expect(page.getByRole('search')).toBeVisible({ timeout: 15_000 });
  });
});
