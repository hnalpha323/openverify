# TDD evidence: Workflow 3A Stage 1, `contracts` (C29-C33 contracts, storage and plumbing)

- **Slice owner:** `contracts` (Workflow 3A, Stage 1). It ran alone, so it could touch any path the deliverables needed.
- **Date:** 2026-10-20 and 2026-10-21.
- **Input:** `docs/plans/phase-3.plan.md`, "Workflow 3A", Stage 1. The decisions it had to take are recorded there under "Workflow 3A Stage 1 amendments (contracts)".
- **Commits:** `ec047e0..875d663` (36 commits).

Each item follows the same cycle:
1. Write a test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

A RED test must compile, typecheck (TypeScript) and import (Python). So whenever a test needed a name that did not exist yet, a `chore` commit added it first as a stub that does nothing useful (an empty list, an optional field, a function raising `NotImplementedError`).

All commands ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown. Output is trimmed to the lines that matter.

## 1. Registry fields (C29.1)

Stub `ec047e0` (`CHECK_INPUTS` empty; optional `version`, `modelBased`, `inputs`), RED `c1d1988`, GREEN `e89cefc`.

### RED

```text
$ (cd packages/core && pnpm exec vitest run src/check-registry.test.ts src/enums.test.ts --coverage.enabled=false)
     × lists every check input value in order
     × the check input schema accepts exactly its listed values
     × registers every §4.1 government ID check with its tier, type and stage
     × registers every §4.2 selfie check with its tier, type and stage
     × registers §4.3 check document_type_detection
     × gives every §4 check an id, tier, type, stage, version, modelBased and inputs
AssertionError: id_unprocessable_submission_detection: expected undefined to be 1
     × marks exactly the checks a learned model can decide as model-based
AssertionError: expected [] to deeply equal [ …(30) ]
     × derives beta for H, A/H, H/A and model-based checks
AssertionError: id_portrait_detection: expected 'ga' to be 'beta'
     × lists the inputs of every §4.1 check, in CHECK_INPUTS order
     × names the provider input for every check with an adapter tier
     × refuses a definition without version, modelBased or inputs, or with bad values
AssertionError: version: expected true to be false
      Tests  13 failed | 74 passed (87)
```

### GREEN

`defineCheck` takes a spec `{ inputs, modelBased?, version?, configSchema? }`. Stage is `beta` for H, A/H, H/A and model-based entries.

```text
$ (cd packages/core && pnpm exec vitest run src/check-registry.test.ts src/enums.test.ts --coverage.enabled=false)
      Tests  87 passed (87)
$ (cd packages/core && pnpm test)
      Tests  408 passed (408)
Statements   : 100% ( 258/258 )   Branches : 100% ( 131/131 )
```

## 2. Result fields (C29.2, core and the builder)

Stub `12d9611`, RED `067c39f`, GREEN `e103d98`.

### RED

```text
$ (cd packages/core && pnpm exec vitest run src/check-result.test.ts --coverage.enabled=false)
     × are required: stage / confidence / provenance
     × accept a confidence in [0, 1] or null
     × reject a provenance with no implementation version / implementation version 0 / no thresholds
       / a camelCase threshold / an object threshold / an empty model list / a model without a SHA-256
       / a provider without its sandbox flag / an unknown member
      Tests  13 failed | 10 passed (23)
$ (cd packages/checks && pnpm exec vitest run src/result.test.ts src/phase1/selfie-checks.test.ts --coverage.enabled=false)
     × takes the check type, stage and implementation version from the core registry
AssertionError: expected { name: 'id_blur_detection', …(4) } to deeply equal { name: 'id_blur_detection', …(7) }
     × carries the confidence, thresholds, models and provider it is given (C29.2)
     × leaves models and provider out when they were not used
     × refuses a passed or failed H-tier result without a confidence (ADR 0002 §3c)
AssertionError: expected [Function] to throw an error
     × refuses a confidence of -0.1 / 1.5 / NaN / Infinity
     × refuses a threshold key that is not kebab-case
     × also fills the C29.2 fields: stage beta, the confidence and the threshold judged
AssertionError: expected undefined to be 'beta'
     × has no confidence when a face is missing, since nothing was compared
      Tests  11 failed | 25 passed (36)
```

### GREEN

```text
$ (cd packages/core && pnpm test)       Tests  423 passed (423), 100% coverage
$ (cd packages/checks && pnpm test)     Tests  465 passed (465), 99.81 / 97.91 / 100 / 99.8
$ pnpm turbo run typecheck --force      Tasks: 12 successful, 12 total
$ (cd apps/api && pnpm exec vitest run src/jobs src/worker.test.ts --coverage.enabled=false)
      Tests  160 passed (160)
```

## 3. Stored results and the API read schema (C29.2)

Stub `9a95915`, RED `ba573ec`, GREEN `e5260ed` (migration `0010_check_result_provenance`).

### RED

```text
$ (cd packages/contracts && pnpm exec vitest run src/verifications.test.ts --coverage.enabled=false)
     × are optional on a check, so earlier answers still parse
AssertionError: expected false to be true
     × are built from the record; a stored row without a stage takes it from the registry
      Tests  2 failed | 22 passed (24)
$ (cd packages/db && pnpm exec vitest run src/repositories/verifications-v3.test.ts --coverage.enabled=false)
     × stores and reads them back with each check
     × reads a check stored without them, as Phase 1 and 2 rows are, as null
     × refuses a stage or confidence outside the contract
AssertionError: promise resolved "[ { …(10) } ]" instead of rejecting
      Tests  3 failed (3)
$ (cd apps/api && pnpm exec vitest run src/jobs/records.test.ts src/jobs/process-verification.test.ts --coverage.enabled=false)
     × carries each stored check stage, confidence and provenance (C29.2)
     × stores each check's stage, confidence and provenance (C29.2)
     × compares the selfie with a fresh analysis of the stored ID front and completes the inquiry
     × records a configured threshold in the provenance too (C29.2)
      Tests  4 failed | 66 passed (70)
```

### GREEN

```text
$ (cd packages/contracts && pnpm exec vitest run --coverage.enabled=false)   Tests  1230 passed (1230)
$ (cd packages/db && pnpm exec vitest run src/migrate.test.ts src/repositories --coverage.enabled=false)
      Tests  223 passed (223)
$ (cd apps/api && pnpm exec vitest run --coverage.enabled=false)              Tests  2068 passed (2068)
$ pnpm --filter @openverify/api openapi:write   (twice; cmp of the two outputs: identical)
```

`confidence` is `double precision`: a `real` would serve 0.8199999928 for a computed 0.82.

## 4. Decisions and `needs_review` (C30.1, C30.4-C30.6)

Stub `4d1a676`, RED `823f812`, GREEN `474d06e` (migration `0011_verification_needs_review`).

### RED

```text
$ (cd packages/core && pnpm exec vitest run --coverage.enabled=false)
     × declares exactly the C10 table
     × allows submitted -> needs_review and returns the event of the target
     × enters needs_review only from submitted, with no verification event (C30.4)
     × sends a verification with a pending required check to review (C30.1)
     × treats a required check without a result as needing review, never as passed
     × sends a required not_applicable check with input_missing / no_reference_data / execution_error
       / provider_not_configured / no reason at all / a non-blocking and a blocking reason to review
     × lets a failure win over review, and review over a passing required check
     × is not retryable while it needs review or is pending
     × merges ["passed","pending"] conservatively to needs_review
     × feeds straight into decideVerification
     × lets only feature_absent and not_requested leave a required check without evidence
      Tests  16 failed | 436 passed (452)
$ (cd packages/contracts && pnpm exec vitest run src/verification-types.test.ts --coverage.enabled=false)
     × maps decision-engine outcomes to verification statuses           Tests  1 failed | 7 passed (8)
$ (cd apps/dashboard && pnpm exec vitest run src/components/status-badge.test.tsx --coverage.enabled=false)
     × labels needs_review "Needs review" and marks it for attention (C30.4)
     × has a human-readable label for needs_review                      Tests  2 failed | 23 passed (25)
$ (cd apps/flow && pnpm exec vitest run src/flow/flow-position.test.ts src/steps/processing-step.test.tsx --coverage.enabled=false)
     × moves to the next step once needs_review
     × moves on for a { status: 'needs_review' } decision                 Tests  2 failed | 42 passed (44)
$ (cd packages/db && pnpm exec vitest run src/migrate.test.ts src/repositories/verifications-v3.test.ts --coverage.enabled=false)
     × adds needs_review to verification_status in its own migration, 0011 (C30.4)
AssertionError: expected undefined to be '0011_verification_needs_review'
     × lets a submitted verification wait for an operator, stamping completed_at
Serialized Error: { severity: 'ERROR', code: '22P02', routine: 'enum_in' }
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/migration-v3.integration.test.ts)
     × apply in one batch on an empty database, after which needs_review can be stored   (22P02 enum_in)
     × upgrade a Phase 2 database with rows in it the same way                            (22P02 enum_in)
$ (cd apps/api && pnpm exec vitest run src/jobs/inquiry-outcome.test.ts src/jobs/process-verification.test.ts --coverage.enabled=false)
     × sends the inquiry to review once every required type is decided and one needs review (C30.5)
AssertionError: expected null to be 'needs_review'
     × sends a verification to review when a required check has no evaluator (C30.1, C30.4)
     × completes the inquiry, then marks it for review, in one transaction and in that order (C30.5)
      Tests  3 failed | 84 passed (87)
$ (cd android && ./gradlew --no-daemon -q :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.model.WireModelTest' --tests 'dev.openverify.sdk.flow.FlowCoordinatorTest')
104 tests completed, 3 failed
  needs_review is a known verification status that ends polling (C30_6): expected: <true> but was: <false>
  an ID sent to review counts as done, so the selfie opens without retry hints (C30_6)
  resuming after an ID in review opens the selfie (C30_6)
```

### GREEN

```text
core 452 passed (100%); contracts 1230; checks 465; db unit 582; db migration-v3.integration 2 passed (Testcontainers,
pgvector/pgvector:pg17); api 2074; dashboard 1429; flow 524; node 205;
android WireModelTest tests="23" failures="0", FlowCoordinatorTest tests="81" failures="0".
$ pnpm --filter @openverify/api openapi:write   (twice; the second run changed nothing)
```

The worker test checks the staged order: `verification.passed`, `inquiry.completed`, `inquiry.transitioned`, `inquiry.marked-for-review`, `inquiry.transitioned`, all in one transaction.

## 5. `id_double_side_detection` answers `not_requested` (C29.6; C30.1 needs it)

RED `aa27258`, GREEN `9b522e8`.

```text
$ (cd packages/checks && pnpm exec vitest run src/phase1/government-id-checks.test.ts --coverage.enabled=false)
     × is not requested when the step needs only the front (C29.6)
     × is not requested when the step needs only the back (C29.6)
AssertionError: expected { …(8) } to match object { status: 'not_applicable', …(2) }
      Tests  2 failed | 20 passed (22)
GREEN: checks 465 passed; api src/jobs 147 passed.
```

## 6. The reasons file (C29.4)

Stub `c5c95e2`, RED `e12e618`, GREEN `ab9ad14`.

```text
$ (cd packages/contracts && pnpm exec vitest run src/government-id-check-reasons.test.ts --coverage.enabled=false)
     × are the seven reasons of the C29.4 table
AssertionError: expected [] to deeply equal [ 'feature_absent', …(6) ]
     × name feature_absent and not_requested as the only non-blocking ones, as the decision engine
     × lists every §4.1 check, and nothing else
AssertionError: expected [] to deeply equal [ 'id_aamva_database_lookup', …(35) ]
     × keeps every Phase 1 reason, so PHASE1_CHECK_REASONS stays a subset
     × gives provider_not_configured to the checks that need a provider, and only them
     × holds only snake_case reason codes, each once, and is frozen
      Tests  6 failed | 4 passed (10)
GREEN: Tests 10 passed (10); (cd packages/contracts && pnpm test) 1242 passed, 100% coverage.
```

## 7. Extraction contract, storage and the blind index (C31.5-C31.8)

Stub `b04cf20`, RED `0d83c76`, GREEN `2882f09` (migration `0012_government_id_extractions`).

The blind index vectors were computed with an independent HMAC implementation, OpenSSL 3.0.13, using the public test key of bytes `0x00..0x1f`:

```text
$ printf '%s' 'UTO|passport|L898902C3' | openssl dgst -sha256 -mac HMAC -macopt hexkey:000102…1e1f
3f92f9ea962cb9852512c874097caee2ff7bb151a1c3d1a036c58f3db2e67767
636014|drivers_license|Y9876543  => dca5a928e4376d5b51105446228bf4d1f1264eb73be3605e346fb5439b6113d4
D|national_id|ZX1234567          => c3ac4010c40af515f8f1810da8abd3131d09e38074958202caf9c1b15a2e9f66
UTO|unknown|D23145890            => 6601cedaeeb2090c909bb3aa6b849ab8d36507804cf43e041eeec17d2303defc
(key 0xff × 32) UTO|passport|L898902C3 => ee90a3cec3b31e4ad8476995b8d85ef864eaac3d21f0a9940b507eafeee634db
```

### RED

```text
$ (cd packages/core && pnpm exec vitest run src/extraction.test.ts --coverage.enabled=false)
     × accept a full record and an empty one, with every field present
     × reject an impossible date / a compact date / a sex outside M, F and X / a two-letter nationality / …
     × reject an empty source list / an unknown source / a source named twice / an unknown field / …
      Tests  18 failed | 2 passed (20)
$ (cd packages/contracts && pnpm exec vitest run src/verifications.test.ts --coverage.enabled=false)
     × names every C31.5 field as a PII attribute, and not the sources
     × are built from the extraction, with the sources that agreed
     × are null without an extraction, and every value is null after redaction
     × are optional, so earlier answers still parse, and nullable
      Tests  4 failed | 29 passed (33)
$ (cd apps/api && pnpm exec vitest run src/auth/pii.test.ts --coverage.enabled=false)
     × are hidden from a pii-masked API key and a user without pii:view   Tests  1 failed | 13 passed (14)
$ (cd packages/db && pnpm exec vitest run src/blind-index.test.ts --coverage.enabled=false)
     × matches the HMAC-SHA-256 vector for … (4 vectors) / depends on the key / gives the same index to the
       same number however it was printed or read / separates issuers and class groups / refuses a key that is
       not 32 bytes / upper-cases the number… / numbers each class separately… / is base64 of 32 bytes /
       refuses a key that is missing / blank / the change-me placeholder / 16 bytes / not base64
      Tests  16 failed | 1 passed (17)
$ (cd packages/db && pnpm exec vitest run src/repositories/government-id-extractions.test.ts --coverage.enabled=false)
     × stores one extraction per verification and reads it back decrypted
     × seals the fields to their row, so no value is stored in plain text
     × replaces the extraction of a verification processed again (a job retry)
     × accepts an extraction without a blind index or perceptual hash
     × keeps to its environment
     × redacts the fields, the blind index and the perceptual hash with its bands
     × is redacted with its inquiry (C16 redactInquiryRecords)
     × takes part in the KEK rewrap, keyed by verification id
      Tests  8 failed | 5 passed (13)
$ (cd apps/api && pnpm exec vitest run src/config.test.ts --coverage.enabled=false)
     × reports every missing required variable at once
     × reads OPENVERIFY_BLIND_INDEX_KEY as 32 bytes
     × refuses a key of 16 bytes / not base64 / the change-me placeholder and names the variable without echoing it
     × refuses the KEK as the blind index key: they are separate secrets
      Tests  6 failed | 45 passed (51)
$ (cd apps/api && pnpm exec vitest run src/services/redaction.test.ts --coverage.enabled=false)
     × seeds every encrypted table except operator data
     × leaves nothing of the subject in any table or in storage
     × nulls the PII columns and empties the check details …  (the seed called the createGovernmentIdExtraction stub)
$ (cd e2e && pnpm exec vitest run src/env.test.ts --coverage.enabled=false)
     × generates every secret at random, long enough for the services that check
$ bash infra/tests/compose.test.sh
FAIL - .env.example declares OPENVERIFY_BLIND_INDEX_KEY
FAIL - api reads the blind index key (C31.8)
# 188 passed, 2 failed
```

gitleaks refused the first attempt at the RED commit: it flagged the base64 literal of the public test key. The test now derives that value from the key bytes instead of adding an ignore entry.

### GREEN

```text
core extraction 20 passed; contracts 1251 passed; db pnpm test 613 passed (99.04 / 92.52 / 99.39 / 98.99);
api config + pii + redaction + worker 112 passed, whole api 2081 passed; e2e env 13 passed;
$ bash infra/tests/compose.test.sh   # 190 passed, 0 failed
$ pnpm --filter @openverify/api openapi:write   (twice; second run unchanged)
$ pnpm turbo run typecheck --force   Tasks: 12 successful
```

## 8. Dependencies (C33)

RED `0997e55`, GREEN `390a41e`.

Each licence was checked at its pinned version:

| Package | Registry | Licence | Released | Installed licence file |
|---|---|---|---|---|
| zxing-cpp 3.1.1 | PyPI | `license_expression` Apache-2.0 | 2026-07-29 | `zxing_cpp-3.1.1.dist-info/licenses/LICENSE`: Apache License 2.0 |
| pdf417gen 0.8.1 | PyPI | MIT classifier; the licence text is MIT | 2025-01-23 | MIT text |
| iso3166 3.0.0 | PyPI | `license_expression` MIT | 2026-09-03 | `License-Expression: MIT` |
| mrz 5.0.2 | npm (`pnpm view mrz@5.0.2`) | license MIT, no dependencies | 2026-03-11 | `node_modules/mrz/LICENSE`: The MIT License |

```text
$ flock /tmp/openverify-uv.lock uv add "zxing-cpp==3.1.1"
$ flock /tmp/openverify-uv.lock uv add --dev "pdf417gen==0.8.1" "iso3166==3.0.0"
$ flock /tmp/openverify-pnpm.lock pnpm --filter @openverify/checks add -D mrz@5.0.2
  (pnpm-workspace.yaml unchanged: no minimumReleaseAgeExclude entry, no build script)
```

To see the RED, `pyproject.toml` and `uv.lock` were put back to their state before the add:

```text
$ (cd services/vision && COVERAGE_FILE=/tmp/openverify-cov-contracts uv run --frozen pytest tests/test_dependencies.py --no-cov -q)
FAILED tests/test_dependencies.py::test_zxing_cpp_is_a_pinned_runtime_dependency
FAILED tests/test_dependencies.py::test_the_fixture_generators_get_pinned_dev_dependencies
2 failed, 1 passed
GREEN (the added pins restored, uv lock --check: Resolved 53 packages): 3 passed
```

## 9. Vision analysis v2 (C32.1)

Stub `814ffcb`, RED `a71bcc5`, GREEN `f895738`.

Before the change, the C6 fields of `analyze-government-id.json` were digested: `model_versions.detector` and `recognizer`, and each side's `quality`, `faces` and `portrait`, as canonical JSON. The digest is `c9fb0f882cdcb2d134e93bf0efe9b2f934d1c26774f7378f254f9b4351496b7e`, and `test_contract_fixtures.py` pins it.

### RED

```text
$ (cd services/vision && COVERAGE_FILE=/tmp/openverify-cov-contracts uv run --frozen pytest tests/test_schemas_v2.py --no-cov -q)
10 failed, 40 passed
```

The round-trip and acceptance cases failed. The rejection cases passed only because the stub `SideAnalysis` refused every v2 field.

```text
$ (… pytest tests/test_analysis_v2.py tests/test_document.py tests/test_ocr.py tests/test_mrz_locate.py tests/test_barcode.py tests/test_forensics.py --no-cov -q)
11 failed in 0.46s                    (NotImplementedError from each stub)
$ (… pytest tests/test_app_analyze.py tests/test_contract_fixtures.py tests/test_schemas.py --no-cov -q)
FAILED test_government_id_front_only; test_government_id_sides_carry_the_v2_measurements;
       test_fixture_dir_is_the_shared_contracts_location; the barcode fixture round trip and generator
       equality (FileNotFoundError); test_the_card_fixture_shows_every_v2_measurement;
       test_the_barcode_fixture_is_a_barcode_only_image…; test_government_id_round_trips_exactly;
       test_government_id_back_is_required_but_nullable
$ (cd apps/api && pnpm exec vitest run src/vision/schemas.test.ts --coverage.enabled=false)
     × parses both v2 golden fixtures unchanged, the barcode-only image included
     × names the text models, or null while no OCR model ran
     × accepts a side where nothing was measured
     × rejects a quad with three corners … × refuses more than 200 text lines
      Tests  22 failed | 31 passed (53)
```

### GREEN

```text
$ (cd services/vision && uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools)
All checks passed! / 54 files already formatted / Success: no issues found in 22 source files
$ (cd services/vision && uv run --frozen pytest)   518 passed, total coverage 100.00%
$ (cd services/vision && uv run python tools/make_contract_fixtures.py) && pnpm exec prettier --write contracts/fixtures/vision/*.json
```

After regeneration, every line of the old `analyze-government-id.json` appears in order in the new file; only trailing commas were added. The digest of the C6 fields is unchanged.

```text
$ (cd apps/api && pnpm exec vitest run src/vision src/ports.test.ts src/jobs --coverage.enabled=false)
      Tests  244 passed (244)
```

## 10. Seed vectors (C33)

RED `17eb721` (the test, committed while the vector directories did not exist yet), GREEN `610451f`.

Before writing the vectors, the check digits of the ICAO examples were verified with `tools/icao_mrz.py`:
- TD3: document 6, birth 2, expiry 9, optional 1, composite 0;
- TD1: 7, 2, 9, composite 6;
- TD2: 7, 2, 9, composite 6;
- MRV-A and MRV-B: 4, 8, 9.

```text
$ (cd packages/checks && pnpm exec vitest run src/vectors.test.ts --coverage.enabled=false)   # vector directories empty
     × hold the ICAO 9303 examples of TD1, TD2, TD3 and MRV-A, and at least two invalid MRZs
AssertionError: TD1: expected false to be true
     × hold at least two valid and two invalid payloads, each marked synthetic
AssertionError: expected 0 to be greater than or equal to 2
     × name the error of each invalid one, with a defect the layout shows
      Tests  3 failed | 5 passed (8)
GREEN (vectors in place): Tests  8 passed (8)
```

## 11. Generator version stamp (C36 plumbing)

Stub `7f75875`, RED `3f8069b`, GREEN `cb82c0a`.

```text
$ (cd services/vision && COVERAGE_FILE=/tmp/openverify-cov-contracts uv run --frozen pytest tests/test_make_synthetic_fixtures.py --no-cov -q)
FAILED test_generates_every_asset                  (no stamp beside the assets)
FAILED test_the_generator_has_a_positive_integer_version
FAILED test_it_stamps_its_version_after_writing_every_asset
FAILED test_a_failed_run_leaves_no_stamp
FAILED test_print_version_prints_only_the_version
5 failed, 6 passed
GREEN: 18 passed (with tests/test_real_faces.py)
```

## 12. e2e and CI model fetch (C33, C36 plumbing)

The e2e helpers: stub `78ccc0e`, RED `87c0cb2`, GREEN `ebc85a1`. The CI contract: RED `6abeb0f`, GREEN `f669b6d`.

```text
$ (cd e2e && pnpm exec vitest run src/assets.test.ts src/paths.test.ts --coverage.enabled=false)
     × fetches every model in models/manifest.json, so models added later reach the run
     × asks the generator for its version
     × regenerates only when needed: a file is missing / the stamp is from another version / there is no stamp
     × reads the version a run wrote, without its newline
GREEN: (cd e2e && pnpm test) Tests 72 passed (96.65 / 88.07 / 92.85 / 97.66)
$ bash infra/tests/ci-workflow.test.sh
FAIL - vision: fetches every model in models/manifest.json (no --only list)
FAIL - e2e: fetches every model in models/manifest.json (no --only list, C33)
# 114 passed, 2 failed, 0 skipped
GREEN: ok - actionlint 1.7.12 reports no problems; # 116 passed, 0 failed, 0 skipped
```

The full e2e run below exercised the stamp. The local `fixtures/generated/` had no stamp, so the stack regenerated it: "generating the synthetic ID and the fake-camera clips", followed by `.generator-version` = `1`.

## Existing tests changed because the plan changes their behaviour

- **C29.1:**
  - `packages/core/src/check-registry.test.ts`: `expectedStage` counts model-based checks; "ships every heuristic check as beta…" became "heuristic and model-based".
  - `packages/core/src/enums.test.ts`: `CHECK_INPUTS`.
- **C29.2:**
  - `packages/checks`: the `toEqual` literals of id-age-comparison, id-disallowed-country-detection, id-disallowed-type-detection, id-expired-detection, id-mrz-inconsistency-detection, id-po-box-detection, id-valid-dates-detection, phase1/evaluate, phase1/government-id-checks (4) and phase1/selfie-checks (2) gain `stage`, `confidence` and `provenance`. In `result.test`, "takes the check type…" expects them.
  - `packages/core`: the `result()` helper of `decision-engine.test` and a literal in `check-config.test`.
  - `packages/contracts/src/verifications.test.ts`: "are built from verification records" now expects what the server serves (`served()`).
  - `apps/api`: the exact checks of `routes/server/verifications.test` and `routes/server/inquiries.test`; the fixture rows of `jobs/records.test`.
  - `packages/db/src/migrate.test.ts`: `slice(9, 10)`.
- **C30:**
  - `packages/core`: `decision-engine.test` ("is pending while a required check is pending" became needs_review, plus the moreResultsExpected case; "treats a required check without a result as pending" became needs_review; the not_applicable cases now carry reasons; the duplicate merge of passed with pending is now needs_review; the defaultTemplateConfig feed is now needs_review); `verification-state-machine.test` (the C10 table gains submitted to needs_review; the terminal list).
  - `packages/checks/src/phase1/evaluate.test.ts`: two "undecided" tests became needs_review.
  - `apps/api/src/jobs/process-verification.test.ts`: "keeps a verification undecided when an enabled check has no evaluator" became "sends a verification to review…".
  - `packages/contracts/src/verification-types.test.ts`: the comment and the needs_review mapping.
  - `apps/flow`: the `flow-position.test` table and `processing-step.test`, with the `Decision` type of the fake API.
- **C29.6:** `government-id-checks.test` "is not applicable when the step needs only the %s" now expects `not_requested`.
- **C31:**
  - `packages/db`: `testing.test` (`V2_TABLES`), `schema-v2.test` (the encrypted column list), `key-rotation.test` (seeds and reads an extraction).
  - `apps/api`: `routes/server/verifications.test` (the null extraction attributes); the API environments in `config.test`, `test-support/env.ts`, `worker.test` and the api, platform and lifecycle integration tests gain `OPENVERIFY_BLIND_INDEX_KEY`.
  - `e2e/src/env.test.ts`: the secret list.
  - `infra/tests/compose.test.sh`: the env list, the worker/api comparison, and the new api check.
- **C32.1:**
  - `services/vision`: `test_app_analyze` (`test_government_id_front_only`: model versions and side keys); `test_schemas` (the `side()` helper and the text model versions); `test_contract_fixtures` (MODELS gains the barcode fixture).
  - `apps/api/src/ports.test.ts`: the `SIDE` keys.
- **C33 and C36:**
  - `infra/tests/ci-workflow.test.sh`: "e2e: fetches the YuNet and SFace weights" became "fetches every model in models/manifest.json".
  - `services/vision/tests/test_make_synthetic_fixtures.py`: "generates every asset" expects the stamp.
  - `e2e/src/paths.test.ts`: `generatorStamp`.

## Final gates (2026-10-21, on `875d663`)

| Gate | Result |
|---|---|
| `pnpm typecheck && pnpm lint && pnpm format:check` (also `turbo run typecheck lint --force`) | 24 tasks successful, none cached; Prettier clean |
| `pnpm test` (`turbo run test --force`) | config 44, core 472 (100%), e2e 72 (96.65 / 88.07 / 92.85 / 97.66), node 205 (99.06 / 94.54 / 100 / 99.36), checks 473 (99.81 / 97.91 / 100 / 99.8), ui 54, flow-spec 81, contracts 1251 (100%), flow 524 (98.8 / 95.55 / 99.26 / 98.87), db 613 (99.04 / 92.52 / 99.39 / 98.99), dashboard 1429 (98.43 / 94.42 / 98.69 / 98.45), api 2106 (97.55 / 90.45 / 98.38 / 97.61) |
| `pnpm test:integration` | api 32 passed (10 files), db 41 passed (6 files) |
| Vision: `uv run --frozen ruff check`, `ruff format --check`, `mypy src tools`, `pytest` | clean; 522 passed, coverage 100.00% |
| Android: `./gradlew --no-daemon testDebugUnitTest koverVerify assembleDebug lint` | BUILD SUCCESSFUL; 477 unit tests, 0 failures, 0 skipped |
| `pnpm --filter @openverify/api openapi:write`, twice | Neither run changed `docs/api/openapi.json` |
| `flock /tmp/openverify-e2e.lock pnpm e2e` | 39 passed (3.3 min) |
| `bash infra/tests/ci-workflow.test.sh`, `bash infra/tests/compose.test.sh` | 116 and 190 passed, 0 failed |
| `gitleaks git --redact .` | 708 commits scanned, no leaks found |
