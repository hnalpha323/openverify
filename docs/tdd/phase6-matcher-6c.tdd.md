# Phase 6, Workflow 6C: matcher-6c

Owner decisions 1, 2, 3, 4, 6, 13 and 19 after Workflow 6B, and the class filter of decision 9 (`docs/plans/phase-6.plan.md`, "Owner decisions after Workflow 6B" and "Workflow 6C"). Each slice went stub (where a new name was needed), then RED (run and seen failing for its reason), then GREEN. Commands ran after `source scripts/env.sh`; outputs are abbreviated.

The numbers here are **development numbers** on tables this agent generated from its own seed. They are not the calibration: `calibration-6c` measures base and head on a fresh seed and decides (C78.4). This agent never read `packages/watchlist/src/testing/held-out/` or any held-out output (rule 11).

## Development seed and tables

- **Seed:** `a362daebb975e71a3e330ffe86234816`, drawn with `openssl rand -hex 16` (OpenSSL 3.0.13) at 2026-10-28T17:34:42Z, on top of `94ab63f9` (Workflow 6C's base), before any matcher-6c change.
- **Tables:** the committed generator of the performance benchmark (`packages/watchlist/scripts/benchmark-tables.mjs`: `namePool` over the pinned rigour groups and 40,000 fictional names, Zipf exponent 1; `syntheticEntries` with the sanctions profile at 100,000 names, the PEP profile at 2,000,000), imported through `syncWatchlistSource` (`benchmark-postgres.mjs`' `importList`) into `openverify-sandbox`, and screened by the `watchlist` job's `screenNames` with the default `tolerant` configuration and the shipped variant groups (`screenOnce`, `timedReads`, `performanceSummary`). The seeds follow the benchmark's layout (`<seed>/pool`, `<seed>/100k`, `<seed>/2m`, `<seed>/100k/unlisted`, `<seed>/rescreen`).
- **The driver.** A scratch driver outside git (`dev-bench.mjs` in this agent's scratchpad) calls those committed helpers. It differs from `benchmark:performance` in three ways only:
  - its reusable containers are named `matcher-6c-100k` and `matcher-6c-2m`, so it never shares `evaluation-set-6c`'s `evaluation-6-*` containers, which that agent rebuilds during Stage 1;
  - it reads the rigour groups with this package's own `parseRigourPersonNames`, not the held-out folder's parser;
  - besides the benchmark's 150 listed and 150 unlisted subjects (timed in three rounds after 20 warm-ups), it screens 300 variant cases of listed entries once, by its own rules: 50 each of `order_swap`, `dropped_middle`, `added_middle` (a given name from the pool), `initials`, `typo` (one letter substituted, inserted or deleted in a family name of at least 5 letters) and `transposition` (two adjacent letters of the family name swapped), names only.
- **Base measurements** run in a worktree at `94ab63f9` (`/tmp/matcher-6c-base`, prepared with `pnpm install --frozen-lockfile --offline` and the `data/` files copied in), so other agents' work in progress never enters the base numbers. Head measurements re-key the same database with the head's code.
- Every timing ran under `flock /tmp/openverify-e2e.lock`, with the load average before and after.

## Baseline (base `94ab63f9`, development tables)

**100,000 names** (60,631 entries; sync 52.4 s, load 4.56 → 5.69):

| p50 | p95 | p99 | Round p95s | Phase p95 (state / retrieve / load / rest) | Candidates p50 / p95 | Cap binds | Would be `result_truncated` | Listed found | Unlisted alerted (round 1) | Load |
|---|---|---|---|---|---|---|---|---|---|---|
| 42.7 ms | **290.4 ms** | 722.6 ms | 253.1 / 297.9 / 279.0 | 3.0 / 81.1 / 54.6 / 129.9 | 183 / 1,242 | 3 of 300 | 1 of 300 | 150 of 150 | 31 of 150 | 5.64 → 5.48 |

Variant cases at 100,000 names (`tolerant`, names only; load 4.98 → 5.12): `order_swap` 50/50, `dropped_middle` 49/50, `added_middle` 50/50, `initials` 46/50, `typo` 43/50 (2 cut at the cap, 1 would be `result_truncated`), `transposition` 0/50.

Key frequencies at 100,000 names (counted over names, as the base does): 237,295 keys; the largest `t:` key is held by 8,216 names, `s:` by 8,606, `g:` by 8,988; the 2% limit is 1,915 names.

**Re-screen** (200,000 recurring `watchlist` reports seeded in 285 s; a sync adding 1,000 entries took 25.3 s): **185.4 s** at load 7.52 → 6.29, 12,956 `list_update` runs inserted.

## Slice 1: pair keys (owner decision 1)

**What.** Every strong list name stores `p:<atom>+<atom>` for every two keyed tokens, where a token's atoms are its `t:` forms (both folds, the original script) and its `g:` variant groups, so an order swap and a variant spelling of one token still meet. At most the first 6 keyed tokens pair (`MAX_PAIRED_TOKENS`), and a token in more than 4 groups (`MAX_PAIR_GROUPS`) pairs by its spellings only, so one ambiguous form never multiplies a name's keys. `queryNameReach` gives, per keyed subject token, its own keys and every pair it is in. `KEYS_VERSION` becomes `names-2`.

- Stub `875dff38`: `pairKey`, `queryNameReach`, `MAX_PAIRED_TOKENS`, `MAX_PAIR_GROUPS`.
- RED `03b948ee`: `pnpm exec vitest run src/keys/name-keys.test.ts --coverage.enabled=false`
  ```
  × gives token, skeleton, group, joined-pair and token-pair keys
  × are unordered, so an order swap gives the same pair keys   (expected 'p:t:smith+t:john' to be 'p:t:john+t:smith')
  × pair every two keyed tokens in each form and through their variant groups   (expected [] to include 'p:g:Q10+t:smith')
  × pair a token in more groups than the bound by its spellings only
  × pair at most the first 6 keyed tokens of a name   (expected [] to have a length of 15 but got +0)
  × say which keys reach each keyed token: its own keys and every pair it is in
  × gives each name its normalised form and keys, and a weak alias no keys
  Tests  7 failed | 15 passed (22)
  ```
- GREEN: with the keys implemented and `KEYS_VERSION` still `names-1`, the golden test failed as it should (`digest 9bf0bfe6…` expected, `97966ecb…` computed); `names-2` with its own digest added (the `names-1` digest kept): `pnpm exec vitest run --coverage.enabled=false` in `packages/watchlist`: `Test Files 56 passed, Tests 537 passed`. The API files that key lists (matching jobs, re-screen, sync, CLI, sandbox, re-key, refresh, sources page, seed): `Test Files 14 passed, Tests 165 passed` (load 8.58).

## Slice 2: key frequencies over entries, and the scripts of a source (decisions 1 and 13)

**What.** `rebuildWatchlistKeyDf` counts, per key, the live entries whose strong names hold it (`count(distinct entry_id)`), so a key's count is the most candidates it can return alone (the cap counts entries). It also writes `#script:<script>` rows, the live names of each script (weak aliases included), which the source states read for coverage (slice 4). `#names` keeps its meaning (live strong names), which `sync.test.ts` reads.

- RED `d358bcaf` (with `WATCHLIST_SCRIPT_KEY_PREFIX` as a stub): `pnpm exec vitest run src/repositories/watchlist-key-df.test.ts --coverage.enabled=false` in `packages/db`
  ```
  × counts each key over the live entries that hold it …   expected { '#names': 3, 't:avery': 3, … } to match object { '#names': 3, 't:avery': 2, … }
  × counts the live names of each script under its reserved key …   expected {} to deeply equal { '#script:cyrillic': 1, … }
  × counts each key over the live strong names …   (the `#script:latin` row is missing)
  Tests  3 failed (3)
  ```
- GREEN: the three db files (`watchlist-key-df`, `watchlist-reads`, `watchlists`): `Tests 23 passed`; the API's `sync`, `rekey` and sources page tests pass.

## Slice 3: the absolute bound, the folded query and the reach of a search (decision 1)

**What.**
- `key-document-frequency-max` (2% of a source's names) is gone. `key-frequency-bound-share` (0.25, provisional, chosen on the development tables, fixed by the 6C calibration) bounds a key by live entries at a quarter of the cap: `keyFrequencyBound(cap) = max(1, floor(0.25 × cap))`, 500 at the cap of 2,000. The pair constants `pair-max-tokens` (6) and `pair-max-groups` (4) move into core beside it, each with its basis.
- **Reach, refined from slice 1.** `queryNameReach` groups the keys of every two keyed tokens of a name (their own keys and their pair keys), or a lone keyed token's own keys. A group whose every key is over the bound in a source makes the search `truncated`. This is stricter than "a token with no key or pair under the bound": it also flags a subject such as "Maria Garcia Quux" against many "Maria Garcia" entries, where `quux`'s empty pairs would have counted `maria` as reachable while the names holding maria and garcia were not. Whenever the per-token rule of the decision fires, the pair rule fires too (a pair's entries are a subset of each token's).
- **One statement** (`retrieveCandidates`): the screenable sources, the frequencies of the query keys (and every reach key) in them, the keys within the bound and their candidates (one GIN lookup per rare key, laterally), ranked and limited to the cap plus one; the over-bound keys come back in the same result to decide the reach. `truncated` is now set only when the cap actually cuts a path (it was set when a path returned exactly the cap) or a reach group is out of reach; `capReached` and `unreachable` are optional diagnostics beside it.
- **The trigram path** also runs when a reach group is out of reach, so the names most like the subject are still screened (best effort for a search already marked cut short).
- The in-memory fake applies the same bound and reach; `screenNames` gives each search by key the reach of its names. The reverse index keeps 6A's 2% subject-side share locally until slice 5 replaces it.

- RED `f43b54af` (stubs: `keyFrequencyBound`, the `reach` member):
  ```
  core  × fixes the plan values; × bounds a key by entries, a share of the candidate cap …   expected 2000 to be 500
  watchlist  × gives the keys, the reach of every name …; × group the keys that reach the list names holding each two keyed tokens …; × group the tokens past the paired ones …
  db  × ranks the entries … ignoring keys held by more entries than their bound   expected 40 to be 10
      × bounds a key by the entries holding it …   expected [ 11 candidates ] to deeply equal []
      × says the search was cut short when two subject tokens are reached only through keys over the bound …   expected false to be true
      × says the search was cut short only when the cap actually cuts it   expected true to be false
      × folds the rare-key lookup into the candidate query: one statement …   expected 3 to be 1
  api × uses a key alone only when its entries are within the bound …   expected [ 'MG', 'M0', … ] to deeply equal [ 'MG' ]
      × gives every search the reach of the names it searches by key   expected [ [], [] ] to deeply equal …
  ```
- GREEN: core `Tests 770 passed`; watchlist `src` `Tests 495 passed` (the package run's 6 failures were `evaluation-set-6c`'s renderer tests in flight, `scripts/benchmark-*`); db `watchlist-reads` `Tests 13 passed`; api (matching jobs, fake, PGlite jobs, re-screen, watchlists) `Tests 127 passed`.
- **Existing tests changed with the plan (rule 10):** `subject.test.ts` (the retrieval query gains `reach`); `watchlist-reads.test.ts` (three cases pass a cap of 40 or 2 so the bound acts on their few entries, and "stops at the cap" uses three keys of one entry each); `watchlists-fake.test.ts` (the production case and the cap case, split, under the bound).

## Slice 4: the C78.7 gate on a heavy-headed list, and candidate entries checked by key (decisions 1 and 2)

**What.**
- `apps/api/src/watchlists/test-support/heavy-headed-list.ts` (new): a typed generator over the fictional names of `@openverify/watchlist/testing` and, when `data/variant-groups.json` is present with the shipped digest, the groups' single-word Latin spellings; Zipf (exponent 1) with ranks shuffled by the seed, once for given and once for family names; sanctions-like aliases (about 1.65 names an entry: order swap, a middle name, an initial, another spelling of the group, Cyrillic, a weak single token); 150 listed and 150 unlisted subjects. Never the held-out generator.
- The gate (`watchlists.integration.test.ts`) imports 100,000 names through the sync, keyed with the shipped groups when present (else none), screens through the `watchlist` job's `screenNames`, prints `[C78.7 gate] case=… law=zipf-1 …` with p50, p95, p99, the round p95s, the phase p95s, candidates p50/p95, cap binds, unreachable, would-be `result_truncated`, listed found and unlisted alerted, and asserts only what does not depend on the machine: no other error, 150 of 150 listed found, candidates p95 under the cap, the cap binding in at most 6 of 300 and `result_truncated` in at most 3 of 300. The latency budget (100 ms, p95 over every screening) is asserted only with `OPENVERIFY_C787_TIMING=assert`.
- **Found while measuring.** The plans of the dev table showed retrieval's cost: the planner hash-joined every live entry (a sequential scan of all 61,631, 35–97 ms) to check `removed_at`. Both the key path and the trigram path now rank their candidates first (up to twice the cap plus one), then check each one's entry by primary key (`LATERAL … LIMIT 1`); a ranked set at its slack is taken as cut short. A new test reads each statement's plan (`EXPLAIN (FORMAT JSON)`) for 20 gate subjects and refuses a sequential scan of `watchlist_entries`.

- Stub `6c461cc1`, RED `7f7f5b48` (generator: `× draws rank r about 1/(r+1) as often as rank 0   expected 0.00076 to be greater than 0.11`, … 7 failed), GREEN `f8659120` (7 passed; one expectation corrected in GREEN: a group with one Latin spelling is still a pool item).
- RED `1e0a0223`: `flock /tmp/openverify-e2e.lock pnpm exec vitest run --config vitest.integration.config.ts src/watchlists/watchlists.integration.test.ts` (load 14.7 → 15.0)
  ```
  [C78.7 gate] case=shipped-variant-groups law=zipf-1 names=100001 entries=60685 import=102798ms p50=102.1ms p95=391.3ms … p95-state/retrieve/load/rest=7.4/171.5/44.6/112.8ms candidates-p50/p95=79/503 cap-binds=5/300 unreachable=2/300 would-error=1/300 listed-found=150/150 unlisted-alerted=24/150 timing=printed
  × checks each candidate entry by its key, never by scanning every entry   expected [ 'watchlist_entries' ] to not include 'watchlist_entries'
  Tests  1 failed | 5 passed (6)
  ```
- GREEN (load 17.5 → 6.0):
  ```
  [C78.7 gate] case=shipped-variant-groups … import=70606ms p50=21.4ms p95=131.6ms p99=528.9ms round-p95s=359.5/119.6/94.5ms p95-state/retrieve/load/rest=4.1/27.2/23.4/61.0ms candidates-p50/p95=79/503 cap-binds=5/300 unreachable=2/300 would-error=1/300 listed-found=150/150 …
  Tests  6 passed (6)
  ```
  Retrieval's p95 fell from 171.5 ms to 27.2 ms. The db retrieval tests: `Tests 25 passed`.
- **CI (decision 2).** RED `6a2733df`: `bash infra/tests/ci-workflow.test.sh` → `FAIL - integration: the data cache keeps every file of data/manifest.json`, `… the data cache key hashes data/manifest.json`, `… fetches every data file … after restoring the cache`, `… builds the shipped variant groups after the fetch and before the tests` (`203 passed, 4 failed`). GREEN: the `integration` job restores the shared `data-v1-<manifest hash>` cache, runs `python3 scripts/fetch_data.py` and `pnpm --filter @openverify/watchlist build:variant-groups` before `pnpm test:integration`: `207 passed, 0 failed, 0 skipped`.

## Slice 5: the scoring shortcuts (decision 1, loads and scoring)

**What.** The baseline of this slice is the existing early stop (`nameScoreUpperBound`, a pair whose bound is below 0.70 or below the best so far is not aligned). Profiling the development table showed that the bound itself cost about as much as the alignment (it scored every token pair, then the alignment scored them again), that every token unit was rebuilt for every pair, and that each candidate's names were analysed in every screening. Four shortcuts, each switchable (`useScreeningShortcuts`, `match/shortcuts.ts`) so its share can be measured, and each keeping every created match identical:
- `name-cache`: `analyseRecordName` keeps the 50,000 most recently used analysed list names per process (`ANALYSED_NAME_CACHE_SIZE`), keyed by the kind, the written name and its parts; the same object is returned while cached.
- `unit-cache`: the scorer builds a name's token units once per name and variant groups (a `WeakMap`), not once per pair.
- `shared-matrix`: `scoreNamePairAbove` computes the bound and the alignment from one table of token pair scores, and the alignment's join choices read it too.
- `minimum-floor`: with `keptOnly` (a run's `screenNames` and the re-screen keep only created matches), a pair is aligned only when its bound reaches the preset's minimum less the best qualifier (`dob_exact`, +0.05), never below the display floor: 0.75 at `tolerant`, 0.80 at `strict`, 1 at `exact`.
- `scorerWork()` counts the units built, the pair scores and the alignments, for the tests.

- Stub `c8d0616c`. RED `b74ec3fc`: `pnpm exec vitest run src/match/shortcuts.test.ts --coverage.enabled=false`
  ```
  × with keptOnly, return only the matches that are created   expected [ 20 matches below their minimum ] to deeply equal []
  × do less work: fewer units, pair scores and alignments for the same matches   expected 0 to be less than 0
  × analyse a list name once while it is cached, and again when the cache is off   (Object.is equality)
  Tests  3 failed | 4 passed (7)
  ```
  The four equivalence cases (every preset, each shortcut alone and all together, on 540 seeded subjects against 60 synthetic entries) pass from the start, as they must: they guard the GREEN.
- GREEN: `pnpm exec vitest run src --coverage.enabled=false` in `packages/watchlist`: `Tests 502 passed`; the API's matching jobs, re-screen and watchlists: `Tests 215 passed`.

## Slice 6: the variant groups' MIT notice (decision 19)

**What.** `build-variant-groups` writes `license` (`MIT`), `copyright` and `licenseText` into the file, after the header members `scripts/benchmark-independence.mjs` reads (`format`, `source`, `heldOut`, `maxForms`), for the shipped and the held-out builds. The text is the one the committed legal-form table carries, refused unless its SHA-256 is rigour's pinned `099eeaff…6d1`; rigour's `LICENSE` at `b0ba4ad` (the commit `person_names.txt` is pinned to) was fetched once on 2026-10-28 to check it has that digest, and never committed. Only the header changes: the groups, forms and counts are the same (156,706 groups, 547,306 forms). `SHIPPED_VARIANT_GROUPS_SHA256` and the digest line of `infra/docker/apps.Dockerfile` move from `529216c9…7324` to `29d05838…3bfb`, so `keysVersion` moves too: one re-key, which `KEYS_VERSION` `names-2` needs anyway.

- RED `4231941b` (stubs `RIGOUR_LICENSE`, `rigourLicenseText`): `× carries the MIT notice of its source after the members the benchmarks read   expected [ 'format', 'source', 'heldOut', …(2) ] to deeply equal [ … (5) ]`; `× reads the MIT text of rigour pinned by its digest   expected 'e3b0c442…' to be '099eeaff…'` (`2 failed | 12 passed`).
- GREEN: `src/keys` `Tests 46 passed`. `pnpm --filter @openverify/watchlist build:variant-groups` refused the new digest (`refused: the shipped build's digest 29d05838… is not SHIPPED_VARIANT_GROUPS_SHA256`), then wrote it with `--accept-new-digest`; with the constant moved, the plain build passes. `bash infra/tests/apps-image-context.test.sh`: `24 passed, 0 failed`.

## Slice 7: the re-screen's reads and the reverse index keyed by the list (decision 3)

**What (repositories).** `listRecurringReportSubjects` returns each report's pinned version configuration beside its query; `listReportsWithLiveMatches` lists the re-screened reports (recurring, unpaused, unredacted, of the types whose version selects the source) with an `open` or `delisted` match on the source whose `entry_index` is one of the given ones, or any when no index is given; `watchlistKeyFrequencies` reads a source's frequencies of the given keys in batches of 5,000; `loadEntries` takes an optional `changedInSync` page (the live entries whose `changed_sync_id` is the sync, by entry id). `WatchlistReads` keeps its three methods; `loadEntries`' query only gains an optional member.

**What (reverse index).** The index keys each subject by the keys its own forward search would use: its names' query keys (with the pair keys) that the list's frequencies after the sync keep within the bound. A name its search would also look up by `pg_trgm` (one word, an additional name, no key within the bound, or a pair of tokens out of reach) is indexed by pg_trgm's trigrams (`trigramsOf`, `trigramSimilarity`, checked against the documented `similarity('word', 'two words') = 0.363636`), met from 0.25 (pg_trgm's 0.3 less a margin). 6A's subject-side 2% share and its two-rarest-keys intersection are gone: an entry now finds every subject whose search could reach it, which the forward score then decides. `prepareReverseIndex` computes each name's keys and reach once and exposes the keys, so the caller reads their frequencies before building.

- Stubs `43fb8992`. RED `0ea1c307` (db): `× reads the frequencies of the given keys …   expected {} to deeply equal { 't:avery': 2, 't:dale': 1 }`, `× take the recurring … reports …   (config missing)`, `× takes the re-screened reports with an open or delisted match …   expected [] to deeply equal [ 2 ids ]`, `× loads a page of the live entries a sync added or changed …   expected [ 'SYN-1' ] to deeply equal [ 'SYN-1', 'SYN-7' ]` (`4 failed | 21 passed`). GREEN `9752b780`: `Tests 25 passed`.
- RED `7c36d4df` (reverse index): `× uses a key however many subjects hold it, without the list frequencies   expected … 100 to have a length of 101`, `× keys each subject as its own search would …   expected [ 'rep-ansel' ] to deeply equal []`, `× meets a subject out of reach … through trigrams …   expected [] to include 'p:t:garcia+t:maria'`, `× measures trigram similarity as pg_trgm does` (`4 failed | 4 passed`; "finds Maria Elena Garcia …" passes from the start, since the pair keys of slice 1 already reach it on two subjects). GREEN: `Tests 8 passed`.
- **Existing test changed with the plan (rule 10):** "intersects common token keys when a name has no rarer key" becomes "uses a key however many subjects hold it, without the list frequencies" (101 subjects, the forward score decides).

## Slice 8: the re-screen at each report's own preset, with stale evidence (decision 3 (a) to (c))

**What.** `processReportRescreen` (`jobs/reports/rescreen.ts`):
- (a) reads the sync's changed entries once (up to 20,000 kept in memory, `RESCREEN_ENTRY_MEMORY`; a larger sync reads them again per chunk), prepares each once (`prepareReverseEntry`: its list keys, weak forms, trigrams, identifiers and crypto addresses), and screens with `keptOnly`, so the preset's score bound prunes a pair before it is aligned;
- (b) screens each candidate subject as that report's own run would: its pinned configuration, resolved (`resolveReportTemplateConfig`), through the job's own screening (`watchlistScreening`, `businessWatchlistScreening`, `politicallyExposedPersonScreening`, exported by a refactor `a57a6560`), and inserts a run only where the score keeps a match; the one case it cannot decide from the entry alone is a PEP relative, admitted by a linked holder it does not load, where it inserts (narrowed in slice 9 once the record carries `relative_of_class`). The most permissive screen of 6A is gone. The reverse index is keyed by the source's key frequencies after the sync (`watchlistKeyFrequencies`) within the cap's bound;
- (c) inserts a run for every re-screened report with an `open` or `delisted` match on a changed entry, found by `entry_index` (`reportMatchEntryIndex` under the blind-index key, a new optional dep) per environment; without the key (the worker does not pass it yet: `worker.ts` is frozen, a follow-up), every report with a live match on the source gets a run, and the job says so in a warning.
- The result gains `matched` and `stale` counts.

- RED `9af7eba9`: `pnpm exec vitest run src/jobs/reports/rescreen.test.ts src/jobs/reports/rescreen-coverage.test.ts --coverage.enabled=false`
  ```
  × gives each recurring report a hit of the first list one run …   (runsInserted 4: the exact-preset typo report got a run)
  × gives a run to every report with an open or delisted match on a changed entry …   expected [ 1 id ] to deeply equal [ 2 ids ]
  × without the blind-index key …   expected [ 1 id ] to include the stale holder
  × gives a run to exactly the reports whose own screening now matches a changed entry   expected [ …(165) ] to deeply equal [ …(114) ]
  ```
  The seeded test builds 220 recurring reports (listed names, order swaps, typos, initials, respellings and strangers, each at a preset drawn from the seed) and a sync adding 40 entries; the ground truth is each report's own full screening (the `watchlist` job's `screenNames` over the database reads). The permissive 6A screen gave 165 runs for the 114 reports that match.
- GREEN: `Tests 10 passed` (the 114 runs are exactly the 114 reports, none missed). The RED commit's test helper passed `undefined` to a defaulted parameter, which kept the key; the GREEN takes a boolean (a test fix, not a behaviour change).

## Slice 9: a list_update run screens its trigger's changed entries, and a relative's own class (decisions 3 (d) and 9)

**What.**
- (d) `screenNames` adds, for a `list_update` run, the live entries its trigger sync added or changed on the run's screenable sources (`loadEntries` with `changedInSync`, in pages of 1,000) to the retrieved candidates, so whatever the re-screen found, the run finds, a search cut at its cap included. The in-memory fake loads the same (`FakeWatchlistEntry.changedSyncId`).
- (9) The PEP class filter reads a relative's class from its own record (`relative_of_class`, which `ingestion-6c` derives on each pass, `fc88287e`, `832fd6ba`); a relative stored before it is still read through its linked holder. With it, the re-screen decides a relative from the entry alone, and treats only a relative without `relative_of_class` as undecidable.

- RED `9e1eab70`: `pnpm exec vitest run src/jobs/report-types/matching-reports.test.ts src/test-support/watchlists-fake.test.ts --coverage.enabled=false`
  ```
  × loads a page of the entries a sync changed beside the candidates   expected [] to deeply equal [ 'C1' ]
  × screens a list_update run trigger sync changed entries beside retrieval   expected [] to deeply equal [ 'openverify-sandbox:SBX-1001' ]
  × reads a relative’s class from its own record, not its linked holder   expected [] to deeply equal [ Array(1) ]
  Tests  3 failed | 32 passed (35)
  ```
- GREEN: `src/jobs/report-types src/jobs/reports src/test-support/watchlists-fake.test.ts`: `Tests 138 passed`.

## Slice 10: an adjacent transposition is one typo (decision 4)

**What.** `TYPO_EDIT_DISTANCE` (core, provisional, its source naming the 6C calibration as the one that keeps or reverts it) is `optimal_string_alignment`: a typo is one inserted, deleted or substituted letter, or two adjacent letters swapped, within the same budget (one per token of at least 5 letters under `tolerant`) and the same Jaro-Winkler minimum (0.88). The name-score bound reads the same pair rule, so it stays an upper bound. `SCORER_VERSION` becomes `scorer-2`, so a result's `matcher-version` says which typo rule made it; no key changes, so no re-key.

- RED `a84ccb6b` (stub `TYPO_EDIT_DISTANCE` at `levenshtein`): `× count an adjacent transposition as one typo …   expected 'levenshtein' to be 'optimal_string_alignment'`; `× counts an adjacent transposition as one typo, within the same budget   expected { score: 0.5 … } to match object { methods: [ 'equal', 'typo' ] }`; `× moves with the typo rule …   expected 'scorer-1' to be 'scorer-2'`.
- GREEN: core `Tests 771 passed`; watchlist `src` `Tests 510 passed`; the API's matching jobs and re-screen `Tests 132 passed`. **Existing test changed (rule 10):** `matching-reports-db.test.ts` read the literal `scorer-1;…`; it now reads `matcherVersion(SHA)`.

## Slice 11: the scripts of a source (decision 13, K6A-9)

**What.** `WatchlistSourceState` gains the optional `scripts` (never a fourth `WatchlistReads` method): `getWatchlistSourceStates` reads each source's `#script:<script>` rows (slice 2) by exact key over `LIST_NAME_SCRIPTS` (core; a test keeps it equal to C58's `WRITING_SYSTEMS`), in the same statement. A key range was tried first and refused: the comparison follows the database's collation, and PGlite answered nothing. `screenNames` states coverage from the state's scripts, so a name in a script the source holds is not flagged `lossy_script` whatever the run retrieved; a state without them (hand-built) falls back to the candidates' scripts. The in-memory fake states its live entries' name scripts when a state has none.

- RED `d8f63747`: db `× states the scripts each source’s live names are written in   expected undefined to deeply equal [ 'latin' ]`; api `× states the scripts of each source’s live names when its state does not`, `× states coverage from the scripts the source holds …`.
- GREEN: db `src/repositories` `Tests 462 passed`; api (matching jobs, re-screen, fakes, watchlists, sources page) `Tests 269 passed`. Two RED expectations were corrected in GREEN: the db test destructured the states by position while they come back by id; the api test first assumed the sandbox list held no Arabic name (its fixtures carry Arabic renderings), so it now pins the state's scripts both ways (`['latin']` gives `lossy_script`, `['latin', 'arabic']` complete).
- **Borrowed edit (rule 1):** `packages/db/src/repositories/watchlists.test.ts` (`ingestion-6c`'s), "answers the states of the ids that have a row", compares a whole state; it gains `scripts: []`, in this commit.

## Slice 12: the report pages (decision 6, and the changes in words)

`docs/reports/watchlist.md` says what complete coverage does not promise (romanisations outside the variant groups and ICAO's tables, unknown spellings, typos beyond the budget), describes the retrieval change in words (pair keys, the bound of 500 entries a key, truncation when two tokens cannot be reached, the trigram fallback), the transposition typo, the minimum-floor shortcut and the re-screen at each report's own configuration with stale-evidence runs, and the upgrade's re-key. `business-watchlist.md` and `politically-exposed-person.md` point at the same coverage limits; the PEP page says the class filter reads a relative's own `relative_of_class` (the most senior class of its holders, so `pep-classes: [2]` leaves out the spouse of a holder of both a class 1 and a class 2 position). Checked by `apps/api/src/report-docs.test.ts` (`Tests 10 passed`) and the dashboard's `report-type-words.test.ts` (`26 passed`); Prettier clean. The console's coverage words and the README's upgrade note belong to `console-tests-6c` and `ingestion-6c`: their sentences are in the follow-ups.

## Slice 13: pairs out of reach looked up by their own key, and no singleton frequencies (decision 1, found at 2,000,000 names)

**Found.** The head at 2,000,000 development names (slice 14 has the numbers) had a retrieval p95 of 669.8 ms; the plans showed the trigram fallback of a subject whose pair of tokens was out of reach (both common, the pair over the bound) scanning the names table (a parallel sequential scan, 2.25 s, then 3.0 s in all), and `watchlist_key_df` at 2.0 GB, nearly all of it pair keys held by one entry.

**What.**
- A reach group out of reach in a source has its pair keys looked up themselves (`w.keys && $pairs`, ranked up to twice the cap, each checked live by primary key, limited to the cap): the names holding both tokens, namesakes first, are screened, and the search stays `truncated`.
- The trigram path runs for a single word, or for a name none of whose keys within the bound has a frequency row and none of whose pairs is out of reach (a spelling the keys do not reach). It no longer runs for a pair out of reach.
- `rebuildWatchlistKeyDf` stores a key only when two or more live entries hold it: a missing key is within every bound (bounds are at least one entry). Retrieval probes every query key that is not over the bound (an absent key's probe is a cheap empty GIN lookup).
- The reverse index mirrors both rules: it posts a subject under the pair keys of its out-of-reach pairs, and indexes a name's trigrams under the same condition, read from the same frequencies.

- RED `fbfd4f31`: `× counts each key over the live entries …   expected { … } to not have property "t:dale"`; `× counts each key over the live strong names …`; `× reads the frequencies …   expected { 't:avery': 2, 't:dale': 1 } to deeply equal { 't:avery': 2 }`; `× says the search was cut short when two subject tokens are reached only through keys over the bound, and still screens the names holding both, up to the cap   expected [ 22 trigram candidates ] to deeply equal [ the 11 SYN-MG entries ]` (`4 failed | 16 passed`).
- GREEN: db `src/repositories` `Tests 463 passed`; watchlist `src/reverse-index` `Tests 8 passed`; api (re-screen with the seeded no-miss test, matching jobs, fakes, watchlists) `Tests 263 passed`. **Test changed with this slice:** the reverse-index case of slice 7 that met an out-of-reach subject through trigrams now meets it through its pair key (a namesake) and not through a misspelling, as its search would.

## Slice 14: two more scoring shortcuts for namesakes (decision 1, found at 2,000,000 names)

**Found.** After slice 13, scoring was the p95 at 2,000,000 names (430 ms). A profile of the 300 standard subjects there (scratch, at load 2.4): per screening at p95, 5,626 list names, 2,989 alignments and 35,298 token pair scores. Namesakes share written names across entries (a PEP mirror repeats the same labels), and an entry's exact primary name is followed by aliases that cannot beat it.

**What** (both switchable, both in the equivalence tests of every preset):
- `pair-memo`: within one `screenCandidates` call, each (subject name, list name) pair's bound and, once computed, its score are kept (`PairMemo`, by the analysed-name objects the name cache returns), so a list name many entries share is bounded and aligned once.
- `exact-stop`: once an entry's best pair is exact and at or over the floor, a pair whose bound cannot exceed it is not aligned (`strict`): no equal score can replace an exact best.

- RED `6e1f2358` (stubs in the shortcut list): `× score a list name that many entries share once per screening, and stop at an exact best pair   expected 40 to be less than 40`. Two corrections to the RED test's data in GREEN, so each shortcut has work to save: the namesakes' second alias is the primary written in the reverse order (an exact alias, bound 1), taken from the whole primary name, middle name included.
- GREEN: watchlist `src` `Tests 512 passed`; api matching jobs and re-screen pass.

## Slice 15: the pair lookup stays within the key bound (decision 1)

**Found.** At 2,000,000 names the p95 screenings were namesake floods: a pair of very common tokens (thousands of entries) looked up up to the cap, 2,000 candidates and up to 816 kept matches, each already `truncated`. **What.** The pair lookup of an out-of-reach pair returns at most the key bound (500 at the cap of 2,000), as the decision says no key alone may return more candidates than the bound allows; the search stays `truncated`.
- RED `a183e483`: `× … still screens the names holding both, up to the bound   expected [ 11 ] to have a length of 10 but got 11`. GREEN: `Tests 16 passed`.

## Slice 16: trigrams only when the keys reach nothing (decision 1)

**Found.** With singleton frequencies gone (slice 13), a name whose keys are all held by one entry had no frequency row within the bound and took the trigram path, which it did not before: at 100,000 names the head's p95 rose from 86.8 ms to 105.0 ms, with candidates p95 677 against 553 (load 3.1). **What.** The forward search takes trigrams for a single word, or when no key within the bound has a frequency row, no key gave a candidate and no pair is out of reach. The reverse index keeps the first two conditions only (it cannot see a key one entry holds), which finds more and never less.
- RED `54a21a05`: `× does not search the trigrams of a name a key held by one entry reaches   expected [ [ 'SYN-E1', [ 'keys', 'trigram' ] ] ] to deeply equal [ [ 'SYN-E1', [ 'keys' ] ] ]`. GREEN: db `Tests 464 passed`.
- **The seeded re-screen test, refined.** Its exact equality (slice 8) now fails by one: a report whose own retrieval no longer reaches a changed entry (its keys reach other entries, so no trigram) still gets a run, because the re-screen scores the pair directly and the score keeps a match; its `list_update` run, which screens the changed entries beside retrieval (slice 9), keeps it. That is the decision's rule (a run only "where the score would keep a match"). The test now bounds both sides: every report whose scheduled screening matches a changed entry gets a run (none missed), every run's report keeps a match in its `list_update` screening (none wasted), and the runs stay under the 165 of the permissive 6A screen: `Tests 1 passed`.

## Slice 17: a lone token out of reach still takes trigrams (decision 1)

**Found.** After slice 16 the development `initials` variant cases at 100,000 names fell to 45 of 50 (the base found 46, slice 5's head 50): "A. Family" has one keyed token, so a common family name makes its reach group out of reach with no pair key to look up, and a rare crossing key's candidates had switched the trigram path off. **What.** A name with a reach group out of reach and no pair key in it takes the trigram path (best effort; the search is already `truncated`); the reverse index indexes such a name's trigrams too.
- RED `78a1686b`: `× searches the trigrams of a name whose one keyed token is out of reach, which has no pair to look up   expected false to be true`. GREEN: db `Tests 465 passed`, reverse index `8 passed`, the API's re-screen and matching jobs `134 passed`.

## Slice 18: each key is probed by the index, also while a sync's names wait in its pending list (decision 1)

**Found.** After slice 17, the head's p95 at 100,000 names measured 1,007.6 ms with retrieval at 961.5 ms (load 4.6 to 5.5). The cause was not slice 17: `EXPLAIN ANALYZE` of the slowest retrievals (scratch, load 1.2 to 3.6) showed the key statement joined every strong name (`Parallel Seq Scan on watchlist_names`, 98,912 rows, each tested against 27 to 34 keys: `Rows Removed by Join Filter: 887407`, 940 ms). The development table's key index held 1,657 names in its GIN pending list (`pgstatginindex`: 110 pending pages), written by the re-screen measurement's sync of 1,000 changed entries; every probe also reads the pending list, so the planner priced a probe per key above one scan of every name, and the lateral probe, a simple subquery, was flattened into that join. A production list is in that state after every sync until autovacuum. With the lateral probe fenced (`offset 0`) the same statements ran in 50 to 79 ms, each key a `Bitmap Index Scan` (scratch comparison, same load).

**What.** The plan test of the integration suite now also takes the ten gate subjects with the most keys and a six-word name (at least 30 keys), writes 2,000 entries' names as a sync does (a key added and taken away, so the keys are unchanged) without a vacuum, and asserts that no statement scans `watchlist_names` (beside `watchlist_entries`).

- RED: `pnpm exec vitest run --config vitest.integration.config.ts src/watchlists/watchlists.integration.test.ts -t "probes the names"` (load 3.3 to 3.8): `× checks each candidate entry by its key and probes the names by their keys, never by scanning every entry or every name (owner decision 1 after 6B) 1199ms`, `AssertionError: expected [ 'watchlist_names' ] to not include 'watchlist_names'`. Before the pending-list writes, the extended test passed (no flip on a freshly vacuumed index, 116.4 s and 183.7 s runs), which is why the writes are part of it.
- GREEN: the lateral probe of each key is fenced with `offset 0`. The first GREEN run then failed on another statement: the trigram look-up of the single word `habsburg` (a heavy head of the gate list, 6,984 names estimated) was planned as one `Seq Scan on watchlist_names`, a choice the planner makes from the trigram statistics for one look-up, which no fence changes (on the development tables the commonest tokens, 7,000 to 9,000 names, kept their `Bitmap Index Scan` with the pending list in place: 92 to 131 ms, scratch). **Test changed with this slice:** the names assertion applies to the statements that look names up by their keys (`.keys @>`, `.keys &&`); the entries assertion still applies to every statement. The scoped test was run once more without the fence and fails as in RED (`× … 1175ms`, `expected [ 'watchlist_names' ] to not include 'watchlist_names'`, at the key statement, load 2.1 to 2.5), and with it passes (`Tests 1 passed | 5 skipped`, load 3.1 to 3.9); db `src/repositories/watchlist-reads.test.ts` `Tests 18 passed`.

## Slice 19: the pair lookup reads its names through the key index (decision 1)

**Found.** With slice 18 in place, the slowest development retrieval at 100,000 names (`adorisio verstraete`, two of the commonest tokens, 228 ms) was the pair lookup of slice 12: `select distinct … where w.keys && <pair keys> limit 1002` was planned as a walk of `watchlist_names_pkey` in key order, testing each name's keys until 1,002 distinct entries had matched (`Index Scan using watchlist_names_pkey`, 660 rows found, 208 ms), because the limit made the planner expect the matches early. Scratch census of the 150 unlisted development subjects (load 1.5): 7 took the trigram path, 1 the pair lookup.

**What.** The plan test also screens the commonest given name of the gate list with its commonest family name (a pair out of reach), requires that a pair lookup ran, and asserts that a statement that looks names up by their keys reads `watchlist_names` by bitmap scans only (a GIN index serves no other).

- RED: `-t "reads the names by the key index"` (load 2.4 to 4.7): `× checks each candidate entry by its key and reads the names by the key index, never by scanning every entry or every name (owner decision 1 after 6B) 5094ms`, `AssertionError: expected [ 'Index Scan' ] to deeply equal []`.
- First GREEN attempt (pair lookup fenced with `offset 0`, holders sorted then limited): the walk of the primary key is gone, but with the test's 2,000 pending names in the key index the planner now chose `Seq Scan on watchlist_names` for the pair lookup (3,971 names estimated; the pending list prices every bitmap probe up). A pending list is the state a sync leaves until autovacuum, so slice 20 removes it at the end of the sync's writes, and this slice's GREEN follows it.

## Slice 20: the sync and the re-key leave the names' GIN indexes without a pending list (decision 1)

**Found.** On the development tables after slice 18, emptying the two pending lists (`gin_clean_pending_list`: 110 pages of the key index, 75 of the trigram index) moved the 100,000-name p95 from 252.4 ms to 174.6 ms and the retrieval p95 from 148.5 ms to 52.9 ms (load 2.1 to 3.5, same list). Until autovacuum runs, every probe of a GIN index also reads its whole pending list (up to `gin_pending_list_limit`, 4 MB) and the planner prices index plans up by it.

**What.** `rebuildWatchlistKeyDf`, which the sync and the re-key call after their writes, ends by moving both indexes' pending entries into the indexes (`gin_clean_pending_list`, which needs the owner of the index, as the rebuild's `analyze` already does).

- RED: `packages/db: vitest run src/repositories/watchlist-key-df.test.ts`: `× leaves no written name waiting in the pending lists of the key and trigram indexes, which every probe would also read (owner decision 1 after 6B)`, `AssertionError: expected { keys: 1, trigrams: 1 } to deeply equal { keys: +0, trigrams: +0 }`.
- GREEN: `Tests 5 passed (5)`; db `src/repositories/watchlist*` `Tests 35 passed`; api `src/watchlists` `Tests 88 passed`.

## Slice 19, GREEN (after slice 20)

- The pair lookup finds the holders of the pair keys first (`offset 0`), then sorts them by entry and limits them. **Test changed with this slice:** the plan test checks twice. While the 2,000 written names are pending, the key statement is held to the key index (slice 18), the pair lookup is not (the planner may scan for it then: a follow-up for a sync that runs for long); after `rebuildWatchlistKeyDf`, as the sync's writes end, every statement that looks names up by their keys reads them by bitmap scans only, and a pair lookup must have run.
- The restructured test without the pair fence (the fence taken out of the working file for one run): `× … 42243ms`, `AssertionError: expected [ 'Index Scan' ] to deeply equal []` in the check after the rebuild (load 2.7 to 4.1). With it: `Tests 1 passed | 5 skipped (6)` (140.4 s, load 3.5 to 3.8); db `src/repositories/watchlist-reads.test.ts` `Tests 18 passed`.

## Slice 21: retrieval runs without JIT compilation (decisions 1 and 2, found at 2,000,000 names)

**Found.** The head at 2,000,000 development names after slice 20 measured p95 1,232.5 ms with retrieval at 914.8 ms (load 2.5 to 4.0; slice 14's head had 488.5 ms). A census of the 150 unlisted subjects' retrievals (scratch, load 3.9 to 3.5): 49.3 s in all, 48.96 s of it the key statement, p50 72.2 ms, p95 808.8 ms. `EXPLAIN ANALYZE` showed the time was Postgres's JIT compiler, not the plan: at that table size the planner's default estimates of a per-key probe (0.5% of the names) put the statement's cost over `jit_above_cost` (100,000), and slice 18's fence over `jit_optimize_above_cost` and `jit_inline_above_cost` (500,000): `JIT: … Optimization 355.325 ms, Emission 235.463 ms, Total 613.023 ms`, `Execution Time: 614.432 ms`, while every node ran in under 10 ms; without the fence, JIT still took 43 to 53 ms of 46 to 54 ms. With JIT off for the development database (`alter database … set jit = off`, reset afterwards), the same census took 1.94 s: p50 7.1 ms, p95 47.4 ms (load 1.9).

**What.** `retrieveCandidates` runs its statements in one transaction that starts with `set local jit = off`: no look-up here runs long enough for compiled code to repay its compilation. The statement count of the key search (one) is counted without that setting.

- RED: `packages/db: vitest run src/repositories/watchlist-reads.test.ts`: `× runs its statements with JIT compilation off, which costs more than these look-ups take`, `AssertionError: expected 'with src as (\n          select id fr…' to be 'set local jit = off'`; the one-statement test, now counting through a recorder that also sees a transaction's statements, passes (`Tests 1 failed | 18 passed (19)`).
- GREEN: db `src/repositories/watchlist-reads.test.ts` `Tests 19 passed (19)`. The integration plan test's recorder now also records the statements of a transaction the handle opens, and leaves the setting out of the explained statements: `-t "reads the names by the key index"` `Tests 1 passed | 5 skipped (6)` (86.3 s, load 2.5 to 3.6). api `matching-reports-db`, `src/jobs/reports`, `src/watchlists`: `Tests 129 passed (129)`.

## Slice 22: the pair lookup goes up to the cap again (decision 1, found at 2,000,000 names)

**Found.** The base measured at 2,000,000 development names in its own database (`matcher-6c-2m-base`, imported at `94ab63f9`) found 146 of its 150 listed subjects, the head 143. The three the head misses are namesake floods: `adorisio farid`, `adorisio tallino` and `adorisio kracik` are each written exactly so by 871, 1,115 and 544 live entries. Their pair of tokens is out of reach, the pair lookup stops at the key bound (500, slice 15), and the listed entry is not among the first 500 by entry id; the base reached it within its cap of 2,000 (1,229, 617 and 319 kept matches). Both sides say `truncated`. Slice 15 had chosen the bound for latency, when retrieval at that scale was dominated by JIT compilation (slice 21); the decision's recall rule (non-inferior to the base at both scales) comes first.

**What.** The pair lookup of a pair out of reach returns up to the cap again (as slice 12 did), within a ranked slack of the cap, and says when the cap cuts it; the bound still decides which keys are used alone.

- RED: `packages/db: vitest run src/repositories/watchlist-reads.test.ts`: `× says the search was cut short when two subject tokens are reached only through keys over the bound, and still screens the names holding both, up to the cap`, `AssertionError: expected [ 'synthetic-list/SYN-MG0', …(9) ] to have a length of 11 but got 10`. **Test changed with this slice:** slice 15's expectations (10 of the 11 namesakes at a cap of 40, 1 at a cap of 5) become 11 and 5.
- GREEN: db `src/repositories/watchlist-reads.test.ts` `Tests 19 passed (19)`; api `matching-reports-db`, `src/jobs/reports`, `src/watchlists` `Tests 129 passed (129)`.

## Measurements at the head (development tables, development seed)

Every timing below ran under the e2e lock with the scratch driver; the load average is the 1-minute one before and after. The head numbers are from `42020f9c` (slice 22) unless a row says otherwise; slice 22 changes only the pair lookup, so `7e0a4b33` (slice 21) is shown beside it.

**The lists.** At 100,000 names the head's database is the base's, re-keyed, plus the 2,000 entries that the base's and slice 16's re-screen measurements added through their syncs (62,631 entries against 60,631). At 2,000,000 names base and head have databases of their own, each imported at its commit from the same seed: `matcher-6c-2m-base` (412,500 entries; import 1,819.4 s in 8 parts, under a load of 2.4 to 14.9 from concurrent suites) and `matcher-6c-2m` (412,500 entries; import 3,509 s in 8 parts, load 2.2 to 7.4, then the re-keys of slices 13 and 16).

**100,000 names** (300 standard subjects, three rounds):

| Commit | p50 | p95 | p99 | Round p95s | Phase p95 (state / retrieve / load / rest) | Candidates p50 / p95 | Cap binds | Would be `result_truncated` | Listed found | Unlisted alerted | Load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| base `94ab63f9` | 42.7 ms | 290.4 ms | 722.6 ms | 253.1 / 297.9 / 279.0 | 3.0 / 81.1 / 54.6 / 129.9 | 183 / 1,242 | 3 of 300 | 1 of 300 | 150 of 150 | 31 of 150 | 5.64 → 5.48 |
| head `7e0a4b33` | 17.0 ms | **92.8 ms** | 209.0 ms | 98.0 / 80.6 / 85.2 | 3.4 / 18.8 / 21.3 / 53.5 | 88 / 560 | 5 of 300 (0.7% to 3.8%) | 1 of 300 | 150 of 150 | 28 of 150 | 5.03 → 3.82 |
| head `42020f9c` | 18.3 ms | **105.8 ms** | 233.9 ms | 133.8 / 103.2 / 92.5 | 3.4 / 28.4 / 24.1 / 58.1 | 88 / 560 | 5 of 300 | 1 of 300 | 150 of 150 | 28 of 150 | 2.79 → 3.02 |

Variant cases at 100,000 names (`tolerant`, 50 each): base `order_swap` 50, `dropped_middle` 49, `added_middle` 50, `initials` 46, `typo` 43, `transposition` 0; head `42020f9c` 50, 50, 50, 50, 43, 50 (load 4.46 → 4.15).

**2,000,000 names:**

| Commit | p50 | p95 | p99 | Round p95s | Phase p95 (state / retrieve / load / rest) | Candidates p50 / p95 | Cap binds | Would be `result_truncated` | Listed found | Unlisted alerted | Load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| base `94ab63f9` | 527.9 ms | 1,725.5 ms | 4,776.8 ms | 1,627.8 / 1,707.7 / 1,780.5 | 2.7 / 1,004.5 / 111.6 / 779.2 | 1,421 / 2,000 | 126 of 300 (36.6% to 47.7%) | 16 of 300 (3.3% to 8.5%) | 146 of 150 | 89 of 150 | 4.13 → 3.57 |
| head `7e0a4b33` | 66.0 ms | 319.9 ms | 606.6 ms | 282.7 / 358.4 / 319.9 | 4.1 / 41.1 / 28.2 / 258.1 | 154 / 625 | 21 of 300 (4.6% to 10.5%) | 0 of 300 (0% to 1.3%) | 143 of 150 | 67 of 150 | 3.25 → 4.08 |
| head `42020f9c` | 85.9 ms | **625.7 ms** | 1,066.6 ms | 666.3 / 623.2 / 558.4 | 5.0 / 103.1 / 63.2 / 397.4 | 154 / 1,040 | 21 of 300 | 0 of 300 | 146 of 150 | 67 of 150 | 8.27 → 3.94 |

Variant cases at 2,000,000 names: base 49, 48, 46, 44, 42, 0 (load 3.34 → 9.54); head `42020f9c` 50, 50, 48, 44, **39**, 50 (load 3.49 → 3.12). The head's three `typo` misses that the base finds (and one it finds that the base misses) are subjects whose common given name is over the bound at the head (a key of 569 entries, for one) and whose misspelt family name has no key of the listed entry: the base reached the entry through the given name's key, within its 2% share; the head's keys reach other entries, so its search is complete but misses the misspelling. A bound of half the cap (scratch worktree, the constant alone changed) found 41 typo cases at 2,000,000 names, at a p95 of 892.4 ms (load 4.66 → 4.05), and at 100,000 names the same recall at a p95 of 154.7 ms (load 3.58 → 5.37); the quarter is kept.

**Budgets (C78.7) and decision 1's targets, on these tables.** 100,000 names: p95 92.8 ms and 105.8 ms in two head runs against 100 ms (rounds between 80.6 and 133.8 ms). 2,000,000 names: 625.7 ms against 250 ms, a gap of 375.7 ms, of which scoring (`rest`) is 397.4 ms at p95: the namesake floods of slice 22 (up to 2,000 candidates and 1,999 kept matches) cost what slice 15 had saved (319.9 ms). `result_truncated` at 2,000,000 names: 0 of 300 (at most 1%: met). Recall: the decision's paired intervals are the calibration's; on these tables the head finds all the base's listed subjects at 2,000,000 names and loses 3 typo cases there.

**What each mechanism is worth.**
- Scoring shortcuts at 100,000 names (slice 6, head with every shortcut on: p95 86.8 ms, load 2.8 to 11.6): each off alone gives `name-cache` 100.1 ms, `unit-cache` 102.1 ms, `shared-matrix` 91.8 ms, `minimum-floor` 89.4 ms; all off 113.5 ms. `pair-memo` and `exact-stop` (slice 14) act on namesakes at 2,000,000 names; the equivalence tests keep every kept match identical with each one on or off.
- Retrieval: the pending-list flush (slice 20) moved the 100,000-name retrieval p95 from 148.5 ms to 52.9 ms; turning JIT off (slice 21) from 45.5 ms to 18.8 ms at 100,000 names and from 914.8 ms to 41.1 ms at 2,000,000 (census of 150 unlisted retrievals at 2,000,000: 49.3 s against 1.94 s).

**Write cost.** Re-key: 63.8 s to 70.3 s at 100,000 names, 2,413.8 s at 2,000,000. Key frequency rebuild at 2,000,000 names without singletons: 184.4 s (2.0 GB of frequencies before, 123 MB after). Table sizes at 2,000,000 names (`pg_total_relation_size`): names 999 MB at the base, 2,166 MB at the head (the pair keys); frequencies 521 MB at the base, 246 MB at the head. The import is 1.9 times the base's.

**Re-screen** (1,000 entries added by a sync, 200,000 recurring `watchlist` reports): base 185.4 s, 12,956 `list_update` runs inserted (load 7.52 → 6.29); head at `3768bc4d` (slice 16) 136.7 s, 3,431 runs, every one with a kept match (load 1.63 → 2.69); not measured again after slice 17, which adds the lone-token trigram rule to the reverse index, or after the retrieval slices 18 to 22, which the forward screen does not use. The inserted runs cost about runs × screening p50: 553 s at the base (12,956 × 42.7 ms), 58 s at the head (3,431 × 17.0 ms). The 60 s target of decision 3 is missed by 76.7 s.

**The Testcontainers gate** (`pnpm test:integration`, 100,001 names of the heavy-headed list, shipped groups, timing printed, not asserted; during a full integration run at load 4.4 to 23): `p50=18.7ms p95=88.5ms p99=219.1ms round-p95s=111.9/75.8/77.1ms`, retrieval p95 28.4 ms, candidates p50/p95 79/503, cap binds 3 of 300, unreachable 2 of 300, would be `result_truncated` 1 of 300, listed found 150 of 150, unlisted alerted 24 of 150, import 162.6 s.
