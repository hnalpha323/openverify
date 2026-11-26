# TDD evidence: Phase 0, db-api

Slice owner: db-api agent. Date: 2026-10-20. Owned paths: `packages/db`, `apps/api`.

## Plan task

PLAN §6 Phase 0, step 4 (TypeScript backend half), implementing the conventions in §3 ("Data protection by design", "Scoped, hashed API keys") and §5:
- `encrypted` column helper for PII;
- Drizzle data access;
- typed `AppError` mapped to RFC 9457 problem+json;
- pino with central PII redaction;
- Vitest with Testcontainers.

The slice covers:

1. **`packages/db`** (Drizzle ORM, drizzle-kit, node-postgres):
   - a. `src/crypto.ts` provides envelope encryption: AES-256-GCM with a per-value random DEK and 12-byte IVs, wrapped by a KEK from `OPENVERIFY_KEK`, with rotation through `OPENVERIFY_KEK_PREVIOUS`. It also provides the `encrypted()` Drizzle text column.
   - b. Schema v0: `organizations`, `environments` (`sandbox | production`, one of each per organization) and `api_keys` (hashed secret, scopes, CIDR allowlist, lifecycle timestamps). The drizzle-kit migration is generated and committed.
   - c. A Testcontainers integration test on `pgvector/pgvector:pg17`.
2. **`apps/api`** (Fastify 5): a `buildApp(opts)` factory providing:
   - `GET /health`;
   - `x-request-id`;
   - pino redaction;
   - a problem+json error handler;
   - the zod type provider;
   - OpenAPI 3.1 at `GET /openapi.json`;
   - a Bearer API key auth plugin with an injected lookup and route-level scopes.

Dependencies added. Versions were checked with `npm view <pkg> version` on 2026-10-20, and pnpm wrote exact pins. Licenses come from `pnpm licenses list`.

| Package | Version | License | Where |
|---|---|---|---|
| drizzle-orm | 0.45.4 (npm `latest`; 1.0 is still `rc`) | Apache-2.0 | db |
| pg | 8.23.1 | MIT | db |
| drizzle-kit | 0.31.11 | MIT | db (dev) |
| @types/pg | 8.23.1 | MIT | db (dev) |
| @testcontainers/postgresql | 12.2.1 | MIT | db (dev) |
| fastify | 5.12.7 | MIT | api |
| fastify-type-provider-zod | 7.0.0 | MIT | api |
| zod | 4.6.7 | MIT | api |
| @fastify/swagger | 9.9.2 | MIT | api |
| fastify-plugin | 6.0.1 | MIT | api |

The transitive trees of both packages contain only these licenses: MIT, Apache-2.0, ISC, BSD-2/3-Clause, BlueOak-1.0.0, MIT-0, CC0-1.0 and Unlicense. The one exception is `lightningcss` (MPL-2.0). It was already in the workspace, pulled in through `vitest` → `vite` and through tailwind; it is dev-only and was not added by this slice.

## Tests (written first)

`packages/db`:
- `src/crypto.test.ts` (49 tests) covers:
  - round trips: ASCII, empty, multi-byte UTF-8, 10k chars;
  - the `ov1.<kid>.<wrapped>.<payload>` format;
  - a fresh 12-byte IV and 32-byte wrapped DEK per value;
  - 50 encryptions of one plaintext all differ;
  - tamper detection: a flipped ciphertext byte, wrapped-DEK byte or tag byte, and **every single-character change of the envelope**;
  - the wrong KEK, and a forged key id that points at another KEK;
  - context (AAD) binding;
  - malformed and non-canonical base64url envelopes;
  - errors that never echo key material;
  - keyring parsing from env: missing, blank, not base64, base64url, missing padding, wrong length, previous-key position;
  - KEK rotation: decrypt with a key from `OPENVERIFY_KEK_PREVIOUS`; new values use the new KEK; `needsRewrap`; `rewrap` keeps the payload byte-identical; values fail once the old KEK is removed;
  - the `encrypted()` column: `text` type, encrypt on write and decrypt on read, column context, and a lazy process keyring.
- `src/schema.test.ts` asserts every column (SQL type, nullability, defaults), the foreign keys with `ON DELETE cascade`, the unique `(organization_id, kind)` index, the unique `secret_hash` index, the `secret_hash` hex CHECK constraint, and that no plaintext secret or token column exists.
- `src/api-keys.test.ts` covers:
  - the prefixes `ov_sbx_` and `ov_prod_`;
  - 256-bit random tokens;
  - the HMAC-SHA256 hash is deterministic, depends on the pepper, and peppers shorter than 32 bytes are rejected.
- `src/migrate.test.ts` checks the migration folder location, that the journal and SQL files are consistent, and that the first migration creates the v0 tables.
- `src/client.test.ts` checks that `createDatabase(pool)` exposes the schema.
- `src/db.integration.test.ts` (10 tests, `test:integration`) runs against `pgvector/pgvector:pg17`. It covers:
  - migrations apply and are idempotent;
  - org/environment/key insert and read back through a join;
  - defaults;
  - the unique, CHECK and cidr constraints;
  - cascade delete;
  - `create extension vector` plus a distance query;
  - an encrypted column stored as `ov1.` ciphertext and decrypted on read.

`apps/api`:
- `src/app.test.ts` covers:
  - `/health`: package version, injected version, public;
  - `x-request-id`: generated UUID, echo, rejection of malformed or oversized ids, present on errors, `requestId` on log lines;
  - redaction of `authorization`, `cookie`, `proxy-authorization` and `pii` at one to four levels;
  - `/openapi.json`: 3.1 document, zod-derived schema, bearer security scheme, self-hidden, public, and plugin routes documented.
- `src/problem-details.test.ts` covers:
  - 404, 400 validation with per-field errors, malformed JSON and 415, all as problem+json;
  - the query string is never echoed;
  - `AppError` mapping;
  - third-party 4xx messages are hidden;
  - production hides the message and stack, development shows them;
  - unknown `NODE_ENV` defaults to production;
  - 5xx errors are logged at error level;
  - `WWW-Authenticate` on 401 and 403 errors.
- `src/plugins/api-key-auth.test.ts` (19 tests) covers:
  - a **missing** key;
  - another scheme, an empty token, a token with spaces, an oversized token (the lookup is never called);
  - a **bad key**;
  - **expired**, including the exact expiry instant, and a future expiry;
  - **revoked**;
  - **insufficient scope** (403 with `insufficient_scope`);
  - **OK**, with `request.apiKey` exposed;
  - a case-insensitive scheme;
  - secure by default, with no scopes required;
  - public routes;
  - 404 before 401;
  - a lookup failure gives an opaque 500;
  - the request id on 401;
  - the real clock.

All tests use `app.inject`. No database is needed.

## RED

### db: envelope encryption

`crypto.ts` was a stub whose exports throw `not implemented`.

Command (in `packages/db`):

```
pnpm exec vitest run src/crypto.test.ts --coverage.enabled=false
```

Output excerpt:

```
 ❯ src/crypto.test.ts (49 tests | 16 failed | 33 skipped) 30ms
   ❯ createKeyring (7)
     × derives a stable, non-secret 11-character id per KEK 3ms
 FAIL  src/crypto.test.ts > keyringFromEnv > throws when OPENVERIFY_KEK is missing
AssertionError: expected [Function] to throw error matching /OPENVERIFY_KEK is not set/ but got 'not implemented'
 Test Files  1 failed (1)
      Tests  16 failed | 33 skipped (49)
```

The 33 "skipped" tests belong to three suites whose `beforeAll(createKeyring)` threw `not implemented`. Vitest reports each of those suites as `FAIL ... Error: not implemented`.

The first attempt built the keyrings in `describe` bodies, so the whole file failed at collection. The setup was moved into `beforeAll` before the RED commit, so that failures are reported per test.

Commit: `34cd7c0 test(db): add failing envelope-encryption tests`.

### db: schema, API key hashing, migrations, client

Command:

```
pnpm exec vitest run src/schema.test.ts src/api-keys.test.ts src/migrate.test.ts src/client.test.ts --coverage.enabled=false
```

Output excerpt:

```
 FAIL  src/api-keys.test.ts [ src/api-keys.test.ts ]
Error: Cannot find module './api-keys.js' imported from .../packages/db/src/api-keys.test.ts
 FAIL  src/client.test.ts [ src/client.test.ts ]
Error: Cannot find module './client.js' imported from .../packages/db/src/client.test.ts
 FAIL  src/migrate.test.ts [ src/migrate.test.ts ]
Error: Cannot find module './migrate.js' imported from .../packages/db/src/migrate.test.ts
 FAIL  src/schema.test.ts [ src/schema.test.ts ]
Error: Cannot find module './schema.js' imported from .../packages/db/src/schema.test.ts
 Test Files  4 failed (4)
```

Commit: `9431218 test(db): add failing schema v0, API key hashing and migration tests`.

### db: integration test (no genuine RED)

The integration test was written after schema v0 existed, because it checks task 1b against a real Postgres. Its first run passed: `Tests 10 passed (10)`.

To show the suite can fail, a negative control was run. The CHECK constraint and the uniqueness of `environments_organization_id_kind_key` were removed from `drizzle/0000_schema_v0.sql`, which was backed up and restored with `cp`. The suite was then run again:

```
pnpm test:integration
     × allows one sandbox and one production environment per organization 18ms
     × rejects a secret_hash that is not a SHA-256 hex digest 11ms
AssertionError: expected undefined to be '23505' // Object.is equality
AssertionError: expected undefined to be '23514' // Object.is equality
      Tests  2 failed | 8 passed (10)
```

The migration was restored, and `git diff` on it was empty. Commit: `d8d6d31 test(db): add Testcontainers integration test for schema v0 and pgvector`. That commit message also states that the test passed on its first run.

### api

`app.ts` was a stub returning a bare `Fastify().withTypeProvider<ZodTypeProvider>()`. `errors.ts` and the auth plugin were stubs.

The first RED run had **5 passing tests**. Four of them passed vacuously against the stub:
- "accepts a key that expires in the future";
- "accepts the bearer scheme in any letter case";
- "answers unknown routes with 404 rather than 401";
- the whole-request logging test.

They were tightened before the RED commit:
- the two "accepts" tests now assert that the lookup was called with the token;
- the 404 test now asserts a problem+json body;
- the logging test now asserts that the log line exists.

The second run (in `apps/api`):

```
pnpm exec vitest run --coverage.enabled=false --reporter=verbose
 ✓ src/index.test.ts > @openverify/api entry point > identifies the package 2ms
      9 AssertionError: expected 200 to be 401 // Object.is equality
      5 AssertionError: expected 404 to be 200 // Object.is equality
      1 FastifyError: Failed building the validation schema for POST: /echo, due to error schema is invalid: data/required must be array
      1 AssertionError: expected Error: not implemented { …(4) } to match object { status: 401, title: 'Unauthorized' }
 Test Files  3 failed | 1 passed (4)
      Tests  48 failed | 1 passed (49)
```

The only passing test was the pre-existing skeleton test. The `FastifyError` appeared because the stub had not installed the zod validator compiler yet.

Commit: `1b6e882 test(api): add failing tests for buildApp, problem+json errors and API key auth`.

## GREEN

### db

`pnpm --filter @openverify/db test` (exit 0):

```
 Test Files  6 passed (6)
      Tests  70 passed (70)
All files    |   98.58 |       98 |   94.73 |   98.55 |
 crypto.ts   |     100 |    97.91 |     100 |     100 | 276
 migrate.ts  |      50 |      100 |       0 |      50 | 10
 schema.ts   |    90.9 |      100 |   83.33 |      90 | 32
```

The uncovered lines are:
- `runMigrations`, which needs a database and is exercised by the integration test;
- the `$onUpdate` callback of `organizations.updated_at`.

`pnpm --filter @openverify/db test:integration` (exit 0, about 5.4 s including container start):

```
 ✓ src/db.integration.test.ts > migrations against Postgres 17 + pgvector > apply cleanly and are idempotent 7ms
 ✓ ... > store and read back an organization, environment and API key 23ms
 ✓ ... > defaults scopes to an empty array and allowed_ips to NULL 13ms
 ✓ ... > allows one sandbox and one production environment per organization 11ms
 ✓ ... > rejects a secret_hash that is not a SHA-256 hex digest 19ms
 ✓ ... > rejects duplicate secret hashes 22ms
 ✓ ... > rejects an allowed_ips entry that is not a network address 17ms
 ✓ ... > cascades deletes from an organization to its environments and keys 25ms
 ✓ ... > can create and use the pgvector extension 36ms
 ✓ ... > stores encrypted columns as ciphertext and decrypts them on read 12ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

After the run, `docker ps` showed no leftover pgvector or ryuk containers.

Migration tooling:
- `drizzle-kit generate --name schema_v0` produced `drizzle/0000_schema_v0.sql`.
- A second `drizzle-kit generate` printed `No schema changes, nothing to migrate`.
- `drizzle-kit check` printed `Everything's fine`.

The generated `drizzle/meta/*.json` is formatted with Prettier, so root `format:check` passes. `db:generate` now runs `prettier --write drizzle` after drizzle-kit, and drizzle-kit reads the formatted files without complaint.

### api

`pnpm --filter @openverify/api test` (exit 0):

```
 Test Files  4 passed (4)
      Tests  50 passed (50)
All files          |   99.16 |    89.36 |     100 |   99.12 |
  errors.ts        |     100 |    88.88 |     100 |     100 | 29
  logger.ts        |     100 |    77.77 |     100 |     100 | 43-44
  ...em-details.ts |   97.22 |    85.29 |     100 |   97.05 | 81
  request-id.ts    |     100 |    83.33 |     100 |     100 | 15
  api-key-auth.ts  |     100 |    96.15 |     100 |     100 | 60
```

The first GREEN run had 2 failures, both caused by wrong assumptions in the tests, not by behaviour bugs. Both tests were corrected:
1. **Logging.** The test expected `req.headers` in a log line. Fastify's default `req` serializer keeps only method, url, host and remote address, and drops headers. That default was kept on purpose, because logging fewer headers is better for privacy. The test now logs a whole request object (headers absent) and an ad-hoc `upstream.headers` object (`authorization` and `cookie` redacted), and asserts that neither secret appears anywhere.
2. **OpenAPI.** zod 4.6 renders `z.literal('ok')` as `{ "type": "string", "enum": ["ok"] }`, not `{ "const": "ok" }`. Both are valid JSON Schema 2020-12, and the expectation was updated.

One test was added after GREEN as a characterization test, so it passed on its first run. It asserts that routes registered through `app.register(plugin)` appear in `/openapi.json` and inherit the global `apiKey` security. This came from a smoke run showing that bare root-level `app.get` calls on the returned instance are protected and get problem+json, but are not seen by @fastify/swagger. `buildApp`'s JSDoc documents the plugin pattern.

Commit: `d789f07 feat(api): add buildApp with problem+json errors, request ids, redacted logs and API key auth`.

### Other gates (all exit 0)

- `pnpm --filter @openverify/db --filter @openverify/api typecheck`;
- `pnpm --filter @openverify/db --filter @openverify/api lint` (typescript-eslint `strictTypeChecked`);
- `pnpm exec prettier --check packages/db apps/api`;
- `pnpm build` in both packages;
- a Node ESM smoke run of both `dist/` builds:
  ```
  200 {"status":"ok","version":"0.0.0"} 2c78a3da-…
  200 3.1.0 [ '/health' ]
  401 application/problem+json; charset=utf-8 {"type":"about:blank","title":"Unauthorized",…}
  ```
  and `MIGRATIONS_FOLDER` resolved from `dist/` to `packages/db/drizzle`;
- `pnpm --filter @openverify/config test`: the workspace-convention contract still passes (`Tests 33 passed (33)`).

## Coverage

| Package | Lines | Branches | Functions | Statements |
|---|---|---|---|---|
| packages/db (unit) | 98.55% | 98% | 94.73% | 98.58% |
| apps/api | 99.12% | 89.36% | 100% | 99.16% |

Both are measured over all of `src/`, against the shared 80% gate.

## Design decisions recorded for later slices

- **Envelope format `ov1.<kid>.<wrapped DEK>.<payload>`** (base64url, no padding):
  - `kid` is the first 8 bytes of HKDF-SHA256 over the KEK, so it is stable and non-secret.
  - The wrapped DEK's associated data is `ov1.<kid>`.
  - The payload's associated data is `ov1:<context>`. It deliberately leaves out the kid, so `rewrap()` can rotate KEKs without decrypting payloads.
  - Decoding is strictly canonical. That is why any single-character change is detected.
  - Key bytes sit in a module-private `WeakMap`, so a logged keyring shows only ids.
- **API key hashing is HMAC-SHA256 with a server pepper, not argon2id** (see the comment on `api_keys.secret_hash`):
  - Tokens carry 256 bits of randomness, so a slow hash adds no brute-force resistance.
  - A deterministic keyed hash allows one indexed lookup per request.
  - argon2id would be a CPU and memory DoS lever.
  - A CHECK constraint rejects anything that is not 64 lowercase hex characters, so a raw token cannot be stored by mistake.
- **Auth is secure by default.** Every route needs a key unless `config.public` is set. `config.scopes` adds scope checks. Missing or unsupported credentials get `WWW-Authenticate: Bearer realm="openverify"` with no error code (RFC 6750 §3.1). An invalid, revoked or expired key gets `error="invalid_token"`. A missing scope gets 403 with `error="insufficient_scope", scope="…"`.
- **Problem documents.**
  - `type` is `about:blank` unless an `AppError` sets one, because no problem-type URL namespace exists yet.
  - `instance` is the path without the query string, which may carry PII.
  - The `requestId` extension member is always present.
- **Request ids.** A client `x-request-id` is reused only when it matches `^[A-Za-z0-9._:-]{1,128}$`; otherwise a UUID is generated.
- **Error exposure.** The mode defaults to `production` unless `NODE_ENV` is `development` or `test`, so a missing `NODE_ENV` fails safe.
