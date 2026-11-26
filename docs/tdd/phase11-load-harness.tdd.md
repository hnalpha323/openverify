# Workflow 11D load-harness: TDD evidence (C268.2-C268.4, C269's scenarios)

Agent `load-harness` (Workflow 11D Stage 2, beside `matcher-write-11d` and `matcher-c787-11d`),
claude-opus-5-5, 2026-11-16. Binding: `docs/plans/phase-11.plan.md` "Workflow 11D Stage 1a
amendments (contracts-11d)" items 1-20 and the method commit `ac3fc15583558d1ad256c44fb9e39eee7ebce871`
(`docs/calibration/load-phase11.md`). Every timing here is context only (Stage 2), taken under the e2e
lock with the load average beside it; the Stage 3 calibrations decide.

## 1. vegeta's installer (C258.2, C268.1)

`infra/scripts/install-vegeta.sh` filled in `install-common.sh`'s pattern: linux x86_64 only, the
version and SHA-256 pinned by contracts-11d (12.13.0, `e8759ce4...2e61`), the asset checked against the
release's `vegeta_12.13.0_checksums.txt` and against the pin, 5xx and connection failures retried, a
4xx failing at once, an optional verified cache; the `OPENVERIFY_SKELETON` marker removed. vegeta
signs its checksum file with PGP only, so no cosign signature is asked for (contracts-11d's deviation).

RED (`3167685c9`):

```
$ bash infra/tests/install-vegeta.test.sh --offline-only     # exit 1
FAIL - install-vegeta.sh is built (no OPENVERIFY_SKELETON marker)
FAIL - the synthetic release installs vegeta, and only it (exit 3: install-vegeta: not built yet ...)
...
# 4 passed, 19 failed, 1 skipped
```

GREEN (`2d4611ef8`):

```
$ bash infra/tests/install-vegeta.test.sh --offline-only     # exit 0
# 23 passed, 0 failed, 1 skipped
$ bash infra/tests/install-vegeta.test.sh                    # exit 0 (the network half)
ok   - network: the pinned vegeta installs
ok   - network: vegeta reports 12.13.0
# 25 passed, 0 failed, 0 skipped
$ bash infra/tests/supply-chain-skeletons.test.sh            # exit 0
skip - install-vegeta.sh is no longer a skeleton (its own installer test holds it)
# 112 passed, 0 failed, 13 skipped
```

## 2. The Python harness (C268.2-C268.5, C269)

Built on contracts-11d's skeleton (its stub tests replaced by behaviour tests, a planned change):

- `driver/`: `interface.py` (the open-model `OpenModelDriver`: each planned request sent by its own
  task at its planned time on the injected clock, so a slow answer never delays the next send;
  `PlannedRequest.then` names a unit's next request from the answer, with its delay; `Outcome` keeps
  step, unit, status, planned and sent times and latency only; `Take` with the driver's CPU share
  from `time.process_time`), `clock.py` (`MonotonicClock`; `FakeClock`, a discrete-event clock for
  tests), `stats.py` (nearest-rank percentiles over the expected statuses of the measured window, the
  histogram, take validity: unexpected outcomes at 0.1%, the lag bound p99 10 ms / max 100 ms, a
  generator above 90% CPU), `cpu.py` (utime + stime and `Cpus_allowed_list` from `/proc`).
- `sampler.py`: every queue the API declares, read from `apps/api/src` at run time (62 at the base),
  with the method's `QUEUES` as a minimum; depth and the oldest waiting job's lag over a minimal RESP2
  client (no new dependency); Postgres connections and the longest idle-in-transaction gap and
  pg_stat_statements' top 20 through `docker exec ... psql`; container memory from `docker stats`;
  the API's response times from pino's `req.route`, `res.statusCode` and `responseTime` (by `reqId`,
  never a body); Workflow 11B's queue metric events.
- `report.py`: `TakeRecord`, `median_of_valid`, `verdict` (met, missed with its gap, reported,
  invalid, not-measured after six attempts, pending), `summary_row`, `results_table`,
  `build_report` from take files and its `check` command.
- `run.py` (one take to a `*.take.json` file: value in the budget's unit, validity, loads, lock
  wait, generator, CPU share and affinity, statuses and each step's figures), `receiver.py` (the
  webhook receiver: event id, name, `created-at` and arrival only).
- `scenarios/`: `seed.py` (the 0600 seed record `openverify/load-seed@1`), `common.py` (arrivals, the
  spread, documentation addresses only, headers, TOTP as the API checks it, multipart, synthetic
  PNGs, polling) and a `plan(seed, rate_per_s, duration_s, *, offset)` for every HTTP scenario.
- `vegeta/targets.py`: JSON targets streamed to `vegeta attack -lazy` on stdin (no key on disk), the
  attack pinned with `taskset -c 10`, results decoded without bodies, the 99% achieved-rate rule,
  vegeta's CPU time from `wait4`'s rusage.

Stubs (`772dd7760`, rule 5), then RED (`18be20569`):

```
$ (cd load && uv run mypy .)        # Success: no issues found in 49 source files
$ (cd load && uv run pytest -q --no-cov)                      # exit 1
FAILED tests/test_driver.py::test_each_request_is_sent_at_its_planned_time_whatever_the_server_does
  - driver.interface.NotBuiltError: take: not built yet (Workflow 11D load-harness)
...
104 failed, 99 passed in 2.15s
```

GREEN (`7ff050cf4`):

```
$ (cd load && uv run ruff check && uv run ruff format --check && uv run mypy . && uv run pytest)
All checks passed!
49 files already formatted
Success: no issues found in 49 source files
TOTAL                                 1601     31    418     33    97%
Required test coverage of 80% reached. Total coverage: 96.83%
203 passed in 10.29s
```

## 3. The load stack override (C268.4, V10; KP11-37)

`infra/load/docker-compose.load.yml` (project `openverify-load`) over the compose `app` profile:
`openverify_load` with `pg_stat_statements` preloaded (the base's parameter-logging guard kept); a
one-shot `runtime-role` service that creates `openverify_runtime` (LOGIN) and the extension; migrate
runs `node dist/commands/db-migrate.js && node dist/commands/db-grant-runtime.js openverify_runtime`
with `OPENVERIFY_MIGRATION_DATABASE_URL` as the owner; the API and the worker connect as
`openverify_runtime`; every container on `cpuset: "0-9"`; the chart's memory limits (api 1g, worker
1536m, dashboard 512m, flow 256m, vision 4g, code-runner 1g), no CPU limit, worker concurrency 4;
its own bridge network `172.30.240.0/24` whose gateway `172.30.240.1` is `OPENVERIFY_TRUST_PROXY`;
the console's trusted hops 1; development mode; Connect on; the sandbox `deviceIntegrity` provider;
the worker reaches `host.docker.internal` (host-gateway) with private networks allowed; no rate
limit raised. The env template `infra/load/load.env.example` (loopback ports 25432, 26379, 29000,
29001, 21025, 28025, 23000, 25173, 23001; change-me secrets) and its generator
`infra/load/make-load-env.sh` (mode 0600 under `/tmp/openverify-load`, never overwritten, prints no
value, adds the host-side URLs).

RED (`cbbfcde24`):

```
$ bash infra/tests/load-compose.test.sh --static-only        # exit 1
FAIL - infra/load/docker-compose.load.yml exists
FAIL - infra/load/load.env.example exists
FAIL - infra/load/make-load-env.sh exists
FAIL - make-load-env.sh is executable
# 0 passed, 4 failed, 0 skipped
```

GREEN (`832ae99d2`, prettier `0a04456b3`):

```
$ bash infra/tests/load-compose.test.sh --static-only        # exit 0
# 103 passed, 0 failed, 1 skipped
$ bash infra/tests/load-compose.test.sh                      # exit 0 (renders `docker compose config`)
# 118 passed, 0 failed, 0 skipped
```

## Checkpoint 1 (python): the harness, the installer and the override

Gate: affected scope (rule 27). The checkpoint changed `load/` (no pnpm package), `infra/scripts/`,
`infra/tests/` and `infra/load/` only, so the filter `...[69fd529c0]` selects no pnpm package of
mine: no lint, typecheck or unit suite of a package, no integration and no e2e call applies.

| Call | Result | Time (load start -> end) |
|---|---|---|
| `pnpm format:check` | exit 0, "All matched files use Prettier code style!" | 151 s (3.93 -> 3.9) |
| `(cd load && uv run ruff check && uv run ruff format --check && uv run mypy . && uv run pytest)` | exit 0, 203 passed, 96.83% | 10 s |
| `bash infra/tests/install-vegeta.test.sh --offline-only` / network half | exit 0, 23 + 1 skipped / 25 | 3 s / 6 s |
| `bash infra/tests/supply-chain-skeletons.test.sh` | exit 0, 112 passed, 13 skipped | 2 s |
| `bash infra/tests/load-compose.test.sh --static-only` / full | exit 0, 103 + 1 skipped / 118 | 1 s / 3 s |

## 4. seed:load (C268.3; Stage 1a amendments 10 and 16)

`apps/api/scripts/seed-load.ts` (the entry; the file operations through `nodeFiles`, so no `src/`
module imports the file system) over `apps/api/src/seed/load-seed.ts` (arguments, settings and the
refusals, `assertLoadDatabase`, `runLoadSeed`) and `apps/api/src/seed/load/` (`counts.ts`: the
spread table at both scales; `record.ts`: the 0600 record `openverify/load-seed@1`, created
exclusively and renamed into place; `steps.ts`; `lists.ts`: keyed lists through the importer's own
`createListItemWriter` and the transaction type with keyed transactions through
`searchableFieldKeys`; `watchlists.ts`: the heavy-headed tables through `syncWatchlistSource`).
Steps: organisations (18 organisations, 36 environments, `require-mfa` on, the load template with
Play Integrity's notice in every sandbox, the default report templates, graph templates in
`load-s01`...`s08` both kinds, import lists in `s13`...`s16`, the `load-b` webhook to
`http://host.docker.internal:28080/hook`, the published `Load payment` type), principals (every key
pool, TOTP-enrolled users with one synthetic password hashed once), accounts, inquiries (approved,
needs_review, created; parts of 50,000 rows), lists, transactions (parts), graph, connect (an
active `load-a` to `load-b` connection with the sample policy), watchlists (part 1 the
100,000-name table; parts 2-9 the 2,000,000-name one at the reference scale), verify.

Stubs `648e1067c`, RED `f43bf17c0`:

```
$ pnpm exec vitest run src/seed/load-seed.test.ts --coverage.enabled=false           # exit 1
      Tests  32 failed | 1 passed (33)
$ pnpm exec vitest run --config vitest.integration.config.ts --project api src/seed/load-seed.integration.test.ts   # exit 1
Error: loadSeedSettingsFromEnv: not built yet (Workflow 11D load-harness)
      Tests  6 skipped (6)
```

GREEN `18e29b3e5`:

```
$ pnpm exec tsc --noEmit -p tsconfig.json                                            # exit 0
$ pnpm exec vitest run src/seed/load-seed.test.ts --coverage.enabled=false           # exit 0
      Tests  33 passed (33)
$ bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/seed/load-seed.integration.test.ts   # exit 0
      Tests  6 passed (6)    Duration  46.98s
```

## 5. The small-scale proof (the smoke run; context only, never a result)

Images (each its own `docker build` under the e2e lock, lock wait 0 s, from the tree at about
`18e29b3e5`): api 270 s (load 5.73 -> 18.78), dashboard 225 s, code-runner 58 s, flow 54 s, vision 4
s (cached). Digests: api `sha256:f6b2feea...7b9e`, dashboard `sha256:b1f3defd...c28e`, code-runner
`sha256:654f6b7c...297a`, flow `sha256:06f262c0...50b`, vision `sha256:cacebd29...ed5`.

Stack: `infra/load/make-load-env.sh`, then `up --detach --wait --no-build` under the e2e lock (`-w
120`): 39 s (load 7.21 -> 7.62). Read back: every container `cpuset=0-9`, no CPU limit; memory api
1 GiB, worker 1.5 GiB, dashboard 512 MiB, flow 256 MiB, vision 4 GiB, code-runner 1 GiB; the
network `172.30.240.0/24`, gateway `172.30.240.1`; migrate: "db:grant-runtime: granted
openverify_runtime 191 tables and views (2 append-only ...), 20 sequences, MAINTAIN on 4 tables,
EXECUTE on 2 functions ...; never CREATE".

Seed (small): organisations 13 s, principals 8 s (32 keys, 40 users), accounts 9 s (200, 6, 320),
inquiries 17 s (500 / 600 / 100 / 400 / 60 / 2 / 12), lists 11 s (100 / 100 / 1,000 / 100 / 2 per
organisation), transactions 15 s (2,000; 6,000 field keys), graph 6 s, connect 7 s, watchlists 115 s
(100,000 names, 60,506 entries), verify 8 s. Record 95 KB, mode 0600.

The trusted gateway: 51 sign-ins from `X-Forwarded-For: 192.0.2.80` with 51 different emails: 50
answered 401 and the 51st 429 (the per-address bucket), then one from `192.0.2.81` answered 401: the
documentation address reaches `request.ip` and keys the limiter.

One take of each scenario (`taskset -c 11 uv run python run.py take ...` under the e2e lock, each
its own hold; machine load 4.9 to 21.5 from the other Stage 2 agents' suites, so every figure is
context only):

| Scenario | Rate, seconds | Statuses | Value | Valid |
|---|---|---|---|---|
| api-reads (driver) | 5/s, 10 s | 200 x 50 | p95 49.5 ms | yes |
| api-reads (vegeta, with the sampler) | 5/s, 15 s | 200 x 75 | p95 78.6 ms | yes |
| api-writes | 5/s, 10 s | 200 x 30, 201 x 20 | p95 146.9 ms | yes |
| transactions-write | 5/s, 10 s | 201 x 50 | p95 105.9 ms | yes |
| transactions-search | 5/s, 10 s | 200 x 50 | p95 40.6 ms | no: lag p99 13.3 ms |
| lists-match (driver; vegeta) | 5/s, 10 s | 200 x 50; 200 x 50 | p95 29.0 ms; 41.6 ms | yes; yes |
| flow-upload | 1 upload/s, 10 s | 200 x 10, 201 x 25, 202 x 15 | upload p95 0.289 s | no: lag p99 11.7 ms |
| console-login | 0.2/s, 10 s | 202 x 2, 201 x 2 | password p95 122 ms | no: lag p99 23.8 ms |
| graph-queries | 1/s, 10 s | 201 x 10, 200 x 10 | submit to completed p95 420 ms | yes |
| connect-redeem | 0.5/s, 10 s | 201 x 15, 202 x 5, 200 x 5 | redeem p95 0.0545 s | yes |
| account-export | 0.2/s, 10 s | 202 x 2, 200 x 2 | submit to ready 2.29 s | no: lag p99 11.6 ms |
| screening-throughput | 1/s, 10 s | 201 x 10, 200 x 10 | 3,600 settled an hour | yes |
| webhook-first-attempt | 2/s, 10 s, receiver on the host | 201 x 20; 20 events received | event to first attempt p95 155 ms | yes |
| fairness (flood of 10) | victim 1/s, 10 s | 201 x 20, 200 x 10 | victim p95 2,182 ms | no: lag |
| verification | 0.2 sessions/s, 10 s | 200 x 14, 201 x 10, 202 x 8 | submit to decision median 2.10 s | yes |
| soak (mixed) | 16/s, 10 s | 409 x 15 (reused inquiries) | none (growth from the sampler) | no |
| limiter-refusal (API) | 10/s, 35 s | 200 x 350 | no 429 (see the finding below) | no |
| lists-import | 300 rows a kind | 201 x 4, 200 x 4 | import to ready 2.19 s | no: lag p99 103 ms |

The sampler beside the vegeta take: 4 samples of 62 queues, connections by client container
(`openverify-load-api-1` 2 idle, `openverify-load-worker-1` 3 idle), container memory (api 250.6 MiB);
`statements --top` 20 rows; `server-times` (after the fix below) 31 lines; `metrics` 0 events (no
admission reached a cap). `report.py build` over the take files wrote a report whose block passes
`report.py check` (exit 0). Down: `down --volumes` under the e2e lock (29 s; the first attempt met
the lock's 120 s wait and ran nothing); `docker compose -p openverify-load ps -q` empty, no
`openverify-load` volume left; the env file, the record and the cursor file removed.

What the smoke run found, each fixed test-first: the redemption needs the clone's template
(`26484c151` RED, `db1160471` GREEN); the scenarios mirror the seed (`6526fb6cd`, `a612433c6`); the
API logs `requestId`, not `reqId`, and pools are told apart by client container (`fb33e51f6`,
`44aabe5ff`); every poll ends on its resource's declared vocabulary (an importer ends `ready`; the
first import take polled for 10 minutes and was stopped, its lock released; `e9d48c884`,
`79199f57f`); a shared cursor keeps takes off each other's inquiries (`e0f2a115f`, `3a51024f7`); the
login refusal as its own take (`6c8f7e843`, `41591bce8`). Not fixed (the method's, not the
harness's): under GCRA (`apps/api/src/rate-limit/index.ts`: one request every 200 ms with a burst of
the whole limit), one key at 10/s meets its first 429 after about 60 s, so the method's "10 a second
for 60 s" shows at most a refusal or two; a contractDeviation for `calibration-load-11d`.

## 6. The method's tools (items (b), (d), (f) to (h); R007; 10A's analytics item)

| Tool | Stub | RED | GREEN |
|---|---|---|---|
| R007: `graph:benchmark --shape dense` (strong rings of 100), the default shape row for row | `6229f2be0` | `d8aa27a1d` (2 failed, 2 passed) | `6ee7d5ccc` (41 graph tests passed with synthetic.test.ts, graph-hooks and the benchmark target) |
| 10A's item: `analytics:benchmark` seeds one case for every 20 inquiries (`benchmarkCasesStatement`) | `84adef72b` | `01250ecd5` (2 failed, 1 passed) | `561fe5d96` (3 passed; refresh test passes) |
| (b), (d): `scripts/network-benchmark.ts` with `load/mmdb/network-lookup.mjs` and `verify-city-lite.mjs` | `1c230b243` | `3501e4683` (5 failed, 2 passed) | `efb6c706e` (7 passed) |
| (h): `scripts/lists-benchmark.ts` (seed, measure with `--cap`, cold face list) | `3fbc40249` | `947c84f6d` (10 failed) | `96cbb56d5` (10 passed) |
| (i): `calibration-report --face-list` (`src/calibration/face-list.ts`) | `4abe783f0` | `e4b133872` (6 failed, 1 passed) | `8bed596e8` (7 passed) |

Borrowed edits (each its own commit): `apps/api/src/commands-build.test.ts`
(`UNLISTED_DEVELOPMENT_SCRIPTS` gains the two scripts, `9f45b4723`), `infra/tests/images.test.sh`
(the API image leaves them out, `a9a8ac32d`), `packages/checks/scripts/calibration-report.ts`
(`--face-list`, in `8bed596e8`), `apps/api/src/services/graph/{synthetic,benchmark}.ts` and
`apps/api/scripts/graph-benchmark.ts` (R007), `apps/api/scripts/analytics-benchmark.ts`.

The face-list mode ran once on Phase 4's measurements (707 identities, 200 replicates, seed 123,
through `node --experimental-transform-types ... scripts/calibration-report.ts`): it wrote its JSON;
the package's `calibration:report` script itself stops on core's parameter properties without
`--experimental-transform-types` (it does so in `--selfie` mode too, before 11D; a followup).

## 7. A fix the end gates found

The API unit suite's F20 guard (`src/services/list-writes.test.ts`, "services/lists/item-writer.ts:
its callers stage") failed on `seed/load/lists.ts`, which called `insertItems` and staged no
`list.updated`. The guard was the failing test (RED, in the first merged run below); the seed now
stages `list.updated` once per list it writes, through `stageListUpdated` with the outbox-only
publisher (`154bca607`, GREEN: `list-writes.test.ts` and `load-seed.test.ts` 56 passed; the seed's
Testcontainers test 6 passed). The same merged run's `operator-patterns.test.ts` CPU budget (114.8
ms against 100 at load 15 to 30) passed alone (9 passed) and in the second merged run.

## 8. End gates (foreground; load averages from /proc/loadavg)

```
$ (cd load && uv run ruff check && uv run ruff format --check && uv run mypy . && uv run pytest)   # exit 0
All checks passed!   50 files already formatted   Success: no issues found in 50 source files
Required test coverage of 80% reached. Total coverage: 96.58%    223 passed in 17.37s
$ bash infra/tests/install-vegeta.test.sh                    # 25 passed, 0 failed, 0 skipped
$ bash infra/tests/install-vegeta.test.sh --offline-only     # 23 passed, 0 failed, 1 skipped
$ bash infra/tests/supply-chain-skeletons.test.sh            # 112 passed, 0 failed, 13 skipped
$ bash infra/tests/load-compose.test.sh                      # 118 passed, 0 failed, 0 skipped
$ bash infra/tests/load-compose.test.sh --static-only        # 103 passed, 0 failed, 1 skipped
$ NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run typecheck lint --force --filter=@openverify/checks   # 2 successful, 139 s (load 18.0 -> 21.7)
$ pnpm turbo run test --force --filter=@openverify/checks    # 3856 passed; All files 98.79 / 91.5 / 99.34 / 98.79; 72 s
$ NODE_OPTIONS=--max-old-space-size=4096 bash /tmp/openverify-heavy.sh pnpm turbo run typecheck lint --force --filter=@openverify/api   # 2 successful, 13m24s (load 15.2 at start)
$ (apps/api) 12 x bash /tmp/openverify-heavy.sh pnpm exec vitest run --coverage --shard=k/12 --reporter=blob ...   # second run after 154bca607: 140-301 s each, load 10.4-28.4
$ (apps/api) bash /tmp/openverify-heavy.sh pnpm exec vitest run --merge-reports=<blobs> --coverage   # exit 0, 76 s (load 9.74 -> 4.50)
 Test Files  868 passed (868)      Tests  10960 passed (10960)
All files          |   93.42 |    84.23 |   96.07 |   93.59 |
$ pnpm test:integration, five calls through the heavy script:
  pnpm --filter @openverify/db test:integration                                  # 23 files, 110 passed, 185 s
  (apps/api) vitest run --config vitest.integration.config.ts --project graph     # 1 file, 13 passed, 59 s
  (apps/api) ... --project api --shard=1/3                                       # 26 files, 121 passed, 221 s
  (apps/api) ... --project api --shard=2/3                                       # 26 files, 139 passed, 332 s
  (apps/api) ... --project api --shard=3/3                                       # 26 files, 196 passed, 204 s
$ pnpm format:check                                          # exit 0, 221 s
$ bash infra/tests/images.test.sh static                     # 149 passed, 0 failed
$ flock -E 75 -w 240 /tmp/openverify-e2e.lock bash infra/tests/images.test.sh api   # 57 passed, 0 failed; 114 s (load 27.4 -> 15.2)
ok   - api: leaves the development tool lists-benchmark out
ok   - api: leaves the development tool network-benchmark out
$ docker compose -p openverify-load ps -a -q | wc -l          # 0; no openverify-load volume; /tmp/openverify-load gone
```
