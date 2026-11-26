# Phase 11, Workflow 11G Stage 3: integration-11g

Written by `integration-11g` (Workflow 11G Stage 3, alone and last) on 2026-11-21, on start `4b3a06a0f` and the Stage 2 head `db2cd3e61`. Every command below ran in this session in the foreground; outputs are abbreviated, never paraphrased into a pass. Nothing was pushed, published, signed, attested or dispatched, and no repository setting changed.

## 0. The start

- `git log --oneline 4b3a06a0f..HEAD | wc -l` → 39 (contracts-11g 10, publish-11g 6, codeql-11g 3, records-11g 20); the working tree clean but for an untracked file that is not this Workflow's.
- `pnpm release:check` (default) → exit 0, `release:check (default): 0 errors, 72 owner items` (owner-state Q6, Q7, Phase 10 P4; version 6; licence-row 1, KP11-39; medium-advisory 5; staged-run 1; the rest checklist-state, Q1-Q12 still `owner`).
- The Validation's conditions, from `git diff --quiet 4b3a06a0f HEAD -- <paths>`: 9b (Android lockfiles and verification metadata) exit 0, skipped; 17b (`deploy/helm infra/docker services/vision/Dockerfile .dockerignore`) exit 1, run; 22 (`android`) exit 0. The 11G decisions item 20 closes 11F's nine device proofs by the orchestrator's 22 of 22 and runs step 22 only under the PHONE rule (an 11G commit reached `android/`), so step 22 is skipped and nobody runs adb.

## 1. Integration fixes (deliverable 1), each test-first

### 1.1 The UN opt-in route's OpenAPI description (records-11g contract deviation 1; Q10)

- RED `df58a091c`: `apps/api/src/openapi-11b.test.ts` "documents the install switch and its default true, not the locked default of 11B", read from the committed `docs/api/openapi.json`.
  `pnpm exec vitest run src/openapi-11b.test.ts` → exit 1: `× documents the install switch ... AssertionError: expected 'C254.1: records the acknowledgement o…' to contain 'OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED'`; `Tests 1 failed | 17 passed (18)`.
- GREEN `78dd13fda`: the route's description and header comment in `apps/api/src/routes/dashboard/watchlist-opt-in.ts` name the switch and its default true since Q10 (false locks the list); `pnpm openapi:write` (26 s) changed one line of `openapi.json`. `vitest run src/openapi-11b.test.ts src/openapi.test.ts src/routes/dashboard/watchlist-opt-in.test.ts` → exit 0, `Tests 38 passed (38)`. `docs:catalog` → exit 0 and no diff.

### 1.2 The publish job runs only for a dispatch of main at the job level (publish-11g contract deviation 1)

- RED `8c77004cf`: `infra/tests/release-workflow.test.sh` gains "publish: only for a dispatch of main, at the job level, before the reviewer is asked"; `infra/tests/ci-workflow.test.sh`'s exact check expects `vars.OPENVERIFY_PUBLISH == 'true' && github.ref == 'refs/heads/main'`.
  `bash infra/tests/release-workflow.test.sh` → exit 1, `FAIL - publish: only for a dispatch of main, at the job level ... (vars.OPENVERIFY_PUBLISH == 'true')`, `# 141 passed, 1 failed`; `bash infra/tests/ci-workflow.test.sh` → exit 1, `FAIL - release.yml: publish runs only when vars.OPENVERIFY_PUBLISH is 'true' and only for a dispatch of main`, `# 547 passed, 1 failed` (11 s).
- GREEN `b4fdb4fef`: `release.yml`'s publish `if:` is `vars.OPENVERIFY_PUBLISH == 'true' && github.ref == 'refs/heads/main'`; the first-step main check stays. release-workflow → `# 142 passed, 0 failed`; ci-workflow → `# 548 passed, 0 failed`; `supply-chain.sh zizmor` → exit 0. docs-tools' real-tree switch test (`switches.test.ts`, which reads the job's `if:` exactly) failed on the new condition and was changed with it (rule 12): `vitest run src/switches.test.ts` → `Tests 6 passed (6)`. `docs:selfhost` and `docs:release` → no diff.

### 1.3 The load stack's UN opt-in check named for what it holds (records-11g contract deviation 5)

- `fc503b725`: `infra/tests/load-compose.test.sh`'s check "keeps the UN opt-in locked (Q10)" is now "sets no UN opt-in switch of its own (Q10 granted; it inherits compose's default true)"; what it asserts is unchanged. `bash infra/tests/load-compose.test.sh --static-only` → exit 0, `# 103 passed, 0 failed, 1 skipped`.

### 1.4 The release notes show a decided owner item as decided (deliverable 3)

The notes rendered each granted Q item with C289's "built meanwhile" column (for Q8 "the neutral page", which no longer exists; for Q10 "the locked switch"), so a reader saw a grant beside what was built while it was pending.

- RED `61df2e734`: `notes.test.ts` "shows a granted item as built under its grant, from its checklist line, never the pending column". `vitest run src/release/notes.test.ts` → exit 1, `× shows a granted item ...`, `Tests 1 failed | 13 passed (14)`.
- RED `0db8c2500`: "shows a declined item with the outcome the release ships and what was built for it" → exit 1, `Tests 1 failed | 14 passed (15)`.
- GREEN `10aa36889`: `ownerSection` renders a granted item as "Built under the grant: <its checklist line>. If the owner reverses it: <C289's decline column>", a declined one as "The release ships the decline outcome: ... Built: <its line>", and a pending one as before. `vitest run src/release` → `Tests 84 passed (84)`; `pnpm turbo run lint typecheck test --force --filter=@openverify/docs-tools` → exit 0, `Tests 444 passed (444)`, all files 97.74% statements.

## 2. The release checklist (deliverable 2) and the notes (deliverable 3)

Committed with 1.4's GREEN (`10aa36889`), then `docs:release`:

- Q1, Q2, Q3, Q4, Q5, Q8, Q10, Q11 and Q12: `done`, each with what was built, its commits and evidence; Q2-Q4 say "wired, not yet published" (rule 10). Q9: `done` as declined with C289's outcome; CodeQL informational, public repository only, outside decision 69's bar, never run. Q6 and Q7: `owner`, needing counsel, with their defaults.
- LIC-NODEMAILER, LIC-JUNIT4, LIC-LOCUST and KP11-31: `done`. B10, B13, B14, O05-O08, KP11-42 and CLAUDE-WORDING: brought to 11G (states unchanged: B13 waits only on KP11-39).
- New lines: KP11-96 (`done`), KP11-97 to KP11-102 (`open`); the section "Release-time owner steps" with REL-VISIBILITY, REL-ENVIRONMENT, REL-GHCR and REL-NPM (`owner`), REL-README (`open`, after the first publication) and D69-CI (`ci-pending`, decision 69's bar, CodeQL outside it).
- The Phase 10 lines P10-P1 to P10-P5, the Phase 10 release-gate lines (KP10-16, -17, -58, -59, -60, -61, E002, KP11-9) and N7A-8 unchanged: owner or ci-pending with their defaults.
- `pnpm release:check` → exit 0, `0 errors, 67 owner items`.

### 2.1 ASVS rows reviewed again (C274.6)

1.1's `openapi.json` and 1.2's `release-workflow.test.sh` made v5.0.0-1.1.1, 2.1.1, 15.1.2 and 15.2.1 stale (`security/stale-evidence`, 76 owner items). Each was read again against the change (a description text; a job-level branch condition), holds at its status, and carries `reviewed_commit` `10aa36889` (`f580ea793`); `docs:security` re-rendered `asvs-summary.md`. `pnpm release:check` → exit 0, `0 errors, 63 owner items`.

## 3. The plan amendments (deliverable 4)

- `7053a67e7`: "## Workflow 11G Stage 2 amendments" with publish-11g (7 items), codeql-11g (5) and records-11g (8).
- "## Workflow 11G Stage 3 amendments (integration-11g)": after the Validation (section 4).

## 4. The Validation (deliverable 5)

Run in ORDER_14 with VALIDATION's step numbers, every call in the foreground and alone on the machine (Intel Xeon E5-1650 v3, 12 logical CPUs, 31.3 GiB, WSL2), on the tree at `f580ea793` to `b13148bf7` (the code was final at `f580ea793`; later commits are this file, the ADR wording fix of 4.13, the DAST report and the checklist). Heavy calls ran through `/tmp/openverify-heavy.sh` with `OPENVERIFY_HEAVY_RESERVED=1`; e2e, image, kind and ZAP calls under `flock -E 75 -w 240 /tmp/openverify-e2e.lock` (the stack up with `-w 120`); Gradle calls under `flock -E 75 -w 240 /tmp/openverify-gradle.lock`. Each gate is the command's own exit code, read from a log file, never through a pipe. Times are wall seconds; loads are `/proc/loadavg`'s 1, 5 and 15-minute figures at the start and the end of the call. Every lock wait was 0.003 to 0.006 s (the stackTest's Gradle lock 0.019 s).

| Step | Call | Exit | Time (s) | Load start → end | Result |
|---|---|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` (pnpm lock) | 0 | 0.3 | 1.54 | lockfile up to date; no `minimumReleaseAgeExclude` |
| 1 | `pnpm format:check` | 0 | 124 | 1.54 → 2.45 | all files formatted |
| 2 | forced typecheck, one call | 0 | 177 | 2.34 → 7.09 | 20 of 20 tasks |
| 2 | forced lint `--filter=@openverify/api` (4 GB heap, `--concurrency=1`) | 0 | 261 | 6.60 → 2.75 | 1 task |
| 2 | forced lint dashboard and contracts | 0 | 242 | 2.61 → 2.63 | 2 tasks |
| 2 | forced lint, the other 17 packages | 0 | 377 | 2.50 → 2.64 | 17 tasks |
| 3 | `fetch_models.py`, `fetch_data.py`, `fetch_fixtures.py --only person_a_id` | 0, 0, 0 | 1 | 2.51 | every file present, checksums held |
| 4 | `build:variant-groups` | 0 | 7 | 2.51 | sha256 `29d05838…3bfb`, 156,706 groups |
| 5 | db | 0 | 188 | 2.43 → 10.71 | 2,395 tests, 90% statements |
| 5 | watchlist and e2e | 0 | 284 | 9.94 → 2.31 | 840 (98.64%) and 161 (96.87%) |
| 5 | dashboard shards 1/2 and 2/2, merge | 1, 1, 0 | 223, 239, 7 | 2.11 → 8.30 | a lone shard exits 1 on partial coverage (rule 8); merge: 7,384 tests in 623 files, 95.67% |
| 5 | the other 14 packages, one forced call | 0 | 213 | 6.82 → 15.41 | ui 58, emrtd 338, flow-spec 527, signals 192, core 2,008, config 459, demo-web 18, node 508, workflow-engine 2,042, docs-tools 444, checks 3,858, contracts 4,905, react 55, flow 1,678 |
| 5 | `pnpm --filter @openverify/js test` | 0 | 5 | 14.26 | 19 |
| 5 | the API, 8 blob shards and a merge | 1 ×8, 0 | 178-224 each, merge 44 | 12.29 → 5.36 (shards at 7.4 to 12.3) | 11,009 tests in 872 files, 93.43%, none failed in any shard; KP11-38 not met |
| 6 | `benchmark:typecheck`, `benchmark:test` | 0, 0 | 64, 13 | 5.01 → 3.83 | 133 tests (rule 16: 11G changed `jobs/reports/screening.ts`) |
| 7 | integration db | 0 | 238 | 3.60 → 2.54 | 110 |
| 7 | integration graph | 0 | 35 | 2.41 → 3.05 | 13; template 225,000 rows in 15.9 s of 180 |
| 7 | integration api 1/3, 2/3, 3/3 | 0, 0, 0 | 104, 176, 119 | 2.89 → 16.14 | 121, 139, 196; no container retry |
| 8 | vision `uv lock --check`, ruff, ruff format, mypy | 0 | 1 | 14.92 | clean |
| 8 | vision pytest parts 1, 2, 3 | 0, 0, 0 | 144, 177, 309 | 13.01 → 2.36 | 836, 903, 986 = 2,725; 97.46% |
| 8b | security/python pytest, ruff check, ruff format, mypy --strict (ci.yml's paths) | 0 ×4 | 4 | 2.06 | 259 tests at 96.53% (records-11g's Locust case is the 259th) |
| 9 (1) | `testAndroidHostTest -PhostTestGroup=ui|flow|rest --rerun` | 0, 0, 0 | 155, 45, 101 | 1.89 → 3.35 | 533 + 427 + 1,779 = 2,739, none failed or skipped (the floor) |
| 9 (2) | `screenshotTest -Proborazzi.test.verify=true` (again with `--rerun`) | 0, 0 | 12, 53 | 3.16 → 3.71 | 97 |
| 9 (3) | `koverVerify checkKotlinAbi` | 0 | 13 | 3.22 → 3.83 | passed; no dump changed |
| 9 (4) | `testDebugUnitTest assembleDebug`, then `testDebugUnitTest --rerun` | 0, 0 | 13, 49 | 3.71 → 6.00 | demo 97 and smoke twins 9, nfc 116, face 51 |
| 9 (5)-(8) | the release AARs and bundle; `:openverify-sdk:assemble`; `lint`; the device-test compile | 0 ×4 | 14, 12, 15, 19 | 5.38 → 7.07 | passed |
| 9 (9) | `fetch_bundletool.py`; the release checks' tests; elf, consumer-rules and size checks | 0 ×3 | 14 | 6.58 → 6.23 | 98 tests OK; check-size passed |
| 9 (10) | `publishAllPublicationsToStagingRepository`; `-p consumer-check build` | 0, 0 | 12, 12 | 5.82 → 6.38 | passed |
| 9 (11) | `-PopenverifyDemoArtifacts=sdk,nfc|sdk,face|sdk,nfc,face :demo-app:testDebugUnitTest` | 0 ×3 | 24 each | 5.63 → 5.49 | passed |
| 9 (12) | `cyclonedxBom` | 0 | 8 | 5.49 → 5.03 | 188, 195 and 190 components |
| 9b | the clean-build pass | skipped | - | - | `git diff --quiet 4b3a06a0f HEAD -- android/*/*.lockfile android/settings-gradle.lockfile android/gradle/verification-metadata.xml android/consumer-check` exits 0 |
| 10 | `openapi:write` and `git diff --exit-code docs/api/openapi.json packages/node contracts/fixtures/api` | 0 | 23 | 4.71 | no diff |
| 10 | `workflow-docs:write` and `git diff --exit-code docs/workflows` | 0 | 2 | 3.86 | no diff |
| 10b | `docs:all` and `git diff --exit-code docs` | 0 | 17 | 3.63 | no diff |
| 11 | the mocked flow suite | 0 | 130 | 3.19 → 12.06 | 349 passed |
| 11 | stack down and the turbo build; `e2e:stack:up` | 0, 0 | 1, 99 | 9.61 → 3.80 | up on the first start; no `next build` stop (KP11-42 not met: Next.js 16.4.5) |
| 11 | chromium shards 1/4 to 4/4 | 0 ×4 | 306, 359, 304, 402 | 3.57 → 2.57 | 50, 52, 49, 48 = 199 (the new `un-opt-in.spec.ts` in shard 4), every test passing; no shard near 8 minutes |
| 11 | console sweep `--no-deps` | 0 | 320 | 2.44 → 3.44 | 109 |
| 11 | `:openverify-sdk:stackTest` (e2e lock outside, Gradle lock inside) | 0 | 49 | 3.24 → 3.31 | 3 of 3, executed this session |
| 11 | `e2e:stack:down` | 0 | 3 | 3.60 | stopped |
| 11b | WebKit theme-csp through Playwright's server image (1.64.1 by digest), container removed | 0 | 21 | 2.86 → 3.80 | 7 of 7 |
| 12 | api, dashboard, flow, flow `-noguidance`, code-runner, vision at `11c-local` | 0 ×6 | 160, 125, 36, 34, 40, 2 | 3.58 → 4.32 | digests below; no Next.js notice in the dashboard's build |
| 13 | 36 `infra/tests/*.test.sh` (images.test.sh as nine subcommands, zap.test.sh also `--docker`), the chart's three contracts, the chart files' unittest | 0 (adr-deployment 1, then 0 after 4.13) | 0-58 each | 1.63-3.58 | compose 639, ci-workflow 548, release-workflow 142, codeql-workflow 95, supply-chain 141, supply-chain-skeletons 114 (13 skipped), load-compose 118, images static 149, pins 28, override 33, api 58, dashboard 27, flow 33, flow-noguidance 32, vision 28, code-runner 27, zap 58 and `--docker` 60, chart contracts 47, 44 and 72, chart files 15 |
| 14 | `load/`'s gate | 0 | 9 | 2.25 | 242 at 96.62% |
| 15 | `fetch_asvs.py --verify-ids`, `fetch_masvs.py --verify-ids` | 0 | 0.2 | 2.21 | 253 and 24 ids |
| 16 | `supply-chain.sh` osv, pnpm-audit, pip-audit, zizmor, trivy-config, chart, pii, allowlist | 0 ×8 | 3, 34, 2, 0.3, 4, 20, 6, 0.1 | 2.19 → 3.08 | osv 14 findings, 0 failing, 5 allowlisted, 9 medium reported (each already in the H14 table); pnpm-audit signatures verified; zizmor offline |
| 17 | `chart-checks.sh` lint, unittest, kubeconform, trivy | 0 ×4 | 2, 8, 3, 6 | 2.92 → 2.79 | passed |
| 17b | `kind.sh` for 1.35 (v1.35.8) then 1.37 (v1.37.0): create, load, fixtures, models, install, smoke, upgrade, delete | 0 ×16 | 1.35: 39, 42, 82, 5, 30, 15, 49, 3; 1.37: 41, 53, 90, 2, 30, 15, 47, 4 | 2.51 → 3.39 | every subcommand passed (run because 11G changed `deploy/helm/`, `infra/docker/` and the vision Dockerfile) |
| 18 | DAST: images-mode stack up; `run.sh prepare`; `api <group>` for each of the 22 groups; `flow hosted noguidance`; `flow routes`; `console`; `report`; `revoke`; stack down | 0 for every call | up 47; groups 137-401; flow 51 and 329; console 60; report 4; revoke 2; down 14 | 1.86-3.13 for the scans | `docs/security/dast-2026-11-22.md`: 26 scans, 117,217 answers, no 5xx; High 0, FAIL 0, Medium 5, Low 23, each triaged not a defect; rung (i); every credential refused after revoke |
| 19 | `pnpm release:check` (default) | 0 | 5 | - | 0 errors, 63 owner items (section 5) |
| 20 | the workflow, vision and analytics benchmarks | skipped | - | - | `git diff 4b3a06a0f HEAD` touches no workflow engine, vision source or tool, analytics query or migration; 11G's vision changes are the image's uv and Python bases, not the host-run benchmarks' code |
| 21 | `gitleaks git --redact .` (stack down); the PII filter over the tree (`dir .`) and history (`git .`) | 0, 0, 0 | 12, 6, 11 | 2.42 → 3.42 | 8,108 commits, no leaks; 0 kept of 1,205 and of 1,641 |
| 21b | `grep -rlnE '^Draft: written in Workflow 11E' docs SECURITY.md`; `draftsRemaining` and `missingFromTree` over the tree | 1 (nothing found), 0 | 1 | - | `{"drafts":[],"missing":[]}` |
| 22 | the device suites on the phone | skipped | - | - | `git diff --quiet 4b3a06a0f HEAD -- android` exits 0, and the 11G decisions item 20 runs step 22 only when an 11G commit reached `android/`; nobody ran adb |

Image digests (step 12; `docker build -q`, the containerd store's image ids): api `sha256:19cef854…a3f6`; dashboard `sha256:74794523…ba0`; flow `sha256:1dc61443…20ce`; flow-noguidance `sha256:61fc8de4…c87d`; code-runner `sha256:17d60430…7f0c`; vision printed `sha256:f0d4266b…a778` from a full cache hit of records-11g's build of the same inputs, whose image id the DAST report records, `sha256:0d32312e…ea99`.

### 4.13 A Validation fix: ADR 0010's rule 4 lost its "nothing is signed" sentence

- RED (the contract, unchanged): `bash infra/tests/adr-deployment.test.sh` in step 13 on the tree at `f580ea793` (as at records-11g's `db2cd3e61`) → exit 1, `FAIL - rule 4 names the honest state of this release`, `# 25 passed, 1 failed`. records-11g's `c5f9973b4` had reworded the sentence to "Nothing is pushed, signed or attested until …", so the phrase the contract holds was gone.
- GREEN `787632ea6`: the sentence reads "it publishes nothing by itself, and nothing is signed, attested or pushed until the owner's release step …"; `adr-deployment.test.sh` → `# 26 passed, 0 failed`; `release:check` → 0 errors. No test changed.

### 4.18 DAST

The images-mode stack came up in 47 s on the six images of step 12 (rung (i): this host reached it; ZAP on the host network; no override edited). The run directory was `/tmp/openverify-zap/run-11g` (mode 0700, outside the repository), so 11F's revoked run directory was left as it was. Every API group finished 38 of 38 active rules but api-webhooks (34 of 38, capped at 6 minutes, as in 11F). Two ZAP exits of 1 (api-logs, api-dashboard-sign-in) are rule 40014-2's Low weakness, which rules.tsv's FAIL gate reports only at Medium or above (Workflow 11F Stage 1 amendment 5); `run.sh` exited 0 for both. The 429 answers are rate-policy answers (api-webhooks 370, api-flow 5,582), never findings. Against fix-records' baseline (26 scans, 116,932 answers, High 0, FAIL 0, Medium 5, Low 23): the same verdict. The report passed gitleaks with both configurations, and `docs/security/README.md` indexes it beside 11F's.

## 5. release:check at the end

`pnpm release:check` (default; never `--tag`) → exit 0, `0 errors, 63 owner items`: checklist-state 47, version 6 (0.0.0 against 0.1.0 in the root, `@openverify/node`, `@openverify/js`, `@openverify/react` and `CLIENT_USER_AGENT`; `android/CHANGELOG.md` undated), medium-advisory 5 (esbuild, httpclient, commons-lang3, bcpkix-jdk18on, opentelemetry-api's GHSA-rcgg-9c38-7xpx, each past 90 days), owner-state 3 (Q6, Q7, Phase 10 P4), licence-row 1 (KP11-39), staged-run 1. So `--tag` would still refuse: Q6, Q7 and P4 pending, every O-line and owner KP line open, KP11-39, B15's version strings and no staged run. No tag readiness is claimed.

## 6. The closing re-checks and the checkpoint

After the last documentation commits (`b13148bf7`, `f35df205d`, `347921a79`), on the closing tree: `pnpm turbo run test --force --filter=@openverify/docs-tools` → exit 0, 444 tests, 97.74% statements (24 s, load 1.32); `docs:all` then `git diff --exit-code docs` → the only difference was this file, uncommitted, so it ran again after this commit; `pnpm release:check` → exit 0, 0 errors, 63 owner items; `adr-deployment.test.sh` → 26 passed. The code was unchanged since the Validation's step 1 (every later commit is Markdown or the DAST report), so steps 1-18 hold for the closing tree.

Checkpoint: this commit, "Workflow 11G integration-11g checkpoint 1 (validation)", is the area's only checkpoint and its full gate is section 4 (rule 26: the last checkpoint's full gate proves every earlier commit).
