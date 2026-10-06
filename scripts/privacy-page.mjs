// Render the existing policy at build time. No browser JavaScript or network fetch.
export function privacyPage(markdown, product) {
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  function inline(value) {
    let result = '', offset = 0;
    for (const match of value.matchAll(/`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g)) {
      result += escape(value.slice(offset, match.index));
      result += match[1] !== undefined ? `<code>${escape(match[1])}</code>` : `<a href="${escape(match[3])}" rel="noreferrer">${escape(match[2])}</a>`;
      offset = match.index + match[0].length;
    }
    return result + escape(value.slice(offset));
  }
  const content = markdown.replaceAll('SubValue', product.name).trim().split(/\r?\n\s*\r?\n/).map(block => {
    if (block.startsWith('# ')) return `<h1>${inline(block.slice(2))}</h1>`;
    if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
    const lines = block.split(/\r?\n/);
    if (lines.every(line => line.startsWith('- '))) return `<ul>${lines.map(line => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
    return `<p>${inline(lines.join(' '))}</p>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#080b0d"><title>Privacy and data access — ${escape(product.name)}</title><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/privacy.css"></head><body class="privacy-page"><a class="privacy-skip" href="#policy">Skip to content</a><header class="privacy-nav"><a class="brand" href="/"><img src="/logo/mark-green.svg" alt="" width="24" height="24">${escape(product.name)}</a><a class="privacy-back" href="/">← Back</a></header><main id="policy" class="privacy-document" tabindex="-1"><article>${content}</article><footer><a href="/privacy.txt">Plain text ↗</a></footer></main></body></html>`;
}
