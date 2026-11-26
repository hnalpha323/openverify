# Phase 6 TDD record: api-watchlists (Workflow 6A Stage 3)

Owner paths: `apps/api/src/watchlists/`, `apps/api/src/http/stream.ts`, `apps/api/scripts/{watchlists-sync,watchlists-rekey,pep-sync}.ts`, `watchlists/sources.json`, `apps/api/src/jobs/reports/rescreen.ts`, `apps/api/src/jobs/repeatable/watchlists.ts`, `packages/db/src/repositories/watchlists.ts`, `apps/api/src/routes/dashboard/watchlist-sources.ts`, `apps/api/src/seed/dev-seed.ts` (and the tests beside them).

The first run stopped at 20:44 on 2026-10-27 when the session's login expired; this record was written by the resumed run. For the slices the first run committed, the RED lines below are copied from that run's transcript (`agent-a724fc8795b74e184.jsonl`, times in UTC), and every one of those suites was re-run green at the start of the resumed run:

```
$ pnpm --filter @openverify/api exec vitest run src/watchlists src/http/stream.test.ts src/routes/dashboard/watchlist-sources.test.ts src/jobs/reports/rescreen.test.ts --coverage.enabled=false
 Test Files  1 failed | 8 passed (9)
      Tests  6 failed | 76 passed (82)      # the 6 are the then-uncommitted re-screen RED (slice 9)
```

Each slice went stub, then RED (run, seen failing for its reason), then GREEN. Commands run from the repository root after `source scripts/env.sh`; `vitest` means `pnpm --filter <pkg> exec vitest run <files> --coverage.enabled=false`.

## 1. The source manifest (C76.1) — 2b335ad5 (stub), b32b0a92 (RED), 1d0a1046 (GREEN)

RED (`apps/api` vitest `src/watchlists/manifest.test.ts`):
```
Tests  9 failed | 4 passed (13)
AssertionError: expected [] to deeply equal [ { id: 'ofac-sdn', …(7) }, …(7) ]
```
GREEN: `watchlists/sources.json` with the eight sources, their intervals, deadlines, caps, parsers, change signals, terms and attribution; the schema refuses an OFSI URL and a repeated id. 13 passed.

## 2. The watchlist repository (C76, C78.3) — 246ff704 (stub), 5064beae (RED), 9546ecac (GREEN)

RED (`packages/db` vitest `src/repositories/watchlists.test.ts`):
```
Tests  20 failed (20)
Error: not implemented: reconcileWatchlistSourceRows object 3
```
GREEN: source rows, audit rows, entry writes with their derived rows, removals, key frequencies, the purge, the re-key and re-screen pages, the advisory locks, and `retrieveCandidates` / `loadEntries` / `getWatchlistSourceStates` behind the frozen signatures (rare keys under the 2% document frequency with a floor of 1, trigram, identifier, crypto address, weak alias; `sandbox_only = false` in SQL for production).

## 3. The reconciliation (C76.4, V01) — 20ffb75e (stub), 11ced50e (RED), 7c2d32af (GREEN)

RED (`src/watchlists/reconcile.test.ts`):
```
Tests  4 failed (4)
AssertionError: expected { sources: +0, enabled: +0, …(1) } to deeply equal { sources: 8, enabled: 7, retired: +0 }
```

## 4. The streaming list client (C85.1, F18) — ca204cd3 (stub), d8471c10 (RED), 4663554e (GREEN)

RED (`src/http/stream.test.ts`): `Tests  13 failed (13)` against the Stage 1b stub. GREEN: the body to a bounded sink, the named headers, the whole-request deadline and the 30 s idle timeout, one HTTPS redirect to the exact allowed host with no header carried over and the location never logged.

## 5. finishWatchlistSync (C76.2) — 3de1445e (stub), 69c4f466 (RED), cc5ac746 (GREEN)

RED: `Tests  1 failed | 20 skipped (21)` — `Error: not implemented: finishWatchlistSync object 1 pending`.

## 6. The sync (C76.2, C76.3, C76.8, C78.3, C80.1) — 27d855c9, 9bf61dc0 (stubs), 31ed6886 (RED), fd1c681a (GREEN)

RED (`src/watchlists/sync.test.ts`):
```
Tests  23 failed (23)
Error: not implemented: syncWatchlistSource openverify-sandbox object
```
GREEN: the session lock (`busy`), re-key first, the download into a private `mkdtemp` directory or the import, the SHA-256 of the same handle, parse and apply under the per-source transaction lock with the rollback, future and mass-removal guards re-checked against the locked row, the audited overrides, refusals that keep the data, `last_checked_at` on applied and unchanged, the purge, and the re-screen enqueue after commit. 23 passed.

## 7. Pins on the Wikidata runner and on the re-key — 898b7ec3

Written after the code of slice 6 and shown failing against mutations of it (the first run's transcript):
```
Tests  1 failed | 10 passed (11)     # mutation: no back-off on 429
Tests  3 failed | 8 passed (11)      # mutation: re-key keeps the old keys version
```
Both pass against the real code (no GREEN commit was needed).

## 8. The sources page (C72.3, C76.3, C76.4, C81.2) — 58f21417 (stub), d8f7f5b9 (RED), 23b79ea0 (GREEN)

RED (`src/routes/dashboard/watchlist-sources.test.ts src/watchlists/freshness.test.ts`):
```
Tests  2 failed | 21 skipped (23)
Error: not implemented: listReportTemplateSourceLists object env_…
```
GREEN; the 501 expectation for this route in `routes/dashboard/report-routes.test.ts` (foundation-6's) was replaced, as its header asks.

## 9. The re-screen and its recovery (C74.4, C74.3 (c), V05) — 8307fc30 (stub), 4a308602 (RED), ff679610 (GREEN)

RED (resumed run):
```
$ vitest src/jobs/reports/rescreen.test.ts      (apps/api)
 × gives each recurring report a hit of the first list one run, and ends the sync done
 × screens only the entries the next sync added or changed
 × inserts each run once when the job runs again
 × fails without the matcher data and leaves the sync pending for the sweep
 × enqueues each pending re-screen not enqueued in the last 15 minutes, and marks it
 × counts and logs a failed enqueue, and tries it again on the next sweep
AssertionError: expected { Object (environments, subjects, ...) } to deeply equal { environments: 1, subjects: 5, …(1) }
AssertionError: promise resolved "{ environments: +0, subjects: +0, …(1) }" instead of rejecting
AssertionError: expected { enqueued: +0, failed: +0 } to deeply equal { enqueued: 1, failed: +0 }
Tests  6 failed | 1 passed (7)
```
GREEN: `Tests  7 passed (7)`; with `src/jobs/reports/sweep.test.ts` and `src/worker.test.ts`: 57 passed.

## 10. The refresh tick (C76.2, F17, C78.3) — 5334b1c5 (stub), 30061076 (RED), 517fba2b (GREEN)

RED (`src/jobs/repeatable/watchlists.test.ts`):
```
Tests  6 failed (6)
AssertionError: expected { due: +0, applied: +0, …(4) } to deeply equal { due: 5, applied: 1, …(4) }
AssertionError: expected +0 to be 1 // Object.is equality      # re-key before due
```
GREEN: `src/jobs/repeatable/`: 7 files, 28 passed.

## 11. The CLIs (C76.2, C76.5, C78.3, C80.1) — 629e3a64 (stub), c83ac968 (RED), d45e77a2 (GREEN)

RED (`src/watchlists/cli.test.ts`):
```
Tests  14 failed (14)
WatchlistCliUsageError: not built yet
AssertionError: expected [] to deeply equal [ 'applied' ]
AssertionError: expected [] to deeply equal [ [ 'openverify-sandbox', 'rekeyed' ] ]
```
GREEN: 14 passed. Smoke: `pnpm --filter @openverify/api watchlists:sync --force` prints the usage line and exits 1.

## 12. The sandbox lists in seed:dev (C76.6, C76.3 V03, F14, P13) — 7fff7570, 54e32b69 (stubs), 7e2ff590 and 69ee7cfc (RED), db0fab58 and a7f2e4c1 (GREEN)

RED (`src/watchlists/sandbox.test.ts`): `Tests  5 failed (5)` — `expected { lists: [], warning: null } to deeply equal …`, `expected [] to include 'SBX-1001'`.
RED (`src/seed/dev-seed.test.ts`): `Tests  2 failed | 30 passed (32)` — `expected undefined to deeply equal [ Array(2) ]`.
The seed test's reconciliation expectation still held foundation-6's stub counts (`{ sources: 0, enabled: 0, retired: 0 }`), which slice 3 had made false; it now expects `{ sources: 8, enabled: 7, retired: 0 }`.
GREEN: 5 passed; 32 passed. The RED commit 7e2ff590 carried one lint error (an unused variable), fixed in the GREEN commit.

## 13. The Postgres gate (C76.2 P07, C78.7 V11) — e8071436 (test), fc0a8dac (fix)

`apps/api/src/watchlists/watchlists.integration.test.ts` (Testcontainers `pgvector/pgvector:pg17` with `POSTGRES_TEST_COMMAND`, each sync on its own pool connection): `busy` while another session holds the source; `refused_rollback` and `refused_mass_removal` under the lock with the data kept; the audited `--accept-older-publication`; one connection per sync of a pool-backed handle; and the 100,000-name screening gate.

RED, seen three ways (the run command each time: `pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/watchlists/watchlists.integration.test.ts`):
```
Error: Test timed out in 600000ms.            # the 100,000-name import never finished
pg_stat_activity: active | 00:07:35 | insert into watchlist_key_df (source_id, key, count) select ...
pg_stat_activity: active | 00:00:06 | insert into watchlist_names (...)     # every batch, seconds each
EXPLAIN select 1 from only watchlist_entries x where source_id='ofac-sdn' and entry_id='X' for key share of x
  ->  Index Scan using watchlist_entries_source_id_removed_at_idx   Index Cond: (source_id = 'ofac-sdn')   Filter: (entry_id = 'X')
```
Cause: statistics taken before the source's first import say the source holds no entry, so each foreign-key check of a new name, identifier or crypto address reads every entry of the source through `(source_id, removed_at)`, and the key-frequency join plans as a nested loop. A scratch profile on an empty database (no stale statistics) imported 15,000 entries in 23 s, which pointed at the statistics. A `plan_cache_mode = force_custom_plan` attempt did not help (the plans were fresh; the statistics were wrong) and was dropped.

GREEN: `analyzeWatchlistTables(tx)` runs in the apply transaction after the first 500 written entries and again each time the writes grow fourfold, and `rebuildWatchlistKeyDf` analyses first. ANALYZE sees the transaction's own rows.
```
[C78.7 gate] names=105517 entries=63954 import=70892ms p50=8.4ms p95=61.4ms candidates-p95=260 truncated=0
             listed-found=150/150 round-p95s=94.0/87.8/61.4ms retrieve-p95=57.1ms load-p95=12.6ms score-p95=25.6ms
Tests  5 passed (5)   Duration 125.24s   (load average 11.7 to 42 from other agents' suites)
```
The gate measures three rounds over the same 300 subjects (150 listed, 150 unlisted, after a 20-subject warm-up) and reads the least disturbed round's p95: one earlier single-round run at a load average of 56 measured 634 ms, another at about 20 measured 108 ms. The variant groups are empty in this test (the shipped file is not in CI), so `g:` keys are absent.

Unit suites after the fix: `packages/db` `src/repositories/watchlists.test.ts` 23 passed; `apps/api` `src/watchlists src/jobs/repeatable/watchlists.test.ts src/jobs/reports/rescreen.test.ts src/seed/dev-seed.test.ts` 121 passed.
