# Phase 10, Workflow 10C: privacy-checks (family D)

Agent `privacy-checks`, Stage 2, beside nfc-sdk, api-nfc, release-checks, demo-app and docs-android.
The plan's bullet: the cross-cutting checks of C213.1 to C213.4 over every module now present, and
C191.2's boundary. The protections themselves are their file owners' (review V03); this agent wrote
only tests, in `android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/privacy/`, and
one borrowed edit of `signals/NeverReadTest.kt`. No main source, string, dependency, build file or
public declaration changed. `SdkLog` needed no new code, so that borrowed edit was not used.

No device ran any of this, and none had to: every check is a host test (Robolectric's API 36, or a
plain source scan). Nothing here rests on a CI run (rule 28).

## 1. How it was run

All iteration, both RED states and the first GREEN ran in a scratch worktree
(`git worktree add --detach /tmp/ov-privacy-10c`, made and removed under the git lock), so that no
experimental or failing test sat in the shared tree while five other agents ran their gates. Every
Gradle call, there too, ran under the Gradle lock:

```
flock -E 75 -w <seconds> /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest \
  --tests 'dev.openverify.sdk.privacy.*' --tests 'dev.openverify.sdk.signals.NeverReadTest'
```

The lock was the bottleneck of this Stage: six agents queued on it, `flock` is not first come first
served, and a 240 s wait lost to longer ones. Ten calls ended with exit 75 (lock busy, never a
failure) before a slot came, five in the scratch worktree and five of the gate's; the waits that
succeeded are written beside each run below.

The helpers are test code, so each has a stub (returns nothing) and an implementation. The order in
the shared tree: the stubs (`4f88694b7`), the tests against them (`a726ad26d`, RED), the
implementations (`1cee252bc`, GREEN), all three within one minute, then the borrowed edit
(`5b4356b6a`).

## 2. RED

### 2.1 The stubbed helpers (the state of `a726ad26d`)

Run in the scratch worktree at `cb1955b4f` plus the stub and test files as committed; lock wait 516 s,
load 33.95 when it started, 170 s of Gradle. `BUILD FAILED`, exit 1: **101 tests completed, 43 failed**,
each for the stub's reason:

```
DataAtRestScanTest: 5 tests, 2 failed
   - intents carry only the launch's extras and the result's outcome()
       expected: <[InquiryResults.kt: putExtra(EXTRA_APPEARANCE), InquiryResul...> but was: <[]>
   - only the crypto step's message reaches the clipboard()
       expected: <[src/commonMain/kotlin/dev/openverify/sdk/ui/steps/CryptoWal...> but was: <[]>
ExceptionCanaryTest: 30 tests, 1 failed
   - the check sees a canary in a message, a toString, a cause and a suppressed exception()
       a message: the canary was not seen ==> expected: <true> but was: <false>
ExceptionMessageScanTest: 2 tests, 2 failed
   - every value an exception's message is built from is in the table()
       expected: <src/commonMain/kotlin/dev/openverify/sdk/api/FlowApiClient.k...> but was: <>
   - the scan reads a constructor's message, an error and the block of a check()
       expected: <[$code, ${items.keys.map { it.length }}, $MAX, ${value.lengt...> but was: <[]>
LogScanTest: 6 tests, 1 failed
   - platformLog is called only by SdkLog()
       expected: <[src/commonMain/kotlin/dev/openverify/sdk/log/SdkLog.kt]> but was: <[]>
ModuleBoundaryTest: 7 tests, 6 failed
   - openverify-sdk (SDK) / openverify-nfc (OPTIONAL) / demo-app (CONSUMER)
       the SDK's lockfile was read ==> expected: <true> but was: <false>
   - a reserved library or an optional artifact in a lockfile is refused, by group, subgroup and name
       expected: <[org.jmrtd:jmrtd, org.bouncycastle:bcprov-jdk18on, com.googl...> but was: <[]>
   - the Gradle check counts every module but the SDK and the consumers as an optional artifact()
       expected: <[demo-app, openverify-sdk]> but was: <[]>
   - the Gradle check refuses the plan's libraries and artifacts, and runs with assemble and check()
       expected: <[org.jmrtd, net.sf.scuba, org.ejbca.cvc, org.bouncycastle, c...> but was: <[]>
ProtectionScanTest: 8 tests, 4 failed
   - the scan reads a control's handler and its protection, direct, by a named modifier and around a modifier
       expected: <[Button takePhoto true, Button { send(value, "x,y") } true, ...> but was: <[]>
   - a shown value that is personal data is marked too, and each such place is named()
       expected: <{ScreenComponents.kt=1, NfcStepScreen.kt=1}> but was: <{ScreenComponents.kt=1, CryptoWalletStep.kt=3, InputForm.kt=2, NfcStepScreen.kt=2, OtpStep.kt=2}>
   - every control is in the table, with the protection the table names()
       expected: <capture/selfie/Extension.kt     Button onExtend -> unprotect...> but was: <>
   - every text field marks its value accessibility-data-sensitive()
       expected: <{CryptoWalletStep.kt=3, InputForm.kt=2, NfcStepScreen.kt=1, ...> but was: <{}>
SavedStateCanaryTest: 9 tests, 9 failed
   - no saved Bundle holds what was typed or chosen, across a recreation[<each screen>]
       java.lang.AssertionError: the saved state was read: 0 values
SavedTextTest: 4 tests, 3 failed
   - a string, a nested bundle, a list, an array, a sparse array, characters and bytes are read
   - a value kept with rememberSaveable or rememberTextFieldState is found in the activity's saved state
       java.lang.AssertionError: plain: 0 values
   - a number saved as a number is read as its digits
WindowChecksTest: 3 tests, 2 failed
   - a dialog over a window that is not secure is seen as not secure
       java.lang.AssertionError: expected:<2> but was:<0>
   - a dialog over a secure window inherits the flag
       java.lang.AssertionError: expected:<[true, true]> but was:<[]>
WindowSecureFlagTest: 11 tests, 11 failed
   - the window it opens carries FLAG_SECURE, as every window of the flow does[<each window>]
       java.lang.AssertionError: the flow's own window expected:<1> but was:<0>
WindowSitesScanTest: 3 tests, 2 failed
   - every call that opens a window is a row the secure-flag test opens()
       expected: <[]> but was: <[src/commonMain/.../LanguageSelector.kt#DropdownMenu#1, ...
   - the scan sees a window call and not its declaration()
       expected: <[DropdownMenu, Selector]> but was: <[]>
NetworkTrustScanTest 3, NfcReviewSavedStateTest 1, ResultIntentCanaryTest 1, ScreenComponentKindsTest 1, NeverReadTest 7: 0 failed
```

The 58 that pass in this state hold over the SDK as built and use no stubbed helper: the 29 canary
cases through the client's calls, the two foundation-10a scans, the trust scan, `NeverReadTest`. A
check that passes on correct code proves nothing by passing, so each has a control that was seen to
fail: the canary check's own test above, and section 2.2.

An earlier RED run of the same stubs (before the NFC rows existed; lock wait 312 s, load 5.69) gave
95 tests, 38 failed, for the same reasons.

### 2.2 The negative control: a violation planted in `openverify-nfc`

`openverify-nfc` has no Kotlin source until Workflow 10E, so "over every module now present" would
hold vacuously. To see each scan reach that module, one file was written into the scratch worktree
only (`openverify-nfc/src/main/kotlin/dev/openverify/nfc/Planted.kt`, never committed, deleted after
the run): a `getSharedPreferences` call, a `HostnameVerifier`, a `TelephonyManager` parameter,
`Log.d`, an exception with `"bad $mrz"`, a `rememberSaveable` value, an `android.app.AlertDialog`
builder, an unmarked `OutlinedTextField`, an unlisted `Button` and a `Dialog`. With the implementations
in place and only the canary check stubbed (lock wait 242 s, load 5.26): **96 tests, 14 failed**:

```
DataAtRestScanTest
   - no main source writes a file, a preference, a cache or a database()
       but was: <[../openverify-nfc/.../Planted.kt:8: SharedPreferences, ...Planted.kt:8: getSharedPreferences]>
   - saved state holds only the allowlisted non-PII UI state()
       but was: <[SavedState(path=../openverify-nfc/.../Planted.kt, name=typed), ...
ExceptionCanaryTest
   - the check sees a canary in a message, a toString, a cause and a suppressed exception()   (the stub)
   - a module without rows here has no source that could throw()
       openverify-nfc gained sources: give its exceptions their rows ==> but was: <[../openverify-nfc/.../Planted.kt]>
ExceptionMessageScanTest
   - every value an exception's message is built from is in the table()
       but was: <../openverify-nfc/.../Planted.kt     $mrz ...
LogScanTest
   - nothing logs outside SdkLog's platform writer()
       but was: <[../openverify-nfc/.../Planted.kt:12: \bLog\.(v|d|i|w|e|wtf|println|isLoggable)\s*\(]>
   - no logging class is imported outside the platform writer()
       but was: <[../openverify-nfc/.../Planted.kt: import android.util.Log]>
NetworkTrustScanTest
   - no source overrides the host's trust, pins, proxies or redirects()
       but was: <[../openverify-nfc/.../Planted.kt:9: \bHostnameVerifier\b|\bhostnameVerifier\s*\(]>
ProtectionScanTest
   - every control is in the table, with the protection the table names()
       but was: <../openverify-nfc/.../Planted.kt     Button { send(typed) } -> unprotected ...
   - every text field marks its value accessibility-data-sensitive()
       but was: <[../openverify-nfc/.../Planted.kt:21: OutlinedTextField]>
WindowSitesScanTest
   - no source turns the secure flag off or builds a platform window()
       but was: <[...Planted.kt: android\.app\.(AlertDialog|Dialog|...)\b, ...Planted.kt: \bAlertDialog\.Builder\b]>
   - every call that opens a window is a row the secure-flag test opens()
NeverReadTest
   - no source reads developer settings, accessibility services or hardware identifiers()
       but was: <[../openverify-nfc/.../Planted.kt: TelephonyManager]>
ModuleBoundaryTest
   - a reserved library or an optional artifact in a lockfile is refused, by group, subgroup and name()
```

The last line was this agent's own mistake, found by that run: the self-test expected a reserved
library on a test-only classpath to be refused, after the reader had been narrowed to the
configurations that ship (section 4.6). The case now puts it on a shipped classpath as well.

## 3. GREEN

In the scratch worktree at `cb1955b4f` with the files as committed in `1cee252bc` and `5b4356b6a`
(lock wait 175 s, load 11.86, 120 s of Gradle): `BUILD SUCCESSFUL`, exit 0, 101 tests, none failed,
none skipped:

```
DataAtRestScanTest 5       ExceptionCanaryTest 30    ExceptionMessageScanTest 2   LogScanTest 6
ModuleBoundaryTest 7       NetworkTrustScanTest 3    NfcReviewSavedStateTest 1    ProtectionScanTest 8
ResultIntentCanaryTest 1   SavedStateCanaryTest 9    SavedTextTest 4              ScreenComponentKindsTest 1
WindowChecksTest 3         WindowSecureFlagTest 11   WindowSitesScanTest 3        NeverReadTest 7 (unchanged count)
```

The privacy package held 4 tests at the Stage's start (`DataAtRestScanTest` 2, `LogScanTest` 2) and
holds 94 now: **+90 host tests**, all in the `rest` group.

What the first working runs taught, each fixed before the commits:
- `DropdownMenu` is a window too. The prompt named the date picker as the SDK's one window; the scan
  found nine more call sites (the SDK's `Selector` in six places, its own menu, the language menu, and
  nfc-sdk's sandbox scenario). All inherit the flag; each has a row.
- The date picker opens two windows, a dialog and a popup inside it; both are secure.
- `/*` inside a Gradle glob (`**/*.kt`) is no block comment: the build file is read with its line
  comments removed only.
- Robolectric and the lint tool put Bouncy Castle on the SDK's test and lint classpaths, so the
  lockfile is read for the configurations that ship.
- `putExtra` inside an `apply` block has no receiver dot: the intent scan reads both call forms.

## 4. What each check is

Tables are in the test files; a new entry is one line. `PrivacyScreens.ALL` is shared by the window
test, the canary and the window scan.

### 4.1 Windows (C213.1; review P19)

- `WindowSecureFlagTest` (11 rows): the real `OpenVerifyInquiryActivity` against a loopback
  `MockWebServer` session; each dialog or menu is opened and every window of the process
  (`WindowManagerGlobal`'s list) carries `FLAG_SECURE`. Rows: the screen step's date picker, phone
  country, address country, country select, select, and the language menu; the phone step's country;
  the database form's country; the AAMVA form's issuing authority; the crypto step's chain; the NFC
  entry's sandbox scenario.
- `WindowChecksTest` (3): a dialog over a window without the flag is seen as not secure (the control);
  over a secure window it inherits; the activity hides other apps' overlays while resumed and shows
  them again when paused.
- `WindowSitesScanTest` (3): no `SecureFlagPolicy.SecureOff`, no platform dialog, popup, toast or
  overlay builder in a shipped source (imports read too); every Compose call that opens a window is a
  row above.
- Re-checked for 10B: the guidance overlays and the selfie time warning are drawn in place
  (`capture/selfie/Extension.kt` holds a `Card`, no window call); the scan would fail if one became a
  window.

### 4.2 Protections (C213.1; decision 70; review V03)

`ProtectionScanTest` (8), over `ProtectionScan`:
- 9 text field calls in 5 files, each with `typedValueProtection()`: `CryptoWalletStep.kt` 3,
  `InputForm.kt` 2, `OtpStep.kt` 2, `NfcStepScreen.kt` 1 (the MRZ and CAN fields' shared
  `SecretField`), `ScreenComponents.kt` 1 (through `fieldSemantics`).
- 2 marks that are not on a field: `fieldSemantics` itself, and the DG1 review's card.
- 87 controls in 16 files, each in the table: 22 protected (`submitProtection()`), 65 without it for a
  stated reason (leaves; opens a picker, menu, link or screen; acts on the screen only; asks again;
  shown only; unprotected by 10B's decision on retake, back and cancel of the capture screen).
- The API levels are chosen in one place (26 to 30, and 34 on); the activity's overlay hiding is in
  `onResume` and `onPause`.

### 4.3 Data at rest and saved state (C213.2; decision 37; review P07)

`DataAtRestScanTest` (5), final lists:
- storage: allowlist empty (21 more patterns than foundation-10a's 24);
- saved state: exactly 4 declarations, each with its reason: `ConsentScreen.kt` `agreed`, `ticked` and
  `TICKED_SAVER` (new in the list: the saver `ticked` already used, found by the wider patterns), and
  `CameraPermission.android.kt` `deniedState`;
- intents: 10 writes, the launch's extras and the result's outcome;
- the clipboard: one writer, one caller (the crypto step's server-written message);
- manifests of the shipped modules: no backup rule, no exported component, no provider, receiver or
  service, no cleartext or network-security attribute.

`SavedStateCanaryTest` (9 screens): a canary typed into every typed field and chosen in every choice
the table controls, `scenario.recreate()`, and no saved `Bundle` holds one at any depth. Screens: a
screen step with all 15 form component kinds (held to the decoder's list by
`ScreenComponentKindsTest`), the email address, the phone number, the OTP code, the database form
(12 typed fields), the AAMVA form, the crypto address, the MRZ entry (3 fields), the CAN entry. Each
typed field is also checked as accessibility-data-sensitive on this API level. `NfcReviewSavedStateTest`
does the same for the DG1 review's shown details. `SavedTextTest` (4) is the control: a canary saved
the careless ways is found.

### 4.4 Exceptions (C213.3; review P06)

- `ExceptionCanaryTest` (30): 24 calls of `FlowApiClient` (the table is held to the client's own
  `override suspend fun` list), each with the canary in what the person typed and against 7 answers
  holding the canary (malformed JSON, a JSON string, every member the canary, an HTML page, a 422 and a
  409 problem, a 500 that is no problem); the one-time-link redemption; refused tokens and addresses;
  every `ChipReadFailure`'s fixed message; the control; the table's coverage; a module without rows
  has no source.
- `ResultIntentCanaryTest` (1): a result intent whose extras are a canary gives a result, not an
  exception.
- `ExceptionMessageScanTest` (2): every `$value` in an exception's message, 19 of them in 11 files,
  each with why it is no personal data and no server text.

### 4.5 Logs and trust (C213.3, C213.4)

- `LogScanTest` (6), final list: 12 forbidden patterns (6 new), the one allowlisted line (`Log.w(TAG,
  code)` under `HostDebuggable.debuggable`), no logging import elsewhere, `platformLog` called only by
  `SdkLog`, every call a literal code, no alias. 31 codes are in use at `cb1955b4f`.
- `NetworkTrustScanTest` (3): no trust manager, hostname verifier, socket factory, pinner, proxy,
  logging interceptor, WebView or `HttpURLConnection`; three places make or derive an HTTP client, each
  with redirects off; plain http only for four loopback hosts and only where `LoopbackPolicy` allows.

### 4.6 Modules and the boundary (C191.2, C214.6; review F18)

- `SdkModule.ALL`: `openverify-sdk` (SDK), `openverify-nfc` (OPTIONAL), `demo-app` (CONSUMER), held to
  `settings.gradle.kts`.
- `ModuleBoundaryTest` (7): the Gradle check's reserved groups and artifacts are the plan's; it is
  wired to `assemble` and `check`; its "not optional" names are the table's; per module, the SDK's
  lockfile ships no reserved library and names no optional artifact, and the project dependencies
  point the allowed way.
- `NeverReadTest` (borrowed edit, 7 tests as before): its one list now runs over every shipped
  module's main sources and manifests.

## 5. The gate: the Android gate's calls (1) to (6)

Run in the shared tree at `5b4356b6a` and later heads (only docs, the demo and api-nfc changed after
it; nothing the scans read except three ProGuard lines of `demo-app/build.gradle.kts`), each call
`flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>` in the foreground, its
output in a file, its exit status read. Five of these calls ended with exit 75 before their slot
(lock busy, recorded as such: four for (1) rest, one for (1) ui) and were run again.

| Call | Tasks | Exit | Lock wait | Run | Load after |
|---|---|---|---|---|---|
| (1) ui | `:openverify-sdk:testAndroidHostTest -PhostTestGroup=ui` | 0 | 169 s | 28 s | 15.67 |
| (1) flow | `... -PhostTestGroup=flow` | 0 | 94 s | 34 s | 4.67 |
| (1) rest | `... -PhostTestGroup=rest` | 0 | 99 s | 22 s | 14.18 |
| (2) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | 0 | 231 s | 12 s | 3.43 |
| (3) | `koverVerify checkKotlinAbi` | 0 | 172 s | 12 s | 6.89 |
| (4) | `testDebugUnitTest assembleDebug` | 0 | 74 s | 11 s | 4.62 |
| (4) | `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 171 s | 12 s | 3.21 |
| (5) | `:openverify-sdk:assemble` (ran `checkDependencyBoundary`) | 0 | 27 s | 11 s | 4.37 |
| (5) | `lint` | 0 | 31 s | 12 s | 5.64 |
| (6) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 85 s | 12 s | 6.05 |

**What the short run times mean.** Every call found its tasks up to date or in the build cache: the
other Stage 2 agents were running the same gate on the same tree, so Gradle had just executed each
task on identical inputs and did not execute it again for this call. The exit statuses are these
calls' own; the test executions are the other agents' runs seconds earlier, with this agent's
committed tests among the inputs. The rest group's results on disk at that moment (written seconds
before this call's own Gradle run): 171 classes, **1,723 tests, none failed, none skipped, 94 of them in
`privacy/`**. The ui group's: 476; the flow group's: 401. **2,600 host tests in all** at that head
(2,386 at contracts-10c's close; 2,321 at the base; this agent's share is +90). The run times are
therefore no measurement of the suite and are not offered as one.

The Gradle check's own negative control, in the scratch worktree before it was removed: with
`implementation(project(":openverify-nfc"))` planted in the SDK's `androidMain` dependencies (lock
wait 151 s, load 9.60), `./gradlew --no-daemon :openverify-sdk:checkDependencyBoundary` exited 1:

```
> C214.6: :openverify-sdk must not depend on an optional artifact or a library reserved for one:
  androidRuntimeClasspath: project ':openverify-nfc'
BUILD FAILED in 29s
```

## 6. Findings in other owners' files (for integration-10c; none blocks, none was committed red)

1. **The host-test task does not know every file these tests read**
   (`android/openverify-sdk/build.gradle.kts`, the `sourcesTheTestsRead` inputs). The scans read
   `build.gradle.kts`, `gradle.lockfile`, `../settings.gradle.kts`, the other modules' build files and
   manifests, and `../openverify-nfc/src/main`. A change to one of those alone leaves the task up to
   date. Add them to `inputs.files(...)`.
2. **`ui/steps/DocumentStep.kt`:** "choose a file" and "take a photo" carry no `submitProtection()`,
   while the capture screen's "upload a photo instead", which opens the same kind of picker, does.
   The table records the document step's as "opens a picker"; one of the two should change.
3. **`ui/steps/OtpStep.kt`:** "continue" after the code limit (`actions::continueAfterLimit`) leaves
   the step by the server's `exhausted` edge without `submitProtection()`. Recorded as "leaves"; if a
   submit control is any control that moves the flow on, it needs the modifier and the table line flips.
4. **`ui/steps/NfcStepScreen.kt`:** "use the card access number instead" is protected and "change
   these details" is not, though both only change the entry screen. Harmless; recorded as built.
5. **`model/WireEnums.kt:35`:** the one exception message built from a server value (`has no value
   "$value"`). It cannot reach a host today (`FlowHttp` keeps the class name only; `guidanceAs` catches
   it), and the canary feeds an unknown enum value through every call. A fixed message there would
   remove the dependence on every caller wrapping it.
6. **`flow.copy_key_ignored` on each render** (10A Stage 3, android-driver 9, "for privacy-checks to
   judge"): a constant code, written only in a debuggable host. No privacy cost; left as built.
7. **The MRZ and CAN are kept in composition only**, so a rotation on the entry screen empties them
   and the person types again. That is the safe side of C213.2; said here because it is a cost.

## 7. Checkpoint

Checkpoint 1 is this file's commit, "Workflow 10C privacy-checks checkpoint 1". Before it: stubs
`4f88694b7`, RED `a726ad26d`, GREEN `1cee252bc`, the `NeverReadTest` borrowed edit `5b4356b6a`.
