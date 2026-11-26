# TDD evidence: Phase 2, Workflow 2C, dashboard-lifecycle (Stage 2)

Scope: the C23 inquiry, account, account type and template pages of the dashboard (C10, C11,
C13 through the C21 BFF), the dashboard-shell follow-up on masked images (a viewer's image
answers 403, so it shows "Hidden"), and C24 specs 3, 6, 7 and 9 (`e2e/tests/ui-lifecycle.spec.ts`).

Every command ran from `apps/dashboard` after `source scripts/env.sh`, unless it says otherwise.
While iterating, only this slice's test files ran, with `--coverage.enabled=false`. Output is
abbreviated with `…`.

Test support of this slice (in `src/components/lifecycle/testing/`, which it owns):
- `api-routes.ts`, `routeApi()`: a route-matching fetch stub. Pages load the inquiry, its
  sessions and its events at once (`Promise.all`), so the shell's FIFO `mockApi()` would make
  each test depend on request order. Answers are matched by method and path instead.
- `fixtures.ts`: synthetic inquiries, sessions, events, accounts, account types, templates and
  versions, each parsed with its contract schema where it is built.

## Slice 1: inquiry list filters (status list, tags, account, reference id, created range)

Filters live in the URL (`status` repeated, `tag`, `account-id`, `reference-id`, `created-from`,
`created-to`, `after`) and go to `GET /dashboard/inquiries` as the C9 filters; the creation range
is a range of UTC days with an exclusive end. A typed value the API would refuse is explained in
the form instead of being sent.

### RED

```
$ pnpm exec vitest run src/lib/inquiry-query.test.ts src/lib/api/inquiries.test.ts \
    src/components/inquiry-filters.test.tsx src/components/inquiries-table.test.tsx \
    src/app/inquiries/page.test.tsx src/app/inquiries/loading.test.tsx --coverage.enabled=false
 FAIL  src/app/inquiries/loading.test.tsx
Error: Failed to resolve import "./[id]/loading" from "src/app/inquiries/loading.test.tsx".
 FAIL  src/lib/api/inquiries.test.ts
Error: Cannot find module '/src/lib/api/inquiries' imported from …/src/lib/api/inquiries.test.ts
 FAIL  src/components/inquiries-table.test.tsx > InquiriesTable > lists inquiries in a named table with the expected columns
AssertionError: expected [ 'Inquiry ID', 'Reference ID', …(2) ] to deeply equal [ 'Inquiry ID', 'Reference ID', …(4) ]
 FAIL  src/components/inquiry-filters.test.tsx > InquiryFilters > is a search form that works without JavaScript (GET /inquiries)
TypeError: Cannot read properties of undefined (reading 'statuses')
 …
 Test Files  6 failed (6)
      Tests  29 failed | 9 passed (38)
```

Committed as `test(dashboard): require inquiry list filters …` (1d92ce7).

### GREEN

`lib/inquiry-query.ts` (parse, URL query, C9 filters), `lib/api/inquiries.ts` (`listInquiries`,
`getInquiry`, `listInquiryEvents`), the GET filter form with a status checkbox group, the table's
Tags and Account columns, the page's empty and invalid-filter states, and loading states.

```
$ pnpm exec vitest run <the same six files> --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  46 passed (46)
$ pnpm exec eslint <slice files>        # no findings
$ pnpm exec tsc --noEmit                # no error in this slice's files
```

Committed as `feat(dashboard): filter inquiries by …` (af151d4).

### REFACTOR

The tag, reference id and day-range parsing moved to `components/lifecycle/list-filters.ts`, for
the accounts list too; `inquiry-query.ts` uses it.

```
$ pnpm exec vitest run src/lib/inquiry-query.test.ts src/lib/api/inquiries.test.ts \
    src/app/inquiries src/components/inquiry-filters.test.tsx --coverage.enabled=false
 Test Files  9 passed (9)
      Tests  107 passed (107)
```

Committed as `refactor(dashboard): share the typed tag, reference id and day-range list filters`
(af0265a).

## Slice 2: inquiry decisions, typed-confirmation redaction, redacted state, masked images

Approve, decline, mark for review and expire are offered only with `inquiries:write` and only from
the statuses `INQUIRY_TRANSITIONS` allows (`inquiryActionsFor`); redaction only with
`inquiries:redact`, behind a dialog whose confirm button works once the operator typed `redact`
(the server action checks the phrase again). Images show "Hidden" without `pii:view` (they would
answer 403) and "Redacted" on a redacted inquiry; check details need `verifications:read`.

### RED

```
$ pnpm exec vitest run src/app/inquiries/actions.test.ts \
    src/components/lifecycle/typed-confirm-button.test.tsx \
    src/components/lifecycle/inquiry-actions.test.tsx src/components/verification-card.test.tsx
 FAIL  src/app/inquiries/actions.test.ts
Error: Cannot find module '/src/app/inquiries/actions' imported from …/actions.test.ts
 FAIL  src/components/lifecycle/inquiry-actions.test.tsx
Error: Failed to resolve import "./inquiry-actions" from …
 FAIL  src/components/lifecycle/typed-confirm-button.test.tsx
Error: Failed to resolve import "./typed-confirm-button" from …
 FAIL  src/components/verification-card.test.tsx > VerificationCard > shows "Hidden" instead of the images to an operator without pii:view
TestingLibraryElementError: Found multiple elements with the role "img"
 Test Files  4 failed (4)
      Tests  3 failed | 6 passed (9)

$ pnpm exec vitest run 'src/app/inquiries/[id]/page.test.tsx' --coverage.enabled=false
 FAIL  … > shows the inquiry with its status, reference, template, account and times
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Details"
 FAIL  … > offers the decisions a completed inquiry allows, and redaction
AssertionError: expected [] to deeply equal [ 'Approve', 'Decline', …(2) ]
 FAIL  … > shows the redacted state: no fields, no images, no second redaction
TestingLibraryElementError: Unable to find an accessible element with the role "status" and name "Redacted"
 Test Files  1 failed (1)
      Tests  10 failed | 7 passed (17)
```

Committed as `test(dashboard): require inquiry decisions by status and permission, …` (617ce49).

### GREEN

`app/inquiries/actions.ts` (`transitionInquiry`, `redactInquiry`), `InquiryActions`,
`TypedConfirmButton`, `InquiryView`, and the verification card's `media` and `showChecks`.

```
$ pnpm exec vitest run src/app/inquiries src/components/lifecycle \
    src/components/verification-card.test.tsx --coverage.enabled=false
 Test Files  9 passed (9)
      Tests  69 passed (69)
```

Committed as `feat(dashboard): inquiry decisions by status and permission, …` (007035f).

## Slice 3: tags, note, fields, one-time links, sessions, timeline, sandbox simulation

- Tags: removed one by one, added, or replaced as a list (`set-tags`), with `inquiries:write`.
- Note and fields: edited only with `inquiries:write` and `pii:view` (nobody overwrites a value
  they cannot read); fields only while the inquiry is `created` or `pending`, as JSON whose API
  errors show by path.
- One-time link: generated for an open inquiry and shown once in the shell's one-time secret
  dialog; the link lives only in that dialog's state (the action state is reset to `null`).
- Sessions (`inquiry-sessions:read`, expiry with `:write`) and the timeline (`events:read`, paged
  by its own `events-after` cursor) load with the inquiry; a 403 on either shows the section's
  forbidden panel while the page renders.
- Simulate actions only in the sandbox, only the transitions allowed from the status.

### RED

```
$ pnpm exec vitest run src/app/inquiries src/components/lifecycle --coverage.enabled=false
Error: Failed to resolve import "./fields-editor" from "src/components/lifecycle/fields-editor.test.tsx".
Error: Failed to resolve import "./inquiry-sessions" from …
Error: Failed to resolve import "./inquiry-timeline" from …
Error: Failed to resolve import "./note-editor" from …
Error: Failed to resolve import "./one-time-link-button" from …
Error: Failed to resolve import "./simulate-form" from …
Error: Failed to resolve import "./tag-editor" from …
TypeError: addInquiryTag is not a function
 Test Files  9 failed | 6 passed (15)
      Tests  33 failed | 66 passed (99)
```

Committed as `test(dashboard): require inquiry tags, note, fields, one-time links, sessions,
timeline and sandbox simulation` (148b73c).

### GREEN

The first run had one failure, a real accessibility defect: the sessions table's scroll region
and the section were both named "Sessions". The table caption became "Inquiry sessions" (and the
component test's table name with it).

```
 FAIL  … > lists the inquiry's sessions with inquiry-sessions:read
TestingLibraryElementError: Found multiple elements with the role "region" and name "Sessions"
 Tests  1 failed | 142 passed (143)

$ pnpm exec vitest run src/app/inquiries src/components/lifecycle \
    src/components/verification-card.test.tsx --coverage.enabled=false
 Test Files  16 passed (16)
      Tests  143 passed (143)
```

Committed as `feat(dashboard): inquiry tags, note, fields, one-time links, sessions, timeline and
sandbox simulation` (7f2188e).

## Slice 4: accounts list and account page

List filters in the URL (status, account type, tags, reference id, created range); the page shows
fields labelled by the account type's schema, tags, status (archive, restore), relations in both
directions (an incoming relation is removed on the account it starts from), the account's
inquiries (through the dashboard list with `inquiries:read`, else their ids), consolidation (the
operator types the source accounts and confirms) and typed-confirmation redaction.

### RED

```
$ pnpm exec vitest run src/app/accounts src/components/lifecycle/account-query.test.ts \
    src/components/lifecycle/account-relations.test.tsx \
    src/components/lifecycle/account-inquiries.test.tsx \
    src/components/lifecycle/consolidate-button.test.tsx --coverage.enabled=false
Error: Cannot find module '/src/app/accounts/actions' imported from …/actions.test.ts
Error: Failed to resolve import "./page" from "src/app/accounts/page.test.tsx".
Error: Failed to resolve import "./[id]/loading" from "src/app/accounts/section.test.tsx".
Error: Failed to resolve import "./account-inquiries" from …
Error: Failed to resolve import "./account-query" from …
Error: Failed to resolve import "./account-relations" from …
Error: Failed to resolve import "./consolidate-button" from …
Error: Failed to resolve import "./page" from "src/app/accounts/[id]/page.test.tsx".
 Test Files  8 failed (8)
```

Committed as `test(dashboard): require the accounts list and account page: …` (d178119).

### GREEN

One test assertion was too broad (the relations table also links the account the notice names);
it was scoped to the "Consolidated" notice. A lint finding (a type assertion) became a guard.

```
 FAIL  … > offers restore for an archived account and names the account it was consolidated into
TestingLibraryElementError: Found multiple elements with the role "link" and name "acc_01JB0000000000000000000002"

$ pnpm exec vitest run src/app/accounts src/components/lifecycle --coverage.enabled=false
 Test Files  17 passed (17)
      Tests  113 passed (113)
```

Committed as `feat(dashboard): accounts list and account page with fields, tags, status,
relations, inquiries, consolidate and redact` (b8b4348).

## Slice 5: account types

List with each type's fields, and creation with a JSON fields schema (`accounts:write`), errors
by path. C13 has no update route for account types, so the page says a type cannot be changed once
created (see the report's API gaps).

### RED

```
$ pnpm exec vitest run src/app/account-types src/components/lifecycle/account-type-form.test.tsx
Error: Cannot find module '/src/app/account-types/actions' imported from …
Error: Failed to resolve import "./page" from "src/app/account-types/page.test.tsx".
Error: Failed to resolve import "./layout" from "src/app/account-types/section.test.tsx".
Error: Failed to resolve import "./account-type-form" from …
 Test Files  4 failed (4)
```

Committed as `test(dashboard): require the account types page: …` (35b40e7).

### GREEN

The first run had three test-side failures, fixed in the tests: the contract reports two issues
for an empty name (the test now accepts any containing the name pointer); the JSON editor has its
own status region besides the toast (the test reads the toast by its text); an empty `required`
name blocks submission in jsdom as in a browser (the test types a name first).

```
 Test Files  2 failed | 2 passed (4)
      Tests  3 failed | 16 passed (19)
…
$ pnpm exec vitest run src/app/account-types src/components/lifecycle/account-type-form.test.tsx
 Test Files  4 passed (4)
      Tests  19 passed (19)
```

Committed as `feat(dashboard): account types page: …` (a26edfe).

## Slice 6: templates, versions, the draft editor and publish

`/templates` lists templates (no created-at filter, 2B F029); `/templates/[id]` shows the current
version with its settings, the version history, "New draft" (a draft of the current version's
content, then its editor) and archive or activate; `/templates/[id]/versions/[versionId]` edits a
draft's flow, verification config and settings as JSON (errors by path inside each document,
from the server action's contract validation or the API) and publishes it behind a confirmation
with `inquiry-templates:publish`. Other versions are read-only.

### RED

```
$ pnpm exec vitest run src/app/templates src/components/lifecycle/version-editor.test.tsx
Error: Cannot find module '/src/app/templates/actions' imported from …
Error: Failed to resolve import "./page" from "src/app/templates/page.test.tsx".
Error: Failed to resolve import "./[id]/loading" from "src/app/templates/section.test.tsx".
Error: Failed to resolve import "./version-editor" from …
Error: Failed to resolve import "./page" from "src/app/templates/[id]/page.test.tsx".
Error: Failed to resolve import "./page" from "src/app/templates/[id]/versions/[versionId]/page.test.tsx".
 Test Files  6 failed (6)
```

Committed as `test(dashboard): require the templates pages: …` (d83b293).

### GREEN

The first run found that the version page read the template named in the URL before checking
that the version belongs to it. It now reads the version, checks its template, then reads the
template.

```
 FAIL  … > is not found when the version belongs to another template
Caused by: Error: Unexpected API request: GET /inquiry-templates/itmpl_01JB0000000000000000000009

$ pnpm exec vitest run src/app/templates src/components/lifecycle/version-editor.test.tsx
 Test Files  6 passed (6)
      Tests  38 passed (38)
```

Committed as `feat(dashboard): templates pages: …` (14d035b).

## Whole package

```
$ pnpm exec vitest run --coverage
 Test Files  158 passed (158)
      Tests  1251 passed (1251)
Statements   : 98.08% ( 3180/3242 )
Branches     : 93.56% ( 2110/2255 )
Functions    : 98.32% ( 1118/1137 )
Lines        : 98.09% ( 3090/3150 )
```

The failure paths this run left uncovered (refused tags and ids, the new-draft refusal, the
section loader, typed input helpers) got their tests in `test(dashboard): cover the lifecycle
failure paths …` (73cef1b):

```
$ pnpm exec vitest run src/components/lifecycle --coverage.enabled=false
 Test Files  18 passed (18)
      Tests  92 passed (92)
```

### REFACTOR

The section component the inquiry page defined (`InquirySection`) was used by the account and
template pages too; it became `components/lifecycle/page-section.tsx` (`PageSection`), so those
pages no longer import the inquiry view.

```
$ pnpm exec vitest run src/app/inquiries src/app/accounts src/app/templates \
    src/components/lifecycle --coverage.enabled=false
 Test Files  33 passed (33)
      Tests  253 passed (253)
$ pnpm exec tsc --noEmit | grep -c "error TS"
0
```

Committed as `refactor(dashboard): one page section component …` (53d5d73).

## Full stack: C24 specs 3, 6, 7 and 9 (`e2e/tests/ui-lifecycle.spec.ts`)

The specs were written after the pages, as acceptance tests: each sets up its inquiries,
templates or uploads through the server API with `@openverify/node`, then decides in the browser
as a seeded operator, and checks the outcome through the API.

- 3: the reviewer approves after confirmation; the status, the remaining actions (only Redact)
  and the API's `inquiry.approved` event agree; a viewer in another browser sees the fields and
  the note as "Hidden" and no action, edit, add or remove button.
- 6: a developer drafts version 2 of a fresh template (never the default one, which other specs
  use), sees a refused setting reported in the Settings document by its path, saves the edited
  flow and settings, publishes behind the confirmation, and the API agrees: version 1 superseded,
  version 2 current; an inquiry created before the publication keeps version 1 (7,200-second
  lifetime, flow version 1), one created after pins version 2 (3,600 seconds, one selfie attempt).
- 7: a reviewer consolidates a source account into a target; the source inquiries appear on the
  target's page and belong to it in the API; the source page shows it archived and links the
  target.
- 9: a reviewer redacts an inquiry with uploaded ID images; the confirm button stays disabled
  until "redact" is typed; afterwards the page shows the redacted state, no image and no field
  value, and the dashboard's file route answers 410 for both files (200 before).

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && \
    pnpm --filter @openverify/e2e exec playwright test tests/ui-lifecycle.spec.ts'     # repo root
[e2e +31.0s] stack ready; logs in e2e/.artifacts/logs
Running 4 tests using 1 worker
  ✓  1 … a reviewer approves an inquiry from its page; a viewer sees "Hidden" fields and no actions (3.3s)
  ✓  2 … a developer drafts a template version, edits its JSON and publishes it; a new inquiry pins it (2.9s)
  ✓  3 … a reviewer consolidates two accounts in the dashboard and the inquiries move (2.0s)
  ✓  4 … a reviewer redacts an inquiry in the dashboard; its files then answer 410 and its fields show as redacted (2.2s)
  4 passed (45.6s)
```

The whole suite, for the Phase 1 and Workflow 2A specs this slice could break (the Phase 1 specs
read the inquiry pages: check rows and three loaded images):

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && \
    pnpm --filter @openverify/e2e exec playwright test'
  ✓  30 … an inquiry on the default template completes with every check passed (7.2s)
  ✓  31 … a selfie of a different person fails the face match and the inquiry (5.9s)
  …
  ✘  25 … ui-operators.spec.ts:93 › a developer switches to production in the header, and the banner changes (31.0s)
  31 passed (2.6m)
```

Spec 25 belongs to dashboard-operators and is declared an expected failure (`test.fail`, the
environments API gap); Playwright counts it as passed. After the refactor above, the four specs
ran again on the final code: `4 passed (1.0m)`.
