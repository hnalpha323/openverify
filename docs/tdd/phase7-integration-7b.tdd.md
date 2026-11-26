# Phase 7, Workflow 7B Stage 4: integration-7b

Base: `be24b16e` (the api-graph record). Every Stage 1-3 agent is done; this agent runs alone.
Commands run after `source scripts/env.sh`. Output abbreviated; exit codes are the commands' own.

## 1. The missing hooks of Stage 3 (api-lists, api-importers, api-graph)

The api-lists hooks patch (`docs/tdd/phase7-api-lists.hooks.patch`, 11 files) applied cleanly
except `container.ts`, whose context had drifted (one import line moved); that hunk was applied by
hand. Its new test `jobs/report-types/custom-list-engine.test.ts` is the RED of the persistence
hooks; `src/integration-7b-wiring.test.ts` is the RED of the wiring (the container's list service,
the worker's list writer, and the graph indexer's key in both processes).

RED:

```
$ (cd apps/api && pnpm exec vitest run src/integration-7b-wiring.test.ts src/jobs/report-types/custom-list-engine.test.ts --coverage.enabled=false)
     × stores list provenance, serves matched-lists, and passes the contract
       (-   "sources": [{ "list-id": ..., "version": 2, ... }]   +   "sources": [], "matched-lists": null)
     × serves the real list service on the configured blind-index key (C97.3)
       AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
     × gives the graph indexer the configured key (C101.3)
     × gives the list-import job the real writer when it holds the key (C100.2)
       expected { insertItems: [Function insertItems] } not to be { insertItems: ... }
      Tests  4 failed (4)
```

GREEN: the patch applied (`git apply --exclude=container.ts`), `container.ts` by hand
(`createListService({ db, blindIndexKey, rateLimiter })`), plus `useGraphIndexKey(config.blindIndexKey)`
at container start and `useGraphIndexKey(options.blindIndexKey)` at worker start (api-graph
contractDeviation 1). Prettier reformatted two patched files (the patch had never been linted).

```
$ pnpm exec vitest run src/integration-7b-wiring.test.ts src/jobs/report-types/custom-list-engine.test.ts src/container.test.ts src/worker-lists.test.ts src/worker-graph.test.ts src/routes/server/account-includes.test.ts src/services/retention.test.ts src/retention-run.test.ts --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  72 passed (72)
$ pnpm exec vitest run src/services/lists src/jobs/lists src/routes/server/list*.test.ts src/services/reports src/jobs/report-types src/jobs/reports src/routes/server/inquiries.test.ts src/routes/server/accounts.test.ts src/worker.test.ts src/jobs/importers --coverage.enabled=false
 Test Files  47 passed (47)
      Tests  710 passed (710)
```

## 2. Defect: a platform-file value takes the platform's `file_` ids (api-transactions deviation 1)

The engine read a `platform-file` value as `fil_` plus a ULID; `ID_PREFIXES.file` is `file`, so
every real file id was refused. RED: the golden constant becomes `file_…`, a `fil_` id is refused,
and a route-level create with a real file id answers 201.

```
$ (cd packages/core && pnpm exec vitest run src/transactions/fields-validator.test.ts --coverage.enabled=false)
     × hands every id to the API, which alone can check it
     × refuses a fil_ id
     × answer no references or json values
      Tests  3 failed | 73 passed (76)
$ (cd apps/api && pnpm exec vitest run src/services/transactions/transactions.test.ts -t platform --coverage.enabled=false)
     × takes a platform file of its environment in a create, by the platform’s own id (C104.2)
AssertionError: expected 422 to be 201
```

GREEN (`PLATFORM_FILE_ID = /^file_<ULID>$/` in `packages/core/src/transactions/fields-validator.ts`):

```
$ (cd packages/core && pnpm exec vitest run src/transactions --coverage.enabled=false)
      Tests  355 passed (355)
$ (cd apps/api && pnpm exec vitest run src/services/transactions/transactions.test.ts --coverage.enabled=false)
      Tests  18 passed (18)
```

## 3. Defect: a multipart part's filename in a stored API log (api-importers deviation 1, rule 11)

`multipartLogValue` stores each part's `filename`, and `MASKED_MEMBERS` did not name it, so a stored
API log read without `pii:view` showed an uploaded CSV's or file's name. RED:

```
$ (cd apps/api && pnpm exec vitest run src/services/api-logs.test.ts --coverage.enabled=false)
     × nulls each multipart part’s filename and keeps its name, type and size
-       "filename": null,
+       "filename": "blocked-synthetic-person.csv",
      Tests  1 failed | 26 passed (27)
```

GREEN (`'filename'` joins `MASKED_MEMBERS` in `services/api-logs.ts`):

```
$ (cd apps/api && pnpm exec vitest run src/services/api-logs.test.ts src/routes/server/api-logs.test.ts src/routes/server/importers.test.ts src/routes/transaction-routes.test.ts --coverage.enabled=false)
 Test Files  4 passed (4)
      Tests  141 passed (141)
```

## 4. Missing hook: an asynchronous graph query's completion is audited (api-graph deviation 6)

`GraphQueryDeps` has no audit logger, so the worker never audited an asynchronous run (C102.7:
every query is audited with its counts). The job now writes a system audit entry
(`appendSystemAuditEntry`, the form a run without a principal takes) in the transaction that
stores the result. RED:

```
$ (cd apps/api && pnpm exec vitest run src/jobs/graph/query-job.test.ts --coverage.enabled=false)
     × audits an asynchronous run’s terminal status with its counts, as a system entry (C102.7)
AssertionError: expected [] to deeply equal [ ObjectContaining{…} ]
      Tests  1 failed | 4 passed (5)
```

GREEN:

```
$ (cd apps/api && pnpm exec vitest run src/jobs/graph src/worker-graph.test.ts src/routes/graph-query-routes.test.ts --coverage.enabled=false)
 Test Files  5 passed (5)
      Tests  40 passed (40)
```

## 5. Contract: a geolocation item's radius is 1 to 500,000 meters (list-logic deviation)

C97.1 says 1 to 500,000; `radiusMeters` was `.positive()`, so 0.5 passed the schema and the
normaliser answered `out_of_range`. RED:

```
$ (cd packages/contracts && pnpm exec vitest run src/lists.test.ts --coverage.enabled=false)
     × caps a geolocation item at 500 km and keeps the ranges of C97.1
AssertionError: expected [Function] to throw an error
      Tests  1 failed | 45 passed (46)
```

GREEN: `radiusMeters = z.number().min(1).max(LIST_LIMITS.radiusMeters)`; `problem.ts` now says
`field_schema_invalid` also answers a value that breaks its field (transaction-schemas deviation 3,
a comment only). `openapi:write` changes three `radius-meters` schemas (`exclusiveMinimum: 0` to
`minimum: 1`); no fixture or node type names the radius.

```
$ (cd packages/contracts && pnpm exec vitest run src/lists.test.ts src/problem.test.ts --coverage.enabled=false)
      Tests  62 passed (62)
$ pnpm --filter @openverify/api openapi:write && git diff --stat docs/api/openapi.json
 docs/api/openapi.json | 10 +++-------
```

## 6. Defect: a body nested past the stack answered 500 (transaction-schemas followup)

`fieldSchemaSchema` is recursive, so zod overflowed the stack on a type body nested about a
thousand levels deep, at the route, and the problem handler answered 500. RED:

```
$ (cd apps/api && pnpm exec vitest run src/routes/transaction-routes.test.ts -t "nested far" --coverage.enabled=false)
     × answers 400, never 500, for a field schema nested far past the caps (C104.2)
AssertionError: expected 500 to be 400
```

GREEN: `buildApp` sets `stackSafeValidatorCompiler` (`app.ts`): the zod validator, with a
`RangeError` turned into one validation issue (`is nested more deeply than this operation reads`),
which the problem handler answers 400 like any other.

```
$ (cd apps/api && pnpm exec vitest run src/routes/transaction-routes.test.ts src/app.test.ts src/problem-details.test.ts --coverage.enabled=false)
      Tests  73 passed (73)
```

## 7. The seeded custom-list template's own settings (C106.2)

Decision: the seeded `Default custom list` stores `list-ids: null` explicitly (a fresh environment
has no list, so nothing is pinned and each report names its own lists; the console shows the
setting rather than an empty config), and stays non-recurring. RED:

```
$ (cd apps/api && pnpm exec vitest run src/seed/report-templates.test.ts --coverage.enabled=false)
     × seeds the custom-list template with no pinned list, so each report names its own (C106.2)
AssertionError: expected {} to deeply equal { 'list-ids': null }
      Tests  1 failed | 4 passed (5)
```

GREEN:

```
$ (cd apps/api && pnpm exec vitest run src/seed --coverage.enabled=false)
      Tests  49 passed (49)
```

## 8. e2e: a second code to the same address (`waitForMail`'s `exceptIds`)

The graph spec confirms one address on two inquiries, so the second code must not be read from the
first mail. `waitForMail` now returns Mailpit's message `id` and takes `exceptIds`. Stub `chore(e2e)`
(types only), then RED:

```
$ (cd e2e && pnpm exec vitest run src/mailpit.test.ts --coverage.enabled=false)
     × finds the newest message to an address through the Mailpit API and reads it
     × skips the messages it is told were read already, waiting for a newer one
      Tests  2 failed | 3 passed (5)
```

GREEN:

```
$ (cd e2e && pnpm exec vitest run src/mailpit.test.ts --coverage.enabled=false)
      Tests  5 passed (5)
```

## 9. Defect: an import skipped by its own enqueue's write (found by `lists.spec.ts`)

On the reusable stack the CSV importer stayed `pending`: Redis showed the `list-import` job
`completed` with `{"status":"skipped"}` 4 ms after it was added, and the row showed `attempts 0`.
The API (and the sweep) add the job, then write `enqueued_at`; the job takes its row with
`FOR UPDATE SKIP LOCKED`, so when it met that write's row lock it skipped its own import, which
then waited for the sweep's 2-minute window (and could lose the same race again). RED, in both
producers:

```
$ (cd apps/api && pnpm exec vitest run src/jobs/importers/sweep.test.ts src/routes/server/importers.test.ts --coverage.enabled=false)
     × records each enqueue before the job exists, so the job never meets that write’s row lock
AssertionError: expected [ null ] to deeply equal [ 2026-10-20T12:00:00.000Z ]
     × records the enqueue before the job exists, so the job never meets that write’s row lock
AssertionError: expected null to be an instance of Date
      Tests  2 failed | 67 passed (69)
```

GREEN: both producers record `enqueued_at` first, then add the job; a lost enqueue clears it again
(`markImportersEnqueued(db, rows, null)`), so the next sweep tick still recovers it, as before.

```
$ (cd apps/api && pnpm exec vitest run src/jobs/importers src/routes/server/importers.test.ts src/services/importers --coverage.enabled=false)
      Tests  184 passed (184)
$ (cd packages/db && pnpm exec vitest run src/repositories/importers.test.ts --coverage.enabled=false)
      Tests  25 passed (25)
```

## 10. The 7B full-stack specs (C111.2)

Each states a 90 s budget in its header and sets `test.setTimeout(90_000)`; each creates its own
lists, templates, accounts and inquiries with a random run id; every value is synthetic (`.test`
addresses, which a sandbox answers without a DNS query, C56). Helpers: `tests/support/phase7b.ts`
(`emailCodeTemplate`, `confirmEmailInquiry`, `waitForInquiryStatus`, `base64Csv`).

- `lists.spec.ts`: an email list filled by a CSV import (the worker's `list-import` job through the
  real `ListItemWriter`), an inquiry whose confirmed OTP address is listed, `list-match.created`
  verified (signed, no value in the body), `on-list-match: needs_review` moves the inquiry, and the
  match is dismissed with a reason. It found defect 9.
- `graph.spec.ts`: two accounts whose inquiries confirm the same address are linked by an
  asynchronous template query (the `graph-query` job), the property node a random `gn_` id that names
  no value; `add-tag` in bulk tags both.
- `transactions.spec.ts`: a type published (version 1 is a draft with no route to its id, so a second
  draft carries the content), a transaction created, found by its searchable field, its status
  updated, labelled and redacted (the `never` field kept); `transaction.created`, `.status-updated`
  (with `meta { from, to }`), `.labeled` and `.redacted` delivered signed with no field value.
- `custom-list-report.spec.ts`: on the seeded `Default custom list`, a listed address matches (R,
  exact, with list provenance), another answers `ready` with `has-match: false` and nothing
  unscreened, and a report with no list answers 422 `report_lists_required`.

On a fresh reusable stack (after the defect 9 fix), one call, load 1.46:

```
$ OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/lists.spec.ts tests/graph.spec.ts tests/transactions.spec.ts tests/custom-list-report.spec.ts
  ✓  custom-list-report.spec.ts (824ms)
  ✓  graph.spec.ts (6.8s)
  ✓  lists.spec.ts (14.8s)
  ✓  transactions.spec.ts (396ms)
  4 passed (24.6s)
```

## 11. `@openverify/node`: `graphQueries.createSync` and the account includes of Workflow 7B

The client could not send `meta.run-sync` (C102.4) and typed `accounts.retrieve`'s `include` as
`'reports'` only, though the API serves `list-matches` and `transactions` (contracts-7b amendment 24).
Stub (types, `createSync` sending no meta), then RED; the includes test is a characterisation test
(the query builder already joined arrays), green once the type allowed it.

```
$ (cd packages/node && pnpm exec vitest run src/resources.test.ts --coverage.enabled=false)
     × graphQueries.createSync
      Tests  1 failed | 161 passed (162)
```

GREEN:

```
$ (cd packages/node && pnpm exec vitest run --coverage.enabled=false)
      Tests  305 passed (305)
```

## 12. Validation fixes

- `pnpm turbo run lint typecheck --force` (validation step 2) failed once at `@openverify/api#lint`:
  `jobs/report-types/custom-list.ts:42` `no-unnecessary-type-assertion`, because the applied hooks
  patch gave `ReportRunResult` its `listSources` member. `eslint --fix` dropped the cast; the
  custom-list tests stay green (11 passed).

## 13. The full-stack suite re-measured (C111.2, owner decision 18 after Workflow 7A)

On a fresh reusable stack (stack start 56 s, load 3.68 before), each step its own call under
`/tmp/openverify-e2e.lock`:

| Shard | Tests | Time | Load after |
|---|---|---|---|
| 1/3 | 34 | 2.1 min | 1.92 |
| 2/3 | 32 | 3.5 min | 1.69 |
| 3/3 | 33 | 4.0 min | 3.45 |

99 tests (95 at the end of 7A, plus the four 7B specs) in 9.6 minutes plus 0.9 minutes for the stack
start, against 9.9 minutes at the end of 7A. Each shard stays under 8 minutes, so the shard count
stays 3, and the suite still fits the one CI e2e job (12.5 to 15 of its 70 minutes after Phase 6):
CI keeps running `pnpm e2e`, no shard matrix. The 7B specs inside the shards: `custom-list-report`
0.8 s, `transactions` 0.3 s, `graph` 16.0 s, `lists` 16.8 s. `e2e/README.md` cites this measurement.
The SDK host-test count is still 1,327 (the Android gate's results), so CI's floor stays 1,327.

## Report (integration-7b)

### Summary

Workflow 7B Stage 4 is done in 30 path-scoped commits (6a0e2bc5..16e85aa8 and the report commit) on base be24b16e; nothing pushed, no dependency or environment variable added, git status clean (the orchestrator's untracked 31-Oct-openverify-session-state.txt left alone), no e2e container left running. Hooks: the api-lists hooks patch is applied (container hunk by hand), so the real ListService, CompromisedIdLookup and worker ListItemWriter are live, include=list-matches serves, custom-list provenance persists; both processes give the graph indexer their blind-index key; an asynchronous graph query run is now audited. Defects fixed test-first: platform-file ids are file_ (the engine read fil_), a multipart part filename leaked into stored API logs, a deeply nested type body answered 500, the radius allowed 0.5, and the e2e lists spec found that an import could skip itself (the producer wrote enqueued_at after adding the job, which the job's SKIP LOCKED met). The node client gained graphQueries.createSync and the 7B account includes; the seeded custom-list template stores list-ids null. Four 7B full-stack specs pass (lists, graph, transactions, custom-list-report). Docs: docs/lists (3 pages), docs/graph, docs/transactions, the completed custom-list page and the 7B sandbox section; the Stage 2, Stage 3 and Stage 4 plan amendments are recorded. The whole Validation list passed in the foreground, every step rc 0: format, forced lint+typecheck 30/30, fetches, pnpm test (14 packages + API 5,871 tests at 95.6%), benchmark typecheck/test, test:integration (69+216), vision (2,547 pytest, 97.43%), Android gate, openapi:write with no diff, the e2e gate (79 mocked; 34/32/33 full stack on a fresh reusable stack), both images, all 8 infra tests, gitleaks.

### Handoff

## How to run
- `source scripts/env.sh` first. Evidence: `docs/tdd/phase7-integration-7b.tdd.md` (sections 1-13 and this report). Plan: "Workflow 7B Stage 2 amendments", "Workflow 7B Stage 3 amendments", "Workflow 7B Stage 4 amendments (integration-7b)" at the end of `docs/plans/phase-7.plan.md`.
- The 7B specs on a reusable stack (Stage 1a/4 form, one step per call under `/tmp/openverify-e2e.lock`): `pnpm turbo run build --filter=@openverify/e2e^...`; `pnpm --filter @openverify/e2e e2e:stack:down`; `pnpm --filter @openverify/e2e e2e:stack:up`; `sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test tests/lists.spec.ts tests/graph.spec.ts tests/transactions.spec.ts tests/custom-list-report.spec.ts'`; `e2e:stack:down`. Shards stay 3.

## New and changed names
- `apps/api/src/app.ts`: `stackSafeValidatorCompiler` (module-private), set by `buildApp`: a `RangeError` from a recursive zod schema becomes one validation issue (400).
- `apps/api/src/container.ts`: `listService: createListService({ db, blindIndexKey: config.blindIndexKey, rateLimiter })`; `useGraphIndexKey(config.blindIndexKey)` at start.
- `apps/api/src/worker.ts`: `useGraphIndexKey(options.blindIndexKey)` at start; `compromisedIds: createCompromisedIdLookup({ db, blindIndexKey, events })` in the verification deps; the list-import writer `lists.writer ?? createListItemWriter({ blindIndexKey })` (unbuilt only without a key).
- `apps/api/src/jobs/graph/query.ts`: `store` writes `appendSystemAuditEntry(tx, env, { action: STATUS_EVENTS[status], resourceType: 'graph-query', resourceId, metadata: countsOf(stored) })`.
- `packages/db` `markImportersEnqueued(db, rows, at: Date | null)`: producers (API `services/importers/importers.ts` `enqueue`, `jobs/importers/sweep.ts`) record it BEFORE adding the job and clear it (null) when the enqueue is lost.
- `apps/api/src/services/api-logs.ts` `MASKED_MEMBERS` gains `filename`.
- `packages/core/src/transactions/fields-validator.ts`: `PLATFORM_FILE_ID = /^file_<ULID>$/`.
- `packages/contracts/src/lists.ts`: `radiusMeters = z.number().min(1).max(500000)`; OpenAPI regenerated (3 schemas).
- `apps/api/src/seed/report-templates.ts`: the custom-list template config gets `'list-ids': null`.
- `@openverify/node`: `graphQueries.createSync(attributes, options?)` (sends `meta: { 'run-sync': true }`); `accounts.retrieve(id, { include?: AccountInclude | AccountInclude[] })` with `reports`, `list-matches`, `transactions`.
- `e2e/src/mailpit.ts`: `Mail.id`; `WaitForMailOptions.exceptIds`.
- `e2e/tests/support/phase7b.ts`: `emailCodeTemplate(client, name, listConfig?)`, `confirmEmailInquiry(stack, client, { templateId, referenceId, address, accountId?, exceptMailIds? }) => { inquiryId, mailId }`, `waitForInquiryStatus(client, inquiryId, status, timeoutMs?)`, `base64Csv(header, rows)`.
- Specs: `e2e/tests/{lists,graph,transactions,custom-list-report}.spec.ts` (90 s each). Synthetic addresses at `.test` (C56: a sandbox answers them without DNS).
- Docs: `docs/lists/{README,importers,biometric}.md`, `docs/graph/README.md`, `docs/transactions/README.md`, `docs/reports/custom-list.md`, `docs/checks/sandbox-providers.md` ("Phase 7 lists, graph and transactions").

## Facts for 7C
- Full-stack suite: 99 tests, shards 2.1/3.5/4.0 min + 0.9 min stack start. CI keeps `pnpm e2e` (one job). SDK host-test floor stays 1,327 (unchanged count).
- A transaction type's version 1 is a draft with no route to its id: create a second draft to find an id (the spec does). No route lists versions.
- `graphQueries.create` is asynchronous; poll `retrieve` until `completed`. The `graph-index` job runs within the 15 s sweep after an inquiry completes; a confirmed OTP email is the strong `email_address`.
- System audit entries (the async graph query run) are not served by `GET /user-audit-logs` until K7A-8.

### contractDeviations

1. Hooks in the shared files (Stage 3 reports): applied docs/tdd/phase7-api-lists.hooks.patch (its container.ts hunk by hand, the context had drifted), and both processes call useGraphIndexKey(<configured blind-index key>) at start (api-graph deviation 1); the worker's list-import writer is createListItemWriter whenever the worker holds a key (api-importers followup).
2. C104.2 amended: a platform-file value is the platform file id, file_ plus a ULID (ID_PREFIXES.file), not fil_. packages/core/src/transactions/fields-validator.ts PLATFORM_FILE_ID; the golden constant and 'a short id' case of fields-validator.test.ts changed with the plan, and the stale comment in services/transactions/transactions.test.ts went.
3. Rule 11: 'filename' joins MASKED_MEMBERS in apps/api/src/services/api-logs.ts, so a multipart part's file name (a CSV import, a transaction file) is null in a stored API log read without pii:view (api-importers deviation 1).
4. C97.1: radius-meters is z.number().min(1) (was .positive()), and the problem.ts comment says field_schema_invalid also answers a value that breaks its field (transaction-schemas deviation 3). docs/api/openapi.json regenerated (three radius schemas: minimum 1); the only OpenAPI change after Stage 1.
5. C102.7: an asynchronous graph query run is audited as a system audit entry (appendSystemAuditEntry with countsOf) inside jobs/graph/query.ts's store transaction, instead of adding an audit logger to GraphQueryDeps (api-graph deviation 6). System entries are not served by GET /user-audit-logs until K7A-8.
6. C100.2 defect found by lists.spec.ts and fixed: a list-import producer (the API and the list-import-sweep) records enqueued_at before adding the job and clears it when the enqueue is lost; markImportersEnqueued takes Date | null. Before, the job's FOR UPDATE SKIP LOCKED met the producer's post-add write and skipped its own import until the sweep's 2-minute window.
7. Defect: a request body nested past the stack (C104.2's recursive field schemas, about 1,000 levels) answered 500; buildApp's stackSafeValidatorCompiler turns the RangeError into a 400 validation problem (transaction-schemas followup). Applies to every route on the global validator; the routes with their own validatorCompiler (flow, importers, transactions, webhooks) keep theirs.
8. C106.2: the seeded Default custom list stores 'list-ids': null explicitly (not recurring), so each report names its lists; a fresh environment has none to pin.
9. @openverify/node beyond a regeneration: graphQueries.createSync (meta.run-sync) and accounts.retrieve include of reports, list-matches and transactions. The export action (text/csv) still has no client method.
10. e2e: the 7B specs use .test addresses (RFC 2606, answered without a DNS query in a sandbox, C56), as every earlier email spec does, rather than example.com, which the sandbox MX check would look up. waitForMail gains Mail.id and exceptIds.
11. Not changed (proposals for 7C or the owner, recorded in the Stage 3/4 amendments): problem codes relation_cardinality_exceeded and related_objects_limit (422s without a code today); GET /transaction-type-versions?filter[transaction-type-id]=; a served graph component (C101.6); a dotted field-key for nested type events; 409/404 on the frozen list routes; ApiDependencies.dashboardPublicUrl for explorer-url (it reads OPENVERIFY_DASHBOARD_PUBLIC_URL from the process); exporting canonicalSubdivision; a purge for replaced transaction files whose delete failed; the owner's open (T) item 7.
12. Existing tests changed with the plan, none weakened: fields-validator.test.ts (file_ ids, item 2). No other existing assertion changed; the new tests were added beside them. Characterisation tests (green at first run, recorded): the accounts.retrieve include test in packages/node (types-only change).
13. Rule-5 deviation recorded: style commit 96ab32c8 (an eslint --fix of api-lists' custom-list.ts) is not a TDD cycle; it removed a cast the applied hooks patch made unnecessary, found by validation step 2.

### Followups

- 7C (contracts): codes for a second cardinality-one relation target and the 100 related-objects cap (relation_cardinality_exceeded, related_objects_limit); a route listing a transaction type's versions; a served graph component for C101.6's account page.
- 7C or the owner: decide foundation-7b (T) item 7 (account or inquiry redaction reaching transactions) and transaction-schemas' nested type events (a dotted field-key).
- 7C: the node client has no method for the graph export (text/csv); docs/graph says to read it with your own request.
- 7C (K7A-8): system audit entries, now also written for asynchronous graph query runs, are not served by GET /user-audit-logs.
- 7C: export canonicalSubdivision from packages/checks/src/matching/addresses.ts and drop list-logic's copy in address-key.ts; ApiDependencies.dashboardPublicUrl for explorer-url; a purge of replaced transaction files whose object delete failed.
- Owner or Phase 11: the face and background list thresholds need a list-specific calibration before GA; the fuzzy-name candidate cap (117 of 300 heavy-headed probes over it at 1,000,000 items) needs a quality calibration to change.
- Owner or 7C: the stale e2e app processes another agent's capped calls left (foundation-7b followup) were not seen in this run; check before 7C's first stack.
- Orchestrator: the untracked 31-Oct-openverify-session-state.txt in the repo root is not mine and was left alone.

### Measurements

- Full-stack e2e on a fresh reusable stack: 99 tests; shard 1/3 34 in 2.1 min (load 3.85 -> 1.92), 2/3 32 in 3.5 min (-> 1.69), 3/3 33 in 4.0 min (-> 3.45); stack start 56 s. Total 9.6 + 0.9 min (7A: 9.9 min for 95). Shards stay 3; CI keeps one e2e job.
- 7B spec durations inside the shards: custom-list-report 0.8 s, transactions 0.3 s, graph 16.0 s, lists 16.8 s; alone on a fresh stack (load 1.46): 0.8 s, 0.4 s, 6.8 s, 14.8 s (all four 24.6 s).
- Mocked flow suite: 79 passed in 20.0 s.
- API unit suite: 433 files, 5,871 tests, 95.6 / 87.04 / 97.62 / 95.64 (statements/branches/functions/lines); shards 4.4 min (load 2.4) and 3.9 min (load 6.2), merge 5 s.
- Other packages (pnpm turbo run test --force --filter=!@openverify/api, 6 min 41 s): e2e unit 110 (97.17%), node 305 (98.7), flow-spec 117 (100), core 1,178 (99.92), signals 186 (96.31), config 187 (100), ui 54 (100), emrtd 318 (94.97), contracts 2,616 (99.12), checks 3,791 (98.79), flow 1,088 (95.27), db 1,512 (95.24), dashboard 3,971 (98.71), watchlist 759 (98.63).
- test:integration: db 69, api 216 (4 min 9 s, load 3.5).
- Vision: pytest 1,466 + 1,081 passed (4 min 2 s + 4 min 55 s), coverage 97.43%.
- Android gate: BUILD SUCCESSFUL in 11 s (up to date); SDK host tests 1,327, 0 failed, 0 skipped: the CI floor stays 1,327.
- Forced turbo lint+typecheck: 30/30 in 3 min 24 s (load 7.7 -> 9.3).
- Apps image build 2 min 34 s; vision image 29 s; gitleaks 3,856 commits in 3.5 s.

### Blockers

None.

### Environment variables and dependencies

None added.
