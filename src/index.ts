/**
 * aiobs - AI Observability SDK for TypeScript
 *
 * This SDK uses OpenTelemetry underneath for trace context propagation
 * and provider instrumentation, while maintaining a simple API.
 *
 * Usage (global singleton):
 *
 *   import { observer } from 'aiobs';
 *   import OpenAI from 'openai';
 *
 *   const openai = new OpenAI();
 *
 *   await observer.observe();
 *   // ... make LLM calls (automatically instrumented via OTel) ...
 *   observer.end();
 *   await observer.flush();
 *
 * Function tracing with observe:
 *
 *   import { observe } from 'aiobs';
 *
 *   const myFunc = observe(function myFunc() { ... });
 *   const myAsyncFunc = observe(async function myAsyncFunc() { ... });
 *
 * Gemini support:
 *
 *   import { wrapGeminiClient, observer } from 'aiobs';
 *   import { GoogleGenAI } from '@google/genai';
 *
 *   const client = wrapGeminiClient(new GoogleGenAI(), observer);
 *
 * Export to cloud storage:
 *
 *   import { observer } from 'aiobs';
 *   import { GCSExporter } from 'aiobs/exporters';
 *
 *   const exporter = new GCSExporter({
 *     bucket: 'my-observability-bucket',
 *     prefix: 'traces/',
 *   });
 *   await observer.flush({ exporter });
 */

import { Collector } from './collector.js';
import { setObserver } from './observe.js';

// Export types from models
export type {
  Session,
  SessionMeta,
  Event,
  FunctionEvent,
  ObservedEvent,
  ObservedFunctionEvent,
  ObservabilityExport,
  Callsite,
  TraceNode,
} from './models/observability.js';

export type {
  BaseProvider,
} from './providers/base.js';

// OpenAI types
export type {
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  Message,
  BaseOpenAIRequest,
  BaseOpenAIResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  EmbeddingData,
} from './providers/openai/models/index.js';

// Gemini types
export type {
  BaseGeminiRequest,
  BaseGeminiResponse,
  GenerateContentRequest,
  GenerateContentResponse,
  GenerateVideosRequest,
  GenerateVideosResponse,
} from './providers/gemini/models/index.js';

// Collector types
export type {
  ObserveOptions as CollectorObserveOptions,
  FlushOptions,
  UsageInfo,
} from './collector.js';

export type {
  ObserveOptions,
} from './observe.js';

// Exporter types and classes
export type { ExportResult, ExportError } from './exporters/base.js';
export { BaseExporter } from './exporters/base.js';
export { GCSExporter } from './exporters/gcs.js';
export { CustomExporter, CompositeExporter } from './exporters/custom.js';

// Export classes and functions
export { Collector } from './collector.js';
export { observe, withObserve, setObserver } from './observe.js';

// Tracer utilities (for advanced usage)
export {
  initTracer,
  getTracer,
  getFinishedSpans,
  clearSpans,
  resetTracer,
  isInitialized,
} from './tracer.js';

// Provider wrappers
export { wrapOpenAIClient, wrapEmbeddingsResource } from './providers/openai/index.js';
export { wrapGeminiClient, wrapGenerateContentResource, wrapGenerateVideosResource } from './providers/gemini/index.js';

// Global collector singleton
export const observer = new Collector();

// Initialize the global observer for the observe decorator
setObserver(observer);
