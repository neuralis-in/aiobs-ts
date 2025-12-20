/**
 * Gemini generate_videos API instrumentation.
 * 
 * Uses Proxy to wrap the Gemini client and intercept models.generateVideos calls.
 */

import { randomUUID } from 'crypto';
import type { Collector } from '../../collector.js';
import type { Event, Callsite } from '../../models/observability.js';
import type { GenerateVideosRequest, GenerateVideosResponse } from './models/index.js';

/**
 * Get callsite information from the call stack.
 */
function getCallsite(): Callsite | null {
  try {
    const error = new Error();
    const stack = error.stack?.split('\n') ?? [];
    
    for (let i = 3; i < stack.length; i++) {
      const line = stack[i];
      // Skip internal aiobs and google frames
      if (line.includes('/aiobs-ts/') || line.includes('/google/') || line.includes('node_modules')) {
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
 * Extract request data from generateVideos call arguments.
 */
function extractRequest(args: unknown): GenerateVideosRequest {
  const req = (args ?? {}) as Record<string, unknown>;
  
  const model = typeof req.model === 'string' ? req.model : null;
  const prompt = typeof req.prompt === 'string' ? req.prompt : null;
  
  // Simplify image for storage (avoid storing raw bytes)
  let image: Record<string, unknown> | null = null;
  if (req.image && typeof req.image === 'object') {
    const img = req.image as Record<string, unknown>;
    image = Object.fromEntries(
      Object.entries(img).filter(([k]) => !['image_bytes', 'imageBytes'].includes(k))
    );
    if (Object.keys(image).length === 0) {
      image = { type: 'image' };
    }
  }
  
  // Simplify video for storage (avoid storing raw bytes)
  let video: Record<string, unknown> | null = null;
  if (req.video && typeof req.video === 'object') {
    const vid = req.video as Record<string, unknown>;
    video = Object.fromEntries(
      Object.entries(vid).filter(([k]) => !['video_bytes', 'videoBytes'].includes(k))
    );
    if (Object.keys(video).length === 0) {
      video = { type: 'video' };
    }
  }
  
  let config: Record<string, unknown> | null = null;
  if (req.config && typeof req.config === 'object') {
    config = req.config as Record<string, unknown>;
  }
  
  return {
    model,
    prompt,
    image,
    video,
    config,
    other: Object.fromEntries(
      Object.entries(req).filter(([k]) => !['model', 'prompt', 'image', 'video', 'config'].includes(k))
    ),
  };
}

/**
 * Extract response data from generateVideos response.
 */
function extractResponse(resp: unknown): GenerateVideosResponse {
  const r = resp as Record<string, unknown>;
  
  const operationName = typeof r.name === 'string' ? r.name : null;
  const done = typeof r.done === 'boolean' ? r.done : null;
  let generatedVideos: Array<Record<string, unknown>> | null = null;
  
  // Extract generated videos from response
  try {
    const responseObj = r.response as Record<string, unknown> | undefined;
    if (responseObj && responseObj.generated_videos) {
      const genVideos = responseObj.generated_videos as unknown[];
      if (Array.isArray(genVideos)) {
        generatedVideos = genVideos.map((vid) => {
          if (vid && typeof vid === 'object') {
            const vidObj = vid as Record<string, unknown>;
            // Remove large binary data if present
            const cleaned = { ...vidObj };
            if (cleaned.video && typeof cleaned.video === 'object') {
              const videoData = cleaned.video as Record<string, unknown>;
              cleaned.video = Object.fromEntries(
                Object.entries(videoData).filter(([k]) => !['video_bytes', 'videoBytes', 'image_bytes', 'imageBytes'].includes(k))
              );
            }
            return cleaned;
          }
          return {};
        });
      }
    }
  } catch {
    // Ignore extraction errors
  }
  
  return {
    model: typeof r.model === 'string' ? r.model : null,
    operation_name: operationName,
    done,
    generated_videos: generatedVideos,
    usage: null,
  };
}

/**
 * Create a wrapped version of the generateVideos method.
 */
export function createWrappedGenerateVideos(
  originalGenerateVideos: (...args: unknown[]) => Promise<unknown>,
  collector: Collector
): (...args: unknown[]) => Promise<unknown> {
  return async function wrappedGenerateVideos(...args: unknown[]): Promise<unknown> {
    const spanId = randomUUID();
    const parentSpanId = collector.getCurrentSpanId();
    const started = Date.now() / 1000;
    const callsite = getCallsite();
    const requestInfo = extractRequest(args[0]);
    
    let error: string | null = null;
    let responseInfo: GenerateVideosResponse | null = null;
    
    try {
      const resp = await originalGenerateVideos(...args);
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
        api: 'models.generateVideos',
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
 * Wrap the generateVideos resource.
 */
export function wrapGenerateVideosResource<T extends object>(models: T, collector: Collector): T {
  return new Proxy(models, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      
      // Intercept generateVideos method
      if (prop === 'generateVideos' && typeof value === 'function') {
        return createWrappedGenerateVideos(value.bind(target), collector);
      }
      
      return value;
    },
  });
}

