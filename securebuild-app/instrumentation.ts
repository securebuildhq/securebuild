/**
 * Next.js Instrumentation Hook
 *
 * This runs once when the Next.js server starts (before any requests are handled).
 * In E2E test mode, DB_URI is configured by run-tests.ts before starting the server.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // E2E Test Mode: DB_URI is set by run-tests.ts before starting server
    if (process.env.E2E_TEST_MODE === 'true') {
      const port = process.env.PORT || '3000';
      const testName = process.env.E2E_TEST_NAME || 'unknown';
      console.log(`[E2E:${port}] Running in E2E test mode for ${testName}`);
      console.log(`[E2E:${port}] DB_URI: ${process.env.DB_URI ? 'configured' : 'MISSING!'}`);
    }

    // Only load tracer if Datadog is actually enabled
    const rawFlag = String(process.env.DD_ENABLED || '').toLowerCase();
    const isEnabled = rawFlag === 'true' || rawFlag === '1';

    if (isEnabled) {
      // Load the tracer only when explicitly enabled
      await import('./datadog/tracer');
    }
  }
}
