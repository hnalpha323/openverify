# Phase 8, Workflow 8A Stage 4: integration-8a

Base `e9d78c23`. Every command ran after `source scripts/env.sh`, in the foreground, alone: no other agent ran in this stage. Plan record: "Workflow 8A Stage 2, 3 and 4 amendments" in `docs/plans/phase-8.plan.md`.

## 1. The wiring and the egress defects (C122.1, C123, C125, C126, C143.5)

RED `1019c229`:

```text
$ (cd apps/api && pnpm exec vitest run src/workflows/engine/actions.test.ts src/workflows/engine/render-config.test.ts \
    src/worker-workflows.test.ts src/workflows/services.test.ts src/workflows/actions/actions-objects.test.ts \
    src/workflows/runs/service.test.ts src/workflows/publish/publish.test.ts src/workflows/triggers/api-log-masking.test.ts \
    src/plugins/idempotency.test.ts src/seed/dev-seed.test.ts --coverage.enabled=false)
 FAIL src/worker-workflows.test.ts > closes the code runner when it stops ...       expected "vi.fn()" to be called 1 times, but got 0 times
 FAIL src/worker-workflows.test.ts > gives the engine the install's in-flight cap   expected undefined to be 7
 FAIL src/plugins/idempotency.test.ts > keeps no digest of a secret ...             expected undefined to be 'true'
 FAIL src/seed/dev-seed.test.ts > installs the recipes as paused drafts ...         expected 0 to be greater than 0
 FAIL src/workflows/services.test.ts > reads the install's egress settings ...      expected null not to be null
 FAIL src/workflows/actions/actions-objects.test.ts > offers an SMS link the countries of the inquiry's own template
 FAIL src/workflows/engine/actions.test.ts > holds a handler for every action ...   expected [ 'add_face_list_item', …(30) ] to deeply equal []
 FAIL src/workflows/engine/render-config.test.ts > leaves a source past the template cap   expected 'execution_error' to be null
 FAIL src/workflows/engine/render-config.test.ts > leaves `{{` in a source alone    the source was rendered
 FAIL src/workflows/publish/publish.test.ts > publishes a step that names a secret  422 secret_reference_invalid
 FAIL src/workflows/runs/service.test.ts > compares an allowed host through the one normaliser   expected 1 to be 2
 FAIL src/workflows/triggers/api-log-masking.test.ts > masks a run-action's parameters / a form's prefilled values
      Tests  14 failed | 195 passed (209)
$ (cd packages/workflow-engine && pnpm exec vitest run src/limits --coverage.enabled=false)        # 22 new codes read unknown-error
$ (cd apps/flow && pnpm exec vitest run src/flow/flow-renderer-contest-route.test.tsx --coverage.enabled=false)
TestingLibraryElementError: Unable to find role="link"
```

GREEN `0ca1363f`: the same files, 269 passed, then 339 in `src/workflows/engine`, the action, messenger, worker and seed suites. Two tests of my own broke and were fixed in that commit: `idempotency.test.ts`'s deep body needed `bodyFingerprint` inside the `try`, because `redactKeys` walks it too, and `publish.test.ts`'s key collided with an existing test's.

`compose.test.sh`: 520 passed, 2 failed (`api does not receive OPENVERIFY_PROVIDER_SLACK_*`), then 522 passed once `provider_kinds_api` named Slack, with the reason beside it.

## 2. Load-sensitive tests (rule 6)

Under 48 busy loops on 12 cores, before and after:

```text
$ scratchpad stress.sh 48 120 &  (cd packages/workflow-engine && pnpm exec vitest run src/code-runner --coverage.enabled=false)
 FAIL src/code-runner/pool.test.ts > the sandbox (C123.9) > finds no canary of an earlier evaluation in the same child
AssertionError: expected { ok: false, code: 'timeout', …(2) } to deeply equal { ok: true, value: 'undefined', …(1) }
      Tests  1 failed | 213 passed (214)      load 37.01
# after 00553fdf
      Tests  214 passed (214)                 load 53.76
$ (cd packages/core && pnpm exec vitest run src/transactions/card-guard.test.ts --coverage.enabled=false)   # under the same load
      Tests  47 passed (47)
$ (cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts --project api src/plugins/platform.integration.test.ts)
      Tests  3 passed (3)
```

`socket.test.ts` did not fail under this load in two runs, so no change was made to it.

## 3. The golden definitions and the country code

RED `d8321ce5`: 4 failed | 312 passed: `expected undefined to be 'NL'`, both goldens refused by the check, and the module's error edge. GREEN `76bd9b18`: 940 engine tests, 3,252 contracts tests.

## 4. A match's method, evidence, identifiers, link ids, child objects

RED `9b4e442c`: 5 failed | 75 passed. GREEN `22fc7ad0`: 99 passed. The report case moved to a pure test of `matchFacts`, because a seeded snapshot also has to fit the served `matched-lists`.

## 5. The specs

A first run on one fresh stack: 3 of 4 passed in 7.0 s. The fourth failed on my expectation (`route` for `route-key`) with everything else as built, and passed in 3.4 s once corrected. The worker log held no error line.

## 6. The code runner in compose and in CI

RED `282ee85a`: `compose.test.sh` 4 failed, `code-runner.test.sh --static-only` `FAIL - the compose app profile holds the code-runner service`. GREEN `e58cbe7e`: 527 and 21 passed. RED `52c1909f`: `FAIL - infra: runs bash infra/tests/code-runner.test.sh`; GREEN `a984a0f6`: 218 passed.

The host-test floor's first edit was no RED: `ci-workflow.test.sh` reads the floor from `ci.yml`, so moving both passes. `99a29c25` gave it a case that fails at the old floor (219 passed).

## 7. Final gates

Each exited 0, read from the exit code. Load read with `cat /proc/loadavg` beside each.

| Step | Result | Time | Load |
|---|---|---|---|
| `pnpm install --frozen-lockfile`, `pnpm format:check` | rc 0 | | |
| `pnpm turbo run lint typecheck --force --concurrency=4` (4 GB heap) | 32 of 32 | 5 min 10 s | 2.8 |
| `fetch_models.py`, `fetch_data.py`, `build:variant-groups` | rc 0, `29d05838…` | | |
| `pnpm turbo run test --force --filter=!@openverify/api` | 15 of 15, one call | 8 min 50 s | 2.1 to 12 |
| API suite, two blob shards and a merge | 7,673 tests in 530 files, 95.07% statements, 86.17% branches | 6.2 and 5.4 min | 7.8 |
| `benchmark:typecheck`, `benchmark:test` | rc 0 | | 4.1 |
| `pnpm test:integration` | rc 0; graph template 59.9 s | 5 min 22 s | 18.4 |
| vision ruff, format, mypy | rc 0, 78 source files | | |
| vision pytest, two halves | 1,466 and 1,081, 97.43% | 4.2 and 5.1 min | 1.6 |
| Android gate | rc 0, 1,334 SDK host tests | 1 min 16 s | 2.5 |
| `openapi:write`, `git diff --exit-code docs/api/openapi.json` | rc 0 | | |
| mocked flow suite | 79 passed | 22.8 s | |
| fresh stack | rc 0 | 1 min 6 s | 3.5 |
| e2e shards 1, 2, 3 of 3 | 38, 39, 36 passed: 113 | 2.3, 5.1, 3.9 min | 1.6 to 2.2 |
| `docker build` apps, vision, code-runner | rc 0 | 3 min 15 s, 16 s, 35 s | 2.7 |
| every `infra/tests/*.test.sh` | 43, 11, 219, 55, 527, 11, 9, 11, 55 passed | | |
| `gitleaks git --redact .` | 4,371 commits, no leaks | 5 s | |

Workflow benchmark, under the e2e lock, load 3.26 before and 3.19 after, 1,000 steps a row, one Node process:

| Scenario | 1 client | 8 clients | 32 clients |
|---|---|---|---|
| Effectful | 15 steps/s | 45 | 50 |
| Control flow | 93 | 205 | 211 |

The stack's sends: 9 `POST /flow/verifications/:id/otp` in a full pass, one under the budget of 10, so no spec moved. The four 8A specs send none.

After these gates, only `infra/tests/*.sh`, `.github/workflows/ci.yml`, docs and `apps/api/src/workflows/adapters.test.ts` and `reference-docs.ts` changed; `docs/tdd` and the plan's record followed. The last two were re-run with typecheck and lint.
