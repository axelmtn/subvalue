import { billingForRange } from './billing.ts';
import type { Provider, Settings, SourceStatus, UsageRecord } from './types.ts';
import { priceRecord, catalog, type Catalog } from './pricing/index.ts';
import { fullCalendarMonths, shiftCalendarDays } from './calendar.ts';
export { fullCalendarMonths } from './calendar.ts';
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function localDay(timestamp: string): string {
  const parts = dayFormatter.formatToParts(new Date(timestamp));
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
export interface Range {
  from: string;
  until: string;
  label: string;
  preset?: string;
  calendarMonths?: number | null;
  calendarFrom?: string;
  calendarTo?: string;
}
export function dateRange(
  preset: string,
  now = new Date(),
  from?: string,
  to?: string,
  month?: string,
  anchor?: string,
): Range {
  const today = localDay(now.toISOString());
  if (anchor !== undefined) {
    if (
      (preset !== '7d' && preset !== '30d') ||
      !/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(anchor) ||
      shiftCalendarDays(anchor, 0) === null
    )
      throw new Error('Choose a valid period');
    now = new Date(anchor + 'T12:00:00');
  }
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  let label = 'Last 30 days';
  if (preset === '7d') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    label = 'Last 7 days';
  } else if (preset === 'month') {
    if (month !== undefined && !/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month))
      throw new Error('Choose a valid month');
    const year = month ? Number(month.slice(0, 4)) : now.getFullYear(),
      index = month ? Number(month.slice(5, 7)) - 1 : now.getMonth();
    start = new Date(year, index, 1);
    end.setTime(+new Date(year, index + 1, 1));
    label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } else if (preset === 'custom') {
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
      throw new Error('Choose a valid date range');
    start = new Date(from + 'T00:00:00');
    const last = new Date(to + 'T00:00:00');
    const matches = (date: Date, text: string) =>
      Number.isFinite(+date) &&
      date.getFullYear() === Number(text.slice(0, 4)) &&
      date.getMonth() + 1 === Number(text.slice(5, 7)) &&
      date.getDate() === Number(text.slice(8, 10));
    if (
      !matches(start, from) ||
      !matches(last, to) ||
      start > last ||
      +last - +start > 36600 * 864e5
    )
      throw new Error('Choose a valid date range');
    end.setTime(+new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
    label = `${from} — ${to}`;
  } else if (preset !== '30d') throw new Error('Invalid period');
  const calendarFrom = localDay(start.toISOString()),
    calendarTo = localDay(new Date(+end - 1).toISOString());
  if (anchor !== undefined && anchor !== today) label = `${calendarFrom} — ${calendarTo}`;
  const range = {
    from: start.toISOString(),
    until: end.toISOString(),
    label,
    preset,
    calendarFrom,
    calendarTo,
  };
  return { ...range, calendarMonths: fullCalendarMonths(range) };
}
export interface Comparison {
  apiSpend?: number | null;
  paid?: number | null;
  subscription: number | null;
  value: number | null;
  roi: number | null;
  breakEven: string | null;
  outcome: 'positive' | 'negative' | 'neutral';
  reason: string | null;
}
export function subscriptionForRange(monthly: number, range: Range): number | null {
  const months = fullCalendarMonths(range);
  return months === null ? null : monthly * months;
}
export interface ProviderSummary {
  provider: Provider;
  detected: boolean;
  visible: boolean;
  status: 'USAGE_FOUND' | 'NO_USAGE' | 'NO_DATA';
  records: number;
  importedRecords: number;
  tokens: number | null;
  tokensPartial: boolean;
  tokenBreakdown?: { input: number | null; output: number | null; cacheRead: number | null };
  apiEquivalent: number | null;
  knownSubtotal: number | null;
  pricedRecords: number;
  priceCoverage: number | null;
  confidence: string;
  historyPartial: boolean;
  comparison: Comparison;
  mode: string;
  monthly: number | null;
  needsBilling?: boolean;
  first: string | null;
  last: string | null;
  days: number;
  issues: Record<string, number>;
}
export interface Daily {
  date: string;
  codex: number | null;
  claude: number | null;
  hasUsage: boolean;
}
export interface ModelCoverage {
  provider: Provider;
  raw: string;
  canonical: string | null;
  records: number;
  pricedRecords: number;
  tokens: number | null;
  pricedTokens: number | null;
  knownSubtotal: number | null;
  mappingConfidence: string | null;
  mappingSource: string | null;
  issues: Record<string, number>;
}
export interface Summary {
  range: Range;
  providers: ProviderSummary[];
  total: {
    apiEquivalent: number | null;
    knownSubtotal: number | null;
    records: number;
    pricedRecords: number;
    priceCoverage: number | null;
    comparison: Comparison;
  };
  daily: Daily[];
  confidence: string;
  historyPartial: boolean;
  unresolvedModels: string[];
  models: ModelCoverage[];
  pricingVersion: string;
  demo: boolean;
}
function neutral(reason: string, subscription: number | null = null): Comparison {
  return { subscription, value: null, roi: null, breakEven: null, outcome: 'neutral', reason };
}
export function summarize(
  records: UsageRecord[],
  statuses: SourceStatus[],
  settings: Settings,
  range: Range,
  c: Catalog = catalog,
  demo = false,
): Summary {
  const selected = records.filter(
    (r) => r.timestamp && r.timestamp >= range.from && r.timestamp < range.until,
  );
  const prices = new Map(selected.map((r) => [r.id, priceRecord(r, c)]));
  const dailyMap = new Map<string, Daily>();
  for (const r of selected) {
    const date = localDay(r.timestamp!);
    const d = dailyMap.get(date) ?? { date, codex: null, claude: null, hasUsage: true };
    const cost = prices.get(r.id)!.usd;
    if (cost !== null) d[r.provider] = (d[r.provider] ?? 0) + cost;
    dailyMap.set(date, d);
  }
  const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const providers = (['codex', 'claude'] as Provider[]).map((provider) => {
    const rows = selected.filter((r) => r.provider === provider),
      all = records.filter((r) => r.provider === provider),
      source = statuses.find((s) => s.provider === provider);
    const issues: Record<string, number> = {};
    const costs = rows.map((r) => prices.get(r.id)!);
    for (const p of costs) if (p.reason) issues[p.reason] = (issues[p.reason] ?? 0) + 1;
    const undated = all.filter((r) => !r.timestamp).length;
    if (undated) issues['undated-events'] = undated;
    const priced = costs.filter((p) => p.usd !== null),
      subtotal = priced.length ? priced.reduce((n, p) => n + p.usd!, 0) : null;
    const historyPartial = !demo; // Local transcripts cannot prove that all historical requests were retained.
    const completePricing = rows.length > 0 && priced.length === rows.length;
    const apiEquivalent = completePricing ? subtotal : null;
    const billing = billingForRange(settings, provider, range);
    const { subscription, apiSpend, paid } = billing;
    let comparison: Comparison = {
      ...neutral(
        fullCalendarMonths(range) === null
          ? 'Choose a full month'
          : paid === null
            ? 'Expenses not set'
            : 'Partial history',
        subscription,
      ),
      apiSpend,
      paid,
    };
    if (completePricing && paid !== null) {
      const value = apiEquivalent! - paid;
      let accumulated = 0;
      let breakEven: string | null = null;
      for (const d of daily) {
        accumulated += d[provider] ?? 0;
        if (accumulated >= paid) {
          breakEven = d.date;
          break;
        }
      }
      comparison = {
        subscription,
        apiSpend,
        paid,
        value,
        roi: paid > 0 ? apiEquivalent! / paid : null,
        breakEven: historyPartial ? null : breakEven,
        outcome:
          historyPartial || subscription === 0
            ? 'neutral'
            : value > 0
              ? 'positive'
              : value < 0
                ? 'negative'
                : 'neutral',
        reason: historyPartial ? 'Observed usage · Partial history' : null,
      };
    }
    const sumTokens = (
      key: 'input_tokens' | 'output_tokens' | 'cached_input_tokens',
    ): number | null =>
      rows.length && rows.every((r) => r[key] !== null)
        ? rows.reduce((total, r) => total + r[key]!, 0)
        : null;
    const tokenBreakdown = {
      input: sumTokens('input_tokens'),
      output: sumTokens('output_tokens'),
      cacheRead: sumTokens('cached_input_tokens'),
    };
    const tokensKnown = rows.filter((r) => r.total_tokens !== null);
    const timestamps = all
      .map((r) => r.timestamp)
      .filter((t): t is string => !!t)
      .sort();
    const hasUsage = rows.some((r) => r.total_tokens !== 0);
    const sourceIncomplete =
      source?.errors ||
      source?.missingFiles ||
      source?.diagnostics.malformed ||
      source?.diagnostics.partialTail ||
      source?.diagnostics.oversize ||
      source?.diagnostics.unsupported;
    return {
      provider,
      detected: source?.detected ?? false,
      visible: hasUsage || settings.include[provider],
      status: rows.length ? (hasUsage ? 'USAGE_FOUND' : 'NO_USAGE') : 'NO_DATA',
      records: rows.length,
      importedRecords: all.length,
      tokens: tokensKnown.length ? tokensKnown.reduce((n, r) => n + r.total_tokens!, 0) : null,
      tokensPartial: tokensKnown.length !== rows.length,
      tokenBreakdown,
      apiEquivalent,
      knownSubtotal: subtotal,
      pricedRecords: priced.length,
      priceCoverage: rows.length ? priced.length / rows.length : null,
      confidence: !rows.length
        ? 'NO DATA'
        : rows.some((r) => r.quality === 'INCOMPLETE')
          ? 'INCOMPLETE'
          : sourceIncomplete || undated || rows.some((r) => r.quality === 'LOW')
            ? 'LOW'
            : rows.some((r) => r.quality === 'MEDIUM')
              ? 'MEDIUM'
              : 'HIGH',
      historyPartial,
      comparison,
      mode: billing.mode,
      monthly: billing.monthly,
      needsBilling: billing.needsBilling,
      first: timestamps[0] ?? null,
      last: timestamps.at(-1) ?? null,
      days: new Set(timestamps.map((t) => t.slice(0, 10))).size,
      issues,
    } satisfies ProviderSummary;
  });
  const active = providers.filter((p) => p.records > 0),
    pricedRecords = active.reduce((n, p) => n + p.pricedRecords, 0),
    count = selected.length;
  const known = active.filter((p) => p.knownSubtotal !== null);
  const knownSubtotal = known.length ? known.reduce((n, p) => n + p.knownSubtotal!, 0) : null;
  const apiEquivalent = count > 0 && pricedRecords === count ? knownSubtotal : null;
  let comparison: Comparison = neutral('Expenses not set');
  if (active.length && active.every((p) => p.comparison.paid != null)) {
    const subscription = active.reduce((n, p) => n + p.comparison.subscription!, 0),
      apiSpend = active.reduce((n, p) => n + p.comparison.apiSpend!, 0),
      paid = subscription + apiSpend;
    comparison = { ...neutral('Partial history', subscription), apiSpend, paid };
    if (apiEquivalent !== null) {
      const value = apiEquivalent - paid;
      let accumulated = 0,
        breakEven: string | null = null;
      if (demo)
        for (const d of daily) {
          accumulated += (d.codex ?? 0) + (d.claude ?? 0);
          if (accumulated >= paid) {
            breakEven = d.date;
            break;
          }
        }
      comparison = {
        subscription,
        apiSpend,
        paid,
        value,
        roi: paid > 0 ? apiEquivalent / paid : null,
        breakEven,
        outcome:
          demo && subscription > 0
            ? value > 0
              ? 'positive'
              : value < 0
                ? 'negative'
                : 'neutral'
            : 'neutral',
        reason: demo ? null : 'Observed usage · Partial history',
      };
    }
  }
  const confidence = active.length
    ? ['INCOMPLETE', 'LOW', 'MEDIUM', 'HIGH'].find((q) => active.some((p) => p.confidence === q))!
    : 'NO DATA';
  const groups = new Map<string, UsageRecord[]>();
  for (const r of selected) {
    const key = r.provider + ':' + (r.model_raw ?? 'Unknown model');
    let rows = groups.get(key);
    if (!rows) {
      rows = [];
      groups.set(key, rows);
    }
    rows.push(r);
  }
  const models = [...groups.values()].map((rows) => {
    const first = rows[0],
      p = prices.get(first.id)!;
    const priced = rows.filter((r) => prices.get(r.id)!.usd !== null),
      known = rows.filter((r) => r.total_tokens !== null);
    const issues: Record<string, number> = {};
    for (const r of rows) {
      const reason = prices.get(r.id)!.reason;
      if (reason) issues[reason] = (issues[reason] ?? 0) + 1;
    }
    return {
      provider: first.provider,
      raw: first.model_raw ?? 'Unknown model',
      canonical: p.canonical,
      records: rows.length,
      pricedRecords: priced.length,
      tokens: known.length ? known.reduce((n, r) => n + r.total_tokens!, 0) : null,
      pricedTokens: priced.some((r) => r.total_tokens !== null)
        ? priced.reduce((n, r) => n + (r.total_tokens ?? 0), 0)
        : null,
      knownSubtotal: priced.length ? priced.reduce((n, r) => n + prices.get(r.id)!.usd!, 0) : null,
      mappingConfidence: p.mapping?.confidence ?? null,
      mappingSource: p.mapping?.source ?? null,
      issues,
    };
  });
  return {
    range,
    providers,
    total: {
      apiEquivalent,
      knownSubtotal,
      records: count,
      pricedRecords,
      priceCoverage: count ? pricedRecords / count : null,
      comparison,
    },
    daily,
    confidence,
    historyPartial: !demo,
    unresolvedModels: [
      ...new Set(
        selected
          .filter((r) => !prices.get(r.id)!.canonical)
          .map((r) => r.model_raw ?? 'Unknown model'),
      ),
    ],
    models,
    pricingVersion: c.version,
    demo,
  };
}
