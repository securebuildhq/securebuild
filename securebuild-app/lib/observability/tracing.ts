/**
 * Vendor-agnostic tracing facade.
 *
 * Internally uses @opentelemetry/api, which:
 *  - is satisfied by @opentelemetry/sdk-node when TELEMETRY_BACKEND=otlp
 *  - is satisfied by dd-trace's built-in OTel API interop when TELEMETRY_BACKEND=datadog
 *  - falls back to the built-in no-op tracer when TELEMETRY_BACKEND=none
 *
 * All exported signatures (getActiveSpan, withTrace, traceServerAction, traceFunction)
 * remain identical to the previous dd-trace-based implementation so existing
 * call sites in server action files require no changes.
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';

// Re-export Span so callers that type-reference it can import from this module.
export type { Span };

type Tags = Record<string, unknown>;

type TraceOptions = {
  resource?: string;
  tags?: Tags;
};

type TraceActionOptions<T extends (...args: any[]) => any> = TraceOptions & {
  getTags?: (...args: Parameters<T>) => Tags | undefined;
  onResult?: (span: Span, args: Parameters<T>, result: Awaited<ReturnType<T>>) => void;
};

// Type for a function that has been wrapped with tracing (always returns a Promise)
type TracedFunction<T extends (...args: any[]) => any> = (
  ...args: Parameters<T>
) => Promise<Awaited<ReturnType<T>>>;

/** Instrument name used when requesting a Tracer from the OTel API. */
const TRACER_NAME = 'securebuild-app';

function getOtelTracer() {
  return trace.getTracer(TRACER_NAME);
}

function applyTags(span: Span | undefined, tags?: Tags) {
  if (!span || !tags) return;
  for (const [key, value] of Object.entries(tags)) {
    // OTel attribute values must be primitive or arrays of primitives
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      span.setAttribute(key, value);
    } else if (value !== null && value !== undefined) {
      span.setAttribute(key, String(value));
    }
  }
}

/**
 * Get the currently active span from the OTel context.
 * Returns undefined when no span is active (including no-op tracer path).
 */
export function getActiveSpan(): Span | undefined {
  const span = trace.getActiveSpan();
  return span ?? undefined;
}

export async function withTrace<T>(
  name: string,
  fn: (span?: Span) => Promise<T> | T,
  options?: TraceOptions,
): Promise<T> {
  const otelTracer = getOtelTracer();

  return otelTracer.startActiveSpan(name, async (span: Span) => {
    // Set resource/route as a span attribute (OTel equivalent of dd resource.name)
    if (options?.resource) {
      span.setAttribute('resource.name', options.resource);
    }
    span.setAttribute('component', 'application');
    applyTags(span, options?.tags);

    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.end();
      throw error;
    }
  });
}

export function traceServerAction<T extends (...args: any[]) => any>(
  name: string,
  fn: T,
  options?: TraceActionOptions<T>,
): TracedFunction<T>;

export function traceServerAction<T extends (...args: any[]) => any>(
  fn: T,
  options?: TraceActionOptions<T>,
): TracedFunction<T>;

export function traceServerAction<T extends (...args: any[]) => any>(
  nameOrFn: string | T,
  fnOrOptions?: T | TraceActionOptions<T>,
  maybeOptions?: TraceActionOptions<T>,
): TracedFunction<T> {
  let name: string;
  let fn: T;
  let options: TraceActionOptions<T> | undefined;

  if (typeof nameOrFn === 'string') {
    name = nameOrFn;
    fn = fnOrOptions as T;
    options = maybeOptions;
  } else {
    fn = nameOrFn;
    options = fnOrOptions as TraceActionOptions<T> | undefined;
    name = fn.name || 'anonymous';
  }

  const spanName = name.startsWith('server.action.') ? name : `server.action.${name}`;

  const traced: TracedFunction<T> = async (...args: Parameters<T>) => {
    const baseTags = options?.getTags?.(...args);
    return withTrace(
      spanName,
      async (span) => {
        if (span) {
          span.setAttribute('component', 'server-action');
          applyTags(span, baseTags);
        }
        const result = await fn(...args);
        if (span && options?.onResult) {
          options.onResult(span, args, result as Awaited<ReturnType<T>>);
        }
        return result;
      },
      { resource: options?.resource },
    );
  };

  return traced;
}

export function traceFunction<T extends (...args: any[]) => any>(
  name: string,
  fn: T,
  options?: TraceActionOptions<T>,
): TracedFunction<T> {
  const traced: TracedFunction<T> = async (...args: Parameters<T>) => {
    const baseTags = options?.getTags?.(...args);
    return withTrace(
      name,
      async (span) => {
        applyTags(span, baseTags);
        const result = await fn(...args);
        if (span && options?.onResult) {
          options.onResult(span, args, result as Awaited<ReturnType<T>>);
        }
        return result;
      },
      options,
    );
  };

  return traced;
}
