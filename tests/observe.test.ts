import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { observe, withObserve, setObserver } from '../src/observe.js';
import { Collector } from '../src/collector.js';
import { initTracer, resetTracer } from '../src/tracer.js';

describe('observe()', () => {
  let collector: Collector;
  let recordedEvents: unknown[];

  beforeEach(() => {
    // Initialize OTel tracer for context propagation
    initTracer();

    collector = new Collector();
    recordedEvents = [];

    // Mock recordEvent to capture events
    vi.spyOn(collector, 'recordEvent').mockImplementation((event) => {
      recordedEvents.push(event);
    });

    // Set up the global observer
    setObserver(collector);
  });

  afterEach(() => {
    collector.reset();
    resetTracer();
    vi.restoreAllMocks();
  });

  describe('sync functions', () => {
    it('should wrap a sync function', () => {
      const add = observe(function add(a: number, b: number) {
        return a + b;
      });

      const result = add(2, 3);

      expect(result).toBe(5);
      expect(recordedEvents).toHaveLength(1);
    });

    it('should capture function name', () => {
      const namedFunc = observe(function namedFunction() {
        return 'hello';
      });

      namedFunc();

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { name: string };
      expect(event.name).toBe('namedFunction');
    });

    it('should capture arguments', () => {
      const greet = observe(function greet(name: string, age: number) {
        return `Hello ${name}, you are ${age}`;
      });

      greet('Alice', 30);

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { args: unknown[] };
      expect(event.args).toEqual(['Alice', 30]);
    });

    it('should capture result', () => {
      const multiply = observe(function multiply(a: number, b: number) {
        return a * b;
      });

      multiply(4, 5);

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { result: unknown };
      expect(event.result).toBe(20);
    });

    it('should capture errors', () => {
      const throwError = observe(function throwError() {
        throw new Error('Test error');
      });

      expect(() => throwError()).toThrow('Test error');

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { error: string };
      expect(event.error).toContain('Error: Test error');
    });

    it('should respect captureArgs: false', () => {
      const secret = observe(
        function secret(password: string) {
          return password.length;
        },
        { captureArgs: false }
      );

      secret('super-secret');

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { args: unknown[] | null };
      expect(event.args).toBeNull();
    });

    it('should respect captureResult: false', () => {
      const compute = observe(
        function compute() {
          return 'sensitive data';
        },
        { captureResult: false }
      );

      compute();

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { result: unknown };
      expect(event.result).toBeNull();
    });

    it('should use custom name', () => {
      const fn = observe(
        function originalName() {
          return 1;
        },
        { name: 'customName' }
      );

      fn();

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { name: string };
      expect(event.name).toBe('customName');
    });
  });

  describe('async functions', () => {
    it('should wrap an async function', async () => {
      const asyncAdd = observe(async function asyncAdd(a: number, b: number) {
        return a + b;
      });

      const result = await asyncAdd(2, 3);

      expect(result).toBe(5);
      expect(recordedEvents).toHaveLength(1);
    });

    it('should capture async result', async () => {
      const fetchData = observe(async function fetchData() {
        return { id: 1, name: 'Test' };
      });

      await fetchData();

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { result: unknown };
      expect(event.result).toEqual({ id: 1, name: 'Test' });
    });

    it('should capture async errors', async () => {
      const asyncError = observe(async function asyncError() {
        throw new Error('Async error');
      });

      await expect(asyncError()).rejects.toThrow('Async error');

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { error: string };
      expect(event.error).toContain('Error: Async error');
    });

    it('should track duration', async () => {
      const slowFunc = observe(async function slowFunc() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      });

      await slowFunc();

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { duration_ms: number };
      expect(event.duration_ms).toBeGreaterThan(40);
    });
  });

  describe('span context', () => {
    it('should generate unique span IDs', () => {
      const fn1 = observe(function fn1() {
        return 1;
      });
      const fn2 = observe(function fn2() {
        return 2;
      });

      fn1();
      fn2();

      expect(recordedEvents).toHaveLength(2);
      const event1 = recordedEvents[0] as { span_id: string };
      const event2 = recordedEvents[1] as { span_id: string };
      expect(event1.span_id).not.toBe(event2.span_id);
    });

    it('should link parent-child spans', () => {
      const child = observe(function child() {
        return 'child result';
      });

      const parent = observe(function parent() {
        return child();
      });

      parent();

      expect(recordedEvents).toHaveLength(2);
      const parentEvent = recordedEvents[1] as { span_id: string };
      const childEvent = recordedEvents[0] as { parent_span_id: string };
      expect(childEvent.parent_span_id).toBe(parentEvent.span_id);
    });

    it('should link nested async spans', async () => {
      const innerAsync = observe(async function innerAsync() {
        return 'inner';
      });

      const outerAsync = observe(async function outerAsync() {
        return await innerAsync();
      });

      await outerAsync();

      expect(recordedEvents).toHaveLength(2);
      const outerEvent = recordedEvents[1] as { span_id: string };
      const innerEvent = recordedEvents[0] as { parent_span_id: string };
      expect(innerEvent.parent_span_id).toBe(outerEvent.span_id);
    });
  });

  describe('enhPrompt option', () => {
    it('should set enh_prompt flag', () => {
      const enhancedFn = observe(
        function enhancedFn() {
          return 'enhanced';
        },
        { enhPrompt: true }
      );

      enhancedFn();

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { enh_prompt: boolean; enh_prompt_id: string };
      expect(event.enh_prompt).toBe(true);
      expect(event.enh_prompt_id).toBeDefined();
    });

    it('should not set enh_prompt by default', () => {
      const normalFn = observe(function normalFn() {
        return 'normal';
      });

      normalFn();

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0] as { enh_prompt: boolean; enh_prompt_id: string | null };
      expect(event.enh_prompt).toBe(false);
      expect(event.enh_prompt_id).toBeNull();
    });
  });
});

describe('withObserve()', () => {
  let collector: Collector;
  let recordedEvents: unknown[];

  beforeEach(() => {
    collector = new Collector();
    recordedEvents = [];

    vi.spyOn(collector, 'recordEvent').mockImplementation((event) => {
      recordedEvents.push(event);
    });

    setObserver(collector);
  });

  afterEach(() => {
    collector.reset();
    vi.restoreAllMocks();
  });

  it('should create a wrapper with options', () => {
    const traced = withObserve({ name: 'tracedOperation' });
    const fn = traced(function () {
      return 42;
    });

    fn();

    expect(recordedEvents).toHaveLength(1);
    const event = recordedEvents[0] as { name: string };
    expect(event.name).toBe('tracedOperation');
  });

  it('should work with async functions', async () => {
    const traced = withObserve({ captureResult: true });
    const asyncFn = traced(async function () {
      return 'async result';
    });

    const result = await asyncFn();

    expect(result).toBe('async result');
    expect(recordedEvents).toHaveLength(1);
  });
});

