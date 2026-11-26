# Government ID checks

This page describes the 36 government ID checks of `docs/PLAN.md` §4.1 as Phase 3 ships them: what each one decides, from which evidence, with which reasons and settings, and where it stops. The binding contracts are C29–C36 of `docs/plans/phase-3.plan.md`; the tiers and the honesty rules are ADR 0002.

Every default threshold below comes from the calibration report, `docs/calibration/government-id-phase3.md`. That report covers **synthetic fixtures only** (the fictional issuer Utopia), so it says nothing about error rates on real documents.

## Contents

- [How a government ID is checked](#how-a-government-id-is-checked)
- [Reading a check result](#reading-a-check-result)
- [Decisions, retries and review](#decisions-retries-and-review)
- [The default template](#the-default-template)
- [The sandbox test issuer](#the-sandbox-test-issuer)
- [The checks](#the-checks)
- [Calibrated defaults](#calibrated-defaults)
- [The honesty rules as they apply](#the-honesty-rules-as-they-apply)
- [Known limits](#known-limits)

## How a government ID is checked

1. **Vision measures (C32).** The vision service analyses each uploaded side and returns measurements and raw text only, never a decision:
   - the document outline and its rectified image (an OpenCV detector; a tightly cropped upload counts as the document, `full_frame`);
   - the sharpness, size and glare of the document;
   - the OCR lines of the visual zone, with their stroke widths;
   - the machine-readable zone (MRZ) lines;
   - PDF417 and other barcodes, decoded by zxing-cpp;
   - the portrait and its clarity;
   - image forensics (EXIF, JPEG tables, error levels, moiré, pixel grid, chroma, copy-move, the portrait frame, the REAL ID star);
   - a perceptual hash (pHash) of the front.
2. **The extraction (C31).** The worker parses the MRZ (ICAO 9303 TD1, TD2, TD3, MRV-A and MRV-B), the AAMVA barcode and the visual zone (a label-anchored parser in English, Spanish, French and German), then consolidates them. Precedence is a check-digit-valid MRZ, then the barcode, then the visual zone.
3. **The established document (C30.2).** The document class and issuer count as established only when the document itself shows them: an MRZ document code, an AAMVA header, or keywords together with the layout. A class taken only from the user's choice is not established.
4. **The feature table (C33).** For an established (issuer, class) pair, the table says whether the document carries an MRZ, a PDF417 and an expiry date, and on which side. Rows exist for every ICAO passport and visa, the driver licences and ID cards of AAMVA jurisdictions, EU national ID cards and residence permits, and the sandbox test issuer.
5. **The checks decide (C29, C30).** Each enabled check runs a pure evaluator in `packages/checks` with the template's thresholds, and the decision engine combines the results.

The extraction is stored encrypted, one row per verification, with a blind index of the identification number and the front's pHash for the repeat checks (C31.7, C31.8). The blind index is computed under a subkey of the environment, so the same number has unrelated indexes in two environments or two organizations (Workflow 3B review, G003); after upgrading from a build without it, run `pnpm --filter @openverify/api blind-index:rebuild` once. No face embedding is stored (C31.9).

## Reading a check result

Each check of a `verification/government-id` resource has these fields:

| Field | Meaning |
|---|---|
| `name` | The check id |
| `status` | `passed`, `failed`, `not_applicable` or `pending` |
| `reasons` | Machine-readable reason codes, from `GOVERNMENT_ID_CHECK_REASONS` (`packages/contracts`) |
| `requirement` | `required` or `not_required`, from the template |
| `stage` | `ga` or `beta` (C29.1). Heuristic (H-tier) checks, adapter-with-heuristic (A/H) checks and model-based checks are `beta` |
| `confidence` | A number in [0, 1] for an H-tier `passed` or `failed` result, else `null` (C29.2) |
| `provenance` | The implementation version, the models used (id and SHA-256 from `models/manifest.json`), the provider (id and `sandbox`), and every threshold the result was judged against |
| `metadata` | Scores, counts and field names. Never an extracted value, OCR text or an embedding (C29.3) |

**Confidence.** An H-tier confidence is uncalibrated and margin-based: 0 at the decision threshold, rising linearly to 1 at the far end of the score scale, and scaled down when only part of the score's components could be measured. Calibration on labelled data is Phase 4 work, which is why every H-tier check is `beta`.

**Shared reasons (C29.4).** Every check may answer with these besides its own reasons:

| Reason | Status | Blocks a required check? | Meaning |
|---|---|---|---|
| `feature_absent` | `not_applicable` | no | The established class has no such feature (it has a feature-table row that says so) |
| `not_requested` | `not_applicable` | no | The flow did not ask for the input, for example the back on a front-only step |
| `input_missing` | `not_applicable` | yes (review) | An input the check needs could not be obtained, or the class could not be established |
| `no_reference_data` | `not_applicable` | yes (review) | A comparison has nothing to compare with |
| `execution_error` | `not_applicable` | yes (review) | The check could not run after the job's retries |
| `provider_not_configured` | `not_applicable` | yes (review) | An A-tier check without a provider in this environment |
| `image_unreadable` | `failed` | (failed) | Vision could not read the image (413, 415 or 422) |

## Decisions, retries and review

- **Required and advisory.** Only enabled, required checks decide (C30.1). An enabled check that is not required is advisory: it is reported and never changes the decision.
- **The decision.** Over the required checks:
  1. any `failed` gives `failed`. It is retryable when every failing required check is a `user_behavior` check;
  2. else any `pending` or missing result gives `needs_review` (Phase 3 has no asynchronous provider, so nothing stays `pending`);
  3. else any `not_applicable` with a reason other than `feature_absent` or `not_requested` gives `needs_review`;
  4. else `passed`.
- **Retry hints.** A retryable failure shows the user the reasons of the failing required `user_behavior` checks (for example `image_blurry`, `glare_present`, `resolution_too_low`) and lets them photograph the ID again, up to the step's `maxAttempts`. Fraud checks are never shown to the user.
- **Review.** A `needs_review` verification counts as done for the user (C30.6): the flow moves on and ends on the normal completion screen. The inquiry is completed, then marked for review in the same transaction, with `inquiry.completed` followed by `inquiry.marked-for-review` (C30.5). An inquiry is never approved automatically. A selfie is still compared with the portrait of an ID under review (C30.4).
- **Execution errors (C30.3).** A vision or provider failure is retried by the job. On the last attempt, every check whose registry inputs include `vision` (or `provider`) is recorded as `not_applicable`/`execution_error`, and every other check that needs the extraction as `input_missing`. A vision answer that breaks the contract, or a 4xx other than 413, 415 or 422, is recorded at once. A failed re-embedding or provider call is recorded on its own check only.

## The default template

The seeded default template (`DEFAULT_GOVERNMENT_ID_CHECKS` in `packages/contracts/src/inquiry-templates.ts`) enables the checks in these groups (C36):

| Group | Checks | Default |
|---|---|---|
| Image and capture | unprocessable submission, blur, glare, double side, portrait, portrait clarity | required |
| MRZ | MRZ detection, MRZ inconsistency | required (`feature_absent` for an established AAMVA card) |
| Extraction and logic | extracted properties, extraction inconsistency, number format, expired, valid dates, disallowed country, disallowed type, compromised | required |
| Barcode | barcode detection, barcode inconsistency, REAL ID | enabled, advisory |
| Comparisons and repeats | inquiry, account and selfie comparisons; repeat and inconsistent repeat; age comparison; PO box | enabled, advisory |
| H-tier | colour inconsistency, electronic replica, tamper, fabrication, handwriting, entity | enabled, advisory (`beta`) |
| A-tier | AAMVA database lookup, public figure, age inconsistency | disabled |

**Why the barcode checks are advisory (ADR 0002 §3g).** Most national ID cards have no feature-table row, so a barcode check would answer `input_missing` for them, and a required check would send every such card to review. **Operators who accept US and Canadian driver licences and ID cards should require `id_barcode_detection`, `id_barcode_inconsistency_detection` and `id_real_id_detection`**, ideally in a template (or a flow step allowlist) that accepts only those documents. For an established ICAO passport or an EU ID card, which have rows saying they carry no PDF417, the barcode checks answer `feature_absent`, which does not block.

**Why the repeat checks are advisory.** Every e2e spec and every developer submits the same synthetic card, so a required repeat check would fail them all. In production, require them once the repeat lookup suits your data.

**Age comparison.** It is enabled without limits, so it answers `not_applicable`/`age_limits_not_configured`. Set `min-age` or `max-age` before requiring it: without limits, a required age comparison sends every verification to review.

Every change to the seeded template is published as a new template version, so existing inquiries keep theirs.

## The sandbox test issuer

Utopia (`UTO`) is the specimen state of ICAO 9303 Part 3. OpenVerify treats it as its documented **sandbox test issuer** (C30.7), so integrators can test without real documents:

- **In a sandbox environment,** a Utopia document has feature-table rows (the TD1, TD3 and MRV-A layouts: an MRZ, no PDF417, an expiry date). Its `country` stays `null`, because Utopia has no ISO alpha-2 code. `id_disallowed_country_detection` passes when no country allowlist is set, and fails against any alpha-2 allowlist.
- **In a production environment,** a Utopia document fails `id_compromised_detection` with `specimen_issuer`.

This is the only issuer-specific behaviour, and no check, threshold or fixture special-cases the synthetic card beyond it. The synthetic cards render only for Utopia; AAMVA payloads are text vectors and barcode-only images for fictional people, each carrying a jurisdiction-specific subfile (`ZC`, `ZO`, `ZT`, with element `Z?A` = `OPENVERIFY SYNTHETIC TEST DATA`), and such a payload fails `id_compromised_detection` with `synthetic_test_data` in production.

## The checks

Each entry gives the tier (R real, H heuristic, A adapter; ADR 0002), the check type, the stage, the registry inputs (C29.1: `upload`, `vision`, `extraction`, `history`, `provider`), the default template's setting, the reasons beyond the shared ones, the settings a template may give it (C29.5), and its limits. "Model-based" means a learned model's output can decide it (a face detector or recognizer, or OCR), which keeps it `beta` until a FAR/FRR report (ADR 0002 §3f).

### Image and capture

#### `id_unprocessable_submission_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R, model-based | user behaviour | beta | upload, vision | required |

Whether the submission is an identity document that can be read at all: the document outline, the OCR text and the portrait.

- **Reasons:** `document_not_found` (a side shows no document outline, MRZ or barcode); `insufficient_text` (the front has fewer than `min-text-lines` OCR lines read with a confidence of at least 0.5, and no side carries an MRZ or a barcode); `identity_features_not_found` (no portrait on the front, and no MRZ or barcode anywhere). Without the document detection, or when no OCR model ran: `input_missing`.
- **Settings:** `min-text-lines`, an integer 0–50, default 3.
- **Limits:** on the synthetic fixtures the not-an-ID page reads 19 text lines, so `min-text-lines` does not separate it; it is caught by `document_not_found`. A vertical card, or a card turned more than 45 degrees, is not found as a document.

#### `id_blur_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | user behaviour | ga | upload, vision | required |

Fails when any side is too blurry to read, or the document was photographed too small.

- **Reasons:** `image_blurry` (the whole image, or the rectified document); `resolution_too_low` (the rectified document is narrower than `min-document-width-px`).
- **Settings:**
  - `min-blur-score`, 10–1000: the whole image's Laplacian variance. Unset, the vision service's own verdict applies (its default 100, `OPENVERIFY_VISION_BLUR_THRESHOLD`), which the selfie checks share;
  - `min-document-blur-score`, 1–5000, default **67.1**: the rectified document's Laplacian of Gaussian variance, measured at 1,000 px wide over its OCR text boxes (over the whole card when they cover under 2% of it). Calibrated in Phase 12A on synthetic Quebec-format phone captures (`docs/calibration/blur-phase12a.md`); the Phase 3 value 96.56 was on the older whole-card scale;
  - `min-document-tenengrad`, 1–100,000, no default: the rectified document's mean squared Sobel gradient. The Phase 3 calibration proposes 5,471 and the Phase 12A one 8,583.33 on its own scale; it stays template-only because the blur score already separates the blurred captures, and one synthetic design does not establish the scale of this contrast-dependent measure (8,583.33 fails a genuine card of the Phase 3 report);
  - `min-document-width-px`, an integer 100–4,000, default **616**;
  - `legible-text-min-confidence` (default 0.9) and `legible-text-min-lines` (default 8), Phase 12A: a side whose document measures reach at least 0.8 of each document threshold is still legible, and not failed for `image_blurry`, when its OCR read at least that many lines at that median confidence. Vision's own whole-image verdict yields to the document measure when one exists; an explicitly set `min-blur-score` still applies.
- **Limits:** a card photographed on a background rectifies with a lower blur score (178 on the fixture) than a tight crop (about 1,200). A low-resolution card can look sharp (2,815 on the fixture): only the width catches it. With the 616 px default, a card that fills less than about half of a 1,280-pixel frame gets the `resolution_too_low` hint.

#### `id_glare_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | user behaviour | ga | upload, vision | required |

Fails when glare covers too much of a side.

- **Reasons:** `glare_present`.
- **Settings:**
  - `max-glare-ratio`, 0.001–0.5: the share of glare pixels in the whole image. Unset, the vision service's verdict applies (its default 0.05, `OPENVERIFY_VISION_GLARE_THRESHOLD`);
  - `max-document-glare-ratio`, 0.001–0.5, default **0.055**: the glare share of the rectified document outside the portrait, and of the portrait itself.
- **Limits:** glare is near-white, unsaturated pixels; a holographic overlay that saturates the sensor counts as glare.

#### `id_double_side_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R, model-based | user behaviour | beta | upload, vision, extraction | required |

Every side the step requires must be uploaded, and a two-sided capture must hold two different sides.

- **Reasons:** `front_not_present`, `back_not_present` (also for the same image twice, or a back whose pHash is within `min-front-back-phash-distance` bits of the front, a re-encoded front); `back_feature_not_found` (the established class has a feature row and its back lacks the feature the class puts there: the MRZ of a TD1 card, the PDF417 of an AAMVA card). A front-only step: `not_requested`; a one-sided class such as a passport data page: `feature_absent`.
- **Settings:** `min-front-back-phash-distance`, an integer 1–32, default **13**.
- **Limits:** without a feature row, the back's feature is not judged, and the metadata says so. The back's MRZ is read by OCR, which makes the check model-based.

#### `id_portrait_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R, model-based | fraud | beta | upload, vision | required |

Passes when the face detector (YuNet) found a portrait on the front. Only the detector score is kept.

- **Reasons:** `portrait_not_present`.
- **Limits:** the portrait is the largest face on the whole upload, so when a person holds the card up to the camera, their own face may be taken for the portrait.

#### `id_portrait_clarity_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R, model-based | user behaviour | beta | upload, vision | required |

Whether the ID portrait is large, sharp and unobstructed enough to compare with a selfie.

- **Reasons:** `portrait_too_small` (face box width), `portrait_blurry` (the Laplacian variance of the face crop at no more than 112 px wide), `portrait_obstructed` (the landmark score: YuNet's face score times the share of its five landmarks inside the box). An unmeasured portrait: `input_missing`.
- **Settings:** `min-face-width-px` 16–1,000, default 64; `min-sharpness` 1–10,000, default 15; `min-landmarks-score` 0–1, default 0.5.
- **Limits:** no synthetic variant is built to trip it, so these are initial values. The genuine cards measure 150–209 px, sharpness 240–463 and landmark scores 0.93–0.95.

### MRZ

#### `id_mrz_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R, model-based | user behaviour | beta | upload, vision, extraction | required |

The MRZ was located and read as a TD1, TD2, TD3, MRV-A or MRV-B zone.

- **Reasons:** `mrz_unreadable` (an MRZ was found but does not parse); `mrz_not_found` (the established class carries one and none was read). `feature_absent` for a class without an MRZ (an AAMVA card), `not_requested` for an MRZ on a back the flow did not ask for, `input_missing` without a row or without OCR.
- **Limits:** the OCR reads only `[A-Z0-9<]` in the zone. Its measured misreads are a letter read as a digit in a letter position (`I` as `1` in the document code, `O` as `0` in `UTO`), which the C31.3 correction repairs and names.

#### `id_mrz_inconsistency_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | required |

The check digits, and agreement between the MRZ and the visual zone.

- **Reasons:** `document_number_check_digit_invalid`, `birth_date_check_digit_invalid`, `expiration_date_check_digit_invalid`, `optional_data_check_digit_invalid`, `composite_check_digit_invalid`; `mrz_document_code_invalid`, `mrz_issuing_state_invalid`, `mrz_nationality_invalid`, `mrz_birth_date_invalid`, `mrz_expiration_date_invalid`, `mrz_sex_invalid`, `mrz_name_invalid`; `document_number_mismatch`, `surname_mismatch`, `given_names_mismatch`, `birth_date_mismatch`, `expiration_date_mismatch`, `sex_mismatch`, `nationality_mismatch`, `issuing_state_mismatch`. `feature_absent` for a class without an MRZ.
- **Limits:**
  - Agreement needs at least two of the document number, birth date, expiry and surname read by both the MRZ and the visual zone (C31.4); with fewer, valid check digits alone do not show agreement with the card, so the check answers `input_missing`.
  - OCR correction (C31.3) changes only a character impossible for its position, at most one per field, never digit for digit or letter for letter. Each corrected field is named in `corrected-fields`, and counts as evidenced only if the visual zone agrees. Any other check-digit failure stays a failure.

### Barcode

#### `id_barcode_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | user behaviour | ga | upload, vision, extraction | advisory |

A PDF417 barcode was located and decoded.

- **Reasons:** `barcode_not_found` (the established class carries a PDF417 and none was decoded); `feature_absent`, `not_requested` or `input_missing` as for the MRZ.
- **Limits:** advisory by default; see [the default template](#the-default-template) for when to require it.

#### `id_barcode_inconsistency_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | advisory |

The AAMVA payload is sound (the Annex D header, a listed issuer identification number, a known version, subfile designators, mandatory elements, dates) and agrees with the front of the card.

- **Reasons:** `aamva_header_invalid`, `aamva_subfile_designator_invalid`, `aamva_mandatory_element_missing`, `aamva_date_invalid`, `aamva_iin_unknown`, `aamva_version_unsupported`, `aamva_document_subfile_missing`, `barcode_viz_mismatch` (the fields named in `disagreeing-fields`).
- **Limits:** agreement needs two of the document number, birth date, expiry and surname read by both; with fewer, a sound payload answers `input_missing`. The IIN table holds the 72 published AAMVA IINs.

#### `id_real_id_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | vision, extraction | advisory |

Whether a US driver licence or ID card is REAL ID compliant, from the AAMVA `DDA` element (`F` compliant, `N` not) and the star the front shows.

- **Reasons:** `real_id_not_compliant` (`DDA N` without the star); `real_id_marker_inconsistent` (`DDA F` without the star, or `DDA N` with it). Without `DDA` the star decides; without either, `input_missing`. Any other established class with a feature row: `feature_absent`.
- **Settings:** `min-star-glyph-score` 0–1, default 0.5.
- **Limits:** the star is a template match (Hu moments and solidity) in the upper part of the card; no synthetic variant carries a star, so its threshold is not calibrated.

### Extraction and logic

#### `id_extracted_properties_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R, model-based | user behaviour | beta | extraction | required |

The extraction holds every field of `required-fields`.

- **Reasons:** `required_fields_missing`, the fields named in `missing-fields`. When no OCR model ran and no barcode was read: `input_missing`.
- **Settings:** `required-fields`, a list of distinct C31.5 field names, default `name-first`, `name-last`, `birthdate`, `identification-number`, `expiration-date`. An established class without an expiry date does not need `expiration-date`.
- **A single name.** ICAO 9303 Part 3 writes a holder's single name as the primary identifier and leaves the secondary one empty. A check-digit-valid MRZ whose name field shows exactly that, with room left so nothing was cut, states there is no first name: `name-first` is then not missing unless another source read one, and the result carries `single-name: true` (Workflow 3B review, G008).

#### `id_extraction_inconsistency_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | required |

Every pair of sources present (MRZ, barcode, visual zone) agrees on the fields both read, under the C31.2 rules: an absent field is never a mismatch; dates and numbers compare after confusable mapping (`O`/`0`, `I`/`1`, `S`/`5`, `B`/`8`, `Z`/`2`); names compare after ICAO transliteration, with Jaro-Winkler at least 0.92 per token, one to one and in order. Only an MRZ name whose field was full may be shorter than the printed one, its names cut down to initials or left out, as ICAO 9303 truncates (G007). An issuer code compares only with one of the same scheme: an AAMVA IIN is never compared with an ICAO country code a card prints, and ICAO codes compare as countries, `D` as `DEU` (G004).

- **Reasons:** `extraction_inconsistent`, the fields named in `disagreeing-fields`.
- **Limits:** it needs two sources sharing at least two fields; otherwise `input_missing`.

#### `id_number_format_inconsistency_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | required |

The identification numbers fit the grammars of the established issuer: a US jurisdiction's driver licence formats (all 50 states and DC), the ICAO 9303 document number rules for MRZ documents, and the national checksums the table holds (21, for example the Spanish DNI and NIE, the Italian codice fiscale, the Dutch BSN, the Polish PESEL, the Brazilian CPF, the Indian Aadhaar Verhoeff digit and the Chinese resident ID).

- **Reasons:** `number_format_invalid`, the field named in `invalid-fields`.
- **Limits:** without an established issuer, a number, or a grammar that applies (a US territory or a Canadian card, for example), `input_missing`. A Utopia card is judged by the ICAO rules.

#### `id_expired_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | required |

The document's expiry date has passed. It is valid through its day, then for `grace-days` more.

- **Reasons:** `expired`, `expired_within_grace_period`, `expiration_date_invalid`. `feature_absent` for an established class that the feature table says has no expiry.
- **Settings:** `grace-days`, an integer 0–365, default 0.
- **Limits:** a fraud check, so an expired card fails without a retry hint.

#### `id_valid_dates_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | required |

The dates are possible and in order.

- **Reasons:** `birth_date_invalid`, `issue_date_invalid`, `expiration_date_invalid`, `birth_date_in_future`, `issue_date_in_future`, `birth_date_not_before_issue_date`, `issue_date_not_before_expiration_date`, `birth_date_not_before_expiration_date`, `age_exceeds_maximum` (older than 130 years, a fixed limit recorded in provenance as `max-age-years`), `validity_period_too_long`.
- **Settings:** `max-validity-years`, an integer 1–20, default 15.

#### `id_age_comparison`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | advisory (no limits) |

The holder's age, from the birth date, is within the template's limits.

- **Reasons:** `below_minimum_age`, `above_maximum_age`, `birth_date_invalid`, `birth_date_in_future`; `age_limits_not_configured` without limits (a `not_applicable` reason that blocks a required check).
- **Settings:** `min-age` and `max-age`, integers 0–150; at least one when the check is configured, and `min-age` not above `max-age`.

#### `id_age_inconsistency_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| A/H, model-based | fraud | beta | vision, extraction, provider | disabled |

The portrait's apparent age, from an age-estimation provider, against the age the birth date gives.

- **Reasons:** `apparent_age_inconsistent`; `provider_not_configured` without a provider.
- **Settings:** `max-age-difference-years`, an integer 1–50, default 10.
- **Limits:** no permissively licensed age model exists, so Phase 3 ships the port and the sandbox provider only ([sandbox providers](sandbox-providers.md)). The ages stay out of the result; only their difference is kept.

#### `id_disallowed_country_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | required |

The issuing country is allowed. In order, it enforces the verification type's `allowed-countries` (C11), else the flow step's `allowedCountries`, else any country. It passes only once the country was established from the document.

- **Reasons:** `issuing_country_not_allowed`, `issuing_country_disallowed`; `input_missing` when the country could not be established.
- **Limits:** the sandbox test issuer has no country (see above). Organisations and persons without a nationality (the ICAO Part 3 `X..` codes) have no ISO country either.

#### `id_disallowed_type_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | required |

The document class is allowed, by `allowed-id-classes`, else the step's `allowedIdClasses`, else any class, once established from the document.

- **Reasons:** `id_class_not_allowed`, `id_class_disallowed`; `input_missing` when the class could not be established.

#### `id_po_box_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | advisory |

The address is a PO box, military or diplomatic mail (APO, FPO, DPO, PSC, CMR), a private mailbox at a mail-receiving agency, or an international equivalent (Apartado, Casilla, Postfach, Boîte Postale, Caixa Postal, Postbus, Postboks and others).

- **Reasons:** `po_box_detected`; only the pattern ids are reported, never the address. Without an address: `input_missing`.

#### `id_compromised_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | vision, extraction | required |

The document is a specimen, test data or on a compromised list.

- **Reasons:**
  - `specimen_marker_found`: a frozen C33 marker in the OCR text outside the extracted field values and the MRZ lines (whole words, case-insensitive, accents folded: `SPECIMEN`, `ESPECIMEN`, `SAMPLE`, `MUSTER`, `ECHANTILLON`, `CAMPIONE`, `FACSIMILE`, `MODELO`, `VZOR`, `WZOR`, `NAYTE`, `PROVE`, `VOID`, and the phrase `NOT A REAL DOCUMENT`). A holder named Sample is not flagged, and `TEST` and `SYNTHETIC` are not markers. The metadata names the marker words found, never a field value;
  - `specimen_document_number`: the document number of a published ICAO 9303 example;
  - `specimen_issuer`: the test issuer Utopia in a production environment;
  - `synthetic_test_data`: an AAMVA payload marked as OpenVerify synthetic test data, in production;
  - `compromised_list_match`: a list opted in with `use-for-compromised-ids` holds the number.
- **Limits:**
  - The markers are read by OCR, which reads horizontal print. A translucent stamp across the portrait or across dense text is not read: the calibration's `specimen-overprint` variant (SPECIMEN stamped diagonally across both sides) passes this check, while the `specimen-stamped` variant, which also prints `SPECIMEN - NOT A REAL DOCUMENT` as a banner, fails it.
  - A listed number fails `id_compromised_detection` only through a government ID number list marked `use-for-compromised-ids` (Workflow 7B; [lists](../lists/README.md), "Compromised IDs (C99.9)"); a list it could not read makes the check `not_applicable` with `compromised_list_unavailable`, never a pass. Phase 3 shipped no list, so the signal could not fire then.
  - Without OCR text to scan and no hard signal: `input_missing`.

### Heuristics (H-tier, beta)

Each H-tier check computes a score in [0, 1] from the vision measurements and fails above its threshold, with a confidence (see [reading a check result](#reading-a-check-result)). They are advisory by default, and every one stays `beta`: the calibration covers synthetic fixtures only.

#### `id_color_inconsistency_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| H | fraud | beta | upload, vision | advisory |

A grayscale print or photocopy, or a regional colour cast (log-chromaticity of each cell's most neutral quarter against the median cell).

- **Reasons:** `grayscale_image`, `color_cast_detected`.
- **Settings:** `max-color-inconsistency-score` 0–1, default **0.622**.
- **Limits:** a cast on a region smaller than a sixteenth of the document is diluted; a global cast (warm or cool light) is cancelled by design.

#### `id_electronic_replica_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| H | fraud | beta | upload, vision | advisory |

A card photographed from a screen, by its moiré and pixel-grid spectra.

- **Reasons:** `screen_recapture_suspected`.
- **Settings:** `max-electronic-replica-score` 0–1, default **0.418**.
- **Limits:** oblique periodic print, such as a diagonal guilloche, raises the moiré score. A recapture whose display grid is not resolved in the photo is not seen.

#### `id_tamper_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| H | fraud | beta | upload, vision | advisory |

Digital edits: the strongest of five weighted components (editing software 0.9, error level analysis 0.6, double JPEG compression 0.6, copy-move 0.9, portrait-frame noise 0.8).

- **Reasons:** `editing_software_detected`, `error_level_anomaly`, `double_compression_detected`, `copy_move_detected`, `portrait_boundary_anomaly`. The software name never leaves the vision response.
- **Settings:** `max-tamper-score` 0–1, default 0.5.
- **Limits:**
  - **It does not detect the synthetic portrait swap or copy-move:** they score 0.394 and 0.41, inside the range of the genuine cards (up to 0.441), so no threshold separates them, and the default stays at its initial 0.5.
  - Double compression is detected only for a re-save at a finer quality.
  - The error level score is 0 when there is no portrait to compare, which means "not measured", not "clean".
  - The web flow re-encodes captures (JPEG 0.92) and Android uploads at quality 90, so client uploads carry no camera EXIF.

#### `id_fabrication_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| H, model-based | fraud | beta | vision, extraction | advisory |

Layout conformance: the document outline, the text boxes, the MRZ box and the portrait box against the ICAO geometry of MRZ classes.

- **Reasons:** `layout_nonconformant`, naming the nonconformant components.
- **Settings:** `max-fabrication-score` 0–1, default 0.5.
- **Limits:** no synthetic variant is built to trip it (the genuine cards score at most 0.022), so its threshold is not calibrated.

#### `id_handwriting_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| H, model-based | fraud | beta | vision, extraction | advisory |

A printed field written by hand, from the stroke-width variation of its line and the OCR confidence.

- **Reasons:** `handwriting_suspected`, naming the C31.5 fields whose line scores above the threshold, never their values.
- **Settings:** `max-handwriting-score` 0–1, default **0.383**.
- **Limits:** the margin is small (the handwritten variant 0.462, the genuine cards at most 0.304). Large overprinted stamps and some screen recaptures also score as handwriting.

#### `id_entity_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| H | fraud | beta | vision, extraction | advisory |

The composite risk that the document is not a genuine entity: each other heuristic counted by how far it exceeds its own threshold, plus the hard signals (compromised 1, MRZ check digits 0.9, inconsistent extraction 0.8, invalid barcode 0.7).

- **Reasons:** `entity_risk_high`; `signals` names the components at or above half the threshold.
- **Settings:** `max-entity-score` 0–1, default 0.5.

### Repeats and comparisons

#### `id_repeat_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction, history | advisory |

The identification number, or the front image, was used before by another account in the same environment (C34). The worker looks up earlier unredacted extractions by the blind index and, when `max-phash-distance` is set, by the pHash bands.

- **Reasons:** `id_repeat_detected`, naming the earlier verifications.
- **Settings:** `max-phash-distance`, an integer 0–7, **no default**: the pHash half is off until a template sets it.
- **Limits:** the calibration found re-encodings of one card 0–2 bits apart, but distinct cards of the Utopia design 0–10 bits apart (the layout dominates the low frequencies), so no distance separates them, and the pHash half ships disabled (C34). The number half needs an issuing-authority code and a number.

#### `id_inconsistent_repeat_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R, model-based | fraud | beta | vision, extraction, history | advisory |

An earlier extraction with the same blind index shows another identity: another first or last name, another birth date, or another face. The earlier front is re-embedded only while its files exist; without them the faces are not compared (`face-compared: false`). A field either extraction did not read is never a difference.

- **Reasons:** `inconsistent_repeat_detected`.
- **Settings:** `face-threshold` 0.25–0.6, default 0.394 (SFace cosine similarity; the shared `FACE_MATCH_DEFAULTS` threshold, calibrated by C49: `docs/calibration/selfie-phase4.md`).
- **Limits:** the five newest same-index extractions are compared. No face embedding is stored (C31.9).

#### `id_account_comparison` and `id_inquiry_comparison`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | advisory |

The extraction against the account's or the inquiry's `fields` (the snake_case keys of the account schema), under the C31.2 rules, with addresses normalised.

- **Reasons:** `name_mismatch`, `birthdate_mismatch`, `address_mismatch`, `identification_number_mismatch`; `no_reference_data` when there is nothing to compare.
- **Settings:** `name-threshold` 0.5–1, default 0.88 (Jaro-Winkler per name token); `fields`, a list of `name`, `birthdate`, `address`, `identification-number`, default all four.

#### `id_selfie_comparison`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R, model-based | fraud | beta | vision, history | advisory |

The ID portrait against the inquiry's latest selfie that is `passed`, `submitted` or `needs_review` (version 2, Phase 4 C43: a failed attempt is never the reference), by SFace cosine similarity.

- **Reasons:** `face_mismatch`. Without such a selfie, its face or the portrait: `input_missing`.
- **Settings:** `threshold` 0.25–0.6, default 0.394: the shared 1:1 face-match threshold (`FACE_MATCH_DEFAULTS`), `calibrated` by the Phase 4 report (C49, `docs/calibration/selfie-phase4.md`) on studio portrait pairs, where it gives a false-match rate of 7.57e-4 and SFace's published 0.363 gave 2.40e-3; recorded in `provenance['threshold-basis']`. Error rates of a selfie against an ID card photo are unmeasured.
- **Limits:** in the default flow the ID comes before the selfie, so this check always answers `input_missing` there; that is why it is advisory. `selfie_id_comparison` (a selfie check) compares the pair from the selfie's side.

### Adapters (A-tier)

A-tier checks need licensed data or credentials. Phase 3 ships their ports and deterministic sandbox providers only, bound per environment kind (C35, [sandbox providers](sandbox-providers.md)). Without a provider they answer `provider_not_configured`, which sends a required check to review. They are disabled in the default template.

#### `id_aamva_database_lookup`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| A | fraud | ga | extraction, provider | disabled |

A US driver licence's data against the AAMVA DLDV service.

- **Reasons:** `aamva_record_mismatch` (the fields named), `aamva_record_not_found`. An established document that is not a US AAMVA card: `feature_absent`, before any provider is asked.
- **Limits:** no DLDV client ships; an adapter needs AAMVA membership.

#### `id_public_figure_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| A, model-based | fraud | beta | vision, provider | disabled |

The ID portrait against an operator-supplied gallery of public figures.

- **Reasons:** `public_figure_match`; `no_reference_data` for an empty gallery.
- **Limits:** no gallery ships: it needs stored embeddings, which Phase 4 and the Phase 7 face lists decide.

#### `id_age_inconsistency_detection`

See [extraction and logic](#id_age_inconsistency_detection).

### NFC

#### `id_nfc_expired_detection`

| Tier | Type | Stage | Inputs | Default template |
|---|---|---|---|---|
| R | fraud | ga | extraction | (NFC verifications, Phase 5) |

The expiry date read from the chip's data group DG1 has passed (plus `grace-days`).

- **Reasons:** `expired`, `expired_within_grace_period`, `expiration_date_invalid`; `input_missing` without a chip expiry.
- **Settings:** `grace-days`, an integer 0–365, default 0.
- **Limits:** logic only: the NFC verification that reads DG1 arrives in Phase 5, and the worker wires this check then.

## Calibrated defaults

The C36 report, `docs/calibration/government-id-phase3.md`, ran every synthetic variant through the analysis with the real models and scored it with the real evaluators. A calibrated default is the midpoint between the genuine cards and the variant built to trip the check; its margin is the distance to the nearer side.

| Check | Key | Default | Genuine cards | Variant caught | Margin |
|---|---|---|---|---|---|
| `id_blur_detection` | `min-document-blur-score` | 67.1 (Phase 12A, `docs/calibration/blur-phase12a.md`; 96.56 in this report) | 178.1–1,211.3 | blurred, 15.0 | 81.55 |
| `id_blur_detection` | `min-document-width-px` | 616 | 924–1,500 | low resolution, 308 | 308 |
| `id_glare_detection` | `max-document-glare-ratio` | 0.055 | 0–0.009 | glare, 0.101 | 0.046 |
| `id_double_side_detection` | `min-front-back-phash-distance` | 13 | 26–34 | front reused as back, 0 | 13 |
| `id_color_inconsistency_detection` | `max-color-inconsistency-score` | 0.622 | 0.194–0.245 | photocopy, 1.0 | 0.377 |
| `id_electronic_replica_detection` | `max-electronic-replica-score` | 0.418 | 0–0.002 | screen recapture, 0.835 | 0.416 |
| `id_handwriting_detection` | `max-handwriting-score` | 0.383 | 0.064–0.304 | handwritten field, 0.462 | 0.079 |

Kept, with the reason:

- **Vision's whole-image defaults** (`min-blur-score` 100 and `max-glare-ratio` 0.05) separate the blurred and glare variants with margins of 40.6 and 0.041. They also judge the selfie, which this report does not calibrate, so they stay.
- **`min-document-tenengrad`** stays template-only (the report proposes 5,471): the blur score already separates the blurred card, and one synthetic design does not establish this contrast-dependent measure's scale.
- **`max-tamper-score`** keeps 0.5: no tampered variant lies beyond the genuine cards.
- **`max-phash-distance`** has no default (C34).
- The keys no variant is built to trip (`min-text-lines`, the portrait clarity keys, `max-fabrication-score`, `max-entity-score`, `min-star-glyph-score`) keep their initial values; the report shows the genuine range of each.

## The honesty rules as they apply

ADR 0002's rules, as Phase 3 applies them to government IDs:

- **Never a pass without evidence (§3a).** No evaluator answers `passed` on an error or without its input: a missing input is `not_applicable` with a reason, a check that could not run after its retries is `execution_error`, and an image vision cannot read is `image_unreadable`. Vision's "not measured" (`null`, or no text model) is never read as "nothing there".
- **Required checks never auto-approve without evidence (§3b, C30.2).** Only `feature_absent` (an established class with a feature-table row) and `not_requested` (the flow did not ask) do not block; anything else sends the verification to review.
- **Heuristics are labelled (§3c).** H-tier results are `beta`, carry a confidence, their reasons and their threshold, and are advisory by default.
- **Sandbox providers are sandbox-only (§3d).** Binding `sandbox` to production refuses to start the API and the worker. Results name `{ "id": "sandbox", "sandbox": true }`.
- **Unconfigured providers (§3e).** An A-tier check without a provider answers `provider_not_configured`, which a required check turns into review. The console is to show "not configured" rather than a result (C37, Workflow 3B).
- **Provenance (§3f).** Every result carries its implementation version and thresholds; model-based results name their models with their SHA-256. Model-based R-tier checks stay `beta` until a FAR/FRR report (Phase 4).
- **OCR correction is bounded (C31.3).** At most one impossible character per field, named, and evidenced only where the visual zone agrees.
- **No PII outside the extraction (C29.3, C31.6).** Metadata, logs, problems and the flow API never carry extracted values, OCR text or embeddings. The extraction attributes are masked for API keys stored `pii-masked` and users without `pii:view`, and become `null` after redaction.
- **No special case for the synthetic card.** Beyond the sandbox test issuer above, no check, threshold or fixture treats the Utopia card differently.

## Known limits

- **Synthetic calibration only.** The thresholds separate OpenVerify's generated cards; their error rates on real documents are unknown.
- **OCR.** PP-OCRv6 small reads horizontal print; there is no angle classifier. A vertical card, a card turned more than 45 degrees, a translucent overprint across the portrait, and screen recaptures with strong moiré are read partly or not at all.
- **Tamper.** The synthetic portrait swap and copy-move are not separated from genuine cards.
- **Repeats.** The pHash half of `id_repeat_detection` is off by default.
- **Portrait.** The portrait is the largest face on the upload, which may be the holder's when they hold the card up.
- **Lists and adapters.** No AAMVA DLDV client, no age model and no public-figure gallery ship. A compromised list is the organisation's own government ID number list marked for compromised IDs (Workflow 7B); none ships built in.
- **NFC.** `id_nfc_expired_detection` is logic only until Phase 5.
- **Budget.** Analysing both sides of a 1,600-pixel card takes a median of 2.62 s on an Intel Xeon E5-1650 v3, against the C32.4 budget of 5 s (`services/vision/tools/benchmark_government_id.py`); OCR is the largest share.
