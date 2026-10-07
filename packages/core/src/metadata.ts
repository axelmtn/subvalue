import { createHash } from 'node:crypto';
import type { UsageRecord, Provider, Diagnostics } from './types.ts';
export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && !Array.isArray(value);
export const hash = (...parts: unknown[]): string =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const token = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
export const identifier = (v: unknown): string | null =>
  typeof v === 'string' && /^[a-zA-Z0-9._:@/-]{1,160}$/.test(v) ? v : null;
export const modelId = (v: unknown): string | null =>
  typeof v === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(v) ? v : null;
export const timestamp = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))
    ? new Date(v).toISOString()
    : null;
export function baseRecord(provider: Provider, ref: string, event: string): UsageRecord {
  return {
    id: hash(provider, event),
    provider,
    source_event_id: event,
    source_file_reference: ref,
    timestamp: null,
    session_id: null,
    request_id: null,
    thread_id: null,
    model_raw: null,
    model_canonical: null,
    billing_mode: 'UNKNOWN',
    input_tokens: null,
    cached_input_tokens: null,
    cache_creation_tokens: null,
    cache_creation_5m_tokens: null,
    cache_creation_1h_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    unallocated_total_tokens: null,
    total_tokens: null,
    project_identifier_hash: null,
    quality: 'HIGH',
    source_schema: 'unknown',
    notes: [],
    service_tier: null,
    speed: null,
    web_search_requests: null,
    web_fetch_requests: null,
  };
}
export function track(d: Diagnostics, r: UsageRecord): void {
  d.records++;
  if (r.timestamp) {
    d.first = !d.first || r.timestamp < d.first ? r.timestamp : d.first;
    d.last = !d.last || r.timestamp > d.last ? r.timestamp : d.last;
  }
}
