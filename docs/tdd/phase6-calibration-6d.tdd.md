# Phase 6, Workflow 6D Stage 2: `calibration-6d`

Owner decisions 6 (the benchmark's half), 7 and 8 after Workflow 6C, and C78.7. The plan is
`docs/plans/phase-6.plan.md`, "Owner decisions after Workflow 6C" and "Workflow 6D". The report is
`docs/calibration/watchlist-phase6d.md`.

Every command below ran from `packages/watchlist` after `source scripts/env.sh`, unless it says
otherwise. Outputs are abbreviated; nothing generated from a seed is in git.

## Slice 1: one definition of the tables (decision 6)

**RED.** `scripts/benchmark-tables.test.mjs` gains "one definition of the tables": the profiles, the
law, the pool, the entries and the queries `benchmark-tables.mjs` exports are the very functions of
`src/testing/heavy-headed.ts`, and the performance and quality CLIs import the shared module (the
performance CLI never reads `held-out/`, and neither calls `namePool(` itself).

```
$ pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs scripts/benchmark-tables.test.mjs --coverage.enabled=false
     × takes the profiles, the law, the pool, the entries and the queries from src/testing/heavy-headed.ts
     × the performance and quality benchmarks build their tables from the shared module, and the performance benchmark never reads the held-out generator
AssertionError: expected { sanctions: { …(5) }, pep: { …(5) } } to be { sanctions: { …(5) }, pep: { …(5) } } // Object.is equality
AssertionError: expected '// @ts-check\n/**\n * C78.7 (evaluati…' to contain 'from \'../src/testing/heavy-headed.js…'
      Tests  2 failed | 9 passed (11)
$ pnpm -s benchmark:typecheck     # clean
```

**GREEN.** `benchmark-tables.mjs` re-exports `TABLE_PROFILES`, `zipfSampler`, `namePool`,
`syntheticEntries`, `listedQuery` and `unlistedQueries` from `../src/testing/heavy-headed.js` and
keeps only `writeNormalisedImport`. `benchmark-performance.mjs` reads the groups with
`parseRigourPersonNames` (no `held-out/` import is left), takes the pool from `heavyHeadedPool`,
the 100,000-name entries from `heavyHeadedEntries` and its subjects from `heavyHeadedSubjects`
(the 2,000,000-name table keeps its PEP profile through the shared `syntheticEntries` and
`tableSubjects`). `benchmark-quality.mjs`'s scale tables take the same pool and entries.
`benchmark-golden.test.mjs` is unchanged and passes, so the tables' output did not move.

```
$ pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs --coverage.enabled=false
 Test Files  11 passed (11)
      Tests  100 passed (100)
$ pnpm -s benchmark:typecheck     # clean
```

End to end, a scratch script outside git (`table-sha.mjs` in the session scratchpad) wrote both
performance import files of the 6C evaluation seed through the shared module and the benchmark's
writer, as the import steps write them. Both are byte for byte the files
`docs/calibration/watchlist-phase6c.md` published:

```
{"which":"100k","entries":60694,"names":100000,"sha256":"96c149b3eda6e9819d872676355416b9d48cebb1d53f1ce6ee28bf0cea64781a"}
{"which":"2m","entries":412649,"names":2000001,"sha256":"0a29f3ce0757dd0e7456b005b7f8d0bd274c51cff07b19974c6d008647c27ea8"}
```

## Slice 2: the list under test is fixed (decision 7, review C002)

**Stub** (`bc6976cf`): `qualityReplicate(observations, draws)` in `benchmark-metrics.mjs` and
`pairedReplicate(run, draws)` in `benchmark-paired.mjs`, one replicate's measures for given draw
counts, each throwing "not built yet"; the `ReplicateMeasures` and `ReplicateDraws` types.

**RED.** New tests, each in the file of the function it tests:
- a replicate that draws every identity and every customer once reproduces `qualityPoint` and
  `pairedPoint` exactly, every measure, on a set built like 6C's company case (every match to a
  resampled identity; with fixed matches too in the paired one);
- a drawn case counts once per draw with every match it kept (and its fixed ones), and a drawn
  customer alerts as it alerted against the whole list (explicit draws);
- the 6C definition, kept in each test file as a reference, and the new one give the same samples
  when no case or customer matches another resampled identity, and different ones otherwise;
- recall is drawn as before.

Two tests of `bootstrapQuality` asserted the 6C definition, which decision 7 replaces. They now
assert the new one: "counts a false match only when the replicate drew the entry it points at"
became "counts every match a drawn case kept, once per draw, whatever else the replicate drew"
(precision samples {1/2, 2/3, 1}, where 6C's gave {2/3, 1}); "alerts a customer only when the
replicate drew an entry it matched, and resamples customers" became two tests, "alerts a drawn
customer when it alerted against the whole list" (a customer matching B alone alerts in every
replicate) and "resamples the customers" (unchanged numbers). The C002 note under a marked
interval no longer says why the old bootstrap was biased; it says the mark is a flag.

```
$ pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs scripts/benchmark-metrics.test.mjs scripts/benchmark-paired.test.mjs scripts/benchmark-report.test.mjs --coverage.enabled=false
     × counts every match a drawn case kept, once per draw, whatever else the replicate drew (owner decision 7 after 6C)
     × alerts a drawn customer when it alerted against the whole list (owner decision 7 after 6C)
     × a replicate that draws every identity and every customer once reproduces qualityPoint exactly
     × counts a drawn case once per draw with every match it kept, and a drawn customer as it alerted
     × agrees with the 6C definition when no case or customer matches another resampled identity, and not otherwise
AssertionError: expected Set{ '1.000000', '0.666667' } to deeply equal Set{ '0.500000', '0.666667', …(1) }
AssertionError: expected Set{ 1000, +0 } to deeply equal Set{ 1000 }
Error: qualityReplicate is not built yet
Error: qualityReplicate is not built yet
AssertionError: expected [ 0.4117647058823529, …(299) ] to not deeply equal [ 0.4117647058823529, …(299) ]
      Tests  5 failed | 20 passed (25)            # benchmark-metrics.test.mjs
     × a replicate that draws every identity and every customer once reproduces pairedPoint exactly
     × counts a drawn case with every match it kept and its fixed ones, and a drawn customer as it alerted
     × agrees with the 6C definition when no case or customer matches another resampled identity, and not otherwise
Error: pairedReplicate is not built yet
Error: pairedReplicate is not built yet
AssertionError: expected [ 0.2857142857142857, …(299) ] to not deeply equal [ 0.2857142857142857, …(299) ]
      Tests  3 failed | 9 passed (12)             # benchmark-paired.test.mjs
     × marks a bootstrap interval that excludes its own point, with the Wilson interval beside it, as a flag (review C002, owner decision 7 after 6C)
      Tests  1 failed | 16 passed (17)            # benchmark-report.test.mjs
$ pnpm -s benchmark:typecheck     # clean
```

The agreement tests fail on their second half only: at RED the code is the 6C definition, so the
company-like set's samples equal the reference.

**GREEN.** One replicate, `drawnMeasures(set, drawn, customerDraws)` in `benchmark-metrics.mjs`,
which `bootstrapQuality` and `pairedSamples` both call: a drawn case adds `times` to its source's
cases, `times` to the hits when it found its identity, and `times × (other kept matches + fixed
ones)` to the false matches; a drawn customer adds `times` to the alerted when it kept any match.
The stream and the order of the draws are unchanged (identities, then customers), so recall's
samples are 6C's to the bit. `qualityReplicate` and `pairedReplicate` evaluate it for given draw
counts. The C002 note now says the mark is a flag. The golden `bootstrap` digest is re-pinned
(`ec8e95ff…19d2` → `74c127e2…41d1`), with the base's value in a comment; the golden `intervals`
digest (Wilson and percentile intervals, which decision 7 does not touch) does not move, so it is
not re-pinned.

```
$ pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs scripts/benchmark-golden.test.mjs --coverage.enabled=false   # before the re-pin
-   "bootstrap": "ec8e95ff30faa723e69bfdd4863cc96fe000dd0cce447008b8e6f1aa902519d2",
+   "bootstrap": "74c127e22aed3d835888934b01143401d7b02039233979b14f8c508a326f41d1",
    "intervals": "814d4d02c8c6b28cd9d0fef2112703e68a622bdeba421b53bb9349df704fda5e",
$ pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs      # after it, with coverage
 Test Files  11 passed (11)
      Tests  108 passed (108)
All files          |    98.9 |    85.93 |     100 |   98.77 |
$ pnpm -s benchmark:typecheck     # clean
$ pnpm exec eslint packages/watchlist/scripts/     # clean
```

## Slice 3: the identity of the created matches (decision 8)

**Stub** (`f271aed7`): `scripts/benchmark-identity.mjs` with `canonicalJson`, `matchDigest`,
`IDENTITY_FIELDS`, `identityCheck`, `switchShare` and `executedRunsCheck`, each throwing "not built
yet", added to `BENCHMARK_HELPERS` (the 80% coverage gate).

**RED.** `scripts/benchmark-identity.test.mjs`: the digest is canonical (members sorted, arrays in
order) and moves with each member a run returns (score, entry key, matched name, match types,
qualifiers, alias type, methods and their order, name level) and with the matches' order; the
identity check compares by query and preset in any line order, names each differing field and
the queries one run alone holds, and is not "the same" when a pair has no digest or a preset is
missing on one side; a switch's share pairs each off round with the on round after it (median and
range of on − off) and refuses rounds that do not alternate; the executed runs pass only when
every inserted run has a line and keeps a match on a changed entry, a resumed line counted once,
and are set against the no-miss check's full screenings when given.

```
$ pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs scripts/benchmark-identity.test.mjs --coverage.enabled=false
     × sorts object members, keeps array order, and digests the whole created matches
     × moves with every member a run returns, and with the matches’ order
     × compares by query and preset, whatever order the resumed steps wrote the lines in
     × names each field that differs, and the queries one run alone holds
     × is not the same when a preset carries no digest, or one run lacks a preset
     × pairs each off round with the on round after it, and takes the median and range of on − off
     × refuses rounds that do not alternate off then on
     × passes when every inserted run, executed, keeps a match on a changed entry
     × fails on a run that keeps no changed entry or has no line, counting a resumed line once
Error: canonicalJson is not built yet
Error: matchDigest is not built yet
Error: identityCheck is not built yet            (three tests)
Error: switchShare is not built yet
AssertionError: expected error to be instance of RangeError
Error: executedRunsCheck is not built yet        (two tests)
      Tests  9 failed (9)
$ pnpm -s benchmark:typecheck     # clean
```

**GREEN.** The helpers live in `benchmark-scale.mjs` ("Identity" section): the stub module
`benchmark-identity.mjs` is folded into it, because the gates test (`benchmark-gates.test.mjs`)
requires every helper that reaches neither the API nor the database to be listed in
`packages/watchlist/tsconfig.json`'s `include`, a file no 6D agent owns; `benchmark-scale.mjs`
already is. The tests stay in `benchmark-identity.test.mjs`, importing from `benchmark-scale.mjs`.
One RED test was wrong for a reason of its own (it reordered a match with a `JSON.stringify`
replacer array, which also drops the nested members); it now reorders the top-level members with
`Object.fromEntries(Object.entries(MATCH).reverse())`.

The CLIs:
- `benchmark-quality.mjs`: every preset of an observation line (the 6B set and the scale sets)
  carries `digest`, `matchDigest(result.matches)`; `--step identity --base <dir> --head <dir> --out
  <dir>` writes `identity.json` for the 6B set and each scale set both runs hold.
- `benchmark-performance.mjs`: every timed screening records `digest`; `<scale>-shares --switch
  <name> [--takes 3]` runs a priming round, then the rounds off and on alternately in one call, each
  after the analysed-name and token caches are emptied and the warm-ups run again, and checks every
  subject's digest against the priming round's; `rescreen-runs --size <n> [--workers k --worker i]`
  executes the inserted `list_update` runs with their trigger sync, nothing persisted, and writes
  `executedRunsCheck`'s summary (against `rescreen-check-<n>`'s full screenings when present);
  `--step identity` compares the first measure round of each scale subject by subject.
- `benchmark-postgres.mjs`: `screenOnce` takes an optional `run` (`runType`, `triggerSyncId`).

```
$ pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs
 Test Files  12 passed (12)
      Tests  117 passed (117)
All files          |      99 |    86.81 |     100 |   98.88 |
$ pnpm -s benchmark:typecheck && pnpm exec tsc -p tsconfig.json --noEmit     # clean
$ pnpm exec eslint packages/watchlist/scripts/                              # clean (from the root)
```

**Smoke run** (development only: `--smoke` sizes, a scratch seed `ac01524f3afe60da4151277f677383cb`,
namespace `c6dsmoke`, outputs in `/tmp/cal6d-smoke`, never a published number). Every new step ran
end to end in the main tree, each under the e2e lock:
- `100k-shares --switch ratio-check` and `--switch array-parameters`: six rounds each,
  `identical: true`, 0 subjects differing; `--switch nope` refuses with the list of switches;
- `rescreen-100`, `rescreen-check --size 100`, then `rescreen-runs --size 100` with 2 workers side
  by side: `{"runs":11,"missing":0,"keptChanged":11,"missed":0,"full":{"subjects":11,"covered":11,"short":0},"pass":true}`;
- quality `scale-prepare`, `scale-screen`, `scale-report` at 100k and the 6B `prepare`, `screen`,
  `report`: every preset of every line carries a 64-digit digest;
- `benchmark:quality --step identity` of the run against a copy of itself: `same: true`, 6B 576 of
  576 pairs and scale 258 of 258 identical, 0 undigested; `benchmark:performance --step identity`:
  `same: true`, 40 of 40;
- `benchmark:render` of the run renders every table.

## Slice 4: the executed runs compared across trees (decision 8)

Report ids are drawn per database, so two trees' runs cannot be compared by id. **RED**: an
executed run's line may carry `subject`, a digest of the query it screened, and
`executedRunsCheck` returns `subjects`, the SHA-256 of those digests sorted (one a line), or
`null` when a line has none; the member is stubbed to `null`. The first executed-runs test's
expected object gains `subjects: null` (my own test of slice 3, for the new member).

```
$ pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs scripts/benchmark-identity.test.mjs --coverage.enabled=false
     × digests the subjects the runs screened, whatever their order, so two trees can be compared without their report ids
AssertionError: expected null to be '39ead0d6d47965b74dc83fcbafcb5a9f8af1f…' // Object.is equality
      Tests  1 failed | 9 passed (10)
$ pnpm -s benchmark:typecheck     # clean
```

**GREEN.** `executedRunsCheck` digests the sorted `subject` digests; `rescreen-runs` writes each
line's `subject` as the SHA-256 of the query's canonical JSON (a digest, never the query).

```
$ pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs
 Test Files  12 passed (12)
      Tests  118 passed (118)
All files          |      99 |    86.86 |     100 |   98.88 |
$ par.sh ... 2 benchmark:performance --seed ac01524f3afe60da4151277f677383cb --smoke --namespace c6dsmoke --step rescreen-runs --size 100
{"runs":11,...,"pass":true}   subjects a6aae9d6946802772747149957730bb0433fcc671555ca356b0c2ba7613e5628
```

## The method, the seed and the measurement

- `5c1420ca` commits `docs/calibration/watchlist-phase6d.md`'s method and decision rules (margin
  5%). Only then: `openssl rand -hex 16` → `9dd9b3530f47966b9f1b88e78445c08f` at
  2026-10-29T23:30:18Z.
- Worktrees: `/tmp/cal6d-base` at `9882aee3` with the head's 27 `benchmark-*` files and
  `heavy-headed.ts` overlaid (checked with `sha256sum -c`, 0 mismatches); `/tmp/cal6d-head` at
  `5c1420ca` (`git diff 60483a3b 5c1420ca` outside `docs/` and the benchmark scripts: empty). Both
  built shipped groups `29d05838…3bfb`.
- Before the seed, a smoke run on a scratch seed checked every new step at both trees (the base
  with the overlay): the identity of base and head was `same` on the smoke sets.
- Every step ran from scratch tools in the session scratchpad (`step.sh`, `par.sh`, `p.sh`,
  `q.sh`, `qboth.sh`, `pboth.sh`, `take1.sh`, `share.py`, `merge.py`, `rs.py`, `rounds.py`), each
  benchmark step under `flock /tmp/openverify-e2e.lock`, logs in `/tmp/openverify-eval-6d/log-*.txt`.
  The results and verdicts are in the report; abbreviated:

```
identity (compare/quality/identity.json): same: true
  6b          compared 49800 identical 49800 undigested 0
  scale-100k  compared 10350 identical 10350 undigested 0
  scale-2m    compared 10350 identical 10350 undigested 0
identity (compare/performance/identity.json): same: true, 100k 300/300, 2m 300/300
100k-measure  base 391.5/354.3/331.8 (median 354.3)  head 180.9/173.1/187.8 (median 180.9)  loads ≤ 3.2
2m-measure    base 1145.6/1217.0/1152.5 (1152.5)     head 797.9/828.3/808.0 (808.0)          loads ≤ 3.1
rescreen 1000 base 209.7/208.2/201.5 (208.2 s)       head 89.3/73.9/74.3 (74.3 s); runs 2676 both
rescreen-check 1000: missed 0 of 2637 at both trees
rescreen-runs: pass at both trees, 626/213/2676 runs, same subjects' digests
shares: 8 switches × 2 scales, identical: true everywhere, every median on − off negative
gate (head, timing asserted): p95 65.0 / 66.1 / 64.6 ms, Tests 6 passed (6) each
```

## Final gates (2026-10-30, after the last measurement)

```
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/watchlist test
 Test Files  67 passed (67)
      Tests  717 passed (717)
All files          |   98.62 |    90.18 |   99.14 |    98.6 |
$ pnpm -s benchmark:test
 Test Files  12 passed (12)
      Tests  118 passed (118)
All files          |      99 |    86.86 |     100 |   98.88 |
$ pnpm -s benchmark:typecheck && pnpm -s typecheck && pnpm -s lint    # clean
$ flock /tmp/openverify-e2e.lock pnpm format:check
All matched files use Prettier code style!
```

The head's 100,000-name performance steps from an empty directory
(`/tmp/openverify-eval-6d/final/performance`, namespace `c6d-final`, from `/tmp/cal6d-head`):

```
$ pnpm -s benchmark:performance --seed 9dd9b3530f47966b9f1b88e78445c08f --out /tmp/openverify-eval-6d/final/performance --namespace c6d-final --step machine
$ ... --step 100k-import          # "sha256":"c7a4ddc71c19fb6ceb0fd0aea10c619d24d63710d2a8323b410a6b007fc91b66"
$ ... --step 100k-measure --rounds 1   # three times: p95 160.8 (1.51 → 1.51), 164.2 (1.47 → 1.69), 164.3 (1.91 → 1.77)
$ ... --step 100k-unlisted        # {"alerted":23,"of":150,...,"matches":147}
$ ... --step 100k-teardown
$ pnpm -s benchmark:performance --step identity --base /tmp/openverify-eval-6d/head/performance --head /tmp/openverify-eval-6d/final/performance --out /tmp/openverify-eval-6d/compare/final
                                  # 100k: 300 of 300 identical
```
