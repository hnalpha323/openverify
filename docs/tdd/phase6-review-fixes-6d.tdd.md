# TDD record: Phase 6, Workflow 6D review fixes (`fix-6d`)

The fixes of the Workflow 6D review. The review raised no blocking finding and no MEDIUM item.
The calibration (`docs/calibration/watchlist-phase6d.md`) reverted nothing: every decision and
switch was kept, and the three missed budgets are carried to Phase 11. What follows are the
builders' follow-ups addressed to `fix-6d` that are local, each test-first. Every value in a
fixture is synthetic. Commands were run from the repository root after `source scripts/env.sh`
unless a step names its directory; outputs are abbreviated.

## 1. The two identity outputs get distinct names (calibration-6d amendment 4, plan item 10)

Both CLIs' `--step identity` wrote `<out>/identity.json`, so a run of the second into the first's
`--out` replaced the first's record. The quality CLI now writes `quality-identity.json` and the
performance CLI `performance-identity.json`.

The test runs both CLIs as their package scripts do (the scripts' own node flags, read from
`package.json`), against two empty output directories, into one `--out`. Neither step needs
Docker, data files or the network.

**RED**

```
$ cd packages/watchlist && pnpm exec vitest run scripts/benchmark-identity.test.mjs
 FAIL  scripts/benchmark-identity.test.mjs > the identity steps’ outputs (Workflow 6D review, calibration-6d amendment 4) > gives each CLI its own file name, so one --out directory holds both records
AssertionError: expected [ 'identity.json' ] to deeply equal [ 'performance-identity.json', …(1) ]
-   "performance-identity.json",
-   "quality-identity.json",
+   "identity.json",
      Tests  1 failed | 10 passed (11)
$ pnpm -s typecheck            # passes
$ pnpm exec eslint scripts/benchmark-identity.test.mjs    # passes
```

It fails for the intended reason: both CLIs wrote `identity.json`, the second over the first.

**GREEN**

`benchmark-quality.mjs`'s `identity` writes `<out>/quality-identity.json` and
`benchmark-performance.mjs`'s `performanceIdentity` writes `<out>/performance-identity.json`; the
records are unchanged. The headers name the files.

```
$ cd packages/watchlist && pnpm exec vitest run scripts/benchmark-identity.test.mjs
      Tests  11 passed (11)
$ pnpm -s benchmark:typecheck          # passes
$ pnpm exec eslint scripts/benchmark-quality.mjs scripts/benchmark-performance.mjs   # passes
$ pnpm exec prettier --check scripts/benchmark-quality.mjs scripts/benchmark-performance.mjs
All matched files use Prettier code style!
```

No refactor was needed. The calibration report's Reproduce lines give each CLI its own `--out`
already, so they stand; its finding 6 notes the change.

## 2. Migration 0022: a changed-entry page is an index range (rescreen-6d follow-up, plan item 9(b))

`listChangedWatchlistEntries` (C74.4) reads one page of a sync's live added or changed entries in
`entry_id collate "C"` order. Its only index, `(source_id, changed_sync_id)`, finds the whole
changed set, which Postgres then sorts to keep the first page: rescreen-6d measured 697 ms a page
after a 51,592-entry sync on the 2,000,000-name table, about 36 s a `list_update` run. Migration
0022 adds `watchlist_entries_changed_page_idx` on
`(source_id, changed_sync_id, entry_id collate "C") where removed_at is null`, which matches the
query's filter and order, so a page is read by index range with no sort. The query is unchanged.

Tests:
- `packages/db/src/watchlist-query-plans.integration.test.ts` (new, Postgres 17 in
  Testcontainers): 180,000 synthetic entries of one source, 60,000 changed by the latest sync and
  1 in 37 removed, plus 20,000 of another source, analyzed. It EXPLAINs the exact query the
  repository sends for the first page and for a page after an entry id, and asserts the new index
  and no `Sort` node. A third test pages through the sync and compares the ids with a direct
  `order by entry_id collate "C"` read: 58,379 live entries, once each, in "C" order (upper- and
  lower-case ids alternate, so a linguistic order would differ).
- `packages/db/src/migrate.test.ts`: 0022 is `0022_watchlist_changed_page_index` and holds only
  the `CREATE INDEX`.
- `packages/db/src/phase6-tables.test.ts`: the migrated catalog has the index, partial on
  `removed_at IS NULL`, with `entry_id COLLATE "C"`.

**RED**

```
$ cd packages/db && pnpm exec vitest run src/migrate.test.ts src/phase6-tables.test.ts
 FAIL  src/migrate.test.ts > migrations > adds only the changed-entry page index in 0022 (Workflow 6D review, rescreen-6d)
AssertionError: expected undefined to be '0022_watchlist_changed_page_index' // Object.is equality
 FAIL  src/phase6-tables.test.ts > C73.2, C73.3: the indexes the plan names > watchlist_entries_changed_page_idx
AssertionError: watchlist_entries_changed_page_idx: expected null not to be null
      Tests  2 failed | 64 passed (66)

$ pnpm exec vitest run --config vitest.integration.config.ts src/watchlist-query-plans.integration.test.ts
 × reads the first page with no sort node
AssertionError: expected 'Limit  (cost=9945.36..10062.04 rows=1…' to contain 'watchlist_entries_changed_page_idx'
+ Limit  (cost=9945.36..10062.04 rows=1000 width=230)
+   ->  Gather Merge  (cost=9945.36..15083.72 rows=44040 width=230)
+         Workers Planned: 2
+         ->  Sort  (cost=8945.34..9000.39 rows=22020 width=230)
+               Sort Key: entry_id COLLATE "C"
+               ->  Parallel Bitmap Heap Scan on watchlist_entries e  (cost=731.97..7738.00 rows=22020 width=230)
+                     Recheck Cond: ((source_id = 'synthetic-list'::text) AND (changed_sync_id = '2'::bigint))
+                     Filter: (removed_at IS NULL)
+                     ->  Bitmap Index Scan on watchlist_entries_source_id_changed_sync_id_idx  (cost=0.00..718.75 rows=54246 width=0)
 × reads a page after an entry id with no sort node
+ Limit  (cost=9100.67..9103.17 rows=1000 width=230)
+   ->  Sort  (cost=9100.67..9135.80 rows=14053 width=230)
+         Sort Key: entry_id COLLATE "C"
+         ->  Bitmap Heap Scan on watchlist_entries e  (cost=719.21..8330.16 rows=14053 width=230)
+               Filter: ((removed_at IS NULL) AND ((entry_id)::text > 'syn-0090001'::text))
+               ->  Bitmap Index Scan on watchlist_entries_source_id_changed_sync_id_idx  (cost=0.00..715.69 rows=53940 width=0)
 ✓ pages through the large sync’s live changed entries once each, in "C" order
      Tests  2 failed | 1 passed (3)

$ pnpm -s typecheck && pnpm exec eslint src/watchlist-query-plans.integration.test.ts src/migrate.test.ts src/phase6-tables.test.ts   # pass
```

Each fails for the intended reason: no migration 0022, no such index, and both pages top-N sort
the whole changed set. The paging test passes at RED; it guards the order the index must keep.

**GREEN**

`watchlistEntries` (`packages/db/src/tables/watchlists.ts`) gains
`index('watchlist_entries_changed_page_idx').on(sourceId, changedSyncId, sql\`entry_id collate "C"\`).where(removed_at is null)`,
and `drizzle-kit generate --name=watchlist_changed_page_index` wrote the migration, its snapshot
and its journal entry (the snapshot differs from 0021's by this index only):

```
CREATE INDEX "watchlist_entries_changed_page_idx" ON "watchlist_entries" USING btree ("source_id","changed_sync_id","entry_id" collate "C") WHERE "watchlist_entries"."removed_at" is null;
```

The existing `(source_id, changed_sync_id)` index stays: the sync's other reads use it, and
dropping it is not this follow-up.

```
$ cd packages/db && pnpm -s db:check
Everything's fine 🐶🔥
$ pnpm exec vitest run src/migrate.test.ts src/phase6-tables.test.ts
      Tests  66 passed (66)
$ pnpm exec vitest run --config vitest.integration.config.ts src/watchlist-query-plans.integration.test.ts
      Tests  3 passed (3)
$ pnpm -s typecheck && pnpm -s lint && pnpm -s test
      Tests  1013 passed (1013)
```

The plans at GREEN (printed from a temporary copy of the test, deleted after):

```
first page:
Limit  (cost=0.42..306.51 rows=1000 width=230)
  ->  Index Scan using watchlist_entries_changed_page_idx on watchlist_entries e  (cost=0.42..16232.46 rows=53030 width=230)
        Index Cond: ((source_id = 'synthetic-list'::text) AND (changed_sync_id = '2'::bigint))
after syn-0090001:
Limit  (cost=0.42..1027.10 rows=1000 width=230)
  ->  Index Scan using watchlist_entries_changed_page_idx on watchlist_entries e  (cost=0.42..11859.63 rows=11551 width=230)
        Index Cond: ((source_id = 'synthetic-list'::text) AND (changed_sync_id = '2'::bigint) AND ((entry_id)::text > 'syn-0090001'::text))
```

No refactor was needed.

## 3. Phase 3's G002 gains a note (platform-6d follow-up, plan item platform-6d 1)

Documentation only: no behaviour changes, so there is no RED step. Before writing it, the claim
was checked in the code: `transitionInquiryInTx` (`apps/api/src/services/inquiries.ts`) returns
null, staging nothing, for a redacted inquiry's move to `pending`, `completed` or `failed`
(`transitionInquiryStatus` refuses it), and expiry is not guarded. The note under G002 (Workflow
3B review item 3) in `docs/plans/phase-3.plan.md` says that, after owner decision 5 after Workflow
6C, a redacted open inquiry is never settled: it stays open until it expires at its `expires-at`,
and webhook consumers get `inquiry.expired` for it, never `inquiry.completed` or `inquiry.failed`.

```
$ pnpm exec prettier --check docs/plans/phase-3.plan.md
All matched files use Prettier code style!
```

### Re-measurement of the re-screen after migration 0022

The index is on the re-screen's read path, so its head numbers were taken again at `7eccf9d0`
with the calibration's commands, seed (`9dd9b353…`) and timing rule, from a worktree
(`/tmp/fix6d-head`, `pnpm install --frozen-lockfile --offline`, `data/` copied but
`variant-groups.json`, `pnpm -s build:variant-groups` → `29d05838…3bfb`, the calibration's).
Three takes, each on its own database, each step under `flock /tmp/openverify-e2e.lock`, each
re-screen after the load fell below 2.0:

```
$ cd /tmp/fix6d-head/packages/watchlist
$ pnpm -s benchmark:performance --seed <seed> --out /tmp/openverify-eval-6d/fix-r<k>/performance --namespace f6d-r<k> --step 100k-import
$ ... --step rescreen-seed
$ ... --step rescreen-100 ; --step rescreen-300 ; --step rescreen-1000 ; --step 100k-teardown
fix-r1 100 rescreen 30.3 s runs 626 matched 626 stale 0 file 2e8fc28fb4b0 pairs 201544 screens 32527
fix-r1 300 rescreen 37.0 s runs 213 matched 213 stale 0 file b9f10acaa770 pairs 438036 screens 52784
fix-r1 1000 rescreen 70.9 s runs 2676 matched 2676 stale 0 file d039bb797a87 pairs 1754088 screens 86044
fix-r2 100 30.7 s; 300 36.4 s; 1000 71.2 s (same runs, files, pairs, screenings)
fix-r3 100 30.5 s; 300 36.6 s; 1000 71.5 s (same runs, files, pairs, screenings)
phases at 1000 (ms): changed 87 / 82 / 84, screen 44462 / 44470 / 44759
```

Medians 30.5, 36.6 and 71.2 s (6D's head 33.6, 38.9 and 74.3 s); every run, file and pair count
equals the calibration's. The changed-entry read is under 0.1 s at these sizes either way, so the
index cannot show here; every verdict stands (the 60 s budget is missed by 11.2 s and stays
carried). Recorded in `docs/calibration/watchlist-phase6d.md`, "Re-measurement after the Workflow
6D review", and beside the budgets' table.

## Skipped follow-ups, with the reason

- **Token-pair memo for `nameScoreUpperBound`** (rescreen-6d): carried to Phase 11 by the Stage 1
  and 2 amendments (rescreen-6d item 9(a), calibration item 11(c)); a bound change after the
  calibration needs the equivalence test at every preset and a full re-measurement, with the
  other re-screen levers.
- **The calibration's re-screen section citing `result.phases`** (rescreen-6d, "if the owner
  wants it"): left as published; the re-measurement above cites each record's `result.phases`.
- **Owner and Phase 11 items** (matcher-6d, rescreen-6d's fixed part, calibration-6d's findings 1
  and 4 and the PROGRESS lines): not `fix-6d`'s; listed in the plan's "Workflow 6D review
  amendments", item 5.
- **No change needed:** `packages/watchlist/tsconfig.json`, and `screening.ts` (matcher-6d).

## Final gates

Run at `441a7c71` (the last code change is `7eccf9d0`), after the re-screen takes, with no timing
beside them. No API route or schema changed, so `openapi:write` was not needed; no infra test was
touched.

```
$ pnpm typecheck                     Tasks: 14 successful, 14 total
$ pnpm lint                          Tasks: 14 successful, 14 total
$ pnpm format:check                  All matched files use Prettier code style!
$ pnpm turbo run test --filter='!@openverify/api'        Tasks: 13 successful, 13 total
    @openverify/db: Tests 1013 passed · @openverify/watchlist: Tests 718 passed
$ (apps/api) pnpm exec vitest run --coverage --coverage.thresholds.{lines,functions,branches,statements}=0 --shard=1/2 --reporter=blob --outputFile=<scratch>/blobs/blob-1-2.json   exit 0
$ (apps/api) ... --shard=2/2 ... blob-2-2.json                                                                                                                                exit 0
$ (apps/api) pnpm exec vitest run --merge-reports=<scratch>/blobs --coverage
    Test Files 323 passed (323) · Tests 4561 passed (4561)
    All files 96.42 | 88.55 | 98.12 | 96.45
$ flock /tmp/openverify-e2e.lock pnpm test:integration
    @openverify/db: Test Files 13 passed, Tests 63 passed · @openverify/api: Test Files 28 passed, Tests 159 passed
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e        69 passed (18.1s)
$ pnpm turbo run build --filter='@openverify/e2e^...'                      Tasks: 5 successful, 5 total
$ (e2e) flock /tmp/openverify-e2e.lock pnpm exec playwright test --shard=1/3   31 passed (3.0m)
$ (e2e) ... --shard=2/3                                                        31 passed (4.9m)
$ (e2e) ... --shard=3/3                                                        29 passed (4.6m)
```
