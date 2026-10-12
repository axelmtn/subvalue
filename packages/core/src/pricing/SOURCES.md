# Pricing evidence — catalog 2026-10-12.1

USD per million tokens, standard first-party API equivalent. Exact public model IDs only. A mapping's HIGH confidence describes identity, not completeness of retained history. This catalog is bundled and makes no network requests.

| Model                       | Effective date                       | Input / cached input / output | Evidence                                                                                                                                                                  |
| --------------------------- | ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPT-5.6 Sol                 | 2026-07-09                           | 5 / 0.50 / 30                 | [Launch](https://openai.com/index/gpt-5-6/)                                                                                                                               |
| GPT-5.6 Sol                 | 2026-08-21                           | 4 / 0.40 / 20                 | [API changelog, Aug 21](https://developers.openai.com/api/docs/changelog), [model](https://developers.openai.com/api/docs/models/gpt-5.6-sol)                             |
| GPT-5.6 Luna                | 2026-07-09                           | 1 / 0.10 / 6                  | [Launch](https://openai.com/index/gpt-5-6/)                                                                                                                               |
| GPT-5.6 Luna                | 2026-07-30                           | 0.20 / 0.02 / 1.20            | [Price change](https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/), [model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)      |
| GPT-6 Astra                 | 2026-09-03                           | 10 / 1 / 50                   | [API changelog](https://developers.openai.com/api/docs/changelog), [model](https://developers.openai.com/api/docs/models/gpt-6-astra)                                     |
| GPT-6 Sol                   | 2026-09-22                           | 2 / 0.20 / 10                 | [API changelog, Sep 22](https://developers.openai.com/api/docs/changelog), [model](https://developers.openai.com/api/docs/models/gpt-6-sol)                               |
| GPT-6 Luna                  | 2026-09-22                           | 0.10 / 0.01 / 0.50            | [API changelog, Sep 22](https://developers.openai.com/api/docs/changelog)                                                                                                 |
| GPT-6.1 Sol                 | 2026-09-29                           | 2 / 0.10 / 10                 | [API changelog, Sep 29](https://developers.openai.com/api/docs/changelog), [model](https://developers.openai.com/api/docs/models/gpt-6.1-sol)                             |
| Claude Fable 5              | 2026-06-09; restored 2026-07-01      | 10 / 1 / 50                   | [Announcement, including suspension](https://www.anthropic.com/news/claude-fable-5-mythos-5), [release notes](https://platform.claude.com/docs/en/release-notes/overview) |
| Claude Opus 4.8             | 2026-05-28                           | 5 / 0.50 / 25                 | [Announcement](https://www.anthropic.com/news/claude-opus-4-8)                                                                                                            |
| Claude Opus 5               | 2026-07-24                           | 5 / 0.50 / 25                 | [Announcement](https://www.anthropic.com/news/claude-opus-5)                                                                                                              |
| Claude Opus 4.7 / 4.6 / 4.5 | 2026-04-16 / 2026-02-05 / 2025-11-24 | 5 / 0.50 / 25                 | [4.7](https://www.anthropic.com/news/claude-opus-4-7), [4.6](https://www.anthropic.com/news/claude-opus-4-6), [4.5](https://www.anthropic.com/news/claude-opus-4-5)       |
| Claude Sonnet 4.5 / 4.6     | 2025-09-29 / 2026-02-17              | 3 / 0.30 / 15                 | [4.5](https://www.anthropic.com/news/claude-sonnet-4-5), [4.6](https://www.anthropic.com/news/claude-sonnet-4-6)                                                          |

Cache policy: [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching), [Claude](https://platform.claude.com/docs/en/about-claude/pricing). OpenAI cache writes replace the ordinary input rate, at 1.25× input; cached input and writes are subsets of reported input. Claude input, cache read and cache creation are separate. Claude writes cost 1.25× (5m) or 2× (1h) input. Unknown durations stay unavailable.

GPT-5.6 and GPT-6 long-context requests above 272,000 input tokens use 2× input/cache rates and 1.5× output. The entire request receives the applicable band; reasoning is an output breakdown, never a second charge. An aggregate counter delta with inconsistent last-request metadata cannot determine its request context and remains unavailable.

Claude Opus/Sonnet 4.6 long-context premium was removed [March 13](https://claude.com/blog/1m-context-ga). Earlier requests above 200k remain unavailable in this catalog, rather than receiving today's standard rate. Sonnet 4.5 and Opus 4.5 above 200k also remain unavailable pending complete premium/availability evidence.

A new model has one documented initial rate: launch-day API-equivalent estimates use that rate. When the provider announces a change by date only, the new tariff applies from 00:00 UTC on that date. This day-level estimate convention avoids unpriced transition days; it does not claim an exact invoice switch instant. Sol's promotional rate is confirmed at least through November 21: November 22 onward stays unavailable until evidence extends or replaces that version. Fable's suspended interval is unpriced. GPT-5.3-Codex is retained as an October 5 current snapshot only, pending historical rate evidence.

`codex-auto-review`, unknown aliases, nonstandard tiers/speeds and server tool charges remain unavailable. No inferred subscription billing, regional surcharge, discounts, batch rate or tax. These are standard API-equivalent estimates, not reconstructed invoices.

## Catalog completeness audit — October 5, 2026

The [OpenAI standard text/code pricing table](https://developers.openai.com/api/docs/pricing) was checked in full, including its embedded table data: all 40 rows have matching input, cached-input, cache-write (where published), and output rates. A separate checked fixture verifies every row. Six additional older Codex models are covered from their individual official model pages: GPT-5-Codex, GPT-5.1-Codex, GPT-5.1-Codex-Max, GPT-5.1-Codex-Mini, GPT-5.2-Codex and Codex-Mini-Latest. GPT-5.3-Codex, GPT-5.6-Cyber and Chat-Latest are also explicitly covered. Older/current-only snapshots start October 5; current prices are never silently backdated to unverified historical periods. No prefix-based or invented snapshot aliases.

GPT-5.6 Terra initially cost 2.50 / 0.25 / 15 ([July 9 launch](https://openai.com/index/gpt-5-6/)), then 2 / 0.20 / 12 from the [July 30 reduction](https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/). The announced reduction date uses the day-level convention above. GPT-5.4/5.5, including Pro, use the documented >272k long-context band; unsupported Pro caching remains unknown. Cyber is bounded to the verified standard-context band.

All 15 active standard models in [Claude's pricing table](https://platform.claude.com/docs/en/about-claude/pricing) are covered, including Fable/Mythos 5.1, Opus 5.5, Sonnet 5/5.5 and Haiku 4.5. Their launch dates come from [official release notes](https://platform.claude.com/docs/en/release-notes/overview). Fable/Mythos 5.1 cache reads are 0.025x input ($0.25/MTok); Opus 5.5 reads are 0.05x ($0.20/MTok), rather than the ordinary 0.1x. Claude writes retain 1.25x/2x for 5m/1h. Sonnet 5's introductory $2/$10 tariff became permanent August 10: the previously planned September increase is not applied.

Retired Claude Opus 4/4.1, Sonnet 4 and Sonnet 3.7 have explicit historical tariffs bounded by their [official retirement dates](https://platform.claude.com/docs/en/about-claude/model-deprecations). Haiku 3.5's exact identity is recognized, but its historical price reduction date is not established: its currently published $0.80/$4 is not backdated to the $1/$5 launch. Mythos Preview's published $25/$125 input/output tariff is an October 5 snapshot; unverified cache rates remain unknown. Models retired before Claude Code and unsupported dated aliases are not claimed to have complete historical prices.

This audit covers first-party standard text/code token equivalents. Audio, video, image-generation, embeddings, research-specialist models and separate tool charges require categories absent from these coding logs and are outside this catalog. Subscription models, Fast/Batch/Flex tiers, negotiated/region-specific prices and future promotions are not inferred. Codex-Auto-Review and GPT-5.3-Codex-Spark have no verified public API equivalent in this audit.

## Catalog update — October 12, 2026

The 40 OpenAI standard text/code table rows were compared with the October 5 snapshot: no added rows or rate changes. The October 8 GPT-6.1 Sol Ultrafast tier is outside this standard-tier catalog; it must not silently inherit standard pricing.

[Anthropic's October 7 release notes](https://platform.claude.com/docs/en/release-notes/overview) announce Claude Haiku 5.5 and the Sonnet 5.5 cache-read reduction. Sonnet's original September 28 version retains $0.20/MTok cache reads through October 6; its October 7 version uses $0.10/MTok. Input $2, output $10, 5m writes $2.50 and 1h writes $4 remain unchanged. All October 7 events use the new version under the date-only convention.

[Haiku 5.5's official model page](https://platform.claude.com/docs/en/models/haiku-5-5/overview) supplies its exact ID, October 7 launch and context-dependent prices:

| Request input context  | Input | Cache read | Cache write 5m | Cache write 1h | Output |
| ---------------------- | ----- | ---------- | -------------- | -------------- | ------ |
| At most 100,000 tokens | 0.10  | 0.01       | 0.125          | 0.20           | 0.50   |
| Above 100,000 tokens   | 0.50  | 0.05       | 0.625          | 1.00           | 2.50   |

The [Claude pricing rules](https://platform.claude.com/docs/en/about-claude/pricing) count input, cache reads and cache writes toward the request threshold. The selected band applies to the whole request, including output and each cache-write duration. Period totals do not determine request bands. Other standard Claude prices remain unchanged.

## Historical pricing maintenance — required for every update

- Keep existing tariff versions and their rates. Append a new version for each verified change and close the preceding interval at the new version's `effective_from`; never replace historical rates with today's rates.
- Record the effective date, provider, exact model ID, all token/cache rates, context bands, official evidence and verification date internally. Verification dates are not effective dates. Never backdate a current-only snapshot without historical evidence.
- Use the provider's exact effective instant when documented. For a date-only announcement, apply the new price from 00:00 UTC on that day. Keep half-open intervals: the old rate ends exactly where the new one begins, with no overlap or gap at a price change.
- Price each normalized usage event at its timestamp, then sum those amounts for the selected period, chart and receipt. Never price a month's aggregated tokens using its ending rate. A request's context band is chosen before aggregation.
- Before changing the catalog, archive any not-yet-archived tariff versions under `tests/fixtures/pricing/history-YYYY-MM-DD.json`. Keep previous snapshots unchanged. The October 5 snapshot preserves 76 existing versions; the October 12 snapshot adds the two new versions. Tests read every historical snapshot to protect rates, start dates and past coverage.
- Add boundary tests immediately before and at the effective date, plus a summary/receipt test spanning the change. Run the full checks. Any correction to erroneous historical evidence needs a documented source and explicit correction, not a silent snapshot rewrite.
- Do not invent a price for an unresolved model, unsupported billing tier, missing token breakdown or unverified historical interval. These remain explicit exclusions rather than false zeroes.

The SQLite cache retains normalized timestamps and token counters, not frozen dollar totals. Catalog updates therefore recalculate historical views using the retained tariff versions without rescanning source conversations.

## Subscription presets

USD plans were checked October 5 against [ChatGPT pricing](https://learn.chatgpt.com/docs/pricing), [Claude pricing](https://claude.com/pricing) and [Claude Max tiers](https://support.claude.com/en/articles/11049741-what-is-the-max-plan). Presets are bundled locally, selected manually and do not rewrite existing amounts. Annual plans use the exact annual total divided by 12 (Claude Pro: $200/year, not $17/month); per-seat rates are explicitly labeled. Enterprise/Edu and usage-dependent enterprise bills use Custom amount. Presets describe current plans, not a reconstructed history of subscription contracts.
