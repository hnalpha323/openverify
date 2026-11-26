# TDD evidence: Phase 2, clients (Workflow 2C, Stage 1)

Slice owner: `clients` agent (Workflow 2C, Stage 1, in parallel with `dashboard-shell`). Date: 2026-10-20.

Owned paths:
- `apps/flow/**`, including the mocked Playwright specs;
- `android/**`;
- `e2e/tests/ui-flow-links.spec.ts` and `e2e/tests/support/flow-links.ts`;
- this file.

## Plan task

From `docs/plans/phase-2.plan.md`, "Workflow 2C (clients)", agent `clients`:

- **C19 in the web flow:**
  - a sandbox banner, and the selfie upload fallback in sandbox (`GET /flow/session` `environment.kind`);
  - one-time links: redeem `#one-time-token`, keep the session token in memory only, clear the fragment at once, and explain a used link;
  - a dedicated screen without a retry on 401 `session_expired` or `session_canceled`;
  - relying on "last write wins on an initiated verification" after a reload.
- **Web flow, 1B F018:** every flow fetch gets a timeout that surfaces as the existing recoverable error state. Also, 410 `redacted` (Workflow 2B F018) is a final screen.
- **C19 on Android:**
  - `OpenVerifyInquiry.fromOneTimeLink(url)`, with the session-token launcher unchanged;
  - an inactive-session screen, the sandbox banner and the sandbox upload fallback;
  - 410 as a final state;
  - Kotlin decoding of `contracts/fixtures/api/inquiry-session.json`.
- **Android, 1B F025:** any `takePicture` failure is a recoverable capture error.
- **Android, 1B F026:** the demo app keeps the session across rotation, without persisting the token.
- **C24 spec 10:** the same behaviour in the browser, full stack.

No new third-party dependency in `apps/flow` or `e2e`. The demo app declares four kinds of dependency it already had transitively or in the catalog:
- `lifecycle-viewmodel-compose` and `lifecycle-runtime-compose` 2.9.4 (Apache-2.0);
- Robolectric 4.17 (MIT);
- AndroidX Test core 1.7.0 and Compose ui-test (Apache-2.0);
- the JUnit Vintage engine (EPL-2.0, test scope only, as in the SDK).

`pnpm-lock.yaml` and `pnpm-workspace.yaml` are unchanged.

## Decisions

**Web flow**

- **One-time links (C19).**
  - `bootstrapSession` reads `#inquiry-id=…&one-time-token=ovo_…` with the contracts' `parseFlowLinkFragment`. It clears the fragment with `replaceState` before anything else runs, and drops any session stored in the tab (the newest link wins).
  - A fragment with both a session token and a one-time token is ambiguous and is refused as invalid.
  - `OneTimeLinkFlow` calls `POST /flow/one-time-links/redeem`, which carries no `Authorization`. It keeps the session token only inside the client it builds, in React state; nothing goes to sessionStorage or a URL.
  - A redeem uses the link up, so it is sent once per attempt: a ref survives React StrictMode's second effect run, and a request in flight is never aborted. The App test runs inside `<StrictMode>` and counts one redeem.
  - A refused redeem (the one generic 401) shows `LinkError reason="used"`, with no button. A network error, timeout or 429 shows the usual recoverable error, and its retry redeems again.
  - **A reload after a one-time link.** The session lived in memory only, so a reload cannot resume it. A marker without secrets (`openverify.flow.one-time-link = "1"` in sessionStorage) makes the reload show `reason="reloaded"` ("This page was opened from a one-time link…") instead of "the link is missing". A later session link in the tab clears the marker.
- **Final outcomes.**
  - `finalOutcomeOf` treats 401 `code: session_expired` / `session_canceled` (C10), and any 410 (C9 `redacted`), as final.
  - `withFinalOutcomes` wraps the client in `FlowRenderer`, so every screen's calls report them: consent, uploads, submit, polling and reloads. The renderer then replaces the flow with `SessionEndedScreen`, which has no button, and moves focus to its heading. The first outcome wins.
  - A 401 without one of those codes (an unknown token) keeps its Phase 1 recoverable error.
- **Sandbox (C19).**
  - `FlowRenderer` remembers `environment.kind` from every session it loads. A sandbox shows `SandboxBanner`, a named `role="note"` (not a live region), above every screen, final screens included.
  - In a sandbox, selfies offer "Upload a photo" next to "Take a photo" (the camera stays primary), with a labelled file input per pose.
  - Production, and Phase 1 servers that do not send `environment`, keep the live camera only.
- **Timeouts (1B F018).**
  - `flow-transport.ts` now carries the request logic of both clients. Each request has its own `AbortController`, which follows the caller's signal and aborts itself at the deadline: 30 s for requests, 120 s for uploads (up to 10 MiB on mobile networks). Both deadlines can be configured.
  - The deadline also covers a body that stops arriving: every read races the abort, whatever `fetch` does with the signal.
  - A deadline gives `FlowApiError` kind `timeout`, shown as `errors.timeout` in the existing recoverable error state.
  - The caller's own abort stays `aborted`.
  - The timer is cleared as soon as the answer has arrived.
- **Re-upload after a reload.** No change was needed. The flow already reuses an `initiated` verification and uploads every kind again (covered by "fills the verification already started…" and the full-stack `reload-between-uploads` spec, which passes).

**Android**

- **`OpenVerifyInquiry.fromOneTimeLink(url, apiBaseUrl = null)`.**
  - It reads the fragment (exactly one `inquiry-id` and one `one-time-token`, and no `session-token`) and returns an `OneTimeLink`. That is a class, not a data class: `toString` hides the token, and the token is `internal`.
  - Without `apiBaseUrl`, the API is taken to be the link's origin, as the web flow's same-origin default assumes.
  - It is launched with the new `OneTimeLinkContract`. `Contract` and `Request` are unchanged.
  - The intent carries the one-time token, never a session token. `InquiryResults.launchFrom` refuses an intent that carries both.
- **Redeem in memory.**
  - `OneTimeLinkClient` redeems without credentials and maps the redeem's 401 to the new `FlowApiException.LinkRefused`.
  - `OneTimeLinkFlowApi` redeems on the first call, once even when calls race (a `Mutex`), then delegates to a `FlowApiClient` for the session token. It lives in the `InquiryViewModel`, so it survives a rotation (a Robolectric test recreates the activity and counts exactly two requests).
  - The token is never written to an intent, saved state or disk. After process death the redeem is refused, and the user sees the used-link screen.
  - The shared OkHttp plumbing moved from `FlowApiClient` into an internal `FlowHttp`, and the public API is unchanged.
- **New final states.**
  - `FlowState.SessionEnded(EXPIRED | CANCELED)`, `Redacted` (new `FlowApiException.Redacted`, 410) and `LinkRefused`. Each has its own screen with Close only.
  - They finish as `FailureReason.SESSION_EXPIRED`, `SESSION_CANCELED`, `INQUIRY_REDACTED` and `LINK_INVALID`; the last three are new enum entries.
  - `Problem` gains `code`.
- **Sandbox.**
  - `FlowSession.environment` (`EnvironmentKind`, with `UNKNOWN` for kinds added later). The coordinator exposes `sandbox`, and the activity shows `SandboxBanner` above every screen.
  - `FlowState.Capture.uploadAllowed` is true only in a sandbox: for selfies, and for ID steps whose `captureMethods` include `upload`. Production Android stays camera-only, as in Phase 1.
  - The picker is the system photo picker (`PickVisualMedia`, no storage permission) behind a `PhotoPicker` interface, so tests use a fake.
  - `PickedPhotos` reads at most 25 MiB, decodes the file and re-encodes it as a JPEG through `ImageEncoding`, so its metadata (such as a location) never leaves the device. EXIF orientation is not applied: this is a sandbox testing aid.
- **1B F025.**
  - `CaptureCamera.takePictureOrNull()` turns any exception, and an `OutOfMemoryError` while a frame is converted, into `null`; `CancellationException` still propagates.
  - `CaptureScreen` uses it, so every failure shows "We could not take the photo" and the shutter stays enabled.
- **1B F026.**
  - `DemoViewModel` holds the form. The inquiry ID and API URL go to `SavedStateHandle`; the session token, the one-time link and the last result live in memory only.
  - The demo also gains a one-time link field and launcher.
- **Inquiry session decoding (C20).**
  - `InquirySessionDocument`, `InquirySessionAttributes` and `InquirySessionStatus`. `toString` hides the client address and user agent (PII).
  - `api/inquiry-session.json` moved from `serverOnly` to the decoded fixtures, and a test reads it.

**Full stack (C24 spec 10)**

- **`e2e/tests/ui-flow-links.spec.ts`:**
  1. A link generated with `@openverify/node` is opened in Chromium. It redeems and leaves the address bar, and the sandbox banner shows. The user consents, uploads the synthetic ID, and uploads `fixtures/generated/selfie-a.jpg` through the sandbox fallback; the inquiry completes. Nothing matching `ovs_`/`ovo_` is in sessionStorage. The same link opened in a new tab shows the used-link screen, and no second session is created.
  2. A session expired through `inquirySessions.expireAll` ends the flow on the expired-session screen at the next write.
  3. A resume-link session expired the same way shows that screen after a reload (the read path).

## Cycle 1: web flow, unit tests

**RED** (commit `0cfd479`, `test(flow): …`). Files:
- `session-bootstrap.test.ts`, `flow-api-client.test.ts`;
- `one-time-link-client.test.ts`, `final-outcome.test.ts`, `error-message.test.ts`;
- `link-error.test.tsx`, `sandbox-banner.test.tsx`, `session-ended-screen.test.tsx`;
- `verification-capture-step.test.tsx`, `flow-renderer.test.tsx`, `one-time-link-flow.test.tsx`, `app.test.tsx`;
- the test doubles `FakeFlowApi` and `flowSession()`, which gain an optional `environment`.

```
$ cd apps/flow && pnpm exec vitest run src/session/session-bootstrap.test.ts src/api src/components/link-error.test.tsx \
    src/components/sandbox-banner.test.tsx src/steps/session-ended-screen.test.tsx src/steps/verification-capture-step.test.tsx \
    src/flow/flow-renderer.test.tsx src/flow/one-time-link-flow.test.tsx src/app.test.tsx --coverage.enabled=false --testTimeout=3000
 FAIL  src/api/final-outcome.test.ts         Error: Failed to resolve import "./final-outcome"
 FAIL  src/api/one-time-link-client.test.ts  Error: Failed to resolve import "./one-time-link-client"
 FAIL  src/components/sandbox-banner.test.tsx, src/flow/one-time-link-flow.test.tsx, src/steps/session-ended-screen.test.tsx (same)
     × reads the one-time link for the flow to redeem
       AssertionError: expected { status: 'error', reason: 'invalid' } to deeply equal { status: 'one-time-link', …(1) }
     × explains a reload after a one-time link instead of calling the link missing
     × rejects both a session token and a one-time token and still clears the fragment
     × redeems a one-time link once, then calls the API with the session token it got (C19)
       TypeError: Cannot destructure property 'inquiryId' of 'bootstrap.credentials' as it is undefined.
     × maps [FlowApiError: timed out] to errors.timeout   expected 'errors.unexpected' to be 'errors.timeout'
     × gives up on a request after 30 seconds by default, as a timeout error   expected undefined to be false
     × gives uploads longer: 120 seconds by default / takes its timeouts from the options   Test timed out
     × shows the expired-session screen, with no retry …   TypeError: Cannot read properties of undefined (reading 'expired')
     × falls back to an upload in sandbox, with the camera still first (C19)
       Unable to find an accessible element with the role "button" and name "Upload a photo"
     … (30 in all)
 Test Files  12 failed | 1 passed (13)
      Tests  30 failed | 136 passed (166)
```

Before GREEN, one RED test was corrected. The first version of "aborts the request when the caller's signal aborts" expected the request's signal to follow the caller's after the request had finished; the GREEN version checks it during the request. It replaced Phase 1's "passes the abort signal through", whose identity check cannot hold once each request has its own deadline signal (see contract deviations).

**GREEN** (commit `50eb961`, `feat(flow): …`). Production code:
- `flow-api-error.ts`, `flow-transport.ts`, `one-time-link-client.ts`, `final-outcome.ts`;
- `sandbox-banner.tsx`, `session-ended-screen.tsx`, `one-time-link-flow.tsx`;
- the changes to the bootstrap, `flow-api-client.ts`, `error-message.ts`, `link-error.tsx`, `verification-capture-step.tsx`, `flow-renderer.tsx`, `routes.tsx` and `app.tsx`;
- en and es messages.

One refinement test was added after GREEN: "also times out an error answer whose body never finishes". It covers the last uncovered line and passed at once.

```
$ (same files)
 Test Files  13 passed (13)
      Tests  202 passed (202)
$ pnpm --filter @openverify/flow test
 Test Files  39 passed (39)
      Tests  489 passed (489)
All files          |   98.73 |    95.61 |   99.23 |   98.81 |
```

## Cycle 2: web flow, mocked browser specs

The mocked API (`e2e/support/mock-flow-api.ts`) gains:
- the session's `environment`;
- the redeem route: each link works once, and every refusal is a generic 401 with no credentials accepted;
- `sessionStatus` (a 401 with `code`), `redacted` (410 on writes), and `hang` (requests never answered).

New specs, each driving the production bundle in Chromium:
- `one-time-link.spec.ts`: redeem and the in-memory session, the used link, the reload;
- `session-ended.spec.ts`: expired, canceled at the next write, and 410 on upload;
- `sandbox.spec.ts`: the banner and an uploaded selfie in sandbox; no banner and a live selfie in production;
- `timeouts.spec.ts`: a session request and a redeem that never answer, with `page.clock`.

**RED against the pre-implementation build.** The specs were run against a build of RED commit `0cfd479`: `git archive 0cfd479 apps/flow contracts packages/config tsconfig.base.json`, unpacked in the scratchpad with `node_modules` symlinked. The new specs were copied in.

```
$ ./node_modules/.bin/playwright test --config e2e/playwright.config.ts one-time-link sandbox session-ended timeouts
  1) one-time-link.spec.ts › redeems a one-time link once …   heading 'Consent to use your biometric data' not found
  4) sandbox.spec.ts › a sandbox session shows its banner …     getByRole('note', { name: 'Sandbox' }) not found
  5) session-ended.spec.ts › an expired session shows …          heading 'Your verification session has expired' not found
  8) timeouts.spec.ts › a session request that never answers …   heading 'Something went wrong' not found
  9 failed
  1 passed (16.3s)      # the production spec: unchanged Phase 1 behaviour
```

**RED against the working tree.** The first run of the whole mocked suite against the GREEN code failed the three one-time link specs and the redeem timeout spec. The page showed "This verification link is not valid":

```
$ pnpm --filter @openverify/flow e2e
  4 failed  (one-time-link.spec.ts ×3, timeouts.spec.ts › a one-time link redeem …)
  15 passed
```

The cause was a real bug the unit tests could not see: `bootstrapSession` called `replaceState` and only then read `location.hash`. In a browser `window.location` is live, so the hash was already empty. A unit test with a live location was added, and it fails:

```
$ pnpm exec vitest run src/session/session-bootstrap.test.ts --coverage.enabled=false
     × reads the link before clearing it from a live address bar
AssertionError: expected { status: 'error', reason: 'invalid' } to deeply equal { status: 'one-time-link', …(1) }
      Tests  1 failed | 37 passed (38)
```

Commit `a0b0c09` (`test(flow): …`) holds the specs, the mocked-API changes and this test.

**GREEN** (commit `f2e5ee7`, `fix(flow): read the one-time link before replaceState …`). The hash is read once, before `replaceState`.

```
$ pnpm exec vitest run src/session/session-bootstrap.test.ts --coverage.enabled=false
      Tests  38 passed (38)
$ pnpm --filter @openverify/flow e2e
  19 passed (6.5s)      # 9 Phase 1 specs + 10 new
```

## Cycle 3: Android

**RED** (commit `c34175d`, `test(android): …`). Kotlin compilation of the unit tests fails on the missing API, with 249 errors across 20 test files:

```
$ (cd android && ./gradlew testDebugUnitTest --continue)
> Task :demo-app:compileDebugUnitTestKotlin FAILED
> Task :openverify-sdk:compileDebugUnitTestKotlin FAILED
e: …/InquiryResultsTest.kt:61:36 Unresolved reference 'SessionEnded'.
e: …/OpenVerifyInquiryContractTest.kt:49:40 Unresolved reference 'OneTimeLinkContract'.
e: …/OpenVerifyInquiryActivityTest.kt:168:52 Unresolved reference 'openverify_link_refused_title'.
e: …/InquiryViewModelTest.kt:98:36 Unresolved reference 'sandbox' on receiver of type 'InquiryViewModel'.
e: …/demo/DemoViewModelTest.kt:22:72 Unresolved reference 'DemoViewModel'.
e: …/demo/MainActivityTest.kt:42:50 Unresolved reference 'field_one_time_link'.
BUILD FAILED in 34s
```

**GREEN** (commit `2014b8e`, `feat(android): …`). The first run found one wrong test, not wrong code. "The first call redeems the link…" called `getVerification` on a submitted verification without a scripted decision, and `FakeFlowApi` refuses that with `IllegalStateException`. The test now scripts the decision.

```
$ ./gradlew :openverify-sdk:testDebugUnitTest :openverify-sdk:koverVerify :openverify-sdk:koverLog
OneTimeLinkFlowApiTest > the first call redeems the link, then calls go to a client for the session() FAILED
    java.lang.IllegalStateException at OneTimeLinkFlowApiTest.kt:36
422 tests completed, 1 failed
(after scripting the decision)
application line coverage: 97.082%
BUILD SUCCESSFUL in 39s
```

**F026 RED on the old screen.** The rotation test was run against the Phase 1 `MainActivity.kt`, taken from the RED commit with the new strings in place, and the new file was then restored:

```
$ ./gradlew :demo-app:testDebugUnitTest --tests 'dev.openverify.demo.MainActivityTest'
MainActivityTest > a pasted session survives a rotation FAILED
    java.lang.AssertionError at MainActivityTest.kt:35      # Start verification is disabled after recreate()
MainActivityTest > a pasted one-time link survives a rotation FAILED
2 tests completed, 2 failed
```

**Full validation:**

```
$ (cd android && ./gradlew testDebugUnitTest koverVerify koverLog assembleDebug lint --continue)
application line coverage: 97.082%
BUILD SUCCESSFUL in 1m 11s
openverify-sdk: 422 tests, 0 failed, 0 skipped; demo-app: 18 tests, 0 failed, 0 skipped
lint: openverify-sdk 0 errors, 10 warnings; demo-app 0 errors, 2 warnings; openverify-nfc 0 errors, 1 warning
```

All lint warnings are the pre-existing, deliberate version pins (compileSdk 36, Compose BOM, lifecycle 2.9.4, and so on). No instrumented test was added, and `infra/scripts/check-connected-results.sh` and the CI job are unchanged.

## Cycle 4: C24 spec 10, full stack

Spec 10 was written after the flow implementation. Its browser behaviour already had RED evidence from cycles 1 and 2, so it serves as the integration acceptance test. It ran under the e2e lock together with the Phase 1 browser specs.

pnpm forwarded the `--`, so Playwright ignored the file filter and ran the whole suite. That covers every Phase 2 API spec as well.

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && \
    pnpm --filter @openverify/e2e e2e -- tests/ui-flow-links.spec.ts tests/verification-completes.spec.ts \
    tests/verification-fails.spec.ts tests/reload-between-uploads.spec.ts'
  ✓  12 tests/ui-flow-links.spec.ts › a one-time link opens the flow once, in the sandbox, and the user finishes it (6.1s)
  ✓  13 tests/ui-flow-links.spec.ts › a session expired through the server API ends the flow on its own screen (665ms)
  ✓  14 tests/ui-flow-links.spec.ts › a session link reloaded after its session expired shows the inactive-session screen (586ms)
  ✓  17 tests/reload-between-uploads.spec.ts › a reload between the two ID uploads does not strand the user (6.2s)
  ✓  18 tests/verification-completes.spec.ts › an inquiry on the default template completes with every check passed (7.1s)
  ✓  19 tests/verification-fails.spec.ts › a selfie of a different person fails the face match and the inquiry (5.9s)
  19 passed (1.2m)
```

Commit: `96671d0` (`test(e2e): …`).

The specs were run again after `dashboard-shell` moved the e2e dashboard onto its custom server (`f5ff509`). This time the files were passed without `--`, so only these four ran:

```
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && \
    pnpm --filter @openverify/e2e e2e tests/ui-flow-links.spec.ts tests/verification-completes.spec.ts \
    tests/verification-fails.spec.ts tests/reload-between-uploads.spec.ts'
  ✓  1 tests/reload-between-uploads.spec.ts › a reload between the two ID uploads does not strand the user (6.4s)
  ✓  2 tests/ui-flow-links.spec.ts › a one-time link opens the flow once, in the sandbox, and the user finishes it (5.9s)
  ✓  3 tests/ui-flow-links.spec.ts › a session expired through the server API ends the flow on its own screen (622ms)
  ✓  4 tests/ui-flow-links.spec.ts › a session link reloaded after its session expired shows the inactive-session screen (524ms)
  ✓  5 tests/verification-completes.spec.ts › an inquiry on the default template completes with every check passed (7.6s)
  ✓  6 tests/verification-fails.spec.ts › a selfie of a different person fails the face match and the inquiry (5.9s)
  6 passed (57.4s)
```

A run in between failed in the global setup's `next build`, before any spec ran. At that point the dashboard had an uncommitted RED test of `dashboard-shell` (`src/next-config.test.ts`); it built again once that agent committed its GREEN.

## Refactor

Commit `584deba` (`refactor(clients): …`):
- the flow's two identical loading cards became `components/loading-card.tsx`;
- the Kotlin coordinator notes the `when` branches that always end earlier.

The suites stayed green: flow 490 tests at 98.8% of lines, and `FlowCoordinatorTest`.

## Other checks

```
$ pnpm --filter @openverify/flow typecheck   # tsc --noEmit && tsc --noEmit -p e2e: clean
$ pnpm --filter @openverify/flow lint        # clean
$ pnpm exec prettier --check apps/flow e2e/tests/ui-flow-links.spec.ts e2e/tests/support/flow-links.ts
All matched files use Prettier code style!
$ (cd e2e && pnpm exec tsc --noEmit && pnpm exec eslint tests/ui-flow-links.spec.ts tests/support/flow-links.ts)   # clean
```

gitleaks ran on every commit through the pre-commit hook and found no leaks. All tokens in tests are synthetic: a prefix followed by a repeated character or a padded label.
