# Privacy and data access

SubValue processes usage on the user's machine. It has no account, cloud usage database, telemetry SDK or runtime upload endpoint.

## Files read

Only these provider sources are opened for usage analysis:

- `~/.codex/sessions/**/*.jsonl`
- `~/.codex/archived_sessions/*.jsonl`
- `~/.claude/projects/**/*.jsonl`

The CLI also reads its own bundled assets and its own local application database. It checks source-directory/file metadata to detect providers and changes. It does not open credentials, `.env` files, shell history, browser profiles, repositories or project paths mentioned by a session. Symlinks and junctions are rejected. `--dry-run` detects directories without opening session contents.

Session files colocate counters and conversation text. Their bytes must therefore pass through memory during a scan. A metadata-only JSON extractor decodes whitelisted token counters, model identifiers, timestamps and required deduplication fields. It skips conversation, instruction, attachment and tool-content values without constructing their text strings or objects. Skipped JSON is checked for valid syntax; raw line buffers are discarded after processing. Prompts, responses, attachments and source code are never persisted or displayed.

## Local metadata retained

- Provider, timestamp, raw model identifier and token/cache counters.
- Service tier, speed and billable tool counts when present, for pricing accuracy.
- Quality flags, schema and scan diagnostics.
- Hashed event/source references and a hashed Claude request identity, for deduplication and provenance.
- File sizes, modification times, hashes of small byte windows and offsets, for incremental scans.
- Codex thread identity and cumulative-counter state in scan checkpoints, to preserve deduplication and counter resets. This identity is not sent to the dashboard.
- User-declared billing settings, provider visibility and onboarding state.

Normalized records omit session/thread identities and project associations. Checkpoints omit unnecessary session, turn and project fields. Existing normalized caches are migrated locally without re-reading source histories or changing event keys and token totals.

The browser receives aggregate totals, daily values, model coverage and safe source statuses. It receives no individual requests, project paths, source filenames or conversation text. Receipt exports contain only the selected period, generated date, provider totals and comparison/coverage.

## Storage and deletion

Metadata is stored in SQLite in the OS application-data directory documented in README. It is not encrypted by SubValue; access relies on the user's OS permissions. It is retained for history and incremental scanning. To remove it, stop SubValue and delete only its application-data directory. This does not delete Codex or Claude files.

## Network boundaries

The dashboard server binds only to `127.0.0.1`. Host/origin checks and a per-launch token protect local mutations. The local dashboard uses bundled fonts, scripts and assets and makes no external requests. Pricing is bundled, with no online lookup of user activity.

Installing or updating with npm/npx contacts the package registry. That installation traffic is separate from usage analysis. Following an external documentation link is an explicit browser action.

The public Vercel landing is separate from the local application. It has no usage API, cloud scanner or usage database; its product example is labeled example data. No analytics SDK is included. As the website host, Vercel can process ordinary website connection metadata (such as IP address and requested URL); the landing never receives local usage. See [Vercel's privacy policy](https://vercel.com/legal/privacy-policy).

## Verification

Synthetic tests check approved file access, blocked links, discarded conversation fields, cache migration, deduplication, safe browser summaries and receipt privacy. Browser tests verify no external application requests and identical preview/export pixels. These checks are not a claim of an independent security certification.
