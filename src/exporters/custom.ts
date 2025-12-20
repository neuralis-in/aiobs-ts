/**
 * Custom exporter for user-defined export logic.
 * 
 * Allows users to define their own export behavior via callbacks.
 */

import { BaseExporter, ExportError, createExportResult, type ExportResult } from './base.js';
import type { ObservabilityExport } from '../models/observability.js';

/**
 * Type alias for the export handler function.
 */
export type ExportHandler = (
  data: ObservabilityExport,
  options: Record<string, unknown>
) => Promise<ExportResult | Record<string, unknown> | void> | ExportResult | Record<string, unknown> | void;

export interface CustomExporterOptions {
  /** The handler function that performs the export */
  handler: ExportHandler;
  /** Optional name for this exporter instance */
  name?: string;
  /** Default options to pass to the handler */
  default_options?: Record<string, unknown>;
}

/**
 * Export observability data using a user-defined handler function.
 * 
 * This exporter allows maximum flexibility by letting users define
 * their own export logic via a callback function.
 * 
 * @example
 * ```typescript
 * import { CustomExporter } from 'aiobs/exporters';
 * 
 * const myExportHandler = async (data, options) => {
 *   // Send to custom API, database, etc.
 *   const response = await fetch('https://my-api.com/traces', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify(data),
 *   });
 *   return {
 *     success: response.ok,
 *     destination: 'https://my-api.com/traces',
 *     metadata: { status_code: response.status },
 *   };
 * };
 * 
 * const exporter = new CustomExporter({ handler: myExportHandler });
 * observer.flush({ exporter });
 * ```
 */
export class CustomExporter extends BaseExporter {
  name = 'custom';

  private handler: ExportHandler;
  private defaultOptions: Record<string, unknown>;

  constructor(options: CustomExporterOptions) {
    super();
    if (typeof options.handler !== 'function') {
      throw new Error('handler must be a function');
    }
    this.handler = options.handler;
    if (options.name) {
      this.name = options.name;
    }
    this.defaultOptions = options.default_options ?? {};
  }

  /**
   * Export using the custom handler.
   * 
   * @param data - The ObservabilityExport object to export.
   * @param options - Additional options passed to the handler.
   * @returns ExportResult from the handler.
   * @throws ExportError if the handler fails or returns invalid data.
   */
  async export(
    data: ObservabilityExport,
    options?: Record<string, unknown>
  ): Promise<ExportResult> {
    this.validate(data);

    // Merge default options with provided options
    const mergedOptions = { ...this.defaultOptions, ...options };

    try {
      const result = await this.handler(data, mergedOptions);

      // Handle different return types
      if (result === undefined || result === null) {
        return createExportResult(true, {
          metadata: { handler: this.name },
        });
      } else if ('success' in result && typeof result.success === 'boolean') {
        // It's an ExportResult-like object
        return result as ExportResult;
      } else if (typeof result === 'object') {
        // It's a dict-like result
        const r = result as Record<string, unknown>;
        return createExportResult(
          r.success !== false,
          {
            destination: r.destination as string | undefined,
            bytes_written: r.bytes_written as number | undefined,
            metadata: (r.metadata as Record<string, unknown>) ?? {},
            error: r.error as string | undefined,
          }
        );
      } else {
        // Unexpected return type, treat as success
        return createExportResult(true, {
          metadata: { handler: this.name, result: String(result) },
        });
      }
    } catch (e) {
      throw new ExportError(`Custom export handler failed: ${e}`, e as Error);
    }
  }
}

export interface CompositeExporterOptions {
  /** List of exporters to run */
  exporters: BaseExporter[];
  /** If true, stop on first error. If false, continue and collect all results. Defaults to false */
  stop_on_error?: boolean;
}

/**
 * Export to multiple destinations using multiple exporters.
 * 
 * Runs multiple exporters in sequence, collecting results from each.
 * 
 * @example
 * ```typescript
 * import { CompositeExporter, GCSExporter, CustomExporter } from 'aiobs/exporters';
 * 
 * const gcs = new GCSExporter({ bucket: 'my-bucket', prefix: 'traces/' });
 * const custom = new CustomExporter({ handler: myHandler });
 * 
 * const exporter = new CompositeExporter({ exporters: [gcs, custom] });
 * observer.flush({ exporter });
 * ```
 */
export class CompositeExporter extends BaseExporter {
  name = 'composite';

  private exporters: BaseExporter[];
  private stopOnError: boolean;

  constructor(options: CompositeExporterOptions) {
    super();
    if (!options.exporters || options.exporters.length === 0) {
      throw new Error('At least one exporter is required');
    }
    this.exporters = options.exporters;
    this.stopOnError = options.stop_on_error ?? false;
  }

  /**
   * Export using all configured exporters.
   * 
   * @param data - The ObservabilityExport object to export.
   * @param options - Additional options passed to each exporter.
   * @returns ExportResult with aggregated metadata from all exporters.
   * @throws ExportError if stop_on_error is true and any exporter fails.
   */
  async export(
    data: ObservabilityExport,
    options?: Record<string, unknown>
  ): Promise<ExportResult> {
    this.validate(data);

    const results: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    let allSuccess = true;

    for (const exporter of this.exporters) {
      try {
        const result = await exporter.export(data, options);
        results.push({
          exporter: exporter.name,
          success: result.success,
          destination: result.destination,
          bytes_written: result.bytes_written,
          metadata: result.metadata,
          error: result.error,
        });
        if (!result.success) {
          allSuccess = false;
          if (result.error) {
            errors.push(`${exporter.name}: ${result.error}`);
          }
        }
      } catch (e) {
        allSuccess = false;
        const errorMessage = e instanceof Error ? e.message : String(e);
        errors.push(`${exporter.name}: ${errorMessage}`);
        results.push({
          exporter: exporter.name,
          success: false,
          error: errorMessage,
        });
        if (this.stopOnError) {
          throw e;
        }
      }
    }

    return createExportResult(allSuccess, {
      metadata: {
        exporters_count: this.exporters.length,
        results,
      },
      error: errors.length > 0 ? errors.join('; ') : undefined,
    });
  }

  /**
   * Add an exporter to the composite.
   * 
   * @param exporter - The exporter to add.
   * @returns Self for method chaining.
   */
  add(exporter: BaseExporter): CompositeExporter {
    this.exporters.push(exporter);
    return this;
  }
}

