# TDD evidence: Workflow 4B review fixes (Python)

- **Slice owner:** Python fixer (Workflow 4B, fix stage).
- **Date:** 2026-10-21.
- **Input:** the Workflow 4B review of the vision service, its tools, the fetch scripts and the licence notices in Phase 4 (`8350c31..HEAD`).
  - Blocking: none.
  - MEDIUM, in priority order: K204 (licence, a known item from Workflow 4A), H008 (denial of service), H009 (licence), H007 (robustness) and H010 (robustness).
- **Paths owned:**
  - `services/vision/`, `models/manifest.json`, `scripts/fetch_models.py`, `scripts/fetch_fixtures.py`, `contracts/fixtures/vision/`;
  - `infra/docker/`, `infra/tests/compose.test.sh`, `infra/tests/apps-image-context.test.sh`, `THIRD_PARTY_LICENSES.md`, `apps/flow/licenses/`;
  - this file.
- **Dependencies:** none added. `pyproject.toml` and `uv.lock` are unchanged.
- **Golden fixtures:** `contracts/fixtures/vision/*.json` are byte-identical (no fix changes what they cover).
- **Untouched:** `infra/docker/`, `infra/tests/*.sh` and `apps/flow/licenses/`. The `apps.Dockerfile` build and the infra shell tests were therefore not required. `services/vision/Dockerfile` changed by one comment, and its image was built (see the final gates).

Each fix follows the same cycle:
1. Write a regression test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

The test and the fix are separate path-scoped commits. Every command ran from `services/vision` after `source ../../scripts/env.sh`, unless shown otherwise. Pytest ran with `COVERAGE_FILE=/tmp/openverify-cov-python-fixer` and mypy with `--cache-dir /tmp/openverify-mypy-python-fixer`. Output is trimmed to the lines that matter.

**RED tests type-check.** `mypy src tools` (the gate) does not cover `tests/`. Each RED test file was therefore also checked with `MYPYPATH=../tools:. mypy <file>` from `tests/`. The new code added no error. The only errors reported already exist in the shared helpers (`document_cards.py`, `synthetic.py`), in `test_app_analyze.py::test_default_engine_is_created_lazily_from_settings`, and in three existing `test_replay.py` lines; the committed version of each file reports the same count.

**Real-model before/after.** H008 and H007 change how the selfie consistency is computed. Their outputs were checked against the tree before the fixes, with the real models (`models/`, fetched). The before tree is a `git archive` copy of `services/vision/src` at `10b7313`, run with `PYTHONPATH` pointing at it. The scripts live in the session scratchpad and are not committed. They print only counts, sizes, times and memory, never a measurement of a face.

**Data.** No calibration image or measurement was read. The before/after checks use the generated pose triplets of `fixtures/generated/selfie/` (public-domain faces, re-posed) and person A's public-domain selfie scaled up, all kept in memory or in the scratchpad.

## Baseline

At `2965048`:

```
$ uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools --cache-dir …
All checks passed!
156 files already formatted
Success: no issues found in 59 source files
$ COVERAGE_FILE=… uv run --frozen pytest
TOTAL                                           7242      9   1130      7    99%
Required test coverage of 80% reached. Total coverage: 99.81%
1862 passed in 302.96s (0:05:02)
```

## K204 (MEDIUM): the onnxruntime-web row did not say where the flow's ORT notices are

**Confirmed.** The flow vendors ONNX Runtime v1.30.0's `LICENSE` and `ThirdPartyNotices.txt` in `apps/flow/licenses/onnxruntime-web/`. `guidance-assets.ts` serves them at `licenses/onnxruntime-web/LICENSE.txt` and `licenses/onnxruntime-web/ThirdPartyNotices.txt`. The row in `THIRD_PARTY_LICENSES.md` named neither.

The only test that reads `THIRD_PARTY_LICENSES.md` is `services/vision/tests/test_ocr_notice.py`, so the check went there.

**RED** (`e9aac59`): `test_the_onnxruntime_web_row_names_the_notices_the_flow_serves`. It checks three things:
- the row names `apps/flow/licenses/onnxruntime-web/`;
- the row names both served paths, and both files exist;
- the Eigen MPL-2.0 note is still in the row.

```
$ uv run --frozen pytest tests/test_ocr_notice.py --no-cov -q
E       assert '`apps/flow/licenses/onnxruntime-web/`' in "| onnxruntime-web | 1.30.0 (2026-09-14) | MIT | npm | `apps/flow`: …"
1 failed, 6 passed in 0.08s
```

**GREEN** (`c5e58ed`). The row gains a **Notices** sentence:
- ORT v1.30.0's two files are vendored in `apps/flow/licenses/onnxruntime-web/`;
- they are served at `/licenses/onnxruntime-web/LICENSE.txt` and `/licenses/onnxruntime-web/ThirdPartyNotices.txt`;
- both must be kept whenever the flow is distributed.

The Eigen sentence and the owner decision are unchanged.

```
$ uv run --frozen pytest tests/test_ocr_notice.py --no-cov -q
7 passed in 0.06s
$ pnpm exec prettier --check THIRD_PARTY_LICENSES.md      # from the repository root
All matched files use Prettier code style!
```

## H008 (MEDIUM): a selfie job held every full-size decode at once

**Confirmed** by reading `app.py::_selfie`. It decoded `center`, `left` and `right` into one dict before loading the models, and kept every array to the end of the job through the poses' `PoseFrame`s.

I measured it on three 6000 x 6500 JPEG poses (2.96 MB each), made from person A's public-domain selfie scaled up, with the real models warmed up first. The script was `selfie_peak.py` in the scratchpad.
- Per stage of one pose (tracemalloc): the decode peaks at +223 MiB.
- `summarize_quality` peaks at +632 MiB: the float64 Laplacian and the deviation temporary of `np.var`.
- Every other stage stays under +71 MiB.

**RED** (`10b7313`), in `tests/test_app_concurrency.py`:
- `test_a_selfie_job_holds_one_full_size_decode_at_a_time[centre-face|no-face]`: a spy on the app's `decode_image` counts, before each decode, how many earlier decodes are still alive (weak references, after `gc.collect()`).
- `test_a_bad_side_pose_still_wins_over_missing_models`: a guard, which passes before and after. It pins the ordering the fix must keep: a bad `right` upload answers 415, not 503, when the models are missing.

```
$ uv run --frozen pytest tests/test_app_concurrency.py --no-cov -q
E       assert [0, 1, 2] == [0, 0, 0]          # centre-face
E       assert [0, 1, 2] == [0, 0, 0]          # no-face
2 failed, 8 passed in 2.02s
```

**GREEN** (`407995f`):
- **`app.py`.** The models load first (`_analyzer_after_uploads`). When they cannot load, every upload is decoded first, one at a time and each one dropped, then the error is raised again. Client errors therefore still win over a 503. The poses are then decoded and analysed one at a time. The centre is reduced to its `PoseAnalysis` and a `CenterReference`; each side to its `PoseAnalysis` and its consistency entry. A full-size array never outlives its pose.
- **`replay.py`.** The centre's half of the region (the face box grown by the margin, the working scale and the grey working crop) moves from `_region` into `center_reference`, which is computed once. `measure_consistency` takes either the centre's `PoseFrame` (as before) or its reference.
- **`analysis.py`.** `selfie_consistency` measures one side against the reference.
- **`liveness.py`.** The first GREEN run still failed `[centre-face]` with `[0, 1, 2]`. A spy on `gc.get_referrers` showed the decode held by the frames of `predict`, `measure` and `analyze_selfie_pose`. The "anti-spoofing models unavailable" warning passed the exception object as a log argument. pytest's log capture keeps records, so it kept the exception, its traceback and the calling frames, with their decode. The same holds for any log handler that keeps records. The warning now logs `str(exc)`: the same text, without the traceback.

```
$ uv run --frozen pytest tests/test_app_concurrency.py tests/test_replay.py tests/test_selfie_v2.py tests/test_app_analyze.py tests/test_selfie_face_route.py tests/test_contract_fixtures.py tests/test_liveness.py tests/test_benchmark_selfie.py --no-cov -q
201 passed in 21.52s
```

**Unchanged results.** I compared the real-model selfie analysis before and after the fix on 110 cases:
- the 11 generated pose triplets of `fixtures/generated/selfie/`;
- five upload sets each: all three poses, the centre only, the centre and the right, a duplicate left, and swapped poses;
- each with source `camera` and `upload`.

The `SelfieAnalysis` JSON is byte-identical in all 110 (`diff -rq` empty).

**Memory after the fix.** The same three 39-megapixel poses, peak RSS from `/proc/self/status`, without tracemalloc:

| | Peak RSS | Over the warmed-up start | Traced NumPy peak |
|---|---|---|---|
| Before (`10b7313`) | 1,263 MB | 995 MB | 967 MiB |
| After | 1,005 MB | 740 MB | 744 MiB |

What remains is per pose and sequential:
- Pillow's and OpenCV's decode transient (about 650 MB for 39 Mpx: the RGBX image, the `exif_transpose` copy, `convert("RGB")`, `tobytes` and the BGR array);
- the float64 Laplacian and its variance in `summarize_quality` (about 630 MiB).

Both are shared by every route, and neither is what H008 reported (decodes held together). They are left as they are. The compose memory limit the review also suggested is in `infra/docker-compose.yml`, which is outside these paths.

**Refactor** (`937ff4d`). Two tests in `tests/test_replay.py` pin the new API. Both pass on GREEN (characterisation):
- `test_the_centre_reference_measures_exactly_what_the_centre_frame_does[face|no-face|outside]`;
- `test_the_centre_reference_keeps_a_working_copy_not_the_frame`: for a 3200 x 2400 frame, the crop is grey, at most 600 px with a face or 256 px without, and not a view of the frame.

## H009 (MEDIUM): no attribution for the Phase 4 derived code

**Confirmed.**
- `liveness.py` ports Minivision's `CropImage._get_new_box` and `CropImage.crop` (`src/generate_patches.py`), `to_tensor` (`src/data_io/functional.py`) and the fusion (`src/anti_spoof_predict.py`, `test.py`).
- `pose.py`'s `CANONICAL_LANDMARKS_CM` are five points of MediaPipe's `canonical_face_model.obj`.
- `services/vision/NOTICE` had no entry for either, and neither module carried a header.

Upstream facts, read on 2026-10-21:
- Silent-Face-Anti-Spoofing's `LICENSE` at `b6d5f04ad78778917853b25c778acef6d5626d15` is Apache-2.0 with "Copyright 2020 Minivision" in its appendix. `generate_patches.py` names its author and company and carries no copyright line.
- At `a908d668c730da128dfa8d9f6bd25d519d006692`, the mesh file has no header. Its directory's `BUILD` reads "Copyright 2020 The MediaPipe Authors." and `licenses(["notice"])`. That is the notice used, not the "Copyright Google LLC" the old licence row and the review named.
- Neither repository has a NOTICE file at those commits (HTTP 404).
- Recomputing the five points from the fetched mesh (0-based vertices, rounded to four decimals) reproduces `CANONICAL_LANDMARKS_CM` exactly.

**RED** (`f7794ea`), in `tests/test_ocr_notice.py`:
- the NOTICE names both modules, both upstreams, both commits and both holders;
- each module's header, before its docstring, carries the upstream, the commit, the holder, the Apache-2.0 line, `services/vision/NOTICE` and "Changed by the OpenVerify authors";
- `THIRD_PARTY_LICENSES.md` names both commits and both holders.

The first commit attempt was blocked by the gitleaks pre-commit hook. Its generic-api-key rule matched the constant name `MEDIAPIPE_COMMIT` (*medi-api-pe*) holding a public commit hash. The constant was renamed `CANONICAL_MESH_COMMIT`; `.gitleaksignore` is unchanged.

```
$ uv run --frozen pytest tests/test_ocr_notice.py --no-cov -q
E               AssertionError: ('liveness.py', 'src/openverify_vision/liveness.py')
E       AssertionError: assert 'Silent-Face-Anti-Spoofing' in ''
E       AssertionError: assert 'canonical_face_model.obj' in ''
E           AssertionError: Silent-Face-Anti-Spoofing
4 failed, 7 passed in 0.11s
```

**GREEN** (`4fe1b38`):
- **`services/vision/NOTICE`** gains a "Derived source code (Phase 4)" section. For each file it gives the upstream, the commit, the licence, the holder, the upstream files and what was changed. It also says neither upstream ships a NOTICE.
- **`liveness.py` and `pose.py`** gain the matching comment header before their docstrings.
- **`THIRD_PARTY_LICENSES.md`** gains §2.1.5, "Derived source in Phase 4", with one row each. The §3 mesh row's attribution now reads "Copyright 2020 The MediaPipe Authors".
- **The vision Dockerfile's** comment on `COPY NOTICE` names the new entries.

```
$ uv run --frozen pytest tests/test_ocr_notice.py tests/test_liveness.py tests/test_head_pose.py --no-cov -q
118 passed in 3.27s
```

**Refactor** (`603dbe0`): the notice test's docstring now also names H009 and K204.

## H007 (MEDIUM): an empty crop failed the selfie analysis with an untyped 500

**Confirmed.** In `replay._region`, the side frame is read where the centre's face region lies, scaled to the side's size. The slice starts at `round(gx0 * sx)`. With a 1 x 1 side pose and the centre face flush with the right or bottom edge, that start equals the side's width (or height). The slice is then empty, `ensure_gray` raises `ValueError`, and the route answers 500 `internal server error` rather than the typed `inference_failed`.

**RED 1** (`7bfb386`):
- `tests/test_replay.py::test_a_tiny_side_pose_beside_an_edge_flush_centre_face_is_measured`, over 3 edges x 3 side sizes;
- `tests/test_app_analyze.py::test_a_one_pixel_side_pose_beside_an_edge_flush_centre_face_is_analysed`, through the route.

The two passing cases (`bottom-edge-2x3`, `right-edge-3x1`) are geometries whose start already falls inside the side frame. A direct run of the route confirmed that its 500 is the same `ValueError` from `replay._region`.

```
$ uv run --frozen pytest tests/test_replay.py tests/test_app_analyze.py --no-cov -q -k "tiny_side or one_pixel_side"
E               ValueError: image must not be empty        (7 times)
E       AssertionError: {"type":"about:blank","title":"Internal Server Error","status":500,"detail":"internal server error"}
8 failed, 2 passed, 76 deselected in 2.31s
```

**GREEN 1** (`402ce4d`). The side crop's start is clamped to the side frame's last pixel (`min(round(gx0 * sx), side_width - 1)`, and the same for y). It is a no-op wherever the start was already inside. A tiny side is then measured, at a low raw SSIM, and is not a duplicate. TypeScript decides as before.

**A random-geometry fuzz** (`fuzz_replay.py` in the scratchpad) runs 3,000 cases per seed:
- random centre and side sizes, half of the sides 1 to 3 px;
- random face boxes, 30% flush right and 30% flush bottom.

| Seed | Before (`7bfb386`) | After GREEN 1 |
|---|---|---|
| 7 | 232 errors (`image must not be empty`) | 0 |
| 8 | (not run) | 2 errors |

The two remaining errors were a second empty crop, in the centre's face box inside the working crop. A face over 200 px wide is scaled to 200, so one about a pixel tall shrinks under a pixel. At the bottom edge, its rounded box started on the crop's last row, and its empty crop failed the SSIM.

**RED 2** (`6c995c3`): `test_a_face_under_a_pixel_at_the_working_scale_is_not_an_error[bottom-edge|below-margin]`, the two fuzz geometries. The transposed case passes before the fix: the scale comes from the width, so only the height can drop under a pixel. It was not kept.

```
$ uv run --frozen pytest tests/test_replay.py --no-cov -q -rA -k "under_a_pixel"
E               ValueError: image must not be empty        (2 times)
FAILED tests/test_replay.py::test_a_face_under_a_pixel_at_the_working_scale_is_not_an_error[below-margin]
FAILED tests/test_replay.py::test_a_face_under_a_pixel_at_the_working_scale_is_not_an_error[bottom-edge]
```

**GREEN 2** (`ab60743`). The face box's start in the crop is clamped to the crop's last row and column. The face is then too small to compare and is not measured: `raw_ssim`, `planarity` and `duplicate_of_center` are `null`. Nothing reports a pass.

```
$ uv run --frozen pytest tests/test_replay.py --no-cov -q
45 passed in 14.17s
$ for seed in 7 8 9 10 11 12; do uv run --frozen python …/fuzz_replay.py $seed; done
3000 cases, 0 errors {}          (each of the six seeds: 18,000 cases)
```

**Unchanged results.** The 110 real-model cases of H008, after both H007 fixes, are byte-identical to the before tree.

Real-model side poses of 1 x 1, 2 x 3, 3 x 1 and 16 x 16 next to a generated centre all complete: two consistency entries, no face on the side.

**Not done.** The review also suggested a minimum side-pose size answering 422. That would add a 422 to the locked C41.1 route. The clamps fix the crash without it.

## H010 (MEDIUM): the 25 Mbps cap did not cover `--calibration`, and parallel downloads were not added up

**Confirmed.**
- `_download` (the pinned path: `--calibration` and the default test faces) had no bandwidth accounting at all. Only the starts of its requests were spaced, 1 s apart.
- The harvest's `_download_original` called `RateLimiter.back_off(received * 8 / 25 Mbps)`, which sets `_next = max(_next, now + seconds)`. Two downloads finishing together were held back by one of them only.

**RED** (`064e9ef`). Payloads are plain bytes, 5 MB each (1.6 s at 25 Mbps, longer than the 1 s spacing).
- **`test_fetch_fixtures_calibration.py::test_the_calibration_downloads_keep_under_the_bandwidth_cap`:** `--calibration --jobs 1` over three files; each gap between starts must be at least 1.6 s.
- **`…::test_two_calibration_downloads_at_once_keep_under_the_cap_together`:** `--calibration --jobs 2` over six files, the first two held open together by the fake web's barrier. The k-th request must start at least (k - 2) x 1.6 s after the first. At most two downloads are unpaid when a request starts, so this bound holds for any thread timing.
- **`test_fetch_fixtures_harvest.py::test_two_downloads_at_once_hold_the_next_request_for_both`:** two `_download_original` calls in two threads, open together. After both finish, a probe `limiter.wait()` must be held 3.2 s after the first start.

```
$ uv run --frozen pytest tests/test_fetch_fixtures_calibration.py tests/test_fetch_fixtures_harvest.py --no-cov -q -k "bandwidth_cap or at_once"
E       AssertionError: [1.0, 1.0]
E           AssertionError: (4, [1000.0, 1001.0, 1002.0, 1003.0, 1004.0, 1005.0])
E           assert (1003.0 - 1000.0) >= (((4 - 2) * 1.6) - 1e-09)
E       AssertionError: assert (1002.6 - 1000.0) >= (((((2 * 5) * 1000000) * 8) / 25000000) - 1e-09)
3 failed, 109 deselected in 0.59s
```

**GREEN** (`47207df`):
- **`RateLimiter.spend(size, *, since)`** counts a download's bytes from its start (taken when the response opens) against one budget: `_paid = max(_paid, since) + bits / cap`, and `_next = max(_next, _paid)`. The budget adds up across threads. `back_off` keeps its deadline semantics for 429, 503 and maxlag.
- **`_download_original`** spends instead of backing off.
- **`_download`, `fetch_fixture` and `fetch_all`** take an optional `limiter`, and `main` passes the one behind its `PoliteOpener`. Calls without a limiter behave as before.
- **`MAX_DOWNLOAD_BITS_PER_SECOND`** moves up beside the other policy constants.
- **The module docstring's etiquette** says the cap holds in every mode and adds up over parallel downloads.

```
$ uv run --frozen pytest tests/test_fetch_fixtures.py tests/test_fetch_fixtures_calibration.py tests/test_fetch_fixtures_harvest.py tests/test_fetch_fixtures_polite.py --no-cov -q
221 passed in 3.95s
$ uv run --frozen ruff check ../../scripts/fetch_fixtures.py && uv run --frozen mypy ../../scripts/fetch_fixtures.py --strict
All checks passed!
Success: no issues found in 1 source file
```

The first ruff run flagged six positional arguments (PLR0917), so `limiter` became keyword-only. The existing etiquette tests pass unchanged, including:
- the exact 3.0 s spacing of four small files;
- `clock.sleeps == []` for a verified file.

Holding back the next request start was kept, rather than sleeping inside the read loop: per-read sleeps would have broken that second test.

**Plan amendment** (to be applied by the TypeScript fixer, who owns `docs/plans/phase-4.plan.md`): the C49.1 etiquette line "downloads hold the next request back received_bits / 25 Mbps" now covers every download, as recorded in the fixer's report.

## Final gates

At `47207df` (the vision gate) and on the working tree at `1dd3e36` (e2e):

```
$ uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-python-fixer && COVERAGE_FILE=/tmp/openverify-cov-python-fixer uv run --frozen pytest
All checks passed!
156 files already formatted
Success: no issues found in 59 source files
TOTAL                                           7281      9   1136      7    99%
Required test coverage of 80% reached. Total coverage: 99.81%
1889 passed in 293.86s (0:04:53)
$ coverage report --include=<the changed modules>
src/openverify_vision/analysis.py     151      0     12      0   100%
src/openverify_vision/app.py          187      0     16      0   100%
src/openverify_vision/liveness.py     133      0     26      0   100%
src/openverify_vision/pose.py          65      0     16      0   100%
src/openverify_vision/replay.py       194      0     30      0   100%
$ docker build -q -t openverify/vision:review-4b-check services/vision     # from the repository root; image removed afterwards
sha256:4c8f312e…   (1m05s; /app/NOTICE carries both new holders)
$ flock /tmp/openverify-e2e.lock pnpm e2e                                    # from the repository root
@openverify/e2e:e2e:   50 passed (6.6m)
 Tasks:    9 successful, 9 total
```

**The e2e clips.**
- The measurement lines of `head-turn-a` (stills and clip) and `head-turn-b` are identical to those recorded in `phase4-integration.tdd.md`.
- `static-replay-a` keeps its outcome (the pose retry hint, nothing else failing). Its side poses' values differ from that record.
- A second run of `selfie-static-replay.spec.ts` alone on the same tree (`1 passed (1.4m)`) differed from the first in the same fields (yaw ratios, passive scores, face cosines).

That clip drifts without turning, and its side poses are taken when the shutter appears after 10 s (the spec's header). Its frames therefore depend on capture timing, not on these fixes. The values themselves are not copied here.
