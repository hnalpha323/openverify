# ADR 0004: The mobile SDK on Kotlin Multiplatform and Compose Multiplatform

- **Status:** Accepted. Built on 2026-10-22 by the four-stage KMP migration Workflow (`kmp-foundation`, `kmp-network`, `kmp-ui`, `kmp-integration`) from `docs/plans/kmp-migration.plan.md`. The plan's ten decisions are the owner's defaults until the owner changes them.
- **Date:** 2026-10-22
- **Related:**
  - `docs/plans/kmp-migration.plan.md` (K1 to K9 and the decisions);
  - `docs/PLAN.md` §3, §6 (Phase 10) and §9;
  - ADR 0001, whose decision 1 chose Kotlin and Jetpack Compose for Android;
  - `THIRD_PARTY_LICENSES.md` §1, §2.1.6 and §2.2;
  - the evidence: `docs/tdd/kmp-foundation.tdd.md`, `kmp-network.tdd.md`, `kmp-ui.tdd.md` and `kmp-integration.tdd.md`.

## Context

On 2026-10-21 the owner asked: "we might need an iOS app later so make it in a language that we can easily port to iOS alongside Android".

`android/openverify-sdk` was an Android library before the change:

- **Code.** It had 41 main files and 4,767 lines: a Compose UI, an OkHttp flow client, CameraX capture, and 111 English and Spanish strings plus one plural as Android resources. 19 of the files already imported nothing from Android or the JVM: the model, MRZ, the flow engine and the API interfaces.
- **Tests.** 631 host tests in 31 classes, none skipped, and one device test. Kover line coverage was 97.76%.
- **Next.** Phase 5 was about to add a screen per new verification type.

The constraints:

- **No Mac.** The development machine and CI run Linux; there is no macOS and no Xcode.
- **Licences.** Rule 4 of `CLAUDE.md` allows permissive licences only, and every version must be at least 14 days old.
- **compileSdk 36.** It stays pinned. Compose UI 1.12, Ktor 3.6's OkHttp engine and OkHttp 5.5 need compileSdk 37.
- **The safety net.** The existing tests had to keep passing, case for case, through the change.

## Decision

1. **Keep Kotlin, and make `:openverify-sdk` one Kotlin Multiplatform (KMP) library** with three targets: `android`, `iosArm64` and `iosSimulatorArm64` (K1).
   - **Plugin.** It uses AGP 9's `com.android.kotlin.multiplatform.library`, because `androidTarget()` with `com.android.library` is incompatible with AGP 9's new DSL.
   - **No `iosX64`.** That target is tier 3 in Kotlin 2.4, and Compose Multiplatform 1.11 dropped Apple x86_64.
   - **Unchanged.** The artifact, the namespace and every package stay as they were. `demo-app` keeps its sources. `openverify-nfc` stays an Android library, the LGPL boundary.
   - **One module, not a split.** About 25 `internal` types would cross a core/UI boundary, and a split would triple the coverage gates and CI wiring for nothing iOS needs yet. An `openverify-core` without Compose can be extracted when a SwiftUI UI or build time needs one.
2. **Shared code lives in `commonMain`** (K2): the model, MRZ (`Mrz`, `BacKeySeed`), the flow engine (`FlowCoordinator`, `FlowNavigator`, `JsonLogic`), the flow API client, `InquiryViewModel`, the outcome mapping (`InquiryOutcomes`), every screen, `OpenVerifyTheme` and every string.
   - `androidMain` keeps what needs Android: the `ActivityResultContract` entry points (`OpenVerifyInquiry`), the activity and its intents (`InquiryResults`), CameraX, bitmap encoding, the system photo picker and the camera permission.
   - `iosMain` holds only the actuals.
3. **Platform boundaries** (K3) come in two kinds.
   - **Interfaces the host passes in:** `CaptureCamera`, `PhotoPicker` and `FlowApi`.
   - **Six internal `expect` declarations:**
     - `isOutOfMemory(Throwable)` and `CAPTURE_MIRRORS_IMAGES` in `camera/CapturePlatform.kt`;
     - `PLATFORM_NAME` and `defaultFlowHttpClient()` in `api/FlowHttpPlatform.kt`;
     - `@Composable rememberCameraPermission()` in `ui/CameraPermission.kt`;
     - `decodePreviewBitmap(ByteArray)` in `ui/ReviewImage.kt`.
   - **No `expect class`:** expect classes are still Beta.
   - **iOS placeholders never claim a capability.** The iOS camera permission is `CameraPermission.Unavailable`, so the gate says the camera is not available and offers only Cancel.
4. **Networking on Ktor 3.5.2** (K4). `FlowHttp`, `FlowApiClient` and `OneTimeLinkClient` are common code.
   - **Engines.** On Android, Ktor's OkHttp engine wraps the shared `OkHttpClient` (`preconfigured`), so its timeouts (15, 30 and 60 s), pool, TLS and listeners stay. On iOS the Darwin engine (NSURLSession) runs underneath.
   - **What is kept.** Redirects are never followed, there is no `ContentNegotiation` and no retry plugin, and the problem mapping is unchanged.
   - **The base URL.** It is parsed by a common, HttpUrl-compatible `ApiBaseUrl`. Its one intended difference from HttpUrl: an IDN host must be written in its `xn--` form (decision 3).
   - **Why Ktor, not OkHttp behind an interface.** One shared implementation covers multipart and error mapping, and one MockEngine suite tests it for both platforms. An interface would have needed a hand-written multipart encoder and an NSURLSession wrapper that Linux cannot test.
5. **Strings and locale** (K5).
   - **Resources.** The strings moved, unchanged apart from one placeholder, to Compose Multiplatform resources: `commonMain/composeResources/values{,-es}/strings.xml`, read through an internal `Res` in `dev.openverify.sdk.generated.resources`.
   - **Consent locale.** The consent screen reads `openverify_locale` in the same composition as its texts and sends it with the agreement. Consent is therefore recorded in the language shown, on both platforms (C37). `FlowCoordinator.Settings.locale` is only a fallback.
6. **The public Android API is unchanged except for decision 7.** `FlowApiClient(…, OkHttpClient)` is now a factory function, in the JVM facade class `FlowApiClients`. `FlowApiClient` keeps a public `(apiBaseUrl, sessionToken, json)` constructor. Kotlin callers still compile; Java and binary callers of the old constructor break, which is acceptable while the SDK is unpublished.
7. **Build and CI** (K6, K8).
   - **Versions:**
     - Kotlin 2.4.21 and AGP 9.4.1, unchanged;
     - Compose Multiplatform 1.11.1, with Material3 1.9.0;
     - the JetBrains lifecycle 2.9.6;
     - Ktor 3.5.2.

     On Android, CMP resolves to the Compose BOM's Jetpack Compose 1.11.4 and material3 1.4.0, so the Android UI does not change.
   - **The CI android job** runs `./gradlew testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint`. It caches `~/.konan` on the catalog's Kotlin version, and a floor step fails under 631 SDK host tests or on any skipped or failed one.
   - **The emulator job** runs `:openverify-sdk:connectedAndroidDeviceTest`.
8. **Tests** (K7).
   - **`testAndroidHostTest`** runs every test kind in one task: JUnit 5, Robolectric through the Vintage engine, and `commonTest`.
   - **`androidHostTest`** holds the former `src/test` suites, moved with `git mv`.
   - **`commonTest`** (kotlin.test, Ktor MockEngine, coroutines-test) holds the new seam tests, which run on the iOS simulator from Phase 10.
   - **`iosTest`** holds iOS-only tests that compile on Linux today.
   - **Kover** gates `commonMain` and `androidMain` at 80%.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Flutter or React Native | A rewrite in a new language and UI toolkit, which throws away the tested Kotlin flow engine, and still needs native camera and NFC bridges on both platforms |
| A separate Swift SDK | Duplicates the flow engine, the API client, MRZ and every screen, and the two would drift on contracts C1 to C42 |
| KMP logic with a SwiftUI UI | Possible later: an `openverify-core` without Compose would serve it. Not now, because every screen would be written twice |
| A core/UI/facade module split now | About 25 internal types would have to become public or opt-in, and the Kover gates and CI wiring would triple, for no iOS need yet (decision 1) |
| OkHttp and NSURLSession behind a hand-written interface | About 300 lines (a multipart encoder, an NSURLSession wrapper) that cannot be tested on Linux; two implementations to keep in step |
| `androidTarget()` with `com.android.library` | Incompatible with AGP 9's new DSL; the opt-out (`android.newDsl=false`) goes away in AGP 10 |
| Compose Multiplatform 1.12, Ktor 3.6 and OkHttp 5.5 now | They need compileSdk 37; a separate slice moves all three (decision 10) |
| The Material3 1.11 alpha line | It would move Android from material3 1.4.0 to 1.5.0-alpha17 (decision 2) |
| Punycode in common code | More code for a rare case; the `xn--` form works (decision 3) |

## Consequences

**What Linux CI proves, and what it does not.**
- **Proved on every push.** `:openverify-sdk:assemble` compiles the iOS main and test klibs, and `compileCommonMainKotlinMetadata` rejects JVM APIs in `commonMain`. The metadata compile alone misses missing iOS actuals, `iosMain` code and dependencies without iOS variants, which is why the klibs are compiled too.
- **Needs macOS.** Linking, the simulator and the device need a Mac. These stay unproven until Phase 10's macOS job: the iOS runtime (Kotlin/Native's regex engine, Skia decoding, Compose rendering, accessibility), the Darwin engine's behaviour, and Material3 1.9.0's linking.

**Costs.**
- **Toolchain.** The Kotlin/Native distribution is about 820 MB; CI caches it, and a cold unpack takes about 25 s.
- **Build time.** The local gate takes about 1.5 minutes with warm caches, against 1 minute 37 seconds for the smaller pre-migration task set.
- **macOS minutes.** They cost about 10 times Linux minutes: about $1 per 15-minute run, or $30 to $60 a month nightly and on demand while the repository is private, and nothing once it is public (decision 4).

**Rules the code now follows.**
- **No cinterop in `:openverify-sdk`.** A future cinterop, for example ONNX Runtime's C API, goes in a module of its own, so the SDK keeps compiling on Linux.
- **iOS dependencies.** Each `commonMain` dependency must publish `iosArm64` and `iosSimulatorArm64` variants.
- **Coverage.** Kover does not measure `iosMain`, so `iosMain` stays thin.
- **Resource names.** The KMP DSL has no `resourcePrefix`. `ResourcesTest` checks instead that the SDK's remaining Android resources (its window theme) keep the `OpenVerify_` or `openverify_` prefix.
- **String formatting.** Compose Multiplatform 1.11 fills only positional placeholders (`%1$s`, `%1$d`) and reads only the `\n`, `\t`, `\uXXXX` and `\\` escapes. The one plural moved from `%d` to `%1$d`. `ResourcesTest` refuses other format specifiers, Spanish placeholders that differ from the English ones, and Android escapes such as `\'`, which would reach the screen as written. The Stage 4 review added these guards.

**Behaviour that changed on purpose.**
- **Consent locale.** Consent records the language of the texts shown, not the language the flow started in (decision 8).
- **Locale source.** On Android, CMP follows the JVM default locale rather than the activity's configuration. The two agree, except under AppCompat's per-app language back-port below API 33. Every SDK text and the recorded consent locale follow the same source, so they stay consistent with each other.
- **The wire.** As captured byte for byte before and after the change, the only differences are a `Content-Length` header on each multipart part (the request keeps its total length and is not chunked) and Ktor's random multipart boundary. No `Accept-Charset` is sent. Android logs one SLF4J "no providers" warning per process.
- **The base URL.** A path prefix with a `%` outside a `%XX` escape is refused, because Ktor's `Url` cannot request it, where OkHttp sent it as it was. A malformed `xn--` label passes construction and fails each request.
- **Response bodies.** JSON is read as UTF-8 whatever charset the response names (RFC 8259 §8.1), skipping a leading byte order mark as OkHttp did.

**Licences.** Every added artifact is Apache-2.0 except the SLF4J API, which is MIT (`THIRD_PARTY_LICENSES.md` §2.1.6). On iOS, skiko's klib statically links Skia and its libraries, among them ICU, HarfBuzz, libjpeg, libpng, libwebp, zlib and the Adobe DNG SDK. Their notices must ship with the Phase 10 app, and the licences rule 4 does not name join Phase 5's decision 31. Nothing iOS is linked or shipped before Phase 10.

**Phase 10 work this leaves** (`docs/PLAN.md` §6):
- **Platform code.** The `iosMain` capture (AVFoundation with a `UIKitView` preview), ImageIO encoding (unmirrored, pinned by a pixel test), PHPicker and the AVCaptureDevice permission.
- **The app.** An XCFramework and an `ios/` SwiftUI shell hosting `ComposeUIViewController`, with an iOS `InquiryViewModel` factory. The SDK's `composeResources` must be inside the app bundle.
- **Swift interop.** The exceptions that reach Swift need `@Throws` or a result-returning facade. `@Throws` on the shared `FlowApi` would make Java callers catch a checked exception, so a facade is the likelier choice.
- **The Darwin client.** It currently runs on NSURLSession's default configuration, which has a URL cache and cookie storage, where OkHttp had neither. An ephemeral configuration, or `Cache-Control: no-store` on the flow API's responses, should keep flow responses off the iOS disk. Its timeouts (60 s without data) and cancellation also need a check against Android's.
- **The rest.** Skia images closed once the review bitmap is made; live-region announcements on CMP 1.11; iOS NFC through CoreNFC with NFCPassportReader (decision 6); the macOS CI job; and Burst for the parameterized suites in `commonTest`.

## As built: where the build departs from the plan's text

The stages recorded these departures in their evidence files; they are the plan as built.

- **Test counts.** The baseline was 631 SDK host tests in 31 classes plus the device test, not the plan's "616 in 32", which predates Workflow 4B. The CI floor is therefore 631. The strings were 111 per language plus one plural.
- **File names.**
  - `cleanDeviceLabel` lives in `commonMain/camera/DeviceLabel.kt`.
  - The camera `expect`s are in `camera/CapturePlatform.kt`, the network ones in `api/FlowHttpPlatform.kt`, with the `.android.kt` and `.ios.kt` actuals beside them.
  - The strict URL parser is `api/ApiBaseUrl.kt`; the fragment parser is `api/OneTimeLinks.kt`.
  - The UI `expect`s are in `ui/CameraPermission.kt` and `ui/ReviewImage.kt`.
  - `src/iosTest` holds three files: the out-of-memory test actual, `IosFlowHttpPlatformTest` and `IosPreviewBitmapTest`.
- **Network details.**
  - `okHttpFlowClient` restores a host app's `retryOnConnectionFailure`, which Ktor's engine forces on.
  - The shared `OkHttpClient` itself now refuses redirects.
  - The two MockEngine suites are named `FlowApiClientContractTest` and `OneTimeLinkClientContractTest`, because the common and host test compilations are one.
- **UI details.**
  - `CameraPermission` also has `available`, so the iOS placeholder can say the camera is unavailable.
  - `FlowCoordinator.acceptConsent` gained the `locale` parameter, and its retry keeps it.
  - `ConsentScreen`'s callback takes `(optionalTextKeys, locale)`.
- **Build details.**
  - `androidMain` still declares the androidx Compose `ui`, `foundation` and `material3` artifacts and `lifecycle-viewmodel-compose`. The last of these is now unused.
  - The build prints 11 harmless "KLIB loader: same unique_name" warnings for artifacts that CMP and androidx both publish.

## Results

| | Before (`4be9b6b`) | After (Stage 4) |
|---|---|---|
| SDK host tests | 631 in 31 classes | 928 in 48 classes, the 631 baseline cases all present with their per-class counts |
| Demo tests | 18 | 18 |
| Device tests | 1 | 1 (unchanged) |
| Kover line coverage | 97.76% (1568 / 1604) | 98.11% (1816 / 1851) |
| Code compiled for iOS | none | `commonMain` (about 84% of the main code), its tests and the iOS actuals |

The per-class and per-package tables are in `docs/tdd/kmp-integration.tdd.md`.
