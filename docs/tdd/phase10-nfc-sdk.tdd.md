# Phase 10, Workflow 10C: nfc-sdk (C207 on the device, C208.2)

Agent `nfc-sdk`, Stage 2, family N, beside the other Stage 2 agents. Every slice test-first: stubs
where names were missing, RED seen failing for the reason below, then GREEN. Commands ran after
`source scripts/env.sh` from `android/`, each as
`flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon ...`; outputs are abbreviated.
Exit 75 (the Gradle lock busy for 240 s, five agents sharing it) happened often and is never a
failure; the call was run again.

No device ran any of this (rule 28): the host has no `/dev/kvm` and no attached device. The NFC step
is proved over fakes: `FakeFlowServer`, a scripted `FakeChipReader`, a `FakeNfcPhone`, a frozen
`TestTimeSource`, and Robolectric's shadows for the Android `NfcPlatform` actual.

## 1. Slice 1: the step's logic (controller, requests, DG1, sandbox reader)

**Stubs** `574cff74d`: `nfc/NfcStepTypes.kt` (the closed `NfcEvent` and `NfcView` lists, `NfcPhone`),
`nfc/Dg1.kt` (parses nothing), `nfc/SandboxChipReader.kt` (reads nothing); the controller still
resolved to the unsupported screen. `NfcStepHooksTest` compiled against the new names and passed:

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.NfcStepHooksTest'
BUILD SUCCESSFUL in 2m        (rc=0, 121 s)
```

**RED** `b172cb6a8`: `commonTest nfc/Dg1Test`, `androidHostTest nfc/{NfcStepControllerTest,
SandboxChipReaderTest, NfcRequestFixturesTest, NfcTestSupport}`.

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.nfc.*'
75 tests completed, 67 failed        (rc=1, 222 s, load 8.67)
 30  java.lang.ClassCastException: FlowState$Unsupported cannot be cast to FlowState$Nfc   (the stub controller)
  8  kotlin.NotImplementedError: flow_api_not_built: uploadChipFile                          (the stub encoders)
  3  expected: <Dg1Details(<redacted>)> but was: <null>                                      (the stub parser)
  2  ChipReadException: Chip read failed: unsupported_document                               (the stub sandbox reader)
  ...
```

The 8 that passed assert what already held (redacted `toString`s, the index table's twelve nfc-sdk
entries, bytes that are not a DG1 parse to `null`).

**GREEN** `eb50bd04f`: `NfcStepController`, `NfcFlowRequests`, `Dg1`, `SandboxChipReader`, and
`NfcStepHooksTest` moved from the stub's behaviour to the built one (its "no production path" scan
now allows `nfc/NfcStepController.kt` and `nfc/SandboxChipReader.kt`; its "the calls are stubs" test
is replaced by the fixtures test).

```
./gradlew ... --tests 'dev.openverify.sdk.nfc.*' --tests 'dev.openverify.sdk.flow.NfcStepHooksTest'
82 tests completed, 12 failed        (rc=1, 182 s): only NfcRequestFixturesTest's twelve files, not written yet
UPDATE_CONTRACT_FIXTURES=1 ./gradlew ... --tests 'dev.openverify.sdk.nfc.NfcRequestFixturesTest'
BUILD SUCCESSFUL                     (rc=0, 192 s): twelve files written under contracts/fixtures/flow-requests/android/
pnpm exec prettier --check --ignore-path=.gitignore contracts/fixtures/flow-requests/android/{chip-*,client-unable,sandbox-chip,upload-chip-*}.json
All matched files use Prettier code style!
pnpm --filter @openverify/api exec vitest run src/routes/flow/flow-requests.android.test.ts --coverage.enabled=false
Tests  8 passed (8)                  (the server's zod schemas parse each fixture)
```

The controller suite passed on its first GREEN run. One test expectation was shaped by the fake, not
the code: `FakeFlowServer` (shared) walks no `nfc` step on its own (its `verificationTypeOf` has no
`nfc` entry), so the tests script the position that follows a decided attempt (`movesOn()`); see the
contract deviations.

## 2. Slice 2: the screens, the strings, the platform actual

**Stubs** `75255c466`: `strings_nfc.xml` in the five folders (75 keys; `es`, `fr`, `de`, `ar`
machine-drafted and marked so by the named borrowed edit to `i18n/review-status.json`, whose
`git status --porcelain` was empty first), `ui/steps/NfcStepTags.kt`, and the resumed-screen seam
`nfc/NfcResumed.kt` with its Android and iOS actuals. No string table is committed (a build output
since 10B).

**RED** `aa06d1b0e`: `ui/steps/NfcStepScreenTest`, `nfc/{NfcWordingTest, NfcPlatformTest,
NfcSingleUsePostTest}`.

```
./gradlew ... --tests 'dev.openverify.sdk.nfc.*' --tests 'dev.openverify.sdk.ui.steps.NfcStep*' --tests 'dev.openverify.sdk.ui.ResourcesTest' --tests 'dev.openverify.sdk.i18n.*'
195 tests completed, 30 failed       (rc=1, 195 s, load 10.35)
 26  NfcStepScreenTest: the stub screen draws the unsupported screen, so no tag or text is found
  3  NfcPlatformTest: the stub actual reports NO_HARDWARE and starts no activity
  1  NfcWordingTest values-ar: openverify_nfc_notice_unsupported held a listed word ("the right document")
```

The Arabic text was reworded ("the required document") before the strings were committed.
`NfcSingleUsePostTest`'s three cases passed at once: they hold slice 1's logic over the real
`FlowApiClient`, OkHttp and MockWebServer, and were written after it; they are regression tests, not
RED-first. `ResourcesTest` and the i18n suites passed with the new strings.

**GREEN** `c43081289`: `ui/steps/NfcStepScreen.kt` and the Android `NfcPlatform` actual.

```
./gradlew ... --tests 'dev.openverify.sdk.nfc.*' --tests 'dev.openverify.sdk.ui.steps.NfcStep*'
115 tests completed, 1 failed        (rc=1): NfcPlatformTest's helper asked Robolectric for an adapter it does not hand out without the feature (a test fault; fixed in the test)
./gradlew ... (the same) --tests NfcStepHooksTest --tests 'dev.openverify.sdk.privacy.*' --tests NeverReadTest --tests ResourcesTest --tests 'dev.openverify.sdk.i18n.*' --tests AbiDumpTest --tests PublicSurfaceTest
BUILD SUCCESSFUL in 2m 15s           (rc=0, 284 s with the lock wait, load 5.77)
```

**Goldens** `cb1955b4f`: 33 files, 923,814 bytes, recorded only by
`./gradlew --no-daemon :openverify-sdk:screenshotTest -Proborazzi.test.record=true --tests 'dev.openverify.sdk.ui.steps.NfcStepScreenshotTest' --tests 'dev.openverify.sdk.ui.steps.NfcStepArabicScreenshotTest'`
(rc=0, 193 s, load 11.86). Synthetic content only (ICAO's Utopia specimen; no portrait is drawn).

## 3. What Compose 1.11 cannot do (for 10D's review, as android-screens recorded)

- It cannot set `IME_FLAG_NO_PERSONALIZED_LEARNING`, so a keyboard may still learn the document
  number, the dates or the CAN as typed.
- It cannot mark one node not important for autofill. The fields carry no autofill content type, so
  no autofill service is told what they hold and Compose leaves them out of the save request it
  builds from content types.
- The fields use `SECRET_TEXT` and `SECRET_NUMBER` (a plain keyboard, autocorrect off), never a
  password keyboard, which would declare `ContentType.Password`.

## 4. Constants, each provisional with its basis

- `MAX_CHALLENGES = 9`: one under the server's `CHIP_CHALLENGE_LIMIT` (10), whose tenth cancels the
  verification. Counted in memory per verification, so a relaunch starts the count again; the
  server's own limit then answers 409, which reads the session.
- `CHALLENGE_LIFETIME = 300 s`: the server's `CHIP_CHALLENGE_TTL_SECONDS`, measured on the device's
  monotonic clock from the answer's arrival, never from `expires-at` and the wall clock.
- A lifted document is forgiven as often as the step has attempts on one tap (3 by default).
- The checking screen reads the session every 2 s, at most 60 times (the driver's defaults).

## 5. The gates

The Android gate's calls (1) to (6), each its own foreground call, each exit 0 (wall seconds include the
lock wait; load from `/proc/loadavg` after the call; exit 75 retried, eleven times in all):

| Call | Result | Wall s | Load |
|---|---|---|---|
| (1) `testAndroidHostTest -PhostTestGroup=ui` | 476 tests, none failed or skipped | 223 | 11.11 |
| (1) `-PhostTestGroup=flow` | 401 | 319 | 12.57 |
| (1) `-PhostTestGroup=rest` | 1,723 (tasks up to date from an identical run on the shared tree) | 62 | 11.99 |
| (2) `screenshotTest -Proborazzi.test.verify=true` | exit 0 | 126 | 4.52 |
| (3) `koverVerify checkKotlinAbi` | exit 0 | 235 | 4.18 |
| (4) `testDebugUnitTest assembleDebug`; `:demo-app:assembleRelease :demo-app:bundleRelease` | exit 0; exit 0 | 182; 91 | 6.70; 4.44 |
| (5) `:openverify-sdk:assemble` (the iOS klibs compile); `lint` | exit 0; exit 0 | 181; 42 | 4.03; 4.32 |
| (6) `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | exit 0 | 39 | 5.16 |

Host tests: 2,386 when Stage 2 began (contracts-10c's count), 2,600 in this run (476 + 401 + 1,723),
which also holds the other Stage 2 agents' tests on the shared tree. nfc-sdk's own: 113 host tests added (87 in `nfc/`, 26 in `ui/steps/`) and 33 screenshot tests; 1 of
contracts-10c's hook tests removed with the stubs it pinned. Several calls found their tasks up to
date, because another agent had just run the same task on the same tree; the exit code is the gate.
`pnpm format:check`: exit 0.

## 6. Checkpoint

Checkpoint 1 is the commit whose subject holds "Workflow 10C nfc-sdk checkpoint 1".
