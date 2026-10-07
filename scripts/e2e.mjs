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
  await page.getByRole('heading', { name: 'How did you use Codex?', exact: true }).waitFor();
  assert.equal(await page.locator('#onboarding #mode-claude').count(), 0);
  await page.getByRole('button', { name: 'Open overview', exact: true }).click();
  assert.ok(await page.locator('#onboarding').isVisible(), 'Usage mode must be chosen explicitly');
  await page.locator('#onboarding #mode-codex').selectOption('SUBSCRIPTION');
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
    assert.equal(await page.locator('.metric').count(), 1);
    assert.doesNotMatch(
      await page.locator('#receipt-canvas').getAttribute('aria-label'),
      /Subscription Cost|You Saved|VALUE MULTIPLE/,
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
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.metric.api-metric .metric-detail')?.textContent === 'June 2026',
  );
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
  await page.locator('#mode-claude').selectOption('SUBSCRIPTION');
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
  await page.locator('#mode-claude').selectOption('UNKNOWN');
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
  await page.locator('#mode-codex').selectOption('API');
  assert.equal(await page.locator('#amount-codex').isVisible(), false);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.metric').length === 1);
  assert.equal(await page.locator('.metric').count(), 1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#mode-codex').selectOption('MIXED');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  assert.equal(await page.locator('.metric').count(), 1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#mode-codex').selectOption('SUBSCRIPTION');
  await page.getByRole('spinbutton', { name: 'Codex monthly subscription in USD' }).fill('200');
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
  await timezoneContext.close();
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
  for (const skip of [false, true]) {
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
    assert.equal(await historicalPage.locator('#onboarding [data-billing-mode]').count(), 2);
    assert.equal(await historicalPage.locator('.metric, #receipt-canvas').count(), 0);
    if (skip) {
      await historicalPage.getByRole('button', { name: 'Set up later', exact: true }).click();
      assert.equal(saved.billing.codex.mode, 'UNKNOWN');
      assert.equal(saved.billing.claude.mode, 'UNKNOWN');
    } else {
      await historicalPage.locator('#mode-codex').selectOption('SUBSCRIPTION');
      await historicalPage.locator('#plan-codex').selectOption('chatgpt-pro-100');
      await historicalPage.locator('#mode-claude').selectOption('SUBSCRIPTION');
      await historicalPage.locator('#plan-claude').selectOption('claude-pro-annual');
      await historicalPage.getByRole('button', { name: 'Open overview', exact: true }).click();
      await historicalPage.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
      assert.equal(saved.billing.codex.monthly, 100);
      assert.equal(saved.billing.codex.planId, 'chatgpt-pro-100');
      assert.equal(saved.billing.claude.monthly, 200 / 12);
      assert.equal(saved.billing.claude.planId, 'claude-pro-annual');
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
  await partialPage.close();
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
          'month arrows including year change',
          '7D and 30D period arrows',
          'custom duration arrows',
          'mobile month arrows',
          'first-run onboarding',
          'zero-data onboarding without billing questions',
          'missing data is not zero',
          'period controls',
          'navigation',
          'positive receipt',
          'negative receipt',
          'API billing',
          'mixed billing',
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
