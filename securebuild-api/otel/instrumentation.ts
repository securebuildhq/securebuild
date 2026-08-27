import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import type { IncomingMessage } from 'http';

// Bound telemetry memory when the collector is slow or unavailable.
process.env.OTEL_BSP_MAX_QUEUE_SIZE ||= '2048';
process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE ||= '512';
process.env.OTEL_BSP_EXPORT_TIMEOUT ||= '5000';
process.env.OTEL_EXPORTER_OTLP_TIMEOUT ||= '5000';

const serviceName = process.env.OTEL_SERVICE_NAME || 'securebuild-api';
const environment = process.env.OTEL_DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV || 'development';
const version = process.env.OTEL_SERVICE_VERSION || process.env.NEXT_PUBLIC_VERSION || '0.0.0-dev';

const sdk = new NodeSDK({
  resource: new Resource({
    'service.name': serviceName,
    'deployment.environment': environment,
    'service.version': version,
  }),
  traceExporter: new OTLPTraceExporter({ concurrencyLimit: 1 }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ concurrencyLimit: 1 }),
    exportIntervalMillis: 30_000,
    exportTimeoutMillis: 5_000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook: (req: IncomingMessage): boolean =>
          (req.url || '').startsWith('/_next/'),
      },
    }),
    new RuntimeNodeInstrumentation(),
  ],
});

try {
  sdk.start();
  console.log(`[otel] telemetry initialized for ${serviceName}`);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    sdk
      .shutdown()
      .catch((err) => console.error('[otel] shutdown failed', err))
      .finally(() => process.exit(0));
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (err) {
  console.error('[otel] failed to initialize telemetry', err);
}
