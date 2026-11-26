# HTTP load: the Workflow 11D calibration (C268, C269, C272)

This report measures the platform under HTTP load on one machine, against the budgets of C269.1
(hardening 6.4's proposals, ours, accepted as proposed before anything was measured: decision 8),
the fairness rule of C251.5, the soak of C269.3, the database settings of C272, and the capacity
items Workflows 7A and 7B left to Phase 11. It is written by `calibration-load-11d`, alone on the
machine. **Status: published** (2026-11-17; the matcher's rows are `watchlist-phase11.md`'s), and
**amended by `fix-11d`** (2026-11-18; amendment 11): fairness retaken (missed at the default cap,
not measured at the ceiling), verification, the login limiter and the two-step sign-in retaken, the
webhook take re-read, the role timeouts completed (370 s) and the dense graph run again. The
Method below was committed by `contracts-11d` (the commit whose subject contains "Workflow 11D
contracts-11d checkpoint method") before any take and before any seed; a change made after it is
listed under "Amendments" with its reason, and no budget, margin, bound or discard rule moves after
the figure it judges is measured (owner decision 1 after 6B and after 6C).

Every figure comes from synthetic data on the stack's development configuration. One machine's
figures carry ratios, not absolutes, to other hardware.

## Method

### What is measured, and by whom

- **`calibration-load-11d`** (Stage 3, first): every HTTP take of C268 and C269 except the screening
  p95 of one report run, the re-screen and C269.4 (`calibration-matcher-11d`'s, in
  `docs/calibration/watchlist-phase11.md`), every take of C272, and the capacity rows of Workflows 7A
  and 7B below. It brings the load stack up and down under the e2e lock.
- **`calibration-matcher-11d`** (Stage 3, second, after the load stack is down): C78.7, the
  re-screen, C269.4 and C270, in 6D's configuration, and Workflow 7B's two list calibrations
  (`docs/calibration/lists-phase11.md`).
- The rows of C269.1 that are `calibration-load-11d`'s: API reads, API writes, the flow upload, the
  console login, the verification's per-analysis medians, event to first webhook attempt,
  **screenings per hour per worker process at concurrency 1 and 4 at both scales** (through the
  stack's worker; floor 10,000 an hour per process at 2,000,000 names), Connect redemption, the
  account export, and the workflow engine's steps. The screening p95 row and the re-screen row cite
  C271 and are judged in `watchlist-phase11.md`.

### The reference machine and the stack

- **The machine** (read 2026-11-16): Intel Xeon E5-1650 v3 at 3.50 GHz, 6 cores and 12 logical CPUs
  (one socket; hyper-thread siblings 0-1, 2-3, 4-5, 6-7, 8-9, 10-11), 31 GiB, a WSL2 virtual disk on
  a SATA SSD, Linux 6.18.40.1-microsoft-standard-WSL2, Docker Desktop 29.7.2 (12 CPUs, 31.3 GiB to
  its VM), Node v22.22.1. The report states them again from the day of the takes, with the commit and
  every image digest (`docker image inspect --format '{{.Id}}'` of each `11c-local` image, rebuilt
  from the head before the first take).
- **The stack** is the compose `app` profile on the production images with the load override, as the
  project `openverify-load` (Stage 1a amendment 9): `docker compose -p openverify-load -f
  infra/docker-compose.yml -f infra/load/docker-compose.load.yml --env-file
  /tmp/openverify-load/load.env --profile app …`, its database `openverify_load`, two roles (migrate
  and seed as the migration role; the API and the worker as `openverify_runtime`),
  `pg_stat_statements` preloaded, memory limits as the chart's defaults (api 1Gi, worker 1536Mi,
  dashboard 512Mi, flow 256Mi, vision 4Gi, code-runner 1Gi; no CPU limit), `OPENVERIFY_WORKER_CONCURRENCY`
  4, one vision instance, its own bridge network whose gateway is `OPENVERIFY_TRUST_PROXY`, the
  console's trusted proxy hops at 1, the sandbox `deviceIntegrity` provider for sandbox environments,
  a webhook receiver the worker reaches with `OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS=true`, the
  default network sources imported from synthetic files (City Lite off), and development mode. It
  raises no rate limit; the only labelled configuration is the fairness ceiling (below).
- **The hop.** A generator on this host reaches the stack through Docker Desktop's port forwarding,
  so the API's socket peer is the load network's gateway, and the client's p95 includes that hop. The
  server's p95 (the API's own response time, read from pino's `responseTime` by the sampler) is
  printed beside every client p95, and the difference is the hop and the client.
- **The data**, created by `pnpm --filter @openverify/api seed:load --scale reference` in its
  resumable steps, through the migration role, before any take and after this commit: two
  organisations `load-a` and `load-b` (both environments, `require-mfa` on, a self-connection and a
  cross-organisation connection with an accepted policy) and sixteen spread organisations
  `load-s01` to `load-s16` (both environments each), 36 environments in all; the principals of the
  spread table below; in `load-a` sandbox 20,000 accounts, 50,000 settled inquiries to read, 60,000
  inquiries awaiting review for approve and decline, 40,000 pending inquiries for the flow and 6,000
  for the verification row, with synthetic captures through the existing manifests; lists of the
  kinds the default template screens in each of `load-a` and `load-b` sandbox (email address 10,000
  items, phone number 10,000, name with `allow-fuzzy-name-first` 100,000, IP address 10,000, country
  20); a published transaction type with three searchable fields and 200,000 transactions in `load-b`
  sandbox; the graph indexed (`graph-indexing` on, weak kinds off) over `load-a` sandbox's accounts
  and 2,000 accounts in each spread environment; 100 Connect source inquiries with three
  verifications and six files each; and the heavy-headed watchlist tables at 100,000 names
  (sanctions profile) and 2,000,000 names (PEP profile) from `@openverify/watchlist/testing`
  through the sync's import. Every person is synthetic: emails at `example.com`, client addresses
  from the documentation ranges only (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32).
  The generated secrets (API keys, passwords, TOTP secrets) go only to `--secrets-file`, a new mode
  0600 file under `/tmp`, never to git, a log or this report.

### The core split and the generators (C268.6; reviews H11, V16)

- Every container of the load stack runs with `cpuset: "0-9"` (logical CPUs 0 to 9, five physical
  cores). The generators run on the sixth physical core: vegeta under `taskset -c 10`, the `httpx`
  driver of `load/driver/` and the sampler under `taskset -c 11`. The CPUs are the WSL2 VM's; Windows
  schedules them on the host's logical processors, which the report states.
- **Each generator's CPU share** is recorded per take: (utime + stime) from `/proc/<pid>/stat` over
  the take's measured window, divided by the window, as a share of its one logical CPU.
- **The driver's schedule lag** is recorded per take: for every request, its actual send time minus
  its planned send time on the constant-arrival schedule. **Bound (fixed here, V16):** a take is
  `invalid` when its p99 lag exceeds **10 ms** or its largest lag exceeds **100 ms**. Basis: 10 ms is
  the gap between two arrivals at the driver's highest budget rate (100 a second) and under 7% of the
  tightest budget the driver measures (150 ms); a single stall of 100 ms would hide most of a
  coordinated delay at that budget. vegeta keeps its own constant-rate schedule; its take is judged
  by the rate its report says it actually sent at: below 99% of the requested rate, the take is
  `invalid`.
- **A saturated generator:** a take whose generator averaged above **90%** of its logical CPU is
  `invalid`, because it cannot hold its schedule.

### The open model, the step-up and the takes (C268.5)

- **Open model only:** vegeta's constant rate for the single-route rows (`api-reads`, the read half
  of `transactions-search`, `lists-match`) and the driver's constant arrival rate for the multi-step
  scenarios; a request is sent at its planned time whether or not earlier ones have answered.
- **The step-up (the knee):** rates of 0.25, 0.5, 1, 1.5, 2, 3 and 4 times the scenario's budget rate,
  each step 30 s of warm-up and 120 s measured, one step per lock hold. The **knee** is the highest
  step whose p95 is within the budget (or, for a row without a budget, at most twice the lowest
  step's p95), with unexpected statuses below 0.1% and the schedule lag within its bound. The step-up
  stops at the first step that fails, or at 4 times.
- **The takes:** three takes at the budget's rate, each 60 s of warm-up and 300 s measured, the
  takes of one scenario in consecutive lock holds. **The headline is the median of the three take
  p95s**, the client's p95 beside the server's; p95 over the scenario's expected statuses only.
  Every take is listed with its 1-minute load average at its start and end and the lock wait.
- **The idle baseline:** an HTTP take starts only after the stack has idled (no generator, no queue
  depth) until the 1-minute load average is at most 4; that value is recorded as the baseline. The
  load during the take and at its end is recorded, never gated on: a take at 70% of the knee ends
  loaded by design (decision 64; review F01).
- **What each take records:** the client's p50, p95, p99 and maximum over expected statuses; the
  server's p95 from pino; the count of each status; `pg_stat_statements`' top 20 by total time
  (reset before the take: `select pg_stat_statements_reset()`); the BullMQ depth and lag of every
  queue the sampler lists, every 5 s; Postgres connections per application and state; each
  container's memory (`docker stats --no-stream`) every 5 s; the generators' CPU shares and the
  driver's lag.

### Expected statuses, the error budget and discards (C268.5; review H10)

- **Expected statuses** are each scenario's success statuses as the API's contract documents them
  (`load/scenarios/<id>.py`'s `EXPECTED_STATUSES`, the same in every take): for example 200 for a
  read, 201 for a create, 202 for a redemption or an export, 204 where the contract answers no
  content. 429 is expected only in `limiter-refusal`. Every other status, a timeout or a connection
  error is **unexpected**.
- **The error budget:** a take with unexpected outcomes at or above **0.1%** of its requests is
  `invalid`, never `met`.
- **Discard rules (the only ones):**
  1. A take is `invalid` (listed, not counted) when its unexpected outcomes reach 0.1%, its schedule
     lag or achieved rate breaks its bound, a generator was saturated, or a container restarted
     during it (its `docker inspect` restart count or start time changed).
  2. A take whose idle baseline did not reach a load of 4 within 15 minutes of waiting is not
     started, and listed as such.
  3. An invalid take is retaken; a scenario gets at most six attempts for its three takes. If three
     valid takes cannot be had, its verdict is `not measured`, with every attempt listed.
  4. Nothing else discards a take.
- **Verdicts:** `met` or `missed` with its gap (the median minus the budget) for a budgeted row;
  `reported` for a row without a budget; `invalid` or `not measured` as above.

### The spread under the shipped limits (C268.3; reviews H10, F06, V11)

Every principal stays at or below **50% of its limit at the scenario's top step** (4 times the
budget's rate). The client address rides in `X-Forwarded-For` through the trusted gateway; each is a
documentation address. seed:load creates (reference scale):

| Scenario id | Budget rate (top step) | Limit it meets | Principals | Environments | Client addresses |
|---|---|---|---|---|---|
| `api-reads` | 100/s (400/s) | `api` 300/min per key | 160 keys | `load-a` sandbox | 64 of 198.51.100.0/24 |
| `api-writes` | 50/s (200/s) | `api` | 80 keys | `load-a` sandbox | 64 of 198.51.100.0/24 |
| `flow-upload` | 10 uploads/s (40/s) | `flow-session` 120/min per token, `flow-ip` 600/min per address, `flow-signals` 60 in 60 s per session, `flow-integrity` 5/h per inquiry | 40,000 inquiries, one session each, opened by 16 keys | `load-a` sandbox | 254 of 203.0.113.0/24 |
| `console-login` | 5/s (20/s) | 50 per address and 10 per email in 15 min; one TOTP step per user | 4,000 users, TOTP-enrolled, at example.com | `load-a`, `load-b` | 4,000 of 2001:db8:4c00::/40, one per user |
| `verification` | to the knee | as `flow-upload` | 6,000 inquiries | `load-a` sandbox | 203.0.113.0/24 |
| `webhook-first-attempt` | 50 events/s (200/s) | `api` | 80 keys | `load-b` sandbox | 198.51.100.0/24 |
| `screening-throughput` | to saturation | `reports` 600/min per environment | 8 keys | `load-s01`…`s04` sandbox | none |
| `connect-redeem` | 5/s (10/s) | `connect-redeem` 60/min per key and environment | 20 destination keys, 8 source keys, 100 source inquiries | `load-a` sandbox to `load-b` sandbox | none |
| `account-export` | 5 a take | `account-export` 10/h per environment | 6 keys, 60 accounts of 20 inquiries | `load-s05`…`s10` sandbox | none |
| `fairness` | flooder 10 times its cap; victim 1/s | `reports` | 4 flooder keys, 2 victim keys | `load-s11`, `load-s12` sandbox | none |
| `limiter-refusal` | API 10/s for 60 s; login 60 attempts | `api`, the login limiter | 1 key, 1 user | `load-a` sandbox | 192.0.2.10 |
| `lists-import` | one 100,000-row CSV per kind a take | `importers` 10/h per environment | 4 keys | `load-s13`…`s16` sandbox | none |
| `lists-match` | 10/s (20/s) | `lists-match` 60/min per key | 40 keys | `load-a` sandbox | none |
| `graph-queries` | 4 queries/s | `graph-queries` 30/min per environment | 16 keys | `load-s01`…`s08`, both kinds | none |
| `transactions-write` | 50/s (200/s) | `api` | 80 keys | `load-b` sandbox | none |
| `transactions-search` | 100/s (400/s) | `api` | 160 keys | `load-b` sandbox | none |

- A login user signs in at most 5 times in any 15 minutes (50% of 10), at least 3 minutes apart, so
  never twice within one 30-second TOTP step; each address is used by one user only.
- A flow session sends its start, three uploads, one signal body per closed screen, its integrity
  challenge and token and its screen submissions (about 17 requests over its scripted life of about
  30 s, under 30% of `flow-session`), and each address carries under 10% of `flow-ip` at the top
  step.
- No scenario meets the `workflow-*`, `case-*`, `analytics`, `exports`, `report-bulk`,
  `one-time-link-redeem`, `flow-handoffs*`, `graph-unmask`, `lists-write` or
  `internal-embed-policy` policies: the load template has no workflow or case, the seed writes lists
  through the database, and no scenario redeems a link, hands off or unmasks.
- The `soak` and the jit comparison reuse these pools at 70% of the knee or at the budget rate.

### The scenarios and their budgets (C269.1, C269.5)

Each budget is ours (hardening 6.4's proposal, decision 8), chosen before measuring; the report says
so beside each. The scenario ids are the files of `load/scenarios/` and the rows of the summary block.

| Scenario id | What one unit is | Budget | Verdict rule |
|---|---|---|---|
| `api-reads` | `GET /inquiries/:id`, `GET /accounts/:id`, and list pages of 25, one third each, at 100 requests/s | p95 ≤ 150 ms, errors < 0.1% | met or missed |
| `api-writes` | `POST /inquiries` 40%, `PATCH /inquiries/:id` 20%, add tags 20%, approve 10%, decline 10%, at 50 requests/s | p95 ≤ 300 ms, errors < 0.1% | met or missed |
| `flow-upload` | a flow session's upload of a 1-3 MB synthetic image with 10B's `capture-trigger` field within `UPLOAD_LIMITS` (one file of at most 10 MiB, 7 fields, 8 parts), encrypted and stored, at 10 uploads/s; the session also sends its signal bodies (`flow-signals`) and, the sandbox `deviceIntegrity` provider being bound, its integrity challenge and token | upload p95 ≤ 1.5 s, errors < 0.1% | met or missed |
| `console-login` | the password request (Argon2id 19 MiB, t=2) through the Valkey limiter at 5 logins/s; the TOTP request and the whole two-step sign-in reported beside it, labelled; memory per concurrent hash recorded | password p95 ≤ 500 ms, errors < 0.1% | met or missed; the TOTP and two-step rows `reported` |
| `verification` | submit to decision per worker at `OPENVERIFY_WORKER_CONCURRENCY=4` with one vision instance | per-analysis **median**: government ID ≤ 5 s (C32.4), selfie ≤ 3 s (C41.5), document ≤ 4 s for a 3-page PDF (`phase-5.plan.md:627`); the p95 beside each, recorded only (F26); throughput reported | met or missed per analysis |
| `webhook-first-attempt` | event to the first webhook delivery attempt the receiver sees, at 50 events/s | p95 ≤ 5 s | met or missed |
| `screening-throughput` | `watchlist` report runs through the stack's worker at concurrency 1 and 4, at 100,000 and 2,000,000 names | reported; floor 10,000 an hour per process at 2,000,000 names | `met` or `missed` against the floor at 2,000,000 names; `reported` at 100,000 |
| `connect-redeem` | the redemption of an inquiry with three verifications and six files, at 5 redemptions/s over 20 destination keys of one destination environment | job p95 ≤ 5 s; API answer p95 ≤ 300 ms; errors < 0.1% | met or missed, each |
| `account-export` | an account with 20 inquiries, submit to `ready` | none | reported |
| `workflow-steps` | `apps/api/scripts/workflow-benchmark.ts --runs=200 --clients=1,8,32` on its own Testcontainers Postgres with the real executor | none | reported beside the executor's own figures (10A: 19/50/48 effectful and 96/206/205 control-flow steps a second; 11C: 17/46/48 effectful), never beside the 1,577 pgbench figure (Stage 1a amendment 2(d)) |
| `lists-import` | one 100,000-row CSV per kind (email address, phone number, name, IP address) through `POST /api/v1/importer/list-item/<kind>` and the `list-import` job, at low load | none | rows a second with the writer's share, reported (7B measured 600 to 1,300 a second only under load) |
| `lists-match` | `POST /api/v1/lists/match` at 10/s | none (reported against `api-reads`' 150 ms for context) | reported |
| `graph-queries` | asynchronous `POST /api/v1/graph-queries`, submit to `completed`, at 4 a second spread over 16 environments | none | reported beside 7B's single-client `graph:benchmark` (p95 8.4, 13.3, 16.3 ms at 2, 4, 6 hops) |
| `transactions-write` | `POST /api/v1/transactions` against the published type (one HMAC per searchable field, the fields sealed) at 50/s | none (reported beside `api-writes`' 300 ms) | reported |
| `transactions-search` | `GET /api/v1/transactions?filter[identifier]=…` at 100/s | none (reported beside `api-reads`' 150 ms) | reported |

### Fairness (C251.5, C269.2; review P15)

One environment (`load-s11`) floods report runs at **10 times its cap** while another (`load-s12`)
runs its normal load of 1 report run a second. First the victim's **idle p95** (submit to settled,
the flooder silent; three takes), then the flood (three takes). **Met** when the victim's report p95
under the flood is at most **2 times** its idle p95. Two configurations:

1. **The default cap:** the shipped values (cap 50, ceiling 50): the flooder submits 500 runs.
2. **The flooder at the install ceiling**, labelled "ceiling 200": `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX=200`
   and the flooder's `queue-in-flight-caps` at 200 for `report-run`; it submits 2,000 runs at 5 a
   second. Basis for 200: the default ceiling equals the default cap, so "at the ceiling" needs a raised
   ceiling; 200 is four times the default share and fits one take.

### The soak (C269.3; the long-take exception)

30 minutes at **70% of the knee** of the mixed load (`api-reads`, `api-writes` and `flow-upload`
at their budget proportions), run in the background under the e2e lock with a heartbeat file every
10 s and an end marker, alone on the machine (Rules, "Calls that fit 10 minutes"). The first 5
minutes are warm-up. **Memory:** no container of the API, the worker, the flow, the console or
vision grows its memory by more than **10%** from its value at minute 5 to its largest after it.
**Queue lag:** after the load stops, every queue the sampler lists returns to a lag of zero within
10 minutes. **One snapshot swap** is forced at minute 15 (`network:sync --import` of a changed
synthetic file of one default source), so the growth rule sees a swap; the report states the swap's
time and its effect. Start, end and the largest heartbeat gap are recorded beside the figures.

### The limiter refusal (C268.5)

- **API limiter:** one key at 10 requests a second (twice `api`'s 300 a minute) for 60 s: the 429s
  are expected; the row reports the refusal's p95 and confirms that every request past the limit is
  refused and none before it.
- **Login limiter:** from one address, 60 attempts in 15 minutes (the refusal from the 51st), and for
  one email 12 attempts (the refusal from the 11th): the refusal's p95, reported. Both limiters' own
  counts are read back, not inferred.

### Database tuning (C272)

- **`jit = off`:** the read, write and screening scenarios at their budget rates with the runtime
  role's `jit` on (the default) and off (`ALTER ROLE openverify_runtime SET jit = off`, then the API
  and worker restarted), three takes each, alternating on and off. **The margin is 5%** of the jit-on
  p95 (6D's margin, for the same reason: three takes cannot tell a smaller difference from this
  machine's noise). `jit = off` is **recommended** only if no scenario's median p95 with it off is
  more than 5% above its median with it on; otherwise not recommended, with the figures. Never a pool
  option.
- **Role timeouts:** `statement_timeout` for the runtime role = 2 times the longest legitimate
  statement either calibration records (`pg_stat_statements`' `max_exec_time` over every load take,
  and the 2,000,000-name sync `calibration-matcher-11d` runs), rounded up to the next 10 s;
  `idle_in_transaction_session_timeout` = 2 times the longest idle-in-transaction gap the sampler sees
  (`pg_stat_activity`, every 5 s), at least 60 s. The migration role has none. The graph sets its own
  `SET LOCAL statement_timeout` within a query's deadline (1-59 s); a graph statement the role's value
  would cut is a **finding** for `fix-11d`, never a shorter deadline.
- **Pools:** connections per process (`pg_stat_activity` by application and client) at the knee of
  each scenario, the largest per process; the guide's sizing table and the chart's pool check
  (`10 × (A + ⌈A/4⌉) + 10 × (W + ⌈W/4⌉) + 11 ≤ maxConnections`) take them.

### Workflow 7A's capacity items

- **(a) Memory.** The API and the worker each keep every enabled network source's snapshot in memory,
  so the stack runs the default sources (Country and ASN Lite, Tor, the six range files), imported with
  `network:sync --import` from synthetic files of the measured sizes (`packages/signals/src/testing/`;
  no publisher is called). Row `process-memory`: each process's RSS at rest and at the soak's swap,
  beside `docs/network/README.md:72-75` (the defaults about 46 to 53 MiB at rest and about 9 MiB at a
  swap; City Lite about 168 MiB at rest and about 116 MiB at its swap, which sizing adds per API or
  worker process when `dbip-city-lite` is on). Reported.
- **(b) The session start.** seed:load's documentation addresses read only the small sandbox source
  in a sandbox environment and answer `address_not_public` before any lookup in a production one, so
  no HTTP scenario exercises a lookup over real-size snapshots. Row `network-lookup`: C93.2's lookup
  budget, **1 ms a call** (mean over 1,000,000 lookups, its p99 beside it; 7A measured 18.4 µs on the
  sandbox snapshots), over synthetic files at the real sizes, three takes, `met` or `missed`.
- **(c) The flow.** The default template shows `notice.session-integrity`, so `flow-upload`'s session
  sends one signal body per closed screen to `POST /api/v1/flow/signals` (`flow-signals`), and, with
  the sandbox `deviceIntegrity` provider bound, its integrity challenge and token (`flow-integrity`);
  its uploads carry the `capture-trigger` field within `UPLOAD_LIMITS`.
- **(d) City Lite's verify** (owner decisions after 7A, "Later phases"). The publication pinned in
  `load/city-lite-manifest.json` (DB-IP City Lite 2026-10, CC-BY-4.0, 60,193,321 bytes, its SHA-256
  read on 2026-11-16) is fetched once with `python3 -I scripts/fetch_data.py --manifest
  load/city-lite-manifest.json --dest <a fresh /tmp directory>`, never into `data/` or an image
  context, never committed, baked or redistributed, and deleted after the take (rule 9). Row
  `city-lite-verify`: `MmdbSnapshot.verify`'s wall and CPU time and peak memory on it, three takes,
  **reported** (no budget exists and none is invented), beside two comparisons: the 30 s age of the
  worker's heartbeat (C250.2: a sync's strict parse runs on the event loop, `normalisePublication`,
  `packages/signals/src/network/snapshot.ts:120`, so in the `network-refresh` job a verify longer than
  30 s fails the worker's liveness probe and stalls BullMQ's lock renewal), and the 600 s
  `timeout_seconds` of the `dbip-city-lite` entry (`network/sources.json:89`). 7A's 186 ms of CPU
  came from a synthetic file of 710,834 prefixes and 2 records; City Lite holds about 7.8 million
  records.

### Workflow 7B's capacity rows

- **(e) Lists in the load:** the seeded lists make every completion carry the `list-screen` job and
  its outbox (`list_screenings`); `lists-import` and `lists-match` are rows of their own.
- **(f) The graph in the load:** `graph-queries` is its row; Phase 7's R007 adds a dense-neighbourhood
  shape to `graph:benchmark` behind a flag of `apps/api/src/services/graph/synthetic.ts` (the default
  shape byte-identical, so the C102.8 suite and the `graph-engine` template are unchanged) and one new
  1,000,000-account run on `graph:benchmark`'s own Testcontainers Postgres (never `openverify_load`:
  K7C-R008's guard refuses it). Row `graph-dense`: its p95 at 2, 4 and 6 hops beside 7B's figures,
  reported, no budget.
- **(g) Transactions in the load:** `transactions-write` and `transactions-search`, both under `api`.

### What the sampler watches

Every 5 s (`load/sampler.py`): the depth and lag of the BullMQ queues `process-verification`,
`report-run`, `report-rescreen`, `webhook-delivery` (and every webhook queue the worker registers),
`connect-redeem`, `account-export`, `inquiry-signals`, `inquiry-signals-sweep`, `network-refresh`,
`integrity-decode`, `list-screen`, `list-screen-sweep`, `list-import`, `list-import-sweep`,
`list-item-embed`, `list-item-embed-sweep`, `graph-index`, `graph-index-sweep`, `graph-query`,
`graph-query-sweep`, `graph-backfill`, `quota-sweep` and `quota-recovery` (the names as
`apps/api/src/jobs/` registers them at the head; a name that differs there is corrected under
"Amendments", never dropped); Postgres connections by application and state; each container's
memory; the API's response times from pino's own fields, never a body. Its output holds ids, codes,
counts and durations only.

## Results

Taken by `calibration-load-11d` (claude-opus-5-5) on 2026-11-16 and 2026-11-17, alone on the
machine (no test suite, build or other agent; `ps` and `docker ps` checked before the first take),
at head `2d3134755` with the borrowed edits of amendments 1 and 8's tools (`155d2e9d1`,
`3a89c40ca`). Every take ran under the e2e lock, one per hold; **every lock wait was 0.003 to 0.007
s** (nothing else asked for the lock), so the tables below omit it. Loads are the 1-minute load
average at the take's start and end; the idle baseline (load at most 4 and no queue depth before
the take) held for every take listed. Client p95 is the generator's; the server's p95 (pino's
`responseTime` over the measured step's routes and the measured window) is in brackets. The take
files, the sampler's 5-second series, `pg_stat_statements`' top 20 and the server times of every
take are under `load/results/reference/` (outside git); the commands are in
`docs/tdd/phase11-calibration-load-11d.tdd.md`.

**The images** (rebuilt from the head before the first take): `openverify/api:11c-local`
`sha256:425d0efb7761be11f99711956a29a5112b1599698aa056493c714a3aeedc2cf8`, `dashboard`
`sha256:5c1b5e588fd01e07301e2724531868f6d8a280d58dd5cc690bd13d1b6134075f`, `flow`
`sha256:4e4b91bf7cc8892dfb62b50fa75e83f704872f93e557f84eff9e364039363f80`, `vision`
`sha256:0920856b09610dca61aa7137f87103e611dd350bfbc7075ee265a012b25e9070`, `code-runner`
`sha256:4f0fcc564ef23cf2eb4c8690646d8e8c6c6441e4fc8788ea348aabb36edbfb0b`; the infrastructure images
by the digests `infra/docker-compose.yml` pins. The machine is the Method's, read again on the day.

**What limits this machine first.** The API is one Node process (the compose profile runs one
replica; the chart scales it to 4). At 150 reads a second it saturated and collapsed (server p95 28
s, 57% of requests timed out), and near 100 a second its p95 swung by a factor of 4 to 7 between
takes of the same configuration. Read every figure below as one API process's.

### Budgets (C269.1)

| Scenario | Budget | Takes (client [server]) | Loads | Median | Verdict | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| `api-reads` | p95 ≤ 150 ms | 752.2 [731.3], 390.0 [371.0], 171.5 [152.6] ms | 2.55→2.88, 2.59→2.14, 2.26→2.87 | 390.0 ms [371.0] | missed | +240.0 ms |
| `api-writes` | p95 ≤ 300 ms | 130.9 [121.9], 390.0 [376.5], 100.5 [94.3] ms | 2.22→4.60, 3.77→2.80, 2.73→3.16 | 130.9 ms [121.9] | met | −169.1 ms |
| `flow-upload` | p95 ≤ 1.5 s | six attempts, all invalid (lag, errors): 50.2, 40.7, 29.4, 27.7, 36.6, 23.0 s [11.9, 17.6, 13.4, 12.1, 15.9, 10.4 s] | 3.81-4.00 → 7.21-10.49 | none | not measured | — |
| `console-login` (password) | p95 ≤ 500 ms | 63.2 [59.2], 61.0 [56.7], 44.2 [41.2] ms | 3.04→1.19, 1.88→0.68, 1.20→1.73 | 61.0 ms [56.7] | met | −439.0 ms |
| `verification` (government ID median) | ≤ 5 s | two attempts at 0.5 sessions/s, both invalid (lag 14.7, 19.1 ms): medians 1.738, 1.781 s; four retakes not taken | 3.18→7.50, 3.47→6.98 | none | invalid | — |
| `verification` (selfie median) | ≤ 3 s | not exercised: the scenario uploads a government ID only | — | none | not measured | — |
| `verification` (document median, 3 pages) | ≤ 4 s | not exercised: no document upload in the scenario | — | none | not measured | — |
| `webhook-first-attempt` | p95 ≤ 5 s | one attempt at 50/s, invalid (lag 204 s, generator 91%): 6,860 of 18,000 events not yet received 120 s after the take; five retakes not taken | 1.24→5.86 | none | invalid | — |
| `screening-throughput` (2,000,000 names, concurrency 1) | ≥ 10,000 an hour per process | at 4 runs/s, four attempts: 14,640 (invalid: lag max 178.6 ms), 13,404, 14,712, 14,592 an hour | 3.69→2.87, 2.50→5.81, 3.76→2.75, 2.03→2.17 | 14,592 an hour | met | +4,592 an hour |
| `screening-throughput` (2,000,000 names, concurrency 4) | ≥ 10,000 an hour per process | at 6 runs/s, six attempts, two valid: 21,576, 21,600 an hour (invalid on lag or 429s: 19,728, 20,640, 20,784, 21,648) | 3.25→3.18, 2.65→7.03; invalid 2.41-3.80 → 3.16-7.54 | none | not measured | — (every attempt above the floor by 9,700 or more) |
| `connect-redeem` (job) | p95 ≤ 5 s | six attempts, one valid: 0.876 s (the five invalid on lag 10.7-20.8 ms: 0.991, 0.819, 1.067, 0.765, 0.888 s) | 1.72-3.85 → 2.35-6.78 | none | not measured | — |
| `connect-redeem` (API answer) | p95 ≤ 300 ms | the same six: valid 103.7 [97.7] ms; invalid 134.2, 87.1, 153.5, 69.9, 102.8 ms | as above | none | not measured | — |
| `network-lookup` | ≤ 1 ms a call (mean of 1,000,000) | mean 0.00671, 0.00641, 0.00636 ms; p99 0.0239, 0.0228, 0.0223 ms | 1.13→1.11, 1.05→1.05, 1.02→1.02 | 0.00641 ms | met | −0.99359 ms |

Every figure of `connect-redeem` is far inside both budgets (the API answer under half of 300 ms,
the job under a fifth of 5 s), but only one of six attempts kept the driver's lag within its bound
(p99 at most 10 ms; the five others 10.7 to 20.8 ms), so by discard rule 3 the row is `not
measured`; `verification`'s two attempts (medians under half of 5 s) were invalid the same way and
its retakes were not taken, so it is `invalid`. `flow-upload`
(`not measured`) and `webhook-first-attempt` (`invalid`, one attempt) have no figure because the
stack could not carry their budget rate:
every `flow-upload` attempt and the `webhook-first-attempt` attempt saw the server answer in 10 to
24 s and the driver fall minutes behind its schedule, so neither row would have met its budget.

### The step-ups (C268.5)

Each step 30 s of warm-up and 120 s measured; p95 client [server]; `invalid` names its reason. A step
invalid on the generator's side only (lag, CPU) was taken again; a step fails on its p95 against the
budget (or twice the lowest step's p95 for a row without one) or its unexpected outcomes.

| Scenario (budget rate) | 0.25 | 0.5 | 1 | 1.5 | 2 | 3 | 4 | Knee |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `api-reads` (100/s, vegeta) | 14.5 [14.6] | 16.9 [15.0] | 50.1 [43.3] | fails: 10,205 of 17,999 timed out, 29.6 s | (run past the first failure) 22,577 of 24,000 timed out | — | — | 1 (100/s) |
| `api-writes` (50/s) | 44.7 [41.4] | 54.0 [51.4] | fails: 1,183.7 [1,167.2] | — | — | — | — | 0.5 (25/s) |
| `transactions-search` (100/s, vegeta) | 20.0 [19.0] | 20.0 [18.8] | fails: 2,365.2 [2,312.8] | — | — | — | — | 0.5 (50/s) |
| `transactions-write` (50/s) | 38.5 [35.0] | 40.3 [36.7] | fails: 383.2 [361.5] | — | — | — | — | 0.5 (25/s) |
| `lists-match` (10/s, vegeta; top 2) | 28.0 [27.1] | 26.0 [24.5] | 25.1 [24.0] | 28.3 [26.9] | 29.2 [28.0] | — | — | ≥ 2 (top step) |
| `flow-upload` (10 uploads/s; s) | 0.217 [0.215] | 0.242 [0.240] | fails: 6.65 [6.30], lag p99 57.9 ms | — | — | — | — | 0.5 (5/s) |
| `console-login` (5/s; password) | 48.2 [45.4] | 55.4 [49.1] | 43.0 [39.9] | 43.5 [39.8] | 65.7 [61.9] | 41.5 [38.0] | 57.3 [53.2] | ≥ 4 (20/s) |
| `webhook-first-attempt` (50/s; s) | fails: 5.64, then (retaken with the receiver off the driver's CPU) 22.6; lag p99 24.2 and 46.9 ms | — | — | — | — | — | — | below 0.25 |
| `connect-redeem` (5/s; API s, job s) | invalid (lag 25.1), retaken: 0.055, job 0.708 | 0.055, 0.710 | 0.062, 0.734 | invalid (lag 10.5); retaken: fails, 1.337, job 7.76 | fails: 7.41, job 40.7 (lag 20.1) | — | — | 1 (5/s) |
| `graph-queries` (4/s; top 1; submit to completed) | 329.0 [42.6] | 315.4 [41.1] | 306.5 [33.3] | — | — | — | — | ≥ 1 (top step) |
| `verification` (1 session/s; median s) | invalid (lag 18.8): 1.83 | 2.01 (p95 2.56) | fails: 100 of 3,605 answered 429 (median 1.96) | fails: 189 answered 429, lag 18.7 (1.99) | — | — | — | 0.5 sessions/s |
| `screening-throughput`, 100,000 names, c4 (2/s; DB completions an hour) | invalid (lag 11.7): 1,800 | 3,600 | 7,200 | (not run) | 14,370 | 21,600 | 28,800 | ≥ 4; beyond the method's steps: 6 = 43,230; 8 invalid (lag 2.7 s) 52,410 of 1,822 created; 10 invalid (lag 14.3 s) 60,330 |
| the same, c1 | — | — | 7,200 | — | 14,310 | 21,600 | 28,800 (settle p95 3.6 s) | 4 (8/s); 6 invalid (lag 5.2 s): 34,200 of 1,389 created |
| `screening-throughput`, 2,000,000 names, c4 | invalid (lag 11.9): 1,800 | 3,570 | 7,200 | 10,800 | 13,800 | 21,090 (settle p95 2.78 s) | invalid (lag 497 ms): 23,430 of 941 created | 3 (6/s) |
| the same, c1 | — | — | 7,170 | — | 14,340 | invalid (lag 1.97 s, 15 × 429): 14,580 of 695 created | — | 2 (4/s) |

At 100,000 names the 100k-c4 step-up ran 1, 2, 3, 4 and 6 times instead of the method's 1, 1.5, 2,
3, 4 (an error in the run, listed as run); no step it skipped could have changed the knee, since 4
times passed.

### Every budget take that is not in the first table

- **`transactions-write`** (50/s; reported beside `api-writes`' 300 ms): six attempts: 118.6 [109.5]
  ms (valid; 2.25→4.52); invalid on lag 95.6 s (server 21.1 s), 70.4 s (21.8 s), 263.5 s with the
  generator at 95% (24.3 s), 8.8 s (2.7 s); 1,059.2 [1,044.6] ms (valid; 2.82→3.18). Two valid of
  six: `not measured`. In the stalls the API's ten connections sat `idle in transaction` and
  `update "api_keys" set "last_used_at"` ran up to 5,961 ms (finding 2).
- **`transactions-search`** (100/s, vegeta): 3,798.6 [3,778.6], 470.8 [445.2], 180.2 [159.5] ms
  (2.68→3.49, 3.29→4.88, 3.70→3.36): median **470.8 ms**, `reported`.
- **`lists-match`** (10/s, vegeta): 26.8 [25.7], 28.7 [27.5], 30.8 [29.5] ms (1.04→0.62,
  0.76→0.80, 1.06→3.50): median **28.7 ms**, `reported` (beside `api-reads`' 150 ms).
- **`graph-queries`** (4/s over 16 environments; submit to `completed`): 307.5 [33.7], 322.6
  [41.3], 339.9 [52.1] ms (1.08→0.43, 0.70→0.97, 1.46→0.99): median **322.6 ms**, `reported`
  beside 7B's single-client `graph:benchmark` (8.4, 13.3, 16.3 ms at 2, 4, 6 hops); the poll every
  250 ms and the queue are most of it.
- **`console-login` TOTP request**: p95 105.4, 88.1, 66.0 ms in the three budget takes: median
  **88.1 ms**, `reported`. The two-step time was `not measured` (the take file kept no per-unit
  two-step duration, finding 10); **`fix-11d`'s takes** (amendment 11(f); 5/s, 60 s and 300 s,
  offsets 0, 1,800, 3,600 and 5,400) record it: password to TOTP success p95 131.6, 142.7 and 111.1
  ms in three valid takes (median **131.6 ms**, `reported`; loads 3.93→1.33, 1.19→0.96,
  1.26→0.94), with the password request's p95 58.8, 57.5 and 46.1 ms beside the budget's three; the
  third attempt (0.96→1.68) is `invalid`: 5 unexpected outcomes of 3,000 and a stall in which
  answers took up to 34.7 s (cause not established; the idle baseline held before it). One attempt
  before them was not started (its idle baseline stayed at 4.64 for 154 s) and is listed in the TDD
  file. The API container's memory peaked at 302 to 331 MiB in the login
  takes, at most 20 password hashes a second in flight.
- **`verification`** at its knee (0.5 sessions/s): two attempts, both invalid on lag (14.7, 19.1
  ms): government-ID median 1.738 s (p95 1.922 s) and 1.781 s (p95 2.126 s); `invalid`, four
  attempts left untaken (finding 12). Throughput (`verification-throughput`): `invalid` (the
  same two attempts); as context, 151 decided in each 300 s window at 0.5 sessions/s, about 1,800
  an hour at the knee's rate (the next step failed on the spread's 429s, not on the analysis).
  **`fix-11d`'s step-up and take** (amendment 11(d): submit and polls from the session's address; a
  fresh seed): 0.25 sessions/s 1.657 s (valid, 1.04→2.20), 0.5 1.773 s (valid, 2.18→5.70), 1 2.494 s
  (invalid on lag, 3.94→11.65; retaken: **2.083 s**, valid, 3.82→8.59), 1.5 **25.42 s** (over the
  5 s budget, and invalid on lag, 3.80→8.52): the knee is **1 session a second** over a 150 s step.
  The first take at the knee (60 s of warm-up, 300 s measured; 3.97→11.46) did not hold it: the
  analysis backlog grew through the take (median 72.65 s, p95 123.2 s, 21,072 polls) and the driver's
  lag reached 1.9 s, so it is `invalid`; a sustained session a second saturates this machine's vision
  and worker, and two more takes at that rate would repeat it (not taken). The row stays `invalid`;
  the 429s are gone (no unexpected status in any step).
- **`webhook-first-attempt`**: one of six attempts taken (above); five left untaken (finding 12).
  Re-read under amendment 11(b) (`run.py`'s `webhook_figures` over the take's own receiver file and
  measured window): **6,037 of the 15,000 events created in the measured window never reached the
  receiver** (8,963 did), so the p95 is unknown and the take is `invalid` on that alone; the 0.25
  step also misses 9 of its 1,500.
- **`lists-import`** (one 100,000-row CSV per kind a take, at low load): three attempts, each
  invalid on a single lag of 58.3, 101.2 and 68.6 ms (four uploads of 1.4 to 3.3 MB); `invalid`. The harness's own figure (2.3 to 2.7 s) is the importer's `ready` answer, not the
  import's end (finding 7); the database's `completed_at - enqueued_at` per import, email, phone,
  name, IP address: 74.3, 48.1, 121.4, 59.3 s; 63.2, 36.8, 119.5, 59.5 s; 65.2, 38.6, 98.0, 46.1 s,
  so **824 to 2,719 rows a second** (names slowest, 824 to 1,021; email 1,346 to 1,581; a phone
  CSV's 39,000 duplicates and an IP CSV's 34,464 rejected rows skew theirs), beside 7B's 600 to
  1,300 under load. Context only, since no take was valid.
- **`account-export`** (5 a take): two attempts, each invalid on one lag of 100.7 and 100.1 ms (13
  requests a take): submit to `ready` p50 2.45 and 2.46 s, p95 5.27 and 2.61 s; `invalid`, four
  attempts untaken.

### Fairness, the soak and the limiters

| Row | Rule | Takes | Loads | Verdict |
| --- | --- | --- | --- | --- |
| `fairness-default-cap` | victim p95 ≤ 2 × idle | **Retaken by `fix-11d`** (amendment 11(a); head `77e851b67`, images rebuilt from it): idle 113.0, 101.0, 110.0 ms (median **110.0**, the reports' own `created-at` to `completed-at`); flood (500 runs, the burst) four attempts: 3,196.0 (invalid: one send 122.1 ms late), 2,946.0, 2,778.0, 2,926.0 ms (median **2,926.0**); in every flood take the flooder waited for slots (326, 244, 232 and 277 of its 500 runs admitted more than 1 s after creation, the longest waits 18.1 to 28.9 s): ratio **26.6**. The first calibration's takes (idle 2,107.5, flood 2,150.1, ratio 1.020) never reached the cap: `invalid` by amendment 11(a) | retake: idle 1.77→0.40, 0.49→0.37, 0.98→3.37; flood 3.10→1.06, 1.05→2.48, 2.48→0.67, 0.62→0.69 | **missed** (gap +24.6) |
| `fairness-ceiling` ("ceiling 200") | victim p95 ≤ 2 × idle | **Retaken by `fix-11d`**: idle 117.0, 106.0, 105.0 ms (median **106.0**); flood (2,000 runs) five attempts: 3,487.0 (invalid: one send 399.8 ms late), **3,544.0** (valid), 3,679.0 (invalid: 394.0 ms), 6,468.0 (invalid: lag p99 15.2 ms), 5,564.0 (invalid: 565.6 ms); with one valid take in five, three cannot be had within six attempts. Every attempt reached the cap (218 to 479 flooder runs waited, up to 11.0 s) and put the victim at 33 to 61 times its idle p95. The first calibration's takes (ratio 0.992) never reached the cap: `invalid` by amendment 11(a) | retake: idle 1.09→0.29, 0.32→0.56, 0.48→0.59; flood 0.73→2.20, 2.02→0.87, 0.81→0.91, 1.07→0.41, 1.15→0.69 | **not measured** |
| `soak-memory` | growth ≤ 10% after warm-up | one attempt, invalid: the driver saturated (95% of its CPU) and fell behind at 56 requests a second; growth from minute 5 to the largest after it: api +45.0% (271.6 → 393.8 MiB), worker +16.6% (374.6 → 436.6), flow +41.8% (35.9 → 50.9), dashboard +8.9%, vision +2.1% | 0.66→3.14 | invalid |
| `soak-queue-lag` | every lag back to 0 within 10 min | the same attempt: no queue lag above 0 during it; every queue at depth 0 within 10 s of the stop | — | invalid |
| `limiter-refusal-api` | reported | three takes, 120 s at 10/s from one key: 899 answered 200 and 301 answered 429 each (GCRA: 300 of burst plus 5 a second); refusal p95 at the server 5.44, 5.73, 5.26 ms (median **5.44 ms**); client p95 over both 15.7, 14.0, 14.3 ms | 1.32→1.04, 0.52→1.14, 0.87→1.00 | reported |
| `limiter-refusal-login` | reported | one attempt (72 over 840 s, the long-take exception: heartbeats 84, largest gap 11 s), invalid on one lag of 60.2 ms: from one address, 10 × 401 then 50 × 429; for one email, 10 × 401 then 2 × 429; refusal p95 at the server 2.56 ms; client p95 36.9 and 40.3 ms. **`fix-11d`'s attempt** (amendment 11(e), one email an address-half attempt; 01:07:40 to 01:21:30 UTC, heartbeats 84, largest gap 10 s): from one address **50 × 401 then 10 × 429** (refused from the 51st), for one email 10 × 401 then 2 × 429 (from the 11th); client p95 36.8 ms (address) and 44.2 ms (email); invalid again on one lag of 59.7 ms (72 sends, so one late send is the p99) | 0.86→0.20; 0.87→0.55 | invalid |

- **Fairness** ran in `load-s11` (flooder) and `load-s12` (victim) at 100,000 names. In the first
  calibration no admission metric event (`queue_in_flight`, `queue_at_cap_ms`,
  `queue_admission_wait_ms`) appeared in either configuration: the worker settled the flood faster
  than 5 a second arrived, so the cap was never reached, and the 2 s poll floored the victim's p95
  (finding 11); those takes are `invalid` (review P001, amendment 11(a)). **`fix-11d`'s retake**
  (2026-11-17/18, a fresh seed of the same scale, every take under the e2e lock with lock waits of
  0.004 to 0.008 s and the idle baseline reached in `run.py` itself) opened the flood with its 500
  runs at 50 a second, timed the victim by its reports' own `created-at` to `completed-at`, and read
  `sampler.py admissions` over each take's window: the flooder's runs waited for slots in every flood
  take, and its victim's p95 rose from about 0.11 s to 2.8 to 3.5 s at the default cap and to 3.5 to
  6.5 s at "ceiling 200". **The per-environment cap does not keep one environment's report runs within
  twice their idle time while another floods**: the cap bounds how many of the flooder's runs are in
  flight (50, or 200), but the victim's runs queue behind those admitted runs on the shared
  `report-run` queue, which the worker settles at about 15 runs a second. C251.6 says the cap adds no
  capacity; this measures what it does not give either. A missed budget for the release checklist
  and the release notes (C271.4's sense; the owner's). "Ceiling 200" was the env file's
  `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX=200` and `load-s11` sandbox's `queue-in-flight-caps` at
  `{"report-run": 200}`, the API and the worker restarted; both were returned to the defaults after.
- **The soak** ran at 56 requests a second (70% of the mixed knee: the lowest component knee, 0.5,
  times 160; amendment 6), offset 0, 300 s of warm-up and 1,500 s measured, in the background with
  heartbeats (356, largest gap 11 s). The driver could not hold the mixed rate on its one CPU (it
  reached 95% and was still sending at minute 58, when it was stopped), so the attempt is invalid by
  discard rule 1 and was not retaken: a retake at the same rate saturates the same CPU. The swap at
  minute 15 (`network:sync --import` of a changed AWS file, 06:41:33 to 06:43:11 UTC, `applied`,
  19,135 entries) moved the API container from 353 to 374 MiB and back to 352 within a minute; the
  worker 357 to 369 MiB. The memory figures are reported, not judged.
- **The login limiter**: every address-half attempt named one probe email, so the per-email bucket
  (10 in 15 minutes) refused from the 11th and the per-address refusal (the 51st) was never reached
  (finding 8). The per-email refusal from the 11th held in both halves. With one email an attempt
  (`fix-11d`), the per-address bucket refuses from exactly the 51st (50 × 401, then 10 × 429).

### Reported rows

- **`screening-throughput` at 100,000 names** (report runs the database completed in the measured
  window, an hour's worth): concurrency 4 at 12 runs/s: 43,260, 43,212, 43,212 (median **43,212 an
  hour**; 3.67→3.06, 3.42→2.91, 3.33→2.96); concurrency 1 at 8 runs/s: 28,800, 28,812, 28,824
  (median **28,812**; 3.84→4.55, 3.85→2.02, 2.35→1.77). Neither rate saturated the worker, so each is
  a floor of its throughput; the saturating steps (invalid on lag) completed 52,410 to 60,330 an hour
  at concurrency 4 and 34,200 at concurrency 1. At 2,000,000 names (first table) the worker saturated
  near 21,000 to 23,400 an hour at concurrency 4 and near 14,500 at concurrency 1. About 0.8% of
  report runs ended `errored` at every rate and scale (finding 13). The settle time is bounded below
  by the 2 s poll (p50 2.07 s at every unsaturated rate).
- **`workflow-steps`** (`apps/api/scripts/workflow-benchmark.ts --runs=200 --clients=1,8,32`, its
  own Testcontainers Postgres, the load stack stopped; 135, 138, 139 s; loads 0.74→2.04,
  1.73→2.68, 2.68→2.47): effectful 16/48/49, 16/47/50, 15/47/48 steps a second at 1/8/32 clients
  (medians **16/47/49**); control-flow 92/204/207, 91/206/207, 89/197/207 (medians **91/204/207**).
  Beside the executor's own figures: 8A 50 effectful and 213 control-flow at 32 clients; 10A
  19/50/48 and 96/206/205; the 10E close 180 control-flow at 32; 11C 17/46/48 effectful. Not beside
  the 1,577 pgbench figure (Stage 1a amendment 2(d)).
- **`process-memory`** (Workflow 7A (a); the default sources imported, amendment 2): at rest after a
  restart, the API process 277.5 MiB RSS (`VmRSS` of PID 1; the container 225.1 MiB by `docker
  stats`) and the worker process 391.8 MiB (container 348 MiB); at the soak's swap the API container
  rose by 21 MiB and the worker's by 12 MiB and fell back. `docs/network/README.md` measured the
  default sources at about 46 to 53 MiB at rest and about 9 MiB at a swap over a bare Node process's
  roughly 96 MiB, so the default sources are a small share of either process here; City Lite's
  168 MiB at rest and 116 MiB at a swap (not measured here, off) would add to each. `reported`.
- **`city-lite-verify`** (Workflow 7A (d)): `not measured`. The method's fetch, `python3 -I
  scripts/fetch_data.py --manifest load/city-lite-manifest.json --dest <fresh dir>`, answered
  `HTTP 403 Forbidden` on 2026-11-17 for the pinned 2026-10 file, while the same URL answered a
  `HEAD` with 200 to a browser-like client: the file is still served, and DB-IP's front end refuses
  the fetcher's client (finding 9). The method allows no other fetch, so no file was downloaded or
  kept.
- **`graph-dense`** (R007; `pnpm --filter @openverify/api graph:benchmark --shape dense`,
  1,000,000 accounts on its own Testcontainers Postgres, the load stack stopped, alone, under the
  long-take exception; heartbeats 121, largest gap 10 s; 1,200 s, of which the build 1,182.5 s;
  6,005,000 attribute rows; load 1.33→2.18): p95 **7.5, 7.5, 7.5 ms** at 2, 4 and 6 strong hops
  (p50 6.0, 5.8, 5.8; max 12.4, 20.1, 14.3), strong and weak at 4 hops 16.9 ms, a hub start at 4
  hops 6.4 ms; no query timed out or reached the node limit. Beside 7B's default shape (8.4, 13.3,
  16.3 ms). **But** each strong-hop scenario reached a mean of 1 account and 1 node: the sampled
  start accounts fell outside the dense rings, so the dense neighbourhoods were not traversed and the
  run does not answer R007 (finding 14). `reported`, with that caveat. **`fix-11d`'s run**
  (amendment 11(h): strong rings of 50, the default fan-out cap; head `89a508d75`; the same command
  on its own Testcontainers Postgres, alone, under the long-take exception, 10:44 to 11:05 UTC,
  heartbeats 123, largest gap 10 s; 1,221 s, the build 1,201.4 s; 6,005,000 rows; load 1.49→2.93):
  p95 **11.3, 16.5 and 23.8 ms** at 2, 4 and 6 strong hops (p50 8.0, 13.7, 18.0; max 16.4, 22.8,
  29.0), reaching a mean of **75, 125 and 175 accounts** (77, 129, 181 nodes); strong and weak at 4
  hops 48.5 ms over 915.7 accounts (max 269.9 ms); a hub start at 4 hops 14.9 ms (its hub value
  skipped, as the cap says); no query timed out or reached the node limit. This answers R007: dense
  neighbourhoods of up to 175 accounts stay under 25 ms at the p95 on one client. Finding 14's
  diagnosis was wrong: the starts were inside the rings, which were wider than the fan-out cap.
- **`transactions-write`**, **`transactions-search`**, **`lists-match`**, **`graph-queries`**,
  **`lists-import`**, **`account-export`**, **`console-login-totp`**, **`console-login-two-step`**,
  **`verification-throughput`**: in "Every budget take that is not in the first table" above.

### Database tuning

| Row | Rule | Figures | Verdict |
| --- | --- | --- | --- |
| `jit-comparison` | recommended only if no scenario's median p95 with jit off is more than 5% above its median with it on | reads: on 365.5, 118.7, 849.5 ms (median 365.5), off 16,157.1, 1,437.5, 112.2 (median 1,437.5): **3.93 times**; writes: on (valid) 340.9, 101.4, 1,011.6 (median 340.9), off 155.8, 108.8, 111.4 (median 111.4): 0.33 times; screening (submit to settled at 6/s): on 2,097.7, 2,093.8, 2,103.2 (median 2,097.7), off 2,091.5, 2,094.7, 2,108.7 (median 2,094.7): 0.999 times | not recommended |
| `role-timeouts` | `statement_timeout` = 2 × the longest legitimate statement, rounded up to 10 s; `idle_in_transaction_session_timeout` = 2 × the longest idle-in-transaction gap, at least 60 s | longest statement over every load take: 18,338.7 ms (a batch `delete from "api_logs" ...` of the retention pass, during `verification`'s first step); next 17,885.0 ms (`insert into "events"` in a 2,000,000-name screening take); idle in transaction at most 1.31 s (`lists-import`) | from the load takes alone: `statement_timeout` 40 s, `idle_in_transaction_session_timeout` 60 s. **With the 2,000,000-name sync's longest statement** (183,493 ms, `insert into watchlist_key_df`, the full key-frequency rebuild; `watchlist-phase11.md`, amendment 11(g)): **`statement_timeout` 370 s** (2 × 183.5 s, rounded up to 10 s), `idle_in_transaction_session_timeout` 60 s; reported for the guide (11E). `incremental-key-df` ships off (`WATCHLIST_SWITCHES_ON_BY_DEFAULT` holds only `retrieval-reach`; Workflow 11D review amendments 5 and 7), so a default sync still runs that statement; with the switch on the sync does not (its 1,000-entry sync takes 127.5 s in all), but `watchlists:rebuild-key-df` and the re-key still do, so 370 s stands either way (corrected in Workflow 11F, KP11-82) |
| `pool-at-knee` | connections per process at the knee | the API process held **10** connections (its pool's whole default size) at the knee of every scenario that reached one, and the worker **10**; the generator's own `psql` at most 3 | reported: the chart's pool check (10 per process) holds the measured figure; at the knee the API's pool is full, so a larger pool is not what the API process needs first (its CPU is) |

- **The jit takes.** Six for each scenario, alternating on and off, the role set with `ALTER ROLE
  openverify_runtime SET jit = off` (and `RESET jit`), the API and the worker restarted before each
  (amendments 7 and 10). Reads: all six valid (loads 2.74 to 3.86 at the start). Writes: on-1
  (lag 57.9 s, server p95 23.6 s) and off-1 (lag 90.6 s) and off-3 (450 timeouts, generator 93%)
  invalid, so on-4, off-4 and off-5 were taken (offsets 215,125, 233,125 and 251,125); valid on
  340.9, 101.4, 1,011.6 and off 155.8, 108.8, 111.4. Screening: off-1 invalid (one lag of 298.7
  ms), off-4 taken in its place. The role's setting was reset and the processes restarted after the
  last take.
- **Reading the jit verdict.** The rule gives "not recommended" through the reads, whose median with
  jit off is 3.93 times its median with it on; the writes moved the other way (0.33) and screening
  not at all (0.999). The read and write takes swing by a factor of 7 to 144 between takes of one
  configuration (one API process near its saturation), so three takes do not separate jit's effect
  from that noise on this machine; the guide should present the figures and the method, not a
  setting.
- **The 18-second retention delete** is legitimate (the C16 pass, `api_logs`), but it ran during a
  take and is the statement that sets the timeout; a statement timeout of 40 s would also bound the
  retention pass's batch, which the guide must say (finding 15).

### Findings for `fix-11d`

Each is a fact the takes showed; none changed a take after it was taken.

1. **One API process saturates near 100 reads a second** (`api-reads` collapsed at 150/s with 57%
   timeouts at the generator's 30 s, the load average under 4: the event loop, not the machine, was
   full). The `api-reads` budget is missed at 100/s on one replica; the guide's sizing starts from
   it.
2. **Writes stall under contention**: in `transactions-write` and `api-writes` takes the server's
   p95 jumped to 21 to 26 s while the API's ten connections sat `idle in transaction` and `update
   "api_keys" set "last_used_at"` took up to 5,961 ms; four of six `transactions-write` attempts and
   two of nine jit writes takes broke the lag bound this way.
3. **Webhook delivery** fell behind at 12.5 events a second while the API was under load (queue lag
   24 s, p95 event to first attempt 5.6 to 22.6 s), and drained at a far higher rate once the load
   stopped.
4. **Flow uploads** at 10 a second overloaded the stack (server p95 10 to 17 s); 5 a second held a
   p95 of 0.24 s.
5. **The driver's lag bound and the generator CPUs.** Multi-step and poll-based scenarios
   (`connect-redeem`, `verification`, `lists-import`, `account-export`, the login half, some
   screening takes) broke the 10 ms p99 lag bound by 0.5 to 15 ms with the driver at 3 to 15% of its
   CPU, more often when the machine's load rose above about 5; with few requests a take (13 to 156)
   a single late send is its p99. Docker Desktop's port-forwarding process is not pinned and shares
   CPUs 10 and 11 with the generators. Most of this report's `not measured` rows come from it, never
   from a server figure over its budget (`connect-redeem`, `verification`).
6. **`verification`'s polls and submit carry no `X-Forwarded-For`** (`load/scenarios/verification.py`
   calls `session_headers(token)` without the session's address), so every poll counts against
   `flow-ip` from the gateway's address and answered 429 at 1 session a second; found after the
   scenario's first take, so not fixed here (the Stage 3 rule).
7. **`lists-import`'s figure is the importer's `ready` answer** (2.3 to 2.7 s), while the database
   records the import's end 37 to 121 s later: `load/scenarios/lists_import.py` should end a unit on
   the import's completion (or the report read `completed_at`).
8. **The login half names one probe email for every address attempt**
   (`load/scenarios/limiter_refusal.py`), so the per-email bucket refuses from the 11th and the
   per-address refusal (the 51st) is never reached; the address half needs one email per attempt.
9. **`scripts/fetch_data.py` is refused by DB-IP** (`HTTP 403` on the pinned City Lite file, which
   a browser-like client still reaches), so `city-lite-verify` could not be taken; the fetcher's
   client identification needs a look (not changed here: the method allows only that command).
10. **`console-login`'s take file has no two-step time** (`run.py`'s `COMPLETIONS` lacks the
    scenario), so `console-login-two-step` is not measured.
11. **The report polls are 2 s apart** (`screening-throughput`, `fairness`), so the victim's p95 and
    every settle time is bounded below by the poll; fairness could not see a delay under 2 s, and the
    flood never reached the cap at 100,000 names (no admission metric event).
12. **Retakes left untaken** for time: `webhook-first-attempt` (five), `verification` (four),
    `account-export` (four), `lists-import` (three), the login half (five); and `verification`
    exercises the government ID only, with synthetic noise images, so the selfie and document rows
    are not exercised at all (`load/scenarios/verification.py`).
13. **About 0.8% of watchlist report runs end `errored`** at every rate and scale (for example 28 of
    3,605 at 12/s), with the same keys and names; the cause is not established.
14. **R007's dense run never reached a dense neighbourhood**: every strong-hop scenario of
    `graph:benchmark --shape dense` reached a mean of 1 account, so the starts must be drawn from the
    dense rings (`apps/api/src/services/graph/benchmark.ts`). **Fixed by `fix-11d`** with another
    cause: the rings (100) were wider than the default fan-out cap (50), so each ring value was skipped
    as a hub; rings of 50 are traversed (above).
15. **The 18-second retention delete** (`delete from "api_logs"` in one batch) during load sets the
    runtime role's statement timeout; the guide pairs the timeout with the retention pass's batch.
16. **Valkey timeouts under overload**: during the `webhook-first-attempt` take the API logged `rate
    limit store unavailable` (`Command timed out`, policy `api`, failing open) at 21:44:49 local
    time.
17. **The soak cannot be generated by one driver CPU** at 56 mixed requests a second (with 1 to 3 MB
    uploads); the soak's reads need vegeta, or the driver more than one CPU.

## What this does not measure

- **Behaviour under failure:** Valkey down, a database failover, a node lost, a full disk. A passing
  load test says nothing about them; they are untested (C268.8), and the self-hosting guide says so.
- **Other hardware:** one machine (above), its figures carry ratios, not absolutes.
- **Production mode:** the stack runs in development mode. Production adds the refusal of private
  webhook receivers, placeholder-secret refusals, production-only provider bindings (no sandbox
  providers), and the production network facts; none of them is on the measured path here.
- **Real-size network lookups over HTTP:** the HTTP figures carry no lookup over real-size snapshots
  (Workflow 7A item (b)); `network-lookup` measures it on its own.
- **TLS:** the stack's hops are plain HTTP on loopback and a bridge network; a TLS terminator's cost
  is not in any figure.
- **Real people and real lists:** every name, list, capture and address is synthetic.
- **The matcher's budgets:** C78.7 and the re-screen are `watchlist-phase11.md`'s.

## Amendments

Written by `calibration-load-11d` before the first take each affects (the commit of this section
precedes those takes; `api-reads`' step-up and takes, which none of them touches, ran before it).
None moves a budget, a margin, a bound or a discard rule.

1. **The seed's 2,000,000-name table** (a harness defect that stopped a step): `seed:load --step
   watchlists --part 2` answered `refused_mass_removal`, because part 2 replaces the sandbox source's
   100,000-name table (part 1) with the first eighth of the 2,000,000-name one. Part 2 now passes the
   sync's `allowMassRemoval`, every other part keeps the guard (`1b2119e00` stub, `b00f35d2c` RED,
   `155d2e9d1` GREEN; a named borrowed edit of `apps/api/src/seed/load/watchlists.ts`). As the seed
   intends, every take but `screening-throughput-2m` runs on the 100,000-name table, and parts 2 to 9
   are imported after them.
2. **The default network sources** (item (a)): no harness tool imports them, so the calibration
   generated the nine default sources' publisher files at the measured sizes with
   `@openverify/signals/testing` (Country and ASN Lite padded to 8,348,509 and 9,566,363 bytes as
   `writeMemoryFiles` writes them; the TorDNSEL list at its 384-relay maximum; the AWS, Google and
   Oracle range files and the two geofeeds at the prefix counts of `MEASURED_SOURCES`; Cloudflare's
   fixed set) and imported each with `pnpm --filter @openverify/api network:sync --import <file>
   --source <id>` before any take (every one `applied`). The script is in the TDD file.
3. **The take offsets.** `run.py`'s shared cursor is one counter for every scenario, so a pool that a
   take consumes (inquiries awaiting review, pending flow inquiries, verification inquiries) would be
   exhausted by other scenarios' counts. Every take passes `--offset` from a per-pool cursor the
   calibration keeps (recorded in the TDD file); reads, which consume nothing, use offset 0.
4. **Step-up limits fixed by the spread.** The step-up stops at the spread's top step where that is
   below 4 times the budget rate: `connect-redeem` at 2 times (10/s), `lists-match` at 2 times
   (20/s; written before its first take: its 40 keys hold 50% of `lists-match` at 20/s, as the spread
   table's top step says), `graph-queries` at 1 time (4/s). `lists-import` (one CSV per kind a take) and `account-export` (5 a take) have no step-up.
   `verification` (no rate) steps at 0.25, 0.5, 1, 1.5, 2, 3 and 4 sessions a second.
5. **Screening throughput** (no rate; "to saturation"): the step-up's rates are 0.25 to 4 times
   2 report runs a second; the throughput of a take is the count of report runs the database records
   as completed (`reports.completed_at`) inside its measured window, an hour's worth, so a backlog
   that settles after the window is not counted as throughput. Concurrency 1 is the worker restarted
   with `OPENVERIFY_WORKER_CONCURRENCY=1` (a compose override of that one variable), labelled.
6. **The soak's knee.** A step-up of the mixed load would spend the inquiries awaiting review that the
   writes' own takes need, and `soak`'s plan gives its three pools one offset. The mixed knee is
   therefore the lowest knee multiple of its three components (`api-reads`, `api-writes`,
   `flow-upload`) times the mixed budget rate (160 requests a second), and the soak runs at 70% of it.
7. **The jit comparison's "on" takes** are each scenario's three budget takes; its three "off" takes
   alternate with them (on, off, on, off, on, off), and the API and the worker are restarted before
   each of the six. The screening scenario of the comparison runs `screening-throughput` at half the
   saturation throughput measured at 100,000 names and concurrency 4 (fixed before its first jit take),
   judged on its submit-to-settled p95.
8. **The API limiter's refusal** (load-harness's GCRA finding): the limiter is GCRA with a burst of the
   whole limit (300) and one request every 200 ms, so at 10/s the burst lasts about 60 s. The API half
   runs 120 s at 10/s; its row reports how many requests were refused after the burst was spent (about
   300 expected), the first refusal's time, and the refusal's p95. The login half keeps the harness's
   plan (72 attempts over 840 s), so it runs under the long-take exception with a heartbeat.

9. **Fairness windows** (before the first fairness take): the flood is submitted from the take's
   first second (500 runs in 100 s; 2,000 in 400 s at the ceiling), so a 60 s warm-up would hide most
   of it. Every fairness take, idle or flooded, runs **0 s of warm-up and 150 s measured** at the
   default cap and **0 s and 450 s** at "ceiling 200", the victim at 1 run a second throughout; its
   p95 is over the runs submitted inside that window.

10. **The jit comparison's takes, as run** (before its first take): `api-reads` and `api-writes`
    ran their budget takes before amendment 7 was written, without a restart before each, so each
    runs six new takes for the comparison (on, off, on, off, on, off, a restart before each, at its
    budget rate), and its budget verdict stays with its three budget takes. The screening scenario
    runs at 6 report runs a second (half of 12/s, the highest rate whose throughput takes were valid
    at 100,000 names and concurrency 4; the saturating steps at 16/s and 20/s broke the lag bound).

11. **Workflow 11D review (`fix-11d`), written before every retake it governs** (2026-11-17; the
    review's P001 to P003 and `calibration-load-11d`'s findings; each change test-first, commits in
    `docs/tdd/phase11-fix-11d.tdd.md`). No budget, margin, bound or discard rule moves; the takes
    already published keep their figures, re-read under (a) to (c) where a rule now reaches them.
    (a) **Fairness (P001).** The published flood takes never reached the cap: the worker settles
    about 15 runs a second at concurrency 4, so a flood at 5 a second never held 50 runs in flight,
    and the 2 s poll floored the victim's time, so a ratio near 1 was certain. A flood take now
    **counts only when some run of the flooding environment waited for a slot** (`sampler.py
    admissions` over the take's window: admitted more than 1 s after it was created); one without
    is `invalid` ("the flood never reached the cap"), and so are the six published flood takes. The
    flood **opens with its first 500 runs at 50 a second** (10 s; inside the `reports` policy's
    GCRA burst of its whole limit, 600 an environment, and each of the 4 flooder keys' `api` burst
    of 300), then 5 a second: the spread's 50% rule bounds sustained rates, and a burst inside the
    limiter's own burst is never refused, so any 429 is unexpected and invalidates the take. The
    victim's figure (idle and flooded) is **the report's own `created-at` to `completed-at`** read
    from the settled answer, not submit to the poll that saw it. Windows as amendment 9.
    (b) **Webhook first attempt (P002).** An event created in the measured window that the receiver
    has not seen 120 s after the take is **missing**: the take is `invalid` and its p95 unknown,
    never fast; events created during the warm-up are outside the window. The one published take is
    re-read under it.
    (c) **Discard rules 1 and 2 in the committed harness (P003).** `run.py take` itself now waits for
    the idle baseline (load at most 4, no queue depth, at most 15 minutes; else the take is not
    started and a `.not-started.json` lists it) and invalidates a take during which a container's
    restart count or start time changed. The published takes applied both through the scratch
    `take.sh`, so none of their verdicts changes.
    (d) **`verification`**: its submit and polls now carry the session's documentation address (they
    counted against `flow-ip` from the gateway's address and met 429 at 1 session a second); its
    step-up and three takes are retaken.
    (e) **The login half of `limiter-refusal`**: the address half sends one email an attempt, so the
    per-address bucket refuses from the 51st; retaken under the long-take exception.
    (f) **`console-login`**: each sign-in's password-to-TOTP time is recorded (`totp`); three new takes
    at 5 a second report the two-step figure beside the password row, whose verdict stays with its
    first three takes.
    (g) **The role timeouts (C272.2)**: the longest legitimate statement of either calibration is the
    2,000,000-name sync's key-frequency rebuild, 183,493 ms (`watchlist-phase11.md`), so
    `statement_timeout` = 2 × 183.5 s rounded up to 10 s = **370 s**; idle in transaction unchanged.
    (h) **R007's dense shape**: its strong rings were 100 wide, above the default fan-out cap of 50,
    so every ring value was skipped as a hub (`skippedHubValues` 100 of 100 runs) and each strong
    hop reached 1 account; finding 14's "starts outside the rings" was a misreading. The rings are
    now 50 wide and `graph:benchmark --shape dense` is run again.
    (i) **Not retaken, with the reason:** `lists-import` (the importer answers `ready` when its rows
    are staged, and the API serves no member for the `list-import` job's end, so a fix needs a
    contract member, frozen in 11D: carried to 11F, where it stayed open as KP11-52, the next release); the soak (one driver CPU saturates at 56 requests
    a second; spreading the generator is a harness change, carried); every row no fix touched.

## Summary block

<!-- openverify:calibration-summary:start -->
```json
{
  "base": "d44e537dba0f84a4eafc45b313264de74c2b31a4",
  "head": "2d3134755c0fd4412b052faa0f2c357dfb729a4d",
  "machine": {
    "cpu": "Intel Xeon E5-1650 v3 3.50 GHz (6 cores)",
    "disk-class": "WSL2 virtual disk on a SATA SSD",
    "logical-cpus": 12,
    "memory-gib": 31
  },
  "method-commit": "ac3fc15583558d1ad256c44fb9e39eee7ebce871",
  "report": "docs/calibration/load-phase11.md",
  "rows": [
    {
      "budget": {
        "comparison": "<=",
        "metric": "p95",
        "unit": "ms",
        "value": 150
      },
      "configuration": "default",
      "contract": "C269.1",
      "gap": 240.048,
      "id": "api-reads",
      "median": 390.048,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 2.88,
          "load-start": 2.55,
          "status": "valid",
          "value": 752.206
        },
        {
          "load-end": 2.14,
          "load-start": 2.59,
          "status": "valid",
          "value": 390.048
        },
        {
          "load-end": 2.87,
          "load-start": 2.26,
          "status": "valid",
          "value": 171.463
        }
      ],
      "title": "API reads at 100 requests/s",
      "unit": "ms",
      "verdict": "missed"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "p95",
        "unit": "ms",
        "value": 300
      },
      "configuration": "default",
      "contract": "C269.1",
      "gap": -169.141,
      "id": "api-writes",
      "median": 130.859,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 4.6,
          "load-start": 2.22,
          "status": "valid",
          "value": 130.859
        },
        {
          "load-end": 2.8,
          "load-start": 3.77,
          "status": "valid",
          "value": 389.97
        },
        {
          "load-end": 3.16,
          "load-start": 2.73,
          "status": "valid",
          "value": 100.494
        }
      ],
      "title": "API writes at 50 requests/s",
      "unit": "ms",
      "verdict": "met"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "p95",
        "unit": "s",
        "value": 1.5
      },
      "configuration": "default",
      "contract": "C269.1",
      "gap": null,
      "id": "flow-upload",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 10.04,
          "load-start": 3.87,
          "status": "invalid",
          "value": 50.244
        },
        {
          "load-end": 9.63,
          "load-start": 3.83,
          "status": "invalid",
          "value": 40.6787
        },
        {
          "load-end": 10.49,
          "load-start": 3.81,
          "status": "invalid",
          "value": 29.3659
        },
        {
          "load-end": 7.21,
          "load-start": 3.93,
          "status": "invalid",
          "value": 27.6546
        },
        {
          "load-end": 8.24,
          "load-start": 4.0,
          "status": "invalid",
          "value": 36.5563
        },
        {
          "load-end": 7.25,
          "load-start": 3.83,
          "status": "invalid",
          "value": 22.9637
        }
      ],
      "title": "Flow upload at 10 uploads/s",
      "unit": "s",
      "verdict": "not-measured"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "p95",
        "unit": "ms",
        "value": 500
      },
      "configuration": "default",
      "contract": "C269.1",
      "gap": -438.961,
      "id": "console-login",
      "median": 61.039,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 1.19,
          "load-start": 3.04,
          "status": "valid",
          "value": 63.237
        },
        {
          "load-end": 0.68,
          "load-start": 1.88,
          "status": "valid",
          "value": 61.039
        },
        {
          "load-end": 1.73,
          "load-start": 1.2,
          "status": "valid",
          "value": 44.174
        }
      ],
      "title": "Console login, the password request, at 5 logins/s",
      "unit": "ms",
      "verdict": "met"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "C269.1",
      "gap": null,
      "id": "console-login-totp",
      "median": 88.14,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 1.19,
          "load-start": 3.04,
          "status": "valid",
          "value": 105.422
        },
        {
          "load-end": 0.68,
          "load-start": 1.88,
          "status": "valid",
          "value": 88.14
        },
        {
          "load-end": 1.73,
          "load-start": 1.2,
          "status": "valid",
          "value": 66.035
        }
      ],
      "title": "Console login, the TOTP request",
      "unit": "ms",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "default; fix-11d retake at 77e851b67; password to TOTP success",
      "contract": "C269.1",
      "gap": null,
      "id": "console-login-two-step",
      "median": 131.609,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 1.33,
          "load-start": 3.93,
          "status": "valid",
          "value": 131.609
        },
        {
          "load-end": 0.96,
          "load-start": 1.19,
          "status": "valid",
          "value": 142.657
        },
        {
          "load-end": 1.68,
          "load-start": 0.96,
          "status": "invalid",
          "value": 23644.272
        },
        {
          "load-end": 0.94,
          "load-start": 1.26,
          "status": "valid",
          "value": 111.105
        }
      ],
      "title": "Console login, the whole two-step sign-in",
      "unit": "ms",
      "verdict": "reported"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "median",
        "unit": "s",
        "value": 5
      },
      "configuration": "default; fix-11d retake at 77e851b67: knee 1 session/s; the take at it saturated",
      "contract": "C269.1, C32.4",
      "gap": null,
      "id": "verification-government-id",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 7.5,
          "load-start": 3.18,
          "status": "invalid",
          "value": 1.7381
        },
        {
          "load-end": 6.98,
          "load-start": 3.47,
          "status": "invalid",
          "value": 1.7809
        },
        {
          "load-end": 11.46,
          "load-start": 3.97,
          "status": "invalid",
          "value": 72.65
        }
      ],
      "title": "Verification, government ID analysis median",
      "unit": "s",
      "verdict": "invalid"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "median",
        "unit": "s",
        "value": 3
      },
      "configuration": "default",
      "contract": "C269.1, C41.5",
      "gap": null,
      "id": "verification-selfie",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [],
      "title": "Verification, selfie analysis median",
      "unit": "s",
      "verdict": "not-measured"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "median",
        "unit": "s",
        "value": 4
      },
      "configuration": "default",
      "contract": "C269.1, phase-5.plan.md:627",
      "gap": null,
      "id": "verification-document",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [],
      "title": "Verification, 3-page PDF analysis median",
      "unit": "s",
      "verdict": "not-measured"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "C269.1",
      "gap": null,
      "id": "verification-throughput",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 7.5,
          "load-start": 3.18,
          "status": "invalid",
          "value": 1812.0
        },
        {
          "load-end": 6.98,
          "load-start": 3.47,
          "status": "invalid",
          "value": 1812.0
        }
      ],
      "title": "Verifications per worker at concurrency 4",
      "unit": "per-hour",
      "verdict": "invalid"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "p95",
        "unit": "s",
        "value": 5
      },
      "configuration": "default; P002: 6,037 of 15,000 events missing",
      "contract": "C269.1",
      "gap": null,
      "id": "webhook-first-attempt",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 5.86,
          "load-start": 1.24,
          "status": "invalid",
          "value": null
        }
      ],
      "title": "Event to first webhook attempt at 50 events/s",
      "unit": "s",
      "verdict": "invalid"
    },
    {
      "budget": {
        "comparison": ">=",
        "metric": "rate",
        "unit": "per-hour",
        "value": 10000
      },
      "configuration": "concurrency 1",
      "contract": "C269.1",
      "gap": 4592.0,
      "id": "screening-throughput-2m",
      "median": 14592.0,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 2.87,
          "load-start": 3.69,
          "status": "invalid",
          "value": 14640.0
        },
        {
          "load-end": 5.81,
          "load-start": 2.5,
          "status": "valid",
          "value": 13404.0
        },
        {
          "load-end": 2.75,
          "load-start": 3.76,
          "status": "valid",
          "value": 14712.0
        },
        {
          "load-end": 2.17,
          "load-start": 2.03,
          "status": "valid",
          "value": 14592.0
        }
      ],
      "title": "Screenings per hour per worker process at 2,000,000 names",
      "unit": "per-hour",
      "verdict": "met"
    },
    {
      "budget": {
        "comparison": ">=",
        "metric": "rate",
        "unit": "per-hour",
        "value": 10000
      },
      "configuration": "concurrency 4",
      "contract": "C269.1",
      "gap": null,
      "id": "screening-throughput-2m-c4",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 3.18,
          "load-start": 3.25,
          "status": "valid",
          "value": 21576.0
        },
        {
          "load-end": 7.03,
          "load-start": 2.65,
          "status": "valid",
          "value": 21600.0
        },
        {
          "load-end": 7.54,
          "load-start": 3.8,
          "status": "invalid",
          "value": 19728.0
        },
        {
          "load-end": 7.5,
          "load-start": 3.8,
          "status": "invalid",
          "value": 20640.0
        },
        {
          "load-end": 3.16,
          "load-start": 2.61,
          "status": "invalid",
          "value": 20784.0
        },
        {
          "load-end": 3.53,
          "load-start": 2.41,
          "status": "invalid",
          "value": 21648.0
        }
      ],
      "title": "Screenings per hour per worker process at 2,000,000 names, concurrency 4",
      "unit": "per-hour",
      "verdict": "not-measured"
    },
    {
      "budget": null,
      "configuration": "concurrency 4",
      "contract": "C269.1",
      "gap": null,
      "id": "screening-throughput-100k",
      "median": 43212.0,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 3.06,
          "load-start": 3.67,
          "status": "valid",
          "value": 43260.0
        },
        {
          "load-end": 2.91,
          "load-start": 3.42,
          "status": "valid",
          "value": 43212.0
        },
        {
          "load-end": 2.96,
          "load-start": 3.33,
          "status": "valid",
          "value": 43212.0
        }
      ],
      "title": "Screenings per hour per worker process at 100,000 names",
      "unit": "per-hour",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "concurrency 1",
      "contract": "C269.1",
      "gap": null,
      "id": "screening-throughput-100k-c1",
      "median": 28812.0,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 4.55,
          "load-start": 3.84,
          "status": "valid",
          "value": 28800.0
        },
        {
          "load-end": 2.02,
          "load-start": 3.85,
          "status": "valid",
          "value": 28812.0
        },
        {
          "load-end": 1.77,
          "load-start": 2.35,
          "status": "valid",
          "value": 28824.0
        }
      ],
      "title": "Screenings per hour per worker process at 100,000 names, concurrency 1",
      "unit": "per-hour",
      "verdict": "reported"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "p95",
        "unit": "s",
        "value": 5
      },
      "configuration": "default",
      "contract": "C269.1, C240.3",
      "gap": null,
      "id": "connect-redeem-job",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 6.78,
          "load-start": 3.85,
          "status": "invalid",
          "value": 0.9915
        },
        {
          "load-end": 3.67,
          "load-start": 3.24,
          "status": "valid",
          "value": 0.8762
        },
        {
          "load-end": 3.96,
          "load-start": 3.73,
          "status": "invalid",
          "value": 0.8186
        },
        {
          "load-end": 3.55,
          "load-start": 3.2,
          "status": "invalid",
          "value": 1.067
        },
        {
          "load-end": 2.35,
          "load-start": 2.61,
          "status": "invalid",
          "value": 0.7649
        },
        {
          "load-end": 3.19,
          "load-start": 1.72,
          "status": "invalid",
          "value": 0.8885
        }
      ],
      "title": "Connect redemption, job p95 at 5 redemptions/s",
      "unit": "s",
      "verdict": "not-measured"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "p95",
        "unit": "ms",
        "value": 300
      },
      "configuration": "default",
      "contract": "C269.1, C240.3",
      "gap": null,
      "id": "connect-redeem-api",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 6.78,
          "load-start": 3.85,
          "status": "invalid",
          "value": 134.2
        },
        {
          "load-end": 3.67,
          "load-start": 3.24,
          "status": "valid",
          "value": 103.7
        },
        {
          "load-end": 3.96,
          "load-start": 3.73,
          "status": "invalid",
          "value": 87.1
        },
        {
          "load-end": 3.55,
          "load-start": 3.2,
          "status": "invalid",
          "value": 153.5
        },
        {
          "load-end": 2.35,
          "load-start": 2.61,
          "status": "invalid",
          "value": 69.9
        },
        {
          "load-end": 3.19,
          "load-start": 1.72,
          "status": "invalid",
          "value": 102.8
        }
      ],
      "title": "Connect redemption, API answer p95",
      "unit": "ms",
      "verdict": "not-measured"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "C269.1",
      "gap": null,
      "id": "account-export",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 1.63,
          "load-start": 1.98,
          "status": "invalid",
          "value": 5.2669
        },
        {
          "load-end": 0.65,
          "load-start": 1.63,
          "status": "invalid",
          "value": 2.6081
        }
      ],
      "title": "Account export of an account with 20 inquiries",
      "unit": "s",
      "verdict": "invalid"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "C269.1",
      "gap": null,
      "id": "workflow-steps",
      "median": 49.0,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 2.04,
          "load-start": 0.74,
          "status": "valid",
          "value": 49.0
        },
        {
          "load-end": 2.68,
          "load-start": 1.73,
          "status": "valid",
          "value": 50.0
        },
        {
          "load-end": 2.47,
          "load-start": 2.68,
          "status": "valid",
          "value": 48.0
        }
      ],
      "title": "Workflow engine steps a second at 32 clients (effectful)",
      "unit": "per-s",
      "verdict": "reported"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "ratio",
        "unit": "ratio",
        "value": 2
      },
      "configuration": "default; fix-11d retake at 77e851b67; report's own time; the flood reached the cap",
      "contract": "C251.5, C269.2",
      "gap": 24.6,
      "id": "fairness-default-cap",
      "median": 26.6,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 1.06,
          "load-start": 3.1,
          "status": "invalid",
          "value": 29.055
        },
        {
          "load-end": 2.48,
          "load-start": 1.05,
          "status": "valid",
          "value": 26.782
        },
        {
          "load-end": 0.67,
          "load-start": 2.48,
          "status": "valid",
          "value": 25.255
        },
        {
          "load-end": 0.69,
          "load-start": 0.62,
          "status": "valid",
          "value": 26.6
        }
      ],
      "title": "Fairness at the default cap: victim p95 over its idle p95 (idle 110.0 ms)",
      "unit": "ratio",
      "verdict": "missed"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "ratio",
        "unit": "ratio",
        "value": 2
      },
      "configuration": "ceiling 200; fix-11d retake at 77e851b67; one valid of five attempts",
      "contract": "C251.5, C269.2",
      "gap": null,
      "id": "fairness-ceiling",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 2.2,
          "load-start": 0.73,
          "status": "invalid",
          "value": 32.896
        },
        {
          "load-end": 0.87,
          "load-start": 2.02,
          "status": "valid",
          "value": 33.434
        },
        {
          "load-end": 0.91,
          "load-start": 0.81,
          "status": "invalid",
          "value": 34.708
        },
        {
          "load-end": 0.41,
          "load-start": 1.07,
          "status": "invalid",
          "value": 61.019
        },
        {
          "load-end": 0.69,
          "load-start": 1.15,
          "status": "invalid",
          "value": 52.491
        }
      ],
      "title": "Fairness with the flooder at the ceiling (idle 106.0 ms)",
      "unit": "ratio",
      "verdict": "not-measured"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "growth",
        "unit": "percent",
        "value": 10
      },
      "configuration": "default",
      "contract": "C269.3",
      "gap": null,
      "id": "soak-memory",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 3.14,
          "load-start": 0.66,
          "status": "invalid",
          "value": 44.99
        }
      ],
      "title": "Soak: memory growth after warm-up",
      "unit": "percent",
      "verdict": "invalid"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "max",
        "unit": "s",
        "value": 600
      },
      "configuration": "default",
      "contract": "C269.3",
      "gap": null,
      "id": "soak-queue-lag",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 3.14,
          "load-start": 0.66,
          "status": "invalid",
          "value": 10.0
        }
      ],
      "title": "Soak: time until every queue lag returns to zero",
      "unit": "s",
      "verdict": "invalid"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "C268.5",
      "gap": null,
      "id": "limiter-refusal-api",
      "median": 5.442,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 1.04,
          "load-start": 1.32,
          "status": "valid",
          "value": 5.442
        },
        {
          "load-end": 1.14,
          "load-start": 0.52,
          "status": "valid",
          "value": 5.728
        },
        {
          "load-end": 1.0,
          "load-start": 0.87,
          "status": "valid",
          "value": 5.257
        }
      ],
      "title": "The API limiter's refusal",
      "unit": "ms",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "default; fix-11d retake at 77e851b67: one email an address-half attempt",
      "contract": "C268.5, C246",
      "gap": null,
      "id": "limiter-refusal-login",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 0.2,
          "load-start": 0.86,
          "status": "invalid",
          "value": 2.562
        },
        {
          "load-end": 0.55,
          "load-start": 0.87,
          "status": "invalid",
          "value": 44.176
        }
      ],
      "title": "The login limiter's refusal",
      "unit": "ms",
      "verdict": "invalid"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "Workflow 7B (e)",
      "gap": null,
      "id": "lists-import",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 4.1,
          "load-start": 1.14,
          "status": "invalid",
          "value": null
        },
        {
          "load-end": 3.42,
          "load-start": 2.67,
          "status": "invalid",
          "value": null
        },
        {
          "load-end": 2.49,
          "load-start": 3.1,
          "status": "invalid",
          "value": null
        }
      ],
      "title": "List import rows a second at low load",
      "unit": "per-s",
      "verdict": "invalid"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "Workflow 7B (e)",
      "gap": null,
      "id": "lists-match",
      "median": 28.651,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 0.62,
          "load-start": 1.04,
          "status": "valid",
          "value": 26.817
        },
        {
          "load-end": 0.8,
          "load-start": 0.76,
          "status": "valid",
          "value": 28.651
        },
        {
          "load-end": 3.5,
          "load-start": 1.06,
          "status": "valid",
          "value": 30.822
        }
      ],
      "title": "List match at 10 requests/s",
      "unit": "ms",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "Workflow 7B (f)",
      "gap": null,
      "id": "graph-queries",
      "median": 322.595,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 0.43,
          "load-start": 1.08,
          "status": "valid",
          "value": 307.46
        },
        {
          "load-end": 0.97,
          "load-start": 0.7,
          "status": "valid",
          "value": 322.595
        },
        {
          "load-end": 0.99,
          "load-start": 1.46,
          "status": "valid",
          "value": 339.873
        }
      ],
      "title": "Graph queries, submit to completed",
      "unit": "ms",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "rings of 50 (fix-11d, 89a508d75)",
      "contract": "Phase 7 R007",
      "gap": null,
      "id": "graph-dense",
      "median": 16.5,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 2.93,
          "load-start": 1.49,
          "status": "valid",
          "value": 16.5
        }
      ],
      "title": "graph:benchmark on a dense neighbourhood, 1,000,000 accounts",
      "unit": "ms",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "Workflow 7B (g)",
      "gap": null,
      "id": "transactions-write",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 4.52,
          "load-start": 2.25,
          "status": "valid",
          "value": 118.577
        },
        {
          "load-end": 3.63,
          "load-start": 3.9,
          "status": "invalid",
          "value": 50655.235
        },
        {
          "load-end": 2.72,
          "load-start": 3.27,
          "status": "invalid",
          "value": 50030.455
        },
        {
          "load-end": 2.27,
          "load-start": 2.22,
          "status": "invalid",
          "value": 57403.011
        },
        {
          "load-end": 3.24,
          "load-start": 0.63,
          "status": "invalid",
          "value": 2773.434
        },
        {
          "load-end": 3.18,
          "load-start": 2.82,
          "status": "valid",
          "value": 1059.214
        }
      ],
      "title": "Transaction writes at 50/s",
      "unit": "ms",
      "verdict": "not-measured"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "Workflow 7B (g)",
      "gap": null,
      "id": "transactions-search",
      "median": 470.804,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 3.49,
          "load-start": 2.68,
          "status": "valid",
          "value": 3798.553
        },
        {
          "load-end": 4.88,
          "load-start": 3.29,
          "status": "valid",
          "value": 470.804
        },
        {
          "load-end": 3.36,
          "load-start": 3.7,
          "status": "valid",
          "value": 180.185
        }
      ],
      "title": "Transaction search at 100/s",
      "unit": "ms",
      "verdict": "reported"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "mean",
        "unit": "ms",
        "value": 1
      },
      "configuration": "default",
      "contract": "C93.2",
      "gap": -0.994,
      "id": "network-lookup",
      "median": 0.006406,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 1.11,
          "load-start": 1.13,
          "status": "valid",
          "value": 0.006713
        },
        {
          "load-end": 1.05,
          "load-start": 1.05,
          "status": "valid",
          "value": 0.006406
        },
        {
          "load-end": 1.02,
          "load-start": 1.02,
          "status": "valid",
          "value": 0.006357
        }
      ],
      "title": "Network lookup over real-size snapshots, mean a call",
      "unit": "ms",
      "verdict": "met"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "Workflow 7A (d)",
      "gap": null,
      "id": "city-lite-verify",
      "median": null,
      "owner": "calibration-load-11d",
      "takes": [],
      "title": "MmdbSnapshot.verify on City Lite",
      "unit": "s",
      "verdict": "not-measured"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "Workflow 7A (a)",
      "gap": null,
      "id": "process-memory",
      "median": 277.5,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 0.72,
          "load-start": 0.72,
          "status": "valid",
          "value": 277.5
        }
      ],
      "title": "API and worker RSS with the default sources",
      "unit": "mib",
      "verdict": "reported"
    },
    {
      "budget": {
        "comparison": "<=",
        "metric": "ratio",
        "unit": "ratio",
        "value": 1.05
      },
      "configuration": "default",
      "contract": "C272.1",
      "gap": 2.883,
      "id": "jit-comparison",
      "median": 3.933,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 3.19,
          "load-start": 2.74,
          "status": "valid",
          "value": 3.933
        },
        {
          "load-end": 2.34,
          "load-start": 2.59,
          "status": "valid",
          "value": 0.327
        },
        {
          "load-end": 2.05,
          "load-start": 2.36,
          "status": "valid",
          "value": 0.999
        }
      ],
      "title": "Runtime role jit off against on, worst p95 change",
      "unit": "ratio",
      "verdict": "missed"
    },
    {
      "budget": null,
      "configuration": "2 x the 2,000,000-name sync's 183.5 s rebuild statement",
      "contract": "C272.2",
      "gap": null,
      "id": "role-timeouts",
      "median": 370.0,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 7.54,
          "load-start": 0.43,
          "status": "valid",
          "value": 40.0
        }
      ],
      "title": "The runtime role's statement timeout",
      "unit": "s",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "default",
      "contract": "C272.3",
      "gap": null,
      "id": "pool-at-knee",
      "median": 10.0,
      "owner": "calibration-load-11d",
      "takes": [
        {
          "load-end": 10.49,
          "load-start": 0.43,
          "status": "valid",
          "value": 10.0
        }
      ],
      "title": "Database connections per process at the knee",
      "unit": "count",
      "verdict": "reported"
    }
  ],
  "schema": "openverify/calibration-summary@1",
  "status": "published",
  "workflow": "11D"
}
```
<!-- openverify:calibration-summary:end -->
