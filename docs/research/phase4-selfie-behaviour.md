# Phase 4 research: how Persona's selfie product behaves (clean-room notes)

Prepared 2026-10-21 for OpenVerify Phase 4 (selfie verification and liveness). Everything below is
written in our own words. Field names, enum values, event names, reason codes and check identifiers
are reproduced because they are short identifiers needed for functional parity. No sentences,
UI copy or hint texts are copied. Anything that public sources do not state is marked
**not documented**. Statements we infer, but that no source states, are marked **(inference)**.

---

## 0. Sources and pins

### 0.1 OpenAPI repository (O)

- Repository: `github.com/persona-id/persona-openapi`, shallow clone of commit
  **`805512b348af1c5d345bea8d7db7eb43d1821872`** (committed 2026-10-21 08:07 UTC).
- Spec directory read: `2026-09-29/`. The selfie path file and the selfie verification schema are
  byte-identical in all eight version directories (2020-05-18 … 2026-09-29; md5 compared), so the
  findings are not version-specific.

| Key | File (under `2026-09-29/`) |
|---|---|
| O1 | `components/schemas/verification-selfie.yaml` |
| O2 | `components/schemas/verification-shared-attributes.yaml` |
| O3 | `components/schemas/selfie.yaml` |
| O4 | `paths/verification_selfies_{verification-id}.yaml` (only `GET`) |
| O5 | `components/examples/verification-requires-retry-webhook-body.yaml` |
| O6 | `components/examples/case-*-webhook-body.yaml` (10 files, same selfie block) |
| O7 | `webhooks/selfie.{created,submitted,processed,errored}.yaml` and `components/examples/selfie-*-webhook-body.yaml` |
| O8 | `webhooks/verification.*.yaml` |
| O9 | `components/schemas/inquiry.yaml` (relationship `selfies`), `components/schemas/inquiry-included-objects.yaml` |
| O10 | `components/schemas/inquiry-template-version.yaml` (per-pose pictograph theme fields) |
| O11 | `components/schemas/account.yaml` (default field `selfie_photo`) |
| O12 | `components/examples/transaction-retrieve.yaml` (`id_selfie_comparison` example) |
| O13 | `paths/transactions_{transaction-id}.yaml` (transaction fields `center-photo`, `selfie-compare-photo`) |
| O14 | `paths/transactions_{transaction-id}_redact-biometrics.yaml` (marked `x-private: true`) |
| O15 | `components/schemas/list.yaml` (list discriminator) |
| O16 | `components/schemas/verification-government-id.yaml` (`selfie-photo`, `selfie-photo-url`) |
| O17 | `components/schemas/inquiry-session.yaml` (`device-handoff-method`) |
| O18 | `components/schemas/source-data-verification-selfie.yaml` (Connect snapshot) |
| O19 | `components/schemas/verification-shared-relationships.yaml` |

### 0.2 Developer docs (D), version 2026-09-29

Index: `https://docs.withpersona.com/llms.txt` → `https://docs.withpersona.com/2026-09-29/llms.txt`.
Base for the keys below: `https://docs.withpersona.com/2026-09-29/`.

| Key | Page |
|---|---|
| D1 | `api-reference/verifications/selfie-verifications` |
| D2 | `api-reference/verifications/selfie-verifications/retrieve-a-selfie-verification` |
| D3 | `verification-types` |
| D4 | `verification-checks` |
| D5 | `verification-lifecycle` |
| D6 | `api-reference/verifications` |
| D7 | `events` |
| D8 | `integration-testing` |
| D9 | `downloading-files` |
| D10 | `lists` |
| D11 | `api-reference/importers/import-face-lists` |
| D12 | `inquiry-signals` |
| D13 | `embedded-flow-client-callbacks` |
| D14 | `browser-device-support` |
| D15 | `android-sdk-v2-integration-guide` |
| D16 | `ios-privacy-manifest` |
| D17 | `api-reference/transactions/redact-transaction-biometrics` |
| D18 | Changelog entries `updates/changelog/2023/4/10`, `2023/4/17`, `2024/2/26`, `2025/2/18`, `2025/3/3` |

### 0.3 Help Center (H), secondary public source

The developer docs hand most selfie detail off to the Help Center (D1 and D3 link there), so it was
read too. Index: `https://help.withpersona.com/llms.txt` (full dump: `/llms-full.txt`).
Article URLs have the form `https://help.withpersona.com/articles/<id>/`.

| Key | Article id | Topic |
|---|---|---|
| H1 | `1l0WTbR5UsfiggNDPWbnUp` | Selfie Verification overview |
| H2 | `4BTlLMW5TdKym0zoDzhVV9` | Reading selfie results |
| H3 | `1dsXklKVFkvpSdX90CTtNo` | Configuring selfie checks |
| H4 | `6klAhoMzfALFRcztwe0DbH` | Selfie configurations |
| H5 | `2LL51Yo6PvO7uIu2FYfZ16` | Selfie module in the flow editor |
| H6 | `2fF5jGgyrMGVyWzg0paKDX` | Capture hint situations |
| H7 | `7JQ78WDWLj5L63qXEu7AqJ` | Capture methods |
| H8 | `3c2XDYIxmf9PjivgeJtx3i` | Capture-method analytics |
| H9 | `3bU3AKdWw5gSN8DxWQVv8p` | Why disable uploads |
| H10 | `5CB08CPfpTv9ogZCbfmS0D` | KYC fraud best practices |
| H11 | `Hle9tEjLOPc7iQI6SlG1sJ` | Correlated Verifications |
| H12 | `254hfSuncHBVK9oAnpMJm5` | Escalated Verifications |
| H13 | `6nDg4pW8yK2sR9cV5tH1mQ` | Digital ID and selfie ordering |
| H14 | `57JARCJM8LRmWYjnrJiFpJ` | Collecting a selfie after a failed ID |
| H15 | `45UrKCZtpwW5Z7DJ0JW0vM` | Selfie age estimation |
| H16 | `5I4utwPPHF4TilUvZTJCsh` | Age assurance overview |
| H17 | `7hJRIKMYIVTAnzoGVwWwV0` | Using Lists |
| H18 | `gnAr5qyid6E0BOFNAxj2f` | Workflow step: Add Item To Face List |
| H19 | `JhJwzlzBVgW4bxNdJJSot` | Workflow step: Get List Match |
| H20 | `64tz1SDfq1icPpDcqp60QY` | List Matches module |
| H21 | `MBqBUj2HlXY34i5SJIRaz` | Enabled vs required checks |
| H22 | `5Tc5tsWfBX03AHRkr2vqv2` | Verification check attributes |
| H23 | `4SxXLtuLwYAWSkxWbHQtoo` | Security and privacy overview |
| H24 | `42ubXB5lJPWNaITI0uJfrI` | Redaction and redaction policies |
| H25 | `6BVMG3mwKDLzwDwks4Kg5x` | Aadhaar auto-redaction (biometrics) |
| H26 | `1hNhIR4xUXmF0myJ6A3dYk` | Branding FAQ (biometric consent screen) |
| H27 | `5pWQQ9DhF7llJefCDXhlxO` | Verification results view refresh |
| H28 | `4Z0b6uVX2RrvPG4Zzzzzz1` | Accounts Gallery module |
| H29 | `XPDAK8B0IhHdIzMNnp9Z2` | Verifications list and gallery view |
| H30 | `3JkqiHmtOWftGHDPKYcOCW` | Reviewing an inquiry |
| H31 | `xrnJpm5Q18CSN63SQFdsi` | Walkthrough of a selfie result in the dashboard |
| H32 | `3aYYkI9NMDsyVqx5V3IT3G` | Signals overview |
| H33 | `71bfAMD6bNyf7zFW7Q1ghk` | Case layout modules |
| H34 | `2dlG9Q9liRn43wUIxHntRT` | Graph node properties |
| H35 | `3Yo5qPfWb5mGm3FGh0bWKH` | Reverification with accounts |
| H36 | `tdHGWIcHzLEnvUHe05nH1` | Flow modules list |
| H37 | `QC1OAt4zLihlELoVNJ5jmK` | IAL2 with Persona |
| H38 | `dwNIjd448NolYsDSs3zhUE` | End users: glasses and hats |
| H39 | `9WZ7Tw1BurKZmx11sMKFvV` | End users: repeated selfie retries |
| H40 | `ytHNjFfek8K22wv85UPgVS` | Relay live-human-presence claim |
| H41 | `r9sOQvL9uRALxnHxKbTsfO` | Device handoff component |
| H42 | `5TKUNJRjtKqtwU02Z5Ka1X` | Inquiry expiry (index description only, not fetched) |
| H43 | `https://help.withpersona.com/end-users/linkedin/get-verified/` | One customer's end-user notice |
| H44 | `5NB4eGgy0k8oRs5O5sDOR1` | Previewing and simulating an inquiry |
| H45 | `425G1MJXb8d9w6hTr7Huwg` | Reading government ID results |

### 0.4 Not publicly reachable

- The authoritative per-check table, with definitions and the full fail-reason list, sits behind
  the dashboard login at `app.withpersona.com/dashboard/resources/verification-checks` (D1, D4, H2, H3).
  Per-check definitions and exhaustive reason codes are therefore **not documented** publicly.
- The Help Center "List types" article (`2SyBJcNqYRJX8sotVOmY7Z`) and "Lists overview" article
  (`7IqWZFDaPjn8RTJtbgUjfV`) return HTTP 404 to anonymous readers.

---

## 1. The selfie verification resource

### 1.1 Two different objects

Persona exposes **two** selfie-related resources, and OpenVerify should keep them apart.

1. **The selfie verification**: type `verification/selfie`, id prefix `ver_` (O1, O4, D2). It holds
   the images, scores and check results of one verification attempt. It is read through
   `GET /verification/selfies/{verification-id}` (O4). There is no public create or submit endpoint
   for it in the OpenAPI.
2. **The selfie capture object**: id prefix `self_` (O3), linked to its inquiry (O3, O9). Its
   `type` is polymorphic, and the open enum lists three variants:
   - `selfie/profile-and-center`
   - `selfie/center-only`
   - `selfie/configurable-poses`

   Its attributes are `status`, `created-at` and `processed-at`. `processed-at` stays null until
   processing ends, whether it ends in `processed` or `errored` (O3). The capture statuses are
   `initiated`, `submitted`, `processed` and `errored` (O3). An inquiry lists these objects under
   its `selfies` relationship (O9).

Neither D nor H explains the `selfie/configurable-poses` variant beyond the enum value (**not documented**).

### 1.2 Attributes of `verification/selfie`

Every attribute is optional or nullable in the schema (O1, D2).

| Attribute | Shape | What it holds (our words) | Source |
|---|---|---|---|
| `status` | string | Verification status (see 1.4). | O2 |
| `created-at`, `created-at-ts` | ISO time / Unix int | Creation time, in two encodings. | O2 |
| `submitted-at`, `submitted-at-ts` | nullable | When the capture was frozen for processing. | O2 |
| `completed-at`, `completed-at-ts` | nullable | When processing finished. | O2 |
| `redacted-at` | nullable time | When PII and biometrics were removed. | O2 |
| `country-code` | nullable ISO alpha-2 | Country context. Null in the selfie example and `US` in the retry example. | O2, O4, O5 |
| `tags` | string[] | Operator tags. | O2 |
| `checks` | array | See 1.3. | O2 |
| `capture-method` | nullable string, open enum `photo`, `video` | Whether stills or a video were captured. | O1 |
| `center-photo-url`, `left-photo-url`, `right-photo-url` | nullable string | Signed URL of each pose image. | O1 |
| `photo-urls` | array of `{page, url, filename, byte-size}` | One entry per stored pose image. `page` is an open enum: `left_photo`, `center_photo`, `right_photo`. | O1, O4 |
| `video-url` | nullable string | The selfie video, when video capture was used. Added on 2023-04-17. | O1, D18 |
| `center-photo-face-coordinates` | nullable `{top-left, top-right, bottom-left, bottom-right}`, each a 2-number array | Face box on the center photo. The example values (0.2–0.7) point to fractions of the image size, but the units are **not documented**. Added on 2024-02-26 so integrators can crop the face. | O1, D18 |
| `document-similarity-score` | nullable number | Probably the selfie-to-ID-portrait score **(inference)**: it is null whenever the ID comparison is N/A in the examples. Scale and meaning are **not documented**. | O1, O4, O5 |
| `selfie-similarity-score-left`, `selfie-similarity-score-right` | nullable number | Probably how closely each side pose matches the center pose **(inference)**. The passed example shows `100` for both, which hints at a 0–100 scale. **Not documented.** | O1, O4 |
| `entity-confidence-reasons` | string[] | Reason tokens behind an overall entity-confidence judgement. The retry example carries `low_liveness_confidence`. The government ID verification also has `entity-confidence-score`; the selfie verification has only the reasons. | O1, O5, O16 |
| `from-reusable-persona` | boolean | True when the data came from the reusable-identity product. Added on 2025-02-18. | O1, D18 |

Relationships (O19): `inquiry`, `template` (legacy), `inquiry-template`,
`inquiry-template-version`, `transaction`, `verification-template` (type
`verification-template/selfie`), `verification-template-version`, and `accounts` (a list).

Files (D9):
- Image and video URLs are signed links on a separate files host.
- By default they stay valid for 6 hours. The lifetime can be set per API key or per webhook, up to 3 days.
- Key frames pulled from a selfie video can be downloaded the same way.

Connect / reusable KYC (O18): another organisation can see only a PII-filtered snapshot of a selfie
verification, carrying `peekable-attributes`.

### 1.3 Shape of a check (shared by every verification type)

Source: O2, D2, D4.

| Field | Values | Notes |
|---|---|---|
| `name` | check id | |
| `status` | `passed`, `failed`, `not_applicable` (open enum) | D4 adds `pending` for asynchronous checks that are still running. |
| `category` | `biometrics`, `fraud`, `user_action_required`, `validity`, or null | Describes the check, not its result. Null means unknown and must **not** be read as "not fraud". |
| `reasons` | string[] (items may be null) | Why a check failed or did not apply. For some checks the reasons are the main payload. |
| `requirement` | `required`, `not_required`, `requires_retry` (open enum) | Absent in the plain retrieve example (O4); present in the webhook and case examples (O5, O6). |
| `metadata` | free-form object | `{}` in **every** selfie example. No selfie metadata keys are public. |

Check "type" in the dashboard and the docs (D4, H2, H22, H31):
- **Fraud.** A failure raises the likelihood that the submission is fraudulent.
- **User behavior.** The submission fell below the quality bar or the user did not follow the
  instructions. For these checks the flow shows the end user a hint so they can fix the problem
  and retry.

H2 and H22 state that the API spells "user behavior" as **`user_action_required`**.

Launch stages (D4):
- `beta`: thresholds may still be tuned and coverage may be partial.
- `sunset`: replaced by other checks.

Each check is either enabled or disabled, and either required or not (H21):
- Only an enabled check can be required.
- Every required check must pass for the attempt to pass.
- Non-required checks are informational.
- A check without the data it needs returns not-applicable instead of guessing.

### 1.4 Statuses and lifecycle

Verification statuses (O2, D5, D6) that apply to a selfie:

| Status | Meaning |
|---|---|
| `initiated` | Created from a verification template. Images can still be attached. |
| `submitted` | Inputs are frozen and processing starts. |
| `passed` | Every required check passed. |
| `failed` | At least one required check failed. |
| `requires_retry` | **Deprecated.** Processing could not finish because of the inputs. Persona now advises branching on passed/failed or on the attempt count. |
| `canceled` | Stopped before completion, usually because of an internal error. |
| `skipped` | A check configured to skip the verification when it fails did fail. The documented example is not a selfie one. |

`confirmed`, `tentatively_passed` and `tentatively_failed` are scoped to other verification types (O2).

Attempts and retries:
- Each verification is **one attempt**. An inquiry can hold several selfie attempts (H2).
- The flow's branching step decides how many retries are allowed (H5). An inquiry fails once it
  goes past the configured number of verification attempts (D7).
- Workflow conditions can read a counter of passed selfie verifications on the inquiry trigger,
  `passed_selfie_verification_count` (H14).

Defaults applied when a new selfie verification template is created (D18):
- **2023-04-10:** `selfie_liveness_detection` is enabled, and "strict" capture (higher resolution,
  a better-centred face) is required.
- **2025-03-03:** `selfie_face_covering_detection` and `selfie_suspicious_entity_detection` are
  enabled **and required**.

Both changes remain configurable.

### 1.5 Events and webhooks

**Capture-object events** (O7, D7). The payload `data` is the **capture object** (`self_…`), not
the verification. `included` may carry the inquiry when inclusion is enabled for the subscription.

| Event | When it fires |
|---|---|
| `selfie.created` | A capture object was created. |
| `selfie.submitted` | The capture was submitted. |
| `selfie.processed` | Processing finished. |
| `selfie.errored` | Processing failed. |

**Verification events that can concern a selfie** (O8, D7):
- `verification.created`
- `verification.submitted`
- `verification.passed`
- `verification.failed`
- `verification.requires-retry`: legacy; O5 is a selfie example of it.
- `verification.canceled`
- `verification.skipped`
- `verification.escalated`
- `verification.updated-tags`

`verification.tentatively-passed` and `verification.tentatively-failed` belong to other verification types.

Escalation (H12, and the workflow-trigger notes in the H full dump):
- After a government ID or selfie verification finishes, slower models re-score it in the
  background (for example, multi-frame video analysis).
- A medium or high risk result fires `verification.escalated`. `inquiry.escalated` exists as well.
- Escalation runs separately from the pass/fail events, so a workflow triggered by `verification.passed` can finish before any escalation arrives.
- Enterprise plan only.

Sandbox simulation (D8). `create_passed_verification` and `create_failed_verification` on a
selfie emit the events in this order:
1. `selfie.created`
2. `selfie.submitted`
3. `selfie.processed`
4. `verification.created`
5. `verification.submitted`
6. `verification.passed` or `verification.failed`

The sandbox does not run the real models (D18, 2023-04-17). Selfie verifications became creatable
in the sandbox on 2023-04-10 (D18).

### 1.6 Model component versions

Selfie verifications are versioned **per component** (D1). Three components ship independently,
and each verification references one version of each:
- **Match**: latest 4.0.0. Its notes cover a new face-comparison ensemble, fewer false rejections
  on poor or restricted ID portraits, digital-ID and NFC portrait support, and more reliable
  account comparison.
- **Liveness**: latest 4.3.0. Its notes cover the presentation-attack ensemble, deepfake and
  generative-AI recall, replica detection, video-replay attacks, injection attacks, capture-time
  defences, and recalibrated risk levels.
- **Age**: latest 2.3.0. Its notes cover a new age-estimation model, stricter face-quality gating
  that excludes bad pose and lighting, extra risk settings, and the rollout of
  `selfie_age_threshold_comparison` and `id_age_inconsistency_detection`.

Which component versions ran on a given verification is **not exposed** in the API schema
(**not documented**).

### 1.7 Selfie without the hosted flow

The API route is a **transaction** plus a workflow with a "run selfie verification" step. It is
Enterprise only (H1).

Input limits (H1):
- Accepted formats: PDF, JPEG/JPG, PNG, HEIC, HEIF.
- File size: 10 KB to 15 MB.
- Image sides: 200 px to 15,000 px.

The transaction example shows file fields `center-photo` and `selfie-compare-photo` (O13). Those
names are example data, not a contract.

---

## 2. Capture modes and per-template configuration

| Setting | Options | Source |
|---|---|---|
| Poses to capture | "Left, center and right" (three images; **default**, recommended for fraud) or "Center only" (one forward image). The API also has a `configurable-poses` capture type (**not documented**). | H1, H3, H4, H10, O3 |
| Compare to | Which ID verification in the inquiry the comparison checks use (selfie-to-ID **and** age comparison): first passed ID, last passed ID, or last ID whether it passed or failed. | H3, H4 |
| Checks | Each check enabled/disabled and required/not. Some checks expand to reveal sub-options whose content is **not documented**. | H3, H21, H22 |
| Liveness | `selfie_liveness_detection` is on by default. KYC guidance makes it required, enables every fraud check and keeps three poses. | D18, H10 |
| Strict capture | Default since 2023: needs a higher-resolution image and a more centred face. | D18 |
| Photo vs video | `capture-method` is `photo` or `video`. A separate flow module, "selfie verification with video capture", exists. Video steps may also record audio, and the mobile SDK asks for microphone permission only then. | O1, H36, D15, D16, D13 |
| Capture methods | Set separately for desktop web, mobile web and native SDK. Options: camera capture vs file upload (uploads **allowed by default**), and guided capture. Persona recommends turning uploads off to force a live capture. | H3, H7, H9, H10 |
| Auto vs manual capture | Analytics labels each submission as auto-captured, manually captured, uploaded, or a mix. Autocapture can be turned off. | H2, H8 |
| Device handoff | Desktop users can continue on a phone by email link, SMS or QR code. The session records `device-handoff-method` (`email`, `sms`, `qr`). The handoff link has its own configurable expiry. | H3, H5, H41, O17, H42 |
| Retry count | Set in the pass/retry/fail branch that the selfie module inserts. | H5 |
| Theme | Separate pictogram images and heights for the generic selfie screen and for each pose (center, left, right). | O10 |
| Consent | The selfie module inserts a biometric consent screen with legally required wording. Persona advises legal review before editing it. | H5, H26 |

Camera requirements (D14):
- Recommended: 1920×1080.
- 1280×720: autocapture becomes inconsistent.
- Below 640×480: rejected. The user is asked to switch device, or to upload if the template allows it.

When the browser cannot do embedded video, the flow lets the user upload a still instead; the
client event `selfie-record-upload` reports this (D13).

Client-side events the embedded SDK emits for selfies (D13):
- `selfie-camera-select`
- `selfie-camera-capture`: `metadata.stepData.files[]` carries a `pose` and a `captureMethod` per file.
- `selfie-record-upload`
- `load-camera-failed`
- `camera-permissions-check-result`: booleans for camera permission, microphone permission, and
  whether the microphone was requested.
- The noisy error code `camera_error`, raised when a black camera frame is detected.

Live capture guidance (H6, H39). The flow names a situation and the user corrects it, and those
are the situations OpenVerify needs to detect. We will write our own wording for each:
- face not centred;
- turn slightly left, or slightly right;
- too close, or too far;
- no face found after a while (with a suggestion to remove glasses);
- more than one face in view.

**Not documented:**
- the yaw or pitch angles that count as "left" and "right";
- whether pose order is randomised;
- timing limits, and any server nonce or challenge protocol;
- the number of frames captured per pose.

---

## 3. Check catalogue (selfie)

`Cat.` is the `category` seen in the OpenAPI examples (O4, O5, O6). `Hint` means the docs class
the check as user behavior, which gets an in-flow retry hint. Every metadata object in the
examples is `{}`.

| Check id | What it detects (our words) | Cat. | Hint | Documented config | Reasons seen in examples | Sources |
|---|---|---|---|---|---|---|
| `selfie_image_quality_detection` | Image good enough to analyse: resolution, lighting, blur. | `user_action_required` | yes | Strict-capture default (D18). No thresholds are public. | N/A with `[]` (`requirement: required`) | O5, D1, D18 |
| `selfie_glare_detection` | Glare or reflections on the face. | `user_action_required` | yes | none public | `too_much_glare` (failed) | O4 |
| `selfie_pose_detection` | The user faced the camera correctly, and each requested pose was actually performed. | **`fraud`** (all 11 examples) | Pose hints exist at capture time (H6), but the check itself is categorised fraud. | Pose mode (center-only vs three) | `[]` only | O4, O6, D1, H6 |
| `selfie_multiple_faces_detection` | More than one face in the capture. | `fraud` | A capture-time hint exists (H6). | none public | `[]` only | O4, H6 |
| `selfie_liveness_detection` | Signs of a spoof: presentation attacks (photo, screen, mask), replicas, replayed video, deepfakes or generative faces, injected streams. | `fraud` | no (fraud), but see `requirement: requires_retry` below | Enabled by default. KYC guidance: required. Liveness "risk levels" exist (low/medium/high on the signal); the mapping from risk to pass/fail is **not documented**. | `replica_detected` (failed, `requirement: requires_retry`). The same verification carries `entity-confidence-reasons: [low_liveness_confidence]`. | O5, O6, D1, H10, H32 |
| `selfie_pose_repeat_detection` | **Not documented.** The name suggests the separate poses are not really distinct, i.e. one static image is reused across poses **(inference)**. | `fraud` | — | none public | `[]` only | O4 |
| `selfie_id_comparison` | Selfie face vs the portrait of an earlier eligible ID verification in the same inquiry or transaction. | `fraud` | no | "Compare to" setting (H3). The dashboard shows a **Face Comparison Risk** level (example value `minimal`). The full level set and the thresholds are **not documented**. | N/A `no_government_id`; N/A `[]`; passed. A failure is called a "face mismatch" in prose; its reason token is **not documented**. | O4, O5, O6, H2, H13 |
| `selfie_account_comparison` | Selfie vs the selfie already stored on the user's account. The account has a default file field `selfie_photo` (O11). Used for selfie-only reverification of a known account (H35). | `fraud` | no | none public | N/A `no_account_selfie_present` | O4, O11, H31, H35 |
| `selfie_age_comparison` | Age estimated from the face vs a reference birthdate, taken from the compared ID per "Compare to". | `fraud` | no | Age ranges or limits are **not documented** per check. Age 2.1.2 added "additional risk settings" (D1). H15 recommends a 2.5–3-year buffer between the estimate and the enforced threshold. | N/A `no_reference_birthdate` | O4, H3, H15, D1 |
| `selfie_age_threshold_comparison` | **Not in the OpenAPI examples.** Named only in the Age 2.1.0 version note. Probably the estimated age against a configured threshold, without needing an ID **(inference)**. | not seen | — | **not documented** | — | D1 |
| `selfie_public_figure_detection` | **Not documented.** The name suggests the face matches a known public figure, as with stolen celebrity photos **(inference)**. | `fraud` | — | none public | `[]` only | O4 |
| `selfie_suspicious_entity_detection` | **Not documented.** Enabled and required by default since 2025-03. Probably an aggregate fraud-entity judgement, possibly tied to `entity-confidence-reasons` **(inference)**. | `fraud` | — | none public | `[]` only | O4, D18 |
| `selfie_face_covering_detection` | Face partly hidden by a mask, scarf, hat or similar (the "obfuscation" goal in D1). Enabled and required by default since 2025-03. | `user_action_required` (dashboard legend agrees, H31) | yes | Strictness is up to the business (H38) | `[]` only | O4, D1, D18, H31, H38 |
| `selfie_glasses_detection` | Eyewear obscuring the eyes or face. | `user_action_required` | yes | Strictness is up to the business (H38) | `[]` only | O4, H6, H38 |
| `id_selfie_comparison` (runs on the **government ID** verification) | Reverse direction: the ID portrait is compared with a selfie captured **earlier** in the same inquiry. | `fraud` | no | — | N/A `no_selfie` | O12, H13 |

Other `selfie_*` identifiers in the OpenAPI examples are not checks:
- `selfie_photo` is the account field (O11).
- `selfie_left` and `selfie_center` appear only as example filenames (O1, O4).

Across all OpenAPI versions, the selfie check ids are exactly the 13 named in the task brief. No
other `selfie_*` check appears.

Configuration knowledge gaps (all **not documented**):
- face-match thresholds or score scale;
- liveness score thresholds;
- age limits per check;
- sub-options of expandable checks;
- the full reason-code list. It is visible only inside the logged-in dashboard (0.4).

---

## 4. How selfie and government ID verifications interact

- **Direction depends on order** (H13):
  - When an ID verification that supplies a portrait finished **before** the selfie,
    `selfie_id_comparison` runs on the selfie verification.
  - When the selfie came **first**, the later ID verification runs its own `id_selfie_comparison`
    instead. That check reports N/A `no_selfie` when no selfie exists (O12, H45).
  - The two checks appear on different verification results.
- **Which ID** (H3, H4): the "Compare to" setting picks the first passed, the last passed, or the
  last attempted ID verification. The same choice also feeds the age comparison.
- **Missing or portrait-less ID** (O4, H13):
  - With no eligible portrait, the check is `not_applicable`; O4 shows the reason `no_government_id`.
  - Persona stresses that N/A means no comparison ran. It is neither a match nor a mismatch.
  - Some digital IDs never supply a portrait, so a selfie that follows only such an ID cannot be
    face-matched.
  - The recommended order when a face match is required: digital ID, then government ID, then selfie.
- **Default flow order** (H14):
  - The stock "government ID + selfie" template runs the ID first.
  - It **fails the inquiry** once the ID attempts are exhausted, so no selfie is collected.
  - Customers who want the selfie anyway re-route the failed-ID branch to the selfie step, tag the
    inquiry, and decide at the end.
  - Downside of that variation: the account is not updated from a failed ID.
- **Reverification** (H35): a later selfie-only inquiry with the same reference id is compared with
  the earlier ID portrait and the earlier selfie on that account.
- **Sandbox** (D18, 2023-04-17):
  - The ID verification's `selfie-photo-url` is filled with the ID front image, so integrators can
    test chaining into a selfie verification.
  - No face detection runs in the sandbox.
  - The government ID resource has `selfie-photo` and `selfie-photo-url` (O16). Whether these hold
    a portrait crop or a selfie taken during the ID step is **not documented**.
- **Biometric redaction side effect** (H25): once India-issued ID biometrics (portrait, facial
  vectors, derived artefacts) are auto-redacted, checks that need them report `not_applicable`.

---

## 5. Face lists and selfie-background lists

### 5.1 What the sources say

- **List types** (D10):
  - The docs list "Face" (available by contacting support) and "Selfie background" among the list
    types, alongside the familiar ones (IP, email, ID number and so on).
  - The OpenAPI list discriminator has **only eight** types: browser-fingerprint, country,
    email-address, geolocation, government-id-number, ip-address, name, phone-number (O15).
  - It has **no** face or selfie-background list or list-item endpoints.
- **Face import** (D11):
  - `POST /importer/list-item/faces`, multipart, with `image-files[]` and `list-id`.
  - One image becomes one list item. Persona suggests batches of 50 or fewer, averaging about 500 KB each.
  - It returns an importer (`mprt_` prefix) with:
    - `status`: `pending`, `ready` or `errored`;
    - the counters `successful-count`, `duplicate-count` and `error-count`.
  - The page warns that biometric-processing consent must be in place before face lists are used.
  - This endpoint is **absent from the OpenAPI** at the pinned commit (searched all versions).
- **Workflow step "Add Item To Face List"** (H18):
  - Takes the image from an earlier inquiry-based step (a fetched inquiry, a created inquiry, or an
    inquiry trigger) and adds it to a chosen face list.
  - Has an optional continue-on-error setting.
  - Growth plan and above.
  - Face lists are described as storing images, so that faces from new inquiries can be matched
    against known people or known fraudsters.
- **Selfie background**: listed as a type and nothing more. Its matching behaviour is **not documented**.

### 5.2 How a list match surfaces

No public source describes face-list or background-list matches **specifically**. For lists in
general:
- Inquiries can be filtered by list match, and a match shows as a risk signal on the inquiry
  details page (H17).
- The inquiry has a "List matches" tab (H30). Accounts and cases have a List Matches module (H20).
- Workflows branch on a match:
  - through a conditional step that references the list (H17);
  - or through the **Get List Match** step, which returns true or false (H19). Whether that step
    accepts face lists is **not documented**.
- **No `selfie_*` check in any OpenAPI example corresponds to a list match.** As far as the public
  material shows, a face-list match is therefore a list match or workflow condition, **not a
  verification check**.

### 5.3 Related similarity features

None of these are checks.

- **Correlated Verifications** (H11):
  - On a selfie or ID verification page, the dashboard lists the most alike submissions from the
    previous 14 days, within the same environment only.
  - Matches are labelled near-exact, strong, faint or none.
  - Purely informational: it never changes a status, never adds a reason, and cannot be required.
- **Graph node properties** (H34), each enabled per organisation:
  - *Selfie Similarity* links accounts with similar, not identical, selfies. It is removed when the
    selfie is redacted.
  - *Image Background Similarity* links photos taken in the same or similar setting.
  - *Camera Fingerprint* is a sensor-level camera identity derived from capture metadata.
- **Case module "Account Similarity-Selfie"** (H33): shows other accounts in the same environment
  whose consented, non-redacted selfies the face-matching engine returned as confident matches.

---

## 6. Liveness, injection, retention and consent guidance

### 6.1 Liveness

- Persona does not publicly frame its approach as "passive" vs "active" (**not documented**). What
  it does say:
  - Requiring head turns across three poses makes static photos, replays, deepfakes and virtual
    cameras harder to use (H10).
  - Liveness weighs motion, depth and timing signals (H10).
  - Version notes cover presentation attacks, replicas, video replays, deepfakes and generative AI,
    injection attacks, and capture-time defences (D1).
  - Slower multi-frame video analysis runs asynchronously in escalation (H12).
- **Injection and virtual cameras**:
  - "Virtual camera risk" is an image-layer **signal**, and "Selfie Liveness Risk Level" is an
    ensemble signal (H32). Risk levels are `low`, `medium` or `high`.
  - KYC guidance: open a review case when virtual-camera risk or selfie-liveness risk is medium or
    high (H10).
  - Persona counts injection detection inside the ID and selfie steps as an addition beyond IAL2,
    and says IAL2's biometric option itself expects liveness (H37).
  - The device-signal layer includes camera properties (H32).
  - How injection or virtual cameras are detected is **not documented**.
- **Uploads vs live capture** (H9): a live capture yields frame motion, device and capture
  metadata. An upload can be a screenshot, a recapture or an edited file, so disabling uploads
  strengthens the anti-spoof checks.
- **Certification**: the age-estimation article lists an iBeta ISO/IEC 30107-3 evaluation among
  third-party evaluations (H15). Liveness accuracy figures are **not documented**.
- **Relay live-human-presence claim** (H40): a liveness-only selfie (method token `live_selfie`)
  shows that a live person is present without identifying them. Persona says it keeps the tuning private.

### 6.2 Retention and redaction

- Retention is controlled by the customer (H23):
  - redaction by API (delete endpoints) or from the dashboard;
  - automatic redaction after a retention period, which Persona support sets up;
  - redaction is permanent, and a PII-free record of the inquiry remains.
- Redaction cascades to objects below the redacted one (H24): redacting an account also redacts its
  inquiries, but redacting an inquiry leaves the account intact. Workflows can redact through a
  Redact Object step, and Persona can apply organisation-wide policies.
- **Biometric-only redaction**: a transaction endpoint deletes the biometric data of the transaction
  and all its associated objects, and cannot be undone (D17, O14). It is marked private in the OpenAPI.
- The Aadhaar policy (H25) shows which data counts as biometric:
  - the ID portrait;
  - facial feature vectors;
  - derived biometric artefacts.
- Age estimation (H15, H16):
  - production images are never used for training;
  - processing the biometrics transiently and deleting them right after the decision is described
    as the privacy-forward option.
- One customer's end-user notice (H43, LinkedIn) states two rules: face geometry is deleted right
  after the 1:1 comparison, and selfie and ID images are kept up to 30 days. That notice is
  customer-specific. A general default retention period for biometrics is **not documented**.

### 6.3 Consent

- When a hosted or embedded flow includes a selfie, its first screen shows consent and
  data-retention information aimed at BIPA compliance (H26).
- The selfie module inserts a biometric consent screen with legally required wording (H5).
- Face-list import requires biometric consent to be in place (D11).
- Selfie similarity in cases considers only consented selfies (H33).
- How consent is stored or exposed in the API is **not documented**; there is no consent field on
  the selfie resources (O1, O3).

---

## 7. Dashboard presentation

- **Verification result** (H2, H27, H31):
  - A header shows the pass/fail outcome.
  - An images section shows the captured poses (center, left, right).
  - A check table follows:
    - status icons: passed, not-applicable, failed;
    - the check name, with a short definition on hover;
    - a type column (Fraud / User behavior);
    - a required column; required checks are listed first.
  - Rows can expand to show metadata in a consistent layout.
  - For selfie-to-ID, the expanded row shows a **Face Comparison Risk** level (example: `minimal`),
    not a raw similarity number.
  - A side-by-side layout of the ID portrait and the selfie, and any display of the numeric
    `selfie-similarity-score-*` or `document-similarity-score`, are **not documented** in text.
    The screenshots are blurred.
- **Below the submission**: the Correlated Verifications section (H11), and an escalation marker or
  filter for escalated verifications (H12).
- **Verifications list** (H29):
  - filters for date, status, check outcome (pick the verification, check and status), inquiry
    template and verification template;
  - saved views;
  - a **Gallery view** whose type filter defaults to Selfie + Government ID and which shows the
    images next to key details.
- **Gallery module** on account and case layouts (H28): a selfie verification contributes its center
  photo, and a list of capture objects contributes their center photos.
- **Inquiry review** (H30): tabs for Verifications (every attempt, collapsible), Sessions, Reports,
  List matches, Signals, and the event timeline.
- **Analytics** (H8): pass rate and volume per capture method (auto, manual, upload, combo) for
  selfie and ID verifications.
- **Simulation** (H44): in sandbox preview, the operator can toggle individual checks to fail. Only
  failures of required checks change the verification result.

---

## 8. Where OpenVerify stands today (read-only check of the repo, 2026-10-21)

- `packages/contracts/src/verifications.ts`:
  - `selfieVerificationAttributesSchema` carries only `status`, `checks` and timestamps;
  - check objects have no `category` field.
- `packages/contracts/src/events.ts`: no `selfie.*` events.
- `packages/checks/src/phase1/selfie-checks.ts`: `selfie_id_comparison` **fails** with
  `id_portrait_not_present` when no ID portrait exists. Persona reports `not_applicable` with
  `no_government_id`.
- `packages/contracts/src/inquiry-templates.ts`: the flow step already has `poses`, `liveness` and
  `maxAttempts`. The default is `poses: ['center']` and `liveness: 'passive'`, whereas Persona
  defaults to three poses.

---

## 9. Functional requirements for OpenVerify Phase 4

### 9.1 Must match

1. **Selfie verification attributes.** Extend `verification/selfie` with:
   - `capture-method` (`photo` | `video`, an open enum);
   - `center-photo-url`, `left-photo-url`, `right-photo-url`;
   - `photo-urls[]` of `{page: left_photo|center_photo|right_photo, url, filename, byte-size}`;
   - `video-url`;
   - `center-photo-face-coordinates` (four corners, normalised 0–1; our own documented choice);
   - `selfie-similarity-score-left` and `selfie-similarity-score-right`;
   - `document-similarity-score`;
   - `entity-confidence-reasons`;
   - `from-reusable-persona` (always `false` until Phase 11);
   - `submitted-at`, `completed-at`, `redacted-at`, `country-code` and `tags`.

   We define and document the score scale, which Persona leaves unstated. URLs are signed and
   short-lived, matching our file-access model.
2. **Separate capture object.** Model it with statuses `initiated` → `submitted` → `processed` |
   `errored` and a `processed-at` timestamp, linked to the inquiry. Add a `selfies` relationship
   on the inquiry. Use a capture-type discriminator with the values `center-only`,
   `profile-and-center` and `configurable-poses`.
3. **Events.**
   - Emit `selfie.created`, `selfie.submitted`, `selfie.processed` and `selfie.errored`, with the
     capture object as payload, through the existing signed-webhook pipeline.
   - Emit the full `verification.*` set for selfies. `verification.requires-retry` stays as a
     deprecated legacy event.
   - Sandbox simulation emits the six events in the order given in 1.5.
4. **Check object fields.**
   - Add `category` with values `biometrics` | `fraud` | `user_action_required` | `validity` | null.
     User-behaviour checks map to `user_action_required`.
   - Keep `requirement` able to carry `requires_retry`.
   - Keep `not_applicable` and `pending` as check statuses.
5. **Check ids and categories, exactly as observed.**
   - **Fraud:** `selfie_pose_detection`, `selfie_multiple_faces_detection`,
     `selfie_liveness_detection`, `selfie_pose_repeat_detection`, `selfie_id_comparison`,
     `selfie_account_comparison`, `selfie_age_comparison`, `selfie_public_figure_detection`,
     `selfie_suspicious_entity_detection`.
   - **User action required:** `selfie_image_quality_detection`, `selfie_glare_detection`,
     `selfie_face_covering_detection`, `selfie_glasses_detection`.
   - Heuristic implementations still ship as `stage: beta` with a confidence score (CLAUDE.md rule 5).
6. **Not-applicable semantics for comparisons.**
   - A comparison whose reference is missing returns `not_applicable` with a reason. It never
     returns passed, and it never returns failed:
     - `selfie_id_comparison`: `no_government_id`;
     - `selfie_account_comparison`: `no_account_selfie_present`;
     - `selfie_age_comparison`: `no_reference_birthdate`;
     - `id_selfie_comparison`: `no_selfie`.
   - A real mismatch is a `failed` result with its own reason.
   - Changing today's `id_portrait_not_present` failure to this behaviour needs an ADR.
   - That ADR must also settle a gap Persona leaves open: how a **required** check that comes out
     `not_applicable` affects the verification status. We propose "not passed" by default, to
     stay honest.
7. **Observed reason codes.** Adopt `too_much_glare` (glare) and `replica_detected` (liveness), and
   the `low_liveness_confidence` entity reason. Document every other reason code as OpenVerify's own.
8. **Template configuration.** Each selfie verification template supports:
   - pose mode (center only, or left/center/right);
   - compare-to (first passed ID, last passed ID, or last ID attempt), used by the ID and age
     comparisons;
   - per-check enabled and required flags;
   - photo or video mode;
   - capture methods per device class (desktop web, mobile web, native): camera only vs camera or
     upload;
   - autocapture on or off;
   - device handoff by email, SMS or QR, recorded on the session as `device-handoff-method`;
   - the retry count in the flow's branch.
9. **Defaults.**
   - Liveness enabled and required.
   - Three poses as the recommended preset.
   - Strict capture: a higher minimum resolution and a centred face.
   - Persona also enables and requires face-covering and suspicious-entity by default. Our versions
     are heuristic, so we enable them but do not require them, and record the deviation in the
     check-mapping doc.
10. **Ordering rules.**
    - `selfie_id_comparison` uses only an eligible ID verification that finished earlier in the
      same inquiry or transaction.
    - A government ID that follows the selfie runs `id_selfie_comparison` against that selfie.
    - A portrait-less source makes the comparison not applicable.
11. **Capture guidance.** The flow and the Android SDK detect and prompt for:
    - face not centred;
    - turn left, or turn right;
    - too close, or too far;
    - no face found (with a suggestion to remove glasses);
    - more than one face.

    All prompt wording is our own. User-behaviour check failures map to a retry hint.
12. **Camera floor.** Captures below 640×480 are refused. The user is offered device handoff, or
    upload where the template allows it.
13. **Biometric consent.** Any flow with a selfie step shows a consent-and-retention screen before
    the camera opens. The consent is stored with a timestamp and the template version, and is
    auditable.
14. **Redaction cascade.**
    - Redacting removes selfie images, video and face embeddings.
    - Redacted or unconsented selfies drop out of every similarity index (pgvector, lists, graph).
    - Any check that then lacks its biometric input reports `not_applicable`.
15. **Client events.** The web SDK and the Android SDK emit:
    - `selfie-camera-select` and `selfie-camera-capture` (per-file `pose` and `captureMethod`);
    - `selfie-record-upload`;
    - `load-camera-failed`;
    - `camera-permissions-check-result`.
16. **Dashboard verification view.**
    - The status header and a per-pose image strip.
    - The check table with status icons, type, the required flag (required checks listed first)
      and expandable metadata.
    - The selfie-to-ID row shows a risk level as well as our calibrated score.
    - The verifications list gets a Gallery view with a Selfie / Government ID type filter.
17. **Sandbox.**
    - Selfie verifications can be created in the sandbox.
    - Simulation is deterministic, and no models run.
    - The government ID verification's selfie-photo field can be populated, so integrators can test
      chaining into a selfie verification.

### 9.2 Nice to have

1. **Face lists.** The list type `face`, a bulk image importer (pending/ready/errored with success,
   duplicate and error counts, plus a consent precondition), and a workflow step that adds an
   inquiry's selfie to a face list. A match surfaces as a **list match** (inquiry tab, risk signal,
   workflow condition), not as a check. The list framework itself belongs to Phase 7, so Phase 4
   should only expose the embedding index and a match API it can use.
2. **Selfie-background list** and background-similarity matching.
   - Persona documents only the name. Our `selfie_similar_background_detection` and
     `selfie_repeat_detection` remain OpenVerify-only checks, labelled "ours" in the mapping table.
   - They are disabled or not required by default.
3. **`selfie_age_threshold_comparison`.** Estimated age against a configured threshold without an
   ID, as `beta`, with a configurable safety buffer (H15 suggests 2.5–3 years).
4. **Risk-level outputs**, alongside numeric scores:
   - a face comparison risk (Persona shows a level whose example value is `minimal`; we define the
     full level set ourselves);
   - a liveness risk level (low/medium/high);
   - a virtual-camera risk signal (low/medium/high), feeding workflow conditions.
5. **Escalation.** Asynchronous re-scoring after completion (for example, multi-frame video
   liveness) that emits `verification.escalated` and `inquiry.escalated` without changing the status.
6. **Correlated verifications.** Informational nearest-neighbour panel over the last 14 days within
   the same environment, labelled near-exact, strong, faint or none.
7. **Graph nodes.** Selfie similarity, image-background similarity, and camera fingerprint, for Phase 7.
8. **Component versions per verification.** Record which match, liveness and age model versions ran,
   in metadata or a dedicated attribute. Persona versions its components but does not expose the
   versions; for us it helps auditability and recalibration.
9. **Video mode with key frames.** Extract key frames for download, and keep audio off unless the
   template enables it.
10. **Capture-method analytics.** Pass rate per auto, manual, upload or combo capture.
11. **Selfie similarity module.** An "account similarity by selfie" panel on cases and accounts,
    limited to consented, non-redacted selfies.
12. **Biometric-only redaction endpoint** for a transaction or inquiry. Persona keeps its equivalent
    private.
13. **Persona-style per-pose theme pictograms** in theme sets (center, left, right).

### 9.3 Open questions (not settled by public material)

- The meaning and scale of `document-similarity-score` and `selfie-similarity-score-*`.
- The full reason-code list for each check, and its metadata keys.
- How a required check that comes out N/A affects the verification status.
- What `selfie_pose_repeat_detection`, `selfie_public_figure_detection` and
  `selfie_suspicious_entity_detection` actually test.
- The pose angles, whether pose order is randomised, and the timing rules.
- What `configurable-poses` allows.
- Whether the Get List Match step accepts face lists.
- The default biometric retention period.
