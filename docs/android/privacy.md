# Privacy and Google Play Data safety

What the Android SDK sends, where it sends it, what stays on the device, and the Google Play Data safety category of every member it puts on the wire (Phase 10; plan C213, decision 66). **The device reads and reports; the server judges** (ADR 0009). No personal data leaves the SDK except to the flow API of the server your app names: nothing goes to OpenVerify's authors, to Google or to any third party, and the SDK holds no analytics or crash reporter.

**The final Data safety answers are yours.** The host app's developer fills in Google Play's form, and the operator of the OpenVerify server decides purposes and retention. The table below says what this SDK version sends so that you can answer accurately; it is not legal advice, and the form's wording changes, so check each entry against Google's current guidance.

The SDK's own README (`android/openverify-sdk/README.md`) holds the short form of this page: what the SDK reads per signal tier, what it never reads, the permissions and one Data safety row per category. This page is the member-by-member record behind it.

## Where the data goes

- **One destination.** Every request goes to the `apiBaseUrl` compiled into your app, over https. A one-time link never chooses the API ([integration guide](integration.md#the-two-contracts)). Redirects are never followed, so the session token is only ever sent to that origin.
- **Plain http** is accepted only to `localhost`, `127.0.0.1`, `::1` and `10.0.2.2`, and only in a debuggable build of your app ([integration guide](integration.md#plain-http-to-a-loopback-server)).
- **Trust** follows your app's network security configuration, which the SDK runs inside and cannot override. Keep system trust anchors only and cleartext off in release builds; a configuration that trusts user-installed certificate authorities makes the SDK trust them too.
- **Your own code sees the data too.** A transport you install carries every request, a `ChipReader` receives the MRZ or CAN, and a `FaceDetector` receives every selfie frame: see "Components and clients you install" in the SDK README.

## What stays on the device

- **Analysis frames, face boxes and landmarks, decoded barcode bytes.** The capture guidance reads them for one frame callback and writes over them; none is logged, saved or sent ([capture](capture.md)). With a face detector installed, the detector computes face boxes and landmarks on the device for every analysed selfie frame, after consent and only on the selfie capture screen, so that an operator can describe it in a biometric notice.
- **With `openverify-face`** the detection is ONNX Runtime running the YuNet model inside your app's process. The module removes ONNX Runtime's telemetry content provider from the merged manifest, sets `ORT_DISABLE_TELEMETRY=1` before it creates the runtime, and switches telemetry off before each session. On one phone (a Pixel 9, Android 17) no ONNX Runtime telemetry class was loaded and no file appeared, in a new process and again after a restart. On one phone (a Pixel 9, Android 17, awake, unlocked and on charge; commit `d6af3cc37`, 2026-11-11) the app's byte counters did not move, 0 bytes received and 0 sent, from before a new process existed, through the first ONNX Runtime environment, eight frames of inference and the detector's close, to the end of a 124-second quiet period, and again in a second new process after a restart. **That is the measured window on that phone, never "nothing is ever sent"**: no emulator, no other device and no longer period has been measured. If your app itself uses ONNX Runtime, your own configuration governs ([its README](../../android/openverify-face/README.md)).
- **With `openverify-nfc`** the chip's files are read into memory by the reader and exist only in the result it returns to the SDK; the module writes no file, preference or log line with them, and turns the logging of the libraries it uses off for the read.
- **Typed values, photos, chip files and tokens live in memory only.** Nothing is written to files, preferences, a cache or saved state, so a backup holds none of it, and after process death the flow resumes at the server's position with empty fields. Chip files are dropped after the submit.
- **Logs.** The SDK logs only constant codes, and only in a debuggable build of your app. No value, MRZ, CAN, chip byte, image, token or server message is ever logged, and every exception the SDK lets reach your app carries a code and a fixed message.
- **Events and results** carry no field value, token, image, chip byte or step id ([events](events.md), [failure reasons](failure-reasons.md)).
- **The device's own facts** are read only after consent and only under the tier the server reports for the session; the README lists each read and what is never read.

## The wire members and their Data safety categories

One row for each member the SDK sends, by request. The host test `WireDataSafetyTableTest` (`android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/docs/`) fails when a header, a query member, a body member or a file part the SDK's client sends has no row here, when a row names something the SDK does not send, and when the README's Data safety table and this one name different categories. It reads what the real client encodes, every member of the request models (optional ones included) and the committed request fixtures (`contracts/fixtures/flow-requests/android/`).

How to read it:

- **Category** is Google Play's data-type group, from a fixed list: Photos (Google's "Photos and videos"), Personal info, Financial info, Files and docs, App activity, App info and performance, Device or other IDs. **None** marks a member that carries no data about the person or the device: an identifier the server issued, a protocol constant, a credential.
- Every category here is our reading of the closest group; the README names the closest type inside each.
- `:id` is the verification's id, `a.b` a member of an object, `a[].b` a member of each array item, and `values.*` the screen's values by the field keys the operator's template names.
- A member the server marks **client-reported** is stored and served as what the client said, never as a result.

<!-- wire-members:start -->

| Request | Members | Category | What it is, and when it is sent |
|---|---|---|---|
| Every request | `Authorization` | None | The inquiry's session token, a short-lived credential your server created. Not sent with the one-time-link redemption, which has no session yet |
| Every request | `User-Agent` | None | `OpenVerify-Android/<SDK version>`: the SDK's name and version, nothing about the device |
| Every request | `OpenVerify-Flow-Spec`, `Accept` | None | Protocol constants |
| `POST /api/v1/flow/one-time-links/redeem` | `inquiry-id`, `one-time-token` | None | The inquiry and the one-time token from the link, redeemed once for a session |
| `GET /api/v1/flow/session` | (no body) | None | Reads the server's position |
| `GET /api/v1/flow/verifications/:id` | (no body) | None | Polls a verification |
| `GET /api/v1/flow/theme-assets/:id` | (no body) | None | Fetches the operator's logo or a screen image |
| `POST /api/v1/flow/consent` | `accepted`, `text-keys`, `optional-text-keys`, `locale` | App activity | Which consent texts the person accepted, which optional ones they ticked, and the language they were shown in |
| `POST /api/v1/flow/consent` | `text-sha256`, `copy-source`, `catalog-version` | App activity | Client-reported evidence of which text version was shown ([consent evidence](themes-and-languages.md#consent-evidence-c200)) |
| `POST /api/v1/flow/screens/:stepId/submit` | `values.*` | Personal info | What the person typed or chose on an operator's screen. The operator's template decides the fields, so it may add types beyond Personal info |
| `POST /api/v1/flow/screens/:stepId/submit` | `button` | App activity | Which of the screen's buttons was pressed |
| `POST /api/v1/flow/share-consents/:stepId/accept` | `text-sha256`, `biometric-text-sha256`, `explicit-biometric` | App activity | Workflow 11A: that the person agreed to a share, the digest of each server-composed text shown, and the separate biometric tick. No token, connection or record id is sent |
| `POST /api/v1/flow/share-consents/:stepId/decline` | (no body) | App activity | Workflow 11A: that the person chose not to share; the flow goes on |
| `POST /api/v1/flow/share-consents/:stepId/withdraw` | (no body) | App activity | Workflow 11A: that the person withdrew an agreement they gave in this session; the flow stays where it was |
| `POST /api/v1/flow/verifications` | `type` | None | The verification type the current step asks for |
| `POST /api/v1/flow/verifications` | `country`, `id-class` | Personal info | The issuing country and document class the person chose for their ID |
| `POST /api/v1/flow/verifications/:id/selfies` | `method` | App activity | `camera` or `upload`: how the selfie will be taken. Client-reported |
| `POST /api/v1/flow/verifications/:id/files` | `kind` | None | Which file this is (`front`, `selfie-left`, `document`, `chip-dg1`, …) |
| `POST /api/v1/flow/verifications/:id/files` | `file` | Photos | Kinds `front`, `back`, `portrait`, `selfie-center`, `selfie-left`, `selfie-right`: the ID photos and the selfie poses, upright JPEG without EXIF |
| `POST /api/v1/flow/verifications/:id/files` | `file` | Files and docs | Kind `document`: a supporting document's page (a photo or a PDF) |
| `POST /api/v1/flow/verifications/:id/files` | `file` | Photos | Kind `chip-dg2`: the portrait stored on the document's chip. With the sandbox test chip the device never holds or sends it |
| `POST /api/v1/flow/verifications/:id/files` | `file` | Personal info | Kinds `chip-dg1`, `chip-sod`, `chip-dg14`, `chip-dg15`, `chip-com`, `chip-card-security`, `chip-card-access`: the chip's files as read. DG1 holds the name, document number, nationality, date of birth and expiry; the others are the issuer's signed security data and the chip's public keys. Only with an NFC step and a chip reader |
| `POST /api/v1/flow/verifications/:id/files` | `capture-method`, `capture-trigger` | App activity | `camera` or `upload`, and `auto` or `manual`: how the photo was taken. Client-reported |
| `POST /api/v1/flow/verifications/:id/files` | `capture-id`, `nonce` | None | The selfie capture the server opened, and its nonce |
| `POST /api/v1/flow/verifications/:id/files` | `client-elapsed-ms` | App activity | Milliseconds from the capture's start to this pose. Client-reported |
| `POST /api/v1/flow/verifications/:id/submit` | (no body) | None | Submits an ID or a document verification |
| `POST /api/v1/flow/verifications/:id/submit` | `capture.id`, `capture.nonce` | None | The selfie capture being submitted |
| `POST /api/v1/flow/verifications/:id/submit` | `capture.device.label`, `capture.device.settings.width`, `capture.device.settings.height`, `capture.device.settings.frame-rate`, `capture.device.settings.facing-mode`, `capture.device.settings.resize-mode`, `capture.device.capabilities.width-max`, `capture.device.capabilities.height-max`, `capture.device.capabilities.frame-rate-max`, `capture.device.capabilities.facing-modes`, `capture.device.frame-stats.delivered`, `capture.device.frame-stats.discarded`, `capture.device.frame-stats.total`, `capture.device.webdriver`, `capture.device.image-mirrored` | App info and performance | The selfie camera's facts (the camera snapshot): the camera's id as its label, the stream's size, frame rate and facing, the frames counted, and whether the photo is mirrored. Client-reported, for risk signals only |
| `POST /api/v1/flow/verifications/:id/submit` | `crypto.challenge-id`, `crypto.scheme`, `crypto.signed-message` | None | The wallet challenge the server issued, the signature scheme and the challenge text as signed |
| `POST /api/v1/flow/verifications/:id/submit` | `crypto.signature` | Financial info | The signature the person pasted, which shows control of their wallet |
| `POST /api/v1/flow/verifications/:id/submit` | `chip.challenge-id`, `chip.nonce` | None | The chip challenge the server issued |
| `POST /api/v1/flow/verifications/:id/submit` | `chip.active-authentication-response` | Personal info | The chip's signature over the server's nonce: evidence bound to the person's document. Only when the chip has an Active Authentication key |
| `POST /api/v1/flow/verifications/:id/submit` | `chip.device-report.protocols[].protocol`, `chip.device-report.protocols[].outcome`, `chip.device-report.read-ms` | App info and performance | Which chip protocols the reader tried, how each ended, and the read time. Client-reported: shown to operators only, never evidence |
| `POST /api/v1/flow/verifications/:id/otp` | `phone-number`, `email-address` | Personal info | Where the person asked for their code to be sent |
| `POST /api/v1/flow/verifications/:id/otp/confirm` | `code` | None | The one-time code the person typed |
| `POST /api/v1/flow/verifications/:id/inputs` | `name-first`, `name-middle`, `name-last`, `birthdate`, `address-street-1`, `address-street-2`, `address-city`, `address-subdivision`, `address-postal-code`, `address-country-code`, `identification-number`, `phone-number`, `email-address`, `issuing-authority`, `issue-date`, `expiration-date` | Personal info | What the person typed on a database or driving-licence lookup step |
| `POST /api/v1/flow/verifications/:id/inputs` | `business-name`, `country-code`, `registration-number`, `lei`, `website-url`, `associated-persons[].name-first`, `associated-persons[].name-last`, `associated-persons[].birthdate` | Personal info | A business's details and the people associated with it, on a business lookup or website step. The business's own details are personal data where the business is a person's own |
| `POST /api/v1/flow/verifications/:id/crypto-challenges` | `chain-id` | None | The chain the person chose |
| `POST /api/v1/flow/verifications/:id/crypto-challenges` | `wallet-address` | Financial info | The wallet address the person pasted |
| `POST /api/v1/flow/verifications/:id/chip-challenges` | (no body) | None | Asks for a chip challenge when the person presses "I'm ready" |
| `POST /api/v1/flow/verifications/:id/client-unable` | `reason` | App info and performance | Why this app or phone cannot read a document chip (`nfc_unavailable`, `reader_not_installed`, `nfc_disabled_declined`, `read_failed`). Client-reported: self-asserted, never a pass |
| `POST /api/v1/flow/verifications/:id/sandbox-chip` | `challenge-id`, `scenario` | None | Sandbox environments only: asks the server to build a synthetic test chip. Never sent to a production environment |
| `POST /api/v1/flow/selfie-captures/:id/extend` | (no body) | None | "More time" on a selfie capture |
| `POST /api/v1/flow/signals` | `platform`, `collector-version`, `screen`, `sequence` | None | `android`, the collector's version, the step the body was read at and a counter |
| `POST /api/v1/flow/signals` | `android-integrity.debugger-connected`, `android-integrity.app-debuggable` | App info and performance | The debugger facts. Session-integrity tier, after consent |
| `POST /api/v1/flow/signals` | `android-integrity.emulator-indicators`, `android-integrity.root-indicators`, `android-integrity.hooking-indicators` | App info and performance | The codes the device-integrity probes found, from fixed lists; never a path, file content, class name or build value. Session-integrity tier, after consent ([device integrity](device-integrity.md)) |
| `POST /api/v1/flow/signals` | `android-recognition.android-id` | Device or other IDs | `Settings.Secure.ANDROID_ID`. Device-recognition tier only; the server keeps only a keyed hash |
| `POST /api/v1/flow/signals` | `device-class` | App info and performance | `smartphone` or `tablet`, from the screen's smallest width. Either tier |
| `POST /api/v1/flow/signals` | `sandbox-outcome` | None | `bot` or `human`, only when the host app asks for it and only to a sandbox session. Never read from the device |
| `POST /api/v1/flow/integrity-challenges` | (no body) | None | Asks for a Play Integrity request hash, only when the session asks |
| `POST /api/v1/flow/integrity-tokens` | `challenge-id` | None | The challenge the server issued |
| `POST /api/v1/flow/integrity-tokens` | `token` | App info and performance | The token your own `IntegrityTokenProvider` returned: Google's attestation of your app and the device. Only with a provider you install |

<!-- wire-members:end -->

What the table cannot say for you:

- **Collected, and whether shared.** The data leaves the device, so Google treats it as collected. It goes only to your OpenVerify server; whether that counts as sharing depends on who runs the server and for whom.
- **Purposes.** Identity verification is fraud prevention, security and compliance; an operator who uses the data for anything else declares that too.
- **Optional or required.** The flow the operator publishes decides which steps a person meets. Device recognition is optional in `consent` mode; the Play Integrity token exists only with a provider you install; chip files only with an NFC step and a reader.
- **What the optional artifacts add to your manifest.** `openverify-nfc`: the `NFC` permission, with `android.hardware.nfc` not required. `openverify-face`: `ACCESS_NETWORK_STATE`, from ONNX Runtime's own manifest, unless your manifest removes it with `<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" tools:node="remove" />`; the module uses no such permission and removes ONNX Runtime's telemetry provider itself. Neither artifact adds a wire member: the table above is the same with and without them.
- **The categories are yours to choose.** The table suggests the closest Google Play category for each member; the declaration is the app owner's.
- **Your own requests.** A Play Integrity provider's request goes from your app to Google and is yours to declare ([device integrity](device-integrity.md#the-host-side-provider-the-recipe)); so is anything a transport, a chip reader or a face detector you install does with what it receives.

## What the protections do not stop

`FLAG_SECURE` on every SDK window keeps the flow out of screenshots, screen recordings and the recents thumbnail. On Android 12 and later other apps' overlays are hidden while the flow is in front, on Android 8 to 11 the consent, capture and submit controls ignore touches delivered through an overlay, and on Android 14 and later the fields that hold personal data are hidden from accessibility services that are not declared as accessibility tools. None of this stops:

- a rooted device or a modified build of your app, which can read the screen and the app's memory;
- an accessibility service declared as a tool, which reads the screen as TalkBack does;
- a host configuration that trusts user-installed certificate authorities, or a transport you install that logs what it carries;
- a person photographing the screen with another device.

The session token is a bearer credential for one inquiry: anyone who holds it can act as the SDK does, including sending the SDK's `User-Agent`. The server therefore never treats what a client reports as proof.

## Retention and deletion

The SDK keeps nothing after the flow ends. On the server, the operator's retention and redaction settings delete or redact every member above with the inquiry; chip files, photos and typed values are encrypted at rest ([NFC checks](../checks/nfc.md#privacy-and-retention)).
