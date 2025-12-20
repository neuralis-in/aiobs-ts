/**
 * Base exporter interface for aiobs observability data.
 * 
 * Exporters handle the serialization and transport of observability data
 * to various destinations (files, cloud storage, databases, etc.).
 */

import type { ObservabilityExport } from '../models/observability.js';

/**
 * Result of an export operation.
 */
export interface ExportResult {
  /** Whether the export succeeded */
  success: boolean;
  /** The destination where data was exported (URL, path, etc.) */
  destination?: string | null;
  /** Number of bytes written (if applicable) */
  bytes_written?: number | null;
  /** Additional metadata about the export */
  metadata: Record<string, unknown>;
  /** Error message if export failed */
  error?: string | null;
}

/**
 * Exception class for export operation failures.
 */
export class ExportError extends Error {
  cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ExportError';
    this.cause = cause;
  }
}

/**
 * Abstract base class for observability data exporters.
 * 
 * Subclasses must implement the `export()` method to handle
 * the actual data export to their specific destination.
 * 
 * @example
 * ```typescript
 * class MyExporter extends BaseExporter {
 *   name = 'my-exporter';
 *   
 *   async export(data: ObservabilityExport, options?: Record<string, unknown>): Promise<ExportResult> {
 *     // Custom export logic
 *     return { success: true, metadata: {} };
 *   }
 * }
 * ```
 */
export abstract class BaseExporter {
  /** Name identifier for this exporter */
  name = 'base';

  /**
   * Export observability data to the destination.
   * 
   * @param data - The ObservabilityExport object containing all sessions, events, and trace data.
   * @param options - Additional exporter-specific options.
   * @returns Promise resolving to ExportResult with status and metadata about the export.
   * @throws ExportError if the export fails.
   */
  abstract export(
    data: ObservabilityExport,
    options?: Record<string, unknown>
  ): Promise<ExportResult>;

  /**
   * Validate data before export. Override for custom validation.
   * 
   * @param data - The data to validate.
   * @returns True if valid, throws ExportError otherwise.
   */
  validate(data: ObservabilityExport): boolean {
    if (!data.sessions || data.sessions.length === 0) {
      return true; // Empty data is valid, just nothing to export
    }
    return true;
  }
}

/**
 * Create an ExportResult object.
 */
export function createExportResult(
  success: boolean,
  options?: Partial<ExportResult>
): ExportResult {
  return {
    success,
    destination: options?.destination ?? null,
    bytes_written: options?.bytes_written ?? null,
    metadata: options?.metadata ?? {},
    error: options?.error ?? null,
  };
}

