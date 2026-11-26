# TDD evidence: Workflow 7A Stage 1b, `foundation-7a` (Phase 7)

- **Slice owner:** the Workflow 7A Stage 1b `foundation-7a` agent (plumbing only), beside the Stage 2 agents (`network-data`, `client-collector`, `signal-logic`, `android-signals`).
- **Date:** 2026-10-30.
- **Base:** `8b7182e2` (the end of Stage 1a).
- **Input:** the "Stage 1b: foundation-7a" bullet of `docs/plans/phase-7.plan.md`, family by family; the "Workflow 7A Stage 1a amendments (contracts-7a)"; the "Phase 6 outcomes that amend this plan". The decisions this stage took are in the plan's "Workflow 7A Stage 1b amendments (foundation-7a)".

Each unit follows the same cycle: a stub (`chore`) only when a test needs a name that does not exist yet, so the RED commit compiles and type-checks; the test, run and seen failing for its intended reason (RED, `test`); the smallest change that passes it (GREEN, `feat`); a refactor on green where one was worth making. Every command ran after `source scripts/env.sh`; output is trimmed to the lines that matter. Every address is from the documentation ranges and every ASN from the documentation ASN ranges.

## Checkpoint (N): network

### N.1 Migration 0023 extended: the network tables and the session's network facts (C91.1, C91.3, C92, C93.2)
RED `2e4962b6`; GREEN `e701d57f`.

RED (`src/phase7-network-tables.test.ts`, new; the pinned lists of `testing.test.ts`, `schema-v2.test.ts` and `migrate.test.ts` changed with the plan; the upgrade test `migration-0023.integration.test.ts`, new):
```
$ (cd packages/db && pnpm exec vitest run src/phase7-network-tables.test.ts src/testing.test.ts src/migrate.test.ts src/schema-v2.test.ts --coverage.enabled=false)
     × creates the Workflow 7A (N) network tables in 0023, with updated_at triggers and no table recreated (C92, C93)
     × lists every encrypted column for the KEK rewrap
     × creates network_sources keyed by the manifest source id, with no environment
     × refuses a sync with an unknown outcome   (and every other sync, source, network and session check)
     × applies every migration, including the pgvector extension
AssertionError: network_sources: expected 'ALTER TABLE "report_templates" DROP C…' to contain 'CREATE TABLE "network_sources"'
AssertionError: expected [ 'accounts.fields:row', …(38) ] to deeply equal [ 'accounts.fields:row', …(41) ]
 Test Files  4 failed (4)      Tests  37 failed | 150 passed (187)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0023.integration.test.ts)
     × creates the network tables on an empty database; a network goes with its session
     × upgrades a database at 0022 with rows in it: the session keeps its row, its facts start null
Caused by: error: relation "networks" does not exist
Caused by: error: column "network_evaluated_at" does not exist
      Tests  2 failed (2)
```
GREEN: `tables/networks.ts` (`network_sources`, `network_syncs`, `networks`), the session columns and `inquiry_sessions (environment_id, id)` in `tables/inquiries.ts`, the helpers `trueOrNull`, `countryCodeFormat` and `oneOf` in `tables/columns.ts`. Then, as amendment 10 of Stage 1a says: `pnpm --filter @openverify/core build`, the Stage 1a `0023_phase7a.sql`, `meta/0023_snapshot.json` and journal entry 23 removed (kept in the session scratchpad), `drizzle-kit generate --name phase7a`. Two hand edits: drizzle-kit placed the new `inquiry_sessions_environment_id_id_key` after the foreign key that needs it, so the unique key moves before `networks_inquiry_session_fk`; and the two `updated_at` triggers (`network_sources`, `networks`). The two `report_type` CHECK constraints of Stage 1a are regenerated unchanged. No earlier table or type is dropped or recreated.

The sealed columns joined `ENCRYPTED_COLUMNS`, `SEALED` (`inquirySessionLocation`, `networkIp`, `networkLocation`) and `REWRAP_TABLES` (`networks`); `toInquirySession` opens `location`; `networks` joined `SUBJECT_PII_TABLES` (the API's redaction coverage test). New `@openverify/db/testing` helpers: `seedNetworkSource`, `seedNetworkSync`, `seedNetwork`; the KEK rewrap test seeds a network and a session location. Three defects of the RED test itself were fixed on the way (a duplicated column in `insertSourceAndSync`, a token hash shared by every seeded session, a `bigint` read as a string in the upgrade test); the existing session literal of `apps/api/src/jobs/records.test.ts` gained the new nullable fields.
```
$ (cd packages/db && pnpm exec vitest run src/phase7-network-tables.test.ts src/testing.test.ts src/migrate.test.ts src/schema-v2.test.ts src/phase7-report-types.test.ts src/repositories/key-rotation.test.ts src/repositories/inquiry-sessions.test.ts src/repositories/inquiry-sessions-v2.test.ts --coverage.enabled=false)
 Test Files  8 passed (8)      Tests  206 passed (206)
$ (cd packages/db && pnpm exec vitest run --coverage.enabled=false)      Test Files  79 passed (79)   Tests  1055 passed (1055)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0023.integration.test.ts)      Tests  2 passed (2)
```

### N.2 The redaction entries of the new sealed columns (C91.4, C107.5)
RED `f7a6de4f`; GREEN `39dc83ef`.
```
$ (cd packages/db && pnpm exec vitest run src/repositories/redaction.test.ts src/repositories/subject-ids.test.ts --coverage.enabled=false)
     × names inquiries, verifications, sessions and accounts
     × nulls the session location and the network address and location, keeping the derived facts, and stubs and forgets the network (C91.4, C107.5)
AssertionError: expected [ { …(7) } ] to deeply equal [ { ip: null, …(6) } ]
AssertionError: expected [ 'inq', 'ver', 'iqse', 'acc', …(2) ] to deeply equal [ 'inq', 'ver', 'iqse', 'acc', …(3) ]
      Tests  2 failed | 12 passed (14)
```
GREEN: `redactInquiryRecords` nulls `inquiry_sessions.location` and each session's `networks.ip` and `networks.location` (country, ASN, flags, reasons and sources stay), and the network ids join the stubbed and forgotten objects; `net` joins `REDACTION_SUBJECT_ID_PREFIXES` (the exact-list test of `subject-ids.test.ts` changed with C107.5); the header table gains the three rows. `Tests 14 passed (14)`; db suite `1056 passed`.

### N.3 The db repository stubs (owner `api-network`)
Stub `03e48a2e`: `repositories/network-sources.ts` (`reconcileNetworkSourceRows`, `listNetworkSourceStates`, `insertNetworkSync`, the types `ReconciledNetworkSource`, `NetworkSourceState`, `NetworkSyncInput`, `NetworkSyncOutcome`, `NetworkSyncActor`, `NetworkOrigin`, `NetworkSyncOverride`, and `NetworkRepositoryNotBuiltError`), `repositories/networks.ts` (`recordSessionNetworkEvaluation`, `listSessionNetworks`, `NetworkFacts`, `NetworkEvaluationWrite`, `Network`, `NetworkFactReason`), both exported from `repositories/index.ts`. Each rejects with `NetworkRepositoryNotBuiltError` until built; nothing calls them yet.

### N.4 `ipReputation` for both processes and the network settings (C92.5, C93.5, C107.8, F26)
Stubs `c76ba2de` (the `IpReputationProvider`, `NetworkSnapshot`, `NetworkSnapshots` and `ManagedNetworkSnapshots` ports, `Phase7Providers`, `providers/ip-reputation/index.ts` with `createIpReputationProvider`, `PHASE7_PROVIDER_KINDS` not yet bound, `NetworkSettings` at its defaults); RED `65ef1242` (with `ProviderBindingOptions.ipReputation` declared, so the test type-checks); GREEN `8b4f087f`; compose and `.env.example` `d6d9c754`; refactor `1d2ea46f`.
```
$ (cd apps/api && pnpm exec vitest run src/providers src/config.test.ts src/config-phase7.test.ts src/config-phase6.test.ts --coverage.enabled=false)
     × is a kind of its own, with its variable and names, read by both processes
     × is read the same way by the API and the worker
     × give both processes the MMDB file of an mmdb-file binding
     × stop either process binding mmdb-file without the file, naming the variable
     × reads only the kinds each process uses: the API sms, database and aamva, the worker every other
AssertionError: expected [ 'sms', 'database', 'aamva' ] to deeply equal [ 'sms', 'database', 'aamva', …(1) ]
AssertionError: expected undefined to match object { id: 'sandbox', sandbox: true }
Error: expected loadConfig to throw a ConfigError
 Test Files  4 failed | 41 passed (45)      Tests  18 failed | 550 passed (568)
```
GREEN: `ipReputation` in `PROVIDER_KINDS` (last), `PROVIDER_ENV_PREFIXES` (`OPENVERIFY_PROVIDER_IP_REPUTATION`), `PROVIDER_NAMES` (`mmdb-file`), `PROVIDER_NAMES_BY_KIND` (`mmdb-file`, `sandbox`) and `PROCESS_PROVIDER_KINDS.api` (the worker reads every kind but `sms`); bound through `createIpReputationProvider` with `{ mmdbPath }`, which the container and the worker pass from `config.network.ipReputationMmdbPath`. `config.ts`: `parseNetworkSourceLists` (both lists, read alike by every process), `OPENVERIFY_NETWORK_REFRESH` (worker only), `OPENVERIFY_IP_REPUTATION_MMDB_PATH` (absolute; required while either kind binds `mmdb-file`; never echoed). The positional kind slices of `phase5b-providers.test.ts` and `phase6-providers.test.ts` moved by one, as `ipReputation` follows them.
```
 Test Files  47 passed (47)      Tests  632 passed (632)      (with container.test.ts and worker.test.ts)
$ bash infra/tests/compose.test.sh --static-only      # 405 passed, 0 failed
```
Compose: `OPENVERIFY_PROVIDER_IP_REPUTATION_{SANDBOX,PRODUCTION}` and `OPENVERIFY_IP_REPUTATION_MMDB_PATH` in `x-shared-provider-environment` (the API and the worker, never migrate); `x-network-environment` (the two source lists) for the API, the worker and migrate; `x-network-sync-environment` (`OPENVERIFY_NETWORK_REFRESH`) for the worker; `x-ip-reputation-volume`, `../data/ip-reputation` mounted read-only at `/var/lib/openverify/ip-reputation` in the API and the worker. `.env.example` binds the sandbox in sandbox environments and leaves production unbound.

### N.5 The network wiring, the session start's hook and the in-memory snapshots (C92.3, C92.5, C93.1, C93.2, F15, F41)
Stubs `da7d28ba` (`network/{snapshots,reconcile,private-peers,evaluate}.ts` for `api-network`; `createInMemoryNetworkSnapshots` declared), `87be320a` (`ApiDependencies.network`, `ContainerOverrides.networkSnapshots`, `Container.networkSnapshots`, `startNetworkDataAtStart`, `StartWorkersOptions.networkSnapshots`, `ReportJobDeps.networkSnapshots`), `d6d3134d` (`Container.sessionNetwork`); RED `475c9697`; GREEN `1a4c47db`.
```
$ (cd apps/api && pnpm exec vitest run src/container.test.ts src/routes/flow/session-network.test.ts src/worker-network-startup.test.ts src/worker.test.ts src/test-support/network-snapshots-fake.test.ts src/services/context.test.ts --coverage.enabled=false)
     × serves sandbox environments every source and production none of the sandbox-only ones (H26)
     × once, in the transaction that records the start, with the network deps and the address
     × rolls the start back with a failed evaluation, so the next call starts and evaluates again
     × reconciles the sources with the lists and starts the snapshots when ready, and closes them
     × gives each session evaluation the snapshots, the API providers, the trust mode and the watch
     × gives the report runs the worker’s network snapshots, for the ip-address report (C92.3, C106.1)
     × passes on every dependency, including the Phase 2 ports, by reference
Error: not implemented: createInMemoryNetworkSnapshots (foundation-7a)
AssertionError: expected [ 'accounts', 'audit', …(21) ] to deeply equal [ 'accounts', 'audit', …(22) ]
AssertionError: expected [] to have a length of 1 but got +0
AssertionError: expected 200 to be 500 // Object.is equality
 Test Files  6 failed (6)
```
GREEN: `recordSessionStart` calls `evaluateSessionNetworkInTx(tx, deps.network, started, { ip }, at)` in its transaction, for the call that wins `markInquirySessionStarted`, before staging `inquiry-session.started`; a failure rolls the start back. The flow-session plugin and `routes/flow/index.ts` pass `deps.network`; `dependenciesOf` passes it on. The container builds the snapshots (`createNetworkSnapshots({ db, storage, clock, logger })` or the override), the watch (`warnOnPrivatePeers(logger, config.trustProxy)`) and `sessionNetwork`; when the API is ready it reconciles the source rows and starts the snapshots, waiting at most `NETWORK_READY_WAIT_MS` (5 s) and logging a failure by its name; `close()` releases them. The worker calls `startNetworkDataAtStart` before its jobs, hands the snapshots to the report runs (`ReportJobDeps.networkSnapshots`) and closes them. The harness gives every test API network deps over empty in-memory snapshots.
```
 Test Files  12 passed (12)      Tests  159 passed (159)
$ (cd apps/api && pnpm exec vitest run src/routes/flow src/app.test.ts src/server.test.ts src/services/inquiry-sessions src/openapi.test.ts --coverage.enabled=false)
 Test Files  23 passed (23)      Tests  391 passed (391)
```

### N.6 The `network-refresh` registration and the `network:sync` entry (C92.2, C107.1)
Stub `93995ca2` (`jobs/repeatable/network.ts`, `runNetworkRefresh` with `NetworkRefreshDeps` and `NetworkRefreshResult`, for `api-network`; `NETWORK_REFRESH_QUEUE`, `NETWORK_REFRESH_INTERVAL_MS`, `NetworkRepeatableDeps`, `phase7RepeatableJobs` scheduling nothing; `StartWorkersOptions.network`); RED `da75e5ef`; GREEN `7c5d45cc`.
```
$ (cd apps/api && pnpm exec vitest run src/worker.test.ts src/jobs/repeatable src/package-scripts.test.ts --coverage.enabled=false)
     × runs network:sync from scripts/network-sync.ts with the repository .env, as the other CLIs do
     × refreshes every 15 minutes when told to, with the worker’s deps
     × schedules the network refresh every 15 minutes only when told to (C92.2, Workflow 7A)
AssertionError: expected undefined to be 'tsx --conditions=@openverify/source -…'
AssertionError: expected [] to deeply equal [ { name: 'network-refresh', …(1) } ]
      Tests  3 failed | 82 passed (85)
```
GREEN: `phase7RepeatableJobs` schedules `network-refresh` every 900,000 ms with `OPENVERIFY_NETWORK_REFRESH=true`, after the Phase 6 jobs; `main()` passes `config.network`. `network:sync` in `apps/api/package.json` runs `scripts/network-sync.ts`, a stub that changes nothing and exits 1:
```
 Test Files  10 passed (10)      Tests  85 passed (85)
$ pnpm --filter @openverify/api network:sync
network:sync: not built yet; nothing was changed      [ELIFECYCLE] Command failed with exit code 1.
```

### N.7 The request-log serializer and the network log rule (C93.7, P06)
Serializer RED `cfbb49fa`, GREEN `b3d2c349`; log rule RED `9f7e1939`, GREEN `6585de4c`.
```
$ (cd apps/api && pnpm exec vitest run src/app.test.ts --coverage.enabled=false)
     × never writes credentials when a whole request, or its headers, is logged
     × logs the method, the route pattern and the request id, never the URL, a query or the address
     × names no route for a request that matched none, and still logs no URL
     × logs a flow call without its address or a query value
AssertionError: expected { Object (level, time, ...) } to match object { requestId: 'trace-c937', …(1) }
      Tests  4 failed | 23 passed (27)
```
GREEN: `serializeRequest` (`apps/api/src/logger.ts`) as the pino `req` serializer: `{ method, route }`, the route pattern or `null`; the request id stays beside it. The URL, its path values and query, the host and the client address and port are gone from every request line (the existing whole-request test pins `route` instead of `url`, with C93.7). One defect of the RED test: it scanned the whole log for `hostname`, which pino writes for the process's own host; it now scans for the request's `Host` value. `Tests 69 passed (69)` with `logger.test.ts`.

Log rule: the C53.8 rule (`packages/config/eslint/phase5-rules.js`) applies to `apps/api/src/network/**`, `apps/api/src/sync/**`, `apps/api/src/providers/ip-reputation/**`, `apps/api/src/routes/dashboard/network-sources.ts` and `packages/signals/src/**`, and refuses `ip`, `ipAddress`, a remote or client address, `lat`/`latitude`, `lon`/`longitude`/`lng`, `coordinates`, a fingerprint and `userAgent` outside `pii`:
```
$ (cd packages/config && pnpm exec vitest run src/eslint-phase5.test.ts --coverage.enabled=false)
 Tests  45 failed | 41 passed (86)      (RED)      Tests  86 passed (86)      (GREEN)
$ pnpm turbo run lint      Tasks:  15 successful, 15 total      (no existing code trips the new names)
```

### N.8 The sandbox network seed call (C92.5, C93.6, F14)
Stub `bea8c6b8` (`seed/network.ts`, `seedNetworkData` with `SeedNetworkOptions` and `SeededNetworkData`, for `api-network`; `DevSeedSettings.networkSources`, `DevSeedOptions.networkSources` and `storage`, `DevSeedResult.sandboxNetwork`); RED `e741aea3`; GREEN `f9d7b62d`.
```
$ (cd apps/api && pnpm exec vitest run src/seed/dev-seed-network.test.ts --coverage.enabled=false)
     × are read as every process reads them
     × refuse an entry that is not a source id, naming the variable only
     × imports it with the lists, the clock and the storage, and prints what it imported
     × prints why it imported nothing
AssertionError: expected { sourcesDisabled: [], …(3) } to deeply equal { …(2) }
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
      Tests  4 failed (4)
```
GREEN: `devSeedSettingsFromEnv` parses the lists with `parseNetworkSourceLists`; `seedDevEnvironment` calls `seedNetworkData(db, { sourcesDisabled, sourcesEnabled, clock, storage? })` after the report templates; `formatDevSeedResult` prints `network       <source> <outcome> (<n> entries)` or the warning; `scripts/seed-dev.ts` passes the lists. `Test Files 3 passed (3)  Tests 40 passed (40)` for `src/seed`.

### Every new column and its form (C107.5)

| Column | Form |
|---|---|
| `network_sources.*`, `network_syncs.*` | plaintext: install-wide state of public publications, never about a subject (C92) |
| `networks.ip` | sealed, row AAD `networks.ip#<net id>` (`SEALED.networkIp`) |
| `networks.location` | sealed JSON `NetworkLocation`, row AAD `networks.location#<net id>` (`SEALED.networkLocation`) |
| `networks.service_provider`, `service_type`, `proxy_type`, `threat_level`, `country_code`, `country_name`, `asn`, `hosting_asn`, `hosting_asn_confidence`, `privacy_relay`, `client_address_source`, `evaluated_at`, `reasons`, `sources` | plaintext by decision: network facts without the address (C91.4, C107.5), kept after redaction |
| `inquiry_sessions.location` | sealed JSON `NetworkLocation`, row AAD `inquiry_sessions.location#<iqse id>` (`SEALED.inquirySessionLocation`) |
| `inquiry_sessions.network_evaluated_at`, `is_tor`, `is_datacenter`, `is_vpn`, `is_proxy`, `hosting_asn`, `threat_level`, `country_code`, `country_name`, `ip_connection_type`, `network_organization` | plaintext by decision, as above |

### PGlite migration time (Risks)
`createTestDatabase()` in a fresh process: cold with an empty `OPENVERIFY_TEST_DB_CACHE_DIR` (it migrates and stores the template), then warm (the stored template). Each take is one hold of `/tmp/openverify-e2e.lock`, loads beside it. Script: the session scratchpad's `f7a/pglite-time.mts` and `run.sh`.

| Tree | Cold (ms), three takes | Warm (ms) | Load (1 min) |
|---|---|---|---|
| Base `8b7182e2` (Stage 1a's 0023), first takes | 5,698 · 6,902 · 9,134 | 1,266 · 1,409 · 1,169 | 2.80 to 7.89 (other agents' suites) |
| Base `8b7182e2`, retaken in a worktree at the head's load | 3,685 · 3,563 · 3,662 (median 3,662) | 629 · 613 · 627 (median 627) | 1.19 to 1.40 |
| Head `f9d7b62d` (0023 with (N)) | 3,680 · 3,720 · 3,666 (median 3,680) | 611 · 650 · 618 (median 618) | 1.42 to 1.66 |

At the same load the (N) extension costs about 18 ms cold and nothing measurable warm; every PGlite hook stays far inside its 120 s guard. The first base takes are not comparable: they ran while other agents' suites raised the load to 7.9.

### Checkpoint (N) gates (foreground)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | lockfile up to date; no `minimumReleaseAgeExclude` |
| `pnpm typecheck && pnpm lint && pnpm format:check` | 15 of 15 tasks each; Prettier clean |
| `pnpm turbo run test --filter='!@openverify/api'` (82 s, load 1.2 to 10.6) | db 1,056 (95.68% statements), contracts 2,272 (99.03%), core 787 (99.85%), checks 3,464 (98.74%), watchlist 718 (98.62%), dashboard 3,945 (98.71%), flow 1,022 (96.36%), node 252 (98.87%), emrtd 318 (94.97%), signals 184 (96.31%), config 142 (100%), e2e 97 (96.81%), ui 54 (100%), flow-spec (100%); 14 of 14 tasks |
| API suite: `--shard=1/2` (215 s, load 9.0 to 11.4), `--shard=2/2` (180 s, load 9.6 to 9.7), `--merge-reports --coverage` | 330 files, 4,606 passed; 96.36% statements, 88.57% branches, 97.93% functions, 96.4% lines |
| `pnpm test:integration` (278 s, load 9.4 to 15.2) | db 65 in 14 files; api 159 in 28 files |
| `bash infra/tests/ci-workflow.test.sh` | 207 passed |
| `bash infra/tests/compose.test.sh --static-only` | 405 passed |
| `pnpm --filter @openverify/watchlist benchmark:typecheck` and `benchmark:test` (`@openverify/db/testing` gained helpers) | clean; 119 passed in 12 files |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` | 69 passed (21.8 s, load 5.9) |
| full stack, `--shard=1/3`, `2/3`, `3/3` (each its own lock hold, with the build) | 31 passed (3.3 min, load 7.4); 31 passed (5.8 min, load 8.0); 29 passed (5.1 min, load 5.2): 91 in all |

The `IpReputationAnswer` refactor (`1d2ea46f`) came after the gates: it changes one port type that nothing implements yet; `tsc` and `eslint` of the API and the provider tests (`6 passed`) were run again on it.

Checkpoint (N) ends at `1d2ea46f` (and this record).

## Checkpoint (S): signals and devices

Base `e0c264dc` (the end of (N)). Every unit went stub (where a test needed a name), RED (it compiles, type-checks and lints, and fails for its reason), GREEN. Commands ran after `source scripts/env.sh`; output is trimmed to what matters.

### S.1 Migration 0023 extended: the signal and device tables and columns (C90.5, C90.6, C91.1, C91.2, C94.2, C94.4)
RED `032b741c`; GREEN `d815211e`; the snapshot in the repository format `0d0523d3`.

RED (`src/phase7-signal-tables.test.ts`, new; the pinned lists of `testing.test.ts`, `schema-v2.test.ts` and `migrate.test.ts` changed with the plan; the upgrade test extended):
```
$ (cd packages/db && pnpm exec vitest run src/phase7-signal-tables.test.ts src/testing.test.ts src/migrate.test.ts src/schema-v2.test.ts --coverage.enabled=false)
AssertionError: devices: expected 'CREATE TABLE "network_sources" (…' to contain 'CREATE TABLE "devices"'
AssertionError: expected [ 'accounts.fields:row', …(41) ] to deeply equal [ 'accounts.fields:row', …(43) ]
AssertionError: expected [Function] to throw error matching /devices_platform_valid/ but got 'relation "devices" does not exist'
 Test Files  4 failed (4)      Tests  36 failed | …
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0023.integration.test.ts)
Caused by: error: relation "inquiry_session_signals" does not exist
Caused by: error: column i.signals does not exist
      Tests  2 failed (2)
```
GREEN: `tables/signals.ts` (`inquiry_session_signals`, `inquiry_signal_computations`, `devices`, `session_devices`); `inquiries.signals` and `signal_details`; `inquiry_template_versions.signal_config`; the session's parsed device fields, `signals_collected` and `signal_bodies_dropped` with their checks. Then, as amendment 10 of Stage 1a says: core rebuilt, 0023 and its snapshot and journal entry removed, `drizzle-kit generate --name phase7a`, and the hand edits re-applied (the session's `(environment_id, id)` key before the first foreign key that needs it, now three; the `updated_at` triggers, now four with `devices` and `inquiry_signal_computations`). Every (N) statement is in the new file (checked by a sorted diff). The sealed columns joined `ENCRYPTED_COLUMNS`, `SEALED` and `REWRAP_TABLES` (`inquiry_session_signals` among the identity-keyed tables); `createTestInquiryOnEarlierSchema` writes the inquiry by SQL now that `inquiries` gained columns; new helpers `seedSessionSignalBody`, `seedDevice`. Two RED defects fixed: an unknown platform also broke the identifier check, so the check now applies per platform; the rewrap test needed a seeded body.
```
 Test Files  82 passed (82)      Tests  1103 passed (1103)      (db unit)
 Test Files  5 passed (5)        Tests  15 passed (15)          (0023, v3, v5, 0017, 0018 upgrade tests on Postgres 17)
```

### S.2 Redaction of the (S) data and the `dev` prefix (C91.4, C107.5)
RED `8deb0073`; GREEN `67e3ebdb`.
```
$ (cd packages/db && pnpm exec vitest run src/repositories/redaction.test.ts src/repositories/subject-ids.test.ts --coverage.enabled=false)
     × nulls the signal bodies, unlinks the session from its devices, deletes each device left without a session, and stubs and forgets the devices (C91.4, C107.5)
AssertionError: expected [ 'inq', 'ver', 'iqse', 'acc', …(3) ] to deeply equal [ 'inq', 'ver', 'iqse', 'acc', …(4) ]
      Tests  2 failed | 13 passed (15)
$ (cd apps/api && pnpm exec vitest run src/services/redaction.test.ts --coverage.enabled=false)
     × leaves nothing of the subject in any table or in storage
AssertionError: expected '[{"id":"acc_…' not to contain 'Zyxw-synthetic-pii'
      Tests  1 failed | 24 passed (25)
```
GREEN: `redactInquiryRecords` nulls the bodies' `components` and `behaviour`, deletes the sessions' device links, deletes each device left with no link, and stubs and forgets the device ids; `dev` joins `REDACTION_SUBJECT_ID_PREFIXES`. One RED defect: the test linked one session to two devices, which the primary key forbids; the subject now has a second session. `Tests 15 passed (15)`; `Tests 25 passed (25)`.

### S.3 The signal settings and the C91.7 retention steps (C90.8, C91.7, P19)
db stub `1dc1130a`, RED `caa50b18`; API stub `594a5039`, RED `8c154ff5`; GREEN `c4ceab1c`.
```
$ (cd packages/db && pnpm exec vitest run src/repositories/signal-retention.test.ts --coverage.enabled=false)
     × take what the environment set, key by key
     × nulls the components past the window and keeps the behaviour aggregates
AssertionError: expected +0 to be 1 // Object.is equality
      Tests  5 failed | 2 passed (7)
$ (cd apps/api && pnpm exec vitest run src/services/retention.test.ts --coverage.enabled=false)
     × nulls old collector components and addresses, and deletes unseen devices, each by its window
      Tests  1 failed | 18 passed (19)
```
GREEN: `resolveSignalSettings`; `nullExpiredSignalComponents`, `nullExpiredAddresses` (session, consent and network addresses; `ip-retention-days` unset keeps them) and `deleteExpiredDevices`, each by its environment's window, drained by `runRetention` with three new counts. One RED defect: the "fresh" session's real creation time was two months before the test's `NOW`; it is now aged six days. `Tests 12 passed (12)` (db), `Tests 43 passed (43)` (API retention, run and job).

### S.4 `identifierKey`, the key id and `rebuildDeviceIndexes` (C94.4, P09)
Stub `91eaa8c2`; RED `250aa7f0`; GREEN `6fb81500`. The vectors come from OpenSSL 3.0.13, independently of Node (the commands are in the test's header).
```
     × matches the OpenSSL vector for browser-fingerprint
     × is the 11-character base64url id of the key, as the OpenSSL vector gives
     × rebuilds the device HMACs too, through rebuildDeviceIndexes, before the reports (C94.4)
AssertionError: expected { scanned: 2, updated: +0, …(4) } to have property "devices.scanned"
```
GREEN: `identifierKey` (`HMAC(environment subkey, "<label>|<input>")`), `blindIndexKeyId` (8 bytes, base64url, 11 characters); `blind-index:rebuild` calls `rebuildDeviceIndexes` before the reports. `Tests 45 passed (45)`; `Tests 11 passed (11)`.

### S.5 The transition, session-start and cap hooks (C90.5, C91.5, C93.2, C94.5)
Stub `48236efe`; RED `22663b78`; GREEN `34d558a1`.
```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/session-signal-hooks.test.ts src/services/signal-computation-hook.test.ts --coverage.enabled=false)
     × on the first move into completed, pending
     × once, in the transaction that records the start, with the user agent
     × refuses resume at the cap (refuse) with 409 session_limit_reached, creating no session; only an expiry commits
AssertionError: expected [] to deeply equal [ { trigger_status: 'expired', …(1) } ]
AssertionError: expected 200 to be 409 // Object.is equality
      Tests  19 failed | 8 passed (27)
```
The redacted cases (a redacted `created` or `pending` inquiry expiring through the sandbox, and through the expiry job) passed at RED, as they must: no row is ever written there, and they guard the GREEN. GREEN: `createSignalComputationInTx` in `transitionInquiryInTx` (`createSignalComputation`, once per inquiry, none for a redacted one); `recordSessionDeviceInTx` in `recordSessionStart`'s transaction; `assertSessionCapInTx` in `resumeInquiry` and `redeemOneTimeLink` (after the token, under the inquiry lock): a plain refusal rolls back, an expiry commits and dispatches, both answer 409 `session_limit_reached`. One RED defect: the cap receives the whole pinned settings, so the test matches its two keys. `Tests 27 passed (27)`, with the one-time-link, simulate, actions and expiry suites green.

### S.6 The `inquiry-signals` queue, worker and sweep (C90.5, C107.1, C107.2)
Stub `3c62810c`; RED `26b30c1d`; GREEN `c736c874`.
```
     × enqueues one job per inquiry under the inquiry id, with the ids only
     × sweeps every 15 seconds whenever the worker has the signals producer, with the worker's deps
     × starts both only with the signals producer
Error: the inquiry-signals producer is not built yet (foundation-7a)
AssertionError: expected error to be instance of TypeError
```
GREEN: `createInquirySignalsQueue` (job id = inquiry id, ids only, lazy BullMQ queue, finished jobs removed); `inquirySignalsProcessor` (permanent failures unrecoverable); `startWorkers` with `signals` starts `inquiry-signals` and `phase7RepeatableJobs` schedules `inquiry-signals-sweep` every 15 s before `network-refresh`; the worker's `main` builds and closes the producer. `Tests 98 passed (98)`.

### S.7 `signal-config` (C90.6, C90.7, C94.6)
Stub `ede68da0`; RED `e49b3b52`; GREEN `327bea0e`.
```
     × serves the defaults, stored as {}, for a version that sets none
     × answers a refusal with its code and pointers, leaving the draft a draft
AssertionError: expected 200 to be 422 // Object.is equality
      Tests  6 failed (6)
```
GREEN: stored as sent on drafts and updates (`{}` for version 1), served resolved on every version; `assertPublishable` gives it with the flow and environment to `signalConfigPublishProblems` (`api-signals`), whose first code answers with every pointer. `Tests 61 passed (61)` with the version, template and Phase 5 publish suites.

### S.8 The settings served (C90.8, C91.7, C107.7)
RED `d3786e00`; GREEN `eac5843e`.
```
AssertionError: expected { 'require-mfa': false, …(9) } to match object { 'signal-collection': { …(3) }, …(4) }
AssertionError: expected 400 to be 422 // Object.is equality
AssertionError: expected 400 to be 403 // Object.is equality
      Tests  6 failed | 5 passed (11)
```
GREEN: `signal-collection` (with `settings:privacy`; `exempt` without a basis is 422 `basis_required`), `expose-signals` and the three windows, served with their defaults, set and audited; the contracts' pinned defaults gained them; the dashboard's retention-field type leaves them to 7C; the OpenAPI snapshot. `Tests 33 passed (33)`.

### S.9 The session's attributes, relationships, includes and masking (C91.1-C91.3, C91.6, C107.5, C107.6)
RED `07bec612`; GREEN `a25e947a`.
```
     × as nulls, [] and empty relationships before anything was evaluated
     × includes both resources, and only those asked for
     × nulls every PII_SIGNAL_ATTRIBUTES member of a resource, keeping the derived facts
AssertionError: region-code: expected 'value' to be null
```
GREEN: every session read serves the network facts, the parsed device and `signals-collected`, and the `device` and `network` relationships (`listSessionLinks`); `?include=device,network` (`listSessionDevices`, `getDevice`, `listSessionNetworks`); `PII_SIGNAL_ATTRIBUTES` in `MASKED_ATTRIBUTES` and the API-log set; the session events carry both resources in `included`. The existing list test that pins the whole session resource gained the (S) members (C91.1).

### S.10 The inquiry's `signals` and `signal-details` (C90.5, C90.8, H23)
Stub `35484f81`; RED `0e94bb04`; GREEN `250b5c19`.
```
AssertionError: expected { status: 'created', …(9) } to match object { signals: [], …(1) }
      Tests  3 failed (3)
```
GREEN: `servedInquirySignals` in every inquiry record (API, list, webhooks), `[]` and `{ computed-at: null }` until computed; `signalViewOf` reads `expose-signals` for the API and webhooks; the console shows the values whatever the setting. The stub commit carried one lint error (an unnecessary assertion), gone in the GREEN.

### S.11 The frozen routes, the `flow-signals` policy and the flow session member (C91.2, C91.5, C94.2, C94.6, C107.3, F28)
Stub `c4fc7a48`; RED `285f1e95`; GREEN `ceaf936c`.
```
AssertionError: expected 404 to be 501 // Object.is equality
AssertionError: expected [] to include 'flow-signals'
AssertionError: expected { inquiry: { …(2) }, …(5) } to have property "signals" with value null
      Tests  8 failed (8)
```
GREEN: `routes/server/devices.ts`, `routes/flow/signals.ts` (8 KiB, 202, the bounded header facts), `expire-all` with `meta.inquiry-ids`, `POST /inquiry-sessions/:id/generate-one-time-link`, each calling its `api-signals` stub (501); `flow-signals` enforced per session; `GET /flow/session` serves `signals` through `flowSessionSignalsOf` (`null` until built); the OpenAPI snapshot. The dashboard's expire-all action narrowed for the union body (`2fb99352`).

### S.12 The flow's wiring (C94.2, C94.3, C94.6, F06, P14)
Stub `8150c17b`; RED `05538418`; GREEN `4468bbbe`.
```
     × POSTs the body as JSON to /flow/signals and resolves on the 202
     × starts after consent with the reported tiers, tells it each screen, and posts through the client
Error: sendSignals is not wired yet (foundation-7a)
AssertionError: expected [] to have a length of 1 but got +0
```
GREEN: `useSignalCollection` in `FlowRenderer` starts `startSignalCollection` only once the session reports consent, with the reported tiers and a `send` through the client, tells it each screen, and stops it on unmount; `FlowApiClient.sendSignals`; the mocked flow API answers 202 to signal bodies and keeps them out of the counted requests. One RED defect: the wrapped client passes `(body, undefined)`, so the test reads the body argument. `Test Files 68 passed (68)  Tests 1028 passed (1028)` (flow unit).

### Every new column and its form (C107.5)

| Column | Form |
|---|---|
| `inquiry_session_signals.components` | sealed, row AAD `inquiry_session_signals.components#<iqse id>/<sequence>` (`SEALED.sessionSignalComponents`) |
| `inquiry_session_signals.behaviour` | sealed, row AAD `inquiry_session_signals.behaviour#<iqse id>/<sequence>` (`SEALED.sessionSignalBehaviour`) |
| `inquiry_session_signals.sequence`, `screen`, `platform`, `collector_version` | plaintext: the step id and the client's own counters, no value |
| `inquiry_signal_computations.*` | plaintext: states, counts and codes |
| `devices.browser_fingerprint`, `device_fingerprint`, `device_class` | 64-hex HMACs under the environment subkey (`identifierKey`), with `key_id` |
| `devices.platform`, `collector_version`, `fingerprint_randomised`, `key_id`, `first_seen_at`, `last_seen_at` | plaintext by decision |
| `session_devices.*` | ids only |
| `inquiries.signals`, `signal_details` | plaintext jsonb by decision: counts, levels, a country code and distances (C90.5) |
| `inquiry_template_versions.signal_config` | plaintext configuration |
| `inquiry_sessions.os_name`, `os_full_version`, `browser_name`, `browser_full_version`, `device_type`, `device_name`, `mobile_sdk_name`, `mobile_sdk_full_version`, `signals_collected`, `signal_bodies_dropped` | plaintext by decision: facts parsed from the sealed user agent, kept after redaction as the network facts are |

### PGlite migration time (Risks)
The same script and method as (N); one lock hold per take.

| Tree | Cold (ms) | Warm (ms) | Load (1 min) |
|---|---|---|---|
| Before: head `e0c264dc` (0023 with (N)) | 3,954 · 3,948 · 4,061 (median 3,954) | 670 · 728 · 682 (median 682) | 1.44 to 1.60 |
| After: 0023 with (N) and (S) | 4,345 · 3,742 · 4,062 (median 4,062) | 616 · 616 · 679 (median 616) | 0.70 to 2.28 |

The (S) extension costs about 108 ms cold at these loads and nothing measurable warm; every PGlite hook stays far inside its 120 s guard.

### Checkpoint (S) gates (foreground)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | lockfile up to date; no `minimumReleaseAgeExclude` |
| `pnpm typecheck && pnpm lint && pnpm format:check` | 15 of 15 tasks each (after `2fb99352` and `0d0523d3`); Prettier clean |
| `pnpm turbo run test --filter='!@openverify/api'` (250 s, load 2.1 to 12.7) | db 1,120 (95.04% statements), contracts 2,277 (98.98%), core 787 (99.85%), checks 3,464 (98.74%), watchlist 718 (98.62%), dashboard 3,945 (98.71%), flow 1,028 (96.35%), node 252 (98.87%), emrtd 318 (94.97%), signals 184 (96.31%), config 142 (100%), e2e 97 (96.81%), ui 54 (100%), flow-spec 117 (100%); 14 of 14 tasks |
| API suite: `--shard=1/2` (205 s, load 9.5 to 8.8), `--shard=2/2` (165 s, load 6.8 to 8.0), `--merge-reports --coverage` (4 s) | 357 files, 4,835 passed; 96.31% statements, 88.58% branches, 97.9% functions, 96.35% lines |
| `pnpm test:integration` (208 s, load 7.1 to 11.6) | db 65 in 14 files; api 166 in 29 files |
| `bash infra/tests/ci-workflow.test.sh` | 207 passed |
| `bash infra/tests/compose.test.sh --static-only` | 405 passed |
| `benchmark:typecheck` and `benchmark:test` (`@openverify/db/testing` gained helpers) | clean; 119 passed in 12 files |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` | 69 passed (17.9 s, load 6.6 to 8.3) |
| full stack, `--shard=1/3`, `2/3`, `3/3` (each its own lock hold, with the build) | 31 passed (2.3 min, load 7.0 to 2.4); 31 passed (4.7 min, load 2.2 to 1.6); 29 passed (4.6 min, load 2.1 to 1.9): 91 in all |

Checkpoint (S) ends at `0d0523d3` (and this record).

## Checkpoint (H): handoff

Base `06020103` (the end of (S)). Every unit went stub (where a test needed a name), RED (it compiles, type-checks and lints, and fails for its reason), GREEN. Commands ran after `source scripts/env.sh`; output is trimmed to what matters. Other agents committed beside this checkpoint (api-signals, api-network, client-collector); only the commits named here are this checkpoint's.

### H.1 Migration 0023 extended: the handoff tables and columns (C91.1, C96.2-C96.4, C96.7, V02, V03, V05)
RED `159a4f04`; GREEN `fe339ff1` (format `ad84fc7f`).

RED (`src/phase7-handoff-tables.test.ts`, new; the 0023 assertion of `migrate.test.ts` and the public table list of `testing.test.ts` changed with the plan; the upgrade test `migration-0023.integration.test.ts` extended):
```
$ (cd packages/db && pnpm exec vitest run src/phase7-handoff-tables.test.ts src/migrate.test.ts src/testing.test.ts --coverage.enabled=false)
     × extends 0023 with the Workflow 7A (H) handoff tables and columns, no table recreated (C96, V02, V03)
     × stores the token as its digest only, bound to the inquiry, the step and the issuing session
     × keeps at most one live token per issuing session: a new one needs the old one revoked or redeemed (C96.2)
     × refuses an unconfirmed destination without a code (V16)   (and every other token, step and session check)
     × applies every migration, including the pgvector extension
AssertionError: handoff_tokens: expected 'CREATE TABLE "network_sources" (\n\t"…' to contain 'CREATE TABLE "handoff_tokens"'
error: relation "handoff_tokens" does not exist
error: column "device_handoff_method" of relation "inquiry_sessions" does not exist
AssertionError: expected [ 'account_relations', …(65) ] to deeply equal [ 'account_relations', …(67) ]
      Tests  30 failed | 87 passed (117)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-0023.integration.test.ts)
     × creates the network, signal, device and handoff tables on an empty database; a session takes its rows with it
     × upgrades a database at 0022 with rows in it: the session keeps its row, its facts and signals start empty
Caused by: error: column "device_handoff_method" of relation "inquiry_sessions" does not exist
      Tests  2 failed (2)
```
GREEN: `tables/handoffs.ts` (`handoff_tokens`, `inquiry_handoff_steps`, `HANDOFF_STATE_VALUES`), `HANDOFF_METHOD_VALUES` and the session columns in `tables/inquiries.ts`, `created_by_session_id` and `from_rejected_handoff` in `tables/verifications.ts`, `created_by_session_id` in `tables/selfie.ts`. Then 0023 regenerated with the (S) script plus the two new triggers (`scratchpad/f7a/h/regen.sh`): core built, the file, snapshot and journal entry 23 removed, `drizzle-kit generate --name phase7a`, the session unique key moved before the first foreign key that needs it (now the self-reference and the handoff and creator keys too), and six `set_updated_at` triggers. A sorted line diff against the (S) file shows every earlier statement kept and only additions. The session literal and the verification literal of `apps/api/src/jobs/records.test.ts` gained the new fields (the typecheck minimum).
```
 Test Files  5 passed (5)      Tests  185 passed (185)    (with phase7-signal-tables and phase7-network-tables)
      Tests  2 passed (2)    (the upgrade test on Postgres 17)
```

### H.2 `getEffectiveConsent`, the creating session and the handoff-token retention in the db (C94.6, C96.2, V02, V03, P27)
Stub `1556ea92` (`repositories/handoff-tokens.ts` for `flow-handoff`, `ConsentHolder` and `getEffectiveConsent` returning the inquiry-level read, `createdBySessionId` on `NewVerificationInput` and `NewSelfieCapture`, `SelfieCapture.createdBySessionId`, `deleteExpiredHandoffTokens` answering 0); RED `b997a8af`; GREEN `ee703835`.
```
$ (cd packages/db && pnpm exec vitest run src/repositories/handoff-plumbing.test.ts --coverage.enabled=false)
     × gives a phone session only its own consent: never the desktop one (V03, P01)
     × keeps a phone on its own consent even when the desktop consented later
     × lets a rejected phone's consent authorise nothing, for the phone and for the desktop (V02, V03)
     × records the flow session that created a verification and a selfie capture
     × deletes tokens 30 days past their expiry, used or not, and keeps the younger ones
AssertionError: expected { …(6) } to be null
AssertionError: expected { …(14) } to match object { …(2) }
AssertionError: expected +0 to be 1 // Object.is equality
      Tests  5 failed | 4 passed (9)
```
GREEN: `getEffectiveConsent(db, { environmentId, inquiryId, sessionId })` gives a session a handoff created (`handoff_from_session_id` set) its own consent, or `null` once `handoff_rejected_at` is set; every other holder (another session, or `null` for an act no flow session made) gets the latest consent among the inquiry's sessions, leaving out rejected handoff sessions. With no handoff session it equals `getLatestInquiryConsent` (a test pins that for every holder). `createVerification` and `createSelfieCapture` write `created_by_session_id`; `deleteExpiredHandoffTokens` deletes tokens 30 days past `expires_at`, as one-time links. `Tests 58 passed` over the touched repository files.

### H.3 Every consent gate reads `getEffectiveConsent`; the flow writes the creating session; the C16 pass deletes tokens (C94.6, C96.2, V02, V03)
Stub `f2eccfaf` (`matchingConsentHolds(db, holder, flow)`, `messageLocaleOf(deps, holder)`, the OTP send passing its session, `RetentionReport.deletedHandoffTokens`, still the inquiry-level read); RED `79cfc6d8`; GREEN `d17b5b94`.
```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/handoff-consent.test.ts --coverage.enabled=false)
     × records the session that created a verification and a selfie capture
     × serves the phone no consent on GET /flow/session until it consents itself
     × refuses the phone an upload and a selfie capture on the desktop's consent
     × refuses the phone the C52.1 preconditions on the desktop's consent
     × holds matching consent by the capture session: the desktop ticked it, the phone declined it
     × writes the OTP message in the asking session's language
AssertionError: expected null to be 'iqse_01M66YSF7NJGW48RSENBH37KAR'
AssertionError: expected { Object (accepted-at) } to be null
AssertionError: expected 'A selfie pose names its capture: crea…' to match /consent/i
AssertionError: promise resolved "{ inquiry: { …(21) }, …(1) }" instead of rejecting
AssertionError: expected true to be false
AssertionError: expected 'en' to be 'es'
      Tests  6 failed (6)
$ (cd apps/api && pnpm exec vitest run src/services/retention.test.ts -t "handoff tokens" --coverage.enabled=false)
     × deletes handoff tokens 30 days past their expiry and keeps the younger ones (C96.2, P27)
AssertionError: expected +0 to be 1 // Object.is equality
```
GREEN: `getFlowSession` (and the `signals` member it feeds, the (S) follow-up), `uploadFile`, `createFlowSelfieCapture`, `requireFlowVerification` (`services/flow-preconditions.ts`), `messageLocaleOf` (`services/otp/context.ts`) and `matchingConsentHolds` (`jobs/selfie.ts`, by the capture's `created_by_session_id`; the face-index rebuild by its newest processed capture's) read `getEffectiveConsent`; `consentHolderOf(session)` (`services/flow.ts`). `createFlowVerification` and `createFlowSelfieCapture` write `created_by_session_id`. `runRetention` drains `deleteExpiredHandoffTokens`. `Test Files 26 passed  Tests 434 passed` (the flow routes and the retention, face-index and selfie job tests), then `22 passed / 215` (OTP, face-index, job types, flow and submit services, retention run).

### H.4 `organization-display-name` (C107.7, F30, decision 52)
RED `b7e11537`; GREEN `5326c523`.
```
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard/settings-handoff.test.ts --coverage.enabled=false)
     × is served as null until set
     × is set on the environment under settings:write, audited, and cleared with null
AssertionError: expected { 'require-mfa': false, …(14) } to match object { 'organization-display-name': null }
      Tests  2 failed | 2 passed (4)
```
GREEN: the setting in `dashboardSettingsSchema` (optional, nullable), `DASHBOARD_SETTINGS_DEFAULTS` (`null`) and the update body (`organizationDisplayNameSchema`, 1-100 characters), `EnvironmentSettings['organization-display-name']`, served by `getDashboardSettings` and set with the other `settings:write` keys, audited as `settings.updated`. The pinned defaults of `dashboard-api.test.ts` changed with the plan; the console's `RetentionSetting` leaves the key out (`HandoffSetting`, typecheck minimum) until 7C. `Tests 37 passed` (the three settings files), contracts `45 passed`.

### H.5 The frozen handoff routes and the shared hooks (C96.1, C96.3, C96.5, C107.3, C107.8, F13)
Stubs `c9163e34` (`services/handoff/{flow-handoffs,flow-session,guard,review}.ts`, `services/publish/handoff.ts`, `ApiConfig.handoff`, `ApiDependencies.handoffSendsPerHour`) with the dependency-key fix `8b93dbf6` (the stub commit's own typecheck break, caught after it); contracts RED `02f2c2e0`, GREEN `22321e9e` (`createHandoffResponseSchema` takes `confirmation-code`); RED `79645052`; GREEN `c6756fa7`; fix `a6c3cb8f` (continue-here and reject answer the state, decline a JSON `null`, because the flow transport reads a JSON body on every success); compose and `.env.example` `35024fa2`.
```
$ (cd apps/api && pnpm exec vitest run src/services/handoff-hooks.test.ts src/config-handoff.test.ts src/routes/handoff-routes.test.ts --coverage.enabled=false)
     × read OPENVERIFY_HANDOFF_SENDS_PER_HOUR                     × refuse 0, naming the variable  (and -1, many, 100001)
     × is asked after every applied move, and asks for nothing until built
     × follows a move into completed with completed -> needs_review when it answers so
     × run on create with the flow and the environment, and refuse nothing until built
     × answer the first problem's code with every pointer
     × take the session token and answer 501 until flow-handoff builds them
     × counts an issue under flow-handoffs per session and flow-handoffs-ip per address (C107.3)
     × preview takes no session token, answers 501 until built, and is counted under one-time-link-redeem  (decline, redeem)
     × serves both from flowSessionHandoffOf, given the pinned flow and the session
     × refuses every non-GET flow route of a handed-off session with 409 session_handed_off, except the handoff routes
     × lets every route through while the session is not handed off
AssertionError: expected 200 to be 40
AssertionError: expected 404 to be 501
AssertionError: expected [] to deep equally contain { name: 'flow-handoffs', …(3) }
AssertionError: POST /api/v1/flow/consent: expected 400 to be 409
AssertionError: expected 'completed' to be 'needs_review'
AssertionError: expected 201 to be 422
      Tests  21 failed | 2 passed (23)
```
GREEN: `routes/flow/handoffs.ts` (registered in `routes/flow/index.ts`); `FLOW_HANDOFFS_ROUTE` and `HANDOFF_TOKEN_ROUTES` in `plugins/rate-limit.ts` (`one-time-link-redeem` per address for preview, decline and redeem; `flow-handoffs-ip` per address and `flow-handoffs` per session on issue); `assertSessionNotHandedOff` in `auth/flow-session.ts`, run after the session is resolved and before its start is recorded; `flowSessionHandoffOf` in `getFlowSession`; `handoffReviewAfterTransitionInTx` in `transitionInquiryInTx`; `handoffPublishProblems` in `assertPublishable`; `OPENVERIFY_HANDOFF_SENDS_PER_HOUR` read before the issues are checked (the first GREEN read it after them, so a bad value passed: fixed before the commit). `Test Files 38 passed  Tests 680 passed` (with the config, app, signal-route, flow-route, template and plugin tests).

### H.6 The flow's wiring (C96.1, C96.3, C96.5, F01, P15)
Stub `afcee82d` (`HandoffRedeemFlow` and `DeviceHandoffStep` for `flow-handoff`, the `handoff` bootstrap result and start, the `handoff` position, the four handoff calls of `FlowApiClient` rejecting "not wired yet", the fake answering them, the fixtures' members; the submit test's client fake gained the calls); RED `efaacf11`; GREEN `f92c09eb`.
```
$ (cd apps/flow && pnpm exec vitest run src/handoff-wiring.test.tsx src/session/session-bootstrap.test.ts src/flow/flow-position.test.ts src/api/flow-api-client.test.ts --coverage.enabled=false)
     × reads the handoff link for the phone, which redeems it only on Continue
     × explains a reload after a handoff link instead of calling the link missing
     × stops at the step while the handoff is pending, in its own slot (Stage 1b (H))   (issued, rejected, declined)
     × stops at the step, with no state, when the server serves none
     × POSTs an issue to /flow/handoffs and returns its answer
     × renders HandoffRedeemFlow from FlowRoutes with its inquiry, token, transport and connect
     × renders DeviceHandoffStep for a step not done, with its step, state, client and onDone
AssertionError: expected { kind: 'unsupported', …(2) } to deeply equal { kind: 'handoff', …(2) }
Error: continueHandoffHere is not wired yet (foundation-7a)
TestingLibraryElementError: Unable to find an element with the text: handoff redeem screen.
      Tests  15 failed
```
GREEN: a `handoff-token` fragment boots into `{ status: 'handoff' }` (the token in memory only, an older stored session dropped, the reload marker kept); `App` and `FlowRoutes` render `HandoffRedeemFlow` with the transport and `connect`; `resolveFlowPosition` answers `{ kind: 'handoff', step, handoff }` for a step not done (the Stage 1a test that read `unsupported` changed with the plan); `FlowRenderer` renders `DeviceHandoffStep` there with `onDone` = the session reload; `FlowApiClient` makes the four calls; the mocked flow API serves `handoff` and `handoff-context` when set and answers the seven handoff routes as scripted (`handoffAnswers`), else 501, recording `handoffCalls`. Flow unit: `Test Files 70 passed  Tests 1051 passed`.

### H.7 The session's handoff fields on every read (C91.1, C96.4, C96.7)
RED `3f1a50dc`; GREEN `a5d34d78`.
```
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-session-handoff.test.ts --coverage.enabled=false)
     × are null on a session no handoff created
     × serve the redeemed session its method, issuing session, time and distance facts, unmasked
AssertionError: expected { status: 'active', …(34) } to match object { 'device-handoff-method': null, …(5) }
      Tests  2 failed (2)
```
GREEN: `inquirySessionResource` passes `sessionHandoffRecordOf(session)`, so every read, list and session event serves the six attributes. The whole-resource expectation of the session list test changed with the plan. `Test Files 6 passed  Tests 356 passed` (with the webhook tests).

### H.8 The OpenAPI snapshot after the last checkpoint
`5cfcc830`: `pnpm --filter @openverify/api openapi:write` on a clean tree (`Snapshots 1 updated`); the diff adds the seven `/api/v1/flow/handoffs*` paths, the `handoff` and `handoff-context` members, the session handoff attributes and `organization-display-name`, and drops nothing else.

### H.9 Two defects the gates found, fixed test-first
- **The (N) lint scope (`c7085f0c`, RED `77f99f31`, refactor `a46ee8f6`).** `pnpm turbo run lint typecheck --force` failed `@openverify/signals#lint` with 29 regexp style errors (`prefer-d`, `use-ignore-case`, `no-useless-non-capturing-group`) in `network-data`'s finished parsers. Cause: checkpoint (N) (`6585de4c`) put the network folders in `PHASE5_FOLDERS`, which also applies eslint-plugin-regexp's recommended style rules; `network-data` committed its parsers before that, and the (N) and (S) lint gates read turbo's cache for the package (run without `--force`). The network folders now have their own entry, `WORKFLOW_7A_NETWORK_FOLDERS`, with the C93.7 log rule and the two super-linear rules, not the style rules. RED: `× leaves the regexp style rules out of the Workflow 7A network folders … (5 files)`; GREEN `Tests 152 passed`.
- **Upgrade tests on earlier schemas (`f852b7c1`).** `pnpm test:integration` failed three db upgrade tests (`migration-v5`, `-0017`, `-0018`): `column "created_by_session_id" of relation "verifications" does not exist`, because drizzle names every column of the table in an insert. They now seed the pre-upgrade verification with `createTestVerificationOnEarlierSchema` (SQL), as (S) did for inquiries. `Test Files 3 passed  Tests 11 passed`.

### Every new column and its form (C107.5)

| Column | Form |
|---|---|
| `handoff_tokens.token_hash` | 64-hex SHA-256 of the `ovh_` token; never the token |
| `handoff_tokens.confirmation_code_hash` | 64-hex SHA-256 over the token and the six-digit code: unreadable without the token, which is not stored |
| `handoff_tokens.id`, `environment_id`, `inquiry_id`, `issuing_session_id`, `step_id`, `method`, `code_attempts`, `destination_confirmed`, `expires_at`, `redeemed_at`, `redeemed_session_id`, `revoked_at`, `declined_at` | plaintext: ids, states and times; the destination is never stored |
| `inquiry_handoff_steps.*` | plaintext: the step id and its state |
| `inquiry_sessions.device_handoff_method`, `handoff_from_session_id`, `handoff_redeemed_at`, `handoff_distance_meters`, `handoff_country_changed`, `handoff_asn_changed`, `handoff_rejected_at` | plaintext by decision: a method, an id, times, whole meters and booleans (R-tier facts without the addresses), kept after redaction |
| `verifications.created_by_session_id`, `from_rejected_handoff`; `selfie_captures.created_by_session_id` | plaintext: an id and a flag |

No new sealed column, so `ENCRYPTED_COLUMNS`, `SEALED` and `REWRAP_TABLES` are unchanged. No new redaction subject: the tokens are digests, and the session's handoff facts are derived; `hnd` is not a redaction prefix (C107.5 names none). The destination (`PII_HANDOFF_ATTRIBUTES`) is masked in the API-log set since (S); flow routes are not API-logged (C12: server API requests only).

### PGlite migration time (Risks)
The same script and method; one lock hold per take, base and head interleaved (base: a worktree at `06020103`).

| Tree | Cold (ms) | Warm (ms) | Load (1 min) |
|---|---|---|---|
| Before: `06020103` (0023 with (N) and (S)), first takes | 6,936 · 6,629 · 7,042 | 963 · 1,162 · 1,565 | 4.27 to 7.34 |
| After: 0023 with (N), (S) and (H), first takes | 6,180 · 5,023 · 5,421 | 1,196 · 641 · 694 | 7.34 to 8.14 |
| Before, interleaved | 4,054 · 4,077 · 4,156 (median 4,077) | 754 · 680 · 654 (median 680) | 24.9 to 16.9 (falling) |
| After, interleaved | 5,253 · 4,161 · 3,987 (median 4,161) | 786 · 674 · 679 (median 679) | 23.2 to 16.1 (falling) |

Interleaved, the (H) extension costs about +84 ms cold (median) and nothing measurable warm; every PGlite hook stays far inside its 120 s guard. The first takes ran apart while other agents' suites moved the load, so they compare nothing.

### Checkpoint (H) gates (foreground)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | lockfile up to date; no `minimumReleaseAgeExclude` |
| `pnpm turbo run lint typecheck --force` (after `c7085f0c`; 294 s, load 10.0 to 17.7) and `pnpm format:check` | 30 of 30 tasks; Prettier clean. The first run (`pnpm typecheck && pnpm lint`) failed `@openverify/signals#lint`: H.9 |
| `pnpm turbo run test --filter='!@openverify/api'` (354 s, load 5.8 to 14.5) | db 1,178 (95.14% statements; 95.07% on the re-run after `f852b7c1`, 168 s), contracts 2,278 (98.98%), core 787 (99.85%), checks 3,464 (98.74%), watchlist 718 (98.62%), dashboard 3,945 (98.71%), flow 1,051 (95.82%), node 252 (98.87%), emrtd 318 (94.97%), signals 186 (96.31%), config 152 (100%), e2e 97 (96.81%), ui 54 (100%), flow-spec 117 (100%); 14 of 14 tasks |
| API suite: `--shard=1/2` (294 s, load 9.8 to 12.5), `--shard=2/2` (255 s, load 10.3 to 14.2), `--merge-reports --coverage` (4 s) | 368 files, 4,926 passed; 96.35% statements, 88.55% branches, 97.96% functions, 96.4% lines |
| `pnpm test:integration` (after `f852b7c1`; 283 s, load 24.6 to 14.5) | db 65 in 14 files; api 168 in 30 files. The first run failed three db upgrade tests: H.9 |
| `bash infra/tests/ci-workflow.test.sh` | 207 passed |
| `bash infra/tests/compose.test.sh --static-only` | 405 passed |
| `benchmark:typecheck` and `benchmark:test` (`@openverify/db/testing` gained a helper) | clean; 119 passed in 12 files |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` | 74 passed (22.8 s, load 10.8) |
| full stack, `--shard=1/3`, `2/3`, `3/3` (each its own lock hold, with the build) | 31 passed (2.5 min, load 9.6); 31 passed (7.4 min, load 4.6); 29 passed (6.4 min, load 3.9): 91 in all |

Checkpoint (H) ends at `f852b7c1` (and this record).
