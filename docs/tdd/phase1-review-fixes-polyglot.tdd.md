# TDD evidence: Phase 1 review fixes (polyglot)

- **Slice owner:** polyglot fixer (Python vision service, Kotlin Android SDK, infra and CI).
- **Date:** 2026-10-20.
- **Paths owned:**
  - `services/vision/`
  - `android/`
  - `infra/`
  - `.github/`
  - `scripts/`
  - this file
- **Input:** the Phase 1 review. It had no blocking findings for these paths. The MEDIUM findings, in priority order, were F019, F020, F023 and F024.

Each fix follows the same cycle:
1. Write a regression test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

The output below is trimmed to the lines that matter.

## F019: 16-bit greyscale images decode as near-white

**Confirmed.** `imaging.decode_image` called `upright.convert("RGB")`.
- A 16-bit grey PNG opens in Pillow 13 as mode `I;16` (0 to 65535).
- `convert("RGB")` clips those levels at 255 instead of scaling them.
- The reviewer's probe (uniform-random `uint16` data, expected mean about 127) decoded with mean 254.5.

A probe of the other high-depth PNG shapes showed that Pillow already reduces 16-bit RGB and RGBA to 8-bit `RGB` and `RGBA` correctly (mid-grey 32768 decodes as 128). So only the integer greyscale modes (`I;16`, `I`) need handling:

| PNG written by OpenCV | Pillow mode | Decoded mean before the fix (expect 128) |
|---|---|---|
| 16-bit grey | `I;16` | 255.0 |
| 16-bit BGR | `RGB` | 128.0 |
| 16-bit BGRA | `RGBA` | 128.0 |

**RED.** Added `test_sixteen_bit_grayscale_png_is_scaled_to_eight_bits` to `tests/test_imaging.py`. It encodes the levels `[0, 257*64, 257*128, 65535]` as a 16-bit PNG, asserts that the PNG reopens as `I;16`, and expects the decoded pixels to be 0, 64, 128 and 255.

```text
$ (cd services/vision && uv run pytest tests/test_imaging.py -k sixteen_bit -q --no-cov)
>       assert decoded[0].tolist() == [[0, 0, 0], [64, 64, 64], [128, 128, 128], [255, 255, 255]]
E         At index 1 diff: [255, 255, 255] != [64, 64, 64]
FAILED tests/test_imaging.py::test_sixteen_bit_grayscale_png_is_scaled_to_eight_bits
1 failed, 19 deselected in 0.07s
```

**GREEN.** A new helper, `imaging._to_rgb`, scales integer greyscale modes by `1/257` (65535 maps to 255), rounds, clips to 0..255 and expands the result to RGB. Every other mode still goes through `convert("RGB")`.

```text
$ (cd services/vision && uv run pytest tests/test_imaging.py -q --no-cov)
20 passed in 0.50s
```

The reviewer's probe data now decodes with mean 127.3, where it decoded with mean 254.5 before.

**Refactor.** Moved the helper above `decode_image` and added the bit-depth scaling to its docstring.

```text
$ (cd services/vision && uv run ruff check src tests && uv run ruff format --check src tests && uv run mypy src tools)
All checks passed!
34 files already formatted
Success: no issues found in 17 source files
$ (cd services/vision && uv run pytest -q)
Required test coverage of 80% reached. Total coverage: 100.00%
433 passed in 14.52s
```

**Not done: alpha compositing.** The suggested fix also proposed compositing RGBA, LA and transparent-palette images onto a white background. I left this out:
- It is not the failure the finding describes.
- The background colour changes quality results:
  - White margins count as clipped highlights for `has_glare`.
  - Black margins pull down `brightness`.
- So choosing the colour is a check-policy decision, not a decoding fix.

Images with alpha still decode as before: Pillow drops the alpha channel.

## F020: no cap on concurrent decodes

**Confirmed.** Every image endpoint passed its whole job (decode, then analysis) to Starlette's `run_in_threadpool`, which allows up to 40 threads.
- At the default `MAX_IMAGE_PIXELS` of 40,000,000, one decoded RGB image is about 120 MB, with about two more copies at peak during conversion.
- A selfie request decodes up to three images before analysis starts.
- The detector and recognizer locks serialise inference, so concurrent jobs pile up while each one holds its decoded arrays.
- The API worker calls vision with `OPENVERIFY_WORKER_CONCURRENCY` (default 4) jobs per worker process. A few workers, or a burst of large uploads, could therefore hold several GB.

**RED.** I wrote the following tests:
- `tests/test_app_concurrency.py` (new). A `GateDetector` holds the first detection until the test releases it and records how many detections ran at once.
  - `test_work_beyond_the_running_and_queued_jobs_is_503_with_retry_after`: with 1 running job and a queue of 0, a second request to each of `/v1/quality`, `/v1/embed/face`, `/v1/analyze/government-id` and `/v1/analyze/selfie` must get a 503 problem with `Retry-After`.
  - `test_queued_work_waits_for_a_free_slot_instead_of_running_alongside`: with 1 running job and a queue of 1, the second request must wait. Both requests then succeed, and at most one detection runs at a time.
  - `test_a_freed_slot_is_reused` and `test_health_is_never_limited`: guards on the new behaviour. They passed before the fix too.
- `tests/test_settings.py`:
  - checks the defaults, environment reading and validation of `max_concurrent_jobs` (default 2, must be > 0) and `max_queued_jobs` (default 8, must be ≥ 0);
  - adds the new variables to the cleaned environment.

```text
$ (cd services/vision && uv run pytest tests/test_app_concurrency.py tests/test_settings.py -q --no-cov)
>       body = assert_problem(refused, 503)
E       AssertionError: {"checks":{"id_blur_detection":{"status":"passed",...}
E       assert 200 == 503                     # /v1/quality, and the same for the 3 other endpoints
E       assert 2 == 1
E        +  where 2 = <test_app_concurrency.GateDetector object at 0x...>.max_active
E       AttributeError: 'Settings' object has no attribute 'max_concurrent_jobs'
E       Failed: DID NOT RAISE ValidationError    # max_concurrent_jobs=0 and max_queued_jobs=-1
9 failed, 17 passed in 7.28s
```

**GREEN.**
- `limits.JobLimiter(max_running, max_queued)`:
  - runs each job through `run_in_threadpool` inside an `asyncio.Semaphore(max_running)`;
  - counts admitted requests, and refuses any request beyond `max_running + max_queued` with `ProblemError(503, "the service is busy: ...", headers={"Retry-After": "5"})`.
  - A request cancelled while its job runs keeps the slot until the thread finishes, because `run_in_threadpool` does not abandon the thread. So the cap holds even when the API times out and retries.
- `ProblemError` takes optional `headers`, and its handler passes them to `problem_response`.
- `Settings` adds `max_concurrent_jobs` (default 2) and `max_queued_jobs` (default 8). They are read from `OPENVERIFY_VISION_MAX_CONCURRENT_JOBS` and `OPENVERIFY_VISION_MAX_QUEUED_JOBS`.
- `create_app` stores one limiter on `app.state`. `/v1/quality`, both analysis endpoints and `/v1/embed/face` receive it through `get_job_limiter`. `/health` is not limited.
- `analyze_selfie` now has 6 parameters (3 form fields and 3 dependencies), so it carries a scoped `# noqa: PLR0913, PLR0917` that gives this reason.

```text
$ (cd services/vision && uv run pytest tests/test_app_concurrency.py tests/test_settings.py -q --no-cov)
26 passed in 1.07s
```

**Refactor and hardening.**
- Added `tests/test_limits.py::test_job_limiter_rejects_impossible_limits` and `test_a_failed_job_frees_its_slot`. The second checks that a job raising a problem, such as a 415, releases its slot.
- Added the two settings to the README configuration table, and the busy 503 to its error table.
- To check for flakiness, I ran the concurrency tests 15 times in a row. All 15 runs passed (7 passed each, 1.0 to 1.2 s).

```text
$ (cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest)
All checks passed!
Success: no issues found in 17 source files
Required test coverage of 80% reached. Total coverage: 100.00%
446 passed in 15.36s
```

The API's vision client already treats 503 as retryable (`apps/api/src/vision/index.ts`, `RETRYABLE_STATUSES`). BullMQ retries the job five times with exponential backoff from 5 s. A busy 503 is therefore retried and does not fail the verification.

**Not done: two parts of the suggested fix.**
- **Lowering the default `MAX_IMAGE_PIXELS` to 12 to 16 MP.** The API accepts uploads up to 10 MB, and a 10 MB JPEG from a 48 or 50 MP phone sensor is ordinary. The worker treats a 413 from vision as permanent, so a lower default would fail valid user uploads. Operators can lower it per deployment. With two jobs at a time, the worst case drops from about 40 concurrent jobs to 2.
- **Decoding and analysing one image at a time.** Every upload of a request is decoded before the models load, so a client error (413, 415, 422) wins over a model 503. That ordering is a documented behaviour of the C6 endpoints, and the tests in `test_app_analyze.py` rely on it. Decoding twice to keep it would double the CPU cost.

## F023: Android ignores `maxAttempts` and has no finalizing state

**Confirmed.** `FlowCoordinator.verificationState` looked only at the latest verification of the step's type.
- After a failed or canceled attempt it always showed a new capture, whatever the step's `maxAttempts`.
- The server counts every verification of the type and refuses another with 409 once `attempts >= maxAttempts` (`apps/api/src/services/flow.ts`, `createFlowVerification`).
- The worker commits the verification's failure, then fails the inquiry in a second transaction. In between, the SDK saw a pending inquiry and asked for new photos. The 409 then mapped to `OUT_OF_SYNC`, whose retry reloaded into the same capture screen.
- The web flow shows `finalizing` in this case (`apps/flow/src/flow/flow-position.ts`, `verificationPosition`).

**RED (behaviour).** Test support: `FakeFlowApi.changeInquiryAfter(reads, status)` models the worker's second transaction. The first `reads` session reads still see the old inquiry status.

New tests in `FlowCoordinatorTest`, using the default flow where `government_id` has `maxAttempts: 3`:
- `when the last attempt fails, the flow waits for the inquiry to fail instead of asking for photos the server refuses`: two earlier failed attempts; the third fails with hints while the inquiry stays pending for two more reads.
- `resuming with every attempt used waits for the inquiry to be decided`
- `an inquiry still undecided when waiting stops can be checked again`
- `a network error while waiting for the decision re-reads the session on retry`

```text
$ (cd android && ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests "dev.openverify.sdk.flow.FlowCoordinatorTest")
resuming with every attempt used waits for the inquiry to be decided()
    AssertionFailedError: expected: <Failed(step=FailureStep(id=failure, ...), inquiryStatus=FAILED)>
      but was: <Capture(step=GovernmentIdStep(... maxAttempts=3 ...), kind=FRONT, index=0, count=2, retryHints=[], image=null)>
when the last attempt fails, the flow waits for the inquiry to fail instead of asking for photos the server refuses()
    AssertionFailedError: expected: <Failed(...)> but was: <Capture(... retryHints=[RetryHint(name=id_blur_detection, reasons=[image_blurry])] ...)>
a network error while waiting for the decision re-reads the session on retry()
    AssertionFailedError: expected: <Error(error=NETWORK, canRetry=true)> but was: <Capture(...)>
an inquiry still undecided when waiting stops can be checked again()
    AssertionFailedError: expected: <Error(error=STILL_PROCESSING, canRetry=true)> but was: <Capture(...)>
46 tests completed, 4 failed
```

**RED (new surface).** These tests reference `FlowState.Finalizing`, which did not exist yet, so they fail to compile:
- `InquiryResultsTest`: closing while finalizing gives `Failed(STILL_PROCESSING)`.
- `StatusScreensTest.finalizing says the verification is being finished`
- `InquiryFlowScreenTest.finalizing shows the finalizing screen`
- the first coordinator test above also asserts that `Finalizing(idStep)` is shown.

```text
$ (cd android && ./gradlew --no-daemon :openverify-sdk:compileDebugUnitTestKotlin)
e: .../InquiryResultsTest.kt:59:36 Unresolved reference 'Finalizing'.
e: .../flow/FlowCoordinatorTest.kt:312:30 Unresolved reference 'Finalizing'.
e: .../ui/InquiryFlowScreenTest.kt:109:24 Unresolved reference 'Finalizing'.
e: .../ui/StatusScreensTest.kt:51:27 Unresolved reference 'FinalizingScreen'.
e: .../ui/StatusScreensTest.kt:53:43 Unresolved reference 'openverify_finalizing_title'.
BUILD FAILED in 18s
```

**GREEN.**
- `verificationState` counts every verification of the step's type as an attempt, as the server and the web flow do. When a new verification would be needed and `attempts >= maxAttempts`, it returns `Resolution.Finalize(step)`. An `initiated` verification is still reused.
- `finalize(step)`:
  - shows `FlowState.Finalizing(step)`;
  - re-reads the session every `pollInterval`, up to `pollAttempts` times, until `step` no longer waits, then continues from it. The flow's transitions then lead to the failure step.
  - If the inquiry is still undecided after the last read, it shows `Error(STILL_PROCESSING, canRetry = true)`. A failed read shows the usual error. Both retry with `load`.
- UI: `FinalizingScreen` (progress, "Finishing your verification") and `InquiryFlowScreen` routing. The two strings are prefixed `openverify_`, like the others.
- Result: closing on `Finalizing` gives `Failed(STILL_PROCESSING)`, not `Canceled`. Every attempt is used, so the inquiry cannot be resumed, and its decision arrives by webhook. The KDoc of `FailureReason.STILL_PROCESSING` now covers this case.

```text
$ (cd android && ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests ...FlowCoordinatorTest --tests ...InquiryResultsTest --tests ...StatusScreensTest --tests ...InquiryFlowScreenTest)
BUILD SUCCESSFUL in 1m 7s
FlowCoordinatorTest 46 tests, 0 failed; StatusScreensTest 9, 0; InquiryFlowScreenTest 9, 0; InquiryResultsTest 16, 0
```

**Refactor.** Formatted the selfie branch of `resolve` like the government ID branch. Then I ran every module's unit tests and the coverage gate:

```text
$ (cd android && ./gradlew --no-daemon testDebugUnitTest koverVerify)
BUILD SUCCESSFUL in 1m 3s            # 328 tests in all modules, 0 failed
$ (cd android && ./gradlew --no-daemon :openverify-sdk:koverLog)
application line coverage: 97.4585%
```

## F024: terminal inquiry statuses are not short-circuited on Android

**Confirmed.** `FlowCoordinator.resolve` walked the steps whatever the inquiry status was.
- No case handled `InquiryStatus.EXPIRED`. An expired inquiry took the user through consent and capture, then ended on a generic 403/409 error, reported as `Failed(SERVER_ERROR)`.
- A failed inquiry reached the failure step only through a `failed -> failure` transition. In a flow without one, it walked to the completion step and returned `Completed(id, FAILED)`.
- A finished inquiry (completed, approved, declined, needs_review) with missing consent walked back into consent.
- The web flow checks the inquiry status first (`apps/flow/src/flow/flow-position.ts`, `terminalPosition`).

**RED (behaviour).** New tests in `FlowCoordinatorTest`:
- `a finished inquiry shows completion without walking its steps`, for `COMPLETED`, `APPROVED`, `DECLINED` and `NEEDS_REVIEW`;
- `a failed inquiry ends at the failure step even without a transition to it`.

```text
$ (cd android && ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests "dev.openverify.sdk.flow.FlowCoordinatorTest")
a failed inquiry ends at the failure step even without a transition to it()
    AssertionFailedError: expected: <Failed(step=FailureStep(id=failure, ...), inquiryStatus=FAILED)>
      but was: <Completed(step=CompletionStep(id=completion, ...), inquiryStatus=FAILED)>
COMPLETED     AssertionFailedError: expected: <Completed(..., inquiryStatus=COMPLETED)> but was: <Consent(...)>
APPROVED      ... but was: <Consent(...)>
DECLINED      ... but was: <Consent(...)>
NEEDS_REVIEW  ... but was: <Consent(...)>
51 tests completed, 5 failed
```

**RED (new surface).** These tests do not compile yet:
- `an expired inquiry ends the flow without asking for consent or photos`
- `an inquiry that expires during the flow ends there once the conflict is re-read`: a 409 on consent, and the retry's reload shows `Expired`.
- `a failed inquiry in a flow without a failure step still ends as failed`: `Failed(null, FAILED)`, as the web flow's `failure` with a null step.
- `InquiryResultsTest`: `Expired` gives `Failed(INQUIRY_EXPIRED)`, and `Failed(null, ...)` gives `INQUIRY_FAILED`.
- `StatusScreensTest`: the expired screen, and the failure screen without a step.
- `InquiryFlowScreenTest`: `Expired` closes through `finish`.

```text
$ (cd android && ./gradlew --no-daemon :openverify-sdk:compileDebugUnitTestKotlin)
e: .../InquiryResultsTest.kt:49:43 Null cannot be a value of a non-null type 'FailureStep'.
e: .../InquiryResultsTest.kt:50:36 Unresolved reference 'Expired'.
e: .../InquiryResultsTest.kt:50:59 Unresolved reference 'INQUIRY_EXPIRED'.
e: .../flow/FlowCoordinatorTest.kt:459:32 Unresolved reference 'Expired'.
e: .../flow/FlowCoordinatorTest.kt:484:39 Null cannot be a value of a non-null type 'FailureStep'.
e: .../ui/StatusScreensTest.kt:104:27 Unresolved reference 'ExpiredScreen'.
BUILD FAILED in 11s
```

**GREEN.**
- `resolve` starts with `terminalState(session)`, which maps the inquiry status as the web flow does:
  - `completed`, `approved`, `declined` and `needs_review` go to `Completed`, with the flow's first completion step or `null`;
  - `failed` goes to `Failed`, with the first failure step or `null`;
  - `expired` goes to the new `FlowState.Expired`;
  - `created`, `pending` and `unknown` keep walking the steps.

  Because the check is in `resolve`, it also applies to the session re-read after processing or finalizing.
- `FlowState.Failed.step` is now nullable, and `FailureScreen` falls back to the default message.
- UI: `ExpiredScreen` ("This verification has expired", with a Close button) and `InquiryFlowScreen` routing.
- Result: `Expired` gives `InquiryResult.Failed(id, FailureReason.INQUIRY_EXPIRED)`. This is a new public enum entry. Results travel by enum name, so the intent round trip is unaffected. `OpenVerifyInquiryContractTest` covers the new entry because it iterates `FailureReason.entries`.

```text
$ (cd android && ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests ...FlowCoordinatorTest --tests ...InquiryResultsTest --tests ...StatusScreensTest --tests ...InquiryFlowScreenTest --tests ...OpenVerifyInquiryContractTest)
BUILD SUCCESSFUL in 49s
FlowCoordinatorTest 54 tests, 0 failed; InquiryResultsTest 18, 0; StatusScreensTest 11, 0; InquiryFlowScreenTest 9, 0; OpenVerifyInquiryContractTest 6, 0
```

**Refactor.**
- Removed the `session.inquiry.status == InquiryStatus.FAILED -> null` branch from `verificationState`. The terminal check in `resolve` runs first, so that branch could no longer be reached.
- Updated the class KDoc: a decided inquiry goes straight to its end screen.

```text
$ (cd android && ./gradlew --no-daemon testDebugUnitTest koverVerify :openverify-sdk:koverLog)
application line coverage: 97.2921%
BUILD SUCCESSFUL in 53s              # 340 tests in all modules, 0 failed
```

## Final checks

These run after the last fix.

```text
$ (cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest)
All checks passed!
41 files already formatted
Success: no issues found in 17 source files
Required test coverage of 80% reached. Total coverage: 100.00%
446 passed in 16.43s

$ (cd android && ./gradlew --no-daemon testDebugUnitTest koverVerify assembleDebug lint)
BUILD SUCCESSFUL in 53s
# lint: openverify-sdk 0 errors, 10 warnings; demo-app 0 errors, 2 warnings; openverify-nfc 0 errors, 1 warning.
# Every warning is a dependency or target-version notice (GradleDependency, NewerVersionAvailable,
# OldTargetApi); none comes from the changed code.
```

I did not change `infra/`, `.github/` or `scripts/`, so `infra/tests/compose.test.sh --static-only` and `actionlint` were not required.

## Summary

| Finding | Result | Commit |
|---|---|---|
| F019 | Fixed: 16-bit greyscale is scaled to 8 bits. Alpha compositing was left out on purpose (see F019). | `fix(vision): scale 16-bit greyscale uploads to 8 bits instead of clipping them` |
| F020 | Fixed: a job limiter (2 running and 8 queued by default) answers 503 with `Retry-After` beyond that. The pixel-limit and one-image-at-a-time suggestions were left out on purpose (see F020). | `fix(vision): cap concurrent image jobs and answer 503 with Retry-After when the queue is full` |
| F023 | Fixed: attempts are counted against `maxAttempts`, and a `Finalizing` state waits for the server to fail the inquiry. | `fix(android): count attempts against maxAttempts and wait for the inquiry after the last one fails` |
| F024 | Fixed: decided and expired inquiries end the flow before its steps are walked. New `Expired` state and `FailureReason.INQUIRY_EXPIRED`. | `fix(android): end the flow on a decided or expired inquiry before walking its steps` |
