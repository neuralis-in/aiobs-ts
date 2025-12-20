/**
 * Google Cloud Storage exporter for aiobs observability data.
 * 
 * Exports observability data to Google Cloud Storage buckets.
 */

import { BaseExporter, ExportError, createExportResult, type ExportResult } from './base.js';
import type { ObservabilityExport } from '../models/observability.js';

export interface GCSExporterOptions {
  /** The GCS bucket name (required) */
  bucket: string;
  /** Path prefix within the bucket (e.g., "traces/"). Defaults to "" */
  prefix?: string;
  /** GCP project ID. If not provided, uses the default project */
  project?: string;
  /** Path to service account JSON file. If not provided, uses default authentication */
  credentials_path?: string;
  /** 
   * Template for the output filename. Supports placeholders:
   * - {session_id}: First session ID
   * - {timestamp}: Unix timestamp
   * - {date}: Date in YYYY-MM-DD format
   * Defaults to "{session_id}.json"
   */
  filename_template?: string;
  /** Content-Type for uploaded files. Defaults to "application/json" */
  content_type?: string;
}

/**
 * Export observability data to Google Cloud Storage.
 * 
 * @example
 * ```typescript
 * import { GCSExporter } from 'aiobs/exporters';
 * 
 * const exporter = new GCSExporter({
 *   bucket: 'my-observability-bucket',
 *   prefix: 'traces/',
 *   project: 'my-gcp-project',
 * });
 * 
 * observer.flush({ exporter });
 * ```
 * 
 * Authentication:
 * The exporter uses Google Cloud's default authentication chain:
 * 1. GOOGLE_APPLICATION_CREDENTIALS environment variable
 * 2. Service account credentials file path
 * 3. Application Default Credentials (ADC)
 */
export class GCSExporter extends BaseExporter {
  name = 'gcs';

  private bucket: string;
  private prefix: string;
  private project?: string;
  private credentialsPath?: string;
  private filenameTemplate: string;
  private contentType: string;
  private _client: unknown = null;

  constructor(options: GCSExporterOptions) {
    super();
    this.bucket = options.bucket;
    const prefix = options.prefix ?? '';
    this.prefix = prefix && !prefix.endsWith('/') ? prefix + '/' : prefix;
    this.project = options.project;
    this.credentialsPath = options.credentials_path;
    this.filenameTemplate = options.filename_template ?? '{session_id}.json';
    this.contentType = options.content_type ?? 'application/json';
  }

  /**
   * Lazily initialize the GCS client.
   */
  private async getClient(): Promise<unknown> {
    if (this._client === null) {
      try {
        // Dynamic import for optional dependency
        const storageModule = await import('@google-cloud/storage' as string).catch(() => null);
        if (!storageModule) {
          throw new ExportError(
            '@google-cloud/storage is required for GCSExporter. ' +
            'Install it with: npm install @google-cloud/storage'
          );
        }
        const { Storage } = storageModule;
        
        const storageOptions: Record<string, unknown> = {};
        if (this.project) {
          storageOptions.projectId = this.project;
        }
        if (this.credentialsPath) {
          storageOptions.keyFilename = this.credentialsPath;
        }
        
        this._client = new Storage(storageOptions);
      } catch (e) {
        if (e instanceof ExportError) throw e;
        throw new ExportError(
          `Failed to initialize GCS client: ${e}`,
          e as Error
        );
      }
    }
    return this._client;
  }

  /**
   * Generate the filename from the template.
   */
  private generateFilename(data: ObservabilityExport): string {
    let sessionId = 'unknown';
    if (data.sessions && data.sessions.length > 0) {
      sessionId = data.sessions[0].id;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date().toISOString().split('T')[0];

    return this.filenameTemplate
      .replace('{session_id}', sessionId)
      .replace('{timestamp}', String(timestamp))
      .replace('{date}', date);
  }

  /**
   * Export observability data to GCS.
   * 
   * @param data - The ObservabilityExport object to export.
   * @param options - Additional options:
   *   - filename: Override the filename (ignores template)
   *   - metadata: Dict of custom metadata to attach to the blob
   * @returns ExportResult with the GCS URI and export metadata.
   * @throws ExportError if upload fails.
   */
  async export(
    data: ObservabilityExport,
    options?: Record<string, unknown>
  ): Promise<ExportResult> {
    this.validate(data);

    try {
      const client = await this.getClient() as { bucket: (name: string) => unknown };
      const bucket = client.bucket(this.bucket) as {
        file: (path: string) => {
          save: (data: string, options: Record<string, unknown>) => Promise<void>;
          setMetadata: (metadata: Record<string, unknown>) => Promise<void>;
        };
      };

      // Generate filename
      const filename = (options?.filename as string) || this.generateFilename(data);
      const blobPath = `${this.prefix}${filename}`;
      const blob = bucket.file(blobPath);

      // Serialize data
      const jsonData = JSON.stringify(data, null, 2);
      const bytesWritten = Buffer.byteLength(jsonData, 'utf-8');

      // Set custom metadata if provided
      if (options?.metadata && typeof options.metadata === 'object') {
        await blob.setMetadata({ metadata: options.metadata });
      }

      // Upload
      await blob.save(jsonData, {
        contentType: this.contentType,
      });

      const gcsUri = `gs://${this.bucket}/${blobPath}`;

      return createExportResult(true, {
        destination: gcsUri,
        bytes_written: bytesWritten,
        metadata: {
          bucket: this.bucket,
          blob_path: blobPath,
          content_type: this.contentType,
          sessions_count: data.sessions?.length ?? 0,
          events_count: data.events?.length ?? 0,
          function_events_count: data.function_events?.length ?? 0,
        },
      });
    } catch (e) {
      if (e instanceof ExportError) {
        throw e;
      }
      throw new ExportError(`Failed to export to GCS: ${e}`, e as Error);
    }
  }

  /**
   * Create a GCSExporter from environment variables.
   * 
   * @param envNames - Custom environment variable names
   * @returns Configured GCSExporter instance.
   * @throws ExportError if required environment variables are missing.
   */
  static fromEnv(envNames?: {
    bucket_env?: string;
    prefix_env?: string;
    project_env?: string;
    credentials_env?: string;
  }): GCSExporter {
    const bucketEnv = envNames?.bucket_env ?? 'AIOBS_GCS_BUCKET';
    const prefixEnv = envNames?.prefix_env ?? 'AIOBS_GCS_PREFIX';
    const projectEnv = envNames?.project_env ?? 'AIOBS_GCS_PROJECT';
    const credentialsEnv = envNames?.credentials_env ?? 'GOOGLE_APPLICATION_CREDENTIALS';

    const bucket = process.env[bucketEnv];
    if (!bucket) {
      throw new ExportError(`Environment variable ${bucketEnv} is required`);
    }

    return new GCSExporter({
      bucket,
      prefix: process.env[prefixEnv] ?? '',
      project: process.env[projectEnv],
      credentials_path: process.env[credentialsEnv],
    });
  }
}

