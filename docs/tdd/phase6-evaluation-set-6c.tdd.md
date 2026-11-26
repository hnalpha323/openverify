# Phase 6, Workflow 6C Stage 1: evaluation-set-6c (TDD evidence)

**Area:** owner decisions 5, 7 and 8 after Workflow 6B (`docs/plans/phase-6.plan.md`):
- decision 5: a held-out set that can measure false alerts, embedded in the performance tables, with the 6B cases kept as they were;
- decision 7: the three post-hoc analyses of `docs/calibration/watchlist-phase6.md` as committed steps;
- decision 8: the benchmark helpers in the package's own `typecheck` and `test`.

**Owned paths:** `packages/watchlist/src/testing/held-out/`, `packages/watchlist/scripts/benchmark-*` with their tests, `benchmark-tsconfig.json` and `benchmark-vitest.config.mjs`, the include lists of `packages/watchlist/tsconfig.json` and `vitest.config.ts`, and this file. `package.json` was not changed: every new step is a step of an existing benchmark CLI.

**Process.**
- Every command ran after `source scripts/env.sh`. Package commands ran from `packages/watchlist`.
- Each helper went stub (its own `chore` commit, so the RED test compiles and typechecks), then RED (run and seen failing for its reason), then GREEN.
- Independence (rule 11): I never read `packages/watchlist/src/{names,translit,keys,score,match}/` or a matcher-6c commit. The scripts call the keys module's exports (`loadVariantGroups`, `keysVersion`, `parseVariantGroups`, `variantFormsOf`) as evaluation-6's did, without reading it.
- No evaluation seed was drawn and no evaluation was run. The smoke runs use a scratch seed, drawn with `openssl rand -hex 16`: `f71ce95bae78334ce16332875ed347cf`. No smoke number is published.
- Nothing generated is committed. Smoke outputs stay in `/tmp/ev6c-smoke/`, the base worktree in `/tmp/ev6c-base`, and the copy of 6B's run 1 in my scratchpad.

## Slice 0: golden tests at the 6C base (characterization)

Commit `41700399`. These tests pin behaviour that already exists, so they pass on the code they pin; they have no RED step by construction. Each digest was read at Workflow 6C's base (`94ab63f9`) in a worktree, `/tmp/ev6c-base`, and each test was then run at both base and head.

- **Base worktree.** `git worktree add --detach /tmp/ev6c-base 94ab63f9…`, then `pnpm install --frozen-lockfile --offline` (1.3 s). The `data/` files were copied in, and `pnpm -s build:variant-groups` built the shipped file with that tree's own script: SHA-256 `529216c9…7324`, 156,706 groups.
- **`src/testing/held-out/golden.test.ts`** pins:
  - `seededRandom` (every method);
  - the fictional names (given, family, person with and without a middle name, company, the legal forms);
  - `SYNTHETIC_COUNTRIES`, `normalisedImport` and `normalisedImportText`;
  - `generateHeldOutSet` (list, cases, customers, held-out group ids, and the cases with birth dates), `syntheticCustomers` with and without groups, and the variant helpers.

  Run at base with placeholder digests: `Tests 7 failed (7)`, each diff giving the base digest (`aae0371a…`, `7b5c6efd…`, …). Filled in, then at base `Tests 7 passed (7)` and at head `Tests 7 passed (7)`.
- **It guards each shared helper.** Each mutation was made in the base worktree only, never in the shared tree, and restored:

  | Mutation | Golden tests failing |
  |---|---|
  | `random.ts`: 15 warm-up draws become 16 | 7 of 7 |
  | `names.ts`: the ending `ford` becomes `fjord` | 4 of 7 |
  | `records.ts`: `MX` becomes `MA` | 3 of 7 |
  | `normalised.ts`: 2-space indent becomes 1 | 1 of 7 |
- **`scripts/benchmark-golden.test.mjs`** pins the existing steps' generated data: the table pool and its draws, the Zipf sampler, both table profiles, `listedQuery`, `unlistedQueries` and the import file's SHA-256, plus `qualityPoint`, `bootstrapQuality`, `performanceSummary` and the intervals. At base: 2 failed with the digests, then 2 passed; at head, 2 passed.

## Slice 1: the package gates cover the helpers (decision 8)

- RED `a55e9266` (`scripts/benchmark-gates.test.mjs`, run with `benchmark:test`'s config):

  ```
  AssertionError: expected { types: [ 'node' ] } to match object { allowJs: true, checkJs: true }
  AssertionError: expected [ 'src/**/*.test.{ts,tsx}' ] to deeply equal ArrayContaining{…}
        Tests  2 failed (2)
  ```
- GREEN `561edf70`:
  - **`tsconfig.json`:** `allowJs` and `checkJs` are on, and its include lists every pure helper, the render CLI, `benchmark-vitest.config.mjs` and `scripts/benchmark-*.test.mjs`. TypeScript skips `.mjs` files in `include` unless `allowJs` is on, so the include alone would have checked nothing (a deviation from "the include lists only", recorded).
  - **`vitest.config.ts`:** adds `scripts/benchmark-*.test.mjs` to `test.include` and the helper modules (`BENCHMARK_HELPERS`, imported from `benchmark-vitest.config.mjs`) to the coverage include.
  - **First typecheck:** 28 × `TS2883` in `benchmark-vitest.config.mjs`. The base config emits declarations, and the default export's inferred type was not portable. The config is now a typed `const`.
- **Left under `benchmark:typecheck` alone:** `benchmark-postgres.mjs`, `benchmark-performance.mjs` and `benchmark-quality.mjs`. They import `apps/api` and `packages/db` sources. Both packages build on `@openverify/watchlist`, so checking their sources from here would type-check reverse dependencies, and turbo would cache this package's typecheck without tracking their files. The gates test fails any module that reaches into `apps/api` or `packages/db` and is in the package include, and any other module that is not.
- **Package test** (`pnpm -s test`, load 5.25): 57 files, 537 tests. All files 98.75% statements, 90.32% branches, 98.68% functions, 98.77% lines; the helpers appear in the coverage.
- **Mutation check:** a `number`-typed constant set to a string in `benchmark-metrics.mjs` made `pnpm typecheck` fail with `TS2322` at (369,14). Restored.

## Slice 2: generic reads wrappers

- Stub `e8780f6e`, RED `33ab7ede` (`Tests 5 failed | 1 passed (6)`, each with `Error: not implemented`), GREEN `596f4f36`, refactor `fed70fb6`.
- `timeReads` and `reuseReads` (`scripts/benchmark-reads.mjs`) wrap every function member of the reads they are given:
  - the frozen three report as `state`, `retrieve` and `load`, in that key order, so the round files are unchanged;
  - any other member reports under its own name;
  - non-functions pass through.
- `timedReads` and `cachedReads` in `benchmark-postgres.mjs` keep their names and defaults (`DB_WATCHLIST_READS`) and delegate to them.
- First GREEN typecheck: `TS7053` (indexing `READ_PHASES` by a string), fixed by typing it as a string record.

## Slice 3: the held-out scale population (decision 5)

- Stub `8a6281e9`. A first stub with `void x;` bodies was refused by lint (`no-meaningless-void-operator`); the stubs pass their arguments to a throwing `notImplemented`, as evaluation-6's did.
- First RED attempt: the test built its population at collection time, so the file reported `no tests`. The fixtures are now lazy. Lint refused a string spread (`no-misused-spread`).
- RED `f89e3a37`: `Tests 11 failed`, each with `Error: not implemented (n arguments)`.
- GREEN `c0b7f66f`: 11 passed on the first run. The held-out folder has 31 tests; `scale-population.ts` is at 98.42% statements, 85.6% branches and 100% functions.
- What `src/testing/held-out/scale-population.ts` holds:
  - `zipfRank`, `zipfPersonLaw` (the groups' single-word Latin forms and fictional names, given and family ranked apart) and `zipfCompanyLaw` (fictional words, our own generic words, the synthetic legal forms);
  - `generateScalePopulation`: listed persons, each with one case from `exact`, `order_swap`, `dropped_middle`, `added_middle`, `initials`, `typo` (one letter substituted, inserted or deleted in the family name) and `transposition`, in turn; listed companies with `exact`, `typo`, `transposition` and `legal_form`; person and company customers from the same laws, never listed. Every person query carries the person's birth date, and 85% of the listed entries carry it.
  - `nameKey` and `indistinguishableCustomers`: a person equal to an individual in name (a folded token bag) and birth date, or a company equal to an entity in name and, when the customer states one, in country.
- The benchmark passes the performance tables' own `namePool` as the person law, so the population follows the table's law. The generator never reads the scripts.

## Slice 4: the paired bootstrap

- Stub `c51c1bc2`. RED `517931f5`: 9 failed, 8 with `not implemented` and 1 with `expected error to be instance of RangeError`. GREEN `ab09d0d0`: 9 passed.
- What `scripts/benchmark-paired.mjs` does:
  - **`pairedSamples`** draws every run from one stream, in `bootstrapQuality`'s order and under its label by default. A test shows that a run's intervals equal `bootstrapQuality`'s.
  - A match to the table under test (`fixed`) counts in every replicate.
  - **`differenceOf`** gives `head - base` replicate by replicate. **`pairedPoint`** adds a Wilson interval beside each count.

## Slice 5: the post-hoc helpers and the development variants (decisions 7, 5)

- Stubs `dd2a3b71`. RED `127ad5b4`: 11 failed (`not implemented` or a missing `RangeError`). One test expectation was corrected before that RED commit: an insertion's position is the first differing index (`Anna` → `Annna` at 3).
- GREEN `9c1b2abc` (`benchmark-posthoc.mjs`, 7 passed):
  - `typoEdit` reads the kind back from the listed and typed tokens, and is checked against every kind the held-out generator writes;
  - `typoKindBreakdown` counts by subject, kind, token length (under 5, 5 or more: the C79.1 budget) and preset;
  - `unlistedAlerts` counts the first round's unlisted subjects with a kept match, with a Wilson interval.
- GREEN `6b02329d` (`benchmark-variants.mjs`, 4 passed):
  - `developmentVariants` writes one case per listed entry spread over a development table, sources in turn. Its rules are written apart from the held-out generator, which matcher-6c never reads.
  - `variantSummary` gives the counts per preset with Wilson intervals.

## Slice 6: results, comparisons and shared options

- Stub `0addac1f`. RED `65ce1a15`: 6 failed with `not implemented`. GREEN `f8f2d300`: 6 passed.
- What `scripts/benchmark-scale.mjs` holds:
  - `containerName` (base name, `--namespace`, `smoke`) and `partTarget` (the performance import's formula, validated);
  - `splitMatches` (the population's ids against the table's own entries);
  - `runsOf`, and `setResults` (one stream per set for its presets);
  - `compareSet`: base and head on the same draws, with head's runs after base's in one `pairedSamples` call.

## Slice 7: the renderers

- Stub `b0176127`. RED `b6cad26d`: 6 failed with `not implemented`, and the 9 existing tests passed.
- GREEN `7ee94e76`. The first run had 1 failure: my typo-kind fixture used the `count` shape instead of `TypoCount`'s `found`, so a cell read `NaN/55`. The fixture was fixed in the GREEN commit, and all 15 passed.
- `scaleMarkdown`, `compareMarkdown`, `typoKindsMarkdown`, `unlistedMarkdown`, `compactMarkdown` and `variantsMarkdown` print exact lines. A count of zero, or of all, shows its Wilson interval beside the degenerate bootstrap interval.

## Slice 8: the CLI steps

Commit `25e12898`. The CLIs need Docker and the data files, so they are run, not unit-tested, as evaluation-6's were. Every piece of logic they hold is a tested helper above.

- **`benchmark:performance`:**
  - new steps `<scale>-unlisted`, `<scale>-variants` (resumes, exit 3) and `<scale>-compact` (`VACUUM (FULL, ANALYZE)`, then one round);
  - new flags `--smoke` (5,000 and 16,000 names; 20 subjects; 2,000 re-screen reports), `--namespace` and `--parts`.
- **`benchmark:quality`:**
  - new steps `typo-kinds`, `scale-prepare` (with `--part` and `--parts`), `scale-screen`, `scale-report`, `scale-teardown` and `compare`;
  - `--namespace`, and smoke containers named `…-smoke`.
- **`benchmark:render`** prints each new table when its file exists, and reads however many import parts a run wrote.

**Existing outputs, checked on a scratch copy of 6B's run 1** (`/tmp/openverify-eval-6/run-1`, read only):
- `benchmark:render --out /tmp/openverify-eval-6/run-1` at base and head: 94 lines each, `cmp` identical.
- Head's `--step report` (seed `05b49d01…`, run 1's held-out build; load 5.97, 38.2 s): `results.json` is byte for byte run 1's.

**The post-hoc figures of 6B, reproduced by committed steps on the same copy:**
- `--step typo-kinds`, persons under `tolerant`: substitutions 40/41, insertions 41/42, deletions 61/62 (142 of 145, as published), transpositions 0/55; companies' transpositions 0/43 (0 of 98 together).
- `--step 100k-unlisted`: 37 of 150 (24.7%; Wilson 18.5–32.1%). `--step 2m-unlisted`: 93 of 150 (62.0%; 54.0–69.4%), with 3,771 kept matches. Both as published.
- The compacted round needs the 2,000,000-name database, so only the smoke run checks it.

## Smoke runs (decision 5's end-to-end check)

The scratch seed is `f71ce95bae78334ce16332875ed347cf`. It was drawn with `openssl rand -hex 16` at 2026-10-28T18:39:14Z and is never an evaluation seed.

**How each step ran.**
- Each step took the e2e lock for itself alone: `flock /tmp/openverify-e2e.lock pnpm -s benchmark:<cli> … --smoke --namespace <ns>`. A step that exits 3 ran again.
- The runner is in my scratchpad, and its log is the source of what follows. Load averages are the 1-minute values at a step's start and end.
- A step's time includes its wait for the lock, which was held by the other agents' suites: up to 292 s.
- Outputs: `/tmp/ev6c-smoke/{head,base,parts,compare}`.

**At head** (`/home/mhnoor/persona-opensource`, namespace `es6c-head`), every step exited 0. Load averages ranged from 4.3 to 21.6.
- **Quality, 6B steps.** `build:variant-groups --hold-out <seed>` (SHA-256 `10c8f106…f1c2`), then `prepare`, `screen`, `report`, `typo-kinds` and `teardown`.
- **Quality, scale steps.**
  - `scale-prepare`, `scale-screen`, `scale-report` and `scale-teardown` at `--scale 100k`.
  - At `--scale 2m`, `scale-prepare --part 1` to `8`, then the same three steps.
  - Each part added its share and removed nothing; the population is in every part.
- **Performance, 100,000 names:** `machine`, `100k-import`, `100k-measure`, `100k-unlisted`, `100k-variants`, `rescreen-seed`, `rescreen-100`, `-300`, `-1000`, `-3000`, `100k-compact` and `100k-teardown`.
- **Performance, 2,000,000 names:** `2m-import --part 1` to `8`, `2m-measure`, `2m-unlisted`, `2m-variants`, `2m-compact` and `2m-teardown`.
- **`--parts 2`** (namespace `es6c-parts`): `2m-import --part 1 --parts 2`, `--part 2 --parts 2`, then teardown.
  - The second part ran `VACUUM ANALYZE` and recorded the database, as the eighth of eight does.
  - Its publication holds the same 3,293 entries as the eight-part run's last part. The file's digest differs only through the publication time, which is the part number times one minute.
- **`benchmark:render --out /tmp/ev6c-smoke/head`** exited 0 and printed every table: the 6B quality tables, the typo kinds, the population in both tables (persons and companies), the imports, the screening, the re-screens, the unlisted alerts, the compacted round and the development variants.

**At Workflow 6C's base** (`/tmp/ev6c-base` at `94ab63f9`, namespace `es6c-base`), every step above except `--parts` exited 0. Load averages ranged from 5.7 to 32.5.
- **How the worktree was prepared:** as in slice 0, with my `scripts/benchmark-*` and `src/testing/held-out/*` copied over it uncommitted. A `cmp` of each file against head's found none different.
- **The held-out build** came from the base's own script, with the same SHA-256 as at head (`10c8f106…`).
- **Unit checks at base:** `benchmark:typecheck` exits 0, and the held-out folder's tests pass (31, the golden tests included). `benchmark:test` passes except `benchmark-gates.test.mjs`. That test checks head's package configs, which are not part of the overlay, so it fails at base by design.

**Base and head generated the same data.** Each item matched:
- every import file's SHA-256 (performance at both scales, all eight parts; the scale tables at both scales, all eight parts);
- the 6B list's SHA-256;
- the re-screen publications;
- the scale population's identities and indistinguishable customers;
- the query keys of every observation file.

**`compare`** (`--base /tmp/ev6c-smoke/base/quality --head /tmp/ev6c-smoke/head/quality --out /tmp/ev6c-smoke/compare`, load 15.6) exited 0 and wrote 7 sets: the three 6B sets and both scale sets at both scales. `benchmark:render --out /tmp/ev6c-smoke/compare` printed them.
- At 2,000,000 names the head's `tolerant` recall differed from the base's. The matcher's code in the shared tree had moved since the base; the generated data is identical.
- No smoke number is published.

Every container I started is removed: `docker ps -a --filter label=openverify.benchmark` lists only matcher-6c's.

## Final gates

Run in the foreground at head, after the smoke runs.

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/watchlist typecheck` | exit 0 (load 13.0) |
| `pnpm --filter @openverify/watchlist lint` | exit 0 |
| `pnpm --filter @openverify/watchlist benchmark:typecheck` | exit 0 |
| `pnpm --filter @openverify/watchlist benchmark:test` | 11 files, 87 tests passed; the helper modules 98.9% statements, 83.59% branches, 99.61% functions, 98.77% lines |
| `pnpm --filter @openverify/watchlist test` | **1 file failed** (load 9.45), and it is not mine: `src/match/shortcuts.test.ts`, an untracked file of matcher-6c's in progress (its RED step). The other untracked foreign file there is `src/zz-probe.test.ts`. I did not open either |
| The same script's command, `vitest run --coverage`, with only those two untracked files excluded | 62 files, 582 tests passed; 98.46% statements, 89.34% branches, 98.17% functions, 98.46% lines (gate 80%) |
| `pnpm format:check` | all files use Prettier code style |
| `git status --porcelain` for my paths | empty after this record's commit |
