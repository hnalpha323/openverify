# Phase 8, Workflow 8B Stage 3: `api-cases` (TDD evidence)

Owner bullet: cases (create with names from the counter, read, update, fields, tags, held objects with
their attached state, transitions and history), templates and versions with publish, comments with
mentions and their redaction, notifications, `GET /cases` filters and `POST /cases/search`, bulk
actions, template visibility on every exit of C129.4, case redaction (`redactCasesInTx`) and
retention, the case subject resolvers. Base: `bb789ee0` (after `case-logic`, on checkpoint (C) and the
(Q) columns). Every value in every test is synthetic.

Commands ran after `source scripts/env.sh`. Output is abbreviated; exit codes were read from the
command, never through a pipe.

## Slice 1: the db repositories (`packages/db/src/repositories/`)

Files: `cases.ts`, `case-templates.ts`, `case-comments.ts`, `case-history.ts`, `case-objects.ts`,
`case-field-index.ts`, `notifications.ts`, `case-bulk-actions.ts`.

- **Stub** `a3dd492d`: the new names (`updateCaseRow`, `listCaseRows`, `getCaseRows`,
  `hiddenCaseObjectIds`, `caseVisibleTo`, `templateVisibleTo`, `listCasesPastRetention`, the template
  and version writes, `listCaseHistoryRows`, `findAttachableObjects`, `removeCaseObjects`,
  `listCaseHeldObjectRows`, `listHeldInquiryTemplateIds`, `caseFieldValueKey`, the notification
  reads and writes, the bulk-action writes), each rejecting with `CaseRepositoryNotBuiltError`
  naming `api-cases`. `listCasesAfter` kept answering `[]`, as before Workflow 8B.
- **RED** `b180232f`, `case-repositories.test.ts`:

  ```
  $ pnpm --filter @openverify/db exec vitest run src/repositories/case-repositories.test.ts --coverage.enabled=false
  Tests  17 failed | 1 passed (18)            (exit 1)
  14x CaseRepositoryNotBuiltError: createCaseTemplateRow is not built yet (api-cases)
   1x CaseRepositoryNotBuiltError: createCaseBulkActionRow ... / createUserNotifications ... / findAttachableObjects ...
  ```
  The one pass is the seal-name check, which reads a constant.
- **GREEN** `c8be4d69`: the same command, `Tests 18 passed (18)`, exit 0. `case-plumbing.test.ts`
  changed with the plan: its stub list named functions that are now built, and the recurring trigger
  now reads the case (`listCasesAfter` answers `[case id]`). The five case db files: 50 passed.

## Slice 2: templates, versions and cases through the routes

- **RED** `2f3916ca`, `services/cases/templates.test.ts` and `cases.test.ts`:

  ```
  $ (cd apps/api && pnpm exec vitest run src/services/cases/templates.test.ts src/services/cases/cases.test.ts --coverage.enabled=false)
  Tests  23 failed (23)                         (exit 1)
  23x AssertionError: {"status":501,"detail":"POST /case-templates is not built yet."}: expected 501 to be 201
  ```
  A first run failed four tests on the test's own field schemas (no `label`); that was fixed before
  the commit, so the committed RED fails only on 501.
- **GREEN** `4f9d0fca`: the same command, `Tests 23 passed (23)`, exit 0. Two expectations of the RED
  test were corrected in the GREEN commit, each for a reason of the contract, not of the code:
  - a `sar_` id is refused by the contract's id schema (400) before the service runs, so the test
    sends a `wfl_` id too, which the service refuses as `object_type_unsupported`;
  - a field masked without `pii:view` keeps its key and type with a null value
    (`{ note: { type: 'string', value: null } }`), as a transaction's is.
- `routes/server/case-routes.test.ts`: the 26 routes built leave the 501 list (`built: true`); every
  scope refusal stays. Case, graph, case-workflow and join tests: 266 passed in 16 files.

## Slice 3: search, bulk actions, the other exits, notifications, redaction and retention

- **Stub** `cf54c347`: `CaseBulkDeps` gains an optional `events` (the worker's publisher).
- **RED** `5f5c36bd`, `search-bulk.test.ts`, `exits.test.ts`, `redaction.test.ts`,
  `notifications.test.ts`:

  ```
  $ (cd apps/api && pnpm exec vitest run src/services/cases/search-bulk.test.ts src/services/cases/exits.test.ts src/services/cases/redaction.test.ts src/services/cases/notifications.test.ts --coverage.enabled=false)
  Tests  14 failed | 1 passed (15)              (exit 1)
  501 from POST /cases/search, POST /cases/bulk, GET /dashboard/notifications
  expected [ 'hidden', 'comment', 'open', ... ] to deeply equal [ 'open', 'none', 'plain' ]   (the visibility stub)
  expected [ {}, {}, {} ] to deeply equal [ {...}, {...}, {} ]                               (the subject stub)
  expected { redactedCases: 0, ... } to match object { redactedCases: 1, ... }               (retention)
  promise rejected "NotImplementedError: A case template restriction..."                    (the key check)
  ```
  The one pass, "lets a key that lists the template see it", passes under the stub too, because the
  stub hid nothing; its partner, "leaves out what names a case ...", is the one that failed.
- **GREEN** `20d9d881`: the same command, `Tests 15 passed (15)`, exit 0. Tests changed with the
  plan: `case-plumbing.test.ts` (a key's case templates are checked: 422 for an id the creator may
  not see, 201 with the attribute for one it may, where it answered 501),
  `routes/dashboard/notifications.test.ts` (200 with an empty list and 404 for another's, where it
  answered 501), `case-routes.test.ts` (search, bulk and the bulk read built).
- `8bf04206`: `routes/graph-query-routes.test.ts` changed with the plan: the graph `create-case` on a
  template the environment does not hold now answers 404 from `createCaseInTx`, where it answered
  501 while the creation was a stub.

## Gates

See the final report for the gate table: each gate's command, its exit code, its time and
`cat /proc/loadavg` beside it.
