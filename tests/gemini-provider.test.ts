import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wrapGeminiClient, wrapGenerateContentResource } from '../src/providers/gemini/index.js';
import { Collector } from '../src/collector.js';

describe('Gemini Provider', () => {
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

  describe('wrapGeminiClient()', () => {
    it('should wrap a Gemini client with models resource', () => {
      const mockClient = {
        models: {
          generateContent: vi.fn(),
        },
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      expect(wrapped).toBeDefined();
      expect(wrapped.models).toBeDefined();
      expect(wrapped.models.generateContent).toBeDefined();
    });

    it('should wrap a VertexAI client with getGenerativeModel', () => {
      const mockModel = {
        generateContent: vi.fn(),
        startChat: vi.fn(),
      };

      const mockClient = {
        getGenerativeModel: vi.fn().mockReturnValue(mockModel),
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      expect(wrapped).toBeDefined();
      expect(wrapped.getGenerativeModel).toBeDefined();

      const model = wrapped.getGenerativeModel({ model: 'gemini-pro' });
      expect(model).toBeDefined();
      expect(model.generateContent).toBeDefined();
    });
  });

  describe('models.generateContent()', () => {
    it('should intercept generateContent calls', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello from Gemini!' }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue(mockResponse),
        },
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      const response = await wrapped.models.generateContent({
        model: 'gemini-pro',
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      });

      expect(response).toEqual(mockResponse);
      expect(mockClient.models.generateContent).toHaveBeenCalledOnce();
      expect(recordedEvents).toHaveLength(1);
    });

    it('should record request details', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [{ content: { parts: [{ text: 'Hi' }] } }],
          }),
        },
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      await wrapped.models.generateContent({
        model: 'gemini-1.5-pro',
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        config: { temperature: 0.7, maxOutputTokens: 100 },
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        provider: string;
        api: string;
        request: {
          model: string;
          contents: unknown[];
          config: Record<string, unknown>;
        };
      };

      expect(event.provider).toBe('gemini');
      expect(event.api).toBe('models.generateContent');
      expect(event.request.model).toBe('gemini-1.5-pro');
      expect(event.request.contents).toHaveLength(1);
      expect(event.request.config).toBeDefined();
      expect(event.request.config.temperature).toBe(0.7);
    });

    it('should record response details', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [{ text: 'This is the response' }],
                  role: 'model',
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 20,
              candidatesTokenCount: 10,
              totalTokenCount: 30,
            },
          }),
        },
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      await wrapped.models.generateContent({
        model: 'gemini-pro',
        contents: [{ role: 'user', parts: [{ text: 'Test' }] }],
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        response: {
          text: string;
          candidates: unknown[];
          usage: Record<string, number>;
        };
      };

      expect(event.response.text).toBe('This is the response');
      expect(event.response.candidates).toHaveLength(1);
      expect(event.response.usage).toBeDefined();
      expect(event.response.usage.total_token_count).toBe(30);
    });

    it('should capture errors', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      await expect(
        wrapped.models.generateContent({
          model: 'gemini-pro',
          contents: [{ role: 'user', parts: [{ text: 'Test' }] }],
        })
      ).rejects.toThrow('API Error');

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { error: string };
      expect(event.error).toContain('Error: API Error');
    });

    it('should track timing', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return {
              candidates: [{ content: { parts: [{ text: 'Done' }] } }],
            };
          }),
        },
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      await wrapped.models.generateContent({
        model: 'gemini-pro',
        contents: [{ role: 'user', parts: [{ text: 'Test' }] }],
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
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [{ content: { parts: [{ text: 'Hi' }] } }],
          }),
        },
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      await wrapped.models.generateContent({
        model: 'gemini-pro',
        contents: [{ role: 'user', parts: [{ text: 'Test' }] }],
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { span_id: string };
      expect(event.span_id).toBeDefined();
      expect(event.span_id.length).toBe(36); // UUID format
    });

    it('should handle string input', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [{ content: { parts: [{ text: 'Response' }] } }],
          }),
        },
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      await wrapped.models.generateContent('Hello, Gemini!');

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        request: { contents: string };
      };
      expect(event.request.contents).toBe('Hello, Gemini!');
    });

    it('should preserve other client properties', () => {
      const mockClient = {
        apiKey: 'test-api-key',
        models: {
          generateContent: vi.fn(),
          list: vi.fn(),
        },
        someOtherResource: {
          doSomething: vi.fn(),
        },
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      expect(wrapped.apiKey).toBe('test-api-key');
      expect(wrapped.models.list).toBeDefined();
      expect(wrapped.someOtherResource).toBeDefined();
      expect(wrapped.someOtherResource.doSomething).toBeDefined();
    });
  });

  describe('VertexAI pattern', () => {
    it('should intercept getGenerativeModel and generateContent', async () => {
      const mockResponse = {
        response: {
          candidates: [
            {
              content: {
                parts: [{ text: 'VertexAI response' }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 3,
            totalTokenCount: 8,
          },
        },
      };

      const mockModel = {
        generateContent: vi.fn().mockResolvedValue(mockResponse),
      };

      const mockClient = {
        getGenerativeModel: vi.fn().mockReturnValue(mockModel),
      };

      const wrapped = wrapGeminiClient(mockClient, collector);
      const model = wrapped.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      });

      expect(response).toEqual(mockResponse);
      expect(recordedEvents).toHaveLength(1);

      const event = recordedEvents[0] as {
        request: { model: string };
        response: { text: string };
      };
      expect(event.request.model).toBe('gemini-1.5-flash');
      expect(event.response.text).toBe('VertexAI response');
    });

    it('should intercept startChat and sendMessage', async () => {
      const mockResponse = {
        response: {
          candidates: [
            {
              content: {
                parts: [{ text: 'Chat response' }],
              },
            },
          ],
        },
      };

      const mockChatSession = {
        sendMessage: vi.fn().mockResolvedValue(mockResponse),
      };

      const mockModel = {
        startChat: vi.fn().mockReturnValue(mockChatSession),
      };

      const mockClient = {
        getGenerativeModel: vi.fn().mockReturnValue(mockModel),
      };

      const wrapped = wrapGeminiClient(mockClient, collector);
      const model = wrapped.getGenerativeModel({ model: 'gemini-pro' });
      const chat = model.startChat();

      const response = await chat.sendMessage('Hello from chat');

      expect(response).toEqual(mockResponse);
      expect(recordedEvents).toHaveLength(1);

      const event = recordedEvents[0] as {
        api: string;
        request: { contents: string };
      };
      expect(event.api).toBe('chat.sendMessage');
      expect(event.request.contents).toBe('Hello from chat');
    });
  });

  describe('wrapGenerateContentResource()', () => {
    it('should wrap generateContent on a models resource', async () => {
      const mockModels = {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: 'Wrapped response' }] } }],
        }),
        otherMethod: vi.fn(),
      };

      const wrapped = wrapGenerateContentResource(mockModels, collector);

      await wrapped.generateContent({
        model: 'gemini-pro',
        contents: 'Test prompt',
      });

      expect(recordedEvents).toHaveLength(1);
      expect(wrapped.otherMethod).toBe(mockModels.otherMethod);
    });
  });

  describe('Request content extraction', () => {
    it('should truncate long content arrays', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [{ content: { parts: [{ text: 'Response' }] } }],
          }),
        },
      };

      const wrapped = wrapGeminiClient(mockClient, collector);

      const manyContents = Array(10)
        .fill(null)
        .map((_, i) => ({ role: 'user', parts: [{ text: `Message ${i}` }] }));

      await wrapped.models.generateContent({
        model: 'gemini-pro',
        contents: manyContents,
      });

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as {
        request: { contents: unknown[] };
      };

      // Should only capture first 3 contents
      expect(event.request.contents).toHaveLength(3);
    });
  });
});

