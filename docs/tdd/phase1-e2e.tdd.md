# TDD evidence: Phase 1, e2e-integration

- **Slice owner:** e2e-integration agent (Workflow 1A, Stage 3). Date: 2026-10-20.
- **Owned paths:**
  - `e2e/**` (new root Playwright project `@openverify/e2e`);
  - `apps/api/scripts/{seed-dev,migrate}.ts`, with the seed logic in `apps/api/src/seed/` so it is unit-tested and covered;
  - `infra/docker-compose.yml`, `infra/docker/apps.Dockerfile`, `.dockerignore`, `.env.example`;
  - `.github/workflows/ci.yml` and the contract tests `infra/tests/{compose,ci-workflow}.test.sh`;
  - `THIRD_PARTY_LICENSES.md`, root `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `.prettierignore`, `eslint.config.js`;
  - this file and the Phase 1 entry in `docs/PROGRESS.md`.
- **Small fixes in other slices' files:** `packages/config/src/vitest.ts` (test timeouts), `docs/api/openapi.json` (regenerated snapshot), `apps/api/{package.json,tsconfig.json}` (two scripts and the `scripts` include), `apps/flow/package.json` (Playwright from the catalog).

All commands ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown.

## Plan task

`docs/plans/phase-1.plan.md`, Stage 3:
1. Wire the slices together and make the whole workspace green; fix contract mismatches between agents.
2. Add the app services to compose (profile `app`).
3. Add a root Playwright e2e project that seeds, creates a webhook to a local receiver, creates an inquiry and resumes it, opens the flow URL in Chromium with a fake camera, uploads the synthetic ID, takes the selfie, waits for a signed `inquiry.completed`, checks it with `@openverify/node`, and checks the inquiry in the API and in the dashboard. A negative case with a different face must end with `selfie_id_comparison` failed and the inquiry `failed`.
4. CI jobs for `format:check` and e2e.
5. Run the full validation list.

## What was built

| Piece | Where | What it does |
|---|---|---|
| Dev seed | `apps/api/src/seed/dev-seed.ts`, `apps/api/scripts/seed-dev.ts` (`pnpm --filter @openverify/api seed:dev [--json]`) | Applies migrations, then creates or reuses an organization with a sandbox, the Argon2id admin from `OPENVERIFY_SEED_ADMIN_EMAIL`/`_PASSWORD`, the default template read from `contracts/fixtures/flows/default-gov-id-selfie.json` (validated with the C2 schema), and a new API key with all 8 scopes, printed once. A re-run reuses everything and issues a new key; it never changes the password. Settings errors name variables, never values; a `change-me` password is refused. |
| Migrations | `apps/api/scripts/migrate.ts` (`db:migrate`) | Applies pending migrations only (compose `migrate` service). |
| Harness library | `e2e/src/` | Random secrets and free ports (`env.ts`, `ports.ts`), process groups with log files, readiness waits and command runs (`processes.ts`), a raw-body webhook receiver on `localhost` (dual-stack), and the stack info hand-off (`stack-info.ts`). Unit-tested, 39 tests. |
| Global setup | `e2e/setup/{global-setup,stack}.ts` | Writes the gitignored `e2e/.env.e2e`; starts Postgres, Valkey, RustFS and its bucket init and Mailpit as the compose project `openverify-e2e`; fetches the YuNet and SFace weights and the public-domain faces (pinned SHA-256); generates the synthetic ID and the `.y4m` clips when missing; migrates and seeds; builds the flow against this API into `e2e/.artifacts/flow-dist` and builds the dashboard; starts vision (`uv run uvicorn`), the API and the worker (`tsx`), the flow (`vite preview`) and the dashboard (`next start`). Teardown stops every process group and runs `down --volumes` for `openverify-e2e` only. |
| Specs | `e2e/tests/verification-completes.spec.ts`, `verification-fails.spec.ts` | See "Specs" below. |
| Compose `app` profile | `infra/docker-compose.yml`, `infra/docker/apps.Dockerfile`, `.dockerignore` | `migrate`, `api`, `worker`, `vision`, `flow`, `dashboard`, off by default; each waits for `objectstore-init` to succeed (api and worker also for `migrate`); loopback ports that follow `OPENVERIFY_{API,FLOW,DASHBOARD}_PORT`; service-name wiring. |
| CI | `.github/workflows/ci.yml` | New `format` job (`pnpm format:check`) and `e2e` job; the vision job now runs `mypy src tools` and fetches weights and faces, so its real-model tests run. |

### Specs

**Positive** (`an inquiry on the default template completes with every check passed`):
1. A webhook (`enabled-events: ["*"]`) is created for a receiver at `http://localhost:<port>/webhooks`. The worker runs with `OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` in development mode.
2. An inquiry is created on the seeded default template and resumed. The flow URL starts with the flow's origin and carries the token in the fragment only.
3. Chromium runs with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=fixtures/generated/selfie-a.y4m`. The test asserts the fragment leaves the address bar, then consents, uploads `id-front.jpg` and `id-back.jpg`, waits for the ID to be checked, takes the selfie and sees "Verification submitted". No console error or CSP violation is allowed.
4. `inquiry.completed` for this inquiry arrives; `verifyWebhookSignature` from `@openverify/node` verifies it over the raw body; the headers are `content-type: application/json`, `user-agent: OpenVerify-Webhooks/1` and `openverify-event-id` = the event id; the body parses with the contracts' `eventDocumentSchema`; `inquiry.started` was delivered too.
5. `GET /api/v1/inquiries/:id?include=verifications` (parsed with `inquiryDocumentSchema`): status `completed`, government ID and selfie `passed`, exactly the 7 C7 checks, each `passed`, `required`, without reasons; `selfie_id_comparison` reports `confidence_stage: beta`; no embedding anywhere in the document.
6. In a fresh browser context the seeded admin signs in to the dashboard; the inquiry's row shows "Completed"; the detail page shows the reference ID, "Completed", the 7 checks as "Passed" in the two verification cards, and the 3 images load through the authenticated proxy (`naturalWidth > 0`).
7. The webhook is disabled and the receiver closed.

**Negative** (`a selfie of a different person fails the face match and the inquiry`): a template is created through `POST /api/v1/inquiry-templates` from the default fixture with `maxAttempts: 1` on the selfie step, so the failure is final whatever the check's retry policy. The fake camera plays person B (`selfie-b.y4m`). The flow shows "Verification not completed"; a signed `inquiry.failed` arrives and verifies; the inquiry is `failed` with the government ID `passed` and the selfie `failed`; `selfie_id_comparison` is `failed` with reason `face_mismatch` while the selfie quality and multiple-faces checks passed; a signed `verification.failed` for the selfie arrives too.

## Decisions

- **The e2e project is a workspace package (`e2e/`),** so `pnpm e2e` (turbo) runs it next to the flow's mocked suite, `^build` builds `@openverify/node` and `@openverify/contracts` first, and `pnpm lint`, `typecheck` and `test` cover its harness.
- **Isolation from the developer's stack.** The compose project is `openverify-e2e`; every port is a free port chosen per run; secrets are random per run; the flow is built into `e2e/.artifacts/flow-dist`, never `apps/flow/dist`, which the flow's own e2e suite builds at the same time. Teardown removes only `openverify-e2e` containers and volumes.
- **Child process environment.** Playwright's `NODE_OPTIONS` loader and `PW_*`, `PLAYWRIGHT_*`, `COMPOSE_*` and `TEST_*` variables are dropped, then the run's settings are added, so a developer's shell cannot redirect the stack.
- **Specs read static fixture paths.** Playwright collects spec files before the global setup runs, so the `.y4m` path (needed by `test.use` at collection time) comes from `e2e/src/paths.ts`, and the stack info is read inside each test.
- **Webhook receiver on `localhost`.** The API's guarded sender refuses literal IP hosts and connects to the address it resolved, which may be `::1` or `127.0.0.1`; the receiver listens dual-stack on `::`, falling back to `127.0.0.1`.
- **Compose app images.** One development image for the TypeScript apps (`openverify/apps:dev`, 1.83 GB, keeps dev dependencies because `db:migrate` and `seed:dev` run with `tsx`); the flow bundle bakes in `VITE_OPENVERIFY_API_URL` as a build argument. Vision uses its own Dockerfile and mounts `../models` read-only. Production images are a later phase.
- **Timeouts.** Under `pnpm test` (all packages at once through turbo) a flow renderer test that takes 0.4 s alone and the API's OpenAPI test both exceeded Vitest's 5 s default. The shared `createVitestConfig()` now sets 20 s test and hook timeouts.

## RED and GREEN

Every RED state was committed as `test(...)` before its implementation.

### 1. Test timeouts under the workspace-wide run (`packages/config`)

The baseline `pnpm test` failed twice for the same reason:
```
@openverify/flow:test:  FAIL  src/flow/flow-renderer.test.tsx > FlowRenderer > runs the default flow from consent to completion
@openverify/flow:test: Error: Test timed out in 5000ms.
@openverify/api:test:  FAIL  src/openapi.test.ts > OpenAPI document > is the /openapi.json the server serves, formatted for the repository
@openverify/api:test: Error: Test timed out in 5000ms.
```
Alone, the flow test took 382 ms (`pnpm exec vitest run src/flow/flow-renderer.test.tsx --reporter=verbose`).

RED (`5db0ef5`), `cd packages/config && pnpm exec vitest run src/vitest.test.ts --coverage.enabled=false`:
```
     × gives each test and hook headroom for a workspace-wide parallel run 6ms
AssertionError: expected undefined to be 20000 // Object.is equality
      Tests  1 failed | 5 passed (6)
```
GREEN (`53c0fe0`), `pnpm test` in `packages/config`: `Test Files 2 passed (2)`, `Tests 40 passed (40)`.

### 2. Stale OpenAPI snapshot (`docs/api/openapi.json`, `81f666c`)

The same baseline run failed `matches the committed snapshot`: the dashboard slice changed its six operations after api-http wrote the snapshot, as its evidence file predicted. `pnpm --filter @openverify/api openapi:write` regenerated it; a comparison of the old and new documents showed only these paths changed, and `components` was identical:
```
changed paths: ['/api/v1/dashboard/files/{id}/content', '/api/v1/dashboard/inquiries', '/api/v1/dashboard/inquiries/{id}', '/api/v1/dashboard/me', '/api/v1/dashboard/sessions', '/api/v1/dashboard/sessions/current']
components equal: True
```

### 3. Dev seed (`apps/api`)

RED (`953368a`), `cd apps/api && pnpm exec vitest run src/seed --coverage.enabled=false`:
```
 FAIL  src/seed/dev-seed.test.ts [ src/seed/dev-seed.test.ts ]
Error: Cannot find module './dev-seed.js' imported from .../apps/api/src/seed/dev-seed.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```
First GREEN run: 3 failed, 8 passed. The defect was in the test: its fake hasher returned `fake-hash:27`, and the database refused it:
```
Error: Failed query: insert into "users" ... constraint: 'users_password_hash_argon2id'
```
`users.password_hash` only accepts Argon2id PHC strings, which is right; the fake now returns one real hash computed once. GREEN (`6b56fbc`):
```
 Test Files  1 passed (1)
      Tests  11 passed (11)
$ pnpm --filter @openverify/api test
 Test Files  42 passed (42)
      Tests  818 passed (818)
All files          |   97.83 |    91.78 |   98.65 |   97.94 |
  dev-seed.ts      |   98.36 |    95.83 |     100 |    98.3 | 176
```
One test signs the seeded admin in through `createOperatorAuth` and another authenticates the seeded key through `createDbApiKeyAuthenticator`, so the seed is checked against the code that consumes it.

### 4. Full-stack e2e (`e2e/`)

RED (`2df4c36`). Harness unit tests, `cd e2e && pnpm exec vitest run --coverage.enabled=false`:
```
Error: Cannot find module './env.js' imported from .../e2e/src/env.test.ts
Error: Cannot find module './paths.js' imported from .../e2e/src/paths.test.ts
Error: Cannot find module './ports.js' imported from .../e2e/src/ports.test.ts
Error: Cannot find module './stack-info.js' imported from .../e2e/src/stack-info.test.ts
Error: Cannot find module './webhook-receiver.js' imported from .../e2e/src/webhook-receiver.test.ts
 Test Files  6 failed (6)
```
Specs, `cd e2e && pnpm exec playwright test` (no global setup yet):
```
Error: Cannot find module '.../e2e/src/paths.js' imported from .../e2e/tests/verification-completes.spec.ts
Error: Cannot find module '.../e2e/src/paths.js' imported from .../e2e/tests/verification-fails.spec.ts
Error: No tests found
```
Harness GREEN: `Test Files 6 passed (6)`, `Tests 39 passed (39)`, `All files | 95.83 | 88.75 | 92.45 | 96.66`. Typecheck then found a spec defect: `PHASE1_CHECKS` is a record of two lists, not a list; the spec now spreads both.

First full run, `pnpm exec turbo run e2e --filter=@openverify/e2e`: the global setup failed on its own check, and teardown removed the project:
```
[e2e +7.2s] stopping the services
[e2e +7.2s] removing the openverify-e2e compose project and its volumes
Error: objectstore-init exited with container "4a47f7ac…" exited with status code 0, expected 0
```
Compose 5.4's `wait` prints a sentence, not a bare exit code. The setup now reads `ExitCode` from `compose ps --all --format json` (either output format). Second run (GREEN, `5541a99`):
```
[e2e +0.0s] starting the openverify-e2e compose project (postgres, redis, objectstore, objectstore-init, mailpit)
[e2e +6.7s] fetching model weights and public-domain faces (pinned SHA-256)
[e2e +6.9s] migrating and seeding the database
[e2e +8.5s] building the flow against this API, and the dashboard
[e2e +21.8s] starting vision, API, worker, flow and dashboard
[e2e +24.6s] stack ready; logs in e2e/.artifacts/logs
Running 2 tests using 1 worker
  ✓  1 [chromium] › tests/verification-completes.spec.ts:27:1 › an inquiry on the default template completes with every check passed (6.8s)
  ✓  2 [chromium] › tests/verification-fails.spec.ts:40:1 › a selfie of a different person fails the face match and the inquiry (5.8s)
[e2e +39.6s] stopping the services
[e2e +39.8s] removing the openverify-e2e compose project and its volumes
  2 passed (41.4s)
```
What the services logged during that run (no warning or error lines in `api.log` or `worker.log`):
```
verification processed  government_id passed  failingChecks []                        (positive)
verification processed  selfie        passed  failingChecks []
inquiry decided         completed
verification processed  government_id passed  failingChecks []                        (negative)
verification processed  selfie        failed  failingChecks ['selfie_id_comparison']
inquiry decided         failed
11 x webhook delivery attempt recorded  attempt 1  outcome succeeded  status 200
```
vision answered 6 `POST /v1/analyze/*` with 200. After teardown, `docker ps -a` and `docker volume ls` for the `openverify-e2e` label were empty, and the developer's `openverify_*` volumes were still there. No service log contained `Bearer`, `ov_sbx_`, `ovs_`, `ovu_`, `wbhsec_` or `authorization`.

**Mutation check.** With the positive spec's camera switched to person B's clip, it failed as it must (the spec was restored afterwards):
```
  ✘  1 [chromium] › tests/verification-completes.spec.ts:27:1 › an inquiry on the default template completes with every check passed (1.6m)
    Error: expect(locator).toBeVisible() failed
    Expected: visible
    Error: element(s) not found
```

### 5. Compose `app` profile (`infra/`)

RED (`611a1a7`), `infra/tests/compose.test.sh --static-only`:
```
FAIL - .env.example declares OPENVERIFY_MODE
...
FAIL - .env.example keeps webhooks off private networks (expected 'false', got '')
FAIL - app service 'migrate' is in profile 'app'
FAIL - app service 'migrate' waits for objectstore-init to succeed
...
FAIL - dashboard:3000 follows a OPENVERIFY_DASHBOARD_PORT override (expected '127.0.0.1|13001', got '')
# 55 passed, 58 failed
```
GREEN (`28d4add`): `# 113 passed, 0 failed`.

Live smoke test under a throwaway project, with a generated env file (never the developer's project):
```
$ docker compose -p openverify-apps-smoke -f infra/docker-compose.yml --env-file <generated> --profile app up -d --wait --wait-timeout 600 --build
real 2m32.315s   (both images built from scratch, then every healthcheck passed)
api healthy · dashboard healthy · flow healthy · vision healthy · worker running ("worker started")
migrate Exited (0) · objectstore-init Exited (0)
$ docker compose ... --profile app run --rm migrate pnpm --silent --filter @openverify/api seed:dev --json
seed created True, template "Government ID and selfie", 8 scopes
GET  /api/v1/inquiry-templates             200  ['Government ID and selfie']
POST /api/v1/inquiries                     201  status created
POST /api/v1/inquiries/:id/resume          200  flow-url origin http://127.0.0.1:<flow port>
GET  <flow>/                               200  CSP connect-src 'self' http://127.0.0.1:<api port>
POST /api/v1/dashboard/sessions            201  keys ['expires-at', 'token', 'user'], ovu_ token for the seeded admin
GET  <dashboard>/inquiries (no cookie)     307 -> /login
GET  <dashboard>/login                     200
$ docker compose -p openverify-apps-smoke ... down --volumes --remove-orphans; docker image rm openverify/apps:dev openverify/vision:dev
```

### 6. CI (`.github/workflows/ci.yml`)

RED (`c3fd841`), `infra/tests/ci-workflow.test.sh`:
```
FAIL - job 'format' exists
FAIL - job 'e2e' exists
FAIL - format: runs `pnpm format:check`
FAIL - vision: type-checks the fixture tools too (`uv run mypy src tools`)
FAIL - vision: fetches the face weights and faces, so the real-model tests run
FAIL - e2e: pulls the compose infrastructure images
FAIL - e2e: fetches the YuNet and SFace weights
FAIL - e2e: generates the synthetic ID and fake-camera clips
FAIL - e2e: installs Chromium with its system dependencies
FAIL - e2e: runs `pnpm e2e`
...
ok   - actionlint 1.7.12 reports no problems
# 65 passed, 15 failed, 0 skipped
```
GREEN (`7d33e67`): `ok - actionlint 1.7.12 reports no problems`, `# 84 passed, 0 failed, 0 skipped`. The workflow itself has not run on GitHub yet (nothing was pushed).


## Validation (`docs/plans/phase-1.plan.md`, run in order on 2026-10-20)

One script ran every command in sequence, each into its own log. Exit codes and wall-clock seconds:
```
install exit=0 seconds=6        integration exit=0 seconds=14     android exit=0 seconds=49
lint exit=0 seconds=22          vision exit=0 seconds=16          gitleaks exit=0 seconds=1
typecheck exit=0 seconds=12     compose-up exit=0 seconds=4       compose-contract exit=0 seconds=1
format exit=0 seconds=9         compose-down exit=0 seconds=5     ci-contract exit=0 seconds=5
test exit=0 seconds=51          e2e exit=0 seconds=40
```
The excerpts below come from those logs.

```
$ pnpm install --frozen-lockfile
✓ Lockfile passes supply-chain policies (693 entries in 2.2s)
Lockfile is up to date, resolution step is skipped

$ pnpm format:check
All matched files use Prettier code style!
```

**Lint, typecheck and unit tests.** Turbo replayed 7 of 12 packages from its cache in the sequential run, so they were run again uncached after the last code commit (`4c1c3dc`). All 36 tasks executed:
```
$ pnpm exec turbo run lint typecheck test --force
@openverify/api:test:        Tests  818 passed (818)   All files | 97.83 | 91.78 | 98.65 | 97.94
@openverify/checks:test:     Tests  450 passed (450)   All files | 99.81 | 97.84 |   100 |  99.8
@openverify/config:test:     Tests   40 passed (40)    All files |   100 |   100 |   100 |   100
@openverify/contracts:test:  Tests  466 passed (466)   All files |   100 |   100 |   100 |   100
@openverify/core:test:       Tests  201 passed (201)   All files |   100 |   100 |   100 |   100
@openverify/dashboard:test:  Tests  192 passed (192)   All files | 97.61 | 94.76 |   100 | 97.56
@openverify/db:test:         Tests  342 passed (342)   All files |   100 | 96.86 |   100 |   100
@openverify/e2e:test:        Tests   39 passed (39)    All files | 95.87 | 88.46 | 92.59 | 96.73
@openverify/flow:test:       Tests  408 passed (408)   All files | 98.45 | 94.98 | 99.06 | 98.54
@openverify/flow-spec:test:  Tests   81 passed (81)    All files |   100 |   100 |   100 |   100
@openverify/node:test:       Tests   61 passed (61)    All files |   100 |   100 |   100 |   100
@openverify/ui:test:         Tests   50 passed (50)    All files |   100 | 97.72 |   100 |   100
 Tasks:    36 successful, 36 total
Cached:    0 cached, 36 total
```
That is 3,148 unit tests, and every package is at or above 80% on every metric.

```
$ pnpm test:integration
@openverify/db:test:integration:   ✓ src/db.integration.test.ts (10 tests)
@openverify/db:test:integration:   ✓ src/repositories.integration.test.ts (12 tests)
@openverify/api:test:integration:  ✓ src/api.integration.test.ts (2 tests)
@openverify/api:test:integration:  ✓ src/worker.integration.test.ts (4 tests)
 Tasks:    2 successful, 2 total

$ (cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest -rs)
All checks passed!
40 files already formatted
Success: no issues found in 17 source files
Required test coverage of 80% reached. Total coverage: 100.00%
432 passed in 14.65s          # no skips: the real-model tests ran on the fetched weights and faces

$ (cd android && ./gradlew testDebugUnitTest koverVerify assembleDebug lint --rerun-tasks)
BUILD SUCCESSFUL in 49s
158 actionable tasks: 158 executed
# test-results XML: openverify-sdk tests 311 failures 0 errors 0; demo-app tests 10 failures 0 errors 0
$ ./gradlew :openverify-sdk:koverLog
application line coverage: 97.4104%
```

**Compose.** The repository has no developer `.env`, and the developer's `openverify` volumes exist. The plan's compose command was therefore run with `.env.example` under a throwaway project, which was then removed:
```
$ docker compose -p openverify-validate -f infra/docker-compose.yml --env-file .env.example up -d --wait --wait-timeout 240
 Container openverify-validate-redis-1 Healthy
 Container openverify-validate-postgres-1 Healthy
 Container openverify-validate-mailpit-1 Healthy
 Container openverify-validate-objectstore-1 Healthy
$ docker compose -p openverify-validate ... down --volumes --remove-orphans
```

**E2E.** Both suites, in parallel through turbo:
```
$ pnpm e2e
@openverify/flow:e2e:   9 passed (5.3s)
@openverify/e2e:e2e: [e2e +21.1s] stack ready; logs in e2e/.artifacts/logs
@openverify/e2e:e2e:   ✓  1 [chromium] › tests/verification-completes.spec.ts:27:1 › an inquiry on the default template completes with every check passed (6.8s)
@openverify/e2e:e2e:   ✓  2 [chromium] › tests/verification-fails.spec.ts:40:1 › a selfie of a different person fails the face match and the inquiry (5.8s)
@openverify/e2e:e2e: [e2e +36.2s] removing the openverify-e2e compose project and its volumes
@openverify/e2e:e2e:   2 passed (38.0s)
 Tasks:    9 successful, 9 total
```

**Secrets and contract tests:**
```
$ gitleaks git --redact .
INF 186 commits scanned.
INF no leaks found

$ infra/tests/compose.test.sh --static-only
# 113 passed, 0 failed

$ infra/tests/ci-workflow.test.sh
ok   - actionlint 1.7.12 reports no problems
# 84 passed, 0 failed, 0 skipped
```

**Not verified here:**
- The workflow has not run on GitHub (nothing was pushed). Its structure and actionlint are checked locally.
- The live part of `infra/tests/compose.test.sh` was not run. It brings up the developer's own `openverify` project; the throwaway-project runs above cover the same `up --wait`.

## Contract mismatches reviewed

- **Working through the full stack:**
  - the C7 failure transition (`inquiry.status == failed`): the flow reached the failure step;
  - the C2 resume meta and the fragment-only token;
  - the C3 consent, upload and submit shapes from the web flow;
  - the C4 session response and the user resource in the dashboard BFF;
  - the C5 headers (lowercase `openverify-signature`, `openverify-event-id`), checked against `@openverify/node`;
  - the event body, which parses with `eventDocumentSchema`;
  - the `required` check requirement shown in the dashboard;
  - the `verification-config` keys by API type in the seeded and the API-created templates.
- **Android submit body.** The Android SDK submits with a JSON `{}` body, while the web flow sends none. The C3 submit route declares no body schema, so both are accepted.
- **Re-upload after a reload (not fixed, reported).** The flow remembers uploaded kinds only in memory. After a reload between two uploads it reuses the `initiated` verification and uploads a kind again, which the API answers with 409. This is not on the tested path. Fixing it needs an API decision: accept a re-upload of the same kind (last wins), or expose uploaded kinds in the C3 flow view.
- **API key plugin example.** Its JSDoc example used the Phase 0 scope name `inquiry.write`; it now reads `inquiries:write` (`4c1c3dc`).

