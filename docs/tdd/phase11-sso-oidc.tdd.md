# Phase 11, Workflow 11B: `sso-oidc` (family A), TDD evidence

C248 (OIDC sign-in for the console), KP11-18 (the Connect activation's step-up for an SSO session), C248.8 (the login hint), the break-glass command and the borrowed edits named for this area. Every command below was run in this session; output is abbreviated to the lines that matter, with `cat /proc/loadavg` beside timings. Stage 2, beside `foundation-11b` and the other Stage 2 agents (rule 24).

## 0. Base and what waits for whom

- Base `cdff9dac8`, start `9e1cb5e9e`; contracts-11b's checkpoints common `031d6f5a6`, A `7c9204b8c`, P `22adefb36`, D `50ff21e54` read first.
- Built first, because it lives only in files this area creates: the in-process OpenID provider, the OIDC core (`apps/api/src/operator-auth/oidc/`), the console's SSO BFF, route handlers and sign-in section, and the borrowed edits that need no 11B table (the login page, the proxy, the request-log test).
- Waits for foundation-11b's checkpoints common and (A) (rule 27): the tables `sso_providers`, `user_sso_identities`, `sso_login_states`, `organizations.slug`, `users.password_login_allowed_until`, the frozen SSO routes at 501, and the metrics registry.

## 1. The in-process OpenID provider (`apps/api/src/test-support/oidc/provider.ts`)

- Stub `66c3b56ab` (interface only, refusing).
- RED `f03d408a5`: `pnpm exec vitest run src/test-support/oidc/provider.test.ts --coverage.enabled=false` (from `apps/api`): `Tests 14 failed (14)`, each `Error: the okta-shaped test provider is not built yet` (and entra, google). Load `8.31 4.91 3.65`.
- GREEN `496c7e484`: the same call: `Tests 14 passed (14)`. `tsc --noEmit` (under `/tmp/openverify-heavy.sh`) exit 0; eslint clean after `--fix` and a refactor that made the layout a constant computed after `listen`.
- What it serves: Okta-shaped (`/oauth2/default`, RFC 9207 `iss` advertised), Entra-shaped (per tenant; `common`/`organizations`/`consumers` keep `{tenantid}` in the issuer and issue under the user's `tid`), Google-shaped (issuer at the origin, `hd` among its claims); keys made per run in RS256, ES256, PS256 or EdDSA; a JWKS; a single-use token endpoint checking the client (`client_secret_basic` or `_post`), the redirect URI and the PKCE `S256` verifier; the browser visit (`authorize`) checking `response_type`, the client, the redirect URI, `openid`, `state`, `nonce` and PKCE; tweaks making the ID token wrong in one named way (`none`, `HS256`, a key outside the JWKS, issuer, audience, nonce, expiry).

## 2. The OIDC core (`apps/api/src/operator-auth/oidc/`)

- Stubs `4ddaa93b3`: `failures.ts` (data and the error class; its test in `binding.test.ts` passes from the start, being data), `issuer.ts`, `claims.ts`, `binding.ts`, `client.ts`.
- RED `2e529c567`: `pnpm exec vitest run src/operator-auth/oidc/ --coverage.enabled=false`: `Tests 34 failed | 1 passed (35)`; the failures are each module's `... is not built yet` (11 from the client, one per pure function). `tsc --noEmit` exit 0.
- GREEN `445007ede`: first run `Tests 4 failed | 31 passed (35)`: the three shapes' flows saw `jwks: 0` and the foreign-key token was accepted. **Finding:** `openid-client` 6.8.8 does not verify the signature of an ID token from the token endpoint by default (OIDC Core 3.1.3.7 lets TLS stand in); C248.4 requires keys only from the issuer's JWKS, so `enableNonRepudiationChecks` is turned on for every configuration. Then `Tests 35 passed (35)`; eslint clean (one `no-deprecated` disable on `allowInsecureRequests`, which is marked deprecated only to stand out and is used outside production only); `tsc --noEmit` exit 0.
- Decisions recorded in code: discovery is read by the platform (not `openid-client`'s `discovery()`), so the document's `issuer` must equal the stored issuer exactly, or the Entra shape's `{tenantid}` template filled by the provider's `tid` pin on the same origin; a multi-tenant issuer (`common`/`organizations`/`consumers` path, the template, or a shared issuer of `SHARED_ISSUERS`) needs a tenant pin before anything else; the algorithms are the document's narrowed to RS256, ES256, PS256 and EdDSA; the library's clock is the injected `Clock` (its `clockSkew`); private and loopback addresses and plain `http` only outside production, and in production a private address only for an issuer in `OPENVERIFY_SSO_PRIVATE_ISSUERS`.

## 3. The console (`apps/dashboard/src/app/(auth)/sso/`)

- SSO BFF: stub `5744f56d2`; RED `b1860ae52` (`Tests 9 failed`, `the SSO BFF is not built yet`); GREEN `94ef0ecd0` (`9 passed`). Dashboard `next typegen && tsc --noEmit` exit 0 (1 m 44 s).
- Route handlers `/sso/<name>/start` and `/sso/callback/<provider>`: stubs `bf67c2d95`; RED `189f44000` (`Tests 10 failed`); GREEN `147aeace7` (`19 passed` with the BFF). The callback answers a 202 with a same-site page that refreshes to `/login/mfa`, because the second-factor cookie is `SameSite=Strict` and a redirect would keep the provider's cross-site navigation chain.
- The sign-in section and `/sso/start`: stubs `4fd5826aa`; RED `91c38898c` (`Tests 6 failed`); GREEN `46ac4e2d1` (`25 passed`).
- Login page (named borrowed edit): RED `72d3cf2ef` (`3 failed | 15 passed`: no section yet); GREEN `3574261ba` (`3 passed`). The failures seen in `src/app/login/` beside it (`session-idle`, `session-absolute`) are another agent's uncommitted RED tests, not this area's.
- Proxy (named borrowed edit): RED `2524a9c28` (`4 failed | 4 passed`); GREEN `3c28a48d7` (`42 passed` with the existing proxy test).

## 4. The request log (verification V13)

- `ae55dd89a`: `src/logger-sso.test.ts`, 3 of 3. No RED: the serializer already logs the route pattern only (amendment 30), so the borrowed edit is this test. **Finding:** a Fastify route parameter cannot hold `-`: `:provider-id` registers a parameter `provider` followed by the literal `-id` (probed: `/x/ssop_01JC` answers 404, `/x/ssop_01JC-id` answers `{provider: 'ssop_01JC'}`), so the frozen `ssoCallbackParamsSchema` (`provider-id`) and `ssoStartParamsSchema` (`organization-slug`) cannot be route parameters as frozen; reported as a contract deviation.

## 5. Settings > Security > Single sign-on (`apps/dashboard/src/app/settings/security/sso/`)

The first run was cut off (the owner's PC restarted at about 14:06 EST); sections 5 to 9 are filled from the commits themselves after the restart. Counts are those the commit records state; the full terminal output of those runs did not survive.

- Stubs `330e178f5` (provider calls, form request, actions, page; synthetic provider fixtures).
- RED `184195def`: 12 of 13 fail, not built (the secret never in the page or the RSC payload, the sign-in name first, a reader sees no form, the actions' document, the code checked first, `step_up_required` at the code field, the sign-in name lower-cased or cleared, `settings:write`).
- GREEN `98c6eaaf5`: 13 of 13. The payload test walks every prop of the tree, since the forms are client components outside `src/components`.
- Settings page link (named borrowed edit of Phase 9's settings page): RED `99455bc06` (2 of 2 fail: no link yet); GREEN `3d54ff8f7`.
- The SSO step-up action (C248.6, KP11-18): stub `a929241d5`; RED `327e053ce` (3 of 3 fail: not built); GREEN `74a40237f` (3 of 3); `02f2ace84` offers the re-authentication beside the code fields.

## 6. The SSO service (`apps/api/src/operator-auth/oidc/service.ts`)

- Stub `829861d0a` (start, step-up, callback over `SsoStore` and `SsoSessionPort`).
- RED `5013bf3af`: 19 of 19 fail, not built. The cases: the start stores a single-use attempt by the binding digest; one `sso_not_configured` for an unknown name, no provider or another organisation; a choice among several; a multi-tenant issuer without its pin; a first verified email linked (audited, mailed), then by subject only, never by email again; a replayed attempt, a missing binding, a swapped provider or state, an attempt past 10 minutes, a missing `email_verified`, an email outside the domains, an unknown or deactivated user, a just-in-time role that gained a forbidden permission, a tenant pin mismatch; the local factor when `amr` falls short under `require-mfa`; the step-up with `prompt=login` and `max_age=0`, refused when stale, for another identity, short of `required-amr`, or for a session that is gone.
- GREEN `53b8bc02b`: 19 of 19. The test user is built over an empty base, so the users row may gain columns.

## 7. The repositories (`packages/db/src/repositories/sso-providers.ts`, `sso-identities.ts`)

- Stubs `da172c82a`; RED `9b9a51da5` on PGlite, 8 of 8 fail, not built; GREEN `ddfa659e1`, 8 of 8. The secret, nonce and verifier are sealed for their rows. The sign-in name is set in a savepoint that answers "taken" on its unique index, so a caller's transaction stays usable. Attempts are consumed by one `UPDATE ... RETURNING` before their expiry. Links use `ON CONFLICT DO NOTHING`. A just-in-time user gets its roles and its link in one transaction. The break-glass grant is used once.
- Borrowed edit of the repositories barrel `6c2702531`.
- They were built on foundation-11b's committed (A) migration (`308ceeb20`), before its checkpoint (A) commit.

## 8. The Postgres store and the provider service

- Store: stub `6b01a096c`; RED `e82e1b5e5` (3 of 3 fail); GREEN `b128ca489` (3 of 3). A just-in-time user gets an Argon2id hash of a secret no one holds, and every organisation-wide audit entry is written in each environment.
- Provider service (`apps/api/src/services/sso-providers.ts`): stub `dd735cdd5`; RED `c8f4f2d2d` (5 of 5 fail); GREEN `f3694a24f` (5 of 5). The test reads the 403 by its problem type, because `PermissionDeniedError` carries no code.

## 9. The break-glass command `user:allow-password`

- Stub `970d726ae`; RED `c7279b20a` (3 of 3 fail: not built).
- GREEN, finished after the restart: the body in `allow-password-command.ts` and the script `scripts/user-allow-password.ts`. The script was reviewed whole after the restart, and was whole. The named borrowed edit of `src/package-scripts.test.ts` moves the command out of the stub list.
  - From `apps/api`: `pnpm exec vitest run src/operator-auth/oidc/allow-password-command.test.ts src/package-scripts.test.ts --coverage.enabled=false` gave `Test Files 2 passed (2)`, `Tests 13 passed (13)` in 17.45 s, at load `2.77 1.86 0.79`.
  - prettier and eslint on the four files: clean.
  - `tsc --noEmit` (heavy slot, 251 s, load `24.95 7.77 2.87`) exit 2. All five errors are in other agents' files: foundation-11b's frozen `routes/dashboard/sso.ts` (3) and `end-sessions.ts` (1), whose plugins return `void` where `FastifyPluginAsyncZod` needs a promise, and ingestion-11b's `watchlists/conditional-policy.test.ts` (1). None is in a file of this area.
  - Committed as `c02b75886`.

## 10. The refusal log and its metric (C248.7, C250.7)

- Stub `b0d90a7ad`.
- RED `7315b724f`: `pnpm exec vitest run src/operator-auth/oidc/refusal-log.test.ts --coverage.enabled=false` gave `Tests 2 failed (2)`, at load `34.41 23.89 12.41`:
  - `expected undefined to match object { kind, unit, ... }` (`sso_sign_in_refused` not registered);
  - `Error: the SSO refusal log is not built yet (sso-oidc)`.
- GREEN `637c9a368`: one entry in `metrics-registry.ts`, a named borrowed edit (rule 20): `sso_sign_in_refused`, a counter without labels. The same call with `src/metrics-registry.test.ts` gave `Test Files 2 passed (2)`, `Tests 8 passed (8)`, at load `38.74 26.72 13.98`. eslint and prettier were clean.

## 11. The password sign-in under SSO: the gate, the hint and the callback's session (C248.4-C248.6, C248.8)

- Stubs `a2f31f3d7`: `oidc/password-gate.ts`, plus a named borrowed edit of `operator-auth.ts` (the `organization` member, and `openSsoSession` and `startSsoMfaChallenge` rejecting).
- RED `12f6668f6`: `pnpm exec vitest run src/operator-auth/oidc/password-gate.test.ts` gave `Tests 6 failed | 1 passed (7)`, at load `9.97 18.93 13.04`:
  - `expected 'usr_…' to be 'usr_…'` (the hint is ignored);
  - `promise resolved "{ kind: 'session', … }" instead of rejecting` (twice: no gate);
  - `expected 2026-11-13T13:00:00.000Z to be null` (the grant was not used);
  - `openSsoSession is not built yet`, `startSsoMfaChallenge is not built yet`.
  - `tsc --noEmit`: no error in these files.
- GREEN `a357a2866`: `password-gate.test.ts` with `operator-auth.test.ts` gave `Test Files 2 passed (2)`, `Tests 49 passed (49)`, at load `2.78 10.24 10.87`.
  - The first `tsc` found `narrowLoginCandidates` typed for `User`, while `listUsersByEmail` returns rows whose `passwordHash` is a string. It is now generic over the candidate. Then `tsc` showed only ingestion-11b's `conditional-policy.test.ts` error. eslint was clean.
- The route, a named borrowed edit of `routes/dashboard/sessions.ts`:
  - RED `f71542246` (`sso-login.test.ts`): `1 failed | 1 passed`, `expected 201 to be 401`. The enforced-provider case already passed through the gate.
  - GREEN `4594880d2`: `2 passed`, with `sessions-mfa.test.ts` beside it (21 passed). The test reads the generic 401 by its status and detail, since `InvalidCredentialsError` carries no code.

## 12. The sign-in name in the settings (C248.8; Stage 1a amendments 10 and 39)

- RED `0fe890c51` (`sso-slug.test.ts`): `Tests 2 failed (2)`, `expected null to be 'synthetic-name-1'` and `expected 200 to be 409`.
- GREEN `e9c54db80`, a named borrowed edit of `services/settings.ts`, with `OrganizationSlugTakenError` in `oidc/failures.ts`. The run of `sso-slug`, `settings`, `settings-11b` and `settings-connect` gave `Test Files 4 passed (4)`, `Tests 39 passed (39)`, at load `5.17 6.35 8.26`.
  - `tsc`: only other agents' errors (`network.integration.test.ts`, `watchlist-opt-in.ts`, `conditional-policy.test.ts`).

## 13. The SSO routes and KP11-18 (C248.3-C248.7, C231.3)

- Waited for foundation-11b's checkpoint A (`288be748f`; the routes' fix `62977eacf`).
- `f3855b431`: a named borrowed edit of `dashboard.test-support.ts`, adding an `sso` option.
- RED `bd6415f2b` (`routes/dashboard/sso.test.ts`): `Tests 6 failed (6)`, each `expected HTTP 200, got 501 … "sso: start is not built yet."` (and `list providers`), at load `3.97 5.07 7.19`.
- GREEN `ec2b55c90`: `sso.test.ts` with `src/operator-auth/oidc/` gave `Test Files 10 passed (10)`, `Tests 75 passed (75)`, at load `6.01 8.78 8.57`.
  - **KP11-18 is proved over the routes.** A session whose ID token fell short of `required-amr` gets 403 `step_up_required` from `POST /dashboard/connect/connections/:id/activate`. `POST /sessions/current/step-up/sso` answers a redirect with `prompt=login` and `max_age=0`, and the step-up's callback answers 200 with `mfa-verified-at` equal to the injected clock. The activation then answers 200. No Connect file changed.
  - Borrowed edits:
    - `routes/dashboard/index.ts` hands the public and session SSO plugins the server API's ports (`admin`).
    - `foundation-11b-a.test.ts`: its two "frozen at 501" SSO cases now read the built answers (rule 12). Its end-sessions case is auth-sessions' and failed only because that route is built.
  - The first `tsc` found the frozen DELETE schema documents no 204, so the handler answers through the untyped reply (a contract deviation).
- One test was added after GREEN: the provider routes after a TOTP step-up (add 201, read 200, change 200, remove 204, then 404, no secret in any body), `6 passed`.

## 14. The races on Postgres 17 (rule 6)

- `e45c9dd0f`: `packages/db/src/sso-races.integration.test.ts`, eight callers on separate connections. From `packages/db`, under a heavy slot: `pnpm exec vitest run --config vitest.integration.config.ts src/sso-races.integration.test.ts` exit 0, `Tests 4 passed (4)`, 35 s, at load `30.31 27.73 21.03` before and `29.84 27.86 21.32` after.
  - It has no RED: the single-statement repositories were built test-first on PGlite (`ddfa659e1`).
  - The first version's link-once case could pass vacuously, because the first user might already have been linked. It now uses a fresh user and expects exactly one link.

## 15. The C16 pass and the attempts (C248.4, amendment 11)

- Stub `92a9356ad`, a named borrowed edit of `services/retention.ts`, `services/retention.test.ts` and `retention-run.test.ts`: the report gains `deletedSsoLoginStates`, at 0.
- RED `fec4083f9` (`oidc/retention.test.ts`): `expected +0 to be 3`. Beside it, the existing `retention.test.ts` and `retention-run.test.ts` passed: `1 failed | 33 passed`.
- GREEN `3122bd4fa`: the batched `deleteExpiredSsoLoginStates(db, before, limit)` and the pass's call with a day's grace. The three files gave `34 passed`, and `sso-repositories.test.ts` `8 passed`. eslint, `tsc` for db (exit 0) and `tsc` for the API (only other agents' errors) were clean of this area's files.

## 16. End gate (rule 24, beside the other Stage 2 agents)

The calls ran at a load of 15 to 46 from the other agents' suites. Each call is listed with its wall time and load; the logs are in the scratchpad's `sso-gate/`.

| Call | Wall | Load before / after | Result |
| --- | --- | --- | --- |
| `turbo typecheck --force` (api, db, dashboard) | 560 s | 37.10 / 22.75 | exit 2: db and dashboard passed; api's only error was ingestion-11b's `watchlists/conditional-policy.test.ts` |
| `tsc --noEmit` (apps/api), again at `3c3112275` | 452 s | 46.49 / 44.22 | **exit 0** |
| lint api (turbo, forced, 4 GB heap) | 1,374 s, with slot waits | 22.71 / 19.30 | **exit 0** |
| lint db | 486 s | 19.64 / 30.97 | **exit 0** |
| lint dashboard | 556 s | 30.97 / 19.24 | **exit 0** |
| `pnpm format:check` | 323 s | 18.60 / n/a | **exit 0**; `prettier --ignore-path=.gitignore` over this area's files under `services/` then found `settings.ts` (fixed, `ee2e4be0c`) |
| db unit (turbo, forced) | 417 s | 20.90 / 29.29 | **exit 0**: 2,339 tests in 164 files, 89.89% statements |
| API unit, first try with K = 12 | shard 1 took 775 s | 39.30 / 37.34 | past the 10-minute cap, so K was doubled in a fresh directory (rule 8) |
| API unit, 24 blob shards | 150 to 399 s each (rc 75 means no free slot, run again) | 11.9 to 43 | each lone shard exits 1 on partial coverage |
| API merge | 539 s | 30.84 / 16.71 | exit 1: 10,761 passed, 11 failed in 840 files; **93.56% statements** |
| dashboard, K = 2 | shard 1: 1,118 s, with a slot wait | 27.99 / 28.44 | past the cap, so K = 4 in a fresh directory |
| dashboard, 4 blob shards and the merge | 574, 710, 784 and 767 s; merge 101 s | 24.9 to 35.9 | **merge exit 0**: 7,092 tests in 619 files, 95.65% statements |
| integration db | 539 s, with a slot wait | 34.65 / 41.29 | **exit 0**: 110 tests in 23 files (with `sso-races.integration.test.ts`) |
| integration graph | 164 s | 38.96 / 31.79 | **exit 0**: 13 tests |
| integration api 1/3 | 514 s | 30.99 / 42.88 | **exit 0**: 121 tests |
| integration api 2/3 | killed at 590 s | 41.08 / 31.34 | past the cap, so the api project was split into 6 |
| integration api 1/6 to 6/6 | 254, 237, 572, 184, 201 and 258 s | 24 to 46 | **each exit 0**: 63 + 58 + 44 + 83 + 62 + 128 = 438 tests in 73 files |

The API merge's 11 failures were all in other agents' paths, which they were building at the time:
- auth-sessions' end-sessions case of `foundation-11b-a.test.ts` (still "frozen at 501" while the route is built);
- ingestion-11b's `watchlists/conditional.test.ts` (9);
- `operator-patterns.test.ts` (1).

None is in a file of this area. Re-run at `3c3112275`, those three files gave `Tests 34 passed`. The whole merge was not re-run.
