# Changelog: OpenVerify Android SDK

One entry per release of `openverify-sdk` and `openverify-nfc`, which share a version. The SDK is 0.x: a minor version may break its API until the first published release, and every break is listed under "Breaking". From the first published release it follows semantic versioning ([release and support policy](../docs/android/release-and-support.md)).

## Unreleased

Version 0.1.0. Nothing has been published; this entry will be dated when it is released.

- **Minimum Android version (`minSdk`):** 26 (Android 8.0).
- **Compile and target SDK:** 36. A host app must compile against 36 or later.
- **Minimum server:** an OpenVerify server with the Phase 9 flow engine (flow-spec 2: a session answer with `spec-version: 2` and a `position`). An `nfc` step also needs Workflow 10C's `client-unable` route, and `sandbox-chip` in a sandbox.
- **Languages:** `en` (source); `es`, `fr`, `de` and `ar` machine-drafted, not yet reviewed.

### Breaking

Against the SDK as it stood before Phase 10 (never published):

- **The public surface is narrowed.** Only the entry points (`OpenVerifyInquiry` with `Request`, `OneTimeLink`, both contracts and `fromOneTimeLink`), `InquiryResult` with `FailureReason` and `InquiryStatus`, `Appearance`, `OpenVerifyAndroid`, `OpenVerifyComponents`, `FlowTransport` with `OpenVerifyAndroidTransport`, the events, and the installable interfaces with their value types stay public. The wire models, `FlowApi`, `FlowApiClient`, `FlowApiException`, `CapturedImage`, `CameraLens` and `OpenVerifyTheme` are internal: a host can no longer call the flow API through the SDK or implement `FlowApi`.
- **`fromOneTimeLink(url, apiBaseUrl)` requires `apiBaseUrl`.** A one-time link no longer chooses the API: the link supplies only the inquiry and its one-time token, and the API is always the base URL compiled into the host app.
- **`OpenVerifyInquiry.Request` changed shape.** It gained `locale` and `appearance`, so the data class's `copy` and `componentN` functions changed. Source that names the first three parameters still compiles.
- **`FailureReason.FLOW_HALTED` is new.** An exhaustive `when` over `FailureReason` must handle it: the server stopped the flow at its loop caps, and an operator resumes or expires the inquiry.
- **Flow-spec 2 only.** The SDK no longer walks a flow's steps or evaluates a transition on the device: it renders the step the server's position names. Against a server older than the Phase 9 flow engine it shows the unsupported screen and ends `Failed(UNSUPPORTED_FLOW)`.
- **Plain http only in a debuggable host.** `http` to `localhost`, `127.0.0.1`, `::1` and `10.0.2.2` is refused in a release build, which ends `Failed(INVALID_REQUEST)` before any request.
- **A new install-time permission.** `HIDE_OVERLAY_WINDOWS` joins `INTERNET` and `CAMERA` in the SDK's manifest.

### Added

- **The server-position renderer:** `screen` steps with the component catalogue, waits, the halted state, fallbacks, completion and failure steps with the decision's contest route, the help and privacy links, prefilled, masked and write-once values.
- **Request options:** `locale` (BCP 47) and `appearance` (`SYSTEM`, `LIGHT`, `DARK`) on both requests.
- **The install registry:** `OpenVerifyAndroid.install(OpenVerifyComponents(…))` for a chip reader, a face detector factory, an integrity token provider, an event listener and a transport (`OpenVerifyAndroidTransport.okHttp(client)`). OkHttp is an `api` dependency.
- **Events:** an optional, PII-free listener for UI coordination.
- **Themes and languages:** the session theme on Material 3, five languages with right-to-left layout set by the SDK, operator copy, and consent digests with a catalog version.
- **Capture:** an analysis stream beside the preview and the still, document guidance with auto-capture, a "barcode found" hint, selfie pose guidance with an installed face detector, "more time" on a selfie capture, and the client-reported `capture-method` and `capture-trigger`.
- **Device integrity:** emulator, root and hooking indicator codes under the session-integrity tier, and an optional Play Integrity token from a provider the host installs.
- **NFC:** the `nfc` step (the access key, the chip challenge on "I'm ready", the tap, the review of the chip's data, upload and submit), the screens for a phone or app that cannot read a chip with the `client-unable` report, and the sandbox test chip. `ChipReader.read` and the chip value types are experimental (`@OptIn(ExperimentalOpenVerifyApi::class)`).
- **Protections:** `FLAG_SECURE` on the flow's windows, hidden overlays on Android 12 and later, obscured-touch filtering on Android 8 to 11, and sensitive fields hidden from accessibility services that are not declared as tools on Android 14 and later.
- **`openverify-nfc`, the chip reader** (optional; LGPL-3.0-or-later; Workflow 10E): `OpenVerifyNfc.chipReader(context)`, a `ChipReader` on JMRTD over the phone's NFC reader mode (PACE where offered, else Basic Access Control; Chip Authentication where offered; Active Authentication over the server's nonce). Proved on the build host against a synthetic chip only: PACE and Chip Authentication run in no automated test, and no real document has been read. An app that adds it needs one packaging line (`pickFirsts += "META-INF/LICENSE.md"`) and takes on the LGPL libraries' obligations. Under the owner's recorded exception it depends on `scuba-smartcards`, two files of which are `GPL-2.0-only WITH Classpath-exception-2.0`; the licence texts travel in the AAR.
- **`openverify-face`, the face detector** (optional; Apache-2.0; Workflow 10E): `OpenVerifyFace.detectorFactory(context)`, a `FaceDetectorFactory` that runs YuNet through ONNX Runtime 1.31.0 on the device, with the model in the AAR and checked by SHA-256. It removes ONNX Runtime's telemetry provider from the merged manifest; ONNX Runtime's `ACCESS_NETWORK_STATE` reaches a host's manifest unless the host removes it. Under the owner's recorded exception ONNX Runtime's native library has Eigen (MPL-2.0) compiled in. On one phone (a Pixel 9, Android 17) the app's byte counters did not move over the measured window (a new process, inference, close and a 124-second quiet period, twice); nothing was measured on an emulator or another device.
- **The demo** builds in four configurations (`openverifyDemoArtifacts`: `sdk`, `sdk,nfc`, `sdk,face`, `sdk,nfc,face`) and, in debug builds with `nfc`, has a reader check that reads a chip and sends and stores nothing.
- **Sizes:** four measured configurations and an absolute size cap per configuration ([`docs/android/sizes.md`](../docs/android/sizes.md)).
- **Shipping:** an ABI dump with a check, consumer R8 rules, dependency locking and verification, 16 KB alignment and size checks, and a staged local Maven repository with sources and API docs.

### Not in this version

- **No face detector in the core SDK**, so selfies keep the manual shutter unless the host adds `openverify-face` or installs its own detector.
- **No Play Integrity artifact** (declined by the owner): the host implements `IntegrityTokenProvider` itself.
- **No read of a real document, and no run on an emulator, of the two optional artifacts.**
- **Nothing on Maven Central,** and no iOS binaries.
