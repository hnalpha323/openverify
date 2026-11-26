# Accessibility on Android

What the Android SDK does for people who use a screen reader, a large font, a right-to-left language or a keyboard, and how each time limit a person can meet is handled (Phase 10, Workflow 10D; plan C212). **No conformance is claimed.** The automated checks described here run on the build host; they read what the SDK offers a screen reader and do not hear what TalkBack says. A person has not yet run the manual pass, so the SDK is "not yet evaluated for conformance" with WCAG 2.2 level AA ([the statement](../accessibility/statement.md), [the audit](../accessibility/android-audit-2026-11-11.md)).

## What the SDK does

- **Names and targets.** Every control has text or a content description, and a touch target of at least 48 dp.
- **Headings and order.** The first thing read on every screen is its heading. A screen step's error summary comes after the heading and before the fields, and takes focus when it appears.
- **Status messages.** A refusal, a request on its way, a capture hint, an NFC phase and the waiting message are polite live regions with words (the screen step's error summary is assertive). Each is announced once per change: a selfie hint only when it has settled, an NFC phase once however often its progress bar moves, and a countdown never.
- **Large fonts.** Every screen scrolls when its words outgrow the window. On the capture screen the preview keeps at least the height its guidance needs, so at a large font the shutter can be below the fold: it is always on the screen's page and reached by scrolling.
- **Right to left.** Arabic lays out from the right. The camera preview, the document and face outlines, the barcode guide and the operator's logo are never mirrored, and a selfie prompt's left and right are the person's own. The SDK draws no icon.
- **Typed secrets.** A typed value is marked sensitive for accessibility services that are not assistive tools on Android 14 and later. That, the window's `FLAG_SECURE` and the hidden overlays are meant to hide nothing from TalkBack; a person confirms it in the manual pass.

## Time limits

Every lifetime below is the server's or the operator's. The SDK adds no time limit of its own: a check of the sources fails the build when a new duration appears that this page does not classify (`A11yTimingTest`).

<!-- lifetimes:start -->
| Lifetime | How long | What the person is told and can do | Host tests |
|---|---|---|---|
| A selfie capture | 180 s from its creation, the server's (`SelfieCaptureProtocol.CAPTURE_TTL`). It is created only once the camera can be shown, so time spent on the camera permission does not count | Each prompt says how many minutes the capture lasts. 20 s before the end a polite live region says how long is left, once, and offers "More time"; each press asks the server for another 180 s. The server grants ten extensions per capture (Phase 9 C171.4) and the SDK sets no limit of its own. When the time runs out, the next photo starts a new capture and the screen says so | `SelfieExtensionTest`, `SelfieGuidanceUiTest`, `CaptureHooksTest`, `A11yAnnouncementsTest` |
| A chip challenge (NFC) | 300 s on the device's clock from the server's answer (`NfcStepController.CHALLENGE_LIFETIME`) | It starts only when the person presses "I'm ready", never while they read the instructions or type the access key. An unused challenge that expires returns the screen to "I'm ready" with a notice, and the next press asks for a new one, up to nine per verification. A read that has already connected is not stopped by the expiry | `NfcStepControllerTest` |
| A one-time code | The server's `expires-at` | The screen counts the minutes left without announcing them. An expired code says so in a live region. "Send a new code" renews it while sends are left; with none left the person can finish the step, which goes to review | `OtpStepScreenTest`, `A11yAnnouncementsTest` |
| A wallet message | The server's `expires-at` | The screen counts the minutes left. An expired message says so in a live region; "Use another wallet" returns to the entry, where a new message is asked for | `CryptoWalletStepScreenTest`, `A11ySweepTest` |
| The session | The operator's setting; the SDK holds no timer for it | When the server answers that the session has expired, the screen says so and closes with the result. The host app asks its server for a new session token and launches again: the inquiry resumes at the server's position (Phase 9 C151.10). Typed values are not kept across a relaunch | `FlowCoordinatorTest` |
| The inquiry and a one-time link | The operator's settings | An expired inquiry and a refused link each have their own screen, which says what to do; nothing on the device can extend them | `FlowCoordinatorTest`, `StatusScreensTest` |
<!-- lifetimes:end -->

**Auto-capture never times a person out of a pose.** The guidance only decides when to take the photo. After 10 s without an automatic photo it makes the shutter the main action and goes on guiding; the capture screen never closes, skips or fails a pose on a timer of its own (`CaptureScreenSlotsTest`, `A11yShutterTest`).

## Durations that are not limits on the person

<!-- durations:start -->
| Where | What | Kind |
|---|---|---|
| `FlowApi.kt`, `FlowCoordinator.kt` | 2 s between two reads of the session while the server decides | A wait. After 60 reads the error screen offers "Try again"; nothing is lost |
| `StepParts.kt` | 1 s between two readings of the clock for a countdown | A display tick |
| `Extension.kt` | The 20 s warning before a selfie capture ends, and 1 s between two readings of the clock | Part of the selfie capture's row above |
| `DocumentCaptureConstants.kt`, `SelfieGuidanceConstants.kt` | 10 s until the shutter becomes the main action; 500 ms of steady measures before an automatic photo; 1.5 s before a selfie hint is announced | Guidance. Nothing ends when they pass |
| `BarcodeGuidance.kt` | 250 ms between two barcode reads; "barcode found" held for 1.5 s | Guidance |
| `FrameRelay.kt` | 50 ms and 1 s waits when a camera frame is handed to the guidance | The frame pipeline. A frame that is not taken in time is dropped |
| `SelfieCapture.kt` | 600,000 ms, the largest elapsed time the SDK reports for a pose | The cap of a reported number, not a limit |
| `FlowHttpPlatform.android.kt` | 15 s to connect, 30 s to read, 60 s to write | The transport. A request that fails shows the error screen with "Try again" |
| `NfcChipReader.kt`, `JmrtdChipSession.kt` (`openverify-nfc`) | 5 minutes of waiting for a document, 5 minutes for a read once a chip answers, 5 s for one exchange with the chip | The optional reader's backstops. The SDK's step stops a waiting read itself when the chip challenge of the row above ends; a read that ends on one of these shows the tap screen's notice and "I'm ready" again; nothing is lost |
<!-- durations:end -->

## What is not proved

- The manual TalkBack, 200% font and keyboard pass has not been run. Its checklist is in [the audit](../accessibility/android-audit-2026-11-11.md).
- On the build host a key event moves no focus, so the Tab order and the focus highlight are checked only by a person.
- Compose 1.11 cannot keep a keyboard from learning what is typed into a secret field (a document number, a code, the MRZ and the CAN), and those fields stay in the autofill structure ([privacy](privacy.md)).
- The two optional artifacts add no SDK screen, state or text (Workflow 10E): `openverify-face` draws nothing, and `openverify-nfc`'s reader is driven by the SDK's own tap screen, which the audit covers. The demo's reader check is a debug-only screen of the demo app, outside the SDK and outside the audit.
- The built-in translations are machine-drafted ([themes and languages](themes-and-languages.md)); an announcement's wording in Spanish, French, German and Arabic has not been reviewed by a fluent reader.
