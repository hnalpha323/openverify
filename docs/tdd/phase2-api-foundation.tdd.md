# TDD evidence: Phase 2, api-foundation

Slice owner: api-foundation agent (Workflow 2A, Stage 1b, after contracts-v2; db-v2 still running). Date: 2026-10-20.

Owned paths:
- `apps/api/src/ports.ts`, `apps/api/src/plugins/principal-auth.ts` (replaces `plugins/api-key-auth.ts`, now deleted), `apps/api/src/auth/**`;
- `apps/api/src/problem-details.ts`, `apps/api/src/errors.ts`, `apps/api/src/app.ts` (principal wiring), `apps/api/src/services/context.ts`;
- `apps/api/src/routes/server/index.ts`, `apps/api/src/routes/dashboard/index.ts`, `apps/api/src/test-support/**`;
- the new stubs and their colocated tests (listed below).

## Plan task

From `docs/plans/phase-2.plan.md`, Stage 1 "api-foundation":
1. The principal plugin. API keys behave exactly as in Phase 1. User sessions go through an injected `PrincipalResolver`.
2. PII masking helpers.
3. The C9 problem types.
4. The ports, with stubs carrying locked names, registered so Stage 2 never edits the index files.
5. Harness support for user principals, and fakes for every new port.

No new dependency.

## What was built

- **`ports.ts`:**
  - `Principal` exactly as locked in C12, with `Permission` from `@openverify/core`, plus `ApiKeyPrincipal`, `UserPrincipal` and `PrincipalResolver` (`(token, request) => Promise<Principal | null>`);
  - `actorOf(principal)` (the C15 audit actor);
  - `ServiceContext` (`organizationId`, `environmentId`, and optional `requestId`, `ipAddress` and `userAgent`);
  - `AccountsService.resolveForInquiry(tx, ctx, { accountId?, referenceId? }) → Promise<string>`;
  - `RedactionService.redactInquiry(ctx, id, actor)` and `redactAccount(ctx, id, actor)`, each returning `{ redactedAt, alreadyRedacted }`;
  - `AuditLogger.record(db, entry)`;
  - `RateLimiter.consume(key, policy) → { allowed, limit, remaining, resetAt, retryAfterSeconds }`;
  - `Mailer.send({ to, subject, text, html? })`.
- **`plugins/principal-auth.ts`.** The token prefix picks the resolver:
  - `ov_sbx_`/`ov_prod_` go to the API key lookup;
  - `ovu_` goes to `resolveUserSession`;
  - any other token gets the same 401 "The API key is not valid." without a lookup.

  API keys keep their Phase 1 behaviour:
  - 401 for missing, unknown, revoked or expired keys;
  - 403 for the IP allowlist;
  - 403 for a missing scope;
  - `onAuthenticated` is called last.

  The key becomes `request.principal`, with the environment kind and organization of its environment row. Only known permissions are kept. A user principal is checked the same way. With `mfaSatisfied: false` it first gets 401 `mfa-required`.

  Exports: `requirePrincipal`, `authorizePrincipal`, `parseBearerToken` and `isAddressAllowed`. Routes still declare `config.scopes`, now typed `readonly Permission[]`, and `config.auth` still marks flow and dashboard routes.
- **`auth/pii.ts`:**
  - `canViewPii` (API keys: always; users: `pii:view`);
  - `piiMaskFor(principal)` returns a `PiiMask` with `fields`, `note`, `ipAddress`, `userAgent` and `attributes`;
  - `UNMASKED`, for event payloads, webhooks and jobs;
  - `requirePiiView`, which answers 403 `forbidden` for file content.
- **`errors.ts` and `problem-details.ts`:**
  - `ProblemTypeError(slug, …)` and one class per C9 slug: `InvalidTransitionError`, `TemplateArchivedError`, `IdempotencyKeyReusedError`, `IdempotencyKeyInUseError`, `RateLimitedError` (with `Retry-After`), `UnsupportedApiVersionError`, `SandboxOnlyError`, `PermissionDeniedError` (`forbidden`), `MfaRequiredError` (RFC 9470 `insufficient_user_authentication`) and `RedactedError`;
  - `SessionInactiveError(code)` for the C10 flow 401, with `code: session_expired | session_canceled`;
  - `AppError` carries the optional `code` and `errors` extension members, and the handler sends them;
  - Phase 1 errors keep `about:blank`.
- **`services/context.ts`:**
  - `ApiDependencies` gains `accounts`, `redaction`, `audit`, `rateLimiter`, `mailer` and an optional `resolveUserSession`;
  - `dependenciesOf` passes these on;
  - new helpers `serviceContextOf(principal, metadata)` and `auditEntryOf(ctx, actor, action)`.
- **Stubs with locked names.** Factories return objects whose methods reject with `NotImplementedError` naming the owner, and route plugins register nothing:
  - **Server route plugins:**
    - `routes/server/accounts.ts` `accountRoutes` and `account-types.ts` `accountTypeRoutes` (api-lifecycle);
    - `inquiry-sessions.ts` `inquirySessionRoutes` and `inquiry-template-versions.ts` `inquiryTemplateVersionRoutes` (api-inquiries);
    - `api-keys.ts` `apiKeyRoutes`, `api-logs.ts` `apiLogRoutes` and `rate-limits.ts` `rateLimitRoutes` (api-platform);
    - `webhook-deliveries.ts` `webhookDeliveryRoutes` (api-integrations);
    - `user-audit-logs.ts` `userAuditLogRoutes` (api-operators).
  - **Service and adapter factories:**
    - `services/accounts.ts` `createAccountsService` and `services/redaction.ts` `createRedactionService` (api-lifecycle);
    - `services/audit-log.ts` `createAuditLogger`, `mail/index.ts` `createMailer` and `operator-auth/principal-resolver.ts` `createUserSessionPrincipalResolver` (api-operators);
    - `rate-limit/index.ts` `createRateLimiter` (api-platform).
  - **Dashboard:** `routes/dashboard/admin.ts` `dashboardAdminRoutes` (api-operators), with `DashboardAdminOptions`, which api-operators may extend.
  - **Registration:** every server plugin is registered in `routes/server/index.ts`. `dashboardAdminRoutes` is registered at the dashboard root, outside the operator-authenticated scope, because MFA login and invitation acceptance take no session.
- **`container.ts`** (api-platform's file; edited only in marked blocks):
  - each stub factory call sits in its owner's block (`// api-lifecycle: begin` … `end`, `// api-operators: begin` … `end`);
  - `resolveUserSession` stays unset until api-operators implements it;
  - the dashboard routes get `admin: { api: deps }`.
- **`test-support`:**
  - `principals.ts`: `userPrincipal`, `apiKeyPrincipal`, and `createTestUserSessions` (issue and revoke `ovu_` tokens);
  - `fakes.ts`: `createRecordingAuditLogger`, `createAllowAllRateLimiter`, `createDenyRateLimiter`, `createCapturingMailer`, `createFakeAccountsService` and `createRecordingRedactionService`;
  - `plugins.ts`: `routesOf(plugin, options)`;
  - `harness.ts`:
    - `createTestApi(overrides | (defaults) => overrides)`;
    - every port has a fake;
    - `organizationId` and `environmentKind` on tenants, and `newTenant({ kind: 'production' })`, which issues `ov_prod_` keys;
    - `newUserToken(environmentId, { permissions?, mfaSatisfied?, userId? })`.

## Decisions taken while planning

- **Unknown stored scopes grant nothing.** `Principal.permissions` is a `ReadonlySet<Permission>`, so the plugin keeps only known permissions (`isPermission`), which fails closed. Every Phase 1 scope is a known permission, so real keys behave as before.
- **`config.scopes` is typed `readonly Permission[]`.** Five Stage 2 agents add routes, and a typo in a scope would otherwise lock everyone out of a route silently. The synthetic Phase 1 test scopes (`inquiry.read`, `inquiry.write`, `probe.read`) therefore became real ones (`inquiries:read`, `inquiries:write`, `events:read`). Every assertion is otherwise identical.
- **Problem types.** A missing scope or permission answers `https://openverify.dev/problems/forbidden`, as C12 says ("Phase 1 answered 403 too, so the status is unchanged"). The IP allowlist 403 is not about a permission, so it keeps `about:blank`.
- **Tokens with neither prefix are not looked up.** No key generator produces them. The response is the same Phase 1 401 "The API key is not valid." with `invalid_token`.
- **`ovu_` tokens without a configured resolver** answer 401 "The user session is not valid or has expired." The API key lookup is never called for them.
- **MFA comes before permissions.** A user session that has not satisfied MFA gets 401 `mfa-required` on every server API route, before the permission check (C15).
- **`ServiceContext` carries no environment kind and no actor.** Redaction takes the actor separately (`AuditActor | null`, where `null` means a background job such as retention). Sandbox-only checks use the principal.
- **`AuditEntry` gains an optional `requestId`.** The locked entry stays as it was, and `audit_logs.request_id` exists.
- **The OpenAPI document still declares only `apiKey` security for server routes.** Documenting `userSession` there is left to whoever wires the real resolver (see the report's follow-ups); doing it now would change Phase 1 assertions in `app.test.ts`, `scopes.test.ts` and the dashboard tests.

## Tests (written first)

- `plugins/principal-auth.test.ts`:
  - the 34 Phase 1 API-key tests (`it.each` rows counted), moved from `api-key-auth.test.ts` with identical assertions;
  - 16 new principal tests: the API-key principal shape, unknown scopes, the forbidden and `about:blank` types, prefix routing, the user resolver, 401 for a user session, 403 forbidden, `mfa-required` and its order, no `onAuthenticated` for users, resolver failures, `config.auth: 'user-session'`;
  - `requirePrincipal` and `authorizePrincipal`.
- `errors.test.ts` (new) and `problem-details.test.ts` (+4): every C9 slug, the subclasses, `Retry-After`, the step-up challenge, `code` and `errors`, and schema validity against `problemSchema`.
- `auth/pii.test.ts`: masking for API keys, reviewers and viewers; absent values; `attributes`; `UNMASKED`; `requirePiiView`.
- `ports.test.ts` (+7): Phase 2 stub owners and `actorOf`.
- `services/context.test.ts`: `dependenciesOf` is exhaustive (compile-time key list), `serviceContextOf` and `auditEntryOf`.
- `auth/api-key-lookup.test.ts`: the organization and environment kind of sandbox and production keys.
- Stub tests: one per stub file. `routes/server/index.test.ts` and `routes/dashboard/admin.test.ts` check registration through `printPlugins()`. `test-support/plugins.test.ts` shows that `routesOf` really lists routes, so the empty lists mean something.
- `test-support/fakes.test.ts` and `test-support/harness.test.ts`. Through real server routes, the harness tests show that a user token with chosen permissions reads; that a missing permission answers 403 `forbidden`; that `mfaSatisfied: false` answers 401 `mfa-required`; that another environment answers 404; and that revoked tokens answer 401.

## Baseline before this slice

On `82732b1`, contracts-v2 and db-v2 had already changed shared types, so the api package was not fully green. None of these files is mine.
```
$ pnpm exec vitest run --coverage.enabled=false --exclude src/openapi.test.ts
 FAIL  src/webhooks/dispatcher.test.ts > deliverWebhook > gives up after the fifth attempt, keeping every attempt
 FAIL  src/webhooks/dispatcher.test.ts > deliverWebhook edge cases > fails a delivery whose event is not a Phase 1 event, without sending it
 FAIL  src/webhooks/dispatcher.test.ts > webhookRetryDelayMs > grows exponentially, with equal jitter between half and the full delay
 FAIL  src/routes/dashboard/index.test.ts > POST /api/v1/dashboard/sessions > signs an operator in without an API key and returns a 12 hour token once
 FAIL  src/routes/server/events.test.ts > GET /api/v1/events/:id > answers 500 rather than serve a stored event outside the C5 contract
 Test Files  3 failed | 38 passed (41)
      Tests  5 failed | 846 passed (851)
$ pnpm exec tsc --noEmit | grep "error TS" | cut -d'(' -f1 | sort | uniq -c
      1 src/jobs/records.test.ts
      1 src/routes/dashboard/inquiries.ts
      1 src/services/inquiries.ts
```
The OpenAPI snapshot test also failed, because the contract schemas had changed.

## RED and GREEN

Every run used `source scripts/env.sh` first, then `pnpm exec vitest run <files>` in `apps/api`, with `--coverage.enabled=false` while iterating. Each RED state was committed as `test(api): …` before its implementation.

### Cycle 1: C9 problem types (`a0312a8` RED, `d6a4e2c` GREEN)

RED (`src/errors.test.ts src/problem-details.test.ts`):
```
 FAIL  src/errors.test.ts [ src/errors.test.ts ]
TypeError: InvalidTransitionError is not a constructor
 FAIL  src/problem-details.test.ts > C9 problem types and extension members > sends the problem type URI, its status and title
TypeError: InvalidTransitionError is not a constructor
 FAIL  src/problem-details.test.ts > C9 problem types and extension members > sends the headers of the problem, such as Retry-After
TypeError: RateLimitedError is not a constructor
 FAIL  src/problem-details.test.ts > C9 problem types and extension members > sends the code and per-field errors extension members when present
TypeError: SessionInactiveError is not a constructor
 FAIL  src/problem-details.test.ts > C9 problem types and extension members > every C9 response satisfies the contract problem schema
TypeError: PermissionDeniedError is not a constructor
 Test Files  2 failed (2)
      Tests  4 failed | 19 passed (23)
```

GREEN. Typecheck errors were only the three baseline ones, and lint was clean.
```
 Test Files  2 passed (2)
      Tests  47 passed (47)
```

### Cycle 2: principals, PII, ports, context (`e813495` RED)

RED (`src/plugins/principal-auth.test.ts src/auth/pii.test.ts src/ports.test.ts src/services/context.test.ts src/auth/api-key-lookup.test.ts`):
```
 FAIL  src/auth/pii.test.ts [ src/auth/pii.test.ts ]
Error: Cannot find module './pii.js' imported from .../apps/api/src/auth/pii.test.ts
 FAIL  src/plugins/principal-auth.test.ts [ src/plugins/principal-auth.test.ts ]
Error: Cannot find module './principal-auth.js' imported from .../apps/api/src/plugins/principal-auth.test.ts
 FAIL  src/ports.test.ts > actorOf (C15 audit actor) > is the API key of an api-key principal
TypeError: actorOf is not a function
 FAIL  src/auth/api-key-lookup.test.ts > createDbApiKeyAuthenticator > finds a key by the peppered hash of its token
AssertionError: expected { …(6) } to deeply equal { …(8) }
 FAIL  src/auth/api-key-lookup.test.ts > createDbApiKeyAuthenticator > reports the kind of the environment the key belongs to (C12 principals)
AssertionError: expected { …(6) } to match object { …(3) }
 FAIL  src/services/context.test.ts > dependenciesOf > passes on every dependency, including the Phase 2 ports, by reference
AssertionError: expected [ 'clock', 'db', 'events', …(6) ] to deeply equal [ 'accounts', 'audit', 'clock', …(12) ]
 FAIL  src/services/context.test.ts > serviceContextOf > scopes a service call to the principal's organization and environment
TypeError: serviceContextOf is not a function
 Test Files  5 failed (5)
      Tests  9 failed | 19 passed (28)
```

### Cycle 3: stubs, registration, fakes, harness user principals (`24b6dc1` RED)

RED (the 20 new test files):
```
 FAIL  src/mail/index.test.ts [ src/mail/index.test.ts ]
Error: Cannot find module './index.js' imported from .../apps/api/src/mail/index.test.ts
 FAIL  src/operator-auth/principal-resolver.test.ts / rate-limit / services/{accounts,audit-log,redaction} /
       routes/dashboard/admin / routes/server/{accounts,account-types,api-keys,api-logs,inquiry-sessions,
       inquiry-template-versions,rate-limits,user-audit-logs,webhook-deliveries}   (same: module not found)
 FAIL  src/test-support/fakes.test.ts [ src/test-support/fakes.test.ts ]
Error: Cannot find module './principals.js' imported from .../apps/api/src/test-support/fakes.test.ts
 FAIL  src/test-support/harness.test.ts > createTestApi > wires an in-memory fake for every Phase 2 port
TypeError: Cannot read properties of undefined (reading 'resolve')
 FAIL  src/test-support/harness.test.ts > user principals on the server API (C12) > authenticate a user session with the chosen permissions in its environment
TypeError: api.newUserToken is not a function
 FAIL  src/routes/server/index.test.ts > serverRoutes > registers inquiryTemplateVersionRoutes, so Stage 2 never edits this index
AssertionError: expected 'root 95 ms\n├── bound _after 4 ms\n├─…' to match /\binquiryTemplateVersionRoutes\b/
 Failed Tests 20   (11 harness, 9 registration; 17 files failed to import)
```

### GREEN for cycles 2 and 3 (`c71ffa1`)

The container and the harness cannot compile against the new `ApiDependencies` without the stubs and fakes, so cycles 2 and 3 went green in one commit.

```
$ pnpm exec vitest run <the 26 test files of cycles 1-3> --coverage.enabled=false
 Test Files  26 passed (26)
      Tests  196 passed (196)
```

Lint first refused two things, fixed before the commit:
- the fakes' `failNext: failure.arm` (`unbound-method`), now arrow members;
- an `as unknown` on an `any` in a test (`no-unnecessary-type-assertion`).

### Refactor (`c238bec`, `785ea55`, `4690fbf`)

- A positive test for `routesOf`, so an empty route list in a stub test is meaningful.
- `requirePiiView` checks `pii:view` only for principals that cannot already see PII.
- Doc comments: the `buildApp` description was rewrapped, and the dashboard index now names the session-less C15 routes.

### OpenAPI snapshot (`e7a1971`)

```
$ pnpm --filter @openverify/api openapi:write
  Snapshots  1 updated
      Tests  2 passed (2)
```
No operation was added or removed; I checked this by comparing the path and method sets before and after. The diff is the contracts-v2 schemas. `src/openapi.test.ts` passes.

## Final validation

```
$ pnpm exec vitest run --coverage --coverage.reportOnFailure --exclude src/openapi.test.ts
 Test Files  3 failed | 61 passed (64)
      Tests  5 failed | 977 passed (982)        # the 5 baseline failures above, unchanged
All files          |   97.36 |    92.04 |   98.18 |   97.52 |
$ pnpm exec tsc --noEmit        # only the 3 baseline errors, none in api-foundation files
$ pnpm exec eslint apps/api     # exit 0
$ pnpm exec prettier --check <changed files>   # all formatted
```
Per-file coverage (lines and branches):
- 100/100: `pii.ts`, `ports.ts`, `app.ts`, `api-key-lookup.ts`, every stub, `routes/server/index.ts` and `test-support/plugins.ts`.
- `principal-auth.ts`: 98.7/96.2.
- `services/context.ts`: 100/94.1.
- `fakes.ts`: 97.0/96.2.
- `harness.ts`: 97.6/94.1.
- `principals.ts`: 100/94.4.

## Phase 1 tests changed (minimal)

- `plugins/api-key-auth.test.ts` moved to `plugins/principal-auth.test.ts`. Its assertions are identical. Only the scope literals changed (`inquiry.read`/`inquiry.write` → `inquiries:read`/`inquiries:write`), as did the way the route handler reads the key (from `request.principal`).
- `app.test.ts`: the scope literal `probe.read` became `events:read`, because `config.scopes` is typed.
- `routes/dashboard/index.test.ts`: the import path, and `organizationId` and `environmentKind` added to the never-used API key fixture.
- `auth/api-key-lookup.test.ts`: the expected record gains `organizationId` and `environmentKind`.
