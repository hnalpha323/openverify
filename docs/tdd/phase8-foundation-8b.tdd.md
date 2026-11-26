# TDD evidence: Workflow 8B Stage 1b, `foundation-8b` (Phase 8)

- **Slice owner:** the Workflow 8B Stage 1b `foundation-8b` agent (plumbing only), beside `case-logic`, `vision-renditions` and `contracts-8b`'s second call.
- **Date:** 2026-11-03.
- **Base:** `78ad06a0` (the first `contracts-8b` call's last commit).
- **Input:** the "Stage 1b: `foundation-8b`" bullet of `docs/plans/phase-8.plan.md`, checkpoint (C), the 8B Stage 1a amendments 1 to 31, and orchestrator decision 5 after Workflow 8A (every join in an 8A file is a call to a stub in its 8B owner's file). The decisions this stage took are in the plan's "Workflow 8B Stage 1b amendments (foundation-8b)".

Each unit follows the same cycle: a stub (`chore`) when a test needs a name that does not exist yet, so the RED commit compiles and typechecks; the test, run and seen failing for its intended reason (RED, `test`); the smallest change that passes it (GREEN, `feat`).

## Checkpoint (C): cases (ends at the record commit of this file)

| Unit | Stub | RED | GREEN |
|---|---|---|---|
| The case tables in `0028_phase8b` | | `6e8176a2` | `49017361`, `2a4007e9` (style) |
| The db plumbing: sealing, rewrap, subjects, the `case-template-ids` filter, a key's templates, repository stubs, the db package's two 8A joins | `b39b91e0` | `c1324eee` | `2399a608` |
| The filter in core (`matchesWebhookFilters`) | `e73bd0b1` | `c48dce9d` | `9e53cb34` |
| The API plumbing: masking, the catalogue joins, every 8A join, redaction, retention, subjects, visibility exits, the key restriction, the case-bulk producer | `cfeea9df`, `2872402e` | `2e8d2104` | `27512488` |
| The frozen (C) routes and the OpenAPI snapshot (after the marker `214858b6`) | | `5b9b356a` | `2c1bc346` |
| The `case-bulk` worker | `5d4641e8` | `355a1f49` | `2ba5bb69` |
| What the forced lint refused | | | `a55f6fd4`, `b29a36e0` |
| A load-sensitive integration test outside the case paths | | | `c85389bc` |

### RED, as run

The tables, before the migration was extended:

```
$ pnpm exec vitest run src/phase8-case-tables.test.ts --coverage.enabled=false
error: relation "case_templates" does not exist
Test Files  1 failed (1)
     Tests  27 failed (27)
```

The db plumbing, each for its own reason:

```
$ pnpm exec vitest run src/repositories/case-plumbing.test.ts src/repositories/case-joins.test.ts --coverage.enabled=false
AssertionError: expected [] to deeply equal [ 'case_01M6FQZCV622MRCK2ZKC7F4HD9' ]          (listWorkflowObjectsAfter)
AssertionError: expected [ 'inquiry-template', …(6) ] to include 'case-template'          (reference kinds)
AssertionError: expected [ 'accounts.fields:row', …(68) ] to deeply equal ArrayContaining{…}
DecryptionError: unknown key id …: its KEK is not in the keyring                          (rewrap)
AssertionError: expected [ 'inq', 'ver', … ] to deeply equal ArrayContaining ["case", "cscm"]
AssertionError: expected [ { …(13) } ] to deeply equal []                                 (case-template-ids)
AssertionError: expected [] to deeply equal [ 'wbh_…' ]                                   (every held inquiry)
AssertionError: expected null to deeply equal [ …(2) ]                                    (a key's templates)
Tests  8 failed | 3 passed (11)
```

The filter in core:

```
× pass a case by its template, and fail another or none when strict   (expected true to be false)
× pass an inquiry-template filter only when it allows every held inquiry's template
Tests  2 failed (2)
```

The API plumbing and joins (27 of 29; the two that passed are the stubs' own answers):

```
$ pnpm exec vitest run src/case-plumbing.test.ts src/case-joins.test.ts --coverage.enabled=false
AssertionError: expected null to deeply equal { data: { type: 'case', …(2) } }           (triggerDocumentOf)
AssertionError: expected false to be true                                                (objectIdFits)
AssertionError: expected undefined to be { Object (label) }                              (OBJECT_ROWS)
AssertionError: expected [ Array(1) ] to not include 'contest_route_case_template_refused'
AssertionError: expected undefined to be { sinkOf: [Function sinkOf] }                   (context.sinks)
AssertionError: expected 'errored' to be 'completed'                                     (current_case at a run's start)
AssertionError: expected "vi.fn()" to be called with arguments: [ Anything, Anything, …(1) ]   (case children)
NotImplementedError: Case redaction is not built yet.                                    (redactCase)
AssertionError: expected { redactedInquiries: +0, …(28) } to match object { redactedCases: 2, …(2) }
AssertionError: expected [ {} ] to deeply equal [ { …(2) } ]                             (case subject)
AssertionError: expected [ …(2) ] to not include 'evt_…' / 'alog_…' / 'wfr_…'            (visibility exits)
AssertionError: expected [ 'fields', 'note', …(95) ] to deeply equal ArrayContaining{…}  (masking)
AssertionError: expected 'a@example.com' to be null                                      (stored log)
AssertionError: create_case: expected undefined to be 'create_case'                      (catalogue)
AssertionError: expected 201 to be 501                                                   (a key's templates, unchecked)
AssertionError: expected {} to deeply equal { Object (case-template-ids) }               (a webhook's filter)
Tests  27 failed | 2 passed (29)
```

The routes:

```
$ pnpm exec vitest run src/routes/server/case-routes.test.ts --coverage.enabled=false
AssertionError: {"title":"Not Found","status":404,"detail":"No route matches GET /api/v1/case-actions." …}: expected 404 to be 501
Tests  78 failed (78)
```

The worker:

```
× starts the job with the case options, and hands each job to its processor   (expected undefined to be defined)
Tests  1 failed | 1 passed (2)
```

### GREEN, as run

```
db:   phase8-case-tables 27 passed; case-plumbing and case-joins 11 passed; migration-0028 5 passed
core: webhook-payload-cases and webhook-payload 34 passed
api:  case-plumbing and case-joins 29 passed; case-routes 76 passed; worker-cases and the worker suites 69 passed
```

Test changes made inside a GREEN, each named so it is not mistaken for a weakened test:
- `phase8-case-tables.test.ts`: the seeded case names read `KYC-<n>` with a counter, because the RED version built them from an id's letters, which `cases_name_format` refuses.
- `case-routes.test.ts`: the `PATCH /cases/:id` request sends `meta.sla-expires-in-seconds`, because `tags` is not a member of its frozen body; and the two notification rows moved to `routes/dashboard/notifications.test.ts` when the routes moved to the dashboard API (amendment 8). That test passed at once, because it was written after the move.
- `case-joins.test.ts`: the events, logs and runs exits seed golden payloads and a readable definition, and the key test uses an app built with the key pepper, as `api-keys.test.ts` does; the first RED run answered 500 for those reasons, not for the intended one.

## Extending `0028_phase8b` (8A Stage 1a amendment 17, with `--name phase8b`)

1. `pnpm --filter @openverify/core build` (drizzle-kit reads core from its `dist`).
2. In `packages/db`, remove `drizzle/0028_phase8b.sql`, `drizzle/meta/0028_snapshot.json` and journal entry 28.
3. `pnpm exec drizzle-kit generate --name phase8b`.
4. Add the trailing newline back to `_journal.json`, and put the hand edits back at the end: one `openverify_set_updated_at` trigger per new table with `updated_at` (`case_templates`, `case_template_versions`, `cases`, `case_comments`, `case_actions`, `case_bulk_actions`), then the function `openverify_case_history_append_only` and its trigger `case_history_append_only`.
5. Run prettier on `drizzle/meta/0028_snapshot.json`.

`0028` adds no enum label. `migration-0028.test.ts` proves the upgrade from `0027` with a run, an inquiry and an API key written on `0027`'s schema: the key reads no restriction, and the inquiry is held by a case while an unknown one is refused by `case_inquiries_inquiry_fk`.

## Columns and their forms (C143.5)

| Table | Column | Form |
|---|---|---|
| `cases` | `fields` | sealed JSON, row AAD `cases.fields#<id>`; `null` only once redacted |
| `case_comments` | `message` | sealed, row AAD `case_comments.message#<id>`; `null` once redacted |
| `case_bulk_actions` | `request` | sealed JSON, row AAD `case_bulk_actions.request#<id>` (a search can name field values, a status change a comment); `null` only once completed |
| `case_field_keys` | `value_key` | 64-hex HMAC (`identifierKey`, labelled per template and field key, `api-cases`) |
| `case_templates` | `name`, `key`, `status`, `visible_to_roles`, `archived_at` | plaintext: configuration |
| `case_template_versions` | every column | plaintext: configuration (field schemas, statuses, transitions, policy ids, user ids to notify) |
| `case_name_counters` | `last_value` | plaintext: a counter |
| `cases` | name, status, category, resolution, queue, actors, timestamps, tags, `lock_version`, `workflow_run_step_id` | plaintext: keys, ids, statuses and tags, which the docs say carry no personal data (C131.4, C136.5) |
| held-object tables | ids, `attached_by_*`, `attached_state`, `created_at`, `held_as` | plaintext: ids, statuses and timestamps only, by rule (C136.3) |
| `case_history` | kind, actor, `from`, `to`, `request_id` | plaintext: keys, ids and statuses, never a value (C131.4) |
| `case_actions`, `case_action_templates` | label, status, placement, `prefill` (paths, never values) | plaintext: configuration |
| `user_notifications` | kind, case id, user id, `read_at` | plaintext: no comment text (C134.4) |
| `case_bulk_actions` | action, status, creator, counts, `outcomes` (case ids and codes) | plaintext |
| `api_keys` | `case_template_ids` | plaintext: template ids |

`ENCRYPTED_COLUMNS`, `SEALED` and `REWRAP_TABLES` hold the three sealed columns, and `case-plumbing.test.ts` re-wraps each under a new KEK. `REDACTION_SUBJECT_ID_PREFIXES` gains `case` and `cscm`. `CASE_PII_TABLES` (`redaction.test-support.ts`) stands the three tables aside from the subject scan, because a case redacts only itself and `api-cases`' suite owes that coverage.

## Measurements

PGlite (Risks; outcome 1), each under the e2e lock, `firstMs` the first `createTestDatabase` of a process (cold: an empty `OPENVERIFY_TEST_DB_CACHE_DIR`), `secondMs` a second one from the template:

| | Cold, first | Warm, first | Second | Load (1 min) |
|---|---|---|---|---|
| Before, at `6e8176a2` | 4,940, 4,650, 4,641 ms | 1,023, 1,006, 985 ms | 836 to 1,042 ms | 1.1 to 1.7 |
| After the tables, at `49017361` | 4,592, 4,620, 4,622 ms | 1,069, 1,083, 1,156 ms | 821 to 1,008 ms | 3.9 to 4.8 |

The 18 tables cost nothing a hook would notice; the 120 s hook budget is untouched.

## Gates, each read from its exit code

| Gate | Result | Time | Load (1 min) |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | | |
| `pnpm format:check` | 0 | | |
| `pnpm turbo run lint typecheck --force --continue` (heap 4 GB) | 0, 32 of 32 | 429 s | 12 to 20 |
| `pnpm turbo run test --force --continue --filter=!@openverify/api` | 0, 15 of 15 | 593 s | 3 to 21 |
| API unit suite, four blob shards and the merge | merge 0: 7,804 tests in 536 files, 95.05% statements, 86.21% branches | 221, 242, 204, 188 s; merge 18 s | 9 to 12 |
| `pnpm --filter @openverify/db test:integration` | 0, 69 in 15 files | 83 s | 12 to 16 |
| `--project graph` | 0, 13 (template built in 18.6 s, copied in 1.8 s) | 38 s | 11 to 15 |
| `--project api`, shards 1 to 3 | 0, 73, 88, 73 | 60, 176, 66 s | 4 to 19 |
| `bash infra/tests/ci-workflow.test.sh` | 0, 219 passed | | |
| `bash infra/tests/compose.test.sh --static-only` | 0, 501 passed | | |
| mocked flow suite | 0, 79 | 55 s | 13 |
| e2e: down and build; a fresh stack | 0; 0 | 237 s; 98 s | 9.6; 3.6 to 9 |
| e2e shards 1 to 3 | 0, 38, 39, 36 | 166, 329, 240 s | 2 to 9 |
| e2e down (my holder, 4168533) | 0 | 4 s | |

Per package (the non-API call): core 99.8%, contracts 99.3%, db 93.25%, workflow-engine 98.02%, node 98.53%, dashboard 97.93%, every one at 80% or more.

The first integration shard 3 failed one test outside the case paths: `src/webhooks/queue.integration.test.ts`, "enqueues an attempt again over a job that failed for good", at its 60 s guard at a load of about 15, and passed alone in 3 s. Its `QueueEvents` read the stream from its end (`$`), and the reader's first read comes after `waitUntilReady`, so a job that failed before that read was never seen. `c85389bc` reads from the start (`lastEventId: '0-0'`), which no timing can defeat; the shard then passed (73 of 73).

## Checkpoint (Q): queues, assignment and SLA (ends at the record commit of this section)

- **Base:** `a6fd616c` (checkpoint (C)'s record), with `contracts-8b`'s (Q) contracts (`6308a21c`) already in.
- **Input:** the "(Q)" line of the plan's Stage 1b bullet: `case_queues`, `case_queue_members`, `case_assignment_policies`, `case_sla_policies`, `case_calendars` and the SLA columns on `cases`; the routes frozen in `case-queues.ts`, `case-assignment.ts`, `case-assignment-policies.ts`, `case-sla-policies.ts` and `case-calendars.ts`; the `case-sla` and `case-reassign` registrations with stubs. Plus what checkpoint (C) left for it (Stage 1b amendment 2): the foreign key on `cases.case_queue_id` and the pull index on `assignee_id`; and Stage 1a amendment 38: `user-email-address` in the stored log's `MASKED_MEMBERS`. The decisions are items 22 to 32 of the plan's "Workflow 8B Stage 1b amendments (foundation-8b)".

| Unit | Stub | RED | GREEN |
|---|---|---|---|
| The (Q) tables, the SLA columns of `cases`, the keys of a case and a version, the four indexes, in `0028_phase8b` | | `ae00f1ab` | `ce5cef21` |
| The db plumbing: the (Q) repository stubs and the seeds | `37e08500` | `977dc27f` | `442cc232` |
| The API plumbing: the `case-sla` and `case-reassign` registrations, the worker wiring, `user-email-address` in a stored log | `09b27dee` | `fb949048` | `d036f4f2` |
| The frozen (Q) routes, their service stubs and the OpenAPI snapshot | `0a0fd83c` | `3ba39015` | `f792073d` |
| The SLA and entry hooks' comments | | | `4dc869ee` |

### RED, as run

The tables (`packages/db`), before the migration was extended:

```
$ pnpm exec vitest run src/phase8-case-queue-tables.test.ts src/phase8-case-tables.test.ts src/testing.test.ts --coverage.enabled=false
AssertionError: case_queues: expected {} to have property "environment_id"
AssertionError: expected { id: 'text', …(26) } to match object { sla_state: 'text', …(11) }
AssertionError: expected [ 'case_actions_set_updated_at', …(5) ] to deeply equal ArrayContaining{…}
AssertionError: expected [Function] to throw error including 'cases_sla_expires_at_with_state' but got 'column "sla_state" of relation "cases…'
AssertionError: expected '' to contain '(environment_id, case_queue_id, sla_e…'                 (cases_pull_idx)
AssertionError: expected '' to contain 'sla_state = \'running\'::text'                           (cases_sla_due_idx)
AssertionError: expected [ 'account_actions', …(135) ] to deeply equal [ 'account_actions', …(141) ]
Tests  25 failed | 139 passed (164)
```

The seeds (the nine stub tests pass from the stub commit, because a stub's answer is the plumbing):

```
$ pnpm exec vitest run src/repositories/case-queue-plumbing.test.ts --coverage.enabled=false
Error: seedCaseQueue is not built
Error: seedCaseCalendar is not built
Tests  4 failed | 9 passed (13)
```

The API plumbing:

```
$ pnpm exec vitest run src/jobs/repeatable/phase8b.test.ts src/worker-cases.test.ts src/case-queue-plumbing.test.ts --coverage.enabled=false
× nulls an assignment's address in a stored log, wherever it sits   (expected { meta: { …(2) }, …(1) } to deeply equal …)
× schedules each sweep on its period                                 (expected [] to deeply equal [ …(2) ])
× runs each sweep with the database, the clock, the logger and the publisher   (expected "vi.fn()" to be called with …)
× schedules case-sla and case-reassign with the case options, and neither without them   (expected [ 'inquiry-expiry' ] to …)
Tests  4 failed | 5 passed (9)
```

The holiday CSV and the address in the masked attribute lists passed at once: `csv` is a `PII_WORKFLOW_RUN_ATTRIBUTES` name and `user-email-address` joined `PII_CASE_ATTRIBUTES` in `contracts-8b`'s (Q), both spread into every masked list. The two new lines of `packages/config/src/eslint-phase5.test.ts` passed at once too: `apps/api/src/jobs/repeatable/**` and the (Q) route files were in `PHASE5_FOLDERS` already. They stay as coverage.

The routes:

```
$ pnpm exec vitest run src/routes/server/case-queue-routes.test.ts --coverage.enabled=false
AssertionError: {"title":"Not Found","status":404,"detail":"No route matches GET /api/v1/case-queues." …}: expected 404 to be 501
Tests  51 failed (51)
```

### GREEN, as run

```
db:  phase8-case-queue-tables 24, phase8-case-tables, testing, migration-0028: 169 passed; case-queue-plumbing 13 passed
api: phase8b 3, phase8 3, worker-cases 3, case-queue-plumbing 3, case-plumbing, api-logs, worker: 98 passed; case-queue-routes 51 and openapi: 64 passed
```

Test changes made inside a GREEN, each named so it is not mistaken for a weakened test:
- `phase8-case-queue-tables.test.ts`: the RED test read `sla_consumed_ms` as the string a `pg` client gives an `int8`; PGlite gives a number, so it reads the column `::text`.
- The regenerated `0028_phase8b.sql` ended its last generated statement without `--> statement-breakpoint`, so the first hand edit ran in the same prepared statement ("cannot insert multiple commands into a prepared statement"); the marker is back before the hand edits. The recipe below says so now.

Existing tests changed with the plan: `phase8-case-tables.test.ts` (the `cases` columns gain the SLA's) and `testing.test.ts` (the six tables). `case-routes.test.ts` is unchanged.

### Extending `0028_phase8b`, as of (Q)

The (C) steps stand, with two additions: after `drizzle-kit generate`, put `--> statement-breakpoint` back at the end of the last generated statement before appending the hand edits; and the hand edits now hold eleven `openverify_set_updated_at` triggers, the (C) six and `case_queues`, `case_queue_members`, `case_assignment_policies`, `case_sla_policies` and `case_calendars`, before the history's function and trigger.

### Columns and their forms (C143.5), checkpoint (Q)

| Table | Column | Form |
|---|---|---|
| `case_queues` | `name`, `status`, `case_assignment_policy_id`, `round_robin_cursor`, `archived_at` | plaintext: configuration and a user id |
| `case_queue_members` | `user_id`, `max_open`, `paused` | plaintext: an operator's id and counts |
| `case_assignment_policies` | `name`, `distribution`, `sort`, `agent_ids`, `max_capacity`, `round_robin_cursor` | plaintext: configuration and user ids |
| `case_assignment_policy_sources` | `position`, `case_template_id`, `case_queue_id` | plaintext: ids |
| `case_sla_policies` | `name`, `target_minutes`, `case_calendar_id`, `on_reopen`, `revision` | plaintext: configuration |
| `case_calendars` | `name`, `time_zone`, `week`, `holidays`, `closures` | plaintext: configuration (an operator's holiday labels, never a subject's data) |
| `cases` | `sla_state`, `sla_epoch`, `sla_consumed_ms`, `sla_segment_started_at`, `sla_expires_at`, `sla_expired_at`, `sla_met_at`, `sla_target_ms`, `sla_policy_id`, `sla_policy_revision`, `sla_case_calendar_id`, `sla_on_reopen` | plaintext: states, counts, instants and ids (C133.4) |

No (Q) column is sealed, so `ENCRYPTED_COLUMNS`, `SEALED`, `REWRAP_TABLES`, the redaction subjects and the rebuild are unchanged. Masking: `user-email-address` joins the stored log's `MASKED_MEMBERS`; a holiday import's `csv` was masked already.

## Measurements, checkpoint (Q)

PGlite (each under the e2e lock; the timer script imports `createTestDatabase` through `tsx`; `firstMs` the first database of a process, cold with an empty `OPENVERIFY_TEST_DB_CACHE_DIR`; `secondMs` a second from the template):

| | Cold, first | Warm, first | Second | Load (1 min) |
|---|---|---|---|---|
| Before, at `12fa0aae` | 4,898, 4,947, 4,762 ms | 1,083, 1,135, 1,111 ms | 815 to 952 ms | 1.8 to 1.9 |
| After the (Q) tables, at `ce5cef21` | 4,959, 4,999, 9,029 ms | 1,370, 1,295, 1,252 ms | 888 to 1,188 ms | 3.7 to 5.8 |

The 9,029 ms cold run came as the load climbed from 3.7 to 5.8; the other two cold runs moved by 2%. The 120 s hook budget is untouched.

## Gates, checkpoint (Q), each read from its exit code

| Gate | Result | Time | Load (1 min) |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | | |
| `pnpm format:check` | 0 | | |
| `pnpm turbo run lint typecheck --force --continue` (heap 4 GB) at `f02b1fbe` | 0, 32 of 32 | 476 s | 7 to 16 |
| `pnpm turbo run test --force --continue --filter=!@openverify/api --filter=!@openverify/dashboard`, one call | 124 at the 590 s cap: 12 packages had passed, `watchlist` and `e2e` had not finished | 590 s | 7 to 19 |
| the same tests in four calls: `watchlist` and `e2e`; `db`, `checks` and `flow`; the nine others; `dashboard` | 0, 0, 0, 0: 15 of 15 packages, each at 80% or more | 332, 198, 48, 284 s | 4 to 26 |
| API unit suite, four blob shards and the merge at `bb789ee0` | merge 1: 7,973 passed, 8 failed, all in `api-cases`' then-untracked RED file `src/services/cases/templates.test.ts`; 94.99% statements, 86.17% branches, 544 files | 259, 253, 218, 288 s; merge 18 s | 9 to 18 |
| API unit suite again, four blob shards and the merge at `fafe4f83` | merge 1: 7,971 passed, 19 failed in 7 files, every one in `api-cases`' or `api-case-workflows`' work in flight: their committed RED (`5f5c36bd`: `services/cases/{exits,notifications,redaction,search-bulk}.test.ts`), their uncommitted GREEN edits of `case-routes.test.ts` and `routes/dashboard/notifications.test.ts`, and `graph-query-routes.test.ts`'s create-case preview after `ee296de7`; 93.14% statements, 84.15% branches, 550 files | 243, 216, 196, 229 s; merge 11 s | 9 to 13 |
| `pnpm --filter @openverify/db test:integration` | 0, 69 in 15 files | 135 s | 14 to 32 |
| `--project graph` | 0, 13 (template built in 36.3 s, copied in 2.5 s) | 69 s | 20 to 31 |
| `--project api`, shards 1 to 3 | 0, 73, 88, 73 | 87, 210, 108 s | 15 to 25 |
| `bash infra/tests/ci-workflow.test.sh` | 0, 219 passed | | |
| `bash infra/tests/compose.test.sh --static-only` | 0, 501 passed | | |
| mocked flow suite | 0, 79 | 31 s | 18 to 21 |
| e2e: down and build; a fresh stack (holder 189874) | 0; 0 | 52 s; 148 s | 15 to 17 |
| e2e shards 1 to 3 | 0, 38, 39, 36 | 196, 428, 318 s | 6 to 23 |
| e2e down (my holder) | 0 | 3 s | |
| `pnpm --filter @openverify/watchlist benchmark:typecheck` and `benchmark:test` (rule 16: `testing.ts` and the repository index changed) | 0; 0, 119 in 12 files | 9 s | |

No (Q) or (C) plumbing test failed in either API run. While Stage 3 agents commit RED tests to the shared tree, the API merge cannot exit 0 on it; `integration-8b` runs it alone on the final tree (orchestrator decision 2 after Workflow 8A).

Per package (the non-API calls): core 99.83%, contracts 99.3%, db 93.43%, workflow-engine 98.02%, node 98.53%, flow 95.48%, checks 98.77%, dashboard 97.93%, watchlist 98.63%, e2e 97.22%, signals 96.37%, emrtd 94.97%, ui and config 100%, flow-spec 100%.

## Checkpoint (F): files, renditions and exports (ends at the record commit of this section)

- **Base:** `99aaa36a` (checkpoint (Q)'s record), with `contracts-8b`'s (F) contracts and the marker `214858b6` already in.
- **Input:** the "(F)" line of the plan's Stage 1b bullet: `case_attachments`, `file_renditions` (with its foreign key on `files(id)`, decided with Stage 1a amendment 9's three deletes of a `files` row), `case_exports`; the `attachmentScanner` binding with its provider stubs; the queues `case-export`, `case-attachment-scan` and `case-rendition` (`case-bulk` came with (C)); the routes frozen in `case-attachments.ts`, `case-exports.ts` and `routes/dashboard/file-renditions.ts` (`case-print.ts` was frozen with (C), `2c1bc346`); the hooks `deleteRenditionsForFilesInTx` and `requestRenditionsForFiles` at their call sites; the export-file retention step and the `case-export-sweep` registration; then the OpenAPI snapshot after the last checkpoint. Plus Stage 1a amendments 39 to 42: the masking of an attachment's `data` and `filename`. The decisions are items 34 to 48 of the plan's "Workflow 8B Stage 1b amendments (foundation-8b)", "### Checkpoint (F) files, renditions and exports".

| Unit | Stub | RED | GREEN |
|---|---|---|---|
| The (F) tables in `0028_phase8b` | | `b3f1dcf2` | `c5aeef92` |
| The db plumbing: sealing, rewrap, `catt`, the repository stubs and the seeds | `bd7ef41b` | `66830366` | `d5ea50d5` |
| The API plumbing: the scanner port, binding and API fact, the three producers, the hooks at their call sites, the C16 steps, the workers and the export sweep, the masking | `22b4604f`, `a6106d22` | `b581c6a0`, `2d916d60` | `b66b9aa1` |
| The frozen (F) routes, their service stubs and the OpenAPI snapshot | | `1aa2bc53` | `b4268c46` |

### RED, as run

The tables (`packages/db`), before the migration was extended:

```
$ pnpm exec vitest run src/phase8-case-file-tables.test.ts src/testing.test.ts --coverage.enabled=false
AssertionError: case_attachments: expected {} to have property "environment_id"
AssertionError: expected [Function] to throw error including 'case_attachments_filename_until_redac…' but got 'relation "case_attachments" does not …'
AssertionError: expected [Function] to throw error including 'case_exports_request_until_finished' but got 'relation "case_exports" does not exist'
AssertionError: expected '' to contain '(environment_id, source_id)'
AssertionError: expected [ 'account_actions', …(141) ] to deeply equal [ 'account_actions', …(145) ]
Tests  21 failed | 113 passed (134)
```

(The first run also failed five tests on the setup: the synthetic wrapped key did not fit `files_wrapped_dek_format`, so the test was corrected to a key in `encryptBytes`' form before the RED commit.)

The db plumbing (the nine stub tests pass from the stub commit, because a stub's answer is the plumbing):

```
$ pnpm exec vitest run src/repositories/case-file-plumbing.test.ts --coverage.enabled=false
AssertionError: expected [ 'accounts.fields:row', …(71) ] to deeply equal ArrayContaining{…}
AssertionError: expected [ 'inq', 'ver', 'iqse', 'acc', …(28) ] to deeply equal ArrayContaining ["catt"]
Error: seedCaseAttachment is not built
Tests  4 failed | 9 passed (13)
```

The API plumbing (run with the committed `providers/index.ts`, without the binding):

```
$ pnpm exec vitest run src/case-file-plumbing.test.ts src/case-file-joins.test.ts src/worker-cases.test.ts src/jobs/repeatable/phase8b.test.ts --coverage.enabled=false
AssertionError: expected { data: { type: 'case', …(1) }, …(1) } to deeply equal …          (stored log)
AssertionError: expected { status: 'open', …(1) } to deeply equal …                         (pii mask)
AssertionError: expected { sandbox: null, production: null } to deeply equal { sandbox: 'sandbox', …(1) }
AssertionError: expected undefined to be 'sandbox'                                           (binding)
AssertionError: expected [] to deeply equal [ { name: 'case-export', …(2) } ]                (producers)
AssertionError: promise resolved "undefined" instead of rejecting                            (ids only)
AssertionError: expected "vi.fn()" to be called with arguments: [ Anything, { …(2) } ]       (the rendition hook, five sites)
AssertionError: expected { redactedInquiries: +0, …(31) } to match object { purgedRenditionPages: 3, …(2) }
AssertionError: case-export: expected undefined to be defined                                (workers)
AssertionError: expected [ …(2) ] to deeply equal [ …(3) ]                                   (export sweep)
Tests  20 failed | 6 passed (26)
```

Two of them first failed for a setup reason (`PermanentJobError: file_type`, the synthetic files had no JPEG magic bytes); `2d916d60` gave them the bytes, and they then failed for their own reason:

```
AssertionError: expected "vi.fn()" to be called with arguments: [ ObjectContaining{…}, { …(2) } ]
AssertionError: expected [ 'verification processed' ] to include 'renditions could not be requested'
```

The routes:

```
$ pnpm exec vitest run src/routes/server/case-file-routes.test.ts src/routes/dashboard/file-renditions.test.ts --coverage.enabled=false
AssertionError: {"title":"Not Found","status":404,"detail":"No route matches GET /api/v1/case-exports." …}: expected 404 to be 501
Tests  21 failed (21)
```

### GREEN, as run

```
db:  phase8-case-file-tables, testing, migration-0028: 139 passed; case-file-plumbing 13; schema-v2, key-rotation, subject-ids and case-file-plumbing 85
api: case-file-plumbing, case-file-joins, worker-cases, phase8b: 26 passed; the related suites (providers, config, redaction, retention, process-verification, server-files, pii-collisions, case plumbing and joins, api-logs, worker): 847 passed after the two tests changed with the plan; case-file-routes, file-renditions, openapi: 34 passed
```

Test changes made inside a GREEN, each named so it is not mistaken for a weakened test:
- `case-file-plumbing.test.ts` (db): the seed test reads the file key's refusal from the error's `cause`, because drizzle wraps the database error ("Failed query: …").
- `worker-cases.test.ts`: the new test compares each job's deps by identity, because the vision fake is a proxy that `objectContaining` walks.
- `case-file-routes.test.ts`: each request takes an `Idempotency-Key` of its own, because one key with another body is a reuse (422).
- The upload route first streamed its multipart body, as the transaction file route does, and the idempotency plugin refuses a key on a streamed body ("An Idempotency-Key cannot be used with a multipart body this route streams"). C135.1 says the key is honoured as for buffered multipart bodies, so the route buffers it under its own parser, as the importer does (item 46).

Existing tests changed with the plan: `testing.test.ts` (four tables), `schema-v2.test.ts` (five sealed columns), `key-rotation.test.ts` (the (F) seeds), `subject-ids.test.ts` (`catt`), `providers/phase8-providers.test.ts` (the scanner is bound now), `services/redaction.test-support.ts` (`CASE_PII_TABLES`), `services/retention.test.ts` and `retention-run.test.ts` (three report members), `services/context.test.ts` (four dependency members), `jobs/repeatable/phase8b.test.ts` (the export sweep) and `worker-cases.test.ts` (the file jobs).

### Extending `0028_phase8b`, as of (F)

The (Q) steps stand. The hand edits now hold fourteen `openverify_set_updated_at` triggers, the (Q) eleven and `case_attachments`, `file_renditions` and `case_exports`, before the history's function and trigger. `rendition_pages` has no `updated_at`.

### Columns and their forms (C143.5), checkpoint (F)

| Table | Column | Form |
|---|---|---|
| `case_attachments` | `original_filename` | sealed, row AAD `case_attachments.original_filename#<id>`; `null` once redacted (P34) |
| `case_attachments` | `wrapped_dek` (with `storage_key`) | the object's wrapped data key (`encryptBytes`, AAD the attachment id); both `null` once the object is deleted |
| `case_attachments` | `sha256` | 64-hex digest of the plaintext; `null` once redacted (P34) |
| `case_attachments` | `mime_type`, `byte_size`, uploader, scan status, provider, time and attempts, rendition status, page count, truncated, error code, attempts, `rendered_at`, `redacted_at`, `deleted_at` | plaintext: types, sizes, statuses, codes, ids and instants |
| `file_renditions` | every column | plaintext: a file id, a status, a page count, a code, counts and instants |
| `rendition_pages` | `wrapped_dek` (with `storage_key`) | the page object's wrapped data key (`encryptBytes`) |
| `rendition_pages` | `source_id`, `page`, `media_type`, `width`, `height`, `byte_size`, `discarded_at` | plaintext: an id, geometry, a size and an instant |
| `case_exports` | `request` | sealed JSON, row AAD `case_exports.request#<id>` (a search can name a field's value); `null` once the export finished |
| `case_exports` | `wrapped_dek` (with `storage_key`) | the file's wrapped data key, set exactly while the export is `completed` |
| `case_exports` | creator, format, `include_personal_data`, status, counts, size, error code, instants | plaintext |

`ENCRYPTED_COLUMNS`, `SEALED` (`caseAttachmentFilename`, `caseExportRequest`) and `REWRAP_TABLES` (`case_attachments`, `case_exports`, `rendition_pages`) hold the five; `case-file-plumbing.test.ts` re-wraps each under a new KEK and opens it with the new KEK alone. `REDACTION_SUBJECT_ID_PREFIXES` gains `catt`. `CASE_PII_TABLES` stands the three tables aside from the subject scan; their coverage is `api-case-files`' suite's.

## Measurements, checkpoint (F)

PGlite (each under the e2e lock; the timer imports `createTestDatabase` through `tsx`; "before" is a private worktree at `e80f0a90`, the base with (Q)'s 0028; cold with an empty `OPENVERIFY_TEST_DB_CACHE_DIR`):

| | Cold, first | Warm, first | Second | Load (1 min) |
|---|---|---|---|---|
| Before, at `e80f0a90` | 5,000, 6,341, 6,589 ms | 1,903, 2,401, 2,083 ms | 937 to 2,026 ms | 10.2 to 12.4 |
| After the (F) tables, at `c5aeef92` | 9,834, 10,422, 9,859 ms | 2,460, 2,343, 2,611 ms | 1,488 to 2,518 ms | 11.4 to 13.5 |
| Interleaved cold, before / after / before / after | 11,904 / 11,333 / 10,545 / 9,028 ms | | | 13.0 to 15.1 |

The interleaved runs show the gap between the first two rows is the load, not the four tables: run one after the other at the same load, before and after overlap. The 120 s hook budget is untouched.

## Gates, checkpoint (F), each read from its exit code

| Gate | Result | Time | Load (1 min) |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | | 10.3 |
| `pnpm format:check` | 0 | | |
| `pnpm turbo run lint typecheck --force --continue` (heap 4 GB), one call | 124 at the 590 s cap, every task still running cleanly | 590 s | 8.5 to 20.3 |
| the same as three forced calls: `typecheck`; `lint --filter=@openverify/api`; `lint --filter=!@openverify/api` | 0 (16 of 16), 0 (1 of 1), 0 (15 of 15): 32 of 32 | 249, 284, 317 s | 10 to 21 |
| non-API tests, four forced calls: `watchlist` and `e2e`; `db`, `checks` and `flow`; the nine others; `dashboard` | 0, 0, 0, 0: 15 of 15 packages, each at 80% or more | 545, 305, 67, 340 s | 9 to 31 |
| API unit suite, four blob shards and the merge | merge 0: 8,072 tests in 560 files, 94.33% statements, 85.38% branches | 263, 271, 220, 226 s; merge 11 s | 6.8 to 9.7 |
| `pnpm --filter @openverify/db test:integration` | 0, 73 in 16 files | 116 s | 6.3 to 22.3 |
| `--project graph` | 0, 13 (template built in 18.9 s, copied in 1.4 s) | 40 s | 13 to 21 |
| `--project api`, shards 1 to 3 | 0, 72, 91, 74 | 72, 194, 66 s | 6.7 to 15.6 |
| `bash infra/tests/ci-workflow.test.sh` | 0, 219 passed | | |
| `bash infra/tests/compose.test.sh --static-only` | 0, 501 passed | | |
| `benchmark:typecheck` and `benchmark:test` (rule 16: `testing.ts` and the repository index changed) | 0; 0, 119 in 12 files | | |
| mocked flow suite | 0, 79 | 25 s | 5.5 to 7.3 |
| e2e: down and build; a fresh stack (holder 431468) | 0 (build cached); 0 | 0 s; 75 s | 6.9; 3.7 to 6.4 |
| e2e shards 1 to 3 | 0, 38, 39, 36 | 135, 328, 245 s | 3.6 to 6.1 |
| e2e down (my holder) | 0 | | |

Per package (the non-API calls): core 99.83%, contracts 99.3%, db 93.31%, workflow-engine 98.02%, node 98.53%, flow 95.48%, checks 98.77%, dashboard 97.93%, watchlist 98.63%, e2e 97.22%, signals 96.37%, emrtd 94.97%, ui, config and flow-spec 100%.

### A slip, recorded

`.prettierignore` holds `services/`, which matches `apps/api/src/services/` as well as the vision service, so nothing under it is ever format-checked, and many of its files are not prettier-formatted. A `prettier --write src/services/*.ts` during the GREEN touched 37 files there. Each was compared with prettier's output of its committed version: 28 were exactly that, so they held no one's edit, and were written back to their committed content. Of the nine I had edited, six were prettier-clean when committed, so only my lines differed; the other three (`selfie-captures.ts`, `transactions/transactions.ts`, `handoff/flow-handoffs.ts`) were rebuilt from their committed content with my edits applied again. Nothing reformatted was committed. Later agents: run prettier on named files outside `apps/api/src/services/` only.
