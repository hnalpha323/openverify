# TDD record: Phase 6, Workflow 6B Stage 1, `dashboard-report-config` (C86)

The report configuration console: the report templates (list, detail, versions, a JSON editor
with the API's validation pointers shown at their place and the resolved configuration beside
it, publish with every publish problem in words) and the read-only watchlist sources page, each
shown only to the principals the API serves, with an RSC payload carrying only what the API
returned, and the full-stack spec `e2e/tests/ui-report-config.spec.ts`. Every value in a fixture
is synthetic. Commands were run from the repository root after `source scripts/env.sh`; outputs
are abbreviated.

## Owned paths

- `apps/dashboard/src/app/report-templates/`, `apps/dashboard/src/app/watchlist-sources/`;
- `apps/dashboard/src/components/report-config/`;
- `apps/dashboard/src/testing/report-config-fixtures.ts`,
  `apps/dashboard/src/testing/routes/report-config.ts`;
- `e2e/tests/ui-report-config.spec.ts`, `e2e/tests/support/ui-report-config.ts`;
- this file.

No dependency was added and no shared dashboard file was edited. `dashboard-reports` added the
two navigation entries (`/report-templates` with `report-templates:read`, `/watchlist-sources`
with `watchlists:read`; `b1d9a0f6`, `093b1727`) and recorded that no registration point is
needed for the mock routes: `testing/routes/report-config.ts` is a free-standing helper over
`routeApi`, as `routes/people.ts` is.

## Slice 1: the watchlist sources page (C72.3, C76, C81.2, C86)

`GET /api/v1/dashboard/watchlist-sources` (`watchlists:read`) read with its frozen schema
(`dashboardWatchlistSourcesSchema`) and shown read-only:

- each source with its kind, whether it is enabled and its state in words: "Fresh", "Stale",
  "Not configured", "Never checked", "Needs re-key", "Disabled", "Re-screen pending", and a
  sandbox list as "Sandbox list, never stale" whatever the `stale` flag says (V03); each state
  says what a report selecting the source gets (`list_unavailable`, `list_stale`,
  `matcher_data_unavailable`), so the page explains why a report is not screened (C69.4);
- the last error in words, the last applied sync per source (id, applied and publication times,
  `origin` with an import never cited as the publisher's, SHA-256, and the override of that sync
  when it is among the recent syncs), the recent syncs with each outcome, override and actor in
  words;
- the templates whose pinned lists hold a disabled source or leave out an enabled one (C76.4),
  linked to their page only for a principal holding `report-templates:read`;
- the GDELT line: the install's scheduled adverse-media runs per day against the 17,280 requests
  the budget allows, as a share, with a text badge above 80% (C81.2, V09);
- every source's attribution line and the terms note of a source that ships disabled (C76.7).

The words tests read every key from the contracts' own lists first (`WATCHLIST_SYNC_OUTCOMES`,
`WATCHLIST_SOURCE_ERROR_CODES`, `WATCHLIST_SYNC_OVERRIDES`, `WATCHLIST_SYNC_ACTORS`,
`WATCHLIST_ORIGINS`), so a code added there without words fails them.

**RED** (stubs: empty word tables, `sourceStates` answering `[]`, the view and the page rendering
nothing; the test file typechecks)

```
$ (cd apps/dashboard && pnpm exec tsc --noEmit)        # no output
$ pnpm --filter @openverify/dashboard exec vitest run src/components/report-config src/app/watchlist-sources --coverage.enabled=false
 × words every sync outcome, with a tone and what it means, refusals as refusals
 × reads a source checked within its limit and keyed by this version as fresh
 × labels a sandbox list and never calls it stale (V03), whatever the flag says
 × warns above 80% only
 × has one region per part, each named by its heading, and no control
 × shows each source with its kind, whether it is enabled, its state in words and its last error
 × names the templates whose pinned lists differ, linking them for a reader of templates (C76.4)
 × carries only what the API returned in its RSC payload, from the one sources route
 × shows the forbidden panel without watchlists:read, without reading the sources
 …
AssertionError: expected [] to deeply equal [ 'fresh' ]
AssertionError: expected [] to deeply equal [ 'sandbox' ]
AssertionError: expected [] to deeply equal [ 'source_not_configured', …(12) ]
TestingLibraryElementError: Unable to find an accessible element with the role "heading" and name "Watchlist sources"
 Failed Tests 36
```

One test passed in RED: "gives every state words and a tone" loops over the states, of which the
stub gave none. It is a property check beside the per-state tests, which all failed.

**GREEN** (`source-words.ts`, `watchlist-sources-view.tsx`, the page with its API call, loading
and error states)

The first run found my own RED expectation wrong: 15,000 / 17,280 is 86.81%, which the page
showed, not the 87% the test asked for. The test now asks for 86.81%; nothing else changed.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/report-config src/app/watchlist-sources --coverage.enabled=false
 × warns in words above 80% of the GDELT budget
Expected element to have text content: 87%
Received: … against the 17,280 GDELT requests a day the budget allows (one every 5 seconds): 86.81% of it.Above 80% of the budget…
 Tests  1 failed | 36 passed (37)
$ pnpm --filter @openverify/dashboard exec vitest run src/components/report-config src/app/watchlist-sources --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  37 passed (37)
$ (cd apps/dashboard && pnpm exec tsc --noEmit && pnpm exec eslint src/components/report-config src/app/watchlist-sources src/testing/report-config-fixtures.ts src/testing/routes/report-config.ts)
                                                        # no output
```

## Slice 2: the configuration in words, the resolved configuration and the draft editor (C71.2, C72.4, C86)

- **Words** (`config-words.ts`): every key of every type (read from core's
  `REPORT_CONFIG_DEFAULTS`) with its label and what it does; each value in words (a recurrence,
  a preset with its minimum from `NAME_MATCHING_PRESET_MINIMUMS`, the filter modes, lists);
  an API pointer inside the configuration in words (`/search-lists/1` reads "Lists searched,
  item 2 (openverify-sandbox)"); and every publish problem in words: `watchlist_sources_empty`,
  `watchlist_source_unknown`, `watchlist_source_not_allowed` (read from the contracts' problem
  codes), the list age below a source's refresh interval, and a version that is no longer a
  draft. Any other problem keeps the API's own words.
- **What the editor starts from** (`explicitConfig`): the version's resolved configuration less
  the keys at their default, keeping the pinned `search-lists`. The API serves only the resolved
  configuration, so "at its default" is decided by value; leaving such a key out of a save
  changes nothing today, and the key then follows its default, as C71.2 says a version should.
- **Resolved configuration** (`resolved-config.tsx`): every resolved key in words beside its
  key, its value and its default, each default marked "Provisional" with its source (C71.2).
- **Editor** (`config-editor.tsx`): the shared `JsonEditor` with the API's 422 pointers inside
  `/data/attributes/config` shown under it, each labelled in words; anything else in the alert
  below; a refusal keeps the text as typed.

**RED** (stubs; one test passes on the stub's `{}`: a type left at its defaults sets nothing)

```
$ (cd apps/dashboard && pnpm exec tsc --noEmit)        # no output
$ pnpm --filter @openverify/dashboard exec vitest run src/components/report-config/config-words.test.ts src/components/report-config/resolved-config.test.tsx src/components/report-config/config-editor.test.tsx --coverage.enabled=false
 × words every key of every type, with what it does
 × words name-matching {"preset":"tolerant"} as Tolerant, minimum score 0.8
 × leaves out the keys at their default and keeps the pinned lists and the rest
 × labels /search-lists/1 as Lists searched, item 2 (openverify-sandbox)
 × says an empty list would screen nothing, so it is never published
 × says a sandbox-only list is never screened in production
 × lists every resolved key in words beside its key, value and default
 × shows each error of the API at its place in the configuration, in words, and the rest below
 …
 Test Files  3 failed (3)
      Tests  48 failed | 1 passed (49)
```

**GREEN** (`config-words.ts`, `resolved-config.tsx`, `config-editor.tsx`; lint asked for a typed
recurrence value and for the tests to drop two type assertions, which changed no expectation)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/report-config --coverage.enabled=false
 Test Files  5 passed (5)
      Tests  77 passed (77)
$ (cd apps/dashboard && pnpm exec tsc --noEmit && pnpm exec eslint src/components/report-config)
                                                        # no output
```

## Slice 3: the report template pages and their actions (C71, C72.4, C86)

- **`/report-templates`** (`report-templates:read`): the environment's templates, newest first,
  with their type, status and current version; a GET filter form for the type and the status
  (the API's `filter[report-type]` and `filter[status]`), kept in the URL and in the next-page
  link; a value the API does not know is not sent.
- **`/report-templates/:id`**: the template, its type with its tiers and stage
  (`REPORT_REGISTRY`), its current version's resolved configuration, its versions with the
  cursor; with `report-templates:write`, "New draft" (copying what the current version sets) and
  "Archive" or "Activate".
- **`/report-templates/:id/versions/:versionId`**: a draft with `report-templates:write` is edited
  as JSON beside its saved resolved configuration; "Publish" with `report-templates:publish`, its
  dialog saying what publishing does, what the API checks first and that it uses the saved
  draft; every other version, or a principal without write, sees the resolved configuration
  only. A version of another template is not found.
- **Actions** (`actions.ts`): `createReportDraft`, `updateReportDraft` (the configuration typed as
  JSON, refused at `/data/attributes/config` when it is not a JSON object, the API's 422 pointers
  passed on), `publishReportDraft` (a 422 or 409 answered in words, each refused source named by
  the id the saved draft holds at that place, read back once on a refusal; the words stand when
  that read fails) and `updateReportTemplateStatus`. Each checks its permission before calling
  the API.

**RED** (stubs: pages rendering nothing, actions answering "Not built yet"; two tests pass on the
stubs' emptiness: "is read-only for a principal without report-templates:write" finds no
control, and the layout is the one-line re-export every section uses)

```
$ (cd apps/dashboard && pnpm exec tsc --noEmit)        # no output
$ pnpm --filter @openverify/dashboard exec vitest run src/app/report-templates src/components/report-config/new-draft-button.test.tsx --coverage.enabled=false
 × drafts what the current version sets as a new version and opens its editor
 × says in words that an empty list is never published
 × names a refused source by the id the saved draft holds at that place
 × filters by type and status through the API, keeping the filters in the next page link
 × shows the template, its type with its tiers and stage, and its current version resolved
 × edits a draft as JSON, starting from what it sets, with the resolved configuration beside it
 × publishes a draft with report-templates:publish, saying what publishing does and checks
 × carries only what the API returned in its RSC payload
 …
AssertionError: expected { ok: false, …(1) } to match object { ok: false, …(1) }
Error: Expected notFound(), but the call completed
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Publish"
 Test Files  6 failed (6)
      Tests  50 failed | 2 passed (52)
```

**GREEN** (the three pages, their loading and error states, `actions.ts`,
`new-draft-button.tsx`, `report-template-filters.tsx`)

The contract types a version's `config` per report type, a union TypeScript reads as `unknown`,
so `config-words.ts` gained `configRecord` (a served configuration as a record, anything else as
empty) with a test of its own in this commit; it decides nothing a RED test checks. Lint asked
the detail page test to drop a type assertion, which changed no expectation.

```
$ pnpm --filter @openverify/dashboard exec vitest run src/app/report-templates src/components/report-config src/app/watchlist-sources --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  139 passed (139)
$ (cd apps/dashboard && pnpm exec eslint src/app/report-templates src/app/watchlist-sources src/components/report-config src/testing/report-config-fixtures.ts src/testing/routes/report-config.ts)
                                                        # no output
$ (cd apps/dashboard && pnpm exec tsc --noEmit) | grep -E "report-templates|report-config|watchlist-sources"
                                                        # none of mine
```

At this point `tsc` reported one error outside my paths, in `src/lib/report-query.ts`, an
uncommitted file `dashboard-reports` was writing at the time.

## Slice 4: the full-stack spec `e2e/tests/ui-report-config.spec.ts` (C86, C89)

Two tests, budget 90 s (stated in the header line), each making its own data or reading what
`seed:dev` made, so it depends on no other spec; the template it creates is archived in
`finally`, and no setting is changed. Helpers are in `e2e/tests/support/ui-report-config.ts`
(the developer and the viewer signed in once for the file, a page with a kept session, the
server API as the signed-in operator, the editor and table parts).

- **A developer** creates a watchlist template through the API (recurring every 30 days; its
  lists left out, so the API pins the environment's enabled sources), opens it from the filtered
  list, reads its type (Watchlist, Beta) and version 1's resolved configuration, drafts version
  2 (the editor starts from the recurrence and the pinned lists), saves `max-list-age-hours: 0`
  and reads the API's pointer under the editor as "Maximum list age", saves an empty list (the
  resolved table says "None") and has its publish refused in words ("The draft selects no
  list"), then saves without a list (the resolved table pins `ofac-sdn` among the enabled
  sources) and publishes. The API then serves version 2 as current, with what the console
  showed.
- **A viewer** opens the sources page from the navigation and finds it agreeing with
  `GET /dashboard/watchlist-sources` read with the same session: a row per source, the sandbox
  list labelled and never stale (or never checked, as the API says), the UN list disabled as the
  API says, the GDELT budget figure, a link per template warning, the sandbox list's attribution
  line; then the seeded `Default watchlist` with no template actions and its version with no
  editor and no publish.

The spec was written after slices 1 to 3, as the acceptance spec of the pages they built test
first; it passed on its first run, so it has no RED step of its own.

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-report-config.spec.ts'
[e2e +55.4s] stack ready; logs in e2e/.artifacts/logs
  ✓  1 … a developer edits a draft as JSON beside its resolved configuration, meets the 422 pointer and an empty list refused in words, then publishes (C71, C72.4, C86) (3.3s)
  ✓  2 … a viewer reads the watchlist sources as the API reports them, and the seeded template read-only (C72.3, C76, C81.2, C86) (2.9s)
  2 passed (1.1m)
$ (cd e2e && pnpm exec tsc --noEmit && pnpm exec eslint tests/ui-report-config.spec.ts tests/support/ui-report-config.ts)
                                                        # no output
```

## Slice 5: a sandbox list in a production environment (P13, C76.6, C86)

Review of slice 1: the summary counted a sandbox list as "Screenable now" in a production
environment, where it is never screened (the publish rules refuse it and retrieval leaves it out
in SQL). The session knows its environment's kind, so the page passes it on: in production a
sandbox list reads "Sandbox list, not screened here" and is not counted as screenable.

**RED** (the kind is taken and ignored; signatures only)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/report-config/source-words.test.ts src/components/report-config/watchlist-sources-view.test.tsx src/app/watchlist-sources --coverage.enabled=false
 × says a sandbox list is never screened in a production environment (P13, C76.6)
 × reads the sandbox lists for the session’s environment: not screened in production
 × in a production environment, counts no sandbox list as screenable and says it is not screened there
AssertionError: expected { key: 'sandbox', …(3) } to match object { key: 'sandbox', …(1) }
 Tests  3 failed | 37 passed (40)
```

**GREEN** (`sourceStates(source, environmentKind)`, the view's `environmentKind`, the page passing
`session.environment.kind`)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/report-config src/app/watchlist-sources src/app/report-templates --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  142 passed (142)
$ (cd apps/dashboard && pnpm exec tsc --noEmit && pnpm exec eslint src/components/report-config src/app/watchlist-sources)
                                                        # no output
```

## Slice 6: a save's errors name the submitted list items (C71.2, C86)

Review of slice 2: a refused save labelled a `search-lists` item with the id the saved draft
holds at that index, while the error is about the text just submitted, so it could name the
wrong source. The editor now reads the ids from the submitted text (a publish still reads the
saved draft, which is what it publishes).

**RED**

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/report-config/config-editor.test.tsx --coverage.enabled=false
 × names a list item by the id the submitted text holds there, not the saved one
Expected element to have text content: Lists searched, item 2 (Synthetic_Typo)
Received: Lists searched, item 2/search-lists/1: must be a source id such as ofac-sdn
 Tests  1 failed | 3 passed (4)
```

**GREEN** (`config-editor.tsx` reads the ids from the submitted text, each item keeping its index
and one that is not a string named as its JSON; the `searchLists` prop it no longer needs is gone
from the editor, its test render and the version page)

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/report-config src/app/report-templates src/app/watchlist-sources --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  143 passed (143)
$ (cd apps/dashboard && pnpm exec tsc --noEmit && pnpm exec eslint src/components/report-config src/app/report-templates)
                                                        # no output
```

## Final gates (foreground)

```
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully                         # tsc: no output
$ pnpm --filter @openverify/dashboard test
 Test Files  256 passed (256)
      Tests  3765 passed (3765)
Statements   : 98.48% ( 6109/6203 )
Branches     : 93.03% ( 4732/5086 )
Functions    : 98.77% ( 2262/2290 )
Lines        : 98.48% ( 5896/5987 )
$ (cd apps/dashboard && pnpm exec vitest run src/components/report-config src/app/report-templates src/app/watchlist-sources --coverage.enabled=true --coverage.include=<my three folders>)
 Tests  143 passed (143)
Statements 98.94% (374/378), Branches 90.06% (272/302), Functions 99.31% (145/146), Lines 98.9% (360/364)
$ pnpm typecheck
 Tasks:    14 successful, 14 total
$ pnpm format:check
All matched files use Prettier code style!
$ pnpm --filter @openverify/dashboard lint            # and pnpm lint
✖ 16 problems (16 errors, 0 warnings)
  apps/dashboard/src/lib/report-type-words.test.ts, apps/dashboard/src/lib/report-words.test.ts
```

The lint errors are all `no-unnecessary-condition` in two test files of `dashboard-reports`,
committed as RED steps (`48e80b48`, `da2e5417`) while this stage ran; every file of mine lints
clean (`pnpm exec eslint` over my paths: no output). An earlier run of the dashboard test script
failed only on `dashboard-reports`' then uncommitted RED `app/reports/actions.test.ts` (25
tests); the run above, once it was green, passed whole.

`pnpm e2e`, run as the four calls the workflow prescribes, each under the e2e lock:

```
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e
  69 passed (23.5s)
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test --shard=1/3'
  31 passed (2.7m)
$ … --shard=2/3
  31 passed (5.2m)
$ … --shard=3/3
  ✓ tests/ui-report-config.spec.ts:45:1 › a developer edits a draft as JSON … (3.6s)
  ✓ tests/ui-report-config.spec.ts:134:1 › a viewer reads the watchlist sources … (3.0s)
  26 passed (4.7m)
```

88 full-stack tests in all (the 86 of Workflow 6A and this spec's two).
