# Phase 11, Workflow 11C Stage 1a: contracts-11c

Agent: `contracts-11c` (alone). Start `2a83a93e7` (base `f544fbd2c`). Every command below was run on this host (WSL2, no KVM), with `source scripts/env.sh` first; timings carry `cat /proc/loadavg` beside them. The plan's record of this Stage is "## Workflow 11C Stage 1a amendments (contracts-11c)" at the end of `docs/plans/phase-11.plan.md`; the inventory is `docs/research/phase11-inventory.md` section 3.

## 0. The base, from the records (rule 27)

```
$ git merge-base --is-ancestor f544fbd2c99cda667db4186cf9d8223632aedc77 HEAD; echo base=$?
base=0
$ git merge-base --is-ancestor 2a83a93e7da32547386a17722f1446decc1a2d77 HEAD; echo start=$?
start=0
$ git show f544fbd2c:docs/PROGRESS.md | grep -n '^## .*Phase 11, Workflow 11B done'
20:## 2026-11-14: Phase 11, Workflow 11B done (platform hardening: ...)
$ grep -n '^## Orchestrator decisions before Workflow 11C' docs/plans/phase-11.plan.md
1938:## Orchestrator decisions before Workflow 11C (2026-11-14)
$ git merge-base --is-ancestor f544fbd2c origin/main; echo origin=$?
origin=0          (recorded, not required)
$ gh run list --branch main --limit 5
43595684173 f544fbd2c (11B push)  completed failure
43408690288 cdff9dac8 (11A push)  completed failure
43137166420 4db86122d (Phase 10)  completed failure
43018061783 b826da9b5 (10D)       completed failure
42937477615 67244eb78 (10C)       completed failure
$ gh run view 43595684173 --json jobs   (18 jobs)
15 jobs "failure" with 0 steps (2-3 s each); unit-dashboard-coverage, unit-api-coverage, android-instrumented skipped, 0 steps
```

No completed run has a failed step: there is no first fix. The CI baseline is recorded from the records (inventory 3.16).

## 1. The inventory

Section 3 of `docs/research/phase11-inventory.md` (3.1-3.16), each claim with its `path:line` at `2a83a93e7`.

## 2. The pins, read on 2026-11-14

Each release read with `gh api repos/<repo>/releases/tags/<tag>` (date), `gh api repos/<repo>/commits/<tag>` (commit) and `gh api repos/<repo>/license?ref=<tag>` (licence file at the tag; cosign's `NOASSERTION` was read from its `LICENSE` text: Apache License 2.0). Each linux amd64 asset was downloaded to a scratch directory outside the repository and checked against the release's own checksum file (`sha256sum -c`), and the Sigstore signatures were verified with the checksummed cosign:

```
trivy_0.76.0_Linux-64bit.tar.gz: OK           osv-scanner_linux_amd64: OK
grype_0.120.1_linux_amd64.tar.gz: OK          syft_1.54.1_linux_amd64.tar.gz: OK
cosign-linux-amd64: OK                        chart-testing_3.15.0_linux_amd64.tar.gz: OK
kubectl-v1.35.9: OK
helm-unittest 48e86ecc... = checksum file     kubeconform 9bc2bffb... = CHECKSUMS
kind aee61515... = kind-linux-amd64.sha256sum helm v4.3.1 0403a88a..., v3.22.1 896cf636... = get.helm.sh .sha256sum
zizmor d185f726... = the immutable release's asset digest (no checksum file is published)
$ cosign verify-blob --bundle trivy_0.76.0_checksums.txt.sigstore.json --certificate-identity https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.0 --certificate-oidc-issuer https://token.actions.githubusercontent.com trivy_0.76.0_checksums.txt
Verified OK
(the same for grype and syft checksums, identity https://github.com/anchore/{grype,syft}/.github/workflows/release.yaml@refs/heads/main;
 chart-testing's tarball, identity https://github.com/helm/chart-testing/.github/workflows/release.yaml@refs/heads/main: Verified OK)
$ cosign verify-blob kubectl-v1.35.9 --signature kubectl.sig --certificate kubectl.cert --certificate-identity krel-staging@k8s-releng-prod.iam.gserviceaccount.com --certificate-oidc-issuer https://accounts.google.com
Verified OK
```

The table of every pin is amendment 4 of the plan's Stage 1a section.

## 3. The spikes (scratch worktree `/tmp/openverify-11c-spike`, removed after)

### (a) Syft's pnpm cataloguer

```
$ syft scan dir:<worktree> --override-default-catalogers javascript-lock-cataloger --exclude './android/**' --exclude './services/**' -o syft-json=...
components 837 (pnpm-lock.yaml's second document: 822 packages, all 822 listed; plus the 15 @pnpm/exe.* config dependencies)
workspace pkgs listed: []          with licences 0
$ syft scan dir:<worktree> --override-default-catalogers javascript-lock-cataloger,javascript-package-cataloger --exclude './android/**' --exclude './services/**' --exclude '**/node_modules/**' ...
855 components: the 18 importers (@openverify/root and the 17 workspace packages) and every lockfile package
relations of workspace packages by type {'evident-by': 18, 'contains': 18}; third-party dependency-of edges 1312; components with a licence 1
```

Result: with the lock and `package.json` cataloguers Syft lists every workspace package and every resolved dependency, so C261.1's fallback (cdxgen) is not taken. Two limits, recorded (C261.4): no edge from a workspace package to its direct dependencies (osv-scanner reads `pnpm-lock.yaml`'s importers directly), and no licences offline (the licence check reads the image and package SBOMs, whose installed `package.json` files carry them).

### (b) helm-unittest v1.2.1 under Helm 4.3.1 and 3.22.1

The release archive holds `plugin.yaml`, `untt-linux-amd64` and `LICENSE`; installing is copying those three into `$HELM_PLUGINS/unittest/` (the archive's `install-binary.sh` hook, which downloads, is never run).

```
== helm v4.3.1
NAME     VERSION TYPE   APIVERSION PROVENANCE SOURCE
unittest 1.2.1   cli/v1 legacy     unknown    unknown
unittest rc=0   Test Suites: 1 passed, 1 total   Tests: 1 passed, 1 total
1 chart(s) linted, 0 chart(s) failed
== helm v3.22.1
unittest rc=0   Test Suites: 1 passed, 1 total   Tests: 1 passed, 1 total
1 chart(s) linted, 0 chart(s) failed
(a wrong expected value)  helm v4.3.1 failing assertion rc=1   helm v3.22.1 failing assertion rc=1
```

Result: the unit tests run under both Helm versions; no fallback.

### (c) The CycloneDX Gradle plugin 3.5.1

The plugin and its marker are on the Gradle Plugin Portal only (`plugins.gradle.org/m2/org/cyclonedx/...` 200; Maven Central 404), so `pluginManagement` needs `gradlePluginPortal()` filtered to the groups `org.cyclonedx.bom` and `org.cyclonedx`. Applied to the three published modules (warm Gradle home, under the Gradle lock; load 0.17 to 3.88, lock wait 0 s):

```
$ ./gradlew --no-daemon --write-verification-metadata sha256 :openverify-sdk:cyclonedxBom :openverify-nfc:cyclonedxBom :openverify-face:cyclonedxBom
BUILD SUCCESSFUL in 1m 24s       (tasks: cyclonedxBom, cyclonedxDirectBom)
every configuration (default): sdk 571 components, nfc 403, face 402 (JUnit, Robolectric, Roborazzi, iOS klibs among them)
with tasks.named<CyclonedxDirectTask>("cyclonedxDirectBom") { includeConfigs.set(listOf("<release runtime classpath>")) }:
openverify-sdk  (androidRuntimeClasspath)  188 components {Apache-2.0: 187, BSD-3-Clause: 1, MIT: 1}
openverify-nfc  (releaseRuntimeClasspath)  195 components; org.jmrtd:jmrtd:0.8.9, net.sf.scuba:scuba-sc-android:0.0.27, net.sf.scuba:scuba-smartcards:0.0.21 (LGPL by their POMs)
openverify-face (releaseRuntimeClasspath)  190 components; com.microsoft.onnxruntime:onnxruntime-android:1.31.0
none holds junit, robolectric, roborazzi, okhttp-tls, mockwebserver or com.google.android.play
$ ./gradlew --no-daemon cyclonedxBom      BUILD SUCCESSFUL in 20s (load 3.88): three SBOMs, 188, 195 and 190 components, metadata.component dev.openverify:<module>:0.1.0
no lockfile changed; the verification metadata gained the plugin's classpath (85 components)
```

The plugin's build classpath (read from each POM, parents followed): Apache-2.0 (most), MIT (`packageurl-java`, `slf4j-api`), BSD-2-Clause (`stax2-api`), EPL-2.0 (`org.eclipse.sisu.inject` and `org.eclipse.sisu.plexus` 1.1.0: unmodified build tooling, never shipped, §5), and `aopalliance:aopalliance:1.0` under "Public Domain", which rule 4 does not list. With `configurations.classpath { exclude(group = "aopalliance", module = "aopalliance") }` in the root `buildscript` the three SBOMs are built the same (`BUILD SUCCESSFUL in 48s`; `buildEnvironment` shows Guice 5.1.0 without aopalliance). Result: the plugin reads every published module; it is adopted with that exclusion, and no fallback is taken.

## 4. Checkpoint deps

### RED (`1e4b881ae`)

`packages/config/src/supply-chain-pins.test.ts` holds every 11C pin and row, eslint-plugin-security, both uv tool projects, the CycloneDX plugin's build lines and the two web skeletons; `workspace-conventions.test.ts` gains `'sdk-react': '@openverify/react'` in `PUBLISHED_NAMES` (rule 12: the plan adds the package). The two uv projects were drafted uncommitted before the test, to read their resolution; the RED run shows their licence rows missing.

```
$ pnpm --filter @openverify/config exec vitest run src/supply-chain-pins.test.ts src/workspace-conventions.test.ts --coverage.enabled=false   (load 0.07)
× records Trivy 0.76.0, released 2026-10-14, under Apache-2.0 ... (18 tool rows)
× excludes Semgrep Community Edition engine ... (5), × records cdxgen as not adopted ... (3)
× says that published images redistribute their base distribution (C257.5)
× is pinned exactly in the root package beside eslint-plugin-regexp; × locks one version, the pinned 4.2.0, ...
× records the licence of every package its lockfile resolves (security/pip-audit, security/python)
× is pinned in the version catalog ...; × gives openverify-{sdk,nfc,face} an SBOM ...; × keeps aopalliance ...
× declares @openverify/react ...; × declares apps/demo-web ...; × starts {packages/sdk-react,apps/demo-web} ...
Failed Tests 40     (tsc --noEmit and eslint on the test: clean)
```

### GREEN

- `ed564263f` (npm, uv, licences): `flock /tmp/openverify-pnpm.lock pnpm install` added 3 packages (eslint-plugin-security 4.2.0, safe-regex 2.1.1, regexp-tree 0.1.27; no install script; `pnpm-workspace.yaml` unchanged, no `minimumReleaseAgeExclude`); `packages/sdk-react` and `apps/demo-web` (each `tsc --noEmit`, `eslint .` and `vitest run --coverage` exit 0: no tests yet, `passWithNoTests` in their configs until sdk-web-11c's first test); `uv lock` of `security/pip-audit` (30 packages) and `security/python` (17); `THIRD_PARTY_LICENSES.md` §1 (18 rows), the base-distribution note, §2.1.22, §5 (certifi, pathspec, Eclipse Sisu), Excluded (6 rows), Not adopted (3).
- `a283af290` (Android), from one cold Gradle home in a scratch worktree (`/tmp/openverify-11c-deps`, `GRADLE_USER_HOME=/tmp/ov-gradle-cold-11c`, empty; rule 3's recipe):

| Call (cold home, `--write-verification-metadata sha256`) | rc | Time | Load before / after |
| --- | --- | --- | --- |
| `help` without writing | 1: "Dependency verification failed ... org.cyclonedx.bom.gradle.plugin-3.5.1.pom ... from repository Gradle Central Plugin Repository" (strict verification refuses the unrecorded plugin) | 32 s | 0.09 / 1.19 |
| `resolveAndLockAll --write-locks` | 0 | 136 s | 1.08 / 1.85 |
| (1) ui / flow / rest | 0 / 0 / 0 | 294 / 50 / 104 s | 1.22 / 3.10, 2.85 / 2.94, 2.94 / 2.16 |
| (2) screenshots, verify | 0 | 64 s | 2.39 / 2.94 |
| (3) `koverVerify checkKotlinAbi` | 0 | 291 s | 2.94 / 3.95 |
| (4) `testDebugUnitTest assembleDebug` | 0 | 125 s | 3.34 / 5.87 |
| (5) release builds | 0 | 179 s | 5.87 / 11.23 |
| (6) `:openverify-sdk:assemble` | 0 | 68 s | 10.33 / 7.75 |
| (7) `lint` | 0 | 169 s | 7.75 / 4.46 |
| (8) device-test compilation | 0 | 219 s | 4.10 / 10.26 |
| (9) bundletool, 98 release-check tests, ELF, consumer rules, size | 0 | 14 s | 9.43 / 7.87 |
| (10) staging / `-p consumer-check build` | 0 / 0 | 60 / 161 s | 7.24 / 6.17, 6.17 / 9.82 |
| (11) `sdk,nfc` / `sdk,face` / `sdk,nfc,face` | 0 / 0 / 0 | 71 / 67 / 76 s | 7.64 / 5.02, 5.02 / 3.87, 3.87 / 4.15 |
| (12) `cyclonedxBom` | 0 | 36 s | 3.82 / 3.01 |

Lock wait 0 s on every call. The result: `android/gradle/verification-metadata.xml` +1,086 lines (84 new components, the plugin's classpath without aopalliance, and the `.pom` files `cyclonedxBom` reads for licences beside existing components; no line removed); the three published modules' `gradle.lockfile` gain `cyclonedxBom` on their `empty=` line (the plugin registers that configuration, with nothing in it); `settings-gradle.lockfile`, the demo's four lockfiles and `android/consumer-check`'s three files are unchanged. The staged POMs of call (10) are byte-identical to the 11B close's staging in the main tree and name no CycloneDX component, so the published modules' declared dependencies did not change. Copied into the main tree under the Gradle lock.

```
$ pnpm --filter @openverify/config exec vitest run src/supply-chain-pins.test.ts src/workspace-conventions.test.ts --coverage.enabled=false
Test Files  2 passed (2)    Tests  108 passed (108)
```

### The gate (full: a root-toolchain checkpoint, rule 29), on `a283af290`

| Call | rc | Result | Time | Load before / after |
| --- | --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | | 0 s | 2.02 |
| `pnpm format:check` | 0 | all files | 116 s | |
| forced typecheck | 0 | 19 of 19 | 184 s | 1.32 / 3.83 |
| forced lint api / dashboard + contracts / the other 16 | 0 / 0 / 0 | | 257 / 241 / 332 s | 3.53 / 1.95, 1.79 / 1.92, 1.77 / 1.33 |
| db unit | 0 | 2,357 at 89.88% | 165 s | 1.22 / 9.79 |
| watchlist + e2e unit | 0 | 820 + 144 | 283 s | 9.01 / 1.20 |
| dashboard, 2 blob shards and the merge | 1 / 1 (partial coverage only) / 0 | 7,222 at 95.67% | 219 / 241 / 6 s | 1.02 / 6.39 |
| the other 13 packages (the two new among them) | 0 | ui 58, emrtd 338, flow-spec 527, core 2,007, signals 192, config 412, node 508, workflow-engine 1,996, checks 3,849, contracts 4,905, flow 1,639; react and demo-web no tests | 176 s | 4.97 / 13.43 |
| `@openverify/js` | 0 | 19 | 5 s | |
| API, 8 blob shards and the merge | 1 x 8 (partial coverage only) / 0 | 10,819 in 853 files at 94.17% | 179-216 s each, merge 41 s | 11.44 / 4.86 |
| integration db / graph / api 1-3 | 0 x 5 | 110 / 13 / 123, 128, 193 | 141 / 46 / 118, 170, 108 s | 4.11 / 16.50 |
| Android (1) ui / flow / rest | 0 / 0 / 0 | 532 + 427 + 1,773 = 2,732, none skipped | 287 / 43 / 100 s | 15.18 / 2.55 |
| (2) / (3) / (4) / (5) / (6) / (7) / (8) | 0 x 7 | 97 screenshots; demo 106 (97 + 9), nfc 116, face 51 | 22 / 251 / 126 / 161 / 70 / 184 / 222 s | 2.35 / 12.13 |
| (9) | 0 | 98 release-check tests OK; ELF, consumer rules, size pass | 13 s | 12.13 |
| (10) staging / consumer check | 0 / 0 | | 60 / 163 s | 8.31 / 9.69 |
| (11) three combinations | 0 x 3 | | 73 / 67 / 74 s | 9.69 / 3.99 |
| (12) `cyclonedxBom` | 0 | sdk 188, nfc 195, face 190 components | 19 s | 3.99 / 3.79 |
| infra tests, 11 scripts | 0 x 11 | 43 + 25 + 411 (0 skipped) + 55 + 610 + 25 + 38 + 10 + 31 + 11 + 55 = 1,314 | 0-97 s | 2.95 / 2.81 |
| mocked flow suite | 0 | 349 | 135 s | 2.38 / 10.40 |
| stack down + build / up | 0 / 0 | | 31 / 98 s | 9.57 / 4.24 |
| chromium shards 1-4 | 0 x 4 | 50, 52, 47, 49 (198) | 279 / 358 / 273 / 396 s | 3.90 / 2.21 |
| console sweep | 0 | 109 | 326 s | 2.02 / 1.66 |
| `:openverify-sdk:stackTest` | 0 | 3 of 3 (the three classes) | 55 s | 1.53 / 2.17 |
| stack down | 0 | | 3 s | |

Lock waits 0 s (Gradle and e2e). Nothing under `android/` changed during the gate.

CHECKPOINT deps DONE at a283af290f0ecf06fee5a14a5c36cfb5df6ec2a8

Handoff (deps):
- **eslint-plugin-security 4.2.0** is a root dev dependency (`package.json`), beside `eslint-plugin-regexp` 3.3.1; sast-pii-11c imports it in `packages/config/eslint/security.js` and spreads it through `phase5Config()` (OD-11C-1); no `lint:security` script.
- **pip-audit**: `security/pip-audit/` (`pyproject.toml`, `uv.lock`, `.python-version` 3.12); run as `uv run --project security/pip-audit --frozen pip-audit --require-hashes --disable-pip --no-deps -r <requirements>` over `uv export --frozen --format requirements-txt` of vision and `load/` (scanners-11c's `supply-chain.sh pip-audit`).
- **The Python test environment**: `security/python/` (pytest 9.1.1, pytest-cov 7.1.0, ruff 0.17.1, mypy 2.4.0; PyYAML 6.0.3 only for kubeconform's `openapi2jsonschema.py`). Tests: `security/tests/test_*.py` (sbom-release-11c) and `scripts/tests/test_fetch_k8s_schemas.py` (chart-policy-11c), each loading its hyphenated or underscored script by path with `importlib.util.spec_from_file_location`. From the repository root: `uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir .` (coverage of exactly the two scripts, `--cov-fail-under=80`); `uv run --project security/python --frozen ruff check security scripts/fetch_k8s_schemas.py scripts/tests`; the same with `ruff format --check`; `uv run --project security/python --frozen mypy --strict security/check-sbom-licences.py scripts/fetch_k8s_schemas.py`. Proved on a scratch tree: 1 passed, 100% of the stub script.
- **The skeletons**: `packages/sdk-react` (`@openverify/react`, private for now, peer `react ^19.0.0`, dependency `@openverify/js workspace:*`, dev: @testing-library/react ^16.3.3, @testing-library/dom ^10.4.2, jsdom, react, react-dom, types; `tsc -p tsconfig.build.json` to `dist/`) and `apps/demo-web` (`@openverify/demo-web`, private, dependencies `@openverify/js`, `@openverify/node`, `@openverify/react`, react, react-dom; dev: vite, @vitejs/plugin-react, the testing libraries, jsdom). Each `vitest.config.ts` sets `passWithNoTests: true` until sdk-web-11c's first test, which removes it. The lockfile is final: sdk-web-11c adds no dependency.
- **CycloneDX**: plugin id `org.cyclonedx.bom` 3.5.1 (`libs.plugins.cyclonedx`), resolved from `gradlePluginPortal()` for the groups `org.cyclonedx.bom` and `org.cyclonedx` only; applied to `:openverify-sdk`, `:openverify-nfc`, `:openverify-face`; each `cyclonedxDirectBom` has `includeConfigs` = `androidRuntimeClasspath` (sdk) or `releaseRuntimeClasspath` (nfc, face). Gate call (12): `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon cyclonedxBom)`; outputs `android/<module>/build/reports/cyclonedx/bom.json` (CycloneDX 1.6, `metadata.component` `dev.openverify:<module>:0.1.0`) and the direct ones under `build/reports/cyclonedx-direct/`. SCUBA appears as LGPL from its POMs; its two GPL-with-Classpath files are §6's hand-listed row, which the licence check applies only in `openverify-nfc`'s SBOM.

## 5. Checkpoint skeletons

### RED (`4b373bd10`)

`infra/tests/supply-chain-skeletons.test.sh` (new; contracts-11c's): the pins of every installer, the extra pins (checks bundle, node images, schema converter), the skeleton's fail-closed run, the allowlist and its schema, release.yml's shape, gates and pins, and actionlint.

```
$ bash infra/tests/supply-chain-skeletons.test.sh
FAIL - install-cosign.sh exists ... FAIL - install-zizmor.sh exists (13)
FAIL - install-trivy.sh pins the checks bundle 2.3.0 by digest; FAIL - install-kind.sh names the 1.35 / 1.37 node image by digest;
FAIL - install-kubeconform.sh pins its schema converter script at the release's commit
FAIL - allowlist: security/allowlist.yaml parses as YAML (No such file); ... is an empty list (None); ...schema.json parses as JSON (No such file)
FAIL - .github/workflows/release.yml exists
# 0 passed, 21 failed, 0 skipped
```

The first commit attempt was refused by the gitleaks pre-commit hook (`generic-api-key` on `KUBECONFORM_OPENAPI2JSONSCHEMA_SHA256="..."`: the "api" in OPENAPI beside a digest), a false positive reworded to `KUBECONFORM_SCHEMA_CONVERTER_SHA256` (rule 4).

### GREEN (`ade4631f3`)

Twelve generated installers, `security/allowlist.yaml` and `security/allowlist.schema.json`, `.github/workflows/release.yml` (its first draft's plain `run:` scalars held `: ` and did not parse; block scalars fixed it), and §1 rows for the Trivy checks bundle, the Kubernetes OpenAPI documents and the kind node images.

```
$ bash infra/tests/supply-chain-skeletons.test.sh
# 110 passed, 0 failed, 0 skipped
$ zizmor --offline .github/workflows/release.yml      (the scratch, checksummed v1.31.1)
No findings to report. Good job!
```

### The gate (affected scope, rule 29), filter `...[009669ca4]`

| Call | rc | Result | Time | Load before / after |
| --- | --- | --- | --- | --- |
| `pnpm format:check` | 0 | | 122 s | 0.37 / 1.35 |
| `pnpm turbo run lint typecheck --force --filter='...[009669ca4]'` | 0 | no package in scope (only `infra/`, `security/`, `.github/` and the licence file changed) | 0 s | 1.35 |
| `@openverify/config` tests (the pins test reads the licence file) | 0 | 412 | 9 s | 1.35 / 1.74 |
| `infra/tests/supply-chain-skeletons.test.sh` | 0 | 110 | 0 s | |
| `infra/tests/ci-workflow.test.sh` | 0 | 411, 0 skipped | 10 s | 1.74 / 1.55 |

No integration (no package with integration tests changed), no Android gate (nothing under `android/`), no e2e: the `infra/` changes are new scripts no stack reads (`e2e/setup/stack.ts` reads only `infra/docker-compose.yml`, unchanged); the last checkpoint's full gate covers them.

CHECKPOINT skeletons DONE at ade4631f3

Handoff (skeletons):
- **Installers** (`infra/scripts/install-<tool>.sh`, each `set -euo pipefail`, `OPENVERIFY_SKELETON=1`, exit 3 with "not built", nothing written; scanners-11c fills each test-first in `infra/tests/install-<tool>.test.sh`, removing the marker; `INSTALL_DIR` default `~/.local/bin`; `<P>_VERSION` with `<P>_SHA256` together; `<P>_CACHE_DIR`):

  | File | Variables (frozen values) | Checksum file | Signature to verify |
  | --- | --- | --- | --- |
  | `install-cosign.sh` | `COSIGN_VERSION_DEFAULT` 3.1.3, `COSIGN_SHA256_DEFAULT` 4629c757…7f71 (`cosign-linux-amd64`) | `cosign_checksums.txt` | none (SHA-256 only) |
  | `install-helm.sh` | `HELM4_VERSION_DEFAULT` 4.3.1 / `HELM4_SHA256_DEFAULT` 0403a88a…fe54b, `HELM3_VERSION_DEFAULT` 3.22.1 / `HELM3_SHA256_DEFAULT` 896cf636…a0ea; installs `helm` (4.3.1) and `helm3` (3.22.1); `HELM_CACHE_DIR` | get.helm.sh `<asset>.sha256sum` | PGP only |
  | `install-helm-unittest.sh` | `HELM_UNITTEST_VERSION_DEFAULT` 1.2.1, `HELM_UNITTEST_SHA256_DEFAULT` 48e86ecc…4939; copies `plugin.yaml`, `untt-linux-amd64`, `LICENSE` to `$HELM_PLUGINS/unittest` | `helm-unittest-checksum.sha` | PGP only |
  | `install-kubeconform.sh` | `KUBECONFORM_VERSION_DEFAULT` 0.8.0, `KUBECONFORM_SHA256_DEFAULT` 9bc2bffb…7883; `KUBECONFORM_SCHEMA_CONVERTER_COMMIT` 02374e583d700721f57300fae78e11acd27ee539, `KUBECONFORM_SCHEMA_CONVERTER_SHA256` d145babf…81f3 (`scripts/openapi2jsonschema.py`) | `CHECKSUMS` | none |
  | `install-chart-testing.sh` | `CHART_TESTING_VERSION_DEFAULT` 3.15.0, `CHART_TESTING_SHA256_DEFAULT` 46756173…c583 | `checksums.txt` | the archive's `.sigstore.json`, identity `https://github.com/helm/chart-testing/.github/workflows/release.yaml@refs/heads/main` |
  | `install-kind.sh` | `KIND_VERSION_DEFAULT` 0.33.0, `KIND_SHA256_DEFAULT` aee61515…8e0d; `KIND_NODE_IMAGE_1_35`, `KIND_NODE_IMAGE_1_37` (by digest) | `kind-linux-amd64.sha256sum` | none |
  | `install-kubectl.sh` | `KUBECTL_VERSION_DEFAULT` 1.35.9, `KUBECTL_SHA256_DEFAULT` 3cfeaf80…6eb | `kubectl.sha256` | `kubectl.sig` + `kubectl.cert`, identity `krel-staging@k8s-releng-prod.iam.gserviceaccount.com`, issuer `https://accounts.google.com` |
  | `install-trivy.sh` | `TRIVY_VERSION_DEFAULT` 0.76.0, `TRIVY_SHA256_DEFAULT` e24b1c51…5fe7; `TRIVY_CHECKS_BUNDLE_DEFAULT` `ghcr.io/aquasecurity/trivy-checks:2.3.0@sha256:3eae4436…27cd` | `trivy_0.76.0_checksums.txt` | its `.sigstore.json`, identity `https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.0` |
  | `install-syft.sh` | `SYFT_VERSION_DEFAULT` 1.54.1, `SYFT_SHA256_DEFAULT` c069905b…ad47 | `syft_1.54.1_checksums.txt` | its `.sigstore.json`, identity `https://github.com/anchore/syft/.github/workflows/release.yaml@refs/heads/main` |
  | `install-grype.sh` | `GRYPE_VERSION_DEFAULT` 0.120.1, `GRYPE_SHA256_DEFAULT` 0a9ee97e…343d | `grype_0.120.1_checksums.txt` | its `.sigstore.json`, identity `https://github.com/anchore/grype/.github/workflows/release.yaml@refs/heads/main` |
  | `install-osv-scanner.sh` | `OSV_SCANNER_VERSION_DEFAULT` 2.7.0, `OSV_SCANNER_SHA256_DEFAULT` 160c6253…218b (`osv-scanner_linux_amd64`) | `osv-scanner_SHA256SUMS` | none by cosign (SLSA provenance only) |
  | `install-zizmor.sh` | `ZIZMOR_VERSION_DEFAULT` 1.31.1, `ZIZMOR_SHA256_DEFAULT` d185f726…8c99 | none published: the immutable release's asset digest | none |

  The cosign issuer for every GitHub identity is `https://token.actions.githubusercontent.com`. Each was verified on 2026-11-14 (section 2).
- **`infra/scripts/supply-chain.sh`** (scanners-11c), frozen entry points: `infra/scripts/supply-chain.sh <step>` for one step or `all` for every step in this order: `osv` (osv-scanner over `pnpm-lock.yaml`, `services/vision/uv.lock`, `load/uv.lock` when it exists, `security/pip-audit/uv.lock`, `security/python/uv.lock`, every `android/**/gradle.lockfile` (the demo's three combination lockfiles and `consumer-check`'s among them), both `settings-gradle.lockfile` files and both `verification-metadata.xml` files), `pnpm-audit` (`pnpm audit --audit-level high`, then `pnpm audit signatures`), `pip-audit` (vision and `load/`), `zizmor` (`.github/workflows/` and `.github/actions/`, failing at medium), `trivy-config` (`infra/` and the rendered chart, failing at high, the checks bundle by digest), `chart` (`deploy/helm/openverify/ci/chart-checks.sh`, chart-policy-11c's), `pii` (gitleaks with `security/gitleaks-pii.toml` and its allowlist, sast-pii-11c's). Exit 0 pass, 1 findings, 2 usage, 3 a step not built yet. Every step reads `security/allowlist.yaml` through one shared check (an expired entry, or one more than 90 days ahead, fails the step), writes each database's build date and the medium/low findings to `$GITHUB_STEP_SUMMARY` when set, and takes its binaries from `SUPPLY_CHAIN_TOOLS_DIR` (default `~/.local/bin`). The tests for the script are scanners-11c's.
- **The allowlist**: `security/allowlist.yaml` is `[]`; `security/allowlist.schema.json` (draft 2020-12): an array of objects with `required` `id`, `reason`, `expires`, `added-by`, `oneOf` `package` or `path`, no other member; `expires` a `date`; `reason` 10 to 500 characters; the 90-day bound is the gate's (the schema states it).
- **`release.yml`**: `workflow_dispatch` with the required string input `version`; top-level `permissions: contents: read`; `concurrency: release`; jobs `build` (`if: github.ref == 'refs/heads/main'`), `verify` (needs build), `stage` (needs verify), `publish` (needs stage, `if: vars.OPENVERIFY_PUBLISH == 'true'`, `environment: release`); every job checks out with `persist-credentials: false` and, while the file carries `# OPENVERIFY_SKELETON`, ends with a `::notice::` that its stage is not built. sbom-release-11c removes the marker when it fills the jobs and moves the checks into `infra/tests/release-workflow.test.sh`.

## 6. Checkpoint chart

### RED (`c78aa06cf`)

`infra/tests/chart-skeleton.test.sh` (new; contracts-11c's): Chart.yaml's fields and words, the chart-local `.prettierrc.json` against the root's, the 233 frozen value keys, the switches, no secret value, the schema's draft and top level, the frozen helper names, then with Helm 4.3.1 and 3.22.1 (`HELM4`, `HELM3`, or `helm` and `helm3` on PATH; skipped otherwise) `helm lint`, `helm template` and eight schema refusals.

```
$ HELM4=<scratch>/helm-v4.3.1 HELM3=<scratch>/helm-v3.22.1 bash infra/tests/chart-skeleton.test.sh
FAIL - deploy/helm/openverify exists
# 0 passed, 1 failed, 0 skipped
```

### GREEN (`52acd7597`)

`deploy/helm/openverify/{Chart.yaml, .prettierrc.json, .helmignore, values.yaml, values.schema.json, templates/_security.tpl}`; `values.schema.json` generated by code (rule 15); positive controls added to the test (each conditional rule passes once its condition is met). Two rewordings on the way: the description's "not a guarantee" met the test's word rule, and the store list in the description met gitleaks' `generic-api-key` (the store name ending in "key" before a hyphenated word); both reworded, no rule relaxed.

```
$ HELM4=... HELM3=... bash infra/tests/chart-skeleton.test.sh
ok   - helm v4.3.1 lint passes on the default values / template renders the default values
ok   - helm v4.3.1: the schema accepts vision.replicaCount=2,models.accessMode=ReadOnlyMany (and three more positive controls)
ok   - helm v4.3.1: the schema refuses a digest that is not sha256:<64 hex> ... an unknown top-level key (8)
(the same on v3.22.1)
# 51 passed, 0 failed, 0 skipped
$ bash infra/tests/chart-skeleton.test.sh            (no Helm on PATH)
# 23 passed, 0 failed, 2 skipped
$ helm-v4.3.1 lint deploy/helm/openverify
[INFO] Chart.yaml: icon is recommended
1 chart(s) linted, 0 chart(s) failed
```

### The gate (affected scope, rule 29), filter `...[2610a6b43]`

| Call | rc | Result | Time | Load |
| --- | --- | --- | --- | --- |
| `pnpm format:check` | 0 | the chart's YAML and JSON formatted; `templates/**` skipped by the chart-local `requirePragma` | 123 s | 0.41 / 1.36 |
| filtered lint and typecheck | 0 | no package in scope | 0 s | |
| `infra/tests/chart-skeleton.test.sh` with both Helms | 0 | 51 | 7 s | 1.36 |
| `infra/tests/supply-chain-skeletons.test.sh` | 0 | 110 | 0 s | |

CHECKPOINT chart DONE at 52acd7597

Handoff (chart):
- **Chart.yaml**: `apiVersion: v2`, `name: openverify`, `type: application`, `version: 0.1.0`, `appVersion: '0.1.0'` (the release's version string, android/gradle.properties' `openverifyVersion`; the root package.json still says 0.0.0, 11E's release:check reconciles), `kubeVersion: '>=1.35.0-0'`, no dependency. Frozen after Stage 1a with `values.schema.json`.
- **Value keys** (`values.yaml`, each commented; `values.schema.json` refuses any other top-level key): `imagePullSecrets`, `nameOverride`, `fullnameOverride`; `install.{mode (production|development), connectEnabled false, watchlistUnOptInAllowed false, queueInFlightCapMax 50, hstsMaxAge 0, logLevel}`; `publicUrls.{api, flow, dashboard}`; `external.postgres.{existingSecret, key DATABASE_URL, migrationSecret, migrationKey OPENVERIFY_MIGRATION_DATABASE_URL, runtimeRole openverify_runtime, maxConnections 100, ca}`, `external.valkey.{existingSecret, key REDIS_URL, ca}`, `external.s3.{endpoint, region, bucket, forcePathStyle, existingSecret, ca}`, `external.smtp.{existingSecret, key OPENVERIFY_SMTP_URL, mailFrom}`; a `ca` is `{}` or `{configMap|secret: <name>, key}`, mounted at `/etc/openverify/ca/<postgres|valkey|s3|vision>.pem`; `secrets.<api|worker|migrate|dashboard|flow|codeRunner|vision>.{existingSecret, keys}` (keys are variable names; defaults the required secrets: api KEK, blind-index key, pepper, vision token, BFF token, flow-server token; worker KEK, blind-index key, pepper, vision token, runner token; migrate KEK; dashboard BFF token; flow flow-server token; codeRunner runner token; vision vision token); `ingress.{enabled, className, hosts.{api, flow, dashboard}, tls, hsts.{enabled true, maxAge 31536000, includeSubDomains true, preload false}, maxBodySize 12m, maxBodySizeImport 28m, maxBodySizeTransactionFile 28m, annotations}`; `gateway.httpRoute.enabled false`; `networkPolicy.{enabled true, dns.{namespaceSelector, podSelector}, dataStoresInCluster.{enabled false, namespaceSelector, postgres|valkey|s3.{podSelector, port}}, publicInternetExcept (the private, loopback, link-local, CGNAT and IPv6 ranges), egress.{webhooks, providers, listSyncs, modelHosts, dataStores, smtp, identityProviders}}` (each egress list `[{cidr, ports}]`); `models.{source job|pvc, existingClaim, storageClass, accessMode ReadWriteOnce, size 2Gi}`; `network.{sourcesDisabled, sourcesEnabled, refresh false}`; `ipReputation.{existingClaim, path}`; `migrate.{gitOps false, lockTimeoutSeconds 600, activeDeadlineSeconds 900, backoffLimit 1, grantRuntime true, image}`; `modelsFetch.image`; `providers` (`{OPENVERIFY_PROVIDER_<KIND>_<MODE>: value}`, empty); `config.extra` (`{OPENVERIFY_*: value}`); per component `api`, `worker`, `dashboard`, `flow`, `vision`, `codeRunner`: `image.{registry, repository, tag, digest, pullPolicy}`, `replicaCount`, `resources`, `autoscaling.{enabled, minReplicas, maxReplicas, targetCPUUtilizationPercentage}`, `podDisruptionBudget.{enabled, minAvailable}`, `topologySpreadConstraints`, `priorityClassName`, `nodeSelector`, `tolerations`, `affinity`, `terminationGracePeriodSeconds`, `extraEnv`; and `api.{trustProxy, port 3000, internalListen.port 3101, handoffSendsPerHour 200, console.{idleTimeoutSeconds 1800, absoluteTimeoutSeconds 43200}, ssoPrivateIssuers []}`, `worker.{concurrency 4, heartbeatFile /tmp/openverify-worker-heartbeat, extraContainers [], extraVolumes [], playIntegrity.{packageName, certificateDigests}}`, `dashboard.{trustedProxyHops 0, port 3001}`, `flow.{port 4173, trustedProxyHops 0}` (the no-guidance image is the tag suffix `-noguidance`), `vision.{port 8000}` (4 GiB limit), `codeRunner.{enabled true, port 7700, poolSize 0}`. No `flow.allowedFrameAncestors`.
- **Schema rules** (draft 7): digests `^(sha256:[0-9a-f]{64})?$`; more than one vision replica needs `models.accessMode` ReadOnlyMany or ReadWriteMany; with `networkPolicy.enabled`, a configured `external.<postgres|valkey|s3>.existingSecret` needs `networkPolicy.egress.dataStores` (unless `dataStoresInCluster.enabled`), a configured `external.smtp.existingSecret` needs `egress.smtp`, and a non-empty `api.ssoPrivateIssuers` needs `egress.identityProviders`. The relational rules JSON Schema cannot hold are the templates' `fail`s (chart-11c): `migrate.activeDeadlineSeconds` above `lockTimeoutSeconds`, and the pools of every replica within `external.postgres.maxConnections`.
- **Helpers** (`templates/_security.tpl`; chart-policy-11c fills them, test-first; each takes a dict with `root` = `$`): `openverify.podSecurityContext` (`uid`, `gid`), `openverify.containerSecurityContext`, `openverify.tmpVolume`, `openverify.tmpVolumeMount`, `openverify.secretVolume` / `openverify.secretVolumeMounts` / `openverify.secretFileEnv` (`process`; the Secret at `/run/secrets/openverify`, `<NAME>_FILE=/run/secrets/openverify/<NAME>`), `openverify.caVolumes` / `openverify.caVolumeMounts` / `openverify.caFileEnv` (`process`), `openverify.ingressAnnotations` (`host` api|flow|dashboard, `path` default|import|transactionFile), `openverify.internalPathDeny`. `process` is one of `api`, `worker`, `migrate`, `dashboard`, `flow`, `codeRunner`, `vision`, `modelsFetch`.
- **Prettier**: `deploy/helm/openverify/.prettierrc.json` is the root's options plus `overrides: [{files: "templates/**", options: {requirePragma: true}}]`, held by `chart-skeleton.test.sh`; `values.yaml`, `Chart.yaml` and `values.schema.json` stay Prettier-formatted.

## 7. Checkpoint images

### Stubs (`0ed4ea45e`), RED (`d70a47961`), GREEN (`2f19db717`, `41dca4be4`)

- Stubs, in their own commit so the RED compiles: `packages/workflow-engine/src/code-runner/transport.ts` (the frozen names, `parseCodeRunnerTcpTarget` answering `null`, `connectCodeRunnerOverTcp` throwing "not built yet (Workflow 11C images-11c)"), exported from the package's `./code-runner`; `WorkflowCodeRunnerSetting` gains `{kind: 'tcp', host, port, token: string | null}` in `apps/api/src/config.ts`, so `createWorkflowEgressConfig` (`apps/api/src/workflows/actions/https/egress-config.ts`) needed its `tcp` branch to typecheck (no token: refused; with one: the not-built client); `apps/flow/src/security/runtime-config.ts` (the names, `faceGuidanceEnabled` answering `true`). The stubs' quoted names make `config-registry.test.ts` fail (unregistered), which is part of this RED.
- RED: `transport.test.ts` (6 failed: every accepted target), `runtime-config.test.ts` (8 failed: `off` and the refusals), `config-code-runner-tcp.test.ts`, `config-registry-11c.test.ts` and the registry test (18 failed); `egress-config-tcp.test.ts`'s three cases pass on the stub branch, which the type change forced into the stub commit.

```
$ (cd packages/workflow-engine && pnpm exec vitest run src/code-runner/transport.test.ts --coverage.enabled=false)   Tests 6 failed | 20 passed (26)
$ (cd apps/flow && pnpm exec vitest run src/security/runtime-config.test.ts --coverage.enabled=false)                Tests 8 failed | 4 passed (12)
$ (cd apps/api && pnpm exec vitest run src/config-code-runner-tcp.test.ts src/config-registry-11c.test.ts src/workflows/actions/https/egress-config-tcp.test.ts src/config-registry.test.ts --coverage.enabled=false)
× registers OPENVERIFY_FLOW_API_URL ... × describes the tcp: form ...; × reads tcp:<host>:<port> with its token in the worker ... × refuses the token's change-me placeholder in production;
× registers every variable a process reads; × names, for each variable, the process whose sources read it
Tests 18 failed | 27 passed (45)
```

- GREEN: the parse (`[<IPv6>]:<port>`, an IPv4 address or DNS labels, port 1 to 65,535 without a sign or leading zero), `faceGuidanceEnabled` (`on`/unset, `off`, else a `TypeError` naming the variable), `parseWorkflowCodeRunner`'s `tcp:` branch and message "must be pool, socket:<absolute path> or tcp:<host>:<port>", `OPENVERIFY_CODE_RUNNER_TOKEN` (the 32-byte schema, in `SECRETS`, `withCodeRunnerToken`: required in the worker while `tcp:`, optional in the API), the four registry entries in name order and the `.env.example` placeholders. One wording fix in my own RED test before GREEN: the repository's form is "is required while" (`Reader.required`). The GREEN commit carried a `regexp/prefer-d` lint error my command did not stop on; `41dca4be4` fixed it.

```
$ (cd packages/workflow-engine && pnpm exec vitest run src/code-runner/transport.test.ts --coverage.enabled=false)   Tests 26 passed (26)
$ (cd apps/flow && pnpm exec vitest run src/security/runtime-config.test.ts --coverage.enabled=false)                Tests 12 passed (12)
$ (cd apps/api && pnpm exec vitest run src/config-code-runner-tcp.test.ts src/config-registry-11c.test.ts src/workflows/actions/https/egress-config-tcp.test.ts src/config-registry.test.ts src/config-workflows.test.ts src/config-phase11b.test.ts src/config.test.ts --coverage.enabled=false)   Tests 173 passed (173)
$ bash infra/tests/compose.test.sh   # 610 passed, 0 failed
```

### The gate (affected scope, rule 29), filter `...[bd05b4e6e]`: `@openverify/workflow-engine`, `@openverify/api`, `@openverify/flow`

| Call | rc | Result | Time | Load before / after |
| --- | --- | --- | --- | --- |
| filtered typecheck | 0 | 3 of 3 | 104 s | 1.34 / 1.66 |
| filtered lint (`--concurrency=1`, 4 GB heap) | 0 | 3 of 3 | 315 s | 1.66 / 1.76 |
| `pnpm format:check` | 0 | | 118 s | 1.62 / 1.36 |
| workflow-engine and flow unit | 0 | 2,022 at 97.99%; 1,651 at 94.96% | 109 s | 1.36 / 7.81 |
| API, 8 blob shards (partial coverage only) and the merge | 1 x 8 / 0 | 10,839 in 856 files at 94.17% | 172-222 s, merge 44 s | 6.15 / 4.62 |
| integration graph / api 1-3 | 0 x 4 | 13 / 123, 128, 193 | 41 / 123, 200, 137 s | 3.59 / 18.28 |
| `benchmark:typecheck` / `benchmark:test` (rule 16: `config.ts` changed) | 0 / 0 | 119 | 75 / 13 s | 18.28 / 5.47 |
| `infra/tests/compose.test.sh` (`.env.example`) | 0 | 610 | 17 s | 5.47 / 4.48 |

No db integration (packages/db unchanged), no Android, no e2e (no `e2e/`, `infra/` or stack change; the `.env.example` lines are comments); the last checkpoint's full gate covers them.

CHECKPOINT images DONE at 41dca4be4

Handoff (images; amendment items 9-19 of the plan's Stage 1a section hold the same, with their reasons):
- **Images** (linux/amd64 only; every one multi-stage, production dependencies only, runs as `10001:10001`, works with `--read-only --tmpfs /tmp`, no `HEALTHCHECK`; local tags `openverify/<name>:11c-local`, never `latest`, never pushed):

  | Image | Dockerfile | Final-stage workdir and command | Port |
  | --- | --- | --- | --- |
  | `openverify/api` | `infra/docker/api.Dockerfile` | `/app` (the deployed `apps/api`): `node dist/server.js` by default; `node dist/worker.js`; probe `node dist/worker-health.js`; commands `node dist/commands/<file>.js` | 3000 (+ 3101 internal) |
  | `openverify/dashboard` | `infra/docker/dashboard.Dockerfile` | Next.js `output: 'standalone'` with the custom server (C21) run beside it: `node server.js` names the compiled or type-stripped `apps/dashboard/server.ts`, never Next's generated server (which drops the peer-address header) | 3001 |
  | `openverify/flow` and `openverify/flow:11c-local-noguidance` | `infra/docker/flow.Dockerfile` (build argument `OPENVERIFY_FLOW_FACE_GUIDANCE=on|off`) | `node server.ts --hostname 0.0.0.0 --port 4173 --dist <bundle>` (Node's type stripping, as today) | 4173 |
  | `openverify/vision` | `services/vision/Dockerfile` | `uvicorn openverify_vision.app:create_app --factory --host 0.0.0.0 --port 8000 --no-server-header` | 8000 |
  | `openverify/code-runner` | `infra/docker/code-runner.Dockerfile` | `node bin/code-runner-server.mjs` (socket, or `OPENVERIFY_CODE_RUNNER_LISTEN` for `tcp:`) | 7700 for `tcp:` |

  Release tags are `<version>` and `<version>-noguidance` (the chart's `flow` tag suffix). The flow image without guidance is Phase 10 P2's decline outcome; the one with guidance is the release's (P2 granted narrowly), not `pending-owner`.
- **Bases** (by digest, read 2026-11-14): `node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d` (built 2026-03-16) for api, dashboard, flow and code-runner; `python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159` (the index of 2026-10-28, Python 3.12.16, from docker-library/repo-info; today's tag points at a build of 2026-11-05, 9 days old, so it is not taken) and `ghcr.io/astral-sh/uv:0.13.3@sha256:bee0a2a458fd956c5df7b8b4c5fed2257b0af34866e3da7b51db0be3acb375d1` (2026-10-20, Q5's) for vision. Build arguments `NODE_IMAGE`, `PYTHON_IMAGE`, `UV_IMAGE` default to them.
- **Labels and build arguments**: `org.opencontainers.image.source` (`SOURCE_URL`), `.revision` (`REVISION`, the git commit), `.version` (`VERSION`), `.licenses` (`Apache-2.0`), `.title` (the image name), and `dev.openverify.licence-status`: `pending-owner` on `openverify/api` while Q11 is open (nodemailer's MIT-0), `decided` on the others. No build argument carries a secret, and no image is built with `VITE_OPENVERIFY_API_URL`.
- **The command map** (`apps/api/tsconfig.commands.json`, `rootDir: "."`, emitting `dist/commands/`; the file is the command with `:` as `-`): `db:migrate` -> `db-migrate.js` (from `scripts/migrate.ts`), `db:grant-runtime` -> `db-grant-runtime.js`, `seed:dev` -> `seed-dev.js` (still refuses production mode), `kek:rewrap`, `blind-index:rebuild`, `face-index:rebuild`, `face-scan:benchmark`, `user:reset-mfa`, `user:allow-password`, `api-keys:pepper-status`, `retention:run`, `trust-anchors:sync`, `trust:sandbox-utopia`, `org:create`, `watchlists:sync`, `watchlists:rekey`, `pep:sync`, `network:sync`, `graph:reindex` -> `<same-with-hyphens>.js`. Not compiled (development tools): `graph:benchmark` and `scripts/workflow-benchmark.ts` (they import `@openverify/db/testing`), `analytics:benchmark`, `workflow-docs:write`. `package.json` keeps `tsx` for development; a test fails when an operator command has no compiled file.
- **The API image's contents**: `dist/test-support/` and the `*.test-support.*` files left out (orchestrator decision 24); `@openverify/emrtd`'s `dist/testing/` kept (`trust:sandbox-utopia`, the sandbox chip route, the sandbox anchor); `data/variant-groups.json`, the disposable list, the three ASN seeds and `data/manifest.json` baked with their `sha256sum -c` lines (inventory 3.6: each licence allows redistribution); no `*.mmdb`, no face, no `.env`.
- **Variables** (registry entries, `apps/api/src/config-registry.ts`): `OPENVERIFY_FLOW_API_URL` (flow; unset falls back to `VITE_OPENVERIFY_API_URL`, read at start today, OD-11C-3), `OPENVERIFY_FLOW_FACE_GUIDANCE` (flow, build time, `on` default), `OPENVERIFY_CODE_RUNNER_TOKEN` (worker and code-runner, a secret with `_FILE`, at least 32 bytes), `OPENVERIFY_CODE_RUNNER_LISTEN` (code-runner, `<host>:<port>`). Names and helpers: `@openverify/workflow-engine/code-runner` exports `CODE_RUNNER_LISTEN_VARIABLE`, `CODE_RUNNER_TOKEN_VARIABLE`, `CODE_RUNNER_TOKEN_MIN_BYTES` (32), `parseCodeRunnerTcpTarget(value): {host, port} | null` and the stub `connectCodeRunnerOverTcp({host, port, token}): CodeRunner`; `apps/flow/src/security/runtime-config.ts` exports `FLOW_API_URL_VARIABLE`, `FLOW_FACE_GUIDANCE_VARIABLE`, `FLOW_RUNTIME_CONFIG_PATH` (`/config.json`) and `faceGuidanceEnabled(value)`; `config.workflows.codeRunner` is `{kind: 'tcp', host, port, token}` (token `null` in the API).
- **For images-11c**: build `connectCodeRunnerOverTcp` and the runner's listener beside the socket ones (the same frames, limits and request checks; the token sent first and compared in constant time; a wrong token closes the connection), test-first; the flow's run-time path (C257.1) with `faceGuidanceEnabled` in `vite.config.ts`; the same `<NAME>_FILE` read for the flow server's, the console's, vision's and the runner's tokens (both forms set refused, trailing line ends trimmed, a relative, unreadable or empty file refused, a world-readable one warned as `secret_file_readable`), test-first, with a start test at mode 0440; `db:migrate`'s backfill keyring (amendment 17).

## 8. Checkpoint adr, the amendments and the final gate

### RED (`2c7eb39cf`) and GREEN (`4416c3fcd`)

`infra/tests/adr-deployment.test.sh` (new): rules 4, 4a and 5 of ADR 0010 written and naming what they bind; no affirmed certification, compliance or signature (a denial such as rule 6's "never certified" is the rule itself).

```
$ bash infra/tests/adr-deployment.test.sh     (RED)
FAIL - rule 4 is written, not a placeholder ... FAIL - the status no longer says rules 4 and 5 are headings only
# 1 passed, 25 failed
$ bash infra/tests/adr-deployment.test.sh     (first GREEN draft)
FAIL - the ADR claims no certification, compliance or signature (complies)      ("so it complies whichever way...": reworded)
$ bash infra/tests/adr-deployment.test.sh
# 26 passed, 0 failed
```

The plan's "## Workflow 11C Stage 1a amendments (contracts-11c)", items 1-30, is `6d4a8f8e3`.

### The final gate (full, rule 29: the last checkpoint), on `6d4a8f8e3`

| Call | rc | Result | Time | Load before / after |
| --- | --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | lockfile up to date | 1 s | 0.23 |
| `pnpm format:check` | 0 | | 125 s | 0.23 / 1.30 |
| forced typecheck | 0 | 19 of 19 | 160 s | 1.30 / 4.52 |
| forced lint api / dashboard + contracts / the other 16 | 0 / 0 / 0 | | 246 / 225 / 344 s | 3.90 / 1.84, 1.84 / 1.31, 1.31 / 1.68 |
| db unit | 0 | 2,357 at 89.88% | 196 s | 1.68 / 9.58 |
| watchlist + e2e unit | 0 | 820 + 144 | 290 s | 9.58 / 1.10 |
| dashboard, 2 blob shards (partial coverage only) and the merge | 1 / 1 / 0 | 7,222 at 95.67% | 242 / 231 / 7 s | 0.86 / 7.31 |
| the other 13 packages | 0 | ui 58, flow-spec 527, emrtd 338, node 508, core 2,007, config 412, signals 192, workflow-engine 2,022, checks 3,849, contracts 4,905, flow 1,651; react and demo-web none yet | 200 s | 7.31 / 13.15 |
| `@openverify/js` | 0 | 19 | 5 s | |
| API, 8 blob shards (partial coverage only) and the merge | 1 x 8 / 0 | 10,839 in 856 files at 94.17% | 161-240 s each, merge 40 s | 9.54 / 4.57 |
| integration db / graph / api 1-3 | 0 x 5 | 110 / 13 / 123, 128, 193 (444) | 113 / 44 / 126, 193, 120 s | 3.83 / 16.05 |
| Android (1) ui / flow / rest (`--rerun`) | 0 x 3 | 532 + 427 + 1,773 = 2,732, none skipped | 159 / 52 / 104 s | 9.72 / 2.29 |
| (2) screenshots (`--rerun`) / (3) / (4) (`--rerun-tasks`) | 0 x 3 | 97; demo 106 (97 + 9), nfc 116, face 51 | 63 / 13 / 138 s | 2.29 / 6.13 |
| (5) / (6) / (7) / (8) | 0 x 4 | | 12 / 11 / 10 / 12 s | 6.13 / 6.35 |
| (9) | 0 | 98 release-check tests OK; ELF, consumer rules, size pass | 13 s | 6.35 |
| (10) staging / consumer check | 0 / 0 | | 11 / 11 s | 5.62 / 4.30 |
| (11) three combinations | 0 x 3 | | 25 / 24 / 25 s | 4.30 / 3.96 |
| (12) `cyclonedxBom` (`--rerun-tasks`) | 0 | sdk 188, nfc 195, face 190 components | 12 s | 3.96 / 4.69 |
| infra tests, 14 scripts | 0 x 14 | apps-image-context 43, check-connected-results 25, ci-workflow 411 (0 skipped), code-runner 55, compose 610, flow-headers 25, flow-server 38, gitleaks-config 10, install-gitleaks 31, pre-commit-hook 11, vision-container 55, supply-chain-skeletons 110, adr-deployment 26, chart-skeleton 51 (both Helms, 0 skipped): 1,501 | 0-61 s | 3.96 / 1.52 |
| mocked flow suite | 0 | 349 | 123 s | 1.00 / 9.95 |
| stack down + build / up | 0 / 0 | | 1 / 97 s | 9.95 / 4.84 |
| chromium shards 1-4 | 0 x 4 | 50, 52, 47, 49 (198) | 299 / 364 / 275 / 392 s | 4.84 / 1.67 |
| console sweep | 0 | 109 | 312 s | 1.67 / 2.84 |
| `:openverify-sdk:stackTest` (`--rerun`) | 0 | 3 of 3 (`AndroidFlowStackTest`, `AndroidNfcFlowStackTest`, `AndroidConnectFlowStackTest`) | 60 s | 2.84 / 2.79 |
| stack down | 0 | | 3 s | |
| `gitleaks git --redact --log-opts=2a83a93e7..HEAD .` | 0 | 19 commits, no leaks | | |

Lock waits 0 s on every Gradle and e2e call. Calls (3) and (5) to (10) found their outputs up to date from the deps gate and this session's calls; they ran, in order, in this session (KP10-34). No CI run was read as proof and none was waited for.

CHECKPOINT adr DONE at 6d4a8f8e3

Handoff (adr): ADR 0010's status reads accepted for its Connect half (11A) and its deployment half, rules 4, 4a and 5 (11C); rule 6 is integration-11e's, which finalises the record. `infra/tests/adr-deployment.test.sh` holds the deployment half; a later edit that affirms a certification, compliance or a signature fails it.
