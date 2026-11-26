# OpenVerify on Android

The Android SDK (`android/openverify-sdk`, Kotlin Multiplatform, ADR 0004 and ADR 0009) runs an inquiry's verification flow inside a host app. The server decides every step (ADR 0008); the SDK renders the step the server's position names and never chooses a path. A step it cannot render is shown as unsupported, never skipped.

This folder is the operator and integrator guide. Workflow 10E added the two optional artifacts to it: the chip reader (`openverify-nfc`, [NFC](nfc.md)) and the face detector (`openverify-face`, [capture](capture.md)), each with its own README beside its code (`android/openverify-nfc/README.md`, `android/openverify-face/README.md`). No Play Integrity artifact exists: the owner declined it, and [device integrity](device-integrity.md) gives the host-side recipe. Phase 10 wrote the folder in stages: Workflow 10A wrote the first five pages below, 10B the capture and device-integrity pages, and 10C NFC, privacy with the Data safety table, sizes per ABI, and the release and support policy. Workflow 10D wrote the accessibility page.

| Page | What it covers |
|---|---|
| [Integration guide](integration.md) | Both activity contracts, `locale`, `appearance`, the install registry, the transport, plain http to loopback, the minimum server, App Links and the link checks |
| [Migrating from a builder-style SDK](migration.md) | Template entry, client prefill and client callbacks, mapped onto server-created inquiries, events and results |
| [Events](events.md) | The PII-free event listener |
| [Failure reasons](failure-reasons.md) | Every `FailureReason`, with what the host should do |
| [Themes and languages](themes-and-languages.md) | The session theme on Material 3, the five SDK languages with their review status, right to left, operator copy and the consent digests |
| [Capture](capture.md) | The frame pipeline and its fallback, document guidance, "barcode found", selfie guidance with an installed detector, more time, and the client-reported `capture-method` and `capture-trigger` |
| [Device integrity](device-integrity.md) | The emulator, root and hooking probes, the debugger facts, Play Integrity with the host-side `IntegrityTokenProvider` recipe, its quota and limits, and the server settings |
| [NFC](nfc.md) | The `nfc` step: the access key, the chip challenge on "I'm ready", the tap, the review, upload and submit; the reader in the optional `openverify-nfc` module, with what proves it and what does not; the screens for a phone or app that cannot read a chip and the `client-unable` report with its review rule; the sandbox test chip |
| [Accessibility](accessibility.md) | What the SDK offers a screen reader, a large font and a right-to-left language, every time limit a person can meet with its treatment, and what a person has not yet checked |
| [Privacy and Data safety](privacy.md) | Where the data goes, what stays on the device, the fixed table from every wire member the SDK sends to its Google Play Data safety category, and what the protections do not stop |
| [Sizes](sizes.md) | The measured download and install size per ABI of the four configurations that exist (the SDK alone, with the chip reader, with the face detector, with both), what each optional artifact costs, and the size caps |
| [Release and support policy](release-and-support.md) | Versioning, the public API, platform levels, what is published, the staged repository, and what is not yet proved |

The SDK's own README (`android/openverify-sdk/README.md`) lists what the SDK sends and reads per signal tier, what it never reads, its permissions, its Google Play Data safety entries, the optional artifacts and the failure reasons. The changes of each version are in `android/CHANGELOG.md`.

## Status

Nothing is published to Maven Central yet (Phase 10 P4 is pending the owner's accounts): build the SDK from source, or from the staged repository the build writes ([release and support policy](release-and-support.md#the-staged-repository)). The SDK is 0.x: a minor version may break its API until the first published release, and the ABI dump (`android/openverify-sdk/api/`) makes every public change visible in review.
