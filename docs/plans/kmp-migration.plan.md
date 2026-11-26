# Plan: Android SDK to Kotlin Multiplatform (iOS-ready), before Phase 5

**Source:** the owner asked: "we might need an iOS app later so make it in a language that we can easily port to iOS alongside Android". The decision taken on it: keep Kotlin, and move `android/openverify-sdk` to Kotlin Multiplatform (KMP) with Compose Multiplatform (CMP) now, before Phase 5 adds Android code.

**Inputs:** the repository files read in full were `android/`, `docs/PLAN.md` §3 and §6, `docs/plans/phase-5.plan.md` (C64.2, `android-5a`, `clients-5b`), `.github/workflows/ci.yml`, `infra/tests/ci-workflow.test.sh` and `THIRD_PARTY_LICENSES.md`. The primary sources, read on 2026-10-22, were Maven Central and Google Maven metadata, POMs and module files, the CMP and Kover changelogs, and the Kotlin, Android and GitHub docs. A throwaway spike was also built on this machine on 2026-10-22 (WSL Linux, no macOS).

**Complexity:** Medium. One Workflow runs four agents in sequence. The work is a behaviour-preserving refactor: the existing tests are the safety net, and new tests cover only the new seams.

**Out of scope:** the iOS app, real iOS platform code (this plan adds compile-only placeholders), a macOS CI job, and compileSdk 37.

## Summary

- **Layout.** `:openverify-sdk` becomes one KMP library with three targets: `android`, `iosArm64` and `iosSimulatorArm64`. It uses AGP 9's `com.android.kotlin.multiplatform.library`, because `androidTarget()` with `com.android.library` is incompatible with AGP 9's new DSL.
- **Other modules.** `demo-app` keeps its sources unchanged. `openverify-nfc` stays an Android library, the LGPL boundary of Phase 10.
- **Shared code.** About 84% of the 4,767 main lines go to `commonMain`: the model, MRZ, the flow engine, the API client, the view model, every Compose screen and every string.
- **Android code.** `androidMain` keeps the `ActivityResultContract` entry points, the Activity and intents, CameraX, bitmap encoding, the photo picker and the camera permission.
- **Networking:** Ktor 3.5.2 in `commonMain`. On Android it runs on the existing OkHttp 5.4.0 client; on iOS, on the Darwin engine (NSURLSession).
- **Strings:** the 111 en/es strings move verbatim to Compose Multiplatform resources (`Res.string`).
- **Tests.** All 616 SDK tests move to `androidHostTest` unchanged in substance (JUnit 5, Robolectric, Compose UI). New seam tests go to `commonTest` (kotlin.test, Ktor `MockEngine`). These run on the Android host now, and on the iOS simulator once macOS CI exists.
- **Linux CI compiles the shared code for iOS.** Kotlin 2.4.21 cross-compiles iOS klibs by default. The spike proved this, including Apple platform libraries and Ktor's Darwin engine.

## Starting point (inventory, 2026-10-22)

- **Build:** Toolchain: Gradle 9.8.2, AGP 9.4.1 with built-in Kotlin (the root `buildscript` lifts KGP to 2.4.21), JDK 21. compileSdk and targetSdk 36, minSdk 26. Catalog: Compose BOM 2026.06.01 (UI 1.11.4, material3 1.4.0), CameraX 1.6.2, lifecycle 2.9.4, serialization and coroutines 1.11.0, OkHttp 5.4.0, Kover 0.9.11. UI 1.12 and OkHttp 5.5 need compileSdk 37.
- **Main code (41 files, 4,767 lines):** 19 files are free of Android and JVM imports: `model/*`, `mrz/*`, `flow/*`, `FlowApi`, `OneTimeLinkFlowApi`, `CapturedImage`, `CameraLens`, `InquiryResult`, `FlowActions` and `TestTags`. The UI depends on Compose and `R.string`: 111 strings in each of en and es, with no plurals and no escapes. The rest uses OkHttp (`HttpUrl` included), CameraX, `Bitmap`, `Intent` and `ActivityResultContract`, permissions, `IOException`, `codePointCount` and `OutOfMemoryError`.
- **Tests:** 616 SDK tests in 32 classes, none skipped. 42 are `@ParameterizedTest`, and 111 in 10 classes run on Robolectric; 18 demo tests and 1 instrumented CameraX test. Kover line coverage is 97.43%, excluding `@Composable`, `ComposableSingletons*` and `CameraXCaptureCamera*`.
- **CI:** The `android` job runs `./gradlew testDebugUnitTest koverVerify assembleDebug`; `android-instrumented` runs `connectedDebugAndroidTest` on an API 34 emulator, if `*/src/androidTest/*` exists; `ci-workflow.test.sh` pins both strings.

## Research results ("released" = Maven `Last-Modified`)

| Component | Use | Released | Newest seen | Why this one | Licence |
|---|---|---|---|---|---|
| Kotlin multiplatform, Compose compiler and serialization plugins | 2.4.21 (unchanged) | 2026-10-08 | 2.4.21 | Already pinned | Apache-2.0 |
| AGP `com.android.kotlin.multiplatform.library`, `com.android.lint` | 9.4.1 (unchanged) | n/a | n/a | AGP 9 notes: KMP plus `com.android.library` is incompatible with the new DSL. The `android.newDsl=false` opt-out goes in AGP 10 | Apache-2.0 |
| CMP: plugin `org.jetbrains.compose`, runtime, foundation, ui, `components-resources` | 1.11.1 | 2026-06-01 | 1.12.2 (2026-10-15) | 1.12.x is built on Jetpack Compose 1.12.1, which needs compileSdk 37. 1.11.1 maps to Jetpack 1.11.2, and the BOM's 1.11.4 wins on Android | Apache-2.0 |
| CMP Material3 | 1.9.0 | 2025-10-13 | 1.13.0-alpha02 | Newer lines are alpha. CMP 1.11's 1.11.0-alpha07 would move Android from material3 1.4.0 to 1.5.0-alpha17 | Apache-2.0 |
| JetBrains `lifecycle-viewmodel` | 2.9.6 | 2025-11-06 | 2.11.0 | Already pulled by CMP 1.11.1. Maps to androidx lifecycle 2.9.4 on Android | Apache-2.0 |
| Ktor client: core, okhttp, darwin, mock | 3.5.2 | 2026-07-31 | 3.6.0 (2026-09-16) | 3.6.0's OkHttp engine needs OkHttp 5.5.0 (minCompileSdk 37). 3.5.2 needs 5.3.2, so our 5.4.0 wins. Built on coroutines and serialization 1.11.0 | Apache-2.0 |
| kotlinx-io-core (via Ktor) | 0.9.1 | 2026-06-26 | n/a | Its `IOException` is `java.io.IOException` on Android | Apache-2.0 |
| SLF4J API (via Ktor; JVM and Android) | 2.0.18 | 2026-05-12 | n/a | Ktor's logger. Prints one "no provider" line on Android | MIT |
| Kover | 0.9.11 (unchanged) | 2026-09-29 | n/a | KMP Android library supported since 0.9.2. Host-test lookup fixed in 0.9.3 | Apache-2.0 |
| androidx.savedstate (Android, via CMP ui) | 1.3.2 → 1.4.0 | n/a | n/a | Required by CMP 1.11.1. The AAR metadata check passes at compileSdk 36 | Apache-2.0 |
| Kotlin/Native toolchain (build only, about 820 MB in `~/.konan`) | 2.4.21 | n/a | n/a | Downloaded by KGP. The Linux distribution ships the Apple platform klibs | Apache-2.0 (LLVM: Apache-2.0 WITH LLVM-exception) |
| Burst (Phase 10, not now) | 2.14.0 | 2026-09-29 | n/a | Parameterized tests in `commonTest`. Supports Kotlin 2.4.20 (2.4.21 to confirm) | Apache-2.0 |

- **AGP's KMP plugin:** Source sets: `androidMain`, `androidHostTest` (`withHostTest { isIncludeAndroidResources = true }`) and `androidDeviceTest` (`withDeviceTest { instrumentationRunner = ... }`). Tasks: `testAndroidHostTest`, `connectedAndroidDeviceTest` and `assembleAndroidMain`. Limits: one variant, no `resourcePrefix`, lint only through `com.android.lint`, and no app plugin in the module (`demo-app` is already separate).
- **Kover 0.9.11:** the total variant (`koverVerify`) measures the JVM bytecode of `commonMain` and `androidMain` that `testAndroidHostTest` runs. `iosMain` is not measured, so it stays thin.
- **Why Ktor, not OkHttp behind an interface:** One shared implementation covers request building, multipart, error and problem+json mapping, and the 2xx-with-unexpected-body rule. One `MockEngine` suite tests it for both platforms. On Android, Ktor's OkHttp engine wraps today's shared `OkHttpClient` (`preconfigured`). Timeouts, TLS, the pool, event listeners and every MockWebServer test stay valid. On iOS, Darwin provides NSURLSession, including ATS and proxies. An interface would need a hand-written multipart encoder and an NSURLSession wrapper: about 300 lines that cannot be tested on Linux; `ContentNegotiation` is not used. Explicit kotlinx.serialization keeps today's exception semantics.
- **Spike evidence** (2026-10-22, scratch project, not committed: Gradle 9.8.2, AGP 9.4.1, Kotlin 2.4.21, CMP 1.11.1 with material3 1.9.0 and resources, Ktor 3.5.2, configuration cache on):
  1. **iOS compile on Linux works with no property set.** `compileKotlinIosArm64`, `compileKotlinIosSimulatorArm64` and `compileTestKotlinIosSimulatorArm64` all succeed, including `iosMain` code that uses `platform.Foundation`, `platform.UIKit` and `ktor-client-darwin`. `assemble` runs them all. `iosSimulatorArm64Test` is disabled ("simulator tests require macOS").
  2. **The metadata compile catches JVM APIs, not missing `actual`s.** `compileCommonMainKotlinMetadata` rejected `java.io.File`, `String.format`, `codePointCount` and `OutOfMemoryError` in `commonMain`; `OutOfMemoryError` is absent from common Kotlin. A missing iOS `actual` passed the metadata compile and failed only `compileKotlinIosArm64`.
  3. **One host test task runs all three test kinds.** `testAndroidHostTest` ran Jupiter (parameterized tests included), Vintage with Robolectric, and the `commonTest` classes in one task.
  4. **Strings resolve per locale in host tests.** Robolectric `@Config(qualifiers = "es")` set `Locale.getDefault()` to es, and `stringResource` and `getString` returned Spanish. `Res.allStringResources` exists, `&lt;` decodes and `%1$d` formats.
  5. **Fixtures and coverage work in host tests.** `kotlin.sourceSets["androidHostTest"].resources.srcDir(...)` put the fixtures on the classpath, and Kover covered both `commonMain` and `androidMain`.
  6. **An AGP 9 app module consumes the library.** Its Robolectric test resolved the library's Spanish strings, and its APK ships them under `assets/composeResources/`.
  7. **Ktor over OkHttp keeps today's wire format** (checked against MockWebServer). Explicit multipart parts kept `form-data; name="kind"` and `form-data; name="file"; filename="front.jpg"` in order, and the JSON content type stayed exactly `application/json; charset=utf-8`. A read timeout surfaced `SocketTimeoutException` and a call timeout `InterruptedIOException`, both subclasses of `InterruptedIOException`, as `FlowApiClientTest` asserts.
  8. **Ktor's `Url` and OkHttp's `HttpUrl` disagree on some hosts.** Ktor keeps IPv6 brackets (`[::1]`), does not lower-case hosts, and does not apply punycode; OkHttp does all three. Both refuse spaces, a missing scheme and port 99999.
  9. **Android dependency resolution is unchanged.** Android still resolves Compose 1.11.4, material3 1.4.0, lifecycle 2.9.4 and OkHttp 5.4.0, and `checkAndroidMainAarMetadata` passes at compileSdk 36. The androidx `lifecycle-viewmodel` in `commonMain` gave KLIB "same unique_name" warnings; the JetBrains coordinates do not.
  10. **Lint and device tests need no CI path changes.** `com.android.lint` adds `lint` and `lintAndroidMain`. Device results land in `build/outputs/androidTest-results/connected/androidMain/`, which the CI globs already match.
- **Cross-compilation answer:** History: Kotlin 2.1.0 made klib cross-compilation experimental (`kotlin.native.enableKlibsCrossCompilation=true`). Since 2.2.20 it is on by default and the property can be removed. 2.3.20 added the `crossCompilationSupported` checker; A Mac is still needed for cinterop (including CocoaPods), for linking frameworks or test executables, and for running anything. Any future cinterop (for example the ONNX Runtime C API) goes in its own module, so `:openverify-sdk` keeps compiling on Linux; `compileCommonMainKotlinMetadata` alone guarantees only that `commonMain` uses no JVM API. It misses missing iOS `actual`s, `iosMain` code, dependencies without iOS variants, Native-only errors, and link or runtime problems (for example regex-engine differences). Linux CI therefore also compiles the iOS main and test klibs; iOS targets: `iosArm64` and `iosSimulatorArm64`. Not `iosX64`: it is tier 3 in Kotlin 2.4, and CMP 1.11 dropped Apple x86_64 (KT-81596). Kotlin 2.4 sets the iOS minimum to 15.0.

## K1. Target layout

```
android/openverify-sdk/  KMP: android + iosArm64 + iosSimulatorArm64 (artifact, namespace, packages unchanged)
  src/commonMain/{kotlin/dev/openverify/sdk/..., composeResources/values{,-es}/strings.xml}
  src/androidMain/{AndroidManifest.xml, res/values{,-night}/themes.xml, kotlin/...}
  src/iosMain/kotlin/...      compile-only placeholders, never published, until Phase 10
  src/commonTest/  src/androidHostTest/  src/androidDeviceTest/
android/openverify-nfc/  unchanged Android library (JMRTD, LGPL, Phase 10)
android/demo-app/        unchanged Android app
```

- **Why one module, not a core/ui/facade split now:** About 25 `internal` types cross the would-be boundaries (`FlowCoordinator`, `FlowState`, `FlowActions`, `CaptureCamera`, `CameraFacts`, `Messages` and others). A split would make them public, or need an opt-in annotation; A split would also triple the Kover gates and the CI wiring, for nothing iOS needs yet; `api`, `flow`, `model` and `mrz` already import no UI. Extract an `openverify-core` module without Compose when an iOS SwiftUI UI wants core only, or when build time demands it.
- **Public Android API.** Every public type keeps its FQN, file and JVM class name: `OpenVerifyInquiry`, with `Request`, `Contract`, `OneTimeLink`, `fromOneTimeLink` (`@JvmStatic`/`@JvmOverloads`) and `OneTimeLinkContract`; `InquiryResult` and `FailureReason`; `OpenVerifyTheme`; `FlowApi` and `FlowApiException`. For `Network(cause: IOException)`, `kotlinx.io.IOException` is a typealias of `java.io.IOException`; `CapturedImage` and `CameraLens`; the `model` types and `OpenVerifyJson`; `Mrz` and `BacKeySeed`. `demo-app` needs no change.
- **The only break is `FlowApiClient`'s `OkHttpClient` constructor.** It becomes a same-named factory function in `androidMain`. The class keeps a public `(apiBaseUrl, sessionToken, json = OpenVerifyJson)` constructor plus an `internal` one taking the transport, so Ktor stays out of the public API. Kotlin callers still compile. Java and binary callers break. That is acceptable while the SDK is unpublished (decision 7).

## K2. What moves where (S1 to S3 = the stage that moves it)

- **`commonMain`, S1, moved verbatim:** `model/*`, `mrz/*` and `flow/*`; `InquiryResult.kt`; `api/FlowApi.kt`; `api/FlowApiException.kt`, with `java.io.IOException` replaced by `kotlinx.io.IOException`; `camera/{CameraLens, CapturedImage}.kt`.
- **`commonMain`, S1, with small edits:** `CaptureCamera.kt`: `takePictureOrNull` catches `Throwable` and rethrows anything that is not a `CancellationException`, an `Exception`, or `isOutOfMemory(e)` (an `expect fun`); `CameraFacts.kt`: a common `LensFacing` object keeps CameraX's `Int` codes (`UNKNOWN = -1`, `FRONT = 0`, `BACK = 1`, `EXTERNAL = 2`), so five test files stay untouched; `CameraFacts.kt`: `\p{Cc}` becomes the identical `\u0000-\u001F\u007F-\u009F`, and a surrogate-aware loop replaces `codePointCount`; `CameraFacts.kt`: `image-mirrored` reads `expect val CAPTURE_MIRRORS_IMAGES`.
- **`commonMain`, S2:** `api/FlowHttp.kt` is rebuilt on Ktor (K4); `api/{FlowApiClient, OneTimeLinkClient, OneTimeLinkFlowApi}.kt` move; `SessionCredentials.kt` gains the strict `ApiBaseUrl` parser; a new `api/OneTimeLinks.kt` holds the fragment parsing.
- **`commonMain`, S3:** `InquiryViewModel.kt`; a new `InquiryOutcomes.kt` with `forFinish` and `reasonFor`; `ui/{ConsentScreen, CaptureScreen, InquiryFlowScreen, StatusScreens, Messages, OpenVerifyTheme, TestTags, FlowActions}.kt`; the `PhotoPicker` interface and the `CameraPermissionGate` UI; `Messages` returns `StringResource`; the strings, moved to `composeResources`.
- **`androidMain`:** S1: the manifest and themes. S2: `OpenVerifyInquiry.kt` swaps `HttpUrl` for `OneTimeLinks` and `SessionCredentials`. S2: a new `api/FlowHttp.android.kt` holds: the shared `OkHttpClient` (15/30/60 s, no redirects); `actual fun defaultFlowHttpClient()` (the OkHttp engine, `preconfigured`); `PLATFORM_NAME = "Android"`; the factories `FlowApiClient(url, token, OkHttpClient, json)` and `internal OneTimeLinkClient(...)`. They keep `FlowApiClientTest` and `OneTimeLinkClientTest` unchanged. S3: `OpenVerifyInquiryActivity.kt` keeps its flags but no longer reads the locale; `InquiryResults.kt` keeps intents and `Launch`, and its `forFinish` delegates to `InquiryOutcomes`; a new `InquiryViewModelFactory.kt` holds `InquiryViewModel.Companion.factory(launch)`; `camera/{CameraXCaptureCamera, ImageEncoding, PickedPhotos}.kt` switch `R.string` to `Res.string`; `ui/SystemPhotoPicker.kt`; `ui/CameraPermission.android.kt` (permission request, `LifecycleResumeEffect`, Settings intent); `ui/ReviewImage.android.kt` (`BitmapFactory`).
- **`iosMain` (compile-only):** Real implementations: `FlowHttp.ios.kt` (Darwin engine, `OpenVerify-iOS/` user agent), `ReviewImage.ios.kt` (Skia `Image.makeFromEncoded`), `isOutOfMemory` and `CAPTURE_MIRRORS_IMAGES`. Placeholder: `CameraPermission.ios.kt` reports "not available", so it never claims a permission or a capture.
- **Tests:** S1 does `git mv src/test src/androidHostTest` and `git mv src/androidTest src/androidDeviceTest`; `commonTest` holds only the new seam tests (K7).

## K3. Platform boundaries

- **Interfaces the host passes in** (no `expect` needed): `CaptureCamera`: `CameraXCaptureCamera` on Android; AVFoundation with a `UIKitView` preview on iOS (Phase 10); `PhotoPicker`: `SystemPhotoPicker` with `PickedPhotos` on Android; PHPicker on iOS; `FlowApi`. Phase 5's `DocumentPicker`.
- **Minimal `expect` surface:** `defaultFlowHttpClient()`; `PLATFORM_NAME`; `@Composable rememberCameraPermission(): CameraPermission`, with `granted`, `denied`, `request()` and `openSettings()`; `decodePreviewBitmap(bytes): ImageBitmap?`; `CAPTURE_MIRRORS_IMAGES`; `isOutOfMemory(Throwable)`. There is no `expect class`, because expect classes are still Beta.
- **Clock:** `TimeSource.Monotonic`, which is already common.
- **Crypto random:** none in the SDK today, since nonces come from the server. Phase 10 NFC challenges add `expect fun secureRandomBytes(n)`: `SecureRandom` on Android, `SecRandomCopyBytes` on iOS.

## K4. Ktor client: behaviours to preserve (each pinned by an existing test)

- **Client configuration:** `expectSuccess = false` and `followRedirects = false`, on an OkHttp client that does not redirect. A 302 becomes `UnexpectedStatus` after one request. No `HttpRequestRetry`, no `ContentNegotiation`, and no `HttpTimeout` on Android; the timeouts stay on OkHttp.
- **Headers:** `Accept: application/json, application/problem+json`; `User-Agent: OpenVerify-<platform>/0.1.0`; `Authorization: Bearer` on flow calls only, never on redeem.
- **Bodies:** JSON: `TextContent(text, ContentType.parse("application/json; charset=utf-8"))`. Submit sends `{}`. Multipart: explicit `PartData` parts in the order kind, capture-id, nonce, client-elapsed-ms, file, with quoted names. The file part is named `<kind>.<ext>` and carries the image MIME type.
- **URLs:** path segments go under any base-path prefix, with or without a trailing slash. `ver_` IDs are validated before any request.
- **Responses:** Unchanged: the status mapping, `x-request-id` with its problem-body fallback, `Retry-After` in seconds, and decoding of JSON and `+json` problem bodies; A 2xx body that fails to decode is `InvalidResponse`. `SerializationException` is an `IllegalArgumentException` in common code too; `kotlinx.io.IOException` becomes `Network(cause)`. `CancellationException` is never caught, and cancellation cancels the OkHttp call.
- **`ApiBaseUrl` validation:** The scheme must be `http` or `https`, and the host is non-empty and lower-cased; IPv6 brackets are stripped before the local-host check (`localhost`, `127.0.0.1`, `::1`, `10.0.2.2`). No userinfo, no raw `?` or `#`, and a valid port. Non-ASCII hosts are refused with "use the xn-- form" (decision 3). An `androidHostTest` parity suite compares about 40 inputs with OkHttp's `HttpUrl`; IDN is the only allowed difference.
- **Accepted wire differences:** Ktor adds `Accept-Charset: UTF-8` and a `Content-Length` on each part. Android logs one SLF4J "no provider" line.

## K5. Strings and locale

- **Resources:** Both `strings.xml` files move verbatim to `composeResources/values{,-es}/`, with the same keys. Configuration: `compose.resources { packageOfResClass = "dev.openverify.sdk.generated.resources"; publicResClass = false }`. Themes stay Android resources (`androidResources { enable = true }`). The KMP DSL has no `resourcePrefix`, so a test asserts that Android resource names start with `OpenVerify`/`openverify_`.
- **Locale today:** on Android, CMP resolves from the JVM default locale (`Locale.getDefault()`, and `Locale.current` in composition). Android resources use the Activity configuration instead. The two agree, except under AppCompat's per-app language back-port below API 33.
- **Consent locale seam:** `ConsentScreen` reads `stringResource(Res.string.openverify_locale)` in the same composition as its texts. It passes the value through `FlowActions.acceptConsent(optionalTextKeys, locale: String? = null)` to `FlowCoordinator.acceptConsent(..., locale ?: settings.locale)`. The recorded locale is then the language shown, on both platforms (C37, C42.3). This also fixes a mid-flow language change, which today keeps the old locale in the surviving `ViewModel` (decision 8). The Activity no longer calls `getString(R.string.openverify_locale)`.
- **Tests:** `text(R.string.x)` becomes `text(Res.string.x)`, backed by `runBlocking { getString(res) }`; `MessagesTest` compares `StringResource` instances; `SpanishMessagesTest` iterates `Res.allStringResources` and switches `Locale.setDefault` between en and es in try/finally. It keeps the same three tests and their assertions. New: every es key has an en key and vice versa (lint's `MissingTranslation` no longer applies), and a Spanish consent screen sends `es`.

## K6. Build configuration

- **Catalog:** Versions: `composeMultiplatform = "1.11.1"`, `composeMultiplatformMaterial3 = "1.9.0"`, `jetbrainsLifecycle = "2.9.6"`, `ktor = "3.5.2"`. Libraries: `compose-mp-{runtime,foundation,ui,material3,components-resources}`, `jetbrains-lifecycle-viewmodel`, `kotlinx-coroutines-core`, `ktor-client-{core,okhttp,darwin,mock}`, `kotlin-test`. Plugins: `android-kotlin-multiplatform-library` and `android-lint` (version `agp`), and `compose-multiplatform`.
- **Root project:** Add three `apply false` aliases. Keep the KGP `buildscript` classpath, which the demo's built-in Kotlin needs. Because of it, the SDK applies `id("org.jetbrains.kotlin.multiplatform")` without a version. In `gradle.properties`, add `kotlin.native.ignoreDisabledTargets=true`.
- **SDK plugins:** `kotlin.multiplatform`, `android.kotlin.multiplatform.library`, `kotlin.compose`, `compose.multiplatform` (resources), `kotlin.serialization`, `kover` and `android.lint`.
- **SDK targets:** `kotlin { jvmToolchain(21); iosArm64(); iosSimulatorArm64(); android { ... } }`. Inside `android { }`: namespace, compileSdk, minSdk, `androidResources { enable = true }`, `withHostTest { isIncludeAndroidResources = true }` and `withDeviceTest { instrumentationRunner = ... }`.
- **SDK dependencies:**

  | Source set | Dependencies |
  |---|---|
  | `commonMain` | CMP, the JetBrains viewmodel, coroutines-core, serialization-json, ktor-client-core |
  | `androidMain` | Compose BOM, activity-compose, lifecycle-runtime-compose, CameraX, coroutines-android, ktor-client-okhttp, OkHttp |
  | `iosMain` | ktor-client-darwin |
  | `commonTest` | kotlin-test, ktor-client-mock, coroutines-test |
  | `androidHostTest`, `androidDeviceTest` | today's test dependencies |

- **SDK test wiring:** Fixtures: `kotlin.sourceSets["androidHostTest"].resources.srcDir(contractFixtures)`. Test tasks: `tasks.withType<Test>().configureEach { useJUnitPlatform(); jvmArgs(...) }`. Kover: the same rule and exclusions as today, plus `dev.openverify.sdk.generated.resources.*`.

## K7. Tests and coverage

- **`androidHostTest`, moved:** the 32 classes, plus `Fixtures`, `FakeFlowApi` and `UiTestDoubles`, move with `git mv`.
- **`androidHostTest`, edits:** only two kinds. `R.string` becomes `Res.string` in the 8 files that use it. The `UiTestDoubles.acceptConsent` signature changes.
- **`androidHostTest`, unchanged:** `FlowApiClientTest` (75 tests: MockWebServer, custom `OkHttpClient`s, an `EventListener`), `OneTimeLinkClientTest` and `OpenVerifyInquiryActivityTest`. They are the wire-level safety net for Ktor on Android.
- **`androidHostTest`, new:** the `ApiBaseUrl`/`HttpUrl` parity suite; `LensFacing` matching the `CameraSelector` constants; resource naming and es/en completeness; the Spanish consent-locale UI test.
- **`commonTest`** (kotlin.test, ktor-client-mock, coroutines-test; runs inside `testAndroidHostTest` now, and on the iOS simulator in Phase 10): the MockEngine contract for `FlowHttp` and `FlowApiClient`: headers, every status, problem bodies, Retry-After, an invalid 2xx, multipart order and dispositions, the `{}` submit, a 302 that is not followed, `IOException` mapped to `Network`, and cancellation; `ApiBaseUrl` and `OneTimeLinks`; device-label truncation, including surrogate pairs and bidi; `takePictureOrNull` with OOM and with cancellation.
- **JUnit 5 parameterized suites** stay JVM-only until Phase 10. Then their pure parts move to `commonTest`, with Burst keeping one test per case.
- **`androidDeviceTest`:** `CameraXCaptureCameraTest`, unchanged.
- **Baseline:** Before any change, Stage 1 runs `./gradlew --rerun-tasks testDebugUnitTest koverVerify koverXmlReport`. It records in `docs/tdd/kmp-foundation.tdd.md`: per-class counts, the sorted `class#testcase` list with its SHA-256, and Kover total and per-package coverage. Raw XML stays outside git. The 2026-10-21 report gives: api 98.35, model 98.74, root 98.76, ui 90.59, flow 98.84, mrz 100, camera 96.77, total 97.74.
- **Gate at every stage** (re-run with `--rerun-tasks`): every baseline test case is still present (renames only when listed); the 32 classes keep their counts; the demo keeps 18 tests. Kover stays at or above 80% (95% or more expected). Expected end state: about 616 + 75 SDK tests, 18 demo tests and 1 device test.

## K8. CI (`ci.yml`, `infra/tests/ci-workflow.test.sh`)

- **`android` job:** Command: `./gradlew testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint --stacktrace`. `testDebugUnitTest` no longer reaches the SDK. `:openverify-sdk:assemble` builds the AAR and cross-compiles the iOS main and test klibs. Cache: `actions/cache` on `~/.konan`, keyed on the Kotlin version. Floor: a step fails on fewer than 616 SDK host tests or on any skipped test, as `check-connected-results.sh` does for device tests.
- **`android-instrumented`:** Detection also matches `*/src/androidDeviceTest/*`. The job runs `./gradlew :openverify-sdk:connectedAndroidDeviceTest`. The result globs already match `androidTest-results/connected/androidMain`.
- **`ci-workflow.test.sh`** asserts the new command, the konan cache, the floor and `connectedAndroidDeviceTest`.
- **Later macOS job** (Phase 10; described in the ADR, not added now): Runner: `macos-15`. Commands: `./gradlew :openverify-sdk:iosSimulatorArm64Test` (runs `commonTest` and links natively); `xcodebuild test` later. Triggers: nightly, `workflow_dispatch`, and pushes to `main` touching `android/**`. Cost: $0.062/min against $0.006 on Linux (about 10×), so about $1 per 15-minute run. That is roughly $30–60 a month while private; free if public.

## K9. Docs, licences, ADR, plan amendments

- **ADR `docs/adr/0004-mobile-kotlin-multiplatform.md`** (0003 is taken): Context: the owner's request. Decision: K1 to K5. Alternatives: Flutter or React Native (a rewrite in a new language, and native camera bridges anyway); a Swift SDK (duplicates the flow engine); KMP logic with a SwiftUI UI (possible later). Consequences: CI, macOS cost, cinterop isolation.
- **`THIRD_PARTY_LICENSES.md`:** §2.1: rows for CMP, its Material3, the JetBrains lifecycle and savedstate forks, Ktor, kotlinx-io, SLF4J (MIT) and androidx.savedstate 1.4.0. The OkHttp row becomes "Android engine of the Ktor client"; §1: the Kotlin/Native toolchain (build only). Test rows: `kotlin-test` and `ktor-client-mock`; §2.2 (to verify on adoption): NFCPassportReader 2.3.3 (MIT, Swift: BAC, PACE-GM, PA, AA with an app challenge, CA) with OpenSSL-Package (Apache-2.0), and Burst 2.14.0 (Apache-2.0).
- **`docs/PLAN.md` §3:** Add "iOS app (later) ── same SDK through KMP/Compose Multiplatform". The layout row becomes "`android/`: `openverify-sdk` (KMP: Android now, iOS later), `openverify-nfc` (Android, LGPL), `demo-app`".
- **`docs/PLAN.md` §6, Phase 10 gains:** `iosMain` implementations: AVFoundation capture with a `UIKitView` preview, ImageIO JPEG encoding, PHPicker, AVCaptureDevice permission, device facts; an XCFramework and an `ios/` app shell (SwiftUI hosting `ComposeUIViewController`); macOS CI, and Burst ports of the parameterized suites; onnxruntime: `onnxruntime-android` in `androidMain`, iOS through cinterop in its own module. PDF417: zxing on Android, Apple Vision on iOS, both behind common interfaces; iOS NFC through CoreNFC (decision 6).
- **`docs/PLAN.md` §9:** add a risk row for macOS cost and Compose parity on iOS.
- **`docs/plans/phase-5.plan.md`, C64.2** becomes:

  > Android (`android/openverify-sdk`, KMP since ADR 0004): the same steps in Compose Multiplatform in `commonMain` (`ui/steps/<Type>Step.kt`). Strings live in `src/commonMain/composeResources/values{,-es}/strings_<type>.xml` through `Res.string`. `FlowApi` methods are in `commonMain` on the Ktor client. The PDF or image picker sits behind a common `DocumentPicker`, implemented in `androidMain`. The crypto paste path only; NFC unsupported. New code goes to `commonMain` unless it needs a platform API, and `commonMain` dependencies must publish `iosArm64` and `iosSimulatorArm64` variants. Tests: `androidHostTest` (JUnit 5, Robolectric, Compose UI) and `commonTest` (kotlin.test, MockEngine) for new pure code. Kover ≥ 80%, and `:openverify-sdk:assemble` stays green.
- **`docs/plans/phase-5.plan.md`, other amendments:** `android-5a` and `clients-5b` gain "new code in `openverify-sdk/src/commonMain` unless platform-specific". Stage 1a's "Android retry strings" go to `composeResources`; `ContractFixturesTest` lives in `src/androidHostTest`. The validation line becomes the K8 command.
- **Other docs:** `docs/PROGRESS.md`: one entry; `android/openverify-nfc/README.md`: iOS NFC is separate, and `BacKeySeed` is common; `CLAUDE.md`: the android command and layout row, with the owner's approval (decision 9). `Name.android.kt` and `Name.ios.kt` fit its PascalCase rule.

## Workflow (one Workflow, four sequential agents; `android/` frozen for all others until Stage 4 ends)

- **Stage 1 `kmp-foundation`** (alone): Owns: the `android/` Gradle files, every `git mv` under `openverify-sdk/src/**`, the S1 edits, `ci.yml`, `ci-workflow.test.sh` and `docs/tdd/kmp-foundation.tdd.md`. Delivers: the K7 baseline. All of K6, including later stages' dependencies, so no later stage touches Gradle. The S1 moves, with not-yet-common code (the OkHttp client and the `R.string` UI) parked in `androidMain` and every test in `androidHostTest` or `androidDeviceTest`. And K8. TDD: RED is the CI contract and the `LensFacing` and portability tests. GREEN is the build. The moves must keep the same test set and coverage, and `assemble` must compile the iOS klibs.
- **Stage 2 `kmp-network`:** Owns: `openverify-sdk/src/*/kotlin/dev/openverify/sdk/api/**`, the URL parts of `OpenVerifyInquiry.kt`, the `api` tests and `docs/tdd/kmp-network.tdd.md`. Delivers: K4, the Darwin `actual`, and the MockEngine and parity suites. TDD: RED is the MockEngine tests against a not-yet-common `FlowHttp`, and the parity tests against a stub parser. GREEN follows. The MockWebServer suites stay green and unedited throughout.
- **Stage 3 `kmp-ui`:** Owns: `ui/**`, `camera/**`, `InquiryViewModel*.kt`, `InquiryOutcomes.kt`, `InquiryResults.kt`, `OpenVerifyInquiryActivity.kt`, `composeResources/**`, `androidMain/res/**`, their tests and `docs/tdd/kmp-ui.tdd.md`. Delivers: the S3 moves, K3, K5 and the iOS placeholders. TDD: RED is the Spanish consent-locale test, resource completeness and the `rememberCameraPermission` contract. GREEN comes first, then the moves, with the 111 Robolectric tests as the safety net.
- **Stage 4 `kmp-integration`:** Owns: the ADR, `THIRD_PARTY_LICENSES.md`, `docs/PLAN.md`, the Phase 5 plan, `docs/PROGRESS.md`, the NFC README, `CLAUDE.md` (with approval), `docs/tdd/kmp-integration.tdd.md`, and test-first fixes anywhere in `android/`. Delivers: K9, the before/after table, a `kotlin-reviewer` pass with its fixes, and full validation, both local and on GitHub (a branch with `workflow_dispatch`, so both Android jobs, emulator included, pass before merge).
- **Rules for every agent:** TDD: RED seen failing for the intended reason, and every RED commit compiles. Evidence in `docs/tdd/kmp-<agent>.tdd.md`. Moves with `git mv`. Conventional, path-scoped commits under `flock /tmp/openverify-git.lock`. Foreground Gradle gates (600,000 ms), and `--rerun-tasks` for counted runs. No skipped tests and no network in tests. No `commonMain` dependency without iOS variants, and no cinterop in `:openverify-sdk`.

## Validation

```bash
source scripts/env.sh
(cd android && ./gradlew --rerun-tasks testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
for t in infra/tests/*.test.sh; do bash "$t"; done
gitleaks git --redact .
# GitHub: android (iOS klibs, test-count floor) and android-instrumented (connectedAndroidDeviceTest) green
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The SDK suite silently stops running after the task rename | Med | Per-class XML comparison every stage, the CI test-count floor, the contract test |
| Material3 1.9.0 on CMP 1.11.1 compiles and passes `check*ComposeLibrariesCompatibility` on Linux, but iOS linking and runtime are unverified | Med | A macOS smoke test before any iOS release. Fallback: the 1.11 alpha line (decision 2) |
| Ktor differs from OkHttp on IDN, `[::1]` and extra headers | Med | The unchanged MockWebServer suites, the parity suite, and the differences listed in K4 |
| CMP follows the JVM default locale, not the Activity's (AppCompat per-app language below API 33) | Low | The consent locale is taken from the texts shown (K5), and the ADR documents the gap |
| Darwin engine behaviour (redirects, timeouts, errors) is untested until macOS CI | Med | `commonTest` on the simulator in Phase 10; no iOS release before then |
| CMP 1.12.0 lists iOS LiveRegion support as new (#2944), so selfie prompts may not be announced on 1.11.x | Med | A Phase 10 device check, with a `UIAccessibility` announcement fallback. compileSdk 37 unlocks CMP 1.12 |
| The Kotlin/Native toolchain is about 820 MB, so first builds are slower | Low | CI cache and `ignoreDisabledTargets` |
| The AGP KMP plugin has no build types, no `resourcePrefix`, and needs a separate lint plugin | Low | One variant suffices; a resource-naming test; `com.android.lint` (verified) |
| Phase 5 starts on the old layout | Med | `android/` frozen during the Workflow; the Phase 5 amendments land before `android-5a` |

## Decisions for the owner (made here; confirm or change)

1. **One KMP module now.** Split it only when an iOS SwiftUI UI or build time needs a separate core.
2. **Material3 1.9.0, the stable line.** Android stays on 1.4.0, with no visual change. The alternative, the 1.11 alpha line, would put Android on 1.5.0-alpha17.
3. **IDN API hosts are refused** (the `xn--` form works). The alternative is to implement punycode in common code.
4. **macOS CI at the start of Phase 10,** nightly and on demand. It costs about $30–60 a month while the repository is private, and nothing if it is public.
5. **iOS app in Phase 10, after Phase 5.** It needs a Mac with Xcode, and a $99-a-year Apple Developer account for devices, TestFlight and the NFC entitlement.
6. **iOS NFC: CoreNFC with NFCPassportReader 2.3.3** (MIT; its OpenSSL-Package is Apache-2.0), in an `ios/` Swift package. It needs the TAG reader entitlement and select identifier `A0000002471001`. JMRTD is Java-only and stays Android-only. The alternative is our own BAC/PACE in `commonMain`: more work and security-critical, but it would let Android drop LGPL JMRTD.
7. **`FlowApiClient(…, OkHttpClient)` becomes a factory function.** This breaks binary compatibility, which is fine while the SDK is unpublished.
8. **Consent locale from the shown texts** (K5): an intended fix.
9. **Stage 4 updates `CLAUDE.md`:** the android command and the layout row.
10. **CMP 1.12, Ktor 3.6 and OkHttp 5.5 wait** for a separate compileSdk 37 slice.

## Acceptance

- [ ] `:openverify-sdk` is KMP (`android`, `iosArm64`, `iosSimulatorArm64`). On Linux, `:openverify-sdk:assemble` compiles the iOS main and test klibs, and `compileCommonMainKotlinMetadata` is green.
- [ ] The baseline `class#testcase` set (616 tests) is contained in the new host results. Per-class counts are kept, the demo has 18 tests, the device test runs, and nothing is skipped.
- [ ] Kover is at or above 80% (95% or more expected), with a per-package before/after table in `docs/tdd/kmp-integration.tdd.md`.
- [ ] `demo-app` sources are unchanged. The public Android API is unchanged except for decision 7.
- [ ] `commonMain` has no OkHttp, `android.*`, `java.*` or `R.` import. `iosMain` holds only the K2 `actual`s.
- [ ] Both Android CI jobs are green on GitHub, with the new task names, the konan cache and the test floor.
- [ ] ADR 0004, the licence rows, `PLAN.md` §3/§6/§9, the Phase 5 amendments and `PROGRESS.md` are written.
