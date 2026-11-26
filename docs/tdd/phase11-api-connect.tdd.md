# Phase 11, Workflow 11A Stage 3: api-connect (TDD evidence)

Agent: `api-connect` (family C), beside api-redeem, api-consent, clients-connect, console-connect
and workflow-connect (rule 23: it gates only what it touches). It owns
`apps/api/src/routes/server/connect-{connections,share-tokens}.ts`,
`apps/api/src/routes/dashboard/connect.ts`,
`apps/api/src/services/connect/{connections,share-tokens,peek,cross-tenant,audit,counterparty-events}.ts`,
`apps/api/src/jobs/connect-token-expiry.ts`,
`packages/db/src/repositories/connect-{connections,share-policies,share-tokens}.ts` with their
`*.cross-env.ts` twins, the seed flag, and their tests. Every timing has the 1-minute load average
(`/proc/loadavg`) beside it; no call here needed the e2e, Gradle or device lock.

How a RED was taken: the route files were frozen at 501 by `foundation-11a`. The service and
repository code was written beside the tests; for each RED the route file was put back to its
committed stub (`git show HEAD:<route> > <route>`, the agent's own file), the new tests were run
and seen failing for the intended reason (the route answers 501), the tests were committed alone,
and the built route was put back for the GREEN run. The repositories' signatures the tests import
were committed first (`579a9a330`), so every RED commit typechecks.

## Checkpoint 1 (connections)

- Repositories `579a9a330` (`chore(db)`): the connection, policy and token repositories and their
  cross-env twins, built over the stubs. `eslint` and `tsc --noEmit` of `@openverify/db` exit 0.
- RED `b63223641` (`test(api)`): `pnpm exec vitest run src/services/connect/connections.test.ts
  --coverage.enabled=false` (load 8.53): `Tests 14 failed (14)`, each
  `expected 501 to be <status>` with the body `connect: create connection is not built yet.`.
- RED (activation, `test(api)`, the commit after `579a9a330`): `vitest run
  src/routes/dashboard/connect-activate.test.ts src/routes/dashboard/connect.test.ts` (load 13.14):
  `Tests 6 failed | 2 passed (8)`, each `expected 501 to be 200|403|404|409` (`connect: activate
  connection is not built yet.`). `connect.test.ts`'s frozen case changed minimally: a signed-in
  admin's activation of an unknown connection is now the one 404, not 501.
- GREEN `ce8671981` (`feat(api)`): `vitest run` of the activation tests, `connect.test.ts`,
  `routes/connect-routes.test.ts`, `connections.test.ts`, `cross-tenant.source.test.ts` and
  `value-lists.test.ts` (load 29.23 to 34.56, other agents' suites running): `Test Files 6 passed
  (6)`, `Tests 64 passed (64)`; `src/openapi.test.ts` 15 of 15 (the snapshot is unchanged: no schema
  changed). Two existing tests changed because the behaviour they check changed, minimally:
  `routes/connect-routes.test.ts` (the 501 case now covers only the routes not built yet; the built
  connection routes answer from their service) and `services/connect/cross-tenant.source.test.ts`
  (the entry-point list gains the eight entry points `api-connect` added, and the "each refuses
  until built" assertion is gone).
- Lint: `eslint` over every file of the commit exits 0; `prettier --check --ignore-path=.gitignore`
  over them exits 0.

## Checkpoint 2 (token create)

- Stub `chore(api)` (the commit before the RED): `CONNECT_TOKEN_EXPIRY_BATCH` beside the stub pass,
  so the tests that hold it equal to the queue's `CONNECT_TOKEN_EXPIRY_BATCH_SIZE` typecheck (the
  queue module imports the pass, so the pass cannot import the queue's constant without a cycle).
- RED (`test(api)`, `share-tokens.test.ts`): `vitest run src/services/connect/share-tokens.test.ts
  --coverage.enabled=false` with the committed stub route and stub pass (load 12.62): `Tests 17
  failed | 1 passed (18)`: `expected 501 to be 201` with `connect: create share token is not built
  yet.`, and the reads of `data.id` of those 501 bodies (`Cannot read properties of undefined`); the
  one pass is the batch-size equality.
- First GREEN run (load 17.21): 17 of 18 failed with 500 `invalid_value`: the test seeded a check
  named `id_expired`, which is not a government ID check, so the served verification resource the
  source loader reads (`getVerificationDocument`) refused it. A defect of the test, not of the code:
  the seed was corrected to `id_blur_detection` (in the GREEN commit).
- GREEN `b58c35b56` (`feat(api)`): `share-tokens.test.ts` 18 of 18 (load 10.18); then
  `routes/connect-routes.test.ts`, `connections.test.ts`, `share-tokens.test.ts`,
  `cross-tenant.source.test.ts`, the two activation files and `src/openapi.test.ts` (load 7.13 to
  9.37): `Test Files 7 passed (7)`, `Tests 90 passed (90)`. `routes/connect-routes.test.ts`'s frozen
  501 case now holds only the redeem route (`api-redeem`'s).
- Lint and format: `eslint` and `prettier --check --ignore-path=.gitignore` over every file of the
  commit exit 0.

What checkpoint 2 holds, for `api-redeem`: the token row's status, reasons and times as
`connect-share-tokens.ts` writes them; `createShareTokenInTx` and `expireShareTokenInTx` for
`workflow-connect`'s actions (the step's own transaction); `stageTokenChange` for a token change's
events and audit entries on both sides; `crossTenant.lockInboundShareToken`,
`crossTenant.inboundShareTokenPolicy` and `loadShareSource` (`services/connect/peek.ts`) for the
redemption's synchronous part and its job.

## Checkpoint 3 (peek and cross-tenant)

- The peek's service (`peekShareToken`) and route branch were written with checkpoint 2 and
  committed in its GREEN (`b58c35b56`); this checkpoint's RED was taken with the branch put back to
  `notBuilt('connect: peek')` in the working tree only.
- Stub `chore(api)`: `RedemptionSource` and `SharesTouching` (the shapes the tests read), with
  `readRedemptionSource` and `listSharesTouching` still `notBuilt`; `ShareTokenAuditAction` gains
  `consent-withdrawn` and `source-redacted` (api-consent's `withdrawal.ts` passes the first).
- RED (`test(api)`, `peek.test.ts`): `vitest run src/services/connect/peek.test.ts
  --coverage.enabled=false` (load 19.70): `Tests 8 failed (8)`: `expected 501 to be 200|403|404`
  with `connect: peek is not built yet.`, and `NotImplementedError: connect: readRedemptionSource
  is not built yet.`, `... listSharesTouching is not built yet.`.
- GREEN (`feat(api)`, `cross-tenant.ts`): the same call (load 17.88): `Tests 8 passed (8)`. `eslint`
  over `cross-tenant.ts`, `peek.ts` and `peek.test.ts` exits 0; prettier exits 0.

Every entry point of `cross-tenant.ts` is built: `getInboundShareToken`, `listInboundShareTokens`,
`readPeekSource`, `readRedemptionSource`, `stageCounterpartyEvents`, `appendCounterpartyAudit`,
`expireTokensOnDeactivation`, `expireTokenOnWithdrawal`, `listSharesTouching`,
`connectionOrganizationNames`, `counterpartyEnvironments`, `destinationEnvironmentOfKind`,
`acceptsInboundConnections`, `inboundShareTokenFacts`, `inboundShareTokenPolicy`,
`lockInboundShareToken`, `countPeek`.

## Checkpoint 4 (matrix, limits, seed)

- Matrix and locks (`test(api)`, `authorization-matrix.test.ts`, `authorization-matrix.test-support.ts`,
  `connect-locks.integration.test.ts`): written over the behaviour checkpoints 1 to 3 built, so green
  on their first run; no RED was taken (a test of locks and a matrix of answers the code already
  gives). The contract test (routes on PGlite): `Tests 63 passed (63)` (load 14.24). The
  Testcontainers file (`vitest run --config vitest.integration.config.ts --project api
  src/services/connect/connect-locks.integration.test.ts`, through the heavy slot): first the 9
  race and cross-environment cases, `Tests 9 passed (9)` (load 17.84 to 22.85); then with the 58
  services-driven matrix cases, `Tests 67 passed (67)`, 61.7 s (load 7.14 to 5.96).
- Seed stub `chore(api)` (`bde5ffba6`), RED `99e255ee4` (`test(api)`, `connect-seed.test.ts`):
  `vitest run src/seed/connect-seed.test.ts` (load 7.56): `Tests 3 failed (3)`: `DevSeedUsageError:
  Unknown argument --connect.` and `NotImplementedError: seed:dev --connect is not built yet.` (x2).
- First GREEN run: 2 of 37 failed on `users_password_hash_argon2id`: the test's fake hasher wrote
  `synthetic-hash:...`, which the users table refuses. A defect of the test; the fake now writes an
  Argon2id-shaped value. GREEN `9e9917ba6` (`feat(api)`): `connect-seed.test.ts` and
  `dev-seed.test.ts` (load 6.79): `Tests 37 passed (37)`. `dev-seed.test.ts`'s two parse cases changed
  minimally (the new `connect` member and the usage text).
- Coverage follow-up (`test(api)`, `peek.test.ts`): the merged API run showed `peek.ts` at 67.9% of
  lines (the account, transaction and missing-object branches of the loader); three cases added,
  `Tests 11 passed (11)`.
- Two foundation tests that asserted "a stub until api-connect builds it" changed minimally, each
  found by its suite: `apps/api/src/worker-connect.test.ts` (the sweep worker runs the pass it is
  given) and `packages/db/src/phase11a-connect-tables.test.ts` (the entry declares the functions).

### The end gates (rule 23; heavy calls through `/tmp/openverify-heavy.sh`; every lock wait 0 s, the heavy-slot wait inside the wall time)

| Call | Wall | Load before / after | Result |
|---|---|---|---|
| `pnpm --filter @openverify/api typecheck` | 183 s | 11.74 / 12.49 | rc 0 (an earlier run found one error in `authorization-matrix.test.ts`, fixed) |
| `turbo run lint --force --concurrency=1 --filter=@openverify/api` | 456 s | 12.12 / 14.39 | rc 1: every error in `api-redeem`'s in-progress files (`jobs/connect-redeem/{copy,process}.ts`, `services/connect/{clone,hydrate,redeem}.ts` and their tests, `cloned-results.test.ts`), none in `api-connect`'s; a second run hit its 560 s guard at load 25 |
| `eslint` over every `api-connect` file (26 API files, the db repositories) | 85 s | 25 | rc 0 |
| API unit, 12 blob shards (`--shard=k/12 --reporter=blob`) | 247, 288, 357, 431, 405, 381, 318, 366, 504, 502, 399, 358 s | 14.70 to 34.73 | each writes its blob (a lone shard exits 1 on partial coverage); shards 8 and 9 waited for a heavy slot (exit 75, run again) |
| API merge (`--merge-reports`) | 66 s | 26.74 / 15.87 | rc 1: `Tests 2 failed | 10076 passed (10078)`, 762 files, 93.18% statements, 93.61% lines, 83.41% branches, 95.81% functions. The two: `src/worker-connect.test.ts` (foundation's stub assertion, fixed here and green alone, 4 of 4) and `src/workflows/reference-docs.test.ts` (`docs/workflows/actions.md` lacks `create_share_token` and `expire_share_token`: `workflow-connect`'s, not fixed here) |
| `pnpm --filter @openverify/db exec vitest run --coverage` | 476 s | 21.16 / 23.60 | rc 0: 2,272 tests in 158 files, 89.86% statements and lines (a first run failed the foundation stub assertion, fixed) |
| integration db (`pnpm --filter @openverify/db test:integration`) | 190 s | 21.12 / 30.71 | rc 0: 87 tests, 20 files |
| integration graph | 107 s | 30.17 / 28.42 | rc 0: 13 |
| integration api 1/3 | 200 s | 27.21 / 36.79 | rc 0: 103 in 20 files |
| integration api 2/3 | killed at its 580 s guard (rc 124) at load 35.9 to 38.6 | | split further, as rule 8 says: the api project in six calls |
| integration api 1/6 to 6/6 | 141, 240, 379, 269, 138, 137 s | 21.30 to 41.04 | rc 0 each: 44, 59, 40, 74, 121, 56 (394 in 59 files) |
| `pnpm --filter @openverify/watchlist benchmark:typecheck` / `benchmark:test` | 381 s / 44 s | 25 to 28 | rc 0 / rc 0 (119 tests) |
| `prettier --check --ignore-path=.gitignore` over every `api-connect` file | | | rc 0 |

The whole API suite was not run again after the two fixes (another 12 shards at load 25 to 35 is
about 70 minutes); the files each fix touches were run alone, green.
