import type { Span, Tracer } from 'dd-trace';

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

function applyTags(span?: Span, tags?: Tags) {
  if (!span || !tags) return;
  for (const [key, value] of Object.entries(tags)) {
    span.setTag(key, value as any);
  }
}

// Lazy-load tracer only when tracing is enabled
// Using undefined to distinguish between "not loaded yet" and "loaded but null"
let tracerCache: Tracer | null | undefined = undefined;

function getTracer(): Tracer | null {
  // Return cached result if already loaded (prevents race conditions and multiple initializations)
  if (tracerCache !== undefined) {
    return tracerCache;
  }

  // Check if tracing is enabled at runtime (consistent with datadog/tracer.ts and instrumentation.ts)
  const rawFlag = String(process.env.DD_ENABLED || '').toLowerCase();
  const isEnabled = rawFlag === 'true' || rawFlag === '1';

  if (!isEnabled) {
    tracerCache = null;
    return null;
  }

  // Lazy load the tracer module only when needed
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracerModule = require('@/datadog/tracer');
    const tracer = tracerModule.default || tracerModule;

    if (tracer && typeof (tracer as any).trace === 'function') {
      tracerCache = tracer as Tracer;
      return tracerCache;
    }
  } catch (err) {
    console.warn('Failed to load tracer:', err);
  }

  tracerCache = null;
  return null;
}

/**
 * Get the currently active span from the tracer's scope.
 * This can be used to pass span context to database calls.
 */
export function getActiveSpan(): Span | undefined {
  const activeTracer = getTracer();
  if (!activeTracer || !activeTracer.scope) {
    return undefined;
  }
  const active = activeTracer.scope().active();
  return active || undefined;
}

export async function withTrace<T>(
  name: string,
  fn: (span?: Span) => Promise<T> | T,
  options?: TraceOptions,
): Promise<T> {
  const activeTracer = getTracer();
  if (!activeTracer) {
    return fn(undefined);
  }

  return activeTracer.trace(name, { resource: options?.resource }, async (span?: Span) => {
    if (span) {
      span.setTag('component', 'application');
      applyTags(span, options?.tags);
    }
    try {
      const result = await fn(span);
      return result;
    } catch (error) {
      if (span) {
        span.setTag('error', error as any);
      }
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
    return withTrace(spanName, async (span) => {
      if (span) {
        span.setTag('component', 'server-action');
      }
      applyTags(span, baseTags);
      const result = await fn(...args);
      if (span && options?.onResult) {
        options.onResult(span, args, result as Awaited<ReturnType<T>>);
      }
      return result;
    }, { resource: options?.resource });
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
    return withTrace(name, async (span) => {
      applyTags(span, baseTags);
      const result = await fn(...args);
      if (span && options?.onResult) {
        options.onResult(span, args, result as Awaited<ReturnType<T>>);
      }
      return result;
    }, options);
  };

  return traced;
}
