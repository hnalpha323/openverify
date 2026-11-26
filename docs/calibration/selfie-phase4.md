# Face-match calibration (Phase 4, C49)

Written by `packages/checks/scripts/calibration-report.ts --selfie` from `selfie-measurements.json` (measured 2026-10-22T01:50:48Z; models yunet-2026may and sface-2021dec). Intervals are two-sided 95% bootstraps over identities: 1,000 replicates, seed 49. An identity drawn twice is never compared with itself as an impostor, and every FAR upper bound is at least the rule-of-three bound.

**Domain: studio portrait pairs.** Every number below holds for this domain only: it is not a selfie compared with an ID card photo, whose error rates are higher and unmeasured here.

## Set

- 707 identities, 1,574 genuine pairs and 249,571 impostor pairs (707 identities and 1,743 images kept). Impostor pairs take the first kept image of each identity against the first of every other.
- Excluded before scoring: near_duplicate 84, misattribution 1, no_face 4. Near-duplicates (an SFace cosine above 0.93 or an aligned-crop pixel correlation above 0.95 to an earlier kept photo of the same identity) were fixed as a rule before any score was seen.
- The rule-of-three FRR floor 3 / 1,574 = 1.91e-3: no FRR below it can be told apart from zero errors. The FAR floor is 3 / 249,571 = 1.20e-5.

## The review

The lowest genuine pairs and the highest impostor pairs were reviewed once, shown without scores, and decided from Commons metadata only (C49.1): an image is excluded only when its metadata shows another person or a misattribution, never for a low score or a look. The decisions are pinned in the manifest. 1 image excluded by the review; 1,575 genuine pairs before the review, 1,574 after: 1 removed.

Domain: studio portrait pairs.

| Threshold | Value | FRR before the review | FRR after the review | FRR floor |
|---|---|---|---|---|
| threshold for FAR 1e-3 | 0.3862 | 6.35e-4 (0 to 1.98e-3) | 0 (0 to 0) | rule-of-three FRR floor 3 / 1,574 = 1.91e-3 |
| shared 1:1 face-match threshold | 0.394 | 6.35e-4 (0 to 1.98e-3) | 0 (0 to 0) | rule-of-three FRR floor 3 / 1,574 = 1.91e-3 |

## FRR at a target FAR

Domain: studio portrait pairs.

| Target FAR | Threshold (95% interval) | FAR (95% interval) | FRR (95% interval) | FRR floor |
|---|---|---|---|---|
| 1e-3 | 0.3862 (0.3796 to 0.3937) | 9.94e-4 (7.70e-4 to 1.24e-3) | 0 (0 to 0) | rule-of-three FRR floor 3 / 1,574 = 1.91e-3 |
| 1e-4 | 0.4364 (0.4248 to 0.4478) | 9.62e-5 (3.61e-5 to 1.73e-4) | 1.27e-3 (0 to 4.26e-3) | rule-of-three FRR floor 3 / 1,574 = 1.91e-3 |

## FAR and FRR at the configured thresholds

Domain: studio portrait pairs.

| Threshold | Value | Basis | FAR (95% interval) | FRR (95% interval) | FRR floor |
|---|---|---|---|---|---|
| shared 1:1 face-match threshold | 0.394 | calibrated | 7.57e-4 (5.62e-4 to 9.87e-4) | 0 (0 to 0) | rule-of-three FRR floor 3 / 1,574 = 1.91e-3 |
| selfie_repeat_detection threshold | 0.5 | provisional | 4.01e-6 (0 to 2.41e-5) | 9.53e-3 (3.87e-3 to 0.0163) | rule-of-three FRR floor 3 / 1,574 = 1.91e-3 |
| threshold for FAR 1e-3 | 0.3862 | measured here | 9.94e-4 (7.70e-4 to 1.24e-3) | 0 (0 to 0) | rule-of-three FRR floor 3 / 1,574 = 1.91e-3 |
| SFace's published 1:1 threshold (OpenCV Zoo) | 0.363 | upstream | 2.40e-3 (1.99e-3 to 2.87e-3) | 0 (0 to 0) | rule-of-three FRR floor 3 / 1,574 = 1.91e-3 |

## The shared 1:1 threshold (C49.3)

Domain: studio portrait pairs.

- The default is 0.394 (calibrated): C49 report (docs/calibration/selfie-phase4.md): the upper end of the 95% bootstrap interval over 707 identities of the threshold for FAR 1e-3 on studio portrait pairs (point 0.3862, interval 0.3796-0.3937), rounded up; SFace's published 0.363 gave FAR 2.40e-3 there; not measured on selfies against ID card photos.
- It lies above the 95% interval of the threshold for FAR 1e-3 (0.3796 to 0.3937; point 0.3862). At it, FAR 7.57e-4 (5.62e-4 to 9.87e-4) and FRR 0 (0 to 0).
- The default moves only with a documented margin (C49.3); `docs/checks/selfie.md` records the decision beside these numbers.
- The 1:N floor is the 1:1 threshold at FAR 1e-3 (0.3862): `selfie_repeat_detection`'s default 0.5 is at or above it, and stays provisional and gallery-size dependent.

## 1:N search: expected false matches per search

Domain: studio portrait pairs. One search over a gallery of N templates expects N x FAR false matches; the bracket uses the FAR interval's upper bound. False matches grow with the gallery, which is why `selfie_repeat_detection` is advisory by default and its threshold stays gallery-size dependent.

| Threshold | N = 1,000 | N = 10,000 | N = 100,000 |
|---|---|---|---|
| shared 1:1 face-match threshold (0.394) | 0.76 (up to 0.99) | 7.57 (up to 9.87) | 75.73 (up to 98.70) |
| selfie_repeat_detection threshold (0.5) | 0.00 (up to 0.02) | 0.04 (up to 0.24) | 0.40 (up to 2.41) |
| threshold for FAR 1e-3 (0.3862) | 0.99 (up to 1.24) | 9.94 (up to 12.44) | 99.37 (up to 124.38) |

## Skew

Domain: studio portrait pairs.

| Measure | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| Age gap between the photos of a genuine pair (years) | 1349 | 0 | 0 | 3 | 14 | 105 |
| ITA angle of face skin pixels (degrees), a proxy for skin tone stated as one | 695 | -60.2 | -5.4 | 32.7 | 57.09 | 86.3 |

Sex: male 588, female 117, unknown 2. The set is official portraits of adults, so its spread of age, skin tone and capture conditions is narrow; per-group FRR is unmeasured. The age gap counts the genuine pairs whose two photos both have a year in their file metadata; the ITA angle is the median per identity of the cheeks' colour, none for a black-and-white photo.

## Genuine portraits: the heuristic cues

What the heuristic checks read on genuine photos: the passive-liveness mean (`selfie_liveness_detection`), the covering score where the forehead reference is valid (`selfie_face_covering_detection`), the glasses score (`selfie_glasses_detection`) and every synthetic cue (`selfie_suspicious_entity_detection`). Studio portraits are not selfies: these numbers bound false positives on clean, well-lit photos only.

Domain: studio portraits, scaled to a 2,000-px long side: a false-positive proxy, not a selfie measurement.

| Cue | n | min | p1 | p5 | median | p95 | p99 | max |
|---|---|---|---|---|---|---|---|---|
| passive_liveness_mean | 1743 | 0 | 0.0057 | 0.2654 | 0.9926 | 0.9999 | 1 | 1 |
| covering_score | 1651 | 0.0063 | 0.0302 | 0.0653 | 0.1657 | 0.2891 | 0.3839 | 0.7477 |
| glasses_score | 1743 | 0.0367 | 0.0598 | 0.0907 | 0.3577 | 0.659 | 0.8 | 0.968 |
| spectral_tail_deviation | 1262 | 0.0051 | 0.0161 | 0.0784 | 0.7184 | 3.0681 | 3.7177 | 4.7272 |
| residual_peak_ratio | 1379 | 0.0555 | 0.2132 | 0.3714 | 0.8839 | 1.4016 | 1.9778 | 6.4051 |
| noise_inconsistency | 1743 | 0 | 0 | 0 | 0 | 0.2503 | 0.6938 | 1 |
| jpeg_grid_misalignment | 1743 | 0 | 0 | 0 | 0.0097 | 0.1109 | 0.2643 | 0.6367 |
| canonical_landmark_distance | 1743 | 0.018 | 0.2198 | 0.2904 | 0.4046 | 0.5512 | 0.617 | 0.6768 |

`selfie_liveness_detection` fails a centre whose passive-liveness mean is below `min-passive-score` (default 0.5, provisional) with `passive_liveness_low`, a fraud reason that gives no retry. On these genuine portraits (n = 1,743) the p1 is 0.0057 and the p5 0.2654: at least 88 of them (5.05%) score below the default. Studio portraits are still and often retouched, so this is a false-positive proxy: the false-reject rate on genuine webcam selfies is unmeasured.

Domain: the 45 re-encodings of the three public-domain test faces (vision-integrity's 4A stability set: 1,280, 960 and 640 px; q95, q85, q75, resized 0.83 then q85, q75 then q90): a false-positive proxy, not a selfie measurement.

| Cue | n | min | p1 | p5 | median | p95 | p99 | max |
|---|---|---|---|---|---|---|---|---|
| passive_liveness_mean | 45 | 0.9227 | 0.9312 | 0.9443 | 0.9777 | 0.9931 | 0.9935 | 0.9936 |
| covering_score | 45 | 0.1561 | 0.1591 | 0.1683 | 0.2185 | 0.2588 | 0.2593 | 0.2593 |
| glasses_score | 45 | 0.0509 | 0.0511 | 0.0538 | 0.2324 | 0.7107 | 0.7131 | 0.7132 |
| spectral_tail_deviation | 25 | 0.0328 | 0.0504 | 0.143 | 1.1192 | 1.7797 | 2.0955 | 2.1922 |
| residual_peak_ratio | 25 | 0.2926 | 0.3109 | 0.3727 | 0.6053 | 0.984 | 1.5753 | 1.7608 |
| noise_inconsistency | 45 | 0 | 0 | 0 | 0 | 0.0473 | 0.1 | 0.1026 |
| jpeg_grid_misalignment | 45 | 0 | 0 | 0 | 0.0495 | 0.1985 | 0.2126 | 0.2137 |
| canonical_landmark_distance | 45 | 0.3111 | 0.3113 | 0.3115 | 0.4564 | 0.574 | 0.5827 | 0.5895 |

## The synthetic-face scales against genuine photos

A cue flags genuine photos when its clear level leaves the genuine tail with a suspicion above 0. The tail is the 99th percentile (the 1st for a cue that is suspicious when small), or the maximum (minimum) with fewer than 100 values. The scales stay provisional: a genuine-only distribution; detection rate unmeasured.

Domain: studio portraits (2,000 px) and the 45 re-encodings together: genuine-only distribution; detection rate unmeasured.

| Cue | n | Genuine tail | Clear at | Suspicious at | Weight | Flags genuine photos |
|---|---|---|---|---|---|---|
| spectral_tail_deviation | 1287 | 3.7036 (p99) | 3.71 | 4.46 | 0.8 | no |
| residual_peak_ratio | 1404 | 1.9774 (p99) | 2 | 6 | 0.8 | no |
| noise_inconsistency | 1788 | 0.6889 (p99) | 0.69 | 1.19 | 0.7 | no |
| jpeg_grid_misalignment | 1788 | 0.2638 (p99) | 0.27 | 1.02 | 0.5 | no |
| canonical_landmark_distance | 1788 | 0.22 (p1) | 0.05 | 0.01 | 0.8 | no |

## Provisional distributions (synthetic fixtures)

Domain: synthetic pipeline fixtures (re-posed head turns, simulated screen, print and composite spoofs, drawn coverings and glasses).

| Measure | n | min | p5 | median | p95 | max |
|---|---|---|---|---|---|---|
| center_yaw_ratio | 2 | -0.0099 | -0.0086 | 0.0028 | 0.0141 | 0.0154 |
| side_yaw_ratio_change | 4 | 0.1032 | 0.1069 | 0.1344 | 0.1843 | 0.1919 |
| side_face_cosine_to_center | 4 | 0.75 | 0.7502 | 0.7753 | 0.8477 | 0.8562 |
| planarity_median_residual_ratio | 4 | 0.0216 | 0.0219 | 0.0266 | 0.0324 | 0.0329 |
| passive_liveness_mean | 2 | 0.8938 | 0.8987 | 0.9427 | 0.9866 | 0.9915 |
| covering_score | 2 | 0.214 | 0.2144 | 0.2176 | 0.2208 | 0.2212 |
| glasses_score | 2 | 0.1208 | 0.1219 | 0.1317 | 0.1415 | 0.1426 |
| side_yaw_ratio_change_static_replay | 2 | 0 | 0.0017 | 0.0169 | 0.032 | 0.0337 |
| side_face_cosine_to_center_static_replay | 2 | 0.9701 | 0.9716 | 0.9851 | 0.9985 | 1 |
| planarity_median_residual_ratio_static_replay | 2 | 0 | 0 | 0.0001 | 0.0003 | 0.0003 |
| passive_liveness_mean_screen_replay | 1 | 0.5895 | 0.5895 | 0.5895 | 0.5895 | 0.5895 |
| passive_liveness_mean_phone_bezel | 1 | 0.0085 | 0.0085 | 0.0085 | 0.0085 | 0.0085 |
| passive_liveness_mean_phone_full_frame | 1 | 0.9888 | 0.9888 | 0.9888 | 0.9888 | 0.9888 |
| passive_liveness_mean_print_halftone | 1 | 0.5398 | 0.5398 | 0.5398 | 0.5398 | 0.5398 |
| covering_score_mask | 1 | 0.6982 | 0.6982 | 0.6982 | 0.6982 | 0.6982 |
| covering_score_scarf | 1 | 0.3984 | 0.3984 | 0.3984 | 0.3984 | 0.3984 |
| covering_score_hand | 1 | 0.1523 | 0.1523 | 0.1523 | 0.1523 | 0.1523 |
| glasses_score_clear | 1 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 |
| glasses_score_dark | 1 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 |

These are provisional: they describe the pipeline on synthetic fixtures, not real users or real attacks. Simulated spoofs do not measure APCER or BPCER, so no liveness, pose, covering or glasses threshold is calibrated by them.

## Purpose and lawful basis

Purpose: measuring the false-match and false-non-match rates of the face-match threshold OpenVerify ships, so the threshold and its error rates can be stated. The portraits are official portraits that U.S. federal agencies released into the public domain; they are still biometric data of identifiable people. Embeddings and face crops are computed in memory and never written to disk; the measurements carry pseudonymous ids and scores, and this report aggregate numbers only (no name, no per-person row, no image). Whoever runs the calibration states their own lawful basis for this processing (for example a legitimate interest in the accuracy of an identity-verification service); this report is not legal advice.

## Takedown

To remove a person from the set, delete their identity from `fixtures/calibration-manifest.json` (find it by the file URL) and their files from `fixtures/faces/calibration/`, re-run the calibration and this report, and commit both. Nothing else holds their images or embeddings: the images are fetched on demand and never committed. Removal requests: open an issue in the project repository.

## Summary block

Added in Workflow 11E by `docs-catalog` (a borrowed edit; Workflow 11E decisions item 16): this report's own figures, copied from the text above, in the shape of `contracts/fixtures/calibration/summary.schema.json`, so the check catalog (`docs/checks/catalog.md`) reads every report's figures one way. The text above is unchanged and remains the record; `head` is the commit that last changed it, and `owner` names the Workflow that measured it.

<!-- openverify:calibration-summary:start -->
```json
{
  "base": null,
  "head": "1dd3e36f181163177970be40a893ee7f089ef713",
  "machine": null,
  "method-commit": null,
  "report": "docs/calibration/selfie-phase4.md",
  "rows": [
    {
      "budget": null,
      "configuration": "studio portrait pairs: 707 identities, 1,574 genuine and 249,571 impostor pairs",
      "contract": "C49.3",
      "gap": null,
      "id": "face-match-threshold-far-1e-3",
      "median": 0.3862,
      "owner": "workflow-4b",
      "takes": [],
      "title": "Threshold for FAR 1e-3 (95% interval 0.3796 to 0.3937)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "threshold 0.394; studio portrait pairs only, not selfies against ID card photos",
      "contract": "C49.3",
      "gap": null,
      "id": "shared-threshold-far",
      "median": 0.000757,
      "owner": "workflow-4b",
      "takes": [],
      "title": "FAR at the shared 1:1 face-match threshold 0.394 (calibrated default; 95% interval 5.62e-4 to 9.87e-4; FRR 0 under the rule-of-three floor 1.91e-3)",
      "unit": "ratio",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "threshold 0.363 (upstream); studio portrait pairs only",
      "contract": "C49.3",
      "gap": null,
      "id": "sface-published-threshold-far",
      "median": 0.0024,
      "owner": "workflow-4b",
      "takes": [],
      "title": "FAR at SFace's published 1:1 threshold 0.363 (95% interval 1.99e-3 to 2.87e-3)",
      "unit": "ratio",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "threshold 0.5 (provisional); studio portrait pairs only",
      "contract": "C49.3",
      "gap": null,
      "id": "selfie-repeat-threshold-frr",
      "median": 0.00953,
      "owner": "workflow-4b",
      "takes": [],
      "title": "FRR at the provisional selfie_repeat_detection threshold 0.5 (95% interval 3.87e-3 to 0.0163; FAR 4.01e-6)",
      "unit": "ratio",
      "verdict": "reported"
    }
  ],
  "schema": "openverify/calibration-summary@1",
  "status": "published",
  "workflow": "4B"
}
```
<!-- openverify:calibration-summary:end -->
