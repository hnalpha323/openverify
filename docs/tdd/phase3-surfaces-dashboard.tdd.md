# TDD evidence: Workflow 3B surfaces-dashboard (C37 in the console, E003)

- **Slice owner:** surfaces-dashboard (Workflow 3B, Stage 1, in parallel with surfaces-clients).
- **Date:** 2026-10-21.
- **Paths owned:**
  - `apps/dashboard/**`
  - `e2e/tests/ui-*.spec.ts` and new helper files under `e2e/tests/support/`
  - this file
- **Input:** `docs/plans/phase-3.plan.md` (C29-C38, the Workflow 3A Stage 1-4 amendments, "Workflow 3B"), ADR 0002, `docs/checks/government-id.md`, and the C38 carry-over E003 from the Workflow 2E review.

Each slice follows the same cycle:
1. A stub commit (`chore`) when the tests need a name that does not exist yet, so the RED commit compiles and type-checks. The full-stack e2e runs `next build`, which type-checks every dashboard test.
2. The tests, run to see them fail for the intended reason (RED, `test` commit).
3. The smallest change that passes them (GREEN, `feat` or `fix` commit).
4. A refactor with the suite green, where one was worth making.

All commands ran after `source scripts/env.sh`. "vitest run … --coverage.enabled=false" stands for `pnpm exec vitest run <files> --coverage.enabled=false` in `apps/dashboard`. Output is trimmed to the lines that matter.

## Slice 1: every check reason in words (C37, ADR 0002 §3e)

`src/lib/check-reasons.ts` maps every reason code the API can return for a check to short English words: `REASON_WORDS`, read through `reasonText(code)`, which answers `undefined` for a code it has no words for (a `Map`, so a code such as `constructor` never reaches `Object.prototype`). `provider_not_configured` reads "Not configured", with "No provider is bound to this check in this environment." The test builds its list from the contracts, not by hand: every value of `GOVERNMENT_ID_CHECK_REASONS` and `PHASE1_CHECK_REASONS` (the Phase 1 government ID and selfie reasons), `SHARED_GOVERNMENT_ID_REASONS` and `NOT_IMPLEMENTED_REASON` (110 codes). It fails for a code without words and for words of a code no list has.

Commits: `8e53fcc` (stub), `cdc18b1` (RED), `a34cb81` (GREEN).

```text
RED   $ vitest run src/lib/check-reasons.test.ts --coverage.enabled=false
     × says aamva_date_invalid in short English words
     × says aamva_document_subfile_missing in short English words
     …
AssertionError: expected undefined to be 'Not on this kind of document' // Object.is equality
AssertionError: expected undefined to deeply equal { words: 'Not configured', …(1) }
 Test Files  1 failed (1)
      Tests  112 failed | 6 passed (118)
GREEN $ vitest run src/lib/check-reasons.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  118 passed (118)
```

## Slice 2: the order of the checks (C30.1, C37)

`src/lib/check-groups.ts` reads the decision engine's rule from the results the API serves:
- `sendsToReview(check)`: a required check that is `pending`, or `not_applicable` for a reason outside `NON_BLOCKING_REASONS` (from `@openverify/contracts`) or for no reason;
- `checkGroupOf(check)`: `failed` (required), `review`, `advisory-failed` (optional), `other`;
- `groupChecks(checks)`: `attention` (failed, then review, then advisory failures, each in the API's order) and `other`;
- `countByStatus(checks)`: the counts in `CHECK_STATUSES` order, without zeros.

Commits: `13f0c4e` (stub), `722af4a` (RED), `59cc962` (GREEN).

```text
RED   $ vitest run src/lib/check-groups.test.ts --coverage.enabled=false
     × puts a required failure in failed
     × puts a required check without a provider in review
     × puts a required check whose input is missing in review
     × puts a required check not applicable for no reason in review
     × puts a required check with a blocking reason beside a non-blocking one in review
     × puts a required pending check in review
     × puts an optional failure in advisory-failed
     × lists failures, then review, then advisory failures, and keeps the rest apart, each in the API order
     × counts each status in the order of the check statuses, without zeros
 Test Files  1 failed (1)
      Tests  9 failed | 7 passed (16)
GREEN $ vitest run src/lib/check-groups.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

## Slice 3: check results on the card and the page (C37)

`src/components/check-results.tsx` (`CheckResults`, a server component) replaces the two check tables of `verification-card.tsx` and `verification-view.tsx`:
- **Layout.** A note in a verification that `needs_review` names the required checks that sent it there, with their reasons in words ("A required check has no result." when the API lists none, since a missing result is not served). The table "<title> checks needing attention" lists required failures, then required checks without evidence, then advisory failures. The rest fold into a native `<details>` whose `<summary>` counts them by status ("Other checks: 26 passed, 4 not applicable", or "All checks: …" when nothing needs attention), with the table "Other <title> checks" (or "<title> checks") inside. "No check failed or is waiting for review." when nothing needs attention.
- **Each result.** The status badge; a "Beta" badge (`data-stage="beta"`, text) for a beta result; "Confidence 0.58" (two decimals) only for a non-null confidence; requirement; reasons in words with their code in monospace beneath ("None" without reasons; a code without words shows as the code in monospace); on the page only, the metadata; and the provenance in a per-check `<details>` ("Show" + a visually hidden " the provenance of <check>"): implementation version, models (id, "SHA-256" and the first 12 hex characters), provider (id, "(sandbox)" when `sandbox` is true), thresholds (`key: value`, lists joined with commas). Absent values say so in words ("Not recorded" for a stored row without provenance, "No model", "No provider", "No threshold"), so they never read as the reasons' "None". Everything is React text, never HTML.
- **Existing tests changed** (the layout moves passed and non-blocking checks into the disclosure): `verification-card.test.tsx` ("lists every check…" opens the disclosure and names the attention table; "leaves out the check details…" asks for any table, hidden included), `verifications/[id]/page.test.tsx` ("lists every check…" likewise), `inquiries/[id]/page.test.tsx` ("shows the check details with verifications:read only" asks for any table, hidden included, since a closed table no longer counts as absent by its old name).

Commits: `95a45de` (stub), `cf3ae83` (RED), `81fe5b1` (GREEN; the GREEN commit also words the absent provenance values in the new tests, see above).

```text
RED   $ vitest run src/components/check-results.test.tsx src/components/verification-card.test.tsx "src/app/verifications/[id]/page.test.tsx" "src/app/inquiries/[id]/page.test.tsx" --coverage.enabled=false
     × lists the required failures, then the checks without evidence, then the advisory failures
     × folds the rest into a closed disclosure that counts them, and opens it on demand
     × names the required checks that sent a verification to review, with their reasons
     × badges every beta result "Beta", in text, and no ga result
     × shows a confidence, labelled, only where the result has one
     × says an unconfigured provider is "Not configured", and that no provider is bound here (ADR 0002 §3e)
     × renders provenance values as text, never as markup
     … (18 of 19 in check-results.test.tsx)
     × lists every check with its status, requirement and reasons
     × shows a government ID in review with the checks that sent it there, Beta badges and confidences (C30.4, C37)
     × lists every check with its status, requirement, reasons and metadata
TestingLibraryElementError: Unable to find an accessible element with the role "note" and name "Why it needs review"
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Government ID checks needing attention"
TestingLibraryElementError: Unable to find an element with the text: /^Other checks/.
$ pnpm --filter @openverify/dashboard typecheck   # the RED tests type-check
✓ Types generated successfully
GREEN $ vitest run (the same four files) --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  86 passed (86)
```

## Slice 4: a tone of its own for Needs review (C30.4, C37)

`BadgeTone` gains `review` (violet), used only by `needs_review`, for inquiries and verifications alike, so "Needs review" never looks like "Requires retry" (amber, `attention`). The label stays "Needs review" (text carries the meaning; colour reinforces it). The Beta badge is outlined (white with the `control` ring), so it shares no tone with a status.

**Existing test changed:** `status-badge.test.tsx` expected `data-tone="attention"` for a `needs_review` verification (Workflow 3A Stage 1 made it "enough to compile and pass"); the task asks for a distinct tone, so it now expects `review`.

Commits: `555122c` (RED), `d08a65e` (GREEN), `0b85a02` (refactor: the Beta badge outlined).

```text
RED   $ vitest run src/components/status-badge.test.tsx --coverage.enabled=false
     × shows an inquiry that needs review in the same tone as a verification that does (C37)
     × labels needs_review "Needs review" in a tone of its own (C30.4, C37)
Expected the element to have attribute:
  data-tone="review"
Received:
  data-tone="attention"
 Test Files  1 failed (1)
      Tests  2 failed | 25 passed (27)
GREEN $ vitest run src/components/status-badge.test.tsx src/components/integrations/badges.test.tsx --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  40 passed (40)
```

## Slice 5: the extraction on the verification page (C31.5, C31.6, C37)

- `EXTRACTION_FIELD_LABELS` and `EXTRACTION_SOURCE_LABELS` (`src/lib/labels.ts`) are records over `ExtractionField` and `ExtractionSource` from `@openverify/core`, so a new field fails the typecheck; the test iterates `GOVERNMENT_ID_EXTRACTION_ATTRIBUTES` (contracts) and `EXTRACTION_SOURCES` (core), not a hand list.
- `ExtractionTable` (`src/components/extraction-table.tsx`, a server component) lists every attribute of `GOVERNMENT_ID_EXTRACTION_ATTRIBUTES` in its API order: Field (row header, in words), Value, Read from (the sources in words, "Machine-readable zone, Visual zone"). A value is the string the API sent, never parsed, so a date cannot shift with the time zone (tested under `TZ=America/Los_Angeles`). Without `pii:view` the API answers `null`, shown as "Hidden" through `MaskedValue`/`HiddenValue` (its accessible explanation names `pii:view`); after the inquiry's redaction, "Redacted"; a field not read, an em dash ("None" for screen readers). With no sources and no value: "Nothing was read from this document."
- `VerificationView` adds the "Extraction" section for a government ID, from `GET /verifications/:id` only: state `redacted` when the inquiry (read with `inquiries:read`) has `redacted-at`, else `visible` with `pii:view`, else `hidden`.
- **The RSC payload.** `src/testing/rsc-payload.ts` (`rscPayloadOf`) walks a server tree as React's Flight protocol serializes it: host elements and text, and every prop of a client component (the exports of each `'use client'` module under `src/components`, plus `next/link` and `@openverify/ui`'s fields; any non-function component type counts as client); server components are called inside a throwaway render (so `useId` works) and their own props stay out. The page test gives an operator without `pii:view` a masked verification and an inquiry document whose included government ID carries a sentinel surname, the holder's first name and birth date: neither the rendered page nor the payload holds any of them. A positive control shows the sentinel in the payload when the verification itself carries it, so the check can fail.

Commits: `8fbfbac` (stub), `82130bc` (RED), `73458a0` (GREEN; the source label test accepts the acronym in "NFC chip").

```text
RED   $ vitest run src/components/extraction-table.test.tsx src/testing/rsc-payload.test.tsx "src/app/verifications/[id]/page.test.tsx" --coverage.enabled=false
     × holds what server components render, not the props they keep
     × holds every prop of a client component, whether or not it renders it
     × says name-first in words … × says vehicle-class in words
     × lists every extraction attribute of the contract, by its label, in a table with headers
     × shows dates as the ISO dates the API sent, with no time-zone shift
     × shows every value as "Hidden", with why, to an operator the API masked them for
     × shows the values as "Redacted" once the inquiry was redacted
     × lets no value the API masked reach the page or the props of a client component from another source
     × puts the extracted values in the payload for an operator the API shows them to (the check above can fail)
TestingLibraryElementError: Unable to find an accessible element with the role "table" and name "Extracted fields"
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Extraction"
AssertionError: expected 'object' to contain 'SENTINELNAME'
 Test Files  3 failed (3)
      Tests  42 failed | 19 passed (61)
$ pnpm --filter @openverify/dashboard typecheck   # after typing the sources fixture
✓ Types generated successfully
GREEN $ vitest run (the same three files) --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  61 passed (61)
$ vitest run src/testing/rsc-payload.test.tsx --coverage.include=src/testing/rsc-payload.ts …
 rsc-payload.ts |   98.38 |     97.5 |     100 |   98.38 | 92
```

## Slice 6: the template editor names the key a refused config is about (C29.5, C37)

The API validates each check's `config` with its registry schema and the allowlists, and answers each problem by JSON Pointer: `/data/attributes/verification-config/government-id/checks/<check>/config/<key>`, `.../allowed-countries/<i>`, `.../allowed-id-classes/<i>` (`fastify-type-provider-zod` builds `instancePath` as `/` + the zod path; a 422 for merged content uses the same `/data/attributes/...` prefix, `services/inquiry-templates.ts`). The server action still parses the body with the contract's request schema first (the C21 pattern), which is the schema the API runs (`updateInquiryTemplateVersionBodySchema`), so the pointers are the same either way; nothing validates in the browser.
- `describeConfigPointer(pointer)` (`src/components/lifecycle/verification-config-pointers.ts`) says where a pointer inside the verification config points: "Government ID, check id_blur_detection, setting min-blur-score", "…, setting required-fields, entry 3", "Government ID, allowed countries, entry 2", "Selfie, checks", and RFC 6901 escapes; `undefined` for anything else.
- `VersionEditor` gives each verification config error that label; `JsonEditor` errors take an optional `label`, shown above the pointer and detail, inside the list the text area is described by (Workflow 2E F013).
- Two action tests document what already held: a bad `min-blur-score` comes back at its key's pointer, and the API's 422 field errors pass through by pointer. They passed on the first run (characterization, not RED).

Commits: `4370aeb` (stub), `bb39a6c` (RED), `3f7feb7` (GREEN).

```text
RED   $ vitest run src/app/templates/actions.test.ts src/components/lifecycle/version-editor.test.tsx src/components/lifecycle/verification-config-pointers.test.ts --coverage.enabled=false
     × says /government-id/checks/id_blur_detection/config/min-blur-score is Government ID, check id_blur_detection, setting min-blur-score
     … (12 more descriptions)
     × has no words for ""
     × names the check and setting the API refused, under the verification config (C37)
Error: expect(element).toHaveTextContent()
 Test Files  2 failed | 1 passed (3)
      Tests  14 failed | 17 passed (31)
GREEN $ vitest run src/components/lifecycle/ src/components/json-editor.test.tsx src/app/templates/ src/app/account-types/ --coverage.enabled=false
 Test Files  29 passed (29)
      Tests  205 passed (205)
```

## Slice 7: E003, every refusal of a new API key in one submit

`createApiKey` validated the custom expiry first and threw, so a form with a bad expiry and a bad name or range was refused one field at a time. It now runs both checks through `settle()` (which keeps an `ActionInputError`'s field errors instead of throwing them) and refuses once, with the key attribute errors (in the contract's order) and then the expiry error. The form already places each error at its field (`errorsUnder`).

Commits: `60ed3a6` (RED), `d744ce8` (GREEN).

```text
RED   $ vitest run src/app/api-keys/actions.test.ts --coverage.enabled=false
       × a custom expiry in the past, with an unnamed key and a range that is not CIDR
       × a custom expiry without a date, with an unnamed key and a range that is not CIDR
       × an expiry that is not offered, with an unnamed key and a range that is not CIDR
AssertionError: expected [ { pointer: '/expires-at', …(1) } ] to deeply equal [ { …(2) }, { …(2) }, { …(2) } ]
 Test Files  1 failed (1)
      Tests  3 failed | 18 passed (21)
GREEN $ vitest run src/app/api-keys/ src/components/integrations/api-key-form.test.tsx --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  51 passed (51)
```

## Slice 8: the dashboard UI e2e (C37), and the inquiry page in review

- `e2e/tests/ui-government-id.spec.ts` (new, full stack) makes its own data: a template from the default one without the selfie step, requiring `id_public_figure_detection` (no provider is bound in e2e, `e2e/src/env.ts`); an inquiry; the synthetic card through the flow API (`submitGovernmentId`). The government ID and the inquiry end in `needs_review`. In the browser:
  - a reviewer's verification page shows "Needs review", the note naming `id_public_figure_detection (Not configured)`, that row with "Beta", "Not configured" and the no-provider sentence; the "Other Government ID checks" table is hidden until the summary is focused and Enter is pressed (keyboard); `id_color_inconsistency_detection` (H-tier) then shows "Passed", a `data-stage="beta"` "Beta" badge and "Confidence 0.xx"; its provenance opens with the keyboard and lists `max-color-inconsistency-score: 0.622`; `id_expired_detection` (ga) has no badge;
  - the reviewer (`pii:view`) reads CALDERWOOD, NORA, 1988-03-21 and UT4829163 in "Extraction", with "Machine-readable zone, Visual zone" for the surname; a viewer (no `pii:view`) sees "Hidden" for each, and neither value anywhere on the page;
  - the inquiry page shows the government ID card as "Needs review" with its note, offers Approve, Decline and Redact, and the reviewer approves the inquiry (the Phase 2 review actions).
- `e2e/tests/ui-console-gaps.spec.ts` (changed): the verification page's checks now fold, so the spec opens the "Other checks"/"All checks" disclosure before it looks for every check row.
- `apps/dashboard/src/app/inquiries/[id]/page.test.tsx` gains a unit test for an inquiry in review: both "Needs review" badges in the review tone, the card's note, and Approve, Decline, Redact.

The spec was written after the unit-level GREEN steps above (the behaviour it drives was already RED-tested there), and it passed on its first full-stack run; the inquiry page unit test likewise passed on its first run (characterization).

Commit: `bb657fc`.

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-government-id.spec.ts tests/ui-console-gaps.spec.ts'
[e2e +36.3s] stack ready; logs in e2e/.artifacts/logs
Running 3 tests using 1 worker
  ✓  1 [chromium] › tests/ui-console-gaps.spec.ts:30:1 › an account type is edited: adding a field works, and removing one shows the API refusal at its path (C25.3) (1.5s)
  ✓  2 [chromium] › tests/ui-console-gaps.spec.ts:78:1 › the inquiry timeline shows its verification and session events, and the verification page its checks (C25.7) (6.4s)
  ✓  3 [chromium] › tests/ui-government-id.spec.ts:44:1 › a government ID sent to review shows why, its Beta results and its extraction, and the inquiry is approved (C37) (7.5s)
  3 passed (55.1s)
```

### The fold breaks `verification-completes.spec.ts` (not in this slice's paths)

`e2e/tests/verification-completes.spec.ts` (Phase 1, owned by no Stage 1 agent) checks four passed government ID rows and three passed selfie rows on the inquiry page with `checkRow` (`e2e/tests/support/dashboard.ts`: `getByRole('table', { name: '<title> checks' })`). Those rows are now inside the closed "Other checks" disclosure, which Playwright counts as hidden, so the spec fails:

```text
$ flock /tmp/openverify-e2e.lock sh -c '… playwright test tests/verification-completes.spec.ts'
  ✘  1 [chromium] › tests/verification-completes.spec.ts:63:1 › an inquiry on the default template completes with every required check passed (41.5s)
    Error: expect(locator).toContainText(expected) failed
    Locator: getByRole('table', { name: 'Government ID checks' }).getByRole('row').filter({ has: getByRole('rowheader', { name: 'id_blur_detection', exact: true }) })
    Expected substring: "Passed"
    Error: element(s) not found
  1 failed
```

The team rules keep that file out of this slice's paths, so the fix is reported as a blocker with its exact patch (open each card's disclosure before reading the rows):

```diff
@@ -173,6 +173,14 @@
       await expect(dashboard.getByRole('heading', { level: 1 })).toContainText(inquiry.id);
       await expect(dashboard.getByRole('main')).toContainText(referenceId);
       await expect(dashboard.getByRole('main')).toContainText('Completed');
+      // C37: each card keeps what needs the operator in view and folds the rest; open them.
+      for (const card of ['Government ID', 'Selfie']) {
+        await dashboard
+          .getByRole('region', { name: card, exact: true })
+          .locator('summary')
+          .filter({ hasText: /^(Other|All) checks: / })
+          .click();
+      }
       for (const name of [
         'id_blur_detection',
         'id_glare_detection',
```

The patch was proven on the full stack without touching the file: a temporary copy with the patch (`e2e/tests/ui-zz-verification-completes-patched.spec.ts`, created inside the e2e lock and removed afterwards, never committed) passes:

```text
$ flock /tmp/openverify-e2e.lock sh -c 'cp …/vc-patched.spec.ts e2e/tests/ui-zz-verification-completes-patched.spec.ts && pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-zz-verification-completes-patched.spec.ts'
  ✓  1 [chromium] › tests/ui-zz-verification-completes-patched.spec.ts:63:1 › an inquiry on the default template completes with every required check passed (10.3s)
  1 passed (42.6s)
```

## Refactors

- `0b85a02`: the Beta badge is outlined (`bg-surface`, `ring-control`), so it never shares the violet review tone.
- `9d0830d`: the folded checks disclosure is a plain `<details>` (a flex `<details>` renders inconsistently); its wrapper spaces the table.

## Final gates

```text
$ pnpm --filter @openverify/dashboard test        # vitest run --coverage, 80% gate
 Test Files  174 passed (174)
      Tests  1654 passed (1654)
Statements   : 98.43% ( 3528/3584 )
Branches     : 94.32% ( 2445/2592 )
Functions    : 98.74% ( 1257/1273 )
Lines        : 98.45% ( 3430/3484 )
$ pnpm --filter @openverify/dashboard lint        # eslint .: no problem
$ pnpm --filter @openverify/dashboard typecheck   # next typegen && tsc --noEmit
✓ Types generated successfully
$ pnpm typecheck
 Tasks:    12 successful, 12 total
$ pnpm lint
 Tasks:    12 successful, 12 total
$ pnpm format:check
All matched files use Prettier code style!
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   29 passed (8.0s)
@openverify/e2e:e2e: Running 44 tests using 1 worker
  ✓  22 [chromium] › tests/ui-government-id.spec.ts:44:1 › a government ID sent to review shows why, its Beta results and its extraction, and the inquiry is approved (C37) (7.2s)
  ✘  43 [chromium] › tests/verification-completes.spec.ts:63:1 › an inquiry on the default template completes with every required check passed (39.3s)
    Locator: getByRole('table', { name: 'Government ID checks' }).getByRole('row').filter({ has: getByRole('rowheader', { name: 'id_blur_detection', exact: true }) })
  1 failed
  43 passed (4.2m)
```

The one failure is the blocker above: `verification-completes.spec.ts` reads passed rows that the C37 layout folds away; its patch is proven on the full stack.
