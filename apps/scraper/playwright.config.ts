import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import {
  getChromeChannelOption,
  getColombiaContextOptions,
} from './tests/helpers/airbnb-context';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const authFile = 'playwright/.auth/airbnb-session.json';
const colombiaContext = getColombiaContextOptions();
const chromeChannel = getChromeChannelOption();

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    ...colombiaContext,
    ...chromeChannel,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        ...colombiaContext,
        ...chromeChannel,
      },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: 'chromium-authenticated',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
        ...colombiaContext,
        ...chromeChannel,
      },
      dependencies: ['setup'],
      testMatch: /airbnb-authenticated\.spec\.ts/,
    },
    {
      name: 'scrape-authenticated',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
        ...colombiaContext,
        ...chromeChannel,
      },
      testMatch: /airbnb-search\.spec\.ts/,
    },
    {
      name: 'harvest-authenticated',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
        ...colombiaContext,
        ...chromeChannel,
      },
      testMatch: /harvest-leads\.spec\.ts/,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
