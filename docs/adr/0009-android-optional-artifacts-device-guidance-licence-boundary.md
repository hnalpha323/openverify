# ADR 0009: Android: optional artifacts, device guidance and the licence boundary

- **Status:** Accepted (Workflow 10A Stage 1a, 2026-11-08). It extends ADR 0002 to the Android SDK, as ADR 0005 did to reports, ADR 0006 to signals, ADR 0007 to workflows and ADR 0008 to flows.
- **Date:** 2026-11-08
- **Related:** ADR 0002 (check tiers and honesty), ADR 0004 (Kotlin Multiplatform), ADR 0006 (signals), ADR 0008 (flows decided on the server); `docs/plans/phase-10.plan.md` C190–C225, decisions 1–72 and its "Orchestrator decisions before Workflow 10A" (Phase 10 P1–P5 decided); `docs/plans/phase-10-review-resolution.md`; `docs/research/phase10-android-behaviour.md`, `phase10-android-engineering.md`, `phase10-inventory.md`.

## Context

Phase 10 turns the Android SDK into a renderer of the server's flow and gives it capture guidance, a chip reader and device-integrity facts. Four things make that risky:

1. **The device sees more than it should judge.** A phone can measure blur, find a face, read a barcode, run a chip protocol and probe for root. If any of those decided a check, a modified app could pass it.
2. **The server decides the path (ADR 0008).** A renderer that chose its own next step, or skipped a step it could not draw, would undo that.
3. **Some capabilities need code that rule 4 does not allow in the core SDK.** The chip reader needs JMRTD and SCUBA (LGPL, two GPL-with-Classpath-exception files), the face detector needs ONNX Runtime (MIT, with MPL-2.0 Eigen compiled in), and Play Integrity needs Google's library under Google's terms.
4. **The SDK runs inside someone else's app.** Whatever it puts in results, events, logs, intents or saved state reaches the host app, its crash reporter and its backups.

## Decision

### 1. The device guides and reports; the server judges

No quality measure, pose, barcode read, chip protocol outcome, integrity indicator or Play Integrity verdict passes or fails anything on the device. Nothing measured on the device is sent as a result. What the device does send (`capture-method`, `capture-trigger`, the integrity indicators, the chip's `device-report`, an integrity token) is labelled **client-reported** wherever the server stores or shows it. The server re-measures every upload, verifies Passive and Active Authentication itself and decodes every integrity token itself.

### 2. The SDK renders what the server's position names

The SDK declares `OpenVerify-Flow-Spec: 2` and renders the client view of the step the session's `position` names. It never evaluates a transition and never advances on its own: after every exit it reads the session (or takes the one the route answered) and renders the new position. A step it cannot render, a client view it cannot decode, a component kind it does not know or a member it cannot honour renders the **unsupported screen**, never a skip. The only rule the device evaluates is a screen's own same-screen visibility, with a strict evaluator that the server runs again.

### 3. `:openverify-sdk` stays Apache-2.0 and depends on no optional artifact

Each optional capability is an interface in `commonMain` that the host installs once, in `Application.onCreate`, through `OpenVerifyAndroid.install(OpenVerifyComponents(...))`:
- `ChipReader` (with `ChipAccess`, `ChipRead`, `ChipDeviceReport`, `ChipProgress`, `ChipReadException`, `ChipReadFailure`, `BacKeySeed`, `FileKind`);
- `FaceDetectorFactory` and `FaceDetector`, returning `YunetOutputs`, the twelve raw tensors, decoded in common code;
- `IntegrityTokenProvider`;
- `FlowTransport`, made only by `OpenVerifyAndroidTransport.okHttp(client)`;
- `OpenVerifyEventListener`, and the sandbox-only `SandboxSignalOutcome`.

No `ServiceLoader`, reflection or startup initializer discovers a component. A Gradle test fails the build if `:openverify-sdk`'s runtime classpath names an optional artifact, JMRTD, SCUBA, cert-cvc, Bouncy Castle, ONNX Runtime or a `com.google.android.play` module. Because every seam is in `commonMain`, the next release's iOS target implements the same interfaces. An absent component has a stated, tested behaviour: no chip reader shows "this app cannot read document chips"; no face detector keeps the manual shutter with the server's prompts; no integrity provider sends no token; no listener builds no event.

### 4. Copyleft or proprietary code lives only in its own artifact

LGPL code lives only in `openverify-nfc`, Google's library only in `openverify-integrity-play`, ONNX Runtime only in `openverify-face`. Nothing ships before the owner's decision on it, and each has a stated outcome if the owner declines.

### 5. No personal data leaves the SDK except to the flow API

No field value, typed value, token, image, chip byte, MRZ or server detail in results, events, logs, intents beyond today's credential extras, saved state, files or exception messages. Results carry how the flow ended on this device, never a verification outcome. Events carry closed codes and step **types**, never step ids. The SDK logs only constant codes through one `SdkLog` object, and only in a debuggable host.

## The artifacts

| Artifact | Licence of its own code | Depends on | Gated by | State on 2026-11-08 |
|---|---|---|---|---|
| `openverify-sdk` | Apache-2.0 | Compose Multiplatform, Ktor, OkHttp (an `api` dependency, because `OpenVerifyAndroidTransport.okHttp(OkHttpClient)` is public), CameraX, zxing-cpp (10B) | — | built in 10A–10D |
| `openverify-nfc` | LGPL-3.0 (Phase 5 C67; decision 30) | `:openverify-sdk`, JMRTD 0.8.9, SCUBA 0.0.21/0.0.27, cert-cvc 1.4.13, Bouncy Castle 1.86 | Phase 10 P1 | P1 granted narrowly; the reader is built in 10E |
| `openverify-face` | Apache-2.0 | `:openverify-sdk`, `onnxruntime-android` 1.31.0 (Eigen inside), YuNet weights fetched with their SHA-256 | Phase 10 P2 | P2 granted narrowly; built in 10E |
| `openverify-integrity-play` | — | `com.google.android.play:integrity` | Phase 10 P3 | **declined**: not built; the README gives a host-side `IntegrityTokenProvider` recipe |
| `openverify-scuba-smartcards` | Apache-2.0 / LGPL-2.1 | — | only if P1 were declined | not needed |
| the Maven Central upload | — | the owner's namespace, Portal token, GPG key, `maven-central` environment | Phase 10 P4 | pending; the release is the staged local repository |

## What each owner decision gates (Phase 10 P1–P5, decided 2026-11-08)

- **P1 (granted, narrowly):** SCUBA's two `GPL-2.0-only WITH Classpath-exception-2.0` files, unmodified, from Maven Central, only inside `openverify-nfc`, with the texts and source location in its `NOTICE` and `THIRD_PARTY_LICENSES.md`. Gates the JMRTD reader (C209, 10E). Until it lands, Android NFC works with the sandbox test chip only.
- **P2 (granted, narrowly):** Eigen (MPL-2.0) unmodified inside the official `onnxruntime-android` AAR, only in `openverify-face`, and likewise inside `onnxruntime-web`'s WASM in the hosted flow (Phase 4 decision 11 settled the same day). Gates `openverify-face` and so selfie auto-capture on Android.
- **P3 (declined):** OpenVerify ships no Google code. The common `IntegrityTokenProvider`, the server's `play-integrity` REST provider and its sandbox are unaffected.
- **P4 (pending):** the Central upload only. Group `dev.openverify` is provisional; the Kotlin packages stay `dev.openverify.*`.
- **P5 (declined):** the 16 KB emulator leg runs on the standard runner; if it cannot boot there it is a release-gate open item, and the per-push 16 KB checks are the proof.

None of these is legal advice.

## The chip seam's iOS fit (C207.3, review H22)

Desk-checked on 2026-11-08 against the documented API of NFCPassportReader, the iOS reader PLAN names, from its README and `PassportReader.swift` on its default branch (no build):
- an external Active Authentication challenge **is** accepted (`readPassport(mrzKey:tags:aaChallenge:…)`);
- the MRZ key fields **are** its `mrzKey` (document number, birth date and expiry with check digits, what `BacKeySeed.mrzInformation` builds);
- CAN access is **not** offered: PACE runs with the MRZ key only, and no parameter takes a card access number;
- the branch read is not a tag named 2.3.3, so 2.3.3's exact surface is unclear.

So the seam's iOS fit is **unverified** for `ChipAccess.Can`, and `ChipReader.read` with every type it names (`ChipAccess`, `ChipRead`, `ChipDeviceReport`, `ChipProgress`, `ChipReadException`, `ChipReadFailure`) carries the opt-in annotation `@ExperimentalOpenVerifyApi` until the iOS release. The `ChipReader` interface itself is not marked, so a host names it in `OpenVerifyComponents` without opting in; implementing or calling `read` needs the opt-in (marking the interface would have made every `OpenVerifyComponents(...)` call need it, since Kotlin checks a constructor's parameter types). A change after 1.0 is then not a break of a stable API.

## Consequences

- A host app adds capabilities by adding an artifact and one `install` call; the core SDK's licence, size and Data safety answers do not change with them.
- Guidance can make capture easier but never makes a result better: a photo the device liked can fail on the server, and the reverse. The README says so.
- An SDK older than the server's next spec version shows the unsupported screen rather than guessing, so a flow an operator changes never silently loses a step on Android.
- The public surface is small (entry points, results, the registry, events and the seams), so the wire model, the flow API and the theme can change without a public signature change; the ABI dump and `android/openverify-sdk/api/expected-public.txt` make any widening visible in review.
