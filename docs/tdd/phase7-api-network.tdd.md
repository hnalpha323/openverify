# Phase 7, Workflow 7A Stage 3: `api-network` (family N)

Plan: `docs/plans/phase-7.plan.md` C92, C93 and C106.1, the `api-network` bullet of "Workflow 7A", the
Stage 1a amendments (contracts-7a) and the Stage 1b (N) amendments (foundation-7a). Base: `e0c264dc`
(foundation-7a's (N) record). Every command below ran after `source scripts/env.sh`; outputs are
abbreviated to the lines that decide. Every address is from the documentation ranges and every ASN
from the documentation ASN ranges; no test calls a publisher.

## What was built

| Slice | Files | Contract |
|---|---|---|
| 0. workspace link | `apps/api/package.json` (`@openverify/signals: workspace:*`), `pnpm-lock.yaml` (3 lines, through pnpm) | foundation-7a amendment (N) 5 |
| 1. db repositories | `packages/db/src/repositories/{network-sources,networks}.ts` | C92.2-C92.5, C93.2, C106.1 |
| 2. manifest, ASN data, reconciliation | `network/sources.json`, `network/asn-overrides.json`, `apps/api/src/network/{manifest,asn-data,reconcile}.ts` | C92.1, C92.5, C92.6 |
| 3. the sync runner, and the watchlist sync on it | `apps/api/src/sync/runner.ts`; `apps/api/src/watchlists/{sync,download,formats,sync-session}.ts` | C92.2 (F35, decision 48) |
| 4. the network sync | `apps/api/src/http/stream.ts` (C85.1 amendment), `apps/api/src/network/{download,sync}.ts` | C92.2, C92.3 |
| 5. CLI and refresh tick | `apps/api/src/network/{cli,cli-runtime}.ts`, `apps/api/scripts/network-sync.ts`, `apps/api/src/jobs/repeatable/network.ts` | C92.2 |
| 6. snapshot loader | `apps/api/src/network/snapshots.ts` | C92.3, C92.4, H26 |
| 7. evaluation, trust mode, adapters | `apps/api/src/network/{evaluate,private-peers}.ts`, `apps/api/src/providers/ip-reputation/index.ts` | C93.1-C93.6 |
| 8. seed | `apps/api/src/seed/network.ts` | C92.1, C92.6, C93.6 |
| 9. the `ip-address` report | `apps/api/src/jobs/report-types/ip-address.ts`, the `ip-address` case of `services/reports/completion.ts`, `firstInquiryNetwork` | C106.1 |
| 10. console route | `apps/api/src/routes/dashboard/network-sources.ts` (not registered) | C108, C92.8 |
| 11. agreement pins | `apps/api/src/network/agreement.test.ts` | network-data followups |
| 12. Postgres | `apps/api/src/network/network.integration.test.ts` | C92.2, C92.3 |

## Slice 1: the db repositories

- Stub `215d8526` (the lock, record, sync and purge names), RED `0086304e`, GREEN `d0d374eb`.
- RED: `pnpm --filter @openverify/db exec vitest run src/repositories/network-sources.test.ts src/repositories/networks.test.ts --coverage.enabled=false`
  - `Tests 12 failed (12)`, each `NetworkRepositoryNotBuiltError: <name> is not built yet` (`reconcileNetworkSourceRows`, `tryLockNetworkSourceSession`, `lockNetworkSourceTransaction`, `recordNetworkSourceError`, `insertNetworkSync`, `recordSessionNetworkEvaluation`).
- GREEN, same command: the first take failed one test (`Failed query: with kept as (` ... `code: '42703'`): the purge's `union ... order by` needed its second branch in parentheses. Then `Test Files 2 passed (2)`, `Tests 12 passed (12)`.
- Slice 9 added `firstInquiryNetwork`: stub `5224f4f9`, RED (in `043f2191`) `Error: not built`, GREEN `1d210929` (`Tests 4 passed`).

## Slice 2: the manifest, the ASN data, reconciliation

- Stubs `2ac2249c`, `53b7cc7b` (typed constants, for lint), RED `911ed44a`, GREEN `e5cc75cf`.
- RED: `vitest run src/network/manifest.test.ts src/network/asn-data.test.ts src/network/reconcile.test.ts` gave `Test Files 3 failed (3)`: `Error: not built` (manifest, ASN data); the stub reconciliation wrote nothing (`expected [] to include 'dbip-city-lite'`, `expected +0 to be 1`).
- GREEN: `Test Files 3 passed (3)`, `Tests 30 passed (30)`.

## Slice 3: the sync runner, and the watchlist sync moved onto it

- Stub `f1c952e6`, RED `c68d6639`, GREEN `606d094f`, refactor `d38e3367`.
- RED: `vitest run src/sync/runner.test.ts` gave `Tests 14 failed (14)`, each `Error: not built`.
- GREEN: `Tests 14 passed (14)`.
- Baseline before the refactor: `vitest run src/watchlists/sync.test.ts src/watchlists/download.test.ts src/watchlists/manifest.test.ts src/watchlists/reconcile.test.ts src/watchlists/cli.test.ts src/jobs/repeatable/watchlists.test.ts` gave `Test Files 6 passed (6)`, `Tests 75 passed (75)`.
- After the refactor, no watchlist test file changed: `vitest run src/watchlists src/jobs/repeatable/watchlists.test.ts src/sync` gave `Test Files 11 passed (11)`, `Tests 110 passed (110)`.
- The benchmark's imports (rule 16) keep their names and signatures: `pnpm --filter @openverify/watchlist benchmark:typecheck` passed; `benchmark:test` gave `Test Files 12 passed (12)`, `Tests 119 passed (119)`.
- The C76.2 races on Postgres, unchanged: `vitest run --config vitest.integration.config.ts src/watchlists/watchlists.integration.test.ts -t "the sync on its own connections"` gave `Tests 4 passed | 2 skipped (6)` in 14.0 s. The file's C78.7 gate block, header and assertions were not touched.

## Slice 4: the network sync

- Stub `51edb736`, RED `ac30d1e1`, GREEN `166a0906`.
- RED: `vitest run src/http/stream-untyped.test.ts src/network/download.test.ts src/network/sync.test.ts` gave `Tests 33 failed | 1 passed (34)`: `Error: not built` (download, sync); the stream client still refused an untyped 200 for a client naming `STREAM_NO_CONTENT_TYPE` (`× is taken only by a client that names STREAM_NO_CONTENT_TYPE`).
- GREEN: `vitest run src/http/stream-untyped.test.ts src/http/stream.test.ts src/network/ src/sync src/watchlists/download.test.ts` gave `Test Files 9 passed (9)`, `Tests 101 passed (101)`. The first take failed two download tests on a test bug (`handle.readFile()` reads from the handle's position, the end); the test now reads the file by path, in the GREEN commit.

## Slice 5: the CLI and the refresh tick

- Stub `b79325b2`, RED `92146af8` (with `NetworkRefreshDeps.connect` and `.manifest`), GREEN `cf63dd9d`.
- RED: `vitest run src/network/cli.test.ts src/jobs/repeatable/network.test.ts` gave `Tests 9 failed (9)`: `Error: not built` (CLI); the stub tick `expected { due: +0, applied: +0, … } to deeply equal { due: 9, applied: 1, … }`.
- GREEN, with `src/jobs/repeatable/phase7.test.ts`: `Test Files 3 passed (3)`, `Tests 12 passed (12)`; `src/package-scripts.test.ts` `Tests 4 passed`.

## Slice 6: the snapshot loader

- Stub names `1f3a7056`, RED `ec4a77a6`, GREEN `ea1884ba`.
- RED: `vitest run src/network/snapshots.test.ts` gave `Tests 7 failed (7)`: the stub loads nothing (`expected [] to deeply equal [ 'openverify-sandbox-network', …(1) ]`), and `networkSourceSnapshots` `Error: not built`.
- GREEN: `vitest run src/network/snapshots.test.ts src/container.test.ts src/worker-network-startup.test.ts src/network` gave `Test Files 9 passed (9)`, `Tests 100 passed (100)`.
- One existing test changed (container.test.ts, 'is ready without waiting past its deadline for a slow reconciliation, and says so'): it advances fake timers only past the watchlist deadline, and relied on the stub loader resolving at once. The real loader reads the database, so the test now passes in-memory snapshots (`createInMemoryNetworkSnapshots()`); its assertions are unchanged. It failed with `expected false to be true` before.

## Slice 7: the session evaluation, the trust-mode watch, the adapters

- Stub names `f5a2aaf6`, RED `9aea8698`, GREEN `ae333be3`.
- RED: `vitest run src/network/evaluate.test.ts src/network/private-peers.test.ts src/providers/ip-reputation` gave `Tests 18 failed | 6 passed (24)`: the stub evaluation wrote nothing (`expected null to be true`), the stub watch logged nothing (`expected [] to deeply equal [ { level: 'warn', …(2) } ]`), `IpReputationNotBuiltError`.
- GREEN: with `src/routes/flow/session-network.test.ts`, `Test Files 4 passed (4)`, `Tests 27 passed (27)`.
- One RED expectation was wrong and was corrected before GREEN, in the GREEN commit: a documentation address in a sandbox environment reads the sandbox bundle alone, with its own fictional ASN lists, so `198.51.100.7` answers `not_in_known_ranges`, not `list_unavailable`, whatever the pinned seeds. The missing-seeds path (`asnSets: null`) is `network-data`'s (tested there through its public-address seam); a test here cannot reach it without a non-documentation address.
- The tests that touch the stubs elsewhere: `vitest run src/providers src/config-phase7.test.ts src/seed/dev-seed-network.test.ts src/services/inquiry-sessions.test.ts src/routes/flow` gave `Test Files 66 passed (66)`, `Tests 824 passed (824)`.

## Slice 8: the seed

- RED `68e2966d` (with `SeedNetworkOptions.asnData`), GREEN `5aa34588`.
- RED: `vitest run src/seed/network.test.ts` gave `Tests 4 failed (4)` (`expected [] to have a length of 1 but got +0`).
- GREEN: `vitest run src/seed/` gave `Test Files 4 passed (4)`, `Tests 44 passed (44)`.

## Slice 9: the `ip-address` report

- Stub `5224f4f9`, RED `043f2191` and its compile fix `2cc8568c`, GREEN `1d210929`.
- RED: `vitest run src/jobs/report-types/ip-address.test.ts src/services/reports/completion-ip-address.test.ts` gave `Tests 12 failed | 1 passed (13)`: `ReportTypeNotBuiltError: The ip-address report job is not built yet`; the completion query was empty (`expected { …(34) } to match object { reportType: 'ip-address', …(3) }`).
- The RED commit `043f2191` did not typecheck: a find-and-replace turned `vpn.served.attributes[...]` into `vpn.attributesOf(served)[...]`. `2cc8568c`, a minute later, fixed it before any GREEN; nobody's e2e build ran in between that I know of, but the window existed.
- GREEN: `vitest run src/jobs/report-types src/services/reports` gave `Test Files 16 passed (16)`, `Tests 137 passed (137)`; `src/report-docs.test.ts` and `src/services/reports/completion.test.ts` passed with them.
- The goldens of C106.1: IPv6 (`ipv6_not_covered`, ready), a private address (`address_not_public`), a documentation address in production (`address_not_public`, no sandbox source), a stale exit list (`errored`, `list_stale` naming `tor-exit-addresses`, the other fields kept), and a sandbox Tor address (`MATCHED`, flagged). A stale exit list cannot be reached with a documentation address, so that case wraps `evaluateNetwork` (Vitest `vi.mock` with the original) and marks `is-tor` stale.

## Slice 10: the console route

- Stub `49f29123`, schema `e2101555`, RED `6b70236b`, GREEN `066912fc`.
- RED: `vitest run src/routes/dashboard/network-sources.test.ts` gave `Tests 4 failed (4)`, `Error: not built`.
- GREEN: `Tests 4 passed (4)`.

## Slice 11 and 12: pins written after the code

- `c365f586`, `vitest run src/network/agreement.test.ts`: `Tests 11 passed (11)`. The network reasons are subsets of the contracts' frozen enums, the fact fields equal, and `evaluateNetwork`'s threat level, confidence and null reason agree with `@openverify/checks`' `sessionThreatLevel` on ten C93.6 goldens. Both halves existed already, so the test passed at once; it guards them from drifting apart.
- `b5d757fe`, `vitest run --config vitest.integration.config.ts src/network/network.integration.test.ts`: `Tests 7 passed (7)`, 6.96 s. `busy` and the race need two connections, which PGlite does not give. The first take failed 2 of 7 on a test bug: the race used another seed's relays, so the guard refused it as a mass removal (outcomes `["busy","refused_mass_removal"]`). The series now publishes the same relays later.

## Decisions taken here

- **The back-off.** Network sources take the watchlists' back-off (owner decision 6 after Workflow 6A, `refreshBackoffMs`): 15 minutes after the first failed check, doubling, capped at the source's refresh interval and at 24 hours. A refusal counts as a failed check, as for watchlists. The exit list's hour caps it at one hour.
- **A source not configured** is a disabled source (`source_disabled`) or a process without object storage (`storage_not_configured`): no request is made, and a sync row is written except for the tick.
- **Mass change.** The manifest's `guards` carry the thresholds with their basis: 25% of a range or exit set's addresses removed, 25% growth of a family's covered addresses (only a family the source already covered), any prefix shorter than `min_prefix` (`/8` IPv4, `/16` IPv6, provisional), and an MMDB under half the applied size. An empty publication is `refused_schema` unless `--allow-mass-removal`, as the watchlists since 6C.
- **Unchanged** compares the SHA-256 of the normalised snapshot object (the decompressed MMDB, the canonical range or exit JSON), which is also the object key and what every load re-checks.
- **The purge** runs after every applied or unchanged sync (C92.3: superseded snapshots more than 7 days old, keeping each source's current and previous one and any object either shares a digest with), not in the C16 pass, whose file is shared.

## Slice 7b: an evaluation that itself fails

- RED `cdbc483b`: `vitest run src/network/evaluate.test.ts` gave `Tests 1 failed | 13 passed (14)`, `Error: the snapshots are unreadable`: a failure of the pure evaluation (unreadable snapshots, a missing manifest) threw, which would roll the session start back.
- GREEN `dbe38af5`: it now writes nothing and returns `null`, so the start commits not evaluated. `vitest run src/network/ src/routes/flow/session-network.test.ts` gave `Test Files 11 passed (11)`, `Tests 107 passed (107)`.

## Final gates (foreground; other agents' Stage 1b (S) work in flight)

- `pnpm --filter @openverify/api typecheck` and `lint`: passed at 12:00 (the lint later failed on `routes/server/inquiry-sessions.ts`, foundation-7a's (S) work in flight).
- API unit suite, two blob shards and a merge with coverage (loads 3.1 to 19.7): `Test Files 2 failed | 354 passed (356)`, `Tests 2 failed | 4824 passed (4826)`; statements 96.03%, branches 88.29%, functions 97.65%, lines 96.2%. The two failures are foundation-7a's (S) in flight: `services/inquiry-signals-served.test.ts` (its RED) and `openapi.test.ts` (the snapshot waits for its regeneration after the last checkpoint). My files: `src/network` 93.97% statements, `sync/runner.ts` 95.16%, `ip-address.ts` 96.77%, `providers/ip-reputation` 92.85%, `jobs/repeatable/network.ts` 93.93%, `http/stream.ts` 94.25%.
- `pnpm --filter @openverify/db test`: `Test Files 84 passed (84)`, `Tests 1120 passed (1120)`, 65.3 s; statements 95.04% (load 12.0 at start).
- `pnpm test:integration`: db `Tests 65 passed (65)` in 131.5 s; api `Test Files 29 passed (29)`, `Tests 166 passed (166)` in 241.0 s (load 10.1 to 20.2).
- `pnpm typecheck`, `pnpm turbo run lint --continue`: every package but `apps/dashboard` (and `apps/api`'s lint, above) passed; the dashboard fails at `src/app/inquiries/actions.ts:230` (the `expire-all` body union of (S)), not a 7A (N) path.
- `pnpm format:check`: my one finding (`ip-address.ts`) fixed in `a70bf952`; the others are `routes/server/inquiry-sessions.ts` and `packages/db/drizzle/meta/0023_snapshot.json`, foundation-7a's.
- e2e: the mocked flow suite `69 passed (33.0s)` (load 14.0). The full-stack shards: see the report.
- e2e, under `/tmp/openverify-e2e.lock`, once foundation-7a's `2fb99352` made the dashboard typecheck again: full stack shard 1/3 `31 passed (2.5m)` (load 3.6 to 5.0), shard 2/3 `31 passed (4.7m)` (load 5.3 to 0.7), shard 3/3 `29 passed (4.6m)` (load 1.0 to 2.1): 91 tests, with the mocked flow suite's 69 above.
- Re-run at the end: `services/inquiry-signals-served.test.ts` and `openapi.test.ts` `Tests 16 passed (16)` (foundation-7a's (S) landed); `pnpm --filter @openverify/api lint` and `pnpm format:check` clean.
