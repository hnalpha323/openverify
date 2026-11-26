# TDD evidence: Workflow 3A Stage 2, `checks-logic` (C29-C36 check logic)

- **Slice owner:** `checks-logic` (Workflow 3A, Stage 2), beside `vision-document`, `vision-ocr`, `vision-forensics` and `fixtures`.
- **Owned paths:** `packages/checks`, `packages/core/src/check-config.ts` and the registry's `configSchema` fields, `packages/contracts/src/government-id-check-reasons.ts`, `contracts/fixtures/mrz/` and `contracts/fixtures/aamva/`.
- **Date:** 2026-10-21.
- **Input:** `docs/plans/phase-3.plan.md`, "Workflow 3A", Stage 2 `checks-logic`, and contracts C29-C36.
- **Commits:** `ef1e9c9..4f30e09` (60 commits), then this record.

Each item follows the same cycle:
1. Write a test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

A RED test must compile and typecheck. So whenever a test needed a name that did not exist yet, a `chore` commit added it first as a stub that does nothing useful (an empty table, `null`, a function throwing "not implemented").

All commands ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown. Output is trimmed to the lines that matter. Where a GREEN run showed that the RED test itself expected something wrong, the correction is stated under GREEN; no test was skipped or weakened.

## 1. ISO 3166-1 table and the ICAO Part 3 codes (C33)

Stub `ef1e9c9`, RED `fe11c52`, GREEN `2c145fa`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/data/country-tables.test.ts src/country-codes.test.ts --coverage.enabled=false)
     × names its generator source and licence
     × holds the 249 ISO 3166-1 entries, each code unique and well formed
AssertionError: expected [] to have a length of 249 but got +0
     × lists the 26 codes, by part
     × build ISO_ALPHA2_TO_ALPHA3 from ISO3166_COUNTRIES
AssertionError: expected [ [ 'AD', 'AND' ], …(248) ] to deeply equal []
     × maps the issuer code "D" to the alpha-2 code "DE"
AssertionError: expected null to be 'DE' // Object.is equality
     × knows whether "GBD" is an ICAO issuer or nationality code (true)
AssertionError: expected false to be true // Object.is equality
      Tests  24 failed | (rest passed)
```

### GREEN

`packages/checks/scripts/generate-iso3166.py` writes `src/data/iso3166.ts` from the pinned `iso3166` package (MIT), leaving out the user-assigned `XK`; `src/data/icao-codes.ts` holds the 26 ICAO 9303 Part 3 §5 codes (`D` maps to `DE`, `RKS` to `XK`).

```text
$ (cd services/vision && uv run --frozen python ../../packages/checks/scripts/generate-iso3166.py)
wrote /home/mhnoor/persona-opensource/packages/checks/src/data/iso3166.ts
$ (cd packages/checks && pnpm exec vitest run src/data/country-tables.test.ts src/country-codes.test.ts src/id-disallowed-country-detection.test.ts src/id-mrz-inconsistency-detection.test.ts --coverage.enabled=false)
 Test Files  4 passed (4)
      Tests  126 passed (126)
```

## 2. AAMVA IINs, ID-number grammars, national checksums, specimen markers, feature table (C33, C30.2, C30.7)

Stubs `eade5ee` and `4c0c065`, RED `3cb85a5`, GREEN `5c7de2c`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/data --coverage.enabled=false)
     × holds the 72 IINs: 57 US, 13 Canadian and 2 Mexican, each a unique six-digit number
     × has a grammar for each of the 50 states and DC, and names its sources
     × holds at least 15 checksums, each with a cited source
AssertionError: es-dni: expected undefined to be defined
     × are exactly the plan list, frozen
     × gives every ICAO passport an MRZ on its one data page and no PDF417
AssertionError: expected null to match object { mrz: true, pdf417: false, …(4) }
⎯⎯⎯⎯⎯⎯ Failed Tests 99 ⎯⎯⎯⎯⎯⎯⎯
```

### GREEN

The first GREEN run showed two wrong RED expectations, both corrected:
- the markers are reported in text order (`MUSTER`, then `SAMPLE`), not the list order;
- the kennitala "invalid" vector changed the century digit, which no checksum covers. It now changes the check digit (`1201743389`).

```text
$ (cd packages/checks && pnpm exec vitest run src/data --coverage.enabled=false)
     × finds the markers in "UTOPIA / MUSTER / SAMPLE"
AssertionError: expected [ 'SAMPLE', 'MUSTER' ] to deeply equal [ 'MUSTER', 'SAMPLE' ]
     × is-kennitala: accepts "1201743399" and rejects "1201743398"
AssertionError: is-kennitala invalid: expected true to be false
      Tests  2 failed | 141 passed (143)
$ (cd packages/checks && pnpm exec vitest run src/data --coverage.enabled=false)
      Tests  143 passed (143)
```

## 3. MRV-A and MRV-B, and the C31.3 limited correction (C31.1, C31.3)

Stub `81d7f9d`, RED `ce2165d` and `faa36d4` (with the new MRZ vectors: the TD1 long document number, the MRV-A document-number check digit and `ocr-corrections.json`), GREEN `e3c0265`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/mrz.test.ts src/vectors.test.ts --coverage.enabled=false)
     × parse with our parser to their expected fields and check-digit results (TD1-3, MRV-A, MRV-B)
     × hold the C31.3 OCR correction vectors, and our parser applies exactly their corrections
     × parses the MRV-A example, which has no composite or optional-data check digit
     × parses the MRV-B example
     × corrects a letter O in a TD1 birth date, and names it
     × corrects a digit 0 in the TD3 issuing state, and names it
     × corrects one character in each of two fields
     × keeps any other check-digit failure a failure, corrections or not
      Tests  15 failed | 82 passed (97)
```

### GREEN

An existing test used an MRV as its "unsupported layout". MRVs are supported now, so it uses the pre-2021 French ID card, which is still unsupported.

```text
$ (cd packages/checks && pnpm exec vitest run src/mrz.test.ts src/vectors.test.ts src/id-mrz-inconsistency-detection.test.ts --coverage.enabled=false)
      Tests  145 passed (145)
 mrz.ts   |   99.32 |    95.75 |     100 |   99.27 |
```

The npm `mrz` package remains the oracle for every vector it supports.

## 4. AAMVA payload parser (C31.1, C33)

Stub `0402faf`, RED `c43f5ad` (with the new vectors `dl-636012-canada`, `dl-636015-version-08-zip-plus-4`, `compliance-indicator-not-at`, `iin-not-listed`, `aamva-version-11` and `subfile-offset-misplaced`), GREEN `21d3243`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/aamva.test.ts src/vectors.test.ts --coverage.enabled=false)
     × reads the header, the designators, the elements and the C31.5 fields
Error: not implemented
     × reads Canadian dates as CCYYMMDD
     × reports a missing mandatory element of the 2020 standard, and the payload still reads
     × refuses a wrong compliance indicator as an AAMVA header
     × refuses a subfile that does not start with its type as a subfile designator
     × parse with our parser to their expected header, elements and fields
     × report with our parser the error each invalid one names, and its details
      Tests  39 failed | 9 passed (48)
```

### GREEN

The RED case "a version that is not a number" broke the jurisdiction version, not the AAMVA version. It now replaces the AAMVA version digits.

```text
$ (cd packages/checks && pnpm exec vitest run src/aamva.test.ts src/vectors.test.ts --coverage.include=src/aamva.ts)
      Tests  48 passed (48)
 aamva.ts |   99.07 |    94.64 |     100 |   99.02 |
```

## 5. Label-anchored visual-zone parser (C31.1)

Stub `1b8a426`, RED `c1c6f0a`, GREEN `f4009b9`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/viz.test.ts --coverage.enabled=false)
     × reads "14 02 1990" (DMY) as 1990-02-14
AssertionError: expected null to be '1990-02-14'
     × reads the golden fixture card: values below their labels
AssertionError: expected {} to deeply equal { 'name-last': { value: 'VALEMONT', lineIndex: 3, via: 'label' }, … }
     × reads Spanish labels
     × reads one future date as the expiry, an old one as the birth date, a recent one as the issue date
      Tests  44 failed | 12 passed (56)
```

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run src/viz.test.ts --coverage.include=src/viz.ts)
      Tests  56 passed (56)
 viz.ts   |   97.43 |    86.11 |     100 |   97.08 |
```

## 6. Agreement rules, `consolidateExtraction`, the established document (C30.2, C31.2, C31.3)

Stub `41638ff`, RED `3bd6d16`, GREEN `4fe1e7b`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/extraction --coverage.enabled=false)
     × treats "X12K45P78" and "X12K4SP78" as equal
     × agrees on "MUELLER" and "Müller"
     × names, per field, the sources that agree
     × counts a corrected MRZ field only where the VIZ agrees with it (C31.3)
     × establishes the class, issuer and layout from an MRZ document code
     × reads the golden Utopia card: MRZ on the back, VIZ and address, consolidated
 Test Files  4 failed (4)
      Tests  61 failed | 32 passed (93)
```

### GREEN

Two RED expectations were corrected:
- ICAO transliterates `Ø` as `OE`, but issuers have also used `O`, so the simplified rendering maps `Ø` to `O` as well, and `SORENSEN` agrees with `Sørensen`;
- the threshold example `KATHERINE`/`CATHERINE` scores 0.926, above 0.92. The example is now `STEPHEN`/`STEVEN` (0.894): it disagrees at 0.92 and agrees at 0.85.

```text
$ (cd packages/checks && pnpm exec vitest run src/extraction/agreement.test.ts src/extraction/consolidate.test.ts --coverage.enabled=false)
     × agrees on "SORENSEN" and "Sørensen"
AssertionError: expected false to be true
$ (cd packages/checks && pnpm exec vitest run src/extraction --coverage.include='src/extraction/**')
      Tests  93 passed (93)
All files       |   95.55 |     83.8 |      98 |   95.34 |
```

## 7. Registry config schemas and defaults (C29.5)

Stub `6017433`, RED `4f75ff4`, GREEN `22bbe34`.

### RED

```text
$ (cd packages/core && pnpm exec vitest run src/check-config.test.ts --coverage.enabled=false)
     × exist for exactly the checks with a threshold or an option, in registry order
     × bounds min-text-lines to [0, 50]
     × bounds min-document-blur-score to [1, 5000]
     × bounds max-tamper-score to [0, 1]
     × bound id_age_comparison min-age and max-age to 0-150, at least one, min not above max
     × take required-fields as a list of distinct C31.5 field names
     × give defaults that their own schema accepts, for the checks the plan sets them for
      Tests  30 failed | 23 passed (53)
```

### GREEN

```text
$ (cd packages/core && pnpm test)
 Test Files  12 passed (12)
      Tests  503 passed (503)
Statements   : 100% ( 328/328 )
Branches     : 100% ( 149/149 )
Functions    : 100% ( 88/88 )
Lines        : 100% ( 318/318 )
```

## 8. Evaluation context, heuristic confidence, perspective map (C29.2, C29.5, C30.7)

Stub `12d4eb1` (with the evaluator input types), RED `06a96ac`, GREEN `de1ba64`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/government-id --coverage.enabled=false)
     × maps a quad onto the rectified rectangle, corner to corner
     × gives a score of 1 against 0.5 a confidence of 1
     × derives the extraction from the analysis, at the evaluation instant
     × looks up the feature row of the established class: Utopia has one in a sandbox only (C30.7)
     × merges the template config over the defaults
     × refuses a config its schema refuses
     × lists the models the worker named, in the order asked
      Tests  15 failed | 6 passed (21)
```

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run src/government-id --coverage.enabled=false)
      Tests  21 passed (21)
```

## 9. Image and capture checks (C29.5, C29.6, C32.2)

Stub `0173193`, RED `27fe879`, GREEN `6c4e235`, refactor `b002229` (an unused import that the GREEN commit left behind).

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/phase1/government-id-checks.test.ts src/government-id --coverage.enabled=false)
     × passes a sharp, large enough document and lists every threshold judged
     × fails a document photographed too small
     × fails glare over the text or the portrait above max-document-glare-ratio
     × names the face detector it rests on
     × fails a back whose pHash is within the distance of the front: a re-encoded front
     × fails a back without the MRZ the class expects there
     × is feature_absent for a one-sided class (a passport data page)
     × fails {"face_width_px":40} with ["portrait_too_small"]
     × passes an identity document: outline, text and portrait on the front, the outline on the back
     × answers input_missing without the C32.1 document detection or when no OCR model ran
      Tests  30 failed | 43 passed (73)
```

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run src/phase1 src/government-id --coverage.enabled=false)
      Tests  114 passed (114)
```

## 10. MRZ detection and inconsistency, barcode checks, REAL ID (C29.6, C31.3, C31.4)

Stub `106fdeb`, RED `1ba2b26`, GREEN `686d1ff`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/government-id src/id-mrz-inconsistency-detection.test.ts src/extraction/agreement.test.ts --coverage.enabled=false)
     × pairs tokens one to one and in order between sources, a truncated last token aside
     × answers input_missing on valid check digits alone: they do not show agreement with the card (C31.4)
     × answers input_missing when the MRZ is missing (C29.6)
     × answers feature_absent without an MRZ for an established class that has none (C29.6)
       × counts a corrected field when the visual zone agrees, and names it
     × passes a US card whose barcode says compliant (DDA F) and that shows the star
     × passes a valid AAMVA payload that agrees with the front
     × fails when the established class has an MRZ and none was found
     × answers not_requested when the PDF417 sits on a back the flow did not ask for
      Tests  47 failed | 129 passed (176)
```

### GREEN

Two test-side changes:
- the exact-metadata test of the consistent specimen gained the new keys `agreement-fields`, `corrected-fields` and `unconfirmed-corrections`;
- the `withBarcode` helper now clears the barcode side's visual zone, which a barcode-only side does not show.

```text
$ (cd packages/checks && pnpm exec vitest run src --coverage.enabled=false)
      Tests  938 passed (938)
```

## 11. The C29.6 moves, extraction checks, number formats, compromised, NFC expiry

Stub `32b3c94`, RED `83a3adc`, GREEN `646a0e9`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src --coverage.enabled=false)
     × answers input_missing without an address (undefined)
     × answers input_missing when no date is present (C29.6)
     × fails a validity span longer than max-validity-years (C29.5)
     × answers input_missing without a birth date (undefined, C29.6)
     × passes an established country without a country policy (C29.6)
     × answers feature_absent without an expiration date for a class the feature table says has none (C29.6)
     × judges a US licence number by its state grammar
     × checks a national number of its shape by its checksum, beside the ICAO rules
     × fails the Utopia card in production as a specimen issuer (C30.7)
     × ignores a marker word that is a field value: a holder named Sample
     × answers input_missing when no OCR model ran and no barcode was read
     × passes a chip expiry in the future, through its last day
```

### GREEN

An existing test still expected the issuing country in the metadata of `id_disallowed_country_detection`. C29.3 keeps extracted values out of metadata, so it now expects `{}`.

```text
$ (cd packages/checks && pnpm exec vitest run src --coverage.enabled=false)
      Tests  979 passed (979)
```

## 12. H-tier checks: colour, electronic replica, tamper, fabrication, handwriting, entity

Stub `93dd457`, RED `17bf22b`, GREEN `c6041f6`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/government-id/heuristics.test.ts --coverage.enabled=false)
     × passes a full-colour card, with its score and threshold
     × fails a grayscale photocopy
     × fails a screen recapture ({"moire_score":0.9})
     × fails {"exif":{"software":"Adobe Photoshop 27.0"}} with editing_software_detected
     × accumulates weaker signals into a failure
     × fails text printed over the portrait
     × fails an MRZ that is not at the bottom of the card
     × fails a field written by hand: irregular strokes, read with less confidence, naming the field
     × fails a specimen in production, naming the signal
      Tests  32 failed | 1 passed (33)
```

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run src/government-id/heuristics.test.ts --coverage.enabled=false)
      Tests  33 passed (33)
$ (cd packages/checks && pnpm exec vitest run src --coverage.enabled=false)
      Tests  1012 passed (1012)
```

Item 17 later replaced the tamper combination and the entity inputs after the real measurements.

## 13. Repeats, comparisons and the A-tier checks (C34, C35)

Stub `a7973e7`, RED `cb9a262`, GREEN `ec9eb15`, refactor `d9afd44` (lint: an aliased condition that already narrows).

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/government-id/history.test.ts src/government-id/providers.test.ts --coverage.enabled=false)
     × passes when no other account used the number
     × fails a number another account used, naming the earlier verification
     × fails the same number with another identity ({"faceSimilarity":0.1})
     × compares the inquiry fields with the extraction
     × passes the inquiry's selfie of the same face, with its similarity and models
     × passes a record the provider matched, labelled with the provider
     × answers provider_not_configured without a provider, and execution_error after its failure
     × answers no_reference_data with an empty gallery
     × fails an apparent age far from it
      Tests  34 failed | 1 passed (35)
```

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run src/government-id/history.test.ts src/government-id/providers.test.ts --coverage.enabled=false)
 Test Files  2 passed (2)
      Tests  35 passed (35)
```

## 14. An evaluator for every §4.1 check (C29, C29.4)

Stub `73199db`, RED `3f8ca4d` plus `5987e37` (typed the allowlist template so the RED commit typechecks), GREEN `6d051af`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/government-id/evaluators.test.ts src/phase1/evaluate.test.ts --coverage.enabled=false)
     × evaluates every enabled government ID check: none answers not_implemented any more
     × sends the golden card to review when every registry check is enabled, as A-tier checks have no provider (C30.1)
     × has an evaluator for every §4.1 government ID check (C29)
     × evaluates the golden Utopia card in a sandbox, every check at its tier
     × fails the Utopia card in production as a specimen (C30.7)
     × enforces the template allowlists before the flow step, and only an established value (C29.5)
     × emits only reasons listed in GOVERNMENT_ID_EVALUATOR_REASONS
     × fails the image quality checks, keeps vision checks pending and answers input_missing for the extraction checks
      Tests  11 failed | 17 passed (28)
```

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run src --coverage.enabled=false)
      Tests  1057 passed (1057)
$ pnpm --filter @openverify/api typecheck
$ tsc --noEmit
(no errors: the worker's Phase 1 call still compiles against the extended input)
```

## 15. `GOVERNMENT_ID_CHECK_REASONS` lists every evaluator reason (C29.4)

RED `b6320ae`, GREEN `853e157`.

### RED

```text
$ (cd packages/contracts && pnpm exec vitest run src/government-id-check-reasons.test.ts --coverage.enabled=false)
     × gives feature_absent to the feature-table checks, expiry and the AAMVA lookup, not_requested to the back-side ones
     × lists the reasons the id_unprocessable_submission_detection evaluator emits (checks-logic)
     × lists the reasons the id_mrz_inconsistency_detection evaluator emits (checks-logic)
     × lists the reasons the id_tamper_detection evaluator emits (checks-logic)
     × lists the reasons the id_nfc_expired_detection evaluator emits (checks-logic)
      Tests  35 failed | 12 passed (47)
```

### GREEN

```text
$ (cd packages/contracts && pnpm exec vitest run --coverage.enabled=false)
      Tests  1288 passed (1288)
$ node --conditions=@openverify/source --import ./hook.mjs crosscheck.ts   # scratch: every evaluator reason is in GOVERNMENT_ID_CHECK_REASONS
checked 36 checks; problems 0
```

## 16. Real OCR output of the synthetic cards (calibration finding, C31.1, C31.3)

RED `59524a2`, GREEN `046be7d`.

Running every evaluator over the `fixtures` agent's real measurements (generator version 4) showed the VIZ parser:
- taking a value from below another label;
- missing a date whose day and month OCR ran together ("2103 1988");
- taking a visa's passport number;
- not reading the issuer code printed alone in the header;
- running an address into the next field.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/viz.test.ts src/government-id/id-mrz-detection.test.ts src/government-id/evaluators.test.ts --coverage.enabled=false)
     × never takes a value from below another label in the same column
AssertionError: expected { birthdate: '2034-05-05' } to deeply equal { 'expiration-date': '2034-05-05' }
     × reads a date whose day and month OCR ran together
AssertionError: expected null to be '1988-03-21'
     × prefers the visa number to the passport number a visa also prints
AssertionError: expected { 'identification-number': 'P1234567' } to deeply equal { 'identification-number': 'V7654321' }
     × reads the issuer code printed alone in the header
     × ends an address block at the next label or date
     × names every character it corrected by MRZ field (C31.3)
     × confirms an MRZ issuer correction by the issuer code the header prints (C31.3)
      Tests  7 failed | 73 passed (80)
```

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run src --coverage.enabled=false)
      Tests  1064 passed (1064)
```

Over the real measurements, the happy, TD3 passport, MRV-A visa, on-background, distinct-holder and re-encoded cards now pass every R-tier check in a sandbox, and the MRZ issuer corrections are confirmed by the header code.

## 17. Tamper and entity scores on genuine cards (calibration finding)

RED `168156c`, GREEN `4757b99`.

The noisy-OR tamper score was 0.60-0.67 on every genuine synthetic card, because copy-move (0.41) and the portrait boundary (0.51) are moderate on all of them; the entity score then added it up again. Tamper now takes its strongest weighted component (`TAMPER_WEIGHTS`: editing software 0.9, ELA 0.6, double compression 0.6, copy-move 0.9, portrait boundary 0.8). Entity counts each heuristic by how far it exceeds its own threshold. `tampering_suspected` (signals that only add up) is gone from the reasons.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/government-id/heuristics.test.ts --coverage.enabled=false)
     × lets the strongest weighted component decide: moderate signals do not add up (calibration)
     × passes the genuine synthetic card, whose copy-move and boundary scores are moderate
     × counts a heuristic only by how far it exceeds its own threshold
      Tests  3 failed | 32 passed (35)
$ (cd packages/contracts && pnpm exec vitest run src/government-id-check-reasons.test.ts --coverage.enabled=false)
     × lists no tamper reason for signals that only add up: the strongest component decides
      Tests  1 failed | 47 passed (48)
```

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run src --coverage.enabled=false)
      Tests  1066 passed (1066)
$ (cd packages/contracts && pnpm exec vitest run src/government-id-check-reasons.test.ts --coverage.enabled=false)
      Tests  48 passed (48)
```

## 18. The C36 calibration report

Stubs `398ac32` and `98dac2c`, RED `f767c04` (a small hand-written measurements file in the format of `tools/calibrate_government_id.py`), GREEN `f9b95bd`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/calibration --coverage.enabled=false)
     × reads the generator version and evaluates every variant with the real evaluators
     × proposes a lower bound between the genuine cards and the variants below them
     × proposes an upper bound for a heuristic score between the genuine cards and the variants above
     × proposes the front-back pHash distance that catches a front reused as the back
     × says when no variant is separated, and proposes nothing
     × measures the pHash distances of re-encodings and distinct cards (C34)
     × decodes the AAMVA barcode images and checks each against its vector
     × states plainly that it covers synthetic fixtures only and keeps the heuristics beta
     × reads the measurements file and writes the report, creating its folder
      Tests  11 failed | 1 passed (12)
```

### GREEN

Two RED expectations had been computed by hand wrongly, and are corrected to the measured values:
- the blur row takes one value per card, its weakest side (the side the check fails on). The three genuine cards share the golden back, so the genuine range is `3, 1398.64-1398.64`, not four sides from 1398.64 to 1543.21;
- the smallest genuine front-back pHash distance is holder-2's 27 bits, not the happy card's 34. The proposal is therefore 14, with a 13.5-bit margin, not 17 and 17.

Measured values are reported to three decimals; only proposals are rounded.

```text
$ (cd packages/checks && pnpm exec vitest run src/calibration --coverage.enabled=false)
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

## 19. The verdict on the current defaults, and the command line (C36)

Stub `0376a0a`, RED `5da8050`, GREEN `4f30e09`.

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/calibration --coverage.enabled=false)
     × reads the calibration tool output and writes the report the plan names by default
     × resolves relative paths against the directory it was started from, and takes --now
     × refuses an instant that is not ISO-8601, and unknown options
     × judges the current default: what it catches, the genuine cards it fails and its margin
     × has the thresholds, the pHash distances, the variants and the AAMVA images
AssertionError: expected false to be true // Object.is equality
AssertionError: expected { input: '', output: '', …(1) } to deeply equal { …(3) }
AssertionError: expected [Function] to throw an error
AssertionError: expected null to deeply equal { caught: [ 'blurred' ], …(2) }
AssertionError: expected '# Government ID calibration, Phase 3\…' to contain 'At the default'
      Tests  5 failed | 11 passed (16)
```

### GREEN

`scripts/calibration-report.ts` runs on Node's type stripping, with `scripts/register-ts.mjs` resolving the sources' `.js` imports to `.ts`; no dependency was added.

```text
$ (cd packages/checks && pnpm exec vitest run src/calibration --coverage.enabled=false)
 Test Files  2 passed (2)
      Tests  16 passed (16)
$ pnpm --filter @openverify/checks calibration:report --input <scratch>/measurements.json --output <scratch>/calibration/government-id-phase3.md --now 2026-10-21T12:00:00Z
wrote <scratch>/calibration/government-id-phase3.md: 30 variants, 12 AAMVA images
$ pnpm --filter @openverify/checks calibration:report --now yesterday
error: --now must be an ISO-8601 instant, got "yesterday"
```

`docs/calibration/government-id-phase3.md` itself is written by `integration` (Stage 4), which owns `docs/calibration/` and sets the defaults from it.

## Calibration run over the real measurements

The `fixtures` agent's tool measured 30 variants and 12 AAMVA images (generator version 4; YuNet 2026may, SFace 2021dec, PP-OCRv6 small detection and recognition). The report, run in a sandbox with every government ID check enabled and `id_age_comparison` at `min-age: 18`, shows:

- **Genuine cards** (happy, on-background, TD3 passport, MRV-A visa, four distinct holders, four re-encodings) fail no check.
- **Tripped as built:** expired, bad MRZ check digit, MRZ-VIZ mismatch, issued after expiry, under-age, PO box, blurred, glare, low resolution, photocopy, screen recapture, front reused as back, no portrait, not an ID.
- **Missed:**
  - specimen-stamped: OCR reads the diagonal stamp as "ECIMEN", not the whole frozen marker word; the marker list is kept whole-word;
  - portrait-swap and copy-move: the vision tamper measurements (0.394 and 0.41) do not separate them from genuine cards (up to 0.441, the TD3 passport);
  - handwritten-field: 0.462 against the 0.5 default; the genuine maximum is 0.304 (the 90% resize), so 0.383 would separate it with a 0.079 margin.
- **Thresholds** (current default; proposed midpoint and margin):

  | Key | Genuine | Should trip | Current | Proposed (margin) |
  |---|---|---|---|---|
  | `min-document-blur-score` | 178.119-1211.256 | blurred 15.008 | 50 (catches it, margin 34.992) | 96.56 (81.56) |
  | `min-document-width-px` | 924-1500 | low-resolution 308 | 500 (margin 192) | 616 (308) |
  | `max-document-glare-ratio` | 0-0.009 | glare 0.101 | 0.1 (margin 0.001) | 0.055 (0.046) |
  | `min-front-back-phash-distance` | 26-34 | front-as-back 0 | 12 (margin 12) | 13 (13) |
  | `max-color-inconsistency-score` | 0.194-0.245 | photocopy 1 | 0.5 (margin 0.255) | 0.622 (0.378) |
  | `max-electronic-replica-score` | 0-0.002 | screen-recapture 0.835 | 0.5 (margin 0.335) | 0.418 (0.416) |
  | `max-handwriting-score` | 0.064-0.304 | handwritten-field 0.462 | 0.5 (catches none) | 0.383 (0.079) |
  | `max-tamper-score` | 0.051-0.441 | portrait-swap 0.394, copy-move 0.41 | 0.5 (catches none) | none |

- **pHash (C34):** the re-encodings are 0-2 bits from the happy front, but distinct holders are 0-10 bits apart (holder-2 and holder-4 are identical), so no `max-phash-distance` separates them and the pHash half of `id_repeat_detection` ships disabled.
- **AAMVA images:** all 12 decode, and every one agrees with its vector (4 valid, 8 invalid with the vector's error).

## Final gates

Run at `4f30e09`, after `source scripts/env.sh`. `turbo` replays cached results for packages whose own files did not change, so the gates ran with `--force`.

```text
$ pnpm turbo run lint typecheck --force
 Tasks:    24 successful, 24 total
$ pnpm format:check
All matched files use Prettier code style!
$ pnpm turbo run test:integration --force
@openverify/api:test:integration:       Tests  32 passed (32)
@openverify/db:test:integration:        Tests  41 passed (41)
 Tasks:    2 successful, 2 total
$ pnpm test:coverage            # turbo run test --force
@openverify/core:test:       Tests  503 passed (503)        All files 100 | 100 | 100 | 100
@openverify/checks:test:     Tests  1082 passed (1082)      All files 98.77 | 90.02 | 99.52 | 98.69
@openverify/contracts:test:  Tests  1289 passed (1289)      All files 100 | 100 | 100 | 100
(config, e2e, flow-spec, node, ui, flow, db, dashboard: all passed)
@openverify/api:test:  FAIL  src/jobs/process-verification.test.ts > processVerification: government ID > sends a verification to review when a required check has no evaluator (C30.1, C30.4)
@openverify/api:test:  FAIL  src/jobs/process-verification.test.ts > processVerification: government ID > completes the inquiry, then marks it for review, in one transaction and in that order (C30.5)
-   "verificationStatus": "needs_review",
+   "verificationStatus": "passed",
@openverify/api:test:       Tests  2 failed | 2104 passed (2106)
```

The two `apps/api` failures are the expected consequence of this slice: both tests require `id_expired_detection` as "a required check with no evaluator", and every §4.1 check now has one, so the golden card passes it. `apps/api` belongs to `api-wiring` (Stage 3), which should make another required check go to review, for example `id_public_figure_detection`, which answers `not_applicable`/`provider_not_configured` without a provider (a blocking reason).
