# Android document guidance: calibration on synthetic renders (C202.2)

**This covers synthetic renders only.** Every frame below is the fictional Utopia card (front and back) or passport data page, drawn by `services/vision/tools/synthetic_id.py` and `synthetic_travel.py` and composed into an analysis frame by `services/vision/tools/android_document_guidance.py`. Nothing here was measured on a real camera frame, lens, sensor or light, and nothing here says how the constants behave on one (review H21). The constants are provisional.

The guidance decides only when the photo is taken and which hint is shown. It never passes or fails anything: the server re-measures every upload with its own checks (`id_blur_detection`, `id_glare_detection`), and a photo the device would have taken can still fail there, and the reverse (C202.5, C202.6, ADR 0009).

## How the frames were made

- Upright analysis frames of 480 x 640 px (640 px wide in the sensor's orientation, C201.2), the document placed in the capture screen's guide (90% of the frame's width, ID-1 for the card, TD3 for the passport page) over one of four tabletops (plain grey, dark wood, white paper, blue cloth), then lens softness (Gaussian 0.5 to 0.8 px), exposure, sensor noise (1.5 grey levels) and 8-bit quantisation. The passport's portrait is a plain block: no face is rendered.
- `good`: within 4% of the guide's size, 1.2% of its position and 1.2 degrees, gain 0.8 to 1.05, so no channel of the document clips. `blur`: Gaussian 1.6 to 3 px or a 7 to 13 px motion streak. `glare`: a colourless highlight over 14 to 26% of the guide's width. `dark`: gain 0.1 to 0.18. `bright`: gain 1.45 to 1.8. `small`: 50 to 80% of the guide. `off`: moved 18 to 30% of the guide, turned 12 to 25 degrees, or 125 to 150% of it. `mrz-hidden`: a passport page whose lower third is covered.
- Each frame is seeded by its index, so a run reproduces every number below.

Frames per group: good 48, blur 36, glare 36, dark 24, bright 24, small 24, off 36, mrz-hidden 18.

## The rule

Fixed before any frame was measured. Each threshold separates the good frames from the one group that breaks its gate: sharpness (both measures) from blur, the glare share from glare, the brightness minimum from dark, its maximum from bright, framing from off and small together, the machine-readable band from mrz-hidden (passport pages only). Where the two groups do not overlap, the threshold is their midpoint: geometric for the sharpness and framing measures, which span decades, arithmetic for the shares and brightness. Where they overlap, the threshold is the good group's extreme, so no good frame is held, and the report says how many broken frames pass. Each value is then rounded to three significant figures.

## Thresholds

| Constant | Value | Separable | Good (min / median / max) | Broken (min / median / max) |
|---|---|---|---|---|
| `sharpness-laplacian-variance-min` | 102.0 | yes | 119.1 / 288.9 / 708.1 | 25.14 / 33.19 / 87.3 |
| `sharpness-tenengrad-min` | 3500.0 | no | 3501 / 6497 / 1.604e+04 | 767.7 / 1438 / 4978 |
| `glare-share-max` | 0.0202 | yes | 0 / 0 / 0 | 0.04044 / 0.06372 / 0.1224 |
| `brightness-mean-min` | 0.357 | yes | 0.5817 / 0.662 / 0.7653 | 0.07258 / 0.1013 / 0.133 |
| `brightness-mean-max` | 0.825 | yes | 0.5817 / 0.662 / 0.7653 | 0.8842 / 0.9083 / 0.9444 |
| `framing-edge-ratio-min` | 19.0 | yes | 49.15 / 211.5 / 827 | 0.2335 / 1.09 / 7.336 |
| `mrz-band-edge-density-min` | 0.172 | yes | 0.3443 / 0.4115 / 0.4728 | 0 / 0 / 0 |

## The hint each group gets (the SDK's order, mirrored)

With the thresholds above, the first hint whose condition holds, in the SDK's fixed order (move closer, hold still, tilt away from the light, more light, fit the card in the frame, then the machine-readable band on a passport); `none` means every gate held and the photo would be taken after `hold-ms`.

| Group | move-closer | hold-still | tilt-away | more-light | fit-card | show-mrz | none |
|---|---|---|---|---|---|---|---|
| good | 0 | 0 | 0 | 0 | 0 | 0 | 48 |
| blur | 0 | 35 | 0 | 0 | 1 | 0 | 0 |
| glare | 0 | 0 | 36 | 0 | 0 | 0 | 0 |
| dark | 0 | 0 | 0 | 24 | 0 | 0 | 0 |
| bright | 0 | 0 | 24 | 0 | 0 | 0 | 0 |
| small | 24 | 0 | 0 | 0 | 0 | 0 | 0 |
| off | 5 | 0 | 0 | 0 | 31 | 0 | 0 |
| mrz-hidden | 0 | 13 | 0 | 0 | 0 | 5 | 0 |

## What this does not cover

- Real camera frames, lenses, autofocus, exposure control, rolling shutter, compression or lighting; real documents, holograms, laminates or worn cards; how people hold a phone.
- How CameraX scales a frame to the analysis resolution on a given device, and how the preview's crop lines up with the analysis frame's guide.
- PDF417 decoding at the analysis width (pdf417-guidance's calibration, C203.3).

Regenerate with `cd services/vision && uv run python tools/android_document_guidance.py --write`; `tests/test_android_document_calibration.py` checks that the committed constants still separate the groups as this report says.

## Summary block

Added in Workflow 11E by `docs-catalog` (a borrowed edit; Workflow 11E decisions item 16): this report's own figures, copied from the text above, in the shape of `contracts/fixtures/calibration/summary.schema.json`, so the check catalog (`docs/checks/catalog.md`) reads every report's figures one way. The text above is unchanged and remains the record; `head` is the commit that last changed it, and `owner` names the Workflow that measured it.

<!-- openverify:calibration-summary:start -->
```json
{
  "base": null,
  "head": "1fecf1746dae36fd5d949fc4b33dd4bdad43f109",
  "machine": null,
  "method-commit": null,
  "report": "docs/calibration/android-document-guidance.md",
  "rows": [
    {
      "budget": null,
      "configuration": "synthetic renders only; never a server check",
      "contract": "C202.2",
      "gap": null,
      "id": "sharpness-laplacian-variance-min",
      "median": 102,
      "owner": "workflow-10b",
      "takes": [],
      "title": "sharpness-laplacian-variance-min: provisional on-device constant, separable (good minimum 119.1, blur maximum 87.3)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic renders only; never a server check",
      "contract": "C202.2",
      "gap": null,
      "id": "sharpness-tenengrad-min",
      "median": 3500,
      "owner": "workflow-10b",
      "takes": [],
      "title": "sharpness-tenengrad-min: provisional on-device constant, not separable: the good group's minimum (3501), so no good frame is held",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic renders only; never a server check",
      "contract": "C202.2",
      "gap": null,
      "id": "glare-share-max",
      "median": 0.0202,
      "owner": "workflow-10b",
      "takes": [],
      "title": "glare-share-max: provisional on-device constant, separable (good 0, glare minimum 0.04044)",
      "unit": "ratio",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic renders only; never a server check",
      "contract": "C202.2",
      "gap": null,
      "id": "brightness-mean-min",
      "median": 0.357,
      "owner": "workflow-10b",
      "takes": [],
      "title": "brightness-mean-min: provisional on-device constant, separable (good minimum 0.5817, dark maximum 0.133)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic renders only; never a server check",
      "contract": "C202.2",
      "gap": null,
      "id": "brightness-mean-max",
      "median": 0.825,
      "owner": "workflow-10b",
      "takes": [],
      "title": "brightness-mean-max: provisional on-device constant, separable (good maximum 0.7653, bright minimum 0.8842)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic renders only; never a server check",
      "contract": "C202.2",
      "gap": null,
      "id": "framing-edge-ratio-min",
      "median": 19,
      "owner": "workflow-10b",
      "takes": [],
      "title": "framing-edge-ratio-min: provisional on-device constant, separable (good minimum 49.15, off and small maximum 7.336)",
      "unit": null,
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "synthetic renders only; never a server check",
      "contract": "C202.2",
      "gap": null,
      "id": "mrz-band-edge-density-min",
      "median": 0.172,
      "owner": "workflow-10b",
      "takes": [],
      "title": "mrz-band-edge-density-min: provisional on-device constant, separable (good minimum 0.3443, mrz-hidden 0)",
      "unit": null,
      "verdict": "reported"
    }
  ],
  "schema": "openverify/calibration-summary@1",
  "status": "published",
  "workflow": "10B"
}
```
<!-- openverify:calibration-summary:end -->
