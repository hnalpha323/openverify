# Phase 11, Workflow 11F: fix-records evidence

Agent: `fix-records` (claude-opus-5-5), alone and last in Workflow 11F, after `fix-server` (last checkpoint `5c144a954`) and `fix-clients` (last checkpoint `f5b289674`). Started 2026-11-21 13:15 UTC at `f5b289674`. Machine: Intel Xeon E5-1650 v3, 12 logical CPUs, 31.3 GiB, WSL2 with Docker Desktop. Every timing below carries its 1-minute load (from `cat /proc/loadavg`) and its lock wait.

Paths: `docs/` (never `docs/PROGRESS.md` or `docs/release/staged-run.json`), `deploy/`, `infra/`, `.github/workflows/`, `.github/actions/`, `security/`, `scripts/`, `THIRD_PARTY_LICENSES.md`, `SECURITY.md`, `.githooks/`, `.dockerignore`, `.gitignore`, `README.md`, `models/manifest.json`, `data/manifest.json`.

## 1. Baseline

- `pnpm release:check` (default) at `f5b289674`: exit 0, 0 errors, 109 owner items, 34 of them `security/stale-evidence` (rows whose cited test changed in 11F after `reviewed_commit` `7d813b436`).
- `pnpm --filter @openverify/docs-tools docs:all` (22 s) then `git status`: one generated page differs, `docs/self-hosting/upgrades.md` (migration `0037_phase11f_session_amr`, fix-server's KP11-26).

## 2. Generated pages after the other fixers (fix-server's followup)

### 2.1 `docs/self-hosting/upgrades.md` after migration 0037

- RED (the committed page put back with `git show HEAD:docs/self-hosting/upgrades.md`): `pnpm exec vitest run src/selfhost/index.test.ts --coverage.enabled=false` in `packages/docs-tools` exits 1: `× holds over the repository`, `AssertionError: expected [ { rule: 'fresh-render', …(3) } ] to deeply equal []`, 1 failed and 3 passed.
- GREEN: `pnpm --filter @openverify/docs-tools docs:selfhost` adds `- 0037_phase11f_session_amr` to the generated migration list; the same test passes 4 of 4.

### 2.2 The wording rule over fix-server's evidence (a Validation failure, borrowed edit)

- RED: the whole docs-tools suite (`pnpm exec vitest run --coverage.enabled=false`, 19.7 s, load 2.19) fails 1 of 428: `src/wording.test.ts > the scope > holds over the repository`, finding `asvs-masvs-claim` at `docs/tdd/phase11-fix-server.tdd.md:33`, where fix-server's F007 evidence quotes its own RED example sentence in plain quotes.
- GREEN: the example sentence is written as an inline code span, which F007's rule reads as a mention (the borrowed edit of fix-server's evidence, one line, wording only); `src/wording.test.ts` 29 of 29.

## 3. fix-records' known items

### 3.1 KP11-82, KP11-85, KP11-86: three stale lines corrected (prose, no generator)

Read against the code first:
- KP11-82: `packages/db/src/repositories/watchlist-switches.ts:73-75` holds only `retrieval-reach` in `WATCHLIST_SWITCHES_ON_BY_DEFAULT`. `docs/calibration/load-phase11.md`'s `role-timeouts` row now says `incremental-key-df` ships off, so a default sync still runs the full rebuild, and that 370 s stands either way. The summary block and every verdict are unchanged.
- KP11-85: `packages/core/src/lists.ts:338-343` holds `fuzzy-name-candidate-cap` 5,000. `docs/reports/custom-list.md` now says 5,000.
- KP11-86: `packages/checks/src/government-id/id-compromised-detection.ts:11,61` raises `compromised_list_match` from a list marked `use-for-compromised-ids`. `docs/checks/government-id.md` now states that (the reason line, the limit line and the heuristics' "Lists and adapters" line), in the words of `docs/lists/README.md` "Compromised IDs (C99.9)" and `docs/checks/limits.json`.

None of these pages is generated: `docs:all` after the edits changes nothing, and the docs-tools suite passes 428 of 428. There is no RED test for a prose correction, since no generator renders these lines and no record test reads them (the KP11-73 precedent).

### 3.2 KP11-84: `gateway.httpRoute.parentRefs`

- RED `92e8d9995`: three cases in `deploy/helm/openverify/tests/c263-operations_test.yaml` (suite "c263 operations (gateway route)"): the default parent, a named parent (`shared-gateway`, `gateway-system`, `sectionName: https`), and a parent without a name refused. `bash deploy/helm/openverify/ci/chart-checks.sh unittest` (8 s, load 1.78) exits 1 under both Helms: `attaches every route to the parents gateway.httpRoute.parentRefs names ...`, `Error: values don't meet the specifications of the schema(s) ... at '/gateway/httpRoute': additional properties 'parentRefs' not allowed`. (The refusal case passes before the fix as well, since the schema refuses the key outright; it holds `required: [name]` after it.)
- GREEN: `values.yaml` gains `gateway.httpRoute.parentRefs: []`; `values.schema.json` gives it an array of objects (`name` required, plus `namespace`, `sectionName` and `port`, no other key); `templates/httproute.yaml` writes the list, or the release-named Gateway when it is empty. `chart-checks.sh unittest`: 199 of 199 under both Helms; `lint` and `kubeconform` exit 0; the chart's three contracts pass (47, 44 and 72 checks). `docs/self-hosting/install-kubernetes.md` describes the key and says that an HTTPS-only `sectionName` refuses plain HTTP rather than redirecting it (ASVS v5.0.0-4.1.2).

### 3.3 KP11-81: open, with the Gateway route as the refusal path

The NGINX controllers have no annotation that refuses plain HTTP on one host. ingress-nginx's `ssl-redirect` and `force-ssl-redirect` and F5 NGINX's TLS redirect each answer with a redirect. The only per-host way to refuse is a snippet annotation, which both controllers disable by default and which the chart must not require. Dropping the annotation on the API host would serve the API over plain HTTP, which is worse than the 308 that ASVS row `v5.0.0-4.1.2` already records as `partial`. The chart therefore keeps the redirect on the Ingress path. `docs/self-hosting/install-kubernetes.md` now says so and names the two refusal paths: the Gateway route on an HTTPS listener only (KP11-84 above), or a load balancer that accepts only HTTPS for the API host. A refusal that holds whatever the controller does would be the API's own: refuse a request whose trusted `X-Forwarded-Proto` is `http`. That is an `apps/api` configuration and registry change (fix-server's paths) and is carried to the next release.

### 3.4 KP11-83: decided, one role in the compose `app` profile, with the reason recorded

Read first: `infra/docker-compose.yml`'s `migrate` service runs `node dist/commands/db-migrate.js` with `DATABASE_URL` only. `apps/api/scripts/db-migrate.ts` falls back to `DATABASE_URL` and warns when `OPENVERIFY_MODE` is production (compose's default is `development`). `docs/self-hosting/install-compose.md:11` and `database.md:14` already said so. Decision (the item's "or record why not"): no second role in compose. The compose Postgres is created by its image with one owner role. Every developer command uses that one `DATABASE_URL`. A role made by an init script exists only on an empty data directory, so a developer's existing volume would never get it. The two-role install is the chart's migrate Job (`migrate.grantRuntime`) and `database.md`'s. The reason is now in `install-compose.md` and in the compose comment. No behaviour changed, so there is no RED; `bash infra/tests/compose.test.sh` passes 639 of 639 after the comment edit.

## 4. The other fixers' followups

### 4.1 F004 and KP11-71 in the images (fix-server's followups; a borrowed edit of `services/vision/Dockerfile`)

- RED `c1a0de4b2`: `infra/tests/images.test.sh` expects the vision image labelled `dev.openverify.licence-status="pending-owner"` while KP11-39 is open (static and live), and adds `face-scan-benchmark` to the API's development-tool loop. `bash infra/tests/images.test.sh static` (0.9 s, load 1.9) exits 1: `FAIL - vision: licence-status is pending-owner`, 148 passed and 1 failed. `api` (45.8 s) on the image built at 03:10Z, before fix-server's `8f61d6f6b`, exits 1: `FAIL - api: leaves the development tool face-scan-benchmark out`, 57 passed and 1 failed. `vision` (12.3 s) exits 1: `FAIL - vision: label dev.openverify.licence-status (expected 'pending-owner', got 'decided')`, 27 passed and 1 failed.
- GREEN (static): `services/vision/Dockerfile:52` reads `pending-owner` (the borrowed edit; the file was clean first). `images.test.sh static` passes 149 of 149. The live `api` and `vision` subcommands pass only on images rebuilt from this tree; their GREEN is Validation steps 12 and 13 below.
- Records: threat row B7-T4 becomes `control` (evidence `apps/api/src/commands-build.test.ts` and `infra/tests/images.test.sh`). `docs/self-hosting/install-kubernetes.md:61` and `first-run.md:19` no longer say the tool is in the image. `docs:all` changes nothing else, and the docs-tools suite passes 428 of 428.

### 4.2 The console scan's cookie (fix-clients' followup after KP11-78)

- RED `8bb19e11c`: `infra/tests/zap.test.sh` reads the dashboard's `SESSION_COOKIE` and `SECURE_SESSION_COOKIE` from `apps/dashboard/src/lib/session-cookie.ts` and requires `run.sh`'s console scan to send that name. `bash infra/tests/zap.test.sh` (static half) exits 1: `FAIL - run.sh's console scan sends the console session as the dashboard's Secure cookie (expected '__Host-openverify_session', got 'openverify_session')`, 57 passed and 1 failed. Since `5152c662d` the console scan would have run unauthenticated.
- GREEN: `security/zap/run.sh`'s `do_console` sends `__Host-openverify_session=<token>`. `zap.test.sh` passes 58 of 58.

### 4.3 The SDK host-test floor, 2,732 to 2,739 (fix-clients' count)

- RED `be451d761`: `infra/tests/ci-workflow.test.sh`'s floor cases pass at 2,739 and fail at 2,738 and at 11A's 2,732. `bash infra/tests/ci-workflow.test.sh` (10.2 s; gitleaks, openssl and actionlint on PATH) exits 1: `FAIL - android: the test-count floor fails with one test fewer than 11F's floor (2738) (exit 0: ... the floor is 2732)` and the same at 2,732. 530 passed and 2 failed.
- GREEN: `.github/workflows/ci.yml`'s floor step reads 2739, with the count's history. 532 of 532, 0 skipped. The demo's (97 and 9), openverify-nfc's (116) and openverify-face's (51) floors are unchanged, because their counts did not rise. The device minimums 14, 2, 2 and 4 are also unchanged. This session's Validation step 9 counts the host tests again with `--rerun`.

### 4.4 The records the fixers' changes moved (no generator; each read against the fixer's commit)

- Threat model: B13-T4 adds the hydrated-field rule (F001/F002, `cdc7700c8`); B4-R2 moves from gap to control (KP11-26 `2cc6c1679`, KP11-90 `b40215b5a`); B10-D2 moves from gap to control (KP11-91 `29b8d0b7a`); BX-I1 stays a gap, with the console and the flow server reviewed (KP11-80) and vision and the code runner open (KP11-74); B3-I6 stays a gap, with the report and transaction redactions done (KP11-27, part).
- `docs/security/logging.md`: the console's page error boundary (KP11-80, `9fab409bf`), and which processes were reviewed.
- `docs/connect/share-tokens.md`: the hydrated fields left out of a share. `provenance.md`, `client-side.md`, `limits.md`, `peek-and-redeem.md`, `connections.md` and `docs/compliance/roles.md` now say that KP11-19, -20, -10 and the clone gaps are open after Workflow 11F, carried to the next release, instead of "carried to 11F".
- `docs/compliance/access-requests.md` and `retention.md`: KP11-27's part fix. `docs/self-hosting/sso.md`: the console shows the provider's `amr`.
- `docs/android/release-and-support.md:84,90`: the SDK ships no consumer rule since KP10-56 (`f580f20d1`); `android/openverify-sdk/consumer-rules.pro` has 0 active lines, nfc's 6 and face's 1.
- `docs/calibration/load-phase11.md:757`: `lists-import` stayed open in 11F as KP11-52.

`docs:all` changes nothing, and the docs-tools suite passes 428 of 428.

## 5. The met-row result (C274.3, review H15)

The documentation lens checked 22 met rows in depth (and all 148 ASVS and 12 MASVS met rows by script) and found two unsupported, both in V16. I read both against the code at `f042f5365`. `apps/api/src/logger.test.ts` and `apps/api/src/jobs/logger.test.ts` cover pino in the API and the worker only. `docs/security/logging.md` says vision logs through Python logging and uvicorn's plain-text access log, and no test covers another process's format. So:
- `v5.0.0-16.2.4`: met becomes partial. Its reason: JSON lines for the API and the worker only, and vision's access log is plain text (KP11-74).
- `v5.0.0-16.4.1`: met becomes partial. Its reason: log-injection protection is shown for the pino processes only, and vision's access log and tracebacks are raw text (KP11-74).

Each has `reviewed_at` 2026-11-21 and `reviewed_commit` `f042f5365`. `docs:security` re-renders `docs/security/asvs-summary.md`: V16 goes from 9 met and 5 partial to 7 and 7, and all rows from 148 met and 38 partial to 146 and 40. `docs:selfhost` and `docs:release` change nothing, since neither row is an operator row. The docs-tools suite passes 428 of 428. MASVS: no row was unsupported, so nothing changed.

## 6. The checklist rows the 11F fixes moved, and the stale rows reviewed again (C274.6)

`pnpm release:check` at the start listed 34 `security/stale-evidence` rows: rows whose cited test or page the fixers changed after `reviewed_commit` `7d813b436`. I read each row's claim against its evidence at `08e9a7104` (after the met-row commit).
- Moved, each with its fixer's test: `v5.0.0-1.3.11` partial to met (`apps/api/src/mail/index.test.ts`, KP11-72); `3.3.1` and `3.3.3` partial to met (`__Host-openverify_session`, KP11-78); `3.4.4` partial to met (`apps/api/src/http/nosniff.test.ts`, KP11-70); `13.4.4`, `15.3.6` and `15.3.7` partial to met (`apps/api/src/http/request-hardening.test.ts`, KP11-72); `15.2.3` partial to met (`apps/api/src/commands-build.test.ts` and `images.test.sh`, KP11-71). `4.1.2` stays partial, with KP11-81 open and the Gateway path of KP11-84. `6.8.4`'s note says that the console now shows the provider's `amr`. `16.3.1` and `16.3.2` stay partial (KP11-72's open half). MASVS-RESILIENCE-3's note now says the SDK ships no consumer rule (KP10-56).
- Still true as written, reviewed again: the other 27 ASVS rows of the 34, MASVS-CRYPTO-1 (only `ConsentDigests.kt`'s comment changed, KP11-79), and the five rows my own page edits made stale (`15.1.3`, `16.1.1`, `16.2.3`, `16.4.3` and MASVS-CODE-2).

Every one has `reviewed_at` 2026-11-21 and the commit I read. `docs:security` re-renders the summary: ASVS 154 met, 32 partial, 7 gap, 51 not applicable and 9 operator (253 in all). `docs:selfhost` and `docs:release` change nothing. The docs-tools suite passes 428 of 428. `pnpm release:check` then exits 0 with 0 errors and 75 owner items, no stale row among them.

## 7. The release records (C284; decision 14 before 11F), first pass before the Validation

### 7.1 The checklist test that assumed 11E (a borrowed edit of `packages/docs-tools`, fix-server's path)

- RED: after setting the known items 11F fixed to `done` (below), the docs-tools suite fails 1 of 428: `src/release/checklist.test.ts > the committed checklist > marks no line done in 11E that waits on the owner, CI or a later Workflow`, `expected [ { id: 'KP11-26', … }, …(6) ] to deeply equal []`. The test required every `KP` line to be not `done`. That held in 11E, but 11F's own records rule requires the opposite: decision 14 before 11F has a line set to done when a fixer reports its item fixed.
- GREEN (minimal): the owner steps (`O01`-`O09`) and E002 are still never done, and no `KP` line dated 11E (`2026-11-20` or before) may read done. A `KP` line set from 11F on may. `src/release/checklist.test.ts` passes 15 of 15. `eslint` and `tsc --noEmit` are clean, and prettier was run on the file.

### 7.2 The lines moved

`docs/release/checklist.md` (As of 2026-11-21), the 82 lines moved before the Validation:
- done: 7C-R010 (KP11-91), 8D-R007 (KP11-95), KP11-26, KP11-30 (decided), KP11-66, KP10-15, KP10-53, KP10-55 (decided), KP10-56;
- owner: K8-25 (KP11-93, with the measured size), KP11-38 (a budget unit), KP10-57 (with KP10-17);
- ci-pending: B14 (the notes wait on the staged run for the digests);
- open, with the next release or its owner named: 8-R006, K8-32, EF-CARDSECURITY, YUNET-HOST-TEST and every fixer item reported open, each with its reason;
- new lines for the known items 11F leaves open: KP11-69, KP11-72, KP11-74, KP11-81, KP11-88 and KP11-89;
- the 21 open 11D rows: "the next calibration", since 11F re-measured none;
- KP11-39, KP11-40 and KP11-42 with what 11F met.

B03, B05, B06, B09 and DEVICE-PROOFS wait for the Validation below. `docs:release` re-renders `docs/release/notes.md`: 156 lines, of which 19 done, 82 open, 50 owner and 5 ci-pending. `pnpm release:check` exits 0 with 0 errors and 79 owner items.

## 8. Validation failures met and fixed test-first

### 8.1 `readiness.integration.test.ts`'s afterAll hung (new; fix-server's `apps/api`)

- Met: Validation step 7, `pnpm exec vitest run --config vitest.integration.config.ts --project api --shard=2/3`, rc 1 in 319 s at load 16.78 at the start and 2.14 at the end. All 139 tests passed, but `FAIL src/http/readiness.integration.test.ts`, `Error: Hook timed out in 180000ms` at the `afterAll` (`readiness.integration.test.ts:51`). It was not retried.
- Alone it passes in 12 s at load 1.68.
- Cause (mechanism established by a probe outside the tree, `/tmp/claude-1000/fr/probe/hang.mjs`): a `pg` pool with no connection or query timeout, whose client waits on a peer that accepts and never answers, keeps `pool.end()` waiting forever. Without a timeout the probe still waited after 8 s; with `connectionTimeoutMillis: 2000` it ended in 1,001 ms. The test stops its own Postgres and then asks `/ready` once more. The probe answers `unavailable` after its 1 s race and the test passes, but the pool's pending connect or query stays open until the hook's `pool.end()`. A stopped container's mapped port normally refuses at once (`/tmp/claude-1000/fr/probe/port.mjs`: `ECONNREFUSED` in 4-5 ms), so the hang needs the window in which the forwarder still accepts, or a socket whose close never arrived. That is why it was met under load and is not reproduced alone.
- Stub `02c021c17`: the test's pool moves to `apps/api/src/test-support/store-pool.ts` (`storePool`) with unchanged options.
- RED `d6e4d30f0`: `src/test-support/store-pool.test.ts` points the pool at a loopback server that accepts and never answers. `× ends within 5 s while a query waits on a peer that never answers 5525ms`, `AssertionError: expected 'still waiting' to be 'ended'`.
- GREEN: `storePool` sets `connectionTimeoutMillis: 2_000` and `query_timeout: 2_000`. The unit test passes 1 of 1, and the integration test alone passes 1 of 1. No guard or hook timeout was raised, and the 1 s `/ready` deadlines are unchanged. The production pools (`apps/api/src/container.ts:280`, `worker.ts:1835`) also set no connection timeout. That is a followup for fix-server's successor, not changed here.

## 9. CI read once (rule 25; step 5)

- `gh run list --workflow ci.yml --branch main --limit 5`: the five newest runs, the 11E push's `44854752893` on `b45a0a498` among them, are each "completed failure" in 5 to 11 s. `gh run view 44854752893 --json jobs`: 19 jobs, and no step started in any of them. `gh run list --workflow release.yml --limit 3`: no run.
- No completed run measured a job, so no job time is new. No job is split or rebalanced, since nobody splits on an estimate, and the android job's time waits on KP10-59. The floors move only where a count rose: the SDK floor is now 2,739 (4.3). The `release.yml` and `android-release.yml` dispatches are the orchestrator's and stay recorded open.

## 10. The Validation as run (2026-11-21; Intel Xeon E5-1650 v3, 12 logical CPUs, 31.3 GiB, WSL2 with Docker Desktop; alone on the machine)

Times in seconds; the load is the 1-minute load before and after the call; the lock wait is the time until `flock` returned, under the Gradle, e2e or device lock. "-" means no lock was held. The exit code is read from the command itself, never through a pipe; every output went to a file under `/tmp/claude-1000/fr/out/`.

| Step | Call | rc | s | Wait | Load | Result |
|---|---|---|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` (pnpm lock) | 0 | 0 | - | 1.68 | up to date; no `minimumReleaseAgeExclude` |
| 1 | `pnpm format:check` | 0 | 130 | - | 1.63->2.23 | clean |
| 2 | forced typecheck | 0 | 205 | - | 2.13->5.79 | 20 of 20 |
| 2 | forced lint api / dashboard and contracts / the other 17 | 0, 0, 0 | 261, 249, 392 | - | 5.40->2.86 | pass |
| 3, 4 | fetches; `build:variant-groups` | 0, 0 | 1, 7 | - | 2.45 | present; `29d05838...3bfb` |
| 5 | db; watchlist and e2e | 0, 0 | 190, 294 | - | 2.50->2.17 | 2,395; 840 and 161 |
| 5 | dashboard shards 1/2, 2/2, merge | 1, 1, 0 | 224, 250, 7 | - | 1.71->6.16 | shards exit 1 on partial coverage as expected; merge 7,384 in 623 files at 95.67% |
| 5 | the other 14 packages (one forced call) | 0 | 218 | - | 5.75->16.10 | docs-tools 428, react 55, flow 1,678, contracts 4,905, checks 3,858 and the rest |
| 5 | `@openverify/js` | 0 | 5 | - | 13.78 | 19 |
| 5 | API, 8 blob shards and merge (first run) | 1 x8, **1** | 202-253, 51 | - | 7.27-11.15 | **2 failed of 10,991**: `operator-patterns.test.ts`, `(a\|a)*` 103.138 and `^a*a*a*a*$` 120.12 ms against `CPU_BUDGET_MS * 2` (100 ms). This is KP11-38, met again: not retried for it, and the owner's (budget unit) |
| 5 | API, 8 blob shards and merge (again, after section 8's change to `apps/api`) | 1 x8, 0 | 186-265, 47 | - | 1.00-10.10 | 10,992 in 872 files at 93.43%. This passing run does not close KP11-38 |
| 6 | `benchmark:typecheck`, `benchmark:test` | 0, 0 | 68, 13 | - | 2.96->3.22 | 133 |
| 7 | integration db; graph; api 1/3 | 0, 0, 0 | 105, 37, 123 | - | 3.04->16.78 | 110; 13 (template 17.1 s); 121 |
| 7 | integration api 2/3 (first) | **1** | 319 | - | 16.78->2.14 | 139 passed; readiness afterAll hook 180 s (section 8.1, fixed) |
| 7 | integration api 2/3, 3/3 (after the fix) | 0, 0 | 186, 121 | - | 1.86->17.23 | 139; 196 |
| 8 | vision `uv lock --check`, ruff, format, mypy | 0 | 1 | - | 14.81 | clean |
| 8 | vision pytest, three parts | 0, 0, 0 | 161, 201, 326 | - | 14.81->2.74 | 836 + 903 + 986 = 2,725 at 97.46% |
| 8b | security/python pytest, ruff, format, mypy --strict (ci.yml's paths, the two ZAP helpers included) | 0 | 4 | - | 2.48 | 258 at 96.53% |
| 9 (1) | host tests ui, flow, rest, `--rerun` | 0, 0, 0 | 157, 48, 105 | 0.005 | 2.25->3.30 | 533 + 427 + 1,779 = **2,739**, none skipped |
| 9 (2)-(8) | screenshots `--rerun`; kover and ABI; unit and debug `--rerun-tasks`; release builds; SDK assemble; lint; device-test compile | 0 each | 55, 13, 161, 12, 12, 12, 119 | 0.005-0.007 | 3.11->9.86 | 97; pass; demo 97 and 9, nfc 116, face 51; `checkSmokeTestReferences` ran |
| 9 (9) | bundletool, 98 release-check tests, ELF, consumer rules, size | 0 | 14 | - | 9.86 | pass |
| 9 (10) | staging; consumer-check | 0, 0 | 11, 12 | 0.005 | 7.75 | pass |
| 9 (11) | sdk,nfc; sdk,face; sdk,nfc,face | 0, 0, 0 | 24 each | 0.005 | 6.75->5.57 | 97 each |
| 9 (12) | cyclonedxBom | 0 | 8 | 0.005 | 5.20 | 188, 195, 190 components |
| 9b | clean-build pass | - | - | - | - | skipped: `git diff --quiet 1746797ae HEAD -- android/*/*.lockfile android/settings-gradle.lockfile android/gradle/verification-metadata.xml android/consumer-check` exits 0 |
| 10 | `openapi:write` and the diff (`@openverify/node`, API fixtures); `workflow-docs:write` | 0, 0 | 23, 2 | - | 5.01 | no diff |
| 10b | `docs:all`, `git diff --exit-code docs` | 0 | 17 | - | 3.98 | no diff |
| 11 | mocked flow suite | 0 | 127 | 0.005 | 3.34->12.87 | 349 |
| 11 | stack down and build; stack up | 0; **1** | 1; 92 | 0.005 | 11.21 | the first start stopped on Next.js 16.4.2's own SecurityFatalError notice in `next build` (KP11-42, load 11.21). The notice's text was not acted on |
| 11 | stack down; stack up again | 0, 0 | 1, 95 | 0.005 | 3.87->4.52 | ready |
| 11 | chromium shards 1-4 | 0 x4 | 310, 364, 293, 409 | 0.005-0.006 | 4.24->3.51 | 50, 52, 47, 49, every test passing |
| 11 | console sweep; stackTest `--rerun`; stack down | 0, 0, 0 | 339, 71, 2 | 0.005-0.008 | 3.31->4.65 | 109; 3 of 3 |
| 11b | Docker WebKit theme-csp | 0 | 21 | 0.005 | 4.36 | 7 of 7 |
| 12 | images api, dashboard, flow, flow-noguidance, code-runner, vision | 0 each | 178, 136, 40, 37, 43, 2 | 0.005 | 5.87->3.32 | `26dfd560`, `6ecf33c5` (no notice), `485414dd`, `700027d5`, `571da304`, `af6ca441` (labelled `pending-owner`) |
| 13 | 35 `infra/tests/*.test.sh` (images.test.sh as 9 subcommands), the chart's 3 contracts, its files' tests | 0 each | 0-47 | - or 0.005 | 1.85-4.14 | ci-workflow 532, zap 58, images api 58 and vision 28 (F004 and KP11-71 GREEN live), compose 639, supply-chain-skeletons 112 with 13 skipped (its filled installers); chart contracts 47, 44, 72; chart files 15 |
| 14 | load/'s gate | 0 | 9 | - | 3.22 | 242 at 96.62% |
| 15 | `--verify-ids` | 0 | 0 | - | 3.03 | 253 and 24 |
| 16 | supply-chain.sh osv, pnpm-audit, pip-audit, zizmor, trivy-config, chart, pii, allowlist | 0 each | 3, 40, 3, 0, 5, 20, 6, 0 | - | 2.87->3.23 | 0 failing; 17 medium advisories (the H14 table); trivy-config's 12 medium misconfiguration checks (DS-0013, KSV-01010, KSV-0125) are below its high gate and are not advisories; zizmor offline (KP11-41) |
| 17 | chart-checks lint, unittest, kubeconform, trivy | 0 each | 2, 8, 3, 6 | - | 3.04 | 199 unittest cases under both Helms |
| 17b | kind 1.35: create, load, fixtures, models, install, smoke, upgrade, delete | 0 each | 38, 43, 92, 2, 30, 15, 51, 3 | 0.005-0.008 | 3.11->2.88 | pass (deploy/helm changed: KP11-84) |
| 17b | kind 1.37: the same | 0 each | 52, 52, 99, 2, 28, 15, 48, 3 | 0.005-0.006 | 2.88->3.71 | pass |
| 18 | images-mode stack up; `run.sh` prepare; 22 `api <group>`; `flow hosted noguidance`; `flow routes`; console; report; revoke; stack down | 0 each | 46; 5; 139-414; 62; 353; 77; 5; 3; 20 | 0.005-0.010 | 1.84-8.05 | rung (i); 26 scans; 116,932 requests, no 5xx; High 0, FAIL-rule alerts 0; Medium 5 (10202), Low 23 (10044 1, 10055 4, 40014 18); rule 10021 gone after KP11-70; every credential refused after revoke; the holder's stack down took 20 s, with no crash |
| 19 | `pnpm release:check` (default) | 0 | 5 | - | 3.44 | 0 errors, 85 owner items (five of them H14 advisories past 90 days) |
| 20 | the benchmarks | - | - | - | - | skipped: 11F's diff touches no workflow engine, vision pipeline or analytics query (its `apps/api` changes are the nosniff hook, the ASN cache, OIDC `amr`, sessions, peek, redaction and a comment) |
| 21 | `gitleaks git --redact .`; PII filter over the tree and history | 0, 0, 0 | 12, 6, 12 | - | 4.06 | 8,049 commits, no leaks; 0 kept of 1,205 and of 1,641 |
| 21b | anchored stub grep; `docs:stubs`; `draftsRemaining`, `missingFromTree` | 1 (pass), 0 | 4 | - | 3.91 | nothing; 0 written; 0 and 0 |
| 22 | `:openverify-sdk:connectedAndroidDeviceTest` (device lock, phone reached: `device`) | 1 | 1,534 | 0.009 | 2.97 | **7 of 14** (the instrumentation's XML): 7 failed, 0 skipped. The call ran past the 10-minute cap, because each activity and camera test waited 2 to 8 minutes for a screen the phone never showed |
| 22 | `:openverify-nfc:connectedDebugAndroidTest`; `:openverify-face:connectedDebugAndroidTest` | 1, 1 (KP10-31) | 50, 317 | 0.005-0.008 | 6.54, 3.48 | 2 of 2; 4 of 4 (XML) |
| 22 | `:demo-app:connectedMinifiedSmokeAndroidTest` | - | - | - | - | not run: it needs an unlocked screen (below) |
| 2, 1 | forced lint api and forced typecheck again on the final tree | 0, 0 | 250, 168 | - | 4.72->6.91 | pass |

**Step 22 in detail.** The SDK's 7 passing tests are ZxingCppBarcodeReaderDeviceTest 4, NfcPlatformDeviceTest 2 and IntegrityProbesDeviceTest 1. The 7 failing tests each need an activity on screen:
- CameraXCaptureCameraTest `takesAnUprightJpegAfterThePreviewStarts`, and CameraXFramePipelineTest's three tests: `ComposeTimeoutException: Condition still not satisfied after 120000 ms` or `60000 ms`, the preview never started.
- NfcTapLifecycleDeviceTest `leavingTheAppDuringATapTurnsTheReaderOffAndComingBackTurnsItOnAgain`, and CaptureScreenLayoutDeviceTest's two tests: `IllegalStateException: No compose hierarchies found in the app`.

`(cd android && bash ../infra/scripts/check-connected-results.sh . openverify-sdk=14 demo-app=2 openverify-nfc=2 openverify-face=4)` exits 1: `connected tests did not all pass: 7 failures, demo-app: 0 connected tests ran, at least 2 expected`. After the run, a read-only check of the phone's state (`dumpsys power`, `dumpsys window`) shows `mWakefulness=Dozing` and `isKeyguardShowing=true`: the screen was off and locked.

No agent unlocks the owner's phone or changes its settings (rule 26). So the 7 tests and the demo's 2 smoke tests are "device proof open", and nothing was re-run. The device is a Pixel 9 on Android 17, the commit `9294d5289`. These same 14 SDK tests passed 14 of 14 at the 11C close, and 11F's `android/` changes (KP10-56, KP10-53, KP11-79) touch no activity, camera or Compose code.
