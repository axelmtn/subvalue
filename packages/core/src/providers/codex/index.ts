import {
  baseRecord,
  hash,
  identifier,
  isObject,
  modelId,
  timestamp,
  token,
  track,
} from '../../metadata.ts';
import { emptyDiagnostics, type Diagnostics, type UsageRecord } from '../../types.ts';
type Counters = Record<string, number | null>;
export interface CodexState {
  thread: string | null;
  session: string | null;
  model: string | null;
  project: string | null;
  boundary: number | null;
  previous: Counters | null;
  turn: string | null;
  segment: number;
  diagnostics: Diagnostics;
}
export const codexState = (): CodexState => ({
  thread: null,
  session: null,
  model: null,
  project: null,
  boundary: null,
  previous: null,
  turn: null,
  segment: 0,
  diagnostics: emptyDiagnostics(),
});
const keys = [
  'input_tokens',
  'cached_input_tokens',
  'cache_write_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
  'total_tokens',
];
const counters = (value: unknown): Counters | null =>
  isObject(value) ? Object.fromEntries(keys.map((key) => [key, token(value[key])])) : null;
export function parseCodex(
  event: unknown,
  state: CodexState,
  sourceReference: string,
  lineNumber: number,
): UsageRecord | null {
  if (!isObject(event)) return null;
  const payload = event.payload;
  if (!isObject(payload)) return null;
  const ordinal = token(event.ordinal);
  // Inherited metadata must not overwrite the child's identity or model either.
  if (state.boundary !== null && ordinal !== null && ordinal < state.boundary) {
    if (event.type === 'event_msg' && payload.type === 'token_count') state.diagnostics.inherited++;
    return null;
  }
  if (event.type === 'session_meta') {
    const thread = identifier(payload.id);
    if (thread && state.thread && thread !== state.thread) {
      state.previous = null;
      state.boundary = null;
      state.model = null;
      state.project = null;
      state.turn = null;
      state.segment++;
    }
    state.thread = thread ?? state.thread;
    state.session = identifier(payload.session_id) ?? state.thread;
    if (typeof payload.cwd === 'string') state.project = hash('project', payload.cwd);
    state.boundary = token(payload.subagent_history_start_ordinal) ?? state.boundary;
    state.model = modelId(payload.model) ?? state.model;
    return null;
  }
  if (event.type === 'turn_context') {
    state.model = modelId(payload.model) ?? state.model;
    state.turn = identifier(payload.turn_id) ?? state.turn;
    if (typeof payload.cwd === 'string') state.project = hash('project', payload.cwd);
    return null;
  }
  if (event.type !== 'event_msg' || payload.type !== 'token_count') return null;
  if (state.boundary !== null) {
    if (ordinal === null) {
      state.diagnostics.unsupported++;
      return null;
    }
    if (ordinal < state.boundary) {
      state.diagnostics.inherited++;
      return null;
    }
  }
  const info = payload.info;
  if (!isObject(info)) {
    state.diagnostics.unsupported++;
    return null;
  }
  const total = counters(info.total_token_usage),
    last = counters(info.last_token_usage);
  let usage: Counters | null = null;
  let method = 'last';
  const notes: string[] = [];
  if (total && state.previous) {
    const comparable = keys.filter((key) => total[key] !== null && state.previous![key] !== null);
    if (comparable.length && comparable.every((key) => total[key] === state.previous![key])) {
      state.diagnostics.repeated++;
      return null;
    }
    if (comparable.some((key) => total[key]! < state.previous![key]!)) {
      state.segment++;
      state.diagnostics.resets++;
      notes.push('counter-reset');
      usage = last;
      method = 'reset-last';
      if (!usage) {
        usage = { ...total };
        notes.push('reset-without-last');
      }
    } else {
      usage = Object.fromEntries(
        keys.map((key) => [
          key,
          total[key] !== null && state.previous![key] !== null
            ? total[key]! - state.previous![key]!
            : null,
        ]),
      );
      method = 'cumulative-delta';
      if (
        last &&
        keys.some((key) => usage![key] !== null && last[key] !== null && usage![key] !== last[key])
      )
        notes.push('last-delta-disagreement');
    }
  } else if (last) {
    usage = last;
    if (
      total &&
      keys.some((key) => last[key] !== null && total[key] !== null && last[key] !== total[key])
    )
      notes.push('nonzero-starting-baseline');
  } else if (total) {
    usage = total;
    method = 'initial-cumulative';
    notes.push('initial-cumulative-only');
  }
  if (total) state.previous = total;
  if (!usage) {
    state.diagnostics.unsupported++;
    return null;
  }
  const sourceEventId = hash(
    state.thread ?? sourceReference,
    token(event.ordinal) ?? lineNumber,
    timestamp(event.timestamp),
    state.segment,
    usage,
  );
  const record = baseRecord('codex', sourceReference, sourceEventId);
  record.timestamp = timestamp(event.timestamp);
  record.thread_id = state.thread;
  record.session_id = state.session;
  record.request_id = null;
  record.model_raw = state.model;
  record.project_identifier_hash = state.project;
  record.source_schema = `codex.token_count.v1/${method}`;
  record.notes = notes;
  record.input_tokens = usage.input_tokens;
  record.cached_input_tokens = usage.cached_input_tokens;
  record.cache_creation_tokens = usage.cache_write_input_tokens;
  record.output_tokens = usage.output_tokens;
  record.reasoning_tokens = usage.reasoning_output_tokens;
  record.total_tokens = usage.total_tokens;
  // A positive total with zero components is not a zero-token request.
  if (
    record.total_tokens !== null &&
    record.input_tokens !== null &&
    record.output_tokens !== null &&
    record.total_tokens !== record.input_tokens + record.output_tokens
  ) {
    record.unallocated_total_tokens = Math.max(
      0,
      record.total_tokens - record.input_tokens - record.output_tokens,
    );
    record.notes.push('unallocated-total');
    record.quality = 'INCOMPLETE';
    if (record.input_tokens === 0 && record.output_tokens === 0 && record.total_tokens > 0) {
      record.input_tokens = null;
      record.output_tokens = null;
      record.cached_input_tokens = null;
      record.reasoning_tokens = null;
      record.cache_creation_tokens = null;
    }
  }
  if (
    record.input_tokens === null ||
    record.cached_input_tokens === null ||
    record.cache_creation_tokens === null ||
    record.output_tokens === null ||
    !record.timestamp ||
    !record.model_raw
  )
    record.quality = 'INCOMPLETE';
  if (
    record.cached_input_tokens !== null &&
    record.input_tokens !== null &&
    record.cached_input_tokens > record.input_tokens
  ) {
    record.quality = 'INCOMPLETE';
    record.notes.push('invalid-cache-subset');
  }
  if (notes.includes('initial-cumulative-only') || notes.includes('reset-without-last'))
    record.quality = 'INCOMPLETE';
  if (record.quality === 'HIGH' && notes.length) record.quality = 'MEDIUM';
  track(state.diagnostics, record);
  return record;
}
