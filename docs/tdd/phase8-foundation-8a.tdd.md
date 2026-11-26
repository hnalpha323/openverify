# TDD evidence: Workflow 8A Stage 1b, `foundation-8a` (Phase 8)

- **Slice owner:** the Workflow 8A Stage 1b `foundation-8a` agent (plumbing only), beside `code-sandbox`, `engine-logic` and `contracts-8a`'s third call.
- **Date:** 2026-11-02.
- **Base:** `8d8c6c35` (the second `contracts-8a` call's last commit).
- **Input:** the "Stage 1b: `foundation-8a`" bullet of `docs/plans/phase-8.plan.md`, checkpoint (E), and the Stage 1a amendments. The decisions this stage took are in the plan's "Workflow 8A Stage 1b amendments (foundation-8a)".

Each unit follows the same cycle: a stub (`chore`) when a test needs a name that does not exist yet, so the RED commit compiles and typechecks; the test, run and seen failing for its intended reason (RED, `test`); the smallest change that passes it (GREEN, `feat`).

## Checkpoint (E): engine (ends at the record commit of this file)

| Unit | Stub | RED | GREEN |
|---|---|---|---|
| The engine tables | | `fc9c7e11` | `7ea8837b` |
| Repositories, sealing, the event cause write, retention, filters, settings | `1477885d` | `9972a5f7` | `45a328b2` |
| The event cause, the publisher, subjects, queues, jobs, services, masking, the problem class, redaction hooks, config | `0e55cd79`, `de7c32d4` | `5b9885c0` | `2b2af9f9` |
| The settings contract, the policies, `secret-value` | `2815e897` | `8945fad8` | `2b2af9f9` |
| The frozen routes | `ac93e908` | `b67fadb3` | `ea4ef71f`, with the OpenAPI snapshot, after the marker `c822607d` |
| The start checks and the recording producers | `249d3b90` | the commit after it | `ee77e509` |
| The dashboard minimum | | | `40c91542` |
| `DASHBOARD_SETTINGS_DEFAULTS`' test | | | `13fa4a72` |

### RED, as run

Tables, before the migration was regenerated:

```
$ pnpm exec vitest run src/phase8-engine-tables.test.ts --coverage.enabled=false
Received: "relation "workflows" does not exist"
Test Files  1 failed (1)
     Tests  37 failed (37)
```

The db plumbing:

```
$ pnpm exec vitest run src/repositories/workflow-plumbing.test.ts --coverage.enabled=false
× are listed for the rewrap, under their seal names
× are re-wrapped by kek:rewrap, so the new KEK alone opens them
× is written beside the payload, never in it
× keeps an event a pending delivery still needs
× match a run by its workflow
× fail a strict subject that lacks the attribute a filter names
× finds a run id in a copy
× apply the defaults for the keys an environment does not set
× keep what an environment set
Tests  9 failed | 16 passed (25)
```

The API plumbing, 16 files:

```
Test Files  16 failed (16)
     Tests  92 failed | 103 passed (195)
```

The contracts:

```
× replaces the value of every C12 secret key, and the flow URL that carries a session token
× have their policies with their default limits per window (C72.5, C107.3)
× give each policy its window: 60 s by default, an hour for the handoff issues (F09)
× state their defaults
× take each in an update
× take null to turn the host allowlist off and to follow the template’s countries
Tests  6 failed | 27 passed (33)
```

The core filters, run in a private worktree at the commit before their GREEN:

```
× matches a run by its workflow
× matches a list event by its list
× fails a strict subject without the attribute
Tests  3 failed | 29 passed (32)
```

The routes, before registration:

```
Tests  83 failed | 38 passed (121)
FAIL  ... the frozen routes (C112.6, C118.7, C120) > GET /workflows needs its scope
```

The start checks and the fakes:

```
× record a step with how it was enqueued
× warns about the pool in production, with no value in the line
× never refuses to start: a failed check is a logged error
Tests  6 failed | 8 passed (14)
```

### GREEN

Each unit's focused run exited 0 before its commit. Two defects of mine were caught on the way, both by a whole-package gate after `2b2af9f9`:

- `dashboard-api.test.ts` still held the old defaults (fixed by `13fa4a72`).
- `settings-fields.ts`' `RetentionSetting` took the new keys, which the forced typecheck refused (fixed by `40c91542`).

## New columns and their form (C143.5)

| Table | Column | Form |
|---|---|---|
| `workflow_runs` | `trigger_snapshot`, `inputs`, `variables`, `outputs` | sealed, row AAD (`SEALED.workflowRunTriggerSnapshot`, `.workflowRunInputs`, `.workflowRunVariables`, `.workflowRunOutputs`) |
| `workflow_runs` | ids, status, `waiting_on`, keys, `depth`, counts, timestamps | plaintext: ids and enums |
| `workflow_runs` | `error_type`, `error_code`, `error_node_id` | plaintext: codes only, format-checked (C120.2) |
| `workflow_runs` | `effective_grant`, `step_outcomes` | plaintext: scopes and counts |
| `workflow_run_steps` | `input`, `output`, `console` | sealed, row AAD (`.workflowStepInput`, `.workflowStepOutput`, `.workflowStepConsole`) |
| `workflow_run_steps` | `wait_correlation_key` | plaintext: an object id (C119.3) |
| `workflow_run_steps` | `wait_filter` | plaintext: a condition, no subject data (C114.5) |
| `workflow_run_steps` | `waiting_snapshot`, `waiting_xact` | `pg_snapshot`, `xid8` |
| `workflow_run_journal` | all | plaintext: a closed kind, ids, numbers, codes; never a value |
| `workflow_step_effects` | `result` | sealed, row AAD (`.workflowEffectResult`) |
| `workflow_step_effects` | `copy_target_id`, `copy_source_subject_ids` | plaintext: ids |
| `workflow_run_subjects` | all | plaintext: ids |
| `workflow_run_files` | `wrapped_dek` | wrapped DEK, `file` AAD; the object through `encryptBytes` with the row's id |
| `workflow_run_files` | `filename` | sealed, row AAD (`.workflowRunFileFilename`) |
| `workflow_run_files` | `mime_type`, `byte_size`, `sha256`, `storage_key` | plaintext |
| `scheduled_runs` | `inputs` | sealed, row AAD (`.scheduledRunInputs`) |
| `workflow_schedules` | `filter`, `cursor` | plaintext: the plaintext-attribute grammar, and a position |
| `workflow_versions` | `definition`, `grant`, `egress`, `acknowledgements`, `warnings` | plaintext: configuration (C113.6) |
| `workflow_triggers` | `filter` | plaintext: no subject data (C114.5) |
| `workflow_trigger_deliveries` | all | plaintext: ids, a status, a reason code |
| `workflow_wait_index`, `workflow_wait_candidates` | all | plaintext: ids and names |
| `account_actions` | `prefill` | plaintext: paths, never values |
| `events` | `caused_by_run_id`, `caused_by_principal`, `caused_by_test_run_id`, `caused_by_bulk_id`, `caused_by_principal_held_inquiries_write` | plaintext: ids and a flag, never in a payload |

## How to regenerate migration 0027 (for checkpoints (A) and (X))

`0027_phase8a.sql` is one file for the whole Workflow. To extend it:

1. Copy the file's hand edits out first: everything after the last generated statement, which is the twelve `set_updated_at` triggers, `openverify_workflow_run_journal_append_only` with its trigger (F12), and the autovacuum `ALTER TABLE`.
2. Run `pnpm --filter @openverify/core build`, because drizzle-kit reads core from its dist.
3. In `packages/db`, remove `drizzle/0027_phase8a.sql`, `drizzle/meta/0027_snapshot.json` and journal entry 27.
4. Run `pnpm exec drizzle-kit generate --name phase8a`.
5. Add the trailing newline back to `_journal.json`, keep every `ALTER TYPE` line first, and put the hand edits back, adding each new table with `updated_at` to the triggers.
6. Run prettier on `drizzle/meta/0027_snapshot.json`.

A new label of an existing enum (`report_origin`'s `workflow`) is only ever compared through `::text` (Stage 1a amendment 2). `migration-0027.test.ts` proves the upgrade from `0026`.

## Measurements

### PGlite (Risks; outcome 1), each under the e2e lock

`firstMs` is the first `createTestDatabase` of a process, and `secondMs` a second one in that process, from the template. "Before" is a private worktree at `8d8c6c35`.

| | Cold, first | Warm, first | Second | Load (1 min) |
|---|---|---|---|---|
| Before 0027's extension | 4,055, 4,367, 4,364 ms | 1,141, 1,065, 962 ms | 655 to 973 ms | 3.1 to 3.2 |
| After, at `7ea8837b` | 4,599, 4,727, 4,539 ms | 1,047, 1,002, 965 ms | 743 to 907 ms | 3.0 to 3.4 |
| Final, with the file redaction columns | 4,374, 4,309, 4,262 ms | 993, 979, 986 ms | 719 to 896 ms | 5.1 to 6.9 |

The cold migration grew by about 0.2 s of 4.3 s, and the warm open not at all, so the hook budget is untouched.

### CI (F08): the plan's Stage 1b amendments, item 1

The latest green run is CI 41387332060 on `f8c488ad`.

| Job | Minutes | Timeout | Steps |
|---|---|---|---|
| `node` | 13.9 | 20 | setup 0.5, typecheck 2.6, tests 10.6 |
| `lint` | 5.6 | 30 | lint 5.0 |
| `integration` | 11.7 | 30 | tests 11.0 |
| `unit-api` | 16.8, 15.0 | 30 | |

`@openverify/workflow-engine`, the whole package, under the e2e lock:

| When | Tests | Lint |
|---|---|---|
| At the start of this checkpoint (the code runner's tests alone) | 14.4 s at a load of 0.9 | 7.9 s, 561 MB peak |
| With `engine-logic`'s tests in | 1,904 tests in 17.9 s at a load of 10.1 | 21.3 s, 1.29 GB peak |

## Final gates

Each read from its exit code, in the foreground, on `2137e465` or later. Other agents' suites ran beside them, so the load is what it was.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | rc 0 |
| `pnpm format:check` | rc 0 |
| `pnpm turbo run lint typecheck --force --concurrency=4` under a 4 GB heap | rc 0, 32 of 32 tasks, 7 min 46 s |
| `pnpm turbo run test --force`, 13 packages (not api, watchlist, dashboard), `--concurrency=4` | rc 0, 13 of 13, 3 min 39 s, load 14 to 22 |
| The same, `watchlist` alone | rc 0, 8 min 33 s, load 41 to 11.5 |
| The same, `dashboard` alone | rc 0, 4 min 58 s |
| The API unit suite, 4 blob shards, then the merge | merge rc 0, 6,229 tests in 461 files, 95.62% statements, 87.25% branches, 97.5% functions, 95.67% lines. Each lone shard exits 1 on its partial coverage only, with no failed test |
| `pnpm test:integration`: `db` | rc 0, 69 tests in 15 files |
| `pnpm test:integration`: the rest | rc 0, 36 files |
| `benchmark:typecheck`, `benchmark:test` | rc 0, before each commit that touched `config.ts` or the db's shared files |
| `bash infra/tests/ci-workflow.test.sh` | rc 0, 217 passed |
| `bash infra/tests/compose.test.sh --static-only` | rc 0, 479 passed |
| `pnpm --filter @openverify/flow e2e` | rc 0, 79 passed |
| The full-stack gate on one fresh stack | shards rc 0: 38 in 3.3 min, 37 in 5.3 min, 34 in 5.3 min; 109 tests |

Two runs that did not count:

- The first `pnpm turbo run test` at the default concurrency stopped at `workflow-engine`. `src/code-runner/pool.test.ts`, "finds no canary of an earlier evaluation", answered `timeout` where it expected a value, at a load of 41, and passed in the next run at a load of 22. The file is `code-sandbox`'s; the amendments carry it.
- A full-stack shard 2 ended with "no reusable e2e stack is running", because the agent that held the stack ended it between my shards. No test ran. I started my own and ran all three.

## Checkpoint (A): actions and decisions (ends at the record commit of this section)

The shared tree held other agents' uncommitted work throughout, which at times failed to load (`workflows/definitions/audit.ts`, `engine/run-workflow.ts`). So every run below is in a private worktree at the current `HEAD` with my uncommitted files overlaid, and each commit is path-scoped.

| Unit | Stub | RED | GREEN |
|---|---|---|---|
| The tables and 0027 | | `59411628` | `7f1ceb2a` |
| Repositories, sealing, what a list write says, the trust mark on a merge | the `chore(db)` commit | the `test(db)` commit | `40dba8e6` |
| The hooks: decision, guard, reopen, list writes, redaction, reviewer, flow, resources, masking | `000cb33e` | `d5e60bf3` | `66230c96` |
| The list-rescreen producer, its wake-up and sweep; the frozen routes | | `61749cd2` | `66230c96`, with the OpenAPI snapshot |
| The `…InTx` forms | | | `05d02b1e`, a refactor with the services' suites green |
| The producer at each construction site | | | the `test(api)` commit after it |

### RED, as run

```
$ pnpm exec vitest run src/phase8-action-tables.test.ts --coverage.enabled=false
Test Files  1 failed (1)
     Tests  37 failed (37)

$ pnpm exec vitest run src/repositories/action-plumbing.test.ts src/repositories/signal-repositories.test.ts --coverage.enabled=false
× makes a decision id a redaction subject
× archives a list once, bumping its version
× says whether an item was archived by this call
× says which lists an item redaction changed, and which items went
× hands retention what it redacted, in its transaction
× says the same of a biometric redaction, and only of what it took
× says which lists clearing the basis archived, with the items they lost
× stores a list purpose, `block` by default (C122.1)
× stores a transaction type adverse statuses and a contest route (C122.1, C128.3)
× stores an account type contest route (C128.3)
× keeps a mark only the deleted device held
Tests  11 failed | 26 passed (37)

$ pnpm exec vitest run src/services/inquiry-decision-hooks.test.ts src/services/action-redaction-hooks.test.ts src/services/action-hooks.test.ts src/services/list-writes.test.ts src/jobs/lists/embed.test.ts src/jobs/importers/process.test.ts --coverage.enabled=false
Test Files  6 failed (6)
     Tests  66 failed | 100 passed (166)

$ pnpm exec vitest run src/jobs/list-rescreen-plumbing.test.ts src/routes/action-routes.test.ts --coverage.enabled=false
Tests  16 failed | 4 passed (20)
```

### GREEN, and what a focused run missed

Each unit's focused run exited 0 before its commit. A wider run then caught what the focused one could not: `redaction.test.ts` needed `DECISION_PII_TABLES`, and the redaction answer's new members failed three `toEqual`s, fixed in `66230c96`. My first `archiveListItem` wrote its audit entry only on a change, which would have dropped the repeat's entry; it is back as it was, and only `list.updated` depends on `changed`.

The `…InTx` forms are a refactor, so they have no RED: the public services' suites are what shows them unchanged (2,711 API tests in `src/services`, `src/routes` and `src/jobs/reports`), and `services/intx-forms.test.ts` adds what is new, that each writes only in the caller's transaction.

One prettier warning went by on the stub commit of the db unit: two files were committed unformatted, and the GREEN commit `40dba8e6` formats them.

## New columns and their form, checkpoint (A) (C143.5)

| Table | Column | Form |
|---|---|---|
| `inquiry_decisions` | `comment` | sealed, row AAD (`SEALED.inquiryDecisionComment`) |
| `inquiry_decisions` | the rest | plaintext: codes, ids, the operator's own contest route and basis |
| `transaction_children` | all | plaintext: ids |
| `list_rescreen_requests` | all | plaintext: ids, a version, timestamps |
| `devices` | `trusted_at`, `trusted_by_type`, `trusted_by_id`, `trust_reason` | plaintext: an actor id and a code, never free text |
| `transaction_types` | `adverse_statuses`, `contest_route` | plaintext: the operator's configuration |
| `account_types` | `contest_route` | plaintext: the operator's configuration |
| `lists` | `purpose` | plaintext: an enum |
| `transactions` | `reviewer_type`, `reviewer_id` | plaintext: an actor id |
| `report_runs` | `trigger_list_id`, `trigger_list_version` | plaintext: an id and a number |
| nine tables | `workflow_run_step_id` | plaintext: an id |

## Measurements, checkpoint (A)

PGlite, each under the e2e lock, in the private worktree:

| | First | Second | Load (1 min) |
|---|---|---|---|
| Cold | 6,018, 6,805, 6,083 ms | 832, 1,383, 1,087 ms | 3.2 to 4.7 |
| Warm | 1,712, 1,351, 3,277 ms | 1,387, 1,057, 2,301 ms | 5.1 to 6.3 |

## Final gates, checkpoint (A)

Each read from its exit code, in the foreground unless noted. The `test` and `lint` gates ran in the private worktree at `93eff1ad` to `f90e1553` while Stage 3 agents worked, and the last runs in the shared tree at `e3feafd5`, once it was clean.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile`, `pnpm format:check` | rc 0, at `e3feafd5` |
| `pnpm turbo run typecheck --force --concurrency=4` | rc 0, 16 of 16, at `f90e1553` |
| Forced lint, per package because the whole did not fit one call at a load of 20 | rc 0: `api` (160 s, load 15 to 6), `db` and `contracts`, and the other 13 at `93eff1ad` (nothing of theirs changed after) |
| `pnpm turbo run test --force --filter=!@openverify/api` | **rc 1**, 14 of 15, at `e3feafd5`: only `workflow-engine`'s `pool.test.ts`, which passes alone. See amendment 38 |
| The API unit suite, 4 blob shards, then the merge | merge rc 0, 6,806 tests in 499 files, 95.4% statements, 86.84% branches, 97.24% functions, 95.46% lines, at `e3feafd5`. Each lone shard exits 1 on its partial coverage only |
| `pnpm test:integration` | rc 0: `db` 69 tests in 15 files, `api` 234 tests in 39 files, 320 s, load 10 to 15, at `e3feafd5` |
| `benchmark:typecheck`, `benchmark:test` | rc 0, 119 tests, at `e3feafd5` |
| `bash infra/tests/ci-workflow.test.sh` | rc 0, 217 passed |
| `bash infra/tests/compose.test.sh --static-only` | rc 0, 479 passed |
| `pnpm --filter @openverify/flow e2e` | rc 0, 79 passed in 34.2 s |
| The full-stack gate on one fresh stack | shards rc 0: 38 in 4.1 min, 37 in 5.1 min, 34 in 4.2 min; 109 tests. Stack start 212 s at a load of 25 |

What did not count, and why:

- An API shard of 4 reached the cap at a load of 60, so that attempt moved to 8 shards, as rule 8 says: 6,805 tests passed at `f9c71539`, each shard 150 to 440 s. The 4 shards above ran after the load fell.
- Two API tests failed in `test:integration`, `lists.integration.test.ts`'s two writers: the fixture held no publisher. Fixed by `46ebcc40`. Four more of mine were found by the whole package gates: `migration-0026.test.ts`, `phase7-signal-tables.test.ts`, `schema-v2.test.ts` and `key-rotation.test.ts`, fixed by `f9c71539`. All were fixed before the runs above.
- A full-stack shard 2 failed twice in `report-monitoring.spec.ts` and `selfie-repeat.spec.ts`, on a stack another agent had already run a shard against: each reads state an earlier pass left (a watchlist at version 2, a face in the gallery), which is what a used stack holds. On a fresh stack both pass.
- One `e2e:stack:up` failed on a port the daemon could not bind, as another agent's stack came up beside it. I waited for that stack to go down and ran mine.
- The mocked flow suite does not build in the private worktree, because the fetched guidance files are not in it, so it and the full-stack gate ran from the shared tree.

## Checkpoint (X): egress (ends at the record commit of this section)

| Unit | Stub | RED | GREEN |
|---|---|---|---|
| The `wsecv` prefix | `15b7f989` | | |
| The tables and 0027 | | `da32429c` | `06e8f18f` |
| Repositories, sealing, rewrap, seeds | `60983416` | `1af14b76` | `c9bb9025` |
| The ports: messenger, Slack, mail sandbox, secrets service, policy client, guard | `d360ad33`, `89b0b8da`, `7d617490` | `7fb9a571`, `abd9c786` | `76734b51`, with the OpenAPI snapshot, `c19f660a` |
| A secret stands aside from the subject PII scan | | | `65bf684b` |

### RED, as run

```
$ pnpm exec vitest run src/phase8-secret-tables.test.ts --coverage.enabled=false
Received: "relation "workflow_secrets" does not exist"
Test Files  1 failed (1)
     Tests  16 failed (16)

$ pnpm exec vitest run src/repositories/secret-plumbing.test.ts --coverage.enabled=false
× are listed for the rewrap, under their seal names
× are re-wrapped by kek:rewrap, so the new KEK alone opens them
DecryptionError: unknown key id ...: its KEK is not in the keyring
Tests  2 failed | 2 passed (4)

$ pnpm exec vitest run src/providers/phase8-providers.test.ts src/http/policy-client.test.ts src/webhooks/ssrf.test.ts \
    src/workflows/masking.test.ts src/workflows/services.test.ts src/config.test.ts src/routes/secret-routes.test.ts \
    src/workflows/messaging-plumbing.test.ts src/worker-workflows.test.ts --coverage.enabled=false
× states today's behaviour as its defaults
× is masked in a stored log, where a search answers it outside any attributes
× is refused until it is built
× gives the worker every kind, sms and slack among them
× refuses a sandbox slack for production, without echoing a value
× reads them in the worker too, for workflow messages (C126.6, decision 76)
× builds the one messenger every message goes through (C126.8)
× binds the SMS sender with Twilio's credentials, for workflow messages
Tests  27 failed | 389 passed (416)

$ pnpm exec vitest run src/routes/secret-routes.test.ts --coverage.enabled=false
× GET /workflow-secrets reaches its handler
× POST /sandbox/email-messages/search reaches its handler
Tests  35 failed | 4 passed (39)
```

`messaging-plumbing.test.ts` passed against its stubs, as a stub's own test does.

### Two RED commits with a defect of mine

- `1af14b76` went in with a lint error: `eslint --fix` turned my assertions into `!` on an optional chain, and I committed in the same call as the lint with no check of its exit code. `c9bb9025` replaces them.
- `7fb9a571` went in with `secret-routes.test.ts` failing at collection, because a route's label read the test's environment before `beforeAll` had run, so it showed no route failing. `abd9c786` fixes it, and the RED above is from that commit.

### GREEN, and what a focused run missed

Each unit's focused run exited 0 before its commit. The forced lint then found `services.test.ts`'s optional chains and the cast in `triggers-engine.test.ts`, fixed by `c19f660a`. The API merge found `redaction.test.ts`'s scan, fixed by `65bf684b`.

## New columns and their form, checkpoint (X) (C143.5)

| Table | Column | Form |
|---|---|---|
| `workflow_secret_values` | `value`, `previous_value` | sealed, row AAD (`SEALED.workflowSecretValue`, `.workflowSecretPreviousValue`) |
| `workflow_secret_values` | `last4` | plaintext: what a console shows, as a webhook secret's |
| `workflow_secret_values` | ids, `version`, `previous_expires_at`, `rotated_by`, `rotated_at` | plaintext: ids and timestamps |
| `workflow_secrets` | `key`, `description`, `allowed_hosts`, `allowed_placements`, `created_by` | plaintext: the operator's configuration, no secret and no personal data |

## Measurements, checkpoint (X)

PGlite, each under the e2e lock, in the shared tree. `Before` is at `15b7f989`, `after` at `76734b51`.

| | First | Second | Load (1 min) |
|---|---|---|---|
| Before, cold | 4,555, 4,513, 4,463 ms | 733, 723, 733 ms | 0.5 to 0.9 |
| Before, warm | 1,258, 1,009, 1,059 ms | 746, 756, 793 ms | 1.2 to 1.5 |
| After, cold | 4,712, 4,496, 4,799 ms | 752, 779, 859 ms | 2.9 to 3.3 |
| After, warm | 1,023, 1,035 ms | 780, 761 ms | 2.7 to 2.8 |

The third warm run after the change rebuilt the cache, because the migrations' hash moved (4,743 ms), so it is left out.

The cold first databases of checkpoint (A)'s table (6,018 to 6,805 ms) were read at a higher load beside other agents' suites, so the two tables are compared only with the row before them.

## Final gates, checkpoint (X)

Each read from its exit code, in the foreground, in a private worktree at `65bf684b` (the shared tree held `api-actions`' uncommitted work), except the e2e gate.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile`, `pnpm format:check` | rc 0 |
| `pnpm turbo run lint typecheck --force --concurrency=4` under a 4 GB heap | rc 0, 32 of 32 tasks, 7 min 11 s, load 13 to 15 |
| The API unit suite, 4 blob shards, then the merge | merge rc 0, 7,090 tests in 512 files, 94.99% statements, 85.94% branches, 96.68% functions, 95.08% lines. Each lone shard exits 1 on its partial coverage only. Shards took 356 and 456 s two at a time, load 10 to 34 |
| `pnpm turbo run test --force`, 13 packages (not api, watchlist, dashboard), `--concurrency=3` | **rc 1**, 11 of 13, 310 s at a load of 30: `workflow-engine`'s `pool.test.ts` and `core`'s `card-guard.test.ts`, each the known load-sensitive test (amendment 38) |
| The same, `workflow-engine` alone, at `c19f660a` | rc 0, 35 files, load 11 |
| The same, `core` alone, at `c19f660a` | rc 1 at a load of 11 (525.9 ms of CPU against 500); rc 0, 1,214 tests, at a load of 3 |
| The same, `dashboard` alone, at `c19f660a` | rc 0, 327 files, 280 s, load 10 to 13 |
| The same, `watchlist` alone, at `c19f660a` | rc 0, 69 files, 277 s, load 10 to 3 |
| `benchmark:typecheck`, `benchmark:test` | rc 0, before each commit that touched `config.ts` or the db's shared files |
| `pnpm test:integration`, at `3b811c97` | rc 0: `db` 69 tests in 15 files, `api` 234 tests in 39 files, 584 s, load 24 to 40 |
| `bash infra/tests/ci-workflow.test.sh` | rc 0, 217 passed |
| `bash infra/tests/compose.test.sh --static-only` | rc 0, 495 passed |
| `pnpm --filter @openverify/flow e2e` | rc 0, 79 passed in 24.8 s |
| The full-stack gate on one fresh stack, at `65bf684b` | shards rc 0: 38 in 4.1 min, 37 in 5.7 min, 34 in 6.0 min; 109 tests. Stack start 231 s |

What did not count, and why:

- `pnpm test:integration` at `65bf684b` exited 1 on `selfie-capture-races.integration.test.ts`, three runs of three alone: a fixture actor `key_X`, which the real decision record of `api-actions` refuses, so the decline rolled back and its face data stayed. `api-actions` fixed its fixture in `3b811c97`, and the run above is at that commit.
- The first API merge, at `c19f660a`, failed on `redaction.test.ts`. `65bf684b` fixes it, and the merge above is after it.
- The first non-API call reached its 570 s cap with `dashboard` and `watchlist` running, so those two ran alone.
