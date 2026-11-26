# Phase 9, Workflow 9D: `fix-console` (TDD record)

The console fixer of Workflow 9D, beside `fix-flow` and `fix-builder`, on `apps/dashboard` (less
`fix-builder`'s paths), the `ui-*` specs with their helpers and `docs/accessibility`. Base: `ef70cead`
(the plan's Workflow 9D Stage 1 amendments). Every shell ran `source scripts/env.sh` first. Unit runs
while iterating were `pnpm --filter @openverify/dashboard exec vitest run <files> --coverage.enabled=false`;
the outputs below are abbreviated from the real runs.

No blocking item was handed over. The second list was done in order: the 16 known items, then the
two MEDIUM review findings (both confirmed by reading the code first). No dependency, environment
variable of the API, migration or contract changed.

## The items

| Item | Stub | RED | GREEN (and refactor) |
|---|---|---|---|
| K9-8 simulate's two known differences | | `37ca01e0` | `e9312faf` |
| K9-9 `no_environment_role` in words | | `abc0993c` | `2c202c64`, refactor `964e7471` |
| K9-10 9A and 9B settings in the read-only view | | `80a53802` | `69fdb6fe`, refactor `5b8548ef` |
| K9-11 passkey step-up in the reset and reactivate dialogs | `b12ba4ca` | `7b89293d` | `9bc48b74` |
| K9-15 the error page in the real-header CSP spec | `c27b4875` | `89599627` | `f10a9f27`, `e836d5cd`, `ef2c2051` |
| K9-16 `comparison-source` in words | | `eb9e5fd9` | `3a3610ff` |
| K9-18 analytics CSV download | `a9d7ea0b` | `54e64297` | `dca63c15`, `f0fa5797` |
| K9-1 relation target kind in words | | `951b367f` | `b7b7e0df` |
| K9-2 a redacted transaction's relations stay | | `e15b4b55` | `1e4c906d` |
| K9-12 webhook names in the list | | `61c6d6e6` | `af6e58ce` |
| K9-13 `consolePublicOrigin` removed | | `a35300ed` | `48afc1bb` |
| K9-14 `injectNonceCsp` and `nonceCsp` removed | | (deletion of dead code) | refactor `3467413d` |
| K9-17 layout module places in publish problems | | `f66efcb5` | `acff3a12` |
| K9-19 non-string transaction field filters in saved views | `4807fd23` | `171879a8` | `f0504d05` |
| K9-20 bulk upload without `report-templates:read` | | `6e53bd83` | `0da7cca2` |
| K9-21 bulk codes in words | | `6e53bd83` | `0da7cca2` |
| R001 `/csp-reports` limiter cap | | `7c9817f4` | `87e1626b` |
| R009 graph result table paged, 24 px checkboxes | | `afb599b5` | `80a20fb9`, refactor `17887249` |

Records: `5003d3c7` (`docs/accessibility/audit-2026-11-07.md`, R009), `04480625` (`apps/dashboard/README.md`).

## RED and GREEN, item by item

### K9-8: the simulated path names simulate's two known differences

- RED: `vitest run src/components/flow-preview/simulated-path.test.tsx`: `Tests 1 failed | 6 passed (7)`,
  `TestingLibraryElementError: Unable to find an accessible element with the role "list" and name
  /how a live inquiry can differ from this simulated path/i`.
- GREEN: `PREVIEW_COPY.path.differencesLabel` and `.differences.{failureStep,nullSignal}`, a list in
  `SimulatedPath` after the "Simulated" badge. `vitest run src/components/flow-preview/ src/lib/copy`:
  `Test Files 10 passed (10)`, `Tests 67 passed (67)`. `ui-preview.spec.ts` checks the two items.

### K9-9: a 403 `no_environment_role` in words

- RED (`lib/api/sessions.test.ts`, `app/actions/auth.test.ts`, `app/actions/environment.test.ts`,
  `app/login/page.test.tsx`): `Test Files 4 failed (4)`, `Tests 7 failed | 85 passed (92)`:
  `createSession` gave `unavailable`; `Expected a redirect, but the call completed` after the second
  factor; `expected 'Forbidden' to be 'Your account holds no role in that environment…'`.
- GREEN: `LoginFailure` and `MfaLoginFailure` gain `no_environment_role` (403 with that code only,
  `isNoEnvironmentRole`); `LOGIN_ERROR_MESSAGES` and `NO_ENVIRONMENT_ROLE_WORDS` in
  `lib/login-state.ts`; after the second factor `settleMfa` returns to
  `/login?reason=no-environment-role`, a notice on the login page; the environment switch throws the
  switch's words as an `ActionInputError` with the code, never the API's detail. 10 files, 147 tests
  passed. The words name no role and no environment.

### K9-10: the 9A and 9B settings in the read-only settings view

- RED (`components/operators/settings-view-platform.test.tsx`): `Tests 3 failed | 1 passed (4)`:
  `Unable to find an accessible element with the role "region" and name "Embedding and redirects in
  Sandbox"`; the organisation-wide sentence missing.
- GREEN: `PlatformSettingsView` (embed and redirect origins with what an allowlist does not stop, the
  default theme set, the reporting zone, threshold, retention months, settle days, per-reviewer
  months, key age days, audit retention, sender name; each only when served; an empty or null value
  in words), and the settings view's organisation-wide second-factor lines. 26 files, 221 tests. No
  value shown is personal data, so no RSC payload test was added.

### K9-11: a passkey step-up in the reset and reactivate dialogs

- Stub `b12ba4ca`: `stepUpWebauthnOptions`, `startStepUpWebauthn`, `StepUpCodeField`'s `startWebauthn`.
- RED (`app/users/actions.test.ts`, `app/users/page.test.tsx`,
  `components/operators/step-up-code-field.test.tsx`): `Test Files 3 failed | 1 passed (4)`,
  `Tests 12 failed | 61 passed (73)`: `startStepUpWebauthn is not built yet`; no button "Use a
  security key or passkey"; the assertion ignored (`Unexpected API request: POST
  /api/v1/dashboard/users/usr_…/reactivate`; a 401 there signed the operator out).
- GREEN: `POST /dashboard/sessions/current/step-up/webauthn/options`; the field runs
  `startAuthentication` as `components/mfa-login.tsx` does and puts the assertion in a hidden
  `step-up-credential`; the action parses it with `webauthnAuthenticationResponseSchema`, verifies it
  with `POST /step-up` (`{ credential }`) before acting; a refused or malformed one is said at
  `/step-up-credential` and nothing else is called. 22 files, 240 tests.

### K9-15: the error page in the real-header CSP spec

- Stub `c27b4875`: `/error-probe` as the 404 page.
- RED (`app/error-probe/page.test.tsx`): `Tests 1 failed | 3 passed (4)`: `expected 'not found' to be
  'The error page probe was opened on purpose (development mode only).'`. The new test of
  `ui-csp.spec.ts` came in the same commit.
- GREEN: `/error-probe` throws inside `renderPage` (a signed-in operator) only when
  `OPENVERIFY_MODE` is exactly `development`, which `e2e/src/env.ts` already gives every child of the
  e2e stack; any other value, or none (the compose dashboard is given none), is the 404 page and
  calls nothing. 4 tests passed.
- On the stack: the first run failed `getByRole('alert')` in strict mode (Next.js's route announcer
  is an alert too); `e836d5cd` finds the boundary's alert by its words. The console sweep's
  `/error-probe passes axe` then answered `Expected: 200, Received: 500`: the probe is in the route
  manifest. Borrowed edit `ef2c2051` (`e2e/tests/a11y-console.spec.ts`, `fix-api`'s): that one route
  expects 500 and the boundary's alert, then axe. Re-run: `4 passed (20.0s)`
  (`/error-probe passes axe`, every static page's policy, the sign-in and 404 pages, the error page).

### K9-16: `comparison-source` in words

- RED (`components/evidence/database.test.tsx`, `components/check-results.test.tsx`):
  `Tests 5 failed | 52 passed (57)`: no list "Where each compared value came from"; the database
  evidence's fields without the words.
- GREEN: `lib/comparison-source.ts` (`comparisonSourceOf`, `comparisonSourceWords`; a kind other than
  `initial` or `entered`, or none, is "not recorded"); `InquiryComparisonEvidence.sources`; the check
  table's metadata cell lists the sources of `id_inquiry_comparison` and
  `database_inquiry_comparison`. Field names only: the words show for a reader without `pii:view`
  too (the `hidden` state is tested). Existing test changed: `lib/database-evidence.test.ts`'s
  expected object gains `sources: { name: null, birthdate: null }`. 20 files, 486 tests.

### K9-18: every analytics view as CSV

- Stub `a9d7ea0b`: `csvText`, `AnalyticsDownload`.
- RED (`lib/analytics-csv.test.ts`, `components/analytics/analytics-view-page.test.tsx`):
  `Tests 16 failed | 5 passed (21)`: the writer's vectors (quotes, CRLF, `=`, `+`, `-`, `@`, tab, CR,
  LF, the full-width forms, `'=x`) and no button "Download this view as CSV".
- GREEN: the button builds the file in the browser from the view's own tables (inside
  `#analytics-figures`; `aria-hidden` parts skipped), after the About lines and each metric's
  definition (`aboutLines`, `definitionsOf`, moved out of `AnalyticsAbout`), with no second API read;
  a table inside `data-analytics-download="omit"` (the cases per reviewer, which name people) is left
  out and the file says so. The writer mirrors `packages/checks/src/csv`'s neutraliser, which the
  console does not depend on. 11 files, 71 tests. `ui-analytics.spec.ts` downloads the overview on
  the stack: its file name, the time zone line, and the live day's `"fewer than 11"`.

### K9-1, K9-2, K9-12, K9-13, K9-14, K9-17

- K9-1 RED: `Tests 1 failed | 2 passed (3)`, `"payer (account, one target)"` against
  `"payer (Account, one target)"`. GREEN: `RELATION_TARGET_WORDS` in `transaction-words.ts`, used by the
  relations list and the form; the option's value stays the key.
- K9-2 RED: `Tests 1 failed | 39 passed (40)`, the alert without the relations sentence. GREEN: a second
  paragraph in the alert ("Its relations stay too, as the ids of the other objects: nothing of their
  data is copied here."); the first sentence is kept, so its existing exact test is unchanged.
- K9-12 RED: `Tests 1 failed | 8 passed (9)`, `Unable to find … role "link" and name "Case system"`.
  GREEN: the list's first column is "Webhook": the name linked with the endpoint below, or the URL
  when unnamed (DS14). 28 files, 166 tests.
- K9-13 (decision: remove) RED: `Tests 1 failed | 24 passed (25)`, `expected [ 'CSP_NONCE_HEADER', …(12) ]
  to not include 'consolePublicOrigin'`. GREEN: both exports and their assertions in `policy.test.ts`
  removed. 160 tests in `lib/csp`, `proxy.test.ts` and `components/flow-preview`.
- K9-14: dead code with no importer under `e2e/tests` (grep), removed as a refactor; nothing inside my
  paths could fail before the removal. `pnpm --filter @openverify/e2e typecheck`: exit 0.
- K9-17 RED: `Tests 2 failed | 8 passed (10)`, the details without "Layout module 2 (Signals): ".
  GREEN: a pointer `/data/attributes/layout/modules/<n>/…` reads "Layout module n+1", with the module's
  name when one read of the draft (`GET /case-template-versions/:id`, only when the refusal names a
  layout module) gives its key; a failed read leaves the position alone. 5 files, 24 tests.

### K9-19: a saved view holding a non-string transaction field filter

- Stub `4807fd23`: the optional `SlotData.nonPersonalTransactionFields`.
- RED (`app/exports/saved-views/route.test.ts`, `components/saved-views/actions.test.ts`,
  `components/saved-views/saved-views-slot.test.tsx`): `Tests 5 failed | 35 passed (40)`:
  `expected undefined to deeply equal [ 'amount', 'receipt' ]`, a numeric field filter refused, no
  save form in the slot.
- GREEN: `nonPersonalTransactionFields(types)` (a key some type declares and none declares as a
  string), read by `readNonPersonalTransactionFields()` from one page of `GET /transaction-types`
  (`null` when there is a next page or the read fails); the slot route serves it on the transactions
  list only; the slot and the save action pass `transactionStringFieldsFor(filters, …)` to the
  contracts' `savedViewPiiFilterKeys`, so a key no type declares, a string key, or unknown types stay
  refused. The PII rule of C165 is unchanged; the API judges again over every version. 15 files,
  149 tests.

### K9-20 and K9-21: bulk reports

- RED (`app/exports/bulk-reports/page.test.tsx`): `Tests 30 failed | 8 passed (38)`: no "Report
  template ID" field; every code of `REPORT_PROBLEM_CODES` and `IMPORT_ERROR_CODES` without words.
- GREEN: without `report-templates:read` the page reads no list and the form takes a template ID,
  checked with `idSchema('rptp')` before anything is sent (refused in words in the status region), the
  API's refusals unchanged; `bulkCodeWords` words a row's or a file's code, the code kept beside the
  words, from `REPORT_PROBLEM_WORDS`, the reader's codes typed by core's `ImportErrorCode`, and the
  job's own codes; an unknown code is "<code>: not described". Existing test changed: "shows a job …"
  asserted "No active report template" for a reader who cannot list templates (the defect itself);
  it now finds the ID field. 14 files, 109 tests. `ui-analytics.spec.ts` checks the failed row's
  words end with `(code)`.

### R001 and R009 (MEDIUM, confirmed by reading the code)

- R001 RED (`lib/csp/reports.test.ts`): `Tests 1 failed | 36 passed (37)`, `expected 204 to be 429` for
  the 10,001st address of a minute. GREEN: windows kept in start order (a renewed window is deleted and
  set again), each call sweeps only the expired front, and a new address past 10,000 held is refused
  (429, `Retry-After: 60`) while held addresses keep their counts. 64 tests.
- R009 RED (`components/graph/graph-table.test.tsx`): `Tests 2 failed | 5 passed (7)`: no `size-6` on
  the checkboxes; 30 account rows where 25 were expected. GREEN: `size-6` checkboxes;
  `GRAPH_TABLE_PAGE_SIZE` 25 (the console's list page size) with Previous and Next and a polite "Accounts
  1 to 25 of 30" line per table; "Select every account in this result" still takes the whole result.
  18 files, 97 tests. Recorded in the audit file (`5003d3c7`); the sweep's `/graph/[id]` time is
  `validation-9d`'s to measure.

## Final gates (foreground, each exit code read from the command itself)

| Gate | Command | Result |
|---|---|---|
| Dashboard unit, shard 1 | `bash /tmp/openverify-heavy.sh pnpm exec vitest run --coverage --coverage.reportsDirectory=<dir>/coverage-1 --shard=1/2 --reporter=blob --outputFile=<dir>/blobs/blob-1-2.json` (apps/dashboard) | exit 1 on its partial coverage, as a lone shard does; 229 s, load 2.79 to 9.10 |
| Dashboard unit, shard 2 | the same with `--shard=2/2`, `coverage-2` | exit 1 on its partial coverage; 273 s, load 7.01 to 14.62 |
| Dashboard unit, merge (the gate) | `bash /tmp/openverify-heavy.sh pnpm exec vitest run --merge-reports=<dir>/blobs --coverage --coverage.reportsDirectory=<dir>/coverage-merged` | **exit 0**, 11 s: `Test Files 579 passed (579)`, `Tests 6707 passed (6707)`; statements 94.91%, branches 87.57%, functions 94.13%, lines 95.18% |
| Forced lint and typecheck | `NODE_OPTIONS=--max-old-space-size=4096 bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e --concurrency=1` | first run exit 1 (`app/actions/environment.test.ts:111`, two lint errors in my K9-9 test; fixed in `964e7471`); re-run **exit 0**, `Tasks: 4 successful, 4 total`, 294 s, load 9.64 to 2.95 |
| Dashboard typecheck | `bash /tmp/openverify-heavy.sh pnpm --filter @openverify/dashboard typecheck` | **exit 0**, 49 s, load 1.75 |
| Dashboard lint | `NODE_OPTIONS=--max-old-space-size=4096 bash /tmp/openverify-heavy.sh pnpm --filter @openverify/dashboard lint` | **exit 0**, 156 s, load 1.32 |
| Prettier | `pnpm exec prettier --check <every non-Markdown file I touched>` | **exit 0** |
| UI specs (one call) | `flock -E 75 -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "… e2e:stack:down && pnpm turbo run build --filter=@openverify/e2e^... && … e2e:stack:up && OPENVERIFY_E2E_REUSE_STACK=1 … playwright test --project=chromium tests/ui-preview.spec.ts tests/ui-analytics.spec.ts tests/ui-graph.spec.ts tests/ui-a11y-focus.spec.ts tests/ui-a11y-analytics.spec.ts tests/ui-a11y-preview.spec.ts; …; OPENVERIFY_E2E_REUSE_STACK=1 … playwright test --project=console-sweep --no-deps tests/ui-csp.spec.ts --grep 'the error page carries'; …; e2e:stack:down"` | first try exit 75 (lock busy); second exit 1 (the error test's strict-mode locator, fixed in `e836d5cd`; chromium 13 passed); third **exit 0** in 198 s: stack ready 87 s after the start, chromium `13 passed (1.7m)`, the sweep's error-page test `1 passed (3.7s)`; load 1.70 to 2.59 |
| The sweep's tests that open `/error-probe` | the same stack line with `--project=console-sweep --no-deps tests/a11y-console.spec.ts tests/ui-csp.spec.ts --grep '/error-probe passes axe\|the error page carries\|every console page sends the real policy\|the sign-in page and the 404'` | first exit 1 (`/error-probe` 500, not 200; borrowed edit `ef2c2051`); re-run **exit 0**, `4 passed (20.0s)`, 111 s, load 1.48 to 3.25 |

No e2e gate or shard was run (orchestrator decision P-B): `validation-9d` runs the whole e2e gate,
the console sweep included, on the final tree.
