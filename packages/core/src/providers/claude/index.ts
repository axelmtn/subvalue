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
export interface ClaudeState {
  diagnostics: Diagnostics;
}
export const claudeState = (): ClaudeState => ({ diagnostics: emptyDiagnostics() });
export function parseClaude(
  event: unknown,
  state: ClaudeState,
  sourceReference: string,
  lineNumber: number,
): UsageRecord | null {
  if (!isObject(event) || event.type !== 'assistant' || !isObject(event.message)) return null;
  const message = event.message,
    usage = message.usage;
  if (!isObject(usage)) return null;
  const cacheCreation = isObject(usage.cache_creation) ? usage.cache_creation : null;
  const serverToolUse = isObject(usage.server_tool_use) ? usage.server_tool_use : null;
  const messageId = identifier(message.id),
    requestId = identifier(event.requestId),
    sessionId = identifier(event.sessionId);
  // Response blocks repeat the whole message usage. Never sum usage.iterations.
  const sourceEventId = hash(
    sessionId,
    messageId ?? requestId ?? [sourceReference, lineNumber],
    messageId ? null : requestId,
  );
  const record = baseRecord('claude', sourceReference, sourceEventId);
  record.timestamp = timestamp(event.timestamp);
  record.session_id = sessionId;
  record.request_id = requestId;
  record.source_schema = 'claude.message.usage.v1';
  record.model_raw = modelId(message.model);
  if (typeof event.cwd === 'string') record.project_identifier_hash = hash('project', event.cwd);
  record.input_tokens = token(usage.input_tokens);
  record.cached_input_tokens = token(usage.cache_read_input_tokens);
  record.cache_creation_tokens = token(usage.cache_creation_input_tokens);
  record.output_tokens = token(usage.output_tokens);
  record.cache_creation_5m_tokens = token(cacheCreation?.ephemeral_5m_input_tokens);
  record.cache_creation_1h_tokens = token(cacheCreation?.ephemeral_1h_input_tokens);
  record.service_tier = modelId(usage.service_tier);
  record.speed = modelId(usage.speed);
  record.web_search_requests = token(serverToolUse?.web_search_requests);
  record.web_fetch_requests = token(serverToolUse?.web_fetch_requests);
  if (
    [
      record.input_tokens,
      record.cached_input_tokens,
      record.cache_creation_tokens,
      record.output_tokens,
    ].every((n) => n !== null)
  )
    record.total_tokens =
      record.input_tokens! +
      record.cached_input_tokens! +
      record.cache_creation_tokens! +
      record.output_tokens!;
  if (!messageId || !requestId) {
    record.quality = 'MEDIUM';
    record.notes.push('weak-request-identity');
  }
  if (
    [
      record.input_tokens,
      record.cached_input_tokens,
      record.cache_creation_tokens,
      record.output_tokens,
    ].some((n) => n === null) ||
    !record.timestamp ||
    !record.model_raw
  )
    record.quality = 'INCOMPLETE';
  if (record.cache_creation_tokens !== null && record.cache_creation_tokens > 0) {
    if (record.cache_creation_5m_tokens === null || record.cache_creation_1h_tokens === null) {
      record.quality = 'INCOMPLETE';
      record.notes.push('cache-duration-missing');
    } else if (
      record.cache_creation_5m_tokens + record.cache_creation_1h_tokens !==
      record.cache_creation_tokens
    ) {
      record.quality = 'INCOMPLETE';
      record.notes.push('cache-duration-disagreement');
    }
  }
  track(state.diagnostics, record);
  return record;
}
