# TDD evidence: Workflow 4A Stage 2, `checks-logic` (C39.3, C43, C49 report)

- **Slice owner:** `checks-logic` (Workflow 4A, Stage 2), beside `vision-face`, `vision-integrity`, `fixtures`, `flow-capture` and `android-capture`.
- **Owned paths:** `packages/checks`, `packages/core/src/check-config.ts` and the registry's `configSchema` fields, `packages/contracts/src/selfie-check-reasons.ts` (fraud reasons only), this file.
- **Date:** 2026-10-21.
- **Input:** `docs/plans/phase-4.plan.md` (C39.2-C39.4, C40.10, C40.11, C41.1, C42.3-C42.8, C43, C44, C49), Stage 1's contracts handoff.
- **Commits:** `e6b13c9..6e9f386` (26 commits), then this record.

Each item follows the same cycle:
1. Write a test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

A RED test must compile and typecheck, so whenever a test needed a name that did not exist yet, a `chore` commit added it first as a stub (a function throwing "not implemented", an empty table). Stubs carry a file-level `eslint-disable @typescript-eslint/no-unused-vars` so they lint; every GREEN file drops it.

All commands ran from the repository root or `packages/checks` after `source scripts/env.sh`. Output is trimmed to the lines that matter.

## What did not change

- **Core and contracts.** Stage 1 had already built every C39.3 config schema, `SELFIE_CHECK_CONFIG_DEFAULTS` with its bases, and `FACE_MATCH_DEFAULTS`; the evaluators read every key, and no range needed changing. Every reason the evaluators emit is already in `SELFIE_CHECK_REASONS`, so no fraud reason was added (no amendment). Cross-check, run from `apps/api` (which depends on both packages):

  ```text
  $ node --conditions=@openverify/source --import ../../packages/checks/scripts/register-ts.mjs --input-type=module -e "...SELFIE_EVALUATOR_REASONS[id] ⊆ SELFIE_CHECK_REASONS[id]..."
  checks 15 declared 63 not in SELFIE_CHECK_REASONS: []
  ```

## 1. The selfie context, threshold basis, cascade, capture signals and virtual-camera list (C39.3, C43)

Stub `e6b13c9`, RED `4f9e864`, GREEN `1170f46`.

- `selfieCheckConfig`: template config over `SELFIE_CHECK_CONFIG_DEFAULTS`; a key the template sets has no basis (the operator's choice). `checkResult` gains `thresholdBasis`, written as `provenance['threshold-basis']` when not empty.
- The cascade (`selfieCascade`, `judgePoseQuality`, `judgePoseDirection`) is computed from the measurements and the pose and quality checks' config, whether or not those checks are enabled.
- `captureDeviceFlags` (no label kept), `isFilePathLabel`, `orientedYawRatio` (the mirrored sign flip), `promptOrderFollowed`, `captureTimingFlags`; `VIRTUAL_CAMERA_NAMES` (OBS Virtual Camera, then v4l2loopback's default label, both verified in research §11.1).

### RED

```text
$ (cd packages/checks && pnpm exec vitest run src/selfie src/result.test.ts --coverage.enabled=false)
     51 Error: not implemented
AssertionError: expected undefined to match object { name: 'OBS Virtual Camera' }
AssertionError: expected undefined to deeply equal { 'min-passive-score': 'provisional' }
AssertionError: expected error to be instance of InvalidCheckConfigError
 Test Files  5 failed (5)
      Tests  75 failed | 14 passed (89)
```

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run src/selfie src/result.test.ts --coverage.enabled=false)
 Test Files  5 passed (5)
      Tests  89 passed (89)
```

## 2. Image quality v2, glare, pose, multiple faces v2 (C43)

Stub `f7cebe6` (`mergeFaceBoxes`), RED `8d49471`, GREEN `42a1966`.

### RED

```text
$ pnpm exec vitest run src/selfie/selfie-image-quality-detection.test.ts src/selfie/selfie-glare-detection.test.ts src/selfie/selfie-pose-detection.test.ts src/selfie/selfie-multiple-faces-detection.test.ts --coverage.enabled=false
     25 Error: not implemented
 Test Files  4 failed (4)
      Tests  25 failed (25)
```

### GREEN

```text
$ pnpm exec vitest run src/selfie --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  100 passed (100)
```

## 3. Liveness (C43)

Stub `366ed76` (`LIVENESS_PASS_CONFIDENCE_CAP`), RED `0f7734d`, GREEN `a366e20`. Before the RED commit, a hand recomputation corrected one expectation of my own: an identity failure at cosine 0.3 with every component executed has confidence `marginConfidence(0.7, 0.6) x 1 = 0.25`, not 0.1667.

### RED

```text
$ pnpm exec vitest run src/selfie/selfie-liveness-detection.test.ts --coverage.enabled=false
     17 Error: not implemented
 Test Files  1 failed (1)
      Tests  18 failed (18)
```

### GREEN

```text
$ pnpm exec vitest run src/selfie/selfie-liveness-detection.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

## 4. Pose repeat (C43)

RED `d344b07`, GREEN `ae6ccac`.

### RED

```text
$ pnpm exec vitest run src/selfie/selfie-pose-repeat-detection.test.ts --coverage.enabled=false
     10 Error: not implemented
 Test Files  1 failed (1)
      Tests  10 failed (10)
```

### GREEN

```text
$ pnpm exec vitest run src/selfie --coverage.enabled=false
 Test Files  10 passed (10)
      Tests  128 passed (128)
```

## 5. The ID comparison v2, account, repeat and background (C43, C42.3, C42.8)

RED `06775a5`, GREEN `76cfc7d`.

### RED

```text
$ pnpm exec vitest run src/selfie/selfie-id-comparison.test.ts src/selfie/selfie-account-comparison.test.ts src/selfie/selfie-repeat-detection.test.ts src/selfie/selfie-similar-background-detection.test.ts --coverage.enabled=false
     22 Error: not implemented
AssertionError: expected [Function] to throw error matching /invalid/ but got 'not implemented'
 Test Files  4 failed (4)
      Tests  23 failed (23)
```

### GREEN

```text
$ pnpm exec vitest run src/selfie --coverage.enabled=false
 Test Files  14 passed (14)
      Tests  151 passed (151)
```

## 6. Covering, glasses, the synthetic fusion, suspicious entity, age, public figure (C43, C44)

Stub `bd8fcf8` (`SYNTHETIC_SIGNALS`, `HEURISTIC_CONFIDENCE_CAP`), RED `2e54f8b`, GREEN `4c2ba7b`.

### RED

```text
$ pnpm exec vitest run src/selfie/selfie-face-covering-detection.test.ts src/selfie/selfie-glasses-detection.test.ts src/selfie/synthetic-score.test.ts src/selfie/selfie-suspicious-entity-detection.test.ts src/selfie/selfie-age-comparison.test.ts src/selfie/selfie-public-figure-detection.test.ts --coverage.enabled=false
     29 Error: not implemented
AssertionError: expected [] to deeply equal [ 'trainedAlgorithmicMedia', …(1) ]
AssertionError: expected [] to deeply equal [ 'spectral_tail_deviation', …(4) ]
 Test Files  6 failed (6)
      Tests  35 failed (35)
```

### GREEN

```text
$ pnpm exec vitest run src/selfie --coverage.enabled=false
 Test Files  20 passed (20)
      Tests  186 passed (186)
```

## 7. Wiring: every §4.2 check evaluated, the C43 contract at the logic level

Stubs `c0374fa` (`SELFIE_EVALUATOR_REASONS`) and `46bc320` (`evaluateSelfieChecks` takes the C43 input type; behaviour unchanged, so the RED test compiles), RED `d62899a`, GREEN `fbd7626`, refactor `3900953`.

The contract tests (`src/selfie/selfie-contract.test.ts`) run the C45.1 default template:
- a genuine capture passes every enabled check;
- an insufficient left or right turn alone is `failed`, retryable, failing only `selfie_pose_detection` with the hint `pose_not_left`/`pose_not_right`, and no advisory failure;
- a too-dark centre alone is `failed`, retryable, failing only `selfie_image_quality_detection` with the hint `image_too_dark`;
- in both, liveness and pose repeat do not fail;
- with the pose check disabled, an unjudged side keeps liveness `not_applicable` (review), never `passed`;
- over ten genuine and degraded inputs and all 15 checks enabled: no `pending`, only declared reasons, a reason on every `not_applicable` and `failed` result, the result schema, a confidence on every H-tier and liveness verdict, and no embedding, layout or landmark in any result.

`src/phase1/evaluate.test.ts` changed two expectations the plan changes: no ID portrait now sends the verification to review (`not_applicable`/`no_reference_data`, C43, was `failed`); liveness is evaluated (`capture_not_live` without a capture, was `pending`/`not_implemented`).

### RED

```text
$ pnpm exec vitest run src/selfie/evaluators.test.ts src/selfie/selfie-contract.test.ts src/phase1/evaluate.test.ts --coverage.enabled=false
     × declares the reasons every evaluator may emit, snake_case codes only
     × passes a genuine three-pose capture on the C45.1 default template
     × an insufficient left turn alone fails only pose: retryable, hint ...
     × an insufficient right turn alone fails only pose: retryable, hint ...
     × a too-dark centre alone fails only image quality: retryable, hint image_too_dark
     × never passes liveness when the pose check is not required and a side was not judged
     × evaluates every enabled check: none answers pending or not_implemented
     × emits only the reasons its evaluator declares
     × sends the selfie to review when there is no ID portrait to compare with (C43, was failed)
     × evaluates liveness: a selfie without a live capture is capture_not_live (C43)
     × evaluates every enabled §4.2 check: none answers not_implemented any more
 Test Files  3 failed (3)
      Tests  11 failed | 21 passed (32)
```

The it.each title printed the yaw ratio as the hint; the title was fixed (`(yaw ratio %d) ... hint %s`) before the RED commit.

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run --coverage.enabled=false)
 Test Files  73 passed (73)
      Tests  1320 passed (1320)
```

### Refactor

The three Phase 1 selfie evaluators (`phase1/selfie-checks.ts`) were superseded by their version 2 successors and are removed; their tests moved to `src/selfie/*.test.ts` (v2 behaviour). `faceMatchConfidence` moves to `face-match.ts` and stays re-exported from `phase1/selfie-checks.ts` (which the C39.3 face-match reader test reads). The package index exports `src/selfie/`. `PHASE1_EVALUATED_CHECKS.selfie` stays the three Phase 1 checks, as the government ID entry keeps its four.

Running prettier from `packages/checks` bypassed the root `.prettierignore` (`data/`) and reformatted eight `src/data` files; I wrote back their committed content (`git show HEAD:<path> > <path>`, my own path and my own change) and ran prettier from the root afterwards. Nothing of that reached a commit.

```text
$ (cd packages/checks && pnpm exec tsc --noEmit && pnpm exec eslint src && pnpm exec vitest run --coverage.enabled=false)
 Test Files  73 passed (73)
      Tests  1301 passed (1301)
$ pnpm --filter @openverify/api typecheck
$ tsc --noEmit
```

## 8. `id_selfie_comparison` v2 (C39.3, C43)

RED `654935e`, GREEN `e8adfd4`. It records the shared threshold's basis when the template sets none; `SelfieFace` states the selection rule (the inquiry's latest selfie that is `passed`, `submitted` or `needs_review`) as the worker's input contract.

### RED

```text
$ pnpm exec vitest run src/government-id/history.test.ts --coverage.enabled=false
     × reads the shared FACE_MATCH_DEFAULTS threshold and records its basis (v2, C39.3)
AssertionError: expected { 'implementation-version': 2, …(1) } to match object { 'implementation-version': 2, …(2) }
 Test Files  1 failed (1)
      Tests  1 failed | 23 passed (24)
```

### GREEN

```text
$ (cd packages/checks && pnpm exec vitest run --coverage.enabled=false)
 Test Files  73 passed (73)
      Tests  1302 passed (1302)
```

## 9. The calibration report's selfie mode (C49)

Stub `dcdcb2b`, RED `17d0ec5`, GREEN `6e9f386`. Tested on a hand-written measurements file (four pseudonymous identities, 4 genuine and 24 impostor pairs, hand-written cosines).

### RED

```text
$ pnpm exec vitest run src/calibration --coverage.enabled=false
 FAIL  src/calibration/selfie-report.test.ts [ src/calibration/selfie-report.test.ts ]
Error: not implemented
 FAIL  src/calibration/cli.test.ts > the selfie mode (C49) > reads the selfie calibration output and writes the report the plan names by default
TypeError: Unknown option '--selfie'
 FAIL  src/calibration/cli.test.ts > the selfie mode (C49) > writes the report and counts its pairs and identities
Error: not implemented: /tmp/openverify-selfie-report-5TYVXE/measurements.json
 Test Files  2 failed | 1 passed (3)
      Tests  3 failed | 17 passed (20)
```

### GREEN

The GREEN run showed two wrong RED expectations, both corrected in the GREEN commit:
- the report keeps exact rates and rounds only when rendering, so the FAR at 0.363 is `1/24` (`toBeCloseTo(1 / 24, 6)`), not the rounded 0.0417;
- the provisional distributions are measured on synthetic fixtures, so their table names that domain; the test now counts every `Domain:` caption against the tables, and the studio-portrait domain on the four FAR/FRR, 1:N and skew tables.

```text
$ pnpm exec vitest run src/calibration --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  32 passed (32)
$ pnpm --filter @openverify/checks calibration:report --selfie --input contracts/fixtures/calibration/selfie-calibration.sample.json --output <scratch>/selfie-sample-report.md --replicates 200
wrote <scratch>/selfie-sample-report.md: 3 pairs, 2 identities
```

Rendering the Stage 1 sample showed rule-of-three floors above 1 for tiny sets (`3 / 2 = 1.5`); both floors are now capped at 1, and the pair counts use proper singulars.

**Performance, measured.** A generated (synthetic, scratch-only) set at the plan's size: 450 identities, 1,125 images, 900 genuine and 631,350 impostor pairs, 1,000 replicates.
- The first implementation walked every impostor pair in each replicate: 298 s.
- Grouping impostor pairs by identity pair (about 101,000 groups) with per-threshold counts computed once: 28.5 s and 393 MB, with a byte-identical report.

## Final gates

Run after the last commit, in the foreground.

```text
$ pnpm --filter @openverify/checks typecheck
$ tsc --noEmit
$ pnpm --filter @openverify/checks lint
$ eslint .
$ pnpm --filter @openverify/checks test
 Test Files  74 passed (74)
      Tests  1317 passed (1317)
All files          |   99.02 |    90.12 |   99.64 |   98.96 |
$ pnpm --filter @openverify/core typecheck && pnpm --filter @openverify/core test
 Test Files  14 passed (14)
      Tests  569 passed (569)
All files          |     100 |    98.82 |     100 |     100 |
$ pnpm --filter @openverify/contracts typecheck && pnpm --filter @openverify/contracts test
 Test Files  45 passed (45)
      Tests  1383 passed (1383)
$ pnpm typecheck
 Tasks:    12 successful, 12 total
$ pnpm format:check
All matched files use Prettier code style!
$ flock /tmp/openverify-e2e.lock pnpm e2e        # with Stage 1's selfie-protocol exclusion
@openverify/flow:e2e:   29 passed (12.4s)
@openverify/e2e:e2e:   36 passed (3.4m)
```

Selfie coverage: every file of `src/selfie` at 100% of functions and at least 98.7% of statements; the branches left are defensive `??` fallbacks for a config key the defaults always set.

**`apps/api` (api-worker's files, not changed here).** Four tests assert the Phase 1 behaviour C43 changes, and fail until api-worker updates them in Stage 3, as in Phase 3:

```text
$ (cd apps/api && pnpm exec vitest run src/jobs --coverage.enabled=false)
 FAIL  src/jobs/phase1-contract.test.ts > Phase 1 checks contract > emits only reason codes listed in PHASE1_CHECK_REASONS, and every listed code
AssertionError: expected Set{ 'input_missing', …(1) } to deeply equal Set{ 'image_unreadable' }
 FAIL  src/jobs/process-verification.test.ts > processVerification: selfie > fails the comparison when the inquiry has no usable ID
 FAIL  src/jobs/process-verification.test.ts > processVerification: selfie > fails the comparison when the ID has no front image
 FAIL  src/jobs/process-verification.test.ts > processVerification: selfie > fails the comparison when the stored ID front shows no portrait
AssertionError: expected [ 'no_reference_data' ] to deeply equal [ 'id_portrait_not_present' ]
 Test Files  2 failed | 12 passed (14)
      Tests  4 failed | 196 passed (200)
```

`selfie_id_comparison` without an eligible ID portrait now answers `not_applicable`/`no_reference_data` (C43, decision 5), and Phase 4 evaluators no longer emit the legacy `selfie_face_not_present`/`id_portrait_not_present` (C39.2). `apps/api/src/jobs/selfie-contract.test.ts` passes.
