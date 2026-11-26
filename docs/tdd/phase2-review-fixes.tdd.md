# TDD evidence: Phase 2 review fixes (TypeScript)

- **Slice owner:** TypeScript fixer (Workflow 2B, fix stage).
- **Date:** 2026-10-20.
- **Paths owned:**
  - `apps/` (except `apps/flow` and `apps/dashboard`)
  - `packages/`
  - `e2e/`
  - `docs/plans/phase-2.plan.md`
  - this file
  - `contracts/fixtures/api/role.json`, only because K001 changes the built-in reviewer role the fixture shows (the task allows fixtures to follow a contract change)
- **Input:** the Phase 2 review. Blocking findings K001, F001, F005, F007, F008, F009, F011, F017 and F018; then the MEDIUM findings in their priority order.

Each fix follows the same cycle:
1. Write a regression test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

All commands ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown. The output below is trimmed to the lines that matter.

## K001: developer and reviewer could not read verifications

**Confirmed.** `BUILTIN_ROLES.developer` and `BUILTIN_ROLES.reviewer` (`packages/core/src/permissions.ts`) lacked `verifications:read`, which `GET /api/v1/verifications/:id` requires, while the read-only viewer had it. The C15 table in the plan omitted it too.

**Fix.**
- `verifications:read` added to both roles, and to the C15 table of `docs/plans/phase-2.plan.md` with a note.
- `contracts/fixtures/api/role.json` (the built-in reviewer role) lists it, since `fixtures.test.ts` compares the fixture with `BUILTIN_ROLES.reviewer`.
- Existing organizations: the startup sync (`syncBuiltinRolesOnReady` -> `syncAllOrganizationRoles` -> `syncBuiltinRoles`) already overwrites the stored permissions of built-in roles (`ON CONFLICT ... DO UPDATE SET permissions`). A new test proves it for an organization seeded with the Phase 2A definitions.
- Dashboard consistency: the dashboard inquiry detail (`routes/dashboard/inquiries.ts`) and the server `GET /inquiries/:id?include=verifications` show verifications under `inquiries:read`, which both roles already held. Only `GET /verifications/:id` needs `verifications:read`.

### RED

```text
$ (cd packages/core && npx vitest run src/permissions.test.ts --coverage.enabled=false)
     × gives developer templates, webhooks, API keys, logs, events, inquiries, sessions, verifications read, accounts read and production
     × gives reviewer inquiries, redaction, sessions read, verifications read, accounts, events read and pii:view
     × lets developer and reviewer read the verifications behind a decision, as viewer can (2B K001)
AssertionError: expected [ 'inquiry-templates:read', …(14) ] to include 'verifications:read'
      Tests  3 failed | 14 passed (17)

$ (cd apps/api && npx vitest run src/routes/server/verifications.test.ts src/routes/dashboard/admin.test.ts --coverage.enabled=false -t "K001")
     × serves the developer built-in role, so the check results behind a decision are readable (2B K001)
     × serves the reviewer built-in role, so the check results behind a decision are readable (2B K001)
     × gives an organization seeded before a built-in permission was added that permission at startup (2B K001)
Error: expected HTTP 200, got 403: {"type":"https://openverify.dev/problems/forbidden",...,"detail":"The user is missing the required permission: verifications:read.",...}
AssertionError: expected [ 'inquiry-templates:read', …(14) ] to include 'verifications:read'
      Tests  3 failed | 1 passed | 7 skipped (11)
```

### GREEN

```text
$ (cd packages/core && npx vitest run src/permissions.test.ts --coverage.enabled=false)
      Tests  17 passed (17)
$ (cd packages/contracts && npx vitest run src/fixtures.test.ts src/roles.test.ts --coverage.enabled=false)
      Tests  86 passed (86)
$ (cd apps/api && npx vitest run src/routes/server/verifications.test.ts src/routes/dashboard/admin.test.ts --coverage.enabled=false)
      Tests  11 passed (11)
```

## F001: a user without pii:view could mint an API key that reads PII unmasked

**Confirmed.** `canViewPii` (`apps/api/src/auth/pii.ts`) returned true for every API-key principal, and `createApiKey`/`cloneApiKey` only checked the requested scopes. The built-in developer role holds `api-keys:write` and `inquiries:read` but not `pii:view`, so it could mint a key and read through it what the dashboard masks for it.

**Fix (contract amended in C12 and C15 of the plan).**
- `api_keys.pii_masked boolean NOT NULL DEFAULT false` (migration `0004_api_key_pii_masked`). Existing keys stay unmasked, as the finding asks.
- `createApiKey` stores `piiMasked = !canViewPii(creator)`. `cloneApiKey` stores `source.piiMasked || !canViewPii(caller)`. A masked key that mints a key therefore passes the masking on.
- The DB lookup returns the flag. The principal plugin sets the optional `piiMasked: true` on the API-key principal, and `canViewPii` honours it, so every serializer (`piiMaskFor`) and `requirePiiView` (file content) treat such a key as a user without `pii:view`.
- The `api-key` resource is unchanged: the OpenAPI snapshot and the fixtures stay as they are.
- `migrationTags()` is now exported from `@openverify/db`. The db tests that counted 4 applied migrations count the journal instead, and `migrate.test.ts` names the new migration.

### RED

```text
$ (cd packages/db && npx vitest run src/repositories/api-keys-v2.test.ts --coverage.enabled=false)
     × record whether the key sees PII masked: unmasked unless asked, so older keys keep their access (2B F001)
AssertionError: expected undefined to be false // Object.is equality
      Tests  1 failed | 3 passed (4)

$ (cd apps/api && npx vitest run src/auth/pii.test.ts src/routes/server/api-keys.test.ts --coverage.enabled=false)
     × masks PII for an API key minted by a principal that could not see it (2B F001)
     × masks PII for a key minted by a user without pii:view, as that user sees it
     × passes masking on to the keys a masked key mints and to clones
AssertionError: expected true to be false // Object.is equality
AssertionError: expected { name_first: 'Synthetic Jane' } to deeply equal { name_first: null }
      Tests  3 failed | 50 passed (53)
```

### GREEN

```text
$ (cd packages/db && npx drizzle-kit generate --name api_key_pii_masked && npx prettier --write drizzle)
[✓] Your SQL migration file ➜ drizzle/0004_api_key_pii_masked.sql 🚀
$ (cd packages/db && npx vitest run --coverage.enabled=false)
      Tests  552 passed (552)
$ (cd apps/api && npx vitest run src/auth src/routes/server/api-keys.test.ts src/plugins/principal-auth.test.ts --coverage.enabled=false)
      Tests  115 passed (115)
```

The first GREEN run also failed two tests that described the old shape exactly: `migrate.test.ts` listed the journal tags, and `api-key-lookup.test.ts` listed the lookup record. Both now include the new migration and `piiMasked: false`.

## F005 and F017: redaction left API log and idempotent copies of lists and embeddings

**Confirmed.** `resourceIdOf` (`apps/api/src/services/api-logs.ts`) gives `null` for a list answer (`data` is an array) and the event id for `GET /events/:id`. `forgetStoredResponses` (`packages/db/src/repositories/redaction.ts`) matched only `resource_id IN (subject ids)`. So a `GET /inquiries` page, an event read, a `GET /api-logs` page, or an idempotent consolidation answer that embeds another account kept the subject's PII until retention. The same held for `idempotency_keys`.

**Fix.**
- New helper `subjectIdsIn` (`packages/db/src/repositories/subject-ids.ts`). It finds every inquiry, verification, session and account id (`inq_`, `ver_`, `iqse_`, `acc_` plus a ULID) in the text of stored values, including truncated previews.
- New columns `api_logs.subject_ids` and `idempotency_keys.subject_ids` (`text[]`, GIN-indexed; migration `0005_redaction_subject_ids`). `createApiLog` fills it from the path, resource id, query and both bodies. `completeIdempotencyKey` fills it from the resource id and the stored body. Because the repositories fill it, every writer is covered.
- Redaction clears rows `WHERE resource_id IN (ids) OR subject_ids && ids`. Rows written before the migration keep `'{}'`, are still matched by `resource_id`, and expire with retention.
- C16 in the plan names the new rule.

### RED

The PII seed of the API redaction tests (`redaction.test-support.ts`) gained a `GET /inquiries` and a `GET /accounts` list answer, a `GET /events/:id` answer that embeds the inquiry, and an idempotent consolidation answer that embeds the subject's account. The comprehensive "leaves nothing of the subject" test therefore covers them.

```text
$ (cd packages/db && npx vitest run src/repositories/redaction.test.ts --coverage.enabled=false)
     × clears API log and idempotent copies that mention it in a list or an embedding, whatever their resource id (2B F005, F017)
AssertionError: /api/v1/inquiries: expected { …(19) } to match object { responseBody: null }
      Tests  1 failed | 4 passed (5)

$ (cd apps/api && npx vitest run src/services/redaction.test.ts --coverage.enabled=false)
     × leaves nothing of the subject in any table or in storage
     × clears every API log and idempotent copy that mentions the inquiry, lists included (2B F005, F017)
AssertionError: expected '[{"id":"acc_01M5CWJRHG4D6DSTQJ51FM5WF…' not to contain 'Zyxw-synthetic-pii'
AssertionError: expected [ { data: [ { …(3) } ] }, …(2) ] to deeply equal [ null, null, null ]
      Tests  2 failed | 21 passed (23)
```

### GREEN

```text
$ (cd packages/db && npx drizzle-kit generate --name redaction_subject_ids && npx prettier --write drizzle src/repositories)
[✓] Your SQL migration file ➜ drizzle/0005_redaction_subject_ids.sql 🚀
$ (cd packages/db && npx vitest run --coverage.enabled=false)
      Tests  553 passed (553)
$ (cd packages/db && npx vitest run src/repositories/subject-ids.test.ts --coverage.enabled=false)
      Tests  3 passed (3)
$ (cd apps/api && npx vitest run src/services/redaction.test.ts src/plugins src/routes/server/api-logs.test.ts --coverage.enabled=false)
      Tests  163 passed (163)
```

`subject-ids.test.ts` pins down the extraction for the record: nested JSON, plain strings, truncated previews, and ids of other prefixes or of the wrong shape left out. It was written with the helper, so it has no RED run.

## F008: the preview of a truncated API log body bypassed PII masking

**Confirmed.** `truncated()` (`apps/api/src/services/api-logs.ts`) stored a body over 64 KiB as `{ truncated, byte-length, preview }`, where `preview` was the start of the raw JSON text. `maskPersonalData` walks object members only, so for a reader without `pii:view` the preview, with every `fields` value, `note`, address and user agent in it, came back verbatim. A `GET /inquiries?page[size]=100` answer passes 64 KiB easily.

**Fix.** The preview is cut from the JSON of `maskPersonalData(value)`. `byte-length` still gives the size of the whole original value. A preview is partial anyway, so readers with `pii:view` lose little: they see it masked too. Values that fit in 64 KiB are stored whole, as before, and masked when read. C12 in the plan says so.

### RED

```text
$ (cd apps/api && npx vitest run src/services/api-logs.test.ts src/plugins/api-logs.test.ts --coverage.enabled=false)
     × builds the preview of a truncated value from its PII-masked JSON (2B F008)
     × keeps PII out of the preview of a truncated body, so masking cannot be bypassed (2B F008)
AssertionError: expected '{"truncated":true,"byte-length":18390…' not to match /Synthetic-Jane|synthetic note|203\.0\…/
AssertionError: expected '{"data":[{"id":"inq_0","attributes":{…' to match /^\{"data":\[\{"id":"inq_0","attribute…/
      Tests  2 failed | 29 passed (31)
```

### GREEN

```text
$ (cd apps/api && npx vitest run src/services/api-logs.test.ts src/plugins/api-logs.test.ts src/routes/server/api-logs.test.ts --coverage.enabled=false)
      Tests  54 passed (54)
```

## F009: webhook custom header values were stored in API logs

**Confirmed.** `API_LOG_REDACTED_KEYS` (`packages/contracts/src/redaction.ts`) did not cover `custom-headers`. The API log of `POST /webhooks` and `PATCH /webhooks/:id` therefore kept the receiver's credentials (for example `Authorization`) in the clear. Anyone with `api-logs:read` could read them, while `webhooks:read` shows them only as `[REDACTED]` (C14).

**Fix.** New `API_LOG_REDACTED_VALUE_MAPS = ['custom-headers']`. `redactKeys` keeps the names inside such a member and replaces every value with `[REDACTED]`, the same way C14 responses show them. A non-object value is redacted whole, and `null` stays `null`. C12 in the plan lists the rule. The webhook URL part of the finding is left alone: `webhooks:read` already returns the URL, so logging it exposes nothing new (the verifier's note).

### RED

```text
$ (cd packages/contracts && npx vitest run src/redaction.test.ts --coverage.enabled=false)
     × keeps the names of webhook custom headers but never their values, which are credentials (2B F009)
AssertionError: expected undefined to deeply equal [ 'custom-headers' ]
      Tests  1 failed | 4 passed (5)

$ (cd apps/api && npx vitest run src/routes/server/webhook-actions.test.ts --coverage.enabled=false -t "F009")
     × keeps custom header values out of the API log of the create and the update (2B F009)
AssertionError: expected '[{"type":"api-log","id":"alog_01M5CWV…' not to match /synthetic-(create|patch)-s3cr3t/
      Tests  1 failed | 76 skipped (77)
```

The first API run used `filter[route]` with two comma-separated routes and found no entry. That filter takes one route, so the test failed for the wrong reason. It now filters on `filter[method]=POST,PATCH` and fails for the intended one, shown above.

### GREEN

```text
$ (cd packages/contracts && npx vitest run --coverage.enabled=false)
      Tests  1184 passed (1184)
$ (cd apps/api && npx vitest run src/routes/server/webhook-actions.test.ts src/services/api-logs.test.ts src/plugins/api-logs.test.ts --coverage.enabled=false)
      Tests  108 passed (108)
```

## F007: redacting an account left the accounts consolidated into it

**Confirmed.** `consolidateAccounts` archives each source with `consolidated_into = target` and leaves its sealed `fields` and its events in place. `redactAccount` changed only the target row and the events about the target. `GET /accounts/<source>` and the source's `account.created` events therefore still held the person's fields.

**Fix.**
- `redactAccountRecords` returns `consolidatedAccountIds`: the accounts with `consolidated_into = target`.
- `RedactionService.redactAccount` redacts each of them after the target, with the same treatment: fields, events, stored copies, `account.redacted` and the audit entry. It runs on a re-run too, so a retry finishes what a failed run left.
- The recursion guards against cycles with a visited set. Consolidation re-points earlier sources at the new target, so one level is the normal case.
- C16 in the plan names the cascade.

### RED

```text
$ (cd packages/db && npx vitest run src/repositories/redaction.test.ts --coverage.enabled=false)
     × names the accounts consolidated into it, which keep their own fields (2B F007)
AssertionError: expected undefined to deeply equal [ …(2) ]
      Tests  1 failed | 5 passed (6)

$ (cd apps/api && npx vitest run src/services/redaction.test.ts --coverage.enabled=false)
     × redacts the accounts consolidated into it: their fields, events and copies (2B F007)
AssertionError: expected { …(11) } to match object { fields: {}, …(1) }
      Tests  1 failed | 23 passed (24)
```

### GREEN

```text
$ (cd packages/db && npx vitest run src/repositories/redaction.test.ts --coverage.enabled=false)
      Tests  6 passed (6)
$ (cd apps/api && npx vitest run src/services/redaction.test.ts src/routes/server/accounts.test.ts --coverage.enabled=false)
      Tests  81 passed (81)
```

`tsc --noEmit` then flagged two casts in the F001 and F009 tests. Both tests now read typed documents (committed separately, behaviour unchanged).

## F018 (and MEDIUM F006): redacting an open inquiry left its flow session usable

**Confirmed.** `redactInquiryRecords` nulled the IP and user agent of existing sessions but left them `active`, left one-time links unused, and kept the inquiry `created`/`pending`. The flow service (`openInquiry`), `resumeInquiry` and `generateOneTimeLink` never looked at `redacted_at`. The end user could therefore keep writing after an erasure: consent IP and user agent (never cleaned again), uploads, verifications.

**Fix.**
- `RedactionService.redactInquiry` cancels the inquiry's active sessions (`cancelActiveSessions`, staging `inquiry-session.canceled`) and revokes its unused one-time links (`revokeOneTimeLinks`), inside the redaction transaction and after the IP and user agent are nulled, so the event carries none. It does this on re-runs too.
- `openInquiry`, which every flow write goes through (consent, new verification, upload, submit), answers 410 `redacted` for a redacted inquiry, even on a session that is still active, for example a request already past authentication.
- `POST /inquiries/:id/resume` and `generate-one-time-link` answer 410 `redacted` for a redacted inquiry.
- The inquiry keeps its status. Its `expires-at` still ends it, and C16 does not define a status change for redaction.
- C16 in the plan describes the open-inquiry case.

F006 (MEDIUM) is the same defect seen from the flow side. This fix covers it.

### RED

```text
$ (cd apps/api && npx vitest run src/services/redaction.test.ts src/routes/flow/verifications.test.ts src/routes/server/inquiry-actions.test.ts --coverage.enabled=false -t "F018")
     × cancels the active sessions and revokes the unused one-time links of an open inquiry (2B F018)
     × answers 410 redacted to new sessions and one-time links for a redacted open inquiry (2B F018)
     × answers 410 redacted to consent, new verifications, uploads and submits, even on a live session
AssertionError: expected { …(15) } to match object { status: 'canceled', …(2) }
AssertionError: {"consent":{"accepted-at":"2026-10-20T12:00:00.000Z"}}: expected 201 to be 410 // Object.is equality
AssertionError: resume: {"data":{"type":"inquiry",...,"redacted-at":"2026-10-20T14:57:31.281Z",...},"meta":{"session-token":"ovs_...","flow-url":"..."}}: expected 200 to be 410 // Object.is equality
      Tests  3 failed | 131 skipped (134)
```

### GREEN

```text
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/services src/routes/flow src/routes/server/inquiry-actions.test.ts src/routes/server/inquiries.test.ts src/routes/server/inquiry-updates.test.ts --coverage.enabled=false)
      Tests  364 passed (364)
```

`tsc` found that the flow test passed a bare id to `listVerificationFiles`, which takes a list. The RED run failed before reaching that line. The test now passes `[verificationId]` (committed with the formatting of the review tests).

## F011: a webhook job that failed for good blocked its own re-enqueue

**Confirmed.** Jobs are named `<delivery>-<attempt>`, BullMQ keeps failed jobs for 7 days (`removeOnFail`), and the BullMQ 6.3.11 add scripts return the existing job when the id still exists. After a database outage longer than the three BullMQ attempts, the delivery row stayed `pending`, and `sweepDueWebhookDeliveries` re-added the same id, which did nothing. The delivery was never attempted again and never marked failed.

**Fix.**
- `JobQueue` gains an optional `remove(jobId)`. BullMQ's `Queue.remove` already does this: it removes the job in any state except active, since an active job is locked.
- `scheduleDelivery(job, delayMs, { replace: true })` removes a job left under the attempt's id before it adds. The sweep always replaces, because the row is the source of truth: a job for an attempt that was already recorded does nothing (`stale_attempt` / `not_pending`). Retries scheduled by the processor still add plainly.
- The recording test queue records removals.

### RED

The new Testcontainers test (`apps/api/src/webhooks/queue.integration.test.ts`, Valkey 9.1) drives real BullMQ. A worker fails the job for good, and then:
1. a plain add leaves it `failed`, which reproduces the finding;
2. a replacing add must make it `waiting`.

```text
$ (cd apps/api && npx vitest run src/webhooks/queue.test.ts src/webhooks/dispatcher.test.ts --coverage.enabled=false)
     × removes a job left under the same id before adding, when asked to replace it (2B F011)
     × replaces the job an earlier run of the attempt left, which would block the add (2B F011)
AssertionError: expected undefined to deeply equal [ 'whd_01M5CX8D94D143FFREJKR3ZSCJ-1' ]
      Tests  2 failed | 34 passed (36)

$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/webhooks/queue.integration.test.ts)
     × enqueues an attempt again over a job that failed for good, when the sweep replaces it
AssertionError: expected 'failed' to be 'waiting' // Object.is equality
      Tests  1 failed (1)
```

### GREEN

```text
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/webhooks src/jobs src/worker.test.ts --coverage.enabled=false)
      Tests  443 passed (443)
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/webhooks/queue.integration.test.ts)
      Tests  1 passed (1)
```

## MEDIUM findings

### F002: an unsatisfied session could enrol its own factor and become satisfied

**Confirmed.** Every `/me/mfa-factors*` route allows sessions that have not satisfied MFA, and the enrolment services never check for an existing active factor. `activated()` then marks the current session satisfied. Take a password-only session that predates the user's enrolment, or the organization's `require-mfa`. It could enrol an attacker's TOTP and get full access, and it could delete the real factors.

**Fix (local).** A `preHandler` on the TOTP enrol and confirm routes, both WebAuthn registration routes and `DELETE /me/mfa-factors/:id` answers 401 `mfa-required` when the session is unsatisfied and the user already has an active factor. A user without a factor still enrols the first one from such a session, as C15 intends. `GET /me/mfa-factors` stays open. The finding's further suggestion, revoking the user's other sessions on the first activation, is not done here: it changes the session behaviour of every enrolment and is not needed to close the bypass.

#### RED

```text
$ (cd apps/api && npx vitest run src/routes/dashboard/sessions-mfa.test.ts --coverage.enabled=false -t F002)
     × refuses enrolment and factor removal to an unsatisfied session once the user has an active factor (2B F002)
AssertionError: POST /me/mfa-factors/totp: expected 201 to be 401 // Object.is equality
      Tests  1 failed | 15 skipped (16)
```

#### GREEN

```text
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/routes/dashboard src/openapi.test.ts --coverage.enabled=false)
      Tests  112 passed (112)
```

### F003: a session already in production kept production access after a demotion

**Confirmed.** `environments:production` was checked only by `switchSessionEnvironment`. `findUserSessionContext` recomputes the permissions on every request but returned the stored production environment without checking them, and a role change does not revoke sessions. A user demoted while in production kept production access, with the new role's other permissions, until the session expired (up to 12 h).

**Fix (local).** `findUserSessionContext`, which serves both the dashboard authentication and the server-API user-session resolver, returns `null` for a session in a production environment whose user lacks `environments:production`. That session then gets the generic 401, and the user signs in again into the sandbox. Login lands in production only when an organization has no sandbox, and every organization is created with one. The existing test "reports the kind of the session's environment" logged in a user with no roles at all. Its user now holds the developer role, and a new test pins down the refusal.

#### RED

```text
$ (cd apps/api && npx vitest run src/operator-auth/principal-resolver.test.ts --coverage.enabled=false)
     × stops resolving a production session once the user lost environments:production (2B F003)
AssertionError: expected { kind: 'user', …(7) } to be null
      Tests  1 failed | 7 passed (8)
```

#### GREEN

```text
$ (cd apps/api && npx vitest run src/operator-auth src/routes/dashboard src/seed --coverage.enabled=false)
      Tests  285 passed (285)
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/operators.integration.test.ts)
      Tests  3 passed (3)
```

The first GREEN run failed "reports the kind of the session's environment" (`expected null to match object { environmentKind: 'production' }`), because that user held no roles. See above.

### F010: a delete could report success while the object stayed; redacted files keep their wrapped DEK

**Confirmed, fixed in part.**
- **Storage (fixed, local).** `versionIdsOf` (`apps/api/src/storage/index.ts`) dropped listing entries without a `VersionId`, so a store that lists unversioned objects that way got no delete at all, and redaction then marked the file deleted. Such an entry now leads to a plain `DeleteObject` for the key. Versions with ids are still deleted one by one. A key the listing does not show still gets no request, so no delete marker is left.
- **Crypto-shredding the row (skipped).** Nulling or tombstoning `files.wrapped_dek` and `sha256` means relaxing the `files_wrapped_dek_format` and `NOT NULL` constraints (a migration). It also touches `kek:rewrap`, which walks every wrapped DEK. That is not a local, low-risk change, so it is reported as skipped.

#### RED

```text
$ (cd apps/api && npx vitest run src/storage/index.test.ts --coverage.enabled=false)
     × deletes the object plainly when the listing shows it without version ids, so no copy stays (2B F010)
AssertionError: expected [] to deeply equal [ Array(1) ]
      Tests  1 failed | 32 passed (33)
```

#### GREEN

```text
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/storage/index.test.ts --coverage.enabled=false)
      Tests  33 passed (33)
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/storage/storage.integration.test.ts)
      Tests  3 passed (3)
```

### F004: parallel MFA guesses bypassed the five-attempt limit

**Confirmed.** `completeMfa` and `completeWebauthnMfa` read the challenge, checked the factor, and only then counted a failure. Every request sent before the first failure was recorded passed the check. A slow check widens the window: an Argon2 recovery-code verification, for example.

**Fix (local).**
- New `reserveMfaChallengeAttempt` (`packages/db/src/repositories/mfa.ts`): `UPDATE ... SET failed_attempts = failed_attempts + 1 WHERE usable AND failed_attempts < 5 AND expires_at > now`. It takes an attempt atomically before the factor is checked, so at most five checks ever run per token. `failed_attempts` then counts attempts taken.
- Taking an attempt revokes nothing, so the fifth may still be the right code, as the existing "revokes the mfa-token after five wrong codes" test requires.
- After a wrong factor, `revokeExhaustedMfaChallenge` revokes the challenge once all five are taken. A request that finds no attempt left answers `InvalidMfaTokenError`, as a revoked token does.
- Not done: the suggested extra per-address and per-user limiter on `/sessions/mfa`. Each `ovm_` token now gets at most five checks, and new tokens come only through the per-email login limiter.

#### RED

```text
$ (cd apps/api && npx vitest run src/operator-auth/operator-auth.test.ts --coverage.enabled=false -t F004)
     × counts parallel guesses against the five-attempt limit before checking them (2B F004)
AssertionError: expected 12 to be 5 // Object.is equality
      Tests  1 failed | 36 skipped (37)

$ (cd packages/db && npx vitest run src/repositories/mfa.test.ts --coverage.enabled=false)
     × hand out at most five attempts, taken before a factor is checked, even in parallel (2B F004)
     × keep a challenge with attempts left after a failure, and refuse expired ones (2B F004)
TypeError: reserveMfaChallengeAttempt is not a function
      Tests  2 failed | 8 passed (10)
```

#### GREEN

```text
$ (cd packages/db && npx vitest run src/repositories/mfa.test.ts --coverage.enabled=false)
      Tests  10 passed (10)
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/operator-auth src/routes/dashboard --coverage.enabled=false)
      Tests  260 passed (260)
```

### F012 and F020: inquiry creation could attach to an account being consolidated

**Confirmed** (F020 is the same race as F012). `resolveForInquiry` read the account by id or by reference id without a lock and returned `consolidated_into ?? id`. Under READ COMMITTED, a consolidation that had locked and changed the source but not committed yet was invisible. The new inquiry then landed on the archived source after the consolidation moved the source's inquiries.

**Fix (local).** New `lockAbsorbingAccount` (`packages/db/src/repositories/accounts.ts`) reads the account `FOR SHARE` and follows `consolidated_into`, share-locking each hop (at most 10). A consolidation in flight, which holds `FOR UPDATE`, is waited for. A later one waits until the inquiry commits and then moves it with the source's other inquiries. `resolveForInquiry` uses it for both the `account-id` and the `reference-id` path, and `resolveInquiryAccount` uses it after its insert loses to an existing reference id.

#### RED

New Testcontainers test in `apps/api/src/services/lifecycle.integration.test.ts`. One transaction locks the source and sets `consolidated_into`, as `consolidateAccounts` does. While it is open, `resolveForInquiry` runs in another connection, and the first transaction commits 300 ms later.

```text
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/services/lifecycle.integration.test.ts -t "F012")
     × waits for an in-flight consolidation and resolves the account-id to the absorbing account (2B F012, F020)
     × waits for an in-flight consolidation and resolves the reference-id to the absorbing account (2B F012, F020)
AssertionError: expected 'acc_01M5CXXH75K0QPCBV4PFK1PGPM' to be 'acc_01M5CXXH8NM585FHY0YMMH0SGG' // Object.is equality
      Tests  2 failed | 4 skipped (6)
```

#### GREEN

```text
$ (cd packages/db && npx tsc --noEmit && npx vitest run src/repositories/accounts.test.ts --coverage.enabled=false)
      Tests  16 passed (16)
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/services/accounts.test.ts src/routes/server/accounts.test.ts src/routes/server/inquiries.test.ts --coverage.enabled=false)
      Tests  116 passed (116)
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/services/lifecycle.integration.test.ts)
      Tests  6 passed (6)
```

### F013: add-relation locked one account and read the other unlocked

**Confirmed.** `addAccountRelation` locked only the account itself (`FOR UPDATE`) and read the related account unlocked. A consolidation of the related account that committed in between left a relation pointing at an archived, consolidated account. The unordered locks could also deadlock against a consolidation that locks in id order. `inquiryAccounts` (add-objects, remove-objects) locked inquiry rows `FOR UPDATE` without an order.

**Fix (local).** `addAccountRelation` locks both accounts with the existing `lockInIdOrder`, then checks that both exist and neither was consolidated (409 `invalid-transition`). `inquiryAccounts` locks its inquiries `ORDER BY id`.

#### RED

New Testcontainers test: `POST /accounts/:id/add-relation` runs while another transaction holds the related account locked and has set its `consolidated_into`. That transaction commits 300 ms later.

```text
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/services/lifecycle.integration.test.ts -t "F013")
     × locks both accounts of add-relation, so it cannot relate to an account consolidated meanwhile (2B F013)
AssertionError: {"data":{"type":"account",...}}: expected 200 to be 409 // Object.is equality
      Tests  1 failed | 6 skipped (7)
```

#### GREEN

```text
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/services/accounts.test.ts src/routes/server/accounts.test.ts --coverage.enabled=false)
      Tests  76 passed (76)
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/services/lifecycle.integration.test.ts)
      Tests  7 passed (7)
```

`tsc` then flagged the type of the pending request in the new test, which is now typed as a promise of the response (committed separately).

### F014: idempotent responses are stored after the work commits

**Confirmed, fixed in part.**
- **Fixed (local): a stale holder could settle a key another request had taken over.** `complete` and `release` matched only the id and `in_progress`. A request that outlived its 120 s lease could therefore store its answer over the new holder's claim, or `release` (delete) it. The claim now returns its `lockedUntil` (`IdempotencyClaim.lockedUntil`). `completeIdempotencyKey` and `releaseIdempotencyKey` take an optional `{ lockedUntil }` holder and then match `locked_until = holder.lockedUntil`. A takeover always sets a later lease, so the lease works as a fencing token without a new column. The plugin keeps the lease with the held key and passes it back.
- **Not fixed: re-execution after a store failure or crash.** If the answer was sent but not stored, a retry after the lease runs the request again. Closing that means writing the stored answer in the same transaction as each service's state change, or refusing a takeover. The first is not local. The second would block a key for 24 h after a crashed request, which the lease exists to avoid. Both change C12 behaviour, so this part is reported as skipped.

#### RED

```text
$ (cd packages/db && npx vitest run src/repositories/idempotency-keys.test.ts --coverage.enabled=false)
     × lets a request take over a key whose lease ran out
     × lets only the current holder settle a key, so a request that outlived its lease cannot undo a takeover (2B F014)
AssertionError: expected { outcome: 'claimed', id: 6 } to deeply equal { outcome: 'claimed', id: 6, …(1) }
AssertionError: expected undefined to not deeply equal undefined
      Tests  2 failed | 5 passed (7)
```

The first failure is the takeover test, which now also expects the claim's lease in the result.

#### GREEN

```text
$ (cd packages/db && npx tsc --noEmit && npx vitest run src/repositories/idempotency-keys.test.ts --coverage.enabled=false)
      Tests  7 passed (7)
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/plugins --coverage.enabled=false)
      Tests  118 passed (118)
$ (cd apps/api && npx vitest run src/plugins/idempotency.test.ts --coverage.enabled=false)
      Tests  22 passed (22)
```

The plugin test "settles the key with the lease of its own claim (2B F014)" was added with the fix. It checks that both `complete` and `release` receive the claim's lease.

### F019: the retention sweeps had no index to walk oldest rows

**Confirmed, fixed in part.** `deleteExpiredApiLogs`, `deleteExpiredEvents` and `deleteExpiredWebhookDeliveries` take `ORDER BY created_at LIMIT 500` across environments. The cutoff depends on the joined environment's settings. The only indexes led with `environment_id`, so every batch scanned and sorted the whole table.
- **Fixed (local).** New indexes `api_logs_created_at_idx`, `events_created_at_idx` and the partial `webhook_deliveries_finished_created_at_idx` (`WHERE status <> 'pending'`, matching the sweep's filter), in migration `0006_retention_created_at_indexes`. Postgres can now walk each table oldest first and stop after 500 matches.
- **Not done.** Two further suggestions are left out: per-environment sweeps with an app-computed cutoff, which restructures the job, and skipping inquiry retention when no window is configured. The second scans the existing partial `inquiries_retention_updated_at_idx` and changes no data. Neither is needed for the indexes to apply.

#### RED

```text
$ (cd packages/db && npx vitest run src/schema-v2.test.ts --coverage.enabled=false -t F019)
     × lets the retention sweeps walk api logs, events and finished deliveries oldest first (F019)
Error: api_logs has no index api_logs_created_at_idx
      Tests  1 failed | 63 skipped (64)
```

#### GREEN

```text
$ (cd packages/db && npx drizzle-kit generate --name retention_created_at_indexes && npx prettier --write drizzle)
[✓] Your SQL migration file ➜ drizzle/0006_retention_created_at_indexes.sql 🚀
$ (cd packages/db && npx vitest run --coverage.enabled=false)
      Tests  561 passed (561)
```

### F021: a duplicate worker double-counted a webhook attempt

**Confirmed.** `recordWebhookDeliveryAttempt` matched only `status = 'pending'`. Two workers running the same attempt both passed the `job.attempt === attemptCount + 1` check, both sent, and both recorded. That burnt two of the eight attempts and appended two entries. It can happen with a stalled BullMQ job that is re-run, or with the sweep's replacement from F011.

**Fix (local).** `WebhookDeliveryAttempt` takes an optional `attempt` number. When it is given, the update also requires `attempt_count = attempt - 1`. The dispatcher passes it, so the second recording returns `null` and the worker reports `skipped: raced`. The duplicate HTTP send itself can still happen, which receivers handle through `OpenVerify-Event-Id` (C5). Preventing it would mean locking the row around the send.

#### RED

```text
$ (cd packages/db && npx vitest run src/repositories/webhooks-v2.test.ts --coverage.enabled=false -t F021)
     × records a numbered attempt only once, so a duplicate worker cannot count it twice (2B F021)
AssertionError: expected { …(17) } to be null
      Tests  1 failed | 8 skipped (9)

$ (cd apps/api && npx vitest run src/webhooks/dispatcher.test.ts --coverage.enabled=false -t F021)
     × records an attempt once when two workers run it, so retries are not burnt twice (2B F021)
AssertionError: expected [ 'retry', 'retry' ] to deeply equal [ 'retry', 'skipped' ]
      Tests  1 failed | 30 skipped (31)
```

#### GREEN

```text
$ (cd packages/db && npx tsc --noEmit && npx vitest run src/repositories/webhooks-v2.test.ts src/repositories/webhooks.test.ts --coverage.enabled=false)
      Tests  21 passed (21)
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/webhooks src/routes/server/webhook-deliveries.test.ts src/routes/server/webhook-actions.test.ts --coverage.enabled=false)
      Tests  376 passed (376)
```

### F022: user sessions, one-time links, inquiry sessions and audit logs had no retention

**Confirmed, fixed for the credentials; the rest decided as policy.**
- **Fixed.** `deleteExpiredUserSessions` and `deleteExpiredOneTimeLinks` (`packages/db/src/repositories/retention.ts`) delete, in batches of 500 with `FOR UPDATE SKIP LOCKED`, the rows 30 days past their `expires_at` (`EXPIRED_CREDENTIAL_RETENTION_DAYS`). A revoked or used session or link has expired by then, since sessions live 12 h and links at most 30 days. Both are indexed on `expires_at` (migration `0007_expired_credential_indexes`). `runRetention` drains them, and the report gains `deletedUserSessions` and `deletedOneTimeLinks`.
- **Policy, recorded in C16 of the plan.** Audit logs are append-only (a database trigger refuses deletes) and kept. Inquiry sessions hold their inquiry's consent record (`getLatestInquiryConsent` reads it) and stay with the inquiry. Redaction clears their PII.

#### RED

```text
$ (cd apps/api && npx vitest run src/services/retention.test.ts --coverage.enabled=false -t F022)
     × deletes user sessions and one-time links 30 days past their expiry (2B F022)
AssertionError: expected { redactedInquiries: +0, …(6) } to match object { deletedUserSessions: 1, …(1) }
      Tests  1 failed | 12 skipped (13)
```

#### GREEN

```text
$ (cd packages/db && npx drizzle-kit generate --name expired_credential_indexes && npx prettier --write drizzle src)
[✓] Your SQL migration file ➜ drizzle/0007_expired_credential_indexes.sql 🚀
$ (cd packages/db && npx tsc --noEmit && npx vitest run --coverage.enabled=false)
      Tests  562 passed (562)
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/services/retention.test.ts src/retention-run.test.ts src/jobs --coverage.enabled=false)
      Tests  160 passed (160)
```

The report's empty value in `retention.test.ts` and the JSON line in `retention-run.test.ts` list the two new counts.

### F023: no index on accounts (environment_id, consolidated_into)

**Confirmed.** `consolidateAccounts` re-points `WHERE consolidated_into IN (sources)` while it holds the row locks. The self-referencing key `accounts_consolidated_into_fk` is checked on deletes. With the F007 fix, redaction also looks up `consolidated_into = account`. All of these scanned the environment's accounts.

**Fix (local).** Partial index `accounts_environment_id_consolidated_into_idx` on `(environment_id, consolidated_into) WHERE consolidated_into IS NOT NULL` (migration `0008_accounts_consolidated_into_index`).

#### RED

```text
$ (cd packages/db && npx vitest run src/schema-v2.test.ts --coverage.enabled=false -t F023)
     × finds the accounts consolidated into an account without a scan (F023)
Error: accounts has no index accounts_environment_id_consolidated_into_idx
```

#### GREEN

```text
$ (cd packages/db && npx drizzle-kit generate --name accounts_consolidated_into_index && npx prettier --write drizzle)
[✓] Your SQL migration file ➜ drizzle/0008_accounts_consolidated_into_index.sql 🚀
$ (cd packages/db && npx vitest run --coverage.enabled=false)
      Tests  563 passed (563)
```

### F024: the invitation email is sent inside the database transaction

**Skipped (design trade-off, not a local change).** `inviteUser` sends the email inside the transaction on purpose. The doc comment says so: the user, the roles and the audit entry commit only once SMTP accepted the email, so a failed send leaves no invited user. Sending after the commit needs a compensating delete of the user, the roles and the audit entry when the send fails. Audit logs are append-only, so that entry could not be removed. It would also change what the operator sees after a 502. The residual risk is an emailed link whose row was rolled back by a failed commit. That link answers 404 and the operator invites again, and nothing leaks.

### F033: an SMTP failure was replaced by a generic 502 without its cause

**Confirmed.** `inviteUser` threw `new MailDeliveryError()` and dropped the SMTP error, so the error log held only the 502.

**Fix (local).** `MailDeliveryError` carries `smtp: { name, code?, responseCode?, command? }`, the failure's kind as Nodemailer reports it. The error handler logs the error with `request.log.error({ err })`, and the pino error serializer copies own properties, so the kind reaches the log. The SMTP message is not kept, because it can name the recipient. F024's transaction concern is left as described above.

#### RED

```text
$ (cd apps/api && npx vitest run src/services/users.test.ts --coverage.enabled=false)
     × keeps the SMTP failure kind on the 502 for the error log, never its message (2B F033)
AssertionError: expected MailDeliveryError: The invitation email c… { …(6) } to match object { status: 502, smtp: { …(4) } }
```

The first RED run failed for a setup reason, the inviter's foreign key (`users_invited_by_users_id_fk`). The test now creates a real inviting user and fails for the intended reason, shown above.

#### GREEN

```text
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/services/users.test.ts src/routes/dashboard/users.test.ts src/problem-details.test.ts --coverage.enabled=false)
      Tests  40 passed (40)
```

### F026: the OpenAPI document omits the C12 platform headers and problems

**Skipped (outside this fixer's paths).** The fix adds parameters and responses to every server-API operation, so the committed snapshot `docs/api/openapi.json` must be regenerated (`openapi.test.ts` compares the served document with it). That file is not in the TypeScript fixer's paths. Every other change in this pass leaves the OpenAPI document unchanged, so the snapshot test still passes.

### F028: the Node client failed a successful write on any added attribute

**Confirmed.** `parseAnswer` (`packages/node/src/transport.ts`) parses success answers with the strict contract schemas (`z.strictObject`). Any member a newer server adds threw `OpenVerifyResponseValidationError`, even after a write had succeeded.

**Fix (local to the client).** When every issue of a failed parse is `unrecognized_keys`, the client drops those members from a copy of the answer and parses again (at most 10 passes, enough for members nested in unions). Any other issue still throws, so everything the client knows is still validated. The contracts and their strict schemas are unchanged, and so is the OpenAPI document. C18 in the plan records the rule.

#### RED

```text
$ (cd packages/node && npx vitest run src/client.test.ts --coverage.enabled=false -t F028)
     × accepts members a later server adds and leaves them out, so a write that succeeded is not reported as failed (2B F028)
OpenVerifyResponseValidationError: The API answer does not match the contract this client was built with
      Tests  1 failed | 36 skipped (37)
```

#### GREEN

```text
$ (cd packages/node && npx tsc --noEmit && npx vitest run --coverage)
      Tests  186 passed (186)
All files          |   99.03 |    93.86 |     100 |   99.33 |
```

`tsc` flagged a spread of the untyped fixture in the new test. The test now types it (committed separately).

### F031: an incomplete retention run still succeeded

**Confirmed.** `runRetention` reported failed redactions only as a warning log and a count. It did not count failed storage deletes at all (`purgeRedactedFiles` logged and went on). The BullMQ job completed, so its retries never ran and no failed job was recorded. `retention:run` exited 0.

**Fix (local).**
- `purgeRedactedFiles` takes an `onFailure(fileId)` callback. `runRetention` counts the distinct files in a new report field, `failedPurges`.
- New `isRetentionIncomplete(report)`: true when `failedRedactions > 0` or `failedPurges > 0`.
- `retentionProcessor` throws `RetentionIncompleteError` (counts only) after the whole run, so every other deletion still happens. BullMQ then records the failed job, the worker's `failed` listener logs it at error level, and the job's three attempts retry it.
- `retention:run` prints an "incomplete" line, and its entry point sets exit code 1.
- C16 in the plan records the behaviour.

#### RED

```text
$ (cd apps/api && npx vitest run src/services/retention.test.ts src/retention-run.test.ts src/jobs/retention.test.ts --coverage.enabled=false -t F031)
     × counts the files of redacted inquiries that storage could not delete (2B F031)
     × fails the job once the run is done when files of redacted inquiries could not be deleted, so BullMQ records and retries it
     × says the run is incomplete when an inquiry could not be redacted, for a failing exit code (2B F031)
TypeError: isRetentionIncomplete is not a function
AssertionError: promise resolved "{ redactedInquiries: +0, …(8) }" instead of rejecting
AssertionError: expected { redactedInquiries: +0, …(8) } to match object { purgedFiles: +0, failedPurges: 2 }
      Tests  3 failed | 35 skipped (38)
```

#### GREEN

```text
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/services/retention.test.ts src/retention-run.test.ts src/jobs src/services/redaction.test.ts --coverage.enabled=false)
      Tests  188 passed (188)
```

The report's empty value and the JSON line in the CLI test list the new `failedPurges` count.

### F032: expired MFA and WebAuthn challenges were never purged

**Confirmed.** `deleteExpiredAuthChallenges` (`packages/db/src/repositories/retention.ts`) existed, but nothing called it.

**Fix (local).** `runRetention` calls it once per run, with the run's `now`, and reports `deletedAuthChallenges`. The challenges live five minutes, so one statement per day stays small. C16 in the plan lists it.

#### RED

```text
$ (cd apps/api && npx vitest run src/services/retention.test.ts --coverage.enabled=false -t F032)
     × deletes expired MFA login and WebAuthn registration challenges (2B F032)
AssertionError: expected { redactedInquiries: +0, …(9) } to match object { deletedAuthChallenges: 2 }
      Tests  1 failed | 14 skipped (15)
```

#### GREEN

```text
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/services/retention.test.ts src/retention-run.test.ts src/jobs --coverage.enabled=false)
      Tests  164 passed (164)
```

### F034: a deeply nested JSON body made the request fail with 500

**Confirmed.** The API-log `preValidation` capture (`redactKeys`, then `JSON.stringify`) and the idempotency fingerprint (`canonicalJson`) walk the parsed body recursively. A body of about 100,000 nested arrays, which `JSON.parse` accepts, ran out of stack. The request then answered 500 instead of the route's 400, and the API log's "never fails a request" promise did not hold.

**Fix (local).**
- The API-log capture runs in a `try`. A body it cannot walk is logged as `null`, with a warning that names only the error class, and the route answers as it would.
- The idempotency fingerprint turns a `RangeError` into 400 ("The request body is nested too deeply."), before the request runs.

#### RED

```text
$ (cd apps/api && npx vitest run src/plugins/api-logs.test.ts src/plugins/idempotency.test.ts --coverage.enabled=false -t F034)
     × answers 400 for a body nested too deeply to fingerprint, without running the request (2B F034)
     × answers a body nested too deeply to log as the route would, and logs it without the body (2B F034)
AssertionError: expected 500 to be 400 // Object.is equality
AssertionError: {"type":"about:blank","title":"Internal Server Error","status":500,"detail":"Maximum call stack size exceeded",...}: expected 500 to be 400 // Object.is equality
      Tests  2 failed | 35 skipped (37)
```

#### GREEN

```text
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/plugins --coverage.enabled=false)
      Tests  121 passed (121)
```

### K002: account.created of a new inquiry account waited for the sweep

**Confirmed.** `resolveForInquiry` staged `account.created` in the inquiry transaction, but the locked port had no way to hand the staged event back. Only `inquiry.created` was dispatched after the commit, and the account's webhook deliveries stayed `pending` until the dispatcher's sweep, up to about 90 s later.

**Fix (local, additive change to the C13 port).** `AccountsService.resolveForInquiry` takes an optional fourth argument, `staged: StagedEvent[]`. The accounts service appends the `account.created` it stages, and `createInquiry` dispatches those events with `inquiry.created` after the commit. Callers and fakes that pass nothing keep the old behaviour. C13 in the plan records the signature.

#### RED

```text
$ (cd apps/api && npx vitest run src/routes/server/inquiries.test.ts --coverage.enabled=false -t K002)
     × is dispatched with inquiry.created after the commit, not left to the sweep
AssertionError: expected [] to deeply equal [ 'acc_01M5CZ9Z96EB4S0DEWYVPHFA5V' ]
      Tests  1 failed | 40 skipped (41)
```

#### GREEN

```text
$ (cd apps/api && npx tsc --noEmit && npx vitest run src/routes/server/inquiries.test.ts src/services/accounts.test.ts src/ports.test.ts --coverage.enabled=false)
      Tests  73 passed (73)
```

`tsc` flagged a nullable access in the new test (`relationships.account?.data?.id`), fixed in a separate commit.

## Final validation

Run after the last fix, from the repository root, after `source scripts/env.sh`.

```text
$ pnpm format:check
All matched files use Prettier code style!

$ pnpm typecheck
 Tasks:    12 successful, 12 total

$ pnpm lint
 Tasks:    12 successful, 12 total
```

The first `pnpm lint` run failed twice:
- `@typescript-eslint/no-unnecessary-condition` in `subject-ids.ts` (`JSON.stringify(...) ?? ''`);
- `@typescript-eslint/consistent-generic-constructors` in `redaction.ts`.

Both are fixed in two `refactor:` commits, with behaviour unchanged.

```text
$ pnpm test        # every package's script gates coverage at 80%
@openverify/core:test:       Tests  399 passed (399)    All files 100 / 100 / 100 / 100
@openverify/contracts:test:  Tests  1184 passed (1184)  All files 100 / 100 / 100 / 100
@openverify/db:test:         Tests  563 passed (563)    All files 99.12 / 92.21 / 99.36 / 99.08
@openverify/node:test:       Tests  186 passed (186)    All files 99.03 / 93.86 / 100 / 99.33
@openverify/api:test:        Tests  1985 passed (1985)  All files 97.53 / 90.09 / 98.32 / 97.59
@openverify/e2e:test:        Tests  59 passed (59)      All files 96.49 / 87.61 / 92.3 / 97.55
(flow-spec, config, checks, dashboard, ui and flow unchanged and passing)
 Tasks:    12 successful, 12 total

$ pnpm test:integration    # Testcontainers: pgvector/pgvector:pg17, valkey/valkey:9.1, rustfs/rustfs:1.0.3
@openverify/db:test:integration:   Tests  37 passed (37)
@openverify/api:test:integration:  Tests  32 passed (32)
 Tasks:    2 successful, 2 total

$ pnpm e2e    # compose project openverify-e2e, started and torn down by the suite
@openverify/flow:e2e:   9 passed (5.8s)
@openverify/e2e:e2e:   16 passed (58.5s)
 Tasks:    9 successful, 9 total
```

No test failed only under the whole-workspace load.

## Contract changes (recorded in `docs/plans/phase-2.plan.md`)

- **C12 `Principal`.** The API-key variant gains the optional `piiMasked` (F001). The API-log redaction also covers the values inside `custom-headers` (F009), and a truncated body's preview is cut from the masked JSON (F008).
- **C13 `AccountsService.resolveForInquiry`.** It takes an optional fourth argument, `staged`, for events to dispatch after the commit (K002), and share-locks the account it resolves (F012).
- **C15.**
  - The developer and reviewer roles gain `verifications:read` (K001).
  - Masking: keys minted by a principal without `pii:view` see PII masked (F001).
  - Required MFA: an unsatisfied session of a user who already has a factor may not enrol or remove factors (F002).
  - `environments:production` is needed to keep using a production session (F003).
- **C16.**
  - Redaction also clears API-log and idempotent copies that mention the subject (F005, F017).
  - Redacting an account cascades to the accounts consolidated into it (F007).
  - Redacting an open inquiry ends its sessions and links, and flow writes then answer 410 (F018).
  - Retention fails the job and the command on failures (F031), and deletes old sessions, links and challenges (F022, F032).
- **C18.** The Node client drops members a newer server adds (F028).
- **Schema.** Migrations `0004` to `0008`: `api_keys.pii_masked`, `subject_ids` on `api_logs` and `idempotency_keys`, and the retention and consolidation indexes.
