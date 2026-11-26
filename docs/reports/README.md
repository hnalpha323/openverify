# Reports

A report screens one subject (a person, a company, an email address, a phone number, a postal address or a crypto address) against lists and services, and keeps the result as a `report/<type>` resource with a `rep_` id. Phase 6 ships nine types. Each has a page here: what a result means, its query and configuration, the sources or providers it uses, the sandbox values, and its limits.

| Type | Page | Tiers (ADR 0002) | Stage | Review |
|---|---|---|---|---|
| `watchlist` | [watchlist.md](watchlist.md) | R lists, H score | `beta` | matches |
| `business-watchlist` | [business-watchlist.md](business-watchlist.md) | R lists and identifiers, H score | `beta` | matches |
| `crypto-address-watchlist` | [crypto-address-watchlist.md](crypto-address-watchlist.md) | R (exact) | `ga` | matches |
| `politically-exposed-person` | [politically-exposed-person.md](politically-exposed-person.md) | H | `beta` | matches |
| `adverse-media` | [adverse-media.md](adverse-media.md) | H, A | `beta` | matches |
| `business-adverse-media` | [business-adverse-media.md](business-adverse-media.md) | H, A | `beta` | matches |
| `email-address` | [email-address.md](email-address.md) | R subset, H level, A extras | `beta` | none |
| `phone-number` | [phone-number.md](phone-number.md) | R subset, H level, A extras | `beta` | none |
| `address-lookup` | [address-lookup.md](address-lookup.md) | R subset, A verification | `beta` | none |
| `ip-address` | [ip-address.md](ip-address.md) | R exits, ranges, geolocation and ASN; H VPN and hosting ASN; A proxy | `beta` | none |
| `custom-list` | [custom-list.md](custom-list.md) | R exact, CIDR and radius; H fuzzy names, backgrounds and IP-derived probes | `beta` | matches |

`crypto-address-watchlist` is `ga` because it matches canonical addresses exactly and every row of its format table has passing test vectors. Every other type stays `beta` until a calibration report exists; a heuristic result always carries its confidence and its reasons. The sandbox providers and the synthetic lists are in [the sandbox providers page](../checks/sandbox-providers.md#phase-6-reports).

## What a report says, and what it does not

A report's status is about processing, never about the result:

| Status | Meaning |
|---|---|
| `pending` | Created; its first run has not finished. |
| `ready` | Its latest run screened everything it was asked to. `has-match` is the result. |
| `errored` | Its latest run could not screen something. `errors` says what and, for a list, which source. The console shows "not screened", never "no match". |

`submitted` is reserved and no Phase 6 path uses it.

**`has-match: false` means "no match" only beside `ready`.** Report honesty (ADR 0005) is enforced by the run framework and the resource schemas:

- **A run screens what it can, keeps what it found, and errors for the rest.** When a selected source was never synced, is not configured, was disabled, is stale, or was keyed by another matcher version, the run ends `errored` with `list_unavailable`, `list_stale` or `matcher_data_unavailable` naming that source, and still keeps and alerts on the matches it found elsewhere. `filter[has-match]=false` lists only `ready` reports.
- **A cut-short search is not a "no match".** When candidate retrieval reached its cap, or GDELT filled its 250 records, and nothing matched, the run ends `errored` with `result_truncated`.
- **Unknown is never `false`.** A field the run could not decide, or that needs a provider that is not bound, is `null` and listed in `unavailable-fields` with its reason (`provider_not_configured`, `not_confirmed`, `not_linked`, `line_type_undetermined`, `unsupported_country`, `list_not_configured`, `undetermined`, `execution_error`, `no_adapter`, `no_documented_method`). Lists that are never searched (the business watchlist's warning and fitness-and-probity lists) are `null`, never empty arrays.
- **Coverage.** Every matching run says how completely it compared the subject's names: `coverage.complete`, and `coverage.limits` from a closed set (`lossy_script`, `not_compared`, `truncated`, `unclassified_format`, and for media `title_only`, `window_90_days`, `lexicon_languages`). A Han, Thai or Arabic name compared only through a lossy transliteration is `ready` with `lossy_script`, which says the answer is weaker, not wrong.
- **Provenance.** `sources` lists each list used with its sync id, publication time, last successful check, SHA-256, `origin` (`publisher`, or `import` for a file an operator loaded, which is never cited as the publisher's) and attribution line. `query-sources` says where each query field came from, `matcher-version`, `thresholds` and `provider` say what screened it, and a sandbox provider says `sandbox: true`.

### Errors

| Code | When |
|---|---|
| `insufficient_input` | The query lacks what the type needs (a completion report whose inquiry held no name, for example). |
| `list_unavailable` | A selected source has never been synced or checked, is not configured (no EU token, no Wikidata contact), or was disabled. An empty selection also gives it. |
| `list_stale` | A selected source has not been checked successfully within its stale limit or the template's `max-list-age-hours`, whichever is smaller. |
| `result_truncated` | The search reached its cap and found no match. |
| `matcher_data_unavailable` | The filtered variant groups are missing or not the shipped file, or a selected source was keyed by another matcher version. |
| `provider_not_configured` | A media report with no `adverseMedia` provider bound. |
| `provider_error` | The media provider failed on the last attempt, or a media run waited 24 h for its budget. |
| `execution_error` | The run failed on its last attempt for any other reason. |

## Creating reports

- **API:** `POST /api/v1/reports` with `{ data: { type: 'report/<type>', attributes: { 'report-template-id', query, 'account-id'?, 'inquiry-id'? } }, meta? }`. The query is checked against the type (422 `report_query_invalid` with pointers). Linking needs the linked resource's scope: `inquiry-id` needs `inquiries:write`, `account-id` and any `meta.auto-create-account-reference-id` need `accounts:read`. `meta.processing-mode: sync` waits up to 10 s for the first run. A media name that cannot be searched (no letter left, or a business name that is one generic word once its legal form is removed) is refused at creation.
- **Inquiry completion:** an inquiry template version may pin `report-config` (`on-completion`: up to ten report templates; `on-report-match`: `none` or `needs_review`). See [Reports on inquiry completion](#reports-on-inquiry-completion).
- **Console:** the reports pages (Workflow 6B).
- **In bulk:** `POST /api/v1/reports/bulk` creates up to 1,000 reports of one template from a CSV, recording every row created or failed with its code ([bulk.md](bulk.md); console: Bulk reports, Workflow 9C).

Templates (`/api/v1/report-templates`, `/api/v1/report-template-versions`) are versioned: creating a template publishes version 1, later versions start as drafts, and a report pins the version it was created from. An omitted `search-lists` is resolved into explicit source ids when the version is created and stored.

`seed:dev` creates one published template per type in each environment, named `Default <type>`:
- the sandbox templates of the list types select only the synthetic sandbox lists the seed imports, so a fresh stack answers `ready` without any download;
- the production templates select every enabled real source of their kind, and answer `list_unavailable` until you sync the lists (and set the EU token and the Wikidata contact): this is the honest answer, not a fault;
- the adverse-media templates answer `provider_not_configured` until a provider is bound.

## Lists and the operator's sync

List data is fetched by the operator, at run time, and verified instead of pinned (ADR 0005). It is never committed, never shipped in an image and never fetched by CI or a test.

| Source | Kind | Enabled by default | Refresh | Stale after | Notes |
|---|---|---|---|---|---|
| `ofac-sdn`, `ofac-consolidated` | sanctions | yes | 6 h | 48 h | US government works |
| `eu-fsf` | sanctions | yes | 6 h | 48 h | needs `OPENVERIFY_EU_FSF_TOKEN` (the EU catalogue's public token); credit the source (Decision 2011/833/EU) |
| `uk-sanctions-list` | sanctions | yes | 6 h | 48 h | Open Government Licence v3.0 |
| `un-sc` | sanctions | no | 24 h | 72 h | the UN site terms grant personal, non-commercial use only. This release has no setting that enables it: see below |
| `wikidata-pep` | pep | yes | 168 h | 192 h | needs `OPENVERIFY_WIKIDATA_USER_AGENT` with your own contact; Wikidata is CC0 |
| `openverify-sandbox`, `openverify-sandbox-pep` | sanctions, pep | sandbox only | never | never | synthetic and static; imported by `seed:dev` |

The committed manifest (`watchlists/sources.json`) gives each source's URLs, the one host a redirect may go to, content types, byte caps, deadline, parser, intervals, terms and attribution line. Each source's attribution line appears with every result that used it. `OPENVERIFY_WATCHLIST_SOURCES_DISABLED` (comma-separated ids) disables sources install-wide; every process reads it the same way at startup, and reports that selected a disabled source error `list_unavailable` (it never silently leaves a list).

**`un-sc` is enabled only by an environment admin's opt-in** (C254.1; owner decision Q10, granted 2026-11-21). The manifest ships it disabled, and no setting turns it on install-wide. While the install allows it (`OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`, true by default; false locks the list), an environment admin (`settings:write` and `settings:privacy`, with a second factor verified within the step-up window) opts that environment in with `POST /api/v1/dashboard/watchlist-sources/un-sc/opt-in` and an acknowledgement naming the UN's terms link from the manifest (`{"acknowledgement": {"terms-url": "<the manifest's terms.url>", "accepted": true}}`); the acceptance is stored with the user and time and audited (`watchlist-source.opt-in-accepted`), and `DELETE` on the same path withdraws it (`.opt-in-withdrawn`). The next reconcile (the API's and the worker's start, each `watchlists:sync`, or the refresh tick) then enables the row, and `watchlists:sync --source un-sc` downloads the list. A template that pins `un-sc` screens it only for an environment that opted in; any other environment's report errors `list_unavailable` for it. With the install switch false, every opt-in answers 409 `watchlist_source_locked` and `un-sc` stays disabled, as Phase 6 left it. The OFAC, EU and UK lists carry most UN designations.

```bash
pnpm --filter @openverify/api watchlists:sync [--source <id>] [--import <file> --source <id>] [--allow-mass-removal] [--accept-older-publication] [--allow-normalised] [--json]
pnpm --filter @openverify/api pep:sync [--import <file>] [--json]
pnpm --filter @openverify/api watchlists:rekey [--source <id>] [--json]
```

- Each command reconciles the source rows first, prints one line of counts and codes per source (never a list value) and exits 1 unless every source applied, stayed unchanged or was re-keyed.
- A sync takes a per-source lock (`busy` when another sync holds it), downloads over HTTPS through the vetted lookup with at most one redirect to the manifest's exact host, on the request's own scheme and port (a redirect to another port is refused like one to another host; owner decision 20 after Workflow 6B), hashes and parses the same file, validates every record and applies under the lock. It refuses, keeping the previous data, a publication older than the last applied one (`refused_rollback`, unless `--accept-older-publication`), one dated more than 24 h ahead (`refused_future`), one that removes more than 10% of the entries (all of a source under 100; `refused_mass_removal`, unless `--allow-mass-removal`), one with no entries at all, a source's first publication included (`refused_schema`, unless `--allow-mass-removal`: no publisher's list is empty, and an empty source would read fresh and clear every subject), a bad schema (`refused_schema`), an oversize file (`refused_size`) and a sync without the variant groups (`refused_matcher_data`). Every sync, refusal and override is written to `watchlist_syncs` and shown on the sources page.
- `--import <file>` loads a local file with the same checks and records `origin: import`; it makes no request, so it needs no token or User-Agent. A file in the source's own format is accepted for any source; the normalised JSON only for the sandbox lists, or with `--allow-normalised`. Imports are how tests, the e2e and air-gapped operators load lists.
- **Every check downloads the whole file** and compares its SHA-256 with the last applied one, so `unchanged` costs a download. No publisher change signal is read, by design (owner decision 10 after Workflow 6B): a signal that failed to move would mark a changed list fresh, which is the false "no match" ADR 0005 guards against, while the SHA-256 comparison is always right. An HTTP conditional request (ETag or Last-Modified), where a publisher serves one, is carried to Phase 11 as an optional saving, and its `200` would still go through the SHA-256 comparison. A first import of a 100,000-name list takes about a minute.
- **Freshness counts from the last successful check**, not the publisher's last change, so a quiet publisher (OFAC over a weekend) stays fresh while checks succeed, and failed checks turn it stale. Turn on the refresh job (`OPENVERIFY_WATCHLIST_REFRESH=true`: a 15-minute tick that syncs each enabled source whose refresh interval has passed since its last check), or schedule the CLI more often than the stale limits. A source whose check fails (a download error or a refusal) backs off: the tick asks it again 15 minutes after the first failure, then after 30, 60 and so on, doubling, but never waits longer than the source's refresh interval or 24 hours (owner decision 6). `watchlist_sources.check_failures` counts the failures and `last_failed_at` dates the last one. The first good check resets both. A source that is not configured asks nothing, so it does not back off. The CLI never backs off. A failing source still turns stale at its limit, whatever the back-off.
- **Upgrades:** the stored name keys, normalised identifiers and canonical crypto addresses depend on the matcher version and the variant groups. After an upgrade that changes them, reports selecting a source keyed by the old version error `matcher_data_unavailable` until `watchlists:rekey` (or the next sync, or the refresh tick) re-keys it. See [Upgrading to Workflow 6C](#upgrading-to-workflow-6c) for the steps this release needs.
- **Variant groups:** the cross-script name groups come from rigour's `person_names.txt`, pinned in `data/manifest.json`. Run `python3 scripts/fetch_data.py`, then `pnpm --filter @openverify/watchlist build:variant-groups`, which writes the filtered `data/variant-groups.json` and refuses any file but the shipped digest. The apps image carries that file and checks its digest. Without it, person-name reports error `matcher_data_unavailable`, `seed:dev` skips the sandbox lists with a warning, syncs refuse, and the worker says so once at start.
- Removed entries are purged `OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS` (90) after their removal.

### What a list entry holds

Every parser writes one normalised record per publisher entry (`watchlist_entries.data`, plan C77.1): its names with their parts, script and quality, birth dates and places, countries with their roles, gender, identifiers, addresses, crypto addresses, programmes, the listing date, and for PEPs their positions and family links. Two hashes are kept per entry (C77.3): the **content hash** over what matching reads, which a dismissal is tied to, and the **risk-data hash** over the programmes, the listing date, the PEP positions and the family links, which `notify-on-change` compares.

- **Weak aliases.** A name's `quality` is `weak` for OFAC's low-quality AKAs (`isLowQuality`), and also from the UN `QUALITY`, the EU `strong` flag and the UK `AliasStrength`. Strong names are keyed and scored; a weak one matches only by exact equality, only with `screen-weak-aliases: true`, and with the reason `weak_alias`, so reviewers see weaker evidence. There is no separate alias-quality member: it would duplicate `quality`.
- **`list_memberships`** (owner decision 9 after Workflow 6B): each OFAC list an entry is on other than the SDN List, as `{ list, program }`, for the entries of OFAC's Consolidated (non-SDN) lists, so a sectoral or other non-blocking listing is never shown as an SDN-level block. OFAC's file names an entry's lists and programmes side by side and ties no programme to a list, so `program` names a programme only when the entry is on that one list alone, and is `null` otherwise; every programme stays in `programs`. An entry on the SDN List alone has no member.
- **`relative_of_class`** (owner decision 9 after Workflow 6B): on a PEP relative (synced only with `OPENVERIFY_PEP_INCLUDE_RELATIVES=true`), the class of the PEP it relates to, the most senior when it relates to several, derived from the holders on every PEP pass. So the PEP report's class filter can take a relative's class from its own record ([the PEP page](politically-exposed-person.md) says how it does), and a holder's reclassification reaches its relatives as a change of risk data.
- Both members are risk data. They enter the risk-data hash only when an entry carries them, and never the content hash, so they change no score, an entry without them keeps both hashes, and no dismissal lapses because of them.

### Upgrading to Workflow 6C

After upgrading to this release, do the first two steps once:

1. **Re-key every source.** Workflow 6C changes the watchlist keys (`KEYS_VERSION` `names-2`: token-pair keys, key frequencies counted over entries) and the scorer (`scorer-2`: an adjacent transposition is one typo), and the variant-group file now carries rigour's MIT notice, so its SHA-256 becomes `29d0583854563f81084c05d78b5ea8805ca14630cbf655349cfa09fca84c3bfb`. After upgrading, rebuild the file (`python3 scripts/fetch_data.py`, then `pnpm --filter @openverify/watchlist build:variant-groups`) and run `pnpm --filter @openverify/api watchlists:rekey` (or let each source's next sync re-key it first). Until a source is re-keyed, screenings report `matcher_data_unavailable` for it instead of screening it. Re-keying 2,000,000 names took about 40 minutes on the development machine. The Workflow 6C calibration kept these changes (`docs/calibration/watchlist-phase6c.md`; owner decisions 1, 4 and 19 after Workflow 6B).
2. **Expect one re-screen after the first sync.** On the first sync of `ofac-consolidated` after the upgrade, every entry gains its `list_memberships`, and on the first `pep:sync` with relatives every relative gains its `relative_of_class` (the sandbox PEP list's relative too, when `seed:dev` imports it again). Each is a change of risk data: the entry gets `changed_sync_id` and is re-screened once, and a reviewed match on it with `notify-on-change: true` returns to `pending` once, with `.matched`, which is what a change of risk data means. Entries without the members (SDN-only entries, the EU, UK and UN lists, PEP holders without family links) keep both hashes and are neither rewritten nor re-screened, and no dismissed match lapses.
3. **Read the new evidence and history.** From this release, every run writes the two members into the evidence of the matches it creates or re-scores, and the API serves them: `list-memberships` on a person, business or crypto entity of an entry on an OFAC list other than the SDN List, and `relative-of-class` on a PEP relative's entity. A match on an entry that gains a member is re-scored by the run after the first sync above, because the member is a change of risk data. Neither member enters the evidence hash, so no dismissed match lapses because of them; the risk-data change of step 2 is the only alert they cause. A redaction now also writes a `redact` action naming who redacted the report (see [Privacy](#privacy)).

## Monitoring

A template with `recurrence-interval-days` (1–365; recurrable types only) makes its reports recur. A sweep every 15 s enqueues due runs, inserts one scheduled run per due report (an outage of several intervals gives one catch-up run, and the schedule does not drift), and recovers lost re-screens. After a sync adds or changes entries, a re-screen screens each changed entry against the recurring reports of every environment that selects the source, each at the configuration its version pins (the preset, the filters, the PEP classes), and gives a `list_update` run to each report whose own screening would keep a match on a changed entry, or cannot decide from the entry alone (a PEP relative stored without its class). It also gives a run to each report with an open or delisted match on a changed entry, so that evidence is re-scored (owner decision 3 after Workflow 6B). A `list_update` run screens its trigger sync's changed entries beside its search, so it finds whatever the re-screen found; a run that finds nothing new sends nothing. Removed entries mark open matches `delisted` on the next run.

`pause` (a recurring report), `resume` (a paused one: when a selected source changed during the pause, a run is due at once) and `run` (a manual run, also while paused) each write an action. With `pause-on-match: true`, a run that brings a new open match pauses the report until every open match is reviewed, then resumes after `resume-delay-minutes`. By default monitoring continues through a hit.

## Review

Types with review keep their matches as rows. `POST /reports/:id/dismiss` (`reports:review`, a reason of 1–500 characters) dismisses the open matches, or one entry's with `entity-id` (one article with `dismiss-type: media`). `POST /reports/:id/review` sets `review-status` (`pending`, `indeterminate`, `true_positive`, `false_positive`), `risk-level` and `notify-on-change` on one match (`record-token`, its `rpm_` id) or every open one. A `false_positive` needs a comment and dismisses.

- A dismissed match stays suppressed while the list entry's matched identity is unchanged; when the entry changes (a new name, birth date or identifier), it lapses into a new open match with `lapsed-from` and `.matched`. A new programme or PEP position never lapses a dismissal.
- A reviewed match with `notify-on-change` returns to `pending` with `.matched` when its identity or its risk data (programmes, listing date, PEP positions and relations) changes.
- Only a person, or the entry leaving its source, closes a match. An open match that a later run does not find stays open with `present-in-last-run: false`; a match whose entry is removed becomes `delisted`.
- There is no organisation-wide ignore list.

## Reports on inquiry completion

When an inquiry moves `pending → completed`, or a failed inquiry is approved or sent to review, each `on-completion` entry of its pinned `report-config` creates a report from the template's published version at that moment (an archived template still runs), linked to the inquiry, with `origin: inquiry_completion`. The sweep runs it within 15 s; its first run links the inquiry's account. The query is built from the verified data first: the latest government ID extraction decided passed or in review, then the inquiry's fields, then the account's fields, each differing name screened as `additional-names` (at most three); the confirmed OTP destination for email and phone; the passed crypto wallet; the passed business registry record. The identification number is not taken from the ID extraction, because the extraction does not say which type it is. `query-sources` records each field's source. A missing input still creates the report, whose run errors `insufficient_input`.

`on-report-match: needs_review` sends a `completed` inquiry to review when a run first brings a match **or the initial run ends `errored`** (a report that could not screen is not clear). The run records `report_match` or `report_errored`. A decided inquiry is never changed; the run records `inquiry_already_decided`.

**The completion window.** An operator who decides an inquiry between its completion and its reports' runs decides without them: the window is the sweep's 15 s, plus the run, plus any wait for the GDELT budget, which can reach 24 h on an overcommitted install. Approving a failed inquiry always decides before its reports run, so mark it for review first and approve once the reports are in.

The recurring and media caps (below) apply to a completion report at its initial run: beyond either, it runs once without a schedule and its run records `recurring_limit`.

## Limits

| Limit | Default | Variable |
|---|---|---|
| Report creations and `run` calls per environment | 600 a minute (429 beyond) | `OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE` |
| Recurring reports per environment | 250,000 (422 `report_recurring_limit`) | `OPENVERIFY_REPORTS_MAX_RECURRING_PER_ENVIRONMENT` |
| Scheduled media runs per day per environment | 8,640 (half the GDELT budget) | `OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY` |
| Waiting `sync` creations per environment | 20 | — |
| GDELT requests, install-wide | one per 5 s (17,280 a day), shared among the environments waiting for it | — |

## Privacy

Screening data is personal data, and adverse media can be data about criminal offences (GDPR Art. 10).

- Every report attribute derived from the subject is PII: masked without `pii:view`, at every exit (the resource, lists, includes, events, the dashboard documents and the stored API-log bodies of create, dismiss and review). Viewers see reports with PII masked.
- The query, the non-match result, every match's evidence and every action's reason and comment are sealed at rest. A match row keeps the list entry only as an HMAC under the environment's blind-index key.
- `DELETE /reports/:id` (`reports:redact`) redacts a report: it nulls the query, the result, every match's evidence and index and every action's text, cancels monitoring and fires `.redacted` once, and writes a `redact` action naming who redacted it (the user or API key, or `system` for the inquiry and account cascades and retention), which the report's history serves (owner decision 12 after Workflow 6B). Redacting an inquiry or an account redacts its reports.
- **Set `report-retention-days`** (1–3,650) in each environment's settings: reports past it are redacted by the daily retention job. The default (null) keeps reports as long as inquiries are kept.
- No screened name, matched name or article title is written to Valkey. The GDELT budget keeps environment ids and times only; DNS and RDAP answers of email reports stay in the worker's memory.
- **Postgres statement logging:** candidate retrieval binds the subject's name tokens as query parameters. Compose and the tests start Postgres with `log_parameter_max_length=0` and `log_parameter_max_length_on_error=0`. If you turn on statement or duration logging with parameters, screened names reach the server log, outside redaction and retention.
- **Lawful basis.** Screening people against sanctions, PEP and media sources, and sending their data to the adapters below, needs a lawful basis and often a data protection impact assessment. That is the operator's responsibility; OpenVerify takes no position, and nothing here is legal advice.

## What each adapter receives

Every adapter is unbound by default and is bound per environment kind in the worker (`OPENVERIFY_PROVIDER_<KIND>_{SANDBOX,PRODUCTION}`). A sandbox provider bound to production stops the worker. Before binding one, check that you have a basis for sending it the data below.

- **GDELT (`adverseMedia: gdelt-doc`).** Every screened name, reduced to letters and digits inside one quoted phrase, with the category terms and, when the query has one, a country filter, goes to the GDELT DOC 2.0 API (`api.gdeltproject.org`). Binding it needs `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true`, or the worker refuses to start. Results cite GDELT, as its terms ask. Only the article URL, domain, date seen, language, source country and a 200-character title are kept, never cached.
- **Have I Been Pwned (`emailIntelligence: hibp`).** The email address goes to the HIBP breached-account API with your own key (`OPENVERIFY_HIBP_API_KEY`). HIBP treats addresses submitted through its API as Subscriber Data; use a plan whose terms allow screening your users.
- **Twilio Lookup (`phoneIntelligence: twilio-lookup`).** The phone number goes to Twilio Lookup v2 (line type intelligence and SIM swap) with credentials of the worker's own (`OPENVERIFY_TWILIO_LOOKUP_*`), separate from the API's SMS credentials. Twilio's SIM swap package needs carrier approval.
- **Smarty (`addressVerification: smarty`).** Only US addresses are sent, as their normalised components, to the US Street API (`OPENVERIFY_SMARTY_AUTH_ID`, `OPENVERIFY_SMARTY_AUTH_TOKEN`). The addressee is sent only when the template sets `send-addressee: true`. Any other country is answered `unsupported_country` and nothing is sent.
- **Crypto exposure (`cryptoExposure`).** Only a sandbox provider exists in Phase 6.

## Evaluation

Every test, fixture and evaluation uses synthetic people, companies and lists only. The matcher's constants are provisional and were not tuned on the evaluation set; the evaluation report (Workflow 6B, `docs/calibration/watchlist-phase6.md`) publishes recall per variant source, precision and alerts per 1,000 synthetic customers, and synthetic variation is not real-world variation.
