# TDD evidence: Phase 1, flow-web

Slice owner: flow-web agent (Workflow 1A, Stage 2). Date: 2026-10-20.

Owned paths: `apps/flow/**` and this file.

## Plan task

From `docs/plans/phase-1.plan.md`, Stage 2 "flow-web", built on `@openverify/contracts` (C1 to C3, C7, C8) and `@openverify/flow-spec`:

- **Session bootstrap from the URL fragment.** `#inquiry-id=…&session-token=…` is validated with zod, kept in this tab's sessionStorage, then removed from the address bar with `history.replaceState`. A missing or invalid link gets a friendly error.
- **Typed C3 client.** The base URL comes from `VITE_OPENVERIFY_API_URL`. It sends a bearer session token, parses every response with the contract schemas, and turns problem+json into typed errors.
- **Renderer driven by `GET /api/v1/flow/session`.** It renders these steps:
  - consent (`POST /flow/consent`);
  - government ID (sides, upload and/or camera, preview with retake, upload per kind, submit);
  - selfie (front camera with an oval guide; extra poses only when asked);
  - completion and failure;
  - an honest "not available here" screen for form, document, OTP, database and NFC steps.
- **Polling.** `GET /flow/verifications/:id` is polled. Retry hints (`user_behavior` reasons only) and the attempt count against `maxAttempts` are shown.
- **Security.** Production builds get a CSP `<meta>`, and `index.html` sets `Referrer-Policy: no-referrer`. No token is ever logged.
- **i18n and accessibility.** Every screen exists in en and es. The layout is accessible and mobile-first.
- **Tests.** Vitest + RTL cover every step component, the bootstrap and the client. Playwright e2e runs against a `page.route` mock with Chromium's fake camera. The Phase 0 smoke test still runs.

**Dependencies.** `apps/flow` gained:
- `zod` 4.6.7, already in the workspace (MIT, `npm view zod@4.6.7 license`);
- the workspace packages `@openverify/contracts` and `@openverify/flow-spec`;
- `@openverify/core` as a dev dependency, used by the locale tests.

No new third-party package. `pnpm-workspace.yaml` was not changed.

## Decisions taken while planning

**Routing and bootstrap**
- **One route for the flow.** The step on screen comes from the server, not from the URL. `/` renders `FlowRenderer`, and unknown paths render the not-found page. ADR 0003 described step URLs (`/consent`, `/camera`); a reload or the back button now always lands on the real step. The ADR update is a follow-up, because `docs/adr` is not owned here.
- **Bootstrap runs first in `main.tsx`.** It runs before i18n and React, and clears the fragment whether or not the credentials are valid. A broken link also forgets an older stored session, so the tab never silently resumes the wrong inquiry. The session must belong to the link's inquiry; otherwise the user sees a "mismatch" error.

**Walking the flow**
- **Position resolution is a pure function** (`resolveFlowPosition`). It follows the flow-spec execution model, with transitions evaluated by a small JSONLogic subset (`var`, `==`, `!=`, `===`, `!==`, `!`, `!!`, `and`, `or`, `in`).
  - An operator outside that subset stops the flow with an "unsupported" screen; it is never guessed as true or false.
  - A transition loop also stops the flow.
  - Rules read only own properties and array indices.
- **Terminal inquiry statuses take precedence over the walk:**
  - `completed`, `approved`, `declined` and `needs_review` show completion, so the decision is never revealed;
  - `failed` shows the flow's failure step;
  - `expired` shows the expired screen.

**Attempts and submission**
- **Attempts.**
  - Every verification of a step's type counts as one attempt (oldest first).
  - An `initiated` verification is reused, not re-created, so a reload does not use up an attempt.
  - A failed last attempt while the inquiry is still `pending` shows "finishing your verification" and polls the session until the worker fails the inquiry.
- **Submission is resumable.** It creates or reuses the verification, uploads each kind and submits. A failed request is retried from where it stopped. The multipart body puts `kind` before `file`, and the file name is `<kind>.<ext>`, never the user's own file name.

**Consent and messages**
- **Consent is recorded by text key.** The client refuses to collect consent for a `textKeys` entry it cannot show, rather than recording agreement to a text the user never saw. The `locale` sent is the language the texts were shown in.
- **Server-provided keys use `translateKey`.** This covers consent `textKeys`, `messageKey` and retry-hint reason codes. It reads the resource without interpolation and accepts only string leaves, in the current language or English. Unknown reason codes get a generic retry message.

**Security**
- **CSP.**
  - `securityMetaPlugin` prepends the `<meta>` in production builds only, because the Vite dev server injects inline scripts.
  - `connect-src` adds the origin of `VITE_OPENVERIFY_API_URL`, and an invalid URL fails the build.
  - One extra directive beyond the request: `form-action 'none'`.
  - The e2e happy path turned up a real violation: zod 4 probes `new Function` to decide whether to JIT object parsers, and Chromium logs the blocked probe. `src/security/csp-safe-zod.ts` sets `z.config({ jitless: true })` and is the first import in `main.tsx`, ahead of `@openverify/contracts`, which parses schemas when it loads.
- **Camera.** Selfies use the live camera only. The plan's sandbox-only upload fallback needs the environment mode, which C3 does not expose (follow-up). The preview is mirrored for the front camera; the captured JPEG is not. The guide dims the area outside the frame with a CSS shadow, so the page needs no inline styles.

**Testing infrastructure**
- **Testability.** `FlowEnvironmentProvider` injects the camera, frame capture and polling cadence. `FakeFlowApi` (unit) and `MockFlowApi` (e2e) both enforce consent before uploads and count attempts. Test PNGs are generated at test time with `node:zlib`: a plain card with a grey box, never a face.
- **E2E port.** The Playwright config picks a free port in the main process and passes it to workers through `OPENVERIFY_FLOW_E2E_PORT`, with `reuseExistingServer: false`. The previous fixed port 4173 could silently reuse another agent's server.

## Tests (written first)

**Cycle 1 (libraries, 9 files, 177 tests):**
- `session/session-bootstrap.test.ts`:
  - fragment with or without `#`;
  - `replaceState` keeps the path, query and history state;
  - the session is stored, resumed after a reload, and replaced by a new link;
  - missing link, and an unrelated fragment left alone;
  - eight malformed links, each rejected *and* cleared;
  - stored sessions that are not JSON, the wrong shape, or have extra members, all discarded;
  - storage that is null or throws.
- `api/api-base-url.test.ts`: same-origin, normalisation and path prefix; rejection of relative URLs, other schemes, `javascript:`, a query, a fragment and credentials.
- `api/flow-api-client.test.ts`:
  - bearer token, `accept`, `credentials: omit`, `cache: no-store`, `referrerPolicy: no-referrer`;
  - no token in the URL, an error message, `JSON.stringify(error)` or the stack;
  - every C3 call: method, path, body;
  - multipart order `kind`, `file`; no client file name; no hand-set `content-type`;
  - malformed verification IDs rejected before any request;
  - problem+json, non-problem bodies, invalid JSON, contract violations, retry hints naming a fraud check, network errors and aborts.
- `flow/json-logic.test.ts`: truthiness, `var` (paths, indices, defaults, no inherited properties), comparisons, short-circuit `and`/`or`, `in`, and unsupported operators.
- `flow/flow-position.test.ts`:
  - consent;
  - first attempt, reuse of an `initiated` verification, processing for `submitted`/`confirmed`;
  - retry with hints, `requires_retry`, `canceled`, attempts counted per type, `finalizing` after the last failure;
  - `passed`/`skipped` move on;
  - completion and terminal inquiry statuses;
  - transitions: conditional, unconditional, fall-through, unsupported operator, loop;
  - each of the six unsupported step types.
- `flow/submit-verification.test.ts`: order of the calls, reuse, resuming after a failed upload, abort signal.
- `lib/image-file.test.ts`: magic bytes (not the declared type), empty, exactly 10 MiB, unreadable.
- `lib/capture-frame.test.ts`: full-frame draw, JPEG at 0.92, no frame, no context, encode failure, real canvas.
- `security/security-meta.test.ts`: the exact directives, the API origin, no `unsafe-*`, build-only, head-prepend, an invalid URL fails.

**Cycle 2 (components, renderer, app, e2e):**
- **Units:**
  - `i18n/translate-key.test.ts`;
  - `api/error-message.test.ts`;
  - `flow/flow-environment.test.tsx`;
  - `flow/use-polling.test.tsx`: immediate first poll, interval with fake timers, timeout and restart, consecutive errors, latest callback, abort on unmount.
- **Components:** `retry-hints`, `photo-preview` (object URLs revoked), `camera-capture`, `capture-sequence`, `link-error`, `api-error`, and `consent-screen`, whose Phase 0 tests are kept and texts, busy and error states added. The camera tests cover:
  - constraints;
  - the starting status;
  - Capture enabled only after the first frame;
  - capture failure;
  - the guides and mirroring;
  - all seven camera errors;
  - retry and cancel;
  - the stream stopped on unmount and when it is granted late.
- **Steps:** `consent-step`, `verification-capture-step` (ID and selfie), `processing-step`, `finalizing-step`, `outcome-screens` and `unsupported-step`.
- **`flow/flow-renderer.test.tsx`, end to end on `FakeFlowApi`:**
  - consent → ID → selfie → completion, with focus moved to each new heading;
  - retry hints with "Attempt 2 of 3";
  - failure after the last attempt;
  - finalizing until the inquiry fails;
  - resuming a submitted attempt;
  - an unsupported step, never skipped;
  - expired;
  - mismatch;
  - load error with retry;
  - reload error after consent.
- **`app.test.tsx`** (routes rewritten): flow at `/`, missing and invalid links, not-found, banner, language switch, and `App` calling the API with the link's token.
- **`i18n/create-i18n.test.ts`** gained checks for:
  - the default template's server keys;
  - a retry message for every `user_behavior` Phase 1 reason;
  - every file error;
  - every unsupported step type.
- **E2E (`e2e/flow.spec.ts`)**, on the production build, with `VITE_OPENVERIFY_API_URL=http://api.openverify.test` mocked by `page.route` and Chromium started with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`:
  1. The happy path: consent; ID upload of two generated PNGs; selfie from the fake camera; completion. It asserts:
     - the fragment is cleared and the token is in sessionStorage;
     - the consent keys and locale sent;
     - the upload kinds, sniffed types and file names;
     - multipart order;
     - a bearer token on every request, with no token in URLs, no `Referer` and no cookies;
     - no console errors or CSP violations.
  2. Retry hints and attempt counting.
  3. Unsupported step.
  4. Reload resume.
  5. Missing link, with no API call.
  6. Malformed link cleared.
  7. CSP and referrer metas.
  8. Spanish via `?lang=es`.
- **`e2e/consent.spec.ts`:** the Phase 0 smoke test, adapted (see deviations).

## RED and GREEN

All commands ran from `apps/flow` after `source scripts/env.sh`.

### Cycle 1: libraries (commits `bf2f44f` RED, `5e17a98` GREEN)

RED, against stubs that throw `Not implemented`:
```
$ pnpm exec vitest run src/session src/api src/build src/flow src/lib/image-file.test.ts src/lib/capture-frame.test.ts --coverage.enabled=false
 FAIL  src/session/session-bootstrap.test.ts > bootstrapSession > reads valid credentials from the fragment
Error: Not implemented
 ❯ bootstrapSession src/session/session-bootstrap.ts:39:9
 Test Files  9 failed (9)
      Tests  176 failed | 1 passed (177)
```
The one pass is the `IMAGE_INPUT_ACCEPT` constant, which was declared with the stub. Typecheck was clean before the commit. `src/build/` is git-ignored, so the module moved to `src/security/` before committing.

GREEN, the full package with coverage:
```
$ pnpm test
 Test Files  16 passed (16)
      Tests  252 passed (252)
All files          |   99.19 |    97.69 |     100 |   99.17 |
```
On the way to GREEN, one test double had to be fixed: jsdom's `DOMException` is not an `Error`, so the fake fetch now resolves only `Response` values. Lint findings were fixed: `no-base-to-string`, `unbound-method`, `prefer-nullish-coalescing` and an unnecessary assertion.

### Cycle 2: components, renderer, app and e2e (commits `002f770` RED, `bda8245` RED, `2443f17` GREEN)

RED, unit tests against components that render `null`:
```
$ pnpm exec vitest run --coverage.enabled=false
 FAIL  src/flow/flow-renderer.test.tsx > FlowRenderer > runs the default flow from consent to completion
TestingLibraryElementError: Unable to find role="heading" and name "Consent to use your biometric data"
 FAIL  src/components/camera-capture.test.tsx > CameraCapture > asks for the requested camera, without audio
TestingLibraryElementError: Unable to find a label with the text of: Camera preview
 Test Files  20 failed | 13 passed (33)
      Tests  144 failed | 261 passed (405)
```

RED, e2e:
```
$ pnpm e2e
  ✘  8 [chromium] › e2e/flow.spec.ts:183:1 › serves a Content-Security-Policy that allows only the API origin (30.0s)
  ...
  9 failed
```

First GREEN run: unit tests 403 of 405 passing. Two tests had defects of their own:
- user-event honours `accept`, so the PDF test now uses a non-image disguised as `image/png`, which is the case magic-byte sniffing exists for;
- a `form` step needs at least one field to be a valid flow.

Lint then required the following changes:
- the camera now resets its state in the retry handler, not in the effect;
- the preview sets its `blob:` URL on the `<img>` in a layout effect, which also survives StrictMode's double effects;
- the abort check in the poll loop is a function, so TypeScript does not narrow `signal.aborted` across awaits.

The first e2e run found a real defect:
```
  ✘  2 [chromium] › e2e/flow.spec.ts:61:1 › completes the default flow: consent, ID upload, selfie from the fake camera
    - Array []
    + Array [
    +   " Note that 'script-src' was not explicitly set, so 'default-src' is used as a fallback.",
    + ]
  1 failed
  8 passed (6.0s)
```
zod 4.6.7's `allowsEval` probe (`new Function("")`) is blocked by the CSP. zod skips the probe under `jitless`. A unit test was written against an empty stub:
```
$ pnpm exec vitest run src/security/csp-safe-zod.test.ts --coverage.enabled=false
 FAIL  src/security/csp-safe-zod.test.ts > csp-safe-zod > turns off zod’s JIT, so it never probes eval under the CSP
AssertionError: expected undefined to be true // Object.is equality
      Tests  1 failed | 1 passed (2)
```
The test was committed with the stub (`bda8245`), then implemented.

GREEN:
```
$ pnpm test
 Test Files  34 passed (34)
      Tests  407 passed (407)
All files          |   98.45 |    94.98 |   99.05 |   98.54 |
$ pnpm e2e
  9 passed (4.9s)
$ pnpm exec playwright test --config e2e/playwright.config.ts --repeat-each=4
  36 passed (13.1s)
```

### Refactor (commit `f068edf`)

`WaitingStatus` (spinner plus live region) is now shared by the processing and finalizing screens. `FlowRenderer` reloads and polls through one `load` function. 407 unit tests and 9 e2e specs pass, unchanged.

### Accessibility fix (commits `ce7e411` RED, `da79f49` GREEN)

The visually hidden file input was still in the accessibility tree, next to the "Upload a photo" button.
```
 FAIL  src/components/capture-sequence.test.tsx > CaptureSequence > keeps the file picker out of the accessibility tree, behind the upload button
Error: expect(element).not.toBeVisible()
      Tests  1 failed | 12 passed (13)
```
The input is now `hidden` and opened by the button. After the fix, 408 unit tests and 9 e2e specs pass.

## Final verification (shared tree, 2026-10-20)

```
$ pnpm typecheck      # tsc --noEmit && tsc --noEmit -p e2e   → exit 0
$ pnpm lint           # eslint .                               → exit 0
$ pnpm test
 Test Files  34 passed (34)
      Tests  408 passed (408)
All files          |   98.45 |    94.98 |   99.06 |   98.54 |
$ pnpm e2e
  9 passed (6.4s)
$ pnpm exec prettier --check apps/flow    # from the repo root
All matched files use Prettier code style!
$ VITE_OPENVERIFY_API_URL=https://api.example.com pnpm exec vite build
dist/assets/index-*.css   15.76 kB │ gzip:   4.21 kB
dist/assets/index-*.js   478.38 kB │ gzip: 148.13 kB
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://api.example.com; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'">
```

## Deviations

- **The Phase 0 smoke test (`e2e/consent.spec.ts`) was adapted.** A visit without a link must now show the missing-link error, so the test as written could not keep passing.
  - It now opens a flow link against the mocked session.
  - It keeps every Phase 0 assertion: the `lang` and `dir` attributes, the consent heading, and Continue disabled until consent.
  - It expects the government ID step after consent, instead of `/camera`.
- **Routes.** `/consent` and `/camera` are gone (see "Decisions"). `CameraCheck` is no longer routed but was kept, because this agent did not create it.
- **CSP and Permissions-Policy.** The CSP `<meta>` is added only in production builds. Permissions-Policy cannot be set by `<meta>`, so it is a serving-layer header (see the follow-ups).
- **No selfie upload fallback, even in sandbox mode.** C3 does not tell the client which environment it runs in.
- **Consent `required: false` is treated like `required: true`.** C3 has no way to skip consent before uploads (409).

## Not done here (see the report's follow-ups)

- **Response headers for the serving layer:**
  - `Content-Security-Policy` with `frame-ancestors`;
  - `Permissions-Policy: camera=(self)`, plus embedding origins later;
  - `Referrer-Policy: no-referrer`;
  - `X-Content-Type-Options: nosniff`.
- **API agreements:**
  - accept a re-upload of the same kind to an `initiated` verification, last one wins;
  - count attempts the way the client does;
  - CORS for the flow origin, with `authorization` and `content-type` allowed.
- **Updates in paths owned by other agents:** ADR 0003, `docs/PROGRESS.md`, `THIRD_PARTY_LICENSES.md` (no new third-party package) and `.env.example` (`VITE_OPENVERIFY_API_URL`).
