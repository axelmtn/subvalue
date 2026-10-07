import './landing.css';
import {
  product,
  productMark,
  productNameMarkup,
  productTitleMarkup,
} from '../../../packages/ui/src/brand.ts';
document.title = product.name + ' — Know what your AI subscription is worth';
import {
  drawReceipt,
  receiptModel,
  receiptFonts,
  type ReceiptInput,
} from '../../../packages/receipt/src/index.ts';
const example: ReceiptInput = {
  range: {
    from: new Date(2026, 9, 1).toISOString(),
    until: new Date(2026, 10, 1).toISOString(),
    label: 'October 2026',
    calendarFrom: '2026-10-01',
    calendarTo: '2026-10-31',
    calendarMonths: 1,
    preset: 'month',
  },
  providers: [
    {
      provider: 'codex',
      visible: true,
      records: 1,
      tokens: 20530000,
      tokensPartial: false,
      tokenBreakdown: { input: 19230000, output: 1300000, cacheRead: 15000000 },
      apiEquivalent: 201.36,
      knownSubtotal: 201.36,
    },
    {
      provider: 'claude',
      visible: true,
      records: 1,
      tokens: 7840000,
      tokensPartial: false,
      tokenBreakdown: { input: 440000, output: 400000, cacheRead: 7000000 },
      apiEquivalent: 86.06,
      knownSubtotal: 86.06,
    },
  ],
  total: {
    apiEquivalent: 287.42,
    knownSubtotal: 287.42,
    priceCoverage: 1,
    comparison: {
      subscription: 220,
      value: 67.42,
      roi: 287.42 / 220,
      breakEven: '2026-10-24',
      outcome: 'positive',
      reason: null,
    },
  },
  historyPartial: false,
  confidence: 'HIGH',
  demo: true,
};
const exampleReceipt = receiptModel(example, new Date(2026, 10, 1, 9, 30));
document.querySelector('#landing')!.innerHTML = /* HTML */ `<header class="landing-nav">
    <a class="brand" href="#"><span class="brand-mark">${productMark}</span>${productNameMarkup}</a>
    <nav class="landing-links" aria-label="Site navigation">
      <a class="install-link" href="#release">Install <span>↓</span></a>
      <a class="github-link" href="${product.repository}" target="_blank" rel="noreferrer"
        >GitHub <span>↗</span></a
      >
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>${productTitleMarkup}</h1>
      <h2>
        Know what your AI<br class="desktop-break" />
        <span class="hero-emphasis">subscription is worth.</span>
      </h2>
      <p>See what your Codex and Claude Code usage would have cost via API.</p>
      <div class="install-command">
        <code><span>$</span> npx @subvalue/cli</code
        ><button class="copy-command" aria-label="Copy install command">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V4H4v12h4" />
          </svg>
        </button>
      </div>
      <div class="trust-row">
        <span>✓ Local</span><span>✓ Read-only</span>
        <a href="${product.repository}" target="_blank" rel="noreferrer">✓ Open source</a>
        <span>✓ No telemetry</span>
      </div>
      <span class="release-note">Node.js 24.13+ · Windows · macOS · Linux</span>
    </section>
    <section class="product-preview" aria-label="Illustrative dashboard preview">
      <div class="preview-label"><span>PRODUCT PREVIEW</span><span>EXAMPLE DATA</span></div>
      <div class="preview-window">
        <div class="preview-topbar">
          <span class="brand"
            ><span class="brand-mark">${productMark}</span>${productNameMarkup}</span
          ><span class="preview-tab">Overview</span><span>Receipt</span><span>Settings</span
          ><span class="preview-date">October 2026</span>
        </div>
        <div class="preview-body">
          <div class="preview-main">
            <div class="preview-metrics">
              <div><span>API equivalent</span><strong>$287.42</strong></div>
              <div><span>Subscription</span><strong>$220.00</strong></div>
              <div><span>Value</span><strong class="green-text">+$67.42</strong></div>
              <div><span>Value multiple</span><strong>1.31×</strong></div>
            </div>
            <div class="preview-providers">
              <div class="preview-provider">
                <span class="preview-provider-mark"
                  ><img
                    class="codex-product-mark"
                    src="/brands/codex-outline.svg"
                    alt=""
                    aria-hidden="true"
                /></span>
                <div>
                  <strong class="codex-product-name">Codex</strong><span>API equivalent</span>
                </div>
                <b>$201.36</b><span class="preview-active">Usage found</span>
              </div>
              <div class="preview-provider">
                <span class="preview-provider-mark"
                  ><img src="/brands/claude-code-clawd.svg" alt="" aria-hidden="true"
                /></span>
                <div><strong>Claude Code</strong><span>API equivalent</span></div>
                <b>$86.06</b><span class="preview-active">Usage found</span>
              </div>
            </div>
            <div class="preview-chart">
              <div>
                <strong>Daily API equivalent</strong
                ><span class="preview-legend"
                  ><span>● Codex</span><span class="claude">● Claude Code</span></span
                >
              </div>
              <div class="preview-bars" aria-hidden="true">
                ${[15, 24, 19, 34, 29, 38, 21, 25, 39, 26, 32, 28, 43, 25, 31, 38, 49, 44, 52, 36, 41, 29, 45, 40, 53, 45, 66, 51, 57, 49].map((h) => /* HTML */ `<i style="height:${h}%"><span class="preview-codex-bar"></span><span class="preview-claude-bar"></span></i>`).join('')}
              </div>
              <div class="preview-chart-axis">
                <span>Oct 1</span><span>Oct 15</span><span>Oct 31</span>
              </div>
            </div>
          </div>
          <div class="preview-receipt">
            <canvas
              id="example-receipt"
              role="img"
              aria-label="Illustrative ${product.name} receipt. Codex and Claude Code example data. ${exampleReceipt.rows
                .filter((row) => row.left)
                .map((row) => row.left + ' ' + row.right)
                .join('. ')}"
            ></canvas
            ><span>Export PNG ↓</span>
          </div>
        </div>
      </div>
    </section>
    <section class="landing-privacy">
      <h2>Your data stays<br />on your machine.</h2>
      <div>
        <span>No account</span><span>No API keys</span><span>No uploads</span
        ><span>No telemetry</span>
      </div>
      <details class="privacy-details">
        <summary>Details</summary>
        <p>
          Usage is processed locally. Vercel hosts this page and can log website connections.
          <a href="/privacy.html" target="_blank" rel="noreferrer">Data access ↗</a>
        </p>
      </details>
    </section>
    <section class="install-section" id="release">
      <div class="install-command">
        <code><span>$</span> npx @subvalue/cli</code
        ><button class="copy-command" aria-label="Copy install command">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V4H4v12h4" />
          </svg>
        </button>
      </div>
      <span class="release-note">Node.js 24.13+ · Windows · macOS · Linux</span>
    </section>
  </main>
  <div class="copy-status" role="status" aria-live="polite"></div>`;
await receiptFonts();
drawReceipt(
  document.querySelector<HTMLCanvasElement>('#example-receipt')!,
  exampleReceipt,
  'dark',
  'preview',
);
document.querySelectorAll<HTMLButtonElement>('.copy-command').forEach((b) =>
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('npx @subvalue/cli');
      const status = document.querySelector('.copy-status')!;
      status.textContent = 'Copied';
      b.setAttribute('aria-label', 'Copied');
      setTimeout(() => {
        status.textContent = '';
        b.setAttribute('aria-label', 'Copy install command');
      }, 2000);
    } catch {
      const status = document.querySelector('.copy-status')!;
      status.textContent = 'npx @subvalue/cli';
    }
  }),
);
