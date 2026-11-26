# OpenVerify Android SDK

`openverify-sdk` runs an inquiry's verification flow inside an Android app. It is a Kotlin Multiplatform library (ADR 0004): Android now, iOS later. It talks only to the OpenVerify flow API, with the inquiry session token your server creates.

- **Minimum Android version:** 8.0 (API 26).
- **Permissions:** `INTERNET` (install time), `CAMERA` (asked at run time, after the flow explains why) and `HIDE_OVERLAY_WINDOWS` (install time: on Android 12 and later the flow hides other apps' overlays while it is in front, C213.1). The SDK adds no other permission. `NFC` comes only with the optional `openverify-nfc` module ([Permissions](#permissions)).
- **Screens:** the flow's activity sets `FLAG_SECURE`, so documents and selfies stay out of screenshots, screen recordings and recents ([what that does not stop](#what-the-protections-do-not-stop)).
- **Version:** 0.1.0, unreleased. Nothing is published yet ([Publication](#publication)); the changes are in [`android/CHANGELOG.md`](../CHANGELOG.md).
- **Guides:** [`docs/android/`](../../docs/android/README.md): integration, events, themes and languages, capture, device integrity, NFC, privacy, sizes, and the release and support policy.

## Running an inquiry

Your server creates the inquiry and its session token with an API key (`POST /api/v1/inquiries/:id/resume`), and hands only the session token to the app:

```kotlin
val verify = registerForActivityResult(OpenVerifyInquiry.Contract()) { result -> /* InquiryResult */ }
verify.launch(OpenVerifyInquiry.Request(inquiryId, sessionToken, apiBaseUrl))
```

A one-time link works the same way, through `OpenVerifyInquiry.OneTimeLinkContract()` and `OpenVerifyInquiry.fromOneTimeLink(url, apiBaseUrl)`. The link supplies only the inquiry and its one-time token: the API is always the base URL compiled into your app, never the link's origin, so a link another app hands yours cannot point the SDK at another server.

## The minimum server

The SDK declares `OpenVerify-Flow-Spec: 2` and renders the step the server's position names. It needs an OpenVerify server with the Phase 9 flow engine or later (a session answer with `spec-version: 2` and a `position`); against an older one it shows the unsupported screen and ends `Failed(UNSUPPORTED_FLOW)`. An `nfc` step also needs a server with Workflow 10C's routes (`client-unable`, and `sandbox-chip` in a sandbox). The [integration guide](../../docs/android/integration.md#the-minimum-server) lists what the SDK renders.

## What the SDK sends

Everything goes to the flow API of the `apiBaseUrl` compiled into your app, with the inquiry's session token, and nowhere else. [`docs/android/privacy.md`](../../docs/android/privacy.md) lists every member by request; in short:

- **Images:** the ID photos and selfie poses the person takes (upright JPEG, no EXIF), and a supporting document's pages.
- **Typed values:** what the person types on a step or on an operator's screen (a name, a date of birth, an address, a document number, a phone number or email address, a wallet address), the one-time code, and their consent choices.
- **Chip files**, only on an `nfc` step with a chip reader: the files the server takes (the security object, DG1, DG2 and, when the chip has them, DG14, DG15, COM, CardSecurity and CardAccess; never DG11 or DG12), the chip's signature over the server's nonce, and a device report of the protocols tried. With the sandbox test chip the server builds the files, and the device never holds the portrait.
- **The device facts of the signals** (below), after consent and per tier: the session-integrity facts (the debugger facts and the emulator, root and hooking indicator codes of plan C210), the `ANDROID_ID` under device recognition only, and the device class.
- **The optional integrity token**, only when the session asks and your app installs an `IntegrityTokenProvider`.
- **The camera snapshot** with a selfie submit: the camera's id, the stream's size, frame rate and facing, the frames counted, and whether the photo is mirrored.
- **How each photo was taken** (`capture-method`, `capture-trigger`) and, when the app or phone cannot read a chip, the reason (`client-unable`). Both are client-reported.
- **The `User-Agent`** `OpenVerify-Android/<version>`: the SDK's name and version, nothing about the device.

**What it never sends:** anything to a host other than your API (no analytics, no crash reports, no call to Google or to OpenVerify's authors); an analysis frame, a face box or landmark, or a decoded barcode's bytes; a field value, token, image or chip byte in a result, an event, a log line, an intent or saved state; and none of the reads listed under [What the SDK never reads](#what-the-sdk-never-reads).

## What the SDK reads about the device (signals)

Phase 7 adds device signals (plan C94.7, ADR 0006). They are facts for the operator's review rules and workflows. No signal passes, fails or declines anything.

**When.** The SDK reads nothing about the device before the session may collect. That is after the consent step, and only under the tiers the server reports for this session in `GET /api/v1/flow/session` (`signals: { integrity, recognition }`). Those tiers follow the operator's `signal-collection` setting and the template's consent step.

- The SDK sends **one body per launch**, to `POST /api/v1/flow/signals`. It is sent beside the flow, so a slow or failing server never holds the user up.
- If the body cannot be sent, the server records `collector_missing` for the session. It never treats a missing body as a clean device.
- An inquiry that is already decided only shows its end screen, and nothing about the device is read for it.

| Tier | Default | What the SDK reads | Sent as |
|---|---|---|---|
| Session integrity | On after consent. The template's consent step must list the notice key `notice.session-integrity` | `Debug.isDebuggerConnected()`, and whether the host app's own build is debuggable (`ApplicationInfo.FLAG_DEBUGGABLE`). The device-integrity probes (Phase 10): the public `Build` fields (`BOARD`, `BRAND`, `DEVICE`, `HARDWARE`, `MANUFACTURER`, `MODEL`, `PRODUCT`, `TAGS`, `TYPE`; never `FINGERPRINT`), whether the device has telephony (`PackageManager.hasSystemFeature`), whether fixed paths exist (the emulator's QEMU devices, `su` in fixed directories), the paths mapped into the app's own process (`/proc/self/maps`), its thread names (`/proc/self/task/*/comm`), the mount table (`/proc/mounts`), whether two Xposed classes can be loaded by the app's class loader (never initialised), and the class names on the app's main-thread stack | `android-integrity`: `debugger-connected`, `app-debuggable`, and the codes the probes found in `emulator-indicators`, `root-indicators` and `hooking-indicators`. Codes only, from fixed lists; no file content, path, class name or build value is sent |
| Device recognition | Off. In `consent` mode the person ticks `consent.device-recognition` on this session. In `exempt` mode the step lists the notice key `notice.device-recognition` | `Settings.Secure.ANDROID_ID` | `android-recognition`: `android-id`. The server keeps only an HMAC keyed per installation (`openverify/android-id/v1`), served as the device's `device-fingerprint` |
| Either tier | - | The screen's smallest width (`Configuration.smallestScreenWidthDp`) | `device-class`: `smartphone`, or `tablet` from 600 dp. This sets the session's `device-type` |
| Play Integrity (Phase 10), only when the session asks | Off. Only when the operator's environment binds a device-integrity provider and your app installs an `IntegrityTokenProvider` | Nothing itself: your provider is called once, after consent, with the request hash the server computed | `POST /api/v1/flow/integrity-challenges` (an empty body), then `POST /api/v1/flow/integrity-tokens`: `challenge-id` and your provider's `token`. The server decodes and judges the token; the SDK never keeps or logs it |

Every body also carries `platform: android`, the `collector-version` (1), the screen's step id and a `sequence`. A repeated sequence is ignored by the server, so a retry is safe.

**Sandbox only.** A host that installs `OpenVerifyComponents(sandboxSignalOutcome = SandboxSignalOutcome.BOT)` (or `HUMAN`) asks a **sandbox** session to read its bot-detection signal that way (Phase 7 C90.9). The body then carries `sandbox-outcome: bot` or `human` beside whichever tier applies. It is never read from the device, it is sent only when the session's environment is a sandbox (a production server refuses it, and would refuse the whole body), and under no tier nothing is sent at all.

**About `ANDROID_ID`.** On Android 8.0 and later it is a 64-bit value unique to each combination of app-signing key, user and device. It can change on a factory reset or a change of signing key. The same phone in two different apps gives two values, by design. The SDK sends it only in lower-case hex, and leaves it out when the platform gives none or gives a value the contract cannot carry. It never guesses a replacement.

**The device-integrity probes** (Phase 10, plan C210) run once per launch under session integrity, off the main thread, and each reports a fixed code: an emulator (`build_hardware_goldfish_or_ranchu`, `build_product_sdk`, `build_model_emulator`, `qemu_property`, `qemu_device_file`, `no_telephony_and_generic_board`), root (`su_binary_on_path`, `build_tags_test_keys`, `system_mounted_rw`, `magisk_mount_trace`, `ro_debuggable_and_not_secure`) or hooking (`frida_in_process_maps`, `frida_thread_name`, `xposed_bridge_loadable`, `xposed_in_stack_trace`, `unexpected_native_library`). A probe whose read the platform refuses reports nothing; a family none of whose probes answered is left out, never sent as clean. An empty list is not "not rooted" and not a pass. The server's three beta signals are never decisive alone.

**Play Integrity** (plan C211): OpenVerify ships no Google code. When the session says `integrity: { request: true }`, the SDK takes one challenge, calls your `IntegrityTokenProvider.token(requestHash)` once, and posts the token. A missing provider, a `null`, an exception or any failure sends nothing, and the server's integrity signals then read `null`. It runs beside the flow, so a provider that never answers holds nothing up.

**The tablet threshold** (600 dp, Android's `sw600dp` breakpoint for 7-inch tablets) is provisional. It has not been measured on OpenVerify data.

**What these signals cannot tell you.**
- Every read runs on a device the user controls. A rooted or modified device, or a hooking tool, can return stock answers.
- A debuggable build is normal while you develop your app.
- The emulator, root and hooking probes run inside that same environment: root hiding, a modified emulator image, renamed hooking tools and a repackaged app return clean answers, and the probes say nothing about camera injection or a relay. An emulator is expected to report itself as one; the device test that asserts it has not yet run to its end on a device.
- A Play Integrity verdict is about the app and the device, never the person; a certified device can still present an injected camera feed, and devices without Google Play give no verdict.

### What the SDK never reads

- `Settings.Global.ADB_ENABLED` or `DEVELOPMENT_SETTINGS_ENABLED`. Both always read 0 to third-party apps.
- Accessibility services. They can reveal a disability.
- IMEI, MEID, the SIM serial, the subscriber id, the build serial, MAC addresses or any other hardware identifier.
- Installed apps, location (GPS is not collected in Phase 7), contacts, the clipboard, or key-by-key typing data. The SDK declares no `<queries>` and never lists or queries other packages.
- `Build.FINGERPRINT` (the platform says not to parse it), network interfaces or local ports.

A host test, `NeverReadTest`, fails the build if a source of the SDK reads one of these, if the device facts above are read outside the Android signals code, or if the manifest asks for any permission but `INTERNET`, `CAMERA` and `HIDE_OVERLAY_WINDOWS`.

### Google Play Data safety

The host app's developer answers Google Play's Data safety form, and the operator of the OpenVerify server decides the purposes and retention. **The final answers are yours.** The entries below follow from what this SDK version sends to your OpenVerify server. Check them against Google's current guidance for the form.

| Data the SDK sends | When | Data safety data type | Purpose | Optional? |
|---|---|---|---|---|
| `ANDROID_ID` | Device recognition only | **Device or other IDs** | Fraud prevention, security, and compliance | Optional in `consent` mode (the person's tick). Required in `exempt` mode |
| Debugger attached, app debuggable, device class | Session integrity, or either tier for the device class | **App info and performance**: we suggest Diagnostics as the closest type | Fraud prevention, security, and compliance | Required while the operator collects session integrity |
| Emulator, root and hooking indicator codes | Session integrity | **App info and performance**: we suggest Diagnostics as the closest type | Fraud prevention, security, and compliance | Required while the operator collects session integrity |
| Play Integrity token (from your `IntegrityTokenProvider`) | Only when the session asks and you install a provider | **App info and performance**: we suggest Diagnostics; the token carries Google's attestation of your app and the device. Your provider's own request goes to Google: follow Google's Data safety guidance for the Play Integrity API too | Fraud prevention, security, and compliance | Optional: only with a provider you install |
| How each photo was taken: `capture-method` (`camera` or `upload`) and `capture-trigger` (`auto` or `manual`), Phase 10 | With each ID, document or selfie photo upload | **App activity**: we suggest App interactions as the closest type; the photo itself is "Photos" (below) | Fraud prevention, security, and compliance | Required with each photo. Client-reported: the server stores and serves it as what the client said, never as a result |
| ID photos and selfie poses; the chip's portrait (`chip-dg2`) on an NFC step with a reader | With each photo or chip-file upload | **Photos**: Google's "Photos and videos" group; we suggest Photos | Fraud prevention, security, and compliance | Required by the steps the operator's flow shows |
| A supporting document's pages (a photo or a PDF) | A document step | **Files and docs** | Fraud prevention, security, and compliance | Required by a document step |
| Typed values (name, date of birth, address, document number, phone number, email address, an operator screen's fields), the ID's country and class, and the chip's files other than the portrait with the chip's signature | The step that asks for each; chip files only on an NFC step with a reader | **Personal info**: we suggest Name, Email address, Phone number and Address where each is asked, and Other info for dates, document numbers and chip data | Fraud prevention, security, and compliance | Required by the steps the operator's flow shows |
| A wallet address and the signature that shows control of it | A crypto-wallet step | **Financial info**: we suggest Other financial info as the closest type | Fraud prevention, security, and compliance | Required by a crypto-wallet step |
| Consent choices (the texts accepted, the optional ones ticked, the language, the client-reported text digests) and the button pressed on an operator's screen | The consent step; each screen | **App activity**: we suggest Other actions as the closest type | Fraud prevention, security, and compliance; the consent record | Required |
| The selfie camera's snapshot, the chip reader's device report (protocols tried, read time) and a `client-unable` reason | A selfie submit; a chip submit; when the app or phone cannot read a chip | **App info and performance**: we suggest Diagnostics as the closest type | Fraud prevention, security, and compliance | Required with the step. Client-reported |

The table has one row per kind of data. [`docs/android/privacy.md`](../../docs/android/privacy.md) holds the fixed table behind it, one row for each wire member with its category, and the host test `WireDataSafetyTableTest` fails when a member the SDK sends has no row there or when the two tables name different categories.

- **Collected, and whether shared.** The data leaves the device, so Google treats it as collected. It goes only to your OpenVerify server, which you or your service provider run. Whether that counts as sharing depends on who runs the server and for whom, under Google's definitions.
- **Encrypted in transit.** Yes. The SDK sends only over https (plain http only to `localhost`, `127.0.0.1`, `::1` and the emulator's `10.0.2.2`, and only in a debuggable build of your app; any other build ends such a flow as `INVALID_REQUEST` before it sends anything).
- **Deletion.** The OpenVerify server deletes or redacts this data under the operator's retention and redaction settings.

The capture guidance (Phase 10, [docs/android/capture.md](../../docs/android/capture.md)) sends nothing of its own: analysis frames, face boxes, landmarks and decoded barcode bytes stay on the device for one frame callback. It decides only when to take the photo and what hint to show; the server measures every photo again, so a photo the device would take can fail there, and the reverse. Selfie auto-capture needs a face detector installed through `OpenVerifyComponents(faceDetectorFactory = …)` (the optional `openverify-face` module is planned for Workflow 10E); without one the selfie keeps the manual shutter.

## Permissions

| Permission | Declared by | Why |
|---|---|---|
| `INTERNET` | `openverify-sdk` | The flow API |
| `CAMERA` | `openverify-sdk` | ID, document and selfie photos; asked at run time, after the flow explains why. `android.hardware.camera.any` is not required, so a device without a camera can still install your app |
| `HIDE_OVERLAY_WINDOWS` | `openverify-sdk` | On Android 12 and later, hides other apps' overlays while the flow is in front |
| `NFC` | `openverify-nfc` only | Reading a document chip. The module also declares `android.hardware.nfc` as not required. An app that does not add the module asks for no NFC permission |
| `ACCESS_NETWORK_STATE` | ONNX Runtime's own manifest, which arrives with `openverify-face` only | Nothing in OpenVerify uses it. `openverify-face` does not remove it, because a library that did would also take it from any other library of yours. If your app has no other use for it, remove it in your own manifest: `<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" tools:node="remove" />` (no `tools:selector`) |

No audio, phone-state, location, storage or package-visibility permission, and no `<queries>` entry. The SDK's own reads of whether the phone has NFC and whether it is on (`PackageManager.FEATURE_NFC`, `NfcAdapter`) need no permission.

## Optional artifacts

`openverify-sdk` depends on none of them (ADR 0009): each capability is an interface your app installs through `OpenVerifyAndroid.install(OpenVerifyComponents(…))` ([integration guide](../../docs/android/integration.md#optional-components-the-install-registry)).

| Artifact | What it enables | Status |
|---|---|---|
| `openverify-nfc` (LGPL-3.0-or-later, its own licence) | `OpenVerifyNfc.chipReader(context)`: a `ChipReader` for the `nfc` step, reading an electronic passport's or ID card's chip with JMRTD | **Built; proved on the build host only.** Its JVM test drives JMRTD's real service against a synthetic chip with Basic Access Control and Active Authentication. PACE and Chip Authentication run in no automated test, and **no real document has been read** (the owner's read is an open step of the release gate). Measured cost: about +1.5 MB to download and +3.8 MB installed ([NFC](../../docs/android/nfc.md), [its README](../openverify-nfc/README.md)) |
| `openverify-face` (Apache-2.0) | `OpenVerifyFace.detectorFactory(context)`: a `FaceDetectorFactory` that runs YuNet through ONNX Runtime on the device, so selfie poses are auto-captured | **Built.** Its numbers match the server runtime's on a public-domain fixture frame, on the build host and on one phone (a Pixel 9, Android 17). On that phone the app's byte counters did not move (0 bytes received, 0 sent) over the measured window: a new process, inference, close and a 124-second quiet period, twice. That is a statement about that window on that phone, not a claim that nothing is ever sent; no emulator has run the module. Measured cost on `arm64-v8a`: +13.2 MB to download and +34.7 MB installed, nearly all of it ONNX Runtime's native library ([capture](../../docs/android/capture.md), [its README](../openverify-face/README.md)) |
| A Play Integrity provider | An `IntegrityTokenProvider` | **Not built: the owner declined it** (Phase 10 P3). OpenVerify ships no Google code and no `openverify-integrity-play` artifact. Your app implements the interface with its own dependency: [the host-side recipe](../../docs/android/device-integrity.md#the-host-side-provider-the-recipe) |

What each configuration adds to your app's size, per ABI, is in [`docs/android/sizes.md`](../../docs/android/sizes.md).

**What an app that adds one takes on:**

- **`openverify-nfc`:** one packaging line, `android { packaging { resources { pickFirsts += "META-INF/LICENSE.md" } } }` (both Bouncy Castle jars carry that path), and the obligations of distributing LGPL libraries, which its README sets out. Two files of its SCUBA dependency are `GPL-2.0-only WITH Classpath-exception-2.0`, used unmodified under the owner's recorded exception. The licence texts and the module's `NOTICE` travel in its AAR.
- **`openverify-face`:** ONNX Runtime's manifest reaches yours. The module removes ONNX Runtime's telemetry content provider; the `ACCESS_NETWORK_STATE` permission is yours to remove (the Permissions table above). If your app itself depends on ONNX Runtime and declares it ahead of this module, the module's removal does not reach the provider, and your own manifest must remove it (the module's README gives the line). ONNX Runtime's native library has Eigen (MPL-2.0) compiled in, under the owner's recorded exception; ONNX Runtime's notices, the model's licence and Eigen's source location travel in the AAR as assets under `assets/openverify-face/` (about 0.3 MB).

**Still open** for every artifact: publication to Maven Central waits on the owner (Phase 10 P4), so no coordinates resolve; the release is the staged repository ([release and support](../../docs/android/release-and-support.md)).

## Components and clients you install

Whatever your app installs runs inside the flow and receives personal data. Each must **process it on the device only**:

- **A `ChipReader`** receives the chip's access key (the MRZ's document number, date of birth and expiry, or the card's CAN) and the server's challenge, and returns the chip's files, the chip's signature and a device report. It must not store, log or send any of them.
- **A `FaceDetector`** receives every analysed selfie frame as a tensor and returns the model's raw outputs. It must not keep or send a frame or an output.
- **A transport** (`OpenVerifyAndroidTransport.okHttp(client)`) carries every flow request, so its interceptors see the session token, the images, the typed values and the chip files. **Never put a logging interceptor on a client you pass to the SDK**, and send nothing it carries anywhere else.
- **An `IntegrityTokenProvider`** receives only the server's request hash. What it sends to Google is your app's own request.
- **An event listener** receives no personal data ([events](../../docs/android/events.md)).

The SDK cannot check what an installed component does with what it receives.

### Biometric notices and on-device face detection

With a face detector installed (`openverify-face` runs YuNet on ONNX Runtime), face boxes and five landmarks are computed **on the device** for every analysed selfie frame: after consent, only while the selfie capture screen is shown, held for one frame callback and never stored or sent. Only the guidance's pose state outlives a frame. The photos themselves go to the server, which decides liveness and the face comparison. An operator's biometric notice should cover both: the on-device detection that guides the capture, and the server's processing of the selfie. Without a detector no face is detected on the device.

## What the protections do not stop

`FLAG_SECURE` is set on the flow's windows; on Android 12 and later other apps' overlays are hidden while the flow is in front; on Android 8 to 11 the consent, capture and submit controls ignore touches that arrive through an overlay; on Android 14 and later the fields that hold personal data are hidden from accessibility services that are not declared as accessibility tools; and the SDK sends only over https, trusting what your app's network security configuration trusts. These do **not** stop:

- a rooted device or a modified build of your app, which can read the screen and the app's memory and can return stock answers to every probe;
- an accessibility service declared as a tool, which reads every screen as TalkBack does;
- a host whose network security configuration trusts user-installed certificate authorities. Recommended: system trust anchors only and `cleartextTrafficPermitted="false"` in release builds;
- a photo of the screen taken with another device.

Certificate pinning is not built in; a client you pass through the transport keeps its own `CertificatePinner`.

## Failure reasons

`InquiryResult.Failed(inquiryId, reason)` carries one of a closed list. A result says how the flow ended on this device, never whether the person passed. [`docs/android/failure-reasons.md`](../../docs/android/failure-reasons.md) says what happened for each; what the host should do:

| Reasons | What the host should do |
|---|---|
| `INVALID_REQUEST`, `UNSUPPORTED_FLOW` | Fix the app or the template: correct the request, update the SDK or change the flow. Never the person's fault |
| `SESSION_EXPIRED`, `LINK_INVALID` | Ask your server for a new session or a new link, and launch again |
| `INQUIRY_EXPIRED`, `INQUIRY_REDACTED` | Create a new inquiry |
| `NETWORK_ERROR`, `SERVER_ERROR` | Offer to try again later; the inquiry is resumable |
| `INQUIRY_FAILED`, `SESSION_CANCELED`, `STILL_PROCESSING`, `FLOW_HALTED` | Read the inquiry on your server or wait for its webhook; do not relaunch the same inquiry |

A new reason is a minor-version change while the SDK is 0.x and a major one after 1.0.

## R8 and ProGuard

Host apps need no keep rules of their own: each optional module carries its consumer rules in its AAR, the SDK itself needs none (it reads no class name as text), and they are checked on a minified, resource-shrunk build of the demo app (`minifiedSmoke`, R8 full mode), since the library has no build types of its own.

## Languages

English is the source. Spanish, French, German and Arabic are **machine-drafted** and not yet reviewed by a fluent person; each locale's status is in `i18n/review-status.json` and in [themes and languages](../../docs/android/themes-and-languages.md#languages-c199). Legal texts come from the web flow's catalogs, never from a draft made for the SDK.

## Publication

Nothing is published to Maven Central, and no coordinates resolve from any public repository today. Until the owner's publishing account exists, the release is a staged local Maven repository that the build writes (`./gradlew publishAllPublicationsToStagingRepository`, under `android/build/staging-repo/`), or a build from source: [`docs/android/release-and-support.md`](../../docs/android/release-and-support.md).

## Tests

From `android/`:

```bash
./gradlew :openverify-sdk:testAndroidHostTest koverVerify
```

The signals tests are in `src/androidHostTest/kotlin/dev/openverify/sdk/signals/` and `src/commonTest/kotlin/dev/openverify/sdk/signals/`. The tests that hold this README and `docs/android/` to the code (the wire-to-Data-safety table, the failure reasons, the sizes) are in `src/androidHostTest/kotlin/dev/openverify/sdk/docs/`.
