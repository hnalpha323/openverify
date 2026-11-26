# TDD evidence: Phase 1, dashboard

Slice owner: dashboard agent (Workflow 1A, Stage 2). Date: 2026-10-20.

Owned paths:
- `apps/api/src/operator-auth/**` (new);
- `apps/api/src/routes/dashboard/**` (the C4 plugin, replacing the stub);
- `apps/dashboard/**`;
- the `ignoredOptionalDependencies` key of `pnpm-workspace.yaml`;
- this file.

## Plan task

From `docs/plans/phase-1.plan.md`, Stage 2 "dashboard":
1. **operator-auth** (apps/api): Argon2id hashing and verification, `ovu_` user sessions (hashed at rest, 12 h TTL, revocation), a login rate limit per IP and per email, and a generic 401 with constant-time behaviour for unknown users.
2. **C4 routes**: login and logout, `me`, the inquiry list and detail (verifications, checks and file metadata), and file content (decrypted through `FileStorage` and `decryptBytes`, `Cache-Control: private, no-store`, a `file.viewed` audit entry). They are environment-scoped by the session and appear in OpenAPI under the tag `dashboard`.
3. **apps/dashboard** (Next.js 16 App Router as a BFF):
   - a login server action that sets an httpOnly, SameSite=Lax cookie (Secure over https);
   - the request-interception file;
   - server components for the inquiry list and detail;
   - an image proxy route handler;
   - logout;
   - `OPENVERIFY_API_URL` as a server-only setting.
4. **Remove sharp** (`ignoredOptionalDependencies`, `images.unoptimized`), and verify that `next build` passes and that no `@img/sharp-libvips` remains.

Dependencies (licenses checked with `npm view <pkg> license`):

| Package | Version | License | Where | Why |
|---|---|---|---|---|
| `@node-rs/argon2` | 2.2.2 | MIT | apps/api, runtime | Argon2id. Prebuilt N-API binaries come through `optionalDependencies` (`@node-rs/argon2-linux-x64-gnu` 2.2.2, MIT); there is no install script, so no `allowBuilds` entry is needed |
| `server-only` | 0.0.1 | MIT | apps/dashboard, runtime | Marks the API client and session modules as server-only; Next.js resolves it internally |
| `@openverify/contracts` | workspace | (repo) | apps/dashboard | Type-only imports of the C4 document types |

## Decisions

- **Next.js 16 request interception is `src/proxy.ts`** (exported `proxy`), which replaces `middleware.ts`. This comes from the docs bundled with next 16.4.2 (`dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`): Node.js runtime, no `runtime` option. The check is optimistic (cookie present). `/login` is always let through, so a stale cookie cannot lock anyone out. Every page, action and route handler re-verifies the session with the API (`withSession`, `getSessionToken`), as the Next 16 data-security guide requires.
- **API-key auth bypass.** `apiKeyAuth` runs on every route unless `config.public`. An `onRoute` hook in the dashboard plugin marks every dashboard route `public` (meaning no API key) and adds an `onRequest` hook, in an encapsulated child context, that authenticates the `ovu_` session. A test proves that an API key never authenticates a dashboard route and that `lookupApiKey` is never called.
- **OpenAPI security scheme.** @fastify/swagger throws on a `security` entry that names an undefined scheme, and `app.ts` (not mine) defined no `userSession` scheme. The plugin therefore sets a route-level `swaggerTransform`. It adds `userSession` to a new `securitySchemes` object on the document being built (it never mutates the shared options object), then applies the app's own zod conversion (`createJsonSchemaTransform({ schemaRegistry: openApiComponents })`), so the dashboard operations `$ref` the same named components as the server API. Image responses are documented as `{ type: string, format: binary }`.
- **Login timing.** C4 login has no organization, and emails are unique per organization only. So the login verifies every account with that email, oldest first, and opens a session for the one whose password matches. An unknown email is verified against a dummy Argon2id hash that is computed once, at factory time, with the same parameters, so it also costs one KDF run. Remaining leak: an email shared by N organizations costs N verifications. Every failure, including an account whose organization has no environment, is the same `InvalidCredentialsError` (401, "The email or password is incorrect.").
- **Session environment.** There is no environment switcher in Phase 1. A session opens in the organization's `sandbox` environment (configurable with `environmentKind`), or in its other one when it has only that.
- **Argon2id parameters.** The OWASP Password Storage Cheat Sheet minimum: m=19456 KiB, t=2, p=1, a 32-byte output and a 16-byte salt. The library defaults to Argon2id v0x13; a test pins the PHC prefix `$argon2id$v=19$m=19456,t=2,p=1$`. Verification reads the parameters from the stored hash. A malformed hash is a mismatch, not an exception.
- **Rate limit.** An in-memory fixed-window limiter with an async interface, so Phase 2 can move it to Valkey without changing callers. Defaults are 50 attempts per address and 10 per email per 15 minutes.
  - Every attempt counts.
  - An attempt over either limit is refused (429 with `Retry-After`) before any password is verified, and is counted against neither key.
  - A successful login clears the email's counter.
  - Memory is bounded: expired windows are pruned first, then the oldest keys are evicted (`maxKeys`, default 100 000).
  - The per-address limit uses `request.ip`, so behind the dashboard BFF it only sees operators when the API trusts the BFF hop. The BFF forwards `X-Forwarded-For`, and api-http's `OPENVERIFY_TRUST_PROXY` sets Fastify `trustProxy`.
- **File content.** AES-GCM authenticates the whole object before any plaintext is released, so the route decrypts fully rather than streaming ciphertext. It then checks the recorded byte size and SHA-256, and takes the content type from the magic bytes, not from the row. The `file.viewed` audit entry is written *before* any byte is sent; if the audit write fails, nothing is sent. Integrity failures are an opaque 500 that writes no audit entry. Responses carry `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
- **No caching anywhere.** An `onSend` hook marks every dashboard response `no-store` (tokens, PII and images), unless a route set a stricter value.
- **BFF without runtime contracts.** The dashboard imports `@openverify/contracts` for types only, so Next does not bundle zod, core or flow-spec, and needs no `dist` build or source alias for them. The session response is checked structurally (an `ovu_` token and a parseable expiry) before the token goes into the cookie.
- **Cookie.** `openverify_session` is httpOnly, SameSite=Lax, `Path=/`, and `Expires` equals the session's `expires-at`. It is Secure when the first `X-Forwarded-Proto` entry is `https` (Next.js sets that header from the connection). The token never reaches client JavaScript (checked in the browser smoke test below).
- **Image proxy and the Next.js fetch tee.** Next.js dedupes GET `fetch` calls during a request by `tee()`ing the response and keeping the second branch (`next/dist/server/lib/dedupe-fetch.js`). Cancelling one tee branch only settles once both are cancelled, so `await upstream.body.cancel()` hung every API error. The browser smoke test found this; it is fixed by draining small error bodies instead.
- **Security headers.** `next.config` sends the following on every console response, and `poweredByHeader: false` drops `X-Powered-By`:
  - `Content-Security-Policy: frame-ancestors 'none'`;
  - `X-Frame-Options: DENY`;
  - `Referrer-Policy: no-referrer`;
  - `X-Content-Type-Options: nosniff`;
  - a restrictive `Permissions-Policy`.

  A full script CSP needs per-request nonces and is left for later.
- **sharp.** `ignoredOptionalDependencies: [sharp]` and `images.unoptimized: true`. `pnpm install` removed 29 packages from the graph. `pnpm prune` (under the pnpm lock) removed the orphaned `sharp`, `@img/sharp-*` and `@img/colour` directories from `node_modules/.pnpm`. A test keeps sharp out of `pnpm-workspace.yaml` and `pnpm-lock.yaml`.

## Tests (written first)

`apps/api`:
- `operator-auth/password-hasher.test.ts`: the OWASP parameters; PHC format and random salts; right and wrong passwords; a malformed hash is a mismatch; hashes made with other parameters still verify; `hashPassword`.
- `operator-auth/login-rate-limiter.test.ts`:
  - per-email and per-address limits;
  - email normalization;
  - retry delay and window reset;
  - a blocked attempt is counted against neither key;
  - reset after success;
  - bounded memory (pruning, then eviction);
  - defaults;
  - rejected configurations.
- `operator-auth/operator-auth.test.ts` (PGlite):
  - a 12 h session in the sandbox, stored only as a hash;
  - case-insensitive email;
  - a generic 401 for a wrong password and for an unknown email (one dummy verification, with the dummy hash computed once);
  - a shared email across organizations;
  - environment preference and fallback;
  - no environment;
  - the rate limit runs before verification;
  - reset after success;
  - expiry at exactly 12 h;
  - malformed and unknown tokens;
  - logout revokes;
  - a failing hasher;
  - real Argon2id defaults.
- `routes/dashboard/index.test.ts` (the real `buildApp`, PGlite, an in-memory `FileStorage`):
  - every C4 route;
  - no API key on login, and API keys never accepted;
  - a generic 401 that is identical for a wrong password and an unknown email;
  - zod validation;
  - 429 per email and per address;
  - `user_session.created` and `user_session.revoked` audit entries;
  - a 404 for another environment's inquiry, file or cursor (a 400 for a foreign cursor);
  - newest-first order, the status and reference-id filters, and a cursor `links.next` that keeps the filters;
  - the detail with checks (requirement mapping) and file metadata, without storage internals;
  - file content: bytes, headers, and the audit entry with an encrypted IP. It returns 404 for a missing object, 500 without an audit entry for tampered ciphertext or a wrong digest, and 401 or 400;
  - verification types Phase 1 cannot represent are skipped;
  - an empty list;
  - a database failure gives an opaque 500;
  - `no-store` on every response;
  - OpenAPI: tag, security, scheme, components, problem responses and binary images.
- `routes/dashboard/authenticate.test.ts`: `requireOperator` refuses an unauthenticated request.

`apps/dashboard`:
- `lib/config.test.ts`: `OPENVERIFY_API_URL` parsing.
- `lib/dashboard-api.test.ts`: every C4 call, through a mocked `fetch`:
  - bearer, `no-store`, `redirect: error`, and `X-Forwarded-For`;
  - status-to-outcome mapping;
  - malformed success bodies refused;
  - `UnauthenticatedError` and `DashboardApiError`;
  - 404 gives `null`;
  - path encoding.
- `lib/session.test.ts`: the cookie options (httpOnly, Lax, Secure over https, expiry); clear; the forwarded address; `withSession` redirects.
- `lib/inquiry-query.test.ts`: URL parsing that ignores anything unexpected; hrefs; reading the cursor from `links.next`.
- `app/actions/auth.test.ts`:
  - login sets the cookie and redirects;
  - failures are reported without a cookie;
  - server-side re-validation (missing fields, a malformed email, a `File` as the password);
  - logout revokes, clears the cookie and redirects, also without a session.
- Pages, through server components called directly:
  - `app/inquiries/page.test.tsx`;
  - `app/inquiries/[id]/page.test.tsx`;
  - `app/inquiries/layout.test.tsx`;
  - `app/inquiries/error.test.tsx`;
  - `app/login/page.test.tsx`;
  - `app/page.test.tsx`.
- `app/files/[id]/content/route.test.ts`:
  - streaming with the session token;
  - 401, 404 and 502 mapping, with no upstream body passed on;
  - only image content types are passed on;
  - the tee regression.
- `proxy.test.ts`: redirects and pass-through, with the matcher checked by `unstable_doesMiddlewareMatch` (the name next 16.4.2 exports; its docs say `unstable_doesProxyMatch`, which does not exist).
- Components: `login-form`, `inquiries-table`, `inquiry-filters`, `pagination`, `status-badge`, `verification-card`.
- `next-config.test.ts`: `images.unoptimized`, `poweredByHeader`, and the security headers through `unstable_getResponseFromNextConfig`.
- `no-sharp.test.ts`: the workspace key, and no sharp or libvips in the lockfile.

## RED and GREEN

Every RED run used `pnpm exec vitest run --coverage.enabled=false <paths>` in the package directory, after `source scripts/env.sh`. Each RED state was committed as `test(...)` before its implementation.

### Cycle 1: operator-auth (`apps/api`)

RED (commit `c9e51dd`):
```
 FAIL  src/operator-auth/login-rate-limiter.test.ts
Error: Cannot find module './login-rate-limiter.js' imported from ./apps/api/src/operator-auth/login-rate-limiter.test.ts
 FAIL  src/operator-auth/operator-auth.test.ts
Error: Cannot find module './login-rate-limiter.js' imported from ./apps/api/src/operator-auth/operator-auth.test.ts
 FAIL  src/operator-auth/password-hasher.test.ts
Error: Cannot find module './password-hasher.js' imported from ./apps/api/src/operator-auth/password-hasher.test.ts
 Test Files  3 failed (3)
      Tests  no tests
```

GREEN (commit `48d35ef`), with `tsc --noEmit` and `eslint src/operator-auth` clean:
```
 Test Files  3 passed (3)
      Tests  37 passed (37)
Statements   : 99.04% ( 104/105 )
Branches     : 100% ( 68/68 )
```
The first lint found `unbound-method` on the tests' method-shorthand clocks; they became arrow properties.

### Cycle 2: C4 routes (`apps/api/src/routes/dashboard`)

RED (commit `347a5c0`): the stub registered no routes, so all 28 tests failed for that reason:
```
     × signs an operator in without an API key and returns a 12 hour token once
     × answers a wrong password and an unknown email with the same generic 401
     ... (28 in all)
AssertionError: expected 404 to be 201 // Object.is equality
 Tests  28 failed (28)
```

GREEN (commit `eeee61c`):
```
 Test Files  4 passed (4)
      Tests  65 passed (65)
Statements   : 97.92% ( 236/241 )
Branches     : 91.89% ( 102/111 )
```
Two problems surfaced on the way, both fixed before the commit:
- `/openapi.json` answered 500 (`Cannot read properties of undefined (reading 'type')` in @fastify/swagger), because of the undefined `userSession` scheme. This led to the route-level transform; the OpenAPI test was extended to assert the scheme.
- Typecheck refused a `Buffer` for a `z.string()` content schema. It became `z.instanceof(Buffer)`.

### Cycle 3: the dashboard BFF (`apps/dashboard`)

RED (commit `52708d7`):
```
 FAIL  src/proxy.test.ts
Error: Cannot find module './lib/session-cookie' imported from ./apps/dashboard/src/proxy.test.ts
 FAIL  src/components/login-form.test.tsx
Error: Failed to resolve import "../lib/login-state" from "src/components/login-form.test.tsx"
 ... (16 files: modules not found)
 × serves images unoptimized, so the optional LGPL sharp binaries are never needed
 × shows each inquiry with its ID as the row header, linking to its detail page
 × submits to the login server action
 × opens the inquiries list
 Test Files  20 failed | 2 passed (22)
      Tests  5 failed | 29 passed (34)
```

GREEN (commit `024a9d0`). `pnpm run typecheck` (`next typegen && tsc`), `pnpm run lint` and `next build` all passed:
```
 Test Files  22 passed (22)
      Tests  181 passed (181)
Statements   : 97.52% ( 276/283 )
Branches     : 94.71% ( 197/208 )
Functions    : 100% ( 91/91 )
```
Three test-side corrections went into the GREEN commit:
- Two queries were ambiguous: "Passed", "Failed" and "Status" also appear as check badges and as a column header. They now target the `dt` or the first badge.
- `<input type="email">` value sanitization (in the HTML spec, implemented by jsdom) trims surrounding whitespace, so the FormData email arrives trimmed.
- Lint (`no-base-to-string`) found a `String()` on a `fetch` argument in a test.

### Cycle 4: sharp removal

RED (commit `9205f66`):
```
 FAIL  src/no-sharp.test.ts > sharp stays out of the install > is listed in ignoredOptionalDependencies
AssertionError: expected 'packages:\n  - apps/*\n  - packages/*…' to match /^ignoredOptionalDependencies:\n(?:\s…/m
 FAIL  src/no-sharp.test.ts > sharp stays out of the install > has no sharp or libvips package in the lockfile
AssertionError: expected '---\nlockfileVersion: \'9.0\'\n\nimpo…' not to match /^\s+'?sharp@/m
```

GREEN (commit `368c545`; the workspace hunk and the lockfile were committed under both locks):
```
$ flock /tmp/openverify-pnpm.lock pnpm install
Lockfile is up to date, resolution step is skipped
Packages: +1 -29
$ flock /tmp/openverify-pnpm.lock pnpm prune
Already up to date
$ ls node_modules/.pnpm | grep -E '^(sharp|@img)'
(nothing)   # before: @img+colour@1.1.0, @img+sharp-libvips-linux-x64@1.3.4, @img+sharp-linux-x64@0.35.5, sharp@0.35.5
$ pnpm run build   # apps/dashboard
✓ Compiled successfully
ƒ /files/[id]/content  ƒ /inquiries  ƒ /inquiries/[id]  ○ /login  ƒ Proxy (Middleware)
 Tests  4 passed (4)   # no-sharp + next-config
```
No `minimumReleaseAgeExclude` entry was added.

### Cycle 5: hardening

RED (commit `3e2138f`):
```
 FAIL  src/routes/dashboard/index.test.ts > caching > marks every dashboard response no-store, errors included, as they carry PII
AssertionError: expected undefined to be 'no-store'
 Tests  1 failed | 69 passed (70)
```
Characterization tests were added in the same commit, and passed: skipped verification types, the reference-id filter in the next link, and a failing hasher.

GREEN (commit `552b74f`): the `onSend` hook. The same commit simplified `onRoute`, which now always uses the dashboard transform. Two further tests (an empty list, and a database failure giving a 500) covered the last uncovered statements:
```
 Tests  72 passed (72)
Statements   : 100% ( 245/245 )
Branches     : 96.39% ( 107/111 )
```

RED (commit `9eae374`):
```
 FAIL  src/next-config.test.ts > next.config > does not advertise the framework
AssertionError: expected undefined to be false
 FAIL  src/next-config.test.ts > next.config > sends the console security headers on /login  (and /inquiries, /inquiries/:id, /files/x/content)
 Tests  5 failed | 2 passed (7)
```
GREEN (commit `d265396`): `Tests  7 passed (7)`.

### Refactor (commit `20869fb`)

The refactor extracted `Detail` (a `dt`/`dd` pair, duplicated in the card and the detail page) and `LINK_CLASS` (used by four components). The five hand-written `next/headers` mocks were replaced with one shared fake, `src/testing/fake-request.ts`. Declaration emit needed explicit `Mock` types (TS2883). Results: `Tests 188 passed`, typecheck, lint and `next build` clean.

### Cycle 6: the image proxy hang (found by the browser smoke test)

RED (commit `c1d1bf8`). The test gives the handler one branch of a `tee()` and holds the other, as Next's `dedupe-fetch` does:
```
 × answers a 401 promptly even when the body is one branch of a tee, as Next.js fetch returns it 2017ms
 × answers a 404 promptly ... 2009ms
 × answers a 500 promptly ... 2009ms
Error: the handler hung on the error body
 × still answers when draining the error body fails
Error: connection reset
```
GREEN (commit `2838a96`): `Tests 13 passed (13)`. Against the real server, an image request with a revoked cookie went from hanging (curl exit 52 when the server stopped) to `401 in 0.34s`.

### Cycle 7: OpenAPI consistency with api-http

api-http's `app.ts` now names contract schemas as components (`openApiComponents`) and documents errors with `problemResponses(...)`.

RED (commit `dce5dd3`):
```
 FAIL  ... > OpenAPI > references the shared contract components and documents problem+json errors
AssertionError: expected '{"description":"Default Response","co…' to contain '#/components/schemas/Inquiry'
```
GREEN (commit `da8e7e7`):
```
 Tests  73 passed (73)
Statements   : 100% ( 252/252 )
Branches     : 95.72% ( 112/117 )
```
The custom registry dropped the global-registry `.meta()` of the image schema, so the transform now documents `image/*` content as a binary string itself.

## Smoke test (real API, real Next.js, real browser)

This used the real `buildApp` and `dashboardRoutes` on an in-memory PGlite database, from a script in the session scratchpad (not committed). It had one synthetic operator (real Argon2id) and a synthetic failed inquiry with two solid-colour PNGs, envelope-encrypted. The dashboard ran as `next start` (production build) with `OPENVERIFY_API_URL` pointing at it, and Chrome was driven through DevTools.

- **API with curl.**
  - login gave `201`, `cache-control: no-store` and a 47-character `ovu_` token; a wrong password gave `401`;
  - the list (`page[size]=1`) returned a `links.next` with the cursor;
  - file content gave `200 image/png`, `private, no-store`, and decoded as `PNG image data, 240 x 150`;
  - `/openapi.json` listed the six dashboard paths and the schemes `apiKey` and `userSession`.
- **Without a cookie.** `/inquiries` and `/files/...` answered `307` to `/login`. The security headers were present, without `X-Powered-By`.
- **In the browser.**
  1. A wrong password showed "The email or password is incorrect." with the email kept.
  2. The right password went to `/inquiries`. The login action's response carried `set-cookie: openverify_session=ovu_…; Path=/; Expires=<+12 h>; HttpOnly; SameSite=lax`.
  3. `document.cookie` was `""`, the Cookie Store API listed nothing, and the HTML did not contain `ovu_`.
  4. Filtering to Failed went to `/inquiries?status=failed`.
  5. The detail page showed the fields, the Government ID card with country and ID class, the checks (`id_glare_detection` Failed `glare_present`), and both images loaded (240 by 150) through `/files/:id/content` with `private, no-store` and `nosniff`.
  6. Sign out went to `/login`, and the API then answered `401` for that token. The BFF redirects a stale cookie to `/login`.
- **Image route.** An unknown file answered `404 in 0.02s`. The proxied bytes are identical to the API's decrypted file (`cmp`).

## Final verification (shared tree, 2026-10-20)

```
$ pnpm --filter @openverify/dashboard test
 Test Files  23 passed (23)
      Tests  192 passed (192)
Statements   : 97.61% ( 287/294 )
Branches     : 94.76% ( 199/210 )
Functions    : 100% ( 95/95 )
Lines        : 97.56% ( 280/287 )
$ pnpm --filter @openverify/dashboard typecheck   # exit 0
$ pnpm --filter @openverify/dashboard lint        # exit 0
$ pnpm --filter @openverify/dashboard build       # exit 0 (see cycle 4)

$ pnpm --filter @openverify/api typecheck   # exit 0
$ pnpm --filter @openverify/api lint        # exit 0
$ pnpm --filter @openverify/api test
 Tests  1 failed | 806 passed (807)
 FAIL  src/openapi.test.ts > OpenAPI document > matches the committed snapshot
```
The snapshot failure is expected. `docs/api/openapi.json` belongs to api-http, and cycle 7 changes exactly the six dashboard paths; components and every other path are unchanged (checked by rendering the document into the scratchpad and diffing it). Regenerate it with `pnpm --filter @openverify/api openapi:write`. With that test excluded:
```
$ pnpm exec vitest run --exclude src/openapi.test.ts   # apps/api
 Test Files  40 passed (40)
      Tests  805 passed (805)
Statements   : 97.51% ( 1609/1650 )
Branches     : 91.36% ( 857/938 )
```
In one full-suite run the same snapshot test also hit its 5 s default timeout under load (the suite includes real Argon2id hashing); alone it passes in about 2 s.
