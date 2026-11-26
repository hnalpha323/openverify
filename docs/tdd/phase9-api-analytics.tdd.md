# TDD record: api-analytics (Phase 9, Workflow 9B, Stage 3, family A)

Plan: `docs/plans/phase-9.plan.md`, C163 and C164's API, the `api-analytics` bullet of "## Workflow 9B", amendments B10-B15 (Stage 1a) and A1-A16 (Stage 1b (A)). Built on foundation-9b's (A) checkpoint `3ea88b84` and analytics-logic (`6a2cedb1`). Owned paths: `apps/api/src/services/analytics/`, `apps/api/src/jobs/analytics/`, `apps/api/src/routes/server/analytics.ts`, `packages/db/src/repositories/analytics.ts` (unchanged: the SQL lives in the services folder) and `apps/api/scripts/analytics-benchmark.ts`. Every command ran after `source scripts/env.sh`; iterating runs used `--coverage.enabled=false --maxWorkers=2`. Every value in a test is synthetic.

## Slice 1: the rollup SQL (C163.3, C163.4)

- Stub `9a1dab9d` (`chore`): `rollup-sql.ts` names `computeCohortRollups`, `computeCaseRollups`, `pathSha256` and the scope and row types, each refusing.
- RED `90bf0788`: `rollup-sql.test.ts` and the seeding helpers `testing.ts`. A seeded population of 48 people (mulberry32, seed 4242) across Paris's 23-hour day 2026-03-29; each definition recomputed person by person in the test.

```
$ pnpm exec vitest run src/services/analytics/rollup-sql.test.ts --coverage.enabled=false --maxWorkers=2
     × counts each definition per cohort day in the reporting zone, across a 23-hour day
     × counts an inquiry created at 00:30 local on its own day, not the UTC one
     ... (11 of 11)
Error: the rollup SQL is not built yet (api-analytics)
      Tests  11 failed (11)            exit 1
```

- GREEN `7ccdcd24`: the SQL (cohort `where` by local day bounds `(day::timestamp at time zone zone)`, the day `(created_at at time zone zone)::date`; inquiry columns, the duration histogram by `width_bucket` over core's own bucket bounds, tags, the funnel from person-visible step entries, attempts with capture method and country, the per-person step outcome from the last sent flow attempt of the step's type, checks with `errored` and `not_configured` by `checkErrorClassOf`'s rule, reasons, signals binned by `signalBinOf`, cases and the current assignee).

```
 Test Files  1 passed (1)
      Tests  11 passed (11)            exit 0
```

Seeding fixes made before RED was committed, each a CHECK of the base tables the helpers had to meet: `files_wrapped_dek_format`, `list_screenings_ended_has_time`, `inquiry_decisions_actor_id_format`, `users_password_hash_argon2id`, `cases_resolved_in_end`.

## Slice 2: the refresh, the rebuild and the hooks (C163.2-C163.6)

- RED `509f5e52`: `jobs/analytics/rollup.test.ts` (10 tests) and `services/analytics/hooks.test.ts` (8 tests), written against foundation-9b's stubs, so no new stub was needed.

```
$ pnpm exec vitest run src/jobs/analytics/rollup.test.ts src/services/analytics/hooks.test.ts --coverage.enabled=false --maxWorkers=2
     × builds every past day with activity, never the current day, and writes the state
     × refreshes only the live counts of a dirty open day, its outcomes kept ...
     × remove rollup rows past analytics-retention-months and assignee rows past their own window
     × refuses a reporting zone the database does not know, and passes one it knows
     × are re-keyed to former user, added into that day’s former-user row, in the organisation only
      Tests  13 failed | 5 skipped (18)   exit 1   (the redaction describe's beforeAll runs the stub pass)
```

- GREEN `290f42ed`: `days.ts`, `state.ts`, `store.ts`, `refresh.ts`, the four hooks and both jobs. One test change before GREEN passed: the redaction test's seeded `signals` were dropped, because the redaction builds the inquiry's resource for its event and the seed carried no `signal-details` (a seeding fault, not a behaviour change). `worker-analytics.test.ts`: the two stub tests ("fails permanently ... until api-analytics builds it" and the processor's stub assertion) now hold the built jobs (the plan changes that behaviour).

```
 Test Files  7 passed (7)      (rollup, hooks, rollup-sql, worker-analytics, phase9b plumbing, retention, retention-run)
      Tests  87 passed (87)    exit 0
```

## Slice 3: the six answers (C164.1-C164.8)

- RED `e89881d3`: `routes/server/analytics.test.ts` (12 tests) against the frozen 501 routes.

```
     × answers the contract’s document, naming the zone, threshold, settle window and freshness
     ... (12 of 12)
AssertionError: {"status":501,"detail":"The analytics answer /analytics/inquiries is not built yet ..."}: expected 501 to be 200
AssertionError: expected 501 to be 400        (the device filter on the funnel)
      Tests  12 failed (12)   exit 1
```

- A first trial of the drafts answered 500, `complementary suppression found no cell to hide`: core's exact check reads `ANALYTICS_RELATIONS` as exact, and an unsettled window breaks them (a pending inquiry is started, neither finished nor expired). Fixed in the answers before GREEN: each relation gets an `unsettled` remainder part (total less parts, never served, treated as known to a reader, the cautious side); a relation the rows break the other way is not declared.
- GREEN `f42875b6`: `read.ts`, `answers.ts`, `service.ts`, the route; the plumbing test's 501 cases now expect the built answers.

```
 Test Files  6 passed (6)
      Tests  67 passed (67)   exit 0
```

- `300ffd57` (test): the redaction through `POST /inquiries/:id/redact` (the app's redaction delegated to the real service) leaves the answer identical at once and after the next pass, and a live day answers the counts it has once rolled up (H28). Written after GREEN; it passed at once. Discrimination shown by a mutation (the `addRedactedInTx` call removed): `× keeps every count when an open day’s inquiry is redacted ... AssertionError: expected { 'time-zone': 'Europe/Paris', …(10) } to deeply equal ...`, exit 1; the file restored, `git diff` empty.

## Slice 4: Testcontainers (C178.2)

- `7582016e` (test): `analytics.integration.test.ts`, 8 tests on `startIntegrationPostgres` (the pinned image): open and closed days unchanged by on-demand redaction and by a template version's own `retention-days` (6 inquiries redacted by `runRetention`); the zone change queued, then rebuilt for open days only, the redacted rows keeping Paris, an answer naming both zones; the refresh under concurrent writes (12 writes beside two passes, then a final pass equal to a fresh computation); complementary suppression on real rollups (by day and week); the read plans with statistics (4,000 inquiries, attempts and checks, 2,000 cases cloned by SQL, `analyze`): the rollup key, the four `updated_at` indexes, the creation index.
- Characterisation tests on built code (no RED). Fixes to the test itself before it passed: each concurrent update writes a row once (a second write of the same `updated_at` lets the base trigger stamp the database's own now, which the fixed test clock never reaches); the plan queries use a populated, analysed table and the pass's 5-minute window, since an empty table lets the planner pick any index led by `environment_id`.

```
$ pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/analytics/analytics.integration.test.ts
      Tests  8 passed (8)    Duration 19.25 s    exit 0    (load 1.82 6.12 9.37)
```

## Slice 5: the benchmark (C163.7)

- RED `c90e6912`: `package-scripts.test.ts`'s stub test ("refuses to run until api-analytics builds ...") becomes "takes one phase per call, --seed, --measure or --teardown, and refuses anything else" (the plan changes that behaviour; the phases constant keeps `['--seed', '--measure']`).

```
     × takes one phase per call, --seed, --measure or --teardown, and refuses anything else
Error: usage: analytics:benchmark --seed or --measure (one phase per call)
      Tests  1 failed | 5 passed (6)   exit 1
```

- GREEN `55bf5879`: the script (container `openverify-analytics-benchmark`, `pgvector/pgvector:pg17`, loopback port; batches recorded in `benchmark_batches`; `--seed` stops starting batches after 420 s).

```
      Tests  6 passed (6)   exit 0
```

- `fe651127` (refactor): prettier on `services/analytics/` with `--ignore-path=.gitignore` (the format gate's bare `services/` pattern skips the folder); suites green after.

## Benchmark run (development, other agents running), each phase under `flock /tmp/openverify-e2e.lock`

Seed (resumable; three calls on this machine): 20 batches of 50,000 inquiries, 100,000 attempts, 600,000 checks and 150,000 step records; 43-92 s a batch, growing with the tables (load 1.4-6.0). Calls: 10 batches in 527 s, 6 in 425 s, 4 in 306 s (then `analyze`).

| Measure (1 M inquiries, 2 M attempts, 12 M checks, 3 M step records) | ms | load (1, 5, 15 min) |
|---|---|---|
| build: the first pass, 365 days | 411,183 | 3.35 3.40 3.75 |
| 5-minute refresh, 2 dirty days (48 hours touched) | 63 | 3.25 3.38 3.74 |
| first pass after midnight, 30 open days | 31,210 | 2.81 3.26 3.69 |
| reads, 30 days: inquiries / funnel / verifications / checks / cases / signals | 33 / 17 / 26 / 42 / 12 / 15 | 2.81 3.26 3.69 |
| reads, 90 days | 44 / 30 / 60 / 70 / 5 / 39 | 2.81 3.26 3.69 |
| reads, 400 days | 210 / 114 / 205 / 392 / 14 / 308 | 2.81 3.26 3.69 |

## Final gates

| Gate | Result |
|---|---|
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | exit 0 |
| `pnpm exec prettier --check` on my files (services files with `--ignore-path=.gitignore`) | exit 0 |
| `eslint` on every file I own or changed | exit 0 |
| `pnpm turbo run lint typecheck --force --filter=@openverify/api` (heavy slot) | typecheck passed; lint exit 1 on two errors in api-access's in-flight files only (`routes/dashboard/role-assignments.test.ts:444`, `services/users.ts:688`), twice, 229 s and 342 s apart by half an hour |
| API unit, 6 blob shards `--maxWorkers=3` (300, 308, 345, 302, 334, 257 s; load 1.9-11.1) and the merge (26 s) | merge exit 1: 8,816 passed, 1 failed, `services/users.test.ts` "keeps the SMTP failure kind on the 502" (api-access's in-flight `services/users.ts`, still failing after their later commits); 648 files; 92.73% statements, 83.28% branches; `services/analytics` 93.9% statements, `jobs/analytics` 100% |
| `pnpm --filter @openverify/db test:integration` | exit 1: 76 passed, 2 failed in `case-pull.integration.test.ts` (R008 "reads at most one case a queue", expected 100 ≤ 1), outside my paths (the db is unchanged by me; `case-queues.ts`/`cases.ts` changed by foundation-9b (U), `6e7e14ac`) |
| `--project graph` | exit 0, 13 tests, template built in 35.4 s (load 20.5) |
| `--project api` shards 1/3, 2/3, 3/3 | exit 0 each: 89, 97, 76 tests in 123, 257, 122 s (load 17-27) |
