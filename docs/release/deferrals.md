# Deferral placements

Where each deferred and carried item of the plans is placed (C284.2; reviews H25 and its verification). `pnpm release:check` reads every item of the "Deferred" section of each plan that has one (C88, C110, C145, C177, C223, C286), every row of C288's "Carried (earlier plans and the progress log)" table and every row of contracts-11e's "Carried (Phases 7-10, after the plan)" table (`docs/plans/phase-11.plan.md`, Workflow 11E Stage 1a amendment 10), and requires one row here for each. Written by `docs-release` in Workflow 11E; kept by `fix-records` (11F) and `records-11g` (11G).

An item is a top-level bullet of a Deferred section (with its sub-bullets), or its paragraph where the section has no bullets; a bullet's placement covers everything it lists. **Item** is a phrase the item's text holds (a Deferred item) or the row's first cell, exactly (a table row). **Placement** is one of:

- `carried: "<text>"`: the text stands in a carry block of `docs/PROGRESS.md` (every form PROGRESS uses: "**Carried forward:**", "**Known items.**", "**Open, with owners**", "- **Deferred:**", "- **Carried out of 11A**") or in a "### Next release" section of `docs/PLAN.md`. When it does not, `release:check` reports the exact line the orchestrator adds;
- `built: "<text>"`: a Phase 11 Workflow built it, and that Workflow's PROGRESS entry says the text;
- `handed: <plan>`: the item named a later phase, whose own plan took it over (and whose own Deferred section carries what it did not build);
- `checklist: <id>`: the item is a line of `docs/release/checklist.md`;
- `moot: <reason>`: closed as moot, with its reason.

| Source | Item | Placement |
|---|---|---|
| phase-6.plan.md C88 #1 | The `screening` composite report and its record API | carried: "C88's deferrals (phase-6.plan.md), each with its reason" |
| phase-7.plan.md C110 #1 | GPS collection, reverse geocoding and Natural Earth | carried: "C110's deferrals (phase-7.plan.md), each with its reason" |
| phase-7.plan.md C110 #2 | The JA4 proxy-header adapter (`tls-fingerprint`, research | carried: "C110's deferrals (phase-7.plan.md), each with its reason" |
| phase-7.plan.md C110 #3 | Android emulator, root and hooking heuristics, Play | handed: docs/plans/phase-10.plan.md |
| phase-7.plan.md C110 #4 | Face-image import and selfie-background import. Graph | carried: "C110's deferrals (phase-7.plan.md), each with its reason" |
| phase-7.plan.md C110 #5 | List exports, saved views and filterable transaction fields | handed: docs/plans/phase-9.plan.md |
| phase-7.plan.md C110 #6 | Every workflow step that the public product builds on these | handed: docs/plans/phase-8.plan.md |
| phase-7.plan.md C110 #7 | Commercial IP and device reputation API clients (adapters | carried: "C110's deferrals (phase-7.plan.md), each with its reason" |
| phase-7.plan.md C110 #8 | Graph kinds from transaction fields. Connected-component | carried: "C110's deferrals (phase-7.plan.md), each with its reason" |
| phase-7.plan.md C110 #9 | **Public behaviours not built in Phase 7** (H17, H19, H20, | carried: "C110's deferrals (phase-7.plan.md), each with its reason" |
| phase-8.plan.md C145 #1 | Custom functions; importer-created runs; custom events; | carried: "C145's deferrals (phase-8.plan.md), each with its reason" |
| phase-8.plan.md C145 #2 | Parallel joins other than join-all (`any`, `first`); | carried: "C145's deferrals (phase-8.plan.md), each with its reason" |
| phase-8.plan.md C145 #3 | Run Verification's `complete-on-tentative` (its semantics | carried: "C145's deferrals (phase-8.plan.md), each with its reason" |
| phase-8.plan.md C145 #4 | `user-notification.*` and `user.availability-updated` | carried: "C145's deferrals (phase-8.plan.md), each with its reason" |
| phase-8.plan.md C145 #5 | The canvas simulation overlay, inquiry-embedded workflows | handed: docs/plans/phase-9.plan.md |
| phase-8.plan.md C145 #6 | The case layout editor, checklists, the status-switcher | carried: "C145's deferrals (phase-8.plan.md), each with its reason" |
| phase-8.plan.md C145 #7 | Field-level and conditional redaction; an egress proxy | carried: "C145's deferrals (phase-8.plan.md), each with its reason" |
| phase-8.plan.md C145 #8 | A server-made case PDF and its fonts (Phase 9 with the | handed: docs/plans/phase-9.plan.md |
| phase-9.plan.md C177 #1 | **Flow** (each with its reason): weighted-random splits and | carried: "C177's deferrals" |
| phase-9.plan.md C177 #2 | **Themes and languages:** machine translation (T12: no | carried: "C177's deferrals" |
| phase-9.plan.md C177 #3 | **Analytics:** noise-based privacy (differential privacy) | carried: "C177's deferrals" |
| phase-9.plan.md C177 #4 | **Settings:** SSO, SAML and SCIM (S15; Phase 11); | carried: "C177's deferrals" |
| phase-9.plan.md C177 #5 | **Carried:** teams, availability and availability-driven | carried: "C177's deferrals" |
| phase-10.plan.md C223 #1 | **Integration surface:** an inline Compose or fragment | carried: "C223's deferrals (phase-10.plan.md), each with its reason" |
| phase-10.plan.md C223 #2 | **Capture:** the web flow's in-browser PDF417 pre-check | carried: "C223's deferrals (phase-10.plan.md), each with its reason" |
| phase-10.plan.md C223 #3 | **Themes and languages:** operator-uploaded fonts on native | carried: "C223's deferrals (phase-10.plan.md), each with its reason" |
| phase-10.plan.md C223 #4 | **Release:** compileSdk 37 with Compose UI 1.12, CMP 1.12, | carried: "C223's deferrals (phase-10.plan.md), each with its reason" |
| phase-10.plan.md C223 #5 | **Wallets:** crypto-wallet signing on Android beyond | carried: "C223's deferrals (phase-10.plan.md), each with its reason" |
| phase-10.plan.md C223 #6 | **Next release (iOS):** dependency locking for the iOS link | carried: "Next release: iOS" |
| phase-10.plan.md C223 #7 | **Not needed:** `expect fun secureRandomBytes(n)` (decision | moot: not needed (Phase 10 decision 55): the AA nonce is the server's and JMRTD draws its own randomness |
| phase-11.plan.md C286 #1 | **Connect** (each with its reason): sharing between two | carried: "C286's deferrals (phase-11.plan.md), each with its reason" |
| phase-11.plan.md C286 #2 | **Hardening:** SAML SSO and SCIM (Phase 9 S15: SAML's | carried: "C286's deferrals (phase-11.plan.md), each with its reason" |
| phase-11.plan.md C286 #3 | **Android:** built-in certificate pinning (C256.2: a recipe | carried: "C286's deferrals (phase-11.plan.md), each with its reason" |
| phase-11.plan.md C286 #4 | **Carried from earlier plans:** a multi-frame or video | carried: "C286's deferrals (phase-11.plan.md), each with its reason" |
| phase-11.plan.md C286 #5 | **Closed as moot:** Phase 2's "API gap, left for a later | moot: Phase 9 C173.2 builds include=files and redacted-at on GET /verifications/:id |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 6 owner decision 1 after 6C (any C78.7 gap) | built: "C78.7" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 6 decision 9 after 6C (write cost; JIT for the role) | built: "the matcher's write cost" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 6 decisions 10, 21, 22 after 6B | built: "conditional list syncs" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 9 C175.2 (SSO; idle timeout; production images with the flow server; the chart without static `frame-ancestors`; npm publication; the B2 rows; the CSP rows; the internal route; `share-consent`) | built: "OIDC sign-in" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 9 C177 (SSO, SAML, SCIM; the idle timeout; the internal listener; `sdk-react` and `apps/demo-web`; npm) | built: "OIDC sign-in" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 9 decision 71 (the manual accessibility audit at the release gate) | checklist: A11Y-WEB |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 10 C223 (the share token on Android; certificate pinning) | built: "the share_consent step on the web and the Android SDK" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 10 decision 38 (pinning, through the threat model) | checklist: B08 |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 10 decisions 47, 48 (TalkBack pass; real-document NFC read) | checklist: KP10-17 |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 10 P1–P5 and decision 50's visibility note (decision 50 is the emulator matrix and leaves the repository's visibility to the owner, `phase-10.plan.md:963`; review H27) | checklist: O04 |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 10 C214.5 (dependency locking for scanning) | built: "the per-push supply-chain job" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 10's MASVS hand-over | checklist: B08 |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 0 "Use RE2 or a time limit for operator-supplied regexes" | built: "the linear-time pattern rule" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 0 "Before release: legal review of SFace's upstream licence" | checklist: O06 |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 1 "Production images are a later phase" | built: "five production images" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 1 "Flow: response headers need a serving layer" | moot: built by Phase 9 C157 (the flow server's response headers) and verified in Workflow 11B (C255.3) |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 1 "Dashboard: login across organizations" | built: "OIDC sign-in" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 1 "API: re-uploading a kind" and "Flow: selfie upload fallback" ("carried into Workflow 1B and later phases") | moot: Workflow 1B's K001 (re-uploads replace the earlier file) and Phase 2's C19 (the sandbox selfie upload fallback) built them |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 1 "Calibration (Phase 4): SFace's 0.363 threshold" | moot: Workflow 4B's face-match calibration |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 2 line 849 (`GET /verifications/:id` files and redaction state, "a later phase") | moot: Phase 9 C173.2 builds include=files and redacted-at |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 4 decision 8 (multi-frame or video challenge, "a later phase") | carried: "C286's deferrals (phase-11.plan.md), each with its reason" |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 7 line 612 (session integrity's basis in the compliance guide) | checklist: B07 |
| phase-11.plan.md Carried (earlier plans and the progress log) | Phase 8 P17 (the code runner in production) | built: "the Helm chart on kind" |
| phase-11.plan.md Carried (earlier plans and the progress log) | PLAN §3 "DSAR export", "env/KMS adapter", "Helm (later)" | built: "the per-account access export" |
| phase-11.plan.md Carried (earlier plans and the progress log) | PLAN §9 "gitleaks + PII scan in CI" | built: "the SAST and PII baselines" |
| phase-11.plan.md Carried (earlier plans and the progress log) | PLAN §10 (docs cover self-hosting, check catalog, API reference, threat model, compliance guide, the mapping) | checklist: B07 |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7A: `MmdbSnapshot.verify` on DB-IP City Lite | checklist: KP11-63 |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7B: the face-list threshold calibration | checklist: 11D/face-list-threshold |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7B: the background-list thresholds | checklist: 11D/background-list-thresholds |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7B: the fuzzy-name candidate cap | checklist: 11D/fuzzy-name-cap |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7B: list import throughput | checklist: 11D/lists-import |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7B: the address key's per-country handling | carried: "the address key's per-country handling (lists; LIST_KEYS_VERSION): next release" |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7B: the transaction PDF page count | built: "the parser-backed transaction PDF page count" |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7C: R007 (dense graph scenarios) | built: "R007 dense graph" |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7C: R008 | built: "K7C-R008" |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7C: R009 | built: "K7C-R009" |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 7C: R010 (a missing ASN seed re-read on every session start) | checklist: 7C-R010 |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 8: R006 (a full-stack Trust Device spec) | checklist: 8-R006 |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 8: K8-9 (metrics) | built: "metrics-registry.ts" |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 8: K8-25 (the flow bundle budget) | checklist: K8-25 |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 8: K8-32 (a multi-page guarded PDF task) | checklist: K8-32 |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 8: 8D's R007 (the wait-event form's unit test) | checklist: 8D-R007 |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 8: the C78.7 budgets | checklist: 11D/c787-2m |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | 10A: seed cases in the analytics benchmark | moot: built by Workflow 11D's load-harness (apps/api/src/analytics-benchmark-cases.test.ts), as the amendment-10 row records |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 10 close: KP10-51, KP11-4 | checklist: KP10-51 |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 10 close: KP10-52 | built: "KP10-52" |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 10 close: KP10-54, KP10-27 | built: "KP10-54" |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 10 close: KP10-53, KP10-55, KP10-56, KP10-57, KP10-35 part 2, KP10-24, KP10-26, KP10-19, KP10-28, KP10-30, KP10-15 | checklist: KP10-53 |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 10 close: EF.CardSecurity after PACE | checklist: EF-CARDSECURITY |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 10 close: an SDK host test over the YuNet face-frame vectors | checklist: YUNET-HOST-TEST |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 10 close: `analytics:benchmark --measure` | built: "KP11-7" |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 10 release gate: KP10-16, KP10-17, KP10-58, KP10-59, KP10-60, KP10-61, E002 | checklist: KP10-16 |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 10 release gate: the vision wheel's Eigen | checklist: EIGEN-VISION |
| phase-11.plan.md Carried (Phases 7-10, after the plan) | Phase 10 release gate: the ONNX Runtime pin | checklist: KP11-9 |
