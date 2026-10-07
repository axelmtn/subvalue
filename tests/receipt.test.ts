import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptModel, comparisonForDisplay, money } from '../packages/receipt/src/index.ts';
import { summarize, dateRange } from '../packages/core/src/summary.ts';
import { defaultSettings } from '../packages/core/src/types.ts';
import { record, prices, statuses } from './helpers.ts';
const range = dateRange('month', new Date(2026, 9, 4, 12));

test('receipt dates preserve the selected calendar days across timezones', () => {
  const selected = {
    from: '2026-09-30T22:00:00.000Z',
    until: '2026-10-31T23:00:00.000Z',
    label: 'October 2026',
    preset: 'month' as const,
    calendarMonths: 1,
    calendarFrom: '2026-10-01',
    calendarTo: '2026-10-31',
  };
  const summary = summarize([record()], statuses(), defaultSettings(), selected, prices());
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ['America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/Paris']) {
      process.env.TZ = timezone;
      assert.equal(receiptModel(summary).periodDetail, 'Oct 1, 2026 – Oct 31, 2026', timezone);
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('receipt never rounds incomplete pricing up to 100%', () => {
  const records = Array.from({ length: 200 }, (_, index) =>
    record('codex', { id: String(index), model_raw: index === 199 ? 'unknown' : 'known' }),
  );
  const summary = summarize(records, statuses(), defaultSettings(), range, prices());
  assert.equal(summary.total.apiEquivalent, null);
  assert.equal(summary.total.pricedRecords, 199);
  assert.match(receiptModel(summary).confidence, /<100% priced/);
});
test('receipt prints normalized token components without empty providers', () => {
  const summary = summarize(
    [
      record(),
      record('claude', { id: 'empty-claude', input_tokens: 0, output_tokens: 0, total_tokens: 0 }),
    ],
    statuses(),
    defaultSettings(),
    range,
    prices(),
    true,
  );
  const receipt = receiptModel(summary);
  assert.ok(receipt.rows.some((row) => row.left === 'Input Tokens' && row.right === '100'));
  assert.ok(receipt.rows.some((row) => row.left === 'Output Tokens' && row.right === '10'));
  assert.ok(receipt.rows.some((row) => row.left === 'Cache Reads' && row.right === '20'));
  assert.ok(!receipt.rows.some((row) => row.left === 'CLAUDE CODE'));
});
test('unknown receipt token totals and API costs never become zero', () => {
  const summary = summarize(
    [record('codex', { input_tokens: null, total_tokens: null })],
    statuses(),
    defaultSettings(),
    range,
    prices(),
    true,
  );
  const receipt = receiptModel(summary);
  assert.ok(receipt.rows.some((row) => row.left === 'Input Tokens' && row.right === 'Unknown'));
  assert.ok(receipt.rows.some((row) => row.left === 'Estimated API Cost' && row.right === '—'));
  assert.ok(!receipt.rows.some((row) => row.right === '$0.00'));
});
test('receipt component totals preserve missing fields and explicit zero across selected events', () => {
  const summary = summarize(
    [
      record('claude', { id: 'one', input_tokens: 0, output_tokens: 10, cached_input_tokens: 0 }),
      record('claude', {
        id: 'two',
        input_tokens: 0,
        output_tokens: 20,
        cached_input_tokens: null,
      }),
    ],
    statuses(),
    defaultSettings(),
    range,
    prices(),
    true,
  );
  const rows = receiptModel(summary).rows;
  assert.equal(rows.find((r) => r.left === 'Input Tokens')?.right, '0');
  assert.equal(rows.find((r) => r.left === 'Output Tokens')?.right, '30');
  assert.equal(rows.find((r) => r.left === 'Cache Reads')?.right, 'Unknown');
});
test('receipt shows the priced amount once while retaining unknown models in details', () => {
  for (const provider of ['codex', 'claude'] as const) {
    const summary = summarize(
      [
        record(provider, { id: 'priced' }),
        record(provider, {
          id: 'unpriced',
          model_raw: provider === 'codex' ? 'codex-auto-review' : 'internal-unknown',
        }),
      ],
      statuses(),
      defaultSettings(),
      range,
      prices([prices().prices[0], { ...prices().prices[0], provider: 'claude' }]),
      true,
    );
    const receipt = receiptModel(summary);
    assert.equal(summary.total.apiEquivalent, null);
    assert.ok(summary.total.knownSubtotal! > 0);
    assert.equal(summary.models.find((m) => m.raw !== 'known')!.pricedRecords, 0);
    assert.ok(receipt.rows.find((row) => row.left === 'Estimated API Cost')!.right.startsWith('$'));
    assert.ok(
      receipt.rows.find((row) => row.left === 'Total API Equivalent')!.right.startsWith('$'),
    );
    assert.ok(
      !receipt.rows.some((row) =>
        /Unavailable|Known Subtotal|KNOWN API VALUE/.test(row.left + ' ' + row.right),
      ),
    );
    assert.equal(receipt.outcome, '');
  }
});
test('partial-period receipt retains known API amounts without subscription comparisons', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 100 };
  const selected = {
    from: '2026-10-01T00:00:00Z',
    until: '2026-10-08T00:00:00Z',
    label: 'Last 7 days',
  };
  const summary = summarize(
    [
      record('codex', {
        id: 'priced',
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 28742000,
        total_tokens: 28742000,
      }),
      record('codex', { id: 'review', model_raw: 'codex-auto-review' }),
    ],
    statuses(),
    settings,
    selected,
    prices(),
  );
  const receipt = receiptModel(summary);
  assert.equal(summary.total.comparison.roi, null);
  assert.equal(summary.total.comparison.subscription, null);
  assert.ok(!receipt.rows.some((r) => ['VALUE MULTIPLE', 'Subscription Cost'].includes(r.left)));
  assert.ok(!receipt.rows.some((r) => r.left === 'You Saved'));
  assert.match(receipt.confidence, /50% priced/);
  assert.equal(receipt.outcome, '');
});

test('Overview and receipt share the observed comparison without pricing unknown events', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 100 };
  const summary = summarize(
    [
      record('codex', {
        id: 'priced',
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 28742000,
        total_tokens: 28742000,
      }),
      record('codex', { id: 'review', model_raw: 'codex-auto-review' }),
    ],
    statuses(),
    settings,
    range,
    prices(),
  );
  const display = comparisonForDisplay(summary),
    receipt = receiptModel(summary);
  assert.equal(summary.total.apiEquivalent, null);
  assert.equal(summary.total.comparison.roi, null);
  assert.equal(summary.total.comparison.value, null);
  assert.equal(display.value, summary.total.knownSubtotal! - display.subscription!);
  assert.equal(display.roi, summary.total.knownSubtotal! / display.subscription!);
  assert.equal(receipt.rows.find((r) => r.left === 'You Saved')?.right, money(display.value, true));
  assert.equal(
    receipt.rows.find((r) => r.left === 'VALUE MULTIPLE')?.right,
    display.roi!.toFixed(2) + '×',
  );
  assert.equal(display.outcome, 'neutral');
  assert.equal(display.breakEven, null);
  assert.match(receipt.confidence, /50% priced/);
});

test('observed comparison preserves unknown amounts and ineligible billing modes', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 100 };
  for (const rows of [[], [record('codex', { model_raw: 'codex-auto-review' })]]) {
    const summary = summarize(rows, statuses(), settings, range, prices());
    const display = comparisonForDisplay(summary);
    assert.equal(display.value, null);
    assert.equal(display.roi, null);
  }
  for (const mode of ['NO_SUBSCRIPTION', 'API', 'MIXED', 'UNKNOWN'] as const) {
    settings.billing.codex = { mode, monthly: null };
    const display = comparisonForDisplay(
      summarize([record()], statuses(), settings, range, prices()),
    );
    assert.equal(display.subscription, null);
    assert.equal(display.value, null);
    assert.equal(display.roi, null);
  }
});

test('receipt multiplier needs a known amount and a positive subscription for all active providers', () => {
  for (const mode of ['NO_SUBSCRIPTION', 'API', 'MIXED', 'UNKNOWN'] as const) {
    const settings = defaultSettings();
    settings.billing.codex = { mode, monthly: null };
    const receipt = receiptModel(summarize([record()], statuses(), settings, range, prices()));
    assert.ok(!receipt.rows.some((r) => r.left === 'VALUE MULTIPLE'));
  }
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 100 };
  assert.ok(
    !receiptModel(
      summarize(
        [record('codex', { model_raw: 'codex-auto-review' })],
        statuses(),
        settings,
        range,
        prices(),
      ),
    ).rows.some((r) => r.left === 'VALUE MULTIPLE'),
  );
  settings.billing.codex.monthly = 0;
  assert.ok(
    !receiptModel(summarize([record()], statuses(), settings, range, prices())).rows.some(
      (r) => r.left === 'VALUE MULTIPLE',
    ),
  );
  settings.billing.codex.monthly = 100;
  settings.billing.claude = { mode: 'MIXED', monthly: null };
  const all = prices([prices().prices[0], { ...prices().prices[0], provider: 'claude' }]);
  assert.ok(
    !receiptModel(
      summarize([record(), record('claude', { id: 'claude' })], statuses(), settings, range, all),
    ).rows.some((r) => r.left === 'VALUE MULTIPLE'),
  );
});
