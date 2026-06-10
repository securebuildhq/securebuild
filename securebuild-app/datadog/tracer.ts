import type { Tracer, Span, init as ddTraceInit } from 'dd-trace';
import type { IncomingMessage } from 'http';
import { getRoutePattern } from '../otel/route-patterns';

const rawFlag = String(process.env.DD_ENABLED || '').toLowerCase();
const isEnabled = rawFlag === 'true' || rawFlag === '1';

process.env.DD_TRACE_ENABLED = isEnabled ? '1' : '0';

let tracer: Tracer | null = null;

if (isEnabled) {
  const serviceName = process.env.DD_SERVICE || 'securebuild-app';
  const environment = process.env.DD_ENV || process.env.NODE_ENV || 'development';
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

    // Disable low-level network instrumentation for localhost connections
    tracer.use('dns', false);
    tracer.use('net', false);
    // Configure http plugin to normalize route patterns
    tracer.use('http', {
      server: {
        hooks: {
          request: (span?: Span, req?: IncomingMessage) => {
            if (!span) return;

            const url = req?.url || '';
            const method = req?.method || 'GET';
            const path = url.split('?')[0];

            // Drop Next.js internal requests
            if (path.startsWith('/_next/')) {
              // @ts-expect-error - using internal property to drop the trace
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

export default tracer;

