# TDD evidence: Workflow 6A Stage 1b, `foundation-6` (Phase 6)

- **Slice owner:** the Workflow 6A Stage 1b `foundation-6` agent (plumbing only, F01), beside the four Stage 2 agents.
- **Date:** 2026-10-27.
- **Base:** `e03387fa` (the end of Stage 1a).
- **Input:** the "Stage 1b: foundation-6" bullet of `docs/plans/phase-6.plan.md`, in its three checkpoints (1 data, 2 masking and hooks, 3 interfaces and wiring), and the "Workflow 6A Stage 1a amendments (contracts-6)". The decisions this stage took are in the plan's "Workflow 6A Stage 1b amendments (foundation-6)".

Each unit follows the same cycle: a stub (`chore`) only when a test needs a name that does not exist yet, so the RED commit compiles and type-checks; the test, run and seen failing for its intended reason (RED, `test`); the smallest change that passes it (GREEN, `feat`); a refactor on green where one was worth making. Every command ran after `source scripts/env.sh`; output is trimmed to the lines that matter. Every value in these tests is synthetic.

## Checkpoint 1: data

### 1.1 Migration 0020: the report and watchlist tables, `pg_trgm`, the enums, `report_config`, the `report_actions` trigger (C71.1, C73.1-C73.3, C84.1, F16)
Stub 761c5aca (`PGLITE_EXTENSIONS`, `{ vector }`); RED 00b829c6; GREEN 8bc3d208.

RED:
```
$ (cd packages/db && pnpm exec vitest run src/phase6-tables.test.ts src/testing.test.ts src/migrate.test.ts src/migration-v2.test.ts --coverage.enabled=false)
     × creates the Phase 6 report and watchlist tables in 0020, with pg_trgm first (C73.1)
     × creates pg_trgm itself, and trigram similarity works
     × creates the enum report_status   (and the six other enums)
     × gives inquiry template versions a report_config, an empty object by default (C84.1)
     × report_templates · × reports · × report_matches · ... (every report table)
       AssertionError: watchlist_sources exists: expected 0 to be greater than 0   (every watchlist table)
     × reports_due_idx · × watchlist_names_normalised_trgm_idx · ...
       AssertionError: watchlist_names_keys_idx: expected null not to be null
     × refuses an update of any column without a flag · × lets a KEK rewrap ... · × refuses a DELETE ...
     × applies every migration, including the pgvector extension   (the public table list)
     × loads pgvector and pg_trgm in every PGlite instance (C73.1, F16)
 Test Files  3 failed | 1 passed (4)
      Tests  46 failed | 72 passed (118)
```
GREEN: the tables (`tables/reports.ts`, `tables/watchlists.ts`), seven enums, `report_config`, `report-retention-days` in `EnvironmentSettings`, `PGLITE_EXTENSIONS = { vector, pg_trgm }`; `drizzle-kit generate --name phase6_reports_watchlists`, then hand edits: `CREATE EXTENSION IF NOT EXISTS pg_trgm` first, the `updated_at` triggers and the `openverify_report_actions_append_only` function and trigger. No earlier table or type is dropped or recreated.
```
$ (same command)   Test Files  4 passed (4)   Tests  118 passed (118)
$ (cd packages/db && pnpm exec vitest run --coverage.enabled=false)   Test Files  68 passed (68)   Tests  903 passed (903)
```

### 1.2 Sealing, the KEK rewrap and the report blind indexes (C73.2, C73.4, C75.3)
Stub dd16379f (the `@openverify/db/testing` seed helpers `seedReportTemplate`, `seedReport`, `seedReportRun`, `seedReportMatch`, `seedReportAction`, `seedReportAccount`, `seedWatchlistSource`, `seedWatchlistSync`; the three labels with stub functions); RED dce06c3f; GREEN 1650d666.
```
$ (cd packages/db && pnpm exec vitest run src/blind-index.test.ts src/repositories/report-rewrap.test.ts src/schema-v2.test.ts --coverage.enabled=false)
     × keys a report crypto address and a match entry under the environment subkey
     × frames the evidence as one JSON array, so no two splits give one input (P10)
     × refuses a key that is not 32 bytes
     × lists every encrypted column for the KEK rewrap
     × are listed for the rewrap, under their seal names · × are re-wrapped by kek:rewrap, so the new KEK alone opens them
 Tests  6 failed | 99 passed (105)
```
GREEN: `ENCRYPTED_COLUMNS` and `SEALED` gain `reports.query`, `reports.result`, `report_actions.details`, `report_matches.snapshot`; `REWRAP_TABLES` gains the three tables (the trigger's rewrap case lets `report_actions` through); the HMACs under the environment subkey. The existing `key-rotation.test.ts` seeds one row of each report table (its "every encrypted column" bound is `ENCRYPTED_COLUMNS.length`): 108 passed.

### 1.3 The report repository files and the cross-agent reads and writes (C73.6, C74.4, C78.6, V05)
Stub 7f29a077 (`reports.ts` with `rebuildReportIndexes`, `report-templates.ts`, `report-runs.ts`, `report-matches.ts`, `report-actions.ts`, `report-rescreen.ts`, `listReportsDueForRetention`, and their export lines); RED 48503bb1; GREEN 8b24908f.
```
$ (cd packages/db && pnpm exec vitest run src/repositories/report-rescreen.test.ts --coverage.enabled=false)
     × take the recurring, unpaused, unredacted reports of the types whose version selects the source
     × pages a chunk at a time by report id, within the environment · × refuses a chunk over the limit of 50,000 subjects (P09)
     × inserts one pending list_update run per report, once, whatever the repeats
     × takes the unredacted reports older than report-retention-days, oldest first · × honours the batch size and locks ...
       Error: not implemented: listRescreenEnvironments (object synthetic-rescreen)
 Tests  6 failed (6)
GREEN: Tests 6 passed (6)
```

### 1.4 Redaction entries in the shared repositories (C73.5)
RED 77675010; GREEN 58ff0bc7. `REDACTION_SUBJECT_ID_PREFIXES` gains `rep` (the exact-list test in `subject-ids.test.ts` changed with C73.5), `aboutInquiries` lists the inquiry's reports, inquiry and account redaction stub their reports' events and clear the stored copies; the header table gains the report and watchlist rows.
```
     × names report ids among the redaction subjects   AssertionError: expected [] to deeply equal [ 'rep_01M5…' ]
     × lists an inquiry report events with the inquiry events
     × stubs the events of the reports of a redacted inquiry · × ... a redacted account holds, home or linked
 Test Files  2 failed (2)
GREEN: 5 files, 25 passed
```

### 1.5 The `report-retention-days` setting (C73.6, P14)
RED 574fcae2; GREEN 3703839a (the contract member, bounds 1-3,650 or null, the settings service key, the OpenAPI snapshot; the dashboard's `RetentionSetting` leaves it to 6B's reports console).
```
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard/settings.test.ts --coverage.enabled=false)
     × serves null by default: reports are kept as long as inquiries · × sets it on the environment, and null keeps reports again
 Tests  2 failed | 20 passed (22)
GREEN: settings 22 passed; contracts 2,071 passed (DASHBOARD_SETTINGS_DEFAULTS gains the key, changed with C73.6)
```

### 1.6 The report redaction hooks, the retention step and the index rebuild (C73.4-C73.6, F04)
Stub cdda3429 (`services/reports/hooks.ts`, `services/reports/redaction.ts`, `RedactionService.redactReport`, the report tables in `SUBJECT_PII_TABLES`); RED e32b5637; GREEN 626a3bd8.
```
$ (cd apps/api && pnpm exec vitest run src/blind-index-rebuild.test.ts src/services/retention.test.ts src/services/report-redaction-hooks.test.ts --coverage.enabled=false)
     × rebuilds the report indexes too, through rebuildReportIndexes, printing counts only (C73.4)
     × redacts an inquiry's reports in the inquiry's transaction and dispatches their events
       AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
     × redacts an account's reports in its transaction, then catches up on those linked meanwhile
     × redacts one report, dispatches its event and audits it with counts   Error: redactReport is not wired yet (rep_…)
     × redacts each report past report-retention-days through the redaction service
     × goes on past a report whose redaction fails, and reports the run incomplete
 Tests  7 failed | 25 passed (32)
GREEN: the same 7 files with redaction, kek-rewrap and the retention job: 98 passed
```
Existing tests changed with the plan: the redaction fakes of `jobs/retention.test.ts`, `retention-run.test.ts` and `services/retention.test.ts` gain `redactReport`; `retention-run.test.ts`'s JSON report and `services/retention.test.ts`'s `EMPTY` gain `redactedReports` and `failedReportRedactions`; `blind-index-rebuild.test.ts` reads the chip line as the fourth of five.

Pin d98927cc (written after the code): the seven report enums equal core's lists.

### Checkpoint 1 gates (foreground)
| Gate | Result |
|---|---|
| `pnpm turbo run test --filter=@openverify/db --filter=@openverify/contracts --filter=@openverify/dashboard` | db 926 (98.47% statements), contracts 2,071 (99.22%), dashboard 3,056 (98.64%) |
| `pnpm --filter @openverify/api test` | 3,914 passed in 257 files, 97.01% statements, 89.45% branches |
| typecheck and lint of api, db, contracts, dashboard; Prettier | 8 of 8 tasks; clean |

Checkpoint 1 ends at d98927cc (and this record).

## Checkpoint 2: masking and hooks

### 2.1 Masking lists, log keys, lint folders (C70.3, P04, P17, C53.8)
RED ce4bf150; GREEN f00c7355.
```
$ (cd apps/api && pnpm exec vitest run src/auth/report-masking.test.ts src/logger.test.ts --coverage.enabled=false)
     × lists every report PII attribute among the masked ones
     × nulls each PII attribute of a report resource and masks query member-wise
     × masks the query of a creation request member-wise, and the report it answered
     × nulls the reason, the entity id and the comment of a dismissal and a review
     × redacts the Phase 6 names: the screened query, the matched and listed names, titles, the subject index
 Tests  5 failed | 27 passed (32)
$ (cd packages/config && pnpm exec vitest run src/eslint-phase5.test.ts --coverage.enabled=false)   Tests  10 failed | 25 passed (35)
GREEN: auth, logger, api-logs, phase5 masking, api-log and event routes: 200 passed; config 91 passed
```
`MASKED_ATTRIBUTES` (pii.ts) and the API-log attribute set gain `PII_REPORT_ATTRIBUTES`; `query` is masked member-wise inside `attributes` (an API log's own query parameters are never inside `attributes`, P17); the loggers and the lint rule allow `reportQuery`, `matchedName`, `listEntryName`, `articleTitle`, `subjectIndex`; the regexp and log-key rules now cover the Phase 6 API folders.

### 2.2 The completion and consolidation hooks (C84.2, C84.4, V08, F04)
Stub 39a818d4; RED e0acb0b8; GREEN fa01f6f0.
```
     × pending -> completed creates the inquiry reports · × failed -> approved ... · × failed -> needs_review ...
       AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
     × passes the absorbing and the absorbed accounts
 Tests  4 failed | 5 passed (9)   (failed -> declined, completed -> approved | needs_review, pending -> failed, created -> pending create none)
GREEN: the hook tests, account routes, settlement and inquiry actions: 128 passed
```

### 2.3 `report-config` on inquiry template versions (C84.1, F07, amendment 14)
Stub a95d85ea (`services/publish/report-config.ts`, refusing every entry until `api-reports`; `ReportProblemError`); RED 42bbbc88; GREEN 36d80859.
```
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-template-report-config.test.ts --coverage.enabled=false)
     × takes it on creation, stores it and serves it resolved on the current version
     × serves the defaults for a version that sets none
     × refuses a template whose report list names no published report template (422, pointer)
     × keeps it on a draft, replaces it on update, and checks it on publish
 Tests  4 failed (4)
GREEN: the new test, the template, version and publish routes and the OpenAPI snapshot: 68 passed; contracts 2,071; Android ContractFixturesTest passes
```
The contracts' version bodies and `createInquiryTemplateAttributesSchema` take `report-config`; the version resource and the template's current version serve it resolved (optional in the schemas, so earlier documents and the Android fixtures still parse). The contracts builder test gains the resolved member (changed with C84.1).

### 2.4 `?include=reports` (C70.5, F08)
Stub f0e5f62c (`services/reports/includes.ts`); RED 00845053; GREEN a1800da0 (the inquiry include, the account route's `include` query and `accountIncludeDocumentSchema`, the OpenAPI snapshot).
```
     × includes the reports of an inquiry, as the hook answers them · × includes the reports of an account, home or linked
 Tests  2 failed | 1 passed (3)
GREEN: the include test, account and inquiry routes: 107 passed
```

### 2.5 Strict webhook filters for report subjects (C70.4, F10, decision 45)
Stub 31bec4aa (the `strict` flag, `services/reports/filter-subjects.ts`); RED 09b37b85; GREEN 95ecdbb9.
```
core: × fail a present filter without the attribute (1 failed | 24 passed)
db:   × drops webhooks whose filter the subject cannot meet, and keeps the unfiltered (1 failed)
api:  × resolves report payloads through the hook and marks them strict (1 failed)
GREEN: core 25, db webhooks 22, api events, webhook services and actions 90 passed
```

### 2.6 Reconciliation at startup, the seeded report templates (C71.3, C76.4, V01, F11)
Stub 501859a5 (`watchlists/reconcile.ts`, `seed/report-templates.ts`); RED c04ad09c and 1837be96 (the seed test on its own database); GREEN c9779798.
```
     × is read the same way by every process ... · × refuses a value that is not a source id, naming the variable only
     × reconciles with the disabled sources and logs counts only · × logs a failure by its name and resolves
     × reconciles the source rows from the manifest once the app is ready
     × reconciles the watchlist source rows, then seeds the report templates
GREEN: seed, worker start, container, config, worker: 176 passed
```
`parseWatchlistSourcesDisabled` (config.ts) is the one parser; the API reconciles in an `onReady` hook, the worker before `startWorkers`, `seed:dev` first and then `seedReportTemplates`.

### 2.7 The per-type report job hooks (C69-C82)
Stub 17e2056f (`jobs/report-types/job.ts` types, nine unbuilt stubs, an empty registry); RED ca1d55af; GREEN e9c2b2b1.
```
     × register one job per report type, under its type · × fail the run of a type not built yet ...   Tests 2 failed
GREEN: 2 passed
```

### Checkpoint 2 gates (foreground)
| Gate | Result |
|---|---|
| `pnpm --filter @openverify/api test` | 3,981 passed in 264 files, 96.98% statements, 89.5% branches |
| `pnpm turbo run test` for db, core, contracts, config, node | all passed; db 98.43%, core 100%, contracts 99.22%, config 100%, node 98.86% statements |
| `pnpm turbo run typecheck lint` | 28 of 28 tasks |

Checkpoint 2 ends at e9c2b2b1 (and this record).

## Checkpoint 3: interfaces and wiring

The first run stopped (the session's login expired) after 3.3; this run resumed from 7fe687b7. The evidence of 3.1-3.3 comes from the first run's transcript, and their tests were run again at the start of this run: `pnpm exec vitest run src/test-support src/dns src/http src/providers/domain-age --coverage.enabled=false`, 9 files, 95 passed.

### 3.1 The C85 forms and the CryptoExposure port, as types and stubs (C83, C85.1-C85.3, F18, F19)
Stub 580cbd26 (no RED: types and stubs for their owners). `OutboundHttp.streamClient` with `OutboundStreamClientOptions` (`timeoutMs`, `idleTimeoutMs`, `exposeHeaders`, `redirect: { maxHops: 1, host }`), `OutboundStreamSink`, `OutboundStreamResponse`, `DEFAULT_STREAM_IDLE_TIMEOUT_MS` in `http/index.ts`, the stub in `http/stream.ts` (every stream fails `blocked`); `DnsResolver.resolveTxt` and the stub `dns/txt.ts` (every lookup fails `failed`); the fake DNS zones answer `txt`; `providers/domain-age/registered-domain.ts` (the `RegisteredDomainAgeProvider` signature); `CryptoExposureProvider` in `ports.ts`. Making `NodeResolver.resolveTxt` optional kept the existing DNS test fakes compiling:
```
$ pnpm exec tsc --noEmit -p .
src/dns/index.test.ts(39,3): error TS2741: Property 'resolveTxt' is missing in type '{ resolveMx: ...; resolve4: ...; resolve6: ...; }' but required in type 'NodeResolver'.
(after `resolveTxt?` on NodeResolver) the dns, http, domain-age and fakes tests: Tests 63 passed (63)
```

### 3.2 The frozen watchlist reads and their in-memory fake (C78.3, V11)
RED 878c1dd0: `retrieveCandidates`, `loadEntries`, `getWatchlistSourceStates` and `DB_WATCHLIST_READS` as db stubs in `packages/db/src/repositories/watchlists.ts` (owner `api-watchlists`), with the export line; `createInMemoryWatchlists` declared as a stub in `test-support/fakes.ts`. The fake is built in the `describe` body, so the stub failed the file while it was collected:
```
$ pnpm exec vitest run src/test-support/watchlists-fake.test.ts --coverage.enabled=false
 FAIL  src/test-support/watchlists-fake.test.ts [ src/test-support/watchlists-fake.test.ts ]
Error: not implemented: createInMemoryWatchlists (6 3)
 Test Files  1 failed (1)
```

### 3.3 The in-memory watchlist reads (V11)
GREEN 7fe687b7. The first implementation ranked by shared keys alone, so ties came back in insertion order:
```
     × retrieves by shared keys, ranked, within the selected sources 11ms
AssertionError: expected [ 'synthetic-list:E1', …(2) ] to deeply equal [ 'synthetic-list:E1', …(2) ]
      Tests  1 failed | 3 passed (4)
```
Ties now break on source id, then entry id; sandbox-only sources are left out for production; exact identifiers and crypto addresses are found whatever the names; `truncated` says when the cap binds:
```
$ pnpm exec vitest run src/test-support --coverage.enabled=false      Tests  38 passed (38)
```

### 3.4 The C83 provider kinds and the Phase 6 settings, per process (C72.5, C73.8, C76, C80, C81.1, C83)
Stubs 7138aa69 (the report provider ports, the five factories `providers/{adverse-media,email-intelligence,phone-intelligence,address-verification,crypto-exposure}/index.ts` with `ReportProviderOptions`, `PHASE6_PROVIDER_KINDS` not yet bound, the Phase 6 members of `ApiConfig` at their defaults) and 65b446ca (`ApiDependencies.reportLimits`). The stub was checked against the committed versions of the kind lists:
```
$ pnpm exec vitest run src/providers src/config.test.ts src/container.test.ts src/worker.test.ts src/jobs/report-types --coverage.enabled=false
 Test Files  35 passed (35)      Tests  508 passed (508)
```
RED a6d56094 (`providers/phase6-providers.test.ts`, `providers/phase6-provider-options.test.ts`, `config-phase6.test.ts`, the gdelt-doc refusal in `worker.test.ts`; the kind lists of `providers/index.test.ts`, `phase5b-providers.test.ts` and `config.test.ts` changed with C83):
```
$ pnpm exec vitest run src/providers src/config.test.ts src/config-phase6.test.ts src/worker.test.ts --coverage.enabled=false
     × are kinds of their own, each with its variable and names, read by the worker only
     × each get the bound name and the worker’s credentials, clients and clock
     × are read by both processes · × refuse OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY outside 1 to its maximum
     × stop the worker binding gdelt-doc without the disclosure acknowledgement (decision 7)
     × refuses to bind gdelt-doc without the disclosure acknowledgement, naming the variable (C81.1)
AssertionError: expected { perMinute: 600, …(2) } to deeply equal { perMinute: 120, …(2) }
AssertionError: expected [] to deeply equal [ [ 'gdelt-doc', { …(5) } ] ]
Error: expected loadConfig to throw a ConfigError        (6 times)
AssertionError: expected { close: [AsyncFunction close] } to be an instance of ConfigError
 Test Files  7 failed | 29 passed (36)      Tests  26 failed | 488 passed (514)
```
GREEN 2f9ceca7, then 3b4ef087 (compose as Prettier writes it): the kinds bound by the worker through their factories with `{ credentials, outboundHttp, cache, rateLimiter, clock }`; `readWatchlistSettings` and `readReportProviderCredentials` in `config.ts` (the worker only; each credential only while its kind is bound to its adapter); the report limits in both processes; the API's `reports` rate-limit rule from `OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE`; `.env.example` (the EU token commented out, never a value) and compose (`x-report-environment` for the API, the worker and migrate; `x-watchlist-sync-environment` and the report provider bindings for the worker; Postgres started with `log_parameter_max_length=0` and `log_parameter_max_length_on_error=0`):
```
$ pnpm exec vitest run src/providers src/config.test.ts src/config-phase6.test.ts src/worker.test.ts src/worker-startup.test.ts src/container.test.ts src/app.test.ts src/plugins src/seed src/services/context.test.ts src/test-support --coverage.enabled=false
 Test Files  51 passed (51)      Tests  760 passed (760)
$ bash infra/tests/compose.test.sh --static-only      # 304 passed, 0 failed
```
The static compose check `worker receives no Twilio setting` matches `^OPENVERIFY_TWILIO_`, which the plan's `OPENVERIFY_TWILIO_LOOKUP_*` names also match, so compose does not pass those three to the worker yet (a recorded deviation for `integration-6a`, who owns `infra/tests/`).

### 3.5 The report queues, producers, repeatable registrations and job stubs (C74.1, C74.3, C74.4, C76.2, C85.4)
Stub 08a94d71: the `ReportRunJob`, `ReportRunQueue`, `ReportRescreenJob` and `ReportRescreenQueue` ports; `jobs/report-queues.ts` (names, job options, `reportRescreenJobId`, producers that rejected every enqueue); the owners' stubs `jobs/reports/run.ts` (`processReportRun`), `jobs/reports/rescreen.ts` (`processReportRescreen`, `recoverPendingRescreens`), `jobs/reports/sweep.ts` (`runReportSweep`) and `jobs/repeatable/watchlists.ts` (`runWatchlistsRefresh`); `phase6RepeatableJobs` scheduling nothing; `WorkerReportOptions` and the two processors in `worker.ts`; `ApiDependencies.reportRuns` from the container.
```
$ pnpm exec vitest run src/worker.test.ts src/container.test.ts src/services/context.test.ts src/jobs/repeatable src/test-support src/server.test.ts src/openapi.test.ts --coverage.enabled=false
 Test Files  14 passed (14)      Tests  142 passed (142)
```
RED f47bf923 (`jobs/report-queues.test.ts`, `jobs/repeatable/phase6.test.ts`, the report blocks of `worker.test.ts`):
```
$ pnpm exec vitest run src/jobs/report-queues.test.ts src/jobs/repeatable/phase6.test.ts src/worker.test.ts --coverage.enabled=false
     × enqueues one job per run under the run id, with the ids only · × refuses the sync id 1.5
     × opens its queue on the first enqueue only, once, and closes nothing it never opened
     × sweeps every 15 seconds, and refreshes the lists only when told to
     × hands the framework the job, its deps and whether this is the last attempt
     × starts the report-run and report-rescreen workers only when it runs reports
AssertionError: promise rejected "Error: report-run is not built yet" instead of resolving
AssertionError: expected [ 'report-run', 'report-rescreen' ] to deeply equal []
AssertionError: expected [ 'process-verification', …(2) ] to deeply equal [ 'process-verification', …(5) ]
      Tests  22 failed (of 82)
```
GREEN 88ab8234: the producers (ids validated, ids only, the job id the run id or `rescreen-<sync id>`, `removeOnComplete` and `removeOnFail`, the BullMQ queue opened on first use); `phase6RepeatableJobs` (`report-sweep` every 15 s whenever the worker runs reports, `watchlists-refresh` every 15 minutes with `OPENVERIFY_WATCHLIST_REFRESH=true`); the worker's `report-run` worker (the worker's concurrency) and `report-rescreen` worker (concurrency 1), and `main()` creating and closing both producers. Pin 671e382e (written after the code): the container closes its `report-run` producer.
```
$ pnpm exec vitest run src/container.test.ts src/worker.test.ts src/worker-startup.test.ts src/server.test.ts src/openapi.test.ts src/services/context.test.ts src/test-support src/jobs --coverage.enabled=false
 Test Files  58 passed (58)      Tests  741 passed (741)
```

### 3.6 The watchlist CLI package scripts (C76.2, C78.3, C80.1)
RED 61886f4c (`package-scripts.test.ts`):
```
     × runs watchlists:sync from scripts/watchlists-sync.ts with the repository .env, as the other CLIs do
AssertionError: expected undefined to be 'tsx --conditions=@openverify/source -…'      Tests  3 failed (3)
```
GREEN f47da58e: `watchlists:sync`, `watchlists:rekey`, `pep:sync` in `apps/api/package.json`, each running its stub script (owner `api-watchlists`), which changes nothing and exits 1:
```
      Tests  3 passed (3)
$ pnpm watchlists:sync      watchlists:sync: not built yet; nothing was changed      [ELIFECYCLE] Command failed with exit code 1.
```

### 3.7 The frozen report routes and the OpenAPI snapshot (C72.1-C72.3)
RED 8906c13e (`routes/server/report-routes.test.ts`, `routes/dashboard/report-routes.test.ts`): each route answers 403 without its scope (401 without a session on the dashboard), 400 for what its schema refuses, and 501 until built:
```
$ pnpm exec vitest run src/routes/server/report-routes.test.ts src/routes/dashboard/report-routes.test.ts --coverage.enabled=false
AssertionError: {"type":"about:blank","title":"Not Found","status":404,"detail":"No route matches DELETE /api/v1/reports/rep_…"}: expected 404 to be 403
AssertionError: expected 404 to be 401 · expected 404 to be 400 · expected 404 to be 501
 Test Files  2 failed (2)      Tests  57 failed (57)
```
GREEN 4b3a277c: `routes/server/{reports,report-templates,report-template-versions}.ts` (owner `api-reports`) registered by `routes/server/index.ts`; `routes/dashboard/reports.ts` (`api-reports`) and `routes/dashboard/watchlist-sources.ts` (`api-watchlists`) registered in `dashboardAdminRoutes`; the registered-plugin list of `routes/server/index.test.ts` gains the three server plugins.
```
 Test Files  2 passed (2)      Tests  57 passed (57)
$ pnpm exec vitest run src/openapi.test.ts src/routes src/plugins src/app.test.ts src/auth --coverage.enabled=false
 Test Files  71 passed (71)      Tests  1373 passed (1373)
$ pnpm --filter @openverify/api openapi:write     (twice; the second run left the file byte-identical)
```
The snapshot gains the 25 report paths; no existing path or component changed (102 to 121 path entries, 98 components).

### 3.8 A Testcontainers Postgres without bind-parameter logging (C73.8, P18)
Stub 0c639ad4 (`POSTGRES_TEST_COMMAND` at the server defaults); RED ac7cea02 (`postgres-logging.integration.test.ts`):
```
$ pnpm exec vitest run --config vitest.integration.config.ts src/postgres-logging.integration.test.ts
     × never logs bind parameters, in a statement or in an error
     × keeps them out of the log when a session turns statement logging on
AssertionError: expected '-1' to be '0'      Tests  2 failed (2)
```
GREEN 3a3ef409: `log_parameter_max_length=0` and `log_parameter_max_length_on_error=0`. `Tests 2 passed (2)`. A scratch copy of the test (deleted afterwards) on a Postgres with the default command and statement logging on found the bound name in the server log, so the log assertion can fail.

### 3.9 The upgrade tests on earlier schemas (a defect of 1.1, found by the checkpoint 3 gates)
The checkpoint 1 and 2 gates ran the unit suites only. `pnpm test:integration` failed 4 db tests: each upgrade test seeds rows on an earlier schema with the repositories, which name every column of the current one, and 0020 added `inquiry_template_versions.report_config`:
```
$ pnpm test:integration
     × upgrade a Phase 2 database with rows in it the same way
     × upgrades a Phase 4 database with rows in it, and no row held business
     × upgrades a database at 0016 with rows in it · × upgrades a database at 0017 with rows in it
Caused by: error: column "report_config" of relation "inquiry_template_versions" does not exist
@openverify/db:test:integration:       Tests  4 failed | 55 passed (59)
```
Fix 462bfad7: `createTestInquiryOnEarlierSchema` (`@openverify/db/testing`) writes the template and its published version with the columns every schema since 0003 has; the four tests seed with it before they migrate. `Test Files 4 passed (4)  Tests 13 passed (13)`.

### Checkpoint 3 gates (foreground)
| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | lockfile up to date; no `minimumReleaseAgeExclude` |
| `pnpm typecheck && pnpm lint && pnpm format:check` | 14 of 14 tasks each; Prettier clean |
| `pnpm turbo run test --filter=@openverify/api` | 4,099 passed in 273 files, 96.8% statements, 89.56% branches (9 min 29 s) |
| `pnpm turbo run test --filter='!@openverify/api'` | db 927 (98.08% statements, rerun after 3.9), contracts 2,071 (99.22%), core 768 (100%), checks 3,304 (98.73%), watchlist 463 (98.75%), dashboard 3,056 (98.64%), flow 1,012 (96.35%), node 249 (98.86%), emrtd 318 (94.97%), flow-spec 113, e2e 90, config 91, ui 54; every package at least 80% |
| `pnpm test:integration` | api 124 in 25 files, db 59 in 12 files (2 min 23 s) |
| `pnpm --filter @openverify/api openapi:write` twice | the second run changes nothing |
| `bash infra/tests/ci-workflow.test.sh` | 181 passed |
| `bash infra/tests/compose.test.sh --static-only` | 304 passed |
| `bash infra/tests/apps-image-context.test.sh` | 14 passed |
| `flock /tmp/openverify-e2e.lock pnpm e2e` (three calls) | mocked flow 69 passed (21.3 s); full stack shard 1/2 42 passed (3.6 min), shard 2/2 40 passed (5.9 min) |

Checkpoint 3 ends at 462bfad7 (and this record).
