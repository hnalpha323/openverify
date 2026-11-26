# Phase 6, Workflow 6B Stage 1: evaluation-6 (TDD evidence)

**Area:**
- C78.7: screening and re-screen performance on synthetic tables in Postgres;
- C78.8: recall per variant source, precision and alerts per 1,000 customers on the held-out set, with bootstrap intervals over listed identities.

**Owned paths:** `packages/watchlist/scripts/benchmark-*` with their tests, the benchmark script entries of `packages/watchlist/package.json`, `docs/calibration/watchlist-phase6.md`, and this file.

**Process.**
- Commands ran after `source scripts/env.sh`.
- Each helper went stub (its own `chore` commit, so the RED test compiles and typechecks), then RED (run, and seen failing for its reason: `not implemented`, or a `RangeError` the stub did not throw), then GREEN.
- The independence rule held throughout. No constant, threshold, preset, candidate cap, matcher code, build script (`scripts/build-*`) or held-out generator (`src/testing/held-out/`) was changed; they were run.

**Where the helpers' tests run.**
- The package's Vitest config collects `src/**` only, and its `tsconfig.json` includes `src` only. So the benchmark files are `.mjs` with `// @ts-check` and JSDoc types, as the build scripts beside them are.
- They are tested through `scripts/benchmark-vitest.config.mjs`, which uses `createVitestConfig()`, its timeouts and the 80% gate over the helper modules: `pnpm --filter @openverify/watchlist benchmark:test`.
- They are type-checked strictly through `scripts/benchmark-tsconfig.json` (`allowJs`, `checkJs`, the base config): `benchmark:typecheck`.

## Method first

- `1db7f059`: the method section of `docs/calibration/watchlist-phase6.md`, written and committed before any benchmark code ran and before the evaluation seed existed.
- `b5c8c7a8`: the amendments made after the development runs, still before the seed:
  - the re-screen sizes became 100, 300, 1,000 and 3,000, because 10,000 does not fit one 10-minute call;
  - the development runs are disclosed;
  - the tables are rendered, never copied.
- `074aeced`: the seed, drawn with `openssl rand -hex 16` at 2026-10-28T08:13:44Z.

## Slice 1: the metrics and the bootstrap over listed identities

- Stub `958a76b8` (with the two benchmark configs and the `benchmark:test` and `benchmark:typecheck` entries), RED `946b7af0`, GREEN `77483568`.
- RED: `pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs --coverage.enabled=false` (from `packages/watchlist`):

  ```
  11 Error: not implemented (2 arguments)
   2 Error: not implemented (1 arguments)
   Test Files  1 failed (1)
        Tests  16 failed (16)
  ```
- First GREEN run: 15 passed, 1 failed. The failing check was `wilsonInterval(10, 10)`, whose upper bound came out as 0.9999999999999999. The bound is exactly 1 when every trial succeeds, and the formula reaches it only up to rounding, so the exact ends are set (and 0 at no success).
- First typecheck: two `noUncheckedIndexedAccess` errors on typed-array increments. First lint: `prefer-for-of` on a draw loop. All fixed before the commit.
- GREEN: `Tests 16 passed (16)`; module coverage 100% statements, 83.82% branches.
- The test that the bootstrap is over identities, not pairs: entry A's case matched A and B, and B's case matched B. The replicate precisions can only be 1 ({A,A} or {B,B}) or 2/3 ({A,B}). A pair bootstrap would also give 1/2, counting the false match to B in a replicate that does not list B.

## Slice 2: the held-out independence assertion (V12)

- Stub `b4b972f0`, RED `fcbd4a44`, GREEN `42feacb6`.
- RED (`benchmark-independence.test.mjs`):

  ```
  3 Error: not implemented (1 arguments)
  1 Error: not implemented (3 arguments)
   Test Files  1 failed (1)
        Tests  8 failed (8)
  ```
- GREEN, the helper suite: `Test Files 2 passed (2)`, `Tests 24 passed (24)`.
- What it refuses:
  - a build that is not a hold-out build, or not from the pinned source;
  - a group case without a group;
  - a case group missing from the set's list;
  - a case group that this seed does not hold out;
  - any held-out group surviving in the measured build.

  Its messages carry counts only (a test asserts no group id appears).

## Slice 3: the synthetic table generator

- Stub `7596b9bc`, its type fix `baad7d23`, RED `f88e0bbb`, GREEN `e653887a`.
- **Disclosed:** the stub commit `7596b9bc` went in with a type error. The table profiles were cast from `Object.freeze` literals, which inferred `number[][]` for the alias tuples. My commit command did not stop on the failing `benchmark:typecheck`. `baad7d23` fixed it, before the RED test was written. From then on, every commit command ran only after typecheck and lint passed.
- **First RED attempt:** the test file built its pools at collection time, so it failed with "no tests" rather than per test. The pools were then made lazy, so each test fails on its own. RED as committed:

  ```
  7 Error: not implemented (1 arguments)
  2 Error: not implemented (2 arguments)
   Test Files  1 failed (1)
        Tests  9 failed (9)
  ```
- GREEN, the helper suite: `Test Files 3 passed (3)`, `Tests 33 passed (33)`.
- **What the tests pin:**
  - the Zipf law: rank 1 drawn twice as often as rank 2, five times as often as rank 5; flat with exponent 0;
  - the pool: single-word forms only, one script per form, an item needs a Latin form;
  - every record valid against the frozen schema, one primary name, distinct names, the name target reached;
  - the profiles' names per entry (sanctions 1.45–1.85; PEP 4.3–5.5, in Cyrillic and Arabic too);
  - the queries;
  - a streamed import file that validates and whose returned digest is the file's.

## Slice 4: the performance summary

- Stub `5de69f0d`, RED `b917bf7f`, GREEN `85b9def7`.
- RED: `2 Error: not implemented (1 arguments)`; `Tests 3 failed | 16 passed (19)` in `benchmark-metrics.test.mjs`.
- GREEN, the helper suite: `Tests 36 passed (36)`.
- The summary reads:
  - nearest-rank p50, p95 and p99 over every round, and each round's p95;
  - the least disturbed round, as the C78.7 gate does;
  - the p95 of each phase;
  - the first round's candidate counts, cap binding and would-be `result_truncated`, with Wilson intervals;
  - the listed subjects found.

## Slice 5: the report renderer

- Stub `6836e26c`, RED `15989e40`, GREEN `57dece99`.
- **First RED attempt:** it rendered at collection time ("no tests"); made lazy. RED as committed:

  ```
  7 Error: not implemented (1 arguments)
   Test Files  1 failed (1)
        Tests  7 failed (7)
  ```
- **Disclosed:** one RED expectation changed in the GREEN commit. The precision row's `n` cell expected `5`, the first preset's match count. That count differs by preset, so the GREEN renderer writes `—` there; each cell carries its own denominator. The intent of the test is unchanged.
- GREEN: `Tests 43 passed (43)`. Then `7f2e9b92` added the `n/a` branches (a company set without customers, a missing vacuum, several sockets, an over-budget re-screen, a scale without results) and the render CLI: `Tests 45 passed (45)`.
- The helper gate: 98.63% statements, 83.7% branches, 99.11% functions, 98.45% lines (≥ 80%).

## The benchmark CLIs and their harness (run, not unit-tested)

`fd13f7fb` added three files:
- `benchmark-postgres.mjs`;
- `benchmark-quality.mjs`;
- `benchmark-performance.mjs`.

They need Docker and the pinned data files, so they are run, not unit-tested. Their logic is in the tested helpers above.

- **The harness.**
  - Postgres runs as a reusable Testcontainers container (`pgvector/pgvector:pg17` with `POSTGRES_TEST_COMMAND`), labelled `openverify.benchmark=<name>`, so the steps of one benchmark share it across calls.
  - The repository's migrations run, and the source rows are reconciled from the committed manifest.
  - Imports go through `syncWatchlistSource`, into the sandbox source, with a manifest copy whose byte caps are raised to 2 GiB.
  - Screenings go through the report jobs' `screenNames` (`watchlistReportJob`, `businessWatchlistReportJob`), for a sandbox environment.
  - A reads layer keeps one query's database reads for its three presets.
  - The CLIs import the API's and the database package's sources by path, and Testcontainers through `createRequire` from `@openverify/db`'s development dependencies. No dependency was added.
- **Smoke runs.** Before the evaluation seed existed, on a scratch seed and with `--smoke` sizes for quality:
  - quality: prepare, screen, report and teardown;
  - performance: the machine facts, the 100,000-name import and measurement, the re-screen seeding, and its 100- and 1,000-entry syncs;
  - the first two 2,000,000-name syncs;
  - a parse of a full 2,000,000-name file in a 12 GiB heap (450 MB file; 2.1 GiB heap after `JSON.parse`, 2.9 GiB after validation).

  These timed the plumbing. The 1,000-entry re-screen took 130 s, which led to the size amendment.
- **Three changes during run 1, none of which moves a number:**
  - `5951cc29`: `--rounds` bounds the new rounds of one measure call. A 2,000,000-name round takes about five minutes; the first call ended at the cap during round 2 and kept round 1's file.
  - `7aff09bd`: the measure step creates its own directory. The post-hoc compacted round under a new directory first failed to write its file after screening, and was run again.
  - `5649a760`: the import and re-screen records keep each file's SHA-256.

## The evaluation runs

**Run 1** (`/tmp/openverify-eval-6/run-1/`, 08:14 to 09:42 UTC). Its numbers are the report's results.
- **The build:** `build:variant-groups --hold-out 05b49d0100c2c9a67c4e76536470946f` gave SHA-256 `f79c0b8b…3fbd`. It kept 140,841 groups and dropped 15,924 held-out ones.
- **Quality:**
  - prepare: the independence assertion passed (1,000 group cases, 1,821 held-out groups, none surviving), and 3,600 entries were applied;
  - screen: 16,600 queries in 130 s;
  - report: 32 s.
- **Performance:**
  - 100,000 names: import 44.2 s; p95 290.8 ms;
  - re-screens: 28.4, 43.6, 99.2 and 288.1 s;
  - 2,000,000 names: eight syncs, 1,778.7 s in all; p95 2,309.4 ms.
- **Post-hoc (labelled in the report):**
  - one round after `VACUUM FULL`: p95 1,444 ms;
  - the typo-kind breakdown (scratch script, never committed): transpositions 0 of 98;
  - the unlisted-subject alerts.

**Run 2: the final gate, the whole benchmark again from an empty output directory, with the final code** (`/tmp/openverify-eval-6/run-2/`, 09:48 to 10:50 UTC). Each line was one foreground call (the 2,000,000-name parts and rounds one call each):

```bash
R=/tmp/openverify-eval-6/run-2; SEED=05b49d0100c2c9a67c4e76536470946f; cd packages/watchlist
pnpm -s build:variant-groups --hold-out $SEED --output $R/variant-groups.held-out.json
pnpm -s benchmark:quality --seed $SEED --build $R/variant-groups.held-out.json --out $R/quality --step prepare
pnpm -s benchmark:quality --seed $SEED --build $R/variant-groups.held-out.json --out $R/quality --step screen
pnpm -s benchmark:quality --seed $SEED --build $R/variant-groups.held-out.json --out $R/quality --step report
pnpm -s benchmark:quality --step teardown
pnpm -s benchmark:performance --seed $SEED --out $R/performance --step machine
pnpm -s benchmark:performance --seed $SEED --out $R/performance --step 100k-import
pnpm -s benchmark:performance --seed $SEED --out $R/performance --step 100k-measure
pnpm -s benchmark:performance --seed $SEED --out $R/performance --step rescreen-seed
pnpm -s benchmark:performance --seed $SEED --out $R/performance --step rescreen-100   # and -300, -1000, -3000
pnpm -s benchmark:performance --step 100k-teardown
pnpm -s benchmark:performance --seed $SEED --out $R/performance --step 2m-import --part 1   # to --part 8
pnpm -s benchmark:performance --seed $SEED --out $R/performance --step 2m-measure --rounds 1   # three times
pnpm -s benchmark:performance --step 2m-teardown
pnpm -s benchmark:render --out $R
```

Summary of run 2:
- **The build** had the same SHA-256 (`f79c0b8b…3fbd`), and the list the same digest (`e40e83d1…239e`). The independence assertion passed again.
- **Quality:** `{"screened":16600,"done":16600,"of":16600,"seconds":127}`. Then `cmp` printed "observations identical to run 1" and "results.json identical to run 1": every quality number is reproduced byte for byte.
- **Performance:**
  - 100,000 names: import 39.1 s, `p95 271.5 ms` (budget 100), the cap bound in 1 of 300 searches, 150 of 150 listed subjects found;
  - re-screens at 200,000 subjects: 25.6, 41.9, 93.3 and 254.3 s, inserting 5,401, 7,389, 13,920 and 23,882 runs (the same as run 1);
  - 2,000,000 names: eight syncs in 1,587.0 s and a 99.6 s `VACUUM ANALYZE`; `p95 1,749.0 ms` (budget 250); the cap bound in 143 of 300 searches; 21 of 300 would end `result_truncated` (63 errored runs over three rounds); 149 of 150 listed subjects found.
  - The data-determined numbers are identical to run 1; the timings moved with the load (1.4 to 6.8 against 2 to 14).
- No benchmark container was left (`docker ps -a --filter label=openverify.benchmark` printed 0).

## Final gates

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/watchlist typecheck` | pass |
| `pnpm --filter @openverify/watchlist lint` | pass (the benchmark `.mjs` files included) |
| `pnpm --filter @openverify/watchlist test` | `Test Files 50 passed (50)`, `Tests 467 passed (467)`; 98.74% statements, 90.62% branches, 98.71% functions, 98.77% lines |
| `pnpm --filter @openverify/watchlist benchmark:typecheck` | pass (strict `checkJs`, including the API sources the CLIs import) |
| `pnpm --filter @openverify/watchlist benchmark:test` | `Test Files 4 passed (4)`, `Tests 45 passed (45)`; 98.63% statements, 83.7% branches, 99.11% functions, 98.45% lines |
| `pnpm format:check` | `All matched files use Prettier code style!` |
| The whole benchmark from an empty output directory | run 2 above |
