import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../packages/core/src/types.ts';
import {
  billingForMonth,
  billingForRange,
  billingPeriodKey,
  billingForSelection,
  withPeriodBilling,
  showExpenseAction,
} from '../packages/core/src/billing.ts';
import { dateRange, summarize } from '../packages/core/src/summary.ts';
import { comparisonForDisplay, receiptModel } from '../packages/receipt/src/index.ts';
import { validateSettings } from '../packages/cli/src/server.ts';
import { record, price, prices, statuses } from './helpers.ts';

const october = dateRange('month', new Date(2026, 9, 15));
const usage = (provider: 'codex' | 'claude', usd: number, month = '2026-10') =>
  record(provider, {
    id: provider + month,
    timestamp: month + '-15T12:00:00Z',
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: usd * 100000,
    total_tokens: usd * 100000,
  });
const catalog = prices([price(), price({ provider: 'claude' })]);

test('calendar-month saves supersede equivalent rolling declarations without changing other providers', () => {
  const settings = defaultSettings();
  settings.periodBilling = {
    [billingPeriodKey(october)]: {
      codex: { mode: 'API', monthly: null, apiSpend: 12 },
      claude: { mode: 'API', monthly: null, apiSpend: 5 },
    },
  };
  const saved = withPeriodBilling(settings, 'codex', october, {
    mode: 'SUBSCRIPTION',
    monthly: 100,
  });
  assert.equal(billingForRange(saved, 'codex', october).paid, 100);
  assert.equal(billingForRange(saved, 'claude', october).paid, 5);
  assert.equal(settings.periodBilling[billingPeriodKey(october)].codex?.apiSpend, 12);
  assert.equal(
    billingForRange(withPeriodBilling(saved, 'codex', october, null), 'codex', october).paid,
    null,
  );
});

test('exact-period API amounts stay in that selection and are counted once across several months', () => {
  const settings = defaultSettings();
  const range = dateRange('custom', new Date(2026, 10, 1), '2026-09-01', '2026-10-31');
  const key = billingPeriodKey(range);
  settings.periodBilling = { [key]: { codex: { mode: 'MIXED', monthly: 100, apiSpend: 50 } } };
  assert.equal(billingForRange(settings, 'codex', range).subscription, 200);
  assert.equal(billingForRange(settings, 'codex', range).apiSpend, 50);
  assert.equal(billingForRange(settings, 'codex', range).paid, 250);
  assert.equal(billingForSelection(settings, 'codex', range).apiSpend, 50);
  assert.equal(billingForRange(settings, 'codex', october).paid, null);
  const short = dateRange('7d', new Date(2026, 9, 15));
  settings.periodBilling[billingPeriodKey(short)] = {
    claude: { mode: 'API', monthly: null, apiSpend: 12 },
  };
  assert.equal(billingForSelection(settings, 'claude', short).apiSpend, 12);
  assert.equal(
    billingForSelection(settings, 'claude', dateRange('7d', new Date(2026, 9, 16))).apiSpend,
    undefined,
  );
  assert.equal(
    billingForRange(settings, 'claude', short).paid,
    null,
    'Rolling periods remain outside full-month comparisons',
  );
  assert.deepEqual(validateSettings(settings).periodBilling, settings.periodBilling);
  for (const bad of ['2026-02-30:2026-03-01', '2026-10-31:2026-10-01', '__proto__'])
    assert.throws(() => validateSettings({ ...settings, periodBilling: { [bad]: {} } }));
});

test('dashboard expense action appears only for mixed usage or a second provider without a plan', () => {
  const settings = defaultSettings();
  const rows = [usage('codex', 200), usage('claude', 20)];
  let summary = summarize(rows, statuses(), settings, october, catalog);
  assert.ok(summary.providers.every((provider) => !showExpenseAction(provider, summary.providers)));
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 100 };
  summary = summarize(rows, statuses(), settings, october, catalog);
  assert.equal(showExpenseAction(summary.providers[0], summary.providers), false);
  assert.equal(showExpenseAction(summary.providers[1], summary.providers), true);
  settings.billing.claude = { mode: 'SUBSCRIPTION', monthly: 20 };
  summary = summarize(rows, statuses(), settings, october, catalog);
  assert.ok(summary.providers.every((provider) => !showExpenseAction(provider, summary.providers)));
  settings.billing.codex.mode = 'MIXED';
  summary = summarize([rows[0]], statuses(), settings, october, catalog);
  assert.equal(showExpenseAction(summary.providers[0], summary.providers), true);
  assert.equal(showExpenseAction(summary.providers[1], summary.providers), false);
});

test('monthly API payments do not propagate to other months or change token billing provenance', () => {
  const settings = defaultSettings();
  settings.monthlyBilling = { '2026-08': { claude: { mode: 'API', monthly: null, apiSpend: 12 } } };
  assert.equal(billingForMonth(settings, 'claude', '2026-08').apiSpend, 12);
  assert.equal(billingForMonth(settings, 'claude', '2026-09').apiSpend, undefined);
  assert.equal(billingForMonth(settings, 'claude', '2026-09').mode, 'API');
  const row = usage('claude', 20);
  summarize([row], statuses(), settings, october, catalog);
  assert.equal(row.billing_mode, 'UNKNOWN');
});

test('an old subscription survives cancellation and later changes to the default plan', () => {
  const settings = defaultSettings();
  settings.billing.claude = { mode: 'API', monthly: null };
  settings.monthlyBilling = { '2026-08': { claude: { mode: 'SUBSCRIPTION', monthly: 20 } } };
  const august = dateRange('month', new Date(2026, 7, 15));
  assert.equal(billingForRange(settings, 'claude', august).paid, 20);
  settings.billing.claude = { mode: 'SUBSCRIPTION', monthly: 100 };
  assert.equal(billingForRange(settings, 'claude', august).paid, 20);
  assert.equal(billingForRange(settings, 'claude', october).paid, 100);
});

test('mixed billing compares API equivalent against subscription plus actual API spend', () => {
  const settings = defaultSettings();
  settings.monthlyBilling = { '2026-10': { codex: { mode: 'MIXED', monthly: 100, apiSpend: 50 } } };
  const summary = summarize([usage('codex', 300)], statuses(), settings, october, catalog, true);
  assert.equal(summary.total.apiEquivalent, 300);
  assert.equal(summary.total.comparison.subscription, 100);
  assert.equal(summary.total.comparison.apiSpend, 50);
  assert.equal(summary.total.comparison.paid, 150);
  assert.equal(summary.total.comparison.value, 150);
  assert.equal(summary.total.comparison.roi, 2);
  assert.equal(summary.total.comparison.breakEven, '2026-10-15');
  const receipt = receiptModel(summary);
  assert.equal(receipt.rows.find((row) => row.left === 'API Paid')?.right, '$50.00');
  assert.equal(receipt.rows.find((row) => row.left === 'Total Paid')?.right, '$150.00');
  assert.equal(receipt.rows.find((row) => row.left === 'VALUE MULTIPLE')?.right, '2.00×');
});

test('API-only comparison uses the declared payment, not the calculated list-price cost', () => {
  const settings = defaultSettings();
  settings.monthlyBilling = { '2026-10': { claude: { mode: 'API', monthly: null, apiSpend: 12 } } };
  const summary = summarize([usage('claude', 20)], statuses(), settings, october, catalog);
  assert.equal(summary.total.comparison.paid, 12);
  assert.equal(summary.total.comparison.value, 8);
  assert.equal(summary.total.comparison.roi, 20 / 12);
  assert.equal(summary.total.comparison.outcome, 'neutral');
});

test('missing API spend excludes that provider until set; zero is an explicit known payment', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 100 };
  const rows = [usage('codex', 200), usage('claude', 20)];
  let summary = summarize(rows, statuses(), settings, october, catalog);
  assert.equal(summary.providers[1].mode, 'API');
  assert.equal(summary.providers[1].needsBilling, true);
  assert.deepEqual(comparisonForDisplay(summary).scope, ['codex']);
  settings.monthlyBilling = { '2026-10': { claude: { mode: 'API', monthly: null, apiSpend: 0 } } };
  summary = summarize(rows, statuses(), settings, october, catalog);
  assert.equal(summary.providers[1].needsBilling, false);
  assert.equal(summary.total.comparison.paid, 100);
  assert.equal(summary.total.comparison.value, 120);
  assert.equal(summary.total.comparison.roi, 2.2);
  assert.deepEqual(comparisonForDisplay(summary).scope, []);
});

test('whole-month ranges sum individual subscriptions and API spend without prorating', () => {
  const settings = defaultSettings();
  settings.monthlyBilling = {
    '2026-09': { codex: { mode: 'SUBSCRIPTION', monthly: 20 } },
    '2026-10': { codex: { mode: 'MIXED', monthly: 100, apiSpend: 50 } },
  };
  const range = dateRange('custom', new Date(2026, 10, 5), '2026-09-01', '2026-10-31');
  const billing = billingForRange(settings, 'codex', range);
  assert.equal(billing.subscription, 120);
  assert.equal(billing.apiSpend, 50);
  assert.equal(billing.paid, 170);
  for (const preset of ['7d', '30d']) {
    const short = summarize(
      [usage('codex', 300)],
      statuses(),
      settings,
      dateRange(preset, new Date(2026, 9, 16)),
      catalog,
    );
    assert.equal(comparisonForDisplay(short).paid, null);
    assert.equal(comparisonForDisplay(short).roi, null);
  }
});

test('incomplete pricing uses an observed subtotal without inventing missing API expenses', () => {
  const settings = defaultSettings();
  settings.monthlyBilling = { '2026-10': { codex: { mode: 'MIXED', monthly: 100, apiSpend: 50 } } };
  const summary = summarize(
    [usage('codex', 300), record('codex', { id: 'unknown', model_raw: 'internal' })],
    statuses(),
    settings,
    october,
    catalog,
  );
  assert.equal(summary.total.comparison.value, null);
  assert.equal(comparisonForDisplay(summary).value, 150);
  assert.equal(comparisonForDisplay(summary).roi, 2);
  assert.equal(comparisonForDisplay(summary).outcome, 'neutral');
  settings.monthlyBilling['2026-10'].codex!.apiSpend = null;
  assert.equal(
    comparisonForDisplay(summarize([usage('codex', 300)], statuses(), settings, october, catalog))
      .roi,
    null,
  );
});

test('monthly billing validation accepts all modes, strips private fields and rejects malformed payments', () => {
  const settings = defaultSettings();
  settings.monthlyBilling = {
    '2026-10': { codex: { mode: 'MIXED', monthly: 100, planId: 'chatgpt-pro-100', apiSpend: 50 } },
  };
  assert.deepEqual(validateSettings(settings).monthlyBilling, settings.monthlyBilling);
  for (const bad of [-1, Infinity, NaN, '12', 1000001]) {
    const raw = structuredClone(settings) as unknown as { monthlyBilling: Record<string, unknown> };
    raw.monthlyBilling['2026-10'] = { codex: { mode: 'API', monthly: null, apiSpend: bad } };
    assert.throws(() => validateSettings(raw), /API spend/);
  }
  for (const key of ['2026-00', '2026-13', '../secret', '__proto__']) {
    assert.throws(() => validateSettings({ ...settings, monthlyBilling: { [key]: {} } }));
  }
  assert.throws(() =>
    validateSettings({ ...settings, monthlyBilling: { '2026-10': { other: {} } } }),
  );
  const raw = {
    ...settings,
    monthlyBilling: {
      '2026-10': {
        codex: { mode: 'API', monthly: null, apiSpend: 12, privatePath: 'PRIVATE_SENTINEL' },
      },
    },
  };
  assert.ok(!JSON.stringify(validateSettings(raw)).includes('PRIVATE_SENTINEL'));
  assert.throws(() =>
    validateSettings({
      ...settings,
      billing: { ...settings.billing, codex: { mode: 'API', monthly: null, apiSpend: 12 } },
    }),
  );
});
