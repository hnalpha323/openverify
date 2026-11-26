# Phase 8 review fixes: API, flow, packages and Android (Workflow 8C review)

The evidence of the API fixer of the Workflow 8C review, one section per item, each with the commands actually run and their trimmed output. RED is the regression test seen failing for the intended reason; GREEN is the same test after the minimal fix. Targeted Vitest runs pass `--coverage.enabled=false`, because the package's 80% gate applies only to the whole suite (the merged shards). Order: the blocking list (K8-17, R001), then the second list.

## K8-17: fetch_object answers the flattened view its check types (plan item 107)

`fetch_object` on an inquiry, account, report, transaction or verification answered the JSON:API resource, values under `attributes`, while the check types `steps.<id>.output.object` as the flattened view (C114.4). One test per type publishes-checks a definition that routes on `steps.got.output.object.status` and runs it. A verification's view is untyped (`UNKNOWN_OBJECT`, PII whole and nullable), so its check keeps refusing a literal comparison (`pii_literal_in_condition`, `on_null_missing`) and the test asserts exactly that; its run-time read is still checked.

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/actions-objects.test.ts -t "K8-17"
     × routes on the stored status of a fetched inquiry 318ms
     × routes on the stored status of a fetched account 150ms
     × routes on the stored status of a fetched report 188ms
     × routes on the stored status of a fetched transaction 157ms
     × routes on the stored status of a fetched verification 189ms
-   "errorCode": null,
+   "errorCode": "condition_input_null",
      Tests  5 failed | 53 skipped (58)
```

(An earlier draft seeded an `errored` report with no errors, which the report contract refuses; the RED above seeds a `ready` one, so each type fails only because the read reads nothing.)

**GREEN**: each row's `fetch` returns `buildTriggerView` of the masked document (the transaction's with its `included`), as the case row already did; the mask is the run's, and `fetchObjectOutputSchema` still marks `object` PII whole.

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/actions-objects.test.ts
 Test Files  1 passed (1)
      Tests  58 passed (58)
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/cases/cases.test.ts src/workflows/runs/service.test.ts src/workflows/engine/executor.test.ts
 Test Files  3 passed (3)
      Tests  69 passed (69)
$ pnpm --filter @openverify/api workflow-docs:write   # exit 0, docs/workflows unchanged
$ (cd apps/api) pnpm exec tsc --noEmit -p tsconfig.json   # exit 0
```

## R001: a decision on a catch-all route (C128.1)

`routesOf` digested every route up to the taken one, and a catch-all route has no condition, so `canonicalJson(undefined)` threw and every decision step on that path ended `execution_error`.

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run src/workflows/actions/decisions/facts.test.ts
     × keeps the path through a catch-all route, which has no condition to digest (Workflow 8C review R001) 12ms
 FAIL  src/workflows/actions/decisions/facts.test.ts > the path a record keeps (C128.1) > keeps the path through a catch-all route, which has no condition to digest (Workflow 8C review R001)
TypeError: A canonical value holds JSON values only
      Tests  1 failed | 12 passed (13)

$ (cd apps/api) pnpm exec vitest run src/workflows/actions/actions-inquiries.test.ts -t "catch-all"
     × declines through the route that has no condition, and writes its record 377ms
 FAIL  src/workflows/actions/actions-inquiries.test.ts > a decision on a catch-all route (Workflow 8C review R001) > declines through the route that has no condition, and writes its record
AssertionError: expected 'execution_error' to be null
      Tests  1 failed | 18 skipped (19)
```

**GREEN** (a route without a condition adds no digest; the break on the taken key stays outside the guard)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/decisions/facts.test.ts src/workflows/actions/actions-inquiries.test.ts
 Test Files  2 passed (2)
      Tests  32 passed (32)
```

## K8-4: two redaction header comments (comments only, no RED)

`packages/db/src/repositories/redaction.ts`: the `transactions` row now says they are reached with their inquiry or account since K7B-1, and the table gains 8A's and 8B's cascades (`transaction_children`, `workflow_runs` and `workflow_run_steps`, `inquiry_decisions` comments, `cases` with their comments, attachments, `file_renditions` and `rendition_pages`). `apps/api/src/services/redaction.ts`: the `audit` option no longer says C15 has no system actor; the cascades' entries are `appendSystemAuditEntry`'s `{ type: 'system', id: null }` since K7A-8.

## K8-15: every $ref of the committed OpenAPI document resolves (test-only)

**RED** (the walker stubbed to find nothing; a document with one bad reference, `#/components/schemas/__shared` as in Stage 1a amendment 41, and one escaped good one, `a~1b`)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/openapi.test.ts -t "K8-15"
     × finds a reference that names nothing 11ms
- [
-   "/paths/~1x/get/responses/400: #/components/schemas/__shared",
- ]
+ []
      Tests  1 failed | 1 passed | 13 skipped (15)
```

**GREEN** (`unresolvedRefs` walks the document, unescapes `~1` and `~0`, and names each `$ref` that reaches nothing; `docs/api/openapi.json` holds none)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/openapi.test.ts
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

## K8-18: 8A's object actions on a case (plan item 108)

Two defects. `getCustomFields` had no case branch, so `append`, `push` and `remove` on a case started from `{}` and overwrote what it held; and `tag_object`, `remove_tag`, `copy_tags` and `update_object` called `row.tag?.()` and `row.update?.()`, so a row lacking the method answered `applied` with nothing done. Every published type that lacks one is refused earlier (a verification's tags by its grant, `grantOfStep` answering `execution_error` for its null write scope; a report's attributes by its empty `writableAttributes`), so the second RED registers a probe row in `OBJECT_ROWS` for the test's length.

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/cases/cases.test.ts -t "K8-18"
     × append starts from the stored field 404ms
-     "value": "synthetic-reference-more",
+     "value": "-more",
      Tests  1 failed | 1 passed | 16 skipped (18)

$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/objects/methods.test.ts
     × refuses tag_object 14ms
     × refuses update_object on its tags 4ms
AssertionError: promise resolved "{ kind: 'succeeded', …(3) }" instead of rejecting
      Tests  2 failed (2)
```

**GREEN**: `getCustomFields` reads a case's stored fields (`getCaseRow`, as the case row reads it) and answers each typed `{ type, value }` as its value, the form the case update takes; `tagRow` and `updateRow` (`objects/tags.ts`) throw `action_input_invalid` (a WORKFLOW_ACTION_ERROR_TYPES code, `invalid-input-error`) when the row lacks the method, at all five call sites.

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/objects/methods.test.ts src/workflows/actions/cases/cases.test.ts src/workflows/actions/actions-objects.test.ts
 Test Files  3 passed (3)
      Tests  78 passed (78)
$ (cd apps/api) pnpm exec tsc --noEmit -p tsconfig.json   # exit 0
```

## K8-11: one masked list in @openverify/contracts (plan amendments 28, 126)

The comparison first: the API's `MASKED_ATTRIBUTES` against the engine's hand copy.

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/auth/pii.test.ts -t "K8-11"
     × is the same list in the API and in the workflow engine 14ms
- Expected
+ Received
-   "file",
-   "message-html",
-   "message-subject",
-   "message-text",
      Tests  1 failed | 17 skipped (18)
```

The engine lacked the importer's `file` and the sandbox message's three texts, so a run's trigger view read them untainted; every other name matched (the engine's device, handoff, session and network lists are within `PII_SIGNAL_ATTRIBUTES`).

**GREEN**: `PII_MASKED_ATTRIBUTES` (`packages/contracts/src/masked-attributes.ts`, the API's list moved whole, comments kept); `MASKED_ATTRIBUTES` is it, and `MASKED_ATTRIBUTE_NAMES` is its set. The engine's taint only widens. `trigger-view.test.ts` binds the engine to the contracts list.

```text
$ (cd packages/workflow-engine) pnpm exec vitest run --coverage.enabled=false
 Test Files  36 passed (36)
      Tests  1960 passed (1960)
$ (cd packages/contracts) pnpm exec vitest run --coverage.enabled=false
 Test Files  92 passed (92)
      Tests  3694 passed (3694)
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/auth/ src/case-plumbing.test.ts src/case-file-plumbing.test.ts src/case-queue-plumbing.test.ts src/workflows
 Test Files  66 passed (66)
      Tests  1050 passed (1050)
$ tsc --noEmit in apps/api, packages/contracts, packages/workflow-engine   # each exit 0
$ pnpm --filter @openverify/api workflow-docs:write   # exit 0, docs/workflows unchanged
```

## K8-8: C124.7's per-host concurrency holds per install (plan amendments 92, 126)

The port gains a lease (`KeyValueCache.acquireLease` and `releaseLease`) rather than a bare counter: a counter a crashed worker incremented stays high for as long as traffic keeps refreshing its TTL, while a lease scored by when it lapses frees itself. The RED commit adds the port's two members as stubs that reject, so every RED test typechecks.

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/https/handler.test.ts src/workflows/actions/https/host-slots.test.ts
     × holds five per install: a second worker sharing the store sees the first’s 1103ms
     × fails closed, retryable, when the store cannot answer 1ms
AssertionError: promise resolved "'sixth'" instead of rejecting
AssertionError: promise resolved "'sent'" instead of rejecting
      Tests  2 failed | 66 passed (68)

$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/cache/index.test.ts src/test-support/fakes.test.ts
     × takes at most the limit of leases in one transaction, lapses them by score and gives one back (K8-8) 7ms
     × rejects a lease whose transaction failed, and refuses a limit that is not whole and positive 1ms
     × holds at most the limit of leases, which lapse on the test clock or are given back (K8-8) 9ms
AssertionError: promise rejected "Error: not built yet" instead of resolving
      Tests  3 failed | 30 passed (33)
```

(Two module instances, through `vi.resetModules`, stand in for two workers; that file is its own, because a module reset inside `handler.test.ts` reset the keyring its later tests use.)

**GREEN**: Valkey keeps a sorted set of lease ids scored by when each lapses; one MULTI drops the lapsed, adds this one, counts and sets the key's TTL, and a taker past the limit takes its own back (concurrent takers near the limit can both give up, never both enter). The fake does the same on its clock. `withHostSlot(cache, ...)` takes a lease under a hashed key for 60 s (the timeout ceiling plus the 30 s margin), answers `rate_limited`, retryable, past five or when the store cannot answer, and gives it back in `finally`. `docs/workflows/https-request.md` no longer says 5 per worker.

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/https/ src/cache/index.test.ts src/test-support/fakes.test.ts src/providers src/workflows/actions/messaging
 Test Files  58 passed (58)
      Tests  837 passed (837)
$ (cd apps/api) pnpm exec vitest run --config vitest.integration.config.ts --project api src/cache/index.integration.test.ts   # Valkey 9.1, 20 concurrent takers
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## K8-23: the SLA status hook stages case.sla-expired with the caller's publisher (plan items 72, 104)

**RED** (exit 1; the request's publisher saw no `case.sla-expired`, because the hook staged it through `createOutboxOnlyPublisher`)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases/sla/sla.test.ts -t "unswept"
     × expires and stages case.sla-expired once when a pause comes after an unswept deadline 757ms
AssertionError: expected [] to have a length of 1 but got +0
      Tests  1 failed | 7 skipped (8)
```

The test now reads the event from the test API's recording publisher (exactly one, for the case) and checks that nothing went to the outbox instead; before, it read the outbox row.

**GREEN**: `CaseStatusChange.events` (optional) carries the caller's publisher and staged list; `setCaseStatusInTx` hands its unit's, so the event is dispatched with the status change's own events after the commit; a caller handing none keeps the outbox. One event per epoch is `writeSlaChangeInTx`'s, unchanged.

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases src/workflows/actions/cases
 Test Files  21 passed (21)
      Tests  245 passed (245)
```

## K8-31: the case row's field update shares updateCase's branch (refactor, no RED)

`services/cases/service.ts` exports `changedCaseFieldsInTx` (validate under the pinned version, diff, merge; nothing written) and `recordCaseFieldsInTx` (rebuild the searchable keys and write the `fields-changed` history row). `updateCase` and the case row's `writeFieldsInTx` both call them; each still writes the row itself, because `updateCase` sets the queue in the same row update (one `lock-version` step) and checks the queue between validation and the write, so a single `updateCaseFieldsInTx` would have changed its lock-version and error order. The history row's request id stays the caller's (`null` for a run).

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases src/workflows/actions/cases
 Test Files  21 passed (21)
      Tests  245 passed (245)
$ (cd apps/api) pnpm exec tsc --noEmit -p tsconfig.json   # exit 0
```

## K8-26: platform_file_not_allowed is typed, and set_case_sla answers a paused SLA (plan items 85, 109)

**RED** (exit 1)

```text
$ (cd packages/workflow-engine) pnpm exec vitest run --coverage.enabled=false src/actions/errors.test.ts
     × is a configuration error, never unknown 5ms
      Tests  1 failed | 23 passed (24)
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/cases/steps.test.ts -t "set_case_sla"
     × sets a wall-clock deadline, and clears it 403ms
-   "sla-state": "running",
     × sets a paused SLA in a pausing status, with no deadline yet (Workflow 8C review K8-26) 123ms
AssertionError: expected 'action_refused' to be null
      Tests  2 failed | 1 passed | 19 skipped (22)
```

**GREEN**: `WORKFLOW_ACTION_ERROR_TYPES.platform_file_not_allowed` is `configuration-error`. `setCaseSlaOutputSchema`'s `sla-expires-at` is nullable and `sla-state` (core's `caseSlaStateSchema`) joins it; `set_case_sla` in a pausing status sets the SLA paused, as `PATCH` does, and answers `{ sla-expires-at: null, sla-state: paused }`. It still refuses (`action_refused`) an answer whose state and deadline disagree, the contracts' own rule. `docs/workflows/errors.md` regenerated in the same commit (`actions.md` lists no outputs, so it is unchanged).

```text
$ (cd packages/workflow-engine) pnpm exec vitest run --coverage.enabled=false
 Test Files  36 passed (36)
      Tests  1961 passed (1961)
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/actions/cases src/workflows/definitions
 Test Files  6 passed (6)
      Tests  66 passed (66)
$ pnpm --filter @openverify/api workflow-docs:write   # exit 0; errors.md gains the row
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/reference-docs.test.ts src/openapi.test.ts
 Test Files  2 passed (2)
      Tests  19 passed (19)
```

## R002 (MEDIUM, confirmed): one failing row aborted the workflow-step sweep

Confirmed by reading `sweepWorkflowSteps`: no per-row catch, so a throwing `loadRun` ended the job before the later phases, `flushAfterCommit` and `dispatchReadySteps`, and the same row led the next sweep. Local fix.

**RED** (exit 1). The test's first commit (`d5c80a20`) did not typecheck (its logger and job shapes); the RED below is after the type fix, before any product change.

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/engine/sweep.test.ts -t "R002"
     × stops neither the other rows nor the dispatch: it is skipped and logged by id 332ms
DecryptionError: malformed envelope: expected 4 segments
      Tests  1 failed | 14 skipped (15)
```

**GREEN**: each row of the reclaim, wait-timeout and run-deadline phases runs inside `eachRow`, which logs a failure by phase, environment, run and step ids and the error's name (never a value) and goes on; `flushAfterCommit` and `dispatchReadySteps` run in `finally`. `EngineDeps.logger` gains `warn` (the worker passes its `WorkerLogger`).

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/engine
 Test Files  6 passed (6)
      Tests  84 passed (84)
```

## R003 (MEDIUM, confirmed): a rendition that fails retryably stayed pending with no cap

Confirmed: `renderSource` wrote `pending` on every retryable `VisionError` and nothing read `rendition_attempts` or `file_renditions.attempts`. Local fix, as `scan-attempts` does for scans.

**RED** (exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases/attachments/attachments.test.ts -t "R003"
     × stops asking after three retryable failures, and serves rendition_unavailable (Workflow 8C review R003) 763ms
-   422,
-   "rendition_unavailable",
+   202,
+   undefined,
      Tests  1 failed | 13 skipped (14)
```

**GREEN**: `RENDITION_ATTEMPTS = 3`; a retryable failure is `pending` only while fewer than three outcomes were recorded, and the third is `failed` with `rendition_unavailable`; a source already at the cap is failed without asking vision. Both sources (an attachment's `rendition_attempts`, a file's `attempts`) read their count. The back-off window the review also suggests is not added: the cap alone bounds what one document costs the lane (three 40 s attempts).

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases/attachments src/case-file-joins.test.ts src/case-file-plumbing.test.ts
 Test Files  4 passed (4)
      Tests  37 passed (37)
```

## R007 (MEDIUM, confirmed in part): the case search's tagged leaf bypassed its GIN index

Confirmed: the leaf compiled to `exists (select 1 from unnest(tags) ...)`, which `cases_lower_tags_idx` (GIN on `openverify_lower_tags(tags)`) cannot serve. Fixed locally. The sort half is skipped (see the skipped list): the cursor's keyset is built on the `coalesce(...)` key, so ordering by the raw column `NULLS LAST` needs a two-branch cursor predicate and an index per sort column (a migration), which is not a local change.

**RED** (exit 1; the first draft of the test, at `c5c7a632`, kept the environment condition, and the planner then preferred the environment's btree index whether or not the GIN index was usable; the leaf is now explained alone with sequential and plain index scans off)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases/search-plan.test.ts   # search.ts at HEAD
     × reads the lower-tags GIN index 39ms
+ Seq Scan on cases  (cost=10000000000.00..10000000023.00 rows=40 width=32)
+   Filter: EXISTS(SubPlan 1)
```

**GREEN**: `openverify_lower_tags(tags) @> array[lower(value)]::text[]`, the form the other resources' tag filters use.

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases/search-plan.test.ts src/services/cases
 Test Files  19 passed (19)   # after the fix; search-plan.test.ts: Tests 1 passed (1)
```

## R009 (MEDIUM, confirmed): the console's new runtime dependencies had no licence rows (docs only, no RED)

Confirmed: `THIRD_PARTY_LICENSES.md` had no row for any package Workflow 8C Stage 1 added, and §2.2 still listed `@xyflow/react` as "to verify on adoption". §2.1.15 now records the eighteen rows of `docs/tdd/phase8-dashboard-workflows.tdd.md` (the six `@types/d3-*` packages in one row), each version checked against `pnpm-lock.yaml`; the planned row is removed. Every licence is MIT, ISC or BSD-3-Clause, all named by rule 4.

```text
$ grep each package in pnpm-lock.yaml   # @xyflow/react 12.12.0, @xyflow/system 0.0.83, zustand 4.5.7, classcat 5.0.5, d3-* as listed, @dagrejs/dagre 3.1.1, @dagrejs/graphlib 4.0.5, @panzoom/panzoom 4.6.2, use-sync-external-store 1.7.0
$ pnpm exec prettier --check THIRD_PARTY_LICENSES.md   # exit 0
```

## K8-35: opposite lock orders on a queue and its cases (plan item 77)

The race, on Postgres 17 (`queues-races.integration.test.ts`): a raw transaction holds a case (the entry's order) until the members change waits for that case, then asks for the queue; `setCaseQueueMembers` holds the queue and asks for the case. The members change waited first, so Postgres aborts it.

**RED** (exit 1, `cat /proc/loadavg` 1.42)

```text
$ (cd apps/api) pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/cases/queues/queues-races.integration.test.ts
     × answers a members change that deadlocked with an entry, as if they had queued 1047ms
Caused by: error: deadlock detected
Serialized Error: { ..., code: '40P01', detail: 'Process 335 waits for ShareLock on transaction 880; blocked by process 336.
Process 336 waits for ShareLock on transaction 881; blocked by process 335.', where: 'while locking tuple (8,1) in relation "cases"', ... }
      Tests  1 failed | 3 passed (4)
```

**GREEN**: a bounded retry rather than one lock order, because the orders are spread over the entry, the pull, the reassign sweep, the members change and archiving: `caseChange` (every case and queue route's transaction) runs a transaction aborted with `40P01` or `40001`, anywhere in the error's causes, again from the start, at most three times in all, and dispatches only the committed run's staged events. `case-change.test.ts` pins the bound and that any other error is thrown at once.

```text
$ (cd apps/api) pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/cases/queues/queues-races.integration.test.ts
      Tests  4 passed (4)
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases
 Test Files  20 passed (20)
      Tests  209 passed (209)
```

## K8-22: strict metadata schemas for the case, template, comment, case-action and review-request audit entries (plan item 114)

**RED** (exit 1; `audit.ts` a stub with no schema)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases/audit.test.ts
     × has a strict schema for every action the case code audits 20ms
+   "case-action.created", "case-action.run", "case-action.updated", "case-bulk-action.created",
+   "case-comment.redacted", "case-template-version.created", "case-template-version.published",
+   "case-template-version.updated", "case-template.archived", "case-template.created",
+   "case-template.updated", "case.comment-added", "case.created", "case.objects-added",
+   "case.objects-removed", "case.redacted", "case.status-changed", "case.tags-changed",
+   "case.updated", "inquiry.review-requested",
     × refuses a member beyond its schema, for every action 1ms
     × refuses free text where a key or a status belongs 3ms
      Tests  3 failed (3)
```

(The coverage test scans every `action: '...'` literal under `services/cases` and `workflows/actions/cases`; the queue and file actions are covered by their own builders. `case-bulk-action.created` was found by the scan beyond the item's list.)

**GREEN**: `services/cases/audit.ts` holds a strict schema per action: ids by the `<prefix>_<ULID>` form, member names, field and status keys by core's patterns, counts, the bulk action enum, and `case.redacted`'s two causes. `auditEntryOf` checks a case action's metadata, so every case unit's entry and the case-action routes' are held to it; the case redaction's entry (written with `appendAuditLog` or `appendSystemAuditEntry`) is checked where it is built.

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases src/workflows/actions/cases src/routes src/services/redaction*.test.ts
 Test Files  134 passed (134)
      Tests  2200 passed (2200)
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows src/jobs src/case-*.test.ts
 Test Files  151 passed (151)
      Tests  2058 passed (2058)
```

## K8-3: a used stack holds one clean pass (docs only, no RED)

`e2e/README.md` under "The reusable stack": the Shards line brought up to date with this review's measurement, and a new line on a used stack (one clean pass; `otp-ip-hour`; 9 sends in the review's full pass, counted as `"method":"POST","route":"/api/v1/flow/verifications/:id/otp"` in `e2e/.artifacts/logs/api.log`; 8A's and 8B's specs send none; repeat a shard on a fresh stack; a stack down never queued behind another's up).

```text
$ grep -c '"method":"POST","route":"/api/v1/flow/verifications/:id/otp"' e2e/.artifacts/logs/api.log
9
```

## Final gates (in the order of the Phase 7 plan's Stage 4 amendment 14)

```text
$ pnpm format:check                                                     # exit 0
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force --concurrency=2
                                                                        # exit 124: the whole did not fit one 10-minute call at a load of 10 to 15
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run typecheck --force --concurrency=3
 Tasks:    16 successful, 16 total   Time: 2m21s                        # exit 0 (load 9.0)
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=1 --filter=@openverify/api
 Tasks:    1 successful, 1 total     Time: 2m32s                        # exit 0 (load 4.6)
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=2 --filter=!@openverify/api
 Tasks:    15 successful, 15 total   Time: 3m46s                        # exit 0 (load 1.4)
$ pnpm turbo run test --force --filter=!@openverify/api                  # exit 1 (load 2.6 rising to 17.9)
 Failed:    @openverify/dashboard#test
 FAIL  src/components/cases/reviewer/forms.test.tsx > AssignmentControl > assigns to oneself, to a member with cases:assign, and unassigns
 FAIL  src/components/cases/reviewer/forms.test.tsx > SlaForm > sets a deadline and clears it
   (Unable to find ... "Clear SLA"; the console fixer's file. Alone at a load of 8.4: Tests 15 passed (15), exit 0. Not edited here.)
$ (cd apps/api) vitest run --coverage --shard=i/4 --reporter=blob ...   # four shards, each exit 1 on partial coverage alone (loads 7 to 16)
$ (cd apps/api) pnpm exec vitest run --merge-reports=/tmp/claude-1000/apigate/blobs --coverage --coverage.reportsDirectory=/tmp/claude-1000/apigate/coverage-merged
 Test Files  573 passed (573)
      Tests  8168 passed (8168)
Statements 94.64%  Branches 85.62%  Functions 96.66%  Lines 94.71%     # exit 0
$ pnpm --filter @openverify/db test:integration                         # exit 0: 16 files, 73 tests, 81.4 s (load 6.2 to 15.6)
$ (cd apps/api) pnpm exec vitest run --config vitest.integration.config.ts --project graph
graph template: 225000 rows of 100000 accounts built in 14783 ms       # exit 0: 13 tests, 28.9 s (load 14.3)
$ (cd apps/api) ... --project api --shard=1/3                           # exit 1 (load 9.9): storage.integration.test.ts: "URL /health/ready not accessible after 60000ms" (RustFS container start)
   storage.integration.test.ts alone at a load of 13.0: 3 passed, exit 0; the shard again: 14 files, 74 tests, exit 0 (59.2 s, load 11.2)
$ (cd apps/api) ... --project api --shard=2/3                           # exit 0: 14 files, 91 tests, 147.0 s (load 4.0)
$ (cd apps/api) ... --project api --shard=3/3                           # exit 0: 14 files, 74 tests, 63.2 s (load 5.0)
$ (cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 13s                                                  # exit 0 (no Android input changed; host-test count unchanged, CI floor stays 1,334)
$ pnpm --filter @openverify/api openapi:write (twice); git diff --exit-code docs/api/openapi.json   # exit 0, 0, 0
```

**The e2e gate, and the suite measured with the console's `ui-*` specs** (each step under `flock /tmp/openverify-e2e.lock`; `cat /proc/loadavg` beside each):

```text
$ pnpm --filter @openverify/flow e2e                                    # exit 0: 79 passed (21.8 s), load 5.5
$ e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^...   # exit 0
$ flock -w 120 ... e2e:stack:up                                         # exit 0, ready in 72 s (holder 1121580), load 5.3
$ ... playwright test --shard=1/3   Running 44 tests   44 passed (3.9m)                       # exit 0, 234 s, load 3.7 -> 0.7
$ ... playwright test --shard=2/3   Running 41 tests   41 passed (4.9m)                       # exit 0, 294 s, load 0.7 -> 1.8
$ ... playwright test --shard=3/3   Running 42 tests   1 failed, 1 did not run, 40 passed (5.0m)   # exit 1, 299 s, load 1.6 -> 2.3
   ✘ tests/ui-reviewer.spec.ts:159 › the case page loads under an injected nonce script CSP with no violation (C142.6, F33)
     Expected pattern: /Zoom 1[2-9]\d%/   Received string: "Zoom 100%, offset 0, 0, rotated 0°"
   (the console fixer's spec, R015; re-run alone on the same stack: tests/ui-reviewer.spec.ts 3 passed, exit 0, load 1.9)
$ e2e:stack:down                                                        # exit 0, my holder only
```

The suite: 127 tests in 64 spec files; shards of 44, 41 and 42 in 3.9, 4.9 and 5.0 minutes plus 1.2 for the stack start, 15.0 minutes in all, at a load of about 1 to 4. Each shard is under 8 minutes, so three shards stand and CI's one e2e job, its `timeout-minutes` and Playwright's `globalTimeout` are unchanged.

Branch coverage of K8-13's folders, read from the merged API coverage above: `workflows/runs` 74.30% (159 of 214), `services/cases` 78.55% (1,355 of 1,725), `workflows/engine` 80.45% (605 of 752).
