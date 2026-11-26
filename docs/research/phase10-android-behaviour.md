# Phase 10 research: the Android SDK as Persona documents it (clean-room notes)

Prepared 2026-10-29 for OpenVerify Phase 10 ("Android", `docs/PLAN.md` §6 [R1]). On 2026-10-29 the owner moved iOS to
the next release: this note covers Android only, and its proposals keep new shared code in `commonMain` behind common
interfaces so that the iOS release can implement them later [R1] [R2]. The subject is the **public behaviour of
Persona's Android SDK and its mobile integration**, read from docs.withpersona.com (the `llms.txt` index and the mobile
pages), the Android changelog, the public GitHub repositories (changelog and sample only), Maven Central metadata (POMs
and listings only) and the help center. Library pins and build mechanics are the sibling engineering note's [N1].

Everything below is written in our own words. Class, method, builder, enum, permission, event and module names are
reproduced only as short identifiers needed for functional parity; no sentences, UI copy, display names or help text are
copied. Anything the public sources do not state is marked **not documented**; statements we infer, and that no source
states, are marked **(inference)**. Every citation key (`[D3]`, `[C1 v2.48.0]`, `[H6]`, …) is defined in "Sources and
pins", with its URL, read on 2026-10-29. People and identifiers in examples are fictional (`example.com`, `inq_…`
placeholders). OpenVerify is not affiliated with Persona.

"OpenVerify today" is the working tree at `91c83e02`, read-only, while other agents close Phase 6 in it [R21].

---

## Summary

1. **One activity contract, three outcomes.** Persona's app registers `Inquiry.Contract(context)` and receives
   `InquiryResponse.Complete` (inquiry id, a `completed`/`failed` status, field values), `Cancel` (inquiry id and session
   token) or `Error` (a debug message and, since 2.9.2, an error code whose full list is **not documented**) [D3] [D6]
   [C1 v2.9.2]. An experimental fragment mode and an event listener were added later [D4] [C1 v2.24.0]. Callbacks are
   for UI coordination; webhooks are the truth [D15]. OpenVerify already has the same shape, with a closed reason list
   and no PII in results [R5] (M9).
2. **Builders start from a template, a template version, an inquiry (plus session token), a one-time link code or a
   Relay token**, with options for environment, reference id, account, prefilled fields, locale, theme, light or dark,
   theme set, redirect, share token and fallback mode [D3] [C1]. Persona recommends server-side creation and lets a
   template block client-side creation [D16]. OpenVerify keeps creation, identity links and prefill on the server
   (M3–M7) and should add only `locale` and an appearance option (M8, M32).
3. **The app declares little.** The SDK merges `CAMERA`, `RECORD_AUDIO`, `INTERNET`, `ACCESS_NETWORK_STATE`,
   `READ_BASIC_PHONE_STATE` and, with the NFC module, `NFC`; minSdk 23 since 2026-07-14; Java 17; no app R8 rules; an
   App Set ID disclosure for Google Play [D3] [C1 v2.48.0] [G5]. OpenVerify should stay at `INTERNET` and `CAMERA`
   (`NFC` in its own module) and minSdk 26 (M2, M13).
4. **Capture runs guidance on the device and checks on the server.** Auto-capture for IDs (MRZ as a trigger) and selfies,
   manual-shutter fallbacks with server-set delays, overlays, tips, a hologram torch, ID auto-classification, and
   on-device text extraction, all on ML Kit [C1] [V5] [V8]; quality verdicts on the device are **not documented**.
   OpenVerify should build the same guidance with YuNet on `onnxruntime-android` and its own image measures, advisory
   only, with shared thresholds (M15–M17); ML Kit is proprietary (❌).
5. **Barcode.** A template requires the back or the barcode, never both; the barcode is decoded on the device (zxing and
   ML Kit are bundled) [H6] [D8] [V5]. OpenVerify: zxing core 3.5.4 (Apache-2.0, 2025-11-11) as guidance, with the server
   re-decoding (M26).
6. **NFC is mobile only**, in an optional LGPL-carrying module (JMRTD 0.8.1, SCUBA, Bouncy Castle [V4]), plan-gated, for
   ICAO passports, some European IDs and Japanese cards; CAN access; server-configured data groups; on-device Chip
   Authentication; review of the chip data; retries and attempts before an alternative; simulated chips in sandbox [H3]
   [H4] [C1]. Where Passive and Active Authentication run is **not documented**. OpenVerify's server side already exists
   (C62); Phase 10 adds the reader with PACE, AA over the server nonce and a `ChipReader` seam (M18–M22, M43); its one
   licence blocker is the SCUBA decision (O1).
7. **Device signals.** App Set ID headers, Play Integrity bundled, rooted-device and device-integrity signals, GPS when a
   template asks, an active-phone-call check and a different-device warning [C1] [V6] [H9]. OpenVerify: Play Integrity
   as an optional adapter (HONEST), root, emulator and hooking indicators as H-tier facts, `ANDROID_ID` from Phase 7, no
   App Set ID (M23–M25).
8. **Theming and language come from the server**: dashboard theme sets shared by web and mobile, legacy client styles
   mapped to them, local fonts and assets by name, light or dark forcing; device language with an override, a selector,
   46 locales and server-supplied per-screen texts [H11] [D5] [D3] [D12] [H10]. OpenVerify depends on Phase 9's theme
   sets and translations (M31–M34).
9. **Accessibility** is an aim (WCAG, TalkBack) with no published Android audit [D13] [C1 v2.2.42]; OpenVerify should run
   an Android pass mapped to WCAG 2.2 AA (M35).
10. **Releases are frequent and breaking changes ship in minors**: 220 v2 releases since 2021-08-05, 51 in 2026 up to
    v2.61.0 on 2026-10-21, patches on older lines, v1 deprecated on 2022-12-31; Maven Central carries 2.38.0–2.60.0 but
    not 2.61.0 [C1] [G2] [V2] [D6]. OpenVerify should publish with real API docs, a dated changelog and stricter semantic
    versioning (M1, M37, M40).

## Gap tables

Verdicts: **MATCH** (adopt the public behaviour), **OURS** (no public counterpart, or we deliberately differ; labelled
as ours), **DEFER** (not in this release's Phase 10), **HONEST** (needs a third-party account, licensed data or a
proprietary platform service, or cannot be proven: an adapter with a deterministic sandbox provider, ADR 0002 tier A, or
a stated limit [R3]). Row ids (M1, M2, …) are not citation keys; citation keys are always in brackets. "Today" is the
tree at `91c83e02` (§5).

### Integration surface (M1–M14)

| ID | Public behaviour (Persona) | OpenVerify's Android SDK today | What Phase 10 should do | Verdict | Sources |
|---|---|---|---|---|---|
| M1 | `com.withpersona.sdk2:inquiry` from the vendor's Maven repository and Maven Central; optional modules at the same version; a downloadable local-repository zip; empty javadoc jars, a stale API site | Unpublished; `:openverify-sdk` plus an empty `:openverify-nfc` | Publish `openverify-sdk`, `openverify-nfc` and the optional Play Integrity adapter (M23) at one version, with sources and **real** Dokka API docs; a `repo.zip`-style offline bundle is unnecessary for open source (the Gradle build is the bundle) | MATCH (distribution) / OURS (API docs) | [D3] [C1 v2.38.0] [V2] [V10] [P1] [R2] |
| M2 | minSdk 23 (21 until 2026-07); Java 17 | minSdk 26 | Keep 26: `ANDROID_ID` is per signing key only from Android 8.0 (API 26), and the NFC research lists `java.util.Base64` at API 26 among the module's needs | OURS | [C1 v2.48.0] [D3] [R8] [R11] [R12] |
| M3 | `fromTemplate` / `fromTemplateVersion` create the inquiry on the client; discouraged; blockable per template | Not offered on any client; inquiries are created by the customer's server | Do not add in Phase 10. If wanted, it is a cross-client feature (web and Android) needing a public client key, per-template opt-in, rate limits and abuse controls | DEFER (owner question) | [D3] [D16] [R4] [R19] |
| M4 | `fromInquiry(id)`, plus `.sessionToken(t)` once started; token from `POST /inquiries/{id}/resume` | `Request(inquiryId, sessionToken, apiBaseUrl)`, token always required, same server path | Keep; document the mapping for migrators; keep refusing a launch without a token | MATCH / OURS (token always) | [D3] [D17] [R4] |
| M5 | `fromOneTimeLinkCode(...)` exists in the changelog, while the resuming page calls one-time links browser-only | `fromOneTimeLink(url)` + `OneTimeLinkContract`, redeemed once, token in memory only | Keep; add Android App Links guidance to the demo (an intent filter on the operator's flow domain) so a tapped link opens the app (ours) | MATCH / OURS (App Links) | [C1 v2.40.0] [D17] [D21] [R4] |
| M6 | Builder sets `environment`, `environmentId`, `referenceId`, `accountId` on the client | None; the environment comes from the session, and reference id and account are set when the server creates the inquiry | Keep them server-side; a client-set reference id or account would be a client-trusted identity link | OURS | [D3] [C1 v2.8.0] [R4] |
| M7 | `fields(...)` prefills inquiry fields from the client | None | No client prefill; prefill at creation through the API, which Persona itself calls tamper-resistant | OURS | [D3] [D16] |
| M8 | `.locale(code)` overrides the device language | Device (JVM default) locale only; consent records the language shown | Add an optional `locale` (BCP 47) to `Request` and `OneTimeLink`, applied to every SDK string and the consent record, falling back to the device; unknown tags fall back with no error | MATCH | [D3] [C1 v2.10.2] [R2] [R10] |
| M9 | `Complete(inquiryId, status, fields)`, `Cancel(inquiryId, sessionToken)`, `Error(debugMessage, errorCode)`; the code list is not documented | `Completed(inquiryId, inquiryStatus)`, `Failed(inquiryId?, FailureReason)` (11 values), `Canceled(inquiryId?)` | Keep three outcomes; return **no** field values and **no** session token (the host's server has both; a one-time-link token never leaves the SDK); publish the `FailureReason` table with "what to do"; add a non-PII `detail` string only if support needs it | MATCH (outcomes) / OURS (no PII, closed reason list) | [D3] [D6] [C1 v2.9.2] [C1 v2.22.1] [R5] |
| M10 | `Inquiry.onEventListener`: `StartEvent` per session, experimental `MiscInquiryEvent`s (camera, upload, step transition, permission result, camera failures) | No events | Add an optional, documented, PII-free event callback (started, step shown by type, camera permission result, capture failed, submitted, ended), stated as UI coordination only; webhooks stay the source of truth | MATCH (idea) / OURS (event set) | [C1 v2.24.0] [C1 v2.50.0] [C1 v2.61.0] [D15] |
| M11 | Inline fragment mode (`toInlineInquiryBuilder().createFragment()`, Fragment Result API, `InlineInquiryScreen` controls), experimental | Activity only; `InquiryFlowScreen` is internal | Keep the activity contract only in this release (it owns `FLAG_SECURE`, back handling and process death); an inline Compose entry later, marked experimental | DEFER | [D4] [C1 v2.12.2] [C1 v2.12.3] [R6] |
| M12 | Sessions per device (25 per inquiry); desktop-to-phone handoff; a warning when the flow continues on another device or network | Phase 7 (planned) adds the `device_handoff` step and an Android entry that treats it as done | Test the SDK against the Phase 7 handoff contract; the SDK as a handoff **target** (a QR opening the host app) needs App Links and is ours: later | DEFER / OURS | [D25] [C1 v2.55.0] [H12] [R13] |
| M13 | Merged permissions `CAMERA`, `RECORD_AUDIO`, `INTERNET`, `ACCESS_NETWORK_STATE`, `READ_BASIC_PHONE_STATE`; `NFC` with the NFC module; GPS when a template asks | `INTERNET`, `CAMERA`; camera hardware not required | Keep the minimal set; `NFC` only in `openverify-nfc`'s manifest (with `uses-feature android.hardware.nfc` not required); no audio (no video), no phone state, no location (Phase 7 decision 9) | OURS | [D3] [C1 v2.35.0] [A2] [R7] [R13] |
| M14 | No app-side R8 rules; consumer rules inside the AAR; R8 full mode supported | No consumer rules file; the demo app does not minify | Ship consumer rules (serialization models, the NFC module's LGPL keep rules) and build the demo with R8 full mode in CI | MATCH | [G5] [C1 v2.9.1] [C1 v2.56.0] [R11] |

### Capture and verification on the device (M15–M30)

| ID | Public behaviour (Persona) | OpenVerify's Android SDK today | What Phase 10 should do | Verdict | Sources |
|---|---|---|---|---|---|
| M15 | Selfie auto-capture with on-device face detection (ML Kit); poses three or centre only, optionally randomised; stricter capture under a strict flag | C40 protocol: server prompts and nonce, one camera session, manual shutter | On-device YuNet through `onnxruntime-android` (telemetry provider removed) for framing and pose-hold auto-capture, keeping the manual shutter after a delay; the server re-measures every frame | MATCH (behaviour) / OURS (model) | [H13] [C1 v2.2.5] [C1 v2.11.0] [V5] [R1] [R16] |
| M16 | Where liveness is decided is not documented (server checks; on-device face detection) | Server decides (MiniFASNet + active poses); the device sends client claims | State in the SDK docs that device guidance is never a liveness verdict; send guidance outcomes only as low-trust metadata | HONEST | [H13] [V5] [R1] [R10] |
| M17 | ID auto-capture, MRZ as a trigger, server-set manual delay and image count, overlays, tips, passport hint, hologram torch, review screen; quality verdicts not documented | Manual shutter, server retry hints, review screen | On-device guidance: card quad, sharpness, glare and MRZ-zone presence, auto-capture when held, manual shutter after a delay; thresholds from a shared contract fixture so device and server agree; advisory only, and the server stays authoritative | MATCH (behaviour) / OURS (algorithms) | [C1 v2.2.21] [C1 v2.2.24] [C1 v2.16.3] [C1 v2.45.2] [R1] [R10] |
| M18 | NFC is mobile-SDK only, in an optional module that adds `NFC`; error dialog with no reader; sends the user to NFC settings; reader registered only while scanning | Empty `openverify-nfc`; the `nfc` step is unsupported | Build `openverify-nfc` as an optional artifact the host adds; the SDK discovers it through an interface the host wires (the core never depends on the LGPL module); no-reader and NFC-off states with a settings shortcut; reader mode only while the scan screen is visible | MATCH | [H3] [D3] [C1 v2.10.10] [C1 v2.12.7] [C1 v2.30.0] [R9] |
| M19 | MRZ-based access and Card Access Number (CAN) authentication; BAC versus PACE not documented | `BacKeySeed` in common code; no chip I/O | PACE first (MRZ or CAN), BAC fallback; the MRZ from the government ID step or typed; CAN entry for ID cards | MATCH / OURS (PACE-first) | [C1 v2.12.0] [R11] |
| M20 | Data groups read are server-configured; the help center lists name, dates, place of birth and portrait; the user reviews the chip data | Server takes `chip-sod`, `-dg1`, `-dg2`, `-dg14`, `-dg15`, `-card-security`, `-card-access`, `-com` | Follow the client sequence `docs/checks/nfc.md` already fixes: upload exactly the server's file kinds as raw bytes within their caps; show the DG1 fields for review before submit; never decide on the device. DG11 and DG12 (where place of birth usually sits, inference) stay unread: data minimisation, so place of birth is not offered | MATCH / OURS (no DG11, DG12) | [C1 v2.11.2] [H4] [R14] [R23] |
| M21 | Chip Authentication runs on the device (inferred from fixes); Active and Passive Authentication not documented | Server verifies PA and AA over its own 8-byte nonce (C62) | Fetch the challenge **before** the user taps (AA needs the chip still in the field, and the challenge lives 300 s), so one tap covers access, reading and AA; then upload and submit. `docs/checks/nfc.md` lists the upload before the challenge, so the plan must confirm the server accepts this order (inference). Run CA for secure messaging but report it only in `device-report` (not verifiable on the server) | MATCH (CA) / OURS (server-verified AA and PA) | [C1 v2.41.1] [C1 v2.43.0] [R11] [R14] |
| M22 | Retries after a dropped link; a template-set number of failed attempts before an alternative; tips on cancel; progress; known locale and process-death bugs | None | Same states. The flow-spec `nfc` step already has `androidOnly: true` and an optional `maxAttempts`; an "offer the alternative after N failed scans" route is a transition the Phase 9 flow builder would add (ours to define). Tests for process death, a lifted document and a non-Latin-digit locale | MATCH / OURS (fallback route) | [C1 v2.44.0] [C1 v2.51.0] [C1 v2.53.0] [C1 v2.30.0] |
| M23 | Play Integrity 1.4.0 always bundled; skipped in Relay mode; device integrity is a signal | None | A Play Integrity **adapter** in its own optional artifact (proprietary API), nonce bound to the session by the server, verdict decoded and checked on the server; a sandbox provider; the product works without it | HONEST | [V6] [D8] [D23] [H8] [R1] [R12] |
| M24 | "Rooted device detected" signal; emulator and hooking detection not documented | None (Phase 7 adds debugger facts) | Root, emulator and hooking indicators as facts with reasons, H-tier, `beta`, feeding the signals score; never a pass; the docs state that a controlled device can hide them | HONEST | [H9] [R12] [R13] |
| M25 | App Set ID in request headers (Play services) | Phase 7 plans an `ANDROID_ID` HMAC under device-recognition consent | Keep Phase 7's choice; no App Set ID (Play services, developer-account scope) | OURS | [C1 v2.2.24] [A1] [R13] |
| M26 | PDF417 read on the device (zxing and ML Kit bundled); barcode or back required, never both; a barcode overlay; expiry parsed | None on the device; the server decodes | zxing core on the device for **guidance** (decodes, so the user can move on); the server re-decodes and decides; a barcode overlay for steps that require it | MATCH / OURS (guidance only) | [H6] [C1 v2.2.26] [C1 v2.7.1] [D8] [V11] [R17] |
| M27 | Auto-classification of the ID type with a manual fallback; text extraction on the device (ML Kit) | No ID-type picker: the server classifies from the capture | No on-device OCR in Phase 10 (ML Kit is proprietary; the server already runs RapidOCR) | OURS | [C1 v2.11.0] [C1 v2.5.0] [V8] [R1] |
| M28 | Capture methods per device class (native mobile separately); upload off by default on mobile | Production photos always from the live camera; upload only in sandbox | Keep; a native-mobile capture-method setting can come with the Phase 9 flow builder | MATCH / OURS (stricter) | [H5] [D20] [R10] |
| M29 | Video capture and WebRTC streaming (`RECORD_AUDIO`) | None | Not in PLAN | DEFER | [C1 v2.5.0] [C1 v2.10.9] |
| M30 | Silent network authentication (Vonage), mdoc via Google Wallet, credit cards, Japanese My Number (PocketSign), Sentinel, Relay, reusable wallets | None | Not in Phase 10; any of them needs a third-party account or licensed component | DEFER / HONEST | [D3] [D8] [C1 v2.26.0] [C1 v2.46.0] [H7] [D23] |

### Theming, localisation and accessibility (M31–M36)

| ID | Public behaviour (Persona) | OpenVerify's Android SDK today | What Phase 10 should do | Verdict | Sources |
|---|---|---|---|---|---|
| M31 | Server theme sets from the dashboard editor, one theme across web and mobile; colours as `#RRGGBBAA` | `OpenVerifyTheme`: Material 3 default light and dark schemes | Read the Phase 9 theme-set contract from the flow session and map it onto `MaterialTheme` (colours, shapes, type scale); validate colours and contrast on the server; fonts only bundled or from the API origin | MATCH (depends on Phase 9) | [H11] [D26] [C1 v2.8.0] [R10] |
| M32 | `styleVariant(LIGHT \| DARK)`; force dark refused; local resource-name overrides for animations and images; a local style for the loader | Follows the system dark setting | Add an `appearance` option (system, light, dark); **no** resource-name overrides (a fragile, undocumentable API) | MATCH (variant) / OURS (no overrides) | [C1 v2.32.0] [C1 v2.36.0] [C1 v2.38.0] [D3] |
| M33 | Device language, a language selector, 46 locales, server-supplied per-screen translations and overrides | English and Spanish bundled; no selector | Bundle Phase 9's set (en, es, fr, de, ar) for SDK strings; render the server's template texts as sent (Phase 9 translations); a language selector only if Phase 9's web flow has one | MATCH (mechanism) / OURS (language set) | [D12] [H10] [C1 v2.2.4] [R1] [R10] |
| M34 | RTL depends on the host's `supportsRtl`; an Arabic system locale broke passport reads | No RTL language yet | Arabic with RTL layout through CMP; MRZ, dates and the BAC/PACE key always built with ASCII digits, tested under `ar` and other non-Latin-digit locales | MATCH / OURS (tests) | [C1 v2.3.2] [C1 v2.53.0] [R10] |
| M35 | WCAG aim, TalkBack, touch targets, large fonts, keyboard focus; no Android audit published | Semantics in places, a polite live region on one step; no audit | An Android accessibility pass mapped to WCAG 2.2 AA (Phase 9 audits the web): Compose UI tests for labels, 48 dp targets, 200 % font scale, focus order, and spoken selfie prompts and capture states | MATCH | [D13] [C1 v2.2.42] [C1 v2.38.0] [R1] |
| M36 | Screenshot blocking not documented | `FLAG_SECURE` on the flow activity | Keep, and document it (screen readers are unaffected; screen recording and recents are blocked) | OURS | [R6] |

### Versioning and release (M37–M43)

| ID | Public behaviour (Persona) | OpenVerify's Android SDK today | What Phase 10 should do | Verdict | Sources |
|---|---|---|---|---|---|
| M37 | Breaking changes ship in minor releases, flagged in the changelog | Version string 0.1.0; no API compatibility check | Semantic versioning: 0.x until the first Android release, then breaking changes only in majors; a binary-compatibility check of the public API in CI; deprecate before removing | OURS (stricter) | [C1] [R10] |
| M38 | `shareToken(...)` and `fieldMappings(...)` on the builders: client-side Connect redemption with a consent screen | None | Phase 11 (Connect); leave room in `Request` for an optional share token | DEFER (Phase 11) | [D21] [C1 v2.40.0] [C1 v2.45.0] |
| M39 | minSdk 23, compileSdk 36, AGP 9, Kotlin 2.2, 16 KB pages; no maximum or end-of-support policy | minSdk 26, compile and target 36, AGP 9.4.1, Kotlin 2.4.21 | Keep; 16 KB-aligned native libraries (onnxruntime) and the target-API rule are the engineering note's [N1]; publish a support policy (ours) | MATCH / OURS (policy) | [C1 v2.22.0] [C1 v2.46.0] [C1 v2.19.0] [R8] [N1] |
| M40 | About one release a week in 2026; patches on older minors; a changelog-only GitHub repo; advice to update monthly or quarterly | None | `CHANGELOG.md` per release with date, minSdk and "Breaking"; GitHub releases; patch only the latest minor (ours, a small project) | MATCH (format) / OURS (policy) | [C1] [G1] [G2] |
| M41 | A Google Play Data safety page with suggested answers; the App Set ID disclosure | Phase 7 plans the README and Data safety entries (P29) | One README section listing what the SDK sends per tier (images, ID data, chip data, device facts), never "analytics", with the operator responsible for the final answers | MATCH (doc) / OURS (content) | [D7] [D3] [G4] [R13] |
| M42 | The vendor's own Persona Wallet app (and formerly an Instant App) hosts native flows without the customer's app | Demo app only | No OpenVerify-branded app in this release; the demo app stays a sample | DEFER (owner question) | [H15] [D9] [A3] [R18] |
| M43 | Sandbox: simulated chip data by default, toggled by a long press; simulate actions on the API | Sandbox banner; sandbox-only photo picker | A sandbox-only "test chip" path backed by the Phase 5 synthetic-chip builder (`@openverify/emrtd/testing`, server-side TypeScript, with the Utopia CSCA that `seed:dev` inserts); how the device obtains the bytes is ours to design; the server already fails a `UTO` issuer in production (C62.8) | MATCH / HONEST | [C1 v2.12.11] [D18] [R14] |

## Carried into this phase

From `grep -n -i 'phase 10\|phase-10\|later phase\|carried to\|defer\|until'` over `docs/plans/*.md` at `91c83e02`
(plus PLAN §6 itself), keeping the items in this note's subject. "Status after 2026-10-29" applies the owner's decision
that iOS waits for the next release [R1].

| # | Plan and line | Item handed to Phase 10 | Status after 2026-10-29 |
|---|---|---|---|
| K1 | `docs/PLAN.md:426–444` | The Phase 10 scope: renderer, CameraX capture with on-device quality gating, active liveness with `onnxruntime-android` and YuNet, PDF417 with zxing, device signals (root, emulator, optional Play Integrity), the `ActivityResultContract` API, `openverify-nfc` (BAC/PACE, DG1/DG2/SOD, chip and active authentication), the demo app, tests, instrumented tests in CI | Android: open. iOS halves (cinterop ONNX, Apple Vision) → next release (`PLAN.md:451–461`) |
| K2 | `docs/plans/phase-3.plan.md:423`, `:916` | On-device PDF417 decoding (`io.github.zxing-cpp:android` named there; PLAN later says zxing) and client-side barcode pre-checks (C37) | Open; the library choice (zxing Java core vs zxing-cpp) is the engineering note's [N1] |
| K3 | `docs/plans/phase-4.plan.md:33`, `:336` | Android selfie has a manual shutter; on-device guidance waits for Phase 10 | Open (M15, M16) |
| K4 | `docs/plans/phase-4.plan.md:354`, `:475` | No MediaPipe: Android guidance uses `onnxruntime-android` with its telemetry provider removed | Open; binding constraint |
| K5 | `docs/plans/phase-5.plan.md:48`, `:81` | The Android chip reader is Phase 10; the Phase 5 e2e plays the Phase 10 client with synthetic chips (C65) | Open (M18–M22) |
| K6 | `docs/plans/phase-5.plan.md:557`, `:1162` | The `nfc` step shows the unsupported screen on both clients until Phase 10 | Android: open. Web: stays unsupported, since Persona offers NFC on mobile SDKs only [H3]; the web flow needs a "continue in the app" or handoff answer (owner question) |
| K7 | `docs/plans/phase-5.plan.md:758` (decision 40) | SCUBA's `GPL-2.0-only WITH Classpath-exception-2.0` files decided before Phase 10; default disabled | Open: blocks `openverify-nfc` (owner question) |
| K8 | `docs/plans/phase-5.plan.md:1283` | Crypto wallets are paste-only on Android until Phase 10 | Open; wallet signing on Android is not in Persona's Android docs (no public counterpart found): OURS or DEFER |
| K9 | `docs/plans/phase-5.plan.md:926` | iOS placeholders (`countryName` null, no copy button) until Phase 10 | → next release |
| K10 | `docs/plans/phase-7.plan.md:301`, `:608` | The `OpenVerify-Android/<version>` header parsed into `mobile-sdk-name` and `mobile-sdk-full-version` (Phase 7 server work) | Phase 10 must keep the header exact and bump the version on release |
| K11 | `docs/plans/phase-7.plan.md:630–638` | Phase 7 adds `DeviceSignals` (debugger facts, `ANDROID_ID` HMAC), the SDK README per tier and the Play Data safety entries (P29) | Phase 10 builds on it, if Phase 7 lands first; the README and Data safety text must then cover Phase 10's additions |
| K12 | `docs/plans/phase-7.plan.md:635`, `:1488`, `:1941` (decision 12) | Emulator, root and hooking heuristics and Play Integrity; an iOS handoff target | Android: open (M23–M25). iOS handoff target → next release |
| K13 | `docs/plans/phase-7.plan.md:687` | An Android model entry treats the `device_handoff` step as done from `handoff.state` (Phase 7 Stage 1a typecheck minimum) | Phase 7 work; Phase 10 checks the native handoff behaviour (M12) |
| K14 | `docs/plans/kmp-migration.plan.md:93` | `expect fun secureRandomBytes(n)` for "Phase 10 NFC challenges" | Probably **moot**: the AA nonce is the server's (C62.5 [R14]); BAC/PACE randomness is inside JMRTD (inference). Keep it out unless a need appears |
| K15 | `docs/plans/kmp-migration.plan.md:44`, `:136–137` | Burst, and moving the JUnit 5 parameterized suites' pure parts to `commonTest` | → next release (`PLAN.md:461`); not needed for Android |
| K16 | `docs/plans/kmp-migration.plan.md:90`, `:147`, `:154`, `:188–189`, `:199–200` (decisions 4, 5) | iOS seams, the macOS job, the iOS app, Darwin engine checks, CMP live regions on iOS | → next release (owner decision, `PLAN.md:451–461`); Linux CI keeps compiling the iOS klibs (`PLAN.md:428–432`) |

No Phase 9 or Phase 11 plan exists yet, so nothing is handed over from them; this note names its own dependencies on them
(theme sets, translations, Connect) in the gap tables (M31–M33, M38).

## Sources and pins

**Read date.** Every source below was read on **2026-10-29**, after reading each host's robots file, with at least 1.2 s
between requests to one host (2 s on `help.withpersona.com`, which sibling agents were also reading), a descriptive
User-Agent without contact details, and no personal data sent. Robots files read first:

- `docs.withpersona.com`: everything allowed except `/api/fern-docs/`.
- `help.withpersona.com`: everything allowed except `/gated/`; a content-signals preamble that sets no signal; it points
  agents to `/llms.txt` and to `/articles/<id>.md`.
- `repo1.maven.org`: `User-agent: *` allowed, with `Content-Signal: search=yes,ai-train=no,use=reference`. This note is
  reference use, not training.
- `github.com`: `crawl-delay: 1`; `/*/raw/`, `/*/tree/` and `/*/*/commits/` disallowed, so file contents were read from
  `raw.githubusercontent.com` and listings from `api.github.com`, whose robots files answered 404 (no restriction under
  RFC 9309).
- `sdk.withpersona.com`: robots answered 404 (no restriction).
- `developer.android.com`: `User-Agent: *` allowed except asset, sample and old release-note paths.
- `dl.google.com` (Google Maven): **`Disallow: /`**, so nothing was fetched from Google Maven, and no Google Maven version
  or date appears in this note.

Downloads (about 4.4 MB) are under `downloads/{robots,persona-docs,persona-help,persona-apidocs,maven,github,android-dev}/`;
nothing downloaded was executed, and Python read them with `-I`. Persona's SDK binaries (`.aar`) and source jars were
**not** downloaded: this note reads only the published documentation, changelog, README, sample configuration and Maven
POM metadata.

**Persona developer docs (D).** Every `D` link is `https://docs.withpersona.com/2026-09-29/<page>.md` (the API version
pinned in the index; the default version on 2026-10-29) [D1].

| Key | Page | What it gives |
|---|---|---|
| [D1] | `llms.txt` (and `https://docs.withpersona.com/llms.txt`) | The page index; version `2026-09-29` is the default |
| [D2] | `mobile-sdks` | The native SDKs exist for Android, iOS and React Native; themeable |
| [D3] | `android-sdk-v2-integration-guide` | Requirements, repository, permissions, result contract, builders, locale, errors, custom styling and fonts, the NFC, WebRTC and SNA modules, local repository |
| [D4] | `android-inline-inquiries` | The fragment (inline) mode, `InlineInquiryScreen`, `screenStateFlow` |
| [D5] | `migrating-android-theming-from-client-to-server` | The client theme attributes and their server equivalents |
| [D6] | `migrate-from-android-sdk-v1-to-v2` | v1 to v2 breaking changes; v1 deprecated on 2022-12-31 |
| [D7] | `google-play-data-privacy` | Persona's suggested Google Play Data safety answers |
| [D8] | `android-sdk-v2-licenses` | The SDK's third-party dependencies and their licences |
| [D9] | `android-instant-app` | The Instant App path and its December 2025 end |
| [D10] | `choosing-an-integration-method` | Template-created versus API-created inquiries for SDKs |
| [D11] | `browser-device-support` | Camera resolution guidance (1920×1080 recommended, below 640×480 refused) |
| [D12] | `languages` | The supported locale codes (46 listed) |
| [D13] | `accessibility` | WCAG aim; TalkBack among the supported screen readers |
| [D14] | `api-reference/verifications/government-id-nfc-verifications` | The NFC verification page points to a dashboard-only check list |
| [D15] | `accessing-inquiry-status` | SDK callbacks are for UI coordination; webhooks are the source of truth |
| [D16] | `creating-inquiries` | API versus client-side creation; per-template "block client-side creation" |
| [D17] | `resuming-inquiries` | Session tokens (JWT), the `resume` endpoint, one-time links "browser-only" |
| [D18] | `integration-testing` | Sandbox simulate actions |
| [D19] | `inquiry-signals` | `signals` on the inquiry; distances in metres |
| [D20] | `troubleshooting-common-issues` | Upload is off by default on mobile for web and SDKs |
| [D21] | `redeeming-share-tokens` | Client-side share-token redemption, including the Android `shareToken` builder method |
| [D22] | `webview-integration` | Native SDKs recommended over WebViews; `is-webview=true` |
| [D23] | `relay-android-sdk` | `Inquiry.fromRelaySessionToken`, 2.47.0+, no host identity, no Play Integrity in Relay mode |
| [D24] | `api-reference/devices/retrieve-a-device` | Device attributes `device-vendor-id`, `device-fingerprint`, `browser-fingerprint` |
| [D25] | `inquiry-sessions` | One session per device; 25 sessions per inquiry by default |
| [D26] | `inquiry-theming` | Dashboard themes apply to mobile SDK v2+ |
| [D27] | `react-native-sdk-v2-integration-guide` | Only used for two facts: the RN wrapper's `onError` carries an error code, and it asks for AGP 8 or later |

**Android changelog (C).** [C1] is `https://docs.withpersona.com/2026-09-29/android-sdk-v2-changelog.md`: 220 release
entries from v2.0.0 (2021-08-05) to v2.61.0 (2026-10-21), each headed with its date and supported API floor ("SDK 21+" or
"SDK 23+"). A changelog entry is cited as `[C1 v2.48.0]`. The GitHub releases [G2] carry the same version numbers and dates.

**Persona help center (H).** Every `H` link is `https://help.withpersona.com/articles/<id>/`, read as `<id>.md`.

| Key | Article id | Subject |
|---|---|---|
| [H1] | `/llms.txt` | The help index |
| [H2] | `ac6Uc0xr5PsLoqKB0CHPr` | Mobile SDKs; React Native wraps the native SDKs |
| [H3] | `1iu1Fak8y9RiOE2FddXrHJ` | NFC is mobile-SDK only (no web); ICAO passports and some European ID cards, passport cards and residence permits |
| [H4] | `C6sdm6k7AnVBOmvlRP9ic` | What the passport chip holds; the user reviews the chip data; NFC is plan-gated |
| [H5] | `7JQ78WDWLj5L63qXEu7AqJ` | Capture methods per device class (desktop web, mobile web, native mobile) (updated 2026-09-30) |
| [H6] | `2f4jO5REos5aRPIVGEsb0Z` | Front required; back or barcode optional, never both; the barcode overlay; three barcode-dependent checks |
| [H7] | `BbLOYiPtcRzaPAeDE7lUGj` | The Sentinel Android SDK: minSdk 23, `INTERNET`, same version as the inquiry SDK |
| [H8] | `3aYYkI9NMDsyVqx5V3IT3G` | Signal categories, including device integrity and camera properties |
| [H9] | `59xyT8o5Did16ovuqSIUDj` | Signal formats; "rooted device detected"; app bundle names (updated 2026-09-30) |
| [H10] | `hoxMwpVc5bnYFbiNDen7R` | Translations: device language on mobile, a language selector in the flow, editable per screen |
| [H11] | `6SIHupp847yaEuVMucKAff` | The theme editor and theme sets; an organisation default theme set |
| [H12] | `SmmuLIhpRRpGKyiQBfJllA` | NFC hardware, cases, Low Power Mode, documents without a chip, the fallbacks |
| [H13] | `6klAhoMzfALFRcztwe0DbH` | Selfie poses (three or centre only); capture methods per device class |
| [H14] | `3c2XDYIxmf9PjivgeJtx3i` | Capture-method labels `Auto`, `Manual`, `Upload`, `Combo` |
| [H15] | `mLyqfTUgsRUE2SAROqYoSG` | Persona Wallet: the vendor's own app hosts some flows; on Android it must be installed |
| [H16] | `V809YiUBfhmD5ocRMVp6r7` | Behaviour signals are collected in hosted, embedded and mobile SDK integrations (updated 2026-09-30) |

**GitHub (G).**

| Key | URL | Pin and what it gives |
|---|---|---|
| [G1] | `https://api.github.com/repos/persona-id/inquiry-android-2` | Created 2022-04-26, pushed 2026-10-27; **no licence**; described as the repository to watch for SDK updates; [C1] says it holds changelogs and release tracking only, not code |
| [G2] | `https://api.github.com/repos/persona-id/inquiry-android-2/releases?per_page=15` and `/commits?per_page=5` | Latest release **v2.61.0**, published 2026-10-21T14:39:28Z; HEAD **`7174a8a837d2d9008860f7bae6294d5c7d818da4`** (2026-10-21, "Bump version"). v2.57.1 was published on 2026-10-15, after v2.60.0 (2026-10-13): a patch on an older line |
| [G3] | `https://api.github.com/repos/persona-id/persona-android-sdk` | The sample apps; **Apache-2.0**; pushed 2025-02-11; HEAD **`76bad2719650207076273ce4f9258d679050ac6a`** |
| [G4] | `https://raw.githubusercontent.com/persona-id/persona-android-sdk/76bad2719650207076273ce4f9258d679050ac6a/README.md` | Sample setup; the App Set ID disclosure table |
| [G5] | Same commit: `BasicInquirySample/proguard-rules.pro`, `BasicInquirySample/src/main/AndroidManifest.xml`, `BasicInquirySample/build.gradle.kts`, `gradle/libs.versions.toml` | The sample adds no ProGuard rule and no permission of its own; it depends on `inquiry`, `nfc-impl` and `webrtc-impl` 2.12.17 |
| [G6] | `https://raw.githubusercontent.com/zxing/zxing/zxing-3.5.4/LICENSE` | Apache-2.0 at the tag |

**Maven Central (V).** Every `V` link is under `https://repo1.maven.org/maven2/`.

| Key | Path | What it gives |
|---|---|---|
| [V1] | `com/withpersona/sdk2/` | 52 artifact directories, among them `inquiry`, `nfc-impl`, `webrtc-impl`, `sna-impl`, `jp-my-number-impl`, `text-extraction-impl`, `device`, `device-integrity`, `appdome-threatevents(-impl)`, `fallback-mode`, `sandbox`, `sentinel`, `dynamic-feature`, `inquiry-advanced-customizations(-impl)`, `json-logic-kmp-*` |
| [V2] | `com/withpersona/sdk2/inquiry/maven-metadata.xml` | `latest` and `release` **2.60.0**, `lastUpdated` 2026-10-15 03:53:21; versions 2.38.0 to 2.60.0 (2.40.0 absent, 2.45.1 present). **v2.61.0 is not on Maven Central** on 2026-10-29; [D3] names Persona's own repository `https://sdk.withpersona.com/android/releases` |
| [V3] | `com/withpersona/sdk2/inquiry/2.60.0/inquiry-2.60.0.pom` | Last-Modified 2026-10-13 23:47:07 GMT; the POM **declares Apache-2.0**; SCM points at [G1], which has no code |
| [V4] | `com/withpersona/sdk2/nfc-impl/2.60.0/nfc-impl-2.60.0.pom` | Runtime: `org.jmrtd:jmrtd:0.8.1`, `org.bouncycastle:bcprov-jdk15to18:1.84`, `bcutil-jdk15to18:1.84`, `net.sf.scuba:scuba-sc-android:0.0.26` |
| [V5] | `com/withpersona/sdk2/camera/2.60.0/camera-2.60.0.pom` | Runtime: CameraX 1.4.2 (core, camera2, lifecycle, video, view), `media3-muxer`, ML Kit `play-services-mlkit-barcode-scanning` 18.3.1, `-text-recognition` 19.0.1, `-face-detection` 17.1.0 |
| [V6] | `com/withpersona/sdk2/inquiry-internal/2.60.0/inquiry-internal-2.60.0.pom` | Runtime: `com.google.android.play:integrity:1.4.0`, `appdome-threatevents`, `device`, `fallback-mode`, `sandbox`, `nfc`, `jp-my-number`, the step modules |
| [V7] | `com/withpersona/sdk2/device/2.60.0/device-2.60.0.pom` | Runtime: `com.google.android.gms:play-services-appset:16.1.0` |
| [V8] | `com/withpersona/sdk2/text-extraction-impl/2.60.0/text-extraction-impl-2.60.0.pom` | Runtime: ML Kit `entity-extraction` 16.0.0-beta6 and `text-recognition` 16.0.1 |
| [V9] | `com/withpersona/sdk2/{government-id,selfie,nfc,appdome-threatevents,appdome-threatevents-impl,sentinel,network-inquiry}/2.60.0/*.pom` | Module wiring; `network-inquiry` uses Retrofit, Moshi, OkHttp 4.12.0 and the `json-logic-kmp` modules; `device-integrity/2.60.0` answered 404 |
| [V10] | `com/withpersona/sdk2/inquiry/2.60.0/` and `inquiry-types/2.60.0/` listings | Each publishes a `-javadoc.jar` of **261 bytes** (an empty placeholder) and a `-sources.jar` (not read) |
| [V11] | `com/google/zxing/core/maven-metadata.xml`, `com/google/zxing/core/3.5.4/core-3.5.4.pom` | zxing core latest **3.5.4**, Last-Modified 2025-11-11; licence [G6] |

**Persona API reference site (P).** [P1] `https://sdk.withpersona.com/android/docs/index.html`: a Dokka Javadoc site titled
"inquiry-public 2.3.7-SNAPSHOT API". It is stale (version 2.3.x, early 2023) and is not used for current API names.

**Android platform (A).**

| Key | URL | What it gives |
|---|---|---|
| [A1] | `https://developer.android.com/training/articles/app-set-id` | App set ID: scoped to the apps of one Play developer account (or to one app); reset after 13 months unused, on uninstall of the set's last app, or on a factory reset; a Google Play services API |
| [A2] | `https://developer.android.com/reference/android/Manifest.permission` | `CAMERA` and `RECORD_AUDIO` are dangerous (runtime) permissions; `NFC` is normal (API 9); `READ_BASIC_PHONE_STATE` (API 33) is not dangerous |
| [A3] | `https://developer.android.com/topic/google-play-instant` | Google Play Instant ends in December 2025 |

**OpenVerify repository (R)**, the working tree at `91c83e02`, read-only.

| Key | Path |
|---|---|
| [R1] | `docs/PLAN.md` §3 (technology table), §6 Phase 10 (lines 426–444) and "Next release: iOS" (451–461), §9 |
| [R2] | `docs/adr/0004-mobile-kotlin-multiplatform.md` |
| [R3] | `docs/adr/0002-check-tiers.md` |
| [R4] | `android/openverify-sdk/src/androidMain/kotlin/dev/openverify/sdk/OpenVerifyInquiry.kt` |
| [R5] | `android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/InquiryResult.kt`, `InquiryOutcomes.kt` |
| [R6] | `android/openverify-sdk/src/androidMain/kotlin/dev/openverify/sdk/InquiryResults.kt`, `OpenVerifyInquiryActivity.kt` |
| [R7] | `android/openverify-sdk/src/androidMain/AndroidManifest.xml` |
| [R8] | `android/gradle/libs.versions.toml`, `android/openverify-sdk/build.gradle.kts` |
| [R9] | `android/openverify-nfc/README.md`, `android/openverify-nfc/build.gradle.kts` |
| [R10] | `android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/`: `model/Flow.kt`, `model/Guidance.kt`, `camera/CameraFacts.kt`, `flow/FlowCoordinator.kt` (`Settings`), `flow/SelfieCaptureProtocol.kt`, `ui/InquiryFlowScreen.kt`, `ui/OpenVerifyTheme.kt`, `ui/Messages.kt`, `api/FlowApi.kt`, `api/FlowHttp.kt`, `composeResources/values{,-es}/` |
| [R11] | `docs/research/phase5-nfc.md` §4 and §7 |
| [R12] | `docs/research/phase7-client-signals.md` §4 |
| [R13] | `docs/plans/phase-7.plan.md` (lines 301, 596–640, 680–690, 1488, 1941) |
| [R14] | `docs/plans/phase-5.plan.md` (lines 48, 81, 500–530 (C62), 550–570 (C64), 758, 926, 1162, 1283) |
| [R15] | `docs/plans/kmp-migration.plan.md` (lines 44, 90, 93, 136–137, 147, 154, 188–189, 199–200) |
| [R16] | `docs/plans/phase-4.plan.md` (lines 33, 336, 354, 475) |
| [R17] | `docs/plans/phase-3.plan.md` (lines 423, 916) |
| [R18] | `android/demo-app/` (`build.gradle.kts`, `AndroidManifest.xml`, `DemoViewModel.kt`) |
| [R19] | `apps/flow/src/session/session-bootstrap.ts` |
| [R20] | `CLAUDE.md` rules 4 and 5 |
| [R21] | `docs/PROGRESS.md` (status table: Phase 6 in progress, 7 and 8 planned, 9 to 11 pending) |
| [R22] | `packages/flow-spec/src/flow.ts:355–363` (`nfcStepSchema`: `androidOnly: true`, optional `maxAttempts`; web clients skip or hand off the step) |
| [R23] | `docs/checks/nfc.md:3–5`, `:37–48` (the client sequence, the file kinds and size caps, DG11 and DG12 not taken, the `device-report` protocols); `docs/checks/selfie.md:36`, `:442` (no on-device guidance on Android until Phase 10) |

**Sibling note (N).** [N1] `phase10-android-engineering.md` in this folder (in progress on 2026-10-29) owns the library
pins (CameraX, onnxruntime-android, zxing, Play Integrity, JMRTD), Maven Central publishing, R8, 16 KB pages and testing.
This note does not re-pin those; where it names a library it cites only what Persona's own pages show, plus zxing [V11].

**Licence verdicts on what Persona's dependency list shows** (CLAUDE.md rule 4 [R20]; for OpenVerify adoption, not for
reading). Reading Persona's docs and POMs copies nothing into OpenVerify.

| Item seen in Persona's SDK | Licence as published | Verdict for OpenVerify | Why |
|---|---|---|---|
| Persona's own SDK (`com.withpersona.sdk2:*`) | POM says Apache-2.0 [V3]; no source is published, the changelog repo has no licence [G1] | ❌ not a dependency; reading only | A closed binary, and the product we replace; clean-room forbids reusing it |
| ML Kit barcode, text recognition, face detection, entity extraction | "ML Kit Terms of Service" [D8] [V5] [V8] | ❌ | Proprietary Google terms, closed binaries; PLAN chose zxing and ONNX models instead [R1] |
| Play Integrity (`com.google.android.play:integrity`) | "Play Integrity API Terms of Service" [D8] [V6] | ⚠️ optional adapter only | Proprietary platform API: allowed only as an adapter the product works without (rule 3 of this task; PLAN Phase 10 [R1]) |
| App set ID (`play-services-appset`) | "Android Software Development Kit License" [D8] [V7] | ❌ for the core; not needed | Proprietary Play services; Phase 7 already chose `ANDROID_ID` as the device id [R13] |
| Appdome threat events (`appdome-threatevents`) | Module POM says Apache-2.0 [V9]; Appdome itself is a commercial product (inference) | ❌ | A closed commercial app-hardening service; behaviour not documented |
| JMRTD 0.8.1, SCUBA `scuba-sc-android` 0.0.26 | LGPL (JMRTD notice on [D8]) [V4] | ⚠️ only inside `openverify-nfc` | CLAUDE.md allows LGPL only there; OpenVerify's pins are newer (JMRTD 0.8.9, scuba-sc-android 0.0.27 [R11]) |
| Bouncy Castle `*-jdk15to18` 1.84 | MIT (OpenVerify's own check of the 1.86 line [R11]) | ✅ | Permissive; OpenVerify pins the `jdk18on` line [R11] |
| zxing core 3.5.3 (Persona) / 3.5.4 (latest, 2025-11-11) | Apache-2.0 [D8] [G6] [V11] | ✅ 3.5.4 passes the 14-day rule | Already PLAN's Android PDF417 choice [R1] |
| Lottie, Coil, Moshi, Retrofit, OkHttp, Dagger, Square Workflow, Markwon, AndroidSVG, json-logic (allegro, "modified") | Apache-2.0 [D8] | ✅ (not needed) | OpenVerify already has Compose, Ktor, kotlinx.serialization and its own JsonLogic [R8] [R10] |
| commonmark 0.13.0 | BSD-2-Clause [D8] | ✅ (not needed) | — |
| Vonage client library (SNA) | Apache-2.0 [D8] | ⚠️ (not adopted) | Silent network authentication needs a carrier-aggregator account: an adapter with a sandbox if ever built (ADR 0002 tier A [R3]) |

## 1. The integration surface

### 1.1 Distribution and setup

- **Artifact.** `com.withpersona.sdk2:inquiry:<version>` from Persona's own Maven repository,
  `https://sdk.withpersona.com/android/releases` [D3]. Since v2.38.0 (2026-04-16) it is also on Maven Central, snapshots
  included [C1 v2.38.0]; Central lists 2.38.0 to 2.60.0, and 2.61.0 (2026-10-21) had not reached it by 2026-10-29 [V2]
  [G2]. A per-version `repo.zip` can be downloaded for a local or internal repository [D3].
- **Build requirements.** `minSdkVersion` 23 or higher [D3]; Java 17 source and target compatibility [D3].
- **Optional modules**, each pinned to the same version as `inquiry` [D3]:
  - `nfc-impl`: government ID chip reading (adds the `NFC` permission) [D3]; an extension module, not included by
    default, since v2.3.0 [C1 v2.3.0];
  - `webrtc-impl`: streaming the ID and selfie capture over WebRTC [D3] [C1 v2.10.9];
  - `sna-impl`: phone-number silent network authentication [D3] [C1 v2.25.0], built on a Vonage client library [D8];
  - `jp-my-number-impl`: Japanese My Number cards, driver's licences and residence cards over NFC [C1 v2.46.0];
  - `dynamic-feature`: for apps that load the SDK in an on-demand dynamic feature module [C1 v2.10.3] [C1 v2.14.0];
  - `inquiry-advanced-customizations-impl`: an alternative capture UI styling, named but **not documented** [C1 v2.31.0]
    [C1 v2.32.2].
- **Sentinel**, a separate passive-signal SDK for events outside an inquiry (`com.withpersona.sdk2:sentinel`, minSdk 23,
  `INTERNET` only, same version as the inquiry SDK) [H7]. It belongs to Persona's transaction product, which PLAN does
  not schedule for Phase 10 [R13].
- **Not recommended:** a WebView. Persona steers native apps to the SDKs and requires `is-webview=true` when a WebView is
  used anyway [D22].

### 1.2 Starting an inquiry

Persona's SDK starts a flow from a **builder** chosen by what the app holds [D3]:

| Entry point | What the app holds | Notes |
|---|---|---|
| `Inquiry.fromTemplate(templateId)` | An inquiry template id (`itmpl_`) | The SDK creates the inquiry on the client [D3]; Persona recommends moving creation to the server [D3] [D16]; a template can block client-side creation [D16] |
| `Inquiry.fromTemplateVersion(versionId)` | A template version | Locks creation to one version [D6] |
| `Inquiry.fromInquiry(inquiryId)` | An inquiry created on the server (`inq_`) | Add `.sessionToken(token)` once the inquiry has started (it is then `pending`) [D3]; tokens come from `POST /api/v1/inquiries/{id}/resume`, whose answer carries `meta.session-token` [D17] |
| `Inquiry.fromOneTimeLinkCode(...)` | A one-time link code | Named in the changelog and the share-token page [C1 v2.40.0] [D21]; its parameters are **not documented**. The resuming page still says one-time links are browser-only and unusable in the SDKs [D17]: the public pages disagree |
| `Inquiry.fromRelaySessionToken(token)` | A Relay session access token | v2.47.0+; a dedicated entry point that may not be combined with the others; omits the host app's identity and skips Play Integrity [D23] [C1 v2.47.0] |
| `fromStaticTemplate(...)` | A bundled JSON template | Experimental [C1 v2.5.0] |

**Builder options** (all optional [D3]):

| Option | Where | Behaviour |
|---|---|---|
| `environment(Environment.SANDBOX \| PRODUCTION)` | Template builders | Defaults to production [D3] [D4] |
| `environmentId(...)` | Template builder | Creates the inquiry in a given environment [C1 v2.8.0] |
| `referenceId(...)`, `accountId(...)` | Template builders | Links the inquiry to the host's user or to an account [D3] |
| `fields(Fields.Builder().field(name, value)…)` | Builders | Prefills inquiry fields; the guide's example uses `name_first` and `name_last` [D3], while the v1 migration table names camel-case keys (`nameFirst`, `addressStreet1`) [D6]: the key casing is **not documented** consistently. Typed fields include date, datetime, float, choices and multi-choices [C1 v2.2.23] [C1 v2.12.7]; `IntegerField` became a `Long` and `FloatField` a `Double` in 2.60.0 (breaking) [C1 v2.60.0] |
| `locale("fr")` | Builders | Overrides the device language [D3] [C1 v2.10.2] |
| `theme(ServerThemeSource(R.style.X))` | Builders | Local style overrides layered on the server theme (§3.1) [D3] [C1 v2.4.0] |
| `styleVariant(StyleVariant.LIGHT \| DARK)` | Builders | Forces light or dark instead of following the system [C1 v2.32.0] |
| `themeSetId(...)` | Template builder only | Picks the server theme set at creation [C1 v2.6.2] [C1 v2.30.0] |
| `redirectUri(...)` | Builders | Opened on completion, and since 2.46.0 on cancel too [C1 v2.29.0] [C1 v2.46.0] |
| `shareToken(...)`, `fieldMappings(...)` | Template, version, inquiry and one-time-link builders | Client-side redemption of a Connect share token (`cnst_`), with a consent screen [D21] [C1 v2.40.0] [C1 v2.45.0] |
| `fallbackMode(FallbackMode.defer)` | Template builder | Lets the server move the client to a fallback service; a fallback inquiry id starts with `iqfs` [C1 v2.13.0]. What the fallback is, is **not documented** |
| `routingCountry(...)` | Builders | Server region; deprecated since 2.15.0 [C1 v2.7.0] [C1 v2.15.0] |
| `consumeExceptions()` | Builders | The SDK swallows its own unhandled exceptions [C1 v2.10.14] |
| `Inquiry.cancelRunningInquiries()` | Static | Force-cancels every running inquiry in the app [C1 v2.10.16] |

### 1.3 The result contract

- **Registration.** `registerForActivityResult(Inquiry.Contract(context)) { result -> … }` from an activity or a
  fragment, then `launch(inquiry)` [D3]. The older `Inquiry#start` plus `Inquiry.onActivityResult` still works but is
  deprecated [D3] [D6].
- **Three outcomes** (a sealed `InquiryResponse`) [D3] [D6]:
  - `Complete`: `inquiryId`, a `status` (`completed` or `failed`; the field is a string so that it can grow), and
    `fields`, a map of field names to `InquiryField` values [D6] [C1 v2.0.0]. Persona's inline guide stresses that
    completing does not mean the person passed [D4].
  - `Cancel`: `inquiryId` and `sessionToken`, so the app can resume without a server call [D6] [C1 v2.0.0]. A flow killed
    because another activity started in a new task now reports `Cancel`, not `Error` [C1 v2.4.1].
  - `Error`: a `debugMessage` [D6] and, since 2.9.2, an error code [C1 v2.9.2]. Named codes: `SessionTokenError` (an
    unauthorised inquiry, or a step transition refused for an invalid token) and `NetworkError` [C1 v2.12.11]
    [C1 v2.22.1]. Error causes the docs name: unrecoverable network failures, misconfigured templates, the camera
    failing to open [D3], no internet at launch [C1 v2.0.3], a full disk [C1 v2.10.9], a refused permission
    [C1 v2.50.0]. **The full error-code list is not documented.**
- **Callbacks are not the truth.** Callbacks coordinate the app's UI with the flow; the inquiry's state must come from
  webhooks or the API, and post-inquiry workflows or review make the callback status unreliable [D3] [D15].
- **Collection mode** returns all locally collected data on completion [C1 v2.3.4]; how it is enabled is **not
  documented**.

### 1.4 Inline (fragment) mode

- `Inquiry.fromTemplate(…).toInlineInquiryBuilder().createFragment()` gives a fragment the host attaches itself [D4].
- Results arrive through the Fragment Result API under `DEFAULT_REQUEST_KEY` (changeable), decoded with
  `Inquiry.extractInquiryResponseFromBundle(bundle, context)` [D4].
- Custom navigation: the host implements `InlineInquiryController` and receives an `InlineInquiryScreen` in
  `onAttached`, with `goBack()`, `cancelInquiry(force)` and a `screenStateFlow` whose state says whether navigation is
  enabled and whether back and cancel should show [D4]. The API is `@ExperimentalInlineApi` [D4] [C1 v2.12.3].
- `handleBackPress(false)` leaves back presses to the host [C1 v2.16.1]; options decide whether the fragment may change
  system UI [C1 v2.12.3]; since 2.13.4 a finished inline inquiry stays attached until the host removes it
  [C1 v2.13.4].

### 1.5 Events during the flow

- `Inquiry.onEventListener` since 2.24.0 [C1 v2.24.0], and `InlineInquiryScreen.eventFlow` in inline mode
  [C1 v2.61.0].
- `InquiryEvent.StartEvent` fires whenever an inquiry **session** is created, carrying its session token (changed in
  2.18.0, a breaking change: it used to mean "inquiry created") [C1 v2.18.0] [C1 v2.18.1].
- `InquiryEvent.MiscInquiryEvent` (experimental, 2.50.0) groups activity most apps ignore [C1 v2.50.0]; 2.61.0 added
  events meant to match the web embedded flow: `DocumentCameraCapture`, `DocumentUpload`, `SelfieCameraCapture`,
  `StepTransitioning`, `CameraPermissionsCheckResult`, `LoadCameraFailed`, `CameraCaptureFailed` [C1 v2.61.0].
- Payloads and the full event list are **not documented**; the same "UI coordination only" rule applies [D15].

### 1.6 What the host app must declare and ship

- **Permissions merged from the SDK's manifest** [D3]:

  | Permission | Why (per Persona) | Platform class [A2] |
  |---|---|---|
  | `CAMERA` | ID, selfie and document capture | dangerous (runtime prompt) |
  | `RECORD_AUDIO` | Steps that record video | dangerous |
  | `INTERNET` | Talking to the backend | normal |
  | `ACCESS_NETWORK_STATE`, `READ_BASIC_PHONE_STATE` | Declared by the SDK since 2.35.0; phone state is read best effort for fraud prevention and may be removed from the merged manifest [D3] [C1 v2.35.0] | normal; `READ_BASIC_PHONE_STATE` exists from API 33 and is not dangerous |
  | `NFC` | Only with `nfc-impl` [D3] | normal (API 9) |

  Location is not in the list, yet the SDK collects GPS when a template requires it [C1 v2.12.5] [C1 v2.22.2]; how it
  obtains the permission is **not documented** (the dependency list includes Play services location [D8]).
- **Google Play Data safety.** The SDK reads the App Set ID for fraud prevention, to be disclosed as "Device or other
  IDs", collected, not shared, required [D3] [G4]; Persona's longer page lists names, personal identifiers, address,
  photos or videos and device identifiers as collected, and approximate and precise location as not collected [D7] —
  which does not match the GPS collection above (inference: the page predates it or assumes it off).
- **R8 / ProGuard.** No app-side rule is documented; the sample app adds none [G5]. The SDK fixed an R8 full-mode crash
  [C1 v2.9.1] and narrowed its own rules [C1 v2.56.0], so its consumer rules travel inside the AAR (inference).
- **Other host constraints the changelog records:** `android:supportsRtl` affects text alignment [C1 v2.3.2]; 16 KB
  memory pages are supported since 2.19.0 [C1 v2.19.0]; class or namespace clashes with apps that use
  `json-logic-kmp` or Markwon were fixed [C1 v2.48.0] [C1 v2.46.1]; licences of the bundled libraries must ship with the
  app [D3] [D8].
- **Not documented:** whether the SDK blocks screenshots (`FLAG_SECURE`), its APK size, its network endpoints for
  allowlists, and certificate pinning.

### 1.7 What the vendor's choices tell OpenVerify (inference)

- The vendor keeps one activity contract and adds a fragment mode only later, as experimental; most of the behaviour is
  server-driven (UI steps, components, strings, themes), so the SDK's public surface stays small.
- Template-based client creation is offered but discouraged and can be blocked per template [D3] [D16]; OpenVerify has
  no client-side creation on any client today (§5) [R4] [R19].

## 2. Capture and verification on the device

### 2.1 Document (government ID) capture

- **Capture methods** are set per template and per device class: desktop web, mobile web and native mobile, the last
  one for SDK integrations [H5]. Upload as a capture method is **off by default on mobile**, for the web flow and the
  SDKs alike [D20]. Analytics label each submission `Auto`, `Manual`, `Upload` or `Combo` (front and back captured
  differently) [H14].
- **Auto-capture.** The ID screen captures automatically, with the auto-capture behaviour configurable from the server
  since 2.2.24 [C1 v2.2.24]. A manual shutter appears after a server-configured delay [C1 v2.2.21], and at once on a device
  that cannot auto-capture [C1 v2.2.12]. A readable MRZ is one auto-capture trigger [C1 v2.16.3]. The number of images
  taken per side is server-configured [C1 v2.2.21].
- **Guidance on screen.** Server-configurable overlays and hint animations [C1 v2.2.7], a capture-tips button
  [C1 v2.6.0] and a short tips text under the feed [C1 v2.25.2], a passport-specific instruction [C1 v2.50.0], a torch
  used for holograms and switched on automatically in video flows [C1 v2.45.2] [C1 v2.32.2], an optional watermark text
  over the feed [C1 v2.33.0], and the screen kept on while capturing [C1 v2.2.30]. A review screen shows the capture
  before submission [C1 v2.2.9] [C1 v2.56.0].
- **ID type.** The user picks country and ID type, or auto-classification decides it from the capture, with a manual
  fallback screen [C1 v2.11.0] [C1 v2.13.2]; a single allowed type skips the picker [C1 v2.2.13].
- **Camera quality.** Persona recommends at least 1920×1080; 1280×720 auto-captures inconsistently; below 640×480 the
  flow asks the user to switch device or upload, if upload is allowed [D11].
- **Video.** A template can require video of the capture, recorded locally (uploaded in chunks since 2.53.0) or streamed
  over WebRTC with `webrtc-impl` [C1 v2.5.0] [C1 v2.10.9] [C1 v2.53.0]; this is why `RECORD_AUDIO` is declared [D3].
- **What runs on the device.** The camera module depends on ML Kit barcode scanning, text recognition and face detection
  [V5]; a text-extraction module adds ML Kit entity extraction [V8]; v2.5.0 added text extraction on the client
  [C1 v2.5.0]. Whether blur, glare or framing are judged on the device, and against which thresholds, is **not
  documented** (inference: the detectors drive auto-capture, and the verification checks run on the server, since the
  check catalogue is a server feature [D14]).

### 2.2 Barcode reading for the back of IDs

- A template can require the **back** or the **barcode**, never both; the front is always required [H6]. The barcode
  overlay frames the barcode, not the card edges [H6].
- Three checks need the barcode: barcode detection, barcode inconsistency and extraction inconsistency [H6]
  (OpenVerify's `id_barcode_detection`, `id_barcode_inconsistency_detection`, `id_extraction_inconsistency_detection`
  [R1]).
- The SDK scans PDF417 on the device: "faster barcode detection" [C1 v2.2.26], server hint assets for PDF417 scans
  [C1 v2.11.6], and a crash fix when a scanned barcode carried no expiry date [C1 v2.7.1], which shows that the SDK
  parses at least the expiry from the barcode (inference). Both zxing core 3.5.3 [D8] and ML Kit barcode scanning [V5]
  are bundled; which one decodes what is **not documented**.

### 2.3 Selfie and liveness

- **Poses.** Three poses (left, centre, right) or centre only [H13]; a `configurable_poses` flow type randomises their
  order [C1 v2.11.0]; the instructions animation previews the sequence the user is about to perform [C1 v2.42.0].
- **Capture.** Centre-pose auto-capture [C1 v2.2.5]; left and right auto-capture only after their animation plays
  [C1 v2.2.10]; a stricter auto-capture under a "strict selfie" flag [C1 v2.10.19]; customisable auto and manual capture
  [C1 v2.12.17]; selfie previews [C1 v2.12.17]; a configurable disclaimer on the capture screen [C1 v2.44.0].
- **Signals sent with the selfie:** whether the screen flash fired, to help in low light [C1 v2.52.0], and capture
  timestamps (in UTC since a 2.61.0 fix) [C1 v2.61.0]. Video capture improves selfie detection [C1 v2.58.0].
- **On the device:** ML Kit face detection [V5]. The liveness decision itself is a server check (selfie checks and their
  sub-configurations live in the verification template [H13]); the on-device model and any passive liveness on the
  device are **not documented**.

### 2.4 NFC chip reading

- **Availability.** Only through the mobile SDKs; there is no web path [H3]. The Instant App could not do NFC either
  [D9]. It is plan-gated: not on the entry plans, limited on Growth, available on Enterprise [H4]. A device without an
  NFC reader gets an error dialog [C1 v2.12.7]; a phone with NFC switched off is sent to the NFC settings [C1 v2.10.10].
- **Documents.** ICAO-compliant passports with a chip, and some European national ID cards, passport cards and residence
  permits [H3]; Japanese My Number cards (reading the My Number and signing operations), driver's licences and residence
  cards through `jp-my-number-impl`, built on PocketSign libraries [C1 v2.46.0] [C1 v2.58.0] [C1 v2.61.0]. The help
  center names the US Passport Card as a document without a chip [H12].
- **Access.** MRZ-based access (the MRZ is captured first, inference) and Card Access Number authentication since 2.12.0
  [C1 v2.12.0]. BAC versus PACE is **not documented**.
- **What is read.** The help center lists name, date and place of birth, issue and expiry dates and the portrait image
  [H4]; the data groups read are configured from the server since 2.11.2 [C1 v2.11.2]. The exact data groups, and whether
  SOD, DG14, DG15 or the card security file are uploaded, are **not documented**.
- **Chip authentication.** Fixes mention passports without Chip Authentication and French IDs whose Chip Authentication
  failed [C1 v2.43.0] [C1 v2.41.1], so the SDK runs Chip Authentication on the device (inference). Active Authentication,
  and where Passive Authentication runs, are **not documented**; the check list is visible only in the dashboard [D14].
- **The user's view.** The chip data are shown for review before submission [H4]; a bottom sheet with progress
  [C1 v2.27.0], troubleshooting tips (shown when the user cancels the scan) [C1 v2.27.0] [C1 v2.44.0], retries after a
  dropped connection [C1 v2.51.0], and a template-set number of failed attempts before an alternative is offered
  [C1 v2.44.0]. The help center's fallbacks are device handoff to an NFC phone, a photo of the data page, or asking the
  business [H12].
- **Robustness fixes worth copying as tests:** the reader is registered only while the scan screen is visible
  [C1 v2.30.0]; process death and restore during a scan [C1 v2.30.0] [C1 v2.21.0]; the document lifted and put back
  mid-scan [C1 v2.53.0]; an Arabic system locale breaking passport reads [C1 v2.53.0] (inference: digits or dates
  formatted with the locale in the MRZ key); certain days of the month [C1 v2.21.0].
- **Sandbox.** Simulated chip data in sandbox, on by default, toggled by a long press on the sandbox button
  [C1 v2.12.11].
- **Library.** JMRTD under the LGPL, in the optional module only [D8]; the 2.60.0 POM pins JMRTD 0.8.1, Bouncy Castle
  `jdk15to18` 1.84 and `scuba-sc-android` 0.0.26 [V4].

### 2.5 Device signals and integrity

- **Identifiers.** The App Set ID, sent in request headers since 2.2.24 [C1 v2.2.24] [D3]; it is a Google Play services
  value scoped to one developer account's apps, reset after 13 months unused [A1]. A device object holds
  `device-vendor-id`, `device-fingerprint` and `browser-fingerprint` [D24]; one session is tied to one device and an
  inquiry allows 25 sessions by default [D25].
- **Integrity.** The SDK depends on Play Integrity 1.4.0 [V6] [D8]; a 2.32.2 fix made "integrity checks" run when they
  had not [C1 v2.32.2]; Relay mode skips Play Integrity app attestation [D23]. The signal list names device integrity
  and a "rooted device detected" signal [H8] [H9]. How the verdict is requested (nonce, request hash), which verdict
  fields are kept, and what happens without Google Play services are **not documented**. Appdome threat-event modules
  exist [V1] [V6]; their behaviour is **not documented**.
- **Other device facts:** camera properties and locale [H8]; app bundle identifiers seen across sessions [H9]; GPS when
  the template asks [C1 v2.12.5]; whether a phone call is active when the inquiry starts (phishing) [C1 v2.51.0]; a
  dismissable phishing warning when the flow continues on another device or network than the one it started on
  [C1 v2.55.0]; basic phone state, best effort [D3].
- **Behaviour signals** (bot score, behaviour threat level) are collected in hosted, embedded and mobile SDK
  integrations, and their set is a template setting [H16]. Emulator detection and hooking detection are **not
  documented**.
- **Values on the API** use SI units: distances are metres [D19].

### 2.6 Other on-device features (recorded; out of Phase 10's scope unless the plan adds them)

Silent network authentication (`sna-impl`) [D3] [C1 v2.41.0]; an mdoc component with Google Wallet [C1 v2.26.0];
credit card collection [C1 v2.25.0]; reusable Persona wallets [C1 v2.10.10]; a third-party "integration step"
[C1 v2.22.0]; hosted web steps opening inside the inquiry instead of a browser tab [C1 v2.61.0]; a copy-to-clipboard
button [C1 v2.52.1]; a file upload component [C1 v2.42.0]; QR code components [C1 v2.2.43]; e-signature styling
[C1 v2.9.2]. Most are server-driven UI components rendered natively.

### 2.7 Device versus server, as far as the public sources go

| Work | On the device (Persona) | On the server (Persona) | Basis |
|---|---|---|---|
| Framing, auto-capture trigger | Yes (ML Kit detectors) | — | [V5] [C1 v2.2.24] |
| Blur, glare and other quality verdicts | **not documented** | The verification checks | [D14] [H6] (inference) |
| ID type | Auto-classification with manual fallback | Same classification feeds checks (inference) | [C1 v2.11.0] |
| Text extraction | Yes (since 2.5.0) | Yes, for the checks (inference) | [C1 v2.5.0] [V8] |
| PDF417 decoding | Yes | Barcode checks | [C1 v2.2.26] [H6] |
| Selfie face detection | Yes | Liveness and comparison checks | [V5] [H13] |
| Chip access and Chip Authentication | Yes | **not documented** | [C1 v2.12.0] [C1 v2.43.0] |
| Passive and Active Authentication | **not documented** | **not documented** | [D14] |
| Device integrity | Play Integrity call | Verdict as a signal (inference) | [V6] [H8] |

## 3. Theming, localisation and accessibility

### 3.1 Theming

- **Server-side theming is the model.** Themes are built in the dashboard's theme editor (colours, fonts, font sizes and
  weights, button styles, advanced settings) as **theme sets**, applied per template, with an organisation default
  [H11]; mobile SDKs follow them from v2 on, so one theme covers web, Android and iOS [D26]. The changelog calls this
  "SST" (server-side theming) [C1 v2.12.3] [C1 v2.40.0]. Colours from the server are `#RRGGBBAA` since 2.8.0 [C1 v2.8.0].
- **Client-side theming is legacy.** Apps once extended `Persona.Inquiry.Theme` with Material attributes
  (`colorPrimary`, `colorSecondary`, `colorPrimaryVariant`, `textAppearanceHeadline`, `materialButtonStyle`,
  `textInputStyle`, `personaFooterBackgroundColor`, …); Persona publishes a mapping from each to a theme-editor property
  and asks apps to remove the client code, with some properties still unmapped [D5]. `theme(ServerThemeSource(style))`
  keeps the server theme and lets a local style add what the server cannot, such as a custom loading animation
  (`personaInquiryLoadingLottieRaw`) [D3]; `ClientThemeSource` is deprecated [C1 v2.4.0].
- **Local asset overrides.** The SDK looks up animations and images by resource name: `res/raw/`, then `assets/` (with
  original casing), then a network URL [C1 v2.38.0]; renaming a resource is a breaking change (for example the selfie
  processing animation became `raw/pi2_selfie_processing`) [C1 v2.40.0]; SDK resources carry a `pi2` prefix to avoid
  clashes [C1 v2.10.9]. Server-set SVG colours apply only to SVGs placed in `raw` [C1 v2.9.1].
- **Fonts.** System font by default; a font named in the theme is either downloaded at run time when uploaded to the
  template [C1 v2.18.0] or bundled by the app in `res/font` (name lower-cased, `-` and spaces become `_`) or
  `assets/fonts` [D3]. Custom fonts outside Persona's themes are an Enterprise feature [D3]. Below Android 10 only normal
  and bold weights can be synthesised [D3].
- **Light and dark.** The SDK follows the system unless `styleVariant` forces one [C1 v2.32.0]; the default theme refuses
  "force dark" because of contrast problems [C1 v2.36.0].
- **Window chrome.** Edge-to-edge since 2.10.6 [C1 v2.10.6]; status bar coloured to each page's background
  [C1 v2.3.4].

### 3.2 Localisation

- **Language choice.** The device language by default; `.locale(code)` overrides it [D3] [H10]; the user can change the
  language with a selector in the footer of the flow's first screen [D12] [H10].
- **Languages.** 46 locale codes, BCP 47 style, from `ar-EG` to `zh-TW`; the right-to-left ones are `ar-EG` and `he`
  (`ur` is listed as Urdu in Roman script) [D12]; the help center says 35+ [H10]. Welsh came in 2.3.6 [C1 v2.3.6].
- **Strings come from the server.** Over 2022 the SDK removed local string resources in favour of server-supplied text
  [C1 v2.1.3] [C1 v2.2.4] [C1 v2.2.15]; templates carry per-screen translations editable in the dashboard, exportable and
  importable as CSV, with automatic translation [H10]; localisation overrides reach the capture screens and the
  processing screen [C1 v2.2.44] [C1 v2.10.11] [C1 v2.60.0]. Persona's own copy is therefore not something to translate
  locally (and must not be copied).
- **Layout under translation.** Cancel-dialog buttons stack vertically so long strings fit [C1 v2.27.0]; right-to-left
  alignment depends on the host's `supportsRtl` [C1 v2.3.2]; a locale override that the UI ignored was fixed in 2.43.0
  [C1 v2.43.0].

### 3.3 Accessibility

- Persona aims at WCAG (it links WCAG 2.2) for colour, text size, keyboard navigation and screen readers, and names
  Android TalkBack among the readers it aims to support [D13]. No conformance claim, audit or VPAT for the Android SDK is
  published: **not documented**.
- The Android changelog records: TalkBack, touch-target size and spoken text improvements [C1 v2.2.42]; layouts fixed
  for large font scales [C1 v2.2.32]; a bigger back and close target [C1 v2.2.17]; a visible focus box for keyboard users
  [C1 v2.38.0]; "various accessibility bugs" [C1 v2.38.0]; haptic feedback on older Android versions [C1 v2.2.2]; the
  force-dark refusal for contrast [C1 v2.36.0].

## 4. Versioning, release cadence, supported Android versions and migrations

### 4.1 Major versions

- **v1** (`com.withpersona.sdk:inquiry`, legacy `tmpl_` templates) is deprecated since **2022-12-31** [D6]. **v2**
  (`com.withpersona.sdk2:inquiry`) is required for dynamic-flow templates (`itmpl_`) [D6]; v2.0.0 shipped on 2021-08-05
  [C1 v2.0.0] and the package moved from `com.withpersona.sdk` to `com.withpersona.sdk2` in 2.2.0 [C1 v2.2.0]. v1 (at
  least 1.1.18) and v2 can run side by side in one app for a staged move, with separate theme roots
  (`Persona.Inquiry1.Theme`, `Persona.Inquiry2.Theme`) [D6].
- **v1 → v2 breaking changes** [D6]: `Success` and `Failure` merged into `Complete` with a `status`; `Cancel` and `Error`
  renamed into `InquiryResponse`; `accessToken` renamed `sessionToken`; `note` removed; typed `Fields.Builder` setters
  replaced by `field(name, value)`; `Relationships` and `Verification` removed from the response; themes moved from
  AppCompat to Material attributes. New in v2: `fromTemplateVersion`, the session token on `Cancel`, and `fields` on
  `Complete` [D6].
- Android has had **no v3**; the iOS SDK has (`migrate-from-ios-sdk-v2-to-v3` in the index [D1]), which is out of scope.

### 4.2 Release cadence and how breaking changes ship

- **Volume.** 220 v2 releases from 2021-08-05 to 2026-10-21 [C1]: 50 in 2022, 34 in 2023, 34 in 2024, 45 in 2025, and 51
  in 2026 up to 2026-10-21; 18 in the 90 days before 2026-10-21 [C1] (counted from the changelog headings; dates are the
  changelog's, and the GitHub release times agree within a day [G2]).
- **Breaking changes ship in minor releases**, flagged "Breaking change" in the entry: 2.8.0 (routing country type, colour
  format), 2.18.0 (`StartEvent` meaning), 2.30.0 (`themeSetId` removed from `InquiryBuilder`), 2.40.0 (a resource
  rename), 2.59.0 (Sentinel result type), 2.60.0 (`IntegerField`, `FloatField`) [C1]; also 2.2.0 (2022-01-25), whose
  "Breaking" section renames the package `com.withpersona.sdk` to `com.withpersona.sdk2` (corrected in fact-check: this
  entry was missing from the list) [C1 v2.2.0]. Deprecations come first where
  possible: `routingCountry` was deprecated in 2.15.0 with removal "in a coming release" [C1 v2.15.0].
- **Maintenance lines.** Persona patches older minors after newer ones ship: 2.8.1–2.8.3 after 2.9 and 2.10
  (2023-09/10), 2.14.3–2.14.4 after 2.15–2.16 (2025-04), 2.21.1 after 2.22 (2025-09-24), 2.45.2 on the API 21 floor after
  2.48.0 raised it to 23 (2026-07-28), 2.57.1 after 2.60.0 (2026-10-14) [C1] [G2].
- **Advice to integrators:** update monthly or quarterly, automate with Dependabot or Renovate, watch
  `persona-id/inquiry-android-2`, read every entry for breaking changes, and test in CI before release [C1].
- **Release artefacts.** The changelog repository holds no code and no licence [G1]; Maven Central's javadoc jars are
  empty placeholders [V10]; the hosted API reference is a stale 2.3.x Dokka build [P1]. In practice the changelog is the
  only versioned API record (inference).

### 4.3 Supported Android versions and toolchain

| Item | Value | Since | Source |
|---|---|---|---|
| Minimum API | **23** (Android 6.0) | 2.48.0, 2026-07-14 (21 before; the 21 line got 2.45.2 on 2026-07-28) | [D3] [C1 v2.48.0] [C1 v2.45.2] |
| compileSdk | 36 | 2.22.0, 2025-09-03 (35 before) | [C1 v2.22.0] |
| Target API 36 behaviour | A back-press bug when targeting 36+ fixed | 2.46.0 | [C1 v2.46.0] |
| AGP, Kotlin | AGP 9.0.1, Kotlin 2.2.10 (KSP 2.2.10-2.0.2) | 2.46.0, 2026-07-02 | [C1 v2.46.0]; the 2.60.0 POM depends on `kotlin-stdlib` 2.2.10 [V3] |
| Java | 17 source and target | (current guide) | [D3] |
| 16 KB pages | Supported | 2.19.0, 2025-07-01 | [C1 v2.19.0] |
| Maximum tested Android version | **not documented** | — | — |
| End-of-support policy per SDK version | **not documented** | — | — |

The RN wrapper asks for AGP 8 or later [D27]. A 2.3.0 entry reads "Upgraded minimum SDK to 33" and 2.2.46 "Downgraded
minimum SDK from 33", with 2.2.46 dated before 2.3.0 [C1 v2.3.0] [C1 v2.2.46]; both headings still say "SDK 21+", so this
is read as a compile-SDK slip, not a floor change (inference).

### 4.4 Other migrations

- **Client to server theming** (§3.1) [D5] [D26].
- **Instant App** links (`miniapp.withpersona.com/inquiry`, `/verify`) ended with Google Play Instant in December 2025
  [D9] [A3]; the native path without the customer's own app is now the installable Persona Wallet app on Android (an App
  Clip on iOS) [H15].
- **Field types** became 64-bit in 2.60.0 [C1 v2.60.0]; **`StartEvent`** semantics changed in 2.18.0 [C1 v2.18.0].

## 5. OpenVerify today (read-only inventory)

Working tree `91c83e02`, read 2026-10-29. Phase 6 is being closed in the same tree; Phases 7 and 8 are planned, not built;
Phase 10 is pending [R21].

**Build.** `:openverify-sdk` is one Kotlin Multiplatform library (Android, `iosArm64`, `iosSimulatorArm64`) with
Compose Multiplatform screens in `commonMain` [R2] [R8]; minSdk **26**, compileSdk and targetSdk **36**, JVM toolchain 21;
Kotlin 2.4.21, AGP 9.4.1, CMP 1.11.1, Ktor 3.5.2 over OkHttp 5.4.0, CameraX 1.6.2 [R8]. The CI floor is 1,264 SDK host
tests, none skipped (`.github/workflows/ci.yml`, read only). The SDK sends `User-Agent: OpenVerify-Android/0.1.0` [R10].
It is **unpublished** (no Maven coordinates, no release process) [R2].

**Public API** [R4] [R5] [R6]:

- `OpenVerifyInquiry.Contract` (`ActivityResultContract<Request, InquiryResult>`) with
  `Request(inquiryId, sessionToken, apiBaseUrl)`; the server creates the inquiry and the session with an API key
  (`POST /api/v1/inquiries/:id/resume`), and https is required except for loopback and the emulator's `10.0.2.2`.
- `OpenVerifyInquiry.fromOneTimeLink(url, apiBaseUrl?)` and `OneTimeLinkContract`: the fragment link
  `#inquiry-id=…&one-time-token=ovo_…`, redeemed once by the SDK, the token kept in memory only.
- `InquiryResult`: `Completed(inquiryId, inquiryStatus)`, `Failed(inquiryId?, reason)` with 11 `FailureReason`s
  (`INQUIRY_FAILED`, `INQUIRY_EXPIRED`, `SESSION_EXPIRED`, `SESSION_CANCELED`, `INQUIRY_REDACTED`, `LINK_INVALID`,
  `INVALID_REQUEST`, `UNSUPPORTED_FLOW`, `NETWORK_ERROR`, `SERVER_ERROR`, `STILL_PROCESSING`), and
  `Canceled(inquiryId?)`. No session token and no field values come back to the host; `toString` redacts tokens.
- Nothing else is public for hosts: no template entry, no environment, reference id, account, prefill, locale, theme or
  style option, no event listener, no inline or composable entry (`InquiryFlowScreen` is `internal`), no cancel-all.
  `OpenVerifyTheme` is a plain Material 3 light/dark scheme "for later theme sets" [R10].

**Hosting** [R6] [R7]: an internal `OpenVerifyInquiryActivity` (not exported) sets `FLAG_SECURE`, goes edge to edge, and
routes the system back button to the flow's own back action. The manifest declares only `INTERNET` and `CAMERA`, and marks
`android.hardware.camera.any` not required. The camera permission is asked only after an explanation screen.

**Flow renderer** [R10]: server-driven steps `consent`, `government_id`, `selfie`, `phone_otp`, `email_otp`, `database`,
`aamva`, `crypto_wallet` (paste only), `document`, `database_business`, `business_website`, `completion`, `failure`; any
other step, `nfc` included, renders the unsupported screen and ends `UNSUPPORTED_FLOW`. Transitions use the SDK's own
`JsonLogic` subset.

**Capture today** [R10]:
- Government ID: CameraX still capture with a **manual shutter**; sides front, back or both; a photo may be picked instead
  of taken only in a sandbox (for a selfie, or an ID step that allows upload): production photos always come from the
  live camera (`FlowCoordinator.uploadAllowed`). **No on-device quality gating, no auto-capture, no PDF417 decoding** on the
  device; retry hints come from the server's reason codes (`image_blurry`, `glare_present`, `barcode_not_found`,
  `portrait_blurry`, `face_glare` and others, mapped in `ui/Messages.kt`).
- Selfie: the C40 protocol: a server capture with a 180 s lifetime, prompts in the server's order (`center`, `left`,
  `right`), one camera session for all prompts, a manual shutter, `passive` or `active` liveness decided by the server,
  and the C40.4 device snapshot (camera ids, facing, resolution, frame rates, `image-mirrored`) as client claims.
- Document: camera or a file through the system document picker.

**Strings and locale** [R2] [R10]: 296 English strings plus Spanish, in Compose Multiplatform resources; the locale is the
JVM default (the device's), with no override; consent is recorded in the language shown.

**NFC** [R9] [R11] [R14] [R22]: `openverify-nfc` is an empty Android library, kept apart for the LGPL; `BacKeySeed` (the
MRZ key input) is common code. The flow-spec `nfc` step is marked `androidOnly: true` with an optional `maxAttempts`. The server side exists since Phase 5, and `docs/checks/nfc.md` already states the client's sequence [R23]: create
the `government-id-nfc` verification, upload each chip file to `…/files` with its kind (DG2 up to 1 MiB, the others
64 KiB; DG11 and DG12 are not taken), ask for a challenge, let the chip sign it, submit. The parts are: chip challenges
(`POST /verifications/:id/chip-challenges`, an 8-byte nonce, 300 s), the chip file kinds (`chip-sod`, `chip-dg1`, `chip-dg2`, `chip-dg14`, `chip-dg15`,
`chip-card-security`, `chip-card-access`, `chip-com`), the `{ chip: { challenge-id, nonce,
active-authentication-response?, device-report? } }` submit, Passive Authentication against an operator-synced trust
store, server-verified Active Authentication, and DG1-to-MRZ and DG2-to-selfie bindings.

**Device signals** [R10] [R12] [R13]: only the C40.4 camera snapshot and the User-Agent. Phase 7 (planned) adds a
`DeviceSignals` seam with debugger facts and an `ANDROID_ID` HMAC after consent, and leaves emulator, root and hooking
heuristics and Play Integrity to Phase 10.

**Demo app** [R18]: one screen that launches either contract from a pasted inquiry id, session token or one-time link and
shows the result; secrets live in memory only, never in saved state; minSdk 26, no Maven publishing involved.

**Web flow, for comparison** [R19]: the hosted flow also starts only from `#inquiry-id=…&session-token=…` or a one-time
link; no client creates an inquiry from a template.

## What the phase plan should take from this (proposed)

Everything here is a proposal for `docs/plans/phase-10.plan.md`; library versions and build mechanics are the engineering
note's [N1].

### Must match (parity)

1. **Keep the activity-result contract as the one entry point** and extend `Request` and `OneTimeLink`, source-compatibly
   with defaults, by `locale: String?` (M8) and `appearance: SYSTEM | LIGHT | DARK` (M32). Both flow through the intent
   extras like today's fields [R4] [R6].
2. **An optional event callback** (M10): a small sealed `OpenVerifyEvent` set in `commonMain` (started, step shown by
   type, camera permission result, capture failed, submitted, ended), with no PII and no tokens, documented as UI
   coordination only, as Persona says of its own callbacks [D15]. Delivery from the activity to the host needs a
   process-local channel the host registers before launch (inference: intents cannot carry a callback).
3. **On-device capture guidance** (M15, M17): card framing, sharpness, glare and MRZ-zone presence for IDs; YuNet face
   framing and pose hold for selfies; auto-capture when the condition holds, with the manual shutter after a delay and
   immediately on devices that cannot run the model (Persona's own fallback [C1 v2.2.12]). One contract fixture holds
   the shared thresholds so the device and the server cannot drift. The server re-measures and decides every frame.
4. **PDF417 guidance** (M26) with zxing core on the device, only to tell the user the barcode is readable; the server
   re-decodes.
5. **`openverify-nfc` end to end** (M18–M22): PACE (MRZ or CAN) then BAC; read exactly the C52.4 file kinds; AA over the
   server's challenge, fetched before the tap so that one tap does everything (and the server order confirmed, M21); CA for secure messaging, reported only in `device-report`; DG1 shown for review; no-reader,
   NFC-off, lifted-document, retry and attempts states; reader mode only while visible. **The seam:** a `ChipReader`
   interface in `commonMain` of the Apache-2.0 SDK (so iOS can implement it later), implemented in the LGPL module, and
   installed by the host into a process-wide registry before launch, since `:openverify-sdk` must never depend on
   `:openverify-nfc` [R9] (the registry is inference; ServiceLoader would need R8 keep rules).
6. **Device signals** (M23–M25): root, emulator and hooking indicators as H-tier facts (`beta`, reasons, never a pass);
   Play Integrity as an optional adapter artifact with a sandbox provider, its nonce bound to the session by the server
   and the verdict checked on the server; the product and CI work without it.
7. **Theme sets and translations** (M31, M33): decode the Phase 9 contracts from the flow session; bundle Phase 9's five
   languages for SDK strings; Arabic with RTL; template texts rendered as the server sends them.
8. **Accessibility pass** (M35) mapped to WCAG 2.2 AA, with Compose UI tests for labels, targets, font scale, focus order
   and spoken capture prompts on Android.
9. **Shipping** (M1, M14, M37, M40): Maven Central artifacts with sources and Dokka docs, consumer R8 rules, the demo app
   built with R8 full mode in CI, a dated `CHANGELOG.md` stating minSdk and "Breaking" per release, and a public-API
   compatibility check.
10. **The README** (M9, M36, M41): the permissions, `FLAG_SECURE`, the `FailureReason` table with what the host should do,
    what the SDK sends per tier for the Play Data safety form (with the operator responsible for the answers), and
    "webhooks, not callbacks".
11. **A sandbox test chip** (M43), so the NFC step can be exercised on a phone without a real passport and without real
    data.

### Ours, keep and label

- Inquiries are created only by the customer's server; no client-side template creation, no client-set reference id,
  account or prefill (M3, M6, M7).
- A session token is always required; a one-time-link token never leaves the SDK; results carry no fields and no token
  (M4, M5, M9).
- Minimal permissions (`INTERNET`, `CAMERA`; `NFC` only in the NFC module), minSdk 26, no App Set ID, no on-device OCR,
  production photos only from the live camera, `FLAG_SECURE` (M2, M13, M25, M27, M28, M36).
- Guidance is never a verdict: liveness, quality, barcode and chip results are the server's (M16, M17, M21, M26).
- Semantic versioning stricter than the vendor's: no breaking change in a minor after 1.0 (M37).

### Build order (proposed slices)

1. **Contracts** (alone): `Request` additions, the event model, the `ChipReader` seam and the chip-challenge and upload
   calls on `FlowApi`, the guidance-threshold fixture, the theme-set and translation decoding (if the Phase 9 contracts
   exist), the NFC step leaving the unsupported list.
2. **In parallel:** capture guidance (ID and selfie); PDF417 guidance; `openverify-nfc`; device signals and the Play
   Integrity adapter (after Phase 7's `DeviceSignals` seam exists); theming, languages and accessibility.
3. **Shipping and demo:** publishing, R8, docs, the demo app's NFC and App Links paths, the sandbox chip.
4. **Integration:** the full-stack e2e cannot drive a real camera or chip on Linux; the instrumented tests run on the CI
   emulator (PLAN Phase 10 [R1]), and the NFC path is covered by host tests over a fake `IsoDep` transport plus the
   sandbox chip end to end (inference).

**Order against other phases.** Phase 10 depends on Phase 7 (the `DeviceSignals` seam and the handoff step, K11, K13) and
on Phase 9 (theme sets, translations, the flow builder's NFC fallback route, M22, M31, M33); Phase 11 adds the share
token (M38).

### Nice to have / later

The inline Compose entry (M11); the SDK as a device-handoff target through App Links (M12); client-side template
creation (M3); video and WebRTC (M29); silent network authentication, mdoc wallets, Japanese My Number cards (M30); an
OpenVerify reference app on Google Play (M42).

### Open questions (no public answer)

- Persona's on-device quality thresholds and whether any verdict is taken on the device (§2.1).
- Which data groups Persona reads, whether it runs Active Authentication, and where Passive Authentication runs (§2.4).
- The full Android `ErrorCode` list and the event payloads (§1.3, §1.5).
- How the Play Integrity verdict is requested and used, and what happens without Google Play services (§2.5).
- What the Appdome threat-event modules do (§2.5).

## Needs the owner

| # | Decision | Recommended default | Why |
|---|---|---|---|
| O1 | **SCUBA's two `GPL-2.0-only WITH Classpath-exception-2.0` files** (Phase 5 decision 40, K7). Under CLAUDE.md rule 4 GPL code fails even inside `openverify-nfc`, so NFC cannot ship without an explicit exception | Grant a **narrow, recorded exception**: those two files, unmodified, only inside the separate `openverify-nfc` artifact, listed in `THIRD_PARTY_LICENSES.md`. If declined, Phase 10 builds the module but does not publish it, and NFC waits | The Classpath exception is written to let independent modules link without taking on the GPL (general knowledge of its text, **not re-read on 2026-10-29**: verify before deciding); Persona ships the same library family in its optional NFC module [V4] [D8] [R11] |
| O2 | **Maven coordinates and a publishing account** (a Sonatype Central namespace, signing key) | A group id the owner can verify (for example `dev.openverify` if the owner controls that domain, otherwise a GitHub-based namespace); the Kotlin packages stay `dev.openverify.*` | Central needs a verified namespace and signed artifacts; details are the engineering note's [N1] |
| O3 | **Play Integrity**: a Google Cloud project and Play Console app to test the real adapter | Build the adapter and its sandbox provider; real calls only when an operator configures their own project; CI uses the sandbox | A proprietary service: allowed only as an optional adapter the product works without (task rule 3) [V6] [R1] |
| O4 | **Client-side creation from a template** (M3) | No, not in this release, on any client | Persona discourages it and lets templates block it [D16]; it needs public client keys and abuse limits OpenVerify does not have |
| O5 | **What the web flow does at an `nfc` step** (K6) | Keep the unsupported screen on the web, reworded to say the step needs the operator's Android app; the Phase 9 flow builder offers a fallback route around it | Persona offers NFC only through the mobile SDKs [H3]; the flow-spec already marks the step Android-only [R22] |
| O6 | **An inline (Compose or fragment) entry** (M11) | Defer; the activity contract only | Persona's inline API is still experimental after two years [C1 v2.12.3] [D4]; the activity owns `FLAG_SECURE` and process death |
| O7 | **minSdk** (M2) | Keep 26 (Persona: 23) | `ANDROID_ID` per signing key from Android 8.0, and the NFC module's API needs [R11] [R12] |
| O8 | **SDK languages** (M33) | Phase 9's five (en, es, fr, de, ar), Arabic with RTL | Matches PLAN Phase 9 [R1]; Persona's 46 are its own translations and must not be copied [D12] |
| O9 | **Release and support policy** (M37, M40) | 0.x until the first Android release; then semantic versioning, patches on the latest minor only, a dated changelog | A small project cannot run Persona's several maintenance lines [C1] |
| O10 | **An OpenVerify-branded app on Google Play** (the Persona Wallet analogue, M42) | No; the demo app stays a sample, not a product | Publishing an app is an account, review and support commitment; operators embed the SDK in their own app |
| O11 | **Video capture and WebRTC** (M29) | No | Not in PLAN; it would add `RECORD_AUDIO` and a media pipeline |
| O12 | **Root, emulator and hooking heuristics** (M24): which indicators to read | The Phase 7 research list (build tags, `su` paths, known emulator products, Frida and Xposed traces), without `QUERY_ALL_PACKAGES` and without reading accessibility services | Each is a heuristic a controlled device can hide [R12]; package-visibility and accessibility reads raise Play-policy and privacy issues (inference) |

## Fact-check (2026-10-29)

Independent re-check of the load-bearing facts against their primary sources, read on 2026-10-29 by a separate agent with
`scripts/fc/fc_fetch.py` (RFC 9309 robots matching before any other request to a host, at least 1.25 s between requests to
one host, no redirect followed automatically, no personal data sent; downloads under `downloads/fc-*/`, Python with `-I`,
nothing downloaded executed). Persona's own binaries were not downloaded; only POMs, metadata and documentation. The
repository was read with `git show 91c83e02:<path>`. Summary: **20 confirmed, 1 corrected, 0 could not verify.**

| # | Fact | Verdict | Primary source and what it shows |
|---|---|---|---|
| 1 | Latest SDK v2.61.0, GitHub release 2026-10-21T14:39:28Z, HEAD `7174a8a8…`; the changelog repo has no licence and no code | confirmed | `api.github.com/repos/persona-id/inquiry-android-2/releases` (v2.61.0 published 14:39:28Z; v2.57.1 on 2026-10-15 after v2.60.0), `/commits?per_page=1` (`7174a8a837d2…`, "Bump version"), the repository record (`license: null`) |
| 2 | Maven Central: `inquiry` latest 2.60.0 (lastUpdated 2026-10-15), versions 2.38.0–2.60.0, 2.61.0 absent; on Central since 2.38.0 (2026-04-16) | confirmed | `com/withpersona/sdk2/inquiry/maven-metadata.xml` (`latest`/`release` 2.60.0, `lastUpdated` 20261015035321, 31 versions from 2.38.0); `2.61.0` POM answers 404; `2.38.0` POM `Last-Modified` 2026-04-16; changelog v2.38.0 ("SDK is now available on Maven Central") |
| 3 | minSdk 23 since 2.48.0 (2026-07-14), 21 before, 2.45.2 on the 21 line (2026-07-28); Java 17; compileSdk 36 since 2.22.0 | confirmed | `android-sdk-v2-changelog.md` (headings and entries); `android-sdk-v2-integration-guide.md` (`minSdkVersion` 23, `JavaVersion.VERSION_17`) |
| 4 | `Inquiry.Contract` result: `Complete` (status completed/failed, fields), `Cancel` (inquiryId, sessionToken), `Error` (debugMessage, errorCode); error-code list not documented | confirmed | Integration guide; migration page (`status == 'failed'`; "`Cancel` now returns `inquiryId` and `sessionToken`"); changelog v2.9.2 ("Added an error code to error results"); no full code list found |
| 5 | Builders and options | confirmed | Integration guide, changelog, `redeeming-share-tokens.md`, `relay-android-sdk.md` together name every listed builder and option |
| 6 | One-time links: browser-only on the resuming page, yet `fromOneTimeLinkCode` in the changelog and share-token page | confirmed | `resuming-inquiries.md` ("can only be used for browser-based flows … cannot be used in Inquiry SDKs"); changelog v2.40.0; `redeeming-share-tokens.md` |
| 7 | Merged permissions; protection levels | confirmed | Integration guide (the five permissions, `READ_BASIC_PHONE_STATE` removable, NFC with the NFC module); `Manifest.permission` reference (`CAMERA` and `RECORD_AUDIO` dangerous; `NFC` normal, API 9; `READ_BASIC_PHONE_STATE` API 33, "a non dangerous permission") |
| 8 | NFC only in the mobile SDKs; ICAO passports and some European IDs, passport cards, residence permits; plan-gated | confirmed | H3 `1iu1Fak8y9RiOE2FddXrHJ.md`; H4 `C6sdm6k7AnVBOmvlRP9ic.md` (plan table) |
| 9 | `nfc-impl` 2.60.0 pins JMRTD 0.8.1, BC `*-jdk15to18` 1.84, `scuba-sc-android` 0.0.26 | confirmed | The POM's runtime dependencies; licences page (JMRTD under LGPL, optional module) |
| 10 | `camera` 2.60.0 bundles ML Kit barcode 18.3.1, text 19.0.1, face 17.1.0 under the ML Kit Terms | confirmed | The POM; `android-sdk-v2-licenses.md` rows ("ML Kit Terms of Service") |
| 11 | Play Integrity 1.4.0 runtime dependency of `inquiry-internal`, skipped in Relay mode | confirmed | The POM (`com.google.android.play:integrity:1.4.0`, runtime); `relay-android-sdk.md` ("Relay mode also skips Play Integrity app attestation"); licences page ("Play Integrity API Terms of Service") |
| 12 | zxing core 3.5.4 (2025-11-11), Apache-2.0 at `zxing-3.5.4` | confirmed | `maven-metadata.xml` (latest 3.5.4), POM `Last-Modified` 2025-11-11; parent POM and `LICENSE` at the tag: Apache-2.0 |
| 13 | `dl.google.com` robots `Disallow: /`; no Google Maven fact fetched | confirmed | `dl.google.com/robots.txt` (`User-Agent: *` / `Disallow: /`), read again by this check |
| 14 | Upload off by default on mobile for web and SDKs; capture methods per device class incl. native | confirmed | `troubleshooting-common-issues.md`; H5 `7JQ78WDWLj5L63qXEu7AqJ.md` (updated 2026-09-30) |
| 15 | Back or barcode, never both; three checks need the barcode | confirmed | H6 `2f4jO5REos5aRPIVGEsb0Z.md` (Barcode, Barcode Inconsistency, Extraction Inconsistency) |
| 16 | Server theme sets for web and mobile v2+; device language with `.locale`; 46 locales | confirmed | `inquiry-theming.md` ("you must be on v2+"); integration guide (`.locale`); `languages.md` (46 tags) |
| 17 | Breaking changes in minors (2.8.0, 2.18.0, 2.30.0, 2.40.0, 2.59.0, 2.60.0); 51 releases in 2026; patches to older minors | **corrected**: the list also needs **2.2.0** (2022-01-25, a "Breaking" section renaming the package to `com.withpersona.sdk2`) | `android-sdk-v2-changelog.md`: 220 entries; per year 6, 50, 34, 34, 45, 51; 18 in the 90 days to 2026-10-21; "breaking" appears in 2.2.0, 2.8.0, 2.18.0, 2.30.0, 2.40.0, 2.59.0, 2.60.0 (2.15.0 only announces a future removal). Corrected in place in section 4.2 |
| 18 | v1 deprecated 2022-12-31; v2 required for `itmpl_` | confirmed | `migrate-from-android-sdk-v1-to-v2.md` |
| 19 | Google Play Instant ended December 2025 | confirmed | `developer.android.com/topic/google-play-instant` ("Starting December 2025, Instant Apps cannot be published") |
| 20 | OpenVerify: minSdk 26, compile/target 36; `Contract` and `OneTimeLinkContract`; 11 `FailureReason`s; `INTERNET` and `CAMERA`; NFC step unsupported; `openverify-nfc` empty | confirmed | `android/gradle/libs.versions.toml`; `OpenVerifyInquiry.kt:44`, `:111`; `InquiryResult.kt` (11 constants); `androidMain/AndroidManifest.xml`; `Flow.kt` (`nfc` not in `known`, so `UnsupportedStep`); `openverify-nfc/` holds only `build.gradle.kts`, `README.md`, `NOTICE` |
| 21 | NFC client sequence in `docs/checks/nfc.md:37-48`; `nfc` step `androidOnly: true`, optional `maxAttempts` | confirmed | `docs/checks/nfc.md` (file kinds, DG2 1 MiB, others 64 KiB, DG11/DG12 not taken, 8-byte nonce, five-minute expiry, the submit shape); `packages/flow-spec/src/flow.ts:355-363` |
