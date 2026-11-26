# TDD evidence: Phase 2, Workflow 2C, dashboard-shell (Stage 1)

Scope: contract C21 (dashboard BFF), C22 (dashboard MFA and invitations), the shared dashboard
surface Stage 2 builds on, 2B F029 (`@openverify/node` list filter types), the custom Node server,
and C24 spec 1 (`e2e/tests/ui-mfa.spec.ts`).

Every command ran from the repository root after `source scripts/env.sh`, unless it says otherwise.
Output is abbreviated with `…`.

## Slice 1: 2B F029, the created-at range of `@openverify/node` lists

The list query schemas built by `listQuerySchema()` lose their `filter[created-at-*]` keys in
`z.input` (the range is spread from a union), so the client added the range to every list's
filter type, including `GET /inquiry-templates` and `GET /webhooks`, whose strict queries answer
400 for it.

### RED

```
$ (cd packages/node && pnpm exec tsc --noEmit)
src/client.test.ts(547,9): error TS2578: Unused '@ts-expect-error' directive.
src/client.test.ts(549,9): error TS2578: Unused '@ts-expect-error' directive.
src/client.test.ts(551,9): error TS2578: Unused '@ts-expect-error' directive.

$ (cd packages/node && pnpm exec vitest run src/client.test.ts --coverage.enabled=false)
 ❯ src/client.test.ts:578:53
    578|         await expect(client[group].list({ filter })).rejects.toThrow(
 … OpenVerifyResponseValidationError … "path": ["links"] …   (the request was sent)
 Tests  2 failed | 39 passed (41)
```

### GREEN

`pages()` takes `{ createdAt: false }` for the two lists without a range. Their filter type is
`never` (a list without filters takes none: `Partial<Record<never, …>>` was `{}`, which accepts
any object), and a JavaScript caller that sends the range gets a `TypeError` before the request.

```
$ (cd packages/node && pnpm exec tsc --noEmit)        # no output
$ (cd packages/node && pnpm test)
 Test Files  5 passed (5)
      Tests  190 passed (190)
Statements   : 99.05% ( 316/319 )
Branches     : 93.98% ( 203/216 )
Functions    : 100% ( 69/69 )
Lines        : 99.35% ( 308/310 )
$ (cd packages/node && pnpm lint)                      # no findings
```

## Slice 2: `@openverify/node` answer helpers for endpoints the client has no method for

The dashboard BFF also calls the dashboard API (`/api/v1/dashboard/*`), which the C18 client does
not cover. It must parse those answers and raise errors exactly as the client does (contract
schemas, unknown members dropped per 2B F028, `OpenVerifyApiError` with the problem), so the
transport's two internals are exported: `parseApiAnswer(schema, status, text)` and
`apiErrorOf(response, text)`.

### RED

```
$ (cd packages/node && pnpm exec vitest run src/answers.test.ts src/index.test.ts --coverage.enabled=false)
 FAIL  src/answers.test.ts
Error: Cannot find module './answers.js' imported from …/packages/node/src/answers.test.ts
 FAIL  src/index.test.ts > @openverify/node entry point > exports parseApiAnswer
     × exports apiErrorOf
```

### GREEN

`problemOf`, the F028 tolerance and `parseAnswer` moved from `transport.ts` to `answers.ts`
unchanged; the transport imports them, and the entry point exports `parseApiAnswer` and
`apiErrorOf`.

```
$ (cd packages/node && pnpm exec tsc --noEmit && pnpm lint)   # no findings
$ (cd packages/node && pnpm test)
      Tests  199 passed (199)
Statements   : 99.06% ( 317/320 )
Branches     : 94.44% ( 204/216 )
Functions    : 100% ( 70/70 )
Lines        : 99.35% ( 309/311 )
```

## Slice 3: the BFF core (C21) in `apps/dashboard/src/lib/api/` and `server.ts`

Tests first for: the deployment settings (`OPENVERIFY_DASHBOARD_BFF_TOKEN`,
`OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS`), the peer header the custom server sets, the client
address (spoofed, short and malformed chains, IPv6, IPv4-mapped peers, a forged header without the
custom server), the BFF fetch and request helper, error classification, the per-request client,
`GET /dashboard/me` with permissions, the page guard (`renderPage`), the action runner
(`runAction`, `parseInput`), list URL helpers, and `server.ts` (the header overwrite on a real
socket). `src/testing/api-mock.ts` scripts the API for these and for Stage 2's tests.

### RED

```
$ (cd apps/dashboard && pnpm exec vitest run server.test.ts src/lib/config.test.ts src/lib/list-query.test.ts src/lib/api --coverage.enabled=false)
 FAIL  server.test.ts
Error: Cannot find module './server' imported from …/apps/dashboard/server.test.ts
 FAIL  src/lib/list-query.test.ts
Error: Failed to resolve import "./list-query" from "src/lib/list-query.test.ts". Does the file exist?
 FAIL  src/lib/api/action.test.ts … Cannot find module '/src/lib/api/action'
 FAIL  src/lib/api/client-address.test.ts … Cannot find module '/src/lib/api/client-address'
 FAIL  src/lib/api/client.test.ts … Cannot find module '/src/lib/api/client'
 FAIL  src/lib/api/errors.test.ts … Cannot find module './errors'
 FAIL  src/lib/api/http.test.ts … Cannot find module './http'
 FAIL  src/lib/api/me.test.ts … Cannot find module '/src/lib/api/errors'
 FAIL  src/lib/api/page.test.tsx … Failed to resolve import "./errors"
 FAIL  src/lib/api/peer-address.test.ts … Cannot find module './peer-address'
 FAIL  src/lib/config.test.ts > bffToken (C21) > reads the shared secret …
AssertionError: expected undefined to be 'OPENVERIFY_DASHBOARD_BFF_TOKEN'
TypeError: bffToken is not a function
 FAIL  src/lib/config.test.ts > trustedProxyHops (C21) > defaults to 0 …
 Failed Tests 15
```

### GREEN

`src/lib/config.ts` (`bffToken`, `trustedProxyHops`), `src/lib/api/{peer-address,client-address,http,errors,client,me,page,action}.ts(x)`,
`src/lib/list-query.ts`, `server.ts`, and the two components `renderPage` renders
(`forbidden-panel.tsx`, `page-main.tsx`). One test expectation needed the implementation to read
the request id from the problem body when the `x-request-id` header is absent; that fallback was
added rather than the test changed. Lint asked for three test rewrites (no `any` from
`expect.any`, no void arrow shorthands); no expectation changed.

```
$ (cd apps/dashboard && pnpm exec vitest run server.test.ts src/lib/config.test.ts src/lib/list-query.test.ts src/lib/api --coverage.enabled=false)
 Test Files  11 passed (11)
      Tests  179 passed (179)
$ (cd apps/dashboard && pnpm exec tsc --noEmit && pnpm exec eslint server.ts server.test.ts src/lib src/testing)   # no findings
$ (cd apps/dashboard && node --input-type=module -e "const m = await import('./server.ts'); …")
createRequestListener,parseServerArgs,startDashboardServer { dev: false, hostname: '127.0.0.1', port: 4000 }
```

## Slice 4: shared components (C21, C23)

Tests first for the dialog (focus trap, Escape, focus restore, inert background), confirm dialog,
confirm-then-run button (a server action through `useActionState`, with a toast), one-time secret
dialog with copy button, masked value ("Hidden" with a tooltip, an em dash for missing data), form
field, JSON editor (format, validate, line and column of a syntax error, the API's errors by
path), toasts, problem display, page parts (main, header with breadcrumbs, empty, loading, error,
forbidden panel), submit button and action feedback, `fieldErrorOf`, and a generic `Pagination`
(the test now passes the list's path; the inquiries list keeps the same URLs).

### RED

```
$ (cd apps/dashboard && pnpm exec vitest run src/components src/lib/action-state.test.ts --coverage.enabled=false)
 FAIL  src/components/action-controls.test.tsx
Error: Failed to resolve import "./action-feedback" … Does the file exist?
 FAIL  src/components/confirm-action-button.test.tsx … "./confirm-action-button"
 FAIL  src/components/confirm-dialog.test.tsx … "./confirm-dialog"
 FAIL  src/components/copy-button.test.tsx … "./copy-button"
 FAIL  src/components/dialog.test.tsx … "./dialog"
 FAIL  src/components/form-field.test.tsx … "./form-field"
 FAIL  src/components/json-editor.test.tsx … "./json-editor"
 FAIL  src/components/masked-value.test.tsx … "./masked-value"
 FAIL  src/components/one-time-secret-dialog.test.tsx … "./one-time-secret-dialog"
 FAIL  src/components/page-parts.test.tsx … "./empty-state"
 FAIL  src/components/problem-display.test.tsx … "./problem-display"
 FAIL  src/components/toasts.test.tsx … "./toasts"
 FAIL  src/lib/action-state.test.ts … "./action-state"
 FAIL  src/components/pagination.test.tsx > Pagination > links back to the first page once past it
TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "First page"
 FAIL  src/components/pagination.test.tsx > Pagination > works for any list, with several values of a filter
```

### GREEN

The components, and `src/lib/action-state.ts`: `DisplayProblem`, `ActionResult`, `ActionState`
and `fieldErrorOf` moved out of the server-only `lib/api/` modules (which re-export them), so
client components import them without pulling `@openverify/node` into the browser bundle. The
inquiries list passes its path to the generic `Pagination`; its URLs are unchanged. Lint asked for
`ToastApi.show` as a property (unbound-method) and for braces in three test callbacks.

```
$ (cd apps/dashboard && pnpm exec vitest run src/components src/lib/action-state.test.ts --coverage.enabled=false)
 Test Files  20 passed (20)
      Tests  137 passed (137)
$ (cd apps/dashboard && pnpm exec tsc --noEmit && pnpm exec eslint src/components src/lib)   # no findings
```

## Slice 5: the console chrome, and the Phase 1 pages on the new layer

Tests first for: the navigation (every C23 route, each gated by its permission; the current
section marked), the environment banner and switcher (production only with
`environments:production`; the API names only the current environment today, see "API gaps"),
the console layout (banner, header, navigation, skip link; no navigation before MFA), the
`switchEnvironment` action, the session API functions (`lib/api/sessions.ts`: login with the
operator's address and never a client-chosen `X-Forwarded-For`, 202 MFA challenges, MFA and
WebAuthn login, logout, invitations), the home page (the first page the role allows), the root
not-found and error UI, and the proxy letting `/login/mfa` and `/accept-invitation` through.

Phase 1 tests changed only where the plan changes the behaviour (C21):
- `dashboard-api.test.ts`, `auth.test.ts`, `session.test.ts`: the session token and the client
  address come from the request (the BFF headers replace the forwarded `X-Forwarded-For`), and
  errors are `@openverify/node` errors; `clientAddress()` and `withSession()` are gone.
- `auth.test.ts`: login lands on `/`, which opens the first page the role allows (`/inquiries`
  for every built-in role).
- the inquiries pages read the session from `GET /dashboard/me` (`renderPage`); new cases for
  the forbidden panel and "Hidden" fields; the layout is the shared console layout.
- the file route also passes 403 (no `pii:view`) and 410 (redacted) through.

### RED

```
$ (cd apps/dashboard && pnpm exec vitest run src/components/{nav-items,nav,environment-banner,environment-switcher,console-layout}.test.ts* src/app src/lib/api/sessions.test.ts src/lib/dashboard-api.test.ts src/lib/session.test.ts src/proxy.test.ts --coverage.enabled=false)
 FAIL  src/app/page.test.tsx … Failed to resolve import "./not-found"
 FAIL  src/components/console-layout.test.tsx … "./console-layout"
 FAIL  src/components/environment-banner.test.tsx … "./environment-banner"
 FAIL  src/components/environment-switcher.test.tsx … "./environment-switcher"
 FAIL  src/components/nav-items.test.ts … "./nav-items"
 FAIL  src/components/nav.test.tsx … "./nav"
 FAIL  src/app/actions/environment.test.ts … Cannot find module '/src/app/actions/environment'
 FAIL  src/app/inquiries/layout.test.tsx … "../../components/console-layout"
 FAIL  src/lib/api/sessions.test.ts … Cannot find module '/src/lib/api/sessions'
 FAIL  src/proxy.test.ts > proxy > lets /login/mfa through without a session …
AssertionError: expected 'http://dashboard.test/login' to be null
 FAIL  src/lib/dashboard-api.test.ts > listInquiries > lists with the session, the filters, the cursor and the BFF headers
TypeError: Cannot destructure property 'status' of 'undefined' as it is undefined.
 FAIL  src/lib/dashboard-api.test.ts > getInquiry > throws for other failures
AssertionError: expected UnauthenticatedError: The dashboard sessi… to match object { status: 401 }
 Failed Tests 27
```

### GREEN

```
$ (cd apps/dashboard && pnpm exec vitest run src/components src/app src/lib src/proxy.test.ts --coverage.enabled=false)
 Test Files  50 passed (50)
      Tests  474 passed (474)
$ (cd apps/dashboard && pnpm typecheck && pnpm lint)
$ next typegen && tsc --noEmit
✓ Types generated successfully
$ eslint .                                     # no findings
```

The login action keeps Phase 1 behaviour here and answers a 202 as "unavailable"; slice 6 adds
the MFA step (C22).

## Slice 6: an isolated build output for the e2e stack

`next build` and `next typegen` share `.next/`. The e2e stack now builds into `.next/e2e`
(`OPENVERIFY_DASHBOARD_DIST_DIR`), with `tsconfig.e2e.json` for that output's generated route
types. Next.js never rewrites either tsconfig, because both `extend` another; `.next/e2e` sits
under the `.next/` that git, ESLint and Prettier already ignore. `start` now runs `server.ts`.

### RED

```
$ (cd apps/dashboard && pnpm exec vitest run src/next-config.test.ts --coverage.enabled=false)
 FAIL  src/next-config.test.ts > buildOutput (an isolated build for the e2e stack) > refuses "build", which has no tsconfig
AssertionError: expected [Function] to throw error including 'OPENVERIFY_DASHBOARD_DIST_DIR must be…' but got '(0 , __vite_ssr_import_2__.buildOutpu…'
 Tests  5 failed | 7 passed (12)
```

### GREEN

```
$ (cd apps/dashboard && pnpm exec vitest run src/next-config.test.ts --coverage.enabled=false)
      Tests  12 passed (12)
$ (cd apps/dashboard && pnpm exec tsc --noEmit -p tsconfig.e2e.json && echo e2e-tsconfig-ok)
e2e-tsconfig-ok
```

### Fix found by the first real build

`next build` prerendered `/` and failed (`OPENVERIFY_API_URL is not set`): the request context
read the API URL before the cookie, so nothing marked the page dynamic. The context now reads the
cookie and headers first.

```
$ flock /tmp/openverify-e2e.lock sh -c 'cd apps/dashboard && OPENVERIFY_DASHBOARD_DIST_DIR=.next/e2e pnpm exec next build'
Error occurred prerendering page "/". …
Error: OPENVERIFY_API_URL is not set: point it at the OpenVerify API, e.g. http://localhost:3000
    at K (src/lib/api/client.ts:43:25)
… (after the fix)
Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /files/[id]/content
├ ƒ /inquiries
├ ƒ /inquiries/[id]
└ ○ /login
```

### Smoke test of the custom server against a stub API (C21)

A stub API recorded the headers the BFF sent. The browser side was `curl` with a session cookie, a
forged `x-openverify-peer-ip: 203.0.113.66` and `x-forwarded-for: 203.0.113.67`.

```
# node server.ts --port <p>   (OPENVERIFY_DASHBOARD_DIST_DIR=.next/e2e)
inquiries: 200
{"url":"/api/v1/dashboard/me","clientIp":"127.0.0.1","bff":"change-me-smoke-bff-token-…","xff":null,"peer":null}
{"url":"/api/v1/dashboard/inquiries?page%5Bsize%5D=25","clientIp":"127.0.0.1","bff":"change-me-…","xff":null,"peer":null}

# pnpm exec next start (no custom server), same forged header
inquiries: 200
{"url":"/api/v1/dashboard/me","clientIp":null,"bff":"change-me-smoke-bff-token-…","xff":null,"peer":null}
```

The address is the socket peer, the forged values never reach the API, `GET /me` runs once per
render, and without `server.ts` no address is sent at all.

## Slice 7: C22, MFA login, account security and invitations

Tests first for:
- the MFA challenge cookie: httpOnly, SameSite=Strict, path `/login`, as long as the `mfa-token`
  lives (5 minutes, the time left on rewrites), with the attempt count;
- the login action answering a 202 with that cookie and `/login/mfa`, never the token in a URL;
- `completeMfa` (TOTP and recovery codes, input validated before the API, attempts counted, the
  fifth wrong code back to `/login?reason=mfa-attempts`, an expired challenge back to sign in);
- the WebAuthn sign-in (options, verification, refused assertions counted), and cancel;
- the login page's reasons, the `/login/mfa` page (only factor types, never the token);
- the `MfaLogin` client component (code and recovery code forms, the WebAuthn ceremony with
  `@simplewebauthn/browser` mocked, every error announced);
- the MFA enrolment API, the QR geometry drawn on the server from `qrcode`, the account security
  actions (2B F002: a session from before the enrolment is sent to sign in again), the page and its
  client components (TOTP with QR, secret and copy, security keys, recovery codes shown once,
  factor removal);
- invitations: the token read from the fragment and the fragment cleared at once, the action
  (`{ token, password, name }`, then sign-in), the page.

### RED

```
$ (cd apps/dashboard && pnpm exec vitest run src/lib/mfa-challenge.test.ts src/lib/qr.test.ts src/lib/api/mfa.test.ts src/app/actions src/app/login src/app/account src/app/accept-invitation src/components/{mfa-login,totp-enrolment,webauthn-enrolment,mfa-factor-table,accept-invitation-form}.test.tsx --coverage.enabled=false)
 FAIL  src/lib/mfa-challenge.test.ts … Cannot find module '/src/lib/mfa-challenge'
 FAIL  src/lib/qr.test.ts … Cannot find module './qr'
 FAIL  src/components/accept-invitation-form.test.tsx … "./accept-invitation-form"
 FAIL  src/components/mfa-factor-table.test.tsx … "./recovery-codes-button"
 FAIL  src/components/mfa-login.test.tsx … "./mfa-login"
 FAIL  src/components/totp-enrolment.test.tsx … "./totp-enrolment"
 FAIL  src/components/webauthn-enrolment.test.tsx … "./webauthn-enrolment"
 FAIL  src/app/accept-invitation/page.test.tsx … "./page"
 FAIL  src/app/actions/account-security.test.ts … '/src/app/actions/account-security'
 FAIL  src/app/actions/auth.test.ts … '/src/lib/mfa-challenge'
 FAIL  src/app/actions/invitations.test.ts … '/src/lib/mfa-challenge'
 FAIL  src/lib/api/mfa.test.ts … '/src/lib/api/mfa'
 FAIL  src/app/account/security/page.test.tsx … "./page"
 FAIL  src/app/login/mfa/page.test.tsx … "../../../lib/mfa-challenge"
 FAIL  src/app/login/page.test.tsx > login page > explains why the operator is back here (mfa-attempts)
TestingLibraryElementError: Unable to find an element with the text: Too many wrong codes. Sign in again.
 Test Files  15 failed | 1 passed (16)
```

### GREEN

`lib/mfa-challenge.ts`, `lib/mfa-login-state.ts`, `lib/mfa-enrolment.ts`, `lib/qr.ts`,
`lib/sign-in.ts`, `lib/api/mfa.ts`; the actions `auth.ts` (MFA step), `account-security.ts`,
`invitations.ts`; the pages `/login` (reasons), `/login/mfa`, `/account/security` (with its
layout, loading and error UI), `/accept-invitation`; the components `mfa-login`,
`totp-enrolment`, `webauthn-enrolment`, `mfa-factor-table`, `recovery-codes-button`,
`recovery-codes-dialog`, `accept-invitation-form`.

Two test expectations met the implementation differently than first written, and both were
settled in the implementation: the invitation form reads a mocked action's `undefined` state
safely (`state?.ok === false`), and `regenerateCodes()` takes no arguments (lint flagged the two
unused ones; the test call changed to match). The invitation form reads the fragment in a
`useState` initializer and renders the form only once hydrated (`useSyncExternalStore`), since
`react-hooks/set-state-in-effect` forbids setting it from an effect.

```
$ (cd apps/dashboard && pnpm test)
 Test Files  66 passed (66)
      Tests  612 passed (612)
Statements   : 96.45% ( 1115/1156 )
Branches     : 93.23% ( 799/857 )
Functions    : 96.79% ( 332/343 )
Lines        : 96.54% ( 1089/1128 )
$ (cd apps/dashboard && pnpm typecheck && pnpm lint)
✓ Types generated successfully
$ eslint .                                     # no findings
```

## Slice 8: compose runs the custom server (C21)

### RED

```
$ infra/tests/compose.test.sh --static-only
FAIL - .env.example declares OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS
FAIL - dashboard runs the custom server, not next start
FAIL - dashboard sends the same BFF token the api checks
FAIL - dashboard reads OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS from the env file
# 159 passed, 4 failed
```

### GREEN

The compose dashboard runs `pnpm --filter @openverify/dashboard exec node server.ts --hostname
0.0.0.0 --port 3000` with `OPENVERIFY_DASHBOARD_BFF_TOKEN` (the API's own) and
`OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS` (default 0). `.env.example` explains that behind Docker's
port publishing the socket peer is the bridge gateway. The image needs no change: Node 22.22 runs
`server.ts` with its built-in type stripping.

```
$ infra/tests/compose.test.sh --static-only
# 163 passed, 0 failed
```

## Slice 9: the e2e stack serves the dashboard through `server.ts` (C21, C24)

### RED

```
$ (cd e2e && pnpm exec vitest run src/env.test.ts src/totp.test.ts --coverage.enabled=false)
 FAIL  src/env.test.ts > generateE2eEnv > serves the dashboard through its custom server from its own build output (C21)
AssertionError: expected undefined to be '.next/e2e' // Object.is equality
 FAIL  src/env.test.ts > generateE2eEnv > opens the dashboard on localhost, the WebAuthn origin, never on an IP address
TypeError: dashboardOrigin is not a function
 FAIL  src/totp.test.ts > totpStep and msUntilNextStep > name the 30 second step of a time, as the API stores the last one used
 Failed Tests 4
```

### GREEN

`e2e/src/env.ts` sets `OPENVERIFY_DASHBOARD_DIST_DIR=.next/e2e` and
`OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS=0` and exports `dashboardOrigin()`; `e2e/src/totp.ts` adds
`totpStep()` and `msUntilNextStep()`. `e2e/setup/stack.ts` builds the dashboard into `.next/e2e`,
starts it with `node server.ts`, and hands specs `http://localhost:<port>` as `dashboardUrl` (the
run's WebAuthn origin).

```
$ (cd e2e && pnpm exec tsc --noEmit && pnpm lint && pnpm test)
      Tests  63 passed (63)
Statements   : 96.55% ( 252/261 )
Branches     : 87.61% ( 92/105 )
Functions    : 92.64% ( 63/68 )
Lines        : 97.59% ( 243/249 )
```

## Slice 10: C24 spec 1 on the full stack

`e2e/tests/support/ui.ts` signs in through the dashboard as each seeded role, with TOTP
(`freshTotpCode` never reuses a step this process used; a code refused as a replay is retried
with the next step's), with a Chromium virtual authenticator (CDP `WebAuthn.enable` and
`WebAuthn.addVirtualAuthenticator`: ctap2, internal, user verification), and creates fresh
operators through an invitation read from Mailpit. `e2e/tests/ui-mfa.spec.ts`: the seeded TOTP
admin signs in with a code (after a wrong one, with the attempts left; the `mfa-token` only in its
httpOnly cookie); an operator adds a security key and signs in with it; another adds an
authenticator app from its QR code and secret and signs in with it.

### First full-stack run (every spec; pnpm forwarded the `--`, so Playwright ran all 22)

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e e2e -- tests/ui-mfa.spec.ts'
[e2e +26.9s] starting vision, API, worker, flow and dashboard
[e2e +30.5s] stack ready; logs in e2e/.artifacts/logs
Running 22 tests using 1 worker
  ✓   1 … tests/accounts.spec.ts … ✓  14 … tests/ui-flow-links.spec.ts …
  ✘  15 [chromium] › tests/ui-mfa.spec.ts:28:1 › an admin enrolled in TOTP signs in through the dashboard with a code (5.0m)
  ✓  16 [chromium] › tests/ui-mfa.spec.ts:65:1 › an operator adds a security key on the security page and signs in with it (3.1s)
  ✓  17 [chromium] › tests/ui-mfa.spec.ts:105:1 › an operator adds an authenticator app from its QR code and secret, then signs in with it (22.7s)
  ✓  18 … webhooks … ✓  20 … reload-between-uploads … ✓  21 … verification-completes … ✓  22 … verification-fails
    Error: locator.fill: Test timeout of 300000ms exceeded.
      - waiting for getByLabel('Authentication code')
  1 failed
  21 passed (6.7m)
```

The failure was the helper, not the dashboard: after the wrong code, its race between "signed in"
and "refused" saw the previous refusal still on screen, retried, and then waited for a code field
the successful first code had already navigated away from. `submitTotpCode` now waits for this
submission's own answer: the console, or a refusal text different from the one shown before.

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-mfa.spec.ts'
  ✓  1 [chromium] › tests/ui-mfa.spec.ts:28:1 › an admin enrolled in TOTP signs in through the dashboard with a code (1.2s)
  ✓  2 [chromium] › tests/ui-mfa.spec.ts:65:1 › an operator adds a security key on the security page and signs in with it (2.9s)
  ✓  3 [chromium] › tests/ui-mfa.spec.ts:105:1 › an operator adds an authenticator app from its QR code and secret, then signs in with it (18.4s)
  3 passed (51.2s)
```

## Final validation

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test'
  ✓  15 [chromium] › tests/ui-mfa.spec.ts:28:1 › an admin enrolled in TOTP signs in through the dashboard with a code (1.1s)
  ✓  16 [chromium] › tests/ui-mfa.spec.ts:65:1 › an operator adds a security key on the security page and signs in with it (3.0s)
  ✓  17 [chromium] › tests/ui-mfa.spec.ts:105:1 › an operator adds an authenticator app from its QR code and secret, then signs in with it (17.5s)
  … the Phase 1, Workflow 2A and clients specs (accounts, inquiry-actions, one-time-links, operators,
    platform-http, redaction-retention, template-versions, ui-flow-links, webhooks,
    reload-between-uploads, verification-completes, verification-fails) all ✓
  22 passed (1.5m)

$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/dashboard build
├ ƒ /
├ ○ /accept-invitation
├ ƒ /account/security
├ ƒ /files/[id]/content
├ ƒ /inquiries
├ ƒ /inquiries/[id]
├ ƒ /login
└ ƒ /login/mfa

$ (cd apps/dashboard && pnpm test && pnpm typecheck && pnpm lint)
 Test Files  66 passed (66)
      Tests  616 passed (616)
Statements   : 96.71% ( 1118/1156 )
Branches     : 93.48% ( 803/859 )
Functions    : 97.37% ( 334/343 )
Lines        : 96.81% ( 1093/1129 )
✓ Types generated successfully                 # eslint: no findings

$ (cd packages/node && pnpm test && pnpm typecheck && pnpm lint)
      Tests  199 passed (199)                  # 99.06% statements, 94.44% branches

$ (cd e2e && pnpm typecheck && pnpm lint && pnpm test)
      Tests  63 passed (63)

$ infra/tests/compose.test.sh --static-only
# 163 passed, 0 failed
```

Not run: the live `--profile app` compose stack (it builds the apps image). The dashboard service's
command, environment and port are checked statically, and Node 22.22 (the image's) runs
`server.ts` directly.
