# TDD record: Phase 6, Workflow 6B Stage 1, `dashboard-reports` (C86)

The reports console: navigation, the reports index and detail, create, the inquiry and account
sections, event, problem and run-note words, the permission area, the `report-retention-days`
setting, the README section, the RSC payload tests and the full-stack spec `ui-reports.spec.ts`.
Every value in a fixture is synthetic. Commands were run from the repository root after
`source scripts/env.sh`; outputs are abbreviated.

## Slice 1: the navigation entries (C86, first so `dashboard-report-config` is not blocked)

A "Reports" group after "Verifications" holds Reports (`/reports`), Report templates
(`/report-templates`) and Watchlist sources (`/watchlist-sources`), each shown only to a
principal holding the scope its API route requires: `GET /dashboard/reports` needs
`reports:read`, `GET /report-templates` needs `report-templates:read`, and
`GET /dashboard/watchlist-sources` needs `watchlists:read` (read in
`apps/api/src/routes/server/report-templates.ts` and `routes/dashboard/watchlist-sources.ts`).

No registration point is needed for `testing/routes/report-config.ts`: `routeApi`
(`testing/api-routes.ts`) answers any method and path through `on` and `handle`, and every
`testing/routes/<area>.ts` module is a free-standing helper over it (`routes/people.ts` imports
`../api-routes` and nothing registers it).

Existing tests changed with the plan (C86 adds three navigation items): `nav-items.test.ts` (the
route list, the group labels and the admin count, 13 to 16) and `nav.test.tsx` (the link count).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/nav-items.test.ts src/components/nav.test.tsx --coverage.enabled=false
 × lists every C23 console route, each gated by the permission that reads it
 × are a group of their own, each item read with the scope its API route requires
 × shows an item to a principal holding reports:read only, and hides it otherwise
 × shows an item to a principal holding report-templates:read only, and hides it otherwise
 × shows an item to a principal holding watchlists:read only, and hides it otherwise
 × shows an admin everything
 × is the console navigation, with a labelled list per group
AssertionError: expected [ …(13) ] to deeply equal [ …(16) ]
AssertionError: expected undefined to deeply equal [ { href: '/reports', …(2) }, …(2) ]
AssertionError: expected [] to deeply equal [ 'Reports' ]
 Tests  7 failed | 14 passed (21)
$ (cd apps/dashboard && pnpm exec tsc --noEmit)    # no output: the RED test typechecks
```

**GREEN** (`components/nav-items.ts`: the "Reports" group)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/nav-items.test.ts src/components/nav.test.tsx src/components/console-layout.test.tsx src/app/page.test.tsx --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  40 passed (40)
```

## Slice 2: report, match and query words (C69.3, C69.4, C73.2, C75, C78.4, C78.5, C84.2, C86)

`lib/report-words.ts` (errors, run notes, coverage limits, unavailable reasons, notices, run
types and statuses, actions, origins, paused reasons, query sources), `lib/report-match-words.ts`
(match types, qualifiers with their score change, name levels, methods, match and review
statuses, risk levels) and `lib/report-query-words.ts` (a label for every query member of every
type). Each test iterates the contract's list first (`REPORT_ERROR_CODES`, `REPORT_RUN_NOTES`,
`REPORT_COVERAGE_LIMITS`, `REPORT_UNAVAILABLE_REASONS`, `REPORT_NOTICES`, `REPORT_MATCH_TYPES`,
`REPORT_MATCH_QUALIFIERS`, `MATCH_LEVELS`, `REPORT_QUERY_FIELDS`, ...). The stub (names, empty
records) was committed first so the RED tests compile.

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-words.test.ts src/lib/report-match-words.test.ts src/lib/report-query-words.test.ts --coverage.enabled=false
AssertionError: expected [] to deeply equal [ 'insufficient_input', …(7) ]
AssertionError: expected [] to deeply equal [ 'inquiry_already_decided', …(6) ]
AssertionError: expected '' to be 'Countries differ (−0.10)'
AssertionError: expected undefined to be 'Company name'
AssertionError: expected undefined to be 'Errored (not screened)'
 Test Files  3 failed (3)
      Tests  173 failed | 12 passed (185)
$ (cd apps/dashboard && pnpm exec tsc --noEmit && pnpm exec eslint src/lib/report-*words.test.ts)   # clean
```

**GREEN** (the three modules filled; a source-naming detail starts "A selected list", which
`reportErrorText` replaces with the source id; qualifiers read their change from core's
`qualifierAdjustment`)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-words.test.ts src/lib/report-match-words.test.ts src/lib/report-query-words.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  185 passed (185)
```

The dashboard typecheck is filtered to my paths while `dashboard-report-config`'s uncommitted
work in progress does not compile (`components/report-config/config-words.test.ts`); my files
add no error.

## Slice 3: report events in words (C70.4, C86)

`eventWords` (`lib/event-words.ts`) says every report event, built from the type's label and the
action, the test iterating `REPORT_EVENT_NAMES` first; `.errored` reads "errored (not screened)".

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/event-words.test.ts --coverage.enabled=false
AssertionError: expected [ undefined, undefined, …(4) ] to deeply equal [ 'Watchlist report ready', …(5) ]
 Test Files  1 failed (1)
      Tests  47 failed | 10 passed (57)
```

**GREEN** (`REPORT_EVENT_ACTION_WORDS`, the type label from `REPORT_TYPE_LABELS`; the events page
group comment updated)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/event-words.test.ts src/lib/api/events.test.ts src/components/lifecycle/inquiry-timeline.test.tsx --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  79 passed (79)
```

## Slice 4: report problems in words (C72.4, C86)

A refused report action is titled in words by its problem `code` (the API's titles are the
generic HTTP ones, "Conflict"), keeping the API's detail, field errors and request id:
`describeReportProblem` (`lib/report-problem-words.ts`). For that, `displayProblemOf`
(`lib/api/errors.ts`) keeps a string `code` on the displayed problem (an optional member of
`DisplayProblem`). The test iterates `REPORT_PROBLEM_CODES` first and titles each golden problem
of `contracts/fixtures/problems/reports/`. Stub first (`6ae7c9d0`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-problem-words.test.ts src/lib/api/errors.test.ts --coverage.enabled=false
AssertionError: expected [] to deeply equal [ 'report_query_invalid', …(12) ]
AssertionError: expected 'Conflict' to be undefined
AssertionError: expected { title: 'Synthetic Problem', …(3) } to match object { status: 409, …(1) }
 Test Files  2 failed (2)
      Tests  29 failed | 29 passed (58)
```

**GREEN**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-problem-words.test.ts src/lib/api --coverage.enabled=false
 Test Files  22 passed (22)
      Tests  281 passed (281)
$ pnpm --filter @openverify/dashboard exec vitest run src/app src/lib --coverage.enabled=false   # no problem assertion broke
 FAIL  src/app/report-templates/page.test.tsx   # dashboard-report-config's work in progress, not this slice
 Test Files  1 failed | 133 passed (134)
      Tests  2375 passed (2375)
```

## Slice 5: tiers, stage, what a status and a result mean (ADR 0002, ADR 0005, C69.1, C86)

`lib/report-type-words.ts`: the tier and stage words, what each status means (checked sentence
by sentence against `docs/reports/README.md`, "What a report says, and what it does not") and,
per type, what a result means in each state (checked against the type's page, "What a result
means", or the overview), read by `testing/report-docs.ts`. "No match" is said only beside
`ready`. Stub first (`6734ba41`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-type-words.test.ts --coverage.enabled=false
AssertionError: expected '' not to be ''
AssertionError: expected undefined to be 'Its latest run could not screen somet…'
AssertionError: expected [] to deeply equal [ undefined, undefined, undefined ]
 Test Files  1 failed (1)
      Tests  26 failed (26)
```

**GREEN** (every line is the docs' own wording; the three types without review share the
overview's "unknown is never false" rule, the phone page adds its provider line)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-type-words.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  26 passed (26)
```

## Slice 6: the reports list URL state and the dashboard reads (C23, C72.3, C86)

`lib/report-query.ts` reads the index's filters from the URL (type, template, status, result,
tag, account, inquiry; a typed value the API would refuse is explained, never sent; "no match"
is `filter[has-match]=false`, which lists `ready` reports only, C69.4); `lib/api/reports.ts`
reads `GET /dashboard/reports` and `GET /dashboard/reports/:id` (masked by the API, C70.3).
`testing/report-fixtures.ts` builds reports on the golden API fixtures, masked as the API masks
them (`PII_REPORT_ATTRIBUTES`, `query` member-wise), with `reportPiiValues(type)` for payload
searches; its own test passes from the start (test support, not product code). Stub first
(`ba6e000c`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-query.test.ts src/lib/api/reports.test.ts src/testing/report-fixtures.test.ts --coverage.enabled=false
AssertionError: expected { types: [], statuses: [], tags: [] } to deeply equal { types: [ …(3) ], …(6) }
AssertionError: expected undefined to be 'false'
Error: not built: rep_01M5Y5Z4002GV576EACWSHT2BK
 Test Files  2 failed | 1 passed (3)
      Tests  10 failed | 20 passed (30)
```

**GREEN**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-query.test.ts src/lib/api/reports.test.ts src/testing/report-fixtures.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  30 passed (30)
```

## Slice 7: the reports index (C86)

`/reports`: the environment's reports newest first, each with its type, status, result beside
its coverage (`lib/report-result.ts`: "Match", "No match" only beside `ready`, "Not screened"
for an errored report, "Match; not fully screened" for a partial run that kept matches, "Fields
computed" for a type without review), template version, origin, tags and creation; filters on
type, template, status, result, tag, account and inquiry in a GET form; cursor pagination;
"Create report" for `reports:write`; a template list for `report-templates:read`, a template ID
field otherwise. `testing/report-fixtures.ts` gains report templates. Stub first (`cd717c98`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/page.test.tsx src/lib/report-result.test.ts --coverage.enabled=false
 × reads an errored watchlist report as not screened, never as no match (C69.4)
 × lists the environment's reports: type, status, result beside its coverage, version, origin, tags and creation
 × passes the filters and cursor of the URL to the API, shows them in the form and keeps them on the next page
 × shows the forbidden panel without reports:read, and asks the API nothing
 Test Files  2 failed (2)
      Tests  40 failed (40)
```

**GREEN** (`lib/report-result.ts`; `components/reports/report-badges.tsx` (status, result and
stage badges, text first: a match is amber, never green for "no match"), `reports-table.tsx`,
`report-filters.tsx`; `app/reports/{page,layout,loading,error}.tsx`)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/page.test.tsx src/lib/report-result.test.ts --coverage.enabled=false
AssertionError: expected '90 days only' to match /^[A-Z][^_]*$/     # a label must start with a capital
 Tests  1 failed | 40 passed (41)
# relabelled "Last 90 days only"
 Test Files  2 passed (2)
      Tests  41 passed (41)
```

## Slice 8: the report server actions (C72.1, C73.5, C74.5, C75, C86)

`app/reports/actions.ts`: create (the template, the typed query built from `query/<member>`
fields, additional names by index, an optional account and an explicit account creation, in the
session's environment), dismiss and review (bodies under `data.attributes`, a required reason, a
comment for a false positive), pause, resume, run, redact (a typed phrase) and the three tag
actions. Every refusal by a report problem code is titled in words (`describeReportProblem`).
Review and dismissal need `pii:view` beside `reports:review`: nobody decides on evidence the API
hides from them (as the note editor needs it, Workflow 2E). No action answers report data to
the browser: creation answers the new id only. Stub first (`b7146736`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/actions.test.ts --coverage.enabled=false
AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, data: undefined }
AssertionError: expected undefined to deeply equal { data: { attributes: { …(6) } } }
AssertionError: expected undefined to deeply equal { meta: { 'tag-name': 'vip' } }
 Test Files  1 failed (1)
      Tests  25 failed (25)
```

**GREEN**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/actions.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

## Slice 9a: the report page, its result, query, sources, details, tags and redaction (C86)

`/reports/[id]` reads `GET /dashboard/reports/:id` (masked, C72.3). The "Result" section puts the
status, the result and the coverage with each limit in words side by side; the errors in words
naming each source ("Why it was not fully screened"); "What this result means" (the status line
and the type's line for its state, from `docs/reports/`; no "no match" unless `ready`); the
notices; the fields nobody could compute; the tiers with the registry's tier note and the stage
badge; the provider (labelled sandbox), the matcher version and the thresholds. Then the query,
member by member with where each value came from ("Hidden" without `pii:view`, "Redacted" once
redacted), the sources (each screened one with its publication, last check, origin and sync, and
each one not screened with why), the details, the tags and redaction. Stub first (`3dd5bb08`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run "src/app/reports/[id]/page.test.tsx" --coverage.enabled=false
 × says an errored report was not screened, naming each source, and never says no match (C69.4)
 × shows the query masked, member by member, to an operator without pii:view (C70.3)
 × shows a redacted report as redacted, its query gone, and offers no change (C73.5, H23)
 Test Files  1 failed (1)
      Tests  15 failed | 1 passed (16)
```

**GREEN** (`components/reports/report-{parts,summary,query,sources,view}.tsx`,
`app/reports/[id]/{page,loading}.tsx`)

```
$ pnpm --filter @openverify/dashboard exec vitest run "src/app/reports/[id]/page.test.tsx" --coverage.enabled=false
TestingLibraryElementError: Found multiple elements with the role "region" and name "Sources"
 Tests  2 failed | 14 passed (16)
```

The two failures were the test's own ambiguity, not the page: `DataTable` names its scrolling
region by its caption, so the section and the table's region are both "Sources". The two
lookups now find the table by its name directly (`screen.getByRole('table', { name: 'Sources' })`);
what they assert is unchanged.

```
$ pnpm --filter @openverify/dashboard exec vitest run "src/app/reports/[id]/page.test.tsx" src/app/reports/page.test.tsx --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  29 passed (29)
```

## Slice 9b: matches with their evidence, review and dismissal, the ignore list (C75, C78.5, C86)

`components/reports/report-matches.tsx`: each match as an article named by the matched name:
its status, review, risk level and notify-on-change; the subject's name and the list's name side
by side with the name level, methods, match types, qualifiers with their score change, the
score with its preset and minimum, the source and entry; an open match the last run did not find
is marked ("stays open until a person dismisses it", C75.8); where it lapsed from; when it was
delisted. Review and Dismiss per match (named by its `rpm_` id, WCAG 2.4.6) and for every open
match, only with the review ability (`reports:review` with `pii:view`), never on a pending
report. `match-dialogs.tsx`: the dialogs move focus in and back; the reason (dismissal) is
required and the comment (false positive) explained, each refusal shown on its field and tied to
it (`aria-invalid`, its description), not repeated in the summary. `report-ignore-list.tsx`: the
dismissed matches, when, by whom, why and the run that found them. Without `pii:view` the API
masks the matches and the ignore list whole: "Hidden", and nothing to act on. Stub first
(`3ddbdc04`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/reports --coverage.enabled=false
 Test Files  3 failed (3)
      Tests  17 failed | 1 passed (18)
```

**GREEN** (`match-dialogs.tsx` composes the shared `Dialog`, `useFormAction`, `FormField` and
`ProblemDisplay` with `withoutFieldErrors`, so the shared `FormDialogButton` is unchanged;
`report-matches.tsx`, `report-ignore-list.tsx`; the report view shows both for the types with
review)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/reports src/app/reports --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  72 passed (72)
```

## Slice 9c: what each type found (C79-C82, C86)

`components/reports/report-results.tsx` by type: the matched lists with their entries (names,
alias, birth dates, countries, programmes, score; a business entry's kind and identifiers, and
the lists searched); the listed crypto addresses with ticker and chain, the address format and
the exposure block (its risk score never synthesised); the PEP persons with their positions,
relatives and Wikidata sources as plain links; the media articles as plain links only (title as
link text, `rel="noopener noreferrer nofollow"`, nothing fetched, previewed or embedded) with
their confidence and beta stage and the citation; the email, phone and address fields with every
unavailable field explained inline, an H-tier level with its confidence, reasons and beta stage,
and `email-domain-kind` beside a masked domain (P15). `lib/report-field-words.ts`: the field
labels (every type attribute of the golden fixtures) and the value words; its test iterates
`EMAIL_REPUTATION_REASONS`, `PHONE_RISK_REASONS` and `ADVERSE_MEDIA_CATEGORIES` first. Stub
first (`ae641954`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-field-words.test.ts src/components/reports/report-results.test.tsx --coverage.enabled=false
 Test Files  2 failed (2)
      Tests  136 failed | 4 passed (140)
```

**GREEN** (`lib/report-field-words.ts`, `components/reports/report-results.tsx`, shown by the
report view after the matches; an out link uses the shared `LINK_CLASS` with
`rel="noopener noreferrer nofollow"`, `target="_blank"` and "(opens in a new tab)" for screen
readers)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-field-words.test.ts src/components/reports/report-results.test.tsx --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  140 passed (140)
$ pnpm --filter @openverify/dashboard exec vitest run src/components/reports src/app/reports src/lib/report-field-words.test.ts --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  212 passed (212)
```

## Slice 9d: monitoring and the history timeline (C74, C86)

`components/reports/report-monitoring.tsx` (recurrable types only): the monitoring state in
words (recurring, paused by an operator or on a match, or not recurring), the next run, when it
was paused, how many runs so far; Pause (a recurring report), Resume (a paused one) and Run now
(also while paused), each only with `reports:write` on a report that is not redacted.
`report-history.tsx`: runs and actions newest first, each run with its type and status, times,
match counts, notes in words (every `REPORT_RUN_NOTES` value), errors in words and coverage;
each action with its actor (a user, an API key, or the system), the matches it changed, its
review and risk level, and its reason and comment ("Hidden" without `pii:view`). Stub first
(`095b6a0c`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/reports/report-monitoring.test.tsx src/components/reports/report-history.test.tsx --coverage.enabled=false
 Test Files  2 failed (2)
      Tests  8 failed | 1 passed (9)
```

**GREEN** (`report-monitoring.tsx` with the shared `InstantActionButton`, `report-history.tsx`;
both shown by the report view after the tags)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/reports src/app/reports --coverage.enabled=false
 Test Files  9 passed (9)
      Tests  94 passed (94)
```

## Slice 10: create report (C72.1, C86)

`/reports/new` (`reports:write` and `report-templates:read`): first a plain GET form to choose
one of the active templates; then the query form of that template's type
(`components/reports/create-report-form.tsx`): one field per member of `REPORT_QUERY_FIELDS`
(selects for gender and identification type), up to three additional names, an account ID with
`accounts:read`, and a new account only when asked. The type's tier and stage are shown. A 422
shows on its field by JSON Pointer (`/data/attributes/query/<member>`, an additional name's by
index), tied to it, and the summary does not repeat it; success opens the new report. Stub first
(`63d320f2`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/reports/create-report-form.test.tsx src/app/reports/new/page.test.tsx --coverage.enabled=false
 Test Files  2 failed (2)
      Tests  9 failed | 1 passed (10)
```

**GREEN** (`create-report-form.tsx`, `app/reports/new/page.tsx`)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/reports/create-report-form.test.tsx src/app/reports/new/page.test.tsx --coverage.enabled=false
TestingLibraryElementError: Found multiple elements with the role "textbox" and name "First name"
 Tests  2 failed | 8 passed (10)
```

A real accessibility defect the RED test exposed: the query's "First name" and each additional
name's "First name" shared one accessible name (WCAG 2.4.6). Each additional field now shows
"First name" and is read as "First name of additional name 1" (its name starts with the visible
label, WCAG 2.5.3). The test's two lookups inside the "Additional name 1" group now use that
name; what they assert is unchanged. A first try put the space inside the screen-reader span,
which the name computation trims ("First nameof ..."); the space now sits before the span.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/reports/create-report-form.test.tsx src/app/reports/new/page.test.tsx --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  10 passed (10)
```

## Slice 11: the reports sections of the inquiry and account pages (C70.5, C84.3, C84.4, C86)

There is no tab primitive, so each page gains a "Reports" section (with `reports:read`; a 403
shows the section's forbidden panel and the rest of the page renders). It reads the masked
dashboard list filtered to the inquiry (`filter[inquiry-id]`) or the account (`filter[account-id]`,
home or linked), at most 25, newest first, with a link to the full list when there are more.
`dashboardInquiryDocumentSchema` carries no reports and no dashboard account document exists, so
the sections read `GET /dashboard/reports`, masked the same way (a contract deviation recorded in
the report). On the inquiry page each completion report is read once more
(`GET /dashboard/reports/:id`) for its runs' notes, so a report whose run found the inquiry
already decided says "Decided before this report finished" (C84.3); a report the API created is
never read again. Stubs first (`9cb89899`).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/api/reports.test.ts "src/app/inquiries/[id]/reports-section.test.tsx" "src/app/accounts/[id]/reports-section.test.tsx" --coverage.enabled=false
 Test Files  3 failed (3)
      Tests  7 failed | 5 passed (12)      # the passes: the earlier reads, and "no section without reports:read"
```

**GREEN** (`components/reports/linked-reports.tsx`, `loadLinkedReports` in `lib/api/reports.ts`,
an optional "Note" column on `ReportsTable`, the section on `InquiryView` and `AccountView`, both
pages loading it with `loadSection`; each view gains an optional `reportTemplatesRead` ability)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/api/reports.test.ts "src/app/inquiries/[id]" "src/app/accounts/[id]" src/components/reports src/app/reports --coverage.enabled=false
 Test Files  16 passed (16)
      Tests  175 passed (175)
```

## Slice 12: the `report-retention-days` setting (C73.6, C86)

The settings page's retention group gains "Reports (days)": reports are redacted, never deleted,
this many days after creation; empty keeps them as long as their inquiries (null); from 1 to
3,650 (`REPORT_RETENTION_DAYS`). Only a role with `settings:write` gets the field (the read-only
view says "Kept as long as their inquiries" or the days); a refusal shows on the field by its
pointer `/report-retention-days`; a server that does not report it gets no field and posts
nothing. No stub: the form, view and action exist.

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/operators/settings-form.test.tsx src/app/settings --coverage.enabled=false
 × shows the environment’s report retention, empty to keep reports as long as their inquiries, from 1 to 3,650
 × asks for a whole number of days from 1 to 3650 for 3651, without calling the API
 × shows the report retention read-only with settings:read alone
 Test Files  3 failed | 1 passed (4)
      Tests  11 failed | 54 passed (65)
```

**GREEN** (`REPORT_RETENTION_FIELD` in `components/operators/settings-fields.ts`, the field in
`settings-form.tsx`, the read-only line in `settings-view.tsx`, the parse in
`app/settings/actions.ts`)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/operators src/app/settings --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  104 passed (104)
```

## Slice 13: the RSC payload (C70.3, C86)

`app/reports/rsc-payload.test.tsx`, with `testing/rsc-payload.ts`: for an operator holding every
report permission but `pii:view`, the RSC payload of the report page of every type, of the
reports index and of the inquiry's and the account's reports sections holds none of the report's
personal values (`reportPiiValues`: query values, matched and list entry names, entity keys,
article titles and URLs, positions, resolved addresses, wallet addresses, the email domain). The
control: the same search finds them in the report page's payload when the API shows them, so the
check can fail; the sections test also asserts the reports rendered. These tests guard a property
the views already kept (they never unmask and read nothing else), so they passed when written;
the control is the evidence that they can fail. A first run failed in the test itself: its
synthetic report ids were not valid ULIDs (`ZodError`); fixed in the test.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/rsc-payload.test.tsx --coverage.enabled=false
ZodError: [ ...                                   # the test's own ids
 Tests  1 failed | 18 passed (19)
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/rsc-payload.test.tsx --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

## Slice 14: the review dialog requires its reason too (C86)

C86 says the review and dismissal dialogs each require a reason. Slice 9b required the review's
comment only for a false positive (the API's rule, C75.5), so the console now requires a comment
for every review, kept in the history; the server action refuses a blank one at
`/data/attributes/comment` ("Say why you decided this."). This is stricter than the API and
recorded as a contract deviation. My own earlier tests of this workflow changed with it: the
`all_records` review test now sends a comment, and the superseded test sends one.

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/actions.test.ts src/components/reports/match-dialogs.test.tsx --coverage.enabled=false
 × requires a comment for every review, the reason kept in the history (C86)
 × says a false positive needs a comment, and shows the refusal on the comment     # expects the field required
 Test Files  2 failed (2)
      Tests  2 failed | 29 passed (31)
```

**GREEN**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports src/components/reports --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  124 passed (124)
```

## Slice 15: the full-stack spec `e2e/tests/ui-reports.spec.ts` (C86, C89)

Three tests, budget 90 s (stated in the header line), each making its own data through the
existing helpers (`support/reports.ts`: `SANDBOX_LISTS`, `seededTemplateId`, `waitForReport`,
`waitForCompletedRuns`; `support/ui.ts`: the kept sessions) and the sandbox list `seed:dev`
loads; `support/ui-reports.ts` holds this spec's small helpers.
- A reviewer creates a watchlist report in the console from `Default watchlist` on the sandbox
  list's fictional listed person (checked against the committed fixture): the match beside its
  complete coverage, what it means, the imported list's provenance, origin "Console", the evidence;
  the dismissal dialog refuses an empty reason on its field, then dismisses: "No match" beside
  ready, the reason in the ignore list; Run now runs it again ("Run now run: Ready", still
  dismissed); the reviewer redacts it.
- A viewer reads two reports the spec links to its own inquiry: one matched, one from a template
  it creates selecting `ofac-sdn` (never synced by the e2e), which is "Not screened" naming the
  list, never "no match"; the matched one's query (4 members) and matches are "Hidden", with
  nothing to act on and no surname on the page; the inquiry page lists both. The template is
  archived in `finally`.
- An admin's report retention: 3651 refused on the field, a new value saved, the original
  restored in `finally` and checked.

This is the integration test of slices 1-14, which were each built test-first in Vitest; it
passed on its first full-stack run.

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-reports.spec.ts'
[e2e +70.6s] stack ready; logs in e2e/.artifacts/logs
  ✓  1 … a reviewer creates a watchlist report in the console, … dismisses it with a required reason, runs it again and redacts it (5.9s)
  ✓  2 … a viewer reads reports masked, an errored one as not screened naming its list, and an inquiry’s reports in its section (3.2s)
  ✓  3 … an admin sets the report retention, a value out of range is refused on its field, and the original is restored (3.2s)
  3 passed (1.5m)
$ (cd e2e && pnpm exec eslint tests/ui-reports.spec.ts tests/support/ui-reports.ts && pnpm exec tsc --noEmit)   # clean
```

## Refactor: the word tests lint clean against the full records

The RED tests of slices 2 and 5 were linted while the stubs typed the records `Partial`; once
GREEN typed them as full `Record`s, their optional chains (`words?.title`, `means?.match`, a
`?? ''`) became `no-unnecessary-condition` errors (16), which `dashboard-report-config`'s final
lint also met. They are removed; what each test asserts is unchanged.

```
$ (cd apps/dashboard && pnpm exec eslint .)          # clean
$ pnpm --filter @openverify/dashboard exec vitest run src/lib/report-type-words.test.ts src/lib/report-words.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  111 passed (111)
```

## Slice 16: the create page's loading state, and the branches the coverage report left

The coverage of my files showed the additional names of a query, the operator-paused and the
"no run yet" monitoring wording, and the reports' loading and error boundaries untested. Writing
those tests found one gap: `/reports/new` had no loading state. A stub (`cc5e1d30`) let the test
compile; the other new tests describe behaviour already built and passed at once.

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run "src/app/reports/[id]/page.test.tsx" src/components/reports/report-monitoring.test.tsx src/app/reports/states.test.tsx --coverage.enabled=false
AssertionError: expected [ 'Loading the report…', 'Loading…' ] to deeply equal [ 'Loading the report…', …(1) ]
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 26 passed (27)
```

**GREEN** (`app/reports/new/loading.tsx`: "Loading the report templates…")

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/reports/states.test.tsx --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## Final gates (foreground)

```
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully                         # tsc: no output
$ pnpm --filter @openverify/dashboard lint             # eslint .: no output
$ pnpm --filter @openverify/dashboard test
 Test Files  263 passed (263)
      Tests  3825 passed (3825)
Statements   : 98.49% ( 6220/6315 )
Branches     : 93.15% ( 4846/5202 )
Functions    : 98.8% ( 2306/2334 )
Lines        : 98.49% ( 6003/6095 )
$ pnpm typecheck
 Tasks:    14 successful, 14 total
$ pnpm lint
 Tasks:    14 successful, 14 total
$ pnpm format:check
All matched files use Prettier code style!
```

That dashboard run predated slice 16's tests and the create page's loading state, so the script
ran again on the final code:

```
$ pnpm --filter @openverify/dashboard test
 Test Files  264 passed (264)
      Tests  3831 passed (3831)
Statements   : 98.68% ( 6233/6316 )
Branches     : 93.25% ( 4851/5202 )
Functions    : 99.1% ( 2314/2335 )
Lines        : 98.68% ( 6016/6096 )
```

`pnpm e2e`, as the four calls the workflow prescribes, each under the e2e lock:

```
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e
  69 passed (21.0s)
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test --shard=1/3'
  31 passed (3.1m)
$ … --shard=2/3
OpenVerify API failed to start: A callback for 'onReady' hook timed out.
# The stack did not start; no test ran. api.log: "watchlist sources not reconciled" 12 s after start;
# the worker's reconciliation took 11 s too, at a load average of 11. Not in my paths: re-run.
$ … --shard=2/3
  ✘ tests/ui-integrations.spec.ts:204:1 › a developer creates an API key with an expiry, …
    Error: locator.fill: Error: Malformed value … fill("2026-10-28T09:14:00")
  1 failed, 30 passed (5.7m)
# Not in my paths, and not load: `utcFieldValue` is `toISOString().slice(0, 19)`, and an expiry that
# lands on second 00 is normalised by Chromium's datetime-local input to "09:14", which Playwright
# refuses. Deterministic at :00, reported with its fix as a follow-up; re-run.
$ … --shard=2/3
  31 passed (5.3m)
$ … --shard=3/3
  ✓ tests/ui-reports.spec.ts:42:1 › a reviewer creates a watchlist report in the console, … (5.0s)
  ✓ tests/ui-reports.spec.ts:130:1 › a viewer reads reports masked, … (3.0s)
  ✓ tests/ui-reports.spec.ts:198:1 › an admin sets the report retention, … (1.4s)
  29 passed (4.8m)
```

91 full-stack tests in all (the 86 of Workflow 6A, `dashboard-report-config`'s two and this
spec's three), and the 69 mocked flow tests.
