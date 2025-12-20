import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wrapOpenAIClient } from '../src/providers/openai/index.js';
import { Collector } from '../src/collector.js';

describe('OpenAI Embeddings Provider', () => {
  let collector: Collector;
  let recordedEvents: unknown[];

  beforeEach(() => {
    collector = new Collector();
    recordedEvents = [];

    vi.spyOn(collector, 'recordEvent').mockImplementation((event) => {
      recordedEvents.push(event);
    });
  });

  afterEach(() => {
    collector.reset();
    vi.restoreAllMocks();
  });

  describe('embeddings.create()', () => {
    it('should wrap an OpenAI client with embeddings', () => {
      const mockClient = {
        embeddings: {
          create: vi.fn(),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      expect(wrapped).toBeDefined();
      expect(wrapped.embeddings).toBeDefined();
      expect(wrapped.embeddings.create).toBeDefined();
    });

    it('should intercept embeddings.create calls', async () => {
      const mockResponse = {
        object: 'list',
        model: 'text-embedding-3-small',
        data: [
          {
            object: 'embedding',
            index: 0,
            embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
          },
        ],
        usage: {
          prompt_tokens: 5,
          total_tokens: 5,
        },
      };

      const mockClient = {
        embeddings: {
          create: vi.fn().mockResolvedValue(mockResponse),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      const response = await wrapped.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Hello world',
      });

      expect(response).toEqual(mockResponse);
      expect(mockClient.embeddings.create).toHaveBeenCalledOnce();
      expect(recordedEvents).toHaveLength(1);
    });

    it('should record request details', async () => {
      const mockClient = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            model: 'text-embedding-3-large',
            data: [{ embedding: [0.1, 0.2], index: 0 }],
          }),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await wrapped.embeddings.create({
        model: 'text-embedding-3-large',
        input: 'Test input',
        encoding_format: 'float',
        dimensions: 256,
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        provider: string;
        api: string;
        request: {
          model: string;
          input: string;
          encoding_format: string;
          dimensions: number;
        };
      };

      expect(event.provider).toBe('openai');
      expect(event.api).toBe('embeddings.create');
      expect(event.request.model).toBe('text-embedding-3-large');
      expect(event.request.input).toBe('Test input');
      expect(event.request.encoding_format).toBe('float');
      expect(event.request.dimensions).toBe(256);
    });

    it('should record response details', async () => {
      const mockClient = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            id: 'emb-123',
            object: 'list',
            model: 'text-embedding-3-small',
            data: [
              { object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] },
              { object: 'embedding', index: 1, embedding: [0.4, 0.5, 0.6] },
            ],
            usage: {
              prompt_tokens: 10,
              total_tokens: 10,
            },
          }),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await wrapped.embeddings.create({
        model: 'text-embedding-3-small',
        input: ['Hello', 'World'],
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        response: {
          id: string;
          model: string;
          data: Array<{ embedding: number[] }>;
          usage: Record<string, number>;
          embedding_dimensions: number;
        };
      };

      expect(event.response.model).toBe('text-embedding-3-small');
      expect(event.response.data).toHaveLength(2);
      expect(event.response.usage.total_tokens).toBe(10);
      expect(event.response.embedding_dimensions).toBe(3);
    });

    it('should capture errors', async () => {
      const mockClient = {
        embeddings: {
          create: vi.fn().mockRejectedValue(new Error('Invalid model')),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await expect(
        wrapped.embeddings.create({
          model: 'invalid-model',
          input: 'Test',
        })
      ).rejects.toThrow('Invalid model');

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { error: string };
      expect(event.error).toContain('Error: Invalid model');
    });

    it('should track timing', async () => {
      const mockClient = {
        embeddings: {
          create: vi.fn().mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return {
              data: [{ embedding: [0.1, 0.2], index: 0 }],
            };
          }),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await wrapped.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Test',
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        started_at: number;
        ended_at: number;
        duration_ms: number;
      };

      expect(event.started_at).toBeDefined();
      expect(event.ended_at).toBeDefined();
      expect(event.ended_at).toBeGreaterThan(event.started_at);
      expect(event.duration_ms).toBeGreaterThan(40);
    });

    it('should generate span IDs', async () => {
      const mockClient = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [{ embedding: [0.1], index: 0 }],
          }),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await wrapped.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Test',
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { span_id: string };
      expect(event.span_id).toBeDefined();
      expect(event.span_id.length).toBe(36); // UUID format
    });

    it('should handle array input', async () => {
      const mockClient = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [
              { embedding: [0.1], index: 0 },
              { embedding: [0.2], index: 1 },
              { embedding: [0.3], index: 2 },
            ],
          }),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await wrapped.embeddings.create({
        model: 'text-embedding-3-small',
        input: ['Text 1', 'Text 2', 'Text 3'],
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        request: { input: string[] };
      };
      expect(event.request.input).toEqual(['Text 1', 'Text 2', 'Text 3']);
    });

    it('should truncate long input arrays', async () => {
      const mockClient = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: Array(10)
              .fill(null)
              .map((_, i) => ({ embedding: [0.1], index: i })),
          }),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      const manyInputs = Array(10)
        .fill(null)
        .map((_, i) => `Text ${i}`);

      await wrapped.embeddings.create({
        model: 'text-embedding-3-small',
        input: manyInputs,
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        request: { input: string[] };
      };

      // Should only capture first 3 inputs
      expect(event.request.input).toHaveLength(3);
    });

    it('should include user parameter when provided', async () => {
      const mockClient = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [{ embedding: [0.1], index: 0 }],
          }),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await wrapped.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Test',
        user: 'user-123',
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        request: { user: string };
      };
      expect(event.request.user).toBe('user-123');
    });
  });

  describe('Combined chat.completions and embeddings', () => {
    it('should wrap both APIs on the same client', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              id: 'chat-1',
              choices: [{ message: { content: 'Hello!' } }],
            }),
          },
        },
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [{ embedding: [0.1, 0.2], index: 0 }],
          }),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      // Call both APIs
      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      await wrapped.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Hello',
      });

      expect(recordedEvents).toHaveLength(2);

      const chatEvent = recordedEvents[0] as { api: string };
      const embeddingsEvent = recordedEvents[1] as { api: string };

      expect(chatEvent.api).toBe('chat.completions.create');
      expect(embeddingsEvent.api).toBe('embeddings.create');
    });
  });
});

