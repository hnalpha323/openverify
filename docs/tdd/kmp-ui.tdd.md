# TDD evidence: KMP migration Stage 3, kmp-ui

- **Slice owner:** `kmp-ui` (KMP migration Workflow, Stage 3 of 4, alone in `android/`).
- **Date:** 2026-10-22.
- **Plan:** `docs/plans/kmp-migration.plan.md`: K3 (the platform boundaries), K5 (strings and locale), the S3 rows of K2 and the iOS placeholders, and the Stage 3 bullet of the Workflow.
- **Paths owned:** `ui/**`, `camera/**`, `InquiryViewModel*.kt`, `InquiryOutcomes.kt`, `InquiryResults.kt`, `OpenVerifyInquiryActivity.kt`, `composeResources/**`, `androidMain/res/**`, their tests and this file. K5 also needed a one-parameter change to `flow/FlowCoordinator.acceptConsent` (see Decisions).
- **Owner's request behind the plan:** "we might need an iOS app later so make it in a language that we can easily port to iOS alongside Android".

**How the commands ran.** Every Gradle command ran in the foreground from `android/`, after `source scripts/env.sh`. Counted runs use `--rerun-tasks`. Output is trimmed to the lines that matter. The raw JUnit and Kover XML, the gate logs and the public API listings stay in the session scratchpad, outside git. Counts, the SHA-256 and the multiset comparison use the recipe in `docs/tdd/kmp-foundation.tdd.md`.

## 0. Starting point

Stage 2 ended at `4e1280c`. A first gate here reproduced it:

```text
$ ./gradlew --rerun-tasks testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint :openverify-sdk:koverXmlReport
real 1m28s
905 tests in 43 classes; sha256 36bf30aab5ce3bb522e6c698cd05c2410061ce521d372e622709f2d1203130c7; 0 skipped/failed/errored
baseline lines: 631, missing: 0; baseline classes with a different count: {}
Kover total 98.10% (1810 / 1845)
```

Two facts about Compose Multiplatform 1.11.1 resources were read from its Android classes with `javap` before any change:

- **Formatting.** `StringResourcesUtilsKt.SimpleStringFormatRegex` is `%(\d+)\$[ds]`, so `stringResource` and `getString` replace only positional arguments. The selfie time-limit plural used a bare `%d`.
- **Locale.** `ResourceEnvironment_androidKt.getSystemEnvironment()` reads `Locale.getDefault()`. In a composition, `DefaultComposeEnvironment` reads `androidx.compose.ui.text.intl.Locale.current`, which follows the same default on Android.

The SDK's `R` class is non-transitive: `R.string` (111), `R.plurals` (1) and `R.style.OpenVerify_Theme`.

## 1. The consent locale (K5)

**RED** (`d7ee86a`). `ui.ConsentLocaleTest` (Robolectric) runs the real chain. `InquiryFlowScreen` on the consent step goes to `InquiryViewModel`, then `FlowCoordinator`, then `FakeFlowApi`, which records the locale the server receives. Its view model is built with a different `Settings.locale` from the language shown, as after a language change:

1. a Spanish screen (`@Config(qualifiers = "es")`) of a flow started in `en` must send `es`;
2. an English screen of a flow started in `es` must send `en`;
3. a consent sent again after a 503 keeps the language its texts were shown in.

The labels are written out ("Continuar", "Volver a intentarlo"), so each test proves which language the screen showed. A first run timed out in `waitUntil`. A temporary print of `api.calls` showed that only `waitForIdle()` runs the main looper, where the view model calls the server. With that fix, all three failed for the intended reason:

```text
$ ./gradlew :openverify-sdk:testAndroidHostTest --tests '*.ConsentLocaleTest'
3 tests completed, 3 failed
a Spanish consent screen records the consent in es, though the flow started in en :: ComparisonFailure: expected:<e[s]> but was:<e[n]>
an English consent screen records the consent in en, though the flow started in es :: ComparisonFailure: expected:<e[n]> but was:<e[s]>
a consent sent again after an error keeps the language its texts were shown in :: ComparisonFailure: expected:<e[s]> but was:<e[n]>
```

**GREEN** (`7bb24fe`). The locale now travels with the agreement:

- `ConsentScreen` reads `openverify_locale` in the same composition as its texts and calls `onAccept(optionalTextKeys, locale)`.
- `FlowActions.acceptConsent(optionalTextKeys, locale: String? = null)` passes it on, and `InquiryViewModel` forwards it.
- `FlowCoordinator.acceptConsent(optionalTextKeys, locale)` records `locale ?: settings.locale`, and its retry closure keeps that locale.
- `Settings.locale` is only a fallback now. The activity no longer reads the locale, and `InquiryViewModel.factory(launch)` takes none.
- Two test files changed signatures, and no test case changed: `RecordingActions.acceptConsent` takes the new parameter, and `ConsentScreenTest`'s one `show()` lambda became `{ optional, _ -> }`.

Results: 908 tests passed, with 0 baseline lines missing and the iOS klib compiling. A temporary mutant made the retry closure send `settings.locale`, and `a consent sent again after an error …` failed (3 tests, 1 failed). The file was then restored.

## 2. The strings move to Compose Multiplatform resources (K5)

**RED** (`ff829fb`). `ui.ResourcesTest` (JUnit 5) has four tests:

1. The English and Spanish files of `src/commonMain/composeResources` define the same strings and plurals, and they are not empty.
2. `Res.allStringResources` and `Res.allPluralStringResources` hold exactly those names.
3. No string or plural remains an Android resource that would be merged into the host app.
4. Every Android resource name in the SDK's `R` starts with `OpenVerify_` or `openverify_`. The KMP DSL has no `resourcePrefix`, so this test takes its place.

```text
$ ./gradlew :openverify-sdk:testAndroidHostTest --tests '*.ui.ResourcesTest'
4 tests completed, 3 failed
every English string and plural has a Spanish one, … :: no strings in src/commonMain/composeResources/values ==> expected: <true> but was: <false>
Res holds every string and plural the resource files define, … :: Res has no strings ==> expected: <true> but was: <false>
the SDK merges no string into the host app's Android resources :: expected: <[]> but was: <[openverify_camera_allow, openverify_camera_denied, …
every Android resource … starts with OpenVerify or openverify_ :: passed (a guard; see the mutants)
```

**Refactor before the move** (`388e0c7`). The plural's `%d` became `%1$d` in English and Spanish. Android formats both the same: `CaptureScreenTest` (24 tests, including the exact sentence "Take all your selfies within 3 minutes. …") and `SpanishMessagesTest` (4) stayed green. Compose Multiplatform needs the positional form. With `%d` put back temporarily after the move, the screen showed the placeholder itself:

```text
CaptureScreenTest > each selfie prompt says how long the user has to take the selfies, … FAILED
ComparisonFailure: expected:<...your selfies within [3] minutes. If the tim...> but was:<...your selfies within [%d] minutes. If the tim...>
```

**GREEN** (`d73b891`). `git mv` moved both `strings.xml` files to `commonMain/composeResources/values{,-es}/`, as `R100` renames: `git log --follow` reaches back to Workflow 4B. The code changes:

- Every `R.string` or `R.plurals` became `Res.string` or `Res.plurals`. The calls use the multiplatform `stringResource` and `pluralStringResource`, in the screens and in `CameraXCaptureCamera`.
- `Messages` returns `StringResource`: `ConsentTexts`, the retry, completion, failure and error messages, and `CaptureCopy`.

The tests changed only as K5 lists:

- `text(R.string.x)` became `text(Res.string.x)`, backed by `runBlocking { getString(res) }`, in `ConsentScreenTest`, `CameraPermissionGateTest`, `CaptureScreenTest`, `InquiryFlowScreenTest`, `StatusScreensTest` and `OpenVerifyInquiryActivityTest`. The plural uses `getPluralString`.
- `MessagesTest` compares `StringResource` values.
- `SpanishMessagesTest` reads `Res.allStringResources` and `Res.allPluralStringResources`, and switches `Locale.setDefault` between `es` and `en` in try/finally. It keeps its four tests, names and assertions.

Results: 912 tests passed, with 0 baseline lines missing. `lint` passed. The demo APK ships the SDK's strings as `assets/composeResources/dev.openverify.sdk.generated.resources/values{,-es}/strings.commonMain.cvr`. Afterwards (`3010136`), only the English file's header comments changed: they no longer name lint's MissingTranslation, and they mention positional arguments.

## 3. The platform seams (K3)

**Stub** (`820e963`). It adds:

- the common `CameraPermission` interface (`available`, `granted`, `denied`, `request()`, `openSettings()`) and `CameraPermission.Unavailable`;
- `expect fun rememberCameraPermission()` and `expect fun decodePreviewBitmap(bytes): ImageBitmap?`;
- inert Android actuals and an inert iOS decoder. The iOS `rememberCameraPermission` is already the final placeholder: it returns `Unavailable`.

`CameraPermissionGate` takes a `permission` argument that it does not read yet. All 912 tests passed, and the common and iOS compiles succeeded.

**RED** (`7bdaece`). The tests:

- **`ui.CameraPermissionTest`** (Robolectric, 8 tests). Through the real Activity Result API, the permission asks for CAMERA only, records a grant and a refusal, and opens `ACTION_APPLICATION_DETAILS_SETTINGS` for the package. A permission already held is granted at once, and one granted in Settings is seen on resume (`moveToState(STARTED)`, then `RESUMED`). The gate given `Unavailable` says "We could not start the camera on this device.", offers no Allow and only lets the user stop.
- **`ui.PreviewBitmapTest`** (Robolectric, native graphics, 3 tests). A 32×20 JPEG and a hand-written 2×3 PNG decode to bitmaps of their size, and three garbage bytes decode to nothing.
- **`ui.UnavailableCameraPermissionTest`** (`commonTest`, 2 tests). The placeholder never claims a camera or a refusal, whatever is asked.
- **`ui.IosPreviewBitmapTest`** (`iosTest`, 2 tests). It decodes the same PNG; it compiles on Linux and runs from Phase 10.

```text
$ ./gradlew --continue :openverify-sdk:compileTestKotlinIosArm64 :openverify-sdk:compileTestKotlinIosSimulatorArm64 :openverify-sdk:testAndroidHostTest
> Task :openverify-sdk:compileTestKotlinIosArm64
> Task :openverify-sdk:compileTestKotlinIosSimulatorArm64
925 tests completed, 9 failed
CameraPermissionTest > request asks the system for the CAMERA permission only :: NullPointerException: … getLastRequestedPermission() …
CameraPermissionTest > openSettings opens this app's page in the system settings :: NullPointerException: getNextStartedActivity(...) must not be null
CameraPermissionTest > a granted request grants the camera / a refused request is denied :: NullPointerException: … "$request" is null
CameraPermissionTest > a permission granted before the screen opens is granted at once / … granted in Settings is seen when the screen comes back :: AssertionError
CameraPermissionTest > on a platform without a camera the gate says so, … :: Failed: assertExists. … could not find any node …
PreviewBitmapTest > a JPEG photo decodes to a bitmap of its size :: expected:<(32, 20)> but was:<null>
PreviewBitmapTest > a PNG decodes to a bitmap of its size :: expected:<(2, 3)> but was:<null>
```

These tests passed on the stub, as they should:

- the initial state (neither granted nor refused, nothing requested);
- garbage decoding to nothing;
- the two `Unavailable` tests.

The mutants below show that each of them can fail.

**GREEN** (`2fa3fbc`). The implementations:

- **Android `rememberCameraPermission`** holds the logic that `CameraPermissionGate` had: a `granted` state re-read in `LifecycleResumeEffect`, a saveable `denied`, `RequestPermission()` for CAMERA, and the Settings intent.
- **The gate** keeps only its screens and reads the permission it is given (by default, `rememberCameraPermission()`). Where `available` is false, it shows `openverify_camera_unavailable` and Cancel.
- **`decodePreviewBitmap`** is `BitmapFactory.decodeByteArray(…)?.asImageBitmap()` on Android. On iOS it is `org.jetbrains.skia.Image.makeFromEncoded(bytes).toComposeImageBitmap()`, with any exception turned into `null`.

925 tests passed, and the iOS klibs compiled against Skia.

**Refactor** (`73e9cbe`). Kover counted one line as missed: the `DefaultImpls` copy of `available`'s default getter, which Kotlin also emits and nothing calls. `available` is now abstract, so each platform states it (Android `true`, `Unavailable` `false`). The tests are unchanged.

## 4. Refactors and the moves

**Refactor** (`86b3bfc`). It made every file still to move import nothing Android:

- `InquiryOutcomes` (common) now holds `forFinish` and `reasonFor`. `InquiryResults.forFinish` delegates to it, so `InquiryResultsTest` (24) still covers it, and the view model calls it directly.
- The view model factory became `InquiryViewModel.Companion.factory(launch)` in `androidMain/InquiryViewModelFactory.kt`. `InquiryViewModel` keeps an empty companion.
- `SystemPhotoPicker` moved to its own Android file.
- `CaptureScreen` decodes the review photo with `decodePreviewBitmap`.

Results: 925 tests, with the same list SHA as after the GREEN (`e13aecf2…`).

**Moves** (`800bff1`, eleven `R100` renames). `InquiryViewModel.kt` and `ui/{ConsentScreen, CaptureScreen, InquiryFlowScreen, StatusScreens, Messages, OpenVerifyTheme, TestTags, FlowActions, PhotoPicker, CameraPermissionGate}.kt` moved to `commonMain`:

```text
$ ./gradlew --continue :openverify-sdk:compileCommonMainKotlinMetadata :openverify-sdk:compileIosMainKotlinMetadata :openverify-sdk:compileKotlinIosArm64 \
    :openverify-sdk:compileKotlinIosSimulatorArm64 :openverify-sdk:compileTestKotlinIosArm64 :openverify-sdk:compileTestKotlinIosSimulatorArm64 :openverify-sdk:testAndroidHostTest
> Task :openverify-sdk:compileCommonMainKotlinMetadata
> Task :openverify-sdk:compileKotlinIosArm64
> Task :openverify-sdk:compileKotlinIosSimulatorArm64
> Task :openverify-sdk:testAndroidHostTest UP-TO-DATE
BUILD SUCCESSFUL
```

`testAndroidHostTest` was UP-TO-DATE, so the host classes are byte-identical. A search of `commonMain` finds no `okhttp3`, `okio`, `android.*`, `java.*`, `javax.*` or `R` import, no `androidx.compose.ui.res`, no `LocalContext`, no `androidx.activity` and no `androidx.camera`. `iosMain` holds only actuals.

## 5. Mutants (temporary; each file was restored and `git status` was clean afterwards)

| Mutant | Caught by |
|---|---|
| `FlowCoordinator`'s consent retry sends `settings.locale` | `ConsentLocaleTest > a consent sent again after an error keeps the language its texts were shown in` |
| an unprefixed Android resource (`res/values/colors.xml`, `<color name="primary">`) | `ResourcesTest > every Android resource … starts with OpenVerify or openverify_` (`expected: <[]> but was: <[primary]>`) |
| `openverify_done` removed from the Spanish file | `ResourcesTest > every English string and plural has a Spanish one, …` and `SpanishMessagesTest > every SDK string has its own Spanish text` (`[openverify_done]`) |
| `CameraPermission.Unavailable.granted = true` | both `UnavailableCameraPermissionTest` tests |
| no re-read in `LifecycleResumeEffect` | `CameraPermissionTest > a permission granted in Settings is seen when the screen comes back` |
| garbage decodes to `ImageBitmap(1, 1)` | `PreviewBitmapTest > bytes that are not an image decode to nothing` |
| the gate offers Allow without a camera | `CameraPermissionTest > on a platform without a camera the gate says so, …` |

## 6. Public API

A `javap -public` listing of the AAR was diffed against the starting AAR, class by class. None of the 248 Kotlin-public classes changed:

- `OpenVerifyInquiry` and its nested types;
- `InquiryResult` and `FailureReason`;
- `OpenVerifyThemeKt`;
- `FlowApi`, `FlowApiException`, `FlowApiClient` and `FlowApiClients`;
- `CapturedImage` and `CameraLens`;
- `Mrz`, `BacKeySeed` and the `model` types.

Every difference is Kotlin `internal`, or in a class Compose and the resources plugin generate. Examples:

- `FlowActions.acceptConsent`, `InquiryViewModel` and `FlowCoordinator.acceptConsent` gained the locale;
- `ConsentScreen`'s callback and `Messages` return types changed;
- `CameraPermission*`, `InquiryOutcomes`, `InquiryViewModelFactoryKt`, `ReviewImage_androidKt` and the `generated.resources` accessors are new.

`OpenVerifyThemeKt.OpenVerifyTheme(boolean, Function2, Composer, int, int)` is now compiled from `commonMain` with the same JVM name and signature. `demo-app` is unchanged.

## Final gate

```text
$ (cd android && ./gradlew --rerun-tasks testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 1m 35s
191 actionable tasks: 191 executed
$ (cd android && ./gradlew :openverify-sdk:koverXmlReport)     # that run's report, for the table below
$ bash infra/tests/ci-workflow.test.sh
# 149 passed, 0 failed, 0 skipped
$ gitleaks git --redact --log-opts="4e1280c..HEAD" .
no leaks found
```

What the gate ran:

- **Compiles:** `assemble` ran `compileCommonMainKotlinMetadata`, `compileIosMainKotlinMetadata`, `compileKotlinIos{Arm64,SimulatorArm64}` and `compileTestKotlinIos{Arm64,SimulatorArm64}`, so the whole UI compiles for iOS.
- **Warnings:** the only Kotlin warnings are Stage 1's 11 `KLIB loader … same 'unique_name'` notices.
- **Lint:** `lint` and `lintAndroidMain` passed.

**Tests.** The SDK has 925 host tests in 48 classes, and the demo has 18 in 3 (`DemoFormTest` 10, `DemoViewModelTest` 6, `MainActivityTest` 2). None was skipped, failed or errored. Every one of the 631 baseline lines is present (multiset containment, 0 missing), and each of the 31 baseline classes keeps its count. The full list hashes to `e13aecf2a4f469450994aa8564d89b2f7877c093448b476fbf307de41faa6eb0`. `iosTest` adds `IosPreviewBitmapTest` (2), which only compiles until Phase 10.

| Class (under `dev.openverify.sdk`) | Baseline | Start (Stage 2) | Final |
|---|---|---|---|
| `InquiryResultsTest` | 24 | 24 | 24 |
| `InquiryViewModelTest` | 16 | 16 | 16 |
| `OpenVerifyInquiryActivityTest` | 10 | 10 | 10 |
| `OpenVerifyInquiryContractTest` | 11 | 11 | 11 |
| `OpenVerifyInquiryOneTimeLinkTest` | 16 | 16 | 16 |
| `OpenVerifyInquiryRequestTest` | 8 | 8 | 8 |
| `api.ApiBaseUrlParityTest` | – | 122 | 122 |
| `api.ApiBaseUrlTest` | – | 13 | 13 |
| `api.FlowApiClientContractTest` | – | 19 | 19 |
| `api.FlowApiClientTest` | 75 | 75 | 75 |
| `api.JsonMediaTypeParityTest` | – | 35 | 35 |
| `api.OkHttpTransportTest` | – | 5 | 5 |
| `api.OneTimeLinkClientContractTest` | – | 4 | 4 |
| `api.OneTimeLinkClientTest` | 6 | 6 | 6 |
| `api.OneTimeLinkFlowApiTest` | 5 | 5 | 5 |
| `api.OneTimeLinksParityTest` | – | 50 | 50 |
| `api.OneTimeLinksTest` | – | 8 | 8 |
| `camera.CameraFactsTest` | 16 | 16 | 16 |
| `camera.CaptureCameraTest` | 8 | 8 | 8 |
| `camera.CapturePlatformTest` | – | 2 | 2 |
| `camera.CapturedImageTest` | 7 | 7 | 7 |
| `camera.DeviceLabelTest` | – | 7 | 7 |
| `camera.ImageEncodingTest` | 6 | 6 | 6 |
| `camera.LensFacingTest` | – | 4 | 4 |
| `camera.PickedPhotosTest` | 12 | 12 | 12 |
| `camera.TakePictureOrNullTest` | – | 5 | 5 |
| `flow.FlowCoordinatorTest` | 114 | 114 | 114 |
| `flow.FlowNavigatorTest` | 9 | 9 | 9 |
| `flow.JsonLogicTest` | 36 | 36 | 36 |
| `flow.SelfieCaptureProtocolTest` | 3 | 3 | 3 |
| `model.ContractFixturesTest` | 37 | 37 | 37 |
| `model.SelfieCaptureModelTest` | 19 | 19 | 19 |
| `model.WireModelTest` | 23 | 23 | 23 |
| `mrz.BacKeySeedTest` | 13 | 13 | 13 |
| `mrz.MrzTest` | 17 | 17 | 17 |
| `mrz.MrzVectorsTest` | 44 | 44 | 44 |
| `ui.CameraPermissionGateTest` | 6 | 6 | 6 |
| `ui.CameraPermissionTest` (new, `androidHostTest`) | – | – | 8 |
| `ui.CaptureScreenTest` | 24 | 24 | 24 |
| `ui.ConsentLocaleTest` (new, `androidHostTest`) | – | – | 3 |
| `ui.ConsentScreenTest` | 10 | 10 | 10 |
| `ui.InquiryFlowScreenTest` | 16 | 16 | 16 |
| `ui.MessagesTest` | 19 | 19 | 19 |
| `ui.PreviewBitmapTest` (new, `androidHostTest`) | – | – | 3 |
| `ui.ResourcesTest` (new, `androidHostTest`) | – | – | 4 |
| `ui.SpanishMessagesTest` | 4 | 4 | 4 |
| `ui.StatusScreensTest` | 17 | 17 | 17 |
| `ui.UnavailableCameraPermissionTest` (new, `commonTest`) | – | – | 2 |
| **Total** | **631** | **905** | **925** |

**Kover** measures line coverage with the same rule and exclusions:

| Package (under `dev.openverify.sdk`) | Baseline | Start (Stage 2) | Final |
|---|---|---|---|
| root | 98.77% (161 / 163) | 98.70% (152 / 154) | 98.71% (153 / 155) |
| `api` | 98.35% (239 / 243) | 99.38% (481 / 484) | 99.38% (481 / 484) |
| `camera` | 96.77% (90 / 93) | 97.06% (99 / 102) | 97.06% (99 / 102) |
| `flow` | 98.86% (433 / 438) | 98.86% (433 / 438) | 98.86% (433 / 438) |
| `model` | 98.74% (472 / 478) | 98.74% (472 / 478) | 98.74% (472 / 478) |
| `mrz` | 100.00% (17 / 17) | 100.00% (17 / 17) | 100.00% (17 / 17) |
| `ui` | 90.70% (156 / 172) | 90.70% (156 / 172) | 90.96% (161 / 177) |
| **Total** | **97.76% (1568 / 1604)** | **98.10% (1810 / 1845)** | **98.11% (1816 / 1851)** |

The `ui` lines still missed are those of before:

- the guide drawing in `CaptureScreen` (`DrawScope` functions, which Robolectric does not draw);
- the system photo picker's callback, which needs the system picker.

**Build time** on this machine with warm caches: 1 min 35 s for the gate (191 tasks), against 1 min 28 s at the start (188 tasks).

## Layout after this stage

- **`commonMain`.** It holds:
  - `InquiryViewModel` and `InquiryOutcomes`;
  - `ui/{InquiryFlowScreen, ConsentScreen, CaptureScreen, StatusScreens, CameraPermissionGate, OpenVerifyTheme, Messages, TestTags, FlowActions, PhotoPicker}`;
  - the seams: `ui/CameraPermission.kt` (the interface, `Unavailable` and `expect rememberCameraPermission`) and `ui/ReviewImage.kt` (`expect decodePreviewBitmap`);
  - the strings, in `composeResources/values{,-es}/strings.xml`.
- **`androidMain`.** It holds:
  - `OpenVerifyInquiry`, `OpenVerifyInquiryActivity`, `InquiryResults` (intents, `Launch`, `forFinish` as a delegate) and `InquiryViewModelFactory` (`InquiryViewModel.Companion.factory(launch)`);
  - `camera/{CameraXCaptureCamera, ImageEncoding, PickedPhotos, CapturePlatform.android}`;
  - `ui/{CameraPermission.android, ReviewImage.android, SystemPhotoPicker}`;
  - `res/values{,-night}/themes.xml`.
- **`iosMain`.** It holds `ui/CameraPermission.ios.kt` (always `CameraPermission.Unavailable`) and `ui/ReviewImage.ios.kt` (Skia), beside Stage 1's and Stage 2's actuals.

## Decisions (for the plan; `docs/plans/` is Stage 4's to edit)

1. **`FlowCoordinator.acceptConsent` gains `locale: String? = null`, and its retry keeps it.** K5 specifies this, though the Workflow's Stage 3 path list leaves out `flow/`. It is one defaulted parameter, and `FlowCoordinatorTest` is untouched.
2. **`ConsentScreen`'s callback is `(optionalTextKeys, locale) -> Unit`.** K5 has the screen read the locale and pass it on, so `ConsentScreenTest`'s single `show()` lambda became `{ optional, _ -> }`. K7's list of edits omitted this third kind; no test case or assertion changed.
3. **The plural's `%d` became `%1$d`**, in a commit before the move, so the move itself is a 100% rename. Compose Multiplatform 1.11's formatter replaces only `%N$d` and `%N$s`. Android shows the same text, which `CaptureScreenTest` pins. Every other string moved byte for byte. The English header comment changed afterwards, in comments only.
4. **`CameraPermission` also has `available`** (K3 lists `granted`, `denied`, `request()` and `openSettings()`). The iOS placeholder must say "not available" (K2) and never offer a request that cannot work. `CameraPermission.Unavailable` lives in `commonMain`, so `commonTest` pins it on every platform, and the iOS actual returns it. `available` is abstract, so no `DefaultImpls` copy goes uncovered.
5. **The `expect` declarations live in `ui/CameraPermission.kt` and `ui/ReviewImage.kt`.** K2 names only the `.android.kt` and `.ios.kt` files.
6. **The generated resources are imported with `dev.openverify.sdk.generated.resources.*`.** The alternative is one import per string: Messages alone uses about 60.
7. **`SpanishMessagesTest` keeps its Robolectric runner and its `es` qualifier.** It sets the default locale explicitly for each read, as K5 says.
8. **The iOS decoder turns any exception from Skia into `null`.** `makeFromEncoded` throws `IllegalArgumentException`, and the bitmap copy can throw `RuntimeException`. This matches `BitmapFactory`, which returns `null`.

## Follow-ups

- **Phase 10.** Implement `rememberCameraPermission` on iOS (`AVCaptureDevice.requestAccess(for: .video)`, `UIApplication.openSettingsURLString`), PHPicker as a `PhotoPicker` and AVFoundation as a `CaptureCamera`. Run `IosPreviewBitmapTest` and `UnavailableCameraPermissionTest` on the simulator.
- **Stage 4, Gradle.** `openverify-sdk/build.gradle.kts` still says Android resources hold "the strings until they move to composeResources". `androidx.lifecycle:lifecycle-viewmodel-compose` is no longer imported in `androidMain` and could be dropped.
- **Stage 4, the plan.** Amend K2, K3, K5 and K7 as in Decisions. Record the expected end state as 925 SDK host tests (631 baseline + 18 Stage 1 + 256 Stage 2 + 20 Stage 3) and 2 compile-only `iosTest` tests from this stage.
- **Phase 5.** New screens go in `commonMain/ui/steps/<Type>Step.kt`, and their strings in `composeResources/values{,-es}/strings_<type>.xml` with positional arguments. `ResourcesTest` reads every XML file in those folders, so the English and Spanish files must name the same keys.
