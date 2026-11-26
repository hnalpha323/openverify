# TDD evidence: Phase 1 review fixes (TypeScript)

- **Slice owner:** TypeScript fixer (Workflow 1B, fix stage).
- **Date:** 2026-10-20.
- **Paths owned:**
  - `apps/`
  - `packages/`
  - `e2e/`
  - `contracts/`
  - this file
- **Input:** the Phase 1 review. Blocking findings K001 and F006; MEDIUM findings F011, F001, F002, F003, F007, F008, F012, F013, F014, F016 and F017, in that priority order.

Each fix follows the same cycle:
1. Write a regression test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

All commands ran from the repository root after `source scripts/env.sh`, unless a `cd` is shown. The output below is trimmed to the lines that matter.

## K001: a re-upload of a file kind on an initiated verification answered 409

**Confirmed.** `uploadFile` (`apps/api/src/services/flow.ts`) refused a second file of a kind with 409. The hosted flow tracks its uploads in memory only. After a reload between the front and the back upload, it reuses the `initiated` verification and uploads the front again, so the user was stuck. The flow's own "Retake photos" button assumed replacement too (its comment says so), and it hit the same 409.

The same function also had the race in **F001/F013**. It checked the status before reading the body and never checked it again, so a file could land on a verification that was submitted meanwhile.

**Fix.**
- New repository function `replaceVerificationFile` (`packages/db/src/repositories/files.ts`). In one transaction it:
  1. locks the verification row (`SELECT ... FOR UPDATE`);
  2. returns `null` unless the verification is still `initiated`;
  3. deletes the earlier file rows of the kind;
  4. inserts the new row.
- `uploadFile` uses it. A `null` answer is a 409, and the new object is deleted.
- After the commit, the objects of the replaced rows are deleted (best effort). Without its row's wrapped key, an object cannot be decrypted anyway.
- Uploads after submit still answer 409.

### RED

API route tests (`apps/api/src/routes/flow/verifications.test.ts`). The old test "answers 409 for a second file of the same kind" became "replaces the earlier file of a kind while the verification is initiated", which also checks the submitted event's file list. New test: "answers 409 and keeps nothing when the verification is submitted during the upload". It uses a `storage.put` spy that submits the verification before the object is stored.

```text
$ (cd apps/api && npx vitest run src/routes/flow/verifications.test.ts --coverage.enabled=false -t "replaces the earlier file|submitted during the upload")
 × replaces the earlier file of a kind while the verification is initiated
 × answers 409 and keeps nothing when the verification is submitted during the upload
Error: expected HTTP 201, got 409: {..."detail":"A front file was already uploaded for this verification."...}
AssertionError: expected 201 to be 409 // Object.is equality
      Tests  2 failed | 40 skipped (42)
```

Repository tests (`packages/db/src/repositories/files.test.ts`, `describe('replaceVerificationFile')`): first file, replacement, refusal once submitted, refusal across environments.

```text
$ (cd packages/db && npx vitest run src/repositories/files.test.ts --coverage.enabled=false)
TypeError: replaceVerificationFile is not a function
      Tests  4 failed | 3 passed (7)
```

API integration test on Postgres 17 and RustFS (`apps/api/src/api.integration.test.ts`, "replaces a re-uploaded kind and deletes the replaced object from RustFS"). To show it RED after the repository function existed, the HEAD copy of `flow.ts` was put back for one run (`git show HEAD:apps/api/src/services/flow.ts > apps/api/src/services/flow.ts`) and the fixed file restored afterwards:

```text
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/api.integration.test.ts -t "replaces a re-uploaded kind")
 × replaces a re-uploaded kind and deletes the replaced object from RustFS
Error: expected HTTP 201, got 409: {..."detail":"A front file was already uploaded for this verification."...}
      Tests  1 failed | 2 skipped (3)
```

Full-stack flow test (`e2e/tests/reload-between-uploads.spec.ts`). The front upload goes through, and the back upload is aborted (`connectionreset`). The test then reloads the page, uploads both sides again, takes the selfie, and expects `completed` with one ID verification holding two files. It ran against the pre-fix API: the stack loads the API once at start through `tsx`, the HEAD `flow.ts` was in place until "stack ready", and the fix was restored right after.

```text
$ (cd e2e && npx playwright test tests/reload-between-uploads.spec.ts)
  ✘  1 [chromium] › tests/reload-between-uploads.spec.ts:22:1 › a reload between the two ID uploads does not strand the user (1.5m)
    Error: expect(locator).toBeVisible() failed
    Locator: getByRole('heading', { name: 'Take a selfie', level: 1 })
# page snapshot: alert "Your verification changed, perhaps in another window. Try again to continue."
  1 failed
```

### GREEN

```text
$ (cd packages/db && npx vitest run src/repositories/files.test.ts --coverage.enabled=false)
      Tests  7 passed (7)
$ (cd apps/api && npx vitest run src/routes/flow/verifications.test.ts --coverage.enabled=false)
      Tests  42 passed (42)
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/api.integration.test.ts)
      Tests  3 passed (3)
$ (cd e2e && npx playwright test tests/reload-between-uploads.spec.ts)
  ✓  1 [chromium] › tests/reload-between-uploads.spec.ts:22:1 › a reload between the two ID uploads does not strand the user (10.6s)
  1 passed (36.9s)
$ (cd packages/db && npx vitest run --coverage)   # 23 files, 349 tests; All files 100 / 96.88 / 100 / 100
$ (cd apps/api && npx vitest run --coverage)      # 42 files, 819 tests; All files 97.72 / 91.78 / 98.21 / 97.94
```

**Postgres concurrency regression** (`packages/db/src/repositories.integration.test.ts`, "serializes concurrent uploads of one kind and refuses them once submitted"). PGlite has a single connection, so it cannot show the race. This test runs six concurrent replaces on the real server: one row remains, five rows are reported as replaced, and a replace after submit answers `null`. A mutation check confirms it guards the lock. With `.for('update')` removed, it fails with `duplicate key value violates unique constraint "files_environment_id_verification_id_kind_key"`; the index comes from the next fix.

```text
$ (cd packages/db && npx vitest run --config vitest.integration.config.ts)
      Tests  23 passed (23)
```

## F001 and F013 (upload part): one file per kind, enforced by the database

**Confirmed.** `files` had only a non-unique index on `(environment_id, verification_id)`, so two concurrent uploads of a kind could both insert. The row lock above already serializes the API's writes. The database now enforces the invariant as well: migration `0002_files_unique_kind` adds the unique index `files_environment_id_verification_id_kind_key` on `(environment_id, verification_id, kind)`. The migration's header notes that it fails on a database that already holds duplicates.

### RED

```text
$ (cd packages/db && npx vitest run src/constraints.test.ts src/schema.test.ts --coverage.enabled=false)
 × enforces the unique index 5
 × keeps at most one file of each kind per verification
AssertionError: expected undefined to be '23505' // Object.is equality
AssertionError: expected [ { …(3) }, { …(3) } ] to deep equally contain { …(3) }
      Tests  2 failed | 125 passed (127)
```

### GREEN

The migration was generated with `drizzle-kit generate --name files_unique_kind`, followed by Prettier. The tests that pin the applied migrations were updated: the journal tags in `migrate.test.ts` (which now also checks the new SQL), and the count, from 2 to 3, in `testing.test.ts` and `db.integration.test.ts`. The schema-drift test against the latest snapshot passes.

```text
$ (cd packages/db && npx vitest run src/constraints.test.ts src/schema.test.ts src/migrate.test.ts src/testing.test.ts --coverage.enabled=false)
      Tests  162 passed (162)   # after the count update in testing.test.ts
$ (cd packages/db && npx vitest run --config vitest.integration.config.ts)
      Tests  23 passed (23)
```

## F006: a permanent vision error, or exhausted retries, left the verification `submitted` for good

**Confirmed.** The chain in the finding holds on disk:
1. The upload checks only magic bytes.
2. Vision answers 415 or 422 for bytes it cannot decode, and 413 for too many pixels.
3. `VisionServiceError` is non-retryable for those statuses.
4. `processVerificationProcessor` turned the error into `UnrecoverableError`.
5. `processVerification` writes nothing before `evaluate()` returns.
6. The `failed` listener only logged "statuses are unchanged".

The job id is the verification id, and failed jobs are kept for a week, so a re-submit cannot enqueue it again either. Exhausted retries of a transient failure ended the same way.

**Fix**, in two parts:
1. **An image vision cannot read is a decided, user-fixable failure.**
   - `isUnreadableImageError` (`apps/api/src/vision/index.ts`) matches `VisionServiceError` 413, 415 and 422.
   - `processVerification` catches it around the verification's own analysis only. The selfie job's re-analysis of the ID front is not covered, so an unreadable ID front is never blamed on the selfie.
   - It then records `unreadableImageChecks` (`packages/checks/src/phase1/evaluate.ts`). Each enabled image quality check (`id_blur_detection`, `id_glare_detection`, `selfie_image_quality_detection`) **fails** with the new reason `image_unreadable`. Every other enabled check stays **`pending`** with the same reason. Nothing passes.
   - The decision engine makes this a retryable failure. The attempt counts towards `maxAttempts`, and the flow shows a retry hint.
   - If a template requires none of those quality checks, the decision would stay pending. That case is a `PermanentJobError('image_unreadable')` and goes to part 2.
2. **A job that fails for good fails its verification.**
   - The processor calls the new `failVerificationAfterError` before a permanent failure becomes `UnrecoverableError`. It also calls it on the last attempt of a transient failure, using BullMQ's own rule (`attemptsMade + 1 >= opts.attempts`).
   - In one transaction it moves `submitted` to `failed` and stages `verification.failed`. It writes no checks: none was decided, and none is invented. It then settles the inquiry.
   - A failure without a failed `user_behavior` check is not retryable (C7), so the inquiry fails and `inquiry.failed` is published.
   - It is idempotent. A verification that is no longer `submitted` is left alone, and only its inquiry is settled again.
   - When the template cannot be read, the verification still fails and the inquiry is left as it is.
   - If the failure write itself fails transiently, that error is thrown, so BullMQ retries while attempts remain.
   - The `failed` listener now logs `job failed` (no longer "statuses are unchanged").

**Shared vocabulary (additive C7 change).** `IMAGE_UNREADABLE_REASON = 'image_unreadable'` is added to `@openverify/contracts`. `PHASE1_CHECK_REASONS` lists it for the three quality checks, and the hosted flow has an en and an es retry message for it. Android maps reason codes it does not know to its generic retry message (`Messages.kt`), so it keeps working; a dedicated Android string is outside this fixer's paths.

### RED

```text
$ (cd packages/checks && npx vitest run src/phase1/evaluate.test.ts --coverage.enabled=false)
     × fails the ID image quality checks and leaves the others pending, never passed
     × makes the decision a retryable failure, so the user is asked for a new photo
     × fails the selfie image quality check and leaves the face checks pending
     × skips disabled checks and keeps configuration order
     × refuses a check of another verification type
TypeError: unreadableImageChecks is not a function

$ (cd apps/api && npx vitest run src/jobs/process-verification.test.ts --coverage.enabled=false)
     × fails the ID with a retryable image_unreadable hint when vision answers 413
     × fails the ID with a retryable image_unreadable hint when vision answers 415
     × fails the ID with a retryable image_unreadable hint when vision answers 422
     × fails the selfie the same way, without analysing the ID
     × counts the attempt, so the inquiry fails after the last one
     × fails permanently when the template requires no image quality check
     × fails a submitted verification without inventing checks, and the inquiry with it
     × leaves a verification that is no longer submitted alone, and settles the inquiry
     × skips a verification that does not exist
VisionServiceError: Vision service answered 415 (/v1/analyze/government-id)
TypeError: failVerificationAfterError is not a function
      Tests  9 failed | 39 passed (48)

$ (cd apps/api && npx vitest run src/worker.test.ts --coverage.enabled=false)
     × fails the verification and its inquiry on a permanent failure, without a retry
     × fails the verification once the last attempt of a transient failure fails
AssertionError: expected [ 'submitted', 'pending' ] to deeply equal [ 'failed', 'failed' ]
      Tests  2 failed | 15 passed (17)

$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/worker.integration.test.ts)
     × fails an ID image vision cannot read with a retry hint and keeps the inquiry open 45137ms
     × fails the verification and the inquiry when processing cannot finish 45161ms
AssertionError: expected 'submitted' to be 'failed' // Object.is equality
AssertionError: expected 'pending' to be 'failed' // Object.is equality
      Tests  2 failed | 4 passed (6)

$ (cd apps/flow && npx vitest run src/i18n/create-i18n.test.ts --coverage.enabled=false)   # after the vocabulary change
     × has a retry message for every user-fixable reason the Phase 1 checks report
AssertionError: expected [ 'image_blurry', …(8) ] to include 'image_unreadable'
```

The integration tests use real Valkey 9.1 and Postgres 17. The stub vision answers 415 for the ID analysis, and a separate test deletes the stored objects (`file_missing`, permanent). Both stayed stuck for the full 45 s wait.

The new tests `keeps a vision 400, 401 and 404 a permanent job failure` passed from the start. They guard that only the three image statuses changed meaning.

### GREEN

The existing Phase 1 vocabulary contract test (`apps/api/src/jobs/phase1-contract.test.ts`) now includes the unreadable results among its producers. It counts the reasons of failed results against `PHASE1_CHECK_REASONS`, and checks that a check that did not run carries only the shared `image_unreadable`. `IMAGE_UNREADABLE_CHECK_REASON` must equal `IMAGE_UNREADABLE_REASON`.

```text
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts)
 Test Files  2 passed (2)
      Tests  9 passed (9)
$ (cd apps/api && npx vitest run --coverage)          # 42 files, 843 tests; All files 97.56 / 91.74 / 98.24 / 97.77
$ (cd packages/checks && npx vitest run --coverage)   # 17 files, 455 tests; All files 99.81 / 97.85 / 100 / 99.8
$ (cd packages/contracts && npx vitest run --coverage) # 21 files, 466 tests
$ (cd apps/flow && npx vitest run --coverage)         # 34 files, 408 tests; All files 98.45 / 94.98 / 99.06 / 98.54
```

## F011, F002, F012 and F013 (submit part): one open attempt per type, decided outcomes only

**Confirmed**, on all four counts:
- `stateOf` in `apps/api/src/jobs/inquiry-outcome.ts` judged a type by its newest verification, `initiated` included. A stray `initiated` attempt therefore hid a passed one (the inquiry stayed pending) or a fraud failure (another try became possible).
- `createFlowVerification` read the attempts and then inserted, without a lock. Parallel requests could create several `initiated` attempts and go past `maxAttempts`, which also bypassed "the last failed attempt fails the inquiry".
- `submitVerification` did not refuse a verification whose type had already passed.
- `submitVerification` listed the files before it changed the status, without a lock (F013: the event could list files the worker never saw).

**Fix.**
- `decideInquiryOutcome` judges each type on its latest verification that is not `initiated`. A verification that was never submitted can neither hide a result nor keep the inquiry open. A fraud failure on any submitted attempt still fails the inquiry: the latest decided result is kept, and "any pass wins" was not adopted.
- `createFlowVerification` runs in one transaction under the inquiry's row lock (new `lockInquiry` in `@openverify/db`). It re-checks that the inquiry is open, applies the passed and processing rules, returns the existing `initiated` attempt of the type instead of inserting another (no second `verification.created`), and only then counts attempts and inserts. C3 is unchanged (still 201 with an `initiated` verification), and both clients send only `type`.
- `submitVerification` runs its checks in one transaction under the verification's row lock (new `lockVerification`), which uploads also take. It refuses a verification whose type already passed (409), lists the files after the lock, and moves the status to `submitted`. The event's file list is therefore what the worker processes.

### RED

```text
$ (cd apps/api && npx vitest run src/jobs/inquiry-outcome.test.ts --coverage.enabled=false)
     × completes when a stray initiated verification follows a passed one (F011)
     × fails on a fraud failure even when a newer verification was only initiated (F011)
AssertionError: expected null to be 'completed' // Object.is equality
AssertionError: expected null to be 'failed' // Object.is equality
      Tests  2 failed | 20 passed (22)

$ (cd apps/api && npx vitest run src/routes/flow/verifications.test.ts --coverage.enabled=false)
     × returns the initiated verification of the type instead of starting another (F011)
     × starts one verification for parallel requests (F002, F012)
     × answers 409 for a verification whose type already passed (F011)
AssertionError: expected { …(3) } to match object { …(2) }        # a second, different id
Error: expected HTTP 201, got 409: {..."detail":"No selfie attempts are left."...}   # parallel creates filled the attempts
AssertionError: expected 202 to be 409 // Object.is equality      # the stray was submitted
      Tests  3 failed | 42 passed (45)

$ (cd packages/db && npx vitest run src/repositories/inquiries.test.ts src/repositories/verifications.test.ts --coverage.enabled=false)
TypeError: lockInquiry is not a function
TypeError: lockVerification is not a function
      Tests  2 failed | 25 passed (27)
```

The old route test "allows at most maxAttempts verifications of a type" created two `initiated` attempts in a row; that now returns the same one. It now seeds a failed attempt, creates the second, fails it, and expects the third create to answer 409. That is the same rule under the new reuse behaviour.

The Postgres regression (`apps/api/src/api.integration.test.ts`, "starts one verification for parallel creates on the real database"): 8 parallel creates from one session. It was run once against the committed pre-fix `flow.ts` (HEAD copy put back for the run, fix restored after):

```text
     × starts one verification for parallel creates on the real database (F002, F012)
Error: expected HTTP 201, got 409: {..."detail":"No selfie attempts are left."...}
      Tests  1 failed | 3 skipped (4)
```

### GREEN

```text
$ (cd apps/api && npx vitest run src/routes/flow --coverage.enabled=false)
      Tests  76 passed (76)
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts src/api.integration.test.ts)
      Tests  4 passed (4)
$ (cd packages/db && npx vitest run --coverage)   # 23 files, 351 tests; All files 100 / 96.91 / 100 / 100
$ (cd apps/api && npx vitest run --coverage)      # 42 files, 849 tests; All files 97.58 / 91.69 / 98.26 / 97.79
$ (cd packages/db && npx vitest run --config vitest.integration.config.ts)
      Tests  23 passed (23)
```

## F003 and F007: login rate limits keyed on the BFF address (skipped, reasons recorded)

**Confirmed**, not fixed here:
- Next.js fills `x-forwarded-for` only when it is absent (`req.headers['x-forwarded-for'] ??= socket.remoteAddress`, `next/dist/server/base-server.js:567`), so a header sent by the browser is kept.
- The BFF forwards that header unchanged (`clientAddress()` in `apps/dashboard/src/lib/session.ts`).
- The API's `trustProxy` is a boolean (`OPENVERIFY_TRUST_PROXY`, default `false`).
- With the default, every login shares the BFF's bucket, so about 50 failed attempts lock every operator out for 15 minutes. With `true`, the client picks its own bucket.

A real fix is a deployment-level trusted-proxy design: a hop count or CIDR list for `trustProxy`, a client-address header that the API honours only from an authenticated BFF, and matching compose and `.env.example` settings. Those last two live under `infra/` and the repository root, outside this fixer's paths. The local tweaks available would trade one weakness for the other:
- If the BFF stops forwarding `X-Forwarded-For`, every operator shares the BFF bucket.
- If only failures count, the 50-failure lockout remains. Counting every attempt is also a deliberate C4 choice (`login-rate-limiter.ts`: "so the limits cannot be probed").

## F008: the session cookie's Secure flag followed a request header

**Confirmed.** `setSessionCookie` set `secure` from the first `X-Forwarded-Proto` entry. Behind a TLS proxy that does not send the header, the 12-hour operator session cookie went out without `Secure`, and a client could choose the value.

**Fix.** `secureCookies()` (`apps/dashboard/src/lib/config.ts`) decides from the deployment:
- `Secure` in every production build (`NODE_ENV=production`, i.e. `next start`), unless `OPENVERIFY_DASHBOARD_INSECURE_COOKIES=true` explicitly allows plain http;
- never under `next dev`;
- no request header is read any more.

A probe showed that Chromium (Playwright's, as in the e2e) keeps a `Secure; HttpOnly` cookie set over `http://127.0.0.1` and `http://localhost` and sends it back. The full-stack e2e, whose dashboard runs `next start` on `http://127.0.0.1`, therefore needs no opt-out. The `__Host-` prefix was not adopted: it would need a different cookie name in development, where the cookie is not Secure. The new optional variable is not yet declared in the root `.env.example`, which is outside this fixer's paths.

### RED

The two tests that expected the header to set the flag were replaced by four tests of the new rule.

```text
$ (cd apps/dashboard && npx vitest run src/lib/session.test.ts --coverage.enabled=false)
       × is always set in a production build, even without X-Forwarded-Proto
       × ignores a client-controlled X-Forwarded-Proto: http
       × is not set by a development server, whatever X-Forwarded-Proto says
AssertionError: expected { httpOnly: true, …(4) } to match object { secure: true }
AssertionError: expected { httpOnly: true, …(4) } to match object { secure: true }
AssertionError: expected { httpOnly: true, …(4) } to match object { secure: false }
      Tests  3 failed | 12 passed (15)
```

### GREEN

```text
$ (cd apps/dashboard && npx vitest run --coverage)   # 23 files, 201 tests; All files 97.61 / 94.78 / 100 / 97.56
```

## F014: API-side state changes and their events were separate commits

**Confirmed.** Four call sites committed the change first and then called `events.publish`, which runs its own transaction:
- `createInquiry` (`inquiry.created`);
- `startInquiry` (`inquiry.started`);
- `createFlowVerification` (`verification.created`);
- `submitVerification` (`verification.submitted`).

If the publish failed, the request answered 500 with the change already committed. A retry then found nothing left to do (the inquiry already `pending`, the verification already `submitted` or, since F011, reused), so the C5 event was lost for good.

**Fix.** The worker already followed the right pattern; the API now does too:
- `ApiDependencies.events` is the `TransactionalEventPublisher`, which the container already built.
- Each site stages its event with `events.stage(tx, ...)` inside the transaction that makes the change, then calls `events.dispatch` after the commit. The event row and its delivery rows are the outbox, so a failed enqueue is picked up by the sweep.
- The test double (`createRecordingEventPublisher`) implements `stage` and `dispatch`. It records an event only once it is dispatched, so a rolled-back change records none, and `failNext` now applies to `stage`.

### RED

```text
$ (cd apps/api && npx vitest run src/routes --coverage.enabled=false -t "F014")
     × creates no inquiry when inquiry.created cannot be written (F014)
     × publishes verification.created on a retry when the first attempt could not (F014)
     × publishes verification.submitted on a retry when the first attempt could not (F014)
     × publishes inquiry.started on a retry when the first attempt could not (F014)
AssertionError: expected 'pending' to be 'created' // Object.is equality      # inquiry started, event lost
AssertionError: expected [ { …(12) } ] to deeply equal []                      # verification kept, event lost
AssertionError: expected 'submitted' to be 'initiated' // Object.is equality  # submitted, event lost
AssertionError: expected 1 to be +0 // Object.is equality                      # inquiry kept, event lost
      Tests  4 failed | 210 skipped (214)
```

### GREEN

```text
$ (cd apps/api && npx vitest run src/routes --coverage.enabled=false)
      Tests  214 passed (214)
$ (cd apps/api && npx vitest run --coverage)   # 42 files, 853 tests; All files 97.34 / 91.53 / 98.06 / 97.54
$ (cd apps/api && npx vitest run --config vitest.integration.config.ts)   # real publisher on Postgres 17
 Test Files  2 passed (2)
      Tests  10 passed (10)
```

Running Prettier from inside `apps/api` reformatted a file that the root `pnpm format:check` accepts (`inquiry-templates.ts`). That file was restored, and formatting is now checked from the repository root only.

## F016: focus was lost when the capture mode changed

**Confirmed.** In `apps/flow/src/components/capture-sequence.tsx` each mode change (choose, camera, preview) unmounts the control that caused it, so focus fell back to `<body>`. The only focus handling was on the photo index. The camera's `role="status"` existed only while starting, so screen-reader users heard nothing when the camera became ready or when a photo was ready to check.

**Fix**, local to the hosted flow:
- Every mode change goes through `changeMode(next, focusTarget)`, and an effect keyed on the mode moves focus:
  - to the photo's title (the `h2` with `tabIndex=-1`, as for a new photo) when the camera opens, when a photo is ready to check, and on a camera retake;
  - back to "Take a photo" after Cancel;
  - back to "Upload a photo" after retaking an uploaded photo.
- An invalid file keeps the choice mode mounted, so focus stays on the upload button and the error `Alert` (`role="alert"`) is announced as before.
- Two status regions stay mounted:
  - the camera's region says "Starting your camera…", then (screen-reader only) that the camera is ready;
  - a new screen-reader-only region in the sequence announces that the photo is ready to check.
- New strings: `capture.cameraReady` and `capture.photoReady`, in en and es. The i18n parity test checks that es has the same keys.

### RED

The camera test "announces that the camera is starting until access is granted" expected the region to disappear. It became "announces that the camera is starting, then that it is ready", which expects the same region to stay mounted.

```text
$ (cd apps/flow && npx vitest run src/components/capture-sequence.test.tsx src/components/camera-capture.test.tsx --coverage.enabled=false)
       × moves focus to the photo title when the camera opens
       × moves focus to the photo title and announces the photo to check
       × returns focus to Take a photo when the camera is cancelled
       × returns focus to Upload a photo when an uploaded photo is retaken
     × announces that the camera is starting, then that it is ready (F016)
TestingLibraryElementError: Unable to find role="status"
Error: expect(element).toHaveFocus()   Expected element with focus: ...
TestingLibraryElementError: Unable to find an element by: [data-testid="capture-announcement"]
      Tests  5 failed | 31 passed (36)
```

### GREEN

```text
$ (cd apps/flow && npx vitest run --coverage)   # 34 files, 412 tests; All files 98.49 / 95.11 / 99.06 / 98.57
$ (cd apps/flow && npx playwright test --config e2e/playwright.config.ts)   # mocked-API browser tests
  9 passed (4.8s)
```

## F017: a 409 on a retried submit left the user in a Retry loop

**Confirmed.** Suppose a submit reaches the server but its answer is lost. By the time the user retries, the worker may have decided the verification, or the inquiry may have finished, so the retry answers 409. `VerificationCaptureStep` showed "Your verification changed… Try again" and a Retry that hit the same 409 again; Retake gave a 409 too. Nothing reloaded the session.

**Fix.** When `submitVerification` (the create, upload or submit request) fails with an HTTP 409, the step reloads the session (`onSubmitted`, the renderer's `refresh`). The session reports the real position (processing, the next step, a new attempt, or the end), and the renderer switches screens. If the step is still mounted after the reload, the error and its buttons are shown as before, so the user is never left on the "Uploading" message. Other errors keep the Retry and Retake choice. Android has the same flow but is outside this fixer's paths.

### RED

```text
$ (cd apps/flow && npx vitest run src/steps/verification-capture-step.test.tsx --coverage.enabled=false)
     × reloads the session when a retried submit answers 409, instead of looping (F017)
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
      Tests  1 failed | 13 passed (14)
```

### GREEN

```text
$ (cd apps/flow && npx vitest run --coverage)   # 34 files, 413 tests; All files 98.5 / 95.18 / 99.07 / 98.58
$ (cd apps/flow && npx playwright test --config e2e/playwright.config.ts)
  9 passed
```

## Final validation

The whole workspace was run from the repository root after the last fix.

```text
$ pnpm typecheck        # exit 0; Tasks: 12 successful, 12 total
$ pnpm lint             # exit 0; Tasks: 12 successful, 12 total
$ pnpm test             # exit 0; Tasks: 12 successful, 12 total; every package over its 80% gate:
#   api 97.34 / 91.53 / 98.06 / 97.54   db 100 / 96.91 / 100 / 100   flow 98.5 / 95.18 / 99.07 / 98.58
#   dashboard 97.61 / 94.78 / 100 / 97.56   checks 99.81 / 97.85 / 100 / 99.8   contracts 100 / 100 / 100 / 100
#   e2e 95.87 / 88.46 / 92.59 / 96.73   core, node, flow-spec, config 100   ui 100 / 97.72 / 100 / 100
$ pnpm format:check     # exit 0; All matched files use Prettier code style!
$ pnpm test:integration # exit 0; db 23 tests, api 10 tests (Postgres 17, Valkey 9.1, RustFS 1.0.3)
$ pnpm e2e              # exit 0; flow (mocked API) 9 passed; full stack 3 passed:
#   ✓ a reload between the two ID uploads does not strand the user (6.3s)
#   ✓ an inquiry on the default template completes with every check passed (7.3s)
#   ✓ a selfie of a different person fails the face match and the inquiry (5.8s)
```

## Follow-ups outside this fixer's paths

- **Android** (`android/`):
  - map `image_unreadable` to its own retry message (until then the generic one is shown);
  - reload the session on a 409 from submit, as the web flow now does (F017).
- **Root `.env.example`**: declare the optional `OPENVERIFY_DASHBOARD_INSECURE_COOKIES` (default unset, so the cookie is Secure in production).
- **F003/F007**: a trusted-proxy design across the API config, the dashboard BFF, `infra/docker-compose.yml` and `.env.example`.
- **Stalled jobs**: a `process-verification` job that BullMQ fails as stalled never runs the processor, so `failVerificationAfterError` does not run for it. A periodic sweep of long-`submitted` verifications would close that gap.
