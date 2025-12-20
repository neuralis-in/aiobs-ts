/**
 * Gemini provider instrumentation for aiobs.
 * 
 * Supports:
 * - models.generateContent
 * - models.generateVideos
 */

export { wrapGeminiClient, wrapGenerateContentResource } from './generate-content.js';
export { wrapGenerateVideosResource, createWrappedGenerateVideos } from './generate-videos.js';
export * from './models/index.js';

