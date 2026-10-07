import { baseRecord, hash, identifier, modelId, timestamp, token, track } from '../../metadata.ts';
import { emptyDiagnostics, type Diagnostics, type UsageRecord } from '../../types.ts';
export interface ClaudeState {
  diagnostics: Diagnostics;
}
export const claudeState = (): ClaudeState => ({ diagnostics: emptyDiagnostics() });
export function parseClaude(
  o: any,
  s: ClaudeState,
  ref: string,
  lineNumber: number,
): UsageRecord | null {
  if (!o || o.type !== 'assistant') return null;
  const m = o.message,
    u = m?.usage;
  if (!u || typeof u !== 'object') return null;
  const msg = identifier(m.id),
    req = identifier(o.requestId),
    sid = identifier(o.sessionId);
  // Response blocks repeat the whole message usage. Never sum usage.iterations.
  const event = hash(sid, msg ?? req ?? [ref, lineNumber], msg ? null : req);
  const r = baseRecord('claude', ref, event);
  r.timestamp = timestamp(o.timestamp);
  r.session_id = sid;
  r.request_id = req;
  r.source_schema = 'claude.message.usage.v1';
  r.model_raw = modelId(m.model);
  if (typeof o.cwd === 'string') r.project_identifier_hash = hash('project', o.cwd);
  r.input_tokens = token(u.input_tokens);
  r.cached_input_tokens = token(u.cache_read_input_tokens);
  r.cache_creation_tokens = token(u.cache_creation_input_tokens);
  r.output_tokens = token(u.output_tokens);
  r.cache_creation_5m_tokens = token(u.cache_creation?.ephemeral_5m_input_tokens);
  r.cache_creation_1h_tokens = token(u.cache_creation?.ephemeral_1h_input_tokens);
  r.service_tier = modelId(u.service_tier);
  r.speed = modelId(u.speed);
  r.web_search_requests = token(u.server_tool_use?.web_search_requests);
  r.web_fetch_requests = token(u.server_tool_use?.web_fetch_requests);
  if (
    [r.input_tokens, r.cached_input_tokens, r.cache_creation_tokens, r.output_tokens].every(
      (n) => n !== null,
    )
  )
    r.total_tokens =
      r.input_tokens! + r.cached_input_tokens! + r.cache_creation_tokens! + r.output_tokens!;
  if (!msg || !req) {
    r.quality = 'MEDIUM';
    r.notes.push('weak-request-identity');
  }
  if (
    [r.input_tokens, r.cached_input_tokens, r.cache_creation_tokens, r.output_tokens].some(
      (n) => n === null,
    ) ||
    !r.timestamp ||
    !r.model_raw
  )
    r.quality = 'INCOMPLETE';
  if (r.cache_creation_tokens !== null && r.cache_creation_tokens > 0) {
    if (r.cache_creation_5m_tokens === null || r.cache_creation_1h_tokens === null) {
      r.quality = 'INCOMPLETE';
      r.notes.push('cache-duration-missing');
    } else if (
      r.cache_creation_5m_tokens + r.cache_creation_1h_tokens !==
      r.cache_creation_tokens
    ) {
      r.quality = 'INCOMPLETE';
      r.notes.push('cache-duration-disagreement');
    }
  }
  track(s.diagnostics, r);
  return r;
}
