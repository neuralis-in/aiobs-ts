/**
 * @observe decorator for tracing function execution using OpenTelemetry.
 *
 * Usage:
 *   // Wrap a function
 *   const myFunc = observe(function myFunc() { ... });
 *
 *   // With options
 *   const myFunc = observe(function myFunc() { ... }, { name: 'custom_name' });
 *
 *   // Or use the factory pattern
 *   const traced = withObserve({ name: 'myOperation' });
 *   const myFunc = traced(async () => { ... });
 */

import { randomUUID } from 'crypto';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { Collector } from './collector.js';
import type { FunctionEvent, Callsite } from './models/observability.js';
import { getTracer, initTracer, isInitialized } from './tracer.js';

/**
 * Get the current parent span ID from OTel context.
 */
function getCurrentParentSpanId(): string | null {
  try {
    const currentSpan = trace.getSpan(context.active());
    if (currentSpan) {
      const ctx = currentSpan.spanContext();
      if (ctx && ctx.spanId) {
        return ctx.spanId;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// Reference to the global observer (set via setObserver)
let globalObserver: Collector | null = null;

/**
 * Set the global observer instance for the observe decorator.
 */
export function setObserver(observer: Collector): void {
  globalObserver = observer;
}

/**
 * Get callsite information from the call stack.
 */
function getCallsite(skipFrames = 2): Callsite | null {
  try {
    const error = new Error();
    const stack = error.stack?.split('\n') ?? [];

    for (let i = skipFrames; i < stack.length; i++) {
      const line = stack[i];
      // Skip internal aiobs frames
      if (line.includes('/aiobs-ts/src/') || line.includes('/aiobs-ts/dist/')) {
        continue;
      }

      // Parse stack frame
      const match = line.match(/at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?/);
      if (match) {
        const [, fnName, file, lineNum] = match;
        return {
          file: file ?? null,
          line: lineNum ? parseInt(lineNum, 10) : null,
          function: fnName ?? null,
        };
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Safely serialize an object for storage.
 */
function safeRepr(obj: unknown, maxLength = 500, depth = 0): unknown {
  // Prevent deep recursion
  if (depth > 3) {
    return '<nested>';
  }

  try {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (typeof obj === 'boolean' || typeof obj === 'number') {
      return obj;
    }
    if (typeof obj === 'string') {
      return obj.length > maxLength ? obj.slice(0, maxLength) + '...' : obj;
    }
    if (typeof obj === 'function') {
      return `<function ${obj.name || 'anonymous'}>`;
    }
    if (Array.isArray(obj)) {
      return obj.slice(0, 10).map((item) => safeRepr(item, maxLength, depth + 1));
    }
    if (typeof obj === 'object') {
      // Skip complex objects like API clients, Promises, etc.
      const constructorName = obj.constructor?.name;
      if (constructorName && constructorName !== 'Object' && constructorName !== 'Array') {
        // Check if it's an API client or similar complex object
        if (
          constructorName.includes('Client') ||
          constructorName.includes('OpenAI') ||
          constructorName.includes('Anthropic') ||
          constructorName.includes('Google') ||
          constructorName === 'Promise'
        ) {
          return `<${constructorName}>`;
        }
      }

      // For plain objects, serialize safely
      const entries = Object.entries(obj).slice(0, 20);
      return Object.fromEntries(
        entries.map(([k, v]) => [String(k).slice(0, 100), safeRepr(v, maxLength, depth + 1)])
      );
    }
    const s = String(obj);
    return s.length > maxLength ? s.slice(0, maxLength) + '...' : s;
  } catch {
    return `<${typeof obj}>`;
  }
}

export interface ObserveOptions {
  /** Custom name for the traced function */
  name?: string;
  /** Whether to capture function arguments (default: true) */
  captureArgs?: boolean;
  /** Whether to capture the return value (default: true) */
  captureResult?: boolean;
  /** Whether to include this trace in enh_prompt_traces (default: false) */
  enhPrompt?: boolean;
  /** Number of traces after which to run auto prompt enhancer */
  autoEnhanceAfter?: number;
}

/**
 * Wrap a function with observability tracing using OpenTelemetry.
 */
export function observe<T extends (...args: unknown[]) => unknown>(
  fn: T,
  options: ObserveOptions = {}
): T {
  const {
    name = fn.name || 'anonymous',
    captureArgs = true,
    captureResult = true,
    enhPrompt = false,
    autoEnhanceAfter,
  } = options;

  // Determine if the function is async
  const isAsync = fn.constructor.name === 'AsyncFunction';

  if (isAsync) {
    const asyncWrapper = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const observer = globalObserver;
      if (!observer) {
        return (fn as (...args: unknown[]) => Promise<unknown>).apply(this, args);
      }

      // Initialize tracer if not already done
      if (!isInitialized()) {
        initTracer();
      }

      const tracer = getTracer();
      const callsite = getCallsite(3);
      let errorMsg: string | null = null;
      let result: unknown = null;

      // Get parent span ID BEFORE starting the new span
      const parentSpanId = getCurrentParentSpanId();

      // Capture args if enabled
      let capturedArgs: unknown[] | null = null;
      if (captureArgs) {
        try {
          capturedArgs = args.map((a) => safeRepr(a));
        } catch {
          // Ignore
        }
      }

      // Use OTel span for tracing
      return tracer.startActiveSpan(name, async (span) => {
        const started = Date.now() / 1000;

        // Get span IDs from OTel (span_id and trace_id from the new span)
        const ctx = span.spanContext();
        const spanId = ctx?.spanId ?? randomUUID();
        const traceId = ctx?.traceId ?? null;

        try {
          result = await (fn as (...args: unknown[]) => Promise<unknown>).apply(this, args);
          return result;
        } catch (e) {
          const err = e as Error;
          errorMsg = `${err.name}: ${err.message}`;
          // Record exception on OTel span
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message: errorMsg });
          throw e;
        } finally {
          const ended = Date.now() / 1000;
          span.end();

          // Capture result if enabled
          let capturedResult: unknown = null;
          if (captureResult && errorMsg === null) {
            try {
              capturedResult = safeRepr(result);
            } catch {
              // Ignore
            }
          }

          const enhPromptId = enhPrompt ? randomUUID() : null;

          const event: FunctionEvent = {
            provider: 'function',
            api: name,
            name,
            module: null,
            args: capturedArgs,
            kwargs: null,
            result: capturedResult,
            error: errorMsg,
            started_at: started,
            ended_at: ended,
            duration_ms: Math.round((ended - started) * 1000 * 1000) / 1000,
            callsite,
            span_id: spanId,
            parent_span_id: parentSpanId,
            trace_id: traceId,
            enh_prompt: enhPrompt,
            enh_prompt_id: enhPromptId,
            auto_enhance_after: autoEnhanceAfter ?? null,
          };

          observer.recordEvent(event);
        }
      });
    };

    Object.defineProperty(asyncWrapper, 'name', { value: name });
    return asyncWrapper as unknown as T;
  } else {
    const syncWrapper = function (this: unknown, ...args: unknown[]): unknown {
      const observer = globalObserver;
      if (!observer) {
        return fn.apply(this, args);
      }

      // Initialize tracer if not already done
      if (!isInitialized()) {
        initTracer();
      }

      const tracer = getTracer();
      const callsite = getCallsite(3);

      // Get parent span ID BEFORE starting the new span
      const parentSpanId = getCurrentParentSpanId();

      // Capture args if enabled
      let capturedArgs: unknown[] | null = null;
      if (captureArgs) {
        try {
          capturedArgs = args.map((a) => safeRepr(a));
        } catch {
          // Ignore
        }
      }

      // Use OTel span for tracing with context propagation
      return tracer.startActiveSpan(name, (span) => {
        const started = Date.now() / 1000;

        // Get span IDs from OTel (span_id and trace_id from the new span)
        const ctx = span.spanContext();
        const spanId = ctx?.spanId ?? randomUUID();
        const traceId = ctx?.traceId ?? null;

        let errorMsg: string | null = null;
        let result: unknown = null;

        try {
          result = fn.apply(this, args);
          return result;
        } catch (e) {
          const err = e as Error;
          errorMsg = `${err.name}: ${err.message}`;
          // Record exception on OTel span
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message: errorMsg });
          throw e;
        } finally {
          const ended = Date.now() / 1000;
          span.end();

          // Capture result if enabled
          let capturedResult: unknown = null;
          if (captureResult && errorMsg === null) {
            try {
              capturedResult = safeRepr(result);
            } catch {
              // Ignore
            }
          }

          const enhPromptId = enhPrompt ? randomUUID() : null;

          const event: FunctionEvent = {
            provider: 'function',
            api: name,
            name,
            module: null,
            args: capturedArgs,
            kwargs: null,
            result: capturedResult,
            error: errorMsg,
            started_at: started,
            ended_at: ended,
            duration_ms: Math.round((ended - started) * 1000 * 1000) / 1000,
            callsite,
            span_id: spanId,
            parent_span_id: parentSpanId,
            trace_id: traceId,
            enh_prompt: enhPrompt,
            enh_prompt_id: enhPromptId,
            auto_enhance_after: autoEnhanceAfter ?? null,
          };

          observer.recordEvent(event);
        }
      });
    };

    Object.defineProperty(syncWrapper, 'name', { value: name });
    return syncWrapper as unknown as T;
  }
}

/**
 * Factory function to create a tracing wrapper with options.
 *
 * Usage:
 *   const traced = withObserve({ name: 'myOperation' });
 *   const myFunc = traced(async (x: number) => x * 2);
 */
export function withObserve(options: ObserveOptions = {}) {
  return <T extends (...args: unknown[]) => unknown>(fn: T): T => observe(fn, options);
}
