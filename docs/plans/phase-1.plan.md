# Plan: Phase 1, the walking skeleton

- **Source:** `docs/PLAN.md` §6, Phase 1
- **Complexity:** Large
- **Runs:** Workflow 1A (build, 9 agents), then Workflow 1B (review, verify, fix; at most 8 agents)

## Summary

This phase builds one thin end-to-end path through every tier:
1. A customer backend creates an inquiry with an API key and gets a hosted-flow link.
2. The end user consents, uploads the front and back of an ID, and takes a selfie.
3. Files are envelope-encrypted into S3-compatible storage.
4. A BullMQ worker calls the vision service, runs the Phase 1 checks and decides the verification statuses.
5. The inquiry moves to `completed` or `failed`, an event is written, and a signed webhook is delivered.
6. An operator logs into the dashboard and sees the inquiry with its checks and images.

The Android SDK starts on the same contracts.

Contracts are fixed in this file before any code is written, so parallel agents agree on them. Golden JSON fixtures in `contracts/fixtures/` check them on every side: TS (zod), Python (pydantic) and Kotlin (kotlinx.serialization).

## Patterns to mirror

| Category | Source | Pattern |
|---|---|---|
| App composition | `apps/api/src/app.ts:36-80` | `buildApp(options)` with injected dependencies (`lookupApiKey`, `now`, `logger`). Routes go in as `app.register(plugin)` so they appear in `/openapi.json` |
| Errors | `apps/api/src/problem-details.ts`, `apps/api/src/errors.ts` | Typed errors mapped to RFC 9457 problem+json. `type: about:blank`. Validation errors carry an `errors` extension |
| Auth | `apps/api/src/plugins/api-key-auth.ts:26-110` | `ApiKeyLookup` is injected; bearer parsing; scopes |
| Logging | `apps/api/src/logger.ts` | pino with central redaction paths |
| Data access | `packages/db/src/schema.ts:25-93`, `packages/db/src/api-keys.ts` | Drizzle `pgTable` plus `$inferSelect`/`$inferInsert` types. Hashed secrets with a pepper |
| PII at rest | `packages/db/src/crypto.ts:231-300` | `encrypt`/`decrypt` envelope helpers, the `encrypted()` column, keyring rewrap |
| Domain | `packages/core/src/inquiry-state-machine.ts`, `decision-engine.ts`, `check-registry.ts` | Pure functions, zod enums, `DomainError` subclasses |
| Flow definitions | `packages/flow-spec/src/flow.ts` | `parseFlow()` performs semantic validation beyond the JSON Schema |
| Vision | `services/vision/src/openverify_vision/app.py`, `auth.py`, `imaging.py` | FastAPI with an `x-service-token` dependency, safe decoding, problem+json |
| Tests | `apps/api/src/app.test.ts`, `packages/db/src/db.integration.test.ts`, `apps/flow/e2e/*.spec.ts`, `services/vision/tests/` | Vitest colocated `*.test.ts` and `*.integration.test.ts` (Testcontainers); Playwright e2e; pytest |
| Vitest config | `packages/config/src/vitest.ts` | Every package uses `createVitestConfig()`, which enforces the 80% gate |

## Locked contracts

### C1. Identifiers and HTTP conventions
- **IDs** have the form `<prefix>_<ULID>`: 26 characters of uppercase Crockford base32. The prefixes are:

  | Prefix | Object |
  |---|---|
  | `org` | organization |
  | `env` | environment |
  | `key` | API key |
  | `usr` | user |
  | `uss` | user session |
  | `itmpl` | inquiry template |
  | `itmplv` | template version |
  | `inq` | inquiry |
  | `iqse` | inquiry session |
  | `ver` | verification |
  | `file` | file |
  | `evt` | event |
  | `wbh` | webhook |
  | `whd` | webhook delivery |
- **Base path:** `/api/v1`. JSON:API-style bodies with kebab-case attribute names.
- **Single resource:** `{ "data": { "type", "id", "attributes", "relationships"? }, "included"? }`.
- **Lists:** `{ "data": [...], "links": { "next": string|null } }`, using cursor `page[after]=<id>` and `page[size]` (at most 100).
- **Resource `type` values:**
  - `inquiry`
  - `inquiry-template`
  - `inquiry-session`
  - `verification/government-id`
  - `verification/selfie`
  - `file`
  - `event`
  - `webhook`
  - `api-key`
  - `user`
- **Timestamps** are ISO-8601 UTC strings, for example `created-at`.
- **Errors** are `application/problem+json` (RFC 9457). Every response carries the `x-request-id` header.
- **Auth schemes:**

  | Caller | Header | Token |
  |---|---|---|
  | Server API | `Authorization: Bearer <api key>` | existing format, scopes enforced |
  | Hosted flow and Android | `Authorization: Bearer <session token>` | `ovs_<43 base64url chars>`. Stored only as a SHA-256 hash, TTL 24 h. It reaches the flow as a URL fragment (below) |
  | Dashboard BFF to API | `Authorization: Bearer <user session token>` | `ovu_<43 base64url chars>`. Stored hashed, TTL 12 h |

### C2. Server API (API-key auth)

| Method and path | Scope | Purpose |
|---|---|---|
| `POST /api/v1/inquiry-templates` | `inquiry-templates:write` | Create a template and its first version. Attributes: `name`, `flow` (flow-spec), `verification-config` (map of verification type to `{ checks: { <check_id>: { enabled, required } } }`). |
| `GET /api/v1/inquiry-templates/:id` | `inquiry-templates:read` | Fetch one template. |
| `GET /api/v1/inquiry-templates` | `inquiry-templates:read` | List templates. |
| `POST /api/v1/inquiries` | `inquiries:write` | Create an inquiry. Attributes: `inquiry-template-id` (required), `reference-id`, `fields` (object). Status starts as `created`. |
| `GET /api/v1/inquiries/:id` | `inquiries:read` | `?include=verifications`. Verification attributes include `checks: [{ name, status, reasons, requirement, metadata }]`. |
| `GET /api/v1/inquiries` | `inquiries:read` | `filter[status]`, `filter[reference-id]`, cursor pagination. |
| `POST /api/v1/inquiries/:id/resume` | `inquiries:write` | Returns the inquiry plus `meta: { session-token, flow-url }`, where `flow-url = ${OPENVERIFY_FLOW_PUBLIC_URL}/#inquiry-id=<id>&session-token=<token>`. The fragment never reaches servers or `Referer`. |
| `GET /api/v1/verifications/:id` | `verifications:read` | Fetch a verification with its checks. |
| `POST /api/v1/webhooks` | `webhooks:write` | Attributes: `url`, `enabled-events` (list or `["*"]`). The response carries `secret` once (`wbhsec_...`); afterwards only the last 4 characters are shown. |
| `GET /api/v1/webhooks`, `GET /api/v1/webhooks/:id` | `webhooks:read` | Fetch webhooks. |
| `PATCH /api/v1/webhooks/:id` | `webhooks:write` | Change `url`, `enabled-events` or `status` (`enabled`/`disabled`). |
| `GET /api/v1/events/:id` | `events:read` | Fetch one event. |

**Tenant isolation:** every query is scoped by `environment_id` from the authenticating key. A resource from another environment returns **404**, never 403.

### C3. Flow API (session-token auth; used by `apps/flow` and Android)

| Method and path | Purpose |
|---|---|
| `GET /api/v1/flow/session` | Returns `{ inquiry: {id, status}, flow: <flow-spec>, verifications: [...], consent: { accepted-at } | null }`. The first call moves the inquiry from `created` to `pending` (`inquiry.started`). |
| `POST /api/v1/flow/consent` | Body `{ "accepted": true, "text-keys": [..], "locale": "en" }`. Stores a consent record with the user agent, IP and timestamp. Required before any file upload; otherwise 409. |
| `POST /api/v1/flow/verifications` | Body `{ "type": "government-id" \| "selfie", "country"?, "id-class"? }`. Returns a `verification/*` with status `initiated`. |
| `POST /api/v1/flow/verifications/:id/files` | Multipart field `file` plus field `kind`. `kind` is `front`, `back` or `portrait` for an ID, or `selfie-center`, `selfie-left` or `selfie-right` for a selfie. Accepts JPEG, PNG or WebP, sniffed by magic bytes, up to 10 MB. Returns `file`. |
| `POST /api/v1/flow/verifications/:id/submit` | Validates the required files, sets status `submitted`, enqueues a `process-verification` job, emits `verification.submitted`. |
| `GET /api/v1/flow/verifications/:id` | Polled by the client for status and user-facing retry hints (`user_behavior` check reasons only, never fraud details). |

### C4. Dashboard API (user-session auth; `apps/dashboard` calls it server-side as a BFF)

| Method and path | Purpose |
|---|---|
| `POST /api/v1/dashboard/sessions` | Body `{ email, password }`. Verifies with Argon2id and returns `{ token, expires-at, user }`. Rate-limited per IP and per email. Failures always give the same generic 401. |
| `DELETE /api/v1/dashboard/sessions/current` | Logs out. |
| `GET /api/v1/dashboard/me` | Returns the current user. |
| `GET /api/v1/dashboard/inquiries` | Same filters as the server API, scoped to the user's environment. |
| `GET /api/v1/dashboard/inquiries/:id` | Inquiry, verifications, checks and file metadata. |
| `GET /api/v1/dashboard/files/:id/content` | Decrypts and streams the image with `Cache-Control: private, no-store`. Writes an audit log entry (`file.viewed`). |

### C5. Events and webhooks
- **Event names (Phase 1):**
  - `inquiry.created`
  - `inquiry.started`
  - `inquiry.completed`
  - `inquiry.failed`
  - `verification.created`
  - `verification.submitted`
  - `verification.passed`
  - `verification.failed`
- **Event resource:** `{ type: "event", id: "evt_...", attributes: { name, payload: { data: <resource>, included? }, created-at } }`.
- **Delivery request:**
  - Method and body: `POST <url>`, body = the event resource document `{ "data": <event> }`.
  - Headers: `content-type: application/json`, `user-agent: OpenVerify-Webhooks/1`, `openverify-event-id`.
- **Signature header:** `OpenVerify-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
  - During secret rotation (Phase 2) a second `v1=` value may follow, separated by a space.
  - Verifiers must accept any matching `v1`, compare in constant time and enforce a 300 s tolerance.
- **`@openverify/node` (new package `packages/node`)** exports `signWebhookPayload(body, secret, timestamp)` and `verifyWebhookSignature({ body, header, secrets, toleranceSeconds = 300, now })`. The API uses the first; customers and the e2e receiver use the second.
- **Delivery behaviour:**
  - 10 s timeout. A 2xx response is success. Up to 5 attempts with exponential backoff and jitter.
  - Each attempt is recorded in `webhook_deliveries`.
  - **SSRF guard:** resolve the host, reject private, loopback, link-local, CGNAT, multicast and metadata ranges (IPv4 and IPv6), and connect to the *resolved* IP so DNS rebinding cannot redirect the request.
  - The private-range block is lifted only when `OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS=true`, and that flag is refused at startup in `production` mode.
  - Redirects are not followed.

### C6. Vision internal API (service token; called only by the API worker)

`x-service-token: <OPENVERIFY_VISION_SERVICE_TOKEN>`. Multipart requests; JSON (snake_case) responses.

**`POST /v1/analyze/government-id`**
- Fields: `front` (required), `back` (optional).
- Response:
  ```json
  {"model_versions":{"detector":"yunet-2026may","recognizer":"sface-2021dec"},
   "sides":{"front":{"quality":{"blur_score":..,"is_blurry":..,"glare_ratio":..,"has_glare":..,"brightness":..,"is_too_dark":..,"is_too_bright":..},
                     "faces":[{"bbox":[x,y,w,h],"score":..}],"portrait":{"bbox":[..],"score":..,"embedding":[128 floats]}|null},
            "back":{...same, portrait null...}|null}}
  ```

**`POST /v1/analyze/selfie`**
- Field: `center` (required). `left` and `right` are optional and ignored by Phase 1 checks.
- Response:
  ```json
  {"model_versions":{...},"poses":{"center":{"quality":{...},"faces":[...],"face":{"bbox":..,"score":..,"embedding":[128]}|null}, "left":..|null, "right":..|null}}
  ```

**`POST /v1/embed/face`**
- Field: `image`.
- Response: `{"model_versions":..,"face":{...}|null,"face_count":n}`.

**Existing endpoints:** `GET /health` and `POST /v1/quality` stay as they are.

**Face match is computed in TS** (`packages/checks/src/face-match.ts`): cosine similarity of the SFace embeddings, with a default threshold of 0.363 (OpenCV Zoo's SFace cosine threshold). The result is reported with a `beta` confidence. Embeddings are **not persisted** in Phase 1; they are biometric data, and Phase 4 adds storage with retention.

### C7. Flow definition and checks in the default template
- **`flow`:**
  1. `consent` (required; keys `consent.biometric` and `consent.processing`)
  2. `government_id` (sides `both`; capture methods `upload` and `camera`)
  3. `selfie` (pose `center`, liveness `passive`)
  4. `completion`

  The failure path ends in a `failure` step.
- **Checks enabled and required in Phase 1:**

  | Verification | Check | Source |
  |---|---|---|
  | government ID | `id_blur_detection` | vision `quality.is_blurry` |
  | government ID | `id_glare_detection` | vision `has_glare` |
  | government ID | `id_portrait_detection` | a portrait was found on the front |
  | government ID | `id_double_side_detection` | front and back are both present when the step needs `both`; real logic |
  | selfie | `selfie_image_quality_detection` | blur and brightness of the center image |
  | selfie | `selfie_multiple_faces_detection` | more than one face in the center image fails |
  | selfie | `selfie_id_comparison` | face match against the ID portrait; the `id_selfie_comparison` mirror is optional |
- **All other checks are disabled** in this template.
- **Never fabricate a result.** If an enabled check has no implementation, it returns `pending` with reason `not_implemented`. The decision engine then keeps the verification undecided.
- **Inquiry status:**
  - When every verification required by the flow has passed, the inquiry becomes `completed`.
  - When any verification fails after its last attempt, the inquiry becomes `failed`.
  - When a verification fails and attempts remain, the flow shows retry hints. A user retry creates a new verification.

### C8. Shared golden fixtures (`contracts/fixtures/`)

| File | Validated by |
|---|---|
| `api/inquiry.json`, `api/inquiry-with-verifications.json`, `api/verification-government-id.json`, `api/verification-selfie.json`, `api/flow-session.json`, `api/webhook-event-inquiry-completed.json`, `api/problem.json` | zod, Kotlin |
| `flows/default-gov-id-selfie.json` | `parseFlow`, Kotlin |
| `vision/analyze-government-id.json`, `vision/analyze-selfie.json`, `vision/embed-face.json` | pydantic, zod |
| `webhooks/signature-vectors.json` | Known secret, timestamp, body and expected header. Checked by `packages/node` and by Kotlin, if the SDK ever verifies |

Fixtures contain synthetic data only.

## Files to change

| Path | Action | Owner (Workflow 1A agent) |
|---|---|---|
| `packages/contracts/**` (new, `@openverify/contracts`): zod schemas for C1–C5, ID helpers, event names, resource builders | CREATE | contracts |
| `packages/node/**` (new, `@openverify/node`): webhook sign and verify | CREATE | contracts |
| `contracts/fixtures/**` (api, flows, webhooks) | CREATE | contracts |
| `contracts/fixtures/vision/**` | CREATE | vision |
| `apps/api/src/ports.ts`: interfaces `FileStorage`, `VerificationQueue`, `EventPublisher`, `VisionClient`, `Clock`, `IdGenerator`. Also stub plugin and factory files with fixed export names | CREATE | contracts |
| `packages/db/**`: schema v1, migration `0001_schema_v1.sql`, repositories, integration tests | UPDATE | db |
| `services/vision/**`, `scripts/fetch_fixtures.py`, `fixtures/manifest.json` (public-domain faces, SHA-256 pinned, gitignored payloads), a synthetic ID generator | UPDATE/CREATE | vision |
| `apps/api/src/{config.ts,server.ts,container.ts,app.ts,routes/server/**,routes/flow/**,storage/**,auth/**,services/**}`, `apps/api/scripts/seed-dev.ts`, `docs/api/openapi.json` snapshot | UPDATE/CREATE | api-http |
| `apps/api/src/{worker.ts,jobs/**,vision/**,events/**,webhooks/**}`, `packages/checks/src/face-match.ts` and the Phase 1 check evaluators (`packages/checks/src/phase1/**`) | CREATE | api-worker |
| `apps/flow/**` | UPDATE | flow-web |
| `apps/dashboard/**`, `apps/api/src/routes/dashboard/**`, `apps/api/src/operator-auth/**` | UPDATE/CREATE | dashboard |
| `android/**` | UPDATE | android |
| `e2e/**` (new root Playwright project), `infra/docker-compose.yml` (app services), `.github/workflows/ci.yml` (e2e and format jobs), `pnpm-workspace.yaml`, root `package.json`, `.env.example` | UPDATE/CREATE | e2e-integration |

## Tasks (Workflow 1A)

**Stage 1 (parallel):**
- **contracts:** C1–C5 and C7–C8 (except the vision fixtures) as zod with tests; `packages/node`; `ports.ts` and stubs.
- **db:** schema v1:
  - `users` (email unique per org, `argon2id` hash)
  - `user_sessions`
  - `inquiry_templates` and `inquiry_template_versions` (flow and verification config, both jsonb)
  - `inquiries` (`status`, `reference_id`, encrypted `fields`)
  - `inquiry_sessions` (hashed token, expiry, consent record)
  - `verifications`
  - `verification_checks`
  - `files` (S3 key, kind, mime, size, sha256, wrapped DEK)
  - `events`
  - `webhooks` (encrypted secret)
  - `webhook_deliveries`
  - `audit_logs`

  Requirements for every table: `environment_id`, indexes for every query in C2–C5, an `updated_at` trigger or app-level update, a Testcontainers test per repository, and the migration creating `vector`.
- **vision:** C6 endpoints with YuNet and SFace; public-domain face fixtures fetched with pinned hashes; a synthetic ID front and back generator (PIL, with the portrait pasted in); a fake-camera `.y4m` generator for Playwright; pydantic models validated against the `contracts/fixtures/vision/*.json` fixtures it writes.

**Stage 2 (parallel, after contracts and db):**
- **api-http:**
  - config: a zod-parsed env;
  - S3 storage over the AWS SDK v3 client, with per-file envelope encryption;
  - C2 and C3 routes;
  - DB-backed API-key lookup;
  - CORS allowlist for the flow origin;
  - the server entrypoint;
  - a dev seed: org, sandbox env, API key, admin user, default template;
  - the OpenAPI snapshot test.
- **api-worker:**
  - the BullMQ `process-verification` worker: decrypt files, call vision, evaluate the C7 checks, run `decideVerification`, run the inquiry transitions;
  - the event publisher;
  - the webhook dispatcher queue with SSRF guard and retries;
  - `face-match`;
  - the vision client, validated against the fixtures.
- **flow-web:**
  - session bootstrap from the URL fragment, which is then cleared;
  - the flow-spec renderer for consent, government ID (upload and camera), selfie (camera, with an upload fallback in sandbox only) and completion;
  - polling with retry hints;
  - i18n in en and es;
  - CSP and Permissions-Policy meta;
  - Playwright tests against a mocked API.
- **dashboard:**
  - C4 API routes and the Argon2id auth service;
  - Next BFF: login server action, httpOnly cookie, server components for the inquiry list and detail, an image proxy route;
  - remove `sharp` (`ignoredOptionalDependencies`, `images.unoptimized`).
- **android:**
  - `openverify-sdk` data models for C1–C3 with kotlinx.serialization, tested against the fixtures;
  - a flow API client (OkHttp + MockWebServer);
  - a Compose renderer for consent and completion;
  - CameraX capture screens for the government ID and selfie steps (the logic unit-tested, the UI checked with Robolectric);
  - `OpenVerifyInquiryContract` (ActivityResultContract);
  - the demo app wiring.

**Stage 3:** **e2e-integration**
- Wire everything, then fix any contract mismatches.
- Add app services to compose.
- Add a root Playwright e2e project. It:
  1. seeds;
  2. creates a template and an inquiry with the API key;
  3. creates a webhook pointing at a local receiver;
  4. opens `flow-url` in Chromium with the fake camera;
  5. uploads the synthetic ID;
  6. takes the selfie;
  7. waits for `inquiry.completed`;
  8. verifies the webhook signature with `@openverify/node`;
  9. logs into the dashboard and asserts the inquiry status and checks.

  A negative case with a different face must give `selfie_id_comparison` failed and the inquiry `failed`.
- CI jobs for e2e and `format:check`.
- Full-suite run.

## Validation

```bash
source scripts/env.sh
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm format:check
pnpm test                                     # every package ≥80%
pnpm test:integration                         # Testcontainers: db, api
(cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src && uv run pytest)
(cd android && ./gradlew testDebugUnitTest koverVerify assembleDebug lint)
docker compose -f infra/docker-compose.yml --env-file .env up -d --wait
pnpm e2e                                      # flow mock tests + full-stack Phase 1 e2e
gitleaks git --redact .
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Parallel agents collide in `apps/api` | Med | Path ownership per agent, `ports.ts` and stubs locked first, and the integration agent owns wiring |
| Face fixtures with real people's faces | Med | Public-domain sources only (for example US federal government portraits), fetched at test time with SHA-256 pins and never committed. Documented in the fixtures manifest |
| Fake camera in Chromium is flaky | Med | `.y4m` generated deterministically; `--use-fake-ui-for-media-stream`; upload fallback for the ID |
| SFace threshold miscalibrated on synthetic ID portraits | Med | `beta` stage; calibration is deferred to Phase 4; e2e asserts only a clear match and a clear non-match |
| SSRF through webhook URLs | High impact | Resolve-then-connect guard, no redirects, private ranges allowed only outside production, and security review in 1B |
| Session token leakage | Med | URL fragment instead of query, hashed at rest, short TTL, `Referrer-Policy: no-referrer` |
| Lockfile churn between agents | High | `flock` around pnpm; lockfile commits allowed in any slice; the integration agent makes the final lockfile commit |

## Acceptance
- [ ] Every Validation command passes locally and in CI on GitHub.
- [ ] The full-stack e2e passes for both the positive and the negative case, and the webhook signature verifies.
- [ ] Every Workflow 1B finding rated CRITICAL or HIGH is fixed or refuted, with evidence.
- [ ] `docs/tdd/phase1-*.tdd.md` exists for each slice, and `docs/PROGRESS.md` is updated.
- [ ] The contracts in this file match the code, and the OpenAPI snapshot is committed.
