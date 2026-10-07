import './style.css';
import { product, productMark, productNameMarkup } from '../../../packages/ui/src/brand.ts';
document.title = product.name + ' — Local usage';
import type {
  Settings,
  Provider,
  SourceStatus,
  Billing,
} from '../../../packages/core/src/types.ts';
import {
  billingForSelection,
  withPeriodBilling,
  showExpenseAction,
} from '../../../packages/core/src/billing.ts';
import {
  subscriptionPlans,
  subscriptionPlan,
  subscriptionPlanLabel,
  subscriptionVerified,
} from '../../../packages/core/src/subscriptions.ts';
import type { Summary } from '../../../packages/core/src/summary.ts';
import type { BootstrapResponse } from '../../../packages/cli/src/protocol.ts';
import {
  fullCalendarMonths,
  shiftCalendarDays,
  shiftCalendarMonth,
} from '../../../packages/core/src/calendar.ts';
import { formatPricingCoverage } from '../../../packages/core/src/coverage.ts';
import {
  drawReceipt,
  receiptModel,
  receiptFonts,
  exportReceipt,
  money,
  comparisonForDisplay,
} from '../../../packages/receipt/src/index.ts';
const app = document.querySelector<HTMLDivElement>('#app')!;
const name = (p: Provider) => (p === 'codex' ? 'Codex' : 'Claude Code');
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const icon = (key: string) => {
  const paths: Record<string, string> = {
    bars: 'M5 20V14 M12 20V8 M19 20V3',
    card: 'M3 5h18v14H3z M3 9h18 M6 14h4',
    overview: 'M3 10 12 3l9 7v10H3z M9 20v-7h6v7',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
    settings:
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
    arrow: 'M4 12h16 M14 6l6 6-6 6',
    previous: 'm15 6-6 6 6 6',
    next: 'm9 6 6 6-6 6',
    download: 'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z',
    token: 'M12 3 21 8v8l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v8',
    check: 'm5 12 4 4 10-10',
    refresh: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 2 M18 18a8 8 0 0 1-13-2',
  };
  return /* HTML */ `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="${paths[key] ?? paths.token}" />
  </svg>`;
};
let expenseProvider: Provider | null = null;
let expensesSaving = false;
let settings: Settings,
  sources: SourceStatus[] = [],
  summary: Summary,
  token = '',
  demo = false,
  lastScan: string | null = null;
let page =
  location.pathname === '/receipt'
    ? 'receipt'
    : location.pathname === '/settings'
      ? 'settings'
      : 'overview';
let period = 'month',
  from = '',
  to = '',
  onboardingStage = 'found';
let anchor = '';
let selectedMonth = localDate(new Date()).slice(0, 7),
  periodLoading = false;
let busy = false;
let themeSaving = false;
let displayedReceipt: ReturnType<typeof receiptModel>;
function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function periodLabel() {
  return (
    summary.range.label +
    (!summary.demo &&
    Date.parse(summary.range.from) <= Date.now() &&
    Date.parse(summary.range.until) > Date.now() &&
    fullCalendarMonths(summary.range) !== null
      ? ' · In progress'
      : '')
  );
}
async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Subvalue-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Unable to complete request');
  return response.json();
}
function toast(text: string) {
  const el = document.querySelector<HTMLDivElement>('#toast')!;
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}
let loadVersion = 0;
async function load() {
  const version = ++loadVersion;
  const next = await api<Summary>(
    `/api/summary?period=${period}${period === 'custom' ? `&from=${from}&to=${to}` : period === 'month' ? `&month=${selectedMonth}` : anchor ? `&anchor=${anchor}` : ''}`,
  );
  if (version !== loadVersion) return false;
  summary = next;
  return true;
}
function metric(label: string, value: string, detail = '', accent = '') {
  const symbol =
    label === 'Subscription'
      ? 'card'
      : label === 'Value multiple'
        ? 'bars'
        : label.includes('value') || label === 'Value'
          ? 'shield'
          : 'token';
  return /* HTML */ `<article class="metric ${accent}">
    <span class="label">${icon(symbol)}${label}</span
    ><strong>${value}</strong
    >${detail ? /* HTML */ `<span class="metric-detail">${detail}</span>` : ''}
  </article>`;
}
function navigation() {
  return /* HTML */ `<header class="topbar">
    <a href="/" class="brand" aria-label="${esc(product.name)} overview"
      ><span class="brand-mark">${productMark}</span>${productNameMarkup}</a
    >
    <nav aria-label="Main navigation">
      ${['overview', 'receipt', 'settings'].map((p) => /* HTML */ `<button data-page="${p}" class="nav-item ${page === p ? 'active' : ''}" ${page === p ? 'aria-current="page"' : ''}>${icon(p)}<span>${p[0].toUpperCase() + p.slice(1)}</span></button>`).join('')}
    </nav>
    <div class="header-period">${controls()}</div>
    <span class="local-status" aria-label="Local only">${icon('shield')}</span>
  </header>`;
}
function adjacentPeriod(direction: number) {
  if (period === 'month') {
    const month = shiftCalendarMonth(selectedMonth, direction);
    return month ? { month, from, to, anchor: '' } : null;
  }
  const first = summary.range.calendarFrom ?? localDate(new Date(summary.range.from)),
    last = summary.range.calendarTo ?? localDate(new Date(Date.parse(summary.range.until) - 1));
  const days =
    period === '7d'
      ? 7
      : period === '30d'
        ? 30
        : Math.round((Date.parse(last + 'T12:00:00Z') - Date.parse(first + 'T12:00:00Z')) / 864e5) +
          1;
  const nextFrom = shiftCalendarDays(first, direction * days),
    nextTo = shiftCalendarDays(last, direction * days);
  if (
    (period === '7d' || period === '30d') &&
    nextTo &&
    !/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(nextTo)
  )
    return null;
  return nextFrom && nextTo
    ? { month: selectedMonth, from: nextFrom, to: nextTo, anchor: nextTo }
    : null;
}
function periodArrow(direction: number) {
  const unit =
      period === 'month'
        ? 'month'
        : period === '7d'
          ? '7 days'
          : period === '30d'
            ? '30 days'
            : 'period',
    label = (direction < 0 ? 'Previous ' : 'Next ') + unit;
  return /* HTML */ `<button
    class="period-arrow"
    data-period-step="${direction}"
    type="button"
    aria-label="${label}"
    title="${label}"
    ${busy || !adjacentPeriod(direction) ? 'disabled' : ''}
  >
    ${icon(direction < 0 ? 'previous' : 'next')}
  </button>`;
}
function controls() {
  return /* HTML */ `<div class="period-selection" role="group" aria-label="Navigate periods">
      ${periodArrow(-1)}
      <div class="date-controls" aria-label="Period">
        ${[
          ['7d', '7D'],
          ['30d', '30D'],
          ['month', 'Month'],
          ['custom', 'Custom'],
        ]
          .map(
            ([v, l]) =>
              /* HTML */ `<button
                data-period="${v}"
                class="${period === v ? 'selected' : ''}"
                aria-pressed="${period === v}"
                ${v === 'month' || v === 'custom' ? 'aria-haspopup="dialog" aria-controls="period-picker" aria-expanded="false"' : ''}
              >
                ${l}
              </button>`,
          )
          .join('')}
      </div>
      ${periodArrow(1)}
    </div>
    <div
      id="period-picker"
      class="period-picker"
      popover="auto"
      role="dialog"
      aria-label="Choose period"
    >
      <form id="month-range" hidden>
        <label for="selected-month">Choose month</label
        ><input
          id="selected-month"
          type="month"
          name="month"
          value="${selectedMonth}"
          pattern="[0-9]{4}-[0-9]{2}"
          placeholder="YYYY-MM"
          required
        /><button class="button small">Apply</button>
      </form>
      <form id="custom-range" hidden>
        <div class="period-date-fields">
          <label
            >From<input
              type="date"
              name="from"
              value="${from || summary.range.calendarFrom || localDate(new Date(summary.range.from))}"
              required /></label
          ><label
            >To<input
              type="date"
              name="to"
              value="${to || summary.range.calendarTo || localDate(new Date(Date.parse(summary.range.until) - 1))}"
              required
          /></label>
        </div>
        <button class="button small">Apply</button>
      </form>
    </div>`;
}
function coverage() {
  return /* HTML */ `<details class="coverage">
    <summary>
      ${icon('shield')}<span
        >${summary.historyPartial ? 'Partial history' : summary.confidence === 'HIGH' ? 'High confidence' : 'Incomplete'}${summary.total.priceCoverage !== null ? ` · ${esc(formatPricingCoverage(summary.total.priceCoverage))} priced` : ''}</span
      ><span class="details-label">Details</span>
    </summary>
    <div class="coverage-content">
      <dl>
        <div>
          <dt>Confidence</dt>
          <dd>${esc(summary.confidence)}</dd>
        </div>
        <div>
          <dt>Usage events</dt>
          <dd>${summary.total.records.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Priced events</dt>
          <dd>${summary.total.pricedRecords.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Pricing version</dt>
          <dd>${esc(summary.pricingVersion)}</dd>
        </div>
      </dl>
      <p>
        Coverage describes imported records, not all requests ever made. Missing history stays
        unknown. Subscription comparison is available for full calendar months, at the full monthly
        price.
      </p>
      ${summary.providers
        .filter((p) => p.records || Object.keys(p.issues).length)
        .map(
          (p) =>
            /* HTML */ `<div class="issue-group">
              <strong>${name(p.provider)}</strong>${
                Object.entries(p.issues)
                  .map(
                    ([k, n]) =>
                      /* HTML */ `<span
                        >${esc(k.replaceAll('-', ' '))} <b>${n.toLocaleString()}</b></span
                      >`,
                  )
                  .join('') || '<span>All imported events priced</span>'
              }
            </div>`,
        )
        .join(
          '',
        )}${summary.unresolvedModels.length ? /* HTML */ `<p>Unresolved models: <code>${summary.unresolvedModels.map(esc).join(', ')}</code></p>` : ''}${summary.models.map((m) => /* HTML */ `<div class="model-coverage"><code>${esc(m.raw)}</code><span>${m.tokens === null ? 'Unknown tokens' : m.tokens.toLocaleString() + ' tokens'}</span><span>${m.pricedRecords}/${m.records} priced</span>${m.mappingSource ? /* HTML */ `<a href="${esc(m.mappingSource)}" target="_blank" rel="noreferrer">${esc(m.mappingConfidence)} mapping ↗</a>` : '<span>Mapping unavailable</span>'}</div>`).join('')}
    </div>
  </details>`;
}
function chart() {
  const daily = summary.daily;
  const values = daily.flatMap((d) => [d.codex, d.claude]).filter((n): n is number => n !== null);
  if (!values.length)
    return /* HTML */ `<section class="panel chart">
      <div class="panel-title">
        <h2>Daily API equivalent</h2>
        <span class="label">${summary.range.label}</span>
      </div>
      <div class="chart-empty">
        <span class="empty-chart-lines"></span
        ><span>${summary.total.records ? 'No priced usage' : 'No data for this period'}</span>
      </div>
    </section>`;
  const max = Math.max(...daily.map((d) => (d.codex ?? 0) + (d.claude ?? 0)), 0.01);
  const w = 700,
    h = 186,
    pad = 30,
    barArea = 620;
  const calendarDays = (Date.parse(daily.at(-1)!.date) - Date.parse(daily[0].date)) / 864e5 + 1;
  const bars = daily
    .map((d, index) => {
      const step = barArea / calendarDays,
        bw = Math.min(18, step * 0.7),
        x = 55 + ((Date.parse(d.date) - Date.parse(daily[0].date)) / 864e5) * step;
      const a = ((d.codex ?? 0) / max) * 140,
        b = ((d.claude ?? 0) / max) * 140;
      const label = dailyDescription(index);
      return /* HTML */ `<g
        data-chart-day="${index}"
        tabindex="0"
        role="button"
        aria-label="${esc(label)}"
        aria-describedby="chart-tooltip"
        ><rect
          x="${x}"
          y="${h - pad - a}"
          width="${bw}"
          height="${a}"
          rx="1"
          fill="url(#bar-green)" /><rect
          x="${x}"
          y="${h - pad - a - b}"
          width="${bw}"
          height="${b}"
          rx="1"
          fill="#8aadc2" /><rect
          class="chart-hit-target"
          x="${x - 3}"
          y="16"
          width="${bw + 6}"
          height="140"
          fill="transparent"
      /></g>`;
    })
    .join('');
  const labels = [0, 0.5, 1]
    .map(
      (f) =>
        /* HTML */ `<line
            x1="45"
            x2="690"
            y1="${h - pad - f * 140}"
            y2="${h - pad - f * 140}"
            stroke="#242a2e"
          /><text x="0" y="${h - pad - f * 140 + 4}" fill="#899097" font-size="10"
            >$${(max * f).toFixed(max < 1 ? 2 : 0)}</text
          >`,
    )
    .join('');
  return /* HTML */ `<section class="panel chart">
    <div class="panel-title">
      <h2>Daily API equivalent</h2>
      <div class="legend">
        ${summary.providers.some((p) => p.provider === 'codex' && p.records) ? '<span><i></i>Codex</span>' : ''}${summary.providers.some((p) => p.provider === 'claude' && p.records) ? '<span><i class="claude-dot"></i>Claude Code</span>' : ''}${summary.total.apiEquivalent === null ? '<span>Known portion</span>' : ''}
      </div>
    </div>
    <svg
      viewBox="0 0 ${w} ${h}"
      class="chart-svg"
      role="group"
      aria-label="Daily known API-equivalent value"
    >
      <defs>
        <linearGradient id="bar-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#37ec85" />
          <stop offset="100%" stop-color="#278451" />
        </linearGradient>
      </defs>
      ${labels}${bars}
    </svg>
    <div id="chart-tooltip" class="chart-tooltip" role="tooltip" hidden></div>
    <div class="chart-dates"><span>${daily[0].date}</span><span>${daily.at(-1)!.date}</span></div>
  </section>`;
}
function dailyDescription(index: number) {
  const day = summary.daily[index];
  return (
    day.date +
    ' · ' +
    summary.providers
      .filter((p) => p.records)
      .map(
        (p) =>
          name(p.provider) +
          ': ' +
          (day[p.provider] === null ? 'No priced data' : money(day[p.provider])),
      )
      .join(' · ')
  );
}
function bindChart() {
  const chart = document.querySelector<HTMLElement>('.chart'),
    tip = document.querySelector<HTMLElement>('#chart-tooltip');
  if (!chart || !tip) return;
  const hide = () => {
    tip.hidden = true;
    chart.querySelector('[data-chart-active]')?.removeAttribute('data-chart-active');
  };
  const show = (bar: SVGGElement) => {
    const day = summary.daily[Number(bar.dataset.chartDay)];
    if (!day) return;
    const amounts = [day.codex, day.claude].filter((v): v is number => v !== null),
      total = amounts.length ? amounts.reduce((a, b) => a + b, 0) : null;
    tip.innerHTML = /* HTML */ `<strong
        >${esc(new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}</strong
      >
      <dl>
        ${summary.providers
          .filter((p) => p.records)
          .map(
            (p) =>
              /* HTML */ `<div>
                <dt>${name(p.provider)}</dt>
                <dd>${day[p.provider] === null ? '—' : money(day[p.provider])}</dd>
              </div>`,
          )
          .join('')}
        <div class="chart-tip-total">
          <dt>Priced value</dt>
          <dd>${total === null ? '—' : money(total)}</dd>
        </div>
      </dl>`;
    tip.hidden = false;
    chart.querySelector('[data-chart-active]')?.removeAttribute('data-chart-active');
    bar.setAttribute('data-chart-active', '');
    const panel = chart.getBoundingClientRect(),
      bounds = bar.getBoundingClientRect();
    tip.style.left =
      Math.max(
        10,
        Math.min(
          chart.clientWidth - tip.offsetWidth - 10,
          bounds.left - panel.left + bounds.width / 2 - tip.offsetWidth / 2,
        ),
      ) + 'px';
    tip.style.top = Math.max(48, bounds.top - panel.top - tip.offsetHeight - 8) + 'px';
  };
  chart.querySelectorAll<SVGGElement>('[data-chart-day]').forEach((bar) => {
    bar.addEventListener('pointerenter', () => show(bar));
    bar.addEventListener('pointerleave', hide);
    bar.addEventListener('focus', () => show(bar));
    bar.addEventListener('blur', hide);
    bar.addEventListener('click', () => show(bar));
    bar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hide();
        event.preventDefault();
      } else if (event.key === 'Enter' || event.key === ' ') {
        show(bar);
        event.preventDefault();
      }
    });
  });
  chart.addEventListener('pointerleave', hide);
}
function providerCards() {
  return /* HTML */ `<div class="provider-grid">
    ${summary.providers
      .filter((p) => p.visible)
      .map(
        (p) =>
          /* HTML */ `<article class="panel provider-card">
            <div class="provider-title">
              ${p.provider === 'claude' ? '<img class="claude-code-product-mark" src="/brands/claude-code-clawd.svg" alt="" aria-hidden="true">' : '<img class="codex-product-mark" src="/brands/codex-outline.svg" alt="" aria-hidden="true">'}
              <h2
                class="${p.provider === 'claude' ? 'claude-code-product-name' : 'codex-product-name'}"
              >
                ${name(p.provider)}
              </h2>
              <span class="badge ${p.records ? 'green' : ''}"
                >${p.status === 'USAGE_FOUND' ? 'Usage found' : p.status === 'NO_USAGE' ? 'No usage' : 'No data'}</span
              >
            </div>
            <div class="provider-values">
              <div>
                <span class="label">API equivalent</span
                ><strong
                  >${p.records ? (p.knownSubtotal !== null ? money(p.apiEquivalent ?? p.knownSubtotal) : '—') : 'No data'}</strong
                >${p.apiEquivalent === null && p.knownSubtotal !== null ? /* HTML */ `<small>${esc(formatPricingCoverage(p.priceCoverage))} priced</small>` : ''}
              </div>
              <div>
                <span class="label">${p.tokensPartial ? 'Known tokens' : 'Tokens'}</span
                ><strong
                  >${p.tokens === null ? 'Unknown' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(p.tokens)}</strong
                >
              </div>
            </div>
            ${
              showExpenseAction(p, summary.providers)
                ? `<button type="button" class="provider-expense-toggle" data-expense-toggle="${p.provider}" aria-controls="card-expenses-${p.provider}" aria-expanded="false"><span>Categorize expenses for this period</span> ${icon('next')}</button>
                <div id="card-expenses-${p.provider}" class="provider-expenses-popover" popover aria-label="${name(p.provider)} expenses">
                <div class="expenses-heading"><h2>${name(p.provider)} · Expenses</h2><button type="button" class="text-button" popovertarget="card-expenses-${p.provider}" popovertargetaction="hide" aria-label="Close expenses">×</button></div>
                <form class="provider-expenses-form" data-period-billing="${p.provider}">
              ${billingFields(p.provider, true, billingForSelection(settings, p.provider, summary.range), true, 'card-')}
              <div class="expense-actions"><small>${esc(periodLabel())}</small><button class="button small" type="submit" ${expensesSaving ? 'disabled' : ''}>Save</button></div>
              <p class="billing-error" role="alert" hidden></p></form></div>`
                : ''
            }
          </article>`,
      )
      .join('')}
  </div>`;
}
function receiptPanel(compact = false) {
  const model = (displayedReceipt = receiptModel(summary));
  return /* HTML */ `<section
    class="receipt-panel ${compact ? 'compact' : ''}"
    aria-label="AI usage receipt"
  >
    <div class="receipt-theme-control" role="group" aria-label="Receipt color">
      ${(['dark', 'light'] as const).map((theme) => /* HTML */ `<button type="button" data-receipt-theme="${theme}" aria-pressed="${(settings.receiptTheme ?? 'dark') === theme}" aria-label="${theme === 'dark' ? 'Black' : 'White'} receipt" ${themeSaving ? 'disabled' : ''}>${theme === 'dark' ? 'Black' : 'White'}</button>`).join('')}
    </div>
    <canvas
      class="receipt-canvas"
      id="receipt-canvas"
      role="img"
      aria-label="${esc(model.period + ' · ' + model.periodDetail + ' · Generated ' + model.generated + ' · ' + model.rows.map((r) => r.left + ' ' + r.right).join(' · ') + ' · ' + model.outcome + ' · ' + model.confidence)}"
    ></canvas
    ><button class="button export-button" id="export-png">${icon('download')}Export PNG</button>
  </section>`;
}
function refreshButton() {
  return /* HTML */ `<button
    type="button"
    class="refresh-button"
    id="rescan"
    ${busy ? 'disabled' : ''}
    aria-busy="${busy}"
    title="${lastScan ? 'Last scan: ' + esc(new Date(lastScan).toLocaleString()) : 'Scan local usage'}"
  >
    ${icon('refresh')}<span>${busy ? 'Scanning…' : 'Refresh usage'}</span>
  </button>`;
}
function updateRefreshButton() {
  const button = document.querySelector<HTMLButtonElement>('#rescan');
  if (button) {
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    button.innerHTML =
      icon('refresh') + '<span>' + (busy ? 'Scanning…' : 'Refresh usage') + '</span>';
  }
}
function overview() {
  const t = summary.total,
    c = comparisonForDisplay(summary);
  const active = summary.providers.filter((p) => p.records);
  const months = fullCalendarMonths(summary.range),
    showSubs = months !== null && active.length && (c.paid != null || c.scope.length > 0),
    scopeLabel = c.scope.map(name).join(' + '),
    first = summary.providers
      .map((p) => p.first)
      .filter((value): value is string => !!value)
      .sort()[0],
    last = summary.providers
      .map((p) => p.last)
      .filter((value): value is string => !!value)
      .sort()
      .at(-1),
    historyDate = (value: string) =>
      new Date(value).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
  return /* HTML */ `<div class="page-heading">
      <div class="overview-title">
        <h1>Overview</h1>
        <span class="selected-period" aria-live="polite">${esc(periodLabel())}</span>
      </div>
      ${refreshButton()}
    </div>
    ${coverage()}
    <div class="overview-layout">
      <div class="overview-main">
        <div class="metrics ${showSubs ? '' : 'single'}">
          ${metric('API equivalent', t.apiEquivalent === null ? (t.knownSubtotal !== null ? money(t.knownSubtotal) : t.records ? '—' : 'No data') : money(t.apiEquivalent), periodLabel(), 'api-metric')}${showSubs ? metric(c.apiSpend ? 'You paid' : c.subscription === 0 ? 'API paid' : 'Subscription', money(c.paid ?? c.subscription), [scopeLabel, months === 1 ? 'Full month' : `${months} full months`].filter(Boolean).join(' · ')) : ''}${showSubs ? metric(summary.historyPartial ? 'Observed value' : 'Value', c.value === null ? '—' : money(c.value, true), [scopeLabel, c.value === null ? 'Comparison unavailable' : summary.historyPartial ? 'Partial history' : ''].filter(Boolean).join(' · '), c.value !== null ? (c.value >= 0 ? 'positive' : 'negative') : '') : ''}${showSubs ? metric('Value multiple', c.roi === null ? '—' : `${c.roi.toFixed(2)}<span class="multiply">×</span>`, [scopeLabel, c.breakEven ? `Break-even ${new Date(c.breakEven + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : c.roi === null ? 'Unavailable' : t.apiEquivalent === null ? 'Priced portion' : ''].filter(Boolean).join(' · ')) : ''}
        </div>
        ${providerCards()}${chart()}
        <div class="overview-bottom">
          <span>${icon('shield')}Local analysis. Read-only sources.</span
          ><button class="text-button" data-page="settings">Manage sources ${icon('arrow')}</button>
        </div>
        ${
          !t.records
            ? /* HTML */ `<section class="panel empty-panel">
                <h2>No data for this period</h2>
                ${first && last ? `<p class="empty-history">Available history · ${esc(historyDate(first))} – ${esc(historyDate(last))}</p>` : ''}<button
                  class="text-button"
                  data-page="settings"
                >
                  View sources →
                </button>
              </section>`
            : ''
        }
      </div>
      ${receiptPanel(true)}
    </div>`;
}
function receiptPage() {
  return /* HTML */ `<div class="page-heading">
      <div><h1>Receipt</h1></div>
    </div>
    <div class="receipt-page-layout">
      ${receiptPanel()}
      <aside class="receipt-aside">
        <span class="eyebrow">API EQUIVALENT</span
        ><strong
          >${summary.total.knownSubtotal !== null ? money(summary.total.apiEquivalent ?? summary.total.knownSubtotal) : summary.total.records ? 'No priced usage' : 'No data'}</strong
        ><span>${periodLabel()}</span>${coverage()}
        <details class="privacy-note">
          <summary>Privacy</summary>
          <p>
            Exports contain provider totals and the selected period. No projects, sessions, paths,
            prompts, or responses.
          </p>
        </details>
      </aside>
    </div>`;
}
function billingFields(
  p: Provider,
  firstRun = false,
  b = settings.billing[p],
  expenses = false,
  prefix = '',
) {
  const plan = subscriptionPlan(p, b.planId),
    subscribed = b.mode === 'SUBSCRIPTION' || b.mode === 'MIXED',
    selection = subscribed
      ? (plan?.id ?? 'custom')
      : b.mode === 'NO_SUBSCRIPTION' || b.mode === 'API'
        ? 'none'
        : '';
  const api = !subscribed || b.mode === 'MIXED';
  return /* HTML */ `<div class="billing-row" data-billing-provider="${p}">
    <label class="provider-setting-name" for="${prefix}plan-${p}">${name(p)}</label>
    <div class="subscription-fields">
      <label class="sr-only" for="${prefix}plan-${p}">${name(p)} subscription plan</label
      ><select
        id="${prefix}plan-${p}"
        name="plan-${p}"
        data-subscription-plan="${p}"
        ${firstRun ? 'required data-first-run="true"' : ''}
      >
        <option value="" ${selection === '' ? 'selected' : ''}>
          ${firstRun ? 'Choose subscription' : 'Not set'}
        </option>
        <option value="none" ${selection === 'none' ? 'selected' : ''}>
          No subscription · API
        </option>
        ${subscriptionPlans
          .filter((plan) => plan.provider === p)
          .map(
            (option) =>
              /* HTML */ `<option value="${option.id}" ${selection === option.id ? 'selected' : ''}>
                ${esc(subscriptionPlanLabel(option))}
              </option>`,
          )
          .join('')}
        <option value="custom" ${selection === 'custom' ? 'selected' : ''}>
          Custom amount
        </option></select
      ><label
        class="amount-field billing-amount ${subscribed ? '' : 'hidden'}"
        id="${prefix}amount-${p}"
        ><span class="sr-only">${name(p)} monthly subscription in USD</span><span>$</span
        ><input
          name="monthly-${p}"
          type="number"
          min="0"
          max="1000000"
          step="0.01"
          value="${plan ? plan.monthly.toFixed(2) : (b.monthly ?? '')}"
          ${plan ? 'readonly' : ''}
          ${!subscribed ? 'disabled' : ''}
          ${firstRun && subscribed ? 'required' : ''}
          placeholder="Amount"
        /><span>/ month</span></label
      >
      <label class="mixed-field ${subscribed ? '' : 'hidden'}"
        ><input
          type="checkbox"
          name="mixed-${p}"
          data-mixed-billing="${p}"
          ${b.mode === 'MIXED' ? 'checked' : ''}
          ${subscribed ? '' : 'disabled'}
        />Subscription + API</label
      >
      ${expenses ? `<label class="api-spend-field ${api ? '' : 'hidden'}"><span>API paid</span><div class="amount-field"><span>$</span><input name="api-spend-${p}" type="number" min="0" max="1000000" step="0.01" value="${b.apiSpend ?? (b.mode === 'MIXED' ? 0 : '')}" ${api ? '' : 'disabled'} placeholder="Not set" aria-label="${name(p)} API paid in USD"/></div></label>` : ''}
    </div>
  </div>`;
}
function expenseDialog() {
  if (!expenseProvider) return '';
  const billing = billingForSelection(settings, expenseProvider, summary.range);
  return `<dialog id="expenses-dialog" aria-labelledby="expenses-title">
    <div class="expenses-heading"><h2 id="expenses-title">${name(expenseProvider)} · Expenses</h2><button type="button" class="text-button" id="close-expenses" aria-label="Close expenses">×</button></div>
    <form id="expenses-form">
      <p class="expense-period">${esc(periodLabel())}</p>
      ${billingFields(expenseProvider, true, billing, true, 'period-')}
      <p class="expense-note">This period only · USD</p><p id="expense-error" role="alert" hidden></p>
      <div class="expense-actions"><button type="button" class="text-button" id="reset-expenses">Use default</button><button class="button" type="submit">Save</button></div>
    </form></dialog>`;
}
function settingsPage() {
  return /* HTML */ `<div class="page-heading">
      <div><h1>Settings</h1></div>
    </div>
    <div class="settings-layout">
      <form id="settings-form">
        <section class="panel settings-section">
          <h2>Sources</h2>
          ${summary.providers
            .map((p) => {
              const s = sources.find((s) => s.provider === p.provider);
              return /* HTML */ `<div class="source-row">
                <div>
                  <strong>${name(p.provider)}</strong
                  ><span class="source-state"
                    >${p.status === 'USAGE_FOUND' ? 'Usage found' : p.detected ? 'No usage in selected period' : 'Not detected'}</span
                  >
                </div>
                <label class="include-check"
                  ><input
                    type="checkbox"
                    name="include-${p.provider}"
                    ${settings.include[p.provider] ? 'checked' : ''}
                  />Always show</label
                >
                <details>
                  <summary>Details</summary>
                  <dl>
                    <div>
                      <dt>Detection</dt>
                      <dd>${p.detected ? 'Detected' : 'Not detected'}</dd>
                    </div>
                    <div>
                      <dt>Imported events</dt>
                      <dd>${p.importedRecords.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Last scan</dt>
                      <dd>${lastScan ? new Date(lastScan).toLocaleString() : 'Not scanned'}</dd>
                    </div>
                    <div>
                      <dt>Source files</dt>
                      <dd>${s?.files ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Available history</dt>
                      <dd>
                        ${p.first ? p.first.slice(0, 10) + ' → ' + p.last?.slice(0, 10) : 'No data'}
                      </dd>
                    </div>
                    <div>
                      <dt>Read errors</dt>
                      <dd>${s?.errors ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Malformed / skipped</dt>
                      <dd>${(s?.diagnostics.malformed ?? 0) + (s?.diagnostics.oversize ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Incomplete final line</dt>
                      <dd>${s?.diagnostics.partialTail ? 'Yes' : 'No'}</dd>
                    </div>
                  </dl>
                </details>
              </div>`;
            })
            .join('')}${refreshButton()}
        </section>
        <section class="panel settings-section">
          <h2>Billing</h2>
          ${(['codex', 'claude'] as Provider[])
            .filter((p) => sources.find((s) => s.provider === p)?.detected)
            .map(
              (p) =>
                billingFields(p) +
                `<button type="button" class="text-button settings-expenses" data-expenses="${p}">${name(p)} · Monthly expenses</button>`,
            )
            .join('')}
          <details class="compact-details">
            <summary>Details</summary>
            <p>
              Plans verified ${subscriptionVerified}.
              ${subscriptionPlans
                .filter((p, i, list) => list.findIndex((q) => q.source === p.source) === i)
                .map(
                  (p) =>
                    /* HTML */ `<a href="${esc(p.source)}" target="_blank" rel="noreferrer"
                      >${p.provider === 'codex' ? 'ChatGPT' : 'Claude'} ↗</a
                    >`,
                )
                .join(' · ')}.
              Annual plans use the exact annual price divided by 12; team plans are per seat.
              Enterprise / Edu: custom amount.
            </p>
            <p>
              These are your declarations, not inferred billing history. Amounts are in USD.
              Comparisons use full calendar months. API spend belongs to the selected month; missing
              amounts stay unknown. Value multiple is API equivalent divided by total paid.
            </p>
          </details>
        </section>
        <section class="panel settings-section">
          <h2>Currency</h2>
          <div class="setting-line"><span>API prices & subscription</span><strong>USD</strong></div>
        </section>
        <section class="panel settings-section">
          <h2>Privacy / data</h2>
          <div class="privacy-tags">
            <span>${icon('check')}Local only</span><span>${icon('check')}Read-only sources</span
            ><span>${icon('check')}No telemetry</span>
          </div>
          <details>
            <summary>Data access</summary>
            <p>
              Only approved Codex and Claude JSONL session files are streamed. Only normalized usage
              metadata is stored. Credentials, project contents and conversation content are not
              stored.
            </p>
            <code
              >~/.codex/sessions/**/*.jsonl<br />~/.codex/archived_sessions/*.jsonl<br />~/.claude/projects/**/*.jsonl</code
            >
          </details>
        </section>
        <div class="form-actions"><button class="button" type="submit">Save changes</button></div>
      </form>
    </div>`;
}
function onboarding() {
  const found = summary.providers.filter((p) => p.first),
    billable = summary.providers.filter((p) => p.importedRecords > 0);
  return /* HTML */ `<dialog id="onboarding" aria-labelledby="onboarding-title">
    <span class="brand-mark">${productMark}</span
    ><span class="eyebrow">${esc(product.name.toUpperCase())} / FIRST RUN</span>
    <h2 id="onboarding-title">
      ${onboardingStage === 'found' ? (found.length ? 'Local usage found' : 'No local usage found') : 'Your subscriptions'}
    </h2>
    ${
      onboardingStage === 'found'
        ? /* HTML */ `<div class="found-sources">
              ${summary.providers.map((p) => /* HTML */ `<div><strong>${name(p.provider)}</strong><span>${p.first ? `${Math.max(1, Math.ceil((Date.parse(p.last!) - Date.parse(p.first)) / 864e5))} days ${icon('check')}` : p.detected ? 'No data found' : 'Not detected'}</span></div>`).join('')}
            </div>
            <button class="button" id="onboarding-continue">Continue ${icon('arrow')}</button>`
        : /* HTML */ `<form id="onboarding-billing">
              ${billable
                .map(
                  (p) =>
                    /* HTML */ `<h3>${name(p.provider)}</h3>
                      ${billingFields(p.provider, true)}`,
                )
                .join('')}<button class="button" type="submit">
                Open overview ${icon('arrow')}
              </button>
            </form>
            <button class="text-button onboarding-skip" id="onboarding-skip">Set up later</button>`
    }
  </dialog>`;
}
function render() {
  app.innerHTML = `${demo ? '<div class="demo-banner">DEMO / FIXTURE DATA — no local sources accessed</div>' : ''}${
    !settings.onboarded
      ? onboarding()
      : /* HTML */ `<div class="app-shell">
          ${navigation()}
          <main class="app-main">
            ${page === 'overview' ? overview() : page === 'receipt' ? receiptPage() : settingsPage()}
          </main>
          <footer class="app-footer">
            <span>${esc(product.name)} <span class="version">0.1</span></span
            ><span>LOCAL / READ-ONLY</span>
          </footer>
        </div>`
  }`;
  app.insertAdjacentHTML('beforeend', expenseDialog());
  const expense = document.querySelector<HTMLDialogElement>('#expenses-dialog');
  if (expense) {
    expense.addEventListener('cancel', () => {
      expenseProvider = null;
    });
    expense.showModal();
  }
  const canvas = document.querySelector<HTMLCanvasElement>('#receipt-canvas');
  if (canvas) drawReceipt(canvas, displayedReceipt, settings.receiptTheme ?? 'dark');
  const dialog = document.querySelector<HTMLDialogElement>('#onboarding');
  if (dialog) {
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.showModal();
  }
  bind();
}
function billingFromForm(form: HTMLFormElement, p: Provider): Billing | null {
  const data = new FormData(form);
  const selection = data.get(`plan-${p}`);
  if (selection === null) return null;
  const subscribed = selection !== 'none' && selection !== '',
    mode = subscribed ? (data.has(`mixed-${p}`) ? 'MIXED' : 'SUBSCRIPTION') : 'API',
    plan = subscriptionPlan(p, String(selection)),
    amount = data.get(`monthly-${p}`),
    api = data.get(`api-spend-${p}`);
  return {
    mode,
    monthly: subscribed
      ? (plan?.monthly ?? (amount !== '' && amount !== null ? Number(amount) : null))
      : null,
    ...(subscribed ? { planId: plan?.id ?? null } : {}),
    ...(mode !== 'SUBSCRIPTION'
      ? { apiSpend: api !== '' && api !== null ? Number(api) : null }
      : {}),
  };
}
function readBilling(form: HTMLFormElement) {
  for (const p of ['codex', 'claude'] as Provider[]) {
    const billing = billingFromForm(form, p);
    if (!billing) continue;
    // API payments are entered in the provider card for a specific period.
    settings.billing[p] = {
      mode: billing.mode,
      monthly: billing.monthly,
      ...(billing.planId !== undefined ? { planId: billing.planId } : {}),
    };
  }
}
async function save() {
  await api('/api/settings', 'POST', settings);
  await load();
  render();
}
async function choosePeriod(
  next: string,
  nextFrom = from,
  nextTo = to,
  nextMonth = selectedMonth,
  nextAnchor = '',
  focusSelector?: string,
) {
  if (periodLoading || busy) return;
  const previous = { period, from, to, selectedMonth, anchor };
  periodLoading = true;
  period = next;
  from = nextFrom;
  to = nextTo;
  selectedMonth = nextMonth;
  anchor = nextAnchor;
  const controls = document.querySelectorAll<HTMLButtonElement>(
    '[data-period],[data-period-step],#period-picker button',
  );
  controls.forEach((button) => (button.disabled = true));
  try {
    if (await load()) {
      render();
      document
        .querySelector<HTMLButtonElement>(focusSelector ?? `[data-period="${period}"]`)
        ?.focus({ preventScroll: true });
    }
  } catch {
    ({ period, from, to, selectedMonth, anchor } = previous);
    toast('Choose a valid date range');
  } finally {
    periodLoading = false;
    document
      .querySelectorAll<HTMLButtonElement>('[data-period],[data-period-step],#period-picker button')
      .forEach(
        (button) =>
          (button.disabled =
            busy ||
            !!(button.dataset.periodStep && !adjacentPeriod(Number(button.dataset.periodStep)))),
      );
  }
}
function bind() {
  document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((b) =>
    b.addEventListener('click', () => {
      page = b.dataset.page!;
      history.replaceState(null, '', page === 'overview' ? '/' : `/${page}`);
      render();
      window.scrollTo(0, 0);
    }),
  );
  const picker = document.querySelector<HTMLElement>('#period-picker');
  picker?.addEventListener('toggle', () => {
    document
      .querySelectorAll<HTMLButtonElement>('[aria-controls="period-picker"]')
      .forEach((button) =>
        button.setAttribute(
          'aria-expanded',
          String(
            picker.matches(':popover-open') && picker.dataset.period === button.dataset.period,
          ),
        ),
      );
  });
  document.querySelectorAll<HTMLButtonElement>('[data-period]').forEach((button) =>
    button.addEventListener('click', () => {
      if (busy || periodLoading) return;
      const next = button.dataset.period!;
      if (next !== 'month' && next !== 'custom') {
        void choosePeriod(next);
        return;
      }
      if (!picker) return;
      picker.dataset.period = next;
      picker.querySelector<HTMLFormElement>('#month-range')!.hidden = next !== 'month';
      picker.querySelector<HTMLFormElement>('#custom-range')!.hidden = next !== 'custom';
      if (!picker.matches(':popover-open')) picker.showPopover();
      const bounds = button.getBoundingClientRect();
      picker.style.left =
        Math.max(
          16,
          Math.min(innerWidth - picker.offsetWidth - 16, bounds.right - picker.offsetWidth),
        ) + 'px';
      picker.style.top = bounds.bottom + 8 + 'px';
      document
        .querySelectorAll<HTMLButtonElement>('[aria-controls="period-picker"]')
        .forEach((control) => control.setAttribute('aria-expanded', String(control === button)));
      picker.querySelector<HTMLInputElement>('form:not([hidden]) input')?.focus();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-period-step]').forEach((button) =>
    button.addEventListener('click', () => {
      if (busy || periodLoading) return;
      const direction = Number(button.dataset.periodStep),
        next = adjacentPeriod(direction);
      if (!next) return;
      void choosePeriod(
        period,
        next.from,
        next.to,
        next.month,
        period === '7d' || period === '30d' ? next.anchor : '',
        `[data-period-step="${direction}"]`,
      );
    }),
  );
  bindChart();
  document.querySelectorAll<HTMLButtonElement>('[data-receipt-theme]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (themeSaving) return;
      const next = button.dataset.receiptTheme;
      if (next !== 'dark' && next !== 'light') return;
      const previous = settings.receiptTheme;
      if ((previous ?? 'dark') === next) return;
      themeSaving = true;
      settings.receiptTheme = next;
      const update = () => {
        const canvas = document.querySelector<HTMLCanvasElement>('#receipt-canvas');
        if (canvas) drawReceipt(canvas, displayedReceipt, settings.receiptTheme ?? 'dark');
        document.querySelectorAll<HTMLButtonElement>('[data-receipt-theme]').forEach((control) => {
          control.setAttribute(
            'aria-pressed',
            String(control.dataset.receiptTheme === (settings.receiptTheme ?? 'dark')),
          );
          control.disabled = themeSaving;
        });
      };
      update();
      try {
        await api('/api/settings', 'POST', settings);
      } catch {
        settings.receiptTheme = previous;
        toast('Unable to save receipt color');
      } finally {
        themeSaving = false;
        update();
      }
    }),
  );
  document.querySelector<HTMLFormElement>('#custom-range')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget as HTMLFormElement);
    void choosePeriod('custom', String(data.get('from')), String(data.get('to')));
  });
  document.querySelector<HTMLFormElement>('#month-range')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget as HTMLFormElement);
    void choosePeriod('month', from, to, String(data.get('month')));
  });
  const updateBillingFields = (row: HTMLElement) => {
    const select = row.querySelector<HTMLSelectElement>('[data-subscription-plan]')!;
    const p = select.dataset.subscriptionPlan as Provider,
      plan = subscriptionPlan(p, select.value),
      input = row.querySelector<HTMLInputElement>(`[name="monthly-${p}"]`)!,
      mixed = row.querySelector<HTMLInputElement>('[data-mixed-billing]')!;
    const subscribed = select.value !== '' && select.value !== 'none';
    row.querySelector('.billing-amount')?.classList.toggle('hidden', !subscribed);
    row.querySelector('.mixed-field')?.classList.toggle('hidden', !subscribed);
    input.disabled = mixed.disabled = !subscribed;
    input.required = select.dataset.firstRun === 'true' && subscribed;
    input.readOnly = !!plan;
    if (plan) input.value = plan.monthly.toFixed(2);
    const api = !subscribed || mixed.checked;
    row.querySelector('.api-spend-field')?.classList.toggle('hidden', !api);
    const apiInput = row.querySelector<HTMLInputElement>(`[name="api-spend-${p}"]`);
    if (apiInput) {
      apiInput.disabled = !api;
      if (mixed.checked && subscribed && apiInput.value === '') apiInput.value = '0';
    }
  };
  document.querySelectorAll<HTMLElement>('[data-billing-provider]').forEach((row) => {
    row
      .querySelectorAll('select, [data-mixed-billing]')
      .forEach((field) => field.addEventListener('change', () => updateBillingFields(row)));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-expenses]').forEach((button) =>
    button.addEventListener('click', () => {
      expenseProvider = button.dataset.expenses as Provider;
      render();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-expense-toggle]').forEach((button) => {
    const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
    panel.addEventListener('toggle', () =>
      button.setAttribute('aria-expanded', String(panel.matches(':popover-open'))),
    );
    button.addEventListener('click', () => {
      if (panel.matches(':popover-open')) {
        panel.hidePopover();
        return;
      }
      panel.showPopover();
      const bounds = button.getBoundingClientRect();
      panel.style.left =
        Math.max(
          16,
          Math.min(innerWidth - panel.offsetWidth - 16, bounds.right - panel.offsetWidth),
        ) + 'px';
      panel.style.top =
        Math.max(16, Math.min(innerHeight - panel.offsetHeight - 16, bounds.bottom + 8)) + 'px';
      panel.querySelector<HTMLSelectElement>('select')?.focus();
    });
  });
  document.querySelector('#close-expenses')?.addEventListener('click', () => {
    expenseProvider = null;
    render();
  });
  const persistExpenses = async (provider: Provider, form: HTMLFormElement, reset = false) => {
    if (expensesSaving) return;
    expensesSaving = true;
    const billing = billingFromForm(form, provider),
      previous = settings,
      next = withPeriodBilling(settings, provider, summary.range, reset ? null : billing);
    document
      .querySelectorAll<HTMLButtonElement>('[data-period-billing] button, #expenses-form button')
      .forEach((button) => (button.disabled = true));
    try {
      await api('/api/settings', 'POST', next);
      settings = next;
      await load();
      expenseProvider = null;
      expensesSaving = false;
      render();
      toast('Saved locally');
    } catch {
      settings = previous;
      expensesSaving = false;
      const error = form.querySelector<HTMLElement>('.billing-error, #expense-error')!;
      error.hidden = false;
      error.textContent = 'Unable to save expenses';
      document
        .querySelectorAll<HTMLButtonElement>('[data-period-billing] button, #expenses-form button')
        .forEach((button) => (button.disabled = false));
    }
  };
  document.querySelectorAll<HTMLFormElement>('[data-period-billing]').forEach((form) =>
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void persistExpenses(form.dataset.periodBilling as Provider, form);
    }),
  );
  document.querySelector<HTMLFormElement>('#expenses-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (expenseProvider) void persistExpenses(expenseProvider, e.currentTarget as HTMLFormElement);
  });
  document.querySelector('#reset-expenses')?.addEventListener('click', () => {
    if (expenseProvider)
      void persistExpenses(
        expenseProvider,
        document.querySelector<HTMLFormElement>('#expenses-form')!,
        true,
      );
  });
  document
    .querySelector<HTMLFormElement>('#settings-form')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      readBilling(form);
      const data = new FormData(form);
      for (const p of ['codex', 'claude'] as Provider[])
        settings.include[p] = data.has(`include-${p}`);
      try {
        await save();
        toast('Saved locally');
      } catch {
        toast('Unable to save settings');
      }
    });
  document.querySelector('#export-png')?.addEventListener('click', async () => {
    try {
      await exportReceipt(document.querySelector<HTMLCanvasElement>('#receipt-canvas')!);
      toast('Receipt exported');
    } catch {
      toast('Unable to export PNG');
    }
  });
  document.querySelector('#rescan')?.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    updateRefreshButton();
    try {
      await api('/api/rescan', 'POST');
      const poll = async () => {
        try {
          const b = await api<BootstrapResponse>('/api/bootstrap');
          if (b.scanning) {
            setTimeout(() => void poll(), 1000);
            return;
          }
          sources = b.sources;
          lastScan = b.lastScan;
          busy = false;
          await load();
          render();
          toast('Sources updated');
        } catch {
          busy = false;
          updateRefreshButton();
          toast('Unable to scan');
        }
      };
      setTimeout(() => void poll(), 1000);
    } catch {
      busy = false;
      updateRefreshButton();
      toast('Unable to scan');
    }
  });
  document.querySelector('#onboarding-continue')?.addEventListener('click', async () => {
    if (!summary.providers.some((p) => p.importedRecords > 0)) {
      settings.onboarded = true;
      try {
        await save();
      } catch {
        settings.onboarded = false;
        toast('Unable to save');
      }
      return;
    }
    onboardingStage = 'billing';
    render();
  });
  document.querySelector('#onboarding-skip')?.addEventListener('click', async () => {
    settings.onboarded = true;
    try {
      await save();
    } catch {
      settings.onboarded = false;
      toast('Unable to save');
    }
  });
  document
    .querySelector<HTMLFormElement>('#onboarding-billing')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      readBilling(e.currentTarget as HTMLFormElement);
      settings.onboarded = true;
      try {
        await save();
      } catch {
        settings.onboarded = false;
        toast('Unable to save');
      }
    });
}
async function boot() {
  try {
    const b = await api<BootstrapResponse>('/api/bootstrap');
    settings = b.settings;
    sources = b.sources;
    token = b.token;
    demo = b.demo;
    lastScan = b.lastScan;
    await Promise.all([load(), receiptFonts(), document.fonts.load('14px Inter')]);
    render();
  } catch {
    app.innerHTML = /* HTML */ `<main class="loading">
      <h1>${esc(product.name)}</h1>
      <p>Unable to load local usage.</p>
      <button class="button" id="retry">Retry</button>
    </main>`;
    document.querySelector('#retry')?.addEventListener('click', () => void boot());
  }
}
void boot();
