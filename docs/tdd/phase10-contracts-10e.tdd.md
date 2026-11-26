# Phase 10, Workflow 10E, Stage 1a: contracts-10e

TDD evidence for the first agent of Workflow 10E (alone). Base `b826da9b5`, start `0e5a5ec68`; commits `44b3273e8..` on `main`, none pushed. Every command ran in the foreground on the build host, each Gradle call as `flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon ...` (lock wait 0 s throughout: this agent ran alone). No device was used. Output is abbreviated; nothing is edited.

## 1. Owner items and the base (read-only, before any commit)

- Phase 10 P1 granted, P2 granted, P3 declined, P4 pending, P5 declined: `docs/plans/phase-10.plan.md`, "Orchestrator decisions before Workflow 10A", item 2; `docs/PROGRESS.md` :72 and :207. No "Owner decisions after Workflow ..." section exists. They match the launch.
- `git merge-base --is-ancestor` for the base and the start: both 0. `git show b826da9b5:docs/PROGRESS.md` holds `## 2026-11-11: Phase 10, Workflow 10D done (accessibility, review, fixes)`. The plan holds `## Orchestrator decisions before Workflow 10E (2026-11-11)`. `origin/main` contains the base.
- CI, read with `gh run list` and `gh run view 43018061783 --json jobs,conclusion,headSha`: the run on the base has 15 jobs "failure" and 3 "skipped", every one with 0 steps, started and ended within three seconds. No job ran, so there is no first fix. `gh run list --workflow android-release.yml`: `[]`.

## 2. K10A-1 and KP10-41: `FlowState.Finalizing` removed; 180 states; four defects

**RED** (`44b3273e8`), `flow/DeadStatesSourceTest.kt`:

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.DeadStatesSourceTest'
DeadStatesSourceTest > no string and no review row is left for the removed screen() FAILED
DeadStatesSourceTest > no production source names the finalizing state or its screen() FAILED
2 tests completed, 2 failed          (exit 1, 32 s)
```

**GREEN** (`55af81bea`): the state, `FinalizingScreen`, the dispatch line, the outcome and event mappings, the two strings in five languages with their review rows, the three tests and the catalog entry removed; the screen's label is "Loading and processing"; the audit says 180 (and 360, 1,080), the statement 180, 1,080 and "the four defects".

- First run of group `ui` failed once, for a reason the item did not list: `A11yInventoryTest`'s guard that the sealed type was read asked for at least 22 flow states, and there are 21 now. The guard is 21.

```
$ ... :openverify-sdk:testAndroidHostTest -PhostTestGroup=ui      A11yInventoryTest > every flow state and every NFC view has a state in the inventory FAILED; 522 tests completed, 1 failed
$ ... --tests 'dev.openverify.sdk.ui.a11y.A11yInventoryTest'      BUILD SUCCESSFUL (after the guard)
$ ... -PhostTestGroup=flow                                        exit 0 (43 s)
$ ... -PhostTestGroup=rest                                        exit 0 (102 s)
$ ... :openverify-sdk:screenshotTest -Proborazzi.test.verify=true exit 0 (52 s): no golden changed
$ pnpm --filter @openverify/dashboard exec vitest run src/accessibility-statement-records.test.ts --coverage.enabled=false     5 passed
```

- The strings were removed, not kept: nothing reads them, and no string scan needs them.
- Count after this commit alone: ui 522, flow 416, rest 1,738 = 2,676, one under the floor. The tests of sections 4 and 5 bring the stage to 2,690.

## 3. KP10-49

`cac0d64f3`: the header comment of `apps/api/src/services/sandbox-chip.ts` names the generated fixture faces. Comment only; `prettier --check` passed.

## 4. The pins (read-only; inventory 11.4 and 11.5)

- Dates: `curl -D` of each POM on Maven Central or Google Maven, `Last-Modified`; `date +%F` was 2026-11-11.
- Licences: each POM; the source jars of JMRTD, SCUBA and cert-cvc read file by file (157 of 159, 28 + 2, 53 headers); `META-INF/LICENSE.md` in Bouncy Castle's jars; ONNX Runtime's AAR unzipped (manifest, `proguard.txt`, `classes.jar`); `cmake/deps.txt` and the notices at the `v1.31.0` tag.

## 5. The Utopia chip export (C209.3)

**RED** (`c855e5ab9`):

```
$ pnpm --filter @openverify/emrtd exec vitest run src/testing/utopia-chip-export.test.ts --coverage.enabled=false
 × is the committed file            AssertionError: run once with UPDATE_CONTRACT_FIXTURES=1: expected false to be true
 × holds a valid TD3 MRZ ...         expected 'X123456785' to be 'X123456788'
 Tests  2 failed | 4 passed (6)
```

The second failure was my own wrong expectation of a check digit (worked by hand in the test's comment: 345, so 5). The four that passed on the first run are the ones that matter: the BAC derivation gives Doc 9303-11 Appendix D.2's published values, the chip passes Passive Authentication under the Utopia anchor, and every exported Active Authentication response verifies and equals `signActiveAuthentication`.

**GREEN** (`120b74eb9`): `UPDATE_CONTRACT_FIXTURES=1` wrote the file; Prettier; then `Tests  6 passed (6)`. `gitleaks dir` over the fixture and the test: no leaks. `52b6a08dc` fixes two lint errors in the test (a spread over a string; bracket notation).

## 6. The modules, the privacy checks and the demo (KP10-42, KP10-44, KP10-45, KP10-47)

Three commits: `85e555e81` (skeletons with stand-ins and no-op loggers, the dependencies, every lockfile and both verification files), `b6f3fe756` (the tests, RED), `39641838f` (GREEN).

**RED, at the commit `b6f3fe756`** in a fresh scratch worktree (`git worktree add --detach /tmp/ov10e-red b6f3fe756`):

```
$ ./gradlew --no-daemon --continue :openverify-nfc:testDebugUnitTest :openverify-face:testDebugUnitTest -PopenverifyDemoArtifacts=sdk,nfc,face :demo-app:testDebugUnitTest :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.privacy.*' --tests 'dev.openverify.sdk.signals.NeverReadTest'
NfcLogTest > a code is written as one warning in a debuggable host FAILED            (and two more; 11 tests completed, 3 failed)
FaceLogTest > ... FAILED (three)
OrtManifestTest > this module removes the telemetry provider, with a marker that names no selector() FAILED     (11 tests completed, 4 failed)
DemoArtifactComponentsTest > the chip reader is installed exactly when the build includes openverify-nfc FAILED  (and two more)
DemoArtifactsTest > the screen says which optional modules the build holds() FAILED (and one more)
MergedManifestTest > the face configuration adds no permission, provider or component ... FAILED (and three more)   (88 tests completed, 9 failed)
ExceptionCanaryTest > an optional artifact's exception table is exactly what its sources create and throw on() > openverify-nfc FAILED
ExceptionCanaryTest > ... > openverify-face FAILED
LogScanTest > an artifact's logger writes only the code, only in a debuggable host, after checking it is a code() FAILED
NeverReadTest > whether the host is debuggable is read only by the named readers() FAILED     (115 tests completed, 4 failed)
BUILD FAILED in 1m 45s
```

Every module compiled; each failure is the missing behaviour. Before that, at `85e555e81`, the existing case `ExceptionCanaryTest > a module without rows here has no source that could throw` is the item's own RED: the stand-in factory is a source without rows.

**What the first GREEN attempt found** (the plan's design did not work; inventory 11.5):

```
java.lang.RuntimeException: android.content.pm.PackageParser$PackageParserException: .../apk-for-local-test.ap_ (at Binary XML file line #96): <provider> does not include authorities attribute
```

Every Robolectric test of the demo failed with it. The merged manifest held `<provider android:name="ai.onnxruntime.TelemetryInitializer" />` and the permission: the two selector-scoped remove markers had stayed as declarations. Six merges of the demo's release manifest (`-PopenverifyDemoArtifacts=sdk,face :demo-app:processReleaseMainManifest`) settled it: a marker with `tools:selector` stays, from a library or from the app; without a selector it removes, also from a library; and an app that declares the permission itself keeps it. `openverify-face` removes the provider without a selector and leaves the permission to the host; the demo removes it in `src/face/AndroidManifest.xml`. `OrtManifestTest` and `MergedManifestTest` were rewritten to that before the RED commit.

Two more findings while going green:

- `DataAtRestScanTest > no shipped manifest sets backup rules, shared user ids or exported components` read the removal marker as a declared `<provider`; it now leaves a provider's remove marker out, with a test that a declared provider is still read.
- `:openverify-nfc:mergeDebugAndroidTestJavaResource`: `2 files found with path 'META-INF/LICENSE.md'` (Bouncy Castle's two jars). `pickFirsts` in `openverify-nfc`, the demo and the consumer check.

**GREEN** (`39641838f`), in the main tree:

```
$ ./gradlew --no-daemon --continue :openverify-nfc:testDebugUnitTest :openverify-face:testDebugUnitTest :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.privacy.*' --tests 'dev.openverify.sdk.signals.NeverReadTest'     exit 0
$ for each of sdk  sdk,nfc  sdk,face  sdk,nfc,face:  ./gradlew --no-daemon -PopenverifyDemoArtifacts=<c> :demo-app:testDebugUnitTest      exit 0 (66, 64, 38, 40 s)
```

- The two new allowlists were written by `UPDATE_MANIFEST_ALLOWLIST=1 ... --tests 'dev.openverify.demo.MergedManifestTest'` in each new configuration. `diff sdk.json sdk-face.json` and `diff sdk-nfc.json sdk-nfc-face.json`: the `configuration` line only.
- The hooks' RED was also seen on its own, with the two hooks returning `null` and the old `description`: `DemoArtifactComponentsTest` 3 failed, `DemoArtifactsTest` 2 failed (8 tests completed, 5 failed).

**The ABI dumps.** `checkKotlinAbi` before `updateKotlinAbi` failed on both modules ("API check failed for project openverify-face ... +public final class dev/openverify/face/OpenVerifyFace"); `:openverify-nfc:updateKotlinAbi :openverify-face:updateKotlinAbi` in its own call; `checkKotlinAbi` exit 0. The SDK's dumps are unchanged.

**The boundary probe** (a scratch tree; `:openverify-sdk`'s `androidMain` given both modules and five libraries; `:openverify-sdk:checkDependencyBoundary --write-locks`):

```
> C214.6: :openverify-sdk must not depend on an optional artifact or a library reserved for one:
  androidRuntimeClasspath: com.microsoft.onnxruntime:onnxruntime-android:1.31.0
  androidRuntimeClasspath: net.sf.scuba:scuba-sc-android:0.0.27
  androidRuntimeClasspath: net.sf.scuba:scuba-smartcards:0.0.21
  androidRuntimeClasspath: org.bouncycastle:bcprov-jdk15on:1.68
  androidRuntimeClasspath: org.bouncycastle:bcprov-jdk18on:1.86
  androidRuntimeClasspath: org.bouncycastle:bcutil-jdk18on:1.86
  androidRuntimeClasspath: org.ejbca.cvc:cert-cvc:1.4.13
  androidRuntimeClasspath: org.jmrtd:jmrtd:0.8.9
  androidRuntimeClasspath: project ':openverify-face'
  androidRuntimeClasspath: project ':openverify-nfc'
```

The check needed no extension. The probe's edits were made and undone in the scratch tree only.

**The release checks** (`android/scripts/`, in `85e555e81` with their tests): the new tests failed first (`Ran 88 tests ... FAILED (failures=26, errors=3)`: the synthetic repository now stages `openverify-face`, which `MODULES` did not know, and `check.LIBRARIES` did not exist), then passed. The rule that each optional artifact's POM names only its reserved libraries came from a real failure in the cold pass, not from a test written first:

```
> Task :checkStagedRepository FAILED
FAIL: openverify-face: the POM depends on com.microsoft.onnxruntime:onnxruntime-android, which the Apache-2.0 SDK never does (C191.2)
```

Its test and `RESERVED_FOR` followed; `Ran 89 tests ... OK`.

**The workflows** (`18ba7fbb4` RED, `405f9c04a` GREEN): `bash infra/tests/ci-workflow.test.sh` gave `# 379 passed, 2 failed, 0 skipped` with the two new checks, then `# 381 passed, 0 failed, 0 skipped` once both workflows build `:openverify-face:assembleRelease`.

## 7. Lockfiles and verification metadata from a cold Gradle home (KP10-44)

In a scratch worktree (`git worktree add --detach /tmp/ov10e-wt HEAD`, the working tree's changes copied over it; removed afterwards with `git worktree remove --force` and `git worktree prune`). The two verification files and the consumer check's lockfiles were first restored to HEAD's, so everything new was written cold.

**Write, `GRADLE_USER_HOME=/tmp/ov10e-gh1` (new, empty), every call exit 0:**

| Call (each with `--write-verification-metadata sha256`) | Time | Load |
|---|---|---|
| `resolveAndLockAll --write-locks` | 158 s | 2.9 |
| `:demo-app:resolveAndLockAll --write-locks -PopenverifyDemoArtifacts=` `sdk,nfc`, `sdk,face`, `sdk,nfc,face` | 18 s each | |
| `--continue testDebugUnitTest` | 159 s | 4.5 |
| `--continue testAndroidHostTest koverVerify` | 262 s | 3.5 |
| `--continue assembleDebug :openverify-sdk:assemble checkKotlinAbi` | 185 s | 5.2 |
| `--continue lint` | 179 s | 5.2 |
| `--continue :openverify-sdk:screenshotTest -Proborazzi.test.verify=true :demo-app:bundleRelease :demo-app:assembleRelease :openverify-nfc:assembleRelease :openverify-face:assembleRelease` | 188 s | 8.7 |
| `--continue :openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest :openverify-nfc:assembleDebugAndroidTest :openverify-face:assembleDebugAndroidTest` | 216 s | 9.1 |
| `--continue publishAllPublicationsToStagingRepository checkDependencyBoundary` | 60 s | 6.7 |
| `-PopenverifyDemoArtifacts=<c> :demo-app:testDebugUnitTest :demo-app:bundleRelease :demo-app:assembleDebug`, for the three configurations | 155, 162, 156 s | 10 to 11 |
| `-p consumer-check build --write-locks --write-verification-metadata sha256`, then `python3 -I scripts/trust-staged-group.py` ("trusts dev.openverify; 0 component(s) of it removed, 452 kept"), then `-p consumer-check build --write-locks` | 129 s, 18 s | |

**Verify, `GRADLE_USER_HOME=/tmp/ov10e-gh2` (new, empty), build directories removed, verification on, no write flag: the gate's calls, every one exit 0:**

| Gate call | Time | Load |
|---|---|---|
| (1) `-PhostTestGroup=ui`, `flow`, `rest` | 142, 53, 95 s | 3.1, 3.3, 2.1 |
| (2) screenshots | 59 s | 2.8 |
| (3) `koverVerify checkKotlinAbi` | 180 s | 3.6 |
| (4) `testDebugUnitTest assembleDebug` | 136 s | 7.7 |
| (5) the release APK, bundle and both optional AARs | 162 s | 11.0 |
| (6) `:openverify-sdk:assemble` | 69 s | 8.3 |
| (7) `lint` | 177 s | 5.1 |
| (8) the device-test compile, with both modules' | 219 s | 12.8 |
| (9) 89 script tests, then the three checks | exit 0 each | |
| (10) the staged repository; the consumer check | 64 s; 143 s | 5.6; 8.9 |
| (11) `sdk,nfc`, `sdk,face`, `sdk,nfc,face` | 65, 67, 63 s | 4.3 to 2.8 |
| `-PopenverifyDemoArtifacts=sdk,nfc,face :demo-app:bundleRelease` | 145 s | |

- Two things went wrong and were not the build's: the first call of the verify pass met Maven Central's rate limit after the write pass had downloaded everything once ("Received status code 429 from server: Too Many Requests", for `nativeruntime-dist-compat-1.0.19.jar`), and passed a few minutes later unchanged; and call (3) hit a 200 s limit I had set myself and passed with room (180 s).
- Result, copied into the main tree: `android/gradle/verification-metadata.xml` +233 lines (34 components, none removed), the consumer check's +66 lines (9 components) and +7 lock lines, `openverify-nfc/gradle.lockfile`, `openverify-face/gradle.lockfile` and the demo's three new lockfiles. `demo-app/gradle.lockfile`, the SDK's and the settings lockfiles did not change.
- The coordinates the lockfiles gained are the nine of inventory 11.4 and, on `openverify-face`'s unit-test classpath only, Bouncy Castle 1.85 through AGP's manifest merger.

## 8. Final gate, in the main tree, at `39641838f` and after (every call exit 0, lock wait 0 s)

| Call | Time | Load | Result |
|---|---|---|---|
| (1) ui, flow, rest, each with `--rerun` | 145, 42, 99 s | 3.6, 3.5, 2.4 | 522 + 416 + 1,752 = **2,690**, none skipped |
| (2) | 63 s | 2.5 | 95 screenshot tests |
| (3) | 198 s | 3.0 | Kover on the SDK and both modules; three ABI checks |
| (4) | 66 s | 4.0 | demo 88 and 8; `openverify-nfc` 11; `openverify-face` 11 |
| (5) with `:openverify-face:assembleRelease` | 157 s | 8.8 | |
| (6) | 49 s | 5.8 | the boundary check, the iOS klibs |
| (7) | 56 s | 5.5 | |
| (8) with both modules' `assembleDebugAndroidTest` | 53 s | 4.8 | `checkSmokeTestReferences` ran |
| (9) | | 5.4 | 89 tests; three AARs ship their committed rules; 16 KB; size inside the baseline |
| (10) | 25 s; 171 s | 5.5; 8.7 | "resolved to ...openverify-sdk-android, openverify-nfc, openverify-face ...; 121 modules in all, none for iOS" |
| (11) `sdk,nfc`, then `sdk,face`, `sdk,nfc,face` | 60, 62, 60 s | 4.1 to 3.2 | 88 tests each |

Calls (4), (6), (7) and (8) found part of their work up to date from this session's earlier calls; their full times are the cold pass's, in section 7.

Also: `pnpm format:check` exit 0 (106 s); `pnpm --filter @openverify/emrtd exec vitest run src/testing --coverage.enabled=false` 80 passed in 6 files; `pnpm --filter @openverify/emrtd test` 338 passed in 20 files, 94.99% lines; its `lint` and `typecheck` exit 0; `bash infra/tests/ci-workflow.test.sh` 381 passed, 0 failed, 0 skipped.

**Not run by this agent:** the whole-repo forced lint, typecheck and unit suites, `pnpm test:integration`, the vision suite and the e2e gate. Outside `android/`, this Stage changed one test file and one fixture of `@openverify/emrtd` (its own gates above), one comment in `apps/api`, two lines of the workflows with their contract, and Markdown. integration-10e runs the full Validation.

## 9. Kover exclusions

None yet. Each optional module has one empty file for its builder's single pattern: `android/openverify-nfc/kover-excludes/nfc-reader.txt` (the JMRTD adapter) and `android/openverify-face/kover-excludes/face-onnx.txt` (the ONNX Runtime session glue).

## 10. Checkpoints

| Part | Commit |
|---|---|
| K10A-1 and KP10-41 | `55af81bea` |
| KP10-49 | `cac0d64f3` |
| The chip export (P1) | `120b74eb9` (lint: `52b6a08dc`) |
| Common, P1 and P2: skeletons, dependencies, locks (KP10-44, KP10-47) | `85e555e81` |
| Common, P1 and P2: tests, then GREEN (KP10-42, KP10-45) | `b6f3fe756`, `39641838f` |
| Module docs | `b5601f16c` |
| The workflows build the new AAR | `405f9c04a` |
| Records (this file, the inventory, the plan's amendments) | the commit "Workflow 10E contracts-10e checkpoint 1" |
