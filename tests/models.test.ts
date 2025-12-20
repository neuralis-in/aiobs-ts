import { describe, it, expect } from 'vitest';
import type {
  Session,
  SessionMeta,
  Event,
  FunctionEvent,
  ObservedEvent,
  ObservabilityExport,
  Callsite,
  TraceNode,
} from '../src/models/observability.js';

describe('Models', () => {
  describe('Session', () => {
    it('should have correct structure', () => {
      const meta: SessionMeta = {
        pid: 12345,
        cwd: '/home/user/project',
      };

      const session: Session = {
        id: 'session-123',
        name: 'test-session',
        started_at: 1234567890.123,
        ended_at: 1234567900.456,
        meta,
        labels: {
          environment: 'test',
          version: '1.0.0',
        },
      };

      expect(session.id).toBe('session-123');
      expect(session.name).toBe('test-session');
      expect(session.meta.pid).toBe(12345);
      expect(session.labels?.environment).toBe('test');
    });

    it('should allow null ended_at and labels', () => {
      const session: Session = {
        id: 'session-123',
        name: 'active-session',
        started_at: 1234567890.123,
        ended_at: null,
        meta: { pid: 1, cwd: '/' },
        labels: null,
      };

      expect(session.ended_at).toBeNull();
      expect(session.labels).toBeNull();
    });
  });

  describe('Callsite', () => {
    it('should have correct structure', () => {
      const callsite: Callsite = {
        file: 'src/index.ts',
        line: 42,
        function: 'main',
      };

      expect(callsite.file).toBe('src/index.ts');
      expect(callsite.line).toBe(42);
      expect(callsite.function).toBe('main');
    });

    it('should allow null values', () => {
      const callsite: Callsite = {
        file: null,
        line: null,
        function: null,
      };

      expect(callsite.file).toBeNull();
      expect(callsite.line).toBeNull();
      expect(callsite.function).toBeNull();
    });
  });

  describe('Event', () => {
    it('should have correct structure for provider events', () => {
      const event: Event = {
        provider: 'openai',
        api: 'chat.completions.create',
        request: { model: 'gpt-4', messages: [] },
        response: { id: 'resp-123', text: 'Hello' },
        error: null,
        started_at: 1234567890.0,
        ended_at: 1234567891.5,
        duration_ms: 1500,
        callsite: { file: 'app.ts', line: 10, function: 'chat' },
        span_id: 'span-abc',
        parent_span_id: null,
      };

      expect(event.provider).toBe('openai');
      expect(event.api).toBe('chat.completions.create');
      expect(event.duration_ms).toBe(1500);
    });
  });

  describe('FunctionEvent', () => {
    it('should have correct structure for function traces', () => {
      const event: FunctionEvent = {
        provider: 'function',
        api: 'myModule.processData',
        name: 'processData',
        module: 'myModule',
        args: ['input1', 123],
        kwargs: { option: true },
        result: { processed: true },
        error: null,
        started_at: 1234567890.0,
        ended_at: 1234567890.5,
        duration_ms: 500,
        callsite: null,
        span_id: 'span-def',
        parent_span_id: 'span-abc',
        enh_prompt: false,
        enh_prompt_id: null,
        auto_enhance_after: null,
      };

      expect(event.provider).toBe('function');
      expect(event.name).toBe('processData');
      expect(event.args).toEqual(['input1', 123]);
      expect(event.parent_span_id).toBe('span-abc');
    });

    it('should support enh_prompt feature', () => {
      const event: FunctionEvent = {
        provider: 'function',
        api: 'myPrompt',
        name: 'myPrompt',
        module: null,
        args: null,
        kwargs: null,
        result: null,
        error: null,
        started_at: 0,
        ended_at: 0,
        duration_ms: 0,
        callsite: null,
        span_id: 'span-1',
        parent_span_id: null,
        enh_prompt: true,
        enh_prompt_id: 'enh-123',
        auto_enhance_after: 10,
      };

      expect(event.enh_prompt).toBe(true);
      expect(event.enh_prompt_id).toBe('enh-123');
      expect(event.auto_enhance_after).toBe(10);
    });
  });

  describe('ObservedEvent', () => {
    it('should extend Event with session_id', () => {
      const event: ObservedEvent = {
        session_id: 'session-123',
        provider: 'openai',
        api: 'chat.completions.create',
        request: {},
        response: null,
        error: null,
        started_at: 0,
        ended_at: 0,
        duration_ms: 0,
        callsite: null,
        span_id: null,
        parent_span_id: null,
      };

      expect(event.session_id).toBe('session-123');
    });
  });

  describe('ObservabilityExport', () => {
    it('should have correct export structure', () => {
      const exportData: ObservabilityExport = {
        sessions: [],
        events: [],
        function_events: [],
        trace_tree: null,
        enh_prompt_traces: null,
        generated_at: 1234567890.123,
        version: 1,
      };

      expect(exportData.version).toBe(1);
      expect(exportData.sessions).toEqual([]);
      expect(exportData.trace_tree).toBeNull();
    });

    it('should support full export with data', () => {
      const exportData: ObservabilityExport = {
        sessions: [
          {
            id: 's1',
            name: 'test',
            started_at: 0,
            ended_at: 1,
            meta: { pid: 1, cwd: '/' },
            labels: null,
          },
        ],
        events: [
          {
            session_id: 's1',
            provider: 'openai',
            api: 'test',
            request: {},
            response: null,
            error: null,
            started_at: 0,
            ended_at: 0,
            duration_ms: 0,
            callsite: null,
            span_id: 'span-1',
            parent_span_id: null,
          },
        ],
        function_events: [],
        trace_tree: [
          {
            session_id: 's1',
            provider: 'openai',
            api: 'test',
            error: null,
            started_at: 0,
            ended_at: 0,
            duration_ms: 0,
            callsite: null,
            span_id: 'span-1',
            parent_span_id: null,
            event_type: 'provider',
            children: [],
          },
        ],
        enh_prompt_traces: ['enh-1', 'enh-2'],
        generated_at: 1234567890.123,
        version: 1,
      };

      expect(exportData.sessions).toHaveLength(1);
      expect(exportData.events).toHaveLength(1);
      expect(exportData.trace_tree).toHaveLength(1);
      expect(exportData.enh_prompt_traces).toHaveLength(2);
    });
  });

  describe('TraceNode', () => {
    it('should support nested structure', () => {
      const childNode: TraceNode = {
        session_id: 's1',
        provider: 'openai',
        api: 'chat.completions.create',
        error: null,
        started_at: 1,
        ended_at: 2,
        duration_ms: 1000,
        callsite: null,
        span_id: 'child-span',
        parent_span_id: 'parent-span',
        event_type: 'provider',
        children: [],
      };

      const parentNode: TraceNode = {
        session_id: 's1',
        provider: 'function',
        api: 'processRequest',
        name: 'processRequest',
        error: null,
        started_at: 0,
        ended_at: 3,
        duration_ms: 3000,
        callsite: null,
        span_id: 'parent-span',
        parent_span_id: null,
        event_type: 'function',
        children: [childNode],
      };

      expect(parentNode.children).toHaveLength(1);
      expect(parentNode.children[0].span_id).toBe('child-span');
      expect(parentNode.children[0].parent_span_id).toBe('parent-span');
    });
  });
});

