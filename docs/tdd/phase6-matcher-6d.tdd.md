# Phase 6, Workflow 6D: `matcher-6d` (owner decision 3 after Workflow 6C)

Owner decision 3 after Workflow 6C: profile the screening at both scales on development tables from a fresh development seed, then remove repeated work, every created match identical, each change switchable so `calibration-6d` can measure its share. No C78.4 constant, threshold, preset or cap changes; retrieval stays as 6C built it.

Every number here is a development number, on tables this agent generated from its own seed, never on held-out data (rule 11). `calibration-6d` decides.

## Development data

- **Seed:** `4c6eb06e18c08fe1161ec09c048d822f`, drawn with `openssl rand -hex 16` (OpenSSL 3.0.13) at 2026-10-29T14:22:29Z.
- **Tables:** the committed benchmark's own steps, from a base worktree at the 6D launch commit (`/tmp/m6d-base`, `9882aee3`), namespace `matcher6d`:
  - `benchmark:performance --seed <seed> --namespace matcher6d --step 100k-import`: 60,755 entries, 100,000 names, file SHA-256 `c6f10367c978db6ccf568c3cf58735bec631371d3ae006eefc42a29c43d4407c`, sync 58.8 s;
  - `--step 2m-import --part 1` to `--part 8`, each part one lock hold.
- **Driver:** a scratch script outside git (`<scratchpad>/matcher-6d/m6d-bench.mjs`, run by `run.sh <tree> <step>`), which calls only the committed benchmark helpers (`benchmark-tables.mjs`, `benchmark-postgres.mjs`, `benchmark-metrics.mjs`), the `watchlist` job through `screenOnce`, and `useScreeningShortcuts`. Its pool parses the rigour file with `parseRigourPersonNames` (`keys/`), never the held-out folder; its 100,000-name table has the import's digest (`c6f10367…407c`), so its subjects are the benchmark's. Steps:
  - `measure`: 20 warm-ups, then one round of the benchmark's 300 subjects (150 listed, 150 unlisted), with the phase split;
  - `profile`: the round's slowest subjects screened again under the inspector's CPU profiler;
  - `census`: the round's candidates grouped by every field `screenEntry` reads;
  - `digest`: every subject at `exact`, `strict` and `tolerant`, with a SHA-256 of the full created matches.

## Baseline and profile (before any change)

### 100,000 names, at the base

`flock /tmp/openverify-e2e.lock run.sh /tmp/m6d-base measure --scale 100k` (load 2.34 → 3.64):

| p50 | p95 | p99 | p95 state / retrieval / loads / the rest | Candidates p50 / p95 | Listed found | Truncated (cap, out of reach) | `result_truncated` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 17.8 ms | 87.1 ms | 145.4 ms | 3.2 / 15.3 / 19.3 / 50.8 ms | 79 / 538 | 150 of 150 | 4 (2, 2) | 0 |

**Profile** (`profile --top 30 --reps 3`: the 30 slowest subjects, three times, 200 µs sampling; load 4.75 → 4.75): 14.3 s of samples, 2.9 s of them idle (waiting on Postgres).
- `screenCandidates` 6.95 s (49%), nearly all in `screenEntry` (6.87 s):
  - `scoreNamePairAbove` 5.52 s: **the upper bound 3.52 s**, the exact alignments (`scoreWith`) 1.77 s;
  - inside the bound, the joined-token tests: building a joined unit for every adjacent pair of both names on every pair bounded (`joinable` → `joinedUnit`, 0.89 s with its variant-group lookups), and `mayPair`'s length test (0.96 s), which counts code points with `Array.from` up to eight times a call (`lengthOf` 0.83 s of self time);
  - `pairScore` 1.12 s, of which the typo budget's code-point counts;
  - list-name analysis (`analyseRecordName`) 0.98 s: 0.56 s of self time in the cache's key and LRU bookkeeping, 0.42 s of misses (the cache holds 50,000 names, the table 100,000).
- Loads: `pg` row parsing 0.87 s (the records' JSON) and drizzle building the statements' parameter lists 0.54 s (`loadEntries` binds one parameter per id).
- Garbage collection 1.0 s.

**Census of namesakes** (`census --top 300`, every subject): 51,988 candidates fall into 51,974 groups sharing every field `screenEntry` reads (names with their parts, quality and primary flag; kind; birth dates; countries; gender; identifiers; positions; relations; `relative_of_class`). 14 candidates (0.03%) share a group; by names alone there are 48,668 groups. Of 87,662 strong names met, 76,914 are distinct within their screening, and the pair memo already scores the others once.

## Slice 1: the bound's joined units and code-point lengths (`unit-lengths`, `join-cache`)

The profile puts half of the scoring in the bound, and most of that in work repeated for every pair: each joined unit rebuilt, each length counted again.

**Stub** (`3e48babf`, `chore`): `SCREENING_SHORTCUTS` gains `unit-lengths` and `join-cache`, which switch nothing yet; `ScorerWork` counts `joinedUnits` and `codePointCounts`.

**RED:** `shortcuts.test.ts` gains one test per switch: with every cache warmed first, a pass with the switch on does less of the work it names than a pass with it off, for the same created matches. `name-score-bound.test.ts` gains a guard: the bound and the score of every pair of its names, at every preset, are the same with either switch off (it passes on the stub, as a characterization).

```
$ pnpm --filter @openverify/watchlist exec vitest run src/match/shortcuts.test.ts src/score/name-score-bound.test.ts --coverage.enabled=false -t "with unit-lengths|with join-cache|scorer shortcuts of owner decision 3"
 × with unit-lengths, count the code points of each unit form once, for the same matches
 × with join-cache, build each name's joined units once, for the same matches
AssertionError: expected 4050674 to be less than 4050674
AssertionError: expected 130731 to be less than 130731
 Tests  2 failed | 1 passed | 46 skipped (49)
```

A first version compared the off pass with an on pass that ran second, and `unit-lengths` passed on the stub because the second pass found the unit cache warm; the test now warms every cache first.

**GREEN** (`6505f87b`, `perf`): every unit carries `lengths` (code points of `simple`, `expanded` and `original`, counted once when the unit is built); with `unit-lengths` on, the typo budget, the initials test and `mayPair` read them, and a typo check whose forms are more than one code point apart never asks `withinOneEdit` (which refuses them anyway). With `join-cache` on, `cachedJoinsOf(name, singles, groups)` keeps a name's joined units in a `WeakMap` by variant groups and analysed name, as the unit cache keeps its singles; the bound and `usefulJoins` read them, and with the cache off they build each one as before.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/match/shortcuts.test.ts src/score/name-score-bound.test.ts --coverage.enabled=false -t "with unit-lengths|with join-cache|scorer shortcuts of owner decision 3"
      Tests  3 passed | 46 skipped (49)
$ pnpm --filter @openverify/watchlist exec vitest run src/score src/match src/names src/keys --coverage.enabled=false
 Test Files  17 passed (17)
      Tests  175 passed (175)
```

The 175 include `shortcuts.test.ts`'s equivalence tests, now 36: each of the eight switches alone and all together, at `exact`, `strict`, `tolerant` and `custom`, against the baseline with every switch off.

**Measured** (`ab --off unit-lengths,join-cache --reps 4`, head worktree at `6505f87b`, 100,000 names: four pairs of rounds alternating the two switches on and off in one process and one lock hold, loads 3.8 to 4.6; medians of the four rounds each):

| Switches | p50 | p95 | p95 of the rest | Sum of the rest (300 screenings) | Kept matches |
| --- | --- | --- | --- | --- | --- |
| both off | 16.7 ms | 88.6 ms | 50.6 ms | 4,023 ms | 547 |
| both on | 14.0 ms | 63.5 ms | 25.8 ms | 2,199 ms | 547 |

## Slice 2: the loader binds two arrays (`array-parameters`, a read shortcut)

The profile gave 0.54 s of the 100,000-name sample to drizzle building `loadEntries`' parameter lists: two per candidate, 500 candidates to a statement, so a screening of 869 candidates binds 1,738 parameters in two statements. Reads cannot use the matcher's switches (`@openverify/db` does not depend on `@openverify/watchlist`), so `watchlist-reads.ts` gets the equivalent: `WATCHLIST_READ_SHORTCUTS` (`array-parameters`) and `useWatchlistReadShortcuts(switches)`, exported through the repositories' index as everything in that file is.

**Stub** (`a21b2dac`, `chore`): the switch, reading nothing.

**RED** (`1b19c6f5`): `watchlist-reads.test.ts` loads 1,200 candidates (one sandbox entry, the list's entries and ids it does not hold) with the switch off and on, recording each statement's bound parameters; the records must be equal, off binds `[1000, 1000, 400]`, on binds `[2]`.

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/watchlist-reads.test.ts --coverage.enabled=false -t "binds the candidates"
 × binds the candidates as two text[] parameters, one statement for 1,200 of them, with the same records (owner decision 3 after 6C)
AssertionError: expected [ 1000, 1000, 400 ] to deeply equal [ 2 ]
      Tests  1 failed | 19 skipped (20)
```

**GREEN** (`5e80dffe`, `perf`): with the switch on (the default), each statement binds `sql.param(sourceIds)::text[]` and `sql.param(entryIds)::text[]`, as `rescreen-6d`'s key frequencies do, 5,000 candidates to a statement (`ARRAY_BATCH`); off, the old per-id lists, 500 to a statement. The statement text is otherwise unchanged.

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/watchlist-reads.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

## Slice 3: one score per token pair per screening (`token-memo`)

**Profile after slice 1** (head worktree at `6505f87b`, same 30 subjects, three times; load 7.9 → 6.6): 9.7 s of samples against 14.3 s at the base. `screenCandidates` 3.73 s (from 6.95 s): the bound 1.67 s, its token-pair loop 0.77 s (pair scores 0.71 s and the shared matrix's maps), the alignments 0.88 s, list-name analysis 0.77 s (0.43 s on cache hits, 0.34 s on misses). The pair memo scores a list *name* once per screening, but a common *token* (a given or family name of the Zipf head) sits in hundreds of distinct list names, and the shared matrix keeps a token pair only for one name pair.

**Stub** (`f826499b`, `chore`): `token-memo` in `SCREENING_SHORTCUTS`; `tokenPairMemo()` makes an opaque memo, `screenCandidates` makes one per screening while the switch is on and passes it through `bestPair` to `scoreNamePairAbove` (`ScoreAboveOptions.tokens`), which reads nothing of it yet.

**RED** (`32eddd2e`): a third row of slice 1's test: with `token-memo`, fewer token pair scores for the same created matches.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/match/shortcuts.test.ts --coverage.enabled=false -t "with token-memo"
 × with token-memo, score a token pair once per screening, whatever names hold it, for the same matches
AssertionError: expected 243902 to be less than 243902
      Tests  1 failed | 50 skipped (51)
```

**GREEN** (`e98496b8`, `perf`): the pairing of a name pair reads the memo when it has one. `pairScore` reads only a unit's content (its forms and their lengths, script, reliability, type, initial flag, joined flag and variant groups) and the context (the matching, and whether the subject name is one word), so a score is kept under the matching, `singleWordSubject` with the subject unit's content, and the list unit's content (`contentOf`, a JSON array made once per unit). Weights, unmatched tokens and the alignment are not memoised. A guard in `name-score-bound.test.ts`: one memo shared by every pair of its names, at every preset and at floors 0, 0.7 and 0.85, gives each pair the same answer as no memo.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/score src/match --coverage.enabled=false
 Test Files  10 passed (10)
      Tests  115 passed (115)
```

**Measured at 100,000 names, and a fix** (`ab --off token-memo`):
- At `e98496b8` (loads 5.1 to 7.6 for the first two pairs; the machine then went to 42 under other agents' suites, and those rounds are discarded): the memo made screening *slower*, rest sums 4,369 and 2,840 ms with it against 2,375 and 2,183 ms without. Each pair call built a new string key (`singleWordSubject` and the subject unit's content) and hashed it, which cost more than the pair scores it saved.
- **Fix** (`68c4d670`, `perf`): the rows are kept by the subject unit itself (a subject unit belongs to one subject name, as the shared matrix assumes), under the matching and `singleWordSubject`; only the list side is keyed, by its content string made once per unit. The tests above pass unchanged.
- At `68c4d670` (`timed.sh`: inside the lock, wait for a 1-minute load under 3, at most 300 s; three pairs, loads 2.8 to 5.3): rest sums 2,081 and 2,104 ms with the memo (its first round, cold, 3,587 ms) against 1,937, 1,952 and 2,010 ms without; p95 of the rest 26.3 against 24.0 ms. **At 100,000 names the memo does not pay**: after `unit-lengths` a pair score costs about what the memo's lookups cost. Whether it stays is decided at 2,000,000 names, where a common token sits in many more names.

## Slice 4: the analysed-name cache without a JSON key (`name-cache`)

The profile gave 0.43 s of the 100,000-name sample to cache hits, whose key is `JSON.stringify([kind, full, parts])`, built and hashed on every lookup, then deleted and set again for the LRU order. A microbenchmark (`micro-analyse.mjs`: 32,963 names of the 100,000-name table, each looked up five times, all cached) gave 2.18 µs a hit (0.76 µs of it the key) and 8.06 µs a miss.

**Characterization first** (`e8c2cbbf`, `test`): `analyse.test.ts` pins the cache's contract before the key changes: one analysis per kind, full name and parts, whichever objects carry them (equal copies hit; swapped roles, no parts, fewer parts or another kind each get their own analysis), and the least recently used name is forgotten when the cache is full (a hit refreshes it), and a size of 0 keeps none. They pass on the old cache (15 tests).

**Refactor** (`48de21ca`): the cache is a `Map` from the full name to the analyses made from it, each with its kind and parts; a lookup compares the kind and each part's role and value (the record schema's parts are strict `{ role, value }` objects, and the analysis reads nothing else of a name). The LRU order is by full name. A hit then builds no key: 1.74 µs to 0.99 µs a hit in the same microbenchmark (head worktree against the change, load 4.1). The 73 tests of `src/names` and `shortcuts.test.ts` pass.

**Memory** (`micro-memory.mjs`: 120,000 names of each table screened once with every cache on and room for all of them): a cached name keeps about 2 KB (1,949 bytes at the 2,000,000-name profile, 2,203 at the 100,000-name one) with its units, joined units and content keys, so the default of 50,000 names holds about 100 MB, not the 50 MB its comment said; the comment now says so.

## Resumed run (2026-10-29, after the re-login)

The same seed, tables and containers (`evaluation-6-100k-matcher6d`, `evaluation-6-2m-matcher6d`); the head worktree `/tmp/m6d-head` moved to each commit before it was measured. Loads are the 1-minute averages at the start and end of each step. The driver gained a `work` step (the scorer's and the cache's work counters for the round's slowest subjects) and a CPU time per A/B round (`process.cpuUsage`), because other agents' suites kept the machine at loads of 5 to 17 for much of the afternoon.

### The profile at 2,000,000 names, at the base and at `42895e6a`

- **Base** (`9882aee3`, `measure --scale 2m`, load 2.49 → 3.51): p50 66.6, p95 534.8, p99 915.1 ms; p95 state 4.0, retrieval 56.2, loads 47.2, the rest 392.7 ms; candidates p50 149, p95 1,053; 150 of 150 listed found; truncated 17 (cap 9, out of reach 16); `result_truncated` 2. Profile (`--top 30 --reps 2`, load 2.66 → 3.05): 35.9 s of samples, 6.6 s idle; `screenEntry` 23.0 s inclusive; `analyseRecordName` 2.5 s of self time, `lengthOf` 2.2 s, the two `groupsOf` 2.8 s.
- **`42895e6a`** (load 4.38 → 3.38): 30.8 s of samples, 6.2 s idle; `screenEntries` 19.2 s. Line-level ticks (`positionTicks`, mapped to the loader's transformed sources through the inspector) put **3.9 s, the largest single cost, on one line: `analysedNames.entries().next()` in the cache's `forgetOldest`**, inlined into `screenEntry`; 0.84 s more on the hit path's `delete` and `set`. A V8 `Map` keeps deleted slots until it is rehashed, and an LRU that deletes from the front and re-sets on every hit leaves a run of them there, which every eviction reads past: a cost that grows with every name forgotten. At 2,000,000 names nearly every list name is a miss, so every miss evicts one. A microbenchmark (`lru.mjs`, 400,000 keys through 50,000 slots) gave 10.0 s in the map's order and 0.15 s with a linked list. The rest: three `WeakMap.set` per new name (units, joins, content keys: 1.2 s), `JSON.stringify` of `token-memo`'s content keys (0.5 s), the variant-group lookups and their temporary lists (1.7 s), token making (`nameToken` 1.0 s), the bound's loops and the alignments.

## Slice 5: the analysed-name cache's order in a list of its own (`name-lru`)

**Stub** (`8dcfc531`, `chore`): `name-lru` in `SCREENING_SHORTCUTS`; `setAnalysedNameCacheOrder(linked)`, switching nothing; `analysedNameCacheWork()` counts hits and map writes.

**RED** (`0c21646d`): the two cache tests of slice 4 run under both orders (they pass on the stub, as characterization), and a new test: with `name-lru`, a hit writes nothing to the map, and making room writes one set and one delete.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/names/analyse.test.ts --coverage.enabled=false
     × writes nothing to its map on a hit, and one set and one delete to make room for a name 18ms
AssertionError: expected { hits: 2, mapWrites: 4 } to deeply equal { hits: 2, mapWrites: +0 }
      Tests  1 failed | 17 passed (18)
```

**GREEN** (`d723ba69`, `perf`): each full name's entry carries its older and newer neighbours; a hit moves it to the newest end without touching the map, an eviction unlinks the oldest and deletes it. Without the switch, the map's insertion order as before (a hit deletes and re-sets). Switching empties the cache.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/names src/match src/score --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  144 passed (144)
```

**Measured:** `micro-lru.mjs` (400,000 names of the 2,000,000-name table through a full cache of 50,000, load 3.45): 41.1 and 41.0 µs a name in the map's order, 10.3 and 9.0 µs linked, the same 70,897 hits. `ab --scale 2m --off name-lru --reps 2` (loads 3.4 to 7.6): rest sums 23.3 and 18.8 s on, 31.6 and 30.3 s off; p95 425.6 and 402.7 against 510.4 and 501.8 ms; 11,009 matches kept in every round.

## Slice 6: the units without temporary lists, one cache slot per name (refactor)

**Refactor** (`a84158cf`), every output the same and the work counters unchanged, so no switch:
- a unit's variant groups are read form by form (the expanded form only when it differs from the simplified one), and one form's groups are the variant groups' own list; a list is built only when a second form adds a group. A scratch check (`check-groups.mjs`) compared the new and the old function on 1,146,158 forms (every token and adjacent pair of 40,000 entries of the 2,000,000-name table, and the rigour groups' own forms): 476,549 with groups, 136,480 with more than one, 0 different;
- the content key (then `token-memo`'s) is kept on the unit, not in a `WeakMap`;
- a name's single and joined units share one slot, so a name new to the process costs one `WeakMap` entry, not three.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/score src/match src/names --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  144 passed (144)
```

## Slice 7: a written token made once (`token-cache`)

**Stub** (`203341b7`, `chore`): `token-cache`, `NAME_TOKEN_CACHE_SIZE` (100,000 written forms), `nameTokenWork()` counting the tokens made, switching nothing.

**RED** (`913b1520`):

```
$ pnpm --filter @openverify/watchlist exec vitest run src/names/analyse.test.ts --coverage.enabled=false
     × makes a written token once per role and type while it is kept, and each time with the cache off 10ms
     × empties itself when it is full 45ms
AssertionError: expected { simple: 'mirelda', …(6) } to be { simple: 'mirelda', …(6) } // Object.is equality
      Tests  2 failed | 18 passed (20)
```

**GREEN** (`5c6421a2`, `perf`): `nameToken` keeps the tokens it made by written form, one per role and type, and empties the map when it holds 100,000 forms; with the switch off, or on a miss, it makes one as before. No caller changes a token (they spread one into a new object), and every kept token equals one made afresh (the test asserts it).

```
$ pnpm --filter @openverify/watchlist exec vitest run src/names src/match src/score src/keys src/reverse-index --coverage.enabled=false
 Test Files  20 passed (20)
      Tests  207 passed (207)
```

**Measured:** `micro-lru.mjs` with the token cache off and on (load 4.56 → 3.85): 10.50 and 10.15 µs a name off, 8.88 and 8.20 µs on. `ab --scale 2m --off token-cache --reps 2` (loads 2.73 to 3.21): rest sums 14.6 and 14.9 s on, 15.9 and 16.0 s off; CPU 22.6 and 22.7 s on, 23.5 and 23.5 s off; p95 349.2 and 344.1 against 353.6 and 362.2 ms.

## Slice 8: `token-memo` dropped

`ab --scale 2m --off token-memo --reps 2`, after slices 5 and 6 (loads 2.88 to 6.56, CPU time per round): 24.1 and 25.4 s with the memo, 24.6 and 24.0 s without; rest sums 15.6 and 17.2 against 16.8 and 16.6 s. With slice 3's 100,000-name result (no gain), the memo saves nothing at either scale: its lookups cost what the pair scores do. **Refactor** (`1d1478d7`): the switch, its plumbing through `screenCandidates`, `bestPair` and `scoreNamePairAbove`, its row in `shortcuts.test.ts` and its guard in `name-score-bound.test.ts` are removed; `shortcuts.ts` says why.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/score src/match src/names --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  148 passed (148)
```

## Slice 9: a name pair's token pair scores in one array (`indexed-matrix`)

**Stub** (`f31221d0`, `chore`): `indexed-matrix`; `ScorerWork.matrixMaps` counts the maps the shared matrix makes.

**RED** (`66f67675`): a row of slice 1's test (fewer matrix maps for the same matches) and a guard (every pair's bound decision and score the same with the switch off, at floors 0 to 0.9, strict or not).

```
$ pnpm --filter @openverify/watchlist exec vitest run src/score/name-score-bound.test.ts src/match/shortcuts.test.ts --coverage.enabled=false -t "indexed"
     × with indexed-matrix, keep a name pair's token pair scores in one array, no map, for the same matches 3045ms
AssertionError: expected 160547 to be less than 160547
      Tests  1 failed | 5 passed | 57 skipped (63)
```

**GREEN** (`bae20f2d`, `perf`): the table is one array with a row per subject place; a unit's place is its token, or the name's token count plus the first token it joins, so each unit of a name has its own place below twice the token count, and units at one place of one name have the same content.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/score src/match src/names src/keys src/reverse-index --coverage.enabled=false
 Test Files  20 passed (20)
      Tests  207 passed (207)
```

**Measured:** `ab --scale 2m --off indexed-matrix --reps 2` (loads 2.62 to 7.9): rest sums 14.0 and 15.1 s on, 14.5 and 15.1 s off; CPU 22.3 and 23.2 s on, 21.1 and 22.8 s off. Within the noise: a share for `calibration-6d` to measure, not a claim.

## Slice 10: refuse a pair whose best ratio cannot reach the floor (`ratio-check`)

**The `work` step on the slowest 2,000,000-name subjects** (at `bae20f2d`) showed where their time went: a subject with 1,203 candidates and 2 kept matches aligned 4,208 name pairs exactly, one with 971 candidates and none kept 2,996. Their bounds reached the floor (the bound takes every pairable token as matched at score 1), and their alignments did not.

**The check.** An alignment reaches a ratio of `floor` exactly when its pairs' values `w(s − floor) + floor(u_left + u_right)` sum to at least `floor` times every unit's unmatched weight: Dinkelbach's parametric form, which `bestRatioMatching` already maximises. Each unit's best positive value, summed over every unit of every choice of joins, bounds every alignment's sum (an alignment takes each unit once, and a choice's units are among them), and every choice's unmatched weights add up to its tokens' total. So a sum below that total by more than 1e-9 means every alignment, plain or as a subset, and the score it gives (the role swap only lowers it), is below `floor`, and the pair is refused as the bound refuses one: `scoreNamePairAbove` returns `null`, which its only caller (`bestPair`) treats as it treats a pair below the floor. (A name score below the floor never makes a created match: `display-floor` and `qualifier-floor` are both 0.70, `createdFloor` takes the best qualifier off the preset's minimum, and an entry an identifier or weak alias returns is scored again in full.) The pair memo keeps the floor a pair was refused at, and answers again only at that floor or above.

**Stub** (`e658b0e5`, `chore`): `ratio-check`; `ScorerWork.ratioExits`.

**RED** (`e7de5d50`): a row of slice 1's test (fewer alignments for the same matches) and the bound guard for the check off.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/score/name-score-bound.test.ts src/match/shortcuts.test.ts --coverage.enabled=false -t "ratio|indexed"
     × with ratio-check, align fewer name pairs whose best ratio cannot reach the floor, for the same matches 1560ms
AssertionError: expected 5247 to be less than 5247
      Tests  1 failed | 11 passed | 57 skipped (69)
```

**GREEN** (`95251b36`, `perf`). The guard written at RED compared `scoreNamePairAbove`'s raw answers, which now differ where the check refuses a pair the off pass scored below the floor; it now asserts what the screening relies on: every pair returned with the check on is returned with the same score with it off, and every pair it refuses scores below the floor (or is refused) with it off; and the check refuses more pairs.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/score src/match src/names src/keys src/reverse-index --coverage.enabled=false
     × gives every pair the same bound decision and score with the ratio check off 4091ms
AssertionError: expected [ …(16950) ] to deeply equal [ …(16950) ]
  (the guard's raw comparison, before it was corrected)
 Test Files  20 passed (20)
      Tests  213 passed (213)
```

**Measured:** the `work` step on the 12 slowest subjects at 2,000,000 names: alignments fall from 4,208 to 5 (1,203 candidates, 2 kept), 2,996 to 0 (971, 0 kept), 3,452 to 62 (1,023, 20 kept), 1,737 to 0 (2,000, 0 kept). Every created match is the same at the base and the head: `digest --scale 2m` (every subject at `exact`, `strict` and `tolerant`: 900 screenings, 29,241 matches, each line its kept entries, coverage, limits, errors and a SHA-256 of the full matches) gave `3e85a86a…1e63b` at both `9882aee3` and `95251b36`, and the two files are byte-identical. `measure --scale 2m` at `95251b36` (load 3.11 → 2.62): p95 313.3 ms (from 376.0 at `bae20f2d`, load 3.57 → 4.64), the rest's p95 202.7 ms.

## Slice 11: a subject unit's pair scores by list token (`token-pairs`)

**Stub** (`a759b40c`, `chore`): `token-pairs`; a single unit carries its token, and an empty memo.

**RED** (`ffcb37a7`) added a row of slice 1's test, which failed on the stub but for the wrong reason: the seeded list shares no token (236 tokens, 236 distinct), so no memo can hit. `e53a50fa` replaces it with a test on 40 entries whose names share five given names, some also written in the other order; on the stub (the head worktree at `ffcb37a7` with the new test copied in):

```
$ pnpm --filter @openverify/watchlist exec vitest run src/match/shortcuts.test.ts --coverage.enabled=false -t "token-pairs"
     × with token-pairs, score a subject unit against a list token once per screening, whatever names hold it, for the same matches 35ms
AssertionError: expected 988 to be less than 988
      Tests  1 failed | 4 passed | 69 skipped (69)
```

**GREEN** (`3676bf17`, `perf`): on a matrix miss, a single list unit's score with a subject unit is read from the subject unit's memo by the list unit's token (shared by `token-cache`) under the matching. `pairScore` reads only the units' forms, lengths, script, reliability, type, initial flag, joined flag and groups, all of a single unit determined by its token and the variant groups the subject unit was built with; the context's one-word flag is the subject unit's own name's.

```
$ pnpm --filter @openverify/watchlist exec vitest run src/match/shortcuts.test.ts --coverage.enabled=false -t "token-pairs"
      Tests  5 passed | 64 skipped (69)
```

**Measured:** `ab --scale 2m --off token-pairs --reps 2` (loads 2.4 to 3.36): rest sums 11.4 and 11.1 s on, 11.5 and 12.7 s off; p95 273.2 and 292.8 against 276.4 and 305.5 ms.

## What the profile did not support

- **Grouping namesake candidates.** `census --scale 2m --top 300` (every subject; load 1.85 → 5.71): 87,926 candidates fall into 87,922 groups sharing every field `screenEntry`, qualification and the PEP admission read; 4 candidates share a group. At 100,000 names 14 of 51,988 did (the baseline). The pair memo already scores a shared list name once, so grouping would save the analysis and building of 4 candidates in 87,926: not built.
- **`SET LOCAL jit = off` in `loadEntries`.** `explain-load.mjs` on the candidates of the five slowest 2,000,000-name subjects (2,000, 2,000, 778, 2,000 and 1,203 candidates): `EXPLAIN (ANALYZE)` reports no JIT (the plan's cost, about 1,380, is far below `jit_above_cost`), execution 7 to 26 ms with the server's setting and 12 to 25 ms with JIT off. Not changed.
- **`ANALYSED_NAME_CACHE_SIZE`.** `measure --scale 2m --cache 200000` against the default 50,000, one take each (loads 2.07 → 1.98 and 1.92 → 2.27): p95 283.4 against 286.7 ms, the rest's p95 161.1 against 179.5 ms, for four times the memory (about 2 KB a name). Kept at 50,000.

## Before and after (item 5): three takes at each scale, base and head

`measure` (20 warm-ups, then the benchmark's 300 subjects once, the shipped variant groups, the heavy-headed law), each take one lock hold, started after the 1-minute load fell below 3.5 (`timed.sh`). Base `9882aee3` (`/tmp/m6d-base`), head `3676bf17` (`/tmp/m6d-head`; later commits change no code). One head take at 100,000 names ended at load 5.44 while this agent's `@openverify/db` suite ran, and is replaced by a fourth.

| Scale | Tree | p95 of each take (loads start → end) | Median p95 | Median p50 | p95 state / retrieval / loads / the rest (median take) | Candidates p50 / p95 | Listed found | Truncated (cap, out of reach) | `result_truncated` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100,000 | base | 96.2 (2.58 → 2.71), 100.6 (2.99 → 3.17), 97.8 (2.99 → 3.27) | **97.8 ms** | 19.1 ms | 3.8 / 17.6 / 20.2 / 57.2 ms | 79 / 538 | 150 of 150 | 4 (2, 2) | 0 |
| 100,000 | head | 62.2 (3.31 → 3.13), 63.2 (3.24 → 3.46), 67.3 (2.82 → 2.78) | **63.2 ms** | 16.0 ms | 4.2 / 17.0 / 14.3 / 30.3 ms | 79 / 538 | 150 of 150 | 4 (2, 2) | 0 |
| 2,000,000 | base | 522.6 (3.85 → 3.47), 493.0 (3.73 → 2.73), 515.5 (2.79 → 3.06) | **515.5 ms** | 64.0 ms | 4.0 / 55.7 / 52.1 / 404.4 ms | 149 / 1,053 | 150 of 150 | 17 (9, 16) | 2 |
| 2,000,000 | head | 326.6 (3.47 → 3.69), 275.4 (3.16 → 3.21), 332.7 (2.02 → 3.17) | **326.6 ms** | 40.1 ms | 5.7 / 66.9 / 42.4 / 191.3 ms | 149 / 1,053 | 150 of 150 | 17 (9, 16) | 2 |

Every take kept the same matches (547 and 11,009). **Against decision 1's budgets: 100,000 names met on these tables (63.2 ms against 100 ms); 2,000,000 names missed by 76.6 ms (326.6 ms against 250 ms).** These are development numbers; `calibration-6d` decides.

**Why 2,000,000 names still misses** (the profile at `95251b36`, 30 slowest subjects twice, load 2.39 at the end): of 24.0 s of samples, 6.8 s idle (Postgres) and 10.1 s screening. In the screening: the bound 4.5 s (its token pair scores 1.9 s, now scored once per name pair or, with `token-pairs`, per list token), list-name analysis 2.7 s (nearly every list name is new to the process at this scale: 300,999 distinct strong names in 381,539 met over the 300 subjects, against a cache of 50,000), the alignments that remain 1.3 s, garbage collection 1.5 s; `pg` row parsing of the records 1.2 s. The p95 subjects are those with 800 to 2,000 candidates, and at the p95 retrieval and loads add about 100 ms on their own (retrieval stays as 6C built it, decision 3). Lowering the rest further needs list names analysed and unitised once, not once per process lifetime of the cache: a store of analyses beside the keys, which is a schema change (rule 12) and Phase 11's performance hardening.

## Final gates

All in the foreground at `6cceece3` (the code of `3676bf17`), 2026-10-29 18:00 to 18:45:

| Gate | Result |
| --- | --- |
| `pnpm --filter @openverify/watchlist test` | 66 files, 697 tests passed; coverage 98.64% statements, 89.86% branches, 99.13% functions, 98.62% lines |
| `pnpm --filter @openverify/db test` | 77 files, 1,011 tests passed; coverage 95.92 / 89.91 / 96.65 / 96.24% |
| `pnpm turbo run test --filter=!@openverify/api` | 13 of 13 tasks successful |
| API suite (`--shard=1/2` and `2/2` as blobs, then `--merge-reports --coverage`) | 323 files, 4,561 tests passed; coverage 96.42 / 88.55 / 98.12 / 96.45% |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | 14 of 14, 14 of 14, all files formatted |
| `pnpm --filter @openverify/db test:integration` | 12 files, 60 tests passed |
| `pnpm --filter @openverify/api test:integration` | 28 files, 159 tests passed; the gate printed `case=shipped-variant-groups … p95=122.9ms … cap-binds=0/300 unreachable=1/300 would-error=0/300 listed-found=150/150` (not under the lock, beside other suites: not a timing) |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` | 69 passed |
| e2e `--shard=1/3`, `2/3`, `3/3` (each built and run under the lock) | 31, 31 and 29 passed |
