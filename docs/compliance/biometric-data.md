# Biometric data

This is not legal advice.

Not reviewed by counsel.

What biometric data OpenVerify processes, where the law treats it as a special category, and what the software does about it. US state biometric laws are on their own page ([US state laws](us-state-laws.md)).

## Special-category data

- **UK GDPR** (re-read on 2026-11-20, [S2](sources.md)): Article 9(1) lists biometric data processed to uniquely identify a person among the special categories whose processing is prohibited unless a condition of Article 9(2) applies; condition 9(2)(a) is the person's explicit consent for specified purposes, unless domestic law says consent cannot lift the prohibition.
- **EU GDPR:** Article 9 has the same structure in the Regulation as published; **not re-read on 2026-11-20: EUR-Lex returned no text** ([S1](sources.md)).
- Whether a given OpenVerify check processes biometric data "to uniquely identify" a person, and which Article 9(2) condition you rely on, is your assessment.

## What OpenVerify processes that may be biometric

| Processing | Where | What is kept | Basis the software asks for |
|---|---|---|---|
| Face match of a selfie against the portrait on an ID (1:1) | `selfie_id_comparison` ([selfie checks](../checks/selfie.md)) | The scores in the check result; the images under the inquiry's retention | The consent step of the template |
| Face templates for later comparison (the account's own inquiries, 1:1; other accounts, 1:N) | `selfie_account_comparison`, `selfie_repeat_detection` | A sealed face template per passed selfie, deleted after `face-template-retention-days` (default 365 days, [retention](retention.md)) whatever the inquiry's own retention | The optional consent key `consent.biometric-matching`: without it the three history checks answer `not_consented`, and a template that requires one of them cannot be published unless that key is required ([selfie checks](../checks/selfie.md#the-default-template)) |
| Background rows (the scene behind the face) | `selfie_similar_background_detection` | A colour layout per selfie, kept with the templates | The same matching consent |
| Face and background lists (an operator's own lists of faces or backdrops) | [face and background lists](../lists/biometric.md) | Sealed templates per list item, with `item-retention-days` required on these lists | The environment's recorded basis, `biometric-lists-basis` (1 to 500 characters, permission `settings:privacy`); clearing it redacts every face and background list. A match also needs the subject's matching consent |
| Chip portraits (the photo stored on a passport or ID card chip) | [NFC checks](../checks/nfc.md#privacy-and-retention) | The chip's data groups, sealed, under the inquiry's retention | The template's consent step |
| A shared portrait or match result (Connect) | [sharing](sharing.md) | At the destination, as its own copy | A separate, unticked biometric tick with its own text and digest (C236.7); face templates are never shared |
| On-device face detection (Android, optional `openverify-face`) | `android/openverify-face/` | Nothing: boxes and landmarks are computed on the device for each analysed frame and discarded ([Android privacy](../android/privacy.md)) | After consent, on the selfie capture screen only |

### Face and background lists, as calibrated

Face and background lists are advisory: a match is an H-tier result with its score for a reviewer, never a decision ([face and background lists](../lists/biometric.md)). Their thresholds after Workflow 11D's calibration ([lists calibration](../calibration/lists-phase11.md)):

- **The face-list threshold is 0.72**, calibrated on 707 public-domain studio-portrait identities against a 10,000-template list. Its cost is a false-negative identification rate of 25.3%: about a quarter of searches whose person is on the list miss. The owner may set it back to 0.5 (owner decision 3 after Workflow 7B; the release notes carry it).
- **The background-list thresholds are not calibrated**: no licensed set of same-backdrop and different-backdrop pairs exists, so they stay Phase 4's provisional values, an open item before general availability.
- **The fuzzy-name candidate cap is 5,000** (calibrated in the same report); a list over the cap answers `unscreened` with `limit_exceeded`, never "no match".

None of these figures has been measured on handheld selfies against a list photo.

## The EU AI Act

- Annex III, point 1(a) of Regulation (EU) 2024/1689 lists remote biometric identification systems as high-risk, and excludes AI systems intended for biometric verification whose sole purpose is to confirm that a person is who they claim to be (re-read on 2026-11-20 on the Commission's AI Act Service Desk, [S11](sources.md); the Official Journal text on EUR-Lex was not re-read, [S1](sources.md)).
- OpenVerify's 1:1 selfie-to-ID comparison is, in our reading, that kind of verification.
- **One-to-many uses are a question for counsel**: `selfie_repeat_detection` scans other accounts' templates, and face lists search a list of faces. Whether either is "identification" in the Act's sense, and what follows, is listed in [questions for counsel](questions-for-counsel.md).

## What stays yours

- Choose and record the Article 9 condition for each biometric purpose, and word your notice and consent texts (the built-in texts are not reviewed by counsel; [README](README.md)).
- Decide whether to enable the history checks and lists at all, and their retention.
- Carry out a DPIA before biometric processing at scale ([DPIA](dpia.md)).
