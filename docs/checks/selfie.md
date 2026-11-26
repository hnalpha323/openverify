# Selfie checks

This page describes the 15 selfie checks of `docs/PLAN.md` §4.2 as Phase 4 ships them: how a selfie is captured, what each check decides, from which evidence, with which reasons and settings, and where it stops. The binding contracts are C39–C49 of `docs/plans/phase-4.plan.md`; the tiers and the honesty rules are ADR 0002.

**Every threshold on this page is provisional but the shared face-match threshold.** Each provisional default has a stated basis (an upstream model's own decision point, a published measurement, or the C40.11 measurement on re-posed public-domain faces), and none was fitted to OpenVerify's fixtures. The face-match threshold is `calibrated` by the Workflow 4B report (`docs/calibration/selfie-phase4.md`, C49) on studio portrait pairs, which are not selfies against ID card photos. Every selfie check is `beta`.

## Contents

- [How a selfie is captured and checked](#how-a-selfie-is-captured-and-checked)
- [Reading a check result](#reading-a-check-result)
- [Decisions, retries and review](#decisions-retries-and-review)
- [The default template](#the-default-template)
- [The checks](#the-checks)
- [Provisional defaults](#provisional-defaults)
- [Face templates and the background index](#face-templates-and-the-background-index)
- [On-device guidance on Android](#on-device-guidance-on-android)
- [What the capture protocol does not stop](#what-the-capture-protocol-does-not-stop)
- [The virtual-camera list](#the-virtual-camera-list)
- [The sandbox test-capture rule](#the-sandbox-test-capture-rule)
- [Users who cannot turn their head](#users-who-cannot-turn-their-head)
- [Clients built before Phase 4](#clients-built-before-phase-4)
- [Pipeline observations on the synthetic fixtures](#pipeline-observations-on-the-synthetic-fixtures)
- [The honesty rules as they apply](#the-honesty-rules-as-they-apply)
- [Known limits](#known-limits)

## How a selfie is captured and checked

1. **The capture (C40).** Every camera selfie is a server-issued *selfie capture* (`type: selfie`, ids `self_…`):
   - the client creates (or reuses) the selfie verification and creates a capture with `POST /api/v1/flow/verifications/:id/selfies`, `{ "method": "camera" }`, before the first prompt. The answer carries the prompts, a nonce (128 random bits, returned once and stored only as its SHA-256), the expiry (`SELFIE_CAPTURE_TTL_SECONDS`, 180 s) and the guidance constants;
   - the prompts start with `center`. With `liveness: active` the step's side poses follow in an order drawn with a CSPRNG; with `passive`, in the step's order;
   - each pose is uploaded **as soon as it is taken**, before the next prompt, with the multipart fields `capture-id`, `nonce` and `client-elapsed-ms`; the server stamps `received_at`;
   - submit (`{ "capture": { "id", "nonce", "device"? } }`) consumes the capture once, together with the verification's move to `submitted`. A capture is refused (409 `selfie_capture_invalid`, one body for a wrong nonce, a foreign, superseded, consumed or expired capture) and the client starts a new one;
   - a new capture supersedes the open one and deletes its files; at most 10 captures per verification, and the 11th create cancels the verification (409 `selfie_capture_limit`), which counts as a failed attempt;
   - the events are `selfie.created`, `selfie.submitted`, then after the decision `selfie.processed` (or `selfie.errored` with `superseded`, `expired`, `canceled` or `processing_failed`). A capture is readable at `GET /api/v1/selfies/:id` and with `?include=selfies`; it never carries the nonce or device data.
2. **The clients (C46).**
   - The web flow runs the pinned YuNet face detector in the browser (onnxruntime-web, single-threaded WebAssembly, served from the flow's own origin with its SHA-256 checked) at about 8 Hz on a 320-pixel preview. It takes each photo **automatically** once the prompted pose is held for 500 ms: the centre once `|yaw_ratio|` ≤ 0.8 × `max-center-yaw-ratio`, a side once the yaw ratio changed from the user's own centre frame by at least 1.25 × `min-side-yaw-ratio-change` (C40.11). After 10 s, or at once when the model cannot load, it offers a manual shutter. The guidance decides nothing: the server measures every photo again.
   - Android follows the same protocol. Since Phase 10 it runs the same guidance on the device when the host app installs a face detector, else it keeps the manual shutter ([on-device guidance on Android](#on-device-guidance-on-android)).
   - In a sandbox environment both clients can upload photos instead (`method: upload`, refused with 403 in production). An upload is never a live capture.
3. **Vision measures (C41).** `POST /v1/analyze/selfie` analyses every pose and returns measurements only: faces with their five landmarks, the face region's quality, the head pose, passive liveness (the MiniFASNet V2 and V1SE ensemble, upstream preprocessing reimplemented exactly), covering and glasses scores, synthetic-face cues, the centre's background layout, and, for each side pose, its consistency with the centre (the SFace cosine, the planarity of tracked face points, SSIM, duplicates). ONNX Runtime telemetry is off (C41.4). Vision never logs images, landmarks, embeddings or background vectors.
4. **The checks decide (C43).** Each enabled check runs a pure evaluator in `packages/checks/src/selfie/` with the template's thresholds, else the defaults below, and records them and their basis in `provenance`. The worker adds the capture context, the history lookups (with matching consent) and the providers.
5. **Face data (C42).** A passed selfie with matching consent leaves a sealed face template and a background row behind, which later selfies are compared with.

## Reading a check result

Each check of a `verification/selfie` resource has the fields of a government ID check (see [Reading a check result](government-id.md#reading-a-check-result)), and:

- **`stage`** is `beta` for every selfie check: all of them are model-based or heuristic.
- **`confidence`** is a number in [0, 1] on the H-tier checks (covering, glasses, suspicious entity) and on `selfie_liveness_detection`; liveness's `passed` confidence is capped at **0.6** until a real presentation-attack evaluation exists, and the heuristic suspicious-entity confidence at **0.5**.
- **`provenance`** names the models with their SHA-256 (YuNet, SFace, both MiniFASNet models; the pose results also name the MediaPipe canonical face points they solve against), the provider, every threshold, and **`threshold-basis`**: for each threshold that is a default, `calibrated` or `provisional`. A key the template sets has no basis.
- **`metadata`** holds scores, counts, ratios, flags, pose names and field names only. It never holds an embedding, a landmark set, a face crop, a device label, a background vector or another inquiry's id. The one exception is the centre face box normalised to [0, 1] (`face-box` of `selfie_image_quality_detection`).

**The selfie verification's own attributes (C40.10)**, each nullable and derived at read time, so redaction nulls them: `capture-method`, `liveness`, `poses`, `document-similarity-score` (the centre face against the ID portrait), `selfie-similarity-score-left` and `-right` (each side face against the centre), `liveness-score` (the centre's passive mean P(real)), and `center-photo-face-coordinates` (four corners in [0, 1]). The flow API never shows them.

**Shared reasons.** Every selfie check may also answer with the shared reasons of C29.4 (`input_missing`, `no_reference_data`, `execution_error`, `provider_not_configured`, `not_requested`, `image_unreadable`; see the government ID page), and with one more:

| Reason | Status | Blocks a required check? | Meaning |
|---|---|---|---|
| `not_consented` | `not_applicable` | yes (review) | The check needs the optional matching consent, which the user did not give (C42.3) |

## Decisions, retries and review

The C30 decision rules of the government ID page apply unchanged: only enabled, required checks decide; a `failed` verification is retryable when every failing required check is a `user_behavior` check; a required check without evidence sends the verification to review, which counts as done for the user.

**The cascade (C43).** One user mistake fails one user-behaviour check, so the user keeps their retry:

- `selfie_pose_detection` alone judges whether each pose was taken as prompted, and `selfie_image_quality_detection` whether each pose is usable;
- `selfie_liveness_detection` and `selfie_pose_repeat_detection` judge only the side poses whose pose and face-region quality passed. When the centre fails image quality, the passive component is not executed and liveness answers `not_applicable`/`input_missing`;
- liveness never fails on turn size, order, timing or image quality.

So a user who turned too little gets `failed`, retryable, with the hint `pose_not_left` or `pose_not_right`, and a user in a dark room gets `image_too_dark`; in both cases liveness and pose repeat do not fail. Contract tests pin both cases, and the e2e static-replay spec shows the first one in the browser.

**The user-behaviour reasons** (`face_not_present`, `image_blurry`, `image_too_dark`, `image_too_bright`, `face_too_small`, `resolution_too_low`, `face_glare`, `pose_not_center`, `pose_not_left`, `pose_not_right`, `face_covered`, `glasses_detected`) have retry strings in English and Spanish in both clients. Pose hints name the failing pose; that helps the user and also tells an attacker which pose failed, which `maxAttempts` bounds (decision 20).

## The default template

The seeded default template (C45.1, `DEFAULT_SELFIE_CHECKS` in `packages/contracts/src/inquiry-templates.ts`) asks for `poses: ["center", "left", "right"]` with `liveness: "active"`, and offers the matching consent as an optional text (`optionalTextKeys: ["consent.biometric-matching"]`):

| Group | Checks | Default |
|---|---|---|
| Required | image quality, pose, multiple faces, liveness, `selfie_id_comparison` | required |
| Advisory | glare, pose repeat, account comparison, repeat, similar background, covering, glasses, suspicious entity | enabled, not required |
| Adapters | age comparison, public figure | disabled |

- **Pose repeat, glare and covering are advisory** until real captures calibrate them (decision 13).
- **The account, repeat and background checks need the matching consent**, so they answer `not_consented` for users who leave it unticked. Publishing a template version that *requires* one of them fails (422, a JSON Pointer to the check) unless `consent.biometric-matching` is a required consent key.
- **The background check is advisory only**; do not require it (its registry description says so).
- Every change to the seeded template is published as a new template version, so existing inquiries keep theirs.

## The checks

Each entry gives the tier, type, stage, inputs and implementation version, what decides the check, its reasons (besides the shared ones), its settings with their defaults, and its limits. The defaults' bases are in [Provisional defaults](#provisional-defaults).

### Capture and image

#### `selfie_image_quality_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| R, model-based | user behaviour | beta | upload, vision | 2 | required |

On **every** prompted pose, a face is present (`face_not_present`, the pose named in metadata) and the face region is sharp enough (`image_blurry`). On the centre also the Phase 1 whole-image blur and brightness, the face size (`face_too_small`) and the image's short side (`resolution_too_low`).

- **Reasons:** `face_not_present`, `image_blurry`, `image_too_dark`, `image_too_bright`, `face_too_small`, `resolution_too_low`.
- **Settings:** `min-face-blur-score` 1–10,000, default 15 (Laplacian variance of the face scaled down, never up, to at most 112 px wide); `min-face-width-px` 16–1,000, default 64; `min-face-height-ratio` 0.01–1, default 0.2; `min-image-short-side-px` 120–4,000, default 480. The Phase 1 whole-image keys `min-blur-score`, `min-brightness` and `max-brightness` have no default: unset, the vision service's own verdict applies.
- **Limits:** the face is YuNet's primary (largest) face at the service's 0.9 score threshold; a face it does not find is `face_not_present`, whatever the cause.

#### `selfie_glare_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| R, model-based | user behaviour | beta | upload, vision | 1 | advisory |

The saturated share of the centre face region without the eye regions (so eyeglass and catch-light reflections do not count) above `max-face-glare-ratio` fails.

- **Reasons:** `face_glare`. No centre face: `input_missing`.
- **Settings:** `max-face-glare-ratio` 0.001–0.5, default 0.05.

#### `selfie_pose_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| R, model-based | user behaviour | beta | upload, vision | 1 | required |

The centre is frontal (`|yaw_ratio|` ≤ `max-center-yaw-ratio`). Each side pose shows a face whose `yaw_ratio` changed from the centre's by at least `min-side-yaw-ratio-change` in its direction. `yaw_ratio` is the nose's offset from the eye midpoint over the inter-ocular distance, after de-rolling by the eye line (C41.1); a turn to the user's own left raises it in the raw, unmirrored camera image, and a snapshot that says `image-mirrored: true` flips the sign. With `poses: ["center"]` only the centre is judged.

- **Reasons:** `pose_not_center`, `pose_not_left`, `pose_not_right`. A pose without a face fails its pose; without a centre face only `pose_not_center` is reported. `input_missing` for a missing file, or a face whose head pose vision could not measure.
- **Settings:** `max-center-yaw-ratio` 0.01–1, default 0.021; `min-side-yaw-ratio-change` 0.01–2, default 0.077.
- **Limits:** five YuNet landmarks under-read real head turns, and YuNet's frontal reading is itself biased by about ±0.03 per face, more than the centre default: some genuine users whose frontal pose YuNet reads off-centre will meet the manual shutter and may get `pose_not_center` (retryable). The defaults are set no stricter than the web client's capture triggers, and are to be revisited with real captures. Head pitch is not judged: YuNet's coarse pitch reads −8 to −15° on frontal studio portraits.

#### `selfie_multiple_faces_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| R, model-based | fraud | beta | upload, vision | 2 | required |

On any prompted pose, a second face whose box area is at least `min-secondary-face-area-ratio` of the primary face's. Boxes overlapping at an IoU above 0.3 are merged first (one face detected twice); the area floor keeps distant bystanders and posters out.

- **Reasons:** `multiple_faces_present`. A pose without a face passes here (image quality reports it).
- **Settings:** `min-secondary-face-area-ratio` 0–1, default 0.25.
- **Limits:** a second face on a side pose is fraud too, so a bystander there ends the inquiry on the first attempt (decision 21).

### Liveness

#### `selfie_liveness_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| R, model-based | fraud | beta | upload, vision | 1 | required |

Three components, each `passed`, `failed`, `not_requested` or `not_executed`, always in `metadata.components`:

- **Passive:** the centre's MiniFASNet ensemble mean P(real) at or above `min-passive-score`, else `passive_liveness_low`. The side poses' scores are recorded (`passive-scores`), not judged: the models are unvalidated on turned faces (decision 19).
- **Active** (with side prompts): each side pose whose pose and quality passed has an SFace cosine to the centre of at least `min-side-identity-cosine`, else `pose_identity_mismatch`: the same person throughout. The prompt order and the C40 timings are recorded as flags (`order-followed`, `timing-flags`) and only lower the confidence of a pass, by 0.1 per flag (at least half kept), because a scripted client controls them. The timing flags are `timing-missing`, `client-elapsed-missing`, `client-elapsed-not-increasing`, `uploads-batched` (two uploads less than 300 ms apart on the server clock), `client-server-skew` (the client's and the server's intervals more than 5,000 ms apart) and `received-outside-window`; 300 ms and 5,000 ms are provisional.
- **Integrity** (needs the device snapshot and the replay lookup): in production a camera label that is a file path, or `webdriver: true`, fails with `automated_capture`; a pose file whose SHA-256 equals another file of the environment fails with `capture_replayed`. A label on the [virtual-camera list](#the-virtual-camera-list) is a flag that, when nothing failed, answers `not_applicable`/`capture_device_suspicious` (review). Without a snapshot the component is not executed. The replay lookup covers every stored file of the environment outside this capture (ID images and earlier selfies of the same inquiry included), but not files whose objects were deleted nor files of redacted inquiries.

**Outcome.** `failed` when any executed component failed. `not_applicable`/`capture_not_live` without a capture or for an upload. With side prompts, `passed` needs the active component passed on **every** prompted side; a side left unjudged because its pose or quality failed gives `input_missing`, and the failed user-behaviour check outranks it, so the user still gets the retry. `passed` always needs the passive component passed.

**Confidence.** A passive failure or a pass is margin-based on `1 − mean` against `1 − min-passive-score`, scaled by the share of components executed (a sandbox-waived integrity counts as not executed); an identity failure is margin-based on the lowest cosine, times the same share; an integrity failure is 1; a pass is capped at 0.6.

- **Reasons:** `passive_liveness_low`, `pose_identity_mismatch`, `automated_capture`, `capture_replayed`; `not_applicable`: `capture_not_live`, `capture_device_suspicious`.
- **Settings:** `min-passive-score` 0–1, default 0.5; `min-side-identity-cosine` 0–1, default 0.4.
- **Limits:** see [What the capture protocol does not stop](#what-the-capture-protocol-does-not-stop). Without the MiniFASNet model files vision returns no passive measurement, and liveness cannot pass. At the default `min-passive-score`, at least 5% of C49's genuine studio portraits fail the passive component (see [Known limits](#known-limits)); the rate on genuine webcam selfies is unmeasured.

#### `selfie_pose_repeat_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| R, model-based | fraud | beta | upload, vision | 1 | advisory |

A static replay (a held photo or screen, or one still fed through a virtual camera), on the side poses whose pose and quality passed, each against the centre:

- the median homography residual of the tracked face points below `min-planarity-residual` (a share of face width) is planar motion (`planar_motion`). It counts only with at least `min-tracked-points`; fewer are recorded as unmeasured and lower the confidence;
- an SFace cosine to the centre at or above `max-pose-cosine` is the same frame (`pose_frames_identical`);
- vision's duplicate flag (an equal SHA-256 or a raw SSIM of 0.99 or more) is a duplicate frame (`duplicate_frame`).

A centre-only step answers `not_applicable`/`not_requested`. No side judged, a centre that failed image quality, or a judged side with no measurement: `input_missing`.

- **Reasons:** `planar_motion`, `pose_frames_identical`, `duplicate_frame`.
- **Settings:** `min-planarity-residual` 0–0.1, default 0.0045; `min-tracked-points` 4–500, default 20; `max-pose-cosine` 0.5–1, default 0.99.
- **Limits:** planarity was exercised on synthetic re-poses and drawn artefacts only; the live class is unmeasured. Advisory until volunteer captures calibrate it.

### Comparisons

#### `selfie_id_comparison`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| R, model-based | fraud | beta | vision, history | 2 | required |

The centre face against the portrait of the inquiry's latest government ID verification that is `passed`, `submitted` or `needs_review`, by SFace cosine at the shared 1:1 threshold.

- **Reasons:** `face_mismatch` below the threshold. No such ID, or one without a portrait: `not_applicable`/`no_reference_data`, with `metadata.reference` naming what is missing (`government_id` or `portrait`); Phase 1 answered `failed` (decision 5). No centre face: `input_missing`. Metadata keeps `similarity` and the deprecated Phase 1 `confidence` fields.
- **Settings:** `threshold` 0.25–0.6, default 0.394, `calibrated` (`FACE_MATCH_DEFAULTS`, shared by every 1:1 face comparison).
- **The face-match threshold (C49).** The Workflow 4B report measured SFace on 707 identities of public-domain official portraits (1,574 genuine and 249,571 impostor pairs; `docs/calibration/selfie-phase4.md`). On these studio portrait pairs, the threshold for a false-match rate (FAR) of 1e-3 is 0.3862, with a 95% bootstrap interval over identities of 0.3796–0.3937. SFace's published 0.363 lay below that interval: its FAR was 2.40e-3 (1.99e-3–2.87e-3), the thin margin Phase 1 had noticed. So the default moved to the interval's upper end, rounded up, 0.394: FAR 7.57e-4 (5.62e-4–9.87e-4) and false non-match rate (FRR) 0, which cannot be told from the rule-of-three floor of 1.91e-3 at this size.
- **Limits:** these numbers hold for studio portrait pairs only. A selfie against an ID card photo has lower genuine similarities and an unmeasured FRR, and the set skews male (588 of 707) and toward adult official portraits; per-group error rates are unmeasured.

#### `selfie_account_comparison`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| R, model-based | fraud | beta | vision, history | 1 | advisory |

The centre face against the sealed templates of the account's other inquiries (resolved through the inquiry, all of them), by SFace cosine at the shared 1:1 threshold. The best cosine below it fails.

- **Reasons:** `face_mismatch`; `no_reference_data` without an earlier template; `not_consented` without matching consent; `execution_error` when a stored template cannot be opened.
- **Settings:** `threshold` 0.25–0.6, default 0.394 (the calibrated shared threshold; see `selfie_id_comparison`).

#### `selfie_repeat_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| R, model-based | fraud | beta | vision, history | 1 | advisory |

The 1:N scan: the environment's sealed templates of **other** accounts, newest first, up to `face-search-max-templates`. Any template at or above the 1:N threshold fails. Metadata records `searched`, `truncated`, `match-count` and the best cosine, never another inquiry's id. An empty gallery passes: the scan covered every stored template.

- **Reasons:** `face_seen_on_other_account`; `not_consented`; `execution_error`.
- **Settings:** `threshold` 0.394–0.95, default 0.5, `provisional` and gallery-size dependent. Its floor is the shared 1:1 threshold, above the 1:1 threshold for FAR 1e-3 (0.3862, C49.3).
- **Limits:** false matches grow with the gallery size, so the check is advisory by default. On the C49 studio portrait pairs, one search is expected to return 0.004, 0.04 and 0.4 false matches at 0.5 over galleries of 1,000, 10,000 and 100,000 templates (up to 0.02, 0.24 and 2.41), and 0.76, 7.6 and 76 at the 1:1 threshold. Selfie galleries will do worse than studio portraits. A truncated scan (`truncated: true`) did not look at the oldest templates.

#### `selfie_similar_background_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| R, model-based | fraud | beta | vision, history | 1 | advisory only |

A fraud farm's room: the same background behind different faces. The worker finds the 20 nearest background rows within `window-days` (an HNSW search over the 8 × 6 Lab colour layout, other accounts only), skips candidates whose face matches the current one at the 1:1 threshold, and compares up to five through `POST /v1/compare/background` (ORB features and a RANSAC homography on background pixels, the people masked out). A candidate is verified when it meets both ORB limits; at least `min-distinct-faces` distinct verified faces fail the check.

- **Reasons:** `background_seen_with_other_faces`; `not_consented`; `input_missing` when the background layout covers less than `min-coverage`; `execution_error`.
- **Settings:** `min-orb-inliers` 4–5,000, default 100; `min-inlier-ratio` 0–1, default 0.5; `window-days` 1–365, default 30; `min-distinct-faces` 1–50, default 3; `min-coverage` 0–1, default 0.25.
- **Limits:** **advisory only; do not require it.** Shared backdrops are common (studios, kiosks, a family home), virtual backgrounds and blurred backgrounds defeat it, and the person mask is geometric (a head ellipse and a shoulders polygon from the face box), so long hair or raised hands leak into the background.

### Heuristics (H-tier, beta)

#### `selfie_face_covering_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| H, model-based | user behaviour | beta | upload, vision | 2 | advisory |

A mask, scarf or hand over the lower face: the centre's covering score, comparing the lower face with the same person's forehead (skin share, texture ratio, CIE76 colour difference). A score above the threshold fails, with a retry hint, since the user can remove the covering (C39.1 made it user behaviour).

- **Reasons:** `face_covered`. Without a valid forehead reference (a hat, a fringe) or a centre face: `input_missing`.
- **Settings:** `max-face-covering-score` 0–1, default 0.5. Margin-based confidence.
- **Limits:** a deep red covering can read as skin; beards, skin-toned masks and hands are unmeasured failure modes (a drawn hand scored 0.15, below the threshold). A mask covering the nose can make YuNet lose the face altogether (`face_not_present`).

#### `selfie_glasses_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| H, model-based | user behaviour | beta | upload, vision | 1 | advisory |

The centre's multi-cue glasses score: bridge edges, lower-rim edges and lens highlights, with no single cue able to reach the threshold alone (decision 12). A score above the threshold fails, with a retry hint.

- **Reasons:** `glasses_detected`. No centre face: `input_missing`.
- **Settings:** `max-glasses-score` 0–1, default 0.5. Margin-based confidence.
- **Limits:** rimless glasses with a thin bridge and no reflection are expected to be missed.

#### `selfie_suspicious_entity_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| H/A, model-based | fraud | beta | upload, vision, provider | 1 | advisory |

A synthetic, deepfake or composited face.

- **With a provider bound** (C44): its answer; flagged fails (`provider_flagged`), its score the confidence.
- **Otherwise, the heuristic fusion** of the centre's synthetic cues: the strongest weighted cue (`max(weight × suspicion)`) above `max-synthetic-face-score` fails (`synthetic_face_suspected`), with a confidence capped at 0.5 for a failure and a pass alike. The cues and their provisional scales:

  | Cue | Clear at | Suspicious at | Weight | Applies to | Genuine tail (C49) |
  |---|---|---|---|---|---|
  | `spectral_tail_deviation` | 3.71 | 4.46 | 0.8 | every capture | 99th percentile 3.7036 |
  | `residual_peak_ratio` | 2 | 6 | 0.8 | every capture | 99th percentile 1.9774 |
  | `noise_inconsistency` | 0.69 | 1.19 | 0.7 | every capture | 99th percentile 0.6889 |
  | `jpeg_grid_misalignment` | 0.27 | 1.02 | 0.5 | every capture | 99th percentile 0.2638 |
  | `canonical_landmark_distance` | 0.05 | 0.01 | 0.8 | uploads only | 1st percentile 0.22 |

  **The scales against genuine photos (C49).** Every scale is provisional, set from the research's description of each measure. Workflow 4B checked each clear level against a genuine-only distribution: 1,743 studio portraits scaled to a 2,000-px long side, and the 45 re-encodings of the public-domain test faces. Three levels sat below the genuine 99th percentile, so genuine photos read as suspicious: the spectral tail at 0.25 (genuine photos read up to 4.7), noise inconsistency at 0.25 (studio portraits read up to 1) and the JPEG grid at 0.25. Each moved to that percentile, rounded outward, keeping its ramp's width and its weight. As a result, noise inconsistency alone can no longer reach a score of 0.5 (its scale ends at 1). No level was set from a drawn artefact. The basis is a genuine-only distribution, so the detection rate stays unmeasured.

- **Either way**, an upload whose XMP digital source type is `trainedAlgorithmicMedia` or `compositeSynthetic` fails outright (`provenance_marks_synthetic`, confidence 1); any other type is recorded. The XMP packet is read by a bounded byte search, never an XML parser.
- **Reasons:** `synthetic_face_suspected`, `provenance_marks_synthetic`, `provider_flagged`.
- **Settings:** `max-synthetic-face-score` 0–1, default 0.5.
- **Limits:** the detection rate is unmeasured and the heuristic does **not** detect modern generators; resizing and re-encoding weaken every cue, and a JPEG-grid misalignment is weak evidence on resized or re-encoded uploads. The clear levels sit at the genuine 99th percentile, so about 1 genuine photo in 100 can still read a small suspicion on one cue. The genuine distribution is studio portraits: real selfies, beauty filters and heavy compression are unmeasured. Periodic content at JPEG frequencies in the face reads as grid misalignment, and a smoothed face that is then compressed reads weakly.

### Adapters (A-tier)

A-tier selfie checks need a provider (C44): `selfie_age_comparison`, `selfie_public_figure_detection`, and the provider half of `selfie_suspicious_entity_detection`. Phase 4 ships the ports and deterministic sandbox providers only ([sandbox providers](sandbox-providers.md#selfie-providers)); no real adapter ships. A real provider gets the centre image bytes and nothing else (`{ image }`: no ids, no metadata), and answers an allowlisted shape (an age; a match with a score; a flag with a score); its raw response is never stored. Only providers labelled `sandbox: true` also receive the inquiry's `reference-id` and the compared ID's birthdate, for their magic values. A real adapter needs consent text covering the processor, a processor agreement and a cross-border transfer review. Without a provider the check answers `provider_not_configured`, which a required check turns into review.

#### `selfie_age_comparison`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| A/H, model-based | fraud | beta | upload, vision, provider | 1 | disabled |

The provider's age estimate fails only when it lies outside `min-age`/`max-age` by more than `buffer-years` (`age_outside_limits`), or differs from the age by the compared ID's birthdate by more than `buffer-years` (`age_inconsistent_with_birthdate`). Only the adapter part ships: no age model with permissive weights and training data exists (research §4).

- **Reasons:** `age_outside_limits`, `age_inconsistent_with_birthdate`; `no_reference_data` without limits and without a birthdate; `provider_not_configured`.
- **Settings:** `min-age` and `max-age` 0–150, no default; `buffer-years` 0–10, default 3. The estimate itself stays out of the result.

#### `selfie_public_figure_detection`

| Tier | Type | Stage | Inputs | Version | Default template |
|---|---|---|---|---|---|
| A, model-based | fraud | beta | vision, provider | 1 | disabled |

The provider's match on the centre image.

- **Reasons:** `public_figure_match`; `provider_not_configured`.
- **Settings:** none.

## Provisional defaults

Every default and its basis, from `SELFIE_CHECK_CONFIG_DEFAULTS` (`packages/core/src/check-config.ts`). Results record the basis in `provenance['threshold-basis']`. If a fixture fails one of these, the fixture generator changes, never the threshold.

| Check | Key | Default | Basis | Source |
|---|---|---|---|---|
| image quality | `min-face-blur-score` | 15 | provisional | the same measure and default as `id_portrait_clarity_detection`'s `min-sharpness` |
| image quality | `min-face-width-px` | 64 | provisional | the face width `id_portrait_clarity_detection` requires of a face embedded with the same model |
| image quality | `min-face-height-ratio` | 0.2 | provisional | half the normal selfie framing (research §3) |
| image quality | `min-image-short-side-px` | 480 | provisional | VGA, the smallest frame of the C40.11 protocol |
| glare | `max-face-glare-ratio` | 0.05 | provisional | the vision service's whole-image glare default |
| pose | `max-center-yaw-ratio` | 0.021 | provisional | C40.11: the median `|yaw_ratio|` YuNet reads for a 5° re-posed turn of the public-domain faces |
| pose | `min-side-yaw-ratio-change` | 0.077 | provisional | C40.11: the median change YuNet reads for a 12° re-posed turn |
| multiple faces | `min-secondary-face-area-ratio` | 0.25 | provisional | a quarter of the primary face (C39.3) |
| liveness | `min-passive-score` | 0.5 | provisional | the upstream MiniFASNet ensemble's own decision point |
| liveness | `min-side-identity-cosine` | 0.4 | provisional | generous: research §7 measured 0.83 for a 30° re-posed turn |
| pose repeat | `min-planarity-residual` | 0.0045 | provisional | between research §7's planar 0.05–0.33% and 3-D 0.62–2.2% of face width |
| pose repeat | `min-tracked-points` | 20 | provisional | research §7 tracked 38–67 points per pair |
| pose repeat | `max-pose-cosine` | 0.99 | provisional | research §7: genuine turns 0.83–0.97, a replayed frame 1.000 |
| ID, account comparison | `threshold` | 0.394 | **calibrated** | the C49 report: the upper end of the 95% interval of the threshold for FAR 1e-3 on studio portrait pairs (0.3862, 0.3796–0.3937); SFace's published 0.363 gave FAR 2.40e-3 there |
| repeat | `threshold` | 0.5 | provisional | a 1:N threshold above the 1:1 one, whose floor is the 1:1 value at FAR 1e-3; gallery-size dependent (research §9; C49's 1:N table) |
| background | `min-orb-inliers` | 100 | provisional | research §8: the same backdrop re-framed 701 inliers, different backdrops 0–31 |
| background | `min-inlier-ratio` | 0.5 | provisional | research §8: the same backdrop 0.98, different 0–0.74 |
| background | `window-days` | 30 | provisional | a fraud farm reuses its room within weeks |
| background | `min-distinct-faces` | 3 | provisional | shared backdrops are common, so two faces are not enough |
| background | `min-coverage` | 0.25 | provisional | a quarter of the 48 layout cells left visible (research §8) |
| covering, glasses, suspicious entity | `max-face-covering-score`, `max-glasses-score`, `max-synthetic-face-score` | 0.5 | provisional | the midpoint of the 0–1 score, as the Phase 3 H-tier initial values |
| age comparison | `buffer-years` | 3 | provisional | apparent-age estimators err by several years |

The web client's capture triggers derive from the pose defaults (`contracts/fixtures/flow/selfie-capture.json`): the centre at 0.8 × 0.021, a side at 1.25 × 0.077, held 500 ms. The client constants are UX only; the server re-measures every photo.

## Face templates and the background index

**What is stored (C42.1, C42.5).** For a selfie whose decision is `passed`, whose `selfie_liveness_detection` and `selfie_id_comparison` both passed (whatever their `required` flag), whose inquiry is neither declined nor failed, and whose user gave the matching consent, the worker writes in the decision transaction:

- a **face template**: the L2-normalised SFace embedding of the centre face (128 numbers), **sealed** under the KEK like every other PII value (`face_templates.template`, re-wrapped by `kek:rewrap`). **A face template is biometric data.** Anyone holding the KEK and the database can read it. There is no vector column and no ANN index for faces (decision 3);
- a **background row**: the centre's 8 × 6 Lab colour layout of the background (144 numbers, the person masked out), with an HNSW index. It is not biometric, but it is personal data, environment-scoped, redacted and retained with its template.

A failed, spoofed or reviewed attempt never enters the gallery; an inquiry that fails, or that an operator declines, loses its templates and background rows in that transition's transaction.

**Matching consent (C42.3).** The consent step shows the matching text with its own unticked checkbox (`consent.biometric-matching`): the selfie and its background are compared with earlier selfies submitted to the same organization, to stop one person from using several identities, and a template is kept for `{{days}}` days (the environment's `face-template-retention-days`). **Declining it still lets the user verify.** It gates storing a template or a background row, and the account, repeat and background checks, which answer `not_consented` without it. The recorded consent lists the ticked optional keys (`optional-text-keys`) beside the required ones, and `recordConsent` refuses any key the inquiry's pinned consent step does not list. The wording needs your own legal review (decision 4).

**The search (C42.4).** For a selfie with matching consent and `selfie_repeat_detection` enabled, the worker decrypts the environment's templates newest first, in batches of 1,000, up to the environment setting `face-search-max-templates` (1,000–200,000, default 50,000), and scores them in process. The candidates exclude the current inquiry and every inquiry of its account (resolved at query time, so account consolidation is respected). When the cap stops the scan, `truncated` is `true` and the oldest templates were not compared. Measured on a Xeon E5-1650 v3 (12 logical CPUs) with `pnpm --filter @openverify/api face-scan:benchmark`: decrypting and scoring 50,000 sealed templates takes a median of about 2.4–2.5 s on an idle machine, with some runs at about 5.1–5.7 s. The scan runs once per such selfie, so the cap bounds the worker's time.

**1:N search is identification, not verification.** Comparing one face against a gallery of other people's faces identifies; that is a different processing from a 1:1 match against the user's own ID. Whether it falls under the EU AI Act's Annex III point 1(a) (remote biometric identification) is a question for your own legal review; this note is an interpretation, not legal advice. If in doubt, leave the repeat and background checks disabled.

**Retention (C42.6).** Templates and background rows older than `face-template-retention-days` (1–1,095, default 365) are deleted by the C16 retention run (`pnpm --filter @openverify/api retention:run`), whatever the inquiry's own retention; the report counts them. The raw selfie files follow the inquiry retention, so set `inquiry-retention-days` when matching is enabled. Choose the schedule per jurisdiction: the shortest period that still serves the fraud purpose your consent text names. Both settings live in the environment settings (`PATCH /api/v1/dashboard/settings`).

**Redaction (C42.6).** Redacting an inquiry deletes its templates and background rows, clears its captures' device snapshots, and stubs its `selfie.*` events.

**Rebuild after a model change (C42.7).** `pnpm --filter @openverify/api face-index:rebuild [--dry-run] [--batch-size=<1-10000>]` re-embeds the centre file of every verification that **already has** a template, through `/v1/embed/face`, and rewrites the template and its background row in place, keeping `created_at`. It never creates a row. A row is deleted when its centre file is gone or unreadable, when the new model finds no face, when the consent no longer holds, or when the inquiry was redacted, declined or failed. Templates from different models are not comparable, so run it before the new model judges anything. `--dry-run` reads the files and the eligibility, calls no vision endpoint and writes nothing.

## On-device guidance on Android

Phase 10 (C204, Workflow 10B) ports the web flow's guidance to the Android SDK's shared Kotlin, held to the web's own vectors (`contracts/fixtures/flow/selfie-guidance-vectors.json`, exported by `apps/flow/src/guidance/export-vectors.test.ts`): the YuNet input (the analysis frame turned upright and sampled to 320 px wide, BGR planes padded to multiples of 32), the decoding (candidate score 0.6, NMS 0.3), the yaw ratio and the guidance machine with the capture's own thresholds (`guidance` of the capture). Each prompt is auto-captured once, from the frame in which the pose held for `hold-ms`; the photo uploaded is the camera's still, never the 320 px analysis frame, and the server measures it again like every other pose. The upload reports `capture-trigger: auto` or `manual` (client-reported, never a result).

- **On-device detection (C204.8).** The detector runs only on the selfie capture screen, after consent, one analysis frame at a time, off the main thread inside the frame's callback. The input tensor, the candidates, the face boxes and the landmarks are zeroed before each callback returns; only the pose state (the message, the hold time, the yaw ratio and the centre ratio of this capture) outlives it. Nothing of a face is logged, saved or sent from the guidance.
- **It needs a detector.** The core SDK ships none. The optional `openverify-face` module (Workflow 10E) is one: `OpenVerifyFace.detectorFactory(context)` runs YuNet through ONNX Runtime on the device, with the model packaged in the module and checked against its pinned SHA-256 before every session. Its result on a public-domain fixture frame is held to the vision service's own numbers (`contracts/fixtures/flow/yunet-face-frame-vectors.json`: 0.25 px, 0.005 score, 0.005 yaw ratio; provisional), on the build host and on one phone (a Pixel 9, Android 17). A host may also install its own detector through `OpenVerifyComponents(faceDetectorFactory = …)`, which receives the YuNet input and returns its twelve output tensors. **Without one the selfie keeps the manual shutter** with the server's prompts (C204.6). A detector that cannot be created or fails keeps the shutter for that prompt.
- **Hints** are announced once they have settled (1.5 s), never at the frame rate; "left" and "right" are the person's own, in Arabic too. The shutter becomes the main button after 10 s, at once without frames or a detector, and after a failed auto-capture.
- **More time (WCAG 2.2.1).** Twenty seconds before the capture expires, a polite warning offers "More time" (`POST /api/v1/flow/selfie-captures/:id/extend`), which moves the expiry by 180 s, up to ten times. A request whose answer is lost is never resent by the SDK; a 409 is answered by reading the session ("already sent" when the selfie has moved on).
- **What it does not do.** The device's guidance is not liveness, not presentation-attack detection and not a check; no pose, box or score it computes is sent. The server's checks above decide.

## What the capture protocol does not stop

The capture protocol raises the cost of the simplest attacks: a still photo held up or replayed, an old video of the right person, and a casual photo upload. **It does not stop:**

- **real-time face swaps or reenactment through a virtual camera**: an attacker who can follow the prompts live passes them;
- **a looping or pre-recorded head-turn video**: with auto-capture, the random side order adds little, because a clip that turns both ways is captured whenever it reaches the prompted side (OpenVerify's own e2e clips are exactly that);
- **several stills of the person shown in turn**: a frontal and two turned photos of the same person pass the pose and identity tests; pose repeat's planarity test is the only check aimed at them, and it is advisory and uncalibrated;
- **3-D masks**.

And plainly:

- **The nonce proves only possession of the create response.** `capture-method`, the client timings and the device snapshot are **client claims**; a scripted client can send any of them.
- **The camera label and `webdriver` signals stop only unsophisticated attackers.** A label is free text and any virtual camera can be renamed; page script cannot see a capture dongle, a modified browser or an injected `getUserMedia`.
- **`passed` with `active: not_requested` means one model found no attack on one frame;** it is not proof of a live person.
- **The synthetic-face heuristic's detection rate is unmeasured,** it does not detect modern generators, and a JPEG-grid misalignment is weak evidence on resized or re-encoded uploads.
- OpenVerify holds no presentation-attack or injection-attack certification (iBeta, ISO/IEC 30107-3, CEN/TS 18099). Every selfie check is `beta`.

## The virtual-camera list

A camera label on this list is a risk flag for review (`capture_device_suspicious`), never a failure: several such tools have legitimate uses, and any label can be renamed. The list holds verified default labels only; it is data in `packages/checks/src/selfie/virtual-cameras.ts`, and a test keeps this copy equal to it. Labels are compared case-insensitively after trimming; `prefix` means the label starts with the name.

<!-- virtual-cameras:start -->

| Label | Match | Verified at |
|---|---|---|
| `OBS Virtual Camera` | `prefix` | obs-studio @ 95d5223 (release 32.2.2): the Windows DirectShow filter, the macOS camera extension and the Linux v4l2loopback card_label all name it so (research §11.1) |
| `Dummy video device (0x` | `prefix` | v4l2loopback @ e27cd86: the default card label "Dummy video device (0x%04X)" when no card_label is set (research §11.1) |

<!-- virtual-cameras:end -->

**Field collection.** Other tools (ManyCam, XSplit VCam, Snap Camera, e2eSoft VCam, CamTwist, vMix, NVIDIA Broadcast and others) are commonly reported, but their exact labels are unverified, so they are not listed: add a label only once it is verified from the tool itself or from field data, with its source. Phone-as-webcam apps (Camo, DroidCam, Continuity Camera) are deliberately left out. Chromium's plain fake device (`fake_device_0`) is neither on the list nor a file path.

## The sandbox test-capture rule

In a **sandbox** environment, three integrity signals are recorded and **do not fail** `selfie_liveness_detection` (C43, decision 7), so that end-to-end tests and demos can run with Chromium's file-backed fake camera under automation:

- a camera label that is a file path (Chromium reports the clip's path as the label);
- `webdriver: true`;
- byte replays (the same fixture file uploaded again).

The result then carries `test-capture-device: true` and the flags in `integrity-flags`, and the integrity component is not executed, which lowers the confidence. In production all three fail with `automated_capture` or `capture_replayed`. The virtual-camera flag applies in both. The worker reads the environment kind from the database. This rule and the Utopia test issuer are OpenVerify's only environment-specific behaviours; no check special-cases a fixture beyond them.

## Users who cannot turn their head

The default template asks for a head turn to each side. A user who cannot turn their head gets the pose retry hint and has no automatic fallback (decision 17). The documented workaround is **a template whose selfie step asks for `poses: ["center"]` with `liveness: "passive"`**: pose judges only the centre, liveness answers with its passive component alone (`active: not_requested`), and pose repeat answers `not_requested`. That trades the identity-continuity evidence for accessibility: read "`passed` with `active: not_requested`" above before choosing it, and route such inquiries to review if your risk needs it.

## Clients built before Phase 4

Every selfie verification created after the Phase 4 migration requires a capture (C40.7): submitting it without one answers 409 `selfie_capture_required`. Android SDK builds and cached web flow bundles from before Phase 4 therefore stop working for new selfie verifications; neither was released. Verifications created before the migration have no capture and are evaluated with liveness `not_applicable`/`capture_not_live`.

## Pipeline observations on the synthetic fixtures

**These are pipeline fixtures, not attack-detection rates.** The C45.2 set is generated from three public-domain faces: head-turn clips re-posed at ±24° with the MediaPipe canonical face mesh, a static replay, and simulated screen, phone and print spoofs. Simulated spoofs do not measure APCER or BPCER. Readings from the e2e run of Workflow 4A Stage 4 (server measurements):

| Clip | Centre `yaw_ratio` | Left / right change | Passive mean (centre, left, right) | Side cosines to centre | Planarity residual (left, right) | Similarity to the ID portrait |
|---|---|---|---|---|---|---|
| Person A head turn (camera) | 0.0076 | +0.2034 / −0.1294 | 0.897, 0.972, 0.941 | 0.856, 0.798 | 0.043, 0.027 | 0.679 |
| Person A stills (upload) | 0.0154 | +0.1919 / −0.1411 | 0.894, 0.925, 0.947 | 0.856, 0.799 | 0.022, 0.024 | 0.680 |
| Person B head turn (camera) | −0.0147 | +0.1114 / −0.1115 | 0.995, 1.000, 0.992 | 0.754, 0.742 | 0.030, 0.025 | 0.147 |
| Person A static replay | 0.0014 | +0.0160 / +0.0471 | 0.967, 0.881, 0.941 | 0.987, 0.968 | not judged | 0.665 |

What the fixtures agent measured on the spoof simulations (Workflow 4A Stage 2): MiniFASNet scores a full-frame phone composite 0.989 (real), the screen replay 0.590 and the print halftone 0.540 (both above the 0.5 default), and a phone with its bezel visible 0.0085. The passive model therefore does not separate our simulated screen and print spoofs at the default threshold.

## The honesty rules as they apply

- **Never a pass without evidence (§3a).** No evaluator answers `passed` on an error or without its input; vision's "not measured" (`null`) is never read as "nothing there". Liveness cannot pass without passive evidence, nor, with side prompts, without the active component on every prompted side.
- **Required checks never auto-approve without evidence (§3b).** `capture_not_live`, `capture_device_suspicious`, `input_missing`, `no_reference_data`, `not_consented`, `provider_not_configured` and `execution_error` on a required check send the selfie to review.
- **Heuristics are labelled (§3c).** H-tier results are `beta`, carry a confidence, reasons and their thresholds, and are advisory by default; liveness carries a confidence capped at 0.6 on a pass.
- **Sandbox providers are sandbox-only (§3d),** and the sandbox test-capture rule is the only other sandbox behaviour.
- **Provenance (§3f).** Every result names its models with their SHA-256 and every threshold with its basis.
- **Biometrics.** No embedding, landmark set, face crop, device label or background vector appears in logs, check metadata, problems or events. The device snapshot is sealed and cleared once the capture is processed; only derived flags survive.

## Known limits

- **Provisional thresholds.** Every selfie threshold but the face match is provisional; the face match is calibrated on studio portrait pairs, not on selfies against ID card photos. The passive-liveness false-reject rate on genuine webcams is unmeasured; on genuine studio portraits it is at least 5% (next item).
- **Passive liveness rejects some genuine photos.** On C49's genuine studio portraits (n = 1,743, scaled to a 2,000-px long side; `docs/calibration/selfie-phase4.md`), the passive-liveness mean has a p1 of 0.0057 and a p5 of 0.2654: at least 88 of them (5.05%) score below the 0.5 default `min-passive-score`. On such a photo `selfie_liveness_detection` fails with `passive_liveness_low`, a fraud reason. With the check required, as in the default template, that selfie fails with no retry. Studio portraits are still and often retouched, so this is a false-positive proxy, not a webcam measurement.
- **Pose.** YuNet's five landmarks under-read real head turns and carry a per-face frontal bias of about ±0.03 (see `selfie_pose_detection`).
- **Passive liveness.** MiniFASNet scores digitally injected and synthetic frames as real; it is unvalidated on turned faces; its training data is undisclosed (`THIRD_PARTY_LICENSES.md`).
- **Heuristics.** Covering, glasses and synthetic-face scores are weight-free heuristics with provisional weights; see each check's limits.
- **Background.** The person mask is geometric; virtual and blurred backgrounds defeat the check.
- **Age.** No age model ships; the check needs a provider.
- **Android** has no on-device guidance until Phase 10: its users take each pose with the shutter.
- **Budget (C41.5).** Analysing the centre, left and right selfies at 1,280 pixels takes a median of 0.39 s on an Intel Xeon E5-1650 v3 (`services/vision/tools/benchmark_selfie.py`), against the 3 s budget; the synthetic-face cues are the largest share.
