import { test, expect } from '../../e2e/node_modules/@playwright/test';
import * as jwt from 'jsonwebtoken';

test.describe('WWW Purchase Flow', () => {
  test('purchase Redis subscription with authenticated session', async ({ page, context }) => {
    // Create JWT token with the session payload (matching what the server creates)
    const sessionPayload = {
      id: 'e2e-test-session-id',
      firstName: 'E2E',
      lastName: 'Test User',
      email: 'test@securebuild.io',
      picture: 'https://avatars.githubusercontent.com/u/0?v=4',
      userId: 'e2e-test-user-id',
      teams: [
        {
          id: 'e2e-test-team-id',
          name: 'E2E Test Team',
        },
      ],
      selectedTeamId: 'e2e-test-team-id',
    };

    const sessionToken = jwt.sign(
      sessionPayload,
      'e2e-test-secret-key-for-jwt-signing',
      { expiresIn: '24h' }
    );

    console.log('[E2E TEST] Created JWT token');

    // Set cookie expiration (7 days from now, matching real login)
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

    // Set the session cookie to authenticate the user
    // Note: httpOnly must be false to match how the real login flow sets the cookie
    await context.addCookies([{
      name: 'session',
      value: sessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
      expires: Math.floor(expires.getTime() / 1000), // Playwright expects Unix timestamp in seconds
    }]);

    console.log('[E2E TEST] Set session cookie');

    // Go directly to dashboard (already authenticated via session cookie)
    await page.goto('/dashboard');

    console.log('[E2E TEST] Navigated to /dashboard');

    // Verify we're on the dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // Wait for the dashboard to actually render - get Catalog link by href (first match is sidebar nav), wait for visible, then click
    const catalogLink = page.locator('a[href="/dashboard/catalog"]').first();
    await catalogLink.waitFor({ state: 'visible', timeout: 10000 });
    await catalogLink.click();

    // Wait for catalog items to load (Redis, Nginx, Ruby)
    await page.waitForSelector('text=Redis', { timeout: 30000 });

    // Click on Redis catalog item to view details (resilient to text changes)
    await page.click('a[href*="/images/redis"]');

    // Wait for the detail page to load
    await page.waitForURL(/.*\/images\/redis/, { timeout: 30000 });

    // Verify we're on the Redis detail page
    await expect(page).toHaveURL(/\/images\/redis/);

    // Wait for the subscribe button to appear and click it (resilient to text changes)
    await page.waitForSelector('a[href*="/checkout/redis"]', { timeout: 30000 });
    await page.click('a[href*="/checkout/redis"]');

    // Wait for checkout page
    await page.waitForURL(/.*\/checkout\/redis/, { timeout: 10000 });

    // Verify we're on the checkout page
    await expect(page).toHaveURL(/\/checkout\/redis/);

    // Wait for the checkout form to load - check for the email input
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    // Verify user email is shown
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toHaveValue('test@securebuild.io');

    const continueButton = page.getByTestId('checkout-continue-button');
    await continueButton.click();

    // Wait for payment options to load (Card/Amazon Pay)
    // Wait for "Fetching payment details..." to disappear and payment options to appear
    await page.waitForSelector('text=Card', { timeout: 15000 });

    // Verify Card payment option is visible
    await expect(page.locator('text=Card')).toBeVisible();

    // Set up page close event handler right after Card label is found
    page.on('close', () => {
      console.log('⚠️ Page was closed unexpectedly!');
    });

    // Wait a bit for Amazon Pay to potentially load (optional payment method)
    await page.waitForTimeout(1000);

    // Select Card payment option by clicking the card details row/section
    // Look for the payment method selector that contains "Card"
    const cardOption = page.locator('div, button, label').filter({ hasText: 'Card' }).first();
    await cardOption.click();

    // Wait for Stripe iframe to load and fill in card details
    // The iframe name changes dynamically, so we use a more flexible selector
    const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();

    // Wait for the card number field to be visible and ready in the iframe
    // This is critical in CI environments where the iframe may take longer to initialize
    const cardNumberField = stripeFrame.getByRole('textbox', { name: 'Card number' });
    await cardNumberField.waitFor({ state: 'visible', timeout: 30000 });

    // Additional wait to ensure iframe is fully interactive (reduces flakiness in CI)
    await page.waitForTimeout(500);

    // Fill in test card details (Stripe test card: 4242 4242 4242 4242)
    // Use type() with delay to simulate human typing and reduce bot detection
    await cardNumberField.type('4242424242424242', { delay: 50 });

    await stripeFrame.getByRole('textbox', { name: /Expiration/ }).type('0149', { delay: 50 });

    await stripeFrame.getByRole('textbox', { name: 'Security code' }).type('123', { delay: 50 });

    await stripeFrame.getByRole('textbox', { name: 'ZIP code' }).type('12345', { delay: 50 });

    // Check the terms and conditions checkbox
    // Use the role-based selector from the recording
    const checkbox = page.getByRole('checkbox', { name: /Customer acknowledges/ });
    await checkbox.check();

    // Verify the checkbox is checked
    await expect(checkbox).toBeChecked();

    // Get payment button by test ID (text changes from "Complete Subscription" -> "Processing..." -> success page)
    const paymentButton = page.getByTestId('checkout-payment-button');

    // Wait for button to be enabled
    await expect(paymentButton).toBeEnabled({ timeout: 5000 });

    // Focus the button first (helps with React event handlers in headless mode)
    await paymentButton.focus();

    // Click the button
    await paymentButton.click();

    // Wait for payment processing to start (button text changes to "Processing...")
    await expect(paymentButton).toHaveText('Processing...', { timeout: 5000 });

    // Now wait for the success button to appear (using test ID instead of text for resilience)
    console.log('Waiting for checkout success button to appear...');
    const goToImagesButton = page.getByTestId('checkout-success-button');

    // Wait for the button to appear (after "Processing..." completes)
    await goToImagesButton.waitFor({ state: 'visible', timeout: 10000 });
    console.log('Found checkout success button');

    await goToImagesButton.click();
    console.log('Clicked checkout success button');

    // Wait for redirect to dashboard images page
    await page.waitForURL(/.*\/dashboard\/images/, { timeout: 10000 });

    // Verify we're on the dashboard images page
    await expect(page).toHaveURL(/\/dashboard\/images/);

    // Wait for the purchased image (Redis) to appear
    await page.waitForSelector('text=Redis', { timeout: 10000 });

    // Verify Redis appears in the subscribed images list
    await expect(page.locator('text=Redis')).toBeVisible();

    console.log('✓ Successfully completed purchase flow and verified subscription');
  });
});
