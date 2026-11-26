# Phase 11, Workflow 11C Stage 3: integration-11c (TDD evidence)

Agent: integration-11c (alone and last; Workflow 11C, supply chain and deployment). Start `2a83a93e7`,
base `f544fbd2c`; the Stage 2 agents' last commit before this stage is `f482d18ea`. Every command below
ran from the repository root after `source scripts/env.sh`; outputs are abbreviated, exit codes are the
commands' own (read from the call, never through a pipe). Times carry `/proc/loadavg` beside them.

## 0. Start

- No integration-11c work existed before the 98% stop (`resume/phase11-prep/11c-stop/` holds none), so
  this stage started fresh on `f482d18ea`; nothing was redone and no other agent's file was touched
  except as listed (borrowed edits, defects).
- The phone first (owner's request): `flock -E 75 -w 60 /tmp/openverify-device.lock sh -c 'adb -s
  <serial> get-state; adb shell getprop ro.product.model; ... ro.build.version.sdk'` answered
  `device`, `Pixel 9`, `37` (rule 28; the serial is in the prompt only).

## 1. Stage 2 items settled test-first

### 1.1 The vision bumps (scanners-11c: pip-audit's high findings)

- RED `d24cd5d64` (`test(vision)`): `PDF_PINS`, `PYPDF`, the document-analysis expectation and
  `vision-container.test.sh` name pypdf 6.21.4; a new test pins opentelemetry-api 1.45.2.
  `uv run pytest -q --no-cov tests/test_dependencies.py tests/test_pdf_measure.py
  tests/test_document_analysis.py` -> `4 failed, 118 passed` (`AssertionError: pypdf`,
  `pypdf 6.21.4` missing from NOTICE, the two version strings); the OpenTelemetry case `1 failed`.
- GREEN `e1a546737` (`fix(vision)`): `pypdf==6.21.4` in `services/vision/pyproject.toml`,
  `uv lock --upgrade-package pypdf --upgrade-package opentelemetry-api` ("Updated opentelemetry-api
  v1.45.1 -> v1.45.2", "Updated pypdf v6.21.2 -> v6.21.4"), NOTICE, the fixture generator and
  `contracts/fixtures/vision/analyze-document-pdf.json`, the ledger (pypdf's row; opentelemetry-api
  had no row: §2.1.23 adds it). Dates read from PyPI on 2026-11-15: pypdf 6.21.4 2026-10-28T17:00Z
  (BSD-3-Clause; `LICENSE` blob `ab327d0` at tag 6.21.4, unchanged), opentelemetry-api 1.45.2
  2026-10-29 (Apache-2.0, blob `261eeb9`). Tests: 194 passed (six vision files); the API's two
  fixture readers 25 passed; `supply-chain.sh pip-audit` exit 0, "0 findings" (6 s, load 0.49 -> 0.45).

### 1.2 The supply-chain chart step (a defect between two Stage 2 areas)

`supply-chain.sh chart` ran `chart-checks.sh` with no subcommand, which answers its usage (exit 2 on
the tree). RED `test(infra)`: the fake chart-checks answers usage without `all`, as the real one does;
`bash infra/tests/supply-chain.test.sh` -> `135 passed, 4 failed`. GREEN `fix(infra)`: the step runs
`chart-checks.sh all`; 139 passed; the real step exits 0 in 21 s (load 0.41).

### 1.3 release.yml's contract and the date (a defect in sbom-release-11c's test)

`bash infra/tests/release-workflow.test.sh` -> `101 passed, 1 failed`: "an entry expiring more than
90 days ahead fails the run". The case dated itself with the local date (2026-11-15, EST) while
release.yml reads the UTC date (already 2026-11-16), so the 91-day entry was 90 days ahead in UTC
every evening west of UTC. Fixed `568d53d1b`: the cases are dated in UTC; 102 passed.

### 1.4 The CI workflow (C259, C267.2, C267.4; KP10-52's CI half; zizmor github-env)

- RED `0f9201b3d` (`test(ci)`): `bash infra/tests/ci-workflow.test.sh` -> `438 passed, 80 failed`,
  each for its intended reason (no job `supply-chain`; no installer, cache, step or static contract
  there; 25 test scripts run in no job; no PII contract in infra; setup-pnpm writes `$GITHUB_ENV`; no
  corepack env; no bundletool cache in ci.yml or android-release.yml). The stack-record rule's two
  synthetic cases and the five release.yml checks passed at once (they hold what is built).
- GREEN `e9e29c75b` (android-release.yml, borrowed edit) and `10cda4662` (`ci:`): 520 passed, 0
  skipped (actionlint ran). `supply-chain.sh zizmor` exit 0 after setup-pnpm's fix ("11 findings; 0
  failing", all low `self-repository`).
- A local emulation of the job (`/tmp/i11c/run-job.py`: each `run:` step of `jobs.supply-chain` with
  its env, `CI=true`, a fresh `RUNNER_TEMP`, an empty tool cache and a PATH without the developer's
  tools, each step under the e2e lock) found two failures: osv (1.5) and `release-workflow.test.sh`
  requiring actionlint, which no CI job installs (`FAIL - actionlint not installed (required in CI)`).
  Fixed as `ci-workflow.test.sh` does: skipped where it is not installed, the YAML parse and zizmor
  being the fallback (adding a tool pin is contracts-11c's).
- RED/GREEN `ad598620c`: every check step runs after an earlier failure (`if: ${{ !cancelled() }}`),
  521 passed.

### 1.5 The Android tooling and test classpaths (scanners-11c's osv findings)

- RED: `supply-chain.sh osv` exit 1, "55 findings, 24 failing at high or above" (freemarker 2.3.32
  and bcprov 1.80.2 critical; guava, jsoup, jackson, protobuf-javalite, jdom2, jose4j high), every one
  in `androidLintTool`, `dokkaHtmlGeneratorRuntimeResolver~internal`, the host and device test
  configurations or the build plugins' classpath; none in a release runtime classpath.
- GREEN `b0d6d8490`: `android/build.gradle.kts` raises each to its fixed release as a floor
  (eachDependency; guava keeps its flavour, a pre-22 guava becomes `-jre`; Jackson moves as a family)
  and forces the plugin classpath's five. A first cold call failed (`Could not find
  com.google.guava:guava:33.7.2`: a `guava:20.0` request has no flavour), fixed before anything was
  committed. The lockfiles and `verification-metadata.xml` were written by the recipe from one empty
  `GRADLE_USER_HOME` (`/tmp/i11c/gh-cold`) in a scratch worktree, every gate call with
  `--write-locks --write-verification-metadata sha256` (AGP creates `androidLintTool` lazily, so only
  a lint run locks it), all green there: lock rewrite 151 s; (1) 160 + 48 + 106 s; (2) 26 s; (3) 299 s;
  (4) 140 s; (5) 164 s; (6) 72 s; (7) 188 s; (8) 231 s; (9) 14 s (98 tests OK, the three checks 0);
  (10) 63 + 164 s; (11) 73 + 68 + 72 s; (12) 38 s; android-release.yml's three combination release
  builds 162 + 164 + 170 s; Gradle lock wait 0 s; load 0.66 to 9.53. Cold home started at about
  2026-11-16T01:20Z, the copy at 02:11Z.
  - Changed configurations (resolved sets compared per configuration): only `androidLintTool`, the
    host and device test classpaths, `debugUnitTest*`, `minifiedSmokeUnitTest*` and Dokka's resolver.
  - The staged POMs are byte-identical to the main tree's (`cmp`, four POMs); `cyclonedxBom` reads the
    release runtime classpath only, so no SBOM changed.
  - The 15 vulnerable versions' metadata entries were removed (Gradle's writer keeps stale ones, which
    osv-scanner reads); the 9b clean-build pass from a second empty home proves the file complete.
- `android/consumer-check`'s own files are unchanged (rule 3), so its five findings (lint tool and
  plugin classpath only) got reviewed allowlist entries `14c5ea1f1` (path `android/consumer-check/`,
  expiring 2027-02-12, added-by integration-11c).
- RED/GREEN for the gate: a path entry never matched an osv finding (it carries lockfiles, not a path).
  RED `test(infra)` 140 passed, 2 failed; GREEN `fix(infra)`: a path entry covers a lockfile finding
  whose every lockfile is under it; 142 passed. `supply-chain.sh osv` -> exit 0, "22 findings, 0
  failing, 5 allowlisted, 17 below the gate".

### 1.6 Later defects met by the Validation (each fixed before its step counted)

- `packages/config/src/eslint-security.test.ts` (sast-pii-11c's) failed in the "other packages" call:
  `packages/workflow-engine/bin/code-runner-server.mjs` imports `node:fs` since images-11c's tcp:
  transport (it reads `OPENVERIFY_CODE_RUNNER_TOKEN_FILE`) and was not in the reviewed list. RED: the
  call's `AssertionError: expected [ Array(1) ] to deeply equal []`; GREEN: its reviewed entry; 31
  passed, then the whole call 13 of 13 tasks.
- The main tree's first Android call failed dependency verification on the build plugins' classpath
  (`bcprov-jdk18on-1.80.2`, `freemarker-2.3.32`: AGP's and the Dokka plugin's, whose entries 1.5
  removed). GREEN `f7610de7e`: the root `buildscript` forces bcprov 1.85 and FreeMarker 2.3.35 too
  (both already verified in the metadata); the call then passed, and so did the 9b pass from an empty
  home.
- `infra/tests/supply-chain-skeletons.test.sh` (contracts-11c's) held Stage 1a's empty allowlist; it
  now holds each entry's shape (108 passed, 12 skipped).
- `infra/tests/compose.test.sh`'s live half started the developer's `openverify` project (images-11c's
  followup); it now runs as `openverify-compose-test` (`COMPOSE_TEST_PROJECT`) and removes its own
  volumes: 639 passed, the four `openverify_*` volumes unchanged.

## 2. The e2e images mode (C257.3)

- Stub, RED (9 failing: "the e2e images mode is not built yet") and GREEN `e2e/src/images-mode.ts`
  (10 tests): `OPENVERIFY_E2E_IMAGES` (1 or 0, anything else refused), `imagesModeEnv` (the mode and
  the three ports images-11c's override reads), `composeFileArgs` (the override and `--profile app`
  only when the env file names the mode, so `e2e:stack:down` takes the app containers down too),
  `IMAGES_UP_ARGS` (`up --detach --wait --wait-timeout 300 --no-build` the seven app services),
  `IMAGES_SEED_ARGS` (`run --rm --no-deps migrate node dist/commands/seed-dev.js --json --mfa-admin
  --connect`), `missingImagesMessage` and `unreachableImagesMessage`.
- `e2e/setup/stack.ts` branches after the fixtures: the host mode is unchanged (its seed, builds and
  processes moved into `startHostProcesses()`); the images mode checks the five images exist, brings
  the app services up from them, seeds through the API image, builds only the embed client and the
  sample site, and writes each container's log to `e2e/.artifacts/logs/<service>.log` on stop.
- C266.3 (`e2e/src/demo-web.ts`, RED then GREEN): the stack builds `apps/demo-web` into
  `e2e/.artifacts/demo-web` in both modes; it is not started (no full-stack spec uses it, and its
  webhook on the shared sandbox would show in every spec's listing).
- Run on this host, twice (`OPENVERIFY_E2E_IMAGES=1 ... e2e:stack:up`, under the e2e lock): the
  infrastructure in 7 s, the seven app services up and healthy in 21 s (migrate exit 0, the API's
  `/ready`, the worker's heartbeat probe, the runner's `--health`, vision's and the flow's and the
  console's checks), the compiled seed with `--connect --mfa-admin` in 6 to 26 s; then no port of a
  container answered from this host. The containers run with `network_mode: host`, which on Docker
  Desktop 4.87.0 (WSL2) is its virtual machine's network: a probe container bound on 0.0.0.0 and on
  127.0.0.1 in host mode was unreachable from WSL, and Docker Desktop's "host networking" setting is
  not on (its settings file has no such key; changing it is the owner's). The driver now says so
  within 20 s (`unreachableImagesMessage`); the second start ended in 66 s (load 0.97 -> 1.55).
- So the images-mode spec runs (11A's and 11B's six specs, 7A's three, 9's four, 8's one) are a
  blocker on this host: they need Docker Desktop's host networking or a Linux Docker engine (a CI
  runner). A bridge network would change what C257.3 proves: the specs' webhook receiver and OIDC
  provider listen on this host's loopback, and the client-address and trusted-proxy specs need the
  socket peer to be 127.0.0.1.

## 3. The Validation (final tree; every step its own foreground call, exit codes read from the call)

Load 0.2 to 33.5 (an external spike during the "other packages" call); every Gradle lock wait 0 s.

| Step | Result | Time | Load |
|---|---|---|---|
| install --frozen-lockfile; format:check | 0; 0 | 0 s; 115 s | 1.3 |
| forced typecheck (19 tasks) | 0 | 212 s | 1.4 -> 2.6 |
| forced lint: api; dashboard + contracts; the other 16 | 0, 0, 0 | 239, 233, 368 s | 1.3 -> 2.6 |
| fetch_models, fetch_data, the fixture face; build:variant-groups | 0; 0 | 1 s; 6 s | 1.5 |
| unit db | 2,357 at 89.88% | 223 s | 1.4 -> 9.4 |
| unit watchlist + e2e | 820 (98.61%) + 155 (97.11%) | 289 s | 8.9 -> 1.2 |
| unit dashboard, 2 shards + merge | 7,235 in 622 files at 95.65% | 220 + 224 + 6 s | 1.1 -> 7.2 |
| unit others (13 packages) | all green: contracts 4,905, checks 3,849, core 2,007, workflow-engine 2,042, flow 1,678, flow-spec 527, node 508, config 443, emrtd 338, signals 192, ui 58, react 55, demo-web 18 | 182 s | 20.3 -> 16.5 |
| unit js | 19 | 4 s | 15 |
| unit API, 8 blob shards + merge | 10,886 in 858 files at 94.16% | 168-215 s each, merge 43 s | 13.3 -> 4.3 |
| benchmark:typecheck; benchmark:test | 0; 119 | 62 s; 12 s | 3.9 -> 2.6 |
| integration db; graph; api 1-3 | 110; 13; 123 + 129 + 193 = 445 | 107; 34; 158, 209, 144 s | 2.4 -> 17.7 |
| vision lock, ruff, format, mypy; pytest in three parts | 0; 904 + 827 + 957 = 2,688 at 97.45% | 3 s; 149, 182, 315 s | 15 -> 1.4 |
| security/python pytest, ruff, mypy | 196 at 97.08% | 3 s | 1.3 |
| Android (1) ui, flow, rest (`--rerun`) | 532 + 427 + 1,773 = 2,732, none skipped | 309, 46, 100 s | 1.1 -> 2.3 |
| Android (2); (3); (4) | 97 screenshots; 0; demo 97 + 9, nfc 116, face 51 | 65; 255; 123 s | 2.2 -> 7.8 |
| Android (5); (6); (7); (8) | 0 each | 164; 64; 182; 228 s | 7.1 -> 11.8 |
| Android (9) | bundletool present; 98 tests OK; ELF, consumer rules, size passed | 0; 2; 11 s | 10.9 |
| Android (10) | staged, 125 files; check-staged-repository passed; consumer check | 60; 12 s | 9.3 -> 5.8 |
| Android (11) sdk,nfc; sdk,face; sdk,nfc,face; (12) cyclonedxBom | 0; 0; 0; sdk 188, nfc 195, face 190 | 73, 68, 74; 24 s | 5.8 -> 4.1 |
| 9b from an empty Gradle home (`/tmp/i11c/gh-9b`, 04:50Z) | clean; testDebugUnitTest; testAndroidHostTest 2,732; koverVerify; assembleDebug; :openverify-sdk:assemble; lint; the second step; the three checks; the three combinations; device-test compile; the three size configurations; staging; consumer check; cyclonedxBom: every one 0 | 88; 199; 273; 33; 72; 111; 185; 170; 11; 73/69/78; 277; 168/159/203; 74; 45; 40 s | 2.9 -> 12 |
| openapi:write + diff; workflow-docs:write + diff | 0; 0 | 30; 2 s | 4.3 -> 3.1 |
| mocked flow suite | 349 | 136 s | 3.1 -> 9.9 |
| fresh stack: down + turbo build; up | 0; 0 | 31; 115 s | 9.1 -> 4.6 |
| chromium shards 1-4 | 50, 52, 47, 49 (198) | 297, 367, 304, 409 s | 4.2 -> 2.6 |
| console sweep; stackTest | 109; 3 of 3 (Flow, NFC, Connect) | 326; 71 s | 2.6 -> 2.7 |
| stack down; WebKit theme-csp in Docker | 0; 7 | 4; 21 s | 2.7 |
| images (warm cache) | api 604 MB, dashboard 388 MB, flow 349 MB, flow-noguidance 330 MB, vision 707 MB, code-runner 380 MB | 157, 127, 35, 33, 2, 40 s | 1.9 -> 3.6 |
| infra tests (32 scripts, images.test.sh as 9 calls) and the chart's 3 contracts | 2,842 checks counted from their summaries (code-runner's 21 static checks beside), 0 failed, 12 skipped (supply-chain-skeletons' filled installers) | 0-54 s each | 0.9 -> 3.1 |
| workflow benchmark (reported) | effectful 17/46/48 steps/s at 1/8/32 clients; control-flow 91/207/206 | 131 s | 0.8 -> 2.4 |
| supply-chain.sh osv; pnpm-audit; pip-audit; zizmor; trivy-config; chart; pii; allowlist | all 0: osv 22 findings, 5 allowlisted, 0 failing; pnpm 11 below high, 840 signatures; pip 0; zizmor 11 low; Trivy config 33 below high; chart clean; pii 0 kept; allowlist 5 entries | 3; 32; 2; 1; 4; 18; 5; 1 s | 2.2 -> 2.4 |
| chart-checks lint; unittest; kubeconform; trivy | 0; 196 per Helm; every set valid on 1.35.9/1.36.5/1.37.1; clean at high | 1; 8; 3; 5 s | 1.5 -> 2.4 |
| kind 1.35: create, load, fixtures, models, install, smoke, upgrade, delete | all 0; smoke: 37 of 37 migrations, 6 of 6 ready, /ready 200, a sandbox inquiry; upgrade: revision 2, flow on 11c-local-noguidance, 7 of 7 | 37, 50, 79, 9, 28, 15, 47, 3 s | 1.7 -> 1.8 |
| kind 1.37: the same | all 0 (the same results) | 44, 48, 90, 2, 28, 16, 47, 4 s | 1.6 -> 3.7 |
| gitleaks git --redact; the PII filter over the tree; over history | no leaks (110 MB); 0 kept of 1,204; 0 kept of 1,640 | 10; 5; 11 s | 3.1 -> 3.4 |
| device suites on the Pixel 9 (Android 17) | SDK 14, demo 2, nfc 2, face 4: 22 of 22 from the XML; `check-connected-results.sh` rc 0 | 52, 35, 38, 328 s | 3.2 -> 0.2 |
| config lint + typecheck after its test changed | 0 | 7 s | 0.2 |

Each connected task's Gradle exit was 1 with every test passed in its XML (KP10-31). Skipped: the
"11D on", "11E on" and "11F on" lines (not 11C's); `analytics:benchmark --measure` (KP11-7, 11D's).

## 4. Measurements beside the Validation

- The supply-chain job, emulated locally (each `run:` step of `jobs.supply-chain` with `CI=true`, an
  empty tool cache, the e2e lock per step, load 0.2 -> 1.6): installs 8 + 25 s, checks 2.6 (osv) +
  33.5 + 1.1 + 0.4 + 3.7 + 17.9 + 6.1 + 0.1 s, the static contracts and security/python 38 s; 134 s of
  run steps in all. With the setup (checkout, setup-pnpm's install, setup-uv's sync, a cold Trivy
  checks bundle and the schema bundles' 70 s) the estimate is 4 to 7 minutes on a runner, against
  `timeout-minutes: 20`. Not measured on a runner (rule 27).
- The lint job with eslint-plugin-security: peak RSS 4.17 GB for `@openverify/api` (3:57) and 3.65 GB
  for `@openverify/contracts` (0:58) under `--max-old-space-size=4096` (`/usr/bin/time -v`, the largest
  descendant; load 0.9 -> 2.3); both pass. The earlier figures (3.35 and 2.85 GB) do not record their
  method, so no growth is claimed.
- The CI baseline stays the records' (Phase 10's fix-records table); no job is split on an estimate.

## 5. Acceptance of 11C (each with its evidence)

1. Five production images build, run read-only as non-root, no dev tooling: section 3's builds;
   `images.test.sh` api 54, dashboard 27, flow 33, flow-noguidance 32, vision 28, code-runner 27.
2. Every image reference and tool pinned by digest or checksum: `images.test.sh static` 149 and
   `pins` 24; the 13 installer tests with their network halves; `ci-workflow.test.sh` (no scanner
   action in any workflow).
3. The supply-chain job passes on the tree with an allowlist whose every entry has a reason and an
   expiry: the eight steps exit 0; 5 entries, 2027-02-12. Its CI run is open (rule 27).
4. SAST in lint with its suppressions counted: the forced lint; `eslint-security.test.ts` 31.
5. The PII scan passes and catches its positives: `gitleaks-pii.test.sh` 24; tree and history 0 kept.
6. SBOMs and the licence check: sbom-release-11c's real runs (every image, AAR, tarball, tree); the
   three AAR SBOMs here (188, 195, 190). Owner items: nodemailer (image:api, pending-owner); vision
   fails on FFmpeg inside opencv-python-headless (an owner decision since Phase 3; blocker).
7. The flow image against two API URLs without a rebuild, and the no-guidance variant's smoke:
   images-11c's `images.test.sh flow` and `flow-noguidance` (33 and 32 here).
8. The chart: lint on both Helms, 196 unit tests per Helm, kubeconform 1.35-1.37, Trivy config, kind
   install and upgrade on 1.35 and 1.37 in `models.source: pvc` with a sandbox inquiry; vision without
   egress in every models mode (`c264-networkpolicies_test.yaml`).
9. The web packages pack: sdk-web-11c's pack tool (js 11,200 B, node 1,577,687 B, react 7,686 B).
10. release.yml stages everything and publishes nothing: `release-workflow.test.sh` 102; its first
    staged run is open (KP10-59).
11. Per-push minutes: estimated locally (section 4); measured open until a run starts.

## Checkpoint

CHECKPOINT validation DONE at a9ef3e2356390775519f42278979eb8d4675545d
Handoff: the Validation of section 3 ran on this tree (every step exit 0 except the images-mode spec
runs, blocked by Docker Desktop's host networking, section 2). The plan's "Workflow 11C Stage 2
amendments" and "Workflow 11C Stage 3 amendments (integration-11c)" are written. Nothing was pushed.
