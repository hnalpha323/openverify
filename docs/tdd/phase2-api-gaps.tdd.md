# TDD evidence: Workflow 2E, `api-gaps` (C25 on the API side)

- **Slice owner:** `api-gaps` (Workflow 2E, Stage 1; it ran alone).
- **Date:** 2026-10-20.
- **Paths owned:**
  - `apps/api/**`, `packages/contracts/**`, `packages/db/**`, `packages/node/**`, `packages/core/**` (unused)
  - `contracts/fixtures/**`
  - `docs/api/openapi.json`, `docs/plans/phase-2.plan.md`, `THIRD_PARTY_LICENSES.md` (unchanged: no new dependency)
  - this file
- **Input:** `docs/plans/phase-2.plan.md`, "Workflow 2E", C25 items 1-9.

Each item follows the same cycle:
1. Write a test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

A RED test must compile and typecheck, so the names the tests need were added first as stubs in their own commit (`25ccf52 chore(contracts,db,node): stub the Workflow 2E C25 names so their tests compile`): `MFA_SIGN_IN_PROBLEM_CODES`, `SESSION_CANCELED_REASONS` and their schemas (empty), `InquiryRecord.inquiryTemplateVersionId` and `ApiKeyRecord.piiMasked` (ignored), `updateAccountTypeBodySchema`, `accountTypeFieldsChangeIssues` (no issues), `lockAccountType` and `updateAccountType` (answer `null`), `ListEventsOptions.inquiryId` and `ListApiLogsOptions.userId` (ignored), `client.accountTypes.update` (rejects).

All commands ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown. Output is trimmed to the lines that matter.

## 1. Contracts (`@openverify/contracts`, `contracts/fixtures`)

### RED

```text
$ (cd packages/contracts && pnpm exec vitest run src/problem.test.ts src/inquiries.test.ts src/account-types.test.ts src/api-keys.test.ts src/events.test.ts src/api-logs.test.ts --coverage.enabled=false)
 FAIL  src/account-types.test.ts > PATCH /account-types/:id (C25.3, Workflow 2E) > rejects nothing to change
AssertionError: expected true to be false // Object.is equality
 FAIL  src/account-types.test.ts > accountTypeFieldsChangeIssues (C25.3, Workflow 2E) > reports each removed key and each key whose type changed
AssertionError: expected [] to deeply equal [ { field: 'birthdate', …(1) }, …(1) ]
 FAIL  src/account-types.test.ts > accountTypeFieldsChangeIssues (C25.3, Workflow 2E) > treats prototype names as ordinary keys
AssertionError: expected [] to deeply equal [ { field: 'constructor', …(1) } ]
 FAIL  src/api-keys.test.ts > API key expiry on creation and pii-masked (C25.5, C25.6, Workflow 2E) > create a key that expires in 1 second to 30 days, or never without it
AssertionError: expected false to be true // Object.is equality
 FAIL  src/api-keys.test.ts > ... > show whether the key sees PII masked, a read-only boolean earlier answers lack
 FAIL  src/api-keys.test.ts > ... > build pii-masked from the record
AssertionError: expected { name: 'Masked key', …(7) } to match object { 'pii-masked': true }
 FAIL  src/api-logs.test.ts > GET /api-logs by user (C25.9, Workflow 2E) > filters by the users whose dashboard sessions made the requests
 FAIL  src/events.test.ts > GET /api/v1/events by inquiry (C25.7, Workflow 2E) > filters by the inquiry the events are about, with the other filters
 FAIL  src/inquiries.test.ts > the pinned template version (C25.4, Workflow 2E) > is an optional relationship, so earlier answers still parse
 FAIL  src/inquiries.test.ts > the pinned template version (C25.4, Workflow 2E) > is built from a record that names the version
 FAIL  src/problem.test.ts > MFA sign-in problem codes (C25.1, Workflow 2E) > say whether the mfa-token can still be used
AssertionError: expected [] to deeply equal [ 'mfa_code_invalid', …(2) ]
 FAIL  src/problem.test.ts > why a flow session was canceled (C25.8, Workflow 2E) > is one of three reasons derived from the inquiry
AssertionError: expected [] to deeply equal [ 'inquiry_redacted', …(2) ]
 FAIL  src/problem.test.ts > why a flow session was canceled (C25.8, Workflow 2E) > is an optional, enumerated member of the problem
AssertionError: expected true to be false // Object.is equality
      Tests  13 failed | 128 passed (141)

$ (cd packages/contracts && pnpm exec vitest run src/fixtures.test.ts --coverage.enabled=false)
 FAIL  src/fixtures.test.ts > Workflow 2E fixtures (C25) > inquiry.json names its pinned template version (C25.4)
AssertionError: expected { 'inquiry-template': { …(1) }, …(2) } to match object { Object (inquiry-template-version) }
 FAIL  ... > inquiry-with-verifications.json names its pinned template version (C25.4)
 FAIL  ... > api-key.json says whether the key sees PII masked (C25.6)
AssertionError: expected { name: 'Sandbox backend', …(7) } to match object { 'pii-masked': false }
 FAIL  ... > problems/ holds one session_canceled problem per reason (C25.8)
Error: ENOENT: no such file or directory, scandir '.../contracts/fixtures/problems'
 FAIL  ... > problems/session-canceled-inquiry-expired.json carries reason inquiry_expired
 FAIL  ... > problems/session-canceled-inquiry-finished.json carries reason inquiry_finished
 FAIL  ... > problems/session-canceled-inquiry-redacted.json carries reason inquiry_redacted
      Tests  7 failed | 76 passed (83)
```

### GREEN

- `problem.ts`: `MFA_SIGN_IN_PROBLEM_CODES` / `mfaSignInProblemCodeSchema` / `MfaSignInProblemCode`; `SESSION_CANCELED_REASONS` / `sessionCanceledReasonSchema` / `SessionCanceledReason`; `problemSchema` gains the optional, enumerated `reason`.
- `identifiers.ts`: `inquiryTemplateVersionIdentifierSchema`. `inquiries.ts`: the optional relationship `inquiry-template-version`, built from `InquiryRecord.inquiryTemplateVersionId`.
- `account-types.ts`: `updateAccountTypeBodySchema` (name and/or the whole `fields-schema`, at least one) and `accountTypeFieldsChangeIssues(previous, next)`.
- `api-keys.ts`: `expires-in-seconds` (1 to `API_KEY_EXPIRE_MAX_SECONDS`) on create; the optional read-only `pii-masked` attribute, built from `ApiKeyRecord.piiMasked`.
- `events.ts`: `filter[inquiry-id]` (comma list of `inq_` ids). `api-logs.ts`: `filter[user-id]` (comma list of `usr_` ids).
- Fixtures: `api/inquiry.json` and `api/inquiry-with-verifications.json` name their version; `api/api-key.json` has `pii-masked: false`; new folder `problems/` with one `session_canceled` problem per reason. The folder is new rather than inside `api/`, because the Android contract test requires a Kotlin decoder for every `api/*.json` and the Android tree belongs to `clients-reason`; it reads `problems/*.json` from the same classpath.

```text
$ (cd packages/contracts && pnpm exec tsc --noEmit && pnpm exec eslint src && pnpm exec vitest run --coverage.enabled=false)
      Tests  1224 passed (1224)
$ for p in apps/dashboard apps/flow packages/node apps/api packages/db; do (cd $p && pnpm exec tsc --noEmit) ; done
apps/dashboard TC-OK / apps/flow TC-OK / packages/node TC-OK / apps/api TC-OK / packages/db TC-OK
```

## 2. Database (`@openverify/db`)

Repository behaviour on PGlite: `listEvents({ inquiryId })` (C25.7), `listApiLogs({ userId })` (C25.9), `lockAccountType` and `updateAccountType` (C25.3); the schema and migration of the new API log index; and, on Postgres 17 (Testcontainers), the plans of the two new list queries. Two of the first events tests and the first API log scoping test passed against the stub because their environments held nothing else; they were strengthened (a second inquiry's timeline, another environment's events and logs) before this RED was recorded.

### RED

```text
$ (cd packages/db && pnpm exec vitest run src/repositories/events-v2.test.ts src/repositories/api-logs.test.ts src/repositories/accounts.test.ts src/schema-v2.test.ts src/migrate.test.ts --coverage.enabled=false)
 FAIL  src/migrate.test.ts > migrations > adds the Workflow 2E API log index after the 2B fixes
AssertionError: expected [] to deeply equal [ '0009_api_logs_user_id_index' ]
 FAIL  src/schema-v2.test.ts > schema: indexes added by Workflow 2E > lists the API logs of a user newest first without a scan (C25.9)
Error: api_logs has no index api_logs_environment_id_user_id_created_at_id_idx
 FAIL  src/repositories/accounts.test.ts > account type changes (C25.3, Workflow 2E) > locks a type of the environment only
AssertionError: expected null to deeply equal { …(6) }
 FAIL  src/repositories/accounts.test.ts > ... > writes the name and the fields schema, and nothing in another environment
AssertionError: expected null to match object { …(3) }
 FAIL  src/repositories/accounts.test.ts > ... > keeps names unique per environment
AssertionError: expected undefined to be '23505' // Object.is equality
 FAIL  src/repositories/api-logs.test.ts > API logs by user (C25.9, Workflow 2E) > filter by the users whose sessions made the requests, with the other filters
AssertionError: expected [ …(4) ] to deeply equal [ …(2) ]
 FAIL  src/repositories/api-logs.test.ts > API logs by user (C25.9, Workflow 2E) > stay inside the environment
 FAIL  src/repositories/events-v2.test.ts > events by inquiry (C25.7, Workflow 2E) > lists the events of the inquiry, its verifications and its sessions, newest first
AssertionError: expected [ …(10) ] to deeply equal [ …(5) ]
 FAIL  src/repositories/events-v2.test.ts > ... > combines with the other filters and the cursor
AssertionError: expected [ …(4) ] to deeply equal [ …(2) ]
 FAIL  src/repositories/events-v2.test.ts > ... > stays inside the environment: another environment sees none of them
AssertionError: expected [ { …(10) }, { …(10) }, …(3) ] to deeply equal []
      Tests  10 failed | 99 passed (109)

$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/query-plans.integration.test.ts)
 FAIL  src/query-plans.integration.test.ts > query plans (Workflow 2E) > serves an inquiry timeline from the events object index (C25.7)
DecryptionError: malformed envelope: expected 4 segments
   (the unfiltered list reached the filler events, whose payloads are not envelopes)
 FAIL  src/query-plans.integration.test.ts > query plans (Workflow 2E) > serves the API logs of a user from the user index (C25.9)
AssertionError: expected [ …(25) ] to deeply equal [ …(3) ]
      Tests  2 failed (2)
```

A first implementation (an index `(environment_id, user_id, created_at DESC, id DESC)` as drizzle-kit writes it, which is `DESC NULLS LAST`) passed every test above, but its plan still sorted the user's rows: the list orders by `created_at DESC, id DESC`, which is `NULLS FIRST`, and Postgres does not treat the two orders as the same even on `NOT NULL` columns. An operator's session makes many API requests, so a page should stop after its rows. A stricter assertion came first:

```text
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/query-plans.integration.test.ts)
  ->  Sort  (cost=103.00..103.13 rows=52 width=458)
        Sort Key: created_at DESC, id DESC
 FAIL  src/query-plans.integration.test.ts > query plans (Workflow 2E) > serves the API logs of a user from the user index (C25.9)
AssertionError: expected 'Limit  (cost=103.00..103.06 rows=26 w…' not to match /\bSort\b/
      Tests  1 failed | 1 passed (2)
```

Every older list index in the schema has the same `NULLS LAST` mismatch (53 descending index columns in `0001` and `0003`); that is reported as a follow-up, not changed here.

### GREEN

- `tables/platform.ts` and migration `0009_api_logs_user_id_index.sql` (drizzle-kit generated, then commented): `api_logs_environment_id_user_id_created_at_id_idx` on `(environment_id, user_id, created_at DESC NULLS FIRST, id DESC NULLS FIRST)`. No pgvector, so no extension statement.
- `repositories/events.ts`: `listEvents({ inquiryId })` adds `object_id = ANY(ARRAY(<the inquiry ids> UNION ALL <their verifications> UNION ALL <their sessions>))`, each subquery scoped to the environment. No migration: `events_environment_id_object_id_idx`, `verifications_environment_id_inquiry_id_created_at_idx` and `inquiry_sessions_environment_id_inquiry_id_idx` already exist.
- `repositories/api-logs.ts`: `listApiLogs({ userId })`.
- `repositories/accounts.ts`: `lockAccountType` (`FOR UPDATE`) and `updateAccountType` (name and/or fields schema; a taken name fails with 23505).

```text
$ (cd packages/db && pnpm exec drizzle-kit check)
Everything's fine
$ (cd packages/db && pnpm exec vitest run src/repositories/events-v2.test.ts src/repositories/api-logs.test.ts src/repositories/accounts.test.ts src/schema-v2.test.ts src/migrate.test.ts --coverage.enabled=false)
      Tests  109 passed (109)
$ (cd packages/db && pnpm test)
      Tests  573 passed (573)
All files          |   99.07 |     92.2 |   99.36 |   99.02 |
```

The query plans on Postgres 17 (`src/query-plans.integration.test.ts`; 40,000 events, 20,000 verifications, 10,000 sessions and 40,000 API logs in the environment, 10,000 more events and logs in another, then `ANALYZE`):

```text
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/query-plans.integration.test.ts --silent=false)
EXPLAIN listEvents({ inquiryId }) over 40000 events, 20000 verifications and 10000 sessions:
Limit  (cost=122.49..122.56 rows=26 width=149)
  InitPlan 1
    ->  Append  (cost=0.00..18.68 rows=4 width=32)
          ->  ProjectSet  (cost=0.00..0.02 rows=1 width=32)
                ->  Result  (cost=0.00..0.01 rows=1 width=0)
          ->  Index Scan using verifications_environment_id_inquiry_id_created_at_idx on verifications  (cost=0.41..10.20 rows=2 width=31)
                Index Cond: ((environment_id = 'env_...'::text) AND (inquiry_id = ANY ('{inq_...}'::text[])))
          ->  Index Scan using inquiry_sessions_environment_id_inquiry_id_idx on inquiry_sessions  (cost=0.41..8.43 rows=1 width=32)
                Index Cond: ((environment_id = 'env_...'::text) AND (inquiry_id = ANY ('{inq_...}'::text[])))
  ->  Sort  (cost=103.82..103.90 rows=32 width=149)
        Sort Key: events.created_at DESC, events.id DESC
        ->  Index Scan using events_environment_id_object_id_idx on events  (cost=0.41..103.02 rows=32 width=149)
              Index Cond: ((environment_id = 'env_...'::text) AND (object_id = ANY ((InitPlan 1).col1)))
              Filter: (NOT simulated)
EXPLAIN listApiLogs({ userId }) over 40000 API logs:
Limit  (cost=0.41..51.95 rows=26 width=458)
  ->  Index Scan using api_logs_environment_id_user_id_created_at_id_idx on api_logs  (cost=0.41..101.50 rows=51 width=458)
        Index Cond: ((environment_id = 'env_...'::text) AND (user_id = 'usr_...'::text))
      Tests  2 passed (2)
```

The timeline's sort is over the inquiry's own events only (the object ids its subjects give), which an inquiry has a few dozen of.

## 3. API (`@openverify/api`)

Route tests with the existing harnesses (`createTestApi`, `createInquiryTestApi`, `createDashboardHarness`), each with the missing permission or scope (403), another environment or organization (404, or an empty list for a filter) and validation (400 for a malformed body or query, 422 for a rule of the resource) where it applies.

One existing test changed with the behaviour it checks: `POST /api/v1/api-keys > creates a key and returns its token once, in meta.token` compares the attributes exactly, so it now expects `'pii-masked': false` (C25.6).

### RED

```text
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard/sessions-mfa.test.ts --coverage.enabled=false)
 FAIL  ... > MFA sign-in problem codes (C25.1, Workflow 2E) > answers mfa_code_invalid for a wrong code, and the token still works
AssertionError: expected undefined to be 'mfa_code_invalid' // Object.is equality
 FAIL  ... > answers mfa_attempts_exhausted for the fifth wrong code, then mfa_token_invalid
AssertionError: expected undefined to be 'mfa_code_invalid' // Object.is equality
 FAIL  ... > answers mfa_token_invalid for an unknown, expired or used token
AssertionError: expected undefined to be 'mfa_token_invalid' // Object.is equality
 FAIL  ... > answers the same codes for a security key assertion
AssertionError: expected undefined to be 'mfa_code_invalid' // Object.is equality
      Tests  4 failed | 16 passed (20)

$ (cd apps/api && pnpm exec vitest run src/routes/dashboard/roles.test.ts --coverage.enabled=false)
 FAIL  ... > GET /roles/:id (C25.2, Workflow 2E) > answers a built-in role and a custom role of the organization
Error: expected HTTP 200, got 404: {... "detail":"No route matches GET /api/v1/dashboard/roles/role_01M5DRTY0CCYWAW553ZTBMPJKN." ...}
 FAIL  ... > answers 403 without roles:read and 400 for a malformed id
AssertionError: expected 404 to be 403 // Object.is equality
      Tests  2 failed | 13 passed (15)

$ (cd apps/api && pnpm exec vitest run src/routes/server/account-types.test.ts --coverage.enabled=false)
 FAIL  ... > PATCH /api/v1/account-types/:id (C25.3, Workflow 2E) > renames a type and records an audit entry
Error: expected HTTP 200, got 404: {... "detail":"No route matches PATCH /api/v1/account-types/acctp_01M5DRXKAGR20EXHMQM6W6A86P." ...}
 FAIL  ... > adds keys and changes labels
 FAIL  ... > answers 422 with a pointer to each key a change removes or retypes
AssertionError: ...: expected 404 to be 422 // Object.is equality
 FAIL  ... > holds the seeded type user to the same rule, and keeps its name
 FAIL  ... > answers 409 for a name the environment already has, as create does
AssertionError: ...: expected 404 to be 409 // Object.is equality
 FAIL  ... > answers 400 for an empty change, a bad key or more than 100 keys
AssertionError: ...: expected 404 to be 400 // Object.is equality
 FAIL  ... > answers 403 forbidden without accounts:write
AssertionError: ...: expected 404 to be 403 // Object.is equality
      Tests  7 failed | 14 passed (21)

$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiries.test.ts src/routes/dashboard/index.test.ts --coverage.enabled=false -t "C25.4")
 FAIL  src/routes/dashboard/index.test.ts > the pinned template version on dashboard inquiries (C25.4, Workflow 2E) > is named by the list and the detail
AssertionError: expected { 'inquiry-template': { …(1) }, …(2) } to match object { Object (inquiry-template-version) }
 FAIL  src/routes/server/inquiries.test.ts > the pinned template version (C25.4, Workflow 2E) > is named by the create, read, list and action answers and the inquiry.created event
AssertionError: expected { 'inquiry-template': { …(1) }, …(2) } to match object { Object (inquiry-template-version) }
 FAIL  src/routes/server/inquiries.test.ts > ... > keeps the version an inquiry pinned after a newer one is published
      Tests  3 failed | 78 skipped (81)

$ (cd apps/api && pnpm exec vitest run src/routes/server/api-keys.test.ts --coverage.enabled=false)
 FAIL  ... > POST /api/v1/api-keys > creates a key and returns its token once, in meta.token
AssertionError: expected { name: 'Billing backend', …(7) } to deeply equal { name: 'Billing backend', …(8) }
 FAIL  ... > expiry on creation (C25.5, Workflow 2E) > creates a key that expires expires-in-seconds later, after which it answers 401
AssertionError: expected null to be '2026-10-20T13:00:01.000Z' // Object.is equality
 FAIL  ... > pii-masked on API keys (C25.6, Workflow 2E) > shows on the create, list, get, update and clone answers
AssertionError: expected { name: 'Masked', …(7) } to match object { 'pii-masked': true }
      Tests  3 failed | 47 passed (50)

$ (cd apps/api && pnpm exec vitest run src/routes/server/events.test.ts --coverage.enabled=false)
 FAIL  ... > GET /api/v1/events?filter[inquiry-id]= (C25.7, Workflow 2E) > lists the events of the inquiry, its verifications and its sessions, newest first
AssertionError: expected [ …(8) ] to deeply equal [ …(4) ]
 FAIL  ... > combines with the other filters and keeps them all in links.next
AssertionError: expected [ …(4) ] to deeply equal [ …(2) ]
 FAIL  ... > lists nothing for another environment's inquiry
AssertionError: expected [ { type: 'event', …(2) }, …(3) ] to deeply equal []
      Tests  3 failed | 23 passed (26)

$ (cd apps/api && pnpm exec vitest run src/routes/flow/auth.test.ts --coverage.enabled=false)
 FAIL  ... > why a session was canceled (C25.8, Workflow 2E) > answers inquiry_expired when the inquiry expired
AssertionError: expected { type: 'about:blank', …(6) } to match object { code: 'session_canceled', …(1) }
 FAIL  ... > answers inquiry_finished when the inquiry was completed or decided
 FAIL  ... > answers inquiry_redacted when the inquiry was redacted, whatever its status
      Tests  3 failed | 25 passed (28)

$ (cd apps/api && pnpm exec vitest run src/routes/server/api-logs.test.ts --coverage.enabled=false)
 FAIL  ... > GET /api/v1/api-logs?filter[user-id]= (C25.9, Workflow 2E) > filters by the user whose session made the request, one or several
AssertionError: expected [ …(4) ] to deeply equal [ 'alog_01M5DSA9QCP68VWQ7FH87JPJYK' ]
 FAIL  ... > singles out the requests made with a user's dashboard session
AssertionError: expected [ { type: 'api-log', …(2) }, …(1) ] to have a length of 1 but got 2
 FAIL  ... > keeps the filter in links.next
AssertionError: expected '/api/v1/api-logs?page[after]=alog_01M…' to contain 'filter[user-id]=usr_01M5DSA9SGHXW51DC…'
 FAIL  ... > never lists another environment's entries of the user
AssertionError: expected [ { type: 'api-log', …(2) }, …(2) ] to deeply equal []
      Tests  4 failed | 27 passed (31)
```

The tests that pass here pass for a reason that holds after the change: the 404 of `GET /dashboard/roles/:id` for an unknown role (no route yet), the 400 answers that the contract schemas already give (`expires-in-seconds` out of range, a bad `filter[inquiry-id]` or `filter[user-id]`, a `pii-masked` in a body), a key without an expiry that keeps working, and `session_expired` without a reason.

### GREEN

- **C25.1** (`operator-auth/operator-auth.ts`): `InvalidMfaTokenError` answers `code: mfa_token_invalid`, `InvalidMfaCodeError` `mfa_code_invalid`, and the new `MfaAttemptsExhaustedError` (a subclass of `InvalidMfaCodeError`) `mfa_attempts_exhausted`. After a wrong factor, the result of `revokeExhaustedMfaChallenge` picks the error: `revoked` gives exhausted, `null` (the token was used or revoked meanwhile) gives token-invalid, anything else code-invalid. Still 401 with the same problem shape; the route descriptions name the codes.
- **C25.2** (`services/roles.ts` `getRoleResource`, `routes/dashboard/roles.ts`): `GET /dashboard/roles/:id`, `roles:read`, 404 for an unknown role or another organization's.
- **C25.3** (`services/accounts.ts` `updateAccountType`, `routes/server/account-types.ts`): `PATCH /account-types/:id`, `accounts:write`. In one transaction: lock the type, check the additive rule with `accountTypeFieldsChangeIssues` (422, `errors[].pointer` = `/data/attributes/fields-schema/<key>`), refuse renaming `user` (422 at `/data/attributes/name`), check the name (409, the create message), write, and audit `account-type.updated` with `metadata.attributes`. No event, as for create.
- **C25.4** (`jobs/records.ts`, `routes/dashboard/resources.ts`, `services/resources.ts`): every inquiry builder passes `inquiryTemplateVersionId`, so every server and dashboard answer and every `inquiry.*` payload names the pinned version. The flow API returns no inquiry resource (only `{ id, status }`), so it is unchanged.
- **C25.5, C25.6** (`services/api-keys.ts`): `expires-in-seconds` sets `expires_at` at creation (audited as `metadata.expires-at`); the existing expired-key check refuses the key afterwards. `apiKeyResource` sends `pii-masked` from `api_keys.pii_masked`.
- **C25.7** (`services/events.ts`): `filter[inquiry-id]` goes to `listEvents({ inquiryId })` and stays in `links.next`.
- **C25.8** (`auth/flow-session.ts`, `errors.ts`, `problem-details.ts`): a canceled session reads its inquiry and answers `reason`; `AppError` and the problem document carry the optional `reason` member.
- **C25.9** (`services/api-logs.ts`): `filter[user-id]` goes to `listApiLogs({ userId })` and stays in `links.next`.

Two test changes, both because C25 changed what they check:
- `operator-auth.test.ts > counts parallel guesses against the five-attempt limit before checking them (2B F004)` counted error names (5 `InvalidMfaCodeError`, 7 `InvalidMfaTokenError`). The guess that revokes the token is now `MfaAttemptsExhaustedError`, and wrong guesses checked after it answer `InvalidMfaTokenError`. The test still requires exactly 5 checks, and now exactly one exhausted answer and 11 code- or token-invalid answers (at least 7 token-invalid), which holds whatever order the guesses finish in.
- `account-types.test.ts > holds the seeded type user to the same rule` (new in this slice) built its removal request from the default schema rather than the schema after the added key, so it removed two keys; it now removes only `name_first`.

```text
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard/sessions-mfa.test.ts src/operator-auth/ src/errors.test.ts src/problem-details.test.ts --coverage.enabled=false)
      Tests  217 passed (217)
$ (cd apps/api && pnpm exec vitest run src/routes/flow/ src/errors.test.ts src/problem-details.test.ts --coverage.enabled=false)
      Tests  154 passed (154)
$ (cd apps/api && pnpm exec vitest run src/routes/dashboard/roles.test.ts src/services/roles.test.ts --coverage.enabled=false)
      Tests  23 passed (23)
$ (cd apps/api && pnpm exec vitest run src/routes/server/account-types.test.ts --coverage.enabled=false)
      Tests  21 passed (21)
$ (cd apps/api && pnpm exec vitest run src/routes/server/events.test.ts --coverage.enabled=false)
      Tests  26 passed (26)
$ (cd apps/api && pnpm exec vitest run src/routes/server/api-logs.test.ts src/services/api-logs.test.ts --coverage.enabled=false)
      Tests  49 passed (49)
$ (cd apps/api && pnpm exec vitest run src/routes/server/api-keys.test.ts --coverage.enabled=false)
      Tests  50 passed (50)
$ (cd apps/api && pnpm test)
 FAIL  src/openapi.test.ts > OpenAPI document > matches the committed snapshot (pnpm --filter @openverify/api openapi:write)
      Tests  1 failed | 2064 passed (2065)
$ pnpm --filter @openverify/api openapi:write   # twice; the second run changed nothing (cmp)
$ (cd apps/api && pnpm exec vitest run src/openapi.test.ts --coverage.enabled=false)
      Tests  11 passed (11)
```

## 4. `@openverify/node`

The client's methods take their body and filter types from the contract schemas, so `apiKeys.create({ 'expires-in-seconds' })`, `events.list({ filter: { 'inquiry-id' } })`, `apiLogs.list({ filter: { 'user-id' } })`, `pii-masked` and the `inquiry-template-version` relationship needed no client code once the contracts had them; their endpoint tests passed on the first run. `accountTypes.update` and the error's `code` and `reason` needed code. Note: the stub commit made the existing check "every client method has an endpoint test" fail for `accountTypes.update` until this RED commit added its endpoint test.

### RED

```text
$ (cd packages/node && pnpm exec vitest run src/resources.test.ts src/client.test.ts --coverage.enabled=false)
 FAIL  src/client.test.ts > errors > exposes the code and reason of a problem (C25.1, C25.8), or null without them
AssertionError: expected OpenVerifyApiError: Unauthorized: The ses… { …(4) } to match object { code: 'session_canceled', …(1) }
 FAIL  src/resources.test.ts > resource methods > accountTypes.update
Error: accountTypes.update is not implemented yet
      Tests  2 failed | 119 passed (121)
```

### GREEN

- `client.accountTypes.update(id, attributes, options?)`: `PATCH /account-types/:id` with `{ data: { type: 'account-type', attributes } }`, parsed with `accountTypeDocumentSchema`.
- `OpenVerifyApiError.code` and `.reason` (`string | null`), and `ApiProblem.reason?: string`, documented with the C25.1 codes and C25.8 reasons.

```text
$ (cd packages/node && pnpm exec tsc --noEmit && pnpm exec eslint src && pnpm test)
      Tests  205 passed (205)
All files          |   99.06 |    94.54 |     100 |   99.36 |
```

## 5. Plan and final validation

`docs/plans/phase-2.plan.md`: C10 (relationship, `reason`), C11 (pinning), C12 (API key expiry and `pii-masked`, events by inquiry, API logs by user), C13 (`PATCH /account-types/:id`), C15 (MFA codes, `GET /roles/:id`) and C20 (fixtures) are amended where each item lands, marked "Workflow 2E"; the C25 section lists the landed names and the deviations.

Final gates, in the foreground, on `main` after the last code commit:

```text
$ pnpm turbo run typecheck lint --force
 Tasks:    24 successful, 24 total
Cached:    0 cached, 24 total
$ pnpm format:check
All matched files use Prettier code style!
$ pnpm turbo run test --force          # every package gates coverage at 80%
@openverify/core        Tests 399 passed   All files 100 / 100 / 100 / 100
@openverify/node        Tests 205 passed   All files 99.06 / 94.54 / 100 / 99.36
@openverify/checks      Tests 455 passed   All files 99.81 / 97.85 / 100 / 99.8
@openverify/flow-spec   Tests 81 passed    All files 100 / 100 / 100 / 100
@openverify/config      Tests 44 passed    All files 100 / 100 / 100 / 100
@openverify/contracts   Tests 1224 passed  All files 100 / 100 / 100 / 100
@openverify/ui          Tests 54 passed    All files 100 / 97.72 / 100 / 100
@openverify/flow        Tests 495 passed   All files 98.76 / 95.54 / 99.24 / 98.83
@openverify/db          Tests 573 passed   All files 99.07 / 92.2 / 99.36 / 99.02
@openverify/dashboard   Tests 1347 passed  All files 98.42 / 94.38 / 98.71 / 98.43
@openverify/api         Tests 2065 passed  All files 97.56 / 90.48 / 98.37 / 97.63
@openverify/e2e         (unit)             All files 96.55 / 87.61 / 92.64 / 97.59
 Tasks:    12 successful, 12 total
$ pnpm test:integration
@openverify/api:test:integration:       Tests  32 passed (32)
@openverify/db:test:integration:       Tests  39 passed (39)
$ pnpm --filter @openverify/api openapi:write   # twice more: git status shows docs/api/openapi.json unchanged
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   19 passed (7.9s)
@openverify/e2e:e2e:   34 passed (2.1m)
 Tasks:    9 successful, 9 total
```

The dashboard (1,347), web flow (495 unit, 19 mocked e2e) and every full-stack spec pass without any change to their files: every addition is additive.
