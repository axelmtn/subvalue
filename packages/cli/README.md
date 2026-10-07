# SubValue

Local, read-only Codex and Claude Code API-equivalent usage analysis. No account, API keys, cloud database, AI calls, uploads, or telemetry.

## Install

Requires **Node.js 24.13 or newer** on Windows, macOS or Linux.

```sh
npx @subvalue/cli --dry-run
npx @subvalue/cli
```

For optional installation from a local package, see [Package validation](PRE_RELEASE.md).

## Run locally

Requires **Node.js 24.13 or newer**. Runtime and production build have no external dependencies.

For development, install dependencies with `npm ci --ignore-scripts`. Run `npm run check` for formatting, TypeScript, ESLint, build and unit/integration tests, then `npm run test:e2e` for browser and receipt-export checks. `npm run format` applies the shared format; CI rejects formatting drift on Windows, Linux and macOS.

```sh
npm run build
npm start -- --dry-run
npm start
```

The CLI scans both providers, stores normalized metadata in the OS application-data directory (`%LOCALAPPDATA%/SubValue` on Windows, `~/Library/Application Support/SubValue` on macOS, `$XDG_DATA_HOME/subvalue` or `~/.local/share/subvalue` on Linux), binds to `127.0.0.1:4731` (an OS-selected loopback port if occupied), and opens the default browser. It never modifies provider files.

```sh
npm start -- --no-open
npm start -- --scan-only
npm start -- --verbose
npm run demo
```

`--demo` is explicitly labeled fixture data, does not scan local providers, and does not create a usage database. `--port` selects the local port. `--dry-run` checks provider-directory metadata only: no session contents, database, or server.

## Interface

- **Overview:** 7D / 30D / Month / Custom, API equivalent, user-declared billing, optional subscription comparison, providers and daily known API value.
- **Receipt:** local canvas preview and PNG export of the exact same pixels. No projects, paths, requests or sessions in exports.
- **Settings:** Sources, Billing, USD, Privacy / data. Inactive providers stay here, with optional manual inclusion.

First run shows detected history, then offers subscription plans directly for each provider with imported usage. Choose a plan, a custom USD amount, or **No subscription** independently for Codex and Claude Code. No subscription requires no amount and never implies API billing. **Set up later** leaves billing unknown.

Month opens a floating calendar-month picker (including historical months). Previous/next arrows move by one calendar month, seven or thirty days for rolling presets, or the selected custom duration. Comparisons use the full declared monthly price for each complete calendar month selected. The current month is marked In progress. 7D, 30D and partial custom ranges show API-equivalent usage without subscription comparisons. Custom ranges covering whole calendar months compare the corresponding number of monthly charges. Amounts and API prices are USD; no invented exchange rates. Billing declarations do not overwrite historical records or prove their original billing mode. Settings offers bundled, verified ChatGPT/Claude plan presets and a custom amount. Annual presets retain the exact annual price divided by 12, with per-seat plans labeled.

## Source access

Only these session inputs are opened by the scanner:

```text
~/.codex/sessions/**/*.jsonl
~/.codex/archived_sessions/*.jsonl
~/.claude/projects/**/*.jsonl
```

No credentials, auth files, repositories, attachments, clipboard caches, shell history or browser data. The optional Claude stats cache is deliberately not imported in V1 because its history cannot be allocated safely by request/date. Directories referenced by session metadata are never opened. Project-path values are skipped by the metadata extractor.

Transcripts contain conversation text alongside metadata, so their bytes must be streamed to locate usage fields. A metadata-only JSON extractor decodes approved counters, dates, models and necessary deduplication fields for both providers. Prompt, response, instruction and tool-content values are skipped without constructing their strings or objects. Raw buffers are discarded after each line. No conversation content is persisted, logged, sent to the browser, or exported.

## Accuracy and pricing

`0`, `UNKNOWN`, `NO DATA`, and partial history are distinct. Null fields are never filled with zero. Each record carries provenance, schema, quality and metadata-only source identity. Token completeness and pricing coverage are separate; percentage priced describes **imported records**, not all historical activity.

Codex excludes inherited ordinal prefixes, uses cumulative deltas, suppresses repeated counters, segments counter resets and preserves unallocated totals. Claude deduplicates message/request identities and does not add nested iteration usage. Conflicting duplicates fail closed as incomplete.

The versioned catalog supports mappings with confidence and primary-source provenance, half-open effective intervals, cache reads/writes, Claude cache durations, and long-context bands. Rates and release evidence were checked against [OpenAI pricing](https://developers.openai.com/api/docs/pricing) and [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) on **2026-10-05**. Historical versions include the July 30 Luna/Terra reductions and August 21 Sol promotion. Exact public GPT-5.6/6 and Claude identifiers carry mapping provenance; long-context rates use the verified 272k request threshold. New-model launch days use their documented initial API-equivalent rate. Calendar-dated changes between rates remain unknown because their exact UTC switch time is not documented. Sol pricing after the confirmed promotion remains unavailable. See [the pricing evidence ledger](dist/PRICING.md). Internal/unknown model identifiers are never mapped by resemblance.

Overview and receipt display the sum of priceable events; the compact priced percentage identifies partial pricing, and unpriced model identities remain visible in Details. No guessed price or zero is assigned to unknown events. Both views share a display comparison of the known priced amount with the declared full-month subscription: Observed Value / You Saved is their difference, and Value Multiple is their ratio. The normalized summary still marks the full-usage cost and comparison unknown when pricing is incomplete. Partial coverage remains visible; these observed values do not infer a certain outcome or an exact break-even date. No subscription, unknown billing, and legacy API/mixed settings have no subscription comparison. Combined subscription comparisons require a declared subscription for every active provider.

## Architecture

```text
apps/web/                 local UI + static public landing
packages/core/src/        normalized types, security, scanner, SQLite, summaries
  providers/codex/        Codex adapter
  providers/claude/       Claude adapter
  pricing/                versioned catalog + mapping + calculations
packages/receipt/         shared receipt model and canvas renderer
packages/cli/             executable, loopback HTTP server, packaged assets
tests/                    synthetic parser, pricing, storage and security fixtures
scripts/                  native build + browser validation
```

Streaming memory is bounded by a 16 MiB line limit. Checkpoints persist byte offsets, typed parser state, file identity and edge fingerprints, never raw trailing text. Unfinished lines are read again on the next scan. Appended files continue from the checkpoint; changed files are replaced transactionally. Missing sources retain cached history with a missing-file flag. Unchanged files require only small fingerprint checks, not a full stream. Provider-input links and junctions are rejected. Checkpoints cannot prove changes made deliberately while preserving metadata and the edge fingerprints; V1 assumes normally written local logs.

## Development / validation

See [Privacy and data access](PRIVACY.md) for the exact fields retained locally and network boundaries.

Usage refreshes incrementally at each normal CLI launch. While the dashboard is open, use **Refresh usage** on Overview or in Settings. Period controls only filter the imported cache; they do not scan source logs. The local application must still be running.

Agents with a terminal on the user's machine can run the same CLI with Node.js 24.13+ and permission to read the approved usage roots and write SubValue's local metadata directory. Use `--scan-only --verbose` to update the cache and exit, or `--no-open` to serve the dashboard without opening a browser. This is CLI interoperability, not a dedicated MCP integration. Only Codex and Claude Code source logs are supported; Hermes or other agents can launch the CLI, but their own usage formats are not imported.

```sh
npm test
npm run build
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run lint
npm run test:e2e
```

Only development validation requires npm dependencies. Inter and IBM Plex Mono fonts are bundled under their included OFL licenses, with no CDN requests. The native production builder uses Node's TypeScript stripping and produces JavaScript modules, static CSS and assets; no compiler runs at CLI launch. Type stripping is **not** a TypeScript typecheck.

Browser validation uses an isolated headless browser with fixture data. Windows uses installed Edge; elsewhere install Playwright Chromium for development. `SUBVALUE_PLAYWRIGHT_MODULE` can reference an already-installed official Playwright module. No personal browser profile is used.

GitHub Actions validates Windows, Linux, and macOS on both Apple Silicon and Intel. Each runner checks types, lint, build, unit/integration tests, responsive browser pages, receipt PNG export, and the locally packed CLI from a temporary directory outside the checkout. The package requires Node.js 24.13 or newer on each platform.

Static landing output is `apps/web/dist`, suitable for a static host including Vercel. It contains no local API server or user data. Its preview is marked as an example. The source repository is public at [github.com/axelmtn/subvalue](https://github.com/axelmtn/subvalue).

## Package / release

```sh
npm run build
npm pack --workspace @subvalue/cli --ignore-scripts --pack-destination artifacts
```

Package contents are allowlisted to `dist/`, README, PRE_RELEASE, PRIVACY, and LICENSE. No lifecycle/postinstall scripts or runtime dependencies. Local databases, exports, attachments and test artifacts are ignored by Git and excluded from npm contents.

Manual npm releases use the audited package and do not claim a provenance attestation. The source repository is public. The future release workflow remains disabled until trusted publishing is configured and `NPM_PUBLISH_ENABLED=true` is set. It uses a protected environment and OIDC rather than a permanent npm token.
