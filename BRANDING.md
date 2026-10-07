# Visual assets

The neutral product symbol is two opposed measurement corners: a compact comparison/caliper motif, with no letters, currency sign or provider-derived geometry. It is original vector artwork licensed under this project's MIT license.

Display identity lives in `packages/ui/src/brand.ts`. Navigation, landing, generated HTML titles and receipt exports consume it. Package identifiers and local storage paths are separate compatibility identifiers.

## Product assets

- `apps/web/public/logo/mark-green.svg`: default standalone symbol.
- `apps/web/public/logo/mark-white.svg`: white symbol.
- `apps/web/public/logo/mark-monochrome.svg`: `currentColor`, black by default as a standalone image; suitable for inline monochrome use.
- `apps/web/public/logo/app-icon.svg`: 512 px scalable icon, graphite background.
- `apps/web/public/favicon.svg` and `icon.svg`: SVG favicon, the same geometric mark.
- Navigation uses the identical path from `brand.ts`, independently of the product-name text.

The secondary wordmark is original 5×7 terminal lettering: SUB in off-white and VALUE in electric green. The landing title alone includes a blinking underscore cursor; it stays visible without blinking for reduced-motion preferences. Navigation, the preview header and the privacy header omit the cursor. They share the same letter vectors. The build produces cursor-free `logo/wordmark.svg` and `logo/wordmark-monochrome.svg`; no extra font or remote asset is needed. The artwork is covered by the project's MIT license. The display name remains centralized; unsupported rename characters fall back to ordinary text. The primary symbol remains independent.

The receipt uses compact, centered pixel lettering without the standalone symbol or cursor. The same wordmark vectors are drawn locally in the dashboard, PNG exports and public example, with dark ink on white paper. Its decorative bottom bars are a fixed generic pattern, not a machine-readable payment code and not derived from private metadata.

## Official provider artwork

Verified 2026-10-04. The provider artwork below is copied byte-for-byte from the official archive, without recoloring, cropping or redrawing. Provider identities are not SubValue branding or a claim of endorsement. Provider trademarks remain the property of their respective owners and are not covered by the project's MIT license.

### Codex

- Asset: `apps/web/public/brands/codex-outline.svg`, the official scalloped terminal outline mark, paired with the explicit label “Codex”.
- Source: installed official OpenAI.Codex Windows package version 26.930.3930.0, `app/resources/app.asar`, asset `webview/assets/codex_new-f14177b03534.svg`. Copied byte-for-byte; no third-party tracing or redraw.
- The original black vector is displayed in white via CSS inversion on dark backgrounds; geometry is unmodified. No ChatGPT/OpenAI Blossom is shown.
- Product source: https://openai.com/codex/

### Claude Code

- Asset: `apps/web/public/brands/claude-code-clawd.svg`, the pixel mascot Clawd, paired with the explicit label “Claude Code”.
- Source: installed official Anthropic VS Code extension `anthropic.claude-code`, version 2.1.195, `resources/clawd.svg`. Copied byte-for-byte; original #D97757 color and geometry preserved.
- Official extension: https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code
- The prior official ivory wordmark remains an unused attribution-preserved asset from https://anthropic.com/press-kit; it is no longer used for provider cards.

All assets ship locally; no brand CDN is contacted by the dashboard or landing at runtime. `apps/web/public/brands/SOURCES.txt` travels with the package as provider attribution and provenance.
