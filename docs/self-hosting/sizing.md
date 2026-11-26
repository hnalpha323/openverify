# Sizing

**Every figure on this page comes from one machine** (C268.7, C277.11): the reference machine of Workflow 11D's load report, `docs/calibration/load-phase11.md`, running the compose `app` profile on the production images with the chart's default memory limits, one API process, one worker process at concurrency 4 and one vision instance, on synthetic data in development mode. One machine's figures carry ratios to other hardware, not absolutes. Size your install from your own measurement, repeating the report's method (below).

## What one process carried

- **One API process saturated near 100 reads a second.** The `api-reads` budget (p95 at most 150 ms at 100 requests a second) is **missed**: the median of three takes was 390.0 ms, a gap of +240.0 ms, and at 150 a second the process collapsed (server p95 28 s, 57% of requests timed out) while the machine's load stayed under 4: the API's event loop, not the machine, was full. Its 10 database connections were all in use at that knee, so a larger pool is not what one API process needs first; more API replicas are (the chart's `api.replicaCount` is 2, its HPA up to 4).
- **Writes** at 50 a second met their budget (130.9 ms against 300), but stalled under contention in some takes (the report's finding 2).
- **Fairness is missed at the default cap.** With one environment flooding the `report-run` queue at the shipped values (the per-environment cap 50 under the install ceiling `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`, also 50), another environment's report p95 was 26.6 times its idle p95 (2,926.0 ms against 110.0 ms; the rule is at most 2): the cap bounds the flooder's in-flight runs, not the victim's wait behind them on the shared queue (Workflow 11D review amendments item 1). At the ceiling of 200 the row is not measured. Ten other capped queues have stored caps that nothing enforces yet ([monitoring.md](monitoring.md#queues-and-caps)).
- **Screening** at 2,000,000 names: 14,592 report runs an hour per worker process at concurrency 1 (floor 10,000); at concurrency 4 not measured (every attempt was above the floor, none valid enough to count).
- **Rows not measured or invalid** carry no figure: the flow upload, verification (all three analysis medians), the webhook's first attempt, Connect redemption, the account export, the soak, the login limiter, list import and transaction writes. Each says why in the report; none is a pass.

The whole table, read from the report's summary block (generated; `pnpm --filter @openverify/docs-tools docs:selfhost` refreshes it):

<!-- openverify:selfhost-load-figures:start -->
Machine: Intel Xeon E5-1650 v3 3.50 GHz (6 cores), 12 logical CPUs, 31 GiB, WSL2 virtual disk on a SATA SSD. Head `2d3134755`; report `docs/calibration/load-phase11.md`. Read from the report's summary block by `pnpm --filter @openverify/docs-tools docs:selfhost`, never edited by hand.

| Row | What | Contract | Verdict | Median | Budget | Gap | Configuration |
|---|---|---|---|---|---|---|---|
| `api-reads` | API reads at 100 requests/s | C269.1 | missed | 390.0 ms | p95 at most 150 ms | +240.0 ms | default |
| `api-writes` | API writes at 50 requests/s | C269.1 | met | 130.9 ms | p95 at most 300 ms | -169.1 ms | default |
| `flow-upload` | Flow upload at 10 uploads/s | C269.1 | not measured | none | p95 at most 1.5 s | none | default |
| `console-login` | Console login, the password request, at 5 logins/s | C269.1 | met | 61.04 ms | p95 at most 500 ms | -439.0 ms | default |
| `console-login-totp` | Console login, the TOTP request | C269.1 | reported | 88.14 ms | none | none | default |
| `console-login-two-step` | Console login, the whole two-step sign-in | C269.1 | reported | 131.6 ms | none | none | default; fix-11d retake at 77e851b67; password to TOTP success |
| `verification-government-id` | Verification, government ID analysis median | C269.1, C32.4 | invalid | none | median at most 5 s | none | default; fix-11d retake at 77e851b67: knee 1 session/s; the take at it saturated |
| `verification-selfie` | Verification, selfie analysis median | C269.1, C41.5 | not measured | none | median at most 3 s | none | default |
| `verification-document` | Verification, 3-page PDF analysis median | C269.1, phase-5.plan.md:627 | not measured | none | median at most 4 s | none | default |
| `verification-throughput` | Verifications per worker at concurrency 4 | C269.1 | invalid | none | none | none | default |
| `webhook-first-attempt` | Event to first webhook attempt at 50 events/s | C269.1 | invalid | none | p95 at most 5 s | none | default; P002: 6,037 of 15,000 events missing |
| `screening-throughput-2m` | Screenings per hour per worker process at 2,000,000 names | C269.1 | met | 14,592 an hour | rate at least 10,000 an hour | +4,592 an hour | concurrency 1 |
| `screening-throughput-2m-c4` | Screenings per hour per worker process at 2,000,000 names, concurrency 4 | C269.1 | not measured | none | rate at least 10,000 an hour | none | concurrency 4 |
| `screening-throughput-100k` | Screenings per hour per worker process at 100,000 names | C269.1 | reported | 43,212 an hour | none | none | concurrency 4 |
| `screening-throughput-100k-c1` | Screenings per hour per worker process at 100,000 names, concurrency 1 | C269.1 | reported | 28,812 an hour | none | none | concurrency 1 |
| `connect-redeem-job` | Connect redemption, job p95 at 5 redemptions/s | C269.1, C240.3 | not measured | none | p95 at most 5 s | none | default |
| `connect-redeem-api` | Connect redemption, API answer p95 | C269.1, C240.3 | not measured | none | p95 at most 300 ms | none | default |
| `account-export` | Account export of an account with 20 inquiries | C269.1 | invalid | none | none | none | default |
| `workflow-steps` | Workflow engine steps a second at 32 clients (effectful) | C269.1 | reported | 49 a second | none | none | default |
| `fairness-default-cap` | Fairness at the default cap: victim p95 over its idle p95 (idle 110.0 ms) | C251.5, C269.2 | missed | 26.6 times | ratio at most 2 times | +24.6 times | default; fix-11d retake at 77e851b67; report's own time; the flood reached the cap |
| `fairness-ceiling` | Fairness with the flooder at the ceiling (idle 106.0 ms) | C251.5, C269.2 | not measured | none | ratio at most 2 times | none | ceiling 200; fix-11d retake at 77e851b67; one valid of five attempts |
| `soak-memory` | Soak: memory growth after warm-up | C269.3 | invalid | none | growth at most 10 percent | none | default |
| `soak-queue-lag` | Soak: time until every queue lag returns to zero | C269.3 | invalid | none | max at most 600 s | none | default |
| `limiter-refusal-api` | The API limiter's refusal | C268.5 | reported | 5.44 ms | none | none | default |
| `limiter-refusal-login` | The login limiter's refusal | C268.5, C246 | invalid | none | none | none | default; fix-11d retake at 77e851b67: one email an address-half attempt |
| `lists-import` | List import rows a second at low load | Workflow 7B (e) | invalid | none | none | none | default |
| `lists-match` | List match at 10 requests/s | Workflow 7B (e) | reported | 28.65 ms | none | none | default |
| `graph-queries` | Graph queries, submit to completed | Workflow 7B (f) | reported | 322.6 ms | none | none | default |
| `graph-dense` | graph:benchmark on a dense neighbourhood, 1,000,000 accounts | Phase 7 R007 | reported | 16.5 ms | none | none | rings of 50 (fix-11d, 89a508d75) |
| `transactions-write` | Transaction writes at 50/s | Workflow 7B (g) | not measured | none | none | none | default |
| `transactions-search` | Transaction search at 100/s | Workflow 7B (g) | reported | 470.8 ms | none | none | default |
| `network-lookup` | Network lookup over real-size snapshots, mean a call | C93.2 | met | 0.006406 ms | mean at most 1 ms | -0.994 ms | default |
| `city-lite-verify` | MmdbSnapshot.verify on City Lite | Workflow 7A (d) | not measured | none | none | none | default |
| `process-memory` | API and worker RSS with the default sources | Workflow 7A (a) | reported | 277.5 MiB | none | none | default |
| `jit-comparison` | Runtime role jit off against on, worst p95 change | C272.1 | missed | 3.93 times | ratio at most 1.05 times | +2.88 times | default |
| `role-timeouts` | The runtime role's statement timeout | C272.2 | reported | 370 s | none | none | 2 x the 2,000,000-name sync's 183.5 s rebuild statement |
| `pool-at-knee` | Database connections per process at the knee | C272.3 | reported | 10 | none | none | default |
<!-- openverify:selfhost-load-figures:end -->

## Memory

The chart's limits (`deploy/helm/openverify/values.yaml`) are the load stack's: API 1Gi, worker 1536Mi, console 512Mi, flow 256Mi, vision 4Gi, code runner 1Gi. What fills them:

- **A Node process at rest** is about 96 MiB. On the load stack the API process held 277.5 MiB RSS at rest after a restart and the worker 391.8 MiB, each with the default network sources (the report's `process-memory` row).
- **Network data** (`docs/network/README.md#memory`): each of the API and the worker adds the default sources' 46 to 53 MiB at rest and about 9 MiB more at a snapshot swap; with `dbip-city-lite` enabled (off by default) about 168 MiB at rest and 115.5 MiB more at its swap. The swap of City Lite's snapshot (`MmdbSnapshot.verify`) was not measured in 11D: DB-IP refused the pinned fetch with 403 (KP11-63, the owner's). The network lookup itself met its budget (a mean of 0.0064 ms a call).
- **Lists, transactions and the graph** (`docs/lists/README.md`, `docs/transactions/README.md`, `docs/graph/README.md`): the worker's biometric template cache holds at most 64 MB per worker process; the API holds a list importer's body (a 20 MB file is about 26.7 MB as base64) and a transaction file (at most 20,000,000 bytes, `max-file-size-bytes`) in memory, times the uploads in flight; the console holds a transaction file or a graph export whole (up to 20 MB) while it streams it.
- **Cases and workflows** (`docs/cases/export.md`, `docs/workflows/limits.md`): a JSON case export is capped at 64 MiB; renditions are made by vision; a code-runner child holds about 100 MB at its 64 MiB heap limit and the runner's server about 82 MB, so the runner's memory is its pool size times the child plus the server (`OPENVERIFY_CODE_RUNNER_POOL_SIZE`; compose's comment on its `code-runner` service).
- **Vision** holds the models and the rasters of at most its concurrent jobs in 4 GiB.

## Database connections

Each API and worker process opens up to 10 connections; at every knee 11D measured, the API's and the worker's pools were full at 10. The chart refuses to render when every replica's pool could exceed `external.postgres.maxConnections` (default 100, the server's `max_connections` less a margin), which is why `api.autoscaling.maxReplicas` defaults to 4. See [database.md](database.md).

## Scheduled work that sizes the worker

- The graph (`docs/graph/README.md`): `graph-indexing` is on by default, `graph-weak-kinds` and `graph-components` off; `graph-backfill` ticks every 60 s while an index state is incomplete, and `graph-components` runs nightly at 03:00 UTC when on. `pnpm --filter @openverify/api graph:reindex` rebuilds an environment's index.
- The analytics rollups (`docs/analytics/README.md`) and the C16 retention pass (`pnpm --filter @openverify/api retention:run`), whose longest statement on the load stack was an 18-second batch delete of `api_logs` ([database.md](database.md#timeouts)).
- The workflow engine ran 49 effectful steps a second at 32 clients (the report's `workflow-steps` row, its own database).

## How to measure your own

The method an operator repeats is the report's (C272.4): `load/` (vegeta 12.13.0 installed by `infra/scripts/install-vegeta.sh`, and the httpx driver), the load stack `infra/load/docker-compose.load.yml` over the compose `app` profile, the seed `pnpm --filter @openverify/api seed:load --scale <small|reference> --step <step>` (it refuses production mode and any database not named `openverify_load`), then `uv run python run.py take ...` from `load/` per scenario. The report's sections "The reference machine and the stack" and "Amendments", and `docs/tdd/phase11-load-harness.tdd.md`, give the run order step by step.
