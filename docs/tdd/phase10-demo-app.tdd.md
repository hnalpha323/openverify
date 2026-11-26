# Phase 10, Workflow 10C: demo-app (family D)

Agent `demo-app`, Stage 2, beside the five other Stage 2 agents. Deliverables: the plan's "demo-app"
bullet (C218, C215.2's smoke test, C215.3). Owned paths: `android/demo-app/`. Commands ran after
`source scripts/env.sh` from `android/`, each as
`flock -E 75 -w <n> /tmp/openverify-gradle.lock ./gradlew --no-daemon ...`; outputs are abbreviated.
Times are wall seconds; the load is `cat /proc/loadavg` after the call. The Gradle lock was shared
with up to five agents, so most calls waited for it (3 to 18 minutes); each wait is written beside its
call.

No device ran any of this: the host has no `/dev/kvm` and no attached device, and no CI run can be
counted on (rule 28). The smoke device test is closed in three parts: its host twins, the compiled
test, and a "device proof open" line (section 6).

## 1. A finding first: the gate ran none of the demo's tests

`contracts-10c`'s delivery skeleton (`a5b128118`) set `testBuildType = "minifiedSmoke"` (C215.2). AGP 9
builds host (unit) tests only for the tested build type, so `:demo-app:testDebugUnitTest` stopped
existing, and gate call (4)'s `testDebugUnitTest` passed while running none of the demo's 18 tests.

```
./gradlew --no-daemon :demo-app:testDebugUnitTest
* What went wrong:
Selection failed
  Cannot locate tasks that match ':demo-app:testDebugUnitTest' as task 'testDebugUnitTest' not found in project ':demo-app'.
./gradlew --no-daemon :demo-app:tasks --all | grep -i unittest
testMinifiedSmokeUnitTest - Run unit tests for the minifiedSmoke build.
```

**Fix** `adcfeee4a`: `androidComponents.beforeVariants(selector().withBuildType("debug"))` enables the
debug variant's host tests again (`hostTests[HostTestBuilder.UNIT_TEST_TYPE]?.enable = true`). The
lockfile already held the `debugUnitTest*` configurations, so no dependency or lock entry changed.

```
./gradlew --no-daemon :demo-app:testDebugUnitTest
BUILD SUCCESSFUL in 1m 14s        exit 0 (lock wait 229 s); load 5.47 3.83 3.03
DemoFormTest 10, DemoViewModelTest 6, MainActivityTest 2: 18 tests, the count before this Workflow
```

The `minifiedSmoke` variant keeps its own host tests. They hold only the smoke test's host twins
(`src/testMinifiedSmoke/`, filtered to `dev.openverify.demo.smoke.*`), and `testDebugUnitTest` is
`finalizedBy` them, so the gate's `testDebugUnitTest` runs both and neither hides the other's failure.

## 2. Stubs

`747cf4fd5`: `EventLog`, `DemoComponents`, `DemoArtifacts`, `AppLinks`, the pickers' enums and
`LaunchOptions` in `DemoForm.kt`, the view model's new members, `SmokeLauncherActivity`, `SmokeReport`
and `SmokeTrust` in `src/minifiedSmoke/`, each compiling and doing nothing; the strings; and the build
wiring (`BuildConfig.OPENVERIFY_DEMO_ARTIFACTS`, the system properties
`openverify.demo.configuration` and `openverify.demo.releaseManifest`, the last from the `release`
variant's `SingleArtifact.MERGED_MANIFEST`).

```
./gradlew --no-daemon :demo-app:compileDebugUnitTestKotlin :demo-app:compileMinifiedSmokeUnitTestKotlin
BUILD SUCCESSFUL in 38s           exit 0 (lock wait about 200 s)
```

## 3. RED

`f9c1a532c`: 61 new tests on the debug variant and 7 on `minifiedSmoke`. 44 and 7 failed, each for
the reason its slice lacks; the 18 earlier tests and the 17 new ones that pin what already held
(for example "the shipped configuration permits no cleartext anywhere") passed.

```
./gradlew --no-daemon --continue :demo-app:testMinifiedSmokeUnitTest        exit 1 (lock wait 64 s); load 6.49 8.65 8.23
./gradlew --no-daemon --continue :demo-app:testDebugUnitTest -x :demo-app:testMinifiedSmokeUnitTest   exit 1 in 39 s (lock wait 152 s); load 4.25 6.54 7.47
testDebugUnitTest tests 79 failed 44        testMinifiedSmokeUnitTest tests 7 failed 7

AppLinksTest > a one-time link on the compiled-in host is opened against the compiled-in API :: AssertionError (the stub answers null)
AppLinksTest > the API is the compiled-in one whatever the flow domain is :: expected:<https://api.example.net> but was:<null>
AppLinksTest > only a view intent carries a link :: expected:<https://verify.example.com/#inquiry-id=...> but was:<null>
  (6 of AppLinksTest's 9; the three "is refused" cases pass on a stub that refuses everything)
DemoArtifactsTest > a configuration names its artifacts() :: expected: <[sdk]> but was: <[]>
DemoComponentsTest > the picked outcome and the event log are installed() :: expected: <EventLog@51b01960> but was: <null>
DemoComponentsTest > installing replaces what the process had installed() :: expected: <HUMAN> but was: <null>
DemoFormTest > the pickers' language and appearance ride on both launches() :: expected: <es> but was: <null>
DemoHonestyTest > the App Links filter is a commented example for the compiled-in host ... :: NoSuchElementException (no comment holds an intent filter)
DemoHonestyTest > the README says the demo is a test harness for sandbox inquiries ... :: FileNotFoundException: README.md
DemoViewModelTest > the picked language and appearance ride on both launches :: expected:<LaunchOptions(locale=FR, appearance=LIGHT)> but was:<LaunchOptions(locale=DEVICE, appearance=SYSTEM)>
DemoViewModelTest > a link on another host is refused with a line that does not repeat it :: expected:<ResultMessage(text=..., args=[])> but was:<null>
DemoViewModelTest > the picked sandbox outcome is installed with the event log ... :: expected:<BOT> but was:<null>
  (6 of the view model's 7 new tests)
EventLogTest > each event is named, and nothing it carries is kept() :: expected: <[Started, StepShown, CameraPermission, CaptureFailed, Submitted, Waiting, Ended]> but was: <[]>
EventLogTest > a name is a constant of this app ... :: ... but was: <[, , , , , , ]>
MainActivityTest > the app installs its event log when the process starts :: expected same:<EventLog@78b18cef> was not:<null>
MainActivityTest > the picked sandbox outcome is installed before the session launch :: performScrollTo() failed ... could not find any node (no picker on the screen)
MainActivityTest > with no outcome picked a launch asks for none :: expected null, but was:<BOT>
MainActivityTest > a one-time link on the app's own host starts the flow :: expected:<dev.openverify.sdk.OpenVerifyInquiryActivity> but was:<null>
MainActivityTest > a link on another host starts nothing and is refused on the screen :: assertExists ... could not find any node
  (all 11 of the activity's new tests)
MergedManifestTest > the release build's merged manifest is exactly its allowlist() :: no allowlist manifest-allowlist/sdk.json for the configuration sdk
MergedManifestTest > there is one allowlist for each configuration that exists, and no other() :: expected: <[sdk-nfc.json, sdk.json]> but was: <[]>
  (5 of 6)
NetworkSecurityConfigTest > the shipped configuration trusts the system's authorities only ... :: the trust anchors are stated, and only the system's ==> expected: <[system]> but was: <[]>
SmokeBuildTest > the launcher is declared by the smoke build only, not exported ... :: FileNotFoundException: src/minifiedSmoke/AndroidManifest.xml
SmokeBuildTest > the device test makes its certificate at run time ... :: FileNotFoundException: .../smoke/MinifiedSmokeTest.kt
SmokeSessionFixtureTest > the smoke session is the golden session at its consent step :: src/androidTest/assets/smoke-session.json is missing
SmokeTrustTest > the client trusts none of the system's authorities() :: expected: <1> but was: <118>
SmokeTrustTest > the client reaches the server whose certificate it was handed() :: SocketException: Connection reset
SmokeLauncherActivityTest (4) :: FileNotFoundException: src/androidTest/assets/smoke-session.json
```

Two RED lines were not the intended reason, and GREEN showed why (section 4): `SmokeTrustTest`'s
"Connection reset" came from the test's own TLS server, not from the stub's trust; and
`SmokeLauncherActivityTest` failed on the missing session asset before it reached the launcher.

## 4. GREEN

Commits: `11c653997` (the pickers, the event log, the components, the optional-artifact line, the App
Links example), `f414d8cc4` (the network configuration), `72dff3b0d` (the allowlists), `8b502808e` (the
smoke launcher, the device test, the session asset, the twins), `cb10414a6` (the README).

What was built:

- **Pickers** (C218.1). `LocaleChoice` (device, `en`, `es`, `fr`, `de`, `ar`), `Appearance` and
  `SandboxOutcomeChoice` (none, bot, human) as chips that wrap. `LaunchOptions` rides on
  `OpenVerifyInquiry.Request` and `fromOneTimeLink`. The choices are kept in saved state by name (they
  are not secrets); a name a build does not know falls back to the default.
- **Sandbox outcome** (Phase 7 C90.9). `DemoApplication.onCreate` installs the event log with no
  outcome; each launch from the screen first calls
  `OpenVerifyAndroid.install(OpenVerifyComponents(eventListener = ..., sandboxSignalOutcome = ...))`
  with the picked value. No chip reader, face detector, integrity provider or transport is installed.
- **Event log** (C218.1). `EventLog` keeps the last 50 event names in memory. A name is a constant of
  the app chosen by a `when` over the sealed event, never a class name, so R8 cannot change it, and
  nothing an event carries is kept.
- **Optional artifacts** (C218.1). `BuildConfig.OPENVERIFY_DEMO_ARTIFACTS` is `sdk` or `sdk-nfc` from
  `openverifyDemoArtifacts`; the screen says which. Nothing calls a chip reader (Workflow 10E's).
- **App Links** (C218.2). The manifest holds the intent filter as a comment. `AppLinks.oneTimeLinkOrNull`
  opens a link only when it is `https` on the compiled-in host exactly (default port, no user), and
  always against the compiled-in API. `MainActivity` reads a view intent's link on a new launch and in
  `onNewIntent`, never again after a rotation; a refused link shows a line that does not repeat it.
- **Network configuration** (C213.4). `src/main`'s file now states its trust anchors
  (`<certificates src="system" />`); no cleartext, no user CA, no debug override.
- **Allowlists** (C215.3). `manifest-allowlist/sdk.json` and `sdk-nfc.json`, written by
  `UPDATE_MANIFEST_ALLOWLIST=1` from the `release` build's merged manifest and compared on every run.
- **Smoke** (C215.2). `src/minifiedSmoke/` holds `SmokeLauncherActivity` (not exported, no intent
  filter), `SmokeReport` and `SmokeTrust`; `src/androidTest/` holds `MinifiedSmokeTest` and its session
  asset; `src/testMinifiedSmoke/` holds the twins and their TLS server.

Three corrections made on the way to GREEN:

1. **The twins' TLS server.** It asked for the JDK's own TLS provider by name. Robolectric installs
   Conscrypt first in the test JVM, and a server pinned to `SunJSSE` reset the Conscrypt client's
   handshake. Reproduced outside Gradle with a one-file Java program (JDK only: 200; Conscrypt and
   BouncyCastle first with a pinned server: failure; with default providers on both sides: 200). The
   server now takes every JCA object from the default providers.
2. **`MergedManifestTest`'s "no configuration claims a web domain".** The manifest merger keeps
   comments, so the App Links example's comment is in the merged file. The test now reads the
   elements (no `BROWSABLE` category, no `VIEW` action, no `autoVerify`, no `<data>`), not the text.
3. **The pickers' layout.** The chips first sat in a horizontally scrolling row. Two activity tests
   could not reach a chip below the fold, because `performScrollTo` scrolled the row and not the
   screen. The chips now wrap (`FlowRow`), which is also the better screen at a large font.

```
UPDATE_CONTRACT_FIXTURES=1 UPDATE_MANIFEST_ALLOWLIST=1 ./gradlew --no-daemon --continue :demo-app:testDebugUnitTest      (writes sdk.json and smoke-session.json)
UPDATE_MANIFEST_ALLOWLIST=1 ./gradlew --no-daemon -PopenverifyDemoArtifacts=sdk,nfc :demo-app:testDebugUnitTest -x :demo-app:testMinifiedSmokeUnitTest --tests "*MergedManifestTest"      (writes sdk-nfc.json)
diff manifest-allowlist/sdk.json manifest-allowlist/sdk-nfc.json
<   "configuration": "sdk",
>   "configuration": "sdk-nfc",
>     "android.permission.NFC",
<     { "name": "android.hardware.camera.any", "required": false }
>     { "name": "android.hardware.camera.any", "required": false },
>     { "name": "android.hardware.nfc", "required": false }

./gradlew --no-daemon --continue :demo-app:testDebugUnitTest          (a plain run: nothing written)
BUILD SUCCESSFUL in 1m 22s        exit 0 (lock wait 1,100 s); load 8.76 7.03 7.82
testDebugUnitTest tests 79 failed 0 skipped 0
testMinifiedSmokeUnitTest tests 7 failed 0 skipped 0
```

## 5. What the allowlist holds (`sdk`)

Permissions `INTERNET`, `CAMERA`, `HIDE_OVERLAY_WINDOWS` and AndroidX's own
`dev.openverify.demo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (declared with protection level
`signature`); the optional feature `android.hardware.camera.any`; no `<queries>`; activities
`MainActivity` (exported) and `OpenVerifyInquiryActivity` (not exported); providers
`androidx.startup.InitializationProvider` and Compose resources' `AndroidContextProvider` (neither
exported); service `androidx.camera.core.impl.MetadataHolderService` (not exported); receiver
`androidx.profileinstaller.ProfileInstallReceiver` (exported, behind `android.permission.DUMP`).
`sdk-nfc` adds the `NFC` permission and the optional feature `android.hardware.nfc`, which is exactly
what `openverify-nfc`'s manifest declares.

## 6. The smoke device test and its host twins (rule 28)

- **(a) Host twins**, on the `minifiedSmoke` variant (not debuggable), on code R8 has not minified:
  - `SmokeTrustTest` (3): the launcher's client reaches a TLS server on 127.0.0.1 whose certificate it
    was handed, refuses in the handshake a server holding any other certificate, and accepts one
    issuer only.
  - `SmokeLauncherActivityTest` (4): the build is not debuggable; the launcher installs a transport,
    starts the session contract, the flow loads the session asset over TLS (the request carries the
    bearer token), the events `Started` and `StepShown consent` arrive, back cancels and
    `Canceled(inquiry)` returns through the contract; plain http to loopback ends
    `Failed(INVALID_REQUEST)` with no request; a launch without its extras starts nothing.
  - `SmokeBuildTest` (4, debug variant): the launcher is declared only by `src/minifiedSmoke/`, not
    exported, with no intent filter; that source set has no resource, network configuration, key or
    certificate; the device test makes its certificate at run time and never skips itself; the build
    tests `minifiedSmoke` with the debug signing config and no key.
  - `SmokeSessionFixtureTest` (2): the asset the device serves is the contract golden
    `contracts/fixtures/api/flow-session.json` positioned on its consent step, byte for byte.
  - The twins' server is the JDK's `HttpsServer` with a key and certificate made at run time by
    `keytool` in a temporary folder, because `mockwebserver3` and `okhttp-tls` are on the device
    tests' classpath only and this agent adds no dependency.
- **(b) The device test**, `MinifiedSmokeTest` (2 tests), compiled by gate call (6).
- **(c)** device proof open:
  `MinifiedSmokeTest.theMinifiedFlowLoadsItsSessionOverTlsThroughTheInstalledTransportAndReturnsItsResult`
  and `MinifiedSmokeTest.plainHttpToLoopbackIsRefusedBeforeAnyRequest`: that the build R8 minified
  as `release` does what the twins show on unminified code.

## 7. A second slice: what the device test may touch in a minified app

Found by reading the build, not by a failing run: the device tests' APK of a minified build type is
built against the minified app, and R8 removes or inlines whatever the app itself does not call. The
first device test called `SmokeReport.reset()` and the queues' getters, which only the test used, and
compared SDK values (`InquiryResult.Canceled(...)`, `OpenVerifyComponents()`), whose members R8 is free
to remove from the app. On a device that is a `NoSuchMethodError`, which no host run shows.

**RED** `9ecb0e18b`:

```
./gradlew --no-daemon :demo-app:testDebugUnitTest -x :demo-app:testMinifiedSmokeUnitTest --tests "*SmokeBuildTest"
SmokeBuildTest > everything the device test touches in the app is kept for it, and only that() FAILED
    the test imports nothing of the app or the SDK ==> expected: <[]> but was: <[dev.openverify.sdk.FailureReason, dev.openverify.sdk.Inq...
5 tests completed, 1 failed       exit 1 in 33 s (lock wait 57 s); load 8.07 15.83 19.87
```

**GREEN** `48859e301`: `SmokeReport.ended` turns the result into text inside the smoke package
(`Canceled <inquiry>`, `Failed <inquiry> <reason>`, `Completed <inquiry> <status>`), the device test
reads only that text and imports nothing of the app or the SDK, and `smoke-proguard-rules.pro`
(`-keep class dev.openverify.demo.smoke.** { *; }`) is named by the `minifiedSmoke` build type alone.
`release` is untouched, and the SDK and the demo's screen are minified in `minifiedSmoke` exactly as
in `release`.

```
./gradlew --no-daemon --continue :demo-app:testDebugUnitTest
testDebugUnitTest tests 80 failed 0 skipped 0
testMinifiedSmokeUnitTest tests 8 failed 0 skipped 0          exit 0 in 67 s (lock wait 72 s); load 3.78 10.62 17.21
```

Checked in the built APK (`./gradlew --no-daemon :demo-app:assembleMinifiedSmoke`, exit 0 in 35 s, lock
wait 43 s, load 4.27 6.89 12.91; `dexdump` of `demo-app-minifiedSmoke.apk`, 9,897,570 bytes): the
classes named under `dev/openverify/demo/` are `DemoApplication`, `MainActivity`,
`smoke/SmokeLauncherActivity` (with its companion), `smoke/SmokeReport` and `smoke/SmokeTrust`;
`SmokeReport` holds `ended`, `events`, `getEvents`, `getResults`, `onEvent`, `reset`, `results`; and of
5,620 classes one keeps a `dev/openverify/sdk/` name, `OpenVerifyInquiryActivity` (the manifest names
it), so the SDK is minified. The test APK (`demo-app-minifiedSmoke-androidTest.apk`, 324,759 bytes)
holds `MinifiedSmokeTest` and no app class.

## 8. Final gates

Each its own call from `android/` under the Gradle lock. Wall seconds, then the lock wait, then the
load after. Calls that finished in under 30 s found their tasks up to date or in the build cache from
an earlier run on the same inputs (this agent's or another's).

| Call | Command | Exit | Run | Wait | Load |
|---|---|---|---|---|---|
| (1) ui | `:openverify-sdk:testAndroidHostTest -PhostTestGroup=ui` | 0 | 115 | 279 | 5.69 |
| (1) flow | `:openverify-sdk:testAndroidHostTest -PhostTestGroup=flow` | 0 | 52 | 257 | 5.04 |
| (1) rest | `:openverify-sdk:testAndroidHostTest -PhostTestGroup=rest` | 0 (second run) | 22 | 80 | 5.81 |
| (2) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | 0 (second run) | 12 | 162 | 6.31 |
| (3) | `koverVerify checkKotlinAbi` | 0 | 15 | 156 | 7.16 |
| (4) | `testDebugUnitTest assembleDebug` | 0 | 175 first, 12 on the final tree | 233, 0 | 31.40, 5.50 |
| (4) | `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 440 first, 11 on the final tree | 736, 16 | 25.73, 5.02 |
| (5) | `:openverify-sdk:assemble` | 0 | 11 | 27 | 4.35 |
| (5) | `lint` | 0 | 143 | 36 | 3.33 |
| (6) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 212 first, 142 on the final tree | 208, 165 | 21.09, 9.04 |
| | `-PopenverifyDemoArtifacts=sdk,nfc :demo-app:testDebugUnitTest` (88 tests, `sdk-nfc.json`) | 0 | 72 | 0 | 5.68 |
| | `pnpm format:check` (repo root) | 0 | 104 | | 2.19 |

Two first runs failed on other agents' paths and passed on a re-run with nothing of this agent's
changed:

- **(1) rest**, first run (141 s, lock wait 194 s, load 10.54): one failure,
  `signals.ContextDeviceProbeCostTest > one collection over a large process stays inside its CPU
  budget`: "one collection took 49.6 ms of CPU, over the 45 ms budget". It is `carry-10c`'s test
  (KP10-22). It passed on the re-run at load 5.81. A CPU budget that fails at load 10 and passes at
  load 6 is a load-dependent test; reported to `integration-10c`, not edited here.
- **(2)**, first run (97 s, lock wait 296 s, load 10.77): 34 failures, every one "The original file
  ... screenshots/nfc-sdk/... was not found" in `nfc-sdk`'s `NfcStepScreenshotTest` and
  `NfcStepArabicScreenshotTest`, whose goldens were not committed yet. It passed on the re-run.

The first `:demo-app:assembleRelease :demo-app:bundleRelease` took 440 s at load 25.7, past the 300 s
at which a call is split again (rule 8): under that load run `:demo-app:assembleRelease` and
`:demo-app:bundleRelease` as two calls.

The demo's host tests: 18 before (and 0 run by the gate, section 1); 88 now, 80 on the debug variant
and 8 on `minifiedSmoke`, none skipped, on both configurations (`sdk` and `sdk,nfc`).

## 9. Checkpoint

Checkpoint 1: the commit whose subject holds "Workflow 10C demo-app checkpoint 1" (this file's).
