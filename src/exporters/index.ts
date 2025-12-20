/**
 * Exporters for aiobs observability data.
 * 
 * Exporters handle the serialization and transport of observability data
 * to various destinations.
 * 
 * Supported exporters:
 * - GCSExporter: Export to Google Cloud Storage
 * - CustomExporter: User-defined export logic via callback
 * - CompositeExporter: Export to multiple destinations
 * 
 * @example
 * ```typescript
 * import { observer } from 'aiobs';
 * import { GCSExporter } from 'aiobs/exporters';
 * 
 * const exporter = new GCSExporter({
 *   bucket: 'my-observability-bucket',
 *   prefix: 'traces/',
 *   project: 'my-gcp-project',
 * });
 * 
 * await observer.observe();
 * // ... your agent code ...
 * observer.end();
 * await observer.flush({ exporter });
 * ```
 */

export {
  BaseExporter,
  ExportResult,
  ExportError,
  createExportResult,
} from './base.js';

export {
  GCSExporter,
  type GCSExporterOptions,
} from './gcs.js';

export {
  CustomExporter,
  CompositeExporter,
  type CustomExporterOptions,
  type CompositeExporterOptions,
  type ExportHandler,
} from './custom.js';

