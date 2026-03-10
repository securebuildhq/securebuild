import { test, expect } from '../../e2e/node_modules/@playwright/test';

test.describe('WWW Login', () => {
  test('login and verify catalog link is visible', async ({ page }) => {
    // Go to login page
    await page.goto('/login');

    // Enter email address
    await page.fill('input[type="email"]', 'test@securebuild.io');

    // Submit the email form (resilient to button text changes)
    await page.locator('form:has(input[type="email"]) button[type="submit"]').click();

    // Wait for code input to appear
    await expect(page.locator('input#code')).toBeVisible({ timeout: 5000 });

    // Verify message shows the email
    await expect(page.locator('text=test@securebuild.io')).toBeVisible();

    // Enter the verification code from fixture (123456)
    await page.fill('input#code', '123456');

    // Submit the verification form (resilient to button text changes)
    await page.locator('form:has(input#code) button[type="submit"]').click();

    // Wait for redirect to dashboard
    await page.waitForURL(/.*\/dashboard/, { timeout: 10000 });

    // Verify we're on the dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // Wait for the dashboard to actually render - verify Catalog link is visible
    const catalogLink = page.locator('a[href="/dashboard/catalog"]').first();
    await catalogLink.waitFor({ state: 'visible', timeout: 10000 });

    // Verify the catalog link is visible
    await expect(catalogLink).toBeVisible();

    console.log('✓ Successfully logged in and verified catalog link is visible');
  });
});
