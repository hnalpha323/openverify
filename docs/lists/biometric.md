# Face and background lists

A `face` list holds face templates and a `selfie-background` list holds selfie backgrounds, each taken from an inquiry the operator chose. They are advisory: an H-tier match with its score and `approximate`, for a reviewer, never a decision. The face threshold is calibrated for lists (`docs/calibration/lists-phase11.md`, item (i); Workflow 11D); the background thresholds stay provisional (Phase 4's, measured on one re-framed backdrop) and are not calibrated in this release: no licensed set of same-backdrop and different-backdrop pairs is pinned, so they are an open line before general availability.

## The acknowledgement

Neither kind can be created until an administrator records why the environment holds biometric lists: the setting `biometric-lists-basis` (1 to 500 characters, `settings:privacy`). Clearing it redacts every face and background list of the environment.

## Adding an item

`POST /api/v1/list-item/faces` or `/list-item/selfie-backgrounds` with `{ "list-id", "inquiry-id" }` (`lists:write` and `pii:view`). The inquiry must have a decided centre selfie and the end user's `consent.biometric-matching`, read through the session's effective consent, so a rejected handoff session's consent never counts. One item per list and inquiry; at most 10,000 items a list; `item-retention-days` is required and at most the environment's face-template retention.

The item is `pending` until the `list-item-embed` job:

- **face:** embeds the selfie through the vision service and stores the item's own sealed template;
- **background:** stores the layout and a person-masked copy of the selfie (`POST /v1/mask/background` on the vision service paints every face out), sealed with its own data key.

A background with less than a quarter of its layout readable, or a selfie vision cannot read, ends the item `archived` with `source_unavailable`. An item is redacted when its source inquiry is redacted or its consent window passes.

## Matching

Only for an inquiry with matching consent; otherwise the list is `unscreened` with `consent_not_given`, and no image is opened. A pending item, an unreadable template or a template of another face model leaves the list `unscreened`, never "no match".

| Constant | Value | Basis |
|---|---|---|
| Face threshold | cosine 0.72 | calibrated (`docs/calibration/lists-phase11.md` (i)): the lowest threshold whose false-positive identification rate per search, at the upper end of its 95% interval, is at most 1% against a 10,000-template list, on 707 public-domain studio-portrait identities. The cost: about a quarter of searches whose person is on the list miss (FNIR 25.3%, 21.9 to 28.8%). The set cannot resolve a false-match rate below about 4 in a million, and nothing here measures handheld selfies against a list photo. The old 0.5 failed the rule (upper end 21.4%). |
| Background candidates | 5 | as Phase 4 |
| Background inliers | at least 100, and a ratio of at least 0.5 | Phase 4 research: a re-framed backdrop 701 inliers, different backdrops 0 to 31 |
| Background coverage | at least 0.25 of the layout | a quarter of the 48 layout cells |

Each worker keeps decrypted templates in a cache of at most 64 MB, dropped after 10 idle minutes and whenever a list changes. A face costs about 809 bytes there, so a full list is about 8 MB.
