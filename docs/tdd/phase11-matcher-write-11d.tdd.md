# Phase 11, Workflow 11D Stage 2: matcher-write-11d

Evidence for `matcher-write-11d` (Workflow 11D Stage 2, beside `load-harness` and
`matcher-c787-11d`): C270.1 (the incremental key frequencies), C270.2 (the re-key's batch size) and
C270.3 (the three GIN options), each behind its switch or tuning of
`packages/db/src/repositories/watchlist-switches.ts` (Stage 1a amendment 7), test-first, every
created match identical. Each section names its commands and their real, abbreviated output.
Timings here are context only, never results (the Stage 3 calibration decides): they are taken under
the e2e lock with the load average beside them, on development tables of a development seed of my
own. The checkpoint commits are listed at the end.

## 0. Start

- Read at `d90e62ecf` (contracts-11d's last checkpoint, "switches"); 11D's start `69fd529c0`, base
  `d44e537db`, method commit `ac3fc15583558d1ad256c44fb9e39eee7ebce871`.
- C271's condition is `missed` (Stage 1a amendment 3), so `matcher-c787-11d` runs beside me and
  makes named borrowed edits on my files, each after my checkpoint on that file (amendment 11).
- Ownership (amendment 11): `apps/api/src/watchlists/{sync,sync-session,download,manifest,reconcile,cli,cli-runtime,rekey,records,formats,matcher-data}.ts`
  and `test-support/`, `apps/api/scripts/watchlists-rebuild-key-df.ts`,
  `packages/db/src/repositories/{watchlist-key-df,watchlists,watchlist-switches}.ts`, the write
  steps and `switchOf` of `packages/watchlist/scripts/benchmark-performance.mjs` (registration a
  named borrowed edit), a new `packages/watchlist/scripts/benchmark-write.mjs` with its test, the
  migration of amendment 8, and `packages/db/src/runtime-role.ts` only as a named borrowed edit.

## 1. Checkpoint "migration": none needed (Stage 1a amendment 8)

No change of C270 needs DDL to be measured or to ship behind its switch:

- C270.1 (`incremental-key-df`) writes `watchlist_key_df` rows only (DML the runtime role holds);
  it needs no new table, column or index, and no temporary table (the runtime role's `TEMP` is not
  relied on).
- C270.2 (`rekeyBatch`) is a constant and a tuning.
- C270.3: `ginPendingListLimitKb` is the sync's `set_config('gin_pending_list_limit', …, true)` (a
  session setting the runtime role may set); `ginCleanEveryBatches` calls 11B's SECURITY DEFINER
  `openverify_gin_clean_pending_lists` (`packages/db/src/runtime-role.ts:32-35`);
  `gin-fastupdate-off` is applied by the benchmark's own database as its owner (`ALTER INDEX`), and
  only `fix-11d` writes it into `0037_phase11d_watchlist.sql` if the calibration takes it
  (amendment 12).

So `matcher-write-11d` creates no migration. `packages/db/drizzle/0037_phase11d_watchlist.sql` (with
its meta snapshot, journal entry and `packages/db/src/tables/watchlists.ts`) is free for
`matcher-c787-11d`'s `stored-name-analysis` column as its named borrowed edit from this checkpoint
on; `fix-11d` adds the `ALTER INDEX … SET (fastupdate = off)` there if the calibration takes it.

**Which of my checkpoints touches which file** (so `matcher-c787-11d` knows when each borrowed edit
may land):

| File | My checkpoints that touch it | Free for a borrowed edit after |
| --- | --- | --- |
| `apps/api/src/watchlists/records.ts` | none | this checkpoint |
| `packages/db/drizzle/0037_*`, `packages/db/src/tables/watchlists.ts` | none | this checkpoint |
| `packages/db/src/repositories/watchlists.ts` | 1 | checkpoint 1 |
| `packages/watchlist/scripts/benchmark-performance.mjs` | 1 (every write step registered, `switchOf` knows every Phase 11 switch) | checkpoint 1 |
| `apps/api/src/watchlists/sync.ts` | 1 and 3 | checkpoint 3 |
| `apps/api/src/watchlists/rekey.ts` | 2 | checkpoint 2 |

The checkpoints land in the order 1, 3, 2 (each numbered by its C270 item), so `sync.ts` is done
before `rekey.ts`.

CHECKPOINT migration: recorded in the commit whose subject contains "Workflow 11D matcher-write-11d
checkpoint migration" (gate: none; a Markdown file only, rule 27(a) `pnpm format:check` skips
`**/*.md`).

## 2. C270.1, the incremental key frequencies (checkpoint 1)

**What changed.** Behind `incremental-key-df` (off by default; Stage 1a amendment 7), the sync keeps
`watchlist_key_df` by the delta of the entries it writes and removes, in its own apply transaction
under the source's locks, instead of `rebuildWatchlistKeyDf` over the whole source:

- `packages/db/src/repositories/watchlist-key-df.ts`: `watchlistKeyDfShares` (what given live
  entries add, by the rebuild's rules: a name key once per entry over strong names, `#names` per
  strong name, `#script:<script>` per name), `applyWatchlistKeyDfDelta` (a key with a row moves by
  its change and loses the row below its floor, 2 for a name key and 1 for a reserved key; a
  reserved key without a row held 0; a name key without a row held 0 or 1, so it is counted again
  over the names that hold it, through the GIN index), `trackWatchlistKeyDf` (each `track` reads the
  changed entries' shares before and after the change; the difference is applied once it holds
  `WATCHLIST_KEY_DF_APPLY_KEYS` = 50,000 keys and at `finish`, which then empties the pending lists
  as the rebuild ends), `countWatchlistKeyDfRows`. No temporary table (the runtime role's `TEMP` is
  not relied on), no ANALYZE of a new table (no `runtime-role.ts` edit), every key and id list bound
  as one `text[]` parameter.
- `packages/db/src/repositories/watchlists.ts`: `rewrittenWatchlistEntryIds` (the entries whose names
  `writeWatchlistEntries` replaces; it uses the same rule).
- `apps/api/src/watchlists/sync.ts`: the tracker around each batch's write and the removals, then
  `finish`, when the switch is on; `rebuildWatchlistKeyDf` as before when it is off.
- `watchlists:rebuild-key-df` (the 20th compiled command): `apps/api/scripts/watchlists-rebuild-key-df.ts`,
  `parseWatchlistsRebuildKeyDfArgs`, `runWatchlistsRebuildKeyDf`, `watchlistRebuildKeyDfExitCode` in
  `apps/api/src/watchlists/cli.ts` (with `chosenSources`, shared with `watchlists:rekey`) and
  `rebuildWatchlistSourceKeyDf` in `apps/api/src/watchlists/rebuild-key-df.ts`: the session try-lock
  (`busy`), then the rebuild in one transaction under the transaction lock; one line a source,
  `<source>: rebuilt, <n> keys` or `--json`; exit 0 only when every source was rebuilt.
- The benchmark: `packages/watchlist/scripts/benchmark-write.mjs` (pure helpers, tested) and
  `benchmark-write-steps.mjs` (the steps, under `benchmark:typecheck`), registered in
  `benchmark-performance.mjs` (section 5).

### RED

```text
$ cd packages/db && pnpm exec vitest run src/repositories/watchlist-key-df-delta.test.ts --coverage.enabled=false
     × counts each key once per live entry over strong names, and the reserved counts over names, as the rebuild does
     × adds a key's row when its count reaches 2, deletes it below 2, and keeps the reserved rows from 1
     ... (9 of 9 failed)
Error: watchlistKeyDfShares: not built yet (Workflow 11D matcher-write-11d)
Error: track: not built yet (Workflow 11D matcher-write-11d)
```

(The first run hung for 300 s: the stubs' error carried the PGlite handle as its `cause`, which the
reporter tried to serialise; the stubs were changed to carry a summary of their arguments before
the RED was committed, `9dc9d3fec`, `102d6300c`.)

```text
$ cd apps/api && pnpm exec vitest run src/watchlists/sync-key-df.test.ts --coverage.enabled=false
     × applies its delta instead of rebuilding: a row no change reaches is left as it was, which a sync with the switch off rebuilds
AssertionError: expected { '#names': 90, …(27) } to match object { 't:synthetic-stale': 7 }
      Tests  1 failed | 2 passed (3)
```

The sequence test passes on the rebuild path too (it guards the identity either way); the stale row
is the proof that the switch replaces the rebuild (`cb264c4fa`).

```text
$ pnpm exec vitest run src/watchlists/rebuild-key-df.test.ts --coverage.enabled=false
     × ... (5 of 5 failed)
Error: parseWatchlistsRebuildKeyDfArgs: not built yet (Workflow 11D matcher-write-11d)
Error: runWatchlistsRebuildKeyDf: not built yet (Workflow 11D matcher-write-11d)
```

### GREEN

```text
$ cd packages/db && pnpm exec vitest run src/repositories/watchlist-key-df-delta.test.ts src/repositories/watchlist-key-df.test.ts --coverage.enabled=false
 Test Files  2 passed (2)      Tests  16 passed (16)
$ cd apps/api && pnpm exec vitest run src/watchlists/sync-key-df.test.ts src/watchlists/sync.test.ts src/watchlists/rekey.test.ts --coverage.enabled=false
 Test Files  3 passed (3)      Tests  33 passed (33)
$ pnpm exec vitest run src/watchlists/rebuild-key-df.test.ts src/watchlists/cli.test.ts src/commands-build.test.ts --coverage.enabled=false
 Test Files  3 passed (3)      Tests  43 passed (43)
$ pnpm --filter @openverify/watchlist benchmark:typecheck   # exit 0
$ pnpm --filter @openverify/watchlist benchmark:test        # 12 files, 119 tests (13 and 129 with section 5)
```

### The runtime role, the races and the lock (Testcontainers)

`apps/api/src/watchlists/key-df-incremental.integration.test.ts` (`1a58c0ad1`), as the runtime role
from `createRuntimeRole`, every `WARNING` notice collected:

```text
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts --project api src/watchlists/key-df-incremental.integration.test.ts
 Test Files  1 passed (1)      Tests  4 passed (4)      Duration  31.76s
```

- identity: 4 syncs (1,000 entries; 30 removed, 40 renamed, 50 added; another variant-group set,
  which re-keys, with 10 re-listed and 20 removed; every rename taken back), each equal to a full
  rebuild (read in a rolled-back transaction); over 500 rows; no `WARNING`;
- a re-screen's whole-table read in a loop during a sync of 3,000 entries: every read is the table
  before the sync or after it, never a mix, at least one read during the sync;
- two syncs of one source at once: each `applied` or `busy`, one applied, the table exact;
- `watchlists:rebuild-key-df` answers `busy` while another session holds the source, then rebuilds.

These were written after the GREEN (they hold on either path, as the property must). Their teeth were
checked by a mutant (the recount of name keys without a row disabled in a local, uncommitted copy of
`watchlist-key-df.ts`, restored at once; `git diff --stat` empty after):

```text
     × equals a full rebuild after every sync of a seeded sequence: ...
AssertionError: the first publication: expected { '#names': 1595, …(3) } to deeply equal { '#names': 1595, …(762) }
```

### Benchmark smoke (development, `--smoke`, seed `62f31ab95cd049ab510822ac83000aa1` drawn with `openssl rand -hex 16` at 2026-11-16T13:24:02Z; namespace `mw11d-smoke`; not under the lock, no figure published)

```text
100k-import                     applied 3,038 entries
100k-snapshot --as table        {"snapshot":"table","liveEntries":3038}
100k-keydf-identity             4 checks missing/extra/differing 0/0/0; op 3 rekeyed; 40 subjects, differingDigests 0, identical true
100k-keydf-sync --size 20 --takes 1   warm-up pair, off 1.1 s, on 0.6 s; table identical
2m-import --part 1..7, 2m-snapshot --as before-last, 2m-import --part 8, 2m-gin-sync --take 1   status quo: idle p95 103.8 ms, during 161.7 ms, ratio 1.56
2m-gin-sync --take 1 --switch gin-fastupdate-off   ratio 0.97
100k-shares --switch retrieval-reach --takes 1   ran (the Phase 11 registry through switchOf)
```

(The first `100k-snapshot` call ended with "Connection terminated unexpectedly": the container's
server logged `server process (PID 666) exited with exit code 2` during `CREATE DATABASE … STRATEGY
FILE_COPY` and recovered; the next call made the copy. Not reproduced; recorded.)

### Checkpoint 1 gate (rule 22: what I touched; heavy calls through slots 1-3)

| Call | Result | Time (UTC) | Load start -> end |
| --- | --- | --- | --- |
| `pnpm format:check` | exit 0 | 13:32-13:34 | 5.56 -> 8.38 |
| `pnpm --filter @openverify/db test` | exit 0: 167 files, 2,390 tests, lines 90% | 13:34-13:39 | 9.07 -> 18.60 |
| `pnpm --filter @openverify/watchlist test` | exit 1 at 13:39 (2 failures in `src/score/name-score-bound.test.ts`, matcher-c787-11d's RED `8ba8d9aa0`); re-run 14:46-14:56: exit 0, 70 files, 836 tests, 98.62% | | 19.19 -> 14.69 |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run typecheck lint --force --filter=@openverify/db --filter=@openverify/watchlist` | exit 0 (4 tasks) | 13:46-13:48 | 8.66 -> 9.13 |
| the same with `--filter=@openverify/api` | exit 0 (2 tasks) | 13:48-13:54 | 9.76 -> 5.98 |
| API, 12 blob shards from `apps/api` (each exits 1 alone on partial coverage; no test failed in any) and the merge | merge exit 1: 862 files, 10,931 tests, 3 failed, all statements 93.35% / lines 93.57%; the 3 failures are load-harness's (`src/services/list-writes.test.ts` "seed/load/lists.ts calls .insertItems( and stages nothing"; `src/services/graph/synthetic-dense.test.ts` x2, its RED `d8aa27a1d`, GREEN since `6ee7d5ccc`) | 13:54-14:33 | 5.90 -> 9.08 (peak 18.1) |
| `pnpm --filter @openverify/db test:integration` | exit 0: 23 files, 110 tests | 14:33-14:36 | 7.84 -> 22.92 |
| `--project graph` | exit 0: 13 tests | 14:36-14:37 | 22.13 -> 15.68 |
| `--project api --shard=1/3`, `2/3`, `3/3` | exit 0: 121, 138, 196 tests (455) | 14:37-14:46 | 15.68 -> 23.83 |
| `benchmark:typecheck`, `benchmark:test` | exit 0; 13 files, 129 tests, helpers 98.96% lines | | |

The API merge's only failures lie in another running agent's paths (rule 22): re-run at 14:57,
`synthetic-dense.test.ts` passes, `list-writes.test.ts` still fails in `apps/api/src/seed/load/lists.ts`
(load-harness). Every one of my tests passed in the merge.

CHECKPOINT 1: the commit whose subject contains "Workflow 11D matcher-write-11d checkpoint 1".
`packages/db/src/repositories/watchlists.ts` and `packages/watchlist/scripts/benchmark-performance.mjs`
are free for matcher-c787-11d's borrowed edits from it.

## 3. C270.3, the three GIN options (checkpoint 3)

**What changed** (each off by default; Stage 1a amendments 7 and 12):

- `packages/db/src/repositories/watchlist-key-df.ts`: `setWatchlistGinPendingListLimit(db, kB)`
  (`select set_config('gin_pending_list_limit', '<kB>', true)`, a `SET LOCAL` the runtime role may
  run) and `cleanWatchlistGinPendingLists(db, sourceId)` (11B's SECURITY DEFINER
  `openverify_gin_clean_pending_lists`), which the rebuild and the tracker's `finish` now share.
- `apps/api/src/watchlists/sync.ts`: from `watchlistWriteTuning()`, `ginPendingListLimitKb` sets the
  limit at the start of the apply transaction; `ginCleanEveryBatches` = N cleans the names' pending
  lists after every N-th batch that wrote a row (a batch of only unchanged entries writes nothing
  and is not counted). The final clean after the writes is unchanged.
- Option 1, `gin-fastupdate-off`, is index DDL only the owner may run: the benchmark's `gin-sync`
  step runs `ALTER INDEX … SET (fastupdate = off)` on `watchlist_names_keys_idx` and
  `watchlist_names_normalised_trgm_idx` in its own database copy, then cleans what was already
  pending. No migration (section 1); fix-11d adds it to 0037 only if the calibration takes it.

### RED (`47b1b8f01` stubs, `cd19432e2` tests)

```text
$ cd packages/db && pnpm exec vitest run src/repositories/watchlist-key-df-delta.test.ts --coverage.enabled=false
     × sets the pending-list limit for the rest of the transaction only
     × moves what the names' indexes hold pending into them
      Tests  2 failed | 9 passed (11)            (setWatchlistGinPendingListLimit / cleanWatchlistGinPendingLists: not built yet)
$ cd apps/api && pnpm exec vitest run src/watchlists/sync-gin.test.ts --coverage.enabled=false
     × runs the sync's transaction with the lower pending-list limit, which ends with it
AssertionError: expected [] to deeply equal [ ObjectContaining{…} ]
     × cleans the pending lists every N written batches, and writes the same rows
AssertionError: expected 1 to be 2 // Object.is equality
      Tests  2 failed | 1 passed (3)
```

(A first draft spied only on PGlite's `client.query`, which misses the statements a transaction
sends on its own handle; the committed test also wraps `client.transaction`.)

### GREEN (`ba30a3bf5`)

```text
$ cd packages/db && pnpm exec vitest run src/repositories/watchlist-key-df-delta.test.ts src/repositories/watchlist-key-df.test.ts --coverage.enabled=false
      Tests  18 passed (18)
$ cd apps/api && pnpm exec vitest run src/watchlists/sync-gin.test.ts src/watchlists/sync-key-df.test.ts src/watchlists/sync.test.ts --coverage.enabled=false
      Tests  33 passed (33)
$ pnpm exec vitest run --config vitest.integration.config.ts --project api src/watchlists/key-df-incremental.integration.test.ts
      Tests  5 passed (5)     (the fifth, d8bee00c3: both tunings as the runtime role, table exact, no WARNING)
```

Smoke (`--smoke`, the development seed of section 2): `2m-gin-sync --take 1 --tune
gin-pending-list-limit=64` and `--tune gin-clean-every=2` each ran and wrote their record.

## 4. C270.2, the re-key's batch size (checkpoint 2)

**What changed:** `apps/api/src/watchlists/rekey.ts` pages by `watchlistWriteTuning().rekeyBatch ??
REKEY_BATCH` (500, documented as a performance constant whose chosen value fix-11d commits with its
basis). The re-key stays as it was otherwise: one transaction a page, then one that rebuilds the
frequencies and sets the version, so an interrupted re-key leaves the old version and the next sync
or `watchlists:rekey` re-keys the whole source again.

### RED (`c7299bdfa`)

```text
$ cd apps/api && pnpm exec vitest run src/watchlists/rekey-batch.test.ts --coverage.enabled=false
     × pages the source by the override, one transaction a page and one to finish
AssertionError: expected 4 to be 2 // Object.is equality
      Tests  1 failed | 3 passed (4)
```

The identity for every candidate (500, 2,000, 5,000, 10,000: the SHA-256 of every derived column
equal to the default re-key's) and the interrupted-then-completed re-key hold on both sides of the
change, as they must; the first draft's group did not touch the table's tokens (the digest did not
move between the two key versions, which the test asserts it does), so the committed test groups a
token the table's names hold.

### GREEN (`b3a927aca`)

```text
$ cd apps/api && pnpm exec vitest run src/watchlists/rekey-batch.test.ts src/watchlists/rekey.test.ts src/watchlists/sync.test.ts --coverage.enabled=false
      Tests  34 passed (34)
```

Smoke: `100k-rekey --tune rekey-batch=2000 --take 1`: 3,038 entries, `identical: true`, peak RSS
484.8 MiB, heap 329.9 MiB (smoke tables, not a figure).

### Gate for checkpoints 3 and 2 (rule 22; heavy calls through slots 1-3; one tree, `b3a927aca`)

| Call | Result | Time (UTC) | Load start -> end |
| --- | --- | --- | --- |
| `pnpm format:check` | exit 0 | 15:48-15:55 | 29.65 -> 27.10 |
| `pnpm --filter @openverify/db test` | exit 0: 2,392 tests, lines 90.01% | 15:55-16:02 | 27.10 -> 23.96 |
| `turbo run typecheck lint --force --filter=@openverify/db --filter=@openverify/watchlist` | exit 0 (4 tasks) | 16:02-16:06 | 21.85 -> 15.72 |
| `turbo run typecheck lint --force --filter=@openverify/api` | exit 124 at my 560 s bound (load 16-24), so split as rule 8 does | 16:06-16:15 | |
| `turbo run lint --force --concurrency=1 --filter=@openverify/api` | exit 0 | 16:15-16:24 | 18.45 -> 9.19 |
| `turbo run typecheck --force --filter=@openverify/api` | exit 0 | 16:24-16:26 | 8.69 -> 5.77 |
| API, 12 blob shards (shard 3 met my 285 s bound once at load 20-23 and was run again alone, its blob replaced) and the merge | merge exit 0: 868 files, 10,960 tests, lines 93.59% | 16:26-17:21 | 5.39 -> 14.17 (peak 23.7) |
| `pnpm --filter @openverify/db test:integration` | exit 0: 110 | 17:21-17:24 | 13.51 -> 30.85 |
| `--project graph` | exit 0: 13 | 17:24-17:25 | 29.18 -> 21.20 |
| `--project api --shard=1/3`, `2/3` (my 285 s bound once at load 27, run again alone), `3/3` | exit 0: 121, 139, 196 (456); the C78.7 gate printed `case=shipped-variant-groups … listed-found=150/150 cap-binds=0/300` | 17:25-17:42 | 21.20 -> 15.32 |
| `benchmark:typecheck`, `benchmark:test` | exit 0 | after `b3a927aca` | |

The watchlist package's sources and tests did not change after checkpoint 1 (its suite passed then,
section 2), so it was not run again here.

CHECKPOINT 3: the commit whose subject contains "Workflow 11D matcher-write-11d checkpoint 3";
`apps/api/src/watchlists/sync.ts` is free for matcher-c787-11d's borrowed edit from it.

CHECKPOINT 2: the commit whose subject contains "Workflow 11D matcher-write-11d checkpoint 2" (the
same gate as checkpoint 3, run on the tree that holds both, `b3a927aca`);
`apps/api/src/watchlists/rekey.ts` is free for matcher-c787-11d's borrowed edit from it.

## 5. The write-cost steps (for calibration-matcher-11d)

`packages/watchlist/scripts/benchmark-write.mjs` (pure helpers, in the package's typecheck and the
benchmark coverage gate; `benchmark-write.test.mjs`, 10 tests) and
`packages/watchlist/scripts/benchmark-write-steps.mjs` (the steps; API-bound, so under
`benchmark:typecheck` only, as the other CLIs), registered in `benchmark-performance.mjs` (the
`--as`, `--take`, `--tune` (repeatable) and `--heartbeat` flags; `writeKitOf` lends the steps the
scale helpers) and imported only when a write step runs. Each step works on a copy of a snapshot
database in the scale's container (`CREATE DATABASE … TEMPLATE … STRATEGY FILE_COPY`), so the
measure, re-screen and share steps keep their table; the scale's teardown removes every copy.

From `<tree>/packages/watchlist`, with the run's `--seed`, `--out`, `--namespace` (and `--parts`
when the import used it):

| Step | What it does | Calls |
| --- | --- | --- |
| `<scale>-snapshot --as <name>` | copies the scale's database to `snapshot_<name>` | `2m`: after `2m-import --part 7`, `--as before-last`; after part 8, `--as table`. `100k`: after `100k-import`, before `rescreen-seed`, `--as table` |
| `<scale>-keydf-identity` | on a copy of `table`, 4 syncs with `incremental-key-df` on (adds, removals, renames, re-listings; op 3 re-keys with no variant group), each checked against a full rebuild in a rolled-back transaction; the subjects screened on the incremental table, a rebuild committed, the subjects screened again | repeat until exit 0 (exit 3: resume); at 2,000,000 names op 3 is a full re-key, a long take (background, `--heartbeat`) |
| `<scale>-keydf-sync --size 1000 [--takes 3]` | on a copy of `table`, an untimed warm-up pair, then per take the 1,000-entry sync with the switch off, then on, each followed by an untimed restore (switch on); the summary's `table` check against a rebuild | repeat until exit 0 |
| `<scale>-rekey [--tune rekey-batch=<n>] --take <k>` | a fresh copy of `table` per call, the re-key timed with its baseline and peak RSS and V8 heap, and the digest of every derived column, which must equal the snapshot's (`identical`) | the first call digests the snapshot and exits 3; then one call per take: `--tune rekey-batch=500` (or none), `2000`, `5000`, `10000`, `--take 1` to `3` at 100,000 names; the chosen size and `500` once each at 2,000,000 names (long takes) |
| `<scale>-gin-sync [--switch gin-fastupdate-off \| --tune gin-pending-list-limit=<kB> \| --tune gin-clean-every=<n>] --take <k> --heartbeat <file>` | a fresh copy of `before-last`; one idle round of the subjects; the last part's sync with the subjects screened over and over until it commits; `idle`, `during`, `ratio`, `withinTwiceIdle`, `syncSeconds`, the loads and the largest heartbeat gap | status quo, `--switch gin-fastupdate-off`, `--tune gin-pending-list-limit=256` and `=1024`, `--tune gin-clean-every=10` and `=50`, takes 1 to 3; long takes at 2,000,000 names |

Results: `<out>/<scale>/write/` (`snapshot-<name>.json`, `keydf-identity.json(l)`,
`keydf-sync-<n>.json(l)`, `rekey/<configuration>-take-<k>.json`, `gin-sync/<configuration>-take-<k>.json`).
`<scale>-shares --switch <name>` also takes every Phase 11 switch (`WATCHLIST_PHASE11_SWITCHES`).
At the base overlay, `snapshot`, `rekey` without `--tune` (the base's `REKEY_BATCH`) and the status-quo
`gin-sync` run; a `--switch` or `--tune` and the `keydf-*` steps need the head's registry and say so.

### Development figures (context only, never results; under the e2e lock, lock wait 0 s each)

Seed `62f31ab95cd049ab510822ac83000aa1` (development, drawn 2026-11-16T13:24:02Z), namespace
`mw11d-dev`, the 100,000-name table (60,757 entries; import 59.7 s), head `0f604b2c8`'s code:

| Step | Figure | Load (1 min) start -> end |
| --- | --- | --- |
| `100k-keydf-sync --size 1000 --takes 3` | off 21.9, 21.9, 22.7 s (median 21.9); on 20.3, 21.5, 22.6 s (median 21.5); restores 11.6-12.5 s; table identical (78,455 rows) | 3.94 -> 3.66 |
| `100k-rekey --take 2` (500 a batch) | 47.0 s; baseline 474 MiB RSS / 327 MiB heap; peak 1,126 / 959 MiB; identical | 1.68 -> 1.95 |
| `100k-rekey --take 2 --tune rekey-batch=5000` | 44.3 s; baseline 484 / 328 MiB; peak 1,194 / 1,012 MiB; identical | 1.95 -> 1.71 |

At 100,000 names the full rebuild is a small part of a sync, so the switch moves the 1,000-entry
sync by little here; C270.1's 184 s is at 2,000,000 names, which only the calibration measures.
The first takes of the re-key (54.5 and 43.8 s) held the snapshot's digest in the same process,
which is why the step now digests in its own call (`0f604b2c8`).

## 6. The end gate (rule 22, on the final tree `f08fd488a`; heavy calls through slots 1-3)

| Call | Result | Time (UTC) | Load start -> end |
| --- | --- | --- | --- |
| `pnpm --filter @openverify/watchlist test` | exit 0: 71 files, 837 tests, 98.62% lines | 17:57-18:01 | 1.34 -> 1.12 |
| `pnpm format:check` | exit 0 (again at 18:59-19:01, after the last step change) | 18:02-18:04 | 1.03 -> 1.60 |
| `benchmark:typecheck`, `benchmark:test` | exit 0; 130 tests, helpers 98.96% lines (again after `f08fd488a`) | 18:04-18:05 | |
| `turbo run typecheck lint --force --filter=@openverify/db --filter=@openverify/watchlist` | exit 0 (4 tasks); the watchlist again after `f08fd488a` (2 tasks) | 18:05-18:06 | 1.47 -> 2.39 |
| `turbo run typecheck --force --filter=@openverify/api` | exit 0 | 18:06-18:08 | 2.39 -> 1.66 |
| `turbo run lint --force --concurrency=1 --filter=@openverify/api` | exit 0 | 18:08-18:12 | 1.53 -> 1.60 |
| `pnpm --filter @openverify/db test` | exit 0: 2,392 tests, 90.01% lines | 18:12-18:15 | 1.60 -> 9.67 |
| API, 12 blob shards and the merge | merge exit 0: 868 files, 10,960 tests, 93.59% lines | 18:15-18:43 | 8.18 -> 3.44 |
| `pnpm --filter @openverify/db test:integration` | exit 0: 110 | 18:43-18:45 | 3.16 -> 17.73 |
| `--project graph` | exit 0: 13 | 18:45 | 17.73 -> 11.24 |
| `--project api --shard=1/3`, `2/3` (my 190 s bound once at load 16, run again alone), `3/3` | exit 0: 121, 139, 196 (456); the C78.7 gate's machine-independent checks held (`listed-found=150/150 cap-binds=0/300 unreachable=1/300 would-error=0/300`) | 18:45-18:56 | 10.34 -> 11.41 |

`git status --porcelain` holds none of my paths.
