# TDD evidence: Phase 10, Workflow 10C, docs-android (family D)

Agent: `docs-android`, Stage 2, beside nfc-sdk, api-nfc, release-checks, demo-app and privacy-checks. Base `f71b0f6d`, 10C decisions `4e2a0c32`, Stage 1a checkpoint `1696e9d8`. Date: 2026-11-10. Deliverables: the plan's docs-android bullet (C213.5, C222).

Every Gradle call ran from `android/` as `flock -E 75 -w <n> /tmp/openverify-gradle.lock ./gradlew --no-daemon …`, in the foreground. Exit 75 means the lock was busy and is recorded as such, never as a failure. No device or emulator was used, and no CI run is counted on (rule 28).

## 1. What was written

| File | New or extended | Held by a test |
|---|---|---|
| `docs/android/privacy.md` | new | `WireDataSafetyTableTest` (8 tests) |
| `android/openverify-sdk/README.md` | extended | `WireDataSafetyTableTest` (its Data safety table), `FailureReasonDocsTest` |
| `docs/android/sizes.md` | new | `SizesPageTest` (2 tests) |
| `docs/android/nfc.md`, `docs/android/release-and-support.md` | new | none |
| `android/CHANGELOG.md` | new | none |
| `docs/checks/nfc.md` | extended | the dashboard's `government-id-nfc-words.test.ts` reads its "What a pass means" section, which is unchanged |
| `android/openverify-nfc/README.md`, `NOTICE` | extended | none |
| `docs/android/README.md`, `integration.md`, `events.md`, `failure-reasons.md`, `themes-and-languages.md`, `device-integrity.md` | borrowed edits | `FailureReasonDocsTest` (the failure-reason page's rows) |

The three test classes are in `android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/docs/` (12 host tests, in the `rest` group).

## 2. The wire-to-Data-safety table (C213.5, decision 66, review P04)

**The test** (`WireDataSafetyTableTest`) takes "the members the SDK sends" three ways and requires a row of `docs/android/privacy.md` for each:

1. what the real `FlowApiClient` and `OneTimeLinkClient` put on the wire over Ktor's `MockEngine`, call by call: the headers, the query, the JSON members, the multipart fields and the file part. Every `FlowApi` method must be in the call table (read by reflection), so a new route cannot be added without its rows;
2. every member of the request models from their serial descriptors, optional ones included (`FlowSignals` with `android-integrity` and its three lists, `android-recognition`, `device-class`, `sandbox-outcome`; the selfie submit's camera snapshot; the typed inputs; the chip submit, client-unable and sandbox-chip bodies);
3. every committed request fixture `contracts/fixtures/flow-requests/android/index.json` lists.

It also fails on a row for something the SDK does not send, on a category outside the fixed list, and when the README's Data safety table names other categories than the table uses.

**RED** (commit `cf37e4664`), first run before the two test-side corrections below:

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.docs.*"
10 tests completed, 7 failed
BUILD FAILED in 2m 28s            (exit 1; 173 s with the lock wait; load 6.6)
 - every header, query member, body member and file part the real client sends has a row  FAIL
     docs/android/privacy.md has no row for what FlowApiClient sends ==> expected: <[]> but was:
     <[Every request | Accept, Every request | Authorization, Every request | OpenVerify-Flow-Spec,
       Every request | User-Agent, GET /api/v1/flow/session | (no body), …,
       POST /api/v1/flow/signals | android-integrity.emulator-indicators, …,
       POST /api/v1/flow/verifications/:id/files | capture-method, …]>          (75 rows missing)
 - every member of the request models has a row, optional ones included  FAIL    (70 rows missing,
     among them … | sandbox-outcome, … | chip.device-report.protocols[].protocol, … | reason)
 - every committed request fixture's members have rows, and every listed route is in the table  FAIL
 - every row's category is one of the fixed list  FAIL
     docs/android/privacy.md holds no table between <!-- wire-members:start --> and <!-- wire-members:end -->
 - the README's Data safety table names exactly the categories the table uses  FAIL
 - the README's failure-reason section names every reason once and links the page  FAIL
     expected: <[FLOW_HALTED, INQUIRY_EXPIRED, …, UNSUPPORTED_FLOW]> but was: <[]>
 - every method of FlowApi is in the call table or is named as sending nothing of its own  FAIL
     … pollVerification-dWUq8MI … / … redeem …
```

The last failure was the test's own: the JVM name of `pollVerification` is mangled (it takes a `Duration`), and the one-time link's `redeem` is not a `FlowApi` method. Both were corrected before the commit, and the second run failed only for the intended reason:

```
got lock after 122 s
10 tests completed, 6 failed
BUILD FAILED in 25s               (exit 1; 148 s; load 5.3)
 - every method of FlowApi is in the call table or is named as sending nothing of its own  PASS
 - every call reaches its route, and only the NFC calls may be unbuilt  PASS
 - no row names a request or a member the SDK does not send  PASS      (no rows yet)
 - the failure-reason page has one row for each reason, in the enum's order  PASS   (10A's page)
 - the other six: FAIL, as above (no table; no README section)
```

**GREEN** (commit `c1658305d`: `docs/android/privacy.md` and the README):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --rerun --tests "dev.openverify.sdk.docs.*"
BUILD SUCCESSFUL in 3m 4s         (exit 0; 568 s with the lock wait; load 9.6)
 10 of 10 PASS
```

The RED commit stood in the shared tree for about 11 minutes.

**What the table holds.** 49 rows in 4 columns (request, members, category, what it is and when), between the markers `<!-- wire-members:start -->` and `<!-- wire-members:end -->`. Categories, a closed list in the test: Photos, Personal info, Financial info, Files and docs, App activity, App info and performance, Device or other IDs, and None for protocol members.

**The NFC calls.** nfc-sdk's encoders (`nfc/NfcFlowRequests.kt`) were stubs when the test was written. A call that answers `NotImplementedError("flow_api_not_built: …")` sends nothing, and the test then takes that route's members from the models and, once nfc-sdk writes them, the fixtures. Only the five NFC methods may do so. The rows for the chip uploads, the chip submit, client-unable and sandbox-chip are in the table already. By gate run 6 (section 7) nfc-sdk had built the five encoders and written its twelve request fixtures, and the test passed against both with the table unchanged: the rows written ahead from the contracts were the members the built client sends.

## 3. The failure reasons (C190.4)

`FailureReasonDocsTest`: `docs/android/failure-reasons.md` has one row per `FailureReason` in the enum's order, and the README's "Failure reasons" section names every reason once (grouped by what the host should do) and links the page. RED and GREEN are in section 2's runs (the README case failed, then passed).

## 4. The sizes page (C216.3, review H18)

`SizesPageTest` holds `docs/android/sizes.md` to release-checks' `android/size-baseline.json` (commit `c28d9dcb5`): the same configurations, the same ABIs, each figure to a tenth of a megabyte, and the `sdk,nfc` heading must say "without the reader".

**RED** (commit `202cdd26b`; two earlier attempts ended in a compile error in nfc-sdk's `NfcSingleUsePostTest.kt:100`, another agent's work in progress, and were run again):

```
got lock after 284 s
12 tests completed, 2 failed
BUILD FAILED in 2m 48s            (exit 1; 453 s; load 14.4)
 - the sizes page shows exactly the baseline's configurations and ABIs, each figure to a tenth of a megabyte  FAIL
     expected: <{sdk={arm64-v8a=[3.3, 6.9], armeabi-v7a=[3.2, 6.4], x86=[3.4, 7.0], x86_64=[3.3, 7.0]},
                 sdk,nfc={arm64-v8a=[3.3, 6.9], …}}> but was: <{}>
 - openverify-nfc's configuration is labelled as without the reader  FAIL
```

**GREEN** (commit `0c656ebaa`, `docs/android/sizes.md`): in gate call (1) `rest` below, `SizesPageTest` 2 of 2, `WireDataSafetyTableTest` 8 of 8, `FailureReasonDocsTest` 2 of 2. The page was placed in the working tree at once after the RED commit, so no other agent's gate met it.

## 5. Statements read from the code, not only from the plan

- The publish rule as api-nfc built it (`7064e3f76`, `9e8e0c875`): publish asks `client-unable:<step id>` beside `fallback:<step id>` for an `nfc` step whose fallback continues, and warns `nfc_fallback_missing`; a client-unable exit goes to review unless the version carries that acknowledgement with `onFallback: continue`. `docs/android/nfc.md` and `docs/checks/nfc.md` say exactly that.
- The NFC screens' English words (`strings_nfc.xml`, nfc-sdk's `c43081289`): the phases, the three "cannot read" titles, "Test chip (sandbox)", "Is this your data?".
- The size figures: `android/size-baseline.json` (release-checks' `c28d9dcb5`), 13 bytes of download between the two configurations.
- `android-release.yml` as release-checks built it (`3441663a8`): dispatch only, a gate job, the device matrix, a publish job that exits with a notice without the owner's secrets.
- 10B's closed gaps, checked in the code before the 10A pages were corrected: `FlowCoordinator.kt:751` (an unsupported step resolved before a language is picked reports `Failed(UNSUPPORTED_FLOW)`), `events/FlowEvents.kt:192-197` (`CAMERA_UNAVAILABLE`).

## 6. The gates, as run

| Call | Result | Wall (lock wait) | Load after |
|---|---|---|---|
| `pnpm format:check` | exit 0 | 159 s | 9.8 |
| (5) `:openverify-sdk:assemble` | exit 0 | 310 s (201 s) | 8.8 |
| (5) `lint` | exit 0 | 371 s (174 s) | 5.7 |
| (1) `-PhostTestGroup=flow` | exit 0, 401 tests | 220 s (186 s) | 11.7 |
| (1) `-PhostTestGroup=ui` | exit 75 twice (lock busy), then exit 0, 476 tests | 263 s (246 s) | 12.3 |
| (1) `-PhostTestGroup=rest` | see section 7 | | |

`.prettierignore` skips Markdown and `android/`, so `format:check` covers none of this agent's files; it was run as the bullet asks.

## 7. Gate call (1) `rest`, and the failures that are not this agent's

`rest` was run six times between 13:28 and 14:35, because other agents' work kept failing it. The 12 tests of `dev.openverify.sdk.docs` passed in every run that compiled.

| Run | Result | What failed | Owner |
|---|---|---|---|
| 1 (load 3.0 after) | exit 1, 1,633 tests, 1 failed | `NfcPlatformTest` "a phone without the NFC feature, or without an adapter, has no hardware" | nfc-sdk's RED step; green after its `c43081289` |
| 2 (load 34 after) | exit 1, 1,633 tests, 2 failed | `ContextDeviceProbeCostTest` (the probes' CPU budget) and `BarcodeSideCostTest` (74.2 ms of thread CPU against half of the 125 ms interval; 39.8 to 44.3 ms at load 4.5 in carry-10c's record) | carry-10c's tests, now integration-10c's |
| 3 (load 14 after, 17 to 26 during) | exit 1, 1 failed | `BarcodeSideCostTest` | the same |
| 4 | exit 75 | the Gradle lock was busy for 330 s | not a failure |
| 5 (load 26 after) | exit 1, 1,723 tests, 2 failed | the same two cost tests | the same |
| 6 (load 44 at the lock, 12.7 after) | **exit 0, 1,723 tests, none failed, none skipped** | | |

```
got lock after 224 s
BUILD SUCCESSFUL in 2m 24s        (exit 0; 369 s with the lock wait)
tests 1723 failed 0 skipped 0
TEST-dev.openverify.sdk.docs.FailureReasonDocsTest.xml 2 0
TEST-dev.openverify.sdk.docs.WireDataSafetyTableTest.xml 8 0
TEST-dev.openverify.sdk.docs.SizesPageTest.xml 2 0
```

**A finding for integration-10c** (not this agent's files): the two cost tests measure thread CPU time, as the rules ask, and still failed in three of five runs while four other agents' suites held the load at 17 to 34. Thread CPU time grows under contention on this host (shared cores and caches), so a budget of twice the quiet figure is not enough. Neither test touches anything this agent wrote.

The host-test counts at these runs: ui 476, flow 401, rest 1,723, so 2,600 in all, none skipped, with the other Stage 2 agents' tests as they stood. This agent added 12.

## 8. Checkpoint

Checkpoint 1 is the commit whose subject holds "Workflow 10C docs-android checkpoint 1". Commits before it:

| Commit | What |
|---|---|
| `cf37e4664` | RED: `WireDataSafetyTableTest`, `FailureReasonDocsTest` |
| `c1658305d` | GREEN: `docs/android/privacy.md`, the SDK README |
| `8ee5c7ecd` | `docs/android/nfc.md`, `release-and-support.md`, `android/CHANGELOG.md`, `openverify-nfc`'s README and NOTICE, `docs/checks/nfc.md` |
| `079908379` | the borrowed edits of the 10A and 10B pages |
| `202cdd26b` | RED: `SizesPageTest` |
| `0c656ebaa` | GREEN: `docs/android/sizes.md` |

## 9. What depends on another Stage 2 agent's work

Listed in the handoff, so integration-10c can check each against the code as it lands: the NFC screens' behaviour (nfc-sdk), the server's client-unable, sandbox-chip, `prefillMrz` and `trust:sandbox-utopia` behaviour (api-nfc), the consumer rules, the 16 KB and size checks, the staged repository and the release workflow (release-checks), the per-window `FLAG_SECURE` and saved-state checks (privacy-checks), and the demo's build types (demo-app).

No device proof is open from this agent: it added no device test and no device-only behaviour.
