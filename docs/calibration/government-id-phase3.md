# Government ID calibration, Phase 3

> **Scope: synthetic fixtures only.** Every measurement below comes from OpenVerify's generated cards of the fictional issuer Utopia and its synthetic AAMVA barcodes (C36), never from a real document. A proposed threshold separates these fixtures; it is not an error rate on real IDs. Every heuristic (H-tier) check therefore stays `beta` (ADR 0002 §3f), and the model-based checks stay `beta` until a FAR/FRR report on labelled data (Phase 4).

Generated on 2026-11-22 by `pnpm --filter @openverify/checks calibration:report` from `government-id-measurements.json` (generator version 5; models: detector yunet-2026may, recognizer sface-2021dec, text_detector pp-ocrv6-small-det, text_recognizer pp-ocrv6-small-rec). The evaluators run in a sandbox with every government ID check enabled and `id_age_comparison` set to `min-age: 18`. Genuine cards are the happy, distinct-holder and re-encoded variants; each other variant is built to trip the checks it names.

## Thresholds

One value per card: its weakest side for a per-side measure. "(vision)" marks a whole-image key a template leaves unset, judged by the vision service's own threshold, which the selfie checks share. "At the default" lists the variants the current default fails and, when it fails no genuine card, its distance to the nearer side. A proposal is the midpoint between the genuine cards and the variants beyond them; its margin is half the gap. "-" means none.

| Check | Key | Fails when | Current default | Genuine (n, min-max) | Should trip | Separated | At the default | Proposed | Margin | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| id_unprocessable_submission_detection | `min-text-lines` | below | 3 | 12, 18-28 | not-an-id 19 | - | catches none | - | - | No variant that should trip lies beyond every genuine card: this measure does not detect them on these fixtures. |
| id_blur_detection | `min-blur-score` | below | 100 (vision) | 12, 140.624-1211.256 | blurred 15.008, low-resolution 1819.306 | blurred | catches blurred, margin 40.624 | 77.82 | 62.81 | Separates 1 of 2 variants that should trip. |
| id_blur_detection | `min-document-blur-score` | below | 67.1 | 12, 178.119-1211.256 | blurred 15.008, low-resolution 1819.307 | blurred | catches blurred, margin 52.092 | 96.56 | 81.56 | Separates 1 of 2 variants that should trip. |
| id_blur_detection | `min-document-tenengrad` | below | - | 12, 8288.718-16754.063 | blurred 2653.801, low-resolution 22550.411 | blurred | - | 5471 | 2817 | Separates 1 of 2 variants that should trip. |
| id_blur_detection | `min-document-width-px` | below | 616 | 12, 924-1500 | blurred 1027, low-resolution 308 | low-resolution | catches low-resolution, margin 308 | 616 | 308 | Separates 1 of 2 variants that should trip. |
| id_glare_detection | `max-glare-ratio` | above | 0.05 (vision) | 12, 0-0.009 | glare 0.095 | glare | catches glare, margin 0.041 | 0.052 | 0.043 | Separates 1 of 1 variants that should trip. |
| id_glare_detection | `max-document-glare-ratio` | above | 0.055 | 12, 0-0.009 | glare 0.101 | glare | catches glare, margin 0.046 | 0.055 | 0.046 | Separates 1 of 1 variants that should trip. |
| id_double_side_detection | `min-front-back-phash-distance` | below | 13 | 10, 26-34 | front-as-back 0 | front-as-back | catches front-as-back, margin 13 | 13 | 13 | Separates 1 of 1 variants that should trip. |
| id_portrait_clarity_detection | `min-face-width-px` | below | 64 | 12, 150.04-208.87 | - | - | no variant to catch | - | - | No variant is built to trip this check by this measure; the genuine range is shown. |
| id_portrait_clarity_detection | `min-sharpness` | below | 15 | 12, 239.876-463.281 | - | - | no variant to catch | - | - | No variant is built to trip this check by this measure; the genuine range is shown. |
| id_portrait_clarity_detection | `min-landmarks-score` | below | 0.5 | 12, 0.928-0.95 | - | - | no variant to catch | - | - | No variant is built to trip this check by this measure; the genuine range is shown. |
| id_color_inconsistency_detection | `max-color-inconsistency-score` | above | 0.622 | 12, 0.194-0.245 | photocopy 1 | photocopy | catches photocopy, margin 0.377 | 0.622 | 0.378 | Separates 1 of 1 variants that should trip. |
| id_electronic_replica_detection | `max-electronic-replica-score` | above | 0.418 | 12, 0-0.002 | screen-recapture 0.835 | screen-recapture | catches screen-recapture, margin 0.416 | 0.418 | 0.416 | Separates 1 of 1 variants that should trip. |
| id_tamper_detection | `max-tamper-score` | above | 0.5 | 12, 0.051-0.441 | portrait-swap 0.394, copy-move 0.41 | - | catches none | - | - | No variant that should trip lies beyond every genuine card: this measure does not detect them on these fixtures. |
| id_fabrication_detection | `max-fabrication-score` | above | 0.5 | 12, 0-0.022 | - | - | no variant to catch | - | - | No variant is built to trip this check by this measure; the genuine range is shown. |
| id_handwriting_detection | `max-handwriting-score` | above | 0.383 | 12, 0.064-0.304 | handwritten-field 0.462 | handwritten-field | catches handwritten-field, margin 0.079 | 0.383 | 0.079 | Separates 1 of 1 variants that should trip. |
| id_entity_detection | `max-entity-score` | above | 0.5 | 12, 0-0 | - | - | no variant to catch | - | - | No variant is built to trip this check by this measure; the genuine range is shown. |

## pHash distances (C34)

- Re-encodings of the happy card (bits): 0, 0, 2, 2; at most 2.
- Distinct cards of the design (bits): 10, 4, 10, 6, 10, 0, 10, 10, 2, 10; at least 0.
- Proposed `max-phash-distance`: -. No distance separates the re-encodings of one card from distinct cards of the design, so the pHash half of id_repeat_detection ships disabled (no max-phash-distance default, C34).

## Variants

| Variant | Group | Should trip | Tripped | Missed | Also failed |
|---|---|---|---|---|---|
| happy | happy | - | - | - | - |
| specimen-stamped | variant | id_compromised_detection | id_compromised_detection | - | id_handwriting_detection, id_entity_detection |
| specimen-overprint | variant | id_compromised_detection | - | id_compromised_detection | id_handwriting_detection |
| expired | variant | id_expired_detection | id_expired_detection | - | - |
| bad-mrz-check-digit | variant | id_mrz_inconsistency_detection | id_mrz_inconsistency_detection | - | id_entity_detection |
| mrz-viz-mismatch | variant | id_mrz_inconsistency_detection, id_extraction_inconsistency_detection | id_mrz_inconsistency_detection, id_extraction_inconsistency_detection | - | id_entity_detection |
| issued-after-expiry | variant | id_valid_dates_detection | id_valid_dates_detection | - | - |
| under-age | variant | id_age_comparison | id_age_comparison | - | - |
| po-box | variant | id_po_box_detection | id_po_box_detection | - | - |
| blurred | variant | id_blur_detection | id_blur_detection | - | - |
| glare | variant | id_glare_detection | id_glare_detection | - | - |
| low-resolution | variant | id_blur_detection | id_blur_detection | - | id_portrait_clarity_detection |
| photocopy | variant | id_color_inconsistency_detection | id_color_inconsistency_detection | - | id_tamper_detection, id_entity_detection |
| screen-recapture | variant | id_electronic_replica_detection | id_electronic_replica_detection | - | id_tamper_detection, id_handwriting_detection, id_entity_detection |
| portrait-swap | variant | id_tamper_detection | - | id_tamper_detection | - |
| copy-move | variant | id_tamper_detection | - | id_tamper_detection | - |
| handwritten-field | variant | id_handwriting_detection | id_handwriting_detection | - | - |
| front-as-back | variant | id_double_side_detection | id_double_side_detection | - | - |
| no-portrait | variant | id_portrait_detection | id_portrait_detection | - | - |
| not-an-id | variant | id_unprocessable_submission_detection | id_unprocessable_submission_detection | - | id_portrait_detection, id_extracted_properties_detection |
| on-background | happy | - | - | - | - |
| td3-passport | happy | - | - | - | - |
| mrv-a-visa | happy | - | - | - | - |
| holder-2 | distinct-holder | - | - | - | - |
| holder-3 | distinct-holder | - | - | - | - |
| holder-4 | distinct-holder | - | - | - | - |
| holder-5 | distinct-holder | - | - | - | - |
| happy-jpeg-q85 | re-encoding | - | - | - | - |
| happy-jpeg-q75 | re-encoding | - | - | - | - |
| happy-jpeg-q60 | re-encoding | - | - | - | - |
| happy-resized-90 | re-encoding | - | - | - | - |

## Measurements

| Variant | document-method | aspect-ratio | front-blur | back-blur | document-blur | tenengrad | width-px | glare-ratio | text-lines | mrz | barcodes | front-back-phash-distance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| happy | full_frame | 1.584877 | 1198.201 | 1819.306 | 1198.201 | 15482.497 | 1027 | 0.002 | 31 | TD1 | 0 | 28 |
| specimen-stamped | full_frame | 1.584877 | 1257.768 | 1822.047 | 1257.768 | 16441.463 | 1027 | 0.002 | 31 | TD1 | 0 | 38 |
| specimen-overprint | full_frame | 1.584877 | 1236.561 | 1822.047 | 1236.561 | 15992.362 | 1027 | 0.002 | 31 | TD1 | 0 | 38 |
| expired | full_frame | 1.584877 | 1198.306 | 1812.136 | 1198.306 | 15465.612 | 1027 | 0.002 | 31 | TD1 | 0 | 30 |
| bad-mrz-check-digit | full_frame | 1.584877 | 1198.201 | 1815.589 | 1198.201 | 15482.497 | 1027 | 0.002 | 31 | TD1 | 0 | 28 |
| mrz-viz-mismatch | full_frame | 1.584877 | 1197.704 | 1819.306 | 1197.704 | 15475.7 | 1027 | 0.002 | 31 | TD1 | 0 | 26 |
| issued-after-expiry | full_frame | 1.584877 | 1194.72 | 1808.6 | 1194.72 | 15427.196 | 1027 | 0.002 | 31 | TD1 | 0 | 28 |
| under-age | full_frame | 1.584877 | 1189.879 | 1804.888 | 1189.879 | 15362.411 | 1027 | 0.002 | 31 | TD1 | 0 | 26 |
| po-box | full_frame | 1.584877 | 1198.201 | 1779.769 | 1198.201 | 15482.497 | 1027 | 0.002 | 31 | TD1 | 0 | 30 |
| blurred | full_frame | 1.584877 | 15.008 | 1819.306 | 15.008 | 2653.801 | 1027 | 0.002 | 31 | TD1 | 0 | 28 |
| glare | full_frame | 1.584877 | 945.019 | 1819.306 | 945.019 | 12469.837 | 1027 | 0.095 | 29 | TD1 | 0 | 34 |
| low-resolution | full_frame | 1.587629 | 2814.931 | 1819.306 | 1819.307 | 22550.411 | 308 | 0.002 | 31 | TD1 | 0 | 26 |
| photocopy | full_frame | 1.584877 | 1428.386 | 1913.776 | 1428.386 | 14754.933 | 1027 | 0 | 31 | TD1 | 0 | 28 |
| screen-recapture | full_frame | 1.585714 | 1527.173 | 1724.528 | 1527.173 | 7936.557 | 1110 | 0 | 31 | TD1 | 0 | 30 |
| portrait-swap | full_frame | 1.584877 | 1165.956 | 1819.306 | 1165.956 | 15327.031 | 1027 | 0.002 | 31 | TD1 | 0 | 26 |
| copy-move | full_frame | 1.584877 | 1247.63 | 1819.306 | 1247.63 | 16143.947 | 1027 | 0.002 | 33 | TD1 | 0 | 28 |
| handwritten-field | full_frame | 1.584877 | 1171.048 | 1819.306 | 1171.048 | 15249.089 | 1027 | 0.002 | 31 | TD1 | 0 | 28 |
| front-as-back | full_frame | 1.584877 | 1198.201 | 1193.742 | 1193.742 | 15482.497 | 1027 | 0.002 | 36 | - | 0 | 0 |
| no-portrait | full_frame | 1.584877 | 1248.561 | 1819.306 | 1248.561 | 15687.197 | 1027 | 0.002 | 31 | TD1 | 0 | 22 |
| not-an-id | none | - | 3144.374 | - | - | - | - | 0 | 19 | - | 0 | - |
| on-background | contour | 1.590014 | 140.624 | 214.115 | 178.119 | 8288.718 | 1058 | 0 | 31 | TD1 | 0 | 26 |
| td3-passport | full_frame | 1.420455 | 1134.066 | - | 703.98 | 14219.562 | 1500 | 0.001 | 28 | TD3 | 0 | - |
| mrv-a-visa | full_frame | 1.5 | 1175.094 | - | 671.239 | 14281.756 | 1440 | 0.001 | 26 | MRVA | 0 | - |
| holder-2 | full_frame | 1.584877 | 1146.36 | 1774.284 | 1146.361 | 14787.278 | 1027 | 0.002 | 31 | TD1 | 0 | 30 |
| holder-3 | full_frame | 1.584877 | 1187.104 | 1821.015 | 1187.104 | 15223.001 | 1027 | 0.002 | 31 | TD1 | 0 | 32 |
| holder-4 | full_frame | 1.584877 | 1124.658 | 1752.894 | 1124.658 | 14422.332 | 1027 | 0.002 | 31 | TD1 | 0 | 28 |
| holder-5 | full_frame | 1.584877 | 1142.75 | 1699.565 | 1142.75 | 14631.375 | 1027 | 0.002 | 31 | TD1 | 0 | 34 |
| happy-jpeg-q85 | full_frame | 1.584877 | 1211.256 | 1867.705 | 1211.256 | 15513.753 | 1027 | 0.004 | 31 | TD1 | 0 | 28 |
| happy-jpeg-q75 | full_frame | 1.584877 | 1145.316 | 1818.71 | 1145.316 | 15518.174 | 1027 | 0.006 | 31 | TD1 | 0 | 28 |
| happy-jpeg-q60 | full_frame | 1.584877 | 1037.545 | 1728.168 | 1037.545 | 15458.898 | 1027 | 0.009 | 31 | TD1 | 0 | 26 |
| happy-resized-90 | full_frame | 1.584906 | 1028.788 | 1646.607 | 1028.788 | 16754.063 | 924 | 0.009 | 31 | TD1 | 0 | 26 |

## AAMVA barcode images

| Vector | Expected valid | Decoded | Valid | First error | Agrees |
|---|---|---|---|---|---|
| dl-636014-real-id | true | true | true | - | true |
| id-636020-not-real-id | true | true | true | - | true |
| dl-636012-canada | true | true | true | - | true |
| dl-636015-version-08-zip-plus-4 | true | true | true | - | true |
| file-type-not-ansi | false | true | false | aamva_header_invalid | true |
| subfile-offset-past-the-end | false | true | false | aamva_subfile_designator_invalid | true |
| mandatory-element-missing | false | true | false | aamva_mandatory_element_missing | true |
| birth-date-not-a-date | false | true | false | aamva_date_invalid | true |
| compliance-indicator-not-at | false | true | false | aamva_header_invalid | true |
| iin-not-listed | false | true | false | aamva_iin_unknown | true |
| aamva-version-11 | false | true | false | aamva_version_unsupported | true |
| subfile-offset-misplaced | false | true | false | aamva_subfile_designator_invalid | true |

## Summary block

Added in Workflow 11E by `docs-catalog` (a borrowed edit; Workflow 11E decisions item 16): this report's own figures, copied from the text above, in the shape of `contracts/fixtures/calibration/summary.schema.json`, so the check catalog (`docs/checks/catalog.md`) reads every report's figures one way. The text above is unchanged and remains the record; `head` is the commit that last changed it, and `owner` names the Workflow that measured it.

<!-- openverify:calibration-summary:start -->
```json
{
  "base": null,
  "head": "9a42384dc28366df7f2e27ba8f46bfb70966f000",
  "machine": null,
  "method-commit": null,
  "report": "docs/calibration/government-id-phase3.md",
  "rows": [
    {
      "budget": null,
      "configuration": "synthetic Utopia cards only, generator version 5 (C36)",
      "contract": "C36",
      "gap": null,
      "id": "id-blur-detection-min-document-blur-score",
      "median": 96.56,
      "owner": "workflow-3a",
      "takes": [],
      "title": "id_blur_detection min-document-blur-score: proposed and default 96.56 (genuine 178.119-1211.256; the blurred variant 15.008)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic Utopia cards only, generator version 5 (C36)",
      "contract": "C36",
      "gap": null,
      "id": "id-blur-detection-min-document-width-px",
      "median": 616,
      "owner": "workflow-3a",
      "takes": [],
      "title": "id_blur_detection min-document-width-px: proposed and default 616 (genuine 924-1500; the low-resolution variant 308)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic Utopia cards only, generator version 5 (C36)",
      "contract": "C36",
      "gap": null,
      "id": "id-glare-detection-max-document-glare-ratio",
      "median": 0.055,
      "owner": "workflow-3a",
      "takes": [],
      "title": "id_glare_detection max-document-glare-ratio: proposed and default 0.055 (genuine 0-0.009; the glare variant 0.101)",
      "unit": "ratio",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic Utopia cards only, generator version 5 (C36)",
      "contract": "C36",
      "gap": null,
      "id": "id-double-side-detection-min-front-back-phash-distance",
      "median": 13,
      "owner": "workflow-3a",
      "takes": [],
      "title": "id_double_side_detection min-front-back-phash-distance: proposed and default 13 (genuine 26-34; front-as-back 0)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic Utopia cards only, generator version 5 (C36)",
      "contract": "C36",
      "gap": null,
      "id": "id-color-inconsistency-detection-max-color-inconsistency-score",
      "median": 0.622,
      "owner": "workflow-3a",
      "takes": [],
      "title": "id_color_inconsistency_detection max-color-inconsistency-score: proposed and default 0.622 (genuine 0.194-0.245; photocopy 1)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic Utopia cards only, generator version 5 (C36)",
      "contract": "C36",
      "gap": null,
      "id": "id-electronic-replica-detection-max-electronic-replica-score",
      "median": 0.418,
      "owner": "workflow-3a",
      "takes": [],
      "title": "id_electronic_replica_detection max-electronic-replica-score: proposed and default 0.418 (genuine 0-0.002; screen-recapture 0.835)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic Utopia cards only, generator version 5 (C36)",
      "contract": "C36",
      "gap": null,
      "id": "id-handwriting-detection-max-handwriting-score",
      "median": 0.383,
      "owner": "workflow-3a",
      "takes": [],
      "title": "id_handwriting_detection max-handwriting-score: proposed and default 0.383 (genuine 0.064-0.304; handwritten-field 0.462)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic Utopia cards only, generator version 5 (C36)",
      "contract": "C36",
      "gap": null,
      "id": "id-tamper-detection-max-tamper-score",
      "median": null,
      "owner": "workflow-3a",
      "takes": [],
      "title": "id_tamper_detection max-tamper-score: no variant lies beyond every genuine card (portrait-swap 0.394, copy-move 0.41, genuine up to 0.441); the initial 0.5 stays",
      "unit": null,
      "verdict": "not-calibrated"
    },
    {
      "budget": null,
      "configuration": "synthetic Utopia cards only, generator version 5 (C36)",
      "contract": "C36",
      "gap": null,
      "id": "id-unprocessable-submission-detection-min-text-lines",
      "median": null,
      "owner": "workflow-3a",
      "takes": [],
      "title": "id_unprocessable_submission_detection min-text-lines: catches none (not-an-id reads 19 lines, genuine 18-28); the default 3 stays",
      "unit": null,
      "verdict": "not-calibrated"
    },
    {
      "budget": null,
      "configuration": "synthetic Utopia cards only, generator version 5 (C36)",
      "contract": "C34",
      "gap": null,
      "id": "id-repeat-detection-max-phash-distance",
      "median": null,
      "owner": "workflow-3a",
      "takes": [],
      "title": "id_repeat_detection max-phash-distance: no distance separates re-encodings (at most 2 bits) from distinct cards of the design (at least 0); the pHash half ships disabled",
      "unit": null,
      "verdict": "not-calibrated"
    }
  ],
  "schema": "openverify/calibration-summary@1",
  "status": "published",
  "workflow": "3A"
}
```
<!-- openverify:calibration-summary:end -->
