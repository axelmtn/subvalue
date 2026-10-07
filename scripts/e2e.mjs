import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { summarize, dateRange } from '../packages/cli/dist/packages/core/src/summary.js';
import { defaultSettings } from '../packages/cli/dist/packages/core/src/types.js';
import {
  receiptModel,
  comparisonForDisplay,
  money,
} from '../packages/cli/dist/packages/receipt/src/index.js';
let playwright;
try {
  playwright = await import('playwright');
} catch {
  if (!process.env.SUBVALUE_PLAYWRIGHT_MODULE)
    throw new Error(
      'Install development dependencies or set SUBVALUE_PLAYWRIGHT_MODULE to an existing official Playwright module.',
    );
  playwright = await import(pathToFileURL(process.env.SUBVALUE_PLAYWRIGHT_MODULE).href);
}
fs.mkdirSync('artifacts', { recursive: true });
const output = fs.mkdtempSync(path.resolve('artifacts/browser-'));
const url = 'http://127.0.0.1:4733';
const child = spawn(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    'packages/cli/dist/cli.js',
    '--demo',
    '--no-open',
    '--port',
    '4733',
  ],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
);
let browser;
const failures = [];
const errors = [];
const external = [];
async function verifyReceiptWordmark(page, selector, theme) {
  const print = await page.locator(selector).evaluate((canvas, theme) => {
    const scale = 6,
      left = 24 * scale,
      top = 30 * scale,
      width = 312 * scale,
      data = canvas.getContext('2d').getImageData(left, top, width, 40 * scale).data;
    let minX = Infinity,
      maxX = -Infinity,
      greenPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = data.slice(i, i + 3),
        green = g > 80 && g > r * 1.4 && g > b * 1.2,
        lettering = theme === 'dark' ? r > 180 && g > 180 && b > 180 : r < 80 && g < 80 && b < 80;
      if (green) greenPixels++;
      if (green || lettering) {
        const x = left + ((i / 4) % width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    return { minX, maxX, greenPixels };
  }, theme);
  assert.ok(print.greenPixels > 100, 'Pixel wordmark includes the green Value lettering');
  assert.ok(
    print.minX >= 102 * 6 - 1 && print.maxX <= 258 * 6 + 1,
    'Receipt wordmark is compact and centered, without a preceding icon or cursor',
  );
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* The local server may still be starting. */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, 'Demo server ready');
  browser = await playwright.chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith(url) && !r.url().startsWith('data:') && !r.url().startsWith('blob:'))
      external.push(r.url());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  const initial = await (await fetch(url + '/api/bootstrap')).json();
  const onboarding = {
    ...initial.settings,
    onboarded: false,
    billing: {
      codex: { mode: 'UNKNOWN', monthly: null },
      claude: { mode: 'UNKNOWN', monthly: null },
    },
  };
  await fetch(url + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Subvalue-Token': initial.token },
    body: JSON.stringify(onboarding),
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Local usage found', exact: true }).waitFor();
  assert.equal(
    await page.locator('.metric, #receipt-canvas').count(),
    0,
    'Results are not rendered during onboarding',
  );
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#onboarding').isVisible());
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Your subscriptions', exact: true }).waitFor();
  assert.equal(await page.locator('#onboarding #plan-claude').count(), 0);
  await page.getByRole('button', { name: 'Open overview', exact: true }).click();
  assert.ok(
    await page.locator('#onboarding').isVisible(),
    'Subscription must be chosen explicitly',
  );
  await page.locator('#onboarding #plan-codex').selectOption('custom');
  await page.getByRole('button', { name: 'Open overview', exact: true }).click();
  assert.ok(
    await page.locator('#onboarding').isVisible(),
    'Empty subscription amount cannot submit',
  );
  await page.locator('#onboarding #plan-codex').selectOption('chatgpt-pro-200');
  assert.equal(
    await page.getByRole('spinbutton', { name: 'Codex monthly subscription in USD' }).inputValue(),
    '200.00',
  );
  assert.equal(await page.locator('.metric, #receipt-canvas').count(), 0);
  await page.screenshot({
    path: path.join(output, 'onboarding-billing-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({
    path: path.join(output, 'onboarding-billing-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Open overview', exact: true }).click();
  await page.locator('#onboarding').waitFor({ state: 'detached' });
  await page.reload();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.ok(
    (await page.locator('#receipt-canvas').getAttribute('aria-label')).includes('VALUE MULTIPLE'),
  );
  const rescanRequest = page.waitForRequest(
    (request) => request.url().endsWith('/api/rescan') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Refresh usage', exact: true }).click();
  assert.ok(
    (await rescanRequest).headers()['x-subvalue-token'],
    'Refresh retains the local session protection',
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.ok(
    await page.getByRole('button', { name: 'Scanning…', exact: true }).isDisabled(),
    'Scan state survives navigation',
  );
  await page.waitForFunction(
    () => document.querySelector('#toast')?.textContent === 'Sources updated',
  );
  assert.ok(await page.getByRole('button', { name: 'Refresh usage', exact: true }).isEnabled());
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  for (const [label, detail] of [
    ['7D', 'Last 7 days'],
    ['30D', 'Last 30 days'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(
      (expected) =>
        document.querySelector('.metric.api-metric .metric-detail')?.textContent === expected,
      detail,
    );
    assert.equal(await page.locator('.selected-period').innerText(), detail);
    assert.equal(await page.locator('.metric').count(), 1);
    assert.doesNotMatch(
      await page.locator('#receipt-canvas').getAttribute('aria-label'),
      /Subscription Cost|Total Saved|VALUE MULTIPLE/,
    );
  }
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.locator('#month-range').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.locator('.metric.positive').waitFor();
  const currentMonth =
    new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const before = await page.locator('.overview-layout').boundingBox();
    await page.getByRole('button', { name: 'Custom', exact: true }).click();
    await page.locator('#custom-range').waitFor({ state: 'visible' });
    assert.deepEqual(
      await page.locator('.overview-layout').boundingBox(),
      before,
      'Floating dates do not move cards',
    );
    const popup = await page.locator('#period-picker').boundingBox();
    assert.ok(popup.x >= 0 && popup.x + popup.width <= width, 'Picker fits the viewport');
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: path.join(output, 'custom-picker-' + width + '.png'),
        fullPage: true,
      });
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#period-picker').isHidden());
    assert.equal(await page.locator('.metric').count(), 4, 'Cancel keeps the selected month');
  }
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.locator('#custom-range input[name=from]').fill(currentMonth + '-10');
  await page.locator('#custom-range input[name=to]').fill(currentMonth + '-01');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('#toast')?.textContent === 'Choose a valid date range',
  );
  assert.equal(await page.locator('[data-period=month]').getAttribute('aria-pressed'), 'true');
  assert.equal(
    await page.locator('.metric').count(),
    4,
    'Invalid dates preserve the previous report',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.locator('#selected-month').fill('2026-05');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.metric.api-metric .metric-detail')?.textContent === 'May 2026',
  );
  assert.equal(await page.locator('.metric strong').innerText(), 'No data');
  assert.equal(await page.locator('.selected-period').innerText(), 'May 2026');
  await page.screenshot({ path: path.join(output, 'selected-month-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.metric.api-metric .metric-detail')?.textContent === 'June 2026',
  );
  assert.equal(await page.locator('.selected-period').innerText(), 'June 2026');
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.ok(await page.locator('.selected-period').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'selected-month-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.metric.api-metric .metric-detail')?.textContent === 'May 2026',
  );
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.locator('#selected-month').fill('2025-12');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.metric.api-metric .metric-detail')?.textContent === 'December 2025',
  );
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.metric.api-metric .metric-detail')?.textContent === 'January 2026',
  );
  for (const preset of ['7D', '30D']) {
    await page.getByRole('button', { name: preset, exact: true }).click();
    await page.waitForFunction(
      (p) =>
        document
          .querySelector('[data-period="' + p.toLowerCase() + '"]')
          ?.getAttribute('aria-pressed') === 'true',
      preset,
    );
    const current = await (await fetch(url + '/api/summary?period=' + preset.toLowerCase())).json(),
      unit = preset === '7D' ? '7 days' : '30 days';
    await page.getByRole('button', { name: 'Previous ' + unit, exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.metric.api-metric .metric-detail')?.textContent?.includes(' — '),
    );
    assert.equal(await page.locator('.metric').count(), 1);
    assert.doesNotMatch(
      await page.locator('#receipt-canvas').getAttribute('aria-label'),
      /Subscription Cost|VALUE MULTIPLE/,
    );
    await page.getByRole('button', { name: 'Next ' + unit, exact: true }).click();
    await page.waitForFunction(
      (label) => document.querySelector('.metric.api-metric .metric-detail')?.textContent === label,
      current.range.label,
    );
  }
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.locator('#custom-range input[name=from]').fill(currentMonth + '-01');
  await page.locator('#custom-range input[name=to]').fill(currentMonth + '-07');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-period=custom]')?.getAttribute('aria-pressed') === 'true',
  );
  assert.equal(await page.locator('.metric').count(), 1);
  assert.doesNotMatch(
    await page.locator('#receipt-canvas').getAttribute('aria-label'),
    /Subscription Cost|VALUE MULTIPLE/,
  );
  await page.getByRole('button', { name: 'Next period', exact: true }).click();
  await page.waitForFunction(
    (month) =>
      document.querySelector('.metric.api-metric .metric-detail')?.textContent ===
      month + '-08 — ' + month + '-14',
    currentMonth,
  );
  await page.getByRole('button', { name: 'Previous period', exact: true }).click();
  await page.waitForFunction(
    (month) =>
      document.querySelector('.metric.api-metric .metric-detail')?.textContent ===
      month + '-01 — ' + month + '-07',
    currentMonth,
  );
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  await page.locator('#custom-range input[name=to]').fill(currentMonth + '-' + lastDay);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.locator('.metric.positive').waitFor();
  assert.match(await page.locator('.metric').nth(1).innerText(), /200.00/);
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.locator('#selected-month').fill(currentMonth);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.locator('.metric.positive').waitFor();
  assert.match(await page.locator('.metric.positive').innerText(), /87\.42/);
  assert.equal(await page.locator('.provider-card').count(), 1);
  assert.equal(await page.locator('.provider-card img[src*="blossom"]').count(), 0);
  assert.equal(
    await page.locator('.provider-card img[src="/brands/codex-outline.svg"]').count(),
    1,
  );
  assert.match(await page.locator('#receipt-canvas').getAttribute('aria-label'), /Generated/);
  await page.screenshot({ path: path.join(output, 'overview-desktop.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await downloadPromise;
  const receiptPath = path.join(output, 'receipt-positive.png');
  await download.saveAs(receiptPath);
  const exported = fs.readFileSync(receiptPath);
  assert.equal(exported.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const samePixels = await page.locator('canvas').evaluate(async (c, base64) => {
    const bytes = Uint8Array.from(atob(base64), (v) => v.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const comparison = document.createElement('canvas');
    comparison.width = image.width;
    comparison.height = image.height;
    comparison.getContext('2d').drawImage(image, 0, 0);
    const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data,
      b = comparison.getContext('2d').getImageData(0, 0, comparison.width, comparison.height).data;
    return c.width === image.width && c.height === image.height && a.every((v, i) => v === b[i]);
  }, exported.toString('base64'));
  assert.ok(samePixels, 'Export pixels exactly match the preview canvas');
  await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('show'));
  await page.getByRole('button', { name: 'Receipt', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'receipt-desktop.png'), fullPage: true });
  await page
    .locator('#receipt-canvas')
    .screenshot({ path: path.join(output, 'receipt-closeup.png') });
  const edges = await page.locator('#receipt-canvas').evaluate((c) => {
    const x = c.getContext('2d'),
      edge = Math.round((c.width / 360) * 5),
      a = x.getImageData(0, edge, c.width, 1).data,
      b = x.getImageData(0, c.height - edge, c.width, 1).data;
    return [a, b].every((row) => {
      const alpha = Array.from(row).filter((_, i) => i % 4 === 3);
      return alpha.some((v) => v === 0) && alpha.some((v) => v > 200);
    });
  });
  assert.ok(edges, 'Both serrated edges survive high-resolution canvas export');
  assert.equal(exported.readUInt32BE(16), 2160, 'High-resolution receipt export');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#plan-codex').selectOption('chatgpt-plus');
  assert.equal(
    await page.getByRole('spinbutton', { name: 'Codex monthly subscription in USD' }).inputValue(),
    '20.00',
  );
  assert.ok(
    await page
      .getByRole('spinbutton', { name: 'Codex monthly subscription in USD' })
      .evaluate((el) => el.readOnly),
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForFunction(
    () => document.querySelector('#toast')?.textContent === 'Saved locally',
  );
  await page.reload();
  await page.locator('#plan-codex').waitFor();
  assert.equal(await page.locator('#plan-codex').inputValue(), 'chatgpt-plus');
  await page.locator('#plan-claude').selectOption('claude-pro-annual');
  await page.screenshot({ path: path.join(output, 'billing-plans.png'), fullPage: true });
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/settings') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Save changes' }).click(),
  ]);
  const planSettings = await (await fetch(url + '/api/bootstrap')).json();
  assert.equal(planSettings.settings.billing.claude.monthly, 200 / 12);
  assert.equal(planSettings.settings.billing.claude.planId, 'claude-pro-annual');
  await page.locator('#plan-claude').selectOption('none');
  await page.locator('#plan-codex').selectOption('custom');
  await page.getByRole('spinbutton', { name: 'Codex monthly subscription in USD' }).fill('500');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('.metric.negative').waitFor();
  assert.match(await page.locator('.metric.negative').innerText(), /-\$212\.58/);
  await page.getByRole('button', { name: 'Receipt', exact: true }).click();
  const negative = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await (await negative).saveAs(path.join(output, 'receipt-negative.png'));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#plan-codex').selectOption('none');
  assert.equal(await page.locator('#amount-codex').isVisible(), false);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.metric').length === 1);
  assert.equal(await page.locator('.metric').count(), 1);
  const noSubscriptions = await (await fetch(url + '/api/bootstrap')).json();
  for (const provider of ['codex', 'claude'])
    assert.deepEqual(noSubscriptions.settings.billing[provider], {
      mode: 'API',
      monthly: null,
    });
  // Previously stored mixed billing stays readable, without restoring that UI choice.
  await fetch(url + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Subvalue-Token': initial.token },
    body: JSON.stringify({
      ...noSubscriptions.settings,
      billing: { ...noSubscriptions.settings.billing, codex: { mode: 'MIXED', monthly: null } },
    }),
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal(await page.locator('.metric').count(), 1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await page.locator('#plan-codex').inputValue(), 'custom');
  assert.equal(await page.locator('[name=mixed-codex]').isChecked(), true);
  await page.locator('[name=mixed-codex]').uncheck();
  assert.equal(await page.locator('option[value=MIXED]').count(), 0);
  await page.locator('#plan-codex').selectOption('chatgpt-pro-200');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('.metric.positive').waitFor();
  await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('show'));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const destination of ['Overview', 'Receipt', 'Settings']) {
      await page.getByRole('button', { name: destination, exact: true }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) failures.push(`${destination} overflows at ${width}px`);
    }
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    if (width === 390) {
      await page.getByRole('button', { name: 'Previous month', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('.metric strong')?.textContent === 'No data',
      );
      await page.getByRole('button', { name: 'Next month', exact: true }).click();
      await page.locator('.metric.positive').waitFor();
    }
    if (width === 390) {
      await page.screenshot({ path: path.join(output, 'overview-mobile.png'), fullPage: true });
      await page.getByRole('button', { name: 'Receipt', exact: true }).click();
      await page.screenshot({ path: path.join(output, 'receipt-mobile.png'), fullPage: true });
      await page.getByRole('button', { name: 'Overview', exact: true }).click();
    }
  }
  const chartDay = page.locator('[data-chart-day]').first();
  await chartDay.hover();
  await page.getByRole('tooltip').waitFor();
  const chartSummary = await (await fetch(url + '/api/summary?period=month')).json();
  assert.match(await page.getByRole('tooltip').innerText(), /Codex/);
  assert.ok(
    (await page.getByRole('tooltip').innerText()).includes(money(chartSummary.daily[0].codex)),
  );
  await page.screenshot({ path: path.join(output, 'chart-tooltip.png'), fullPage: true });
  await chartDay.focus();
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#chart-tooltip').isHidden());
  await page.keyboard.press('Enter');
  assert.ok(await page.locator('#chart-tooltip').isVisible());
  await page.getByRole('button', { name: 'Receipt', exact: true }).focus();
  assert.ok(await page.locator('#chart-tooltip').isHidden());
  await page.getByRole('button', { name: 'Receipt', exact: true }).click();
  await verifyReceiptWordmark(page, '#receipt-canvas', 'dark');
  await page.getByRole('button', { name: 'White receipt', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-receipt-theme=light]').disabled);
  await page.reload();
  await page.getByRole('button', { name: 'White receipt', exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'White receipt', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal((await (await fetch(url + '/api/bootstrap')).json()).settings.receiptTheme, 'light');
  await verifyReceiptWordmark(page, '#receipt-canvas', 'light');
  const whitePixel = await page
    .locator('#receipt-canvas')
    .evaluate((canvas) => Array.from(canvas.getContext('2d').getImageData(60, 120, 1, 1).data));
  assert.ok(
    whitePixel.slice(0, 3).every((v) => v > 220),
    'White paper is visibly light',
  );
  const whiteDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await (await whiteDownload).saveAs(path.join(output, 'receipt-white.png'));
  const whiteBytes = fs.readFileSync(path.join(output, 'receipt-white.png'));
  const whiteComparison = await page.locator('#receipt-canvas').evaluate(async (canvas, base64) => {
    const image = await createImageBitmap(
      new Blob([Uint8Array.from(atob(base64), (v) => v.charCodeAt(0))], { type: 'image/png' }),
    );
    const copy = document.createElement('canvas');
    copy.width = image.width;
    copy.height = image.height;
    copy.getContext('2d').drawImage(image, 0, 0);
    const a = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
      b = copy.getContext('2d').getImageData(0, 0, copy.width, copy.height).data;
    let opaqueErrors = 0,
      alphaError = 0,
      premultipliedError = 0;
    for (let i = 0; i < a.length; i += 4) {
      alphaError = Math.max(alphaError, Math.abs(a[i + 3] - b[i + 3]));
      for (let channel = 0; channel < 3; channel++) {
        if (a[i + 3] === 255 && a[i + channel] !== b[i + channel]) opaqueErrors++;
        premultipliedError = Math.max(
          premultipliedError,
          Math.abs((a[i + channel] * a[i + 3]) / 255 - (b[i + channel] * b[i + 3]) / 255),
        );
      }
    }
    return {
      sameSize: canvas.width === copy.width && canvas.height === copy.height,
      opaqueErrors,
      alphaError,
      premultipliedError,
    };
  }, whiteBytes.toString('base64'));
  console.log('White PNG round-trip:', JSON.stringify(whiteComparison));
  assert.ok(
    whiteComparison.sameSize &&
      whiteComparison.opaqueErrors === 0 &&
      whiteComparison.alphaError === 0 &&
      whiteComparison.premultipliedError <= 1,
    'White PNG preserves all printed pixels; transparent edges allow only PNG alpha rounding',
  );

  await page.screenshot({ path: path.join(output, 'receipt-white-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: path.join(output, 'receipt-white-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Black receipt', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-receipt-theme=dark]').disabled);
  assert.equal((await (await fetch(url + '/api/bootstrap')).json()).settings.receiptTheme, 'dark');
  await page.goto(url + '/landing');
  await page.getByRole('heading', { name: 'SubValue', exact: true }).waitFor();
  assert.equal(
    await page.locator('link[rel=preload][as=font]').count(),
    2,
    'Bundled fonts are preloaded before styles',
  );
  assert.equal(
    await page.locator('.preview-provider').count(),
    2,
    'Public example includes both coding agents',
  );
  assert.match(
    await page.locator('.preview-providers').innerText(),
    /Codex[\s\S]*201\.36[\s\S]*Claude Code[\s\S]*86\.06/,
  );
  assert.equal(
    await page.locator('.preview-provider img[src="/brands/claude-code-clawd.svg"]').count(),
    1,
  );
  assert.ok(
    await page
      .locator('.preview-provider img')
      .evaluateAll((images) => images.every((image) => image.naturalWidth > 0)),
    'Both bundled provider marks load',
  );
  assert.match(
    await page.locator('#example-receipt').getAttribute('aria-label'),
    /Codex and Claude Code example data/,
  );
  assert.match(
    await page.locator('#example-receipt').getAttribute('aria-label'),
    /CODEX[\s\S]*Input Tokens 19,230,000[\s\S]*Output Tokens 1,300,000[\s\S]*Cache Reads 15,000,000[\s\S]*CLAUDE CODE[\s\S]*Input Tokens 440,000[\s\S]*Output Tokens 400,000[\s\S]*Cache Reads 7,000,000[\s\S]*Total Saved \+\$67.42/,
    'Public receipt uses the updated token breakdown and total labels',
  );
  await page.waitForFunction(() => document.querySelector('#example-receipt').width === 2160);
  await verifyReceiptWordmark(page, '#example-receipt', 'dark');
  assert.equal(
    await page.locator('.release-note').first().innerText(),
    'Node.js 24.13+ · Windows · macOS · Linux',
  );
  assert.doesNotMatch(
    await page.locator('body').innerText(),
    /Private pre-release|npm release pending|FIXTURE|DEMO/i,
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Landing fits ${width}px`,
    );
    if (width === 390 || width === 1440)
      await page.screenshot({ path: path.join(output, `landing-${width}.png`), fullPage: true });
    if (width === 390 || width === 1440)
      await page.locator('.product-preview').screenshot({
        path: path.join(output, `landing-preview-${width}.png`),
      });
  }
  await page.locator('.privacy-details summary').click();
  const privacyLink = page.getByRole('link', { name: 'Data access ↗', exact: true });
  assert.equal(await privacyLink.getAttribute('href'), '/privacy.html');
  const privacyPopup = page.waitForEvent('popup');
  await privacyLink.click();
  const privacyDocumentPage = await privacyPopup;
  await privacyDocumentPage
    .getByRole('heading', { name: 'Privacy and data access', exact: true })
    .waitFor();
  assert.equal(
    await privacyDocumentPage.locator('h2').count(),
    5,
    'All policy sections are presented',
  );
  assert.match(
    await privacyDocumentPage.locator('article').innerText(),
    /Prompts, responses, attachments and source code are never persisted or displayed/,
  );
  assert.equal(
    await privacyDocumentPage.locator('script').count(),
    0,
    'Privacy document works without JavaScript',
  );
  assert.equal(
    await privacyDocumentPage
      .getByRole('link', { name: 'Plain text ↗', exact: true })
      .getAttribute('href'),
    '/privacy.txt',
  );
  for (const width of [320, 390, 1440]) {
    await privacyDocumentPage.setViewportSize({ width, height: 1000 });
    assert.ok(
      await privacyDocumentPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Privacy document fits ${width}px`,
    );
    if (width !== 320)
      await privacyDocumentPage.screenshot({
        path: path.join(output, `privacy-${width}.png`),
        fullPage: true,
      });
  }
  await privacyDocumentPage.getByRole('link', { name: '← Back', exact: true }).click();
  await privacyDocumentPage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await privacyDocumentPage.close();
  const logoPage = await context.newPage();
  await logoPage.goto(url + '/landing');
  await logoPage.setViewportSize({ width: 900, height: 650 });
  await logoPage.setContent(
    `<html><body style="margin:0;background:#0b0d10;color:#eee;font:14px Arial;padding:32px"><h1 style="font-size:20px">Identity · size check</h1>${['#0b0d10', '#f0f0ed'].map((background, i) => `<div style="padding:28px;background:${background};color:${i ? '#111' : '#eee'};display:flex;align-items:center;gap:28px;margin:18px 0">${[16, 20, 24, 32, 64].map((size) => `<div style="text-align:center"><img width="${size}" height="${size}" src="${url}/logo/${i ? 'mark-monochrome' : 'mark-green'}.svg"><div style="margin-top:12px">${size}px</div></div>`).join('')}</div>`).join('')}<div style="display:flex;gap:36px;align-items:center"><img width="64" height="64" src="${url}/logo/app-icon.svg"><img width="16" height="16" src="${url}/icon.svg"><span style="display:flex;align-items:center;gap:12px;font:600 18px Consolas"><img width="32" height="32" style="filter:invert(1)" src="${url}/brands/codex-outline.svg">Codex</span><span style="display:flex;align-items:center;gap:12px;font:600 18px Arial"><img width="32" height="26" src="${url}/brands/claude-code-clawd.svg" alt="">Claude Code</span></div></body></html>`,
  );
  await logoPage
    .locator('img')
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  assert.ok(
    await logoPage
      .locator('img')
      .evaluateAll((images) => images.every((image) => image.naturalWidth > 0)),
    'All local logo variants load',
  );
  await logoPage.screenshot({ path: path.join(output, 'logo-sizes.png') });
  await logoPage.close();
  const complete = await (await fetch(url + '/api/summary?period=month')).json();
  const timezoneContext = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  const timezonePage = await timezoneContext.newPage();
  timezonePage.on('pageerror', (e) => errors.push(e.message));
  await timezonePage.goto(url);
  await timezonePage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.match(
    await timezonePage.locator('.metric').nth(1).innerText(),
    /200.00/,
    'Browser timezone overrides preserve the server calendar price',
  );
  assert.match(
    await timezonePage.locator('#receipt-canvas').getAttribute('aria-label'),
    /VALUE MULTIPLE/,
  );
  assert.ok(
    (await timezonePage.locator('#receipt-canvas').getAttribute('aria-label')).includes(
      receiptModel(complete).periodDetail,
    ),
    'Receipt dates preserve the server calendar in a different browser timezone',
  );
  await timezoneContext.close();
  // A historical provider without a subscription must not hide the paid provider's comparison.
  for (const paid of ['codex', 'claude']) {
    const scopedPage = await context.newPage();
    scopedPage.on('pageerror', (error) => errors.push(error.message));
    const scoped = {
      ...complete,
      demo: true,
      range: dateRange('month', new Date(2026, 7, 15)),
      providers: complete.providers.map((provider) => ({
        ...provider,
        mode: provider.provider === paid ? 'SUBSCRIPTION' : 'NO_SUBSCRIPTION',
        records: 1,
        visible: true,
        apiEquivalent: provider.provider === paid ? 201.36 : 86.06,
        knownSubtotal: provider.provider === paid ? 201.36 : 86.06,
        comparison: {
          subscription: provider.provider === paid ? 100 : null,
          value: null,
          roi: null,
          breakEven: null,
          outcome: 'neutral',
          reason: null,
        },
      })),
      total: {
        ...complete.total,
        apiEquivalent: 287.42,
        knownSubtotal: 287.42,
        records: 2,
        comparison: {
          subscription: null,
          value: null,
          roi: null,
          breakEven: null,
          outcome: 'neutral',
          reason: null,
        },
      },
    };
    await scopedPage.route('**/api/bootstrap', (route) =>
      route.fulfill({ json: { ...initial, demo: true } }),
    );
    await scopedPage.route('**/api/summary?*', (route) => route.fulfill({ json: scoped }));
    await scopedPage.goto(url);
    await scopedPage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    assert.equal(await scopedPage.locator('.selected-period').innerText(), 'August 2026');
    assert.equal(await scopedPage.locator('.metric').count(), 4);
    assert.match(await scopedPage.locator('.metric').nth(1).innerText(), /\$100.00/);
    const providerName = paid === 'codex' ? 'Codex' : 'Claude Code';
    assert.match(await scopedPage.locator('.metric').nth(1).innerText(), new RegExp(providerName));
    assert.match(await scopedPage.locator('.metric.positive').innerText(), /\+\$101.36/);
    assert.match(await scopedPage.locator('.metric').nth(3).innerText(), /2.01/);
    assert.match(
      await scopedPage.locator('#receipt-canvas').getAttribute('aria-label'),
      new RegExp(paid === 'codex' ? 'CODEX COMPARISON' : 'CLAUDE CODE COMPARISON'),
    );
    await scopedPage.setViewportSize({ width: 1440, height: 1000 });
    await scopedPage.screenshot({
      path: path.join(output, 'scoped-comparison-' + paid + '-desktop.png'),
      fullPage: true,
    });
    await scopedPage.setViewportSize({ width: 390, height: 1000 });
    assert.ok(await scopedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await scopedPage.screenshot({
      path: path.join(output, 'scoped-comparison-' + paid + '-mobile.png'),
      fullPage: true,
    });
    await scopedPage.getByRole('button', { name: 'Receipt', exact: true }).click();
    const download = scopedPage.waitForEvent('download');
    await scopedPage.getByRole('button', { name: 'Export PNG', exact: true }).click();
    const pngPath = path.join(output, 'scoped-comparison-' + paid + '.png');
    await (await download).saveAs(pngPath);
    const samePixels = await scopedPage
      .locator('#receipt-canvas')
      .evaluate(async (canvas, encoded) => {
        const bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0)),
          image = await createImageBitmap(new Blob([bytes], { type: 'image/png' })),
          decoded = document.createElement('canvas');
        decoded.width = image.width;
        decoded.height = image.height;
        decoded.getContext('2d').drawImage(image, 0, 0);
        const preview = canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height).data,
          exported = decoded
            .getContext('2d')
            .getImageData(0, 0, decoded.width, decoded.height).data,
          matches =
            canvas.width === decoded.width &&
            canvas.height === decoded.height &&
            preview.every((value, i) => value === exported[i]);
        image.close();
        return matches;
      }, fs.readFileSync(pngPath).toString('base64'));
    assert.ok(samePixels, 'Scoped receipt PNG pixels match the preview');
    await scopedPage.close();
  }
  const emptyPage = await context.newPage();
  emptyPage.on('pageerror', (e) => errors.push(e.message));
  const emptySettings = defaultSettings(),
    emptySummary = summarize([], [], emptySettings, dateRange('month'), undefined, true);
  await emptyPage.route('**/api/bootstrap', async (route) =>
    route.fulfill({ json: { ...initial, settings: emptySettings, sources: [], demo: true } }),
  );
  await emptyPage.route('**/api/summary?*', async (route) => route.fulfill({ json: emptySummary }));
  await emptyPage.goto(url);
  await emptyPage.getByRole('heading', { name: 'No local usage found', exact: true }).waitFor();
  await emptyPage.getByRole('button', { name: 'Continue', exact: true }).click();
  await emptyPage.locator('#onboarding').waitFor({ state: 'detached' });
  assert.equal(await emptyPage.locator('.provider-card').count(), 0);
  assert.equal(await emptyPage.locator('.metric strong').innerText(), 'No data');
  await emptyPage.close();
  // Older imported usage still gets billing onboarding, even if this month is empty.
  for (const scenario of [
    ['chatgpt-pro-100', 'claude-pro-annual'],
    ['chatgpt-pro-100', 'none'],
    ['none', 'claude-pro-annual'],
    ['none', 'none'],
    null,
  ]) {
    const historicalPage = await context.newPage();
    let saved = defaultSettings();
    const historicalSummary = {
      ...emptySummary,
      providers: emptySummary.providers.map((provider) => ({
        ...provider,
        importedRecords: 10,
        first: '2026-07-01T12:00:00Z',
        last: '2026-08-01T12:00:00Z',
        days: 30,
      })),
    };
    await historicalPage.route('**/api/bootstrap', (route) =>
      route.fulfill({ json: { ...initial, settings: saved, demo: true } }),
    );
    await historicalPage.route('**/api/summary?*', (route) =>
      route.fulfill({ json: historicalSummary }),
    );
    await historicalPage.route('**/api/settings', (route) => {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { saved: true } });
    });
    await historicalPage.goto(url);
    await historicalPage.getByRole('button', { name: 'Continue', exact: true }).click();
    assert.equal(await historicalPage.locator('#onboarding [data-subscription-plan]').count(), 2);
    assert.equal(await historicalPage.locator('#onboarding option[value=none]').count(), 2);
    assert.equal(await historicalPage.locator('#onboarding option[value=MIXED]').count(), 0);
    assert.equal(await historicalPage.locator('.metric, #receipt-canvas').count(), 0);
    if (scenario === null) {
      await historicalPage.getByRole('button', { name: 'Set up later', exact: true }).click();
      assert.equal(saved.billing.codex.mode, 'UNKNOWN');
      assert.equal(saved.billing.claude.mode, 'UNKNOWN');
    } else {
      await historicalPage.locator('#plan-codex').selectOption(scenario[0]);
      await historicalPage.locator('#plan-claude').selectOption(scenario[1]);
      for (const [i, provider] of ['codex', 'claude'].entries()) {
        const subscribed = scenario[i] !== 'none';
        assert.equal(await historicalPage.locator(`#amount-${provider}`).isVisible(), subscribed);
        assert.equal(
          await historicalPage.locator(`[name=monthly-${provider}]`).isDisabled(),
          !subscribed,
        );
      }
      if (scenario[0] === 'chatgpt-pro-100' && scenario[1] === 'none') {
        await historicalPage.setViewportSize({ width: 1440, height: 1000 });
        await historicalPage.screenshot({
          path: path.join(output, 'onboarding-no-subscription-desktop.png'),
          fullPage: true,
        });
        await historicalPage.setViewportSize({ width: 390, height: 850 });
        assert.ok(
          await historicalPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        );
        await historicalPage.screenshot({
          path: path.join(output, 'onboarding-no-subscription-mobile.png'),
          fullPage: true,
        });
      }
      await historicalPage.getByRole('button', { name: 'Open overview', exact: true }).click();
      await historicalPage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
      for (const [i, provider] of ['codex', 'claude'].entries()) {
        if (scenario[i] === 'none') {
          assert.deepEqual(saved.billing[provider], { mode: 'API', monthly: null });
        } else {
          assert.equal(saved.billing[provider].mode, 'SUBSCRIPTION');
          assert.equal(saved.billing[provider].monthly, provider === 'codex' ? 100 : 200 / 12);
          assert.equal(saved.billing[provider].planId, scenario[i]);
        }
      }
    }
    await historicalPage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    await historicalPage.reload();
    await historicalPage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    assert.equal(await historicalPage.locator('#onboarding').count(), 0);
    await historicalPage.close();
  }
  const partialPage = await context.newPage();
  partialPage.on('pageerror', (e) => errors.push(e.message));
  const partial = {
    ...complete,
    demo: false,
    historyPartial: true,
    total: {
      ...complete.total,
      apiEquivalent: null,
      pricedRecords: 1,
      records: 2,
      priceCoverage: 0.5,
      comparison: {
        ...complete.total.comparison,
        value: null,
        roi: null,
        outcome: 'neutral',
        breakEven: null,
      },
    },
  };
  await partialPage.route('**/api/bootstrap', async (route) =>
    route.fulfill({
      json: { ...initial, settings: { ...defaultSettings(), onboarded: true }, demo: false },
    }),
  );
  await partialPage.route('**/api/summary?*', async (route) => route.fulfill({ json: partial }));
  await partialPage.goto(url);
  await partialPage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  const observed = comparisonForDisplay(partial);
  assert.equal(
    await partialPage.locator('.metric.positive strong').innerText(),
    money(observed.value, true),
  );
  assert.match(
    await partialPage.locator('.metric').filter({ hasText: 'Value multiple' }).innerText(),
    new RegExp(observed.roi.toFixed(2).replace('.', '\\.')),
  );
  assert.match(
    await partialPage.locator('#receipt-canvas').getAttribute('aria-label'),
    new RegExp(
      receiptModel(partial)
        .rows.find((r) => r.left === 'VALUE MULTIPLE')
        .right.replace('.', '\\.'),
    ),
  );
  assert.match(await partialPage.locator('.coverage summary').innerText(), /50% priced/);
  assert.equal(await partialPage.locator('.demo-banner').count(), 0);
  assert.match(
    await partialPage.locator('.metric.api-metric .metric-detail').innerText(),
    /In progress/,
  );
  await partialPage.screenshot({
    path: path.join(output, 'partial-comparison-desktop.png'),
    fullPage: true,
  });
  const almostComplete = {
    ...partial,
    total: { ...partial.total, records: 200, pricedRecords: 199, priceCoverage: 199 / 200 },
    providers: partial.providers.map((provider) =>
      provider.records
        ? {
            ...provider,
            apiEquivalent: null,
            records: 200,
            pricedRecords: 199,
            priceCoverage: 199 / 200,
          }
        : provider,
    ),
  };
  await partialPage.route('**/api/summary?*', (route) => route.fulfill({ json: almostComplete }));
  await partialPage.reload();
  await partialPage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.match(await partialPage.locator('.coverage summary').innerText(), /<100% priced/);
  assert.match(await partialPage.locator('.provider-card small').innerText(), /<100% priced/);
  assert.match(
    await partialPage.locator('#receipt-canvas').getAttribute('aria-label'),
    /<100% priced/,
  );
  await partialPage.close();
  // Exercise month-specific billing with synthetic metadata only.
  const expensePage = await context.newPage();
  expensePage.on('pageerror', (e) => errors.push(e.message));
  let expenseSettings = defaultSettings();
  expenseSettings.onboarded = true;
  expenseSettings.billing.codex = { mode: 'SUBSCRIPTION', monthly: 100, planId: 'chatgpt-pro-100' };
  let failExpenseSave = false;
  let expenseSelectedMonth = '2026-08';
  const { baseRecord } = await import('../packages/cli/dist/packages/core/src/metadata.js');
  const expenseRows = ['2026-08', '2026-09'].flatMap((month) =>
    ['codex', 'claude'].map((provider) => ({
      ...baseRecord(provider, 'synthetic', provider + month),
      id: provider + month,
      timestamp: month + '-15T12:00:00.000Z',
      model_raw: 'test-model',
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_tokens: 0,
      output_tokens: (provider === 'codex' ? 200 : 100) * 100000,
      total_tokens: (provider === 'codex' ? 200 : 100) * 100000,
      quality: 'HIGH',
    })),
  );
  const expenseCatalog = {
    version: 'synthetic',
    mappings: {
      codex: { 'test-model': 'test-model' },
      claude: { 'test-model': 'test-model' },
    },
    prices: ['codex', 'claude'].map((provider) => ({
      provider,
      model: 'test-model',
      effective_from: '2026-01-01T00:00:00.000Z',
      effective_until: null,
      input: 0,
      cached_input: 0,
      output: 10,
      cache_write: 0,
      cache_write_5m: 0,
      cache_write_1h: 0,
      source: 'synthetic',
      verified_at: '2026-10-01T00:00:00.000Z',
    })),
  };
  await expensePage.route('**/api/bootstrap', (route) =>
    route.fulfill({
      json: {
        ...initial,
        settings: expenseSettings,
        demo: true,
      },
    }),
  );
  await expensePage.route('**/api/summary?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (['2026-08', '2026-09'].includes(query.get('month')))
      expenseSelectedMonth = query.get('month');
    return route.fulfill({
      json: summarize(
        expenseRows,
        [],
        expenseSettings,
        dateRange('month', new Date(2026, 7, 15), undefined, undefined, expenseSelectedMonth),
        expenseCatalog,
        true,
      ),
    });
  });
  await expensePage.route('**/api/settings', (route) => {
    if (failExpenseSave)
      return route.fulfill({ status: 503, json: { error: 'Synthetic failure' } });
    expenseSettings = route.request().postDataJSON();
    return route.fulfill({ json: { saved: true } });
  });
  await expensePage.goto(url);
  await expensePage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal(await expensePage.locator('[data-period-billing=codex]').count(), 0);
  assert.equal(await expensePage.locator('[data-period-billing=claude]').count(), 1);
  assert.equal(
    await expensePage.locator('[data-expense-toggle=claude]').innerText(),
    'Categorize expenses for this period',
  );
  assert.equal(await expensePage.locator('#card-plan-claude').inputValue(), 'none');
  assert.equal(await expensePage.locator('[name=api-spend-claude]').inputValue(), '');
  await expensePage.setViewportSize({ width: 1440, height: 1000 });
  await expensePage.screenshot({ path: path.join(output, 'expenses-desktop.png'), fullPage: true });
  await expensePage.setViewportSize({ width: 390, height: 850 });
  assert.ok(await expensePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expensePage.screenshot({ path: path.join(output, 'expenses-mobile.png'), fullPage: true });
  await expensePage.locator('[data-expense-toggle=claude]').click();
  const chartTop = await expensePage
    .locator('.chart')
    .evaluate((el) => el.getBoundingClientRect().top);
  await expensePage.keyboard.press('Escape');
  assert.equal(
    await expensePage.locator('.chart').evaluate((el) => el.getBoundingClientRect().top),
    chartTop,
    'Expenses never move the chart',
  );
  await expensePage.locator('[data-expense-toggle=claude]').click();
  await expensePage.screenshot({ path: path.join(output, 'expenses-open-mobile.png') });
  await expensePage.locator('[name=api-spend-claude]').fill('50');
  failExpenseSave = true;
  await expensePage
    .locator('[data-period-billing=claude]')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expensePage.locator('.billing-error').waitFor({ state: 'visible' });
  assert.equal(
    expenseSettings.monthlyBilling,
    undefined,
    'Failed saves do not update local settings',
  );
  failExpenseSave = false;
  await expensePage
    .locator('[data-period-billing=claude]')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expensePage.waitForFunction(
    () =>
      !document.querySelector('.billing-error')?.textContent &&
      !document.querySelector('[data-period-billing=claude] button')?.disabled,
  );
  assert.equal(expenseSettings.monthlyBilling['2026-08'].claude.apiSpend, 50);
  assert.match(await expensePage.locator('.metric').nth(1).innerText(), /You paid[\s\S]*\$150.00/);
  assert.match(await expensePage.locator('.metric').nth(3).innerText(), /2.00/);
  await expensePage.locator('[data-expense-toggle=claude]').click();
  await expensePage.locator('#card-plan-claude').selectOption('claude-pro-monthly');
  await expensePage.locator('[name=mixed-claude]').check();
  assert.equal(await expensePage.locator('[name=api-spend-claude]').inputValue(), '50');
  await expensePage.locator('[name=api-spend-claude]').fill('10');
  await expensePage
    .locator('[data-period-billing=claude]')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expensePage.waitForFunction(
    () =>
      !document.querySelector('.billing-error')?.textContent &&
      !document.querySelector('[data-period-billing=claude] button')?.disabled,
  );
  assert.equal(expenseSettings.monthlyBilling['2026-08'].claude.mode, 'MIXED');
  assert.match(await expensePage.locator('.metric').nth(1).innerText(), /\$130.00/);
  assert.match(await expensePage.locator('.metric').nth(3).innerText(), /2.31/);
  assert.match(
    await expensePage.locator('#receipt-canvas').getAttribute('aria-label'),
    /API Paid \$10.00[\s\S]*Total Paid \$130.00/,
  );
  await expensePage.reload();
  await expensePage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.match(await expensePage.locator('.metric').nth(1).innerText(), /\$130.00/);
  await expensePage.getByRole('button', { name: 'Month', exact: true }).click();
  await expensePage.locator('#month-range [name=month]').fill('2026-09');
  await expensePage
    .locator('#month-range')
    .getByRole('button', { name: 'Apply', exact: true })
    .click();
  await expensePage.waitForFunction(
    () => document.querySelector('.selected-period')?.textContent === 'September 2026',
  );
  assert.match(await expensePage.locator('.metric').nth(1).innerText(), /Codex[\s\S]*Full month/);
  assert.equal(await expensePage.locator('[name=api-spend-claude]').inputValue(), '');
  await expensePage.getByRole('button', { name: 'Month', exact: true }).click();
  await expensePage.locator('#month-range [name=month]').fill('2026-08');
  await expensePage
    .locator('#month-range')
    .getByRole('button', { name: 'Apply', exact: true })
    .click();
  await expensePage.waitForFunction(
    () => document.querySelector('.selected-period')?.textContent === 'August 2026',
  );
  assert.equal(await expensePage.locator('[name=api-spend-claude]').inputValue(), '10');
  await expensePage.setViewportSize({ width: 1440, height: 1100 });
  const heights = await expensePage
    .locator('.provider-card')
    .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
  assert.ok(Math.abs(heights[0] - heights[1]) < 2, 'Compact provider cards have equal height');
  const beforeOpen = await expensePage
    .locator('.chart')
    .evaluate((el) => el.getBoundingClientRect().top);
  await expensePage.locator('[data-expense-toggle=claude]').click();
  assert.equal(
    await expensePage.locator('.chart').evaluate((el) => el.getBoundingClientRect().top),
    beforeOpen,
  );
  await expensePage.screenshot({
    path: path.join(output, 'expenses-open-desktop.png'),
    fullPage: true,
  });
  await expensePage.keyboard.press('Escape');
  await expensePage.locator('[data-expense-toggle=claude]').evaluate((button) => button.blur());
  await expensePage.screenshot({
    path: path.join(output, 'expenses-mixed-desktop.png'),
    fullPage: true,
  });
  await expensePage.setViewportSize({ width: 390, height: 950 });
  assert.ok(await expensePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expensePage.screenshot({
    path: path.join(output, 'expenses-mixed-mobile.png'),
    fullPage: true,
  });
  const expenseDownload = expensePage.waitForEvent('download');
  await expensePage.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await (await expenseDownload).saveAs(path.join(output, 'expenses-mixed-receipt.png'));
  // Both provider marks are decoded from bundled assets and printed in the PNG.
  assert.ok(
    await expensePage.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((r) => r.name.endsWith('/brands/codex-outline.svg')),
    ),
  );
  assert.ok(
    await expensePage.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((r) => r.name.endsWith('/brands/claude-code-clawd.svg')),
    ),
  );
  const printedMarkPixels = await expensePage.locator('#receipt-canvas').evaluate((canvas) => {
    const c = canvas.getContext('2d');
    const count = (y, height, matches) => {
      const data = c.getImageData(24 * 6, y * 6, 22 * 6, height * 6).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (matches(data[i], data[i + 1], data[i + 2])) n++;
      return n;
    };
    return {
      codex: count(193, 22, (r, g, b) => r > 150 && g > 150 && b > 150),
      claude: count(244, canvas.height / 6 - 244, (r, g) => r > 140 && r > g * 1.4),
    };
  });
  assert.ok(printedMarkPixels.codex > 100, 'Codex mark printed on receipt');
  assert.ok(printedMarkPixels.claude > 100, 'Claude Code mark printed on receipt');
  // Monthly editing remains available in Settings for providers without a dashboard action.
  await expensePage.getByRole('button', { name: 'Settings', exact: true }).click();
  await expensePage.locator('[data-expenses=claude]').click();
  await expensePage.locator('#reset-expenses').click();
  await expensePage.locator('#expenses-dialog').waitFor({ state: 'detached' });
  assert.equal(expenseSettings.monthlyBilling['2026-08'], undefined);
  await expensePage.getByRole('button', { name: 'Overview', exact: true }).click();
  // No action is added for a provider using only API without another subscription.
  expenseSettings.billing.codex = { mode: 'API', monthly: null };
  await expensePage.reload();
  await expensePage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal(await expensePage.locator('[data-period-billing]').count(), 0);
  await expensePage.close();
  assert.deepEqual(errors, [], 'No browser errors');
  assert.deepEqual(external, [], 'No external application requests');
  assert.deepEqual(failures, [], 'All dashboard pages fit');
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        passed: true,
        widths: [320, 390, 768, 1440],
        pngMatchesCanvas: true,
        externalRequests: 0,
        browserErrors: 0,
        checks: [
          'partial coverage never rounds to 100%',
          'receipt calendar dates across browser timezones',
          'month arrows including year change',
          '7D and 30D period arrows',
          'custom duration arrows',
          'mobile month arrows',
          'first-run onboarding',
          'direct subscription and no-subscription onboarding for both providers',
          'visible selected month on desktop and mobile',
          'historical comparisons scoped to subscribed providers only',
          'conditional provider expense actions',
          'month-specific API and mixed billing, save rollback and reload',
          'zero-data onboarding without billing questions',
          'missing data is not zero',
          'period controls',
          'navigation',
          'positive receipt',
          'negative receipt',
          'no subscription billing',
          'legacy mixed billing compatibility',
          'official subscription presets and persistence',
          'exact annual plan amount',
          'provider visibility',
          'responsive dashboard',
          'responsive landing',
          'serrated receipt edges',
          '2160px PNG export',
          'neutral logo size variants',
          'local official provider assets',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`Browser checks passed. Artifacts: ${path.relative(process.cwd(), output)}`);
} finally {
  await browser?.close();
  child.kill();
}
