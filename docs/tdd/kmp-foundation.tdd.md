# TDD evidence: KMP migration Stage 1, kmp-foundation

- **Slice owner:** `kmp-foundation` (KMP migration Workflow, Stage 1 of 4, alone in `android/`).
- **Date:** 2026-10-22.
- **Plan:** `docs/plans/kmp-migration.plan.md`: K6 (build configuration), the K7 baseline, the S1 moves and edits of K2, and K8 (CI).
- **Paths owned:** the `android/` Gradle files and version catalog, every `git mv` under `android/openverify-sdk/src/**`, the S1 edits (`CaptureCamera.kt`, `CameraFacts.kt`, `FlowApiException.kt`) with the platform seams they need, `.github/workflows/ci.yml`, `infra/tests/ci-workflow.test.sh` and this file.
- **Owner's request behind the plan:** "we might need an iOS app later so make it in a language that we can easily port to iOS alongside Android".

**How the commands ran.** Every Gradle command ran in the foreground from `android/`, after `source scripts/env.sh` (Temurin 21, Gradle 9.8.2 from the wrapper). Counted runs use `--rerun-tasks`. Output is trimmed to the lines that matter. The raw JUnit and Kover XML stays in the session scratchpad, outside git.

## 0. Baseline (K7), before any change

Taken at `4be9b6b` with a clean `android/` tree.

```text
$ ./gradlew --rerun-tasks testDebugUnitTest koverVerify koverXmlReport
BUILD SUCCESSFUL in 1m 37s
83 actionable tasks: 83 executed
```

**Counts.** The SDK has 631 tests in 31 host test classes, and none were skipped, failed or errored. The demo has 18 tests in 3 classes (`DemoFormTest` 10, `DemoViewModelTest` 6, `MainActivityTest` 2). The plan's figure of "616 tests in 32 classes" predates Workflow 4B, which added 15 Android tests (`docs/PROGRESS.md` already records 631). Its 32nd class is the device test `CameraXCaptureCameraTest` (1 test, `src/androidTest`), which only runs on an emulator in CI.

| Class (under `dev.openverify.sdk`) | Tests |
|---|---|
| `InquiryResultsTest` | 24 |
| `InquiryViewModelTest` | 16 |
| `OpenVerifyInquiryActivityTest` | 10 |
| `OpenVerifyInquiryContractTest` | 11 |
| `OpenVerifyInquiryOneTimeLinkTest` | 16 |
| `OpenVerifyInquiryRequestTest` | 8 |
| `api.FlowApiClientTest` | 75 |
| `api.OneTimeLinkClientTest` | 6 |
| `api.OneTimeLinkFlowApiTest` | 5 |
| `camera.CameraFactsTest` | 16 |
| `camera.CaptureCameraTest` | 8 |
| `camera.CapturedImageTest` | 7 |
| `camera.ImageEncodingTest` | 6 |
| `camera.PickedPhotosTest` | 12 |
| `flow.FlowCoordinatorTest` | 114 |
| `flow.FlowNavigatorTest` | 9 |
| `flow.JsonLogicTest` | 36 |
| `flow.SelfieCaptureProtocolTest` | 3 |
| `model.ContractFixturesTest` | 37 |
| `model.SelfieCaptureModelTest` | 19 |
| `model.WireModelTest` | 23 |
| `mrz.BacKeySeedTest` | 13 |
| `mrz.MrzTest` | 17 |
| `mrz.MrzVectorsTest` | 44 |
| `ui.CameraPermissionGateTest` | 6 |
| `ui.CaptureScreenTest` | 24 |
| `ui.ConsentScreenTest` | 10 |
| `ui.InquiryFlowScreenTest` | 16 |
| `ui.MessagesTest` | 19 |
| `ui.SpanishMessagesTest` | 4 |
| `ui.StatusScreensTest` | 17 |
| **Total** | **631** |

**Kover** (`openverify-sdk/build/reports/kover/report.xml`, line coverage, with the exclusions of `openverify-sdk/build.gradle.kts`):

| Package (under `dev.openverify.sdk`) | Lines covered | Coverage |
|---|---|---|
| root | 161 / 163 | 98.77% |
| `api` | 239 / 243 | 98.35% |
| `camera` | 90 / 93 | 96.77% |
| `flow` | 433 / 438 | 98.86% |
| `model` | 472 / 478 | 98.74% |
| `mrz` | 17 / 17 | 100.00% |
| `ui` | 156 / 172 | 90.70% |
| **Total** | **1568 / 1604** | **97.76%** |

**The baseline list** is the appendix at the end of this file, which also explains its format. Its SHA-256, over the lines joined with `\n` and a final `\n`:

```text
SHA-256 9b4c22f495dfab8c38e5106193e473d03a710b17d41164c694f0dae842d9a8b6
```

The appendix's block, taken verbatim, hashes to that value. A later stage passes the gate when every line of it appears in its own host results at least as many times as there, and every baseline class keeps its count. This recipe, run from `android/`, prints the count and hash of a results directory and compares it with the block:

```bash
python3 -I - openverify-sdk/build/test-results/testAndroidHostTest ../docs/tdd/kmp-foundation.tdd.md <<'PY'
import collections, glob, hashlib, re, sys, xml.etree.ElementTree as ET
cases = sorted(f"{c.get('classname')}#{c.get('name')}"
               for p in glob.glob(sys.argv[1] + "/*.xml") for c in ET.parse(p).getroot().iter("testcase"))
print(len(cases), hashlib.sha256("".join(c + "\n" for c in cases).encode()).hexdigest())
doc = open(sys.argv[2], encoding="utf-8").read()
base = re.search(r"<!-- baseline-list -->\n```text\n(.*?)```", doc, re.S).group(1).splitlines()
missing = collections.Counter(base) - collections.Counter(cases)
print("baseline lines missing:", sum(missing.values()), list(missing)[:10])
PY
```

## 1. K8: the CI contract (RED `72db9b3`, GREEN `56536b9`)

`infra/tests/ci-workflow.test.sh` gained 17 checks. Besides reading `ci.yml`, three of them run the steps' own scripts in throwaway temp directories. The Kotlin version step runs in `android/`, and its output must equal the catalog's `kotlin`, read with `tomllib`. The floor step runs on synthetic, Gradle-shaped JUnit XML: 631 passing tests pass, 706 pass, 630 fail, one skipped fails, one failed fails, and no results fail. The detection step runs on synthetic trees: `src/androidDeviceTest` and `src/androidTest` give `present=true`, and `src/androidHostTest` alone gives `false`.

**RED**, against the old `ci.yml`:

```text
$ bash infra/tests/ci-workflow.test.sh
FAIL - android: runs ./gradlew testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint (KMP host tests, the iOS klibs, lint)
FAIL - android: caches the Kotlin/Native toolchain (~/.konan) with actions/cache
FAIL - android: the konan cache is restored before the Gradle run
FAIL - android: the konan cache key names an earlier step's output
FAIL - android: the konan cache key is the catalog's Kotlin version (2.4.21) ({})
FAIL - android: one step checks the SDK host test results (the test-count floor)
FAIL - android: the test-count floor runs after the Gradle step
FAIL - android: the test-count floor runs in bash with pipefail
FAIL - android: the test-count floor passes with the K7 baseline of 631 host tests, none skipped (exit None: no floor step)
  ... the five other floor scenarios fail the same way
FAIL - android-instrumented: reactivecircus/android-emulator-runner runs :openverify-sdk:connectedAndroidDeviceTest
FAIL - android-instrumented: no longer runs connectedDebugAndroidTest, which the KMP SDK does not have
FAIL - android-instrumented: the detection says present=true for a KMP device test (src/androidDeviceTest) (exit 0, outputs {'present': 'false'}: ...)
# 132 passed, 17 failed, 0 skipped
```

**GREEN**, committed after the build moved (section 2), so the commands CI runs exist at every commit:

- **The `android` job.** A step reads the Kotlin version from the catalog. `actions/cache` (the pinned v6.1.0) restores `~/.konan` under `konan-<os>-<kotlin>`. The Gradle step runs the K8 command. A `shell: bash` step then fails under 631 SDK host tests, or on any skipped or failed one, with an `::error` annotation.
- **`android-instrumented`.** The detection also matches `*/src/androidDeviceTest/*`, and the emulator runs `./gradlew :openverify-sdk:connectedAndroidDeviceTest`. The failure print and `check-connected-results.sh` already match `androidTest-results/connected/androidMain`.

```text
$ bash infra/tests/ci-workflow.test.sh
ok   - actionlint 1.7.12 reports no problems
# 149 passed, 0 failed, 0 skipped
$ pnpm exec prettier --check .github/workflows/ci.yml
All matched files use Prettier code style!
```

Run on the real results of the final gate, the floor step's own script prints `SDK host tests: 649 in 35 classes, 0 skipped, 0 failed; the floor is 631`.

## 2. K6: the KMP build, with the code parked (`e8c6b62`)

GREEN here is the build. One commit changes the four Gradle files and moves the sources with `git mv` (81 renames, all 100% similar):

- `src/main` to `src/androidMain` (the code, the manifest and `res`);
- `src/test` to `src/androidHostTest`;
- `src/androidTest` to `src/androidDeviceTest`.

The SDK applies `org.jetbrains.kotlin.multiplatform` (by id), `com.android.kotlin.multiplatform.library`, `kotlin.compose`, `org.jetbrains.compose`, `kotlin.serialization`, Kover and `com.android.lint`, with the K6 targets, dependencies, `compose.resources`, test wiring and Kover filters.

```text
$ ./gradlew --rerun-tasks testDebugUnitTest testAndroidHostTest koverVerify koverXmlReport assembleDebug :openverify-sdk:assemble lint
BUILD SUCCESSFUL in 2m 15s
186 actionable tasks: 186 executed
```

- **Tests.** The same 631 lines, byte for byte (SHA-256 `9b4c22f4…`), with identical per-class counts. The demo has 18 tests, and none is skipped.
- **Kover.** Identical in every package: 97.76%, 1568 of 1604 lines.
- **Android dependencies.** The new `androidRuntimeClasspath` was compared with the old `releaseRuntimeClasspath`, using a copy of the old tree from `git archive 4be9b6b`. Every artifact keeps its version (Compose 1.11.4, material3 1.4.0, lifecycle 2.9.4, OkHttp 5.4.0, CameraX 1.6.2), except `androidx.savedstate`, which moves from 1.3.2 to 1.4.0 because CMP 1.11.1 requires it. Nothing is removed. The additions are Ktor 3.5.2, kotlinx-io 0.9.1, kotlinx-coroutines-slf4j 1.11.0, the SLF4J API 2.0.18, and the CMP and JetBrains lifecycle and savedstate artifacts, which resolve to androidx on Android. The host tests resolve `kotlin-test-junit5`.
- **Public API.** `javap -public` of every class in the AAR is identical once two expected differences are normalised. Kotlin `internal` members are now mangled with the KMP module name (`$openverify_android_openverify_sdk` instead of `$openverify_sdk`). The generated `Res` classes, which are Kotlin `internal`, appear.
- **Lint** passes. Its new warnings are the newer-version notices for the new pins, and `UnusedQuantity` on the Spanish `many` of `openverify_selfie_time_limit` (the Workflow 4B plural).
- **Device test.** `./gradlew :openverify-sdk:assembleAndroidDeviceTest` builds `openverify-sdk-androidTest.apk`.

## 3. The S1 moves (`673947e`, `4d3a105`, `588f765`)

Each file was first made portable in place with the suite green. A later commit holding only `git mv` renames then moved it:

- **`673947e`.** `FlowApiException.kt` imports `kotlinx.io.IOException`. `javap` still shows `FlowApiException$Network(java.io.IOException)`, and the 631 tests pass.
- **`4d3a105`** (12 renames). `model/*`, `mrz/*`, `InquiryResult.kt`, `api/FlowApi.kt`, `api/FlowApiException.kt`, `camera/CameraLens.kt` and `camera/CapturedImage.kt`.
- **`588f765`** (7 renames). `flow/*`, `camera/CameraFacts.kt` and `camera/CaptureCamera.kt`, once section 4 had made them portable.

```text
$ ./gradlew :openverify-sdk:compileCommonMainKotlinMetadata :openverify-sdk:compileKotlinIosArm64 :openverify-sdk:compileKotlinIosSimulatorArm64 \
    :openverify-sdk:compileTestKotlinIosArm64 :openverify-sdk:compileTestKotlinIosSimulatorArm64 :openverify-sdk:testAndroidHostTest
> Task :openverify-sdk:testAndroidHostTest UP-TO-DATE
BUILD SUCCESSFUL in 9s
```

After each move, `testAndroidHostTest` was UP-TO-DATE. Moving a file between source sets left every class file byte-identical, so Gradle saw the same test inputs. The counted run is the final gate.

## 4. The S1 edits: the common seams

**Stub** (`d585964`). Nothing used these yet, and the suite stayed at 631 green:

- `LensFacing` in `CameraFacts.kt`, with placeholder codes (`Int.MIN_VALUE`);
- `expect fun isOutOfMemory` in `commonMain/camera/CapturePlatform.kt`, with Android and iOS actuals that return `false`;
- `cleanDeviceLabel` in `commonMain/camera/DeviceLabel.kt`, with the control range spelled out and a plain `take(200)`.

**RED** (`fe7f4e5`). `LensFacingTest` runs on the host and compares the codes with `CameraSelector`. `commonTest` holds `DeviceLabelTest` and `CapturePlatformTest`, plus an `expect fun outOfMemoryError()` with actuals in `androidHostTest` and `iosTest`, because common Kotlin cannot name the type. The two label messages are abbreviated; the strings they print are 200 characters long.

```text
$ ./gradlew --continue :openverify-sdk:compileTestKotlinIosArm64 :openverify-sdk:compileTestKotlinIosSimulatorArm64 :openverify-sdk:compileAndroidDeviceTest \
    :openverify-sdk:testAndroidHostTest --tests '*.LensFacingTest' --tests '*.DeviceLabelTest' --tests '*.CapturePlatformTest'
> Task :openverify-sdk:compileAndroidDeviceTest
> Task :openverify-sdk:compileTestKotlinIosSimulatorArm64
> Task :openverify-sdk:compileTestKotlinIosArm64
13 tests completed, 7 failed
x LensFacingTest UNKNOWN   UNKNOWN ==> expected: <-1> but was: <-2147483648>
x LensFacingTest FRONT     FRONT ==> expected: <0> but was: <-2147483648>
x LensFacingTest BACK      BACK ==> expected: <1> but was: <-2147483648>
x LensFacingTest EXTERNAL  EXTERNAL ==> expected: <2> but was: <-2147483648>
x DeviceLabelTest keepsAtMost200CodePointsCountingASurrogatePairAsOne()  expected 200 × U+1F4F7 but was 100 × U+1F4F7
x DeviceLabelTest neverSplitsASurrogatePairAtTheLimit()  expected 199 × "x" + U+1F4F7 but was 199 × "x" + a lone high surrogate
x CapturePlatformTest recognisesThePlatformsOutOfMemoryError()  Expected value to be true.
```

The other five `DeviceLabelTest` cases already pass on the stub, because they pin the regex the stub has. They cover unpaired surrogates, counting after the removal, every C0 and C1 control, the bidi controls, and the characters next to the removed ranges. The iOS test klibs compile, which shows Kotlin/Native has `OutOfMemoryError(String)`.

**GREEN** (`1ee9b5a`). After it, 644 tests pass and the iOS klibs compile:

- `LensFacing` holds CameraX's codes: `UNKNOWN = -1`, `FRONT = 0`, `BACK = 1`, `EXTERNAL = 2`.
- `cleanDeviceLabel` walks code points in a loop. A surrogate pair counts as one, and so does an unpaired surrogate, as `codePointCount` and the server's `Array.from` count them.
- `isOutOfMemory` is `error is OutOfMemoryError` on Android, and on iOS too (Kotlin/Native's `kotlin.OutOfMemoryError`).

**Refactor** (`439595d`, in place; moved in `588f765`). `CameraFactsTest` (16 tests) and `CaptureCameraTest` (8) were the safety net, unchanged and green.

- `CameraFacts.kt` no longer uses CameraX: it uses the `LensFacing` codes. It no longer calls `codePointCount`: it calls `cleanDeviceLabel`. It no longer reads `ImageEncoding`: it reads a new `expect val CAPTURE_MIRRORS_IMAGES`, which is `ImageEncoding.MIRRORS_IMAGES` on Android and `false` on iOS, where the Phase 10 capture is to keep the photo unmirrored.
- `takePictureOrNull` catches `Throwable`. It rethrows a cancellation, returns `null` for an `Exception` or an `isOutOfMemory` error, and rethrows anything else.

**Guards** (`f5d2ca7`). `TakePictureOrNullTest` in `commonTest` checks that a photo passes through, that an exception and an out-of-memory error become `null`, and that cancellation and any other error propagate. No test covered "any other error" before, and catching `Throwable` is the change that could have broken it. These tests pin existing behaviour, so the RED was three temporary mutants of `CaptureCamera.kt`, never committed. The file was copied to the scratchpad and back, and `git diff` was empty afterwards:

```text
mutant 'else -> throw e' -> 'else -> null'
  TakePictureOrNullTest > letsAnyOtherErrorPropagate() FAILED              13 tests completed, 1 failed
mutant 'e is CancellationException -> throw e' -> 'e is CancellationException -> null'
  TakePictureOrNullTest > letsCancellationPropagate() FAILED
  CaptureCameraTest > cancellation is not swallowed() FAILED               13 tests completed, 2 failed
mutant 'e is Exception || isOutOfMemory(e) -> null' -> 'e is Exception -> null'
  Gradle Test Executor 14 FAILED
  Caused by: java.lang.OutOfMemoryError at OutOfMemoryErrors.android.kt:3 (a frame too large for the heap)
```

JUnit Platform rethrows an `OutOfMemoryError` as unrecoverable, so the error that escaped ended the test executor.

## 5. A fresh CI runner's Kotlin/Native download

`settings.gradle.kts` sets `FAIL_ON_PROJECT_REPOS`, which the spike did not, and CI starts without `~/.konan`. The check ran with an empty `-Pkonan.data.dir` in the scratchpad:

```text
$ ./gradlew --rerun-tasks :openverify-sdk:compileKotlinIosArm64 :openverify-sdk:compileTestKotlinIosSimulatorArm64 -Pkonan.data.dir=<an empty directory>
> Task :openverify-sdk:downloadKotlinNativeDistribution
BUILD SUCCESSFUL in 25s
(822 MB unpacked: kotlin-native-prebuilt-linux-x86_64-2.4.21)
```

The distribution resolves through the settings repositories, so CI needs no Gradle change, and the `~/.konan` cache then saves the unpacking. The archive itself was already in this machine's Gradle cache.

## Final gate

At `f5d2ca7`:

```text
$ (cd android && ./gradlew --rerun-tasks testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 1m 21s
188 actionable tasks: 188 executed
$ (cd android && ./gradlew :openverify-sdk:koverXmlReport)     # that run's report, for the table below
$ bash infra/tests/ci-workflow.test.sh
# 149 passed, 0 failed, 0 skipped
```

`assemble` ran `compileCommonMainKotlinMetadata`, `compileIosMainKotlinMetadata`, `compileKotlinIosArm64`, `compileKotlinIosSimulatorArm64`, `compileTestKotlinIosArm64`, `compileTestKotlinIosSimulatorArm64` and the `check*ComposeLibrariesCompatibility` tasks. The only Kotlin warnings are 11 `KLIB loader: The same 'unique_name=...' found in more than one library` notices, for artifacts that CMP and androidx both publish; the spike printed them too.

**Tests.** There are 649 SDK host tests in 35 classes and 18 demo tests in 3 classes, and none was skipped, failed or errored. Every one of the 631 baseline lines is present (multiset containment, 0 missing), and each of the 31 baseline classes keeps its count:

| Class (under `dev.openverify.sdk`) | Baseline | Final |
|---|---|---|
| `InquiryResultsTest` | 24 | 24 |
| `InquiryViewModelTest` | 16 | 16 |
| `OpenVerifyInquiryActivityTest` | 10 | 10 |
| `OpenVerifyInquiryContractTest` | 11 | 11 |
| `OpenVerifyInquiryOneTimeLinkTest` | 16 | 16 |
| `OpenVerifyInquiryRequestTest` | 8 | 8 |
| `api.FlowApiClientTest` | 75 | 75 |
| `api.OneTimeLinkClientTest` | 6 | 6 |
| `api.OneTimeLinkFlowApiTest` | 5 | 5 |
| `camera.CameraFactsTest` | 16 | 16 |
| `camera.CaptureCameraTest` | 8 | 8 |
| `camera.CapturePlatformTest` (new, `commonTest`) | – | 2 |
| `camera.CapturedImageTest` | 7 | 7 |
| `camera.DeviceLabelTest` (new, `commonTest`) | – | 7 |
| `camera.ImageEncodingTest` | 6 | 6 |
| `camera.LensFacingTest` (new, `androidHostTest`) | – | 4 |
| `camera.PickedPhotosTest` | 12 | 12 |
| `camera.TakePictureOrNullTest` (new, `commonTest`) | – | 5 |
| `flow.FlowCoordinatorTest` | 114 | 114 |
| `flow.FlowNavigatorTest` | 9 | 9 |
| `flow.JsonLogicTest` | 36 | 36 |
| `flow.SelfieCaptureProtocolTest` | 3 | 3 |
| `model.ContractFixturesTest` | 37 | 37 |
| `model.SelfieCaptureModelTest` | 19 | 19 |
| `model.WireModelTest` | 23 | 23 |
| `mrz.BacKeySeedTest` | 13 | 13 |
| `mrz.MrzTest` | 17 | 17 |
| `mrz.MrzVectorsTest` | 44 | 44 |
| `ui.CameraPermissionGateTest` | 6 | 6 |
| `ui.CaptureScreenTest` | 24 | 24 |
| `ui.ConsentScreenTest` | 10 | 10 |
| `ui.InquiryFlowScreenTest` | 16 | 16 |
| `ui.MessagesTest` | 19 | 19 |
| `ui.SpanishMessagesTest` | 4 | 4 |
| `ui.StatusScreensTest` | 17 | 17 |
| **Total** | **631** | **649** |

**Kover** measures line coverage with the same rule and exclusions as before, plus `dev.openverify.sdk.generated.resources.*`:

| Package (under `dev.openverify.sdk`) | Baseline | Final |
|---|---|---|
| root | 98.77% (161 / 163) | 98.77% (161 / 163) |
| `api` | 98.35% (239 / 243) | 98.35% (239 / 243) |
| `camera` | 96.77% (90 / 93) | 97.06% (99 / 102) |
| `flow` | 98.86% (433 / 438) | 98.86% (433 / 438) |
| `model` | 98.74% (472 / 478) | 98.74% (472 / 478) |
| `mrz` | 100.00% (17 / 17) | 100.00% (17 / 17) |
| `ui` | 90.70% (156 / 172) | 90.70% (156 / 172) |
| **Total** | **97.76% (1568 / 1604)** | **97.77% (1577 / 1613)** |

**Build times** were measured on this machine with warm Gradle and konan caches. The three runs had different task sets, so they do not compare directly:

| Run | Time | Tasks |
|---|---|---|
| Baseline | 1 min 37 s | 83 |
| Parked layout, including `koverXmlReport` | 2 min 15 s | 186 |
| Final gate | 1 min 21 s | 188 |

## Decisions (for the plan; `docs/plans/` is Stage 4's to edit)

1. **The CI floor is 631, not 616.** 631 is the K7 baseline. The plan's 616 predates Workflow 4B's 15 Android tests, and a floor of 616 would let 15 tests vanish unnoticed.
2. **The label cleaning lives in `commonMain/camera/DeviceLabel.kt`** as `cleanDeviceLabel`, which `CameraFacts.kt` calls, instead of inside `CameraFacts.kt`. The `commonTest` RED needed it in `commonMain` while `CameraFacts.kt` still used CameraX.
3. **`isOutOfMemory` and `CAPTURE_MIRRORS_IMAGES` are declared in `commonMain/camera/CapturePlatform.kt`.** Their actuals are in `androidMain/.../CapturePlatform.android.kt` and `iosMain/.../CapturePlatform.ios.kt`.
4. **A `src/iosTest` source set exists**, although K1 lists none. It holds one test actual, `outOfMemoryError()`, which the common out-of-memory tests need.
5. **`androidMain` still declares every androidx Compose and lifecycle library the module had:** `ui`, `foundation`, `material3` and `lifecycle-viewmodel-compose`, besides K6's list. The parked code imports them, and the Android classpath stays as it was. Stage 3 can drop what the common code no longer needs.
6. **The common tests use camelCase names** with a sentence in KDoc, the portable form for tests that will also run on Kotlin/Native.

## Follow-ups

- **Stage 3.** The KMP DSL has no `resourcePrefix`, so the module has had no prefix check since `e8c6b62`, and K5's resource-naming test replaces it. The strings are 111 in each locale plus one plural, `openverify_selfie_time_limit`: English `one` and `other`, Spanish `one`, `many` and `other`. The plan says there are no plurals. CMP resources support `<plurals>` with `pluralStringResource`.
- **Stage 4, licence rows** for transitive dependencies that K9 does not list. All are Apache-2.0 unless marked, and all were released at least 14 days ago:
  - skiko 0.144.6 (iOS);
  - kotlinx-datetime 0.7.1 (iOS);
  - atomicfu 0.32.1 (iOS);
  - androidx.navigationevent 1.0.1 (iOS);
  - kotlinx-coroutines-slf4j 1.11.0;
  - kotlinx-io-bytestring 0.9.1;
  - the CMP `annotation-internal` and `collection-internal` artifacts (1.9.1 and 1.10.0), `ui-backhandler` 1.11.1 and `material-ripple` 1.9.1;
  - in test scope, `kotlin-test-junit5` 2.4.21.
- **The KLIB warnings.** Spike result 9 says the JetBrains coordinates avoid the "same unique_name" warnings. The build still prints 11 of them, for CMP's own runtime, collection, annotation, savedstate and lifecycle artifacts. They are harmless.
- **The instrumented job.** It boots for `*/src/androidTest/*` too, as K8 asks, but runs only the SDK's device tests. If a plain Android module gains `src/androidTest`, its tests also need `connectedDebugAndroidTest` in that script.

## Appendix: the K7 baseline list

Each line is `<classname>#<testcase name>` from the JUnit XML, sorted by code point. Gradle names a parameterized invocation by its display name only (for example `[1] 0`), so 23 lines repeat. The list is therefore a multiset of 631 lines, 608 of them distinct. Five names end in a space, where the parameter is an empty string: `[1] `, `[3] `, `[4] `, and `[5] ` twice.

<!-- baseline-list -->
```text
dev.openverify.sdk.InquiryResultsTest#AwaitingCamera(step=SelfieStep(id=selfie, poses=[CENTER, LEFT, RIGHT], liveness=ACTIVE, maxAttempts=3))
dev.openverify.sdk.InquiryResultsTest#Capture(step=GovernmentIdStep(id=government_id, sides=BOTH, allowedCountries=null, allowedIdClasses=null, maxAttempts=3, captureMethods=[UPLOAD, CAMERA]), kind=FRONT, index=0, count=2, retryHints=[], image=null, uploadAllowed=false, sending=false, restarted=false)
dev.openverify.sdk.InquiryResultsTest#Consent(step=ConsentStep(id=consent, textKeys=[consent.biometric], required=true, optionalTextKeys=[]), submitting=false, retentionDays=null)
dev.openverify.sdk.InquiryResultsTest#Error(error=INQUIRY_MISMATCH, canRetry=false) -> INVALID_REQUEST
dev.openverify.sdk.InquiryResultsTest#Error(error=INVALID_RESPONSE, canRetry=true) -> SERVER_ERROR
dev.openverify.sdk.InquiryResultsTest#Error(error=NETWORK, canRetry=true) -> NETWORK_ERROR
dev.openverify.sdk.InquiryResultsTest#Error(error=OUT_OF_SYNC, canRetry=true) -> SERVER_ERROR
dev.openverify.sdk.InquiryResultsTest#Error(error=REJECTED, canRetry=false) -> SERVER_ERROR
dev.openverify.sdk.InquiryResultsTest#Error(error=SERVER, canRetry=true) -> SERVER_ERROR
dev.openverify.sdk.InquiryResultsTest#Error(error=SESSION_EXPIRED, canRetry=false) -> SESSION_EXPIRED
dev.openverify.sdk.InquiryResultsTest#Error(error=STILL_PROCESSING, canRetry=true) -> STILL_PROCESSING
dev.openverify.sdk.InquiryResultsTest#Expired -> INQUIRY_EXPIRED
dev.openverify.sdk.InquiryResultsTest#Failed(step=FailureStep(id=failure, messageKey=null), inquiryStatus=FAILED) -> INQUIRY_FAILED
dev.openverify.sdk.InquiryResultsTest#Failed(step=null, inquiryStatus=FAILED) -> INQUIRY_FAILED
dev.openverify.sdk.InquiryResultsTest#Finalizing(step=GovernmentIdStep(id=government_id, sides=BOTH, allowedCountries=null, allowedIdClasses=null, maxAttempts=3, captureMethods=[UPLOAD, CAMERA])) -> STILL_PROCESSING
dev.openverify.sdk.InquiryResultsTest#LinkRefused -> LINK_INVALID
dev.openverify.sdk.InquiryResultsTest#Loading
dev.openverify.sdk.InquiryResultsTest#Processing(step=GovernmentIdStep(id=government_id, sides=BOTH, allowedCountries=null, allowedIdClasses=null, maxAttempts=3, captureMethods=[UPLOAD, CAMERA]))
dev.openverify.sdk.InquiryResultsTest#Redacted -> INQUIRY_REDACTED
dev.openverify.sdk.InquiryResultsTest#SessionEnded(reason=CANCELED) -> SESSION_CANCELED
dev.openverify.sdk.InquiryResultsTest#SessionEnded(reason=EXPIRED) -> SESSION_EXPIRED
dev.openverify.sdk.InquiryResultsTest#Unsupported(reason=step form) -> UNSUPPORTED_FLOW
dev.openverify.sdk.InquiryResultsTest#an inquiry in review completes the flow, with its status for the host app (C30_6)()
dev.openverify.sdk.InquiryResultsTest#completion reports the inquiry status()
dev.openverify.sdk.InquiryViewModelTest#a camera photo's facts reach the selfie submit as its device snapshot (C40_4)()
dev.openverify.sdk.InquiryViewModelTest#back cancels a flow in progress()
dev.openverify.sdk.InquiryViewModelTest#back on a terminal screen reports its outcome()
dev.openverify.sdk.InquiryViewModelTest#cancel ends the flow as canceled()
dev.openverify.sdk.InquiryViewModelTest#finish reports the terminal state()
dev.openverify.sdk.InquiryViewModelTest#outside a sandbox a picked photo is not taken (C19)()
dev.openverify.sdk.InquiryViewModelTest#problems/session-canceled-inquiry-expired.json
dev.openverify.sdk.InquiryViewModelTest#problems/session-canceled-inquiry-finished.json
dev.openverify.sdk.InquiryViewModelTest#problems/session-canceled-inquiry-redacted.json
dev.openverify.sdk.InquiryViewModelTest#retry repeats the failed call()
dev.openverify.sdk.InquiryViewModelTest#screen actions drive the coordinator()
dev.openverify.sdk.InquiryViewModelTest#the first ending wins()
dev.openverify.sdk.InquiryViewModelTest#the flow starts when the view model is created()
dev.openverify.sdk.InquiryViewModelTest#the optional consent keys the user ticked reach the server (C42_3)()
dev.openverify.sdk.InquiryViewModelTest#the sandbox flag follows the session (C19)()
dev.openverify.sdk.InquiryViewModelTest#the selfie capture is created once the screen reports the camera ready (4B H014)()
dev.openverify.sdk.OpenVerifyInquiryActivityTest#a malformed request fails without contacting the server
dev.openverify.sdk.OpenVerifyInquiryActivityTest#a one-time link is redeemed once, then the flow runs with the session it got
dev.openverify.sdk.OpenVerifyInquiryActivityTest#a sandbox session shows the sandbox banner
dev.openverify.sdk.OpenVerifyInquiryActivityTest#a used one-time link ends on the used-link screen and reports LINK_INVALID
dev.openverify.sdk.OpenVerifyInquiryActivityTest#an expired session ends as Failed SESSION_EXPIRED when closed
dev.openverify.sdk.OpenVerifyInquiryActivityTest#an inactive session ends on its own screen and reports why
dev.openverify.sdk.OpenVerifyInquiryActivityTest#back before the end returns Canceled with the inquiry ID
dev.openverify.sdk.OpenVerifyInquiryActivityTest#identity documents and selfies are kept out of screenshots and recents
dev.openverify.sdk.OpenVerifyInquiryActivityTest#the consent step from the session is shown
dev.openverify.sdk.OpenVerifyInquiryActivityTest#the redeemed session lives in memory and survives a rotation without a second redeem
dev.openverify.sdk.OpenVerifyInquiryContractTest#a launch intent with a missing or malformed value carries no request
dev.openverify.sdk.OpenVerifyInquiryContractTest#a one-time link intent with a missing or malformed value carries no launch
dev.openverify.sdk.OpenVerifyInquiryContractTest#a one-time link launches the SDK activity with the link, never a session token
dev.openverify.sdk.OpenVerifyInquiryContractTest#a session launch intent carries the request as before
dev.openverify.sdk.OpenVerifyInquiryContractTest#an activity that ended without data was canceled
dev.openverify.sdk.OpenVerifyInquiryContractTest#an inquiry in review survives the trip through the activity result as a completion (C30_6)
dev.openverify.sdk.OpenVerifyInquiryContractTest#an inquiry status this SDK version does not know is reported as UNKNOWN
dev.openverify.sdk.OpenVerifyInquiryContractTest#completion and failure return RESULT_OK, cancellation RESULT_CANCELED
dev.openverify.sdk.OpenVerifyInquiryContractTest#every result survives the trip through the activity result
dev.openverify.sdk.OpenVerifyInquiryContractTest#the launch intent opens the SDK activity with the request
dev.openverify.sdk.OpenVerifyInquiryContractTest#the one-time link contract parses results like the session contract
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#[10] not a url
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#[1] https://verify.example.com/
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#[2] https://verify.example.com/#inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#[3] https://verify.example.com/#one-time-token=ovo_ooooooooooooooooooooooooooooooooooooooooooo
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#[4] https://verify.example.com/#inquiry-id=inq_123&one-time-token=ovo_ooooooooooooooooooooooooooooooooooooooooooo
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#[5] https://verify.example.com/#inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7&one-time-token=ovo_short
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#[6] https://verify.example.com/#inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7&one-time-token=ovs_ttttttttttttttttttttttttttttttttttttttttttt
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#[7] https://verify.example.com/#inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7&one-time-token=ovo_ooooooooooooooooooooooooooooooooooooooooooo&one-time-token=ovo_ooooooooooooooooooooooooooooooooooooooooooo
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#[8] https://verify.example.com/#inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7&one-time-token=ovo_ooooooooooooooooooooooooooooooooooooooooooo&session-token=ovs_ttttttttttttttttttttttttttttttttttttttttttt
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#[9] https://verify.example.com/?inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7&one-time-token=ovo_ooooooooooooooooooooooooooooooooooooooooooo
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#a flow served under a path still talks to the API on its origin()
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#a one-time link is read from its fragment, with the API on the link's origin()
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#an API base URL that would send the session in clear text is refused()
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#an API on another origin is given explicitly()
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#errors and toString never show the token()
dev.openverify.sdk.OpenVerifyInquiryOneTimeLinkTest#links are equal when they carry the same values()
dev.openverify.sdk.OpenVerifyInquiryRequestTest#[1] 
dev.openverify.sdk.OpenVerifyInquiryRequestTest#[2] inq_123
dev.openverify.sdk.OpenVerifyInquiryRequestTest#[3] ver_01M5CJXHG07XPHF3HRM6NREDH7
dev.openverify.sdk.OpenVerifyInquiryRequestTest#[4] inq_01m5cjxhg07xphf3hrm6nredh7
dev.openverify.sdk.OpenVerifyInquiryRequestTest#a base URL that would send the token in clear text is refused()
dev.openverify.sdk.OpenVerifyInquiryRequestTest#a value that is not a session token is refused without being echoed()
dev.openverify.sdk.OpenVerifyInquiryRequestTest#a well-formed request is accepted()
dev.openverify.sdk.OpenVerifyInquiryRequestTest#toString never shows the session token()
dev.openverify.sdk.api.FlowApiClientTest#HTTP 400 -> Rejected
dev.openverify.sdk.api.FlowApiClientTest#HTTP 401 -> Unauthorized
dev.openverify.sdk.api.FlowApiClientTest#HTTP 403 -> Forbidden
dev.openverify.sdk.api.FlowApiClientTest#HTTP 404 -> NotFound
dev.openverify.sdk.api.FlowApiClientTest#HTTP 409 -> Conflict
dev.openverify.sdk.api.FlowApiClientTest#HTTP 410 -> Redacted
dev.openverify.sdk.api.FlowApiClientTest#HTTP 413 -> Rejected
dev.openverify.sdk.api.FlowApiClientTest#HTTP 415 -> Rejected
dev.openverify.sdk.api.FlowApiClientTest#HTTP 418 -> UnexpectedStatus
dev.openverify.sdk.api.FlowApiClientTest#HTTP 422 -> Rejected
dev.openverify.sdk.api.FlowApiClientTest#HTTP 429 -> RateLimited
dev.openverify.sdk.api.FlowApiClientTest#HTTP 500 -> ServerError
dev.openverify.sdk.api.FlowApiClientTest#HTTP 503 -> ServerError
dev.openverify.sdk.api.FlowApiClientTest#Retry-After seconds are exposed on 429()
dev.openverify.sdk.api.FlowApiClientTest#[1] ..
dev.openverify.sdk.api.FlowApiClientTest#[1] /openverify/
dev.openverify.sdk.api.FlowApiClientTest#[1] CAMERA, camera
dev.openverify.sdk.api.FlowApiClientTest#[1] api.example.com
dev.openverify.sdk.api.FlowApiClientTest#[1] https://api.example.com
dev.openverify.sdk.api.FlowApiClientTest#[1] key_01M5CJXHG07XPHF3HRM6NREDH7.secret
dev.openverify.sdk.api.FlowApiClientTest#[1] passed
dev.openverify.sdk.api.FlowApiClientTest#[2] ../session
dev.openverify.sdk.api.FlowApiClientTest#[2] /openverify
dev.openverify.sdk.api.FlowApiClientTest#[2] UPLOAD, upload
dev.openverify.sdk.api.FlowApiClientTest#[2] failed
dev.openverify.sdk.api.FlowApiClientTest#[2] ftp://api.example.com
dev.openverify.sdk.api.FlowApiClientTest#[2] http://10.0.2.2:3000
dev.openverify.sdk.api.FlowApiClientTest#[2] ovs_too-short
dev.openverify.sdk.api.FlowApiClientTest#[3] http://api.example.com
dev.openverify.sdk.api.FlowApiClientTest#[3] http://localhost:3000
dev.openverify.sdk.api.FlowApiClientTest#[3] ovs_tttttttttttttttttttttttttttttttttttttttttt!
dev.openverify.sdk.api.FlowApiClientTest#[3] requires_retry
dev.openverify.sdk.api.FlowApiClientTest#[3] ver_short
dev.openverify.sdk.api.FlowApiClientTest#[4] Bearer ovs_ttttttttttttttttttttttttttttttttttttttttttt
dev.openverify.sdk.api.FlowApiClientTest#[4] canceled
dev.openverify.sdk.api.FlowApiClientTest#[4] http://127.0.0.1:3000/
dev.openverify.sdk.api.FlowApiClientTest#[4] http://192.168.1.20:3000
dev.openverify.sdk.api.FlowApiClientTest#[4] ver_01M5CK16P0D13FXHZSS4TCFBVU
dev.openverify.sdk.api.FlowApiClientTest#[5] 
dev.openverify.sdk.api.FlowApiClientTest#[5] 
dev.openverify.sdk.api.FlowApiClientTest#[5] http://[::1]:3000
dev.openverify.sdk.api.FlowApiClientTest#[5] https://api.example.com/?tenant=1
dev.openverify.sdk.api.FlowApiClientTest#[5] skipped
dev.openverify.sdk.api.FlowApiClientTest#[6] https://user:pass@api.example.com
dev.openverify.sdk.api.FlowApiClientTest#a canceled session's 401 keeps its reason, from the golden problem (C25)()
dev.openverify.sdk.api.FlowApiClientTest#a connection failure is a Network error()
dev.openverify.sdk.api.FlowApiClientTest#a create answered 201 without the contract's attributes is an InvalidResponse, which the coordinator takes as made (2E follow-up)()
dev.openverify.sdk.api.FlowApiClientTest#a first prompt other than center
dev.openverify.sdk.api.FlowApiClientTest#a nonce of the wrong length
dev.openverify.sdk.api.FlowApiClientTest#a nonce that is not base64url
dev.openverify.sdk.api.FlowApiClientTest#a pose prompted twice
dev.openverify.sdk.api.FlowApiClientTest#a success body that is not the contract JSON is an InvalidResponse()
dev.openverify.sdk.api.FlowApiClientTest#acceptConsent leaves optional-text-keys out when none was ticked, as servers before Phase 4 expect()
dev.openverify.sdk.api.FlowApiClientTest#acceptConsent posts the text keys and the locale()
dev.openverify.sdk.api.FlowApiClientTest#acceptConsent sends the optional texts the user ticked apart from the required ones()
dev.openverify.sdk.api.FlowApiClientTest#an error without a JSON body maps by status alone()
dev.openverify.sdk.api.FlowApiClientTest#an id that is not self_ and a ULID
dev.openverify.sdk.api.FlowApiClientTest#an inactive session's 401 keeps its code (C10)()
dev.openverify.sdk.api.FlowApiClientTest#call timeout
dev.openverify.sdk.api.FlowApiClientTest#cancelling the caller cancels the HTTP call()
dev.openverify.sdk.api.FlowApiClientTest#createVerification refuses a type the flow API does not create()
dev.openverify.sdk.api.FlowApiClientTest#createVerification sends the API type and leaves out absent options()
dev.openverify.sdk.api.FlowApiClientTest#getSession sends the session token and decodes the session()
dev.openverify.sdk.api.FlowApiClientTest#getVerification reads one verification()
dev.openverify.sdk.api.FlowApiClientTest#no prompt
dev.openverify.sdk.api.FlowApiClientTest#pollVerification gives up after the last attempt()
dev.openverify.sdk.api.FlowApiClientTest#pollVerification returns as soon as the verification is decided()
dev.openverify.sdk.api.FlowApiClientTest#read timeout
dev.openverify.sdk.api.FlowApiClientTest#redirects are not followed, so the token never leaves the API origin()
dev.openverify.sdk.api.FlowApiClientTest#submitVerification names the capture it consumes, with the device snapshot, as the golden body()
dev.openverify.sdk.api.FlowApiClientTest#submitVerification posts an empty JSON object to submit()
dev.openverify.sdk.api.FlowApiClientTest#the request ID falls back to the problem body()
dev.openverify.sdk.api.FlowApiClientTest#uploadFile sends a selfie pose with its capture id, nonce and elapsed time, all before the file()
dev.openverify.sdk.api.FlowApiClientTest#uploadFile sends no capture fields for a government ID side()
dev.openverify.sdk.api.FlowApiClientTest#uploadFile sends the kind and the image as multipart form data()
dev.openverify.sdk.api.OneTimeLinkClientTest#a refused link (the one generic 401) is LinkRefused()
dev.openverify.sdk.api.OneTimeLinkClientTest#a shared OkHttp client is accepted()
dev.openverify.sdk.api.OneTimeLinkClientTest#malformed credentials are refused before any request, without echoing the token()
dev.openverify.sdk.api.OneTimeLinkClientTest#other failures keep their usual kinds()
dev.openverify.sdk.api.OneTimeLinkClientTest#redeem posts the inquiry ID and one-time token without credentials, and returns the session()
dev.openverify.sdk.api.OneTimeLinkClientTest#the redeemed session never prints its token()
dev.openverify.sdk.api.OneTimeLinkFlowApiTest#a redeem that failed on the way is tried again by the next call()
dev.openverify.sdk.api.OneTimeLinkFlowApiTest#a refused link stays refused, without a second redeem (2D F022)()
dev.openverify.sdk.api.OneTimeLinkFlowApiTest#calls that race to be first still redeem once()
dev.openverify.sdk.api.OneTimeLinkFlowApiTest#the first call redeems the link, then calls go to a client for the session()
dev.openverify.sdk.api.OneTimeLinkFlowApiTest#the selfie capture calls reach the session's client with every argument (C40, C42_3)()
dev.openverify.sdk.camera.CameraFactsTest#[1] 0
dev.openverify.sdk.camera.CameraFactsTest#[1] 0
dev.openverify.sdk.camera.CameraFactsTest#[2] -1
dev.openverify.sdk.camera.CameraFactsTest#[2] -5
dev.openverify.sdk.camera.CameraFactsTest#[3] 1001
dev.openverify.sdk.camera.CameraFactsTest#[3] 16385
dev.openverify.sdk.camera.CameraFactsTest#a front camera's facts become the snapshot's label, settings and capabilities()
dev.openverify.sdk.camera.CameraFactsTest#a label is cleaned of control and direction characters and kept to 200 characters, as the server keeps it()
dev.openverify.sdk.camera.CameraFactsTest#a logical camera's ids are listed together()
dev.openverify.sdk.camera.CameraFactsTest#lens facing -1
dev.openverify.sdk.camera.CameraFactsTest#lens facing 0
dev.openverify.sdk.camera.CameraFactsTest#lens facing 1
dev.openverify.sdk.camera.CameraFactsTest#lens facing 2
dev.openverify.sdk.camera.CameraFactsTest#no camera id means no label()
dev.openverify.sdk.camera.CameraFactsTest#the snapshot uses only members of the golden submit body()
dev.openverify.sdk.camera.CameraFactsTest#without camera facts the snapshot still says how the photo is stored()
dev.openverify.sdk.camera.CaptureCameraTest#a photo is passed through()
dev.openverify.sdk.camera.CaptureCameraTest#cancellation is not swallowed()
dev.openverify.sdk.camera.CaptureCameraTest#dev.openverify.sdk.camera.CameraCaptureException: camera closed
dev.openverify.sdk.camera.CaptureCameraTest#java.lang.IllegalArgumentException: not an accepted image
dev.openverify.sdk.camera.CaptureCameraTest#java.lang.IllegalStateException: use case not bound
dev.openverify.sdk.camera.CaptureCameraTest#java.lang.OutOfMemoryError: bitmap
dev.openverify.sdk.camera.CaptureCameraTest#java.lang.RuntimeException: camera service died
dev.openverify.sdk.camera.CaptureCameraTest#java.lang.UnsupportedOperationException: format not supported
dev.openverify.sdk.camera.CapturedImageTest#[1] image/gif
dev.openverify.sdk.camera.CapturedImageTest#[2] application/octet-stream
dev.openverify.sdk.camera.CapturedImageTest#[3] 
dev.openverify.sdk.camera.CapturedImageTest#an empty image is refused()
dev.openverify.sdk.camera.CapturedImageTest#an image over the 10 MiB upload limit is refused()
dev.openverify.sdk.camera.CapturedImageTest#images are equal when their bytes and type are()
dev.openverify.sdk.camera.CapturedImageTest#toString describes the image without its bytes()
dev.openverify.sdk.camera.ImageEncodingTest#large frames are scaled down to the maximum, keeping the aspect ratio
dev.openverify.sdk.camera.ImageEncodingTest#only quarter turns are accepted
dev.openverify.sdk.camera.ImageEncodingTest#quarter turns swap width and height
dev.openverify.sdk.camera.ImageEncodingTest#small frames are never scaled up
dev.openverify.sdk.camera.ImageEncodingTest#the result is a JPEG
dev.openverify.sdk.camera.ImageEncodingTest#the uploaded JPEG is never mirrored at any quarter turn, and the device snapshot says so
dev.openverify.sdk.camera.PickedPhotosTest#a file is read up to the limit, and a larger one gives nothing
dev.openverify.sdk.camera.PickedPhotosTest#a file that cannot be read gives nothing
dev.openverify.sdk.camera.PickedPhotosTest#a large photo is scaled down like a camera frame
dev.openverify.sdk.camera.PickedPhotosTest#a long, thin photo is used, not lost to an error in the encoder (2D F017)
dev.openverify.sdk.camera.PickedPhotosTest#a photo of more than 40 megapixels is refused, however small its file (2D F017)
dev.openverify.sdk.camera.PickedPhotosTest#a picked PNG is re-encoded as a JPEG of the same size
dev.openverify.sdk.camera.PickedPhotosTest#a picked file is loaded as an upload
dev.openverify.sdk.camera.PickedPhotosTest#a picked photo is decoded with its longest side from the upload size to under twice it (2D F017)
dev.openverify.sdk.camera.PickedPhotosTest#a picked photo's metadata, where it was taken and the camera, never leaves the device (2D F023)
dev.openverify.sdk.camera.PickedPhotosTest#any other failure while loading a picked photo gives no photo, not a crash (2D F017)
dev.openverify.sdk.camera.PickedPhotosTest#bytes that are not an image give no photo
dev.openverify.sdk.camera.PickedPhotosTest#running out of memory while loading a picked photo gives no photo, not a crash (2D F017)
dev.openverify.sdk.flow.FlowCoordinatorTest#APPROVED
dev.openverify.sdk.flow.FlowCoordinatorTest#COMPLETED
dev.openverify.sdk.flow.FlowCoordinatorTest#DECLINED
dev.openverify.sdk.flow.FlowCoordinatorTest#GOVERNMENT_ID
dev.openverify.sdk.flow.FlowCoordinatorTest#ID NEEDS_REVIEW, selfie PASSED
dev.openverify.sdk.flow.FlowCoordinatorTest#ID PASSED, selfie NEEDS_REVIEW
dev.openverify.sdk.flow.FlowCoordinatorTest#INQUIRY_EXPIRED
dev.openverify.sdk.flow.FlowCoordinatorTest#INQUIRY_FINISHED
dev.openverify.sdk.flow.FlowCoordinatorTest#INQUIRY_REDACTED
dev.openverify.sdk.flow.FlowCoordinatorTest#NEEDS_REVIEW
dev.openverify.sdk.flow.FlowCoordinatorTest#PRODUCTION
dev.openverify.sdk.flow.FlowCoordinatorTest#SELFIE
dev.openverify.sdk.flow.FlowCoordinatorTest#UNKNOWN
dev.openverify.sdk.flow.FlowCoordinatorTest#UNKNOWN
dev.openverify.sdk.flow.FlowCoordinatorTest#a 401 with another code is still the expired-session error()
dev.openverify.sdk.flow.FlowCoordinatorTest#a back-only ID takes the back()
dev.openverify.sdk.flow.FlowCoordinatorTest#a camera reported ready on another screen changes nothing there (4B H014)()
dev.openverify.sdk.flow.FlowCoordinatorTest#a capture create that failed on the network is retried without creating the verification twice()
dev.openverify.sdk.flow.FlowCoordinatorTest#a capture older than its lifetime is replaced before any photo is sent to it()
dev.openverify.sdk.flow.FlowCoordinatorTest#a capture step without photos to take is unsupported()
dev.openverify.sdk.flow.FlowCoordinatorTest#a centre-only passive step prompts once, under its own capture()
dev.openverify.sdk.flow.FlowCoordinatorTest#a condition outside the supported JSONLogic is reported as unsupported()
dev.openverify.sdk.flow.FlowCoordinatorTest#a conflict re-reads the session on retry()
dev.openverify.sdk.flow.FlowCoordinatorTest#a create answered with an unexpected body is taken as made, and the verification the session shows is reused()
dev.openverify.sdk.flow.FlowCoordinatorTest#a create that never reached the server is made again on retry, after the session shows it is missing()
dev.openverify.sdk.flow.FlowCoordinatorTest#a failed attempt with attempts left shows retry hints, and the retry is a new verification()
dev.openverify.sdk.flow.FlowCoordinatorTest#a failed consent can be sent again()
dev.openverify.sdk.flow.FlowCoordinatorTest#a failed inquiry ends at the failure step even without a transition to it()
dev.openverify.sdk.flow.FlowCoordinatorTest#a failed inquiry in a flow without a failure step still ends as failed()
dev.openverify.sdk.flow.FlowCoordinatorTest#a failed last attempt follows the transition to the failure step()
dev.openverify.sdk.flow.FlowCoordinatorTest#a failed selfie attempt with attempts left is retried on a new verification and capture, with its hints on each prompt (C43)()
dev.openverify.sdk.flow.FlowCoordinatorTest#a failed start can be retried()
dev.openverify.sdk.flow.FlowCoordinatorTest#a flow without a terminal step completes after its last step()
dev.openverify.sdk.flow.FlowCoordinatorTest#a flow without steps is unsupported()
dev.openverify.sdk.flow.FlowCoordinatorTest#a front-only ID takes one photo()
dev.openverify.sdk.flow.FlowCoordinatorTest#a government ID step does not wait for the camera, since it creates nothing before its photos (4B H014)()
dev.openverify.sdk.flow.FlowCoordinatorTest#a move to an upload capture that failed on the network is made again on retry()
dev.openverify.sdk.flow.FlowCoordinatorTest#a network error during upload resumes without repeating finished work()
dev.openverify.sdk.flow.FlowCoordinatorTest#a network error while waiting for the decision re-reads the session on retry()
dev.openverify.sdk.flow.FlowCoordinatorTest#a new inquiry starts at its consent step()
dev.openverify.sdk.flow.FlowCoordinatorTest#a photo is reviewed before it is kept, and can be retaken()
dev.openverify.sdk.flow.FlowCoordinatorTest#a photo picked for a later prompt starts the upload capture's prompts again()
dev.openverify.sdk.flow.FlowCoordinatorTest#a photo picked in a sandbox for the first prompt moves to an upload capture, which sends no device snapshot (C19, C40_2)()
dev.openverify.sdk.flow.FlowCoordinatorTest#a pose refused with selfie_capture_invalid starts a new capture and its prompts again, saying so (C40_4)()
dev.openverify.sdk.flow.FlowCoordinatorTest#a pose sent after the server expired the capture starts a new capture (C40_4)()
dev.openverify.sdk.flow.FlowCoordinatorTest#a pose that could not be sent is sent again on retry, then the next prompt shows()
dev.openverify.sdk.flow.FlowCoordinatorTest#a redacted inquiry ends the flow when a photo is sent (410)()
dev.openverify.sdk.flow.FlowCoordinatorTest#a refused one-time link ends on the used-link screen()
dev.openverify.sdk.flow.FlowCoordinatorTest#a sandbox ID step that takes only the camera allows no upload()
dev.openverify.sdk.flow.FlowCoordinatorTest#a sandbox session is reported, and allows uploads for the selfie and an ID that takes them()
dev.openverify.sdk.flow.FlowCoordinatorTest#a session canceled while consent is sent ends the flow()
dev.openverify.sdk.flow.FlowCoordinatorTest#a session for another inquiry is refused()
dev.openverify.sdk.flow.FlowCoordinatorTest#a session found ended while a lost create is checked ends the flow on its screen()
dev.openverify.sdk.flow.FlowCoordinatorTest#a session with consent already given starts at the ID()
dev.openverify.sdk.flow.FlowCoordinatorTest#a step the SDK cannot render stops the flow as unsupported()
dev.openverify.sdk.flow.FlowCoordinatorTest#a submit whose answer was lost is repeated with the same capture, which the server takes again (C40_4)()
dev.openverify.sdk.flow.FlowCoordinatorTest#a transition loop is reported as unsupported()
dev.openverify.sdk.flow.FlowCoordinatorTest#a verification still processing when polling stops can be checked again()
dev.openverify.sdk.flow.FlowCoordinatorTest#accepting consent records the texts shown and their language, then opens the ID front()
dev.openverify.sdk.flow.FlowCoordinatorTest#actions are ignored while another is running()
dev.openverify.sdk.flow.FlowCoordinatorTest#an ID sent to review counts as done, so the selfie opens without retry hints (C30_6)()
dev.openverify.sdk.flow.FlowCoordinatorTest#an ID step that does not allow the camera is unsupported()
dev.openverify.sdk.flow.FlowCoordinatorTest#an answered refusal of the create is not taken for a lost answer()
dev.openverify.sdk.flow.FlowCoordinatorTest#an expired inquiry ends the flow without asking for consent or photos()
dev.openverify.sdk.flow.FlowCoordinatorTest#an expired session cannot be retried()
dev.openverify.sdk.flow.FlowCoordinatorTest#an inquiry still undecided when waiting stops can be checked again()
dev.openverify.sdk.flow.FlowCoordinatorTest#an inquiry that expires during the flow ends there once the conflict is re-read()
dev.openverify.sdk.flow.FlowCoordinatorTest#an optional text the SDK cannot show is never sent, and the step stays supported()
dev.openverify.sdk.flow.FlowCoordinatorTest#an unreadable create the session does not show is made again on retry, after the session is read()
dev.openverify.sdk.flow.FlowCoordinatorTest#capture, retake and confirm are ignored when there is nothing to act on()
dev.openverify.sdk.flow.FlowCoordinatorTest#consent sends the step's text keys as they are and only the optional keys the user ticked()
dev.openverify.sdk.flow.FlowCoordinatorTest#consent to a text the UI cannot show is never recorded()
dev.openverify.sdk.flow.FlowCoordinatorTest#declining the optional consent sends none, and the user still verifies()
dev.openverify.sdk.flow.FlowCoordinatorTest#dev.openverify.sdk.api.FlowApiException$Forbidden: HTTP 403
dev.openverify.sdk.flow.FlowCoordinatorTest#dev.openverify.sdk.api.FlowApiException$InvalidResponse: Unexpected response body
dev.openverify.sdk.flow.FlowCoordinatorTest#dev.openverify.sdk.api.FlowApiException$NotFound: HTTP 404
dev.openverify.sdk.flow.FlowCoordinatorTest#dev.openverify.sdk.api.FlowApiException$RateLimited: HTTP 429
dev.openverify.sdk.flow.FlowCoordinatorTest#dev.openverify.sdk.api.FlowApiException$Rejected: HTTP 422
dev.openverify.sdk.flow.FlowCoordinatorTest#dev.openverify.sdk.api.FlowApiException$ServerError: HTTP 500
dev.openverify.sdk.flow.FlowCoordinatorTest#dev.openverify.sdk.api.FlowApiException$StillProcessing: Verification is still being processed
dev.openverify.sdk.flow.FlowCoordinatorTest#dev.openverify.sdk.api.FlowApiException$UnexpectedStatus: HTTP 302
dev.openverify.sdk.flow.FlowCoordinatorTest#each pose is sent with its capture's id and nonce and the time from the capture to the shutter, before the next prompt (C40_3)()
dev.openverify.sdk.flow.FlowCoordinatorTest#java.io.IOException: unexpected end of stream
dev.openverify.sdk.flow.FlowCoordinatorTest#java.io.InterruptedIOException: timeout
dev.openverify.sdk.flow.FlowCoordinatorTest#java.lang.IllegalArgumentException: Not a verification ID
dev.openverify.sdk.flow.FlowCoordinatorTest#java.net.SocketTimeoutException: timeout
dev.openverify.sdk.flow.FlowCoordinatorTest#null
dev.openverify.sdk.flow.FlowCoordinatorTest#once the camera was shown, a new capture starts at once, without waiting for the camera again (4B H014)()
dev.openverify.sdk.flow.FlowCoordinatorTest#outside a sandbox a picked photo is ignored()
dev.openverify.sdk.flow.FlowCoordinatorTest#problems/session-canceled-inquiry-expired.json
dev.openverify.sdk.flow.FlowCoordinatorTest#problems/session-canceled-inquiry-finished.json
dev.openverify.sdk.flow.FlowCoordinatorTest#problems/session-canceled-inquiry-redacted.json
dev.openverify.sdk.flow.FlowCoordinatorTest#resuming a completed inquiry shows completion()
dev.openverify.sdk.flow.FlowCoordinatorTest#resuming a failed attempt shows its retry hints()
dev.openverify.sdk.flow.FlowCoordinatorTest#resuming a failed inquiry goes straight to the failure step()
dev.openverify.sdk.flow.FlowCoordinatorTest#resuming a submitted verification waits for its decision instead of asking for photos()
dev.openverify.sdk.flow.FlowCoordinatorTest#resuming after a passed ID opens the selfie()
dev.openverify.sdk.flow.FlowCoordinatorTest#resuming after an ID in review opens the selfie (C30_6)()
dev.openverify.sdk.flow.FlowCoordinatorTest#resuming an initiated selfie verification makes it a new capture, since a nonce lives in memory only()
dev.openverify.sdk.flow.FlowCoordinatorTest#resuming an initiated verification reuses it()
dev.openverify.sdk.flow.FlowCoordinatorTest#resuming with every attempt used waits for the inquiry to be decided()
dev.openverify.sdk.flow.FlowCoordinatorTest#selfie_capture_incomplete
dev.openverify.sdk.flow.FlowCoordinatorTest#selfie_capture_invalid
dev.openverify.sdk.flow.FlowCoordinatorTest#session_canceled
dev.openverify.sdk.flow.FlowCoordinatorTest#session_expired
dev.openverify.sdk.flow.FlowCoordinatorTest#submit names the capture and its nonce, with the camera's device snapshot (C40_4)()
dev.openverify.sdk.flow.FlowCoordinatorTest#the consent step shows the session's face template retention days, and none from an older server()
dev.openverify.sdk.flow.FlowCoordinatorTest#the happy path uploads both sides, then each selfie pose under its capture, and completes()
dev.openverify.sdk.flow.FlowCoordinatorTest#the selfie step creates its verification and a capture before the first prompt, then prompts in the server's order (C40_2)()
dev.openverify.sdk.flow.FlowCoordinatorTest#the selfie step creates nothing until the camera can be shown, so a slow camera permission does not use up the capture's lifetime (4B H014)()
dev.openverify.sdk.flow.FlowCoordinatorTest#when the capture cap cancels the verification, the session is re-read and a new attempt starts (C40_2)()
dev.openverify.sdk.flow.FlowCoordinatorTest#when the last attempt fails, the flow waits for the inquiry to fail instead of asking for photos the server refuses()
dev.openverify.sdk.flow.FlowCoordinatorTest#when the session cannot be read after a lost create either, each retry reads it first and never creates twice()
dev.openverify.sdk.flow.FlowCoordinatorTest#when the session cannot be read after an unreadable create either, the retry reads it first and never creates twice()
dev.openverify.sdk.flow.FlowNavigatorTest#a condition outside the supported subset is refused()
dev.openverify.sdk.flow.FlowNavigatorTest#a transition to a missing step is refused()
dev.openverify.sdk.flow.FlowNavigatorTest#a transition without a condition always applies()
dev.openverify.sdk.flow.FlowNavigatorTest#after the last step there is no next step()
dev.openverify.sdk.flow.FlowNavigatorTest#the context exposes the inquiry status for conditions()
dev.openverify.sdk.flow.FlowNavigatorTest#the first transition whose condition holds wins()
dev.openverify.sdk.flow.FlowNavigatorTest#transitions from other steps are ignored()
dev.openverify.sdk.flow.FlowNavigatorTest#when no condition holds the list order applies()
dev.openverify.sdk.flow.FlowNavigatorTest#without transitions the next step in the list runs()
dev.openverify.sdk.flow.JsonLogicTest#[1] false
dev.openverify.sdk.flow.JsonLogicTest#[1] true
dev.openverify.sdk.flow.JsonLogicTest#[1] {"<":[1,2]}
dev.openverify.sdk.flow.JsonLogicTest#[2] 1
dev.openverify.sdk.flow.JsonLogicTest#[2] null
dev.openverify.sdk.flow.JsonLogicTest#[2] {"if":[true,1,2]}
dev.openverify.sdk.flow.JsonLogicTest#[3] -0.5
dev.openverify.sdk.flow.JsonLogicTest#[3] 0
dev.openverify.sdk.flow.JsonLogicTest#[3] {"==":[1,1],"!=":[1,2]}
dev.openverify.sdk.flow.JsonLogicTest#[4] "0"
dev.openverify.sdk.flow.JsonLogicTest#[4] 0.0
dev.openverify.sdk.flow.JsonLogicTest#[4] {"var":{"var":"x"}}
dev.openverify.sdk.flow.JsonLogicTest#[5] ""
dev.openverify.sdk.flow.JsonLogicTest#[5] [0]
dev.openverify.sdk.flow.JsonLogicTest#[6] []
dev.openverify.sdk.flow.JsonLogicTest#[6] {}
dev.openverify.sdk.flow.JsonLogicTest#and and or return the deciding operand()
dev.openverify.sdk.flow.JsonLogicTest#literals evaluate to themselves()
dev.openverify.sdk.flow.JsonLogicTest#var gives null or the default for a missing path()
dev.openverify.sdk.flow.JsonLogicTest#var reads dotted paths()
dev.openverify.sdk.flow.JsonLogicTest#{"!!":[{"var":"tags"}]} -> true
dev.openverify.sdk.flow.JsonLogicTest#{"!":[{"var":"empty"}]} -> true
dev.openverify.sdk.flow.JsonLogicTest#{"!":true} -> false
dev.openverify.sdk.flow.JsonLogicTest#{"!=":[{"var":"inquiry.status"},"completed"]} -> true
dev.openverify.sdk.flow.JsonLogicTest#{"!==":[{"var":"inquiry.status"},"failed"]} -> false
dev.openverify.sdk.flow.JsonLogicTest#{"==":[1,"1"]} -> false
dev.openverify.sdk.flow.JsonLogicTest#{"==":[null,null]} -> true
dev.openverify.sdk.flow.JsonLogicTest#{"==":[{"var":"inquiry.status"},"completed"]} -> false
dev.openverify.sdk.flow.JsonLogicTest#{"==":[{"var":"inquiry.status"},"failed"]} -> true
dev.openverify.sdk.flow.JsonLogicTest#{"===":[{"var":"inquiry.attempts"},2.0]} -> true
dev.openverify.sdk.flow.JsonLogicTest#{"and":[true,{"==":[1,1]}]} -> true
dev.openverify.sdk.flow.JsonLogicTest#{"in":["ail",{"var":"inquiry.status"}]} -> true
dev.openverify.sdk.flow.JsonLogicTest#{"in":["b",{"var":"tags"}]} -> true
dev.openverify.sdk.flow.JsonLogicTest#{"in":["z",42]} -> false
dev.openverify.sdk.flow.JsonLogicTest#{"in":["z",{"var":"tags"}]} -> false
dev.openverify.sdk.flow.JsonLogicTest#{"or":[false,{"==":[1,2]}]} -> false
dev.openverify.sdk.flow.SelfieCaptureProtocolTest#a capture lives as long as the shared server constant says()
dev.openverify.sdk.flow.SelfieCaptureProtocolTest#the camera stays open for the whole capture, as the shared client constant says()
dev.openverify.sdk.flow.SelfieCaptureProtocolTest#the golden capture's guidance is the shared server thresholds and hold time()
dev.openverify.sdk.model.ContractFixturesTest#a session from a server before Phase 4 decodes without retention days or optional consent texts()
dev.openverify.sdk.model.ContractFixturesTest#an approved inquiry event decodes, and its payload decodes as an approved inquiry()
dev.openverify.sdk.model.ContractFixturesTest#an inquiry session never prints its client address or user agent()
dev.openverify.sdk.model.ContractFixturesTest#an inquiry session not started yet, or masked, decodes without its client()
dev.openverify.sdk.model.ContractFixturesTest#api/event-account-consolidated.json
dev.openverify.sdk.model.ContractFixturesTest#api/event-inquiry-approved.json
dev.openverify.sdk.model.ContractFixturesTest#api/flow-session.json
dev.openverify.sdk.model.ContractFixturesTest#api/inquiry-session.json
dev.openverify.sdk.model.ContractFixturesTest#api/inquiry-with-verifications.json
dev.openverify.sdk.model.ContractFixturesTest#api/inquiry.json
dev.openverify.sdk.model.ContractFixturesTest#api/problem.json
dev.openverify.sdk.model.ContractFixturesTest#api/verification-government-id.json
dev.openverify.sdk.model.ContractFixturesTest#api/verification-selfie.json
dev.openverify.sdk.model.ContractFixturesTest#api/webhook-event-inquiry-completed.json
dev.openverify.sdk.model.ContractFixturesTest#every fixture is either decoded by the SDK or listed as server-only, never both()
dev.openverify.sdk.model.ContractFixturesTest#every problems fixture has an expected reason or selfie capture code()
dev.openverify.sdk.model.ContractFixturesTest#flow-session decodes the inquiry, the flow, the verifications and the consent()
dev.openverify.sdk.model.ContractFixturesTest#flow-session gives the face template retention days that the matching consent text names (C42_3)()
dev.openverify.sdk.model.ContractFixturesTest#flow-session says which environment the session runs in (C19)()
dev.openverify.sdk.model.ContractFixturesTest#flows/default-gov-id-selfie.json
dev.openverify.sdk.model.ContractFixturesTest#government-id verification decodes its checks and included files()
dev.openverify.sdk.model.ContractFixturesTest#inquiry attributes never print the PII in fields()
dev.openverify.sdk.model.ContractFixturesTest#inquiry decodes kebab-case attributes and relationships()
dev.openverify.sdk.model.ContractFixturesTest#inquiry with verifications decodes included verifications and their checks()
dev.openverify.sdk.model.ContractFixturesTest#inquiry-session decodes its status, times, client and inquiry (C20)()
dev.openverify.sdk.model.ContractFixturesTest#problem decodes RFC 9457 members and validation errors()
dev.openverify.sdk.model.ContractFixturesTest#problems/selfie-capture-incomplete.json
dev.openverify.sdk.model.ContractFixturesTest#problems/selfie-capture-invalid.json
dev.openverify.sdk.model.ContractFixturesTest#problems/selfie-capture-limit.json
dev.openverify.sdk.model.ContractFixturesTest#problems/selfie-capture-required.json
dev.openverify.sdk.model.ContractFixturesTest#problems/session-canceled-inquiry-expired.json
dev.openverify.sdk.model.ContractFixturesTest#problems/session-canceled-inquiry-finished.json
dev.openverify.sdk.model.ContractFixturesTest#problems/session-canceled-inquiry-redacted.json
dev.openverify.sdk.model.ContractFixturesTest#selfie verification decodes without government-id attributes()
dev.openverify.sdk.model.ContractFixturesTest#the default template flow matches the flow the session serves()
dev.openverify.sdk.model.ContractFixturesTest#unknown keys are ignored at every level()
dev.openverify.sdk.model.ContractFixturesTest#webhook event decodes, and its payload decodes as an inquiry()
dev.openverify.sdk.model.SelfieCaptureModelTest#[1] -1
dev.openverify.sdk.model.SelfieCaptureModelTest#[1] 0
dev.openverify.sdk.model.SelfieCaptureModelTest#[1] E2eSyntheticNonce0000
dev.openverify.sdk.model.SelfieCaptureModelTest#[1] ver_01M5CJXHG07XPHF3HRM6NREDH9
dev.openverify.sdk.model.SelfieCaptureModelTest#[2] 1
dev.openverify.sdk.model.SelfieCaptureModelTest#[2] 600001
dev.openverify.sdk.model.SelfieCaptureModelTest#[2] E2eSyntheticNonce000000
dev.openverify.sdk.model.SelfieCaptureModelTest#[2] self_01M5CJXHG07XPHF3HRM6NREDHU
dev.openverify.sdk.model.SelfieCaptureModelTest#[3] 179999
dev.openverify.sdk.model.SelfieCaptureModelTest#[3] 9223372036854775807
dev.openverify.sdk.model.SelfieCaptureModelTest#[3] E2eSyntheticNonce0000/
dev.openverify.sdk.model.SelfieCaptureModelTest#[3] self_
dev.openverify.sdk.model.SelfieCaptureModelTest#[4] 
dev.openverify.sdk.model.SelfieCaptureModelTest#[4] 600000
dev.openverify.sdk.model.SelfieCaptureModelTest#[4] E2eSyntheticNonce0000=
dev.openverify.sdk.model.SelfieCaptureModelTest#no model prints the nonce or the camera label()
dev.openverify.sdk.model.SelfieCaptureModelTest#the SDK writes the submit body with exactly the golden member names()
dev.openverify.sdk.model.SelfieCaptureModelTest#the golden created capture decodes with the server's prompt order, its nonce and its guidance()
dev.openverify.sdk.model.SelfieCaptureModelTest#the golden submit body decodes into every member the SDK has()
dev.openverify.sdk.model.WireModelTest#a cancel reason a newer server adds decodes as UNKNOWN and keeps the code (C25)()
dev.openverify.sdk.model.WireModelTest#a file kind the SDK does not know is rejected()
dev.openverify.sdk.model.WireModelTest#a flow round-trips through JSON, including unsupported steps()
dev.openverify.sdk.model.WireModelTest#a known step type with a value this SDK cannot use decodes as Unsupported()
dev.openverify.sdk.model.WireModelTest#a problem keeps its machine-readable code (C10)()
dev.openverify.sdk.model.WireModelTest#a problem with only some RFC 9457 members still decodes()
dev.openverify.sdk.model.WireModelTest#a session from a server without environments decodes without one()
dev.openverify.sdk.model.WireModelTest#a step without a type is a malformed flow()
dev.openverify.sdk.model.WireModelTest#a step without an id is a malformed flow()
dev.openverify.sdk.model.WireModelTest#an UNKNOWN status is never sent back to a server()
dev.openverify.sdk.model.WireModelTest#an environment kind this SDK does not know decodes as UNKNOWN()
dev.openverify.sdk.model.WireModelTest#an inquiry session status this SDK does not know decodes as UNKNOWN()
dev.openverify.sdk.model.WireModelTest#each cancel reason decodes from its wire value (C25)()
dev.openverify.sdk.model.WireModelTest#event payloads never print the resource attributes()
dev.openverify.sdk.model.WireModelTest#flow steps keep their type name()
dev.openverify.sdk.model.WireModelTest#known statuses encode as their wire values()
dev.openverify.sdk.model.WireModelTest#needs_review is a known verification status that ends polling (C30_6)()
dev.openverify.sdk.model.WireModelTest#optional government-id restrictions decode when present()
dev.openverify.sdk.model.WireModelTest#statuses this SDK does not know decode as UNKNOWN()
dev.openverify.sdk.model.WireModelTest#verification types map from resource types()
dev.openverify.sdk.model.WireModelTest#{"id":"call","type":"video_call","provider":"example"}
dev.openverify.sdk.model.WireModelTest#{"id":"chip","type":"nfc","androidOnly":true}
dev.openverify.sdk.model.WireModelTest#{"id":"details","type":"form","fields":[{"type":"email","name":"email","labelKey":"x","required":true}]}
dev.openverify.sdk.mrz.BacKeySeedTest#Part 11 D-2 - 9-character document number is padded with a filler()
dev.openverify.sdk.mrz.BacKeySeedTest#Part 11 D-2 - document number longer than 9 characters is used in full()
dev.openverify.sdk.mrz.BacKeySeedTest#document number already padded as it appears in the MRZ gives the same result()
dev.openverify.sdk.mrz.BacKeySeedTest#error message does not echo the date, which is PII()
dev.openverify.sdk.mrz.BacKeySeedTest#rejects a document number with characters outside the MRZ character set()
dev.openverify.sdk.mrz.BacKeySeedTest#rejects an empty document number()
dev.openverify.sdk.mrz.BacKeySeedTest#rejects date of birth "69080" / date of expiry "940623"
dev.openverify.sdk.mrz.BacKeySeedTest#rejects date of birth "690806" / date of expiry "94-623"
dev.openverify.sdk.mrz.BacKeySeedTest#rejects date of birth "690806" / date of expiry "94062"
dev.openverify.sdk.mrz.BacKeySeedTest#rejects date of birth "690806" / date of expiry "9406A3"
dev.openverify.sdk.mrz.BacKeySeedTest#rejects date of birth "6908061" / date of expiry "940623"
dev.openverify.sdk.mrz.BacKeySeedTest#rejects date of birth "69O806" / date of expiry "940623"
dev.openverify.sdk.mrz.BacKeySeedTest#unknown parts of the date of birth are fillers that count as zero()
dev.openverify.sdk.mrz.MrzTest#"340712" has check digit 7
dev.openverify.sdk.mrz.MrzTest#"580225" has check digit 4
dev.openverify.sdk.mrz.MrzTest#"950712" has check digit 2
dev.openverify.sdk.mrz.MrzTest#"960108" has check digit 6
dev.openverify.sdk.mrz.MrzTest#"<<<<<<<<<<<<<<" has check digit 0
dev.openverify.sdk.mrz.MrzTest#"D23145890" has check digit 7
dev.openverify.sdk.mrz.MrzTest#"HA672242<" has check digit 6
dev.openverify.sdk.mrz.MrzTest#Part 3 Example 1 - date 520727 has check digit 3()
dev.openverify.sdk.mrz.MrzTest#Part 3 Example 2 - document number AB2134 padded with fillers has check digit 5()
dev.openverify.sdk.mrz.MrzTest#Part 3 Example 3 - TD3 composite check digit is 8()
dev.openverify.sdk.mrz.MrzTest#Part 3 Example 4 - TD1 composite check digit is 2()
dev.openverify.sdk.mrz.MrzTest#Part 3 Example 5 - TD2 composite check digit is 8()
dev.openverify.sdk.mrz.MrzTest#error message does not echo the field value, which may be PII()
dev.openverify.sdk.mrz.MrzTest#rejects "AB 2134"
dev.openverify.sdk.mrz.MrzTest#rejects "AB-2134"
dev.openverify.sdk.mrz.MrzTest#rejects "AB2134Ä"
dev.openverify.sdk.mrz.MrzTest#rejects "ab2134"
dev.openverify.sdk.mrz.MrzVectorsTest#every vector is read, once, and is of a kind a test below checks()
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p4-td3
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p4-td3
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p4-td3
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p5-td1
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p5-td1
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p5-td1
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p5-td1-long-document-number
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p5-td1-long-document-number
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p5-td1-long-document-number
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p6-td2
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p6-td2
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p6-td2
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p7-mrv-a
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p7-mrv-a
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p7-mrv-a
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p7-mrv-b
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p7-mrv-b
dev.openverify.sdk.mrz.MrzVectorsTest#icao-9303-p7-mrv-b
dev.openverify.sdk.mrz.MrzVectorsTest#mrva-document-number-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#mrva-document-number-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#mrva-document-number-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#mrva-expiration-date-letter-i
dev.openverify.sdk.mrz.MrzVectorsTest#td1-birth-date-check-digit-letter-z
dev.openverify.sdk.mrz.MrzVectorsTest#td1-birth-date-digit-for-digit
dev.openverify.sdk.mrz.MrzVectorsTest#td1-birth-date-letter-o
dev.openverify.sdk.mrz.MrzVectorsTest#td1-birth-date-letter-x
dev.openverify.sdk.mrz.MrzVectorsTest#td1-birth-date-two-letters
dev.openverify.sdk.mrz.MrzVectorsTest#td1-composite-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#td1-composite-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#td1-composite-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#td1-lower-case
dev.openverify.sdk.mrz.MrzVectorsTest#td1-name-digit-zero
dev.openverify.sdk.mrz.MrzVectorsTest#td1-short-line
dev.openverify.sdk.mrz.MrzVectorsTest#td1-stray-character
dev.openverify.sdk.mrz.MrzVectorsTest#td2-birth-date-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#td2-birth-date-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#td2-birth-date-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#td3-composite-letter-o
dev.openverify.sdk.mrz.MrzVectorsTest#td3-document-number-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#td3-document-number-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#td3-document-number-check-digit
dev.openverify.sdk.mrz.MrzVectorsTest#td3-document-number-letter-o
dev.openverify.sdk.mrz.MrzVectorsTest#td3-issuing-state-digit-zero
dev.openverify.sdk.ui.CameraPermissionGateTest#after a denial it points to Settings
dev.openverify.sdk.ui.CameraPermissionGateTest#allowing requests only the CAMERA permission
dev.openverify.sdk.ui.CameraPermissionGateTest#an already granted permission goes straight to the camera
dev.openverify.sdk.ui.CameraPermissionGateTest#once granted the camera content is shown
dev.openverify.sdk.ui.CameraPermissionGateTest#the user can stop instead
dev.openverify.sdk.ui.CameraPermissionGateTest#without permission it explains why before asking
dev.openverify.sdk.ui.CaptureScreenTest#a camera photo goes to the flow with what the camera reported about itself (C40_4)
dev.openverify.sdk.ui.CaptureScreenTest#a capture that allows uploads offers one, and the photo goes to the flow as picked
dev.openverify.sdk.ui.CaptureScreenTest#a capture that fails in any other way says so instead of crashing the app (1B F025)
dev.openverify.sdk.ui.CaptureScreenTest#a document prompt and a photo under review say nothing about the selfie time limit (4B H015)
dev.openverify.sdk.ui.CaptureScreenTest#a failed capture says so and keeps the preview
dev.openverify.sdk.ui.CaptureScreenTest#a photo under review is not being sent until the user keeps it
dev.openverify.sdk.ui.CaptureScreenTest#a photo under review replaces the preview and can be retaken or used
dev.openverify.sdk.ui.CaptureScreenTest#a picked file that is not a usable photo says so
dev.openverify.sdk.ui.CaptureScreenTest#a prompt that is not a restart says nothing about one
dev.openverify.sdk.ui.CaptureScreenTest#a selfie photo under review hides the live preview from screen readers
dev.openverify.sdk.ui.CaptureScreenTest#after a failed capture the next one can succeed
dev.openverify.sdk.ui.CaptureScreenTest#cancel reports that the user stopped
dev.openverify.sdk.ui.CaptureScreenTest#each prompt's title is a live region, so a screen reader announces the next pose
dev.openverify.sdk.ui.CaptureScreenTest#each selfie prompt says how long the user has to take the selfies, and what happens after (4B H015)
dev.openverify.sdk.ui.CaptureScreenTest#no upload is offered when the capture does not allow it, or there is no picker
dev.openverify.sdk.ui.CaptureScreenTest#no upload is offered without a picker
dev.openverify.sdk.ui.CaptureScreenTest#retry hints explain what to fix before the next photo
dev.openverify.sdk.ui.CaptureScreenTest#taking a photo hands it to the flow
dev.openverify.sdk.ui.CaptureScreenTest#the ID front shows the back camera preview, a document guide, its title and progress
dev.openverify.sdk.ui.CaptureScreenTest#the back of the ID has its own instructions
dev.openverify.sdk.ui.CaptureScreenTest#the camera stays open across a selfie's prompts and their review (C40_11)
dev.openverify.sdk.ui.CaptureScreenTest#the first prompt of a new capture says why the selfies are taken again (C40_4)
dev.openverify.sdk.ui.CaptureScreenTest#the selfie uses the front camera and an oval guide
dev.openverify.sdk.ui.CaptureScreenTest#while a pose is sent its photo stays, the screen says so, and no button can be pressed
dev.openverify.sdk.ui.ConsentScreenTest#a ticked optional box sends its key with the agreement
dev.openverify.sdk.ui.ConsentScreenTest#an optional box left unticked sends no key, and the user still continues
dev.openverify.sdk.ui.ConsentScreenTest#an optional text whose retention days the session does not give is not offered
dev.openverify.sdk.ui.ConsentScreenTest#cancel reports that the user stopped
dev.openverify.sdk.ui.ConsentScreenTest#continue is enabled only after the user agrees
dev.openverify.sdk.ui.ConsentScreenTest#each optional text shows with its own unticked checkbox and the session's retention days
dev.openverify.sdk.ui.ConsentScreenTest#shows only the texts the step lists
dev.openverify.sdk.ui.ConsentScreenTest#shows the title and every consent text of the step
dev.openverify.sdk.ui.ConsentScreenTest#the optional box alone does not let the user continue
dev.openverify.sdk.ui.ConsentScreenTest#while consent is being saved it cannot be sent twice
dev.openverify.sdk.ui.InquiryFlowScreenTest#a photo picked in the sandbox goes through the actions
dev.openverify.sdk.ui.InquiryFlowScreenTest#a photo under review is retaken or kept through the actions
dev.openverify.sdk.ui.InquiryFlowScreenTest#a sandbox session shows its banner above every screen
dev.openverify.sdk.ui.InquiryFlowScreenTest#capture waits for the camera permission
dev.openverify.sdk.ui.InquiryFlowScreenTest#consent accepts and cancels through the actions
dev.openverify.sdk.ui.InquiryFlowScreenTest#errors retry or finish through the actions
dev.openverify.sdk.ui.InquiryFlowScreenTest#finalizing shows the finalizing screen
dev.openverify.sdk.ui.InquiryFlowScreenTest#loading shows the loading screen
dev.openverify.sdk.ui.InquiryFlowScreenTest#outside the sandbox there is no banner
dev.openverify.sdk.ui.InquiryFlowScreenTest#processing shows the processing screen
dev.openverify.sdk.ui.InquiryFlowScreenTest#terminal screens finish the flow
dev.openverify.sdk.ui.InquiryFlowScreenTest#the optional consent keys the user ticked go through the actions (C42_3)
dev.openverify.sdk.ui.InquiryFlowScreenTest#the screens that end a session finish the flow
dev.openverify.sdk.ui.InquiryFlowScreenTest#the selfie step waits behind the camera permission and reports nothing before it is granted (4B H014)
dev.openverify.sdk.ui.InquiryFlowScreenTest#with the camera permission, photos go through the actions
dev.openverify.sdk.ui.InquiryFlowScreenTest#with the camera permission, the waiting selfie step reports the camera ready, once (4B H014)
dev.openverify.sdk.ui.MessagesTest#[1] NETWORK
dev.openverify.sdk.ui.MessagesTest#[2] SESSION_EXPIRED
dev.openverify.sdk.ui.MessagesTest#[3] INQUIRY_MISMATCH
dev.openverify.sdk.ui.MessagesTest#[4] REJECTED
dev.openverify.sdk.ui.MessagesTest#[5] OUT_OF_SYNC
dev.openverify.sdk.ui.MessagesTest#[6] SERVER
dev.openverify.sdk.ui.MessagesTest#[7] INVALID_RESPONSE
dev.openverify.sdk.ui.MessagesTest#[8] STILL_PROCESSING
dev.openverify.sdk.ui.MessagesTest#a consent text names the session's retention days in place of the days placeholder()
dev.openverify.sdk.ui.MessagesTest#a text that names the retention days is not offered when the session gives none()
dev.openverify.sdk.ui.MessagesTest#a text without the days placeholder is shown as it is()
dev.openverify.sdk.ui.MessagesTest#an unknown reason gets the generic message()
dev.openverify.sdk.ui.MessagesTest#each capture kind has its own title, instruction and photo description()
dev.openverify.sdk.ui.MessagesTest#every Phase 1 user-fixable reason has its own message()
dev.openverify.sdk.ui.MessagesTest#every reason a retry hint can carry has its own message (C29_4)()
dev.openverify.sdk.ui.MessagesTest#retry messages are listed once each, in order()
dev.openverify.sdk.ui.MessagesTest#terminal messages come from the step's message key()
dev.openverify.sdk.ui.MessagesTest#the consent texts the SDK can show are the default template's()
dev.openverify.sdk.ui.MessagesTest#the optional matching consent has its own checkbox label (C42_3)()
dev.openverify.sdk.ui.SpanishMessagesTest#consent is recorded with the language its texts were shown in
dev.openverify.sdk.ui.SpanishMessagesTest#every SDK plural has its own Spanish text, for one and for several (4B H015)
dev.openverify.sdk.ui.SpanishMessagesTest#every SDK string has its own Spanish text
dev.openverify.sdk.ui.SpanishMessagesTest#every reason a retry hint can carry reads in Spanish (C29_4)
dev.openverify.sdk.ui.StatusScreensTest#a canceled session has its own message
dev.openverify.sdk.ui.StatusScreensTest#a redacted inquiry says the verification is gone
dev.openverify.sdk.ui.StatusScreensTest#a refused one-time link says it was used
dev.openverify.sdk.ui.StatusScreensTest#a retryable error offers Try again and Close
dev.openverify.sdk.ui.StatusScreensTest#an error that cannot be retried only closes
dev.openverify.sdk.ui.StatusScreensTest#an expired inquiry says so and closes
dev.openverify.sdk.ui.StatusScreensTest#an expired session explains itself and only closes, with no retry
dev.openverify.sdk.ui.StatusScreensTest#an inquiry in review ends on the normal completion, with nothing to retry (C30_6)
dev.openverify.sdk.ui.StatusScreensTest#an unsupported flow explains it and closes
dev.openverify.sdk.ui.StatusScreensTest#completion shows the step's message and finishes on Done
dev.openverify.sdk.ui.StatusScreensTest#completion without a known message key still thanks the user
dev.openverify.sdk.ui.StatusScreensTest#failure shows the step's message and closes
dev.openverify.sdk.ui.StatusScreensTest#failure without a failure step shows the default message
dev.openverify.sdk.ui.StatusScreensTest#finalizing says the verification is being finished
dev.openverify.sdk.ui.StatusScreensTest#loading shows progress
dev.openverify.sdk.ui.StatusScreensTest#processing says the photos are being checked
dev.openverify.sdk.ui.StatusScreensTest#the sandbox banner names the sandbox
```
