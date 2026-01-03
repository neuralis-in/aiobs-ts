/**
 * OpenAI Embeddings API instrumentation.
 * 
 * Uses Proxy to wrap the OpenAI client and intercept embeddings.create calls.
 */

import { randomUUID } from 'crypto';
import type { Collector } from '../../collector.js';
import type { Event, Callsite } from '../../models/observability.js';
import type { EmbeddingsRequest, EmbeddingsResponse, EmbeddingData } from './models/embeddings.js';

/**
 * Get callsite information from the call stack.
 */
function getCallsite(): Callsite | null {
  try {
    const error = new Error();
    const stack = error.stack?.split('\n') ?? [];
    
    // Skip first few frames (Error, getCallsite, wrapper function, etc.)
    for (let i = 3; i < stack.length; i++) {
      const line = stack[i];
      // Skip internal aiobs and openai frames
      if (line.includes('/aiobs-ts/') || line.includes('/openai/') || line.includes('node_modules')) {
        continue;
      }
      
      // Parse stack frame: "    at functionName (file:line:column)"
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
    // Ignore errors in callsite extraction
  }
  return null;
}

/**
 * Extract request data from embeddings call arguments.
 */
function extractRequest(args: unknown): EmbeddingsRequest {
  const req = (args ?? {}) as Record<string, unknown>;
  
  // Extract input - could be string, list of strings, or token arrays
  let inputData = req.input as string | string[] | number[] | number[][] | null;
  
  // Truncate input preview for large inputs
  if (Array.isArray(inputData) && inputData.length > 3) {
    inputData = inputData.slice(0, 3) as string[] | number[] | number[][];
  }
  
  return {
    model: typeof req.model === 'string' ? req.model : null,
    input: inputData,
    encoding_format: typeof req.encoding_format === 'string' ? req.encoding_format : null,
    dimensions: typeof req.dimensions === 'number' ? req.dimensions : null,
    user: typeof req.user === 'string' ? req.user : null,
    other: Object.fromEntries(
      Object.entries(req).filter(([k]) => !['model', 'input', 'encoding_format', 'dimensions', 'user'].includes(k))
    ),
  };
}

/**
 * Extract response data from embeddings response.
 */
function extractResponse(resp: unknown): EmbeddingsResponse {
  const r = resp as Record<string, unknown>;
  
  let data: EmbeddingData[] | null = null;
  let embeddingDims: number | null = null;
  
  try {
    const rawData = r.data as Array<{ index?: number; embedding?: number[]; object?: string }> | undefined;
    if (rawData && Array.isArray(rawData)) {
      data = [];
      for (const item of rawData) {
        const emb = item.embedding ?? [];
        if (embeddingDims === null && emb.length > 0) {
          embeddingDims = emb.length;
        }
        data.push({
          index: item.index ?? 0,
          embedding: emb,
          object: item.object ?? 'embedding',
        });
      }
    }
  } catch {
    // Ignore extraction errors
  }
  
  let usage: Record<string, unknown> | null = null;
  if (r.usage && typeof r.usage === 'object') {
    usage = r.usage as Record<string, unknown>;
  }
  
  return {
    id: typeof r.id === 'string' ? r.id : null,
    model: typeof r.model === 'string' ? r.model : null,
    object: typeof r.object === 'string' ? r.object : null,
    data,
    usage,
    embedding_dimensions: embeddingDims,
  };
}

/**
 * Wrap the embeddings resource to intercept create calls.
 */
export function wrapEmbeddingsResource<T extends object>(embeddings: T, collector: Collector): T {
  return new Proxy(embeddings, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Intercept create method
      if (prop === 'create' && typeof value === 'function') {
        return createWrappedEmbeddingsCreate(value.bind(target), collector);
      }
      
      return value;
    },
  });
}

/**
 * Create a wrapped version of the embeddings create method.
 */
function createWrappedEmbeddingsCreate(
  originalCreate: (...args: unknown[]) => Promise<unknown>,
  collector: Collector
): (...args: unknown[]) => Promise<unknown> {
  return async function wrappedCreate(...args: unknown[]): Promise<unknown> {
    const spanId = randomUUID();
    const parentSpanId = collector.getCurrentSpanId();
    const started = Date.now() / 1000;
    const callsite = getCallsite();
    const requestInfo = extractRequest(args[0]);
    
    let error: string | null = null;
    let responseInfo: EmbeddingsResponse | null = null;
    
    try {
      const resp = await originalCreate(...args);
      responseInfo = extractResponse(resp);
      return resp;
    } catch (e) {
      const err = e as Error;
      error = `${err.name}: ${err.message}`;
      throw e;
    } finally {
      const ended = Date.now() / 1000;
      
      const event: Event = {
        provider: 'openai',
        api: 'embeddings.create',
        callsite,
        request: requestInfo,
        response: responseInfo,
        error,
        started_at: started,
        ended_at: ended,
        duration_ms: Math.round((ended - started) * 1000 * 1000) / 1000,
        span_id: spanId,
        parent_span_id: parentSpanId,
        trace_id: null,
      };
      
      collector.recordEvent(event);
    }
  };
}

