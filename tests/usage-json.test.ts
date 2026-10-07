import test from 'node:test';
import assert from 'node:assert/strict';
import { usageMetadata } from '../packages/core/src/usage-json.ts';
import { isRecord } from '../packages/core/src/metadata.ts';
import { parseCodex, codexState } from '../packages/core/src/providers/codex/index.ts';
import { parseClaude, claudeState } from '../packages/core/src/providers/claude/index.ts';
import { meta, context, codexEvent, counts, claudeEvent } from './helpers.ts';
import type { UsageRecord } from '../packages/core/src/types.ts';
const persisted = (record: UsageRecord | null) =>
  record && { ...record, session_id: null, thread_id: null, project_identifier_hash: null };

type ClaudeMetadata = Record<string, unknown> & {
  message: Record<string, unknown> & { usage: Record<string, unknown> };
};
function assertClaudeMetadata(value: unknown): asserts value is ClaudeMetadata {
  assert.ok(isRecord(value));
  assert.ok(isRecord(value.message));
  assert.ok(isRecord(value.message.usage));
}

test('provider adapters safely reject invalid event and nested metadata shapes', () => {
  for (const value of [null, true, 1, 'event', [], { payload: [] }, { payload: null }]) {
    assert.equal(parseCodex(value, codexState(), 'fixture', 1), null);
    assert.equal(parseClaude(value, claudeState(), 'fixture', 1), null);
  }
  for (const value of [null, true, 1, 'usage']) {
    assert.equal(
      parseClaude({ type: 'assistant', message: { usage: value } }, claudeState(), 'fixture', 1),
      null,
    );
    const state = codexState();
    assert.equal(
      parseCodex(
        { type: 'event_msg', payload: { type: 'token_count', info: value } },
        state,
        'fixture',
        1,
      ),
      null,
    );
    assert.equal(state.diagnostics.unsupported, 1);
  }
});

test('array-shaped token containers preserve incomplete coverage instead of losing events', () => {
  const claude = parseClaude(
    { type: 'assistant', message: { usage: [] } },
    claudeState(),
    'fixture',
    1,
  );
  assert.ok(claude);
  assert.equal(claude.quality, 'INCOMPLETE');
  assert.equal(claude.input_tokens, null);
  assert.equal(claude.total_tokens, null);
  const codex = parseCodex(
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: [] } } },
    codexState(),
    'fixture',
    1,
  );
  assert.ok(codex);
  assert.equal(codex.quality, 'INCOMPLETE');
  assert.equal(codex.input_tokens, null);
  assert.equal(codex.total_tokens, null);
});

test('extractor never decodes conversation values or builds their objects', () => {
  const secret = 'PRIVATE_CONVERSATION_SENTINEL',
    event = claudeEvent();
  event.message.content = [{ text: secret + '\\"\n私'.repeat(1000) }];
  const original = JSON.parse,
    decoded: string[] = [];
  JSON.parse = ((text: string, ...args: any[]) => {
    decoded.push(text);
    return (original as any)(text, ...args);
  }) as typeof JSON.parse;
  let metadata: unknown;
  try {
    metadata = usageMetadata(Buffer.from(JSON.stringify(event)), 'claude');
  } finally {
    JSON.parse = original;
  }
  assert.ok(decoded.every((text) => !text.includes(secret) && text.length < 1024));
  assertClaudeMetadata(metadata);
  assert.equal(metadata.message.content, undefined);
  assert.equal(metadata.cwd, undefined);
  assert.equal(metadata.message.usage.iterations, undefined);
  assert.equal(metadata.message.usage.input_tokens, 100);
  assert.ok(!JSON.stringify(metadata).includes(secret));
});

test('Codex metadata-only extraction preserves counters, resets, identities and inheritance', () => {
  const original = codexState(),
    projected = codexState();
  const events = [
    meta({ subagent_history_start_ordinal: 10 }),
    context(),
    codexEvent(counts(999), undefined, 3),
    context('next-model'),
    codexEvent(counts(), counts(), 10),
    codexEvent(counts(150, 30, 20, 8), counts(50, 10, 10, 4), 11),
    codexEvent(counts(150, 30, 20, 8), counts(), 12),
    codexEvent(counts(10, 2, 3, 1), counts(10, 2, 3, 1), 13),
    codexEvent(counts(0, 0, 0, 0, 100), null, 14),
  ];
  for (const [i, event] of events.entries())
    assert.deepEqual(
      persisted(
        parseCodex(usageMetadata(Buffer.from(JSON.stringify(event)), 'codex'), projected, 'ref', i),
      ),
      persisted(parseCodex(event, original, 'ref', i)),
    );
  for (const key of ['thread', 'model', 'boundary', 'previous', 'segment', 'diagnostics'] as const)
    assert.deepEqual(projected[key], original[key]);
  assert.equal(projected.project, null);
  assert.equal(projected.turn, null);
});

test('Claude extraction preserves cache durations, repeats, request fallback and pricing fields', () => {
  for (const usage of [
    {},
    {
      service_tier: 'standard',
      speed: 'fast',
      server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 },
    },
    { input_tokens: null },
    { cache_creation: null },
    { output_tokens: 0, input_tokens: 0 },
    { iterations: [{ input_tokens: 999999 }] },
  ]) {
    const event = claudeEvent({}, usage);
    for (const hasMessageId of [true, false]) {
      if (!hasMessageId) delete (event.message as any).id;
      assert.deepEqual(
        persisted(
          parseClaude(
            usageMetadata(Buffer.from(JSON.stringify(event)), 'claude'),
            claudeState(),
            'ref',
            1,
          ),
        ),
        persisted(parseClaude(event, claudeState(), 'ref', 1)),
      );
    }
  }
});

test('escaped keys, Unicode, duplicate fields and nested skipped content use JSON semantics', () => {
  const input = String.raw`{"unknown":{"array":[{"content":"private \" text \u263A"},-1.2e+3,true,false,null]},"t\u0079pe":"assistant","message":{"model":"old","model":"known","usage":{"input_tokens":1e2,"output_tokens":0}},"timestamp":"2026-10-01T11:00:00Z"}`;
  const actual = usageMetadata(Buffer.from(input), 'claude');
  assertClaudeMetadata(actual);
  assert.equal(actual.type, 'assistant');
  assert.equal(actual.message.model, 'known');
  assert.equal(actual.message.usage.input_tokens, 100);
  assert.equal(actual.message.usage.output_tokens, 0);
  assert.equal(actual.unknown, undefined);
});

test('malformed skipped content still rejects the whole metadata event', () => {
  for (const input of [
    '{"type":"assistant","ignored":"bad\\x"}',
    '{"type":"assistant","ignored":"bad\ncontrol"}',
    '{"ignored":[1,]}',
    '{"ignored":{"a":1,}}',
    '{"ignored":01}',
    '{"ignored":1.}',
    '{"ignored":1e}',
    '{"ignored":tru}',
    '{"ignored":"\\uQQQQ"}',
    '{"ignored":"unterminated}',
    '{"type":"assistant"} trailing',
    '{"ignored":[[[1,2}]]}',
  ])
    assert.throws(() => usageMetadata(Buffer.from(input), 'claude'), SyntaxError);
});

test('invalid token types and oversized strings stay unknown without decoding private values', () => {
  const input = Buffer.from(
    JSON.stringify({
      type: 'assistant',
      message: {
        model: 'x'.repeat(2000),
        usage: {
          input_tokens: 'private',
          output_tokens: { content: 'private' },
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: null,
        },
      },
    }),
  );
  const actual = usageMetadata(input, 'claude');
  assertClaudeMetadata(actual);
  assert.equal(actual.message.model, null);
  assert.equal(actual.message.usage.input_tokens, null);
  assert.equal(actual.message.usage.output_tokens, null);
  assert.equal(actual.message.usage.cache_read_input_tokens, 0);
  assert.ok(!JSON.stringify(actual).includes('private'));
});

test('metadata-only extraction matches full parsing over varied synthetic usage records', () => {
  for (let i = 0; i < 100; i++) {
    const event = claudeEvent(
      { requestId: 'request-' + i, sessionId: 'session-' + i },
      {
        input_tokens: i,
        cached_input_tokens: undefined,
        cache_read_input_tokens: i % 7,
        output_tokens: i * 3,
        cache_creation_input_tokens: 10,
      },
    );
    event.message.id = 'message-' + i;
    event.message.content = [
      {
        text: 'escaped " \\ \n 私 ' + i,
        unknown: [true, false, null, { nested: [1, -2.3e4, 'content'] }],
      },
    ] as any;
    assert.deepEqual(
      persisted(
        parseClaude(
          usageMetadata(Buffer.from(JSON.stringify(event)), 'claude'),
          claudeState(),
          'ref',
          i,
        ),
      ),
      persisted(parseClaude(event, claudeState(), 'ref', i)),
    );
  }
});
