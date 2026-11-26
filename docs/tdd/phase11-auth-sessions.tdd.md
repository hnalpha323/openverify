# Phase 11, Workflow 11B, Stage 2: auth-sessions (family A; C245, C246, C247)

Evidence of the test-first work of `auth-sessions`: the commands actually run and their abbreviated
output, with `cat /proc/loadavg` beside each timing. Runs beside foundation-11b and the other Stage 2
agents (rule 24: no e2e gate, no other package's suites).

## 0. Start

- HEAD at start: `50ff21e54` (contracts-11b checkpoint D). foundation-11b had committed nothing yet; its
  uncommitted work was already in the tree (`config.ts`, `login-rate-limiter.ts`'s
  `createSharedLoginRateLimiter` stub, registries), so I touched none of its files before its
  checkpoints (rule 27).
- Work that needed none of foundation-11b's files was done first: C247.3's tests, C245.3's password
  line, the pure pepper functions.

## 1. C247.3 and C245.3 (amendments 4 and 8): characterisation tests, green at first run

`apps/api/src/routes/server/api-keys-scope-bound.test.ts` reads every operation of
`docs/api/openapi.json` whose 2xx answer carries `meta.token` (today `POST /api/v1/api-keys`,
`/{id}/clone`, `/{id}/rotate`), fails "knows every minting route" when one is added without a minter in
its table, and for each: an API-key caller and a user caller lacking a scope get 403 `forbidden`
naming it, a caller holding every scope gets 201. Two more cases build an app over the real
`createUserSessionPrincipalResolver`: a production session holding `environments:production` mints an
`ov_prod_` key; one without it answers 401 and no key is written.

`apps/api/src/operator-auth/password-routes.test.ts` (amendment 4): the operations whose path or
request body names a password are exactly `POST /dashboard/invitations/accept` and
`POST /dashboard/sessions`; a password-change route added later fails it until it ends the user's
sessions.

```
$ cat /proc/loadavg
1.76 1.66 2.55 1/621 1973730
$ pnpm exec vitest run src/routes/server/api-keys-scope-bound.test.ts --coverage.enabled=false
 Tests  4 failed | 8 passed (12)       # first run: the test's own clone body and a page member; fixed in the test
$ pnpm exec vitest run src/routes/server/api-keys-scope-bound.test.ts --coverage.enabled=false
 Tests  12 passed (12)
$ pnpm exec vitest run src/operator-auth/password-routes.test.ts --coverage.enabled=false
 Tests  1 passed (1)
```

No gap: the bound is Phase 9's `ensureCanGrant` on all three routes, so no code changed (C247.3:
"change code only where a test shows a gap"). Commit `9e47e5c6d`.

## 2. C247.1: the pepper id and the lookup's candidates (packages/db/src/api-keys.ts)

Stubs `chore(db): ... C247.1 stub` (two commits: the functions, then `GeneratedApiKey.pepperKeyId`), then RED `bcde6abbf`:

```
$ pnpm exec vitest run src/api-keys.test.ts --coverage.enabled=false   # packages/db
     × is the first 16 hex characters of an HMAC of its label under the pepper
     × answers the current pepper first, then each earlier one in the order given
     × refuses more than 2 earlier peppers
     × names the pepper its hash was made under
Error: apiKeyPepperId is not built yet (auth-sessions).
AssertionError: expected error to be instance of RangeError
      Tests  10 failed | 10 passed (20)
```

GREEN `0d0b3fa7a`: `apiKeyPepperId`, `apiKeyHashCandidates`, `generateApiKey().pepperKeyId`. One RED
case passed three earlier peppers while asserting the two-pepper bound in another case; the case was
corrected to two (the test contradicted the contract), then:

```
$ pnpm exec vitest run src/api-keys.test.ts --coverage.enabled=false   # packages/db
      Tests  20 passed (20)
$ pnpm exec eslint src/api-keys.ts src/api-keys.test.ts                   # exit 0
```

## 3. C246: the Valkey login limiter (apps/api/src/operator-auth/valkey-login-rate-limiter.ts)

foundation-11b's common stub `createSharedLoginRateLimiter({redisUrl, blindIndexKey, clock})` lives
in `login-rate-limiter.ts`; I built the limiter in a file of my own first and wire the stub to it
after foundation's checkpoint.

Stub `chore(api): ... C246 stub`, then RED (16 of 16 fail on the stub):

```
$ cat /proc/loadavg
6.41 8.69 7.95 7/656 2088367
$ pnpm exec vitest run src/operator-auth/valkey-login-rate-limiter.test.ts --coverage.enabled=false
     × is HMAC-SHA-256 of the label under the blind-index key, as the blind index derives its subkeys
     × counts an attempt under the two HMAC key names with C4 limits, so no key holds an address or an email
     × answers 503 login_unavailable with Retry-After when ioredis knows the store is down
     ...
Error: createValkeyLoginRateLimiter is not built yet (auth-sessions; 1 arguments).
      Tests  16 failed (16)
```

GREEN: the script, the key derivation, fail-closed answers. First run 15 of 16: the test asked for
the literal `KEYS[1]` and `KEYS[2]` in the script, which looped over `KEYS[i]`; the script was
rewritten with the two keys named (clearer against the contract), then 16 of 16.

The script against Valkey 9.1 (`valkey-login-rate-limiter.integration.test.ts`, api Testcontainers
project, under the heavy slot):

```
$ cat /proc/loadavg
20.10 15.88 11.43 10/818 2110258
$ bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/operator-auth/valkey-login-rate-limiter.integration.test.ts
      Tests  8 passed (8)          # real 13.5 s
```

It was written after the unit GREEN, so its RED is a mutation run: the script changed to count both
keys before checking (a refused attempt counted), run, then the file restored byte for byte from a
copy (no git restore):

```
     × allows 10 attempts per email in C4 window, refuses the 11th, and counts the refused one against neither key
     × refuses the 51st attempt from one address across many emails, counting none of the refused
     × opens again once the window has passed
     × shares one budget between two limiters on one Valkey, as two API instances do
      Tests  4 failed | 4 passed (8)
```

## 4. C245.2 in the console (borrowed edits: lib/api/errors.ts, app/login/)

`redirectIfSignedOut` sends a 401 `session_expired` with its reason to `/login/signed-out?reason=`,
a route handler that clears the cookie only after the API refuses the session again (a live session
goes home, an unreachable API keeps the cookie: a cross-site link cannot sign anyone out), then shows
`/login?reason=session-idle` ("You were signed out after inactivity. Sign in again.") or
`session-absolute`.

```
$ pnpm exec vitest run src/app/login/signed-out/route.test.ts src/lib/api/errors.test.ts src/app/login/page.test.tsx --coverage.enabled=false
      Tests  11 failed | ... (RED on the 501 stub)
$ (GREEN) pnpm exec vitest run src/app/login src/lib/api/errors.test.ts --coverage.enabled=false
      Tests  59 passed (59)
```

## 5. C245.3 on the team page (borrowed edits: app/users/, lib/api/users.ts, users-table.tsx, lib/copy/settings.ts)

"End the sessions of <user>" for another active user, in a confirm dialog, posting `{}` to
`POST /api/v1/dashboard/users/:id/end-sessions`; never on oneself (the action refuses the
operator's own id in words before calling the API; Account, Sessions keeps Phase 9's
`revoke-others`), nothing without `users:write`.

```
$ pnpm exec vitest run src/app/users --coverage.enabled=false
      Tests  4 failed | 76 passed (80)      # RED on the stubs
$ pnpm exec vitest run src/app/users src/components/operators --coverage.enabled=false
      Tests  224 passed (224)               # GREEN
$ bash /tmp/openverify-heavy.sh pnpm exec tsc --noEmit -p tsconfig.json   # dashboard: no error in my files
```

## 6. C246.2's metric and the other limits' warn line

- `rate_limiter_store_unavailable` registered in `apps/api/src/metrics-registry.ts` (one borrowed
  entry, rule 20): a counter, no label, owner auth-sessions, contract C246.2. RED: the limiter test
  asked `metrics.get(...)` (1 of 17 failed); GREEN with the entry, the login limiter emitting through
  `metrics.emit`.
- The C12 limiter (`apps/api/src/rate-limit/index.ts`, borrowed edit) reports a store that does not
  answer (down, failing or answering off contract) with one warn line naming the policy and the
  metric, then rejects as before, so every caller keeps its rule: the plugin and the route policies
  fail open, `connect-peek` and `account-export` fail closed through `enforceFailClosedPolicy`. RED 3
  of 31 failed on the stub; GREEN 49 of 49 with the plugin's tests.

## 7. The shared limiter wired (createSharedLoginRateLimiter)

After foundation-11b's checkpoint common (`d56b4d196`): `createSharedLoginRateLimiter` builds the
Valkey limiter over its own lazy client of `REDIS_URL` (as the C12 limiter has), closed with the
container; the blind-index key is checked before the client opens. RED 2 of 2 on the in-memory stub
(`attempt` against a closed port resolved instead of rejecting with `LoginUnavailableError`); GREEN
22 of 22 with foundation's stub test file, whose in-memory case was removed as its header asks of
each owner. The container passes no logger, so the limiter logs through its own `openverify-api`
pino logger (recorded as a deviation).

Phase 9's tests already prove the four events it built end every session of the user with an audit
entry, so none is duplicated: deactivation (`routes/dashboard/users.test.ts:354`), the console MFA
reset (`routes/dashboard/acting-on-users.test.ts:117-141`), `user:reset-mfa`
(`operator-auth/reset-mfa-command.test.ts:126-134`) and factor enrolment
(`routes/dashboard/step-up.test.ts:221`).

## 8. C247.1: the lookup, the compare-and-set and api-keys:pepper-status

- `packages/db/src/api-keys.ts`: `findApiKeyByPepperedHashes` (one query over the unique index),
  `moveApiKeyToPepper` (compare-and-set on `(secret_hash, pepper_key_id)`), `countApiKeysByPepper`.
  RED 6 of 6 on the stubs (PGlite); GREEN 6 of 6.
- `apps/api/src/auth/api-key-lookup.ts` (named borrowed edit): `previousPeppers`; a key found under
  an earlier pepper is re-hashed in the same request, a key from before 11B is named on first proof.
  RED 3 of 12; GREEN 12 of 12, and `routes/server/api-keys.test.ts` 50 of 50 beside it.
- The race on Postgres 17 (`auth/api-key-pepper.integration.test.ts`): 20 keys under an earlier
  pepper, each looked up by two requests at once on separate pooled connections: 40 of 40
  authenticate, every row ends under the current pepper with its prefixes, none left under the
  earlier one.

```
$ cat /proc/loadavg
15.41 13.02 10.90 15/835 2303866
$ bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/auth/api-key-pepper.integration.test.ts
      Tests  2 passed (2)        # real 24.6 s
```

- `api-keys:pepper-status` (`src/commands/api-keys-pepper-status.ts` over `scripts/...`): RED 6
  failed (5 in its test, 1 in `package-scripts.test.ts`, which now asserts the built command, rule
  12); GREEN 15 of 15.

## 9. After the restart (continuation run, 2026-11-13)

The first run stopped when the host restarted, after `9123ab7d2` (section 8, the last entry it
wrote; nothing was uncommitted in my paths). Nothing above was redone. foundation-11b's checkpoint
A (`40dcd987c`) landed during this run; everything that touches its (A) hooks waited for it.

### 9.1 RED tests written before checkpoint A (new files of mine)

| Commit      | File                                                      | RED                                                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6fd6899b3` | `routes/dashboard/end-sessions.test.ts`                   | 5 of 7 fail on the 501 stub (`expected HTTP 200, got 501 ... users: end sessions is not built yet`)                                                                                                                 |
| `8a1466bd5` | `routes/dashboard/session-timeouts.test.ts`               | 6 of 7 fail: no limit enforced, every request slides (`expected 12:29:00 to equal 12:00:00`), the expiry answers the generic 401 (`ZodError`), `expires-at` 12 h for a 24 h limit                                   |
| `62a049115` | `routes/dashboard/role-change-sessions.test.ts`           | 1 of 2 fails at `:85` (`expected 200 to be 401`: the production session works again once the role is back)                                                                                                          |
| `650f5fd5c` | `operator-auth/session-policy.integration.test.ts`        | 2 of 2 fail (`expected 12:00:00 to equal 12:29:59`; `expected [ 'admitted', ... ] to equal [ 'idle', ... ]`), 16 s under the heavy slot, load 7.4                                                                   |
| `20e935737` | `operator-auth/login-limit-instances.integration.test.ts` | green at first run (the C246 build); a mutation giving each instance its own in-process limiter fails 2 of 2 (`expected 201 to be 429`, `expected 201 to be 503`), the file then restored byte for byte from a copy |

```
$ cat /proc/loadavg
19.28 17.30 9.16 19/842 116643
$ pnpm exec vitest run src/routes/dashboard/end-sessions.test.ts --coverage.enabled=false     # real 67 s
      Tests  5 failed | 2 passed (7)
$ bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/operator-auth/login-limit-instances.integration.test.ts
      Tests  2 passed (2)      # real 22 s, load 5.3
```

### 9.2 After checkpoint A

- Stub `288be748f` (`SESSION_EXPIRED_DETAIL`, `SessionExpiredError`, `sessionExpiryOf` refusing),
  RED `299351144` (`session-policy.test.ts`: 10 of 12 fail; the commit subject's "of 13" is a
  miscount, the file holds 12 tests):

```
$ cat /proc/loadavg
3.16 7.62 9.80 3/667 414051
$ pnpm exec vitest run src/operator-auth/session-policy.test.ts --coverage.enabled=false
     × answers null inside both limits and idle from 30 minutes without activity
     × refuses an idle session with 401 session_expired, reason idle, ...
     × slides last_seen_at at most once a minute, from the injected clock
     × with cause admin, revokes every live session of the user and nobody else’s, answering how many
Error: sessionExpiryOf is not built yet (auth-sessions; 3 arguments).
AssertionError: promise resolved "undefined" instead of rejecting
AssertionError: expected +0 to be 2 // Object.is equality
      Tests  10 failed | 2 passed (12)
```

- GREEN `a554bf6ab` (`session-policy.ts`): 12 of 12; the Postgres race 2 of 2.
- GREEN `f9de86055` (`end-sessions.ts`): 7 of 7 with `openapi.test.ts` (22 of 22: the OpenAPI
  document unchanged).
- `4133b5f21` (rule 12): `operator-auth.test.ts`'s "rejects a session once it has expired" kept
  its session idle for 12 hours, which now ends at 30 minutes (`SessionExpiredError ... idle` at
  `:339`); it now authenticates every 20 minutes and reads the end at 12 hours as `session_expired`,
  reason `absolute`.
- `f9365ec6f` (borrowed edit of `session-context.ts`, recorded): the query no longer filters
  `expires_at`, so the policy answers a session at its expiry as `absolute`; the resolver test's
  expired case reads that (rule 12).
- `d3e3bc81c` (named borrowed edit, amendment 6): `file-renditions.ts` is `activity: false`.
- `0e8239d99` (borrowed edit of `operator-auth.ts`, recorded): `authenticate` no longer calls
  `touchUserSession`, which slid every request, a poll included; a new session's `expires_at` is
  the configured absolute limit.

```
$ cat /proc/loadavg
4.79 6.31 8.40 3/631 442671
$ pnpm exec vitest run src/operator-auth src/routes/dashboard/session-timeouts.test.ts src/routes/dashboard/sessions.test.ts \
    src/routes/dashboard/step-up.test.ts src/routes/dashboard/file-renditions.test.ts --coverage.enabled=false
 Test Files  25 passed (25)
      Tests  272 passed (272)
```

- `539e17944`: the step-up on an instance without Valkey answers 503 `login_unavailable` with
  `Retry-After: 30` (the default amendment 7 records), green at first run on the C246 build.
- The account page's "end my other sessions" (Phase 9) is held by
  `apps/dashboard/src/app/account/sessions/{actions,page}.test.*`; unchanged.

## 10. End gates (rule 24, beside the other Stage 2 agents)

Every call is one foreground call through a heavy slot (slots 1-3; exit 75 means no free slot, so
the call was run again). Wall times include the wait for the slot. The load stayed between 15 and 48
throughout, so the API suite was run in 24 shards: in 12 shards, shard 3 reached its 570 s bound at
load 34 (exit 124), and the dashboard suite took 4 shards after two 2-shard runs reached their bound.
A first dashboard run (`dash-shard-1`) was started from the repository root by mistake, so it ran
every project; it was stopped and is not counted.

| Call                                                                                     | Result                                                                     | Wall                          | Load     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------- | -------- |
| `pnpm --filter @openverify/api typecheck`                                                | exit 0                                                                     | 344 s                         | 20 to 25 |
| API lint, in three calls (`src/services`; `src/routes src/workflows src/jobs`; the rest) | exit 0, 0, 0 (one `pnpm --filter @openverify/api lint` call reached 580 s) | 385, 386, 391 s               | 20 to 28 |
| API unit, 24 blob shards                                                                 | each exits 1 on its partial coverage alone                                 | 148 to 560 s                  | 15 to 48 |
| API merge                                                                                | 10,766 passed, 8 failed in 840 files; 93.5% statements (exit 1)            | 847 s (no bound on the merge) | 30 to 31 |
| `pnpm --filter @openverify/db typecheck`, `lint`                                         | exit 0, exit 0                                                             | 40, 90 s                      | 4 to 5   |
| db unit, 2 blob shards and a merge                                                       | 2,357 passed in 165 files, 89.88%; merge exit 0                            | 378, 438, 81 s                | 20 to 41 |
| `pnpm --filter @openverify/dashboard typecheck`, `lint`                                  | exit 0, exit 0                                                             | 67, 229 s                     | 4 to 14  |
| dashboard unit, 4 blob shards and a merge                                                | 7,092 passed in 619 files, 95.65%; merge exit 0                            | 526, 352, 390, 459, 20 s      | 19 to 27 |
| integration db                                                                           | 110 passed, exit 0                                                         | 261 s                         | 28 to 33 |
| integration graph                                                                        | 13 passed, exit 0                                                          | 217 s                         | 18 to 31 |
| integration api 1, 2, 3 of 3                                                             | 114 + 1 failed, 133, 193 (exit 1, 0, 0)                                    | 180, 525, 480 s               | 18 to 45 |
| `pnpm format:check`                                                                      | exit 0                                                                     | 616 s                         | 33 to 44 |

The API merge's 8 failures, none in my paths (rule 24): `routes/system-ready.test.ts` (4) and
`http/internal-listener.test.ts` (1), platform-ops' C250 tests while it builds; and
`operator-patterns.test.ts` (2), ingestion-11b's CPU budget (`expected 118.446 to be less than 100`
at load 30 to 38). One more failure was mine: foundation-11b's frozen-route test
`routes/dashboard/foundation-11b-a.test.ts` still asked the end-sessions route for 501; as its owner
I made it read the built route (200 for an admin, 401 without a session; rule 12), and it passes
(9 of 9). The failing integration test, `services/quotas/admission.integration.test.ts` ("admits
exactly the cap when producers race for the last slots"), is quotas'. The 80% gate holds in each
merged report (API 93.5%, db 89.88%, dashboard 95.65%).
