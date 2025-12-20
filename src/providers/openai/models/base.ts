/**
 * Base models for OpenAI request/response capture.
 */

export interface BaseOpenAIRequest {
  model: string | null;
}

export interface BaseOpenAIResponse {
  id: string | null;
  model: string | null;
  usage: Record<string, unknown> | null;
}

