# @openverify/db

The Drizzle schema, migrations and tenant-scoped repositories for Postgres 17 + pgvector. The package also holds the envelope encryption used for PII at rest.

## Entry points

| Import | What |
|---|---|
| `@openverify/db` | Schema (`src/schema.ts`, tables in `src/tables/`), repositories (`src/repositories/`), `createDatabase(pool)`, `runMigrations(db, { upTo? })`, crypto and the row-bound sealing helpers, `ENCRYPTED_COLUMNS`, `hashSessionToken`, `pgErrorCode`, `InvalidCursorError` |
| `@openverify/db/testing` | `createTestDatabase()`, `createTestTenant()`, `createTestInquiry()` and `testId()`, for unit tests without Docker |

## Repositories

Every repository function takes a `Db` first. `Db` is any Drizzle Postgres client or transaction that knows this schema: node-postgres in services, PGlite in unit tests. You can therefore pass a transaction, and a repository that opens its own transaction then nests as a savepoint.

Tenant functions also take `environmentId` (operator data: `organizationId`), and every query filters by it:
- A record in another environment reads as `null`, which API layers return as 404 (C2).
- Child tables reference their parent through `(environment_id, parent_id)` (or `(organization_id, parent_id)`) composite foreign keys, so the database refuses a child that points at another tenant's parent.

Some functions are cross-tenant on purpose:
- **Lookups whose result tells the caller the tenant:** `findApiKeyBySecretHash`, `findActiveInquirySessionByTokenHash`, `findInquirySessionByTokenHash`, `findActiveUserSessionByTokenHash`, `listUsersByEmail` (login), `findInvitedUserByTokenHash`, `acceptInvitation`, `redeemOneTimeLink`, `findActiveMfaChallenge`.
- **Operations on a row the caller already resolved by token:** `recordMfaChallengeFailure`, `consumeMfaChallenge`, `setMfaChallengeWebauthnChallenge` (by challenge id), `setUserSessionEnvironment`, `markUserSessionMfaSatisfied`, `revokeUserSession` (by session id).
- **Maintenance sweeps that span every environment**, returning each row's environment for the tenant-scoped calls that follow: `listDueWebhookDeliveries`, `listOverdueInquiries`, `listOverdueInquirySessions`, `listInquiriesDueForRetention`, the `deleteExpired*` functions, `backfillEventObjectIds`, `rewrapTableBatch` and `rewrapAll`.

Lists follow C1 and C9:
- `page[after]` is the last id of the previous page (for audit logs, the `aud_` public id), and `page[size]` is clamped to 1-100 (default 10).
- Results are ordered by `created_at desc, id desc`.
- The cursor's position is read inside SQL, so microsecond timestamps never lose precision in JavaScript.
- An `after` id from outside the environment raises `InvalidCursorError` (map it to 400).
- Filters take one value or an array (C9 comma values mean OR); an empty array matches nothing. Dates are `createdAtStart` (inclusive) and `createdAtEnd` (exclusive). Tag filters ignore case and use a GIN index on `openverify_lower_tags(tags)`.

Status changes are optimistic or locked:
- `transitionInquiryStatus(db, env, id, { from, to })` validates the transition with the core state machine and throws `InvalidInquiryTransitionError` if it is not allowed. It updates only while the status is still `from`, and otherwise returns `null`.
- `setVerificationStatus` accepts an optional `from` (one status or several) in the same way.
- Read-check-write operations lock the row first (`lockInquiry`, `lockVerification`, `lockAccount`, `lockWebhook`, `lockOrganization`), so a service can check a status and change it in one transaction.

### Phase 2 operations (C9-C16)

| Area | Functions | Atomicity |
|---|---|---|
| Accounts (C13) | `createAccount`, `updateAccount` (fields merged), tags, relations, `listAccounts`, `resolveInquiryAccount`, `moveInquiriesToAccount` | `consolidateAccounts` runs in one transaction with every account locked in id order; it moves inquiries and relations, unions tags, merges fields and archives the sources |
| Inquiries (C10) | `createInquiry` (resolves an account when given none), `updateInquiry`, tags, the C10 list filters | `listOverdueInquiries({ lock: true })` takes rows `FOR UPDATE SKIP LOCKED` |
| Sessions (C10) | `markInquirySessionStarted` (first call wins), `expireInquirySession`, `expireInquirySessions`, `cancelInquirySessions`, `inquirySessionState` | `listOverdueInquirySessions({ lock: true })` |
| One-time links (C10) | `createOneTimeLink` revokes older unused links | `redeemOneTimeLink` is a single conditional UPDATE, so a link works exactly once |
| Templates (C11) | `createDraftInquiryTemplateVersion`, `updateDraftInquiryTemplateVersion`, `listInquiryTemplateVersions`, `updateInquiryTemplate` | `publishInquiryTemplateVersion` locks the template and supersedes the previous version; a partial unique index allows one published version |
| Idempotency (C12) | `claimIdempotencyKey`, `completeIdempotencyKey`, `releaseIdempotencyKey` | Insert-or-get on the unique key; a claim holds a two-minute lease, then a retry may take it over |
| API logs, keys, events (C12) | `createApiLog`, `listApiLogs` (status codes or classes), `listApiKeys`, `updateApiKey`, `expireApiKey`, `listEvents` | |
| Webhooks (C14) | `rotateWebhookSecret`, `getWebhookDispatchConfig` (both secrets while the old one is valid), `listWebhooksForEvent(…, subject)` (filters), `listWebhookDeliveries`, `getWebhookDeliveryWithEvent`, `listReplayableEvents`, replays via `createWebhookDelivery({ isReplay: true })` | |
| Operators (C15) | invitations, `listUsers`, `updateUser`, roles (`syncBuiltinRoles`, custom roles, `setUserRoles`, `listUserPermissions`), `countActiveUsersWithRole` for the last-admin rule, MFA factors, recovery codes, challenges, `listUserAuditLogs`, `getAuditLog` | `recordMfaChallengeFailure` counts atomically and revokes on the fifth; `recordTotpUse` refuses a step that is not after the last one |
| Retention (C16) | `resolveRetentionSettings`, `listInquiriesDueForRetention`, `deleteExpiredApiLogs`, `deleteExpiredWebhookDeliveries`, `deleteExpiredEvents`, `deleteExpiredIdempotencyKeys`, `deleteExpiredAuthChallenges` | Batches of 500 taken `FOR UPDATE SKIP LOCKED`; call a deleter until it returns 0 |
| Redaction (C16) | `redactInquiryRecords`, `redactAccountRecords`, `stubEventPayloads`, `markFilesDeleted` | One transaction each, idempotent; see the table in `src/repositories/redaction.ts` |
| KEK rotation (C16) | `rewrapAll`, `rewrapTableBatch`, `REWRAP_TABLES` | Batches by primary key, resumable from `(table, after)`; conditional writes |

**Built-in roles.** Migration 0003 seeds the four C15 built-in roles in every existing organization, with the permissions C15 lists, and makes every existing operator an admin (Phase 1 operators could do everything). `syncBuiltinRoles(db, organizationId, definitions, newId)` makes them match `@openverify/core`; call it when an organization is created and when the API starts.

**Account type `user`.** Every environment has it: a trigger on `environments` inserts it, and migration 0003 backfilled existing environments. `getDefaultAccountType` finds it.

## Identifiers

Primary keys are the C1/C9 prefixed ULIDs (`inq_01J...`, `acc_01J...`). Callers generate them; each table has a `<table>_id_format` CHECK constraint on its prefix. The exceptions:
- `verification_checks` is keyed by `(verification_id, name)`, and `user_roles` by `(user_id, role_id)`.
- Internal tables use identity keys: `audit_logs` (addressed through its unique `public_id`, `aud_...`), `account_relations`, `one_time_links`, `idempotency_keys`, `mfa_recovery_codes`, `mfa_challenges`, `webauthn_registration_challenges`.
- Ids generated by the database: `openverify_new_id(prefix, at)` (SQL, migration 0003) gives the backfilled rows their ids, the `user` account type of a new environment its id, and an audit entry inserted without one its `public_id`. In code, repositories generate an id (`generateId`, not exported) only for rows a Phase 1 caller cannot know about: the account `createInquiry` creates when given none, and an audit entry's public id.

## Data protection decisions

| Data | Storage | Why |
|---|---|---|
| `inquiries.fields` | `encryptedJson`, context `inquiries.fields` | End-user PII (names, birthdates, addresses) |
| `events.payload` | `encryptedJson`, context `events.payload` | Embeds whole resources, including inquiry fields. C16 replaces it with a stub on redaction |
| `webhooks.secret` | `encrypted`, context `webhooks.secret` | Signing secret. Repositories never return it except to the dispatcher (`getWebhookSigningSecret`, `getWebhookDispatchConfig`); the API shows only `secret_last4` |
| `inquiry_sessions.consent` | jsonb `{accepted_at, text_keys, locale, ip, user_agent}`, with `ip` and `user_agent` envelope-encrypted inside it | IP and user agent are personal data; the rest stays queryable |
| `audit_logs.ip` | `encrypted`, context `audit_logs.ip` | Personal data |
| Schema v2 columns: `accounts.fields`, `inquiries.note`, `inquiry_sessions.ip`/`user_agent`, `audit_logs.user_agent`, `api_logs.ip`/`user_agent`/`query`/`request_body`/`response_body`, `idempotency_keys.response_body`, `webhooks.custom_headers`/`previous_secret`, `mfa_factors.totp_secret` | Row-bound sealing (below), context `<table>.<column>#<row id>` | Personal data, stored responses that embed it, and secrets |
| File bytes | `encryptBytes`: ciphertext in S3, `files.wrapped_dek` in the row; use the file id as the context | Images of IDs and faces. `sha256` and `byte_size` describe the plaintext, so it can be checked after decryption |
| `api_keys.secret_hash` | HMAC-SHA256 with a pepper | See the column comment |
| Tokens (`ovs_`, `ovu_`, `ovo_`, `ovm_`, `ovi_`) and WebAuthn challenges | SHA-256 hex (`hashSessionToken`), enforced by CHECK constraints | C1, C9 |
| `users.password_hash`, `mfa_recovery_codes.code_hash` | Argon2id PHC strings, enforced by CHECK constraints | Hashing happens in the API |
| **`users.email`** | **Plaintext**, trimmed and lowercased (`users_email_lowercase` check), unique per organization | It is operator account data, not the personal data of the people being verified. Login has to find the account with an indexed equality lookup, which randomised ciphertext cannot support. Revisit with a keyed blind index if operator data ever needs encryption at rest |
| `verification_checks.metadata` | Plain jsonb | Scores and flags only. Checks must never put PII or biometric embeddings there; C6 says embeddings are not persisted in Phase 1. C16 empties it on redaction |

Encrypted columns resolve their keyring lazily, when a value is converted:
- By default the keyring comes from `OPENVERIFY_KEK` (and `OPENVERIFY_KEK_PREVIOUS` for rotation).
- `setDefaultKeyring(keyring)` overrides it, for example for a KMS adapter or a test keyring.
- Encrypted values cannot be filtered in SQL.

`ENCRYPTED_COLUMNS` (`src/encrypted-columns.ts`) lists every encrypted column; `schema-v2.test.ts` keeps it complete and the KEK rewrap walks it.

### Row-bound encryption (finding F004)

Phase 1 columns bind their ciphertext to a static context such as `inquiries.fields`. That stops a value from moving to another column, but not to another row of the same column: someone who can write the database could copy one inquiry's `fields` ciphertext onto another inquiry, and it would decrypt there.

Every encrypted column schema v2 adds is bound to its row as well, like `encryptBytes` binds a file object to its file id. The AAD context is `<table>.<column>#<row id>` (`src/sealed.ts`):
- The columns are plain `text` typed `Sealed`; their TypeScript properties end in `Sealed` (`noteSealed`, `ipSealed`).
- Repositories seal on write and open on read with the row id they already hold, and return plaintext under the plain name (`note`, `ip`). A Drizzle column type cannot do this: it sees the value, never the row.
- A ciphertext copied to another row fails authentication (`DecryptionError`).
- The row id is the C1 id, or for identity-keyed tables the id as text (`idempotency_keys`) or the public id (`audit_logs.user_agent`, `aud_...`).

**Migrating the Phase 1 columns** (`inquiries.fields`, `events.payload`, `webhooks.secret`, `audit_logs.ip`, the consent `ip`/`user_agent`). Not done in Phase 2. The path:
1. The AAD cannot be read from a ciphertext, so mark the new binding in the envelope: a version `ov2` means "row-bound", `ov1` stays "static context". `decrypt` picks the context from the version.
2. Move each column from its `encrypted()`/`encryptedJson()` type to a `sealedColumn` with repository mapping, reading both versions and writing `ov2`.
3. Run a batched, resumable job like `rewrapAll`, which decrypts each `ov1` value and re-encrypts it as `ov2` for its row. Unlike the KEK rewrap it handles plaintext, because the AAD is part of the payload seal. It runs with `openverify.kek_rewrap` set, so `updated_at` and the audit log rules behave as they do for a rewrap, and its writes are conditional on the old ciphertext.
4. When `select count(*) … where <column> like 'ov1.%'` is 0 for a column, drop its `ov1` read path.

### Database maintenance setting

`select set_config('openverify.kek_rewrap', 'on', true)` (transaction-local) does two things, both used only by the KEK rewrap:
- `openverify_set_updated_at` leaves `updated_at` unchanged, because rewriting ciphertext must not restart retention clocks (C16 counts from `updated_at`).
- The `audit_logs` append-only trigger accepts an UPDATE that changes `ip` and `user_agent` only.

## Migrations

- `pnpm --filter @openverify/db db:generate` runs drizzle-kit, then Prettier.
- `drizzle-kit check` and the drift test in `schema.test.ts` both fail when the schema and the latest snapshot disagree.
- `runMigrations(db, { upTo: '<tag>' })` stops after a given migration; the upgrade tests use it to seed an older schema.

`drizzle/0001_schema_v1.sql` was generated, then edited by hand where it says "Hand edit":
- `CREATE EXTENSION IF NOT EXISTS vector`.
- Dropping and re-adding the two v0 foreign keys around the uuid-to-text key change.
- Moving one unique constraint ahead of the composite foreign key that needs it.
- Adding the `openverify_set_updated_at` trigger, which bumps `updated_at` unless the update sets it itself.
- Adding the `audit_logs` append-only trigger, which rejects every UPDATE.

A database that already holds v0 rows would fail the new id-format checks. v0 shipped without any code that writes rows.

`drizzle/0003_schema_v2.sql` (Phase 2) was generated, then edited by hand where it says "Hand edit":
- **Functions first:** `openverify_new_id`, `openverify_lower_tags` and `openverify_tags_valid` (the C9 tag backstop: at most 50, 1-64 characters after trimming, unique ignoring case).
- **`inquiries.account_id` and `audit_logs.public_id`** are added nullable, backfilled, then set `NOT NULL`.
- **The backfill** of Phase 1 rows, with the `updated_at` triggers and the audit log trigger disabled so timestamps keep their values:
  - one account type `user` per environment;
  - one account per `(environment, reference id)`, as old as its oldest inquiry, and one per inquiry without a reference id (C13 resolution applied to the past);
  - `expires_at` one day after creation;
  - the latest version of each template `published`, older ones `superseded`;
  - revoked sessions `canceled`, unrevoked sessions past their TTL `expired`;
  - existing user sessions `mfa_satisfied`;
  - audit entries' public ids;
  - built-in roles per organization, every existing user an admin.
- **Triggers:** `updated_at` on the 12 new tables; the rewrap-aware `openverify_set_updated_at` and audit log trigger; and `environments_seed_account_types`.

`migration-v2.test.ts` (PGlite) and `migration-v2.integration.test.ts` (Postgres 17) seed a v1 database with synthetic Phase 1 rows (`src/v1-fixtures.test-support.ts`), run 0003 and check every backfill.

## Testing

Unit tests run on PGlite 0.4.6 (Postgres 17.5 compiled to WASM, with pgvector), in process:

```ts
import { createTestDatabase, createTestTenant, createTestInquiry } from '@openverify/db/testing';

const database = await createTestDatabase(); // migrated and isolated; also installs a test keyring
const { environment } = await createTestTenant(database.db);
const { inquiry } = await createTestInquiry(database.db, environment.id);
// ... call repositories with database.db ...
await database.close();
```

The first database in a test file takes about 2-3 s to start, and later ones about 0.4 s. Give `beforeAll` a generous `hookTimeout`; this package uses 60 s, since many files start PGlite in parallel.

`pnpm --filter @openverify/db test:integration` runs the same migrations and one round trip per repository on `pgvector/pgvector:pg17` (Testcontainers, Docker required). It also checks, across several connections, what PGlite cannot show: the `FOR UPDATE SKIP LOCKED` sweeps (deliveries, overdue inquiries and sessions, retention), concurrent idempotency claims, concurrent one-time link redemptions, concurrent session starts, and MFA failure counting.
