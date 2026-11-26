# Phase 8, Workflow 8B Stage 3: `api-queues-sla` (TDD evidence)

Owner of `apps/api/src/services/cases/{queues,assignment,sla}/` (except `case-logic`'s
`business-time.ts` and `sla-state.ts`), `routes/server/{case-queues,case-assignment,case-assignment-policies,case-sla-policies,case-calendars}.ts`,
`jobs/repeatable/cases.ts` and `packages/db/src/repositories/{case-queues,case-policies,case-sla}.ts`.
Base: `99aaa36a` (foundation-8b's checkpoint (Q) record, after `case-logic`'s `bb789ee0`).

Every command was run after `source scripts/env.sh`; outputs are abbreviated to the lines that
matter. Loads are `cat /proc/loadavg` beside each run.

## Slice 1: the db repositories (C132, C133)

| Step | Commit |
|---|---|
| Stub: the new names with their signatures (`pullNextCaseId` gains the reader), each rejecting with `CaseRepositoryNotBuiltError` | `abc066ed` |
| RED: `packages/db/src/repositories/case-queue-repositories.test.ts` (13 tests) | `e80f0a90` |
| GREEN: `case-queues.ts`, `case-policies.ts`, `case-sla.ts`; the plumbing test's stub block changed with the plan | `a9b80555` |

RED, `pnpm exec vitest run src/repositories/case-queue-repositories.test.ts --coverage.enabled=false`
(packages/db), exit 1, each for the intended reason:

```
× writes, reads, changes and archives a queue, and moves its cursor
  CaseRepositoryNotBuiltError: createCaseQueueRow is not built yet (api-queues-sla)
× takes the most urgent unassigned case the reader may see, by deadline then age
  CaseRepositoryNotBuiltError: pullNextCaseId is not built yet (api-queues-sla)
× reads activity, permission, template visibility, open cases and the latest assignment
  CaseRepositoryNotBuiltError: readCaseAssigneeFacts is not built yet (api-queues-sla)
× locks running deadlines due now, earliest first, with their epoch and organisation
  CaseRepositoryNotBuiltError: lockDueCaseSlas is not built yet (api-queues-sla)
… 13 failed (13), 12.5 s
```

GREEN, the same file with `case-queue-plumbing.test.ts`, exit 0: `Tests 26 passed (26)`, 11.9 s.
The plumbing file's "names api-queues-sla until it is built" block now asserts each answers without
`CaseRepositoryNotBuiltError` (changed with the plan, not weakened: every function is called).

## Slice 2: the services, routes and sweeps (C132.1-C132.6, C133.1-C133.7, decision 59)

| Step | Commit |
|---|---|
| RED: `services/cases/queues/{testing,queues.test}.ts`, `assignment/assignment.test.ts`, `sla/sla.test.ts`, `jobs/repeatable/cases.test.ts` (39 tests) | `62d9ead1` |
| GREEN: the services, `assignOnEntry`, the status hook, the sweeps; `case-queue-routes.test.ts` changed with the plan | `510cefe7` |

RED (apps/api, load 7.8 to 10.2), `pnpm exec vitest run src/services/cases/queues/queues.test.ts
src/services/cases/assignment/assignment.test.ts src/services/cases/sla/sla.test.ts
src/jobs/repeatable/cases.test.ts --coverage.enabled=false`, exit 1:

```
Tests  38 failed | 1 passed (39)
35 × expected 501 to be 200/201/422  ("POST /case-queues is not built yet.", "POST /cases/:id/assign is not built yet.", …)
 2 × AssertionError: expected 'running' to be 'expired'   (the case-sla sweep stub did nothing)
```

The one that passed before any code, "leaves a case with no SLA as it is", holds a behaviour the stub
hook already had (it moves nothing).

GREEN, the same four files, exit 0 (load 12.7 to 13.8): `Tests 39 passed (39)`, 46.3 s. Then the
frozen-route file: its 20 "answers 501 until its owner builds it" cases failed as expected
(`expected 404 to be 501` and the like) and now assert `statusCode < 500` (no 501 and no server
error); scope and schema refusals unchanged: `Tests 51 passed (51)`.

## Slice 3: a policy a step names (C140.3, for `assign_case`)

| Step | Commit |
|---|---|
| Stub: `assignByPolicyInTx(work, caseId, { policyId? })`, the option not read | `6745beca` |
| RED: "runs that policy on a case, whatever its queue or version names" | `4a886051` |
| GREEN | `8d08b244` |

RED, exit 1: `AssertionError: expected null to be 'usr_01M6GDQX…'` (1 failed, 13 skipped by `-t`).
GREEN, every suite of mine, exit 0: `Tests 127 passed (127)`, 62.8 s.

## Integration (Testcontainers) and coverage tests

Commit `5d2dd42a`. These were written after the GREEN of slices 1 and 2 and passed at their first
complete run, so they were not seen failing against a stub (a deviation from rule 5, recorded in the
report): the EXPLAIN test first failed on a test-data error (`make_interval(mins => bigint)`), fixed in
the test before the commit.

- `packages/db/src/repositories/case-pull.integration.test.ts` (4 tests, 34.5 s, load 11.4 to 13.7):
  the pull's plan over 30,000 analysed cases (1 in 100 waiting) reads `cases_pull_idx`, under
  `LockRows`, with no sort for one queue and a sort of the waiting rows only for three:

  ```
  ->  LockRows
        ->  Nested Loop
              ->  Index Scan using cases_pull_idx on cases
                    Index Cond: ((environment_id = '…') AND (case_queue_id = 'cqueue_…'))
                    Filter: ((assignee_id IS NULL) AND (redacted_at IS NULL) AND (status_category <> 'end'))
  ```

  Two pulls at once take two different cases, and two `lockDueCaseSlas` at once take disjoint rows.
- `apps/api/src/services/cases/queues/queues-races.integration.test.ts` (3 tests, 32.6 s, load 15.2
  to 15.9): six concurrent entries into a round-robin queue of three give two each, the cursor on the
  last; four concurrent entries under fewest-open give two each to two idle members; forty due
  deadlines swept by two concurrent passes fire `case.sla-expired` exactly once each, with forty
  `sla-expired` history rows.

Commit `e321b5ea`: `queues/api-logs.test.ts` (an assignment's `user-email-address` and a holiday CSV
are kept from a stored-log reader without `pii:view`) and `queues/audit.test.ts` (every audit action's
metadata refuses free text). Both passed at once: they cover masking `foundation-8b` built and the
strict audit schemas of slice 2.

## Gates (each read from its own exit code, output sent to a file)

Other Stage 3 agents and `foundation-8b`'s (F) checkpoint were committing beside these runs.

| Gate | Exit | What it said | Time, load (1-minute, start -> end) |
|---|---|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | 0 | lockfile up to date | under 1 s |
| `pnpm format:check` | 0 | every file in Prettier style | |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force` | 0 | 32 of 32 tasks | 6 min 33 s, 6.5 -> 4.2 |
| `pnpm --filter @openverify/db test` | 0 | 1,979 tests in 127 files, 93.31% statements (`case-queues.ts` 98.43%, `case-policies.ts` 94.11%) | 150 s, 3.5 -> 9.8 |
| API unit suite, first run: four blob shards in `/tmp/aqs-api-gate-1`, then `--merge-reports` | 1 | 8,071 passed, 1 failed: `openapi.test.ts` snapshot, which lacked `foundation-8b`'s (F) dashboard rendition route while its checkpoint was in flight; the route and its snapshot landed together in `b4268c46`, after which `openapi.test.ts` passes alone (13 tests) | shards 276, 293, 272, 476 s |
| API unit suite, rerun on the committed tree: four blob shards in `/tmp/aqs-api-gate-2`, then `--merge-reports` (the gate) | 0 | 8,072 tests in 560 files; 94.62% statements, 85.59% branches; `services/cases/queues` 94.73%, `services/cases/sla` 95.77% | shards 416 s (11.5 -> 14.5), 281 s (13.4 -> 9.5), 343 s (9.5 -> 24.6), 438 s (24.3 -> 16.7); merge 24 s (16.3 -> 14.0) |
| `pnpm --filter @openverify/db test:integration` | 0 | 73 tests in 16 files | 113 s, 9.3 -> 22.2 |
| `apps/api: vitest run --config vitest.integration.config.ts --project graph` | 0 | 13 tests; template built in 47.2 s, copied in 2.2 s | 82 s, 22.0 -> 20.1 |
| `apps/api: … --project api --shard=1/3`, `2/3`, `3/3` | 0, 0, 0 | 72, 91 and 74 tests in 14 files each | 76 s (18.8 -> 19.2), 200 s (18.3 -> 8.1), 82 s (7.6 -> 19.5) |

A lone shard exits 1 on its partial coverage, as rule 8 says; the merge's exit code is the gate.
`apps/flow` was not changed, so the mocked flow suite was not run. No full-stack e2e was run (the
orchestrator's decision after Workflow 8A).
