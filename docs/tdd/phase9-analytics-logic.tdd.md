# Phase 9, Workflow 9B Stage 2: analytics-logic

Owner of `packages/core/src/analytics/` except `index.ts`, `definitions.ts` and `rows.ts` (frozen by `contracts-9b`, amendment B11) and the frozen constants inside the files built here (`SIGNAL_BINS`, `SIGNAL_NOT_EVALUATED_BIN`, `DURATION_*`, `ANALYTICS_SUPPRESSION_FLOOR`, `ANALYTICS_SUPPRESSIONS`). Base: `98f448bd` (contracts-9b's final record; (A) at `b8d6060c`). Every command ran from `packages/core` after `source scripts/env.sh`, iterating with `--coverage.enabled=false --maxWorkers=2`; outputs are abbreviated, with the real counts. Nothing here is pushed, and no dependency or environment variable was added.

Every new export goes through a module the frozen index already re-exports: `errors.ts` through `metrics.ts`, `lattice.ts` through `suppression.ts`. `derivation.ts` and `testing/` are internal (not re-exported).

## Slice A: duration buckets and signal bins (C163.5, C164.6)

No new name was needed: the RED tests call the frozen stubs and expect `RangeError` for refusals.

### RED (`7b14fe93`)

```
$ pnpm exec tsc --noEmit -p .                     # clean
$ pnpm exec vitest run src/analytics/durations.test.ts src/analytics/signal-bins.test.ts
AnalyticsNotBuiltError: durationBuckets is not built yet (analytics-logic, Workflow 9B)
AnalyticsNotBuiltError: durationBucketOf is not built yet (analytics-logic, Workflow 9B)
AnalyticsNotBuiltError: durationPercentile is not built yet (analytics-logic, Workflow 9B)
AnalyticsNotBuiltError: signalBinOf is not built yet (analytics-logic, Workflow 9B)
 Test Files  2 failed (2)
      Tests  29 failed (29)
```

Every failure is a stub's own error (the refusal tests fail because the stub's error is no `RangeError`).

### GREEN (`46095875`)

`errors.ts` (`AnalyticsInputError extends RangeError`, `assertCount`); `durations.ts` (edges `1·(2,592,000)^(k/40)`, the first bucket from 0, a binary search over the same doubles, nearest-rank percentiles); `signal-bins.ts` (`signalBinOf`: null is `not-evaluated`; enums and booleans by registry value; integers through the bin names, metres binned as whole kilometres; the country as its upper-case alpha-2 code; everything else refused without naming the value). The four built stubs leave the stub list of `analytics.test.ts`.

```
$ pnpm exec vitest run src/analytics
 Test Files  3 passed (3)
      Tests  52 passed (52)
$ pnpm exec tsc --noEmit -p . && pnpm exec eslint src/analytics     # clean
```

## Slice B: suppression (C164.7, reviews H18, P21)

Placeholders first (`68ebbd96`): `lattice.ts` (`analyticsTimeLattice`, `analyticsBucketNodes`), and in `suppression.ts` `suppressDuration`, `analyticsSeriesCellId`, `analyticsRelationGroups`, `suppressAnalyticsTable` with `AnalyticsTableInput`/`AnalyticsTable`; in `metrics.ts` `ANALYTICS_RELATIONS` (empty) and `caseAssigneeFigures`, and the `errors.ts` re-export.

### RED (`e1c2a49c`)

Tests: `lattice.test.ts`; `suppression.test.ts` (rates checked against a bound *searched* from its definition for every numerator and denominator up to 80 at thresholds 11, 15 and 20; the plan's examples; the plan's rule; a chain; three groups that reveal a cell no single group does; a bridge between two blocks of a two-way table, which the independent check confirms the small cells alone leave derivable; order independence; the table); `suppression-properties.test.ts` (24 seeded tables: no hidden cell derivable from the shown ones over every node of the lattice; every rate bound holds the true rate; a 60-day window; the CPU cost of the 400-day answer). The independent check is `testing/derivation-check.ts` (dense rational elimination and the null space, written apart from `derivation.ts`). A first run failed every test of a file on a lattice built at `describe` level; the lattice was made lazy so each test fails on its own stub.

```
$ pnpm exec vitest run src/analytics/lattice.test.ts src/analytics/suppression.test.ts src/analytics/suppression-properties.test.ts --reporter=json
{ 'AnalyticsNotBuiltError: analyticsTimeLattice is not built yet (analytics-logic, Workflow 9B)': 64,
  'AssertionError: expected error to be instance of RangeError': 14,
  'AnalyticsNotBuiltError: suppressCount is not built yet ...': 1,
  'AnalyticsNotBuiltError: suppressRate is not built yet ...': 3,
  'AnalyticsNotBuiltError: complementarySuppression is not built yet ...': 10,
  'AnalyticsNotBuiltError: suppressDuration is not built yet ...': 1,
  'AnalyticsNotBuiltError: analyticsRelationGroups is not built yet ...': 1 }      # 94 failed, 0 passed
```

### GREEN (`5cd90ab4`)

The lattice (weeks from Monday, months, both cut to the window), `derivation.ts` (exact sparse fraction-free reduction), the frozen functions and the table, and the relations of `ANALYTICS_RELATIONS`.

The first draft re-reduced the whole system after every round and was far too slow for the largest answer (the 400-day test, CPU time):

```
AssertionError: expected 11060.375 to be less than 4000       # small environment
AssertionError: expected 26185.64 to be less than 4000        # busy environment
```

A CPU profile showed the exact pass at 70 rounds of a full reduction. Four changes, all keeping the check exact: (1) each derivation carries its combination of groups, so the cell hidden is one the derivation reads with a non-zero net coefficient (each fix breaks the derivation it targets); (2) arithmetic on doubles while every value is a safe integer, redone on `bigint` otherwise; (3) the total is the sum of its months (the same equations as the sum of its days, far sparser), and a relation at a week, a month or the total, implied by the days', is left out of the exact pass (the plan's rule still reads it); (4) the exact pass runs per connected component of the unknown cells and reuses the answer of a component whose cells did not change, and the plan's rule re-reads only the groups of newly hidden cells.

```
$ pnpm exec vitest run src/analytics --reporter=json
143 passed, 0 failed
  340 ms   the cost of the largest answer (400 days): a small environment     (load 11.4)
 1532 ms   the cost of the largest answer (400 days): a busy environment
$ pnpm exec eslint src/analytics && pnpm exec tsc --noEmit -p .                # clean
```

## Slice C: the metric functions and the golden vectors (C164.1-C164.6)

### RED (`fb1b7961`)

`testing/population.ts` describes a seeded population one person at a time (status, flow-outcome split, decision, time to finish, the walk over six person-visible steps with revisits, verification attempts with capture method and country, two checks with statuses and reasons, four signals, cases with SLA and reviewer) and rolls it up into the twelve row types the way the rollup SQL would, both sources mixed. `metrics.test.ts` computes every metric a second time by its definition over the people; `golden.test.ts` holds the figures and one suppressed table to committed files.

```
$ pnpm exec vitest run src/analytics/metrics.test.ts src/analytics/golden.test.ts --reporter=json
{ 'AnalyticsNotBuiltError: inquiryFigures is not built yet ...': 8,
  'AnalyticsNotBuiltError: funnelFigures is not built yet ...': 4,
  'AnalyticsNotBuiltError: verificationFigures is not built yet ...': 3,
  'AnalyticsNotBuiltError: checkFigures is not built yet ...': 4,
  'AnalyticsNotBuiltError: caseFigures is not built yet ...': 2,
  'AnalyticsNotBuiltError: signalFigures is not built yet ...': 3,
  'AnalyticsNotBuiltError: caseAssigneeFigures is not built yet ...': 1,
  'AssertionError: expected error to be instance of RangeError': 3,
  PASS: 1 }                                     # the pass: the population holds what the tests need
```

### GREEN (`f67d6029`)

`metrics.ts` built; the stub tests at the end of `analytics.test.ts` replaced by tests that the package root exports what was built (B11). The golden files were written once with `OPENVERIFY_WRITE_ANALYTICS_GOLDEN=1` and formatted with prettier (population 1729, 12 a day over four days; 216 KB in all).

```
$ OPENVERIFY_WRITE_ANALYTICS_GOLDEN=1 pnpm exec vitest run src/analytics/golden.test.ts
      Tests  7 passed (7)
$ pnpm exec vitest run src/analytics
 Test Files  8 passed (8)
      Tests  188 passed (188)
```

The first run of the package's own test script failed the 400-day budget under v8 coverage in the parallel run (`expected 5005.293 to be less than 4000`, load 10); the budget is 15,000 ms with its basis beside it in the test (0.3 s and 1.5 s alone; 5.0 s under coverage; the first draft's 11 s and 26 s still fail it). Then:

```
$ pnpm exec vitest run --coverage                         # load 8.4
 Test Files  57 passed (57)
      Tests  1642 passed (1642)
All files          |   98.52 |    93.62 |   98.42 |    98.5 |
```

### Refactor (`e1d59d75`)

`derivation.test.ts`: on 200 seeded random systems, `determinedUnknowns` (doubles), `determinedUnknownsExact` (the `bigint` fallback, exported for this test only) and `determinedByComponent` all equal the independent dense check; the cells a derivation reads; the component cache. 191 passed.

## Slice D: `listMatchCountValue` (C164.6, Phase 7 C99)

Stub `f7253d35`; RED `0abc72f6` (`Tests  3 failed | 10 passed (13)`, each failure the stub's error); GREEN `9100b56f` (`Tests  194 passed (194)` over `src/analytics`). Root export tests `9d8cedee`, `75909e7e`.

## Final gates (foreground, exit codes read from the command itself)

| Command | Exit | Result | Time | Load |
|---|---|---|---|---|
| `pnpm --filter @openverify/core typecheck` | 0 | clean | 15 s | 13.1 |
| `pnpm --filter @openverify/core lint` | 0 | clean | 47 s | 13.1-14.4 |
| `pnpm --filter @openverify/core test` | 0 | 58 files, 1,650 tests; 99.21% statements, 94.04% branches, 99.84% functions, 99.17% lines | 14 s | 12.9-13.5 |
| `pnpm exec prettier --check packages/core/src/analytics/` | 0 | all files formatted | | |
| `pnpm turbo run lint typecheck --force --filter=@openverify/core` | 0 | 2 of 2 tasks | 40 s | 13.3-12.9 |
| `pnpm --filter @openverify/contracts typecheck` (a consumer of the new exports) | 0 | clean | | |

Coverage of `src/analytics` on the earlier full run: 97.22% statements, 87.44% branches (`derivation.ts` 96.19/83.14, `metrics.ts` 98.05/83.17, `suppression.ts` 98.73/91.61; `not-built.ts`, contracts-9b's stub error, is now held by its own test).
