# Phase 7, Workflow 7A Stage 2: `android-signals` (C94.7)

Base: `8b7182e2` (Stage 1a's final gates). Every command ran after `source scripts/env.sh`, from `android/` unless stated. Iteration runs used the Gradle daemon; the final gate ran with `--no-daemon`.

## Scope

- **Android `DeviceSignals`** (`androidMain/.../signals/AndroidDeviceSignals.kt`):
  - session integrity reads `Debug.isDebuggerConnected()` and the host app's `FLAG_DEBUGGABLE`;
  - device recognition reads `Settings.Secure.ANDROID_ID`;
  - either tier gives the device class (`smartphone`, or `tablet` from 600 dp);
  - with neither tier, nothing is read.
- **The contract bounds** (`commonMain/.../signals/AndroidSignalContract.kt`), checked against the TypeScript sources.
- **The iOS placeholder** (`iosMain/.../signals/IosDeviceSignals.kt`).
- **`FlowApiClient.sendSignals`:** `POST /api/v1/flow/signals`, 202 with no body.
- **The coordinator.** It sends one body per coordinator, beside the flow. The body goes after this session's consent, or when a session that already has consent loads. A decided inquiry gets none.
- **The activity** is wired to the real device facts.
- **The handoff step's done rule** now has tests.
- **The SDK README.**

## Baseline

`./gradlew -q :openverify-sdk:testAndroidHostTest` at the base, then the result XML counted: **1,268 tests, 0 failed** (load 1.69). That matches contracts-7a's figure.

## Slice 1: the Android body, the client call, the coordinator and the activity

### Stub (`30a5e7af`)

The RED tests need these names, so they were added first:
- `AndroidSignalContract`, with placeholder values;
- `AndroidDeviceFacts`, and a `ContextDeviceFacts` that reads nothing;
- `AndroidDeviceSignals`, whose `collect` returns `null`;
- `IosDeviceSignals`.

The RED commit adds the stub's remaining placeholders (`SANDBOX_OUTCOMES`, `COLLECTOR_VERSIONS`, `SEQUENCES`, `SCREEN`, `ANDROID_ID`).

`./gradlew -q :openverify-sdk:compileAndroidMain :openverify-sdk:compileKotlinIosArm64` passed with no output.

### RED (`a83b6184`)

```
./gradlew -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.*' --tests 'dev.openverify.sdk.flow.FlowCoordinatorHandoffTest'
56 tests completed, 33 failed
BUILD FAILED in 2m 8s            (load 6.98)
```

| Class | Tests | Failed | Intended reason |
|---|---|---|---|
| `AndroidDeviceSignalsTest` | 17 | 14 | The stub's `collect` returns `null` (for example "expected: <AndroidIntegritySignals(...)> but was: <null>"; "expected: <tablet> but was: <null>") |
| `AndroidSignalContractTest` | 5 | 5 | The placeholders differ from the sources ("expected: <1> but was: <0>"; "expected: <[smartphone, tablet]> but was: <[]>"; "expected: <[0-9a-f]{1,16}> but was: <>") |
| `ContextDeviceFactsTest` | 5 | 4 | The stub reads nothing ("expected:<0f1e2d3c4b5a6978> but was:<null>"; "expected:<720> but was:<0>") |
| `FlowApiClientSignalsTest` | 6 | 6 | `sendSignals` is still the interface's no-op: no request is made ("List is empty."), and nothing is refused |
| `FlowCoordinatorSignalsTest` | 9 | 2 | A session that already has consent sends nothing when it loads ("expected: <[(FlowSessionSignals(integrity=true, recognition=false), consent, 0)]> but was: <[]>") |
| `OpenVerifyInquiryActivitySignalsTest` | 2 | 2 | The activity still passes `DeviceSignals.None` ("no request after the session read") |
| `FlowCoordinatorHandoffTest` | 9 | 0 | A characterization test: Stage 1a built the rule with no test |
| `NeverReadTest` | 3 | 0 | A guard over the sources and the manifest; the code it guards was already clean |

Of the 23 that passed at RED:
- the coordinator tests cover behaviour Stage 1a already had: nothing before consent, the read after consent, failures swallowed, and no read with `DeviceSignals.None`;
- one fact is the platform's own answer, `Debug.isDebuggerConnected()`, which is `false` under test, so the stub's `false` matched it;
- three are null cases of `AndroidDeviceSignalsTest` (neither tier, an undefined width, the printed body).

### GREEN, first take

`AndroidSignalContract`, `AndroidDeviceSignals` and `ContextDeviceFacts` were implemented, together with:
- `@EncodeDefault` on `FlowSignals.platform`. `OpenVerifyJson` does not encode defaults, so the body would have gone out without `platform`, which the strict contract requires;
- `FlowApiClient.sendSignals`;
- the coordinator's send when a session that already has consent loads;
- `AndroidDeviceSignals(applicationContext)` in the activity.

The signals tests went green: 56 tests, 0 failed. The whole host suite then found a real defect:

```
./gradlew -q :openverify-sdk:testAndroidHostTest
1324 tests completed, 1 failed            (load 13.78)
FAIL dev.openverify.sdk.OpenVerifyInquiryActivityTest a document step can choose a file through the system document picker (C64_2)
  :: androidx.compose.ui.test.ComposeTimeoutException: Condition still not satisfied after 10000 ms
```

The coordinator awaited the send (Stage 1a's design), so a server that never answered `/flow/signals` held the flow on its loading screen until the HTTP timeout. Signals must never hold the flow.

### The fix: the body goes out beside the flow

`sendSignalsBeside` launches the work as a child of the calling action. Every coordinator action runs in its own `viewModelScope.launch`, so the work:
- never holds the action's lock;
- ends with the view model.

Two tests were added for a server that never answers, and the RED of both was shown against the awaited version. The awaited version went into the working tree for one run, then the file was restored and checked byte for byte with `cmp`:

```
./gradlew -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.FlowCoordinatorSignalsTest'
11 tests completed, 3 failed
FAIL a server that never answers the signals call holds neither the flow nor its actions, and the call en :: expected: <Capture(step=GovernmentIdStep(id=government_id, ...), kind=FRONT, ...
FAIL a server that never answers the read of the tiers never holds the consent() :: expected: <Capture(step=GovernmentIdStep(id=government_id, ...
FAIL a failed read of the tiers never stops the flow() :: expected: <[]> but was: <[(FlowSessionSignals(integrity=true, recognition=false), consent, 0)]>
```

The third failure is expected too. Its test now injects the read failure after the consent action, because the read runs beside the flow.

The coordinator tests now let the scheduler run (`advanceUntilIdle()`) before asserting. They assert the order of the session reads and signal sends only (`signalCalls`), because those now interleave with the flow's own calls. The activity test answers by path through a `Dispatcher`.

### GREEN (`ac8184ea`)

```
./gradlew -q :openverify-sdk:testAndroidHostTest
tests 1326 failed 0            (load 18.83)
./gradlew -q :openverify-sdk:lint :openverify-sdk:compileTestKotlinIosArm64 :openverify-sdk:koverVerify
(lint: only the existing AndroidGradlePluginVersion, GradleDependency, NewerVersionAvailable and OldTargetApi warnings; HardwareIds is suppressed at the one ANDROID_ID read, with its reason)
```

## Slice 2: a decided inquiry reads nothing about the device

### RED (`3589bf5e`)

```
./gradlew -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.FlowCoordinatorSignalsTest'
12 tests completed, 1 failed
FAIL a decided inquiry shows its end and reads nothing about the device() :: expected: <[]> but was: <[(FlowSessionSignals(integrity=true, recognition=false), consent, 0)]>
```

### GREEN (`ad7613a3`)

The load path sends only while `terminalState(loaded) == null`.

```
./gradlew -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.*'
signals tests 50 failed 0
```

## Refactor (`f9314aae`)

Stage 1a had placed `FlowApi.sendSignals` between `pollVerification`'s KDoc and its function, so the poll documentation was attached to the wrong member. It now stands before `pollVerification`, and `DeviceSignals` has lost its stub wording.

```
./gradlew -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.*' --tests 'dev.openverify.sdk.api.*'
tests 413 failed 0
```

## Docs (`d00dca6a`)

`android/openverify-sdk/README.md` covers:
- what the SDK reads per tier;
- what it never reads;
- the Google Play Data safety entries ("Device or other IDs" under device recognition; "App info and performance" for the session-integrity facts), with the final answers left to the developer and the operator.

## Final gates

```
(cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 6m 24s            (exit 0; load 12.83 at the start, 22.19 at the end; 12:41:17 to 12:47:42 UTC)
  openverify-sdk testAndroidHostTest: 1,327 tests, 0 failed, 0 skipped
  demo-app testDebugUnitTest: 18 tests, 0 failed
  koverXmlReport: SDK line coverage 97.55% (3,502 of 3,590 lines); dev/openverify/sdk/signals 97.56% (40 of 41)

pnpm format:check            (from the repository root)
All matched files use Prettier code style!            (exit 0)
```

- **Host tests:** 1,268 at the base and 1,327 now, so **59 more**.
- **Where the 59 are:**
  - 50 signals tests in `androidHostTest`: 17 + 5 + 5 + 12 + 3 + 2, plus the 6 common client tests that run in the host suite;
  - the 9 `FlowCoordinatorHandoffTest` cases.
- **iOS:** `IosDeviceSignalsTest` compiles into the iOS test klib on Linux and runs only on macOS.
