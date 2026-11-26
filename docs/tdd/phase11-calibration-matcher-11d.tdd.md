# Workflow 11D, `calibration-matcher-11d` (Stage 3, second, alone)

C270's write cost, C269.4, C271's C78.7 and re-screen takes at 11D's base and head, and Workflow 7B's
two list calibrations, under the method committed at `ac3fc155` (`docs/calibration/watchlist-phase11.md`
and `docs/calibration/lists-phase11.md`, both published by this agent). This agent changed no product
code, no test and no benchmark file: there is no RED or GREEN step here. The evidence is the commands
and their output.

## 0. Start (2026-11-17 13:14Z)

- `docker compose -p openverify-load ps -q`: empty (calibration-load-11d had stopped the load stack);
  `docker ps`: nothing running; `/proc/loadavg` 0.21 0.85 1.35; `ps` showed no vitest, playwright,
  gradle, tsc, next build, docker build or other agent's process.
- HEAD `0ad45c37e` (calibration-load-11d's last commit). The head Stage 2 left: `2d3134755`
  (matcher-write-11d's TDD record); between it and HEAD only `apps/api/src/seed/load/`, `load/` and
  `docs/` change.

## 1. Worktrees, overlay, builds

```
git worktree add --detach /tmp/cal11d-base d44e537dba0f84a4eafc45b313264de74c2b31a4
git worktree add --detach /tmp/cal11d-head 2d3134755
# data/: every regular file of the main tree's data/ except variant-groups.json (cp, no clobber)
cp /tmp/cal11d-head/packages/watchlist/scripts/benchmark-* and src/testing/heavy-headed.ts -> /tmp/cal11d-base
(cd /tmp/cal11d-head && sha256sum packages/watchlist/scripts/benchmark-* packages/watchlist/src/testing/heavy-headed.ts) > /tmp/cal11d-overlay.sha256
(cd /tmp/cal11d-base && sha256sum -c /tmp/cal11d-overlay.sha256 | grep -vc ': OK$')   ->  0   (31 benchmark files + heavy-headed.ts)
pnpm install --frozen-lockfile --offline        (both: exit 0; no minimumReleaseAgeExclude)
pnpm -s build:variant-groups                     (both: sha256 29d0583854563f81084c05d78b5ea8805ca14630cbf655349cfa09fca84c3bfb)
```

**Smoke of the base overlay** (development seed, `--smoke`, namespace `c11d-smoke-base`, nothing
published; before the evaluation seed): `machine`, `100k-import`, `100k-measure`, `rescreen-seed`,
`rescreen-100`, `100k-snapshot --as table`, `100k-teardown`; the quality `prepare`, `screen`, `report`,
`teardown` and `scale-prepare`, `scale-screen`, `scale-report`, `scale-teardown` at 100k: every call exit 0.
No step needed a borrowed edit.

## 2. The seed

```
$ openssl rand -hex 16          (OpenSSL 3.0.13), at 2026-11-17T13:19:57Z
eab27c87c9d0b1e0079eb4aaf2aabe76
```

After the method commit `ac3fc155` (2026-11-16T10:17:07Z). One seed for both reports.

## 3. Amendments, each committed before the first take it affects

| Commit | What |
| --- | --- |
| `eb86f55c3` | watchlist-phase11 amendments 1-7 (head pin, side-by-side non-timing steps, snapshots, the memo's databases, long takes, write takes' load rule, the sync's longest statement) — before the first measure take |
| `ed77985af` | watchlist-phase11 amendment 8 (each idle benchmark container's 250 ms health probe adds about 1 to the load; the wait threshold + 1 per extra container; at most two containers up during a timing; the memo pairs on `-r2..-r4`/`-m2..-m4`) — after the size-100 re-screen takes, before any later take |
| `52c905d4b` | lists-phase11 amendments 1-5 (the seed, one list grown, planted probes and digests through a scratch tool, `/usr/bin/time -v` for peak memory, the cold list at 10,000) — before the first lists take |

Amendment 8's evidence: with three idle benchmark containers and nothing else running, the 1-minute
load read 4.12, 4.18, 3.15, 3.16, 3.56, 3.99 over three minutes while `vmstat` showed the CPU 90% idle
and no runnable task in WSL; `docker inspect` gives the containers' health check `pg_isready` every
250 ms (`Interval 250000000`). The waiting runner of the first 300-entry take was stopped before its
step started (logged "stopped waiting (no step started)"); `head-m1` was torn down with
`100k-teardown`.

## 4. The run (runners in `/tmp/cal11d/tools/`, outside git; every call under `flock -E 75 -w 240 /tmp/openverify-e2e.lock`, lock wait 0.0 s each)

`run.sh`/`inner.sh` (one step per lock hold: lock wait, the load wait, `start`/`end` lines with
`/proc/loadavg`), `perf.sh <tree> <db> <thr> <step...>`, `pair.sh` (an off and an on re-screen in one
lock hold), `workers.sh` (6 `--workers 6 --worker i` side by side), `both.sh`/`bothq.sh` (non-timing
steps of both trees side by side), `q1.sh`, `gate.sh`, `lists.sh`. Logs:
`/tmp/openverify-eval-11d/log-<db>.txt`, `log-<tree>-quality.txt`, `gate-<k>.txt`, `log-lists.txt`.

| Time (UTC) | Step | Result |
| --- | --- | --- |
| 13:20-13:23 | `machine`, `100k-import` both trees; head `100k-snapshot --as table` | exit 0; file `ee4ea2eb…` at both; snapshot 229 MB in 1.8 s |
| 13:23-13:25 | `100k-measure --rounds 1` × 3, alternating | round p95 base 67.9 / 68.7 / 64.3, head 74.4 / 68.9 / 67.0 ms |
| 13:25-13:26 | `100k-unlisted` both; head `100k-shares --switch retrieval-reach` | 24 of 150 alerted; share −2.9 ms, identical |
| 13:26-13:30 | head `100k-keydf-identity` | 4 checks identical, 300 digests identical, exit 0 |
| 13:30-13:45 | head `100k-rekey --take 1` (digest, exit 3), then 12 takes | medians 57.2 / 58.5 / 52.5 / 50.5 s, all identical |
| 13:46-17:13 | re-screen databases (11) with sizes, `rescreen-check` (3 rounds each tree), `rescreen-runs` | see the report; head's first 1,000-entry take invalid (end load 4.37), retaken on `-r5` |
| 17:18-17:25 | the gate × 3 | p95 72.1, 77.3, 69.8 ms; 7 passed each; exit 0 |
| 17:25-18:27 | `2m-import --part 1..4` side by side, `5..7` one tree at a time | exit 0; sync 124 → 455 s a part |
| 18:27-18:36 | head `2m-snapshot --as before-last` (×3) | exit 1 each: finding 1 |
| 18:36-18:55 | `2m-import --part 8` base (518.9 s), head (521.9 s, slow-statement log on); head `2m-snapshot --as table` | file `58a925aa…` at both; the longest statement 183,493 ms `insert into watchlist_key_df`; the snapshot exit 1 |
| 18:55-19:02 | `2m-measure` × 3 alternating; `2m-unlisted`; head `2m-shares --switch retrieval-reach` | base 319.7 / 323.8 / 338.7, head 330.2 / 320.0 / 340.0 ms; share −10.9 ms, identical |
| 19:02 | `benchmark:performance --step identity` | 300 of 300 identical at each scale, `same: true` |
| 19:04-20:40 | the quality steps (6B set; scale population at 100k and 2m, 2m in 8 parts) both trees; `benchmark:quality --step identity` | 49,800 + 10,350 + 10,350 pairs identical, `same: true` |
| 20:41-21:28 | lists: `--seed`, 18 `--measure` takes, 6 scratch probes, 3 `--cold-list`, `--teardown`; `calibration-report --face-list` | see `lists-phase11.md` |

### Finding 1's evidence (the 2,000,000-name copy)

```
$ perf.sh head - 0 2m-snapshot --as before-last
Error: Connection terminated unexpectedly
    at async copyDatabase (benchmark-write-steps.mjs:252:5)
server log: LOG:  server process (PID 82513) exited with exit code 2
            LOG:  terminating any other active server processes ... database system is ready to accept connections
```

- Three snapshot attempts at `before-last` (18:27, 18:28, 18:36) and one at `table` (18:55), each the
  same; `create database probe_copy template test strategy wal_log` by hand: the same exit 2;
  with `log_min_messages = debug1` (then reset) the backend logs nothing before it exits.
- The orphan directory of one failed copy holds `watchlist_names`' main fork at 619,708,416 of
  756,006,912 bytes; the others stopped at 592 MB and 722 MB of the 2.3 GB database.
- Controls: a synthetic 1.4 GB database (`generate_series`, 3,000,000 rows) copies with `strategy
  file_copy` in the same container (38 s) and in a plain container of the same image (`cal11d-probe`,
  44 s; stopped after); a copy while `pg_isready` hits the template every 100 ms succeeds; the volume
  has 871 GB free; `ulimit` and the cgroup limits are unlimited. The probe databases were dropped.
- Consequence: no 2,000,000-name write step ran (C270.1 identity and timing, C270.2's confirmation,
  C270.3 and C269.4). The benchmark files may not change after the seed, so nothing was fixed.

### The 2,000,000-name sync's longest statement (amendment 7)

`alter system set log_min_duration_statement = 1000` on `evaluation-6-2m-c11d-head` before part 8, the
log read after it (durations and statement kinds only), then `alter system reset` and reload: 53
statements over 1 s; the longest 183,493.2 ms (`insert into watchlist_key_df (source_id, key, count)`),
then 12,009.7, 11,466.5 and 10,876.0 ms (`insert into watchlist_names …`), `vacuum analyze
watchlist_entries` 3,269.1 ms.

## 5. Reports

| Commit | What |
| --- | --- |
| `22f55c099` | `docs/calibration/watchlist-phase11.md` published, summary block 18 rows |
| `d3199ca6f` | `docs/calibration/lists-phase11.md` published, summary block 4 rows |

Before each: `(cd load && uv run python report.py check ../docs/calibration/<report>.md)` exit 0;
`(cd load && uv run pytest tests/test_report.py -q --no-cov)` 32 passed;
`pnpm exec prettier --check <report>` clean. Aggregates are copied to
`packages/watchlist/results/phase11-11d/` (gitignored; 464 KB).

## 6. Final gates (main tree, alone; heavy call through slot 0)

| Call | Result | Time (UTC), load |
| --- | --- | --- |
| `(cd packages/watchlist && OPENVERIFY_HEAVY_RESERVED=1 bash /tmp/openverify-heavy.sh pnpm exec vitest run --coverage --coverage.reportsDirectory=/tmp/cal11d-gate-Sz9U/coverage-watchlist)` (the package's `test` script, `vitest run --coverage`) | exit 0: 71 files, 837 tests, 98.62% lines | 21:33-21:38, 0.34 → 1.11 |
| `pnpm --filter @openverify/watchlist benchmark:typecheck` | exit 0 | 21:38-21:39 |
| `pnpm --filter @openverify/watchlist benchmark:test` | exit 0: 130 tests, 98.96% lines | 21:39 |
| `pnpm format:check` | exit 0 | 21:39-21:41, 1.63 |

## 7. Cleanup

Every benchmark container of the namespaces `c11d-*` and the lists container was torn down with its
own teardown step; `cal11d-probe` was stopped (`--rm`); `docker ps` shows none. The worktrees
`/tmp/cal11d-base` and `/tmp/cal11d-head` (with the scratch `cal11d-lists-probe.ts`) are removed with
`git worktree remove --force` after this commit. Outputs stay under `/tmp/openverify-eval-11d/`
(outside git) for fix-11d.
