/**
 * Standalone example demonstrating the observe function for function tracing.
 *
 * This example shows how to trace regular TypeScript functions (sync and async)
 * without requiring any external API keys. Run with:
 *
 *   npx tsx example/observe-decorator/index.ts
 */

import * as fs from 'fs';
import { observer, observe, withObserve } from '../../src/index.js';

// =============================================================================
// Example 1: Basic function tracing
// =============================================================================

const fibonacci = observe(function fibonacci(n: number): number {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
});

// =============================================================================
// Example 2: Custom name for the trace
// =============================================================================

const transformData = observe(function transformData(data: number[]): number[] {
  return data.map((x) => x * 2);
}, { name: 'data_transform' });

// =============================================================================
// Example 3: Async function tracing
// =============================================================================

const fetchSimulated = observe(async function fetchSimulated(
  url: string,
  delay: number = 100
): Promise<{ url: string; status: number; data: string }> {
  await new Promise((resolve) => setTimeout(resolve, delay));
  return { url, status: 200, data: `Response from ${url}` };
});

// =============================================================================
// Example 4: Hiding sensitive arguments
// =============================================================================

const authenticate = observe(function authenticate(
  username: string,
  password: string
): boolean {
  return username === 'admin' && password === 'secret';
}, { captureArgs: false });

// =============================================================================
// Example 5: Hiding large return values
// =============================================================================

const generateLargeData = observe(function generateLargeData(size: number): number[] {
  return Array.from({ length: size }, (_, i) => i);
}, { captureResult: false });

// =============================================================================
// Example 6: Pipeline of traced functions
// =============================================================================

const fetchItems = observe(function fetchItems(): number[] {
  // Simulate work
  const start = Date.now();
  while (Date.now() - start < 50) { /* busy wait */ }
  return [1, 2, 3, 4, 5];
}, { name: 'pipeline_fetch' });

const processItems = observe(function processItems(items: number[]): number[] {
  // Simulate work
  const start = Date.now();
  while (Date.now() - start < 30) { /* busy wait */ }
  return items.map((x) => x ** 2);
}, { name: 'pipeline_process' });

const aggregateResults = observe(function aggregateResults(
  items: number[]
): { sum: number; count: number; items: number[] } {
  // Simulate work
  const start = Date.now();
  while (Date.now() - start < 20) { /* busy wait */ }
  return { sum: items.reduce((a, b) => a + b, 0), count: items.length, items };
}, { name: 'pipeline_aggregate' });

const runPipeline = observe(function runPipeline(): { sum: number; count: number; items: number[] } {
  const items = fetchItems();
  const processed = processItems(items);
  return aggregateResults(processed);
}, { name: 'full_pipeline' });

// =============================================================================
// Example 7: Error handling
// =============================================================================

const divide = observe(function divide(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
});

// =============================================================================
// Example 8: Using withObserve (inline tracing)
// =============================================================================

async function inlineExample(): Promise<string> {
  return withObserve('inline_computation', () => {
    // Some inline computation
    return 'computed result';
  });
}

// =============================================================================
// Main
// =============================================================================

const main = observe(async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('observe Function Example');
  console.log('='.repeat(60));

  // Example 1: Basic tracing
  console.log('\n1. Basic function tracing (Fibonacci):');
  const fibResult = fibonacci(10);
  console.log(`   fibonacci(10) = ${fibResult}`);

  // Example 2: Custom name
  console.log('\n2. Custom trace name:');
  const transformResult = transformData([1, 2, 3, 4, 5]);
  console.log(`   transformData([1,2,3,4,5]) = [${transformResult}]`);

  // Example 3: Async function
  console.log('\n3. Async function tracing:');
  const fetchResult = await fetchSimulated('https://api.example.com/data');
  console.log(`   fetchSimulated() = ${JSON.stringify(fetchResult)}`);

  // Example 4: Hidden args (for sensitive data)
  console.log('\n4. Hidden arguments (password not captured):');
  const authResult = authenticate('admin', 'secret');
  console.log(`   authenticate() = ${authResult}`);

  // Example 5: Hidden result (for large data)
  console.log('\n5. Hidden result (large list not captured):');
  const largeData = generateLargeData(10000);
  console.log(`   generateLargeData(10000) returned ${largeData.length} items`);

  // Example 6: Pipeline with nested traces
  console.log('\n6. Pipeline (nested function traces):');
  const pipelineResult = runPipeline();
  console.log(`   runPipeline() = ${JSON.stringify(pipelineResult)}`);

  // Example 7: Error handling
  console.log('\n7. Error handling (division by zero):');
  try {
    divide(10, 0);
  } catch {
    console.log('   Caught Error (error is captured in trace)');
  }

  // Example 8: Inline tracing
  console.log('\n8. Inline tracing with withObserve:');
  const inlineResult = await inlineExample();
  console.log(`   inlineExample() = ${inlineResult}`);
});

async function run(): Promise<void> {
  // Start observability session with labels
  await observer.observe({
    sessionName: 'observe-decorator-demo',
    labels: {
      environment: 'development',
      example: 'observe_decorator',
      demo_type: 'function_tracing',
    },
  });

  try {
    await main();
  } catch (e) {
    console.error('Error:', e);
  } finally {
    // End session and flush to JSON
    observer.end();
    const outPath = await observer.flush();

    console.log('\n' + '='.repeat(60));
    console.log(`Observability data written to: ${outPath}`);
    console.log('='.repeat(60));

    // Show a preview of what was captured
    if (outPath) {
      const data = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      const session = data.sessions[0];
      console.log(`\nSession: ${session.name}`);

      // Show labels
      if (session.labels) {
        console.log('\nLabels:');
        for (const [key, value] of Object.entries(session.labels)) {
          if (!key.startsWith('aiobs_')) {
            console.log(`  ${key}: ${value}`);
          }
        }
      }

      console.log(`\nTotal function events: ${data.function_events?.length ?? 0}`);
      console.log('\nCaptured traces:');
      for (const ev of data.function_events ?? []) {
        const errorMarker = ev.error ? ' [ERROR]' : '';
        const argsPreview = JSON.stringify(ev.args ?? []).slice(0, 40);
        console.log(`  - ${ev.name}: ${ev.duration_ms?.toFixed(2)}ms${errorMarker}`);
        if (ev.args) {
          console.log(`    args: ${argsPreview}...`);
        }
      }
    }
  }
}

run().catch(console.error);

