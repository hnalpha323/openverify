# Phase 10, Workflow 10E, Stage 4: integration-10e (TDD evidence)

Written by integration-10e on 2026-11-11, alone and last. Base of the work: `6df076024` (nfc-reader's checkpoint). Every command ran in the foreground after `source scripts/env.sh`; every Gradle call under `flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon`; a gate's result is the command's own exit code, sent to a log file and read from there. No lock wait occurred (0 s on every call). No CI run is counted on, and nothing here was pushed, dispatched or re-run.

## 1. The ORT custom-build spike and the base's CI state

- **Spike (C205.5):** `/tmp/openverify-ort-spike/` does not exist; no PID, log or status file. face-onnx recorded "not measured: no Android NDK". Nothing was stopped. The official `onnxruntime-android` 1.31.0 AAR stays.
- **CI:** `gh run list --limit 4 --json ...` (read once): the newest run is 43018061783 on the base `b826da9b5`, conclusion `failure`, the one in which no job started a step (the account's spending limit). No run on a later commit exists. Nothing to fix first.

## 2. Review findings (RED, then GREEN)

### E004 and E005 (openverify-nfc)

RED, `ba1546afd`:

```
./gradlew --no-daemon :openverify-nfc:testDebugUnitTest --tests 'dev.openverify.nfc.ChipReadOrchestratorTest' --tests 'dev.openverify.nfc.NfcChipReaderTest'
NfcChipReaderTest > a screen left while reader mode is being turned on does not keep it on FAILED
ChipReadOrchestratorTest > an EF CardAccess that cannot be parsed offers no PACE to the MRZ key, which is tried with Basic Access Control, and the file is not returned() FAILED
ChipReadOrchestratorTest > an optional file that is empty is read as absent, and the chip is still read with Basic Access Control() FAILED
56 tests completed, 3 failed
```

Two of the five new tests passed at RED by design: they pin what must not change (an optional file longer than the server takes is still refused; an unparsable EF.CardAccess leaves a card access number nothing to open, and a lost chip is still `tag_lost`).

GREEN, `0b03d8b6b` (`ChipReadOrchestrator.kt`, `NfcChipReader.kt`):

```
./gradlew --no-daemon :openverify-nfc:testDebugUnitTest :openverify-nfc:koverVerify :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.privacy.*' --tests 'dev.openverify.sdk.ui.a11y.A11yTimingTest'
BUILD SUCCESSFUL in 1m 21s
```

The module's exception table needed no row: both fixes end through `ChipFailures.raise`.

### E001 (the licence papers in the staged AARs)

RED, `287d4ef85`: `python3 -I -m unittest discover -s scripts/tests` from `android/`: `Ran 94 tests ... FAILED (errors=45)`, each `TypeError: check_repository() takes 4 positional arguments but 5 were given`.

GREEN, `3de1a525d`: `Ran 94 tests in 1.590s OK`, and on the real staged repository:

```
python3 -I scripts/check-staged-repository.py
  licence papers: openverify-nfc carries 6 in classes.jar; openverify-face carries 5 in its assets
check-staged-repository: passed
```

Negative controls are the tests themselves: an AAR without one paper, with a changed paper, without `classes.jar`, and a committed third-party text whose SHA-256 is not the recorded one each give exactly the named problem.

### E003 (the logger scan's silent return)

`ab5058cad`: the early `return` is an `assertTrue(file.isFile, ...)`. No RED run was made: showing it fail needs the reader's `LibraryLoggers.kt` removed or renamed, and no agent moves another owner's file for a demonstration. The test ran green with the file present in every later gate call.

### E002 (a public-domain portrait's detector numbers in git)

Carried to the owner, not fixed: the plan's 10E acceptance asks for a public-domain fixture frame with vectors, and whether such numbers may stay in git is the owner's decision. `2daf68101` makes the fixture tool's comment say which file holds them and that it waits on the owner; `uv run ruff check` and `ruff format --check` on the file passed.

## 3. The Stage 2 blockers

- **`A11yTimingTest`** (failing since nfc-reader's durations): `d2166e8d1` classifies `EXCHANGE_TIMEOUT_MS: Int = 5_000` and the two `withTimeoutOrNull(` and two `5.minutes` of `NfcChipReader.kt`, with their row in `docs/android/accessibility.md`. RED was the Stage 2 state (ui group: 1 of 522 failed, as both builders reported).
- **`test_openverify_face_ships_no_rule_of_its_own_yet`**: replaced by `test_openverify_face_keeps_what_onnx_runtimes_native_library_finds_by_name` (`d90b8132d`); `Ran 89 tests ... OK`.
- **The demo's face lines** said "not built yet". RED `32ffa9448`: `DemoArtifactsTest > no line says a module is still to be built ... FAILED` (5 tests completed, 1 failed). GREEN `cfe1a9ef1`, with KP10-50's paragraph in the demo's README.

## 4. Sizes, 16 KB and the cap (C216)

RED, `db1df97f6`: `Ran 98 tests ... FAILED (failures=2, errors=9)`: `check-size.py` knew two configurations, no `over_cap`, no `CAPS`, and `configuration_problem` took no bundle entries.

Measured with bundletool 1.18.3 over `:demo-app:bundleRelease` of each configuration (download / install bytes; load 4.5 to 10.7 while the builds ran, about 4 while measuring):

| Configuration | arm64-v8a | armeabi-v7a | x86 | x86_64 |
|---|---|---|---|---|
| `sdk` | 3,379,437 / 7,070,770 | 3,291,894 / 6,554,682 | 3,448,225 / 7,193,626 | 3,422,726 / 7,173,158 |
| `sdk,nfc` | 4,904,062 / 10,893,264 | 4,816,519 / 10,377,176 | 4,972,850 / 11,016,120 | 4,947,351 / 10,995,652 |
| `sdk,face` | 16,606,831 / 41,797,462 | 15,267,288 / 31,221,602 | 18,911,915 / 48,441,138 | 18,751,320 / 48,502,596 |
| `sdk,nfc,face` | 18,136,158 / 45,615,860 | 16,796,615 / 35,040,000 | 20,441,242 / 52,259,536 | 20,280,647 / 52,320,994 |

The cold pass's own bundles (section 7) measured within 300 bytes of the download figures and 4,096 bytes of the install figures, inside the 10% bound.

- **Caps** (`CAPS` in `check-size.py`): the largest ABI's figure plus 25%, rounded up to a whole MiB: `sdk` 5 and 9 MiB, `sdk,nfc` 6 and 14, `sdk,face` 23 and 58, `sdk,nfc,face` 25 and 63. Basis: the official AAR's measured sizes (the spike was not measured).
- **Negative controls:** `check-size.py --configuration sdk --bundle <the sdk,nfc bundle>` fails with "the bundle declares the NFC permission"; `--configuration sdk,nfc --bundle <the sdk,nfc,face bundle>` fails with "the bundle holds libonnxruntime.so".
- **16 KB:** `check-elf-alignment.py` over the `sdk,nfc,face` and `sdk,face` builds: "zipalign ... verified (24 libraries listed)", `PAGE_ALIGNMENT_16K`, every `lib/*/libonnxruntime.so` and `libonnxruntime4j_jni.so` "16 KB-aligned"; over `sdk,nfc`: 16 libraries. Static checks only.
- **Dex classes** (counted from the dex headers): release `sdk` 5,596, `sdk,nfc` 9,813, `sdk,face` 5,703, `sdk,nfc,face` 9,921; minifiedSmoke `sdk` 6,015, `sdk,nfc,face` 10,339. `:demo-app:traceSmokeTestKeepRules` traced 153 classes in both (10D: 153), every one outside `dev.openverify.sdk`, the demo's screen and kotlinx.serialization; `:demo-app:checkSmokeTestReferences` passed.

GREEN, `9bb031305` (the script, the baseline, `docs/android/sizes.md` and `SizesPageTest`): `Ran 98 tests ... OK`.

## 5. The workflows (C220, KP10-46)

RED, `fc3f7a6e3`: `bash infra/tests/ci-workflow.test.sh` gave `# 378 passed, 31 failed, 0 skipped` (the YuNet fetch, the floors, the module floors' step, the new device tasks and minimums, the face manifests, the face size configurations). GREEN, `89e01b9d9`: `# 409 passed, 0 failed, 0 skipped` (381 before).

## 6. EIGEN-SOURCE.txt in the flow (Phase 10 P2)

RED, `efdf1e5ba`: `pnpm --filter @openverify/flow exec vitest run src/vite-plugins/guidance-assets-plugin.test.ts --coverage.enabled=false`: `× serves where the source of the Eigen inside the WASM is ...: expected [ …(2) ] to deeply equal [ …(3) ]`, 1 failed, 14 passed. GREEN, `9d0d76030`: 86 of 86 in `src/vite-plugins` and `src/guidance`. The Eigen revision (`1d8b82b0740839c0de7f1242a3585e3390ff5f33`) was read from ONNX Runtime's `cmake/deps.txt` at `v1.30.0` and at `v1.31.0` (the same line in both).

## 7. A defect the clean-build pass found: a golden compared before its photo was drawn

The first cold pass's second step (screenshots beside R8, load 12) failed: `A11yAuditScreenshotTest ... capture-review-operator-dark ... is changed`. The compare image showed the review photo missing: the photo is decoded on `Dispatchers.Default`, which Compose's idle does not wait for. It passed alone and failed under load, so it was made deterministic.

- Stub `9ab4ac4de`: a test-only semantics property `ReviewPhotoDecoded` on the review photo (always false).
- RED `aa477f674`: the audit's stage waits for the property; `:openverify-sdk:screenshotTest ... --tests '...A11yAuditScreenshotTest'`: `java.lang.AssertionError: the photo under review was not decoded and drawn within 20000 ms`.
- GREEN `d6af3cc37`: the property is `bitmap != null`. The first full run then failed on one other golden, `capture-review-ar-dark-2x`: the committed 10D golden had itself been recorded without its photo. It was re-recorded by an explicit record call filtered to `A11yAuditLargeFontScreenshotTest` (one file changed); `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true --rerun` then exited 0 (95 tests), and again inside the cold pass at load 10.

## 8. Validation as run

Every step exit 0 unless said. Seconds are wall time; load is `cat /proc/loadavg` at the start and the end.

| Step | Result | Seconds | Load |
|---|---|---|---|
| 1 install (`--frozen-lockfile`), `pnpm format:check` | 0, 0 | 0, 114 | 0.2 to 1.3 |
| 2 forced typecheck | 0 (17 tasks) | 154 | 1.3 to 5.8 |
| 2 forced lint: api; dashboard + contracts; the other 14 | 0, 0, 0 | 207, 223, 326 | 1.3 to 4.9 |
| 3 fetches (models, data, `person_a_id`, bundletool) | 0 | 1 | 1.4 |
| 4 `build:variant-groups` | 0 | 7 | 1.4 |
| 5 unit: watchlist + e2e + db; dashboard; the other 12; `@openverify/js` | 0, 0, 0, 0 | 386, 444, 187, 5 | 1.4 to 14.3 |
| 5 API, eight blob shards and the merge | merge 0: 9,677 tests in 726 files, 94.41% | 172, 197, 204, 193, 178, 172, 163, 153, merge 37 | 7.0 to 9.6 |
| 6 `benchmark:typecheck`, `benchmark:test` | 0 | 60 | 4.3 |
| 7 integration: db; graph; api 1/3, 2/3, 3/3 | 83; 13; 99, 103, 107 | 138; 54; 120, 220, 101 | 3.4 to 18.5 |
| 8 vision static; pytest files 1 to 58; 59 to 108 | 0; 1,358 passed; 1,281 passed, 97.41% | 2; 204; 396 | 1.2 to 15.7 |
| 9 the Android gate, eleven calls | section 9 | | |
| 9b the clean-build pass | section 10 | | |
| 10 `openapi:write`, `workflow-docs:write`, both `git diff --exit-code` | 0 | 35 | 2.8 to 3.8 |
| 11 mocked flow suite | 332 passed | 188 | 2.8 to 12.5 |
| 11 stack up; chromium shards 1 to 4 | 48, 48, 49, 47 (192) | 159; 330, 452, 373, 393 | 1.9 to 4.3 |
| 11 console sweep; `:openverify-sdk:stackTest`; stack down | 104; 2 of 2 classes; 0 | 321; 195; 3 | 2.2 to 2.9 |
| 11b WebKit `theme-csp` through Docker (`apps/flow` changed) | 7 passed | 22 | 0.8 to 3.9 |
| 12 docker builds: apps; vision; code-runner | 0, 0, 0 | 165, 7, 47 | 2.4 to 3.6 |
| 13 `infra/tests/*.test.sh`, eleven calls | 1,260 checks, 0 failed; `ci-workflow` 409 with 0 skipped | 96 in all | about 2 |
| 14 workflow benchmark (reported, not gated) | 0; control-flow at 32 clients: 180 steps/s | 153 | 2.7 to 2.9 |
| 15 `gitleaks git --redact .` | 6,701 commits, no leaks | 10 | 2.2 |
| 16 the device suites and one demo flow | section 11 | | |

Notes:
- The unit split's third call (the other 12 packages) was sent in one shell call with the dashboard's, passed that call's 10 minutes and was detached by the harness; it ran to its end by itself (exit 0, 187 s) and was waited for before anything else ran. No lock was held.
- Each lone API shard exits 1 on partial coverage, as rule 8 says; the merge's exit code is the gate.
- Shard 2 took 452 s (7.5 minutes) at load 1.9 to 2.8, against 332 s at 10D. Nothing was raised or rebalanced; it is reported for the next measurement.
- `analytics:benchmark --measure` was not run: it needs validation-9d's seed container, and nothing under `apps/api` or `packages/` changed at run time in 10E (one comment, one test file); validation-10d did not run it either.
- The vision split stays after file 58; the new `test_android_yunet_vectors.py` falls in the first part.

## 9. The Android gate (eleven calls, in order, at `8d5558e15`; lock wait 0 s)

| Call | Result | Seconds | Load |
|---|---|---|---|
| (1) host tests `ui`, `flow`, `rest`, each `--rerun` | 522, 416, 1,753 = **2,691**, none skipped | 159, 45, 97 | 1.0 to 3.0 |
| (2) screenshots with comparison | 0 (95 tests, 205 goldens) | 10 (up to date; 56 when executed) | 2.5 |
| (3) `koverVerify checkKotlinAbi` | 0 | 231 | 3.1 to 6.7 |
| (4) `testDebugUnitTest assembleDebug` | demo **97** and **9**; openverify-nfc **116**; openverify-face **51** | 16 | 6.7 |
| (5) release APK, bundle, both AARs | 0 | 21 | 5.9 |
| (6) `:openverify-sdk:assemble` | 0 | 14 | 4.6 |
| (7) `lint` | 0 | 179 | 4.3 |
| (8) device tests compile, with both modules | 0 (`checkSmokeTestReferences` ran) | 184 | 3.0 to 9.8 |
| (9) bundletool fetch; 98 script tests; the three checks | 0; OK; passed, passed, passed | 3 | |
| (10) staged repository; consumer check | 0; 0 (`check-staged-repository: passed`) | 32; 210 | 6.1 to 11.0 |
| (11) `sdk,nfc`, `sdk,face`, `sdk,nfc,face` merged manifests | 0, 0, 0 (97 and 9 each) | 105, 96, 113 | 3.1 to 8.7 |

Coverage: `koverVerify` holds every module at 80% (openverify-nfc 97.9% and openverify-face 97.1% of lines as their builders measured; this stage added tests and no uncovered line).

## 10. The clean-build pass (9b)

After `./gradlew clean` and with `android/build` and `android/consumer-check/build` moved away, from a new empty `GRADLE_USER_HOME` with dependency verification on and a new `--project-cache-dir`.

- **First run (truly cold, with the downloads):** the fetches and the 98 script tests, then the gate line's tasks in order: `testDebugUnitTest` 426 s, `testAndroidHostTest` 442 s, `koverVerify` 53 s, `assembleDebug` 116 s, `:openverify-sdk:assemble` 182 s, `lint` 300 s: **1,519 s (25.3 minutes)**, every call exit 0, load 3.2 to 9.5. No lockfile or verification entry was missing. The second step then failed on the golden of section 7.
- **After the fix,** two further new Gradle homes were refused by Maven Central (`Received status code 429 from server: Too Many Requests`, on `org.robolectric:nativeruntime-dist-compat:1.0.19`), a refusal of the network, not of the code.
- **The run that counts** was therefore made from clean again in the first cold home, which held only what this step's own cold run had downloaded with verification on, with its build cache removed so that every task executed: `testDebugUnitTest` 171 s, `testAndroidHostTest` 298 s, `koverVerify` 36 s, `assembleDebug` 48 s, `:openverify-sdk:assemble` 111 s, `lint` 207 s (871 s); the second step in one call 196 s (exit 0, the screenshots beside R8 at load 10); `check-elf-alignment.py`, `check-consumer-rules.py` (which prints `minifiedSmoke: not built here, not checked`, KP10-51) and `check-size.py` passed; the floors read from the XML: 2,691; 97 and 9; 116 and 51, none skipped; the three merged-manifest calls 80, 75 and 81 s.
- **Then `android-release.yml`'s gate steps that need no device or secret:** the device-test compile with both modules 268 s; the 16 KB checks; the consumer rules with `minifiedSmoke` now read; the `sdk` size; the `sdk,nfc` bundle 186 s and size; the `sdk,face` bundle 152 s and size; the `sdk,nfc,face` APK and bundle 174 s with the 16 KB checks (24 libraries) and size; `publishAllPublicationsToStagingRepository` 71 s; `-p consumer-check build` 171 s; `scripts/scan-staged-repository.sh`: "no secret found in staging-repo". Every one exit 0. The version check needs the dispatch input and the upload a runner; neither ran.
- No step read something no earlier step of its job had built.

## 11. The phone (a Pixel 9, Android 17, wireless adb; one call per task under the device lock)

At `d6af3cc37` (docs-only commits follow), awake, unlocked and on charge (`dumpsys deviceidle`: `mState=ACTIVE`, `mScreenLocked=false`, `mCharging=true`). Gradle ended each connected task as failed (KP10-31); the results are the instrumentation's XML:

```
(cd android && bash ../infra/scripts/check-connected-results.sh . openverify-sdk=14 demo-app=2 openverify-nfc=2 openverify-face=4)
dev.openverify.demo.smoke.MinifiedSmokeTest: 2 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.face.OrtTelemetryDeviceTest: 2 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.face.YunetInferenceDeviceTest: 2 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.nfc.ChipReaderDeviceTest: 2 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.camera.CameraXCaptureCameraTest: 1 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.camera.CameraXFramePipelineTest: 3 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.capture.barcode.ZxingCppBarcodeReaderDeviceTest: 4 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.nfc.NfcPlatformDeviceTest: 2 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.nfc.NfcTapLifecycleDeviceTest: 1 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.signals.IntegrityProbesDeviceTest: 1 tests, 0 failures, 0 errors, 0 skipped
dev.openverify.sdk.ui.CaptureScreenLayoutDeviceTest: 2 tests, 0 failures, 0 errors, 0 skipped
connected tests: 22 passed
```

Connected-task wall times: SDK 53 s, demo 37 s, openverify-nfc 29 s, openverify-face 316 s (load 0.3 to 9.4).

**The telemetry byte count** (`OrtTelemetryDeviceTest.noBytesAreCounted...`, 279.6 s), from the test's own log lines (tag `OpenVerifyFaceTest`):

```
control: 30000 ms, received 0 B, sent 0 B
first process: window 124388 ms, received 0 B, sent 0 B, allowed 0 B
after a restart: window 124365 ms, received 0 B, sent 0 B, allowed 0 B
drawn face: largest raw difference from the vision runtime: 5.6349182129267206E-6
fixture frame: largest differences from the server runtime: pixels=4.2124176025026827E-4 score=3.531718125726613E-7 yaw-ratio=1.7123219414605373E-7
```

That is the measured window on that phone, nothing more.

**One flow of the demo** (about 6 minutes of its 30): the debug build of `sdk,nfc,face` (167.9 MB, four ABIs of ONNX Runtime), installed with `adb install -r`, against the local e2e stack through `adb reverse tcp:<port> tcp:<port>` and `http://127.0.0.1:<port>`. The 10A fixture flow was published and a sandbox inquiry started with the spec's own helpers from a script outside the repository. Driven with `adb shell input` and `uiautomator dump`, our package's nodes only; the token typed from a file and never printed. Walked: the demo's form (its artifacts line read "the NFC module, with its chip reader, and the face module, with its face detector"), "Start verification"; the consent screen under the sandbox banner, "I agree", "Continue"; the database form with the fixture's invented person, the country chosen from its list; "Continue"; "Almost done", "Continue"; "Verification submitted", "Done". The demo showed "Flow completed. Inquiry inq_... is completed." with the events Started, StepShown, Submitted, StepShown, Waiting, Submitted, StepShown, Submitted, StepShown, Ended; `GET /api/v1/inquiries/:id` answered `status: completed`. So the build that installs the reader and the detector factory starts and runs a flow on a real phone. Not walked: a selfie step (it needs a person's face) and an `nfc` step (the 10A flow has none). Afterwards the forward was removed, the demo uninstalled, the token file emptied and the stack stopped; no screenshot and no logcat beyond the lines above was taken.

## 12. Commits

`d2166e8d1`, `d90b8132d`, `ab5058cad`, `ba1546afd`, `0b03d8b6b`, `287d4ef85`, `3de1a525d`, `2daf68101`, `32ffa9448`, `cfe1a9ef1`, `db1df97f6`, `9bb031305`, `e1d35cf5d`, `fc3f7a6e3`, `89e01b9d9`, `efdf1e5ba`, `9d0d76030`, `8d5558e15`, `9ab4ac4de`, `aa477f674`, `d6af3cc37`, `2b74b0e2a`, then this file and the plan's three amendment sections.
