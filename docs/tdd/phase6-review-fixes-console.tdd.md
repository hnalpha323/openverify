# TDD record: Phase 6, Workflow 6B review fixes, console (`fix-console`)

The console fixes of the Workflow 6B review: the blocking finding R012, then the MEDIUM items in
the order given. Paths: `apps/dashboard/`, `e2e/tests/ui-*.spec.ts`, `e2e/tests/support/ui*.ts`,
`docs/calibration/` and this file. Every value in a fixture is synthetic. Commands were run from
the repository root after `source scripts/env.sh`; outputs are abbreviated.

## R012 (HIGH): the create-report query is built from allow-listed field names

`queryOf` (`apps/dashboard/src/app/reports/actions.ts`) built the query by walking each
`query/<a>/<b>/…` field name as a property path. A field named `query/__proto__/x` (or
`query/constructor/prototype/x`, or the same under `additional-names`) reached
`Object.prototype` or `Array.prototype` through `??=` and set a property on it for the whole
dashboard process. A numeric segment also became an array index without a bound.

The fix accepts only the two shapes the create form renders: `query/<member>`, where the member
is one of any type's `REPORT_QUERY_FIELDS` other than `additional-names` (the posted type's own
schema still refuses a member of another type), and `query/additional-names/<index>/<part>`,
where the index is below `REPORT_QUERY_LIMITS.additionalNames` and the part is a name part. Any
other `query/…` name is refused at `/data/attributes/query` before the API is called. Values are
gathered in `Map`s and the query is built with `Object.fromEntries`, so no field name is ever
used as a property path.

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/actions.test.ts
 × refuses query/__proto__/polluted without touching a prototype or calling the API
 × refuses query/constructor/prototype/polluted without touching a prototype or calling the API
 × refuses query/additional-names/__proto__/polluted without touching a prototype or calling the API
 × refuses query/additional-names/constructor/prototype/polluted without touching a prototype or calling the API
 × refuses query/additional-names/0/__proto__/polluted without touching a prototype or calling the API
 × refuses query/additional-names/0/constructor/prototype/polluted without touching a prototype or calling the API
 × refuses query/additional-names/3/name-first, a shape the create form never sends
 × refuses query/additional-names/01/name-first, a shape the create form never sends
 × refuses query/additional-names/42/name-first, a shape the create form never sends
 × refuses query/additional-names/0/birthdate, a shape the create form never sends
 × refuses query/additional-names/0/name-first/0, a shape the create form never sends
 × refuses query/additional-names, a shape the create form never sends
 × refuses query/name-first/0, a shape the create form never sends
 × refuses query/polluted, a shape the create form never sends
 × refuses query/, a shape the create form never sends
AssertionError: expected [ 'yes', 'yes' ] to deeply equal [ undefined, undefined ]
AssertionError: expected [ undefined, 'yes' ] to deeply equal [ undefined, undefined ]
AssertionError: expected { ok: true, …(1) } to match object { ok: false, problem: { …(2) } }
AssertionError: promise rejected "TypeError: Cannot assign to read only pro…" instead of resolving
Caused by: TypeError: Cannot assign to read only property '0' of string 'Ava'
-         "detail": "has a field the query does not take",
+         "detail": "Unrecognized key: \"polluted\"",
 Tests  15 failed | 27 passed (42)
```

The first six fail for the intended reason: the prototype carries `polluted: 'yes'` afterwards
(the `afterEach` deletes it, so the other tests run clean). Indexes 3, `01` and 42 were accepted
and the API was called; a nested segment under a string crashed the action with a `TypeError`.
`pnpm --filter @openverify/dashboard typecheck` and `eslint src/app/reports/actions.test.ts`
passed on the RED test.

**GREEN**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/ src/components/reports/
 Test Files  13 passed (13)
      Tests  146 passed (146)
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully
$ pnpm --filter @openverify/dashboard exec eslint src/app/reports/actions.ts src/app/reports/actions.test.ts
(no output)
```

Refactor: the recursive `compact` and the `QueryValue` types went with the path walk, since
blank fields are now skipped as they are read and an untouched additional name leaves an empty
`Map` that is filtered out. Prettier rewrapped one line of the RED test; nothing else in it
changed. The member of another type (`query/lei` for a watchlist report) is still refused by
that type's strict schema, as before.

## K6A-1 and K6A-2 (MEDIUM): already built in Stage 1

Both were read in the code before any change; neither needed one.

- **K6A-1, the report events in words.** `eventWords` has words for every `REPORT_EVENT_NAMES`
  entry ("Watchlist report matched", "… errored (not screened)"). `2c4e36ed` built them, and
  `event-words.test.ts` iterates the list. The events table (`events-table.tsx`), the event page
  and the inquiry timeline all show those words. The webhook pickers show every group by event
  name, the Report group included, because a subscription is made by name.
- **K6A-2, the `report-retention-days` field.** `REPORT_RETENTION_FIELD` is in
  `settings-fields.ts`. The settings form and page render it, editable with `settings:write` and
  read-only otherwise ("Kept as long as their inquiries" for `null`). `e03e8583` built it, with its
  tests in `settings-form.test.tsx`, `settings/page.test.tsx` and `settings/actions.test.ts`.

## P5-1 (MEDIUM): the `verification.*` events in words

`eventWords` had words only for the `selfie.*` and report events. The events list and the event
page therefore showed `verification.passed` and the other verification events by name alone. The
inquiry timeline already said them in words, in a private table of its own.

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/event-words.test.ts
 × says the verification event verification.created in words
 × says the verification event verification.submitted in words
 × says the verification event verification.passed in words
 × says the verification event verification.failed in words
 × says the verification event verification.canceled in words
 × says the verification event verification.skipped in words
 × says what happened to the verification, as the inquiry timeline does
AssertionError: expected [ undefined, undefined, …(4) ] to deeply equal [ 'Verification started', …(5) ]
 Tests  7 failed | 59 passed (66)
```

**GREEN**

`VERIFICATION_EVENT_ACTION_WORDS`, a `Record` keyed by core's `VerificationEventName`, gives
each event's action word ("started" for `verification.created`, as the timeline said it).
`eventWords` says it after "Verification". A verification event added to core without words
therefore fails the dashboard typecheck as well as the test.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/event-words.test.ts
 Tests  66 passed (66)
```

**Refactor.** The inquiry timeline's private `VERIFICATION_EVENT_LABELS` was the same table. It
now reads `VERIFICATION_EVENT_ACTION_WORDS`, through `Object.hasOwn`, so the two cannot drift.
The timeline tests ("Government ID verification passed", "… started", "… failed", one per type)
are unchanged and pass.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/event-words.test.ts src/components/lifecycle/ src/app/events/ src/app/inquiries
 Test Files  29 passed (29)
      Tests  331 passed (331)
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully
```

## P5-2 (MEDIUM): a document's preview shows once, in its evidence

A document verification's evidence shows its page-1 preview ("The document" part). The Files
section below it, on the inquiry page's card and on the verification page, showed the same
`document-preview` image a second time (Phase 5 `dashboard-documents` amendment 11 had
recorded this). The Files section still lists every file of the verification. It now names the
preview the evidence shows by its kind, media type and id, "Shown with the evidence", and
does not show the image again. A photo original stays with the files, where the evidence's
"The original photo is shown with the files." points.

Existing tests changed with the fix:

- `verification-card.test.tsx`, "lists a file that is not an image by its kind and ID, and
  shows an image file". That image was the preview. The test keeps its PDF assertions, and the
  new tests below cover what the files show: no preview image, and a photo original as an image.
- `evidence/document.test.tsx`, "shows the evidence in the Evidence region, and the preview with
  the files". It asserted the preview image in Files. It now asserts that the page holds the
  preview image exactly once, in the evidence, and that the files name it.

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/verification-card.test.tsx src/components/evidence/document.test.tsx
 × shows a document’s preview once, in its evidence, and names it in its files
 × still shows a photo original with the files, as its evidence says
 × shows the evidence in the Evidence region, and names the preview in the files
AssertionError: expected [ 'Document preview, page 1', …(1) ] to deeply equal [ 'Document preview, page 1' ]
AssertionError: expected [ 'Document, document', …(1) ] to deeply equal [ 'Document, document' ]
AssertionError: expected [ <img …(5)></img>, <img …(5)></img> ] to deeply equal [ <img …(5)></img> ]
 Tests  3 failed | 39 passed (42)
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully
```

Each failure is the second copy of the preview: on the card (twice among its images, and in its
files beside the photo original) and on the verification page.

**GREEN**

- `evidencePreviewOf(verification, files)` (`lib/document-evidence.ts`) answers the preview that
  a document's evidence shows: the latest `document-preview` of that verification, taken from
  the same files the evidence is given.
- `FileShownInEvidence` (`verification-file.tsx`) names a file by its kind, media type and id,
  with "Shown with the evidence".
- The card's `FileSection` and the page's Files list both use them. The page computes the
  verification's own file resources once (`ownFiles`) and gives the same list to the evidence
  and to the check.
- Without the inquiry (no `inquiries:read`), the kinds are unknown and no preview is identified.
  The files then stay as before: hidden, with the permission named.

A third existing test pinned the duplicate. GREEN found it, because the RED run had covered only
the two files above: `app/verifications/[id]/page.test.tsx`, "lists a file that is not an image
by its kind and ID, and shows an image file". Its only image was the preview. It keeps its PDF
assertions and now asserts that the preview is named ("Document preview", its id, "Shown with the
evidence") and that the list holds no image.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/ src/app/verifications src/app/inquiries
 Test Files  115 passed (115)
      Tests  1203 passed (1203)
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully
$ pnpm --filter @openverify/dashboard exec eslint <the five changed files>
(no output)
```

The chip portrait follows the same pattern: the chip evidence shows it, and the Files section
shows it too. It was left as built, for two reasons. The finding names the document preview
only, and the Phase 5 tests pin the portrait in the files on purpose (`government-id-nfc.test.tsx`,
"the portrait with the files").

## P5-3 (MEDIUM): without the inquiry, the evidence never says a file was not stored

The verification page reads the file kinds from the inquiry document. Without
`inquiries:read` it cannot read that document. It still gave the evidence the verification's own
files as an empty list, and an empty list means "none of these files exists". So the chip
evidence read "No chip portrait was stored (integrity or the portrait was not established)." for a
chip that has one. The document evidence had the same root and read "No preview was stored" and
"No upload recorded". The selfie photo already pointed to the selfie verification (Phase 5
`dashboard-documents` amendment 2); the portrait beside it did not.

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/evidence/document.test.tsx src/components/evidence/government-id-nfc.test.tsx
 × points to the files for the chip portrait when the inquiry cannot be read, never "not stored"
 × never says no preview or upload was stored when the inquiry cannot be read
Expected element to have text content:
  Listed with the files
Received:
  No chip portrait was stored (integrity or the portrait was not established).
Expected element not to have text content:
  /No preview was stored|No upload recorded/
Received:
  … The documentPreviewNo preview was storedOriginalNo upload recorded …
 Tests  2 failed | 50 passed (52)
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully
```

**GREEN**

- `EvidenceProps.files` (`components/evidence/generic.tsx`) gains a third state, `null`: the
  verification has files that the page cannot tell apart. `undefined` still means none were
  given, which leaves the files to the files section.
- The verification page passes `null` when the inquiry document does not name every one of the
  verification's files (`ownFiles.length === files.length`, which fails without `inquiries:read`).
- The chip evidence reads "Listed with the files" for the portrait in that state, with "Which file
  it is needs the inquiries:read permission.". The selfie photo beside it still points to the
  selfie verification.
- The document evidence leaves its preview and original to the files section in that state, as
  it does when it is given no files.
- The card is unchanged: the inquiry page has the inquiry, so the card's files are always known.

Tests changed:

- The RED page test for the document asserted a `forbidden-panel` in Files. The page shows that
  panel only when the API refuses the inquiry, not when the role lacks `inquiries:read` (the page
  then does not ask). That assertion was wrong in the test, not in the code. GREEN corrected it to
  what the Files section shows, "Your role cannot see these images (the inquiries:read
  permission).". The RED run had already failed on the first assertion, the false "No preview was
  stored".
- `evidence/props.test.tsx`, "gets no file on the page when the inquiry, which names their kinds,
  could not be read", pinned the empty list (`Files: none`). It now expects `Files: unknown`
  (`null`), and its helper prints `unknown` for `null`.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/ src/app/verifications src/app/inquiries
 Test Files  115 passed (115)
      Tests  1205 passed (1205)
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully
$ pnpm --filter @openverify/dashboard exec eslint src/components/evidence/ src/components/verification-view.tsx
(no output)
```

## P5-8 (LOW): not fixed

LOW items are not fixed in this workflow (the README rows for the records evidence views).

## R006 (MEDIUM): the report says which post-hoc figures no committed code reproduces

The calibration report labelled three figures as post hoc but did not say how they were made:

- the typo-kind breakdown (142 of 145; 0 of 98 transpositions);
- the compacted-table round (p95 1,444 ms);
- the alerts on unlisted names (37 of 150; 93 of 150).

Run 2's "every quality number … is run 2's too" could be read to cover them, but no committed step
computes any of them:

- `benchmark:render` (`packages/watchlist/scripts/benchmark-report.mjs`) prints the quality
  tables, the performance tables and the re-screen table only.
- The measure summary (`benchmark-performance.mjs`) has no alerts on unlisted subjects.
- No step runs `VACUUM FULL`. The only vacuum is `vacuumAnalyse` after a scale's last import part.
- The evaluation's own evidence says the typo breakdown came from a "scratch script, never
  committed" (`docs/tdd/phase6-evaluation-6.tdd.md`).

The suggested fix, a committed benchmark step that prints the breakdown from the observations,
belongs to `packages/watchlist/scripts/`, outside this fixer's paths. The finding's alternative is
taken instead: the report now says, in each post-hoc section, how the figure was made and that
run 2 did not reproduce it. The Reproduction section lists the three figures under "What run 2
does not cover", and findings 1, 3 and 5 mark the post-hoc figures they cite. No number changed,
and the evaluation was not re-run.

There is no executable test of the report's prose. The RED and GREEN checks are a search of the
report, and a comparison of every number in it before and after.

**RED** (before the change)

```
$ grep -n -i "never committed\|not reproduce\|did not compute\|did not repeat\|did not count\|outside the committed" docs/calibration/watchlist-phase6.md
373:**The synthetic performance files** (regenerated from the seed in each run, never committed). …
```

That match is the synthetic table files, not the post-hoc figures, which nothing marked.

**GREEN**

```
$ grep -n -i "not reproduced\|did not count\|did not repeat\|Run 1 only" docs/calibration/watchlist-phase6.md
245:- **Not reproduced by committed code.** A scratch script, never committed, counted these …
285:  - **Run 1 only.** No benchmark step runs `VACUUM FULL` …
293:  - **Not reproduced by committed code.** These counts come from the `kept` match count …
305:   - … (1,444 ms compacted, a post-hoc round of run 1 only).
313:   - The post-hoc 24.7% … (run 1 only, not reproduced by committed code) …
$ git show HEAD:docs/calibration/watchlist-phase6.md | grep -oE "[0-9][0-9,.]*[0-9]|[0-9]" | sort -u > before.txt
$ grep -oE "[0-9][0-9,.]*[0-9]|[0-9]" docs/calibration/watchlist-phase6.md | sort -u > after.txt
$ comm -13 before.txt after.txt; comm -23 before.txt after.txt
(no output from either: the same set of numbers before and after)
$ pnpm exec prettier --check docs/calibration/watchlist-phase6.md
All matched files use Prettier code style!
```

## R013 (MEDIUM): the template pickers read every page, up to 1,000, and say when they stop

The create-report page read one page of 100 active templates. The `/reports` template filter
read one page of 100 templates. A template past the first page could not be chosen, and a
bookmarked `?template=` of one read "Template not available". The fix pages through the
templates with the client's `listAll`, up to 1,000 (ten pages of 100). When more remain, each
picker says so. A chosen template past the cap reads "Template not listed", not that it is
unavailable.

`serveReportTemplatePages` (`testing/routes/report-config.ts`) answers the pages in turn, by
`page[after]`, with a next link while a page follows.

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/page.test.tsx src/app/reports/new/page.test.tsx
 × lists the active templates of every page, and creates from one past the first
 × says when the list stops at 1,000 templates, and never calls one past it unavailable
 × offers the templates of every page in the template filter, and says when it stops at 1,000
AssertionError: expected [ 'rptp_01M5Y5Z400VF5JFP7ER3C45AY2' ] to deeply equal [ …(2) ]
AssertionError: expected HTMLOptionsCollection{ …(101), …(1) } to have a length of 1000 but got 100
AssertionError: expected [ '', …(1) ] to deeply equal [ '', …(2) ]
 Tests  3 failed | 20 passed (23)
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully
```

Each picker stops at its first page: one template of two, and 100 of 1,100.

**GREEN**

- `listTemplateChoices(api, status?)` (`lib/api/report-templates.ts`, server-only) reads the
  templates through `api.reportTemplates.listAll` in pages of 100 (`TEMPLATE_PAGE_SIZE`). It
  stops at `MAX_TEMPLATE_CHOICES` (1,000) and answers whether more remain. The first request is
  unchanged (`filter[status]=active&page[size]=100` on the create page, `page[size]=100` on
  `/reports`), so the existing query assertions still hold.
- The create page offers every listed template. When more remain:
  - its select is described "Only the first 1,000 active templates are listed.";
  - a chosen template that is not listed reads "Template not listed … not among the first 1,000
    active templates listed". "Template not available" stays for a complete list.
- `ReportFilters` gains `templatesListedOf`. When the list stopped short, the template field is
  described "Only the first 1,000 templates are listed.". The filter still keeps a chosen id that
  is not listed as an option of its own, as before.
- The cap is a page-size bound of the console, not a matcher constant (C78.4 does not apply).

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports src/components/reports src/lib/api/server-only.test.ts
 Test Files  14 passed (14)
      Tests  171 passed (171)
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully
$ pnpm --filter @openverify/dashboard exec eslint src/components/reports/report-filters.tsx src/app/reports/ src/lib/api/report-templates.ts
(no output)
```

## Final gates

All were run after the last console fix (`7460b7a6`), from the repository root after
`source scripts/env.sh`.

```
$ pnpm --filter @openverify/dashboard typecheck && pnpm --filter @openverify/dashboard lint && pnpm --filter @openverify/dashboard test
✓ Types generated successfully
 Test Files  264 passed (264)
      Tests  3864 passed (3864)
Statements   : 98.72% ( 6261/6342 )
Branches     : 93.37% ( 4889/5236 )
Functions    : 99.14% ( 2325/2345 )
Lines        : 98.72% ( 6044/6122 )
(exit 0; the 80% gate holds)

$ pnpm typecheck && pnpm lint && pnpm format:check
 Tasks:    14 successful, 14 total      (typecheck)
 Tasks:    14 successful, 14 total      (lint)
All matched files use Prettier code style!
(exit 0)

$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   69 passed (22.5s)
@openverify/e2e:e2e:   91 passed (10.1m)
  Time:    10m44.999s
(exit 0)
```

The first run of the repository gate stopped at `@openverify/api#lint`, on one error in
`apps/api/src/watchlists/sync.ts:550`. That file is the API fixer's, and at that moment it held
uncommitted work. The gate was run again once that work was committed, and passed. The e2e run
went in the background under the lock, and a foreground wait read its log until it ended.
