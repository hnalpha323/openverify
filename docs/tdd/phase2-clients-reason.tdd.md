# TDD evidence: Workflow 2E clients-reason (web flow and Android)

- **Slice owner:** `clients-reason` (Workflow 2E, Stage 2, in parallel with `console-gaps`).
- **Date:** 2026-10-20.
- **Paths owned:**
  - `apps/flow/**`, including its mocked Playwright specs in `apps/flow/e2e`;
  - `android/**`;
  - `e2e/tests/ui-flow-links.spec.ts` and `e2e/tests/support/flow-links.ts`;
  - this file.
- **Input:** the plan's C25.8 (why a session was canceled) for the clients, and the C28 client items:
  - the Android half of F018;
  - F010 and F016 in the web flow;
  - F022 and F023 on Android.

  The API side of C25.8 had landed in Stage 1 (`api-gaps`, `docs/tdd/phase2-api-gaps.tdd.md`): `problemSchema.reason`, `SESSION_CANCELED_REASONS`, and `contracts/fixtures/problems/session-canceled-inquiry-{expired,finished,redacted}.json`.
- **Dependencies:** none added.

Each change follows the same cycle:
1. Write a regression test and run it, to see it fail for the intended reason (RED). The RED tests compile and typecheck: where one needed a name that did not exist yet, a stub came first in its own `chore` commit.
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

**Test-only findings.** F022 and F023, and two guard tests added on the way, change no production code. For these, RED is a mutant: a temporary edit of the implementation, never committed, that the old test misses and the new test catches. Each mutant was then restored, which `git diff --stat` shows empty.

**How the commands ran.** All of them ran after `source scripts/env.sh`: TypeScript from the repository root (or `apps/flow`, where a `cd` is shown), Gradle from `android/`. The output is trimmed to the lines that matter. Android failure messages come from `openverify-sdk/build/test-results/testDebugUnitTest/*.xml`.

## C25.8, web flow: a canceled session ends on the screen its reason names

**Behaviour.** On a 401 `session_canceled`, the flow reads `reason` and picks the screen:

| `reason` | Screen |
|---|---|
| `inquiry_expired` | The link-expired screen (`ExpiredScreen`: "This verification link has expired") |
| `inquiry_redacted` | The redacted screen ("This verification is no longer available") |
| `inquiry_finished` | The ended screen ("This verification session has ended") |
| missing (a server before 2E) | The ended screen |
| unknown (a newer server) | The ended screen |

`session_expired` is unchanged. None of these screens offers a retry, and focus moves to the screen's heading.

**A defect found while writing the tests.** `problemSchema.reason` is an enum. So `readProblem` (`flow-transport.ts`) discarded the whole problem when a newer server sent a reason this version does not know. The `code` went with it, and the flow showed the generic "Something went wrong" with a retry that cannot work, not the ended screen.

**Fix.**
- `finalOutcomeOf` (`api/final-outcome.ts`) maps the reason. It adds a final outcome, `inquiry-expired`, which `SessionEndedScreen` renders as `ExpiredScreen` itself.
- `parseProblem` (`api/flow-transport.ts`) handles a body whose only schema issues are at `reason`: it parses the body again without `reason`, so the code is kept.

**Stub** (commit `f0da231`). `FinalOutcome` gained `'inquiry-expired'`, rendered as the ended screen, so the screen test typechecks.

**RED** (commit `7bb31b2`). The new tests:
- `final-outcome.test.ts`:
  - each reason;
  - a reason on `session_expired` is ignored;
  - every file in `contracts/fixtures/problems/`, read through `src/testing/golden-problems.ts` (`import.meta.glob`), maps to its outcome.
- `flow-api-client.test.ts`:
  - each golden problem keeps its code and reason through the transport;
  - an unknown reason keeps the code.
- `session-ended-screen.test.tsx`: the `inquiry-expired` outcome.
- `flow-renderer.test.tsx`: the three reasons, with focus on the heading.
- `app.test.tsx`: the real transport and the App, for `inquiry_expired`, `inquiry_redacted`, `inquiry_finished` and an unknown `inquiry_archived`.
- Mocked Playwright `e2e/session-ended.spec.ts`: an inquiry expired during the flow; an inquiry redacted during the flow; a `inquiry_finished` and an unknown reason. `MockFlowApi.cancelReason` adds the member.

```text
$ (cd apps/flow && pnpm exec vitest run src/api/final-outcome.test.ts src/api/flow-api-client.test.ts src/flow/flow-renderer.test.tsx src/steps/session-ended-screen.test.tsx src/app.test.tsx --coverage.enabled=false)
     × ends a session canceled with reason inquiry_expired on its own screen (C25.8)
     × ends a session canceled with reason inquiry_redacted on its own screen (C25.8)
       × session-canceled-inquiry-expired.json ends the flow on its own screen
       × session-canceled-inquiry-redacted.json ends the flow on its own screen
       × keeps the code of a canceled session whose reason this version does not know (C25.8)
     × explains a inquiry-expired session, with no way to retry
     × ends a session canceled with reason inquiry_expired on its own screen, with no retry (C25.8)
     × ends a session canceled with reason inquiry_redacted on its own screen, with no retry (C25.8)
     × ends a session canceled with reason inquiry_archived on its own screen, with no retry (C25.8)
     × shows the link-expired screen when the session was canceled because the inquiry expired (C25.8)
     × shows the redacted screen when the session was canceled because the inquiry was redacted (C25.8)
AssertionError: expected 'session-canceled' to be 'inquiry-expired'
AssertionError: expected 'session-canceled' to be 'redacted'
AssertionError: expected null to match object { code: 'session_canceled', …(1) }
TestingLibraryElementError: Unable to find role="heading" and name "This verification link has expired"
TestingLibraryElementError: Unable to find role="heading" and name "This verification session has ended"   (unknown reason)
      Tests  11 failed | 97 passed (108)

$ (cd apps/flow && pnpm exec playwright test --config e2e/playwright.config.ts session-ended.spec.ts)
  ✘ why a session was canceled (C25.8) › an inquiry expired during the flow ends it on the link-expired screen
  ✘ why a session was canceled (C25.8) › an inquiry redacted during the flow ends it on the redacted screen
  ✘ why a session was canceled (C25.8) › a session canceled with reason inquiry_archived_by_a_newer_server ends on the ended screen
    Locator: getByRole('heading', { name: 'This verification session has ended', level: 1 })
    Expected: visible
    Error: element(s) not found
  3 failed
  4 passed (9.6s)
```

The `inquiry_finished` cases already passed, as they should: the ended screen was the old answer to every canceled session.

**GREEN** (commit `3859c21`).

```text
$ (cd apps/flow && pnpm exec vitest run src/api/final-outcome.test.ts src/api/flow-api-client.test.ts src/flow/flow-renderer.test.tsx src/steps/session-ended-screen.test.tsx src/app.test.tsx --coverage.enabled=false)
 Test Files  5 passed (5)
      Tests  108 passed (108)

$ (cd apps/flow && pnpm exec playwright test --config e2e/playwright.config.ts session-ended.spec.ts)
  ✓ why a session was canceled (C25.8) › an inquiry expired during the flow ends it on the link-expired screen
  ✓ why a session was canceled (C25.8) › an inquiry redacted during the flow ends it on the redacted screen
  ✓ why a session was canceled (C25.8) › a session canceled with reason inquiry_finished ends on the ended screen
  ✓ why a session was canceled (C25.8) › a session canceled with reason inquiry_archived_by_a_newer_server ends on the ended screen
  7 passed (4.7s)
```

## C28 F010, web flow: the language select is outlined with the control token

**Confirmed.** `components/language-select.tsx` used `border-line`, the decorative separator token (about 1.5:1 against white). Every other control uses `border-control`. That token is defined once in `@openverify/ui/styles.css` (`--color-control: oklch(55.1% 0.027 264.364)`, 4.8:1 on surface, 4.6:1 on canvas), which the flow imports. So the flow uses the same token and value; it adds no colour of its own.

**RED** (commit `a67d9a7`):
- a unit test that the select has `border-control` and not `border-line`;
- a mocked-browser test that, in the production bundle, the select's computed `border-top-color` equals the computed `var(--color-control)`.

```text
$ (cd apps/flow && pnpm exec vitest run src/components/language-select.test.tsx --coverage.enabled=false)
     × is outlined like every other form control, at 3:1 or more (Workflow 2D F010, WCAG 1.4.11)
Error: expect(element).toHaveClass("border-control")
      Tests  1 failed | 1 passed (2)

$ (cd apps/flow && pnpm exec playwright test --config e2e/playwright.config.ts flow.spec.ts -g "control colour")
  ✘ outlines the language select with the control colour of the built CSS (Workflow 2D F010)
    Expected: "oklch(0.551 0.027 264.364)"
    Received: "oklch(0.872 0.01 258.338)"
  1 failed
```

**GREEN** (commit `c182702`): `border-line` became `border-control`.

```text
      Tests  2 passed (2)
  ✓ outlines the language select with the control colour of the built CSS (Workflow 2D F010)
  1 passed (3.2s)
```

## C28 F016, web flow: focus around a one-time-link retry

**Confirmed.** In `OneTimeLinkFlow`, Try again replaced the error screen with the loading card. The button was unmounted, so focus fell to `<body>`. When the redeem settled, no new screen got focus either:
- the used-link screen;
- the error screen again.

`FlowRenderer` moves focus to the heading of each screen that replaces another.

**Fix.**
- **During the retry.** The error screen stays while the retry runs, so focus stays on Try again. `ApiError` gains `retrying`: the button is `aria-disabled` and ignores presses (a `disabled` button would lose focus), and a status says "Loading your verification…". A second press while busy redeems nothing.
- **When the redeem settles.** Focus moves to the heading of the next screen, as in `FlowRenderer`. The screen key is the state, plus the attempt for errors.
- **After a successful retry.** `FlowRenderer` takes over and moves focus to its first step's heading once the session has loaded. While that one `GET /flow/session` runs, the flow shows its loading status, and focus is on the page, as on `FlowRenderer`'s own retries.

**RED** (commit `67a3ae4`). Unit tests use a redeem promise that the test settles. There is also a mocked-browser test with two redeems that never answer, and the page clock.

```text
$ (cd apps/flow && pnpm exec vitest run src/flow/one-time-link-flow.test.tsx --coverage.enabled=false)
     × keeps focus on Try again while the retry runs, and redeems once however often it is pressed
     × moves focus to the used-link heading when the retried link is refused
     × moves focus to the error heading, and offers Try again again, when the retry fails too
Error: expect(element).toBeInTheDocument()
Error: expect(element).toHaveFocus()   Expected element with focus: <h1 ...>   Received element with focus: <body>
      Tests  3 failed | 9 passed (12)

$ (cd apps/flow && pnpm exec playwright test --config e2e/playwright.config.ts timeouts.spec.ts)
  ✘ a retried one-time link keeps focus on Try again, then moves it to the next heading (2D F016)
    Locator:  getByRole('heading', { name: 'Something went wrong', level: 1 })
    Expected: focused
    Received: inactive
  1 failed
  2 passed (8.9s)
```

`moves focus to the heading of the flow once the retried link opens it` already passed: `FlowRenderer` focuses its first heading after loading.

**GREEN** (commit `75db0b8`).

```text
$ (cd apps/flow && pnpm exec vitest run src/flow/one-time-link-flow.test.tsx src/components/api-error.test.tsx src/flow/flow-renderer.test.tsx src/app.test.tsx --coverage.enabled=false)
      Tests  54 passed (54)
$ (cd apps/flow && pnpm exec playwright test --config e2e/playwright.config.ts timeouts.spec.ts one-time-link.spec.ts)
  ✓ a retried one-time link keeps focus on Try again, then moves it to the next heading (2D F016)
  6 passed (4.8s)
```

**Refactor** (commit `68f929e`). The heading-focus effect lived in both `FlowRenderer` and `OneTimeLinkFlow`; it is now one hook, `flow/use-screen-focus.ts` (`useScreenFocus(screen)`).

```text
$ (cd apps/flow && pnpm exec vitest run --coverage.enabled=false)
 Test Files  40 passed (40)
      Tests  522 passed (522)
```

## C25.8, Android: decode the reason, and map it to the same three screens

**Fix.**
- `SessionCanceledReason` (`model/WireEnums.kt`) is a wire enum: `INQUIRY_REDACTED`, `INQUIRY_EXPIRED`, `INQUIRY_FINISHED`, and `UNKNOWN` for a value from a newer server, which decodes instead of failing (the `WireEnumSerializer` pattern of `InquiryStatus`).
- `Problem.reason: SessionCanceledReason?`.
- `FlowCoordinator.endingFor` maps the reason:

  | Reason | State | Screen | Result to the host app |
  |---|---|---|---|
  | `INQUIRY_EXPIRED` | `FlowState.Expired` | the expired screen | `FailureReason.INQUIRY_EXPIRED` |
  | `INQUIRY_REDACTED` | `FlowState.Redacted` | the redacted screen | `INQUIRY_REDACTED` |
  | `INQUIRY_FINISHED`, `UNKNOWN`, none | `FlowState.SessionEnded(CANCELED)` | as before | `SESSION_CANCELED` |

- The KDoc of `FailureReason.SESSION_CANCELED` and `SessionEndReason.CANCELED` now says so.

**Stub** (commit `4d5e953`). The enum, and `@Transient val reason` (not decoded), so the tests compile.

**RED** (commit `1967e77`):
- `WireModelTest`: every reason decodes; an unknown one decodes as `UNKNOWN` and keeps the code.
- `ContractFixturesTest`: every `problems/*.json` fixture (`Fixtures.list("problems")`) has an expected reason, and decodes with status 401, code `session_canceled` and that reason.
- `FlowApiClientTest`: the golden problem served by MockWebServer keeps its reason.
- `FlowCoordinatorTest`:
  - each reason, null included, ends on its state, which no retry leaves;
  - each golden problem ends the flow on its state.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.model.WireModelTest' --tests 'dev.openverify.sdk.model.ContractFixturesTest' --tests 'dev.openverify.sdk.api.FlowApiClientTest' --tests 'dev.openverify.sdk.flow.FlowCoordinatorTest'
184 tests completed, 10 failed
x FlowCoordinatorTest > problems/session-canceled-inquiry-expired.json   expected: <Expired> but was: <SessionEnded(reason=CANCELED)>
x FlowCoordinatorTest > problems/session-canceled-inquiry-redacted.json  expected: <Redacted> but was: <SessionEnded(reason=CANCELED)>
x FlowCoordinatorTest > INQUIRY_EXPIRED                                  expected: <Expired> but was: <SessionEnded(reason=CANCELED)>
x FlowCoordinatorTest > INQUIRY_REDACTED                                 expected: <Redacted> but was: <SessionEnded(reason=CANCELED)>
x ContractFixturesTest > problems/session-canceled-inquiry-expired.json  expected: <INQUIRY_EXPIRED> but was: <null>
x ContractFixturesTest > problems/session-canceled-inquiry-finished.json expected: <INQUIRY_FINISHED> but was: <null>
x ContractFixturesTest > problems/session-canceled-inquiry-redacted.json expected: <INQUIRY_REDACTED> but was: <null>
x WireModelTest > each cancel reason decodes from its wire value (C25)()  expected: <INQUIRY_REDACTED> but was: <null>
x WireModelTest > a cancel reason a newer server adds decodes as UNKNOWN and keeps the code (C25)()  expected: <UNKNOWN> but was: <null>
x FlowApiClientTest > a canceled session's 401 keeps its reason, from the golden problem (C25)()  expected: <INQUIRY_EXPIRED> but was: <null>
BUILD FAILED in 29s
```

**GREEN** (commit `23e2bef`).

```text
$ (same command)
tests 184 failed 0
```

**Host-facing guard** (commit `9633ab2`). `InquiryViewModelTest` checks that each golden problem reports its `FailureReason` to the host app. It passes on the implementation. A temporary mutant of `endingFor` that ignores the reason makes it fail:

```text
## mutant: every session_canceled -> SessionEnded(CANCELED)
12 tests completed, 2 failed
x problems/session-canceled-inquiry-expired.json   expected: <Failed(..., reason=INQUIRY_EXPIRED)> but was: <Failed(..., reason=SESSION_CANCELED)>
x problems/session-canceled-inquiry-redacted.json  expected: <Failed(..., reason=INQUIRY_REDACTED)> but was: <Failed(..., reason=SESSION_CANCELED)>
## restored (git diff empty)
tests="12" skipped="0" failures="0" errors="0"
```

## C28 F018, Android half: a create whose answer was lost is not made twice

**Confirmed.** `FlowCoordinator.process` called `api.createVerification` again on Retry after a `FlowApiException.Network`. That error covers every OkHttp `IOException`, timeouts included. When the server had created the verification but the answer was lost, the retry created a second one, and the server counts each verification of a type as an attempt.

**Fix.** It mirrors `apps/flow/src/flow/submit-verification.ts` (Workflow 2D):
- **After a lost answer.** A `Network` error on the create makes `createVerification(work)` read the session. When the newest verification of the type is `initiated`, it is reused: the lost request created it, since one that existed before would have been reused from the start (`verificationState`).
- **When the session cannot be read either.** The original error stands, and `StepWork.createUnconfirmed` makes the next attempt read the session before creating.
- **An answered refusal.** An HTTP error from the create does not trigger a read.
- **An ending answer.** One that ends the flow during that read (C19, C25.8) still ends it.

**RED** (commit `00da8e9`). `FakeFlowApi.loseAnswerOfNext(call, error)` runs the create, then throws.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.flow.FlowCoordinatorTest'
79 tests completed, 5 failed
x a session found ended while a lost create is checked ends the flow on its screen()
    expected: <Expired> but was: <Error(error=NETWORK, canRetry=true)>
x java.net.SocketTimeoutException: timeout            (OkHttp read timeout)
    expected: <Capture(... SELFIE_CENTER ...)> but was: <Error(error=NETWORK, canRetry=true)>
x java.io.InterruptedIOException: timeout             (OkHttp call timeout)
    expected: <Capture(... SELFIE_CENTER ...)> but was: <Error(error=NETWORK, canRetry=true)>
x java.io.IOException: unexpected end of stream
    expected: <Capture(... SELFIE_CENTER ...)> but was: <Error(error=NETWORK, canRetry=true)>
x when the session cannot be read after a lost create either, each retry reads it first and never creates twice()
    expected: <1> but was: <2>
BUILD FAILED in 35s
```

Two guards passed already, as they should:
- `a create that never reached the server is made again on retry, after the session shows it is missing`, with an earlier failed attempt in the session;
- `an answered refusal of the create is not taken for a lost answer`.

**GREEN** (commit `ebab52b`).

```text
$ (same command)
FlowCoordinatorTest tests 79 failures 0 errors 0
```

**Guard: OkHttp timeouts are `Network` errors** (commit `b2b3186`). `FlowApiClientTest` sends a create to a MockWebServer that delays its headers by 30 s:
- with a 200 ms read timeout, the error is `FlowApiException.Network` with an `InterruptedIOException` cause;
- with a 200 ms call timeout, the same.

The first run of this test had a mistake: its `runBlocking` body ended with `assertInstanceOf(...)`, so the method returned a value, and JUnit 5 silently skips non-void test methods (59 tests ran, not 61). An explicit `: Unit` fixed it.

```text
FlowApiClientTest: tests="61" skipped="0" failures="0" errors="0"   (read timeout 0.313 s, call timeout 0.209 s)
## mutant: FlowHttp maps InterruptedIOException to InvalidResponse
61 tests completed, 2 failed
x read timeout   expected: <FlowApiException.Network> but was: <FlowApiException.InvalidResponse>
x call timeout   expected: <FlowApiException.Network> but was: <FlowApiException.InvalidResponse>
## restored (git diff empty): 61 passed
```

## C28 F022, Android: "a refused link stays refused" detects a second redeem

**Confirmed.** The test's redeem always refused, so a second redeem would also have refused and the test could not see it. Commit `61befc4` changed the test:
- the server refuses only the first redeem;
- three calls must all throw the same `LinkRefused`, with exactly one redeem, no connect and no delegate call.

```text
## mutant: OneTimeLinkFlowApi forgets its refusal (`refusal?.let { throw it }` removed)
## the old test, against the mutant: it passes, so it was blind
OneTimeLinkFlowApiTest tests 4 failures 0
ok a refused link stays refused()
## the new test, against the same mutant
4 tests completed, 1 failed
x a refused link stays refused, without a second redeem (2D F022)()
    Expected dev.openverify.sdk.api.FlowApiException.LinkRefused to be thrown, but nothing was thrown.
## restored (git diff empty)
OneTimeLinkFlowApiTest tests 4 failures 0
```

## C28 F023, Android: the picked-photo metadata test has real metadata

**Confirmed.** `a picked PNG is re-encoded as a JPEG, so no metadata leaves the device` passed a PNG with no metadata at all, so it showed nothing about metadata. Commit `d971afa` made two changes:
- **Rename.** The PNG test keeps its body as `a picked PNG is re-encoded as a JPEG of the same size`.
- **New test.** `a picked photo's metadata, where it was taken and the camera, never leaves the device (2D F023)`:
  - **Input.** The platform's `android.media.ExifInterface` writes a synthetic camera make and model and GPS rationals (12.3456 N, 32.1098 W, open ocean) into a JPEG. The test reads them back from the input bytes, to prove they are there.
  - **Output.** After `PickedPhotos.toUpload`, the upload has no make, model or GPS tag and no latitude or longitude, its bytes contain neither string, and it still decodes at 60 x 40.

```text
## real implementation
PickedPhotosTest tests 12 failures 0 errors 0
## mutant: a small JPEG is uploaded as it is
12 tests completed, 1 failed
ok a picked PNG is re-encoded as a JPEG of the same size        (the old test's body, still blind)
x a picked photo's metadata, where it was taken and the camera, never leaves the device (2D F023)
    java.lang.AssertionError: expected null, but was:<OpenVerifySyntheticMake>
## restored (git diff empty)
PickedPhotosTest tests 12 failures 0 errors 0
```

## Full stack: C25.8 end to end

`e2e/tests/ui-flow-links.spec.ts` gained a test (commit `70fb353`), on the real stack:
1. A one-time link opens the flow, which shows the consent screen.
2. The customer backend expires the inquiry with `client.inquiries.expire(id)`. C10 cancels its active sessions.
3. Consent is sent: the API answers 401 `session_canceled` with `reason: inquiry_expired`.

The test expects:
- "This verification link has expired", focused, with its message and no button;
- the inquiry's only session `canceled`.

**RED.** The flow fix was already committed, so the test ran against a temporary mutant of `final-outcome.ts` that ignores the reason. The script made the edit, built, ran the test and restored the file, all inside one `flock /tmp/openverify-e2e.lock`, so no other agent's build could see it.

```text
$ flock /tmp/openverify-e2e.lock sh scratchpad/e2e-mutant-run.sh   (mutate; pnpm turbo run build --filter=@openverify/e2e^...; playwright test tests/ui-flow-links.spec.ts -g "C25.8"; restore)
41:  return 'session-canceled'; // MUTANT (temporary, never committed)
    Locator: getByRole('heading', { name: 'This verification link has expired', level: 1 })
    Expected: focused
    Error: element(s) not found
  page:  region "This verification session has ended" (the old screen, from the real API's inquiry_expired answer)
  1 failed
mutant restored   (git diff of apps/flow empty)
```

**GREEN** (the flow as committed):

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-flow-links.spec.ts'
  ✓ a one-time link opens the flow once, in the sandbox, and the user finishes it (6.2s)
  ✓ a session expired through the server API ends the flow on its own screen (658ms)
  ✓ a session link reloaded after its session expired shows the inactive-session screen (610ms)
  ✓ an inquiry expired through the server API while its link is open ends the flow on the link-expired screen (C25.8) (720ms)
  4 passed (42.6s)
```

## Final validation (foreground, after the last code commit `9633ab2`)

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/flow typecheck` | pass (`tsc --noEmit && tsc --noEmit -p e2e`) |
| `pnpm --filter @openverify/flow lint` | pass |
| `pnpm --filter @openverify/flow test` | 40 files, 522 tests (2D: 495); coverage 98.8% statements, 95.54% branches, 99.26% functions, 98.87% lines (gate 80%) |
| `pnpm --filter @openverify/flow e2e` (mocked, production bundle) | 25 passed (2D: 19) |
| `(cd android && ./gradlew --no-daemon testDebugUnitTest koverVerify assembleDebug lint)` | BUILD SUCCESSFUL in 1m 29s; `openverify-sdk` 456 tests (2D: 428), `demo-app` 18, none failed or skipped; Kover line coverage 97.39% (gate 80%); assemble and lint pass |
| `flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-flow-links.spec.ts tests/verification-completes.spec.ts tests/verification-fails.spec.ts tests/reload-between-uploads.spec.ts'` | 7 passed (1.3 min) |
| `pnpm format:check` | pass. A first run failed on one file outside this slice, `apps/dashboard/src/app/api-keys/actions.test.ts`, which had uncommitted edits by `console-gaps` at the time; this slice's files passed then too. The rerun after commit `b0f762a` passed for the whole repository |
