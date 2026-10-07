import test from 'node:test';
import assert from 'node:assert/strict';
import {
  subscriptionPlans,
  subscriptionPlan,
  subscriptionPlanLabel,
} from '../packages/core/src/subscriptions.ts';
import { validateSettings } from '../packages/cli/src/server.ts';
import { defaultSettings } from '../packages/core/src/types.ts';
import { subscriptionForRange, dateRange } from '../packages/core/src/summary.ts';
test('documented ChatGPT and Claude USD plans are selectable with distinct identifiers', () => {
  assert.equal(new Set(subscriptionPlans.map((p) => p.id)).size, subscriptionPlans.length);
  for (const amount of [100, 200, 500])
    assert.equal(subscriptionPlan('codex', `chatgpt-pro-${amount}`)?.monthly, amount);
  assert.equal(subscriptionPlan('codex', 'chatgpt-plus')?.monthly, 20);
  assert.equal(subscriptionPlan('claude', 'claude-max-5x')?.monthly, 100);
  assert.equal(subscriptionPlan('claude', 'claude-max-20x')?.monthly, 200);
  assert.equal(subscriptionPlan('codex', 'claude-max-5x'), undefined);
  assert.match(
    subscriptionPlanLabel(subscriptionPlan('claude', 'claude-team-premium-monthly')!),
    /\$125\/month \/ seat/,
  );
});
test('selected subscriptions preserve exact annual equivalents and validate provider and amount', () => {
  const s = defaultSettings();
  s.billing.claude = { mode: 'SUBSCRIPTION', monthly: 16.67, planId: 'claude-pro-annual' };
  const b = validateSettings(s).billing.claude;
  assert.equal(b.monthly, 200 / 12);
  assert.equal(b.planId, 'claude-pro-annual');
  assert.match(subscriptionPlanLabel(subscriptionPlan('claude', b.planId)!), /\$200\/year/);
  const month = dateRange('month', new Date(2026, 9, 15));
  assert.ok(Math.abs(subscriptionForRange(b.monthly!, month)! - 200 / 12) < 1e-10);
  s.billing.claude.monthly = 17;
  assert.throws(() => validateSettings(s), /amount/);
  s.billing.claude.planId = 'chatgpt-plus';
  assert.throws(() => validateSettings(s), /plan/);
});
test('manual subscriptions and old settings remain supported; API and mixed have no subscription charge', () => {
  const s = defaultSettings();
  s.billing.codex = { mode: 'SUBSCRIPTION', monthly: 173 };
  assert.deepEqual(validateSettings(s).billing.codex, s.billing.codex);
  for (const mode of ['API', 'MIXED', 'UNKNOWN'] as const) {
    s.billing.codex = { mode, monthly: 200 };
    assert.equal(validateSettings(s).billing.codex.monthly, null);
  }
  s.billing.codex = { mode: 'SUBSCRIPTION', monthly: 20, planId: 'unknown' };
  assert.throws(() => validateSettings(s), /plan/);
});
