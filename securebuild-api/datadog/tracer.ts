import type { Tracer, Span, init as ddTraceInit } from 'dd-trace';
import type { IncomingMessage } from 'http';

const telemetryBackend = String(process.env.TELEMETRY_BACKEND || '').toLowerCase().trim();
const rawFlag = String(process.env.DD_ENABLED || '').toLowerCase();
const isEnabled = telemetryBackend === 'datadog' || telemetryBackend === 'dd' ||
  (telemetryBackend === '' && (rawFlag === 'true' || rawFlag === '1'));

process.env.DD_TRACE_ENABLED = isEnabled ? '1' : '0';
// Application tracing uses @opentelemetry/api for both backends. In Datadog
// mode, enable dd-trace's OTel bridge before loading the tracer so those spans
// are backed by Datadog rather than the API's default no-op provider.
process.env.DD_TRACE_OTEL_ENABLED = isEnabled ? 'true' : 'false';

let tracer: Tracer | null = null;

if (isEnabled) {
  const serviceName = process.env.DD_SERVICE || 'securebuild-api';
  const environment = process.env.DD_ENV || process.env.NODE_ENV || 'development';
  // DD_VERSION is set in the container image during build (see dagger/securebuild-www.go)
  const version = process.env.DD_VERSION || process.env.NEXT_PUBLIC_VERSION || '0.0.0-dev';

  const agentHost = process.env.DD_AGENT_HOST || process.env.DATADOG_AGENT_HOST || '127.0.0.1';
  const agentPort = process.env.DD_TRACE_AGENT_PORT || '8126';

  process.env.DD_SERVICE = serviceName;
  process.env.DD_ENV = environment;
  if (version) {
    process.env.DD_VERSION = version;
  }
  process.env.DD_AGENT_HOST = agentHost;
  process.env.DD_TRACE_AGENT_PORT = agentPort;

  const dbmPropagationMode = (process.env.DD_DBM_PROPAGATION_MODE || 'full') as 'disabled' | 'service' | 'full';

  process.env.DD_DBM_PROPAGATION_MODE = dbmPropagationMode;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ddTrace = require('dd-trace');
    tracer = (ddTrace.init as typeof ddTraceInit)({
      service: serviceName,
      env: environment,
      version,
      logInjection: true,
      runtimeMetrics: true,
      appsec: false,
      profiling: false,
      startupLogs: false,
    }) as Tracer;

    const provider = new ddTrace.TracerProvider();
    provider.register();

    // Disable low-level network instrumentation for localhost connections
    tracer.use('dns', false);
    tracer.use('net', false);
    // Configure http plugin to set resource.name and http.route manually
    tracer.use('http', {
      server: {
        hooks: {
          request: (span?: Span, req?: IncomingMessage) => {
            if (!span) return;

            const url = req?.url || '';
            const method = req?.method || 'GET';

            const path = url.split('?')[0]; // Remove query string
            if (!path.startsWith('/api/')) {
              // Drop non-API routes
              // @ts-expect-error - using an internal property
              span.context()._trace.isRecording = false;
              return;
            }

            const routePattern = getRoutePattern(path);

            span.setTag('resource.name', `${method} ${routePattern}`);
            span.setTag('http.route', routePattern);
          }
        }
      }
    });
  } catch (err) {
    // Do not crash the app if tracing fails to initialize
    console.error('[datadog] failed to initialize tracing', err);
    tracer = null;
  }
}

  // Function to convert actual paths to route patterns
  const getRoutePattern = (path: string): string => {
    // Define route patterns for dynamic routes
    const routePatterns: { pattern: RegExp; replacement: string }[] = [];

    for (const { pattern, replacement } of routePatterns) {
      if (pattern.test(path)) {
        return replacement;
      }
    }

    // Return original path if no pattern matches
    return path;
  }

export default tracer;
