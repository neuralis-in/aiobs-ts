/**
 * Models for OpenAI Embeddings API capture.
 */

import type { BaseOpenAIRequest, BaseOpenAIResponse } from './base.js';

export interface EmbeddingsRequest extends BaseOpenAIRequest {
  input: string | string[] | number[] | number[][] | null;
  encoding_format: string | null;
  dimensions: number | null;
  user: string | null;
  other: Record<string, unknown>;
}

export interface EmbeddingData {
  index: number;
  embedding: number[];
  object: string;
}

export interface EmbeddingsResponse extends BaseOpenAIResponse {
  object: string | null;
  data: EmbeddingData[] | null;
  embedding_dimensions: number | null;
}

