# TDD evidence: Workflow 6C, the console and the test hygiene (`console-tests-6c`)

- **Slice owner:** `console-tests-6c`, Workflow 6C Stage 2, beside `calibration-6c`.
- **Date:** 2026-10-28.
- **Input:** the plan's "Owner decisions after Workflow 6B": decision 6 in words, 9 in words, 15 (K6A-5, P5-6), 17, 18 in the console, 24 and 26, and the console words the Stage 1 reports ask for.
- **Paths owned:** `apps/dashboard/`, `e2e/tests/ui-*.spec.ts` and `e2e/tests/support/ui*.ts`, `packages/db/src/testing.ts`, the Phase 1-5 Testcontainers test files that did not use `POSTGRES_TEST_COMMAND`, the `packages/db` test files whose newest-first assertions rely on rows written back to back, and this file.

Each slice follows the same cycle:
1. A stub (`chore`), only when a test needs a name that does not exist yet, so the RED commit type-checks.
2. The test, run to see it fail for the intended reason (RED, `test` commit). Each RED commit compiles, type-checks and lints.
3. The smallest change that passes it (GREEN, `feat`, `fix` or `docs` commit).

All commands ran after `source scripts/env.sh`. "vitest (pkg) …" stands for `pnpm --filter @openverify/<pkg> exec vitest run <files> --coverage.enabled=false`. Output is trimmed to the lines that matter. Every name, number and value in these tests is synthetic.

## Slice 1: the sources page (owner decisions 17 and 18, R004)

`api-reports-6c` served the three additive members of decision 17 (`name` and `report-type` on each template warning, `media.attribution`, `matcher: { loaded, keys-version }`) and the media figures of decision 18 (the asking environment's own scheduled runs per day, and `install-above-warn-share`), and moved the fixture builder and `mediaBudget` to the new shape. This slice finishes the visible part.

Stub (`7490541c`): `sourceStates(source, environmentKind, options)` takes `{ matcherLoaded }` and throws as not built when it is `false`, so the unit tests type-check.

Tests:
- `components/report-config/source-words.test.ts`: without the API's matcher data, a checked source reads `keys_unknown`, "The API has no variant groups" (tone `attention`, its detail says it is not a re-key and names `build:variant-groups`), never "Needs re-key"; freshness and staleness, which need no matcher data, are still said; a disabled, unconfigured or never checked source gains nothing. `source-words.ts` no longer exports a GDELT line of its own.
- `components/report-config/watchlist-sources-view.test.tsx`: `matcher.loaded: false` reads "The API has no variant groups" in the source rows and in a new "Matcher data" summary term, and "Screenable now" reads "Not known"; loaded, the summary gives the keys version; a sandbox list keyed by another version is not screenable; each warned template shows by name (linked for `report-templates:read`) with its id and its type ("Watchlist", "Business watchlist"); the media line says the runs are this environment's own and never says "across the install"; with the install flag set and a small own share, "The install is above 80% of the budget" shows, with what that means; the citation is the API's `media.attribution`, and the console's own line is gone.
- `app/watchlist-sources/page.test.tsx`, the RSC payload test: the payload holds the warned template's name, the API's citation, the keys version and the environment's own sentence, and neither the console's old GDELT line nor "across the install".

```text
RED   $ vitest (dashboard) src/components/report-config/source-words.test.ts src/components/report-config/watchlist-sources-view.test.tsx src/app/watchlist-sources/page.test.tsx
     × says the API has no variant groups instead of asking for a re-key
Error: sourceStates without the matcher data is not built yet (owner decision 17)
     × has no attribution line of its own: the page shows the API’s media.attribution (owner decision 17)
AssertionError: expected [ 'SYNC_OUTCOME_WORDS', …(9) ] to not include 'GDELT_ATTRIBUTION'
     × says the API has no variant groups instead of asking for a re-key, and that it cannot say what screens now (owner decision 17)
AssertionError: expected <span …(3)></span> to be null
     × gives the API’s matcher keys version when it holds the variant groups (owner decision 17)
TestingLibraryElementError: Unable to find an element with the text: Matcher data.
     × never counts a source keyed by another matcher version as screenable, a sandbox list included
     × names the templates whose pinned lists differ, linking them for a reader of templates (C76.4)
TestingLibraryElementError: Unable to find an accessible element with the role "rowheader" and name `/Synthetic sanctions screening/`
     × warns in words above 80% of the GDELT budget
TestingLibraryElementError: Unable to find an element with the text: The install is above 80% of the budget.
     × shows the GDELT citation the API serves, not a line of the console’s own (owner decision 17)
     × carries only what the API returned in its RSC payload, from the one sources route
AssertionError: expected '{"className":"mx-auto flex w-full fle…' to contain 'Synthetic sanctions screening'
      Tests  16 failed | 36 passed (52)
      $ pnpm --filter @openverify/dashboard exec tsc --noEmit -p tsconfig.json   (no output)
      $ pnpm --filter @openverify/dashboard exec eslint src/app/watchlist-sources src/components/report-config src/testing/report-config-fixtures.ts   (no output)
GREEN $ vitest (dashboard) src/components/report-config src/app/watchlist-sources src/app/report-templates src/testing
 Test Files  15 passed (15)
      Tests  185 passed (185)
```

RED is `51402151`, GREEN `85992756`. Before GREEN, the expected sentence of my own new media test (and the RSC payload line) was corrected from "This environment schedules 12.5 adverse-media runs a day" to "12.5 scheduled adverse-media runs a day in this environment", so the existing test, which pins "12.5 scheduled adverse-media runs a day", stays unchanged.

Change (`85992756`):
- `sourceStates` reads `matcherLoaded`: without the data, a checked source gets `keys_unknown` instead of `needs_rekey`, and "Fresh" when its check is within its limit.
- "Screenable now" counts a fresh source, or a sandbox list in a sandbox environment, only when it is not keyed by another version. Before, a sandbox list that needed a re-key counted as screenable although its reports error `matcher_data_unavailable`. Without the matcher data it reads "Not known: the API has no variant groups".
- A "Matcher data" summary term: "Loaded" with the keys version, or "The API has no variant groups".
- The warnings table: the template's name (a link for a reader of templates) above its id, and a "Type" column.
- The media line: "N scheduled adverse-media runs a day in this environment: S of the install's GDELT budget of 17,280 requests a day (one every 5 seconds), which every environment of the install shares." With the API's flag: the badge "The install is above 80% of the budget" and "Across every environment of the install, scheduled adverse-media runs take more than 80% of the GDELT budget: …". The citation is `media.attribution`; `GDELT_ATTRIBUTION` is removed.

Existing tests changed with the plan (rule 10): in `watchlist-sources-view.test.tsx`, the template warning row is found by the template's name instead of its id (decision 17 shows the name), and the warning badge reads "The install is above 80% of the budget" instead of "Above 80% of the budget" (decision 18 says that the install is above it). In `source-words.test.ts`, the test of the console's own GDELT line is replaced by one that the line is gone (decision 17).

## Slice 2: what complete coverage does not promise (owner decision 6)

Decision 6 adds no coverage limit. The console's coverage words say what complete coverage does not promise, in the sentence `matcher-6c` proposed in its followups: "Complete coverage does not promise romanisations outside the variant groups and ICAO's tables, unknown spellings, or typos beyond the budget." (The console writes the apostrophe as ’, as its other strings do.)

Stub (`f0bacbb6`): `COMPLETE_COVERAGE_WORDS` (empty) and `NAME_SCREENING_TYPES` (empty) in `lib/report-words.ts`.

Tests:
- `lib/report-words.test.ts`: the sentence, word for word; the types it applies to (`watchlist`, `business-watchlist`, `politically-exposed-person`: a crypto address is compared exactly, and media relevance has its own limits); `docs/reports/watchlist.md` ("What a result means") says each of the three parts, and the business-watchlist and PEP pages point to it.
- `app/reports/[id]/page.test.tsx`: a watchlist report's "Coverage" term holds the sentence beside "Complete"; a crypto address report's complete coverage does not.

```text
RED   $ vitest (dashboard) src/lib/report-words.test.ts "src/app/reports/[id]/page.test.tsx"
     × says it in the sentence the matcher proposed
AssertionError: expected '' to be 'Complete coverage does not promise ro…' // Object.is equality
     × says it of the types that compare names: watchlist, business watchlist and PEP
AssertionError: expected [] to deeply equal [ 'watchlist', …(2) ]
     × says beside complete coverage what it does not promise, for the types that compare names (owner decision 6)
      Tests  3 failed | 104 passed (107)
GREEN $ vitest (dashboard) src/lib src/app/reports src/components/reports
 Test Files  89 passed (89)
      Tests  2085 passed (2085)
```

The docs test and the crypto test passed at RED: they are guards (the docs already said it; the crypto report never showed the sentence). RED `86766f62`, GREEN `dee45ec9`: the sentence and the set, and `ReportSummary`'s coverage shows the sentence under "Complete" for those types.

## Slice 3: list memberships and a relative's class in words (owner decision 9)

`ingestion-6c` added `list_memberships` and `relative_of_class` to the record, and `api-reports-6c` served them as `list-memberships` on a sanctions or crypto entity and `relative-of-class` on a PEP relative. The console words them, so an entry listed only on a non-blocking list shows with that list and never reads as an SDN-level block.

Tests (`components/reports/report-results.test.tsx`; no stub was needed, the tests go through the rendered results):
- the business-watchlist golden entry shows "Other lists": "Synthetic Sectoral List (programme SYNTHETIC-SECTORAL)", and the section says what "Other lists" means and that such a listing alone is not an SDN-level block;
- memberships without a programme read "(no programme tied to this list)", and nothing in the row names the SDN List;
- an entry on no other list reads "None";
- a crypto entry with a membership shows "Other lists of <entry>" and the note;
- a PEP relative shows "Class of the related PEP": "Class 2: the most senior class of the PEPs this relative relates to"; a relative without the member reads "Not recorded: the list was synced before relatives carried their class"; a holder has no such term.

```text
RED   $ vitest (dashboard) src/components/reports/report-results.test.tsx
     × names the other lists an entry is on, with each one’s programme, never as an SDN-level block (owner decision 9)
     × shows an entry listed only on a non-blocking list with that list, and a membership without a programme as such (owner decision 9)
TestingLibraryElementError: Unable to find an element with the text: Synthetic Sectoral List (no programme tied to this list), Synthetic Menu-Based List (no programme tied to this list).
     × says None where an entry is on no other list
     × names each other list the entry is on beside its addresses
TestingLibraryElementError: Unable to find an element with the text: Other lists of Sandbox Ledger Services, which matches selector 'dt'.
     × says the class of the PEP a relative relates to, from the relative’s own record (owner decision 9)
TestingLibraryElementError: Unable to find an element with the text: Class of the related PEP, which matches selector 'dt'.
     × says a relative’s class is not recorded when the record does not carry it, and gives a holder none (owner decision 9)
      Tests  6 failed | 13 passed (19)
GREEN $ vitest (dashboard) src/components/reports src/lib src/app/reports
 Test Files  89 passed (89)
      Tests  2091 passed (2091)
```

RED `880dfaf1`, GREEN `b8a700f7`: `listMembershipText`, `LIST_MEMBERSHIPS_NOTE` and `relativeClassText` in `lib/report-field-words.ts`; an "Other lists" column in the matched-list entries, the note under the lists when an entry carries memberships, the same for crypto entries, and the relative's class term.

## Slice 4: each query input takes its member's own length limit (owner decision 24, R014)

Every typed query input had `maxLength={REPORT_QUERY_LIMITS.name}` (300), so a business website, whose contract allows 500 characters, was cut at 300 in the browser, and a postal code (20) or a city (100) took 300.

Tests (`components/reports/create-report-form.test.tsx`; the helper `show` now takes any report type):
- a 500-character website (`https://` + 480 letters + `.example/abc`) is pasted whole into a field whose `maxlength` is 500, and the action receives it whole;
- eleven fields carry their member's own `max`: company name 300, registration number 100, aircraft serial 50, identification number 100, an additional name's part 300, crypto address 256, chain 64, email address 254, addressee 200, city 100, postal code 20;
- four fields whose member states no length (LEI, IMO number, E.164 phone number, date of birth: a pattern decides each) carry no `maxlength`; the API checks every value.

```text
RED   $ vitest (dashboard) src/components/reports/create-report-form.test.tsx
     × takes a 500-character business website whole, the website member’s own limit (owner decision 24, R014)
Error: expect(element).toHaveAttribute("maxlength", "500") // element.getAttribute("maxlength") === "500"
     × gives the business-watchlist field Registration number the length limit its contract member states, 100 (owner decision 24)
     × … (8 more fields)
     × sets no length limit on the business-watchlist field LEI, whose contract member states none (its pattern decides; the API checks it)
Error: expect(element).not.toHaveAttribute("maxlength") // element.hasAttribute("maxlength")
      Tests  14 failed | 5 passed (19)
GREEN $ vitest (dashboard) src/components/reports src/app/reports
 Test Files  13 passed (13)
      Tests  173 passed (173)
```

The company name and the additional name part passed at RED, since their limit is the name limit. RED `5da01813`, GREEN `7ff7ae67`: `queryMaxLength(type, path)` (`lib/report-query-limits.ts`) walks the contract's `REPORT_QUERY_SCHEMAS[type]` through optional, nullable and array wrappers to the member's string schema and returns its `maxLength`, or `undefined`; each `QueryField` gets its path (`[member]`, or `['additional-names', part]`).

## Slice 5: the console words the Stage 1 reports asked for

- **The redaction actor in the history** (owner decision 12). `api-reports-6c` writes one `redact` action per redaction with its actor: `api_key` or `user` for `DELETE /reports/:id`, `system` for the inquiry and account cascades and retention.
- **The review and dismissal refusal when PII is not visible** (owner decision 16). The API now refuses both with 403 `forbidden` naming `pii:view`. The console already required `pii:view`, but said only "Your role does not allow this", and showed the API's own detail on a 403.
- **The phone reasons** `prepaid`, `payphone` and `other_line_type` were worded by `api-reports-6c` in Stage 1 (`c19d96d2`), with `general_delivery`; nothing was left to do.

Stub (`1dbc381e`): `REVIEW_NEEDS_PII_VIEW` in `lib/report-problem-words.ts`, title only.

Tests:
- `components/reports/report-history.test.tsx`: three `redact` actions read "API key key_…", "User usr_…" and "System: the redaction of its inquiry or account, or the report retention setting".
- `app/reports/actions.test.ts`: a dismissal or review by an operator without `pii:view` answers `REVIEW_NEEDS_PII_VIEW` ("You do not have access"; "Reviewing or dismissing a match needs pii:view as well as reports:review: without it the matches are hidden from you, and nobody decides on evidence they cannot see. Ask an administrator for a role with both."); a 403 from the API on either says the same, keeping its status and request id, and refreshes nothing.

```text
RED   $ vitest (dashboard) src/app/reports/actions.test.ts src/components/reports/report-history.test.tsx
     × says why in words when pii:view is missing: the matches are hidden from the operator (owner decision 16)
AssertionError: expected { ok: false, problem: { …(2) } } to deeply equal { ok: false, …(1) }
     × says the same when the API refuses the dismissal for pii:view, keeping its request id (owner decision 16)
AssertionError: expected { ok: false, problem: { …(4) } } to deeply equal { ok: false, problem: { …(3) } }
     × says why in words when the review is refused for pii:view, by the console or by the API (owner decision 16)
     × names who redacted a report: the API key or user, or the system for a cascade or retention (owner decision 12)
Error: expect(element).toHaveTextContent()
      Tests  4 failed | 46 passed (50)
GREEN $ vitest (dashboard) src/app/reports src/components/reports src/lib
 Test Files  89 passed (89)
      Tests  2111 passed (2111)
```

RED `727f2477`, GREEN `a44cb413`. The history's "By" names the actor's kind before its id, and a system redaction says what it was (`REDACTED_BY_SYSTEM`, `lib/report-words.ts`). The dismiss and review actions go through `reviewAction` (`app/reports/actions.ts`), which maps the console's `FORBIDDEN_PROBLEM` and an API 403 to `REVIEW_NEEDS_PII_VIEW`. The mapping lives in the server actions, so `lib/report-problem-words.ts` stays free of the server-only `lib/api/errors.ts`. The existing tests that expect the title "You do not have access" are unchanged.

## Slice 6: the README rows of the records evidence views (owner decision 26, P5-8)

The README described the people types' evidence views in a table and left the records views (database, AAMVA, business registry, business website) to their files' headers. Each now has a row, as the people types do: what the view shows, and what a pass means.

Test (`src/readme-records.test.ts`, new): the README has a "**The records types** (`dashboard-records`):" table with the people table's header and one row per view, in order; each row describes its evidence and names its view's file; every sentence of a row's "What a pass means" is part of that view's own pass line (`DATABASE_PASS_MEANING`, `AAMVA_PASS_MEANING`, `DATABASE_BUSINESS_PASS_MEANING`, `BUSINESS_WEBSITE_PASS_MEANING`), and each says what the pass does not show.

```text
RED   $ vitest (dashboard) src/readme-records.test.ts
     × has one row per records view, in a table headed as the people types are
AssertionError: the records table heading: expected -1 to be greater than 0
     × describes the Database evidence and names its view, components/evidence/database.tsx
Error: README.md has no "**The records types** (`dashboard-records`):" table
     × … (8 more)
      Tests  10 failed (10)
GREEN $ vitest (dashboard) src/readme-records.test.ts
      Tests  10 passed (10)
```

RED `e633a20f`, GREEN `f2c3956e` (the four rows; the documents views still describe themselves in their headers).

## Slice 7: every Testcontainers Postgres starts with `POSTGRES_TEST_COMMAND` (owner decision 15: K6A-5, P18)

Test (`packages/db/src/testing.test.ts`): `POSTGRES_TEST_COMMAND` is the C73.8 command; and every `new PostgreSqlContainer(…)` under `apps/*/{src,scripts}` and `packages/*/{src,scripts}` carries `.withCommand([...POSTGRES_TEST_COMMAND])` before its `.start()`, with one exemption, the log test's control in `postgres-logging.integration.test.ts` (6B fix-api amendment 15, R003), a Postgres started plainly on purpose to show that a logged parameter is seen. The search string is built from parts, so the test file does not find itself.

```text
RED   $ vitest (db) src/testing.test.ts -t "POSTGRES_TEST_COMMAND"
     × starts every Testcontainers Postgres of the repository, so none logs a bind parameter
AssertionError: expected [ …(32) ] to deeply equal [ Array(1) ]
+   "apps/api/src/api.integration.test.ts",
+   … (31 files: 20 in apps/api, 11 in packages/db)
      Tests  1 failed | 1 passed | 53 skipped (55)
GREEN $ vitest (db) src/testing.test.ts -t "POSTGRES_TEST_COMMAND"
      Tests  2 passed | 53 skipped (55)
      $ cat /proc/loadavg
5.17 4.21 4.77 2/1534 2976099
      $ pnpm --filter @openverify/db exec vitest run --config vitest.integration.config.ts src/db.integration.test.ts src/migration-v2.integration.test.ts
 Test Files  2 passed (2)
      Tests  13 passed (13)
      $ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/services/locks.integration.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

RED `b5611705`, GREEN `2bf9f551`. Each of the 31 files gains the import (from `@openverify/db/testing` in `apps/api`, `./testing.js` in `packages/db`) and `.withCommand([...POSTGRES_TEST_COMMAND])` on its container, nothing else: `git diff -U0` shows only the import lines and the container chains (re-wrapped by Prettier). No assertion changed. `testing.ts`'s comment now says every container uses it.

## Slice 8: ordered rows stamp `created_at` (owner decision 15: P5-6)

**How the files were found.** Not by grep alone: the db unit suite ran once, uncommitted, under a scratch Vitest config outside the repository (`<scratchpad>/backwards.config.mts`) whose setup file made every `Date.now()` reading a millisecond earlier during each test body, as PGlite's `now()` follows it. 31 tests of 23 files failed:
- 28 tests of 20 Phase 1-5 files whose newest-first (or oldest-first, or "latest") assertions read the order of rows written back to back from `now()`: `accounts` (4), `api-keys-v2`, `api-logs` (2), `audit-logs-v2`, `crypto-challenges`, `events`, `files-selfie-capture`, `government-id-lookups` (3), `inquiries-v2`, `inquiries`, `inquiry-sessions-v2`, `inquiry-templates`, `operators` (2), `selfie-captures`, `template-versions`, `trust-anchors`, `users`, `verifications`, `webhooks-v2` (2), `webhooks`. Even `webhooks-v2.test.ts`, the plan's model, had two unstamped tests;
- two trigger tests (`constraints.test.ts`, `constraints-v2.test.ts`) that assert `updated_at` moves forward on an update: a different class (they need the clock to move forward, not an order), left alone, see the followups;
- one Phase 6 test (`report-repositories.test.ts`), outside the Phase 1-5 files this agent owns: a followup.

```text
      $ cat /proc/loadavg     (before, after; under the e2e lock)
3.62 4.26 4.72 2/1467 2980509
10.20 6.06 5.31 2/1486 2981977
      $ pnpm exec vitest run --config <scratchpad>/backwards.config.mts --root .    (packages/db)
 Test Files  23 failed | 54 passed (77)
      Tests  31 failed | 957 passed (988)
```

**Helpers** (`packages/db/src/testing.ts`), each test-first:
- `wallClockStepsBack()`: makes every `Date.now()` reading a millisecond earlier than the last and returns the restore; PGlite's `now()` and `generateId` follow it, `new Date()` does not. It patches `Date.now` itself, without Vitest, because the benchmark scripts import `@openverify/db/testing` outside a test runner.
- `createdAtClock(db, start = new Date())`: `at(table, id, key = 'id')` gives the row the clock's next instant (a second after the last) as its `created_at`, and its `updated_at` too where the table has one; `stamp(table, row)` returns the row with `createdAt` (and `updatedAt`) set to it. The default start is the wall clock when the clock is made, so the tests' windows relative to now (`createdAtStart: now + 60 s` empty, `createdAtEnd: now − 1 h` empty) still hold. The update runs in its own transaction with `session_replication_role = replica`, so no row trigger runs: `audit_logs`, which is append-only, takes the stamp, and `updated_at` is not bumped again.

```text
RED   $ vitest (db) src/testing.test.ts -t "clocks of ordered rows"    (stub 6252b67b, RED ff61db64)
     × wallClockStepsBack makes every Date.now() reading a millisecond earlier, then restores the wall clock
Error: wallClockStepsBack is not built yet (owner decision 15, P5-6)
     × wallClockStepsBack takes PGlite now() back with it, as two rows written back to back show
     × createdAtClock stamps each row a second after the last, created_at and updated_at alike
Error: createdAtClock(object, 2026-10-01T00:00:00.000Z) is not built yet (owner decision 15, P5-6)
     × createdAtClock stamps created_at alone on a table without updated_at, and starts at the wall clock by default
      Tests  4 failed | 55 skipped (59)
GREEN $ vitest (db) src/testing.test.ts                                 (11972815)
      Tests  59 passed (59)
RED   $ vitest (db) src/testing.test.ts -t "another key column"         (stub e857fede, RED 75269b65)
     × createdAtClock stamps a row by another key column or a bigint id, in an append-only table too
Error: Failed query: update "audit_logs" … code: '22P02' … routine: 'pg_strtoint64_safe'
GREEN $ vitest (db) src/testing.test.ts                                 (4b82cb73)
      Tests  60 passed (60)
```

Before `11972815`, my own RED test compared the stamps as text, which PGlite prints in the session's time zone (`2026-09-30 19:00:01-05`); it was corrected to compare instants.

**The ordering tests.** RED (`e4df073e`): each of the 28 tests starts with `onTestFinished(wallClockStepsBack());`, so its writes run while the wall clock steps back, and its order assertion fails. GREEN (`4107279d`): each stamps the rows it lists in order, in the order written, through `createdAtClock` (`stamp` where the test compares whole rows, `at` where it compares ids; `verification_id` as the key of `government_id_extractions`, `public_id` for `audit_logs`, the newest `trust_anchor_syncs` row after each sync, the relation's bigint id). Every assertion is unchanged.

```text
RED   $ vitest (db) <the 20 files>
      Tests  28 failed | 161 passed (189)
      (every failure an order: "expected [ …(3) ] to deeply equal [ …(3) ]", "expected [ 'one', 'two' ] to deeply equal [ 'three', 'two' ]", "expected 'Admin' to be 'Logs'", …)
GREEN $ vitest (db) <the 20 files>
 Test Files  20 passed (20)
      Tests  189 passed (189)
      $ cat /proc/loadavg     (before, after; under the e2e lock)
3.22 3.42 3.83 2/1455 3004102
9.76 5.24 4.44 3/1466 3005170
      $ pnpm exec vitest run --config <scratchpad>/backwards.config.mts --root .    (packages/db, every test under the stepping clock)
 Test Files  3 failed | 74 passed (77)
      Tests  3 failed | 990 passed (993)
 FAIL  src/constraints-v2.test.ts > maintenance updates (KEK rewrap) > still bumps updated_at on new tables otherwise
 FAIL  src/constraints.test.ts > triggers > bumps updated_at on every update
 FAIL  src/repositories/report-repositories.test.ts > report matches and actions (C75, C74.2) > writes matches, keeps one live row per entry, and finds a dismissed evidence hash
```

The scratch config and its setup file stay outside the repository; the committed tests carry their own clock.

## Slice 9: the console specs and the README

- `e2e/tests/ui-report-config.spec.ts` reads the sources page as the API serves it now: the environment's own media runs ("N scheduled adverse-media runs a day in this environment"), the install flag in words exactly when `install-above-warn-share` is set, the API's `media.attribution`, the API's matcher data (its keys version, or "The API has no variant groups"), and each warned template by its name, linked to its page.
- `e2e/tests/ui-reports.spec.ts`: the Coverage term of a complete watchlist report reads "Complete" and then the decision 6 sentence, so its old exact `toHaveText('Complete')`, which the sentence breaks, became a pattern (rule 10: the plan changed what the term says); after the redaction, the history's `redact` action names the reviewer, "User usr_…" (decision 12).
- These are acceptance specs of slices already built test-first; they have no RED step of their own.

```text
      $ cat /proc/loadavg     (before, after)
1.51 3.05 3.71 3/1461 3007574
4.63 3.56 3.81 3/1517 3009796
      $ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-reports.spec.ts tests/ui-report-config.spec.ts'
 Tasks:    5 successful, 5 total
  5 passed (1.4m)
```

`apps/dashboard/README.md` (`9c86bfa2`) says what changed in the reports pages: each query input's own length limit, the other lists of a matched entry and a relative's class, who acted in the history, what complete coverage does not promise, and `pii:view` for review in the API too.

## Final gates

Run in the foreground after the last code commit (`9c86bfa2`), each under `flock /tmp/openverify-e2e.lock`, one step per hold, beside `calibration-6c`. A call's wall time includes the wait for the lock (up to 8 minutes when the calibration held it).

| Gate | Result | Load average (start → end) |
|---|---|---|
| `pnpm --filter @openverify/dashboard typecheck` (`next typegen && tsc --noEmit`) and `lint` | both exit 0 | 5.85 → 2.90 |
| `pnpm --filter @openverify/dashboard test` | 265 files, 3,924 tests; 98.71 / 93.48 / 99.15 / 98.71 (statements / branches / functions / lines); Vitest 156.9 s | 7.06 → 9.58 |
| `pnpm --filter @openverify/db test` | 77 files, 993 tests; 95.89 / 89.94 / 96.63 / 96.20; 63.0 s | 6.30 → 10.79 |
| `pnpm test:integration` | db 12 files, 60 tests (116.8 s); API 27 files, 153 tests (213.8 s); turbo 3 min 35 s | 4.84 → 10.44 |
| `pnpm typecheck && pnpm lint && pnpm format:check` | 14 of 14 tasks each (50 s, 1 min 53 s); every file formatted | 4.45 → 3.11 |
| e2e (rule 7): `pnpm --filter @openverify/flow e2e` | 69 passed (22.4 s) | 3.42 → 7.96 |
| e2e: build, then `playwright test --shard=1/3` | 31 passed (2.5 min) | 2.24 → 5.38 |
| e2e: `--shard=2/3` | 31 passed (5.2 min) | 3.15 → 1.97 |
| e2e: `--shard=3/3` | 29 passed (4.7 min) | 2.20 → 3.70 |

The full-stack suite is 91 tests, `ui-reports.spec.ts` and `ui-report-config.spec.ts` among them.
