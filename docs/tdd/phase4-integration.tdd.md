# TDD evidence: Workflow 4A Stage 4, `integration`

- **Slice owner:** `integration` (Workflow 4A, Stage 4), alone, after every earlier agent.
- **Owned paths:** `e2e/`, `docs/checks/`, `.github/workflows/ci.yml`, `infra/tests/`, `turbo.json`, the api-worker and Stage 4 amendments of `docs/plans/phase-4.plan.md`, this file, and any path needed to fix an integration defect test-first.
- **Date:** 2026-10-21.
- **Input:** `docs/plans/phase-4.plan.md` (C39-C49), ADR 0002, `docs/research/phase4-models.md` (§0, §10.4, §11), and the Stage 1-3 reports and evidence files.
- **Commits:** `1fdd14e..13d6efc` (28 commits), then this record.

Each item follows the same cycle: a `chore` stub where a test needs a name that does not exist yet; the RED test run and seen failing for the intended reason, committed as `test(...)`; the smallest change that passes it, committed as `feat(...)` or `fix(...)`. Where a test passed on its first run because the behaviour had already landed in Stages 2-3, it is a guard and is said to be one. Every command ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown. Output is trimmed to the lines that matter. No test was skipped or weakened; two load-dependent tests were made deterministic (item 13), each checked against a mutant.

## 1. The e2e stack leaves the C44 providers unbound

RED `1fdd14e`, GREEN `9f9677a`. The e2e processes inherit the shell's environment, so a developer who exported `OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE_SANDBOX=sandbox` would bind the provider the new `selfie-review` spec needs unbound (api-worker's follow-up).

```text
$ pnpm --filter @openverify/e2e exec vitest run src/env.test.ts --coverage.enabled=false
     × leaves every C35 and C44 provider unbound, even when the shell binds one (C35, C36, C44) 6ms
AssertionError: OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE_SANDBOX: expected undefined to be '' // Object.is equality
      Tests  1 failed | 13 passed (14)
$ pnpm --filter @openverify/e2e exec vitest run src/env.test.ts --coverage.enabled=false     # GREEN
      Tests  14 passed (14)
```

## 2. The C45.2 clips and still triples in the e2e paths

Stub `18d9bd4`, RED `4488b44`, GREEN `8d7a3a6`. `FIXTURES` names `headTurnMatching`, `headTurnDifferent` and `staticReplay` (the MJPEG clips of `fixtures/generated/selfie/`), `selfieStill(person, pose)` names a still, and `e2e/setup/stack.ts` regenerates the fixtures when one of them is missing. The GREEN commit also points the five selfie specs at the head-turn clips, so the e2e project keeps compiling.

```text
$ pnpm --filter @openverify/e2e exec vitest run src/paths.test.ts --coverage.enabled=false
     × names the synthetic ID, the C45.2 head-turn and static-replay clips and the default template 9ms
     × names a pose of a C45.2 still triple as the generator writes it 1ms
AssertionError: expected { …(6) } to deeply equal { …(7) }
Error: selfieStill(a, center) is not implemented yet
      Tests  2 failed | 3 passed (5)
$ pnpm --filter @openverify/e2e exec vitest run src/paths.test.ts --coverage.enabled=false     # GREEN
      Tests  5 passed (5)
```

## 3. The C45.3 specs, and the integration defect they found in the dashboard

Specs `5cce831`; dashboard RED `941326b`, GREEN `c7cfa40`.

The helpers (`e2e/tests/support/flow.ts`, `flow-links.ts`) speak the C40 protocol through the flow's accessible names: `takeSelfie` presses "Start the camera" and follows each announced prompt, never pressing the shutter by default (so every photo must be auto-captured) or pressing it once offered (`shutter: 'manual-when-offered'`); `uploadSelfie` uploads every prompted pose through the sandbox fallback. The five updated specs and four new ones are listed in the plan's Stage 4 amendment 1.

The specs were run before the exclusion was removed, through an untracked scratch config (`{ ...config, testIgnore: [] }`, deleted afterwards). The first run of `verification-completes` failed in my own helper: after the last photo the selfie step unmounts, and `textContent()` waited for the gone live region. It now reads with `allTextContents()`. The second run passed the whole flow and failed on my own over-broad assertion (`/embedding|landmark|layout/` matched the government ID's `"layout":"TD1"`); it now matches keys whose value is an array. Then all nine selfie specs together:

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm --filter @openverify/e2e exec playwright test --config playwright.scratch.config.ts tests/verification-completes.spec.ts tests/verification-fails.spec.ts tests/reload-between-uploads.spec.ts tests/government-id-review.spec.ts tests/ui-flow-links.spec.ts tests/selfie-static-replay.spec.ts tests/selfie-review.spec.ts tests/selfie-repeat.spec.ts tests/flow-bundle.spec.ts'
  ✓   1 tests/flow-bundle.spec.ts › the built flow runs a whole verification without a CSP violation ... (18.4s)
  ✓   2 tests/government-id-review.spec.ts › a required A-tier check without a provider sends the inquiry to review ... (14.6s)
  ✓   3 tests/reload-between-uploads.spec.ts › a reload between two uploads, of the ID or of the selfie poses ... (17.3s)
  ✓   4 tests/selfie-repeat.spec.ts › the same face on another account fails the advisory repeat check ... (32.8s)
  ✓   5 tests/selfie-review.spec.ts › a required A-tier selfie check without a provider sends the selfie to review (C44) (14.5s)
  ✓   6 tests/selfie-static-replay.spec.ts › a static replay that never turns gets the pose retry hint ... (31.3s)
  ✓ 7-10 tests/ui-flow-links.spec.ts (four tests)
  ✘  11 tests/verification-completes.spec.ts › an inquiry on the default template completes with every required check passed (46.7s)
  ✓  12 tests/verification-fails.spec.ts › a selfie of a different person fails the face match and the inquiry (18.3s)
    Error: expect(locator).toContainText(expected) failed
    Locator: getByRole('heading', { level: 1 })
    Expected substring: "inq_01M5G3XDBF9EYZEXYP9W5ZC5KK"
  1 failed, 11 passed (4.1m)
$ cat e2e/.artifacts/logs/dashboard.log
 ⨯ TypeError: Cannot read properties of undefined (reading 'length')
    at <unknown> (.next/e2e/server/chunks/ssr/apps_dashboard_src_components_15holi03tavr7._.js:1:13576)
```

The operator's inquiry page showed "The inquiries could not be loaded". Since Stage 3 the dashboard inquiry document includes the selfie captures (C40.1), and `inquiry-view.tsx` took every included resource that is not a file for a verification, so the capture became a card and the render crashed. Every inquiry with a selfie taken under Phase 4 was affected. The new spec assertions passed; only the dashboard part of `verification-completes` failed.

```text
$ cd apps/dashboard && pnpm exec vitest run 'src/app/inquiries/[id]/page.test.tsx' --coverage.enabled=false
     × shows an inquiry whose selfie was taken through a capture, which is not a verification (C40.1, C47) 84ms
TypeError: Cannot read properties of undefined (reading 'length')
      Tests  1 failed | 40 passed (41)
$ pnpm exec vitest run 'src/app/inquiries/[id]/page.test.tsx' src/components/lifecycle --coverage.enabled=false     # GREEN
      Tests  162 passed (162)
```

The fix: `isVerification` is `resource.type.startsWith('verification/')`. The dashboard timeline shows `selfie.*` events by their names until Workflow 4B gives them words (C47); it does not crash.

## 4. The exclusion removed, and the suites ordered

Exclusion: RED `ea87c28`, GREEN `1ec72af` (deletes `e2e/src/exclusions.ts` and its test, as Stage 1 asked). Order: RED `1b67b16`, GREEN `cc7a7db`.

```text
$ pnpm --filter @openverify/e2e exec vitest run src/playwright-config.test.ts --coverage.enabled=false
     × runs every spec under tests/, ignoring none (C45.3) 10ms
AssertionError: expected [ …(5) ] to deeply equal []
      Tests  1 failed | 1 passed (2)
$ pnpm --filter @openverify/e2e exec vitest run src/playwright-config.test.ts --coverage.enabled=false     # GREEN
      Tests  2 passed (2)
$ pnpm --filter @openverify/e2e exec vitest run src/suite-order.test.ts --coverage.enabled=false
     × runs the full-stack suite after the mocked flow suite, with its dependencies built (C45.3) 8ms
AssertionError: expected undefined to deeply equal ArrayContaining{…}
      Tests  1 failed | 1 passed (2)
$ pnpm --filter @openverify/e2e exec vitest run src/suite-order.test.ts --coverage.enabled=false     # GREEN
      Tests  2 passed (2)
$ pnpm turbo run e2e --dry=json | ...      # the task graph
@openverify/e2e#e2e ['@openverify/config#build', '@openverify/contracts#build', '@openverify/flow#e2e', '@openverify/node#build']
```

Then the whole suite, with the exclusion gone:

```text
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   38 passed (10.7s)
@openverify/e2e:e2e:   48 passed (6.1m)
real	6m17.283s
```

## 5. What the checks measured on the clips

`d088350` (test support, no behaviour): `recordSelfieMeasurements` keeps the pose, liveness, pose-repeat and comparison scores of four specs as a Playwright annotation and one log line. From the final `pnpm e2e` (identical to the earlier runs to four decimals; the guidance captured the same frames):

```text
[selfie measurements] head-turn-a (completes): {"yaw-ratios":{"left":0.211,"right":-0.1218,"center":0.0076},"yaw-ratio-changes":{"left":0.2034,"right":-0.1294},"passive-scores":{"left":0.9719,"right":0.9408,"center":0.8974},"face-cosines":{"left":0.8557,"right":0.7975},"planarity-residuals":{"left":0.0433,"right":0.0265},"document-similarity":0.6792}
[selfie measurements] head-turn-b (fails): {"yaw-ratios":{"left":0.0967,"right":-0.1262,"center":-0.0147},"yaw-ratio-changes":{"left":0.1114,"right":-0.1115},"passive-scores":{"left":0.9997,"right":0.9921,"center":0.9953},"face-cosines":{"left":0.7543,"right":0.7423},"planarity-residuals":{"left":0.0299,"right":0.0248},"document-similarity":0.1473}
[selfie measurements] head-turn-a stills (upload): {"yaw-ratios":{"left":0.2073,"right":-0.1257,"center":0.0154},"yaw-ratio-changes":{"left":0.1919,"right":-0.1411},"passive-scores":{"left":0.9245,"right":0.9473,"center":0.8938},"face-cosines":{"left":0.8562,"right":0.7993},"planarity-residuals":{"left":0.0216,"right":0.0235},"document-similarity":0.6797}
[selfie measurements] static-replay-a: {"yaw-ratios":{"left":0.0144,"right":0.0463,"center":0.0014},"yaw-ratio-changes":{"left":0.013,"right":0.0449},"passive-scores":{"left":0.9342,"right":0.8405,"center":0.9665},"face-cosines":{"left":0.9879,"right":0.9692},"planarity-residuals":{},"document-similarity":0.665}
```

Against the provisional thresholds: the happy path's smallest margins are person B's centre (|−0.0147| against `max-center-yaw-ratio` 0.021) and person B's turns (0.111 against `min-side-yaw-ratio-change` 0.077); passive means are 0.84-1.00 against 0.5; side cosines 0.74-0.86 against 0.4. Nothing was changed to make a fixture pass.

## 6. The C41.5 benchmark in CI, and its run

RED `fdbf351`, GREEN `03b5936`.

```text
$ bash infra/tests/ci-workflow.test.sh
FAIL - vision: runs the C41.5 selfie benchmark (tools/benchmark_selfie.py)
FAIL - vision: the selfie benchmark runs after pytest
FAIL - vision: the selfie benchmark is logged, never gated on a runner's speed (no --enforce)
FAIL - vision: the selfie benchmark appends its Markdown summary to the job summary
FAIL - vision: the selfie benchmark step fails when the tool fails (bash with pipefail)
# 127 passed, 5 failed, 0 skipped
$ bash infra/tests/ci-workflow.test.sh     # GREEN
ok   - actionlint 1.7.12 reports no problems
# 132 passed, 0 failed, 0 skipped
```

The benchmark on the idle development machine:

```text
$ cd services/vision && uv run --frozen python tools/benchmark_selfie.py
 17:10:33 up 1 day, 17:54,  0 user,  load average: 0.91, 1.93, 2.66
## Selfie analysis benchmark (C41.5)
- CPU: Intel(R) Xeon(R) CPU E5-1650 v3 @ 3.50GHz, 12 logical CPUs
- Input: centre, left and right selfies (person A, re-posed), 1280 x 960 px, JPEG quality 92
- Runs: 10, after one warm-up request that loads the models
- Median 0.39 s (min 0.38 s, max 0.43 s): within the 3.00 s budget
| faces, quality and embedding | 100 |   | face quality | 3 |   | head pose | 1 |
| passive liveness | 21 |   | occlusion | 22 |   | synthetic face | 143 |
| background | 32 |   | consistency | 32 |   | other (decode, upload, response) | 35 |
```

## 7. The C42.4 scan, re-measured

A throwaway `pgvector/pgvector:pg17` container of my own on a loopback port (`ov-integration-scanbench2`, `--rm`, stopped afterwards), migrated, idle machine:

```text
$ pnpm exec tsx --conditions=@openverify/source scripts/face-scan-benchmark.ts --templates=50000 --runs=5
face-scan:benchmark: decrypted and scored 50000 sealed templates in 2546 ms (median of 5 runs: 2408, 2421, 2546, 5115, 5118 ms; seeding took 13836 ms).
$ ... --templates=50000 --runs=10     # a fresh container
face-scan:benchmark: decrypted and scored 50000 sealed templates in 2494 ms (median of 10 runs: 2449, 2457, 2483, 2485, 2493, 2495, 2504, 2573, 5122, 5173 ms; seeding took 13843 ms).
$ docker exec ... psql -c 'vacuum analyze;' && ... --templates=50000 --runs=10
face-scan:benchmark: decrypted and scored 50000 sealed templates in 2404 ms (median of 10 runs: 2349, 2376, 2380, 2388, 2388, 2420, 5402, 5520, 5538, 5675 ms; seeding took 14071 ms).
 17:14:22 up 1 day, 17:58,  0 user,  load average: 1.12, 1.45, 2.29
```

Bimodal: most runs about 2.4 s, close to the plan's 2.1 s; 2 to 4 runs in 10 about 5.1-5.7 s, unaffected by a `VACUUM`, so not table bloat (likely CPU scheduling under WSL2). The benchmark deleted its scratch organization each time.

## 8. Capture events in the inquiry timeline (C40.1)

RED `443cd19`, GREEN `b4105b8`. C40.1 puts capture ids in the `filter[inquiry-id]` timeline query; Stage 1 and api-flow left it to `integration` (outside their paths). The query plan test also seeds 10,000 captures, and states its own timeout: api-flow saw its seeding pass the 30 s default under a load average of 17.

```text
$ cd packages/db && pnpm exec vitest run src/repositories/events-v2.test.ts --coverage.enabled=false
     × includes the events of the inquiry's selfie captures (C40.1) 74ms
AssertionError: expected [ …(5) ] to deeply equal [ …(7) ]
      Tests  1 failed | 6 passed (7)
$ pnpm exec vitest run --config vitest.integration.config.ts src/query-plans.integration.test.ts -t "C25.7"
     × serves an inquiry timeline, selfie captures included, from the events object index (C25.7, C40.1) 7184ms
AssertionError: expected [ …(3) ] to deeply equal [ …(4) ]
$ pnpm exec vitest run src/repositories/events-v2.test.ts src/repositories/events.test.ts --coverage.enabled=false     # GREEN
      Tests  9 passed (9)
$ pnpm exec vitest run --config vitest.integration.config.ts src/query-plans.integration.test.ts -t "C25.7" --reporter=verbose
EXPLAIN listEvents({ inquiryId }) over 40000 events, 20000 verifications, 10000 sessions and 10000 selfie captures:
Limit  (cost=130.93..131.00 rows=26 width=149)
  InitPlan 1
    ->  Append  (cost=0.00..27.11 rows=5 width=32)
          ->  Index Scan using verifications_environment_id_inquiry_id_created_at_idx on verifications
          ->  Index Scan using inquiry_sessions_environment_id_inquiry_id_idx on inquiry_sessions
          ->  Index Scan using selfie_captures_environment_id_inquiry_id_idx on selfie_captures
  ->  Sort  (cost=103.82..103.90 rows=32 width=149)
        ->  Index Scan using events_environment_id_object_id_idx on events
 ✓ ... serves an inquiry timeline, selfie captures included, from the events object index (C25.7, C40.1) 6787ms
```

## 9. The golden selfie analysis turns left (C41.1)

RED `9cbc733`, GREEN `2b0a2b5`. vision-face, checks-logic and api-worker each reported that `contracts/fixtures/vision/analyze-selfie.json` gave its left pose the yaw sign of a right turn. The generator (`tools/make_contract_fixtures.py`, Stage 1's) now writes `yaw_ratio` +0.118; the landmarks and `yaw_deg` follow.

```text
$ cd services/vision && COVERAGE_FILE=/tmp/openverify-cov-integration uv run --frozen pytest tests/test_contract_fixtures.py --no-cov -q
E       assert -0.106 >= 0.077
FAILED tests/test_contract_fixtures.py::test_selfie_left_pose_is_a_turn_to_the_users_left
1 failed, 18 passed in 0.29s
$ uv run --frozen python tools/make_contract_fixtures.py && pnpm exec prettier --write contracts/fixtures/vision/*.json
 contracts/fixtures/vision/analyze-selfie.json   | 6 +++---
$ COVERAGE_FILE=/tmp/openverify-cov-integration uv run --frozen pytest tests/test_contract_fixtures.py tests/test_selfie_v2.py tests/test_liveness.py --no-cov -q     # GREEN
105 passed in 2.96s
$ cd apps/api && pnpm exec vitest run src/ports.test.ts src/vision src/jobs --coverage.enabled=false
 Test Files  20 passed (20)
      Tests  371 passed (371)
$ cd apps/flow && pnpm exec vitest run src/guidance --coverage.enabled=false
      Tests  67 passed (67)
```

## 10. The selfie documentation (C45.4) and its virtual-camera test

RED `69a804c`, GREEN `4e6a9c1`. `docs/checks/selfie.md` is new; `docs/checks/sandbox-providers.md` gains the selfie providers; `docs/checks/government-id.md`'s `id_selfie_comparison` names its v2 selection and the shared threshold. The facts were read from the code: the registry entries, `SELFIE_CHECK_REASONS`, the config schemas, `SELFIE_CHECK_CONFIG_DEFAULTS` with their sources, the evaluators' headers, `SYNTHETIC_SIGNALS`, `CAPTURE_TIMING_RULES`, the sandbox providers, and the Stage 2-3 reports for the limits.

```text
$ cd packages/checks && pnpm exec vitest run src/selfie/virtual-cameras-docs.test.ts --coverage.enabled=false
     × equals VIRTUAL_CAMERA_NAMES: labels, match kinds and sources, in order 5ms
Error: ENOENT: no such file or directory, open '/home/mhnoor/persona-opensource/docs/checks/selfie.md'
      Tests  1 failed (1)
$ pnpm exec vitest run src/selfie/virtual-cameras-docs.test.ts --coverage.enabled=false     # GREEN
      Tests  1 passed (1)
```

## 11. Vitest's module cache and `import.meta.glob` (C48)

RED `b015319`, GREEN `022fa55`. The C48 row Stage 1 left open. A scratch reproduction first (a scratch test importing `GOLDEN_PROBLEMS` and a scratch problem fixture, both deleted afterwards):

```text
$ cd apps/flow && pnpm exec vitest run src/testing/zz-scratch-glob.test.ts --coverage.enabled=false     # cache warm, no fixture
      Tests  1 failed (1)
# a fixture contracts/fixtures/problems/zz-scratch-stale.json is added
$ pnpm exec vitest run src/testing/zz-scratch-glob.test.ts --coverage.enabled=false
   × sees every problems fixture 9ms                      # the stale glob
$ pnpm exec vitest run src/testing/zz-scratch-glob.test.ts --coverage.enabled=false --fsModuleCache=false
      Tests  1 passed (1)
$ pnpm exec vitest run --coverage.enabled=false                       # cost, cache on
   Duration  25.17s (environment 55%, tests 20%, setup 12%, import 11%, transform 3%)
$ pnpm exec vitest run --coverage.enabled=false --fsModuleCache=false  # cost, cache off
   Duration  23.94s (environment 54%, tests 19%, setup 12%, import 10%, transform 5%)
$ cd packages/config && pnpm exec vitest run src/vitest.test.ts --coverage.enabled=false
     × turns off Vitest's file-system module cache, which keeps import.meta.glob results stale (C48) 6ms
AssertionError: expected undefined to be false // Object.is equality
$ pnpm exec vitest run --coverage.enabled=false     # GREEN
      Tests  45 passed (45)
# the scratch reproduction again, with the shared config only: Tests  1 passed (1)
```

## 12. The apps image build context (C46.1, C48)

RED `8ff9995`, GREEN `1b6575c`. The validation list's image build failed:

```text
$ docker build -f infra/docker/apps.Dockerfile -t openverify/apps:integration-4a .
#17 11.40 @openverify/flow:build: error during build:
#17 11.40 @openverify/flow:build: Error: ENOENT: no such file or directory, open '/app/models/manifest.json'
ERROR: failed to build: ... exit code: 1
$ bash infra/tests/apps-image-context.test.sh
ok   - the apps image context has models/face_detection_yunet_2026may.onnx (the flow build reads it)
FAIL - the apps image context has models/manifest.json (the flow build reads it) (excluded by .dockerignore)
# 7 passed, 1 failed
$ bash infra/tests/apps-image-context.test.sh     # GREEN, after !models/manifest.json in .dockerignore
# 8 passed, 0 failed
$ docker build -f infra/docker/apps.Dockerfile -t openverify/apps:integration-4a .
#18 naming to docker.io/openverify/apps:integration-4a done
$ docker run --rm --entrypoint sh openverify/apps:integration-4a -c 'sha256sum apps/flow/dist/guidance/*.onnx apps/flow/dist/guidance/*.wasm; ls models'
ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0  apps/flow/dist/guidance/face_detection_yunet_2026may.onnx
3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2  apps/flow/dist/guidance/ort-wasm-simd-threaded.wasm
face_detection_yunet_2026may.onnx
manifest.json
```

The model's digest equals its pin in `models/manifest.json`; the WASM's equals flow-capture's pin; the image also serves ORT's `LICENSE.txt` and `ThirdPartyNotices.txt`. My test image was removed afterwards.

## 13. Two flow tests that failed only under load

`a287a59`. The first workspace-wide `pnpm turbo run test --force` (load average 8.7 rising) failed two flow tests that pass alone (three runs each):

```text
@openverify/flow:test:  FAIL  src/flow/use-screen-focus.test.tsx > useScreenFocus > has focus on the new heading when it appears, never on the page (WCAG 2.4.3)
TestingLibraryElementError: Unable to find role="heading" and name "Next screen"
@openverify/flow:test:  FAIL  src/steps/selfie-capture-step.test.tsx > SelfieCaptureStep: guidance (C46.1) > offers the manual shutter at once, logging nothing, when the detector cannot load
Error: expect(element).not.toHaveAttribute("aria-disabled", "true")
@openverify/flow:test:       Tests  2 failed | 710 passed (712)
```

- **The manual shutter.** The guidance state follows the prompt's render in a passive effect, so the shutter is offered one render after "Photo 1 of 3" is announced; the test asserted synchronously. It now awaits it while the fake clock stays at 0, so only "at once" can satisfy it, never the 10 s fallback. A mutant that reads an unavailable detector as still loading fails it.
- **The screen heading.** The test waited for a 10 ms timer with `findByRole`'s 1 s default. A first rewrite on fake timers inside `act` passed even with the hook's layout effect turned into a passive effect (`act` flushes passive effects before the mutation observer runs), so it was dropped; the test keeps real timers and bounds its wait by most of its own 20 s timeout.

```text
# mutant: useLayoutEffect -> useEffect in src/flow/use-screen-focus.ts (restored from a copy, no diff)
     × has focus on the new heading when it appears, never on the page (WCAG 2.4.3) 195ms
AssertionError: expected false to be true // Object.is equality
# mutant: statusOf(null) -> 'loading' in src/selfie/use-guidance.ts (restored from a copy, no diff)
     × offers the manual shutter at once, logging nothing, when the detector cannot load 1310ms
# both restored
      Tests  32 passed (32)      # three runs of both files
```

## 14. Plan amendments

`ca6521d` records api-worker's 20 amendments ("Workflow 4A Stage 3 (api-worker)"); `13d6efc` records this stage's ("Workflow 4A Stage 4").

## Final gates: the plan's validation list, in order

On `main` at `1b6575c` (the code), each in the foreground:

| Step | Command | Result |
|---|---|---|
| Install, format | `pnpm install --frozen-lockfile && pnpm format:check` | lockfile up to date; all files use Prettier style |
| Lint, typecheck | `pnpm turbo run lint typecheck --force` | 24 tasks, 0 cached, 1 min 45 s (run again at the end) |
| Unit | `pnpm turbo run test --force` | 12 tasks, 9,267 tests in 6 min 10 s, every package at or above 80% (below) |
| Integration | `pnpm test:integration` | api 62, db 46 |
| Models | `python3 scripts/fetch_models.py` | all eight present (pinned SHA-256) |
| Vision | `uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools && uv run --frozen pytest` | clean; 1,806 passed at 99.89% in 5 min 11 s |
| Android | `./gradlew testDebugUnitTest koverVerify assembleDebug lint --rerun-tasks` | BUILD SUCCESSFUL, 162 tasks executed; SDK 616 and demo 18 tests |
| E2E | `flock /tmp/openverify-e2e.lock pnpm e2e` | mocked flow 38 (11.6 s), then full stack 48 (6.1 min); 6 min 32 s in all |
| Image | `docker build -f infra/docker/apps.Dockerfile .` | builds (after item 12); the flow carries YuNet at its pinned digest |
| Infra | `for t in infra/tests/*.test.sh; do bash "$t"; done` | apps-image-context 8, check-connected-results 11, ci-workflow 132 (actionlint, pins verified remotely), compose 191 (live), install-gitleaks 9, pre-commit-hook 11 |
| Secrets | `gitleaks git --redact .` | 1,331 commits scanned, no leaks |

Unit tests per package (statements / branches / functions / lines):

| Package | Tests | Coverage |
|---|---|---|
| api | 2,449 | 97.6 / 90.58 / 98.55 / 97.64 |
| dashboard | 1,658 | 98.43 / 94.33 / 98.74 / 98.45 |
| contracts | 1,405 | 100 / 100 / 100 / 100 |
| checks | 1,318 | 99.02 / 90.12 / 99.64 / 98.96 |
| flow | 712 | 96.56 / 91.39 / 96.18 / 96.66 |
| db | 678 | 98.82 / 91.8 / 99.29 / 98.76 |
| core | 569 | 100 / 98.82 / 100 / 100 |
| node | 212 | 99.09 / 94.69 / 100 / 99.37 |
| flow-spec | 88 | 100 / 100 / 100 / 100 |
| e2e (harness) | 79 | 96.71 / 88.07 / 93.24 / 97.7 |
| ui | 54 | 100 / 97.72 / 100 / 100 |
| config | 45 | 100 / 100 / 100 / 100 |

The full-stack selfie specs' durations in the final run: `flow-bundle` 14.6 s, `government-id-review` 14.6 s, `reload-between-uploads` 20.9 s, `selfie-repeat` 32.8 s, `selfie-review` 18.3 s, `selfie-static-replay` 31.6 s, `verification-completes` 17.0 s, `verification-fails` 18.6 s. The stack was ready 34 s after the global setup started.

Not run here: the CI workflow on GitHub (pushing is the orchestrator's). The clips and the in-browser auto-capture are proven on this machine only; the fixtures agent noted that YuNet's numerics may differ by CPU, and the clip generator searches again on each machine.
