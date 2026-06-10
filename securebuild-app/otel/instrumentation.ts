/**
 * OpenTelemetry SDK initialisation for the OTLP backend.
 *
 * Activated when TELEMETRY_BACKEND=otlp. Exports traces and metrics via OTLP
 * to either Grafana Alloy (self-hosted) or any OTLP-compatible collector.
 *
 * Standard OTLP environment variables are honoured automatically by the
 * exporters (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL, etc.).
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import type { IncomingMessage } from 'http';
import { getRoutePattern } from './route-patterns';

const serviceName = process.env.OTEL_SERVICE_NAME || 'securebuild-app';
const environment = process.env.DD_ENV || process.env.NODE_ENV || 'development';
const version = process.env.DD_VERSION || process.env.NEXT_PUBLIC_VERSION || '0.0.0-dev';

try {
  const sdk = new NodeSDK({
    resource: new Resource({
      'service.name': serviceName,
      'deployment.environment': environment,
      'service.version': version,
    }),

    traceExporter: new OTLPTraceExporter(),

    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),

    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable low-level network plugins to match current Datadog behaviour
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },

        // Keep http instrumentation enabled but customise it
        '@opentelemetry/instrumentation-http': {
          enabled: true,

          // Drop Next.js internal /_next/* requests
          ignoreIncomingRequestHook: (req: IncomingMessage): boolean => {
            const url = req.url || '';
            return url.startsWith('/_next/');
          },

          // Normalise route patterns and set http.route attribute
          requestHook: (span, req: IncomingMessage | import('http').ClientRequest) => {
            // Only normalise incoming server-side requests
            if (!('url' in req) || typeof req.url !== 'string') return;
            const url = req.url;
            const method = ('method' in req && req.method) ? String(req.method) : 'GET';
            const path = url.split('?')[0];
            const routePattern = getRoutePattern(path);
            span.setAttribute('http.route', routePattern);
            span.updateName(`${method} ${routePattern}`);
          },
        },
      }),

      // Runtime metrics: event loop utilisation, GC, heap — parity with dd runtimeMetrics
      new RuntimeNodeInstrumentation(),
    ],
  });

  sdk.start();

  // Flush buffered spans/metrics on shutdown so the batch processors don't drop
  // in-flight data when the container receives SIGTERM/SIGINT. We exit after the
  // flush: adding a signal listener overrides Node's default terminate behaviour,
  // so the handler is responsible for ending the process.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    sdk
      .shutdown()
      .then(() => console.log(`[otel] tracing shut down (${signal})`))
      .catch((err) => console.error('[otel] error shutting down tracing', err))
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (err) {
  // Never crash the app if OTel initialisation fails
  console.error('[otel] failed to initialize tracing', err);
}
