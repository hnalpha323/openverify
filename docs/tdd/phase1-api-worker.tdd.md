# TDD evidence: Phase 1, api-worker

Slice owner: api-worker agent (Workflow 1A, Stage 2). Date: 2026-10-20.

Owned paths:
- `apps/api/src/{worker.ts, jobs/**, vision/**, events/**, webhooks/**}`;
- `packages/checks/src/face-match.ts`, `packages/checks/src/phase1/**`, and two appended export lines in `packages/checks/src/index.ts`;
- `apps/api/package.json` (dependencies and the `dev:worker` script);
- one `allowBuilds` entry in `pnpm-workspace.yaml` (`msgpackr-extract: false`);
- this file.

## Plan task

From `docs/plans/phase-1.plan.md`, Stage 2 "api-worker":
- the BullMQ `process-verification` worker: decrypt the files, call vision, evaluate the C7 checks, run `decideVerification`, run the inquiry transitions;
- the event publisher;
- the webhook dispatcher queue, with the SSRF guard and retries;
- `face-match`;
- the vision client, validated against the fixtures.

## What was built

| Module | Purpose |
|---|---|
| `packages/checks/src/face-match.ts` | `faceMatch(a, b, { threshold = 0.363 })` and `cosineSimilarity`. Both vectors must be 128 finite numbers with a non-zero norm; otherwise `InvalidFaceEmbeddingError(embedding, issue)`, whose message never echoes a value. |
| `packages/checks/src/phase1/*` | Pure C7 evaluators: `idBlurDetection`, `idGlareDetection`, `idPortraitDetection`, `idDoubleSideDetection`, `selfieImageQualityDetection`, `selfieMultipleFacesDetection`, `selfieIdComparison`. `evaluateGovernmentIdChecks` and `evaluateSelfieChecks` run the template's enabled checks in configuration order. An enabled check without an evaluator returns `pending` with reason `not_implemented`. |
| `apps/api/src/vision` | `createVisionClient({ baseUrl, serviceToken, timeoutMs })`: multipart uploads with `x-service-token`, zod schemas mirroring the pydantic models, and typed errors (`VisionUnavailableError`, `VisionServiceError`, `VisionResponseError`, each with `retryable`). |
| `apps/api/src/webhooks/ssrf.ts` | `classifyAddress`, `isAddressAllowed`, `webhookNetworkPolicyFromEnv` (refuses `OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` in production). |
| `apps/api/src/webhooks/http-sender.ts` | `createGuardedWebhookSender`: an undici `Agent` whose `connect.lookup` resolves the host, vets every address and answers with the vetted one. It refuses literal IP hosts up front, never follows redirects and has a 10 s deadline. |
| `apps/api/src/webhooks/queue.ts`, `dispatcher.ts` | The `webhook-delivery` queue (one job per attempt, id `<whd id>-<attempt>`). `deliverWebhook` signs with `signWebhookPayload`, sends the C5 headers, records every attempt, and retries non-2xx answers with exponential backoff and equal jitter, up to 5 attempts. `sweepDueWebhookDeliveries` re-enqueues overdue deliveries. |
| `apps/api/src/events/index.ts` | `createEventPublisher({ db, deliveries, ids, logger })`: `stage` (events row plus delivery rows, in the caller's transaction), `dispatch` (enqueue after commit) and `publish` (both). |
| `apps/api/src/jobs/*` | `createVerificationQueue` (job id = verification id), `processVerification`, `decideInquiryOutcome`, record mappers, `PermanentJobError`, `isPermanentJobFailure`, the redacting `createWorkerLogger`, and `workerSettingsFromEnv`. |
| `apps/api/src/worker.ts` | `startWorkers` (both BullMQ workers plus a 30 s sweep), `main(env)` and the `dev:worker` script. |

## Decisions taken while building

- **When an inquiry ends (C7).** Each verification type the flow requires is judged on its latest verification.
  - The inquiry **completes** once the latest verification of every required type passed.
  - It **fails** once a required type has no attempt left: its latest verification failed, and either the failure is not retryable (a required `fraud` check failed, the core decision engine's `retryable: false`) or `maxAttempts` attempts of that type have failed.
  - Otherwise it stays `pending`.

  A fraud failure ends the inquiry at once, because retry hints only ever name `user_behavior` checks. A retry would show the user nothing to fix, and it would let an attacker probe the face matcher. This is also what the planned negative e2e case needs: one different-face selfie must make the inquiry `failed`. The inquiry does not wait for the other verifications once one is exhausted, because the default flow routes a failed inquiry to its `failure` step.
- **Concurrency of the two verifications of one inquiry.** Step 5 (the verification status, its checks and its event) commits before step 6 (settling the inquiry) starts, in a second transaction. Whatever the interleaving, the later of the two settle reads therefore sees both results. The conditional update in `transitionInquiryStatus` (`where status = 'pending'`) lets only one job move the inquiry and publish `inquiry.completed`. Settling is idempotent and also runs when the job finds its verification already processed, which repairs a crash between the two steps on retry. The integration test enqueues the ID and the selfie together against real Postgres.
- **Outbox for webhooks.** Event and delivery rows are written in the same transaction as the status change they announce. Delivery jobs are enqueued after the commit. If that enqueue fails, the rows stay `pending` and the sweep re-enqueues them. A committed event is never lost, and job ids keep re-enqueues idempotent. The database row, not the queue, decides the attempt number: a job for an attempt already recorded does nothing.
- **Retries.**
  - `process-verification`: 5 attempts, exponential backoff from 5 s with jitter 0.5. `PermanentJobError`, a vision error with `retryable: false`, a `DomainError` or a `ZodError` becomes BullMQ's `UnrecoverableError`, so the job fails at once.
  - Permanent failures include a missing, tampered or digest-mismatched file, a missing front or center image, an invalid template, and a vision 4xx or contract mismatch.
  - Failed jobs change no status and are logged by id and error class.
  - Webhooks: the dispatcher schedules each retry itself, after about 30 s, 2 min, 8 min and 32 min (each with up to half removed as jitter), up to 5 attempts. A destination the guard refuses fails at once. BullMQ's own retries (3) only cover infrastructure errors.
- **SSRF guard.**
  - Categories: public, unspecified, loopback, private, CGNAT, link-local, metadata, multicast, broadcast, documentation, benchmarking, reserved.
  - IPv4-mapped (`::ffff:0:0/96`) and NAT64 (`64:ff9b::/96`) addresses take the category of the IPv4 address they embed. Everything outside `2000::/3`, and 6to4, Teredo, `2001::/23` and `3fff::/20`, is refused.
  - Specific metadata addresses (`169.254.169.254`, `169.254.170.2`, `100.100.100.200`, `168.63.129.16`, `192.0.0.192`, `fd00:ec2::/32`, `fd20:ce::254`) are matched before their ranges, so `allowPrivateNetworks` (which lifts only loopback, private and CGNAT) never opens them.
  - A DNS answer with any refused address is refused as a whole.
  - The flag accepts only `true` or `false`.
- **Biometric data.**
  - Embeddings are compared in memory and never persisted or logged. Check metadata holds scores only (`similarity`, `threshold`, `confidence`, `confidence_stage: beta`, `id_verification_id`).
  - Decrypted image buffers are overwritten after the vision call.
  - The worker logger adds redaction paths for `embedding`, `bytes`, `ciphertext`, `secret`, `serviceToken` and `body` at any depth.
  - The selfie job sends only the center pose to vision (C6: left and right are ignored in Phase 1), and decrypts the ID front only when `selfie_id_comparison` is enabled.
- **Check details.**
  - `id_double_side_detection` reports a back that is byte-identical to the front (same SHA-256) as `back_not_present` with `back_identical_to_front: true`. It is `not_applicable` for a single-sided step once that side is present.
  - `selfie_multiple_faces_detection` passes a selfie with no face, because `selfie_image_quality_detection` reports `face_not_present`.
  - `selfie_id_comparison` fails with `id_portrait_not_present` when the inquiry has no passed or submitted ID, the ID has no front, or the fresh analysis of the front finds no portrait. A comparison that cannot run never passes.
  - The confidence is a margin to the threshold, scaled to [0, 1] and uncalibrated, hence `beta`.
- **Configuration.** The worker reuses the API's `loadConfig` for the shared variables (database, Redis URL, S3, KEK, vision), so both processes read the same names. It adds `OPENVERIFY_WORKER_CONCURRENCY` and `OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS`.
- **The file encryption context** is the file id, as `NewFileInput` documents and the API's upload service uses.
- **Dependencies.**
  - `bullmq@6.3.11` with `ioredis@5.11.1` (BullMQ 6 takes ioredis as an optional peer), `undici@7.30.1` (the version testcontainers already locks; undici 8 requires Node 22.19 or later, while the repository allows 22.18), and `pino@10.4.0` (fastify's version).
  - `msgpackr-extract` (an optional native accelerator of msgpackr) has its build script denied; msgpackr falls back to pure JS.

## RED and GREEN

Every run used `source scripts/env.sh` first. Unit RED and GREEN runs used `pnpm exec vitest run --coverage.enabled=false <paths>` in the package directory. Each RED state was committed as `test(...)` before its implementation.

### 1. Face match and the Phase 1 evaluators (`packages/checks`)

RED (`0d65b47`), `pnpm exec vitest run --coverage.enabled=false src/face-match.test.ts src/phase1`:
```
 FAIL  src/phase1/government-id-checks.test.ts
Error: Cannot find module './government-id-checks.js' imported from .../government-id-checks.test.ts
 FAIL  src/phase1/selfie-checks.test.ts
Error: Cannot find module '../face-match.js' imported from .../selfie-checks.test.ts
 Test Files  4 failed (4)
      Tests  no tests
```
GREEN (`4e0d9fe`), same command:
```
 Test Files  4 passed (4)
      Tests  78 passed (78)
```
`pnpm test` (whole package, coverage gate): `Test Files 17 passed (17)`, `Tests 450 passed (450)`, `All files | 99.81 | 97.84 | 100 | 99.8`. The first typecheck and lint run then failed on test typing (a `left` pose missing from the input type, generic helpers and non-null assertions); the tests were corrected in the same commit.

### 2. Vision client (`apps/api/src/vision`)

RED (`54d1092`), `pnpm exec vitest run --coverage.enabled=false src/vision`:
```
      1 Error: Cannot find module './schemas.js' imported from .../schemas.test.ts
      5 NotImplementedError: createVisionClient is not implemented yet (owner: api-worker)
      6 AssertionError: The instanceof assertion needs a constructor but undefined was given.
      2 AssertionError: expected function to throw an error, but it didn't
 Test Files  2 failed (2)
      Tests  23 failed (23)
```
GREEN (`104cbcb`): `Test Files 2 passed (2)`, `Tests 51 passed (51)`. The contract tests parse all three `contracts/fixtures/vision/*.json` files unchanged and reject 21 out-of-contract variants.

### 3. SSRF guard and guarded sender (`apps/api/src/webhooks`)

RED (`a108ccb`):
```
Error: Cannot find module './ssrf.js' imported from .../webhooks/ssrf.test.ts
Error: Cannot find module './http-sender.js' imported from .../webhooks/http-sender.test.ts
 Test Files  2 failed (2)
      Tests  no tests
```
The first GREEN run failed because of a test bug, not the implementation: `TypeError: respond is not a function`, then `Test timed out in 5000ms`. The receiver handler was only assigned in `afterEach`. With a default handler (`2787564`):
```
 Test Files  2 passed (2)
      Tests  211 passed (211)
```
That is a table of 81 addresses checked for category and for both policies, the invalid literals, the production refusal, and sender cases:
- loopback delivery;
- refusals without a connection (literals `[::1]`, `[::ffff:127.0.0.1]`, `0x7f.1`, `2130706433`, `localhost`, a mixed DNS answer, metadata with private networks allowed);
- the pinned connection keeping `Host`;
- no redirect following;
- timeout, refused connection and DNS errors;
- invalid URLs;
- no URL in error messages.

### 4. Event publisher, delivery queue and dispatcher

RED (`54759c3`):
```
Error: Cannot find module '../webhooks/queue.js' imported from .../events/index.test.ts
Error: Cannot find module './dispatcher.js' imported from .../webhooks/dispatcher.test.ts
Error: Cannot find module './queue.js' imported from .../webhooks/queue.test.ts
 Test Files  3 failed (3)
      Tests  no tests
```
GREEN (`55b2193`): `Test Files 3 passed (3)`, `Tests 26 passed (26)`. These tests run on PGlite (`@openverify/db/testing`) and check the signature with `verifyWebhookSignature`.

The worker logger (`jobs/logger.ts`) was written with the dispatcher, before its test. Its test was checked by mutation instead: with `WORKER_REDACT_PATHS` removed from the redact list, the test failed:
```
 FAIL  src/jobs/logger.test.ts > createWorkerLogger > redacts embeddings, image bytes, secrets, bodies and credentials at any depth
AssertionError: expected '[{"level":40,"time":1792479329672,"pi…' not to contain '0.123456'
      Tests  1 failed | 4 passed (5)
```
With the paths restored: `Tests 5 passed (5)`.

### 5. Verification queue, inquiry outcome and `processVerification`

RED (`38e62da`), `pnpm exec vitest run --coverage.enabled=false src/jobs`:
```
      2 NotImplementedError: createVerificationQueue is not implemented yet (owner: api-worker)
      1 AssertionError: expected undefined to be 'process-verification' // Object.is equality
      1 Error: Cannot find module './inquiry-outcome.js' imported from .../inquiry-outcome.test.ts
      1 Error: Cannot find module './process-verification.js' imported from .../process-verification.test.ts
 Test Files  3 failed | 1 passed (4)
      Tests  9 failed | 5 passed (14)
```
The first GREEN run found a real bug:
```
 FAIL  src/jobs/process-verification.test.ts > processVerification: government ID > keeps a verification undecided when an enabled check has no evaluator
AssertionError: expected [ 'verification.submitted' ] to deeply equal []
```
An undecided verification stays `submitted`, and the worker had published `verification.submitted` a second time. The API already announces that event on submit. After the fix (`0486cc4`):
```
 Test Files  4 passed (4)
      Tests  69 passed (69)
```
`phase1-contract.test.ts`, added in the same commit, checks that the evaluators emit exactly the reason codes of `PHASE1_CHECK_REASONS` and evaluate exactly `PHASE1_CHECKS`.

### 6. Worker entrypoint and settings

RED (`1995b61`):
```
Error: Cannot find module './worker.js' imported from .../src/worker.test.ts
Error: Cannot find module './worker-config.js' imported from .../jobs/worker-config.test.ts
 Test Files  2 failed (2)
      Tests  no tests
```
The first commit attempt was blocked by the gitleaks pre-commit hook: `RuleID: generic-api-key` on a synthetic pepper literal in `worker.test.ts`. The literals were replaced with low-entropy `'x'.repeat(n)` values; there was no bypass and no ignore entry. GREEN (`2ad7206`): `Test Files 2 passed (2)`, `Tests 22 passed (22)`.

### 7. Integration (Testcontainers `pgvector/pgvector:pg17` and `valkey/valkey:9.1`)

The integration test was written after the unit-tested pieces were GREEN (`dbd0f17`). Command: `pnpm exec vitest run --config vitest.integration.config.ts src/worker.integration.test.ts`:
```
 ✓ ... passes both verifications, completes the inquiry and delivers signed webhooks 379ms
 ✓ ... fails the selfie of a different face and the inquiry, and says so by webhook 477ms
 ✓ ... processes a verification once however often it is enqueued 1241ms
 ✓ ... never logged an embedding or an image 1ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```
The test was checked by mutation. With the first case forced to a different selfie face:
```
     × passes both verifications, completes the inquiry and delivers signed webhooks 566ms
AssertionError: expected 'failed' to be 'completed' // Object.is equality
      Tests  1 failed | 3 passed (4)
```
One early run reported `Tests 1 failed | 3 passed (4)`, and its details were not captured. Four reruns passed.
- The likely cause, found by reading the test: it read `webhook_deliveries` as soon as the receiver had the requests, but the dispatcher records an attempt only after the response.
- The assertion now polls for the recorded attempts. Three further runs passed, as did a run after the refactor. The cause was not confirmed by reproducing it.

### 8. Refactor

`1fae36f`: `deliverWebhook` now delegates signing and sending to `attemptDelivery`. `settleInquiry` reports the status it reads back when another job settled the inquiry first. Afterwards: `Test Files 16 passed (16)`, `Tests 392 passed (392)` (all of my unit suites), and the integration test passed (`Tests 4 passed (4)`).

`4cb3b53` added coverage tests that were written after the code: the lazy BullMQ queue factory, the record mappers, a sender bug that is rethrown without recording an attempt, a non-Phase-1 stored event, and the descriptions of `ZodError` and `DomainError` failures.

## Final gates

| Package | Command | Result |
|---|---|---|
| `@openverify/checks` | `pnpm --filter @openverify/checks test` / `typecheck` / `lint` | 17 files, 450 tests; 99.81 % statements, 97.84 % branches, 100 % functions, 99.8 % lines; typecheck and lint exit 0 |
| `@openverify/api` | `pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratch>` (a separate directory, because another agent's coverage run held `coverage/`) | 41 files, 806 tests; 97.8 % / 91.63 % / 98.61 % / 97.92 % for the whole package |
| `@openverify/api` | `pnpm exec tsc --noEmit`; `pnpm exec eslint` on the owned paths | 0 errors |
| `@openverify/api` | integration, as above | 4 passed |

Per-file coverage of the owned `apps/api` code: `vision` 100 % lines; `webhooks` 99.4 %; `events` 100 %; `jobs` 96.1 %; `worker.ts` 91.4 %.
- The BullMQ worker factory is not covered by unit tests; the integration test exercises it.
- The happy path of `main` is not covered by any test. Only its configuration errors are unit-tested, and `dev:worker` was run by hand without an environment, where it reported the missing variables and exited 1.
- The Stage 3 e2e stack is the first place `main` will run end to end.
