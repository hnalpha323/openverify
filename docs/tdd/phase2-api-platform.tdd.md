# TDD evidence: Phase 2, api-platform

Slice owner: api-platform agent (Workflow 2A, Stage 2, in parallel with api-inquiries, api-lifecycle, api-integrations and api-operators). Date: 2026-10-20.

Owned paths:
- `apps/api/src/plugins/{idempotency,rate-limit,api-version,api-logs}.ts` and `apps/api/src/rate-limit/**`;
- `apps/api/src/routes/server/{api-keys,api-logs,rate-limits,events}.ts` and `apps/api/src/services/{api-keys,api-logs,events}.ts`;
- `apps/api/src/{app,server,config,container}.ts` (shared: other agents add marked blocks);
- the tests of the above, plus `plugins/platform.test-support.ts` and `plugins/platform.integration.test.ts`.

## Plan task

C12 of `docs/plans/phase-2.plan.md`, except the principal plugin (api-foundation):
idempotency keys, GCRA rate limits with the four policies, the API version header, API logs, the API keys API, the Events API, the container and config wiring, and Testcontainers integration tests.

No new dependency (`ioredis` was already a dependency through BullMQ). One new environment variable: `OPENVERIFY_RATE_LIMIT_API_PER_MINUTE`.

## What was built

- **`rate-limit/index.ts`.** `createRateLimiter({ redis, clock? })`: GCRA in one Lua script (`GCRA_SCRIPT`, registered with `defineCommand`). Time comes from Valkey `TIME`, so instances with skewed clocks agree. Keys are `openverify:rate-limit:<policy>:<SHA-256 of the caller key>`, so client addresses and credentials never reach Valkey in clear. `createRateLimitRedis(url)` builds a lazy ioredis client with a 500 ms command timeout; while ioredis knows Valkey is down, `consume` rejects at once. `closeRateLimitRedis` quits or disconnects.
- **`plugins/rate-limit.ts`.** `api` per API key or user session on every authenticated server API request; `flow-ip` per client address on every flow request (preflights excepted) before the session lookup; `one-time-link-redeem` per client address on `POST /api/v1/flow/one-time-links/redeem`; `flow-session` per authenticated flow session in `preParsing`. `RateLimit-Limit`, `-Remaining` and `-Reset` report the tightest limit; over a limit: 429 `rate-limited` with `Retry-After`. **Fail open** when the limiter rejects: the request proceeds without headers and an error is logged (decision recorded in the module comment).
- **`plugins/api-version.ts`.** `OpenVerify-Version` validation (400 `unsupported-api-version`), default from the key's `api-version` (cached in a bounded map, since a key's version never changes) or the latest for users, `request.apiVersion`, and the echo on every server API response, including 401s.
- **`plugins/idempotency.ts`.** Claim, replay (`Idempotent-Replayed: true`, `Cache-Control: no-store`), 422 `idempotency-key-reused`, 409 `idempotency-key-in-use`, 5xx releases the key, 4xx is stored, the body is stored encrypted for 24 hours with the resource id for C16 redaction. Fingerprint: SHA-256 of canonical JSON of method, route, path, query and body; multipart by part names, sizes and SHA-256.
- **`plugins/api-logs.ts` and `services/api-logs.ts`.** One entry per authenticated server API request, written in `onResponse`; secrets redacted at any depth (`redactKeys`, `API_LOG_REDACTED_KEYS`), values over 64 KiB stored as `{ truncated, byte-length, preview }`, multipart as part metadata only, the resource id recorded; the repository encrypts address, agent, query and bodies. `GET /api-logs` (filters `method`, `status` code or class, `route`, `api-key-id`, `created-at`) and `GET /api-logs/:id`, scope `api-logs:read`, masked for users without `pii:view`.
- **`GET /rate-limits`.** The caller's `api` limit as recorded by the hook for that request; 503 when the limiter failed open.
- **API keys (`services/api-keys.ts`, `routes/server/api-keys.ts`).** List, get, create, patch, clone, expire. The token is returned once in `meta.token`; `token-prefix`; no scope escalation (403 `forbidden`); ranges with host bits answer 422; expiring never extends a key; one audit entry per change, in the change's transaction, never carrying the token.
- **Events (`services/events.ts`, `routes/server/events.ts`).** `GET /events` with `name`, `object-id`, `created-at` and `simulated` (default `false`); events now carry C14 `simulated`, serve C16 redaction stubs, and mask payload PII for users without `pii:view`.
- **Wiring.** `app.ts` registers, after principal auth: rate limit, API version, idempotency, API logs; decorates `apiKeyTokens` from the new `apiKeyPepper` option; takes `rateLimits`. `config.ts` reads `OPENVERIFY_RATE_LIMIT_API_PER_MINUTE` (1 to 1,000,000, default 300). `container.ts` builds the limiter on its own Valkey client (overridable), passes the limits and the pepper, and closes the client.

## TDD cycles

Every command ran in `apps/api` after `source scripts/env.sh`. Output is abbreviated.

### Cycle 1: GCRA limiter, rate-limit hooks, `GET /rate-limits`, API version

RED (`aefd9bd`):

```
$ pnpm exec vitest run src/rate-limit/index.test.ts src/plugins/rate-limit.test.ts src/plugins/api-version.test.ts src/routes/server/rate-limits.test.ts src/app.test.ts --coverage.enabled=false
 FAIL  src/plugins/api-version.test.ts  Error: Cannot find module './api-version.js'
 FAIL  src/plugins/rate-limit.test.ts   Error: Cannot find module './rate-limit.js'
 FAIL  src/rate-limit/index.test.ts > ... NotImplementedError: createRateLimiter is not implemented yet (owner: api-platform)
 FAIL  src/app.test.ts > ... AssertionError: expected { …(5) } to match object { 'ratelimit-limit': '300', …(3) }
 Test Files  5 failed (5)
      Tests  35 failed | 18 passed (53)
```

GREEN (`c139b75`):

```
 Test Files  5 passed (5)
      Tests  82 passed (82)
```

### Cycle 2: idempotency, API logs, `GET /api-logs`

RED (`c371d56`):

```
$ pnpm exec vitest run src/plugins/idempotency.test.ts src/plugins/api-logs.test.ts src/routes/server/api-logs.test.ts src/services/api-logs.test.ts src/app.test.ts --coverage.enabled=false
 FAIL  src/plugins/api-logs.test.ts      Error: Cannot find module './api-logs.js'
 FAIL  src/plugins/idempotency.test.ts   Error: Cannot find module './idempotency.js'
 FAIL  src/services/api-logs.test.ts     Error: Cannot find module './api-logs.js'
 FAIL  src/routes/server/api-logs.test.ts > ... (the routes answer 404: no route yet)
 Test Files  5 failed (5)        (24 tests failed)
```

GREEN (`137fa68`), after two test fixes: the bare test app now honours `x-request-id` as `buildApp` does, and a status-filter case that also counted the `GET /api-logs` requests' own 2xx entries now filters on `201,5xx`:

```
 Test Files  5 passed (5)
      Tests  94 passed (94)
```

### Bug found by the container test: routes in scopes older than the plugins

`/openapi.json` answered 500 once the plugins were registered: `@fastify/swagger`'s scope predates the `principal` and `rateLimit` decorations, so they are `undefined` there, not `null`.

RED (`b501f92`):

```
 FAIL  src/app.test.ts > ... still serves /openapi.json, whose route predates the platform plugins
   (500: "Cannot destructure property 'decision' of 'applied' as it is undefined.")
 FAIL  src/plugins/rate-limit.test.ts > routes in scopes created before the plugin > are served without limits
 FAIL  src/plugins/api-version.test.ts > ... leaves public routes and other APIs alone
 FAIL  src/plugins/idempotency.test.ts > ... leaves routes in scopes created before the plugin alone
 FAIL  src/plugins/api-logs.test.ts > ... records nothing for unauthenticated requests, public routes or other APIs
 Test Files  5 failed (5)
      Tests  5 failed | 81 passed (86)
```

GREEN (`5069861`, null-safe `principalOf` and `appliedOf`):

```
$ pnpm exec vitest run src/app.test.ts src/plugins src/routes/server/rate-limits.test.ts src/routes/server/api-logs.test.ts src/services/api-logs.test.ts src/rate-limit --coverage.enabled=false
 Test Files  10 passed (10)
      Tests  212 passed (212)
```

### Cycle 3: config, container, integration tests

RED (`8147e3e`):

```
$ pnpm exec vitest run src/config.test.ts src/container.test.ts --coverage.enabled=false
 × limits the server API to 300 requests per minute per principal by default
   AssertionError: expected undefined to deeply equal { apiPerMinute: 300 }
 × rejects OPENVERIFY_RATE_LIMIT_API_PER_MINUTE=0 ... (5 cases)
 × every createContainer test (the container could not be built)
      Tests  17 failed
$ pnpm exec vitest run --config vitest.integration.config.ts src/plugins/platform.integration.test.ts
 × holds one limit for a key whichever instance serves it
 × runs exactly one of concurrent requests with the same key
 × creates one webhook for concurrent creations with the same key
      Tests  3 failed (3)
```

Honest note: the container could not be built at that moment for two reasons at once. My cycle-1 change had made the old zero-argument `createRateLimiter()` call in `container.ts` invalid, and api-lifecycle's uncommitted `createAccountsService(options)` threw first (`TypeError: Cannot read properties of undefined (reading 'ids')`). The integration RED therefore failed before reaching its C12 assertions.

GREEN (`e835b33`). The container tests were checked against HEAD's stubs of the two lifecycle services: a temporary, uncommitted copy of `container.test.ts` mocked `services/accounts.js` and `services/redaction.js` to their committed stub shapes.

```
$ pnpm exec vitest run src/zz-container-head.test.ts src/config.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  56 passed (56)
```

Once api-lifecycle had updated its container block, the integration tests ran against Postgres 17 + pgvector and Valkey 9.1 (Testcontainers):

```
$ pnpm exec vitest run --config vitest.integration.config.ts src/plugins/platform.integration.test.ts
 ✓ GCRA rate limits across API instances (C12) > holds one limit for a key whichever instance serves it
 ✓ idempotency across API instances (C12) > runs exactly one of concurrent requests with the same key
 ✓ idempotency across API instances (C12) > creates one webhook for concurrent creations with the same key
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  44.82s
```

### Cycle 4: API keys API and `GET /events`

RED (`eed3de5`):

```
$ pnpm exec vitest run src/routes/server/api-keys.test.ts src/routes/server/events.test.ts --coverage.enabled=false
 AssertionError: expected [] to deeply equal [ 'POST /api-keys', …(7) ]
 Error: expected HTTP 200, got 404: ... "No route matches GET /api/v1/api-keys."
 Error: expected HTTP 200, got 404: ... "No route matches GET /api/v1/events."
 AssertionError: expected { type: 'event', …(2) } to deeply equal { type: 'event', …(2) }   (no `simulated`)
 AssertionError: expected { status: 'completed', …(4) } to match object { fields: { name_first: null } }
 Test Files  2 failed (2)
      Tests  55 failed | 3 passed (58)
```

GREEN (`35b9bbd`), after accepting a `null` body on `clone` (Fastify validates a request without a body as `null`):

```
$ pnpm exec vitest run src/routes/server/api-keys.test.ts src/routes/server/events.test.ts src/app.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  81 passed (81)
```

### Refactor

`3fed7e5` shares the header and JSON-object helpers of the two plugins through `services/api-logs.ts`:

```
$ pnpm exec vitest run src/plugins src/services/api-logs.test.ts src/routes/server/api-logs.test.ts --coverage.enabled=false
 Test Files  7 passed (7)
      Tests  157 passed (157)
```

## Final verification

Whole api unit suite without the OpenAPI snapshot test, with coverage reported despite failures in other agents' work in progress:

```
$ pnpm exec vitest run --coverage --coverage.reportOnFailure --exclude src/openapi.test.ts
 FAIL  src/zz-lifecycle-openapi-check.test.ts   (a temporary file of api-lifecycle)
 FAIL  src/test-support/harness.test.ts > user principals on the server API (C12) > ... (2 tests)
   Error: expected HTTP 201, got 404: ... "Account acc_... was not found." (harness createInquiry)
 Test Files  2 failed | 95 passed (97)
      Tests  2 failed | 1896 passed (1898)
All files          |   96.54 |    89.06 |   97.79 |   96.63 |
```

Neither failure is in api-platform code: the harness creates inquiries through the fake accounts service, which writes no account rows, while the in-progress inquiries change now needs them.

Coverage of the api-platform files (statements, branches, functions, lines):

| File | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `config.ts` | 97.75 | 93.22 | 100 | 97.7 |
| `container.ts` (lines not covered belong to other blocks) | 95.23 | 90.9 | 81.81 | 95 |
| `rate-limit/index.ts` | 100 | 83.33 | 100 | 100 |
| `plugins/rate-limit.ts` | 100 | 97.05 | 100 | 100 |
| `plugins/api-version.ts` | 100 | 95 | 100 | 100 |
| `plugins/idempotency.ts` | 97.29 | 83.87 | 100 | 97.29 |
| `plugins/api-logs.ts` | 100 | 82.5 | 100 | 100 |
| `routes/server/*` (all) | 100 | 90 | 100 | 100 |
| `services/api-keys.ts` | 96.62 | 89.33 | 100 | 96.42 |
| `services/api-logs.ts` | 96.55 | 89.7 | 100 | 96.38 |
| `services/events.ts` | 95.65 | 90 | 88.88 | 95.45 |

Static checks on the api-platform files:

```
$ pnpm exec eslint <api-platform files>          # 0 problems
$ pnpm exec tsc --noEmit                          # 1 error, in src/seed/dev-seed.test.ts (not api-platform)
$ pnpm exec prettier --check <api-platform files> # All matched files use Prettier code style!
$ pnpm exec vitest run --config vitest.integration.config.ts src/plugins/platform.integration.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## Phase 1 tests changed (rule 12)

- `routes/server/events.test.ts`:
  - "returns the event resource with its payload" expects `simulated: false`, which C14 adds to every event.
  - The 500 case now stores `inquiry.deleted`, since `inquiry.marked-for-review` became a valid C17 event; its title says "event contract" instead of "C5 contract".
- `rate-limit/index.test.ts`, `routes/server/{api-keys,api-logs,rate-limits}.test.ts`: the api-foundation stub tests were replaced by the real behaviour.
