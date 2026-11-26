# TDD evidence: Phase 6, Workflow 6A Stage 3, `api-reports`

The report engine: reports, runs, matches and actions (C70, C73, C74, C75), the run framework, the
sweep, the matching report types, review, redaction, the completion hook and the account,
include and filter hooks (C84). Each slice went stub, then RED (run and seen failing for its
intended reason), then GREEN. Commands run from the repository root after `source scripts/env.sh`.

**Two copies, one record.** From about 19:43 to 19:55 a second copy of this agent, started by
mistake from this agent's own transcript, worked in the same paths. It built the report
templates (the source catalog, the template repository, service and routes) and committed
`290f96f6`, `e6babfff`, `15193a98`, `988386b0` and `79ca54ac`; its evidence was never written,
so it is entered below ("Slice T1" and "Slice T2") from `git show` and the shared transcript.
The orchestrator stopped the second copy at 19:55; this agent owns the whole scope again. The
seeded templates (`seed/report-templates.ts`) belong to `api-watchlists` (foundation-6's hook
commit `501859a5`).

## Slice 1: the report, run, match and action repositories (`packages/db`)

- Stub: `e5b7806d` (signatures of all five repository files, each body throwing "not
  implemented").
- RED: `cebded82`, `packages/db/src/repositories/report-repositories.test.ts`.

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/report-repositories.test.ts --coverage.enabled=false
 FAIL  src/repositories/report-repositories.test.ts > report matches and actions (C75, C74.2) > appends actions with sealed details, newest first
Error: createReportTemplate is not implemented yet (3 arguments)
 Test Files  1 failed (1)
      Tests  14 failed (14)
```

- The template cases left the file (`38e999fe`) when the second agent took the template
  repository over; the remaining ten cases call only `createReportTemplate`, whose signature both
  versions share.
- GREEN: `42312a4f`. The first run failed one case for a reason of the implementation, not of the
  test: the redaction set `openverify.report_redaction` with `set_config(..., true)` outside a
  transaction, so the trigger refused the action update:

```
FAIL  > reports (C70, C72, C73) > redacts the query, result, every match index and snapshot and every action detail (C73.5)
Error: Failed query: update "report_actions" set "details" = $1 ... PL/pgSQL function openverify_report_actions_append_only() line 19 at RAISE
      Tests  1 failed | 9 passed (10)
```

  `redactReportRecords` now runs in a transaction of its own (a savepoint inside the caller's):

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/report-repositories.test.ts --coverage.enabled=false
      Tests  10 passed (10)
```

## Slice T1: the watchlist source catalog (`services/reports/source-catalog.ts`; second copy)

- Stub: `290f96f6` (the catalog's types and loader; it read nothing).
- RED: `e6babfff`, `apps/api/src/services/reports/source-catalog.test.ts` (6 cases; the empty
  catalog without a manifest passes against the stub by design). From the shared transcript,
  19:46:43:

```
$ pnpm --filter @openverify/api exec vitest run src/services/reports/source-catalog.test.ts --coverage.enabled=false
 FAIL  src/services/reports/source-catalog.test.ts > the catalog in force > can be replaced and restored
AssertionError: expected undefined to be 'US Treasury OFAC' // Object.is equality
      Tests  5 failed | 1 passed (6)
```

- GREEN: `15193a98` (the manifest read leniently by the C76.1 field names; the flag code guessed
  from the id's first word).

## Slice T2: report templates and versions (C71.1, C71.2; second copy)

- Stub: the frozen route plugins `routes/server/report-template{s,-versions}.ts` (every handler
  501, `foundation-6`) and the template repository signatures of `e5b7806d`.
- RED: `988386b0`, `apps/api/src/routes/server/report-templates.test.ts` with the helpers of
  `services/reports/testing.ts`. From the shared transcript, 19:49:41:

```
$ pnpm --filter @openverify/api exec vitest run src/routes/server/report-templates.test.ts --coverage.enabled=false
 FAIL  src/routes/server/report-templates.test.ts > POST /report-templates (C71.1, C71.2) > pins only the enabled, not sandbox-only sources of the kind in production
Error: expected HTTP 201, got 501: {"type":"about:blank","title":"Not Implemented","status":501,"detail":"Report templates are not built yet.", ...}
 FAIL  src/routes/server/report-templates.test.ts > POST /report-templates (C71.1, C71.2) > refuses a sandbox-only, unknown, other-kind or empty source list (422 with pointers)
AssertionError: expected { status: 501, code: undefined, …(1) } to deeply equal { status: 422, …(2) }
```

- GREEN: `79ca54ac` (`services/reports/{templates,validation}.ts`, the handlers, and
  `packages/db/src/repositories/report-templates.ts` with `listWatchlistSourceRows`). Re-run by
  this agent on resuming:

```
$ pnpm --filter @openverify/api exec vitest run src/services/reports/source-catalog.test.ts src/routes/server/report-templates.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  14 passed (14)
```

## Slice 2: the report service and server routes (create, read, list, tags, history, monitoring)

- Stub: the frozen route plugin `routes/server/reports.ts` (every handler 501, `foundation-6`).
- RED: `38d676ac`, `apps/api/src/routes/server/reports.test.ts` (14 cases):

```
$ pnpm --filter @openverify/api exec vitest run src/routes/server/reports.test.ts --coverage.enabled=false
     × creates a pending report with its initial run enqueued and a new home account 193ms
     ...
     × answers with the report once its initial run completed 8ms
Error: expected HTTP 201, got 501: {"type":"about:blank","title":"Not Implemented","status":501,"detail":"Reports are not built yet.", ...}
```

- GREEN: `cf1dc1fd` (`services/reports/{resources,reports}.ts`, the handlers). The first GREEN run
  failed three cases, each a defect of the test or of the code it found:
  - the test expected `account.created` from the harness's accounts fake, which stages no event
    (the real service does): the assertion was dropped;
  - the two 403 bodies differ only in their `requestId`, which the comparison now leaves out;
  - the history sorted ties by the whole id, so `rpr_` sorted before `ract_` whatever the time: the
    service now compares the ULID part (a defect of the code); a run's action is created after its
    run in one transaction, so it lists first.
- The frozen `report-routes.test.ts` (`foundation-6`'s 501 expectations, which the owner
  replaces): the built report routes now answer from their handlers; redaction, dismissal and
  review keep their 501 until their slices.

```
$ pnpm --filter @openverify/api exec vitest run src/routes/server/reports.test.ts src/routes/server/report-routes.test.ts --coverage.enabled=false
      Tests  54 passed (54)
```

## Slice 3: the run framework (`jobs/reports/run.ts`, `persist.ts`)

- Stub: `91e1cca2` (`createReportRunProcessor`, the claim lease, run timeout and claim cap
  constants; the processor claims nothing).
- RED: `e195b34c`, `apps/api/src/jobs/reports/run.test.ts` (16 cases; the two that assert nothing
  is written, the lost claim and `on-report-match: none`, pass against the stub by design):

```
$ pnpm --filter @openverify/api exec vitest run src/jobs/reports/run.test.ts --coverage.enabled=false
     × creates an open, pending match, completes the run and the report, and fires matched then ready 81ms
     ...
AssertionError: expected { outcome: 'not_claimed' } to deeply equal { outcome: 'completed', …(1) }
AssertionError: expected [] to deeply equal [ 'report/watchlist.ready' ]
AssertionError: expected undefined to be 'delisted' // Object.is equality
      Tests  14 failed | 2 passed (16)
```

- GREEN: `713b1c64` (with `finishReportRun` keeping the notes a run had before it completed):

```
$ pnpm --filter @openverify/api exec vitest run src/jobs/reports/run.test.ts --coverage.enabled=false
      Tests  16 passed (16)
$ pnpm --filter @openverify/api exec vitest run src/worker.test.ts src/worker-startup.test.ts src/jobs/report-types src/jobs/report-queues.test.ts src/jobs/repeatable --coverage.enabled=false
      Tests  86 passed (86)
```

## Slice 4: the report sweep (`jobs/reports/sweep.ts`)

- Stub: `208f08a1` (`createReportSweep` with its recovery and batch sizes; it does nothing).
- RED: the five cases of `apps/api/src/jobs/reports/sweep.test.ts` (the skip case passes against
  the stub by design):

```
$ pnpm --filter @openverify/api exec vitest run src/jobs/reports/sweep.test.ts --coverage.enabled=false
AssertionError: expected 0 to be greater than or equal to 1
AssertionError: expected +0 to be 2 // Object.is equality
AssertionError: expected [] to have a length of 1 but got +0
      Tests  4 failed | 1 passed (5)
```

- GREEN:

```
$ pnpm --filter @openverify/api exec vitest run src/jobs/reports/sweep.test.ts src/jobs/repeatable --coverage.enabled=false
      Tests  27 passed (27)
```

## Slice 5: the matching report jobs (`jobs/reports/screening.ts`, the four type jobs)

Resumed from uncommitted drafts of the first run that had never run; they were moved aside, the
type jobs put back to `foundation-6`'s unbuilt stubs, and the slice restarted from a stub.

- Stub: `4724a1b0` (the screening kit only: the watchlist reads, the variant groups through
  `api-watchlists`' `loadMatcherData`, the source catalog; tests replace each part).
- RED: `836fb8d3`, `apps/api/src/jobs/report-types/matching-reports.test.ts` (24 cases, the
  in-memory reads of `test-support/fakes.ts` over the synthetic sandbox lists):

```
$ pnpm --filter @openverify/api exec vitest run src/jobs/report-types/matching-reports.test.ts --coverage.enabled=false
 FAIL  src/jobs/report-types/matching-reports.test.ts > politically-exposed-person (C80.5) > errors list_unavailable for a production PEP template before any sync (V01)
ReportTypeNotBuiltError: The politically-exposed-person report job is not built yet
 ❯ Object.run src/jobs/report-types/job.ts:173:44
      Tests  24 failed (24)
```

- GREEN: `screening.ts` (`screenableSources`, `screenNames`, `screenCrypto`) and the four jobs.
  The first run failed one case for a defect of the test: its catalog lacked
  `uk-sanctions-list`, so that source was unknown (`list_unavailable`) rather than keyed by
  another version. With the catalog entry:

```
$ pnpm --filter @openverify/api exec vitest run src/jobs/report-types/matching-reports.test.ts --coverage.enabled=false
      Tests  24 passed (24)
```

  (The catalog line was left out of the GREEN commit `43049a5f` and committed on its own at
  `48008ad5`.)

- Written after the code, and passing at once (a pin, not a RED): `matching-reports-db.test.ts`
  imports the sandbox lists through `api-watchlists`' real sync, screens through the real frozen
  reads on PGlite, persists through the framework and parses each served resource with
  `reportResourceSchema` (5 cases).
- `jobs/report-types/index.test.ts` (`foundation-6`'s) asserted that the registered `watchlist`
  job is unbuilt; it now asserts the unbuilt rule through `unbuiltReportTypeJob('watchlist')`,
  since the plan builds that job.

```
$ pnpm --filter @openverify/api exec vitest run src/jobs/report-types/matching-reports src/jobs/report-types/index.test.ts src/jobs/reports/run.test.ts --coverage.enabled=false
      Tests  47 passed (47)
```

## Slice 6: dismissal and review (C75, `services/reports/review.ts`)

- Stub: the frozen `POST /reports/:id/{dismiss,review}` handlers (501, `foundation-6`).
- RED: `2e7579f4`, `apps/api/src/routes/server/report-review.test.ts` (13 cases; the matches come
  from framework runs with a fake type job):

```
$ pnpm --filter @openverify/api exec vitest run src/routes/server/report-review.test.ts --coverage.enabled=false
     × dismisses every open match into the ignore list, fires dismissed with the match ids and records the action 380ms
     ...
     × resumes a report paused on a match once no open match is unreviewed (C74.5) 141ms
Error: expected HTTP 200, got 501: {"type":"about:blank","title":"Not Implemented","status":501,"detail":"Reports are not built yet.", ...}
```

- GREEN: `services/reports/review.ts` (`dismissReportMatches`, `reviewReportMatches`) and the two
  handlers. The first run failed the API-log case for a defect of the test: it read the stored
  row, which keeps the body as sent, and then an API key, which sees PII unless masked; the
  masking of P04 is at read time for a user without `pii:view`. The case now reads
  `GET /api-logs` with such a user:

```
$ pnpm --filter @openverify/api exec vitest run src/routes/server/report-review.test.ts --coverage.enabled=false
      Tests  13 passed (13)
```

- `routes/server/report-routes.test.ts` (`foundation-6`'s 501 expectations): dismissal and review
  now answer from their handlers (a 409 for the seeded pending report is allowed); redaction keeps
  its 501 until slice 7.

```
$ pnpm --filter @openverify/api exec vitest run src/routes/server/report-routes.test.ts src/routes/server/report-review.test.ts --coverage.enabled=false
      Tests  53 passed (53)
```

## Slice 7: redaction, its cascades and the index rebuild (C73.4, C73.5)

- Stubs: the frozen `DELETE /reports/:id` handler (501), the hooks of
  `services/reports/redaction.ts` and `rebuildReportIndexes` (`foundation-6`).
- RED: `ca5d37b8` (`apps/api/src/routes/server/report-redaction.test.ts`, 6 cases, with the real
  redaction and accounts services; `packages/db/src/repositories/report-indexes.test.ts`, 2
  cases). The RED commit left two raw-row callbacks untyped; `f70652da` typed them, so the test
  typechecks (no assertion changed).

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/report-indexes.test.ts --coverage.enabled=false
     × recomputes every index under the new key from stored values, skips redacted rows and is idempotent 85ms
Error: rebuildReportIndexes is not implemented yet (owner: api-reports; batch size 1)
      Tests  1 failed | 1 passed (2)
$ pnpm --filter @openverify/api exec vitest run src/routes/server/report-redaction.test.ts --coverage.enabled=false
Error: expected HTTP 200, got 501: {"type":"about:blank","title":"Not Implemented","status":501,"detail":"Reports are not built yet.", ...}
AssertionError: expected 501 to be 404 // Object.is equality
AssertionError: expected null not to be null
AssertionError: rep_01M601VDYJSM8NXSKNYAHTFJXJ: expected null not to be null
Error: rebuildReportIndexes is not implemented yet (owner: api-reports; batch size default)
      Tests  6 failed (6)
```

  (The first RED run called `DELETE /inquiries/:id` and `DELETE /accounts/:id`, which do not exist;
  the test uses `POST /{inquiries,accounts}/:id/redact` before the commit.)

- GREEN: `redactReportInTx` (the row locked, the earlier events stubbed and the stored API copies
  cleared before `.redacted` is staged, `redactReportRecords`), the inquiry and account hooks over
  `listInquiryReportIds` and `listAccountReportIds`, `redactReportResource` and the handler;
  `rebuildReportIndexes` in id-ordered batches from the sealed result's canonical address and the
  sealed snapshot's entry key and evidence input. `report-routes.test.ts` no longer expects a 501.

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/report-indexes.test.ts src/repositories/report-repositories.test.ts --coverage.enabled=false
      Tests  12 passed (12)
$ pnpm --filter @openverify/api exec vitest run src/routes/server/report-redaction.test.ts src/routes/server/report-routes.test.ts src/services/report-redaction-hooks.test.ts src/services/redaction.test.ts src/routes/server/report-review.test.ts --coverage.enabled=false
      Tests  88 passed (88)
$ pnpm --filter @openverify/api exec vitest run src/services/retention.test.ts src/retention-run.test.ts src/jobs/retention.test.ts src/routes/server/accounts.test.ts src/blind-index-rebuild.test.ts --coverage.enabled=false
      Tests  109 passed (109)
```

## Slice 8: the `report-config` publish rule (C84.1, `services/publish/report-config.ts`)

- Stub: `foundation-6`'s rule, which refused every entry.
- RED: `a1d934b7`, `apps/api/src/services/publish/report-config.test.ts`:

```
$ pnpm --filter @openverify/api exec vitest run src/services/publish/report-config.test.ts --coverage.enabled=false
     × accepts active templates with a published version, and an empty list 64ms
     × refuses an unknown, archived, unpublished or other-environment template, each at its pointer 35ms
AssertionError: expected [ { …(3) }, { …(3) } ] to deeply equal []
      Tests  2 failed (2)
```

- GREEN: the rule reads the published version first (the template repository reads a template
  only with its published version and throws without one), then the template's status. The first
  run checked the template first and threw on the unpublished one:

```
Error: report template rptp_01M602V2G24JYKTCVXQW6FQQDF has no published version
$ pnpm --filter @openverify/api exec vitest run src/services/publish/report-config.test.ts src/routes/server/inquiry-template-report-config.test.ts --coverage.enabled=false
      Tests  6 passed (6)
```

## Slice 9: reports on inquiry completion (C84.2, `services/reports/completion.ts`)

- Stub: `foundation-6`'s `createInquiryReportsInTx`, which created nothing. (A first draft of the
  implementation was written before its test by mistake; it was set aside, the committed stub put
  back, and the slice went RED first.)
- RED: `a640c506`, `apps/api/src/services/reports/completion.test.ts` (6 cases, through the real
  `transitionInquiryInTx`):

```
$ pnpm --filter @openverify/api exec vitest run src/services/reports/completion.test.ts --coverage.enabled=false
AssertionError: expected null to match object { status: 'pending', …(7) }
AssertionError: expected undefined to deeply equal { 'name-first': 'Avery', …(4) }
AssertionError: expected [] to have a length of 1 but got +0
      Tests  6 failed (6)
```

  (Its first run failed for a defect of the test: `createTestInquiry` makes a `created` inquiry,
  which cannot move to `completed`; the helper now starts it `pending`.)

- GREEN: the hook builds each entry's query from the verified data first (`QueryBuilder` keeps a
  value only when the type's served query schema takes it) and creates the report with its
  initial run from the published version:

```
$ pnpm --filter @openverify/api exec vitest run src/services/reports/completion.test.ts --coverage.enabled=false
      Tests  6 passed (6)
$ pnpm --filter @openverify/api exec vitest run src/services/report-hooks.test.ts src/services/inquiries.test.ts src/routes/server/inquiries.test.ts --coverage.enabled=false
      Tests  57 passed (57)
```

## Slice 10: the recurring caps of completion reports (C72.5, `jobs/reports/persist.ts`)

The completion hook has no limits (`ReportHookDeps` is `{ events, clock }`), so the initial run of
a completion report applies the caps, where the worker holds them.

- RED: `2f5af36d`, three cases added to `apps/api/src/jobs/reports/run.test.ts`:

```
$ pnpm --filter @openverify/api exec vitest run src/jobs/reports/run.test.ts --coverage.enabled=false
     × runs one beyond the recurring cap once, without a schedule, recording recurring_limit 141ms
     × runs a media one beyond the scheduled media runs once, without a schedule 141ms
AssertionError: expected { …(34) } to match object { nextRunAt: null, …(1) }
AssertionError: expected 2026-10-21T12:00:00.000Z to be null
      Tests  2 failed | 17 passed (19)
```

- GREEN: `beyondRecurringCaps` (the environment's recurring reports, and for a media type its
  scheduled media runs per day, each counting the report itself):

```
$ pnpm --filter @openverify/api exec vitest run src/jobs/reports/run.test.ts src/routes/server/report-review.test.ts --coverage.enabled=false
      Tests  32 passed (32)
```

## Slice 11: consolidation, includes and filter subjects (C70.4, C70.5, C84.4)

- Stubs: `foundation-6`'s `moveReportLinksInTx`, `includedReportsFor` and
  `resolveReportFilterSubjects`, which did nothing.
- RED: `4469d795`, `apps/api/src/services/reports/links.test.ts`:

```
$ pnpm --filter @openverify/api exec vitest run src/services/reports/links.test.ts --coverage.enabled=false
AssertionError: expected { …(34) } to match object { …(2) }
AssertionError: expected [] to deeply equal [ …(2) ]
AssertionError: expected [ {}, {}, {}, {} ] to deeply equal [ …(4) ]
      Tests  4 failed (4)
```

- GREEN: the three hooks over `moveReportAccountLinks`, `listLinkedReportIds` with `getReports`,
  and the inquiry's template and the home account's type read in the environment:

```
$ pnpm --filter @openverify/api exec vitest run src/services/reports/links.test.ts src/routes/server/report-includes.test.ts src/events src/routes/server/accounts.test.ts src/services/accounts.test.ts --coverage.enabled=false
      Tests  96 passed (96)
```

## Slice 12: the console report documents (C72.3, `routes/dashboard/reports.ts`)

- Stub: the frozen handlers (501, `foundation-6`).
- RED: `21effc5d`, `apps/api/src/routes/dashboard/reports.test.ts`:

```
$ pnpm --filter @openverify/api exec vitest run src/routes/dashboard/reports.test.ts --coverage.enabled=false
AssertionError: {"type":"about:blank","title":"Not Implemented","status":501,"detail":"The console reports are not built yet.", ...}: expected 501 to be 200 // Object.is equality
AssertionError: expected 501 to be 404 // Object.is equality
      Tests  3 failed (3)
```

- GREEN: the list through `listReportResources` with the console path, the document through
  `dashboardReportDocument` (the runs and actions newest first), each masked with the operator's
  mask; `report-routes.test.ts` (`foundation-6`'s) no longer expects a 501:

```
$ pnpm --filter @openverify/api exec vitest run src/routes/dashboard/reports.test.ts src/routes/dashboard/report-routes.test.ts --coverage.enabled=false
      Tests  8 passed (8)
```

## Slice 13: race tests on Postgres (C74.1, C74.3, C74.6, C73.7)

Written after the code they exercise (pins, not REDs), on Postgres 17 started with
`POSTGRES_TEST_COMMAND`: `apps/api/src/jobs/reports/report-races.integration.test.ts` (8 cases).
The completion is held inside its transaction by pausing the event publisher's `stage`, which
it calls after its writes and before its commit.

```
$ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/jobs/reports/report-races.integration.test.ts
      Tests  8 passed (8)
```

One case was shown able to fail: with the redaction re-check of `persistRunResult` disabled
(`report.redactedAt !== null && Date.now() < 0`, a scratch mutation, reverted):

```
$ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/jobs/reports/report-races.integration.test.ts -t "discard its result"
     × a redaction committed during the run makes the completion discard its result 257ms
AssertionError: expected { outcome: 'completed', …(1) } to deeply equal { outcome: 'completed', …(1) }
```

Two more cases, written the same way: an API creation linking an inquiry waits for that
inquiry's redaction and answers 410 with nothing created; an inquiry redaction waits for a
creation in progress and redacts the new report:

```
$ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/jobs/reports/report-races.integration.test.ts
      Tests  10 passed (10)
```

Not covered here (follow-ups): API creation against account redaction, completion-hook creation
against consolidation and account redaction, the initial run's account link against
consolidation, re-screen against redaction, and a budget wait run again within 15 s.

## Final gates (2026-10-27, foreground, at `4eceb357` plus the record)

```
$ pnpm --filter @openverify/api test
 Test Files  312 passed (312)
      Tests  4447 passed (4447)
All files          |   96.37 |    88.26 |   98.11 |    96.4 |
   Duration  812.56s
$ pnpm --filter @openverify/db test
 Test Files  75 passed (75)
      Tests  962 passed (962)
All files          |   95.47 |    89.69 |   96.43 |   95.81 |
$ pnpm test:integration
@openverify/db:test:integration:       Tests  59 passed (59)
@openverify/api:test:integration:  ✓ src/jobs/reports/report-races.integration.test.ts (10 tests) 41600ms
@openverify/api:test:integration:       Tests  1 failed | 138 passed (139)
```

The one integration failure is `api-watchlists`' uncommitted, in-progress
`src/watchlists/watchlists.integration.test.ts` (its 100,000-name p95 gate), not a report path.

```
$ pnpm typecheck        ->  Tasks:    14 successful, 14 total
$ pnpm lint             ->  Tasks:    14 successful, 14 total
$ pnpm format:check     ->  All matched files use Prettier code style!
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e
  69 passed (25.2s)
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test --shard=1/2'
  42 passed (6.4m)
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test --shard=2/2'
  40 passed (14.0m)
```
