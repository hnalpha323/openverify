# Phase 6 plan: resolution of the three reviews

Section numbers refer to the revised `phase-6.plan.md` (contracts C69–C89; decisions 1–61, of which 56–61 come from the verification round at the end of this record). Three adversarial reviews read the first draft: privacy and security (P), honesty and product coverage (H), and feasibility and fit with the code (F). They found 62 problems: no CRITICAL, 16 HIGH, 36 MEDIUM and 10 LOW.

The repo facts each finding relies on were re-checked at `d797da0` before acting, read-only. They are listed in the plan's Starting point under "Facts the review relied on". The checks covered:
- the `audit_logs` triggers (`0001_schema_v1.sql:314-320`, `0003_schema_v2.sql:484-492`);
- the API-log masking (`services/api-logs.ts:202-236`) and the developer role (`permissions.ts:103-122`);
- the C14 filter rule (`repositories/webhooks.ts:385-390`) and `eventFilterSubjects`;
- the order in which `transitionInquiryInTx`, consolidation and the simulate action take their locks (`simulate.ts:38` locks the inquiry first);
- the account redaction catch-up;
- the samples, the dashboard event-group test and Android's `ContractFixturesTest`;
- `RepeatableJob`, the job options and the outbound deadline;
- `.dockerignore`, `migration-v2.test.ts`, `INCLUDE_PERMISSIONS`, `assertPublishable` and the private ICAO §6.A table.

One finding's evidence has drifted since it was written. `MASKED_MEMBERS` now also holds `phone-number` and `email-address` (commit `272c9fb`), but P04 still stands.

Several findings describe the same defect, and one fix covers each group:
- P02 and F03;
- P10, H18 and F13;
- P11 and F05;
- P13 and H09;
- H02 and F02;
- H20 and F20.

| Review | Findings | HIGH | MEDIUM | LOW | Resolved | Partly | Deferred | Rejected |
|---|---|---|---|---|---|---|---|---|
| Privacy and security (P) | 18 | 4 | 10 | 4 | 18 | 0 | 0 | 0 |
| Honesty and product coverage (H) | 23 | 8 | 14 | 1 | 23 | 0 | 0 | 0 |
| Feasibility and fit (F) | 21 | 4 | 12 | 5 | 21 | 0 | 0 | 0 |
| **Total** | **62** | **16** | **36** | **10** | **62** | **0** | **0** | **0** |

Eleven of the resolved findings, covered by eight fixes, take a different route from the reviewer's proposed fix. They are marked "resolved (another route)", and the evidence for each fix is under "Fixes that take another route".

## Privacy and security

| Id | Sev | Title | Disposition | Where in the plan |
|---|---|---|---|---|
| P01 | HIGH | Redaction leaves the match link, its qualifiers and two blind indexes, which re-identify the subject | resolved | C73.2 (`entry_index` is an HMAC under the environment subkey, label `openverify/report-match-entry/v1`; the readable key, the content hash and the qualifiers live in the sealed snapshot; only `source_id`, `score` and the statuses stay plain); C73.4 (the rebuild works from stored values and skips redacted rows); C73.5 (redaction nulls `entry_index`, `evidence_hash` and `crypto_address_index`; a column-scan test); decision 36 |
| P02 | HIGH | An append-only trigger "as `audit_logs`" makes report, inquiry and account redaction fail | resolved (another route) | C73.2 (UPDATE is allowed only for the rewrap of `details`, or for `details` → null under a transaction-local redaction flag, with every other column unchanged; DELETE is refused except under an explicit environment-deletion flag; a test per case, a cascading inquiry redaction among them); decision 37. Same fix as F03 |
| P03 | HIGH | The GDELT cache holds titles that contain the screened name, unsealed and across tenants | resolved | C81.2 (no article cache; a Valkey scan of every key and value on the `sandbox-media` path); decision 38 |
| P04 | HIGH | Dismissal and review text and entity ids reach the developer role through API logs | resolved (another route) | C70.3 (`reason`, `comment` and `entity-id`, and the history's `reason` and `comment`, are PII-marked attributes; tests on the stored bodies of create, dismiss and review); C72.1, C75.2 and C75.5 (the bodies sit under `data.attributes`, so the API-log attribute set masks them) |
| P05 | MEDIUM | `reports:write` alone can link any inquiry, move it, and probe its OTP-confirmed contact | resolved (another route) | C72.2 (`inquiry-id` needs `inquiries:write`; an existing account needs `accounts:read`; a test per refusal); C70.2 and C73.2 (`origin`); C84.3 (completion reports only); C82.1 and C82.2 (the OTP-based fields only for completion reports, `not_linked` otherwise); decision 39 |
| P06 | MEDIUM | Report creation is outside the lock order and never checks `redacted_at` | resolved | C72.1 (410 `redacted`); C73.7 (creation is a writer: it share-locks through `lockAbsorbingAccount`, then the inquiry, and re-checks `redacted_at`); C74.6 (race tests against inquiry and account redaction) |
| P07 | MEDIUM | The rollback and mass-removal guards run before the per-source lock; the temp file is shared | resolved | C76.2 (a session-level `pg_try_advisory_lock` with `busy`; both guards re-checked against the locked source row in the apply transaction; a private `mkdtemp` directory per run; one file descriptor hashed and parsed; tests); C73.3 (`busy`) |
| P08 | MEDIUM | `--import` takes any `published_at`, and provenance cannot tell imported data from publisher data | resolved | C76.2 (`refused_future` beyond now plus 24 h; `origin: import` in `watchlist_syncs`, on the source row and in every report's provenance; the normalised format only for the sandbox sources or with `--allow-normalised`; an audited `--accept-older-publication`); C73.3; C69.4; decision 44 |
| P09 | MEDIUM | Per-key limits only: one tenant can exhaust the GDELT budget and grow the re-screen index | resolved | C72.5 (a `reports` policy per environment, at most 20 waiting `sync` requests, a cap of 250,000 recurring reports with `report_recurring_limit`); C81.2 (a per-environment share; a run waits through `not_before`); C74.4 and C78.6 (chunks of 50,000 subjects); decision 40 |
| P10 | MEDIUM | `blind-index:rebuild` cannot recompute the evidence hash | resolved (another route) | C73.2 and C73.4 (the content hash at match time is kept in the sealed snapshot; the rebuild uses stored values only and skips redacted rows; a key-rotation lapse test); C75.3 (a JSON array frames the HMAC input). Same fix as H18 and F13 |
| P11 | MEDIUM | Run claims expire without fencing, and a crashed `running` run is never picked up | resolved | C74.1 (a claim token; completion fenced under the report lock; a `running` run with an expired claim can be claimed again; tests); C74.3 (a); C74.6. Overlaps F05 |
| P12 | MEDIUM | The PEP mirror stores relatives, minors included, and open-ended positions never age out | resolved | C80.3 (`OPENVERIFY_PEP_INCLUDE_RELATIVES`, default false; no relative under 18 or without a birth date); C80.2 (the open-ended tenure rule with `end: unknown`); decision 52 |
| P13 | MEDIUM | A production template can select the sandbox list, and the report cites it as screened | resolved | C71.2 (422 `watchlist_source_not_allowed`; defaults resolved per environment kind and pinned); C72.4; C76.6 (a provenance test); the C69.4 tests. Overlaps H09 |
| P14 | MEDIUM | No agent owns the enforcement of `report-retention-days` | resolved | C73.6 (Stage 1b builds the retention step and `listReportsDueForRetention`; `api-reports` implements `redactReportInTx`; Testcontainers tests); Workflow 6A Stage 1b |
| P15 | LOW | Masked viewers see `email-domain` and the typo suggestion | resolved | C70.3 and C82.1 (both become PII; the non-PII `email-domain-kind` takes their place); C86; decision 41 |
| P16 | LOW | Adapters send more than they need: the addressee and non-US addresses go to Smarty | resolved | C82.3 (`send-addressee`, default false; US addresses only, others answer `unsupported_country`; a stub test); C83 (a disclosure section per adapter); C87; decision 42 |
| P17 | LOW | The PII name `query` collides with the non-PII `api-log.query` | resolved (another route) | C70.3 (the collision test walks every resource schema and records one exemption, `api-log.query`; the report keeps the public name `query`) |
| P18 | LOW | Candidate retrieval sends name tokens to Postgres, whose statement logs can capture them | resolved | C73.8 (`log_parameter_max_length=0` and `log_parameter_max_length_on_error=0` in compose and the Testcontainers helper; an infra check; a docs warning); Workflow 6A Stages 1b and 4; decision 43 |

## Honesty and product coverage

| Id | Sev | Title | Disposition | Where in the plan |
|---|---|---|---|---|
| H01 | HIGH | A stale source beside a hit: the plan neither keeps the hit nor prevents a later "no match" | resolved | C69.4 (the partial-run rule: matches are kept and `.matched` fires, and the run ends `errored` naming each unscreened source; `filter[has-match]=false` returns only `ready` reports; tests); C72.1; C75.6 (an errored report that kept matches can be reviewed); C86 ("not screened"); decision 47 |
| H02 | HIGH | Staleness counts from the last applied change, so a quiet publisher errors every report | resolved | C76.3 (freshness from `last_checked_at`, set by both `applied` and `unchanged` syncs); C76.1 (intervals per source); C71.2 (a PEP default of 192 h); C73.3; tests; decision 46. Same fix as F02 |
| H03 | HIGH | `on-report-match: needs_review` lets an unscreened inquiry stay `completed` | resolved | C84.3 (an errored initial run also sends the inquiry to review; `inquiry_already_decided` is recorded and shown; the window is documented; tests); C84.2 (a missing input errors in the run, never inside the completion transition); decision 48 |
| H04 | HIGH | The completion trigger screens the typed name before the verified one, and four types have no input source | resolved (another route) | C84.2 (the query-source table: the ID extraction first, with every differing name screened as `additional-names`; the OTP destinations, the wallet and the KYB record; `query-sources` provenance; tests); C70.2; C79.1, C80.5 and C81.5 (`additional-names`); decision 49 |
| H05 | HIGH | `not_compared` lives only on match rows, so a cross-script miss stays silent | resolved | C78.5 (a `coverage` record per run and per report, with `limits[]`; tests); C78.2 (Arabic ICAO output is lossy unless the entry carries the Arabic original); C70.2; C69.4; C86; Risks |
| H06 | HIGH | An identifier hit counts only when the name already scores 0.70, and identifiers are never retrieved | resolved | C78.3 (an identifier retrieval path); C78.4 (an identifier match whatever the name score; vessels and aircraft searched by identifier whatever `entity-kinds` says); C79.1 and C79.2 (the identifier query fields) |
| H07 | HIGH | The email rule can answer `high` for a domain that does not exist or did not answer | resolved | C82.1 (the research band table with confidences and reasons; `null` when an `execution_error` blocks a hard reason; `min-domain-age-days` 30 and `young-domain-days` 365; a bound breach gives `medium`; tests) |
| H08 | HIGH | Every US and Canadian number is `OTHER`, and the risk rule is undefined | resolved | C82.2 (`phone-type: null` with `phone-type-numbering-plan` and `line_type_undetermined`; the risk table with confidences; a bound network line type replaces the plan type); C82.3 (`cmra-hint`, ours only); decision 51 |
| H09 | MEDIUM | "Every enabled source" is not pinned, so disabling a source silently shrinks coverage | resolved | C71.2 (resolved into explicit ids at create and publish and pinned; the sandbox default includes the sandbox list; production refuses sandbox-only sources); C76.4 (the sources page names the affected templates); C71.3 (explicit seed lists). Overlaps P13 |
| H10 | MEDIUM | The weak-alias rule cannot fire as written, and its toggle has no defined effect | resolved | C78.4 (a rule of its own: corroborated by `dob_exact` or an identifier, under every preset, at a fixed 0.90, with `weak_alias`); C78.3 (looked up only with `screen-weak-aliases: true`); decision 16 |
| H11 | MEDIUM | The presets borrow the public names but not their rules, and joined names are not scored | resolved | C79.1 (each preset is a rule set plus a minimum); C78.4 (the joined and subset rules); C79.2 (business default `strict`); decision 50 |
| H12 | MEDIUM | Truncated searches are reported as complete | resolved (another route) | C81.2 (250 records; one re-query with `sourcecountry:`; `truncated`, and `result_truncated` when nothing matched); C78.3 and C78.5 (the candidate cap recorded, with `result_truncated`); C78.7 (how often the cap binds); C69.3; decision 53 |
| H13 | MEDIUM | An adverse-media "no match" covers titles in four languages over 90 days, and says none of this | resolved | C81.5 (a coverage notice and `coverage.limits`); C81.3 (the business-name rule; a single generic word is refused); C81.4 (`seen-date`); `dated-articles-only` dropped |
| H14 | MEDIUM | PEP class numbers cover other people than the public classes; open-ended positions have no rule | resolved | C80.2 (the public class numbers; heads of international organisations in class 2; the open-ended tenure rule; `in-office`); C80.3 (relatives carry the linked PEP's class and the relation); C80.5 (the public result shape); C69.5 (the toggles and the shape recorded); C88; decision 52 |
| H15 | MEDIUM | Empty warning and fitness-and-probity arrays say "no match" for lists never searched | resolved | C79.2 (`null` with `list_not_configured` in `unavailable-fields`); decision 18 |
| H16 | MEDIUM | Listed addresses on chains outside C57 cannot be screened, yet the type can reach `ga` | resolved | C79.3 (a format table: 256 characters, URI stripping, CashAddr, an exact raw match for the other formats, `unclassified_format`); C69.1 (the `ga` condition is the table's test vectors) |
| H17 | MEDIUM | The match review state machine is undefined | resolved | C75.8 (a transition table, one test per row); C75.5 (`all_records` applies to open matches only); C70.2 (`has-match` restated); C73.2 (at most one open or delisted row per entry) |
| H18 | MEDIUM | Rebuilding evidence hashes cannot reproduce the dismissed content | resolved (another route) | C73.4 (the content hash in the sealed snapshot; the rebuild uses stored values only; the key-rotation lapse test). Same fix as P10 and F13 |
| H19 | MEDIUM | Paused reports miss list updates, and resume does not catch up | resolved | C74.5 (resume inserts a run at once when a selected source changed after `paused_at`; a test); C74.4 |
| H20 | MEDIUM | No test proves most honesty rules, and the lapse e2e cannot fail | resolved | C69.4 (a tests paragraph); C75.4 (the subject branch is dropped because a report's query never changes); C89.2 (the real lapse path in `report-monitoring.spec.ts`); C88 (re-screening on account changes, Phase 7). Overlaps F20 |
| H21 | MEDIUM | The held-out set comes from the matcher's own variant table, and the matcher's author can read it | resolved (another route) | C78.8 (cross-script variants from the tenth of the groups that the `--hold-out` evaluation build drops and from `fixtures-6`'s own transliteration rules; recall per variant source; the cases generated by `evaluation-6` from its own seed and never committed); C78.3; Rules ("Independence of the evaluation") |
| H22 | MEDIUM | Public request shapes are refused, and no parity table records the divergences | resolved | C72.1 (`account-id`, `data.attributes`, `auto-create-account` default true, `reference-id` refused); C75.2 and C75.5; C79.1 and C79.2 (`address-country-code`; `flag-code`, `list-types[]` and list-level `match-types`); C70.2 (`transaction` null); C69.5 (the parity table); decision 55 |
| H23 | LOW | A redacted report is 409 in one section and 410 in two others | resolved | C72.4 (`report_not_reviewable` no longer lists redacted; `report_redacted` 410 for every route that changes the report); C75.6; C73.5 |

## Feasibility and fit

| Id | Sev | Title | Disposition | Where in the plan |
|---|---|---|---|---|
| F01 | HIGH | Stage 1b is larger than Phase 5's, which did not finish, and both Workflows already use ten agents | resolved | Complexity (the choice and its alternative recorded); C85 (each consumer builds the logic: `api-watchlists` writes `http/stream.ts`, `api-providers` writes `dns/txt.ts` and `providers/domain-age/registered-domain.ts`); C77 and Stage 1a (the record frozen in Stage 1a); Workflow 6A Stage 1b (plumbing only); Risks |
| F02 | HIGH | Staleness counts from the last applied sync, so default reports error every weekend | resolved | C76.3, C76.1 and C71.2, with the test that every seeded template publishes (C71.3). Same fix as H02 |
| F03 | HIGH | An append-only trigger "as `audit_logs`" makes redaction and the KEK rewrap fail | resolved (another route) | C73.2. Same fix as P02 |
| F04 | MEDIUM | The completion hook locks the inquiry before the account, the reverse of consolidation | resolved | C84.2 (the reviewer's option (b): completion reports link only the inquiry, the initial run links the account, and the run computes `crypto_address_index`); C73.7; C73.5 (the account redaction catch-up); C72.1 (410 for a redacted account); C74.6 (race tests). Option (a) was not taken: the simulate action locks the inquiry before it calls `transitionInquiryInTx` (`services/simulate.ts:38`), so locking the account inside the transition would still come after the inquiry |
| F05 | MEDIUM | A crashed run, or one that used up its job attempts, stays `running` or `pending` | resolved | C74.1 (an expired `running` run can be claimed again; a final-failure handler; tests); C74.3 (a) (`enqueued_at` limits re-adding). Overlaps P11 |
| F06 | MEDIUM | After an outage the sweep inserts one run per missed interval | resolved | C74.3 (b) (one scheduled run per due report; `next_run_at` moves to the first boundary after now; a report with a pending or running scheduled run is skipped; a frozen-clock test) |
| F07 | MEDIUM | No agent owns the inquiry-template side of `report-config` | resolved | C84.1 (Stage 1b stores the column through the repository and the service and passes it to `assertPublishable`; `services/publish/report-config.ts` belongs to `api-reports`; `report_template_not_published` at its pointer; an archived template still runs); C72.4; Workflow 6A |
| F08 | MEDIUM | Including reports on inquiries and accounts needs never-edit files, and no hook exists | resolved | C70.5 (`INCLUDE_PERMISSIONS.reports` in Stage 1a; the account `include` frozen in Stage 1b; the `includedReportsFor` stub implemented by `api-reports`); Workflow 6A |
| F09 | HIGH | Stage 1a's new event names and fixtures break three existing suites | resolved | C70.4 (samples keyed by report resource type with a correct `.redacted` sample, the dashboard "Report" group and its test, and Android `serverOnly` entries, all in one commit); Workflow 6A Stage 1a; `api-reports` owns `webhooks/samples.ts` afterwards |
| F10 | MEDIUM | The planned webhook-filter rule contradicts how C14 works, and no agent owns the change | resolved | C70.4 (strict filters for report subjects in `eventFilterSubjects`, with the account's type resolved; other subjects unchanged; tests); Stage 1b; decision 45 |
| F11 | MEDIUM | The seed and the re-screen write through another agent's code, and the seeded sandbox templates error | resolved | C71.3 (`seed/report-templates.ts` belongs to `api-reports`; the sandbox templates select only the sandbox lists); C74.4 (`insertListUpdateRuns`); Stage 1b (the cross-agent writes); decision 14 |
| F12 | MEDIUM | The normalised record is built in Stage 2 while its consumers build against it | resolved | C77 (Stage 1a freezes the record, the import format and `contentHash` with golden vectors); Workflow 6A Stages 1a and 2 (`watchlist-ingest` no longer owns `record/`, which joins the shared-file list) |
| F13 | MEDIUM | `blind-index:rebuild` cannot recompute evidence hashes | resolved (another route) | C73.2 and C73.4. Same fix as P10 and H18 |
| F14 | MEDIUM | The variant-group data cannot reach the worker image, and nothing defines its absence | resolved | C78.3 (`matcher_data_unavailable` when the file is absent or its hash differs; a test); Workflow 6A Stage 4 (`integration-6a` owns `.dockerignore` and the image-context test); C69.3; decision 54 |
| F15 | MEDIUM | Nobody owns measuring the e2e suite or raising its time limits | resolved | C89.2 (`integration-6a` measures, then raises the timeouts or shards; `fix-api` measures again in 6B; the second inquiry goes through the simulate action; a time line per spec); Workflow 6A Stage 4; 6B Stage 4 |
| F16 | LOW | A second PGlite instance also runs every migration | resolved | C73.1 (`PGLITE_EXTENSIONS`, used by `testing.ts` and `migration-v2.test.ts`) |
| F17 | LOW | `report-rescreen` is not a repeatable job, and the CLI needs a producer | resolved | C85.4 and C74.4 (an on-demand queue with producers in the CLI and the seed; two repeatable jobs); C76.2 (the refresh as a 15-minute tick) |
| F18 | LOW | The streaming and Wikidata clients have no deadline beyond the 10 s default | resolved | C76.1 (`timeout_seconds`: 300 s per list file, 75 s per query); C85.1 (a whole-request deadline plus a 30 s idle timeout; tests); C80.1 |
| F19 | MEDIUM | Two files have two would-be editors | resolved | Workflow 6B Stage 1 (the settings field moves to `dashboard-reports`); C83 and Stage 1b (the crypto hook's `cryptoExposure` step; `api-providers` delivers only the provider) |
| F20 | LOW | The "screened subject changed" lapse cannot happen, and the e2e step meant to test lapse tests nothing | resolved | C75.4, C89.2 and C88. Same fix as H20 |
| F21 | LOW | C78.1 relies on Phase 5 for ICAO 9303 Latin folding, which C58 does not promise | resolved | C78.1 (the matcher builds the §6.A fold from the existing private table, which Stage 1a exports; both folds become keys; the "Müller" test; Stage 1a records which fold C58 landed with) |

## Fixes that take another route

Each of these resolves its finding, but not the way the reviewer proposed. The evidence for each choice follows.

1. **P10, H18 and F13: the content hash is sealed, not a plain column.** Plain columns would reopen P01:
   - `watchlist_entries.content_hash` is a plain install-wide column (C73.3), so a plain `entry_content_hash` on `report_matches` would join to it and name the matched entry.
   - The rebuild already decrypts the sealed query, so reading the hash from the sealed snapshot costs nothing.
2. **P02 and F03: DELETE is refused, with an environment-deletion flag as the only exception.** P02 proposed an exception for retention instead, but none is needed:
   - Retention redacts reports and never deletes them (C73.6).
   - No production path deletes an environment. The only `delete(environments)` in the code is a cascade test (`packages/db/src/constraints.test.ts:222`), which may set the flag.
3. **P04: the report members sit under `data.attributes`, where the existing rule masks them.** The reviewer proposed route-specific masking of `meta`, or new names in `MASKED_MEMBERS`. Neither is needed, and the second does harm:
   - `MASKED_MEMBERS` masks at any depth, and `reason` is already a non-PII member of problem bodies (`packages/contracts/src/problem.ts:125`).
   - The public dismiss and review endpoints carry these members under `data.attributes` (`phase6-behaviour.md` §3.1, §3.2). There, the stored-log rule that masks attribute names applies with no route-specific code (`services/api-logs.ts:214-236`).
4. **P05: the OTP-based fields are computed only for completion reports.** The reviewer also suggested computing them for "callers that hold `inquiries:read`". That would still leave an oracle:
   - A PII-masked key with read scopes cannot see an inquiry's confirmed address, yet it could still test guesses against it through the field.
   - A completion report screens the inquiry's own confirmed value (C84.2), so the field answers only about data that report was built from.
5. **P17: one recorded exemption, not a rename and not a PII mark on `api-log.query`.**
   - Renaming would break parity: the public schema echoes PEP and crypto inputs under `query` (`phase6-behaviour.md` §1.3).
   - Marking `api-log.query` PII would null every query parameter in the API logs the developer role reads.
   - The exemption is safe because the api-log serializer never calls `mask.attributes()`, and it masks query members by name through `maskPersonalData` (`services/api-logs.ts:265-284`).
6. **H04: the ID extraction comes from a verification decided `passed` or `needs_review`, not only `passed`.** Settlement can complete an inquiry whose ID verification is under review, moving it `completed` then `needs_review` in one transaction (`services/inquiry-settlement.ts`). In that case no passed extraction exists. Screening the reviewed extraction's name screens more, never less, and every differing name is screened as well.
7. **H12: media searches are narrowed by country only, not by language.**
   - GDELT already searches 65 machine-translated languages from an English query (`phase6-data-sources.md` §8.1), so splitting by `sourcelang:` would multiply requests against a budget of one per 5 s without narrowing relevance.
   - A search that still fills the cap after the country re-query ends `errored` with `result_truncated` when nothing matched, which is honest.
8. **H21: independence comes from the evaluation build and a read rule, not from a secret split.**
   - Dropping the held-out tenth from the shipped build would cut production recall to buy a cleaner measurement. So the build script's `--hold-out` flag drops the tenth only in the build `evaluation-6` measures.
   - The matcher's author never reads the held-out generator (Rules), and the cases are generated at evaluation time from `evaluation-6`'s own seed.

## Rejected

None. Every finding was checked against the code at `d797da0` and the research notes, and each one held. P04's description of `MASKED_MEMBERS` is one entry short of today's code, which also masks `phone-number` and `email-address`. The missing members (`reason`, `comment`, `entity-id`) are still unmasked, so the finding stands.

## Deferred

None. No finding, or part of one, is left to a later phase. Fixing them meant recording some behaviours as later work. These are choices recorded in the parity table and C88, not deferrals of a finding:
- **Re-screening when a linked account's fields change:** Phase 7, with the account graph. H20 and F20 are resolved by dropping the unreachable branch.
- **PEP candidates, portrait comparison, `topics` and `images`:** later. H14 asked for these to be recorded, which C69.5 does.

## Verification round

A fourth pass checked the revision against this record. It confirmed 56 of the 62 dispositions. It found six only partly resolved (P09, P11, H09, H17, F01, F05) and none unresolved. It raised 14 new findings (V01–V14): 1 CRITICAL, 3 HIGH, 7 MEDIUM and 3 LOW.

The repo facts were re-checked at `e3a75ee` before acting, read-only. The plan lists them in its Starting point under "Facts the verification round relied on":
- the job options of `process-verification`, and BullMQ ignoring an `add` under an id it still holds (`jobs/index.ts:17-27`, `jobs/queue.ts:11`);
- the webhook sweep's `replace`, and the rule that job ids may not contain `:` (`webhooks/queue.ts:22-29, 41`);
- the transitions out of `failed` (`inquiry-state-machine.ts:36-38`), and the operator actions reaching `transitionInquiryInTx` (`services/inquiries.ts:621`);
- the built-in role sync at API startup (`container.ts:285`);
- where index rebuilds live (`repositories/crypto-challenges.ts:196-201`, called by `scripts/blind-index-rebuild.ts`);
- the verification processor's final failure, which has no claim to fence (`worker.ts:173-200`).

The research notes were re-read for V06 (`phase6-behaviour.md:59`: a notify-on-change record returns to `pending` when its data changes), V09 (`phase6-data-sources.md` §8.1: GDELT asks for one request every 5 s) and V10 (§8.1: phrases, `OR`, a leading `-`, `domain:`, `sourcecountry:` and `sourcelang:` are query operators).

| Set | Items | Resolved | Resolved (another route) | Partly | Deferred | Rejected |
|---|---|---|---|---|---|---|
| Findings marked partly resolved | 6 | 6 | 0 | 0 | 0 | 0 |
| New findings V01–V14 (1 CRITICAL, 3 HIGH, 7 MEDIUM, 3 LOW) | 14 | 11 | 3 (V05, V07, V12) | 0 | 0 | 0 |
| **Total** | **20** | **17** | **3** | **0** | **0** | **0** |

### Findings marked partly resolved

| Id | What was left | How it is now finished | Where in the plan |
|---|---|---|---|
| P09 | A fixed quarter share of GDELT left 75% of the budget idle for one environment; runs past capacity errored after 24 h | Through V09. The install budget is shared among the environments that asked in the last 60 s, so one environment alone gets all of it. Waiting runs retry oldest `scheduled_for` first. A cap of 8,640 scheduled media runs per day per environment, counted from `reports.recurrence_interval_days`, keeps the backlog within capacity. The 24 h deadline is now a backstop for an overcommitted install, which the sources page warns about above 80%. Tests | C81.2, C72.5, C72.3, C73.2, C86; decision 40 |
| P11 | The sweep's re-add was a no-op while BullMQ kept the job; the final-failure handler was not fenced | Through V02. `report-run` jobs are removed on completion and failure. A job with nothing to claim returns successfully. A retryable error releases the claim. The final failure is fenced by the claim token. An eleventh claim ends a crash loop. A budget wait clears `enqueued_at` and is not counted as a claim. Tests for each | C74.1, C85.4; decision 61 |
| H09 | The pinned default could resolve to an empty list, and nothing wrote `watchlist_sources.enabled` | Through V01. The source rows are reconciled from the manifest at every startup and before each CLI. "Configured" is a separate state, so an unconfigured source stays selected and errors. An empty list is refused (422 `watchlist_sources_empty`). A run with an empty selection errors as a backstop. The seed skips a template whose list would be empty | C76.4, C71.2, C71.3, C69.4, C72.4, C76.1, C76.2, C80.1; decisions 11, 56 |
| H17 | Three transitions real lists produce were missing, two of them against the plan's own unique indexes | Through V07: an order of precedence, a row for an open match the run no longer finds, 409 `report_match_superseded`, and a non-unique evidence index for a reverted entry. Through V06: the risk-data rows. One unit test per row | C75.8, C75.6, C73.2, C72.4; decisions 57, 58 |
| F01 | Stage 1b kept candidate retrieval, and the revision had added more deliverables to it | Moved out of Stage 1b: candidate retrieval and the loaders (`api-watchlists`, V11); `rebuildReportIndexes`, the crypto exposure step and the filter resolution (`api-reports`). Moved into Stage 1a: the `packages/watchlist` dependencies, the variant-group manifest entry, `riskDataHash` and `isHeldOutGroup`. Stage 2 now runs beside Stage 1b, so Stage 1b is on the critical path of Stage 3 only. Stage 1b works in three checkpoints, each green and recorded. What stays is DDL, the trigger, stubs and frozen schemas, three single-statement cross-agent reads and writes, and wiring; this round added only columns, stubs and two startup calls to it | Complexity; Workflow 6A Stages 1a, 1b, 2, 3; C70.4, C73.4, C83, C78.3; Risks |
| F05 | A re-add was ignored while BullMQ kept the job, and an exhausted job errored a live run | Same fix as P11, through V02. Tests: a worker killed after its claim is recovered once `claimed_until` passes although its job completed; an exhausted job for a run a live worker holds leaves that run `running` | C74.1, C74.3 (a) |

### New findings

| Id | Sev | Title | Disposition | Where in the plan |
|---|---|---|---|---|
| V01 | CRITICAL | The default source list can resolve to nothing, and a report with no selected source answers ready with no match | resolved | C76.4: `reconcileWatchlistSources` at API and worker startup and first in each CLI (owned by `api-watchlists`, called by Stage 1b); `enabled` from `enabled_by_default` and `OPENVERIFY_WATCHLIST_SOURCES_DISABLED` alone; "configured" separate, shown from `last_error_code: source_not_configured`. C76.1 (`eu-fsf` and `wikidata-pep` enabled, syncing once configured). C71.2 (`watchlist_sources_empty`). C69.4 (the empty-selection backstop; tests). C71.3 (the seed reconciles first and skips an empty template). C80.1. Decisions 11, 56. The e2e sets no User-Agent: the PEP import makes no request and needs none (C76.2, C89.2) |
| V02 | HIGH | Re-adding a job whose id is the run id is a no-op while BullMQ keeps the old job, so budget waits and crash recovery stall, and the final-failure handler can error a live run | resolved | C74.1 (jobs removed on completion and failure; nothing to claim returns successfully; claim release; fenced final failure; the eleventh-claim cap; `enqueued_at` cleared on a wait; tests); C74.4 and C85.4 (`rescreen-<sync id>`, no `:`); decision 61 |
| V03 | HIGH | The seeded sandbox lists go stale 48 h after `seed:dev`, so every sandbox watchlist report then errors `list_stale` | resolved | C76.3 (a `sandbox_only` source is never stale; frozen-clock tests at 72 h and 9 days); C76.1; decision 14 |
| V04 | HIGH | Name keys, canonical crypto forms and normalised identifiers are computed at sync time and never recomputed, so a matcher or variant-group change silently stops retrieval | resolved | C78.3 (`keysVersion()` with a golden test that forces a bump; runs on a mismatched source end `matcher_data_unavailable`; `watchlists:rekey`; syncs and the refresh tick re-key first; `refused_matcher_data`; tests); C73.3 (`keys_version`, `rekeyed`); C76.2; C76.6 (the seed skips the import without the group file); C69.4; decision 60 |
| V05 | MEDIUM | A re-screen lost after the sync commits is never retried, and the schema cannot tell which entries a sync changed | resolved (another route) | C73.3 (`watchlist_entries.changed_sync_id`; `watchlist_syncs.rescreen_state` and `rescreen_enqueued_at`); C76.2 steps 6–7; C74.4 (one job per sync, keyed `rescreen-<sync id>`, idempotent through `report_runs.trigger_sync_id`); C74.3 (c) (`recoverPendingRescreens`); C73.2; tests |
| V06 | MEDIUM | notify-on-change ignores the changes that matter for a confirmed match: new sanctions programmes and PEP positions | resolved | C77.3 (`riskDataHash`, frozen in Stage 1a); C73.2 (in the sealed snapshot); C75.3, C75.4, C75.8 (risk-data rows; dismissals lapse on identity only); C69.5; C70.4 (`.matched`); decision 57 |
| V07 | MEDIUM | The match state machine lacks three transitions that real lists produce, and two of them violate the plan's own unique indexes | resolved (another route) | C75.8 (precedence; an open match not found stays open with `present_in_last_run` false and `match_not_found_in_run`; 409 `report_match_superseded`; a reverted entry updates the open row in place); C73.2 (the evidence index is not unique); C75.6, C72.4, C86; decision 58 |
| V08 | MEDIUM | An inquiry that fails and is then approved by an operator is never screened | resolved | C84.2 (the hook also runs on `failed → approved \| needs_review`; at most one such move per inquiry; tests on the action path); C84.3 (the docs advise marking for review first); Acceptance; decision 59 |
| V09 | MEDIUM | The fixed quarter GDELT share leaves 75% of the budget idle and caps media at 4,320 runs per environment per day, past which runs error after waiting 24 h | resolved | C81.2 (shared among waiting environments; oldest first; a backstop deadline; tests); C72.5 (`OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY`, 8,640); C73.2 (`recurrence_interval_days`); C72.3 and C86 (the budget line and warning); C84.3 (the media wait in the window); decision 40 |
| V10 | MEDIUM | The GDELT query embeds the screened name, which the end user controls, with no escaping rule, so query operators can empty the search and yield a "no match" | resolved | C81.2 (`gdeltQuery`: casefolded tokens reduced to letters and digits inside one phrase the adapter writes; terms and country from fixed tables; an empty name refused; exact-string tests); Workflow 6A (`api-providers`) |
| V11 | MEDIUM | Candidate retrieval has three would-be owners and its performance test has none | resolved | C78.3 (`retrieveCandidates` frozen in Stage 1b, implemented by `api-watchlists`; `watchlist-matcher` gives it query keys and normalised identifiers); C78.7 (`api-watchlists` gates the 100,000-name p95; `evaluation-6` reports); C76.6; Workflow 6A Stages 1b, 2 and 3 |
| V12 | LOW | The held-out tenth is chosen by a hash rule that two parallel agents must each implement, with nothing frozen | resolved (another route) | C78.3 and C77 (`isHeldOutGroup(groupId, seed)` frozen in Stage 1a with golden vectors; `--hold-out <seed>`); C78.8 (`evaluation-6` asserts no held-out group survives); Rules; Workflow 6B |
| V13 | LOW | The PEP retention rule is undefined for relatives: read literally it drops every relative, otherwise it keeps them for good | resolved | C80.4 (a relative is kept exactly while a linked PEP is kept, under that PEP's clock; tests on synthetic SPARQL answers) |
| V14 | LOW | C72.2's linking rules give a reason that C84.3 contradicts, and the reference-id rule leaves an existence oracle | resolved | C72.2 (the `inquiries:write` reason restated; `accounts:read` whenever `auto-create-account-reference-id` is present; a same-403 test for known and unknown ids) |

### Fixes that take another route

1. **V05: one re-screen job per sync, made idempotent, rather than per-environment marks on the sync.**
   - A mark per (sync, environment) would have to be written in the install-wide apply transaction, which would first have to find every environment whose pinned lists hold the source.
   - Instead, one `rescreen_state` per sync and a unique `(report_id, trigger_sync_id)` make a repeated job harmless, so a retry needs no per-environment bookkeeping.
   - `changed_sync_id` is added as the reviewer proposed.
2. **V07 row (3): the evidence index is no longer unique, and the open row stays open.**
   - Dismissing the open row back onto the old suppression would auto-dismiss an alert that a reviewer may have marked `true_positive` since. That breaks the rule that only a person dismisses.
   - Re-pointing the dismissed row would rewrite its history.
   - Suppression needs only an existence check on `(report_id, entry_index, evidence_hash)`, which a plain index serves. Rows (1) and (2) take the reviewer's first option each: keep open; 409.
3. **V12: the held-out groups are keyed by `evaluation-6`'s seed, not by a fixed hash.**
   - A fixed hash in a shared module would let anyone, the matcher's author included, compute the held-out groups in advance.
   - `isHeldOutGroup(groupId, seed)` is frozen in Stage 1a with golden vectors, as the reviewer asked, so the build and the generator agree by construction. The held-out set exists only once the seed is chosen.

Two smaller parts of resolved findings also differ from the proposal:
- **V01:** the e2e sets no Wikidata User-Agent, because an import makes no request (C76.2), and setting one would hide that.
- **V02:** a job that never claimed writes nothing on its final failure, rather than erroring a pending, unclaimed run. Such a failure comes from the infrastructure (the database unavailable at the claim), not from the run, and the sweep runs it again once the database is back.

### Rejected and deferred

None. Every new finding was checked against the code at `e3a75ee` or the research notes, and each one held. Nothing is left to a later phase.
