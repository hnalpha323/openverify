# Workflow 11D calibration-load-11d: evidence (C268, C269, C272; Workflows 7A and 7B's rows)

Agent `calibration-load-11d` (Workflow 11D Stage 3, first, alone on the machine), claude-opus-5-5,
2026-11-16. Binding: the method commit `ac3fc15583558d1ad256c44fb9e39eee7ebce871`
(`docs/calibration/load-phase11.md`, "Method"), the plan's "Workflow 11D Stage 1a amendments
(contracts-11d)" and the Stage 2 reports. The report is `docs/calibration/load-phase11.md`; the take
files are under `load/results/reference/` (outside git). Every take ran under the e2e lock, one per
hold, with the lock wait (0.003 to 0.006 s for every take: nothing else asked for the lock) and the
1-minute load at its start and end beside it.

## 0. Start

- Head `2d3134755`; no other agent, test suite, build or compose project running (`ps`, `docker
  ps`: only the owner's idle session processes); load 0.14 at the start.
- The machine (2026-11-16): Intel Xeon E5-1650 v3 at 3.50 GHz, 6 cores / 12 logical CPUs, 31 GiB,
  WSL2 virtual disks (`sdd`, `sdf`: 1 TB virtual disks on the host's SATA SSD), Linux
  6.18.40.1-microsoft-standard-WSL2, Docker Desktop 29.7.2 (12 CPUs, 31.3 GiB), Node v22.22.1.
- The images, rebuilt from the head, each its own `docker build` under the e2e lock (lock wait 0 s):

  | Image | Seconds | Load (start -> end) | Digest |
  |---|---|---|---|
  | `openverify/api:11c-local` | 148 | 0.16 -> 2.12 | `sha256:425d0efb7761be11f99711956a29a5112b1599698aa056493c714a3aeedc2cf8` |
  | `openverify/dashboard:11c-local` | 119 | 2.11 -> 2.13 | `sha256:5c1b5e588fd01e07301e2724531868f6d8a280d58dd5cc690bd13d1b6134075f` |
  | `openverify/flow:11c-local` | 41 | 2.13 -> 2.16 | `sha256:4e4b91bf7cc8892dfb62b50fa75e83f704872f93e557f84eff9e364039363f80` |
  | `openverify/code-runner:11c-local` | 44 | 2.16 -> 1.99 | `sha256:4f0fcc564ef23cf2eb4c8690646d8e8c6c6441e4fc8788ea348aabb36edbfb0b` |
  | `openverify/vision:11c-local` | 3 (cached) | 1.99 -> 1.91 | `sha256:0920856b09610dca61aa7137f87103e611dd350bfbc7075ee265a012b25e9070` |

## 1. The stack and the seed

```
$ infra/load/make-load-env.sh                    # make-load-env: wrote the load stack's env file (mode 0600)
$ flock -E 75 -w 120 /tmp/openverify-e2e.lock docker compose -p openverify-load -f infra/docker-compose.yml \
    -f infra/load/docker-compose.load.yml --env-file /tmp/openverify-load/load.env --profile app up --detach --wait --no-build
up rc=0 seconds=28 load=1.62->2.86 lockwait=0.004
```

Read back (`docker inspect`): every container `cpuset=0-9`, `NanoCpus=0`; memory api 1 GiB, worker
1.5 GiB, dashboard 512 MiB, flow 256 MiB, vision 4 GiB, code-runner 1 GiB; migrate: "db:grant-runtime:
granted openverify_runtime 191 tables and views (2 append-only ...), 20 sequences, MAINTAIN on 4
tables, EXECUTE on 2 functions ...; never CREATE".

`seed:load --scale reference`, each step its own call under the e2e lock (lock wait 0 s):

| Step | Seconds | Load | Output |
|---|---|---|---|
| organisations | 8 | 2.58 -> 2.70 | organisations 18, environments 36 |
| principals | 39 | 2.48 -> 1.87 | keys 685, users 4000 |
| accounts | 75 | 1.87 -> 1.84 | accounts 20000, exportAccounts 60, graphAccounts 32000 |
| inquiries 1-4 | 160, 160, 162, 177 | 2.02 -> 1.65 | 167,300 (settled 50,000; review 60,000; write 10,000; flow 40,000; verification 6,000; connect sources 100; export 1,200) |
| lists | 117 | 1.52 -> 1.86 | per organisation: email 10,000, phone 10,000, name 100,000, IP 10,000, country 20 |
| transactions 1-4 | 131, 129, 130, 131 | 1.80 -> 1.25 | 200,000 |
| graph | 5 | 1.15 -> 1.22 | graphEnvironments 16 |
| connect | 5 | 1.22 -> 1.36 | connections 1, sources 100 |
| watchlists 1 | 71 | 1.38 -> 1.76 | names 100000, entries 60506 |
| watchlists 2 | 109 | 1.76 -> 1.74 | **exit 1: "the watchlist table did not apply: refused_mass_removal"** (section 2) |
| verify | 5 | 1.38 -> 1.83 | every key pool complete; inquiries 167300 (record = database), accounts 98160, keys 685 |

## 2. A harness defect fixed test-first before the take it affects: the 2,000,000-name seed

Part 2 replaces the sandbox source's 100,000-name table with the first eighth of the 2,000,000-name
table, which the sync's mass-removal guard refuses. Named borrowed edit of
`apps/api/src/seed/load/watchlists.ts` (load-harness's path), before any take of
`screening-throughput-2m` (method amendment 1):

- stub `1b2119e00` (`allowsMassRemoval(part)`, returning false);
- RED `b00f35d2c`:

  ```
  $ (apps/api) pnpm exec vitest run src/seed/load-seed.test.ts --coverage.enabled=false     # exit 1
   FAIL  src/seed/load-seed.test.ts > ... > lets only part 2 remove the 100,000-name table, the switch to the 2,000,000-name one
  AssertionError: expected false to be true // Object.is equality
        Tests  1 failed | 33 passed (34)
  $ (apps/api) pnpm exec tsc --noEmit -p tsconfig.json                                      # exit 0
  ```

- GREEN `155d2e9d1` (`part === 2`, passed to the sync as `allowMassRemoval`):

  ```
  $ (apps/api) pnpm exec vitest run src/seed/load-seed.test.ts --coverage.enabled=false     # exit 0
        Tests  34 passed (34)
  $ pnpm exec tsc --noEmit -p tsconfig.json; pnpm exec eslint src/seed/load/watchlists.ts src/seed/load-seed.test.ts   # exit 0, 0
  ```

## 3. The default network sources (method item (a); amendment 2)

No harness tool imports them. A scratch generator (outside git), `/tmp/cl11d/tools/net-files.mjs`,
writes the nine default sources' publisher files with `@openverify/signals/testing`:
`writeMemoryFiles(dir, 1)`'s Country and ASN Lite MMDBs (8,362,230 and 9,575,662 bytes, padded to the
measured sizes), `syntheticTorExitList({ relays: 384 })` (the generator's maximum), AWS, Google and
Oracle range files with 200/100/100 IPv4 and the rest of `MEASURED_SOURCES.rangePrefixes` as IPv6
prefixes, the two geofeeds with 1,235 and 5,505 rows, and Cloudflare's fixed file. Each imported
under the e2e lock:

```
$ pnpm --filter @openverify/api network:sync --import <file> --source <id> --json   # per source, env from load.env
{"sourceId":"dbip-country-lite","entryCount":256,"snapshotBytes":8362230,"outcome":"applied",...}
{"sourceId":"dbip-asn-lite","entryCount":256,"snapshotBytes":9575662,"outcome":"applied",...}
{"sourceId":"tor-exit-addresses","entryCount":583,"snapshotBytes":37409,"outcome":"applied",...}
{"sourceId":"aws-ip-ranges","entryCount":18603,"snapshotBytes":1605128,"outcome":"applied",...}
{"sourceId":"gcp-cloud","entryCount":1137,"snapshotBytes":87211,"outcome":"applied",...}
{"sourceId":"oracle-public-ip-ranges","entryCount":1211,"snapshotBytes":94559,"outcome":"applied",...}
{"sourceId":"digitalocean-geofeed","entryCount":833,"snapshotBytes":72248,"outcome":"applied",...}
{"sourceId":"linode-geofeed","entryCount":3962,"snapshotBytes":323474,"outcome":"applied",...}
{"sourceId":"cloudflare-ips","entryCount":6,"snapshotBytes":617,"outcome":"applied",...}
```

The API and the worker pick a new snapshot up within `NETWORK_SNAPSHOT_RECHECK_MS` (60 s); the
worker's `network_sources_stale` fell from 9 to 1.

## 4. A harness defect fixed test-first: vegeta's fractional rate

The first `lists-match` step (0.25 times 10/s = 2.5/s) stopped before any request was measured:
`RuntimeError: vegeta attack exited 2` (`-rate=2.5/1s`; vegeta takes whole requests per period).
Named borrowed edit of `load/vegeta/targets.py`, before any `lists-match` take was taken:

- RED `d84439d98`:

  ```
  $ (cd load && uv run pytest tests/test_vegeta.py -q --no-cov)                              # exit 1
  FAILED tests/test_vegeta.py::test_a_fractional_rate_is_whole_requests_over_a_longer_period
  1 failed, 12 passed in 0.19s
  ```

- GREEN `3a89c40ca` (`rate_flag`: `-rate=<n>/1s` for a whole rate, `-rate=<rate x 1000>/1000s` else):

  ```
  $ (cd load && uv run ruff check && uv run ruff format --check && uv run mypy . && uv run pytest)   # exit 0
  Success: no issues found in 50 source files
  Required test coverage of 80% reached. Total coverage: 96.59%    224 passed in 7.36s
  ```

## 5. The tools of the takes (scratch, outside git)

- `/tmp/cl11d/tools/take.sh <out> <label> <idle timeout> <run.py take args>`: under
  `flock -E 75 -w 240 /tmp/openverify-e2e.lock`: the idle baseline (`idle.py`: load at most 4 and no
  queue depth, waited for), the containers' restart counts and start times before and after,
  `sampler.py statements --reset`, `sampler.py loop` beside the take on `taskset -c 11`, `run.py take`
  on `taskset -c 11` (vegeta on `taskset -c 10` inside it), then `statements --top`, the five longest
  statements by `max_exec_time`, `server-times` for the measured window and `metrics`.
- `/tmp/cl11d/tools/steps.sh <scenario> <pool|-> <stepup|take> <base> <idle timeout> <multiples or
  numbers> -- <args>`: one `take.sh` per step or take, with `--offset` from the pool's cursor
  (`next.py`; method amendment 3); step-ups are 30 s of warm-up and 120 s measured, takes 60 s and
  300 s.
- `analyse.py`: the take's figures with the server's p95 over the measured step's routes and the
  sampler's largest queue lag, connections per container and memory.

Per-pool offsets: writes start at 130,000 (the soak keeps 0 to 130,000 of the writes and 0 to 13,000
of the flow pool), flow at 13,000.

## 6. The takes (the report's Results list every one)

Order of the run (2026-11-16 19:52 UTC to 2026-11-17 12:50 UTC), each take its own e2e-lock hold,
lock wait 0.003 to 0.007 s for every take, the idle baseline (load at most 4, no queue depth) before
each: `api-reads` (step-up, 3 takes), the amendments 1-8 commit `0575f9fd0`, `api-writes`,
`transactions-search`, `transactions-write` (6 attempts), amendment 4's `lists-match` line
(`1dbee3edd`), the vegeta fix (section 4), `lists-match`, `flow-upload` (6 attempts),
`console-login`, `webhook-first-attempt` (step 0.25 twice, 1 take), `connect-redeem` (6 attempts),
`graph-queries`, `lists-import` (3), `account-export` (2), `verification` (step-up, 2 takes),
`screening-throughput` 100,000 names c4 and c1 (worker restarted with a one-variable override
`/tmp/cl11d/worker-c1.yml`: `services.worker.environment.OPENVERIFY_WORKER_CONCURRENCY: "1"`),
amendment 9 (`91c812621`), fairness at the default cap and at "ceiling 200", the API limiter (3),
the login limiter (background), the soak (background, stopped at minute 58: the driver saturated),
amendment 10 (`74e2b167b`), the jit comparison (reads 6, writes 9, screening 7), the 2,000,000-name
import (parts 2-9: 150, 183, 231, 309, 385, 415, 471, 512 s; 2,000,000 names, 412,529 entries),
`screening-throughput` 2,000,000 names c4 (6 attempts) and c1 (4), the process memory at rest, the
stack down, `network-lookup` (3), the City Lite fetch (refused, 403), `workflow-steps` (3) and the
dense graph run (background).

A mistake in the run, listed: one call passed an argument `run.py` refuses (`--configuration-ignore`);
`run.py` exited 2 before sending anything and the sampler's 150 s ran empty; no take file was made
(the files are kept in `screening-throughput/argparse-mistake/`). The 100,000-name c4 step-up ran 1,
2, 3, 4 and 6 times its base instead of 1, 1.5, 2, 3, 4 (the report says so).

## 7. The stack down

```
$ flock -E 75 -w 240 /tmp/openverify-e2e.lock docker compose -p openverify-load -f infra/docker-compose.yml \
    -f infra/load/docker-compose.load.yml --env-file /tmp/openverify-load/load.env --profile app down --volumes
rc=0 (15 s)
$ docker compose -p openverify-load ps -a -q            # prints nothing
$ docker volume ls --format '{{.Name}}' | grep -c openverify-load     # 0
```

`/tmp/openverify-load/{load.env,seed.json,cursors.json}` removed. The scratch tools stay under
`/tmp/cl11d/tools/` (take.sh, steps.sh, next.py, idle.py, analyse.py, throughput.sh, webhook.sh,
jit.sh, soak.sh, bg-take.sh, graph-dense.sh, net-files.mjs, summary.py); three
`/tmp/cl11d-netlookup-*` directories hold `network-lookup`'s synthetic files (the hook refused their
removal; remove them by hand).

## 8. The report

`docs/calibration/load-phase11.md` published (`875629871`): the summary block written by
`/tmp/cl11d/tools/summary.py` through `load/report.py`'s `summary_row` and `check_summary`:

```
$ (cd load && uv run pytest tests/test_report.py -q --no-cov)          # 32 passed
$ (cd load && uv run python report.py check ../docs/calibration/load-phase11.md)   # exit 0
```

## 9. Final gates (foreground)

```
$ (cd load && uv run ruff check && uv run ruff format --check && uv run mypy . && uv run pytest)   # exit 0
All checks passed!   50 files already formatted   Success: no issues found in 50 source files
Required test coverage of 80% reached. Total coverage: 96.59%    224 passed in 6.63s
$ pnpm format:check                                      # exit 0, 112 s (load 0.53 -> 1.08)
$ OPENVERIFY_HEAVY_RESERVED=1 NODE_OPTIONS=--max-old-space-size=4096 bash /tmp/openverify-heavy.sh \
    pnpm turbo run typecheck lint --force --concurrency=1 --filter=@openverify/api      # exit 0, 316 s; 2 successful
$ (apps/api) bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts \
    --project api src/seed/load-seed.integration.test.ts                                 # exit 0, 6 passed, 35 s
$ (apps/api) pnpm exec vitest run src/seed/load-seed.test.ts src/services/list-writes.test.ts --coverage.enabled=false   # 57 passed
```

The API's whole unit suite (K shards and a merge) was not run for the one-function borrowed edit;
`fix-11d`'s Validation runs it.
