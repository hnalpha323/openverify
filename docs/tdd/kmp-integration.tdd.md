# TDD evidence: KMP migration Stage 4, kmp-integration

- **Slice owner:** `kmp-integration` (KMP migration Workflow, Stage 4 of 4, alone in `android/`).
- **Date:** 2026-10-22.
- **Plan:** `docs/plans/kmp-migration.plan.md`: K9, the Stage 4 bullet of the Workflow, and the before and after table of K7 and Acceptance. The orchestrator made two changes to the bullet: it pushes and runs CI on GitHub itself after this stage, and it writes the `docs/PROGRESS.md` entry.
- **Paths owned:**
  - the ADR, `THIRD_PARTY_LICENSES.md`, `docs/PLAN.md` and `docs/plans/phase-5.plan.md`;
  - `android/openverify-nfc/README.md`, and in `CLAUDE.md` only the android command and the android layout row;
  - this file;
  - test-first fixes anywhere in `android/`, except the Gradle files, which only Stage 1 edits.
- **Owner's request behind the plan:** "we might need an iOS app later so make it in a language that we can easily port to iOS alongside Android".

**How the commands ran.** Every Gradle command ran in the foreground from `android/`, after `source scripts/env.sh`. Counted runs use `--rerun-tasks`. Output is trimmed to the lines that matter. The raw JUnit and Kover XML, the gate logs, the dependency trees and the scripts stay in the session scratchpad, outside git. Counts, the SHA-256 and the multiset comparison use the recipe in `docs/tdd/kmp-foundation.tdd.md`.

## 0. Starting point

Stage 3 ended at `5a2b084`. A first gate here reproduced it exactly:

```text
$ ./gradlew --rerun-tasks testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint :openverify-sdk:koverXmlReport
BUILD SUCCESSFUL in 1m 25s
192 actionable tasks: 192 executed
925 e13aecf2a4f469450994aa8564d89b2f7877c093448b476fbf307de41faa6eb0
skipped/failed/errored: none
baseline lines: 631 missing: 0 []
baseline classes with a different count: {}
total 98.11% (1816 / 1851)
demo 18 {DemoFormTest: 10, DemoViewModelTest: 6, MainActivityTest: 2}, none skipped or failed
```

## 1. The review pass (kotlin-reviewer)

**Method.** The `ecc:kotlin-review` skill delegates to the `kotlin-reviewer` agent. This stage runs as a subagent with no tool to start another, so the agent's checklist was applied by hand:

- architecture and module boundaries;
- coroutines and Flows: scopes, dispatchers, cancellation;
- Compose: state, effects, `remember` keys, stability;
- Kotlin idioms, Android pitfalls and security.

The review added the KMP questions the task names: the `expect`/`actual` surface, and anything in `commonMain` that compiles for iOS but could fail there.

**Scope.** All 130 files under `android/` that Stages 1 to 3 changed (`git diff --name-status -M 4be9b6b 5a2b084 -- android/`). Every main file not renamed at 100% was read in full, and every partial rename was diffed against its pre-migration original:

- `FlowHttp` against the OkHttp version;
- `CameraPermissionGate` against the permission code that moved out of it;
- `CaptureCamera.takePictureOrNull` against its old catch clauses;
- `fromOneTimeLink` against its `HttpUrl` code.

The project configures no detekt or ktlint, and adding either is a Gradle change, which this stage may not make.

**What was checked, and held:**

- **Forbidden imports.** `commonMain` and `commonTest` import no `okhttp3`, `okio`, `android.*`, `java.*`, `javax.*`, `R`, `androidx.compose.ui.res`, `androidx.activity` or `androidx.camera` (grep, no match). Their packages are Compose Multiplatform's common `androidx.compose`, the JetBrains `androidx.lifecycle`, Ktor, kotlinx, `kotlin.*` and `org.jetbrains.compose.resources`.
- **The `expect` surface.** There are exactly six internal `expect` declarations in main code, each with an Android and an iOS `actual`, and no `expect class`:
  - `isOutOfMemory` and `CAPTURE_MIRRORS_IMAGES`;
  - `PLATFORM_NAME` and `defaultFlowHttpClient`;
  - `rememberCameraPermission` and `decodePreviewBitmap`.

  `commonTest` has one, `outOfMemoryError()`, with actuals in `androidHostTest` and `iosTest`. `iosMain` holds only those actuals and the private shared Darwin client.
- **Cancellation.** No broad catch swallows it:
  - `takePictureOrNull` rethrows a `CancellationException` first.
  - `FlowHttp` catches only `kotlinx.io.IOException`, and on the JVM `CancellationException` is an `IllegalStateException`.
  - Its `runCatching` wraps a non-suspending decode.
  - `PickedPhotos.load` and the iOS decoder do not suspend.
  - `CameraXCaptureCamera` rethrows cancellation before its `catch (Exception)`.
- **Coroutines.** `InquiryViewModel` uses `viewModelScope`, which on iOS runs on `Dispatchers.Main`. `ReviewPhoto` decodes on `Dispatchers.Default` inside `produceState(image)`. The system photo picker reads on `Dispatchers.IO` with `rememberUpdatedState`. No `GlobalScope` and no `runBlocking` appear in main code.
- **Compose.** The Android `rememberCameraPermission` keeps the old gate's semantics:
  - a `remember`ed grant, re-read in `LifecycleResumeEffect`;
  - a `rememberSaveable` refusal;
  - a launcher from `rememberLauncherForActivityResult`, with the returned object keyed on `context` and `launcher`.

  Its getters read snapshot state, so the gate recomposes. `ConsentScreen` reads `openverify_locale` in the same composition as its texts.
- **Behaviour against the originals.** These keep their pre-migration behaviour:
  - the status mapping;
  - `x-request-id` with its problem fallback;
  - `Retry-After`;
  - the problem detection;
  - `takePictureOrNull`'s rethrow of every other `Error`;
  - `fromOneTimeLink`'s refusal of a link with user info.
- **Running on Kotlin/Native.** The common regexes (`FlowHttp.MEDIA_TYPE`, `DeviceLabel`, the ID formats, `BacKeySeed`) use only constructs Kotlin/Native's engine supports: classes, `\uXXXX`, `\s` and non-capturing groups. `DeviceLabel` spells out `\p{Cc}` for that reason. `String.lowercase`, `decodeToString` and `Char.isHighSurrogate` are locale-independent common APIs.

**Findings**, most severe first:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| R1 | MEDIUM | `ResourcesTest`, which the Phase 5 handoff relies on for new strings, does not catch texts that Compose Multiplatform renders wrongly. CMP 1.11.1 fills only `%N$s` and `%N$d`, so Android's `%d`, `%.1f` or `%%` reach the screen as written; Stage 3 met the first one. Its converter (`PrepareComposeResourcesKt.handleSpecialCharacters`, read with `javap`) unescapes only `\uXXXX`, `\n`, `\t` and `\\`, so an Android `\'` keeps its backslash. A Spanish text with other placeholders than its English text would also go unnoticed. No current string is affected | **Fixed test-first**, section 2 |
| R2 | MEDIUM (iOS, Phase 10) | `FlowHttpPlatform.ios.kt` builds the Darwin client with NSURLSession's default configuration, which has a URL cache and cookie storage. OkHttp had neither, and the flow API's responses carry no `Cache-Control: no-store` (only the dashboard routes set it), so GET responses of a session could be cached on the iOS disk | Not fixable test-first here: the Darwin engine runs only on iOS, and a RED cannot be seen failing on Linux. Recorded for Phase 10 in ADR 0004 and `docs/PLAN.md` §6 (an ephemeral configuration, or `no-store` on the flow API) |
| R3 | LOW (iOS, Phase 10) | `ReviewImage.ios.kt` does not close the Skia `Image` after copying it into the bitmap, so a decoded photo's native memory waits for the garbage collector | Same reason as R2. Recorded for Phase 10 (`Image.makeFromEncoded(bytes).use { … }`) |
| R4 | LOW | `commonMain` imports `kotlinx.io.Buffer` and `kotlinx.io.IOException`, and `iosMain` imports `org.jetbrains.skia.Image`, but both reach the build only transitively, through Ktor and Compose Multiplatform. `lifecycle-viewmodel-compose` is declared in `androidMain` and imported nowhere. `openverify-sdk/build.gradle.kts` still says Android resources hold "the strings until they move to composeResources" | Gradle changes; only Stage 1 edits Gradle. Reported as contract deviations |
| R5 | LOW | The CI floor is still 631 SDK host tests, so the 297 tests Stages 1 to 4 added could vanish unnoticed. That would happen, for example, if `commonTest` stopped running inside `testAndroidHostTest` | `ci.yml` is outside this stage's paths. Reported as a follow-up: raise the floor to 928 |
| R6 | INFO (Phase 10) | No Swift-facing API exists yet. Kotlin exceptions reach Swift only through `@Throws`, and `@Throws` on the shared `FlowApi` would make Java callers catch a checked exception. The SDK's `composeResources` must also be inside the iOS app bundle | Recorded for Phase 10 in ADR 0004 and `docs/PLAN.md` §6 |

No CRITICAL or HIGH finding.

## 2. R1 fixed test-first: the resource guards (`da3fcdf`, `c58664a`, `6d2c6a9`)

**The guards** (`ui.ResourcesTest`, JUnit 5, host; 4 tests become 7). They read the XML text of every string and plural item in `composeResources/values` and `values-es`, after XML decoding:

1. `every text uses only the placeholders Compose Multiplatform fills, %1$s and %1$d`: no format specifier other than `%N$s` and `%N$d`. A percent sign that starts no specifier, as in `100 %`, stays allowed, because CMP shows it as written.
2. `each Spanish text has the same placeholders as its English text`: per key, the set of `%N$x` placeholders is the same in both languages. The failure lists only the keys that differ.
3. `no text uses an Android escape that Compose Multiplatform would show as it is`: once the escapes CMP reads (`\uXXXX`, `\n`, `\t`, `\\`) are removed, no backslash remains.

The XML parsing of the existing tests and the new ones shares one helper, `resourceElements`.

**RED.** These are guards over strings that are all correct today. They passed on the real strings, then each failed on a temporary mutant of a strings file. The file was copied to the scratchpad and back; `git status` afterwards showed only the test file:

```text
$ ./gradlew --offline :openverify-sdk:testAndroidHostTest --tests '*.ui.ResourcesTest' --tests '*.ui.SpanishMessagesTest'
real strings:                      7 tests, 0 failed
M1 es "Foto %1$d de %d"            FAILED every text uses only the placeholders … :: expected: <[]> but was: <[values-es/openverify_capture_progress: Foto %1$d de %d]>
                                   FAILED each Spanish text has the same placeholders … :: <[openverify_capture_progress: en [%1$d, %2$d], es [%1$d]]>
M2 es "Foto %1$d"                  FAILED each Spanish text has the same placeholders … :: <[openverify_capture_progress: en [%1$d, %2$d], es [%1$d]]>
M3 en "We couldn\'t find the lines" FAILED no text uses an Android escape … :: <[values/openverify_retry_mrz_not_found: We couldn\'t find the lines of letters, …]>
M4 es "… (100%%)"                  FAILED every text uses only the placeholders … :: <[values-es/openverify_capture_progress: Foto %1$d de %2$d (100%%)]>
M5 es "… (%.1f)"                   FAILED every text uses only the placeholders … :: <[values-es/openverify_capture_progress: Foto %1$d de %2$d (%.1f)]>
P1 es "… (100 %)"                  7 + 4 tests, 0 failed   (a lone percent sign is shown as written, so it is allowed)
```

**The defect class is real.** With M3 and then M4 in place, `convertXmlValueResourcesForCommonMain` built the resources the SDK ships. The entries of `strings.commonMain.cvr`, base64-decoded, hold the backslash and the doubled percent sign as written, where Android resources showed `couldn't` and `100%`:

```text
string openverify_retry_mrz_not_found -> We couldn\'t find the lines of letters, numbers and <<< signs on your ID. …
string openverify_capture_progress -> Foto %1$d de %2$d (100%%)
```

**The first version and the refactor.** `da3fcdf` refused every `%` that did not start a positional placeholder. Writing the strings header showed that this also refused a literal `100 %`, which CMP renders correctly. `c58664a` narrowed it to format specifiers, then reran M1, M4, M5 (refused) and P1 (accepted). `6d2c6a9` documents the three rules in the English strings header, comments only.

No main code changed in this stage. Since `5a2b084`, `git diff --stat` shows nothing in `commonMain/kotlin`, `androidMain`, `iosMain` or the Gradle files, so the public API is Stage 3's: no Kotlin-public class changed since the baseline, except decision 7's `FlowApiClient`.

## 3. K9: the documents

| Commit | What |
|---|---|
| `193e6e2` | `docs/adr/0004-mobile-kotlin-multiplatform.md`. It covers the context, decisions K1 to K5 with the six `expect` seams, the alternatives (Flutter or React Native, a Swift SDK, KMP logic with SwiftUI, a module split, an interface over OkHttp and NSURLSession, `androidTarget()`, CMP 1.12, Material3 alpha, punycode), the consequences (CI, macOS cost, cinterop isolation, string rules, locale, wire differences, licences), the Phase 10 checks from the review, the plan as built (the stages' departures) and the results |
| `b3bc508` | `THIRD_PARTY_LICENSES.md`. §1 gains the Kotlin/Native toolchain, as build-only tooling. §2.1 gains a new §2.1.6 with every runtime artifact the migration added, Android and iOS, plus the build plugins and the test-scope `kotlin-test` and `ktor-client-mock`. The OkHttp row becomes the Ktor engine. §2.2 gains NFCPassportReader 2.3.3 with OpenSSL-Package, and Burst 2.14.0 |
| `dbc1467` | `docs/PLAN.md`. §3 gains the iOS line in the diagram, the KMP layout row and a "Mobile SDK" choice. §6 Phase 10 gains the iOS work and macOS CI. §8's android command was stale: `testDebugUnitTest` no longer reaches the SDK. It becomes K8's. §9 gains the iOS parity and macOS cost risk |
| `59ca3e1` | `docs/plans/phase-5.plan.md`. A "## Amendment from the Kotlin Multiplatform migration" section follows the Starting point. In place: C64.2 is K9's text, C52.7's `ContractFixturesTest` sits in `src/androidHostTest`, Stage 1a's Android retry strings go to `composeResources`, `android-5a` and `clients-5b` put new code in `commonMain` unless platform-specific, and the Validation line is K8's command |
| `6583969` | `android/openverify-nfc/README.md`: the module stays Android only, iOS reads the chip through CoreNFC with NFCPassportReader in Phase 10, and `BacKeySeed` is common code for both readers |
| `5bf5409` | `CLAUDE.md`, only its android command (K8's) and its android layout row (decision 9) |

`docs/PROGRESS.md` is the orchestrator's to write; its facts are in this stage's report. The migration plan itself (`docs/plans/kmp-migration.plan.md`) is not among this stage's paths. Its "as built" departures, gathered from the three earlier evidence files, are recorded in the ADR's "As built" section.

## 4. Dependencies and licences

The licence rows come from the resolved dependency trees, not from the reports alone:

1. `./gradlew :openverify-sdk:dependencies` for `androidRuntimeClasspath`, `androidHostTestRuntimeClasspath`, `iosArm64CompileKlibraries` and `iosArm64TestCompileKlibraries`, flattened to resolved versions.
2. A comparison with the pre-migration trees: Stage 1's `releaseRuntimeClasspath` and a fresh `debugUnitTestRuntimeClasspath` of the `4be9b6b` tree.
   - **Android runtime:** 62 entries are new or changed. 57 are new: Ktor, kotlinx-io, the SLF4J API, kotlinx-coroutines-slf4j, CMP and the JetBrains forks, counting their `-jvm` and `-android` variants. The other 5 are the androidx.savedstate artifacts, which moved from 1.3.2 to 1.4.0. Nothing was removed.
   - **Host tests:** the only additions are `ktor-client-mock` 3.5.2, `kotlin-test` and `kotlin-test-junit5` 2.4.21. Every other test artifact is unchanged.
   - **iOS klibs:** 116 entries, 62 of them without their per-platform variants. They include some the earlier reports did not name: `androidx.compose.runtime` 1.11.2, which CMP's runtime resolves to on iOS; androidx `annotation` 1.9.1, `collection` 1.5.0 and `lifecycle` 2.9.4; `ktor-network-tls`; and CMP `ui-uikit`.
3. Each new artifact's licence was read from its POM, or its parent POM, in the Gradle cache. All are Apache-2.0, except the SLF4J API, which is MIT. Each release date not in an earlier report was read from the repository's `Last-Modified`; all are at least 14 days old. The newest is ktor-network-tls 3.5.2, released on 2026-07-31.
4. The skiko 0.144.6 iOS klib is 53 MB, and it **statically links** `libskia`, `libicu`, `libharfbuzz`, `libexpat`, `libjpeg`, `libpng`, `libwebp`, `libzlib`, `libpiex` and `libdng_sdk` (`unzip -l`). Its row names them, with their expected licences to verify when the Phase 10 app links them.

## Before and after

**SDK host tests per class.** "Baseline" is the K7 baseline before any change. The other columns are each stage's final counted gate, and "Final" is this stage's. Every one of the 631 baseline lines is present in the final results (multiset containment, 0 missing), and every baseline class keeps its count. Nothing was skipped, failed or errored in any run.

| Class (under `dev.openverify.sdk`) | Baseline (`4be9b6b`) | Stage 1 (`1054236`) | Stage 2 (`4e1280c`) | Stage 3 (`5a2b084`) | Final (Stage 4) |
|---|---|---|---|---|---|
| `InquiryResultsTest` | 24 | 24 | 24 | 24 | 24 |
| `InquiryViewModelTest` | 16 | 16 | 16 | 16 | 16 |
| `OpenVerifyInquiryActivityTest` | 10 | 10 | 10 | 10 | 10 |
| `OpenVerifyInquiryContractTest` | 11 | 11 | 11 | 11 | 11 |
| `OpenVerifyInquiryOneTimeLinkTest` | 16 | 16 | 16 | 16 | 16 |
| `OpenVerifyInquiryRequestTest` | 8 | 8 | 8 | 8 | 8 |
| `api.ApiBaseUrlParityTest` | – | – | 122 | 122 | 122 |
| `api.ApiBaseUrlTest` | – | – | 13 | 13 | 13 |
| `api.FlowApiClientContractTest` | – | – | 19 | 19 | 19 |
| `api.FlowApiClientTest` | 75 | 75 | 75 | 75 | 75 |
| `api.JsonMediaTypeParityTest` | – | – | 35 | 35 | 35 |
| `api.OkHttpTransportTest` | – | – | 5 | 5 | 5 |
| `api.OneTimeLinkClientContractTest` | – | – | 4 | 4 | 4 |
| `api.OneTimeLinkClientTest` | 6 | 6 | 6 | 6 | 6 |
| `api.OneTimeLinkFlowApiTest` | 5 | 5 | 5 | 5 | 5 |
| `api.OneTimeLinksParityTest` | – | – | 50 | 50 | 50 |
| `api.OneTimeLinksTest` | – | – | 8 | 8 | 8 |
| `camera.CameraFactsTest` | 16 | 16 | 16 | 16 | 16 |
| `camera.CaptureCameraTest` | 8 | 8 | 8 | 8 | 8 |
| `camera.CapturePlatformTest` | – | 2 | 2 | 2 | 2 |
| `camera.CapturedImageTest` | 7 | 7 | 7 | 7 | 7 |
| `camera.DeviceLabelTest` | – | 7 | 7 | 7 | 7 |
| `camera.ImageEncodingTest` | 6 | 6 | 6 | 6 | 6 |
| `camera.LensFacingTest` | – | 4 | 4 | 4 | 4 |
| `camera.PickedPhotosTest` | 12 | 12 | 12 | 12 | 12 |
| `camera.TakePictureOrNullTest` | – | 5 | 5 | 5 | 5 |
| `flow.FlowCoordinatorTest` | 114 | 114 | 114 | 114 | 114 |
| `flow.FlowNavigatorTest` | 9 | 9 | 9 | 9 | 9 |
| `flow.JsonLogicTest` | 36 | 36 | 36 | 36 | 36 |
| `flow.SelfieCaptureProtocolTest` | 3 | 3 | 3 | 3 | 3 |
| `model.ContractFixturesTest` | 37 | 37 | 37 | 37 | 37 |
| `model.SelfieCaptureModelTest` | 19 | 19 | 19 | 19 | 19 |
| `model.WireModelTest` | 23 | 23 | 23 | 23 | 23 |
| `mrz.BacKeySeedTest` | 13 | 13 | 13 | 13 | 13 |
| `mrz.MrzTest` | 17 | 17 | 17 | 17 | 17 |
| `mrz.MrzVectorsTest` | 44 | 44 | 44 | 44 | 44 |
| `ui.CameraPermissionGateTest` | 6 | 6 | 6 | 6 | 6 |
| `ui.CameraPermissionTest` | – | – | – | 8 | 8 |
| `ui.CaptureScreenTest` | 24 | 24 | 24 | 24 | 24 |
| `ui.ConsentLocaleTest` | – | – | – | 3 | 3 |
| `ui.ConsentScreenTest` | 10 | 10 | 10 | 10 | 10 |
| `ui.InquiryFlowScreenTest` | 16 | 16 | 16 | 16 | 16 |
| `ui.MessagesTest` | 19 | 19 | 19 | 19 | 19 |
| `ui.PreviewBitmapTest` | – | – | – | 3 | 3 |
| `ui.ResourcesTest` | – | – | – | 4 | 7 |
| `ui.SpanishMessagesTest` | 4 | 4 | 4 | 4 | 4 |
| `ui.StatusScreensTest` | 17 | 17 | 17 | 17 | 17 |
| `ui.UnavailableCameraPermissionTest` | – | – | – | 2 | 2 |
| **Total** | **631** | **649** | **905** | **925** | **928** |
| Classes | 31 | 35 | 43 | 48 | 48 |

Full-list SHA-256 at each stage:

| Run | SHA-256 |
|---|---|
| Baseline | `9b4c22f495dfab8c38e5106193e473d03a710b17d41164c694f0dae842d9a8b6` |
| Stage 1 | `34200f345ed4079bb63b08fded4b941bcf0aee2e7f21c8c60f6a690e73f56715` |
| Stage 2 | `36bf30aab5ce3bb522e6c698cd05c2410061ce521d372e622709f2d1203130c7` |
| Stage 3 | `e13aecf2a4f469450994aa8564d89b2f7877c093448b476fbf307de41faa6eb0` |
| Final | `cc9ba30e7ee1092aea18849a6e3bd3c5912c327f48fa8e12f96cf0a894591030` |

**Other suites.**

| Suite | Baseline | Final |
|---|---|---|
| `demo-app` | 18 in 3 classes (`DemoFormTest` 10, `DemoViewModelTest` 6, `MainActivityTest` 2) | the same 18, none skipped; `demo-app` sources unchanged since `4be9b6b` |
| Device test | 1, `CameraXCaptureCameraTest` (`src/androidTest`) | 1, the same class in `src/androidDeviceTest`. It runs on the CI emulator, which the orchestrator triggers |
| iOS tests | none | `iosTest`: `IosFlowHttpPlatformTest` 2 and `IosPreviewBitmapTest` 2, plus the out-of-memory actual. They compile on Linux and run from Phase 10 |

**Kover line coverage** (`koverXmlReport`, with the same rule and exclusions, plus `dev.openverify.sdk.generated.resources.*` since Stage 1):

| Package (under `dev.openverify.sdk`) | Baseline (`4be9b6b`) | Stage 1 | Stage 2 | Stage 3 | Final (Stage 4) |
|---|---|---|---|---|---|
| root | 98.77% (161 / 163) | 98.77% (161 / 163) | 98.70% (152 / 154) | 98.71% (153 / 155) | 98.71% (153 / 155) |
| `api` | 98.35% (239 / 243) | 98.35% (239 / 243) | 99.38% (481 / 484) | 99.38% (481 / 484) | 99.38% (481 / 484) |
| `camera` | 96.77% (90 / 93) | 97.06% (99 / 102) | 97.06% (99 / 102) | 97.06% (99 / 102) | 97.06% (99 / 102) |
| `flow` | 98.86% (433 / 438) | 98.86% (433 / 438) | 98.86% (433 / 438) | 98.86% (433 / 438) | 98.86% (433 / 438) |
| `model` | 98.74% (472 / 478) | 98.74% (472 / 478) | 98.74% (472 / 478) | 98.74% (472 / 478) | 98.74% (472 / 478) |
| `mrz` | 100.00% (17 / 17) | 100.00% (17 / 17) | 100.00% (17 / 17) | 100.00% (17 / 17) | 100.00% (17 / 17) |
| `ui` | 90.70% (156 / 172) | 90.70% (156 / 172) | 90.70% (156 / 172) | 90.96% (161 / 177) | 90.96% (161 / 177) |
| **Total** | **97.76% (1568 / 1604)** | **97.77% (1577 / 1613)** | **98.10% (1810 / 1845)** | **98.11% (1816 / 1851)** | **98.11% (1816 / 1851)** |

**Shared code.** `commonMain` holds 43 of the 59 main Kotlin files and 4,675 of their 5,568 lines (84.0%). `androidMain` holds 12 files and 839 lines; `iosMain` 4 files and 54 lines.

**Build times** on this machine with warm Gradle and konan caches:

| Run | Time | Tasks |
|---|---|---|
| Baseline gate, with `koverXmlReport` | 1 min 37 s | 83 |
| This stage's start, with `koverXmlReport` | 1 min 25 s | 192 |
| This stage's final gate | 1 min 22 s | 191 |

## Final gate

At `5bf5409`, with only this file still to commit:

```text
$ (cd android && ./gradlew --rerun-tasks testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 1m 22s
191 actionable tasks: 191 executed
928 cc9ba30e7ee1092aea18849a6e3bd3c5912c327f48fa8e12f96cf0a894591030
skipped/failed/errored: none
baseline lines: 631 missing: 0 []
baseline classes with a different count: {}
demo: 18 tests, 3 classes, 0 skipped/failed/errored
$ bash <the android job's floor step, extracted from ci.yml>     # run in android/ on these results
SDK host tests: 928 in 48 classes, 0 skipped, 0 failed; the floor is 631
$ for t in infra/tests/*.test.sh; do bash "$t"; done             # compose.test.sh with --static-only
apps-image-context 8 passed, 0 failed; check-connected-results 11 passed, 0 failed; ci-workflow 149 passed, 0 failed, 0 skipped
compose (static) 166 passed, 0 failed; install-gitleaks 9 passed, 0 failed; pre-commit-hook 11 passed, 0 failed
$ ~/.local/bin/gitleaks git --redact .
1495 commits scanned. no leaks found
$ pnpm format:check
All matched files use Prettier code style!
$ (cd services/vision && uv run pytest tests/test_ocr_notice.py)   # it parses THIRD_PARTY_LICENSES.md
11 passed
```

The pytest run printed "Required test coverage of 80% not reached". That gate is configured for the whole vision suite and does not apply to one file; all 11 tests passed.

- **Compiles.** `assemble` ran `compileCommonMainKotlinMetadata`, `compileIosMainKotlinMetadata`, `compileKotlinIos{Arm64,SimulatorArm64}` and `compileTestKotlinIos{Arm64,SimulatorArm64}`, and built `openverify-sdk.aar`.
- **Lint.** `lint` and `lintAndroidMain` passed.
- **Warnings.** The only Kotlin warnings are Stage 1's 11 `KLIB loader: The same 'unique_name' …` notices.
- **Not run here.** The emulator job and CI on GitHub run after this stage, triggered by the orchestrator.

## Decisions and departures (for the plan)

1. **R1's guards live in `ResourcesTest`**, beside the completeness tests that Phase 5 already relies on. Their RED is temporary mutants, the pattern Stage 1 used for its guards, because every current string passes them.
2. **The as-built departures of Stages 1 to 3 are recorded in ADR 0004's "As built" section.** `docs/plans/kmp-migration.plan.md` is not among this stage's paths, so the plan text still carries "616" and the original file names.
3. **`docs/PLAN.md` §8's android command** was not in K9's list. It was stale, because `testDebugUnitTest` no longer runs the SDK's tests, so it now reads as K8's command, as the Phase 5 Validation line does.
4. **No Gradle change** was made (rule 3). The four Gradle items of R4 are reported for the orchestrator.

## Follow-ups

- **CI:** raise the SDK host-test floor in `ci.yml` from 631 to 928 (R5), and validate both Android jobs on GitHub. The second item is the orchestrator's.
- **Gradle** (a later slice that owns it):
  - declare `kotlinx-io-core` in `commonMain`, and skiko, or rely on CMP's `ui-graphics` API, in `iosMain`;
  - drop `lifecycle-viewmodel-compose` from `androidMain`;
  - update the `androidResources` comment;
  - consider detekt or ktlint, which the kotlin-review skill expects and this build lacks.
- **Phase 10:** R2 (the Darwin session's cache and cookies, or `Cache-Control: no-store` on the flow API), R3 (close the Skia image), R6 (Swift-facing errors, `composeResources` in the app bundle), and the rest of `docs/PLAN.md` §6.
- **The plan file:** fold the ADR's "As built" list into `docs/plans/kmp-migration.plan.md` if the plan is to stay the reference.
