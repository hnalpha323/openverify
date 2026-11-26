# TDD evidence: Phase 2, api-inquiries

Slice owner: api-inquiries agent (Workflow 2A, Stage 2, in parallel with api-lifecycle, api-platform, api-integrations and api-operators). Date: 2026-10-20.

Owned paths:
- `apps/api/src/routes/server/{inquiries,inquiry-sessions,inquiry-template-versions,inquiry-templates,verifications}.ts`;
- `apps/api/src/services/{inquiries,inquiry-sessions,inquiry-templates,one-time-links,simulate,flow,verifications}.ts`;
- `apps/api/src/jobs/{process-verification,inquiry-outcome,inquiry-expiry,records}.ts`;
- `apps/api/src/routes/flow/**`, `apps/api/src/auth/flow-session.ts`, `apps/api/src/worker.ts` (shared: other agents add marked blocks);
- their tests, plus `services/inquiries.test-support.ts` (a test helper, see below).

## Plan task

From `docs/plans/phase-2.plan.md`, Stage 2 "api-inquiries": contracts C10 and C11, and the worker's use of check config. Carried over from Workflow 1B: F005 (sessions not revoked when an inquiry finishes) and F015 (worker shutdown ignores a rejected `close()`).

No new dependency, no new environment variable.

## What was built

- **Inquiries (C10, C13, C15)** in `services/inquiries.ts` and `routes/server/inquiries.ts`:
  - `POST /inquiries` resolves the account with `AccountsService.resolveForInquiry` inside the creation transaction, sets `expires-at` from the pinned version's `inquiry-expiration-seconds`, refuses archived templates (422 `template-archived`), and is audited;
  - every inquiry response carries `tags`, `note`, `expires-at`, `redacted-at`, `decisioned-at` and the `account` relationship, masked for users without `pii:view`;
  - `GET /inquiries` gains the `account-id`, `inquiry-template-id`, `tag` and `created-at` filters, and comma lists for `status`; the next link keeps every filter;
  - `PATCH /inquiries/:id`: `fields` merged only while `created`/`pending` (409 `invalid-transition` otherwise), `reference-id`, an encrypted `note`; 410 `redacted` for fields or a note of a redacted inquiry; audited with attribute names only;
  - `approve`, `decline`, `mark-for-review` and `expire` share `transitionInquiryInTx`: the core state machine, the conditional status update, the status's event and `inquiry.transitioned` with `meta: { from, to }`, all in one transaction. When the inquiry leaves `created`/`pending`, its active sessions are canceled (`inquiry-session.canceled`), unused one-time links are revoked, and on expiry the `initiated` verifications are canceled (`verification.canceled`). Refused transitions answer 409 `invalid-transition`. Each action is audited with the principal as actor and `{ from, to }`;
  - `add-tag`, `remove-tag` and `set-tags` follow the core tag rules under the row lock and emit `inquiry.updated-tags` only on a change;
  - `generate-one-time-link` (`services/one-time-links.ts`) stores the token hash only, revokes older unused links, and caps the lifetime at the inquiry's `expires-at`;
  - `perform-simulate-actions` (`services/simulate.ts`) answers 403 `sandbox-only` in production and runs the actions in one transaction through the real transitions; one invalid action applies none;
  - `redact` (scope `inquiries:redact`) delegates to `deps.redaction.redactInquiry(ctx, id, actor)`.
- **Inquiry sessions (C10)** in `services/inquiry-sessions.ts` and `routes/server/inquiry-sessions.ts`: list (`inquiry-id`, `status`), get, expire (409 when not active) and expire-all (`{ meta: { expired-count } }`), each expiry with `inquiry-session.expired` and an audit entry. A session past its TTL reads as `expired` before the sweep marks it. `ip-address` and `user-agent` are masked without `pii:view`.
- **Flow API (C10, C19)**:
  - `auth/flow-session.ts`: expired sessions answer 401 `code: session_expired`, canceled ones `session_canceled`. The first call of an active session records `started_at`, the client address and the user agent (sealed) and emits `inquiry-session.started` once;
  - `POST /flow/one-time-links/redeem`: no auth, one generic 401 for every refusal, single use in the transaction that opens the session (lifetime: the version's `session-expiration-seconds`). The per-IP `one-time-link-redeem` limit is enforced by api-platform's rate-limit plugin through `deps.rateLimiter`, before the route runs;
  - `GET /flow/session` sends `environment: { kind }`.
- **Templates (C11)** in `services/inquiry-templates.ts` and the two route files: `PATCH /inquiry-templates/:id` (name, status), template `status` and resolved `settings`, v1 settings on creation; template versions (create draft `max + 1`, patch drafts with merged validation (422), publish with `inquiry-templates:publish` superseding the previous version, list and get). Every change is audited.
- **Verifications (C10)**: `moveVerification` in `services/verifications.ts` applies `transitionVerification()` and a conditional update. The flow's submit, the worker's decision, `failVerificationAfterError` and the expiry cancellation all write through it.
- **Worker**:
  - `jobs/process-verification.ts` applies the pinned version's check config (C11) to vision's raw scores (`min-blur-score`, `max-glare-ratio`, `min-brightness`, `max-brightness`, the face match `threshold`) and records the configured thresholds in the check metadata; without config nothing changes. Deciding the inquiry goes through `transitionInquiryInTx` (F005);
  - `jobs/inquiry-expiry.ts`: batches `FOR UPDATE SKIP LOCKED`, one savepoint per inquiry (a failing row is logged with its ids and skipped), then sessions past their TTL;
  - `worker.ts`: a list of repeatable jobs, each with its own queue, BullMQ job scheduler (`upsertJobScheduler`) and a one-job-at-a-time worker. `inquiry-expiry` runs every 60 s, and there is an empty `// api-lifecycle: begin` … `end` block for the retention job. Shutdown closes every worker and queue with `allSettled` and logs each failure (F015); the process entry point exits even when `close()` rejects.
- **Test helper** `services/inquiries.test-support.ts`: `createDbAccountsService()` (the C13 order on real account rows through `resolveInquiryAccount`, recording calls) and `createInquiryTestApi()`. The harness's default `AccountsService` fake writes no account rows, and the inquiries table refuses an account id that does not exist, so every test that creates an inquiry through the API needs it.

## Cycle 1: server API and flow API (C10, C11, C19)

### RED (commit `70b15d8`)

New test files `routes/server/{inquiry-actions,inquiry-updates}.test.ts` and `routes/flow/one-time-links.test.ts`; rewritten stub tests `routes/server/{inquiry-sessions,inquiry-template-versions}.test.ts`; Phase 2 cases appended to `routes/server/{inquiries,inquiry-templates}.test.ts` and `routes/flow/{auth,session}.test.ts`.

```
$ pnpm --filter @openverify/api exec vitest run --coverage.enabled=false src/routes/server/inquiries.test.ts \
    src/routes/server/inquiry-actions.test.ts src/routes/server/inquiry-updates.test.ts \
    src/routes/server/inquiry-sessions.test.ts src/routes/server/inquiry-templates.test.ts \
    src/routes/server/inquiry-template-versions.test.ts src/routes/server/verifications.test.ts src/routes/flow/
 Test Files  9 failed | 2 passed (11)
      Tests  157 failed | 131 passed (288)
  failures per file: flow/auth 7, flow/one-time-links 14, flow/session 2, server/inquiries 14,
  server/inquiry-actions 53, server/inquiry-sessions 13, server/inquiry-template-versions 14,
  server/inquiry-templates 10, server/inquiry-updates 30
 FAIL  .../inquiry-actions.test.ts > POST /api/v1/inquiries/:id/approve > moves a completed inquiry to approved
Error: expected HTTP 200, got 404: {..."detail":"No route matches POST /api/v1/inquiries/inq_.../approve."...}
 FAIL  .../inquiry-sessions.test.ts > GET /api/v1/inquiry-sessions > lists the sessions of an inquiry, newest first, ...
Error: expected HTTP 200, got 404: {..."detail":"No route matches GET /api/v1/inquiry-sessions."...}
 FAIL  .../inquiries.test.ts > POST /api/v1/inquiries (C10, C13) > resolves the account in the creation transaction ...
AssertionError: expected [] to deeply equal [ { ctx: ObjectContaining{…}, …(1) } ]
 FAIL  .../inquiries.test.ts > POST /api/v1/inquiries (C10, C13) > answers 422 template-archived for an archived template
AssertionError: expected 201 to be 422 // Object.is equality
 FAIL  .../flow/session.test.ts > GET /api/v1/flow/session environment (C19) > tells the flow it runs in sandbox
AssertionError: expected undefined to deeply equal { kind: 'sandbox' }
 FAIL  .../flow/auth.test.ts > inactive sessions (C10) > answers session_expired once the TTL has passed
AssertionError: expected undefined to be 'session_expired' // Object.is equality
```

All 131 passing tests were the Phase 1 cases in those files.

### GREEN (commit `29dfb8c`)

Three things surfaced while going green:
- Fastify validates a request without a body as `null` (`fastify/lib/validation.js:350`), which the contract's optional action bodies refuse ("expected object, received null"). The routes wrap them with `optionalBody()` (`.nullable()`); see the follow-ups.
- api-platform's rate-limit plugin had landed and already enforces `one-time-link-redeem` on the redeem route through `deps.rateLimiter`. The route-level limiter written first would have counted twice, so it was removed and the limiter tests filter on the policy.
- Two RED tests were corrected before GREEN: the created-at range test pinned `created_at` (the database clock, not the test clock), and the action tests count events and audit entries made after the action (creation now emits and audits too).

```
$ (same command)
 Test Files  1 failed | 10 passed (11)
      Tests  1 failed | 287 passed (288)
 FAIL  src/routes/flow/auth.test.ts > OpenAPI > documents the flow routes under the session token scheme
TypeError: Cannot read properties of undefined (reading 'securitySchemes')
```

That last failure was `/openapi.json` answering 500 from api-platform's rate-limit `onSend` hook (`request.rateLimit` undefined on routes registered before the plugin). My own OpenAPI test reads `app.swagger()` instead. The Phase 1 test passed again once api-platform fixed the hook; see the final run below.

## Cycle 2: worker, expiry job and shutdown (C10, C11, F005, F015)

### RED (commit `01a752a`)

New `jobs/inquiry-expiry.test.ts` and `services/verifications.test.ts`; new cases in `jobs/process-verification.test.ts` (C10 lifecycle, C11 thresholds), `worker.test.ts` (repeatable jobs, F015) and `jobs/records.test.ts` (Phase 2 record fields, session status). Phase 1 expectations of the outcome events gained `inquiry.transitioned` (compared without order, because events of one transaction share their creation time). `records.test.ts` now builds a schema v2 `Inquiry` (the db-v2 follow-up).

```
$ pnpm --filter @openverify/api exec vitest run --coverage.enabled=false src/jobs/process-verification.test.ts \
    src/jobs/records.test.ts src/jobs/inquiry-expiry.test.ts src/worker.test.ts src/services/verifications.test.ts
 Test Files  3 failed | 2 passed (5)
      Tests  20 failed | 73 passed (93)
 FAIL  src/jobs/inquiry-expiry.test.ts [ src/jobs/inquiry-expiry.test.ts ]   (module missing)
 FAIL  .../worker.test.ts > startWorkers: repeatable jobs (C10 inquiry-expiry) > schedules inquiry-expiry every 60 seconds ...
AssertionError: expected [] to deeply equal [ [ 'inquiry-expiry', [ { …(3) } ] ] ]
 FAIL  .../process-verification.test.ts > processVerification: C11 check configuration > fails the ID blur check below a configured min-blur-score, recording it
AssertionError: expected { outcome: 'processed', …(2) } to match object { verificationStatus: 'failed' }
 FAIL  .../process-verification.test.ts > processVerification: selfie > compares the selfie with a fresh analysis ...
AssertionError: expected [ 'inquiry.completed' ] to deeply equal [ 'inquiry.completed', …(1) ]
```

The `records.test.ts` and `services/verifications.test.ts` cases passed from the start: they cover code that cycle 1's route tests had already driven. They are listed here as coverage, not as RED.

### GREEN (commit `177ba7a`)

```
$ pnpm --filter @openverify/api exec vitest run --coverage.enabled=false src/jobs/ src/worker.test.ts src/services/verifications.test.ts
 Test Files  12 passed (12)
      Tests  160 passed (160)
```

## Integration (Testcontainers, `pgvector/pgvector:pg17`, `valkey/valkey:9.1`; commit `b8e1110`)

Written after the unit-level GREEN, to prove the database behaviour; they passed on the first run.
- `jobs/inquiry-expiry.integration.test.ts`: 30 overdue inquiries and 12 overdue sessions, four concurrent runs with batches of 4. Every row is expired once, and `inquiry.expired`, `inquiry.transitioned` and `inquiry-session.expired` are written exactly 30, 30 and 12 times.
- `routes/flow/one-time-links.integration.test.ts`: ten links, four concurrent redeems each on a 12-connection pool. Each round answers `[200, 401, 401, 401]` and opens one session.
- `worker.integration.test.ts` (Phase 1, mine): now expects `inquiry.transitioned` among the outcome events and four deliveries instead of three.

```
$ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts \
    src/jobs/inquiry-expiry.integration.test.ts src/routes/flow/one-time-links.integration.test.ts
 Test Files  2 passed (2)
      Tests  2 passed (2)
$ pnpm --filter @openverify/api exec vitest run --config vitest.integration.config.ts src/worker.integration.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## Refactor (commits `f1c8757`, `8ac7a05`)

- One `found()` guard for the inquiry's not-found paths.
- The repository's tag-limit mapping was removed: core caps an object at 50 tags first, so the repository's limit is never reached.
- `TemplateActing` became `Pick<Acting, 'ctx' | 'actor'>`, and the import order in `simulate.ts` was fixed.
- New tests:
  - an accounts service naming a missing account answers 404;
  - an action whose events cannot be written changes nothing;
  - a one-time link for an inquiry already past its expiry answers 409;
  - a legacy revoked session without a cancellation time gets no read grace;
  - `GET /inquiry-sessions/:id` requires `inquiry-sessions:read`;
  - the version list is scoped to the caller's environment.

```
$ pnpm --filter @openverify/api exec vitest run --coverage.enabled=false <every test file of this slice>
 Test Files  23 passed (23)
      Tests  456 passed (456)
```

## Final run (whole api unit suite, without the OpenAPI snapshot test)

```
$ pnpm --filter @openverify/api exec vitest run --coverage --coverage.reportOnFailure=true --exclude src/openapi.test.ts
Test Files  1 failed | 96 passed (97)
     Tests  2 failed | 1910 passed (1912)
 FAIL  src/test-support/harness.test.ts > user principals on the server API (C12) > authenticate a user session with the chosen permissions in its environment
 FAIL  src/test-support/harness.test.ts > user principals on the server API (C12) > never see another environment's resources (404)
All files          |    97.4 |    90.11 |    98.2 |   97.47 |
 src/auth          |   98.66 |    96.61 |     100 |   98.63 |   (flow-session.ts 97.5 / 93.1)
 src/jobs          |   96.22 |    90.19 |     100 |   96.08 |   (inquiry-expiry.ts 100 / 85.71)
 src/routes/server |     100 |       90 |     100 |     100 |
 src/services      |   95.91 |     87.5 |   97.42 |   96.02 |   (inquiries.ts 97.41 / 89.33)
  worker.ts        |   87.64 |    76.66 |   79.31 |   89.15 |   (main()'s close, not unit-tested)
```

The two `test-support/harness.test.ts` failures are cases that create an inquiry through the API with the harness's default `AccountsService` fake, which writes no account rows ("Account acc_… was not found."). `test-support/**` is not mine; see the follow-ups.

Checks on my files: `tsc --noEmit` reports no error in them, `eslint` exits 0 and `prettier --check` is clean.
