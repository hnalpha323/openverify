# TDD evidence: Workflow 6C, the report API and its contracts (`api-reports-6c`)

- **Slice owner:** `api-reports-6c`, Workflow 6C Stage 1, beside `evaluation-set-6c`, `matcher-6c` and `ingestion-6c`.
- **Date:** 2026-10-28.
- **Input:** the plan's "Owner decisions after Workflow 6B", decisions 11, 12, 14, 15 (K6A-12, K6A-10), 16, 17 and 18, and the evidence members of decision 9.
- **Paths owned:** `packages/contracts/src/`, `packages/checks/src/reports/`, `packages/checks/data/reports/`, `packages/node/`, `apps/api/src/services/reports/`, `apps/api/src/services/{redaction,retention}.ts`, the report routes, `apps/api/src/jobs/reports/` and `jobs/report-types/` except matcher-6c's files, the six report repositories of `packages/db` with their tests, `docs/api/openapi.json`, `contracts/fixtures/`, the Android `ContractFixturesTest` when a fixture needs it, four dashboard files in Stage 1 only, five `docs/reports/` pages and this file.

Each slice follows the same cycle:
1. A stub (`chore`), only when a test needs a name that does not exist yet, so the RED commit type-checks.
2. The test, run to see it fail for the intended reason (RED, `test` commit). Each RED commit compiles, type-checks and lints.
3. The smallest change that passes it (GREEN, `feat` or `fix` commit).
4. A refactor with the suite green, where one was worth making.

All commands ran after `source scripts/env.sh`. "vitest (pkg) …" stands for `pnpm --filter @openverify/<pkg> exec vitest run <files> --coverage.enabled=false`. Output is trimmed to the lines that matter. Every name, number and value in these tests is synthetic.

## Slice 1: the phone reasons `prepaid`, `payphone` and `other_line_type` (owner decision 14, K6A-4)

Decision 14 (decision 3 of the 6A decisions): a provider-reported `PREPAID` is `medium` with the reason `prepaid`; `PAYPHONE` is `medium` with `payphone`; `OTHER` makes no contribution, with the reason `other_line_type`, and the level stays `null` unless a SIM swap sets it. One change covers the contract, the evaluator, the API and the dashboard's words, because `PHONE_RISK_REASON_WORDS` is a `Record` keyed by `PHONE_RISK_REASONS` (Stage 1 dashboard-reports amendment 12).

Tests:
- `packages/checks/src/reports/phone/report.test.ts`: prepaid and payphone are `medium` / `flag` at 0.4 with their reason, and nothing in `unavailable-fields` for the level; a prepaid line with a SIM swap 2 h ago is `high` at 0.8 with both reasons; a payphone ported 10 days ago stays `medium` with both reasons. `OTHER` states `other_line_type` with a `null` level (`undetermined` for the three risk fields) and no reason confidence; with a SIM swap 2 h ago it is `high`; with a swap 48 h ago or a port 10 days ago it stays `null`. The old test "leaves the level null for a type the table has no row for" asserted prepaid as `null` with no reason; the plan changes that behaviour, so it was replaced (see contractDeviations).
- `packages/checks/src/reports/constants.test.ts`: `phone-confidence-prepaid` and `phone-confidence-payphone` exist at 0.4, as `phone-confidence-ported`.
- `packages/contracts/src/reports.test.ts`: `PHONE_RISK_REASONS` is the twelve reasons in order, and a phone report with `PREPAID` and `prepaid` parses.
- `apps/dashboard/src/lib/report-field-words.test.ts`: the three reasons have words; `general_delivery` reads "General delivery (held at a post office)".
- `apps/api/src/jobs/report-types/phone-number.test.ts`: the sandbox's ending `02` through the job is `PREPAID`, `medium` / `flag` at 0.4 with `['prepaid']`, and the served document parses. The existing alignment test (`PHONE_LEVEL_REASONS` equals `PHONE_RISK_REASONS`) holds the evaluator and the contract together.

```text
RED   $ vitest (checks) src/reports/phone src/reports/constants.test.ts
     × weighs the provider-reported phone-confidence-prepaid as weak evidence, as a recent port (owner decision 14)
AssertionError: expected [ 'email-confidence-list-fact', …(35) ] to include 'phone-confidence-prepaid'
     × reads a provider-reported prepaid or payphone line as medium / flag (owner decision 14)
AssertionError: expected { type: 'PREPAID', level: null, …(3) } to deeply equal { type: 'PREPAID', …(4) }
     × states other_line_type and leaves the level null unless a SIM swap reaches high
-   "reasons": [
-     "other_line_type",
-   ],
+   "reasons": [],
      Tests  4 failed | 86 passed (90)
RED   $ vitest (contracts) src/reports.test.ts
     × names a reason for every provider line type the risk table reads, other_line_type without a level (owner decision 14)
AssertionError: expected [ 'invalid_number', …(8) ] to deeply equal [ 'invalid_number', …(11) ]
      Tests  1 failed | 60 passed (61)
RED   $ vitest (dashboard) src/lib/report-field-words.test.ts
     × says the provider line-type reason prepaid in words (owner decision 14)
AssertionError: expected [ 'invalid_number', …(8) ] to include 'prepaid'
     × says the address-designators value general_delivery as General delivery (held at a post office)
AssertionError: expected undefined to be 'General delivery (held at a post offi…' // Object.is equality
      Tests  4 failed | 127 passed (131)
      $ pnpm --filter @openverify/{checks,contracts,dashboard} typecheck   (the RED tests)
$ tsc --noEmit                      (each passes)
RED   $ vitest (api) src/jobs/report-types/phone-number.test.ts   (the evaluator and contract of 64fe0635)
     × reads a sandbox prepaid line as medium / flag with the reason prepaid (owner decision 14)
-   "phone-risk-level": "medium",
+   "phone-risk-level": null,
     × serves the contracts’ vocabularies
GREEN $ vitest (checks) src/reports
 Test Files  13 passed (13)
      Tests  386 passed (386)
      $ vitest (contracts)
 Test Files  61 passed (61)
      Tests  2072 passed (2072)
      $ vitest (dashboard) src/lib/report-field-words.test.ts src/components/reports
 Test Files  8 passed (8)
      Tests  179 passed (179)
      $ vitest (api) src/jobs/report-types/phone-number.test.ts src/jobs/report-types/report-golden-fixtures.test.ts src/providers/phone-intelligence
 Test Files  3 passed (3)
      Tests  24 passed (24)
```

The API test was written after the evaluator change, so its RED was taken by putting the committed `packages/checks/src/reports/phone/report.ts` (the RED commit's) back for one run and then restoring the change; it failed on the level and on the alignment test, as intended.

Change (`c19d96d2`): `PHONE_RISK_REASONS` and `PHONE_LEVEL_REASONS` gain the three reasons in level order; `TYPE_REASONS` maps `PREPAID`, `PAYPHONE` and `OTHER` to them; `REASON_LEVELS` allows `null` for a reason that adds no level, and the level is incomplete (so `null` unless `high`) when the type's reason has none; `phone-confidence-prepaid` and `phone-confidence-payphone` are provisional 0.4 with their basis; the console words the reasons and `general_delivery`; `docs/reports/phone-number.md` gives the table and a basis for every constant.

## Slice 2: `forgetReportCopies` reuses `forgetStoredResponses`, and the media pages state `und` (owner decision 15: K6A-12, K6A-10)

**K6A-12.** `forgetReportCopies` (`packages/db/src/repositories/reports.ts`) carried a copy of the SQL of the private `forgetStoredResponses` (`repositories/redaction.ts`). Tests (`packages/db/src/repositories/redaction.test.ts`): `forgetStoredResponses` is exported from `@openverify/db` and clears the API-log bodies about a report or naming it in a list, and its idempotent answer, while a bystander's log stays; `forgetReportCopies` clears the same (a characterisation of the existing behaviour, which passed before and after).

```text
RED   $ vitest (db) src/repositories/redaction.test.ts
     × is exported from @openverify/db and clears the stored copies about or naming the ids
AssertionError: expected 'undefined' to be 'function' // Object.is equality
      Tests  1 failed | 9 passed (10)
GREEN $ vitest (db) src/repositories/redaction.test.ts src/repositories/report-repositories.test.ts src/repositories/report-redaction-entries.test.ts
 Test Files  3 passed (3)
      Tests  27 passed (27)
      $ vitest (api) src/services/reports src/routes/server/report-redaction.test.ts
 Test Files  5 passed (5)
      Tests  24 passed (24)
```

Change (`52f1d156`, a refactor that makes the export test pass): `forgetStoredResponses` is exported, and `forgetReportCopies` stubs the events, then calls it. Four imports that only the copy used are gone.

**K6A-10.** Test (`apps/api/src/jobs/report-types/adverse-media.test.ts`): `adverse-media.md` and `business-adverse-media.md` both say that an article whose language GDELT does not name is served as `` `und` ``, the job's `UNDETERMINED_LANGUAGE`.

```text
RED   $ vitest (api) src/jobs/report-types/adverse-media.test.ts
     × says in adverse-media.md that an article whose language GDELT does not name is served as und
AssertionError: expected '# Adverse media report (`report/adver…' to contain '`und`'
     × says in business-adverse-media.md that an article whose language GDELT does not name is served as und
      Tests  2 failed | 12 passed (14)
GREEN $ vitest (api) src/jobs/report-types/adverse-media.test.ts src/report-docs.test.ts
      Tests  24 passed (24)
```

Change (`a5f370fc`): each page says the language is `und` (BCP 47 and ISO 639-2 for undetermined; the console reads "Undetermined") and that the title is read with all four lexicons.

## Slice 3: review and dismissal need `pii:view` in the API (owner decision 16, a C75.5 amendment)

**Who reviews or dismisses today** (searched before the change, every caller of `/dismiss`, `/review`, `dismissReportMatches` and `reviewReportMatches`, and the client methods):
- `apps/api/src/routes/server/report-review.test.ts`: `api.token`, the harness key, created by `createApiKey` without `piiMasked`, so unmasked; `writer`, an unmasked key without `reports:review` (the 403 scope case); `developer` only reads API logs.
- `apps/api/src/routes/server/report-redaction.test.ts` and `report-routes.test.ts`: `api.token` and `api.newApiKey(...)`, unmasked keys.
- `apps/api/src/jobs/reports/report-races.integration.test.ts`: calls `dismissReportMatches` directly, below the route, so the route check does not apply.
- `e2e/tests/report-watchlist.spec.ts` and `report-monitoring.spec.ts`: the stack's key, which `seed:dev` creates with every scope and no `piiMasked` (`apps/api/src/seed/dev-seed.ts`), so unmasked.
- `e2e/tests/ui-reports.spec.ts`: the console's seeded reviewer, whose built-in role holds `pii:view`; the console already required `pii:view` (6B dashboard-reports amendment 4).
- `packages/node/src/resources.test.ts`: a mocked fetch. `apps/dashboard/src/app/reports/actions.ts`: already requires `reports:review` and `pii:view`.

None reviews or dismisses as a user without `pii:view` or as a masked key, so no existing test changed.

Tests (`report-review.test.ts`, a new block): a user with `reports:read` and `reports:review` only, and a key stored `pii_masked` (as `services/api-keys.ts` stores one a user without `pii:view` mints) with `reports:read` and `reports:review`, each get 403 `forbidden` naming `pii:view` on a dismissal, on a review, and on a dismissal of a report id that does not exist (refused before the report is read); the match stays `open` and `pending`, no event is staged and no action is written. The unmasked harness key and a user with `pii:view` keep reviewing and dismissing.

```text
RED   $ vitest (api) src/routes/server/report-review.test.ts
     × refuses a user without pii:view with 403 forbidden, before reading the report, and changes nothing
     × refuses an API key minted masked with 403 forbidden, and changes nothing
AssertionError: /reports/rep_01M61TGGFGJ8HGDSFHJ0N2XAZX/dismiss: expected 200 to be 403 // Object.is equality
      Tests  2 failed | 14 passed (16)
GREEN $ vitest (api) src/routes/server/report-review.test.ts src/routes/server/report-routes.test.ts src/routes/server/reports.test.ts src/routes/server/report-redaction.test.ts
 Test Files  4 passed (4)
      Tests  76 passed (76)
      $ pnpm --filter @openverify/api openapi:write && vitest (api) src/openapi.test.ts
      Tests  13 passed (13)
```

Change (`f57e971e`): both handlers call `requirePiiView(requirePrincipal(request))` first, after the plugin's `reports:review` scope check. `requirePiiView` lets an API key through unless it was minted masked and otherwise calls `authorizePrincipal(principal, ['pii:view'])`, which a masked key never passes, since no API scope is `pii:view`. The route descriptions say so, as do the `@openverify/node` method comments. The OpenAPI document was regenerated in the same commit; it also carries slice 1's three phone reasons, which `c19d96d2` had left out of the document.

## Slice 4: the sources document's media figures, matcher state and named warnings (owner decisions 17 and 18, R004)

Decision 17 adds three members to `GET /dashboard/watchlist-sources`: `name` and `report-type` on each template warning, `media.attribution` with the GDELT citation, and `matcher: { loaded, keys-version }`. Decision 18 replaces the install's scheduled media runs per day, which told one tenant the others' load, with the asking environment's own figure beside the install budget and one boolean for the install above 80% of it; the install-wide member is removed in the same change, and the console's share is computed from the environment's own count.

Stub (`66062e06`): `WatchlistSourcesInput` takes `matcher: { loaded, keysVersion }` and `mediaRuns: { environment, install }` (the document unchanged), and `scheduledMediaRunLoad(db, environmentId)` rejects as not built, so the RED tests type-check. Its two unit tests changed only their inputs to the new shape.

Tests:
- `packages/contracts/src/watchlist-sources.test.ts` with `contracts/fixtures/api/dashboard-watchlist-sources.json` in the new shape: `media` is exactly the environment's runs, the budget, the share, `install-above-warn-share` and the citation; a document that still carries `scheduled-runs-per-day`, or lacks the flag, is refused; `matcher` carries a keys version exactly when loaded (both inconsistent pairs refused); a warning without `name` is refused.
- `packages/db/src/repositories/report-repositories.test.ts`: `listReportTemplateSourceLists` returns each template's `name`; `scheduledMediaRunLoad` counts 1.75 runs a day for the environment (recurring, unpaused, unredacted media reports only) and 1.95 more for the install once another tenant adds a report every 5 days, whose own figure is 0.2. The old install-only test became this one.
- `apps/api/src/routes/dashboard/watchlist-sources.test.ts`: over HTTP, `media` is the environment's 0 or 0.5 while another tenant's report adds to the install, with the flag `false` and `GDELT_CITATION`; `matcher` follows `loadMatcherData()`; the warned template carries its name and `watchlist`. Unit: `matcher` is `{ loaded: false, keys-version: null }` without the data; the flag is `false` at exactly 80% of the budget (13,824) and `true` above, and the install's figure appears nowhere in `media`.
- `apps/dashboard/src/components/report-config/source-words.test.ts`: `mediaBudget` takes the share from the environment's own runs and `warn` from the install's flag; the fixture builder writes the new members.

```text
RED   $ vitest (contracts) src/watchlist-sources.test.ts src/fixtures.test.ts
     × dashboard-watchlist-sources.json parses and re-serializes unchanged
     × serves the asking environment’s own scheduled media runs, the budget, whether the install is above 80% of it and the GDELT citation, never the install’s total (R004)
     × says whether this process holds the matcher data, with its keys version only when it does
     × names each warned template and its report type
ZodError: [ { "expected": "number", "code": "invalid_type", "path": [ "media", "scheduled-runs-per-day" ] … "code": "unrecognized_keys" …
      Tests  5 failed | 190 passed (195)
RED   $ vitest (db) src/repositories/report-repositories.test.ts
     × lists the active templates’ pinned source lists from their published versions
AssertionError: expected [ { …(3) }, { …(3) } ] to deeply equal [ { …(4) }, { …(4) } ]
     × counts the environment’s and the install’s scheduled media runs per day over recurring, live media reports, in one read (C81.2, owner decision 18)
Error: scheduledMediaRunLoad(object, env_01M61V4EMZPGEQSGEQ99TEJ9R1) is not built yet (owner decision 18)
      Tests  2 failed | 11 passed (13)
RED   $ vitest (api) src/routes/dashboard/watchlist-sources.test.ts
     × serves every manifest source with its row, counts, last sync and re-screen, in the frozen schema
AssertionError: expected { 'scheduled-runs-per-day': +0, …(2) } to deeply equal { …(5) }
     × says whether this process holds the matcher data, so a missing file never reads as a re-key (owner decision 17)
AssertionError: expected undefined to deeply equal { loaded: true, …(1) }
     × flags the install above 80% of the GDELT budget with one boolean, beside the environment’s own runs (owner decision 18, R004)
      Tests  6 failed | 1 passed (7)
RED   $ vitest (dashboard) src/components/report-config/source-words.test.ts
     × takes the share from this environment’s own runs and the warning from the install’s flag, never the other tenants’ total (owner decision 18, R004)
AssertionError: expected { runsPerDay: undefined, …(3) } to deeply equal { runsPerDay: 12.5, …(3) }
      Tests  2 failed | 17 passed (19)
GREEN $ vitest (contracts)
 Test Files  61 passed (61)
      Tests  2075 passed (2075)
      $ vitest (db) src/repositories/report-repositories.test.ts
      Tests  13 passed (13)
      $ pnpm --filter @openverify/api openapi:write && vitest (api) src/openapi.test.ts src/routes/dashboard
 Test Files  18 passed (18)
      Tests  211 passed (211)
      $ vitest (dashboard) src/testing src/app/watchlist-sources src/components/report-config
 Test Files  10 passed (10)
      Tests  125 passed (125)
```

The first GREEN run of contracts failed `browser-safety.test.ts`: a doc comment of mine read `from "needs re-key"`, which the scan takes for an import specifier. The comment was reworded.

Change (`ea6e95d4`):
- **Contract.** `media` is `{ environment-scheduled-runs-per-day, install-budget-per-day, warn-above-share, install-above-warn-share, attribution }`; `matcher` is `{ loaded, keys-version }`, refined so the version is served exactly when loaded; each warning adds `name` (`reportTemplateNameSchema`) and `report-type`.
- **Database.** `scheduledMediaRunLoad` reads both sums in one statement (a `filter` on the environment), and replaces `scheduledInstallMediaRunsPerDay`, which nothing else called. The template read selects `t.name`.
- **API.** The route serves the environment's figure, compares the install's with 80% of the budget (strictly above), cites `GDELT_CITATION`, and passes `loadMatcherData()`'s status.
- **Console** (the Stage 1 minimum). The fixture builder writes the new shape (`installAboveWarnShare` defaults to whether this environment's own runs pass 80%, since they are part of the install's) with a synthetic `KEYS_VERSION`, and `mediaBudget` reads the environment's runs and the install's flag. The view's sentence and badge are `console-tests-6c`'s, in Stage 2.
- The OpenAPI document was regenerated.

## Slice 5: every redaction writes a `redact` action with its actor (owner decision 12, K6A-8 (d))

The frozen `ReportRedactionOptions` carried only `at`, so a redaction wrote no `redact` action and the history could not say who removed the data (6A Stage 3 api-reports amendment 10). Decision 12: every redaction writes one, with its actor: `user` or `api_key` for `DELETE /reports/:id`, `system` for the inquiry and account cascades and retention.

Stub (`1cc257d6`): `ReportRedactionActor` and an optional `actor` on `ReportRedactionOptions`, nothing written, so the RED tests type-check.

Tests:
- `apps/api/src/routes/server/report-redaction.test.ts` (the real redaction and accounts services): a `DELETE` by the harness key, twice, writes one `redact` action (`api_key`, the key's id, no details) and the history serves it with that actor and a `null` reason; a `DELETE` by a user session with `reports:read` and `reports:redact` writes one by that user; the inquiry cascade, the account cascade and `redactReport(ctx, id, null)`, which is how retention calls it, each write one by `system`; the account catch-up, called directly, writes one by `system`.
- `apps/api/src/services/report-redaction-hooks.test.ts` (the hooks mocked): the inquiry and account hooks receive `actor: { actorType: 'system', actorId: null }`, whoever redacted the inquiry or account; `redactReport` passes the API key's actor, and `null` (retention) passes `system`. These four existing assertions changed with the plan (see contractDeviations).

```text
RED   $ vitest (api) src/routes/server/report-redaction.test.ts src/services/report-redaction-hooks.test.ts
     × redacts an inquiry's reports in the inquiry's transaction and dispatches their events
AssertionError: expected { …(3) } to deeply equal { …(4) }
     × records nothing again for a report already redacted, and answers 404 for an unknown one
AssertionError: expected { at: 2026-10-27T12:00:00.000Z } to deeply equal { at: 2026-10-27T12:00:00.000Z, …(1) }
     × records the API key that deletes the report, once, served in its history without details
AssertionError: expected [] to deeply equal [ { actorType: 'api_key', …(2) } ]
     × records the user who deletes the report
AssertionError: expected [] to deeply equal [ { actorType: 'user', …(2) } ]
     × records system for the inquiry and account cascades and for retention
AssertionError: rep_01M61WCVGR1G8JB93FP3WMJB4Y: expected [] to deeply equal [ { actorType: 'system', …(2) } ]
      Tests  8 failed | 5 passed (13)
GREEN $ vitest (api) src/routes/server/report-redaction.test.ts src/services/report-redaction-hooks.test.ts src/services/reports src/routes/server/report-review.test.ts src/services/redaction.test.ts src/services/retention.test.ts
 Test Files  9 passed (9)
      Tests  90 passed (90)
      $ vitest (db) src/repositories/report-repositories.test.ts src/repositories/report-redaction-entries.test.ts src/repositories/report-rewrap.test.ts src/repositories/redaction.test.ts
 Test Files  4 passed (4)
      Tests  29 passed (29)
      $ vitest (api) src/routes/server/reports.test.ts src/routes/dashboard/reports.test.ts src/jobs/reports
 Test Files  5 passed (5)
      Tests  48 passed (48)
```

Change (`1e335a0c`): `actor` is required on `ReportRedactionOptions`. `redactReportInTx` inserts the `redact` action after `redactReportRecords` on a first redaction only, with `details: null` (`insertReportAction` now takes `null` and stores no ciphertext), so the action holds nothing to redact, a second redaction writes nothing, and the audit entry's `action-count` still counts the actions that were redacted. `services/redaction.ts` passes `system` to both cascades and the catch-up, and maps `redactReport`'s `AuditActor` to `user` or `api_key`, or to `system` when there is none (retention). The system actor and the mapping live in `services/redaction.ts`, because the hooks test mocks `services/reports/redaction.js` whole.

## Slice 6: the evidence members of decision 9 (`list-memberships`, `relative-of-class`)

`ingestion-6c` landed the record members first (`fc88287e`: `list_memberships[] {list, program}` on OFAC entries of its non-SDN lists, `relative_of_class` 1-4 on a PEP relative), then the hashes (`6530831a`), the OFAC parser (`3d749d24`) and the PEP build (`832fd6ba`). This slice adds both as optional members of the match evidence and of the sealed snapshot.

Stub (`c52e1bde`, throwing as not built): `recordEvidence(record)` in `apps/api/src/jobs/report-types/record-evidence.ts`.

Tests:
- `packages/contracts/src/reports.test.ts`: a watchlist, business-watchlist or crypto entity with `list-memberships` (a programme or `null`) parses; an empty list is refused (absent, never empty); each golden fixture still parses without it. A PEP relative with `relative-of-class: 1` parses; a class of 5 or 0, or a class on a holder (`pep-type: pep`), is refused.
- `apps/api/src/jobs/report-types/record-evidence.test.ts`: the memberships are copied in the served names, a relative's class is stated, and a record without them adds nothing.
- `apps/api/src/routes/server/report-review.test.ts`: a run whose found match's snapshot entity carries `list-memberships` is `ready`, served in `matched-lists`, parses against `watchlistReportResourceSchema`, and keeps the member in the ignore list once dismissed.

```text
RED   $ vitest (contracts) src/reports.test.ts
     × carries the list memberships of an entry on a non-blocking list, and a relative’s PEP class, as optional evidence (owner decision 9)
AssertionError: watchlist: expected false to be true // Object.is equality
      Tests  1 failed | 61 passed (62)
RED   $ vitest (api) src/routes/server/report-review.test.ts src/jobs/report-types/record-evidence.test.ts
     × names an entry’s lists other than the SDN List, each with its programme or null
Error: recordEvidence is not built yet (owner decision 9; 1 members)
     × serves an entry’s list memberships from the snapshot in the matched lists and the ignore list, in the contract
AssertionError: expected { status: 'errored', …(25) } to match object { status: 'ready', errors: [] }
-   "errors": [],
-   "status": "ready",
+   "errors": [
      Tests  5 failed | 16 passed (21)
GREEN $ vitest (contracts)
 Test Files  61 passed (61)
      Tests  2076 passed (2076)
      $ vitest (api) src/routes/server/report-review.test.ts src/jobs/report-types
 Test Files  11 passed (11)
      Tests  113 passed (113)
      $ vitest (api) src/webhooks src/routes/dashboard/reports.test.ts src/routes/server/reports.test.ts
 Test Files  7 passed (7)
      Tests  356 passed (356)
      $ vitest (dashboard) src/components/reports src/app/reports src/testing src/lib
 Test Files  92 passed (92)
      Tests  2110 passed (2110)
```

The served RED shows the framework's own guard: a found match whose snapshot its type's served shape refuses ends the run `errored` with `execution_error`, so the API could not carry the member until the contract took it.

Change (`3c01712f`): `listEntryBase` (person, business and crypto entities) gains `list-memberships` (1-100 of `{ list, program | null }`, caps of the record's labels), and the PEP entity `relative-of-class` (1-4), refined to a relative. `recordEvidence` maps the record's members to those names, only when present. The API serves the snapshot's entity as stored (`entityOf` in `services/reports/resources.ts`), so no resource code changed. The business-watchlist golden fixture's entity now carries a synthetic membership; the OpenAPI document was regenerated.

**Not done here:** the entity builders that write the snapshot are `matcher-6c`'s files (`jobs/report-types/{watchlist,business-watchlist,crypto-address-watchlist,politically-exposed-person}.ts`), so no run writes the members yet. The followup for `fix-6c` gives the one-line change for each.

## Slice 7: the three completion-report races on Postgres (owner decision 11, K6A-7)

C74.6 asked for completion-hook creation against consolidation, completion-hook creation against account redaction, and the initial run's account link against consolidation. Each needs one writer held inside its transaction while the other runs:
- **the inquiry transition** is held by the test itself: it calls `transitionInquiryInTx` inside `db.transaction` and waits on a gate after the call returns, so the inquiry row is updated and locked and the report hook has inserted the report, uncommitted;
- **the consolidation** (`consolidateAccounts`) is held at its first staged event (`account.consolidated`), after it locked both accounts, moved the inquiries and moved the report links;
- **the account redaction** is held at the first event its inquiry redaction stages (`inquiry.redacted`), after `redactInquiryRecords` locked and redacted the inquiry;
- **the initial run** is held at its `.ready` event, after it share-locked the account, linked it and wrote the report.

Tests (`apps/api/src/jobs/reports/report-races.integration.test.ts`, Postgres 17 by Testcontainers with `POSTGRES_TEST_COMMAND`), each pending at least 1.5 s while the other writer is held:
1. consolidation during the completion: it waits for the inquiry row; then the report exists linked to the inquiry only, the inquiry is on the absorbing account, and the initial run links that account (home and `report_accounts`);
2. completion during a consolidation: it waits for the inquiry row the consolidation moved; the initial run links the absorbing account;
3. account redaction during the completion: it waits for the inquiry; the new report is redacted with it, and its initial run is never claimed;
4. completion that waited for an account redaction: the inquiry is redacted and no report of it is left unredacted;
5. consolidation during the initial run's account link: it waits for the run's share lock; the run linked the absorbed account, and the consolidation then moved the link, so only the absorbing account is linked;
6. initial run during a consolidation: the run's share lock on the absorbed account waits; it then follows `consolidated_into` and links the absorbing account.

A unit test beside the hook (`apps/api/src/services/reports/completion.test.ts`, PGlite) pins the rule of case 4: an inquiry read before its redaction, whose row is redacted when the move runs, gets no report.

```text
$ cat /proc/loadavg
19.96 17.31 13.72 10/1958 2654181
RED   $ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/jobs/reports/report-races.integration.test.ts -t "completion reports against consolidation"
     × a completion that waited for an account redaction creates no report for the redacted inquiry 1646ms
AssertionError: expected [ { …(3) } ] to deeply equal []
      Tests  1 failed | 5 passed | 17 skipped (23)
RED   $ vitest (api) src/services/reports/completion.test.ts
     × creates no report for an inquiry redacted while its completion waited for the row (owner decision 11)
AssertionError: expected [ 'rep_01M61Y67D77NFWWKTZ9EPDCGRK' ] to deeply equal []
      Tests  1 failed | 6 passed (7)
GREEN $ vitest (api) src/services/reports/completion.test.ts
      Tests  7 passed (7)
      $ cat /proc/loadavg
13.92 16.25 14.16 7/2186 2661723
      $ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/jobs/reports/report-races.integration.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

Five of the six orders already held: the hook takes no account lock, so neither order deadlocks, and the run's share lock with `lockAbsorbingAccount`'s walk along `consolidated_into` and `moveReportLinksInTx` give the absorbing account either way. Case 4 exposed a defect. Settlement reads the inquiry without a lock and moves it with a conditional update. When an account (or inquiry) redaction commits while that update waits for the row, the transition goes on, and the hook created an unredacted report from a redacted inquiry. The inquiry's reports had already been redacted, and the report had no account link yet, so no cascade or catch-up ever reached it.

Fix (`71ad3bf8`): the hook returns no report when the row the transition updated, which it holds, is redacted. Rewrapped comment: `9e54b678`. The transition itself still moves a redacted pending inquiry to `completed` (Phase 2 behaviour, in `services/inquiries.ts` and `services/inquiry-settlement.ts`, which 6C freezes); a followup for `fix-6c` names it.

## Final gates

Run in the foreground after the last code commit (`9e54b678`; `9102ee40` is a docs line), on the shared tree with the other Stage 1 agents' work in progress. The load average is given beside the long runs.

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/contracts test` | 61 files, 2,076 tests; 99.23 / 96.17 / 98.28 / 99.21 (statements / branches / functions / lines) |
| `pnpm --filter @openverify/checks test` | 161 files, 3,307 tests; 98.73 / 91.31 / 99.32 / 98.71 |
| `pnpm --filter @openverify/node test` | 7 files, 250 tests; 98.87 / 94.06 / 100 / 99.13 |
| `pnpm --filter @openverify/db test` | 77 files, 977 tests; 95.77 / 89.77 / 96.51 / 96.11 (load 13.4) |
| `pnpm --filter @openverify/dashboard test` | 264 files, 3,873 tests; 98.72 / 93.37 / 99.14 / 98.72 (load 14.2) |
| API suite, rule 8: shard 1/2, shard 2/2 (blob reports), then `--merge-reports --coverage` | 319 files, 4,513 tests; 96.39 / 88.27 / 98.11 / 96.43; the merge exits 0 (each shard alone misses the gate, as expected; load 13.3 to 14.7) |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | 14 of 14 tasks each; every file formatted |
| `pnpm test:integration` | db 12 files, 60 tests; API 27 files, 153 tests (second and third runs, load 8.2 to 18.9). The first run (load 6.4 to 15.7) failed two API files outside my paths at file level, `src/trust-anchors/sync-races.integration.test.ts` and `src/routes/flow/one-time-links.integration.test.ts` (their 4 tests skipped, so a hook failed), while 149 tests passed; my filtered output did not keep the error. Both passed alone and in the two later full runs (see the followup). |
| `pnpm --filter @openverify/api openapi:write`, twice | the committed document is unchanged after both (`345935b3…24d3`) |
| `./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.model.ContractFixturesTest'` | 80 tests, 0 failed (two `api/` fixtures changed; both are `serverOnly`) |
| e2e, rule 7: `flock … pnpm --filter @openverify/flow e2e`, then `--shard=1/3`, `2/3`, `3/3` | mocked flow 69 passed (22.1 s); full stack 31 (2.7 min), 31 (5.1 min) and 29 (4.5 min) passed, every report spec among them (`report-watchlist`, `report-monitoring`, `report-inquiry`, `report-risk`, `ui-reports`, `ui-report-config`); load 7.8 to 11.0 at the starts, 2.4 to 5.8 at the ends |
