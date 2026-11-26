# Document blur calibration, Phase 12A

> **Scope: synthetic captures only.** Every measurement below comes from the Quebec-format SPECIMEN card of `services/vision/tools/synthetic_quebec.py` (invented values, C36 as amended by Phase 12A), photographed by the generator's phone captures. Nothing comes from a real card or from the owner's live test. A proposed threshold separates these captures; it is not an error rate on real IDs, so `id_blur_detection` stays `beta`.

Written by vision-12a (Workflow 12A, Stage 2, V3). Stage 3 applies the proposed values to `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_blur_detection` (`packages/core/src/check-config.ts`); vision-12a does not.

## Why the measure changed

The live test failed `id_blur_detection` on a card whose OCR read at 0.88-1.00 confidence. The verdict used vision's whole-image measure (the variance of the Laplacian of the whole upload against `DEFAULT_BLUR_MIN` 100), which penalises the desk around the card and the frame's size. On the synthetic captures (plan §2.1), an in-focus 1080x1920 front scores 75 and a 12-megapixel front 16.7. The document measure of Phase 3 only ran when a document was found, which never happened in a 1080x1920 frame. It also changed with the frame size, because it scaled the card down but never up.

## The measure (`document_quality`, `services/vision/src/openverify_vision/document.py`)

1. **Rectify.** The card is rectified as before: through the detector's quad, as wide as its longer horizontal side. On a phone frame the quad now comes from the `text_layout` fallback (V2).
2. **Resize.** The card is resized to `DOCUMENT_MEASURE_WIDTH` = 1,000 pixels wide (about 300 dpi for ID-1): area averaging down, cubic interpolation up.
3. **Smooth.** It is converted to grey and smoothed by a Gaussian of `DOCUMENT_MEASURE_SIGMA` = 0.8 in floating point, which makes a Laplacian of Gaussian. Without the smoothing, sensor noise and JPEG blocking at the pixel scale outweigh the print's own edges, and they differ between a small frame scaled up and a large one scaled down.
4. **Restrict to text.** Both measures are taken over the side's OCR text boxes when these cover at least `TEXT_MEASURE_MIN_SHARE` = 2% of the card, and over the whole card otherwise.
   - A barcode scores about three times higher than print at the same focus, so without this step no single threshold fits both sides.
   - Measured on the whole card at 1,000 pixels, the fronts need a threshold between 32 and 47 while the backs need one between 59 and 125.
5. **Report.** `blur_score` is the variance of the Laplacian and `tenengrad` the mean squared Sobel magnitude. `width_px` and `height_px` stay the card's full rectified size, so `min-document-width-px` still judges resolution.

The response contract does not change: same fields, same meaning (sharpness of the rectified document). Only the scale at which it is measured, and the region, change.

## Method

`services/vision/tools/calibrate_blur_phase12a.py` measures each capture of `synthetic_quebec.CAPTURES` on both sides (standard back).
- **Analyse as the service does.** Each side goes through `analysis.analyze_government_id_side` with the real text models: the upload's document detection (`full_frame` on `flat`, `text_layout` on the 1080x1920 frames, `contour` on `phone-full`), the OCR of the rectified card, and `measure_document_quality` over the OCR's own boxes. That is the `document_quality` that `id_blur_detection` judges. No face detector runs, because faces do not enter the measure.
- **Why not the printed boxes.** vision-12a first calibrated through the true quad on the printed lines' tight boxes. The OCR's boxes are about 1.5 times larger (padding around each line), so the same card scores about two thirds as much on them. The values proposed then (100.19 and 12,107.29) failed the legible `phone-1080-soft` capture in the analysis (90.80 front, 89.86 back). integration-12a (Workflow 12A Stage 3) found this end to end and moved the calibration onto the analysis (`docs/tdd/phase12a-integration-12a.tdd.md`).
- **Sets.** The legible captures (`flat`, `phone-1080`, `-soft`, `-tilt`, `-q75`, `-glare`, `phone-full`) must pass and the blurred ones (`-blur` σ 2.0, `-motion` 7 px) must fail.
- **Proposed value.** Each proposed value is the geometric mean of the lowest legible score and the highest blurred one, so it clears both by the same ratio, the margin.

Two rows are for information only and belong to neither set:
- `same-scene-2160`: `phone-1080` at 2160x3840 with all its optical blur scaled with the frame (`blur_sigma` 1.48).
- `plan-2160`: the plan's literal pair (`blur_sigma` 1.2).

The generator blurs a capture twice, by 0.5 frame pixels of lens blur while warping the card and then by `blur_sigma`. Only the second follows `blur_sigma`, so `plan-2160` doubles part of the blur and is the sharper scene. The test asserts the 25% bound on `same-scene-2160` and records that `plan-2160` scores higher.

`uv run python tools/calibrate_blur_phase12a.py` rewrites the generated part below and `--check` exits 1 when it is stale. It needs the text models (`python3 scripts/fetch_models.py`). `tests/test_document_blur_phase12a.py` recomputes it within 2%, since ONNX Runtime's CPU kernels may round differently on another machine and move an OCR box by a pixel. The same file checks every legible and blurred capture against the proposed values through the analysis itself.

<!-- calibration:begin (tools/calibrate_blur_phase12a.py) -->
| Capture | Side | Set | Card width (px) | blur_score | tenengrad |
|---|---|---|---|---|---|
| flat | front | legible | 1100 | 683.87 | 35546.9 |
| flat | back | legible | 1100 | 619.36 | 32865.1 |
| phone-1080 | front | legible | 928 | 286.57 | 21983.7 |
| phone-1080 | back | legible | 928 | 267.93 | 21354.2 |
| phone-1080-soft | front | legible | 928 | 90.80 | 10885.2 |
| phone-1080-soft | back | legible | 928 | 89.86 | 10887.1 |
| phone-1080-tilt | front | legible | 929 | 308.43 | 23092.9 |
| phone-1080-tilt | back | legible | 929 | 277.62 | 21457.1 |
| phone-1080-q75 | front | legible | 928 | 279.89 | 21517.4 |
| phone-1080-q75 | back | legible | 928 | 265.87 | 21241.3 |
| phone-1080-glare | front | legible | 928 | 256.27 | 19765.5 |
| phone-1080-glare | back | legible | 928 | 272.83 | 21757.6 |
| phone-full | front | legible | 2600 | 853.96 | 42825.8 |
| phone-full | back | legible | 2600 | 781.66 | 40349.1 |
| phone-1080-blur | front | blurred | 929 | 17.51 | 3977.0 |
| phone-1080-blur | back | blurred | 929 | 19.46 | 4332.8 |
| phone-1080-motion | front | blurred | 928 | 50.10 | 6675.3 |
| phone-1080-motion | back | blurred | 928 | 47.79 | 6768.2 |
| same-scene-2160 | front | information | 1857 | 359.23 | 25560.3 |
| same-scene-2160 | back | information | 1857 | 330.93 | 23977.3 |
| plan-2160 | front | information | 1857 | 483.64 | 30829.4 |
| plan-2160 | back | information | 1857 | 451.02 | 29402.2 |

| Key | Proposed | Lowest legible | Highest blurred | Margin (ratio each side) |
|---|---|---|---|---|
| `min-document-blur-score` | 67.1 | 89.86 (phone-1080-soft back) | 50.10 (phone-1080-motion front) | 1.339 |
| `min-document-tenengrad` | 8583.33 | 10885.2 (phone-1080-soft front) | 6768.2 (phone-1080-motion back) | 1.268 |
<!-- calibration:end -->

## Reading the result

- **The 25% bound.** Within the same scene, the 1,000-pixel measure on the printed lines' boxes holds both sizes within 25% on both measures (the V3 test): `same-scene-2160` is 1.21 times `phone-1080` on `blur_score` and 1.10 times on `tenengrad`, front and back. On the OCR's boxes, as in the table above, the ratios are 1.25 (front) and 1.24 (back) on `blur_score`, at the bound, and 1.16 and 1.12 on `tenengrad`. Before, an in-focus 12-megapixel card scored 4 to 15 times below the same card at 1080 on the whole-image measure.
- **What it detects.** These thresholds separate defocus and motion blur on synthetic print. Real cards print other fonts and inks, so Stage 3 applies them as `beta` values. checks-12a's C9 still lets a side through as legible when its OCR confidence and line count are high, but only within a fifth under each threshold (`LEGIBLE_MIN_SHARPNESS_SHARE` 0.8): the text models read blurred print with high confidence (the C36 `blurred` front reads 18 lines at a median of 0.999), and every blurred capture here scores at most 0.75 of the blur threshold.
- **The Utopia fixtures.** The Phase 3 Utopia calibration measured the whole card at up to 1,280 pixels without smoothing, and its values (`min-document-blur-score` 96.56, `min-document-tenengrad` 5471) are on that old scale. Stage 3 replaces them with the values above and reruns the checks calibration.

## The Phase 3 Utopia variants under the new measure (one-off run, for Stage 3)

vision-12a ran this once with the real text models and recorded the output in `docs/tdd/phase12a-vision-12a.tdd.md`. The tool above does not reproduce it. Each of the C36 variants of `synthetic_variants.c36_variants` was detected by `detect_document`. Its rectified card was measured twice: on the OCR's own text boxes, as in production, and on the whole card, as happens when no text is read. That is the case of the checks calibration run with stub analysers, which have no text models.

| On the OCR text boxes | `blur_score` | `tenengrad` |
|---|---|---|
| Genuine and value variants (happy, expired, under-age, po-box, mrz variants, portrait-swap, copy-move, handwritten-field, no-portrait, front-as-back, both sides) | 470-683 | 27,103-39,728 |
| `on-background` (contour, both sides) | 345 | 26,204-28,186 |
| `td3-passport`, `mrv-a-visa` | 894-984 | 37,330-38,465 |
| `specimen-overprint` front | 239 | 13,897 |
| `photocopy` (both sides) | 477-497 | 31,633-32,772 |
| `glare` front | 553 | 31,922 |
| **`blurred` front** | **44.7** | **7,626** |
| `low-resolution` front (308 px wide; `min-document-width-px` 616 catches it) | 143 | 18,593 |
| `screen-recapture` front (`lines`, 749 px) / back | 97.5 / 185 | 13,238 / 16,444 |

On the text boxes, the proposed 67.1 and 8,583.33 pass every genuine card with a margin of more than 5 times on `blur_score` and fail `blurred` (44.7, under the C9 floor of 53.7). integration-12a reran the variants in process with the real models: `blurred` 44.74 / 7,624.5 with 18 lines at a median confidence of 0.999, `screen-recapture` front 195.1 / 16,756.1, `happy` 677.8 / 38,249.7. Under vision-12a's first values the `screen-recapture` front (97.5 in the run above) failed blur; under these it passes, and `id_electronic_replica_detection` is the check that targets it.

On the whole card (no text read), the genuine Utopia fronts score 58-121 on `blur_score` (`on-background` 58, `glare` 88, `photocopy` 98) and 4,747-7,208 on `tenengrad`, so they pass `blur_score` except `on-background` and fail `tenengrad`. A side without OCR text therefore fails blur under these values. In production that side also has no fields to extract. The checks calibration run with stub analysers sees this whole-card case, so Stage 3 should read its blur rows accordingly.

## Summary block

Added by integration-12a (Workflow 12A Stage 3): the proposed values above, in the shape of `contracts/fixtures/calibration/summary.schema.json`, so the check catalog reads this report as it reads the others. `head` is the commit that last changed the generated table.

<!-- openverify:calibration-summary:start -->
```json
{
  "base": "4ea2493bf0cc447bf42770f5b6aeb2f658b944b4",
  "head": "279b8e44136719f793d87b921fcbf7f029227fa5",
  "machine": null,
  "method-commit": "279b8e44136719f793d87b921fcbf7f029227fa5",
  "report": "docs/calibration/blur-phase12a.md",
  "rows": [
    {
      "budget": null,
      "configuration": "synthetic Quebec-format SPECIMEN captures only (synthetic_quebec.py), measured through the analysis with the real text models",
      "contract": "Phase 12A V3",
      "gap": null,
      "id": "id-blur-detection-min-document-blur-score",
      "median": 67.1,
      "owner": "integration-12a",
      "takes": [],
      "title": "id_blur_detection min-document-blur-score: proposed 67.1 (lowest legible 89.86, phone-1080-soft back; highest blurred 50.10, phone-1080-motion front; margin 1.339)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic Quebec-format SPECIMEN captures only (synthetic_quebec.py), measured through the analysis with the real text models",
      "contract": "Phase 12A V3",
      "gap": null,
      "id": "id-blur-detection-min-document-tenengrad",
      "median": 8583.33,
      "owner": "integration-12a",
      "takes": [],
      "title": "id_blur_detection min-document-tenengrad: proposed 8583.33 (lowest legible 10885.2, phone-1080-soft front; highest blurred 6768.2, phone-1080-motion back; margin 1.268)",
      "unit": null,
      "verdict": "reported"
    }
  ],
  "schema": "openverify/calibration-summary@1",
  "status": "published",
  "workflow": "12A"
}
```
<!-- openverify:calibration-summary:end -->
