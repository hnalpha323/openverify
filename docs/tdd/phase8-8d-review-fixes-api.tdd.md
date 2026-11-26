# Phase 8 review fixes: API, flow, packages and Android (Workflow 8D review)

The evidence of the API fixer of the Workflow 8D review, one section per item, each with the commands actually run and their trimmed output. RED is the regression test seen failing for the intended reason; GREEN is the same test after the minimal fix. A targeted Vitest run of `apps/api` exits 1 on the package's 80% coverage gate alone (a single file cannot reach it), so the test counts are what each targeted run is read by; the gates at the end read exit codes only. Every command ran after `source scripts/env.sh`.

## K8-38: a refused field schema's publish problem names its own pointer

`publishVersion` prefixed each field problem with `/data/attributes/field-schemas` and then the problem's own pointer, which already starts `/field-schemas/<i>`, so a 422 named `/data/attributes/field-schemas/field-schemas/<i>/...` and the console could not place it. The test publishes a draft whose two fields share a key: the create route takes it (the contract refuses only `file` and `json`), and only the walker at publish refuses it.

**RED** (1 failed)

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/templates.test.ts -t "K8-38"
     × refuse to publish a field schema a case cannot have, at its own pointer (K8-38) 481ms
AssertionError: expected [ Array(1) ] to deeply equal [ Array(1) ]
  [
-   "/data/attributes/field-schemas/1/key",
+   "/data/attributes/field-schemas/field-schemas/1/key",
  ]
      Tests  1 failed | 8 skipped (9)
```

(A first draft used a `file` field; the create route refuses it with 400 before publish, so the test uses a repeated key, which only publish refuses.)

**GREEN**: the pointer is `${ATTRIBUTES}${problem.pointer}`, as the transition-map problems on the next lines already were. No contract or OpenAPI change.

```text
$ (cd apps/api) pnpm exec vitest run src/services/cases/templates.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

## K8-29: the rendition hook at a replaced flow upload, redact-biometrics and a rejected handoff (Stage 1b item 47, plan item 112)

Test-only. `case-file-joins.test.ts` stands in for the hook, so it proves only that a path calls it; these three tests run the real hook on a real rendition. A shared helper (`apps/api/src/test-support/rendition-pages.ts`) gives a file a `ready` rendition with one page whose object is stored (`requestFileRendition`, `recordFileRendition`, `seedRenditionPage`) and reads back the page row's `discarded_at` and the file's rendition state. Each test runs the path through its route and expects the page row discarded in the transaction (it stays, so the C16 pass still finds it), the rendition `deleted` (or gone with its file row, for a replaced upload, whose row is deleted outright) and the page's object gone from storage after the commit:

- `routes/flow/verifications.test.ts`: a second `front` upload replaces the first (`services/flow.ts`);
- `services/transactions/hooks.test.ts`: `POST /transactions/:id/redact-biometrics` on a transaction relating a selfie (`services/transactions/transactions.ts`);
- `services/handoff/flow-handoffs.test.ts`: `POST /flow/handoffs/current/reject` cancels the phone's open verification and its file (`services/handoff/flow-handoffs.ts`).

The hooks were already called, so the tests passed on first run. To show each one catches a missing hook, the three calls were changed to pass `fileIds: []` for one run and restored byte for byte from a copy (`git status` clean on the three sources afterwards):

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/flow/verifications.test.ts src/services/transactions/hooks.test.ts src/services/handoff/flow-handoffs.test.ts -t "K8-29"   # hook passed fileIds: []
     × discards the replaced file’s rendition pages and deletes their objects after the commit (K8-29)
     × discards the redacted file’s rendition pages and deletes their objects after the commit (K8-29)
     × discards the canceled files’ rendition pages and deletes their objects after the commit (K8-29)
AssertionError: expected { discarded: false, status: null } to deeply equal { discarded: true, status: null }
AssertionError: expected { discarded: false, status: 'ready' } to deeply equal { discarded: true, status: 'deleted' }
AssertionError: expected { discarded: false, status: 'ready' } to deeply equal { discarded: true, status: 'deleted' }
      Tests  3 failed | 81 skipped (84)
```

On the code as committed:

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/routes/flow/verifications.test.ts src/services/transactions/hooks.test.ts src/services/handoff/flow-handoffs.test.ts
 Test Files  3 passed (3)
      Tests  84 passed (84)
$ (cd apps/api) pnpm exec tsc --noEmit -p tsconfig.json    # exit 0
$ (cd apps/api) pnpm exec eslint src/test-support/rendition-pages.ts <the three test files>   # exit 0
```

No defect found: no source changed.

## K8-37: one RustFS starter that probes real readiness and starts a fresh container after a failed start

The 8C review's API fixer saw `storage.integration.test.ts`'s RustFS container never answer `/health/ready` within Testcontainers' 60 s start at a load of 9.9; the file alone passed. Workflow 8D's Stage 1 evidence (`phase8-api-carry-cases.tdd.md`, `phase8-api-carry-engine.tdd.md`, `phase8-platform-carry.tdd.md`) records no further failed start: its three api shards passed at loads of 6.6 to 12.0. Four integration files each built their own `GenericContainer('rustfs/...')`.

As K7B-13 did for Postgres: `apps/api/src/test-support/integration-rustfs.ts` holds `startIntegrationRustfs(credentials)`, the pinned image, the keys, port 9000 and Testcontainers' `/health/ready` wait at its own 60 s (not lengthened). A start is done only once a signed S3 `ListBuckets` answers through the mapped port (5 s per probe, polled with backoff for up to 60 s); a start that throws (Testcontainers stops and removes that container itself) or whose S3 API stays unready is followed by a fresh container, at most twice, each retry said on stderr. The retry loop is `startWithRetries` of `@openverify/db` (`integration-postgres.ts`), which gains two optional names, `service` (default `integration Postgres`) and `probeName` (default `select 1`), and is exported from `@openverify/db/testing`; every Postgres line and error reads as before. The starter lives in `apps/api` because `packages/db` has no `testcontainers` dependency of its own and none may be added. No test is retried, no timeout raised.

**RED** (both exit 1)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/test-support/integration-rustfs.test.ts
     × names the RustFS image in one source file, the starter every integration test uses
  [
-   "apps/api/src/test-support/integration-rustfs.ts",
+   "apps/api/src/api.integration.test.ts",
+   "apps/api/src/services/lifecycle.integration.test.ts",
+   "apps/api/src/storage/storage.integration.test.ts",
+   "apps/api/src/workflows/actions/messaging/canary.integration.test.ts",
  ]
      Tests  1 failed (1)
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/integration-postgres.test.ts
     × names the service and its probe in every line and in the error, for a container that is not Postgres (K8-37)
Expected: "integration RustFS did not start after 2 attempts: attempt 1: no ListBuckets within 1 s: connect ECONNREFUSED 127.0.0.1:9000; ..."
Received: "integration Postgres did not start after 2 attempts: attempt 1: no select 1 within 1 s: connect ECONNREFUSED 127.0.0.1:9000; ..."
      Tests  1 failed | 13 passed (14)
```

(The db test passed the two options through a spread in its RED run, so it typechecked before they existed; the GREEN names them in the literal.)

**GREEN**: the starter, the two options, and the four files on `startIntegrationRustfs`. The starter's own unit tests (the container's definition, a probe that rejects on a closed port) were written with the GREEN.

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/test-support/integration-rustfs.test.ts
      Tests  3 passed (3)
$ (cd packages/db) pnpm exec vitest run --coverage.enabled=false src/integration-postgres.test.ts src/testing.test.ts
 Test Files  2 passed (2)
      Tests  128 passed (128)
$ (cd apps/api) pnpm exec vitest run --config vitest.integration.config.ts --project api src/storage/storage.integration.test.ts src/api.integration.test.ts src/services/lifecycle.integration.test.ts src/workflows/actions/messaging/canary.integration.test.ts
 Test Files  4 passed (4)
      Tests  15 passed (15)           # 29.5 s, loadavg 3.46
$ (cd apps/api) pnpm exec tsc --noEmit -p tsconfig.json; (cd packages/db) pnpm exec tsc --noEmit -p tsconfig.json   # exit 0, 0
$ eslint of the changed files in apps/api and packages/db                                                        # exit 0, 0
$ pnpm --filter @openverify/watchlist benchmark:typecheck; pnpm --filter @openverify/watchlist benchmark:test      # exit 0, 0 (12 files, 119 tests): @openverify/db/testing changed
```

## R008: an infected or unscannable attachment's rendition leaves the pending set

Confirmed by reading the code: `attachmentSource` (`services/cases/attachments/rendering.ts`) answered `skip` for a scan of `infected` or `error`, which wrote nothing, so the attachment stayed `rendition_status = 'pending'` for ever; `listPendingRenditionSources` (K8-28) listed it every minute, oldest first under a limit of 500, so enough of them would fill every batch and keep the lost renditions behind them from being recovered, and API readers saw `pending`. Both verdicts are final (`scanning.ts`: an error stays after three attempts), so the job now records the rendition `failed` with `rendition_unavailable` under the row's lock while it is still pending and unredacted, never reading the object or sending a byte to vision. The suggested fix's other half (excluding the scan states from the query and from `case_attachments_rendition_pending_idx`) is not needed once no such row stays pending, and would have changed migration 0029. Serving is unchanged: the content route still answers 409 by the scan first. `docs/cases/attachments.md` says so.

**RED** (1 failed)

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases/attachments/attachments.test.ts -t "R008"
     × records it failed without asking vision, so the sweep never lists it again (Workflow 8D review R008)
-     "rendition_error_code": "rendition_unavailable",
-     "rendition_status": "failed",
+     "rendition_error_code": null,
+     "rendition_status": "pending",
      "scan_status": "error",
   (and the same for the infected one)
      Tests  1 failed | 14 skipped (15)
```

The test first expects `listPendingRenditionSources` to list both attachments (it does), renders each, and then expects both `failed`, no vision call, and neither listed again.

**GREEN**

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases/attachments/ src/jobs/cases/
 Test Files  4 passed (4)
      Tests  27 passed (27)
$ (cd apps/api) pnpm exec eslint src/services/cases/attachments/rendering.ts src/services/cases/attachments/attachments.test.ts   # exit 0
```

## K8-13: branch coverage of workflows/runs and services/cases

Test-only. Measured first from my own merged API coverage (four blob shards and a merge, `coverage-summary.json` summed per folder, subfolders included), at `0fd12c60` with K8-29's tests in the tree: 581 files, 8,226 tests, the package 94.66 / 85.62 / 96.69 / 94.73; `workflows/runs` 174 of 230 branches (75.65%), `services/cases` 1,395 of 1,773 (78.68%), `workflows/engine` 612 of 754 (81.17%). The uncovered branches were read from `lcov.info`, and a test was written only where a branch is a decision a run, a case transition, an assignment or an SLA makes; a branch reached only by a race inside a held lock (a queue archived under a case it still holds, a run ended between its listing and its lock) was left alone: a test of such a branch would have had to write a state the code never makes. Each new test passed on first run, because the behaviour was already right; none found a defect.

`workflows/runs` (`service.test.ts`, new `masking.test.ts`):

- resume, rerun and cancel of a run this environment does not hold are 404;
- a run whose values were redacted is neither resumed nor rerun (409 `run_not_resumable`, `blocked-by: values_gone`), and stays `errored`;
- a run that stopped as a whole at its deadline (the step sweep, past `deadline_at`) is never resumed, `blocked-by: run_deadline_exceeded`;
- rerun answers 409 `workflow_not_running` once the workflow has no published version;
- cancelling a parent cancels its child run still in progress;
- `cancel-runs` before a version the workflow does not hold is 404;
- a test run names only a version of its own workflow (404 otherwise), a workflow with no version is 404, an object id of a kind no run starts from is 404, and a body naming neither an object nor a payload is refused at 400 before any run;
- masking with nothing to go on is all `null`, keys kept: an action the registry does not hold or none, a control node with no plain member, inputs, variables and outputs of a missing definition, a trigger snapshot naming no type or an unknown one.

`services/cases` (`cases.test.ts`, `assignment/assignment.test.ts`, new `sla/policy-sla.test.ts`):

- a creator address naming nobody of the organisation is 422 at `/data/attributes/creator-email-address`;
- the history and the held objects page by their cursors, and a held-object cursor of another case is 400;
- a case moved into a queue and out again fires `case.queue-updated` twice, writes both `queue-changed` rows, and gets no assignee;
- a status that requires a tag takes only one it lists (`case_status_tag_required` for none and for an unlisted one), and the resolved row records the tag;
- removing objects a case does not hold changes nothing (no `lock-version` step, no history row);
- a comment is redacted by its author, by anyone else only with `cases:redact` (403 without), a repeat writes no second row, and an unknown comment is 404;
- `inquiry-creator` leaves a case with no inquiry, or whose inquiry an API key created, for pull;
- an SLA its calendar cannot measure answers `sla_out_of_range` (past the ten-year scan) or `calendar_invalid` (a zone the runtime does not know), at the caller's pointer when it names one; another error passes through.

```text
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/services/cases/cases.test.ts src/services/cases/assignment/assignment.test.ts src/services/cases/sla/policy-sla.test.ts src/workflows/runs/service.test.ts
 Test Files  4 passed (4)
      Tests  74 passed (74)
$ (cd apps/api) pnpm exec vitest run --coverage.enabled=false src/workflows/runs/masking.test.ts src/workflows/runs/service.test.ts
 Test Files  2 passed (2)
      Tests  41 passed (41)
$ (cd apps/api) pnpm exec tsc --noEmit -p tsconfig.json; pnpm exec eslint <the changed test files>   # exit 0, 0
```

A merged run after the `services/cases` tests and the first `workflows/runs` tests (583 files, 8,247 tests, merge exit 0; 94.83 / 85.82 / 96.78 / 94.9) read `services/cases` 1,428 of 1,775 (80.45%) and `workflows/runs` 180 of 230 (78.26%); the test-run and masking tests were then added for `workflows/runs`. The final merged figures are in the gates section below.

## The e2e gate and the suite's measurement (at `c2260b50`)

Each step under `flock /tmp/openverify-e2e.lock`, one step per hold, after `source scripts/env.sh`. The stack-down of step 2 ended a reusable stack another agent had started (the README's step for a fresh stack); the stack below is the one this call started, and it was taken down at the end.

```text
$ pnpm --filter @openverify/flow e2e                                              # exit 0, 79 passed (39.9 s), 42 s; loadavg 5.05
$ sh -c 'pnpm --filter @openverify/e2e e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^...'   # exit 0, 182 s with the lock wait
$ flock -w 120 ... pnpm --filter @openverify/e2e e2e:stack:up                     # exit 0, 80 s; loadavg 1.72 -> 2.92
$ OPENVERIFY_E2E_REUSE_STACK=1 ... playwright test --shard=1/3                    # exit 0, 46 passed (4.2 m), 251 s; loadavg 2.68 -> 2.44
$ OPENVERIFY_E2E_REUSE_STACK=1 ... playwright test --shard=2/3                    # exit 0, 46 passed (5.3 m), 318 s; loadavg 2.24 -> 1.25
$ OPENVERIFY_E2E_REUSE_STACK=1 ... playwright test --shard=3/3                    # exit 0, 45 passed (4.6 m), 279 s; loadavg 1.15 -> 2.23
$ pnpm --filter @openverify/e2e e2e:stack:down                                    # exit 0
```

The suite is 137 tests in 66 files; its time is the sum, 14.1 minutes plus 1.3 for the stack start. The full pass sent 9 OTP codes from 127.0.0.1 (9 `POST /api/v1/flow/verifications/:id/otp` in `e2e/.artifacts/logs/api.log`). Each shard is under 8 minutes, so three shards stand; the suite fits CI's one e2e job (Playwright's `globalTimeout` 45 minutes, the job's `timeout-minutes` 70), so neither changes and no shard matrix is added. `e2e/README.md` carries the new numbers.

## Final gates (at `6dd6ed35`; the commit after it changes only this file)

In the Phase 7 plan's Stage 4 order, after `source scripts/env.sh`, each read by its exit code. The other fixer ran its own suites and e2e alongside, so loads were high.

```text
$ pnpm format:check                                                        # exit 0
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force   # exit 0, 32 of 32 tasks, 326 s; loadavg 2.67
$ pnpm turbo run test --force --filter=!@openverify/api                    # exit 124 twice at the 595 s cap (loadavg 6.4 -> 21.4, the other fixer's e2e running); each time every package but @openverify/watchlist had finished its tests
$ pnpm turbo run test --force --filter=@openverify/watchlist               # exit 0, 69 files, 288 s; loadavg 9.37 -> 2.43
$ pnpm turbo run test --force --filter=!@openverify/api --filter=!@openverify/watchlist   # exit 0, 14 of 14 tasks, 554 s; loadavg 2.88 -> 11.96
$ (cd apps/api) vitest run --coverage --coverage.reportsDirectory=<dir>/coverage-i --shard=i/4 --reporter=blob --outputFile=<dir>/blobs/blob-i-4.json
   each shard exit 1 on its partial coverage alone, no failed test; 281, 247, 205 and 178 s (loadavg 11.0 -> 7.6)
$ (cd apps/api) vitest run --merge-reports=<dir>/blobs --coverage --coverage.reportsDirectory=<dir>/coverage-merged
   exit 0: Test Files 584 passed (584), Tests 8253 passed (8253); 94.84 / 85.87 / 96.79 / 94.91
   branches by folder (coverage-summary.json): workflows/runs 188 of 230 (81.74%), services/cases 1,428 of 1,775 (80.45%), workflows/engine 615 of 754 (81.56%)
$ pnpm --filter @openverify/db test:integration                            # exit 0, 17 files, 78 tests, 84 s; loadavg 7.16
$ (cd apps/api) vitest run --config vitest.integration.config.ts --project graph   # exit 0, 13 tests, 34 s; template built in 16,412 ms; loadavg 15.53
$ ... --project api --shard=1/3                                            # exit 0, 15 files, 75 tests, 65 s; loadavg 9.31
$ ... --project api --shard=2/3                                            # exit 0, 14 files, 91 tests, 148 s; loadavg 10.60
$ ... --project api --shard=3/3                                            # exit 0, 14 files, 75 tests, 67 s; loadavg 5.76
   no "integration RustFS" retry line in any shard's output
$ the e2e gate                                                             # exit 0 in every step, above (at c2260b50; only docs changed after it)
```

The whole-repo test gate did not fit one 10-minute call under that load, so it ran as two calls that together cover every package but the API, each exiting 0. No route, schema or contract changed, so `openapi:write` and the Android gate were not run; no vision, infra or CI file changed. `@openverify/db/testing` changed (K8-37), so the watchlist benchmark's `benchmark:typecheck` and `benchmark:test` ran (K8-37's section, both exit 0).
