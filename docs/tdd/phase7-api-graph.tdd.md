# Phase 7, Workflow 7B Stage 3: `api-graph` (C101-C103)

Evidence of the test-first cycles of `api-graph`, on base `5208061f` (foundation-7b's (G) report).
Every command ran after `source scripts/env.sh`; outputs are abbreviated.

## 1. The graph repositories (packages/db)

Stub `f6ef4607`: `listGraphValueHoldersOf` and `recordGraphIndexJobAttempt`, the two names the
tests need beyond the frozen ones.

RED (`packages/db/src/repositories/graph-repositories.test.ts`, 18 tests):

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/graph-repositories.test.ts --coverage.enabled=false
     × writes one row per account, value and source, and moves last-seen on a repeat
     ...
     × scrubs a redacted account, its links and the values only it held from every stored result
 FAIL ... GraphRepositoryNotBuiltError: upsertGraphAttributes is not built yet (api-graph)
 Tests  18 failed (18)
```

Each fails on the stub's `GraphRepositoryNotBuiltError`, the intended reason.

GREEN (the six repositories built; `graph-plumbing.test.ts` loses its "stubs reject" case, the
behaviour the plan changes here):

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/graph-plumbing.test.ts src/repositories/graph-repositories.test.ts --coverage.enabled=false
      Tests  28 passed (28)
$ pnpm --filter @openverify/db exec tsc --noEmit -p .   # rc 0
$ pnpm --filter @openverify/db exec eslint src/repositories/graph-*.ts   # rc 0
```

## 2. The indexer, the hooks, the index job, the sweep, the backfill, the reindex and components

Stubs: `0301cc1e` (`useGraphIndexKey`, `graphIndexKey`: the frozen indexer signature carries no
key) and the job's `GRAPH_INDEX_MAX_ATTEMPTS` with the backfill's `batchSize`.

RED (`apps/api/src/services/graph/indexing.test.ts`, `apps/api/src/jobs/graph/index-job.test.ts`):

```
$ pnpm exec vitest run src/services/graph/indexing.test.ts src/jobs/graph/index-job.test.ts --coverage.enabled=false
      Tests  21 failed | 3 passed (24)
   5 Error: processGraphIndex is not built yet (api-graph)
   1 Error: graph:reindex is not built yet (api-graph)
     AssertionError: expected Set{} to deeply equal Set{ 6, 8, 9, 15, 16, 18 }
     AssertionError: expected [] to deeply equal [ 12, 13, 14, 15, 16, 17, 18 ]
     AssertionError: expected { Object (deletedRows, scrubbedQueries) } to deeply equal { deletedRows: 1, scrubbedQueries: 1 }
     ...
```

The three that pass assert that nothing is written (production refusals, no key, a switch that
starts nothing), which the no-op stubs already do.

GREEN: `keys.ts`, `settings.ts`, `collect.ts`, the indexer and the hooks, the job, the sweep, the
backfill, `graph:reindex`, the rebuild and components, with five db reads beside them
(`listGraphBackfillAccounts`, `listGraphBackfillInquiries`, `listGraphEnvironmentIds`,
`completeGraphIndexStates`, `deleteGraphComponent`, `deleteGraphAttributesOfSource`). Two test
lines were wrong in the RED commit and changed here: two kind lists were sorted as strings
(`[18, 6]`), and a name keys in both orders, so `name_birthdate` gives two rows, not one.

The first GREEN run hung: the rebuild re-read the rows a consolidation had moved (source the
absorbed account, holder the survivor), which its account step did not replace. It now replaces
rows by holder and source, and stops when a pass replaces nothing.

```
$ pnpm exec vitest run src/services/graph/indexing.test.ts src/jobs/graph/index-job.test.ts --coverage.enabled=false
      Tests  24 passed (24)
$ pnpm exec vitest run src/services/graph-hooks.test.ts src/services/graph-index-hook.test.ts src/routes/flow/session-graph-hook.test.ts src/routes/dashboard/settings-graph.test.ts src/worker-graph.test.ts src/jobs/repeatable/phase7.test.ts src/blind-index-rebuild.test.ts src/services/redaction.test.ts --coverage.enabled=false
      Tests  113 passed (113)
$ pnpm exec tsc --noEmit -p .   # rc 0 (api, db)
$ pnpm exec eslint src/services/graph src/jobs/graph   # rc 0
```

## 3. Templates, versions, the engine, queries, the job and sweep, the unmask and bulk actions

RED (`apps/api/src/routes/graph-query-routes.test.ts`, `apps/api/src/jobs/graph/query-job.test.ts`),
against the frozen routes (501) and the job stubs:

```
$ pnpm exec vitest run src/routes/graph-query-routes.test.ts src/jobs/graph/query-job.test.ts --coverage.enabled=false
      Tests  19 failed (19)
     14 AssertionError: expected 501 to be 201 // Object.is equality
      1 AssertionError: expected [] to deeply equal [ { …(2) } ]           (the sweep enqueues nothing)
      1 AssertionError: expected { type: 'about:blank', …(5) } to match object { code: 'selection_too_large' }
      3 Error: processGraphQuery is not built yet (api-graph)
```

GREEN: `shared.ts`, `templates.ts`, `versions.ts`, the engine (`query.ts`), the binding
(`bind.ts`), `queries.ts`, the job and sweep, `node-values.ts` and `actions.ts`, with three db reads
(`filterGraphAccounts`, `listGraphValueSources`, `setGraphQueryStart`). `graph-routes.test.ts`
(foundation-7b's) asserted 501 "until built"; it now asserts each route reaches its handler past
authentication, scope and schema (none of 400, 401, 403, 501), and the two reads with `graph:read`
answer 200: the behaviour the plan changes here, nothing weakened.

```
$ pnpm exec vitest run src/routes/graph-query-routes.test.ts src/jobs/graph src/services/graph src/routes/graph-routes.test.ts src/services/graph-hooks.test.ts src/auth/pii-graph.test.ts --coverage.enabled=false
      Tests  130 passed (130)
$ pnpm exec tsc --noEmit -p .   # rc 0
$ pnpm exec eslint src/services/graph src/jobs/graph src/routes/graph-routes.test.ts src/routes/graph-query-routes.test.ts   # rc 0
```

## 4. The C102.8 suite on Postgres 17 and the synthetic graph

`apps/api/src/services/graph/synthetic.ts` builds the seeded graph (`buildSyntheticGraph`), shared
with `graph:benchmark`; `graph-engine.integration.test.ts` runs the engine on 100,000 accounts. The
suite was written after the engine's GREEN (section 3), so it has no RED of its own: its first run
passed, recorded here as it ran.

```
$ pnpm exec vitest run --config vitest.integration.config.ts src/services/graph/graph-engine.integration.test.ts --reporter=verbose
 ✓ keeps to max-hops: two hops reach one email ring, four the rings the phones chain 32ms
 ✓ stops at node-limit and says so 8ms
 ✓ skips a hub value through the capped count, and counts it 13ms
 ✓ leaves weak kinds out without include-weak-kinds 26ms
 ✓ starts from a value, and never puts a value or a key in a node id (P17) 14ms
 ✓ answers timed_out with what it gathered when the deadline passes 7ms
 ✓ runs at most two synchronous searches of an environment at once (P25) 43ms
 ✓ says the index is incomplete while a backfill runs (H10) 18ms
 ✓ a redacted account leaves every stored result 71ms
 ✓ a cancel holding the row first wins over a completion waiting for it 522ms
 ✓ a completion holding the row first wins over a cancel waiting for it 522ms
 ✓ builds the graph it searched: 100,000 accounts and their rows 57ms
      Tests  12 passed (12)
   Duration  61.64s        (loadavg 1.35 1.18 1.19)
```

## 5. `graph:benchmark`

Stubs `cb652596` and the scenario list. RED (`apps/api/src/services/graph/benchmark.test.ts`, a
2,000-account run on PGlite, asserting the report's shape and never a time):

```
$ pnpm exec vitest run src/services/graph/benchmark.test.ts --coverage.enabled=false
     × builds the seeded graph and reports every scenario
 Error: runGraphBenchmark is not built yet (api-graph)
      Tests  1 failed (1)
```

GREEN: `runGraphBenchmark` (`services/graph/benchmark.ts`) and the `graph:benchmark` command
(`apps/api/scripts/graph-benchmark.ts`: `--accounts`, `--runs`, `--seed`, `--database-url`). The
builder gains the weak `birthdate` kind (six rows an account: 6,005,000 at 1,000,000 accounts, as
C101.8 asks). `graph-hooks.test.ts` (foundation-7b's) asserted "not built yet"; it now parses the
benchmark's flags, the behaviour the plan changes here.

```
$ pnpm exec vitest run src/services/graph/benchmark.test.ts src/services/graph-hooks.test.ts --coverage.enabled=false
      Tests  30 passed (30)
$ pnpm exec vitest run --config vitest.integration.config.ts src/services/graph/graph-engine.integration.test.ts
      Tests  12 passed (12)     Duration  70.87s
```

### The benchmark's numbers (C101.8, reported, not gated)

Each step under `/tmp/openverify-e2e.lock`, on a Postgres 17 container of its own
(`pgvector/pgvector:pg17` with `POSTGRES_TEST_COMMAND`'s flags, removed after), through
`--database-url`, so the build resumed across two calls of at most 570 s:

- **100,000 accounts** (505,000 rows before `birthdate` joined; container mode): build 52.5 s;
  loads 1.32 before, 2.02 after.
- **1,000,000 accounts, 6,005,000 rows**: call 1 built 650,000 accounts (3,905,000 rows) and hit
  its 570 s limit (loads 1.12 -> 1.61); call 2 resumed and built the rest in 427.0 s, then ran 50
  starts per scenario (loads 1.44 -> 1.91):

| Scenario | p50 ms | p95 ms | max ms | mean accounts | mean nodes | timed out | hubs skipped |
|---|---|---|---|---|---|---|---|
| strong, 2 hops | 6.9 | 8.4 | 14.1 | 15 | 17 | 0 | 0 |
| strong, 4 hops | 11.0 | 13.3 | 17.4 | 25 | 29 | 0 | 0 |
| strong, 6 hops | 14.8 | 16.3 | 20.3 | 35 | 41 | 0 | 0 |
| strong and weak (device, IP, name), 4 hops | 17.1 | 20.6 | 21.6 | 189.6 | 235.6 | 0 | 0 |
| hub start, 4 hops | 9.8 | 11.1 | 11.2 | 25 | 29 | 0 | 50 |

The cost follows the accounts reached, not the table: the same scenarios at 100,000 accounts were
7.3 / 11.1 / 14.9 / 17.0 / 10.1 ms at p50.

## 6. The redaction coverage (plan (G) item 15)

Under the leave of plan (G) item 15, `seedPiiSubject` (`services/redaction.test-support.ts`) now
seeds a `graph_attributes` row of the subject's account and one of its inquiry, and a stored graph
result naming the account beside another; `redaction.test.ts` asserts that `redactAccount` leaves
no row of the account and no stored result naming it (the other account stays), and that
`redactInquiry` takes the inquiry's row and keeps the account's own. The hooks were built test-first
in section 2, so these assertions passed on their first run:

```
$ pnpm exec vitest run src/jobs/retention.test.ts src/services/retention.test.ts src/services/redaction.test.ts --coverage.enabled=false
      Tests  57 passed (57)
$ pnpm exec vitest run --config vitest.integration.config.ts src/services/lifecycle.integration.test.ts
      Tests  7 passed (7)
```

## 7. The later db reads, and a defect they found

Tests of the reads sections 2 and 3 added (`graph-repositories.test.ts`). One found a defect, RED:
`filterGraphAccounts` with `account-statuses` compared the `account_status` enum to `text[]`.

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/graph-repositories.test.ts --coverage.enabled=false
     × keeps the accounts a template’s filters allow, and finds a value’s sources among a result
 Error: Failed query: select id from accounts where ... and status = any($3::text[])
   code: '42883', hint: 'No operator matches the given name and argument types. ...'
      Tests  1 failed | 22 passed (23)
```

GREEN: `status::text = any(...)`.

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/graph-repositories.test.ts --coverage.enabled=false
      Tests  23 passed (23)
```

## 8. Values opened from their sources

Two route tests over values the indexer keyed at `POST /accounts` (the unmask of a linking value,
and `add-to-list`, `set-account-status` and `remove-tag` acting on them), written after section 3's
GREEN; they passed on their first run:

```
$ pnpm exec vitest run src/routes/graph-query-routes.test.ts --coverage.enabled=false
      Tests  17 passed (17)
```

## 9. The C102.8 suite under `pnpm test:integration`'s load

RED, seen in the full `pnpm test:integration` (both packages at once, loads 15 to 21):

```
@openverify/api:test:integration:  FAIL  src/services/graph/graph-engine.integration.test.ts
@openverify/api:test:integration: Error: Hook timed out in 180000ms.
```

The 100,000-account build (all six kinds, about 605,000 rows) does not fit the 180 s hook guard
under that load. The guard stays; the build got cheaper: `buildSyntheticGraph` takes `kinds` and
`weakAccounts`, and the suite writes the strong kinds for every account, IP addresses for 20,000
of them near its starts, and the hub (225,000 rows; the benchmark still writes all six kinds).
GREEN:

```
$ flock /tmp/openverify-e2e.lock ... vitest run --config vitest.integration.config.ts src/services/graph/graph-engine.integration.test.ts
      Tests  12 passed (12)     Duration  39.86s    (loadavg 3.82 -> 3.19)
$ pnpm test:integration
@openverify/db:test:integration:       Tests  69 passed (69)     Duration 141.72s
@openverify/api:test:integration:      Tests  216 passed (216)   Duration 260.70s
@openverify/api:test:integration:  ✓ src/services/graph/graph-engine.integration.test.ts (12 tests) 153192ms
 Tasks:    2 successful, 2 total                                 (loadavg 2.93 -> 15.63)
```

One count assertion was corrected on the way: the redacted account 60,001 holds two rows now, not
three.

## 10. Final gates (all in the foreground, exit code read directly)

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/db test` | rc 0: 99 files, 1,512 tests, 95.24 / 87.4 / 96.8 / 95.42 (load 1.06 -> 7.75) |
| API suite: shard 1/2, shard 2/2 (blob; each exits 1 on its partial coverage, as expected), then `--merge-reports --coverage` | merge rc 0: 431 files, 5,859 tests, 95.65 / 87.08 / 97.68 / 95.68; `src/services/graph` 87.35 % statements, `src/jobs/graph` 92.92 % |
| `pnpm turbo run lint typecheck --force` | rc 0, 30 of 30 (run again after the last change: rc 0) |
| `pnpm format:check` | rc 0 |
| `pnpm test:integration` | rc 0: db 69 tests (141.7 s), api 216 tests (260.7 s); the first run failed on the graph suite's hook (section 9) |
| `flock ... pnpm --filter @openverify/flow e2e` | rc 0: 79 passed (20.4 s; load 10.37 -> 9.70) |
| full stack, own stack per shard, `--shard=1/3`, `2/3`, `3/3` | rc 0: 32 passed (2.5 min; load 9.00 -> 3.31), 34 passed (5.4 min; 3.31 -> 2.19), 29 passed (4.5 min; 2.18 -> 2.89) |

The Android gate was not run: no fixture or decoded contract changed.

## Report (api-graph)

### Summary

All of the api-graph bullet (C101-C103) is built test-first on base `5208061f`, in path-scoped commits from `f6ef4607` to the report commit; nothing was pushed, no dependency or environment variable was added, and the only container I started (the benchmark's database) is removed.

**What landed**
- **db (`packages/db/src/repositories/graph*.ts`).** Every frozen stub built: attribute rows with the capped holder count (one statement for a hop's values), moves, deletes, the rebuild page; the index outbox's sweep, attempts and end states; the per-kind state; components; templates and versions as C71; queries with sealed params, results, cancel, rerun and the scrub of a redacted account. Twelve reads beyond the frozen names.
- **Indexing.** The in-transaction indexer at every hook (account fields and reference id, the session address under P05, inquiries moving with `add-objects`/`remove-objects`), the settings switches marking kinds incomplete, consolidation, both redaction hooks with the stored-result scrub, the `graph-index` job (rejected-handoff verifications left out, a redacted inquiry or `graph-indexing` off ending the row `skipped`) and its sweep, the resumable backfill, `graph:reindex`, `rebuildGraphIndexes` and nightly components over strong kinds.
- **Queries.** Templates and versions with publish refusals and pointers; the breadth-first engine in one read-only transaction with per-statement timeouts, the fan-out cap, the node limit and the template and synchronous advisory claims; queries with P11 binding, member-wise masking, events without values, cancel and rerun; the job and sweep; the audited unmask; bulk actions with the export; the `graph-queries` and `graph-unmask` policies, each tested.
- **Measured.** `graph:benchmark` at 1,000,000 accounts and 6,005,000 rows: p95 8.4 ms at 2 hops, 13.3 ms at 4, 16.3 ms at 6, 20.6 ms with weak kinds; the C102.8 suite on 100,000 accounts on Postgres 17.

**Gates, all rc 0 in the foreground:** db test (1,512), the API suite as two blob shards and the merge (5,859, 95.65 %), `pnpm turbo run lint typecheck --force` (30/30, twice), `pnpm format:check`, `pnpm test:integration` (db 69, api 216), and the e2e gate (79 mocked, then 32, 34 and 29 full-stack on own stacks). The first `test:integration` run failed on my graph suite's hook under load; the build got cheaper (section 9) and the re-run passed.

**Things to know**
- The indexer's frozen signature has no key, the query job's deps have no key, audit or dashboard URL: the workarounds and the proposed wiring are contractDeviations 1, 2, 5 and 6.
- Defect found by a db test and fixed test-first: a template's status filter compared the account status enum to `text[]`.
- Three foundation-7b tests changed with the plan (501 -> built, the benchmark, the stubs), and the redaction coverage gained the graph rows under plan (G) item 15.

### Handoff

## How to run
- Run `source scripts/env.sh` first. Evidence: `docs/tdd/phase7-api-graph.tdd.md` (sections 1-10 and this report).
- db: `pnpm --filter @openverify/db exec vitest run src/repositories/graph-repositories.test.ts src/repositories/graph-plumbing.test.ts --coverage.enabled=false` (33 tests).
- API, from `apps/api`: `pnpm exec vitest run src/services/graph src/jobs/graph src/routes/graph-query-routes.test.ts src/routes/graph-routes.test.ts src/services/graph-hooks.test.ts --coverage.enabled=false`.
- Postgres 17 (C102.8, about 40 s idle, 153 s under the full `test:integration`): `pnpm exec vitest run --config vitest.integration.config.ts src/services/graph/graph-engine.integration.test.ts`.
- Benchmark: `pnpm --filter @openverify/api graph:benchmark [--accounts=<1000-2000000>] [--runs=<1-200>] [--seed=<text>] [--database-url=<postgres URL>]`. Without a URL it starts a Testcontainers Postgres 17 and stops it; with one (a throwaway database) the build resumes batch by batch across calls, which is how 1,000,000 accounts fit two 570 s calls.
- Reindex: `pnpm --filter @openverify/api graph:reindex [--environment <env_...>] [--batch-size=<n>]` (counts only).

## Routes (all under `/api/v1`; schemas and scopes as foundation-7b froze them)
| Route | Scope | Answers | Problems |
|---|---|---|---|
| `POST /graph-query-templates` | `graph:write` | 201, a template with a draft v1 (the body's config, or the default: `account_id` start over the strong kinds) | 400, 401, 403 |
| `GET /graph-query-templates` (`filter[status]`, cursor) | `graph:read` | 200, newest first | 400 (cursor) |
| `GET /graph-query-templates/:id` | `graph:read` | 200 with `latest-version`, `published-version` | 404 |
| `PATCH /graph-query-templates/:id` (name) | `graph:write` | 200 | 404 |
| `DELETE /graph-query-templates/:id` | `graph:write` | 200, `archived` | 404 |
| `POST /graph-query-template-versions` | `graph:write` | 201, the next draft | 404; 409 `graph_template_archived` |
| `GET /graph-query-template-versions/:id` | `graph:read` | 200 | 404 |
| `PATCH /graph-query-template-versions/:id` | `graph:write` | 200 | 404; 409 `graph_template_version_not_draft` |
| `POST /graph-query-template-versions/:id/publish` | `graph:write` | 200, published, the old one superseded, under the template lock | 404; 409 `graph_template_version_not_draft`; 422 `weak_kind_not_allowed`, `graph_parameter_unbound`, each pointer `/data/attributes/config/...` in `errors` |
| `POST /graph-queries` (+ `meta.run-sync`) | `graph:write`; `pii:view` for a parameter of a `GRAPH_PERSON_KINDS` kind | 201 `submitted` (enqueued after the commit), or with `run-sync` the result (`completed` or `timed_out`) | 403 `graph_parameter_not_allowed`; 404 template; 409 `graph_template_archived`; 422 `graph_template_not_published`, `graph_parameter_missing` (pointer), a plain 422 for an undeclared parameter or a value its kind cannot key (pointer `/data/attributes/parameter-map/<name>`); 429 `graph-queries` policy (Retry-After) or `graph_sync_limited` |
| `GET /graph-queries` (`filter[status]`, `filter[graph-query-template-id]`, cursor) | `graph:read` | 200, newest first, `params` masked member-wise without `pii:view` | 400 |
| `GET /graph-queries/:id` | `graph:read` | 200 | 404 |
| `POST /graph-queries/:id/rerun` | `graph:write` (+ `pii:view` as at creation) | 200 `submitted` (a synchronous query runs again at once); `graph-query.reran` | 404; 409 still submitted; 410 `graph_query_redacted`; 429 |
| `POST /graph-queries/:id/cancel` | `graph:write` | 200 `cancelled`; `graph-query.cancelled` | 404; 409 `graph_query_not_cancellable` |
| `GET /graph-queries/:id/nodes/:nodeId/value` | `graph:read` + `pii:view` (route) | 200 `graph-node-value` `{ kind, value }` (a start node answers its bound parameter; `null` when no source still gives the value); audit `graph-query.node-unmasked` `{ node-id, kind, found }` | 403; 404 `graph_node_not_found`; 410 `graph_query_redacted`; 429 `graph-unmask` per principal |
| `POST /graph-queries/:id/actions` | `graph:read` + the action's own (`accounts:write`; `lists:write` + `pii:view`; `accounts:read` + `pii:view`) | 200 preview counts; 200 per-account outcomes (`done`, `skipped_redacted`, `skipped_consolidated`); export `text/csv; charset=utf-8`; audit `graph-query.action` `{ action, selected-count, done-count }` | 400 no `Idempotency-Key` on a non-preview call; 403; 404; 410; 422 `selection_too_large`, `biometric_list_not_bulk`, a kind that fits no list |

Events: `graph-query.submitted`, `.completed`, `.errored`, `.timed-out`, `.cancelled`, `.reran`, each with `params: null`, no nodes and no links (the `accounts` relationship stays). Audit: templates and versions (`graph-query-template.created|updated|archived`, `graph-query-template-version.created|updated|published`), `graph-query.submitted` with the template version, a synchronous run's terminal action with counts and truncation, `graph-query.reran`, `graph-query.cancelled`.

## The engine (`apps/api/src/services/graph/query.ts`)
- `searchGraph(db, plan, { now, claim? }) => GraphSearchResult | null` (`null` when the claim refused): one read-only transaction (`set transaction read only`), `SET LOCAL statement_timeout` before every statement within the deadline, three statements a hop (`listAccountGraphAttributes`, `listGraphValueHoldersOf` with `limit cap + 1`, `filterGraphAccounts`).
- Hops the public way (account to value 1, two accounts sharing a value 2); a start value is hop 0. `max-hops` 2/4/6 (default 4); `node-limit` 1-2,000 (default 100) over accounts and values together, `nodeLimitReached`; fan-out cap `GRAPH_LIMITS.defaultFanOut` 50 (`skippedHubValues`); weak kinds dropped unless `include-weak-kinds`. A value node joins only when at least two of the result's accounts hold it (a start value always). Past the deadline (or a `57014`), `timedOut` with what was gathered.
- Claims: `templateClaim(env, template)` (`pg_try_advisory_xact_lock(hashtextextended('openverify/graph-query/' || env || template, 0))`, an unclaimed job answers `waiting` and the sweep re-enqueues it) and `synchronousClaim(env)` (two slots, `openverify/graph-query-sync/<env>/<0|1>`). A synchronous run's timeout is `min(requested, 10)` s; asynchronous 1-59, default 30.
- Node ids `gn_` + 22 base64url (`newGraphNodeId`, random, never derived); `node_map` maps them to `{ kind, valueKey, keyId?, start?, parameter? }`, and a start account to `{ start, account }` (server only).
- Measured: 7-71 ms a search on 100,000 accounts (CI suite); benchmark below.

## Benchmark (C101.8; reported, not gated; each step under the e2e lock)
1,000,000 accounts, 6,005,000 rows, Postgres 17 container of its own, 50 starts a scenario, loads 1.44 -> 1.91: strong 2 hops p50 6.9 / p95 8.4 / max 14.1 ms (15 accounts); strong 4 hops 11.0 / 13.3 / 17.4 ms (25); strong 6 hops 14.8 / 16.3 / 20.3 ms (35); strong + device + IP + name 4 hops 17.1 / 20.6 / 21.6 ms (189.6 accounts, 235.6 nodes); hub start 4 hops 9.8 / 11.1 / 11.2 ms (the hub skipped in all 50). No run timed out or hit the node limit. The build took two calls (570 s, then 427.0 s). At 100,000 accounts the p50s were 7.3 / 11.1 / 14.9 / 17.0 / 10.1 ms (build 52.5 s).

## Indexing (C101.3-C101.6)
- `services/graph/keys.ts`: `graphValueKeys(key, env, kind, value)` (the shared labels, `[]` for a refused value), `graphIndexKey()` / `useGraphIndexKey(key)` (the in-transaction indexer's key, from `OPENVERIFY_BLIND_INDEX_KEY`).
- `services/graph/settings.ts`: `graphSettingsOf(environment)` `{ indexing, weakKinds, deviceRecognition, components, sandbox }`, `writesGraphKind`, `kindsNotIndexed(settings, states, kinds)`.
- `services/graph/collect.ts`: `accountGraphValues`, `inquiryGraphValues` (fields; government ID extraction incl. failed ones; chip read; passed OTP confirmed destinations; passed wallet; sessions' devices under the current key; addresses under P05), `sessionAddressValues`, `addressIndexable`, `GraphValue { kind, valueKey, keyId, source, display, plain }`.
- `services/graph/indexing.ts`: `indexAccountAttributesInTx` (built), `graphAttributeRows`, `indexInquiryInTx`, `indexAccountInTx`. Hooks built: `onGraphSettingsChangedInTx`, `moveGraphOnConsolidationInTx`, `redactInquiryGraphInTx` (deletes the inquiry's rows, scrubs its account from stored results, stubs and forgets those results), `redactAccountGraphInTx` (all rows, the component, the scrub), `rebuildGraphIndexes`, `runGraphReindex`.
- Jobs: `processGraphIndex` (skip codes `inquiry_redacted`, `graph_indexing_off`; `GRAPH_INDEX_MAX_ATTEMPTS` 5 then `errored` `graph_index_failed`), `runGraphIndexSweep` (`GRAPH_INDEX_REENQUEUE_AFTER_MS` 60 s, ends a redacted inquiry's row `skipped`), `runGraphBackfill` (`GRAPH_BACKFILL_BATCH_SIZE` 200, cursor `{ phase: 'accounts' | 'inquiries', after }`, exported `backfillStep`), `runGraphComponents` (strong kinds only, labels `c<n>`, every account a row), `processGraphQuery`, `runGraphQuerySweep` (`GRAPH_QUERY_REENQUEUE_AFTER_MS` 30 s, never a synchronous query).
- db (beyond the frozen names): `listGraphValueHoldersOf`, `listGraphAttributesPage`, `deleteGraphAttributesOfSource`, `filterGraphAccounts` (`GraphAccountFilters`), `listGraphValueSources`, `recordGraphIndexJobAttempt`, `listGraphBackfillAccounts`, `listGraphBackfillInquiries`, `listGraphEnvironmentIds`, `completeGraphIndexStates`, `deleteGraphComponent`, `setGraphQueryStart`.
- Test support: `services/graph/synthetic.ts` (`buildSyntheticGraph`, `syntheticAccountId`, `syntheticValueKey`, `SYNTHETIC_KINDS`), `services/graph/benchmark.ts` (`runGraphBenchmark`, `GRAPH_BENCHMARK_SCENARIOS`).

## What the explorer (dashboard-graph, 7C) needs
- A result from `GET /graph-queries/:id`: `nodes[]` (`account` with the account id; a kind with a `gn_` id), `links[]` `{ from, to, kind }`, `index-complete` / `kinds-not-indexed` (say "the index is still being built" and which kinds), `node-limit-reached`, `skipped-hub-values`, `template-version-id`, `redacted-at`; poll while `submitted`.
- Labels stay masked; an unmask is a click or key press calling `GET /graph-queries/:id/nodes/:nodeId/value` (403 without `pii:view`, 429 under `graph-unmask`).
- Bulk actions: preview first (`preview: true`, counts only), then the same body with an `Idempotency-Key` header; the export answers `text/csv` (the node client parses JSON only).
- Template editor: publish problems carry pointers under `/data/attributes/config`; binding forms in the API docs (contractDeviations 3).
- The account page's "linked through strong identifiers: N" has no route yet: `graph_components` is written nightly and read by `getGraphComponent`, but no contract serves it (followups).

### contractDeviations

1. `indexAccountAttributesInTx(tx, environmentId, accountId, source, attributes)` carries no blind-index key, so the in-transaction indexer reads `OPENVERIFY_BLIND_INDEX_KEY` from the process environment (`graphIndexKey`, `apps/api/src/services/graph/keys.ts`, the variable every process's configuration already requires), with `useGraphIndexKey(key)` as the seam a process or a test sets; a process without a key writes nothing (never a guess). Proposed amendment: `container.ts` and `worker.ts` call `useGraphIndexKey(config.blindIndexKey)` at start, or the hook gains a key parameter (integration-7b; both shared files).
2. `GraphQueryDeps` (the worker's `graph-query` job) carries no blind-index key, so the API binds a query's start when it is submitted or rerun and writes the start keys into the submitted query's `node_map` (new `setGraphQueryStart`), as `{ kind, valueKey, keyId, start: true, parameter }` per start value and `{ start: true, account: true }` per start account; the job reads them (`startOf`) and opens the sealed params only for a created-at window. `node_map` stays server-only and holds no value.
3. C102.2 binds every parameter as one string. Ours, for the kinds a string cannot carry unambiguously: `name` binds a JSON object `{ "name-first", "name-last" }`, `name_birthdate` adds `birthdate`, `address` its six `address-*` members (the list item's members); `government_id_number` binds `{ "issuing-authority-code", "identification-number", "id-class"? }` and is keyed with the C31.8 index; `crypto_address` binds `{ "chain-id", "address" }` (the C53.2 index); `chip_signature` cannot be bound (no plaintext) and answers 422. A name keys in both orders, so it starts two nodes. A parameter the template does not declare, and a value its kind cannot key, answer a plain 422 with the pointer `/data/attributes/parameter-map/<name>` (GRAPH_PROBLEM_STATUSES has no code for them); a created-at parameter is an ISO time.
4. A property node joins a result only when at least two of the result's accounts hold it (a start value always does), so a value one account holds alone is not drawn: it links nothing. C102.4 does not say which values are nodes.
5. `explorer-url` is built from `OPENVERIFY_DASHBOARD_PUBLIC_URL` (read from the process environment, as the operator settings read it) or `http://localhost:3001`: `ApiDependencies` has no dashboard URL. Proposed amendment: `ApiDependencies.dashboardPublicUrl`, wired by the container (integration-7b).
6. `GraphQueryDeps` has no audit logger, so an asynchronous run's completion is not audited by the worker; the submission is audited with its template version, a synchronous run's terminal status with its counts and truncation (C102.7 asks that every query be audited with counts). Proposed amendment: `GraphQueryDeps.audit`, wired in `worker.ts` (integration-7b).
7. `POST /:id/rerun` reruns the pinned version, re-binds the sealed params with the current key and checks `pii:view` again (a principal without it cannot rerun a person-identifying query), applies `graph-queries`, and runs a synchronous query synchronously again (the sweep never takes one); rerunning a `submitted` query answers a plain 409.
8. C103.1 read to the letter: every non-preview call needs an `Idempotency-Key`, the export too (400 without one). Each action's scope is checked once for the call (403), so `refused_scope` is never an outcome. `add-to-list` maps graph kinds to list kinds (`email_address`, `email_address_unconfirmed` -> `email-address` by address, `email_domain` -> by domain, `phone_number*` -> `phone-number`, `government_id_number`, `ip_address`, `name`, `device_fingerprint`, `browser_fingerprint`); any other kind, or a kind that does not fit the list, answers 422. The list item's creator is the acting user or key; `ListItemToWrite` has no source member, so 'the query as source' is the audit entry only. The export's columns are `account-id`, `reference-id`, `status`, `tags` (space-joined), `hop-distance` (breadth-first over the stored links from the start nodes) and `linking-kinds`; a redacted account is left out.
9. The `graph-index` job counts its runs in `graph_index_jobs.attempts` (new `recordGraphIndexJobAttempt`) and ends the row `errored` (`graph_index_failed`) at the fifth; skip codes `inquiry_redacted` and `graph_indexing_off`. It locks the inquiry row while it writes, so a redaction committed first leaves nothing written.
10. The backfill's cursor is `{ phase: 'accounts' | 'inquiries', after }` (ids only); the incomplete kinds of an environment that share a cursor walk together, and the walk writes every kind the settings allow (the upsert is idempotent), the accounts not redacted and not absorbed, then the inquiries past `created` and `pending` and not redacted. `graph:reindex` runs the same walk and marks every kind of the environment complete.
11. Components: the run's label is `c<n>`; every account of an opted-in environment that is neither redacted nor absorbed gets a row (size 1 when it shares no strong value), so "not computed yet" means newer than the run; a consolidation leaves the components to the next run.
12. P05 at the session start and in the job: in a sandbox every evaluated address is written; outside one, only an address whose `client_address_source` is not `trust-all`, that is not a privacy relay, and whose class is `public` (`classifyAddress` of `@openverify/signals/network`). The device kinds come only from device rows made under the current key id (a rotated device is never compared, C94.4).
13. `kinds-not-indexed` lists, among the template's connect kinds (weak ones only with the flag) and its start kinds: a kind not written now (`graph-indexing` off, `graph-weak-kinds` off), a device kind while device recognition is off, and a kind whose state row is incomplete.
14. An inquiry's redaction scrubs its account from every stored result, as the hook's header says (C101.4 'no stored result naming the source'), and stubs the events and forgets the stored responses of the queries it changed.
15. Existing tests changed with the plan, none weakened: `packages/db/src/repositories/graph-plumbing.test.ts` lost its "stubs reject" case; `apps/api/src/routes/graph-routes.test.ts` asserted 501 "until built" and now asserts each route reaches its handler (none of 400, 401, 403, 501) and the two reads answer 200; `apps/api/src/services/graph-hooks.test.ts` asserted the benchmark "not built" and now parses its flags; `services/redaction.test-support.ts` and `services/redaction.test.ts` seed and scan the graph rows and a stored result under plan (G) item 15's leave.
16. The synthetic graph's builder (`apps/api/src/services/graph/synthetic.ts`) is shared by the benchmark (six kinds and a 5,000-holder hub: 6,005,000 rows at 1,000,000 accounts) and the CI gate, which writes the kinds its cases read (strong for every account, IP addresses for 20,000, the hub: 225,000 rows) so the build fits the 180 s hook guard under `test:integration`'s load.
17. The graph-query filter resolver stays as foundation-7b built it (each payload `{}`): a graph query links to no template or account type, so it fails any filter that is present (plan (G) item 14).

### Followups

- integration-7b: wire `useGraphIndexKey(config.blindIndexKey)` in `container.ts` and `worker.ts` (or give the indexer hook a key), add `dashboardPublicUrl` to `ApiDependencies` for `explorer-url`, and an audit logger to `GraphQueryDeps` (contractDeviations 1, 5, 6).
- integration-7b, `docs/graph/README.md`: the kinds and strengths; the parameter binding forms (contractDeviations 3); the limits (hops, node limit, fan-out 50, synchronous 10 s and 2 a time, 30 a minute, unmask 60 a minute per principal); the benchmark numbers; the DPIA note; that `graph-backfill` is a 60 s tick and `graph-components` nightly at 03:00 UTC.
- 7C (dashboard-graph and contracts): the account page's "linked through strong identifiers: N" (C101.6) has no route or attribute: `graph_components` is written and `getGraphComponent` reads it, but nothing serves it. A contract change is needed (for example `meta.graph-component` on the account, or `GET /accounts/:id/graph-component`).
- 7C: the node client's `graphQueries.action` parses JSON only; the export (`text/csv`) needs its own method if a client wants it (as contracts-7b and foundation-7b noted).
- Owner or 7C: `graph-engine.integration.test.ts` takes 153 s of its 180 s hook guard under the full local `pnpm test:integration` (loads up to 21), 40 s alone; if CI is slower, write fewer weak rows or move the build to a database template.
- Owner or 7C (K7A-10): the session start has no logger, so a swallowed indexer failure in `indexSessionAddressInTx` leaves no trace.

### Measurements

- Benchmark (C101.8; under /tmp/openverify-e2e.lock, Postgres 17 container of its own): 1,000,000 accounts and 6,005,000 rows built in two resumable calls (650,000 accounts in the first 570 s, loads 1.12 -> 1.61; the rest in 427.0 s); 50 starts a scenario at loads 1.44 -> 1.91: strong 2 hops p50 6.9 / p95 8.4 / max 14.1 ms (15 accounts); strong 4 hops 11.0 / 13.3 / 17.4 ms (25); strong 6 hops 14.8 / 16.3 / 20.3 ms (35); strong + device + IP + name 4 hops 17.1 / 20.6 / 21.6 ms (189.6 accounts, 235.6 nodes); hub start 4 hops 9.8 / 11.1 / 11.2 ms (hub skipped 50 of 50); no timeout, no node-limit stop.
- Benchmark at 100,000 accounts (container mode, 505,000 rows before birthdate joined): build 52.5 s; p50 7.3 / 11.1 / 14.9 / 17.0 / 10.1 ms for the five scenarios (loads 1.32 -> 2.02).
- C102.8 suite on Postgres 17 (12 tests): alone 39.9 s for the file at loads 3.82 -> 3.19 (each search 7-71 ms; each race 522 ms with its 500 ms wait); inside the full pnpm test:integration 153.2 s (loads up to 21).
- API unit suite: 5,859 tests in 431 files, 95.65 / 87.08 / 97.68 / 95.68 (statements, branches, functions, lines) after the merge; src/services/graph 87.35 % statements, src/jobs/graph 92.92 %.
- db: 1,512 tests in 99 files, 95.24 / 87.4 / 96.8 / 95.42.
- Integration: db 69 tests (141.7 s), api 216 tests in 36 files (260.7 s).
- e2e gate: mocked flow 79 passed (20.4 s, load 10.37 -> 9.70); full stack 32 (2.5 min, 9.00 -> 3.31), 34 (5.4 min, 3.31 -> 2.19), 29 (4.5 min, 2.18 -> 2.89).
- New tests: db 23 (graph-repositories.test.ts); api 24 (indexing and index job), 17 + 4 (routes, query job), 1 (benchmark), 12 integration; 2 redaction assertions.

### Blockers

None.
