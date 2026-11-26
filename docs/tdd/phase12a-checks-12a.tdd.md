# Phase 12A, Workflow 12A Stage 2: checks-12a (TDD evidence)

Agent: `checks-12a` (Workflow 12A Stage 2, in parallel with `capture-12a` and `vision-12a`). Base `4ea2493bf`, contract `b7a249af1` (`docs/plans/phase-12a.plan.md` §4.3). Host: WSL2, every command run after `source scripts/env.sh`; the package suites ran one at a time under `flock /tmp/openverify-heavy.lock`.

Nothing was pushed or dispatched, and the docker project `openverify-test` was not touched. The owner's photos and OCR text from the live stack were never read. Every value in these tests is synthetic, from `contracts/fixtures/quebec-dl/` (the SPECIMEN card of `services/vision/tools/synthetic_quebec.py`), the existing AAMVA vectors and hand-written lines. No test or code path logs OCR text.

## What changed, by plan item

| # | Where | What |
|---|---|---|
| C1 | `packages/checks/src/viz.ts` | Format hints such as `(A-M-J)`, `(JJ.MM.AAAA)` and `(MM/DD/YYYY)` are dropped from labels and from `parseVizDate`'s input. A day-first or month-first hint sets that line's date order, and a year-first hint leaves the order alone. A label glued to its value splits at a letter-to-digit boundary (`LE2021`). A `/` between digits no longer splits a line as a bilingual label. The confusions `O o I l S s B Z z` map to digits only inside a token that holds a digit. The pattern fallback finds one date inside a longer line (three words, or eight digits), and a line with two dates gives none |
| C2 | `viz.ts` | The Quebec number `A9999-999999-99` is read compact, with its confusions mapped at digit positions, both by pattern (exactly one matching line, no label reading) and after a label. French labels `NUMERO DE PERMIS`, `NO DE PERMIS` and `N DE PERMIS` were added. The layout rule turns on only when the barcode's jurisdiction is CA/QC (`VizParseOptions.jurisdiction`), or when a line folds to `QUEBEC` and exactly one line holds the number. It then reads the two lines straight under the number, each within three number-line heights of the line above it, aligned with the number's column, field numbers stepped over, and both valid names. It assigns both names via `layout` or neither, and never overrides a label reading |
| C3 | `viz.ts`, `extraction/extract.ts`, `id-extraction-inconsistency-detection.ts` | `VizFieldReading.via` gains `'layout'`, and the extraction keeps `via` per reading. `extractGovernmentId` passes the AAMVA issuer's jurisdiction to `parseViz`. The inconsistency check's metadata gains `viz-via: {field: via}` for each field the visual zone shares with another source. The verdict is unchanged |
| C4 | `aamva.ts` | The file type `AAMVA` is accepted and reported as `aamva_header_nonstandard`. A designator offset at most **two** bytes off is tolerated when the subfile sits where it should (right after the designators, or right after the previous subfile), and reported as `aamva_designator_offset_mismatch`. A Quebec (IIN 604428) `DAQ` is read compact. Both new codes were added to the reason lists (see Deviations) |
| C5 | tests only | The five required fields come from the front alone, the barcode alone, or both |
| C6 | `packages/core/src/check-config.ts`, `id-extracted-properties-detection.ts` | `'missing-fields-outcome': 'fail' \| 'review'`, with a default of `fail` in `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS`. With `review`, missing fields give `not_applicable` `['required_fields_missing']` with the same metadata, and the option is listed in the provenance thresholds. `decideVerification` is unchanged |
| C7 | `packages/contracts/src/inquiry-templates.ts`, `contracts/fixtures/flows/default-gov-id-selfie.json` | The default template sets `id_extracted_properties_detection.config = { 'missing-fields-outcome': 'review' }`. seed:dev's existing comparison publishes it as version 2 of a seeded template |
| C8 | tests only (`apps/api/src/jobs/missing-fields-review.test.ts`) | Under the default template, a card lacking `name-first` gives `needs_review`, and the inquiry goes `completed` then `needs_review`, with no `inquiry.failed`. Without the option, the same card fails |
| C9 | `phase1/government-id-checks.ts`, core schema | A side with `document_quality`, when a document blur or Tenengrad threshold is configured, is judged on the document measures instead of vision's whole-image `is_blurry`. A `min-blur-score` that a template sets explicitly still applies to every side, as the operator's choice. A document-blurry side is legible when its OCR read at least `legible-text-min-lines` lines (8) at a median confidence of at least `legible-text-min-confidence` (0.9), **and** its document measures reach at least half of each threshold (`LEGIBLE_MIN_SHARPNESS_SHARE`, see Deviations). The metadata gains `legible-by-ocr-sides`, and the provenance lists the effective legibility thresholds |
| C10 | `government-id/scores.ts` | A line's confidence drop counts only when its stroke excess is at least `HANDWRITING_STROKE_SIGNAL` (0.1), so even print scores under 0.06. Field scores alone decide only when at least two VIZ fields were read; otherwise every line is scored |
| C11 | `id-number-format-inconsistency-detection.ts` | The shape-only grammar `ca-dl-qc` (`^[A-Z]\d{12}$`) applies under an AAMVA CA/QC issuer. It has no checksum, as its doc comment says. A VIZ-only card keeps `input_missing` |
| C12 | `apps/api/src/vision/schemas.ts`, `apps/api/src/ports.ts`, `packages/checks/src/phase1/inputs.ts` | The document `method` enum gains `text_layout` |

## RED

### C1, C2 (`packages/checks/src/viz-quebec.test.ts`, written first)

```text
$ cd packages/checks && pnpm exec vitest run --coverage.enabled=false src/viz-quebec.test.ts
 ❯ src/viz-quebec.test.ts (33 tests | 20 failed)
     × reads exactly the expected fields of printed, with their value and how
     × reads exactly the expected fields of phone-ocr, with their value and how
     × reads exactly the expected fields of labels-unread, with their value and how
     × reads exactly the expected fields of number-confusion, with their value and how
     × reads exactly the expected fields of not-quebec, with their value and how
     × reads "(A-M-J):1990-02-14" (DMY) as 1990-02-14
     … (each hint case, the lower-case l confusion, the glued label, the in-line date, the French number label, the layout with jurisdiction QC)
AssertionError: expected { 'issue-date': { …(2) }, …(2) } to deeply equal { …(7) }
AssertionError: expected { 'expiration-date': { …(2) }, …(1) } to deeply equal { …(7) }
AssertionError: expected { sex: { value: 'F', via: 'label' } } to deeply equal { …(7) }
AssertionError: expected null to be '1990-02-14' // Object.is equality
      Tests  20 failed | 13 passed (33)
```

The 13 that passed are the negative cases, which held before the change: a name never mapped, no hint read from `(CM)`, the rule off for Ontario, and the like.

### C4 (`packages/checks/src/aamva-quebec.test.ts`)

```text
$ pnpm exec vitest run --coverage.enabled=false src/aamva-quebec.test.ts
     × reads the expected fields of qc-file-type-aamva, and reports its deviation as a non-throwing issue
     × reads the expected fields of qc-printed-number, and reports its deviation as a non-throwing issue
     × reads the expected fields of qc-offset-shift, and reports its deviation as a non-throwing issue
     × normalizes a Quebec number to its compact form, and leaves another IIN as read
AamvaParseError: Not an AAMVA header (file_type)
AssertionError: expected { 'name-first': 'MARIE', …(9) } to deeply equal { 'name-first': 'MARIE', …(9) }
AamvaParseError: The designator of subfile DL does not locate it
AssertionError: expected 'T1234-567890-12' to be 'T123456789012' // Object.is equality
      Tests  4 failed | 5 passed (9)
```

The first implementation tolerated an offset up to 8 bytes off. `src/vectors.test.ts` then failed on the committed invalid vector `subfile-offset-misplaced`, whose designator is 4 bytes off:

```text
AssertionError: subfile-offset-misplaced: expected 'aamva_designator_offset_mismatch' to be 'aamva_subfile_designator_invalid'
```

The bound became 2 bytes, the width of the header's jurisdiction-version field. The vectors are unchanged, and that vector still fails with its own error.

The reason-list test (`id-barcode-inconsistency-detection.test.ts`):

```text
     × fails the tolerated Quebec deviation qc-file-type-aamva with aamva_header_nonstandard, a listed reason (C4)
     × fails the tolerated Quebec deviation qc-offset-shift with aamva_designator_offset_mismatch, a listed reason (C4)
AssertionError: expected [ 'aamva_header_invalid', …(10) ] to include 'aamva_header_nonstandard'
```

### C3, C5 (`packages/checks/src/extraction/extract-quebec.test.ts`)

With C1, C2 and C4 already green, only the C3 cases failed:

```text
     × turns the layout rule on from the barcode jurisdiction, with no QUEBEC line printed
     × names the VIZ method of each field it compares with the barcode
AssertionError: expected undefined to match object { via: 'layout', side: 'front' }
AssertionError: expected undefined to deeply equal { 'name-first': 'layout', …(6) }
      Tests  2 failed | 10 passed (12)
```

The same file, run against the base `viz.ts` and `aamva.ts` (restored from `HEAD` for that one run, then put back):

```text
     × reads the five required fields from the front and the barcode, the sources agreeing
     × reads the five from the phone-ocr front alone
     × reads the five from the labels-unread front alone
     × reads the five from the printed front alone
     × reads the five from the number-confusion front alone
     × reads the five from each tolerated barcode deviation
     × turns the layout rule on from the barcode jurisdiction, with no QUEBEC line printed
     × keeps how each VIZ field was read
     × names the VIZ method of each field it compares with the barcode
      Tests  9 failed | 3 passed (12)
```

### C10 (`packages/checks/src/government-id/handwriting-score.test.ts`)

The live shape gives exactly the live 0.388:

```text
     × keeps the live shape, clean print with one low-confidence line, below the threshold
     × caps a field line without a stroke signal below the threshold, whatever its drop
     × scores every line when fewer than two fields were read, and then needs a stroke signal
AssertionError: expected 0.3885 to be less than 0.383
AssertionError: expected 0.4 to be less than 0.383
AssertionError: expected 0 to be greater than 0.383
      Tests  3 failed (3)
```

### C11 (`id-number-format-inconsistency-detection.test.ts`)

```text
       × passes a letter and twelve digits under the Quebec IIN
       × fails a number one digit short
      Tests  2 failed | 9 passed (11)
```

### C9 (`packages/checks/src/phase1/blur-legibility.test.ts`)

```text
     × passes a live-shaped side: whole image 38.5, the document measure passing
     × passes a document-blurry side whose 21 lines read at a median of 0.95, naming it
     × fails a document-blurry side with five lines
     × fails a document-blurry side with a median of 0.6
     × fails a document-blurry side with no lines
     × takes configured legibility thresholds
      Tests  6 failed | 2 passed (8)
```

The first GREEN, legibility with no sharpness floor, broke three existing tests:

```text
     × judges the Tenengrad sharpness only when configured
     × fails the decision on a failing required check
     × reads the generator version and evaluates every variant with the real evaluators
```

The C36 calibration report on the committed measurements (`fixtures/generated/calibration/government-id-measurements.json`) showed the real cause:

```text
$ pnpm calibration:report --now 2026-10-21T12:00:00Z --output <scratch>/calib-c9.md
50c50
< | blurred | variant | id_blur_detection | id_blur_detection | - | - |
---
> | blurred | variant | id_blur_detection | - | id_blur_detection | - |
```

The synthetic `blurred` card (document blur 15.0 against 96.56) reads 28 lines with high OCR confidence, so OCR confidence alone rescued a plainly blurred card. The fix was the half-threshold floor. A test now covers it ("never rescues a plainly blurred card"), and the report is again byte-identical to the base (below).

`phase1/evaluate.test.ts` "fails the decision on a failing required check" set only the whole-image `is_blurry`, on a card whose document measure is sharp. Under C9 that side is judged on its document, so the test now also clears `document_quality` to keep its intent: a failing required check fails the decision.

The full API suite then showed three more tests that leaned on vision's whole-image verdict alone:

```text
$ (apps/api) pnpm run test
 FAIL  src/jobs/phase1-contract.test.ts > Phase 1 checks contract > emits only reason codes listed in PHASE1_CHECK_REASONS, and every listed code
 FAIL  src/jobs/process-verification.test.ts > processVerification: government ID > fails a blurry ID and keeps the inquiry pending while attempts remain
 FAIL  src/jobs/process-verification.test.ts > processVerification: C11 check configuration > fails the ID blur check below a configured min-blur-score, recording it
 Test Files  2 failed | 871 passed (873)
      Tests  3 failed | 11011 passed (11014)
```

- The configured `min-blur-score` case showed that an operator's explicit whole-image threshold should keep applying. C9 was refined so that only vision's own `is_blurry` yields to the document measure (a new test: "still applies a min-blur-score the template configures, on every side"), and that test is unchanged and green.
- "fails a blurry ID …" now also clears `document_quality`, as in `evaluate.test.ts`.
- The Phase 1 contract's "worst" card now also blurs its document (`blur_score: 1`), so it still emits `image_blurry`.

After the refinement the calibration report is still byte-identical (`calib-final.md`: `IDENTICAL`).

### C6, C9 config (`packages/core/src/phase12a-check-config.test.ts`) and C6 check

```text
$ cd packages/core && pnpm exec vitest run --coverage.enabled=false src/phase12a-check-config.test.ts
     × takes fail or review, nothing else
     × defaults to fail, so a template that does not opt in behaves as before
     × bounds the median confidence to 0-1 and the line count to 1-100
      Tests  3 failed | 2 passed (5)
```

The two `decideVerification` tests passed before any change, as the plan predicted: the engine already sends a blocking `not_applicable` to review. They stay as characterization tests.

```text
$ cd packages/checks && pnpm exec vitest run --coverage.enabled=false src/government-id/id-extracted-properties-detection.test.ts
       × answers not_applicable with required_fields_missing under review, naming the fields
      Tests  1 failed | 10 passed (11)
```

### C7

```text
$ cd packages/contracts && pnpm exec vitest run --coverage.enabled=false src/inquiry-templates.test.ts
     × enables the C36 government ID checks: required, advisory or disabled, by group
     × sends missing required fields to review instead of failing the inquiry (Phase 12A C7)
AssertionError: expected { enabled: true, required: true } to deeply equal { enabled: true, required: true, …(1) }
      Tests  2 failed | 33 passed (35)
```

The seed test ran against the base fixture (restored from `HEAD` for that run): with nothing changed, no new version was published.

```text
$ cd apps/api && pnpm exec vitest run --coverage.enabled=false src/seed/dev-seed.test.ts -t "Phase 12A"
     × publishes the default template opting in to review for missing fields (Phase 12A C7)
AssertionError: expected 'itmplv_01M8…' not to be 'itmplv_01M8…' // Object.is equality
      Tests  1 failed | 36 skipped (37)
```

### C8 (`apps/api/src/jobs/missing-fields-review.test.ts`), against the base default template

```text
     × sends the verification to review; the inquiry completes, then is marked for review
AssertionError: expected { outcome: 'processed', …(2) } to deeply equal { outcome: 'processed', …(2) }
      Tests  1 failed | 1 passed (2)
```

The card is the synthetic Texas vector `dl-636015-version-08-zip-plus-4` without its `DAC` element, its designators recomputed, with a front that prints the other fields under labels. The test also asserts that no other required check failed or lacked evidence, so the missing field is the only reason for the review.

### C12 (`apps/api/src/vision/schemas.test.ts`)

```text
     × parses a document outline fitted from the text lines and portrait
ZodError: [ … invalid option … method … ]
      Tests  1 failed | 54 passed (55)
```

## GREEN

```text
$ pnpm exec vitest run --coverage.enabled=false src/viz-quebec.test.ts src/viz.test.ts
      Tests  102 passed (102)          # every existing viz.test.ts case unchanged
$ pnpm exec vitest run --coverage.enabled=false src/aamva-quebec.test.ts src/aamva.test.ts src/vectors.test.ts
      Tests  57 passed (57)
$ pnpm exec vitest run --coverage.enabled=false src/extraction src/government-id/id-extraction-inconsistency-detection.test.ts
      Tests  124 passed (124)
$ pnpm exec vitest run --coverage.enabled=false src/phase1 src/government-id src/calibration
      Tests  318 passed (318)
$ (packages/contracts) pnpm exec vitest run --coverage.enabled=false src/government-id-check-reasons.test.ts   → 47 passed
$ (apps/dashboard) pnpm exec vitest run --coverage.enabled=false src/lib/check-reasons.test.ts            → 148 passed
$ (apps/api) pnpm exec vitest run --coverage.enabled=false src/vision/schemas.test.ts                      → 55 passed
$ (apps/api) pnpm exec vitest run --coverage.enabled=false src/seed/dev-seed.test.ts                       → 37 passed
$ (apps/api) pnpm exec vitest run --coverage.enabled=false src/jobs/missing-fields-review.test.ts          → 2 passed
```

### The C36 calibration report is unchanged

`calibration:report` was run on the committed measurements three times: before C10, after C10, and after C9 with its floor. Each report was written to a scratch file, and `docs/calibration/` was not touched. All three are byte-identical. The handwritten-field variant still scores 0.462 against 0.383, the genuine cards stay at 0.064-0.304, and `blurred` still trips `id_blur_detection`:

```text
$ pnpm calibration:report --now 2026-10-21T12:00:00Z --output <scratch>/calib-after.md
wrote …/calib-after.md: 31 variants, 12 AAMVA images
$ diff <scratch>/calib-before.md <scratch>/calib-after.md    # (no output)
$ diff <scratch>/calib-before.md <scratch>/calib-c9b.md      # IDENTICAL
```

The report body at the start (with C1-C4 in place) also matched the committed `docs/calibration/government-id-phase3.md` above its Workflow 11E summary block.

### Contracts regenerated

```text
$ pnpm --filter @openverify/api openapi:write      # no diff
$ pnpm --filter @openverify/api workflow-docs:write # no diff
```

## Gates

```text
$ pnpm --filter <checks|core|contracts|api|dashboard> typecheck && lint     # all clean (after the fixes in Refactor)
$ pnpm exec prettier --check <every path of this agent>                     # All matched files use Prettier code style!
$ (packages/checks)    pnpm run test   → Test Files 189 passed, Tests 3934 passed (final run, after the C9 refinement); All files 98.76 % stmts, 91.45 % branch, 99.35 % funcs, 98.75 % lines
                       viz.ts 97.03/88.43/98.96/96.74, aamva.ts 99.23/94.57/100/99.2, scores.ts 97.77/82.83/97.72/97.45
$ (packages/core)      pnpm run test   → Test Files 70 passed, Tests 2013 passed; All files 99.24 / 94.5 / 99.73 / 99.21
$ (packages/contracts) pnpm run test   → Test Files 121 passed, Tests 4906 passed; All files 98.97 / 92.31 / 98.23 / 98.98
$ (apps/api)          pnpm run test   → Test Files 873 passed, Tests 11014 passed; All files 93.43 / 84.25 / 96.05 / 93.61 (final run)
$ (apps/dashboard)    pnpm run test   → Test Files 623 passed, Tests 7386 passed; All files 95.67 / 88.59 / 95.15 / 95.72
```

## Refactor

- **Lint.** In `testing/fixtures.ts`, the generic `quebecCase<Case>` became typed overloads (`no-unnecessary-type-parameters`). Unneeded `??` and `?.` were dropped in two tests.
- **Types.** Fixed a `FullSide` spread of a nullable `document_quality` in `blur-legibility.test.ts`, and a nested-index read of a stored `verificationConfig` in `dev-seed.test.ts` (it now uses `toMatchObject`).
- **One date reader.** `parseVizDate` now strips the hint and maps the confusions, then calls the unchanged reader (`readDate`). The in-line search (`dateInside`) and the labels share `stripHints`, so a hint means the same thing everywhere.

## Deviations from the plan, and why

1. **C4 offset bound.** The plan's fallback has no bound. It is bounded to 2 bytes because the committed invalid vector `subfile-offset-misplaced` (4 bytes off) must keep failing ("the existing vectors are unchanged"). Q12A-3 still decides whether real Quebec cards need more.
2. **C4 issues per case.** Only the two deviations the plan names carry an issue: `AAMVA` gives `aamva_header_nonstandard`, and the shifted offset gives `aamva_designator_offset_mismatch`. `qc-printed-number` (normalization) and `qc-v08` (a valid older version) are read with no issue, so they stay `valid`.
3. **New reason codes outside the listed paths.** The two new AAMVA issue codes become reasons of `id_barcode_inconsistency_detection`, an advisory check in the default template. They were added to `packages/contracts/src/government-id-check-reasons.ts` and its test, and to `apps/dashboard/src/lib/check-reasons.ts` (two words). The contract tests that tie the three lists together need all of them, and no other Stage 2 agent owns these paths.
4. **C9 floor and scope.** Legibility rescues only a side within half of each document threshold (`LEGIBLE_MIN_SHARPNESS_SHARE` 0.5). Without the floor, the C36 `blurred` variant passes (shown above). Vision's whole-image verdict is skipped only for a side with a measured document, and only when a document blur or Tenengrad threshold is configured, as it is by default. A `min-blur-score` a template sets still applies to every side.
5. **C2 chain.** "Top within three number-line heights below it" is applied line to line (each name line within three heights of the line above it). On the synthetic layout, the given-name line is 3.8 number-line heights below the number line itself.

## Hand-offs

- Stage 3 regenerates `docs/checks/*` (`docs:catalog`) for the new keys (`missing-fields-outcome`, `legible-text-min-confidence`, `legible-text-min-lines`), the new default (`missing-fields-outcome: fail`) and the two new reason codes. `contracts/fixtures/aamva/README.md` documents the issue codes and could list the two new ones.
- V3's thresholds go into `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_blur_detection` in Stage 3. This agent did not change them.
- `text_layout` is accepted end to end (C12) once vision-12a emits it (V2).
