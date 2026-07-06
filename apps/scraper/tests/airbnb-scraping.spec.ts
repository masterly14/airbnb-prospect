import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  buildReport,
  dismissCookieBanner,
  scrapeListingDetail,
  scrapeSearchResults,
  searchDestination,
  type ScrapingReport,
} from './helpers/airbnb-scraper';

const DESTINATION = 'Barcelona';
const REPORT_DIR = path.join(process.cwd(), 'reports');

test.describe('Airbnb scraping viability', () => {
  test('navigates, extracts listings and evaluates scrape feasibility', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const apiEndpoints = new Set<string>();
    const blockers: string[] = [];

    page.on('response', (response) => {
      const url = response.url();
      if (
        url.includes('/api/v3/') ||
        url.includes('StaysSearch') ||
        url.includes('PdpListing') ||
        url.includes('ExploreSections')
      ) {
        apiEndpoints.add(url.split('?')[0]);
      }
      if (response.status() === 403 || response.status() === 429) {
        blockers.push(`${response.status()} on ${url.split('?')[0]}`);
      }
    });

    const report: Omit<ScrapingReport, 'viability' | 'notes' | 'timestamp'> = {
      destination: DESTINATION,
      steps: {
        homepage: false,
        search: false,
        results: false,
        listingDetail: false,
      },
      listingsFound: 0,
      listings: [],
      listingDetail: null,
      apiEndpoints: [],
      blockers,
    };

    // 1. Homepage
    await page.goto('https://www.airbnb.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);
    await dismissCookieBanner(page);
    await expect(page).toHaveTitle(/Airbnb/i);
    report.steps.homepage = true;

    // 2. Search
    await searchDestination(page, DESTINATION);
    await expect(page).toHaveURL(/Barcelona/i);
    report.steps.search = true;

    // 3. Scrape search results
    const listings = await scrapeSearchResults(page);
    report.listings = listings;
    report.listingsFound = listings.length;
    report.steps.results = listings.length > 0;

    expect(listings.length).toBeGreaterThan(0);
    console.log('\n--- Listings scraped from search ---');
    listings.forEach((l, i) => {
      console.log(
        `${i + 1}. ${l.title} | ${l.price}${l.rating ? ` | ★ ${l.rating}` : ''}`,
      );
      console.log(`   ${l.url}`);
    });

    // 4. Open first listing detail
    const firstListing = listings[0];
    await page.goto(firstListing.url, { waitUntil: 'domcontentloaded' });
    await dismissCookieBanner(page);

    const bodyText = await page.locator('body').innerText();
    if (/captcha|verify you are human|access denied/i.test(bodyText)) {
      blockers.push('CAPTCHA or access block on listing page');
    } else {
      report.listingDetail = await scrapeListingDetail(page);
      report.steps.listingDetail = !!report.listingDetail.title;
    }

    if (report.listingDetail) {
      console.log('\n--- Listing detail scraped ---');
      console.log(`Title: ${report.listingDetail.title}`);
      console.log(`Price: ${report.listingDetail.price}`);
      console.log(`Host: ${report.listingDetail.host ?? 'N/A'}`);
      console.log(`Amenities: ${report.listingDetail.amenities.join(', ') || 'N/A'}`);
    }

    report.apiEndpoints = [...apiEndpoints].sort();
    console.log('\n--- API endpoints detected ---');
    report.apiEndpoints.slice(0, 8).forEach((ep) => console.log(`  ${ep}`));
    if (report.apiEndpoints.length > 8) {
      console.log(`  ... and ${report.apiEndpoints.length - 8} more`);
    }

    const finalReport = buildReport(report);

    console.log('\n========== SCRAPING VIABILITY REPORT ==========');
    console.log(`Destination: ${finalReport.destination}`);
    console.log(`Viability: ${finalReport.viability.toUpperCase()}`);
    console.log(`Steps completed: ${JSON.stringify(finalReport.steps)}`);
    console.log(`Listings found: ${finalReport.listingsFound}`);
    console.log(`API endpoints: ${finalReport.apiEndpoints.length}`);
    console.log(`Blockers: ${finalReport.blockers.length ? finalReport.blockers.join(', ') : 'none'}`);
    finalReport.notes.forEach((note) => console.log(`  • ${note}`));
    console.log('===============================================\n');

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const reportPath = path.join(REPORT_DIR, 'scraping-viability.json');
    fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2));
    console.log(`Report saved to ${reportPath}`);

    expect(finalReport.steps.homepage).toBe(true);
    expect(finalReport.steps.search).toBe(true);
    expect(finalReport.steps.results).toBe(true);
    expect(['medium', 'high']).toContain(finalReport.viability);
  });
});
