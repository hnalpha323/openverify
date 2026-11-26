# Phase 10, Workflow 10D Stage 1: android-a11y-audit (TDD evidence)

C212 end to end, on the host, test-first. Two runs of one agent: the first was cut off by a harness login failure after two commits (`624ea7e60`, `7edebdf28`) with the GREEN step uncommitted; this run verified and committed it and did the rest. Every Gradle call ran as `flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon ...` from `android/`; the agent ran alone, no call waited for the lock, and the load average is beside each timing.

## 1. Commits (after the 10D start `27a65be91`)

```
624ea7e60 feat(android): stubs for the SDK's one text composable with its test-only cut-off property, and the en-XA pseudo-locale (C212.2; Workflow 10
7edebdf28 test(android): RED the SDK's one text composable records a cut-off text, no source draws a text beside it, and the pseudo-locale lengthens a
18e1661f4 feat(android): GREEN every text the SDK draws goes through its one text composable, which records a cut-off text; the en-XA pseudo-locale ac
3dd5857a8 feat(android): stubs for the accessibility sweep: test tags on the status nodes it finds (the error message, a request on its way, the conse
43b150c59 test(android): RED the accessibility sweep over every screen state: the heading is read first, status nodes are live regions with words, and
1af3397c6 fix(android): GREEN the capture screen reads its heading first and scrolls when its words outgrow the window, with the preview never lower t
a90c5e727 test(android): RED every screen state of the inventory has a golden drawn through the accessibility checks, every golden on disk belongs to 
9962e28a4 test(android): GREEN 113 goldens for the screen states that had none (consent in the five languages at both font sizes, the camera permissio
bad8c9748 test(android): announcements counted on the capture prompts, NFC phases, the waiting screen, the selfie time warning and a code's countdowns
a2636eba7 test(android): RED every usable control can take focus and the controls are composed in the order the screen is read; the selfie time warnin
694a5e25c test(android): the composed-order check is withdrawn: the semantics tree lists nodes as drawn, not as focus visits them, so it cannot show f
85892bef3 docs(android): the accessibility page: what the SDK offers a screen reader, a large font and a right-to-left language, every lifetime a pers
c49e2c31e test(android): no time limit but the server's: every duration in the shipped sources is classified on the accessibility page, whose lifetime
51a1e5788 test(dashboard): RED the accessibility statement's Android part is held to the newest android-audit-<date>.md's manual results as the web's 
f8276c40f test(android): RED the newest Android audit tables the inventory as the code holds it (C212.1)
dea5e83ac docs(accessibility): GREEN the Android SDK's audit of 2026-11-11 (inventory of 181 states, automated results, four defects fixed, the manual
ae97bf949 fix(android): the capture frame asks only the guidance overlay what height it needs, never the camera's own viewfinder; a device test lays t
```
plus this file's commit.

## 2. The SDK's one text composable and the pseudo-locale (C212.2, review H19)

Stub `624ea7e60`, RED `7edebdf28`, GREEN `18e1661f4`. The first run's RED output was lost with its session, so the RED was run again in a scratch worktree at `7edebdf28` (`git worktree add --detach /tmp/ov-a11y-red 7edebdf28`, removed after):

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.text.*' --tests 'dev.openverify.sdk.i18n.PseudoLocaleTest'
10 tests completed, 7 failed          (exit 1, 42 s, load 3.0)
SdkTextTest > a text taller than its box is recorded as cut off: expected:<true> but was:<null>
SdkTextTest > a text that fits its box is recorded as not cut off: expected:<false> but was:<null>
SdkTextSourceTest > no shipped source but the SDK's text composable draws a text directly: expected: <[]> but was: <[src/androidMain/.../CameraXCaptureCamera.kt, src/commonMain/.../BarcodeOverlay.kt, ...
PseudoLocaleTest > aTextIsAccentedAndAtLeastAThirdLonger: expected: not equal but was: <Take the photo>
```

GREEN: the 23 uncommitted files of the first run were kept as they were, with one correction: `CryptoWalletStep.kt` passes `fontFamily`, which the wrapper did not take (`compileAndroidMain` failed on it), so `Text(text: String, ...)` gained `fontFamily`. Then: `BUILD SUCCESSFUL`, 10 tests, 0 failed (93 s, load 3.0).

## 3. The sweep over every state (C212.1, C212.2)

Stub `3dd5857a8` (test tags on status nodes, no behaviour change), RED `43b150c59`, GREEN `1af3397c6`.

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.a11y.A11ySweepTest'
12 tests completed, 9 failed          (exit 1, 71 s, load 2.2)
the first thing read on every screen is its heading: 46 problem(s)
  loading (en at 1.0): the first thing read is not a heading: openverify:progress
  capture-id-front (en at 1.0): the first thing read is not a heading: Photo 1 of 2 ...
every status and error node is a live region that carries words: 1 problem(s)
  consent-submitting (en at 1.0): the status openverify:consent-saving is not a live region
no text is cut off at twice the font size: en 7, ar 13, fr 53, es 54, de 57, en-XA 76 problem(s)
  capture-id-retry-hints (en at 2.0): the text "Take photo" is cut off at [114,655 133x11]
  capture-id-retry-hints (en at 2.0): the control Cancel is off the screen, outside any scrolling area
```
Passing in the RED run, as built by 10A to 10C: a name on every control, 48 dp touch targets, the error summary before the fields.

GREEN (`1af3397c6`): 12 tests, 0 failed (121 s with the compile, load 3.0); the `ui` group 493 tests, 0 failed (125 s).

Two things the harness got wrong before the RED commit, fixed in the harness and not in the SDK: `boundsInRoot` is empty for a node scrolled out of view, so order and position use `positionInRoot`; a Material button's node is 40 dp high inside a 48 dp touch area, so targets are measured by `touchBoundsInRoot` on a window that shows the whole screen. A first run with the test clock held for every state spun for ever in `waitForIdle` (a background read changed state with no frame to apply it); the clock is held only for the selfie time warning's states.

## 4. Goldens and the inventory (C212.2, C219.3)

RED `a90c5e727`:
```
A11yInventoryTest > every golden a state names is on disk, and belongs to one state FAILED
  goldens that are not recorded expected:<[]> but was:<[chrome-sandbox-banner: android-a11y-audit/chrome-sandbox-banner, ... (113)
```
Recorded by the explicit call only, for the audit's own folder:
```
./gradlew --no-daemon :openverify-sdk:screenshotTest -Proborazzi.test.record=true --tests 'dev.openverify.sdk.ui.a11y.*'      (exit 0, 48 s, load 2.1)
```
113 new goldens in `screenshots/android-a11y-audit/` (3,831,693 bytes). Reviewed: the capture screen with a hint in English and in Arabic, dark, at 2.0; consent; the selfie time warning; the language menu; a form with errors; the code entry; a review while sending; loading; an expired wallet message. A first record used a wrong optional consent key (no optional text was drawn) and was recorded again with `consent.biometric-matching`. No golden of another owner was re-recorded: the full comparison passes on all 205 (92 earlier, 113 new; 7,479,747 bytes in all). GREEN `9962e28a4`.

A parameterized Robolectric class is not found by the screenshot task's category filter ("No tests found for given includes"), so the audit's goldens are two tests that each draw their goldens in turn and report every one that differs.

## 5. Announcements, right to left, keyboard, timing

- `bad8c9748`: `A11yAnnouncementsTest` (7) and `A11yRightToLeftTest` (4). They passed on their first run except one of mine (a centred heading is as wide as its words, so its margins do not mirror; the test now accepts a heading that stays centred). They are regression tests of what 10A to 10C built, not RED-first.
- Keyboard: three attempts to move focus on the host, each run over every state, each ending "no focus moved at all": `performKeyInput { pressKey(Key.Tab) }`, `FocusManager.moveFocus(FocusDirection.Next)`, and the first control's `RequestFocus` action followed by moves. Under Robolectric the window holds no input focus. `A11yKeyboardTest` therefore holds only that every usable control can take focus; the keys are row A8 of the manual checklist.
- RED `a2636eba7`: "the controls are composed in the order the screen is read" failed on the selfie time warning ("More time" composed after the screen it is drawn over). A reorder with `zIndex` did not change the test: the semantics tree lists nodes as drawn. The reorder could not be verified on the host and was withdrawn, and so was the check (`694a5e25c`); the finding is K7 and row A8 of the audit.
- `c49e2c31e`: `A11yTimingTest` (3) and `A11yShutterTest` (2), with `docs/android/accessibility.md` (`85892bef3`).

## 6. The statement's test (borrowed edit, C212.5)

RED `51a1e5788`:
```
pnpm --filter @openverify/dashboard exec vitest run src/accessibility-statement-records.test.ts --coverage.enabled=false
 × names the newest audits, and claims nothing beyond their manual results
Error: docs/accessibility holds no android-audit-<date>.md          Tests  1 failed | 4 passed (5)
```
GREEN `dea5e83ac` (the audit and the statement's Android part): `Tests  5 passed (5)`. The audit's inventory table is held to the code by `A11yInventoryTest` (RED `f8276c40f`: "docs/accessibility holds no android-audit-<date>.md").

## 7. The capture frame over the real camera (device)

The first GREEN asked the whole preview box for its intrinsic height, which on a device would have asked CameraX's viewfinder. `ae97bf949` asks only the guidance overlay. Host twin: `A11ySweepTest` and `A11yShutterTest` over the fake camera. Device test `CaptureScreenLayoutDeviceTest` (2 methods), compiled and lint-checked (gate calls 7 and 8), and run on a Pixel 9, Android 17, at `ae97bf949`'s tree, under the device lock:

```
./gradlew --no-daemon :openverify-sdk:connectedAndroidDeviceTest
Running tests on devices: Pixel 9 - 17
<testsuite name="dev.openverify.sdk.ui.CaptureScreenLayoutDeviceTest" tests="2" failures="0" errors="0" skipped="0">
infra/scripts/check-connected-results.sh: connected tests: 11 passed
```
The five classes: CameraXCaptureCameraTest 1, CameraXFramePipelineTest 3, ZxingCppBarcodeReaderDeviceTest 4, IntegrityProbesDeviceTest 1, CaptureScreenLayoutDeviceTest 2; none failed, none skipped. Gradle's own exit status was "failed" after the passing run (KP10-31, fix-sdk's), so the result is read from the instrumentation's XML. No emulator ran anything.

## 8. Final gates (the Android gate's split calls, in order, on the final tree)

```
GATE 1ui: exit=0 dur=133s lockwait=0s load_before=[0.53 1.37 1.83] load_after=[2.52 1.85 1.95] args: :openverify-sdk:testAndroidHostTest -PhostTestGroup=ui
GATE 2: exit=0 dur=58s lockwait=0s load_before=[3.05 2.34 2.12] load_after=[2.95 2.43 2.16] args: :openverify-sdk:screenshotTest -Proborazzi.test.verify=true
typecheck exit=0 dur=47s load=[1.75 4.65 5.04]
lint exit=0 dur=151s load=[1.60 3.41 4.51]
GATE x-ui: exit=0 dur=202s lockwait=0s load_before=[0.50 2.66 4.16] load_after=[3.01 2.98 4.00] args: :openverify-sdk:testAndroidHostTest -PhostTestGroup=ui
GATE x-shot: exit=0 dur=49s lockwait=0s load_before=[3.01 2.98 4.00] load_after=[2.64 2.90 3.92] args: :openverify-sdk:screenshotTest -Proborazzi.test.verify=true
GATE f1rest: exit=0 dur=90s lockwait=0s load_before=[1.13 2.28 3.55] load_after=[2.16 2.37 3.46] args: :openverify-sdk:testAndroidHostTest -PhostTestGroup=rest
GATE f1flow: exit=0 dur=41s lockwait=0s load_before=[2.16 2.37 3.46] load_after=[2.84 2.52 3.46] args: :openverify-sdk:testAndroidHostTest -PhostTestGroup=flow
GATE f3: exit=0 dur=187s lockwait=0s load_before=[2.61 2.47 3.45] load_after=[4.25 3.60 3.74] args: koverVerify checkKotlinAbi
GATE f4: exit=0 dur=51s lockwait=0s load_before=[4.25 3.60 3.74] load_after=[3.22 3.42 3.67] args: testDebugUnitTest assembleDebug
GATE f5: exit=0 dur=127s lockwait=0s load_before=[2.96 3.37 3.65] load_after=[11.39 6.36 4.71] args: :demo-app:assembleRelease :demo-app:bundleRelease :openverify-nfc:assembleRelease
GATE f6: exit=0 dur=51s lockwait=0s load_before=[11.39 6.36 4.71] load_after=[8.81 6.43 4.82] args: :openverify-sdk:assemble
GATE f7: exit=0 dur=141s lockwait=0s load_before=[8.81 6.43 4.82] load_after=[4.60 5.64 4.76] args: lint
GATE f8: exit=0 dur=109s lockwait=0s load_before=[4.32 5.57 4.74] load_after=[8.72 6.86 5.30] args: :openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest
GATE f9: fetch=0 unittest=0 elf=0 rules=0 size=0 dur=11s load=[7.74 6.73 5.29] Ran 83 tests in 0.540s  OK 
GATE f10a: exit=0 dur=42s lockwait=0s load_before=[7.74 6.73 5.29] load_after=[5.42 6.26 5.19] args: publishAllPublicationsToStagingRepository
GATE f10b: exit=0 dur=109s lockwait=0s load_before=[5.42 6.26 5.19] load_after=[9.47 7.41 5.72] args: -p consumer-check build
GATE f11: exit=0 dur=49s lockwait=0s load_before=[9.47 7.41 5.72] load_after=[6.02 6.81 5.59] args: -PopenverifyDemoArtifacts=sdk,nfc :demo-app:testDebugUnitTest
```
Host tests: ui 520, flow 401, rest 1,730 = **2,651**, none skipped, none failed (2,602 before: +49). Screenshot task: 95 tests over 205 goldens. Demo: 80 + 8. `pnpm format:check` exit 0; the dashboard's forced typecheck and lint exit 0; the statement test 5 of 5. `git status --porcelain` is empty but the owner's untracked file. No fix touched `commonMain/.../api/`, `flow/` or `nfc/`, so `stackTest` was not due.

## 9. Measurements

- Screens 20; states 181 (105 with goldens of their own, 76 sharing a layout by name).
- Goldens 205 (113 new, 3,831,693 bytes; 7,479,747 bytes in all). Screenshot task with comparison: 49 to 58 s at load 2.6 to 3.1, no lock wait (45 s for 60 tests at 10B's close).
- Checks: the framework on 205 goldens (0 errors, 118 warnings: 83 text contrast, 35 duplicate speakable text); names 181; targets 181; heading first 362; summary 2; status 181; cut-off text 1,086; focusable 181; announcements 7 tests; right to left 4; shutter 2; timing 3; inventory 10.
- Defects: 4 found, 4 fixed (D1 to D4 of the audit). One finding left to fix-sdk (K9), two to the manual pass (K7, K8).
- The whole a11y package on the host: about 110 s of test time inside the `ui` group (133 to 202 s for the group; 101 s before).
