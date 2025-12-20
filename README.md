# aiobs

AI Observability SDK for TypeScript - trace and monitor LLM calls.

## Installation

```bash
npm install aiobs
```

## Quick Start

```typescript
import OpenAI from 'openai';
import { observer, wrapOpenAIClient, observe } from 'aiobs';

// Create and wrap OpenAI client for automatic tracing
const openai = wrapOpenAIClient(new OpenAI(), observer);

// Start an observability session (requires API key)
await observer.observe({
  sessionName: 'my-session',
  apiKey: 'aiobs_sk_...', // or set AIOBS_API_KEY env var
});

// Make LLM calls - they're automatically traced
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello!' }],
});

// End session and flush traces (to file and remote server)
observer.end();
await observer.flush();
```

## Features

### API Key Authentication

aiobs requires an API key for usage tracking and remote trace storage:

```typescript
// Option 1: Pass directly
await observer.observe({ apiKey: 'aiobs_sk_...' });

// Option 2: Environment variable
// Set AIOBS_API_KEY=aiobs_sk_...
await observer.observe();
```

The SDK validates your API key on session start and will throw an error if:
- No API key is provided
- The API key is invalid
- Your rate limit has been exceeded

### OpenAI Instrumentation

Wrap your OpenAI client to automatically capture all chat completion calls:

```typescript
import OpenAI from 'openai';
import { observer, wrapOpenAIClient } from 'aiobs';

const openai = wrapOpenAIClient(new OpenAI(), observer);

// All chat.completions.create calls are now traced
await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'What is TypeScript?' }],
});
```

### Function Tracing

Use the `observe` wrapper to trace your own functions:

```typescript
import { observe } from 'aiobs';

// Wrap a function for tracing
const processQuery = observe(async function processQuery(query: string) {
  // Your logic here
  return result;
});

// With options
const analyzeText = observe(
  async function analyzeText(text: string) {
    // Your logic here
    return analysis;
  },
  { name: 'text_analysis', captureArgs: true, captureResult: true }
);
```

### Nested Tracing

Traces automatically capture parent-child relationships:

```typescript
const outerFunction = observe(async function outerFunction() {
  // This creates a child span linked to outerFunction
  await innerFunction();
});

const innerFunction = observe(async function innerFunction() {
  // OpenAI calls here are also linked as children
  await openai.chat.completions.create({ ... });
});
```

### Session Labels

Add metadata to your sessions for filtering and categorization:

```typescript
// At session start
await observer.observe({
  sessionName: 'production-run',
  labels: {
    environment: 'production',
    user_id: 'user123',
    version: '1.0.0',
  },
});

// Or dynamically during the session
observer.addLabel('request_id', 'req-abc123');
observer.setLabels({ batch_id: 'batch-1' }, true); // merge with existing
```

### Environment Variable Labels

Set labels via environment variables (prefixed with `AIOBS_LABEL_`):

```bash
AIOBS_LABEL_ENVIRONMENT=production
AIOBS_LABEL_SERVICE=my-service
```

These are automatically included in all sessions.

### Remote Trace Storage

When you call `flush()`, traces are automatically sent to the aiobs server for:
- Centralized storage and querying
- Usage tracking
- Analysis and insights

```typescript
// Traces are written locally AND sent to the server
await observer.flush();

// Skip local file, only send to server
await observer.flush({ persist: false });
```

## API Reference

### `observer` (Collector singleton)

| Method | Description |
|--------|-------------|
| `observe(options?)` | Start a new session (async). Returns session ID. |
| `end()` | End the current session. |
| `flush(options?)` | Write traces to file and server (async). |
| `addLabel(key, value)` | Add a label to current session. |
| `setLabels(labels, merge?)` | Set/merge labels on current session. |
| `removeLabel(key)` | Remove a label from current session. |
| `getLabels()` | Get all labels for current session. |
| `reset()` | Reset collector state (for testing). |

### `observe(fn, options?)`

Wrap a function for tracing.

**Options:**
- `name?: string` - Custom name for the trace (default: function name)
- `captureArgs?: boolean` - Capture function arguments (default: true)
- `captureResult?: boolean` - Capture return value (default: true)
- `enhPrompt?: boolean` - Include in enhanced prompt traces (default: false)

### `wrapOpenAIClient(client, collector)`

Wrap an OpenAI client instance for automatic instrumentation.

```typescript
const openai = wrapOpenAIClient(new OpenAI(), observer);
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AIOBS_API_KEY` | API key for authentication |
| `AIOBS_DEBUG` | Set to any value to enable debug logging |
| `AIOBS_LABEL_*` | Auto-included labels (e.g., `AIOBS_LABEL_ENV=prod`) |
| `AIOBS_FLUSH_SERVER_URL` | Override flush server URL (for self-hosted) |
| `LLM_OBS_OUT` | Default output file path |

## Output Format

Traces are written as JSON with the following structure:

```json
{
  "sessions": [...],
  "events": [...],
  "function_events": [...],
  "trace_tree": [...],
  "enh_prompt_traces": [...],
  "generated_at": 1234567890.123,
  "version": 1
}
```

## License

MIT
