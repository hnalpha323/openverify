# TDD evidence: Workflow 8A Stage 1a, `contracts-8a` (Phase 8)

- **Slice owner:** the Workflow 8A Stage 1a `contracts-8a` agent, running alone (it may touch any path its deliverables need).
- **Date:** 2026-11-01 and 2026-11-02.
- **Base:** `0d27c8f5`.
- **Input:** the "Stage 1a: contracts-8a" bullet of `docs/plans/phase-8.plan.md`, committed in its order. Sections 0 to 10 cover the first of three calls (the inventory, Common, (X) code), and sections 11 to 13 the second ((E), then (A) registry types). The drift and the decisions are in the plan's "Workflow 8A Stage 1a amendments (contracts-8a)".

Each change follows the same cycle: a stub (`chore`) when a test needs a name that does not exist yet, so the RED commit compiles and type-checks; the test, run to see it fail for the intended reason (RED, `test`); the smallest change that passes it (GREEN, `feat`). Every value in these tests and fixtures is synthetic.

All commands ran after `source scripts/env.sh`. Output is trimmed to the lines that matter.

## 0. Starting point, re-verified (`e08fe5cc`)

`docs/research/phase8-inventory.md`, and amendments 1 to 12: 47 permissions; 26 `stage()` call sites; the actor pins the plan does not name; the `InTx` forms; the list write paths; the redaction call sites; the signal view of a run; and the enum trap. Nothing else drifted.

## 1. Exhaustive actors, before the widening (`fb811cf1`)

A refactor on a green suite, as owner decision 5 after Workflow 7B asks: `createAuditLogger.record`, `reportRedactionActorOf`, `actionActor` and `actorOfHistory` all call `storedActorOf`, one exhaustive switch; the bulk creator and the biometric creator pass the type through with no cast.
```
$ (cd apps/api && pnpm exec tsc --noEmit -p tsconfig.json)      rc=0
$ (cd apps/api && pnpm exec vitest run src/services/audit-log.test.ts src/services/reports src/services/transactions src/services/graph src/services/lists/biometric src/services/redaction.test.ts --coverage.enabled=false)
      Test Files  24 passed (24)      Tests  289 passed (289)
```

## 2. The package and its dependencies

Skeleton `9971b0e4`; RED `353797b6`; GREEN `193fe956`; fix `ef719f16`.

RED:
```
$ pnpm --filter @openverify/workflow-engine exec vitest run src/dependencies.test.ts --coverage.enabled=false
     × pins bullmq 6.3.14 in the catalog      (and the five others)
     × gives the engine its runtime libraries from the catalog, and the oracle as a dev dependency
     × moves the API to the bumped queue library, through the catalog (decision 3)
     × holds one cron-parser and one bullmq in the lockfile, the pinned ones
     × carries a licence row for each, and the Emscripten notice
      Tests  10 failed | 1 passed (11)
```
GREEN: 11 passed, after `flock /tmp/openverify-pnpm.lock pnpm install` (9 packages added, 2 removed, no `minimumReleaseAgeExclude`, no build script).

**A defect, recorded.** `193fe956` went in with one test red: the commit followed the test in the same call, with no check of its exit code, and the test was wrong, because a version appears in both sections of the lockfile. `ef719f16` fixes the test.

## 3. Identifiers (C112.1)

RED `69c27bc5`; GREEN `17679a61`.
```
$ (cd packages/contracts && pnpm exec vitest run src/ids.test.ts --coverage.enabled=false)      × maps every C1 object to its prefix      Tests  1 failed | 51 passed (52)
$ (cd packages/db && pnpm exec vitest run src/ids.test.ts --coverage.enabled=false)      × holds the Workflow 8A prefixes, as the contracts table does (C112.1)      Tests  1 failed | 3 passed (4)
```
GREEN: 52 and 4 passed. It came first, because the actor tests need `testId('wfr')` to compile.

## 4. Scopes and the workflow-run actor (C112.5, C121.1, C143.9)

RED `171a837a`; GREEN `f46af97b`.

RED (`pnpm turbo run typecheck` on the five packages: 5 of 5 before the commit):
```
core        6 failed | 29 passed (35)     the scopes, the three role lists, REPORT_ACTOR_TYPES
contracts   4 failed | 135 passed (139)   the audit actor, filter[actor-id], the report action, the list creator
db          6 failed | 1 passed (7)       the enum, the three checks, the upgrade from 0026
api         5 failed | 61 passed (66)     storedActorOf, the logger and the served entry, the report redaction, the status change, the creator
dashboard   2 failed | 10 passed (12)     "Workflow run", the permission areas
```
The API and dashboard tests cast the actor at RED, because the union did not hold it; the casts left at GREEN.

GREEN: core 1,189; contracts 2,668; db 39 of the touched files; API 413 (`src/routes/dashboard src/seed` and the files above); dashboard 76.

**Two defects found on the way.**
- A check that compares `actor_id ~ ...` passes on a null id. The test `workflow_run` with `null` caught it, and the run clause reads `is not null` first (amendment 16).
- `drizzle-kit generate` wrote `0027_phase8a.sql` with no trailing newline on `_journal.json`, which was restored by hand so the journal's diff is the new entry alone.

**A defect of the GREEN commit, recorded.** `f46af97b` left `packages/db/src/schema.test.ts` red, because only the touched db files ran before it. The final gate caught it, and `5276e118` adds the value to that pinned list.

**The upgrade.** `migration-0027.test.ts` runs from `0026` with a row in place, because a fresh database passes whatever the checks say: the type is created in the same batch. The clause compares `actor_type::text`, so the migrator's one transaction never uses the new label.

### The console's two silent pins (RED `03cfbfe1`, GREEN `a9f9890b`)

Found while reading the console after the widening: the report history read anything but `key_` as "User", which no typecheck catches, and the audit filter refused a `wfr_` id.
```
$ (cd apps/dashboard && pnpm exec vitest run src/components/operators/audit-log-query.test.ts src/components/reports/report-history.test.tsx --coverage.enabled=false)
     × takes a workflow run as an actor, the link every run entry carries (C121.1)
     × explains each filter it cannot use, in plain words
     × names a workflow run as an actor, never as a user (C121.1)
      Tests  3 failed | 11 passed (14)
```
GREEN: 83 passed; `tsc --noEmit` rc=0.

## 5. Problem codes (C112.8, C113.6)

Stub `7a93d993`; RED `ef2efd99`; GREEN `17f967ff`.
```
$ (cd packages/contracts && pnpm exec vitest run src/fixtures.test.ts --coverage.enabled=false)      Tests  24 failed | 316 passed (340)
```
GREEN: 2,694 passed. The seventeen fixtures are written by a one-off script, as rule 15 asks. One fixture failed first: `problemSchema.reason` is typed to the flow's session reasons, so `run_not_resumable` carries `blocked-by` and `step-id` (amendment 18).

## 6. `readCsv` (F13, C118.5)

Stub `d8dea821`; RED `b8bf1882`; GREEN `45cc32c9`.
```
$ (cd packages/checks && pnpm exec vitest run src/csv/read.test.ts --coverage.enabled=false)      Tests  24 failed (24)
```
GREEN: `src/csv src/lists-dependencies.test.ts` 81 passed; the importer's suites, unchanged, `src/services/importers src/jobs/importers src/routes/server/importers.test.ts` 187 passed. They are the proof that the move changed nothing.

## 7. The log rule (C117.11, C143.5)

RED `3282ce40`; GREEN `6deaf128`.
```
$ (cd packages/config && pnpm exec vitest run src/eslint-phase5.test.ts --coverage.enabled=false)      Tests  25 failed | 132 passed (157)
```
GREEN: 157 passed.

## 8. ADR 0007 (`650759e2`)

## 9. (X) code: the Evaluate Code contract and the framing (C123.2, C123.3, C123.5, C123.6)

Stub `482213ea`; RED `16216009`; GREEN `94ea6475`.
```
$ (cd packages/workflow-engine && pnpm exec vitest run src/actions src/code-runner --coverage.enabled=false)      Tests  45 failed | 23 passed (68)
```
GREEN: the package's 82 tests; `tsc --noEmit` rc=0; `eslint .` rc=0.

## 10. Final gates of this call

Each ran in the foreground, and each exit code was read from the command, never through a pipe. Nothing else ran beside them.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | rc 0 |
| `pnpm format:check` | rc 0, after `prettier --write` on `meta/0027_snapshot.json` |
| `pnpm turbo run typecheck --force --concurrency=4` under `NODE_OPTIONS=--max-old-space-size=4096` | rc 0: 16 of 16, load 4.6 |
| `pnpm turbo run lint --force --concurrency=2` under the same heap | rc 0: 16 of 16, load 2.7 |
| `pnpm turbo run test --force --filter=!@openverify/api` | rc 0: 15 of 15 in 8 min 23 s, load 14.3 to 2.4: workflow-engine 82, flow-spec 117, core 1,189, node 321, ui 54, config 216, signals 192, emrtd 318, contracts 2,694, checks 3,815, flow 1,096, db 1,564, dashboard 4,785, watchlist 819 |
| API, `--shard=1/2`, `--shard=2/2` as blobs, each about 4 minutes at a load of 8 to 11, each exiting 1 on its partial coverage only | no failed test in either |
| `vitest run --merge-reports=<blobs> --coverage` | rc 0: 444 files, 5,970 tests; 95.66 / 87.16 / 97.72 / 95.7 |
| `pnpm --filter @openverify/api openapi:write`, twice | rc 0, and the second run changed nothing (`cmp` rc 0) |
| `pnpm --filter @openverify/watchlist benchmark:typecheck`, `benchmark:test` | rc 0, rc 0: `packages/db/src/testing.ts` changed |
| `migration-0024.integration.test.ts` on real Postgres, whose upgrades now run through `0027` | rc 0: 4 passed |
| The Android gate | rc 0 in 1 min 14 s, load 3.2 |

**The merge's directory.** Vitest 5 refuses a directory in `--merge-reports=<dir>` ("expects all paths ... to be files generated by the blob reporter"), so the coverage directories of the shards cannot sit inside `<dir>`, as rule 8's recipe has them. The blobs stay in `<dir>` and the coverage goes beside it.

## 11. (E): the definition, the resources, the events and the routes (C112-C114.4, C118, C120, C127.12, C128.6, C143.4)

Stub `a19912a7`; RED `583b3520`; GREEN `c28fe56b`. `code-sandbox` worked beside this call in its own paths, so its commits sit between these.

RED, after the stub made every name exist:
```
$ (cd packages/core && pnpm exec tsc --noEmit -p tsconfig.json)                                     rc=0
$ (cd packages/contracts && pnpm exec tsc --noEmit -p tsconfig.json)                                rc=0
$ (cd packages/node && pnpm exec tsc --noEmit -p tsconfig.json)                                     rc=0
$ (cd packages/core && pnpm exec vitest run src/workflows --coverage.enabled=false)
      Tests  10 failed (10)
$ (cd packages/contracts && pnpm exec vitest run src/workflow-definition.test.ts ... src/pii-collisions.test.ts --coverage.enabled=false)
      Test Files  10 failed (10)      Tests  167 failed | 400 passed (567)
      Error: ENOENT: ... contracts/fixtures/workflows/definition-every-node.json
      Error: not built
      AssertionError: expected true to be false // a schema that accepts anything
$ (cd packages/node && pnpm exec vitest run src/resources.test.ts --coverage.enabled=false)
      Error: ENOENT: ... contracts/fixtures/api/workflow.json
```
The 400 that pass are the tests already green at the stub's `z.any()`, and the existing ones in those files. The stubs are `any`, so the RED tests failed type-aware lint, as the earlier stubs did; they pass it at GREEN.

GREEN: core 1,199; contracts 3,077 in 78 files; node 359; `(cd apps/api && pnpm exec vitest run src/webhooks src/openapi.test.ts src/services/webhooks.test.ts)` 387; dashboard `src/lib/event-words.test.ts src/lib/api/events.test.ts` 198; `:openverify-sdk:testAndroidHostTest --tests '...ContractFixturesTest'` BUILD SUCCESSFUL.

The golden fixtures came from a one-off generator, as rule 15 asks; none is typed out.

**The webhook filter keys** were written in the GREEN working tree before their test. To see that test fail for its reason, the two keys were taken out and put back, with the test in place, before the commit:
```
$ (cd packages/contracts && pnpm exec vitest run src/workflows.test.ts -t 'webhook filters' --coverage.enabled=false)
     × filters a workflow, version or run event by workflow, and a list event by list      Tests  1 failed | 35 skipped (36)
```

**Three things the tests caught on the way.**
- The collision test failed on six names, which is amendment 35: four renames and two exemptions.
- `data` went into `PII_WORKFLOW_RUN_ATTRIBUTES` at first. It names every JSON:API body, so the list would have masked whole logs (amendment 36). The test now pins that it is absent.
- The first OpenAPI run wrote `#/components/schemas/__shared#/$defs/schema0` for each `z.json()`, which passes `openapi.test.ts` and is no valid reference. One named schema fixes it (amendment 41): after it the document holds no `__shared`, and 42 references to `#/components/schemas/JsonValue`.

## 12. (A) registry types (C122.1, C122.2, C120.6, F33)

Stub `4f01fd19`; RED `486e36be`; GREEN `7b4a1551`; style `6bb31e4a`.

RED:
```
$ (cd packages/workflow-engine && pnpm exec vitest run src/actions/registry.test.ts --coverage.enabled=false)
      Tests  no tests      Error: not built
```
The whole file fails at collection, because the object-type table is built in a `describe` body; `createActionObjectTypeTable` is the stub that throws.

GREEN: 43 passed; `src/actions src/index.test.ts` 102 passed.

**A defect in my own commit, recorded.** `7b4a1551` went in with one lint error in the test, a non-null assertion that `eslint --fix` had written in place of a cast. The commit ran in the same call as the lint with no check of its exit code. `6bb31e4a` replaces it with a row of its own, and that commit ran only after the lint exited 0.

## 13. Final gates of this call

Each ran in the foreground, each exit code read from the command. `code-sandbox` ran beside this call, so the API suite ran in four shards.

| Gate | Result |
|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | rc 0 |
| `pnpm format:check` | rc 0 |
| `pnpm turbo run typecheck --force --concurrency=4` under `NODE_OPTIONS=--max-old-space-size=4096` | rc 0: 16 of 16, load 10.7 to 8.8 |
| `pnpm turbo run lint --force --concurrency=2` under the same heap | rc 0: 16 of 16, load 8.1 to 9.7 |
| `pnpm turbo run test --force --filter=!@openverify/api`, first run | rc 1: two tests in `code-sandbox`'s `src/code-runner/`, with 8 of 15 tasks done at a load of 50; turbo stopped the rest. No file of mine |
| The same, split, because `--continue` at `--concurrency=6` reached the 590 s limit on the last package | every package rc 0 or complete below |
| 13 packages in one call (`--force --continue --concurrency=6`), cut at 590 s with only watchlist left | 13 of 14 successful, load 40 to 5.7: e2e 110, flow-spec 117, emrtd 318, ui 54, core 1,199, contracts 3,077, signals 192, config 216, node 359, checks 3,815, flow 1,096, db 1,564, dashboard 4,795 |
| `pnpm turbo run test --force --filter=@openverify/watchlist` | rc 0: 819 tests, 98.63% statements, in 4 min 55 s, load 5.5 to 4.0 |
| `pnpm turbo run test --force --filter=@openverify/workflow-engine`, after `code-sandbox`'s fix `55ca5a3a` | rc 0: 327 tests, 97.82% statements |
| API, `--shard=i/4`, four calls one after another at a load of 3 to 9, each exiting 1 on its partial coverage only | no failed test in any |
| `vitest run --merge-reports=<blobs> --coverage` | rc 0: 444 files, 5,980 tests; 95.66 / 87.16 / 97.72 / 95.7 |
| `pnpm --filter @openverify/api openapi:write`, twice | rc 0, and the second run changed nothing (`cmp` rc 0) |
| `pnpm --filter @openverify/watchlist benchmark:typecheck`, `benchmark:test` | rc 0, rc 0: `packages/contracts/src/index.ts` changed, additively |
| The Android gate | rc 0 in 1 min 33 s, load 6.0: 191 tasks, 14 executed |

## 14. (A) actions (C122, C127, C128, C42.3, C97, C104, C3)

Stubs `9b201f36`, `3d70ccca`; RED `c11f5e24`; GREEN `b14e4193`; style `8027215e` (one line of prettier on the state machine that the GREEN commit's check printed and did not stop).

RED, after the stubs made every name and record type exist:
```
$ (cd packages/core && pnpm exec tsc --noEmit -p tsconfig.json)                          rc=0
$ (cd packages/contracts && pnpm exec tsc --noEmit -p tsconfig.json)                     rc=0
$ (cd packages/workflow-engine && pnpm exec tsc --noEmit -p tsconfig.json)               rc=0
$ (cd packages/core && pnpm exec vitest run src/inquiry-state-machine.test.ts src/workflows/decisions.test.ts --coverage.enabled=false)
      Test Files  2 failed (2)      Tests  9 failed | 82 passed (91)
$ (cd packages/contracts && pnpm exec vitest run src/decisions.test.ts src/action-amendments.test.ts --coverage.enabled=false)
      Test Files  2 failed (2)      Tests  39 failed | 11 passed (50)
$ (cd packages/workflow-engine && pnpm exec vitest run src/actions/contracts.test.ts src/actions/catalogue.test.ts src/actions/errors.test.ts --coverage.enabled=false)
      Test Files  3 failed (3)      Tests  168 failed | 1 passed (169)
$ (cd apps/flow && pnpm exec vitest run src/i18n/consent-keys.test.ts --coverage.enabled=false)
      Test Files  1 failed (1)      Tests  2 failed | 6 passed (8)
$ (cd packages/node && pnpm exec vitest run src/resources.test.ts --coverage.enabled=false)
      Test Files  1 failed (1)      Tests  no tests    (the golden decisions.json did not exist)
```
The first RED run did not typecheck: the contracts' records had no new member and the test read attributes the stub has no type for. A second stub commit, `3d70ccca`, added the record members and the client methods, and the tests read those attributes through one cast. The 11 and 82 that pass are the tests the stubs already meet and the existing ones in those files.

GREEN: core `src/inquiry-state-machine.test.ts src/workflows` 101; contracts 3,156 in 80 files; engine `src/actions` 301; node 363; flow `src/i18n` 60; dashboard 4,795 in 327 files; API `src/webhooks`, the list, account-type, device and transaction route suites and `src/openapi.test.ts` 535, after `openapi:write`; `:openverify-sdk:testAndroidHostTest --tests ...ContractFixturesTest --tests ...MessagesTest --tests ...SpanishMessagesTest` BUILD SUCCESSFUL in 1 min 56 s at a load of 7.3.

**What the tests caught on the way.**
- `transitionInquiry` must not take a reopen from an ordinary caller. A plain edge in `INQUIRY_TRANSITIONS` would have made `POST /inquiries/:id/mark-for-review` move a declined inquiry and the console offer it, so the edge is held in a table of its own and taken only by naming it (amendment 46).
- The first golden contest route used `example.com`, which `fixtures.test.ts` refuses for an address: a contact is `@example.test`.
- `evaluateCodeOutputSchema`'s digest had no PII mark, so `createActionRegistry` would have thrown on the first real entry. The mark went in with the catalogue.
- The fixtures rewritten by the generator lost prettier's inline objects in `account-type.json`, so that one file was hand-edited to a two-line diff.

## 15. (X) egress (C124-C126)

Stub `fe572e92`; RED `548690ac`; GREEN `39343de7`.

RED:
```
$ (cd packages/workflow-engine && pnpm exec vitest run src/actions/egress.test.ts src/actions/catalogue.test.ts --coverage.enabled=false)
      Test Files  2 failed (2)      Tests  64 failed | 43 passed (107)
$ (cd packages/contracts && pnpm exec vitest run src/workflow-secrets.test.ts src/sandbox-messages.test.ts --coverage.enabled=false)
      Test Files  2 failed (2)      Tests  34 failed | 6 passed (40)
$ (cd packages/node && pnpm exec vitest run src/workflow-request-signature.test.ts --coverage.enabled=false)
      Test Files  1 failed (1)      Tests  23 failed (23)
```

GREEN: engine `src/actions` 390; contracts `src/pii-collisions.test.ts src/workflow-secrets.test.ts src/sandbox-messages.test.ts src/fixtures.test.ts src/problem.test.ts` 466; node 396; API `src/openapi.test.ts src/webhooks/samples.test.ts` 139 after `openapi:write`; `...ContractFixturesTest` BUILD SUCCESSFUL in 27 s.

**What the tests caught on the way.**
- `value` is a PII attribute of a list item, so a secret's plain `value` failed the collision test; it is `environment-value` (amendment 58).
- `eslint --fix` rewrote `[0-9]` to `\d` in the URL pattern, so a later scripted edit of that line matched nothing and the IDN test failed on the old pattern. The edit now asserts its match.
- The first URL pattern took ASCII hosts only, which would have refused an IDN before `normalizeHost()` ever saw it; a test of each form went in beside it.

## 16. After the checkpoint, and the final gates of this call

**Claimed steps.** RED `f9efa6d8`: `sync_graph` was `control` by C122.2's table cell, which C117.3 runs with no claim, while C127.5 calls it a claimed step. GREEN `47118d44` (amendment 56).

**Two defects the gates found in earlier commits of mine.**
- `b2cbc0da`: `e2e/tests/database.spec.ts` read `attributes.status` off `included`, and a decision has none. Lint caught the `any` it left; the spec now reads only what has one.
- `2137e465`: `report-races.integration.test.ts` named its actor `api_key`, the stored spelling, behind a cast. The two-way ternary this file's first-call refactor replaced read anything but `user` as a key, so the wrong spelling passed for two phases, and `storedActorOf` answered `undefined`. Three tests failed; call 1 and call 2 did not run `test:integration`, so it went unseen until here. The fixture was wrong, not the switch.

| Gate | Result |
|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | rc 0 |
| `pnpm format:check` | rc 0 |
| `pnpm turbo run lint typecheck --force --concurrency=4` under a 4 GB heap | rc 0: 32 of 32 in 4 min 57 s, load 5.6 to 8.4 |
| `pnpm turbo run test --force --continue --concurrency=6 --filter=!@openverify/api` | **rc 1: 14 of 15.** The one failure is `src/code-runner/pool.test.ts > finds no canary of an earlier evaluation in the same child`, `code-sandbox`'s, answering `timeout` at its 5,000 ms. flow-spec 117, signals 192, emrtd 318, checks 3,815, ui 54, contracts 3,250, e2e 110, core 1,214, config 216, node 396, flow 1,098, db 1,626, dashboard 4,795, watchlist 819; workflow-engine 1,903 of 1,904 |
| `pnpm turbo run test --force --filter=@openverify/workflow-engine`, alone | rc 0: 1,904 tests, 98.01 / 92.41 / 99.1 / 98.19, in 31 s, load 10.5 to 13.9 |
| API, `--shard=i/4`, four calls one after another at a load of 8 to 12, each exiting 1 on its partial coverage only | no failed test in any |
| `vitest run --merge-reports=<blobs> --coverage` | rc 0: 460 files, 6,226 tests; 93.43 / 85.4 / 94.41 / 94.22 |
| `pnpm --filter @openverify/api openapi:write`, twice | rc 0, the second run changed nothing (`cmp` rc 0), and neither changed the commit |
| `pnpm --filter @openverify/watchlist benchmark:typecheck`, `benchmark:test` | rc 0, rc 0 |
| The Android gate | rc 0 in 3 min 14 s, load 10.3: 191 tasks, 60 executed |
| `(cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts)` | rc 0: 69 tests in 15 files, 91 s |
| API integration, `--shard=1/2` and `2/2`, the second after `2137e465` | rc 0, rc 0: 99 and 118 tests, 36 files; the graph template built in 20.4 s |
| `bash infra/tests/ci-workflow.test.sh` | rc 0: 217 passed |
| `pnpm --filter @openverify/flow e2e` | rc 0: 79 passed in 28 s |
| A fresh stack, then `--shard=1/3`, `2/3` | rc 0, rc 0: 38 in 2.3 min, 37 in 4.7 min |
| `--shard=3/3` on that stack | the stack had gone (`no reusable e2e stack is running`), which is no test failure |
| A fresh stack, then `--shard=3/3` | rc 0: 34 in 4.0 min, so 109 full-stack tests |
| `e2e:stack:down` | rc 0; no container of mine is left |

**The load-dependent test is not fixed here.** The file is `code-sandbox`'s, and this call's rule is never to edit another agent's path. It scans 4 MiB byte by byte in interpreted QuickJS, about 1.8 s alone and past the 5,000 ms ceiling under CPU contention, so it failed in three of three whole-gate runs and passed alone. No file of this call touches the runner. The exact fix is in this call's report: walk the candidates with the native `bytes.indexOf(first, from)` instead of an interpreted loop.
