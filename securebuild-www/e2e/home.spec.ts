import { test, expect } from '../../e2e/node_modules/@playwright/test';

test.describe('WWW Catalog Navigation', () => {
  test('navigate to catalog from home page', async ({ page }) => {
    // Start at home page
    await page.goto('/');

    // Click Catalog link (scrolls to featured projects section)
    await page.click('a[href*="/catalog"], a:has-text("Catalog")');

    // Verify URL shows featured projects anchor
    await expect(page).toHaveURL(/#featured-projects/);

    // Click button/link to go to images page (resilient to text changes)
    await page.click('a[href="/images"]');

    // Wait for navigation to /images
    await page.waitForURL(/.*\/images/);

    // Validate images page is visible
    await expect(page.locator('body')).toBeVisible();

    // Verify we're on the images page
    await expect(page).toHaveURL(/\/images/);

    // Wait for loading to complete - skeletons will be replaced with real content
    // Look for actual catalog item text (Redis, Nginx, or Ruby) instead of skeletons
    await page.waitForSelector('text=Redis', { timeout: 10000 });

    // Now count the real catalog items (not skeletons)
    const grid = page.locator('section .grid');
    const catalogItems = await grid.locator('> *').count();
    console.log(`Found ${catalogItems} catalog items in grid`);

    // Should have exactly 3 items: Redis, Nginx, Ruby
    expect(catalogItems).toBe(3);
  });
});
