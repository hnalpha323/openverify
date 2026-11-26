# Phase 10, Workflow 10C: carry-10c (the known items KP10-21, KP10-22, KP10-23)

Agent `carry-10c` (the plan's "Orchestrator decisions before Workflow 10C" item 5), Stage 1a, beside
`contracts-10c`. Every item test-first: a stub where a name was missing, RED seen failing for the
reason its detail gives, then GREEN. Commands ran after `source scripts/env.sh` from `android/`, each
as `flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon ...`; outputs are
abbreviated. Times are wall seconds; the lock wait was 0 s in every call unless stated; the load is
`cat /proc/loadavg` after the call.

No device ran any of this: the host has no `/dev/kvm` and no attached device, and no CI run can be
counted on (rule 28). Each device-only behaviour is closed in three parts: the host test of its logic,
the device test kept and extended, and a "device proof open" line (section 5).

Preconditions checked first: `docs/PROGRESS.md:20` holds "Phase 10, Workflow 10B done", `git log`
holds `f71b0f6d` and `4e2a0c324`, and the plan holds "## Orchestrator decisions before Workflow 10C".

## 1. KP10-22: the device-integrity probes' cold run (520 ms on the CI emulator)

**What the code did** (read at `f71b0f6d`): `IntegrityProbes.collect` ran each of the 16 rules against
the probe directly, so one collection called `build()` seven times, `processMaps()` twice and `mounts()`
twice; `ContextDeviceProbe.processMaps` split every line of `/proc/self/maps` with a `Regex`, and so did
the mount rule; each maps and mount rule lowered every line once per marker. Two `Regex` objects were
compiled inside the timed first run.

**Hypotheses.** H1 (the cold run of 16 rules on 2 vCPUs is this slow, the `/proc` reads being the cost)
and H2 (the two `Regex` passes over the maps dominate): not measured on a device; on the host the two
passes and the `Regex` were 65% of the collection's CPU (below), which fits H2. H3 (the camera
teardown competed for the cores): still unknown; the device test now logs each read's time, so the
next device run separates the reads from the rest.

**Stub** `fc60300ae`: `signals/ProcFields.kt` answering `null`.

**RED** `f69dcec41`: `IntegrityProbesReadsTest` (24 tests) and `ContextDeviceProbeCostTest` (1).

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.IntegrityProbesReadsTest' --tests 'dev.openverify.sdk.signals.ContextDeviceProbeCostTest' -i
    probes over 3000 files in 24000 regions, 300 threads, 400 mounts: cold 326.7 ms, median of 9 69.6 ms CPU (budget 30 ms)
ContextDeviceProbeCostTest > one collection over a large process stays inside its CPU budget FAILED
    java.lang.AssertionError: one collection took 69.6 ms of CPU, over the 30 ms budget
IntegrityProbesReadsTest > one collection makes each read once, and every rule is still answered() FAILED
    AssertionFailedError: reads made more than once ==> expected: <{}> but was: <{build=7, mounts=2, maps=2}>
IntegrityProbesReadsTest > a read that throws is tried once and records nothing for its own rules only() FAILED
    AssertionFailedError: the maps are not read again for the second rule ==> expected: <1> but was: <2>
IntegrityProbesReadsTest > a second collection reads again, so nothing is kept between collections() FAILED
    AssertionFailedError: expected: <2> but was: <4>
IntegrityProbesReadsTest > the rules that read lines hold no Regex() FAILED
    ... a Regex is compiled on the probes' first, timed run in: [DeviceProbe.kt, IntegrityIndicators.kt]
IntegrityProbesReadsTest > the mapped path is the sixth field to the line's end, as the Regex split gave it() > ... FAILED (6 lines: the stub answers null)
IntegrityProbesReadsTest > a mount line's first four fields are the Regex split's() > ... FAILED (4 lines)
25 tests completed, 15 failed          exit 1 in 50 s; load 2.85 6.37 4.77
```

**GREEN** `660aaa50d`:

- `IntegrityProbes.collect` wraps the probe in `OncePerCollection`: each read is made at most once in a
  collection; a later call gets the same value, or the same exception, so a read that threw still
  records nothing for each rule that needs it (C210.3) and is not tried again; an `Error` propagates
  from the first call; nothing is kept for the next collection.
- `ProcFields.rest` and `ProcFields.leading` split a `/proc` line in one pass without a `Regex`, to the
  same fields the `Regex` split gave (19 lines compared in the test: spaces in paths, tabs, `(deleted)`,
  short and empty lines).
- `ContextDeviceProbe.processMaps` reads the maps in one pass and skips a path equal to the one before
  it (a file's regions follow each other) before the set lookup.
- The maps, thread and mount rules lower each line once, not once per marker.
- No rule, code, read, order or wire member changed. `IntegrityProbesTest` (53),
  `ContextDeviceProbeTest` (10) and `ContextDeviceProbeRulesTest` (14) pass unchanged; `NeverReadTest`
  still finds the probe reads only in `DeviceProbe.kt`; the README's reads are the same.

Two things in the RED tests were corrected with GREEN, and are recorded here:

- The reads test's fake had a QEMU file and an `su` binary early in their lists, so the rules, which
  stop at their first hit, asked 17 paths where the test expected all 21. The fake now holds the last
  entry of each list. The rule's behaviour is unchanged.
- The CPU budget. RED ran against 30 ms. GREEN measured 22.1 ms, too close to 30 for the host's noise.
  The budget is 45 ms: twice the measured cost after the fix, and under two thirds of the 69.6 ms
  before it, so a return to two `Regex` passes fails.

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.*' -i
    probes over 3000 files in 24000 regions, 300 threads, 400 mounts: cold 41.8 ms, median of 9 24.1 ms CPU (budget 45 ms)
BUILD: every signals test passes (204 before the reads test's correction ran: 1 failed, "expected: <21> but was: <17>"; then all)
```

**Each read's cost on the host** (thread CPU, the large synthetic process: 24,000 regions of 3,000
files, 300 threads, 400 mounts; the whole collection, since the reads share one pass):

| | before (`f69dcec41`) | after (`660aaa50d`) |
|---|---|---|
| one collection, median of 9 | 69.6 ms | 22.1, 24.1 and 25.4 ms in three runs |
| the first, cold collection | 326.7 ms | 111.6, 41.8 and 45.9 ms |
| `build()` calls | 7 | 1 |
| `processMaps()` calls | 2 | 1 |
| `mounts()` calls | 2 | 1 |
| `Regex` objects compiled | 2 | 0 |

The cold figure varies with what the JVM had loaded; it is printed, not asserted. These are host
figures. They say nothing certain about the emulator's 520 ms.

**The device test** (`dfb18a2bf`), `IntegrityProbesDeviceTest`: the same single cold run, the same
500 ms bound, the 50 ms target reported, and the C210.6 assertions, all unchanged. A wrapper around the
probe, in the test only, counts each read's calls and time. All lines are logged before any assertion.
Tag `openverify-probes`:

```
probes total <ms> ms (bound 500 ms, target 50 ms)
probes read build|telephony|files|maps|threads|mounts|classes|stack: <ms> ms in <n> call(s)     (one line a read)
probes rules and first use, outside the reads: <ms> ms
probes sizes: <n> mapped paths, <n> threads, <n> mounts                                          (read after the timed run)
```

New assertion, after the old ones: `build`, `maps`, `mounts`, `threads` and `stack` are each read at
most once in the collection. It compiles (`:openverify-sdk:assembleAndroidDeviceTest`, exit 0, 36 s).

## 2. KP10-21: the barcode side's analysis size (640 x 480 on the CI emulator)

### What CameraX does (read from the 1.6.2 AARs in the Gradle cache; no sources jar is cached)

Read with `javap -p -c` from `camera-core-1.6.2.aar` and `camera-camera2-1.6.2.aar`:

- `GuaranteedConfigurationsUtil.getLegacySupportedCombinationList` holds `PRIV PREVIEW + YUV PREVIEW +
  JPEG MAXIMUM`. It is the only combination of a preview, a YUV stream and a maximum-size JPEG on every
  hardware level. The LIMITED list adds `PRIV PREVIEW + YUV RECORD + JPEG RECORD`.
- `SurfaceConfig` classes a size by its area: at most the analysis size (640 x 480) is `VGA`, at most
  the preview size is `PREVIEW`, then `RECORD`, then `MAXIMUM`.
- `DisplayInfoManager`: the preview size is the display's size, replaced by 1920 x 1080
  (`MAX_PREVIEW_SIZE`) unless the display is smaller by area, and read as 640 x 480
  (`FALLBACK_DISPLAY_SIZE`) for a display under 320 x 240 (`ABNORMAL_DISPLAY_SIZE_THRESHOLD`).

The saved CI log (run 42762952128) fits: the still's candidates were `[1856x1392, 1280x720, 1024x768,
640x480, 320x240, 176x144, 160x120]`, and beside the 1856x1392 still CameraX gave the preview 320x240
and the analysis 640x480 on a 320 x 640 display.

| Hypothesis | Verdict |
|---|---|
| H1: beside the preview and the still, the analysis stream is capped at the PREVIEW class | Held, in the bytecode and in the log. Not seen on a second device. |
| H2: that class follows the display | Held in the bytecode (`DisplayInfoManager`). The orchestrator's 1080 x 2340 observation (preview 1024x768) fits. |
| H3: the emulated camera has no 4:3 size between 1024x768 and 1856x1392 | Held for the JPEG sizes CameraX logged; the YUV list was not logged and is assumed equal. |

Consequence: on this emulator's camera no display is enough. With a 1080p display the preview class
allows 1024x768, not 1,280 px, because 1856x1392 is above the class and no other 4:3 size reaches
1,280. A phone that lists 1280x960 (or 1440x1080) and has a display of 1,228,800 px or more gets the
stream from the same code; a phone whose still is inside the RECORD class may get it on a smaller
display. None of that was seen on a device.

### The choice between F11's two ways

- **An analysis stream of 1,280 px or more: kept**, where the camera grants it. The request is
  unchanged (1280 x 960, 4:3, the closest higher then lower): CameraX already applies the rule above
  to it, so no other request gets a larger stream beside the same still.
- **A full-resolution crop of the guide area: not built.** It has no stream to come from. No guaranteed
  combination gives a YUV stream above the preview class beside a maximum-size JPEG, on any hardware
  level. The only full-resolution source is the still, which is the photo the person takes: sampling
  stills for a hint would take photos nobody asked for. The hint gates nothing (C203.3; KP10-30 is
  deferred).
- **A smaller still on the barcode side: not done.** It is outside F11's text and changes the photo
  the server re-decodes; it needs its own amendment (decisions item 6).
- **F11's cost comparison, on the host only** (`BarcodeSideCostTest`, thread CPU, median of 11): the
  copy of a 1280x960 frame took 0.716, 0.879 and 0.559 ms in three runs; the copy of the guide crop
  (1670x1053 of 1856x1392) 0.869, 1.144 and 0.812 ms. The frame was cheaper each time; both are far
  below the 125 ms interval. The device figure is still open.

So the fix is knowledge, not a new stream: **the SDK judges a barcode side by the frame it gets.**

### What was built

**Stub** `9523cb797`: `camera/AnalysisSizes.kt` answering what the code assumed (the asked size is
given; every frame is a stream; nothing is told), and `AnalysisTarget.of(kind, barcodeBearing)`
ignoring the side.

**RED** `8059622a7`: `AnalysisSizesTest` (commonTest) and `CaptureScreenSlotsTest`'s target case.

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.camera.*' --tests 'dev.openverify.sdk.ui.CaptureScreenSlotsTest' -i
CaptureScreenSlotsTest > each preview asks for the analysis size of the photo it takes FAILED
    expected:<[DOCUMENT, BARCODE, DOCUMENT, SELFIE, DOCUMENT]> but was:<[DOCUMENT, BARCODE, SELFIE, DOCUMENT]>
AnalysisSizesTest > onTheCiEmulatorTheBarcodeSideGets640By480AsTheRunShowed() FAILED
    expected: <640x480> but was: <1280x960>
AnalysisSizesTest > onALargeDisplayTheEmulatorsCameraStillHasNoFourByThreeSizeOf1280InsideThePreviewClass() FAILED
    expected: <1024x768> but was: <1280x960>
AnalysisSizesTest > aSmallerFrameIsNarrowWhileItsGuideStillHoldsTheCalibratedSymbolAndNoneBelow() FAILED
    expected: <NARROW> but was: <STREAM>
AnalysisSizesTest > theFirstFrameOfABarcodeSideTellsWhatItCanCarryOnceAndEveryFramePassesOn() FAILED
    expected: <[NONE]> but was: <[]>
AnalysisSizesTest > onlyTheSideTheServerMarksBarcodeBearingIsReadAtTheBarcodeWidth() FAILED
    expected: <BARCODE> but was: <DOCUMENT>
... (12 failed of 151: the 11 of AnalysisSizesTest that the stub cannot answer, and the screen's)      exit 1 in 87 s; load 4.77 4.32 4.24
```

**GREEN** `6b99c5790`:

- `AnalysisSizes.previewBound(display)` and `AnalysisSizes.beside(target, offered, bound)`: CameraX's
  rule as a pure function. On the emulator's sizes and its 320 x 640 display it answers 640x480, as
  the run showed; on a 1080 x 2340 display 1024x768; on a phone's list 1280x960, or 1440x1080 when
  1280x960 is missing; `null` when no offered size is inside the class. The binding still leaves the
  choice to CameraX, which applies the same rule; the function is the tests' and the device test's
  statement of it.
- `AnalysisSizes.barcodeRead(width, height, rotation)`: `STREAM` for a long side of 1,280 px or more;
  else `NARROW` while the guide (90% of the upright width, `DocumentGuide.GUIDE_SHARE`) spans the
  calibration's 512 px; else `NONE`. The emulator's 640x480 frame held upright gives a 432 px guide:
  `NONE`.
- `BarcodeReadSink`: between the analyzer and the relay; the first frame a reader takes on a barcode
  side tells the camera what it can carry, once a session.
- `CameraXCaptureCamera.barcodeRead` holds it; a shortfall is logged by a literal code,
  `camera.barcode_analysis_narrow` or `camera.barcode_analysis_unreadable` (debuggable hosts only).
- `AnalysisTarget.of(kind, barcodeBearing)`: the barcode width only on the side the server marks
  (`isBarcodeBearing`: a back, or a front-only ID's front), as C201.2 says. Before, every back was read
  at four times the pixels, and a front-only ID's barcode side was not.

One test case left with GREEN: the enum first carried each log code as a value, and `LogScanTest`
requires a string literal at every `SdkLog.log` call, so the codes are literals in the camera and the
"log code" case was removed from `AnalysisSizesTest`. `AnalysisTargetTest`'s back case changed with the
plan's C201.2 (rule 12): a back is `BARCODE` only when barcode-bearing.

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.camera.*' --tests 'dev.openverify.sdk.ui.CaptureScreen*' -i
BUILD SUCCESSFUL in 2m 40s          exit 0 in 161 s; load 4.47 4.81 4.40
```

(The run before it failed one case, `previewBound(1080 x 1920)`: a display of exactly 1080p's area is
1920 x 1080, as `isSmallerByArea` reads it; fixed before the commit.)

**The document guidance on a barcode side's frame** (`358b43c7d`, `BarcodeSideCostTest`, thread CPU,
median of 11, three runs): 10.9, 10.9 and 9.8 ms at 640x480; 44.3, 40.7 and 39.8 ms at 1280x960. On the
host that is a third of the 125 ms interval, and the test holds it under half. A phone is slower than
this host by a factor nobody measured, so "well under the interval" is not shown for a device. Two
things limit it: since this fix the 1,280 px frame is asked only on a barcode-bearing side (a retry
after `barcode_not_found`), and frames are sampled with only the latest kept, so a slow frame lowers
the guidance rate and breaks nothing. Giving the document gates a 640 px copy needs an edit of
`DocumentFrameAnalyzer`, which is not carry-10c's file: it is in the report's contractDeviations.

**The device test** (`09d8ec4d1`), `CameraXFramePipelineTest.theBarcodeSideIsReadAtLeast1280Wide...`:
the 1,280 px requirement is unchanged. Before any size assertion it now logs, under
`OpenVerifyCameraTest`:

```
barcode analysis <w>x<h> rotation <r>: <ms> ms a copy; guide crop <w>x<h> of <largest>: <ms> ms
barcode side: offered [<sizes>]; display <w>x<h>; the preview class allows <size>; the SDK knows <STREAM|NARROW|NONE>
```

New assertions: the SDK's `barcodeRead` is the frame's; the frame is no smaller than the preview class
allows. It compiles (`:openverify-sdk:assembleAndroidDeviceTest`, exit 0, 36 s).

**On the CI emulator this test will still fail at the 1,280 px assertion**, after printing both lines:
that camera has no 4:3 size of 1,280 px inside any display's preview class. No display change alone
fixes it, so no `ci.yml` profile change is proposed. What would pass: a device whose camera lists a
4:3 size of 1,280 px or more inside its preview class (a phone), or an orchestrator amendment of the
requirement to "the largest size the preview class allows" (the test already asserts that). carry-10c
may not weaken the assertion and did not.

**Texts corrected:** `AnalysisTarget.kt`'s KDoc (no "every camera runs" claim), `CameraXCaptureCamera`'s
KDoc, `docs/android/capture.md` (`818ad32b3`, a borrowed edit: the table row, a new bullet, the
"barcode found" paragraph's last sentence, which also no longer says CI checks it). The plan's Stage 2
sentence was withdrawn by the decisions section already.

## 3. KP10-23: one constant for the 1,280 px barcode width

**RED** `b8943ffca`: `BarcodeWidthConstantTest` (a source scan of `commonMain` `camera/` and
`capture/`, comments left out) and a value case in `AnalysisTargetTest` (the two widths are
`document-capture.json`'s; it passed already, as the item says).

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.camera.BarcodeWidthConstantTest' --tests 'dev.openverify.sdk.camera.AnalysisTargetTest' -i
BarcodeWidthConstantTest > only one declaration of the capture code holds the barcode width's literal() FAILED
    expected: <[capture/document/DocumentCaptureConstants.kt]> but was: <[camera/AnalysisTarget.kt, capture/barcode/BarcodeGuidance.kt, capture/document/DocumentCaptureConstants.kt]>
5 tests completed, 1 failed          exit 1 in 93 s; load 4.02 4.22 4.22
```

**GREEN** `fbe9f2302`: `AnalysisTarget.DOCUMENT` and `BARCODE` take
`DocumentCaptureConstants.ANALYSIS_WIDTH_PX` and `BARCODE_ANALYSIS_WIDTH_PX`;
`Pdf417Guidance.ANALYSIS_WIDTH_PX` equals the second. The value stays 1,280; `document-capture.json`
is unchanged, so the vision tests were not needed.

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.camera.*' --tests 'dev.openverify.sdk.capture.*' -i
BUILD SUCCESSFUL in 2m 13s          exit 0 in 134 s; load 4.75 4.38 4.27
```

## 4. Borrowed edits (rule 1; each file's `git status --porcelain` was empty first)

| File | Change | Commit |
|---|---|---|
| `capture/barcode/BarcodeGuidance.kt` | `Pdf417Guidance.ANALYSIS_WIDTH_PX` refers to the one constant | `fbe9f2302` |
| `capture/document/DocumentCaptureConstants.kt` | the KDoc of `BARCODE_ANALYSIS_WIDTH_PX` | `fbe9f2302` |
| `docs/android/capture.md` | the analysis-size lines | `818ad32b3` |

No build file, lockfile, manifest, workflow, schema, string, permission, dependency or public
declaration changed.

## 5. Device proofs open (rule 28)

- device proof open: `CameraXFramePipelineTest.theBarcodeSideIsReadAtLeast1280WideAndItsCopyIsMeasuredAgainstAFullResolutionCrop`:
  that a camera listing a 4:3 size of 1,280 px inside its preview class gives it beside the still; that
  the SDK's `barcodeRead` is the frame's on a device; both copy costs on a device (F11). On the CI
  emulator it fails at the 1,280 px assertion by the camera's size list.
- device proof open: `IntegrityProbesDeviceTest.theProbesAnswerWithinTheBoundAndTheCiEmulatorReportsItself`:
  the 500 ms bound, the 50 ms target, each read's share of the time, and C210.6's emulator indicator;
  none proved on a device yet.

## 6. The final gates (rule 24: the Android gate's calls (1) to (6), and `pnpm format:check`)

Run in the shared tree after the last code commit (`fbe9f2302`), each its own foreground call under
the Gradle lock. `contracts-10c` was committing and editing beside these calls, so the tree held its
uncommitted NFC work too.

| Call | Command | Exit | Lock wait | Run | Load after |
|---|---|---|---|---|---|
| (1) ui | `:openverify-sdk:testAndroidHostTest -PhostTestGroup=ui` | 0 | 38 s | 100 s | 5.47 |
| (1) flow | `... -PhostTestGroup=flow` | 0 | 67 s | 20 s | 2.79 |
| (1) rest | `... -PhostTestGroup=rest` | 0 | 88 s | 85 s | 2.53 |
| (2) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | 0 | 0 s | 65 s | 8.71 |
| (3) | `koverVerify checkKotlinAbi` | 0 | 6 s | 148 s | 4.59 |
| (4) | `testDebugUnitTest assembleDebug` | 0 | 0 s | 100 s | 16.57 |
| (4) | `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 0 s | 97 s | 8.98 |
| (5) | `:openverify-sdk:assemble` | 0 | 0 s | 104 s | 8.94 |
| (5) | `lint` | 0 | 0 s | 182 s | 6.94 |
| (6) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 0 s | 31 s | 7.68 |
| | `pnpm format:check` | 0 | | | 4.81 |

Calls (1) flow and (1) rest first failed only on `contracts-10c`'s work in progress, none of it in
carry-10c's paths, and passed when run again with nothing of carry-10c's changed:

- flow: `NfcStepHooksTest` (3) and `StepRegistryTest` `[12] nfc` (4 failed of 402), then
  `NfcStepHooksTest` (1 of 402), then exit 0;
- rest: `NfcWireModelTest` (3 of 1,532), then `WireModelTest` (1 of 1,532), then exit 0;
- an earlier call (1) ui stopped at compiling `ContractFixturesTest.kt` (its edit in progress), then
  passed.

**Host-test count.** 2,321 at `f71b0f6d`. These calls ran 450 + 402 + 1,532 = 2,384, none skipped:
carry-10c added 40 (`IntegrityProbesReadsTest` 24, `ContextDeviceProbeCostTest` 1, `AnalysisSizesTest`
11, `BarcodeSideCostTest` 2, `BarcodeWidthConstantTest` 1, `AnalysisTargetTest` 3 to 4), and the other
23 were `contracts-10c`'s at that moment. With carry-10c alone the count is 2,361. The ABI dumps did
not change (`checkKotlinAbi`, exit 0); no golden was recorded.

## 7. Checkpoint

Checkpoint 1 is the commit that adds this section: "Workflow 10C carry-10c checkpoint 1".
