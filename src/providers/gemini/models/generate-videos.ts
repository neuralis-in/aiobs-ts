/**
 * Models for Gemini generate_videos API capture.
 */

import type { BaseGeminiRequest, BaseGeminiResponse } from './base.js';

export interface VideoGenerationConfig {
  aspect_ratio?: string | null;
  number_of_videos?: number | null;
  resolution?: string | null;
  duration_seconds?: number | null;
  negative_prompt?: string | null;
  generate_audio?: boolean | null;
  enhance_prompt?: boolean | null;
  person_generation?: string | null;
  seed?: number | null;
  output_gcs_uri?: string | null;
}

export interface GenerateVideosRequest extends BaseGeminiRequest {
  prompt: string | null;
  image: Record<string, unknown> | null;
  video: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  other: Record<string, unknown>;
}

export interface GeneratedVideo {
  video: Record<string, unknown> | null;
}

export interface GenerateVideosResponse extends BaseGeminiResponse {
  operation_name: string | null;
  done: boolean | null;
  generated_videos: Array<Record<string, unknown>> | null;
}

