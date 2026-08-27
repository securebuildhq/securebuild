export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { resolveTelemetryBackend } = await import('./lib/observability/backend');

    const backend = resolveTelemetryBackend();

    if (backend === 'datadog') {
      await import('./datadog/tracer');
    } else if (backend === 'otlp') {
      await import('./otel/instrumentation');
    }
  }
}
