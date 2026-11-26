# TDD evidence: Phase 2, e2e-integration

- **Slice owner:** e2e-integration agent (Workflow 2A, Stage 3, after every Stage 1 and Stage 2 agent finished). Date: 2026-10-20.
- **Owned paths:**
  - `e2e/**`;
  - `apps/api/src/seed/**`, `apps/api/scripts/seed-dev.ts`, `apps/api/src/test-support/**`;
  - `docs/api/openapi.json` (regenerated);
  - `infra/**`, `.github/workflows/ci.yml` and `.github/actions/**`, `.env.example`;
  - `THIRD_PARTY_LICENSES.md`, `docs/PROGRESS.md` (the Workflow 2A entry), this file.
- **Integration fixes in other slices' files** (each test-first, listed in the report):
  - `apps/api/src/storage/index.ts`: deleting a file removes every stored version;
  - `apps/api/src/app.ts`: OpenAPI declares user sessions on server API operations;
  - `apps/api/src/migrate.ts` (new) and `apps/api/scripts/migrate.ts`: the event object-id backfill;
  - `apps/api/scripts/retention-run.ts` (new) and the `retention:run` script in `apps/api/package.json`.

All commands ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown. Outputs are abbreviated to the summary lines and the first lines of each distinct failure.

## Plan task

`docs/plans/phase-2.plan.md`, Stage 3:
1. Wire everything, make the whole workspace green, fix contract mismatches between agents, replace every remaining stub on a production path.
2. Extend the seed: one operator per built-in role, an MFA-enrolled admin, template settings, sandbox and production environments.
3. API-level e2e through `@openverify/node` for the twelve Stage 3 items; the Phase 1 full-stack specs still pass.
4. F009 (pin GitHub Actions to commit SHAs), the new settings in `.env.example` and compose, Mailpit for invitations, and the license records.
5. Run the full validation list.

## Baseline (before any change)

```
$ pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
$ pnpm exec turbo run lint typecheck --force --continue
@openverify/api:typecheck: src/seed/dev-seed.test.ts(268,20): error TS2339: Property 'session' does not exist on type 'LoginOutcome'.
@openverify/api:lint:   268:28  error  Unsafe member access .environmentId on a type that cannot be resolved
 Tasks:    22 successful, 24 total
$ pnpm exec turbo run test --force --continue
@openverify/api:test:  FAIL  src/openapi.test.ts > OpenAPI document > matches the committed snapshot
@openverify/api:test:  FAIL  src/test-support/harness.test.ts > user principals on the server API (C12) > authenticate a user session with the chosen permissions in its environment
@openverify/api:test:  FAIL  src/test-support/harness.test.ts > user principals on the server API (C12) > never see another environment's resources (404)
@openverify/api:test:       Tests  3 failed | 1913 passed (1916)
 Tasks:    11 successful, 12 total     (every other package green)
$ grep -rn NotImplementedError apps/api/src apps/api/scripts --include=*.ts | grep -v .test.ts
apps/api/src/ports.ts:48:export class NotImplementedError extends Error {     (the class only: no stub left on a path)
```

So the starting point was: three failing tests and one typecheck/lint error, all in files this slice owns or regenerates, and no stub left. The container already wires every Phase 2 port to its real implementation.

## RED and GREEN

Every RED state was committed as `test(...)` before its implementation. Commands for `apps/api` ran in `apps/api`.

### 1. The harness resolves inquiry accounts on real rows (`apps/api/src/test-support`)

Every inquiry needs an existing account (C13), but the harness's default `AccountsService` fake wrote no rows, so a test that created an inquiry through the API got 404.

RED (`3d63b8a`):
```
$ pnpm exec vitest run src/test-support/fakes.test.ts src/test-support/harness.test.ts --coverage.enabled=false
     × resolves accounts on the account rows in the C13 order and records every call
     × answers 404 for an account id that is not in the environment
     × authenticate a user session with the chosen permissions in its environment
     × never see another environment's resources (404)
TypeError: createRecordingDbAccountsService is not a function   (x2)
Error: expected HTTP 201, got 404: {..."detail":"Account acc_01M5CNYJB6CBMTBDAAW1198XWY was not found."...}  (x2)
 Test Files  2 failed (2)
      Tests  4 failed | 22 passed (26)
```
GREEN (`d3a040a`): `createRecordingDbAccountsService` records calls like the fake and resolves with `resolveInquiryAccount`; it is the harness default.
```
$ pnpm exec vitest run src/test-support/ --coverage.enabled=false
      Tests  27 passed (27)
$ pnpm exec vitest run --coverage.enabled=false --exclude src/openapi.test.ts
 Test Files  98 passed (98)
      Tests  1916 passed (1916)
```

### 2. Deleting a file removes every stored version (C16; `apps/api/src/storage`)

The compose bucket has versioning on (`objectstore-init`). There, a plain `DeleteObject` only adds a delete marker: the ciphertext stays as a noncurrent version, and its wrapped DEK stays in `files`, so redaction did not remove the file. `HeadObject` answers 404 either way, so a check on the current version alone cannot see it.

RED (`e833f51`):
```
$ pnpm exec vitest run src/storage/index.test.ts --coverage.enabled=false
     × deletes every version and delete marker of the object, so a versioned bucket keeps no copy (C16)
     × reads every page of the version listing before deleting
     × sends no delete for a key without versions, so it leaves no delete marker behind
     × propagates any other failure of the version listing
AssertionError: expected [] to deeply equal [ Array(1) ]          (no ListObjectVersions was sent)
AssertionError: expected [ Array(1) ] to deeply equal []          (a plain DeleteObject was sent)
      Tests  4 failed | 28 passed (32)
$ pnpm exec vitest run --config vitest.integration.config.ts src/storage/storage.integration.test.ts   (rustfs/rustfs:1.0.3)
     × deletes every version of a replaced object in a versioned bucket
AssertionError: expected [ …(3) ] to deeply equal []     (2 ciphertext versions and 1 delete marker left)
     × leaves no delete marker for a key that holds nothing
AssertionError: expected [ Array(1) ] to deeply equal []
      Tests  2 failed | 1 passed (3)
```
GREEN (`35f43c6`): `delete` lists the key's versions and delete markers (every page) and deletes each by version id; a key with none gets no request; a store without version listing (501) gets a plain delete.
```
$ pnpm exec vitest run src/storage/index.test.ts --coverage.enabled=false
      Tests  32 passed (32)
$ pnpm exec vitest run --config vitest.integration.config.ts src/storage/storage.integration.test.ts
      Tests  3 passed (3)
$ pnpm exec vitest run --config vitest.integration.config.ts src/services/lifecycle.integration.test.ts
      Tests  4 passed (4)
```

### 3. The dev seed (`apps/api/src/seed`, `apps/api/scripts/seed-dev.ts`)

RED (`f60d4ec`):
```
$ pnpm exec vitest run src/seed --coverage.enabled=false
     × reads one operator per built-in role besides admin (C15)
     × checks the role operators like the admin, naming the variables only
     × refuses two seeded operators with the same email
     × reads the MFA admin and the KEK that seals its TOTP secret only when asked to
     × requires the MFA admin and a KEK when asked for the MFA admin
     × creates an organization, its sandbox, the admin, an all-scope key and the default template
     × gives the default template explicit C11 settings within their ranges
     × creates both a sandbox and a production environment
     × seeds the organization's built-in roles and one operator holding each of them (C15)
     × gives a seeded operator its role back on a re-run, without duplicates
     × enrols an admin in TOTP and returns its secret once, so it signs in with password and code
     × replaces the TOTP factor on a re-run, so the new secret is the only one that works
     × reads --json and --mfa-admin
     × refuses anything else, with the usage
     × lists the tenant, every operator with its role, and the key shown once
     × shows the MFA admin TOTP secret once when it was enrolled
AssertionError: expected undefined to deeply equal { developer: { …(2) }, …(2) }
AssertionError: expected {} to deeply equal undefined            (the template version had no settings)
TypeError: Cannot read properties of undefined (reading 'sandbox')   (no environments in the result)
TypeError: Cannot read properties of undefined (reading 'map')       (no users in the result)
      Tests  16 failed | 10 passed (26)
```
The first GREEN run had 2 failures, both mine: the test read `keyring.current.kid`, but a `Keyring` is `{ currentKeyId, keyIds }`, so the test was corrected; and the TOTP heading had an extra parenthesis the test did not expect, so the wording follows the test. Typecheck then found an `ip` member in a `completeMfa` call of the test, which `CompleteMfaInput` does not have; it was removed. It also fixed the baseline typecheck error: the old test read `login.session` on a `LoginOutcome`, which is now narrowed first.

GREEN (`d150c4f`):
```
$ pnpm exec vitest run src/seed --coverage.enabled=true --coverage.include=src/seed/dev-seed.ts
      Tests  26 passed (26)
 dev-seed.ts |   98.56 |    90.52 |     100 |   98.51 |
$ env -i PATH=$PATH HOME=$HOME pnpm exec tsx --conditions=@openverify/source scripts/seed-dev.ts --bogus
Unknown argument --bogus. usage: seed:dev [--json] [--mfa-admin]          (exit 1)
$ env -i PATH=$PATH HOME=$HOME pnpm exec tsx --conditions=@openverify/source scripts/seed-dev.ts --mfa-admin
Invalid dev seed configuration:
  - DATABASE_URL: is required
  ... (one line per variable, values never shown)
  - OPENVERIFY_KEK: is not set; expected a base64-encoded 32-byte key     (exit 1)
```

### 4. `retention:run`, the retention job with an injected clock (`apps/api/scripts/retention-run.ts`)

Item 12 needs the C16 retention job to run as of a later time. The daily BullMQ job cannot take a clock, so `pnpm --filter @openverify/api retention:run [--now=<ISO-8601>] [--batch-size=<n>] [--json]` runs `runRetention` once with the container's adapters. `--now` moves only the retention cutoff; redactions keep the real time.

RED (`4139543`):
```
$ pnpm exec vitest run src/retention-run.test.ts --coverage.enabled=false
Error: Cannot find module '../scripts/retention-run.js' imported from .../apps/api/src/retention-run.test.ts
 Test Files  1 failed (1)
```
GREEN (`d15c46f`):
```
      Tests  11 passed (11)
```

### 5. The OpenAPI snapshot (`docs/api/openapi.json`, `1b448ea`)

The baseline `matches the committed snapshot` failure: no Phase 2 route was in it. `pnpm --filter @openverify/api openapi:write` regenerated it. Comparing method and path sets: 26 operations before, 109 after, 83 added and none removed. Every C10–C15 server, flow and dashboard endpoint is listed.

### 6. Compose and `.env.example` (`infra/`)

RED (`75b5631`):
```
$ infra/tests/compose.test.sh --static-only
FAIL - .env.example declares OPENVERIFY_RATE_LIMIT_API_PER_MINUTE
FAIL - .env.example declares OPENVERIFY_DASHBOARD_PUBLIC_URL
... (each C12/C15 setting and seed operator variable)
FAIL - the OPENVERIFY_DASHBOARD_BFF_TOKEN placeholder is at least 32 characters
FAIL - .env.example uses localhost as the WebAuthn RP ID (expected 'localhost', got '')
FAIL - api sends invitation email through mailpit
FAIL - api waits for a healthy mailpit
FAIL - api reads OPENVERIFY_DASHBOARD_BFF_TOKEN from the env file
FAIL - migrate passes OPENVERIFY_SEED_MFA_ADMIN_PASSWORD to seed:dev
# 118 passed, 40 failed
```
GREEN (`c30047f`): `# 158 passed, 0 failed`.

### 7. Actions pinned to commit SHAs (F009, `.github/`)

RED (`0bf01ad`). The contract test now reads each `uses:` line's trailing comment, and with `gh` authenticated checks that the comment's tag resolves to the pinned commit:
```
$ infra/tests/ci-workflow.test.sh
ok   - actionlint 1.7.12 reports no problems
FAIL - actions/cache@v6 is pinned to a full commit SHA
FAIL - actions/cache names its version in a trailing comment (got '-')
... (the same two failures for checkout, setup-java, setup-node, upload-artifact, setup-android, setup-uv, android-emulator-runner)
# 77 passed, 16 failed, 0 skipped
```
SHAs were resolved with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`. The exact tag is the one among the repository's tags that points at that commit:

| Action | Tag in use | Commit | Exact tag |
|---|---|---|---|
| actions/checkout | v7 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 |
| actions/setup-node (composite) | v7 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | v7.1.0 |
| actions/cache | v6 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | v6.1.0 |
| actions/setup-java | v6 | `b843ebf9b913146b38da2eaa7aeddf76074ae1ad` | v6.1.0 |
| actions/upload-artifact | v7 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | v7.0.2 |
| astral-sh/setup-uv | v10.3.0 | `1c37ad07a6a961277cf70c0d37d6f313000f5884` | v10.3.0 |
| android-actions/setup-android | v4 | `be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd` | v4.0.4 |
| reactivecircus/android-emulator-runner | v2 | `a421e43855164a8197daf9d8d40fe71c6996bb0d` | v2.38.0 |

GREEN (`014be28`):
```
ok   - actions/checkout v7.0.1 resolves to the pinned commit on GitHub   (and the seven others)
ok   - actionlint 1.7.12 reports no problems
# 101 passed, 0 failed, 0 skipped
```

### 8. The e2e harness (`e2e/src`)

RED (`d68c8ca`):
```
$ cd e2e && pnpm exec vitest run --coverage.enabled=false
 FAIL  src/mailpit.test.ts   Error: Cannot find module './mailpit.js'
 FAIL  src/totp.test.ts      Error: Cannot find module './totp.js'
     × sends invitation email to the run's Mailpit and links to its dashboard (C15)
     × sets the server API rate limit the specs expect in the RateLimit headers (C12)
     × names one seeded operator per built-in role, plus the TOTP-enrolled admin
     × generates every secret at random, long enough for the services that check
       (OPENVERIFY_SEED_DEVELOPER_PASSWORD: expected undefined to be defined)
     × round-trips through the environment variable the global setup sets
     × carries one operator per built-in role and the TOTP-enrolled admin (Phase 2)
       (Error: OPENVERIFY_E2E_STACK does not describe a running stack)
 Test Files  4 failed | 4 passed (8)
      Tests  6 failed | 37 passed (43)
```
The gitleaks pre-commit hook first blocked this commit. The base32 form of the public RFC 6238 seed, and a placeholder TOTP secret, matched `generic-api-key`. The test now computes the seed with `base32Encode`, and the placeholder has zero entropy (`'A'.repeat(32)`). No `.gitleaksignore` entry was added.

GREEN (`46b7794`; the TOTP helper is checked against the RFC 4226, RFC 6238 and RFC 4648 vectors):
```
      Tests  58 passed (58)
All files          |   96.45 |    86.86 |   92.06 |   97.52 |
```

### 9. The Phase 2 e2e specs (`e2e/tests`, `1535d7b`)

First, the three Phase 1 browser specs ran against the Phase 2 stack: the new seed (`--mfa-admin`) and the new settings.
```
$ pnpm exec turbo run e2e --filter=@openverify/e2e
  ✓  1 … reload-between-uploads.spec.ts … ✓  2 … verification-completes.spec.ts … ✓  3 … verification-fails.spec.ts
  3 passed (48.0s)
```
The first run with the 13 new specs gave 14 passed and 2 failed. Both failures were wrong expectations in my specs, not product defects:
- `redaction … stubs the events`: the `inquiry.redacted` event, which the redaction itself writes, carries the redacted inquiry (`fields: {}`, `note: null`), not the stub. C16 stubs the payloads stored before the redaction. The spec now checks those, plus that no event of the inquiry still contains the synthetic name.
- `template versions`: `Expected: 7200, Received: 7199.999`. `expires-at` comes from the API's clock and `created-at` from the database's, so the spec compares whole seconds.

Second run: `16 passed (57.1s)`.

**Mutation check.** I switched `delete` back to the Phase 1 plain `DeleteObject` and ran only the redaction spec. It failed as it must, at the version check; the source was then restored (empty `git diff`):
```
  ✘  1 [chromium] › tests/redaction-retention.spec.ts:22:1 › redaction deletes the stored files and stubs the events about the inquiry
    > 61 |       expect(await store.versions(key)).toEqual([]);      (- Expected - 1 / + Received + 4)
```

### 10. `db:migrate` gives Phase 1 events their object id (`apps/api/src/migrate.ts`)

db-v2's report asked for `backfillEventObjectIds` to run once on upgraded deployments, and nothing called it. Without it, events written before schema v2 have no `object_id`, so `GET /events?filter[object-id]` misses them and C16 redaction leaves their payloads unstubbed.

RED (`a3e7780`):
```
$ pnpm exec vitest run src/migrate.test.ts --coverage.enabled=false
Error: Cannot find module './migrate.js' imported from .../apps/api/src/migrate.test.ts
```
GREEN (`7b5bfe5`): `migrateDatabase` runs the migrations, then the backfill in batches of 500 until it is done. `db:migrate` and `seed:dev` both call it; the seed writes its progress to stderr, so `--json` still prints one stdout line.
```
      Tests  2 passed (2)
```

### 11. OpenAPI declares user sessions on server API operations (C12; `apps/api/src/app.ts`)

api-foundation left this until the user-session resolver was wired, and api-operators wired it.

RED (`41a65ec`):
```
$ pnpm exec vitest run src/app.test.ts --coverage.enabled=false
     × declares that server operations also accept user sessions once a resolver is wired (C12)
-   "userSession": { "description": "Dashboard user session token ...", "scheme": "bearer", "type": "http" },
      Tests  1 failed | 23 passed (24)
```
GREEN (`ad0cdd1`): with a resolver, the app registers the `userSession` scheme, and the default security is `[{ apiKey: [] }, { userSession: [] }]`. No Phase 1 assertion changed: without a resolver the document is as before.
```
$ pnpm exec vitest run src/app.test.ts src/routes/dashboard/index.test.ts src/routes/server/scopes.test.ts src/routes/flow/auth.test.ts --coverage.enabled=false
      Tests  124 passed (124)
```
In the regenerated snapshot, only the top-level `security` changed.

### 12. Found by the first full validation run

- **`api.integration.test.ts` (Phase 1, rule 12).** The Phase 1 path now also writes `account.created` (C13), `inquiry-session.started` and `inquiry.transitioned` (C10):
  ```
  AssertionError: expected [ 'account.created', …(8) ] to deeply equal [ 'inquiry.created', …(5) ]
  (after adding the three) AssertionError: expected 8 to be greater than or equal to 9
  ```
  `account.created` is staged in the inquiry's transaction through the `AccountsService` port, which has no after-commit hook, so the worker's 30 s sweep enqueues its delivery (the C5 outbox; documented in `services/accounts.ts`). The test now expects the three events, and an immediate delivery for every event except that one (`96a3873`): `Tests  4 passed (4)`.
- **A flaky assertion in my rate-limit spec:**
  ```
  ✘ tests/platform-http.spec.ts › every server API response carries the rate-limit and version headers
    Expected: < 1196   Received: 1196
  ```
  GCRA gives one request back every 60 s / 1,200 = 50 ms, so two sequential requests more than 50 ms apart report the same `RateLimit-Remaining`. The spec now checks the headers on every response of a concurrent burst of 8, and that the count drops during the burst (`088a386`).

### Refactor (`2b1b5fa`)

The child-process environment of the stack and of the operator commands moved into `e2e/src/processes.ts` (`childEnvironment`, unit-tested):
```
      Tests  59 passed (59)
All files          |   96.49 |    87.61 |    92.3 |   97.55 |
```

## Validation (`docs/plans/phase-2.plan.md`, run in order on 2026-10-20)

One script ran every command in sequence, each step into its own log, after the last code commit (`2b1b5fa`). Exit codes and wall-clock seconds:
```
install exit=0 seconds=0              vision exit=0 seconds=17            compose-contract exit=0 seconds=1
lint-typecheck-test exit=0 seconds=277  android exit=0 seconds=2 (*)      ci-contract exit=0 seconds=5
format exit=0 seconds=16              e2e exit=0 seconds=60
integration exit=0 seconds=31         gitleaks exit=0 seconds=2
```
(*) Gradle reused its up-to-date results, so Android was run again with `--rerun-tasks` (below).

The first full run, before the two fixes in "Found by the first full validation run", had `integration exit=1` and `e2e exit=1`. Every other step passed.

```
$ pnpm install --frozen-lockfile
✓ Lockfile passes supply-chain policies
Lockfile is up to date, resolution step is skipped

$ pnpm exec turbo run lint typecheck test --force       # pnpm lint && pnpm typecheck && pnpm test, uncached
@openverify/api:test:        Tests  1951 passed (1951)   All files | 97.48 | 90.09 |  98.3 | 97.55
@openverify/checks:test:     Tests   455 passed (455)    All files | 99.81 | 97.85 |   100 |  99.8
@openverify/config:test:     Tests    43 passed (43)     All files |   100 |   100 |   100 |   100
@openverify/contracts:test:  Tests  1183 passed (1183)   All files |   100 |   100 |   100 |   100
@openverify/core:test:       Tests   398 passed (398)    All files |   100 |   100 |   100 |   100
@openverify/dashboard:test:  Tests   201 passed (201)    All files | 97.61 | 94.78 |   100 | 97.56
@openverify/db:test:         Tests   550 passed (550)    All files | 99.58 | 93.04 |   100 | 99.56
@openverify/e2e:test:        Tests    59 passed (59)     All files | 96.49 | 87.61 |  92.3 | 97.55
@openverify/flow:test:       Tests   413 passed (413)    All files |  98.5 | 95.18 | 99.07 | 98.58
@openverify/flow-spec:test:  Tests    81 passed (81)     All files |   100 |   100 |   100 |   100
@openverify/node:test:       Tests   185 passed (185)    All files | 98.96 | 94.35 |   100 | 99.29
@openverify/ui:test:         Tests    50 passed (50)     All files |   100 | 97.72 |   100 |   100
 Tasks:    36 successful, 36 total
Cached:    0 cached, 36 total
```
That is 5,569 unit tests in 12 packages, every package at or above 80% on every metric. The api suite includes `src/openapi.test.ts` (the regenerated snapshot).

```
$ pnpm format:check
All matched files use Prettier code style!

$ pnpm test:integration                                  # Testcontainers: pg17, valkey 9.1, rustfs 1.0.3
@openverify/db:test:integration:   Test Files  4 passed (4)    Tests  37 passed (37)
@openverify/api:test:integration:  Test Files  9 passed (9)    Tests  28 passed (28)
 Tasks:    2 successful, 2 total

$ (cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest -rs)
All checks passed!
41 files already formatted
Success: no issues found in 17 source files
Required test coverage of 80% reached. Total coverage: 100.00%
446 passed in 15.78s                                     # no skips

$ (cd android && ./gradlew testDebugUnitTest koverVerify assembleDebug lint --rerun-tasks)
BUILD SUCCESSFUL in 1m 26s
158 actionable tasks: 158 executed
# test-results XML: openverify-sdk 333 tests, demo-app 10 tests, 0 failures, 0 errors, 0 skipped
$ ./gradlew :openverify-sdk:koverLog
application line coverage: 97.2921%

$ pnpm e2e
@openverify/flow:e2e:   9 passed (6.5s)
@openverify/e2e:e2e:   ✓   1 tests/accounts.spec.ts › consolidating accounts moves the inquiries to the target account
@openverify/e2e:e2e:   ✓   2 tests/inquiry-actions.spec.ts › approve, decline and mark-for-review emit their events
@openverify/e2e:e2e:   ✓   3 tests/one-time-links.spec.ts › a one-time link is redeemed once through the flow API, then refused
@openverify/e2e:e2e:   ✓   4 tests/operators.spec.ts › a reviewer can approve but cannot create API keys; a viewer sees masked fields
@openverify/e2e:e2e:   ✓   5 tests/operators.spec.ts › an admin enrolled in TOTP signs in with password and code through the dashboard API
@openverify/e2e:e2e:   ✓   6 tests/operators.spec.ts › an invited operator receives the email through Mailpit and joins with the role given
@openverify/e2e:e2e:   ✓   7 tests/platform-http.spec.ts › an idempotent replay returns the stored response; another body with the key answers 422
@openverify/e2e:e2e:   ✓   8 tests/platform-http.spec.ts › every server API response carries the rate-limit and version headers
@openverify/e2e:e2e:   ✓   9 tests/redaction-retention.spec.ts › redaction deletes the stored files and stubs the events about the inquiry
@openverify/e2e:e2e:   ✓  10 tests/redaction-retention.spec.ts › the retention job, run with an injected clock, redacts a finished inquiry past its retention
@openverify/e2e:e2e:   ✓  11 tests/template-versions.spec.ts › inquiries pin the version that was published when they were created
@openverify/e2e:e2e:   ✓  12 tests/webhooks.spec.ts › during a secret rotation both secrets verify every delivery
@openverify/e2e:e2e:   ✓  13 tests/webhooks.spec.ts › a simulated event and a replayed event are delivered to the webhook
@openverify/e2e:e2e:   ✓  14 tests/reload-between-uploads.spec.ts › a reload between the two ID uploads does not strand the user
@openverify/e2e:e2e:   ✓  15 tests/verification-completes.spec.ts › an inquiry on the default template completes with every check passed
@openverify/e2e:e2e:   ✓  16 tests/verification-fails.spec.ts › a selfie of a different person fails the face match and the inquiry
@openverify/e2e:e2e:   16 passed (58.9s)
 Tasks:    9 successful, 9 total

$ gitleaks git --redact .
INF 355 commits scanned.
INF no leaks found

$ infra/tests/compose.test.sh --static-only
# 158 passed, 0 failed

$ infra/tests/ci-workflow.test.sh
ok   - actionlint 1.7.12 reports no problems
# 101 passed, 0 failed, 0 skipped
```

**Service logs of the e2e run** (`e2e/.artifacts/logs`):
- `api.log` (505 lines) and `worker.log` (39 lines) hold only `level: 30` (info) lines.
- No log contains `ov_sbx_`, `ovs_`, `ovu_`, `ovm_`, `ovi_`, `ovo_`, `wbhsec_` or `authorization`.
- The six `Bearer ` hits are `www-authenticate` challenge headers of the 403s the specs provoke, never a credential.

**Compose `app` profile, live.** It ran under a throwaway project (`openverify-p2smoke`), with a generated env file, free ports and its own image tags (`openverify/apps:p2-smoke`, `openverify/vision:p2-smoke`), so nothing of the developer's was touched:
```
$ docker compose -p openverify-p2smoke -f infra/docker-compose.yml -f <tag override> --env-file <generated> --profile app up -d --wait --wait-timeout 900 --build
 … api Healthy · dashboard Healthy · flow Healthy · vision Healthy · worker Healthy · mailpit Healthy · migrate Exited · objectstore-init Exited
exit=0 seconds=193
migrate-1  | db:migrate: migrations applied
migrate-1  | db:migrate: every event has its object id
$ docker compose ... run --rm migrate pnpm --silent --filter @openverify/api seed:dev --json --mfa-admin
seed created True roles ['admin', 'developer', 'reviewer', 'viewer'] mfa admin True envs ['production', 'sandbox']
GET /inquiry-templates 200 ['Government ID and selfie'] settings {inquiry 86400, session 86400, one-time-link 86400, retention-days None} ratelimit-limit 300
POST /dashboard/sessions (admin) 201 · POST /dashboard/users/invitations 201
mailpit message "You are invited to OpenVerify Dev on OpenVerify", link to the dashboard: True
POST /dashboard/sessions (MFA admin) 202 ['totp']
$ docker compose ... down --volumes --remove-orphans; docker image rm openverify/apps:p2-smoke openverify/vision:p2-smoke
# afterwards: 0 containers and 0 volumes labelled openverify-p2smoke; no openverify/* image left
```

## Contract mismatches reviewed

- **Between agents, at runtime.** Every Phase 2 response the specs read went through `@openverify/node`, which parses each answer with the contracts. Every flow API answer went through `flowSessionResponseSchema`, and every webhook body through `eventDocumentSchema`. None failed. The Phase 2 attributes added to Phase 1 resources (optional in the schemas, contracts-v2's deviation) are sent by every producer the specs reach.
- **Fixed here:**
  - redaction left ciphertext in versioned buckets (storage);
  - Phase 1 events were invisible to `filter[object-id]` and redaction on upgraded databases (`db:migrate`);
  - the OpenAPI document did not say server operations accept user sessions;
  - the harness default accounts service wrote no rows;
  - the Phase 1 integration test expected Phase 1's event list.
- **Left as designed, reported:**
  - `account.created` from inquiry creation is delivered by the 30 s sweep;
  - `expires-at` and `created-at` come from two clocks.

## Not verified here

- The workflow has not run on GitHub: nothing was pushed. Its structure, actionlint and the pinned SHAs (against GitHub's API) are checked locally.
- The live part of `infra/tests/compose.test.sh` was not run. It brings up the developer's own `openverify` project. The throwaway-project run above covers `up --wait` of the whole `app` profile.
- WebAuthn is not part of the API-level e2e. api-operators covers it with a software P-256 authenticator on Postgres 17 (`operators.integration.test.ts`, in the integration run above). The browser path with Chromium's virtual authenticator belongs to Workflow 2C.
