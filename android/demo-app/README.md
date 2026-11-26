# OpenVerify demo app (Android)

A test harness for sandbox inquiries, not a product. It launches the OpenVerify Android SDK
(`:openverify-sdk`) the way a host app does, so you can try a flow you published against your own
server. It bundles no credentials: your server creates the inquiry and its session token or one-time
link with an API key, and you paste them in.

The integration guide is [`docs/android/integration.md`](../../docs/android/integration.md); the SDK's
own README is [`../openverify-sdk/README.md`](../openverify-sdk/README.md).

## What is on the screen

One screen (`MainActivity`):

- **Session launch** (`OpenVerifyInquiry.Contract`): an inquiry ID, a session token
  (`POST /api/v1/inquiries/:id/resume`) and the API base URL.
- **One-time-link launch** (`OpenVerifyInquiry.OneTimeLinkContract`): a pasted link
  (`POST /api/v1/inquiries/:id/generate-one-time-link`). The API is always the base URL on the screen,
  never the link's origin.
- **Language**: the device's, or `en`, `es`, `fr`, `de`, `ar` (the request's `locale`).
- **Appearance**: system, light or dark (the request's `appearance`).
- **Sandbox bot-detection outcome**: none, bot or human. Before each launch the demo calls
  `OpenVerifyAndroid.install(OpenVerifyComponents(sandboxSignalOutcome = ...))` with the picked value,
  so a sandbox test of a branch on the bot-detection signal can take either route. The SDK sends it
  with a **sandbox** inquiry's signals only, and a production server ignores it.
- **Events**: the names of the events the flow told the app (`Started`, `StepShown`,
  `CameraPermission`, `CaptureFailed`, `Submitted`, `Waiting`, `Ended`), newest last. Names only:
  nothing an event carries is shown or kept, and the log lives in memory.
- **Last result**: how the flow ended on this device. The outcome of the inquiry is your server's to
  read.

The session token and the one-time link are held in memory only. The inquiry ID, the API base URL and
the pickers' choices survive process death in saved state.

## Build types

| Build | What it is |
|---|---|
| `debug` | Debuggable. Plain http is allowed to `10.0.2.2`, `localhost` and `127.0.0.1` only (the API on your development machine); everything else is https. The default API base URL `http://10.0.2.2:3000` works only here: in an app that is not debuggable the SDK ends a plain-http launch as `Failed(INVALID_REQUEST)`. |
| `release` | Minified and resource-shrunk by R8. Https only, the system's certificate authorities only. Built for the size and 16 KB checks; it is unsigned and nothing publishes it. |
| `minifiedSmoke` | `release` signed with the Android Gradle plugin's generated debug key, with one extra activity and two sets of keep rules for the smoke test below. Not debuggable, https only. |

```bash
source scripts/env.sh
(cd android && ./gradlew :demo-app:installDebug)   # on an emulator, with the API on port 3000
```

**On a real phone** `10.0.2.2` is not your machine (it is the emulator's name for its host). Forward the
API's port over adb, `adb reverse tcp:<port> tcp:<port>`, and type `http://127.0.0.1:<port>` as the API
base URL in the form: the debug build allows plain http to `127.0.0.1` and `localhost`, so nothing else
changes. The forwarding lasts until the phone is disconnected or `adb reverse --remove-all` is run.

## Optional modules

The Gradle property `openverifyDemoArtifacts` (in `android/gradle.properties`) selects which optional
artifacts the demo includes:

| Value | Includes |
|---|---|
| `sdk` (default) | `:openverify-sdk` alone. |
| `sdk,nfc` | Also `openverify-nfc`, which adds the NFC permission. The demo installs its chip reader (`OpenVerifyNfc.chipReader`), and its debug build gains the reader check (below). |
| `sdk,face` | Also `openverify-face` (ONNX Runtime). The demo installs its face detector factory, which runs YuNet through ONNX Runtime on the device, so a selfie step shows its guidance and can take the photo by itself; the shutter stays. The demo's manifest removes ONNX Runtime's `ACCESS_NETWORK_STATE` (`src/face/AndroidManifest.xml`). |
| `sdk,nfc,face` | Both. |

```bash
(cd android && ./gradlew -PopenverifyDemoArtifacts=sdk,nfc :demo-app:assembleDebug)
```

Any other value fails the build. The screen says which configuration a build was made with. Each
configuration has its own lockfile (`gradle.lockfile`, `gradle-sdk-nfc.lockfile`, ...) and its own
manifest allowlist (`manifest-allowlist/`). An artifact reaches the demo through one hook file
(`src/nfc/` or `src/face/`; a build without the artifact compiles the stub in `src/withoutNfc/` or
`src/withoutFace/`). The demo installs no integrity token provider:
OpenVerify ships none, and a host app implements `IntegrityTokenProvider` itself
([`docs/android/device-integrity.md`](../../docs/android/device-integrity.md)).

### The reader check (debug builds with `nfc` only)

A debug build that includes `nfc` has a second launcher entry, "OpenVerify reader check" (`src/readerCheck/`). It is for the owner's one manual step: reading a real passport or identity card with the installed chip reader on a real phone. You type the document's MRZ key (document number, date of birth, date of expiry) or its card access number, hold the document to the phone, and the screen shows **pass or fail per protocol and per file**, or the reader's reason when the read fails.

It starts no flow and calls no server. The key lives in the screen's memory only, the window is kept out of screenshots, the read stops when the screen is left, and what the reader returned is overwritten before the result is shown: nothing of the document is shown, stored or logged. The challenge the chip signs is random and made on the phone, so the result says what the device did and verifies nothing. `release` and `minifiedSmoke` builds never hold the screen (`ReaderCheckTest`, `ReaderCheckAbsentTest`).

Record only pass or fail per document type and protocol. No real document has been read with the reader yet.

## App Links example

`src/main/AndroidManifest.xml` carries a **commented** intent filter (`android:autoVerify="true"`) for
a flow domain. It stays a comment: the demo claims no domain. `AppLinks.kt` is the code that goes with
it. Before `OpenVerifyInquiry.fromOneTimeLink` it checks that the link is https on the host compiled
into the app (`AppLinks.HOST`, a placeholder on `example.com`), and it always passes the compiled-in
API base URL (`AppLinks.API_BASE_URL`). A link on any other host is refused, with a line on the screen
that does not repeat the link.

A link from anywhere but your own server's messages can still bind the person to someone else's
inquiry on your own API. Accept links only from your own server.

## What the app declares

`manifest-allowlist/sdk.json` and `manifest-allowlist/sdk-nfc.json` list what the `release` build's
merged manifest holds for each configuration: permissions, features, `<queries>`, and every activity,
provider, service and receiver with its `exported` value. `MergedManifestTest` fails on any
difference, so a dependency upgrade that adds a permission or a component is seen. After a change you
intend, rewrite the list for the configuration you build:

```bash
(cd android && UPDATE_MANIFEST_ALLOWLIST=1 ./gradlew :demo-app:testDebugUnitTest --tests '*MergedManifestTest')
(cd android && UPDATE_MANIFEST_ALLOWLIST=1 ./gradlew -PopenverifyDemoArtifacts=sdk,nfc :demo-app:testDebugUnitTest --tests '*MergedManifestTest')
```

## Tests

```bash
(cd android && ./gradlew :demo-app:testDebugUnitTest)   # host tests; the smoke test's host twins run after them
(cd android && ./gradlew :demo-app:assembleAndroidTest) # compiles the device test against minifiedSmoke
(cd android && ./gradlew :demo-app:connectedMinifiedSmokeAndroidTest)   # needs a device or an emulator
```

The device test `MinifiedSmokeTest` runs against the `minifiedSmoke` build. It starts a `MockWebServer`
on `127.0.0.1` over TLS with a certificate made at run time, and hands the certificate to
`SmokeLauncherActivity`, which exists only in `src/minifiedSmoke/` and is not exported. That activity
installs `OpenVerifyAndroidTransport.okHttp` with a client that trusts that certificate alone and
starts the session contract. The test checks that the minified flow loads its session, shows the
consent step and returns its result, and that plain http to loopback is refused. Its results are
written to `build/outputs/androidTest-results/connected/minifiedSmoke/`.

The device tests' APK is built against the minified app, where R8 removes what the app itself does not
use. So the test touches only the smoke package, which `smoke-proguard-rules.pro` keeps for the
`minifiedSmoke` build alone. The test's APK also reads from the app, at run time, every library class
the two share (androidx.tracing, the Kotlin standard library, coroutines, OkHttp, Okio), so the build
task `traceSmokeTestKeepRules` traces with R8 what the test's own classes name in the app's classpath
and keeps exactly that, with those packages' names, on the `minifiedSmoke` build alone (153 classes
when it was written). It refuses to keep anything of the SDK, of the demo's screen or of
kotlinx.serialization: those are minified exactly as in `release`, under the SDK's consumer rules alone.
`checkSmokeTestReferences`, which `assembleAndroidTest` runs, fails when the minified app lacks a class
or a member the test's APK refers to.

On a device reached over wireless adb (a serial with a colon) the Android Gradle plugin 9.4.1 ends the
connected task as failed whatever the tests did; read the result from the XML named above.

`SmokeLauncherActivityTest` and `SmokeTrustTest` (in `src/testMinifiedSmoke/`) are its host twins: the
same launcher and session on the JVM, on code R8 has not minified. Only a device run shows that R8's
output behaves the same.
