# Phase 8, Workflow 8D Stage 1: api-carry-cases

The evidence of `api-carry-cases`: the case family of the API items Workflow 8C carried, and every contract, OpenAPI, `@openverify/node`, fixture, table and migration change of Stage 1 (migration `0029`). One section per item, in the order of the task, each with the commands actually run and their trimmed output. RED is the test seen failing for the intended reason; GREEN is the same test after the minimal change. Targeted Vitest runs pass `--coverage.enabled=false`; the package gates run at the end.

**Induced load.** A test that fails only under load is reproduced with `pinned-load.sh <cpu> <loops> <command>` (a scratch script): the command and `<loops>` busy loops are pinned with `taskset` to one CPU, so the test gets a fraction of one core without loading the other agents' CPUs. `cat /proc/loadavg` is written beside each run.

## V8C-1: two tests that timed out under the full validation's load

### apps/api/src/jobs/inquiry-expiry.test.ts

The test made `DEFAULT_SWEEP_LIMIT + 1` (501) redacted overdue inquiries one service call each and expired 503 inquiries in one run, one savepoint each. Measured alone at a load of about 40 (a scratch copy with timers): seeding 5.0 s, the run 14.9 s.

**RED** (CPU 11 shared with 8 busy loops; `cat /proc/loadavg` before 6.43 25.00 19.33, after 12.87 17.40 17.74)

```text
$ pinned-load.sh 11 8 pnpm exec vitest run src/jobs/inquiry-expiry.test.ts --coverage.enabled=false -t "DEFAULT_SWEEP_LIMIT"   # rc=1, 377 s
     × expires DEFAULT_SWEEP_LIMIT + 1 redacted overdue inquiries and the ordinary ones beside them in one run (owner decision 5 after Workflow 6C) 209123ms
Error: Test timed out in 120000ms.
      Tests  1 failed | 6 skipped (7)
```

**GREEN**: the job's own `batchSize` option sets a batch of 4, so a full batch plus one of redacted inquiries fills the first batch exactly as 501 filled the default one, and the run must still reach the two ordinary inquiries behind them: the same code path (`drain` goes on after a full batch that expired rows) at 7 inquiries instead of 503. The test asserts the default batch is larger than 4, and the counts follow `batchSize`. Its explicit 120 s timeout is gone; the file's default applies.

```text
$ pinned-load.sh 11 8 pnpm exec vitest run src/jobs/inquiry-expiry.test.ts --coverage.enabled=false --reporter=verbose   # rc=0, 164 s; loadavg 11.09 16.70 17.50 -> 13.78 16.11 17.19
 ✓ ... > expires a full batch + 1 of redacted overdue inquiries and the ordinary ones beside them in one run (owner decision 5 after Workflow 6C) 2921ms
      Tests  7 passed (7)
```

### packages/db/src/testing.test.ts, "the migrated template on disk"

Three of its five tests each ran a cold migration of every migration into an empty cache directory: "stores the template the first file builds", "rebuilds a stored template it cannot open" and "keeps the most recently used templates only".

**RED** (CPU 11 shared with 12 busy loops; loadavg 12.83 15.87 17.11 -> 16.61 16.50 17.00)

```text
$ pinned-load.sh 11 12 pnpm exec vitest run src/testing.test.ts --coverage.enabled=false --reporter=verbose -t "the migrated template on disk"   # rc=1, 366 s
 × ... > stores the template the first file builds, named by a hash of the migrations 93248ms
 ✓ ... > opens the stored template in a new file instead of migrating again 47372ms
 × ... > rebuilds a stored template it cannot open, and stores the new one 86956ms
 × ... > keeps the most recently used templates only, so changed migrations do not fill the disk 75830ms
 ✓ ... > marks a template as used when it opens it, so pruning keeps the ones in use 22083ms
Error: Test timed out in 60000ms.   (three times)
```

**GREEN**: one cold build in the describe's `beforeAll`, under the package's 120 s PGlite hook guard, starts from what the three tests need (a stored template it cannot open, ten older templates, an abandoned partial write); each test asserts on what that build left (the listing, the stored bytes, the table count), so no test migrates. "Opens the stored template" marks the database the build left open instead of opening another. Every assertion stands: the template's name and directory, the one file the build wrote (the listing without the prepared older templates), its size, more than 50 tables, the garbage replaced, and the exact pruned listing.

```text
$ pinned-load.sh 11 12 pnpm exec vitest run src/testing.test.ts --coverage.enabled=false --reporter=verbose -t "the migrated template on disk"   # rc=0, 193 s; loadavg 10.80 15.05 16.50 -> 17.33 16.35 16.74
 ✓ ... stores the template the first file builds ... 124ms
 ✓ ... opens the stored template in a new file instead of migrating again 27588ms
 ✓ ... rebuilds a stored template it cannot open, and stores the new one 51ms
 ✓ ... keeps the most recently used templates only ... 1ms
 ✓ ... marks a template as used when it opens it ... 18372ms
$ pnpm exec vitest run src/testing.test.ts --coverage.enabled=false   # rc=0, 114 passed, 16.8 s
```

## K8-14: the user and API-key clauses of two actor CHECKs (migration 0029)

`report_actions_actor_valid` and `transaction_status_history_actor_valid` compared `actor_id` with a pattern in their `user` and `api_key` clauses, which answers null on a null id, so the check passed. `migration-0029.test.ts` upgrades a database at `0028` holding one report action and one status change of each actor type, each with its id (none violating the check), and then inserts rows by SQL.

**RED** (before `0029` existed)

```text
$ (cd packages/db) pnpm exec vitest run src/migration-0029.test.ts --coverage.enabled=false   # rc=1
     × applies in one batch, keeping the rows
     × refuses a report action by a user or an API key with no id
     × refuses a status change by a user or an API key with no id
AssertionError: expected '0028_phase8b' to match /^0029_/
AssertionError: promise resolved "{ rows: [], fields: [], …(1) }" instead of rejecting
      Tests  3 failed | 2 passed (5)
```

**GREEN**: each `user` and `api_key` clause reads `actor_id is not null` first, as the `workflow_run` clause does; `0029_phase8d` is generated from the tables by Stage 1a amendment 17's recipe (`pnpm --filter @openverify/core build`, `drizzle-kit generate --name phase8d`, the journal's trailing newline, prettier on the snapshot).

```text
$ (cd packages/db) pnpm exec vitest run src/migration-0029.test.ts --coverage.enabled=false   # rc=0, Tests 5 passed (5)
$ (cd packages/db) pnpm exec vitest run src/migration-0025.test.ts ... src/migration-0028.test.ts src/migration-v2.test.ts src/phase7-transaction-tables.test.ts src/phase8-actor-tables.test.ts src/testing.test.ts --coverage.enabled=false   # rc=0, 8 files, 163 tests (loadavg 7.59)
```

## R007, the sort half: a case search page read from an index

Two refactors first, with the case suites green: `services/cases/sort.ts` holds the sort key, the `ORDER BY` and the keyset condition, which `searchCases` and the export's `selectExportCaseIds` both read (`a166f28e`, `f8daca52`).

**RED**: `sort-plan.test.ts` explains the search's page query (built from `caseSortOrder` and `caseSortPast`, under the system reader) for each of the four sorts, each direction, the first page, a page after a cursor and a page before one, with sequential scans off, and asserts the named index and no Sort node.

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/sort-plan.test.ts --coverage.enabled=false   # rc=1, 16 failed (16)
+   ->  Sort  (cost=8.17..8.18 rows=1 width=40)
+         Sort Key: (COALESCE(created_at, 'infinity'::timestamp with time zone)), id
+         ->  Index Only Scan using cases_environment_id_template_status_created_at_id_idx on cases
```

**GREEN**: `created_at` and `updated_at` are never null, so each is its own key (`created_at` reads `cases_environment_id_created_at_id_idx` in either direction, and `cases_environment_id_updated_at_id_idx` is new); `resolved_at` and `sla_expires_at` keep a key per direction that puts a missing value last, each with an expression index (`cases_environment_id_{resolved_at,sla_expires_at}_last_{asc,desc}_idx`, `(environment_id, coalesce(<column>, '±infinity'::timestamptz), id)`). Five indexes in `0029`, regenerated.

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/sort-plan.test.ts --coverage.enabled=false   # rc=0, Tests 16 passed (16)
$ (cd apps/api) pnpm exec vitest run src/services/cases src/routes/server/cases --coverage.enabled=false   # rc=0, 22 files, 228 tests
$ (cd packages/db) pnpm exec vitest run src/migration-0029.test.ts src/testing.test.ts --coverage.enabled=false   # rc=0, 119 tests
```

(The GREEN commit is typed `perf(api,db)`, which is not one of CLAUDE.md's six types; it is not amended, and later commits keep to the six.)

## R008: the pull's EXPLAIN test and the pull itself

`pullNextCaseId` filtered `case_queue_id = ANY(...)` and ordered by `sla_expires_at nulls last, created_at, id`; over the index `(environment_id, case_queue_id, sla_expires_at, created_at, id)` the rows of several queues come out queue by queue, so Postgres read every waiting case of every queue and sorted them under `FOR UPDATE`. The old assertions only looked for the index name and `LockRows`.

**RED**: `case-pull.integration.test.ts` (Postgres 17, 30,000 cases, 300 waiting in three queues) runs the exact query the pull sends under `EXPLAIN (ANALYZE, FORMAT JSON)` in a rolled-back transaction and sums the rows every scan of `cases` returned or filtered out, over its loops; the budget is ours, one row a queue (`PULL_ROWS_PER_QUEUE`).

```text
$ (cd packages/db) pnpm exec vitest run --config vitest.integration.config.ts src/repositories/case-pull.integration.test.ts   # rc=1, loadavg 17.70
     × reads at most one case a queue for three queues, whatever its backlog (R008) 19ms
AssertionError: expected 300 to be less than or equal to 3
      Tests  1 failed | 5 passed (6)
```

**GREEN**: one limited ordered scan of `cases_pull_idx` a queue (`unnest` of the queue ids, a `cross join lateral` with `limit 1 for update skip locked`), the heads merged in the same order. A pull from N queues locks up to N heads for its short transaction; a concurrent pull skips them meanwhile, as it skips any locked case (written in the function's comment).

```text
$ (cd packages/db) pnpm exec vitest run --config vitest.integration.config.ts src/repositories/case-pull.integration.test.ts   # rc=0, Tests 6 passed (6), loadavg 18.00
$ (cd apps/api) pnpm exec vitest run src/services/cases/assignment src/routes/server/case-queue-routes.test.ts src/case-queue-plumbing.test.ts --coverage.enabled=false   # rc=0, 68 tests
```

## K8-19: GET /cases/:id?include= serves the queue and the seven held kinds

**RED**: `services/cases/includes.test.ts` makes a case in a queue holding an account, an inquiry, a report, a verification, a transaction, a report run and a graph query, and reads it with every include: each included resource must equal what its own route serves the same reader (with and without `pii:view`), and a reader holding only `cases:read` and `inquiries:read` gets the inquiry alone.

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/includes.test.ts --coverage.enabled=false   # rc=1
     × serves the queue and every held kind, each as its own route serves it
     × masks each included resource as its own route masks it for a reader without pii:view
     × leaves out each kind the reader’s scopes do not reach, and refuses none
AssertionError: {"type":"about:blank","title":"Not Implemented","status":501,"detail":"include=case-queue,accounts,... is not served yet; ..."}: expected 501 to be 200
```

**GREEN**: `services/cases/includes.ts`: each kind is read through its own route's function (`getCaseQueue`, `getAccountView` with `accountResource`, `getInquiryDocument`, `getReportResource`, `getVerificationDocument`, `getTransactionDocument`, `getGraphQueryDocument`, and a run through `reportRunResource` of its report), under the reader's mask; a kind needs its route's read scope (`HELD_INCLUDE_SCOPES`) and is left out without it; an object its route answers 404 or 410 for is left out. `getCase` no longer answers 501. The route's description says so, and `docs/api/openapi.json` is regenerated (one line).

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/includes.test.ts --coverage.enabled=false   # rc=0, Tests 3 passed (3)
$ pnpm --filter @openverify/api openapi:write   # rc=0, docs/api/openapi.json: 1 line
$ (cd apps/api) pnpm exec vitest run src/services/cases src/routes/server/case-routes.test.ts src/openapi.test.ts --coverage.enabled=false   # rc=0, 25 files, 283 tests
```

## K8-27: named problems (not landed in Stage 1)

Decided by the contracts' rule that `definition_invalid` sets (a refusal a client acts on is a named problem, and its per-place codes ride in `errors[]`): three named problems, `case_template_invalid` (422, the publish refusal, keeping the field-schema, transition-map, `field_type_changed` and `notify-on-create` codes in `errors[]`), `case_search_invalid` (422, keeping the `search_*` codes) and `attachment_scan_failed` (409, a scan that ended in `error`). Not landed: each joins `CASE_PROBLEM_STATUSES`, and `apps/dashboard/src/components/cases/case-words.ts` types `CASE_PROBLEM_WORDS` as a `Record<CaseProblemCode, string>`, so the contract change fails the dashboard's typecheck until that file gains three entries in the same commit, and no Stage 1 agent owns that file (console-ops holds `components/cases/` for the forms test only). The item waits for the fixers, who own both (followups).

## R006: a bounded export

**RED**: `exports.test.ts`, "a bounded export": a JSON and a CSV export with personal data of four cases (one with three comments of 2,000 characters, three with a 200-character field), run with `exportByteLimit: 1_024`, must end `failed` with `error-code: export_too_large`, put no object and fire no `case.exported`; a JSON export that fits writes one entry a case.

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/exports/exports.test.ts -t "bounded export" --coverage.enabled=false   # rc=1
     × fails a json export past its byte limit with export_too_large, writing no file and no event
     × fails a csv export past its byte limit with export_too_large, writing no file and no event
-   "case-count": null,  "error-code": "export_too_large",  "status": "failed",
+   "case-count": 4,     "error-code": null,                "status": "completed",
      Tests  2 failed | 1 passed | 8 skipped (11)
```

**GREEN**: `CASE_LIMITS['export-bytes']` (64 MiB, provisional: the job holds about three copies while it seals a file, and the console downloads it whole); `CaseFileJobDeps.exportByteLimit` (tests). The job writes through `BoundedText`, which refuses past the limit: the CSV once written; the JSON bundle case by case, each timeline and comment page counted as it is read, each entry checked by `caseExportBundleEntrySchema` and written out at once (the whole bundle is no longer parsed as a second copy), the meta by its own schema. `ExportTooLargeError` records `export_too_large`, the code the contract already names for a failed export, so no contract changed. Not done: a streamed storage put, because `FileStorage.put` and `encryptBytes` take one object (sealing a stream would be a new envelope format); the limit bounds the memory instead.

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/exports --coverage.enabled=false   # rc=0, Tests 11 passed (11), loadavg 26.98
$ (cd packages/core) pnpm exec vitest run src/cases --coverage.enabled=false   # rc=0, 171 tests
```

## K8-28: unfinished exports, scans and renditions are enqueued again

Stubs first (`f05efd68`): `listUnfinishedCaseExports`, `listPendingCaseAttachmentScans`, `listPendingRenditionSources` (each answering `[]`), `requeueUnfinishedCaseFileWork`, and the producer members of `CaseRepeatableDeps`.

**RED**

```text
$ (cd packages/db) pnpm exec vitest run src/repositories/case-file-recovery.test.ts --coverage.enabled=false   # rc=1, 4 failed (4)
     × lists the pending and running exports made before the cutoff, oldest first
     × lists the unredacted attachments whose scan is pending since before the cutoff
     × lists the pending renditions of unredacted attachments and of files, oldest first
     × reads the pending renditions through their partial indexes
AssertionError: expected [] to deeply equal [ { …(2) }, { …(2) } ]
AssertionError: expected 0 to be greater than 0
$ (cd apps/api) pnpm exec vitest run src/jobs/cases/recovery.test.ts src/jobs/repeatable/phase8b.test.ts src/services/cases/exports/exports.test.ts --coverage.enabled=false   # rc=1
     × enqueues the unfinished export, scan and rendition again by id
     × leaves out a kind whose producer it was not given
     × asks for the work left unfinished for a minute, through the worker’s producers
     × completes when its job runs again
      Tests  4 failed | 17 passed (21)
```

**GREEN**: the three lists (exports `pending` or `running` by `created_at`, on `case_exports_unfinished_idx`; unredacted scans `pending` by `created_at`, on `case_attachments_scan_pending_idx`; unredacted attachments' and inquiry files' renditions `pending` by `updated_at`, on two new partial indexes in `0029`, `case_attachments_rendition_pending_idx` and `file_renditions_pending_idx`, explained with sequential scans off); `requeueUnfinishedCaseFileWork` enqueues each by id through its producer (the job id is the row's id, so a job still queued or running is not doubled), at most 500 of each kind a run; `case-export-sweep` calls it after deleting expired files when the worker holds a producer, for work left for one period (60 s); the worker builds the `case-export` and `case-attachment-scan` producers beside `case-rendition` and closes them. `claimCaseExportRow` claims `running` as well as `pending`, as the bulk claim does, so a job a crashed worker left is finished by the next job.

```text
$ (cd packages/db) pnpm exec vitest run src/repositories/case-file-recovery.test.ts src/migration-0029.test.ts src/repositories/case-file-plumbing.test.ts --coverage.enabled=false   # rc=0, 13 tests
$ (cd apps/api) pnpm exec vitest run src/jobs/cases src/jobs/repeatable/phase8b.test.ts src/services/cases/exports src/services/cases/attachments src/worker.test.ts --coverage.enabled=false   # rc=0, 6 files, 88 tests (loadavg 18.18)
```

A prettier slip in `case-exports.ts` went into the GREEN commit and was formatted in the next (`ffc52370`).

## K8-20: the case emails (assigned, mentioned, SLA breached, notify-on-create)

Stubs first (`6874ccc6`): `queueCaseNotificationEmails`, `claimCaseNotificationEmails`, `deleteCaseNotificationEmails`, `runCaseNotificationEmails`, the queue name, and `CaseRepeatableDeps.mailer` and `.dashboardPublicUrl`.

**RED**: `jobs/cases/notification-emails.test.ts` (PGlite with the dashboard harness's real operators, the capturing mailer): each notification and a `created` email are sent once to the user's address with the case's console link and no case content; a deactivated user, a user with no `cases:read`, a template the user may not see and a redacted case are skipped; no console URL gives a message without a link or a case id; no SMTP server sends nothing and empties the queue; a failing send is tried three times, a lease apart. `services/cases/notify-on-create.test.ts`: `POST /cases` on a version with `notify-on-create` queues a `created` email for the listed user of the organisation and none for an id of no user. `phase8b.test.ts`: `case-notification-emails` every 30 s with the worker's mailer and the console URL.

```text
$ (cd apps/api) pnpm exec vitest run src/jobs/cases/notification-emails.test.ts src/services/cases/notify-on-create.test.ts src/jobs/repeatable/phase8b.test.ts --coverage.enabled=false   # rc=1
     × is scheduled every 30 seconds when the worker holds a mailer
     × sends through the worker’s mailer, naming the console’s public URL
     × queues a created email for each listed user of the organisation   (relation "case_notification_emails" does not exist)
     × sends each notification’s email once, with its link and no case content
     × skips a user who cannot read the case, and a redacted case
     × says the same without a link when the console has no public URL
     × tries a failed send three times in all, a lease apart, then gives it up
      Tests  7 failed | 8 passed (15)
```

**GREEN**: an outbox rather than a mailer in every service: `case_notification_emails` (migration `0029`; a bigint identity, the environment, the user and the case with cascading keys, the kind in `CASE_NOTIFICATION_EMAIL_KINDS` = `created` plus the three notification kinds, `attempts` 0 to 3 and `claimed_at` together) is written in the same transaction as each notification (`createUserNotifications` queues one per row, for users of the environment's organisation) and as each case (`createCaseWithDeps` queues `notify-on-create`'s users). The worker's `case-notification-emails` sweep (every 30 s, registered when the worker holds a mailer; decision 76: case notification emails go out from the worker) claims up to 100 by id `FOR UPDATE SKIP LOCKED` with a 5-minute lease, checks at send that the user is active, holds `cases:read`, may see the template and that the case is not redacted (P38, C129.4), sends a fixed sentence per kind with `<OPENVERIFY_DASHBOARD_PUBLIC_URL>/cases/<id>` (or no link and no id without the URL, outcome 37), deletes what it sent or skipped, gives up after the third failed attempt, and empties the queue when no SMTP server is set. The log holds counts and error names, never an address. No new environment variable: the worker already reads `OPENVERIFY_SMTP_URL`, `OPENVERIFY_MAIL_FROM` and `OPENVERIFY_DASHBOARD_PUBLIC_URL`, so compose and `.env.example` are unchanged. `testing.test.ts` and `phase8-case-tables.test.ts` gain the table in their lists (changed with the plan).

```text
$ (cd packages/db) pnpm exec vitest run src/testing.test.ts src/phase8-case-tables.test.ts src/migration-0029.test.ts src/repositories/case-file-recovery.test.ts --coverage.enabled=false   # rc=0, 150 tests
$ (cd apps/api) pnpm exec vitest run src/jobs/cases/notification-emails.test.ts --coverage.enabled=false   # rc=0, 5 passed (after a test fix: an explicit `undefined` took the helper's default URL)
$ (cd apps/api) pnpm exec vitest run src/services/cases src/jobs/cases src/jobs/repeatable src/workflows/actions/cases src/routes/dashboard/notifications.test.ts src/worker.test.ts --coverage.enabled=false   # rc=0, 45 files, 410 tests (loadavg 14.60)
```

## K8-21: image attachments follow a held selfie inquiry's biometric retention (P22)

A stub first (`1f03785f`): `CaseRetentionReport.redactedBiometricAttachments`, answering 0, with the two exact report tests (`retention-run.test.ts`, `services/retention.test.ts`) gaining the member (changed with the plan).

**RED**: `services/cases/biometric-retention.test.ts` (`face-template-retention-days` 30): cases holding a selfie inquiry 40 days old, a redacted selfie inquiry, a selfie inquiry 10 days old and an inquiry with no selfie, each with a PNG (and one with a PDF), each with its object and a rendition page's object in storage.

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/biometric-retention.test.ts --coverage.enabled=false   # rc=1
     × redacts the image of a case holding a selfie past retention, or a redacted one, and no other
AssertionError: expected +0 to be 2 // Object.is equality
      Tests  1 failed | 1 passed (2)
```

**GREEN**: `listBiometricCaseAttachmentsDue` (the unredacted JPEG, PNG and WebP attachments of cases holding an inquiry with a selfie verification that is redacted or whose selfie was made before the environment's `face-template-retention-days`, the age at which C42.6 deletes the face data; one row an attachment naming the first such inquiry) and `redactCaseAttachmentRowsById`, the per-attachment form of `redactCaseAttachmentRows` (both through one private update). `redactCaseAttachmentsInTx` takes `attachmentIds` or `caseIds`. The C16 pass's case step redacts each due attachment alone under its case's lock, moves `lock-version`, stages `case.updated`, writes the system audit entry `case-attachment.redacted` (`{ case-id, inquiry-id, retention: biometric }`, a strict schema in `audit.ts`), deletes the objects after the commit (a failed delete left to the C16 purge), and counts it. A PDF stays: it is a document, not a picture of a face. A decline's deletion of face data (C42.2) does not reach the attachments: the case exists to review it (default, on the owner's review list). No history row: `CASE_HISTORY_KINDS` has no attachment-redaction kind, and a new one needs the console's `HISTORY_WORDS` entry beside it (no Stage 1 owner; followup).

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/biometric-retention.test.ts src/services/cases/audit.test.ts src/services/cases/redaction.test.ts src/services/cases/attachments src/case-joins.test.ts src/retention-run.test.ts src/services/retention.test.ts --coverage.enabled=false   # rc=0, 8 files, 77 tests
```

## K8-24: the drain of waiting cases by their policies

Stubs first (`bdebf3a5`): `listDrainableAssignmentPolicies`, `listWaitingCasesOfPolicy`, `runCaseAssignmentDrain`, the queue name.

**RED**: `jobs/repeatable/case-drain.test.ts` (PGlite): a round-robin policy of two agents of capacity one over a queue (first) and a template (second) places the queue's two cases in age order and leaves the template's older case waiting, by the policy path (assigner, history row, `case.assigned`, notifications), then places it once an agent's case is resolved. `case-drain.integration.test.ts` (Postgres 17): two drains at once over eight waiting cases and three agents of capacity one place three cases, one an agent, one history row each.

```text
$ (cd apps/api) pnpm exec vitest run src/jobs/repeatable/case-drain.test.ts --coverage.enabled=false   # rc=1
     × assigns its sources’ waiting cases in its order while an agent has room, and the next once one does
AssertionError: expected [ null, null ] to deeply equal [ …(2) ]
$ (cd apps/api) pnpm exec vitest run --config vitest.integration.config.ts --project api src/jobs/repeatable/case-drain.integration.test.ts   # rc=1 (loadavg 2.52)
     × place no case twice and pass no agent’s capacity
AssertionError: expected [] to deeply equal [ { …(2) }, { …(2) }, { …(2) } ]
```

**GREEN**: `listDrainableAssignmentPolicies` (the policies that name sources, with their organisation) and `listWaitingCasesOfPolicy` (unassigned, open, unredacted cases a source holds, ordered by the matching source's `position`, then `sla_expires_at nulls last` for a policy sorted by `sla-expires-at`, then `created_at`, `id`; `compareUnassignedCases`' order, in SQL). `case-assignment-drain` (every 60 s, provisional as `case-reassign`) takes each waiting case in its own transaction: the case row `FOR UPDATE SKIP LOCKED`, then `assignByPolicyInTx` with the policy named, which locks the queue's row and the policy's before reading open counts, the lock order of entries and the pull; a `40P01` or `40001` runs the case again, three times in all (`CASE_TRANSACTION_ATTEMPTS`). An assignment stages `case.assigned` and notifies the assignee (and so queues the K8-20 email). A round-robin or fewest-open policy that places nobody stops its pass. `phase8b.test.ts`' schedule lists gain the job (changed with the plan).

```text
$ (cd apps/api) pnpm exec vitest run src/jobs/repeatable/case-drain.test.ts src/jobs/repeatable/phase8b.test.ts src/services/cases/assignment --coverage.enabled=false   # rc=0, 24 tests
$ (cd apps/api) pnpm exec vitest run --config vitest.integration.config.ts --project api src/jobs/repeatable/case-drain.integration.test.ts   # rc=0, 1 test (loadavg 1.52)
```

## K8-30: a page of cases in a fixed number of queries

**RED**: `services/cases/list-queries.test.ts` counts the database client's queries while one request runs: `GET /cases` and `POST /cases/search` over a template with 2 cases and one with 8 (each case holding an inquiry and an account, with a comment and an attachment) must cost the same; and each case of a page must equal what `GET /cases/:id` serves.

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/list-queries.test.ts --coverage.enabled=false   # rc=1
     × GET /cases
     × POST /cases/search
AssertionError: expected 138 to be 36 // Object.is equality
AssertionError: expected 141 to be 39 // Object.is equality
      Tests  2 failed | 1 passed (3)
```

(17 queries a case: the row, the comment ids, two for each of the seven held kinds, the attachments.)

**GREEN**: `getWorkflowCases` (packages/db) reads every case of a page at once: the rows, the newest 50 comment ids a case (`row_number() over (partition by case_id ...)`), and for each held kind its newest 50 a case and its totals (`group by case_id`), so 16 queries whatever the page's size; `getWorkflowCase` is that read for one id, so a run's view and the case resource cannot drift. `caseResources` (API) builds a page from it and `caseAttachmentRecordsOfCases` (one query for every case's attachments); `listCases` and `searchCases` use it. The responses are unchanged: the third test compares every listed and searched case with `GET /cases/:id`.

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/list-queries.test.ts --coverage.enabled=false   # rc=0, 3 passed (loadavg 1.57)
$ (cd apps/api) pnpm exec vitest run src/services/cases src/workflows/actions/cases src/routes/server/case-routes.test.ts src/case-plumbing.test.ts src/case-joins.test.ts --coverage.enabled=false   # rc=0, 32 files, 350 tests
$ (cd packages/db) pnpm exec vitest run src/repositories/case-actions.test.ts src/case-plumbing.test.ts --coverage.enabled=false   # rc=0, 11 tests
```

## K8-10: the event trigger's subject filter

**RED**: `workflow-definition.test.ts` (an event trigger's `config.filter` takes each webhook filter key and refuses an unknown key or an id of another kind; the new golden definition `contracts/fixtures/workflows/definition-event-filter.json` parses unchanged), `index-rows.test.ts` (the filter's keys are written at the top of the index row's `filter`, beside `on-null`, where the worker reads the webhook keys) and `deliver.test.ts` (two versions published with a filter and indexed by `triggerIndexRows`: the subject the filter allows starts a run, the other is `filtered` with `subject_filter_not_met`).

```text
$ (cd packages/contracts) pnpm exec vitest run src/workflow-definition.test.ts --coverage.enabled=false   # rc=1
     × definition-event-filter.json parses unchanged
     × takes the webhook filter keys, each a list of ids of its kind
      Tests  2 failed | 78 passed (80)
$ (cd apps/api) pnpm exec vitest run src/workflows/publish/index-rows.test.ts src/workflows/triggers/deliver.test.ts --coverage.enabled=false   # rc=1
     × writes a trigger’s subject filter beside the criteria, as the worker reads it (K8-10)
     × starts a run for a subject the filter allows, and filters one it does not
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
```

**GREEN**: `eventTriggerConfigSchema` gains `filter: webhookFiltersSchema.optional()` (the verification trigger keeps `verification-types`); `filterOf` in `index-rows.ts` spreads its keys at the top of the row's `filter`, so the worker's `subjectFilterOf` reads them unchanged. `docs/api/openapi.json` regenerated (the member in the definition's input and output schemas, 104 lines, nothing else). No `@openverify/node` or Kotlin change: neither names the definition's trigger config, and the new fixture sits under `contracts/fixtures/workflows/`, which the Android fixture test does not walk.

```text
$ (cd packages/contracts) pnpm exec vitest run src/workflow-definition.test.ts --coverage.enabled=false   # rc=0, 80 tests
$ (cd apps/api) pnpm exec vitest run src/workflows/publish/index-rows.test.ts src/workflows/triggers/deliver.test.ts --coverage.enabled=false   # rc=0, 59 tests
$ pnpm --filter @openverify/api openapi:write   # rc=0
```

## REQUEST for api-carry-cases from api-carry-engine (`1dd8384a`, K8-7)

`rescreen_account_reports` waits for the reports it reran, so a version holding it must index their terminal events.

```text
$ (cd apps/api) pnpm exec vitest run src/workflows/publish/index-rows.test.ts --coverage.enabled=false   # rc=1
     × holds every report type’s terminal events for rescreen_account_reports (K8-7, a request of api-carry-engine)
AssertionError: expected [] to deeply equal [ …(22) ]
# GREEN: `case 'rescreen_account_reports':` beside `run_report` and `rerun_report` in `actionWaitEvents`
$ (cd apps/api) pnpm exec vitest run src/workflows/publish/index-rows.test.ts --coverage.enabled=false   # rc=0, 13 tests
```

## Docs

`docs/cases/` (README: reading a case and its includes; templates: `notify-on-create`'s emails; comments: the emails; SLA: the breach email; queues: the drain; export: the sorted search, the 64 MiB limit and the recovery; attachments: the recovery; redaction: P22) and `docs/workflows/triggers.md` (the subject filter).

## K8-28, a refinement the db gate found: one job holds an export at a time

The db package's `case-files.test.ts` "seals the request until the export finishes, and one job claims it" failed in the gate (`AssertionError: expected { …(17) } to be null`): the K8-28 claim took a running export at once, so a second claim succeeded. `claimCaseExportRow` now takes a running export only once its claim is older than `CASE_EXPORT_CLAIM_LEASE_MS` (15 minutes, provisional), and the claim stamps `updated_at` with the job's clock; `case-file-recovery.test.ts` gains "claims a running export again only once its claim's lease lapsed", and the API test of a crashed export stamps its claim 20 minutes back. The existing test passes unchanged.

## PGlite: the migrated template's copy, before and after 0029

A scratch test (deleted after) migrated one PGlite to `0028_phase8b` and one to `0029_phase8d`, dumped both, and opened each 20 times, interleaved:

```text
loadavg 0.54 1.21 3.30:                                  before p95 820 ms, after p95 821 ms (templates 51,508,736 and 51,645,952 bytes)
on one CPU shared with 3 busy loops (loadavg 0.70 -> 4.67): before p95 4,059 ms, after p95 4,096 ms
```

Both under the Risks row's 5 s; `0029` (two CHECKs, seven indexes, one table) costs nothing a hook would notice.

## Final gates (each read from its exit code; loadavg beside each)

```text
$ pnpm install --frozen-lockfile                                             # rc=0
$ pnpm format:check                                                         # rc=0 (and again at the end, rc=0)
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force --concurrency=2
                                                                             # rc=0, 32 of 32 tasks, 478 s (loadavg 1.75 -> 3.16); again on the final tree: rc=0, 32 of 32, 468 s (3.55 -> 2.54)
$ pnpm turbo run test --force --filter=@openverify/core --filter=@openverify/contracts --filter=@openverify/db
   core 1,390 tests, 99.83 / 98.4; contracts 3,697 tests, 99.3 / 93.56       # db failed once (the claim above), then:
$ pnpm turbo run test --force --filter=@openverify/db                        # rc=0, 131 files, 1,992 tests, 92.56 / 85.07 (loadavg 1.41 -> 9.79)
$ (cd apps/api) vitest run --coverage --coverage.reportsDirectory=<dir>/coverage-i --shard=i/4 --reporter=blob --outputFile=<dir>/blobs/blob-i-4.json
   each shard rc=1 on its partial coverage alone, no failed test; 231, 249, 207 and 182 s (loadavg 7.1 to 8.5)
$ (cd apps/api) vitest run --merge-reports=<dir>/blobs --coverage --coverage.reportsDirectory=<dir>/coverage-merged
   rc=0: Test Files 581 passed (581), Tests 8223 passed (8223); 94.69 / 85.62 / 96.76 / 94.76
   branches, from coverage-summary.json: services/cases 78.68% (1,395 of 1,773; 78.55% after 8C), workflows/runs 75.65%, workflows/engine 81.17%
$ pnpm --filter @openverify/db test:integration                             # rc=0, 17 files, 78 tests, 86 s (loadavg 4.71 -> 17.64)
$ (cd apps/api) vitest run --config vitest.integration.config.ts --project graph   # rc=0, 13 tests, 32 s; template built in 14,862 ms (loadavg 16.62)
$ ... --project api --shard=1/3                                               # rc=0, 15 files, 75 tests, 54 s (loadavg 10.18)
$ ... --project api --shard=2/3                                               # rc=0, 14 files, 91 tests, 152 s (loadavg 12.02)
$ ... --project api --shard=3/3                                               # rc=0, 14 files, 75 tests, 73 s (loadavg 6.64)
$ pnpm --filter @openverify/api openapi:write (twice); git diff --exit-code docs/api/openapi.json   # rc=0, 0, 0
$ (cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
                                                                             # rc=0, 76 s; 1,334 host tests, 0 failed or skipped: CI's floor stays 1,334
```

No file of rule 16's list changed, so the benchmark's checks were not run.
