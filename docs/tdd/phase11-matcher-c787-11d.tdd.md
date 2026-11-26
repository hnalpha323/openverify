# Workflow 11D, `matcher-c787-11d`: the C78.7 levers (C271.2)

Agent: `matcher-c787-11d` (claude-opus-5-5), Workflow 11D Stage 2, beside `load-harness` and
`matcher-write-11d`. Started because `contracts-11d` recorded C271's condition as `missed` on all
three budgets (Stage 1a amendment 3). Every timing here is **development context only**, never a
result (C271.3: `calibration-matcher-11d` measures base and head in Stage 3, alone): each was taken
under `flock /tmp/openverify-e2e.lock`, one step per hold, with the 1-minute load at its start and end
and the lock wait beside it, on development tables from my own seed, while other Stage 2 agents ran
their suites (loads up to 20). Counts (identity, candidates, cap, runs, work counters) do not depend
on the machine.

## 0. Base, seed, worktrees

- 11D base `d44e537db`, start `69fd529c0`, method commit `ac3fc15583558d1ad256c44fb9e39eee7ebce871`.
- **Development seed** `11f9c3676b33c9efbcd5fff666143c96`, drawn with `openssl rand -hex 16` at
  2026-11-16T12:29:00Z, after the method commit (recorded in `/tmp/m787/seed.txt`, outside git).
- **Before tree:** `git worktree add --detach /tmp/m787-before d90e62ecf` (contracts-11d's last
  checkpoint, so no other Stage 2 agent's uncommitted edit leaks into a measurement), `data/` copied,
  `pnpm install --frozen-lockfile --offline`.
- **After tree:** `/tmp/m787-after` at `d90e62ecf` with only my commits' diffs applied
  (`git diff <first>~1 <last> -- <my files> | git -C /tmp/m787-after apply`), so a difference is mine.
- Namespace `m787` (containers `evaluation-6-100k-m787`, `evaluation-6-2m-m787`), output under
  `/tmp/m787/` (outside git). Runner `/tmp/m787/bench.sh` (the package script's node flags) and
  `/tmp/m787/benchsw.sh`, a scratch wrapper that turns the named Phase 11 switches on with
  `useWatchlistSwitches` before importing `benchmark-performance.mjs` (the benchmark's `switchOf` is
  `matcher-write-11d`'s until its checkpoint 1; section 5), and prints `scorerWork()` and the CPU
  time at exit.
- The machine: Intel Xeon E5-1650 v3, 6 cores / 12 logical CPUs, 31 GiB, WSL2 on a SATA SSD, Node
  v22.22.1, the benchmark's Postgres 17.11 (`pgvector/pgvector:pg17` by digest, default settings:
  `work_mem` 4 MB, `shared_buffers` 128 MB).

## 1. The profile before any change (step 1)

Commands (each one call, `flock -E 75 -w 240 /tmp/openverify-e2e.lock`, lock wait 0 s every time):

```
bench.sh /tmp/m787-before before-100k-import --out /tmp/m787/before --step 100k-import        # 12:29:07 load 0.48 -> 12:30:21 2.74; sync 57.8 s
bench.sh ... --step 100k-measure --rounds 1   (then --rounds 2)                                # 12:30:25 2.60 -> 12:31:18 1.99
bench.sh ... --step 2m-import --part 1 .. 8                                                     # 12:31:24 1.91 -> 13:09:11 2.82; syncs 106.8, 143.7, 200.7, 241.4, 260.3, 330.6, 395.0, 441 s
bench.sh ... --step 2m-measure --rounds 1   (then --rounds 2)                                  # 13:09:15 2.60 -> 13:11:13 4.37
prof.sh  (one 2m measure round under node --cpu-prof, fresh --out)                              # 13:11:58 4.95 -> 13:12:46 4.95
probe.sh (each slow retrieval's statements timed, EXPLAIN (ANALYZE, BUFFERS) of those over 30 ms) # 13:13:55 2.62 -> 13:14:17 2.58
bench.sh ... --step rescreen-seed                                                               # 13:17:29 2.76 -> 13:21:39 4.59 (200,000 reports, 241.6 s)
rsprof.sh (rescreen-1000 under node --cpu-prof)                                                 # 13:23:03 3.82 -> 13:24:45 6.33
```

Tables: 100,000 names = 60,531 entries (file `caced867…`); 2,000,000 names = 360,626+ entries in 8
syncs, `watchlist_names` 1.70 GB, `watchlist_entries` 743 MB, `watchlist_key_df` 226 MB.

**C78.7 on this seed (before, three rounds each, context):**

| Scale | Round p95 (ms) | Median | p50 | Phase p95 state / retrieval / loads / rest | Candidates p50 / p95 | Cap | Out of reach | Truncated | Listed found |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100,000 | 61.4 / 59.7 / 50.3 | **59.7** | 11.9-14.1 | 3.5 / 16.5 / 14.5 / 27.5 | 87 / 555 | 4 / 300 | 3 / 300 | 7 / 300 | 150 / 150 |
| 2,000,000 | 254.2 / 270.6 / 308.4 | **270.6** | 42.2-47.3 | 7.3 / 58.1 / 37.1 / 142.1 | 182 / 981 | 6 / 300 | 19 / 300 | 21 / 300 | 149 / 150 |

The seed dependence 6D found shows again: this draw is lighter at the head than 6D's (cap 4 and 6 of
300 against 6D's 25 and 24), so its 100,000-name p95 is under the budget and its 2,000,000-name p95
near it; the levers are sized from 6D's profile and from where this table's time goes.

**Where the time goes at 2,000,000 names** (CPU profile of one round, 47.9 s of samples, 320
screenings with the warm-ups; subject generation and GC included):
- `screenCandidates` 13.4 s inclusive (27.9%): the scorer (`scoreNamePairAbove` 7.7 s) and the
  list names' analysis (`analyseRecordName` 4.8 s, of which uncached `analyseRecordNameUncached`
  3.4 s): **the analysis is about a third of the scoring**, the lever `stored-name-analysis` targets.
- The loads: `parseRow` 1.8 s self (the entries' `data` JSON).
- Retrieval, per statement (`probe.sh`, the 12 slowest retrievals): the keys statement's ranking
  spills to disk: a search with 90 rare keys gathers 94,734 (source, entry, key) rows through 90 key
  probes (73 ms), then **sorts them for `select distinct` with `temp read=606 written=608`** (366 ->
  424 ms) before grouping: 480 ms of the statement (subject 36). The trigram path is heap I/O: one
  search's bitmap heap scan reads 36,890 blocks (445 of 609 ms, subject 105); `work_mem` changes
  nothing there.
- Statement variants on the saved statements (`variants.mjs`, best of three each, identical rows
  every time): the keys statement 432.7 ms as built; `work_mem` 32 MB 384.9, 64 MB 138.1; **each
  key's holders made distinct inside its own lookup, 109.4 ms** (also 73.3 -> 24.4, 64.1 -> 27.3,
  47.2 -> 23.1 ms on three others); the trigram statements 716 / 187 ms unchanged by any variant.

**The re-screen at 1,000 entries and 200,000 subjects** (before, one take under the profiler, load
4.67 -> 6.33): 64.9 s; phases changed 0.1, subjects 8.1, specs 6.8, prepare 8.3, frequencies 0.1,
build 5.7, candidates 4.6, **screen 29.8**, runs 1.0 s; 5,092 runs, 1,263,731 candidate pairs,
103,378 screenings. In the profile `nameScoreUpperBound` (the name-bound check) is 15.1 s inclusive,
`screenCandidates` 8.2 s, `prepareReverseIndex` 7.4 s, the index build 6.1 s,
`listRecurringReportSubjects` 5.6 s (decryption included).

## 2. `retrieval-reach` (C271.2; 6D amendment 11(a))

**What:** in `retrieveCandidates`' first statement (`packages/db/src/repositories/watchlist-reads.ts`,
`rankedByKeys`), with the switch on, each rare key's lookup returns its holders distinct by entry
(`select distinct w.entry_id ...` inside the key's own lateral probe), and the ranking groups those
(source, entry) rows; off, the statement is as before (`select distinct r.source_id, n.entry_id,
r.key` over every name row). The rows the ranking counts are the same set either way (one row per
(source, entry, key)), so the shared-key counts, the order (`shared desc, source_id, entry_id`, a
total order), the slack, the live-entry check, the cap and every flag are the same. No index, no
`keys/` change, no C78.4 constant, no lookup dropped: the pair lookup up to the cap and the trigram
path are untouched.

RED (`9050d6fbd`), `packages/db/src/repositories/watchlist-reads.test.ts`, new describe "the
retrieval-reach lever (C271.2)": the switch is off by default and, on, the ranking statement makes
each key distinct inside its own lookup (statement text recorded through the `recording` proxy); and
three seeded tables (seeds 11, 29, 53: 120 + 30 entries of one to three names over 24 tokens of a
heavy head, keys repeating within an entry, weak names, entities, three removed entries), 24 searches
each at caps 3, 8, 20 and 60, sandbox and production, with and without kinds and a trigram name:
every answer (candidates with ranks and `via`, `truncated`, `capReached`, `unreachable`) equal with
the switch on and off.

```
$ (cd packages/db && pnpm exec vitest run src/repositories/watchlist-reads.test.ts --coverage.enabled=false)
     × is off by default, and on, ranks with each key made distinct inside its own lookup 220ms
AssertionError: expected 'with src as (\n          select id fr…' to contain 'select distinct w.entry_id from watch…'
      Tests  1 failed | 23 passed (24)
```

GREEN (`4f0340db9`, `perf(db)`):

```
$ (cd packages/db && pnpm exec vitest run src/repositories/watchlist-reads.test.ts src/repositories/watchlist-switches.test.ts --coverage.enabled=false)
      Tests  44 passed (44)
$ (cd packages && pnpm exec tsc -p db/tsconfig.json --noEmit)   # exit 0; eslint and prettier clean
```

**Upgrade path:** none; a read, no stored data, `KEYS_VERSION` and the stored format unchanged.

**Development figures (context; after tree with only this lever applied, same tables and seed):**

| Scale | Switch | Round p95 | Retrieval p95 | Loads (start -> end) | Digests against the before round |
| --- | --- | --- | --- | --- | --- |
| 2,000,000 | off | 296.0 ms | 70.6 ms | 5.30 -> 7.22 | 300 of 300 identical |
| 2,000,000 | on | 259.9 ms | 39.8 ms | 5.96 -> 5.48 | 300 of 300 identical |
| 100,000 | off | 196.4 ms | 58.6 ms | 11.61 -> 16.04 (invalid by 6C's rule; the machine was saturated) | 300 of 300 identical |
| 100,000 | on | 288.6 ms | 78.8 ms | 18.47 -> 20.10 (invalid) | 300 of 300 identical |

Candidates p50 / p95, cap, out of reach and truncated are the same in every round (182 / 981, 6, 19,
21 at 2,000,000; 87 / 555, 4, 3, 7 at 100,000). The 100,000-name pair ran at loads over 11 while the
other Stage 2 agents' suites ran and says nothing about time; its digests do. The share is
`calibration-matcher-11d`'s.

## 3. `rescreen-bound-memo` (C271.2; rescreen-6d item 9(a), 6D review amendment 5)

**What:** `nameScoreUpperBound(subject, list, matching, groups, memo?)` takes an optional
`TokenPairMemo` (`createTokenPairMemo(limit = TOKEN_PAIR_MEMO_LIMIT = 1,000,000)`, in
`packages/watchlist/src/score/name-score.ts`); the re-screen (`apps/api/src/jobs/reports/rescreen.ts`)
makes one per re-screen when `rescreen-bound-memo` is on and passes it to every name-bound check
(`mayMatch`). The memo keeps:
- each single-unit **token pair score**, keyed by the variant groups, the matching, whether the
  subject name has one word, the subject token's content (simple, expanded, original, script,
  reliability, role, type: everything `pairScore` reads of a single unit) and the list token by
  identity (a list name's analysis lives through the re-screen); joined units are never kept; with
  `token-pairs` on, the subject unit keeps the score too, so the screening that follows reads it;
- each **name pair's bound**, keyed by the subject name's tokens' content in order and the list
  name by identity, so a subject of a name another subject met is not bounded again.
Both share one size; when a pair would pass the limit the memo starts again (bounded memory). The
scorer counts the bounds it computes (`scorerWork().bounds`, a new member). Exact presets return
before the memo, as before.

Commits: stub `496dc8487` (`chore`, rule 5); RED `8ba8d9aa0` (watchlist) and `d1470e4f9` (api);
GREEN `1abc65dfe`; the bounds counter stub `531f568e8`; RED `6f92a3643`; GREEN `24a86813f`;
refactor `7d3b3a60d` (with the memo the bound reads it directly, without the name pair's matrix it
would ask each pair of once).

RED, `packages/watchlist/src/score/name-score-bound.test.ts` (persons 23 x 23 and companies 6 x 6 at
`exact`, `strict`, `tolerant` and a custom preset; the names analysed again for each pass):

```
$ (cd packages/watchlist && pnpm exec vitest run src/score/name-score-bound.test.ts --coverage.enabled=false)
     × gives every pair the same bound at every preset, persons and companies, and scores a token pair once across subjects 67ms
     × holds at most its limit of token pairs, starting again when full, with the same bounds 40ms
AssertionError: expected 0 to be greater than 0          # memo.size: the stub keeps nothing
      Tests  2 failed | 9 passed (11)
```

RED, `apps/api/src/jobs/reports/rescreen-levers.test.ts` (new: PGlite, a seeded synthetic list of 40
persons and 10 companies with variant groups over its given names, two sandbox environments of
recurring reports at `tolerant`, `strict` and `exact` and a business type, chunks of 9; the changed
sync adds namesakes, variant spellings, family-name sharers and strangers):

```
$ (cd apps/api && pnpm exec vitest run src/jobs/reports/rescreen-levers.test.ts --coverage.enabled=false)
     × rescreen-bound-memo is off by default, and on, inserts the same runs, finds and screens the same, and scores fewer token pairs 1170ms
AssertionError: expected 965 to be less than 965
      Tests  1 failed (1)
```

A first GREEN keyed both tokens by identity and failed (594 token pairs scored again for subjects
analysed apart: particles, suffixes and legal forms are copies, not the cached token), and then
scored more pairs than the switch off (1,326 against 965: the screening no longer found the bound's
pairs on the subject unit); both were fixed before the commit (content key for the subject token;
the subject unit keeps the pair too).

GREEN:

```
$ (cd packages/watchlist && pnpm exec vitest run src/score/ src/match/ --coverage.enabled=false)
      Tests  201 passed (201)
$ (cd apps/api && pnpm exec vitest run src/jobs/reports/rescreen-levers.test.ts src/jobs/reports/rescreen-work.test.ts src/jobs/reports/rescreen.test.ts src/jobs/reports/rescreen-coverage.test.ts src/jobs/reports/rescreen-frequency.test.ts --coverage.enabled=false)
      Tests  21 passed (21)
$ pnpm --filter @openverify/watchlist benchmark:typecheck   # exit 0
$ pnpm --filter @openverify/watchlist benchmark:test        # 129 passed, exit 0
```

The second RED (`6f92a3643`): a subject of the same name meets the kept bound (`scorerWork().bounds`
0 on the third pass), and a name differing only in a token, its role or its order never gets
another's bound:

```
     × gives every pair the same bound at every preset, persons and companies, and scores a token pair, and bounds a name pair, once across subjects 59ms
AssertionError: expected 1695 to be +0 // Object.is equality
      Tests  1 failed | 11 passed (12)
```

GREEN `24a86813f`: `src/score/ src/match/` 201 passed; the re-screen tests 8 passed.

**Upgrade path:** none; memory only, per re-screen.

**Development figures (context; the 100,000-name database restored from my own template before each
take, `rescreen-1000`):**

| Take | Switch | Re-screen | Screen phase | Bounds computed | Token pair scores | Loads (start -> end) |
| --- | --- | --- | --- | --- | --- | --- |
| rsm-off | off | 66.2 s | 28.6 s | | | 6.37 -> 5.48 |
| rsm-on (token pairs only) | on | 70.3 s | 28.7 s | | | 6.60 -> 6.70 |
| off3 | off | 92.4 s | 40.8 s | 2,499,993 | 5,941,900 | 15.74 -> 12.93 |
| on3 (token and name pairs) | on | 89.0 s | 39.7 s | 2,288,593 | 3,403,562 | 15.84 -> 14.10 |

Every take inserted the same 5,092 runs over 1,263,731 candidate pairs and 103,378 screenings. The
work counters say what the memo can save on this table: 43% of the token pair scores, but only 8.5%
of the bounds (subjects rarely share a full name), so on this seed it moves the screen phase by
about a second, inside this machine's noise at these loads. Kept or reverted by the calibration's
share rule.

## 4. The share wiring in the benchmark (named borrowed edit, after `matcher-write-11d` checkpoint 1)

`matcher-write-11d` made `<scale>-shares --switch <name>` take every Phase 11 switch (its
`86879a095`, `switchOf`), which measures `retrieval-reach` (and `stored-name-analysis`, were it built)
on the screening step. The re-screen levers are measured on the re-screen step, so `rescreen-<n>`
now takes `--switch <name>`: `switchOf` checks the name before the step does anything, the switch is
on for that one re-screen (`processReportRescreen`) and off again after, and the record carries
`"switch": "<name>"` (or `null`). Each re-screen take has its own database, so the calibration
alternates `rescreen-1000` takes with and without `--switch rescreen-bound-memo` on fresh databases.

RED (`25e74199c`), `packages/watchlist/scripts/benchmark-rescreen-switch.test.mjs` (runs the CLI as
its package script does, with a size the step refuses, so no container starts):

```
$ (cd packages/watchlist && pnpm exec vitest run --config scripts/benchmark-vitest.config.mjs scripts/benchmark-rescreen-switch.test.mjs --coverage.enabled=false)
     × refuses an unknown switch before the step, and lets a known one through to it 12600ms
AssertionError: expected 'file:///home/mhnoor/persona-opensourc…' to contain '--switch is one of'
+ Error: the re-screen sizes are 100, 300, 1000, 3000
      Tests  1 failed (1)
```

GREEN (`fcf5b7d3f`, committed at once on a clean file): the test passes; `benchmark:typecheck` exit
0; `benchmark:test` 130 passed at 99.07% lines, exit 0.

## 5. Levers not built, with the reason

- **`stored-name-analysis`** (6D amendment 11(b)). The profile supports it at 2,000,000 names: the
  list names' uncached analysis is 3.4 s of the 13.4 s `screenCandidates` takes in a round (about a
  third of the scoring; section 1), and none at 100,000 names, where the analysed-name cache holds
  the table's names. It is not built in this Workflow. Its writes are borrowed edits of
  `matcher-write-11d`'s `sync.ts` (after its checkpoint 3) and `rekey.ts` (after its checkpoint 2),
  neither landed when this agent finished; it also needs 11D's migration 0037 (free, `8f22439aa`),
  `records.ts`, `watchlists.ts`, `loadEntries`' columns (`watchlist-rows.ts`, a file no 11D list
  names) and the analysed-name cache seeded from a stored form that equals a fresh analysis by test.
  One design point found here for whoever builds it: the scorer's `token-pairs` and the new memo key
  list tokens by identity, so a stored analysis must be revived through the token cache
  (`nameToken(raw, role, type)`), not as plain objects, or the scoring loses those memos; and the
  revived form must be cheaper than the analysis it replaces (the entries' `data` JSON is already
  1.8 s of a 2,000,000-name round in `parseRow`).
- **`rescreen-prepared-index`** (rescreen-6d item 9(c)). The fixed part on this seed is about 29 s of
  65 s (subjects 8.1, specs 6.8, prepare 8.3, build 5.7 s). A prepared index kept between
  re-screens never shows in the benchmark's one-process-per-step re-screen, and needs an
  invalidation rule (reports created, changed or deleted between syncs) that a no-miss test must
  hold; worker threads per chunk (four chunks of 50,000) need the subjects decrypted per thread.
  Neither is built here; both are carried with these figures.

## 6. The gates of what this agent touched (rule 22; beside other agents, loads 12 to 40)

| Gate | Command | Result | Time, loads |
| --- | --- | --- | --- |
| watchlist unit | `(cd packages/watchlist && bash /tmp/openverify-heavy.sh pnpm exec vitest run --coverage --coverage.reportsDirectory=<dir>/coverage-watchlist)` | exit 0, 836 tests in 70 files, 98.64% lines | 616 s, 18.8 -> 20.7 |
| db unit | the same from `packages/db` | exit 0, 2,390 tests in 167 files, 90% lines | 244 s, 17.7 -> 15.6 |
| API unit | 12 blob shards and a merge (rule 8, K = 12) | shards 155-284 s each (each exits 1 on partial coverage, as expected); merge exit **1**: 10,937 of 10,938 passed in 866 files, 92.93% lines, 83.7% branches; the one failure is `src/services/list-writes.test.ts` "services/lists/item-writer.ts: its callers stage" on `seed/load/lists.ts` (`load-harness`'s `18e29b3e5`), not this agent's paths; it fails alone too | merge 137 s, loads 12.5 -> 22.9 |
| benchmark | `pnpm --filter @openverify/watchlist benchmark:typecheck` and `benchmark:test` | exit 0 and exit 0 (130 passed, 99.07%) | |
| format | `pnpm format:check` | exit 0 | 275 s |
| typecheck and lint | `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run typecheck lint --force --filter=<pkg>` for `@openverify/db`, `@openverify/watchlist`, `@openverify/api` (heavy slots) | exit 0 each (2 of 2 tasks each) | 312, 85, 672 s |
| integration db | `pnpm --filter @openverify/db test:integration` | exit 0, 110 tests | 249 s, 15.2 -> 40.2 |
| integration graph | `(cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts --project graph)` | exit 0, 13 tests (template 51.4 s of its 180 s guard) | 93 s |
| integration api | the same with `--project api --shard=<i>/3` | exit 0, 121, 139 and 196 tests; the C78.7 gate's machine-independent checks pass (`case=shipped-variant-groups`, candidates 99/630, cap 0/300, unreachable 1/300, listed found 150/150; its timing printed at load about 30, not a figure) | 229, 364, 211 s |

## 7. For `calibration-matcher-11d`

Every switch is off by default (`packages/db/src/repositories/watchlist-switches.ts`); none changes a
C78.4 constant, threshold, preset, cap, `keys/` or `KEYS_VERSION`, and none stores data, so no
upgrade step and no operator command follows any of them.

| Switch | Targets | Measured with (from `<tree>/packages/watchlist`, under the e2e lock) | Identity evidence |
| --- | --- | --- | --- |
| `retrieval-reach` | C78.7 retrieval, the cap-reaching and many-key searches at 2,000,000 names (and 100,000) | `pnpm -s benchmark:performance --seed <seed> --out <run>/performance --namespace <ns> --step 2m-shares --switch retrieval-reach` (and `100k-shares`) | `watchlist-reads.test.ts` (three seeded tables, 72 searches); development rounds 300 of 300 digests identical at both scales |
| `rescreen-bound-memo` | the re-screen's screen phase (the name-bound check) at 1,000 entries and 200,000 subjects | `... --step rescreen-1000 --switch rescreen-bound-memo` alternating with `... --step rescreen-1000`, each take on its own fresh database (`100k-import`, `rescreen-seed`), as 6D's re-screen takes | `name-score-bound.test.ts` (every preset, persons and companies), `rescreen-levers.test.ts` (same runs, counts and screenings); development takes 5,092 runs each |

`stored-name-analysis` and `rescreen-prepared-index` are not built (section 5): their switches stay
in the registry, off, and do nothing.

CHECKPOINT 1: the commit whose subject contains "Workflow 11D matcher-c787-11d checkpoint 1" (this
section's commit); its gate is section 6.
