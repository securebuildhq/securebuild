import { test, expect } from '../../e2e/node_modules/@playwright/test';

/**
 * Bootstrap E2E Test: Admin Login and Packages Navigation
 *
 * This test validates the basic authentication flow and navigation
 * to the packages page in the SecureBuild Admin application.
 *
 * Test Mode (CI/PR):
 * - E2E_TEST_MODE=true enables test authentication bypass
 * - No GitHub OAuth required
 * - PostgreSQL via Testcontainers
 *
 * Post-Deployment Mode:
 * - Uses real deployed Admin site
 * - Real GitHub OAuth authentication
 * - E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD from Doppler
 */

test.describe('Admin Login and Navigation', () => {
  test('should login and navigate to packages page', async ({ page }) => {
    // Step 1: Navigate to login page
    await page.goto('/login');

    // Verify login page loads
    await expect(page.locator('h1')).toContainText('SecureBuild');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    // Step 2: Wait for Sign In button to be enabled (test mode check completes)
    // Then click Sign In button
    // In test mode: Bypasses GitHub OAuth, creates test session
    // In production mode: Redirects to GitHub OAuth (requires real credentials)
    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeEnabled({ timeout: 5000 });
    await signInButton.click();

    // Step 3: Wait for redirect to dashboard or home page
    // After successful login, user should be redirected away from /login
    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 5000,
    });

    // Verify we're logged in by checking for common dashboard elements
    // Most admin pages have some navigation or user menu after login
    await expect(page).toHaveURL(/\/(dashboard|packages|images)/, {
      timeout: 5000,
    });

    // Step 4: Navigate to Packages page
    // Try multiple navigation strategies since the exact structure may vary
    const packagesLinkSelectors = [
      'a[href="/packages"]',
      'a[href*="/packages"]',
      'nav >> text=Packages',
      '[data-testid="packages-link"]',
    ];

    let navigated = false;
    for (const selector of packagesLinkSelectors) {
      const link = page.locator(selector).first();
      if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
        await link.click();
        navigated = true;
        break;
      }
    }

    // If no packages link found in nav, try direct navigation
    if (!navigated) {
      await page.goto('/packages');
    }

    // Step 5: Verify packages page loads
    await expect(page).toHaveURL(/\/packages/, { timeout: 5000 });

    // Verify page rendered (should have heading, table, or empty state)
    // Use Promise.any to wait for any one of these elements to be visible
    await expect(async () => {
      const elements = [
        page.locator('h1, h2').first(),
        page.locator('table'),
        page.locator('text=/package/i').first(),
      ];

      // Check if any element is visible
      for (const element of elements) {
        if (await element.isVisible().catch(() => false)) {
          return;
        }
      }

      throw new Error('No expected elements found on packages page');
    }).toPass({ timeout: 5000 });
  });

  test('should show login button on login page', async ({ page }) => {
    // Simple smoke test to verify login page renders
    await page.goto('/login');

    // Verify core login page elements
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.locator('text=SecureBuild')).toBeVisible();
  });
});
