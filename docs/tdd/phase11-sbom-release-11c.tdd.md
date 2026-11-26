# Phase 11, Workflow 11C: sbom-release-11c (family S; C261, C262's steps, C267.1)

Stage 2 agent, beside the other 11C builders (rule 25: parallel gates). Owned paths: `.github/workflows/release.yml` (contracts-11c's skeleton), `security/check-sbom-licences.py` with its tests and fixtures (`security/tests/test_check_sbom_licences.py`, `security/tests/fixtures/licences.md`), `infra/tests/release-workflow.test.sh`, and this file. Named borrowed edits: the AAR SBOM and licence step in Phase 10's `.github/workflows/android-release.yml` (review H23) with `infra/tests/ci-workflow.test.sh`'s android-release checks (integration-11c's file), and one durable check of contracts-11c's `infra/tests/supply-chain-skeletons.test.sh` (section 4). No checkpoint of mine gates another agent.

Waits (rule 17): images-11c "images" gates the real runs over the images (section 6); scanners-11c "image-tools" (landed at `8c2584905`, `CHECKPOINT image-tools DONE at f33b7783cc65a3071f03c366f13e1d053b3bf38b`) gates the local Syft, Grype and Trivy runs.

## 0. Continuation after the stop of 2026-11-14

The Workflow stopped cleanly at 15:17 EST on 2026-11-14 (the owner's weekly usage at 98%), before this file was written. Six commits name this area at the stop; nothing was redone. The evidence of sections 1 to 3 is taken from those commits (their messages carry the counts) and from re-runs on 2026-11-15, each marked as such; no output below is invented.

| Commit | Kind | What |
|---|---|---|
| `1aa1a6028` | chore (stub) | the frozen names of `security/check-sbom-licences.py`, each raising "not built" |
| `8869b5174` | test (RED) | the licence check's 97 tests over synthetic CycloneDX fixtures |
| `a54df6c72` | feat (GREEN) | the licence check (97 passed, 96% coverage) |
| `6c781604d` | test (RED) | `infra/tests/release-workflow.test.sh` (51 failing on the skeleton) |
| `0cfe35bce` | test (RED) | android-release.yml's SBOM checks in `ci-workflow.test.sh` (5 failing) |
| `f7ccb696a` | ci (GREEN) | android-release.yml's SBOM and licence step (`ci-workflow.test.sh` 417 passed) |

## 1. The licence check (C261.2)

### Interface

```
python3 -I security/check-sbom-licences.py --artifact <id> --sbom <cyclonedx.json> [--licences THIRD_PARTY_LICENSES.md] [--report <report.json>]
python3 -I security/check-sbom-licences.py --list-artifacts
```

- Artifact ids: `image:{api,dashboard,flow,flow-noguidance,vision,code-runner}`, `aar:{openverify-sdk,openverify-nfc,openverify-face}`, `npm:{openverify-js,openverify-node,openverify-react}`, `source:{pnpm,vision,load}`.
- Outcomes per component: `pass` (rule 4's SPDX list, ours, or a ledger row with a recorded decision, the row named), `owner` (a shipped "owner to confirm" or "pending owner decision" row: exit 0, the report's `pending-owner: true`, `label: "pending-owner"`), `fail` (unknown licence, section 5 tooling that shipped, section 6 outside the artifact its "Shipped in" names, LGPL outside `openverify-nfc`, any `com.google.android.play` component), `aggregation` (base-distribution packages, C257.5), `report` (source trees: listed, never judged; Stage 1a amendment 21).
- tslib's 0BSD row passes as Phase 5 decision 46 (rule 21). Section 6 rows and the vendored code of sections 2.1.4 and 2.1.5 are listed by hand per artifact (review H20): Eigen in `image:flow` (`:568`), in `image:vision` (`:569`) and in `aar:openverify-face` (`:567`); SCUBA's two files only in `aar:openverify-nfc` (`:566`). `image:flow-noguidance` carries no onnxruntime-web, and finding it there fails.
- Report: `openverify/sbom-licence-report@1`, JSON with sorted keys, default path `<sbom stem>.licences.json`: `artifact`, `sbom`, `result` (`pass`, `owner`, `fail`), `pending-owner`, `label`, `counts`, `owner`, `failures`, `aggregation`, `components`. 11E's `release:check --tag` reads it.
- Exit codes: 0 pass (owner items included), 1 a failure, 2 a usage or input error.

### RED (`8869b5174`, from the commit)

Against the stub `1aa1a6028`, whose every name raises "not built": 97 tests failing for that reason (commit message: "97 failing on not built").

### GREEN (`a54df6c72`, from the commit; re-run 2026-11-15)

Commit message: "97 passed, 96%". Re-run on 2026-11-15 (load 10.63 4.56 1.72), without coverage while iterating:

```
$ uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir . security/tests/test_check_sbom_licences.py -q --no-cov
97 passed in 0.45s
```

The end gate with coverage is in section 8.

## 2. android-release.yml's SBOM step (C261.1, review H23; borrowed edit)

### RED (`0cfe35bce`, from the commit)

`infra/tests/ci-workflow.test.sh` (integration-11c's file, a named borrowed edit) gained the android-release checks: the gate writes each published module's CycloneDX SBOM after the staged repository and runs the licence check over each before the upload, failing only after all three; the SBOMs and reports kept 30 days; a warning on pending-owner; no SBOM for `android/consumer-check`. Commit message: "5 failing".

### GREEN (`f7ccb696a`, from the commit)

The gate job's step "The published modules' SBOMs and the licence check over each": `./gradlew cyclonedxBom`, then for `openverify-sdk`, `openverify-nfc` and `openverify-face` the plugin's `<module>/build/reports/cyclonedx/bom.json` copied to `android/build/sbom/<module>.cdx.json` and checked as `aar:<module>` (`|| rc=1`, `exit "$rc"` after all three), a `::warning` for each report with `"pending-owner": true`; then gitleaks (unchanged) and the upload `openverify-android-<version>-sboms` (`android/build/sbom/`, 30 days). Commit message: "ci-workflow.test.sh 417 passed".

## 3. release-workflow.test.sh (C267.1, C262, C261.3)

### RED (`6c781604d`, from the commit; re-run 2026-11-15)

Against contracts-11c's skeleton: "51 failing on the skeleton". On 2026-11-15 the RED run before the GREEN edit:

```
$ bash infra/tests/release-workflow.test.sh
skip - zizmor not installed (infra/scripts/install-zizmor.sh)
# 32 passed, 51 failed, 1 skipped
```

### A defect in the RED test, fixed (`4d26bfe39`)

The first GREEN run showed the build checks reading only the first line of each multi-line `docker build`: the pattern `docker build[^\n]*(?:\\\n[^\n]*)*` lets the greedy `[^\n]*` take the trailing backslash and match with zero continuations, so those checks could never pass. The test now joins every shell continuation before it reads a build line. Against the skeleton (HEAD's workflows copied into a temporary tree) the fixed test still fails for the intended reason:

```
$ bash <tmp>/infra/tests/release-workflow.test.sh
FAIL - build: openverify/api is built from infra/docker/api.Dockerfile for linux/amd64 with its labels' arguments (no docker build line)
# 33 passed, 51 failed, 0 skipped
```

(zizmor 1.31.1 was on `~/.local/bin` by then, so it ran on the skeleton and passed.)

## 4. release.yml GREEN (`f104442d8`, refined in `0ce5e4073`, `b53041d16`, `239f38b75`)

### The borrowed edit before it (`511749dae`)

contracts-11c's `infra/tests/supply-chain-skeletons.test.sh` held "publish widens no permission", one of the durable checks its handoff names; C262.1 gives the publish job its own token. The check now lets publish hold exactly `contents: read`, `id-token: write`, `packages: write`, `attestations: write`, and still holds build, verify and stage to nothing more (108 passed, 0 failed, 12 skipped).

### First GREEN run, and what it showed

```
$ bash infra/tests/release-workflow.test.sh          (first try)
FAIL - its header gives the run's minutes as an estimate (C267.1, C267.5)
FAIL - cosign is installed before the installers that check signatures with it
# 90 passed, 2 failed, 0 skipped
```

The header began "About" (the check reads "about 35 to 45 minutes ... estimate"), and verify installed cosign in the same step as the tools whose signatures it checks; cosign now has its own step in build, verify and publish.

### The inline scripts, run by hand before the commit (2026-11-15, load 4.35-5.96)

Each script was extracted from the workflow (YAML-parsed, the heredoc body) and run:

- The allowlist step over `security/allowlist.yaml` (`[]`): `0 allowlist entries, 0 by package`, Grype `{"ignore": []}`. Its first Rego form iterated an array literal, and Trivy 0.76.0 refused the empty one: `trivy.rego:16: rego_type_error: undefined ref: data.trivy.allowed[__local6__]`. It now writes one rule per entry, none for an empty list, and Trivy loads it (`trivy image --input python-3.12-slim.tar ... --ignore-policy`: rc 0, 51 high findings listed).
- A synthetic entry `CVE-2026-109518` in package `apt` (the base image's own finding), by its id and then by its vendor id `DSA-6607-1`: Trivy 51 -> 50 findings each time, the same CVE still reported in `libapt-pkg7.0` (package-scoped). Grype with the generated config: 220 -> 219 matches, one in `ignoredMatches`, the same CVE still in `libapt-pkg7.0`; Grype exits 2 at `--fail-on high`, which the step maps to `rc=1`.
- An expired entry and one expiring 2027-12-31 (more than 90 days ahead): `::error title=allowlist::CVE-2026-0002 expired on 2026-01-01`, `... expires 2027-12-31, more than 90 days ahead`, exit 1.
- Fresh databases: `grype db update` (Grype's built `2026-11-15T06:19:39Z`), `trivy version --format json` (`UpdatedAt` `2026-11-15T12:50:30Z`); the summary script printed both dates and exited 0.
- gitleaks over a `docker save` of `python:3.12-slim` unpacked by the step's loop (4 layers, 172 MB): 4 generic-api-key findings, all `GPG_KEY=<fingerprint>` in the image's config and provenance blobs, the CPython release manager's public OpenPGP fingerprint, which the vision image inherits. The step now extends `.gitleaks.toml` with one allowlist entry, that pattern only inside `/archive/blobs/sha256/<digest>`, `condition = "AND"`: the scan passes, and the same text written into another file still fails (`leaks found: 1`).
- The release notes script over a fabricated staged tree (`image:api` pending-owner with nodemailer 10.1.6 MIT-0): the notes name the artifact and its owner item, list the runtime bases from the Dockerfiles (the uv image, a build stage of vision, is left out) and quote SHA256SUMS.

```
$ bash infra/tests/release-workflow.test.sh
# 92 passed, 0 failed, 0 skipped
$ bash infra/tests/supply-chain-skeletons.test.sh
# 108 passed, 0 failed, 12 skipped
$ actionlint .github/workflows/release.yml                 (exit 0)
$ zizmor --offline .github/workflows/release.yml            (exit 0) No findings to report. Good job!
$ zizmor --offline --min-severity medium .github/workflows/ (exit 0) No findings to report. Good job! (10 ignored, 4 suppressed)
$ pnpm exec prettier --check .github/workflows/release.yml  All matched files use Prettier code style!
```

(zizmor over `.github/workflows/` and `.github/actions/` together reports one high, `github-env` in `.github/actions/setup-pnpm/action.yml:24`, not this area's file; release.yml does not use that action.)

### Tests added after GREEN (`efc601c4a`)

release-workflow.test.sh now runs the allowlist step's own conversion over synthetic allowlists and holds the gitleaks entry's narrowness. A copy of the tree with `condition = "AND"` removed and an empty-list rule put back fails 3 checks (`# 94 passed, 3 failed`); the tree passes 97.

### The npm packages through sdk-web-11c's pack tool (RED `a2e961550`, GREEN `0ce5e4073`)

sdk-web-11c's pack tool landed GREEN at `e77c5adc8`: `node packages/sdk-react/scripts/pack-release.ts --out <dir> [--version <x.y.z>] <package dir>...`, after the turbo build. `pnpm pack` of a workspace manifest would ship the `@openverify/source` condition and `@openverify/node`'s private dependencies. RED: 2 failing ("packed by sdk-web-11c's release pack tool", "no workspace manifest is packed as it stands"); GREEN: 98 passed.

### The npm SBOMs were empty (RED `a0814916f`, GREEN `b53041d16`)

The first real run (section 5) gave each npm tarball an SBOM with no component: a `dir:` scan leaves Syft's `javascript-package-cataloger` out. The scan now selects it. RED 1 failing, GREEN 98 passed.

### kind.sh as chart-policy-11c built it (RED `c96b2bfd1`, GREEN `239f38b75`)

`deploy/helm/openverify/ci/kind.sh` (`cebca92ff`) reads the image tag from `OPENVERIFY_KIND_IMAGE_TAG`, runs `ct install` in `install`, and its `upgrade` runs the smoke again. verify now installs chart-testing through `infra/scripts/install-chart-testing.sh`, exports `OPENVERIFY_KIND_IMAGE_TAG="$VERSION"` and `SUPPLY_CHAIN_TOOLS_DIR="$RUNNER_TEMP/bin"`, and drops its second smoke call. RED 2 failing, GREEN 100 passed.

## 5. The licence check's two fixes from the real runs

### Empty SBOMs and Syft's file entries (RED `a4d90bdff`, GREEN `5b4cd0640`)

The npm SBOMs without the package cataloguer listed nothing and the check passed them (`result: pass (0 components ...)`): an empty scan proved nothing. With the cataloguer Syft also lists the `package.json` it read as a `type: file` entry with hashes only, which the check failed as an unknown licence. Now a hash-only file entry is not judged (a file with a licence still is), and an image, AAR or npm SBOM with no package fails as `empty-sbom`; an empty source-tree SBOM is not failed. RED:

```
E       AssertionError: assert [] == [('fail', 'empty-sbom')]
6 failed, 98 passed in 0.66s
```

GREEN: `104 passed in 0.36s`; mypy --strict, ruff check and ruff format --check clean.

### Section 6's licence cell (RED `1d78bf7a5`, GREEN `e10484c4a`)

The AAR run reported SCUBA's two files with the licence ``GPL-2.0-only WITH Classpath-exception-2.0` (the headers of the two files in the sources jar)``: the cell's note after the expression. The finding now carries the leading backticked expression. RED `1 failed, 104 passed`; GREEN `105 passed`.

### Nested manifests and the operating system (RED `bea6ac285`, test fix `6674b6b4b`, GREEN `ec78ac966`)

The API image's first run failed 16 components: 13 subpath manifests of libphonenumber-js (`libphonenumber-js/min/package.json`, `private`, no version), pino's `test/fixtures/transport/package.json`, secure-json-parse's `benchmarks/package.json`, and Syft's `operating-system` component `debian 12.13`. A `package.json` inside a catalogued npm package's directory, with no `node_modules` between them, now passes as `inside-package` naming that package (whose own licence is judged); a package installed under another, or a nested manifest whose package is not in the SBOM, is still judged; the `operating-system` component is the base distribution. RED `2 failed, 107 passed` (then one defect in my own test: its builder named the subpath manifest "min", where Syft writes "libphonenumber-js/min"); GREEN `109 passed`.

### PyPI's BSD name and the python base's interpreter (RED `f9832b2af`, GREEN `2a43f768b`)

The vision image failed `protobuf` 7.36.2 ("3-Clause BSD License", PyPI's name for BSD-3-Clause, now an alias) and `python` 3.12.16 (the base image's CPython, found by Syft's binary classifier at `/usr/local/bin/python3.12` and `/usr/local/lib/libpython3.12.so.1.0`; `/usr/local/lib/libpython3` joins the base paths). A test holds that FFmpeg inside a wheel is never base. RED `2 failed, 110 passed`; GREEN `112 passed`.

## 6. The real runs (item 4)

All on 2026-11-15, Syft 1.54.1, Grype 0.120.1, Trivy 0.76.0 from `~/.local/bin` (scanners-11c's installers), the licence check at its final state (`2a43f768b`), `THIRD_PARTY_LICENSES.md` at HEAD.

### Images (images-11c's `11c-local` builds at its checkpoint `b917cb80e`; each call `flock -E 75 -w 240 /tmp/openverify-e2e.lock`, `docker save`, then `syft scan docker-archive:<tar> -o cyclonedx-json=<sbom>` as release.yml does, then the check)

| Artifact | Archive | save, Syft | Load (start) | Components | pass | owner | fail | aggregation | Result |
|---|---|---|---|---|---|---|---|---|---|
| image:api | 116.5 MB | 7 s, 11 s | 2.35 4.14 9.65 | 288 | 197 (18 inside-package) | 1 | 0 | 90 | owner: nodemailer 10.1.6 MIT-0 (`THIRD_PARTY_LICENSES.md:118`, Q11), **pending-owner** |
| image:dashboard | 88.8 MB | 4 s, 9 s | 5.34 4.79 9.04 | 152 | 62 | 0 | 0 | 90 | pass |
| image:flow | 84.3 MB | 5 s, 10 s | 3.83 4.48 8.82 | 93 | 3 (Eigen, `:654` §6, named) | 0 | 0 | 90 | pass |
| image:flow-noguidance | 80.4 MB | 5 s, 8 s | 1.15 1.71 5.62 | 92 | 2 (no Eigen) | 0 | 0 | 90 | pass |
| image:vision | 181.3 MB | 9 s, 6 s | 1.79 1.79 5.31 | 134 | 37 (Eigen `:655` §6; RapidOCR `:507`, Silent-Face `:515`, MediaPipe points `:516`) | 0 | **1** | 96 | **fail: ffmpeg 8.1.1** |
| image:code-runner | 86.0 MB | 4 s, 9 s | 2.09 1.44 3.80 | 103 | 13 | 0 | 0 | 90 | pass |

(The no-guidance and code-runner calls first met a busy lock, exit 75, and were run again.) On the API image openid-client 6.8.8, oauth4webapi 3.8.8 and jose 6.2.12 pass by licence; tslib 1.14.1 and 2.8.1 pass as Phase 5 decision 46 (`:117`).

**The vision image fails, rightly.** Syft's binary classifier finds FFmpeg 8.1.1 (`libavcodec`, `libavformat`, `libavutil`, `libswresample` under `site-packages/opencv_python_headless.libs/`). The wheel's own `LICENSE-3RD-PARTY.txt` says "FFmpeg is redistributed within all opencv-python packages" (LGPL-2.1+); the same directory holds `libquadmath` (LGPL-2.1+) and `libgfortran` (GPL-3.0+ with the GCC runtime exception), which no classifier names. `docs/research/phase3-libraries.md` section 6 recorded this as needing "an owner exception or a custom build", and `docs/plans/phase-3.plan.md:310` left it "the open owner decision"; `THIRD_PARTY_LICENSES.md:97` lists the wheel as Apache-2.0 with no row for what it bundles. The check is not weakened; the ledger row it needs is in the report's contract deviations.

### The release gate over the images (C259.2, the empty allowlist; Trivy `--severity CRITICAL,HIGH --exit-code 1` and Grype `--fail-on high`, as release.yml runs them)

Run outside the e2e lock (it was held by another agent for over 12 minutes; the scans read saved archives and the cached databases), so no time here is a measurement. Trivy's database built 2026-11-15T12:50Z, Grype's 2026-11-15T06:19Z.

| Image | Trivy critical, high (all Debian unless named) | fixable | Grype high and critical outside Debian |
|---|---|---|---|
| api, dashboard, flow, flow-noguidance, code-runner (each) | 6 critical, 52 high in 26 packages, all Debian | 19 | the `node` 22.22.1 binary: 1 critical, 6 high (fixed in 22.22.2 to 22.23.4) |
| vision | 51 high Debian, 7 high `pypdf` 6.21.2 (fixed in 6.21.3, 6.21.4) | 11 | FFmpeg 8.1.1 (5 high), `pypdf` 6.21.2 |

So a staged release.yml run today fails verify's gate on every image, as C259.2 requires, until the bases, Node and pypdf move within rule 3 or the owner's reviewers add allowlist entries with reasons. No entry was added here (rule 10: never to hide a finding a version bump can fix).

### Source trees

| Artifact | Command | Components | Result |
|---|---|---|---|
| source:pnpm | `syft scan dir:. --override-default-catalogers javascript-lock-cataloger,javascript-package-cataloger --exclude './android/**' --exclude './services/**' --exclude '**/node_modules/**' --exclude './dist/**'` (16.6 s, load 5.58, no lock) | 860 packages (881 entries before Syft's file records were skipped) | reported, not judged |
| source:vision | `syft scan file:services/vision/uv.lock` | 61 (62) | reported |
| source:load | `load/uv.lock` does not exist yet | - | skipped as release.yml skips it |

### npm tarballs (sdk-web-11c's pack tool)

`pnpm turbo run build --filter=@openverify/js --filter=@openverify/node --filter=@openverify/react` (6 tasks, 57.3 s, load 5.12; no lock, not a measurement), then `node packages/sdk-react/scripts/pack-release.ts --out <dir> --version 0.1.0 packages/sdk-js packages/node packages/sdk-react`: `openverify-js-0.1.0.tgz` 11,200 bytes (9 files), `openverify-node-0.1.0.tgz` 1,575,209 bytes (509 files, the vendored closure), `openverify-react-0.1.0.tgz` 7,686 bytes (9 files). Each unpacked and scanned with `--override-default-catalogers javascript-package-cataloger`: 1 component each (the package itself, Apache-2.0, first-party), result pass. The tarball's declared dependencies (zod, @openverify/js) install at the consumer and are in source:pnpm, not in the tarball's SBOM (C261.4).

### AARs

`(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon cyclonedxBom)`, after `python3 -I scripts/fetch_models.py --only face_detection_yunet` and `python3 -I scripts/fetch_fixtures.py --only person_a_id`: exit 0, 15 s in all with about 2 s lock wait (`BUILD SUCCESSFUL in 13s`, 6 tasks up to date, configuration cache reused), load 5.48 -> 6.53.

| Artifact | Components | Result | Section 6 |
|---|---|---|---|
| aar:openverify-sdk | 188 | pass (188 by licence) | none |
| aar:openverify-nfc | 196 | pass: 188 by licence, 4 LGPL in nfc (jmrtd, scuba-smartcards, scuba-sc-android, cert-cvc), 3 recorded decisions, 1 first-party | SCUBA's two files, `:652`, `GPL-2.0-only WITH Classpath-exception-2.0` |
| aar:openverify-face | 191 | pass: 189 by licence, 1 recorded decision, 1 first-party | Eigen in onnxruntime-android, `:653`, MPL-2.0 |

No owner item in any AAR (JUnit 4 is test scope and in no runtime SBOM).

## 7. End gates (2026-11-15, load 3.25 1.95 2.25 at the start)

| Call | Exit | Result |
|---|---|---|
| `uv run --project security/python --frozen pytest -c security/python/pyproject.toml --rootdir .` | 0 | 196 passed (112 of them `security/tests/test_check_sbom_licences.py`); `security/check-sbom-licences.py` 97%, total 97.08% (floor 80) |
| `uv run --project security/python --frozen ruff check security scripts/fetch_k8s_schemas.py scripts/tests` | 0 | All checks passed! |
| `uv run --project security/python --frozen ruff format --check security scripts/fetch_k8s_schemas.py scripts/tests` | 0 | 8 files already formatted |
| `uv run --project security/python --frozen mypy --strict security/check-sbom-licences.py scripts/fetch_k8s_schemas.py` | 0 | Success: no issues found in 2 source files |
| `bash infra/tests/release-workflow.test.sh` | 0 | 102 passed, 0 failed, 0 skipped (actionlint and zizmor on PATH) |
| `bash infra/tests/ci-workflow.test.sh` | 0 | 417 passed, 0 failed, 0 skipped |
| `bash infra/tests/supply-chain-skeletons.test.sh` (borrowed edit) | 0 | 108 passed, 0 failed, 12 skipped (the filled installers' skeleton checks) |
| `zizmor --offline --min-severity medium .github/workflows/` | 0 | No findings to report (10 ignored, 4 suppressed) |
| `zizmor --offline .github/workflows/release.yml` | 0 | No findings at any severity |
| `actionlint .github/workflows/release.yml .github/workflows/android-release.yml` | 0 | |
| `pnpm format:check` | 0 | All matched files use Prettier code style! |

## 8. Handoff

- **release.yml** (`workflow_dispatch` on `main`, input `version`; top-level `contents: read`; concurrency `release`):
  - build (45 min): the version check (three numbers; a warning per file naming another version); `actions/setup-node` 22.22.1 without cache, `pnpm install --frozen-lockfile`; `scripts/fetch_data.py`, YuNet and the variant groups; six `docker build --platform linux/amd64` with `VERSION`, `REVISION`, `SOURCE_URL` (vision with `--build-context repo=.`; the flow twice, the second `OPENVERIFY_FLOW_FACE_GUIDANCE=off`, tag `<version>-noguidance`); `docker save` to `dist/images/<name>.tar` with `IMAGE-IDS.txt`; cosign then Helm, `helm package ... --version --app-version`; the npm build, then sdk-web-11c's pack tool at the version. Hands over `release-build-images` and `release-build-packages` (1 day).
  - verify (90 min): cosign, then Syft, Grype, Trivy, Helm, kind, kubectl, chart-testing and gitleaks into `$RUNNER_TEMP/bin`; the allowlist turned into `grype.yaml` and `trivy-ignore.rego` (package-scoped; an expired entry or one beyond 90 days fails); fresh databases (Grype's `GRYPE_DB_MAX_ALLOWED_BUILT_AGE=24h`, `GRYPE_DB_VALIDATE_AGE=true`; Trivy's `UpdatedAt` within 24 hours), both build dates in the summary; Trivy and Grype per image (gate critical and high, Grype's JSON kept, medium and low in the summary); Syft SBOMs `dist/sbom/{image-<name>,source-{pnpm,vision,load},npm-openverify-<name>}.cdx.json`; the licence check over each (`<stem>.licences.json`), failing after all; the weights; kind 1.35 then 1.37 through `kind.sh create|load|fixtures|models|install|smoke|upgrade` with `OPENVERIFY_KIND_IMAGE_TAG="$VERSION"`, each `delete` under `if: always()`; every artifact unpacked (image layers included); gitleaks with the repository's rules plus the GPG_KEY-in-archive-blob entry; the forbidden-file search. Hands over `release-verify-reports` (1 day).
  - stage (30 min): files named `openverify-<name>-<version>[-pending-owner].{tar,cdx.json,licences.json,grype.json}` and `npm-openverify-<name>-<version>[...]`, `openverify-<version>.tgz`; `SHA256SUMS`, `RELEASE-NOTES.md` (unsigned, pending-owner items, runtime bases with Debian's source archive); workflow artifacts `openverify-<version>-images` and `openverify-<version>-staged`, 30 days; a notice that nothing was published unless `vars.OPENVERIFY_PUBLISH` is `'true'`.
  - publish (owner-gated: environment `release`, `if: vars.OPENVERIFY_PUBLISH == 'true'`; its own `contents: read`, `id-token`, `packages`, `attestations: write`): refuses any `*-pending-owner*`, pushes each image to `ghcr.io/<owner>/openverify-<name>`, `cosign sign --yes <repo>@<digest>`, `cosign attest --yes --type cyclonedx`, `helm push` to `oci://ghcr.io/<owner>/charts`, `actions/attest-build-provenance` v4.2.2 over `SHA256SUMS` (slsa-github-generator v2.1.0 recorded as the alternative); npm waits for Q4. Never runs in 11C.
- **The licence check**: interface, outcomes and exit codes in section 1; new outcomes this run: `inside-package` (pass, `extra.inside` names the package), `empty-sbom` (fail); Syft's hash-only `type: file` entries are skipped.
- **android-release.yml**: section 2; `ci-workflow.test.sh` 417.
- **Owner items found**: nodemailer 10.1.6 MIT-0 in image:api (pending-owner, Q11). **Failure found**: FFmpeg inside opencv-python-headless in image:vision (the open Phase 3 decision).
- **Estimate** (C267.1): about 35 to 45 minutes a run, unmeasured (rule 27; integration-11c and the orchestrator record the first staged run open, KP10-59).
