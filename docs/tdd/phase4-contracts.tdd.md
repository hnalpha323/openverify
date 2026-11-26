# TDD evidence: Workflow 4A Stage 1, `contracts` (C39-C42, C45.1, C46.1 fixtures, C48 rows)

- **Slice owner:** `contracts` (Workflow 4A, Stage 1). It ran alone, so it could touch any path the deliverables needed.
- **Date:** 2026-10-21.
- **Input:** `docs/plans/phase-4.plan.md`, "Workflow 4A", Stage 1. The decisions it had to take are recorded there under "Workflow 4A Stage 1 amendments (contracts)".

Each item follows the cycle stub (when a RED test needs a name), RED (run, failing for the intended reason), GREEN, with the commits named. All commands ran from the repository root after `source scripts/env.sh`. Output is trimmed to the lines that matter. Python runs used `COVERAGE_FILE=/tmp/openverify-cov-contracts` and mypy `--cache-dir /tmp/openverify-mypy-contracts`.

## 1. Registry (C39.1)
RED cbe3d5c, GREEN 5feeca7.
RED:
$ (cd packages/core && pnpm exec vitest run src/check-registry.test.ts --coverage.enabled=false)
     × requires only real-tier checks by default, except the optional ones (C39.1)
     × makes face covering a user behaviour check, so the user gets a retry hint (C39.1)
     × says in its description that the background check is advisory only (C39.1)
     × gives every §4 check an id, tier, type, stage, version, modelBased and inputs
AssertionError: selfie_glare_detection: expected true to be false
AssertionError: expected { …(11) } to match object { checkType: 'user_behavior', …(2) }
AssertionError: expected 'Flags selfie backgrounds reused acros…' to match /advisory only; do not require it/i
AssertionError: id_selfie_comparison: expected 1 to be 2
      Tests  4 failed | 56 passed (60)
GREEN:
core 507 passed; checks 1119 passed; contracts 1291; api src/jobs src/services src/routes 1130 passed.
Existing tests changed (C39.1 bumps versions): selfie-checks.test.ts (3 x implementation-version 1->2), process-verification.test.ts (selfie_id_comparison 1->2; the per-check loop reads the registry version).

## 2. Config, defaults, basis (C39.3)
Stub ef677d4, RED 1277dd1.
RED: (cd packages/core && pnpm exec vitest run src/selfie-check-config.test.ts src/check-config.test.ts src/check-result.test.ts --coverage.enabled=false)
     × are the registry schemas of every selfie check with a threshold
     × bound selfie_image_quality_detection min-face-blur-score to 1-10000 (and 24 more bounds)
     × the defaults, the threshold basis in provenance
      Tests  33 failed | 87 passed (120)
GREEN 0665c5f: core 550 passed.

Face-match copies: RED cdc22dc (selfie-contract.test.ts: 6 failed | 3 passed: 'is read, never copied, by packages/checks/src/face-match.ts' ...), GREEN 9713f6a (checks 1119 passed; selfie-contract 9 passed).

## 3. Reasons (C39.2)
Stub dd1a44e, RED 31ef34e, GREEN 234a18e.
RED: contracts src/selfie-check-reasons.test.ts: Tests 22 failed | 5 passed (27); flow src/i18n/retry-reasons.test.ts: × come from the contracts: the user_behavior checks of Phases 1, 3 and 4; × are listed, exactly, in the fixture the Android SDK reads; Tests 2 failed | 8 passed (10).
GREEN: contracts 1320 passed; flow src/i18n 48 passed; android MessagesTest tests="15" failures="0".
Test changes: inquiry-templates.test.ts uses selfie_public_figure_detection as the check that takes no config (C39.3 gave multiple faces one); the RED test's Set is typed Set<string> once SHARED_SELFIE_REASONS became a literal tuple.

## 4. Capture state machine (C40.1)
Stub 997f0f3, RED 92aa6dd (core src/selfie-capture-state-machine.test.ts: Tests 13 failed | 6 passed (19)), GREEN c3f4d4e (core 569 passed).

## 5. Canonical face mesh (C41.1, C45.2) and CI caches
RED 90bd318 (pytest tests/test_manifest.py: FAILED test_manifest_pins_the_canonical_face_mesh_under_apache, FAILED test_the_canonical_face_mesh_is_never_committed; 2 failed, 8 passed), RED 9fd8858 (bash infra/tests/ci-workflow.test.sh: FAIL vision/e2e: the model cache key has the Phase 4 prefix models-v3-; 125 passed, 2 failed), GREEN bf9900b (test_manifest + test_fetch_models 55 passed; ci-workflow 127 passed).
$ python3 scripts/fetch_models.py --only canonical_face_mesh
canonical_face_mesh: downloaded models/canonical_face_model.obj (Apache-2.0)   (sha256 8bac8044...e618 verified, 45,999 B, 468 v / 898 f)

## 6. Yaw ratio, canonical points, re-pose helper (C41.1, C45.2)
Stub 7c8de62, RED 293acf8 (pytest tests/test_repose.py: 17 failed, NotImplementedError), GREEN 952e990 (17 passed). In GREEN the real-model direction test reads each portrait as a 640-pixel frame (YuNet finds faces only up to ~380 px wide), and the out-of-range face message names the vertex.
Visual check (scratch, not committed): person A rendered at -22/0/+22 deg turns the nose to the image left/right as the convention says; seams at the hairline as research §10.4 describes.

## 7. The C40.11 yaw anchor measurement
Stub 08cefea, RED e1ded4f (pytest tests/test_measure_yaw_anchor.py: 11 failed, NotImplementedError), GREEN be11364 (11 passed; coverage tools/measure_yaw_anchor.py 99%, tools/repose.py 95%). In GREEN the clip-yaw test's slow face reads 0.0035 per degree below 24 degrees (0.004 cleared at 23, as the arithmetic says).

## 8. C40 contracts, the C40.11 constants, the golden capture fixtures, dashboard group and settings
Stubs f51ddc5, a38c4f9; RED 294fc37:
$ (cd packages/contracts && pnpm exec vitest run src/selfie-captures.test.ts src/fixtures.test.ts --coverage.enabled=false)
      Tests  27 failed | 87 passed (114)
GREEN 720caf4: contracts 1373 passed; core 569 passed; typecheck 12/12; api src/webhooks src/events 303 passed. Existing tests changed for the plan's additions: ids.test.ts (self prefix), vocabulary.test.ts (selfie resource type, selfie.* events and SELFIE_EVENT_NAMES), dashboard-api.test.ts (the two settings defaults); the dashboard's RetentionSetting excludes the two face settings (4B surfaces them).
After 720caf4 the dashboard failed: × groups every event name by its subject, in catalog order; × sends only the settings that changed (the form spread DASHBOARD_SETTINGS_DEFAULTS, so it would reset the face settings).
RED 29bf304 (dashboard src/app/settings/actions.test.ts: × never sends the face template settings, which this form does not edit (C42.6); 1 failed | 7 passed), GREEN 7bfee47 (dashboard 1657 passed).
Measured yaw anchor (services/vision/tools/measure_yaw_anchor.py, 3 public-domain faces as 640-px frames, YuNet 2026may):
  max-center-yaw-ratio 0.021 (median |ratio| at +-5 deg), min-side-yaw-ratio-change 0.077 (median change at +-12 deg);
  clip at 22 deg: smallest change 0.076 < 1.25 x 0.077 = 0.096 -> raised; 23 deg: 0.083 -> raised; 24 deg: smallest 0.0996, median 0.124 -> clears; target-yaw-deg 24.
  0-deg readings: person-a-id -0.0093, person-a-selfie -0.0436, person-b-selfie 0.0082 (person-a-selfie's own frontal reading exceeds 0.021).

## 9. Face template settings (C42.4, C42.6) in storage and the settings service
After 720caf4 the API failed: × returns the defaults for a new organization and environment; × sets require-mfa ... (the contract's defaults name the two settings). Stub e0b067f, RED 0d2bfc7 (db face-template-settings.test.ts: 2 failed), GREEN b533b87 (db 7 passed; api src/routes src/services 943 passed). Stored in environments.settings (jsonb), so no migration.

## 10. Optional consent texts and the centre rule (C42.3, C40.2)
RED bfb0ef7: flow-spec consent-optional.test.ts (1 failed | 6 passed: optionalTextKeys refused as an unknown key); contracts selfie-publish.test.ts (× refuses a new template / a new version whose selfie step does not prompt center; 2 failed | 2 passed).
GREEN 4d59584: flow-spec 88 passed (schema/flow.schema.json regenerated with pnpm --filter @openverify/flow-spec schema:export); contracts 1377 passed. checkFlowPublishable runs on the create and update bodies and the version content schema, never on the read schemas, so stored versions without center still parse.

## 11. Vision selfie analysis v2 (C41.1, C41.2, C41.4) and the API side
Stub 1360b60 (the C41 models and the Stage 2 module stubs), RED cc0bebf:
$ (cd services/vision && COVERAGE_FILE=/tmp/openverify-cov-contracts uv run --frozen pytest tests/test_selfie_v2.py --no-cov)
FAILED test_the_golden_selfie_fixture_carries_every_v2_field / test_the_selfie_route_returns_the_image_size_and_every_faces_landmarks / ... / test_the_app_turns_onnx_runtime_telemetry_off_at_startup / test_the_vision_image_sets_ort_disable_telemetry / test_each_stage_2_owner_has_a_marked_block[...] 
14 failed, 3 passed
(The RED commit lost its onnxruntime import to ruff --fix, so the telemetry test failed with NameError; GREEN restores the import.)
RED 7712e86: bash infra/tests/compose.test.sh --static-only: FAIL - vision turns ONNX Runtime telemetry off (ORT_DISABLE_TELEMETRY=1); 165 passed, 1 failed.
GREEN 4240a17: vision pytest (whole suite) passed; compose static 166 passed; api unit 2214 passed after openapi:write (run twice, cmp identical). Existing tests changed for the C41.1 additions: test_app_analyze (model versions gain the two anti-spoof names; the Phase 1 pose keys are a subset; the 500 test patches analysis.analyze_image), test_schemas (the pose round trip has the v2 fields), apps/api ports.test.ts (the pose and analysis keys). analyze-government-id*.json and embed-face.json regenerate byte-identical.

## 12. contracts/fixtures/vision/yunet-decode.json (C46.1)
Stub bd5359d, RED 756be29 (pytest tests/test_yunet_decode_fixture.py: 4 failed). GREEN 009e617 (22 passed with test_contract_fixtures). The input is a drawn synthetic face, not a public-domain photograph (team rule 9: no real face's landmarks in git); YuNet scores it 0.8918 at 160x120 (padded 160x128): box [54.484, 19.565, 52.272, 69.449]. 79 kB; 420 anchors x 16 values. In GREEN the landmark comparison flattens the points (pytest.approx takes no nested lists), and test_contract_fixtures lists the decode fixture apart (it needs the real model).

## 13. C45.1 default template and the consent texts
RED fffe692 (contracts default-template-selfie.test.ts: 5 failed | 1 passed); stub f442421 (the Android string resource), RED a2ed744 (flow consent-keys.test.ts: 4 failed; android MessagesTest: 15 tests completed, 1 failed).
GREEN e54015e: contracts 1383 passed; api 2214 passed; flow 548 passed; dashboard 1657; e2e unit 74; node 208; android SDK unit tests all pass.
The default flow is version 2. Tests of Phase 1-3 selfie behaviour pin the Phase 3 step (centre, passive) and the three Phase 1 checks: apps/api jobs/testing.ts phase3SelfieTemplate (process-verification, process-government-id), phase1-contract (enableAll(PHASE1_CHECKS.selfie)), apps/flow testing/flow-fixtures.ts defaultFlow, the mocked flow API's defaultFlow, Android FakeFlowApi.DEFAULT_FLOW. Changed for the plan: dev-seed.test (every §4.2 check), routes/flow/verifications.test (uploads the three prompted poses), inquiry-templates.test (C45.1 step and groups), ContractFixturesTest (three poses, version 2, api/selfie.json server-only).

## 14. The e2e exclusion
Stub fd51ed3, RED 9b1b8a9 (e2e src/exclusions.test.ts: 2 failed | 1 passed), GREEN 072f60d (e2e unit 77 passed; playwright test --list: 36 tests, none of verification-completes, verification-fails, reload-between-uploads, government-id-review, ui-flow-links).

## 15. Storage (C40.5, C42.1, C42.5) and the shared repository functions
Schema 87674b7 (migration 0015: CREATE EXTENSION IF NOT EXISTS vector; selfie_captures, face_templates, selfie_backgrounds with HNSW vector_l2_ops; files.selfie_capture_id/client_elapsed_ms/received_at and files_environment_id_sha256_idx; verifications.selfie_capture_required added DEFAULT false, then DEFAULT true). Stub 879ac62, RED 64b17b7 (db selfie-captures.test.ts: 14 failed | 1 passed (15)).
GREEN 0454000: db selfie-captures.test 15 passed; db unit 658 passed. Before GREEN the existing suite failed: list-index-order (descending columns must put nulls first; 0015 regenerated with NULLS FIRST), testing.test (the three tables), schema-v2 (the two sealed columns), key-rotation (dry run rewraps >= every encrypted column: the seed now holds a consumed capture with a device and a template), subject-ids (the self prefix).

## 16. Redaction coverage (C40.1, C42.6)
RED bc780a2 (api src/services/redaction.test.ts: × leaves nothing of the subject in any table or in storage (the sealed device and the logs about the capture survive); × clears every API log ...; 2 failed after the coverage table excludes selfie_backgrounds like verification_checks). GREEN bbff40b: api src/services 141 passed; db redaction 6 passed. The audit's stubbed-event-count is 4 (the subject's selfie.created event).

## 17. API stubs, upload limits, submit body, node types, ports
RED 9f35d49 (api src/routes/selfie-stubs.test.ts: 5 failed: the create and read routes, OpenAPI paths, UPLOAD_LIMITS fields 5 / parts 6). GREEN 393c843: selfie-stubs 5 passed; api unit 2219 passed once the submit body is `nullish` (a body-less submit sends null). `pnpm --filter @openverify/api openapi:write` run twice: `cmp` identical. Node types 7ff7973 (a compile-time test: node 209 passed). Ports c2d6213 (types only).

## 18. Final gates (on main after 56b4544)
```text
$ pnpm typecheck && pnpm lint && pnpm format:check
 Tasks: 12 successful, 12 total (typecheck); Tasks: 12 successful, 12 total (lint); All matched files use Prettier code style!
$ pnpm test
 Tasks: 12 successful, 12 total
 ui 54, core 569, e2e 77, node 209, flow-spec 88, config 44, contracts 1383, checks 1119, flow 548, db 658, dashboard 1657, api 2219 (8,625 tests)
 coverage (statements / branches / functions / lines): api 97.5/90.51/98.26/97.56, checks 98.7/90.15/99.52/98.62, db 98.83/91.8/99.27/98.78,
 dashboard 98.43/94.33/98.74/98.45, flow 98.81/95.64/99.28/98.87, contracts 100, core 100/98.82/100/100, flow-spec 100, node 99.08/94.64/100/99.37, e2e 96.72/88.07/93.33/97.7
$ pnpm test:integration
 api 38 passed, db 46 passed (Testcontainers: pgvector/pgvector:pg17, valkey 9.1, rustfs 1.0.3)
 (first run: 2 failed, the Phase 1 HTTP path and the worker test, which read the C45.1 default; 65f54b9 pins the Phase 3 selfie step there)
$ (cd services/vision && uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools && uv run --frozen pytest)
 Success: no issues found in 53 source files; 1295 passed; Total coverage: 99.82%
$ (cd android && ./gradlew --no-daemon testDebugUnitTest koverVerify assembleDebug lint)
 BUILD SUCCESSFUL; 534 unit tests, 0 failures
$ pnpm --filter @openverify/api openapi:write   (twice; cmp identical)
$ bash infra/tests/ci-workflow.test.sh  -> 127 passed, 0 failed
$ bash infra/tests/compose.test.sh --static-only -> 166 passed, 0 failed
$ for the other infra tests -> 11, 9, 11 passed
$ flock /tmp/openverify-e2e.lock pnpm e2e    (with the Stage 1 exclusion of the five full-stack selfie specs)
 mocked flow suite: 29 passed; full stack: 36 passed (3.0m)
 (first run: 2 failed, template-versions and ui-lifecycle assumed the default flow at version 1; 56b4544)
```
