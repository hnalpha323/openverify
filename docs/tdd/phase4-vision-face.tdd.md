# TDD evidence: Workflow 4A Stage 2, `vision-face` (C41.1)

- **Slice owner:** `vision-face` (Workflow 4A, Stage 2), in parallel with `vision-integrity`, `checks-logic`, `fixtures`, `flow-capture` and `android-capture`.
- **Date:** 2026-10-21.
- **Owns:** `services/vision/src/openverify_vision/{faces,quality,pose,liveness,occlusion}.py`, their tests, the `# --- vision-face ---` blocks of `analysis.py`, `schemas.py` and `app.py`, and this file.
- **Delivered:** per pose, `face_quality`, `head_pose`, `passive_liveness` and `occlusion` (C41.1). `image` and `faces[].landmarks` were wired by Stage 1 (`analysis._selfie_face`, `ImageSize`); this slice tests them through the route (EXIF-upright, YuNet order with the real model). `faces.py` needed no change.

Each item follows stub (when a RED test needs a name), RED (run, failing for the intended reason), GREEN, with the commits named. Commands ran from `services/vision` after `source ../../scripts/env.sh`, with `COVERAGE_FILE=/tmp/openverify-cov-vision-face` and mypy `--cache-dir /tmp/openverify-mypy-vision-face`. Output is trimmed to the lines that matter. Every test image is drawn by `tests/selfie_faces.py` (a skin-toned oval with eyes, brows, nose and lips at known landmarks, plus masks, a scarf, a hat and glasses composited along them) or built from integer patterns; the real-model tests use only the public-domain faces of `fixtures/manifest.json`, and no landmark, embedding or crop of a real face is written anywhere.

## 1. `face_quality` (C41.1)

Stub 6fbda61 (`FACE_BLUR_WIDTH`), RED 5bd45ca, GREEN dee914a.

RED:
```
$ uv run --frozen pytest tests/test_face_quality.py --no-cov -q
E       assert None is not None        (13 times: the stub answers None)
13 failed, 8 passed in 1.20s           (the 8 are the None cases: no face, outside, degenerate, 1x1)
```
GREEN:
```
$ uv run --frozen pytest tests/test_face_quality.py --no-cov -q
21 passed in 1.37s
```
- `box` is the face box clipped to the image (the region measured); `width_px`, `height_ratio` and `center_offset` follow from it.
- `blur_score` is the Laplacian variance of the grey region scaled **down (never up)** to at most 112 px wide, the measure `id_portrait_clarity_detection` uses, which the provisional default (15) cites as its basis (see the deviations).
- Brightness and glare are taken on the region scaled down to at most 1,024 px wide. Glare leaves out an ellipse 0.3 x 0.2 IOD around each eye, rotated with the eye line.
- The first RED had the scale-invariance tolerance at 35%. An unscaled measure also passes at 35% (480.5 vs 333.9 on the drawn faces), so the GREEN commit tightened it to 15%; the scaled measure reads 480.5 vs 512.3.
- dee914a broke Stage 1's placeholder `test_the_stage_2_measurements_are_null_until_their_owners_fill_them` (it expected `face_quality` to be null). ac861f5 removed `face_quality` and `head_pose` from its null list, and 68fde40 removed `occlusion`. This is the minimal change: the plan changes the behaviour the test checks. The failure was on `main` for one commit.

## 2. `head_pose` (C41.1, research §2)

RED 7c1f218, GREEN ac861f5.

RED (the RED test patches `cv2.solvePnP` directly, so it typechecks against the stub):
```
$ uv run --frozen pytest tests/test_head_pose.py --no-cov -q
E       assert None is not None        (35 times)
35 failed, 4 passed in 2.33s
```
First GREEN run, 7 failures, all from wrong expectations in my RED test:
```
FAILED test_sqpnp_recovers_the_yaw_of_the_exact_canonical_points[-40.0|-25.0|25.0|40.0]
FAILED test_roll_is_the_eye_line_angle_and_the_yaw_ratio_ignores_it[-30.0|-12.0|12.0|30.0]
FAILED test_a_mirrored_public_domain_photo_flips_the_yaw_sign
person-a-selfie yaw_ratio -0.0436 mirrored -0.0078
```
- **SQPnP is exact** on the projected canonical points (yaw -40 to 40 read back to 0.0 degrees; pitch likewise). The roll assertion was wrong: the eyes sit above the turn's axis, so perspective tilts a turned face's eye line (2.27 degrees at 40, 1.25 at 25). Roll is the eye line's angle, as the plan defines it, so the test now bounds it at 2.5 degrees under pure yaw, and the roll test compares a rolled pose with the same pose unrolled (the difference equals the roll to 0.05 degrees).
- **An unmodified frontal photo cannot pin the sign.** YuNet's landmarks are not mirror-symmetric. Measured on the 640-pixel frames (yaw ratio of the photo and of its mirror):

  | Face | 0 deg | +5 deg | +12 deg | +20 deg |
  |---|---|---|---|---|
  | person-a-id | -0.0093 / +0.0657 | +0.0055 / +0.0451 | +0.0399 / +0.0091 | +0.0574 / -0.0474 |
  | person-a-selfie | -0.0436 / -0.0078 | +0.0110 / -0.0447 | +0.0510 / -0.0879 | +0.1450 / -0.1729 |
  | person-b-selfie | +0.0082 / +0.0676 | +0.0245 / +0.0430 | +0.0485 / -0.0174 | +0.0862 / -0.1003 |

  The mean of a photo and its mirror, which is YuNet's own bias on that face, is +0.028, -0.026 and +0.038 at 0 degrees. That is larger than `max-center-yaw-ratio` (0.021), and a mirrored frontal face reads up to +0.068 (see the follow-ups). The direction test therefore turns each public-domain photo 20 degrees to the subject's left with the re-pose helper and checks that the photo reads positive and its mirror negative, on all three faces (yaw ratio and SQPnP yaw both). The frontal-only test was removed.

GREEN:
```
$ uv run --frozen pytest tests/test_head_pose.py tests/test_repose.py tests/test_measure_yaw_anchor.py tests/test_selfie_v2.py tests/test_face_quality.py tests/test_app_analyze.py tests/test_selfie_face_route.py --no-cov -q
137 passed in 14.44s
person-a-id.jpg +20 deg: yaw_ratio=0.0574 yaw_deg=2.2 ...; mirrored: yaw_ratio=-0.0474 yaw_deg=-2.67
person-a-selfie.jpg +20 deg: yaw_ratio=0.145 yaw_deg=7.05 ...; mirrored: yaw_ratio=-0.1729 yaw_deg=-8.18
person-b-selfie.jpg +20 deg: yaw_ratio=0.0862 yaw_deg=4.09 ...; mirrored: yaw_ratio=-0.1003 yaw_deg=-3.84
```
- Conventions: `yaw_deg` has the sign of `yaw_ratio`; `pitch_deg` is positive with the chin up; `roll_deg = atan2(y_left_eye - y_right_eye, x_left_eye - x_right_eye)`, positive when the image-right eye is lower. Intrinsics: f = image width, principal point at the centre. `yaw_deg` and `pitch_deg` are null when SQPnP fails, the solution is behind the camera, or the image size is not positive. The whole pose is null without five finite landmarks or with coinciding eyes.
- As research §2 predicts, the SQPnP angles on YuNet's points are coarse. A 20-degree render reads 2 to 7 degrees, and frontal photos read a pitch of -8 to -15 degrees in this convention. Decisions use `yaw_ratio` relative to the centre.
- `tests/test_selfie_face_route.py` (in the same commit) checks `face_quality` and `head_pose` through the route, and that the size and landmarks are EXIF-upright (a JPEG stored a quarter turn with orientation 8 reads 640 x 480 with the drawn landmarks). The EXIF test passed at once: Stage 1's `decode_image` already transposes.

## 3. `passive_liveness` (C41.1, research §3)

Stub ac0e12e, RED 7782f26, GREEN ef44de9. App wiring: RED a35072c, GREEN 6bca3a5.

### Parity with the upstream reference implementation

I own no file under `tools/`, so the recorded numbers are embedded in `tests/test_liveness.py` with their provenance, and the one-off recorder is reproduced here. It ran in a scratch venv outside the repository: Python 3.12, `torch==2.14.1+cpu`, `numpy==2.5.4`, `opencv-python-headless==5.0.0.93`, pillow. The upstream repository at b6d5f04 was downloaded as `codeload.github.com/minivision-ai/Silent-Face-Anti-Spoofing/tar.gz/b6d5f04ad78778917853b25c778acef6d5626d15` (sha256 `3a5ba6ce4d6f6dbbeb28f5b362d45d5cfbae93eff3889f0d5f1a38297ccd42a2`). Its checkpoints match research §3: `2.7_80x80_MiniFASNetV2.pth` is `a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0` and `4_0_0_80x80_MiniFASNetV1SE.pth` is `84ee1d37d96894d5e82de5a57df044ef80a58be2b218b5ed7cdfd875ec2f5990`. The recorder runs upstream's own `CropImage`, `parse_model_name`, `AntiSpoofPredict._load_model` and `predict` (torch, CPU), as `test.py` does but without the Caffe detector, which OpenCV 5 cannot load; the boxes are given. The inputs are `parity_image`, exact integer patterns that are identical on every platform.

```python
# python -I record_upstream.py <upstream-root>   (scratch only; prints JSON)
import json, os, sys
import numpy as np

def parity_image(width, height, seed):           # identical to tests/test_liveness.py
    y, x = np.mgrid[0:height, 0:width].astype(np.int64)
    blue = (x * x * 3 + y * 7 * (seed + 1)) // 17 % 256
    green = ((x // (4 + seed) + y // (6 + seed)) % 2) * 150 + 50
    red = (x * 255 // max(width - 1, 1) + y * (seed + 2)) % 256
    cx, cy = width // 2, height * 2 // 5
    ax, ay = max(width // 5, 1), max(height // 4, 1)
    inside = (x - cx) ** 2 * ay * ay + (y - cy) ** 2 * ax * ax <= ax * ax * ay * ay
    image = np.stack([blue, green, red], axis=-1)
    image[inside] = (image[inside] // 3 + np.array([60, 110, 170])) % 256
    return np.ascontiguousarray(image.astype(np.uint8))

PARITY_CASES = [(480, 640, 0, (140, 200, 200, 220)), (480, 640, 1, (200, 260, 80, 90)),
                (640, 480, 2, (5, 100, 120, 150)), (640, 480, 3, (560, 380, 100, 120)),
                (320, 240, 4, (-20, -15, 100, 110)), (1280, 960, 5, (500, 300, 280, 330)),
                (40, 30, 6, (10, 8, 20, 15)), (200, 150, 7, (-10, -10, 230, 180))]
BOX_CASES = [...]   # the 12 (src_w, src_h, bbox, scale) rows of UPSTREAM_BOXES in the test

def main(root):
    sys.path.insert(0, root); os.chdir(root)
    import torch
    from src.anti_spoof_predict import AntiSpoofPredict
    from src.generate_patches import CropImage
    from src.utility import parse_model_name
    predictor = AntiSpoofPredict.__new__(AntiSpoofPredict)   # skip the Caffe detector
    predictor.device = torch.device("cpu")
    cropper = CropImage()
    models = {"v2": "resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth",
              "v1se": "resources/anti_spoof_models/4_0_0_80x80_MiniFASNetV1SE.pth"}
    records = []
    for width, height, seed, bbox in PARITY_CASES:
        image = parity_image(width, height, seed)
        entry = {"case": [width, height, seed, list(bbox)]}
        for key, path in models.items():
            h_input, w_input, _, scale = parse_model_name(os.path.basename(path))
            box = CropImage._get_new_box(width, height, list(bbox), scale)
            patch = cropper.crop(image, list(bbox), scale, w_input, h_input, crop=True)
            entry[key] = {"box": list(box), "probs": [float(p) for p in predictor.predict(patch, path)[0]]}
        records.append(entry)
    boxes = [{"case": [w, h, list(b), s], "box": list(CropImage._get_new_box(w, h, list(b), s))}
             for w, h, b, s in BOX_CASES]
    print(json.dumps({"torch": torch.__version__, "records": records, "boxes": boxes}))
```

The recorded softmax vectors vary widely across the inputs. One example is V1SE on the 640 x 480 case 2: (0.208, 0.264, 0.528). Our pipeline (crop, input, pinned ONNX, softmax) reproduces every vector to **7.6e-7** at worst. The test tolerance is 1e-5, and 1e-4 for the engine's rounded P(real).

RED:
```
$ uv run --frozen pytest tests/test_liveness.py --no-cov -q
E       assert (0, 0, 0, 0) == (57, 49, 192, 211)       (crop boxes: the stub's empty crop)
E       AssertionError: MiniFASNetV2.onnx ... comparison failed. Mismatched elements: 3 / 3
E        +  where False = isinstance(None, PassiveLiveness)
57 failed, 9 passed in 2.53s
```
GREEN:
```
$ uv run --frozen pytest tests/test_liveness.py --no-cov -q
66 passed in 2.59s
max |ours - upstream| = 7.635788290549783e-07
```

### The YuNet box transform (measured, provisional)

Upstream crops around its own detector's box (`Widerface-RetinaFace.caffemodel`). I ran upstream's `Detection.get_bbox`, copied verbatim, in a second scratch venv (`opencv-python-headless==4.14.0.94`, because OpenCV 5 removed `readNetFromCaffe`). It ran on 18 framings of the three public-domain faces: 640 x 480 and 480 x 640 frames, with the face at 30, 40 and 50% of the frame height, scaled from the manifest's `face_box`. YuNet (OpenCV 5) ran on the same PNGs. Relative to YuNet's box height h:

| Upstream box vs YuNet's | Median | Range |
|---|---|---|
| top, lower by | 0.117 h | 0.071 to 0.152 |
| bottom | -0.018 h | -0.044 to 0.026 |
| height | 0.875 h | 0.81 to 0.951 |
| width | 0.842 h | 0.78 to 0.921 |
| horizontal centre | +0.009 h | -0.014 to 0.036 |
| aspect (w/h) | 0.978 (YuNet's own: 0.749) | 0.926 to 1.008 |

`upstream_box` keeps YuNet's bottom and horizontal centre and takes a box 0.84 h wide and 0.88 h tall (`BOX_WIDTH_SHARE`, `BOX_HEIGHT_SHARE`; `BOX_TOP_SHIFT` 0.12). This is geometry, not a decision threshold. It agrees with research §3's two frames (box top 121-123 vs 145-147 on 480 px), and it is labelled provisional in the module docstring. No frame, box of a real face or landmark was kept.

### Engine and wiring
- `PassiveLivenessEngine(v2, v1se)` takes the two models (`ocr.runtime.InferenceModel`). `from_models_dir` and `from_settings` build it over `MiniFASNetV2.onnx` and `MiniFASNetV1SE.onnx`. It loads on first use and picks up files fetched later.
- Without the models it measures nothing: `None`, a warning in the log, and null `model_versions`, as the OCR models do. That keeps Stage 1's route tests (models directory `missing`) green.
- A model output other than three finite logits raises `InferenceError`, which the service answers as a 500 `inference_failed`.
- Versions: `minifasnet-v2-2.7` and `minifasnet-v1se-4.0`, as the golden fixture names them; a test reads the fixture.

Route RED a35072c:
```
$ uv run --frozen pytest tests/test_selfie_face_route.py --no-cov -q
E       AssertionError: assert None == 'minifasnet-v2-2.7'
1 failed, 2 passed in 2.50s
```
GREEN 6bca3a5 (`app.state.liveness_engine = PassiveLivenessEngine.from_settings(resolved)` inside the `vision-face` block):
```
$ uv run --frozen pytest tests/test_selfie_face_route.py tests/test_selfie_v2.py tests/test_app_analyze.py tests/test_app.py tests/test_app_concurrency.py tests/test_real_faces.py --no-cov -q
98 passed in 26.19s
```

## 4. `occlusion` (C41.1, research §6)

RED 379e77c, GREEN 68fde40.

RED:
```
$ uv run --frozen pytest tests/test_occlusion.py --no-cov -q
E       assert None is not None        (18 times; the 8 errors are the shared `bare` fixture hitting the same assertion)
10 failed, 8 passed, 8 errors in 1.89s
```
First GREEN run:
```
FAILED tests/test_occlusion.py::test_a_covered_forehead_is_no_reference
CoveringScores(score=0.3405, skin_fraction_ratio=0.9962, texture_ratio=484.7268, delta_e=40.11, forehead_valid=True)
25 passed, 1 failed
```
The RED test's hat colour, BGR (60, 50, 140), is inside the YCrCb skin box (Cr 172, Cb 118), so the hat read as forehead skin. That was the test's mistake, so the hat is now navy (90, 40, 30). The fact is worth knowing all the same: a deep red covering reads as skin to the Chai and Ngan box.

GREEN:
```
$ uv run --frozen pytest tests/test_occlusion.py --no-cov -q
27 passed in 2.23s
```
Readings on the drawn faces (covering score, skin ratio | glasses score, bridge, rim, lens):

| Drawn case | Covering | Glasses |
|---|---|---|
| bare | 0.083, 0.996 | 0.111 (0.018, 0.019, 0) |
| light blue mask | 0.843, 0.0 | 0.097 |
| black mask | 1.0, 0.0 | 0.4 (0.0, **0.536**, 0) |
| white mask | 0.928, 0.0 | 0.4 |
| striped scarf | 0.709, 0.071 | 0.111 |
| hat (navy) | 0 (`forehead_valid` false) | 0.111 |
| frames | 0.083 | 0.80 (0.171, 0.538, 0) |
| sunglasses | 0.083 | 0.80 |
| frames + lens reflection | 0.083 | 0.98 (lens 0.045) |
| darker skin (70, 95, 140), bare | 0.006 | - |

A dark mask's top edge runs through the rim bands and reads as a lower rim. No single glasses cue can exceed 0.4, so the score stays under the provisional 0.5; a test pins that. The covering score is 0 when `forehead_valid` is false (the schema requires a number), and the evaluator answers `input_missing` from `forehead_valid` first.

## 5. Real models through the route

Commit 949f321, written after the GREEN steps as an integration check: YuNet, SFace and MiniFASNet, with each public-domain face as the centre and re-posed ±20 degrees as the side poses. It passed on its first run except for the large upload. The original 5,873 x 7,342 photo is 43 Mpx, and the service refuses it with a 413 against its 40 Mpx cap, as it should; the test now scales it to 5,000 px.
```
$ uv run --frozen pytest tests/test_selfie_face_real.py --no-cov -q -s
person-a-id.jpg center: yaw_ratio=-0.0101 yaw_deg=-1.5 pitch_deg=-8.24 roll_deg=-3.85 | passive v2=0.9899 v1se=0.9947 mean=0.9923 scales=2.456/2.456 | width_px=169.3 height_ratio=0.3623 blur=341.29 brightness=0.4412 glare=0.0 | covering=0.2537 (skin 0.9853) glasses=0.6912 (bridge 0.1632, rim 0.1456)
person-a-selfie.jpg center: yaw_ratio=-0.0415 ... passive mean=0.9601 scales=2.7/4.0 | width_px=77.39 ... covering=0.1853 glasses=0.2433
person-b-selfie.jpg center: yaw_ratio=0.009 ... passive mean=0.9483 scales=2.7/3.871 | width_px=116.66 ... covering=0.2186 glasses=0.1379
(left / right: yaw_ratio 0.0552 / -0.1778, 0.1436 / -0.0931, 0.0881 / -0.1201; passive mean 0.926 to 0.995 on every pose)
quarter-size face: width_px=30.69 ..., occlusion=None
full-size 4000x5000: v2=0.9272 v1se=0.9974 mean=0.9623 effective_scales=(2.7, 4.0)
16 passed in 7.59s
```
- On this set of three people, person-a-id, who wears glasses, reads a glasses score of 0.64 to 0.69 on every pose; the others read 0.05 to 0.37.
- Bare covering reads 0.13 to 0.26. Passive P(real) is 0.85 to 0.99 per model.
- These are pipeline readings on n = 3, not accuracy.

## 6. Hostile inputs

| Input | `face_quality` | `head_pose` | `passive_liveness` | `occlusion` |
|---|---|---|---|---|
| no face | null | null | null (no model run) | null |
| 1 x 1 image | null (under 2 px) | yaw ratio and roll; angles null or finite | bounded (scale 0, 1-px crop) | null |
| tiny face (IOD 6 to 10 px) | measured at its own size | direction kept (IOD 2 px) | measured | null (IOD < 16 px) |
| face cut by the image edge | the visible part | measured | crop shifted inside, scales clipped | forehead invalid, or null if the lower face is off the image |
| box outside the image | null | - | crop inside the image | null |
| NaN or inf box or landmarks | null | null | null | null |
| huge (7000 x 5000, IOD 1,500 px) | 0.09 s (bound 2 s) | - | 0.01 s (bound 1 s) | 0.22 s (bound 2 s) |

Through the route, with the real models: a blank frame, 1 x 1, 2 x 3 and 24 x 32 images, a quarter-size face, a face cut by the edge and a 5,000-px upload all answer 200 with bounded values.

## 7. Time per pose at 1,280 px (C41.5 input for `integration`)

A scratch script ran on the development CPU (Intel Xeon E5-1650 v3 @ 3.50 GHz, OpenCV 5.0.0, onnxruntime 1.31.0). It took the median of 10 runs per stage, on each public-domain face at a 1,280-px long side and on its +20-degree re-pose, with YuNet's face given:

| Pose | face_quality | head_pose | passive_liveness | occlusion | total |
|---|---|---|---|---|---|
| person-a-id centre (960 x 1280, face 348 px) | 1.66 ms | 0.17 ms | 8.90 ms | 6.46 ms | 17.20 ms |
| person-a-id left | 1.56 | 0.09 | 10.05 | 7.90 | 19.61 |
| person-a-selfie centre (1024 x 1280, face 150 px) | 0.62 | 0.14 | 10.38 | 6.08 | 17.21 |
| person-a-selfie left | 1.04 | 0.19 | 8.21 | 5.54 | 14.98 |
| person-b-selfie centre (1024 x 1280, face 245 px) | 1.59 | 0.33 | 9.59 | 6.68 | 18.19 |
| person-b-selfie left | 1.03 | 0.17 | 8.23 | 6.48 | 15.92 |

The median is **17.2 ms per pose** (max 19.6 ms), so about 52 ms for three poses, against the 3 s budget for the whole selfie analysis. Detection and embedding are not included.

## 8. Coverage, refactors and final gates

- 52f6619 covers the last guard branches: a crop needs a positive box and image, a mouth on the nose leaves no lower face, and unplaceable eyes leave the whole region to the glare. The huge-face occlusion bound became 2 s, like face quality's. Afterwards `liveness.py` and `occlusion.py` are at 100%.
- Refactors on a green suite: 31222ce (occlusion), 0302412 (quality).

## 9. Final gates

Run in the foreground at the end of the slice:
```
$ uv run --frozen ruff check                       All checks passed!
$ uv run --frozen ruff format --check              149 files already formatted
$ uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-vision-face
Success: no issues found in 57 source files
$ COVERAGE_FILE=/tmp/openverify-cov-vision-face uv run --frozen pytest
```
- **The whole vision suite, final run:** 1,767 passed in 450.86 s, at 99.78% coverage (80% gate). `faces.py`, `quality.py`, `pose.py`, `liveness.py` and `occlusion.py` are each at 100%.
  ```
  src/openverify_vision/liveness.py                133      0     26      0   100%
  src/openverify_vision/occlusion.py               195      0     22      0   100%
  src/openverify_vision/pose.py                     65      0     16      0   100%
  src/openverify_vision/quality.py                 153      0     22      0   100%
  Required test coverage of 80% reached. Total coverage: 99.78%
  1767 passed in 450.86s (0:07:30)
  ```
- **An intermediate run (1,663 passed, 97.92%):** while the `fixtures` agent was between its RED (f74061d) and GREEN commits, a whole-suite run failed only in its files. The final run above includes its GREEN.
- **E2E**, with Stage 1's exclusion of the five full-stack selfie specs (`e2e/src/exclusions.ts`):
  ```
  $ flock /tmp/openverify-e2e.lock pnpm e2e
  @openverify/flow:e2e:   29 passed (23.2s)
  @openverify/e2e:e2e:   36 passed (5.1m)
   Tasks:    9 successful, 9 total
  ```
