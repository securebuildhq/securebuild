/**
 * Telemetry backend selector.
 *
 * Resolves which observability backend to use from environment variables.
 * TELEMETRY_BACKEND accepts the same aliases as the Go side (pkg/telemetry):
 *   datadog | dd                   → 'datadog'
 *   otlp    | otel | opentelemetry → 'otlp'
 *   none    | off  | disabled      → 'none'
 *
 * Back-compat: if TELEMETRY_BACKEND is empty and DD_ENABLED is truthy → 'datadog'
 *              else → 'none'. An unrecognised value resolves to 'none'.
 */

export type TelemetryBackend = 'datadog' | 'otlp' | 'none';

export function resolveTelemetryBackend(): TelemetryBackend {
  const explicit = (process.env.TELEMETRY_BACKEND || '').toLowerCase().trim();

  switch (explicit) {
    case 'datadog':
    case 'dd':
      return 'datadog';
    case 'otlp':
    case 'otel':
    case 'opentelemetry':
      return 'otlp';
    case 'none':
    case 'off':
    case 'disabled':
      return 'none';
    case '': {
      // Back-compat: honour DD_ENABLED only when TELEMETRY_BACKEND is unset.
      const rawFlag = String(process.env.DD_ENABLED || '').toLowerCase();
      return rawFlag === 'true' || rawFlag === '1' ? 'datadog' : 'none';
    }
    default:
      return 'none';
  }
}
