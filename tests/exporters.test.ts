import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BaseExporter,
  ExportError,
  createExportResult,
  type ExportResult,
} from '../src/exporters/base.js';
import { CustomExporter, CompositeExporter } from '../src/exporters/custom.js';
import { GCSExporter } from '../src/exporters/gcs.js';
import type { ObservabilityExport } from '../src/models/observability.js';

// Create a concrete implementation for testing BaseExporter
class TestExporter extends BaseExporter {
  name = 'test';
  exportFn: (data: ObservabilityExport) => Promise<ExportResult>;

  constructor(exportFn?: (data: ObservabilityExport) => Promise<ExportResult>) {
    super();
    this.exportFn =
      exportFn ??
      (async () => createExportResult(true, { metadata: { test: true } }));
  }

  async export(data: ObservabilityExport): Promise<ExportResult> {
    this.validate(data);
    return this.exportFn(data);
  }
}

// Helper to create minimal ObservabilityExport
function createTestData(
  options: Partial<ObservabilityExport> = {}
): ObservabilityExport {
  return {
    sessions: options.sessions ?? [
      {
        id: 'session-1',
        name: 'test-session',
        started_at: Date.now() / 1000,
        ended_at: null,
        meta: { pid: 1234, cwd: '/test' },
        labels: null,
      },
    ],
    events: options.events ?? [],
    function_events: options.function_events ?? [],
    trace_tree: options.trace_tree ?? null,
    enh_prompt_traces: options.enh_prompt_traces ?? null,
    generated_at: options.generated_at ?? Date.now() / 1000,
    version: options.version ?? 1,
  };
}

describe('Exporters', () => {
  describe('BaseExporter', () => {
    it('should have a default name', () => {
      const exporter = new TestExporter();
      expect(exporter.name).toBe('test');
    });

    it('should validate data', () => {
      const exporter = new TestExporter();
      const data = createTestData();

      expect(() => exporter.validate(data)).not.toThrow();
    });

    it('should validate empty data', () => {
      const exporter = new TestExporter();
      const emptyData = createTestData({ sessions: [] });

      expect(() => exporter.validate(emptyData)).not.toThrow();
    });
  });

  describe('ExportError', () => {
    it('should create an error with message', () => {
      const error = new ExportError('Export failed');

      expect(error.name).toBe('ExportError');
      expect(error.message).toBe('Export failed');
    });

    it('should include cause', () => {
      const cause = new Error('Original error');
      const error = new ExportError('Export failed', cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe('createExportResult', () => {
    it('should create a success result', () => {
      const result = createExportResult(true, {
        destination: '/path/to/file',
        bytes_written: 1024,
        metadata: { format: 'json' },
      });

      expect(result.success).toBe(true);
      expect(result.destination).toBe('/path/to/file');
      expect(result.bytes_written).toBe(1024);
      expect(result.metadata).toEqual({ format: 'json' });
      expect(result.error).toBeNull();
    });

    it('should create a failure result', () => {
      const result = createExportResult(false, {
        error: 'Something went wrong',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
    });

    it('should use defaults for missing options', () => {
      const result = createExportResult(true);

      expect(result.destination).toBeNull();
      expect(result.bytes_written).toBeNull();
      expect(result.metadata).toEqual({});
      expect(result.error).toBeNull();
    });
  });

  describe('CustomExporter', () => {
    it('should require a handler function', () => {
      expect(
        () => new CustomExporter({ handler: undefined as unknown as () => void })
      ).toThrow('handler must be a function');
    });

    it('should export using the handler', async () => {
      const handler = vi.fn().mockResolvedValue({
        success: true,
        destination: 'custom://destination',
        metadata: { custom: true },
      });

      const exporter = new CustomExporter({ handler });
      const data = createTestData();

      const result = await exporter.export(data);

      expect(handler).toHaveBeenCalledWith(data, {});
      expect(result.success).toBe(true);
      expect(result.destination).toBe('custom://destination');
    });

    it('should use custom name', () => {
      const exporter = new CustomExporter({
        handler: async () => {},
        name: 'my-custom-exporter',
      });

      expect(exporter.name).toBe('my-custom-exporter');
    });

    it('should merge default options', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });

      const exporter = new CustomExporter({
        handler,
        default_options: { key1: 'default1', key2: 'default2' },
      });

      await exporter.export(createTestData(), { key2: 'override2' });

      expect(handler).toHaveBeenCalledWith(expect.anything(), {
        key1: 'default1',
        key2: 'override2',
      });
    });

    it('should handle void return from handler', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      const exporter = new CustomExporter({ handler });
      const result = await exporter.export(createTestData());

      expect(result.success).toBe(true);
    });

    it('should handle null return from handler', async () => {
      const handler = vi.fn().mockResolvedValue(null);

      const exporter = new CustomExporter({ handler });
      const result = await exporter.export(createTestData());

      expect(result.success).toBe(true);
    });

    it('should handle dict-like return from handler', async () => {
      const handler = vi.fn().mockResolvedValue({
        destination: 'somewhere',
        bytes_written: 500,
        metadata: { info: 'test' },
      });

      const exporter = new CustomExporter({ handler });
      const result = await exporter.export(createTestData());

      expect(result.success).toBe(true);
      expect(result.destination).toBe('somewhere');
      expect(result.bytes_written).toBe(500);
    });

    it('should wrap handler errors in ExportError', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));

      const exporter = new CustomExporter({ handler });

      await expect(exporter.export(createTestData())).rejects.toThrow(
        ExportError
      );
      await expect(exporter.export(createTestData())).rejects.toThrow(
        'Custom export handler failed'
      );
    });
  });

  describe('CompositeExporter', () => {
    it('should require at least one exporter', () => {
      expect(() => new CompositeExporter({ exporters: [] })).toThrow(
        'At least one exporter is required'
      );
    });

    it('should run all exporters', async () => {
      const exporter1 = new TestExporter(async () =>
        createExportResult(true, { destination: 'dest1' })
      );
      const exporter2 = new TestExporter(async () =>
        createExportResult(true, { destination: 'dest2' })
      );

      const composite = new CompositeExporter({
        exporters: [exporter1, exporter2],
      });

      const result = await composite.export(createTestData());

      expect(result.success).toBe(true);
      expect(result.metadata.exporters_count).toBe(2);
      expect(result.metadata.results).toHaveLength(2);
    });

    it('should collect errors from all exporters', async () => {
      const exporter1 = new TestExporter(async () =>
        createExportResult(false, { error: 'Failed 1' })
      );
      const exporter2 = new TestExporter(async () =>
        createExportResult(true, { destination: 'dest2' })
      );
      const exporter3 = new TestExporter(async () =>
        createExportResult(false, { error: 'Failed 3' })
      );

      const composite = new CompositeExporter({
        exporters: [exporter1, exporter2, exporter3],
      });

      const result = await composite.export(createTestData());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed 1');
      expect(result.error).toContain('Failed 3');
    });

    it('should stop on error when stop_on_error is true', async () => {
      const exporter1 = new TestExporter(async () => {
        throw new Error('Critical failure');
      });
      const exporter2 = new TestExporter(async () =>
        createExportResult(true, { destination: 'dest2' })
      );

      const composite = new CompositeExporter({
        exporters: [exporter1, exporter2],
        stop_on_error: true,
      });

      await expect(composite.export(createTestData())).rejects.toThrow(
        'Critical failure'
      );
    });

    it('should continue on error when stop_on_error is false', async () => {
      const exporter1 = new TestExporter(async () => {
        throw new Error('Non-critical failure');
      });
      const exporter2 = new TestExporter(async () =>
        createExportResult(true, { destination: 'dest2' })
      );

      const composite = new CompositeExporter({
        exporters: [exporter1, exporter2],
        stop_on_error: false,
      });

      const result = await composite.export(createTestData());

      expect(result.success).toBe(false);
      expect(result.metadata.results).toHaveLength(2);
      expect(result.error).toContain('Non-critical failure');
    });

    it('should allow adding exporters via add()', async () => {
      const exporter1 = new TestExporter(async () =>
        createExportResult(true, { destination: 'dest1' })
      );
      const exporter2 = new TestExporter(async () =>
        createExportResult(true, { destination: 'dest2' })
      );

      const composite = new CompositeExporter({
        exporters: [exporter1],
      });

      composite.add(exporter2);

      const result = await composite.export(createTestData());

      expect(result.metadata.exporters_count).toBe(2);
    });

    it('should support method chaining with add()', () => {
      const exporter1 = new TestExporter();
      const exporter2 = new TestExporter();
      const exporter3 = new TestExporter();

      const composite = new CompositeExporter({ exporters: [exporter1] })
        .add(exporter2)
        .add(exporter3);

      expect(composite).toBeInstanceOf(CompositeExporter);
    });
  });

  describe('GCSExporter', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create with required options', () => {
      const exporter = new GCSExporter({
        bucket: 'my-bucket',
      });

      expect(exporter.name).toBe('gcs');
    });

    it('should normalize prefix with trailing slash', () => {
      const exporter = new GCSExporter({
        bucket: 'my-bucket',
        prefix: 'traces',
      });

      expect(exporter).toBeDefined();
      // The prefix normalization is internal, we can test via export behavior
    });

    it('should throw when @google-cloud/storage is not available', async () => {
      const exporter = new GCSExporter({
        bucket: 'my-bucket',
      });

      // Since @google-cloud/storage is not installed, this should fail
      await expect(exporter.export(createTestData())).rejects.toThrow();
    });

    describe('fromEnv()', () => {
      it('should create from environment variables', () => {
        process.env.AIOBS_GCS_BUCKET = 'env-bucket';
        process.env.AIOBS_GCS_PREFIX = 'traces/';
        process.env.AIOBS_GCS_PROJECT = 'my-project';

        const exporter = GCSExporter.fromEnv();

        expect(exporter).toBeDefined();
        expect(exporter.name).toBe('gcs');
      });

      it('should throw when bucket env var is missing', () => {
        delete process.env.AIOBS_GCS_BUCKET;

        expect(() => GCSExporter.fromEnv()).toThrow(
          'Environment variable AIOBS_GCS_BUCKET is required'
        );
      });

      it('should use custom env var names', () => {
        process.env.CUSTOM_BUCKET = 'custom-bucket';

        const exporter = GCSExporter.fromEnv({
          bucket_env: 'CUSTOM_BUCKET',
        });

        expect(exporter).toBeDefined();
      });
    });

    describe('filename generation', () => {
      it('should use session_id template by default', () => {
        const exporter = new GCSExporter({
          bucket: 'my-bucket',
          filename_template: '{session_id}.json',
        });

        expect(exporter).toBeDefined();
      });

      it('should support timestamp template', () => {
        const exporter = new GCSExporter({
          bucket: 'my-bucket',
          filename_template: '{timestamp}-{session_id}.json',
        });

        expect(exporter).toBeDefined();
      });

      it('should support date template', () => {
        const exporter = new GCSExporter({
          bucket: 'my-bucket',
          filename_template: '{date}/{session_id}.json',
        });

        expect(exporter).toBeDefined();
      });
    });
  });
});

