# Phase 10 research: finishing and shipping the Android SDK (engineering)

Status: complete, 2026-10-29. Every section below was written as it was finished.

**Summary.**
- **Where Android stands.** The KMP SDK, the server-driven flow, CameraX capture, the selfie protocol, the `ActivityResultContract` API, the demo app, 1,264+ host tests with an 80% Kover gate, an emulator job and Linux iOS-klib compilation are built. Missing: an `ImageAnalysis` pipeline, on-device document gating, selfie guidance, PDF417, integrity signals, the whole NFC reader (`openverify-nfc` is an empty module), publishing, consumer R8 rules, an API dump and size gates (section 1).
- **Capture.** CameraX stays on 1.6.2 (1.7 is RC and moves Compose to compileSdk 37). Bind `ImageAnalysis` beside `Preview` and `ImageCapture`, and put every measure and the guidance state machine in `commonMain`; port the server's Laplacian, Tenengrad and HSV-glare measures as guidance only. No OpenCV.
- **Selfie.** `onnxruntime-android` 1.31.0 (MIT; Eigen MPL-2.0 inside needs the owner exception): 34 MB per arm64 install, 16 KB-aligned, and its AAR merges a telemetry content provider, `INTERNET` and `ACCESS_NETWORK_STATE`, with telemetry on by default; remove the provider with the manifest merger, set `ORT_DISABLE_TELEMETRY=1` first, and test both. Port the web flow's YuNet guidance and its golden constants.
- **PDF417 and integrity.** `io.github.zxing-cpp:android` 3.1.1 (Apache-2.0, 1.75 MB arm64, 16 KB-aligned) behind a common reader. Write our own emulator, root and hooking indicators (RootBeer's package checks are inert without `<queries>`); Play Integrity as an optional artifact plus an A-tier server adapter with a sandbox, bounded by 10,000 requests a day and a no-tracking term.
- **NFC.** JMRTD 0.8.9 and SCUBA 0.0.21 re-read: LGPL-2.1-or-later, plus SCUBA's two Oracle GPL-2.0-only Classpath-exception files, which still need the owner's exception; the server half (chip challenges, PA, AA) is built, so the client is a model, an API method, a common `ChipReader` and the JMRTD reader.
- **Shipping.** Central Portal via `com.vanniktech.maven.publish` 0.37.0 (prove it on AGP 9.4.1); a verified namespace, primary-key GPG signing; publish Android only; consumer rules must be published explicitly; Play blocks non-16 KB updates from 2027-02-01 (ours pass); target API 36 has been required since 2026-08-31 (the demo complies); the Kotlin plugin's experimental ABI validation, with BCV 0.18.2 as the fallback.
- **Testing.** Roborazzi 1.76.0 screenshots in the existing Robolectric task; Compose accessibility checks plus a manual TalkBack pass; a nightly emulator matrix including a 16 KB image; on the private repository a 15-minute emulator run costs about $0.09.

## 0. Scope, method and conventions

Prepared 2026-10-29 for OpenVerify Phase 10, "Android (iOS moves to the next release)" (`docs/PLAN.md` §6 [R1]). On 2026-10-29 the owner moved iOS to the next release: this release ships the web platform and Android, and the shared Kotlin Multiplatform code stays iOS-ready (new code in `commonMain` unless it needs a platform API, every platform seam behind a common interface, Linux CI compiling the iOS klibs) [R1]. This note is the **engineering** half of Phase 10 for Android: what is left to build in `android/` and how to ship it. Persona's public mobile behaviour is not re-derived here; where a public identifier matters it comes from the repository's surface index [R29] or PLAN §2 [R1].

**Conventions.** Everything is in our own words. Identifiers (class and method names, Gradle task and property names, manifest attributes, configuration keys, URL paths, enum values) are reproduced only for functional parity. Anything the sources do not state is marked **not documented**; a statement we infer and no source makes is marked **(inference)**. Every claim carries a citation key defined in section 9, with the URL and the read date (all 2026-10-29). Licence verdicts use repository rule 4 [R2]: ✅ passes, ⚠️ passes with a caveat or needs an owner decision, ❌ fails. Tiers R / H / A are those of ADR 0002 [R3].

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, and Gradle follows the same rule by project convention, so a pinnable version was released on or before **2026-10-15**. Each dependency row gives the latest version and the newest one that passes.

**Method.**
- The repository was read, never changed, at `91c83e02` (Phase 6 being closed by other agents in the same tree): `docs/PLAN.md` §2, §3, §5, §6, §9; `CLAUDE.md`; ADRs 0001 to 0005 (0004 in full); the surface index; every file under `android/` except generated output (215 files: settings and build scripts, the catalog, the wrapper properties, every `openverify-sdk` source set, `openverify-nfc`, `demo-app` and their tests); the `android` and `android-instrumented` jobs of `.github/workflows/ci.yml`; `packages/contracts/src/chip-challenges.ts`; `packages/flow-spec/src/flow.ts`; `models/manifest.json`; `THIRD_PARTY_LICENSES.md`; the KMP migration plan and the Phase 3 to 8 plans; the Phase 3, 4, 5 and 7 research notes that Phase 10 builds on; the server's quality measures, the selfie-capture fixture and the web flow's guidance modules [R1]–[R35]. No build, test, Gradle or pnpm command was run.
- Package facts come from Maven Central's `maven-metadata.xml`, each version's POM `Last-Modified` date and, for native libraries, range reads of the AAR itself; licences from the LICENSE file at the release tag. Google Maven could not be read (its host disallows robots, section 9), so Google artifacts rest on Android Developers pages. Platform rules come from the issuing body's own pages (Android Developers, Google Play Console Help, Sonatype Central, Kotlin, GitHub Docs); ICAO and BSI facts are taken from the Phase 5 note, which read them [R18]. Every host's `robots.txt` was read before any other request to it, at most one request per second per host, with a descriptive User-Agent without contact details and no personal data sent. Downloads went into new, empty directories under `downloads/<name>/`; scripts are in `scripts/`; Python ran with `-I`; nothing downloaded was executed.
- Earlier research is reused, not repeated: on-device face runtimes and ONNX Runtime's telemetry (`phase4-models.md` §1b [R19]), barcode libraries (`phase3-libraries.md` §1 [R20]), JMRTD, SCUBA and chip protocols (`phase5-nfc.md` §4, §7 [R18]) and Android device signals (`phase7-client-signals.md` §4 [R22]). Where this note gives a newer version or date than those notes, the newer reading is the one dated here.

## 1. Phase 10 items against the code today

Each line of PLAN §6 Phase 10 [R1], plus the shipping work the phase implies, against `android/` at `91c83e02`. **Built** means the code and its tests exist; **partly built** means the seam or the protocol exists and the Phase 10 capability does not; **placeholder** means a module or type exists with nothing behind it; **missing** means nothing exists yet.

| Phase 10 item | State | What exists, and what is left | File that shows it |
|---|---|---|---|
| `openverify-sdk` as one KMP library (`android`, `iosArm64`, `iosSimulatorArm64`) on AGP 9's KMP library plugin | **built** | Done by the KMP migration; `commonMain` holds about 84% of the main code | `android/openverify-sdk/build.gradle.kts` [R6]; ADR 0004 [R4] |
| Server-driven flow renderer (Compose Multiplatform) on the shared `flow-spec` | **built, with gaps** | `FlowCoordinator`, `FlowNavigator`, the JSONLogic subset and screens for consent, government ID, selfie, the eight Phase 5 types, completion and failure. Three flow-spec step types still decode as `UnsupportedStep`: `nfc` (this phase), `form` (no screen on the web either; `flow-position.ts` returns `unsupported`) and `device_handoff` (Phase 7 adds a model entry only) | `commonMain/.../model/Flow.kt` (`known` map) [R12]; `apps/flow/src/flow/flow-position.ts` [R30]; Phase 7 C96.1 [R21] |
| CameraX document capture | **built** | `CameraXCaptureCamera`: `Preview` plus `ImageCapture` (`CAPTURE_MODE_MINIMIZE_LATENCY`, target 1920×1440), in-memory capture, upright JPEG at quality 90 capped at 2,048 px, no EXIF; a card or page guide overlay; one device test on the emulator | `androidMain/.../camera/CameraXCaptureCamera.kt`, `ImageEncoding.kt` [R10]; `androidDeviceTest/.../CameraXCaptureCameraTest.kt` |
| On-device document quality gating (blur, glare, framing) | **missing** | No `ImageAnalysis` use case is bound; the shutter is manual and nothing is measured before upload. The server already runs the R-tier blur and glare checks (PLAN §4.1) | `CameraXCaptureCamera.kt` binds `preview` and `imageCapture` only [R10] |
| Selfie active liveness: the capture protocol | **built** | C40.2–C40.4: server-ordered poses, nonce, per-pose upload with `client-elapsed-ms` on the monotonic clock, a 180 s capture TTL, the camera kept open across prompts, the C40.4 device snapshot | `commonMain/.../model/SelfieCapture.kt`, `flow/SelfieCaptureProtocol.kt`, `camera/CameraFacts.kt` [R11] |
| Selfie on-device guidance with `onnxruntime-android` and YuNet | **missing** | `SelfieCaptureGuidance` (`max-center-yaw-ratio`, `min-side-yaw-ratio-change`, `hold-ms`) is decoded and its comment says Phase 10 uses it; no ONNX Runtime dependency, no model asset, no detector, no auto-capture | `SelfieCapture.kt` [R11]; `libs.versions.toml` has no `onnxruntime` [R5] |
| PDF417 on Android behind a common interface | **missing** | No barcode library in the catalog; no `BarcodeReader`-style seam in `commonMain`. The server decodes PDF417 with zxing-cpp (Phase 3) | `libs.versions.toml` [R5]; Phase 3 plan line 423 [R26] |
| Device signals: root/emulator, optional Play Integrity adapter | **missing** (Phase 7 lays the contract) | Phase 7 C94.7 adds `DeviceSignals` (common interface, Android implementation, iOS placeholder), the `ANDROID_ID` HMAC and debugger facts; Phase 10 adds emulator, root and hooking heuristics and Play Integrity (Phase 7 decision 12). Today the SDK sends only the C40.4 camera snapshot | Phase 7 plan C94.7, C110, decision 12 [R21]; `CameraFacts.kt` [R11] |
| `ActivityResultContract` API | **built** | `OpenVerifyInquiry.Contract` (session token) and `OneTimeLinkContract` (one-time link), `InquiryResult` and `FailureReason`; the activity sets `FLAG_SECURE`; only `INTERNET` and `CAMERA` permissions, `camera.any` not required | `androidMain/.../OpenVerifyInquiry.kt`, `OpenVerifyInquiryActivity.kt`, `AndroidManifest.xml` [R14] |
| `openverify-nfc`: BAC/PACE with the MRZ key, DG1/DG2/SOD read and upload, chip and active authentication | **placeholder** | An empty `com.android.library` with a README and NOTICE, no dependency and no code. Ready around it: `BacKeySeed.mrzInformation` (common, tested), the chip `FileKind`s (`chip-sod`, `chip-dg1`, `chip-dg2`, `chip-dg14`, `chip-dg15`, `chip-card-security`, `chip-card-access`, `chip-com`), the server's chip-challenge route and submit `chip` member (C62.5), Passive Authentication and AA verification (C62). Missing on the client: a `FlowApi` method for `POST …/chip-challenges`, the submit's `chip` member, an NFC step model and screen, and the reader | `android/openverify-nfc/*` [R7]; `commonMain/.../mrz/BacKeySeed.kt`; `model/WireEnums.kt` [R12]; `FlowApi.kt` (no chip method) [R13]; `packages/contracts/src/chip-challenges.ts` [R15]; Phase 5 C62 [R17] |
| `demo-app` | **built (minimal)** | Paste an inquiry id and session token, or a one-time link, and launch either contract; no credentials bundled; debug-only cleartext config. No NFC wiring, no release build type with R8, no Play Integrity wiring | `android/demo-app/**` [R8] |
| Tests: JVM unit, Robolectric + Compose UI (`androidHostTest`), `commonTest`, Kover ≥ 80% | **built** | 62 host-test files (620 `@Test` methods and 51 `@ParameterizedTest`), 15 `commonTest` files (106), 3 `iosTest` files (4), 12 demo tests; CI floor 1,264 SDK host test cases; Kover line gate 80% on the SDK (CameraX glue and generated resources excluded). No accessibility checks, no screenshot tests; `openverify-nfc` has no tests and no Kover | `openverify-sdk/src/*Test/**` [R31]; `ci.yml` floor step [R9]; `build.gradle.kts` `kover {}` [R6] |
| Instrumented tests in GitHub Actions | **built** | `android-instrumented` boots an API 34 `google_apis` x86_64 emulator with KVM and runs `:openverify-sdk:connectedAndroidDeviceTest` (one test); API 36 never booted on the private repository's 2-vCPU runner | `.github/workflows/ci.yml` [R9] |
| iOS-readiness on Linux | **built** | `:openverify-sdk:assemble` compiles the iOS main and test klibs on every push; `~/.konan` cached on the Kotlin version | `ci.yml` [R9]; ADR 0004 Consequences [R4] |
| Publishing (Maven Central), signing, POM metadata | **missing** | No `maven-publish`, signing or publishing plugin anywhere; version string `0.1.0` lives only in `FlowHttp.SDK_VERSION` | `grep` of every `*.kts` [R6][R7]; `commonMain/.../api/FlowHttp.kt` |
| Consumer R8/ProGuard rules | **missing** | No `consumer-rules.pro` and no minified build anywhere (the demo has no release minification) | `android/**` [R6][R8] |
| Native-library page size (16 KB) | **not yet relevant** | The SDK ships no `.so` today; ONNX Runtime and zxing-cpp would add them (section 6.3) | `libs.versions.toml` [R5] |
| Public API compatibility check | **missing** | No binary-compatibility validator or API dump; ADR 0004 decision 6 accepted a binary break "while the SDK is unpublished" | ADR 0004 [R4] |
| Binary size budget | **missing** | No measurement or gate | — |

## 2. Carried into this phase

Every item that an earlier plan (or the progress log) hands to Phase 10 and that falls in this note's subject, found by grepping `docs/plans/*.md` for "Phase 10", "Phase 11", "later phase", "deferred to" and "until Phase", and `docs/PROGRESS.md` for the carried lists. The last column says where it goes now that iOS waits for the next release (owner decision of 2026-10-29 [R1]).

| # | Item | Plan and line | Where it goes now |
|---|---|---|---|
| K1 | On-device PDF417 decoding with `io.github.zxing-cpp:android` (and in-browser `zxing-wasm`) belongs to "the capture work of Phase 4 and Phase 10" | `docs/plans/phase-3.plan.md:423`, decision 12 at `:916` [R26] | **Phase 10 (Android)**; section 4.1 |
| K2 | Android follows the selfie protocol with a manual shutter; on-device guidance is Phase 10 | `docs/plans/phase-4.plan.md:33`, `:336` [R25] | **Phase 10**; section 3.3 |
| K3 | "selfie active liveness with MediaPipe" becomes `onnxruntime-android`; no MediaPipe on Android (telemetry with no opt-out); its telemetry provider removed | `docs/plans/phase-4.plan.md:354`, decision 1 at `:475` [R25]; `docs/research/phase4-models.md` §1b [R19] | **Phase 10**; section 3.3 |
| K4 | Eigen (MPL-2.0) compiled into ONNX Runtime needs an explicit owner exception to rule 4 when it ships (decision 11, still pending in `THIRD_PARTY_LICENSES.md` §5) | `docs/plans/phase-4.plan.md:485` [R25]; `THIRD_PARTY_LICENSES.md:385` [R24] | **Phase 10 owner decision**: the Android AAR ships Eigen inside `libonnxruntime.so` (section 3.3) |
| K5 | "No client produces chip data": the e2e acts as a Phase 10 client | `docs/plans/phase-5.plan.md:81` [R17] | **Phase 10**: the Android reader becomes the first real client; the e2e stays the API-driven client |
| K6 | The NFC step stays the unsupported screen on both clients until Phase 10 | `docs/plans/phase-5.plan.md:557`, `:1162` [R17] | **Phase 10 (Android)**; the web keeps the unsupported screen (or a handoff to the phone) |
| K7 | SCUBA's two `GPL-2.0-only WITH Classpath-exception-2.0` files must be decided before Phase 10 adopts them (Phase 5 decision 40, re-stated by C67 at `:812`) | `docs/plans/phase-5.plan.md:758`, `:812` [R17]; `docs/PLAN.md:505` [R1] | **Phase 10 owner decision**, blocking `openverify-nfc`; section 5.2 |
| K8 | Confirm the exact LGPL version of JMRTD 0.8.9 and SCUBA; decide on compileSdk 37 | `docs/PROGRESS.md:1316` [R27] | **Phase 10**: sections 5.1 and 6.4 |
| K9 | Crypto wallets are paste-only on Android until Phase 10 | `docs/plans/phase-5.plan.md:1283` [R17] | **Phase 10 owner decision**; not in PLAN §6's Phase 10 list. Default: stay paste-only this release (a wallet-connection SDK needs a relay account, so it would be an adapter) **(inference)** |
| K10 | Emulator, root and hooking heuristics and Play Integrity on Android | `docs/plans/phase-7.plan.md:635`, C110 at `:1488`, decision 12 at `:1941` [R21] | **Phase 10 (Android)**; sections 4.2 and 4.3 |
| K11 | An iOS handoff target (the phone side of `device_handoff` on iOS) | `docs/plans/phase-7.plan.md:1488` [R21] | **Next release (iOS)** |
| K12 | The Android SDK README states what the SDK reads per tier and the Play Data safety entries the host must declare (written by Phase 7 for `ANDROID_ID`) | `docs/plans/phase-7.plan.md:1481` [R21] | **Phase 10 extends it** for camera images, NFC chip data, integrity signals and Play Integrity |
| K13 | Phase 10 NFC challenges add `expect fun secureRandomBytes(n)` | `docs/plans/kmp-migration.plan.md:93` [R23] | **Phase 10, probably not needed**: the AA nonce comes from the server (C62.5) and JMRTD draws its own BAC/PACE randomness inside `openverify-nfc` **(inference from [R15][R18])**; add it only if `commonMain` ever does chip crypto |
| K14 | `onnxruntime-android` in `androidMain`; iOS through ONNX Runtime's C API by cinterop in a module of its own; PDF417 zxing on Android, Apple Vision on iOS, behind common interfaces | `docs/plans/kmp-migration.plan.md:154` [R23]; `docs/PLAN.md:436–437` [R1] | **Android half in Phase 10; iOS half next release**; the common interfaces are Phase 10's (section 8) |
| K15 | JUnit 5 parameterized suites move their pure parts to `commonTest` with Burst | `docs/plans/kmp-migration.plan.md:44`, `:137` [R23]; `docs/PLAN.md:458` [R1] | **Next release** (PLAN now puts it there); optional earlier, since the move only pays off on a simulator **(inference)** |
| K16 | macOS CI job (`iosSimulatorArm64Test`), the iOS app, the XCFramework, iOS NFC through CoreNFC with NFCPassportReader | `docs/plans/kmp-migration.plan.md:147`, decisions 4–6 at `:199–201` [R23]; ADR 0004 "Phase 10 work this leaves" [R4] | **Next release** (`docs/PLAN.md:451–458` [R1]) |
| K17 | Darwin engine behaviour; CMP 1.12's iOS live-region support; compileSdk 37 unlocks CMP 1.12, Ktor 3.6 and OkHttp 5.5 (decision 10: a separate compileSdk 37 slice) | `docs/plans/kmp-migration.plan.md:188`, `:189`, `:205` [R23] | **iOS parts next release; the compileSdk 37 slice is Phase 10's** (section 6.4) |
| K18 | `commonTest` runs on the iOS simulator "from Phase 10" | `docs/plans/phase-5.plan.md:105` [R17]; `docs/plans/kmp-migration.plan.md:136` [R23] | **Next release** |
| K19 | iOS placeholders claim nothing (`countryName` null, no text copier) until Phase 10; an iOS `DocumentPicker` in Phase 10 | `docs/plans/phase-5.plan.md:926` [R17]; `docs/PROGRESS.md:309`, `:407`, `:461` [R27] | **Next release**; the placeholders stay as they are |
| K20 | Gradle hygiene: declare kotlinx-io and skiko directly, drop the unused `lifecycle-viewmodel-compose` from `androidMain` | `docs/PROGRESS.md:514` [R27]; ADR 0004 "As built" [R4] | **Phase 10** (cheap; it matters before publishing a POM, section 6.1) |
| K21 | skiko's statically linked Skia libraries (ICU, HarfBuzz, libjpeg, libpng, libwebp, zlib, the Adobe DNG SDK) need their notices in the app; their licences join Phase 5 decision 31 | ADR 0004 "Licences" [R4] | **Next release** (only the iOS klib links Skia; Android uses the platform's Skia) **(inference)** |

## 3. Capture: CameraX, on-device document quality, the selfie

### 3.1 CameraX and the frame pipeline

**Versions.** The catalog pins CameraX **1.6.2** (`camera-core`, `-camera2`, `-lifecycle`, `-compose`) [R5]. The release page lists 1.6.0 (2026-03-25), 1.6.1 (2026-05-06) and **1.6.2 (2026-08-26)** as the stable line, and 1.7.0-alpha01 to alpha03 and **1.7.0-rc01 (2026-10-21)** as the next [C1]. 1.6.2 is both the newest stable and the newest that passes the release-age rule; 1.7.0-rc01 is a release candidate younger than 14 days. 1.7.0-alpha02 moved the CameraX Compose artifacts to compileSdk 37, which needs AGP 9.2.0 or later [C1], so 1.7 belongs in the compileSdk 37 slice (section 6.4). Licence: Apache-2.0 (camera-core also lists BSD-3-Clause), as recorded in the catalog and `THIRD_PARTY_LICENSES.md` [R5][R24]; the POM was not re-read, because Google Maven's host disallows all robots (section 9). ✅

**What is bound today.** `CameraXCaptureCamera` binds a `Preview` (with a Camera2 interop callback that only reads the frame rate) and an `ImageCapture` in minimum-latency mode at a 1920×1440 target; the photo is converted in memory to an upright JPEG (quality 90, longest side 2,048 px, no EXIF) [R10]. There is no `ImageAnalysis`, so nothing on the device looks at a frame before the user presses the shutter.

**What the analysis use case gives.** CameraX allows one instance each of `Preview`, `VideoCapture`, `ImageAnalysis` and `ImageCapture` at once; some cameras support a combination only at lower resolutions; an incompatible combination fails when the capture session is created; and all use cases should be bound in one `bindToLifecycle` call [C3]. `ImageAnalysis` keeps only the latest frame by default (`STRATEGY_KEEP_ONLY_LATEST`, a queue of depth one); `STRATEGY_BLOCK_PRODUCER` queues frames and can stall the preview; the default format is `YUV_420_888`, and `OUTPUT_IMAGE_FORMAT_RGBA_8888` makes CameraX convert to RGBA in plane 0; the analyzer must call `ImageProxy.close()`; analysis should finish within the frame interval (under about 32 ms at 30 fps) [C2]. 1.5.0 added NV21 output [C1].

**Proposed pipeline (ours).**
- Bind `Preview` + `ImageCapture` + `ImageAnalysis` in the one existing `bindToLifecycle` call, analysis at a small target resolution (the selfie fixture's `preview-width-px` is 320 [R34]; documents need more, about 640 px wide **(inference)**), `STRATEGY_KEEP_ONLY_LATEST`, RGBA output (glare needs saturation, which the Y plane alone does not carry), and an analyzer that samples at the fixture's `guidance-hz` (8) and drops the rest [R34].
- If binding three use cases fails on a device (a runtime error at session creation [C3]), rebind `Preview` + `ImageCapture` and fall back to today's manual shutter. Guidance is an aid; its absence must never block a capture.
- **Where the code goes (iOS-ready).** `CaptureCamera` gains a common `frames(): Flow<AnalysisFrame>` (width, height, rotation, pixel layout, bytes; a default empty flow so fakes and the iOS placeholder keep compiling). Everything that reads pixels — the document measures, the YuNet pre- and post-processing, the yaw ratio, the guidance state machine, the PDF417 trigger — is pure Kotlin in `commonMain`. Only frame acquisition (`ImageAnalysis`) and model inference (ONNX Runtime) are in `androidMain`, behind interfaces (section 8).
- **Mirroring.** The upload is never mirrored (`ImageEncoding.MIRRORS_IMAGES = false`, pinned by a pixel test) [R10]. The web guidance reads the raw, unmirrored frame so that "YuNet sees what the server sees" [R35]; Android must do the same and treat preview mirroring as display only, so that a left prompt means the same head turn on both clients and on the server **(inference from [R10][R35])**.

### 3.2 On-device document quality gating

**What the server already measures** (`services/vision/src/openverify_vision/quality.py` [R32]): blur as the variance of the Laplacian with a minimum of 100 (`DEFAULT_BLUR_MIN`) and a Tenengrad score; glare as the share of pixels whose HSV value is at least 250 and saturation at most 40, with a maximum share of 0.05 (`DEFAULT_GLARE_MAX`); brightness between 0.15 and 0.9. These are R-tier `user_behavior` checks on the server (PLAN §4.1 `id_blur_detection`, `id_glare_detection` [R1]).

**Proposal (ours).** The same three functions, ported to `commonMain` over the analysis frame, decide only *when to take the photo* and *what hint to show* (move closer, tilt away from the light, hold still). They never decide a check: the server re-measures every upload, as the web selfie guidance already promises (Phase 4 C46: "the guidance never decides anything") [R25].
- **Thresholds.** The server's thresholds are for a rectified crop at full resolution; a 640-pixel preview frame gives different numbers, so the client needs its own constants **(inference)**. Put them in a contract fixture of their own (for example `contracts/fixtures/flow/document-capture.json`, ours), mirrored from `selfie-capture.json`'s `client` block [R34], and calibrate them on the synthetic ID fixtures with the Phase 4 harness pattern.
- **Framing.** The capture screen already draws an ID-1 card guide and an A4 page guide [R10]. A cheap framing gate is ours: edge energy concentrated along the guide's four borders and little outside it. Real quad detection stays on the server (`id_unprocessable_submission_detection` [R1]).
- **Auto-capture and the manual shutter.** Take the `ImageCapture` photo (full resolution, not the analysis frame) once every gate has held for a hold time; keep the shutter button always available and show it prominently after a timeout, as the selfie fixture's `manual-shutter-after-ms` (10,000 ms) does [R34], so a user who cannot satisfy the gates (motor impairment, an old camera) still proceeds.
- **OpenCV is not needed.** `org.opencv:opencv` (Apache-2.0) is at 5.0.0 (2026-06-11), 5.0.0.1 (2026-06-26) and 4.14.0 (2026-07-21) on Maven Central [M1]; the Phase 4 note measured the 5.0.0 AAR at 153 MB with a 33.5 MB arm64 library [R19]. Laplacian variance, Tenengrad, an HSV threshold and edge projections are a few hundred lines of Kotlin **(inference)**, testable on the JVM and compiled for iOS. ⚠️ (licence passes; size and the copy of OpenCV it would add argue against it)

### 3.3 The selfie: ONNX Runtime, YuNet and the active-liveness prompts

**`com.microsoft.onnxruntime:onnxruntime-android`** [M1][M2][L1][L2][L3]

| Fact | Value |
|---|---|
| Latest | 1.31.1 (2026-10-26): too new |
| Newest that passes | **1.31.0 (2026-10-09)**; earlier 1.30.0 (2026-09-14), 1.29.0 (2026-08-12), 1.28.0 (2026-07-27) |
| Licence | MIT (`LICENSE` at tag v1.31.0) ✅; **Eigen (MPL-2.0) is compiled in** (`ThirdPartyNotices.txt` at v1.31.0 lists it with the MPL-2.0 text) ⚠️: it ships inside the SDK, so rule 4's tooling exception does not cover it, and Phase 4 decision 11's owner exception (still pending in `THIRD_PARTY_LICENSES.md` §5 for onnxruntime-web) must be extended to Android [R24][R25]. SQLite (public domain) is also listed |
| AAR | 55,138,854 bytes, minSdk 24, four ABIs |
| `libonnxruntime.so` per ABI (uncompressed / compressed in the AAR) | arm64-v8a 34.2 MB / 12.9 MB; armeabi-v7a 24.2 / 11.6 MB; x86 40.7 / 15.1 MB; x86_64 40.8 / 15.0 MB; plus `libonnxruntime4j_jni.so` of 90–123 KB each |
| 16 KB pages | Every `PT_LOAD` segment of every library on all four ABIs has `p_align` 16384 ✅ (read from the ELF program headers by range requests, section 9) |
| Merged manifest | `ACCESS_NETWORK_STATE` and `INTERNET` permissions, and a non-exported `ai.onnxruntime.TelemetryInitializer` content provider (`initOrder` 100, authority `${applicationId}.onnxruntime_telemetry_initializer`) |
| Consumer R8 rules | Keep only `ai.onnxruntime.TelemetryInitializer` and the `ai.onnxruntime.telemetry.HttpClient*` classes |
| Telemetry (`docs/Privacy.md` at v1.31.0) | ON by default in official builds, Android included, through the 1DS SDK; on Android and iOS it keeps the SDK's platform device identifiers, and on Android it uses Java HTTP with native SQLite storage. Off by: setting `ORT_DISABLE_TELEMETRY=1` before ONNX Runtime initialises (no uploader, events or persistent device id for the process); an API that suppresses non-essential events (a minimal initialisation event may already have been sent); or a source build with `--no_telemetry` |

**Neutralising the telemetry, as the plan requires** (PLAN §6 "its telemetry provider removed" [R1]; Phase 4 decision 1 [R25]). Three layers, all ours:
1. The SDK manifest removes the provider and the extra permission with the manifest merger: `<provider android:name="ai.onnxruntime.TelemetryInitializer" tools:node="remove" />` and `<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" tools:node="remove" />`; an R8 rule then lets the telemetry classes go **(inference: ORT's own rule keeps them; a `-keep` cannot be undone by a consumer, so the classes stay in the dex but are never reached)**.
2. `android.system.Os.setenv("ORT_DISABLE_TELEMETRY", "1", true)` before the first `OrtEnvironment` call, in the one class that creates it [L3].
3. Tests: a host test over the demo-app's merged manifest (no `TelemetryInitializer`, no `ACCESS_NETWORK_STATE`); a device test that runs YuNet with the provider removed, because ORT does not document what happens without it (**not documented**).

A **custom build** with `--no_telemetry` and only YuNet's operators (`tools/android_custom_build/build_custom_android_package.py` with `--include_ops_by_config`, built in Docker [L4]) would remove the telemetry code and most of the 34 MB; ORT's documentation gives no size figure for it, so a Phase 10 spike should measure it before the owner chooses (section 11). It still contains Eigen **(inference)**. Pinning 1.28.0, which had no telemetry provider [R19], trades three months of fixes for it and is not recommended.

**YuNet.** `face_detection_yunet_2026may.onnx`, 229,738 bytes, SHA-256 `ebafce4e…22f0f0`, MIT at opencv_zoo commit `47534e2` (upstream libfacedetection.train, BSD-3-Clause) [R28]; ✅ by its weight licence, with the documented caveat that its training set, WIDER FACE, is CC-BY-NC-ND (Phase 4 note §0 item 4, still an open policy item) [R19]. Rule 6 forbids committing weights [R2], so the SDK must fetch it at build time the way the web flow does: `apps/flow`'s Vite plugin copies YuNet from `models/` and refuses a SHA-256 that differs from `models/manifest.json` [R33]. Android needs the same: a Gradle task that runs `python3 scripts/fetch_models.py --only face_detection_yunet` (the option exists [R33]) and copies the file into a generated `androidMain` assets directory after checking the digest; the published AAR then carries the 230 KB model with its MIT notice.

**The prompts.** The server half is built: the capture's ordered poses, nonce, 180 s lifetime and per-pose uploads (C40) [R11]. The client constants for guidance are already in `contracts/fixtures/flow/selfie-capture.json`: `hold-ms` 500, `side-trigger-factor` 1.25, `center-trigger-factor` 0.8, `guidance-hz` 8, `preview-width-px` 320, `manual-shutter-after-ms` 10,000, `camera-stays-open` true; the server thresholds are `max-center-yaw-ratio` 0.021 and `min-side-yaw-ratio-change` 0.077, measured with YuNet itself [R34]. The web flow implements the client in `apps/flow/src/guidance/`: YuNet input sizing, decoding over strides 8, 16 and 32, a five-landmark `yawRatio`, and a guidance state machine with a face-score threshold of 0.9 [R35]. **Port that logic to `commonMain`** and test it against the same golden vectors, as `MrzVectorsTest` already does for the MRZ [R31]; the Android-only part is `OrtSession.run`.

**Accessibility of the prompts.** Each prompt title is already a polite live region [R10]. Auto-capture adds a moving target: announce each state change once (not at 8 Hz), keep the manual shutter after the timeout, and never time the user out of a pose (the 180 s capture limit stays the only limit; Workflow 4B left its WCAG 2.2.1 treatment as an owner question) [R27].

**Honesty.** On-device guidance is not liveness. It shortens capture and cuts retries; the liveness decision stays on the server (MiniFASNet ensemble, pose verification, pose-repeat; PLAN §4.2 [R1]). It does not cover camera injection (a virtual camera, a hooked `ImageReader`), replays on a rooted device or a modified app (PLAN §9 risk 1) [R1]; section 4 adds signals about the environment, which are also not proof.

**Alternatives, unchanged from Phase 4** [R19]: MediaPipe Tasks (every Android AAR sends usage data with no opt-out) ❌; ML Kit face detection (ML Kit terms, closed binary) ❌; OpenCV's `FaceDetectorYN` (same model, about 153 MB AAR) ⚠️ size. LiteRT was not evaluated here (Gaps).

## 4. PDF417, device integrity and Play Integrity

### 4.1 PDF417 on the device

The server already decodes PDF417 with zxing-cpp and runs the AAMVA checks (Phase 3) [R1][R20]. On the device the barcode is **capture guidance only**: it tells the user that the back of a US card was captured with a readable barcode, and it can trigger the shutter. The decoded text is never evidence; the server decodes the uploaded image again (ADR 0002 rule 3a's spirit: the client's claim is not a result) **(inference)**.

| Library | Version (latest / newest passing) | Licence | Size and native code | Verdict |
|---|---|---|---|---|
| **`io.github.zxing-cpp:android`** | 3.1.1 (2026-07-29) / 3.1.1 [M1] | Apache-2.0: POM, and `LICENSE` at tag v3.1.1 [L6] | AAR 2.94 MB; `libzxingcpp_android.so` arm64-v8a 1.75 MB uncompressed (0.73 MB compressed), armeabi-v7a 1.23 MB, x86 1.85 MB, x86_64 1.82 MB; every `PT_LOAD` 16 KB-aligned on all four ABIs; consumer rule `-keep class zxingcpp.** { *; }`; depends on `camera-core` 1.5.2 (our 1.6.2 wins) and `kotlin-stdlib` 2.3.20 [M3] | ✅ **use** (as Phase 3 recommended [R20]). Active: three 2026 releases (3.0.0 on 2026-02-10 to 3.1.1) [G1]. It reads `ImageProxy` frames, so it sits on the same `ImageAnalysis` stream as section 3 |
| `com.google.zxing:core` | 3.5.4 (2025-11-11) / 3.5.4 [M1] | Apache-2.0 (`LICENSE` at `zxing-3.5.4`) [L5] | 610 KB pure-Java jar [M6]; no native code, so no page-size question | ⚠️ fallback only: its README at the tag says the project is in maintenance mode, with changes driven by contributed patches, and points to zxing-cpp as the active port [L5] |
| `com.journeyapps:zxing-android-embedded` | 4.3.0 (2021-10-25) | Apache-2.0 | wraps zxing core | ❌ not recommended: stale [R20] |
| ML Kit barcode scanning | — | ML Kit terms (closed binary) | — | ❌ for the reasons Phase 4 gave for ML Kit face detection [R19] **(inference: same terms family; the barcode POM was not read)** |

**Seam (ours).** A common `BarcodeReader` interface (`suspend fun readPdf417(frame: AnalysisFrame): ByteArray?`, raw bytes because AAMVA control characters matter, as Phase 3 found for zxing-cpp's text mode [R20]) with the zxing-cpp implementation in `androidMain`; the iOS implementation (Apple Vision) waits for the next release (PLAN §6 [R1]). Tests: host tests through a fake reader; one device test that decodes a synthetic PDF417 rendered by the Phase 3 fixture generator.

### 4.2 Root, emulator and hooking indicators

Phase 7 C94.7 lays the contract: a common `DeviceSignals` interface with the Android implementation and an iOS placeholder, debugger facts and the `ANDROID_ID` HMAC; Phase 10 adds emulator, root and hooking heuristics (Phase 7 decision 12) [R21]. The Phase 7 research already lists the heuristics and their limits: `Build` fields for emulators (the platform says not to parse `FINGERPRINT`), `su` paths, `test-keys`, a writable `/system`, root-manager packages, Frida and Xposed traces; ADB and developer settings read 0 to third-party apps [R22].

| Option | Version | Licence | Notes | Verdict |
|---|---|---|---|---|
| **Our own heuristics** in `androidMain` | — | Apache-2.0 (ours) | Small, fully testable under Robolectric with shadowed `Build` values and a fake file system **(inference)**; reported as facts with reasons | ✅ **recommended** |
| `com.scottyab:rootbeer-lib` | 0.1.2 (POM 2026-03-17; GitHub release 2026-03-07) / 0.1.2 [M1][G1] | Apache-2.0 (`LICENSE` at tag 0.1.2) [L7] | AAR 20 KB with `libtoolChecker.so` (4–6 KB per ABI, 16 KB-aligned) [M4]. Its README lists Java checks (root-management, dangerous and cloaking apps; test-keys; `ro.debuggable` and `ro.secure`; busybox; `su` by path and by `which`; read-write `/system`) and one native `su` check, says root cannot be detected with certainty and can be bypassed, and recommends Play Integrity instead [L7]. Its manifest declares no `<queries>` [M4], and on targetSdk 30 and later an app sees only packages it declares in `<queries>` (`QUERY_ALL_PACKAGES` is subject to Play approval) [P6], so the package-list checks find nothing unless the host declares those packages **(inference)** | ⚠️ usable as a reference or a dependency; the package checks are largely inert |
| freeRASP (Talsec) | — | MIT for the open part; **binary parts are Talsec's property under a fair-usage policy** (README) [L8] | Commercial service SDK | ❌ proprietary core |

**What these checks do not cover** (to state in the docs, ADR 0002 rule 3g [R3]): every probe runs inside the environment the attacker controls, so root hiding, a modified emulator image, renamed hooking tools and a repackaged app return clean answers [R22][L7]; they say nothing about camera injection or a relay; a clean result is never `passed`. They are H-tier facts (`emulator-indicators`, `root-indicators`, `hooking-indicators` with reasons) feeding the Phase 7 risk scores, never a decision on their own [R21][R22]. The CI emulator will report itself as an emulator, which the device tests must expect.

### 4.3 Google Play Integrity as an optional adapter

**What the service gives** (Android Developers, read 2026-10-29):
- **Verdicts** in a token the server decodes: `requestDetails` (`requestPackageName`, `requestHash` for standard requests, `nonce` for classic, `timestampMillis`), `appIntegrity` (`appRecognitionVerdict`: `PLAY_RECOGNIZED`, `UNRECOGNIZED_VERSION`, `UNEVALUATED`; `packageName`, `certificateSha256Digest`, `versionCode`), `deviceIntegrity` (`deviceRecognitionVerdict` labels `MEETS_DEVICE_INTEGRITY`, opt-in `MEETS_BASIC_INTEGRITY` and `MEETS_STRONG_INTEGRITY`; opt-in `recentDeviceActivity` `LEVEL_1`–`LEVEL_4`; `deviceRecall`, beta), `accountDetails` (`appLicensingVerdict`), and opt-in `environmentDetails` (`appAccessRiskVerdict`, `playProtectVerdict`). An empty device verdict means the device met no label: hooking, root or an emulator are the typical causes [P3].
- **Standard and classic requests.** Standard: a warm-up (`prepareIntegrityToken` with the Cloud project number) of a few seconds, then requests of a few hundred milliseconds bound to a `requestHash` of at most 500 bytes, with replay protection by Google (decoding the same token again returns cleared verdicts); an expired provider fails with `INTEGRITY_TOKEN_PROVIDER_INVALID`; warm-start preparation is limited to 5 a minute per app instance. Classic: a few seconds, a `nonce`, for rare high-value actions [P1][P2].
- **Server side.** The token is decoded by Google: `POST playintegrity.googleapis.com/v1/PACKAGE_NAME:decodeIntegrityToken` with a service account of the linked Cloud project (`playintegrity` scope). The server checks the package name, the `requestHash`, the timestamp's freshness, `PLAY_RECOGNIZED` and optionally the certificate digest and version code, then the device label its policy requires [P2][P3].
- **Quota.** 10,000 requests a day per Cloud project by default, counted separately for token requests and server decryptions; raising it needs the app on Google Play and a form, processed in up to a week; an SDK provider can attribute usage to the SDK through the Play SDK Console, and SDKs cannot use device recall [P4].
- **Requirements.** Android 6.0 or later with library 1.4.0 or later [P1]; a Google Cloud project (linking it to Play Console is needed for configuration and quota increases); sideloaded apps get an `UNLICENSED` account verdict [P4]. The setup page names `com.google.android.play:integrity:1.6.0` [P4]; its release date and POM licence were not read, because Google Maven's host disallows robots (Gaps). Behaviour on devices without Google Play services is **not documented** on the pages read.
- **Terms.** The Play Integrity API Terms of Service (last modified 2024-05-20) plus the Google APIs Terms: no use of the API to fingerprint or track individual users or devices; Google receives the request fields, the app's package, version and signing certificate, the licence status and device attestation data; the developer completes the Data safety form [P5]. The API "works best" alongside other signals and not as the sole anti-abuse mechanism [P1].

**Verdict on rule 4:** ⚠️ proprietary Google service and client library. Allowed only as an **optional adapter the product works without** (the task's rule 3; ADR 0002 tier A [R3]).

**Proposed shape (ours).**
- **Client.** A common `IntegrityTokenProvider` interface (`suspend fun token(requestHash: String): IntegrityToken?`) that the host passes in, as it passes `DeviceSignals`. The Play implementation lives in a **separate optional artifact** (for example `openverify-integrity-play`, an Android library), so `:openverify-sdk` and its POM never depend on Play code. The host supplies its own Cloud project number.
- **Binding.** `requestHash` = base64url of SHA-256 over a domain label, the flow session id and a fresh server challenge, so a token cannot be replayed into another session **(ours)**; Google's replay protection covers re-decoding [P2].
- **Server.** A provider kind (for example `deviceIntegrity`) with a `play-integrity` implementation (the operator's service-account key, package name and expected certificate digests) and a **deterministic sandbox provider** with magic values; production refuses the sandbox binding; an unbound provider gives `not_applicable` with `provider_not_configured`; the verdict is stored as signals with provenance, never as a pass on its own (ADR 0002 rules 3d–3f [R3]).
- **Budget.** One request per inquiry, at the selfie or NFC submit, keeps a default 10,000-a-day project at up to 10,000 verifications a day **(inference)**.
- **The terms bind the design.** Because the API may not be used to fingerprint or track devices [P5], no Play Integrity field may feed the Phase 7 device lists, the graph or `device-fingerprint` (ours, from [P5][R21]).

**What it does not cover.** A genuine, certified device can still present an injected camera feed through an app that was granted the needed permissions, or relay a real person; devices without Google Play give no verdict; a sideloaded or self-built host app is `UNLICENSED` or unrecognised by design [P3][P4]. It is a signal about the app and the device, not about the person in front of the camera.

## 5. NFC: `openverify-nfc`

### 5.1 The stack, re-read at the newest versions (answers K8)

| Artefact | Latest / newest passing | Licence, read in the files this time | Size | Notes |
|---|---|---|---|---|
| `org.jmrtd:jmrtd` | **0.8.9** (2026-10-03) / 0.8.9 [M1] | POM: "GNU Library or Lesser General Public License (LGPL)", no version; source header of `org/jmrtd/PassportService.java` in the 0.8.9 sources jar: LGPL **version 2.1 or (at your option) any later version** [M5] | 517 KB jar [M6] | Depends on `scuba-smartcards` 0.0.21, `bcprov-jdk18on` and `bcutil-jdk18on` 1.86, `cert-cvc` 1.4.13 (compile), JUnit 4 and `bcpkix` (test) [M5]. The sources jar holds the BAC, PACE (GM, IM, CAM results), EAC-CA, EAC-TA and AA protocol classes and the AES and 3DES secure-messaging wrappers [M5] |
| `net.sf.scuba:scuba-smartcards` | 0.0.21 (2026-08-22) / 0.0.21 [M1] | `CardService.java`: LGPL 2.1 or later. **`CommandAPDU.java` and `ResponseAPDU.java`: Oracle copyright 2005–2006, GPL version 2 only, with the Classpath exception** [M5] | 86 KB [M6] | A JMRTD dependency; the two classes are the APDU types JMRTD's API uses **(inference from the package layout)** |
| `net.sf.scuba:scuba-sc-android` | 0.0.27 (2026-08-23) / 0.0.27 [M1] | LGPL 2.1 or later [R18] | 4.8 KB AAR; minSdk 10; its manifest adds `android.permission.NFC`; no consumer R8 rules [M5] | `IsoDepCardService` |
| `org.ejbca.cvc:cert-cvc` | 1.4.13 (2021-06-23) / 1.4.13 [M1] | LGPL 2.1 or later [R18] | 80 KB [M6] | Stale but only a transitive dependency |
| `org.bouncycastle:bcprov-jdk18on`, `bcutil-jdk18on` | 1.86 (2026-09-11) / 1.86 [M1] | MIT [R18] | 7.2 MB and 0.79 MB jars [M6] | JMRTD passes its own provider object; do not insert a global provider [R18] |

**K8, answered.** JMRTD 0.8.9 is LGPL-2.1-or-later and SCUBA 0.0.21 is LGPL-2.1-or-later except the two Oracle files, exactly as Phase 5 recorded [R18]; nothing changed in the newer releases read here.

### 5.2 The licence boundary and the SCUBA question

**What the Classpath exception allows** (SPDX text [L9], paraphrased): the holders let you link the covered file with independent modules and distribute the result under terms of your choice, provided you meet each independent module's own licence; the exception may be kept or dropped in a modified version. The two files themselves stay GPL-2.0-only: their source must be available and their notices kept **(inference; not legal advice)**.

**Rule 4 as written** fails it: GPL is excluded "even as tooling", and the only copyleft exception is LGPL code in `android/openverify-nfc` [R2]. Phase 5 decision 40 and PLAN §9 already say the two files need an explicit, documented owner exception before Phase 10 adopts them [R17][R1]. The choices:

| Option | What it costs | Verdict |
|---|---|---|
| **(a) Owner exception**, scoped to `openverify-nfc`, unmodified SCUBA from Maven Central, the GPL-2.0 text and the source location of the two files in the module's NOTICE | A policy decision; nothing to build | ⚠️ **recommended default**: the exception exists precisely so that code linking these classes is not bound by the GPL |
| (b) A fork of SCUBA with the two classes rewritten from ISO/IEC 7816-4 | About two small classes, then a fork to maintain and publish; still LGPL | ⚠️ possible; buys little over (a) |
| (c) Our own BAC, PACE, secure messaging and AA in `commonMain` (KMP plan decision 6's alternative [R23]) | Security-critical cryptography (3DES and AES secure messaging, ECDH over brainpool curves, PACE mappings) and a common crypto library this note did not evaluate; tests from the fictional vectors in Doc 9303 Part 11 [R18] | ❌ not for this release; it would remove all LGPL and GPL code and serve iOS later |

**LGPL obligations for host apps (to document).** LGPL-2.1 §6 lets a work that uses the library be distributed under any terms that permit modification for the customer's own use and reverse engineering to debug such modifications [L10]. If the module stays LGPL-3.0 (Phase 5 C67 [R17]), §4(e) adds Installation Information where GPLv3 §6 would require it, which covers consumer devices ("User Products") [L10]; whether a phone app distributed through a store triggers it is a legal question **(not legal advice)**. Two consequences for Phase 10:
- **Keep the libraries replaceable**: depend through Maven coordinates, never shade; consumer R8 rules that keep `org.jmrtd.**`, `net.sf.scuba.**` and `org.ejbca.cvc.**` unobfuscated [R18]; ship the LGPL-2.1, LGPL-3.0 and GPL-2.0-with-Classpath-exception texts inside the AAR.
- **Reconsider the module's own licence (owner).** The module's own code only uses the libraries, so it could be Apache-2.0 like the rest, with the LGPL obligations attached to the unmodified JMRTD, cert-cvc and SCUBA jars **(inference from LGPL-2.1 §5–§6 [L10]; not legal advice)**. Phase 5 chose LGPL-3.0; this note does not change that, it flags the trade-off (section 11).

### 5.3 What the reader does, and what the server already does

**Already built** (Phase 5): the flow API's `POST /api/v1/flow/verifications/:id/chip-challenges` (201: `id` `chc_…`, `nonce` of 16 lower-case hex characters, `expires-at`; TTL 300 s; the eleventh challenge cancels the verification), the chip `FileKind`s for upload, and the submit body's `chip` member (`challenge-id`, `nonce`, optional `active-authentication-response` of at most 1 KiB in standard base64, optional `device-report` with `protocols` from `bac`, `pace`, `pace-cam`, `chip-authentication`, `active-authentication` and outcomes `succeeded`, `failed`, `not-attempted`, and `read-ms`) [R15]; on the server, Passive Authentication against the operator-synced trust store, DG1 against the printed MRZ, DG2 against the selfie, AA over the server nonce, and the advisory repeat check (C62) [R17]. The flow-spec `nfc` step is `{ id, type: "nfc", androidOnly: true, maxAttempts? }` [R16]. The SDK has `BacKeySeed.mrzInformation` in common code and the chip file kinds [R12].

**To build in Phase 10.**
1. **Model and API (common).** An `NfcStep` in `Flow.kt`'s `known` map; `FlowApi.createChipChallenge(verificationId)` and the submit's `chip` member, with `ContractFixturesTest` decoders for the C62.5 shapes [R12][R13][R15].
2. **A common seam.** `ChipReader` in `commonMain` (`suspend fun read(mrzKey: BacKeySeed, challenge: ByteArray): ChipRead`), returning raw file bytes (EF.SOD, DG1, DG2, DG14, DG15, EF.CardSecurity, EF.CardAccess, EF.COM), the AA response and the device report. The host passes an implementation in, as it passes `CaptureCamera`; `:openverify-sdk` never depends on `:openverify-nfc` (its README's rule [R7]). With none given, the NFC step stays the unsupported screen, as today.
3. **The Android reader (`openverify-nfc`).** `NfcAdapter.enableReaderMode` (API 19) for NFC-A and NFC-B with the NDEF check skipped, `IsoDep` (API 10) with a raised timeout and extended-length APDUs where supported (API 16), and `new IsoDepCardService(isoDep)` directly, not the reflective factory [R18] (the flag names were not re-read: the reference page did not render, Gaps). Then: PACE when EF.CardAccess offers it, else BAC (PACE is mandatory in chips issued from 2027-01-01 and BAC-only issuance ends 2028-01-01 [R18]); read the files; Chip Authentication when DG14 offers it; AA over the server's 8-byte nonce **after** PACE or BAC, unverified on the device, because JMRTD returns the raw response and the server verifies it [R18]. All I/O off the main thread.
4. **What the server must not trust** is unchanged from Phase 5: any device boolean, hash or chosen certificate, decoded images, the MRZ used for access, timestamps; Chip Authentication and PACE-CAM transcripts are not transferable, so they stay `device-reported` metadata [R18][R17].
5. **UI.** An MRZ confirmation screen (prefilled from the government ID step's MRZ when the flow has one, else typed), a "hold the phone to the passport" screen with progress and live-region announcements, retry on tag loss, and an NFC-off prompt that opens the system settings. JPEG 2000 DG2 is not decoded on the device (Android cannot) [R18]; no preview is needed.
6. **Manifest.** `android.permission.NFC` comes from `scuba-sc-android` [M5]; declare `<uses-feature android:name="android.hardware.nfc" android:required="false" />` so host apps stay installable without NFC, and hide the step on a device without it **(ours)**.
7. **Tests.** Host tests with a scripted `CardService` that replays APDU transcripts generated against a synthetic chip (Phase 5's synthetic Utopia chips [R17]), the ICAO worked vectors for key derivation [R18], and one device test that only checks reader-mode wiring (an emulator has no NFC controller **(inference)**). Kover for `openverify-nfc` at 80%, which it does not have today [R6][R7].

## 6. Shipping: Maven Central, R8, 16 KB pages, target API, size, API compatibility

### 6.1 Publishing to Maven Central through the Central Portal

**The rules** (Sonatype, read 2026-10-29):
- **Files.** A POM for every deployment; every non-POM jar needs `-sources.jar` and `-javadoc.jar` (placeholder jars with a README pass validation); `.md5` and `.sha1` for every file (`.sha256` and `.sha512` optional); an `.asc` detached signature for every file [S1].
- **POM metadata.** `groupId`, `artifactId`, `version` (not `-SNAPSHOT`), `name`, `description`, `url`, `licenses`, `developers` and `scm` (`connection`, `developerConnection`, `url`; the URL may be private) [S1].
- **Namespace.** A domain namespace is verified by a DNS TXT record on the exact domain: `dev.openverify` needs `openverify.dev`; a code-hosting namespace such as `io.github.<username>` is verified with a temporary public repository, and only the sign-up username, not an organisation [S3].
- **Signing keys.** Public key on `keyserver.ubuntu.com`, `keys.openpgp.org` or `pgp.mit.edu`; Maven and Nexus verify against the **primary** key only, so a signing subkey must be removed or revoked; keys default to two years' validity [S4].
- **Tooling.** Sonatype has **no official Gradle plugin** for the Portal; it lists JReleaser and community plugins, among them `vanniktech/gradle-maven-publish-plugin` and `GradleUp/nmcp`, unsupported by Sonatype [S2]. The old OSSRH hosts shut down on 2025-06-30 (vanniktech changelog, 0.33.0) [L14].

**Plugin: `com.vanniktech.maven.publish`.** 0.37.0 (2026-06-21) is the latest and passes [M1][G1]; Apache-2.0 (`LICENSE` at the tag) [L14]. 0.35.0 added publishing for KMP libraries on `com.android.kotlin.multiplatform.library` and Portal deployment validation; 0.36.0 defaults to an empty javadoc jar when none is configured and requires Dokka v2 mode; 0.37.0 drops redundant checksum files. Its stated minimums are JDK 17, Gradle 9.0.0, AGP 8.13.0 and KGP 2.2.0, and it is "tested up to" Gradle 9.7.0-milestone-1, AGP 9.4.0-alpha01 and KGP 2.4.0 [L14]. Ours are Gradle 9.8.2, AGP 9.4.1 and KGP 2.4.21 [R5], newer than tested: ✅ licence, ⚠️ compatibility to prove in a spike (`publishToMavenLocal`, then a Portal upload without release).

**Javadoc.** Dokka 2.2.0 (2026-03-26; 2.3.0-Beta is newer, 2026-09-15) is the newest stable, Apache-2.0 at tag v2.2.0 [M1][L15]. An empty javadoc jar also satisfies the Portal [S1][L14]; real KDoc in the jar is better for users **(ours)**.

**Kotlin Multiplatform publications.** `maven-publish` produces a root `kotlinMultiplatform` publication and one per target (for example `…-iosarm64`); Android needs the Android-KMP plugin's own configuration; Apple klibs can be produced on any host, except with cinterop, CocoaPods or final binaries; and all artifacts must come from one host, because Maven Central refuses duplicate publications [K3]. **Releasing iOS klibs** that were compiled on Linux but never linked or run (ADR 0004 [R4]) would put untested iOS artifacts on Central while the owner has moved iOS to the next release. Proposal (ours): publish the root module and the Android target only in this release, and prove in the spike that the root's Gradle module metadata then resolves for Android consumers **(not documented; Gaps)**.

**What to configure (ours).**
- Coordinates: `<namespace>:openverify-sdk` (Apache-2.0) and `<namespace>:openverify-nfc` (its own licence, section 5.2) as separate artifacts, so a host that never adds NFC never resolves LGPL code; `demo-app` is not published.
- The version comes from one Gradle property, and a generated common constant replaces the hand-written `FlowHttp.SDK_VERSION = "0.1.0"` behind `User-Agent: OpenVerify-Android/<version>` [R6]; the Android-KMP plugin has no `BuildConfig` [A4]. A test asserts the two agree.
- Signing in CI only, from an in-memory primary key held in repository secrets; a manually dispatched release workflow; deployment left for a manual release in the Portal until the first versions prove the pipeline **(ours)**.
- **Before the first POM:** the Gradle hygiene of K20 (declare `kotlinx-io` and skiko where they are used directly; drop the unused `lifecycle-viewmodel-compose`), so the published dependency list is the real one [R27][R4].

### 6.2 Consumer R8 rules

The Android-KMP plugin publishes **no** consumer keep rules unless `optimization { consumerKeepRules.apply { publish = true; file("…") } }` is set [A4]; there is no such file today [R6]. What each dependency needs:

| Code | What ships today | Rule needed (proposed) |
|---|---|---|
| SDK `@Serializable` models (results cross the activity boundary as string extras, so nothing is Parcelable [R14]) | nothing | Rules that keep serializers of the public models **(inference: kotlinx.serialization ships rules of its own; whether they cover this use was not read, Gaps)** |
| ONNX Runtime 1.31.0 | Keeps only the telemetry classes [M2] | Keep the classes its JNI code calls by name **(inference: not documented; prove with a minified device test)** |
| zxing-cpp 3.1.1 | `-keep class zxingcpp.** { *; }` [M3] | none |
| JMRTD, SCUBA, cert-cvc (in `openverify-nfc`) | none (no `proguard.txt` in `scuba-sc-android` [M5]) | Keep `org.jmrtd.**`, `net.sf.scuba.**`, `org.ejbca.cvc.**` unobfuscated, for LGPL relinking [R18] |
| Bouncy Castle 1.86 | not checked | Keep what JMRTD's provider object resolves by name **(inference)** |
| Play Integrity (optional artifact) | not read (Google Maven) | none expected |

**How to prove the rules (ours):** give `demo-app` a `release` build type with `isMinifyEnabled = true` and `isShrinkResources = true`, run its device tests against it (`testBuildType = "release"`), and build it in the `android` job. Library minification itself is not available on the KMP plugin (no build types [A4]), so only a consumer build can test the rules.

### 6.3 The 16 KB memory page size

- **Google Play's rule.** Apps targeting Android 15 (API 35) or later must support 16 KB pages on 64-bit devices; from **2027-02-01**, app updates that do not cannot be released (page last updated 2026-10-16) [A1]. Only apps with native code are affected; prebuilt `.so` files from SDKs must themselves be 16 KB-aligned [A1].
- **Tools.** AGP 8.5.1 or later zip-aligns uncompressed shared libraries at 16 KB, and NDK r28 or later links 16 KB-aligned by default [A1]. AGP 9.4.1 is in use [R5]; AGP 9.4's default NDK is 28.2 [A3].
- **Our prebuilt libraries, measured.** Every `PT_LOAD` segment is aligned at 16,384 bytes on all four ABIs in `onnxruntime-android` 1.31.0, `io.github.zxing-cpp:android` 3.1.1 and `rootbeer-lib` 0.1.2 [M2][M3][M4]. JMRTD and its dependencies are pure Java [M5]. ✅
- **Checks to add (ours).** In CI: `zipalign -c -P 16 -v 4` on the demo APK and `bundletool dump config … | grep alignment` on a bundle (`PAGE_ALIGNMENT_16K`) [A1]; an ELF `p_align` check over every `jni/*/*.so` of the published AARs (the 60-line reader this note used, section 9). On a device: the emulator runner offers `google_apis_ps16k` system images [L16]; a nightly device-test run on one (API 35 or later) catches a library that only fails when loaded **(inference: the private repository's 2-vCPU runner never booted an API 36 image in 600 s [R9])**.

### 6.4 Target API level and compileSdk

- **Google Play, 2026.** New apps and app updates on phones must target **Android 16 (API 36) from 2026-08-31**; an extension to 2026-11-01 can be requested; existing apps must target API 35 or later to stay available to new users. The rule applies to apps, not to libraries [A2]. `demo-app` targets 36 [R8] ✅; the SDK sets only `compileSdk` 36 and `minSdk` 26 [R6].
- **What 2027 brings is not documented** on the page read; another yearly step to API 37 is likely **(inference)**.
- **compileSdk 37.** AGP 9.4 supports up to API 37 [A3]. Moving unlocks Compose UI 1.12 (and Compose Multiplatform 1.12 with its iOS live regions), Ktor 3.6 with OkHttp 5.5, and CameraX 1.7's Compose artifacts (K17) [R23][C1]. Two costs: those AARs declare `minCompileSdk` 37 [R5], so **every host app would have to compile with 37** too; and Robolectric's support for the API 37 sandbox was not checked (Gaps). Proposal: keep 36 for the first published release, and plan the move as its own slice once Robolectric is confirmed **(ours; owner decision, section 11)**.

### 6.5 Binary size budget per ABI

Measured contributions (from the AARs and jars, before R8):

| Component | arm64-v8a (uncompressed / compressed) | armeabi-v7a | x86_64 | Source |
|---|---|---|---|---|
| ONNX Runtime 1.31.0 (`libonnxruntime.so` + JNI) | 34.3 MB / 12.9 MB | 24.3 / 11.7 MB | 40.9 / 15.0 MB | [M2] |
| zxing-cpp 3.1.1 | 1.75 / 0.73 MB | 1.23 / 0.64 MB | 1.82 / 0.76 MB | [M3] |
| RootBeer 0.1.2 (if used) | 5.5 / 2.2 KB | 3.9 / 2.0 KB | 5.4 / 2.1 KB | [M4] |
| YuNet model (asset) | 0.23 MB (all ABIs) | | | [R28] |
| JMRTD stack (jars: Bouncy Castle 7.2 + 0.8 MB, JMRTD 0.5 MB, SCUBA and cert-cvc 0.17 MB), `openverify-nfc` only | about 8.7 MB of bytecode before R8 | | | [M6] |

ONNX Runtime dominates: on arm64 it is about 34 MB installed. Android App Bundles deliver one ABI per device, so a user downloads one column, not four **(inference)**. Proposal (ours): measure the minified demo-app per ABI with bundletool in CI, commit the numbers as a baseline, fail on a regression of more than 10%, and publish the per-ABI cost of the SDK and of `openverify-nfc` in the SDK README. A custom ONNX Runtime build (section 3.3) is the lever if the owner sets a tighter budget.

### 6.6 Public API compatibility check

- **Built into the Kotlin Gradle plugin** since 2.2.0, as an experimental feature: `kotlin { @OptIn(ExperimentalAbiValidation::class) abiValidation { … } }`; 2.2.0 named the tasks `checkLegacyAbi` and `updateLegacyAbi` [K2]; the current documentation names `checkKotlinAbi` and `updateKotlinAbi`, says `check` runs the check, handles multiplatform projects (inferring the ABI of targets the host cannot compile), and notes that Android-target projects publish no JAR, so the Maven-publication source mode does not apply to them [K1]. It needs no new dependency. ⚠️ experimental.
- **`org.jetbrains.kotlinx.binary-compatibility-validator`** 0.18.2 (2026-09-02) is the latest and passes; Apache-2.0; its README says it is in **maintenance mode**, new features going to the Kotlin Gradle plugin's validation [M1][G1][L13]. ✅ as a fallback.
- Neither page states that it covers the Android target of `com.android.kotlin.multiplatform.library` (Gaps); a spike must show a dump with `OpenVerifyInquiry`, `InquiryResult` and `CapturedImage` in it.
- **Proposal (ours):** the KGP validation with dumps committed under `android/openverify-sdk/api/` and `checkKotlinAbi` in the `android` job; `kotlin { explicitApi() }` so a new public declaration is always deliberate (the sources already spell `public` [R11]); semantic versions, with 0.x minors allowed to break and every break listed in release notes. ADR 0004 decision 6's "binary break is acceptable while unpublished" [R4] ends at the first publication.

## 7. Testing: host tests, screenshots, emulators, accessibility, Kover

### 7.1 Host tests: Robolectric and Compose UI in `androidHostTest`

What exists: `testAndroidHostTest` runs JUnit 5, Robolectric through the Vintage engine, and `commonTest` in one task; 19 host-test files use Robolectric or a Compose test rule; Spanish is tested through `@Config(qualifiers = "es")`; the JDK 21 `--add-opens` flags for Robolectric's android-36 sandbox are set [R6][R31]. Robolectric **4.17** (2026-09-10) is the newest stable and passes (the 4.17 betas ran from 2026-07-14 to 2026-08-21), MIT [M1][R24]. Nothing to change for Phase 10 except where the new code lands: every new pure function (document measures, YuNet decode, yaw ratio, guidance machine, chip-file parsing for the upload) goes to `commonTest`; only the glue goes to `androidHostTest`.

### 7.2 Screenshot tests

| Tool | Version (latest / newest passing) | Licence | How it runs | Verdict |
|---|---|---|---|---|
| **Roborazzi** (`io.github.takahirom.roborazzi`) | 1.77.0 (2026-10-22) / **1.76.0 (2026-09-29)** [M1][G1] | Apache-2.0 (`LICENSE` at 1.76.0) [L11] | Inside Robolectric with Robolectric Native Graphics (Robolectric 4.10+, `@GraphicsMode(GraphicsMode.Mode.NATIVE)`), so it runs in the existing host-test task; captures Compose Multiplatform common previews; iOS support is experimental; an accessibility-check module integrates ATF [L11] | ✅ **recommended**; its README does not mention `com.android.kotlin.multiplatform.library` (Gaps: prove in a spike) |
| Paparazzi (`app.cash.paparazzi`) | 2.0.0-alpha05.1 (2026-09-28) / stable line 1.3.5 (2024-11-07) [M1] | Apache-2.0 (`LICENSE.txt` at 1.3.5) [L12] | Its own layoutlib-based renderer and test rule, outside Robolectric | ⚠️ the stable line is two years old and 2.0 is alpha |

**Rules for golden images (ours).** Only synthetic content: the fake camera, synthetic ID renders and no faces (`CLAUDE.md` rule 3 [R2]); one image per screen in English and Spanish, light and dark, at a phone and a large font scale; images are committed and compared in CI, recorded only by an explicit task.

### 7.3 Device tests on the GitHub Actions emulator

- **Today.** `android-instrumented` boots an API 34 `google_apis` x86_64 emulator with KVM through `reactivecircus/android-emulator-runner` v2.38.0 (2026-07-05, the latest; Apache-2.0) and runs one CameraX test; an API 36 image never booted within 600 s on the private repository's runner; boot plus build take about 6 minutes [R9][G1][R24].
- **Runner facts.** GitHub-hosted Linux runners support hardware acceleration for Android emulators; the standard `ubuntu-latest` runner has 2 vCPU, 8 GB RAM and 14 GB SSD for private repositories and 4 vCPU and 16 GB for public ones [B3]. The emulator action takes `target` values including `aosp_atd`, `google_atd` and `google_apis_ps16k`, and documents AVD snapshot caching to cut start-up time [L16].
- **Cost on a private repository.** Linux 2-core $0.006 a minute, Linux 4-core (a larger runner) $0.012, macOS $0.062 [B1]. Included compute is a monthly dollar amount: $12 on GitHub Free, $18 on Pro and Team, $300 on Enterprise Cloud; standard runners are free for public repositories, larger runners are not [B1][B2]. A 15-minute emulator job costs about $0.09 on the standard runner; 100 runs a month is about $9, three-quarters of the Free plan's whole allowance, shared with every other job **(inference: arithmetic on [B1][B2])**.
- **Proposal (ours).** Keep one emulator job on pushes and pull requests that touch `android/**`; add a nightly matrix with `minSdk` 26, 34 and one 16 KB image (`google_apis_ps16k`, API 35 or later); try ATD images and the snapshot cache first, and a 4-core larger runner only if an API 35+ image still will not boot. Device tests Phase 10 needs: ONNX Runtime runs YuNet with its telemetry provider removed; CameraX binds three use cases, with the two-use-case fallback; zxing-cpp decodes a synthetic PDF417; reader-mode wiring for NFC (no NFC controller on the emulator **(inference)**); a smoke flow on the minified release build (section 6.2).

### 7.4 TalkBack and automated accessibility checks

- **Automated.** Compose 1.8.0 and later offer `enableAccessibilityChecks()` and `tryPerformAccessibilityChecks()` through the `ui-test-junit4-accessibility` artifact, built on Google's Accessibility Test Framework; any test action then also runs the checks: missing labels, colour contrast, small touch targets, traversal order; an `AccessibilityValidator` can make warnings fail too [A5]. The catalog's Compose BOM resolves Compose UI 1.11.4 [R5], so the API is available. Android's page shows the checks in a device test and **does not say whether they run under Robolectric** [A5]; Roborazzi's accessibility module is the host-side route to prove (Gaps).
- **ATF licence.** Apache-2.0 (`LICENSE` in `google/Accessibility-Test-Framework-for-Android`, whose GitHub repository has no tags and was last pushed 2024-04-03) [L17]; Maven Central only carries 2.1 from 2015 [M1], so the current artifact comes from Google Maven, which this note could not read **(inference)**. ✅ test scope only.
- **Manual.** Automated checks do not hear what TalkBack says. Per release (ours): a TalkBack pass on a real device over every screen, the selfie prompts (announced once per change, section 3.3), the NFC prompts and the error and retry screens; a 200% font-scale pass; a check that `FLAG_SECURE` [R14] does not hide content from accessibility services **(inference: the flag blocks screenshots, not the accessibility tree)**.

### 7.5 Kover gates

Kover **0.9.11** (2026-09-29) is the latest and passes [M1]. The SDK's gate is 80% line coverage, excluding `@Composable` and preview functions, `ComposableSingletons`, the CameraX glue and the generated resources [R6]. For Phase 10 (ours):
- `openverify-nfc` gets its own Kover setup and 80% gate (it has neither [R7]); the JMRTD calls stay in one thin class excluded like the CameraX glue, the protocol order and error mapping are tested through a scripted `CardService`.
- The ONNX Runtime session, the `ImageAnalysis` analyzer and the Play Integrity bridge are glue, excluded by name; everything they call is in `commonMain` and measured. The exclusion list stays short and reviewed, because a growing list would hollow out the gate.
- Raise the CI floor of 1,264 SDK host tests [R9] by each slice's count, as every phase has.

## 8. Keeping `commonMain` iOS-ready while iOS waits

**The binding rules** (PLAN §6 Phase 10 [R1], ADR 0004 [R4]): new code in `commonMain` unless it needs a platform API; every platform seam behind a common interface; no cinterop in `:openverify-sdk` (a future ONNX Runtime C API binding goes in its own module); each `commonMain` dependency must publish `iosArm64` and `iosSimulatorArm64` variants; no `expect class` (still Beta); `iosMain` stays thin because Kover does not measure it; an iOS placeholder never claims a capability.

**The seams Phase 10 adds** (names ours, illustrative):

| Seam | `commonMain` | `androidMain` or a separate Android module | `iosMain` in this release | Next release (iOS) |
|---|---|---|---|---|
| Frames for analysis | `AnalysisFrame` and `CaptureCamera.frames()` with an empty default | CameraX `ImageAnalysis` (section 3.1) | the default empty flow: guidance off, manual shutter | an AVFoundation video output **(inference)** |
| Document quality | the measures, the gates and their constants | — | runs as is (pure Kotlin) | — |
| Face detection | `FaceDetector` interface; YuNet input sizing, decoding, NMS, yaw ratio, guidance state machine | ONNX Runtime session (`androidMain`) | none passed in: guidance off | ONNX Runtime's C API by cinterop in its own module (PLAN §6 [R1]) |
| Model bytes | `ModelSource` interface returning the model and its expected SHA-256 | the AAR asset | none | a bundle resource **(inference)** |
| PDF417 | `BarcodeReader` | zxing-cpp | none | Apple Vision (PLAN §6 [R1]) |
| Device signals | `DeviceSignals` and the facts model (Phase 7 C94.7 [R21]) plus Phase 10's indicator lists | `Build`, files, `/proc` | Phase 7's placeholder, no claims | DeviceCheck or App Attest, proprietary Apple services, as adapters [R22] |
| App integrity | `IntegrityTokenProvider` | `openverify-integrity-play` (optional artifact) | none | an App Attest adapter **(inference)** |
| Chip reading | `ChipReader`, the `ChipRead` model, `BacKeySeed`, the C62.5 wire models | `openverify-nfc` (JMRTD) | none: the unsupported screen | NFCPassportReader in an `ios/` Swift package (KMP plan decision 6 [R23]) |

**Pitfalls to keep out of `commonMain` (ours).**
- `java.*` and `android.*` imports; `compileCommonMainKotlinMetadata` rejects them, but only the iOS klib compile catches a missing iOS actual or a dependency without iOS variants [R4].
- Hashing (the Play Integrity `requestHash`) and secure random: the Kotlin standard library offers neither **(inference)**, and the KMP plan's `secureRandomBytes` expect is not needed for NFC (K13). Keep both inside the Android implementations, which are Android-only anyway.
- Per-frame allocation: the guidance runs at 8 Hz [R34]; reuse buffers so the same code is not a garbage problem on Kotlin/Native later **(inference)**.

**What Linux CI keeps proving.** `:openverify-sdk:assemble` compiles the iOS main and test klibs on every push, with `~/.konan` cached [R9][R4]. New Android-only dependencies (ONNX Runtime, zxing-cpp, JMRTD, Play Integrity) go to `androidMain` or to separate Android modules, so they never reach the klib compile. New `commonTest` suites (golden vectors for YuNet decoding and the quality measures) run on the JVM host now and on the simulator once the next release's macOS job exists [R1]. **Not proven until then:** linking, Kotlin/Native performance of the per-frame code, and everything ADR 0004 already lists [R4].

## 9. Sources and pins

Every source was read on **2026-10-29**. Requests used the User-Agent `OpenVerify-research/1.0 (phase 10 Android research; no contact)`, at least 1.2 s apart per host (WebFetch requests were sequential), with no personal data sent.

**Robots files, read before any other request to each host.**
- `repo1.maven.org` (Maven Central): two `User-agent: *` groups, one `Allow: /` with the content signal `search=yes, ai-train=no, use=reference`, and one `Disallow: /`, plus disallow groups for named crawlers. Merged as RFC 9309 §2.2.2 requires, the allow rule wins over the equally long disallow; this note's User-Agent matches no named group, and its use is reference only.
- `dl.google.com` (Google Maven's file host): `Disallow: /`; `maven.google.com/robots.txt` redirects into `dl.google.com`. **Google Maven was therefore not read**: CameraX, Play Integrity, the Accessibility Test Framework and AGP facts come from developer.android.com pages instead, and their POMs were not re-read.
- `search.maven.org`: no restriction, but its index is stale (its newest `onnxruntime-android` was 1.22.0 of 2025-05), so it was not used for any fact.
- `raw.githubusercontent.com`, `api.github.com`, `central.sonatype.org`, `onnxruntime.ai`: 404 (no restrictions). `developer.android.com`, `support.google.com`, `kotlinlang.org`, `docs.github.com`: the paths read are allowed. `github.com` HTML pages were not requested.

**Downloads.** About 1.3 MB in total under `downloads/p10-{maven,gh,licenses,readmes,aar-ort-1.31.0,aar-zxingcpp-3.1.1,aar-rootbeer-0.1.2,aar-scuba-sc-android-0.0.27,src-jmrtd,src-scuba,state}/`. Archives were never downloaded whole: `scripts/p10_aar.py` reads an AAR's or jar's zip central directory and selected entries with HTTP range requests, inflates small entries (manifests, R8 rules, two Java sources) and the first 64 KB of each native library, and parses ELF program headers for `p_align`. Scripts: `scripts/p10_fetch.py` (robots, pacing, no redirects), `scripts/p10_maven.py` (metadata and POM `Last-Modified`), `scripts/p10_aar.py`, `scripts/replace_section.py` (note editing). Python ran with `-I`; nothing downloaded was executed, installed or built.

**Repository (R)**, read-only at `91c83e02` (Phase 6 being closed in the same tree)
- [R1] `docs/PLAN.md` §1–§3, §5, §6 (Phase 10, "Next release: iOS"), §9
- [R2] `CLAUDE.md` (rules 3–6, layout, commands)
- [R3] `docs/adr/0002-check-tiers.md`
- [R4] `docs/adr/0004-mobile-kotlin-multiplatform.md` (decisions, consequences, "Phase 10 work this leaves", as built)
- [R5] `android/gradle/libs.versions.toml`, `android/gradle.properties`, `android/gradle/wrapper/gradle-wrapper.properties`, `android/settings.gradle.kts`, `android/build.gradle.kts`
- [R6] `android/openverify-sdk/build.gradle.kts`; `openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/api/FlowHttp.kt` (`SDK_VERSION`)
- [R7] `android/openverify-nfc/{build.gradle.kts,README.md,NOTICE}`
- [R8] `android/demo-app/**` (build file, manifest, network security configs, sources, tests)
- [R9] `.github/workflows/ci.yml`, jobs `android` and `android-instrumented`
- [R10] `openverify-sdk/src/{commonMain/.../camera/CaptureCamera.kt, androidMain/.../camera/CameraXCaptureCamera.kt, androidMain/.../camera/ImageEncoding.kt, commonMain/.../ui/CaptureScreen.kt}`
- [R11] `openverify-sdk/src/commonMain/.../{model/SelfieCapture.kt, flow/SelfieCaptureProtocol.kt, camera/CameraFacts.kt}`
- [R12] `openverify-sdk/src/commonMain/.../{model/Flow.kt, model/WireEnums.kt, mrz/BacKeySeed.kt}`
- [R13] `openverify-sdk/src/commonMain/.../api/FlowApi.kt`
- [R14] `openverify-sdk/src/androidMain/{AndroidManifest.xml, kotlin/.../OpenVerifyInquiry.kt, OpenVerifyInquiryActivity.kt, InquiryResults.kt}`
- [R15] `packages/contracts/src/chip-challenges.ts` (C62.5)
- [R16] `packages/flow-spec/src/flow.ts` (`nfcStepSchema`, `STEP_TYPES`)
- [R17] `docs/plans/phase-5.plan.md` (C62, lines 48, 81, 105, 557, 758, 812, 926, 1162, 1283)
- [R18] `docs/research/phase5-nfc.md` §4, §6, §7 and "Needs the owner"
- [R19] `docs/research/phase4-models.md` §0, §1b
- [R20] `docs/research/phase3-libraries.md` §1
- [R21] `docs/plans/phase-7.plan.md` (C94.7, C96.1, C109, C110, decision 12; lines 635, 1481, 1488, 1941)
- [R22] `docs/research/phase7-client-signals.md` §4
- [R23] `docs/plans/kmp-migration.plan.md` (K3, lines 44, 93, 136–137, 147, 154, 188–189, decisions 4–6 and 10)
- [R24] `THIRD_PARTY_LICENSES.md` (§2 Android rows, §5 line 385)
- [R25] `docs/plans/phase-4.plan.md` (lines 33, 336, 354; decisions 1 and 11; C46)
- [R26] `docs/plans/phase-3.plan.md` (line 423; decision 12 at line 916)
- [R27] `docs/PROGRESS.md` (lines 309, 407, 461, 487, 514, 1316)
- [R28] `models/manifest.json` (`face_detection_yunet`)
- [R29] `docs/research/persona-surface.md`
- [R30] `apps/flow/src/flow/flow-position.ts`
- [R31] `android/openverify-sdk/src/{androidHostTest,commonTest,iosTest,androidDeviceTest}/**`, `android/demo-app/src/test/**` (counted with `grep`)
- [R32] `services/vision/src/openverify_vision/quality.py`
- [R33] `apps/flow/src/vite-plugins/guidance-assets-plugin.ts`; `scripts/fetch_models.py` (`--only`)
- [R34] `contracts/fixtures/flow/selfie-capture.json` (`client`, `server`, `measurement`)
- [R35] `apps/flow/src/guidance/{face-detector,guidance-machine,head-pose,yunet-decode,yunet-input}.ts`; `apps/flow/src/lib/sample-frame.ts`

**Measurements (M)**, by this note's scripts against Maven Central
- [M1] `https://repo1.maven.org/maven2/<group path>/<artifact>/maven-metadata.xml` and each recent version's POM `Last-Modified`, for: `com.microsoft.onnxruntime:onnxruntime-android`, `com.google.zxing:core`, `io.github.zxing-cpp:android`, `org.jmrtd:jmrtd`, `net.sf.scuba:scuba-sc-android`, `net.sf.scuba:scuba-smartcards`, `org.ejbca.cvc:cert-cvc`, `org.bouncycastle:bcprov-jdk18on`, `com.scottyab:rootbeer-lib`, `org.robolectric:robolectric`, `io.github.takahirom.roborazzi:roborazzi`, `app.cash.paparazzi:paparazzi`, `com.google.android.apps.common.testing.accessibility.framework:accessibility-test-framework`, `org.jetbrains.kotlinx:binary-compatibility-validator`, `org.jetbrains.kotlinx:kover-gradle-plugin`, `com.vanniktech:gradle-maven-publish-plugin`, `org.jetbrains.kotlin:kotlin-gradle-plugin` (2.4.21 on 2026-10-08; 2.5.0-Beta2 newest), `org.opencv:opencv`, `org.jetbrains.dokka:dokka-gradle-plugin`
- [M2] `https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/1.31.0/onnxruntime-android-1.31.0.aar` (range reads: entry list, `AndroidManifest.xml`, `proguard.txt`, ELF headers)
- [M3] `https://repo1.maven.org/maven2/io/github/zxing-cpp/android/3.1.1/android-3.1.1.aar` and `android-3.1.1.pom`
- [M4] `https://repo1.maven.org/maven2/com/scottyab/rootbeer-lib/0.1.2/rootbeer-lib-0.1.2.aar`
- [M5] `https://repo1.maven.org/maven2/net/sf/scuba/scuba-smartcards/0.0.21/scuba-smartcards-0.0.21-sources.jar` (`CommandAPDU.java`, `ResponseAPDU.java`, `CardService.java`); `https://repo1.maven.org/maven2/org/jmrtd/jmrtd/0.8.9/jmrtd-0.8.9-sources.jar` (`PassportService.java`, entry list) and `jmrtd-0.8.9.pom`; `https://repo1.maven.org/maven2/net/sf/scuba/scuba-sc-android/0.0.27/scuba-sc-android-0.0.27.aar`
- [M6] `HEAD` sizes of `bcprov-jdk18on-1.86.jar`, `bcutil-jdk18on-1.86.jar`, `jmrtd-0.8.9.jar`, `cert-cvc-1.4.13.jar`, `scuba-smartcards-0.0.21.jar`, `core-3.5.4.jar` under `https://repo1.maven.org/maven2/`

**GitHub (G)**
- [G1] `https://api.github.com/repos/<owner>/<repo>/releases?per_page=6` for `microsoft/onnxruntime` (v1.31.0 2026-10-09, v1.31.1 2026-10-26), `zxing-cpp/zxing-cpp`, `scottyab/rootbeer`, `takahirom/roborazzi`, `ReactiveCircus/android-emulator-runner`, `Kotlin/binary-compatibility-validator`, `vanniktech/gradle-maven-publish-plugin`; `…/repos/google/Accessibility-Test-Framework-for-Android` (and `/tags`, empty); `…/repos/scottyab/rootbeer`; `…/repos/talsec/Free-RASP-Android`

**Licences and project files (L)**
- [L1] `https://raw.githubusercontent.com/microsoft/onnxruntime/v1.31.0/LICENSE` (MIT)
- [L2] `https://raw.githubusercontent.com/microsoft/onnxruntime/v1.31.0/ThirdPartyNotices.txt` (Eigen, MPL-2.0; SQLite)
- [L3] `https://raw.githubusercontent.com/microsoft/onnxruntime/v1.31.0/docs/Privacy.md`
- [L4] `https://onnxruntime.ai/docs/build/custom.html`
- [L5] `https://raw.githubusercontent.com/zxing/zxing/zxing-3.5.4/LICENSE`, `…/README.md`
- [L6] `https://raw.githubusercontent.com/zxing-cpp/zxing-cpp/v3.1.1/LICENSE`
- [L7] `https://raw.githubusercontent.com/scottyab/rootbeer/0.1.2/LICENSE`, `…/README.md`
- [L8] `https://raw.githubusercontent.com/talsec/Free-RASP-Android/master/README.md` and the repository metadata in [G1]
- [L9] `https://raw.githubusercontent.com/spdx/license-list-data/main/text/Classpath-exception-2.0.txt`
- [L10] `https://raw.githubusercontent.com/spdx/license-list-data/main/text/LGPL-2.1-or-later.txt` (§5, §6) and `…/LGPL-3.0-only.txt` (§4(e), GPLv3 §6)
- [L11] `https://raw.githubusercontent.com/takahirom/roborazzi/1.76.0/LICENSE`, `…/README.md`
- [L12] `https://raw.githubusercontent.com/cashapp/paparazzi/1.3.5/LICENSE.txt`
- [L13] `https://raw.githubusercontent.com/Kotlin/binary-compatibility-validator/0.18.2/LICENSE.TXT`, `…/README.md`
- [L14] `https://raw.githubusercontent.com/vanniktech/gradle-maven-publish-plugin/0.37.0/LICENSE`, `…/CHANGELOG.md`
- [L15] `https://raw.githubusercontent.com/Kotlin/dokka/v2.2.0/LICENSE.txt`
- [L16] `https://raw.githubusercontent.com/ReactiveCircus/android-emulator-runner/v2.38.0/README.md`
- [L17] `https://raw.githubusercontent.com/google/Accessibility-Test-Framework-for-Android/master/LICENSE` and the repository metadata in [G1]

**Android Developers and Google Play (C, P, A)**
- [C1] `https://developer.android.com/jetpack/androidx/releases/camera` (first 100,000 characters)
- [C2] `https://developer.android.com/media/camera/camerax/analyze`
- [C3] `https://developer.android.com/media/camera/camerax/architecture`
- [P1] `https://developer.android.com/google/play/integrity/overview` (last updated 2026-04-20)
- [P2] `https://developer.android.com/google/play/integrity/standard`
- [P3] `https://developer.android.com/google/play/integrity/verdicts`
- [P4] `https://developer.android.com/google/play/integrity/setup`
- [P5] `https://developer.android.com/google/play/integrity/terms` (terms last modified 2024-05-20)
- [P6] `https://developer.android.com/training/package-visibility`
- [A1] `https://developer.android.com/guide/practices/page-sizes` (last updated 2026-10-16)
- [A2] `https://support.google.com/googleplay/android-developer/answer/11926878?hl=en`
- [A3] `https://developer.android.com/build/releases/gradle-plugin` (AGP 9.4.0, September 2026)
- [A4] `https://developer.android.com/kotlin/multiplatform/plugin`
- [A5] `https://developer.android.com/develop/ui/compose/accessibility/testing`

**Sonatype (S)**
- [S1] `https://central.sonatype.org/publish/requirements/`
- [S2] `https://central.sonatype.org/publish/publish-portal-gradle/`
- [S3] `https://central.sonatype.org/register/namespace/`
- [S4] `https://central.sonatype.org/publish/requirements/gpg/`

**Kotlin (K)**
- [K1] `https://kotlinlang.org/docs/gradle-binary-compatibility-validation.html`
- [K2] `https://kotlinlang.org/docs/whatsnew22.html`
- [K3] `https://kotlinlang.org/docs/multiplatform/multiplatform-publish-lib-setup.html`

**GitHub Docs (B)**
- [B1] `https://docs.github.com/en/billing/reference/actions-runner-pricing`
- [B2] `https://docs.github.com/en/billing/concepts/product-billing/github-actions`
- [B3] `https://docs.github.com/en/actions/reference/runners/github-hosted-runners`

**Search (W)**
- [W1] One web search for the Play Integrity library's version history found no official release-notes page (`https://developer.android.com/google/play/integrity/release-notes` answered 404); only the setup page's `1.6.0` [P4] is used.

## 10. What the phase plan should take from this (proposed)

### Build order (proposed slices)

1. **10A, foundation (alone, first).** The Gradle hygiene of K20; one version property and a generated common version constant behind the `User-Agent`; `explicitApi()` and the Kotlin Gradle plugin's ABI validation with committed dumps (BCV 0.18.2 if the Android target is not covered); `consumer-rules.pro` published through `optimization.consumerKeepRules`; a minified `release` build of `demo-app` with device tests against it; the 16 KB checks (zipalign, bundletool, an ELF `p_align` scan of every AAR); a per-ABI size baseline; a publishing spike with `com.vanniktech.maven.publish` 0.37.0 to Maven Local. compileSdk stays 36 (section 6.4).
2. **10B, capture.** `ImageAnalysis` bound with `Preview` and `ImageCapture` (fallback to two use cases); `AnalysisFrame` and `CaptureCamera.frames()` in `commonMain`; the document measures (Laplacian variance, Tenengrad, HSV glare share, brightness, edge framing) in `commonMain`, with client constants in a new `contracts/fixtures/flow/document-capture.json` calibrated on the synthetic IDs; auto-capture after a hold, the shutter always available; PDF417 through `io.github.zxing-cpp:android` 3.1.1 behind a common `BarcodeReader`, as guidance only.
3. **10C, selfie guidance.** `onnxruntime-android` **1.31.0** with the three-layer telemetry removal of section 3.3 and its tests; YuNet fetched by `scripts/fetch_models.py --only face_detection_yunet` into generated assets with the digest checked; the web guidance (`yunet-input`, `yunet-decode`, `head-pose`, `guidance-machine`) ported to `commonMain` and tested against shared golden vectors and `selfie-capture.json`; auto-capture per prompt with live-region announcements once per change; a spike that measures a custom ORT build (`--no_telemetry`, YuNet's operators only).
4. **10D, NFC** (after owner decisions 1 and 2 of section 11). An `NfcStep`, `FlowApi.createChipChallenge` and the submit's `chip` member with contract-fixture decoders; a common `ChipReader`; `openverify-nfc` on JMRTD 0.8.9, `scuba-smartcards` 0.0.21, `scuba-sc-android` 0.0.27, `cert-cvc` 1.4.13 and Bouncy Castle 1.86, with reader mode, PACE then BAC, CA and AA over the server nonce, the device report, unobfuscating consumer rules, the licence texts in the AAR, Kover at 80% and scripted-`CardService` tests over synthetic chips; the MRZ confirmation and tap screens.
5. **10E, device integrity.** Phase 10's emulator, root and hooking indicators in the Phase 7 `DeviceSignals` contract, written by us (RootBeer as a reference), as H-tier facts; the common `IntegrityTokenProvider`, an optional `openverify-integrity-play` artifact, and on the server an A-tier `play-integrity` provider with a deterministic sandbox provider, off by default, one request per inquiry, verdicts never used for device lists or the graph.
6. **10F, tests and shipping.** Roborazzi 1.76.0 screenshots in `androidHostTest`; Compose accessibility checks (on the device if Robolectric cannot run them) and a per-release TalkBack checklist; the nightly emulator matrix (API 26, 34, a 16 KB image); the release workflow to the Central Portal (signing in CI, manual release); the SDK README with per-ABI sizes, permissions, Data safety entries for camera images, chip data, device facts and Play Integrity, and every limit of section 4 stated plainly.

### Pins (newest that pass the 14-day rule on 2026-10-29)

| Dependency | Pin | Licence |
|---|---|---|
| CameraX | 1.6.2 (unchanged) | Apache-2.0 ✅ |
| `com.microsoft.onnxruntime:onnxruntime-android` | 1.31.0 | MIT ✅, Eigen MPL-2.0 inside ⚠️ |
| YuNet `face_detection_yunet_2026may.onnx` | as pinned in `models/manifest.json` | MIT ✅ (training-data caveat) |
| `io.github.zxing-cpp:android` | 3.1.1 | Apache-2.0 ✅ |
| `org.jmrtd:jmrtd`, `cert-cvc` | 0.8.9, 1.4.13 | LGPL-2.1-or-later (NFC module only) ⚠️ |
| `scuba-smartcards`, `scuba-sc-android` | 0.0.21, 0.0.27 | LGPL-2.1-or-later + two GPL-2.0-only WITH Classpath-exception files ⚠️ owner |
| `bcprov-jdk18on`, `bcutil-jdk18on` | 1.86 | MIT ✅ |
| `com.google.android.play:integrity` | 1.6.0 (date not read) | proprietary, optional artifact only ⚠️ |
| Robolectric | 4.17 (unchanged) | MIT ✅ (test) |
| Roborazzi | 1.76.0 | Apache-2.0 ✅ (test) |
| Kover | 0.9.11 (unchanged) | Apache-2.0 ✅ (build) |
| `com.vanniktech.maven.publish` | 0.37.0 | Apache-2.0 ✅ (build) |
| Dokka | 2.2.0 | Apache-2.0 ✅ (build) |
| binary-compatibility-validator (fallback) | 0.18.2 | Apache-2.0 ✅ (build) |
| `reactivecircus/android-emulator-runner` | v2.38.0 (unchanged) | Apache-2.0 ✅ (CI) |

### Records to update

- `docs/PLAN.md` §3 technology table and §6 Phase 10: "zxing (Android)" becomes `io.github.zxing-cpp:android`, as Phase 3's research already recommended [R20]; add "on-device document quality gating in `commonMain`, no OpenCV"; name the optional Play Integrity artifact.
- `THIRD_PARTY_LICENSES.md`: rows for `onnxruntime-android` 1.31.0 with Eigen under the §5 exception once granted; YuNet as an asset shipped inside the AAR; `io.github.zxing-cpp:android`; the JMRTD stack moving from "planned" to adopted with the SCUBA decision; Roborazzi, Dokka, the publishing plugin and BCV as build or test tooling; Play Integrity as an optional proprietary adapter.
- `android/openverify-nfc/NOTICE` and `README.md`: the SCUBA decision and, if changed, the module's own licence.
- `docs/checks/nfc.md`: the Android client exists; what the device reports and why the server ignores it.
- The CI host-test floor, raised by each slice; `infra/tests/ci-workflow.test.sh` for new jobs.

### Honesty items to carry into the plan

- On-device quality gating, face guidance and PDF417 decoding are guidance (`user_behavior` hints), never results; the server re-measures.
- Root, emulator and hooking indicators and Play Integrity verdicts are signals with stated limits, never a pass, never alone a decline.
- The NFC reader's statements about BAC, PACE, CA and AA are `device-reported` metadata; only the server's own checks count (C62).
- No certification is claimed for the Android liveness path (ADR 0002 rule 3g).

## 11. Needs the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | SCUBA's two `GPL-2.0-only WITH Classpath-exception-2.0` files (Phase 5 decision 40; blocks `openverify-nfc`) | **Grant a scoped exception**: `openverify-nfc` only, unmodified SCUBA from Maven Central, the GPL-2.0 and Classpath-exception texts and the files' source location in the module's NOTICE (section 5.2, option a) |
| 2 | The licence of `openverify-nfc`'s own code: LGPL-3.0 (Phase 5 C67) or Apache-2.0 with LGPL dependencies | **Keep LGPL-3.0 until a legal review** of LGPL-3.0 §4(e) for store-distributed apps; prefer Apache-2.0 for the module's own code if the review agrees (not legal advice) |
| 3 | Eigen (MPL-2.0) compiled into `onnxruntime-android` (extends Phase 4 decision 11 from the web to Android) | **Grant**: unmodified, file-level copyleft, ORT's third-party notices shipped in the AAR |
| 4 | ONNX Runtime build: the official 1.31.0 AAR with telemetry neutralised, or a custom build (`--no_telemetry`, YuNet operators only) | **Official 1.31.0 now**, plus a spike; switch to the custom build if it saves at least 20 MB on arm64 and builds reproducibly in CI |
| 5 | Ship the YuNet weights inside the published AAR (MIT; WIDER FACE training-data caveat, Phase 4 policy item) | **Ship**, with its notice, under the same policy as the web flow |
| 6 | Maven Central namespace and accounts: `dev.openverify` (needs the `openverify.dev` domain and a DNS TXT record) or `io.github.<sign-up username>`; a Central Portal account and token; a GPG primary key; CI secrets | **`dev.openverify`** if the owner holds the domain, else `io.github.<username>`; keys and tokens created by the owner, stored only as repository secrets |
| 7 | Publish the iOS klibs to Maven Central in this release | **No**: the Android target and the root module only |
| 8 | Move to compileSdk 37 (Compose 1.12, CMP 1.12, Ktor 3.6, OkHttp 5.5, CameraX 1.7) | **Stay on 36 for the first published release**; a separate slice once Robolectric's API 37 support is confirmed, because host apps would have to compile with 37 too |
| 9 | Build the Play Integrity adapter in this release | **Yes, off by default**: an optional client artifact and an A-tier server provider with a sandbox; the operator brings the Google Cloud project and service account |
| 10 | Root and emulator detection: our own heuristics or a RootBeer dependency | **Our own heuristics** (RootBeer as a reference only); never a decision on their own |
| 11 | Crypto-wallet signing on Android beyond pasting (Phase 5 line 1283) | **Stay paste-only** this release |
| 12 | Emulator CI: the nightly matrix with a 16 KB image on the standard runner; a 4-core larger runner ($0.012 a minute); or making the repository public (free standard runners with 4 vCPU) | **Nightly matrix on the standard runner**; a larger runner only if an API 35+ image will not boot; the repository's visibility is the owner's call |
| 13 | A binary size budget | **Measure first**: a committed per-ABI baseline and a 10% regression gate; an absolute cap after the ORT spike |
| 14 | Auto-capture on Android (documents and selfie) | **On**, with the shutter always available and promoted after 10 s |
| 15 | Screenshot testing | **Roborazzi 1.76.0** inside the existing host-test task |

## Gaps (what this note could not establish)

- **Google Maven was not read** (its file host disallows all robots): the CameraX and Play Integrity POMs and licences, the Play Integrity library's release date (only `1.6.0` from the setup page), the current Accessibility Test Framework version and the `ui-test-junit4-accessibility` version.
- **ONNX Runtime without its provider.** Whether removing `TelemetryInitializer` leaves ORT working, and whether native telemetry still tries to send without it, is not documented; a device test must show it. The size of a custom `--no_telemetry` build with YuNet's operators was not measured (it means building ORT).
- **Tooling on our exact versions.** Whether Roborazzi, the Kotlin Gradle plugin's ABI validation and `com.vanniktech.maven.publish` 0.37.0 work with `com.android.kotlin.multiplatform.library` on AGP 9.4.1, Gradle 9.8.2 and KGP 2.4.21 (newer than the plugin's "tested up to"); whether a root KMP publication without iOS targets resolves cleanly. Each needs a spike in 10A.
- **Accessibility checks under Robolectric** are not documented by Android; Roborazzi's module is the candidate.
- **Robolectric and API 37**: not checked.
- **`NfcAdapter` reference page** did not render through the fetcher; the reader-mode flag names and API levels rest on the Phase 5 note.
- **R8**: whether kotlinx.serialization's shipped rules cover the SDK's models, what Bouncy Castle needs under R8 with JMRTD, and which ORT classes its JNI code needs kept, were not read or measured.
- **Play Integrity**: behaviour on devices without Google Play services; what Play will require of target API levels in 2027.
- **Not evaluated**: LiteRT as a face-detection runtime; a Kotlin Multiplatform crypto library for writing BAC and PACE ourselves (option c of section 5.2); OpenCV's AAR page alignment (not recommended anyway).
- **Unproven on CI**: booting an API 35+ 16 KB emulator image on the private repository's 2-vCPU runner; the `android` job's actual duration (needed for a full cost figure).
- **Legal questions** (LGPL on app stores, the Classpath exception's obligations) are flagged, not answered: nothing here is legal advice.

## Fact-check (2026-10-29)

Independent re-check of the load-bearing facts against their primary sources, read on 2026-10-29 by a separate agent with
`scripts/fc/fc_fetch.py` (RFC 9309 robots matching before any other request to a host, at least 1.25 s between requests to
one host, no redirect followed automatically, no personal data sent; downloads under `downloads/fc-*/`, Python with `-I`,
nothing downloaded executed). Maven Central dates are the `Last-Modified` of each POM (HEAD requests); the ORT and
zxing-cpp AARs were downloaded whole (55.1 MB and 2.9 MB) into `downloads/fc-aar/` and read with Python's `zipfile` and an
ELF program-header parser (`scripts/fc/fc_aar.py`); source jars were read the same way (`scripts/fc/fc_zip_head.py`).
`repo1.maven.org`'s two `User-agent: *` groups (`Allow: /` and `Disallow: /`) were merged as RFC 9309 §2.2.2 says, and the
allow rule wins the tie, as the note also read it. Summary: **30 confirmed, 0 corrected, 0 could not verify.**

| # | Fact | Verdict | Primary source and what it shows |
|---|---|---|---|
| 1 | `onnxruntime-android` latest 1.31.1 (2026-10-26), passing 1.31.0 (2026-10-09), MIT | confirmed | `maven-metadata.xml` (latest 1.31.1); POM `Last-Modified` 1.31.0 2026-10-09 05:10:45 GMT, 1.31.1 2026-10-26 19:22:50 GMT; POM licence MIT; `LICENSE` at `v1.31.0` MIT; GitHub releases v1.31.0 2026-10-09, v1.31.1 2026-10-26 |
| 2 | ThirdPartyNotices lists Eigen under MPL-2.0 | confirmed | `ThirdPartyNotices.txt` at `v1.31.0`, line 417 ("Eigen", "MPL v2.0") |
| 3 | AAR 55,138,854 bytes; merges `ACCESS_NETWORK_STATE`, `INTERNET`, provider `ai.onnxruntime.TelemetryInitializer` (initOrder 100); consumer rules keep only telemetry classes | confirmed | AAR `Content-Length` and download size 55,138,854; `AndroidManifest.xml`; `proguard.txt` (five `-keep` lines, all telemetry) |
| 4 | Privacy.md: telemetry ON by default in official Android builds (1DS, platform device IDs, Java HTTP + SQLite); `ORT_DISABLE_TELEMETRY=1`, the API (a minimal init event may already be sent), `--no_telemetry` | confirmed | `docs/Privacy.md` at `v1.31.0` (each point stated) |
| 5 | `libonnxruntime.so` sizes per ABI and 16 KB `p_align` | confirmed | AAR entries: arm64 34,208,680 / 12,887,720; armeabi-v7a 24,182,012 / 11,639,973; x86 40,741,404 / 15,126,919; x86_64 40,827,944 / 14,993,057 bytes; every `PT_LOAD` `p_align` 16384 (also for `libonnxruntime4j_jni.so`) |
| 6 | `io.github.zxing-cpp:android` 3.1.1 (2026-07-29) Apache-2.0; AAR 2.94 MB, arm64 .so 1.75 MB, 16 KB; keeps `zxingcpp.**`; depends on `camera-core` 1.5.2 | confirmed | `maven-metadata.xml` (latest 3.1.1); POM (Apache-2.0, `camera-core` 1.5.2 compile); AAR 2,944,658 B; `libzxingcpp_android.so` arm64 1,746,848 B; `p_align` 16384 on all four ABIs; `proguard.txt` `-keep class zxingcpp.** { *; }`; `LICENSE` at `v3.1.1` Apache-2.0 |
| 7 | `com.google.zxing:core` 3.5.4 (2025-11-11) Apache-2.0, in maintenance mode | confirmed | POM `Last-Modified` 2025-11-11; `README.md` at `zxing-3.5.4` ("Project in Maintenance Mode Only") |
| 8 | CameraX 1.6.2 (2026-08-26) newest stable; 1.7.0-rc01 (2026-10-21); 1.7.0-alpha02 Compose on compileSdk 37 (AGP ≥ 9.2.0) | confirmed | `developer.android.com/jetpack/androidx/releases/camera` (version table; 1.7.0-alpha02 of July 1, 2026: "Updated Compose compileSdk to API 37 … minimum AGP version of 9.2.0"; the same release also notes "Remove requirement for compileSdk 37" for the other artifacts) |
| 9 | ImageAnalysis defaults and use-case combinations | confirmed | `camerax/analyze` ("non-blocking (default)", `STRATEGY_KEEP_ONLY_LATEST`, YUV_420_888 default, RGBA_8888 option, `ImageProxy.close()`, "less than 32ms for 30 fps"); `camerax/architecture` (one instance each of Preview, VideoCapture, ImageAnalysis and ImageCapture; an incompatible combination throws at `createCaptureSession()`) |
| 10 | YuNet `face_detection_yunet_2026may.onnx` 229,738 B, SHA-256 `ebafce4e…22f0f0`, MIT at `47534e2`; WIDER FACE is CC BY-NC-ND | confirmed | The Git LFS pointer at the commit (`oid sha256:ebafce4e3c11…22f0f0`, `size 229738`), matching `models/manifest.json`; `LICENSE` and `README.md` at the commit (MIT; WIDER Face named as the evaluation set); `shuoyang1213.me/WIDERFACE/` ("Creative Common License (cc by-nc-nd)") |
| 11 | Guidance constants in `contracts/fixtures/flow/selfie-capture.json` | confirmed | `client`: `hold-ms` 500, `side-trigger-factor` 1.25, `center-trigger-factor` 0.8, `guidance-hz` 8, `preview-width-px` 320, `manual-shutter-after-ms` 10000; `server`: 0.021 and 0.077 |
| 12 | JMRTD 0.8.9 (2026-10-03): `PassportService.java` LGPL 2.1 or later; POM "LGPL" without a version; scuba-smartcards 0.0.21, bcprov/bcutil 1.86, cert-cvc 1.4.13 | confirmed | `maven-metadata.xml` (latest 0.8.9), POM `Last-Modified` 2026-10-03; POM licence name and dependencies; source jar header ("version 2.1 of the License, or (at your option) any later version") |
| 13 | SCUBA 0.0.21 (2026-08-22): `CommandAPDU`/`ResponseAPDU` GPL-2.0-only with Classpath exception; `CardService` LGPL 2.1+; `scuba-sc-android` 0.0.27 adds `NFC`, no R8 rules | confirmed | `scuba-smartcards-0.0.21-sources.jar` headers; `scuba-sc-android-0.0.27.aar` (manifest `android.permission.NFC`; no `proguard.txt`) |
| 14 | Classpath exception wording; LGPL-3.0 §4(e) | confirmed | SPDX `Classpath-exception-2.0.txt`; `LGPL-3.0-only.txt` §4(e) ("only if you would otherwise be required … under section 6 of the GNU GPL") |
| 15 | Server NFC contract: `chc_`, 16-hex nonce, `expires-at`, 300 s, limit 10, AA response ≤ 1 KiB | confirmed | `packages/contracts/src/chip-challenges.ts` (`CHIP_CHALLENGE_TTL_SECONDS = 300`, `CHIP_CHALLENGE_LIMIT = 10`, `CHIP_CHALLENGE_NONCE_HEX_LENGTH = 16`, `ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES = 1024`, `idSchema('chc')`) |
| 16 | Play Integrity standard: `requestHash` ≤ 500 bytes; `decodeIntegrityToken` with a service account | confirmed | `google/play/integrity/standard` ("a maximum length of 500 bytes"; `playintegrity.googleapis.com/v1/PACKAGE_NAME:decodeIntegrityToken`); the verdicts page exists as cited |
| 17 | Quota 10,000/day per Cloud project; increase needs Google Play distribution; setup names `integrity:1.6.0`; terms (2024-05-20) forbid fingerprinting or tracking | confirmed | `setup` ("default daily limit of 10,000"; "your app must be available on Google Play"; `com.google.android.play:integrity:1.6.0`); `terms` ("Last modified: May 20, 2024"; "may not use the Play Integrity API to fingerprint or track individual users or devices") |
| 18 | RootBeer 0.1.2 (POM 2026-03-17) Apache-2.0; 20 KB AAR with 16 KB-aligned `libtoolChecker.so`; bypassable; no `<queries>`; package visibility from targetSdk 30 | confirmed | POM `Last-Modified` 2026-03-17 (GitHub release 2026-03-07); AAR 20,238 B, `p_align` 16384 on four ABIs, manifest without `<queries>`; `README.md` at `0.1.2` (per-check limitations, e.g. "potentially bypassing detection"); `LICENSE` Apache-2.0; `training/package-visibility` (Android 11, API 30) |
| 19 | Play 16 KB rule: API 35+ apps on 64-bit devices; updates blocked from 2027-02-01; AGP 8.5.1+ and NDK r28+ | confirmed | `guide/practices/page-sizes` |
| 20 | Target API 36 from 2026-08-31 (extension to 2026-11-01); existing apps ≥ 35; apps, not libraries | confirmed | Play Console Help 11926878 (dates and levels); the page addresses apps only, so "not libraries" stays an inference |
| 21 | AGP 9.4: up to API 37; Gradle 9.6.0 minimum; NDK 28.2 default | confirmed | `build/releases/gradle-plugin` redirects to `agp-9-4-0-release-notes` (fetched after its own robots check): API 37, Gradle 9.6.0, NDK 28.2.13676358 |
| 22 | Android-KMP plugin: consumer keep rules need `optimization.consumerKeepRules.publish = true`; no build types; no BuildConfig | confirmed | `kotlin/multiplatform/plugin` |
| 23 | Central requirements; DNS TXT namespace check; primary key signs; no official Gradle plugin | confirmed | `central.sonatype.org` `publish/requirements/` (sources and javadoc jars, placeholders allowed, `.md5`/`.sha1`, `.asc`, POM metadata), `register/namespace/` (DNS verification), `requirements/gpg/` ("you must use the primary key"), `publish-portal-gradle/` ("there is no official Gradle plugin") |
| 24 | `com.vanniktech.maven.publish` 0.37.0 (2026-06-21) Apache-2.0; KMP library plugin since 0.35.0; tested up to Gradle 9.7.0-M1, AGP 9.4.0-alpha01, KGP 2.4.0; OSSRH shut 2025-06-30 | confirmed | `maven-metadata.xml` and POM date; `CHANGELOG.md` at `0.37.0`; `LICENSE` Apache-2.0. The repository uses AGP 9.4.1, KGP 2.4.21 and Gradle 9.8.2, so "ours are newer" holds |
| 25 | KGP ABI validation experimental since 2.2.0 (`checkLegacyAbi` then, `checkKotlinAbi` now); BCV 0.18.2 (2026-09-02) Apache-2.0, maintenance mode | confirmed | `kotlinlang.org/docs/whatsnew22.html`, `…/gradle-binary-compatibility-validation.html`; BCV POM date, GitHub release, `README.md` ("This plugin is in maintenance mode"), `LICENSE.TXT` |
| 26 | Roborazzi 1.77.0 (2026-10-22) / 1.76.0 (2026-09-29) Apache-2.0, RNG, accessibility module; Paparazzi 1.3.5 (2024-11-07), 2.0 alpha | confirmed | POM dates; `README.md` and `LICENSE` at `1.76.0` (Robolectric Native Graphics; "Roborazzi Accessibility Checks"; that the module is built on ATF was not re-read); Paparazzi `maven-metadata.xml` (2.0.0-alpha05 newest) and 1.3.5 POM date |
| 27 | Compose accessibility checks from 1.8.0 via `ui-test-junit4-accessibility`; Robolectric not documented | confirmed | `develop/ui/compose/accessibility/testing` (no Robolectric mention) |
| 28 | Runners (private 2 vCPU/8 GB, public 4/16; Linux Android acceleration); prices; included compute | confirmed | `docs.github.com` runner reference, runner pricing ($0.006, $0.012, $0.062), Actions billing ($12 Free, $18 Pro and Team; public standard runners free) |
| 29 | Emulator runner v2.38.0 (2026-07-05): `aosp_atd`, `google_atd`, `google_apis_ps16k`, AVD snapshot caching | confirmed | GitHub release; `README.md` at `v2.38.0` |
| 30 | Kover 0.9.11, Robolectric 4.17, Dokka 2.2.0 (Apache-2.0), Bouncy Castle 1.86 (MIT), cert-cvc 1.4.13 | confirmed | POM `Last-Modified`: 2026-09-29, 2026-09-10, 2026-03-26, 2026-09-11, 2021-06-23; Dokka `LICENSE.txt` Apache-2.0; the BC POM names the "Bouncy Castle Licence", whose page says it "should be read in the same way as the MIT license" |
