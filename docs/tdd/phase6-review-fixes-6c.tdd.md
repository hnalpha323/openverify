# TDD evidence: Workflow 6C review fixes (Phase 6, reports)

- **Slice owner:** the Workflow 6C Stage 5 fixer (`fix-6c`), over every path, alone in the tree.
- **Date:** 2026-10-29.
- **Input:** the Workflow 6C review of `94ab63f9..6af5130a`:
  - the blocking finding C001;
  - the calibration's verdicts (`docs/calibration/watchlist-phase6c.md`): every decision kept or not measured, so nothing is reverted;
  - the Stage 1 and 2 builders' follow-ups addressed to `fix-6c`;
  - the MEDIUM items C002, C003 and C004, in that order.

Each fix follows the same cycle:
1. The regression test, run to see it fail for the intended reason (RED, `test` commit). A RED TypeScript test typechecks.
2. The smallest change that passes it (GREEN, `fix` commit).
3. A refactor with the suite green, where one was worth making.

All commands ran after `source scripts/env.sh`. "vitest (<package>) <files>" stands for `pnpm exec vitest run <files> --coverage.enabled=false` in that package. Output is trimmed to the lines that matter. Every name, list and value in these tests is synthetic.

## C001 (HIGH): the stale-evidence lookup and the run insert bound one parameter per id

`listReportsWithLiveMatches` (`packages/db/src/repositories/report-rescreen.ts`) passed every changed entry's `entry_index` to one `inArray`, and `insertListUpdateRuns` every report id to one `array[$1, …]`. Both bind one parameter per id. Postgres takes at most 65,535 in a Bind message, and node-postgres 8.23.1 writes the count with `addInt16`, which wraps beyond that. So a sync that changes more than about 65,530 entries (once the worker passes the blind-index key), or an environment with that many reports to run (live today, because `hits` covers the whole environment since 6C), failed the re-screen after its forward screen, every retry and every sweep, and inserted no `list_update` run.

Tests (`packages/db/src/repositories/report-rescreen.test.ts`). PGlite misreads long parameter lists well before 65,535 (the verifier saw wrong results from about 33,000), so the tests do not push 65,536 ids through it. They spy on the PGlite client's `query` and record the most parameters any statement bound:
- the lookup of 2,503 entry indexes (the two seeded matches' at the start and end, one repeated, 2,500 that name no match) returns both reports, and no statement binds more than 1,000 parameters;
- the insert for 2,502 report ids (two recurring reports, 2,500 ids that name no report) inserts both runs, and no statement binds more than 1,000; a second call inserts none.

```text
RED   $ vitest (packages/db) src/repositories/report-rescreen.test.ts
     × takes any number of changed entries within a bounded number of parameters per statement (C001)
AssertionError: expected 2509 to be less than or equal to 1000
     × inserts runs for any number of reports within a bounded number of parameters per statement (C001)
AssertionError: expected 2507 to be less than or equal to 1000
      Tests  2 failed | 7 passed (9)
GREEN $ vitest (packages/db) src/repositories/report-rescreen.test.ts
      Tests  9 passed (9)
      $ vitest (apps/api) src/jobs/reports/rescreen
 Test Files  2 passed (2)
      Tests  10 passed (10)
```

The first RED run of the lookup test failed on `expected [] to deeply equal [...]`, because the test seeded its matches on the default source (`openverify-sandbox`) instead of the re-screened one. The test was corrected before its commit, and the RED above is the run of the committed test.

Fix: both functions take their ids 500 to a statement (`chunks` from `watchlist-rows.ts`, the `BATCH` the sync's writes use). The lookup merges the reports of every statement and returns them distinct and sorted; without `entryIndexes` it is still one statement. The insert sums the runs each statement inserted. Each statement stays idempotent on `(report_id, trigger_sync_id)`, so a re-screen that fails between two statements inserts the rest on its retry.

## matcher-6c follow-up: the worker passes the blind-index key to the re-screen

`startWorkers` (`apps/api/src/worker.ts`) built `reportRescreenProcessor` without `blindIndexKey`, so the deployed re-screen logged "watchlist re-screen without the blind-index key" and gave a run to every report with a live match on the source. With C001 fixed, the key can be wired.

Test (`apps/api/src/worker.test.ts`): a worker started with a blind-index key hands the `report-rescreen` job's processor that key.

```text
RED   $ vitest (apps/api) src/worker.test.ts -t "blind-index key"
     × gives the re-screen the blind-index key, so stale evidence is found by entry_index (owner decision 3 after 6B)
AssertionError: expected "vi.fn()" to be called with arguments: [ { syncId: 4 }, ObjectContaining{…} ]
-   ObjectContaining {
-     "blindIndexKey": Uint8Array [
GREEN $ vitest (apps/api) src/worker.test.ts
      Tests  46 passed (46)
```

Fix: `blindIndexKey: options.blindIndexKey` in the `reportRescreenProcessor` call.

## api-reports-6c and console-tests-6c follow-up: decision 9's evidence reaches the snapshots

The contract and the API served `list-memberships` and `relative-of-class` (api-reports-6c item 8), but no entity builder called `recordEvidence`, so no run wrote them.

Tests (`apps/api/src/jobs/report-types/matching-reports.test.ts`). The sandbox entries are replaced by copies on two synthetic non-SDN lists (one with no programme), as an OFAC Consolidated record would be:
- the `watchlist`, `business-watchlist` and `crypto-address-watchlist` matches carry `list-memberships` equal to the record's, and the person entity no `relative-of-class`;
- the sandbox PEP relative (`relative_of_class` 1, ingestion-6c item 5) carries `relative-of-class` 1 with `pep-type: relative`, and the office holder carries none.

```text
RED   $ vitest (apps/api) src/jobs/report-types/matching-reports.test.ts
     × keeps the entry’s other lists in the snapshot, so a non-blocking listing is never read as an SDN block (owner decision 9 after 6B)
AssertionError: expected undefined to deeply equal [ { …(2) }, { …(2) } ]
     × keeps the business’s other lists in the snapshot (owner decision 9 after 6B)
AssertionError: expected undefined to deeply equal [ { …(2) }, { …(2) } ]
     × keeps the address holder’s other lists in the snapshot (owner decision 9 after 6B)
AssertionError: expected undefined to deeply equal [ { …(2) }, { …(2) } ]
     × keeps a relative’s class in the snapshot, and none on an office holder (owner decision 9 after 6B)
AssertionError: expected { …(11) } to match object { 'pep-type': 'relative', …(1) }
      Tests  4 failed | 31 passed (35)
GREEN $ vitest (apps/api) src/jobs/report-types src/jobs/reports
 Test Files  14 passed (14)
      Tests  138 passed (138)
```

Fix (`record-evidence.ts`, the three name jobs and `screenCrypto` in `jobs/reports/screening.ts`): two narrow helpers over `recordEvidence`. `listEvidence(record)` gives a sanctions entity (person, business, crypto) its `list-memberships` only, because those strict entity schemas have no PEP class, so a sanctions record that carried one could not be served. `relativeEvidence(record)` gives a PEP relative's entity its `relative-of-class`; a holder's entity takes none, as the contract's refinement requires. The evidence hash (`evidenceHashInput`: entry key, content hash, matched name, query) does not read the snapshot's entity, so no existing match changes its evidence or re-alerts.

## calibration-6c follow-up: the constants' sources name the calibration that kept them

`RETRIEVAL_6C` (the source of `key-frequency-bound-share`, `pair-max-tokens` and `pair-max-groups`) ended "fixed by docs/calibration/watchlist-phase6c.md", and `TYPO_EDIT_DISTANCE.source` "kept unless docs/calibration/watchlist-phase6c.md finds a material rise in false alerts". The calibration has since kept both decisions.

Tests (`packages/core/src/report-matching.test.ts`): the three retrieval sources contain "kept by docs/calibration/watchlist-phase6c.md (evaluation seed e8223c34916200e2b8e51f0b47981804, decision 1): ", and the typo rule's source ends "kept by docs/calibration/watchlist-phase6c.md: no rise in false alerts (persons −12.7 and −90.1 per 1,000 at 100,000 and 2,000,000 names, companies unchanged)". The basis stays `provisional` (H-tier stays beta), as the existing assertions require.

```text
RED   $ vitest (packages/core) src/report-matching.test.ts
     × bounds a key by entries, a share of the candidate cap, whatever the size of the source (owner decision 1 after 6B)
AssertionError: key-frequency-bound-share: expected 'C78.3 (owner decision 1 after 6B; our…' to match /development tables, seed …/calibration\
     × count an adjacent transposition as one typo: the optimal string alignment distance (owner decision 4 after 6B)
AssertionError: expected 'C78.4 (owner decision 4 after 6B; our…' to match /; kept by docs\/calibrati…/calibration\
      Tests  2 failed | 7 passed (9)
GREEN $ vitest (packages/core) src/report-matching.test.ts
      Tests  9 passed (9)
```

The first draft of the retrieval regex ended in `$`, which the sources (`<RETRIEVAL_6C>: a key held by …`) can never meet. It was corrected to end at the prefix's `: ` before the RED commit; the RED above is the committed test's. Fix: the two strings, and the doc comment of `TypoEditDistance` ("Kept by the 6C calibration"). No value or basis changed, and no other copy of the strings exists (grep over the repository).

## calibration-6c follow-up: the quality CLI carries the 12 GB heap

The 2,000,000-name `scale-prepare` parses a 450 MB file, and the calibration had to run it with `NODE_OPTIONS=--max-old-space-size=12288`, which `benchmark:performance` already carries.

Test (`packages/watchlist/scripts/benchmark-gates.test.mjs`): `benchmark:quality` and `benchmark:performance` both start `node --max-old-space-size=12288 `.

```text
RED   $ vitest (packages/watchlist) scripts/benchmark-gates.test.mjs
     × gives both CLIs that parse a 2,000,000-name table the heap it needs (calibration-6c follow-up)
AssertionError: benchmark:quality: expected 'node --experimental-transform-types -…' to match /^node --max-old-space-size=12288 /u
      Tests  1 failed | 2 passed (3)
GREEN $ vitest (packages/watchlist) scripts/benchmark-gates.test.mjs
      Tests  3 passed (3)
```

Fix: the flag in `packages/watchlist/package.json`, right after `node`.

## calibration-6c follow-up: the resumable steps check their budget after every query

`screen` and `scale-screen` (`benchmark-quality.mjs`) and `<scale>-variants` (`benchmark-performance.mjs`) checked their 8-minute budget only after writing a batch (200 queries, or 50), so the base's 2,000,000-name `scale-screen` ran about 11 minutes a call.

A stub commit (`chore`) first added `stepWriter` to `benchmark-scale.mjs` (a tested helper module) with the steps' behaviour of the time: lines appended a batch at a time, the budget read only when a batch is written. Tests (`scripts/benchmark-scale.test.mjs`):
- with a batch of 3 and a budget of 100 ms, a first line at 40 ms gives `false`, and a second at 101 ms gives `true`, with both lines written;
- with a batch of 2, three lines write one batch, the third goes out on `flush`, and a flush with nothing pending writes nothing.

```text
RED   $ vitest (packages/watchlist) scripts/benchmark-scale.test.mjs
     × checks the budget after every query, writing every line before it stops (calibration-6c follow-up)
AssertionError: expected false to be true // Object.is equality
      Tests  1 failed | 7 passed (8)
GREEN $ vitest (packages/watchlist) scripts/
 Test Files  11 passed (11)
      Tests  90 passed (90)
      $ pnpm exec tsc --noEmit -p tsconfig.json && pnpm benchmark:typecheck   (packages/watchlist)
      (both exit 0)
```

Fix: `add` checks the budget after every line and, when it is spent, writes what is pending before it says so. The three loops use one `stepWriter` each, in place of their own `pending` arrays; what each writes, and when it exits 3, is unchanged. The smoke runs of the steps are under "Benchmark smoke runs" below.

## calibration-6c follow-up: searches cut at the cap apart from those out of reach

`timeReads` recorded `truncated` only, so the performance summary's "cut at the cap" (`capBinds`) counted the head's out-of-reach searches too: 15 of 300 at 2,000,000 names, of which 6 were at the cap (calibration amendment 4).

A stub commit (`chore`) first added `capReached` and `unreachable` to the `PerformanceSummary` type, always `null`, so the RED tests typecheck. Tests:
- `benchmark-reads.test.mjs`: each retrieval records `capReached` and `unreachable` beside `truncated`; an answer without the members (a tree before 6C, where `truncated` is the cap) records `capReached` equal to `truncated` and `unreachable` false. The existing retrieval expectation gains both members.
- `benchmark-metrics.test.mjs`: the first round's shares of `capReached` and `unreachable`, with Wilson intervals; `capBinds` keeps counting `truncated`; timings without the members give `null` for both.
- `benchmark-report.test.mjs`: the performance table's columns are "Truncated (first round)", "Cut at the cap" and "Out of reach"; a summary without the members reads "not recorded" there. The compacted-round table gains the same two columns. The two existing row expectations of the performance table and the compacted row gain the two "not recorded" cells.
- `benchmark-golden.test.mjs`: the summary's digest is taken without the two new members, which are checked to be `null` for its timings, so the pin still covers every member it held at the base, with the same digest.

```text
RED   $ vitest (packages/watchlist) scripts/
     × adds each read’s duration to its phase and records each retrieval
     × records whether a retrieval was cut at the cap or out of reach, beside truncated (calibration-6c follow-up)
AssertionError: expected [ …(4) ] to deeply equal [ { candidates: 1, …(3) }, …(3) ]
     × counts, in the first round, the searches cut at the cap apart from those out of reach (calibration-6c follow-up)
AssertionError: expected null to deeply equal { count: 1, of: 4, share: 0.25, …(1) }
     × renders the imports, and the screening at each scale against its budget
     × renders the searches cut at the cap apart from those out of reach (calibration-6c follow-up)
AssertionError: expected [ …(9) ] to deep equally contain StringContaining{…}
     × renders the unlisted alerts and the compacted round per scale
 Test Files  3 failed | 8 passed (11)
      Tests  6 failed | 87 passed (93)
GREEN $ vitest (packages/watchlist) scripts/
 Test Files  11 passed (11)
      Tests  93 passed (93)
```

The stub alone made the golden test fail (its digest covers the whole summary). That was found before the RED commit, and the golden change above is part of that commit.

Fix: `timeReads` records `capReached: answer.capReached ?? answer.truncated` and `unreachable: answer.unreachable ?? false`; the timed screener (`benchmark-performance.mjs`) carries both into each round file; `performanceSummary` reports `capReached` and `unreachable` shares of the first round (`null` when any screening of the round lacks the member); the renderer prints them. No metric changed its meaning: `capBinds` is still the `truncated` share the calibration published, now documented as such.

## C003 (MEDIUM): decision 3's no-miss check is a committed step

The calibration's verdict on decision 3 rests on a no-miss check (0 missed of 2,429) that a script outside git computed (`check-rescreen.mjs` in its scratchpad). It is now the `rescreen-check --size <n> [--workers <k> --worker <i>]` step of `benchmark-performance.mjs`, with its counts in two tested pure helpers of `benchmark-posthoc.mjs`.

A stub commit (`chore`) first added `rescreenSubject` and `rescreenCheck`, counting nothing. Tests (`scripts/benchmark-posthoc.test.mjs`):
- `rescreenSubject` counts a subject's kept entries that the sync changed, and keeps its error codes;
- `rescreenCheck` over five lines (one subject resumed, so screened twice; its last line counts) and two runs: 4 subjects, 1 errored (`result_truncated`), 2 matched on a changed entry, 1 of them with a run, 1 missed (Wilson over 2), 1 run without such a match, 3 matches on changed entries;
- no miss gives the Wilson bound over the matched subjects, and an empty check gives `null`.

```text
RED   $ vitest (packages/watchlist) scripts/benchmark-posthoc.test.mjs
     × counts a subject’s kept matches on the changed entries, and keeps its error codes
     × finds the subjects matched on a changed entry without a run, and the runs without such a match
     × reports no miss when every matched subject has a run, with a Wilson bound
AssertionError: expected { changedEntries: 1, …(10) } to match object { missed: +0, ofThemWithRun: 1, …(1) }
GREEN $ vitest (packages/watchlist) scripts/benchmark-posthoc.test.mjs
      Tests  10 passed (10)
```

The step follows the method of `docs/calibration/watchlist-phase6c.md` (decision rule 3) and the scratch script:
- it refuses unless the last applied sync of `openverify-sandbox` added `n` entries, so it runs right after `rescreen-<n>` and before the next size;
- it reads that sync's live changed entries and the environment's `list_update` runs with that `trigger_sync_id`;
- it screens every subject of `listRecurringReportSubjects` with the `watchlist` job, at its pinned configuration resolved as a run resolves it (`resolveReportTemplateConfig`), against the whole table, with nothing persisted;
- each line holds the report id and counts only; `k` processes side by side each take every `k`-th subject; it resumes from every worker's file, stops at its 8-minute budget through `stepWriter`, exits 3 while a subject is unscreened, and the call that finds every subject screened writes `rescreen-check-<n>/summary.json`.

In the same commit, the `rescreen-<n>` step passes a synthetic blind-index key (SHA-256 of `<seed>/rescreen/blind-index`) to `processReportRescreen`, because the worker now passes the real one (above). A re-measurement then covers the stale-evidence lookup by `entry_index` that C001 changed. The benchmark's reports have no matches, so the key changes no run.

**Refactor (after the smoke runs).** With workers side by side, a worker's last `read()` can meet another worker's line while it is being appended, and `JSON.parse` would throw on the fragment (the worker's own lines are already written, so a later call recovers). A stub commit added `rescreenSubjectLines`, reading nothing; the test gives it two whole lines (both read), a whole line and a cut one (only the whole one read), and an empty file (nothing).

```text
RED   $ vitest (packages/watchlist) scripts/benchmark-posthoc.test.mjs
     × reads only the complete lines of a worker file another worker may be appending to
AssertionError: expected [] to deeply equal [ 'rep_a', 'rep_b' ]
      Tests  1 failed | 10 passed (11)
GREEN $ vitest (packages/watchlist) scripts/
 Test Files  11 passed (11)
      Tests  98 passed (98)
```

The first run of that RED test did not typecheck (an untyped arrow parameter under `checkJs`); it was typed before the RED commit. Fix: the reader drops the piece after the last newline (empty for a whole file), and `rescreen-check` reads every worker file through it.

### Benchmark smoke runs

Development seed `de6a293ad1cf757522bd824287f6b214` (drawn with `openssl rand -hex 16`; never a published number), namespace `fix6c-smoke`, `--smoke`, output in the session scratchpad, under `flock /tmp/openverify-e2e.lock`, at load 0.8 to 2.2:

```text
$ pnpm -s benchmark:performance … --step 100k-import / 100k-measure / rescreen-seed / rescreen-100
measure: "capBinds":{"count":0,"of":40,…},"capReached":{"count":0,"of":40,…},"unreachable":{"count":0,"of":40,…}
rescreen-100: {"added":100,…,"result":{"environments":1,"subjects":2000,"runsInserted":6,"matched":6,"stale":0}}
$ … --step rescreen-check --size 100 --workers 2 --worker 0
{"size":100,"worker":0,"workers":2,"screened":1000,"done":1000,"of":2000,"seconds":16.6}
incomplete: run the rescreen-check step again          (exit 3)
$ … --step rescreen-check --size 100 --workers 2 --worker 1
{"size":100,…,"done":2000,"of":2000,…,"syncId":2,"changedEntries":100,"listUpdateRuns":6,"subjectsScreened":2000,"erroredSubjects":0,
 "fullScreeningMatchesChanged":6,"ofThemWithRun":6,"missed":0,"missedWilson":[0,0.390…],"runsWithoutFullScreeningMatch":0,"matchesOnChangedEntries":6}
$ … --step rescreen-check --size 300                 (before rescreen-300: refused, exit 1)
$ … --step 100k-variants                             (stepWriter: completes, summary written)
$ … --step rescreen-300; then rescreen-check --size 300
{"size":300,"worker":0,"workers":1,"screened":2000,…,"listUpdateRuns":10,…,"fullScreeningMatchesChanged":10,"ofThemWithRun":10,"missed":0,…}
$ … --step 100k-teardown
$ pnpm -s build:variant-groups --hold-out <dev seed> --output <scratch>/held-out.json      (7 s)
$ pnpm -s benchmark:quality … --smoke --step prepare / screen / report / teardown
screen: {"screened":192,"done":192,"of":192,"seconds":7}
$ pnpm -s benchmark:quality … --smoke --scale 100k --step scale-prepare / scale-screen / scale-report / scale-teardown
scale-screen: {"scale":"100k","screened":86,"done":86,"of":86,"seconds":5}
$ pnpm -s benchmark:render --out /tmp/openverify-eval-6c/head      (stdout only)
| … | Truncated (first round) | Cut at the cap | Out of reach | Would end `result_truncated` | …
| 2,000,000 | 250 ms | … | 15 of 300 · 5.0% (3.1–8.1%) | not recorded | not recorded | 0 of 300 · 0.0% (0.0–1.3%) | 148 of 150 |
```

The calibration's own round files predate the members, so its rendered tables read "not recorded" in the two new columns, and its published "Truncated" figures are unchanged.

## console-tests-6c follow-up: the match-writing test's order does not rest on the wall clock

`report-repositories.test.ts` "writes matches, keeps one live row per entry, and finds a dismissed evidence hash" inserted the open match and its lapse with the same `at: T`, so their newest-first order fell to the ULIDs, whose time follows `Date.now()`.

RED: the test runs under `onTestFinished(wallClockStepsBack())`, as the Phase 1–5 ordering tests do (console-tests-6c item 12).

```text
RED   $ vitest (packages/db) src/repositories/report-repositories.test.ts -t "writes matches, keeps one live row"
     × writes matches, keeps one live row per entry, and finds a dismissed evidence hash
AssertionError: expected [ [ 'dismissed', null ], …(1) ] to deeply equal [ [ 'open', …(1) ], …(1) ]
GREEN $ vitest (packages/db) src/repositories/report-repositories.test.ts
      Tests  13 passed (13)
```

Fix, as the follow-up said: the lapse is inserted `at: minutes(1)` and updated `at: minutes(2)`. Every assertion is unchanged.

## console-tests-6c follow-up: the `updated_at` trigger tests do not rest on the wall clock

`constraints.test.ts` "bumps updated_at on every update" and `constraints-v2.test.ts` "still bumps updated_at on new tables otherwise" slept 5 ms and asserted that the trigger set `updated_at` later than the insert's. That holds only while PGlite's `now()`, which reads `Date.now()`, moves forward.

RED: each runs under `onTestFinished(wallClockStepsBack())`.

```text
RED   $ vitest (packages/db) src/constraints.test.ts src/constraints-v2.test.ts -t "bumps updated_at"
     × bumps updated_at on every update
AssertionError: expected 1793269979510 to be greater than 1793269979546
     × still bumps updated_at on new tables otherwise
AssertionError: expected 1793269979504 to be greater than 1793269979533
GREEN $ vitest (packages/db) src/constraints.test.ts src/constraints-v2.test.ts
      Tests  53 passed (53)
```

Fix, as the follow-up said: before the update, `updatedAnHourAgo(table, id)` sets the row's `updated_at` an hour back inside `set local session_replication_role = replica` (no trigger fires), reads it back and checks the stamp took, and returns it; the test then asserts that the update moved `updated_at` past that instant. A trigger that did not fire would leave the stamp and fail. The 5 ms sleep is gone from both tests (`constraints.test.ts` no longer imports it).

## Documentation follow-ups

- **ADR 0005 §3** (ingestion-6c): "change signal," is dropped from the manifest's contents; "Every check downloads the publication and compares its SHA-256; no publisher change signal is read (owner decision 10 after Workflow 6B)." is added; the redirect now reads "to the exact allowed host, on the request's own scheme and port".
- **`docs/reports/README.md`** (ingestion-6c, api-reports-6c):
  - "Upgrading to Workflow 6C" step 1 is matcher-6c's re-key sentence, with the calibration that kept the changes;
  - a step 3 says that every run from this release writes `list-memberships` and `relative-of-class` into its matches' evidence, that the first sync's risk-data change re-scores the matches on entries that gain them, that neither enters the evidence hash, and that a redaction writes a `redact` action;
  - Privacy: `DELETE /reports/:id` "writes a `redact` action naming who redacted it (the user or API key, or `system` for the inquiry and account cascades and retention), which the report's history serves (owner decision 12 after Workflow 6B)";
  - Monitoring no longer says the re-screen "uses the most permissive configuration a template can hold", which decision 3 replaced: it screens at each report's pinned configuration, runs where a match is kept or cannot be decided, and gives stale-evidence runs.
  - `apps/dashboard/src/lib/report-type-words.test.ts`, which reads the README, passes (26 tests).
- **`docs/calibration/watchlist-phase6.md`** (evaluation-set-6c): each "Not reproduced by committed code" note, and "What run 2 does not cover", now names the 6C step that reproduces the figure from run 1's files (`typo-kinds`: 142 of 145 and 0 of 98; `100k-unlisted` and `2m-unlisted`: 37 and 93 of 150, 3,771 matches), and the `<scale>-compact` step for the compacted round, which was not run on run 1's database. No figure changed.

## C002 (MEDIUM): a bootstrap interval that excludes its own point is marked

Confirmed in `benchmark-paired.mjs`: a replicate counts a customer's match to a resampled population identity only when it drew that identity (`customer.matched.some((entry) => (drawn[entry] ?? 0) > 0)`), and a case's match to another identity likewise. For the company customers every false alert is such a match, so their replicate rates fall below the point estimate, and the published intervals exclude it (precision 37.3% with 39.4–60.7%, false alerts 247.9 per 1,000 with 148.8–235.5).

What was done, and what was not:
- **Not changed: the interval's definition.** It is `bootstrapQuality`'s (6B), pinned by the golden test and shared by every published interval. Changing it changes the calibration's numbers, and the plan gives that to the owner with a new calibration (calibration-6c item 13). No verdict rests on these intervals: the company differences are exactly zero.
- **Changed: the rendering, as the finding's interim.** Tests (`scripts/benchmark-report.test.mjs`): a company table whose precision interval and false-alert interval both exclude their points renders each as `(39.4–60.7%, which excludes the point; Wilson 33.3–41.5%)` and `(148.8–235.5, which excludes the point; Wilson 210.8–288.5)`, and prints one note under the table saying why; the persons' table of the same call, whose intervals cover their points, has neither.

```text
RED   $ vitest (packages/watchlist) scripts/benchmark-report.test.mjs
     × marks a bootstrap interval that excludes its own point, with the Wilson interval beside it (review C002)
AssertionError: expected [ …(17) ] to deep equally contain StringContaining{…}
      Tests  1 failed | 16 passed (17)
GREEN $ vitest (packages/watchlist) scripts/
 Test Files  11 passed (11)
      Tests  97 passed (97)
      $ pnpm -s benchmark:render --out /tmp/openverify-eval-6c/<base|head>      (stdout only)
marked: the companies' tables at both scales, `strict` and `tolerant`, precision and false alerts; no persons' cell
```

Fix (`scripts/benchmark-report.mjs`): `excludesPoint(value, interval)`, with a slack of 1e-9; `shareWithWilson` and the scale tables' false-alert cell mark such an interval and print the point's Wilson interval beside it; `EXCLUDED_POINT_NOTE` follows a table with a marked cell. `docs/calibration/watchlist-phase6c.md`'s company tables (base and head) carry the same marks and note, rendered from the calibration's own result files, and its finding 5 says so. No number changed.

## Confirmed and carried, with the reason

- **C004 (MEDIUM): a `list_update` run holds every entry its trigger sync changed.** Confirmed in `changedByTrigger` (`apps/api/src/jobs/reports/screening.ts`): it pages through every live entry the sync added or changed on the run's screenable sources, holds them all (full records) and scores each against the subject, once per run. After a first sync or a broad rebuild, every triggered run reads and scores the whole change. Not fixed, because no fix is local and low-risk:
  - the prefilter the re-screen uses needs the source's key frequencies, which the screening kit's frozen `WatchlistReads` (three methods, 6C) does not serve, and the unit tests' in-memory reads have no database;
  - scoring page by page changes how the screening assembles its candidates (the PEP holders, the coverage scripts' fallback, the kept entries), on the path of every name run;
  - a cap is a new C78.4 constant, and it would turn a large sync's runs into `truncated` ones.

  For the owner: give `WatchlistReads` a key-frequency read, then filter each page of changed entries through a one-subject reverse index built as the re-screen builds it (the same keys, frequencies and bound, so the run still screens whatever the re-screen found), and score page by page.
- **The re-screen's fixed cost at small syncs (calibration finding 2, offered to `fix-6c`).** Profiled on a development seed (`de6a293ad1cf757522bd824287f6b214`, 100,000 names, 200,000 subjects, a 100-entry sync, `--cpu-prof`): the re-screen took 52.6 s, 28.2 s of it on the CPU. A scratch timing of its phases over the four chunks gave:
  - `watchlistKeyFrequencies`: 15.0 s, for about 400,000 keys a chunk of 50,000 subjects (80 statements of 5,000 keys a chunk; 4.4 s of CPU is drizzle building the bound arrays);
  - `prepareReverseIndex`: 9.4 s (the pair keys of every name);
  - `subjectOf`: 8.4 s (the configuration resolved per subject 2.1 s, the query parsed 0.8 s, the rest the screening spec and the subject's analysis);
  - `listRecurringReportSubjects`: 6.5 s (decrypting 200,000 queries);
  - `build`: 4.6 s.

  No single local change removes a large share without changing what the index posts. Not changed. For the owner or the matcher's owner: keep the key frequencies across the chunks of one re-screen (common keys repeat), read the source's frequencies once per re-screen where they fit in memory, or bind the keys as one array parameter, then re-measure with the calibration's commands.
- **A pending inquiry redacted while its settlement waits (api-reports-6c, "owner decides").** Confirmed: inquiry redaction does not change the status, and `settleInquiry` reads the inquiry without a lock, so the transition can still move a redacted pending inquiry to `completed` and stage `inquiry.completed` (no report is created for it, 71ad3bf8). Both proposed fixes change Phase 1–5 inquiry semantics (`transitionInquiryStatus` serves expiry and operator decisions too), and the plan gives the choice to the owner (api-reports-6c item 9). Carried with a recommendation: lock the inquiry in `settleInquiry` (`for update`) and return when it is redacted. That leaves expiry and operator decisions unchanged, and a race test like case 4 of "completion reports against consolidation and account redaction" covers both orders.

## The calibration's verdicts, and decision 3 re-measured

Every verdict is "kept" or "not measured", so no commit is reverted. C001, the worker's key and the committed check touch what the re-screen runs, so decision 3's head numbers were taken again, with calibration-6c's handoff commands, its seed and its timing rule, at `f19085a0` (the last commit before them that touches the re-screen; the commits after it change only the check's line reader and documentation).

```text
$ git worktree add --detach /tmp/cal-fix6c f19085a0
$ (cd /tmp/cal-fix6c && pnpm install --frozen-lockfile --offline)            # data/* copied but variant-groups.json
$ (cd /tmp/cal-fix6c/packages/watchlist && pnpm -s build:variant-groups)
{"sha256":"29d0583854563f81084c05d78b5ea8805ca14630cbf655349cfa09fca84c3bfb","keptGroups":156706,"keptForms":547306,…}
# each line one call under flock /tmp/openverify-e2e.lock, from /tmp/cal-fix6c/packages/watchlist,
# --seed e8223c34916200e2b8e51f0b47981804 --out /tmp/openverify-eval-6c/fix6c-<r>/performance --namespace cal6c-fix6c-<r>
10:48:25  load 0.49 -> 2.03   67s  exit 0  r1 100k-import        (file 96c149b3…781a, as published)
10:49:32  load 2.03 -> 5.27  204s  exit 0  r1 rescreen-seed
10:57:06  load 2.27 -> 3.66   81s  exit 0  r1 rescreen-100       (re-screen 51.7 s from load 4.19: discarded)
10:59:27  load 2.17 -> 2.41   91s  exit 0  r1 rescreen-300       (63.1 s, 2,270 runs)
11:01:38  load 1.44 -> 2.34  126s  exit 0  r1 rescreen-1000      (97.4 s, 2,465 runs)
11:03:44 … 11:28:11  four calls of rescreen-check --size 1000 --workers 6 --worker 0..5 (exit 3, 3, 3, then the summary)
{"syncId":4,"changedEntries":1000,"listUpdateRuns":2465,"subjectsScreened":200000,"erroredSubjects":783,"errorCodes":["result_truncated"],
 "fullScreeningMatchesChanged":2429,"ofThemWithRun":2429,"missed":0,"missedWilson":[0,0.0016],"runsWithoutFullScreeningMatch":36,"matchesOnChangedEntries":3049}
11:34:37  r1 100k-teardown
11:34:42 … 11:45:09  r2: import 68s, seed 172s; rescreen-100 51.8 s (1.79 -> 1.88), -300 62.0 s (1.58 -> 1.96), -1000 91.0 s (1.96 -> 2.04); teardown
11:45:13 … 11:56:29  r3: import 67s, seed 246s; rescreen-100 47.9 s (1.37 -> 1.26), -300 60.4 s (1.82 -> 2.03), -1000 90.9 s (1.45 -> 2.21); teardown
11:56:33 … 12:04:54  r4: import, seed 204s; rescreen-100 49.5 s (1.85 -> 1.67), -300 62.1 s (1.41 -> 1.55); teardown
$ git worktree remove --force /tmp/cal-fix6c
```

(The loads in parentheses are each step's own, written before and after the re-screen, which the rule reads.) After database 1's 100-entry take started at 4.19, the runner's wait before a re-screen step was lowered from 2.3 to 1.5 (at most 480 s): the step's own sync raises the load before the timed re-screen. Every run count equals the calibration's (171, 2,270, 2,465), every publication its digest, and every take gave `stale` 0 (the benchmark's reports hold no match).

| Entries | Takes (s) | Median | Calibration head → base |
| --- | --- | --- | --- |
| 100 | 51.8 / 47.9 / 49.5 | 49.5 s | 53.2 (of 2) → 25.2 s |
| 300 | 63.1 / 62.0 / 60.4 | 62.0 s | 63.4 → 42.7 s |
| 1,000 | 97.4 / 91.0 / 90.9 | 91.0 s | 95.1 → 97.7 s |

Decision 3 stays **kept** under its rule: 0 missed of 2,429, and 91.0 s against the base's 97.7 s at 1,000 entries. The 60 s target is missed by 31.0 s. The numbers are in `docs/calibration/watchlist-phase6c.md`, "Re-measurement after the Workflow 6C review", and the verdict's row points to them.

## Other follow-ups addressed to `fix-6c`

- **Re-run the watchlist package gate after matcher-6c's GREEN** (evaluation-set-6c): done in the final gates; no untracked `src/zz-probe.test.ts` exists (the tree was clean at the start).
- **The Stage 1 and 2 amendments of ingestion-6c** (C76.1's `change_signal`, C76.2 step 2 and C77.4 void; `program` nullable): already recorded by the Stage 4 verifier (ingestion-6c items 2 and 8); nothing to add.
- **The PEP class filter** (decision 9, ingestion-6c): already built by matcher-6c (`politically-exposed-person.ts` reads `relative_of_class`, keeping the holder rule for records without it).
- **The integration failure under load** (api-reports-6c): not reproduced; `pnpm test:integration` passed whole at load 6.1 to 8.9 below. Without a failure there is no RED, so nothing changed.
- **matcher-6c's optional performance items** (the incremental key-frequency rebuild, the re-key's batch size, the GIN pending lists during a long sync, JIT off for the application): not done. Each changes write cost or plan stability, and needs its own measurement; carried to the owner.
- **The owner's items** of the calibration and of the builders (the budgets, the gate's lighter list, company entities in the tables, `result_truncated` at `strict` and `exact`, the Phase 11 items): left to the owner, as addressed.
- **An `ui-reports.spec.ts` check of "Other lists"** (console-tests-6c, optional): not done. It needs an OFAC Consolidated entry in the synthetic sandbox list, which changes ingestion's fixtures and their pinned hashes.

## Final gates

Run in the foreground after the last code commit (`8cb7a642`), alone on the machine.

| Gate | Result | Load (start → end) |
| --- | --- | --- |
| `pnpm typecheck && pnpm lint` | 14 of 14 tasks each, exit 0 (the earlier run's results, cached for the same inputs) | 0.54 → 0.54 |
| `pnpm turbo run test --filter=!@openverify/api --filter=!@openverify/dashboard` | 12 of 12 tasks; db 77 files, 995 tests (96.21% lines); watchlist 63 files, 610 tests (98.67%); core 21 files, 771 tests (100%); contracts 2,076 tests; checks 3,307; flow 1,012; every package over 80% | 0.46 → 1.52 |
| `pnpm turbo run test --filter=@openverify/dashboard` | 265 files, 3,924 tests; 98.71 / 93.48 / 99.15 / 98.71 | 1.36 → 7.06 |
| API, rule 8: `vitest run --coverage` with the thresholds at 0, `--shard=1/2` and `2/2` as blob reports, then `--merge-reports --coverage` | 320 files, 4,527 tests; merged 96.36 / 88.27 / 98.09 / 96.40, exit 0 (each shard alone 74 to 75%, as expected) | 4.72 → 8.42 |
| `pnpm test:integration` | db 12 files, 60 tests; API 27 files, 153 tests; 2 of 2 tasks | 6.10 → 8.90 |
| `pnpm format:check` | every file formatted | — |
| e2e, rule 7: `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` | 69 passed (18.9 s) | 7.37 → 9.11 |
| e2e: `pnpm turbo run build --filter=@openverify/e2e^...`, then `playwright test --shard=1/3` | 5 of 5 build tasks; 31 passed (2.4 min) | 8.54 → 4.12 |
| e2e: `--shard=2/3` | 31 passed (5.0 min) | 3.79 → 1.35 |
| e2e: `--shard=3/3` | 29 passed (4.5 min) | 1.25 → 4.21 |
| `pnpm --filter @openverify/api openapi:write` | no change to `docs/api/openapi.json` (no route or schema changed) | — |

The API blob reports went to the session scratchpad, not `apps/api/.vitest-reports`, which `.gitignore` does not cover. No contract, fixture or problem changed, so the Android `ContractFixturesTest` was not needed, and no infra test was touched.

An earlier run of the non-API packages, beside the six-worker no-miss check (load 11 to 12), timed out matcher-6c's `src/match/shortcuts.test.ts` once at `strict` (77.6 s against its 60 s); on the quiet machine above the whole package passed, that file's 8 tests in 98.8 s.
