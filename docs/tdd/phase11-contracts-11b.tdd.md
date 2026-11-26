# Phase 11, Workflow 11B Stage 1a: `contracts-11b` (TDD evidence)

The contracts of Workflow 11B (platform hardening), frozen by family: common, then (A) authentication and sessions, then (P) platform operations, then (D) data rights and ingestion. Every timing has the 1-minute load average (`cat /proc/loadavg`) beside it. Rule 29 (owner decision, 2026-11-12) gates each intermediate checkpoint on the affected scope; the last checkpoint runs the full gate.

## 0. The base (read-only, before any 11B commit)

- `git merge-base --is-ancestor cdff9dac861ad169813469fbbe6c701faacf70bb HEAD` → exit 0; the same for `9e1cb5e9ea31f4f989180e0e561134602d21374f` → exit 0.
- `git show cdff9dac8:docs/PROGRESS.md | grep -n '^## .*Phase 11, Workflow 11A done'` → `20:## 2026-11-13: Phase 11, Workflow 11A done (Connect: ...)`.
- `grep -n '^## Orchestrator decisions before Workflow 11B' docs/plans/phase-11.plan.md` → `1681`.
- `git merge-base --is-ancestor cdff9dac8 origin/main` → exit 0 (recorded, not required).
- `HEAD` at the start: `9e1cb5e9e`; `git diff --stat cdff9dac8 HEAD` → `docs/plans/phase-11.plan.md | 56 +++` only. Load 0.32 1.93 2.79.
- `gh run list --branch main --limit 5` (read once): 43408690288 (the 11A push), 43137166420, 43018061783: completed, failure, 4-5 s; `gh run view 43408690288 --json jobs`: 18 jobs, each with 0 steps (no step started). 42937477615 (34 min) and 42762952128 (40 min) are Phase 10's, settled there. No completed run with a failed job: nothing to fix first.
- No "Owner decisions after Workflow 11A" section; no later owner decision in PROGRESS.

## 1. The inventory and the amendments

- `docs/research/phase11-inventory.md` section 2 (2.1-2.14), every claim with its `path:line` at `cdff9dac8`, written from greps run in this session (the RegExp scan, the enqueue-site scan per producer method, the maintenance-statement scan, the variable counts per process).
- `docs/plans/phase-11.plan.md`, "## Workflow 11B Stage 1a amendments (contracts-11b)", items 1-30 (drifts and defaults), the later items at each checkpoint.

## 2. Checkpoint common

Commits: `ea6c3baa9` (inventory section 2 and amendments 1-30), `9fc00f384` (RED), `32169f83b` (GREEN), `99ff034e4` (the vocabulary list), and the checkpoint commit.

### RED (`9fc00f384`), load 0.72 0.33 0.95

- `packages/contracts`: `pnpm exec tsc --noEmit -p .` → no error (the test reads every new name through the package's namespace, so it compiles before the names exist). `pnpm exec vitest run src/phase11b-common.test.ts --coverage.enabled=false` → `Tests  40 failed | 3 passed (43)`: each missing name (`expected undefined to deeply equal {...}`), each missing folder (`ENOENT ... problems/sessions`), the settings refused by the strict update body (`expected false to be true`). The three passing are guards that hold before and after (the flow `session_expired` stays reason-free, `login` is no policy, `workflow-in-flight-cap` takes 10,000).
- `apps/api`: `pnpm exec tsc --noEmit -p .` → no error. `vitest run src/plugins/fail-closed-policy.test.ts` → `Tests  4 failed (4)`: `TypeError: enforceFailClosedPolicy is not exported by plugins/rate-limit.ts` (three) and `expected '/** ...' to contain 'enforceFailClosedPolicy'`. `vitest run src/routes/dashboard/settings-11b.test.ts` → `Tests  6 failed (6)`: the GET answer lacks the three members.
- One correction after RED: the default scope name `accounts:access-export` breaks the scope grammar (`packages/core/src/permissions.test.ts`: a one-word action), so GREEN names it `account-access:export` and the RED test's literal changed with it (amendment 35).

### GREEN (`32169f83b`), load 1.0 to 2.3

- `packages/contracts`: `vitest run src/dashboard-api.test.ts src/phase11b-common.test.ts src/json-schema.test.ts src/index.test.ts` → `Tests  1512 passed (1512)`; `packages/core`: `vitest run src/permissions.test.ts src/permission-levels.test.ts` → `Tests  49 passed (49)`.
- `apps/api`: `vitest run src/plugins/fail-closed-policy.test.ts src/routes/connect-routes.test.ts src/routes/dashboard/settings-11b.test.ts src/routes/dashboard/settings-connect.test.ts src/plugins/rate-limit.test.ts src/phase9a-template-plumbing.test.ts` → `Tests  81 passed` after `rateLimitRules`' exact map gained `account-export` (rule 12, amendment 28).
- `apps/dashboard`: `tsc --noEmit` (50 s, load 1.33) → no error after `HardeningSetting` joined the retention form's exclusions; `vitest run src/components/operators src/components/integrations src/app/settings src/app/api-keys` → `Tests  465 passed`.
- `pnpm openapi:write` (23 s): the snapshot gains the three settings, the scope in the scope enums and `account-export` in the rate-limit enum.
- Existing tests changed, minimally (rule 12): `packages/contracts/src/{rate-limits,ids,dashboard-api,vocabulary}.test.ts`, `packages/core/src/permissions.test.ts`, `packages/db/src/ids.test.ts`, `apps/api/src/plugins/rate-limit.test.ts`, each by the new member.

### Gate: affected scope (rule 29)

The filter is `...[9e1cb5e9e]` (the start; no earlier checkpoint): 15 packages, every one but `@openverify/config` and `@openverify/ui` (`pnpm turbo run typecheck --filter="...[9e1cb5e9e]" --dry=json`). `apps/api` and `packages/db` changed, so test:integration ran in its five calls; nothing under `android/`, `e2e/`, `infra/` or a fixture Android reads changed, so no Android gate and no e2e gate. Every call alone on the machine, heavy calls through `/tmp/openverify-heavy.sh` with `OPENVERIFY_HEAVY_RESERVED=1`, lock waits 0 s:

| Call | Exit | Wall | Load before / after | Result |
| --- | --- | --- | --- | --- |
| `pnpm format:check` | 0 | 107 s | 0.79 / 1.18 | |
| `pnpm turbo run typecheck --force --filter="...[9e1cb5e9e]"` | 0 | 132 s | 1.08 / 6.03 | 15 tasks |
| lint `--filter=@openverify/api` (4 GB, `--concurrency=1`, `--force`) | 0 | 204 s | 4.83 / 1.62 | |
| lint dashboard and contracts | 0 | 211 s | 1.62 / 1.73 | |
| lint the other affected packages | 0 | 299 s | 1.73 / 1.86 | 12 tasks |
| API unit, 8 blob shards | 1 each (partial coverage, as a lone shard always) | 147-183 s | 1.58 to 8.99 | no failed test in any shard |
| API merge (the 80% gate) | 0 | 37 s | 7.76 / 4.52 | 10,127 tests in 768 files, 94.28% lines |
| dashboard, 2 blob shards + merge | merge 0 | 192, 208, 6 s | 4.16 to 7.30 | 6,985 tests in 604 files, 95.66% lines |
| db | 0 | 154 s | 5.35 / 12.59 | 2,274 at 89.86% |
| watchlist and e2e | 0 | 261 s | 12.59 / 1.29 | 820 and 144 |
| contracts, core, checks, emrtd, flow, flow-spec, node, signals, workflow-engine | 1: `vocabulary.test.ts`'s exact scope list lacked the new scope; fixed in `99ff034e4`, then contracts 0 (23 s, 4,821 at 98.96%) and checks with flow 0 (108 s; turbo had cancelled them) | 81 s | 1.29 / 26.08 | core 2,007; workflow-engine 1,996; flow-spec 511; node 504; emrtd 338; signals 192; checks 3,849; flow 1,625 |
| `@openverify/js` | 0 | 5 s | 26.08 | 19 |
| integration db / graph | 0 / 0 | 89 / 32 s | 8.16 to 14.69 | 87 / 13 |
| integration api 1-3 of 3 | 0, 0, 0 | 80, 163, 100 s | 8.54 to 15.98 | 103, 115, 178 (396) |

## 3. Checkpoint (A)

Commits: `66fbbe22a` (RED), `3693e813d` (GREEN), `8d7bcdc82` (lint), `25037c31a` (the served sign-in name), and the checkpoint commit.

- **RED** (`66fbbe22a`, load 1.9): `tsc --noEmit` → no error; `vitest run src/phase11b-auth.test.ts` → `Tests  18 failed (18)` (`TypeError: ssoProviderDocumentSchema is not exported as a schema`, `ENOENT ... api/sso`, the `ssop` prefix missing, `organization` refused by the strict login body, the `SETTING_LEVEL` and redaction keys missing).
- **GREEN** (`3693e813d`): `vitest run src/` in `packages/contracts` → `Tests  4862 passed`; `packages/core` → 2,007 after `permission-levels.test.ts` gained `organization-slug` (rule 12); `apps/api` `tsc` → no error; `apps/dashboard` `tsc` → `settings-view.tsx(62,23): error TS2345` until `organization-slug` joined `HardeningSetting`, then no error; `pnpm openapi:write` twice (the login body's `organization`, the setting); API `vitest run src/openapi.test.ts src/routes/dashboard/sessions.test.ts src/routes/dashboard/settings-11b.test.ts src/operator-auth` → 176 passed. Existing tests changed minimally: `redaction.test.ts` (two keys), `ids.test.ts` in both packages, `dashboard-api.test.ts` (the default), `permission-levels.test.ts`.

### Gate: affected scope (rule 29)

Filter `...[031d6f5a6]` (checkpoint common): the same 15 packages. `packages/db` (`ids.ts`) and, after the fix, `apps/api` changed, so the five integration calls ran. Lock waits 0 s.

| Call | Exit | Wall | Load before / after | Result |
| --- | --- | --- | --- | --- |
| format:check | 0 | 110 s | 1.35 / 1.69 | |
| forced typecheck, filtered | 0 | 152 s | 1.69 / 5.59 | 15 tasks |
| lint api / others (in parallel) | 0 / 0 | 247 / 359 s | 5.14 / 1.96 | 1 and 14 tasks |
| lint dashboard and contracts | 1, then 0 | 71, then 215 s | 5.14, then 1.62 / 1.87 | `no-unnecessary-type-assertion` at `phase11b-auth.test.ts:32`, fixed in `8d7bcdc82` |
| API shards 1-4 of 8, run four at once (a mistake: no gain) | 1 each (partial coverage), no failed test | 561-595 s | 1.72 / 35.80 | one shard at a time from then on |
| API shards 5-8, one at a time | 1 each, no failed test | 148-166 s | 8.73 to 20.51 | |
| API merge | 1 | 36 s | 8.73 / 5.31 | 2 failed in `routes/dashboard/settings.test.ts` (the served defaults lacked `organization-slug`); fixed in `25037c31a`; then `vitest run src/routes/dashboard/settings.test.ts settings-11b.test.ts settings-connect.test.ts src/openapi.test.ts` → 52 passed. Coverage of the merged run 94.28% lines (10,125 of 10,127 passed); the full gate at the last checkpoint reruns the whole suite |
| dashboard 2 shards + merge | merge 0 | 212, 227, 6 s | 2.28 to 7.84 | 6,985 at 95.66% |
| db / watchlist and e2e | 0 / 0 | 164 / 280 s | 6.23 to 10.13 | 2,275; 820 and 144 |
| the nine other packages, `--concurrency=4` | 0 | 171 s | 1.32 / 12.97 | contracts 4,862, core 2,007, checks 3,849, flow 1,625, workflow-engine 1,996, flow-spec 511, node 504, emrtd 338, signals 192 |
| js | 0 | 5 s | 12.97 | 19 |
| integration db / graph / api 1-3 | 0 each | 90 / 33 / 83, 160, 103 s | 8.75 to 15.93 | 87 / 13 / 103, 115, 178 |

Measurement for later stages: four API shards at once on this host took 561 to 595 s each at load up to 36, against 148 to 183 s alone; shards are run one at a time.

## 4. Checkpoint (P)

Commits: `fbbe7141d` (RED), `1af0cd5ba` (GREEN), and the checkpoint commit.

- **RED** (`fbbe7141d`, load 1.6): contracts `tsc` and `eslint` clean; `vitest run src/phase11b-platform.test.ts` → `Tests  7 failed (7)` (`ENOENT ... api/platform`, each name `undefined`); API `tsc` clean (the script modules are imported by a computed URL); `vitest run src/package-scripts.test.ts` → `Tests  4 failed | 6 passed (10)` (`expected undefined to be 'tsx ... scripts/org-create.ts'`).
- **GREEN** (`1af0cd5ba`): contracts `vitest run src/phase11b-platform.test.ts src/json-schema.test.ts src/index.test.ts` → 1,482 passed; API `vitest run src/package-scripts.test.ts` → 10 passed, after `eslint` refused a meaningless `void argv` in the stubs (they now answer `--help` with the usage line, still refusing).

### Gate: affected scope (rule 29)

Filter `...[7c9204b8c]` (checkpoint A): `api`, `checks`, `contracts`, `dashboard`, `e2e`, `flow`, `js`, `node`, `signals`, `watchlist`, `workflow-engine` (`--dry=json`); `apps/api` changed, so its four integration calls ran (`packages/db` did not change, so not the db call). One shard at a time; lock waits 0 s.

| Call | Exit | Wall | Load before / after | Result |
| --- | --- | --- | --- | --- |
| format:check | 0 | 109 s | 1.19 / 1.32 | |
| forced typecheck, filtered | 0 | 128 s | 1.32 / 4.38 | 11 tasks |
| lint api / dashboard and contracts / the other packages (in parallel) | 0 / 0 / 0 | 263 / 275 / 372 s | 4.38 / 2.09 | |
| API 8 shards, one at a time | 1 each (partial coverage), no failed test | 148-186 s | 1.92 to 8.73 | |
| API merge | 0 | 38 s | 8.37 / 5.03 | 10,131 tests in 768 files, 94.28% lines |
| dashboard 2 shards + merge | merge 0 | 202, 214, 6 s | 4.63 to 7.80 | 6,985 at 95.66% |
| watchlist and e2e | 0 | 282 s | 5.48 / 1.08 | 820 and 144 |
| contracts, checks, flow, node, signals, workflow-engine | 0 | 151 s | 1.08 / 12.27 | 4,873; 3,849; 1,625; 504; 192; 1,996 |
| js | 0 | 6 s | 12.27 | 19 |
| integration graph / api 1-3 | 0 each | 37 / 81, 165, 92 s | 7.00 to 17.23 | 13 / 103, 115, 178 |

## 5. Checkpoint (D), the last: the full gate

Commits: `1842b4f90` (RED), `d76aa31fc` (GREEN), `387b3f668` (the snapshot), `66036f2e0` (the dependencies, amendment 27), `32cbad13a` (a comment), and the checkpoint commit.

- **RED** (`1842b4f90`, load 4.1): contracts `tsc` and `eslint` clean; `vitest run src/phase11b-data.test.ts` → `Tests  17 failed (17)` (each name `undefined`, `ENOENT ... api/account-exports`, the strict source schema refusing `conditional`: `expected false to be true`). One correction before the commit: the sources-page test read `api/watchlist-sources.json`; the golden is `api/dashboard-watchlist-sources.json`.
- **GREEN** (`d76aa31fc`): `UPDATE_CONTRACT_FIXTURES=1 vitest run src/phase11b-data.test.ts -t "JSON Schema"` wrote `contracts/schemas/openverify.account-export.v1.schema.json` (then Prettier; the test compares by value so the formatted file is the committed one); `vitest run src/` in contracts → 4,905 passed; `apps/api/src/account-export-schema.test.ts` (ajv 2020 over the committed schema) → 2 passed, written with the schema (no RED: it checks a fixture the GREEN made); API `vitest run src/watchlists/manifest.test.ts src/routes/dashboard` → 400 passed; `pnpm --filter @openverify/watchlist benchmark:typecheck` exit 0 and `benchmark:test` 119 passed (rule 16: `manifest.ts` is one of the benchmark's imports).
- **Dependencies** (`66036f2e0`): `flock /tmp/openverify-pnpm.lock pnpm install` → `Packages: +3`, one `jose` (6.2.12), no `minimumReleaseAgeExclude`; `pnpm install --frozen-lockfile` exit 0; `apps/api/src/oidc-dependencies.test.ts` → 10 passed (no RED: it holds a pin made in the same commit).

### Gate: the full gate (rule 29, last checkpoint), on the final tree

Every call alone on the machine, in the foreground, heavy calls through `/tmp/openverify-heavy.sh` (`OPENVERIFY_HEAVY_RESERVED=1`), Gradle under its lock, the e2e calls under the e2e lock; every lock wait 0 s. Loads are the 1-minute averages before each call.

| Call | Exit | Wall | Load | Result |
| --- | --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | 0 s | 0.95 | |
| `pnpm format:check` | 0 | 106 s | 0.95 | |
| `pnpm turbo run typecheck --force` | 0 | 139 s | 1.59 | 17 tasks |
| lint api / dashboard and contracts / the other 14 (`--force --concurrency=1`, 4 GB; in parallel) | 0 / 0 / 0 | 250 / 263 / 364 s | 4.16 | |
| API unit, 8 blob shards one at a time | 1 each (partial coverage), no failed test | 149-186 s | 2.21 to 8.74 | |
| API merge (the 80% gate) | 0 | 38 s | 7.78 | **10,143 tests in 770 files, 94.28% lines** |
| dashboard 2 shards + merge | merge 0 | 191, 212, 6 s | 4.39 to 7.58 | 6,985 in 604 files, 95.66% |
| db | 0 | 164 s | 6.14 | 2,275 at 89.86% |
| watchlist and e2e | 0 | 267 s | 10.62 | 820 (98.61%) and 144 (96.94%) |
| the other 11 packages | 0 | 164 s | 1.07 | contracts 4,905 (98.98%), core 2,007, checks 3,849, workflow-engine 1,996, flow 1,625, flow-spec 511, node 504, emrtd 338, config 308, signals 192, ui 58 |
| `@openverify/js` | 0 | 5 s | 13.34 | 19 |
| integration db / graph / api 1-3 | 0 each | 93 / 39 / 96, 168, 106 s | 9.13 to 16.68 | 87 / 13 / 103, 115, 178 (396) |
| `pnpm --filter @openverify/api openapi:write`, twice, then `git diff --exit-code -- docs/api/openapi.json` | 0, 0, 0 | 22, 23 s | 14.87 | the second run changes nothing |
| `bash infra/tests/ci-workflow.test.sh` | 0 | 11 s | 8.06 | 411 passed, 0 failed, 0 skipped |
| fetches (`fetch_models.py --only face_detection_yunet`, `fetch_fixtures.py --only person_a_id`) | 0 | 0 s | 5.90 | both present |
| Android (1) ui / flow / rest, `--rerun` | 0 / 0 / 0 | 167 / 46 / 103 s | 5.90 / 2.45 / 2.90 | 532 + 427 + 1,773 = **2,732**, none failed or skipped (the XML) |
| Android (2) screenshots, verify | 0 | 51 s | 1.74 | 97 tests |
| Android (3) `koverVerify checkKotlinAbi` | 0 | 184 s | 2.25 | no dump changed |
| Android (4) `testDebugUnitTest assembleDebug` | 0 | 13 s | 2.59 | demo 97 and 9 smoke twins, openverify-nfc 116, openverify-face 51 |
| Android (5) release builds | 0 | 14 s | 2.93 | |
| Android (6) `:openverify-sdk:assemble` | 0 | 11 s | 4.14 | the AAR, the iOS klibs |
| Android (7) `lint` | 0 | 16 s | 3.97 | |
| Android (8) device-test compile | 0 | 133 s | 3.77 | |
| Android (9) bundletool, the release checks' tests, the three static checks | 0, 0, 0 | 1, 1, 14 s | 10.35 | 98 tests; check-size passed |
| Android (10) staging, then `-p consumer-check build` | 0, 0 | 13, 12 s | 8.23 | |
| Android (11) sdk,nfc / sdk,face / sdk,nfc,face | 0 each | 25 / 24 / 23 s | 7.00 to 4.95 | |
| mocked flow suite | 0 | 129 s | 4.09 | 349 passed |
| stack down and the turbo build / `e2e:stack:up` | 0 / 0 | 35 / 107 s | 12.00 / 7.55 | |
| chromium shards 1-4 of 4 | 0 each | 280 / 332 / 277 / 367 s | 4.39 / 2.85 / 1.34 / 2.54 | 49, 48, 49, 47 (193) |
| console sweep (`--no-deps`, the used stack) | 0 | 316 s | 1.99 | 108 passed |
| `:openverify-sdk:stackTest` | 0 | 45 s | 3.99 | 3 classes, 3 of 3 (XML at 11:30, this run) |
| `e2e:stack:down` | 0 | 4 s | 3.25 | |

No file under `android/` changed in this Stage (no `serverOnly` entry was needed, amendment 26), so no Gradle lockfile or verification metadata moved; the phone is not used (rule 26).

checkpoint common: 031d6f5a6
checkpoint A: 7c9204b8c
checkpoint P: 22adefb36
checkpoint D: the commit that adds this section
