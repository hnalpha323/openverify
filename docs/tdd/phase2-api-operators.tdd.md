# TDD evidence: Phase 2, api-operators

Slice owner: api-operators agent (Workflow 2A, Stage 2). Date: 2026-10-20.

Owned paths:
- `apps/api/src/operator-auth/**` (including `principal-resolver.ts`);
- `apps/api/src/routes/dashboard/**` (except `index.ts`);
- `apps/api/src/routes/server/user-audit-logs.ts`;
- `apps/api/src/services/{users,roles,audit-log,mfa,settings}.ts`;
- `apps/api/src/mail/**`;
- `apps/api/scripts/user-reset-mfa.ts` and its `package.json` script;
- the tests of all of these.

Shared files, edited only inside `// api-operators: begin` … `// api-operators: end` blocks:
- `apps/api/src/config.ts` (the operator settings and `OPENVERIFY_TRUST_PROXY`);
- `apps/api/src/container.ts` (the mailer, operator auth, user-session resolver and dashboard admin options);
- `apps/api/src/app.ts` (the `trustProxy` option type and its Fastify form; see the report's deviations).

## Plan task

Contract C15 from `docs/plans/phase-2.plan.md`:
- the user-session principal resolver;
- RBAC with built-in and custom roles;
- users and invitations;
- MFA (TOTP, WebAuthn, recovery codes) and MFA login;
- the environment switch and settings;
- the audit logger and both audit-log APIs;
- the SMTP mailer;
- the trusted operator client address (findings F003 and F007);
- the `user:reset-mfa` command;
- integration tests on Postgres.

## New dependencies

| Package | Version | License | Why |
|---|---|---|---|
| `@simplewebauthn/server` | 14.0.3 | MIT | WebAuthn registration and assertion verification (C15) |
| `nodemailer` | 10.0.15 | MIT-0 | SMTP for invitation email |

Transitive packages of `@simplewebauthn/server`:
- MIT: `@peculiar/*`, `@hexagon/base64`, `@levischuck/tiny-cbor`, `pvtsutils`, `pvutils`, `tsyringe`;
- Apache-2.0: `reflect-metadata`;
- BSD-3-Clause: `asn1js`;
- 0BSD: `tslib@1.14.1`.

Every license was checked with `npm view <pkg>@<version> license`. Both versions are older than two weeks; `nodemailer` 10.1.x was too new, so 10.0.15 is pinned. pnpm added no `minimumReleaseAgeExclude` entry.

## Cycles

Every command ran in `apps/api` after `source scripts/env.sh`, unless the command says otherwise. Outputs are abbreviated to the summary lines and the first lines of each distinct failure.

### 1. TOTP, client address, mailer, audit logger

**RED.** Commit `aa451f7`.

```
$ pnpm exec vitest run src/operator-auth/totp.test.ts src/operator-auth/client-address.test.ts \
    src/mail/index.test.ts src/mail/invitation.test.ts src/services/audit-log.test.ts --coverage.enabled=false
Error: Cannot find module './invitation.js' imported from …/mail/invitation.test.ts
Error: Cannot find module './client-address.js' imported from …/operator-auth/client-address.test.ts
Error: Cannot find module './totp.js' imported from …/operator-auth/totp.test.ts
NotImplementedError: createMailer is not implemented yet (owner: api-operators)
NotImplementedError: createAuditLogger is not implemented yet (owner: api-operators)
 Test Files  5 failed (5)
      Tests  16 failed | 2 passed (18)
```

**GREEN.** Commit `b9b6093`.

What was added:
- `operator-auth/totp.ts`: RFC 4226 and RFC 6238 on `node:crypto`, ±1 step, replay refusal by step;
- `operator-auth/client-address.ts`;
- `mail/index.ts`: nodemailer SMTP, a 503 error when unconfigured;
- `mail/invitation.ts`;
- `services/audit-log.ts`: `createAuditLogger`, system entries, resource mapping, list and get.

The tests check:
- the RFC 6238 SHA-1, SHA-256 and SHA-512 vectors;
- the RFC 4226 vectors;
- the RFC 4648 base32 vectors.

The SMTP test runs against an in-process fake SMTP server on port 0.

```
 Test Files  5 passed (5)
      Tests  63 passed (63)
Statements   : 100% ( 136/136 )   Branches : 97.56% ( 80/82 )   Functions : 100% ( 35/35 )   Lines : 100% ( 131/131 )
```

### 2. Settings, session context, MFA login, principal resolver, TOTP enrolment, recovery codes, role sync

**RED.** Commit `f2bb96d`.

The existing Phase 1 tests in `operator-auth.test.ts` were narrowed minimally with a `sessionOf()` helper, because `login` now returns a session or an MFA challenge.

```
$ pnpm exec vitest run src/operator-auth/settings.test.ts src/operator-auth/operator-auth.test.ts \
    src/operator-auth/principal-resolver.test.ts src/services/mfa.test.ts src/services/roles.test.ts --coverage.enabled=false
Error: Cannot find module '../services/mfa.js' imported from …/operator-auth/operator-auth.test.ts
Error: Cannot find module './mfa.js' imported from …/services/mfa.test.ts
Error: Cannot find module './roles.js' imported from …/services/roles.test.ts
Error: Cannot find module './settings.js' imported from …/operator-auth/settings.test.ts
AssertionError: promise rejected "NotImplementedError: createUserSessionPri… { …(2) }" instead of resolving
 Test Files  5 failed (5)
      Tests  7 failed (7)
```

A second RED, commit `710fa2f`. Fastify 5.12 ignores a numeric `trustProxy` and fails closed, so a C15 hop count must reach it as a trust function.

```
$ pnpm exec vitest run src/operator-auth/trust-proxy.test.ts --coverage.enabled=false
TypeError: fastifyTrustProxy is not a function
AssertionError: expected '10.0.0.2' to be '203.0.113.9' // Object.is equality
      Tests  2 failed | 2 passed (4)
```

**GREEN.** Commit `3dc84b2`.

What was added:
- `operator-auth/settings.ts`: the operator settings, `trustProxySchema` and `fastifyTrustProxy`;
- `session-context.ts`: one join query plus the user's roles;
- `principal-resolver.ts`;
- `operator-auth.ts`: the 202 MFA challenge and `completeMfa`; the email counter is kept until the second factor passes;
- `services/mfa.ts`: TOTP enrolment, confirmation, replay-safe verification, recovery codes, removal and reset;
- `services/roles.ts`: the sync functions;
- the marked blocks in `config.ts`, `container.ts` and `app.ts`.

```
$ pnpm exec vitest run src/operator-auth src/services/mfa.test.ts src/services/roles.test.ts src/services/audit-log.test.ts src/mail --coverage.enabled=false
 Test Files  13 passed (13)
      Tests  170 passed (170)
(coverage of operator-auth/**, services/mfa.ts, services/roles.ts)
Statements   : 98.94% ( 374/378 )   Branches : 95.65% ( 242/253 )   Functions : 100% ( 84/84 )   Lines : 99.18% ( 365/368 )
```

### 3. WebAuthn with a software authenticator

**RED.** Commit `45b6e6e`.

`operator-auth/testing/software-authenticator.ts` is a P-256 (ES256) key that builds `none` attestations and signs assertions. It encodes CBOR with `@simplewebauthn/server/helpers`.

```
$ pnpm exec vitest run src/operator-auth/webauthn.test.ts src/services/mfa-webauthn.test.ts src/operator-auth/operator-auth.test.ts --coverage.enabled=false
Error: Cannot find module '../operator-auth/webauthn.js' imported from …/services/mfa-webauthn.test.ts
Error: Cannot find module './webauthn.js' imported from …/operator-auth/webauthn.test.ts
TypeError: context.auth.webauthnLoginOptions is not a function
TypeError: context.mfa.webauthnRegistrationOptions is not a function   (3 tests)
 Test Files  3 failed (3)
      Tests  4 failed | 31 passed (35)
```

**GREEN.** Commit `cc5811e`.

The first run had one failure, and it was a bug in my test. `setup(undefined)` took the default relying party, so "503 without a relying party" could not happen. The test now passes `null` for "no relying party".

```
 Test Files  11 passed (11)
      Tests  161 passed (161)
Statements   : 98.31% ( 467/475 )   Branches : 91.66% ( 297/324 )   Functions : 100% ( 99/99 )   Lines : 98.49% ( 457/464 )
```

### 4. Dashboard routes, C15 on the C4 routes, and `GET /user-audit-logs`

**RED.** Commit `5f331c8`.

What the tests cover:
- a dashboard test harness (`routes/dashboard/dashboard.test-support.ts`);
- route tests for:
  - MFA login;
  - enrolment;
  - the environment switch;
  - users and invitations;
  - roles;
  - audit logs;
  - settings;
  - inquiries and files;
  - the admin registration;
- the server-API audit-log tests.

The Phase 1 `index.test.ts` changed minimally:
- operators now hold the admin role;
- the login user carries `name: null` and `status: 'active'`;
- the audit actions are now `user-session.created` and `user-session.revoked`.

```
$ pnpm exec vitest run src/routes/dashboard src/routes/server/user-audit-logs.test.ts --coverage.enabled=false
 Test Files  11 failed | 1 passed (12)
      Tests  76 failed | 36 passed (112)
  21 × expected HTTP 200, got 404        (routes missing)
  17 × expected HTTP 201, got 404
   8 × expected 404 to be 403            (no permission checks)
   5 × expected 404 to be 409
   4 × expected 404 to be 400
   2 × expected 404 to be 503
   2 × expected 404 to be 422
   2 × expected 200 to be 403            (C4 routes without inquiries:read / pii:view checks)
   1 × expected HTTP 200, got 500        (MFA login not served yet)
   1 × expected 429 to be 401            (login limiter keyed on the BFF address)
```

A second RED, commit `6eb0554`. The startup role sync must not take the app down when the database is unreachable; api-platform's container tests build apps against a dead pool.

```
$ pnpm exec vitest run src/routes/dashboard/admin.test.ts --coverage.enabled=false
 × logs a failed startup sync instead of failing the app, …
AssertionError: promise rejected "Error: Failed query: select "id" from "or… { …(2) }" instead of resolving
      Tests  1 failed | 3 passed (4)
```

**GREEN.** Commit `4f06346`.

What was added:
- `authenticate.ts`: `allowWithoutMfa`, `config.scopes` checks and the context helpers;
- `admin.ts` and `admin-context.ts`;
- the route plugins: `sessions.ts`, `invitations.ts`, `environment.ts`, `mfa-factors.ts`, `users.ts`, `roles.ts`, `audit-logs.ts` and `settings.ts`;
- `inquiries.ts`: permission, masking and the C9/C10 filters;
- `files.ts`: `pii:view`, 410 and the audit logger;
- `services/users.ts`, `roles.ts` and `settings.ts`;
- `routes/server/user-audit-logs.ts`;
- the container passes the WebAuthn RP, the dashboard URL and the startup sync.

```
 Test Files  12 passed (12)
      Tests  112 passed (112)
$ pnpm exec vitest run src/routes/dashboard/admin.test.ts --coverage.enabled=false
      Tests  4 passed (4)
$ pnpm exec vitest run src/container.test.ts src/config.test.ts src/app.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  79 passed (79)
```

### 5. `user:reset-mfa`

**RED.** Commit `8f4a64c`.

```
$ pnpm exec vitest run src/operator-auth/reset-mfa-command.test.ts --coverage.enabled=false
Error: Cannot find module './reset-mfa-command.js' imported from …/operator-auth/reset-mfa-command.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN.** Commit `484dd46`.

```
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

### 6. Integration on Postgres 17 (Testcontainers, `pgvector/pgvector:pg17`)

Commit `2c6efb9`. These tests exercise behaviour that was already implemented, so they passed on their first run. To show that they can fail, TOTP replay protection was removed for one run and then restored:
- `verifyTotp` without `lastUsedStep`;
- no `recordTotpUse`.

```
$ pnpm exec vitest run --config vitest.integration.config.ts src/operators.integration.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
(mutation: replay protection removed)
 × enrols a factor, then signs in with password and code, and uses the session on the server API
AssertionError: expected 201 to be 401 // Object.is equality
      Tests  1 failed | 2 passed (3)
(source restored; git diff -- apps/api/src/services/mfa.ts is empty)
```

### 7. Hardening found in review: invitation acceptance hashed before checking the token

**RED.** Commit `9efd65d`.

```
$ pnpm exec vitest run src/services/users.test.ts --coverage.enabled=false
 × refuses an unknown token before spending an Argon2id hash on the password
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
      Tests  1 failed (1)
```

**GREEN.** Commit `7bba5e8`.

```
$ pnpm exec vitest run src/services/users.test.ts src/routes/dashboard/users.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  16 passed (16)
```

### 8. Rule 13 coverage: the missing-permission tests that were absent

Commit `75ad566` adds the 403 cases for `PATCH /roles/:id`, `GET /audit-logs/:id` and `GET /user-audit-logs/:id`. The checks already existed, so the tests passed at once. A mutation that drops the `PATCH /roles/:id` scope makes the new test fail; the source was then restored.

```
 × needs roles:write
      Tests  1 failed | 8 passed (9)
```

### Refactor

Commit `e895138`. The MFA challenge helpers are now private to operator auth, and the 255 operator-auth and dashboard tests stay green.

## Whole package

```
$ pnpm --filter @openverify/api exec vitest run --coverage --exclude src/openapi.test.ts --coverage.reportOnFailure
 Test Files  1 failed | 97 passed (98)
      Tests  2 failed | 1911 passed (1913)
All files  |   97.38 |    90.08 |    98.2 |   97.45 |
```

The two failures are in `src/test-support/harness.test.ts`, which is not mine. "Account acc_… was not found." comes from the accounts and inquiries work in progress (api-lifecycle and api-inquiries). They are in the report's followups.

Each file of mine is at least 94% on lines. The lowest branch figure is `services/mfa.ts`, at 80.55%.

```
$ pnpm exec vitest run src/openapi.test.ts --coverage.enabled=false
 × matches the committed snapshot
+     "/api/v1/user-audit-logs": { …   "/api/v1/dashboard/me/mfa-factors": { …   "/api/v1/dashboard/users": { …
      Tests  1 failed | 1 passed (2)
```

The OpenAPI document is generated with every C15 route; only the committed snapshot differs. e2e-integration regenerates `docs/api/openapi.json`, and it is not committed here.
