import type { Billing, BillingMode, Provider, Settings } from './types.ts';
import type { Range, ProviderSummary } from './summary.ts';
import { fullCalendarMonths, shiftCalendarMonth } from './calendar.ts';

function civilDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function billingPeriodKey(range: Range): string {
  return (
    (range.calendarFrom ?? civilDate(new Date(range.from))) +
    ':' +
    (range.calendarTo ?? civilDate(new Date(Date.parse(range.until) - 1)))
  );
}
export function withPeriodBilling(
  settings: Settings,
  provider: Provider,
  range: Range,
  billing: Billing | null,
): Settings {
  const next = structuredClone(settings),
    exactKey = billingPeriodKey(range),
    monthly = fullCalendarMonths(range) === 1 && range.preset !== 'custom',
    key = monthly ? exactKey.slice(0, 7) : exactKey,
    declarations = monthly ? (next.monthlyBilling ??= {}) : (next.periodBilling ??= {});
  // A rolling range can share dates with a calendar month. Editing that month
  // supersedes an earlier exact-date declaration instead of leaving a stale override.
  if (monthly && next.periodBilling?.[exactKey]?.[provider]) {
    delete next.periodBilling[exactKey][provider];
    if (!Object.keys(next.periodBilling[exactKey]).length) delete next.periodBilling[exactKey];
  }
  declarations[key] ??= {};
  if (billing) declarations[key][provider] = billing;
  else delete declarations[key][provider];
  if (!Object.keys(declarations[key]).length) delete declarations[key];
  return next;
}
export function billingForSelection(settings: Settings, provider: Provider, range: Range): Billing {
  const exact = settings.periodBilling?.[billingPeriodKey(range)]?.[provider];
  if (exact) return exact;
  if (fullCalendarMonths(range) === 1)
    return billingForMonth(settings, provider, billingPeriodKey(range).slice(0, 7));
  if (range.preset === 'custom') {
    const saved = billingForMonth(settings, provider, billingPeriodKey(range).slice(0, 7));
    // Prefill the historical plan, but never copy one month's payments into a
    // different selection or treat a suggested amount as a confirmation.
    const resolved = billingForRange(settings, provider, range),
      wholeMonths = fullCalendarMonths(range) !== null;
    return {
      mode: wholeMonths ? resolved.mode : saved.mode,
      monthly: saved.monthly,
      planId: saved.planId,
      ...(wholeMonths && resolved.apiSpend !== null ? { apiSpend: resolved.apiSpend } : {}),
    };
  }
  return billingForMonth({ ...settings, monthlyBilling: undefined }, provider, '');
}

/** Custom dates need explicit expenses; other views retain their existing actions. */
export function showExpenseAction(
  provider: ProviderSummary,
  providers: ProviderSummary[],
  range?: Range,
): boolean {
  if (!provider.records) return false;
  if (range?.preset === 'custom') return true;
  if (provider.mode === 'MIXED') return true;
  return (
    (provider.mode === 'API' ||
      provider.mode === 'NO_SUBSCRIPTION' ||
      provider.mode === 'UNKNOWN') &&
    providers.some(
      (other) =>
        other.provider !== provider.provider &&
        other.records > 0 &&
        (other.mode === 'SUBSCRIPTION' || other.mode === 'MIXED') &&
        (other.monthly != null || (other.comparison.subscription ?? 0) > 0),
    )
  );
}

/** A default is a user preference, not evidence of how a historical request was billed. */
export function billingForMonth(settings: Settings, provider: Provider, month: string): Billing {
  const saved = settings.monthlyBilling?.[month]?.[provider] ?? settings.billing[provider];
  return {
    ...saved,
    mode: saved.mode === 'UNKNOWN' || saved.mode === 'NO_SUBSCRIPTION' ? 'API' : saved.mode,
  };
}

export function billingForRange(settings: Settings, provider: Provider, range: Range) {
  const count = fullCalendarMonths(range);
  const exact = settings.periodBilling?.[billingPeriodKey(range)]?.[provider];
  if (
    exact &&
    (count !== null || range.preset === 'custom') &&
    (count === null || exact.subscriptionSpend !== undefined)
  ) {
    const mode = exact.mode === 'UNKNOWN' || exact.mode === 'NO_SUBSCRIPTION' ? 'API' : exact.mode,
      subscription = mode === 'API' ? 0 : (exact.subscriptionSpend ?? null),
      apiSpend = mode === 'SUBSCRIPTION' ? 0 : (exact.apiSpend ?? null),
      paid = subscription !== null && apiSpend !== null ? subscription + apiSpend : null;
    return {
      mode,
      monthly: exact.monthly,
      subscription,
      apiSpend,
      paid,
      needsBilling: paid === null,
    };
  }
  const start = new Date(range.from);
  const first =
    range.calendarFrom?.slice(0, 7) ??
    `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  const months = Array.from(
    { length: count ?? 1 },
    (_, index) => exact ?? billingForMonth(settings, provider, shiftCalendarMonth(first, index)!),
  );
  const mode: BillingMode = months.every((b) => b.mode === months[0].mode)
    ? months[0].mode
    : 'MIXED';
  const subscriptionKnown = months.every((b) => b.mode === 'API' || b.monthly !== null);
  const apiKnown = months.every((b) => b.mode === 'SUBSCRIPTION' || b.apiSpend != null);
  const subscription =
    count !== null && subscriptionKnown
      ? months.reduce((total, b) => total + (b.mode === 'API' ? 0 : b.monthly!), 0)
      : null;
  const apiSpend =
    count !== null && apiKnown
      ? exact
        ? exact.mode === 'SUBSCRIPTION'
          ? 0
          : exact.apiSpend!
        : months.reduce((total, b) => total + (b.mode === 'SUBSCRIPTION' ? 0 : b.apiSpend!), 0)
      : null;
  return {
    mode,
    monthly: months.length === 1 ? months[0].monthly : null,
    subscription,
    apiSpend,
    paid: subscription !== null && apiSpend !== null ? subscription + apiSpend : null,
    needsBilling: (range.preset === 'custom' && count === null) || !subscriptionKnown || !apiKnown,
  };
}
