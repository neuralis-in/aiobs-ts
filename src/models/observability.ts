/**
 * Core observability data models for aiobs.
 */

export interface SessionMeta {
  pid: number;
  cwd: string;
}

export interface Session {
  id: string;
  name: string;
  started_at: number;
  ended_at: number | null;
  meta: SessionMeta;
  labels: Record<string, string> | null;
}

export interface Callsite {
  file: string | null;
  line: number | null;
  function: string | null;
}

export interface Event {
  provider: string;
  api: string;
  request: unknown;
  response: unknown | null;
  error: string | null;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  callsite: Callsite | null;
  span_id: string | null;
  parent_span_id: string | null;
}

export interface FunctionEvent {
  provider: string;
  api: string;
  name: string;
  module: string | null;
  args: unknown[] | null;
  kwargs: Record<string, unknown> | null;
  result: unknown | null;
  error: string | null;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  callsite: Callsite | null;
  span_id: string | null;
  parent_span_id: string | null;
  enh_prompt: boolean;
  enh_prompt_id: string | null;
  auto_enhance_after: number | null;
}

export interface ObservedEvent extends Event {
  session_id: string;
}

export interface ObservedFunctionEvent extends FunctionEvent {
  session_id: string;
}

export interface TraceNode {
  session_id: string;
  provider: string;
  api: string;
  request?: unknown;
  response?: unknown;
  name?: string;
  module?: string | null;
  args?: unknown[] | null;
  kwargs?: Record<string, unknown> | null;
  result?: unknown | null;
  error: string | null;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  callsite: Callsite | null;
  span_id: string | null;
  parent_span_id: string | null;
  event_type: 'provider' | 'function';
  enh_prompt?: boolean;
  enh_prompt_id?: string | null;
  auto_enhance_after?: number | null;
  children: TraceNode[];
}

export interface ObservabilityExport {
  sessions: Session[];
  events: ObservedEvent[];
  function_events: ObservedFunctionEvent[];
  trace_tree: TraceNode[] | null;
  enh_prompt_traces: string[] | null;
  generated_at: number;
  version: number;
}

