/**
 * Base models for Gemini request/response capture.
 */

export interface BaseGeminiRequest {
  model: string | null;
}

export interface BaseGeminiResponse {
  model: string | null;
  usage: Record<string, unknown> | null;
}

