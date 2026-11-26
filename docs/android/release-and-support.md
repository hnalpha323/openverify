# Release and support policy

How the Android SDK is versioned, what counts as its public API, what is published and where, and what is supported (Phase 10; plan C214, C217).

## Status

The SDK is **0.1.0, unreleased**. Nothing has been published to Maven Central, and no coordinates resolve from any public repository. The release is a staged local Maven repository the build writes, or a build from source (below). Publishing needs the owner's namespace, account and signing key, which do not exist yet.

## Versioning

- **0.x, until the first published release.** A minor version may break the API. Every break is listed in the "Breaking" section of [`android/CHANGELOG.md`](../../android/CHANGELOG.md).
- **From the first published release: semantic versioning.**
  - A breaking change comes only in a major version.
  - Something is deprecated in a minor version before a later major removes it.
  - Patches are made on the latest minor only. There is no long-term-support line.
- **A new `FailureReason`** is a minor-version change in 0.x and a major one after 1.0, because a host's exhaustive `when` stops compiling.
- **OkHttp is part of the public API.** `OpenVerifyAndroidTransport.okHttp(client: OkHttpClient)` names OkHttp's type, so OkHttp is an `api` dependency and appears in the POM with that scope. Moving the SDK to a new OkHttp major version is a breaking SDK change after 1.0, named in the changelog's "Breaking" section.
- **One version for every artifact.** `openverify-sdk` and `openverify-nfc` carry the same version (`openverifyVersion` in `android/gradle.properties`), which is also the version in the SDK's `User-Agent`.

## The public API

The public surface is small on purpose: the two activity-result contracts with `Request` and `OneTimeLink`, `InquiryResult` with `FailureReason` and `InquiryStatus`, `Appearance`, the install registry (`OpenVerifyAndroid`, `OpenVerifyComponents`), the transport, the events, and the interfaces a host may implement (`ChipReader`, `FaceDetectorFactory`, `IntegrityTokenProvider`) with their value types. The wire models and the flow API client are internal, so a change to the server's wire format is not a public change.

- **Every public change is visible in review.** The public ABI is dumped to `android/openverify-sdk/api/` and `android/openverify-nfc/api/`, the build compares it on every run of the Android gate (`checkKotlinAbi`), and a test holds the dump to a committed list of expected declarations, so a declaration cannot become public by accident.
- **Experimental API.** `ChipReader.read` and every chip value type need `@OptIn(ExperimentalOpenVerifyApi::class)`: the chip seam's fit for an iOS reader is not yet verified, so it may change in a minor version even after 1.0, until it is declared stable.
- **Not API:** the SDK's strings, resources, screens, log codes and test tags, and anything `internal`. A host cannot override the SDK's resources by name.

## The changelog

`android/CHANGELOG.md` has one dated entry per release, with the minimum Android version, the compile SDK, the minimum server and a "Breaking" section. Work that is not released yet sits under "Unreleased".

## Platform levels and the server

| | Now | Policy |
|---|---|---|
| Minimum Android version (`minSdk`) | 26 (Android 8.0) | Raising it is a breaking change |
| Compile and target SDK | 36 | A host app must compile against 36 or later. A move to 37 is planned as its own change after the first published release, because host apps would have to compile with 37 too |
| Minimum server | An OpenVerify server with the Phase 9 flow engine (flow-spec 2); an `nfc` step needs Workflow 10C's routes | Each release's changelog entry states it. Against an older server the flow ends `Failed(UNSUPPORTED_FLOW)` after the unsupported screen |
| ABIs | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` (the bundled barcode decoder's native library) | [Sizes](sizes.md) |
| 16 KB pages | Every native library the SDK bundles is 16 KB-aligned | Checked on each run of the Android gate: `zipalign` on the minified demo APK, the bundle's page-alignment setting, and the ELF alignment of every library in every AAR (`android/scripts/check-elf-alignment.py`). No run on a 16 KB emulator image has happened yet |

Dependencies are locked (`gradle.lockfile` per module) and verified by checksum (`android/gradle/verification-metadata.xml`), so a release builds from exactly the artifacts that were reviewed.

## What is published

| Artifact | Licence | Contents |
|---|---|---|
| `openverify-sdk` | Apache-2.0 | The Kotlin Multiplatform root module and its Android target (an AAR with its consumer R8 rules, a sources jar and a javadoc jar of real API docs). No iOS binaries in this release |
| `openverify-nfc` | LGPL-3.0-or-later, its own licence | The chip reader on JMRTD, SCUBA, cert-cvc and Bouncy Castle, which arrive through its POM. Its AAR carries its consumer R8 rules, the LGPL-2.1, LGPL-3.0, GPL-2.0 and Classpath-exception texts and its `NOTICE`. Proved on the build host only; no real document has been read ([NFC](nfc.md)) |
| `openverify-face` | Apache-2.0 | The YuNet face detector through ONNX Runtime, which arrives through its POM. Its AAR carries the model (MIT), its consumer R8 rule, its `NOTICE` and ONNX Runtime's licence and third-party notices ([capture](capture.md)) |

The demo app is never published. **No Play Integrity artifact exists**: the owner declined it (Phase 10 P3), so OpenVerify ships no Google code, and a host implements `IntegrityTokenProvider` with its own dependency ([device integrity](device-integrity.md#the-host-side-provider-the-recipe)).

Two of these artifacts carry code under licences the project's rule otherwise refuses, each by the owner's recorded, narrow exception (2026-11-08; `THIRD_PARTY_LICENSES.md` section 6):

- `openverify-nfc` depends on `scuba-smartcards`, two files of which are `GPL-2.0-only WITH Classpath-exception-2.0`. They are used unmodified, from Maven Central, only in this artifact.
- `openverify-face` depends on `onnxruntime-android`, whose native library has Eigen (MPL-2.0) compiled in, unmodified. Eigen's source location is in the module's `NOTICE`.

The release check `android/scripts/check-staged-repository.py` opens both staged AARs and fails when a licence text or notice is missing or is not the committed file.

### The staged repository

Until the owner's publishing account exists, **the staged repository is the release**:

```bash
cd android
./gradlew publishAllPublicationsToStagingRepository   # writes android/build/staging-repo/
./gradlew -p consumer-check build                     # an Android consumer resolves it
```

- It holds each artifact's POM, AAR or module metadata, sources jar, javadoc jar and checksums. Nothing in it is signed, and nothing is uploaded anywhere.
- The consumer check is a separate Gradle project that resolves the staged repository as an Android app would, with no iOS variant.
- **Using it from your app:** add the directory as a Maven repository in your `settings.gradle.kts` (`maven { url = uri("<path to>/android/build/staging-repo") }`) and depend on the modules by the group and version the staged POMs name. That group (`dev.openverify`) is **provisional**: it resolves only from that directory on your machine, and it may change before the first publication.
- Or build from source: include `android/openverify-sdk` (and `android/openverify-nfc`) in your Gradle build.

### The release workflow

`.github/workflows/android-release.yml` runs only when dispatched by hand. Without the owner's keys it stages the repository and attaches it to the run; it uploads nothing to Maven Central. The signing key and the publishing token will live in a protected GitHub environment reachable only from `main`, never as repository secrets. The workflow's device matrix (Android 8.0, Android 14 and a 16 KB Android 15 image) has not been run.

## Device tests and the minified smoke build

- **What a device run must hold.** `infra/scripts/check-connected-results.sh` reads the instrumentation's JUnit XML and fails when a test failed, errored or skipped itself, when none ran, and when a module ran fewer tests than its minimum (`openverify-sdk=14 demo-app=2 openverify-nfc=2 openverify-face=4` in both workflows). A device test asserts what the device reports and never skips.
- **Read the XML, not Gradle's exit, on wireless adb.** The Android Gradle plugin 9.4.1 looks a device up by its serial in a table keyed by an encoded form of it, and a serial that holds a colon (every wireless adb connection, `address:port`) is never found, so the connected task ends as failed whatever the tests did. An emulator's or a USB device's serial has no colon. This is not a setting of ours and nothing was changed to hide it: the result is read from `build/outputs/androidTest-results/connected/`. A run on a serial without a colon has not been made since the cause was found.
- **How `minifiedSmoke` differs from `release`.** The demo's device test runs against `minifiedSmoke`, which R8 minifies as it does `release`, with two sets of keep rules that exist for the test alone: the committed rule for the smoke package, and rules traced at build time (`:demo-app:traceSmokeTestKeepRules`, the Android Gradle plugin's own R8) for the library classes the test's APK reads from the app at run time. When it was written that was 153 classes of the Kotlin standard library, OkHttp, Okio, coroutines and androidx, kept with their names: 6,645 dex classes on the smoke build against 6,219 on `release`. The tracer refuses a rule that names the SDK, the demo's screen or kotlinx.serialization, so those are minified exactly as in `release`, with no keep rule for the SDK (it ships none since Workflow 11F, KP10-56). What the smoke build therefore does not prove: that the members of those shared library classes which only the test calls can be removed or renamed. `:demo-app:checkSmokeTestReferences`, which `assembleAndroidTest` runs, fails when the minified app lacks something the test's APK refers to ([the demo's README](../../android/demo-app/README.md)).

## Support

- **Supported:** the latest minor version, on Android 8.0 (API 26) and later, against a server at or above that version's minimum server.
- **Security fixes** are released as a patch on the latest minor.
- **Host apps need no R8 or ProGuard rules of their own**: the SDK needs none and ships no consumer rule (Workflow 11F, KP10-56), while `openverify-nfc` and `openverify-face` ship theirs, all checked on a minified build of the demo app.
- **Languages:** English is the source; Spanish, French, German and Arabic are machine-drafted until a fluent person reviews them ([themes and languages](themes-and-languages.md#languages-c199)).

## What is not yet proved

Stated here so that a release note can be honest about it:

- **On a device.** The SDK has 14 device tests in seven classes (the camera pipeline and its capture, the capture screen's layout over the real preview, the barcode decoder, the integrity probes, the NFC state and settings, the tap screen's pause and resume), the demo two (the smoke flow on its minified build), `openverify-nfc` two (reader mode with whatever NFC the device has) and `openverify-face` four (YuNet through ONNX Runtime against the server runtime's numbers, and the telemetry window). They compile and are lint-checked on every run of the Android gate, and each assertion about SDK logic has a host test over a fake. At the close of Workflow 10E they ran on one phone, a Pixel 9 on Android 17 with NFC on, awake and on charge, at commit `d6af3cc37`: 14 of 14, 2 of 2, 2 of 2 and 4 of 4, read from the instrumentation's own results (`check-connected-results.sh . openverify-sdk=14 demo-app=2 openverify-nfc=2 openverify-face=4`: 22 passed). No emulator has run any of them since before Workflow 10C's fixes, no other phone has, and neither workflow's device job has run them; what that leaves unproved (an emulator's camera and probes, a device without NFC or with NFC off, ONNX Runtime on x86_64, a 16 KB image) is listed as open device proofs in the Phase 10 progress entry.
- **With assistive technology.** The automated accessibility checks run on every screenshot test. The manual TalkBack, font-scale and keyboard pass by a person has not happened; no conformance is claimed.
- **With a real document.** The chip reader is built and proved on the build host against a synthetic chip; on the phone its device test ran with no chip in the field. **No real passport or identity card has been read**: that is the owner's step, in the demo's reader check, and it is open. PACE and Chip Authentication run in no automated test.
