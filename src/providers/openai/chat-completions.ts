/**
 * OpenAI Chat Completions API instrumentation.
 * 
 * Uses Proxy to wrap the OpenAI client and intercept chat.completions.create calls.
 */

import { randomUUID } from 'crypto';
import type { Collector } from '../../collector.js';
import type { Event, Callsite } from '../../models/observability.js';
import type { ChatCompletionsRequest, ChatCompletionsResponse, Message } from './models/index.js';
import { wrapEmbeddingsResource } from './embeddings.js';

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
 * Extract request data from chat completions call arguments.
 */
function extractRequest(args: unknown): ChatCompletionsRequest {
  const req = (args ?? {}) as Record<string, unknown>;
  
  let messages: Message[] | null = null;
  if (Array.isArray(req.messages)) {
    // Only capture first 3 messages for brevity
    messages = req.messages.slice(0, 3).map((m: unknown) => {
      const msg = m as Record<string, unknown>;
      return {
        role: String(msg.role ?? ''),
        content: msg.content,
      };
    });
  }
  
  return {
    model: typeof req.model === 'string' ? req.model : null,
    messages,
    temperature: typeof req.temperature === 'number' ? req.temperature : null,
    max_tokens: typeof req.max_tokens === 'number' ? req.max_tokens : null,
    other: Object.fromEntries(
      Object.entries(req).filter(([k]) => !['model', 'messages', 'temperature', 'max_tokens'].includes(k))
    ),
  };
}

/**
 * Extract response data from chat completions response.
 */
function extractResponse(resp: unknown): ChatCompletionsResponse {
  const r = resp as Record<string, unknown>;
  
  let text: string | null = null;
  try {
    const choices = r.choices as Array<{ message?: { content?: string } }> | undefined;
    if (choices && choices.length > 0 && choices[0].message) {
      text = choices[0].message.content ?? null;
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
    usage,
    text,
  };
}

/**
 * Wrap an OpenAI client to instrument chat.completions.create and embeddings.create calls.
 */
export function wrapOpenAIClient<T extends object>(client: T, collector: Collector): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Intercept chat property access
      if (prop === 'chat' && value && typeof value === 'object') {
        return wrapChatResource(value as object, collector);
      }
      
      // Intercept embeddings property access
      if (prop === 'embeddings' && value && typeof value === 'object') {
        return wrapEmbeddingsResource(value as object, collector);
      }
      
      return value;
    },
  });
}

/**
 * Wrap the chat resource to intercept completions.
 */
function wrapChatResource<T extends object>(chat: T, collector: Collector): T {
  return new Proxy(chat, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Intercept completions property access
      if (prop === 'completions' && value && typeof value === 'object') {
        return wrapCompletionsResource(value as object, collector);
      }
      
      return value;
    },
  });
}

/**
 * Wrap the completions resource to intercept create calls.
 */
function wrapCompletionsResource<T extends object>(completions: T, collector: Collector): T {
  return new Proxy(completions, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Intercept create method
      if (prop === 'create' && typeof value === 'function') {
        return createWrappedCreate(value.bind(target), collector);
      }
      
      return value;
    },
  });
}

/**
 * Create a wrapped version of the create method.
 */
function createWrappedCreate(
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
    let responseInfo: ChatCompletionsResponse | null = null;
    
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
        api: 'chat.completions.create',
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

