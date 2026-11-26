# Phase 9, Workflow 9D: `fix-api` (TDD record)

The API fixer of Workflow 9D, run alone after `fix-flow`, `fix-builder` and `fix-console`, on the
API, the packages outside the flow's, the vision service, `e2e/` outside the `ui-*` specs, the docs,
CI and infra, plus the console halves of DS8 (K9-22) and K19 (K9-23) by the launch's grant. Base:
`6b3d7f30` (`fix-console`'s record, the last Stage 4a commit). Every shell ran `source scripts/env.sh`
first. Unit runs while iterating were `pnpm exec vitest run <files> --coverage.enabled=false` in the
package; the outputs below are abbreviated from the real runs. No blocking item was handed over; the
second list was done in order (the eleven known items, then R003 and R006), then the e2e items the
a11y-audit asked of `fix-api`. No dependency or environment variable was added. One migration,
`0032_phase9d.sql`.

## The items

| Item | Stub | RED | GREEN (and refactor) |
|---|---|---|---|
| K9-22 DS8, API half | | `bf852f67` | `b9f45256` |
| K9-22 DS8, console half | `e536d3f7` | `8bf8d27a` | `fe07c1f0` |
| K9-23 K19, the sandbox entity | `e5a2094c` | `f10d9642` | `d5177517` |
| K9-23 K19, the "Other lists" step | | `5e830921` | `d5177517` (the fixture it needs) |
| 9D Stage 1 amendment 12, the embed page's `style-variant` | | `5e830921` | `4722980a` |
| K9-24 migration 0032 and its rollups | `821b1864` | `ab625953` | `0bacd7dc`, refactor `6f64f58f` |
| K9-25 the sender name in every per-environment sender | | `fb7f9e3e` | `e91ad920`, refactor `6f64f58f` |
| K9-26 case notifications read the preferences | `13352c62` | `55778ece` | `5640f362` |
| K9-27 the unsettled remainder | (documented, `197f055a`) | | |
| K9-28 FE2 | | `e7e008cb` | `aa46001a` |
| K9-29 the list export code and columns | | `08814bb7` | `3fe79790` |
| K9-30 a rotated key's expiry | (documented, `197f055a`) | | |
| K9-31 the delivery search link | (`197f055a`) | | |
| K9-32 the promote copies a set's assets | | `33ea1e33` | `1559aa09` |
| R003 impossible calendar days | `c77f3a1d` (refactor) | `4df130bb` | `6c8dae03`, test fix `e6c3172c` |
| R006 the full-stack globalTimeout | | `d3588da8` | `963b91dc` |

Records: `197f055a` (docs), `887a84f6` (`e2e/README.md`, the `ci.yml` comment), `1060ddb6`
(`apps/dashboard/README.md`, borrowed), `7b2d5420` (the plan's "Workflow 9D review amendments").

## RED and GREEN, item by item

### K9-22 (DS8): the two reads, then the console

- RED `bf852f67`: `packages/contracts/src/phase9d-contracts.test.ts`: `Tests 3 failed (3)`,
  `userEffectivePermissionsDocumentSchema: expected undefined to be defined`;
  `apps/api/src/routes/dashboard/user-access-reads.test.ts`: `6 failed`, `expected HTTP 200, got 404:
  ... No route matches GET /api/v1/dashboard/users/usr_.../roles`, `expected 404 to be 403`.
- GREEN `b9f45256`: the schema, the fixture (`fixtures.test.ts`, `ContractFixturesTest.kt`
  `serverOnly`), `userRoleAssignmentsOf` and `userEffectivePermissionsOf` in `services/users.ts`,
  the two routes, OpenAPI regenerated. Contracts `3 files, 634 passed`; the routes and
  `role-assignments.test.ts` `21 passed`; the OpenAPI tests `74 passed`.
- Console stub `e536d3f7` (the `readAssignments` prop and a `readUserAssignments` that answers
  "not built"). RED `8bf8d27a`: `3 failed`, `7 failed | 76 passed (83)`: `expected { ok: false } to
  deeply equal { ok: true }`, `Unable to find an accessible element with the role "link" and name
  "Effective permissions of Synthetic Reviewer"`, `expected "vi.fn()" to be called with arguments:
  [ 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y71' ]`, `Unable to find an element with the text: The environments
  of the current assignments could not be read`.
- GREEN `fe07c1f0`: `src/app/users src/components/operators src/lib`: `124 files, 2785 passed`;
  `tsc` 0, `eslint` 0 on the touched files. Two corrections on the way, before the commit: the link's
  hidden "of <name>" lost its space under prettier (the name read "Effective permissionsof …"), now
  written as `{`${link} `}` with the span after it, as the dialog's button does; and my new page test
  passes the session's two environments, so "Production" is named.

### K9-23 (K19): `SBX-2003` and the "Other lists" step

- Stub `e5a2094c` (`SANDBOX_WATCHLIST_MAGIC.otherListsEntity`, in no version yet). RED `f10d9642`:
  `src/testing/sandbox.test.ts`: `1 failed | 8 passed`, `Error: no entry SBX-2003`.
- e2e RED `5e830921`, on a fresh stack started at `f10d9642` (stack up 96 s, load 0.6 to 3.4), one
  call with `flow-embed.spec.ts`: `2 failed, 3 passed (1.1m)`: `openverify-sandbox.json holds SBX-2003
  ... toContain(expected)`, and the embed page's `toHaveAttribute ... Expected: "dark" Received: ""`.
- GREEN `d5177517`: the entity in `magicEntities`, the four versions regenerated with
  `OPENVERIFY_WRITE_FIXTURES=1 ... fixture-files.test.ts` then prettier; the watchlist's
  `src/testing` `18 files, 150 passed`; the API's watchlist and report tests at first `2 failed |
  313 passed` (`expected 102 to be 101` names, the sources route's `name-count`), then the counts
  moved (68 to 69 entries, 101 to 102 names): `31 files, 315 passed`. `benchmark:typecheck` 0,
  `benchmark:test` `12 files, 119 passed`. On the gate's stack the step passed in 3.4 s.

### The embed page (9D Stage 1 amendment 12)

- RED `5e830921` (above). GREEN `4722980a`: `styleVariant: optional('style-variant')`. On the gate's
  stack `flow-embed.spec.ts` passed (1.5 s).

### K9-24: migration 0032

- PGlite before, at `4722980a` (0031 last), each under the e2e lock with an empty or a warm
  `OPENVERIFY_TEST_DB_CACHE_DIR`, the timer `createTestDatabase` twice in one process: cold 5,234,
  5,277, 5,112 ms; warm 1,201, 1,206, 1,404 ms; a second copy 934 to 1,087 ms; load 0.53 to 1.59.
- Stub `821b1864` (core: `ANALYTICS_FLOW_START_STEP_ID` and the reason row's two optional members).
  RED `ab625953`: `migration-0032.test.ts` `6 failed (6)`: `expected -1 to be 32`, `column
  "closed_through" does not exist`, `violates check constraint
  "analytics_transition_daily_from_step_id_format"`, `column "verification_type" of relation
  "analytics_check_reason_daily" does not exist`, `expected '2026-11-08T04:14:21.496Z' to be
  '2026-01-02T03:04:05.000Z'`; core `metrics.test.ts` `2 failed | 25 passed`: `expected [ …(4), …(4) ]
  to deeply equal [ { fromStepId: 'consent', … } ]`, `expected [Function] to throw an error`; API
  `phase9d-rollups.test.ts` `3 failed`: `expected [ [ 'consent>selfie', 2 ] ] to deeply equal [ [
  '$start>consent', 3 ], …(1) ]`, `expected [ … ] to have a length of 2 but got 1`, `column
  "closed_through" does not exist`.
- GREEN `0bacd7dc`: the tables, `drizzle-kit generate --name phase9d` (after building core: the first
  generation read core's stale `dist` and wrote `'undefined'` for the start, so it was removed and
  generated again), the hand edits (the backfill, the deletion of unattributable rows, the cleared
  `outcomes_as_of`, the webhooks' trigger), the rollup SQL, the store's dimensions, the state, the
  refresh and rebuild windows, the answers' entries and reasons. Migration test `6 passed`; core
  analytics `9 files, 201 passed` after the goldens `funnel.json` and `checks.json` were rewritten by
  `OPENVERIFY_WRITE_ANALYTICS_GOLDEN=1` and formatted (only those two changed: 120 lines added); API
  analytics `22 passed`, `phase9d-rollups.test.ts` `3 passed`; `phase9b-analytics-tables.test.ts`
  `14 passed` after its column list. Existing tests changed as the plan amendment lists.
- PGlite after, at `0bacd7dc`: cold 5,349, 5,166, 5,775 ms; warm 1,209, 1,181, 1,183 ms; a second
  copy 932 to 1,053 ms; load 0.79 to 1.16.
- A correction to my own RED test, in the GREEN commit: "never lists the start as a transition"
  compared rows without their `inquiryTemplateVersionId`, which `funnelFigures` always serves; the
  expectation now names it, and adds `entries`. It still failed on the code before the GREEN for the
  intended reason (the start listed as a move).

### K9-25: the sender name

- RED `fb7f9e3e`: four files, `4 failed | 161 passed (165)`: `expected [ undefined ] to deeply equal
  [ 'Synthetic Bank' ]` (case emails, workflow email), `expected undefined to be 'Synthetic Bank'`
  (email code, handoff link).
- GREEN `e91ad920`: `fromEnvironment` and its four callers: `18 files, 306 passed` (with the mail,
  OTP and handoff suites). Prettier had reformatted lines of `flow-handoffs.ts` I did not change (the
  file was not prettier-clean before); those were put back and only my lines kept.

### K9-26: preferences for case notifications

- Stub `13352c62`: both writers call `notifyByPreferencesInTx`, which still wrote every channel; the
  case suites stayed green (`131 passed`).
- RED `55778ece`: `notification-channels.test.ts` `4 failed (4)`: `expected { console: [ …(4) ],
  email: [ …(4) ] } to deeply equal { console: [ …(2) ], email: [ …(2) ] }` for each kind, and the
  kind-only test. A route-level mention test was tried and dropped: the dashboard harness serves no
  server route (`No route matches POST /api/v1/cases/.../add-comment`); both writers go through the
  helper by construction (the stub commit).
- GREEN `5640f362`: `insertUserNotifications` in `@openverify/db`, the helper on
  `notificationPreferencesOf`: case, job and notification suites `57 files, 429 passed`; the console's
  notification page `3 passed` with its sentence.

### K9-27 and K9-30: documented

- `197f055a`: `docs/analytics/README.md` ("What suppression does not cover") for the unsettled
  remainder, and `docs/settings/api-keys.md` for a rotated key's expiry (the old key's resource serves
  its end, `api-keys-phase9b.test.ts:119` already holds it; the new key's is `null`). No code, so no
  RED.

### K9-28: FE2

- RED `e7e008cb`: `3 failed | 38 passed (41)`: `expected 2026-10-21T12:16:00.000Z to deeply equal
  2026-10-20T14:17:00.000Z` (`openInquiry`), `expected 2026-10-21T12:17:00.000Z to deeply equal
  2026-10-20T12:48:00.000Z` (`startInquiry`), and the redemption's `expected 2026-10-20T14:00:00.000Z
  to deeply equal 2026-10-20T14:01:00.000Z`. (A first draft of the redemption test advanced the
  clock five minutes and the handoff token had lapsed, 410; it advances one.)
- GREEN `aa46001a`: `applyStartWindowInTx` in `startInquiry`, `extendExpiryOnResumeInTx` in
  `redeemHandoff`: the flow, handoff, inquiry and route suites `41 files, 548 passed`.

### K9-29: the list export

- RED `08814bb7`: contracts `2 failed | 3 passed`; API `1 failed | 25 passed`: `expected { type:
  'about:blank', …(6) } to match object { code: 'export_list_kind_refused', … }`. The per-kind header
  tests passed at once: the job already writes `importColumns(kind)`; they now hold it.
- GREEN `3fe79790`: the code, its golden problem, `EXPORT_CSV_COLUMNS` without `lists`,
  `exportProblem` in `assertExportableList`: contracts `107 files, 4393 passed` (after
  `phase9b-exports.test.ts`' type list), API exports `3 files, 86 passed`; OpenAPI unchanged.

### K9-32: the promote's assets

- RED `33ea1e33`: `expected 422 to be 201`, `promote_unresolved ... The theme set has assets, and
  this promote cannot copy them`.
- GREEN `1559aa09`: `assets: { storage, keyring, ids }` in `promoteTemplate`: the promote and theme
  suites `5 files, 62 passed`.

### R003: impossible calendar days

- Refactor `c77f3a1d`: one `isCalendarDate` with the old rule for both call sites; suites green.
- RED `4df130bb`: `5 failed`: three `isCalendarDate` refusals (`expected true to be false`), the
  screen test, and the fields write `expected 201 to be 422`.
- GREEN `6c8dae03`: the day must round-trip. **The commit was made with one test still failing**
  (`45 files, 1 failed | 593 passed`): my screen test sent `button: 'go'`, a key the screen's button
  (no port of its own) does not answer to, so its refusal had held for the wrong reason in the RED as
  well. `e6c3172c` corrects the test (no button, the refusal found at `/values/visit_date`); run
  against the old rule it fails `4 failed | 8 passed`, against the new one `12 passed`.

### R006: the full-stack globalTimeout

- RED `d3588da8`: `infra/tests/ci-workflow.test.sh`: `249 passed, 1 failed`, `FAIL - e2e: the
  Playwright globalTimeout is at least 60 minutes (Workflow 9D, R006) (45)`.
- GREEN `963b91dc`: `globalTimeout: 60 * 60_000`, the e2e job's `timeout-minutes: 80`: `250 passed`.
  The basis is the measurement below and CI 42382549247 (read with `gh run view --json jobs`).

## Not fixed here, with the exact change

- **`e2e/tests/flow-bundle.spec.ts` under load** (`fix-flow`'s report): it passed in this gate (19 s)
  and alone in `fix-flow`'s run, and failed once in `fix-flow`'s three-spec call (the vision service
  refused the first auto-shutter photo for its pose). Read from the code, not proven by a test: the
  guidance judges a frame sampled at the preview's width, and on an auto-capture `takePhoto` draws the
  video's current frame (`apps/flow/src/lib/capture-frame.ts`) after the detector's latency, so on a
  loaded machine the photo can come from the head-turn clip's next 0.3 s turn. The change is in
  `apps/flow` (not `fix-api`'s): keep a full-resolution copy of the frame each guidance tick samples
  (`use-guidance.ts`) and upload that copy on an auto-capture, with a unit test that a capture
  uploads the judged frame. Routed to `validation-9d`, which may fix in any path.
- **`fix-builder`'s two carried items** (a module list on `app/workflows/[id]/draft/page.tsx`,
  `fix-console`'s; per-component style overrides, a flow-spec contract change in `fix-flow`'s
  package): outside `fix-api`'s paths and the launch's grant; recorded in the plan for Phase 10.
- **`fix-console`'s optional `REPORT_BULK_FILE_CODES` export**: optional, not done.

## Final gates (each in the foreground, its exit code read from the command)

| Gate | Call | Exit | Time | Load |
|---|---|---|---|---|
| Format | `pnpm format:check` | 0 | 99 s | 0.65 to 1.4 |
| Forced typecheck | `pnpm turbo run typecheck --force` (17 tasks), again on the final tree | 0, 0 | 137 s, 120 s | 1.4 to 6.2 |
| Forced lint, API | `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=1 --filter=@openverify/api` | 1, then 0 | 186 s, 182 s | 1.3 to 5.5 |
| Forced lint, dashboard and contracts | the same, `--filter=@openverify/dashboard --filter=@openverify/contracts` | 0 | 202 s | 1.8 to 1.9 |
| Forced lint, the other 14 | the same, the three excluded | 0 | 295 s | 1.5 to 2.0 |
| API unit | 8 blob shards (136, 152, 159, 153, 145, 131, 135, 125 s) and the merge | merge 0 | 33 s | 1.5 to 8.7 |
| db, watchlist, e2e unit | `pnpm turbo run test --force --filter=@openverify/watchlist --filter=@openverify/e2e --filter=@openverify/db` | 0 | 351 s | 1.6 to 6.6 |
| contracts, core unit | the same, `--filter=@openverify/contracts --filter=@openverify/core` | 0 | 23 s | 1.1 to 3.3 |
| Dashboard unit | 2 blob shards (177, 193 s) and the merge | merge 0 | 6 s | 3.1 to 7.3 |
| Integration | db; graph; api shards 1, 2 and 3 of 3 | 0 each | 87, 33, 68, 164, 78 s | 4.2 to 16.7 |
| Android | `:openverify-sdk:testAndroidHostTest`; `testDebugUnitTest koverVerify`; `assembleDebug :openverify-sdk:assemble lint`, under the Gradle lock | 0 each | 87, 11, 80 s | 3.6 to 10.6 |
| OpenAPI and workflow docs | `openapi:write`, `workflow-docs:write`, then `git diff --exit-code` | 0 | 22 s | |
| CI infra test | `bash infra/tests/ci-workflow.test.sh` | 0 | | |
| e2e gate | the mocked flow suite; a fresh stack; the four chromium shards; the console sweep; the stack down | 0 each | below | |

- The forced API lint first failed on two of my test files (`no-unnecessary-type-assertion` in
  `phase9d-rollups.test.ts:149` and `messenger.test.ts:233`), fixed in `6f64f58f` and re-run green.
  The API unit merge ran on the tree before that commit; the two files were run again after it
  (`92 passed`), and the commit changes no behaviour.
- **Counts.** API unit: `692 files, 9,428 tests`, statements 94.39%, branches 85.02%, functions
  96.65%, lines 94.55%. Dashboard: `579 files, 6,715 tests`, 95.59 / 88.42 / 94.94 / 95.63%. db `151
  files, 2,178 tests` (91.06% statements); watchlist `69 files, 820 tests` (98.63%); e2e unit `18
  files, 131 tests` (97.1%); contracts `107 files, 4,393 tests` (99.11%); core `58 files, 1,655
  tests` (99.17%). Integration: db 78, graph 13 (its template built in 15.6 s of its 180 s guard),
  api 89, 99 and 79. Android: 1,366 SDK host tests, equal to CI's floor (the new fixture is
  `serverOnly`, so no test was added), every Android task green.
- **OpenAPI** sha256 `e229bd12ee96e903a9a7f38aa429b9f52712288af77d4f5c20933a19175a852f` (the two
  K9-22 routes), stable on a second write; `docs/workflows` unchanged.

## The e2e gate and the suite's measurement (rule 7 (c), each step under the e2e lock)

| Step | Tests | Time | Load (before, after) |
|---|---|---|---|
| Mocked flow suite | 328 passed | 111 s (1.8 min) | 1.30, 10.56 |
| Build of the e2e dependencies | | 28 s | 6.41 after |
| Stack up | | 97 s | 3.04 after |
| `--project=chromium --shard=1/4` | 47 passed | 229 s | 2.65, 1.99 |
| `--shard=2/4` | 46 passed | 293 s | 1.91, 2.66 |
| `--shard=3/4` | 46 passed | 271 s | 1.91, 2.99 |
| `--shard=4/4` | 44 passed | 370 s | 2.33, 2.65 |
| `--project=console-sweep --no-deps` | 104 passed (98 pages, 6 CSP) | 294 s | 1.96, 3.11 |
| Stack down | | | |

The sweep's `/graph/[id]` took 10.9 s (138 to 147 s before R009) and `/error-probe` 0.9 s. My two
new full-stack steps passed (Other lists 3.4 s, the dark embed 1.5 s), and `flow-bundle.spec.ts` in
19.0 s. No OTP send was added. CI 42382549247's job times are in the plan's amendment; none is inside
the last 25% of its timeout except the e2e run's projection, decided as R006.

`git status --porcelain` is empty for my paths; the stack is down; nothing of mine is left running
(the PGlite timer script was removed).
