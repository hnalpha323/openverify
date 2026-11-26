# TDD evidence: Phase 4, Workflow 4A Stage 2, `flow-capture` (C46.1)

Scope: the web flow (`apps/flow`) speaks the C40 selfie capture protocol, with in-browser face
guidance (onnxruntime-web 1.30.0 and the pinned YuNet), the local Vite plugin for the guidance
files, the CSP change, the optional matching consent (C42.3), English and Spanish strings with a
live region, and the 3B follow-up "Try again in the capture step loses focus".

Every slice: a stub commit when a test needed a name that did not exist, then the RED test
(compiling, typechecking, failing at run time for the intended reason), then GREEN. Commands run
from `apps/flow` after `source scripts/env.sh`; iterating used
`pnpm exec vitest run <files> --coverage.enabled=false`.

## 1. YuNet decoding, its input, the yaw ratio, the guidance state machine

- Stubs: `dd7b5e6`, `1b71783` (the face score threshold and framing limits).
- RED `a8cb25f`: `src/guidance/{yunet-decode,head-pose,yunet-input,guidance-machine}.test.ts`.

  ```
  $ pnpm exec vitest run src/guidance --coverage.enabled=false
   Test Files  4 failed (4)
        Tests  50 failed | 4 passed (54)
  ```
  The decoder returned no face for the golden outputs, the yaw ratio was null, the input tensor
  empty, the thresholds zero (the 4 passing tests assert absences the stubs already gave).
- GREEN `8d4d6d2`:

  ```
  $ pnpm exec vitest run src/guidance --coverage.enabled=false
   Test Files  4 passed (4)
        Tests  54 passed (54)
  ```
  The decoder reproduces `contracts/fixtures/vision/yunet-decode.json` (OpenCV's face on the drawn
  synthetic face: box, landmarks to 2 decimals, score 0.8918 to 3). The yaw ratio reproduces the
  vision fixture's `head_pose.yaw_ratio` on the golden poses and is pinned for direction (a turn
  to the user's left grows it; a mirrored image flips it) and roll and scale invariance. The
  machine's triggers are read from `contracts/fixtures/flow/selfie-capture.json`:
  centre `|yaw| <= 0.8 x 0.021 = 0.0168`, side change `>= 1.25 x 0.077 = 0.09625` from the
  user's own centre frame, `hold-ms` 500, manual shutter after 10,000 ms or at once without a
  detector.

## 2. Guidance files, the Vite plugin, the detector, the CSP

- Stub `2961d72`: pins (`src/guidance/guidance-assets.ts`), ORT v1.30.0 `LICENSE.txt` and
  `ThirdPartyNotices.txt` vendored under `apps/flow/licenses/onnxruntime-web/` (fetched from the
  `v1.30.0` tag; SHA-256 `2f07c727...922c` and `143764b9...3de3`), plugin and detector stubs.
- RED `2e8122e`: `src/vite-plugins/guidance-assets-plugin.test.ts` (node environment; the
  shared `vitest.setup.ts` now skips its DOM stubs without a DOM), `src/guidance/face-detector.test.ts`,
  `src/security/security-meta.test.ts`.

  ```
  $ pnpm exec vitest run src/vite-plugins src/guidance/face-detector.test.ts src/security/security-meta.test.ts --coverage.enabled=false
   Test Files  3 failed (3)
        Tests  18 failed | 13 passed (31)
  ```
  "the plugin has no generateBundle hook", "expected [] to deeply equal [ …(5) ]", "promise
  resolved Uint8Array[] instead of rejecting", no `script-src` in the policy.
- GREEN `315e212`:

  ```
  $ pnpm exec vitest run src/vite-plugins src/guidance src/security --coverage.enabled=false
   Test Files  9 passed (9)
        Tests  89 passed (89)
  $ pnpm exec vite build --outDir <scratch>/flowdist
  guidance/ort-wasm-simd-threaded.mjs 24.38 kB, guidance/face_detection_yunet_2026may.onnx 229.73 kB,
  guidance/ort-wasm-simd-threaded.wasm 14,239.89 kB, licenses/onnxruntime-web/{LICENSE.txt,ThirdPartyNotices.txt}
  ```
  The plugin copies YuNet from `models/` (its pin must equal `models/manifest.json`'s), the ORT
  WASM and its loader from the installed package, and the notices, each SHA-256-checked; a
  mismatch or a missing file stops the build (`run python3 scripts/fetch_models.py`). The dev
  server serves the same verified files (checked: 200 `application/wasm` 14,239,897 bytes).
  Vite resolves ORT with the `onnxruntime-web-use-extern-wasm` condition: the bundled build's
  `new URL('ort-wasm-simd-threaded.wasm', import.meta.url)` made Vite emit an unverified second
  copy of the WASM (measured in a scratch build), the extern build does not.

  Measured in Chromium 156 under the production CSP before writing the detector (scratch page):
  ORT single-threaded, no cross-origin isolation, session create 356 ms, YuNet on a 320 x 256
  input 13-15 ms per run after the first (43 ms). A corrupted or missing WASM makes ORT's
  Emscripten glue `console.error` ("wasm streaming compile failed", "Aborted(...)"), so the
  detector fetches and checks the WASM, the loader and the model itself, hands ORT the verified
  binary (`env.wasm.wasmBinary`), and never imports ORT when a digest differs: nothing is logged.

## 3. The C40 protocol on the client

- Stub `906f9cd`: `createSelfieCapture`, the upload's capture fields and the submit body on
  `FlowApiClient`; `src/selfie/{capture-protocol,device-snapshot}.ts`. The existing
  `submit-verification.test.ts` double gained the new member (a refusal), nothing else.
- RED `de5580e`: client, final-outcome, protocol and device tests against the golden
  `selfie-capture-created.json` and `selfie-capture-submit.json`; the fake flow API speaks C40.

  ```
  $ pnpm exec vitest run src/selfie src/api --coverage.enabled=false
   Test Files  4 failed | 3 passed (7)
        Tests  28 failed | 112 passed (140)
  ```
- GREEN `12b3259`:

  ```
   Test Files  7 passed (7)
        Tests  140 passed (140)
  ```
  Upload multipart order: `kind`, `capture-id`, `nonce`, `client-elapsed-ms`, `file`; a device
  snapshot built from a synthetic camera equals the golden submit fixture's.

## 4. The optional matching consent (C42.3)

- Stub `d37db5e`; RED `6b49cbc`:

  ```
  $ pnpm exec vitest run src/i18n src/steps/consent-step.test.tsx src/components/consent-screen.test.tsx src/flow/flow-renderer.test.tsx --coverage.enabled=false
   Test Files  4 failed | 6 passed (10)
        Tests  14 failed | 100 passed (114)
  ```
- GREEN `7fed894`: `Test Files 10 passed (10)`, `Tests 114 passed (114)`.

## 5. The guided selfie step

- Stub `52dd0d5` (strings in English and Spanish, the environment's detector, frame sampler,
  clock and 8 Hz interval, the step component, not yet routed).
- RED `22d9bff`: `src/steps/selfie-capture-step.test.tsx` (30 tests), the frame sampler, the
  3B focus tests of the government ID step, the renderer's selfie path; the unit fixtures'
  `defaultFlow()` is now the C45.1 default (three poses, active), with `centreOnlyFlow()` for
  the Phase 1-3 step.

  ```
  $ pnpm exec vitest run --coverage.enabled=false
   Test Files  4 failed | 51 passed (55)
        Tests  38 failed | 668 passed (706)
  ```
- RED, browser `8972c52` (the mocked API speaks C40; `selfie-capture.spec.ts` and updated
  specs), run against the not-yet-routed flow:

  ```
  $ flock /tmp/openverify-e2e.lock pnpm exec playwright test --config e2e/playwright.config.ts
  ✘ flow.spec.ts completes the default flow ... a guided selfie from the fake camera
  ✘ review.spec.ts (2), sandbox.spec.ts (2), selfie-capture.spec.ts (7)
  26 passed, 12 failed
  ```
  The consent spec added there passed at once: its unit GREEN (`7fed894`) came first.
- GREEN `a2ae9dd`: the renderer routes selfie steps to `SelfieCaptureStep`; the government ID
  step keeps Try again mounted and focused while a retry runs.

  ```
  $ pnpm exec vitest run --coverage.enabled=false
   Test Files  55 passed (55)
        Tests  706 passed (706)
  $ flock /tmp/openverify-e2e.lock pnpm exec playwright test --config e2e/playwright.config.ts
    38 passed (10.9s)
  ```
  One RED test was wrong, and the GREEN commit says so: the side-pose guidance test moved the
  clock before the first detection, so the hold began after it; it now waits for "Hold still"
  first. While making it GREEN, the step memoises its guidance thresholds: a new object per render
  restarted the guidance effect on every render (the test run hung until fixed).

## 6. After GREEN

- RED `2094b5b` / GREEN `ab24df1`: with the detector ready, a prompt starts with its own
  instruction instead of flashing "Getting the face guide ready…" (`3 failed | 33 passed`, then
  `709 passed`). Found by the clip check below.
- `bd42a92`: tests of the default environment (8 Hz, the guidance files from the flow's origin, a
  failed detector load tried again on the next step). These passed when written: the loader was
  built under `a2ae9dd`, whose tests inject the detector.

## Clip check (scratch, not committed)

The built flow with the mocked API, in Chromium with `--use-file-for-fake-video-capture` on the
`fixtures` agent's generated clips (`fixtures/generated/selfie/*.mjpeg`, gitignored):

| Clip | What the guidance did | `client-elapsed-ms` of each upload |
|---|---|---|
| `head-turn-a.mjpeg` | centre, left, right all auto-captured, no manual shutter | 764, 2,072, 5,950 |
| `head-turn-b.mjpeg` | the same | 763, 2,214, 5,944 |
| `static-replay-a.mjpeg` | centre auto-captured; the left prompt never satisfied ("Slowly turn your head to the left", "Move your face to the middle"), so the user is left with the manual shutter after 10 s | 2,348 |

Auto-capture end to end belongs to Stage 4 (`integration`); this only shows the pipeline runs.

## Final gates (foreground)

```
$ pnpm --filter @openverify/flow typecheck      # tsc --noEmit && tsc --noEmit -p e2e: no errors
$ pnpm --filter @openverify/flow lint           # eslint .: no problems
$ pnpm --filter @openverify/flow test
 Test Files  55 passed (55)
      Tests  712 passed (712)
Statements 96.56% | Branches 91.39% | Functions 96.18% | Lines 96.66%
$ pnpm format:check
All matched files use Prettier code style!
$ flock /tmp/openverify-e2e.lock pnpm e2e         # with the Stage 1 selfie exclusion
@openverify/flow:e2e:  38 passed (12.7s)
@openverify/e2e:e2e:   36 passed (3.1m)
 Tasks:    9 successful, 9 total
```
