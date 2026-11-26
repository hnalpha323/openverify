# TDD evidence: Workflow 4B Stage 1 surfaces-dashboard (C47 in the console)

- **Slice owner:** surfaces-dashboard (Workflow 4B, Stage 1, in parallel with `calibration`).
- **Date:** 2026-10-21.
- **Paths owned:**
  - `apps/dashboard/**`
  - `e2e/tests/ui-*.spec.ts` (new: `e2e/tests/ui-selfie.spec.ts`; no helper under `e2e/tests/support/` was needed)
  - this file
- **Input:** `docs/plans/phase-4.plan.md` (C39-C49, every Workflow 4A amendment, "Workflow 4B"), ADR 0002, `docs/checks/selfie.md`, and the Workflow 4A entry of `docs/PROGRESS.md`. The API side was built in Workflow 4A: the dashboard inquiry document's included captures, the C40.10 attributes, the session's recorded consent, the face settings in the settings route.

Each slice follows the same cycle:
1. A stub commit (`chore`) when the tests need a name that does not exist yet, so the RED commit compiles and type-checks (the full-stack e2e runs `next build`, which type-checks every dashboard test).
2. The tests, run to see them fail for the intended reason (RED, `test` commit).
3. The smallest change that passes them (GREEN, `feat` commit).
4. A refactor with the suite green, where one was worth making.

All commands ran after `source scripts/env.sh`. "vitest run … --coverage.enabled=false" stands for `pnpm exec vitest run <files> --coverage.enabled=false` in `apps/dashboard`. Output is trimmed to the lines that matter.

**Nothing in the console carries its own threshold or basis.** Every threshold, basis, status and score the selfie surfaces show is read from the API data (the C40.10 attributes, each result's `provenance.thresholds` and `provenance['threshold-basis']`, the captures, the sessions). The unit fixtures use thresholds and bases that are deliberately not the shipped defaults (an ID threshold of 0.371 marked `calibrated`, a template-set `min-side-identity-cosine` of 0.45), so a hard-coded 0.363 or "Provisional" would fail them. The e2e spec reads the expected values from the API, since the `calibration` agent may change the face-match default and its basis.

## Slice 1: every C39.2 reason in words

`src/lib/check-reasons.test.ts` now also iterates `SELFIE_CHECK_REASONS`, `SHARED_SELFIE_REASONS` and `LEGACY_SELFIE_REASONS` from `@openverify/contracts`; `src/lib/check-reasons.ts` gains words for the 24 selfie reasons it lacked, fraud reasons included (the console is for operators), and an explanation for `not_consented`, `capture_not_live`, `capture_device_suspicious` and `capture_replayed`. An unknown reason still shows as its code in monospace (the existing `check-results.test.tsx` case).

Commits: `060d289` (RED), `41311b8` (GREEN).

```text
RED   $ vitest run src/lib/check-reasons.test.ts --coverage.enabled=false
     × covers every reason of the fifteen selfie checks (C39.2, C47)
     × says what the matching consent and the capture reasons mean (C42.3, C43)
     × says age_inconsistent_with_birthdate in short English words
     … (24 codes)
TypeError: .toMatch() expects to receive a string, but got undefined
      Tests  26 failed | 118 passed (144)
GREEN $ vitest run src/lib/check-reasons.test.ts src/components/check-results.test.tsx --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  163 passed (163)
```

## Slice 2: the capture and liveness vocabulary in words

`src/lib/selfie-words.ts`: the poses (Center, Left, Right, as `FILE_KIND_LABELS` already said), the capture statuses, the four error codes with what happened (superseded: "A newer capture replaced it before it was submitted."), the methods, the liveness modes, the threshold bases, the three liveness components and their four statuses, every flag `selfie_liveness_detection` records (the four integrity flags, the six timing flags, `test-capture-device`) and `order-followed` (true, false, null).

The console does not depend on `@openverify/checks`, and adding the dependency was out of bounds (team rule 3). The test therefore reads the evaluators' own source, `packages/checks/src/selfie/selfie-liveness-detection.ts` (`INTEGRITY_FLAGS`, the `LivenessComponentStatus` type, the `test-capture-device` and `order-followed` metadata keys) and `capture-signals.ts` (`CAPTURE_TIMING_FLAGS`), so a flag added there without words fails it. The other lists come from `@openverify/core` and `@openverify/contracts`.

Commits: `f406b3f` (stub), `8efb16b` (RED), `a423118` (GREEN).

```text
RED   $ vitest run src/lib/selfie-words.test.ts --coverage.enabled=false
     × says the flag file-path-label in words … (11 flags)
TypeError: .toMatch() expects to receive a string, but got undefined
AssertionError: expected 'true' to be 'In the prompted order'
AssertionError: expected [ undefined, undefined, undefined ] to deeply equal [ 'Center', 'Left', 'Right' ]
AssertionError: expected undefined to deeply equal { words: 'Superseded', …(1) }
      Tests  29 failed | 5 passed (34)
GREEN $ vitest run src/lib/selfie-words.test.ts --coverage.enabled=false
      Tests  34 passed (34)
```

## Slice 3: reading the selfie evidence from the API data

`src/lib/selfie-evidence.ts` (pure):
- `appliedThreshold(check, key)`: the value from `provenance.thresholds`, with its origin: the recorded basis (`calibrated`, `provisional`); `template` for a key without one (C39.3, Workflow 4A Stage 2 checks-logic amendment 9), also when the result leaves the whole map out (the evaluator omits an empty map, so a current-version selfie result without one had every key set by the template); `unrecorded` for a result that records no basis at all (an older implementation version, or a government ID check), so nothing is claimed for it. An own key only (`Object.hasOwn`).
- `capturesOf` (newest first), `consumedCapture` (the one with a `submitted-at`), `promptOrder` (the `poses` attribute, else the consumed capture's prompts, else the photos of a pre-Phase 4 selfie, centre first), `posePhotos` (each prompted pose with its latest photo, then unprompted photos in pose order).
- `idComparisonOf`: `document-similarity-score`, the `threshold` key, the government ID compared (`metadata.id_verification_id`, only when it is a `ver_` id) and what was missing (`metadata.reference`).
- `livenessEvidenceOf`: the components in order, the flags, `order-followed`, `test-capture-device`, `judged-poses`, `liveness-score` against `min-passive-score`, the prompted sides' similarities against `min-side-identity-cosine`. Metadata is `unknown` in the contract, so a value of the wrong shape counts as not recorded, never as a pass.
- `referenceFront`: the front file of the government ID compared.

`src/testing/selfie-fixtures.ts` builds synthetic Phase 4 documents (no real face, no real identifier; every number invented), parsed with the contract schemas.

Commits: `d0264c4` (stub), `b97a49d` (RED), `27aaec3` (GREEN). The first GREEN run failed one RED test: it expected the photos of unprompted poses in upload order, while the implementation keeps them in pose order; the test's expectation was the mistake, and the GREEN commit corrects it (stated in the commit body).

```text
RED   $ vitest run src/lib/selfie-evidence.test.ts --coverage.enabled=false
AssertionError: expected null to deeply equal { Object (key, value, ...) }
AssertionError: expected undefined to be 'template' // Object.is equality
AssertionError: expected [] to deeply equal [ 'center', 'right', 'left' ]
AssertionError: expected { result: undefined, …(4) } to match object { similarity: 0.6512, …(3) }
      Tests  15 failed | 4 passed (19)
GREEN $ vitest run src/lib/selfie-evidence.test.ts --coverage.enabled=false
      Tests  19 passed (19)
      selfie-evidence.ts 100 % statements, 93.05 % branches, 100 % functions, 100 % lines
```

## Slice 4: the selfie evidence components

`src/components/selfie-evidence.tsx` (server components):
- `SelfiePhotos`: the pose photos in prompt order, each captioned with its pose ("Center") and "Photo n of m" ("Not prompted" otherwise), alt text "Selfie, center" (the pose, never the person), through the existing authenticated file route. Beside the centre photo, a group "Compared with the government ID": the government ID front (alt "Government ID front, whose portrait was compared"), the similarity (4 decimals), the threshold, its basis in words ("Calibrated", "Provisional", "Set by the template", "Basis not recorded") and the result as a text badge; when nothing was compared, why ("Nothing compared: the inquiry has no government ID to compare with.", or no portrait, or the reasons in words). The ID photo is shown at once on the verification page and behind a closed disclosure on the card (see the contract deviations).
- `SelfieScores`: a table of the other C40.10 scores (each prompted side's similarity to the centre, the centre's passive liveness score), each with its threshold and basis.
- `LivenessSummary`: the passive, active and integrity components as text badges, the prompt order, the side poses judged, and every flag in words with its code; an unknown status or flag shows as its code in monospace.
- `PromptTimings`: the consumed capture's `prompt-timings` (pose, client time in ms, receipt time in UTC).
- `SelfieCaptureDetails`: the capture method and liveness mode.
- `SelfieCaptures`: id, method, status badge, outcome ("Used for the checks", "Submitted; the checks are running", "Not submitted yet", or the error code in words with what happened and the code), created, expiry and submission times.

No device data is shown: the API serves none.

Commits: `e564381` (refactor: `VerificationImage` moves to `verification-image.tsx`, so the card and the new components do not import each other; 84 files, 669 tests green), `3d9b2ab` (stub), `55c5141` (RED), `ab02072` (GREEN).

```text
RED   $ vitest run src/components/selfie-evidence.test.tsx --coverage.enabled=false
TestingLibraryElementError: Unable to find an accessible element with the role "list" and name "Selfie images" (4)
TestingLibraryElementError: Unable to find an accessible element with the role "group" and name "Compared with the government ID" (4)
TestingLibraryElementError: … role "table" and name "Selfie prompt timings" / "Selfie captures" / columnheader "Verification" …
      Tests  24 failed (24)
GREEN $ vitest run src/components/selfie-evidence.test.tsx --coverage.enabled=false
      Tests  24 passed (24)
      selfie-evidence.tsx 100 % statements, 96.9 % branches, 100 % functions, 100 % lines
```

## Slice 5: the card, the inquiry page and the verification page

- **Card** (`verification-card.tsx`): a selfie names its capture method and liveness mode, shows its photos in prompt order with the ID comparison beside the centre one, then (with `verifications:read` and once checks ran) "Scores", "Liveness" and "Prompt timings". Without `verifications:read` only the photos show, still in prompt order.
- **Inquiry page** (`inquiry-view.tsx`): each selfie card gets the inquiry's captures and files; a new section "Selfie captures" lists the inquiry's captures newest first, each with its verification (linked with `verifications:read`); without `verifications:read` it counts them ("This inquiry has 2 selfie captures. Viewing them needs the verifications:read permission."). It is absent for an inquiry without captures.
- **Verification page** (`verifications/[id]/page.tsx`, `verification-view.tsx`): the page now reads `GET /verifications/:id?include=selfies` (the designed include, `verifications:read`, which the page already needs). A selfie shows its capture method and liveness in Details; "Files" shows the photos in prompt order with their file ids and the government ID photo beside the centre one; then "Scores", "Liveness", "Prompt timings" and "Captures". Without `inquiries:read` the file kinds are unknown, so each prompted pose reads "Hidden" (never "No photo"), the comparison still shows its numbers, and the file ids are listed apart.

The first RED run passed the "without verifications:read keeps the photos in prompt order" card test vacuously: the fixture listed its photos in prompt order. The fixture now lists them out of prompt order on purpose, so the test discriminates.

Commits: `ee7af1e` (stub), `0faad96` (RED), `e0a1784` (stub), `2b56ec5` (RED), `378e88e` (GREEN). The first GREEN run failed one RED test: the captures table's scroll region and its section were both named "Selfie captures" (two regions with one name); the table is captioned "Inquiry selfie captures", as the sessions table is "Inquiry sessions" in its "Sessions" section, and the GREEN commit corrects the test (stated in the commit body).

```text
RED   $ vitest run src/components/verification-card.test.tsx "src/app/inquiries/[id]/page.test.tsx" "src/app/verifications/[id]/page.test.tsx" --coverage.enabled=false
AssertionError: expected [ 'Selfie, left', …(2) ] to deeply equal [ 'Selfie, center', …(2) ] (4)
AssertionError: expected null to be 'selfies' // Object.is equality
TestingLibraryElementError: … role "region" and name "Scores" (2), "Selfie captures" (2), heading "Scores", text Capture method …
      Tests  13 failed | 119 passed (132)
RED   $ vitest run src/components/selfie-evidence.test.tsx --coverage.enabled=false
TestingLibraryElementError: Found multiple elements with the text: No photo
      Tests  1 failed | 24 passed (25)
GREEN $ vitest run src/components src/app/verifications src/app/inquiries --coverage.enabled=false
 Test Files  85 passed (85)
      Tests  708 passed (708)
```

## Slice 6: the basis of every selfie threshold in the provenance disclosure

`check-results.tsx`: each threshold of a result's provenance says how it was set where the result records it ("min-passive-score: 0.55 (Provisional)", "min-side-identity-cosine: 0.45 (Set by the template)", "threshold: 0.371 (Calibrated)"); a result without bases (a government ID check, an older selfie row) shows the threshold alone, as before.

Commits: `e75c4c1` (RED), `2d4cdfb` (GREEN).

```text
RED   $ vitest run src/components/check-results.test.tsx --coverage.enabled=false
     × says how each threshold of a selfie result was set: a default's basis, or the template (C39.3)
Expected element to have text content: min-passive-score: 0.55 (Provisional)
      Tests  1 failed | 20 passed (21)
GREEN $ vitest run src/components/check-results.test.tsx src/components/selfie-evidence.test.tsx src/lib/selfie-evidence.test.ts --coverage.enabled=false
      Tests  65 passed (65)
```

## Slice 7: the face matching settings

`settings-fields.ts` (`FACE_FIELDS`, ranges from `FACE_TEMPLATE_RETENTION_DAYS` and `FACE_SEARCH_MAX_TEMPLATES`), `settings-form.tsx` (a fieldset "Face matching in Sandbox" with "Face template retention (days)" and "Templates searched per selfie", `min`/`max` from the contracts, a refusal on its field by its JSON Pointer), `settings-view.tsx` (read-only: "365 days", "50,000 templates", "Not reported" for an older server), `app/settings/actions.ts` (whole numbers within the contract range, else a field error, without calling the API; only changed values are sent). The form shows only to `settings:write`, as before.

**Changed test** (the plan changes the behaviour it checked): `actions.test.ts` "never sends the face template settings, which this form does not edit (C42.6)" becomes "sends the face template settings only when they changed (C42.6, C47)"; its `form()` helper now posts both face fields at their defaults, as the form does.

Commits: `42c1193` (RED), `e2d2795` (GREEN).

```text
RED   $ vitest run src/app/settings src/components/operators/settings-form.test.tsx --coverage.enabled=false
AssertionError: expected { ok: true, data: { changed: false } } to deeply equal { ok: true, data: { changed: true } }
AssertionError: expected { ok: false, problem: { …(2) } } to deeply equal { ok: false, problem: { …(3) } } (2)
Error: Unexpected API request: GET /api/v1/dashboard/settings
TestingLibraryElementError: Unable to find a label with the text of: Face template retention (days)
TestingLibraryElementError: … role "group" / "region" and name "Face matching in Sandbox"
      Tests  14 failed | 22 passed (36)
GREEN $ vitest run src/app/settings src/components/operators --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  74 passed (74)
```

## Slice 8: the consent each session recorded

`inquiry-sessions.tsx`: a "Consent" column with accepted-at, locale, the required text keys and the optional ones ticked (each key in monospace; "None ticked"; "Not given yet" before consent; "Not reported" when an older server sends no `consent`). A column rather than a second table, so each session id stays one row header.

Commits: `a4c51c4` (RED), `af22ee5` (GREEN).

```text
RED   $ vitest run src/components/lifecycle/inquiry-sessions.test.tsx --coverage.enabled=false
TestingLibraryElementError: Unable to find an accessible element with the role "columnheader" and name "Consent"
TestingLibraryElementError: Unable to find an element with the text: Not given yet.
      Tests  2 failed | 6 passed (8)
GREEN $ vitest run src/components/lifecycle/inquiry-sessions.test.tsx "src/app/inquiries/[id]/page.test.tsx" --coverage.enabled=false
      Tests  53 passed (53)
```

## Slice 9: the selfie events in words

`src/lib/event-words.ts` (`SELFIE_EVENT_WORDS`, typed over `SELFIE_EVENT_NAMES`): "Selfie capture started", "submitted", "processed", "errored". The inquiry timeline says them, adds why a capture errored ("Selfie capture errored (Superseded)") and links them to their verification's page with `verifications:read` (a redacted stub has neither, so it shows the words alone); the events list shows the words under the name, and the event page under its title.

Commits: `f6b5e26` (stub), `64d96e7` (RED), `164c72d` (GREEN).

```text
RED   $ vitest run src/lib/event-words.test.ts src/components/lifecycle/inquiry-timeline.test.tsx src/app/events --coverage.enabled=false
AssertionError: expected [ undefined, undefined, …(2) ] to deeply equal [ 'Selfie capture started', …(3) ]
TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "Selfie capture processed"
TestingLibraryElementError: Unable to find an element with the text: Selfie capture errored. (2)
      Tests  9 failed | 21 passed (30)
GREEN $ vitest run src/lib/event-words.test.ts src/components/lifecycle/inquiry-timeline.test.tsx src/app/events src/app/inquiries --coverage.enabled=false
 Test Files  10 passed (10)
      Tests  125 passed (125)
```

## Slice 10: the dashboard UI e2e spec

`e2e/tests/ui-selfie.spec.ts`, full stack:
1. An end user completes an inquiry of the default template (consent, the Utopia card, `takeSelfie` with person A's head-turn clip in its own browser launch). Once the API has decided the selfie, a reviewer opens the inquiry: the three pose photos are in the prompted order and load; the comparison beside the centre photo shows the API's similarity (4 decimals), threshold and basis words; the ID photo opens from its disclosure and loads; the liveness components read as the API's statuses in words, and the flags list the sandbox capture's flags in words; the prompt timings list the three poses; the capture is in "Selfie captures", processed and "Used for the checks", linked to its verification; the session's consent shows the required keys the API recorded, "None ticked" and the locale. On the selfie's own page the ID photo is shown beside the centre one with the same basis, three prompt timings and the capture.
2. An admin changes "Face template retention (days)": a value above the contract maximum is refused on the field and nothing is saved; a valid value is saved, read back from the API and kept after a reload; `finally` restores the original value through the dashboard API, and the test checks it.

The matching consent is left unticked, so the spec stores no face template that `selfie-repeat`'s first 1:N scan could find, whatever the spec order.

This spec was written after the unit slices were green, as the acceptance check of C47, so it has no RED run: driving it RED would have meant running the stack against a dashboard without C47. Every assertion it makes is covered RED-first at unit level above.

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-selfie.spec.ts'
[e2e +54.7s] stack ready; logs in e2e/.artifacts/logs
Running 2 tests using 1 worker
  ✓  1 [chromium] › tests/ui-selfie.spec.ts:71:1 › a reviewer reads a selfie in the console: …
  ✓  2 [chromium] › tests/ui-selfie.spec.ts:237:1 › an admin changes the face template retention on the settings page, … (2.2s)
  2 passed (1.4m)
```

Commit: `ffd922b`. Refactor `3cfabd1`: the comparison group is named by its visible heading (`aria-labelledby`), so a screen reader does not hear its name twice.

## Accessibility (WCAG 2.2 AA)

- Every new control has a label: the two number fields (`Field` labels, descriptions and errors linked by `aria-describedby`), the disclosure's `<summary>` ("Show the government ID photo"), with the console's focus ring (`SUMMARY_CLASS`).
- Every image has alt text naming the pose or the document, never the person.
- Every table has a caption and column headers, with a row header per row (score, pose, capture id, session id).
- Every status (liveness components, captures, the comparison result) is a text badge; colour only reinforces it.
- Groups and regions have distinct names (the captures table is "Inquiry selfie captures" inside the "Selfie captures" section).

## Final validation

```text
$ pnpm --filter @openverify/dashboard typecheck   # next typegen && tsc --noEmit: pass
$ pnpm --filter @openverify/dashboard lint        # eslint .: pass
$ pnpm --filter @openverify/dashboard test
 Test Files  178 passed (178)
      Tests  1805 passed (1805)
All files          |   98.52 |    94.49 |   98.84 |   98.53 |
$ pnpm typecheck && pnpm lint && pnpm format:check
 Tasks:    12 successful, 12 total   (typecheck)
 Tasks:    12 successful, 12 total   (lint)
All matched files use Prettier code style!
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   38 passed (21.2s)
@openverify/e2e:e2e:   50 passed (7.4m)
 Tasks:    9 successful, 9 total
```

Before this workflow the dashboard had 1,658 tests at 98.43 / 94.33 / 98.74 / 98.45 (`docs/PROGRESS.md`); it now has 1,805 at 98.52 / 94.49 / 98.84 / 98.53. `verification-completes.spec.ts` still counts five images on the inquiry page: the selfie card keeps its government ID photo in a closed disclosure.
