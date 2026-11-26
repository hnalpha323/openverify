# ADR 0005: Reports: honesty, and live public-sector data

- **Status:** Accepted (Workflow 6A Stage 1a, 2026-10-27). It extends ADR 0002 to reports and records how live sanctions, PEP and media data meet `CLAUDE.md` rule 4.
- **Date:** 2026-10-27
- **Related:** ADR 0002 (check tiers and honesty); `docs/plans/phase-6.plan.md` C69.4, C71.2, C76, C78.3, C78.5, C81, C83, C84.3, decisions 1, 2, 7, 10, 11, 13, 14, 47, 53, 54, 56 and 60; Phase 5 decision 40 (public-sector PKI data as an operator-fetched runtime exception to rule 4); `docs/research/phase6-data-sources.md`.

## Context

Reports screen a person, a company, an address or a crypto address against lists and services that OpenVerify does not own: sanctions lists published by governments, PEP data derived from Wikidata, news indexed by GDELT, and vendor adapters. Their answers decide whether a real person is onboarded or sent to review.

Two things make reports different from checks:

1. **A screening answer of "no match" is the screening equivalent of a fake `passed`.** It is only true for the lists that were actually screened, at the version screened, by the matcher that built the keys, and over the names the matcher could compare. A list that was never synced, a stale list, an empty selection, a search cut short at its candidate cap, a name in a script the matcher can only compare lossily, or stored keys from another matcher version all make "no match" false without anything looking wrong. Operators stop looking at a screening that says "clear".
2. **The data changes daily and cannot be pinned.** Rule 4 requires model and data downloads to go through `scripts/fetch-*` with pinned SHA-256 hashes. A sanctions list published several times a week has no hash to pin, and shipping a copy would be both stale and, for several sources, outside their terms.

## Decision

### 1. Report types have tiers, as checks do

Every report type declares its tiers and stage in `REPORT_REGISTRY` (`packages/core/src/report-registry.ts`): R for list parsing, exact identifier and crypto-address matching and the facts we can compute; H for the name score, PEP status, media relevance and the email and phone levels, which carry a confidence and their reasons and stay `beta`; A for vendor data behind a provider kind with a deterministic sandbox provider. `crypto-address-watchlist` (exact matching only) may become `ga` once the test vectors of every row of the C79.3 format table pass; every other type stays `beta` until a calibration report exists (ADR 0002 §3f). No threshold is tuned on the evaluation set.

### 2. A report never answers "no match" for a search it did not make in full

The C69.4 rules are binding:

- **Partial runs.** A run screens every selected source it can, keeps the matches it finds and fires `.matched` for them. When any selected source was not screened (never synced, not configured, disabled, withdrawn, keyed by another matcher version, or stale), the run ends `errored` with `list_unavailable`, `list_stale` or `matcher_data_unavailable`, naming each such source, whatever it found. An empty selection errors with `list_unavailable` and is refused at publish (`watchlist_sources_empty`). A report is never `ready` while a source its latest run selected went unscreened, and reviewing its matches leaves it `errored`.
- **`has-match` reads as "no match" only beside `ready`.** `filter[has-match]=false` returns only `ready` reports, and the console shows "not screened" for an errored one. A report is `errored` exactly when it carries errors (the resource schema enforces it).
- **Coverage.** Every matching run states how completely it compared the subject's names (`same_script`, `transliterated`, `lossy`, `not_compared` per name in the sealed result; `coverage.complete` and a closed set of `coverage.limits` on the report, never names or scripts) and whether the search was cut short. A cut-short search that found no match ends `errored` with `result_truncated`.
- **Unknown is never `false`.** A type whose whole answer needs a provider (`adverse-media`, `business-adverse-media`) is `errored` with `provider_not_configured` when none is bound. A partial type (`email-address`, `phone-number`, `address-lookup`) is `ready` with every field it could compute; a field that needs an unbound provider, or that the rule cannot decide, is `null` and listed in `unavailable-fields` with its reason. Lists that were never searched (the business watchlist's warning and fitness-and-probity lists) are `null`, never empty arrays.
- **Provenance on every result.** Each source used, with its sync id, publication time, last successful check, SHA-256 and `origin` (`publisher`, or `import` for a file an operator loaded, which is never cited as the publisher's); the source of each query field; the matcher version, preset and thresholds; the provider identity, with `sandbox: true` in sandbox.
- **Freshness counts from the last successful check**, not from the last change, so a quiet publisher stays fresh while checks succeed and failed checks turn it stale. A sandbox-only list is static synthetic data and is never stale.
- **Missing matcher data errors, never degrades.** Without the filtered variant-group file, or with another digest, person-name runs end `errored` with `matcher_data_unavailable`. A source keyed by another `keys_version` errors the same way until it is re-keyed.
- **Sandbox data never reaches production.** A sandbox provider or a sandbox-only list is refused for a production environment at publish and in SQL.
- **A match never changes an inquiry or an account on its own**, except through the opt-in `on-report-match: needs_review`, which also sends an inquiry to review when its completion report could not screen (an errored report is not clear: ADR 0002 §3b).

### 3. Live public-sector data reaches a database only through the operator's sync

Rule 4 is interpreted for live public-sector list data as Phase 5 decision 40 interpreted it for the CSCA trust store:

- **Operator-fetched at run time, never committed or shipped.** List data is downloaded by an operator-run CLI (`watchlists:sync`, `pep:sync`), or by the refresh job only when `OPENVERIFY_WATCHLIST_REFRESH=true`. It is never in git, never in an image, never fetched by CI, and never fetched by a test. Tests, the e2e and the sandbox use synthetic lists written in each publisher's format and imported with `--import`.
- **Verified instead of pinned.** Each source is described in a committed manifest (`watchlists/sources.json`): its URLs, the one host a redirect may go to, its content types, byte caps, deadline, parser, refresh and staleness intervals, terms note and attribution line. Every check downloads the publication and compares its SHA-256; no publisher change signal is read (owner decision 10 after Workflow 6B). A sync downloads over HTTPS through the vetted lookup, follows at most one redirect to the exact allowed host, on the request's own scheme and port, counts bytes against the caps, hashes and parses the same file, validates every record against the frozen normalised schema, refuses a publication dated more than 24 hours ahead, and applies under a per-source lock, re-checking there that the publication is not older than the last applied one and that it removes no more than 10% of the entries, unless an audited override says otherwise. Every sync, refusal and override is written to `watchlist_syncs`.
- **Terms per source.** The OFAC lists (US government works), the EU Financial Sanctions Files (Decision 2011/833/EU, credit the source; the operator supplies the catalogue's public token in `OPENVERIFY_EU_FSF_TOKEN`) and the FCDO UK Sanctions List (Open Government Licence v3.0) are enabled by default. The UN consolidated list ships disabled: its site terms grant personal, non-commercial use, and the operator decides. OFSI's closed list is never a source. OpenSanctions data (CC BY-NC) is not used. Wikidata (CC0) is queried only by the operator's sync, with the operator's own contact in `OPENVERIFY_WIKIDATA_USER_AGENT`, and screening runs against the local mirror, never with an end user's name. GDELT adverse media is unbound by default; binding it needs `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true`, because every query sends the screened name to a third party, and only a URL, domain, dates, language, source country and a 200-character title are stored, never cached. Each source's attribution line is shown with every result that used it.
- **Static matching data still goes through `scripts/fetch_data.py`.** The rigour variant groups (MIT repository, Wikidata CC0 groups) are pinned by SHA-256 in `data/manifest.json` and filtered at build time; only the filtered file is carried in the apps image.

### 4. Where it is enforced

| Rule | Enforcement point |
|---|---|
| Tiers, stages, review models | `packages/core` `REPORT_REGISTRY` and its tests |
| Errored exactly with errors; `has-match` from open matches; no `has-match` without review; `null` never-searched lists; capped media confidence; no synthesised phone score | `packages/contracts` report resource schemas and `reports.test.ts` |
| Partial runs, coverage, truncation, freshness, keys version, missing matcher data | the report run framework and the per-type hooks (Workflow 6A Stage 3), with a unit or Testcontainers test per rule (C69.4) |
| Sandbox lists and providers refused in production | the publish rules (`watchlist_source_not_allowed`), the provider binding rules, and `environmentKind` in candidate retrieval |
| Live data never committed | `.gitignore` (`data/*`), the operator-run CLIs, CI never calling a publisher, and synthetic fixtures generated from seeds |

## Alternatives considered

| Option | Why not |
|---|---|
| Answer `ready` with `has-match: false` and a warning when a list is stale | A warning beside "no match" is read as "clear". It is the screening version of a fake pass. |
| Drop an unscreened source from the run and answer for the others | Coverage silently shrinks; the result cites fewer lists than the template selected and nobody notices. |
| Ship a snapshot of the lists in the image, pinned by hash | Stale on the day it ships, against several publishers' terms, and personal data in an artefact that is never redacted. |
| Leave unconfigured sources out of the default lists | A template made before the EU token is set would never screen the EU list, and its reports would look complete (V01). |
| Re-key stored lists automatically at worker start after an upgrade | Long at PEP scale and it delays startup; erroring with `matcher_data_unavailable` until `watchlists:rekey` runs is honest and visible (decision 60). |

## Consequences

- A fresh production install answers `list_unavailable` for every default report until the operator syncs the lists and sets the EU token and the Wikidata contact. This is intended, and the console's sources page says why.
- Operators carry the cost of freshness: they enable the refresh job or schedule the CLI more often than the stale limits.
- More reasons to explain: `errors`, `unavailable-fields`, `coverage.limits` and the notices need words in the console and the docs, and every H-tier result shows its `beta` stage and its confidence.
- Screening data is personal data (and adverse media can be GDPR Art. 10 data): match evidence is sealed, indexes are HMACs, redaction nulls every index, and the lawful basis is the operator's responsibility.
