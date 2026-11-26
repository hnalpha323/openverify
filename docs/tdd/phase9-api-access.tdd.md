# Phase 9, Workflow 9B, Stage 3: `api-access` (family U)

Environment-scoped permissions, organisation-level permissions, the sign-in environment, grants per
environment and `grantable`, invitations resent, reactivation, the superset and step-up rules, the
console MFA reset, sessions, the users list columns, the audit explorer with its IP index and
retention, and the MFA default (C167.2, C167.3, C168.1-C168.6; reviews P01, P02, F29; V05, V14).
Built on `foundation-9b`'s (U) checkpoint (`f36560ca`, code `360dd3eb`).

Every command ran after `source scripts/env.sh`, from the directory named. Outputs are abbreviated.

## Slice 1: permissions per environment (C167.2)

Stub commit `1c18329e` (`assignmentReaches`, `environmentsEntered`, `setUserRoleAssignments`), RED
`a42d71ef`, GREEN `36d9a833`.

RED (`apps/api`):

```
$ pnpm exec vitest run src/services/access/permissions.test.ts --coverage.enabled=false --maxWorkers=2
 FAIL  ... userPermissionsInEnvironment ... > reads the user's stored assignments ...
Error: setUserRoleAssignments is not built yet
      Tests  6 failed | 4 passed (10)
$ pnpm exec vitest run src/phase9b-access-plumbing.test.ts --coverage.enabled=false --maxWorkers=2
     × keeps an organisation-wide assignment as before, and grants a narrower one only where it reaches (built by api-access)
     × count a role through an organisation-wide assignment or one naming the environment, never another (built by api-access)
AssertionError: expected [] to deeply equal [ 'inquiries:read' ]
AssertionError: expected false to be true // Object.is equality
      Tests  2 failed | 15 passed (17)
```

RED (`packages/db`):

```
$ pnpm exec vitest run src/role-assignments.test.ts src/phase9b-access-tables.test.ts --coverage.enabled=false --maxWorkers=2
     × replaces every assignment with its environments, null meaning every environment
     × counts organisation-wide assignments only, as admin grants nothing narrower
     × reaches an environment through an organisation-wide assignment or one that names it, never another
AssertionError: expected [ false, false ] to deeply equal [ true, false ]
      Tests  3 failed | 11 passed (14)
```

GREEN: the same files, `Tests 14 passed (14)` (db) and, with `src/workflows/publish/publish.test.ts`,
`Tests 66 passed (66)` (api). The promote tests of `publish.test.ts` failed 5 of 5 with 403 once the
target's rights came from stored assignments (their principal named a user with no row); their
`production()` helper now creates the user with an organisation-wide role holding the same
permissions (the plan's behaviour change; listed in the report's contract deviations).

## Slice 2: the sign-in environment and the switch (C167.2, C168.1; review F29)

RED `e35c8813`, GREEN `167b0913`.

RED (`apps/api`):

```
$ pnpm exec vitest run src/operator-auth/operator-auth.test.ts src/routes/dashboard/environment.test.ts --coverage.enabled=false --maxWorkers=2
     × opens production for a user who holds roles in production only (F29)
     × answers 403 no_environment_role, and opens no session, when the user holds no role it may use
     × checks the role only once the second factor passed, and sets mfa_verified_at on that session (C168.1)
     × refuses an environment where the user holds no role with 403 no_environment_role
     × lets a user who holds roles in production only work there, and refuses the sandbox
     × reads environments:production from the target, not from the session's environment
AssertionError: expected 'env_01M6R3SN4JY8XN7RXTQ7HG2K8W' to be 'env_01M6R3SN4WX8KM29ZTET8YG701'
AssertionError: promise resolved "{ kind: 'session', …(4) }" instead of rejecting
AssertionError: expected null to deeply equal 2026-10-20T12:00:30.000Z
      Tests  6 failed | 46 passed (52)
$ pnpm exec vitest run src/services/access/permissions.test.ts ...
     × counts an organisation-wide role whatever it grants, as it reaches every environment
      Tests  1 failed | 10 passed (11)
```

GREEN: `src/operator-auth/ src/routes/dashboard/environment.test.ts src/services/access/`:
`Tests 176 passed (176)`; then `src/routes/dashboard/ src/seed/ src/phase9b-access-plumbing.test.ts`:
`Test Files 39 passed (39), Tests 369 passed (369)`.

Existing tests changed by the plan (my files): `operator-auth.test.ts`'s `operator()` helper and the
defaults test give the operator an organisation-wide role (signing in now needs one); "refuses a
production session to a user without environments:production (2B F003)" moves the session into
production by `setUserSessionEnvironment`, since sign-in no longer opens production without the
right; "resolves a live session token" expects that role's two permissions instead of none.

## Slice 3: grants per environment, `PUT /users/:id/roles`, `grantable` (C167.2, C167.3)

RED `a85de549`, GREEN `cfec9a7c`.

RED:

```
$ pnpm exec vitest run src/routes/dashboard/role-assignments.test.ts src/routes/dashboard/phase9b-access-routes.test.ts --coverage.enabled=false --maxWorkers=2
     × stores each assignment with its environments, answers them, and the session gets only its environment's
     × refuses an organisation-level permission or the admin role in a narrower assignment (422 role_scope_invalid)
     ... (13 in all)
Error: expected HTTP 200, got 501: {"type":"about:blank","title":"Not Implemented","status":501,"detail":"Role assignments per environment are not built yet." ...
      Tests  13 failed | 13 passed (26)
```

The first GREEN run failed two of my RED tests on their own design: the loss test narrowed an
assignment that still named production (the grant check reads every environment named, as C167.2
says, so it answered 403 before the loss was checked), and the last-admin test assigned the
built-in viewer, which holds `users:read` and `roles:read` and so is `role_scope_invalid` in a
narrower assignment. Both tests were rewritten to test what they name (the loss of a role in
production; a custom role in the sandbox), then:

```
$ pnpm exec vitest run src/routes/dashboard/role-assignments.test.ts src/routes/dashboard/phase9b-access-routes.test.ts ...
      Tests  26 passed (26)
$ pnpm exec vitest run src/routes/dashboard/ src/services/access/ src/operator-auth/ src/phase9b-access-plumbing.test.ts src/workflows/publish/ --coverage.enabled=false --maxWorkers=3
 Test Files  51 passed (51)
      Tests  600 passed (600)
```

The built routes keep 501 in their documented problems, so `docs/api/openapi.json` is unchanged
(`src/openapi.test.ts` passes); integration-9b drops it when it regenerates the snapshot.

## Slice 4: organisation settings (C167.2; V14)

RED `c5bbbd4b`, GREEN `3cb9238b`.

```
$ pnpm exec vitest run src/services/access/settings-level.test.ts --coverage.enabled=false --maxWorkers=2
     × refuses require-mfa to a sandbox-only settings:write (403), writing nothing
     × refuses an organisation setting to an actor that is not a user, and accepts environment keys
AssertionError: {"require-mfa":true, ...}: expected 200 to be 403
AssertionError: promise resolved "undefined" instead of rejecting
      Tests  2 failed | 2 passed (4)
GREEN, with the settings route tests:
 Test Files  5 passed (5)
      Tests  57 passed (57)
```

## Slice 5: the step-up and enrolment (C168.1, C168.4; contracts B26)

RED `9b29a10c`, GREEN `34fcb697`.

```
$ pnpm exec vitest run src/routes/dashboard/step-up.test.ts --coverage.enabled=false --maxWorkers=2
     × verifies a TOTP code on the current session, sets mfa_verified_at and answers the window
     ... (6 in all)
Error: expected HTTP 200, got 501: {... "detail":"The step-up is not built yet." ...}
AssertionError: expected [ 501, 501, 501, 501, 501, 501, …(6) ] to include 429
      Tests  6 failed (6)
```

GREEN: `src/routes/dashboard/sessions-mfa.test.ts src/routes/dashboard/step-up.test.ts
src/routes/dashboard/mfa-factors.test.ts src/routes/dashboard/phase9b-access-routes.test.ts`:
`Tests 47 passed (47)`. The broader run (`src/routes/dashboard/ src/operator-auth/ ...`) failed 7
tests: 6 in foundation-9b (W)'s RED commit `f14d1359` (notification preferences and webhook
notifications, not mine; green on the next run) and the 2B F002 test of `sessions-mfa.test.ts`,
whose "stolen" session was opened before the enrolment and is now revoked by it (C168.4). That test
now checks the revocation, then writes an unsatisfied session after the enrolment and keeps its
F002 assertions on it.

## Slice 6: acting on another user (C168.1, C168.3; P02, V05)

RED `54d62b18`, GREEN `f6ce8bca`.

```
$ pnpm exec vitest run src/routes/dashboard/acting-on-users.test.ts --coverage.enabled=false --maxWorkers=2
     × removes the factors and recovery codes, revokes every session, audits everywhere and sends a link-only notice
     × needs the step-up only from an actor with an enrolled factor
     ... (11 in all)
Error: expected HTTP 200, got 501: {... "detail":"The console MFA reset is not built yet." ...}
AssertionError: {"data":{"type":"user", ... "status":"deactivated" ...}}: expected 200 to be 403
      Tests  11 failed (11)
GREEN: acting-on-users, phase9b-access-routes, users: Tests 42 passed (42);
src/routes/dashboard/ src/services/access/ src/operator-auth/ src/seed/: Test Files 54 passed, Tests 561 passed
```

## Slice 7: my sessions and the users list columns (C168.4, C168.5; P20)

RED `956d6f6d`, GREEN `53148be0`.

```
$ pnpm exec vitest run src/routes/dashboard/my-sessions.test.ts --coverage.enabled=false --maxWorkers=2
Error: expected HTTP 200, got 501: {... "detail":"Listing my sessions is not built yet." ...}
AssertionError: expected { …(6) } to match object { 'mfa-enabled': true, …(2) }
      Tests  5 failed (5)
```

The first GREEN run failed two RED tests on their design: the revoke test took the second session
of a list ordered by `created_at DESC, id DESC` whose two rows shared one fixed-clock time (it
picked the current session); it now picks the session that is not current. The last sign-in test
expected the injected clock, but the last sign-in is the audited `user-session.created` entry,
stamped by the database; it now compares with that entry. Then: `Tests 36 passed (36)`.

## Slice 8: the audit explorer, its index, rebuild and retention (C168.6; P23)

Stub `53a5f2ce`, RED `e6f5c410`, GREEN `541d5d04`.

```
$ (packages/db) pnpm exec vitest run src/audit-explorer.test.ts --coverage.enabled=false --maxWorkers=2
      Tests  4 failed (4)
$ (apps/api) pnpm exec vitest run src/routes/dashboard/audit-explorer.test.ts src/services/access/audit-maintenance.test.ts ...
Error: useAuditIpIndexKey is not built yet
      Tests  6 failed | 24 passed (30)
```

GREEN: the db file failed once on its own expectation (`lastId` of a batch shorter than its limit
is `null`, the last batch; the test said "at least the last id"), then `Tests 4 passed (4)`; the API
files with the audit list, retention, blind-index rebuild and OpenAPI tests: `Tests 108 passed
(108)`.

## Slice 9: the MFA default and seed:dev (C168.2; decision 45)

RED `4a1a7243`, GREEN `14e307bc`.

```
$ pnpm exec vitest run src/services/access/mfa-default.test.ts src/seed/dev-seed.test.ts --coverage.enabled=false --maxWorkers=2
     × keeps require-mfa off explicitly and says so, on a reused organization too (C168.2, decision 45)
AssertionError: expected undefined to be false
      Tests  1 failed | 39 passed (40)
GREEN: Tests 60 passed (60)
```

The creation-path test passed in RED: it characterises foundation-9b (U)'s defaults (every path
but the dev seed and the test helpers leaves `requireMfa` out, so the column's `true` applies).

## C178.2 on Postgres, refactors and fixes

- `12ab206d`: `services/access/access.integration.test.ts` (3 tests) passes on the built code and,
  with `roleAssignmentReaches` mutated to stop reading the named environments, fails 1 of 3.
- `1fce4cc0`: the frozen-routes test drops its 501 test (every route built; plan U13).
- `a018e450`: formatting past the `services/` prettierignore pattern (my lines only), lint.
- `df45ec06`: the API unit merge failed 1 of 8,894: `services/users.test.ts` "keeps the SMTP failure
  kind on the 502" answered 403, its inviter holding the permissions only in the call, not through
  a stored assignment (C167.2's grant check reads stored assignments). The inviter now holds the
  admin role organisation-wide.
- `f3a3714f`: the db integration suite failed 2 of 78: `case-pull.integration.test.ts` (R008) read
  100 and 300 rows for 1 and 3 queues. EXPLAIN showed the cause: with `cases.environment_id` inside
  the role subquery, the planner turned the visibility `exists` into a hash join and sorted the
  queue. With the stub predicate the file passed 6 of 6. The pull now passes its environment
  parameter to `templateVisibleTo`, so the subquery stays uncorrelated: 6 of 6 pass.

## Final gates (each read from its exit code)

| Gate | Result | Time | Load |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | exit 0 | 1 s | - |
| `prettier --check` (my files; `--ignore-path=.gitignore` for `services/`) | exit 0 | - | - |
| `turbo run typecheck --force --filter=@openverify/api --filter=@openverify/db` | exit 0, 2 tasks | 124 s | 7.0 to 6.7 |
| `turbo run lint --force --concurrency=1` (api, db; 4 GB heap) | exit 0, 2 tasks | 350 s | 4.4 to 4.9 |
| `turbo run test --force --filter=@openverify/db` | exit 0: 146 files, 2,121 tests, 92.23% statements | 156 s | 4.7 to 10.8 |
| API unit, 6 blob shards (`--maxWorkers=3`) | 281, 354, 280 (re-run 319), 256, 249, 244 s | - | 1.8 to 9.0 |
| API unit merge | exit 0: 656 files, 8,914 tests, 94.37% statements, 84.83% branches | 25 s | 5.6 to 4.5 |
| `pnpm --filter @openverify/db test:integration` | exit 0: 78 tests | 87 s | 3.3 to 14.3 |
| `--project graph` | exit 0: 13 tests (template 20.4 s of 180 s) | 47 s | 12.1 to 7.9 |
| `--project api --shard=1/3`, `2/3`, `3/3` | exit 0: 89, 98, 78 tests | 87, 166, 76 s | 7.4 to 18.7 |

The first merge failed on `users.test.ts` (above). Shard 3, which holds it, was re-run after the fix
into a fresh blob folder with the other five blobs, and that merge is the gate. The six shards ran
while other agents committed, so they are not one tree. The db unit suite and the API shards ran
before `f3a3714f`, the case-pull fix; its own tests (`src/repositories/case*`, 83 tests), lint and
typecheck passed after it.
