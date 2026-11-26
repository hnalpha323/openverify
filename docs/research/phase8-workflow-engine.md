# Phase 8 research: a durable workflow engine on OpenVerify's stack (engineering)

Status: complete, 2026-10-27. Every section below was written as it was finished.

**Summary.**
- **Model.** A persisted state machine per run and step over Postgres, with BullMQ on Valkey only as a wake-up and an append-only journal as history; not a journal replayed through deterministic code, because definitions are operator-authored JSON, not code. The existing event outbox, Phase 6's fenced claims and the `SKIP LOCKED` sweeps are the building blocks.
- **Cost.** On the pinned image with durable commits: 143 effectful steps/s at one client and 1,577 at 32 (two short transactions each); control-flow nodes in one transaction, 2,880/s; claiming 500 due timers out of a million, 6.3 ms [M1]. Commit latency dominates.
- **Semantics.** Timers are `due_at` rows (BullMQ delays as accelerators); wait-for-event resolves by conditional update, with an advisory lock closing the registration race; joins are counter rows; loops, modules and retries are capped; no automatic compensation.
- **Triggers.** Event triggers through `workflow_trigger_deliveries` written in the event's own transaction (exactly once per event and workflow); schedules in Postgres with `cron-parser` 5.10.2 and our own DST rules (croner's rules changed between 10.0.1 and 11.0.0); causality-depth and self-trigger guards against loops.
- **Expressions and templates.** Our own JSONLogic dialect (json-logic-js 2.0.5 follows prototype paths, has a `log` operator and no limits); value-level templates of our own (Handlebars and liquidjs had critical 2026 advisories); a zod-typed variable model.
- **Engines.** Build, do not adopt: Inngest (SSPL), Restate (BSL), n8n (Sustainable Use) and Windmill (AGPL) fail rule 4; Temporal, Hatchet, Trigger.dev, Conductor and Kestra add services (Temporal is not tested on Postgres 17); DBOS (MIT, Postgres only) is the closest reference. BullMQ 6 now has an optional Postgres backend: the exit if Valkey becomes a burden.
- **Tenancy.** BullMQ's round-robin groups are commercial (Pro), so fairness is admission in Postgres: per-environment in-flight slots and rotation.

## 0. Scope, method and conventions

Prepared 2026-10-27 for OpenVerify Phase 8 ("Workflows and cases", `docs/PLAN.md` §6 Phase 8 and the Workflows and Cases rows of §2 [R1]). This note is the **engine** half of the engineering work: how to run workflow definitions durably on the stack OpenVerify already operates (Postgres 17 in the pinned image `pgvector/pgvector:pg17`, Drizzle, Fastify, BullMQ 6 on Valkey 9.1, pino). Sibling notes cover the rest: Persona's public behaviour for workflows and cases (`phase8-behaviour.md`, [S1]), the action library with the Evaluate Code sandbox and the SSRF-safe HTTPS request (`phase8-actions-sandbox.md`, [S2]), and the visual editor and case management (`phase8-editor-cases.md`, [S3]). Where this note needs a public identifier (a path, an event name, a trigger or step type) it takes it from the repository's surface index [R4] or PLAN §2 [R1] and leaves the public semantics to [S1].

**Conventions.** Everything is in our own words. Identifiers (field names, enum values, event names, step and action type names, configuration keys, URL paths) are reproduced only for functional parity. Anything the sources do not state is marked **not documented**; a statement we infer, and that no source makes, is marked **(inference)**. Every claim carries a citation key defined in section 9, with the URL and the read date (all 2026-10-27). Licence verdicts use repository rule 4 [R2]: ✅ passes, ⚠️ passes with a caveat or needs an owner decision, ❌ fails. Tiers R / H / A are those of ADR 0002 [R3].

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-13**. Each package row gives the latest version and the newest one that passes.

**Method.**
- The repository was read, never changed: `docs/PLAN.md` §2, §3, §5, §6; `CLAUDE.md`; ADR 0001 and 0002; the surface index; the Phase 6 plan (C72–C75, C84, the deferral list and decisions 28 and 48) and the Phase 7 plan (C110, decisions 18 and 41); `apps/api/src/{worker.ts,jobs/,events/,webhooks/,services/{events,retention}.ts}`; `packages/db/src/{tables/webhooks.ts,tables/reports.ts,repositories/{events,webhooks,sweeps,report-runs,retention}.ts}`; `packages/contracts/src/{ids.ts,dashboard-api.ts}`; `apps/api/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`; `infra/docker-compose.yml` [R1]–[R20]. Phase 6 is being built in the same working tree while this was written, so some Phase 6 files are still stubs (noted where it matters).
- Package facts come from each registry's metadata document and the LICENSE file at the release tag or commit; documentation from the publisher's own pages. Every host's `robots.txt` was read before any other request to it, with at most one request per second per host (1.2 s in practice), a descriptive User-Agent without contact details, and no personal data sent. Downloads went into new, empty directories under `downloads/engine-*/`; scripts are in `scripts/engine_*.py`; Python ran with `-I`; nothing downloaded was executed.

## 1. What the code does today (jobs, events, outbox, webhooks, fenced claims)

`packages/workflow-engine` does not exist yet; PLAN §3 reserves it for "durable executor, JSONLogic conditions, QuickJS sandbox for Evaluate Code" [R1]. Everything a durable engine needs has a working precedent in the API already, and the engine should reuse those patterns rather than invent new ones.

| Area | What the code does today | What it means for Phase 8 | Source |
|---|---|---|---|
| Queue library | `bullmq` 6.3.11 (exact pin) over `ioredis` 5.11.1; BullMQ's own dependencies include `cron-parser` 5.10.1 (which brings `luxon` 3.7.2) and `msgpackr` 2.1.0; `pg` is an optional peer of BullMQ 6 | A cron parser is already in the lockfile through BullMQ; BullMQ 6 uses the `pg` peer for an optional Postgres backend (section 7) | [R13][R14] |
| Producers | `JobQueue<Data>` wraps a BullMQ `Queue` so producers are testable without Valkey; job data carries **ids only** and the worker reads the rest from Postgres; `process-verification` uses the verification id as the job id, so a second submit is a no-op while the job exists | A workflow job should carry `(environment id, run id, step id, attempt)` only, never the run's variables, which stay in sealed Postgres columns | [R5] |
| Retry options | `process-verification`: 5 attempts, exponential backoff from 5 s with 0.5 jitter, completed ids kept a day, failed kept a week; webhook jobs: 3 BullMQ attempts for infrastructure errors only, while the business retry schedule is computed by the dispatcher | Two layers of retry, and the business layer lives in the database row; the engine should do the same for step retries | [R5][R7] |
| Kept job ids are a trap | BullMQ ignores `add` under an id that still exists, a completed or failed one included; the webhook sweep therefore removes a left-over job before re-adding (`replace: true`, Workflow 2B F011); Phase 6 C74.1 removes report-run jobs on completion and failure for the same reason | Step jobs must be removed on completion and failure (`removeOnComplete: true`, `removeOnFail: true`) or carry the attempt in their id, and the database must be the record | [R7][R8] |
| Event outbox | `createEventPublisher().stage(tx, …)` validates the payload against the C5 contract, inserts the `events` row (payload sealed) and one `webhook_deliveries` row per matching webhook **in the caller's transaction**; `dispatch()` enqueues after commit and only logs a failure; a sweep every 30 s re-enqueues deliveries overdue by 60 s | This is the transactional outbox the event trigger needs: matching workflow triggers inside `stage()` makes "the event committed" and "the run is owed" one fact. Every real event goes through `stage()`; only webhook **simulation** calls `createEvent` directly (with `simulated: true`), and simulated events must not trigger workflows | [R6][R7] |
| Delivery record | `webhook_deliveries`: status, attempt count, `next_attempt_at`, an append-only `attempts` JSON array, a partial unique index on `(webhook_id, event_id) where not is_replay`; each attempt is recorded with `WHERE status = 'pending' AND attempt_count = attempt − 1`, so a duplicate job records nothing ("raced") | Exactly the shape of a step attempt: a numbered, conditional write makes a duplicate execution harmless to the record, though not to the outside world (section 2.2) | [R7][R9] |
| Fenced claims | Phase 6 C74.1: a run is claimed by one conditional `UPDATE` (pending and due, or running with an expired `claimed_until`) that sets a fresh `claimed_by` token, `claimed_until = now + 10 min` and `attempt + 1`; completion and final failure write only `WHERE claimed_by = $token AND status = 'running'`; a retryable error releases the claim; an eleventh claim ends the run `errored`; waits put the run back to `pending` with `not_before` and do not count as claims; a 15 s sweep enqueues claimable runs and is the outbox for lost enqueues | The engine's step claim should be this pattern verbatim, with the 10-minute lease sized to each action's time limit (section 2.3). The repository functions are still a stub owned by Workflow 6A (`report-runs.ts`), but the `report_runs` table with `claimed_by`, `claimed_until`, `attempt`, `not_before` and `enqueued_at` exists | [R8][R10] |
| Sweeps | Cross-environment sweeps take rows `FOR UPDATE SKIP LOCKED` in batches of 500 (`DEFAULT_SWEEP_LIMIT`); repeatable jobs use BullMQ job schedulers (`upsertJobScheduler` with `{ every }` or `{ pattern }`), one queue per job, concurrency 1 per process; `inquiry-expiry` every 60 s, the verification repair sweep every minute, `report-sweep` every 15 s | A timer sweeper and a trigger sweeper fit the existing registry; the cron `pattern` path already exists but is unused | [R11][R12] |
| Ids | Public ids are `<prefix>_<ULID>`; the ULID is generated in the application with a random 80-bit tail (not monotonic within a millisecond), before the transaction commits | Event ids are **not** a commit-ordered cursor: a consumer reading "events after id X" can miss an event that commits later with a smaller id (section 4.1) | [R15] |
| Failures in logs | Worker logs carry ids, statuses and error classes; failures are handed to BullMQ described by class and code (`describeJobError`), never by message, because BullMQ stores the message and stack in Valkey (Workflow 4B H001); pino redaction paths cover bodies, secrets and named PII keys four levels deep | Step errors must follow the same rule: a code and a class in Valkey and in the run history, never an HTTP body or a variable value | [R5][R24] |
| Retention | C16 deletes events after `event-retention-days` (default 90, except events a pending delivery still needs), finished webhook deliveries after 30 days, API logs after 30; reports are redacted, never deleted, after `report-retention-days` (default none) | Run history needs its own window and must not keep an event alive past its own (section 8.3); the event-deletion query needs a second exception for events a pending trigger still needs | [R16][R17] |
| Valkey persistence | Compose starts Valkey with `--appendonly yes` and a named volume, with a password and no other persistence or eviction flags | An AOF reduces but does not remove job loss on a crash; the default fsync policy and `maxmemory-policy` are what BullMQ's guidance is about (section 3.1) | [R18] |
| SSRF guard | The webhook sender resolves inside the socket's `lookup`, vets every answer (a mixed answer is refused), connects to the vetted address, follows no redirects, and times out at 10 s | The HTTPS-request action can reuse it; its extension (redirects, response size, methods) is [S2]'s subject | [R19] |
| Rate limiter | A GCRA limiter in Valkey (one Lua script per `consume`) that fails open when Valkey is down | Usable for per-environment admission of runs and steps (section 8.1), but "fails open" must become "defer" for a fairness limiter | [R20] |

**Two contracts from earlier phases that Phase 8 must honour.**
- **Phase 6 decision 28 and 48.** `on-report-match: needs_review` on an inquiry template version is OpenVerify's own stop-gap "before Phase 8 workflows exist"; it also routes an errored completion report to review. The workflow "Run report" action and match conditions, and cases holding reports, were deferred to Phase 8 [R8]. A workflow that reacts to `report/<type>.matched` must not double-apply what `on-report-match` already did: the template option should stay, and a workflow should see the inquiry already in `needs_review` (inference).
- **Phase 7 C110 and decision 18.** Every workflow step built on lists, graph, transactions and devices (Get List Match, Add Item To List, Add Item To Face List, Sync Graph, Run Graph Query, Create Transaction, Update Transaction Status, Set Relation, Trust Device), re-screening custom-list reports on a list update, case modules, transaction children and their redaction cascade, and re-screening a report when a linked account's fields change ("as a workflow trigger") all land in Phase 8. Auto-decline on a signal is never built in; "an operator who wants it writes a Phase 8 workflow" [R21]. So the engine is the only place an automated decline can come from, and it must record that it did (section 8.2).

## 2. Durable execution models

### 2.1 Two models

| | Journal replayed through deterministic code | Persisted state machine per run and step |
|---|---|---|
| Idea | The workflow is a function. Every effect goes through the SDK, which appends an event (or checkpoint) to the run's history; after a crash the function runs again from the top and each completed step returns its recorded result instead of executing | The workflow is data (a graph). The engine stores, per run, which nodes are pending, ready, running, waiting or finished, with their inputs and outputs; after a crash nothing re-executes: expired leases are reclaimed and the next ready node runs |
| Examples | Temporal: code must make the same command-producing calls in the same order on replay, or the run fails with a non-determinism error [E3b]; DBOS: the workflow function must be deterministic and steps idempotent; once a step is checkpointed it is never re-executed [E5] | Conductor's JSON definitions [E13]; the existing `report_runs` and `webhook_deliveries` rows in OpenVerify are small instances of this model [R7][R10] |
| Versioning | Hard: a change in which steps run, or their order, breaks runs started on old code; both Temporal and DBOS offer patching (branch on a recorded marker) and versioning (route old runs to old code) [E3b][E5] | Easy: a run pins the version it started on, and the interpreter reads that version's graph (section 5) |
| History growth | Bounded by the engine: Temporal caps a history at 51,200 events or 50 MB and expects continue-as-new for longer runs [E3] | Rows per step execution; bounded by our own limits (section 3.9) |
| Cost per step | DBOS: one database write per step plus two per workflow [E5] | Measured below: two short transactions for a step with an external effect, one for a control-flow node |
| Fit for OpenVerify | Poor: definitions are operator-authored JSON, so the "deterministic code" would be our interpreter, and every interpreter change would become a versioning problem for in-flight runs (inference) | **Good** (recommended) |

**Recommendation.** A persisted state machine, with an append-only journal kept **as history, not as the replay source**. The interpreter is a pure function `advance(definition, run state, completed step) → next state + steps to make ready`, so it can still be replayed in tests and for a future "simulate" feature, but recovery never depends on replay (inference).

### 2.2 Delivery: at-least-once execution, exactly-once recording

- **Execution is at least once.** A worker can perform a step's effect and die before recording it; the lease then expires and the step runs again. Nothing in BullMQ or Postgres removes that window; BullMQ's own guidance is to design jobs to be idempotent [B7] and BullMQ moves a job whose lock was not renewed back to waiting ("stalled") [B8].
- **Recording is exactly once.** Every write that finishes a step is fenced (`WHERE id = $step AND claimed_by = $token AND status = 'running'`) as Phase 6 C74.1 does [R8], and every attempt is numbered as the webhook dispatcher numbers its attempts [R7], so a duplicate execution cannot record twice or advance the run twice.
- **Idempotency per step, by action kind (proposed):**

| Action kind | Key | Effect of a duplicate execution |
|---|---|---|
| Internal writes that create something (create case, create inquiry, create transaction, add list item) | A unique `(environment_id, workflow_run_step_id)` column on the created row. The C12 HTTP idempotency store is not the tool: it keys on the principal and the request fingerprint and keeps answers for 24 hours only [R23], while a step can be retried days later | None: the second insert conflicts and returns the first result |
| Internal state transitions (approve, decline, review, tag, assign, set status) | The target's state machine plus the step id recorded on the transition | None when the target is already in the requested state; a transition made by someone else in between is reported as `already_decided`, not overwritten (as Phase 6 records `inquiry_already_decided` [R8]) |
| Outgoing HTTPS | Header `Idempotency-Key: <run step id>` (stable across attempts) plus the existing HMAC signature scheme [S2] | Depends on the receiver; documented |
| Email, SMS, Slack | Intent row written before sending; result written after | At most one duplicate message per crash inside the send window, for providers without idempotency; stated in the docs |
| Evaluate Code | None needed: pure function of its inputs ([S2]) | None |

### 2.3 Crash recovery and fenced claims

- **Claim** a ready step with one conditional `UPDATE … FOR UPDATE SKIP LOCKED` (Postgres documents `SKIP LOCKED` as giving an inconsistent view that suits queue-like tables with several consumers [P1]), setting `claimed_by` to a fresh token, `claimed_until` to now plus the action's time limit plus a margin, and `attempt + 1`.
- **Lease length per action**, not one global 10 minutes: an HTTPS call with a 10 s timeout needs a lease of about 30 s, a report run minutes (inference). Long actions extend their lease (a heartbeat every third of the lease) and stop when the extension fails.
- **Two detectors**: BullMQ's stalled-job check (about 30 s by default, per its production guide [B2]) is the fast path; a sweeper that reclaims `status = 'running' AND claimed_until < now()` is the path that survives a Valkey loss.
- **Crash-loop cap**: a step whose claims exceed a cap (Phase 6 uses eleven [R8]) fails with `execution_error` instead of running again, so a step that kills its worker cannot loop.
- **Release on retryable error** before rethrowing, as C74.1 does, so the next attempt can claim at once.

### 2.4 What it costs: published figures and measurements

**Published.**
- BullMQ 6 on Postgres, indicative laptop figures with no-op jobs and durable settings: about 7,000 jobs/s added one at a time, 45,000/s with `addBulk`, 2,300/s processed by one worker at concurrency 1 and 11,000/s at concurrency 8–32; Redis on the same machine 6,000 and 18,000 processed [B1]. The same page puts processing throughput on Postgres at typically 1.5 to 2 times below Redis, and says that `synchronous_commit = off` removes the per-commit fsync wait at the cost of losing the latest commits on a crash [B1].
- DBOS: more than 40,000 workflows or steps per second on one Postgres in its own benchmark [E5].
- Hatchet: load-tested to 10,000 tasks per second [E9].
- Temporal publishes limits, not throughput, in the pages read: 51,200 events or 50 MB per history, 2,000 pending operations of each kind per execution [E3].

**Measured here** [M1] (the pinned image, PostgreSQL 17.11, default durable settings, 128 MB shared buffers, a throwaway container with `--network none` on a 12-thread WSL2 machine whose virtual disk makes fsync slow; synthetic tables shaped like section 2.5; pgbench 17.11, 20–30 s per run):

| Workload | 1 client | 8 clients | 32 clients |
|---|---|---|---|
| Step with an external effect: claim transaction (`SKIP LOCKED` + update) then completion transaction (fenced update + journal row + next step row) | 143 steps/s (7.0 ms each) | 437 steps/s | 1,577 steps/s |
| Same, `synchronous_commit = off` | 597 steps/s | — | 3,699 steps/s |
| Control-flow node done in one transaction (claim, complete, journal, next) | 199 steps/s (5.0 ms) | — | 2,880 steps/s |
| Timer sweep: take 500 due timers out of 1,000,000 waiting (10,021 due), `FOR UPDATE SKIP LOCKED`, mark ready | 6.3 ms per batch | | |
| Count due timers (index-only scan) | 4.1 ms | | |

**Reading (inference).**
- The cost is commit latency, not query work: at one client each commit costs about 3.5–5 ms on this disk, and group commit multiplies throughput with concurrency. A server-class SSD will do better; the ratios hold.
- A control-flow node (condition, fork, join, loop counter, set variable) should run **inside the transaction that completes the previous step**: nothing external happens, so it needs no claim, and the measured cost per node falls by 30 to 45 percent. Only nodes with an effect outside the database get the two-transaction claim and complete.
- An identity-verification workflow of 5–30 steps at about 1,500 steps/s is tens of thousands of inquiries an hour on this machine, far above the load the other phases plan for; the engine is not the bottleneck, so durability settings stay at their defaults (no `synchronous_commit = off`).
- **Churn matters.** After about 212,000 steps over some three minutes of runs the ready index had grown from 3.1 MB to 9.7 MB and the steps table held 365,433 dead tuples, with one autovacuum run. The steps table needs per-table autovacuum settings (a lower scale factor) and finished steps should move out of the hot partial indexes at once (they do: the indexes are partial on `ready`, `waiting` and `running`).
- A million long timers cost a 27 MB partial index and a few milliseconds per sweep, so long waits belong in Postgres, not in Valkey (section 3.1).

### 2.5 Proposed storage (ours; names illustrative, identifiers from [S1] where public)

| Table | Holds | Notes |
|---|---|---|
| `workflows` | environment, name, status, the published version | |
| `workflow_versions` | immutable definition (JSON graph), `schema_version`, trigger configuration, canonical-JSON SHA-256, published at and by | Public path `workflow-versions` [R4]; drafts are mutable until publish (section 5) |
| `workflow_triggers` | an index derived at publish: `(environment_id, kind, event_name)` → workflow and version, plus the filter | Rebuilt in the publish transaction |
| `workflow_trigger_deliveries` | one row per (event, workflow) owed a run: unique `(event_id, workflow_id)`, status `pending` / `run_created` / `filtered` / `refused`, reason code | The webhook-deliveries pattern applied to triggers (section 4.1) |
| `workflow_runs` | pinned version, status, trigger kind and reference, root and parent run, depth, step-execution count, deadline, error code, sealed variables, the subject ids it concerns, `redacted_at` | Public paths `workflow-runs`, `workflow-runs/{id}` [R4] |
| `workflow_run_steps` | node key plus iteration path (loop index, branch), status, `due_at`, attempt, `claimed_by`, `claimed_until`, `enqueued_at`, wait fields (event names, correlation key, `timeout_at`), sealed input and output, error code, times | Unique `(run_id, node_key, iteration_path)`; partial indexes on `ready`, `waiting` and `running` as measured |
| `workflow_run_journal` | append-only history: `run_created`, `step_ready`, `step_started`, `step_succeeded`, `step_failed`, `retry_scheduled`, `wait_started`, `wait_resolved`, `wait_timed_out`, `run_canceled`, … with attempt, duration and error code, **never values** | An append-only trigger like `report_actions`' [R8] |
| `workflow_schedules` | cron, IANA time zone, `next_fire_at`, last fire, catch-up policy | Section 4.2 |
| `workflow_environment_slots` | per environment: steps in flight, the cap, last served | Fairness (section 8.1) |

Sealed columns use `sealJson` with row-bound AAD and join `ENCRYPTED_COLUMNS` and `REWRAP_TABLES`, as Phase 6 did for its tables [R8]. Sealing costs about 35 µs per value on one Node thread (Phase 7's measurement of normalise, HMAC and seal together [R22]), small against a 5 ms commit.

BullMQ carries only `{ environmentId, runId, stepId, attempt }` on one `workflow-step` queue (job id `<step id>-<attempt>`, removed on completion and failure), as `process-verification` and `webhook-delivery` carry ids only [R5][R7].

## 3. Step semantics

### 3.1 Timers

| Option | How it works | Precision | After a Valkey loss | Verdict |
|---|---|---|---|---|
| BullMQ delayed job | `add(…, { delay })`; BullMQ says a delayed job is not guaranteed to run at the exact time, depending on worker load and how many jobs share that moment, though usually accurate; `changeDelay` works only while the job is still delayed [B9] | Good when workers are idle | **Lost** with the data: the delay exists only in Valkey. Valkey's default AOF policy fsyncs every second, so a crash loses up to about a second of writes; a flushed or replaced instance loses everything [V1] | A precise wake-up, never the record |
| BullMQ job scheduler | `upsertJobScheduler` with `every` or a cron `pattern` and `tz`; one delayed job exists per scheduler; the next job is produced only when the previous one starts processing, so a busy queue fires less often than asked; job ids are BullMQ's own; v6 removed the legacy repeat APIs and `utc` [B10][B11] | Interval-aligned to the clock | Lost with Valkey; recreated by the next `upsert` at worker start (as the worker does today [R11]) | Fine for OpenVerify's own sweeps; not for customer schedules, which need per-schedule state and audit |
| Postgres timer column + sweeper | The step row holds `due_at`; a sweeper takes due rows `FOR UPDATE SKIP LOCKED` in batches and makes them ready | The sweep interval (5–15 s) unless a delayed job woke the step first | **Survives** (the database is the record) | **Recommended as the record**, with the delayed job as an accelerator |

**Design (proposed).**
- Every timer is a `due_at` (timestamptz, set from the database's `now()` so one clock decides; inference). When it falls within a horizon (for example one hour), the writer also adds a BullMQ delayed job for the exact moment; further-out timers get no job, and the sweeper adds one when they enter the horizon. Valkey then holds at most an hour of timers, and a million month-long waits cost Postgres a 27 MB index and a 6 ms sweep [M1].
- A step woken by both the job and the sweeper is harmless: the claim is conditional.
- Durations are minimums. Temporal says the same of its timers and advises against relying on sub-second accuracy [E3c]; the engine promises "not before `due_at`, normally within seconds, at worst within the sweep interval plus a lease after an infrastructure failure".
- **Valkey settings.** BullMQ requires `maxmemory-policy noeviction` and recommends AOF with one fsync per second [B2]. Compose already runs `--appendonly yes` [R18], and Valkey's default `maxmemory` of 0 on 64-bit systems means no eviction limit [V2]; but the same Valkey also holds caches and rate-limit keys [R20], so an operator who adds an LRU policy for caching would break the queues. The worker should read `CONFIG GET maxmemory-policy` at start and log an error unless it is `noeviction` (ours; warn only, since managed services may refuse `CONFIG`).

### 3.2 Waiting for an event, with correlation and a timeout

A wait step stores the event names it accepts, a **correlation key** (an object id taken from the run's variables, for example the inquiry id; ids are not personal data, so the key can stay plain text), an optional JSONLogic filter over the event payload (section 6), and `timeout_at`.

- **The event arrives.** Inside the event publisher's `stage()` (the event's own transaction, section 4.1), the publisher looks up waits by `(environment_id, event_name, correlation_key)` with `status = 'waiting'` and resolves each with one conditional update that records the event id; the filter is evaluated by the worker when the step resumes, and a non-matching event puts the wait back.
- **The timeout fires.** The sweeper updates `status = 'waiting' AND timeout_at <= now()` to `timed_out`, and the graph follows the step's timeout edge.
- **The event–timeout race.** Both paths are conditional updates of the same row. Under Read Committed, the second updater waits for the first, then re-evaluates its `WHERE` clause against the updated row and skips it if it no longer matches [P2]. So exactly one of "resolved" and "timed out" wins, with no extra locking.
- **The event–registration race** is the subtle one. If the event commits while the wait is being registered, neither transaction sees the other: the event's lookup finds no wait yet, and the registration does not see the uncommitted event. Both sides therefore take `pg_advisory_xact_lock(hash(environment_id, correlation_key))` (transaction-scoped advisory locks [P3]) before they look; the registration then also checks the events table for a matching event created since the step became ready. Whichever takes the lock second sees the other's committed rows, because each Read Committed statement reads what was committed before it began (inference from [P2][P3]; a Testcontainers race test should prove it). The correlation lock is always the **last** lock either path takes, after any inquiry, account or report row locks of the existing lock order, so it cannot create a deadlock cycle (inference). A hash collision only serialises two unrelated keys.
- **Several events.** A wait resolves on the first matching event; later ones are ignored by that wait (they can still trigger other workflows).

### 3.3 Parallel fan-out and join

- **Fork** creates one step row per branch in the transaction that reaches the fork. **Join** is a row with a counter; each branch's completion transaction locks it (`UPDATE … SET remaining = remaining - 1 … RETURNING`), so concurrent completions serialise on one row and exactly one of them makes the join ready (inference).
- **Modes:** `all` (every branch must finish; a failed branch fails the join unless the branch is marked to continue on error), `any` (the first **successful** branch completes the join), `first` (the first branch to finish, success or failure, decides). The public semantics of joins are [S1]'s; these are the three modes this note designs for.
- **Losers** of `any` and `first` are cancelled: their pending and waiting steps become `canceled` in the join's transaction; a running loser receives BullMQ's cancellation signal (an `AbortSignal` passed to the processor [B12]) and, whatever it does, its completion is fenced out because its status has changed. An effect already sent (an email, an HTTPS call) is not undone; the docs say so.
- **Outputs**: after an `all` join every branch's outputs are in scope; after `any` or `first` they are optional in the type model (6.5), and the winner's branch key is a variable.
- **Not BullMQ flows.** Flows make a parent wait for its children and can fail a parent when a child fails [B13], but the tree lives only in Valkey; the join belongs in Postgres with the rest of the run (inference).
- **Caps** (ours): at most 10 branches per parallel step and parallel nesting depth 3.

### 3.4 Loops

- **for-each** over a list variable, **while** a JSONLogic condition holds, and **map** (for-each that collects one output per item); the iteration index is part of each step's key (`loop-1[3]/send-email`), so every iteration has its own rows and history.
- Sequential by default; a concurrency option up to 10 runs iterations like parallel branches.
- **Caps** (ours): items per for-each or map ≤ 1,000; while iterations ≤ 100 by default and ≤ 1,000 at most; exceeding a cap fails the loop step with `loop_limit_exceeded` (never a silent stop); every iteration counts towards the run's step-execution cap (3.9).

### 3.5 Sub-workflow modules

- A module step starts a **child run** (its own row, `parent_run_id`, `root_run_id`, `depth`), waits for it, and receives its output; the child runs in the same environment, never another, and inherits the remaining deadline.
- **Version pinning**: a module reference names either a version id or "the published version at the time the child starts", and the child records which one it got (section 5).
- **Recursion guards**: at publish, build the static call graph of the module references and refuse a cycle; at run time, refuse a child whose workflow already appears in the ancestor chain and any depth beyond 5 (ours), because "latest published" can change after publish. Errors: `module_recursion`, `module_depth_exceeded`.
- Cancelling a parent cancels its children; a child's failure is the module step's failure.

### 3.6 Cancellation

A cancel (API, console, or a parent's cancellation) is a database write first: the run becomes `canceled`, pending and waiting steps become `canceled`, children are cancelled, then running steps get the BullMQ abort signal and queued jobs are removed best-effort [B12]. A step that finishes after the cancel cannot record (fenced). Effects already made stay made.

### 3.7 Retries, and which errors retry

- **Business retries belong to the engine**, as the webhook dispatcher computes its own schedule and keeps BullMQ's attempts for infrastructure errors only [R7]. A failed attempt that may retry records `retry_scheduled` with a new `due_at` from the action's policy: attempts (default 3, at most 10), exponential backoff with jitter (BullMQ's built-in exponential delay is `2^(attempts−1) × delay`, with an optional jitter fraction [B14]), a maximum delay, and `Retry-After` honoured for HTTP 429 and 503.
- **Retry**: network errors, timeouts, HTTP 5xx, 408 and 429, a provider's own transient code, a database serialisation or deadlock error.
- **Do not retry**: HTTP 4xx other than 408 and 429; a destination the SSRF guard refuses (the webhook sender already marks `invalid_url` and `blocked` as not retryable [R19]); input or output validation errors; expression and template errors; permission errors; Evaluate Code's deterministic failures (time or memory limit, thrown error: the same input gives the same result); a `PermanentJobError` code [R5]; a missing subject (redacted or deleted).
- After the last attempt the step fails; the graph follows its error edge if it has one, otherwise the run ends `errored` with the step's code (the public event `workflow-run.errored` exists [R4]).

### 3.8 Compensation

A saga-style compensation (an inverse action for each completed step, run in reverse on failure) works only for actions with a real inverse: add and remove a tag, add and remove a list item, assign and unassign a case. Messages, outgoing HTTPS calls and inquiry decisions have none: a decision has already emitted events and webhooks, and a decline is reversed only by a new decision. **Recommendation:** no automatic compensation in Phase 8; explicit error edges let an author route a failure to a review or a case, and the docs say which actions cannot be undone (inference).

### 3.9 Limits (proposed defaults, ours, each enforced with a code)

| Limit | Default | Basis |
|---|---|---|
| Nodes per version | 200 | An editor graph larger than this is unreviewable; the publish payload stays small |
| Step executions per run (loops and retries included) | 5,000 | Rows per run stay bounded; Temporal caps a history at 51,200 events and warns at 10,240 [E3] |
| Run duration | 90 days | Long enough for a document-resubmission wait; equal to the default event retention [R16] |
| Wait timeout | 90 days | Same |
| Trigger snapshot | 256 KiB sealed | An event document with `included` resources |
| Step output (journaled) | 64 KiB | DBOS warns that checkpoint size follows output size and advises storing large outputs elsewhere [E5]; larger HTTP responses are truncated or refused by the action [S2] |
| Run variables in total | 1 MiB | |
| Parallel branches / nesting | 10 / 3 | |
| Loop items / while iterations | 1,000 / 100 (1,000 max) | |
| Module depth | 5 | |
| Workflows triggered by one event | 50 | Bounds the fan-out inside the event's transaction (4.1) |
| Trigger causality depth | 8 | Loop guard (4.4) |
| Run history kept | `workflow-run-retention-days`, default 90 | Section 8.3 |

## 4. Triggers

PLAN §2 lists the public trigger types as event, API, scheduled, recurring, manual, account, case and verification [R1]; their configuration is [S1]'s subject. Engineering-wise they reduce to three sources: **an event committed**, **a time reached**, and **a request made**.

### 4.1 Event triggers fed from the events table

**Option A, recommended: fan out inside the event's transaction (the outbox).** `createEventPublisher().stage(tx, …)` already writes the event and its webhook deliveries in the caller's transaction [R6]. Phase 8 adds one indexed lookup there: published triggers for `(environment_id, event_name)` from `workflow_triggers`, and one `workflow_trigger_deliveries` row per match, inserted `ON CONFLICT (event_id, workflow_id) DO NOTHING`. After commit, `dispatch()` enqueues a `workflow-trigger` job per delivery; a sweeper re-enqueues deliveries left pending, exactly as for webhooks [R7].
- **Exactly once per event and workflow** by construction: the unique index admits one delivery, and the run is created from the delivery with a unique `trigger_delivery_id`, so a repeated job creates nothing.
- **No missed events**: a delivery exists if and only if its event committed.
- **Cheap inside domain transactions**: the trigger filter (JSONLogic over the payload) is **not** evaluated in `stage()`. The worker evaluates it and marks the delivery `run_created` or `filtered`, so an operator's rule can never slow or fail an inquiry transition (inference). The fan-out per event is capped (3.9).
- **Simulated events never trigger**: webhook simulation writes its event through `createEvent` directly with `simulated: true`, bypassing `stage()` [R7], and that must stay so.

**Option B, not recommended: a cursor over `events`.** A consumer that reads "events after the last one I saw" needs a commit-ordered cursor. Event ids are ULIDs generated in the application before commit, with a random tail [R15], so an event that commits later can carry a smaller id and be skipped. A correct cursor would store `pg_current_xact_id()` (an `xid8`) with each event and read only below `pg_snapshot_xmin(pg_current_snapshot())` [P4]: workable, but it adds a column to a hot table, a single-consumer cursor, and a delay equal to the longest open transaction, to do what option A does for free (inference).

**Ordering.** Runs triggered by different events about the same subject (say `inquiry.completed` then `inquiry.approved`) may run concurrently and finish in any order. The engine promises no order across runs by default; actions re-read the subject's current state rather than trusting the trigger snapshot. A per-workflow option "one run at a time per subject" (later runs wait in `created` until the earlier one finishes) covers authors who need order (ours, inference); within one run, the graph orders the steps.

**Retention and redaction interplay.** C16 deletes events after `event-retention-days` (default 90) except those a pending webhook delivery needs [R16]; the same exception must cover pending trigger deliveries. A run keeps its own sealed copy of the trigger document, so it does not need the event row later, and that copy is redacted with its subject (section 8.3).

### 4.2 Schedules and recurrence

**Storage and firing (proposed).** `workflow_schedules (cron, tz, next_fire_at, last_fired_at, catch_up)`; a sweeper every 15 s takes due schedules `FOR UPDATE SKIP LOCKED`, creates the run with a unique `(schedule_id, fire_time)` (exactly once per fire time), and moves `next_fire_at` to the first fire time after now. An outage of several periods therefore gives **one** catch-up run, not a burst, the rule Phase 6 C74.3 (b) adopted for recurring reports [R8]. A BullMQ job scheduler is not used for customer schedules: it lives only in Valkey and produces its next job only when the previous one starts [B10].

**Cron libraries.**

| Package | Latest / newest passing | Licence | Notes | Verdict |
|---|---|---|---|---|
| `cron-parser` | **5.10.2** (2026-10-09) / same; the lockfile holds 5.10.1 through BullMQ 6.3.11, and BullMQ 6.3.14 depends on 5.10.2 [R14][N13] | MIT ✅ at `5033a31` [N14] | Five or six fields (optional seconds), `L`, `#`, and `H` (a hashed random value with a seed); time zones through Luxon; a strict mode that refuses expressions setting both day of month and day of week (a combination its README calls ambiguous), refuses empty expressions and unusable hash ranges, and **requires all six fields, seconds included**; its README claims DST support without describing the behaviour in gaps and overlaps (**not documented**) [N14] | ✅ **recommended**: BullMQ's own job schedulers use it [B11], so one parser serves both |
| `luxon` | **3.7.2** (2025-09-05) / same | MIT ✅ at `4262a38` [N15] | cron-parser's only dependency | ✅ |
| `croner` | 11.0.0 (2026-10-26, fails the age rule) / **10.0.1** (2026-02-01) | MIT ✅ [N16] | No dependencies; seconds and year fields, `L`, `W`, `#`, `+`. **Its DST rules changed between versions**: the 10.0.1 README says times in a DST gap are skipped and times in an overlap run once, at the first occurrence; the 11.0.0 README says a fixed-time job in a gap now runs at the first valid time after the gap, and an interval job runs at both occurrences of a repeated hour, deliberately deviating from OCPS 1.4 §4.3.1 [N16] | ⚠️ passes; the change shows why DST behaviour must be pinned by our own tests, whatever the library |

**Time zones and DST (proposed rules).**
- A schedule names an IANA zone; Postgres uses the same IANA database and applies the latest known rules to future times [P5]. `next_fire_at` is stored as UTC `timestamptz` and recomputed after each fire, so a tz-database update reaches a schedule at its next computation (inference).
- **Our** DST semantics, documented and tested with golden vectors whatever the library does: a fixed local time that does not exist on a spring-forward day fires at the first valid minute after the gap (a daily check should not silently skip a day); a fixed local time that occurs twice fires once, at the first occurrence; interval schedules (`*/15 * * * *`) follow real elapsed time. Golden zones: Europe/London, America/New_York, Australia/Lord_Howe (a 30-minute shift), Asia/Kolkata (no DST), plus a southern-hemisphere zone.
- Five-field cron at the API (no seconds), minimum interval 1 minute, no `H`; because cron-parser's strict mode wants six fields, the engine prefixes a `0` seconds field and parses in strict mode, which keeps the day-of-month and day-of-week check; the console shows the next five fire times in the schedule's zone and in UTC (ours).
- **Object-scoped recurrence** ("every month, for every account of type X"): one scheduled run that iterates accounts in batches through a loop, not one run per account created at once, so a schedule cannot create hundreds of thousands of runs in one tick (inference; the public semantics are [S1]'s).

### 4.3 Manual and API triggers

- `POST /workflows/{workflow-id}/trigger` is a public path [R4]. The body's inputs are validated by the published version's input schema (zod, section 6.5); the response is the created run (`workflow-runs/{workflow-run-id}` [R4]).
- `Idempotency-Key` works through the existing C12 plugin for `POST` [R23]; a unique `(workflow_id, idempotency_key)` on runs makes the guarantee outlive the plugin's 24-hour window (ours).
- The console's "run now" uses the same path with the operator's principal and writes an audit entry; both go through the C12 rate limits per environment.
- The scope a run acts with, and how an author's own rights bound what the workflow may do, is [S2]'s subject.

### 4.4 Loops between workflows

A workflow whose action emits the event that triggers it (it adds a tag, which emits a tag event that triggers it again) loops forever; two workflows can do the same to each other. Guards (proposed):
- **Causality.** An event staged inside a step carries an internal `caused_by_run_id` (a new nullable column on `events`, never in the public payload). A run created from such an event has `trigger_depth = cause's depth + 1`; past 8, the delivery is `refused` with `trigger_depth_exceeded`.
- **Self-trigger off by default.** A delivery whose workflow already appears in the causal chain of the same root run is refused with `trigger_cycle`, unless the workflow opts in.
- **Rate guard.** At most N runs per (workflow, subject) per minute through the existing GCRA limiter [R20], deferring the excess; for this guard the limiter must defer, not fail open, when Valkey is down (inference).
- **Publish-time warning.** The action registry knows which events each action emits, so the editor warns when a graph emits its own trigger event.
- The engine's own `workflow-run.*` events [R4] do not trigger workflows by default (inference).

## 5. Versioning

- **Immutable versions.** A workflow has at most one draft, edited in place; publishing freezes it into a `workflow_versions` row (the public `workflow-versions` path [R4]) with a `schema_version` and the SHA-256 of its canonical JSON, and rebuilds `workflow_triggers` in the same transaction. Inquiry templates already work this way (`itmpl_` / `itmplv_`, PLAN §2 [R1]); Phase 6 pins a report-config per inquiry template version for the same reason ("an inquiry keeps the list it started with" [R8]).
- **Runs are pinned.** A run records its version at creation and every step reads that version's graph. Publishing changes new runs only. "Editing a running workflow" means editing the draft; it never touches in-flight runs. An explicit, audited operator action can cancel the in-flight runs of older versions.
- **No migration of in-flight runs in Phase 8.** Code-first engines need patching or versioning precisely because replay ties a run to its code [E3b][E5]; a pinned data graph avoids the problem. A future "move waiting runs to version N" could map node keys whose variable types are compatible and refuse the rest (inference); nothing in the plan needs it now.
- **Our own definition format will evolve.** Stored versions are an audit record and are never rewritten: the engine reads every `schema_version` through pure upgrade functions (v1 → v2 → …), each with golden fixtures, and a CI test loads every fixture of every schema version (inference).
- **Action versions.** Each action type has a version in the registry (`<action>@1`); a definition pins it; a change to an action's input or output schema is a new action version, and old ones stay while any published version or unfinished run references them (inference).
- **Module references** pin a version id or resolve "published at child start", recorded on the child run (3.5).
- **Diff and review** use the canonical JSON; the editor side is [S3]'s subject.

## 6. Expressions and templating

### 6.1 Where expressions run, and the threat model

Expressions appear in conditional steps (branch conditions), `while` loops, trigger filters, wait-for-event correlation matchers and step guards; templates appear in message bodies, HTTPS request URLs, headers and bodies, and case titles (inference from PLAN §2's step and action list [R1]; the public syntax is [S1]'s subject). Both are **authored by operators** (a user with the workflow write scope, inside the customer's organisation), stored in definitions, and evaluated **in the worker** against run variables that hold PII. The design must therefore assume a semi-trusted author and defend four things (inference):
1. **The process** against denial of service: deep nesting (stack overflow), huge literals, quadratic string work, regular expressions (ReDoS), unbounded iteration.
2. **The data boundary**: a rule reads only the run's own variables; never another environment's data, process globals, or the prototype chain of a value.
3. **Code execution**: no operator text ever becomes JavaScript (`eval`, `Function`, code generation), and no value can be invoked as a function.
4. **Side channels**: an expression must not write to stdout or logs (the json-logic-js `log` operator does, below), and errors must not echo variable values (section 8.2).

### 6.2 JSONLogic and json-logic-js

| Fact | Detail | Source |
|---|---|---|
| Package | `json-logic-js` **2.0.5**, published 2024-07-09 (the same day as 2.0.4); no release since; **MIT** at commit `c5c7360`; no dependencies | [N1] |
| Security record | GHSA-m9hw-7xfv-wqg7 (2020-11-12, high): before 2.0.0 the `method` operator let a rule reach `__proto__.constructor` and run code (the advisory gives a working rule); CVE-2021-4329 / GHSA-67j4-2mh6-8627 (published 2023-03-05, critical): command injection in 2.0.0, fixed in 2.0.1 | [A1] |
| Operators in 2.0.5 | `==`, `===`, `!=`, `!==`, `>`, `>=`, `<`, `<=`, `!!`, `!`, `%`, `log`, `in`, `cat`, `substr`, `+`, `*`, `-`, `/`, `min`, `max`, `merge`, `var`, `missing`, `missing_some`, plus the special forms `if`/`?:`, `and`, `or`, `filter`, `map`, `reduce`, `all`, `none`, `some`; no `method` (read from `logic.js` at the release commit) | [N1] |
| Prototype properties | `var` splits its path on `.` and descends with `data[part]` with **no own-property check**, so `{"var":"a.constructor"}` returns the `Object` function and `{"var":"a.__proto__"}` the prototype. Since `method` is gone a returned function cannot be called by a rule, but functions and prototypes can still flow into outputs, comparisons and templates (read from the code; consequence inference) | [N1] |
| Loose semantics | `==` is JavaScript `a == b` (type coercion: `"" == 0` is true); truthiness treats an empty array as false, unlike JavaScript; both are deliberate in the format but surprising in decision logic | [N1] |
| Limits | None: `apply` recurses without a depth limit (a deep rule overflows the stack), and there is no size, step or time budget | [N1] |
| Side effects | `log` calls `console.log(a)`, which bypasses pino's redaction paths entirely | [N1] |
| Extensibility | `add_operation` writes into one module-global table shared by every caller in the process | [N1] |

**The maintained fork.** `json-logic-engine` **5.0.7** (2026-04-01; MIT in registry metadata; the LICENSE file was not found at tag `v5.0.7`, a gap) presents itself as a drop-in alternative with an interpreter and an optional compiler that turns rules into JavaScript functions for speed, and claims stronger protection for untrusted rules without saying what it consists of [N2]. A compiler from operator data to JavaScript is exactly what section 6.1 rules out (inference); its interpreter mode would need the same review as json-logic-js.

**Recommendation: our own JSONLogic dialect, interpreted by our code (inference, built on the facts above).** JSONLogic stays the stored format (PLAN §3 names it [R1], and a JSON tree maps directly onto a visual condition builder), but `packages/workflow-engine` implements the evaluator itself, about the size of `logic.js` (475 lines):
- **Operators**: `var` (own-property paths over plain JSON values only, with `[index]` for arrays; a path that leaves the typed variable model is a publish error), `missing`, `missing_some`, `if`, `and`, `or`, `!`, `!!`, `===`, `!==`, `<`, `<=`, `>`, `>=` (with the three-argument "between" form), `+`, `-`, `*`, `/`, `%`, `min`, `max` (finite numbers only), `in`, `cat`, `substr`, `merge`, `all`, `some`, `none`, `map`, `filter`, `reduce`; plus a few typed operators of ours for dates (`before`, `after`, `days_between`, on ISO timestamps). `==` and `!=` are accepted only as aliases of the strict forms, so a condition never coerces types. No `log`, no `method`, no regular-expression operator.
- **Limits** (ours): rule ≤ 16 KiB serialised, depth ≤ 32, ≤ 1,000 nodes, ≤ 10,000 operator evaluations per call (iteration operators count each element), arrays ≤ 1,000 elements, strings ≤ 10,000 characters; exceeding one is a step error `expression_limit_exceeded`, never a truthy or falsy answer.
- **Publish-time checks**: a recursive zod schema with the depth cap, then a type check of every `var` against the variable model in scope at that node (6.5).
- **Tests**: golden vectors of our own, and a dev-only differential test against json-logic-js 2.0.5 (MIT; dev tooling only) for the operators whose semantics we keep.

### 6.3 Alternative expression engines

| Package | Latest / newest passing (≤ 2026-10-13) | Licence at the release commit | How it evaluates | Security record (GitHub advisory database) | Verdict |
|---|---|---|---|---|---|
| `json-rules-engine` | **7.3.1** (2025-02-20) / same | ISC ✅ [N3] | Interpreted JSON conditions with `all`/`any`, async "facts" and an almanac; README says no `eval`. Depends on `jsonpath-plus` ^10.3.0 | none for the package [A2]; its dependency `jsonpath-plus` had two remote code execution advisories (CVE-2024-21534, critical, fixed 10.2.0; CVE-2025-1302, high, fixed 10.3.0) [A3] | ⚠️ passes; an event-emitting rules engine is more than a condition needs, and JSONPath in rules is an attack surface the dependency's record shows |
| `jexl` | **2.3.0** (2020-09-15) / same | MIT ✅ [N4] | Own grammar and interpreter with transforms and member access | none [A2]; no release in six years | ⚠️ passes; unmaintained; prototype access **not documented** |
| `filtrex` | **3.1.0** (2024-10-14) / same | MIT ✅ [N5] | Its README says it compiles each expression into a JavaScript function at runtime; its `get` helper hides prototype properties | none [A2] | ⚠️ passes; code generation from operator text (inference: needs the `Function` constructor) |
| `@marcbachmann/cel-js` | **8.0.0** (2026-07-07) / same | MIT ✅ [N6] | Interpreter of Google's Common Expression Language, non-Turing-complete, no dependencies, parse-time limits (`maxAstNodes`, `maxDepth`, `maxListElements`, `maxMapEntries`, `maxCallArguments`) | none [A2] | ✅ the best text-language candidate if a text syntax is ever wanted (the spec is designed for policy evaluation) |
| `cel-js` (ChromeGG) | **0.8.2** (2025-07-11) / same | MIT (registry) | Interpreter on `chevrotain` and `ramda` | none [A2] | ⚠️ superseded (the package above documents a migration from it) |
| `expr-eval` | **2.0.2** (2019-09-28) / same | MIT ✅ [N7] | Math expression parser that can call functions passed in the evaluation scope | **three unpatched advisories**: GHSA-jc85-fpwf-qm7x (CVE-2025-12735, high, 2025-11-05: does not restrict the functions an expression can call), GHSA-8gw3-rxh4-v6jx (CVE-2025-13204, high, 2025-11-14: prototype pollution), GHSA-q9v2-7m5w-4693 (CVE-2026-12866, critical, 2026-06-23: code execution); every version ≤ 2.0.2 affected, fixes only in a fork [A4] | ❌ (licence passes; security fails) |

### 6.4 String templating

| Package | Latest / newest passing | Licence | Model | Security record [A5] | Verdict |
|---|---|---|---|---|---|
| `mustache` | **4.2.0** (2021-03-28) / same | MIT ✅ [N8] | Logic-less, interpreted, no dependencies; HTML-escapes `{{x}}` by default, `{{{x}}}` unescaped; the escape function is replaced globally | two old advisories (XSS, fixed 2.2.1 in 2015–2018) | ✅ usable, but its HTML escaping is the wrong encoding for JSON bodies, URLs and SMS, and a global escape override is shared by every sink in the process (inference) |
| `handlebars` | **4.7.10** (2026-10-05) / same | MIT ✅ [N9] | Compiles templates to JavaScript; prototype access is controlled by runtime options since 4.6–4.7 (`allowProtoPropertiesByDefault` false by default, `__proto__` always forbidden) [T2] | 24 advisories; in 2026 alone: CVE-2026-33937 (critical, JavaScript injection via AST type confusion, fixed 4.7.9, March), four more high ones in March, and on 2026-10-08 CVE-2026-106445 and CVE-2026-106446 (critical; the second a bypass of the March fix) and CVE-2026-106444, all fixed in 4.7.10 | ❌ for operator-authored templates: code generation with a recurring injection record |
| `liquidjs` | **10.30.0** (2026-10-01) / same | MIT ✅ [N10] | Interpreted (no code generation); `ownPropertyOnly` defaults to true; `strictVariables`, `outputEscape` (`escape`, `json` or a function), memory and render limits [T1] | 19 advisories, 18 of them in 2026: remote code execution before 10.26.0 (CVE-2026-45618, critical), file-read and root bypasses, and a series of `memoryLimit`, `renderLimit` and `ownPropertyOnly` bypasses, the latest published 2026-10-07 (fixed 10.27.2); three list no patched version | ⚠️ passes; its limits have been bypassed repeatedly this year, so it cannot be the only defence |

**Recommendation: value-level templates of our own (inference).**
- A template is a **JSON value**, not text: an HTTPS body is an object whose string leaves may contain `{{ path }}` references; a leaf that is exactly one reference takes the referenced value with its JSON type; other leaves interpolate strings. The engine builds the body as a value and serialises it once, so a variable can never break out of a JSON string (no JSON injection by construction).
- **Paths only, no logic**: the reference grammar is the `var` path grammar of 6.2, resolved own-property-only against the typed variable model; conditions belong in conditional steps.
- **Encoding per sink**: URL templates percent-encode each interpolation as a path segment or query value; header values refuse CR, LF and NUL; email HTML escapes; SMS and plain-text email insert text; a Slack payload is a JSON value like an HTTPS body. The sink, not the author, picks the encoder.
- **Caps**: template ≤ 32 KiB; rendered body ≤ 1 MiB; a missing value is a step error `template_variable_missing`, never an empty string; unknown references are publish errors.
- This is about 150 lines with golden tests, and it removes a dependency whose record is the main risk. If a richer message language is ever needed, liquidjs 10.30.0 with `ownPropertyOnly`, `strictVariables`, `strictFilters`, its limits and a worker-side time budget is the fallback, run where a crash or a hang costs one step attempt (inference).

### 6.5 A typed variable model validated with zod

The project's rule is that zod schemas are the source of truth for contracts [R2]; `zod` 4.6.7 is a direct API dependency [R13]. The variable model follows it (proposed, ours):
- **Scope per node.** A version's variables are: `trigger` (the trigger's typed object, for an event trigger the resource schema of the event's payload from `packages/contracts`), `steps.<step key>.output` (each action's output schema from the action registry, in scope only at nodes the step dominates in the graph; a parallel branch's outputs only after its join; the loop item only inside the loop body), and `vars.<name>` (workflow variables declared with a small type DSL: `string`, `number`, `integer`, `boolean`, `datetime`, `id<prefix>`, `enum`, `list<T>`, `object{…}`, each with an optional `pii: true` mark like contracts' `.meta({ pii: true })`).
- **Publish** walks every expression and template, resolves each path against the scope of its node, and refuses the version with problem details pointing at the node and the JSON pointer of the bad path (RFC 9457, rule 2 [R2]).
- **Run time**: each action's output is parsed with its zod schema before it is journaled (unknown keys stripped, sizes checked), so a step cannot smuggle untyped data into later expressions; values live in sealed JSON (section 2.5).
- **Editor**: `z.toJSONSchema()` of the scope feeds the editor's variable picker ([S3]); the DSL is ours rather than arbitrary JSON Schema because `z.fromJSONSchema()` is experimental (recorded by the Phase 7 engineering note [R22]).
- **PII marks propagate**: a template or HTTPS body that references a `pii: true` path is flagged in the editor and in the version's metadata, so an auditor can list which workflows send personal data to which destinations (inference).

## 7. Open-source engines as references or dependencies

Licences are read from each repository's LICENSE file at the latest release tag through the GitHub licence endpoint [E1]; versions and dates from the GitHub releases endpoint [E2] (and npm metadata where noted). "Inside OpenVerify" means: runs with the stack ADR 0001 fixes (Postgres 17 in the pinned image, Valkey, RustFS, Mailpit) and no further service [R18].

| Engine | Latest release (date) | Licence (LICENSE at that tag) | What it is and needs | Inside OpenVerify? | Verdict |
|---|---|---|---|---|---|
| **Temporal** | server v1.32.1 (2026-10-08); TypeScript SDK v1.25.0 (2026-10-27) | MIT ✅ (both) | A separate Go service cluster with its own persistence; replays deterministic workflow code; history limit 51,200 events or 50 MB (warnings at 10,240 or 10 MB); at most 2,000 pending activities, child workflows, signals or cancellations each per execution by default [E3]. Its persistence page lists PostgreSQL 13.18, 14.15, 15.10 and 16.6 as tested, not 17 [E4] | No: another stateful service, and the pinned Postgres 17 is outside its tested list | Reference for semantics (timers as minimums, determinism rules, patching); do not adopt |
| **DBOS Transact (TypeScript)** | v5.3 (2026-10-15; v5.2 on 2026-09-29 is the newest release before the cutoff, npm version not read) | MIT ✅ | A library: checkpoints workflow inputs and each step's output in Postgres tables of its own (`dbos.workflow_status`, `dbos.operation_outputs`, …); one write per step plus two per workflow; more than 40,000 workflows or steps per second on one Postgres in its own benchmark; queues with worker, global and **per-partition** concurrency and rate limits; recovery of a crashed executor's workflows needs executor ids or its Conductor control plane [E5][E6][E7] | Technically yes (Postgres only) | ⚠️ the strongest library candidate, but its tables sit outside Drizzle migrations, the `encrypted` column helper and the redaction cascade; recovery across executors is either manual (executor ids) or through its Conductor control plane, a separate service whose licence and hosting terms were not read; and its model replays **code**, so a JSON interpreter would become one big workflow function whose determinism we would own anyway (inference). Reference, not dependency |
| **pg-boss** | 12.38.0 (npm 2026-10-13T17:51Z, on the cutoff day; 12.37.1 on 2026-10-08 passes with margin) | MIT ✅ | A Postgres job queue on `SKIP LOCKED`; creates jobs **in an existing transaction**, with adapters for Drizzle among others; cron and RRULE schedules; dependencies between jobs; dead letters; LISTEN/NOTIFY wake-ups; Postgres 13+ [E8][N11] | Yes | ⚠️ a credible replacement for BullMQ if the owner ever moves queues into Postgres (ADR 0001 revisit); a second queue system next to BullMQ is not worth it now |
| **graphile-worker** | 0.18.0 (2026-09-08) | MIT ✅ | A Postgres job queue for Node with LISTEN/NOTIFY [E8][N12] | Yes | ⚠️ same as pg-boss |
| **Hatchet** | v0.114.2 (2026-10-26) | MIT ✅ | A Go engine service with Postgres (RabbitMQ optional in its "lite" image); its README says it was load-tested to 10,000 tasks per second and costs more than Redis-based queues [E9] | No: another service | Reference |
| **Trigger.dev** | v4.8.1 (2026-10-23) | Apache-2.0 ✅ | Webapp with Postgres, Redis and ClickHouse (25.8 or newer), a supervisor that runs each task in a container through a Docker socket proxy, a container registry and object storage; minimums 3+ vCPU and 6+ GB for the webapp machine and 4+ vCPU and 8+ GB for a worker machine [E10] | No | Not a fit |
| **Inngest** | v1.49.0 (2026-10-23) | ❌ Server Side Public License 1.0, with an irrevocable additional grant of Apache-2.0 effective three years after the software is made available; SDKs Apache-2.0 | Event API, runner, queue, executor, state store, dashboard [E11] | No (licence) | ❌ (its fairness-aware multi-tenant queue is worth reading as a design reference) |
| **Restate** | v1.8.1 (2026-10-21); TypeScript SDK v1.17.4 MIT | ❌ Business Source License 1.1 (change date four years after release, then Apache-2.0); SDK MIT | A server, run as a container image in its README, with its own log and state; SDKs for several languages [E12] | No (licence) | ❌ |
| **Conductor (OSS)** | v3.33.0 (2026-10-26) | Apache-2.0 ✅ | Java 21 server; persistence Redis with Elasticsearch by default, Postgres an option [E13] | No: a JVM service | Reference for JSON workflow definitions and task types |
| **Kestra** | v2.0.7 (2026-10-20) | Apache-2.0 ✅ | A server distributed as a Docker image; its quick start runs it as root with the Docker socket mounted [E13] | No | Not a fit |
| **n8n** | n8n@2.45.4 (2026-10-26) | ❌ Sustainable Use License 1.0 (internal business or non-commercial use only) plus an enterprise licence for `.ee` files | Visual automation platform | No (licence) | ❌ |
| **Windmill** | v1.850.0 (2026-10-27) | ❌ AGPLv3 for the server, a proprietary licence for enterprise code, Apache-2.0 only for clients and the OpenFlow spec | Script and flow platform | No (licence) | ❌ (the Apache-2.0 OpenFlow spec may be read as a reference) |
| **XState** | `xstate@5.33.3` (2026-10-17; v6 in alpha) | MIT ✅ | In-memory statecharts; persistence means saving `actor.getPersistedSnapshot()` and restoring with `createActor(machine, { snapshot })` [E14] | Yes, as a library | Not needed: no timers, queues or durability of its own; the run and step status machines are small enough for `packages/core`'s existing state-machine style |
| **BullMQ 6 PostgreSQL backend** | bullmq 6.5.0 (2026-10-26) / **6.3.14** (2026-10-13T08:09Z, on the cutoff day) passes; the repository pins 6.3.11 | MIT ✅ [N13] | Since 6.0.0 (2026-07-30) BullMQ can run the same Queue, Worker, FlowProducer and scheduler API on Postgres 13+ through an optional `pg` peer; tables in a `bullmq` schema with its own explicit, advisory-locked migrations; wake-ups by LISTEN/NOTIFY; typically 1.5 to 2 times lower processing throughput than Redis; indicative laptop figures of about 2,300 jobs/s processed at concurrency 1 and 11,000 at 8–32 (Redis 6,000 and 18,000); the Redis backend stays the default and the more proven option [B1] | Yes | ⚠️ watch, do not switch now: it is three months old, it would move queue tables outside Drizzle, and the guide does not say that a job can be added inside the application's own transaction (**not documented**), so the outbox stays necessary either way |

**Recommendation: build on the existing BullMQ and Postgres pieces; adopt no engine.** The reasons, in order of weight (inference from the rows above and section 1):
1. **Definitions are operator data, not code.** Code-first engines (Temporal, DBOS, Restate, Inngest, Trigger.dev, Hatchet) make the unit of durability a replayed function and their versioning a matter of patching code. OpenVerify's workflows are JSON graphs pinned per run (section 5); an interpreter that persists its position per step needs no replay and no determinism discipline beyond its own.
2. **PII and redaction.** Run state in OpenVerify must use the `encrypted`/sealed helpers with row-bound AAD, take part in `kek:rewrap`, and be redacted with the inquiry, account or case it is about. Every engine above keeps step inputs and outputs in its own store (Temporal's append-only histories, DBOS's `operation_outputs`), outside that machinery.
3. **Self-hosting.** Every service-based engine adds a stateful service or a JVM; Temporal is not tested on Postgres 17 [E4]; three of the candidates fail rule 4 outright.
4. **The pieces exist.** The event outbox, the fenced claim with lease expiry and crash-loop cap, `SKIP LOCKED` sweeps, job schedulers and the GCRA limiter (section 1) are what a step engine needs; Phase 8 adds tables, an interpreter and a scheduler around them.
5. **Keep the queue replaceable.** If the database is the only record and BullMQ only a wake-up, then BullMQ's own Postgres backend or pg-boss can later replace Valkey for the engine by configuration, which answers ADR 0001's "revisit if the Redis-protocol dependency becomes a burden" without a redesign.

## 8. Multi-tenancy, fairness, observability, retention and redaction

### 8.1 Fairness: one environment must not starve another

**The problem.** One BullMQ queue is first-in, first-out across every environment of the install. A scheduled workflow that fans out over thousands of accounts, a burst of completions in one tenant, or a sandbox load test fills the queue, and every other environment waits behind it (inference).

**What BullMQ offers.**
- Round-robin **groups** (one virtual queue per tenant) exist only in **BullMQ Pro**, a commercial, per-organisation licence [B4] ❌ under rule 4.
- The open-source rate limiter is global per queue; per-key group rate limits were removed in BullMQ 3.0 [B5]. A queue-wide global concurrency exists [B6]. Neither separates tenants.
- One queue per environment would need a worker per queue, which does not scale with the number of environments (inference).

**Recommendation: admission in Postgres, execution in BullMQ (ours).**
- A step becomes `ready` in the database; it is **enqueued** only while its environment holds a free slot: `workflow_environment_slots.in_flight < cap` (default cap 50 per environment, an install setting with a per-environment override), incremented in the claim transaction and decremented in the completion transaction, so the count is exact and serialised per environment.
- The dispatcher (the sweeper, plus an immediate enqueue after commit when a slot is free) serves environments in rotation by `last_served_at`, so a backlog in one environment never delays the first step of another by more than one rotation.
- **Separate caps** for sandbox and production environments, so a sandbox load test cannot slow production (ours).
- **Priority**: steps of interactive triggers (an inquiry waiting on a decision) go to a high-priority queue; schedules and batch fan-outs to a low one. BullMQ's `priority` option exists, but adding a prioritised job costs O(log n) and jobs **without** a priority run before every prioritised one [B15], so two queues are simpler to reason about (inference).
- **Per-action concurrency** inside an environment's cap for the expensive kinds (Evaluate Code CPU, outgoing HTTPS), for example 5 concurrent each (ours).
- **Run admission**: the GCRA limiter [R20] caps run creation per environment per minute; excess trigger deliveries wait (`pending` with a `not_before`), they are not dropped.
- DBOS's partitioned queues (`partitionConcurrency` with a partition key per tenant) are the closest published reference for this design [E7].

### 8.2 Observability

- **Run history** is the database: `workflow_runs`, `workflow_run_steps` and the append-only `workflow_run_journal` (codes, attempts, durations; never values), served through the public `workflow-runs` paths [R4] and the console. Step inputs and outputs are PII-masked like every other resource for principals without `pii:view` (C15 masking [R6]).
- **Logs** follow the worker's existing rule: ids, node keys, action types, outcomes, durations, error codes and classes; never variables, outputs, expression values, HTTP bodies or template output [R5][R24]. Errors from actions are mapped to codes before they reach a log or Valkey, because BullMQ stores failure messages and stacks in Valkey (Workflow 4B H001 [R5]). The custom JSONLogic dialect has no `log` operator (6.2).
- **Metrics** (ours): steps per second; queue lag (claim time minus `due_at`) per environment; in-flight per environment against its cap; timer lag after the sweep; waits by age; failures by action and code; trigger deliveries `refused` by reason. BullMQ's own metrics, Prometheus and OpenTelemetry integrations exist [B2] but see only the wake-up queue, not the database record.
- **Events and webhooks**: `workflow-run.created`, `.completed`, `.errored`, `.resumed` are public [R4] and go through the existing publisher; their payload marks PII attributes like every resource.
- **Audit**: publish, archive, manual trigger, cancel and retry are operator actions with audit entries; an automated decision records the workflow, its version and the run on the decision itself, so a reviewer can see that a person did not make it (the legal side, GDPR Art. 22, is [S2]'s; Phase 7 decision 18 makes the workflow the only path to an automated decline on a signal [R21]).

### 8.3 Retention and redaction of run data

- **What a run holds.** A sealed copy of the trigger document, sealed variables, and sealed step inputs and outputs, often personal data copied from inquiries, reports and accounts. It must therefore be redactable with its subjects and covered by `kek:rewrap`.
- **Subjects.** A run records the object ids it was triggered for and every object an action read or wrote (`workflow_run_subjects`, bounded per run; inference). Redacting an inquiry, account, case, report or transaction then finds its runs: their sealed columns are nulled, waits on the subject are cancelled with `subject_redacted`, and running steps are fenced out.
- **Retention** (ours, mirroring C16 and Phase 6's report retention [R16][R8]): `workflow-run-retention-days` (default 90, 1–3,650): a finished run older than that loses its sealed columns first and keeps its skeleton (statuses, codes, timings, journal) for audit; the skeleton is deleted after a second window (`workflow-run-history-retention-days`, default 365). Unfinished runs are never removed by retention; the 90-day run-duration cap (3.9) bounds them.
- **Valkey** holds ids only (ULIDs are not personal data) and removes step jobs on completion and failure (2.5).
- **Logs and journal** hold no values, so they need no redaction.

## 9. Sources and pins

Every source was read on **2026-10-27**. Robots files were read before any other request to each host: `www.postgresql.org` (allows `/docs/17/`), `docs.temporal.io` (allows all), `docs.hatchet.run`, `liquidjs.com` and `valkey.io` (no relevant disallow), `trigger.dev` and `stately.ai` (disallow paths not used); `api.github.com`, `raw.githubusercontent.com`, `docs.bullmq.io`, `docs.dbos.dev` and `handlebarsjs.com` answered 404 (no restrictions under RFC 9309); `registry.npmjs.org` serves a package document at `/robots.txt`, not a robots file. At least 1.2 s between requests to one host, a descriptive User-Agent without contact details, no personal data sent. Downloads total about 13.5 MB under `downloads/engine-{npm,bullmq,gh,readmes,docs,advisories,licenses,pgdocs,valkey,tmpl}/`; scripts are `scripts/engine_fetch.py`, `scripts/engine_npm.py`, `scripts/engine_html2text.py` and `scripts/engine-bench/`. Nothing downloaded was executed.

**Repository (R)**, read-only at the working tree of 2026-10-27 (`7fe687b7` plus Phase 6 work in progress; some Phase 6 files, such as `repositories/report-runs.ts` and `phase6RepeatableJobs`, were still stubs)
- [R1] `docs/PLAN.md` §2 (Workflows, Cases, Inquiries rows), §3 (`packages/workflow-engine` row; technology table: workflow code step, editor; SSRF guard), §5, §6 Phase 8
- [R2] `CLAUDE.md` rules 2–5
- [R3] `docs/adr/0002-check-tiers.md`
- [R4] `docs/research/persona-surface.md` (paths `workflow-runs`, `workflow-runs/{workflow-run-id}`, `workflow-versions`, `workflows/{workflow-id}/trigger`; events `workflow-run.completed`, `.created`, `.errored`, `.resumed`; case paths and events)
- [R5] `apps/api/src/jobs/{index.ts,queue.ts,errors.ts}` and `apps/api/src/worker.ts` (ids-only jobs, retry options, `PermanentJobError`, failures described by class and code, Workflow 4B H001)
- [R6] `apps/api/src/events/index.ts` (`stage` / `dispatch`, the outbox) and `apps/api/src/services/events.ts` (masking of served events)
- [R7] `apps/api/src/webhooks/{dispatcher.ts,queue.ts}` and `packages/db/src/tables/webhooks.ts` (`events`, `webhooks`, `webhook_deliveries`; the C14 schedule; the sweep; `replace: true`; simulation writing `simulated: true` through `createEvent` in `apps/api/src/services/webhooks.ts`)
- [R8] `docs/plans/phase-6.plan.md` C73.2 (`report_actions` append-only trigger), C73.4–C73.7, C74.1 (fenced claims, crash-loop cap, waits), C74.3 (sweep and catch-up), C84.1, C84.3 (`on-report-match`), the deferral list, decisions 28 and 48
- [R9] `packages/db/src/repositories/webhooks.ts` (`listDueWebhookDeliveries`, `recordWebhookDeliveryAttempt` with the numbered condition)
- [R10] `packages/db/src/tables/reports.ts` (`report_runs` with `claimed_by`, `claimed_until`, `attempt`, `not_before`, `enqueued_at`) and `packages/db/src/repositories/report-runs.ts` (stub)
- [R11] `apps/api/src/worker.ts` (repeatable jobs through `upsertJobScheduler`, one queue each, concurrency 1) and `apps/api/src/jobs/repeatable/index.ts`
- [R12] `packages/db/src/repositories/sweeps.ts` (`DEFAULT_SWEEP_LIMIT` 500, `FOR UPDATE SKIP LOCKED`) and `apps/api/src/jobs/inquiry-expiry.ts`
- [R13] `apps/api/package.json` (`bullmq` 6.3.11, `ioredis` 5.11.1, `pg` 8.23.1, `zod` 4.6.7, `undici` 7.30.1, `pino` 10.4.0)
- [R14] `pnpm-workspace.yaml` (catalog, `allowBuilds`) and `pnpm-lock.yaml` (`bullmq@6.3.11` with `cron-parser@5.10.1`, `luxon@3.7.2`, `msgpackr@2.1.0`; optional peer `pg`)
- [R15] `packages/contracts/src/ids.ts` (`<prefix>_<ULID>`, 80 random bits, generated in the application)
- [R16] `apps/api/src/services/retention.ts` (the C16 steps)
- [R17] `packages/db/src/repositories/retention.ts` (`DEFAULT_RETENTION`: events 90 days, deliveries 30, API logs 30) and `packages/contracts/src/dashboard-api.ts` (the settings schema)
- [R18] `infra/docker-compose.yml` (Valkey `--appendonly yes`, password, named volume) and `docs/adr/0001-stack.md`
- [R19] `apps/api/src/webhooks/{ssrf.ts,http-sender.ts}` (address classes, vetted lookup, no redirects, 10 s, `retryable`)
- [R20] `apps/api/src/ports.ts` (`RateLimiter`: one Lua script per `consume`, callers fail open) and `apps/api/src/rate-limit/`
- [R21] `docs/plans/phase-7.plan.md` C110 and decisions 18 and 41
- [R22] `docs/research/phase7-lists-graph-transactions.md` §3.2 (35 µs per sealed and keyed value) and its [V2] (zod `fromJSONSchema` experimental)
- [R23] `apps/api/src/plugins/idempotency.ts` (C12: `POST`/`PATCH`, 24-hour answers, principal and fingerprint)
- [R24] `apps/api/src/jobs/logger.ts` (worker redaction paths four levels deep)

**Sibling notes (S)** in `resume/phase8-research/`, read for scope only (they were being written at the same time): [S1] `phase8-behaviour.md` (public behaviour); [S2] `phase8-actions-sandbox.md` (actions, Evaluate Code, HTTPS request, secrets, Art. 22); [S3] `phase8-editor-cases.md` (editor, cases).

**BullMQ (B)**: documentation at commit `415badce154cfa997aaf3e7bae93d7df42e89b55` (the `gitHead` of bullmq 6.3.14), `https://raw.githubusercontent.com/taskforcesh/bullmq/415badce…/docs/gitbook/<page>` (the same pages are published at `https://docs.bullmq.io/<page without .md>`)
- [B1] `guide/postgresql.md` (PostgreSQL backend: requirements, schema, migrations, LISTEN/NOTIFY, performance and the indicative table, parity)
- [B2] `guide/going-to-production.md` (AOF, `maxmemory-policy noeviction`, reconnection, stalled jobs after about 30 s, metrics and OpenTelemetry, clear-text job data)
- [B4] `bullmq-pro/groups/README.md` and `bullmq-pro/introduction.md` (groups are a BullMQ Pro feature; commercial per-organisation licence)
- [B5] `guide/rate-limiting.md` (global limiter; group keys removed in 3.0)
- [B6] `guide/queues/global-concurrency.md`, `guide/queues/global-rate-limit.md`
- [B7] `patterns/idempotent-jobs.md`
- [B8] `guide/workers/stalled-jobs.md`
- [B9] `guide/jobs/delayed.md`
- [B10] `guide/job-schedulers/README.md` and `repeat-options.md`
- [B11] `guide/job-schedulers/repeat-strategies.md` (cron through `cron-parser`) and `guide/migrations/migrate-from-v5-to-v6.md`
- [B12] `guide/workers/cancelling-jobs.md`
- [B13] `guide/flows/README.md`, `guide/flows/fail-parent.md`
- [B14] `guide/retrying-failing-jobs.md`
- [B15] `guide/jobs/prioritized.md`
- Also read: `guide/jobs/deduplication.md`, `guide/jobs/job-ids.md`, `patterns/process-step-jobs.md`, `guide/architecture.md`, `changelog.md`.

**Engines (E)**
- [E1] `https://api.github.com/repos/<owner>/<repo>/license?ref=<tag>` for each engine at the tag in section 7 (SPDX as GitHub detects it, and the text read): temporalio/temporal `v1.32.1` (MIT, SHA-256 `6aab9afd99ce…`), temporalio/sdk-typescript `v1.25.0` (MIT), dbos-inc/dbos-transact-ts `v5.3` (MIT), timgit/pg-boss `12.38.0` (MIT), graphile/worker `v0.18.0` (MIT, `LICENSE.md`), hatchet-dev/hatchet `v0.114.2` (MIT), triggerdotdev/trigger.dev `v4.8.1` (Apache-2.0), inngest/inngest `v1.49.0` (SSPL-1.0 with the Apache-2.0 future grant, `LICENSE.md`), restatedev/restate `v1.8.1` (BSL 1.1), restatedev/sdk-typescript `v1.17.4` (MIT), conductor-oss/conductor `v3.33.0` (Apache-2.0), kestra-io/kestra `v2.0.7` (Apache-2.0), n8n-io/n8n `n8n@2.45.4` (Sustainable Use License, `LICENSE.md`), windmill-labs/windmill `v1.850.0` (AGPLv3 / proprietary / Apache-2.0 parts), statelyai/xstate at `@xstate/vue@5.0.2` (MIT)
- [E2] `https://api.github.com/repos/<owner>/<repo>/releases/latest` (and `/releases?per_page=…` for DBOS and XState): tags and `published_at` as given in section 7
- [E3] https://docs.temporal.io/workflow-execution/limits (51,200 events or 50 MB; warnings at 10,240 or 10 MB; 2,000 pending operations of each kind)
- [E3b] https://docs.temporal.io/workflow-definition (deterministic constraints; commands compared with history on replay; versioning and patching)
- [E3c] https://docs.temporal.io/workflow-execution/timers-delays (timers persisted; durations as minimums; no sub-second reliance)
- [E4] https://docs.temporal.io/temporal-service/persistence (tested PostgreSQL 13.18, 14.15, 15.10, 16.6; advanced visibility on PostgreSQL 12+ since 1.20)
- [E5] https://docs.dbos.dev/architecture (one write per step and two per workflow; more than 40,000 per second in its own benchmark; determinism and idempotency requirements; patching and versioning; output-size advice)
- [E6] https://docs.dbos.dev/production/workflow-recovery (executor ids; Conductor)
- [E7] https://docs.dbos.dev/typescript/tutorials/queue-tutorial (worker and global concurrency, rate limits, durable timeouts, partitioned queues); also read `explanations/system-tables` (`dbos.workflow_status`, `dbos.operation_outputs`, …)
- [E8] READMEs at the release tags: `https://raw.githubusercontent.com/timgit/pg-boss/12.38.0/README.md`, `https://raw.githubusercontent.com/graphile/worker/v0.18.0/README.md`
- [E9] `https://raw.githubusercontent.com/hatchet-dev/hatchet/v0.114.2/README.md` (10k tasks/s); https://docs.hatchet.run/self-hosting/hatchet-lite (Postgres default, RabbitMQ optional)
- [E10] https://trigger.dev/docs/self-hosting/docker (v4 components, machine minimums, ClickHouse 25.8+)
- [E11] `https://raw.githubusercontent.com/inngest/inngest/v1.49.0/README.md` (architecture; SSPL and DOSP; SDKs Apache-2.0) and the LICENSE of [E1]
- [E12] `https://raw.githubusercontent.com/restatedev/restate/v1.8.1/README.md` and the LICENSE of [E1] (Additional Use Grant, change date, change licence)
- [E13] `https://raw.githubusercontent.com/conductor-oss/conductor/v3.33.0/README.md` (Java 21; persistence backends) and `https://raw.githubusercontent.com/kestra-io/kestra/v2.0.7/README.md`
- [E14] https://stately.ai/docs/persistence (`getPersistedSnapshot`, restore with `createActor(…, { snapshot })`)

**Packages (N)**: registry metadata `https://registry.npmjs.org/<name>` (versions and `time`), and the LICENSE at the release commit `https://raw.githubusercontent.com/<repo>/<commit>/<file>`
- [N1] `json-logic-js` **2.0.5** (2024-07-09), MIT, `jwadhams/json-logic-js` `c5c73601c90b11e98f6846609bac4dec203d1c18` (`LICENSE` SHA-256 `453a163c949b…`; `logic.js` and `README.md` read at the same commit)
- [N2] `json-logic-engine` **5.0.7** (2026-04-01), MIT in registry metadata, no `gitHead`; `LICENSE` not found at tag `v5.0.7` (404)
- [N3] `json-rules-engine` **7.3.1** (2025-02-20), ISC, `CacheControl/json-rules-engine` `0a01da6b6bf5a67a71be412054e33a195b5a6a96` (`bd246c093e9b…`)
- [N4] `jexl` **2.3.0** (2020-09-15), MIT, `TomFrost/Jexl` `29d1ac0e1fef05ff1b6ad8d9449472ccb8cfb091` (`LICENSE.txt`, `c55ba6e37b42…`)
- [N5] `filtrex` **3.1.0** (2024-10-14), MIT, `cshaa/filtrex` tag `v3.1.0` (no `gitHead`; `6c699177a828…`)
- [N6] `@marcbachmann/cel-js` **8.0.0** (2026-07-07), MIT, `marcbachmann/cel-js` `86cd97216a1cbb522eda81aaa0221c245d5913d7` (`4b70ef5f8281…`); `cel-js` **0.8.2** (2025-07-11), MIT (registry)
- [N7] `expr-eval` **2.0.2** (2019-09-28), MIT, `silentmatt/expr-eval` `b4cf0607cc640ed69c34bd40a2aa6cdf283c1189` (`LICENSE.txt`, `f92e5a2b2784…`)
- [N8] `mustache` **4.2.0** (2021-03-28), MIT, `janl/mustache.js` `813e273a658677852ab37e6f47c98a9d9352ccde` (`e60b28083818…`)
- [N9] `handlebars` **4.7.10** (2026-10-05), MIT, `handlebars-lang/handlebars.js` `45ce15255e0f430ac6d19742b18e316b7539264e` (`e1955f622a23…`)
- [N10] `liquidjs` **10.30.0** (2026-10-01), MIT, `harttle/liquidjs` `920166e3f5bf14412fad2dc4c6be687ecb5f7f60` (`c87896dfbf5f…`)
- [N11] `pg-boss` **12.38.0** (2026-10-13T17:51Z) and 12.37.1 (2026-10-08), MIT, `gitHead` `2c1005b744952360e999c2000e155a1bfebb8951`; depends on `pg`, `cron-parser` ^5.10.2, `rrule-temporal`, `serialize-error`
- [N12] `graphile-worker` **0.18.0** (2026-09-08), MIT, `gitHead` `4cda192c5df254392a1dff350e5d73f7d2c18a85`
- [N13] `bullmq` 6.5.0 (2026-10-26) / **6.3.14** (2026-10-13T08:09Z), MIT, `taskforcesh/bullmq` `415badce154cfa997aaf3e7bae93d7df42e89b55` (`LICENSE` `ad9e1382b9c0…`); 6.0.0 published 2026-07-30; 6.3.14 depends on `cron-parser` 5.10.2 and `msgpackr` 2.1.0, optional peers `pg`, `redis`, `ioredis`, `bullmq-otel`
- [N14] `cron-parser` **5.10.2** (2026-10-09), MIT, `harrisiirak/cron-parser` `5033a312f1fe04665060eacf4378f16c48ca4ea8` (`7eba1c8774e8…`); README in the registry document
- [N15] `luxon` **3.7.2** (2025-09-05), MIT, `moment/luxon` `4262a38ded7762e22608a9feb9f117b40d338ced` (`LICENSE.md`, `6cb2f2bf697e…`)
- [N16] `croner` 11.0.0 (2026-10-26) / **10.0.1** (2026-02-01), MIT, `Hexagon/croner` `adc86215e92e4f7cceaf8127dfcd1b514ef7bafc` (`LICENSE` `d1c89d2de9ab…`; the 10.0.1 README read at that commit, the 11.0.0 README from the registry document)

**Security advisories (A)**: GitHub advisory database, `https://api.github.com/advisories?ecosystem=npm&affects=<package>&per_page=100`
- [A1] `json-logic-js`: GHSA-m9hw-7xfv-wqg7 (2020-11-12), GHSA-67j4-2mh6-8627 / CVE-2021-4329 (2023-03-05)
- [A2] no advisories for `json-logic-engine`, `json-rules-engine`, `jexl`, `filtrex`, `cel-js`, `@marcbachmann/cel-js`, `cron-parser`, `croner`, `bullmq`, `pg-boss`, `graphile-worker`, `@dbos-inc/dbos-sdk`
- [A3] `jsonpath-plus`: GHSA-pppg-cpfq-h7wr / CVE-2024-21534 (2024-10-11, fixed 10.2.0), GHSA-hw8r-x6gr-5gjp / CVE-2025-1302 (2025-02-15, fixed 10.3.0)
- [A4] `expr-eval`: GHSA-jc85-fpwf-qm7x / CVE-2025-12735, GHSA-8gw3-rxh4-v6jx / CVE-2025-13204, GHSA-q9v2-7m5w-4693 / CVE-2026-12866
- [A5] `mustache` (2), `handlebars` (24, the 2026 ones named in 6.4), `liquidjs` (19, the 2026 ones summarised in 6.4)

**Templating docs (T)**
- [T1] https://liquidjs.com/tutorials/options.html (`ownPropertyOnly` default true, `strictVariables`, `strictFilters`, `outputEscape`)
- [T2] https://handlebarsjs.com/api-reference/runtime-options.html (`allowProtoPropertiesByDefault`, `allowedProtoMethods`, `__proto__` forbidden)

**PostgreSQL 17 documentation (P)**
- [P1] https://www.postgresql.org/docs/17/sql-select.html (the locking clause; `SKIP LOCKED` gives an inconsistent view, suited to queue-like tables)
- [P2] https://www.postgresql.org/docs/17/transaction-iso.html (Read Committed: a second updater re-evaluates its `WHERE` on the updated row)
- [P3] https://www.postgresql.org/docs/17/explicit-locking.html (§13.3.5 advisory locks)
- [P4] https://www.postgresql.org/docs/17/functions-info.html (`pg_current_xact_id`, `pg_current_snapshot`, `pg_snapshot_xmin`)
- [P5] https://www.postgresql.org/docs/17/datatype-datetime.html (§8.5.3 time zones: IANA data; latest rules assumed for future times)
- Also read: https://www.postgresql.org/docs/17/sql-notify.html (payload under 8,000 bytes; 8 GB queue; delivery at commit; identical payloads folded within a transaction) and `ddl-partitioning.html`

**Valkey (V)**
- [V1] https://valkey.io/topics/persistence/ (AOF policies; `everysec` default, up to one second of writes lost)
- [V2] https://valkey.io/topics/lru-cache/ (`maxmemory` 0 means no limit on 64-bit; eviction policies including `noeviction`)

**Measurements (M)**, synthetic data only
- [M1] The pinned image `pgvector/pgvector@sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d` (created 2026-10-01; `PG_VERSION=17.11-1.pgdg12+2`; `synchronous_commit` on, `fsync` on, `shared_buffers` 128 MB), run as a throwaway container (`--rm`, `--network none`) on a 12-thread, 31 GB WSL2 machine; pgbench 17.11; scripts `scripts/engine-bench/01-setup.sql` (100,000 runs, 100,000 ready steps, 1,000,000 waiting timers), `02-step.pgbench`, `03-timer-sweep.sql`, `04-inline-step.pgbench`.

## 10. What Phase 8 should take from this (proposed)

1. **Build, do not adopt.** `packages/workflow-engine` is an interpreter of JSON graphs over Postgres tables, with BullMQ on Valkey as a wake-up only. No Temporal, DBOS, Hatchet, Trigger.dev, Inngest, Restate, Conductor, Kestra, n8n or Windmill; Inngest, Restate, n8n and Windmill fail rule 4 outright (section 7).
2. **The database is the only record.** Runs, steps, waits, timers, schedules and trigger deliveries live in Postgres; jobs carry `{ environmentId, runId, stepId, attempt }`, are named `<step id>-<attempt>` and are removed on completion and failure (the left-over-id trap of section 1); every timer and lease has a sweeper behind it, so a lost Valkey delays work and never loses it.
3. **Persisted state machine, not replay.** `advance(definition, state, completed step)` is a pure, unit-tested function; the journal is append-only history with codes, never values.
4. **Fenced claims as in Phase 6 C74.1**, with a lease per action (time limit plus margin), heartbeats for long actions, release on retryable errors, a crash-loop cap, and two detectors (BullMQ stalled checks, the lease sweeper).
5. **Two transaction shapes**: control-flow nodes (condition, fork, join, loop, set variable) run inside the transaction that completed the previous step; effectful actions get claim and complete. Measured on the pinned image: 1,577 effectful steps/s and 2,880 control-flow steps/s at 32 clients with durable commits [M1]; keep `synchronous_commit` on.
6. **Idempotency per action kind** (2.2): a unique `(environment_id, workflow_run_step_id)` on rows that actions create; target state machines for transitions, recording `already_decided` rather than overwriting; `Idempotency-Key: <run step id>` on outgoing HTTPS; an intent row around messages, with the remaining duplicate window documented.
7. **Event triggers through the outbox**: `stage()` inserts `workflow_trigger_deliveries` (unique per event and workflow) in the event's transaction; the worker evaluates filters and creates runs; simulated events never trigger; C16 keeps events that pending trigger deliveries need. No cursor over ULID event ids.
8. **Wait-for-event**: correlation keys from run variables; resolution and timeout are conditional updates on the same row (Read Committed re-check decides the race); the registration and the event's lookup both take a transaction-scoped advisory lock on `(environment, correlation key)`, and the registration also checks already-committed events. Race tests in Testcontainers for both races.
9. **Timers** as `due_at` rows with a one-hour BullMQ horizon; durations are minimums; a startup check that Valkey's `maxmemory-policy` is `noeviction`.
10. **Parallel joins in Postgres** (counter row, `all` / `any` / `first`, losers cancelled and fenced); loops with item and iteration caps; modules as child runs with a depth limit of 5 and static plus dynamic recursion guards; cancellation as a database write first, then BullMQ's abort signal.
11. **Retries owned by the engine** with the retry and no-retry classes of 3.7; BullMQ attempts only for infrastructure errors; no automatic compensation, explicit error edges instead.
12. **Schedules in Postgres** with one catch-up run after an outage; `cron-parser` 5.10.2 (MIT, already in the tree through BullMQ) pinned in the catalog; our own DST rules with golden vectors in five zones; five-field cron at the API, parsed in strict mode with a `0` seconds field prefixed, one-minute minimum, no `H`.
13. **Loop guards between workflows**: an internal `caused_by_run_id` on events, a causality depth of 8, self-trigger off by default, a per-(workflow, subject) rate guard that defers, and a publish-time warning.
14. **Versioning**: immutable published versions with canonical-JSON hashes; runs pinned; drafts never touch runs; no in-flight migration in Phase 8; upgrade-on-read for our own `schema_version`; action versions in the registry; module references recorded on the child run.
15. **Expressions**: our own JSONLogic dialect (strict equality only, own-property paths, no `log`, `method` or regex; size, depth, node and evaluation budgets; publish-time type checking); json-logic-js 2.0.5 only as a dev-time differential oracle. `@marcbachmann/cel-js` 8.0.0 is the candidate if a text syntax is ever wanted; `expr-eval` is excluded.
16. **Templates**: value-level `{{ path }}` substitution of our own with per-sink encoding and caps; no Handlebars (code generation, 2026 critical injection record); liquidjs 10.30.0 only as a fallback, behind its limits and a time budget.
17. **Typed variables with zod**: scope per node (trigger, dominating step outputs, declared variables with `pii` marks); outputs parsed by each action's zod schema before they are journaled; `z.toJSONSchema()` for the editor.
18. **Limits of 3.9** enforced with codes and published in the docs and the API.
19. **Fairness by admission in Postgres**: per-environment in-flight slots (default 50), rotation by `last_served_at`, separate sandbox and production caps, a high- and a low-priority queue, per-action concurrency for code and HTTPS, GCRA on run creation with defer.
20. **Observability and privacy**: run history from the database; logs with ids and codes only; metrics of lag and slots; audit of operator actions and of automated decisions; run data sealed, in `kek:rewrap`, redacted with its subjects through `workflow_run_subjects`, retained by `workflow-run-retention-days` (values) and a longer history window (skeleton).
21. **Records to update**: PLAN §3's `packages/workflow-engine` row (the interpreter, our JSONLogic dialect, value templates; QuickJS stays for Evaluate Code, [S2]); ADR 0001's queue row (BullMQ 6's Postgres backend and pg-boss as the documented exit if Valkey becomes a burden); `THIRD_PARTY_LICENSES.md` rows for `cron-parser` and `luxon` as direct dependencies, and `json-logic-js` as a dev-only oracle (MIT, no weak-copyleft exception needed).
22. **Tests**: unit tests of `advance` with golden graphs; Testcontainers races (wait vs timeout, wait registration vs event, concurrent join completions, claim expiry with a live worker, cancel vs completion, trigger fan-out exactly once under retries, Valkey down at commit); DST golden vectors; expression and template limit vectors; a benchmark script for the step transactions reported, not gated.

## 11. Needs the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | Build the engine on Postgres + BullMQ, or adopt a library (DBOS) or a service (Temporal, Hatchet) | **Build** (section 7); DBOS kept as a design reference |
| 2 | Move queues off Valkey to BullMQ 6's Postgres backend or pg-boss now | **No**; design so the switch is configuration later (ADR 0001 revisit) |
| 3 | Bump `bullmq` from 6.3.11 to 6.3.14 (newest passing; brings `cron-parser` 5.10.2) | **Yes**, in the Phase 8 foundation slice, if Phase 6 has not already |
| 4 | Expression language: our own JSONLogic dialect, or `json-logic-js` as is | **Our dialect** (strict equality, own-property paths, budgets); json-logic-js as a dev-only oracle |
| 5 | Loose `==` in conditions | **Accepted only as an alias of `===`**; authors who rely on coercion get a publish error |
| 6 | Template engine | **Our value-level templates**; no Handlebars; liquidjs only if rich messages become a requirement |
| 7 | DST rules for schedules | **Gap: fire at the first valid minute after it; overlap: fire once, at the first occurrence; intervals in real time**, documented and golden-tested |
| 8 | Minimum schedule interval | **1 minute** |
| 9 | Per-environment in-flight cap and separate sandbox caps | **50 per environment**, sandbox and production capped separately, overridable per environment |
| 10 | Limits of 3.9 (200 nodes, 5,000 step executions, 90-day runs and waits, module depth 5, 50 workflows per event, causality depth 8) | **As listed**, published in the docs |
| 11 | Self-triggering workflows | **Off by default**, opt-in per workflow, still bounded by causality depth and the rate guard |
| 12 | Ordering of runs per subject | **No ordering by default**; a per-workflow "one run at a time per subject" option |
| 13 | Run data retention | **90 days for values**, **365 days for the skeleton** (statuses, codes, timings) |
| 14 | Automatic compensation (sagas) | **Not in Phase 8**; explicit error edges |
| 15 | Migrating in-flight runs to a new version | **Not in Phase 8**; an audited "cancel runs of older versions" action instead |
| 16 | `synchronous_commit = off` for the engine's tables | **No**: the measured durable throughput is ample [M1] |
| 17 | Valkey `maxmemory-policy` check at worker start | **Log an error unless `noeviction`**, never refuse to start (managed services may hide `CONFIG`) |

## Gaps (what this note could not establish)

- The npm version and date of DBOS Transact's newest release before the cutoff (only the GitHub tag `v5.2`, 2026-09-29, was read), and XState's newest passing 5.x version (the release list was dominated by v6 alphas).
- `json-logic-engine`'s LICENSE file (404 at tag `v5.0.7`); its licence rests on registry metadata.
- How `cron-parser` 5.10.2 treats DST gaps and overlaps: its README does not say, and running it to find out would execute a download. Phase 8's golden vectors decide.
- Whether BullMQ 6's Postgres backend can add a job inside the application's own transaction (not documented in the guide read).
- Throughput on server-class storage: [M1] ran on a WSL2 virtual disk where a commit costs 3.5–5 ms; the ratios, not the absolute numbers, carry over.
- Persona's public limits, statuses and semantics for workflows (step counts, loop limits, run statuses, wait and join behaviour) are [S1]'s subject and were not re-derived here; where this note sets a limit, it is ours.

## Fact-check (2026-10-27)

**Method.** An independent pass, run 2026-10-27 between 22:40 and 23:15 UTC, that fetched every source again rather than
reading the researchers' downloads. Each host's `robots.txt` first (RFC 9309), at most one request per 1.2 s per host, no
automatic redirects, User-Agent `OpenVerify-factcheck/1.0 (research; no contact)`, GitHub API unauthenticated, no personal
data sent. Downloads are in new directories `downloads/fc-npm/`, `fc-raw/`, `fc-docs-engine/`, `fc-gh-api/` and
`fc-gh-api2/`, stored as served; readers `scripts/fc_*.py` under `python3 -I`; nothing downloaded was executed (no
container, package or script was run). Repository facts were read at `3a3ef409`. Result: **22 confirmed, 0 corrected,
1 could not verify.**

| # | Fact | Result | Primary source re-read |
|---|---|---|---|
| 1 | bullmq 6.3.14 / 6.5.0 / pin 6.3.11; MIT at `415badce` | **Confirmed.** 6.3.14 published 2026-10-13T08:09:30Z with `gitHead` `415badce…`, the newest stable version on or before the cutoff; 6.5.0 (2026-10-26T20:55Z) is `latest`; 6.3.14 depends on `cron-parser` 5.10.2; `apps/api/package.json` pins 6.3.11 and the lockfile resolves `cron-parser` 5.10.1 and `luxon` 3.7.2 under it; `LICENSE` at `415badce` is MIT. At 23:13Z on 2026-10-27, 6.3.14 is also past pnpm's minute-level 14-day window | `https://registry.npmjs.org/bullmq`; raw `LICENSE` at `415badce`; `apps/api/package.json`, `pnpm-lock.yaml` |
| 2 | BullMQ 6 PostgreSQL backend | **Confirmed.** The guide at `415badce`: optional backend over the same API; PostgreSQL 13 or newer (14+ recommended); objects in a schema defaulting to `bullmq`; explicit migrations serialised by a transaction-scoped advisory lock; `LISTEN`/`NOTIFY` wake-ups; usually about 1.5 to 2 times fewer jobs per second than Redis; the indicative table as quoted. It says nothing about adding a job inside the application's own transaction. The guide does not name a version; the registry shows the optional `pg` peer first in 6.0.0 (2026-07-30) and absent from the later 5.x release 5.81.5, which supports "since 6.0.0" | `docs/gitbook/guide/postgresql.md` at `415badce`; registry `bullmq` (6.0.0, 5.81.5 manifests) |
| 3 | `noeviction`, AOF every second, stalled after about 30 s | **Confirmed** | `docs/gitbook/guide/going-to-production.md`, `guide/workers/stalled-jobs.md` at `415badce` |
| 4 | Groups are Pro (commercial, per organisation); group keys removed in 3.0 | **Confirmed** | `docs/gitbook/bullmq-pro/groups/README.md`, `bullmq-pro/introduction.md`, `guide/rate-limiting.md` at `415badce` |
| 5 | Job schedulers produce the next job when the last starts; v6 removed repeat APIs and `repeat.utc` | **Confirmed** | `docs/gitbook/guide/job-schedulers/README.md`, `guide/migrations/migrate-from-v5-to-v6.md` at `415badce` |
| 6 | An `add` under an existing id is ignored; removed jobs no longer dedupe | **Confirmed.** The guide says so; `apps/api/src/webhooks/queue.ts` documents the left-over-id trap, removes before re-adding with `replace`, and keeps completed jobs 1 h and failed jobs 7 days | `docs/gitbook/guide/jobs/job-ids.md` at `415badce`; `apps/api/src/webhooks/queue.ts` |
| 7 | Event ids are application-generated ULIDs with an 80-bit random tail | **Confirmed** (48-bit millisecond time plus 80 random bits from Web Crypto) | `packages/contracts/src/ids.ts` |
| 8 | Events go through `stage(tx)`; only simulation calls `createEvent` directly | **Confirmed.** `stage` writes the event and its deliveries in the caller's transaction; the only other production caller of `createEvent` is the webhook simulation with `simulated: true` (a test-support file also calls it) | `apps/api/src/events/index.ts`, `apps/api/src/services/webhooks.ts` |
| 9 | C16 event retention 90 days, pending deliveries kept | **Confirmed** | `packages/db/src/repositories/retention.ts` |
| 10 | Measured step and timer throughput [M1] | **Could not verify the numbers.** Re-measuring would mean running the container image, which this check did not do. What can be read without running was confirmed: the local image's digest is `pgvector/pgvector@sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d`, created 2026-10-01, `PG_VERSION` `17.11-1.pgdg12+2`, and the bench scripts set up 100,000 runs, 100,000 ready steps and 1,000,000 waiting timers. The figures rest on the researcher's single run | `docker image inspect` (metadata only); `scripts/engine-bench/` |
| 11 | Read Committed re-check, advisory locks, `SKIP LOCKED` | **Confirmed** | `https://www.postgresql.org/docs/17/transaction-iso.html`, `explicit-locking.html`, `sql-select.html` |
| 12 | json-logic-js 2.0.5 behaviour and advisories | **Confirmed.** 2.0.5 published 2024-07-09T15:01Z, `gitHead` `c5c7360…`, MIT `LICENSE` there; `logic.js` (475 lines) splits `var` paths on `.` and descends with `data[part]` with no own-property check, `log` calls `console.log`, `==` is JavaScript `==`, and there is no depth counter. GHSA-m9hw-7xfv-wqg7 (high, before 2.0.0) is titled prototype pollution and its text says the `method` operation leads to code execution; GHSA-67j4-2mh6-8627 / CVE-2021-4329 (critical) covers versions before 2.0.1, patched in 2.0.1 | registry `json-logic-js`; raw `logic.js`, `LICENSE` at `c5c7360`; `https://api.github.com/advisories?ecosystem=npm&affects=json-logic-js` |
| 13 | expr-eval: three unfixed advisories | **Confirmed** (CVE-2025-12735 high, CVE-2025-13204 high, CVE-2026-12866 critical; every range is ≤ 2.0.2 with no patched expr-eval version) | `https://api.github.com/advisories?ecosystem=npm&affects=expr-eval` |
| 14 | handlebars 4.7.10 and its 2026 CVEs | **Confirmed.** 4.7.10 published 2026-10-05T22:37Z, MIT at `45ce1525`; 24 advisories (2 withdrawn); CVE-2026-33937 critical, fixed 4.7.9; CVE-2026-106445 and CVE-2026-106446 critical, fixed 4.7.10, the second titled as a bypass of CVE-2026-33937; CVE-2026-106444 (also fixed 4.7.10) is medium | registry `handlebars`; raw `LICENSE` at `45ce1525`; advisories API |
| 15 | liquidjs 10.30.0 and its 2026 advisories | **Confirmed.** 10.30.0 published 2026-10-01T17:52Z, MIT at `920166e3`; 19 advisories, 18 published in 2026; CVE-2026-45618 critical RCE before 10.26.0; repeated `memoryLimit`, `renderLimit` and `ownPropertyOnly` bypasses, the newest (2026-10-07) fixed in 10.27.2; the three without a patched version all have ranges that end at or below 10.25.7 | registry `liquidjs`; raw `LICENSE` at `920166e3`; advisories API |
| 16 | `@marcbachmann/cel-js` 8.0.0 | **Confirmed.** Published 2026-07-07, `gitHead` `86cd9721…`, MIT `LICENSE` there, no dependencies, parse-time limits in the README, zero advisories | registry; raw `LICENSE`, `README.md` at `86cd9721`; advisories API |
| 17 | cron-parser 5.10.2 | **Confirmed.** Published 2026-10-09, `gitHead` `5033a312…`, MIT; depends on `luxon` ^3.7.2 (3.7.2, 2025-09-05, MIT at `4262a38d`); strict mode refuses day of month with day of week, requires all six fields, refuses empty expressions and unusable hash ranges; the README claims DST handling but gives no rule for gaps or repeats | registry `cron-parser`, `luxon`; raw `README.md`, `LICENSE` at `5033a312`; `LICENSE.md` at `4262a38d` |
| 18 | croner 10.0.1 / 11.0.0 DST rules | **Confirmed.** 10.0.1 (2026-02-01, `gitHead` `adc86215`) is the newest stable on or before the cutoff and 11.0.0 (2026-10-26) the latest. The README at each release commit: 10.0.1 skips times in a gap and runs repeats once; 11.0.0 runs fixed-time jobs at the first valid time after a gap, runs interval jobs at both occurrences of a repeat, skips interval times in a gap, and states its deviation from OCPS 1.4 §4.3.1. MIT at `adc86215` | registry `croner`; raw `README.md` at `adc86215` and at `2df1672d` (11.0.0's `gitHead`); raw `LICENSE` |
| 19 | Engine licences at their tags | **Confirmed** from each `LICENSE` file at the tag: Temporal v1.32.1, DBOS v5.3, pg-boss 12.38.0, graphile-worker v0.18.0, Hatchet v0.114.2 and XState (`xstate@5.33.3`) MIT; Trigger.dev v4.8.1, Conductor v3.33.0 and Kestra v2.0.7 Apache-2.0; Inngest v1.49.0 SSPL-1.0 with an Apache-2.0 grant effective on the third anniversary of availability; Restate v1.8.1 BSL 1.1, change date four years after release, change licence Apache-2.0; n8n `n8n@2.45.4` Sustainable Use License 1.0 plus an enterprise licence for `.ee` files; Windmill v1.850.0 AGPLv3 with proprietary enterprise code, Apache-2.0 for the clients and OpenFlow. Every tag except XState's was also checked as the repository's latest release | `https://raw.githubusercontent.com/<owner>/<repo>/<tag>/LICENSE[.md]`; `https://api.github.com/repos/<owner>/<repo>/releases/latest` |
| 20 | Temporal limits and tested PostgreSQL versions | **Confirmed** (51,200 events or 50 MB, warnings at 10,240 or 10 MB, 2,000 incomplete operations of each kind; tested PostgreSQL 13.18, 14.15, 15.10, 16.6) | `https://docs.temporal.io/workflow-execution/limits`, `/temporal-service/persistence` |
| 21 | DBOS writes, throughput, partitioned queues | **Confirmed** (one write per step plus two per workflow; more than 40K workflows or steps per second on one Postgres in its benchmarks; `partitionConcurrency` per partition) | `https://docs.dbos.dev/architecture`, `/typescript/tutorials/queue-tutorial` |
| 22 | pg-boss 12.38.0 transactional enqueue | **Confirmed.** 12.38.0 on npm 2026-10-13T17:51Z (GitHub release 17:45Z), 12.37.1 on 2026-10-08; the README at the tag lists creating jobs in an existing transaction with adapters for Drizzle and others, `SKIP LOCKED`, `LISTEN`/`NOTIFY`, cron and RRULE, dead letters, Postgres 13+ | registry `pg-boss`; raw `README.md`, `LICENSE` at `12.38.0` |
| 23 | Valkey AOF default and `maxmemory 0` | **Confirmed** (fsync every second is the default policy, losing up to about a second; `maxmemory` zero means no limit on 64-bit systems) | `https://valkey.io/topics/persistence/`, `/topics/lru-cache/` |
