# NFC on Android

How the SDK runs an `nfc` step: reading the chip of an electronic passport or ID card and sending its files to the server (Phase 10, Workflow 10C; plan C207, C208). **The device reads and the server verifies** (ADR 0009). Passive Authentication, Active Authentication over the server's nonce, the chip-to-MRZ and chip-to-selfie bindings and the repeat check are the server's ([NFC checks](../checks/nfc.md)); nothing the device says about the read passes or fails anything.

## What ships in this release

- **The step is built:** the access key, the tap screen, progress, retries, the review of the chip's data, upload and submit, the screens for a phone or app that cannot read a chip, and the route that lets such a person take the operator's fallback.
- **The reader is built** (Workflow 10E), in the optional `openverify-nfc` module: `OpenVerifyNfc.chipReader(context)` gives the `ChipReader` your app installs. It reads with JMRTD over the phone's NFC reader mode: PACE where the chip offers it, otherwise Basic Access Control, then Chip Authentication where offered, the files the server takes, and Active Authentication over the server's nonce. The module's README ([`android/openverify-nfc/README.md`](../../android/openverify-nfc/README.md)) says what a read does, what the module depends on and what an app that adds it takes on (the libraries are LGPL).
- **What proves the reader, and what does not.** It is proved **on the build host only**: by host tests of its protocol order over a scripted chip, and by a JVM test that drives JMRTD's real service against an in-process synthetic chip (the Utopia test chip, which is also the server's sandbox chip) with Basic Access Control, secure messaging, the file reads and Active Authentication. Its device test ran on one phone (a Pixel 9, Android 17) with NFC on and no chip near it: reader mode is taken for the tap screen and released on every way out.
  - **PACE and Chip Authentication run in no automated test**: the synthetic chip implements neither.
  - **No real document has been read.** The owner's read of a real passport or identity card on a real phone, in the demo's reader check (pass or fail only; nothing sent or stored), is a step of the release gate and is still open.
  - The minified demo with the module was built and inspected, not run against a chip.
- **A production `nfc` step should still have a fallback.** Give the step an `exhausted` fallback (publish warns `nfc_fallback_missing` when it has none): phones without NFC, and documents the reader cannot open, need it. Without one, such a session stops at the step with "continue later".
- **The sandbox test chip** (below) still completes the step with no reader and no document, in a sandbox environment. It proves the screens, the flow and the server's checks. It does not prove a reader.

## Requirements

- An OpenVerify server with Workflow 10C's routes (`client-unable`, and `sandbox-chip` in a sandbox).
- For a real document: a `ChipReader` installed through `OpenVerifyAndroid.install(OpenVerifyComponents(chipReader = OpenVerifyNfc.chipReader(context)))`, once, when the process starts, and the `NFC` permission, which `openverify-nfc` declares with `android.hardware.nfc` not required. The core SDK declares neither, so an app without the module asks for no NFC permission.
- **One packaging line in an app that adds `openverify-nfc`.** Both Bouncy Castle jars carry a licence text at the same path, and the packager refuses two files at one path; a library cannot set this for its host:

  ```kotlin
  android { packaging { resources { pickFirsts += "META-INF/LICENSE.md" } } }
  ```

  The app needs no R8 rule for the module: its consumer rules travel in the AAR, with the LGPL and GPL licence texts and the module's `NOTICE` (under `META-INF/openverify-nfc/`).
- The flow must have a `selfie` step before the `nfc` step, and a `government_id` step when it has one at all ([NFC checks](../checks/nfc.md#the-step-and-the-flow-api)).

## The sequence

1. **The verification.** The SDK creates or reuses the step's `government-id-nfc` verification.
2. **The access key.** A chip answers only to a key printed on the document.
   - When the flow has a decided government ID read from a passport or card MRZ, the server prefills the three values the key is made of (document number, date of birth, date of expiry) and the person types nothing. The server sends them only to an SDK session, only while the `nfc` step is the current one, and never to the web flow.
   - Otherwise the person types the three values, or, for a card that offers it, the six-digit card access number (CAN).
   - The key is derived in shared code from ASCII characters only, whatever the device's language. The entry fields offer no autofill, ask the keyboard not to learn, and are never saved.
3. **"I'm ready".** The tap screen shows where the chip is and an "I'm ready" action, and the person may take as long as they need. **The SDK asks the server for a chip challenge only when the person presses it**, and turns the reader on then, so one tap covers access, reading and the chip's signature.
   - A challenge lasts five minutes. One that expires unused returns the screen to "I'm ready".
   - The SDK asks for at most nine challenges per run of the step, below the server's own limit. The count is held in memory, so it starts again when the app is relaunched; across relaunches the server's own limit per verification is what holds, and the SDK answers its refusal by reading the session. When the ninth is spent the screen says why and offers "use another way" (when the flow has a fallback) or "continue later".
4. **The tap.** The reader connects, reads the files and lets the chip sign the server's nonce (Active Authentication), reporting progress by file. The phases read "connecting", "reading", "signing the check code" and "read; we will check it now". **No phase says "verified", "authentic" or "genuine", and no success mark is shown before the server decides.**
   - A lifted document shows "keep it still" and the read starts again within the step's attempts.
   - The reader is on only while the tap screen is in front, and the screen stays on while it is.
   - Only files the server takes are read: the security object, DG1, DG2 and, when present, DG14, DG15, COM and CardAccess. DG11 and DG12 are never read. `openverify-nfc`'s reader does not read CardSecurity (its library gives no protected route to that file after PACE); the server takes that file only when a client sends it. An optional file that is empty, or a CardAccess that cannot be parsed, is treated as absent, so the MRZ key still opens such a chip with Basic Access Control.
   - The reader's own backstops are 5 minutes of waiting for a document, 5 minutes for a read once a chip answers and 5 s for one exchange. The SDK's step ends a waiting read itself when the challenge ends.
5. **The review.** The SDK reads DG1 on the device and shows the name, document number, nationality and dates for the person to confirm **before anything is uploaded**. The chip's portrait is not shown (Android has no JPEG 2000 decoder, and the SDK does not decode DG2).
   - "This is not my data" allows one new read in the same attempt. A second refusal cancels, and the inquiry stays resumable. Nothing is uploaded in either case.
6. **Upload and submit.** Each file goes up with its kind, then the submit carries the challenge, the chip's signature when there is one, and the reader's device report. If the challenge expired during a slow upload, the server answers 409 `chip_challenge_invalid` and the SDK asks for one more tap with a new challenge.
7. **The decision.** The SDK polls the verification, reads the session and renders the position the server returns. The server counts attempts (`maxAttempts`, 3 by default) and decides whether a retry, a fallback or a failure follows.

Each phase is announced once in a polite live region. A relaunch after process death starts again from the tap: nothing read is restored.

## When the phone or the app cannot read a chip

The SDK checks what the phone offers before any read (`PackageManager.FEATURE_NFC` and `NfcAdapter`, which need no permission) and whether a reader is installed. Each case has its own screen:

| Case | The screen says | Reported as |
|---|---|---|
| No `ChipReader` is installed | This app cannot read document chips | `reader_not_installed` |
| The phone has no NFC | This phone cannot read document chips | `nfc_unavailable` |
| NFC is off | NFC is off, with a shortcut to the system's NFC settings. The person may turn it on, or choose another way | `nfc_disabled_declined`, only if they choose another way |
| Nine chip challenges were used without a finished read | The document could not be read, with why | `read_failed`, only if they choose another way |

- **With a fallback.** When the server says the step has one (`fallbackAvailable`), the screen offers "use another way". The SDK then reports the reason (`POST /api/v1/flow/verifications/:id/client-unable`), the server ends the verification as `canceled` and leaves the step through the flow's `exhausted` edge, and the SDK renders the next position: usually the operator's document step.
- **Without a fallback** the screen offers only "continue later", which cancels and leaves the inquiry resumable.
- **A report is self-asserted.** Nothing proves that a phone has no NFC, and the web flow can always say a browser cannot read a chip. So an inquiry that left an `nfc` step this way **goes to review** when it completes. The one exception is a step whose `onFallback` is `continue` in a published version that carries the acknowledgement `client-unable:<step id>`: the operator then accepts that anyone may skip the chip. Publish asks for that acknowledgement, beside `fallback:<step id>`, whenever an `nfc` step's fallback continues; a version published before with `fallback:` alone still sends such an inquiry to review. The person is never told which of the two happens.
- The report is accepted once per verification and only at the current `nfc` step; anything else is a 409 `client_unable_not_allowed`, which the SDK answers by reading the session. It never passes a check.

The web flow shows the same step as "reading a document chip needs the organisation's app; a browser cannot read it", with "use another way" under the same rules (reason `platform_unsupported`).

## The sandbox test chip

In a sandbox environment whose trust store holds the sandbox test anchor, the server marks the step `sandboxChipAvailable` and the tap screen offers **"Test chip (sandbox)"**, beside an installed reader or alone. The SDK never guesses the environment.

- Choosing it asks the server to build a synthetic chip for this verification (`POST /api/v1/flow/verifications/:id/sandbox-chip` with the challenge and a scenario). The rest of the sequence is the real one: the review, the uploads, the submit and the server's checks.
- **Scenarios:** `match` (every required check passes), `mrz-mismatch`, `face-mismatch`, `no-active-authentication` and `tampered-dg1`, each ending as the server's checks say.
- **No image leaves the server.** The chip's portrait is attached to the verification on the server, from the stored selfie. The device receives every other file and uploads those through the real route.
- `face-mismatch` exists only where the server is given the directory of generated fixture faces (`OPENVERIFY_SANDBOX_CHIP_FACES`, pointing at `fixtures/generated/selfie/`, which `services/vision/tools/make_synthetic_fixtures.py` writes on a development host from the pinned public-domain faces); elsewhere it answers 422 `sandbox_chip_scenario_unavailable`. Without the test anchor the route answers 409 `sandbox_chip_anchor_missing`: install it with `pnpm --filter @openverify/api trust:sandbox-utopia` ([NFC checks](../checks/nfc.md#the-sandbox-test-chip)).
- The route does not exist in a production environment, and the verification is labelled as read from a sandbox test chip for operators.
- **What it proves:** the flow, the screens and the server's checks. **What it does not:** that any reader can read any document.

## What the device reports

With the submit, the reader may send a device report: which protocols it tried (`bac`, `pace`, `pace-cam`, `chip-authentication`, `active-authentication`), how each ended, and the read time. It is client-reported, shown to operators only, and never evidence: the server cannot verify the access protocol or Chip Authentication from outside the chip, so it ignores what a client says about them and judges only what it can check itself (the signed files, and the chip's signature over its own nonce).

## Privacy

- The access key, the challenge and the chip's files are held in memory only: never in a file, a preference, saved state, a log line, an event or a result. The files are dropped after the submit.
- The MRZ and CAN entry and the review screen sit behind `FLAG_SECURE`, are hidden from accessibility services that are not declared as tools on Android 14 and later, and ignore touches through an overlay on Android 8 to 11.
- A `ChipReader` your app installs receives the key and returns the files: it must process them on the device only ([privacy](privacy.md)).

## Time limits (WCAG 2.2.1)

The only limit on this step is the chip challenge's five minutes, which **starts when the person presses "I'm ready"** and is renewed on request by pressing it again. Nothing times a person out while they find their document or read the instructions.

## Writing a chip reader

`ChipReader` is a public interface with one method, `read(access, challenge, progress)`, which returns the files, the chip's signature over the challenge and a device report, or throws `ChipReadException` with one of `TAG_LOST`, `ACCESS_DENIED`, `UNSUPPORTED_DOCUMENT`, `TIMEOUT`, `NFC_DISABLED` and `READER_BUSY`. The method and every type it names need `@OptIn(ExperimentalOpenVerifyApi::class)`: the seam's fit for the iOS reader is not yet verified, so it may change before 1.0. A reader's exceptions must carry a fixed message, never a chip value.

## Limits

- No conformance with ICAO or BSI test specifications is claimed.
- Nothing here has been run against a real document. The reader is proved on the build host against a synthetic chip; PACE and Chip Authentication run in no automated test. The owner's read of a real document on a real phone, in the demo's reader check, which sends and stores nothing, is an open step of the release gate.
- The reader does not check the checksums of the chip's protected answers on the device (its library's default). The server's Passive Authentication is what holds the bytes.
- The translations of the NFC screens outside English are machine-drafted ([themes and languages](themes-and-languages.md#languages-c199)).
