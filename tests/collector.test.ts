import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Collector } from '../src/collector.js';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Collector', () => {
  let collector: Collector;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    collector = new Collector();
    mockFetch.mockReset();
    // Save and clear the API key env var to ensure clean test state
    originalApiKey = process.env.AIOBS_API_KEY;
    delete process.env.AIOBS_API_KEY;
  });

  afterEach(() => {
    collector.reset();
    // Restore the original API key env var
    if (originalApiKey !== undefined) {
      process.env.AIOBS_API_KEY = originalApiKey;
    } else {
      delete process.env.AIOBS_API_KEY;
    }
  });

  describe('observe()', () => {
    it('should throw error when no API key is provided', async () => {
      await expect(collector.observe()).rejects.toThrow(
        'API key is required'
      );
    });

    it('should throw error when API key is invalid', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(
        collector.observe({ apiKey: 'invalid_key' })
      ).rejects.toThrow('Invalid API key');
    });

    it('should start session with valid API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          usage: {
            tier: 'free',
            traces_used: 0,
            traces_limit: 1000,
            is_rate_limited: false,
          },
        }),
      });

      const sessionId = await collector.observe({
        apiKey: 'aiobs_sk_valid',
        sessionName: 'test-session',
      });

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBe(36); // UUID format
    });

    it('should include custom labels', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, usage: {} }),
      });

      await collector.observe({
        apiKey: 'aiobs_sk_valid',
        labels: {
          environment: 'test',
          version: '1.0.0',
        },
      });

      const labels = collector.getLabels();
      expect(labels.environment).toBe('test');
      expect(labels.version).toBe('1.0.0');
    });

    it('should include system labels', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, usage: {} }),
      });

      await collector.observe({ apiKey: 'aiobs_sk_valid' });

      const labels = collector.getLabels();
      expect(labels.aiobs_sdk_version).toBeDefined();
      expect(labels.aiobs_node_version).toBeDefined();
      expect(labels.aiobs_hostname).toBeDefined();
      expect(labels.aiobs_os).toBeDefined();
    });

    it('should throw on rate limit exceeded', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          usage: {
            tier: 'free',
            traces_used: 1000,
            traces_limit: 1000,
            is_rate_limited: true,
          },
        }),
      });

      await expect(
        collector.observe({ apiKey: 'aiobs_sk_valid' })
      ).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('end()', () => {
    it('should end the current session', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, usage: {} }),
      });

      await collector.observe({ apiKey: 'aiobs_sk_valid' });
      collector.end();

      // Should throw because no active session
      expect(() => collector.getLabels()).toThrow('No active session');
    });

    it('should be idempotent when no session', () => {
      // Should not throw
      expect(() => collector.end()).not.toThrow();
    });
  });

  describe('Label management', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, usage: {} }),
      });
      await collector.observe({ apiKey: 'aiobs_sk_valid' });
    });

    it('should add a label', () => {
      collector.addLabel('custom_key', 'custom_value');
      const labels = collector.getLabels();
      expect(labels.custom_key).toBe('custom_value');
    });

    it('should reject invalid label keys', () => {
      expect(() => collector.addLabel('Invalid', 'value')).toThrow('invalid');
      expect(() => collector.addLabel('123key', 'value')).toThrow('invalid');
      expect(() => collector.addLabel('aiobs_reserved', 'value')).toThrow('reserved');
    });

    it('should reject long label values', () => {
      const longValue = 'x'.repeat(300);
      expect(() => collector.addLabel('key', longValue)).toThrow('exceeds maximum');
    });

    it('should set labels with merge', () => {
      collector.addLabel('existing', 'value1');
      collector.setLabels({ new_key: 'value2' }, true);

      const labels = collector.getLabels();
      expect(labels.existing).toBe('value1');
      expect(labels.new_key).toBe('value2');
    });

    it('should set labels without merge (preserving system labels)', () => {
      collector.addLabel('user_key', 'value1');
      collector.setLabels({ new_key: 'value2' }, false);

      const labels = collector.getLabels();
      expect(labels.user_key).toBeUndefined();
      expect(labels.new_key).toBe('value2');
      // System labels should be preserved
      expect(labels.aiobs_sdk_version).toBeDefined();
    });

    it('should remove a label', () => {
      collector.addLabel('to_remove', 'value');
      collector.removeLabel('to_remove');

      const labels = collector.getLabels();
      expect(labels.to_remove).toBeUndefined();
    });

    it('should not remove system labels', () => {
      expect(() => collector.removeLabel('aiobs_sdk_version')).toThrow('system label');
    });
  });

  describe('recordEvent()', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, usage: {} }),
      });
      await collector.observe({ apiKey: 'aiobs_sk_valid' });
    });

    it('should record an event', () => {
      collector.recordEvent({
        provider: 'openai',
        api: 'chat.completions.create',
        request: { model: 'gpt-4' },
        response: { id: 'resp-123' },
        error: null,
        started_at: Date.now() / 1000,
        ended_at: Date.now() / 1000,
        duration_ms: 100,
        callsite: null,
        span_id: 'span-1',
        parent_span_id: null,
      });

      // Event should be recorded (we can verify via flush)
      // This is more of a smoke test
    });

    it('should not record event when no active session', () => {
      collector.end();

      // Should not throw, just silently ignore
      expect(() =>
        collector.recordEvent({
          provider: 'openai',
          api: 'chat.completions.create',
          request: {},
          response: null,
          error: null,
          started_at: Date.now() / 1000,
          ended_at: Date.now() / 1000,
          duration_ms: 0,
          callsite: null,
          span_id: null,
          parent_span_id: null,
        })
      ).not.toThrow();
    });
  });

  describe('Span context', () => {
    it('should manage span IDs', () => {
      expect(collector.getCurrentSpanId()).toBeNull();

      const previous = collector.setCurrentSpanId('span-1');
      expect(previous).toBeNull();
      expect(collector.getCurrentSpanId()).toBe('span-1');

      collector.setCurrentSpanId('span-2');
      expect(collector.getCurrentSpanId()).toBe('span-2');

      collector.setCurrentSpanId(null);
      expect(collector.getCurrentSpanId()).toBeNull();
    });
  });

  describe('flush()', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, usage: {} }),
      });
      await collector.observe({ apiKey: 'aiobs_sk_valid' });
    });

    it('should flush to server', async () => {
      // Mock flush server call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'success' }),
      });
      // Mock usage recording
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, usage: {} }),
      });

      collector.recordEvent({
        provider: 'openai',
        api: 'test',
        request: {},
        response: null,
        error: null,
        started_at: Date.now() / 1000,
        ended_at: Date.now() / 1000,
        duration_ms: 0,
        callsite: null,
        span_id: 'span-1',
        parent_span_id: null,
      });

      const outputPath = await collector.flush({ persist: false });

      expect(outputPath).toBeNull();
      // Verify flush server was called
      expect(mockFetch).toHaveBeenCalledTimes(3); // validate + flush + usage
    });

    it('should return output path when persist is true', async () => {
      // Mock flush server call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'success' }),
      });

      // Use a temp file path
      const tempPath = `/tmp/aiobs-test-${Date.now()}.json`;

      const outputPath = await collector.flush({
        path: tempPath,
        persist: true,
      });

      expect(outputPath).toBe(tempPath);

      // Clean up
      try {
        const fs = await import('fs');
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    });
  });

  describe('reset()', () => {
    it('should clear all state', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, usage: {} }),
      });
      await collector.observe({ apiKey: 'aiobs_sk_valid' });

      collector.setCurrentSpanId('span-1');
      collector.reset();

      expect(collector.getCurrentSpanId()).toBeNull();
      expect(() => collector.getLabels()).toThrow('No active session');
    });
  });
});

