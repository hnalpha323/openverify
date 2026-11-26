# Phase 10, Workflow 10D, Stage 4: fix-sdk (TDD evidence)

Agent: fix-sdk (the Android fixer of the Workflow 10D review). Paths: `android/` except `android/scripts/`.
Every Gradle call ran as `flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>` from
`android/`, in the foreground; every phone call inside `flock -E 75 -w 1800 /tmp/openverify-device.lock` with
the serial exported. No lock wait reached a second unless a section says so. The phone is the owner's
Pixel 9 (Android 17, API 37); its serial and address are never written here.

## 1. KP10-32 (HIGH): the demo's minifiedSmoke device test could not start

### Cause, verified

The device test's APK is minified by its own R8 pass with `-applymapping` of the app's mapping and with the
app's classes, as they are before R8, as its classpath (`build/outputs/mapping/minifiedSmokeAndroidTest/configuration.txt`:
`-keep class * {*;}`, `-applymapping .../minifiedSmoke/mapping.txt`). The test APK does not package what the
app's runtime classpath already has (androidx.tracing, the Kotlin standard library, coroutines, OkHttp, Okio,
androidx.concurrent, androidx.lifecycle); at run time it reads those from the minified app, where R8 had
removed what the app does not call. The hypothesis in the item was right.

### RED 1, the phone (HEAD `bb2b31984`, load 0.40)

`./gradlew --no-daemon :demo-app:connectedMinifiedSmokeAndroidTest` on a Pixel 9, Android 17:

```
> Task :demo-app:connectedMinifiedSmokeAndroidTest FAILED
<testsuites tests="0" failures="0" errors="0" skipped="0" time="0.000" ... />
E AndroidRuntime: FATAL EXCEPTION: main
E AndroidRuntime: Process: dev.openverify.demo, PID: 15519
E AndroidRuntime: java.lang.NoClassDefFoundError: Failed resolution of: Landroidx/tracing/Trace;
E AndroidRuntime: 	at androidx.test.runner.AndroidJUnitRunner.onCreate(r8-map-id-...:26)
E AndroidRuntime: Caused by: java.lang.ClassNotFoundException: androidx.tracing.Trace
```

### RED 2, the host check (commit `fa7f7af9b`)

A new task `:demo-app:checkSmokeTestReferences` (in `android/demo-app/build.gradle.kts`) traces, with the R8
that AGP 9.4.1 bundles (`com.android.tools.r8.tracereferences`, in `builder-9.4.1.jar`: no dependency added),
every class, field and method the dex of the two APKs names and that neither they nor `android.jar` define,
minus what the app's APK alone leaves undefined. `assembleMinifiedSmokeAndroidTest` (gate call 8) depends on it.

```
$ ./gradlew --no-daemon :demo-app:checkSmokeTestReferences        # 50 s
> The smoke device test's APK refers to 225 classes or members the minified app lacks (the runner would die on
  the first one it reaches; KP10-32). The first: androidx.concurrent.futures.CallbackToFutureAdapter; ...;
  androidx.tracing.Trace; androidx.tracing.Trace#beginSection(); androidx.tracing.Trace#endSection(); ...
BUILD FAILED
```

The report (`build/reports/smoke-test-references/missing.txt`) names `androidx.tracing.Trace` and
`kotlin.LazyKt`, the two classes the phone died on, with `kotlin.*` (stdlib facades), `kotlinx.coroutines.*`,
`okhttp3.*`, `okio.*` and renamed classes of the same libraries.

### GREEN (commit `84cf6dc17`)

Direction (a) of the item, with the rules derived from a stated source instead of one class per crash:

- `:demo-app:traceSmokeTestKeepRules` runs R8's reference tracer over the test's own classes and its test-only
  libraries as they are before minification (the androidTest component's `ScopedArtifact.CLASSES`, minus every
  file the app's own classes hold) against the app's classes, and writes one keep rule per class, field and
  method of the app's classpath they name: 153 classes at this commit (kotlin and its subpackages 71,
  okhttp3 and its subpackages 41, okio 12, kotlinx.coroutines 9, androidx.annotation 8, androidx.concurrent 3,
  androidx.lifecycle 2, androidx.tracing 1, androidx.compose.runtime.internal's one annotation,
  org.jetbrains.annotations 2, Guava's ListenableFuture 1, and the smoke package's two, which the committed
  rule already keeps). The file is a build output (`build/generated/smoke-test-keep-rules/rules.pro`), added to the
  minifiedSmoke variant alone through `variant.proguardFiles`; nothing is written by hand.
- The task refuses to write a rule that names `dev.openverify.sdk.`, `dev.openverify.demo.` (outside the smoke
  package) or `kotlinx.serialization.`.
- Two things the phone taught, each after a run:
  1. With `allowobfuscation` on the traced rules the host check still found
     `kotlin.coroutines.jvm.internal.DebugProbesKt#probeCoroutineSuspended()` unrenamed in the test APK (the app
     had renamed it; the test's `-applymapping` pass did not follow). So the traced rules keep names.
  2. The first run with the rules died in `androidx.startup.InitializationProvider` with
     `IllegalAccessError: Class kotlin.collections.CollectionsKt__IterablesKt extended by class ja0 is
     inaccessible`: a kept package-private facade whose subclass R8 had moved to another package. The task now
     appends `-keeppackagenames` for the packages of the kept classes.
- The allowlist of the host check (`smokeReferencesOutsideTheApp`) has three reasons, each a name that is not
  the app's: the platform's `android.test.` library; AndroidX Test's stand-in for a hidden platform method;
  `androidx.concurrent.futures.SuspendToFutureAdapter`, which the screenshot path of `androidx.test:core` wants
  from concurrent-futures-ktx 1.2.0 while the app ships 1.1.0 (the test takes no screenshot).
- `MinifiedSmokeTest`, once it ran for the first time on any device, failed in its first method after every
  assertion had passed: `NullPointerException: Current state was null unexpectedly. Last stage = STARTED` from
  `ActivityScenario.close()`. The launcher finishes itself when the result arrives, and `close()` reads the
  stage once. Each method now also asserts that the launcher was destroyed (an `ActivityLifecycleCallback`
  registered before the launch) before the scenario closes. No assertion was removed or changed.

```
$ ./gradlew --no-daemon :demo-app:checkSmokeTestReferences        # 162 s (R8 of the app again), load 5.4
BUILD SUCCESSFUL in 2m 42s
$ ./gradlew --no-daemon :demo-app:connectedMinifiedSmokeAndroidTest   # a Pixel 9, Android 17, load 5.5
<testsuites tests="2" failures="0" errors="0" skipped="0" ...>
  <testsuite name="dev.openverify.demo.smoke.MinifiedSmokeTest" tests="2" failures="0" errors="0" skipped="0" time="2.656">
    <testcase name="theMinifiedFlowLoadsItsSessionOverTlsThroughTheInstalledTransportAndReturnsItsResult" ... time="1.049" />
    <testcase name="plainHttpToLoopbackIsRefusedBeforeAnyRequest" ... time="1.607" />
I TestRunner: run finished: 2 tests, 0 failed, 0 ignored
$ (cd android && bash ../infra/scripts/check-connected-results.sh .)
dev.openverify.demo.smoke.MinifiedSmokeTest: 2 tests, 0 failures, 0 errors, 0 skipped
```

Gradle's own exit status was "failed" on that passing run too: KP10-31, section 2.

### What minifiedSmoke still proves, in numbers

`apkanalyzer dex packages` on the three APKs of this tree:

| Build | Classes in dex | Methods | `classes.dex` bytes | Names kept: `dev.openverify.sdk.*` | `kotlinx.serialization.*` | `dev.openverify.demo.*` |
|---|---|---|---|---|---|---|
| release | 6,219 | 27,717 | 4,951,468 | 1 (`OpenVerifyInquiryActivity`) | 6 | 2 |
| minifiedSmoke before | 6,251 | 27,816 | 4,964,840 | 1 | 6 | 6 (the 4 smoke classes) |
| minifiedSmoke after | 6,645 | 28,503 | 5,139,796 | 1 | 6 | 7 (the 5 smoke classes) |

So the smoke build holds 394 classes (6.3%) and 687 methods more than before, all in the shared libraries; the
SDK's one surviving name and kotlinx.serialization's six (the SDK's two consumer `-keepnames` lines) are the
same in all three. `python3 -I scripts/check-consumer-rules.py` passes on both builds
("minifiedSmoke: R8 read the SDK's rules from the library and kept every serialization exception's name").
What the smoke build no longer proves: that the members of those 153 library classes which only the test
calls can be removed or renamed without harm to the app (they cannot be removed while the test needs them).

`SmokeBuildTest` gained one test (6 in the class): the traced rules go to the smoke variant only, the three
refused prefixes are as above, release keeps its one `proguardFiles` line, and no file turns minification,
shrinking or obfuscation off.

## 2. KP10-31: Gradle's connected task exits failed on a passing phone run

### Cause found: not ours (AGP 9.4.1), left open

`./gradlew :demo-app:connectedMinifiedSmokeAndroidTest --info --stacktrace` on the passing run of section 1:

```
Discovered TestEngines:
- android-test-engine (version: DEVELOPMENT, location: .../com.android.tools.androidtest/android-test-engine/1.0.1/...)
Running instrumentation: adb -s <serial> shell "am instrument -r -w -e additionalTestOutputDir ... dev.openverify.demo.test/androidx.test.runner.AndroidJUnitRunner"
XML test result file generated at .../connected/minifiedSmoke/Pixel 9 - 17/TEST-<serial with _>.xml.
> Task :demo-app:connectedMinifiedSmokeAndroidTest FAILED
Caused by: org.gradle.api.GradleException: There were failing tests.
	at com.android.build.gradle.internal.tasks.DeviceProviderInstrumentTestTask.run(DeviceProviderInstrumentTestTask.java:456)
```

with `test-result-exit-code.txt` holding `1` beside an XML of 2 tests, 0 failures. So the false exit is not
about the SDK's nine tests: the demo's two show it as well. Read from the bytecode (`javap -p -c`):

- `test-result-exit-code.txt` is written by `com.android.tools.utp.gradle.AndroidTestEngineRunner.execute`
  (`gradle-work-action-32.4.1.jar`): "0" only when, for every run configuration,
  `perDeviceAllTestsPassed[config.deviceId]` is true; a missing key counts as failed.
- The map is filled by `DeviceTrackingListener`, whose key is cut out of the JUnit Platform unique id:
  `uniqueId.substringAfterLast("[device:").substringBefore("]")`.
- `AndroidTestEngineDescriptor` (`android-test-engine-1.0.1.jar`) builds that id with
  `uniqueId.append("device", deviceId)`, and JUnit's `UniqueId` percent-encodes `:` in a segment's value.

A wireless adb serial is `<address>:<port>`. Shown with JUnit's own class over synthetic serials
(`Kp31.java` in the session's scratch folder, compiled against the cached junit-platform-engine jar):

```
192.0.2.10:5555 -> [engine:android-test-engine]/[device:192.0.2.10%3A5555] -> map key 192.0.2.10%3A5555 -> found by serial: false
emulator-5554 -> [engine:android-test-engine]/[device:emulator-5554] -> map key emulator-5554 -> found by serial: true
SYNTHETICSERIAL01 -> [engine:android-test-engine]/[device:SYNTHETICSERIAL01] -> map key SYNTHETICSERIAL01 -> found by serial: true
```

So on any device whose serial holds a colon (every wireless adb connection) AGP 9.4.1's connected task writes
exit code 1 whatever the tests did; an emulator (`emulator-5554`) or a USB serial has no colon. No setting of
ours is wrong and nothing was changed: no `ignoreFailures`, no retry. The item stays open with its cause known;
on the phone a result is read from the XML or from `am instrument`, as before. Not verified here: a run on a
serial without a colon (the phone is reachable only wirelessly, and no emulator runs on this host).

### KP10-32 and KP10-31 at the final tree (`7d1f8d179`)

```
$ ./gradlew --no-daemon :demo-app:connectedMinifiedSmokeAndroidTest      # a Pixel 9, Android 17, load 3.1
<testsuites tests="2" failures="0" errors="0" skipped="0" ...>            # Gradle's exit: failed (KP10-31)
I TestRunner: run finished: 2 tests, 0 failed, 0 ignored
```

## 3. Review A002 (HIGH): Arabic-Indic and Persian digits (C196.3)

Confirmed by reading: `normalizeDigits` had two callers (the NFC controller and the screen step). The one-time
code field filtered to ASCII before any normalisation, so a typed `١٢٣٤٥٦` left the field empty and Confirm off.

Stub `6c653af9f` (`normalisesDigits(InputField)` answering false), RED `40bdda6f3`, GREEN `097011562`.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests '...FlowCoordinatorOtpTest' --tests '...FlowCoordinatorFormTest'
    --tests '...FlowCoordinatorBusinessTest' --tests '...OtpStepScreenTest' --tests '...FormStepScreenTest'        # RED, 200 s, load 8.3
FormStepScreenTest > a date typed in Arabic-Indic digits shows and is sent as ASCII, and an email address stays as typed (C196_3) FAILED
OtpStepScreenTest > a phone number typed in Arabic-Indic digits shows and goes out as ASCII (C196_3) FAILED
OtpStepScreenTest > a code typed on an Arabic or Persian keyboard is kept as ASCII digits and can be confirmed (C196_3) FAILED
FlowCoordinatorBusinessTest > a person's birth date and the registration number typed in Arabic-Indic digits are entered as ASCII (C196_3)() FAILED
FlowCoordinatorFormTest > the AAMVA form's dates, card number and postal code typed in Persian digits are entered as ASCII (C196_3)() FAILED
FlowCoordinatorFormTest > every typed field of a form normalises its digits but the email address and the website, as the web flow does (C196_3)() FAILED
FlowCoordinatorFormTest > a date typed in Arabic-Indic digits is checked and entered as ASCII (C196_3)() FAILED
FlowCoordinatorOtpTest > a phone number typed in Arabic-Indic digits is sent as ASCII ... FAILED
FlowCoordinatorOtpTest > a code typed in Arabic-Indic or Persian digits is confirmed as its ASCII digits (C196_3)(String) > arabic-indic FAILED
FlowCoordinatorOtpTest > a code typed in Arabic-Indic or Persian digits is confirmed as its ASCII digits (C196_3)(String) > persian FAILED
113 tests completed, 10 failed
$ (the same call with BusinessFormScreenTest)                                                             # GREEN, 194 s
BUILD SUCCESSFUL       # 120 tests in the six classes, 0 failed
```

GREEN: the code field normalises before its ASCII filter; the phone field, every typed field of the database,
AAMVA and business forms but the email address and the website (the web's `date`, `tel` and `text` kinds), and
a person's three fields normalise as typed; and the coordinator normalises again before its rules and the
request (`confirmOtp`, `sendOtp` for a phone, `submitInputs`), which is what C196.3 asks ("before validation
and submission"). The fake server confirms only `123456`, so the coordinator tests fail on anything else.

## 4. Review A010 and the audit's followup (gap K9): the expired wallet message

Stub `1b79e6885` (the string `openverify_crypto_new_message` in five languages, machine-drafted, with its
`review-status.json` row; `renewCryptoChallenge` as a no-op through `FlowActions`, the view model and the
coordinator), RED `140c1e092`, GREEN `eee35a282`.

```
CryptoWalletStepScreenTest > an expired message offers a new one for the same address, and a message still good does not (audit gap K9) FAILED
FlowCoordinatorCryptoTest > a new message is asked for the open message's chain and the same address, on the same verification (audit gap K9)() FAILED
FlowCoordinatorCryptoTest > a new message without the address this process typed goes back to the entry, and nothing is asked with no message open() FAILED
39 tests completed, 3 failed                                         # RED, 245 s, load 10.4
BUILD SUCCESSFUL in 4m 57s                                           # GREEN with ProtectionScanTest, ui.a11y.*, i18n.* and *ResourcesTest
```

GREEN: on the expired state an outlined button "Get a new message" (`submitProtection()`) calls
`renewCryptoChallenge(address the entry drafted)`: the coordinator shows the entry busy ("Getting the message…")
and asks the server for a new message on the open message's chain, on the same verification; a refusal lands
on the entry as for a first message, and without an address (a message opened before a resume) the entry asks
for it. Submit is left as it was: the server decides whether a message has expired.

Golden `android-a11y-audit/wallet-message-expired.png` re-recorded by the explicit record call
(`:openverify-sdk:screenshotTest -Proborazzi.test.record=true --tests 'dev.openverify.sdk.ui.a11y.*'`): the
new button under the expired words. That call also rewrote two goldens that had compared equal
(`capture-review.png`, `capture-review-ar-dark-2x.png`); their committed bytes were put back unchanged.
`ProtectionScanTest`'s table gained the button's row and counted 23 in this commit; that count was first run
at 27, in section 5's RED.

## 5. Four known items in one RED run and one GREEN run

RED (103 s, load 2.1), `ProtectionScanTest`, `ExceptionMessageScanTest`, `StateHooksTest`, `CopyKeyIgnoredLogTest`:

```
CopyKeyIgnoredLogTest > two renders of one launch's session log the code once, and another launch logs it again FAILED
    expected:<[flow.copy_key_ignored]> but was:<[flow.copy_key_ignored, flow.copy_key_ignored]>
CopyKeyIgnoredLogTest > a coordinator that reads its session three times logs the code once FAILED
    expected:<[flow.copy_key_ignored]> but was:<[flow.copy_key_ignored, flow.copy_key_ignored, flow.copy_key_ignored]>
StateHooksTest > device-integrity-android - a consented session that asks for a verdict takes one challenge and sends the provider's token for its hash() FAILED
    java.util.NoSuchElementException: List is empty.          # the negative control: integrity = IntegrityVerdictRequest.None
ExceptionMessageScanTest > every value an exception's message is built from is in the table() FAILED
ProtectionScanTest > every control is in the table, with the protection the table names() FAILED
21 tests completed, 5 failed
```

GREEN (265 s, load 14.1), with `privacy.*`, `ServerPositionTest`, `ui.steps.*`, `model.*`, `signals.Integrity*`: `BUILD SUCCESSFUL`.

- **KP10-36.** RED `e28b53822`, GREEN `c55fa4630`: `submitProtection()` on the document step's choose-file
  button and its two take-photo buttons and on the one-time code's continue-after-limit. The scan counts 27:
  the decision's 26 and section 4's wallet button.
- **KP10-37.** RED `c96e2c89e`, GREEN `e0d9e0c5f`: `"${descriptor.serialName} has no such value"`. No test
  asserted the old text. `causeClass` is untouched (a public-API decision for Phase 11's freeze).
- **K10A-3.** Stub `29a686e99`, RED `f634f1411`, GREEN `0e43ef19e`: `CopyNotes`, one flag in memory that the
  coordinator keeps for its launch and hands to each of its three `ServerPosition.render` calls.
- **KP10-29.** `c4f7d1cc5` (test only): the pin is two cases over a fake server whose consented session asks,
  or does not ask, for a verdict. The asking case was first run against `IntegrityVerdictRequest.None` (the
  failure above), then against `integrityVerdictRequest(api, provider)`, where it passes. Two tests replace one.

## 6. KP10-38: the NFC step through the activity, and two device test classes

`53a4cba93` (tests only; the wiring was already right).

- **Host**, `nfc/NfcActivityTest` (Robolectric, 4 tests): the flow's server is the host's own OkHttp client
  with an interceptor that answers from memory. Negative control, with no reader installed in the first test:

  ```
  NfcActivityTest > an installed reader and the phone's NFC reach the access-key screen, and I'm ready takes a challenge and turns the reader on FAILED
      java.lang.IllegalStateException: never: a node tagged openverify:nfc-document-number (requests: [GET /api/v1/flow/session, POST /api/v1/flow/signals])
  4 tests completed, 1 failed
  ```

  With the reader installed: `BUILD SUCCESSFUL` (the MRZ entry, then "I'm ready": one verification, one chip
  challenge, the reader called once with `ChipAccess.Mrz` and the challenge's eight bytes; leaving the app stops
  the read and coming back starts it again on the same challenge; no reader and no test chip shows "cannot read
  document chips" and asks nothing).
- **Device**, `nfc/NfcPlatformDeviceTest` (2) and `nfc/NfcTapLifecycleDeviceTest` (1). They assert what the
  device reports and never skip; no setting is changed and the settings screen is never opened (an activity
  monitor takes the start). The lifecycle test launches the real `OpenVerifyInquiryActivity` over the same
  kind of in-memory transport with a recording reader. Its session is a copy of the contract's golden
  `flow-session-nfc-sdk.json` in `src/androidDeviceTest/resources/nfc/`, which the host test holds equal.

  On a Pixel 9, Android 17, at `7d1f8d179` (`:openverify-sdk:connectedAndroidDeviceTest`, read from the XML):

  ```
  <testsuites tests="14" failures="0" errors="0" skipped="0" ...>
  dev.openverify.sdk.nfc.NfcPlatformDeviceTest: 2 tests, 0 failures, 0 errors, 0 skipped
  dev.openverify.sdk.nfc.NfcTapLifecycleDeviceTest: 1 tests, 0 failures, 0 errors, 0 skipped
  I openverify-nfc: settings=true
  I openverify-nfc: feature=true adapter=true availability=READY
  I openverify-probes: probes total 88.8 ms (bound 500 ms, target 50 ms)
  ```

  The SDK's device suite is 14 tests in 7 classes. Not run: an emulator, and a phone with NFC off (the
  branches for those assert the cannot-read screen and that the reader is never turned on).

## 7. K10A-2: displayed values are bidi-isolated (C199.5)

RED `09d6b1447` (a source scan in `SdkStringsSourceTest`, run against the sources as they were):

```
SdkStringsSourceTest > no sentence that shows a value is read through sdkString or sdkPlural, whose text is the logical one (C199_5, K10A-2)() FAILED
    expected: <[.../capture/selfie/Extension.kt#sdkPlural]> but was: <[... 22 entries in CaptureScreen.kt, ScreenComponents.kt,
    CryptoWalletStep.kt, DocumentStep.kt, InputForm.kt, OtpStep.kt and Extension.kt ...]>
```

GREEN `5431dc0fa`: the 21 call sites moved to `sdkText` or `sdkPluralText`. The one allowed call is the selfie
time warning's spoken text (its `contentDescription`), which 10B made logical by design. Five screen tests'
`text()` and `plural()` helpers now build the displayed text (each value between U+2068 and U+2069), and two
literal expectations carry the isolates. Whole host suite afterwards: 2,676 tests, 1 failed (KP10-25's RED).

Goldens: nine of the audit's document goldens differed by a comma moved by under a pixel after the isolated
formats ("PDF, JPEG, PNG, WebP"; kerning across the isolate), in `document-choose` (and its `-ar-dark-2x`,
`-operator-light`, `-operator-dark`), `document-unavailable`, `document-picked`, `document-uploading`,
`document-retry-hints` and `document-error`. Each compare image was read; they were re-recorded by the explicit
record call, and nothing else changed (205 goldens, 95 screenshot tests, exit 0).

## 8. KP10-35: the barcode guide on a frame that cannot carry a read

Part 1. Stub `cbe63b7cd` (`BarcodeGuidance.visible`, always true), RED `9a68477ee`, GREEN `cb8ae9db6`.

```
BarcodeOverlayTest > theGuideIsDrawnOnlyWhileAFrameCanCarryARead FAILED       # the hint node exists before any frame
BarcodeGuidanceTest > aFrameThatCannotCarryAReadHidesTheGuideAndIsNeverRead() FAILED
    nothing is asked before a frame says what it can carry ==> expected: <false> but was: <true>
```

GREEN: `onFrame` hides the guide and returns before the read when `AnalysisSizes.barcodeRead` is `NONE`, shows
it otherwise, and nothing shows before the first frame. Three existing tests fed 4 x 2 frames, which cannot
carry a read: their frames are now 640 x 480 upright (the smallest that can), from one shared buffer, and
`theGuidancesOverlayFollowsItsHint` feeds a frame before it looks for the guide.

Part 2 (a 2 x 2-subsampled 640 px copy for the document gates) is **open**, by the item's own exit. The
committed vectors (`contracts/fixtures/flow/document-quality-vectors.json`) are twelve synthetic 96 x 60 frames:
they hold no 1,280 px scene and no 640 px frame of the same scene, so "the same hints" could only be shown by
doubling a vector and averaging it back, which returns the vector exactly and proves nothing about a camera
frame. The numbers stay carry-10c's: 39.8 to 44.3 ms of host CPU for a 1,280 x 960 frame against 9.8 to 10.9 ms
at 640 x 480, with no phone figure.

## 9. KP10-25: the selfie extension's outcome travels with the window

RED `e48d31fbb`:

```
SelfieExtensionTest > no production source keeps extension outcomes in a process-wide object (KP10-25)() FAILED
    expected: <[]> but was: <[androidMain/.../OpenVerifyInquiryActivity.kt, commonMain/.../capture/selfie/Extension.kt]>
```

GREEN `beaef08ef`: `SelfieCaptureWindow.extension`; `extendCapture` answers the window with its outcome; the
coordinator marks `EXTENDING`, calls the hook with the capture as the server knows it, and publishes what it
answers; the warning reads the window. `SelfieExtensions`, `SelfieExtensionReport` and the activity's reset are
gone. Everything is internal: `checkKotlinAbi` exits 0 with the dumps unchanged. A new behaviour test holds
that a second launch in the same process, whose fake server names its capture alike, starts with no outcome.
Tests that set an outcome through the object now set it on the window (`SelfieExtensionTest`,
`SelfieGuidanceUiTest`, `SelfieGuidanceScreenshotTest`, `CaptureHooksTest`, the audit's catalog, harness and
announcement test); the sixteen selfie strings and their goldens are unchanged. One run of the whole suite
failed in `SelfieGuidanceUiTest` (the test wrote the window twice between frames and the second write was not
drawn); its writes now go through a helper that applies them and draws a frame.

## 10. Not done

- **K10A-1** (`FlowState.Finalizing`): not started. The audit's inventory holds a `finalizing` state, and
  `A11yInventoryTest` holds `docs/accessibility/android-audit-2026-11-11.md` to that inventory (row 31, and "181
  states" in six places, and in `docs/accessibility/statement.md`, which a dashboard test holds). Those files
  are fix-records' and fix-server's; removing the state on the Android side alone turns gate call (1) red.
- **KP10-31**: the cause is found and is not ours (section 2); the task still exits failed on a wireless serial.
- **KP10-35 part 2**: section 8.
- The audit's optional followup on the selfie time warning (gap K7): not taken, by Stage 1 amendment 11.

## 11. The final gates (`7d1f8d179`, lock wait 0 s on every call)

| Call | Tasks | Exit | Seconds | Load before |
|---|---|---|---|---|
| 1 ui | `:openverify-sdk:testAndroidHostTest -PhostTestGroup=ui` (524 tests) | 0 | 138 | 1.3 |
| 1 flow | `... -PhostTestGroup=flow` (414) | 0 | 41 | 3.3 |
| 1 rest | `... -PhostTestGroup=rest` (1,739) | 0 | 92 | 3.2 |
| 2 | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` (95 tests, 205 goldens) | 0 | 48 | 2.3 |
| 3 | `koverVerify checkKotlinAbi` | 0 | 199 | 2.5 |
| 4 | `testDebugUnitTest assembleDebug` (demo 81 and 8 smoke twins) | 0 | 59 | 3.7 |
| 5 | `:demo-app:assembleRelease :demo-app:bundleRelease :openverify-nfc:assembleRelease` | 0 | 137 | 4.4 |
| 6 | `:openverify-sdk:assemble` | 0 | 59 | 9.8 |
| 7 | `lint` | 0 | 160 | 6.6 |
| 8 | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` (with `checkSmokeTestReferences`) | 0 | 137 | 4.1 |
| 9 | `fetch_bundletool.py`; the scripts' 83 tests; `check-elf-alignment.py`, `check-consumer-rules.py`, `check-size.py` | 0 each | 11 | 7.0 |
| 10 | `publishAllPublicationsToStagingRepository`; `-p consumer-check build` | 0, 0 | 53, 113 | 5.9, 6.8 |
| 11 | `-PopenverifyDemoArtifacts=sdk,nfc :demo-app:testDebugUnitTest` | 0 | 60 | 9.0 |

SDK host tests: 2,677, none skipped (2,651 before; ui 520 to 524, flow 401 to 414, rest 1,730 to 1,739).
Size: arm64-v8a 3,379,507 download and 7,070,770 install bytes, inside the 10% bound; the baseline is unchanged.

`:openverify-sdk:stackTest` (flow/ changed), one call under the e2e lock with a fresh stack, 125 s, exit 0:
`AndroidFlowStackTest` 1 of 1 (8.9 s) and `AndroidNfcFlowStackTest` 1 of 1 (8.2 s); the stack was taken down.

On the phone at the same commit: the demo's smoke test 2 of 2 and the SDK's device suite 14 of 14, each read
from its XML (`check-connected-results.sh`: "connected tests: 16 passed"). No consent text changed, so no
consent export ran.
