/**
 * Models for OpenAI Chat Completions API capture.
 */

import type { BaseOpenAIRequest, BaseOpenAIResponse } from './base.js';

export interface Message {
  role: string;
  content: unknown;
}

export interface ChatCompletionsRequest extends BaseOpenAIRequest {
  messages: Message[] | null;
  temperature: number | null;
  max_tokens: number | null;
  other: Record<string, unknown>;
}

export interface ChatCompletionsResponse extends BaseOpenAIResponse {
  text: string | null;
}

