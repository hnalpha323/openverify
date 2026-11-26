# Plan: Phase 4, selfie checks and liveness

**Source:** `docs/PLAN.md` §4.2 (the 15 selfie checks) and §6 Phase 4; ADR 0002 (tiers and honesty); `docs/research/phase4-models.md` (models, libraries, licences, fixtures, capture integrity) and `docs/research/phase4-selfie-behaviour.md` (clean-room notes on the product behaviour we match); the selfie inventory taken on 2026-10-21 (summarised under "Starting point").
**Complexity:** Large. Two Workflows: **4A** builds (contracts, vision, check logic, fixtures, both clients' capture protocol, wiring, integration) and **4B** adds the console surfaces and the face-match calibration, then reviews all of Phase 4 and fixes.
**Review of this plan.** Three adversarial reviews ran before any code (privacy and security; feasibility and fit with the code; check honesty and calibration). Together they found no CRITICAL problem, 21 HIGH, 45 MEDIUM and 19 LOW. Among them:
- one head-turn mistake failed three required checks at once, two of them fraud checks, so a genuine user lost every retry;
- no check tied the side poses to the same person as the centre pose;
- the planned keyed rotation of stored face templates is probably recoverable by someone with the database and the public model;
- consent for face matching rested on a list the client sends;
- clients batch their uploads today, which the timing rules would have read as an attack;
- thresholds were to be fitted to synthetic clips the research says not to use.

This version addresses all of them. The main changes: a failure cascade that keeps retries for user mistakes (C43), identity continuity inside liveness, sealed templates scanned in the application instead of a rotated index (C42), a separate optional consent (C42.3), per-pose uploads (C40.3), thresholds labelled provisional (C39.3), shared capture constants (C40.11), and the face-match calibration moved to Workflow 4B (C49).

A fourth pass checked the revision against every finding and found three more HIGH problems, now fixed:
- neither client offered the optional matching consent (C46);
- liveness could pass without active evidence when the pose check is not required (C43);
- the yaw constants could not be met by the clip they were meant for (C40.11).

It also found about thirty smaller gaps (KEK rewrap coverage, shared functions between the Stage 3 agents, the capture cap's effect on the inquiry, and others), each folded into its section.

## Summary

Phase 1 runs three selfie checks (`selfie_image_quality_detection` on the centre photo, `selfie_multiple_faces_detection` on the centre photo, `selfie_id_comparison`). The other twelve answer `pending`/`not_implemented`, the worker ignores the left and right photos, vision returns no landmarks, the two MiniFASNet models are pinned but never loaded, and `liveness: active` has no server-side meaning. Phase 4 makes every §4.2 check real at its tier:
- **R:** real logic on measurements vision returns;
- **H:** a heuristic with a confidence, shipped as `beta`;
- **A:** an adapter with a deterministic sandbox provider.

To get there, Phase 4 adds:
- **A capture protocol.** Every camera selfie is a server-issued *selfie capture*: a nonce, an expiry and an ordered list of pose prompts (random side order for active liveness). Each pose is uploaded as soon as it is taken, with the capture id, the nonce and client timing; submit consumes the capture once. Captures are API resources with `selfie.*` events.
- **Vision selfie analysis v2.** Landmarks, head pose, face-region quality, passive liveness (MiniFASNet ensemble), covering and glasses heuristics, synthetic-face heuristics, a background layout vector, and cross-pose consistency (identity, planarity, duplicates). Decisions stay in TypeScript.
- **Face templates and a background index.** Sealed face templates (encrypted under the KEK like any PII), consent-gated and scanned in the application, for the account and repeat checks; a background layout index for the background check.
- **Clients.** The web flow guides the user with an in-browser face detector (onnxruntime-web and the YuNet model the server already uses) and captures automatically once the prompted pose is held; Android follows the protocol with a manual shutter (on-device guidance is Phase 10).
- **Calibration** (Workflow 4B). A FAR/FRR report for the face-match threshold on a public-domain portrait set, with its domain and skew stated next to every number. Every other threshold ships labelled `provisional`.

## Starting point (inventory, 2026-10-21)

- **Registry:** all 15 selfie checks exist (`packages/core/src/check-registry.ts`, §4.2 block), all `modelBased`, so all `beta`. Only `selfie_image_quality_detection` and `selfie_id_comparison` have config schemas. There is no selfie defaults table. `check-registry.test.ts` parses the PLAN §4.2 table.
- **Evaluators:** `packages/checks/src/phase1/selfie-checks.ts` (the three checks); `SELFIE_EVALUATORS` in `phase1/evaluate.ts`. `selfie_image_quality_detection` does not measure face size or resolution although the registry says so. No selfie result carries model provenance. `government-id/id-selfie-comparison.ts` has its own copy of the 0.363 threshold.
- **Vision:** `POST /v1/analyze/selfie` takes `center` (required), `left`, `right`; returns whole-image quality, faces (box and score only) and the largest face's embedding. `Face.landmarks` exist internally (`faces.py`) but are not returned. No image dimensions are returned.
- **Worker:** `evaluateSelfie` (`apps/api/src/jobs/process-verification.ts`) sends only the centre file. `idPortraitOf` re-embeds the ID front with `subject=document` (K101).
- **Storage:** file kinds `selfie-center|left|right`, one file per kind per verification (the unique index is not partial; `deleted_at` means "object deleted by redaction"). pgvector is installed, with no vector column. No embedding is stored (C31.9).
- **Flow API:** no challenge or nonce; `UPLOAD_LIMITS` allows two fields; a repeated submit of a `submitted` verification answers 202 and re-enqueues (clients rely on it). The flow-spec selfie step has `poses`, `liveness: passive|active` (active needs a side pose) and `maxAttempts`.
- **Web flow:** takes every photo first, then creates the verification and uploads everything (`submit-verification.ts`); one still per pose with a manual shutter; the camera reopens per shot; an oval CSS guide; no face detection. CSP has no `script-src`, so `default-src 'self'` blocks WebAssembly.
- **Android:** batches uploads like the web flow; CameraX Preview + ImageCapture; `liveness` parsed but unused.
- **Fixtures:** three public-domain faces; `selfie-{a,b}.y4m` fake-camera clips are a drifting crop of one still (a static replay by construction).
- **Default template:** selfie step `poses: ["center"]`, `liveness: "passive"`; the three Phase 1 selfie checks required; the other twelve absent.
- **Consent:** one acceptance over every consent text of the step; `recordConsent` accepts any superset of the step's keys.

## Patterns to mirror

| Category | Source | Pattern |
|---|---|---|
| Registry and config | `packages/core/src/check-registry.ts`, `check-config.ts` (`GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS`) | One entry per check; kebab-case config keys with ranges; a defaults table the template and the worker share |
| Reasons | `packages/contracts/src/government-id-check-reasons.ts` and `apps/api/src/jobs/government-id-contract.test.ts` | A reasons file per verification type with the shared reasons; a contract test that every evaluator emits only listed reasons |
| Evaluators | `packages/checks/src/government-id/*` (one file and test per check; `scores.ts`, `heuristic.ts` for H-tier confidence) | Pure functions over typed inputs, returning `CheckResult` with `stage`, `confidence`, `provenance` |
| Worker | `process-verification.ts` (`evaluateGovernmentId`, `withThresholds`, `recordThresholds`), `jobs/government-id.ts` (C34 lookups, `embedStored`) | Vision measures; the worker applies thresholds, evaluates, decides, persists, settles |
| Vision contract | `services/vision/src/openverify_vision/schemas.py` (frozen, `extra="forbid"`) and `apps/api/src/vision/schemas.ts` (strict zod); `tools/make_contract_fixtures.py` | Both sides change together; golden fixtures parsed by both |
| PII at rest | `packages/db/src/crypto.ts` (per-value DEK under the KEK), the `encrypted` column helper, the redaction-coverage test | Sealed columns; every PII table in redaction and retention |
| Redaction races | `apps/api/src/jobs/redaction-race.integration.test.ts` (G002), `assertInquiryOpenUnderLock` | Lock the inquiry, re-check `redacted_at`, then the verification; a Postgres test per writer and lock order |
| A-tier | `apps/api/src/ports.ts` (`publicFigure`, `ageEstimate`), `providers/sandbox.ts`, `docs/checks/sandbox-providers.md` | Port per provider; environment-kind binding; sandbox refused in production |
| Calibration | `services/vision/tools/calibrate_government_id.py`, `packages/checks/src/calibration/`, `docs/calibration/government-id-phase3.md` | Python measures, TypeScript scores with the real evaluators, a committed report |
| Tests | Vitest colocated; pytest; Testcontainers `*.integration.test.ts` via `createIntegrationPool`; Playwright `e2e/tests/*.spec.ts` | RED commit first; ≥80% per package; `docs/tdd/phase4-<agent>.tdd.md` |

## Locked contracts

C1–C38 stay locked except where a C-section below amends them. Every amendment is additive for API clients unless it says otherwise; C40.7 is the one stated break.

### C39. Registry, reasons and config for §4.2

1. **Registry.**
   - Tiers and types stay as PLAN §4.2, with one change: `selfie_face_covering_detection` becomes `user_behavior` (UB), because the user can remove a covering and should get a retry hint. `selfie_pose_detection` stays UB.
   - PLAN §4.2's covering row (type) and `selfie_repeat_detection` row (approach: "encrypted templates scanned per environment") change in the same Stage 1 commit as the registry, because the registry test parses that table.
   - `inputs`: `upload`, `vision` for image quality, glare, pose, multiple faces, liveness, pose repeat, covering, glasses; `vision`, `history` for the ID, account and repeat comparisons and background similarity; `provider` added for age, public figure and suspicious entity.
   - `version`: 2 for the checks whose behaviour changes (`selfie_image_quality_detection`, `selfie_multiple_faces_detection`, `selfie_id_comparison`, `selfie_face_covering_detection`, and `id_selfie_comparison`, whose selfie selection and threshold source change); 1 for the eleven implemented for the first time, with a "first implemented in Phase 4" note.
   - `provenance.models` carries each model's id and SHA-256 (the `modelsOf` pattern), and the pose results record the canonical face points' source.
   - `selfie_age_comparison` stays `A/H` in the registry; Phase 4 ships only the A part, because no permissive age model exists (research §4).
   - The registry has no notes field, so the background check's "advisory only, do not require" note goes in its `description`. Glare, pose repeat, account comparison, repeat and background join `OPTIONAL_BY_DEFAULT`, so the registry defaults agree with C45.1.
2. **Reasons.** `packages/contracts/src/selfie-check-reasons.ts` exports `SELFIE_CHECK_IDS` and `SELFIE_CHECK_REASONS`, with the C29.4 shared reasons (`input_missing`, `no_reference_data`, `execution_error`, `provider_not_configured`, `not_requested`, `image_unreadable`) and one new shared reason, `not_consented` (`not_applicable`, blocks a required check). `PHASE1_CHECK_REASONS.selfie` stays a subset: `selfie_face_not_present` and `id_portrait_not_present` stay listed as legacy reasons that stored rows carry, though Phase 4 evaluators no longer emit them. Selfie reasons:

   | Check | Type | Reasons |
   |---|---|---|
   | `selfie_image_quality_detection` | UB | `face_not_present`, `image_blurry`, `image_too_dark`, `image_too_bright`, `face_too_small`, `resolution_too_low` |
   | `selfie_glare_detection` | UB | `face_glare` |
   | `selfie_pose_detection` | UB | `pose_not_center`, `pose_not_left`, `pose_not_right` |
   | `selfie_face_covering_detection` | UB | `face_covered` |
   | `selfie_glasses_detection` | UB | `glasses_detected` |
   | `selfie_multiple_faces_detection` | F | `multiple_faces_present` |
   | `selfie_liveness_detection` | F | `passive_liveness_low`, `pose_identity_mismatch`, `automated_capture`, `capture_replayed`; `not_applicable`: `capture_not_live`, `capture_device_suspicious` |
   | `selfie_pose_repeat_detection` | F | `planar_motion`, `pose_frames_identical`, `duplicate_frame` |
   | `selfie_id_comparison`, `selfie_account_comparison` | F | `face_mismatch` |
   | `selfie_repeat_detection` | F | `face_seen_on_other_account` |
   | `selfie_similar_background_detection` | F | `background_seen_with_other_faces` |
   | `selfie_age_comparison` | F | `age_outside_limits`, `age_inconsistent_with_birthdate` |
   | `selfie_public_figure_detection` | F | `public_figure_match` |
   | `selfie_suspicious_entity_detection` | F | `synthetic_face_suspected`, `provenance_marks_synthetic`, `provider_flagged` |

   - Every check whose evidence comes from vision lists `input_missing` (no face, no landmarks, no region) and `execution_error`.
   - **Frozen in Stage 1:** the UB reasons above, `contracts/fixtures/flow/retry-hint-reasons.json` (it gains every UB selfie reason), the web flow's English and Spanish strings and Android's messages for them, and `apps/flow/src/i18n/retry-reasons.test.ts`, which now also reads `SELFIE_CHECK_REASONS`. Stage 2 may add fraud reasons only, recording each as an amendment.
   - `apps/api/src/jobs/selfie-contract.test.ts` asserts every evaluator emits only listed reasons, and that a `not_applicable` result always carries a reason.
3. **Config and defaults.** Every check with a threshold gets a registry `configSchema` (kebab-case, C11 style). `SELFIE_CHECK_CONFIG_DEFAULTS` in `check-config.ts` holds the defaults, and **each default carries a basis**: `calibrated` (from a report) or `provisional` (principled, from the research, not fitted to our fixtures). Results record it: `provenance` gains `threshold-basis`, a map from each threshold key to its basis (an additive C29.2 member). Only the face-match threshold may become `calibrated` in Phase 4 (C49). If a fixture fails a provisional threshold, the generator changes, never the threshold.

   | Check | Config (provisional default) |
   |---|---|
   | `selfie_image_quality_detection` | existing whole-image keys (centre), plus `min-face-blur-score` (face region resized to 112 px wide), `min-face-width-px`, `min-face-height-ratio`, `min-image-short-side-px` |
   | `selfie_glare_detection` | `max-face-glare-ratio` (face region without the eye regions) |
   | `selfie_pose_detection` | `max-center-yaw-ratio`, `min-side-yaw-ratio-change` (both from C40.11; set no stricter than the client's capture triggers, roughly a 10° turn as YuNet reads it) |
   | `selfie_multiple_faces_detection` | `min-secondary-face-area-ratio` (0.25) |
   | `selfie_liveness_detection` | `min-passive-score` (0.5, upstream's own decision point), `min-side-identity-cosine` (0.4, generous: research §7 measured 0.83 for a 30° turn) |
   | `selfie_pose_repeat_detection` | `min-planarity-residual` (0.0045 of face width: between research §7's planar 0.05–0.33% and 3-D 0.62–2.2%), `min-tracked-points` (20), `max-pose-cosine` (0.99) |
   | `selfie_id_comparison`, `selfie_account_comparison`, `id_selfie_comparison` | `threshold` (0.25–0.6), one shared constant `FACE_MATCH_DEFAULTS.threshold` (0.363). It replaces every copy: `DEFAULT_FACE_MATCH_THRESHOLD` (`packages/checks/src/face-match.ts`), `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_selfie_comparison.threshold` and `id_inconsistent_repeat_detection['face-threshold']` (`check-config.ts`), the default in `id-selfie-comparison.ts`, and the worker's `faceMatchThreshold` option (`worker.ts`, `process-verification.ts`). A contract test asserts they all read it |
   | `selfie_repeat_detection` | `threshold` (0.363–0.95; a 1:N threshold, never below 1:1; provisional 0.5, gallery-size dependent) |
   | `selfie_similar_background_detection` | `min-orb-inliers`, `min-inlier-ratio`, `window-days` (1–365, 30), `min-distinct-faces` (3), `min-coverage` |
   | `selfie_face_covering_detection`, `selfie_glasses_detection`, `selfie_suspicious_entity_detection` | `max-*-score` (0–1) |
   | `selfie_age_comparison` | `min-age`, `max-age` (0–150), `buffer-years` (0–10, 3) |

4. **Results.** Every selfie result fills `stage`, `confidence` and `provenance`. Metadata holds only scores, counts, ratios, flags, pose names and field names: never embeddings, landmarks, face crops, device labels, background vectors or other inquiries' ids. The one exception is the centre face box normalised to [0, 1], under `face-box` in `selfie_image_quality_detection`'s metadata (C40.10). The seeded synthetic values in the golden vision fixtures (embeddings, landmarks, layouts) are allowed; values from a real face or a real background never enter git.

### C40. The selfie capture (protocol, flow API, storage, events)

1. **Resource.** A *selfie capture* is one camera or upload session for a selfie verification. Type `selfie`, id prefix `self_`.
   - **Attributes:** `status`, `capture-method` (`camera` | `upload`, one enum everywhere), `liveness` (`passive` | `active`), `prompts` (ordered poses, `center` first), `prompt-timings` (`[{ pose, client-elapsed-ms, received-at }]`, the latest file per pose), `created-at`, `expires-at`, `submitted-at`, `processed-at`, `error-code` (`superseded`, `expired`, `canceled`, `processing_failed`). No device data.
   - **States** (a state machine in `packages/core`): `initiated` → `submitted` → `processed` | `errored`, and `initiated` → `errored` (superseded, expired when the next capture is created, canceled with the verification).
   - **Relationships:** `verification`, `inquiry`. The selfie verification and the inquiry gain a `selfies` relationship (newest first). `GET /api/v1/selfies/:id` (scope `verifications:read`); `?include=selfies` on verifications and inquiries; the dashboard inquiry document includes them.
   - **Redaction:** `self` joins `REDACTION_SUBJECT_ID_PREFIXES`, `idSchema`, the event object types, the redaction stub schema and its type-to-prefix map; capture ids join the redaction `objectIds` and the `filter[inquiry-id]` timeline query.
2. **Create.** `POST /api/v1/flow/verifications/:id/selfies`, body `{ "method": "camera" | "upload" }`.
   - **Preconditions:** consent recorded, inquiry open (not redacted, not decided), verification `initiated` and of type selfie. `upload` only in a sandbox environment (C19); otherwise 403.
   - **Prompts:** `center` first. Publishing a template version whose selfie step lacks `center` fails (enforced in `checkFlowMatchesConfig` or the publish service, not in `selfieStepSchema`, so stored versions still parse). With `liveness: active` the step's side poses follow in an order drawn with a CSPRNG; with `passive`, in the step's order.
   - **Nonce:** 128 bits from a CSPRNG, base64url (22 characters), returned once; stored only as SHA-256.
   - **Expiry:** `SELFIE_CAPTURE_TTL_SECONDS` (180, in contracts) after creation, computed from the injected clock.
   - **Supersede:** a new create moves the previous `initiated` capture to `errored` (`superseded`) and deletes its file rows in the same transaction, then their objects after commit (as `replaceVerificationFile`). An object whose delete fails is crypto-shredded: its wrapped DEK went with the row.
   - **Cap:** at most 10 captures per verification. The 11th create cancels the verification (`canceled`, with its event, and its open capture `errored`/`canceled`) and answers 409 `selfie_capture_limit`; the flow's next create starts a new attempt, which counts against `maxAttempts`. `stateOf` (`inquiry-outcome.ts`) counts a verification canceled this way as a failed attempt, and when no attempt remains, the same transaction moves the inquiry to `failed` (C30.5, `inquiry.failed`).
   - **Every cancel path** (the cap, the inquiry expiry job, the inquiry actions) moves the verification's open capture to `errored` (`canceled`) with `selfie.errored`.
   - **Response** (flow view): `id`, `prompts`, `expires-at`, `nonce`, and `guidance` (`max-center-yaw-ratio`, `min-side-yaw-ratio-change`, `hold-ms` from the effective config and C40.11).
3. **Upload.** `POST /api/v1/flow/verifications/:id/files` gains three multipart fields: `capture-id` (`idSchema('self')`), `nonce` (22 characters), `client-elapsed-ms` (0–600,000). `UPLOAD_LIMITS` becomes 5 fields and 6 parts, and the route's OpenAPI body lists them.
   - The fields are refused for non-selfie kinds and required for selfie kinds of verifications whose `selfie_capture_required` is true (C40.7).
   - The kind must be one of the capture's prompts; the capture must be `initiated` and unexpired, re-checked under the verification lock inside the write transaction (so an upload racing a supersede is refused).
   - `received_at` comes from the server clock inside the write transaction. A re-upload of a kind replaces the file; the latest per kind counts.
   - **Per-pose upload.** Clients create (or reuse) the verification and create the capture before the first prompt, upload each pose as soon as it is captured and before showing the next prompt, and never batch. A failed upload is retried for that pose before moving on.
4. **Submit.** `POST /api/v1/flow/verifications/:id/submit` for a selfie takes `{ "capture": { "id", "nonce", "device"? } }`.
   - **Device snapshot** (optional, every member optional and bounded): `label` (the server strips control and bidi characters and truncates to 200 characters), `settings` (`width`, `height`, `frame-rate`, `facing-mode`, `resize-mode`), `capabilities` (`width-max`, `height-max`, `frame-rate-max`, `facing-modes`, at most 4), `frame-stats` (`delivered`, `discarded`, `total`), `webdriver`, `image-mirrored`. Numbers are finite and bounded; unknown members are refused. Android maps its CameraX facts onto these members: camera id into `label`, lens facing into `settings.facing-mode`, resolution into `settings.width`/`height`, frame rate into `settings.frame-rate`.
   - **Completeness:** every prompt has a file under this capture, else 409 `selfie_capture_incomplete`.
   - **Consumption:** in one transaction with `moveVerification`, under the C40.6 lock order, a conditional update `status = 'initiated' AND expires_at > $now` (`$now` from the injected clock).
   - **Idempotent repeat:** a repeated submit naming the capture that already moved the verification to `submitted`, while the verification is still `submitted`, answers 202 and re-enqueues, as in C3. Any other capture state, a different capture, or a verification no longer `submitted` answers 409.
   - **Lookups** are scoped by environment, verification and id; a wrong nonce, a foreign, superseded or expired capture all answer the same 409 body (`selfie_capture_invalid`), compared with `timingSafeEqual` over SHA-256 digests. On that 409, or after a page reload (the nonce lives in memory only), clients create a new capture and restart the prompts.
5. **Storage.** Table `selfie_captures`: `id`, `environment_id`, `verification_id`, `inquiry_id`, `status`, `method`, `liveness`, `prompts` (jsonb), `nonce_sha256` (bytea), `device` (sealed JSON: a camera label can carry a person's name), `created_at`, `expires_at`, `submitted_at`, `processed_at`, `error_code`, `redacted_at`.
   - **Sealing:** `device` uses `sealJson` with the row AAD (`packages/db/src/sealed.ts`), like the face template (C42.1). Stage 1 adds both columns to `ENCRYPTED_COLUMNS`, `SEALED` and the schema-v2 list (`encrypted-columns.ts`), and the three new tables to `SUBJECT_PII_TABLES`, so `kek:rewrap` covers them; a `kek:rewrap` test re-wraps a template and a device.
   - `device` is cleared in the transaction that moves the capture out of `submitted` (to `processed` or `errored`); only derived flags survive, in check metadata.
   - `files` gains `selfie_capture_id` (nullable FK), `client_elapsed_ms`, `received_at`, and an index on `(environment_id, sha256)` for replay detection. `verifications` gains `selfie_capture_required boolean NOT NULL DEFAULT true`, which the migration sets to false on existing rows (C40.7).
   - The worker's pino redaction paths include `device` and `label`.
6. **Locks and redaction races.** Every write of a capture, a selfie file, a face template, a background row or a rebuild row runs in one transaction that first locks the inquiry and re-checks `redacted_at` (`assertInquiryOpenUnderLock`; the worker uses the G002 check), then locks the verification, then the capture. The template write also re-checks, under the inquiry lock, that the inquiry is not declined. A Postgres test per writer, in the pattern of `redaction-race.integration.test.ts`:
   - create, upload, submit, supersede;
   - the capture-cap cancel and every other verification-cancel path (`jobs/inquiry-expiry.ts`, the inquiry actions);
   - `failVerificationAfterError`'s capture update (it takes no inquiry lock today);
   - the decision-time `device` clear;
   - the worker's template and background writes, the operator-decline deletion, the retention deletion, the rebuild;
   - and the stale-upload race (an upload passes its check, a supersede commits, the upload's insert is refused).
7. **The one stated break.** A selfie verification with `selfie_capture_required` true (every one created after the Phase 4 migration) cannot be submitted without a capture (409 `selfie_capture_required`). Android SDK builds and cached web bundles from before Phase 4 therefore stop working for new selfie verifications; neither has been released, and the docs and the changelog say so. Verifications created before the migration have no capture and are evaluated with liveness `not_applicable`/`capture_not_live`.
8. **Events, in this order.** `verification.created` → `selfie.created` (and `selfie.errored` whenever a capture is superseded, expires at the next create, or is canceled) → in the submit transaction `selfie.submitted` then `verification.submitted` → after the decision `verification.passed` or `verification.failed` (none for `needs_review`, C30.4) → `selfie.processed` → the `inquiry.*` events. A job that fails without data emits `verification.failed` then `selfie.errored` (`processing_failed`). The payload is the capture resource through the existing pipeline (2B F005 subject rules); it never carries the nonce or device data.
9. **What the worker gets.** The newest submitted capture: prompts, `prompt-timings`, `created_at`, `expires_at`, `submitted_at`, and the device snapshot (decrypted in the worker only, never logged).
10. **Verification attributes.** `verification/selfie` gains, each nullable and not PII (so not masked):
    - `capture-method`, `liveness`, `poses` (the processed capture's prompts);
    - `document-similarity-score`: the SFace cosine of the centre face to the ID portrait `selfie_id_comparison` used, rounded to 4 decimals;
    - `selfie-similarity-score-left`, `selfie-similarity-score-right`: each side face's cosine to the centre face;
    - `liveness-score`: the centre's passive mean P(real);
    - `center-photo-face-coordinates`: the centre face box as four corners normalised to [0, 1] (top-left, top-right, bottom-right, bottom-left).

    **Where they come from.** The worker stores the values under named metadata keys: `similarity` in `selfie_id_comparison`; `liveness-score` and `face-cosines` in `selfie_liveness_detection`; `face-box` in `selfie_image_quality_detection`. `api-flow` derives the attributes from those keys at read time, so redaction (metadata set to `{}`) nulls them.

    None of them, no nonce (beyond the create response) and no device data ever appears in the flow API: a contract test asserts the flow verification and capture documents, and the `selfie.*` payloads, exclude them. The OpenAPI snapshot and `@openverify/node` types follow.
11. **Shared capture constants.** `contracts/fixtures/flow/selfie-capture.json`, read by TypeScript (contracts, flow, checks), Python (the clip generator) and Kotlin, each with a test that it uses the file:
    - **clip:** 640×480 MJPEG at 30 fps; the cycle centre → left → centre → right starting at the centre; at least 1.5 s at each extreme; target yaw ±22°; period at most 8 s;
    - **client:** `hold-ms` 500; a side pose auto-captures once the measured yaw-ratio change is at least 1.25 × the server minimum, and the centre once `|yaw_ratio|` ≤ 0.8 × `max-center-yaw-ratio`; guidance at about 8 Hz on a 320-pixel preview; the manual shutter after 10 s; the camera stays open for the whole capture;
    - **server:** the provisional `max-center-yaw-ratio` and `min-side-yaw-ratio-change` as yaw-ratio numbers; `SELFIE_CAPTURE_TTL_SECONDS`.

    **How the yaw numbers are set** (a principled anchor, not a fit to the clip). Stage 1 renders, with the re-pose helper, each public-domain face at known yaws and measures the yaw ratio YuNet reports. `min-side-yaw-ratio-change` is the median change YuNet reports for a 12° rendered turn; `max-center-yaw-ratio` is the median absolute ratio at a 5° rendered turn. Stage 1 also records the change at the clip's ±22°. If the ±22° change is below 1.25 × the minimum (YuNet reading too little), Stage 1 raises the clip's target yaw up to the ±25° research limit. If that still does not clear it, Stage 1 reports a blocker with the measurements; nobody lowers the anchor to make the clip pass.

    Stage 1 also records golden `contracts/fixtures/flow/selfie-capture-created.json` and `selfie-capture-submit.json`, which both clients' tests read.

### C41. Vision: selfie analysis v2, background comparison, telemetry off

1. **`POST /v1/analyze/selfie`** keeps every Phase 1 field and its inputs (`center` required, `left` and `right` optional) and gains an optional form field `source` (`camera` | `upload`, default `camera`). Each pose gains:
   - `image`: `{ width, height }` in EXIF-upright pixels;
   - `faces[].landmarks`: five `[x, y]` points in YuNet order (right eye, left eye, nose tip, right mouth corner, left mouth corner), in image pixels;
   - `face_quality` for the primary (largest) face: `{ box, width_px, height_ratio, center_offset: [dx, dy], blur_score, brightness, glare_ratio }`. `blur_score` is the Laplacian variance of the face region resized to 112 pixels wide; `glare_ratio` excludes the eye regions;
   - `head_pose`: `{ yaw_ratio, roll_deg, yaw_deg, pitch_deg, method: "yunet-5pt" }`. `yaw_ratio` = `(x_nose − x_eye_mid) / inter-ocular distance` after de-rolling by the eye line. `yaw_deg`/`pitch_deg` come from SQPnP against MediaPipe's Apache-2.0 canonical face points (research §2) and are coarse; decisions use `yaw_ratio` relative to the centre pose;
   - `passive_liveness` for every pose with a face: `{ v2, v1se, mean, effective_scales: { v2, v1se } }`, P(real) per model, with upstream preprocessing reimplemented exactly (research §3: shift-not-clamp crop, BGR, raw 0–255, 80×80, softmax, class 1 = real) and a documented YuNet box transform;
   - `occlusion`: `{ covering: { score, skin_fraction_ratio, texture_ratio, delta_e, forehead_valid }, glasses: { score, rim_edge_energy, lens_highlight_ratio, bridge_edge_density } }` from landmark regions (research §6);
   - `synthetic`: `{ spectral_tail_deviation, residual_peak_ratio, noise_inconsistency, jpeg_grid_misalignment, canonical_landmark_distance, digital_source_type }`. `digital_source_type` is read only when `source` is `upload`, by a bounded byte search of the XMP packet (at most 64 KiB, no XML parser; hostile-XMP tests: entity expansion, external entity, oversize), else `null`;
   - `background` (centre only): `{ layout: [144 numbers], valid_cells: 48-character "0"/"1" string, coverage }` (research §8).

   The top level gains `consistency`, one entry per side pose present: `{ pose, face_cosine_to_center, planarity: { tracked_points, median_residual_ratio, p90_residual_ratio } | null, registered_ssim, raw_ssim, duplicate_of_center }`. `model_versions` gains `anti_spoof_v2` and `anti_spoof_v1se`.

   **Direction convention.** In the raw, unmirrored camera image, a user turning their head to their own left moves the nose toward the image's right, so `yaw_ratio` increases. Two tests pin it, independent of the clip generator: the pinhole projection of the canonical face points rotated toward the user's left gives a positive `yaw_ratio`; and a horizontally mirrored real public-domain photo flips the sign. When the device snapshot says `image-mirrored: true`, the worker flips the sign.
2. **`POST /v1/compare/background`**: a `probe` image and up to five `candidate_0` … `candidate_4` images, under a per-route body limit of 6 × the upload limit plus overhead (the API has no image library; vision downscales each to at most 640 pixels on the long side after reading). It answers `{ results: [{ index, good_matches, inliers, inlier_ratio }] }` from ORB + RANSAC on background pixels (the person masked out from YuNet's box, research §8).
3. **Decisions stay in TypeScript.** Vision returns measurements only.
4. **Telemetry off.** ONNX Runtime's official Linux builds carry Microsoft telemetry, on by default (research §0; the 1DS endpoint is in the locked 1.31.0 wheel, checked 2026-10-21). The vision image and the compose service set `ORT_DISABLE_TELEMETRY=1`, and the app calls `onnxruntime.disable_telemetry_events()` at startup before any session is created. Tests assert both.
5. **Budget.** Centre, left and right selfies at 1,280 pixels long side: median ≤ 3 s over 10 runs on the development CPU, measured by a committed benchmark; the CI vision job logs it. Exceeding it is a blocker with a per-stage breakdown, never a raised budget.
6. **Privacy.** Vision never logs images, landmarks, embeddings or background vectors.

### C42. Face templates and the background index

1. **Face templates.** Table `face_templates`: `id`, `environment_id`, `verification_id` (unique), `inquiry_id`, `source` (`selfie`), `model` (`sface-2021dec`), `template` (the L2-normalised SFace embedding as base64 float32, sealed with `sealValue` and the row AAD; listed for `kek:rewrap` per C40.5), `created_at`. Sealed like every other PII value, so anyone with the KEK and the database can read them, and the docs say they are biometric data. There is no vector column and no ANN index in Phase 4 (owner decision 3).
2. **When a template is written.** Only when the selfie verification's decision is `passed` **and** both `selfie_liveness_detection` and `selfie_id_comparison` answered `passed`, whatever their `required` flag (a template version that does not enable both never stores templates), and only with matching consent (3). It is written in the decision transaction under the C40.6 lock order. An inquiry that ends `failed`, or that an operator declines, loses its templates and background rows in that transition's transaction. A failed, spoofed or reviewed attempt therefore never enters the gallery; a test runs a spoof fixture on a template with liveness advisory and finds no row.
3. **Matching consent.**
   - The flow-spec consent step gains `optionalTextKeys`, each shown with its own checkbox. The consent body gains `optional-text-keys` (the accepted subset). `recordConsent` refuses any key, required or optional, that the inquiry's pinned consent step does not list.
   - **Matching consent holds** when the pinned template version's consent step lists `consent.biometric-matching` and the recorded consent includes it. The new text explains that the selfie and its background are compared with earlier selfies submitted to the same organization, to stop one person using several identities, and for how long templates are kept (`{{days}}`, from `face-template-retention-days`, which the flow session returns). Declining it still lets the user verify.
   - It gates storing a template or background row, and `selfie_repeat_detection`, `selfie_account_comparison` and `selfie_similar_background_detection`, which answer `not_applicable`/`not_consented` without it.
   - Publishing a template version that requires one of those three checks fails (422, a JSON Pointer to the check) unless `consent.biometric-matching` is a required consent key.
4. **Search.** In the worker: decrypt the environment's templates newest first, in batches, up to the environment setting `face-search-max-templates` (1,000–200,000, default 50,000), and compute cosines in process. The candidates exclude the current inquiry and every inquiry of the current inquiry's account, resolved through `inquiries.account_id` at query time (consolidation-safe). Metadata records the number searched, whether the cap truncated the search, the match count and the best cosine. Measured on 2026-10-21: decrypting and scoring 50,000 sealed templates took about 2.1 s on the development CPU; the TDD file re-measures it.
5. **Background index.** Table `selfie_backgrounds`: `id`, `environment_id`, `verification_id` (unique), `inquiry_id`, `face_template_id` (not null: a background row exists only beside a template), `layout vector(144)`, `valid_cells`, `coverage`, `created_at`; HNSW `vector_l2_ops`; the migration runs `CREATE EXTENSION IF NOT EXISTS vector`. Written with its template (2). Not biometric, but personal data: environment-scoped, redacted and retained with its template.
6. **Redaction and retention.** Redacting an inquiry deletes its `face_templates` and `selfie_backgrounds` rows. The redaction-coverage test seeds both, plus a `selfie_captures` row with a sealed `device`, a `selfie.created` event, and an API log and an idempotency key that mention the `self_` id; `redaction.ts`'s header table lists the three tables. A supersede test asserts no file row and no storage object remains. A new environment setting `face-template-retention-days` (1–1,095, default 365) deletes older template and background rows in the retention pass, whatever the inquiry's own retention. The raw selfie files follow inquiry retention; the docs advise setting `inquiry-retention-days` when matching is enabled.
7. **Rebuild** (a model change only). `pnpm --filter @openverify/api face-index:rebuild [--dry-run]` re-embeds the files of verifications that **already have** a template row, through `/v1/embed/face`, and rewrites the template and the background row (re-running the centre analysis for the layout), keeping `created_at`. Rows whose files are gone are deleted. One transaction per row under the C40.6 lock order, re-checking consent and redaction; it never creates a row that does not exist.
8. **Uses.**
   - `selfie_account_comparison`: the templates of the account's other inquiries (resolved through the inquiry), all of them.
   - `selfie_repeat_detection`: the scan in 4.
   - `selfie_similar_background_detection`: the nearest background rows within `window-days` (HNSW, environment-filtered, from inquiries of other accounts), keeping those whose template's face differs from the current one (cosine below the 1:1 threshold, between the candidate's decrypted template and the current embedding from vision; the current verification has no template yet). The candidates' centre files are fetched through `listVerificationFiles(environmentId, …)`; a missing or undecryptable candidate is skipped and counted; at most five are compared through `/v1/compare/background`.
   - The public-figure gallery and Lists: Face (Phase 7) may use the same table with other `source` values; an ANN mode is their decision.
9. **Docs** (`docs/checks/selfie.md`): templates are biometric data sealed under the KEK; 1:N search is identification, not verification (the EU AI Act Annex III 1(a) question needs the operator's own legal review; this is an interpretation, not legal advice); the retention schedule and how to set it per jurisdiction; the consent requirements; the scan cap and what truncation means.

### C43. Check semantics

Thresholds come from template config, else `SELFIE_CHECK_CONFIG_DEFAULTS`; the worker records them and their basis in `provenance`.

**Cascade.** One user mistake fails one user-behaviour check, so `decideVerification` keeps it retryable (C30.1: a `failed` verification is retryable when every failing required check is UB).
- `selfie_pose_detection` alone judges whether each pose was taken as prompted, and `selfie_image_quality_detection` whether each pose is usable.
- `selfie_liveness_detection` and `selfie_pose_repeat_detection` judge only the side poses whose pose and face-region quality passed. When the centre fails `selfie_image_quality_detection` for any reason, the passive component is `not_executed` and liveness answers `not_applicable`/`input_missing`.
- Liveness never fails on turn size, order, timing or image quality.
- Contract tests:
  - a verification whose only user error is an insufficient turn is `failed` and retryable, with the hint `pose_not_left` or `pose_not_right`;
  - a too-dark centre alone is `failed` and retryable, with the hint `image_too_dark`;
  - in both cases liveness and pose repeat do not fail.

**Per check:**
- **`selfie_image_quality_detection`** (v2, UB): on **every** prompted pose, a face is present (`face_not_present`, the pose named in metadata) and the face-region blur is at least `min-face-blur-score` (`image_blurry`); on the centre also the Phase 1 whole-image blur and brightness, the face width and height ratio (`face_too_small`) and the image's short side (`resolution_too_low`).
- **`selfie_glare_detection`** (UB): the centre face region without the eyes; no face: `input_missing`.
- **`selfie_pose_detection`** (UB): the centre is frontal (`|yaw_ratio| ≤ max-center-yaw-ratio`, else `pose_not_center`). Each side pose has a face and its `yaw_ratio` changed from the centre by at least `min-side-yaw-ratio-change` in its direction (C41.1), else `pose_not_left`/`pose_not_right`. With `poses: ["center"]` only the centre is judged. `input_missing` only for a missing file.
- **`selfie_multiple_faces_detection`** (v2, F): on any pose, a second face (overlapping boxes merged at IoU > 0.3) whose box area is at least `min-secondary-face-area-ratio` of the primary face's: `multiple_faces_present`.
- **`selfie_liveness_detection`** (F). Metadata always carries `components: { passive, active, integrity }`, each `passed`, `failed`, `not_requested` or `not_executed`.
  - **Passive:** the centre's `passive_liveness.mean` ≥ `min-passive-score`, else `passive_liveness_low`. The side poses' scores are recorded, not judged (decision 19).
  - **Active** (when the capture has side poses): each side pose whose pose and quality passed has `face_cosine_to_center` ≥ `min-side-identity-cosine`, else `pose_identity_mismatch` (the same person throughout). Order and timing are recorded as flags (`order-followed`, `timing-flags`) and only lower the confidence; they never fail the check, because a scripted client controls them.
  - **Integrity:** in production, a camera label that is a file path or `webdriver: true` fails with `automated_capture`. A file whose SHA-256 equals a file of another capture or inquiry in the environment fails with `capture_replayed`; files with `deleted_at` set and files of redacted inquiries are excluded from that lookup. A label from the virtual-camera list records a flag and, when nothing failed, answers `not_applicable`/`capture_device_suspicious`, which routes to review. The list holds verified names only, starting with OBS Virtual Camera, and lives as data in `packages/checks/src/selfie/virtual-cameras.ts`; the docs copy it, and a test keeps them equal. Phone-as-webcam apps are not on the list. No device snapshot: `not_executed`.
  - **Sandbox:** in a sandbox environment the file-path label, `webdriver` and byte replays are recorded (`test-capture-device: true`) and do not fail the check, so the e2e stack can run; the worker reads the environment kind from the database. Tests: production fails a file-path label and `webdriver: true`; a sandbox records both and passes. This rule and the Utopia rule are the only environment-specific behaviours.
  - **Outcome:**
    - `failed` when any executed component failed;
    - `not_applicable`/`capture_not_live` without a capture or for `capture-method: upload`;
    - with side prompts, `passed` needs the active component `passed` on **every** prompted side pose. If any side pose was not judged because its pose or quality failed, liveness answers `not_applicable`/`input_missing`; the failed UB check outranks it in the decision, so the user still gets the retry;
    - `passed` always needs the passive component `passed`.
  - **Confidence:**
    - a passive failure, or a pass: margin-based, `heuristicConfidence(1 − mean, 1 − min-passive-score, coverage)`, where coverage is the share of components executed (a sandbox-waived integrity counts as not executed);
    - an identity failure: `marginConfidence(1 − cosine, 1 − min-side-identity-cosine)` × coverage;
    - an integrity failure: 1;
    - capped at 0.6 for `passed` until a real presentation-attack evaluation exists.
- **`selfie_pose_repeat_detection`** (F), on the side poses whose pose passed: `face_cosine_to_center` ≥ `max-pose-cosine` gives `pose_frames_identical`; `duplicate_of_center` gives `duplicate_frame`; planarity counts only with at least `min-tracked-points`, and a median residual below `min-planarity-residual` gives `planar_motion`. Fewer tracked points: recorded as unmeasured, lowering confidence. A centre-only step: `not_applicable`/`not_requested`. No side pose passed: `not_applicable`/`input_missing` (pose already failed).
- **`selfie_id_comparison`** (v2, F): the portrait of the latest government ID verification that is `passed`, `submitted` or `needs_review` (as `idPortraitOf`). No such ID, or one without a portrait: `not_applicable`/`no_reference_data` with `metadata.reference` naming what is missing (was `failed`). No face in the selfie: `not_applicable`/`input_missing`. Below the threshold: `failed`/`face_mismatch`. The deprecated `metadata.confidence` fields stay. `id_selfie_comparison` uses the same threshold key and the latest selfie that is `passed`, `submitted` or `needs_review`.
- **`selfie_account_comparison`** (F): matching consent (else `not_consented`); the best cosine to the account's earlier templates below the threshold: `face_mismatch`; none: `no_reference_data`.
- **`selfie_repeat_detection`** (F): matching consent; any template of another account at or above the threshold: `face_seen_on_other_account`. Advisory by default; the docs explain that false matches grow with the gallery size.
- **`selfie_similar_background_detection`** (F): matching consent; `coverage` below `min-coverage`: `input_missing`; at least `min-distinct-faces` verified candidates with distinct faces meeting both ORB limits: `background_seen_with_other_faces`. Advisory only; the registry note says not to require it, and the docs say virtual backgrounds defeat it.
- **`selfie_face_covering_detection`** (H, UB): `forehead_valid` false: `input_missing`; the score above `max-face-covering-score`: `face_covered`; margin-based confidence.
- **`selfie_glasses_detection`** (H, UB): the score above `max-glasses-score`: `glasses_detected`.
- **`selfie_age_comparison`** (A): the provider's estimate fails only when it lies outside `min-age`/`max-age` by more than `buffer-years`, or differs from the age by the compared ID's birthdate by more than `buffer-years`. No provider: `provider_not_configured`; no limits and no birthdate: `no_reference_data`.
- **`selfie_public_figure_detection`** (A): the provider's match on the centre image.
- **`selfie_suspicious_entity_detection`** (H/A): with a provider bound, its answer; otherwise the heuristic fusion of `synthetic`, advisory, its failure confidence capped at 0.5. Only `digital_source_type` values `trainedAlgorithmicMedia` and `compositeSynthetic` fail outright (`provenance_marks_synthetic`); others are recorded.

### C44. Adapters and sandbox providers

- **Ports:** `selfieAgeEstimate`, `selfiePublicFigure` and `suspiciousEntity` beside the C35 ports, bound per environment kind through `OPENVERIFY_PROVIDER_*`, sandbox refused in production at startup (with a negative test).
- **Minimisation:** a port's request is `{ image }`, the centre image bytes only, with no ids or metadata, and it returns an allowlisted shape (an age, a match with a score, a flag with a score). The raw provider response is never persisted. The worker passes a second argument `{ referenceId, birthdate }` only to providers whose identity has `sandbox: true`; the real-adapter port type has no such parameter, and a test asserts a non-sandbox provider receives one argument.
- **Sandbox providers** are deterministic on the inquiry's `reference-id`, with precedence public figure, then suspicious entity, then age:
  - `sandbox-public-figure` (whole token): a match;
  - `sandbox-suspicious-entity`: flagged;
  - `/(?:^|[^a-z0-9])sandbox-age-(\d{1,3})(?![0-9])/` with a value 0–150: that age; otherwise the age from the compared ID's birthdate.

  `docs/checks/sandbox-providers.md` lists them; results carry `provider: { id: "sandbox", sandbox: true }`.
- No real adapter ships. The docs say a real one needs consent text covering the processor, a processor agreement and a cross-border transfer review.

### C45. Default template, fixtures and end-to-end

1. **Default template** (a new seeded version; existing inquiries keep theirs). Stage 1 changes `inquiry-templates.ts`, `contracts/fixtures/flows/*`, `contracts/fixtures/api/flow-session.json` and adapts every test that reads them (contracts, Android `ContractFixturesTest` and `FakeFlowApi`, the mocked flow API), so later stages start green:
   - selfie step `poses: ["center", "left", "right"]`, `liveness: "active"`;
   - consent step `optionalTextKeys: ["consent.biometric-matching"]` (English and Spanish texts in both clients);
   - **required:** image quality, pose, multiple faces, liveness, `selfie_id_comparison`;
   - **enabled, not required:** glare, pose repeat (until volunteer captures calibrate planarity), account comparison, repeat, similar background (the e2e stack reuses the same faces), covering, glasses, suspicious entity;
   - **disabled:** age comparison, public figure.

   The mocked flow suite pins its own centre-only, passive template for specs that are not about the selfie.
2. **Synthetic fixtures** (OpenCV and NumPy only, seeded, gitignored, labelled "pipeline fixtures, not attack-detection rates"):
   - **head-turn clips:** 2.5-D re-posed public-domain portraits (the canonical face mesh, Apache-2.0, in `models/manifest.json`) following C40.11, as MJPEG; the centre segment is the unmodified portrait. Person A (matches the ID) and person B (does not). Still triples of the same renders for unit tests;
   - **static replay:** today's drifting-still clip;
   - **spoofs:** screen replay (the LCDMoire recipe), phone composite with a bezel, print halftone (research §10.3);
   - **covering and glasses:** masks, scarves, hands and clear or dark glasses composited along landmarks.
3. **End-to-end** (Stage 4):
   - updated:
     - `verification-completes.spec.ts`: the C40 protocol with the person A clip and auto-capture, three images, every required selfie check passed, liveness components recorded with `test-capture-device: true`;
     - `verification-fails.spec.ts`: person B, `face_mismatch`;
     - `reload-between-uploads.spec.ts`: per-pose uploads;
     - `government-id-review.spec.ts`: the new clip;
     - `ui-flow-links.spec.ts`: the three poses through the sandbox upload fallback, ending in `needs_review` with `capture_not_live`;
   - new:
     - the static-replay clip gets a pose retry hint;
     - a template requiring an unbound A-tier selfie check ends in `needs_review`;
     - two inquiries of different accounts with the same face, both ticking the matching-consent box: the second one's `selfie_repeat_detection` fails with `face_seen_on_other_account` (advisory, so it still completes), and the recorded consent shows the optional key;
     - a built-bundle flow spec fails on any `securitypolicyviolation` and on any request outside the flow and API origins;
   - a Testcontainers test: a passed verification with matching consent has a template row, and one without consent has none;
   - capture expiry is tested in Testcontainers with a fake clock, not end to end;
   - each clip needs its own browser launch (Chromium's fake camera is process-wide), and the mocked and full-stack suites run one after the other (`turbo.json`).
4. **Docs** (Stage 4): `docs/checks/selfie.md` gives every §4.2 check's tier, stage, inputs, reasons, config with basis, and limits. It says what the protocol does **not** stop:
   - real-time face swaps or reenactment through a virtual camera;
   - a looping or pre-recorded head-turn video: with auto-capture, the random side order adds little;
   - several stills of the person shown in turn;
   - 3-D masks.

   And plainly:
   - the nonce proves only possession of the create response; `capture-method`, client timings and the device snapshot are client claims;
   - label and `webdriver` signals stop only unsophisticated attackers;
   - `passed` with `active: not_requested` means one model found no attack on one frame; it is not proof of a live person;
   - the synthetic-face heuristic's detection rate is unmeasured, it does not detect modern generators, and a JPEG-grid misalignment is weak evidence on resized or re-encoded uploads.

   It also covers the virtual-camera list (copied from the data file, with a field-collection note), the sandbox test-capture rule, C42.9, and the workaround for users who cannot turn their head (a template with `poses: ["center"]` and `liveness: "passive"`). `docs/checks/sandbox-providers.md` gains the selfie providers.

### C46. Client capture (Workflow 4A)

1. **Web flow** (`apps/flow`):
   - the C40 protocol: create or reuse the verification, create the capture, prompt in the server's order, upload each pose before the next prompt, submit with the device snapshot (`image-mirrored: false`; captures are never mirrored);
   - **guidance:** `onnxruntime-web@1.30.0` (MIT) runs the pinned YuNet model in a single-threaded WebAssembly session (`numThreads` 1, explicit `wasmPaths` on the flow's origin, no proxy worker, `logLevel` `error`) at about 8 Hz on a 320-pixel preview. YuNet's output decoding (anchors and NMS) is reimplemented in TypeScript and tested against `contracts/fixtures/vision/yunet-decode.json`, which Stage 1 records from OpenCV's `FaceDetectorYN` on the same image. It checks face found, one face, centred, distance and the yaw-ratio change from the user's own centre frame, and captures automatically per C40.11, with the manual shutter after 10 s. If the model or WASM fails to load, the manual shutter shows at once and nothing is logged as an error;
   - the camera stays open for the whole capture;
   - a local Vite plugin copies the model and the WASM files into the build from `models/` and the package, verifying their SHA-256; nothing is fetched from a CDN. The CSP gains `script-src 'self' 'wasm-unsafe-eval'` and nothing else; the serving layer sends `application/wasm`;
   - prompts and guidance strings in English and Spanish, with a live region announcing each prompt; the 3B follow-up "Try again in the capture step loses focus" is fixed here;
   - **matching consent:** the consent step shows each `optionalTextKeys` text with its own unchecked checkbox, fills `{{days}}` from the session's `face-template-retention-days`, and sends the checked keys as `optional-text-keys`; `text-keys` stays exactly the step's `textKeys`;
   - the sandbox upload fallback creates a capture with `method: upload` and uploads each prompted pose;
   - the guidance never decides anything: the server re-measures every frame.
2. **Android** (`android/openverify-sdk`):
   - the same protocol through `FlowApiClient`: create, per-pose upload, submit with a CameraX device snapshot mapped onto the C40.4 members, and `image-mirrored` as the saved JPEG actually is, asserted by a test;
   - prompts in the server's order with a manual shutter, English and Spanish strings, a new capture after 409;
   - the matching-consent checkbox, `{{days}}` and `optional-text-keys`, as on the web;
   - on-device guidance waits for Phase 10;
   - the 3B follow-up "an `UNKNOWN` verification status leads to a new attempt" is fixed here.

### C47. Console surfaces (Workflow 4B)

- The selfie verification page and card: the pose photos in prompt order with their labels; the ID portrait beside the centre photo with the similarity, the threshold and its basis; the C40.10 scores; the liveness components and flags in words; the capture's `prompt-timings`. No device data is shown (there is none in the API).
- The selfie captures on the inquiry page with their status and error code.
- Words for every C39.2 reason: 4B first extends `apps/dashboard/src/lib/check-reasons.test.ts` to `SELFIE_CHECK_REASONS` (RED), then adds the words.
- The environment settings `face-template-retention-days` and `face-search-max-templates` on the settings page, and the consent keys a user accepted (required and optional).

The API side of each item (the dashboard inquiry document's captures, the inquiry session's recorded `text-keys` and `optional-text-keys`, the settings route) is built in 4A: schemas in Stage 1, routes by `api-flow`.

### C48. Carry-over into Phase 4

| Item | From | Owner |
|---|---|---|
| ONNX Runtime telemetry on by default in the vision image | research §0 | `contracts` (Stage 1) |
| `fetch_fixtures.py` rejects template names with spaces; no 429 handling; no archive fallback; no calibration mode | research §10 | `fixtures` (4A) |
| PLAN §3 and §6: "MediaPipe Face Landmarker (client)" and "Web capture with MediaPipe guidance" become onnxruntime-web + YuNet; "pHash (`imagehash`)" becomes our own OpenCV code; Phase 10's "selfie active liveness with MediaPipe" becomes `onnxruntime-android` | research §0.6 | `contracts` (Stage 1) |
| SFace's 0.363 threshold has a thin margin for some impostor pairs | Phase 1 carry-over | `calibration` (4B, C49) |
| Vitest 5's module cache keeps `import.meta.glob` results stale | 3B follow-up | `contracts` (Stage 1, `packages/config`) |
| The capture step's "Try again" loses focus | 3B follow-up | `flow-capture` (4A) |
| Android: an `UNKNOWN` verification status leads to a new attempt | 3B follow-up | `android-capture` (4A) |
| `contracts/fixtures/api/verification-selfie.json` shows brightness 128.4 (a 0–255 scale) while vision reports 0–1 | inventory | `contracts` (Stage 1) |
| Licences: onnxruntime-web (MIT, with Eigen MPL-2.0 inside the WASM served to browsers), the canonical face mesh (Apache-2.0 attribution), the training-data caveats of YuNet, SFace and MiniFASNet; ORT's third-party notices served with the flow | research §0, §1 | `contracts` (Stage 1, `THIRD_PARTY_LICENSES.md`) |
| The flow container image: `.dockerignore` excludes `models`, so the YuNet model cannot reach the flow build | review F10 | `contracts` (Stage 1: allowlist `models/face_detection_yunet_2026may.onnx`, verify its SHA-256 in the build) |

### C49. Face-match calibration (Workflow 4B)

1. **Set.** `fixtures/calibration-manifest.json` (committed; the images are not): Wikimedia Commons `PD-USGov-NASA`, `-DOS` and `-Military*` official portraits only (research §10.1). Congress portraits are left out (they need a per-file credit check), and so is any file tagged `{{Personality rights}}`.
   - **Target:** about 450 people (research's realistic pool) with at least two distinct photos each, and at least 1,000 genuine pairs. The report states both counts and the rule-of-three FRR floor next to every FRR.
   - **Pinning:** each original by URL (query string stripped), SHA-256, size, Commons sha1 and the file page's revision id.
   - **Identities:** pseudonymous ids (`p0001`) in the manifest; no names beyond what the file URL itself contains.
   - **Rules fixed before any score is seen:** near-duplicates are an SFace cosine above 0.93 or an aligned-crop pixel correlation above 0.95; an exclusion needs Commons metadata showing a different person or a misattribution, never a low score.
   - **Review:** both tails (the lowest genuine pairs and the highest impostor pairs) are reviewed once, shown without scores, and the decision is pinned in the manifest. FRR is reported before and after, with the count removed.
   - Fetched on demand with `scripts/fetch_fixtures.py --calibration` (built by `fixtures` in 4A), never in CI. Embeddings stay in memory: a test asserts the tool writes none to disk. A takedown note says how to remove a person.
2. **Report** `docs/calibration/selfie-phase4.md`, written by `packages/checks/scripts/calibration-report.ts`'s selfie mode from `tools/calibrate_selfie.py`'s measurements, whose JSON schema and a sample Stage 1 fixes:
   - FRR at the threshold for FAR 1e-3, with 95% intervals from a two-sided bootstrap over identities (same-identity pairs never used as impostors). FAR 1e-4 is reported as "not resolvable at this size" unless the interval's upper bound is below 3e-4;
   - the expected false-match count for a 1:N search at N = 1,000, 10,000 and 100,000;
   - every number names its domain ("studio portrait pairs"; not selfie against an ID card photo);
   - **skew:** sex, the age gap between photos, an ITA-angle distribution of face skin pixels (a proxy, stated as one), and that per-group FRR is unmeasured;
   - the pose, planarity, passive-liveness, covering and glasses distributions on the synthetic fixtures, labelled `provisional`, with the statement that simulated spoofs do not measure APCER/BPCER;
   - the purpose and lawful-basis statement and the takedown note.
3. **Defaults.** The shared 1:1 face threshold moves from 0.363 only with a documented margin and becomes `calibrated`; otherwise it stays, with the report's numbers beside it. The repeat threshold's floor is the 1:1 value at FAR 1e-3, and it stays labelled gallery-size dependent.

## Workflow 4A (build)

### Agents and ownership

- **Stage 1: `contracts`** (alone, so it may touch any path; it keeps every suite green).
  - **Core and contracts:**
    - C39: the registry and PLAN §4.2 rows, the reasons file, the frozen UB reasons with their flow strings, Android messages and retry-hint fixture, config schemas with provisional defaults and their basis, `threshold-basis` in provenance, the shared `FACE_MATCH_DEFAULTS`, the contract test scaffold;
    - C40: the capture resource and state machine, the flow API bodies and fields, the upload limits, the events with webhook samples and a server-only `selfie` resource fixture, the dashboard event group "Selfie", the verification attributes, `self` in every id and redaction list, the flow-spec `centre` rule and `optionalTextKeys`, the consent body; 501 stubs for the new routes so the OpenAPI snapshot is complete; `@openverify/node` types;
    - C40.11 shared constants (with the yaw measurement) and the golden capture fixtures; C45.1 default template with every test that reads it; the dashboard settings fixtures for the two new settings;
    - the strict schemas Stage 3 cannot edit: the `selfie` resource in `dashboardInquiryDocumentSchema.included`, `face-template-retention-days` in `flowSessionResponseSchema`, and the recorded `text-keys`/`optional-text-keys` on the dashboard's session view (C47);
    - `apps/api/src/ports.ts`: the C41 types, `VisionClient.compareBackground`, the three selfie port interfaces and their kinds.
  - **Shared functions both Stage 3 agents call** (written and tested here; Stage 3 does not change their signatures): the capture repository's transitions and `selfie.*` event staging (newest submitted capture, processed, errored, device clear), the file repository's replay lookup, and `deleteFaceDataForInquiry`.
  - **The e2e exclusion.** Stage 1 cannot keep the full-stack selfie specs green: the new default template requires checks that answer `not_implemented` until Stage 3, and the flow speaks the new protocol only from Stage 2. Stage 1 adds a listed exclusion for `verification-completes`, `verification-fails`, `reload-between-uploads`, `government-id-review` and `ui-flow-links`; Stages 1–3 run `pnpm e2e` with it and say so in their TDD files; `integration` removes it. Every other suite stays green at every stage.
  - **Storage:** migrations for `selfie_captures`, the `files` columns and index, `face_templates`, `selfie_backgrounds` (vector, HNSW); repositories with stub behaviour; the redaction lists and coverage entries for all three tables; the two environment settings.
  - **Vision:** the C41 schemas in pydantic and zod together, with stub analysers (`null` or zero values) that `analysis.py` already calls; one module per Stage 2 owner (`pose.py`, `liveness.py`, `occlusion.py`, `replay.py`, `synthetic_face.py`, `background.py`), each a stub; the `/v1/compare/background` route as a stub with its per-route limit; the golden fixtures regenerated; `yunet-decode.json`; C41.4 telemetry off with its tests; a minimal re-pose helper (projecting the canonical face points at a given yaw) for Stage 2 unit tests.
  - **Plumbing:** dependencies added once (`onnxruntime-web@1.30.0` in `apps/flow`; `scikit-image==0.26.0` in the vision `dev` group only, with `imageio` and `tifffile` pinned to versions at least 14 days old); the canonical face mesh in `models/manifest.json`, `.gitignore` (`models/**/*.obj`) and both CI model caches (key prefix `models-v3-`); the calibration JSON schema and sample; the C48 rows it owns.
- **Stage 2** (parallel; each agent edits only its own paths, and the shared vision files `analysis.py`, `schemas.py` and `app.py` only inside blocks Stage 1 marked for it):
  - **`vision-face`:** landmarks, `image`, `face_quality`, `head_pose` (with the two direction tests), `passive_liveness` (exact upstream preprocessing, the box transform, a parity test against recorded upstream outputs), `occlusion`. Owns `faces.py`, `quality.py`, `pose.py`, `liveness.py`, `occlusion.py` and their tests.
  - **`vision-integrity`:** `consistency` (identity cosine, planarity by tracked points and a homography, own SSIM checked against scikit-image in tests, duplicates), `synthetic` (with the hostile-XMP tests), `background` and `/v1/compare/background`. Owns `replay.py`, `synthetic_face.py`, `background.py` and their tests.
  - **`checks-logic`:** every C43 evaluator under `packages/checks/src/selfie/`, the cascade, the timing and order flags as pure functions, H-tier scoring and confidence, the registry `configSchema`s, fraud reasons; the calibration report's selfie mode (FAR/FRR with the identity bootstrap, the gallery-size table). Owns `packages/checks`, `packages/core/src/check-config.ts` and the registry's `configSchema` fields, `packages/contracts/src/selfie-check-reasons.ts`.
  - **`fixtures`:** C45.2 (every synthetic fixture and the head-turn MJPEG clips from the shared constants, the generator version stamp so `e2e/setup/stack.ts` regenerates), the `fetch_fixtures.py` changes (template names with spaces, Retry-After and 429 backoff with at least 1 s spacing and at most 2 connections, the archive-URL fallback, the `--calibration` mode that tolerates a few 404s but fails on any digest mismatch), `tools/calibrate_selfie.py` (writing the Stage 1 schema) and `tools/benchmark_selfie.py`. Owns `services/vision/tools/` (except `make_contract_fixtures.py`), `scripts/fetch_fixtures.py`, `fixtures/manifest.json`.
  - **`flow-capture`:** C46.1. Owns `apps/flow` (the dependency is already added) and the mocked flow e2e specs. The mocked suite covers the guidance state machine with an injected detector and the manual fallback; auto-capture is first exercised end to end in Stage 4.
  - **`android-capture`:** C46.2. Owns `android/`.
- **Stage 3** (parallel, disjoint paths):
  - **`api-flow`:** C40 routes and services (create, upload fields, submit, supersede, the cap with the inquiry settlement, every cancel path's capture update, consent changes, publish-time consent and centre validation), the `selfie` resource, its events and inclusion, the verification attributes derived from check metadata, the dashboard inquiry document's captures, the session's recorded consent keys, the settings route, the operator-decline deletion of face data, the race tests for its writers, the regenerated OpenAPI snapshot and `@openverify/node`, and the plan amendments for Stage 2 and its own work. Owns `apps/api/src/routes/`, `apps/api/src/services/` (except `retention.ts`), `apps/api/src/plugins/`, the capture and file repositories in `packages/db`, `packages/contracts/src` (recorded amendments only), `packages/node`, `contracts/fixtures/api`, `docs/api/openapi.json`, `docs/plans/phase-4.plan.md`.
  - **`api-worker`:** the selfie job v2 (every file, the capture context, every evaluator with thresholds, the cascade, decisions, the last-attempt rule, the capture's processed/errored transitions), template and background writes under the lock order, the C42 scan and background search with `/v1/compare/background`, the A-tier ports and sandbox providers with startup validation, `stateOf`'s count of capture-cap cancels, `face-index:rebuild`, retention of templates and backgrounds, the race tests for its writers. Owns `apps/api/src/jobs/`, `apps/api/src/providers/`, `apps/api/src/ports.ts`, the provider expectations in `apps/api/src/config.test.ts`, `apps/api/src/worker.ts`, `apps/api/src/vision/`, `apps/api/src/services/retention.ts`, `apps/api/scripts/`, the template and background repositories in `packages/db`. It reports its plan amendments in `contractDeviations`; `integration` writes them.
- **Stage 4: `integration`.**
  - The C41.5 benchmark and its CI step; the C42.4 scan re-measured.
  - The C45.3 end-to-end specs and the `turbo.json` ordering.
  - `docs/checks/selfie.md` and the sandbox providers doc.
  - Removing the Stage 1 e2e exclusion; the whole validation list, including the container image build; integration defects fixed test-first in whichever path they live.
  - The plan amendments for `api-worker` and its own work.
  - Owns `e2e/`, `docs/checks/`, `.github/workflows/ci.yml`, `infra/tests/`, `turbo.json`, `docs/plans/phase-4.plan.md`, and any path for a defect fix, under the git lock.

### Rules for every agent

- **TDD:** RED first, run and seen failing for the intended reason; the RED commit must compile and typecheck (the e2e stack's `next build` type-checks tests). Then GREEN, then refactor. Evidence in `docs/tdd/phase4-<agent>.tdd.md`.
- **Shared resources.** Commits are path-scoped under `flock /tmp/openverify-git.lock` and check `git diff --cached --quiet` first. Full-stack e2e runs under `flock /tmp/openverify-e2e.lock`. Long gates run in the foreground with a 600,000 ms timeout. Tests that only fail under load are made deterministic, not retried.
- **Honesty (ADR 0002).** No code path returns `passed` on an error or without its input. H-tier results and liveness carry a confidence. No threshold is fitted to a fixture; a provisional default is labelled so. No check special-cases a fixture beyond the sandbox test-capture rule (C43) and the Utopia rule (C30.7).
- **Biometrics.** No embedding, landmark set, face crop, device label or background vector from a real face or background in logs, check metadata, problems, events or git. Calibration keeps embeddings in memory only.
- **Content.** No Persona name or copied text; public-domain faces and synthetic data only.

## Workflow 4B (surfaces, calibration, review, fixes)

- **Stage 1** (parallel):
  - `surfaces-dashboard` builds C47. Owns `apps/dashboard` and the dashboard UI specs.
  - `calibration` builds C49: the manifest, the fetch, the measurement run, the report, and the face-threshold default if the report supports a change. Owns `fixtures/calibration-manifest.json`, `docs/calibration/`, `FACE_MATCH_DEFAULTS` with its basis, and, for fixes, `services/vision/tools/calibrate_selfie.py` and `scripts/fetch_fixtures.py`.
- **Stage 2, review of all of Phase 4** (read-only, in parallel): privacy and security (biometrics, the capture protocol, the templates, consent, redaction races); check correctness (C43 and the cascade against the measurements, decisions, honesty, calibration); vision (preprocessing parity, numerical robustness, hostile inputs, budget); clients and console (protocol, a11y, i18n, CSP). Then one verifier for every CRITICAL and HIGH finding, then path-owned fixers (TypeScript, Python, Android as needed).

## Validation

```bash
pnpm install --frozen-lockfile && pnpm format:check
pnpm turbo run lint typecheck --force
pnpm test                                     # every package ≥80%
pnpm test:integration                         # Testcontainers: db, api (race tests included)
python3 scripts/fetch_models.py               # every model in models/manifest.json
(cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest)
(cd android && ./gradlew testDebugUnitTest koverVerify assembleDebug lint)
pnpm e2e                                      # mocked flow suite, then the Phase 1–4 full-stack specs
docker build -f infra/docker/apps.Dockerfile .   # the flow build carries the YuNet model
for t in infra/tests/*.test.sh; do bash "$t"; done
gitleaks git --redact .
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Passive liveness rejects genuine webcam users, or accepts every spoof simulation | High | Upstream's own 0.5 decision point, labelled provisional; the genuine-webcam FRR stated as unmeasured; confidence capped; a failing e2e clip changes the generator, never the threshold |
| YuNet's 5 landmarks under-read real head turns | Med | The yaw-ratio change relative to the user's own centre frame; provisional thresholds no stricter than the client triggers; pose failures are user behaviour with a retry hint (the cascade) |
| A genuine user fails without a retry | Med | The cascade (C43) and its contract test; pose repeat, glare and covering advisory by default |
| Auto-capture in the browser is slow or flaky on CPU-only CI | Med | Single-threaded WASM at about 8 Hz on a 320-pixel preview; the manual fallback; shared constants tie the clip, client and server; the suites run one after the other |
| Face templates leak | High impact | Sealed under the KEK like all PII, only from passed verifications with a separate optional consent, environment-scoped, redacted, a 365-day default and a 1,095-day ceiling; a dedicated privacy reviewer in 4B |
| 1:N search raises false matches as the gallery grows | Med | A 1:N threshold never below 1:1, a gallery-size table in the report, advisory by default, the scan cap recorded in metadata |
| Redaction races leave biometric rows behind | Med | The C40.6 lock order and a Postgres test per writer |
| The protocol is mistaken for injection-attack protection | Med | `docs/checks/selfie.md` lists what it does not stop; every selfie check is `beta`; no certification claim |
| Calibrating on real public officials' faces | Med | PD-USGov only, personality-rights files excluded, pseudonymous ids, images and embeddings never committed or persisted, purpose and takedown documented; owner decision |
| Patent exposure (glasses bridge gradient, colour-flash liveness) | Low–Med | A multi-cue glasses score; no colour-flash challenge; owner decision for a legal read |

## Acceptance

- [ ] All 15 §4.2 checks have an evaluator at their tier; no enabled check answers `not_implemented`.
- [ ] Every selfie result carries `stage`, `confidence` (H-tier and liveness) and `provenance` with models and threshold basis; reasons come from `SELFIE_CHECK_REASONS`.
- [ ] The cascade contract test passes: an insufficient turn alone is a retryable failure with a pose hint.
- [ ] The capture protocol: create, per-pose upload, submit; expiry, single use, idempotent repeat, supersede and the cap tested against Postgres; a race test per writer; `selfie.*` events in the C40.8 order.
- [ ] Templates are written only for passed verifications with matching consent, sealed, scanned within the cap, redacted, retained at most `face-template-retention-days`, and rebuildable without creating rows.
- [ ] Vision telemetry is off and tested; the flow loads nothing from outside its own and the API's origins.
- [ ] The face-match calibration report exists with FAR/FRR, intervals, domain and skew; every other default is labelled provisional.
- [ ] Every validation command passes locally and in CI on GitHub.
- [ ] `docs/tdd/phase4-*.tdd.md` exists for each agent, and `docs/PROGRESS.md` records Phase 4.

## Decisions for the owner (made here; confirm or change)

1. **No MediaPipe.** Its web builds from 1.0.0 and every Android build send usage data to Google with no opt-out (research §0). The web flow uses onnxruntime-web with the YuNet model the server uses; Android guidance in Phase 10 will use `onnxruntime-android` with its telemetry provider removed.
2. **Server head pose from YuNet's five points**, judged relative to the user's centre frame. The dense FaceMesh V2 model (Apache-2.0) would be better, but converting it needs TensorFlow at fetch time or a self-hosted converted file; deferred.
3. **Stored face templates, sealed and scanned** (reverses C31.9 for selfies). They are encrypted under the KEK like other PII and scanned in the worker up to a cap, with no ANN index. The privacy review found that a keyed rotation in a pgvector index is probably recoverable from the database plus the public model, so an ANN mode for very large galleries is left to Phase 7, with that finding attached.
4. **A separate, optional matching consent** (`consent.biometric-matching`) with its own checkbox; declining it still allows verification. Its wording needs legal review.
5. **`selfie_id_comparison` without an ID portrait** answers `not_applicable` (review when required) instead of `failed`.
6. **`selfie_face_covering_detection` becomes user behaviour**, with a retry hint.
7. **The sandbox test-capture rule** (C43): Chromium's file-backed camera, `webdriver` and byte replays do not fail liveness in a sandbox environment.
8. **Three poses and active liveness** in the default template. The random order of two side poses adds little against a looping video; the docs say so. A multi-frame or video challenge is a later phase.
9. **Calibration on Commons PD-USGov official portraits** (real, identifiable public officials; copyright-cleared but still biometric processing), never committed, embeddings never persisted.
10. **Training-data provenance.** The research applied a strict standard (training data must also be permissive). By it, no age, deepfake, mask or glasses model qualifies, and the already shipped YuNet (WIDER FACE, non-commercial), SFace (undisclosed among research datasets) and MiniFASNet (undisclosed) carry caveats. Phase 4 follows the repository rule as written (the weights' licence governs) for the models already shipped, documents the caveat in `THIRD_PARTY_LICENSES.md`, and adds no new trained weights.
11. **ONNX Runtime.** Telemetry is off. Eigen (MPL-2.0) is compiled into the shipped onnxruntime and into onnxruntime-web's WASM, which browsers download; both need an explicit exception to rule 4. The locked 1.31.0 is younger than 14 days today.
12. **Patents** (not legal advice): a freedom-to-operate read on glasses detection (US 10,395,094 B2) before relying on it; no colour-flash liveness.
13. **Provisional thresholds.** Every selfie threshold except face match ships labelled `provisional`; pose repeat, glare and covering are advisory by default until real captures calibrate them.
14. **Templates only from passed verifications**, deleted when an operator declines the inquiry. Known-fraudster faces belong to Phase 7's face lists.
15. **Retention:** `face-template-retention-days` defaults to 365 (maximum 1,095); raw selfies follow inquiry retention.
16. **The break for old clients** (C40.7): a new selfie verification needs a capture.
17. **Users who cannot turn their head** have no automatic review fallback; the documented workaround is a centre-only, passive template.
18. **The 11th capture cancels the verification**, so a stuck user starts a new attempt; the last attempt's cancel fails the inquiry.
19. **Side-pose passive scores are recorded, not judged.** MiniFASNet is unvalidated on turned faces (research §3), so judging them would add false rejects; `pose_identity_mismatch` covers the mixed-photo attack.
20. **Pose hints name the failing pose.** That helps the user, and also tells an attacker which pose failed; accepted because pose is user behaviour and `maxAttempts` caps the retries.
21. **A second face on any pose stays fraud** (`selfie_multiple_faces_detection`), with the 25% area floor and box merging limiting bystanders and posters. A side-pose bystander therefore ends the inquiry on the first attempt; the Phase 1 behaviour was stricter (any face on the centre).

## Workflow 4A Stage 1 amendments (contracts)

Decisions the plan left open, and changes the measurements forced, recorded by `contracts` (`docs/tdd/phase4-contracts.tdd.md` has the evidence).

1. **C40.11 measurement and the clip yaw.** `services/vision/tools/measure_yaw_anchor.py` re-posed the three public-domain faces (640-pixel frames, YuNet 2026may): `min-side-yaw-ratio-change` 0.077 (median change at ±12°), `max-center-yaw-ratio` 0.021 (median |ratio| at ±5°). At ±22° the smallest change was 0.076, below 1.25 × 0.077 = 0.096; at 24° it is 0.0996 (median 0.124), so the clip's `target-yaw-deg` is **24** (within the ±25° limit). Every reading is in `contracts/fixtures/flow/selfie-capture.json` (`measurement`).
2. **The centre anchor is stricter than one fixture's own frontal reading.** person-a-selfie reads `yaw_ratio` −0.0436 unmodified (person-a-id −0.0093, person-b 0.0082), above 0.021, and the client's centre trigger (0.8 × 0.021 = 0.0168). Following "the generator changes, never the threshold", the `fixtures` agent renders the clip's centre segment at the small yaw that YuNet reads within the trigger, instead of the unmodified portrait (C45.2 amended). Real users whose frontal pose YuNet reads off-centre will meet the manual shutter and may fail `pose_not_center` (a retryable hint): an owner decision to revisit with real captures.
3. **Shared constants file** keys (kebab-case): `clip` {`width` 640, `height` 480, `format` mjpeg, `frame-rate` 30, `cycle` [center, left, center, right], `starts-at` center, `min-hold-seconds` 1.5, `target-yaw-deg` 24, `max-period-seconds` 8}; `client` {`hold-ms` 500, `side-trigger-factor` 1.25, `center-trigger-factor` 0.8, `guidance-hz` 8, `preview-width-px` 320, `manual-shutter-after-ms` 10000, `camera-stays-open` true}; `server` {`max-center-yaw-ratio` 0.021, `min-side-yaw-ratio-change` 0.077, `capture-ttl-seconds` 180}. TypeScript reads them as `SELFIE_CAPTURE_GUIDANCE_DEFAULTS`, `SELFIE_CAPTURE_CLIENT` and `SELFIE_CAPTURE_TTL_SECONDS` (`@openverify/contracts`), each tested equal to the file.
4. **Config key names left open:** `max-face-covering-score`, `max-glasses-score`, `max-synthetic-face-score` (suspicious entity). Provisional defaults and bases are in `SELFIE_CHECK_CONFIG_DEFAULTS`; `min-face-blur-score` 15 and `min-face-width-px` 64 reuse `id_portrait_clarity_detection`'s measures and defaults, `min-face-height-ratio` 0.2, `min-image-short-side-px` 480, `max-face-glare-ratio` 0.05, background `min-orb-inliers` 100, `min-inlier-ratio` 0.5, `min-coverage` 0.25, the three H-tier scores 0.5.
5. **`yunet-decode.json` uses a drawn synthetic face**, not a public-domain photograph, so no real face's landmark set enters git (team rule 9). YuNet scores it 0.89 at 160 × 120 (padded to 160 × 128).
6. **Vision schema choices:** `PoseConsistency.duplicate_of_center` is nullable (null = not measured), so a stub never claims "not a duplicate". Selfie `faces[]` carry their five landmarks (a `SelfieFace`); government ID faces are unchanged. `model_versions` of the selfie analysis is its own type (`anti_spoof_v2`, `anti_spoof_v1se`, null until the ensemble runs). `/v1/compare/background` answers 501 until `vision-integrity` builds it, refuses fields other than `probe` and `candidate_0`-`candidate_4` (422), and has its own body limit (6 × the upload limit + overhead).
7. **Ids:** `self_` (selfie captures, public), and `ftpl_` (face templates) and `sbg_` (selfie backgrounds), internal to `packages/db`.
8. **Storage:** `files.selfie_capture_id` is a composite FK to `selfie_captures (environment_id, id)` with `ON DELETE CASCADE`; a partial unique index allows one `initiated` capture per verification; `selfie_captures.nonce_sha256` is `bytea` checked to 32 bytes; `face_templates` has no vector column; the two face template settings live in `environments.settings` (jsonb), so no migration.
9. **The submit body** is `{ capture? }` and may be absent (`nullish`), since a government ID submit sends none.
10. **The publish-time centre rule** is `checkFlowPublishable` (contracts), run on the create and update bodies and the version content schema, never on read schemas.
11. **Tests of Phase 1-3 selfie behaviour pin the Phase 3 step** (centre, passive, three Phase 1 checks): `phase3SelfieTemplate` in `apps/api/src/jobs/testing.ts`, the flow's `defaultFlow()` fixture, the mocked flow API and Android `FakeFlowApi.DEFAULT_FLOW`. `api-worker`, `flow-capture` and `android-capture` move them to the C45.1 default with their protocol work.

## Workflow 4A Stage 2 amendments

The Stage 2 agents' decisions that change or settle a contract, recorded by `api-flow` (Workflow 4A Stage 3) from their reports and TDD files (`docs/tdd/phase4-<agent>.tdd.md` has the evidence). Changed tests and process notes stay in the TDD files.

### Workflow 4A Stage 2 (vision-face)

1. **`blur_score`** is the Laplacian variance of the face region scaled **down, never up**, to at most 112 pixels wide: the measure of `id_portrait_clarity_detection`, which the provisional `min-face-blur-score` 15 cites. Upscaling a small face would report `image_blurry` where `face_too_small` is the cause.
2. **`face_quality.box`** is the primary face box clipped to the image (the region measured); `width_px`, `height_ratio` and `center_offset` (box centre minus image centre, over the image width and height) come from it.
3. **`head_pose`:** `yaw_deg` has the sign of `yaw_ratio`; `pitch_deg` is positive with the chin up; `roll_deg` = atan2(y_left_eye − y_right_eye, x_left_eye − x_right_eye), positive when the image-right eye is lower. SQPnP intrinsics: f = image width, principal point at the centre. `yaw_deg`/`pitch_deg` are null when SQPnP has no usable solution; `head_pose` is null without five finite landmarks or with coinciding eyes. Frontal studio portraits read a pitch of −8 to −15°.
4. **The mirrored-photo direction test** uses each public-domain photo re-posed 20° toward the subject's left and that render mirrored: YuNet's frontal reading is mostly its own mirror-asymmetric bias (about ±0.03, above `max-center-yaw-ratio`), so an unmodified frontal photo does not flip reliably.
5. **Passive liveness without the model files** answers `passive_liveness: null` with a logged warning and null `model_versions.anti_spoof_*` (the C32.1 OCR pattern, not a 503); the liveness check then has no passive evidence and cannot pass. A model output other than three finite logits is a 500 `inference_failed`.
6. **The YuNet box transform** (provisional geometry, not a threshold) keeps YuNet's bottom edge and horizontal centre and takes a box 0.84 h wide and 0.88 h tall (h the YuNet box height), measured against upstream's own detector on 18 framings.
7. **`covering.score` is 0 whenever `forehead_valid` is false**; evaluators read `forehead_valid` first (`input_missing`).
8. **Defect for the owner of `tools/make_contract_fixtures.py`:** the golden `analyze-selfie.json` left pose has a negative `yaw_ratio` (−0.118), a right turn under C41.1.

### Workflow 4A Stage 2 (vision-integrity)

1. **C41.1 consistency:** the region is the centre's primary face box grown by half its size on every side, read at the same place on the side pose, both scaled so the face is at most 200 px wide. `raw_ssim` is our SSIM (Wang 2004, equal to scikit-image's) over the box, unregistered; `registered_ssim` warps the side by the planarity homography (tracked points, LMEDS), not ORB + ECC. `planarity` is null below 8 points kept after a 1-pixel forward-backward check or without a homography; residual ratios carry 5 decimals. Without a centre face only `raw_ssim` (whole frames at 256 px) and `duplicate_of_center` are measured; `duplicate_of_center` is true on an equal SHA-256 or a raw SSIM ≥ 0.99, null when neither was established.
2. **C41.1 background layout:** OpenCV float CIE Lab (so the pgvector L2 distance is CIE76 ΔE per cell), on a copy at most 640 px long after a sigma-6 blur; the person mask is a head ellipse plus a neck-and-shoulders polygon from the primary face box, grown by 12 px; 8 columns × 6 rows, row-major from the top left, 3 decimals; a cell is valid when at least half its pixels are background, else it holds the whole background's mean; `coverage` is valid cells / 48.
3. **C41.2:** each result's `index` is its candidate's field number; every face the finder sees is masked (the stored layout masks only the primary face); up to 1,000 ORB keypoints, Lowe's ratio 0.75, a 5-px RANSAC homography on the 640-px copy; `inlier_ratio` is inliers over good matches (0 without any); each upload is downscaled right after its decode.
4. **C41.1 synthetic cue scales** (measurements, none a threshold): `spectral_tail_deviation` ≥ 0 in decades of power per unit of normalised radius (null without a background window, a face window under 64 px, or a background tail within twice the quantisation floor); `residual_peak_ratio` = exp(face peak − strongest background window peak), about 1 when neutral; `noise_inconsistency` in [0, 1], one-directional (only a face smoother than its surroundings counts); `jpeg_grid_misalignment` in [0, 1] for any JPEG, null for PNG and WebP; `canonical_landmark_distance` ≥ 0, the mean distance of the FFHQ alignment square's corners from the frame's, in shares of width and height; `digital_source_type` the bare IPTC code; the XMP packet may sit anywhere and 64 KiB from its start are searched; `synthetic` is null only when nothing was measured.
5. **Open for checks-logic or 4B:** `SYNTHETIC_SIGNALS` treats a tail deviation of 1.0 as fully suspicious, while clean re-encoded public-domain photos read up to 2.19.

### Workflow 4A Stage 2 (checks-logic)

1. **Pose repeat** also answers `not_applicable`/`input_missing` when the centre fails `selfie_image_quality_detection`; a judged side with no measurement at all is `input_missing`, never `passed`.
2. **Pose detection:** `input_missing` for a missing file and for a pose whose face has no measured head pose; a pose without a face fails `pose_not_<pose>`; with no centre face only `pose_not_center` is reported, the sides unjudged (so a centre without a face fails two UB checks, both retryable).
3. **Liveness integrity:** `passed` needs a device snapshot and the replay lookup (`replayedPoses` not null); a replay found fails even without a snapshot; a virtual-camera label also applies in a sandbox; a `not_applicable` may carry `input_missing` and `capture_device_suspicious` together.
4. **Liveness order and timing:** `CAPTURE_TIMING_FLAGS` with `CAPTURE_TIMING_RULES {minPoseIntervalMs 300, maxClockSkewMs 5000}` (provisional); each flag and a broken prompt order scale a pass's confidence by 0.1 (at least 0.5 kept), before the 0.6 cap, and never touch a failure. An identity failure's confidence uses the lowest judged cosine; with several failures the highest confidence wins.
5. **Suspicious entity:** `trainedAlgorithmicMedia` and `compositeSynthetic` fail outright with confidence 1, also with a provider bound or erroring; the 0.5 cap applies to the heuristic's pass confidence too; a provider's confidence is its score when flagged and 1 − score otherwise; the fusion is max(weight × suspicion) over `SYNTHETIC_SIGNALS` (provisional); the canonical-landmark cue counts only for `capture-method: upload`.
6. **Age and public figure:** a centre without a face answers `input_missing` even when the provider answered.
7. **Repeat:** an empty gallery (searched 0) passes, since the scan ran over every stored template; the scan input carries `matchCosines` (every cosine ≥ `FACE_SCAN_FLOOR` = `FACE_MATCH_DEFAULTS.threshold`) so the evaluator applies the configured threshold.
8. **Background:** the evaluator re-checks that each candidate's face differs with the effective 1:1 threshold (`thresholds['face-threshold']`) and counts distinct faces by a worker-assigned `faceGroup`.
9. **C39.3:** `provenance['threshold-basis']` lists only keys whose value is a default; a key the template sets has no basis.
10. **C40.10:** `selfie_image_quality_detection.metadata['face-box']` is `[x, y, width, height]` normalised to [0, 1], 4 decimals; the corners are derived at read time (Stage 3 amendment 12).
11. **Legacy input:** `SelfieCheckInput.idPortrait: null` reads as `no_reference_data` with `metadata.reference: 'portrait'`; `idReference` supersedes it.
12. **Multiple faces:** a pose without a face passes (image quality reports it); a missing prompted file gives `input_missing` unless another pose failed.
13. **No reason amendment:** the 63 reasons the evaluators declare are all in `SELFIE_CHECK_REASONS`; core config is unchanged.
14. **C49 selfie report:** default input `fixtures/generated/calibration/selfie-measurements.json`; every FAR upper bound is at least 3/M and both rule-of-three floors are capped at 1; the resolvability rule (upper bound < 3 × target) applies to both targets; the 1:N table covers the shared 1:1 threshold, the repeat default and the FAR-1e-3 threshold; FRR before and after the review cannot be computed from the Stage 1 schema (it carries the kept pairs only), and the report says so.

### Workflow 4A Stage 2 (fixtures)

1. **C45.2 framing:** the generator, never the thresholds, chooses each clip's framing (face-height shares 0.30, 0.28, 0.32, 0.26, 0.34, 0.36) and centre yaw (0, then ±1 … ±5°), keeping the first combination that meets the centre trigger (0.8 × `max-center-yaw-ratio`) and the side trigger (1.25 × `min-side-yaw-ratio-change`) on the client's 320-px preview and the server's 640- and 320-px reads of the browser-encoded frame; extremes stay at ±24°. Person A: 0.30 with the unmodified portrait as its centre; person B: 0.28 with a +1° centre render (Stage 1 amendment 2). No combination: `ClipError` with every reading, a blocker.
2. **Clip timeline:** centre and extreme holds of 1.6 s, turns of 0.3 s with eased yaws; 228 frames, a 7.6-s period (generator constants, not in `selfie-capture.json`).
3. **Static replay:** `static-replay-a.mjpeg` is person A's centre still, drifting (zoom 1.02, sway up to 1 % of the frame) for 4 s; the Phase 1 `selfie-{a,b}.y4m` stay.
4. **Coverings:** the mask covers the mouth from below the nose, the scarf the chin, because YuNet at the service's 0.9 threshold loses a face whose mask covers the nose.
5. **Generator stamp:** `.generator-version` is `<GENERATOR_VERSION>+<12 hex digits of the SHA-256 of selfie-capture.json>` (now `6+9067ea6fbfe9`), so a change of the capture constants regenerates the clips; the generator needs YuNet and the canonical mesh (`--models`) and takes `--constants`.
6. **C49.1 calibration manifest format** (defined by `scripts/fetch_fixtures.py`): `schema_version` 1, `description`, `purpose`, `takedown`, `identities` (`id` `p0001`, `sex`, `images` with `id`, `url`, `source_page`, `revision_id`, `sha256`, `sha1`, `size`, `license_template`, optional `year` and `review`); no name, subject, author or note fields; templates `PD-USGov-NASA`, `-DOS` and `-Military(-words)*` only.
7. **C48 `fetch_fixtures.py`:** `--max-missing` 10 (calibration only; 404 and 410 count), `--jobs` 1 or 2 (default 2), at most 5 attempts per URL, `Retry-After` honoured up to 300 s, a doubling backoff from 2 s capped at 60 s, at most 3 archive revisions; `fixtures/manifest.json` gains an optional `sha1` per face.
8. **`calibrate_selfie.py`:** originals decoded up to 120 Mpx and scaled to a 2,000-px long side; impostor pairs carry no `age_gap_years`; ITA is the median Lab colour of two cheek patches, one median per identity; `--skip-provisional` writes `provisional: {}`.

### Workflow 4A Stage 2 (flow-capture)

1. **The guidance files** (YuNet, the ORT WASM and its loader, ORT's licence and notices) are copied into the build by the Vite plugin with their SHA-256 checked, and served from the flow's origin by the dev server too. Instead of `wasmPaths`, the detector fetches and checks the WASM, the loader and the model itself and hands ORT the verified binary (`env.wasm.wasmBinary`); ORT is resolved with the `onnxruntime-web-use-extern-wasm` condition so Vite emits no unverified second copy. A digest mismatch or a failed load never imports ORT: the manual shutter shows and the load is tried again on the next selfie step, with nothing logged as an error.
2. **The upload's multipart order** is `kind`, `capture-id`, `nonce`, `client-elapsed-ms`, then `file` (Android sends the same order).
3. **The unit fixtures' `defaultFlow()`** is the C45.1 default (three poses, active), with `centreOnlyFlow()` for the Phase 1-3 step.

### Workflow 4A Stage 2 (android-capture)

1. **An `UNKNOWN` latest attempt** shows the unsupported screen; it is never re-read nor replaced by a new attempt.
2. **`client-elapsed-ms`** is the time from the create's answer to the shutter on the device's monotonic clock, kept within 0-600,000; the upload time is the server's `received_at`.
3. **The capture's lifetime on the device's clock** starts when the create's answer arrives, so a capture older than `capture-ttl-seconds` there has expired on the server too: no photo is sent to it, and a new capture starts.
4. **After a refusing 409 the session is re-read first.** `selfie_capture_invalid` and `selfie_capture_incomplete` (on a pose or at submit) and `selfie_capture_limit` (on a create) restart; any other 409 keeps the "changed somewhere else" error.
5. **Sandbox picks:** a photo picked under a `camera` capture moves the attempt to an `upload` capture; the camera may still be used under an upload capture; the device snapshot is sent for camera captures only.
6. **Optional consent** is offered only when the SDK has the text and its checkbox label, a `{{days}}` text only when the session gives the days, below the required agreement.
7. **The frame rate** comes from a passive Camera2 interop capture callback; it cannot be verified without a device.
8. **The device snapshot** leaves out `webdriver`, `frame-stats` and `resize-mode` (all optional in C40.4).

## Workflow 4A Stage 3 amendments (api-flow)

Recorded by `api-flow`; `docs/tdd/phase4-api-flow.tdd.md` has the evidence.

### Workflow 4A Stage 3 (api-flow)

1. **Optional consent storage.** The consent jsonb gains `optional_text_keys`, written when the record has them; a consent without it (recorded before Phase 4) has none ticked. `ConsentRecord.optionalTextKeys?` lives in `packages/db/src/tables/inquiries.ts`.
2. **`recordConsent` (C42.3).** With a consent step, `text-keys` must include every `textKeys` (as before) and list nothing else, and `optional-text-keys` must be a subset of `optionalTextKeys`; an optional key sent as required, or a required one sent as optional, is refused. Each refusal is 422 naming the keys. Without a consent step, any `text-keys` are still accepted (Phase 2 behaviour) and every optional key is refused. The ticked optional keys are recorded (`[]` when none).
3. **The matching consent rule (C42.3)** is a service check, not a body schema: creating a template (whose version 1 is published at once) and publishing a version answer 422 with one problem per offending check, `pointer` `/data/attributes/verification-config/selfie/checks/<check>/required`. Drafts may be created and edited with it. Names: `MATCHING_CONSENT_TEXT_KEY`, `MATCHING_CONSENT_CHECKS`, `matchingConsentProblems` (`apps/api/src/services/inquiry-templates.ts`).
4. **The inquiry session resource** always carries `consent` (`accepted-at`, `text-keys`, `optional-text-keys`, `locale`; `null` before consent) through a new optional `InquirySessionRecord.consent` (`@openverify/contracts`); the server API, the dashboard and the `inquiry-session.*` events serve it.
5. **Create (C40.2).** A verification of another type is 422; one not `initiated` is 409; no consent is 409; `upload` outside a sandbox is 403 `sandbox-only`. The prompts always start with `center`, even for a stored step that lists it later or not at all; the side order is a Fisher-Yates shuffle on `crypto.randomInt`. The open capture is `expired` when `expires_at <= now`, else `superseded`. The 201 answer is `Cache-Control: no-store` like every flow response.
6. **The cap (C40.2).** "No attempt remains" counts every selfie verification of the inquiry, as `createFlowVerification` counts them for `maxAttempts`; the transaction stages `selfie.errored`, `verification.canceled`, then `inquiry.failed` and `inquiry.transitioned`, and the 409 `selfie_capture_limit` is answered after the commit.
7. **Upload (C40.3).** A capture-bound selfie pose without the capture fields is 409 `selfie_capture_required`; the fields on a non-selfie kind, some but not all of them, a malformed one, a repeated part or a value cut by the 64-byte field limit is 400; a pose the capture did not prompt is 422; a wrong nonce or a foreign, superseded, consumed or expired capture is one 409 `selfie_capture_invalid` body. The capture is checked before the object is stored (reading it `FOR UPDATE`) and again in the write transaction. Every upload, a government ID's too, now writes under the C40.6 order: the inquiry locked and re-checked open and not redacted (410 `redacted`, 409 when closed), the verification, then the capture.
8. **Submit (C40.4).** A capture on a government ID is 422. A capture-bound selfie without one is 409 `selfie_capture_required`, at the first submit and on a repeat; a repeat must name the capture that submitted the verification (`submitted`, nonce matching), else `selfie_capture_invalid`. Completeness counts only files stored under the capture, and `verification.submitted` lists those files. The label is sanitised (`sanitizeDeviceLabel`) before the snapshot is sealed. A selfie created before Phase 4 (`selfie_capture_required` false) may still submit without a capture.
9. **`prompt-timings`** are ordered by `received_at`, ties by the rows' creation (`selfieCapturePromptTimings`).
10. **Cancel paths.** `errorOpenSelfieCaptures` deletes the canceled capture's file rows too. The `expire` action and the simulation delete their objects after commit (`InquiryTransitionResult.storageKeys`); the inquiry expiry job has no storage, so its objects stay crypto-shredded (follow-up).
11. **Face data on decline or failure (C42.2)** is deleted inside `transitionInquiryInTx` whenever the inquiry moves to `declined` or `failed`, whoever moves it (an operator, the simulation, the worker, the capture cap).
12. **C40.10 attributes.** The consumed capture is the newest `processed` or `submitted` one; its method, liveness and prompts fill `capture-method`, `liveness` and `poses`. Scores are rounded to 4 decimals; a missing, malformed or out-of-range metadata value (cosines in [−1, 1], `liveness-score` in [0, 1]) gives `null`, and so does a `face-box` whose corners fall outside the image. They come from `selfieVerificationAttributes` (`@openverify/contracts`) through `VerificationRecord.selfie` (`SelfieVerificationDetails`), and are served by `GET /verifications/:id`, the inquiry's `?include=verifications`, the dashboard inquiry document and the `verification.*` events (`stageVerificationEvent`, which the worker calls).
13. **The `selfies` relationship** is on every selfie verification the API serves and on the inquiry in `GET /inquiries/:id`, the dashboard inquiry document and the inquiry events; the inquiry list and create answers leave it out.
14. **Includes.** `INQUIRY_INCLUDES` is `['verifications', 'selfies']` and `include` takes a comma list; the route answers `inquiryIncludeDocumentSchema` (verifications or captures in `included`; `InquiryDocument` is unchanged). `verificationDocumentSchema.included` takes files or captures; `VERIFICATION_INCLUDES` is `['selfies']`. Including captures needs `verifications:read`, as `GET /selfies/:id` does.
15. **Not done here:** capture ids in the `filter[inquiry-id]` timeline query (`packages/db/src/repositories/events.ts` is outside api-flow's paths), and golden 409 problem fixtures per C40 code (Android's `ContractFixturesTest` requires every `api/` and `problems/` fixture to be listed, and `android/` is not api-flow's). Both are follow-ups for `integration`.

## Workflow 4A Stage 3 amendments (api-worker)

Reported by `api-worker` in its `contractDeviations` and recorded by `integration` (Workflow 4A Stage 4); `docs/tdd/phase4-api-worker.tdd.md` has the evidence. Changed tests and process notes stay in the TDD file.

### Workflow 4A Stage 3 (api-worker)

1. **C44 variables.** `OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE_{SANDBOX,PRODUCTION}`, `OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE_{SANDBOX,PRODUCTION}` and `OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY_{SANDBOX,PRODUCTION}`. The only value is `sandbox` (or empty), as for C35; a sandbox value on a `_PRODUCTION` variable stops the API and the worker at startup. They are in `.env.example` and the compose `x-api-environment`.
2. **C44 port shapes.** A real selfie adapter has `sandbox: false` and one argument, `{ image }`; a sandbox provider has `sandbox: true` and a second argument, `{ referenceId, birthdate }`. `ProviderBindings` holds `BoundProviders` (the C35 and C44 ports), and the worker narrows on `provider.sandbox`.
3. **C44 sandbox magic values.** The reference id is lower-cased. `sandbox-public-figure` and `sandbox-suspicious-entity` match as whole tokens, `(?:^|[^a-z0-9])` before and `(?![a-z0-9-])` after. "Precedence" means that with several tokens only the first in the order public figure, suspicious entity, age applies, and the other providers give their ordinary answer. Scores are 0.97 for a match or flag and 0.03 otherwise. Without a magic age, the age is the compared ID's birthdate age on the clock's day, or 30 without a readable birthdate. The birthdate comes from the compared ID's stored extraction and is decrypted only when `selfie_age_comparison` is enabled; otherwise the sandbox context has `birthdate: null`.
4. **C40.2 `stateOf`.** Any `canceled` verification of a pending inquiry counts as a failed, retryable attempt (its count still exhausts `maxAttempts`). While an inquiry is pending, only the capture cap cancels a verification; expiry and the inquiry actions end the inquiry first.
5. **C42.2 template write.** Besides `declined`, a `failed` inquiry (read under the lock) gets no template; matching consent is re-checked under the inquiry lock in the decision transaction; when the worker's settlement moves an inquiry to `failed`, `deleteFaceDataForInquiry` runs in that transaction.
6. **C42.3 matching consent holds** when the pinned version's consent step lists `consent.biometric-matching` in `textKeys` or `optionalTextKeys`, and the inquiry's latest recorded consent (`getLatestInquiryConsent`) has it in `textKeys` or `optionalTextKeys`. Without consent no history lookup runs at all: no account comparison, no scan, no background search.
7. **C42.4 scan.** Batches of 1,000 (`FACE_SCAN_BATCH_SIZE`); one row past the cap is read only to tell a truncated scan from a complete one, and is not scored; `matchCosines` holds every cosine at or above `FACE_SCAN_FLOOR`; a `DecryptionError` makes the account comparison or the repeat check `execution_error` (logged with the check name), never a retry.
8. **C42.8 background search.** The 20 nearest rows (`BACKGROUND_NEIGHBOURS`), by HNSW with `hnsw.iterative_scan = strict_order` and `ef_search` 100, from unredacted inquiries of other accounts within `window-days`. A candidate whose face matches the current one at the effective 1:1 threshold is dropped before counting. A template that cannot be opened, or a centre file that is missing or undecryptable, is skipped and counted and does not use up the five; the first five readable candidates are compared. The search runs only with matching consent, the check enabled, a centre face and a layout coverage at or above `min-coverage`. A failed comparison on the last attempt gives `execution_error`.
9. **C42.6 retention.** `deleteExpiredFaceData` selects one batch of due templates; for each inquiry, in one transaction, it locks the inquiry, re-selects the still-due templates `FOR UPDATE`, and deletes their background rows, then the templates. It applies to an inquiry in any status. `RetentionReport` (and the `retention:run --json` line) gains `deletedFaceTemplates` and `deletedSelfieBackgrounds`.
10. **C42.7 `face-index:rebuild`.** The vision calls happen before the row transaction: `/v1/embed/face` with no subject and, for a row with a background, `/v1/analyze/selfie` on the centre. The transaction locks the inquiry, re-checks redaction, status and consent, then locks the template row; a row deleted meanwhile is never recreated. A row is deleted when its centre file is gone or unreadable (vision 413/415/422), when the new model finds no face, when consent no longer holds, or when the inquiry was redacted, declined or failed. An existing background row is kept when the new analysis measures no layout. Any other vision failure leaves the row and counts it, and the command then exits 1. `--dry-run` decrypts the files and reads eligibility, calls no vision endpoint and writes nothing. `--batch-size` defaults to 100 (maximum 10,000).
11. **C43 `capture_replayed`.** The worker uses its own query: any file of the environment outside this capture, including files without a capture (ID images, pre-Phase 4 selfies) and other captures of the same inquiry, excluding deleted objects and redacted inquiries. Stage 1's shared `findReplayedFiles` joins `selfie_captures`, so it never sees a file without a capture, and it leaves out every file of the current inquiry; its signature is unchanged and the worker does not use it.
12. **C43 reference portrait.** A stored ID front whose object is gone, or that vision cannot read, gives `no_reference_data` (`reference: portrait`). Phase 1-3 `idPortraitOf` decrypted it with `withImages`, so a missing object failed the whole selfie job for good.
13. **C43 on the government ID side.** `id_selfie_comparison` re-embeds the latest selfie that is `passed`, `submitted` or `needs_review` (`COMPARED_SELFIE_STATUSES`); C34 included `failed`.
14. **C40.7.** A selfie without a capture has every selfie file it holds analysed (Phase 3 sent only the centre), with liveness `capture_not_live`. Only files uploaded under the newest submitted capture count for a capture-bound selfie; a stray file of the kind without the capture is ignored.
15. **C40.8.** Stage 1 shipped no event-staging helper, so the worker stages `selfie.processed` and `selfie.errored` with its own `stageSelfieCaptureEvent` (`jobs/selfie-events.ts`): `buildSelfieCaptureResource` with `selfieCapturePromptTimings`. A verification left `submitted` (undecided) keeps its capture `submitted`.
16. **C40.5.** The worker's pino redaction keys are `device` and `label`, plus `landmarks`, `layout` and `template`.
17. **C41.2.** `createVisionClient().compareBackground` rejects with a `RangeError` for no candidates or more than five (`MAX_BACKGROUND_CANDIDATES`), without calling vision; vision answers 422 to a sixth field, which the worker would read as an unreadable image.
18. **C39.1.** The provenance model ids `minifasnet-v2-2.7` and `minifasnet-v1se-4.0` are pinned by their manifest digests. The canonical face points are `mediapipe-canonical-face-model-a908d66` (the `canonical_face_mesh` digest): vision reports no version for them, so the id names the commit.
19. **Compatibility.** The selfie job keeps the Phase 2 snake_case threshold keys (`min_blur_score`, `min_brightness`, `max_brightness`) in `selfie_image_quality_detection`'s metadata when the template sets them; the v2 evaluators also record the kebab-case thresholds and their basis in provenance.
20. **Paths outside the listed ones**, needed for C42.7 and the C42.4 measurement: the `face-index:rebuild` and `face-scan:benchmark` scripts in `apps/api/package.json`, one export line in `packages/db/src/repositories/index.ts`, and the six provider variables in `.env.example` and `infra/docker-compose.yml`.

## Workflow 4A Stage 4 amendments (integration)

Recorded by `integration`; `docs/tdd/phase4-integration.tdd.md` has the evidence.

### Workflow 4A Stage 4

1. **The C45.3 specs.** The Stage 1 exclusion is gone (`e2e/src/exclusions.ts` deleted; `e2e/src/playwright-config.test.ts` asserts the config ignores no spec and runs one worker). The helpers drive the C40 protocol through the flow's accessible names: `takeSelfie(page, { shutter })` presses "Start the camera" and follows each announced prompt (`selfie-announcement`, "Photo N of M: <title>"); with `shutter: 'auto'` (the default) it never presses the shutter, so every photo must come from the guidance's auto-capture, and with `'manual-when-offered'` it presses the shutter once offered. `uploadSelfie(page, fileFor)` uses the sandbox upload fallback for every prompted pose in the server's order. The specs:
   - `verification-completes`: person A's head-turn clip, three auto-captured photos (the centre first); every required check passed; liveness `components {passive: passed, active: passed, integrity: not_executed}` with `test-capture-device: true` and the `file-path-label` and `webdriver` flags; the C40.10 attributes; the capture resource `processed` with three prompt timings; `selfie.created`, `selfie.submitted` and `selfie.processed` delivered; five images in the dashboard;
   - `verification-fails`: person B's clip, auto-captured; `face_mismatch`, every other required selfie check passed;
   - `reload-between-uploads`: besides K001, a reload after the first pose was uploaded; the flow creates a new capture, which supersedes the first (`errored`/`superseded`), and the selfie ends with three files;
   - `government-id-review`: the new clip;
   - `ui-flow-links`: three stills through the upload fallback; the selfie and the inquiry end in `needs_review`, liveness `not_applicable`/`capture_not_live`, every other required selfie check passed;
   - new `selfie-static-replay`: the static-replay clip, the side poses taken with the offered shutter; the selfie fails on `selfie_pose_detection` alone, retryable, the flow shows attempt 2 of 3 with the side hints, liveness `input_missing` and pose repeat not failed;
   - new `selfie-review`: `selfie_public_figure_detection` required and unbound; the selfie ends in `needs_review` (`provider_not_configured`), the inquiry completed then marked for review;
   - new `selfie-repeat`: two inquiries of different accounts, person A's clip, both ticking the matching consent; the second's `selfie_repeat_detection` fails with `face_seen_on_other_account` (advisory, both complete; the metadata names no other inquiry), and each session's recorded consent lists `optional-text-keys: ["consent.biometric-matching"]`;
   - new `flow-bundle`: the built flow through a whole verification, failing on any `securitypolicyviolation` event, any request outside the flow and API origins, a policy whose `script-src` is not exactly `'self' 'wasm-unsafe-eval'`, or a WASM not served as `application/wasm`.
   The four selfie specs keep what the checks measured (yaw ratios and changes, passive scores, cosines, planarity, ID similarity; scores only) as a Playwright annotation and one log line (`e2e/tests/support/measurements.ts`).
2. **The e2e environment** blanks the six C44 variables too (twelve provider variables in all), whatever the shell exports.
3. **`turbo.json`:** `@openverify/e2e#e2e` depends on `^build` and `@openverify/flow#e2e`, so the mocked flow suite runs first and the two never run at once (C45.3); `e2e/src/suite-order.test.ts` pins it.
4. **C41.5 in CI:** the vision job runs `uv run python tools/benchmark_selfie.py | tee -a "$GITHUB_STEP_SUMMARY"` after pytest, `shell: bash`, without `--enforce`; `infra/tests/ci-workflow.test.sh` checks it like the C32.4 step.
5. **The virtual-camera docs test** lives beside the data, `packages/checks/src/selfie/virtual-cameras-docs.test.ts`; `docs/checks/selfie.md` holds the copy between `<!-- virtual-cameras:start -->` and `<!-- virtual-cameras:end -->`, one table row per entry (label and match kind in backticks, then the source verbatim).
6. **Integration defects fixed test-first, outside `integration`'s own paths:**
   - the dashboard inquiry page crashed (a `TypeError` in the server render) on any inquiry whose selfie had a capture, because it took every included resource but files for a verification; it now takes `verification/*` resources only (`apps/dashboard/src/components/lifecycle/inquiry-view.tsx`);
   - C40.1: the `filter[inquiry-id]` timeline query gathers the inquiry's selfie capture ids too, through `selfie_captures_environment_id_inquiry_id_idx` (`packages/db/src/repositories/events.ts`; the C25.7 query-plan test seeds captures and states its own 180 s timeout, its seeding having outlasted 30 s under load);
   - C41.1: the golden `analyze-selfie.json` left pose turns to the user's left (`yaw_ratio` +0.118, `yaw_deg` 18.9; `tools/make_contract_fixtures.py`);
   - C48: `createVitestConfig` sets `fsModuleCache: false` (`TEST_FS_MODULE_CACHE`, `packages/config`), so an `import.meta.glob` sees a file added after the cache was warm; a scratch reproduction showed the stale glob and the cost is within noise (the flow suite 25.2 s against 23.9 s);
   - C48: `.dockerignore` re-includes `models/manifest.json`, which the flow guidance plugin checks YuNet against; without it `docker build -f infra/docker/apps.Dockerfile .` failed. `infra/tests/apps-image-context.test.sh` evaluates `.dockerignore` for every `models/` file the build reads;
   - two flow unit tests that failed only in the workspace-wide `pnpm test` under load now wait deterministically (the manual shutter on a frozen clock; the screen heading with a wait bounded by the test timeout), each still failing on its mutant.
7. **Validation note.** `infra/tests/compose.test.sh` was run with its live checks (191): they create the `openverify` project's containers on the developer's existing volumes and remove only those containers.
8. **Measured here:** C41.5 median 0.39 s (0.38-0.43) at 1,280 px on the Xeon E5-1650 v3, idle; C42.4 50,000 sealed templates scanned in a median of 2.49 s and 2.40 s over 10 runs each on an idle machine (2 to 4 runs in 10 at 5.1-5.7 s, unaffected by a `VACUUM`).
9. **Not done here (follow-ups):** golden 409 problem fixtures per C40 code (they need Android's `ContractFixturesTest` to change with them); `runInquiryExpiry` has no storage dependency, so the objects of the capture files it deletes stay in storage, crypto-shredded; `THIRD_PARTY_LICENSES.md` could name `apps/flow/licenses/onnxruntime-web/` as the source of the notices the flow serves; Android has run the protocol only against `FakeFlowApi` and MockWebServer, not the real routes; the clips and auto-capture are proven locally and still need a GitHub CI run.

## Workflow 4B Stage 1 amendments

Reported by the two Workflow 4B Stage 1 agents in their `contractDeviations` and recorded by the TypeScript fixer of the Workflow 4B review. The evidence is in `docs/tdd/phase4-surfaces-dashboard.tdd.md` and `docs/tdd/phase4-calibration.tdd.md`.

### Workflow 4B Stage 1 (surfaces-dashboard)

1. **C47, the government ID portrait.** No portrait crop is stored: K101 finds the portrait inside the stored ID front. The console therefore shows the front of the government ID verification that `selfie_id_comparison` compared, identified by its `metadata.id_verification_id` (only when that is a `ver_` id), labelled "Government ID front, whose portrait was compared".
2. **C47, the ID photo on the card.** On the verification page the ID front is shown beside the centre photo. On the inquiry page's selfie card it sits beside the centre photo inside a closed disclosure ("Show the government ID photo"). The reasons:
   - the government ID card on the same page already shows that image;
   - a second copy would fetch and decrypt it again and write another `file.viewed` audit entry;
   - `verification-completes.spec.ts` counts five visible images on that page.

   The comparison numbers are always visible.
3. **C39.3 basis wording.** A threshold key with a recorded basis reads "Calibrated" or "Provisional". A key without one reads "Set by the template" when the result has a `threshold-basis` map. The evaluator leaves the map out when it would be empty, so a selfie result at the registry's current implementation version with no map also reads "Set by the template". Any other result without a map (an older selfie row, a government ID check) reads "Basis not recorded" on the selfie surfaces and gets no annotation in the provenance disclosure, so nothing is claimed for it. A worker `faceMatchThreshold` that differs from `FACE_MATCH_DEFAULTS` also leaves no basis and therefore reads "Set by the template". Every check's provenance disclosure also gains this annotation.
4. **C47, the flag words test.** The console does not depend on `@openverify/checks` (team rule 3: no new dependency). Its test reads the following as source text:
   - from `packages/checks/src/selfie/selfie-liveness-detection.ts`: `INTEGRITY_FLAGS`, `LivenessComponentStatus`, `LivenessComponents`, and the `test-capture-device` and `order-followed` metadata keys;
   - from `capture-signals.ts`: `CAPTURE_TIMING_FLAGS`.
5. **C47, pose labels.** The console keeps its existing US-English labels "Center", "Left" and "Right" (`FILE_KIND_LABELS`), and its alt texts stay "Selfie, center" and so on.
6. **C40.1, the verification page's captures.** The page reads `GET /verifications/:id?include=selfies`: the designed include, which needs only `verifications:read`, a permission the page already requires. The consumed capture (the one with a `submitted-at`) supplies the prompt timings, and the verification's captures are listed newest first. Without `inquiries:read` the file kinds are unknown, so each prompted pose reads "Hidden" (never "No photo") and the file ids are listed apart.
7. **C47, the inquiry page's captures.** The "Selfie captures" section appears only when the inquiry has captures. Its table is captioned "Inquiry selfie captures", so no two regions share a name. Without `verifications:read` the section counts the captures and names the permission. Each capture's "Outcome" says what became of it: processed ("Used for the checks"), submitted, open, or the error code in words with what happened.
8. **C47, recorded consent.** The consent is a "Consent" column of the sessions table (accepted-at, locale, required text keys, optional text keys ticked), so each session id stays one row header. It reads "Not given yet" before consent and "Not reported" when an older server sends no `consent`.
9. **C47, selfie events.** The four `selfie.*` events have words on the inquiry timeline ("Selfie capture errored (Superseded)" and so on, linked to the capture's verification with `verifications:read`), under the name on the events list, and under the title on the event page. Other events keep their names as before, and the webhook event picker is unchanged.
10. **C47, face settings.** The two fields are whole numbers within `FACE_TEMPLATE_RETENTION_DAYS` and `FACE_SEARCH_MAX_TEMPLATES`. An empty or out-of-range value is a field error such as "Enter a whole number of days from 1 to 1,095." (or "of templates from 1,000 to 200,000"), and the API is not called. Only changed values are sent. The read-only view says "Not reported" when an older server omits them.
11. **Changed test (the plan changes the behaviour it checked).** In `apps/dashboard/src/app/settings/actions.test.ts`, "never sends the face template settings, which this form does not edit (C42.6)" becomes "sends the face template settings only when they changed (C42.6, C47)". The test's `form()` helper now posts both face fields at their defaults, as the form does.
12. **C47 e2e.** `ui-selfie.spec.ts` leaves the optional matching consent unticked. It therefore stores no face template of person A that `selfie-repeat`'s first 1:N scan could find, whatever the spec order. It asserts the required keys and "None ticked"; unit tests cover the rendering of a ticked optional key. The spec was written after the unit slices were green and has no RED run; unit tests cover every assertion it makes RED-first.

### Workflow 4B Stage 1 (calibration)

1. **C49.1 harvest.** A new mode, `scripts/fetch_fixtures.py --harvest-calibration`, builds `fixtures/calibration-manifest.json`. Its metadata-only rules were fixed before any score:
   - **Sources:** the Commons categories "Official portrait photographs of NASA", "... of the United States Department of State" and "... of the United States Armed Forces", three subcategory levels down.
   - **Licence:** a PD-USGov-NASA, -DOS or -Military* template. DOD-only, State-only and Air Force-only tags are not accepted. A file is left out when it carries Personality rights, PD-USGov-Congress*, Cc-*, GFDL* or a deletion tag.
   - **Format:** JPEG originals only ("prefer JPEG" read as JPEG only; 258 non-JPEG files left out), at most 40,000,000 bytes.
   - **Titles:** none announcing crop, crew, group, poster, "class of", collage, montage or team, and none containing "and" or "&".
   - **Categories:** none announcing several people, or naming two people.
   - **Identity:** exactly one Wikidata human, from depicts (P180) and per-person categories, all agreeing. A per-person category is one whose own item is a human (or a category item with a single human P301), or a "<Name> in|by ..." or "(Official) portraits of <Name>" child of such a category, up to four levels up.
   - **Duplicates:** one copy per Commons SHA-1, the earliest page kept.
   - **Per person:** at most 5 photos, spread evenly over the sorted years (a cap the plan did not set); only people with at least 2 photos.
   - **Pseudonym order:** a seeded shuffle (49). Sex: P21 female or male, else unknown. Year: the single year of DateTimeOriginal (a decade is not a year), else the P571 inception.
   - **Pool:** 707 identities, above the ~450 target.
2. **C49.1 etiquette added to the plan's:**
   - every API request carries `maxlag=5`; a maxlag refusal holds every request back max(5 s, reported lag) and is retried up to 5 times;
   - downloads hold the next request back received_bits / 25 Mbps;
   - title batches keep each URL at or below 7,000 characters. A live run got HTTP 414; a probe found 7,988 characters accepted and 8,888 refused.

   The final harvest ran `harvest_calibration` through a scratch driver that reused the same day's cached API answers, so each distinct API request reached Wikimedia once. Downloads were live, through `PoliteOpener`.
3. **C49.1 review.**
   - The first tails review, on the first harvest, found systematic identity-grouping errors in the harvest rules:
     - an administration-personnel category read as naming the president;
     - group photos with a one-person depicts;
     - two-person portraits whose second person's category sat three levels below;
     - a title naming three people.
   - The rules were tightened test-first and the set re-harvested before the final measurement. The first-pass scores were used for nothing (no FAR or FRR computed on them).
   - The second review, on the final set, covered the 30 lowest genuine and 30 highest impostor pairs (counts fixed in advance), shuffled with seed 49 and shown without scores. Of its 107 images, 106 are pinned `{decision: keep}` and 1 `{decision: exclude, reason: misattribution}`.
   - A pair of identical twins stays as two identities (a hard, correct impostor pair).
4. **The C49 measurement schema** (`contracts/fixtures/calibration/selfie-calibration.schema.json` and the zod schema in `selfie-report.ts`) gains two optional sections; `schema_version` stays 1 and old documents stay valid:
   - `review`: `{excluded_images, genuine_pairs_before[]}`;
   - `genuine_cues`: `{portraits, re_encodings}` (cue to number[]).
5. **`calibrate_selfie.py`:**
   - Images the review excludes are now decoded and measured too, so the selection can run twice: with the review (the main pairs) and without it (the before-review genuine pairs). The near-duplicate rule and the impostor construction are unchanged.
   - `--skip-provisional` also skips the genuine cues. New arguments: `--faces-manifest` (default `fixtures/manifest.json`) and `--faces`.
   - Genuine cues: each kept portrait is analysed as a centre pose through `/v1/analyze/selfie`. An original at most 2,000 px long is sent as it is; a larger one is scaled (INTER_AREA, explicit dsize) and re-encoded as Pillow JPEG q95. The covering score counts only with `forehead_valid` true.
   - The 45 re-encodings reproduce vision-integrity's 4A stability set: Pillow draft decode; 1,280, 960 and 640 px; q95, q85, q75, 0.83 then q85, and q75 then q90.
   - `skin_ita` returns None when the cheeks' median a\*b\* chroma is below 3 (a black-and-white photo).
6. **C49.2 report (selfie mode).** It now gives:
   - FRR before and after the review at the FAR 1e-3 point threshold and at the shared default, with fixed thresholds, both bootstrapped over the union of identities with the same seed;
   - the operating point's own threshold interval (`thresholdInterval`);
   - a C49.3 section stating where the default lies against that interval, plus the 1:N floor sentence;
   - SFace's published 0.363 as its own FAR/FRR row (basis "upstream"): last in the threshold table, outside the 1:N table, and the C48 thin-margin row;
   - the genuine-cue tables with p1/p99, labelled "studio portraits, scaled to a 2,000-px long side: a false-positive proxy, not a selfie measurement";
   - each `SYNTHETIC_SIGNALS` scale against the genuine tail: the p99, or the maximum under 100 values; the p1 or the minimum for a cue that is suspicious when small.

   Changed existing test: `selfie-report.test.ts`'s row list gains the SFace row (4 rows instead of 3). The "FAR 1e-4" row is resolvable at this size (upper bound 1.73e-4 < 3e-4).
7. **C49.3 default.** The decision rule was fixed before any score was seen:
   - the shared threshold moves only when 0.363 lies outside the 95% interval of the FAR 1e-3 threshold;
   - above the interval it stays, because no margin covers the selfie-against-ID domain;
   - below the interval it moves to the interval's upper end, rounded up to three decimals.

   The data: 0.363 lay below 0.3796-0.3937, at FAR 2.40e-3. So `FACE_MATCH_DEFAULTS = {threshold: 0.394, basis: 'calibrated', source: the report}`. What follows from it:
   - the `selfie_repeat_detection` schema floor (min = `FACE_MATCH_DEFAULTS.threshold`) becomes 0.394, at or above the 1:1 FAR 1e-3 value 0.3862. That meets "the repeat floor is the 1:1 value at FAR 1e-3". The repeat default stays 0.5, provisional and gallery-size dependent;
   - `FACE_SCAN_FLOOR` follows 0.394;
   - results of the ID, account and background checks now record threshold-basis "calibrated" for the face threshold.

   Tests outside the calibration agent's paths changed to the new default or basis:
   - `packages/core`: `selfie-check-config.test.ts` (the repeat range row 0.394-0.95 and the default test); `check-config.test.ts` (`id_selfie_comparison` 0.394);
   - `packages/checks`: `face-match.test.ts` (twice); `government-id/history.test.ts` (twice); `selfie/selfie-id-comparison.test.ts` (basis calibrated); `selfie/selfie-similar-background-detection.test.ts` (face-threshold basis calibrated);
   - `apps/api`: `jobs/selfie-contract.test.ts` ("is 0.394 today, in one place"); `jobs/process-verification.test.ts` (threshold 0.394, twice);
   - `services/vision/tests`: `test_calibrate_selfie_real.py` and `test_selfie_fixtures_real.py` (`FACE_MATCH_THRESHOLD = 0.394`; their docstrings mirror `FACE_MATCH_DEFAULTS`).

   Left at 0.363 on purpose, because each is a recorded example or an explicit argument, not the default:
   - the contract fixtures `contracts/fixtures/api/verification-selfie.json` and `inquiry-with-verifications.json` (sample metadata);
   - tests: `packages/contracts` `verifications.test.ts` and `selfie-verification-attributes.test.ts`; `packages/core` `check-result.test.ts`; `packages/checks` `phase1/selfie-checks.test.ts` (`faceMatchConfidence` arguments); `apps/api` `face-search.test.ts` (an explicit floor argument) and `routes/server/selfies.test.ts`;
   - the dashboard tests;
   - vision `test_real_faces.py` and `test_contract_fixtures.py`, which name OpenCV Zoo's published threshold.
8. **`SYNTHETIC_SIGNALS`** (4A vision-integrity open item 5).
   - **Rule:** a clear level below the genuine 99th percentile of the portraits and the 45 re-encodings together flags genuine photos (for `canonical_landmark_distance`, above the 1st). It moves to that percentile rounded outward to 2 decimals, the suspicious level becomes clear plus the original ramp width, and the weight is unchanged.
   - `spectral_tail_deviation`: 0.25/1 to 3.71/4.46 (p99 3.7036).
   - `noise_inconsistency`: 0.25/0.75 to 0.69/1.19 (p99 0.6889). Its scale ends at 1, so this cue alone can no longer reach a 0.5 score.
   - `jpeg_grid_misalignment`: 0.25/1 to 0.27/1.02 (p99 0.2638).
   - `residual_peak_ratio`: unchanged (p99 1.9774 < clear 2). `canonical_landmark_distance`: unchanged (p1 0.22 > clear 0.05).
   - Every basis stays provisional and carries "genuine-only distribution; detection rate unmeasured".
   - Changed existing tests in `synthetic-score.test.ts`: two inputs move to the new noise scale (0.75 to 1, score 0.434; 0.5 to 0.94, score 0.35).
9. **Docs.**
   - New `docs/calibration/selfie-phase4-method.md`, written by hand: the harvest rules and counts, both reviews, privacy, and the set's limits. It names no one.
   - `docs/checks/selfie.md`: the intro now says every threshold is provisional except the face match.
   - `docs/checks/government-id.md`: only the `id_selfie_comparison` threshold sentence changed.

## Workflow 4B review amendments

Recorded by the TypeScript fixer of the Workflow 4B review; `docs/tdd/phase4-review-fixes.tdd.md` has the evidence. The Python and Android fixers' amendments follow in their own subsections.

### Workflow 4B review (TypeScript fixer)

1. **H001, no query parameter in an error that is kept.** A failed query's Drizzle message holds every parameter (`Failed query: … params: …`), and BullMQ keeps a failed job's message and stack in Valkey for a week. The fix:
   - **Repository.** The three background-layout queries (`findNearestSelfieBackgrounds`, `createSelfieBackground`, `rewriteSelfieBackground`) run through `withSensitiveParameters`, `packages/db`. A failure becomes a `SensitiveQueryError`, whose message is `<operation> failed (SQLSTATE <code>)`, with `code` and no cause. `pgErrorCode` reads its SQLSTATE.
   - **Worker.** `apps/api/src/jobs/error-description.ts` describes a job failure by its class and code, never its message (`describeJobError`). Only classes whose messages are built from codes, endpoints and statuses keep their message: `UnrecoverableError`, `PermanentJobError`, `VisionError`, `SensitiveQueryError` and `DescribedJobError`.
   - Every processor `startWorkers` registers (`process-verification`, `webhook-delivery`, the repeatable jobs) rethrows any other failure as a `DescribedJobError`: the same name, the description, and the original stack frames only when the stack starts with `<name>: <message>`. BullMQ still retries it, and permanent failures stay `UnrecoverableError`. The `failed` listener logs `detail: describeJobError(error)`.
   - **Command.** `face-index:rebuild` prints a usage or configuration message whole and anything else through `describeJobError` (`describeFaceIndexRebuildFailure`).
   - **Changed test:** "logs failed jobs and worker errors with ids only" now expects `detail: 'Error'` for `new Error('lost')`, and its first failure is a `VisionUnavailableError`, whose message is kept.
2. **K201, the inquiry expiry job deletes the objects of the capture files it deletes.** This settles the follow-up of 4A Stage 3 (api-flow) 10 and Stage 4 amendment 9.
   - `InquiryExpiryDeps.storage` is required, and the worker passes its storage.
   - After each inquiry batch commits and its events are dispatched, the `storageKeys` of the inquiries it expired are deleted, best effort. `deleteObjects` now returns how many it could not delete. A run with any logs one warning with `undeletedObjects`, a count only.
3. **K202, golden 409 problems per selfie capture code.** This settles the follow-up of 4A Stage 3 (api-flow) 15 and Stage 4 amendment 9.
   - `contracts/fixtures/problems/selfie-capture-{invalid,required,incomplete,limit}.json` hold the bodies the flow API answers: `about:blank`, `Conflict`, 409, the C40 `code` and no `reason`. Their `instance` names the fixtures' selfie verification. The `required` file is the submit's variant.
   - An API route test (`apps/api/src/routes/flow/selfie-golden-problems.test.ts`) compares each real answer to its file, `instance` and `requestId` aside.
   - `packages/contracts` pins `problems/` to the three `session_canceled` files plus one per `SELFIE_CAPTURE_PROBLEM_CODES` entry.
   - The flow reads them through `GOLDEN_PROBLEMS`: a selfie 409 is left to the step, and `captureFailure` maps `invalid` and `incomplete` to a new capture, `limit` to a new attempt, and `required` to a conflict.
   - Android's `ContractFixturesTest` lists both kinds and checks each selfie problem's branch through `SelfieCaptureProtocol`.
   - **Changed tests:** the `problems/` listing in `packages/contracts`, the flow's outcome map in `final-outcome.test.ts`, and Android's problem-listing test, whose single `problems/` factory is split in two.
4. **K203, one C43 replay lookup.** This amends 4A Stage 3 (api-worker) 11.
   - `findReplayedDigests(db, environmentId, { sha256s, excludeCaptureId })` in `packages/db` is the worker's query, moved there unchanged. It returns the distinct digests found, sorted: any file of the environment outside the capture, with or without a capture, in any inquiry, but not a deleted object or a file of a redacted inquiry.
   - The worker calls it. Stage 1's `findReplayedFiles` and `ReplayedFile` are deleted.
5. **H002.** A test only: the C49 bootstrap's identity resampling is pinned by a clustered-impostor fixture that a pair resample fails. No contract change.
6. **H003, C49.2 report.** The genuine-cue section gains one paragraph under the portrait table, from `passiveRejectionLine`. It gives the default `min-passive-score`, `passive_liveness_low` with no retry, the passive mean's p1 and p5, and a bound on how many genuine portraits score below the default (a count implied by the listed percentiles), with the proxy caveat.
   - `docs/calibration/selfie-phase4.md` carries that paragraph for the published row: at least 88 of 1,743 (5.05%). It was rendered from the report's own numbers, because regenerating would read the measurements.
   - `docs/checks/selfie.md` states the same in "Known limits" and in the liveness check's limits.
   - Whether a first-attempt passive failure should keep a retry is left to the owner, because it changes C30.1.
7. **H013, C46.1 camera.** A selfie camera whose video track ends or is muted, or is already ended at grant, is released and reads `failed` with `camera-in-use`. The step shows its camera error and "Try again", which restarts the camera and continues the same capture. The guidance runs only while the camera is `live`, and the shutter takes no frame otherwise. `visibilitychange` is not handled: a hidden desktop tab keeps a live camera, and a backgrounded phone mutes or ends the track.
8. **Not changed:** the retention job's processor and the other operator commands. They take ids, dates and settings, not biometric parameters, and the retention `failed` listener already logs the class only.

### Workflow 4B review (Python fixer)

Recorded by the orchestrator from the Python fixer's report; `docs/tdd/phase4-review-fixes-python.tdd.md` has the evidence.

1. **H010, C49.1 etiquette.** Every download, harvested or pinned (`--calibration` and the default test faces), counts its bytes from the moment its response opens against one 25 Mbps budget shared by all threads. The budget adds up over downloads in flight together (not a maximum of deadlines), and no request starts before it is paid.
2. **No locked contract changed** by H007, H008 or H009: the selfie route's responses are byte-identical on 110 real-model cases, client errors still win over a 503, no status code was added, and the golden vision fixtures are byte-identical.

### Workflow 4B review (Android fixer)

Recorded by the orchestrator from the Android fixer's report; `docs/tdd/phase4-review-fixes-android.tdd.md` has the evidence.

1. **H014, C46.2.** The Android selfie step creates its verification and capture only once the camera can be shown. The first selfie start of a flow shows `FlowState.AwaitingCamera` behind the camera permission, and the screen calls `cameraReady()` once the permission is granted. Later captures in the flow (restarts after a 409, an expiry or the cap, and new attempts) start at once. C40.3 ("create the capture before the first prompt") still holds, and this matches the web flow, which creates both after the camera's first frame.
2. **H015 (partial), C46.2 strings.** Each Android selfie prompt states the capture lifetime in whole minutes (the TTL rounded down: 3 minutes) and that the photos start again when it runs out, in English and Spanish.
3. **Open (owner decision, carried into Phase 5): WCAG 2.2.1 and the 180 s capture limit.** Meeting 2.2.1 needs either an extend route or restarts that do not count toward the cap of 10, plus a warning at least 20 s ahead, in both clients. A new capture supersedes the old one and deletes its photos, so neither client can extend a capture on its own. The web flow has no warning yet.
