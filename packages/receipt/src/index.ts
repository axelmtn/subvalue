import type { Summary, ProviderSummary, Comparison } from '../../core/src/summary.ts';
import type { Provider } from '../../core/src/types.ts';
import { fullCalendarMonths } from '../../core/src/calendar.ts';
import { formatPricingCoverage } from '../../core/src/coverage.ts';
import { product, wordmarkSvg } from '../../ui/src/brand.ts';
/** Only public, aggregated fields needed by the receipt and its example. */
export type ReceiptInput = Pick<Summary, 'range' | 'historyPartial' | 'confidence' | 'demo'> & {
  providers: (Pick<
    ProviderSummary,
    | 'provider'
    | 'records'
    | 'visible'
    | 'tokens'
    | 'tokensPartial'
    | 'tokenBreakdown'
    | 'apiEquivalent'
    | 'knownSubtotal'
  > &
    Partial<Pick<ProviderSummary, 'mode' | 'comparison'>>)[];
  total: Pick<Summary['total'], 'apiEquivalent' | 'knownSubtotal' | 'priceCoverage' | 'comparison'>;
};
export interface ReceiptRow {
  left: string;
  right: string;
  accent?: 'positive' | 'negative';
  strong?: boolean;
}
export interface ReceiptModel {
  period: string;
  periodDetail: string;
  generated: string;
  rows: ReceiptRow[];
  outcome: string;
  confidence: string;
  demo: boolean;
}
export const money = (n: number | null, signed = false): string =>
  n === null
    ? 'Unavailable'
    : `${signed && n >= 0 ? '+' : ''}${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)}`;
/** Compare only the displayed priced amount; preserve uncertainty and billing eligibility. */
export interface DisplayComparison extends Comparison {
  /** Nonempty when some active providers have not supplied their expenses. */
  scope: Provider[];
  apiEquivalent: number | null;
}
export function comparisonForDisplay(s: ReceiptInput): DisplayComparison {
  const comparison = s.total.comparison,
    amount = s.total.apiEquivalent ?? s.total.knownSubtotal;
  if (fullCalendarMonths(s.range) === null)
    return {
      ...comparison,
      subscription: null,
      apiSpend: null,
      paid: null,
      value: null,
      roi: null,
      breakEven: null,
      outcome: 'neutral',
      scope: [],
      apiEquivalent: null,
    };
  const paidFor = (p: ReceiptInput['providers'][number]) =>
    p.comparison?.paid !== undefined
      ? p.comparison.paid
      : p.mode === 'SUBSCRIPTION'
        ? (p.comparison?.subscription ?? null)
        : null;
  const active = s.providers.filter((p) => p.records > 0),
    included = active.filter((p) => paidFor(p) !== null);
  if (included.length > 0 && included.length < active.length) {
    const subscription = included.reduce((n, p) => n + (p.comparison?.subscription ?? 0), 0),
      apiSpend = included.reduce((n, p) => n + (p.comparison?.apiSpend ?? 0), 0),
      paid = included.reduce((n, p) => n + paidFor(p)!, 0),
      priced = included.map((p) => p.apiEquivalent ?? p.knownSubtotal),
      scopedAmount = priced.every((cost) => cost !== null)
        ? priced.reduce<number>((n, cost) => n + cost!, 0)
        : null,
      certain = !s.historyPartial && included.every((p) => p.apiEquivalent !== null);
    return {
      subscription,
      apiSpend,
      paid,
      value: scopedAmount === null ? null : scopedAmount - paid,
      roi: scopedAmount === null || paid <= 0 ? null : scopedAmount / paid,
      outcome: certain && included.length === 1 ? included[0].comparison!.outcome : 'neutral',
      breakEven: certain && included.length === 1 ? included[0].comparison!.breakEven : null,
      reason: 'Providers with declared expenses only',
      scope: included.map((p) => p.provider),
      apiEquivalent: scopedAmount,
    };
  }
  const paid = comparison.paid === undefined ? comparison.subscription : comparison.paid;
  if (amount === null || paid === null)
    return { ...comparison, paid, scope: [], apiEquivalent: amount };
  return {
    ...comparison,
    paid,
    value: comparison.value ?? amount - paid,
    roi: comparison.roi ?? (paid > 0 ? amount / paid : null),
    scope: [],
    apiEquivalent: amount,
  };
}
export function receiptModel(s: ReceiptInput, generatedAt = new Date()): ReceiptModel {
  const rows: ReceiptRow[] = [];
  for (const p of s.providers.filter((p) => p.records > 0 && p.visible !== false)) {
    rows.push({ left: p.provider === 'codex' ? 'CODEX' : 'CLAUDE CODE', right: '', strong: true });
    if (p.tokenBreakdown) {
      for (const [label, value] of [
        ['Input Tokens', p.tokenBreakdown.input],
        ['Output Tokens', p.tokenBreakdown.output],
        ['Cache Reads', p.tokenBreakdown.cacheRead],
      ] as const)
        rows.push({
          left: label,
          right: value === null ? 'Unknown' : value.toLocaleString('en-US'),
        });
    } else if (p.tokens !== undefined)
      rows.push({
        left: p.tokensPartial ? 'Known Tokens' : 'Tokens',
        right: p.tokens === null ? 'Unknown' : p.tokens.toLocaleString('en-US'),
      });
    const amount = p.apiEquivalent ?? p.knownSubtotal;
    rows.push({ left: 'Estimated API Cost', right: amount === null ? '—' : money(amount) });
    rows.push({ left: '', right: '' });
  }
  const amount = s.total.apiEquivalent ?? s.total.knownSubtotal;
  rows.push({
    left: 'Total API Equivalent',
    right: amount === null ? '—' : money(amount),
    strong: true,
  });
  const comp = comparisonForDisplay(s);
  if (comp.scope.length)
    rows.push(
      { left: '', right: '' },
      {
        left:
          comp.scope
            .map((provider) => (provider === 'codex' ? 'CODEX' : 'CLAUDE CODE'))
            .join(' + ') + ' COMPARISON',
        right: '',
        strong: true,
      },
      {
        left: 'API Equivalent',
        right: comp.apiEquivalent === null ? '—' : money(comp.apiEquivalent),
      },
    );
  if (comp.subscription != null && comp.subscription > 0)
    rows.push({ left: 'Subscription Cost', right: money(comp.subscription) });
  if (comp.apiSpend != null && (comp.apiSpend > 0 || comp.subscription === 0)) {
    rows.push({ left: 'API Paid', right: money(comp.apiSpend) });
    if (comp.subscription != null && comp.subscription > 0)
      rows.push({ left: 'Total Paid', right: money(comp.paid ?? null), strong: true });
  }
  const value = comp.value;
  if (value !== null)
    rows.push({
      left: 'Total Saved',
      right: money(value, true),
      accent: value >= 0 ? 'positive' : 'negative',
      strong: true,
    });
  // With partial pricing, compare only the printed known amount to the declared
  // full-month subscription. The coverage footer stays visible; no outcome is inferred.
  const multiple = comp.roi;
  if (multiple !== null)
    rows.push(
      { left: '', right: '' },
      {
        left: 'VALUE MULTIPLE',
        right: `${multiple.toFixed(2)}×`,
        accent: multiple >= 1 ? 'positive' : 'negative',
        strong: true,
      },
    );
  if (comp.breakEven)
    rows.push({
      left: 'BREAK-EVEN',
      right: new Date(comp.breakEven + 'T12:00:00')
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        .toUpperCase(),
    });
  const outcome =
    comp.outcome === 'positive'
      ? 'YOUR PLAN WAS WORTH IT'
      : comp.outcome === 'negative'
        ? 'API WOULD HAVE BEEN CHEAPER'
        : '';
  const progress =
    !s.demo &&
    Date.parse(s.range.from) <= generatedAt.getTime() &&
    Date.parse(s.range.until) > generatedAt.getTime() &&
    fullCalendarMonths(s.range) !== null
      ? 'In progress · '
      : '';
  const coverage =
    s.total.apiEquivalent === null && s.total.priceCoverage !== null
      ? `${formatPricingCoverage(s.total.priceCoverage)} priced · `
      : '';
  const date = (value: string) =>
    new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  // Civil dates belong to the server's selected calendar, not the browser's
  // timezone. Legacy summaries without calendar fields retain their fallback.
  const calendarDate = (value: string) =>
    new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const periodFrom = s.range.calendarFrom ? calendarDate(s.range.calendarFrom) : date(s.range.from);
  const periodTo = s.range.calendarTo
    ? calendarDate(s.range.calendarTo)
    : date(new Date(Date.parse(s.range.until) - 1).toISOString());
  const generated = generatedAt
    .toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(' at ', ' ');
  return {
    period: s.range.label.toUpperCase(),
    periodDetail: periodFrom + ' – ' + periodTo,
    generated,
    rows,
    outcome,
    confidence: s.historyPartial
      ? `${progress}${coverage}API equivalent · Partial history`
      : `${progress}${coverage}API equivalent · ${s.confidence === 'HIGH' ? 'High confidence' : 'Incomplete'}`,
    demo: s.demo,
  };
}
export async function receiptFonts(): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts)
    await Promise.all([
      document.fonts.load('14px "Plex Mono"'),
      document.fonts.load('600 14px "Plex Mono"'),
      receiptBrandAssets(document),
    ]);
}
// Decode the same bundled product marks used by the dashboard before drawing.
// Canvas previews and exported PNGs therefore include identical local artwork.
const brandAssets = new WeakMap<Document, Promise<Record<Provider, HTMLImageElement>>>();
const decodedBrands = new WeakMap<Document, Record<Provider, HTMLImageElement>>();
const decodedWordmarks = new WeakMap<Document, Record<'dark' | 'light', HTMLImageElement>>();
function receiptBrandAssets(document: Document): Promise<Record<Provider, HTMLImageElement>> {
  let assets = brandAssets.get(document);
  if (!assets) {
    assets = Promise.all(
      ['codex-outline.svg', 'claude-code-clawd.svg'].map(async (file) => {
        const image = document.createElement('img');
        image.src = `/brands/${file}`;
        await image.decode();
        return image;
      }),
    ).then(async ([codex, claude]) => {
      const svg = wordmarkSvg();
      if (svg) {
        const dimensions = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!;
        const images = await Promise.all(
          (['dark', 'light'] as const).map(async (theme) => {
            const image = document.createElement('img');
            const artwork = svg
              .replace('<svg ', `<svg width="${dimensions[1]}" height="${dimensions[2]}" `)
              .replace('fill="currentColor"', `fill="${theme === 'dark' ? '#eef2f4' : '#22272d'}"`)
              .replaceAll(
                'class="brand-name-accent"',
                `fill="${theme === 'dark' ? '#37ec85' : '#137744'}"`,
              );
            image.src = 'data:image/svg+xml,' + encodeURIComponent(artwork);
            await image.decode();
            return image;
          }),
        );
        decodedWordmarks.set(document, { dark: images[0], light: images[1] });
      }
      const marks = { codex, claude };
      decodedBrands.set(document, marks);
      return marks;
    });
    brandAssets.set(document, assets);
  }
  return assets;
}
const paperTextures = new WeakMap<Document, HTMLCanvasElement>();
function paperTexture(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const document = canvas.ownerDocument;
  let texture = paperTextures.get(document);
  if (texture) return texture;
  texture = document.createElement('canvas');
  texture.width = 64;
  texture.height = 64;
  const context = texture.getContext('2d')!;
  const pixels = context.createImageData(64, 64);
  let seed = 619;
  for (let i = 0; i < 64 * 64; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    if (seed % 7 !== 0) continue;
    const color = seed % 2 ? 255 : 0;
    pixels.data.set([color, color, color, color ? 4 : 8], i * 4);
  }
  context.putImageData(pixels, 0, 0);
  paperTextures.set(document, texture);
  return texture;
}
const isTokenRow = (row: ReceiptRow) =>
  ['Input Tokens', 'Output Tokens', 'Cache Reads', 'Tokens', 'Known Tokens'].includes(row.left);
const rowHeight = (row: ReceiptRow) =>
  !row.left && !row.right
    ? 34
    : !row.right
      ? 34
      : row.left === 'VALUE MULTIPLE'
        ? 46
        : row.accent
          ? 32
          : isTokenRow(row)
            ? 24
            : 28;
export function drawReceipt(
  canvas: HTMLCanvasElement,
  model: ReceiptModel,
  theme: 'dark' | 'light' = 'dark',
  presentation: 'standard' | 'preview' = 'standard',
): void {
  // A public example needs larger print when viewed inside the dashboard preview.
  // The paper, layout and export renderer remain shared with the local application.
  const printSize = (size: number) =>
    presentation === 'preview' ? Math.max(13, size * 1.12) : size;
  const light = theme === 'light';
  const ink = (color: string) =>
    light
      ? ((
          {
            '#e3e4e5': '#25282d',
            '#f0f0ef': '#171b20',
            '#b6b8bd': '#575d65',
            '#a3a5a9': '#646971',
            '#b4b5b9': '#626870',
            '#d0d1d5': '#393f47',
            '#37ec85': '#137744',
            '#ed9987': '#b34436',
            '#e1e2e4': '#22272d',
            '#bdc0c6': '#505861',
            '#e3e4e7': '#25282d',
            '#b2b3b9': '#535a63',
            '#a9adb5': '#626870',
          } as Record<string, string>
        )[color] ?? color)
      : color;
  const width = 360,
    height = 196 + model.rows.reduce((n, row) => n + rowHeight(row), 0) + 174,
    scale = 6;
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.aspectRatio = `${width}/${height}`;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Canvas unavailable');
  c.scale(scale, scale);
  // The same clipped paper silhouette is used in preview and PNG, including both torn edges.
  c.beginPath();
  c.moveTo(0, 7);
  for (let x = 0; x < width; x += 10) {
    const tooth = 4 + (x % 3);
    c.lineTo(x + 5, tooth);
    c.lineTo(x + 10, 8);
  }
  c.lineTo(width, height - 8);
  for (let x = width; x > 0; x -= 10) {
    c.lineTo(x - 5, height - 4 - (x % 3));
    c.lineTo(x - 10, height - 8);
  }
  c.closePath();
  const paper = c.createLinearGradient(0, 0, width * 0.3, height);
  paper.addColorStop(0, light ? '#fbf9f4' : '#181e24');
  paper.addColorStop(0.48, light ? '#f6f3ed' : '#131920');
  paper.addColorStop(1, light ? '#f0eee7' : '#11171c');
  c.fillStyle = paper;
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = c.createPattern(paperTexture(canvas), 'repeat')!;
  c.fillRect(0, 0, width, height);
  c.restore();
  c.strokeStyle = light ? '#484e5826' : '#b4b8bd20';
  c.lineWidth = 0.6;
  c.stroke();
  const mono = '"Plex Mono", Consolas, monospace',
    left = 24,
    right = width - 24;
  const text = (
    value: string,
    x: number,
    y: number,
    size: number,
    color = '#e3e4e5',
    align: CanvasTextAlign = 'left',
    bold = false,
    maxWidth = width - 48,
  ) => {
    size = printSize(size);
    c.font = `${bold ? '600 ' : ''}${size}px ${mono}`;
    while (c.measureText(value).width > maxWidth && size > 8) {
      size -= 0.5;
      c.font = `${bold ? '600 ' : ''}${size}px ${mono}`;
    }
    c.fillStyle = ink(color);
    c.textAlign = align;
    c.fillText(value, x, y);
  };
  const line = (y: number) => {
    c.strokeStyle = light ? '#636a7359' : '#6c6f754f';
    c.lineWidth = 1;
    c.setLineDash([4, 5]);
    c.beginPath();
    c.moveTo(left, y);
    c.lineTo(right, y);
    c.stroke();
    c.setLineDash([]);
  };
  const wordmark = decodedWordmarks.get(canvas.ownerDocument)?.[theme];
  if (wordmark) {
    // Compact, centered lettering only; no symbol or terminal cursor on the paper.
    const logoWidth = 156,
      logoHeight = logoWidth * (wordmark.naturalHeight / wordmark.naturalWidth);
    c.drawImage(wordmark, (width - logoWidth) / 2, 64 - logoHeight, logoWidth, logoHeight);
  } else text(product.name, width / 2, 64, 29, '#f0f0ef', 'center');
  text('USAGE RECEIPT', width / 2, 92, 13, '#b6b8bd', 'center');
  if (model.demo) text('EXAMPLE DATA', width / 2, 112, 10, '#a3a5a9', 'center');
  text('Period', left, 137, 12.5, '#b4b5b9');
  text(model.periodDetail, right, 137, 12.5, '#d0d1d5', 'right', false, 245);
  text('Generated', left, 158, 12.5, '#b4b5b9');
  text(model.generated, right, 158, 12.5, '#d0d1d5', 'right', false, 230);
  line(180);
  let y = 210;
  for (const row of model.rows) {
    const step = rowHeight(row);
    if (!row.left && !row.right) {
      line(y - 9);
      y += step;
      continue;
    }
    const provider = !row.right,
      multiple = row.left === 'VALUE MULTIPLE';
    const label =
      row.left === 'CODEX' ? 'Codex' : row.left === 'CLAUDE CODE' ? 'Claude Code' : row.left;
    const color =
      row.accent === 'positive'
        ? '#37ec85'
        : row.accent === 'negative'
          ? '#ed9987'
          : row.strong
            ? '#e1e2e4'
            : '#bdc0c6';
    const tokenRow = isTokenRow(row);
    const valueSize = multiple ? 25 : row.accent ? 22 : row.strong ? 18 : tokenRow ? 13 : 16;
    c.font = `${printSize(valueSize)}px ${mono}`;
    const valueWidth = c.measureText(row.right).width;
    const brand = row.left === 'CODEX' ? 'codex' : row.left === 'CLAUDE CODE' ? 'claude' : null;
    const mark = brand && decodedBrands.get(canvas.ownerDocument)?.[brand];
    let labelLeft = left;
    if (mark) {
      const size = 22;
      const markHeight = size * (mark.naturalHeight / mark.naturalWidth);
      if (brand === 'codex') {
        const tinted = canvas.ownerDocument.createElement('canvas');
        tinted.width = tinted.height = size * scale;
        const context = tinted.getContext('2d')!;
        context.drawImage(mark, 0, 0, tinted.width, tinted.height);
        context.globalCompositeOperation = 'source-in';
        context.fillStyle = ink('#e1e2e4');
        context.fillRect(0, 0, tinted.width, tinted.height);
        c.drawImage(tinted, left, y - 17, size, size);
      } else c.drawImage(mark, left, y - 14, size, markHeight);
      labelLeft += size + 8;
    }
    text(
      label,
      labelLeft,
      y,
      multiple ? 17 : provider ? 17 : tokenRow ? 12 : 14,
      multiple ? '#e1e2e4' : color,
      'left',
      provider,
      provider ? right - labelLeft : width - 62 - valueWidth,
    );
    text(row.right, right, y, valueSize, row.accent ? color : '#e3e4e7', 'right', row.strong, 160);
    y += step;
  }
  line(y - 3);
  text(
    model.outcome,
    width / 2,
    y + 27,
    10,
    model.outcome === 'YOUR PLAN WAS WORTH IT'
      ? '#37ec85'
      : model.outcome === 'API WOULD HAVE BEEN CHEAPER'
        ? '#ed9987'
        : '#b2b3b9',
    'center',
  );
  text(model.confidence, width / 2, y + (model.outcome ? 51 : 28), 11, '#a9adb5', 'center');
  const footerDivider = y + 73;
  c.strokeStyle = light ? '#62687033' : '#767b8126';
  c.beginPath();
  c.moveTo(left, footerDivider);
  c.lineTo(right, footerDivider);
  c.stroke();
  text(product.site, left, height - 44, 11.5, '#a9adb5');
  // Decorative print detail only: fixed pattern, no symbology or user-derived information.
  const pattern = [
    2, 1, 1, 1, 3, 1, 1, 2, 2, 1, 1, 1, 4, 1, 1, 2, 3, 1, 2, 1, 1, 2, 2, 1, 3, 1, 1, 1, 2, 2, 1, 1,
    3, 1, 2, 1, 1, 2, 4, 1, 1, 1, 2, 1, 3, 2, 1, 1, 2, 1, 1, 2, 3, 1, 2, 1, 1, 1, 3, 2, 1, 1, 2, 1,
  ];
  const module = 134 / pattern.reduce((n, w) => n + w, 0);
  let bx = right - 134;
  const barcodeHeight = 41,
    barcodeTop = footerDivider + (height - 8 - footerDivider - barcodeHeight) / 2;
  c.fillStyle = light ? '#303740db' : '#b8bec8c9';
  for (const [i, w] of pattern.entries()) {
    if (i % 2 === 0) c.fillRect(bx, barcodeTop, w * module, barcodeHeight);
    bx += w * module;
  }
}
export async function exportReceipt(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'),
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = product.exportBasename + '.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
