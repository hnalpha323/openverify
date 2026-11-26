# TDD evidence: Phase 2, api-lifecycle

Slice owner: api-lifecycle agent (Workflow 2A, Stage 2). Date: 2026-10-20.

Owned paths:
- `apps/api/src/routes/server/{accounts,account-types}.ts` and their tests;
- `apps/api/src/services/{accounts,redaction,retention}.ts` and their tests, plus `services/redaction.test-support.ts` (the PII subject seeder) and `services/lifecycle.integration.test.ts`;
- `apps/api/src/jobs/retention.ts` and its test;
- `apps/api/scripts/kek-rewrap.ts` (tested by `apps/api/src/kek-rewrap.test.ts`, because Vitest runs `src/**` tests), and the `kek:rewrap` entry in `apps/api/package.json`;
- my marked blocks in `apps/api/src/container.ts` and `apps/api/src/worker.ts`.

## Plan task

From `docs/plans/phase-2.plan.md`, Stage 2 "api-lifecycle": C13 (accounts) and C16 (retention, redaction and KEK rotation).

No new dependency and no new environment variable.

## What was built

- **`services/accounts.ts`:**
  - `createAccountsService({ events, ids })`. Its `resolveForInquiry(tx, ctx, { accountId?, referenceId? })` follows the locked order:
    1. `accountId`, which must be in the environment (404 otherwise);
    2. otherwise find-or-create by `referenceId`, made race-safe by the unique index;
    3. otherwise a new account.

    A consolidated account resolves to the account that absorbed it. A new account gets `account.created`, staged in the caller's transaction.
  - The C13 operations behind the routes: create, get, list (C9 filters), update (merge fields, reference id, archive and restore), tags (core `tags.ts` rules), relations, consolidation, `add-objects` / `remove-objects`, and account types.
  - Every state change stages its events in one transaction, dispatches them after the commit, and records a `deps.audit` entry in that transaction.
  - `ensureDefaultAccountType`: the database trigger seeds `user` with an empty schema. On first use, the service gives it `DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA` (a superset of the C20 fixture), or re-creates it if it is missing.
- **`routes/server/accounts.ts` and `account-types.ts`:**
  - every C13 endpoint, each declaring its permission (`accounts:read`, `accounts:write` or `accounts:redact`) with zod request and response schemas;
  - field values masked for users without `pii:view`;
  - problem+json errors: 404 across environments, 409 `invalid-transition`, 410 `redacted` and 422 for fields.
- **`services/redaction.ts`:**
  - `createRedactionService({ db, storage, events, clock, audit?, logger? })`. Its `redactInquiry` and `redactAccount` are idempotent:
    - storage objects are deleted after the commit, and their rows are marked `deleted-at`;
    - PII columns are nulled, and check metadata and reasons emptied;
    - every stored event payload that embeds the object is stubbed, including copies in other accounts' `account.consolidated` `included`;
    - `inquiry.redacted` and `account.redacted` are emitted, with audit entries for principals.
  - Helpers:
    - `purgeRedactedFiles`, which the retention job runs to delete objects a failed storage delete left behind;
    - `isInquiryRedacted`, `isAccountRedacted`, `fileRedactedAt`, `assertFileNotRedacted` and `assertInquiryNotRedacted`, which answer 410 `redacted` for later reads and PII writes.
- **`services/retention.ts`.** `runRetention`:
  - redacts terminal inquiries past their retention (the template version's `retention-days` overrides the environment's);
  - purges leftover files;
  - deletes API logs, finished deliveries, idempotency keys and events past their windows, keeping events that a `pending` delivery still needs;
  - works in batches of 500, is idempotent, and takes an injected clock.
- **`jobs/retention.ts`.** `startRetentionJob` upserts one BullMQ job scheduler (`retention-daily`, `0 3 * * *` UTC) and runs one worker with concurrency 1. It is registered in `worker.ts` `main()`.
- **`scripts/kek-rewrap.ts`.** `pnpm --filter @openverify/api kek:rewrap [--dry-run] [--batch-size=<n>] [--state-file=<path>] [--restart]`:
  - drives `rewrapAll` in batches;
  - saves the position after each batch (by default under `node_modules/.cache`, which git ignores) and resumes from it;
  - prints counts only.

## Cycle 1: accounts and account types (C13)

RED, test commit `140d8b6`:

```
$ pnpm --filter @openverify/api exec vitest run src/services/accounts.test.ts \
    src/routes/server/accounts.test.ts src/routes/server/account-types.test.ts --coverage.enabled=false
     × gives the seeded type user its default fields schema on first use
     × returns the given account when it is in the environment, and emits nothing
     × creates an active account of the type user and emits account.created
     ...
     12 NotImplementedError: createAccountsService is not implemented yet (owner: api-lifecycle)
      3 TypeError: ensureDefaultAccountType is not a function
      Error: expected HTTP 201, got 404: {..."detail":"No route matches POST /api/v1/accounts."...}
      Tests  88 failed | 1 passed (89)
```

The one pass, "answers 404 for an account type of another environment", passed only because the unregistered route also answered 404.

## Cycle 2: redaction (C16)

RED, test commit `c08db44`:

```
$ pnpm --filter @openverify/api exec vitest run src/services/redaction.test.ts --coverage.enabled=false
     11 NotImplementedError: createRedactionService is not implemented yet (owner: api-lifecycle)
      2 TypeError: fileRedactedAt is not a function
      1 TypeError: purgeRedactedFiles is not a function
      1 TypeError: isInquiryRedacted is not a function
      1 TypeError: assertInquiryNotRedacted is not a function
      1 TypeError: assertFileNotRedacted is not a function
      Tests  21 failed | 1 passed (22)
```

The one pass is the guard test. It checks that `SUBJECT_PII_TABLES` covers every table in `ENCRYPTED_COLUMNS` except operator data, so a new PII table without redaction coverage fails it.

## GREEN for cycles 1 and 2

Feature commit `57019a4`.

The first run left 6 redact tests failing with `400 ... expected object, received null`. Two causes:
- the test helper sent `payload: undefined`;
- Fastify validates a missing body as `null` (`validation.js`: `value === undefined ? null : value`).

Fixes:
- the helper now omits the payload, as a client sends a bare action;
- the redact route's optional body accepts `null` (`redactAccountBodySchema.nullable()`, still representable in JSON Schema).

```
$ pnpm --filter @openverify/api exec vitest run src/services/accounts.test.ts \
    src/routes/server/accounts.test.ts src/routes/server/account-types.test.ts \
    src/services/redaction.test.ts --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  111 passed (111)
```

Coverage of the four source files: 96.8% statements, 86.5% branches, 100% functions, 96.7% lines.

## Cycle 3: retention run and job (C16)

RED, test commit `c57bf37`:

```
$ pnpm --filter @openverify/api exec vitest run src/services/retention.test.ts src/jobs/retention.test.ts --coverage.enabled=false
Error: Cannot find module './retention.js' imported from .../src/jobs/retention.test.ts
Error: Cannot find module './retention.js' imported from .../src/services/retention.test.ts
 Test Files  2 failed (2)
```

GREEN, feature commit `22132a7`:

```
 Test Files  2 passed (2)
      Tests  21 passed (21)
```

## Cycle 4: `kek:rewrap`

RED, test commit `f121fdc`:

```
$ pnpm --filter @openverify/api exec vitest run src/kek-rewrap.test.ts --coverage.enabled=false
Error: Cannot find module '../scripts/kek-rewrap.js' imported from .../src/kek-rewrap.test.ts
 Test Files  1 failed (1)
```

GREEN, feature commit `865b2f9`. The first run failed 1 of 17. The test expected `accounts: scanned 3 rows`, but `createTestInquiry` also creates the inquiry's own account (without fields): 4 rows, 3 values. I corrected the expectation:

```
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

CLI smoke test (no database touched):

```
$ tsx scripts/kek-rewrap.ts --bogus         -> Unknown argument --bogus. usage: kek:rewrap [...]   exit=1
$ tsx scripts/kek-rewrap.ts --dry-run       -> DATABASE_URL: must be a postgres:// URL            exit=1
$ DATABASE_URL=postgres://... (no KEK)      -> OPENVERIFY_KEK is not set; expected a base64-encoded 32-byte key  exit=1
```

## Refactor

Commit `19a6cea`:
- `callerOf` passes the user agent straight into `serviceContextOf`;
- tests cover the retention job's option branches (no key prefix, an injected redaction service, the batch size).

```
 Tests  81 passed (81)   (jobs/retention + account routes)
```

## Wiring

- `container.ts`, `api-lifecycle` block, commit `9740fba`, committed alone with `git apply --cached`, because api-platform had an uncommitted hunk in the file. Contents:
  - `createAccountsService({ events, ids })`;
  - `createRedactionService({ db, storage, events, clock, audit })`, where `audit` is a deferred wrapper, because the operators' block below builds it.
- `worker.ts`, three `api-lifecycle` blocks in `main()`: the import, `startRetentionJob({ connection, db, storage, logger })` and its `close()`. api-inquiries' commit `177ba7a` committed them along with their own changes. Retention stays out of their repeatable-job list in `startWorkers`, which keeps an empty `api-lifecycle` block. Two reasons:
  - the list's schedule type has no time zone or job options;
  - adding a worker there changes their `worker.test.ts` expectations.

## Integration (Testcontainers: `pgvector/pgvector:pg17`, `rustfs/rustfs:1.0.3`, `valkey/valkey:9.1`)

Commit `7151dab`. The first run failed 1 of 4: my audit query had no `ORDER BY`. After ordering by id:

```
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/lifecycle.integration.test.ts
 ✓ consolidates accounts in one transaction and records the audit entries
 ✓ resolves concurrent inquiries with one reference id to one account
 ✓ deletes the stored files and every copy of the PII when an account is redacted
 ✓ redacts an old inquiry and deletes old API logs on schedule, with an injected clock
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  27.62s
```

These tests came after the unit-level GREEN, as verification against the real adapters:
- the container wiring;
- the DB-backed audit logger;
- 8 concurrent transactions resolving one reference id;
- S3 `HeadObject` answering 404 after redaction;
- the BullMQ job scheduler on Valkey.

## OpenAPI

A temporary local check, not committed, rendered `/openapi.json` through `createContainer`. It lists all 14 account paths, 17 operations. The snapshot (`docs/api/openapi.json`) is left to e2e-integration.

## Whole api unit suite (OpenAPI snapshot excluded)

```
$ cd apps/api && pnpm exec vitest run --coverage --coverage.reportOnFailure \
    --coverage.reportsDirectory=<scratch>/coverage-lifecycle --exclude src/openapi.test.ts
 FAIL  src/test-support/harness.test.ts > user principals on the server API (C12) > authenticate a user session ...
 FAIL  src/test-support/harness.test.ts > user principals on the server API (C12) > never see another environment's resources (404)
 Test Files  1 failed | 95 passed (96)
      Tests  2 failed | 1898 passed (1900)
All files          |   96.54 |    89.06 |   97.79 |   96.63 |
```

The two failures are in a file I do not own. Their cause:
- `POST /inquiries` now resolves the account through `deps.accounts` (api-inquiries);
- the harness still defaults to the fake accounts service, which writes no account rows;
- so the inquiry's foreign key fails, and the response is `404 Account ... was not found`.

Per-file coverage of my sources (lines / branches):

| File | Lines | Branches |
|---|---|---|
| `services/accounts.ts` | 96.06 | 86.51 |
| `services/redaction.ts` | 96.26 | 87.32 |
| `services/retention.ts` | 97.72 | 81.25 |
| `jobs/retention.ts` | 100 | 76.92 |
| `routes/server/accounts.ts` | 100 | 100 |
| `routes/server/account-types.ts` | 100 | 100 |

`tsc --noEmit` and `eslint` report nothing on my files, and `prettier --check` passes on them.
