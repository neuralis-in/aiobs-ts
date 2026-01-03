/**
 * OpenTelemetry tracer configuration for aiobs.
 *
 * This module provides centralized OTel tracer initialization with in-memory
 * exporters for collecting spans and logs that will be converted to aiobs format on flush.
 */

import { trace, Tracer, context } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';

// Enable GenAI message content capture by default
// This allows OTel instrumentors to capture full prompt/completion content
if (!process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT) {
  process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = 'true';
}

// Global singleton provider and exporter - survives resets for context propagation
let provider: BasicTracerProvider | null = null;
let exporter: InMemorySpanExporter | null = null;
let contextManager: AsyncHooksContextManager | null = null;
let initialized = false;

/**
 * Initialize the OTel tracer with in-memory exporters.
 *
 * This should be called once when observer.observe() is invoked.
 * Subsequent calls are no-ops.
 */
export function initTracer(): void {
  if (initialized) {
    return;
  }

  // Set up async context manager for proper context propagation
  if (!contextManager) {
    contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
  }

  // Set up tracing - reuse existing provider if available
  if (!provider) {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();
  } else if (!exporter) {
    // Provider exists but exporter was cleared - create a new exporter
    exporter = new InMemorySpanExporter();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  }

  initialized = true;
}

/**
 * Get the aiobs tracer.
 *
 * @returns The OpenTelemetry Tracer for aiobs instrumentation.
 */
export function getTracer(): Tracer {
  return trace.getTracer('aiobs', '0.1.0');
}

/**
 * Get all finished spans from the in-memory exporter.
 *
 * @returns List of finished ReadableSpan objects.
 */
export function getFinishedSpans(): ReadableSpan[] {
  if (exporter === null) {
    return [];
  }
  return [...exporter.getFinishedSpans()];
}

/**
 * Clear all collected spans from the exporter.
 */
export function clearSpans(): void {
  if (exporter !== null) {
    exporter.reset();
  }
}

/**
 * Reset tracer state for testing.
 *
 * This clears spans and resets the initialization flag, but keeps
 * the provider alive for context propagation to work correctly.
 */
export function resetTracer(): void {
  if (exporter !== null) {
    exporter.reset();
  }
  initialized = false;
}

/**
 * Check if the tracer has been initialized.
 *
 * @returns True if initTracer() has been called, False otherwise.
 */
export function isInitialized(): boolean {
  return initialized;
}

// Re-export types for convenience
export type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
