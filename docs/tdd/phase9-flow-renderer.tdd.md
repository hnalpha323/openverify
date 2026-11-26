# Phase 9, Workflow 9A Stage 3: flow-renderer (the web flow on the server's position)

Evidence for `flow-renderer`'s deliverables (the plan's bullet, family F): the `screen` step with C148's
catalogue and the step registry the preview renders (checkpoint `screens`), then the web flow on the
server's position (C151.5), the waiting, halted and ended states, the completion's announcement and
"Continue" redirect (C158.5), the consent digests (C162.9), the session's copy and languages (C161.2,
C162.5), the `style-variant` parameter (C160.9), the capture methods by device (C153.2), the 2.2.1
selfie-capture warning and extension (C171.4), the `OpenVerify-Flow-Spec` header (C151.7), and the
mocked suite. Every command below was run after `source scripts/env.sh`; outputs are abbreviated and
exit codes are read from the command.

Started after `foundation-9a`'s `CHECKPOINT (F) DONE at 4a619111` (and (H), (A11Y)), `flow-spec-logic`'s
report and `flow-i18n`'s `CHECKPOINT catalogs DONE at 0e26fd16` and `CHECKPOINT all DONE at 59fdf509`.

## Checkpoint `screens`

### Placeholders

`chore(flow)`: `src/screens/screen-model.ts` (the screen's state, visibility, checks and submission,
each throwing `ScreenModelNotBuiltError`), `src/screens/screen-step.tsx` (`ScreenStep`, rendering
nothing), `src/screens/step-registry.tsx` (`PREVIEW_PLACEHOLDER_TYPES`, `PREVIEWABLE_TYPES`,
`isPreviewable`, `StaticStep`), and the built-in labels in `src/screens/locales/{en,es,fr,de,ar}.ts`
under the catalogs' new `screen` key (borrowed edits of `flow-i18n`'s five catalogs, one import and one
member each, marked machine-drafted, C161.5), with `contracts/fixtures/i18n/*.json` re-exported by
`node apps/flow/scripts/export-flow-locales.ts` (the consent texts and the catalog version are
unchanged).

### RED

`test(flow)`: `src/screens/screen-model.test.ts` (the bound fields of containers and an address; the
state on arrival with a value the session holds and one it never sends back; visibility through the
strict evaluator, a rule outside the subset refused, a hidden container's children hidden; required,
lengths, the pattern on the shared matcher and number bounds; the submission of visible fields only,
digits normalised, numbers as numbers, a held value left out), `src/screens/screen-step.test.tsx`
(operator text as plain text with the first title as `h1`; labels and hints from copy keys; values
shown and "already provided"; show and hide on change; the error summary linked to each field; the
pressed button's key; Arabic-Indic digits normalised as typed; an out-of-subset rule shown as
unavailable; the cancel confirmation) and `src/screens/step-registry.test.tsx` (every client step type
either previewable or a placeholder; a screen, a consent, a completion and a failure rendered with the
live components).

```
$ pnpm --filter @openverify/flow exec vitest run src/screens --coverage.enabled=false   # exit 1
 × lists form components inside containers and an address by its parts
   ScreenModelNotBuiltError: boundFields is not built yet (1 inputs)
 × renders operator text as plain text, the first title as the heading   (ScreenStep renders nothing)
 × renders a screen with the live components and sends what its submit gives
 ...
 Test Files  3 failed (3)
      Tests  27 failed | 1 passed (28)
```

### GREEN

`feat(flow)`: `screen-model.ts` (pure: `boundFields`, `initialScreenState`, `visibleComponentIds`
through `evaluateVisibility`, `screenErrors` with patterns through `compilePattern`/`matchPattern`,
`submissionValues`, `normalizeTyped` through `normalizeDigits`), `screen-components.tsx`
(`SCREEN_COMPONENTS`, one entry per `ComponentKind`, and `ScreenContext`), `screen-step.tsx`
(`ScreenStep`) and `step-registry.tsx` (`StaticStep`, `isPreviewable`).

```
$ pnpm --filter @openverify/flow exec vitest run src/screens --coverage.enabled=false   # exit 0
 Test Files  3 passed (3)
      Tests  28 passed (28)
$ pnpm exec eslint src/screens && pnpm exec tsc --noEmit   # exit 0, exit 0
```

### The catalogue (written after GREEN)

`src/screens/screen-catalogue.test.tsx`: `SCREEN_COMPONENTS` has an entry for every `COMPONENT_KINDS`
member; every kind renders with its label, `autocomplete` purpose and 24 px choice targets; every kind's
value lands in one submission (Arabic-Indic digits normalised in a number and a postal code); each kind's
own error is named at its field, and an address's required parts by their own labels in the summary.
It passed on its first run against the GREEN code (one assertion corrected to read the paragraph rather
than the text's inner span); a mutation that drops `normalizeTyped` from `change` turns it red.

```
$ pnpm --filter @openverify/flow exec vitest run src/screens --coverage.enabled=false   # exit 0
      Tests  32 passed (32)
```

### Gates (at 8f119571)

| Command | Result |
|---|---|
| `pnpm --filter @openverify/flow typecheck` | exit 0 |
| `pnpm --filter @openverify/flow lint` | exit 0 |
| `pnpm --filter @openverify/flow test` | exit 0: 97 files, 1,309 tests, 94.96% statements, 87.51% branches; 105 s, load 6.71 before and 14.15 after |

CHECKPOINT screens DONE at 8f11957197c147a7e5b2d778b4346649429a9827

Handoff (`screens`), for `flow-server-embed`'s preview rendering:
- **Step registry** (`apps/flow/src/screens/step-registry.tsx`): `PREVIEWABLE_TYPES` (`consent`, `screen`,
  `completion`, `failure`: rendered with no client by the live flow's own components),
  `PREVIEW_PLACEHOLDER_TYPES` (every other client step type: draw a still placeholder, C156.3),
  `isPreviewable(step: ClientStepView): step is PreviewableStep`, and
  `<StaticStep step values? copy onSubmit? onConsent? links? asset? />`. `copy(key)` answers a copy
  key's text or `null` (the preview builds it from the preview document's copy for its locale, falling
  back to the built-in catalogs); `onSubmit` defaults to sending nothing; `asset(assetId)` answers a
  `blob:` URL or `null` (the preview's sniffed `preview-assets`).
- **Screen step** (`screen-step.tsx`): `ScreenStep({ step: ScreenClientView, values?, onSubmit(submission:
  ScreenSubmission), onCancel?, copy, links?: ScreenLinks, asset?, refused?, error? })`;
  `ScreenSubmission { values, button? }` is `submitFlowScreenBodySchema`'s body.
- **Catalogue** (`screen-components.tsx`): `SCREEN_COMPONENTS` (one renderer per `ComponentKind`),
  `ScreenContext` / `ScreenContextValue`. **Model** (`screen-model.ts`): `boundFields`,
  `initialScreenState`, `visibleComponentIds` (throws `VisibilityRuleError` for a rule outside the
  strict subset; the screen then shows `screen.unavailable`), `screenErrors`, `submissionValues`,
  `normalizeTyped`.
- **Strings**: the built-in labels are under the catalogs' `screen` key (`src/screens/locales/`), in all
  five locales, machine-drafted.

## The flow API calls (C148.5, C151.7, C153.2, C171.4)

### Placeholders

`chore(flow)`: `FlowApiClient.submitScreen(stepId, body, signal?)` and
`extendSelfieCapture(captureId, signal?)`, each rejecting until built; `uploadFile` gains a sixth
argument, the client-reported `captureMethod` (`CaptureMethod`, C153.2); `withFinalOutcomes` passes
the new calls through its guard. `src/testing/flow-renderer.ts` registers `flow-renderer`'s fake
answers through `registerFakeFlowExtension` (a script of served positions and the extension calls) and
holds `positionedSession`, `at`, `serve`, `rendererScript` and `extendedCapture`. The hand-built mock
client of `src/flow/submit-verification.test.ts` gains the two methods (the interface grew).

### RED

`src/api/flow-api-client-phase9.test.ts`: every request declares `OpenVerify-Flow-Spec: 1, 2`; the screen
submission's path, body and answer; the extension's path and answer; the capture method sent between
`kind` and `file`, and none when the step says nothing.

```
$ pnpm --filter @openverify/flow exec vitest run src/api/flow-api-client-phase9.test.ts --coverage.enabled=false   # exit 1
 × declares spec 1 and 2 on every request
 × posts the values and the button key to the screen, and answers the session
 × posts to the capture and answers it with its new expiry
 × sends the client-reported capture method before the file
      Tests  4 failed | 3 passed (7)
```
The three that pass are the two refusals of a malformed id (the placeholders already reject with a
`TypeError` before any request) and the upload without a method, which is today's behaviour.

### GREEN

`flow-transport.ts` sends `OpenVerify-Flow-Spec: 1, 2` (`DECLARED_FLOW_SPECS`) on every request;
`submitScreen` posts `submitFlowScreenBodySchema`'s body to `/screens/:stepId/submit` (a step id
outside `stepIdSchema` rejects before any request) and parses the session; `extendSelfieCapture`
posts to `/selfie-captures/:id/extend` (`self_` ids only) and answers the capture;
`uploadFile` appends `capture-method` after the capture fields; `withFinalOutcomes` forwards
`uploadFile`'s arguments as given. Two fixes on the way, both in the new test file: the consent
answer is `{ consent }`, and a refusal is a rejected promise (the call is `async`).

```
$ pnpm --filter @openverify/flow exec vitest run src/api --coverage.enabled=false   # exit 0
 Test Files  6 passed (6)
      Tests  166 passed (166)
```

## The server's position (C151.5)

### RED

`src/flow/flow-position-server.test.ts`: the served screen with its values; the served step whatever the
projection's list order; a failed attempt with no hint still waits for the server (`finalizing`); a
served step already done here waits; `waiting` polls as the server says (`WAIT_POLL_MS` 2,000 by
default, C150.5); `halted`; `ended` shows the served completion or failure step, or the completion
screen; a decided inquiry prefers the served terminal step; a spec-1 answer falls back to the
projection's entry; a position on a step not given waits; a placeholder is unsupported.
`flow-position.test.ts`: its "transitions" block (which followed conditions on the client) is replaced
by "a session without a server position": no transition is evaluated or followed, and a flow without
transitions is walked in list order (the plan removes the client's transition evaluation, C151.5).

```
$ pnpm --filter @openverify/flow exec vitest run src/flow/flow-position --coverage.enabled=false   # exit 1
 × renders the served screen with the values of its fields
 × waits while the server waits, polling as it says (C150.5)
 × says the flow cannot continue once the server halted it (C151.2)
 × never evaluates a transition, even one whose condition would hold
 ...
      Tests  12 failed | 81 passed (93)
```

### GREEN

`flow-position.ts`: `resolveFlowPosition` takes the server's `position` and its served `step`
(`serverPosition`): `waiting` (`retry-after-ms`, else `WAIT_POLL_MS`), `halted`, `ended` (the served
terminal step), `active` (the served client view, else the projection's entry of that id; the step's
own facts still pick its screen, and a step already done here waits for the server); new kinds
`screen`, `waiting`, `halted`. A session without a position is the projection in list order
(`listPosition`): no transition is evaluated or followed, so `json-logic.ts` is no longer imported (it
gains no strict mode, F26; it is left in place, rule 2, for `integration-9a` to remove).
`UnsupportedReason` is `step` alone (`condition` and `loop` went with the walk); `UnsupportedStep` takes a
client view too and says "cannot continue" for a step it cannot name. `FlowRenderer` keys the new
kinds (one `waiting` screen per step) and renders nothing for them until the renderer slice;
`stepIdOf` names a waiting position's step for the collector.

On the way the first GREEN attempt refused (as unsupported) any position-less flow with transitions;
the default template's flow carries two (`inquiry.status == failed` to the failure step), so 14 tests
of the default flow went red. A Phase 9 server always sends its position, so a position-less session
can only come from an older server or a test: it is read as the projection, transitions ignored, and
the two RED tests were corrected to expect the list's next step.

```
$ pnpm --filter @openverify/flow exec vitest run src/flow src/steps/unsupported-step.test.tsx --coverage.enabled=false   # exit 0
 Test Files  14 passed (14)
      Tests  250 passed (250)
```

## The renderer on the server's position (C148, C150.5, C150.7, C150.9, C151.2, C158.5, C160.9, C161.2, C162.5)

### RED

`src/flow/flow-renderer-phase9.test.tsx` (with `src/testing/flow-renderer.ts`' fake answers): a served
screen renders with the operator copy and submits its values with the button key; the next screen is
whatever the server serves (a branch driven by the fake's answer); a 422 pointer marks its field; a 409
`flow_step_not_current` reads the session again; a confirmed cancel stops for now without a request;
the waiting state reads the session until the server moves on; `halted` says it cannot continue; the
completion announces the outcome in a live region and shows "Continue" as a link to
`completion.redirect-url`, with no navigation after ten minutes of timers (C158.5, F41); no redirect
when the server allows none; the failed screen shows the contest route; a custom text of a built-in key
replaces the catalog's; the language is negotiated among `locales.enabled` with the version's default
as fallback (`RequestedLanguagesContext`, a new context in `src/session/`); the selector offers only the
enabled locales and sits after the step's content (3.2.6); every session read goes to
`useApplySessionTheme()`. `src/signals/flush-before-submission.test.ts`: the open screen's body is
sent before a screen submission (C150.9).

```
$ pnpm --filter @openverify/flow exec vitest run src/flow/flow-renderer-phase9.test.tsx src/signals/flush-before-submission.test.ts --coverage.enabled=false   # exit 1
 × sends the open screen before a screen submission
 × renders the served screen with the operator copy, and submits its values with the button key
 × shows the waiting state and reads the session until the server moves on
 × announces the outcome and redirects only when the person presses Continue, never on a timer
 × shows the contest route on the failed screen as the completion screen does
 ...
      Tests  15 failed | 4 passed (19)
```

### GREEN

- `src/screens/live-screen-step.tsx` (`LiveScreenStep`): `client.submitScreen` then a session read; a
  409 reads the session; a 422's `/values/<field>` pointers mark their fields (`refused`).
- `src/steps/position-screens.tsx`: `WaitingStep` (polls every `retryAfterMs`), `HaltedScreen`,
  `StoppedScreen`.
- `src/steps/outcome-screens.tsx`: `CompletionScreen` and `FailureScreen` take `redirectUrl` (a live
  announcement and a "Continue" link, `referrerpolicy="no-referrer"`, no timer) and `FailureScreen`
  the contest route.
- `src/session/session-copy.ts`: `applySessionCopy(i18n, copy)` (the custom texts of built-in keys over
  the catalogs, the replaced texts restored on the next session, `{name}` read as `{{name}}`),
  `copyText(i18n, copy, key, language, defaultLocale)` (C162.5's fallbacks, never a raw key),
  `isCustomText`, `toCatalogText`.
- `src/components/flow-languages.ts` (`FlowLanguagesContext`) and `flow-layout.tsx`: the selector moves
  to a `footer` after `main` (`data-slot="help"`, 3.2.6), offering `LanguageSelect`'s new `available`.
- `flow-renderer.tsx`: on each session read, `useApplySessionTheme()(session)`, the copy, the enabled
  locales reported, and the language negotiated once against `locales.enabled` and `locales.default`
  (`RequestedLanguagesContext`, else `navigator.languages`); the new positions rendered.
- `flush-before-submission.ts`: `submitScreen` waits for the open screen's body (C150.9).

```
$ pnpm --filter @openverify/flow exec vitest run src/flow/flow-renderer-phase9.test.tsx src/signals/flush-before-submission.test.ts --coverage.enabled=false   # exit 0
      Tests  19 passed (19)
$ pnpm --filter @openverify/flow exec vitest run --coverage.enabled=false   # exit 1, only flow-server-embed's uncommitted RED tests
 Test Files  2 failed | 103 passed (105)     (src/embed/bridge.test.ts, src/embed/embed-entry.test.tsx: untracked, not mine)
      Tests  14 failed | 1394 passed (1408)
```

## The URL parameters (C160.9, V15; C161.2)

### Placeholders and RED

`chore`-free: `src/session/flow-parameters.ts` (`STYLE_VARIANTS`, `STYLE_VARIANT_PARAMETER`,
`FlowParameters`, and placeholders `readFlowParameters`, `carryParameters`) goes in with its tests, which
typecheck against it. `flow-parameters.test.ts`: `language`, then `lang`, each in the query then the
fragment; an unknown style variant ignored; the fragment's public parameters carried into the query,
never the credentials. `session-bootstrap.test.ts` (new block): a fragment's `language` and
`style-variant` survive its removal in the `replaceState` URL. `app-parameters.test.tsx`: the
`style-variant` query reaches `applySessionTheme(session, 'dark')` (observed through `vi.mock`, since
the function is api-themes' no-op), none gives `null`, and `?language=es-MX` opens in Spanish with
`intlLocale` `es-MX`.

```
$ pnpm --filter @openverify/flow exec vitest run src/session src/app-parameters.test.tsx --coverage.enabled=false   # exit 1
 × reads the language, its lang alias and the style variant, the query first
 × moves the fragment public parameters into the query, never the credentials
 × are carried into the query when the fragment is removed
 × passes the style-variant parameter to the session theme
 × opens in the language parameter, formatting with its full tag
 ...
      Tests  8 failed | 46 passed (54)
```

### GREEN

`readFlowParameters` (the order of `requestedLanguages`: `language` before `lang`, each in the query
then the fragment), `carryParameters` (the fragment's `language`, `lang` and `style-variant` appended to
the query unless it names them; nothing else of the fragment), `bootstrapSession`'s `replaceState`
through it, and `App`: the parameters read once from `window.location`; `styleVariant` (prop, else the
URL's) bound into `applySessionTheme`; the requested tags (URL then `navigator.languages`) remembered
for `intlLocale`, negotiated at start when the URL names a language, and provided through
`RequestedLanguagesContext` for the session's negotiation. One RED expectation was wrong and corrected:
`?lang=de` with `#language=fr` reads `['fr', 'de']`, since `language` comes before its alias wherever
it is (`requestedLanguages`, flow-i18n's order).

```
$ pnpm --filter @openverify/flow exec vitest run src/session src/app-parameters.test.tsx src/app.test.tsx --coverage.enabled=false   # exit 0
      Tests  68 passed (68)
```

## The consent evidence (C162.9)

### Placeholder and RED

`chore(flow)`: `ConsentStep` takes the session's `copy` (unused until built). `consent-step.test.tsx`:
a new block (each text as shown digested, NFC, the ticked optional ones after the required ones, with
`{{days}}` filled; the Spanish words for a Spanish-speaking user; `copy-source: custom` when the session
replaced a text), and the two assertions of the exact consent body gain the three new members (the plan
amends the consent body, C162.9).

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/consent-step.test.tsx --coverage.enabled=false   # exit 1
 × records consent with the keys of the texts shown and the language used
 × lets the user verify without it: the optional key is not recorded
 × digests each text as shown, the ticked optional ones after the required ones
 × digests the Spanish words for a Spanish-speaking user
 × says the words were the operator copy when the session replaced one
      Tests  5 failed | 12 passed (17)
```

### GREEN

`src/lib/text-digest.ts` (`textSha256`: NFC, UTF-8, Web Crypto SHA-256, lowercase hex) and
`ConsentStep`: each text as shown (`translateKey` after the session copy, placeholders filled) digested
in the body's order, `copy-source` `custom` when any shown key is the operator's in the shown language
(`isCustomText`), `catalog-version` `FLOW_CATALOG_VERSION`; a browser without Web Crypto sends no
digests (recorded `null` by the server, never as matched). `FlowRenderer` passes the session's copy.

```
$ pnpm --filter @openverify/flow exec vitest run src/flow/flow-renderer src/steps/consent-step.test.tsx src/lib --coverage.enabled=false   # exit 0
```

## Capture methods by device class (C153.2)

### Placeholder and RED

`src/lib/capture-methods.ts` (`WebDeviceKind`, `webDeviceKind`, `captureMethodsFor`, placeholders) and
`FlowEnvironment.deviceKind` (default `webDeviceKind(navigator)`), committed with the RED test
`src/steps/capture-methods.test.tsx`: the device class's entry, else the step's methods; a phone or tablet
browser is `mobile-web` (`userAgentData.mobile` first, then the user agent), anything else
`desktop-web`; a government ID step offering only the camera on a phone and only an upload on a desktop;
the upload reported as `capture-method: upload`.

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/capture-methods.test.tsx --coverage.enabled=false   # exit 1
 × takes the entry of the client device class, else the step methods
 × reads a phone or a tablet browser as mobile-web, anything else as desktop-web
 × offers only the camera on a phone when the step says so
 × offers only an upload on a desktop, and reports the upload as the capture method
      Tests  4 failed (4)
```

### GREEN (government ID)

`webDeviceKind` (`userAgentData.mobile`, else a phone or tablet user agent), `captureMethodsFor`
(`captureMethodsByDevice[kind] ?? captureMethods`), `rememberCaptureMethod`/`captureMethodOf` (a
`WeakMap` by photo, so `CapturedPhotos` keeps its shape); `CaptureSequence` remembers each accepted
photo's source; `submitVerification` sends `capture-method` when the photo says how it was taken;
`VerificationCaptureStep` applies the environment's `deviceKind`.

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/capture-methods.test.tsx src/steps/verification-capture-step.test.tsx src/flow/submit-verification.test.ts src/components/capture-sequence.test.tsx --coverage.enabled=false   # exit 0
      Tests  46 passed (46)
```
(`tsc` at this point reports one error in `src/preview/preview-app.tsx`, flow-server-embed's uncommitted
work; none in my paths.)

### RED (selfie and document)

`chore(flow)`: `UploadSelfiePoseOptions.captureMethod`. `capture-protocol.test.ts`: a pose upload reports
its method; `document-step.test.tsx`: a picked file reports `upload`, the camera input `camera`, and a
`captureMethodsByDevice` entry for `desktop-web` leaves the camera input out on a desktop.

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/document/document-step.test.tsx src/selfie/capture-protocol.test.ts --coverage.enabled=false   # exit 1
 × reports how the pose was taken
 × reports a picked file as an upload and a photo as taken with the camera
 × reports a photo taken with the camera input as camera
 × offers only the methods of its device class entry
      Tests  4 failed | 45 passed (49)
```

### GREEN (selfie and document)

`uploadSelfiePose` sends `captureMethod` when given (the selfie step passes its `camera` or sandbox
`upload` method); `DocumentStep` applies `captureMethodsFor(step, deviceKind)` and reports `upload` for
the file input and `camera` for the camera input.

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/document src/selfie src/steps/selfie-capture-step.test.tsx --coverage.enabled=false   # exit 0
      Tests  91 passed (91)
```

## The 2.2.1 capture warning and its extension (C171.4)

### Placeholder and RED

`src/selfie/capture-time-warning.tsx` (`CAPTURE_WARNING_MS` 20,000 and a `CaptureTimeWarning` that renders
nothing) with `capture-time-warning.test.tsx`: nothing before the last 20 s, then a warning in a live
region with the seconds left and a "More time" button; ten extensions in a row, each 10 s before the limit
as moved by the ones before, each acknowledged; a refused extension said in words.

```
$ pnpm --filter @openverify/flow exec vitest run src/selfie/capture-time-warning.test.tsx --coverage.enabled=false   # exit 1
 × says nothing until 20 seconds before the limit, then warns in a live region
 × extends the capture in one action, at least ten times, each moving the limit
 × says so when the extension is refused, and keeps the person going
      Tests  3 failed (3)
```

### GREEN

`CaptureTimeWarning`: the limit followed on the client's monotonic clock from the capture's `openedAt`
plus `SELFIE_CAPTURE_TTL_SECONDS`, moved by what each extension added to the server's `expires-at`; in
the last `CAPTURE_WARNING_MS` a `role="alert"` warning with the seconds left in the person's digits
(`intlLocale`) and "More time" (`client.extendSelfieCapture`); "You have more time." after an extension;
a refusal said in words. `SelfieCaptureStep` renders it, keyed by capture, while a capture is open and not
being submitted.

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/selfie-capture-step.test.tsx src/selfie --coverage.enabled=false   # exit 0
      Tests  69 passed (69)
```

## Prefill on verification steps and digits as typed (C148.7, 3.3.7; C161.4)

### Placeholder and RED

`chore(flow)`: `OneTimeCodeStep` and `EnteredValuesStep` take `prefill` (the session's `values`).
`src/steps/prefill-and-digits.test.tsx`: a phone step after a screen shows the number entered earlier,
filled and editable; a database step shows the values entered earlier at the inputs whose field names they
carry; Arabic-Indic digits typed into a phone number, a code and a form's phone number become ASCII.

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/prefill-and-digits.test.tsx --coverage.enabled=false   # exit 1
 × shows the number the person entered earlier, filled and editable
 × normalises Arabic-Indic digits typed into the number and the code (C161.4)
 × shows the values the person entered earlier, by the inputs they fill
 × normalises Arabic-Indic digits typed into a phone number or a date (C161.4)
      Tests  4 failed (4)
```

### GREEN

`OneTimeCodeStep`: the number or address the session holds (the one string a `prefillFrom` step gets),
filled and editable; typed digits of the number and the code through `normalizeDigits`.
`EnteredValuesStep`: each input filled from the session value whose key is its field name
(`phone_number` at `phone-number`), since the client view leaves out the step's map of inputs to fields;
digits normalised in date, phone and text inputs. `FlowRenderer` passes the session's `values` to both.

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/prefill-and-digits.test.tsx src/steps/otp src/steps/forms src/flow/flow-renderer --coverage.enabled=false   # exit 0
```

## `<bdi>` and the full `Intl` tag (C161.2, C161.3)

### RED

`src/steps/bidi-and-locale.test.tsx`: the attempt counter's values each in a `<bdi>`; a document step in
`ar` requested as `ar-EG` writes its size limit in Arabic-Indic digits.

```
$ pnpm --filter @openverify/flow exec vitest run src/steps/bidi-and-locale.test.tsx --coverage.enabled=false   # exit 1
 × isolates the attempt counter values
 × writes a document size limit in the digits of ar-EG
      Tests  2 failed (2)
```

### GREEN

- `<bdi>` (`useIsolatedT`) around the interpolated values that carry a direction of their own: the OTP
  destination, the wallet network and name, the phone's device on the handoff wait, the picked file's
  name and size, the requesting organisation on the handoff context screen. Counts and times stay plain
  text (the bidi algorithm keeps European numbers in order, and `Intl` formats them in the person's
  digits); a first sweep that also wrapped every count broke 35 existing `getByText` assertions for no
  reading benefit and was narrowed.
- `src/session/use-intl-locale.ts` (`useIntlLocale`): the full requested tag inside a component. Found on
  the way: `intlLocale(i18n)` (flow-i18n's) keys a `WeakMap` by the instance `createI18n` made, but the
  `i18n` that `useTranslation()` answers inside a component is a copy sharing its store, so the lookup
  misses and `ar-EG` formats as `ar` (probed: `intlLocale` of the copy is `ar`, of the instance `ar-EG`).
  `useIntlLocale` reads the requested tags from `RequestedLanguagesContext` first, then `intlLocale`.
  Every `Intl` call site of flow-i18n's list (`destination-entry`, `code-entry`, `entered-values-step`,
  `device-handoff-step`, `document-step`, `crypto-wallet-step`, `handoff-redeem-flow`) and mine
  (`screen-components`, `capture-time-warning`) uses it. The RED test now provides the context, as the
  app does. The fix in flow-i18n's file is a contract deviation.
- Ten existing assertions of whole sentences that now hold a `<bdi>` read them with `wholeText`
  (`src/testing/flow-renderer.ts`), in `handoff-redeem-flow.test.tsx`, `crypto-wallet-step.test.tsx`,
  `device-handoff-step.test.tsx`, `document-step.test.tsx` and `one-time-code-step.test.tsx`.

```
$ pnpm --filter @openverify/flow exec vitest run --coverage.enabled=false   # exit 0
 Test Files  115 passed (115)
      Tests  1461 passed (1461)
```

### `session-copy.ts`'s own tests (written after its GREEN)

`src/session/session-copy.test.ts`: `{name}` read as `{{name}}`; a custom text of a built-in key laid over
the catalog and restored for the next session; a key the catalogs do not hold never laid over them; the
fallbacks of C162.5 down to `null`, never a raw key; `isCustomText`. Passed on their first run (6 tests);
a mutation that skips the restore turns the second red.

The mutation check above was wrong as first recorded: with the restore removed, the six tests still
passed, because the replaced text was written into the module catalogs every i18next instance starts
from (i18next keeps them, and its store's data map, by reference), so instances leaked operator copy
into one another. Probed: after one instance laid "Before we start" over `consent.title`, a fresh
`createI18n('en')` read "Before we start".

#### RED

`session-copy.test.ts` gains "never reaches another instance: the built-in catalogs stay as built".

```
$ pnpm --filter @openverify/flow exec vitest run src/session/session-copy.test.ts --coverage.enabled=false   # exit 1
 × never reaches another instance: the built-in catalogs stay as built
   expected 'Before we start' to be 'Consent to use your biometric data'
 × never turns a message into a branch for a key the catalogs do not hold
 × takes the person locale custom text, then its built-in text
      Tests  3 failed | 4 passed (7)
```

#### GREEN

`applySessionCopy` gives the store its own `structuredClone` of the catalogs before its first replaced
text (`detach`, once per store), and keys its originals by `i18n.store`, which every copy of the instance
that `useTranslation()` answers shares. With the restore removed, "restores it for the next session" now
fails (verified), so the check is real.

```
$ pnpm --filter @openverify/flow exec vitest run src/session/session-copy.test.ts src/flow/flow-renderer-phase9.test.tsx src/steps/consent-step.test.tsx --coverage.enabled=false   # exit 0
      Tests  39 passed (39)
```

## The mocked suite (C171.2's CI matrix, C178.3)

`e2e/support/mock-flow-renderer.ts` registers `flow-renderer`'s answers (`registerMockFlowExtension`):
`serve(mock, served)` sets what the session serves (`position`, `step`, `values`, `copy`, `locales`,
`completion`, `decision-contest-route`, and an inquiry status), `rendererScript(mock).onSubmit` decides
what a screen submission leads to (the "server's" branch), and the script records every submission,
every session read's `OpenVerify-Flow-Spec` and every capture extension (`POST
/selfie-captures/:id/extend`, answered with a capture 180 s later each time). `e2e/support/screens.ts`
holds a screen of every component kind with synthetic English and Arabic copy, `ON_EVERY_KIND`,
`DONE` and `openAt(page, served, { language })`.

`e2e/screens.spec.ts` (written after the features; acceptance specs on the built flow):
- English, 320 CSS px, light: arrival (values filled, a masked value "already provided"), a field shown
  by a rule, the error summary, the second screen the server chose, each through `expectAccessible`; the
  submitted values hold only visible fields; every session read declared `1, 2`; the other button takes
  the other branch, the completion checked by axe too;
- Arabic, 320 CSS px, dark: arrival right to left, the error summary, an age typed in Arabic-Indic digits
  shown in ASCII, each through axe;
- 768 CSS px: a screen through axe.

```
$ flock /tmp/openverify-e2e.lock sh -c 'cd apps/flow && pnpm exec playwright test --config e2e/playwright.config.ts e2e/screens.spec.ts'   # exit 0
  4 passed (18.1s)        (load 22.16 at start)
```

More specs, each run under the e2e lock and passing (written after the features they check):
- `e2e/server-position.spec.ts`: the waiting state reads the session every 2 s on the page's paused clock
  (none at 1.9 s, one at 2.0 s, one more at 4.0 s) until the server moves on; halted; the completion's
  live announcement and "Continue" with no navigation after ten minutes of the page's clock, then the
  click reaching the redirect; the failed screen's contest route; each through axe in English at 320 px
  light and in Arabic at 320 px dark;
- `e2e/wcag-own.spec.ts` (C171.3): 2.4.11 (40 tab stops, the focused control's centre and corners never
  covered), 3.2.6 (the selector's slot after `main` on a screen and on the completion), 3.3.7 (screen ->
  phone_otp, and database -> phone_otp, through the session's values), 3.3.8 (one `one-time-code`
  field, a paste not prevented), 2.5.8 (every control of the screen of every kind at least 24 by 24);
- `e2e/rtl.spec.ts`: Arabic, `dir="rtl"`, a phone number and a code typed in Arabic-Indic digits sent in
  ASCII; the handoff's QR code (`data-icon="qr-code"`, now named in `src/handoff/qr-code.tsx`) not
  mirrored; axe at 320 px dark;
- `e2e/pseudo-locale.spec.ts` (C161.7, 1.4.10, 1.4.12): both pseudo-locales at 320 px under the
  text-spacing override, the screen's arrival, its errors and the waiting state, through
  `expectPseudoLocalized` and axe (`bypassCSP` for the injected spacing style only);
- `e2e/selfie-extension.spec.ts` (C171.4): no warning at 25 s left, the warning at 15 s left (axe with the
  clock running, then held again), ten extensions each acknowledged, then the photo uploaded with its
  `capture-method`.

```
$ flock /tmp/openverify-e2e.lock sh -c 'cd apps/flow && pnpm exec playwright test --config e2e/playwright.config.ts e2e/server-position.spec.ts e2e/wcag-own.spec.ts e2e/rtl.spec.ts e2e/pseudo-locale.spec.ts e2e/selfie-extension.spec.ts'
  first run: 13 passed, 4 failed (the QR svg had no data-icon; the pseudo-locale spec submitted a screen
  with no error to show; axe ran on a paused clock); after the fixes: rtl 2 passed (10.8 s, load 17.70),
  pseudo-locale and selfie-extension 3 passed (23.4 s with rtl's first run, load 12.06)
```
- `e2e/step-matrix.spec.ts` (C171.2): every step type the flow renders (consent, government ID, selfie,
  document, phone and email codes, database, AAMVA form, wallet, business registry and website,
  completion, failure) at the server's position, through axe in English at 320 px light, in Arabic at
  320 px dark (`dir="rtl"`) and once at 768 px.

```
$ flock /tmp/openverify-e2e.lock sh -c 'cd apps/flow && pnpm exec playwright test --config e2e/playwright.config.ts e2e/step-matrix.spec.ts'   # exit 0
  39 passed (28.6s)        (load 19.08 at start)
```

The whole mocked suite first failed three existing specs whose behaviour the plan changes: each upload
now sends `capture-method` before its file (C153.2; `flow.spec.ts` and `selfie-capture.spec.ts` assert the
fields in order), and `<html lang>` names the full tag the browser asked for (`en-US` under Playwright;
C161.2, flow-i18n's decision (g)), now that `App` remembers the requested tags. The three assertions
were changed to the new fields and tag (contract deviation); then:

```
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e   # exit 0
  158 passed (1.3m)        80 s with the build; load 19.54 before, 23.51 after
```

## Final gates (each exit 0, read from the command)

| Command | Result | Time and load |
|---|---|---|
| `pnpm --filter @openverify/flow typecheck` (`tsc`, `-p e2e`, `-p tsconfig.server.json`) | exit 0 | load 19.28 |
| `pnpm --filter @openverify/flow lint` | exit 0 | |
| `pnpm --filter @openverify/flow test` | exit 0: 116 files, 1,468 tests; 95.15% statements, 88.38% branches | 226 s, load 20.60 before, 24.80 after |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow build` | exit 0 | 3 s, load 23.25 |
| `flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e` | exit 0: 158 passed | 80 s with the build, load 19.54 before, 23.51 after |
| `pnpm exec prettier --check <98 files I committed>` | exit 0 | |
| `pnpm turbo run lint typecheck --force --filter=@openverify/flow` | exit 0: 2 of 2 tasks, 0 cached | 125 s, load 17.48 before, 16.17 after |
| `node apps/flow/scripts/export-flow-locales.ts --check` | exit 0, "The locale exports are up to date." | |

Bundle (the hosted page, `dist/index.html`'s two scripts, measured after the build; no lock needed for
sizes; load 22.66): `assets/main-*.js` 185,238 bytes (59,285 gzip -9) and the chunk it shares with the
preview entry, `assets/document-language-*.js`, 1,092,902 bytes (309,823 gzip -9): 1,278,140 bytes,
369,108 gzipped. No baseline was measured at the Phase 9 base (no budget exists, K8-25).

## Handoff

- **Renderer entry points.** `FlowRenderer` (`src/flow/flow-renderer.tsx`) renders `resolveFlowPosition`
  (`src/flow/flow-position.ts`): a session with `position` follows the server (`serverPosition`: `active`
  renders the served `step`, else the projection's entry of that id; `waiting` polls `retry-after-ms`,
  `WAIT_POLL_MS` 2,000 by default; `halted`; `ended`); a session without one is the projection in list
  order, no transition evaluated. Position kinds gained `screen`, `waiting`, `halted`. On each session read
  the renderer calls `useApplySessionTheme()(session)`, `applySessionCopy`, reports `locales.enabled` to
  the layout (`FlowLanguagesContext`), and negotiates the language once against the enabled locales
  (`RequestedLanguagesContext`, else `navigator.languages`).
- **Component registry.** `SCREEN_COMPONENTS` (`src/screens/screen-components.tsx`), `ScreenStep`
  (`screen-step.tsx`), `LiveScreenStep` (`live-screen-step.tsx`, the live submit), `StaticStep`,
  `isPreviewable`, `PREVIEWABLE_TYPES`, `PREVIEW_PLACEHOLDER_TYPES` (`step-registry.tsx`, for the preview);
  the pure model in `screen-model.ts`.
- **Session parsing.** `readFlowParameters`, `carryParameters`, `STYLE_VARIANTS`,
  `STYLE_VARIANT_PARAMETER` (`src/session/flow-parameters.ts`; `bootstrapSession` carries a fragment's
  `language`, `lang` and `style-variant` into the query); `App` reads them once, passes the variant to
  `applySessionTheme` (prop, else URL) and provides `RequestedLanguagesContext`
  (`src/session/requested-languages.tsx`); `useIntlLocale` (`src/session/use-intl-locale.ts`) is the
  `Intl` tag inside components; `applySessionCopy`, `copyText`, `isCustomText`, `toCatalogText`
  (`src/session/session-copy.ts`).
- **Client.** `FlowApiClient.submitScreen`, `.extendSelfieCapture`, `uploadFile(..., captureMethod)`,
  `CaptureMethod`; `DECLARED_FLOW_SPECS` (`1, 2`) on every request; `flushBeforeSubmission` wraps
  `submitScreen` (C150.9). `captureMethodsFor`, `webDeviceKind`, `rememberCaptureMethod`,
  `captureMethodOf` (`src/lib/capture-methods.ts`), `FlowEnvironment.deviceKind`; `textSha256`
  (`src/lib/text-digest.ts`); `CaptureTimeWarning`, `CAPTURE_WARNING_MS` (`src/selfie/`);
  `WaitingStep`, `HaltedScreen`, `StoppedScreen` (`src/steps/position-screens.tsx`); `CompletionScreen`
  and `FailureScreen` take `redirectUrl` (and the failure `contestRoute`).
- **Mocks.** Fake: `src/testing/flow-renderer.ts` registers area `flow-renderer` (`serve`,
  `rendererScript`, `positionedSession`, `at`, `extendedCapture`, `wholeText`). Mocked suite:
  `e2e/support/mock-flow-renderer.ts` registers area `flow-renderer` (`serve`, `at`, `rendererScript` with
  `onSubmit`, `submissions`, `declaredSpecs`, `extensions`); `e2e/support/screens.ts` (`EVERY_KIND_SCREEN`,
  `ON_EVERY_KIND`, `DONE`, `openAt(page, served, { language, flow, configure })`).
- **New catalog keys** (all five locales, machine-drafted, under `screen`): `continue`, `heading`,
  `required`, `choose`, `set`, `summary`, `errors.*` (16), `address.*` (6), `saving`, `cancel.*` (6),
  `unavailable`, `help`, `helpLink`, `privacyLink`, `waiting.{title,message}`,
  `halted.{title,message}`, `redirect.{announce,continue}`, `extend.{warning,button,extended,failed}`.
- **Specs and states.** `screens.spec.ts`, `server-position.spec.ts`, `step-matrix.spec.ts`,
  `wcag-own.spec.ts`, `rtl.spec.ts`, `pseudo-locale.spec.ts`, `selfie-extension.spec.ts` (above).
- **For the preview (flow-server-embed).** Render `StaticStep` for `isPreviewable` views and a placeholder
  for `PREVIEW_PLACEHOLDER_TYPES`; pass a `copy(key)` built with `copyText` over the preview document's
  copy; wrap in an i18n provider and `RequestedLanguagesContext` for the full `Intl` tag.
- **For integration-9a.** The CORS headers of the API and the mock (contract deviation 1) before the
  full-stack gate; `json-logic.ts` and its test are no longer imported and may be removed.
