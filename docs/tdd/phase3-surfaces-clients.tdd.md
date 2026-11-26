# TDD evidence: Workflow 3B Stage 1, surfaces-clients (web flow and Android)

- **Slice owner:** `surfaces-clients` (Workflow 3B, Stage 1, in parallel with `surfaces-dashboard`).
- **Date:** 2026-10-21.
- **Paths owned:**
  - `apps/flow/**`, including the mocked Playwright suite in `apps/flow/e2e`;
  - `android/**`;
  - `contracts/fixtures/flow/retry-hint-reasons.json` (new, the one shared fixture);
  - this file.
- **Input:** C37 for the web flow and Android, C29.4's retry strings, C30.6, the Kotlin MRZ vectors of C33, and the C38 client carry-overs: E002, the `FlowRenderer` retry focus, and the create answered with an unexpected body.
- **Dependencies:** none added.

Each change follows the same cycle:
1. Write the test and run it, to see it fail for the intended reason (RED). Every RED commit compiles and typechecks (`tsc --noEmit && tsc --noEmit -p e2e` for the flow, Gradle compilation for Android).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

**Guard tests.** Three items needed no production change, because Workflow 3A had already built the behaviour (`needs_review` as done) or the code was already right (`Mrz.kt`, and the colour token E002 guards). For these, RED is a mutant: a temporary edit of the implementation, never committed, that the new test catches. The old test, where there was one, missed it. Each mutant ran from a script in the session scratchpad that saved the file first and copied it back afterwards; `git diff --stat` on the file was empty afterwards each time. Mutants of `apps/flow` ran under `flock /tmp/openverify-e2e.lock`, so the full-stack stack, which builds the flow from the working tree, never saw them.

**How the commands ran.** All of them ran after `source scripts/env.sh`: TypeScript from `apps/flow`, Gradle from `android/`. The output is trimmed to the lines that matter. Android failure messages come from `openverify-sdk/build/test-results/testDebugUnitTest/*.xml`.

## 1. Retry hints for the Phase 3 reasons

### The reasons, derived from the contracts

A retry hint names a failed, required `user_behavior` check (`retryHintsFromChecks`, `packages/contracts/src/verifications.ts`). So the reasons it can carry are those `GOVERNMENT_ID_CHECK_REASONS` and `PHASE1_CHECK_REASONS` list for `user_behavior` checks, less the shared reasons only a `not_applicable` result carries. C29.4 makes every shared reason `not_applicable` except `image_unreadable`, which fails the check. `apps/flow/src/i18n/retry-reasons.test.ts` computes this from the contracts and the core registry. The result is 20 reasons, and 12 had no string: exactly the list Workflow 3A's integration found.

`contracts/fixtures/flow/retry-hint-reasons.json` (`schema_version` 1, `reasons`, sorted) shares the list with Kotlin. The same TypeScript test keeps it equal to the contracts.

### Web flow

**RED** (commit `cd84da7`):

```text
$ pnpm exec vitest run src/i18n/retry-reasons.test.ts --coverage.enabled=false
     × are listed, exactly, in the fixture the Android SDK reads
     × has its own message for every reason a retry hint can carry          (en, es)
     × shows each of those messages in this language, not a fallback      (en, es)
     × says something different for each reason                          (en, es)
AssertionError: expected undefined to be 1                      (no fixture yet)
AssertionError: expected [ 'back_feature_not_found', …(11) ] to deeply equal []
+   "back_feature_not_found", "barcode_not_found", "document_not_found",
+   "identity_features_not_found", "insufficient_text", "mrz_not_found",
+   "mrz_unreadable", "portrait_blurry", "portrait_obstructed",
+   "portrait_too_small", "required_fields_missing", "resolution_too_low",
AssertionError: expected 9 to be 20
      Tests  7 failed | 3 passed (10)
```

**GREEN** (commit `d366deb`): the fixture, and the 12 strings in `en.ts` and `es.ts`. Each says what to do differently on the next photo and names no fraud signal; the test also rejects fraud words in either language.

```text
$ pnpm exec vitest run src/i18n/ src/components/retry-hints.test.tsx --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  53 passed (53)
```

**A Vitest gotcha found on the way.** The RED test first read the fixture with `import.meta.glob`. After the fixture was added, the test kept failing with `expected undefined to be 1`, while a copy of the same file under another name passed. Vitest 5 keeps a file-system module cache (`fsModuleCache`, on by default, in `node_modules/.vitest-cache`). It reused the transform of the unchanged test file, with the glob result from before the fixture existed. The GREEN commit reads the fixture with a static JSON import instead, so its cache entry follows the JSON's content. The existing `src/testing/golden-problems.ts` glob has the same latent issue (see the follow-ups).

### Android

**Spanish (a decision).** The SDK had English resources only, but its pattern is resource-based localisation: `openverify_locale` names "the language these strings are written in" and is sent with consent (`OpenVerifyInquiryActivity`). A `values-es` resource set fits that pattern, follows the web flow's `es.ts` (consent texts included, with "pantalla" where the app says "screen"), and makes the SDK record `es` with consent on a Spanish device. `openverify_locale` lost `translatable="false"`: every translation must set its own tag, and lint's `MissingTranslation` now requires it. The plan only required English on Android (C29.4); C37 asks for English and Spanish on both clients, which this delivers.

**RED** (commit `7d44709`): `MessagesTest` reads the shared fixture from the classpath; `SpanishMessagesTest` (Robolectric, `@Config(qualifiers = "es")`) compares each string with its English text.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.ui.MessagesTest' --tests 'dev.openverify.sdk.ui.SpanishMessagesTest'
18 tests completed, 4 failed
x every reason a retry hint can carry has its own message (C29_4)
    expected: <[]> but was: <[back_feature_not_found, barcode_not_found, document_not_found, identity_features_not_found,
    image_unreadable, insufficient_text, mrz_not_found, mrz_unreadable, portrait_blurry, portrait_obstructed,
    portrait_too_small, required_fields_missing, resolution_too_low]>
x every SDK string has its own Spanish text            expected:<[]> but was:<[openverify_camera_allow, … every string]>
x consent is recorded with the language its texts were shown in      expected:<e[s]> but was:<e[n]>
x every reason a retry hint can carry reads in Spanish (C29_4)        (all 20 reasons)
```

`image_unreadable` is the one C29.4 says Android also lacked.

**GREEN** (commit `bee8a6b`): 13 English strings, `values-es/strings.xml` (all 100 strings), and the `Messages.kt` map.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.ui.*'
MessagesTest 15/0, SpanishMessagesTest 3/0, CaptureScreenTest 14/0, ConsentScreenTest 5/0,
InquiryFlowScreenTest 13/0, StatusScreensTest 16/0, CameraPermissionGateTest 6/0
$ ./gradlew --no-daemon -q :openverify-sdk:lintDebug :openverify-sdk:testDebugUnitTest :demo-app:lintDebug
openverify-sdk: 463 tests, 0 failed
lint: only the existing GradleDependency, NewerVersionAvailable and OldTargetApi warnings, none about resources
```

## 2. `needs_review` is done for the user (C30.6, guard tests)

Workflow 3A Stage 1 had changed `flow-position.ts`, `processing-step.tsx` and Android's `NEEDS_REVIEW`. These tests check the whole path: a government ID or a selfie in review leads to the normal "Verification submitted" screen, with no retry hint, no retry and no "verified" message.

- **Web** (commit `1c03edd`):
  - `FlowRenderer` tests for an ID and for a selfie in review;
  - mocked `e2e/review.spec.ts`, which also reloads and gets the same screen.

  `FakeFlowApi` and `MockFlowApi` now settle the inquiry as C30.5 does: `completed`, then `needs_review` when a verification is in review.
- **Android** (commit `f7d267f`):
  - `FlowCoordinatorTest` runs both cases end to end: one create per type, no retry hints, no error, then `Completed(completionStep, NEEDS_REVIEW)`;
  - `StatusScreensTest`: the completion screen, with no retry;
  - `InquiryResultsTest` and `OpenVerifyInquiryContractTest`: the host app gets `InquiryResult.Completed` with `NEEDS_REVIEW`, through the activity result too.

Real code: every new test passes (web `review.spec.ts` 2 passed; vitest 540 passed; Android `FlowCoordinatorTest` 86/0, `StatusScreensTest` 17/0, `InquiryResultsTest` 23/0, `OpenVerifyInquiryContractTest` 11/0).

**Mutants:**

```text
web M1  flow-position: needs_review takes the failed branch (a new attempt)
  vitest  × … when a government ID is sent to review …   Tests 1 failed | 1 passed
  playwright ✘ a government ID in review …  heading 'Take a selfie' not visible
             ✓ a selfie in review …   (the inquiry's needs_review status ends the flow first, correctly)
web M2  processing-step: needs_review not in DECIDED (polling never stops)
  vitest  Tests 2 failed;  playwright 2 failed ('Take a selfie' not visible; 'Verification submitted' not focused)
android M1  FlowCoordinator: NEEDS_REVIEW not a done status
  86 tests completed, 3 failed: the two existing review tests, and
  x ID NEEDS_REVIEW, selfie PASSED   expected <Completed(…, NEEDS_REVIEW)> but was <Capture(step=GovernmentIdStep …)>
android M2  VerificationStatus.isDecided without NEEDS_REVIEW
  86 tests completed, 3 failed: one existing test, and both new cases: but was <Error(error=STILL_PROCESSING, canRetry=true)>
```

## 3. Kotlin MRZ vectors (C33, C37, guard tests)

`MrzVectorsTest` (commit `b3fcb4d`) reads every file of `contracts/fixtures/mrz/` through `Fixtures.list("mrz")`, so a vector `checks-logic` adds is tested without a change. It covers 23 vectors in 44 tests:
- **Check digits:** for every vector with `check_digits`, `Mrz.checkDigit(input)` equals `computed`, each printed digit's `valid` follows, and the vector's `valid` is all of them.
- **Layouts:** test-only ICAO 9303 layouts (TD1, TD2, TD3, MRV-A, MRV-B, and the TD1/TD2 long document number) find the same inputs and printed digits in the lines. They were checked first against every vector in Python ("ALL OK").
- **OCR corrections:** the corrections, applied to the lines read, give `corrected_lines`. A vector is `valid` exactly when every check digit `Mrz` computes on those lines holds.
- **Structural errors:** `Mrz` refuses the one line with a character outside the MRZ set, without echoing it; an unrecognized layout has only MRZ characters.
- **BAC:** `BacKeySeed.mrzInformation` of each vector's document number and dates.

```text
real code: MrzVectorsTest 44/0, MrzTest 17/0, BacKeySeedTest 13/0
mutant: Mrz.characterValue gives 'Z' the value 36 (instead of 35)
74 tests completed, 4 failed — all in MrzVectorsTest:
  x td3-issuing-state-digit-zero, x td3-composite-letter-o      expected: <true> but was: <false>
  x icao-9303-p4-td3, x td3-document-number-check-digit         optional_data: computed ==> expected: <1> but was: <8>
MrzTest 17/0 and BacKeySeedTest 13/0 under the same mutant: blind to it (no Z in their inputs)
```

## 4. E002: the F010 browser test could not fail (guard test)

**Confirmed.** The old test coloured a probe `var(--color-control)`. When the property is undefined, the probe's colour is invalid at computed-value time, so it inherits the page's text colour. The select's border falls back to `currentColor`, the same colour. So `control !== ''` always held, and the border matched the probe either way.

**Change** (commit `9f5ece9`, `e2e/flow.spec.ts`). The test reads `--color-control` and `--color-line` on the root, as the built CSS defines them (`@layer theme{:root,:host{…}}`). Both must be defined, the border must be the control colour, and it must not be the line colour.

```text
                                          old test   new test
real CSS                                  ✓          ✓
mutant 1  :root { --color-control: initial; }         ✓          ✘ Expected: not ""   (colours.control.value)
mutant 2  :root { --color-control: var(--color-line); } ✓        ✘ Expected: not "oklch(0.872 0.01 258.338)"
```

## 5. `FlowRenderer` keeps focus through a retried load (2E follow-up)

**Confirmed.** Try again after a failed session load set the state to `loading`. The loading card replaced the error screen, so the focused button was unmounted and focus fell to `<body>` (F016 had fixed this only for one-time links).

**Fix.** It follows F016:
- `LoadState`'s error carries `attempt` and `retrying`. While the retry runs, the error screen stays, and `ApiError` makes Try again `aria-disabled` with a "Loading your verification…" status. A second press does nothing.
- A failed retry is a new attempt and a new screen key (`error:<n>`), so focus moves to its heading.
- A successful retry moves focus to the next step's heading.

**RED** (commit `72317a6`):

```text
$ pnpm exec vitest run src/flow/flow-renderer.test.tsx -t "keeps focus on Try again" --coverage.enabled=false
     × keeps focus on Try again while a failed load is retried, then moves it to the next heading (2E follow-up)
AssertionError: expected <body><div><div>…(1)</div></div></body> to be <button type="button" …(2)></button>
$ pnpm exec playwright test --config e2e/playwright.config.ts timeouts.spec.ts
  ✘ a retried session load keeps focus on Try again, then moves it to the next heading (2E follow-up)
    Locator: getByRole('button', { name: 'Try again' })   Expected: focused
  1 failed, 3 passed
```

**GREEN** (commit `be6e488`). The first GREEN run still failed one step later, and the cause was the test. The failed retry shows the same heading text, so `findByRole('heading', …)` returned the old heading before the rejection had rendered. The test now waits for the new error's text, then reads `document.activeElement`. The assertions are unchanged.

```text
$ pnpm exec vitest run src/flow/flow-renderer.test.tsx --coverage.enabled=false     (3 runs)
      Tests  27 passed (27)   ×3
$ pnpm exec playwright test --config e2e/playwright.config.ts timeouts.spec.ts
  4 passed (3.8s)
```

## 6. A create answered 2xx with an unexpected body (2E follow-up)

**Confirmed on both clients.**
- **Web:** `submitVerification` treated a create's `invalid-response` (a 2xx whose body fails the contract) as a refusal, so Try again created a second verification.
- **Android:** `FlowCoordinator.createVerification` re-read the session only after `FlowApiException.Network` (2D F018), so an `InvalidResponse` was retried as a new create.

The flow API has no idempotency key, and each verification of a type counts as an attempt.

**Fix:** the same on both clients. Such an answer means made but unreadable, so it is handled like a lost answer:
1. Read the session, and reuse the newest `initiated` verification of the type.
2. When the session cannot be read either, the original error stands, and the next attempt reads the session before any create.
3. When the session shows none, the original error stands, and a retry creates after reading.

**RED, web** (commit `a847388`). The mocked API gains `garble`: the request does its work, then answers 201 without the attributes.

```text
$ pnpm exec vitest run src/flow/submit-verification.test.ts --coverage.enabled=false
     × takes the verification as created but unreadable, and reuses the one the session shows
     × never creates a second verification when the session cannot be read after it either
     × fails with the unexpected answer when the session shows no initiated verification of the type
FlowApiError: POST /api/v1/flow/verifications returned an unexpected body
AssertionError: expected "vi.fn()" to be called once, but got 0 times
      Tests  3 failed | 9 passed (12)
$ pnpm exec playwright test --config e2e/playwright.config.ts unreadable-create.spec.ts
  ✘ a create answered with an unexpected body is never made twice
    heading 'Take a selfie' not found; the page shows "Something went wrong. Try again." with Retake photos and Try again
```

**GREEN, web** (commit `287d846`):

```text
$ pnpm exec vitest run src/flow/submit-verification.test.ts src/steps/verification-capture-step.test.tsx src/flow/flow-renderer.test.tsx --coverage.enabled=false
      Tests  55 passed (55)
$ pnpm exec playwright test --config e2e/playwright.config.ts unreadable-create.spec.ts flow.spec.ts
  10 passed (5.1s)
```

**RED, Android** (commit `8a1b09c`). `FakeFlowApi.loseAnswerOfNext` with an `InvalidResponse` makes the create, then throws. A `FlowApiClientTest` guard shows that a 201 create without the attributes is an `InvalidResponse`; it passed already.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.flow.FlowCoordinatorTest' --tests 'dev.openverify.sdk.api.FlowApiClientTest'
146 tests completed, 3 failed
x a create answered with an unexpected body is taken as made, and the verification the session shows is reused
    expected: <Capture(step=SelfieStep …)> but was: <Error(error=INVALID_RESPONSE, canRetry=true)>
x an unreadable create the session does not show is made again on retry, after the session is read
    expected: <[getSession, createVerification:government-id, getSession, getSession, createVerification:government-id]>
    but was:  <[getSession, createVerification:government-id, createVerification:government-id, upload:front, upload:back]>
x when the session cannot be read after an unreadable create either, the retry reads it first and never creates twice
    expected: <Capture(step=SelfieStep …)> but was: <Error(error=NETWORK, canRetry=true)>   (the retry created again)
```

**GREEN, Android** (commit `d436d64`):

```text
FlowCoordinatorTest 84/0, FlowApiClientTest 62/0
```

## 7. Only what the flow API sends; unknown values from a newer server

Checked; no change was needed.
- Neither client gained an extraction attribute. The flow view carries status and retry hints only, and the Android full-view model ignores the new members (`ignoreUnknownKeys`); `ContractFixturesTest` decodes the Phase 3 `verification-government-id.json`.
- Retry reasons stay strings on both clients, with the generic message for a reason a newer server adds (`retry-hints.test.tsx`, `MessagesTest`).
- Android decodes every status a newer server may add as `UNKNOWN` (`WireModelTest`).
- The web flow parses with the strict contract schemas, so an unknown verification status, or an unknown check name in a retry hint, fails its parse; see the follow-ups.

## Final validation (foreground)

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/flow typecheck` | pass (`tsc --noEmit && tsc --noEmit -p e2e`) |
| `pnpm --filter @openverify/flow lint` | pass |
| `pnpm --filter @openverify/flow test` | 41 files, 540 tests (Workflow 3A: 524); coverage 98.81% statements, 95.63% branches, 99.27% functions, 98.87% lines (gate 80%) |
| `pnpm --filter @openverify/flow e2e` (mocked, production bundle) | 29 passed (Workflow 3A: 25) |
| `pnpm format:check` | pass |
| `(cd android && ./gradlew --no-daemon testDebugUnitTest koverVerify assembleDebug lint)` | BUILD SUCCESSFUL in 1m 34s; `openverify-sdk` 516 tests, `demo-app` 18, none failed or skipped; Kover line coverage 97.43% (gate 80%); lint only the existing version warnings |
| `flock /tmp/openverify-e2e.lock pnpm e2e` | see below |

**Full stack, first run** (07:07 to 07:11, under the lock): `@openverify/flow#e2e` 29 passed; `@openverify/e2e#e2e` 43 passed, 1 failed.

```text
  1) tests/verification-completes.spec.ts:63:1 › an inquiry on the default template completes with every required check passed
     Locator: getByRole('table', { name: 'Government ID checks' }).getByRole('row').filter({ has: getByRole('rowheader', { name: 'id_blur_detection', exact: true }) })
     Expected substring: "Passed"   Error: element(s) not found
  1 failed, 43 passed (4.5m)
```

The failure is not in this slice's paths. `surfaces-dashboard` committed `bb657fc` at 07:07:32, while this run was building. It folds a verification's checks into a closed `<details>` (`apps/dashboard/src/components/check-results.tsx`), and it opened the disclosure in `ui-console-gaps.spec.ts`. It did not open it in `verification-completes.spec.ts`, whose `checkRow` (`e2e/tests/support/dashboard.ts`) queries a table the closed disclosure hides. The flow half of that spec passed. Every full-stack spec that runs the web flow passed: `government-id-checks.spec.ts` (the blur retry hint, the expired card without a retry, the specimen card), `government-id-review.spec.ts`, `reload-between-uploads.spec.ts` and `ui-flow-links.spec.ts`.

`surfaces-dashboard` records the same failure as its blocker in `docs/tdd/phase3-surfaces-dashboard.tdd.md` (commit `0977782`), with a patch that opens each card's disclosure before reading the rows. It proved that patch on the full stack with a temporary copy of the spec, on a tree that held every commit of this slice: 1 passed. `verification-completes.spec.ts` belongs to no Stage 1 agent, so it stays a blocker for the orchestrator. Without it, the full-stack gate is green for this slice: 43 of 44 pass, and the one failure lies outside the web flow and Android.

## Orchestrator: the FlowRenderer retry-focus test failed on GitHub

CI run 39618501506 (the push of `8350c31`) failed the `node` job on one test, `flow-renderer.test.tsx` "keeps focus on Try again while a failed load is retried, then moves it to the next heading (2E follow-up)": after the failed retry, focus was still on Try again instead of the new error screen's heading. It passed locally and on every earlier run.

**Cause.** `useScreenFocus` moved focus to the new screen's heading in a passive `useEffect`. A failed load answers outside any event, so React runs that effect in a later task, and the test can see the new screen before it runs. A user meets the same gap: for a moment after the screen changes, focus is not on its heading. It is the class of race fixed in the dashboard's note editor (`docs/tdd/phase2-review-2e-fixes.tdd.md`, "the note editor focus test failed on GitHub").

**Fix.** `useScreenFocus` uses `useLayoutEffect`, so focus moves in the commit that shows the new screen. Both users of the hook (`FlowRenderer`, `OneTimeLinkFlow`) get it.

### RED

`ee78c2e`: `use-screen-focus.test.tsx` (new). A mutation observer records where focus is when the new heading appears after a macrotask; it runs right after the commit, before passive effects, so the result does not depend on timing:

```
$ (cd apps/flow && pnpm exec vitest run src/flow/use-screen-focus.test.tsx --coverage.enabled=false)   # three times
     × has focus on the new heading when it appears, never on the page (WCAG 2.4.3) 189ms
AssertionError: expected false to be true // Object.is equality
      Tests  1 failed | 1 passed (2)
```

Typecheck, lint and prettier pass on the RED commit.

### GREEN

```
$ (cd apps/flow && pnpm exec vitest run src/flow/use-screen-focus.test.tsx src/flow/flow-renderer.test.tsx src/flow/one-time-link-flow.test.tsx --coverage.enabled=false)   # three times
      Tests  43 passed (43)
$ pnpm --filter @openverify/flow test
 Test Files  42 passed (42)
      Tests  542 passed (542)
All files          |   98.81 |    95.63 |   99.27 |   98.87 |
```
