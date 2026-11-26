# TDD evidence: Workflow 4A Stage 2, `fixtures` (C45.2 selfie fixtures, the fetch script, the selfie calibration and benchmark tools)

- **Slice owner:** `fixtures` (Workflow 4A, Stage 2), in parallel with `vision-face`, `vision-integrity`, `checks-logic`, `flow-capture` and `android-capture`.
- **Date:** 2026-10-21.
- **Input:** `docs/plans/phase-4.plan.md` C40.11, C41.5, C45.2, C48 (the `fetch_fixtures.py` row) and C49, the Stage 1 amendments (2: the clip's centre segment; 3: the shared constants file), and the Stage 1 handoff (the re-pose helper, the constants file, the calibration JSON schema).
- **Paths:** `services/vision/tools/` (except `make_contract_fixtures.py` and `repose.py`), their tests in `services/vision/tests/`, `scripts/fetch_fixtures.py`, `fixtures/manifest.json`.
- **Commits:** `bde5b3c..82a9451` (17 commits), then this file.

Each item follows the same cycle:
1. A `chore` commit adds the names a test needs, doing nothing useful, so the RED test imports and passes mypy.
2. The test is run and seen failing for the intended reason (RED).
3. The smallest change makes it pass (GREEN).
4. Tests for the remaining branches follow on a green suite.

All commands ran in `services/vision` after `source scripts/env.sh`, with `COVERAGE_FILE=/tmp/openverify-cov-fixtures` and mypy's `--cache-dir /tmp/openverify-mypy-fixtures`; while iterating, tests ran with `--no-cov`. Other agents worked in the same tree, and the machine's load average reached 23 on 12 cores, so the timings below are inflated. Output is trimmed to the lines that matter.

## 1. `scripts/fetch_fixtures.py` (C48 row, C49.1)

Stubs `bde5b3c` (`RateLimiter`, `PoliteOpener`, `NotFoundError`, `RateLimitedError`, `retry_after_seconds`, `commons_file_name`, `archive_url`, `CalibrationImage`, `load_calibration_manifest`, the `clock` and `sleep` arguments of `main`) and `0454ad6` (`commons_api_url`). RED `544e92e`, GREEN `f5863e7`, branch tests `8d55447`.

The tests run against `tests/fetch_script.py`: a fake web that answers by URL the way `urllib` does (an `HTTPError` carrying the reply's headers from status 400 on) and records each request with a fake clock's time. Nothing touches the network and nothing sleeps.

- **Etiquette:** request starts at least 1 s apart, from the first request on, and across threads. At most 2 requests in flight: a barrier proves two downloads overlap with `--jobs 2`, one job never overlaps, and `--jobs 3` is refused.
- **Retries:** `Retry-After` in seconds or as an HTTP date (a date in the past is 0); 503 is retried like 429; without the header, a doubling backoff (2 s, then 4 s); a short `Retry-After` keeps the 1 s spacing. The script gives up after 5 attempts, or at once when asked to wait more than 300 s, and leaves nothing behind. Other errors are not retried; 404 and 410 are a `NotFoundError`.
- **Re-uploaded files:**
  - when a Commons original's bytes do not match, the Commons API lists the file's revisions;
  - an archived revision is tried when its SHA-1 equals the pinned `sha1` (or, without one, its size equals the pinned size), at most three of them;
  - it is accepted only when its SHA-256 equals the pin;
  - the archive URL is `archive/<a>/<ab>/<YYYYMMDDHHMMSS>%21<name>`, checked against the research's verified Lovell example;
  - a URL off Commons, a failed or unreadable lookup, or no matching revision keeps the digest mismatch.
- **Templates:** words may be separated by single spaces (`PD-USGov-Military-Air Force`); double, leading and trailing spaces and tabs are refused.
- **Calibration mode:**
  - the manifest format is in the script's docstring: pseudonymous ids (`p0001`, `p0001-1`), no name fields, Commons originals without a query string, NASA, DOS and Military templates only, SHA-256, SHA-1, size, the page revision id, an optional year and a pinned review;
  - a run tolerates up to `--max-missing` deleted files (default 10) and prints `used N of M images`;
  - any digest mismatch fails the run.

RED (the stubs raise; the template regex and the unknown `sha1` field are the old behaviour):

```text
$ uv run --frozen pytest tests/test_fetch_fixtures.py tests/test_fetch_fixtures_polite.py tests/test_fetch_fixtures_calibration.py --no-cov -q
E       NotImplementedError                                                  (67 times)
E           fetch_fixtures.ManifestError: unknown field(s): sha1                 (10 times)
E           fetch_fixtures.ManifestError: license_template must be a US federal government work template (PD-USGov...)
E       SystemExit: 2                                         (--calibration and --jobs do not exist yet)
89 failed, 65 passed in 14.35s
```

GREEN:

```text
$ uv run --frozen pytest tests/test_fetch_fixtures.py tests/test_fetch_fixtures_polite.py tests/test_fetch_fixtures_calibration.py tests/test_fixture_manifest.py --no-cov -q
159 passed in 3.27s
```

With the branch tests, the script is at 100% line and branch coverage (`--cov=fetch_fixtures`, 560 statements, 174 branches); it lives outside the vision package's coverage gate.

**`fixtures/manifest.json`** (RED `0e184fa`, GREEN `3d60626`). Each face now pins its Commons `sha1`, the value its file-page check had recorded in `notes` (re-checked with `sha1sum` on the fetched files), so the archive fallback works for the test faces too. The same RED test lets the committed `fixtures/calibration-manifest.json` exist beside it (C49.1 commits it).

```text
E           AssertionError: person_a_id
E           assert 0 == 40
1 failed, 5 passed
...
71 passed in 2.97s
```

## 2. The C45.2 selfie set (`head_turn.py`, `selfie_spoofs.py`, `selfie_composites.py`, `synthetic_selfie.py`, `make_synthetic_fixtures.py`)

Stubs `3523a63`, `e48eada` and `1e75b60`, RED `f74061d`, GREEN `f56d8d7`, error-path tests `6f89a14`.

### The measurement that shaped the generator

Stage 1's anchor was measured on whole portraits scaled to 640 pixels, where the face is about 107 pixels tall. In the clip's 640 x 480 selfie framing, YuNet's five-point yaw ratio reads differently. It also depends on the framing, and the service's multi-scale search can return either scale's landmarks. This was a scratch experiment, not committed. It rendered each portrait at several framings and read three paths:
- the client's 320-pixel preview;
- the server at 640 pixels;
- the server at 320 pixels, of the frame as the web flow uploads it (Chromium's I420 frame, re-encoded as a JPEG at 0.92).

| Framing (face share of height) | A: centre, extremes clear? | B: centre, extremes clear? |
|---|---|---|
| 0.45 (the old `fake_camera` framing) | centre reads +0.035 | B's left turn reads 0.083 on the server (below 0.096) |
| 0.30 | the unmodified portrait reads within 0.0168; both extremes clear on every path | the left turn reads 0.082 at 640 px |
| 0.28 | no | clears with a centre render at +1 or +2 degrees |

So the generator adapts, never the thresholds (plan amendment 2). `plan_head_turn` tries the framings 0.30, 0.28, 0.32, 0.26, 0.34 and 0.36 in that order, and for each the centre yaws 0, +1, -1, ... ±5. The extremes stay at the constants' ±24 degrees. It keeps the first combination whose readings meet the centre trigger (0.8 x 0.021) and the side trigger (1.25 x 0.077) on every path. If none does, it raises `ClipError` with every reading (a blocker, never a lower threshold).

The same experiment found:
- YuNet at the service's 0.9 threshold loses a face whose mask covers the nose, or whose scarf reaches the mouth corners on a turned pose;
- the print halftone was invisible to YuNet with 6-pixel dots at 2x.

So the mask covers the mouth from below the nose, the scarf covers the chin, and the print's dots are 1.5 camera pixels apart.

### RED and GREEN

The model-free tests use `tests/selfie_fakes.py`. Its `MarkerKit` renders by shifting the frame and writing the yaw into a pixel, and reads a yaw ratio back from it; `drawn_face` is a cartoon face with known landmarks. `test_selfie_fixtures_real.py` reads the real set with YuNet and SFace, independently of the generator's own search, and checks:
- the clip against `selfie-capture.json`: 640 x 480, 30 fps (Chromium's fixed MJPEG rate), the cycle from the centre, holds of at least 1.5 s, the period, one render per hold;
- the yaw at each extreme against 1.25 x the server minimum, and the centre within 0.8 x the server maximum, on the client path and on the server path. The server path is the service's own multi-scale `FaceEngine` on the browser-like upload.

```text
$ uv run --frozen pytest tests/test_head_turn.py tests/test_selfie_spoofs.py tests/test_selfie_composites.py tests/test_synthetic_selfie.py tests/test_selfie_fixtures_real.py tests/test_make_synthetic_fixtures.py --no-cov -q
E       NotImplementedError                                                  (62 times)
E       AssertionError: assert ['.generator-...e-a.y4m', ...] == ['.generator-...e-a.jpg', ...]   (no selfie/)
E       AssertionError: assert not True                       (a stale selfie/ file survives)
E       AssertionError: assert set() == {'phone_bezel...creen_replay'}   (no spoof yet)
41 failed, 17 passed, 1 skipped, 27 errors in 13.18s
```

GREEN corrected three wrong assumptions of the RED tests:
- a turn and its way back pass the same yaws, so they share renders, and the render count is the number of distinct yaws (the yaws are now rounded to 1e-6 degrees so the cache can see it);
- the static replay sways widest a quarter of the way through its loop; half way it is back at frame 0;
- the scarf covers the chin, not the mouth (the measurement above).

```text
$ uv run --frozen pytest tests/test_head_turn.py tests/test_selfie_spoofs.py tests/test_selfie_composites.py tests/test_synthetic_selfie.py tests/test_selfie_fixtures_real.py tests/test_make_synthetic_fixtures.py tests/test_real_faces.py --no-cov -q
96 passed in 137.30s (0:02:17)
```

### The real clips, read back (`test_selfie_fixtures_real.py -s`)

```text
head-turn-a: framing {'face_height': 0.3, 'face_top': 0.3}, centre yaw 0.0 deg, extremes +-24.0 deg; centre trigger 0.0168, side trigger 0.0963
  client: centre -0.0004, left +0.2066 (change +0.2070), right -0.1316 (change +0.1312)
  server: centre +0.0088, left +0.2052 (change +0.1964), right -0.1297 (change +0.1385)
head-turn-b: framing {'face_height': 0.28, 'face_top': 0.3}, centre yaw 1.0 deg, extremes +-24.0 deg; centre trigger 0.0168, side trigger 0.0963
  client: centre -0.0132, left +0.1538 (change +0.1671), right -0.1483 (change +0.1350)
  server: centre -0.0124, left +0.0934 (change +0.1057), right -0.1316 (change +0.1192)
static-replay-a client readings: [-0.0017, 0.0013, -0.0234, -0.0079, -0.0017, 0.0028, 0.0184, 0.0143]
head-turn-a: centre vs ID portrait 0.7122; side vs centre {'left': 0.8562, 'right': 0.7993}
head-turn-b: centre vs ID portrait 0.1191; side vs centre {'left': 0.7500, 'right': 0.7513}
YuNet scores of the spoofs and composites: 0.904-0.945 (mask at nose height + 6: 0.904-0.911; raised to template y 84: 0.916-0.921)
```

The generator's own record of every path (`selfie/index.json`) has:
- for B: `server@640` left 0.0934 and `server@320` 0.1527, against a centre of -0.0131 and -0.0124;
- for A: `server@640` left 0.2168.

The smallest change on any path is B's left turn on the 640-pixel server path, 0.1065, which clears 0.0963 by 0.010.

The real set has 3 clips (228, 228 and 120 frames; 14.1, 11.1 and 6.7 MB), 6 still frames and 27 spoof and composite frames, 34 MB in all. It takes 22-25 s to generate.

### Coverage

Run on the selfie tests only:

```text
tools/head_turn.py            307 stmts   100%   (with the error-path tests)
tools/make_synthetic_fixtures.py  166     100%
tools/selfie_composites.py    131         100%
tools/selfie_spoofs.py        172         100%
tools/synthetic_selfie.py     110         100%
```

## 3. `tools/calibrate_selfie.py` and `tools/benchmark_selfie.py` (C49, C41.5)

Stub `26ba7cc`, RED `00111d7`, GREEN `2e9b9e9`, edge and real-model tests `82a9451`.

`calibrate_selfie.py` writes Stage 1's `selfie-calibration.schema.json`. The test checks the output against the committed schema with `tests/schema_check.py`, a small checker for the schema's keywords (`jsonschema` is not a dependency, and this stage adds none). It also checks:
- the fixed near-duplicate rules (cosine above 0.93, or aligned-crop correlation above 0.95);
- the pinned review exclusions, `fetch_failed` and `no_face`;
- genuine pairs within an identity, and one image per identity for the impostor pairs;
- the age gap, the sex counts and the ITA medians;
- the provisional keys.

**No embedding reaches disk:** the test runs the tool with distinctive seeded embeddings. It then finds no file beside the output (nothing in the working directory either), none of the embedding components in the output at 6 decimals or as `repr`, and no 128-long list anywhere. A real-model run on the three test faces does the same with YuNet and SFace.

```text
$ uv run --frozen pytest tests/test_calibrate_selfie.py tests/test_benchmark_selfie.py --no-cov -q
E       NotImplementedError                                                  (21 times)
E       AssertionError: assert () == ('faces, qual...ic face', ...)
16 failed, 1 passed, 6 errors in 1.44s
...
$ uv run --frozen pytest tests/test_calibrate_selfie.py tests/test_calibrate_selfie_real.py tests/test_benchmark_selfie.py tests/test_selfie_fixtures_real.py -q -s --cov=tools
pairs: [{'a': 'p0001-1', 'b': 'p0001-2', 'genuine': True, 'cosine': 0.7382, 'age_gap_years': None}, {'a': 'p0001-1', 'b': 'p0002-1', 'genuine': False, 'cosine': 0.1303}]
- CPU: Intel(R) Xeon(R) CPU E5-1650 v3 @ 3.50GHz, 12 logical CPUs
- Median 0.27 s (min 0.27 s, max 0.27 s): within the 3.00 s budget        (one run at 640 px, the test's size)
tools/benchmark_selfie.py   157 stmts   100%
tools/calibrate_selfie.py   309 stmts   100%
43 passed in 103.33s
```

By then `vision-face` and `vision-integrity` had filled their modules in the working tree, so the provisional distributions of the real synthetic set carry measurements. These are pipeline fixtures, not attack-detection rates:

```text
center_yaw_ratio [0.0154, -0.0099]; side_yaw_ratio_change [0.1919, 0.1411, 0.1032, 0.1276]
side_face_cosine_to_center [0.8562, 0.7993, 0.75, 0.7513]
planarity_median_residual_ratio [0.02158, 0.02348, 0.03286, 0.02973]   static replay [0.0003, 0.0]
passive_liveness_mean [0.8938, 0.9915]; screen_replay [0.5895]; phone_bezel [0.0085];
  phone_full_frame [0.9888]; print_halftone [0.5398]
covering_score [0.214, 0.2212]; mask [0.6982]; scarf [0.3984]; hand [0.1523]
glasses_score [0.1208, 0.1426]; clear [0.8]; dark [0.8]
```

## 4. Final gates

```text
$ uv run --frozen ruff check            -> All checks passed!
$ uv run --frozen ruff format --check   -> 155 files already formatted
$ uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-fixtures -> Success: no issues found in 59 source files
$ COVERAGE_FILE=/tmp/openverify-cov-fixtures uv run --frozen pytest
Required test coverage of 80% reached. Total coverage: 99.89%
1805 passed in 296.41s (0:04:56)
$ flock /tmp/openverify-e2e.lock uv run --frozen python tools/make_synthetic_fixtures.py   (into fixtures/generated/)
stamp 6+9067ea6fbfe9; selfie/ holds 37 files, 34 MB
$ flock /tmp/openverify-e2e.lock pnpm e2e        (with the Stage 1 exclusion of the five selfie specs)
@openverify/flow:e2e:   38 passed (13.0s)
@openverify/e2e:e2e:   36 passed (3.1m)
```

The C41.5 benchmark at its real size is a preliminary figure, run with the Stage 2 vision code then in the working tree. Workflow 4A Stage 4 re-measures it and adds the CI step.

```text
$ uv run --frozen python tools/benchmark_selfie.py
- CPU: Intel(R) Xeon(R) CPU E5-1650 v3 @ 3.50GHz, 12 logical CPUs
- Input: centre, left and right selfies (person A, re-posed), 1280 x 960 px, JPEG quality 92
- Runs: 10, after one warm-up request that loads the models
- Median 0.41 s (min 0.40 s, max 0.43 s): within the 3.00 s budget
| faces, quality and embedding | 106 | face quality | 4 | head pose | 1 | passive liveness | 22 |
| occlusion | 20 | synthetic face | 155 | background | 33 | consistency | 31 | other | 35 |   (ms)
```

The 4 statements the gate misses are in Stage 1's `make_contract_fixtures.py` and `repose.py` (not this agent's to change), plus one branch of `measure_yaw_anchor.py`.

Another agent's e2e run had already regenerated `fixtures/generated/` with this generator before mine. Its stamp was `6+9067ea6fbfe9` when I looked, so the stamp check of `e2e/setup/stack.ts` picks up the new version without a change to `e2e/`.
