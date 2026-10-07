import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize,
  dateRange,
  subscriptionForRange,
  fullCalendarMonths,
} from '../packages/core/src/summary.ts';
import { defaultSettings } from '../packages/core/src/types.ts';
import { receiptModel } from '../packages/receipt/src/index.ts';
import { record, price, prices, statuses } from './helpers.ts';
const range = dateRange('month', new Date(2026, 9, 4, 12));
test('missing records are NO DATA, not a zero-dollar total', () => {
  const s = summarize([], statuses(), defaultSettings(), range, prices());
  assert.equal(s.total.apiEquivalent, null);
  assert.equal(s.total.priceCoverage, null);
  assert.equal(s.providers[0].status, 'NO_DATA');
  assert.equal(s.providers[0].visible, false);
});
test('directory detection is independent of relevant usage', () => {
  const s = summarize([record()], statuses(), defaultSettings(), range, prices());
  assert.equal(s.providers[1].detected, true);
  assert.equal(s.providers[1].visible, false);
  assert.equal(s.providers[1].status, 'NO_DATA');
});
test('manual inclusion shows missing provider without inventing zero usage', () => {
  const settings = defaultSettings();
  settings.include.claude = true;
  const s = summarize([], statuses(), settings, range, prices());
  assert.equal(s.providers[1].visible, true);
  assert.equal(s.providers[1].apiEquivalent, null);
});
test('out-of-period usage is not active usage', () => {
  const s = summarize(
    [record('codex', { timestamp: '2026-07-01T00:00:00.000Z' })],
    statuses(),
    defaultSettings(),
    range,
    prices(),
  );
  assert.equal(s.total.records, 0);
  assert.equal(s.providers[0].first, '2026-07-01T00:00:00.000Z');
});
test('unknown models retain known subtotal and suppress a false total', () => {
  const s = summarize(
    [record(), record('codex', { id: 'unknown', model_raw: 'internal' })],
    statuses(),
    defaultSettings(),
    range,
    prices(),
  );
  assert.equal(s.total.apiEquivalent, null);
  assert.ok(s.total.knownSubtotal! > 0);
  assert.equal(s.total.priceCoverage, 0.5);
});
test('pricing coverage is record coverage, never invented historical coverage', () => {
  const s = summarize([record()], statuses(), defaultSettings(), range, prices());
  assert.equal(s.total.priceCoverage, 1);
  assert.equal(s.historyPartial, true);
});
test('API and mixed billing never produce subscription ROI', () => {
  for (const mode of ['API', 'MIXED'] as const) {
    const settings = defaultSettings();
    settings.billing.codex = { mode, monthly: null };
    const s = summarize([record()], statuses(), settings, range, prices(), true);
    assert.equal(s.total.comparison.subscription, null);
    assert.equal(s.total.comparison.roi, null);
    assert.equal(s.total.comparison.value, null);
  }
});
test('unknown billing stays unknown', () => {
  const s = summarize([record()], statuses(), defaultSettings(), range, prices(), true);
  assert.equal(s.providers[0].mode, 'UNKNOWN');
  assert.equal(s.total.comparison.roi, null);
});
test('subscription comparisons correctly calculate value and ROI', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 200 };
  const r = record('codex', {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 28742000,
    total_tokens: 28742000,
  });
  const s = summarize([r], statuses(), settings, range, prices(), true);
  assert.ok(Math.abs(s.total.comparison.subscription! - 200) < 1e-8);
  assert.ok(Math.abs(s.total.comparison.value! - 87.42) < 1e-8);
  assert.ok(Math.abs(s.total.comparison.roi! - 1.4371) < 1e-8);
  assert.equal(s.total.comparison.breakEven, '2026-10-01');
  assert.equal(s.total.comparison.outcome, 'positive');
});
test('negative receipt variant uses restrained negative outcome', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 200 };
  const s = summarize([record()], statuses(), settings, range, prices(), true);
  assert.equal(s.total.comparison.outcome, 'negative');
  assert.equal(receiptModel(s).outcome, 'API WOULD HAVE BEEN CHEAPER');
});
test('partial history cannot imply a certain subscription outcome', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 200 };
  const s = summarize([record()], statuses(), settings, range, prices());
  assert.equal(s.total.comparison.outcome, 'neutral');
  assert.equal(s.total.comparison.breakEven, null);
  assert.match(receiptModel(s).confidence, /Partial history/);
});
test('incomplete pricing suppresses ROI and outcome', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 200 };
  const s = summarize(
    [record('codex', { input_tokens: null })],
    statuses(),
    settings,
    range,
    prices(),
    true,
  );
  assert.equal(s.total.comparison.value, null);
  assert.equal(s.total.comparison.roi, null);
  assert.equal(s.total.comparison.outcome, 'neutral');
});
test('receipt contains no project, session, file, or request identifiers', () => {
  const s = summarize(
    [
      record('codex', {
        project_identifier_hash: 'SECRET_PROJECT',
        session_id: 'SECRET_SESSION',
        source_file_reference: 'SECRET_FILE',
        request_id: 'SECRET_REQUEST',
      }),
    ],
    statuses(),
    defaultSettings(),
    range,
    prices(),
    true,
  );
  const out = JSON.stringify(receiptModel(s));
  assert.ok(!out.includes('SECRET'));
});
test('partial calendar months never receive a prorated subscription', () => {
  const r = dateRange('custom', new Date(), '2024-02-28', '2024-03-01');
  assert.equal(subscriptionForRange(290, r), null);
});
test('month compares full monthly subscription and custom end day is inclusive', () => {
  const now = new Date(2026, 9, 4, 12);
  const month = dateRange('month', now);
  assert.equal(new Date(month.from).getDate(), 1);
  assert.equal(new Date(month.until).getMonth(), 10);
  assert.equal(new Date(month.until).getDate(), 1);
  assert.ok(Math.abs(subscriptionForRange(200, month)! - 200) < 1e-8);
  const custom = dateRange('custom', now, '2026-07-24', '2026-08-02');
  assert.equal(new Date(custom.until).getDate(), 3);
  assert.throws(() => dateRange('custom', now, '2026-08-02', '2026-07-24'));
});
test('invalid calendar dates and excessive ranges are rejected', () => {
  assert.throws(() => dateRange('custom', new Date(), '2026-02-31', '2026-03-03'));
  assert.throws(() => dateRange('custom', new Date(), '0100-01-01', '2026-01-01'));
});
test('recorded zero is priced as zero but does not force a useless provider card', () => {
  const s = summarize(
    [
      record('codex', {
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      }),
    ],
    statuses(),
    defaultSettings(),
    range,
    prices(),
  );
  assert.equal(s.total.apiEquivalent, 0);
  assert.equal(s.providers[0].visible, false);
  assert.equal(s.providers[0].status, 'NO_USAGE');
});
test('confidence reflects medium records and missing sources', () => {
  const r = record('codex', { quality: 'MEDIUM' });
  assert.equal(summarize([r], statuses(), defaultSettings(), range, prices()).confidence, 'MEDIUM');
  const source = statuses();
  source[0].missingFiles = 1;
  assert.equal(summarize([r], source, defaultSettings(), range, prices()).confidence, 'LOW');
});
test('undated records remain visible in coverage diagnostics', () => {
  const s = summarize(
    [record(), record('codex', { id: 'undated', timestamp: null })],
    statuses(),
    defaultSettings(),
    range,
    prices(),
  );
  assert.equal(s.providers[0].issues['undated-events'], 1);
  assert.equal(s.confidence, 'LOW');
  assert.equal(s.total.records, 1);
});
test('combined break-even uses the total daily value rather than provider crossing dates', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 100 };
  settings.billing.claude = { mode: 'SUBSCRIPTION', monthly: 100 };
  const r = (provider: 'codex' | 'claude', id: string, day: string, usd: number) =>
    record(provider, {
      id,
      timestamp: `2026-10-${day}T11:00:00.000Z`,
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: usd * 100000,
      total_tokens: usd * 100000,
    });
  const s = summarize(
    [
      r('codex', 'a', '01', 150),
      r('claude', 'b', '01', 10),
      r('codex', 'c', '02', 30),
      r('claude', 'd', '02', 20),
    ],
    statuses(),
    settings,
    range,
    prices([price(), price({ provider: 'claude' })]),
    true,
  );
  assert.equal(s.total.comparison.breakEven, '2026-10-02');
});
test('unresolved models keep tokens separate in safe coverage metadata', () => {
  const s = summarize(
    [
      record(),
      record('codex', {
        id: 'unknown',
        model_raw: 'internal',
        total_tokens: 500,
        session_id: 'PRIVATE_SESSION',
      }),
    ],
    statuses(),
    defaultSettings(),
    range,
    prices(),
  );
  const model = s.models.find((m) => m.raw === 'internal')!;
  assert.equal(model.tokens, 500);
  assert.equal(model.pricedTokens, null);
  assert.equal(model.knownSubtotal, null);
  assert.equal(model.pricedRecords, 0);
  assert.ok(!JSON.stringify(s).includes('PRIVATE_SESSION'));
});
test('7D and 30D never compare subscriptions, including a coincidental whole month', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 310 };
  for (const preset of ['7d', '30d']) {
    const selected = dateRange(preset, new Date(2026, 8, 30, 12));
    assert.equal(subscriptionForRange(310, selected), null);
    const s = summarize(
      [record('codex', { timestamp: '2026-09-30T10:00:00.000Z' })],
      statuses(),
      settings,
      selected,
      prices(),
      true,
    );
    assert.equal(s.total.comparison.subscription, null);
    assert.equal(s.total.comparison.value, null);
    assert.equal(s.total.comparison.roi, null);
    assert.equal(s.total.comparison.breakEven, null);
  }
});
test('receipt labels the multiplier as API value divided by amount paid', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 200 };
  const s = summarize([record()], statuses(), settings, range, prices(), true);
  const rows = receiptModel(s).rows;
  assert.ok(rows.some((r) => r.left === 'VALUE MULTIPLE'));
  assert.ok(rows.some((r) => r.left === 'Subscription Cost'));
});
test('historical month selection respects calendar boundaries, leap years and year changes', () => {
  for (const month of ['2026-05', '2026-06', '2024-02', '2026-03', '2026-10', '2025-12']) {
    const selected = dateRange('month', new Date(2026, 9, 6), undefined, undefined, month);
    assert.equal(new Date(selected.from).getMonth() + 1, Number(month.slice(5)));
    assert.equal(new Date(selected.from).getFullYear(), Number(month.slice(0, 4)));
    assert.equal(fullCalendarMonths(selected), 1);
    assert.equal(subscriptionForRange(200, selected), 200);
  }
  for (const invalid of ['2026-00', '2026-13', '2026-1', '2026-05-01', '2026-05junk', ''])
    assert.throws(() => dateRange('month', new Date(), undefined, undefined, invalid));
});
test('custom ranges compare only complete calendar months at full price', () => {
  const now = new Date(2026, 9, 6);
  for (const [from, to, months] of [
    ['2024-02-01', '2024-02-29', 1],
    ['2026-03-01', '2026-04-30', 2],
    ['2025-12-01', '2026-02-28', 3],
  ] as const) {
    const selected = dateRange('custom', now, from, to);
    assert.equal(fullCalendarMonths(selected), months);
    assert.equal(subscriptionForRange(200, selected), months * 200);
  }
  for (const [from, to] of [
    ['2026-05-02', '2026-05-31'],
    ['2026-05-01', '2026-05-30'],
    ['2026-05-01', '2026-06-01'],
  ])
    assert.equal(subscriptionForRange(200, dateRange('custom', now, from, to)), null);
  assert.equal(
    fullCalendarMonths({
      ...range,
      calendarMonths: undefined,
      from: new Date(2026, 9, 1, 0, 0, 0, 1).toISOString(),
    }),
    null,
  );
  assert.equal(
    fullCalendarMonths({ ...range, calendarMonths: undefined, until: range.from }),
    null,
  );
});
test('current-month receipt marks progress while preserving full monthly price and uncertain outcome', () => {
  const settings = defaultSettings();
  settings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 200 };
  const s = summarize([record()], statuses(), settings, range, prices());
  const ticket = receiptModel(s, new Date(2026, 9, 6, 12));
  assert.equal(s.total.comparison.subscription, 200);
  assert.match(ticket.confidence, /In progress/);
  assert.equal(ticket.outcome, '');
  assert.doesNotMatch(receiptModel(s, new Date(2026, 10, 2)).confidence, /In progress/);
});
