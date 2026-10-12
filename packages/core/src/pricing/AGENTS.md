# Pricing catalog updates

Read `SOURCES.md` before editing this directory. Every update must preserve historical tariff versions and their effective dates.

- Verify rates and effective dates against official provider sources. Append new price versions; close the preceding half-open interval at the new effective date. Never overwrite old rates or substitute verification dates for effective dates.
- Date-only announcements take effect at 00:00 UTC on the announced day. Do not introduce unpriced transition days. Use an exact provider-published timestamp when available.
- Archive any previously unarchived versions in `tests/fixtures/pricing/history-YYYY-MM-DD.json` before changing them. Keep existing snapshots unchanged and document new evidence in `SOURCES.md`.
- Preserve event-timestamp pricing before aggregation, including per-request context/cache bands. Test the instant before and at a change, and period/receipt totals spanning it.
- Never guess rates for unknown models or unsupported tiers. Run `npm run check` after updates.
