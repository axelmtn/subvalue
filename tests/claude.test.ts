import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaude, claudeState } from '../packages/core/src/providers/claude/index.ts';
import { claudeEvent } from './helpers.ts';
test('cache reads and 5m/1h writes are separate', () => {
  const r = parseClaude(claudeEvent(), claudeState(), 'ref', 1)!;
  assert.equal(r.input_tokens, 100);
  assert.equal(r.cached_input_tokens, 50);
  assert.equal(r.cache_creation_tokens, 10);
  assert.equal(r.cache_creation_5m_tokens, 6);
  assert.equal(r.cache_creation_1h_tokens, 4);
  assert.equal(r.total_tokens, 180);
});
test('identical message/request identity generates stable dedup ID', () => {
  const s = claudeState();
  const a = parseClaude(claudeEvent(), s, 'ref-a', 1)!;
  const b = parseClaude(claudeEvent(), s, 'ref-b', 10)!;
  assert.equal(a.id, b.id);
});
test('iterations are not added to usage', () => {
  const r = parseClaude(
    claudeEvent(
      {},
      { iterations: [{ input_tokens: 999999, output_tokens: 99999 }, { output_tokens: 11111 }] },
    ),
    claudeState(),
    'ref',
    1,
  )!;
  assert.equal(r.input_tokens, 100);
  assert.equal(r.output_tokens, 20);
});
test('request fallback works without message id', () => {
  const o: any = claudeEvent();
  delete o.message.id;
  const r = parseClaude(o, claudeState(), 'ref', 1)!;
  assert.equal(r.request_id, 'req-a');
  assert.equal(r.quality, 'MEDIUM');
});
test('same request with distinct message IDs remains separate', () => {
  const a = claudeEvent(),
    b = claudeEvent();
  b.message.id = 'msg-b';
  assert.notEqual(
    parseClaude(a, claudeState(), 'ref', 1)!.id,
    parseClaude(b, claudeState(), 'ref', 2)!.id,
  );
});
test('models are read per response, not inferred from session', () => {
  const a = claudeEvent(),
    b = claudeEvent();
  b.message.model = 'different';
  assert.equal(parseClaude(a, claudeState(), 'ref', 1)!.model_raw, 'known');
  assert.equal(parseClaude(b, claudeState(), 'ref', 2)!.model_raw, 'different');
});
test('old schema with missing cache duration stays incomplete', () => {
  const r = parseClaude(claudeEvent({}, { cache_creation: null }), claudeState(), 'ref', 1)!;
  assert.equal(r.cache_creation_1h_tokens, null);
  assert.equal(r.quality, 'INCOMPLETE');
});
test('missing input never becomes zero', () => {
  const r = parseClaude(claudeEvent({}, { input_tokens: undefined }), claudeState(), 'ref', 1)!;
  assert.equal(r.input_tokens, null);
  assert.equal(r.total_tokens, null);
  assert.equal(r.quality, 'INCOMPLETE');
});
test('zero is a legitimate recorded numeric value', () => {
  const r = parseClaude(
    claudeEvent(
      {},
      {
        input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
      },
    ),
    claudeState(),
    'ref',
    1,
  )!;
  assert.equal(r.total_tokens, 0);
  assert.equal(r.quality, 'HIGH');
});
test('conversation fields cannot escape metadata projection', () => {
  const r = parseClaude(claudeEvent(), claudeState(), 'ref', 1)!;
  assert.ok(!JSON.stringify(r).includes('DO_NOT_STORE'));
  assert.ok(!JSON.stringify(r).includes('private-fixture'));
  assert.equal(r.billing_mode, 'UNKNOWN');
  assert.equal(r.reasoning_tokens, null);
});
