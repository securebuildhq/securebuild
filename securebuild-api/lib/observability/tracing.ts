import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';

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

function applyTags(span?: Span, tags?: Tags) {
  if (!span || !tags) return;
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      span.setAttribute(key, value);
    } else if (value !== null && value !== undefined) {
      span.setAttribute(key, String(value));
    }
  }
}

/**
 * Get the currently active span from the tracer's scope.
 * This can be used to pass span context to database calls.
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

export async function withTrace<T>(
  name: string,
  fn: (span?: Span) => Promise<T> | T,
  options?: TraceOptions,
): Promise<T> {
  return trace.getTracer('securebuild-api').startActiveSpan(name, async (span: Span) => {
    span.setAttribute('component', 'application');
    if (options?.resource) span.setAttribute('resource.name', options.resource);
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
    return withTrace(spanName, async (span) => {
      if (span) {
        span.setAttribute('component', 'server-action');
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
