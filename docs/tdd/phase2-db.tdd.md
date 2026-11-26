# TDD evidence: Phase 2, db-v2

- **Slice owner:** db-v2 agent (Workflow 2A, Stage 1, in parallel with contracts-v2).
- **Date:** 2026-10-20.
- **Owned paths:** `packages/db/**`, and this file.

## Plan task

`docs/plans/phase-2.plan.md`, Stage 1 "db-v2", for contracts C9-C16:
1. Every table and column C9-C16 need, in migration `drizzle/0003_schema_v2.sql` (drizzle-kit, plus meta), with indexes for every list filter.
2. Phase 1 rows migrate in place: the backfill is SQL inside the migration, tested on a database seeded with v1 rows.
3. Encrypted columns for PII; carried-over finding F004: new encrypted columns bound to their row id, and the migration path for the existing ones documented.
4. A repository per aggregate, environment- (or organization-) scoped, with C1 cursor lists and the atomic operations the Stage 2 services need.
5. Unit tests on PGlite with at least 80% coverage, and a Testcontainers round trip per new repository, including the v1 to v2 upgrade.

## Dependencies added

None. drizzle-orm 0.45.4, drizzle-kit 0.31.11, PGlite 0.4.6 and `@testcontainers/postgresql` 12.2.1 were already in the package. `pnpm-workspace.yaml` and `pnpm-lock.yaml` are unchanged.

## Design decisions

- **Row-bound encryption (F004).** New encrypted columns are `text` typed `Sealed`, sealed with the AAD `<table>.<column>#<row id>` (`src/sealed.ts`). Repositories seal and open them and return plaintext under the plain name (`note`, `ip`); a Drizzle column type cannot, because it never sees the row. `ENCRYPTED_COLUMNS` lists all 20 encrypted columns. The README records how the Phase 1 static-context columns would move (`ov2` envelope version, a decrypt/re-encrypt job, then dropping `ov1`).
- **Every inquiry has an account (C13).** `inquiries.account_id` is `NOT NULL`. Phase 1 callers pass no account, so `createInquiry` resolves one with the C13 order (`resolveInquiryAccount`: account id, then reference id, created race-free through the unique index, then a new account). `apps/api` Phase 1 code therefore keeps working unchanged.
- **Backfill (in SQL, in 0003):**
  - one account per `(environment, reference id)` and one per inquiry without a reference;
  - `expires_at` = creation + 1 day;
  - the latest version of each template published, older ones superseded;
  - revoked sessions canceled, sessions past their TTL expired;
  - audit public ids, `mfa_satisfied` for existing sessions;
  - the four built-in roles per organization, with every Phase 1 operator an admin (they could do everything before).

  The `updated_at` and audit triggers are disabled during the backfill, so retention clocks keep their values.
- **Ids made in SQL.** `openverify_new_id(prefix, at)` makes C1 ids for the backfill, for the `user` account type that a trigger seeds in every new environment, and as the `audit_logs.public_id` default.
- **Maintenance setting.** `openverify.kek_rewrap` (transaction-local) keeps `updated_at` and lets the append-only audit log accept a rewrite of its two encrypted columns, for the KEK rewrap only.
- **Tags (C9).** Case-insensitive uniqueness, at most 50, and 1-64 characters are enforced in the repositories under a row lock, with a database backstop `openverify_tags_valid`. Tag filters use a GIN index on `openverify_lower_tags(tags)`.
- **Identity keys** for internal tables (`account_relations`, `one_time_links`, `idempotency_keys`, MFA challenges and recovery codes), since C9 gives them no prefix.

## Cycle A: schema v2 and migration 0003

### RED

Tests written first:
- `schema-v2.test.ts`: table and column shapes, C9 prefixes, tenancy keys, indexes, and the sealing helpers.
- `constraints-v2.test.ts`: database rules on PGlite.
- `migration-v2.test.ts` with the shared `v1-fixtures.test-support.ts`: the v1 to v2 upgrade with seeded Phase 1 rows.

They also update `migrate.test.ts`, `testing.test.ts`, `schema.test.ts` and `db.integration.test.ts` (listed under "Phase 1 test changes").

```
$ pnpm exec vitest run src/schema-v2.test.ts src/constraints-v2.test.ts src/migration-v2.test.ts \
    src/migrate.test.ts src/testing.test.ts src/schema.test.ts --coverage.enabled=false
 FAIL  src/schema-v2.test.ts
Error: Cannot find module './encrypted-columns.js' imported from .../schema-v2.test.ts
 FAIL  src/constraints-v2.test.ts > account types > seeds the type "user" in every new environment
TypeError: Cannot read properties of undefined (reading 'Symbol(drizzle:Columns)')
     × applies on top of 0000-0002
     × backfills accounts, statuses, ids, roles and defaults
     × openverify_new_id makes C1 ids that sort by the given time
 Test Files  6 failed (6)
      Tests  36 failed | 132 passed (168)
```

Commit `e6cbc55 test(db): specify schema v2 tables, constraints and the v1 to v2 upgrade`.

### GREEN

The tables were written, `drizzle-kit generate --name schema_v2` was run, and the hand edits listed in the README were made. The repositories needed for the schema were adapted: the sealed note on `Inquiry`, account resolution in `createInquiry`, published versions as `currentVersion`, audit public ids, and login candidates restricted to active users with a password.

```
$ pnpm exec vitest run <the six files above> --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  237 passed (237)
$ pnpm --filter @openverify/db test
 Test Files  26 passed (26)
      Tests  453 passed (453)
$ pnpm --filter @openverify/db test:integration
 Test Files  3 passed (3)
      Tests  26 passed (26)          # includes migration-v2.integration.test.ts on pg17
```

Commit `aefc29e feat(db): add schema v2 with migration 0003 and backfill Phase 1 rows`.

## Cycle B: repositories

### RED

16 test files were written first:
- `accounts`, `inquiries-v2`, `inquiry-sessions-v2`, `one-time-links`, `template-versions`;
- `idempotency-keys`, `api-logs`, `api-keys-v2`, `events-v2`, `webhooks-v2`;
- `operators`, `mfa`, `retention`, `redaction`, `key-rotation`, `verifications-v2`.

They come with `repositories-v2.integration.test.ts`.

```
$ pnpm exec vitest run <the 16 files> --coverage.enabled=false
TypeError: createAccount is not a function            (x17)
TypeError: claimIdempotencyKey is not a function      (x7)
TypeError: updateInquiry is not a function            (x5)
TypeError: syncBuiltinRoles is not a function         (x4)
TypeError: createOneTimeLink is not a function        (x4)
TypeError: createDraftInquiryTemplateVersion is not a function (x4)
...
 Test Files  16 failed (16)
      Tests  92 failed | 2 passed (94)
```

The first commit attempt was blocked by the gitleaks hook: the synthetic literal `wbhsec_synthetic_third_1234` matched `generic-api-key`. The literal was renamed to `wbhsec_synthetic_third_mnop`; `.gitleaksignore` was not touched. Commit `2f207fc test(db): specify the schema v2 repositories ...`.

### GREEN

```
$ pnpm --filter @openverify/db test
 Test Files  42 passed (42)
      Tests  547 passed (547)
Statements   : 99.3% ( 1432/1442 )
Branches     : 92.41% ( 780/844 )
$ pnpm --filter @openverify/db test:integration
 Test Files  4 passed (4)
      Tests  36 passed (36)
```

One Phase 1 test failed on the way: `webhooks.test.ts` compares `getWebhookDelivery` with the created row. Instead of changing that test, `getWebhookDelivery` keeps its Phase 1 contract and the C14 lookup with the event name became `getWebhookDeliveryWithEvent`.

Commit `994e9ce feat(db): add the schema v2 repositories for C9-C16`.

## Cycle C: paged user audit logs (gap found in self-review)

### RED

```
$ pnpm exec vitest run src/repositories/audit-logs-v2.test.ts --coverage.enabled=false
TypeError: getAuditLog is not a function
TypeError: listUserAuditLogs is not a function
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

Commit `2b2eb32 test(db): specify paged user audit logs with public ids and filters`.

### GREEN

`paginate` gained a `cursorOf` parameter, so audit logs page by `public_id`.

```
$ pnpm exec vitest run src/repositories/audit-logs-v2.test.ts src/repositories/audit-logs.test.ts
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

Commit `e8ca946 feat(db): page user audit logs by public id with C15 filters`.

### REFACTOR

- Rewrote the README for schema v2: repositories, cross-tenant exceptions, F004 and the migration path, the maintenance setting, and the 0003 hand edits.
- Excluded `*.test-support.ts` from the build.
- Removed a redundant type alias.
- Added tests for `runMigrations({ upTo })` with an unknown tag, and for `getRoles`.

Commit `c91ab59 refactor(db): ...`.

## Final checks (packages/db)

```
$ pnpm --filter @openverify/db typecheck        # tsc --noEmit: no errors
$ pnpm --filter @openverify/db lint             # eslint .: no problems
$ pnpm exec prettier --check packages/db        # All matched files use Prettier code style!
$ pnpm --filter @openverify/db build            # tsc -p tsconfig.build.json: ok
$ pnpm --filter @openverify/db test
 Test Files  43 passed (43)
      Tests  550 passed (550)
Statements   : 99.58% ( 1447/1453 )
Branches     : 93.04% ( 789/848 )
Functions    : 100% ( 460/460 )
Lines        : 99.56% ( 1370/1376 )
$ pnpm --filter @openverify/db test:integration   # pgvector/pgvector:pg17
 Test Files  4 passed (4)
      Tests  37 passed (37)
```

The integration suite covers, across several connections:
- the `FOR UPDATE SKIP LOCKED` sweeps (overdue inquiries and sessions, retention);
- 8 concurrent idempotency claims: 1 claimed and 7 in progress;
- 8 concurrent one-time link redemptions: 1 succeeds;
- 4 concurrent session starts: 1 wins;
- 7 concurrent MFA failures: 5 counted and 1 revoke;
- 6 concurrent inquiries with one reference id: 1 account.

## Phase 1 test changes (minimal, all forced by C9-C16)

| Test | Change | Why |
|---|---|---|
| `migrate.test.ts` | Journal adds `0003_schema_v2`; new assertions for 0003 | New migration |
| `testing.test.ts`, `db.integration.test.ts` | 3 migrations become 4; the table list gains the v2 tables | New migration |
| `schema.test.ts` | `webhook_status` gains `archived` (C14); `users` gains the `invited_by` foreign key (C15); the sensitive-column list gains `users.invitation_token_hash`, `webhooks.previous_secret(_expires_at)` and `api_keys.token_prefix` | C14, C15, C12 |
| `constraints.test.ts`, `repositories/inquiries.test.ts`, `repositories.integration.test.ts` | Direct `inquiries` inserts pass an `accountId` | C13: every inquiry has an account |
| `repositories/inquiry-templates.test.ts` | After publishing version 2, version 1 reads as `superseded` instead of unchanged | C11 |

## API impact found while checking apps/api (not fixed here: other owners)

- **`apps/api` typecheck:** `src/jobs/records.test.ts` builds an `Inquiry` literal without the new required fields (`accountId`, `tags`, `note`, `expiresAt`, `redactedAt`). The owner is api-inquiries. The tests still run, because Vitest does not typecheck.
- **Not caused by db** (contracts-v2 commits `17c5675`, `412e3b2`, `abad2f6`):
  - `services/resources.ts` needs the C14 `archived` webhook status;
  - `filter[status]` is now a string;
  - 5 `apps/api` unit tests fail on the C14/C15/C17 contract changes (8 retry attempts, the user resource's `name`/`status`, the new event names).
