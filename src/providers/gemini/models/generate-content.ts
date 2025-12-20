/**
 * Models for Gemini generate_content API capture.
 */

import type { BaseGeminiRequest, BaseGeminiResponse } from './base.js';

export interface ContentPart {
  text?: string | null;
  inline_data?: Record<string, unknown> | null;
}

export interface Content {
  role?: string | null;
  parts?: ContentPart[] | null;
}

export interface GenerateContentRequest extends BaseGeminiRequest {
  contents: string | Content[] | unknown | null;
  system_instruction: unknown | null;
  config: Record<string, unknown> | null;
  other: Record<string, unknown>;
}

/**
 * Usage metadata with all expected fields matching Python SDK.
 */
export interface UsageMetadata extends Record<string, unknown> {
  cache_tokens_details: unknown | null;
  cached_content_token_count: number | null;
  candidates_token_count: number | null;
  candidates_tokens_details: Array<Record<string, unknown>> | null;
  prompt_token_count: number | null;
  prompt_tokens_details: Array<Record<string, unknown>> | null;
  thoughts_token_count: number | null;
  tool_use_prompt_token_count: number | null;
  tool_use_prompt_tokens_details: Array<Record<string, unknown>> | null;
  total_token_count: number | null;
  traffic_type: string | null;
}

/**
 * Part object with all expected fields matching Python SDK.
 */
export interface ResponsePart {
  media_resolution: unknown | null;
  code_execution_result: unknown | null;
  executable_code: unknown | null;
  file_data: unknown | null;
  function_call: unknown | null;
  function_response: unknown | null;
  inline_data: unknown | null;
  text: string | null;
  thought: unknown | null;
  thought_signature: unknown | null;
  video_metadata: unknown | null;
}

/**
 * Content object in candidate response.
 */
export interface CandidateContent {
  parts: ResponsePart[] | null;
  role: string | null;
}

/**
 * Candidate object with all expected fields matching Python SDK.
 */
export interface Candidate {
  content: CandidateContent | null;
  citation_metadata: unknown | null;
  finish_message: string | null;
  token_count: number | null;
  finish_reason: string | null;
  avg_logprobs: number | null;
  grounding_metadata: unknown | null;
  index: number | null;
  logprobs_result: unknown | null;
  safety_ratings: unknown | null;
  url_context_metadata: unknown | null;
}

export interface GenerateContentResponse extends BaseGeminiResponse {
  usage: UsageMetadata | null;
  text: string | null;
  candidates: Candidate[] | null;
}

