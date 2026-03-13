import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

/**
 * Shared E2E test configuration for SecureBuild projects
 *
 * Each test file runs as a separate Playwright project with its own:
 * - PostgreSQL database (via Testcontainers)
 * - Next.js server instance
 * - Port number
 * - Seed data
 *
 * This allows true parallel execution without test interference.
 *
 * @see https://playwright.dev/docs/test-configuration
 */

// Shared browser configuration
const browserConfig = {
  ...devices['Desktop Chrome'],
  launchOptions: {
    args: [
      // Critical: removes navigator.webdriver flag that identifies automation
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
  },
};

// Shared test settings
const sharedUse = {
  /* Collect trace when retrying the failed test. */
  trace: 'on-first-retry',

  /* Screenshot on failure */
  screenshot: 'only-on-failure',

  /* Video on retry */
  video: 'retain-on-failure',

  /* Realistic browser settings to reduce bot detection */
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 720 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
};

export default defineConfig({
  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Run all projects in parallel (each gets its own DB + server) */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use. */
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],

  /* Configure projects - one per test file */
  projects: [
    // securebuild-app: admin-login test
    {
      name: 'app-admin-login',
      testDir: path.resolve(__dirname, '../securebuild-app/e2e'),
      testMatch: '**/admin-login.spec.ts',
      use: {
        ...sharedUse,
        ...browserConfig,
        baseURL: 'http://localhost:3303',
      },
    },
  ],

  /* Server and database management handled by run-tests.ts wrapper */
});
