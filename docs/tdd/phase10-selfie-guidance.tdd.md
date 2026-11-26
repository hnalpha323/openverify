# Phase 10, Workflow 10B: selfie-guidance (Stage 2, family C)

C204.1-C204.6 and C204.8: the web flow's selfie guidance (`apps/flow/src/guidance/`) ported to
`commonMain/.../capture/selfie/`, checked on vectors the web writes; the guidance through the capture
screen's slots with a fake detector; the 2.2.1 warning and "more time" (`capture/selfie/Extension.kt`,
foundation-10b's stub). Base `7d985a77` (10A pushed), 10B decisions `bf3a87e3`, contracts-10b's last
checkpoint `489e799d`.

Every Gradle call ran as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon ...)`;
an exit 75 is a busy lock (retried), never a failure. Other Stage 2 agents' uncommitted RED tests broke
the shared tree's test compilation (`BarcodeOverlayTest`, `CaptureScreenSlotsTest`, `CaptureTriggerTest`,
none of them mine), so from the GREEN of the port on, the narrow runs used a scratch worktree
(`git worktree add --detach /tmp/ov-selfie-wt` under the git lock, rule 2) holding the committed tree plus
my uncommitted files.

## Slice 1: the vectors (C204.1, C221.8)

`apps/flow/src/guidance/export-vectors.test.ts`, assert-only, its own case table, importing only the web
modules (`yunet-input`, `face-detector` with a fake ONNX Runtime, so the detector's unexported candidate
and NMS thresholds are the ones exercised, `yunet-decode`, `head-pose`, `guidance-machine`), writing only
under `UPDATE_CONTRACT_FIXTURES=1` (then Prettier).

RED (`d78739f7`), `pnpm --filter @openverify/flow exec vitest run src/guidance/export-vectors.test.ts --coverage.enabled=false`:

```
 FAIL  src/guidance/export-vectors.test.ts > ... > is what the web modules give over this case table
Error: ENOENT: no such file or directory, open '.../contracts/fixtures/flow/selfie-guidance-vectors.json'
      Tests  1 failed | 3 passed (4)
```

GREEN (`3b07b13c`): `UPDATE_CONTRACT_FIXTURES=1` wrote the file (165,086 bytes: 11 letterbox, 11 decode,
36 yaw, 11 machine cases), `pnpm exec prettier --write` formatted it, and the plain run passed:

```
      Tests  4 passed (4)
```

The file passes `selfie-guidance-vectors.schema.json` (Ajv 2020 from `apps/api`, a one-off check:
`schema true null`); `apps/flow` has no Ajv, so the test does not repeat it.

## Slice 2: the port (C204.1, C204.3, C204.8)

Stub `093cff3e`; RED `7c2740fe`, `:openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.capture.selfie.*'`
(lock wait about 215 s, load 4.6):

```
33 tests completed, 27 failed
> Task :openverify-sdk:testAndroidHostTest FAILED
```

GREEN `f3fd806d` (in the worktree, with `ResourcesTest` and `dev.openverify.sdk.i18n.*`; load 6.4):
the first run gave `113 tests completed, 1 failed`: `YunetDecodeTest.clearingZeroesEveryFaceValue`
expected the decoder to hold candidates until `wipe()`, but `decode` already zeroes them before it returns
(the stronger rule, C204.8). The assertion was corrected in the GREEN commit, which says so.

Strings: `c277b58a` (`strings_selfie.xml` in five folders, 16 keys, the non-English machine-drafted from
the web's `selfie.guidance` and `screen.extend` words; the keys added to `i18n/review-status.json` as a
borrowed edit, committed at once).

## Slice 3: the guidance in the slot, the factory and more time (C204.3, C204.5, C204.6, C204.8)

Stub `bb4bfe24` (`SelfieGuidance` reading no frame, `SelfieGuidanceFactory` answering none, the window's
`guidance` member, `SelfieExtensions`, the warning's test tags); RED `104ba178`, in the worktree
(lock wait 194 s, load 8.9):

```
SelfieGuidanceTest > theCentreIsCapturedOnceFromTheCallbackInWhichThePoseHeld() FAILED
SelfieExtensionTest > ten extensions in a row on a frozen clock keep the capture open, and the next pose goes to it() FAILED
SelfieGuidanceReachabilityTest > after each frame callback no box, landmark, frame or detector output is reachable from the guidance() FAILED
SelfieGuidanceUiTest > the hint is heard as its settled announcement, once per settled change, never per frame FAILED
...
66 tests completed, 26 failed
```

GREEN `5c0dd55f`: the first run (lock wait 196 s, load 14.7) left two failures, each fixed before the
commit, which says so:
- `SelfieExtensionTest`'s drop test saw one POST, not two: OkHttp resends a request whose connection drops
  only over a pooled connection, so the test now reads the session first, as the flow always has (the SDK
  itself never sends the extension again);
- `theCentreIsCapturedOnce...` found the shutter promoted: frames ending after a taken still no longer
  promote it (only frames that end before one).

Then `:openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.capture.selfie.*' --tests '...StateHooksTest'
--tests '...CaptureHooksTest'`: `BUILD SUCCESSFUL` (lock wait 93 s, load 2.9). StateHooksTest's
selfie-guidance case was replaced by its owner in the same commit (a borrowed edit, the file clean first).

Refactor `5c0d1a1a`: the detector is created and each frame judged on `Dispatchers.Default`, inside the
frame's callback (`FrameRelay.frames`' rule); the tests pass `EmptyCoroutineContext`, so their clock stays
the test scheduler's. `BUILD SUCCESSFUL` (lock wait 55 s, load 10.6).

## Slice 4: goldens (C219.3)

`718c4bb8`: six goldens recorded by the explicit record call over `SelfieGuidanceScreenshotTest` only, from
synthetic content (an oval on a plain box): `selfie-guidance-{hold-still,turn-left,manual,time-warning,more-time-failed}`
(English, light, 1.0) and `selfie-guidance-ar-dark-large` (Arabic, dark, 2.0), 182,721 bytes in all, each
with the accessibility checks; looked at before committing. The warning's said count moved from
composition into its clock effect in the same commit (no backwards write).

## Final gates (in the shared tree, at `f1b24d74` plus this file)

| Call | Result | Lock wait / wall | Load |
|---|---|---|---|
| (a) `:openverify-sdk:testAndroidHostTest` | **exit 1**: 2,312 tests, 0 skipped, 2 failed, both `OpenVerifyInquiryActivityComponentsTest` ("in production it is never sent, and the body still is", "in a sandbox the installed outcome rides on the signals body": `IllegalStateException: no signals call`), none of selfie-guidance's; the same two fail alone (10 tests, 2 failed) and in the scratch worktree; device-integrity-android's TDD file traces them to `collect` reading on `Dispatchers.IO` (`0b7e4867`) against the test's blocked main looper, and hands the shared test's fix to integration-10b | 172 s / 322 s; again 73 s / 269 s | 6.3; 11.1 |
| (b) `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | exit 0: 60 screenshot tests, 0 failures (selfie-guidance's 6 among them) | 140 s / 194 s | 5.1 |
| (c) `koverVerify checkKotlinAbi` | **exit 1** at its `testAndroidHostTest` dependency, on the same two tests; `checkKotlinAbi` alone exit 0 (0 s / 10 s, load 9.3) | 7 s / 146 s | 13.6 |
| (d1) `testDebugUnitTest assembleDebug` | exit 0 | 47 s / 69 s | 13.9 |
| (d2) `:demo-app:assembleRelease :demo-app:bundleRelease` | exit 0 | 33 s / 46 s | 13.0 |
| (e1) `:openverify-sdk:assemble` (the AAR, the iOS klibs, `checkDependencyBoundary`) | exit 0 | 73 s / 86 s | 4.8 |
| (e2) `lint` | exit 0 | 188 s / 201 s | 14.7 |
| (f) `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | exit 0 | 233 s / 255 s | 13.0 |

Each exit code was read from the command, the output sent to a file. No call passed 300 s of build time.

Web: `pnpm --filter @openverify/flow typecheck` exit 0 (110 s, load 19.0); `lint` exit 0 (88 s, load 18.8);
`test` exit 0: 126 files, 1,507 tests, 94.84 % statements (153 s, load 5.9). `pnpm format:check` exit 0
(144 s).

Coverage of this area (Kover over the selfie tests in the worktree, `koverXmlReport`):
`dev/openverify/sdk/capture/selfie` 98.9 % of lines (449/454), 89.2 % of branches; no Kover exclusion.

SDK host tests: 1,960 at contracts-10b's close, 2,312 at this gate (every agent's); selfie-guidance adds 66
(`GuidanceMachineTest` 14, `SelfieGuidanceTest` 12, `YunetInputTest` 7, `SelfieExtensionTest` 7,
`SelfieGuidanceUiTest` 7, `SelfieGuidanceFactoryTest` 6, `SelfieGuidanceVectorsTest` 5, `YunetDecodeTest` 5,
`SelfieGuidanceConstantsTest` 2, `SelfieGuidanceReachabilityTest` 1), removes none, replaces one pinned case
of `StateHooksTest`, and adds 6 screenshot tests (182,721 bytes of goldens).
