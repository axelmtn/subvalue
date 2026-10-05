# Security model

## Inputs

The scanner derives its three allowed source roots from the operating-system home directory. There is no arbitrary-file or source-root override exposed in the CLI/HTTP API. Internal test injection is restricted to synthetic fixtures.

Source reads use validated regular files, read-only descriptors, link/junction rejection, canonical containment checks and descriptor identity checks. Metadata paths cannot authorize reads. Reparse-point races on operating systems that cannot provide handle-relative containment remain a platform limitation; source directories must be owned by the current user and not concurrently manipulated by another local principal.

Only normalized allowlisted metadata crosses the storage boundary. Errors and diagnostics never contain source lines or private filenames. Parser state and fingerprints contain no conversation text. Oversized lines are discarded and reported, not persisted. Missing, invalid and unsupported metadata lowers confidence.

Credentials and `.env` files are never opened. There is no source-code scanning, subprocess execution based on transcript contents, telemetry, API client or external network request in the runtime. The only runtime subprocess opens the local dashboard in the user's default browser.

## Storage and localhost

SQLite and preferences are local. New application directories request user-only filesystem permissions; Windows inherits the user's directory ACLs. The database is not encrypted. Other processes running as the same user may access it. Do not put the data directory in a publicly shared folder.

The default directory is `%LOCALAPPDATA%/SubValue` on Windows, `~/Library/Application Support/SubValue` on macOS, and `$XDG_DATA_HOME/subvalue` or `~/.local/share/subvalue` on Linux. Normal launch stores no usage in the source repository. Custom data directories must stay separate from provider roots and cannot use links.

HTTP binds only to IPv4 loopback. Host and Origin are validated; cross-site Fetch Metadata requests are rejected. Mutations require a per-launch token. No permissive CORS, arbitrary file API, remote bind option or upload endpoint. CSP limits assets/connections to this origin. Static file paths are confined to packaged assets. Receipts are rendered and exported in the local browser.

Port collisions fall back to an OS-selected port on the same `127.0.0.1` address. Fonts, JavaScript, CSS, icons, chart drawing and receipt rendering are bundled. Browser-opener failures leave the local URL visible. No runtime network lookup is made for pricing or model mappings.

## Packaging

No runtime dependencies, install hooks, permanent npm tokens or automatic publication. Git/npm exclusions protect local inputs, databases, generated receipts and attachments. Release workflows require separate operator authorization/configuration. Development dependencies are separate from shipped contents.

Before public release, complete TypeScript/ESLint/browser validation, review the packed file inventory, verify pricing evidence, and configure the repository's protected release environment and npm trusted publisher.
