/**
 * Collector for managing observability sessions and events.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  Session,
  SessionMeta,
  Event,
  FunctionEvent,
  ObservedEvent,
  ObservedFunctionEvent,
  ObservabilityExport,
  TraceNode,
} from './models/observability.js';

// SDK version for system labels
const SDK_VERSION = '0.1.0';

// Default shepherd server URL for usage tracking
const SHEPHERD_SERVER_URL = 'https://shepherd-api-48963996968.us-central1.run.app';

// Default flush server URL for trace storage
const AIOBS_FLUSH_SERVER_URL = 'https://aiobs-flush-server-48963996968.us-central1.run.app';

// Label validation constants
const LABEL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const LABEL_VALUE_MAX_LENGTH = 256;
const LABEL_MAX_COUNT = 64;
const LABEL_RESERVED_PREFIX = 'aiobs_';
const LABEL_ENV_PREFIX = 'AIOBS_LABEL_';

// Context for tracking current span (for nested tracing)
let currentSpanId: string | null = null;

/**
 * Simple logger for debug output.
 */
const logger = {
  debug: (message: string, ...args: unknown[]) => {
    if (process.env.AIOBS_DEBUG) {
      console.debug(`[aiobs] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(`[aiobs] ${message}`, ...args);
  },
};

/**
 * Validate a label key format.
 */
function validateLabelKey(key: string): void {
  if (typeof key !== 'string') {
    throw new Error(`Label key must be a string, got ${typeof key}`);
  }
  if (key.startsWith(LABEL_RESERVED_PREFIX)) {
    throw new Error(`Label key '${key}' uses reserved prefix '${LABEL_RESERVED_PREFIX}'`);
  }
  if (!LABEL_KEY_PATTERN.test(key)) {
    throw new Error(
      `Label key '${key}' is invalid. Keys must match pattern ^[a-z][a-z0-9_]{0,62}$`
    );
  }
}

/**
 * Validate a label value.
 */
function validateLabelValue(value: string, key: string = ''): void {
  if (typeof value !== 'string') {
    throw new Error(`Label value for '${key}' must be a string, got ${typeof value}`);
  }
  if (value.length > LABEL_VALUE_MAX_LENGTH) {
    throw new Error(
      `Label value for '${key}' exceeds maximum length of ${LABEL_VALUE_MAX_LENGTH} characters`
    );
  }
}

/**
 * Validate a dictionary of labels.
 */
function validateLabels(labels: Record<string, string>): void {
  if (typeof labels !== 'object' || labels === null) {
    throw new Error(`Labels must be an object, got ${typeof labels}`);
  }
  if (Object.keys(labels).length > LABEL_MAX_COUNT) {
    throw new Error(
      `Too many labels (${Object.keys(labels).length}). Maximum allowed is ${LABEL_MAX_COUNT}.`
    );
  }
  for (const [key, value] of Object.entries(labels)) {
    validateLabelKey(key);
    validateLabelValue(value, key);
  }
}

/**
 * Get labels from environment variables.
 */
function getEnvLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(LABEL_ENV_PREFIX) && value) {
      const labelKey = key.slice(LABEL_ENV_PREFIX.length).toLowerCase();
      if (labelKey && LABEL_KEY_PATTERN.test(labelKey)) {
        labels[labelKey] = value.slice(0, LABEL_VALUE_MAX_LENGTH);
      }
    }
  }
  return labels;
}

/**
 * Get system-generated labels.
 */
function getSystemLabels(): Record<string, string> {
  return {
    aiobs_sdk_version: SDK_VERSION,
    aiobs_node_version: process.version,
    aiobs_hostname: os.hostname().slice(0, LABEL_VALUE_MAX_LENGTH),
    aiobs_os: os.platform(),
  };
}

/**
 * Build a nested tree structure from flat events using span_id/parent_span_id.
 */
function buildTraceTree(events: Array<ObservedEvent | ObservedFunctionEvent>): TraceNode[] {
  if (events.length === 0) {
    return [];
  }

  const eventsBySpan = new Map<string, TraceNode>();

  // First pass: create nodes
  for (const ev of events) {
    const spanId = ev.span_id;
    if (spanId) {
      const node: TraceNode = {
        ...ev,
        event_type: 'provider' in ev && ev.provider === 'function' ? 'function' : 'provider',
        children: [],
      };
      eventsBySpan.set(spanId, node);
    }
  }

  // Second pass: build tree by linking children to parents
  const roots: TraceNode[] = [];
  for (const ev of events) {
    const spanId = ev.span_id;
    const parentId = ev.parent_span_id;

    const nodeData: TraceNode = {
      ...ev,
      event_type: 'provider' in ev && ev.provider === 'function' ? 'function' : 'provider',
      children: [],
    };

    if (!spanId) {
      if (parentId && eventsBySpan.has(parentId)) {
        eventsBySpan.get(parentId)!.children.push(nodeData);
      } else {
        roots.push(nodeData);
      }
      continue;
    }

    const node = eventsBySpan.get(spanId)!;
    if (parentId && eventsBySpan.has(parentId)) {
      eventsBySpan.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort roots and children by started_at
  function sortByTime(nodes: TraceNode[]): void {
    nodes.sort((a, b) => a.started_at - b.started_at);
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortByTime(node.children);
      }
    }
  }

  sortByTime(roots);
  return roots;
}

/**
 * Extract enh_prompt_id values from the trace tree.
 */
function extractEnhPromptTraces(traceTree: TraceNode[]): string[] {
  const result: string[] = [];

  function walk(nodes: TraceNode[]): void {
    for (const node of nodes) {
      if (node.enh_prompt === true && node.enh_prompt_id) {
        result.push(node.enh_prompt_id);
      }
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  }

  walk(traceTree);
  return result;
}

export interface ObserveOptions {
  /** Optional name for the session */
  sessionName?: string;
  /** API key for usage tracking with shepherd-server */
  apiKey?: string;
  /** Optional dictionary of labels for filtering */
  labels?: Record<string, string>;
}

export interface FlushOptions {
  /** Output file path */
  path?: string;
  /** Whether to include the nested trace_tree structure (default: true) */
  includeTraceTree?: boolean;
  /** If true, dump observations to file. If false, skip file creation (default: true) */
  persist?: boolean;
  /** Optional custom exporter instance */
  exporter?: BaseExporter;
  /** Additional options passed to the exporter */
  exporterOptions?: Record<string, unknown>;
}

/**
 * Base exporter interface for type compatibility.
 */
export interface BaseExporter {
  name: string;
  export(data: ObservabilityExport, options?: Record<string, unknown>): Promise<ExportResult>;
  validate?(data: ObservabilityExport): boolean;
}

/**
 * Result from an exporter.
 */
export interface ExportResult {
  success: boolean;
  destination?: string | null;
  bytes_written?: number | null;
  metadata: Record<string, unknown>;
  error?: string | null;
}

export interface UsageInfo {
  tier: string;
  traces_used: number;
  traces_limit: number;
  traces_remaining: number;
  is_rate_limited: boolean;
}

export class Collector {
  private sessions = new Map<string, Session>();
  private events = new Map<string, Array<Event | FunctionEvent>>();
  private activeSession: string | null = null;
  private apiKey: string | null = null;

  /**
   * Enable instrumentation and start a new session.
   * 
   * @throws Error if no API key is provided or API key is invalid
   */
  async observe(options: ObserveOptions = {}): Promise<string> {
    const { sessionName, apiKey, labels } = options;

    // Store API key (parameter takes precedence over env var)
    this.apiKey = apiKey ?? process.env.AIOBS_API_KEY ?? null;

    if (!this.apiKey) {
      throw new Error(
        'API key is required. Provide apiKey parameter or set AIOBS_API_KEY environment variable.'
      );
    }

    // Validate API key with shepherd server
    await this.validateApiKey();

    // Build merged labels: system < env vars < explicit
    const mergedLabels: Record<string, string> = {
      ...getSystemLabels(),
      ...getEnvLabels(),
    };

    if (labels) {
      validateLabels(labels);
      Object.assign(mergedLabels, labels);
    }

    const sessionId = randomUUID();
    const now = Date.now() / 1000;

    const meta: SessionMeta = {
      pid: process.pid,
      cwd: process.cwd(),
    };

    const session: Session = {
      id: sessionId,
      name: sessionName ?? sessionId,
      started_at: now,
      ended_at: null,
      meta,
      labels: Object.keys(mergedLabels).length > 0 ? mergedLabels : null,
    };

    this.sessions.set(sessionId, session);
    this.events.set(sessionId, []);
    this.activeSession = sessionId;

    return sessionId;
  }

  /**
   * End the current session.
   */
  end(): void {
    if (!this.activeSession) {
      return;
    }

    const session = this.sessions.get(this.activeSession);
    if (session) {
      this.sessions.set(this.activeSession, {
        ...session,
        ended_at: Date.now() / 1000,
      });
    }

    this.activeSession = null;
  }

  /**
   * Flush all sessions and events to a file, custom exporter, and/or remote server.
   * 
   * @param options - Flush options including optional exporter
   * @returns If exporter is provided: ExportResult from the exporter.
   *          If persist is True: The output file path used.
   *          If persist is False and no exporter: null.
   */
  async flush(options: FlushOptions = {}): Promise<string | ExportResult | null> {
    const { 
      path: outPath, 
      includeTraceTree = true, 
      persist = true,
      exporter,
      exporterOptions,
    } = options;

    // Separate standard events from function events
    const standardEvents: ObservedEvent[] = [];
    const functionEvents: ObservedFunctionEvent[] = [];

    for (const [sessionId, evs] of this.events) {
      for (const ev of evs) {
        if ('name' in ev && ev.provider === 'function') {
          functionEvents.push({
            ...(ev as FunctionEvent),
            session_id: sessionId,
          });
        } else {
          standardEvents.push({
            ...(ev as Event),
            session_id: sessionId,
          });
        }
      }
    }

    // Count total traces for usage tracking
    const traceCount = standardEvents.length + functionEvents.length;

    // Build trace tree from all events
    const allEvents = [...standardEvents, ...functionEvents];
    const traceTree = includeTraceTree ? buildTraceTree(allEvents) : null;

    // Extract enh_prompt traces
    const enhPromptTraces = includeTraceTree && traceTree ? extractEnhPromptTraces(traceTree) : null;

    // Build export payload
    const exportData: ObservabilityExport = {
      sessions: Array.from(this.sessions.values()),
      events: standardEvents,
      function_events: functionEvents,
      trace_tree: traceTree,
      enh_prompt_traces: enhPromptTraces && enhPromptTraces.length > 0 ? enhPromptTraces : null,
      generated_at: Date.now() / 1000,
      version: 1,
    };

    // Use custom exporter if provided
    if (exporter) {
      const result = await exporter.export(exportData, exporterOptions);
      
      // Flush traces to remote server
      if (this.apiKey) {
        await this.flushToServer(exportData);
      }

      // Record usage if API key is configured
      if (this.apiKey && traceCount > 0) {
        await this.recordUsage(traceCount);
      }

      // Clear in-memory store after successful export
      this.sessions.clear();
      this.events.clear();
      this.activeSession = null;

      return result;
    }

    let outputPath: string | null = null;

    if (persist) {
      // Determine default filename based on session ID
      let defaultFilename = 'llm_observability.json';
      if (this.activeSession) {
        defaultFilename = `${this.activeSession}.json`;
      } else if (this.sessions.size > 0) {
        defaultFilename = `${this.sessions.keys().next().value}.json`;
      }

      outputPath = outPath ?? process.env.LLM_OBS_OUT ?? defaultFilename;

      // Ensure directory exists
      const outDir = path.dirname(outputPath);
      if (outDir && !fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      // Write JSON file
      fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
    }

    // Flush traces to remote server
    if (this.apiKey) {
      await this.flushToServer(exportData);
    }

    // Record usage if API key is configured
    if (this.apiKey && traceCount > 0) {
      await this.recordUsage(traceCount);
    }

    // Clear in-memory store
    this.sessions.clear();
    this.events.clear();
    this.activeSession = null;

    return outputPath;
  }

  /**
   * Set or update labels for the current session.
   */
  setLabels(labels: Record<string, string>, merge = true): void {
    if (!this.activeSession) {
      throw new Error('No active session. Call observe() first.');
    }

    validateLabels(labels);

    const session = this.sessions.get(this.activeSession)!;
    let currentLabels = { ...(session.labels ?? {}) };

    if (merge) {
      Object.assign(currentLabels, labels);
    } else {
      // Preserve system labels, replace user labels
      const systemLabels = Object.fromEntries(
        Object.entries(currentLabels).filter(([k]) => k.startsWith(LABEL_RESERVED_PREFIX))
      );
      currentLabels = { ...systemLabels, ...labels };
    }

    if (Object.keys(currentLabels).length > LABEL_MAX_COUNT) {
      throw new Error(
        `Too many labels (${Object.keys(currentLabels).length}). Maximum allowed is ${LABEL_MAX_COUNT}.`
      );
    }

    this.sessions.set(this.activeSession, {
      ...session,
      labels: currentLabels,
    });
  }

  /**
   * Add a single label to the current session.
   */
  addLabel(key: string, value: string): void {
    if (!this.activeSession) {
      throw new Error('No active session. Call observe() first.');
    }

    validateLabelKey(key);
    validateLabelValue(value, key);

    const session = this.sessions.get(this.activeSession)!;
    const currentLabels = { ...(session.labels ?? {}) };

    if (!(key in currentLabels) && Object.keys(currentLabels).length >= LABEL_MAX_COUNT) {
      throw new Error(`Cannot add label. Maximum of ${LABEL_MAX_COUNT} labels already reached.`);
    }

    currentLabels[key] = value;
    this.sessions.set(this.activeSession, {
      ...session,
      labels: currentLabels,
    });
  }

  /**
   * Remove a label from the current session.
   */
  removeLabel(key: string): void {
    if (!this.activeSession) {
      throw new Error('No active session. Call observe() first.');
    }

    if (key.startsWith(LABEL_RESERVED_PREFIX)) {
      throw new Error(`Cannot remove system label '${key}'`);
    }

    const session = this.sessions.get(this.activeSession)!;
    if (session.labels && key in session.labels) {
      const currentLabels = { ...session.labels };
      delete currentLabels[key];
      this.sessions.set(this.activeSession, {
        ...session,
        labels: Object.keys(currentLabels).length > 0 ? currentLabels : null,
      });
    }
  }

  /**
   * Get all labels for the current session.
   */
  getLabels(): Record<string, string> {
    if (!this.activeSession) {
      throw new Error('No active session. Call observe() first.');
    }

    const session = this.sessions.get(this.activeSession)!;
    return { ...(session.labels ?? {}) };
  }

  /**
   * Record an event (internal API).
   */
  recordEvent(payload: Event | FunctionEvent): void {
    const sessionId = this.activeSession;
    if (!sessionId) {
      return;
    }

    const events = this.events.get(sessionId);
    if (events) {
      events.push(payload);
    }
  }

  /**
   * Get the current span ID from context (for parent-child linking).
   */
  getCurrentSpanId(): string | null {
    return currentSpanId;
  }

  /**
   * Set the current span ID in context.
   */
  setCurrentSpanId(spanId: string | null): string | null {
    const previous = currentSpanId;
    currentSpanId = spanId;
    return previous;
  }

  /**
   * Reset collector state (for tests/dev).
   */
  reset(): void {
    this.activeSession = null;
    this.sessions.clear();
    this.events.clear();
    this.apiKey = null;
    currentSpanId = null;
  }

  /**
   * Validate the API key with shepherd server.
   */
  private async validateApiKey(): Promise<void> {
    if (!this.apiKey) {
      return;
    }

    const url = `${SHEPHERD_SERVER_URL}/v1/usage`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key provided to aiobs');
        }
        throw new Error(`Failed to validate API key: HTTP ${response.status}`);
      }

      const result = await response.json() as {
        success?: boolean;
        usage?: UsageInfo;
      };

      if (result.success) {
        const usage = result.usage;
        if (usage) {
          logger.debug(
            `API key validated: tier=${usage.tier}, traces_used=${usage.traces_used}/${usage.traces_limit}`
          );

          if (usage.is_rate_limited) {
            throw new Error(
              `Rate limit exceeded: tier=${usage.tier}, used=${usage.traces_used}/${usage.traces_limit}`
            );
          }
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Invalid API key') || error.message.includes('Rate limit')) {
          throw error;
        }
        if (error.name === 'AbortError') {
          throw new Error('Failed to connect to shepherd server: timeout');
        }
      }
      throw new Error(`Failed to connect to shepherd server: ${error}`);
    }
  }

  /**
   * Record usage to shepherd-server.
   */
  private async recordUsage(traceCount: number): Promise<void> {
    if (!this.apiKey) {
      return;
    }

    const url = `${SHEPHERD_SERVER_URL}/v1/usage`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trace_count: traceCount }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key provided to aiobs');
        }
        if (response.status === 429) {
          const errorBody = await response.json() as {
            error?: string;
            usage?: UsageInfo;
          };
          throw new Error(
            `Rate limit exceeded: ${errorBody.error ?? 'Unknown error'} ` +
            `(tier: ${errorBody.usage?.tier ?? 'unknown'}, ` +
            `used: ${errorBody.usage?.traces_used ?? 0}/${errorBody.usage?.traces_limit ?? 0})`
          );
        }
        throw new Error(`Failed to record usage: HTTP ${response.status}`);
      }

      const result = await response.json() as {
        success?: boolean;
        usage?: UsageInfo;
      };

      if (result.success) {
        logger.debug(
          `Usage recorded: ${traceCount} traces, ${result.usage?.traces_remaining ?? 'unknown'} remaining`
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Invalid API key') || error.message.includes('Rate limit')) {
          throw error;
        }
      }
      throw new Error(`Failed to connect to shepherd server: ${error}`);
    }
  }

  /**
   * Send trace data to the flush server.
   */
  private async flushToServer(exportData: ObservabilityExport): Promise<void> {
    if (!this.apiKey) {
      return;
    }

    const flushServerUrl = process.env.AIOBS_FLUSH_SERVER_URL ?? AIOBS_FLUSH_SERVER_URL;
    const url = `${flushServerUrl}/v1/traces`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(exportData),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API key provided to aiobs');
        }
        logger.warn(`Failed to flush traces to server: HTTP ${response.status}`);
        return;
      }

      const result = await response.json() as {
        message?: string;
      };

      logger.debug(`Traces flushed to server: ${result.message ?? 'success'}`);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Invalid API key')) {
          throw error;
        }
      }
      logger.warn(`Failed to connect to flush server: ${error}`);
    }
  }
}
