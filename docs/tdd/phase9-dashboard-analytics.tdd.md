# Phase 9, Workflow 9C Stage 1: dashboard-analytics (TDD evidence)

Owner: `dashboard-analytics`. Scope: C164.9 (the Analytics section), C165 in the console (saved
views on every C165.1 list, the new inquiry and transaction filters), C166 (exports and bulk report
creation), `e2e/tests/ui-analytics.spec.ts`. Base `69ebd7fa`. Every command below was run after
`source scripts/env.sh`; outputs are abbreviated to the lines that matter.

## Precondition and re-verification

- `docs/PROGRESS.md` records "2026-11-06: Phase 9, Workflow 9B done" (line 20) and Workflow 9A
  before it (line 116); `git log 69ebd7fa` holds both.
- Re-verified against the code at the base (each drift is a contractDeviation in the report):
  - `GET /analytics/{inquiries,funnel,verifications,checks,cases,signals}`
    (`apps/api/src/routes/server/analytics.ts`), the answer schemas
    (`packages/contracts/src/analytics.ts`), `ANALYTICS_METRICS` (`packages/core/src/analytics/
    definitions.ts`) as the Handover says.
  - Exports, saved views and bulk reports (`packages/contracts/src/{exports,saved-views,
    report-bulk}.ts`), `SAVED_VIEW_LIST_PERMISSIONS` (`apps/api/src/services/exports/problems.ts`).
  - **Drift:** `GET /dashboard/inquiries` (`apps/api/src/routes/dashboard/inquiries.ts:94-163`)
    takes `dashboardListInquiriesQuerySchema = listInquiriesQuerySchema`, so it accepts C165.3's
    `filter[list-match]`, `filter[list-id]`, `filter[check]`/`filter[check-status]` and
    `filter[next-step-name]`, but never calls `inquiryListFilters`: it answers them unfiltered
    (a silent widening). The server route `GET /inquiries` (`services/inquiries.ts:501`) applies
    them.

## Slices

| Slice | Stub | RED | GREEN |
|---|---|---|---|
| 1. The clients, the analytics query, the copy and the mock routes | `de464bbd` | `a6ced0bf`: 25 of 27 fail, each `Error: not built` | `95258c1d`: 27 pass |
| 2. Minimal pages at `/analytics`, `/analytics/[view]`, `/exports`, `/exports/bulk-reports` | `2c2dbca1` | `3f6eab3a`: 11 of 12 fail on the stub pages (render `null`) | `4bffe9e3`: 24 pass with slice 1's files |
| 3. The six analytics views (tables first, then the d3-scale/d3-shape charts, the filters per view, what the figures mean) | `4a1b68d5` | `0058d249`: 20 of 37 fail (`Error: not built` x6, every view table and figure missing) | `b7046e11`: 44 pass (lint fixes in the test and the charts in that commit) |
| 4. Exports: the new-export form, its action, the download route, the exports list | `496619af` | `939c39e8`: 14 of 19 fail | `90e55c13`: 19 pass |
| 5. Bulk reports: the streaming upload route, the form, the job | `4436f18d` | `ed499d4d`: 9 of 11 fail | `512cf27e`: 11 pass (the file input lost `required`: jsdom never satisfies it after `user.upload`) |
| 6. Saved views: the URL-to-filter table, the actions, the panel, a server slot | `fba45cd0` | `9f289880`: 18 of 18 fail | `7d4af196`: 18 pass |
| 7. The inquiry list's C165.3 filters | `266142cd` (the `canFilterByStep` prop) | `7625e718`: 4 fail (the commit subject says 5; the RED test missed the `hasInquiryFilters` import, added in the GREEN commit) | `97375ee7`: 24 pass |
| 8. The transaction field filters | `629902c0` (the `canFilterStrings` prop) | `bf11928c`: 5 of 7 fail | `f5adc836`: 18 pass |
| 9. The slot read in the browser (a server slot put an async component in every list page, which their own RTL tests cannot render) | `3fb1c7bc` | `1e70a2e0`: 9 of 9 fail | `44638443`: 42 pass |
| 10. The slot line on the nine list pages (borrowed) | none | `b5d7f58d`: 9 of 9 fail, run with `SAVED_VIEW_PAGES_ROOT` on the pages as committed | `07ade37c`: 9 pass; the nine pages' own 78 tests pass unchanged |
| 11. The RSC payload of the cases view and the exports page | none | `afa8bd0f`: a guard over built behaviour, green on its first run | |
| 12. The new export named by id | none | `f08b7a2f`: 1 fails | `a86586b5` |
| 13. `e2e/tests/ui-analytics.spec.ts` with `support/ui-analytics.ts` | none | `0881d2ee` | the final locked run below |

Slice 1, RED (`a6ced0bf`):

```
$ pnpm --filter @openverify/dashboard exec vitest run src/components/analytics src/lib/api/{analytics,exports,saved-views,reports-bulk}.test.ts --coverage.enabled=false
     × takes, per view, only the filters its answer takes (C164.8, AA1)
     ...
 Test Files  5 failed (5)
      Tests  25 failed | 2 passed (27)
$ grep -E "Error:" ... | sort | uniq -c
     25 Error: not built
```

Slice 1, GREEN: `Test Files  5 passed (5) / Tests  27 passed (27)`.

Slice 2, RED (`3f6eab3a`): `Test Files  4 failed (4) / Tests  11 failed | 1 passed (12)` (the stub pages
render nothing). GREEN (`4bffe9e3`): `Test Files  5 passed (5) / Tests  24 passed (24)`;
`tsc --noEmit` reports no error in my files (two in `lib/api/inquiry-template-versions.test.ts`,
dashboard-flow-builder's RED in flight); eslint clean on my files.

## Checkpoints

- **[9c-checkpoint:dashboard-analytics:1]** (`c807f38d`): the clients
  `lib/api/{analytics,exports,saved-views,reports-bulk}.ts` with their tests,
  `testing/routes/analytics.ts`, `lib/copy/analytics.ts` (through `defineCopy`), minimal pages at
  `/analytics`, `/analytics/<view>`, `/exports` and `/exports/bulk-reports`, and the requests
  below (`2992188f`). Suites green: my 9 test files, 51 tests (`95258c1d`, `4bffe9e3`); the
  navigation entries came with `[9c-shared]`.

## Borrowed edits

- `07ade37c`: the saved-views slot line in `app/{inquiries,accounts,reports,cases,transactions,api-logs,events,audit-logs}/page.tsx` and `app/webhooks/[id]/page.tsx`, each edited once (each file's `git status --porcelain` was empty first), plus two call sites of props I added: `canFilterByStep={hasPermission(session, 'pii:view')}` on the inquiries page and `canFilterStrings={hasPermission(session, 'pii:view')}` on the transactions page (whose render callback now takes `{ session }`, with the `hasPermission` import).

## Requests

Navigation: none. `[9c-shared]` (`68a65629`) already links `/analytics` (analytics:read),
`/exports` (any `:export`, through `anyOf`) and `/exports/bulk-reports` (reports:write).

1. **To dashboard-flow-builder: `apps/dashboard/src/lib/api/inquiries.ts`, `listInquiries`.**
   Change: send the list to the server API's `GET /inquiries` instead of `GET /dashboard/inquiries`
   (same `inquiryListDocumentSchema`, same masking: the server route masks through the session
   principal's `acting.mask`). Why: the dashboard route accepts C165.3's `filter[list-match]`,
   `filter[list-id]`, `filter[check]` with `filter[check-status]` and `filter[next-step-name]`
   (its query schema is `listInquiriesQuerySchema`) but never applies them
   (`apps/api/src/routes/dashboard/inquiries.ts:113-125`), so the filtered list would silently be
   the unfiltered one (C165.5). My test that needs it: `lib/inquiry-query.test.ts` (the API filters)
   and `components/inquiry-filters.test.tsx`; until it lands the console sends the new filters only
   through `inquiryApiFilters` and the list would ignore them, so the API fix is also a deviation
   for integration-9c.
   **Answered** in `fb7d253d` [9c-done:dashboard-analytics].
2. **To dashboard-flow-builder: `apps/dashboard/src/lib/api/transactions.ts`,
   `TransactionFilters` and `listTransactions`.** Change: `TransactionFilters` gains
   `readonly fields?: Readonly<Record<string, string>> | undefined` (field key to value), and
   `listTransactions` sends each as `filter[fields.<key>]`. Why: C165.3's transaction field
   filters (K10); `components/transactions/transaction-query.ts` (mine) fills `fields` from the
   page URL. My test that needs it: `components/transactions/transaction-query.test.ts`.
   **Answered** in `fb7d253d` [9c-done:dashboard-analytics].

## Final gates

Each in the foreground (the two longest moved to the background by the 10-minute cap at a load of
21 to 26, and were waited for in the foreground, their exit codes read from their logs).

| Gate | Result | Duration, load |
|---|---|---|
| `bash /tmp/openverify-heavy.sh pnpm --filter @openverify/dashboard test --coverage.reportsDirectory=/tmp/claude-1000/da-cov` (another agent held `apps/dashboard/coverage`) | exit 1: 6,409 pass, 23 fail in 7 files, none mine (`components/flow-builder/flow-builder.test.tsx`, `app/templates/[id]/flow/page.test.tsx`: dashboard-flow-builder; `app/api-keys/[id]/page.test.tsx`: dashboard-settings; `app/report-templates/new/page.test.tsx` and the check panels: dashboard-template-forms; themes: dashboard-themes-copy, each a RED in flight); no coverage report is written on a failing run | over 600 s, load 21 to 25 |
| My 150 tests with coverage on my files only (`--coverage.include` of every file I own) | exit 0: 96.16% statements, 87.09% branches, 96.52% functions, 96.38% lines | load about 20 |
| `npx tsc --noEmit` (dashboard) | no error in my files (others' in-flight errors only) | |
| `bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e` | exit 1: 3 of 4 tasks pass (dashboard typecheck, e2e lint, e2e typecheck); dashboard lint fails only in `components/integrations/webhook-form.tsx` and `lib/api/webhooks.ts` (dashboard-settings' in-flight copy) | 11 min 1 s, load 25 to 27 |
| `pnpm exec prettier --check` on my files | exit 0 | |
| `bash /tmp/openverify-heavy.sh pnpm turbo run lint typecheck --force --filter=@openverify/dashboard --filter=@openverify/e2e`, again once dashboard-settings' files settled | **exit 0**: 4 of 4 tasks | 622 s (10 min 22 s), load 31.2 to 25.6 |
| The dashboard test script, again (`--coverage.reportsDirectory=/tmp/claude-1000/da-cov2`) | exit 1: 6,516 pass, 1 fails, in `components/operators/user-roles-button.test.tsx` (dashboard-settings' path); none of mine | 843 s, load 26.7 to 18.9 |
| **My full-stack spec**, one locked call: `flock -w 60 /tmp/openverify-e2e.lock timeout 520 sh -c "stack down && turbo build && stack up && OPENVERIFY_E2E_REUSE_STACK=1 playwright test tests/ui-analytics.spec.ts; rc=$?; stack down; exit $rc"` | **exit 0**: 3 passed (17.4 s, 12.8 s, 10.4 s; 45.9 s of tests) | 339 s in all, load 28.4 to 24.1 |

Earlier attempts of the locked call: one found the lock held (flock gave up at 60 s, exit 1, no
output) six times; one ran (355 s) and failed my first test on a chart assertion of mine (a hidden
cell is a hatched mark with no text label; the spec now asserts the mark and the figure's note,
`ac9dbaef`); one stopped in `next build` on another agent's in-flight type error
(`app/settings/actions.ts:377`, fixed by its owner in `e13402db`).
