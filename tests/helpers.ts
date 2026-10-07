import { baseRecord } from '../packages/core/src/metadata.ts';
import {
  emptyDiagnostics,
  type UsageRecord,
  type SourceStatus,
} from '../packages/core/src/types.ts';
import type { Catalog, PriceVersion } from '../packages/core/src/pricing/index.ts';
export const counts = (
  input = 100,
  cached = 20,
  output = 10,
  reasoning = 4,
  total = input + output,
) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: 0,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: total,
});
export const meta = (extra = {}) => ({
  type: 'session_meta',
  timestamp: '2026-10-01T10:00:00Z',
  ordinal: 0,
  payload: { id: 'thread-a', session_id: 'session-a', cwd: 'C:/private-fixture/project', ...extra },
});
export const context = (model = 'known', extra = {}) => ({
  type: 'turn_context',
  ordinal: 1,
  payload: { model, turn_id: 'turn-a', ...extra },
});
export const codexEvent = (
  total: any,
  last: any = total,
  ordinal = 2,
  ts = '2026-10-01T11:00:00Z',
) => ({
  timestamp: ts,
  ordinal,
  type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } },
});
export const claudeEvent = (extra: any = {}, usage: any = {}) => ({
  type: 'assistant',
  timestamp: '2026-10-01T11:00:00Z',
  sessionId: 'session-a',
  requestId: 'req-a',
  cwd: 'C:/private-fixture/project',
  message: {
    id: 'msg-a',
    model: 'known',
    content: [{ text: 'DO_NOT_STORE_PRIVATE_SENTINEL' }],
    usage: {
      input_tokens: 100,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_creation: { ephemeral_5m_input_tokens: 6, ephemeral_1h_input_tokens: 4 },
      output_tokens: 20,
      iterations: [{ input_tokens: 999999 }],
      ...usage,
    },
  },
  ...extra,
});
export const record = (
  provider: 'codex' | 'claude' = 'codex',
  extra: Partial<UsageRecord> = {},
): UsageRecord => ({
  ...baseRecord(provider, 'fixture-ref', 'fixture-event'),
  timestamp: '2026-10-01T11:00:00.000Z',
  model_raw: 'known',
  input_tokens: 100,
  cached_input_tokens: 20,
  cache_creation_tokens: 0,
  output_tokens: 10,
  reasoning_tokens: 4,
  total_tokens: 110,
  ...extra,
});
export const price = (extra: Partial<PriceVersion> = {}): PriceVersion => ({
  provider: 'codex',
  model: 'known',
  effective_from: '2026-01-01T00:00:00.000Z',
  effective_until: null,
  input: 2,
  cached_input: 1,
  cache_write: 3,
  cache_write_5m: 2.5,
  cache_write_1h: 4,
  output: 10,
  source: 'https://example.invalid/test-fixture',
  verified_at: '2026-01-01T00:00:00.000Z',
  ...extra,
});
export const prices = (versions = [price()]): Catalog => ({
  version: 'fixture-v1',
  mappings: { codex: { known: 'known' }, claude: { known: 'known' } },
  prices: versions,
});
export const statuses = (): SourceStatus[] =>
  ['codex', 'claude'].map((provider) => ({
    provider: provider as SourceStatus['provider'],
    detected: true,
    files: 1,
    scanned: 1,
    cached: 0,
    errors: 0,
    skippedLinks: 0,
    missingFiles: 0,
    diagnostics: emptyDiagnostics(),
  }));
