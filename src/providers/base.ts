/**
 * Base provider interface for LLM instrumentation.
 */

import type { Collector } from '../collector.js';

export interface BaseProvider {
  readonly name: string;
  
  /**
   * Check if the provider is available (dependencies present).
   */
  isAvailable(): boolean;
  
  /**
   * Install instrumentation and return an optional cleanup function.
   */
  install(collector: Collector): (() => void) | null;
}

