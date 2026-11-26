# Plan: Phase 3, government ID checks

**Source:** `docs/PLAN.md` §4.1 (the 36 government ID checks) and §6 Phase 3; ADR 0002 (tiers and honesty); `docs/research/phase3-libraries.md` and `docs/research/phase3-ocr-license.md` (libraries, models and licences).
**Complexity:** Large. Two Workflows: **3A** builds (contracts, vision, check logic, wiring, integration) and **3B** adds the console and client surfaces, then reviews and fixes.
**Review of this plan.** An adversarial review before any code was written found 15 problems: 3 CRITICAL, 8 HIGH and 4 MEDIUM. Among them:
- the happy-path card still carried specimen markers;
- a government ID in review would make the selfie fail;
- two proposed libraries break the licence policy.

This version addresses all 15.

## Summary

Phase 1 runs four government ID checks (`id_blur_detection`, `id_glare_detection`, `id_portrait_detection`, `id_double_side_detection`). Seven more exist as pure, tested functions that nothing calls. The rest answer `pending` with `not_implemented`. Phase 3 makes every §4.1 check real at its tier:
- **R:** real logic;
- **H:** a heuristic with a confidence, shipped as `beta`;
- **A:** an adapter with a deterministic sandbox provider.

To get there, Phase 3 adds:
- **Extraction:** document rectification, OCR of the visual zone, MRZ reading, PDF417 decoding and image forensics in the vision service. Vision returns measurements and raw text; every decision stays in TypeScript.
- **Honesty contracts:** confidence, provenance and stage on every result, and a `needs_review` outcome when a required check has no evidence (ADR 0002 §3).
- **Storage:** an encrypted extraction per government ID verification, a blind index of identification numbers and a perceptual hash. These serve the repeat and comparison checks.

## Patterns to mirror

| Category | Source | Pattern |
|---|---|---|
| Registry | `packages/core/src/check-registry.ts` (`defineCheck`, `CHECK_REGISTRY`) | One entry per check id; the stage is derived from the tier (H ⇒ `beta`); `configSchema` validates the template's per-check `config` |
| Check config | `packages/core/src/check-config.ts` | kebab-case keys with ranges, as the C11 table |
| Results | `packages/checks/src/result.ts` (`checkResult`, `parseCheckConfig`) | Pure functions return `CheckResult`; one `*.ts` + `*.test.ts` per check |
| Evaluation | `packages/checks/src/phase1/evaluate.ts` (`GOVERNMENT_ID_EVALUATORS`) | An evaluator per check id over typed inputs |
| Worker | `apps/api/src/jobs/process-verification.ts` (`evaluateGovernmentId`, `withThresholds`, `processVerification`, `idPortraitOf`) and `apps/api/src/worker.ts` (`processVerificationProcessor`, `isLastAttempt`, `failVerificationAfterError`) | Vision gives raw scores; the worker applies template thresholds, evaluates, decides, persists with `replaceVerificationChecks`, then settles the inquiry |
| Reason contract test | `apps/api/src/jobs/phase1-contract.test.ts` | The API package depends on both `@openverify/checks` and `@openverify/contracts`, so the test that ties evaluators to the published reason list lives there |
| Vision contract | `services/vision/src/openverify_vision/schemas.py` (`_Contract`, frozen, `extra="forbid"`) and `apps/api/src/vision/schemas.ts` (strict zod) | Both sides change together; golden `contracts/fixtures/vision/*.json` written by `tools/make_contract_fixtures.py` and parsed by both |
| PII at rest | `packages/db/src/crypto.ts` (the `encrypted` column helper) | Envelope encryption under `OPENVERIFY_KEK`; redaction enumerates every PII table |
| Errors | RFC 9457 problems (`apps/api/src/problems*`, vision `problems.py`) | Typed codes, no PII in errors or logs |
| Tests | Vitest colocated; pytest `services/vision/tests/`; Testcontainers `*.integration.test.ts` (pools from `createIntegrationPool`); Playwright `e2e/tests/*.spec.ts` | RED commit first; ≥80% per package; `docs/tdd/<slice>.tdd.md` holds the evidence |

## Locked contracts

C1–C28 (Phases 1 and 2) stay locked except where a C-section below amends them. Every amendment is additive for API clients (earlier answers still parse) unless it says otherwise.

### C29. Check results, the registry and reasons (amends C2, C7, C11; ADR 0002 §2, §3c, §3f)

1. **Registry.** Each entry gains:
   - `version`: a positive integer, 1 for every check today. An implementation change that can change a decision bumps it.
   - `modelBased`: true when the decision rests on a model's output, for example YuNet, SFace or OCR confidence. ADR 0002 §3f lets a model-based R-tier check reach `ga` only with a FAR/FRR calibration report, which Phase 4 builds. Until then a model-based check derives `stage: beta`. This changes `id_portrait_detection`, `selfie_multiple_faces_detection`, `selfie_id_comparison`, `id_selfie_comparison`, `id_mrz_detection` and `id_portrait_clarity_detection` to `beta`, which is honest, and is listed in the owner decisions.
   - `inputs`: a subset of `upload`, `vision`, `extraction`, `history` and `provider`. The worker uses it to decide which checks a failure leaves without evidence (C30.3), before any evaluator runs.

   A registry test asserts that every §4 id has `id`, `tier`, `type`, `stage`, `version`, `modelBased` and `inputs`, and that H, A/H and model-based entries are `beta`.
2. **Result fields.** The core `CheckResult`, written by every evaluator, gains three fields, all **required** (ADR 0002 §4f):
   - `stage`;
   - `confidence`: a number in [0, 1] or `null`;
   - `provenance`:
     ```json
     { "implementation-version": 1,
       "models": [{ "id": "yunet-2026may", "sha256": "…" }],
       "provider": { "id": "sandbox", "sandbox": true },
       "thresholds": { "min-blur-score": 100 } }
     ```
     `models` and `provider` are present only when used. `thresholds` lists every threshold the result was judged against, after template config was applied.

   Further rules:
   - **Confidence.** An H-tier result that is `passed` or `failed` carries a confidence. A `not_applicable` result may carry `null`.
   - **API read schema.** The check object (`verificationCheckSchema`) has the same three fields as **optional**, so stored Phase 1 and 2 rows still parse. For those rows the API fills `stage` from the registry, and `confidence` and `provenance` are `null`.
   - **Storage.** `verification_checks` gains `stage text`, `confidence real` and `provenance jsonb` (one migration).
   - **`selfie_id_comparison`.** It keeps writing `metadata.confidence` and `metadata.confidence_stage` (deprecated, documented, kept so stored rows, fixtures and `verification-completes.spec.ts:93` keep working). It also fills the new fields.
3. **Metadata never holds PII.** It may name fields (`"disagreeing-fields": ["birthdate"]`, `"corrected-fields": ["identification-number"]`) and hold scores and counts, never extracted values, OCR text or embeddings.
4. **Reasons.**
   - `packages/contracts/src/government-id-check-reasons.ts` exports `GOVERNMENT_ID_CHECK_REASONS`: for every government ID check, the reason codes it may emit. It is the successor of `PHASE1_CHECK_REASONS`, which stays as a subset.
   - Stage 1 creates the file with the shared reasons; `checks-logic` then owns it.
   - `apps/api/src/jobs/government-id-contract.test.ts` asserts that every evaluator emits only listed reasons (as `phase1-contract.test.ts` does).

   The shared reasons:

   | Reason | Status | Blocks a required check? | Meaning |
   |---|---|---|---|
   | `feature_absent` | `not_applicable` | no | The established document class has no such feature (C30.2) |
   | `not_requested` | `not_applicable` | no | The flow did not ask for the input, for example the back of a card on a `sides: front` step |
   | `input_missing` | `not_applicable` | yes (review) | An input the check needs could not be obtained or the class could not be established |
   | `no_reference_data` | `not_applicable` | yes (review) | A comparison has nothing to compare with |
   | `execution_error` | `not_applicable` | yes (review) | The check could not run after the job's retries |
   | `provider_not_configured` | `not_applicable` | yes (review) | An A-tier check without a provider in this environment (ADR 0002 §3e) |
   | `image_unreadable` | `failed` | (failed) | Unchanged from Phase 1 |

   Every `user_behavior` reason has English and Spanish strings in the web flow (`apps/flow/src/i18n/locales/{en,es}.ts`, `retry.reasons.*`) and a message on Android (`ui/Messages.kt`; it also gains the missing `image_unreadable`).
5. **Config.**
   - Every check with a threshold or an option gets a registry `configSchema` with kebab-case keys (C11 style).
   - The camelCase option schemas of the existing pure functions become internal and are no longer what templates validate.
   - Existing keys keep their meaning: `min-blur-score` and `max-glare-ratio` still judge the whole image, as in Phase 1. The rectified-document measures get new keys.

   Initial keys (an agent may add one, recording it here as an amendment):

   | Check | Config |
   |---|---|
   | `id_blur_detection` | `min-blur-score` (whole image, existing), `min-document-blur-score`, `min-document-tenengrad`, `min-document-width-px` |
   | `id_glare_detection` | `max-glare-ratio` (whole image, existing), `max-document-glare-ratio` (text and portrait regions of the rectified document) |
   | `id_portrait_clarity_detection` | `min-face-width-px`, `min-sharpness` |
   | `id_expired_detection` | `grace-days` (0–365, default 0) |
   | `id_valid_dates_detection` | `max-validity-years` (1–20, default 15) |
   | `id_age_comparison` | `min-age`, `max-age` (0–150; at least one when the check is enabled with config) |
   | `id_extracted_properties_detection` | `required-fields`: a list of C31 field names (default `name-first`, `name-last`, `birthdate`, `identification-number`, `expiration-date`) |
   | `id_inquiry_comparison`, `id_account_comparison` | `name-threshold` (0.5–1, default 0.88), `fields`: a list of `name`, `birthdate`, `address`, `identification-number` |
   | `id_selfie_comparison` | `threshold` (0.25–0.6), as `selfie_id_comparison` |
   | `id_repeat_detection` | `max-phash-distance` (0–7; the default comes from calibration, see C34) |
   | Each H-tier check | its decision threshold (for example `max-tamper-score`), 0–1 |

   **Country and class allowlists.** `id_disallowed_country_detection` and `id_disallowed_type_detection` enforce, in order:
   1. the verification type's `allowed-countries` and `allowed-id-classes` (C11);
   2. when those are absent, the flow step's `allowedCountries`/`allowedIdClasses`;
   3. when neither is set, any country or class.

   In every case they pass only once the country or class was established from the document.
6. **The existing pure functions** move to the shared reasons:

   | Function | Outcome today | Outcome from Phase 3 |
   |---|---|---|
   | `id_age_comparison` | `failed` `birth_date_not_present` | `not_applicable` `input_missing` |
   | `id_disallowed_country_detection` | `failed` `issuing_country_not_present`; `not_applicable` `country_policy_not_configured` | `not_applicable` `input_missing`; with no allowlist, `passed` once established |
   | `id_disallowed_type_detection` | `failed` `id_class_unknown`; `not_applicable` `id_class_policy_not_configured` | `not_applicable` `input_missing`; with no allowlist, `passed` once established |
   | `id_valid_dates_detection` | `not_applicable` `dates_not_present` | `not_applicable` `input_missing` |
   | `id_expired_detection` | `not_applicable` `expiration_date_not_present` | `feature_absent` for a class the C33 feature table marks as having no expiry, otherwise `input_missing` |
   | `id_mrz_inconsistency_detection` | `not_applicable` `mrz_not_present` | `feature_absent` for a class without an MRZ, otherwise `input_missing` |
   | `id_double_side_detection` | `not_applicable` with no reason (single-sided step) | `not_applicable` `not_requested` |

### C30. Decisions and review (amends C7 and C10; ADR 0002 §3a, §3b)

1. **`decideVerification`** returns `passed`, `failed`, `needs_review` or `pending`. Over the enabled, required checks:
   1. any `failed` → `failed`. It is retryable when every failing required check is `user_behavior` (unchanged);
   2. else any `pending` or missing result → `pending` only when the caller says more results will come (an asynchronous provider; none exists in Phase 3); otherwise → `needs_review`;
   3. else any `not_applicable` with a reason outside the non-blocking set (`feature_absent`, `not_requested`) → `needs_review`;
   4. else `passed`.

   Enabled checks that are not required stay advisory: they never change the decision.

   This replaces the Phase 1 rule that an unimplemented required check keeps the verification undecided: it now goes to review.
2. **`feature_absent` needs an established class and a feature-table row.**
   - **Established class.** The class must come from the document itself: an MRZ document code, an AAMVA header, or keywords together with the layout. A class taken only from the user's choice is not established.
   - **Feature-table row.** The (issuer, class) pair must have a row in the C33 feature table.
   - Otherwise class-dependent checks answer `input_missing`.

   **ADR 0002 amendment (Phase 3, for the owner to confirm).** §3b gets a clarification: a required check that is `not_applicable` only because the established class lacks the feature (`feature_absent`), or because the flow did not ask for it (`not_requested`), does not block. Any other `not_applicable` or `pending` still routes to review.
3. **Execution errors.**
   - **The last attempt.** The processor passes `{ lastAttempt }` (from `isLastAttempt`, `apps/api/src/worker.ts`) into `processVerification`.
   - **Vision or provider failures.** A failure on a vision call (network, 5xx, `inference_failed`) or a provider call:
     - throws before the last attempt, so BullMQ retries (unchanged);
     - on the last attempt, records every check whose registry `inputs` include `vision` (or `provider`) as `not_applicable`/`execution_error`, and every check that needs `extraction` as `input_missing`. The verification then decides by rule 1.3.
   - **Contract violations.** A vision response that breaks the contract (`VisionResponseError`, not retryable) is recorded the same way at once.
   - **Unreadable images.** Vision's 413/415/422 keep the Phase 1 `image_unreadable` path.
   - **Other failures.** `failVerificationAfterError` stays only for failures that are not vision or provider failures (for example a file deleted by a concurrent redaction).
   - **The selfie job** follows the same rule for its own checks.
4. **Verification status `needs_review`** (new, additive in `VERIFICATION_STATUSES`).
   - Migration: `ALTER TYPE verification_status ADD VALUE 'needs_review'`, run outside a transaction or in its own migration, as Postgres requires before the value is used.
   - It is entered from `submitted` and is terminal for the verification: the operator decides the inquiry. It emits no verification event; the inquiry's `inquiry.marked-for-review` announces it. The dashboard labels it "Needs review".
   - `idPortraitOf` (`process-verification.ts`) accepts a government ID that is `passed`, `submitted` or `needs_review`, so a selfie can still be compared with an ID under review. It embeds the stored front with `/v1/embed/face` instead of the full analysis, which would rerun OCR and forensics for every selfie.
5. **The inquiry.** When every verification the flow requires has a final decision and none failed after its last attempt:
   - all passed → `completed`, as now;
   - otherwise → `completed`, then `needs_review` in the same transaction. Events are emitted in that order: `inquiry.completed`, then `inquiry.marked-for-review`.

   An inquiry is never approved automatically.
6. **Clients.** A `needs_review` verification counts as done. The web flow (`flow-position.ts`) and Android (`VerificationStatus.NEEDS_REVIEW`, final for polling) move to the next step without retry hints; the user sees the normal completion screen.
7. **The test issuer.** Utopia (`UTO`) is the specimen state of ICAO 9303 Part 3. OpenVerify treats it as its documented **sandbox test issuer**:
   - **In a sandbox environment:**
     - a UTO document has a feature-table row (TD1, TD3 and MRV-A layouts: MRZ yes, PDF417 no, expiry yes);
     - its `country` stays `null`, because UTO has no alpha-2 code;
     - the country check passes when no allowlist is set, and fails against any alpha-2 allowlist.
   - **In a production environment,** a UTO document fails `id_compromised_detection` with `specimen_issuer`.

   The rule is in `docs/checks/government-id.md`. It is the only issuer-specific behaviour, and it exists so integrators can test without real documents.

### C31. Extraction (new; PII)

1. **Sources and parsing.** The worker builds one extraction per government ID verification from three sources; NFC joins in Phase 5. Every parser lives in `packages/checks`:
   - the **MRZ** (`parseMrz`, extended with MRV-A/B);
   - the **barcode** (a new AAMVA parser);
   - the **visual zone (VIZ)**, through a new label-anchored parser over the OCR lines and their boxes. It finds a label from an English, Spanish, French and German dictionary (for example "Surname", "Given names", "Date of birth", "Document no.", "Expiry"), then takes the value below or to the right of it. Dates and document numbers are also found by pattern when no label is read.
2. **Consolidation.** `consolidateExtraction(sources)` returns the consolidated fields and, per field, which sources gave it and whether they agree. Precedence: a check-digit-valid MRZ, then the barcode, then the VIZ.

   Agreement rules, shared by every check that compares sources:
   - **An absent field is never a mismatch.**
   - **Dates and numbers** compare exactly after confusable mapping in their positions (`O`↔`0`, `I`↔`1`, `S`↔`5`, `B`↔`8`, `Z`↔`2`).
   - **Names** compare after ICAO transliteration and normalization, with Jaro-Winkler ≥ 0.92 per token (`compareNames`).
   - **A field disagrees** only when two sources read it and still differ under these rules.
3. **OCR correction limits** (honesty):
   - The MRZ parser may correct only characters impossible for their position: a letter where the format needs a digit, or a digit where it needs a letter. It corrects at most one character per field, never digit↔digit or letter↔letter.
   - Every corrected field is named in check metadata (`corrected-fields`), and counts as evidenced only if the VIZ agrees with the corrected value.
   - A check-digit failure that needs any other change stays a failure.
4. **Who compares what:**
   - **`id_mrz_inconsistency_detection`:** the check digits, and MRZ↔VIZ agreement. It needs at least 2 of `identification-number`, `birthdate`, `expiration-date` and `name-last` read by both. Otherwise the agreement part answers `input_missing`, since valid check digits alone do not show agreement with the printed card.
   - **`id_extraction_inconsistency_detection`:** agreement across every pair of sources present (VIZ, MRZ, barcode). It needs at least two sources with at least 2 common fields, otherwise `input_missing`.
5. **Fields.** The `verification/government-id` resource gains these attributes, each nullable:
   - **Name:** `name-first`, `name-middle`, `name-last`;
   - **Person:** `birthdate` (`YYYY-MM-DD`), `sex` (`M`, `F`, `X`);
   - **Nationality:** `nationality`, the raw three-letter ICAO code, for example `UTO`, `D` normalized to `DEU`, `GBR`;
   - **Document:** `identification-number` (the document number), `personal-number`, `issue-date`, `expiration-date`, `issuing-authority-code` (the raw ICAO or AAMVA issuer code, for example `UTO` or `636014`);
   - **Address:** `address-street-1`, `address-street-2`, `address-city`, `address-subdivision`, `address-postal-code`, `address-country-code` (ISO alpha-2 or `null`);
   - **AAMVA:** `endorsements`, `restrictions`, `vehicle-class`;
   - `extraction-sources`: per field, the sources that agreed, for example `{"birthdate": ["mrz", "viz"]}`. Field names only, never values.

   The existing `country` (ISO alpha-2, `^[A-Z]{2}$`) and `id-class` attributes are set from the extraction when the user did not choose them. `country` stays `null` for an issuer without an alpha-2 code (C30.7).
6. **Exposure.** These are PII:
   - masked for API keys stored `pii-masked` (2B F001);
   - "Hidden" in the console without `pii:view`;
   - `null` after redaction;
   - never in the flow API, logs, check metadata or problems.

   Event payloads that carry the verification follow the 2B F005 subject-id rules, so redaction clears them.
7. **Storage.** A table `government_id_extractions`, one row per verification:
   - `fields`: encrypted with the `encrypted` helper;
   - `field_sources`: plain JSON, names only;
   - `identification_number_index`: an HMAC-SHA-256 blind index;
   - `front_phash`: a 64-bit perceptual hash, with banded lookup columns;
   - `redacted_at`, `created_at`.

   **Redaction** sets `fields`, `identification_number_index`, `front_phash` and its bands to `null`. The redaction-coverage test that seeds every PII table gains this one. **Retention** redacts as it does today (2A C16), so the row follows its inquiry.
8. **Blind index.**
   - It is computed as `HMAC-SHA-256(key, "<issuing-authority-code>|<class group>|<number>")`, with the number uppercased and stripped to `[A-Z0-9]`, and scoped by environment.
   - The key comes from a new `OPENVERIFY_BLIND_INDEX_KEY`: base64 of 32 bytes, with a `change-me-…` placeholder in `.env.example`, validated at startup.
   - Changing the key needs `pnpm --filter @openverify/api blind-index:rebuild`, which decrypts and re-indexes every row that is not redacted.
9. **No embeddings at rest.** Phase 3 stores no face embeddings, keeping C6's policy.
   - `id_inconsistent_repeat_detection` re-embeds an earlier candidate's front through `/v1/embed/face`, only while the candidate's files exist. When they do not (redacted or deleted), it compares names and birthdates only and records `face-compared: false`. It never fails the current verification because an old file is gone.
   - Phase 4 decides on an embeddings index for selfie repeats and face galleries.

### C32. Vision: government ID analysis v2 (amends C6)

1. **The response.** `POST /v1/analyze/government-id` keeps every Phase 1 field. Each side gains:
   - `document`:
     ```
     { found, quad: [[x,y]×4] | null, method: "contour" | "lines" | "full_frame" | "none",
       rectified_size: [w, h] | null, aspect_ratio, area_ratio }
     ```
     It comes from the OpenCV-only detector in research §4. A quad counts only with `area_ratio` ≥ 0.3 and an aspect ratio within 12% of ID-1 (≈1.586) or TD3 (≈1.42). Otherwise, when the whole frame has such an aspect ratio, the frame is the document (`full_frame`), as with a tightly cropped upload. Otherwise `found` is false.
   - `document_quality`, measured on the rectified document:
     ```
     { blur_score, tenengrad, width_px, height_px, glare_ratio_text, glare_ratio_portrait }
     ```
   - `text`: the visual-zone OCR lines on the rectified document, `[{ text, confidence, box, stroke_width_mean, stroke_width_cv }]`. At most 200 lines of 200 characters.
   - `mrz`:
     ```
     { found, format_guess: "TD1" | "TD2" | "TD3" | "MRVA" | "MRVB" | null,
       lines: [string], line_confidences: [number], box }
     ```
     Lines are restricted to `[A-Z0-9<]`; parsing and check digits are TypeScript's job.
   - `barcodes`: `[{ format, bytes_b64, text, quad }]` from `zxing-cpp`, with `text_mode=Plain` and the raw bytes. The HRI text gotcha is in research §1.
   - `portrait_clarity`: `{ face_width_px, sharpness, landmarks_score } | null`.
   - `forensics`:
     ```
     { exif: { software, make, model, has_gps },
       jpeg: { quality_estimate, standard_tables, double_compression_score },
       ela_score, moire_score, screen_grid_score,
       chroma: { mean_saturation, colorfulness },
       color_cast_score, copy_move_score, portrait_boundary_score,
       star_glyph: { found, score, box } }
     ```
     `exif` never carries GPS values. `star_glyph` is the REAL ID star in the upper part of the card (§4.1). Every score is raw and in [0, 1] where possible.
   - `phash`: 16 hex characters, the DCT perceptual hash of the rectified document.

   `model_versions` gains `text_detector` and `text_recognizer`.
2. **Decisions stay in TypeScript.** Vision returns measurements and raw text only.
   - Thresholds and decisions live in `packages/checks`, applied by the worker, as in C6/C11.
   - `id_fabrication_detection` scores layout conformance in TypeScript from the quad, the text boxes, the MRZ box and the portrait box, against the ICAO geometry for MRZ classes.
   - `id_double_side_detection` adds two tests to the Phase 1 SHA-256 comparison:
     - the front-to-back pHash distance, so a re-encoded front reused as the back is caught;
     - the presence on the back of the feature the class expects (MRZ for TD1, PDF417 for AAMVA).
3. **Errors** (vision carry-overs, Phase 1 review):
   - 1B F021: an inference failure answers a typed 500 problem (`code: inference_failed`). The worker treats it as retryable, then as `execution_error`.
   - 1B F022: the service token is checked before the multipart body is parsed.
4. **Budget.** Analysing both sides of a 1,600-pixel card has a median of at most 5 s over 10 runs on the development machine's CPU.
   - The `integration` agent measures it with a committed benchmark script and records the CPU model.
   - The CI vision job runs the same benchmark and logs it.
   - If the budget is exceeded, the agent records the per-stage breakdown as a blocker. It does not raise the budget.
5. **Privacy.** OCR text is PII. Vision never logs it, and the API never stores raw OCR lines, only the C31 extraction.

### C33. Libraries, models and data (research §0–§7)

- **Python runtime:** `zxing-cpp==3.1.1` (Apache-2.0, zint BSD-3). Verify its licence at the pinned version, and list it in `THIRD_PARTY_LICENSES.md`.
- **Not `pyclipper` or `shapely`.** `pyclipper` vendors Clipper under the Boost Software License, which rule 4 does not list. `shapely`'s wheels bundle GEOS (LGPL-2.1). The vendored DB post-processing expands boxes with OpenCV (`cv2.contourArea`, `cv2.arcLength`, `cv2.minAreaRect`) and NumPy instead.
- **Python dev:** `pdf417gen==0.8.1` (MIT) and `iso3166==3.0.0` (MIT) for the generators.
- **TypeScript dev:** `mrz@5.0.2` (MIT), only as a cross-oracle in `packages/checks` tests.
- **No Kotlin dependency changes.**
- **OCR.**
  - Vendor RapidOCR's Apache-2.0 detection and recognition pre- and post-processing (DB box post-process, CTC decode) into `services/vision`, with a NOTICE, on the existing `onnxruntime`. Do not add the `rapidocr` package, which brings MPL runtime dependencies.
  - Models: PaddlePaddle's official PP-OCRv6 small detection and recognition ONNX files (`PaddlePaddle/PP-OCRv6_small_det_onnx` @ 28fe589, `PP-OCRv6_small_rec_onnx` @ b8f84f0, apache-2.0), plus the recognizer's character dictionary. Each is pinned by URL at a commit and SHA-256 in `models/manifest.json` and fetched by `scripts/fetch_models.py`.
  - **Pre-approved fallback.** If PP-OCRv6 small misreads the synthetic MRZ or VIZ beyond the C31 tolerances, `vision-ocr` switches the recognizer to RapidOCR's ONNX conversion of `en_PP-OCRv5_mobile_rec`. Its licence chain is recorded in `docs/research/phase3-ocr-license.md`: Apache-2.0 weights from PaddlePaddle, converted by an Apache-2.0 project, pinned by SHA-256. The switch and both measurements go in the TDD file. Anything beyond that is a blocker for the owner.
- **Data tables** in `packages/checks/src/data/`, the only copy; Python never duplicates check logic:
  - **Countries:** an ISO 3166-1 table (alpha-2, alpha-3, numeric), generated by a committed script from `iso3166` and overlaid with the 26 ICAO Part 3 §5 codes (cited). It replaces `country-codes.ts`'s hand table.
  - **AAMVA IINs:** hand-curated, 72 IINs with the source URL, the retrieval date, and the corrected Colorado code.
  - **Identification-number grammars:**
    - all 50 US states and DC for driver licences;
    - the ICAO document-number rules, which apply to every MRZ document whose issuer has no national grammar (so a Utopia card is judged by them);
    - at least 15 national-ID checksums (for example ES DNI/NIE, IT codice fiscale, NL BSN, BE national number, PL PESEL, SE personnummer, FI HETU, NO fødselsnummer, PT CC, BR CPF, CL RUT, ZA ID, IN Aadhaar Verhoeff, CN resident ID ISO 7064), each with its source.
  - **Specimen markers (frozen).** Whole-word, case-insensitive, accents folded:
    - `SPECIMEN`, `ESPECIMEN`, `SAMPLE`, `MUSTER`, `ECHANTILLON`, `CAMPIONE`, `FACSIMILE`, `MODELO`, `VZOR`, `WZOR`, `NAYTE`, `PROVE`, `VOID`, and the phrase `NOT A REAL DOCUMENT`;
    - the document numbers of the published ICAO 9303 examples.

    `TEST` and `SYNTHETIC` are not markers. Keywords are matched only in OCR text outside the extracted field values, so a holder named Sample is not flagged. A change to the list is a plan amendment.
  - **Feature table:** which (issuer, class) pairs carry an MRZ, a PDF417 and an expiry date:
    - every ICAO passport (TD3) and visa: an MRZ, no PDF417;
    - AAMVA jurisdictions' driver licences and ID cards: a PDF417 and no MRZ;
    - TD1/TD2 cards only per issuer that the table lists;
    - UTO as the sandbox test issuer (C30.7).

    An issuer and class with no row answers `input_missing` for feature-dependent checks.

  Write each table ourselves; never paste a standard's text (the AAMVA standard is © AAMVA).
- **Cross-language vectors.**
  - `contracts/fixtures/mrz/*.json` holds valid and invalid TD1/TD2/TD3/MRV lines with their expected check digits and fields.
  - `contracts/fixtures/aamva/*.json` holds AAMVA payloads, valid and invalid, with the expected parse.
  - Stage 1 seeds both with a few vectors from the published examples; `checks-logic` owns and extends them. The TypeScript parsers, the Python generator and Kotlin `Mrz.kt` (in Workflow 3B) test against them.
- **Licences.** The `opencv-python-headless` wheel's bundled LGPL libraries remain the open owner decision of research §6. Phase 3 adds no LGPL, GPL or unlisted licence.

### C34. Repeat and comparison inputs

- **`id_repeat_detection`.** In the same environment, it looks for an earlier extraction that is not redacted, whose inquiry belongs to another account, and that either:
  - has the same `identification_number_index`; or
  - has a `front_phash` within `max-phash-distance`.

  The pHash lookup must use an index and must not miss any match within the configured distance (banding by the pigeonhole principle; the EXPLAIN goes in the TDD file).

  Two different cards of one design can be close in pHash, because the layout dominates the low frequencies. The calibration report measures the distance between distinct synthetic cards of the Utopia design, and between re-encodings of one card. The default `max-phash-distance` must sit between the two, or the pHash half of the check ships disabled and the report says why.
- **`id_inconsistent_repeat_detection`.** Same blind index, but a different name or birthdate (decrypted for those candidates only), or a different face (re-embedded while the files exist, C31.9).
- **`id_inquiry_comparison` and `id_account_comparison`.** They compare the extraction with the inquiry's `fields` and the account's `fields`, using the snake_case keys of `DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA` and the C31.2 rules. Addresses are normalized. With nothing to compare, the answer is `no_reference_data`.
- **`id_selfie_comparison`.** It uses the inquiry's newest selfie verification that exists when the government ID is processed. Otherwise it answers `input_missing`.
  - In the default flow (ID before selfie) that is always the case, which is why it stays optional, as C7 says. `selfie_id_comparison` covers the pair.
  - `docs/checks/government-id.md` says so.

### C35. Adapters and sandbox providers (A-tier; ADR 0002 §3d, §3e)

- **Ports:** `id_aamva_database_lookup`, `id_public_figure_detection` and `id_age_inconsistency_detection` get provider ports in `apps/api/src/ports.ts`, beside the vision port.
- **Binding:** each provider is bound per environment kind through configuration, for example:
  - `OPENVERIFY_PROVIDER_AAMVA_SANDBOX=sandbox`;
  - `OPENVERIFY_PROVIDER_AAMVA_PRODUCTION` unset.
- **Sandbox in production refused:** binding `sandbox` to production fails startup, with a configuration test.
- **Not configured:** without a provider, in either environment, the check answers `provider_not_configured`.
- **Sandbox providers are deterministic.** Documented magic values decide the outcome, for example an identification number ending in `0000` gives a database mismatch. Results carry `provider: { id: "sandbox", sandbox: true }`. The magic values are documented in `docs/checks/sandbox-providers.md`.
- **No real adapters.** Phase 3 ships no AAMVA DLDV client, no age model and no face gallery:
  - the AAMVA membership and a permissive age model do not exist here;
  - a public-figure gallery needs stored embeddings, which Phase 4 and the Phase 7 face lists decide.

  The ports and docs say how to add one.
- **Defaults:** A-tier checks stay disabled by default (registry `defaultEnabled` false).

### C36. Default template, synthetic fixtures and calibration

- **Default template** (`DEFAULT_TEMPLATE` and `defaultInquiryTemplateAttributes` in `packages/contracts/src/inquiry-templates.ts`, `contracts/fixtures/flows/default-gov-id-selfie.json`, `seed:dev`):

  | Group | Checks | Default |
  |---|---|---|
  | Image and capture | unprocessable, blur, glare, double side, portrait, portrait clarity | required |
  | MRZ | MRZ detection, MRZ inconsistency | required (`feature_absent` for an established AAMVA document) |
  | Extraction and logic | extracted properties, extraction inconsistency, number format, expired, valid dates, disallowed country, disallowed type, compromised | required |
  | Barcode | barcode detection, barcode inconsistency, REAL ID | enabled, not required: most national ID cards have no feature-table row, so requiring them would send those cards to review. Operators accepting US and Canadian licences should require them, and `docs/checks/government-id.md` says so |
  | Comparisons and repeats | inquiry, account and selfie comparisons; repeat and inconsistent repeat; age comparison; PO box | enabled, not required. The repeat checks are advisory because every e2e spec and every developer submits the same synthetic card |
  | H-tier | all | enabled, not required (beta, advisory) |
  | A-tier | all | disabled |

  Every change to the seeded template is a new template version, so existing inquiries keep theirs.
- **Synthetic generator** (`services/vision/tools/`).
  - **Issuer.** Cards render only for the fictional issuer Utopia (`UTO`), never a real jurisdiction's design, name or seal.
  - **AAMVA payloads** are written as text vectors (`contracts/fixtures/aamva/`) and as barcode-only images on a plain background, for fictional people. They are never drawn onto a card, and each carries a jurisdiction-specific subfile marking it as OpenVerify synthetic test data.
  - **Faces** come only from the public-domain set in `fixtures/manifest.json`.
  - **The happy-path card** carries no specimen marker. Every marker on today's card changes:
    - the surname `SAMPLE` (also in the MRZ);
    - "SPECIMEN" in the header of both sides;
    - the banner "SPECIMEN - NOT A REAL DOCUMENT";
    - the authority "UTOPIA SPECIMEN AUTHORITY";
    - the document number `SPEC12345`;
    - the address "1 SAMPLE STREET".

    The holder's name is fictional and is neither a marker nor an ICAO example person. The banner reads "OpenVerify synthetic test card".
  - **Variants.** Each has the check it must trip:
    - specimen-stamped;
    - expired;
    - bad MRZ check digit;
    - MRZ and VIZ disagree;
    - issued after expiry;
    - under-age;
    - PO box address;
    - blurred, glare, low resolution;
    - grayscale photocopy;
    - screen recapture (a moiré and pixel-grid simulation);
    - portrait swap (with a different JPEG history);
    - copy-move;
    - a handwritten field;
    - front reused as back (re-encoded);
    - no portrait;
    - not an ID;
    - the card photographed on a background (for the quad detector);
    - a TD3 passport page;
    - an MRV-A visa.
  - **Versioning.** The generator has a version constant. `e2e/setup/stack.ts` regenerates `fixtures/generated/` when the stamp it writes there differs, so a local run never keeps an old card.
  - **Determinism.** Fixtures are seeded and gitignored. Tests assert properties, not hashes.
- **Calibration.**
  - `tools/calibrate_government_id.py` runs every variant through the analysis and writes the raw measurements as JSON.
  - `packages/checks/scripts/calibration-report.ts` reads that JSON, computes every check's score and composite score (tamper, entity and so on) with the real evaluators, and writes `docs/calibration/government-id-phase3.md`: per variant, the measurements, the scores, the default thresholds chosen and their margins.
  - The C29.5 defaults come from it. The report states plainly that it covers synthetic fixtures only, so every H-tier check stays `beta` (ADR 0002 §3f).
  - This closes the Phase 1 carry-over "calibrate the blur and glare thresholds".
- **End-to-end** (the e2e stack runs in the sandbox environment, whose seeded API key is a sandbox key).
  - `verification-completes.spec.ts` moves from `PHASE1_CHECKS` to the C36 default set. It asserts:
    - every required check `passed`, or is `not_applicable` with only a non-blocking reason;
    - the advisory H-tier results carry `stage: beta` and a confidence;
    - the extraction attributes equal the synthetic holder's.
  - New full-stack specs:
    - an expired card fails without a retry;
    - a blurred card gets a retry hint;
    - a specimen-stamped card fails `id_compromised_detection`;
    - a template requiring an A-tier check whose provider the e2e stack leaves unbound ends with the inquiry in `needs_review`, and its selfie still compares with the ID portrait.

### C37. Console and client surfaces (Workflow 3B)

- **Dashboard** (`verification-card.tsx`, `verification-view.tsx`, `status-badge.tsx`):
  - a **Beta** badge for `stage: beta`;
  - the confidence;
  - `not_applicable` reasons in words, and "not configured" for `provider_not_configured` (ADR 0002 §3e);
  - the `needs_review` status;
  - the extraction fields on the verification page ("Hidden" without `pii:view`, "Redacted" after redaction), with their sources.

  The template editor validates the new check configs through the API.
- **Web flow and Android:**
  - the new `user_behavior` reasons, in English and Spanish;
  - `needs_review` handled as done (C30.6).
- **Kotlin MRZ vectors.** `Mrz.kt`'s check digit is tested against `contracts/fixtures/mrz/`.
- **Not in Phase 3:** in-browser PDF417 pre-checks (`zxing-wasm`) and on-device decoding (`io.github.zxing-cpp:android`) belong to the capture work of Phase 4 and Phase 10.

### C38. Carry-over into Phase 3

| Item | From | Owner |
|---|---|---|
| Lock gaps: `submitVerification` checks the inquiry outside its transaction; `resumeInquiry` creates a session without locking the inquiry; add/remove-objects locks accounts and inquiries in a different order than inquiry creation | 2B F015, F016, F025 | `api-wiring` (3A) |
| Vision inference errors become a generic 500; token checked after the multipart parse | 1B F021, F022 | `vision-document` (3A) |
| The 53 older descending list-index columns are `NULLS LAST` while lists order `DESC` (a migration recreating them `DESC NULLS FIRST`, with EXPLAIN evidence) | 2E follow-up | `api-wiring` (3A) |
| The event fixtures `api/event-inquiry-approved.json` and `api/webhook-event-inquiry-completed.json` lack the `inquiry-template-version` relationship | 2E follow-up | `api-wiring` (3A) |
| No shared flow submit helper in `e2e/tests/support/platform.ts` | 2E follow-up | `integration` (3A) |
| MRV visas and national ID layouts in fixtures and parsing | Phase 1 carry-over | `checks-logic` and `fixtures` (3A) |
| E002: the F010 browser test's guard cannot fail | 2E review | `surfaces-clients` (3B) |
| E003: `/api-keys` reports a bad custom expiry and bad key attributes one at a time | 2E review | `surfaces-dashboard` (3B) |
| `FlowRenderer`'s retry after a failed session load loses focus | 2E follow-up | `surfaces-clients` (3B) |
| Both clients retry a create whose 2xx answer had an unexpected body as a new create | 2E follow-up | `surfaces-clients` (3B) |

## Workflow 3A (build)

### Agents and ownership

- **Stage 1: `contracts`** (alone, so it may touch any path; it keeps every suite green).
  - **Core, contracts and storage:**
    - C29.1–C29.4: registry `version`, `modelBased` and `inputs` for every §4.1 check; the result fields with their migration; the reasons file with the shared reasons;
    - C30 in the core and contracts: decision statuses, the non-blocking reasons, the `needs_review` status and its `ALTER TYPE` migration;
    - the `needs_review` status in the console labels, the web flow position and Android `WireEnums`, enough to compile and pass;
    - the C31 contract and storage: the attributes, the table and repository, redaction coverage, the blind-index key in config and `.env.example`.
  - **Vision:**
    - the C32 schemas in pydantic and zod together, with stub analysers that return empty or `found: false` values, so the contract is exercised from day one; the golden vision fixtures regenerated;
    - a module per Stage 2 owner (`document.py`, `ocr/`, `mrz_locate.py`, `barcode.py`, `forensics/`), each with a stub that the composition in `analysis.py` already calls.
  - **Plumbing:**
    - C33 dependencies, added once, so no two Stage 2 agents edit `pyproject.toml`, `uv.lock`, `package.json` or `pnpm-lock.yaml`;
    - the seed vectors in `contracts/fixtures/mrz/` and `contracts/fixtures/aamva/`;
    - `.github/workflows/ci.yml`, `infra/tests/ci-workflow.test.sh` and `e2e/setup/stack.ts` fetch every model in the manifest instead of a fixed `--only` list, so models added in Stage 2 reach CI and e2e;
    - `stack.ts` regenerates fixtures when the generator's version stamp changes.
- **Stage 2** (parallel; each agent edits only its own paths, and the shared files `analysis.py`, `schemas.py` and `app.py` only inside blocks Stage 1 marked for it):
  - **`vision-document`:**
    - document detection with the C32.1 gates and `full_frame`, and rectification;
    - `document_quality`, `portrait_clarity` and `phash`;
    - 1B F021 and F022.

    Owns `document.py`, `quality.py`, `faces.py`, `recognition.py` and their tests.
  - **`vision-ocr`:** the vendored OCR runtime (without `pyclipper` or `shapely`), the OCR models in `models/manifest.json`, `scripts/fetch_models.py`, MRZ localisation and line OCR, the visual-zone `text` with stroke-width statistics, the NOTICE, and the model entries in `THIRD_PARTY_LICENSES.md`. Owns `ocr/`, `mrz_locate.py`, the manifest, the fetch script, `THIRD_PARTY_LICENSES.md` and their tests.
  - **`vision-forensics`:** `barcodes` (zxing-cpp) and every `forensics` measurement, including `star_glyph`. Owns `barcode.py`, `forensics/` and their tests.
  - **`checks-logic`:**
    - **Data and parsers:** the C33 data tables and their generator script; the AAMVA parser; the MRZ parser's MRV support and its limited correction (C31.3); the VIZ parser.
    - **Extraction logic:** `consolidateExtraction` and the shared agreement rules (C31.2).
    - **Evaluators:** one pure evaluator per §4.1 check, including the C29.6 moves, H-tier scoring with confidence, fabrication from layout inputs, and `id_nfc_expired_detection` as logic only (wired with the NFC verification in Phase 5).
    - **Registry, reasons and vectors:** the C29.5 registry config schemas; the reasons file; the MRZ and AAMVA vectors; `scripts/calibration-report.ts`.

    Owns `packages/checks`, `packages/core/src/check-config.ts` and the registry's `configSchema` fields, `packages/contracts/src/government-id-check-reasons.ts`, `contracts/fixtures/mrz/` and `contracts/fixtures/aamva/`.
  - **`fixtures`:** the C36 generator and its version constant, every variant, the AAMVA barcode-only images rendered from `contracts/fixtures/aamva/`, the Python MRZ-vector test, and `tools/calibrate_government_id.py`. Owns `services/vision/tools/` and its tests, except `make_contract_fixtures.py`, which Stage 1 owns.
- **Stage 3: `api-wiring`.**
  - **The worker:**
    - the extraction from the v2 analysis;
    - every evaluator, with thresholds from template config;
    - C30 decisions with the last-attempt rule for both jobs, and `idPortraitOf`;
    - extraction persistence, the blind index and the pHash bands;
    - C34 lookups and re-embedding;
    - the C35 ports and sandbox providers, with startup validation.
  - **The template:** the C36 default template, as a new seeded version.
  - **The API surface:** the extraction attributes and masking; `government-id-contract.test.ts`; the regenerated OpenAPI snapshot; the `@openverify/node` types.
  - **Carry-over:** the C38 API items, and `blind-index:rebuild`.

  Owns `apps/api`, `packages/db`, `packages/node`, `packages/contracts/src/inquiry-templates.ts`, `contracts/fixtures/api` and `contracts/fixtures/flows`, and `docs/api/openapi.json`.
- **Stage 4: `integration`.**
  - Calibration: run the two calibration scripts, set the defaults from them, and write the report.
  - The C32.4 benchmark and its CI step.
  - The C36 end-to-end specs, and the e2e flow submit helper.
  - `docs/checks/government-id.md`: every §4.1 check with its tier, stage, inputs, reasons, config and limits; the test issuer; the advisory barcode default (ADR 0002 §3g).
  - `docs/checks/sandbox-providers.md`.
  - The whole validation list.
  - Integration defects, fixed test-first in whichever path they live.

  Owns `e2e/`, `docs/checks/`, `docs/calibration/`, `.github/workflows/ci.yml`, `infra/tests/`, and any path for a defect fix, under the git lock.

### Rules for every agent

- **TDD:** RED first, run and seen failing for the intended reason; the RED commit must compile and typecheck, because the e2e stack's `next build` type-checks tests. Then GREEN, then refactor. Evidence goes in `docs/tdd/phase3-<agent>.tdd.md`.
- **Path ownership and shared resources.**
  - Commits are path-scoped under `flock /tmp/openverify-git.lock`.
  - Full-stack e2e runs under `flock /tmp/openverify-e2e.lock`.
  - Long gates run in the foreground with a 600,000 ms timeout.
  - Tests that only fail under load are made deterministic (a test-controlled promise, or `src/testing/later.ts`), not retried.
- **Honesty (ADR 0002).**
  - No code path returns `passed` on an error or without its input.
  - A `feature_absent` answer needs an established class and a feature-table row.
  - H-tier results carry a confidence.
  - OCR correction stays within C31.3.
  - No check, threshold or fixture special-cases the synthetic card, beyond the documented sandbox test-issuer rule (C30.7).
- **Content.** No Persona name or copied text; synthetic data only.

### Workflow 3A Stage 1 amendments (contracts)

Decisions Stage 1 took where the contracts above leave them open, and the few places where it departs from them. Each is marked "Workflow 3A Stage 1"; the evidence is in `docs/tdd/phase3-contracts.tdd.md`.

1. **C29.1 `modelBased` (Workflow 3A Stage 1).** A check is model-based when a learned model's output can decide its status: a face detector, landmarks or recognizer, an anti-spoofing classifier, an age or deepfake estimator, or OCR reading a text, zone or field. Deterministic rules over values (check digits, dates, grammars, keyword lists, source agreement, hashes), classical signal processing and classical decoders (zxing-cpp) are not. Applying the rule to all of §4 marks more checks than the six C29.1 names, all now `beta`:
   - §4.1: `id_unprocessable_submission_detection` (OCR text density, YuNet portrait), `id_double_side_detection` (the back's MRZ is read by OCR), `id_portrait_detection`, `id_portrait_clarity_detection`, `id_mrz_detection`, `id_extracted_properties_detection` (whether OCR read the fields), `id_age_inconsistency_detection`, `id_fabrication_detection`, `id_handwriting_detection`, `id_inconsistent_repeat_detection` (face part), `id_selfie_comparison`, `id_public_figure_detection` (an A-tier check, so it moves from `ga` to `beta`);
   - §4.2: every selfie check, since each rests on the face detector. `selfie_image_quality_detection` is the fourth Phase 1 check of owner decision 4;
   - §4.3: `document_type_detection`, `document_extracted_properties_detection`, `id_nfc_selfie_comparison`.
2. **C29.1 `inputs` (Workflow 3A Stage 1).** `upload` means what the user submitted in the verification: files, or entered values such as a wallet address or a one-time code. The §4.1 values are those of `packages/core/src/check-registry.test.ts` (`GOVERNMENT_ID_INPUTS`). Every check with an adapter tier (`A`, `A/H`, `H/A`, `R+A`) lists `provider`.
3. **C29.2 result fields (Workflow 3A Stage 1).**
   - `provenance.thresholds` keys are kebab-case. Values are a number, a boolean, a string or a list of strings (for example `required-fields`).
   - `checkResult()` refuses a `passed` or `failed` result of a primary-tier H check without a confidence.
   - `verification_checks.confidence` is `double precision`, not `real`: a `real` reads 0.82 back as 0.8199999928, so the served confidence would differ from `metadata.confidence`. `stage` is `text` with a CHECK on the three stages.
   - Until `api-wiring` moves the image thresholds into TypeScript, the Phase 1 image checks list in `provenance.thresholds` only the thresholds a template configured (`min-blur-score`, `max-glare-ratio`, `min-brightness`, `max-brightness`); vision's own defaults are not known to the API.
4. **C29.4 seed reasons (Workflow 3A Stage 1).** Every check gets `input_missing`. Checks with the `vision` input also get `execution_error` and `image_unreadable`. Checks with `provider` get `execution_error` and `provider_not_configured`. `feature_absent` goes to the feature checks (`id_double_side_detection`, `id_mrz_detection`, `id_mrz_inconsistency_detection`, `id_barcode_detection`, `id_barcode_inconsistency_detection`, `id_real_id_detection`) and `id_expired_detection`, and `not_requested` to the same feature checks. `no_reference_data` goes to `id_account_comparison`, `id_inquiry_comparison` and `id_public_figure_detection`. The Phase 1 reasons stay. Today `unreadableImageChecks` answers `pending`/`image_unreadable` for every non-quality check, extraction-only ones included; `api-wiring` should answer those `input_missing`.
5. **C30.1 decision API (Workflow 3A Stage 1).** `decideVerification(results, templateConfig, { moreResultsExpected })` takes one flag for the whole verification. `VerificationDecision.reviewCheckIds` lists the required checks that are `not_applicable` for a blocking reason; `pendingCheckIds` keeps the pending and missing ones. A `not_applicable` result with no reason at all blocks. `NON_BLOCKING_NOT_APPLICABLE_REASONS` lives in `@openverify/core`; contracts re-exports it as `NON_BLOCKING_REASONS`.
6. **C29.6 in Stage 1 (Workflow 3A Stage 1).** `id_double_side_detection` now answers `not_applicable`/`not_requested` on a single-sided step. Without it, every front-only step would go to review under C30.1. The other C29.6 moves remain `checks-logic`'s.
7. **C30.4 status (Workflow 3A Stage 1).**
   - `needs_review` is appended at the end of `VERIFICATION_STATUSES` and of the Postgres enum, and `completed_at` is stamped when a verification enters it.
   - Migration `0011_verification_needs_review` holds only the `ALTER TYPE`. drizzle-orm runs every pending migration in one transaction, and Postgres 12 and later allow `ADD VALUE` in a transaction that does not use the value. No migration uses it, and `migration-v3.integration.test.ts` proves this on Postgres 17, for an empty database and for a Phase 2 upgrade.
   - `idPortraitOf` accepts a `needs_review` ID. Its switch to `/v1/embed/face` stays `api-wiring`'s.
8. **C30.6 web flow (Workflow 3A Stage 1).** Besides `flow-position.ts`, `apps/flow/src/steps/processing-step.tsx` counts `needs_review` as decided, so polling stops.
9. **C31.5 fields (Workflow 3A Stage 1).**
   - The canonical list is `EXTRACTION_FIELDS` in `@openverify/core` (`extraction.ts`), shared by checks, contracts and db, with `extractedFieldsSchema`:
     - dates are calendar dates;
     - `sex` is `M`, `F` or `X`;
     - `nationality` is `^[A-Z]{3}$`;
     - `issuing-authority-code` is `^[A-Z0-9]{1,6}$`;
     - `address-country-code` is alpha-2;
     - every other field is text without control characters, of at most 20 to 200 characters depending on the field.
   - `extraction-sources` names `mrz`, `barcode`, `viz` or `nfc`, each once per field.
   - The attributes are optional in the API schema, so earlier answers parse, but the builder always sends every one, `null` when not read.
   - `extraction-sources` is not masked (names only) and survives redaction.
10. **C31.7 table (Workflow 3A Stage 1).**
    - `government_id_extractions` is keyed by `verification_id`. `fields` is row-sealed like the schema v2 columns, with context `government_id_extractions.fields#<verification id>`, rather than the static `encrypted()`. The KEK rewrap covers it through `verification_id`.
    - `front_phash` is 16 lowercase hex characters. Eight generated `smallint` columns, `front_phash_band_0..7`, each byte `i` of the hash, carry partial indexes `(environment_id, band)`. A Hamming distance of at most 7 leaves at least one of the eight bands equal, so an OR of eight band equalities, followed by an exact distance filter, misses no candidate. Because the bands are generated, redacting the hash clears them.
    - The blind index has a partial index `(environment_id, identification_number_index)`.
    - There is no `updated_at`. `createGovernmentIdExtraction` replaces an unredacted row of the same verification, for a job retry.
11. **C31.8 blind index (Workflow 3A Stage 1).**
    - The class group is the ID class itself (each class numbers its documents separately), or `unknown` when the class was not established. Grouping classes later needs `blind-index:rebuild`.
    - The issuer code is trimmed and upper-cased.
    - A number with nothing left after normalization has no index (`null`).
    - "Scoped by environment" means lookups go through the environment-leading index. The HMAC input is exactly the C31.8 string.
    - Startup refuses a key equal to `OPENVERIFY_KEK`.
12. **C32.1 shapes (Workflow 3A Stage 1).**
    - **Not measured is `null`:**
      - `document.aspect_ratio` and `area_ratio`, without a candidate;
      - `document_quality`, `phash`, `glare_ratio_text`, `glare_ratio_portrait`, and the stroke-width statistics of a box too small to measure;
      - `forensics` as a whole, which the Stage 1 stub answers, since a zero score would read as "no tampering"; also `forensics.jpeg` for a PNG or WebP upload and `portrait_boundary_score`;
      - `model_versions.text_detector` and `text_recognizer` while no OCR model ran.
    - **Limits:**
      - 200 text lines of 200 characters;
      - 3 MRZ lines of up to 64 characters of `[A-Z0-9<]`, one confidence per line;
      - 8 barcodes, with `bytes_b64` up to 8192 characters and `text` up to 4096.
    - **Coordinates:** `quad`s are in upload pixels, clockwise from the top left. `text[].box` and `mrz.box` are in rectified pixels when a document was found, else in upload pixels.
    - **Rules:** a document is `found` exactly when `method` is not `none`, and a found document has a quad and a rectified size. An MRZ not found has no lines, box or format.
    - **Model names:** zod keeps accepting extra model names in `model_versions`, as C6 does; pydantic stays strict.
    - **Barcode fixture:** a second golden fixture, `analyze-government-id-barcode.json` (a barcode-only image), exercises the barcode and null shapes.
13. **Stage 2 seams (Workflow 3A Stage 1).** The composition (`analysis.analyze_government_id_side`) calls every stage through its module, so tests and Stage 2 agents replace them behind stable names. Marked blocks sit in `analysis.py` (per agent), `schemas.py` (one per agent) and `app.py` (`vision-ocr` around the engine creation and the per-request load point, `vision-document` after the problem handlers). `vision-document` puts 1B F021 and F022 in its `app.py` block or in a new module it owns: no Stage 2 agent owns `problems.py` or `auth.py`.
14. **C36 version stamp (Workflow 3A Stage 1).** `GENERATOR_VERSION = 1` and the stamp `fixtures/generated/.generator-version`, written last, removed at the start of a run, printed by `--print-version`. `fixtures` bumps the constant.
15. **C33 pins (Workflow 3A Stage 1).** The three Python additions are pinned with `==` in `pyproject.toml`. The other dependencies there are lower bounds held by `uv.lock`. `services/vision/tests/test_dependencies.py` keeps `pyclipper` and `shapely` out of the lock.
16. **Vectors (Workflow 3A Stage 1).** The formats are in `contracts/fixtures/mrz/README.md` and `contracts/fixtures/aamva/README.md`. AAMVA expected parses use these conventions: US dates `MMDDCCYY`; `DAD NONE` is no middle name (`null`); `DCB`/`DCD NONE` are kept; a ZIP+4 ending in `0000` becomes the 5-digit ZIP. The AAMVA error codes are `aamva_header_invalid`, `aamva_subfile_designator_invalid`, `aamva_mandatory_element_missing` and `aamva_date_invalid`. The marker subfile is `ZC`, element `ZCA` = `OPENVERIFY SYNTHETIC TEST DATA`.

### Workflow 3A Stage 2 amendments

Decisions the Stage 2 agents took where the contracts leave them open, and the places they depart from them. `api-wiring` recorded them from the agents' reports and evidence files (`docs/tdd/phase3-vision-*.tdd.md`, `phase3-checks-logic.tdd.md`, `phase3-fixtures.tdd.md`). For `vision-forensics`, `checks-logic` and `fixtures`, the report text did not reach `api-wiring`, so their items come from their evidence files and code.

#### vision-document

1. **C32.1 rectification (Workflow 3A Stage 2, vision-document).** There is no `cornerSubPix`.
   - Each side of a candidate quad is refitted to the middle 70% of its contour, then snapped to the strongest colour step along its normal, at work scale and again at full resolution. The corners are where those lines meet.
   - Measured corner error: 0.5-0.65 px. Adding `cornerSubPix` gave 0.6-5.6 px, because it settles on a rounded corner's arc.
2. **C32.1 gates (Workflow 3A Stage 2, vision-document).** Besides `area_ratio` ≥ 0.3 and an ID-1 or TD3 aspect within 12%, a quad must be outlined:
   - edge support of at least 0.6 and colour-step coherence of at least 0.35 on its worst side;
   - not running along two or more frame edges;
   - for a quad assembled from lines (the fallback), support of at least 0.8 and coherence of at least 0.88.

   The aspect keeps the image's orientation (width is the pair of sides closer to horizontal), so a vertical card, or one turned more than 45 degrees, is not found.
3. **C32.1 `full_frame` (Workflow 3A Stage 2, vision-document).** A frame of document shape counts as a tightly cropped document only if no closed card-shaped outline lies inside it: support of at least 0.8, an aspect within 6%, an area of at least 10%, and not along two frame edges. Otherwise the answer is `none`, with that outline's aspect and area. For `none`, `aspect_ratio` and `area_ratio` are those of the largest outlined, document-shaped candidate, and `null` without one.
4. **C32.1 coordinates (Workflow 3A Stage 2, vision-document).**
   - The rectified copy's corners (0,0), (w,0), (w,h), (0,h) are the quad's corners.
   - A `full_frame` quad is the frame, and its `rectified` image is the upload array itself, which must never be modified.
   - Width is the longer of the top and bottom sides; height is the width over the nearest canonical aspect.
5. **C32.1 `document_quality` (Workflow 3A Stage 2, vision-document).**
   - Sharpness (`blur_score`, `tenengrad`) is measured on the rectified document scaled down, never up, to at most 1,280 px wide.
   - `glare_ratio_text` is the glare share of the document outside the portrait box, not of the OCR boxes. It is `null` only when `document_quality` is.
   - `glare_ratio_portrait` is `null` without a portrait on the document.
6. **C32.1 `portrait_clarity` (Workflow 3A Stage 2, vision-document).**
   - `landmarks_score` is YuNet's face score times the share of the five landmarks inside the box and the upload; YuNet gives no per-landmark confidence.
   - `sharpness` is the Laplacian variance of the grey face crop at no more than 112 px wide.
   - `face_width_px` is the box width.
7. **1B F021 and F022 (Workflow 3A Stage 2, vision-document).**
   - **F021.** The problem keeps `type: about:blank` and adds `code: inference_failed`. It covers `InferenceError`, `cv2.error` and onnxruntime run-time errors; a model that cannot load stays the 503.
   - **F022.** The token middleware sits inside the body-size limit, so an unauthenticated request whose declared body is too large answers 413. An unknown `/v1` path answers 401 without a token.
   - **New modules:** `inference.py` and `service_token.py`.

#### vision-ocr

8. **C33 OCR dictionary (Workflow 3A Stage 2, vision-ocr).** The recognizer's character dictionary is the `PostProcess.character_dict` list of the model's pinned `inference.yml`: 18,708 characters. The class table is the CTC blank, the dictionary and a space, matching the model's 18,710 outputs.
9. **C32.1 without OCR models (Workflow 3A Stage 2, vision-ocr).** When the text models cannot be loaded, the analysis answers 200 with `text: []`, `mrz.found: false` and `null` text-model versions, meaning "not measured", where the face models answer 503. OCR-dependent checks then answer `execution_error` or `input_missing`, never "no text".
10. **C32.1 `text` and `mrz` (Workflow 3A Stage 2, vision-ocr).**
    - `text` leaves out the lines whose centre lies in `mrz.box`.
    - MRZ lines come from CTC decoding constrained to `[A-Z0-9<]`, the most probable allowed class at each step.
    - `found` needs at least two non-empty lines, and lines are cut to 64 characters.
    - `format_guess` allows ±2 characters per line and tells visas apart by a leading `V`.
    - Measured misreads are letter-to-digit only (`I`→`1` in the document code, `O`→`0` in `UTO`), which C31.3 corrects.
11. **C33 OCR processing (Workflow 3A Stage 2, vision-ocr).** The departures from RapidOCR v3.10.0's pipeline:
    - the detector is normalised with the model's own mean and std;
    - there is no angle classifier;
    - crops are taken in source pixels;
    - both size bounds compose;
    - stroke widths are measured on a copy 96 px high.

#### vision-forensics

12. **C32.1 `barcodes` (Workflow 3A Stage 2, vision-forensics).**
    - Each side is read on the upload, then on the rectified document, whose quads are mapped back to upload pixels.
    - A barcode both passes find is reported once.
    - zxing-cpp's input is capped at 2,560 px.
    - At most 8 barcodes, PDF417 first. A payload over the contract limits is left out, never truncated.
    - `format` is zxing-cpp's name, `"PDF417"` for AAMVA.
13. **C32.1 `forensics` (Workflow 3A Stage 2, vision-forensics).**
    - Every measurement is built from Pillow, OpenCV and NumPy only.
    - **ELA** is normalised across five fixed re-save qualities: a single quality scored untouched cards 0.6-0.8.
    - **Colour cast** uses log-chromaticity rather than CIELAB.
    - **Portrait-frame noise** reads only pixels whose 5x5 neighbourhood is flat.
    - `analyze_forensics` answers `null` only when the bytes cannot be read.
    - `star_glyph.box` is in rectified pixels when a document was found.

#### checks-logic

14. **C33 tables (Workflow 3A Stage 2, checks-logic).** The ISO 3166-1 table is generated from `iso3166` and leaves out the user-assigned `XK`. The 26 ICAO codes map `D` to `DE` and `RKS` to `XK`.
15. **C31.3 confirmation (Workflow 3A Stage 2, checks-logic).** An MRZ issuer correction counts as confirmed by the issuer code the card's header prints alone. Corrected fields are named per MRZ field.
16. **C29.5 keys added (Workflow 3A Stage 2, checks-logic).** The keys, each with its C29.5 default in `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS`:
    - `min-text-lines` (`id_unprocessable_submission_detection`, 3);
    - `min-front-back-phash-distance` (`id_double_side_detection`, 12);
    - `min-landmarks-score` (`id_portrait_clarity_detection`, 0.5);
    - `min-star-glyph-score` (`id_real_id_detection`, 0.5);
    - `max-age-difference-years` (`id_age_inconsistency_detection`, 10);
    - `face-threshold` (`id_inconsistent_repeat_detection`, 0.363);
    - `grace-days` on `id_nfc_expired_detection` (0).

    `id_age_comparison` without limits keeps answering `not_applicable`/`age_limits_not_configured`.
17. **H-tier scores (Workflow 3A Stage 2, checks-logic).** These changed after the real measurements:
    - **Tamper** takes its strongest weighted component (`TAMPER_WEIGHTS`: editing software 0.9, ELA 0.6, double compression 0.6, copy-move 0.9, portrait boundary 0.8) instead of a noisy-OR, because moderate signals on genuine cards added up to 0.60-0.67. `tampering_suspected` is gone.
    - **Entity** counts each heuristic by how far it exceeds its own threshold.
18. **C34 pHash (Workflow 3A Stage 2, checks-logic).** The calibration measured 0-2 bits between re-encodings and 0-10 bits between distinct holders of the Utopia design. No `max-phash-distance` separates them, so the pHash half of `id_repeat_detection` ships without a default, and only a configured distance enables it.
19. **C29.4 lists (Workflow 3A Stage 2, checks-logic).** `GOVERNMENT_ID_CHECK_REASONS` lists each check's own reasons beside the shared ones, `feature_absent` for `id_aamva_database_lookup` too, and never `not_implemented`.
20. **AAMVA vectors (Workflow 3A Stage 2, checks-logic).** This amends Stage 1 amendment 16. The synthetic marker is a jurisdiction-specific subfile `Z?` (`ZC` for California and Colorado, `ZO` for Ontario, `ZT` for Texas) with element `Z?A` = `OPENVERIFY SYNTHETIC TEST DATA`.

#### fixtures

21. **C36 card (Workflow 3A Stage 2, fixtures).**
    - The happy card holds the fictional holder `CALDERWOOD`, `NORA`, born 21 March 1988, with number `UT4829163` and expiry 5 May 2034. Its banner reads "OpenVerify synthetic test card".
    - `GENERATOR_VERSION` is 4.
    - `fixtures/generated/variants.json` indexes every variant with its truth, including the portrait photo it shows.
    - The calibration set adds four distinct holders and four re-encodings.
    - The screen-recapture variant keeps the display's brightness, so it trips only its own check.

### Workflow 3A Stage 3 amendments (api-wiring)

Decisions `api-wiring` took where the contracts leave them open, and the places it departs from them. Each is marked "Workflow 3A Stage 3"; the evidence is in `docs/tdd/phase3-api-wiring.tdd.md`.

1. **C31.8 index inputs (Workflow 3A Stage 3).** The worker computes the blind index with `extractionIndexOf`, which `blind-index:rebuild` shares.
   - The index needs both an issuing-authority code and an identification number; without either it is `null`, so numbers of unknown issuers never match across issuers.
   - The class group it used is stored in a new column `government_id_extractions.id_class_group` (migration `0013`, default `unknown`), so the rebuild can recompute it.
2. **C31.8 rebuild (Workflow 3A Stage 3).** `pnpm --filter @openverify/api blind-index:rebuild [--batch-size=<n>]` reads `DATABASE_URL`, `OPENVERIFY_KEK` and `OPENVERIFY_BLIND_INDEX_KEY`. It re-indexes every unredacted extraction of every environment in locked batches, and prints counts only.
3. **C34 repeat (Workflow 3A Stage 3).**
   - Lookup (`findRepeatCandidates`): earlier unredacted extractions of another account, at most the 100 newest, by an OR of the blind-index index and the eight band indexes, then the exact Hamming distance in SQL (`bit_count`).
   - The account is read per matched row through the primary keys: a join was planned as a scan of every verification.
   - The pHash half runs only when `max-phash-distance` is configured (Stage 2 amendment 18).
   - EXPLAIN on Postgres 17 is in the evidence file.
4. **C34 inconsistent repeat (Workflow 3A Stage 3).**
   - The lookup takes the 5 newest same-index extractions of any account (`INCONSISTENT_REPEAT_CANDIDATE_LIMIT`), each a re-embedding.
   - An earlier front is re-embedded only while its file exists and decrypts. A front vision cannot read is not compared either.
   - A re-embedding failure follows C30.3 on this check alone.
5. **C34 selfie and references (Workflow 3A Stage 3).**
   - `id_selfie_comparison` uses the newest selfie verification of the inquiry that was submitted (`submitted`, `passed`, `failed` or `needs_review`) and has a center image, re-embedded with `/v1/embed/face`.
   - The comparisons read the inquiry's and the account's `fields`, `null` when empty.
   - The worker runs a lookup only when its check is enabled.
6. **C35 binding (Workflow 3A Stage 3).**
   - **Variables:** `OPENVERIFY_PROVIDER_AAMVA_{SANDBOX,PRODUCTION}`, `OPENVERIFY_PROVIDER_PUBLIC_FIGURE_{SANDBOX,PRODUCTION}` and `OPENVERIFY_PROVIDER_AGE_ESTIMATE_{SANDBOX,PRODUCTION}`. Each takes `sandbox` or empty.
   - **Refusals at startup:** any other value, and `sandbox` on a `_PRODUCTION` variable. Both the API and the worker refuse to start, through `loadConfig`.
   - **Ports** (`ports.ts`): `AamvaLookupProvider.lookup({ jurisdiction, fields })`, `PublicFigureProvider.match({ portrait, fields })` and `AgeEstimateProvider.estimate({ front, portrait, fields })`. A failure throws, and a `ProviderError` says whether a retry can help.
   - **When the worker asks:** whenever the check is enabled and a provider is bound for the environment's kind, with what the document showed. The evaluator then answers `input_missing` or `feature_absent` where the inputs fall short.
7. **C35 sandbox magic values (Workflow 3A Stage 3).** These are the last four characters of the identification number, upper case and `A-Z0-9` only:
   - **AAMVA:** `0000` gives `no_match` on `name-last` and `birthdate`; `9999`, or no number, gives `not_found`; anything else gives `match`.
   - **Public figure:** `7777` gives `match`; `4040` gives `gallery_empty`; anything else gives `no_match`.
   - **Age estimate:** the age the birth date gives (30 without one), 25 years more for `8888`, always with confidence 0.9.
   - Every result is labelled `{ id: "sandbox", sandbox: true }`.
8. **C30.3 scope (Workflow 3A Stage 3).**
   - A vision error no retry can cure is recorded at once, like `VisionResponseError`: a 4xx other than 413, 415 or 422 (for example a wrong service token). It no longer fails the verification.
   - A failed re-embedding or provider call is recorded on its own check only (`REEMBEDDING_CHECKS`, or the A-tier check), not on every vision check.
   - After a failed analysis, checks are judged by their registry `inputs`: those with `vision` answer `execution_error`, the others `input_missing`.
9. **C30.4 (Workflow 3A Stage 3).** `idPortraitOf` embeds the stored front with `/v1/embed/face`. A front vision cannot read counts as no portrait (`id_portrait_not_present`, as in Phase 1).
10. **C31.5 and C31.6 serving (Workflow 3A Stage 3).** These carry the extraction attributes, masked per principal:
    - `GET /verifications/:id`, `GET /inquiries/:id?include=verifications` and `GET /dashboard/inquiries/:id`;
    - `verification.*` event payloads, unmasked as webhooks deliver them: the Events API masks them per principal, and redaction stubs them (2B F005).

    The country and class come from the extraction where the user chose none (`fillVerificationDocument`). The Utopia card keeps `country: null`.
11. **C29.2 models (Workflow 3A Stage 3).** `apps/api/src/jobs/models.ts` pins each model id vision reports to its `models/manifest.json` SHA-256, and a test keeps the two equal. An unknown id is left out of provenance, never given a digest.
12. **C29.2 whole-image thresholds (Workflow 3A Stage 3, unchanged from Stage 1 amendment 3).** `min-blur-score` and `max-glare-ratio` stay vision's verdict when a template sets none, so a deployment's vision settings keep their meaning. The C29.5 document thresholds come from TypeScript defaults and are always in provenance.
13. **C36 template (Workflow 3A Stage 3).**
    - `DEFAULT_GOVERNMENT_ID_CHECKS` holds exactly the table: 16 required, 16 advisory, and the three A-tier checks listed with `enabled: false`.
    - `id_age_comparison` is enabled without limits, so it answers `age_limits_not_configured`, advisory.
    - The flow is unchanged.
    - `seed:dev` publishes the template as a new version when the seeded one's current version differs in flow, config or settings, and reports `template.versionId`.
14. **C38 F025 (Workflow 3A Stage 3).**
    - No deadlock between add/remove-objects and inquiry creation could be reproduced.
    - The one lock order is now: every account involved (the target and each inquiry's current account) in id order, then the inquiries in id order, as inquiry creation and consolidation lock (accounts, then inquiries).
    - An inquiry that moved to another account while the request waited answers 409.
    - The integration test pins the order: a move waits for a change of the account its inquiry leaves.
15. **C38 F015 and F016 (Workflow 3A Stage 3).** `submitVerification` locks and re-reads the inquiry before the verification. `resumeInquiry` opens the session under the inquiry's lock. Without these, the integration tests showed:
    - a verification submitted while its inquiry was being expired;
    - a session opened on an inquiry that had just completed.
16. **C38 list indexes (Workflow 3A Stage 3).** Migration `0014` drops and recreates the 28 older list indexes (53 columns) `DESC NULLS FIRST`, with plain `CREATE INDEX`, which holds each table's write lock while it builds.
17. **C37 client surface (Workflow 3A Stage 3).**
    - `@openverify/node` exports `VerificationStatus`, `InquiryStatus`, `CheckStage`, `CheckProvenance`, `ExtractionField`, `ExtractionSource`, `GovernmentIdVerification`, `EXTRACTION_ATTRIBUTES`, `isGovernmentIdVerification` and `extractionOf`.
    - `contracts/fixtures/api/verification-government-id.json` now has the Phase 3 shape.

### Workflow 3A Stage 4 amendments (integration)

Decisions `integration` took, and the places it departs from the contracts above. Each is marked "Workflow 3A Stage 4"; the evidence is in `docs/tdd/phase3-integration.tdd.md`.

1. **C29.5 and C36 defaults (Workflow 3A Stage 4).** `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS` takes the calibration report's midpoints (`docs/calibration/government-id-phase3.md`, generator version 5, the real models):

   | Key | Was | Now | Margin |
   |---|---|---|---|
   | `min-document-blur-score` | 50 | 96.56 | 81.55 |
   | `min-document-width-px` | 500 | 616 | 308 |
   | `max-document-glare-ratio` | 0.1 | 0.055 | 0.046 |
   | `min-front-back-phash-distance` | 12 | 13 | 13 |
   | `max-color-inconsistency-score` | 0.5 | 0.622 | 0.377 |
   | `max-electronic-replica-score` | 0.5 | 0.418 | 0.416 |
   | `max-handwriting-score` | 0.5 | 0.383 | 0.079 |

   Kept:
   - vision's whole-image `min-blur-score` 100 and `max-glare-ratio` 0.05 (margins 40.6 and 0.041): they also judge the selfie, which the report does not calibrate;
   - `min-document-tenengrad` without a default (the report proposes 5,471): the blur score already separates the blurred card, and one synthetic design does not establish this contrast-dependent measure's scale. The golden contract fixture's hand-written Tenengrad (2,876) would fail it;
   - `max-tamper-score` 0.5: the portrait-swap (0.394) and copy-move (0.41) variants lie inside the genuine range (up to 0.441);
   - `max-phash-distance` without a default (C34; distinct holders 0-10 bits, re-encodings 0-2);
   - the keys no variant trips: `min-text-lines`, the portrait clarity keys, `max-fabrication-score`, `max-entity-score`, `min-star-glyph-score`.
2. **C36 report (Workflow 3A Stage 4).** `tools/calibrate_government_id.py` writes `quality_thresholds` (the whole-image thresholds vision judged with), and the report judges `min-blur-score` and `max-glare-ratio` against them, marked "(vision)" (`ThresholdCalibration.currentSource`).
3. **C33 and C36 specimen variants (Workflow 3A Stage 4).** The first calibration found the OCR does not read the `specimen-stamped` overprint where it crosses the portrait (it reads `ECIMEN`) or dense text (nothing), so the card ended in review instead of failing `id_compromised_detection`. Single channels, contrast equalisation and rotating the stamp level did not recover it.
   - `specimen-stamped` now also prints the banner `SPECIMEN - NOT A REAL DOCUMENT` (the Phase 1 card's wording) on the front, which the OCR reads.
   - A new variant, `specimen-overprint`, keeps the stamp alone and expects `id_compromised_detection`; the report shows it missed, a documented limit.
   - `GENERATOR_VERSION` is 5. The frozen marker list and its whole-word matching are unchanged.
4. **C36 end to end (Workflow 3A Stage 4).**
   - `verification-completes.spec.ts` asserts the H-tier group (`stage: beta`, a confidence, one threshold each) and the extraction, through `@openverify/node`'s `extractionOf`, equal to the synthetic holder of Stage 2 amendment 21, with MRZ and VIZ as the sources of the MRZ fields.
   - `government-id-checks.spec.ts`: an expired card fails `id_expired_detection` with no retry offered; a blurred card gets the `image_blurry` hint (an alert on the capture step, "Attempt 2 of 3") and a sharp photo then passes; the `specimen-stamped` card fails `id_compromised_detection` with `specimen_marker_found`, through the flow API.
   - `government-id-review.spec.ts`: a template requiring `id_public_figure_detection` ends with the government ID and the inquiry in `needs_review` (`inquiry.completed`, then `inquiry.marked-for-review`), and `selfie_id_comparison` passed.
   - The e2e run environment sets the six C35 provider variables empty (`e2e/src/env.ts`), so no provider is bound whatever the shell exports.
   - `e2e/src/paths.ts` gains `variantImage(name, side)`.
5. **C38 flow submit helper (Workflow 3A Stage 4).** `e2e/tests/support/platform.ts`: `flowApi(...).submit` and `.verification`, `giveFlowConsent`, `submitGovernmentId` and `settledFlowVerification`; `ui-console-gaps.spec.ts` uses them.
6. **C32.4 benchmark (Workflow 3A Stage 4).** `services/vision/tools/benchmark_government_id.py` posts both sides of the happy card, scaled to 1,600 px (1,600 x 1,010), to `/v1/analyze/government-id` in process with the real models, after one warm-up, and reports the median of 10 runs, each stage of `analyze_government_id_side`, and the CPU model. It exits 1 only with `--enforce` over the budget. The CI vision job runs it after pytest and appends it to the job summary, never gating on a runner's speed. Measured on an Intel Xeon E5-1650 v3 (12 logical CPUs): a median of 2.62 s, within the 5 s budget; OCR of the visual zone is 1.56 s of it.
7. **Repository hygiene (Workflow 3A Stage 4).** `.gitignore` ignores `models/**/*.yml`, the downloaded OCR dictionary, and a vision test checks with `git check-ignore` that git ignores every file the manifest downloads.

### Workflow 3B Stage 1 amendments

Decisions the two Stage 1 agents took where C29-C38 leave them open, and the places they depart from them. The TypeScript fixer of the review recorded them from the agents' reports; each is marked "Workflow 3B Stage 1". The evidence is in `docs/tdd/phase3-surfaces-dashboard.tdd.md` and `docs/tdd/phase3-surfaces-clients.tdd.md`.

#### surfaces-dashboard

1. **C37 check list layout (Workflow 3B Stage 1).** The verification card and the verification page share `CheckResults`.
   - **In view first**, in a table named "<title> checks needing attention": required failures, then required checks without evidence (`pending`, or `not_applicable` with no reason or a reason outside `NON_BLOCKING_REASONS`), then advisory failures, each group in API order.
   - **Folded** into a native `<details>`, closed by default: passed checks, non-blocking `not_applicable`, optional `not_applicable` whatever the reason, and optional `pending`. Its summary counts by status ("Other checks: 26 passed, 4 not applicable"; "All checks: …" when nothing needs attention). The folded table is named "Other <title> checks", or "<title> checks" when nothing needs attention.
   - When nothing needs attention, the page says "No check failed or is waiting for review."
2. **C30.4 and C37 review note (Workflow 3B Stage 1).** A `needs_review` verification shows a note (role `note`, "Why it needs review") listing each required check without evidence, with its reasons in words. The API serves no row for a required check without any result, so a review with none listed reads "A required check has no result."
3. **C37 each result (Workflow 3B Stage 1).**
   - Reasons are in words for every status, not only `not_applicable`, with the code in monospace beneath.
   - A text "Beta" badge (`data-stage`) marks beta results, and "Sunset" if that stage ever appears. The confidence shows with two decimals, only when it is not `null`.
   - Provenance shows on the card and the page, in a per-check disclosure ("Show" plus the hidden text " the provenance of <check>"). Absent values read "Not recorded" (a stored row without provenance), "No model", "No provider" and "No threshold". Metadata stays on the page only, as before.
4. **C30.4 tone (Workflow 3B Stage 1).** `needs_review` takes a badge tone of its own, `review` (violet), for inquiries and verifications; no other status uses it. The Workflow 3A Stage 1 test that expected `attention` for a `needs_review` verification now expects `review`. The Beta badge is outlined, so it shares no status tone.
5. **C31.5 and C31.6 extraction (Workflow 3B Stage 1).**
   - The verification page's "Extraction" section reads the values only from `GET /verifications/:id`, exactly as sent: dates stay `YYYY-MM-DD` strings, never parsed.
   - "Hidden" means no `pii:view` (the API sends `null`). "Redacted" means the inquiry, read with `inquiries:read`, has `redacted-at`. Without `inquiries:read`, a redacted value shows as missing or "Hidden", never inferred from the surviving `extraction-sources`.
   - The sources appear in words for every operator, since the API leaves `extraction-sources` unmasked. With no sources and no values, the section says "Nothing was read from this document."
   - Only the verification page shows the extraction, not the inquiry page's cards.
6. **C37 template editor (Workflow 3B Stage 1).** The server action keeps parsing the body with the contract's request schema (the C21 pattern). That is the schema the API validates with (`updateInquiryTemplateVersionBodySchema`, which runs each check's registry `configSchema`), so a bad check config is refused at the API's pointers before the request is sent; the API's own 400 and 422 field errors map the same way. The editor adds words per pointer ("Government ID, check id_blur_detection, setting min-blur-score"; "…, allowed countries, entry 2"). No validation runs in the browser.
7. **Existing tests changed by the C37 layout (Workflow 3B Stage 1):** `verification-card.test.tsx` ("lists every check…" opens the disclosure and names the attention table; "leaves out the check details…" queries any table, hidden ones included), `verifications/[id]/page.test.tsx` ("lists every check…", likewise), `inquiries/[id]/page.test.tsx` ("shows the check details with verifications:read only" queries any table, hidden ones included), `status-badge.test.tsx` (the `needs_review` tone) and `e2e/tests/ui-console-gaps.spec.ts` (opens the folded checks before checking every row).

#### surfaces-clients

8. **C29.4 and C37 retry-hint reasons (Workflow 3B Stage 1).** A retry hint can carry the reasons that `GOVERNMENT_ID_CHECK_REASONS` and `PHASE1_CHECK_REASONS` list for `user_behavior` checks, less the shared reasons only a `not_applicable` result carries (every shared reason but `image_unreadable`): 20 reasons, 12 of them new in Phase 3. They are shared between languages as `contracts/fixtures/flow/retry-hint-reasons.json` (`schema_version` 1, sorted `reasons`), in a new folder `contracts/fixtures/flow/`, separate from `flows/`, which the contracts fixtures test lists exactly. `apps/flow/src/i18n/retry-reasons.test.ts` keeps it equal to the contracts, and the Android `MessagesTest` reads it.
9. **C37 Spanish on Android (Workflow 3B Stage 1).** The SDK gains a complete `values-es/strings.xml` (all 100 strings), following the web flow's `es.ts`; the consent texts say "pantalla" where the app says "screen". `openverify_locale` is no longer `translatable="false"`, so every translation sets its own BCP 47 tag (lint's `MissingTranslation` enforces it), and a Spanish device records consent with locale `es`. C29.4 asked only for an Android message; this also gives Android the Spanish C37 names for both clients.
10. **C38, a create answered 2xx with an unexpected body (Workflow 3B Stage 1).** Both clients treat it as made but unreadable, like a lost answer (2D F018): `FlowApiError` kind `invalid-response` on the web, `FlowApiException.InvalidResponse` on Android. They read the session and reuse the newest `initiated` verification of the type. When the session cannot be read either, the original error stands and the next attempt reads the session before any create; when the session shows none, a retry creates after reading. No idempotency key is added to the flow API.
11. **C38 `FlowRenderer` retry focus (Workflow 3B Stage 1).** It follows 2D F016. A failed session load's error state carries `attempt` and `retrying`. While the retry runs, the error screen stays, "Try again" is `aria-disabled` and a loading status shows. A failed retry is a new screen (key `error:<attempt>`), so focus moves to its heading; a successful one moves focus to the next step's heading.
12. **C38 E002 (Workflow 3B Stage 1), a change to an existing test.** The F010 test in `apps/flow/e2e/flow.spec.ts` reads `--color-control` and `--color-line` with `getComputedStyle(document.documentElement)`. It requires both to be defined, the select's border to be the control colour, and the border not to be the line colour. The old probe-only guard could not fail.
13. **C30.6 tests (Workflow 3B Stage 1).** No production change was needed. The test doubles (the flow's `FakeFlowApi`, the mocked e2e `MockFlowApi`) now settle the inquiry as C30.5 does: `completed`, then `needs_review` when a verification is in review. Android's `FakeFlowApi` takes the inquiry status per decision, as before.
14. **C37 Kotlin MRZ vectors (Workflow 3B Stage 1).** `Mrz.kt` is unchanged. `MrzVectorsTest` encodes the ICAO 9303 check-digit layouts (TD1, TD2, TD3, MRV-A, MRV-B, and the TD1/TD2 long document number) as test code only, so every vector, the OCR-corrected ones included, exercises `Mrz.checkDigit`. It also checks `BacKeySeed.mrzInformation` against each vector's document number and dates.
15. **Unknown values from a newer server (Workflow 3B Stage 1).** No change: the web flow still decodes flow API answers with the strict contract schemas, and Android keeps its `UNKNOWN` fallbacks.
16. **Test mechanics (Workflow 3B Stage 1).** The RED version of `retry-reasons.test.ts` read the fixture with `import.meta.glob`; GREEN switched to a static JSON import, because Vitest 5's `fsModuleCache` kept the RED-time empty glob for the unchanged file. In the GREEN commit `be6e488`, the new `FlowRenderer` focus test waits for the new error text before reading focus; its assertions are unchanged.

### Workflow 3B review amendments

The fixes of the Workflow 3B review (Stage 2) by the TypeScript fixer, and the contract changes they make. Each is marked "Workflow 3B review"; the evidence is in `docs/tdd/phase3-review-fixes.tdd.md` (the Python and Android fixers keep their own files).

1. **K101: the face a re-embedding takes (Workflow 3B review; amends C30.4, C31.9 and C34).** `POST /v1/embed/face` accepts an optional multipart text field `subject`:
   - `selfie`, also the default when the field is absent: today's behaviour, the largest face on the whole image;
   - `document`, a government ID front: vision runs document detection. When it finds a quad by contour or lines, the face embedded is the largest whose box centre lies inside the quad; for `full_frame` or `none`, the largest face on the whole image, as today. When no face lies inside a found quad, the answer is that of an image with no face.
   - Any other value answers 422.

   `/v1/analyze/government-id` applies the same `document` rule to the front's portrait (the portrait embedding, `portrait_clarity` and the forensics portrait box); `faces` still reports every face. The API sends `subject=document` whenever it re-embeds a stored government ID front (`idPortraitOf` for `selfie_id_comparison`, and the C34 `id_inconsistent_repeat_detection` candidates), and no subject for a selfie (`id_selfie_comparison`'s newest selfie). The Python fixer implements the vision half; vision ignored an unknown multipart field until then, so either half can land first.
2. **G001: API logs mask the extraction (Workflow 3B review; amends C12 and C31.6).** For a reader without `pii:view`, `maskPersonalData` also nulls every C31.5 extraction attribute inside each resource's `attributes`, at any depth: an answer's `data` and `included`, and an event's payload. That covers whole stored bodies and the preview of a truncated one. `extraction-sources` names fields only and stays, as the API serves it; the same names outside `attributes` are left alone. The console's `JsonView` reads those `null`s as "Hidden".
3. **G002: processing and redaction (Workflow 3B review; amends C16, C30.3 and C31.7).** The write transaction of `processVerification` first locks the inquiry (`FOR UPDATE`, the row C16 redaction locks first; inquiry before verification, as `submitVerification` locks) and reads `redacted_at` under the lock.
   - A redacted inquiry writes nothing: the transaction rolls back with `PermanentJobError('inquiry_redacted')`, and the worker fails the verification without data (`failVerificationAfterError`: no checks, no extraction, a `verification.failed` event without extracted values), as for a file a concurrent redaction deleted. The inquiry is then settled as usual.
     - **Note (owner decision 5 after Workflow 6C, built in Workflow 6D by `platform-6d`; added in the Workflow 6D review).** A redacted open inquiry is no longer settled. The verification still fails without data, but `transitionInquiryInTx` refuses a redacted inquiry's move to `pending`, `completed` or `failed` and stages nothing, so the inquiry stays open until it expires at its `expires-at` (expiry is not guarded). Webhook consumers get `inquiry.expired` for it, never `inquiry.completed` or `inquiry.failed`. See `docs/plans/phase-6.plan.md`, "Workflow 6D Stage 1 and 2 amendments", platform-6d items 1 and 2.
   - A redaction that starts while the job writes waits for its commit, then redacts the extraction and stubs the event it finds.
4. **G004: issuer codes (Workflow 3B review; amends C31.2 and Stage 2 amendment 15).** `issuing-authority-code` readings compare only within one scheme: six digits are an AAMVA IIN, one to three letters an ICAO code. ICAO codes compare as countries (`normalizeCountryCode`: `D` = `DEU`).
   - In `consolidateExtraction`, a reading of another scheme than the value kept is left out of the field: it is not in `readBy` or `agreeing`, makes no disagreement, and does not count toward the C31.4 minimums.
   - `id_barcode_inconsistency_detection` skips such a pair. A genuine US licence that prints `USA` alone in its header no longer fails `id_extraction_inconsistency_detection` against its barcode IIN.
5. **G003: the blind index per environment (Workflow 3B review; amends C31.8 and Stage 1 amendment 11).** The index is `HMAC-SHA-256(subkey, "<issuing-authority-code>|<class group>|<number>")`, with the C31.8 string unchanged, under the environment's subkey `HMAC-SHA-256(OPENVERIFY_BLIND_INDEX_KEY, "openverify/blind-index/v1|<environment id>")`. The same number in two environments, or in two organizations of one install, has unrelated indexes, so the table cannot link people across them without the key; lookups stay environment-scoped as before.
   - The worker passes the verification's environment, and `blind-index:rebuild` each row's.
   - A database written before this change needs one `pnpm --filter @openverify/api blind-index:rebuild`.
6. **G009: tamper coverage (Workflow 3B review; amends C29.2 and Stage 2 amendment 17).** Error-level analysis is a tamper component only on a side with a portrait. Vision's `ela_score` of 0 on a side without one means "not measured", so it no longer counts toward `coverage` or the confidence of `id_tamper_detection`.
7. **G005: MRZ state codes (Workflow 3B review; amends C31.3 and C33).** The MRZ issuing state and nationality must be an ISO alpha-3 code or an ICAO 9303 Part 3 §5 code (`D` included), or the specimen state `UTO` (the sandbox test issuer, which production refuses through `id_compromised_detection`, C30.7). Anything else is a format issue (`mrz_issuing_state_invalid`, `mrz_nationality_invalid`).
8. **G006: MRZ dates (Workflow 3B review).** 29 February is a valid MRZ date only when the two-digit year can be a leap year in some century (`YY % 4 = 0`), or the year is unknown.
9. **G007: name agreement (Workflow 3B review; amends C31.2).** Names compare token by token, one to one and in order, with Jaro-Winkler at least 0.92 and no prefix rule. Only an MRZ name whose field was full (`nameTruncated`) may be a truncation of the other reading: its tokens may be prefixes, down to initials, and its trailing tokens may be missing. `consolidateExtraction` takes those fields from the MRZ reading (`truncatedFields`), and `id_mrz_inconsistency_detection` keeps its own truncation test. Pairs Jaro-Winkler itself accepts (for example `SMITH` and `SMITHSON`, 0.925) still agree; tightening the measure would be another C31.2 change.
10. **G008: a single name (Workflow 3B review; amends C29.5).** The default `required-fields` keep `name-first`. A check-digit-valid MRZ whose name field has a primary identifier, no secondary one and room left (nothing cut) states the holder has a single name (ICAO 9303 Part 3). `name-first` is then not missing unless another source read one, and the result carries `single-name: true`.
11. **K103: CI model cache and an API fixture (Workflow 3B review).** The model cache of the `vision` and `e2e` jobs keeps every file `models/manifest.json` downloads (`models/*.onnx` and `models/*.yml`, the OCR dictionary), under the key prefix `models-v2-`, and `infra/tests/ci-workflow.test.sh` checks it against the manifest. `contracts/fixtures/api/verification-government-id.json` shows the calibrated `min-front-back-phash-distance` 13.
12. **G012: the full-stack happy path (Workflow 3B review, test only).** `verification-completes.spec.ts` opens each card's folded checks (Stage 1 amendment 1) before reading their rows, the patch surfaces-dashboard proved.

The Python fixer's changes to the vision contract (evidence in `docs/tdd/phase3-review-fixes-python.tdd.md`):

13. **K101, vision half: `face_count` (Workflow 3B review; amends C32.1 and the C6 `POST /v1/embed/face`).** `face_count` is the number of faces the face was chosen from. For `subject=document` with a quad found by contour or lines, that is the faces whose box centre lies inside the quad (a centre exactly on the edge counts as inside, `cv2.pointPolygonTest >= 0`); for `selfie`, `full_frame` or `none`, every face on the image. No face inside a found quad answers `{face: null, face_count: 0}`. The 422 for an unknown `subject` is the existing request-validation problem: `errors[].loc` names `subject`, and the value is not echoed.
14. **G010: the text-detector input (Workflow 3B review; amends C32.1 text).** After the shorter side is scaled to 736, the longer side is capped at `max_side_len` (2000), and the map is normalised in float32. An upload whose capped shorter side rounds to nothing (for example 1500x8) reads no text lines; this is not an error. A 4000x30 upload took 14.6 s and 4.4 GB, and a 1500x8 one ended in HTTP 500 after 34 s and 10.1 GB; both now answer at once in under 0.5 GB.
15. **G011: OCR reads at most 200 lines (Workflow 3B review; amends C32.1 text).** OCR recognises only the first 200 detected lines in reading order; before, every detected line (up to 1000) was recognised and the first 200 readable ones reported. A page with more than 200 detected lines can therefore report fewer than 200 lines when some of the first 200 read as nothing. A recognition batch is at most 64 times its height, and a longer line is squeezed to that width; the MRZ line reader's lines (about 34 characters) are well inside that. Fixture results are unchanged.

Deferred by the Python fixer (owner decisions, open):

- **G011, the rest: a total recognition budget.** A page built for the worst case (200 lines, each at least 64 times its height) still costs about 34 batches of about 1 s each, over the C32.4 5 s budget. Bringing it under budget needs a per-side cap on summed batch widths, with the remaining text reported as not read, which changes what C32.1 text means for very dense pages.
- **K102, the rest: the Apache License text in the vision image.** The image now ships `NOTICE` but not the licence text (Apache-2.0 §4(a)). The root `LICENSE` is outside the `services/vision` build context, so shipping it needs either a copy under `services/vision/` or a wider compose build context.

## Workflow 3B (surfaces, review, fixes)

- **Stage 1** (parallel):
  - **`surfaces-dashboard`:** C37 in the console, and E003. Owns `apps/dashboard` and the dashboard UI specs.
  - **`surfaces-clients`:** C37 in the web flow and on Android, the Kotlin MRZ vectors, E002, the `FlowRenderer` retry focus and the create-with-unexpected-body retry. Owns `apps/flow` and `android/`.
- **Stage 2, review.** Four read-only reviewers:
  - **privacy and security:** the extraction's PII paths, the blind index, redaction, OCR text handling, sandbox providers in production, upload robustness;
  - **check correctness:** MRZ, AAMVA, ID-number grammars, dates, consolidation, correction limits and comparisons, checked against the cited specifications, and the honesty rules;
  - **vision:** correctness, robustness to hostile images (decompression, timeouts), CPU budget, licence notices;
  - **clients and console.**

  Then one verifier for CRITICAL and HIGH findings, and path-owned fixers (TypeScript, Python, Android), test-first.
- **Stage 3.** The orchestrator re-runs the validation list and records Phase 3 in `docs/PROGRESS.md`.

## Validation

```bash
source scripts/env.sh
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm format:check
pnpm test                                     # every package ≥80%
pnpm test:integration                         # Testcontainers: db, api
python3 scripts/fetch_models.py               # every model in models/manifest.json
(cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest)
(cd android && ./gradlew testDebugUnitTest koverVerify assembleDebug lint)
pnpm e2e                                      # Phase 1–3 full-stack specs
gitleaks git --redact .
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| OCR misreads the synthetic card, so the happy path fails end to end | High | C31.2 tolerances; MRZ correction within C31.3; the pre-approved fallback recognizer; the calibration report shows margins; a remaining failure is a blocker for the owner, never a special case |
| Document detection rectifies the wrong region of a tightly cropped upload | High | C32.1 gates and `full_frame`; the on-background variant |
| Vision CPU time grows with OCR and forensics, slowing e2e and CI | Med | The C32.4 benchmark; models cached in CI; `JobLimiter` unchanged |
| Heuristics give false positives on real cards | High | Beta, advisory by default, confidence and thresholds in every result, calibration report scope stated |
| PII leaks through the new extraction (logs, metadata, events, API keys without `pii:view`) | High impact | C29.3 and C31.6 rules, redaction of the index and pHash, the redaction-coverage test, a dedicated privacy reviewer in 3B |
| The synthetic generator becomes a fake-ID tool | Med | Fictional issuer only; AAMVA payloads never drawn on a card and marked synthetic; public-domain faces |
| `needs_review` changes behaviour that integrators see | Med | Additive status; events in a fixed order; documented in the plan and the API reference; owner decision |
| A licence slips in through a transitive or vendored dependency | Med | C33 lists exactly what is added; `THIRD_PARTY_LICENSES.md`; the vision reviewer checks notices |
| Five agents editing vision and checks at once | Med | Stage 1 stubs, marked blocks and module ownership; dependencies added once |
| The blind-index key leaks or is lost | Med | A separate secret with a startup check and a rebuild CLI; never logged |

## Acceptance

- [ ] All 36 §4.1 checks have an evaluator at their tier. `id_nfc_expired_detection` is logic-only until Phase 5. No enabled check answers `not_implemented`.
- [ ] Every written result carries `stage`, `confidence` (H-tier `passed`/`failed`) and `provenance`, and reasons from `GOVERNMENT_ID_CHECK_REASONS`.
- [ ] Decision-engine tests cover ADR 0002 §4 as amended in C30.2:
  - a required check that is `not_applicable` (other than `feature_absent`/`not_requested`) or `pending` gives `needs_review`;
  - no error path gives `passed`;
  - a sandbox provider bound to production fails startup.
- [ ] The extraction is encrypted, masked and redacted like other PII (the index and pHash included), and the redaction-coverage test includes it.
- [ ] The calibration report exists, and the default thresholds cite it.
- [ ] Every validation command passes locally and in CI on GitHub.
- [ ] `docs/tdd/phase3-*.tdd.md` exists for each agent, and `docs/PROGRESS.md` records Phase 3.

## Decisions for the owner (made here; confirm or change)

1. The ADR 0002 §3b clarification for `feature_absent` and `not_requested` (C30.2).
2. The new verification status `needs_review`, and the inquiry's `completed` → `needs_review` with both events (C30.4, C30.5).
3. Utopia (`UTO`) as the sandbox test issuer, flagged as a specimen issuer in production (C30.7).
4. Model-based R-tier checks are `beta` until a calibration report (C29.1). This includes four Phase 1 checks that were `ga`.
5. The barcode checks and REAL ID are advisory in the default template (C36).
6. `OPENVERIFY_BLIND_INDEX_KEY` as a separate secret, with a rebuild CLI (C31.8).
7. No face embeddings stored in Phase 3; re-embed from the encrypted files instead (C31.9). So there is no public-figure gallery yet (C35).
8. The perceptual hash is stored in plain form, environment-scoped, and cleared by redaction (C31.7).
9. Retention keeps skipping inquiries in `needs_review` (the 2A behaviour), so their extractions stay until an operator decides. Phase 3 makes `needs_review` more common.
10. The happy-path synthetic card no longer carries specimen markers (C36).
11. PP-OCRv6 small as the OCR model set, with the pre-approved PP-OCRv5 English fallback, and vendored RapidOCR processing without `pyclipper` or `shapely` (C33).
12. Client-side barcode pre-checks deferred to Phase 4 and Phase 10 (C37).
