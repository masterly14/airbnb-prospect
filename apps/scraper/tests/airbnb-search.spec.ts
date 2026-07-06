import { test, expect } from '@playwright/test';
import { getAirbnbBaseUrl } from './helpers/airbnb-context';
import {
  buildSearchResultsUrl,
  getSearchDates,
  searchWithDates,
} from './helpers/airbnb-search';
import { dismissBlockingOverlays, ensureHomepageReady } from './helpers/airbnb-scraper';

test.describe('Airbnb search (authenticated)', () => {
  test('searches Medellín with 7-day range via homepage UI', async ({ page }) => {
    test.setTimeout(120_000);

    const expectedDates = getSearchDates(7);

    await page.goto(getAirbnbBaseUrl(), { waitUntil: 'domcontentloaded' });
    await ensureHomepageReady(page);

    const result = await searchWithDates(page, {
      destination: 'Medellin',
      nights: 7,
    });

    expect(result.checkin).toBe(expectedDates.checkin);
    expect(result.checkout).toBe(expectedDates.checkout);

    const resultsUrl = new URL(result.resultsUrl);
    expect(resultsUrl.pathname).toMatch(/Medell/i);
    expect(resultsUrl.searchParams.get('checkin')).toBe(expectedDates.checkin);
    expect(resultsUrl.searchParams.get('checkout')).toBe(expectedDates.checkout);

    await expect(page.locator('a[href*="/rooms/"]').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('direct search URL opens results after dismissing pricing modal', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const { checkin, checkout } = getSearchDates(7);
    const url = buildSearchResultsUrl({ checkin, checkout });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await dismissBlockingOverlays(page);

    const current = new URL(page.url());
    expect(current.pathname).toMatch(/Medell/i);
    expect(current.searchParams.get('checkin')).toBe(checkin);
    expect(current.searchParams.get('checkout')).toBe(checkout);

    await expect(page.locator('a[href*="/rooms/"]').first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
