/**
 * Telemetry backend selector.
 *
 * Resolves which observability backend to use from environment variables.
 * TELEMETRY_BACKEND = 'datadog' | 'otlp' | 'none'
 *
 * Back-compat: if TELEMETRY_BACKEND is empty and DD_ENABLED is truthy → 'datadog'
 *              else → 'none'
 */

export type TelemetryBackend = 'datadog' | 'otlp' | 'none';

export function resolveTelemetryBackend(): TelemetryBackend {
  const explicit = (process.env.TELEMETRY_BACKEND || '').toLowerCase().trim();

  if (explicit === 'datadog' || explicit === 'otlp' || explicit === 'none') {
    return explicit;
  }

  // Back-compat: honour DD_ENABLED when TELEMETRY_BACKEND is not set
  const rawFlag = String(process.env.DD_ENABLED || '').toLowerCase();
  if (rawFlag === 'true' || rawFlag === '1') {
    return 'datadog';
  }

  return 'none';
}
