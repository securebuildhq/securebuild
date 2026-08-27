export type TelemetryBackend = 'datadog' | 'otlp' | 'none';

/** Match the Go services' explicit backend aliases and DD_ENABLED fallback. */
export function resolveTelemetryBackend(): TelemetryBackend {
  switch ((process.env.TELEMETRY_BACKEND || '').toLowerCase().trim()) {
    case 'datadog':
    case 'dd':
      return 'datadog';
    case 'otlp':
    case 'otel':
    case 'opentelemetry':
      return 'otlp';
    case '': {
      const enabled = String(process.env.DD_ENABLED || '').toLowerCase();
      return enabled === 'true' || enabled === '1' ? 'datadog' : 'none';
    }
    default:
      return 'none';
  }
}
