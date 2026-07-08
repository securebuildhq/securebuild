export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Only load tracer if Datadog is actually enabled
    const rawFlag = String(process.env.DD_ENABLED || '').toLowerCase();
    const isEnabled = rawFlag === 'true' || rawFlag === '1';

    if (isEnabled) {
      // Load the tracer only when explicitly enabled
      await import('./datadog/tracer');
    }
  }
}
