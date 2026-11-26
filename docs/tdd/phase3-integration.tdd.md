# TDD evidence: Workflow 3A Stage 4, `integration`

- **Slice owner:** `integration` (Workflow 3A, Stage 4), alone, after every earlier agent.
- **Owned paths:** `e2e/`, `docs/checks/`, `docs/calibration/`, `.github/workflows/ci.yml`, `infra/tests/`, the Stage 4 amendments of `docs/plans/phase-3.plan.md`, this file, and any path needed to fix an integration defect test-first.
- **Date:** 2026-10-21.
- **Input:** `docs/plans/phase-3.plan.md` (C29–C38), ADR 0002, `docs/research/phase3-libraries.md`, `docs/research/phase3-ocr-license.md`, and the Stage 1–3 reports and evidence files.
- **Commits:** `5216c7c..929f6d8`, then this record.

Each item follows the same cycle:
1. Where a test needs a name that does not exist yet, a `chore` commit adds it as a stub that does nothing useful, so the RED test compiles, typechecks and passes mypy.
2. The test is run and seen failing for the intended reason (RED), and committed as `test(...)`.
3. The smallest change that passes it is committed as `feat(...)` or `fix(...)` (GREEN).
4. Refactors keep the suite green.

Every command ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown. Output is trimmed to the lines that matter. Where a GREEN run showed that a RED test itself expected something wrong, the correction is stated under GREEN; no test was skipped or weakened.

## 1. The e2e stack leaves every C35 provider unbound (C35, C36)

RED `5216c7c`, GREEN `9042c6f`.

The e2e processes inherit the shell's environment (`childEnvironment`), so a developer who exported `OPENVERIFY_PROVIDER_PUBLIC_FIGURE_SANDBOX=sandbox` would bind a provider the A-tier review spec needs unbound. The run environment now sets all six variables empty, and the e2e environment wins over the inherited one.

```text
$ pnpm --filter @openverify/e2e exec vitest run src/env.test.ts --coverage.enabled=false
     × leaves every C35 provider unbound, even when the shell binds one (C35, C36)
AssertionError: OPENVERIFY_PROVIDER_AAMVA_SANDBOX: expected undefined to be '' // Object.is equality
      Tests  1 failed | 13 passed (14)
$ pnpm --filter @openverify/e2e typecheck
$ tsc --noEmit
$ pnpm --filter @openverify/e2e exec vitest run src/env.test.ts --coverage.enabled=false     # GREEN
      Tests  14 passed (14)
```

## 2. `variantImage`, the path of a C36 variant side

Stub `80898a8`, RED `99382e3`, GREEN `03e0f5c`.

```text
$ pnpm --filter @openverify/e2e exec vitest run src/paths.test.ts --coverage.enabled=false
     × names a side of a C36 variant as the generator writes it
Error: variantImage(expired, front) is not implemented yet
      Tests  1 failed | 3 passed (4)
$ pnpm --filter @openverify/e2e exec vitest run src/paths.test.ts --coverage.enabled=false     # GREEN
      Tests  4 passed (4)
```

## 3. The shared flow submit helper (C38) and the C36 end-to-end specs

Refactor `fc8fd09` (the helper, and the console-gaps spec moved onto it), specs `1491468`.

`e2e/tests/support/platform.ts` gains `flowApi(...).submit` and `.verification`, `giveFlowConsent`, `submitGovernmentId` and `settledFlowVerification`. The new and changed specs:
- `verification-completes.spec.ts`: the H-tier group is `stage: beta` with a confidence and one threshold; the extraction (through `@openverify/node`'s `extractionOf`) equals the synthetic holder, with MRZ and VIZ as the sources of the MRZ fields;
- `government-id-checks.spec.ts`: expired, blurred and specimen cards;
- `government-id-review.spec.ts`: a required `id_public_figure_detection` without a provider.

The first run, before any fix (one Playwright run of four files under the e2e lock):

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/government-id-checks.spec.ts tests/government-id-review.spec.ts tests/verification-completes.spec.ts tests/ui-console-gaps.spec.ts'
  1) tests/government-id-checks.spec.ts:95:1 › a blurred card gets the blur retry hint, and a sharp photo then passes (C36)
    Locator: getByRole('heading', { name: 'We could not use your last photos', level: 1 })
    Error: element(s) not found
  2) tests/government-id-checks.spec.ts:143:1 › a specimen card fails id_compromised_detection on the marker it prints (C33, C36)
    -   "status": "failed",
    +   "status": "needs_review",
  2 failed
  5 passed (2.8m)
```

- **The five that passed** (expired, review, completes and the two console-gaps cases) pin behaviour Stages 2 and 3 built. The console-gaps pass is the refactor's evidence.
- **The blurred case** failed on the spec's own assumption. The flow shows the hint as an alert on the capture step ("Attempt 2 of 3"), and the user photographs the card again on the same step; there is no hint heading and no "Retake photos" button. The spec was corrected to the flow's markup before the commit; it passed in the GREEN run below.
- **The specimen case is the integration defect** of item 4: the stamped card ended in `needs_review` (its `id_mrz_inconsistency_detection` answered `input_missing`), not in a failure of `id_compromised_detection`.

## 4. The specimen card's markers are readable (C33, C36)

Stub `dc3f11d`, RED `a51c0ce`, GREEN `adec271`.

**Diagnosis**, run in a scratch directory with the real OCR models:
- On the front, the detector found the diagonal stamp as one quad starting at the portrait frame (x = 334), so it read `ECIMEN`: the `SP` over the photo is not detected.
- On the back, where the stamp crosses dense text, nothing is detected.
- Running the detector on single colour channels, with CLAHE, or on the image rotated to level the stamp (15.5 and 30 degrees) recovered at most `CIMEN`.

Fuzzy matching of partial marker words would break the frozen whole-word rule of C33. The fix is in the fixture, not in a check:
- the `specimen-stamped` card also prints the Phase 1 card's banner, `SPECIMEN - NOT A REAL DOCUMENT`, as published specimens print their markers;
- a new `specimen-overprint` variant keeps the stamp alone, so the calibration keeps measuring the overprint and shows it missed.

A scratch render of the banner read back as `'SPECIMEN - NOT A REAL DOCUMENT' 0.9749`.

```text
$ (cd services/vision && COVERAGE_FILE=/tmp/openverify-cov-integration uv run --frozen pytest tests/test_synthetic_id.py tests/test_synthetic_variants.py tests/test_make_synthetic_fixtures.py --no-cov -q)
E       AssertionError: assert 'OpenVerify s...tic test card' == 'SPECIMEN - N...REAL DOCUMENT'
E       AssertionError: assert 'SPECIMEN - NOT A REAL DOCUMENT' in ('UTOPIA', 'IDENTITY CARD', 'UTO', 'Surname', 'CALDERWOOD', 'Given names', ...)
E       NotImplementedError
E       AssertionError: assert ('happy', 'sp...-expiry', ...) == ('happy', 'sp...ismatch', ...)
E       AssertionError: assert 22 == 23
FAILED tests/test_synthetic_id.py::test_a_front_can_print_another_banner_in_the_banner_line_only
FAILED tests/test_synthetic_variants.py::test_the_specimen_stamped_front_also_prints_the_specimen_banner
FAILED tests/test_synthetic_variants.py::test_the_specimen_overprint_variant_is_the_stamp_alone
FAILED tests/test_synthetic_variants.py::test_a_data_variant_is_a_kebab_case_variant_expecting_catalog_checks[specimen_overprint]
FAILED tests/test_synthetic_variants.py::test_the_c36_set_is_the_happy_card_then_every_planned_variant_in_order
FAILED tests/test_make_synthetic_fixtures.py::test_the_index_lists_the_happy_card_and_every_variant_with_its_files
FAILED tests/test_make_synthetic_fixtures.py::test_the_version_is_bumped_for_the_specimen_banner_and_the_overprint_variant
7 failed, 87 passed in 20.56s
$ (cd services/vision && ... pytest tests/test_synthetic_id.py tests/test_synthetic_variants.py tests/test_make_synthetic_fixtures.py tests/test_calibrate_government_id.py --no-cov -q)   # GREEN
102 passed in 31.72s
$ (cd services/vision && flock /tmp/openverify-e2e.lock uv run --frozen python tools/make_synthetic_fixtures.py)
wrote /home/mhnoor/persona-opensource/fixtures/generated/variants.json (51401 bytes)      # stamp 5
```

Two existing tests changed with the new variant: the plan-order list gained `specimen-overprint`, and the index count went from 22 to 23.

## 5. The calibration judges vision's whole-image defaults (C36)

Python: RED `e26f5d6`, GREEN `a006521`. TypeScript: RED `431bcc2`, GREEN `cd6ebe6`.

The report showed `-` as the current default of `min-blur-score` and `max-glare-ratio`, because a template that leaves them unset keeps vision's verdict. The measurements now carry the thresholds vision judged with, and the report judges them, marked "(vision)".

```text
$ (cd services/vision && ... pytest tests/test_calibrate_government_id.py --no-cov -q)
E       KeyError: 'quality_thresholds'
FAILED tests/test_calibrate_government_id.py::test_it_records_the_whole_image_thresholds_vision_judged_with
1 failed, 8 passed in 11.68s
$ (cd services/vision && ... pytest tests/test_calibrate_government_id.py --no-cov -q)    # GREEN
9 passed in 11.34s
$ pnpm --filter @openverify/checks exec vitest run src/calibration --coverage.enabled=false
     × judges vision's whole-image defaults by the thresholds the measurements carry
AssertionError: expected { check: 'id_blur_detection', …(10) } to match object { current: 100, …(2) }
      Tests  1 failed | 16 passed (17)
$ pnpm --filter @openverify/checks exec vitest run src/calibration --coverage.enabled=false     # GREEN
      Tests  17 passed (17)
```

## 6. The calibration run and the defaults (C29.5, C34, C36)

RED `1abce65`, GREEN `87e05cb`, report `9a42384`.

```text
$ (cd services/vision && uv run --frozen python tools/calibrate_government_id.py)       # 1 min 16 s
wrote /home/mhnoor/persona-opensource/fixtures/generated/calibration/government-id-measurements.json: 31 variants, 12 AAMVA images
$ pnpm --filter @openverify/checks calibration:report --now 2026-10-21T12:00:00Z
wrote /home/mhnoor/persona-opensource/docs/calibration/government-id-phase3.md: 31 variants, 12 AAMVA images
```

The RED test pins the report's midpoints:

```text
$ pnpm --filter @openverify/core exec vitest run src/check-config.test.ts --coverage.enabled=false
     × take the C36 calibration of docs/calibration/government-id-phase3.md (Workflow 3A Stage 4)
-     "min-document-blur-score": 96.56,
-     "min-document-tenengrad": 5471,
-     "min-document-width-px": 616,
+     "min-document-blur-score": 50,
+     "min-document-width-px": 500,
-     "max-color-inconsistency-score": 0.622,
+     "max-color-inconsistency-score": 0.5,
-     "min-front-back-phash-distance": 13,
+     "min-front-back-phash-distance": 12,
-     "max-electronic-replica-score": 0.418,
+     "max-electronic-replica-score": 0.5,
-     "max-document-glare-ratio": 0.055,
+     "max-document-glare-ratio": 0.1,
-     "max-handwriting-score": 0.383,
+     "max-handwriting-score": 0.5,
```

**GREEN and the correction of the RED test.** With `min-document-tenengrad` at 5,471, 25 checks and api tests failed: the golden contract fixture's hand-written Tenengrad (2,876 and 2,512) is far below every real measurement (8,288–16,754), and the golden card failed `id_blur_detection`. The blur score already separates the blurred card (margin 81.56), and one synthetic design does not establish this contrast-dependent measure's scale. So the RED expectation of a Tenengrad default was wrong: the GREEN commit leaves the key template-only, and the test asserts that it has no default.

The remaining failures were tests that pinned the provisional values, which C36 replaces. Each was changed minimally:
- `packages/checks/src/government-id/context.test.ts`: the merged defaults;
- `heuristics.test.ts`: the colour provenance (0.622), and the entity test. Its "moderate" moiré of 0.45 now exceeds the calibrated replica threshold, so it is 0.35, still below every threshold as the test intends; the recapture component is (0.95 − 0.418) / (1 − 0.418) = 0.9141;
- `calibration/report.test.ts`: the current defaults and margins;
- `apps/api/src/jobs/process-verification.test.ts`: the provenance thresholds.

```text
$ pnpm --filter @openverify/core exec vitest run --coverage.enabled=false            # GREEN
      Tests  504 passed (504)
$ pnpm --filter @openverify/checks exec vitest run --coverage.enabled=false
      Tests  1083 passed (1083)
$ pnpm --filter @openverify/api exec vitest run --coverage.enabled=false
      Tests  2189 passed (2189)
$ pnpm --filter @openverify/contracts exec vitest run --coverage.enabled=false
      Tests  1290 passed (1290)
```

Over the 31 variants after the change, no genuine card (happy, on-background, TD3 passport, MRV-A visa, four distinct holders, four re-encodings) fails any check:
- **Tripped as built:** specimen-stamped, expired, bad MRZ check digit, MRZ-VIZ mismatch, issued after expiry, under-age, PO box, blurred, glare, low resolution, photocopy, screen recapture, handwritten field (newly caught at 0.383), front reused as back, no portrait, not an ID.
- **Missed:** specimen-overprint (item 4); portrait swap (0.394) and copy-move (0.41), inside the genuine tamper range up to 0.441.

## 7. The C36 end-to-end specs, GREEN

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/government-id-checks.spec.ts tests/government-id-review.spec.ts tests/verification-completes.spec.ts'
  ✓  1 tests/government-id-checks.spec.ts:59:1 › an expired card fails id_expired_detection, and the flow offers no retry (C36) (5.3s)
  ✓  2 tests/government-id-checks.spec.ts:98:1 › a blurred card gets the blur retry hint, and a sharp photo then passes (C36) (9.6s)
  ✓  3 tests/government-id-checks.spec.ts:148:1 › a specimen card fails id_compromised_detection on the marker it prints (C33, C36) (3.3s)
  ✓  4 tests/government-id-review.spec.ts:28:1 › a required A-tier check without a provider sends the inquiry to review, and the selfie is still compared (C30, C35) (7.9s)
  ✓  5 tests/verification-completes.spec.ts:63:1 › an inquiry on the default template completes with every required check passed (9.9s)
  5 passed (1.2m)
```

## 8. The C32.4 benchmark

Stub `c0e1375`, RED `e3dbefe`, GREEN `f90ce2f`.

`services/vision/tools/benchmark_government_id.py`:
- it posts both sides of the happy card, scaled to 1,600 px wide, to `/v1/analyze/government-id` of the app in process, with the real models;
- after one warm-up, it times 10 runs and each stage of `analyze_government_id_side`, through wrappers it installs and always restores;
- it records the CPU model and prints Markdown, with JSON on request;
- it exits 1 only with `--enforce` over the budget.

The tests use a fixed face, the fake OCR models of `tests/ocr_fakes.py` and gradient photos.

```text
$ (cd services/vision && ... pytest tests/test_benchmark_government_id.py --no-cov -q)
E       AssertionError: assert () == ('faces and q...clarity', ...)
E       NotImplementedError        (11 tests)
E           assert <function perceptual_hash at 0x...> is not <function perceptual_hash at 0x...>
13 failed, 1 passed in 0.85s
$ (cd services/vision && ... pytest tests/test_benchmark_government_id.py -q --cov=tools --cov-report=term-missing --cov-fail-under=0)   # GREEN
tools/benchmark_government_id.py                 167      0     14      0   100%
14 passed in 4.82s
```

The one test that passed at RED checks that the stages are restored after a failure. With the stub's empty stage list it held trivially; it guards the GREEN code.

The real run:

```text
$ (cd services/vision && uv run --frozen python tools/benchmark_government_id.py)
## Government ID analysis benchmark (C32.4)
- CPU: Intel(R) Xeon(R) CPU E5-1650 v3 @ 3.50GHz, 12 logical CPUs
- Input: both sides of the synthetic Utopia card, 1600 x 1010 px, JPEG quality 92
- Runs: 10, after one warm-up request that loads the models
- Median 2.62 s (min 2.60 s, max 2.80 s): within the 5.00 s budget
| faces and quality | 76 |   | document | 134 |   | mrz | 145 |   | ocr (visual zone) | 1558 |
| barcodes | 99 |   | portrait clarity | 1 |   | document quality | 52 |   | phash | 9 |
| forensics | 531 |   | other (decode, upload, response) | 28 |
```

## 9. The CI benchmark step

RED `6a9efa7`, GREEN `4e106f3`.

```text
$ bash infra/tests/ci-workflow.test.sh
FAIL - vision: runs the C32.4 benchmark (tools/benchmark_government_id.py)
FAIL - vision: the benchmark runs after pytest
FAIL - vision: the benchmark is logged, never gated on a runner's speed (no --enforce)
FAIL - vision: the benchmark appends its Markdown summary to the job summary
FAIL - vision: the benchmark step fails when the tool fails (bash with pipefail)
# 116 passed, 5 failed, 0 skipped
$ bash infra/tests/ci-workflow.test.sh                     # GREEN
ok   - actionlint 1.7.12 reports no problems
# 121 passed, 0 failed, 0 skipped
```

## 10. The downloaded OCR dictionary is gitignored

RED `f4af1ee`, GREEN `1b55095`.

`models/ppocrv6_small_rec_inference.yml`, the recognizer dictionary that `fetch_models.py` downloads, showed as untracked, so a broad `git add` would commit a downloaded artefact (CLAUDE.md rule 6).

```text
$ (cd services/vision && ... pytest tests/test_manifest.py --no-cov -q)
E       AssertionError: assert ['models/Mini...all_rec.onnx'] == ['models/Mini...ec.onnx', ...]
E         Right contains one more item: 'models/ppocrv6_small_rec_inference.yml'
1 failed, 7 passed in 0.47s
$ (cd services/vision && ... pytest tests/test_manifest.py --no-cov -q)     # GREEN, after models/**/*.yml
8 passed in 0.44s
```

## 11. The C34 lookup integration test under load

Fix `929f6d8`.

The first `pnpm test:integration` of the validation failed one db test with `Test timed out in 30000ms`: `finds repeats through the blind-index and pHash band indexes`, while the api suite ran beside it. Alone, its two tests took 13.8 s and 11.3 s, almost all of it bulk-inserting 50,000 and 40,000 filler extractions in the test body.

The fix moves that seeding into a `beforeAll`, under the 180 s hook timeout. The test bodies keep every assertion, the EXPLAIN checks included, and now take 1.2 s and 0.75 s.

```text
$ pnpm turbo run test:integration --force                  # before
@openverify/db:test:integration:  FAIL  src/government-id-lookups.integration.test.ts > ... > finds repeats through the blind-index and pHash band indexes, every match within the distance
@openverify/db:test:integration: Error: Test timed out in 30000ms.
@openverify/db:test:integration:       Tests  1 failed | 45 passed (46)
$ pnpm turbo run test:integration --force                  # after, the same parallel load
@openverify/api:test:integration:       Tests  36 passed (36)
@openverify/db:test:integration:  ✓ src/government-id-lookups.integration.test.ts (2 tests) 58198ms
@openverify/db:test:integration:       Tests  46 passed (46)
```

## 12. Documentation

`docs/checks/government-id.md` and `docs/checks/sandbox-providers.md` (`5c878a3`), and the Stage 4 plan amendments (`0bf6ab9`). The facts in them were read from the code: the registry entries, `GOVERNMENT_ID_CHECK_REASONS`, the config schemas and defaults, the evaluators' headers, the feature table, the sandbox providers and the calibration report.

## Final gates: the plan's validation list, in order

```text
$ flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile && pnpm turbo run lint typecheck --force && pnpm format:check
 Tasks:    24 successful, 24 total          Cached:    0 cached, 24 total
All matched files use Prettier code style!
$ pnpm test:coverage                                       (turbo run test --force, 4m45s)
@openverify/config      Tests   44 passed   All files 100 | 100 | 100 | 100
@openverify/core        Tests  504 passed   All files 100 | 100 | 100 | 100
@openverify/flow-spec   Tests   81 passed   All files 100 | 100 | 100 | 100
@openverify/node        Tests  208 passed   All files 99.08 | 94.64 | 100 | 99.37
@openverify/contracts   Tests 1290 passed   All files 100 | 100 | 100 | 100
@openverify/ui          Tests   54 passed   All files 100 | 97.72 | 100 | 100
@openverify/checks      Tests 1083 passed   All files 98.77 | 90.13 | 99.52 | 98.69
@openverify/flow        Tests  524 passed   All files 98.8 | 95.55 | 99.26 | 98.87
@openverify/db          Tests  635 passed   All files 98.84 | 92.37 | 99.41 | 98.78
@openverify/dashboard   Tests 1429 passed   All files 98.43 | 94.42 | 98.69 | 98.45
@openverify/api         Tests 2189 passed   All files 97.54 | 90.47 | 98.46 | 97.59
@openverify/e2e         Tests   74 passed   All files 96.69 | 88.07 | 93.15 | 97.68
 Tasks:    12 successful, 12 total          Cached:    0 cached, 12 total
$ pnpm turbo run test:integration --force                  (after item 11)
api 36 passed; db 46 passed
$ python3 scripts/fetch_models.py
(all seven entries present, pinned SHA-256)
$ (cd services/vision && uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools && uv run --frozen pytest)
All checks passed! / 114 files already formatted / Success: no issues found in 45 source files
TOTAL 4377 0 648 0 100%   1223 passed in 116.02s
$ (cd android && ./gradlew testDebugUnitTest koverVerify assembleDebug lint)
BUILD SUCCESSFUL
$ (cd android && ./gradlew testDebugUnitTest koverVerify --rerun-tasks)
BUILD SUCCESSFUL in 1m 18s     477 tests, 0 skipped, 0 failures, 0 errors
$ flock /tmp/openverify-e2e.lock pnpm e2e                   (3m58s)
@openverify/flow:e2e:   25 passed (9.7s)
@openverify/e2e:e2e: [e2e +36.5s] stack ready
@openverify/e2e:e2e:   43 passed (3.9m)
$ gitleaks git --redact .
949 commits scanned. no leaks found
```
