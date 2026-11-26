# TDD evidence: Workflow 6A Stage 1a, `contracts-6` (Phase 6)

- **Slice owner:** the Workflow 6A Stage 1a `contracts-6` agent, running alone (it may touch any path its deliverables need).
- **Date:** 2026-10-27.
- **Base:** `fe4850ca`; this stage's commits run from `42a7d78a` to the commit that adds this file.
- **Input:** the "Stage 1a: contracts-6" bullet of `docs/plans/phase-6.plan.md` (C69-C76, C77.1, C77.3, C77.5, C78.3, C78.4, C79.1, C84.1, C87, F01, F08, F09, F12, F21, V06, V12). The drift and the decisions are in the plan's "Workflow 6A Stage 1a amendments (contracts-6)".

Each change follows the same cycle:
1. A stub (`chore`) only when a test needs a name that does not exist yet, so the RED commit compiles and type-checks.
2. The test, run to see it fail for the intended reason (RED, `test` commit).
3. The smallest change that passes it (GREEN, `feat` commit), then a refactor with the suite green where one was worth making.

All commands ran after `source scripts/env.sh`. Output is trimmed to the lines that matter. Every name, address, number, wallet, LEI, QID and article in these tests and fixtures is synthetic.

## 0. Starting point, re-verified

Re-checked before any change (`grep`, `ls` and the files named); the full list is amendments 1-8:
- **Drift:** the newest migration is `0019_submitted_verifications_index.sql`, so Phase 6 starts at `0020`.
- **Drift:** C58's `foldText()` already returns the ICAO §6.A `expanded` rendering beside the `simplified` one; the private `agreement.ts` table was still exported, as planned.
- **Drift:** the outbound client returns `headers` (`location`, `expires`, `cache-control`) and takes `acceptMissingContentType`; still no stream, no redirect, 1 MiB and 10 s.
- **Drift:** the RDAP client exists with its pacing and an install-wide date cache keyed by an unsalted domain hash (a question for `api-providers`, amendment 4); `PROVIDER_NAMES` has no `none`; the repeatable registry is `phase5RepeatableJobs`.
- **Drift:** e2e has 82 tests; Playwright's global timeout is 45 minutes and CI's e2e job 70.
- **As stated:** no `resolveTxt`; the redaction prefixes, PGlite extensions, `.dockerignore` data files, the events name check, the strict template settings and the API rate limit are as the plan says.

## 1. Core: registry, state machines, constants, defaults (C69, C71.2, C75.8, C78.4, C79.1)
Stub 42a7d78a; RED 8958a104; GREEN 1182d923.
RED:
$ (cd packages/core && pnpm exec vitest run src/report-registry.test.ts src/report-state-machine.test.ts src/report-match-state-machine.test.ts src/report-matching.test.ts src/report-config.test.ts --coverage.enabled=false)
     × fixes the plan values · × marks every constant provisional, with a source that names its contract (decision 15)
     × are method sets: exact has no pair rule, strict no nickname, spelling variant or typo
     × row 1: no open or delisted row and a run finds the entry: a new open, pending match and .matched
       Error: not implemented   (rows 1-18 and the four precedence cases, each)
     × lists the nine Phase 6 types in the plan order · × records the plan table: tiers, recurrence, review and needs
     × declares exactly the C69.2 table · × has the C69.3 error codes, and the ones that name a source
      Test Files  5 failed (5)
      Tests  46 failed | 8 passed (54)
GREEN: same command, Test Files 5 passed (5), Tests 54 passed (54); the whole package: Tests 765 passed (765), 100% statements, 97.58% branches.

## 2. Scopes and roles (C72.2)
RED 1789aa6a; GREEN dbec545d.
RED:
$ (cd packages/core && pnpm exec vitest run src/permissions.test.ts --coverage.enabled=false)
     × keeps the Phase 1 scopes first, then adds the C12 scopes, the Phase 5 one and the Phase 6 ones
     × gives developer templates, webhooks, ... · × gives reviewer inquiries, redaction, ...
     × gives viewers the report reads with PII masked, and keeps review and redaction from developer and viewer (C72.2)
      Tests  4 failed | 15 passed (19)
$ (cd packages/contracts && pnpm exec vitest run src/vocabulary.test.ts --coverage.enabled=false)
     × lists the scopes the server API enforces, Phase 1 first      Tests  1 failed | 14 passed (15)
$ (cd apps/dashboard && pnpm exec vitest run src/components/operators/permissions.test.ts --coverage.enabled=false)
     × orders the areas from daily review work to organization administration
     × holds the report, report template and watchlist source permissions      Tests  2 failed | 4 passed (6)
GREEN: core 19 passed; contracts vocabulary and fixtures 161 passed; dashboard operators 54 passed. The reviewer role fixture (`role.json`) and `role-options.test.ts`'s reviewer list follow the reviewer role (changed with C72.2). Refactor 0dec4678 dropped the `as Permission` cast the RED test needed.

## 3. ID prefixes (C70.1)
RED ad67bf97; GREEN 07c3ae8b.
RED: packages/db `src/ids.test.ts` × holds the Phase 6 report prefixes ... (1 failed | 1 passed); packages/contracts `src/ids.test.ts` × maps every C1 object to its prefix (1 failed | 51 passed).
GREEN: db ids, testing, schema-v2, schema: 215 passed; contracts ids: 52 passed.

## 4. Contracts: resources, queries, templates, events, fixtures; the same-commit items (C69-C76, C84.1, F08, F09)
Stubs 2478a8c5, 4477927a (dashboard labels), d44304bc, c7d0485d; RED 33e5ea1a; GREEN ae9b5bbc; refactor 76781998.
RED:
$ (cd packages/contracts && pnpm exec vitest run --coverage.enabled=false)
      Error: ENOENT ... contracts/fixtures/api/report-watchlist.json   (and each new golden fixture: none exists yet)
      Error: not implemented   (the builders) · TypeError: Cannot read properties of undefined (reading 'safeParse')
      AssertionError: expected {} to deeply equal { report_query_invalid: 422, …(12) }
      AssertionError: report/watchlist: expected [ 'selfie', 'file', …(47) ] to include 'report/watchlist'
      pii-collisions: - [] + [ "account.fields", "createAccountBodySchema.fields", "createInquiryBodySchema.fields",
                              "inquiry.fields", "updateAccountBodySchema.fields", "updateInquiryBodySchema.fields" ]
      Test Files  13 failed | 48 passed (61)
      Tests  143 failed | 1915 passed (2058)
$ (cd apps/dashboard && pnpm exec vitest run src/lib/report-type-coverage.test.ts src/lib/api/events.test.ts --coverage.enabled=false)
     × labels every report type, in the registry order · × decodes the golden report/watchlist fixture (×9)
     × groups every event name by its subject, in catalog order      Tests  12 failed | 4 passed (16)
$ (cd apps/api && pnpm exec vitest run src/webhooks/samples.test.ts src/routes/server/inquiries.test.ts --coverage.enabled=false)
     × take the golden report of the event type ... · × null the report PII on .redacted ...
     × carry the dismissed match ids and the review in meta · × needs reports:read, and lists no report before any exists
      Tests  4 failed | 89 passed (93)
The collision walk found the inquiry's and account's `fields` unmarked, which the GREEN commit marks PII (amendment 20). A first RED commit was refused by the gitleaks pre-commit hook (`'record-token': 'rpm_…'` read as a generic API key); the test was reworded with a named constant and our own members renamed to `match-id`, `match-ids` (amendment 18), never ignored.
GREEN (the fixtures generated by a scratch script from fixed seeds, then formatted):
$ (cd packages/contracts && pnpm exec vitest run --coverage)
      Test Files  61 passed (61)
      Tests  2070 passed (2070)
      All files 99.22 | 96.3 | 98.27 | 99.21
$ (cd apps/api && pnpm exec vitest run src/events src/webhooks src/routes src/openapi.test.ts src/services/api-logs.test.ts src/phase5-masking.test.ts src/auth --coverage.enabled=false)
      Test Files  67 passed (67)      Tests  1565 passed (1565)
$ (cd apps/dashboard && pnpm exec vitest run --coverage.enabled=false)
      Test Files  227 passed (227)      Tests  3056 passed (3056)
$ (cd android && ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.model.ContractFixturesTest')
      tests="80" skipped="0" failures="0" errors="0"
$ pnpm --filter @openverify/api openapi:write   (twice; the second run changes nothing)
The GREEN commit holds, as F09 asks, the event names and fixtures together with the webhook samples keyed by report type (the `.redacted` sample nulling the report PII), the dashboard "Report" group and its labels, the Android `serverOnly` entries for all 13 new API fixtures, `INCLUDE_PERMISSIONS.reports`, the dashboard rate-limit label and the OpenAPI snapshot. The dashboard group test landed in the RED commit before it.

## 5. `packages/watchlist`: the frozen record (C77.1, C77.3, C77.5, C78.3, F12, V06, V12)
Stub dfb88013 (with the dependencies: `flock /tmp/openverify-pnpm.lock pnpm install` added `any-ascii@0.3.3` and made `saxes@6.0.0` a runtime dependency; no `minimumReleaseAgeExclude` was written, no build script); RED cee0fd6a; GREEN 6bb9352a.
Golden vectors from an independent Python implementation of the canonical JSON rule (`json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)` over NFC strings, set-like lists sorted by UTF-16 code units), run once in the scratch area and pasted into `record.test.ts`: content `5447611558cae884…2803a`, risk `871585eda4ec0850…491a3`, PEP risk `8c4415111689f466…3e2c0`; 1,047 of 10,000 random ids held out (10.5%).
RED:
$ (cd packages/watchlist && pnpm exec vitest run --coverage.enabled=false)
     × parses a full synthetic record and a PEP record · × caps every string: names 300, addresses 500, identifiers 100
     × reads the normalised import format { source, published_at, entries } (C77.5)
     × sorts keys, normalises strings to NFC, keeps array order and writes no whitespace
     × matches the golden vector · × matches the golden vectors
     × holds out the groups whose SHA-256 over the seed and the id starts below byte 26 · × holds out about a tenth of the groups
      Tests  11 failed | 3 passed (14)
$ (cd packages/config && pnpm exec vitest run src/eslint-phase5.test.ts --coverage.enabled=false)
     × refuses them in the Phase 6 folders that read untrusted lists and subjects too: packages/watchlist/src/parsers/ofac.ts
     × refuses them in the Phase 6 folders ...: packages/checks/src/reports/email/typos.ts      Tests  2 failed | 23 passed (25)
GREEN: watchlist 14 passed, 100% statements and 85.71% branches; config 25 passed. The record test's types were tightened from the stub's loose record to `WatchlistRecord` in the GREEN commit (the RED commit compiled against the stub).

## 6. Checks: the reports folder and the ICAO table (C78.1, C82, F21)
Stub d1b83baa; RED d3244f45; GREEN 8ff30d94.
RED: `src/index.test.ts` × re-exports everything the reports folder exports · × exports the ICAO 9303 Part 3 §6.A Latin table unchanged (2 failed | 9 passed).
GREEN: `src/index.test.ts src/extraction` 116 passed; the table's values are unchanged, frozen, and still used by `namesAgree`.

## 7. Data: the rigour variant groups (C78.3)
RED ef78f15d; GREEN cb9751c0.
RED: $ (cd services/vision && uv run --frozen pytest tests/test_fetch_data.py -q --no-cov)
      E   KeyError: 'rigour_person_names'      1 failed, 36 passed
GREEN: 37 passed; the checks matching-data, the API's disposable-list and the e2e asset readers of the manifest pass (186, 15 and 10 tests). `python3 scripts/fetch_data.py` then downloaded the file and matched its pinned SHA-256 and size.

## 8. `@openverify/node` method groups (C72)
Stub ca272ad1 (the group types, and `DELETE` in the transport, which sends no body); RED ff7d05c1; GREEN 31807b13.
RED: × reports.create … × reportTemplateVersions.publish (23 endpoint cases) — Tests 23 failed | 226 passed (249).
GREEN: Tests 249 passed (249), 98.86% statements, 94.06% branches.

## 9. Records (C87)
247ec356: ADR 0005; PLAN §3 (sanctions and PEP rows), §4.4, §6 Phase 0 and Phase 6; `THIRD_PARTY_LICENSES.md` §2.1.10 (saxes, xmlchars, any-ascii) and §4.2 (OFAC, UN ⚠️, EU, the UK Sanctions List with OFSI closed, Wikidata, GDELT, OpenSanctions data ❌, rigour); `persona-surface.md` (report events with a slash, the two missing types, the 76 missing events described).

## 10. A test the plan changed (C72.5)
5e666cbc: the API's `rateLimitRules()` test lists the new `reports` rule (600 a minute), which the contracts policy list now builds. Found by the API suite in the final gates (1 failed | 3901 passed), fixed by updating the expectation, the only change.

## 11. Final gates (foreground, on the commit before this file)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | lockfile up to date |
| `pnpm typecheck && pnpm lint && pnpm format:check` | 14 of 14 typecheck tasks, 14 of 14 lint tasks, Prettier clean (two lint findings, obsolete casts in RED tests, fixed by the refactor commits 0dec4678 and 76781998) |
| `pnpm turbo run test --filter='!@openverify/api'` | every package passed its 80% gate: contracts 2,070 (99.22% statements, 96.3% branches), core 766, checks 2,921, db 858, dashboard 3,056, flow 1,012, node 249, emrtd 318, flow-spec 113, e2e 90, config 76, ui 54, **watchlist 14 (100% statements, 85.71% branches)** |
| `pnpm turbo run test --filter=@openverify/api` | 3,902 passed in 256 files, 97.02% statements, 89.42% branches (6 min 57 s) |
| `pnpm test:integration` (db, then api) | db 57 passed (11 files); api 124 passed (25 files) |
| Android full gate | BUILD SUCCESSFUL; SDK host tests 1,264 (0 skipped, 0 failures), demo 18; Kover and lint pass |
| `pnpm --filter @openverify/api openapi:write` twice | no diff after the second run |
| `python3 scripts/fetch_data.py` | every entry present or downloaded at its pin, `rigour_person_names` downloaded |
| `bash infra/tests/ci-workflow.test.sh` | 181 passed, 0 failed |
| e2e (under `/tmp/openverify-e2e.lock`) | mocked flow 69 passed (20.2 s); full stack shard 1/2: 42 passed (3.7 min); shard 2/2: 40 passed (5.8 min); 82 in all |
