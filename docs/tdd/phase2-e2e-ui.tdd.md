# TDD evidence: Phase 2, Workflow 2C, e2e-ui-integration (Stage 3)

Scope: wire the six 2C areas together and make the whole workspace green; close the API gaps the
Stage 1 and 2 agents reported where a clean fix exists; the Workflow 2B carry-overs F026, F027
and F035; CI (the e2e job's name, the unit-test headroom); `docs/PROGRESS.md`; the full validation
list of `docs/plans/phase-2.plan.md`.

Every command ran from the repository root after `source scripts/env.sh`, unless it says
otherwise. Output is abbreviated with `…`. No other agent was running during this stage.

## Baseline (before any change)

```
$ pnpm install --frozen-lockfile
✓ Lockfile passes supply-chain policies (738 entries in 3.2s)
Lockfile is up to date, resolution step is skipped
$ pnpm lint; pnpm typecheck; pnpm format:check
lint exit 0 · typecheck exit 0 · All matched files use Prettier code style!
$ /usr/bin/time -v pnpm turbo run test --force
 Tasks:    12 successful, 12 total
  Time:    4m36.288s
	User time (seconds): 2717.37
	System time (seconds): 319.79
```

Every package passed its 80% gate (dashboard 1,270 tests at 98.42 / 94.28 / 98.76 / 98.44, api
1,985 at 97.53 / 90.09 / 98.32 / 97.59).

## Slice 1: the organization's environments in `GET /dashboard/me` (spec 8)

dashboard-shell and dashboard-operators both reported it: no route named the organization's
environments, so the header switcher could not learn the production environment's id, and the
developer half of C24 spec 8 ran as an expected failure (`test.fail`). `listEnvironments` already
existed in `@openverify/db` ("C15 environment switcher"); the route never used it.

### RED (commit `28a4bf0`)

The contract test, the API route test, and spec 8 without its `test.fail` line:

```
$ pnpm --filter @openverify/contracts exec vitest run src/dashboard-api.test.ts --coverage.enabled=false
     × lists the organization’s environments with /me, for the switcher (Workflow 2C) 34ms
ZodError: [ … unrecognized key "environments" … ]
      Tests  1 failed | 15 passed (16)
$ pnpm --filter @openverify/api exec vitest run src/routes/dashboard/environment.test.ts --coverage.enabled=false
     × lists every environment of the organization, oldest first, and no other organization’s 1276ms
     × lists the sandbox alone when the organization has no production environment 366ms
AssertionError: expected undefined to deeply equal [ { …(2) }, { …(2) } ]
      Tests  2 failed | 4 passed (6)
```

### GREEN (commit `8e3c807`)

`dashboardSessionContextSchema` gains an optional `environments` (min 1), and `GET /me` sends
every environment of the organization. One existing assertion of the exact `meta`
(`sessions-mfa.test.ts`) gained the new member. The OpenAPI snapshot was regenerated.

```
$ pnpm --filter @openverify/contracts exec vitest run src/dashboard-api.test.ts --coverage.enabled=false
      Tests  16 passed (16)
$ pnpm --filter @openverify/api exec vitest run src/routes/dashboard --coverage.enabled=false
 Test Files  11 passed (11)
      Tests  112 passed (112)
```

### Refactor (commit `40e7bc2`)

The dashboard read `meta.environments` through a local extension of the strict schema; it now
uses the contract schema, and the README's API-gap entry is gone.

```
$ (cd apps/dashboard && pnpm exec vitest run src/lib/api/me.test.ts src/components/console-layout.test.tsx \
    src/components/environment-switcher.test.tsx --coverage.enabled=false)
 Test Files  3 passed (3)
      Tests  26 passed (26)
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && \
    pnpm --filter @openverify/e2e exec playwright test tests/ui-operators.spec.ts'
  ✓  1 … › an admin invites a user, who accepts by email and signs in with the given role (4.7s)
  ✓  2 … › a developer switches to production in the header, and the banner changes (831ms)
  ✓  3 … › a reviewer is offered no production, and the API refuses a switch to it (613ms)
  3 passed (39.6s)
```

Spec 8's developer half is now a real pass, not an expected failure.

## Slice 2: the C12 platform behaviour in the OpenAPI document (2B F026, F027)

### RED (commit `d2dc5e3`)

`apps/api/src/openapi.test.ts` reads the served `/openapi.json` and follows `$ref`s:

```
$ pnpm --filter @openverify/api exec vitest run src/openapi.test.ts --coverage.enabled=false
     × declares the optional OpenVerify-Version request header, naming the versions
     × declares Idempotency-Key on POST and PATCH only, with the idempotency problems
     × declares OpenVerify-Version and the RateLimit headers on every response
     × declares 429 rate-limited with Retry-After, and 400 for an unsupported version
     × names each problem type it documents
     × documents the 503 of a redaction that could not delete every file
     × documents 410 redacted on every route that refuses a redacted inquiry
AssertionError: POST /api/v1/inquiry-templates: expected undefined to match object { in: 'header', required: false }
AssertionError: /api/v1/inquiries/{id}/redact: expected false to be true
AssertionError: POST /api/v1/inquiries/{id}/resume: expected false to be true
      Tests  7 failed | 4 passed (11)
```

### GREEN (commit `ecd0b95`)

`apps/api/src/plugins/openapi-platform.ts`: the route transform marks each server API operation
(the routes the platform plugins treat as server API: not `public`, `auth` `api-key`), and the
document transform replaces each mark with references to new shared `components.parameters`,
`components.headers` and `components.responses`. Flow, dashboard and system operations are left
alone. F027: `POST /inquiries/{id}/redact` documents its 503. That route never answers 410 (a
second redaction answers 200), so 410 is documented on the routes that do answer it: `resume`,
`generate-one-time-link`, and the flow's consent, verification, file and submit writes.

```
$ pnpm --filter @openverify/api openapi:write
      Tests  11 passed (11)
 docs/api/openapi.json | 3036 +++++++++++++++++++++++++++++++++++++++++++++---
$ python3 (every $ref of docs/api/openapi.json resolves)
refs 39 unresolved []
$ (cd apps/api && pnpm exec vitest run src/openapi.test.ts src/app.test.ts src/routes/flow 'src/routes/server/inquir*' src/plugins --coverage.enabled=false)
 Test Files  17 passed (17)
      Tests  454 passed (454)
```

ESLint found three problems on the first GREEN (two unused destructured names, an unsafe spread
of `any`, then a dynamic `delete`); each was rewritten before the commit.

A coverage test for the transform's edge cases followed (commit `5daf9bf`, passed at once):

```
$ (cd apps/api && pnpm exec vitest run src/plugins/openapi-platform.test.ts src/openapi.test.ts \
    --coverage.include='src/plugins/openapi-platform.ts' --coverage.reporter=text)
All files          |     100 |    97.77 |     100 |     100 |
```

## Slice 3: a lost idempotency lease is logged (2B F035)

### RED (commit `57639fc`)

```
$ (cd apps/api && pnpm exec vitest run src/plugins/idempotency.test.ts --coverage.enabled=false)
     × warns, without the key or the body, when its lease ended before the answer was stored (2B F035)
AssertionError: expected [] to deeply equal [ ObjectContaining{…}, …(1) ]
      Tests  1 failed | 24 passed (25)
```

### GREEN (commit `29959d4`)

When `complete` or `release` reports `false` (the lease ended and another request may hold the
key), the plugin warns with the key's row id only: the key is the client's text and the body may
hold PII.

```
$ (cd apps/api && pnpm exec vitest run src/plugins/idempotency.test.ts --coverage.enabled=false)
      Tests  25 passed (25)
```

## Slice 4: every C23 page is reachable from the navigation

Acceptance spec `e2e/tests/ui-navigation.spec.ts` (commit `7e6389c`): an admin follows each of
the twelve navigation links, opens the first row's detail page where the list has one (an
inquiry, a webhook and an API key are created first), and opens the Security page; a viewer is
not offered API logs or audit logs, and opening them shows the inline forbidden panel. Every
C23 route already existed, so it passed on its first run, the first whole-suite run of this
stage (`flock /tmp/openverify-e2e.lock pnpm e2e`: 19 mocked flow specs, then 33 full-stack
tests, all passed in 2.4 min, none an expected failure):

```
  ✓  24 … › an admin reaches every C23 page and its detail page from the console navigation (9.2s)
  ✓  25 … › a viewer is not offered the pages its role cannot read, and opening one says so (922ms)
```

Checking the audit-log entry page's resource links against the routes found one gap: entries
about an API key (`resource-type` `api-key`, audited by the API on create, update, clone and
expire) did not link `/api-keys/[id]`.

```
$ (cd apps/dashboard && pnpm exec vitest run 'src/app/audit-logs/[id]/page.test.tsx' --coverage.enabled=false)
     × links an API key resource to its page 74ms
TestingLibraryElementError: Unable to find an accessible element with the role "link" and name "key_01J9ZK3M5Q7R8S9T0V1W2X3Y90"
      Tests  1 failed | 6 passed (7)          # RED, commit 654882a
      Tests  7 passed (7)                     # GREEN, commit 82f6933
```

## Slice 5: CI

### RED (commit `da819b4`)

`infra/tests/ci-workflow.test.sh` requires the e2e job to run the whole suite unfiltered (the C24
UI specs live in `e2e/tests/ui-*.spec.ts`) and its name to stop saying "the full Phase 1 stack":

```
$ bash infra/tests/ci-workflow.test.sh
FAIL - e2e: the job name covers the dashboard UI specs, not only the Phase 1 stack (e2e (mocked flow suite and the full Phase 1 stack in Chromium))
# 102 passed, 1 failed, 0 skipped
```

### GREEN (commit `b8ecd9d`)

```
$ bash infra/tests/ci-workflow.test.sh
ok   - actionlint 1.7.12 reports no problems
# 103 passed, 0 failed, 0 skipped
```

### Unit-test headroom

On `main` before 2C (run 39453307034) the node job took 12 min 32 s, its unit-test step
9 min 19 s. The same `pnpm turbo run test --force` was timed on this machine (12 CPUs) at the
pre-2C commit `1963c04` (a `git archive` copy in the scratchpad) and at the current tree:

| Tree | Wall | CPU (user + sys) |
|---|---|---|
| `1963c04` (main before 2C) | 4 min 13.7 s | 2,380 s |
| 2C, before this stage's changes | 4 min 36.5 s | 3,037 s |

The dashboard's unit tests alone take 531 CPU-seconds now. The suite needs about 28% more CPU,
so the CI step should take about 12 min (9 min 19 s × 1.28), under the plan's 14-minute
threshold: the api tests stay in the node job, and `ci.yml` records the measurement next to the
step. The job then has about 5 minutes of its 20-minute limit to spare.

## Slice 6: which users have MFA (`mfa-enabled`, the users list)

dashboard-operators reported it as a blocker: the user resource carried no MFA state, so the
C23 users list had no MFA column.

### RED (commit `513864c`)

```
$ pnpm --filter @openverify/contracts exec vitest run src/users.test.ts --coverage.enabled=false
     × say whether the user has an active MFA factor (Workflow 2C users list) 6ms
ZodError: [ … unrecognized key "mfa-enabled" … ]
      Tests  1 failed | 9 passed (10)
$ pnpm --filter @openverify/api exec vitest run src/routes/dashboard/users.test.ts --coverage.enabled=false
     × says which users have an active MFA factor; an unconfirmed one does not count (Workflow 2C) 118ms
-   "usr_01M5DA7Y1JZC6S2101GFDMY7TR": true,
+   "usr_01M5DA7Y1JZC6S2101GFDMY7TR": undefined,
      Tests  1 failed | 15 passed (16)
$ (cd apps/dashboard && pnpm exec vitest run src/app/users/page.test.tsx --coverage.enabled=false)
     × shows whether each user has MFA on, and a dash when the API does not say 217ms
TestingLibraryElementError: Unable to find an accessible element with the role "columnheader" and name "MFA"
      Tests  1 failed | 15 passed (16)
```

### GREEN (commit `d77d656`)

An optional `mfa-enabled` user attribute; `GET /dashboard/users` reads the confirmed factors of
the page's users in one query; `/users` shows an MFA column ("On", "Off", or a dash when an
older API sends nothing).

```
      Tests  10 passed (10)                  # contracts users.test.ts
      Tests  16 passed (16)                  # api users.test.ts
 Test Files  12 passed (12)
      Tests  77 passed (77)                  # dashboard src/app/users src/components/operators
```

## Slice 7: refactor

`lib/dashboard-api.ts` kept `listInquiries`, `getInquiry` and `INQUIRY_PAGE_SIZE`, used only by
their own tests since dashboard-lifecycle moved the pages to `lib/api/inquiries.ts`; they and
their tests were removed (commit `ae872fa`). `fetchFileContent` stays.

```
$ (cd apps/dashboard && pnpm exec vitest run src/lib/dashboard-api.test.ts src/app/files --coverage.enabled=false)
 Test Files  2 passed (2)
      Tests  17 passed (17)
```

## Slice 8: the compose `app` profile, live (dashboard-shell's follow-up)

The dashboard-shell agent changed the compose dashboard to run `server.ts` but could only run the
static compose checks. The profile was brought up under a throwaway project, with an env file of
random secrets in the scratchpad (never committed), then seeded and driven in Chromium:

```
$ docker compose -p openverify-2c-live -f infra/docker-compose.yml --env-file <scratch>/live.env \
    --profile app up -d --wait --build
 Container openverify-2c-live-api-1 Healthy
 Container openverify-2c-live-objectstore-init-1 Exited
 Container openverify-2c-live-migrate-1 Exited
 Container openverify-2c-live-dashboard-1 Healthy
exit 0                                        # every long-running service healthy
$ docker compose … --profile app run --rm migrate pnpm --filter @openverify/api seed:dev
db:migrate: migrations applied
OpenVerify dev seed: created a new organization.
  environment   env_… (sandbox)
  environment   env_… (production)
$ docker logs openverify-2c-live-dashboard-1
OpenVerify dashboard listening on http://0.0.0.0:3000
$ node <scratch>/probe.mjs <scratch>/live.env   # Playwright: sign in as the seeded developer
signed in at /inquiries | banner: SandboxTest data only. Nothing here reaches production.
after the switch | banner: ProductionLive data.
webhooks page heading: Webhooks
$ docker compose -p openverify-2c-live … down -v; docker rmi openverify/apps:dev openverify/vision:dev
```

The project, its volumes and the two images it built were removed afterwards; neither image
existed before the check.

## Validation, pass 1 (HEAD `aa179ad`)

The plan's list in order (`pnpm lint`, `typecheck` and `test` with `--force`, so nothing came
from turbo's cache):

| Step | Result |
|---|---|
| install, lint, typecheck, format | exit 0 (60 s, 32 s, 20 s) |
| `pnpm test --force` | **exit 1**: `@openverify/dashboard` 1 failed, 1,263 passed (see slice 9); every other package passed |
| `pnpm test:integration` | db 37, api 32 (37 s) |
| vision | 446 passed, 100% coverage |
| android | 440 tests (sdk 422, demo 18), Kover 97.082%, assemble, lint 0 errors |
| `pnpm e2e` | 19 mocked flow specs; 33 full-stack tests (2.1 min) |
| gitleaks, ci-workflow, check-connected-results, compose static | 524 commits no leaks; 103; 11; 163 |

## Slice 9: a dashboard test that read a refusal before it arrived

Pass 1's only failure, which never happened when the file ran alone:

```
@openverify/dashboard:test:  FAIL  src/components/lifecycle/account-type-form.test.tsx > AccountTypeForm >
    shows the errors by path: the name at its field, the schema in the editor
Error: expect(element).toHaveAccessibleDescription()
Expected element to have accessible description:
  must not contain control characters
Received:
```

The test clicked "Create account type", then `expect(await findByRole('textbox', { name: 'Name' }))
.toHaveAccessibleDescription(…)`. The textbox exists before the answer, so `findByRole` resolves
at once, and on a loaded machine the `useActionState` answer had not rendered yet. Four other
tests use the same shape (`account-inquiries`, `user-roles-button`, `note-editor`, `tag-editor`).
Given the same late answer they still passed, so only this one changed.

### RED (commit `da71154`)

A stub that answers after a macrotask (`src/testing/later.ts`), as a real server action does,
makes the race deterministic:

```
$ (cd apps/dashboard && pnpm exec vitest run src/components/lifecycle/account-type-form.test.tsx \
    src/components/lifecycle/account-inquiries.test.tsx src/components/operators/user-roles-button.test.tsx \
    src/components/lifecycle/note-editor.test.tsx src/components/lifecycle/tag-editor.test.tsx --coverage.enabled=false)
     × shows the errors by path: the name at its field, the schema in the editor 250ms
Expected element to have accessible description:
Received:
 Test Files  1 failed | 4 passed (5)
      Tests  1 failed | 29 passed (30)
```

The four other files were put back as they were; only the failing one keeps the late stub.

### GREEN (commit `33e7fb1`)

The assertion waits for the description (`waitFor`):

```
$ (cd apps/dashboard && for i in 1 2 3; do pnpm exec vitest run src/components/lifecycle/account-type-form.test.tsx --coverage.enabled=false; done)
      Tests  2 passed (2)
      Tests  2 passed (2)
      Tests  2 passed (2)
```

## Slice 10: TOTP enrolment tests that acted before the answer rendered

The second validation pass failed on another dashboard test that passes alone:

```
@openverify/dashboard:test:  FAIL  src/components/totp-enrolment.test.tsx > TotpEnrolment > drops the secret when the operator closes the dialog
Error: expect(element).not.toBeInTheDocument()
expected document not to contain element, found <div … role="dialog" …>
 ❯ src/components/totp-enrolment.test.tsx:124:46
    122|     await userEvent.keyboard('{Escape}');
    124|     expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      Tests  1 failed | 1263 passed (1264)
```

The dialog ignores Escape while the start action runs (`dismissible={!starting && !confirming}`,
which is intended), and the test pressed Escape as soon as "Continue" was clicked.

### RED (commit `c09c4e4`)

With the start answer arriving after a macrotask, every test of the successful path fails, not
only the one seen:

```
$ (cd apps/dashboard && pnpm exec vitest run src/components/totp-enrolment.test.tsx --coverage.enabled=false)
     × names the factor, then shows the QR code and the secret once, with a copy button
     × activates the factor with a code, shows the first recovery codes once, then drops everything
     × confirms with a toast when no recovery codes come back
     × keeps the step open with the problem when the code is refused
     × drops the secret when the operator closes the dialog
TestingLibraryElementError: Unable to find an accessible element with the role "img" and name "QR code for your authenticator app"
TestingLibraryElementError: Unable to find an accessible element with the role "textbox" and name "Authentication code"
Error: expect(element).not.toBeInTheDocument()
      Tests  5 failed | 1 passed (6)
```

### GREEN (commit `c16dc1b`)

The five tests wait for the enrolment step (`beginEnrolment()`: the "Secret key" field) before
acting on it:

```
$ (cd apps/dashboard && for i in 1 2 3; do pnpm exec vitest run src/components/totp-enrolment.test.tsx --coverage.enabled=false; done)
      Tests  6 passed (6)
      Tests  6 passed (6)
      Tests  6 passed (6)
```

## Validation, pass 2 (HEAD `33e7fb1`)

Every step passed except `pnpm test --force`, which failed only on the TOTP test of slice 10
(1 failed, 1,263 passed in `@openverify/dashboard`). Integration db 37 and api 32; vision 446;
Android 440 with Kover 97.082%; `pnpm e2e` 19 mocked and 33 full-stack (2.0 min); gitleaks
526 commits, no leaks; CI contract 103; connected-results 11; compose static 163.

## Looking for more races of the same kind

Both failures were tests that read a server action's answer before it rendered, seen only under
the load of turbo running every package at once. After slice 10, the dashboard suite ran six
more times, three copies at a time on 12 CPUs, to overload the machine more than turbo does:

```
$ (cd apps/dashboard && for round in 1 2; do for i in 1 2 3; do \
    pnpm exec vitest run --coverage.enabled=false --reporter=dot & done; wait; done)
r1-1:  Tests 1264 passed (1264)    r1-2:  Tests 1264 passed (1264)    r1-3:  Tests 1264 passed (1264)
r2-1:  Tests 1264 passed (1264)    r2-2:  Tests 1264 passed (1264)    r2-3:  Tests 1264 passed (1264)
```

## Validation, pass 3: final (HEAD `c16dc1b`, after the last code commit)

The plan's list in order, run by a scratchpad script (`validate.sh`) that logs each step's exit code and time:

```
=== install exit 0 in 0s          $ pnpm install --frozen-lockfile
=== lint exit 0 in 62s            $ pnpm lint --force        Tasks: 12 successful, 12 total · Cached: 0 cached
=== typecheck exit 0 in 32s       $ pnpm typecheck --force   Tasks: 12 successful, 12 total · Cached: 0 cached
=== format exit 0 in 19s          $ pnpm format:check        All matched files use Prettier code style!
=== test exit 0 in 274s           $ pnpm test --force        Tasks: 12 successful, 12 total · Time: 4m33.193s
=== integration exit 0 in 34s     $ pnpm test:integration
=== vision exit 0 in 17s          $ (cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest)
=== android exit 0 in 67s         $ (cd android && ./gradlew testDebugUnitTest koverVerify koverLog assembleDebug lint --rerun-tasks)
=== e2e exit 0 in 139s            $ flock /tmp/openverify-e2e.lock pnpm e2e
=== gitleaks exit 0 in 1s         $ gitleaks git --redact .
=== ci-workflow exit 0 in 6s      $ bash infra/tests/ci-workflow.test.sh
=== check-connected exit 0 in 0s  $ bash infra/tests/check-connected-results.test.sh
=== compose-static exit 0 in 1s   $ bash infra/tests/compose.test.sh --static-only
```

| Package (unit) | Tests | Statements / branches / functions / lines |
|---|---|---|
| api | 2,004 | 97.54 / 90.21 / 98.35 / 97.61 |
| dashboard | 1,264 | 98.42 / 94.3 / 98.77 / 98.44 |
| contracts | 1,186 | 100 / 100 / 100 / 100 |
| db | 563 | 99.12 / 92.21 / 99.36 / 99.08 |
| flow | 490 | 98.73 / 95.61 / 99.23 / 98.8 |
| checks | 455 | 99.81 / 97.85 / 100 / 99.8 |
| core | 399 | 100 / 100 / 100 / 100 |
| node | 199 | 99.06 / 94.44 / 100 / 99.35 |
| flow-spec | 81 | 100 / 100 / 100 / 100 |
| e2e (harness) | 63 | 96.55 / 87.61 / 92.64 / 97.59 |
| ui | 50 | 100 / 97.72 / 100 / 100 |
| config | 44 | 100 / 100 / 100 / 100 |
| **total** | **6,798** | every package at or above 80% on every metric |

```
integration   db  Test Files 4 passed (4) · Tests 37 passed (37)
              api Test Files 10 passed (10) · Tests 32 passed (32)
vision        446 passed in 16.24s · Total coverage: 100.00%
android       openverify-sdk 422 tests, demo-app 18 tests, 0 failures, 0 skipped
              application line coverage: 97.082% · BUILD SUCCESSFUL in 1m 6s
              lint: openverify-sdk 0 errors (10 warnings), demo-app 0 (2), openverify-nfc 0 (1)
e2e           @openverify/flow:e2e:   19 passed (8.5s)
              @openverify/e2e:e2e:   33 passed (2.3m)
gitleaks      526 commits scanned · no leaks found
ci-workflow   ok - actionlint 1.7.12 reports no problems · # 103 passed, 0 failed, 0 skipped
connected     # 11 passed, 0 failed
compose       # 163 passed, 0 failed
```

The Android lint warnings are the pre-existing, deliberate version pins the clients agent
recorded. No spec is skipped or marked as an expected failure (`grep` for `test.fail`,
`test.fixme`, `test.skip`, `it.skip` and `.only(` in every test directory finds nothing).
