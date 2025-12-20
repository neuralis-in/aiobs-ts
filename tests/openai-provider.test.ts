import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wrapOpenAIClient } from '../src/providers/openai/index.js';
import { Collector } from '../src/collector.js';

describe('OpenAI Provider', () => {
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

  describe('wrapOpenAIClient()', () => {
    it('should wrap an OpenAI client', () => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn(),
          },
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      expect(wrapped).toBeDefined();
      expect(wrapped.chat).toBeDefined();
      expect(wrapped.chat.completions).toBeDefined();
      expect(wrapped.chat.completions.create).toBeDefined();
    });

    it('should intercept chat.completions.create calls', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        model: 'gpt-4',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello, world!',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockResponse),
          },
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      const response = await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response).toEqual(mockResponse);
      expect(mockClient.chat.completions.create).toHaveBeenCalledOnce();
      expect(recordedEvents).toHaveLength(1);
    });

    it('should record request details', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              id: 'resp-1',
              model: 'gpt-4',
              choices: [{ message: { content: 'Hi' } }],
            }),
          },
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        max_tokens: 100,
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        provider: string;
        api: string;
        request: {
          model: string;
          messages: unknown[];
          temperature: number;
          max_tokens: number;
        };
      };

      expect(event.provider).toBe('openai');
      expect(event.api).toBe('chat.completions.create');
      expect(event.request.model).toBe('gpt-4');
      expect(event.request.messages).toHaveLength(2);
      expect(event.request.temperature).toBe(0.7);
      expect(event.request.max_tokens).toBe(100);
    });

    it('should record response details', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              id: 'chatcmpl-xyz',
              model: 'gpt-4-turbo',
              choices: [
                {
                  message: {
                    content: 'This is the response',
                  },
                },
              ],
              usage: {
                prompt_tokens: 20,
                completion_tokens: 10,
                total_tokens: 30,
              },
            }),
          },
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        response: {
          id: string;
          model: string;
          text: string;
          usage: Record<string, number>;
        };
      };

      expect(event.response.id).toBe('chatcmpl-xyz');
      expect(event.response.model).toBe('gpt-4-turbo');
      expect(event.response.text).toBe('This is the response');
      expect(event.response.usage).toBeDefined();
      expect(event.response.usage.total_tokens).toBe(30);
    });

    it('should capture errors', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('API Error')),
          },
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await expect(
        wrapped.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Test' }],
        })
      ).rejects.toThrow('API Error');

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { error: string };
      expect(event.error).toContain('Error: API Error');
    });

    it('should track timing', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockImplementation(async () => {
              await new Promise((resolve) => setTimeout(resolve, 50));
              return {
                id: 'resp-1',
                choices: [{ message: { content: 'Done' } }],
              };
            }),
          },
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
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
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              id: 'resp-1',
              choices: [{ message: { content: 'Hi' } }],
            }),
          },
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { span_id: string };
      expect(event.span_id).toBeDefined();
      expect(event.span_id.length).toBe(36); // UUID format
    });

    it('should preserve other client properties', () => {
      const mockClient = {
        apiKey: 'sk-test-key',
        baseURL: 'https://api.openai.com',
        chat: {
          completions: {
            create: vi.fn(),
          },
        },
        models: {
          list: vi.fn(),
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      expect(wrapped.apiKey).toBe('sk-test-key');
      expect(wrapped.baseURL).toBe('https://api.openai.com');
      expect(wrapped.models).toBeDefined();
      expect(wrapped.models.list).toBeDefined();
    });

    it('should truncate long message arrays', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              id: 'resp-1',
              choices: [{ message: { content: 'Response' } }],
            }),
          },
        },
      };

      const wrapped = wrapOpenAIClient(mockClient, collector);

      const manyMessages = Array(10)
        .fill(null)
        .map((_, i) => ({ role: 'user', content: `Message ${i}` }));

      await wrapped.chat.completions.create({
        model: 'gpt-4',
        messages: manyMessages,
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        request: { messages: unknown[] };
      };

      // Should only capture first 3 messages
      expect(event.request.messages).toHaveLength(3);
    });
  });
});

