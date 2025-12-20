/**
 * Gemini generate_content API instrumentation.
 * 
 * Uses Proxy to wrap the Gemini client and intercept models.generateContent calls.
 */

import { randomUUID } from 'crypto';
import type { Collector } from '../../collector.js';
import type { Event, Callsite } from '../../models/observability.js';
import type { GenerateContentRequest, GenerateContentResponse, Content, UsageMetadata, Candidate, ResponsePart, CandidateContent } from './models/index.js';
import { createWrappedGenerateVideos } from './generate-videos.js';

/**
 * Get callsite information from the call stack.
 */
function getCallsite(): Callsite | null {
  try {
    const error = new Error();
    const stack = error.stack?.split('\n') ?? [];
    
    for (let i = 3; i < stack.length; i++) {
      const line = stack[i];
      // Skip internal aiobs, google, node internals, and node_modules frames
      if (
        line.includes('/aiobs-ts/src/') ||
        line.includes('/aiobs-ts/dist/') ||
        line.includes('/google/') ||
        line.includes('node_modules') ||
        line.includes('node:internal') ||
        line.includes('node:async_hooks')
      ) {
        continue;
      }
      
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
 * Extract request data from generateContent call arguments.
 * 
 * Handles multiple input formats:
 * - String: simple text prompt
 * - Object with contents: structured request
 * - Array: direct contents array
 */
function extractRequest(args: unknown): GenerateContentRequest {
  // Handle string input (VertexAI simple format)
  if (typeof args === 'string') {
    return {
      model: null,
      contents: args,
      system_instruction: null,
      config: null,
      other: {},
    };
  }
  
  // Handle array input (direct contents array)
  if (Array.isArray(args)) {
    return {
      model: null,
      contents: extractContents(args),
      system_instruction: null,
      config: null,
      other: {},
    };
  }
  
  const req = (args ?? {}) as Record<string, unknown>;
  
  const model = typeof req.model === 'string' ? req.model : null;
  let contents: string | Content[] | unknown | null = null;
  
  // Simplify contents for storage
  if (req.contents !== undefined) {
    contents = extractContents(req.contents);
  }
  
  let config: Record<string, unknown> | null = null;
  if (req.config && typeof req.config === 'object') {
    config = req.config as Record<string, unknown>;
  }
  // Also check generationConfig (VertexAI format)
  if (req.generationConfig && typeof req.generationConfig === 'object') {
    config = req.generationConfig as Record<string, unknown>;
  }
  
  return {
    model,
    contents,
    system_instruction: req.system_instruction ?? req.systemInstruction ?? null,
    config,
    other: Object.fromEntries(
      Object.entries(req).filter(([k]) => !['model', 'contents', 'system_instruction', 'systemInstruction', 'config', 'generationConfig'].includes(k))
    ),
  };
}

/**
 * Extract contents from various formats.
 */
function extractContents(contents: unknown): string | Content[] | unknown {
  if (typeof contents === 'string') {
    return contents;
  }
  
  if (Array.isArray(contents)) {
    // Truncate to first 3 items for preview
    const preview = (contents as unknown[]).slice(0, 3);
    return preview.map((item) => {
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        return {
          role: obj.role ?? null,
          parts: obj.parts ?? null,
        };
      }
      return String(item);
    });
  }
  
  return String(contents);
}

/**
 * Convert camelCase to snake_case.
 */
function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/**
 * Convert object keys from camelCase to snake_case recursively.
 */
function convertKeysToSnakeCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(convertKeysToSnakeCase);
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const snakeKey = toSnakeCase(key);
      result[snakeKey] = convertKeysToSnakeCase(value);
    }
    return result;
  }
  
  return obj;
}

/**
 * Normalize usage metadata to include all expected fields.
 */
function normalizeUsage(usage: Record<string, unknown> | null): UsageMetadata | null {
  if (!usage) {
    return null;
  }
  
  // Convert to snake_case first
  const converted = convertKeysToSnakeCase(usage) as Record<string, unknown>;
  
  return {
    cache_tokens_details: converted.cache_tokens_details ?? null,
    cached_content_token_count: typeof converted.cached_content_token_count === 'number' ? converted.cached_content_token_count : null,
    candidates_token_count: typeof converted.candidates_token_count === 'number' ? converted.candidates_token_count : null,
    candidates_tokens_details: Array.isArray(converted.candidates_tokens_details) ? converted.candidates_tokens_details as Array<Record<string, unknown>> : null,
    prompt_token_count: typeof converted.prompt_token_count === 'number' ? converted.prompt_token_count : null,
    prompt_tokens_details: Array.isArray(converted.prompt_tokens_details) ? converted.prompt_tokens_details as Array<Record<string, unknown>> : null,
    thoughts_token_count: typeof converted.thoughts_token_count === 'number' ? converted.thoughts_token_count : null,
    tool_use_prompt_token_count: typeof converted.tool_use_prompt_token_count === 'number' ? converted.tool_use_prompt_token_count : null,
    tool_use_prompt_tokens_details: Array.isArray(converted.tool_use_prompt_tokens_details) ? converted.tool_use_prompt_tokens_details as Array<Record<string, unknown>> : null,
    total_token_count: typeof converted.total_token_count === 'number' ? converted.total_token_count : null,
    traffic_type: typeof converted.traffic_type === 'string' ? converted.traffic_type : null,
  };
}

/**
 * Normalize a part to include all expected fields.
 */
function normalizePart(part: Record<string, unknown>): ResponsePart {
  const converted = convertKeysToSnakeCase(part) as Record<string, unknown>;
  
  return {
    media_resolution: converted.media_resolution ?? null,
    code_execution_result: converted.code_execution_result ?? null,
    executable_code: converted.executable_code ?? null,
    file_data: converted.file_data ?? null,
    function_call: converted.function_call ?? null,
    function_response: converted.function_response ?? null,
    inline_data: converted.inline_data ?? null,
    text: typeof converted.text === 'string' ? converted.text : null,
    thought: converted.thought ?? null,
    thought_signature: converted.thought_signature ?? null,
    video_metadata: converted.video_metadata ?? null,
  };
}

/**
 * Normalize content to include all expected fields.
 */
function normalizeContent(content: Record<string, unknown>): CandidateContent {
  const parts = content.parts;
  let normalizedParts: ResponsePart[] | null = null;
  
  if (Array.isArray(parts)) {
    normalizedParts = parts.map((part) => normalizePart(part as Record<string, unknown>));
  }
  
  return {
    parts: normalizedParts,
    role: typeof content.role === 'string' ? content.role : null,
  };
}

/**
 * Normalize a candidate to include all expected fields.
 */
function normalizeCandidate(candidate: Record<string, unknown>): Candidate {
  const converted = convertKeysToSnakeCase(candidate) as Record<string, unknown>;
  
  let content: CandidateContent | null = null;
  if (converted.content && typeof converted.content === 'object') {
    content = normalizeContent(converted.content as Record<string, unknown>);
  }
  
  return {
    content,
    citation_metadata: converted.citation_metadata ?? null,
    finish_message: typeof converted.finish_message === 'string' ? converted.finish_message : null,
    token_count: typeof converted.token_count === 'number' ? converted.token_count : null,
    finish_reason: typeof converted.finish_reason === 'string' ? converted.finish_reason : null,
    avg_logprobs: typeof converted.avg_logprobs === 'number' ? converted.avg_logprobs : null,
    grounding_metadata: converted.grounding_metadata ?? null,
    index: typeof converted.index === 'number' ? converted.index : null,
    logprobs_result: converted.logprobs_result ?? null,
    safety_ratings: converted.safety_ratings ?? null,
    url_context_metadata: converted.url_context_metadata ?? null,
  };
}

/**
 * Extract response data from generateContent response.
 * 
 * Handles both:
 * - @google/genai direct response
 * - @google-cloud/vertexai wrapped response { response: GenerateContentResponse }
 */
function extractResponse(resp: unknown): GenerateContentResponse {
  let r = resp as Record<string, unknown>;
  
  // VertexAI wraps the response in { response: ... }
  if (r.response && typeof r.response === 'object') {
    r = r.response as Record<string, unknown>;
  }
  
  let text: string | null = null;
  let candidates: Candidate[] | null = null;
  let usage: UsageMetadata | null = null;
  
  // Extract text from response
  try {
    if (typeof r.text === 'string') {
      text = r.text;
    } else if (Array.isArray(r.candidates) && r.candidates.length > 0) {
      const firstCandidate = r.candidates[0] as Record<string, unknown>;
      const content = firstCandidate.content as Record<string, unknown> | undefined;
      if (content && Array.isArray(content.parts) && content.parts.length > 0) {
        const firstPart = content.parts[0] as Record<string, unknown>;
        if (typeof firstPart.text === 'string') {
          text = firstPart.text;
        }
      }
    }
  } catch {
    // Ignore extraction errors
  }
  
  // Extract and normalize candidates
  try {
    if (Array.isArray(r.candidates)) {
      candidates = r.candidates.map((c) => normalizeCandidate(c as Record<string, unknown>));
    }
  } catch {
    // Ignore
  }
  
  // Extract and normalize usage metadata (both naming conventions)
  try {
    const usageMeta = r.usage_metadata ?? r.usageMetadata;
    if (usageMeta && typeof usageMeta === 'object') {
      usage = normalizeUsage(usageMeta as Record<string, unknown>);
    }
  } catch {
    // Ignore
  }
  
  // Return with proper field order: model, usage, text, candidates
  return {
    model: typeof r.model === 'string' ? r.model : null,
    usage,
    text,
    candidates,
  };
}

/**
 * Wrap the Gemini models resource to intercept generateContent calls.
 */
export function wrapGenerateContentResource<T extends object>(models: T, collector: Collector): T {
  return new Proxy(models, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Intercept generateContent method
      if (prop === 'generateContent' && typeof value === 'function') {
        return createWrappedGenerateContent(value.bind(target), collector);
      }
      
      return value;
    },
  });
}

/**
 * Create a wrapped version of the generateContent method.
 */
function createWrappedGenerateContent(
  originalGenerateContent: (...args: unknown[]) => Promise<unknown>,
  collector: Collector
): (...args: unknown[]) => Promise<unknown> {
  return createWrappedGenerateContentWithModel(originalGenerateContent, collector, null);
}

/**
 * Create a wrapped version of the generateContent method with model name.
 */
function createWrappedGenerateContentWithModel(
  originalGenerateContent: (...args: unknown[]) => Promise<unknown>,
  collector: Collector,
  modelName: string | null
): (...args: unknown[]) => Promise<unknown> {
  return async function wrappedGenerateContent(...args: unknown[]): Promise<unknown> {
    const spanId = randomUUID();
    const parentSpanId = collector.getCurrentSpanId();
    const started = Date.now() / 1000;
    const callsite = getCallsite();
    const requestInfo = extractRequest(args[0]);
    
    // Set model name from wrapper if not in request
    if (requestInfo.model === null && modelName !== null) {
      requestInfo.model = modelName;
    }
    
    let error: string | null = null;
    let responseInfo: GenerateContentResponse | null = null;
    
    try {
      const resp = await originalGenerateContent(...args);
      responseInfo = extractResponse(resp);
      return resp;
    } catch (e) {
      const err = e as Error;
      error = `${err.name}: ${err.message}`;
      throw e;
    } finally {
      const ended = Date.now() / 1000;
      
      const event: Event = {
        provider: 'gemini',
        api: 'models.generateContent',
        callsite,
        request: requestInfo,
        response: responseInfo,
        error,
        started_at: started,
        ended_at: ended,
        duration_ms: Math.round((ended - started) * 1000 * 1000) / 1000,
        span_id: spanId,
        parent_span_id: parentSpanId,
      };
      
      collector.recordEvent(event);
    }
  };
}

/**
 * Wrap a Gemini client to instrument models.generateContent calls.
 * 
 * Supports both:
 * - @google/genai: client.models.generateContent()
 * - @google-cloud/vertexai: client.getGenerativeModel().generateContent()
 */
export function wrapGeminiClient<T extends object>(client: T, collector: Collector): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Intercept models property access (@google/genai pattern)
      if (prop === 'models' && value && typeof value === 'object') {
        return wrapModelsResource(value as object, collector);
      }
      
      // Intercept getGenerativeModel method (@google-cloud/vertexai pattern)
      if (prop === 'getGenerativeModel' && typeof value === 'function') {
        return function wrappedGetGenerativeModel(...args: unknown[]) {
          const model = value.apply(target, args);
          // Extract model name from the first argument
          const modelConfig = args[0] as Record<string, unknown> | undefined;
          const modelName = typeof modelConfig?.model === 'string' ? modelConfig.model : null;
          return wrapGenerativeModel(model as object, collector, modelName);
        };
      }
      
      return value;
    },
  });
}

/**
 * Wrap a GenerativeModel instance to intercept generateContent calls.
 * Used for @google-cloud/vertexai pattern.
 */
function wrapGenerativeModel<T extends object>(model: T, collector: Collector, modelName: string | null = null): T {
  return new Proxy(model, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Intercept generateContent method
      if (prop === 'generateContent' && typeof value === 'function') {
        return createWrappedGenerateContentWithModel(value.bind(target), collector, modelName);
      }
      
      // Intercept generateContentStream method
      if (prop === 'generateContentStream' && typeof value === 'function') {
        return createWrappedGenerateContentStreamWithModel(value.bind(target), collector, modelName);
      }
      
      // Intercept startChat method to wrap the chat session
      if (prop === 'startChat' && typeof value === 'function') {
        return function wrappedStartChat(...args: unknown[]) {
          const chatSession = value.apply(target, args);
          return wrapChatSession(chatSession as object, collector, modelName);
        };
      }
      
      return value;
    },
  });
}

/**
 * Wrap a ChatSession instance to intercept sendMessage calls.
 */
function wrapChatSession<T extends object>(session: T, collector: Collector, modelName: string | null = null): T {
  return new Proxy(session, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Intercept sendMessage method
      if (prop === 'sendMessage' && typeof value === 'function') {
        return createWrappedSendMessageWithModel(value.bind(target), collector, modelName);
      }
      
      // Intercept sendMessageStream method
      if (prop === 'sendMessageStream' && typeof value === 'function') {
        return createWrappedSendMessageStreamWithModel(value.bind(target), collector, modelName);
      }
      
      return value;
    },
  });
}

/**
 * Create a wrapped version of sendMessage method with model name.
 */
function createWrappedSendMessageWithModel(
  originalSendMessage: (...args: unknown[]) => Promise<unknown>,
  collector: Collector,
  modelName: string | null
): (...args: unknown[]) => Promise<unknown> {
  return async function wrappedSendMessage(...args: unknown[]): Promise<unknown> {
    const spanId = randomUUID();
    const parentSpanId = collector.getCurrentSpanId();
    const started = Date.now() / 1000;
    const callsite = getCallsite();
    
    // Extract message content
    const message = args[0];
    const requestInfo: GenerateContentRequest = {
      model: modelName,
      contents: typeof message === 'string' ? message : message,
      system_instruction: null,
      config: null,
      other: {},
    };
    
    let error: string | null = null;
    let responseInfo: GenerateContentResponse | null = null;
    
    try {
      const resp = await originalSendMessage(...args);
      responseInfo = extractResponse(resp);
      return resp;
    } catch (e) {
      const err = e as Error;
      error = `${err.name}: ${err.message}`;
      throw e;
    } finally {
      const ended = Date.now() / 1000;
      
      const event: Event = {
        provider: 'gemini',
        api: 'chat.sendMessage',
        callsite,
        request: requestInfo,
        response: responseInfo,
        error,
        started_at: started,
        ended_at: ended,
        duration_ms: Math.round((ended - started) * 1000 * 1000) / 1000,
        span_id: spanId,
        parent_span_id: parentSpanId,
      };
      
      collector.recordEvent(event);
    }
  };
}

/**
 * Create a wrapped version of sendMessageStream method with model name.
 */
function createWrappedSendMessageStreamWithModel(
  originalSendMessageStream: (...args: unknown[]) => Promise<unknown>,
  collector: Collector,
  modelName: string | null
): (...args: unknown[]) => Promise<unknown> {
  return async function wrappedSendMessageStream(...args: unknown[]): Promise<unknown> {
    const spanId = randomUUID();
    const parentSpanId = collector.getCurrentSpanId();
    const started = Date.now() / 1000;
    const callsite = getCallsite();
    
    const message = args[0];
    const requestInfo: GenerateContentRequest = {
      model: modelName,
      contents: typeof message === 'string' ? message : message,
      system_instruction: null,
      config: null,
      other: {},
    };
    
    let error: string | null = null;
    
    try {
      const resp = await originalSendMessageStream(...args);
      return resp;
    } catch (e) {
      const err = e as Error;
      error = `${err.name}: ${err.message}`;
      throw e;
    } finally {
      const ended = Date.now() / 1000;
      
      const event: Event = {
        provider: 'gemini',
        api: 'chat.sendMessageStream',
        callsite,
        request: requestInfo,
        response: null,
        error,
        started_at: started,
        ended_at: ended,
        duration_ms: Math.round((ended - started) * 1000 * 1000) / 1000,
        span_id: spanId,
        parent_span_id: parentSpanId,
      };
      
      collector.recordEvent(event);
    }
  };
}

/**
 * Create a wrapped version of generateContentStream method with model name.
 */
function createWrappedGenerateContentStreamWithModel(
  originalGenerateContentStream: (...args: unknown[]) => Promise<unknown>,
  collector: Collector,
  modelName: string | null
): (...args: unknown[]) => Promise<unknown> {
  return async function wrappedGenerateContentStream(...args: unknown[]): Promise<unknown> {
    const spanId = randomUUID();
    const parentSpanId = collector.getCurrentSpanId();
    const started = Date.now() / 1000;
    const callsite = getCallsite();
    const requestInfo = extractRequest(args[0]);
    
    // Set model name from wrapper if not in request
    if (requestInfo.model === null && modelName !== null) {
      requestInfo.model = modelName;
    }
    
    let error: string | null = null;
    
    try {
      const resp = await originalGenerateContentStream(...args);
      return resp;
    } catch (e) {
      const err = e as Error;
      error = `${err.name}: ${err.message}`;
      throw e;
    } finally {
      const ended = Date.now() / 1000;
      
      const event: Event = {
        provider: 'gemini',
        api: 'models.generateContentStream',
        callsite,
        request: requestInfo,
        response: null,
        error,
        started_at: started,
        ended_at: ended,
        duration_ms: Math.round((ended - started) * 1000 * 1000) / 1000,
        span_id: spanId,
        parent_span_id: parentSpanId,
      };
      
      collector.recordEvent(event);
    }
  };
}

/**
 * Wrap the models resource to intercept API calls.
 * Used for @google/genai pattern.
 */
function wrapModelsResource<T extends object>(models: T, collector: Collector): T {
  return new Proxy(models, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Intercept generateContent method
      if (prop === 'generateContent' && typeof value === 'function') {
        return createWrappedGenerateContent(value.bind(target), collector);
      }
      
      // Intercept generateVideos method
      if (prop === 'generateVideos' && typeof value === 'function') {
        return createWrappedGenerateVideos(value.bind(target), collector);
      }
      
      return value;
    },
  });
}

