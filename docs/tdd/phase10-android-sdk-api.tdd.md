# Phase 10, Workflow 10A: android-sdk-api (family P)

C190's plumbing, C191 (the registry and the transport), C192 (events), C200 (consent digests) and android-sdk-api's part of C213.1, test-first. Every Gradle call ran in the foreground as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)` after `source scripts/env.sh`; the lock wait was 0 s throughout unless noted (no other agent's Gradle build ran). Base: `9286d0df` (android-driver's checkpoint 3), 1,796 SDK host tests.

## Checkpoint 1: the request options, the link rule and the overlay protections

### Stub `47e33360`

`loopbackHttpAllowed()` (`commonMain/.../api/LoopbackPolicy.kt`, `internal expect`) with its Android actual (`LoopbackHttp { testOverride; read(context) }`, allowing plain http as before) and its iOS actual (`false`, final); `LoopbackPolicy.allows` (every URL `ApiBaseUrl` accepts); `RequestOptions.isLocale` (any value) with `LOCALE_MAX_LENGTH` and `LOCALE_REFUSED`; `InquiryResults.EXTRA_LOCALE` and `EXTRA_APPEARANCE`; `OverlayWindows.apply` (nothing). Compile check: `:openverify-sdk:testAndroidHostTest --tests dev.openverify.sdk.OpenVerifyInquiryRequestTest`, exit 0, 117 s.

### RED `886656a2`

- `OpenVerifyInquiryRequestTest`: a locale is a BCP 47 tag of at most 35 characters (`es`, `ar-EG`, `ES-mx`, `zh-Hant-TW`, `ja`, a 35-character tag accepted; `""`, `" es"`, `es_MX`, `es-`, `e`, `1es`, `*`, `es\nMX`, `fr-CA-x`, a 36-character tag refused with `RequestOptions.LOCALE_REFUSED`, never the token).
- `OpenVerifyInquiryOneTimeLinkTest` rewritten for the required `apiBaseUrl`: two links on different origins reach the same compiled-in API; the link's locale and appearance; a malformed link locale refused. The internal one-argument reader is no longer called.
- `OpenVerifyInquiryContractTest`: locale and appearance travel as `EXTRA_LOCALE` and `EXTRA_APPEARANCE` for both contracts; no locale extra without a locale; a missing appearance extra is `SYSTEM`; a malformed locale or an unknown appearance name carries no launch.
- `api/LoopbackPolicyTest` (Robolectric): a debuggable host may use plain http to `localhost`, `127.0.0.1`, `[::1]` and `10.0.2.2`; a host that is not debuggable may not; `https` in both; the SDK's own override; the flag read again each time; no main source but the declaration names `testOverride`.
- `OverlayWindowsTest`: from API 31 the window's private flag `SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS` is set and cleared; below 31 left as it is.
- `OpenVerifyInquiryActivityTest`: a host that is not debuggable never sends the session over plain http (`Failed(INVALID_REQUEST)`, 0 requests); a debuggable host runs the flow; a link on another origin is redeemed at the compiled-in API; the activity reads `HostDebuggable`; `Request.locale = "es-MX"` shows the Spanish consent title; the window hides overlays while resumed and not while paused. Its existing tests and `OpenVerifyInquiryActivitySignalsTest` set `LoopbackHttp.testOverride` (their MockWebServer is plain http), a fixture line only.
- `ui/ConsentProtectionsTest`: on API 26-30 the agreement, the optional consent and Continue carry `ObscuredTouchesFiltered`; from 31 not; an obscured tap on API 28 never ticks the agreement.
- `signals/NeverReadTest` (named borrowed edit, rule 22): the manifest test expects exactly `INTERNET`, `CAMERA`, `HIDE_OVERLAY_WINDOWS` (renamed "the manifest asks for the internet, the camera and to hide overlays only"); `DEBUGGABLE_READERS` gains `src/androidMain/kotlin/dev/openverify/sdk/api/LoopbackPolicy.android.kt`.

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.OpenVerifyInquiry*' --tests 'dev.openverify.sdk.api.LoopbackPolicyTest' \
    --tests 'dev.openverify.sdk.OverlayWindowsTest' --tests 'dev.openverify.sdk.signals.OpenVerifyInquiryActivitySignalsTest' \
    --tests 'dev.openverify.sdk.signals.NeverReadTest' --tests 'dev.openverify.sdk.ui.ConsentProtectionsTest'
104 tests completed, 32 failed          (rc=1, 67 s, load 0.26 -> 1.86)
FAIL OpenVerifyInquiryRequestTest [1..16]: Expected java.lang.IllegalArgumentException to be thrown, but nothing was thrown.
FAIL OpenVerifyInquiryContractTest a request's locale and appearance travel as extras ...: expected:<ar-EG> but was:<null>
FAIL OpenVerifyInquiryContractTest a launch intent with a malformed locale or an unknown appearance carries no launch: expected null, but was:<Session(...)>
FAIL LoopbackPolicyTest a host that is not debuggable may not, without the SDK's own test override: AssertionError
FAIL OverlayWindowsTest from API 31 the window hides other apps' overlays, and shows them again: AssertionError
FAIL OpenVerifyInquiryActivityTest a host that is not debuggable never sends the session over plain http ...: You must finish your Activity first
FAIL OpenVerifyInquiryActivityTest the request's locale is the flow's language: ComposeTimeoutException
FAIL OpenVerifyInquiryActivityTest the activity reads whether the host is debuggable when it starts ...: AssertionError
FAIL NeverReadTest whether the host is debuggable is read only by the named readers(): expected <[...LoopbackPolicy.android.kt, ...]>
FAIL NeverReadTest the manifest asks for the internet, the camera and to hide overlays only(): expected <[INTERNET, CAMERA, HIDE_OVERLAY_WINDOWS]>
FAIL ConsentProtectionsTest on API 26 to 30 ...: Failed to assert (OpenVerifyObscuredTouchesFiltered = 'true')
FAIL ConsentProtectionsTest on API 28 a tap through an obscuring window never ticks the agreement: Failed to assert (ToggleableState = 'Off')
```

The link tests that already held (two origins, one API) passed at once: the public `fromOneTimeLink` already took the API from its argument since Stage 1a; the change here is the reader underneath and the deletion of the internal one.

### GREEN `c175bcba`

- `RequestOptions.isLocale`: 1-35 characters, no `_` or whitespace, and `canonicalLanguageTag` (android-logic's syntax check) accepts it; `Request` and `OneTimeLink` `require` it with `LOCALE_REFUSED`.
- `InquiryResults.putOptions` writes `EXTRA_LOCALE` (only when set) and `EXTRA_APPEARANCE` (the enum's name); `requestFrom` and `oneTimeLinkFrom` read them (`SYSTEM` when absent, no launch for an unknown name); `Launch` carries `locale` and `appearance`, which the activity passes to `OpenVerifyTheme(appearance, requestedLocale)`.
- `OneTimeLinks.parse(url, apiBaseUrl: String)`: the API is required and the link's origin is never read; `OpenVerifyInquiry.fromOneTimeLink(url)` (internal) is deleted. `OneTimeLinksTest` (commonTest) and `OneTimeLinksParityTest` read every link with the host's API (`https://api.example.com/` where a case named none); their origin-as-API cases are replaced by "never reads the link's origin" (rule 12: the plan changes that behaviour).
- `LoopbackHttp.read(context)` reads `FLAG_DEBUGGABLE` from the application each time the activity starts; `loopbackHttpAllowed() = testOverride ?: hostDebuggable`; `LoopbackPolicy.allows(url)` = https, or plain http when allowed. The activity calls `HostDebuggable.read` and `LoopbackHttp.read` first, then ends a launch it may not connect as `Failed(INVALID_REQUEST)`.
- `OverlayWindows.apply(window, hide, apiLevel = SDK_INT)`: from 31 (and the device at S or later), `Window.setHideOverlayWindows(hide)`, a `SecurityException` logged as `activity.overlay_hiding_refused`; the activity hides in `onResume` and shows again in `onPause`. `HIDE_OVERLAY_WINDOWS` is in `androidMain/AndroidManifest.xml`.
- `ConsentScreen`: `submitProtection()` (android-screens' modifier) on the agreement row, each optional consent row and Continue.
- `android/openverify-sdk/README.md`: the permissions line, the one-time-link sentence, and the transit line (plain http only in a debuggable build).

The first GREEN run failed the two overlay tests: Robolectric grants no permission by itself, so `setHideOverlayWindows` threw and was logged. `HIDE_OVERLAY_WINDOWS` is a normal permission the platform grants at install, so the tests grant it as the platform does (`OverlayWindowsTest.grantInstallTimePermission`), a new test asserts the merged manifest requests it, and another that a refusal leaves the window as it is without stopping the flow.

```
$ ./gradlew ... --tests (the RED classes) --tests 'dev.openverify.sdk.api.OneTimeLinks*' --tests 'dev.openverify.sdk.signals.*' --tests 'dev.openverify.sdk.ui.ConsentScreenTest' --tests 'dev.openverify.sdk.PublicApiShapeTest' --tests 'dev.openverify.sdk.privacy.*'
231 tests completed, 2 failed           (rc=1, 133 s: the two overlay tests above)
$ ./gradlew ... --tests 'dev.openverify.sdk.OpenVerifyInquiryActivityTest' --tests 'dev.openverify.sdk.OverlayWindowsTest'
rc=0, 22 tests, 52 s
```

### Checkpoint 1 gate (rule 17, foundation-10a's split), at `c175bcba`

| Step | Call | Exit | Wall (lock wait) | Load before -> after |
|---|---|---|---|---|
| (a) | `:openverify-sdk:testAndroidHostTest` | 0: 1,849 tests, 0 failed, 0 skipped | 101 s (0 s) | 1.50 -> 2.78 |
| (b) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | 0 | 37 s (0 s) | 2.16 -> 2.57 |
| (c) | `koverVerify checkKotlinAbi` | 0 | 56 s (0 s) | 2.57 -> 3.86 |
| (d1) | `testDebugUnitTest assembleDebug` | 0 | 37 s (0 s) | 3.27 -> 4.53 |
| (d2) | `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 68 s (0 s) | 3.92 -> 6.25 |
| (e1) | `:openverify-sdk:assemble` (iOS klibs, boundary check) | 0 | 46 s (0 s) | 4.53 -> 5.75 |
| (e2) | `lint` | 0 | 124 s (0 s) | 4.47 -> 3.92 |
| (f) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 28 s (0 s) | 6.25 -> 5.22 |

## Checkpoint 2: the registry, the transport and events

### Stub `bf50a0ff`

`events/FlowEvents.kt` (commonMain): `FlowEvents(listener, deliver)`, `FlowEventTracker(inquiryId, events)`, `stepTypeOf(state)`, `ObservedFlowApi(api, onSession, onSubmitted)` and `EventingCaptureCamera(camera, tracker)`, all doing nothing. `InquiryViewModelFactory.kt`: the factory takes `components` and `scope`; `InquiryLaunchScope` (a view model beside `InquiryViewModel`); `MainThreadDelivery` (runs where called). `OkHttpFlowTransport.client` (the host's, not derived) and `httpClient`. `AndroidDeviceSignals(facts, sandboxOutcome)`, not sent (named borrowed edit, rule 22).

### RED `14aa7600`

- `OpenVerifyAndroidTest`: `installed()` returns what was installed; a second `install` replaces the first, whole; the empty registry names no component (these held at once: Stage 1a built the registry).
- `OpenVerifyAndroidTransportTest`: the derived client follows no redirect, plain or to https; keeps the host's pins, the four timeouts, the proxy and the interceptors; shares the pool and dispatcher; the host's client keeps following redirects.
- `events/FlowEventsTest`: no listener builds no event (a counting builder); delivery through the injected `deliver`; a listener's exception dropped and the next event delivered; `Started` once; each step shown once by its type across its states (two screens with different ids are two `StepShown("screen")`); one `Waiting` per wait (`Processing`, `Waiting`); a failure step is a step, an inquiry failed without one and the error screens are not; `Submitted` by the step's type; the camera's grant once, a failed photo by its reason; `Ended` once by kind; no step id in any event; `stepTypeOf`.
- `events/ObservedFlowApiTest`: a session read is seen; a consent, a verification submit and a screen submission (whose session is seen too) are each one submission, a verification's creation none; a refused submission is none and its failure unchanged; a photo the camera could not take is `CAMERA_ERROR`, an `OutOfMemoryError` is `OUT_OF_MEMORY`, both rethrown as they were; a cancellation is none.
- `events/OpenVerifyEventAllowlistTest` (C192.3): the event kinds and each one's instance fields by name and type against the reviewed allowlist; the closed enums (held at once: Stage 1a froze the shapes).
- `MainThreadDeliveryTest` (Robolectric): a delivery from another thread runs on the main looper; on the main thread at once.
- `OpenVerifyInquiryActivityComponentsTest` (Robolectric, MockWebServer): an installed transport carries the session read and the link redemption through the host's interceptor; a 302 is not followed although the host's client would (1 request, the error screen); with nothing installed no host interceptor sees anything; an installed listener hears `Started` and `StepShown("consent")` on the main thread; a rotation repeats none; back is `Ended(CANCELED)`; a throwing listener never stops the flow; a sandbox session's signals body carries the installed `sandbox-outcome`, a production one does not and is still sent.
- `signals/SandboxSignalOutcomeTest`: the outcome rides with integrity, recognition or both; under no tier nothing is read or sent; none installed, none sent; through `FlowCoordinator` over `FakeFlowServer`: a sandbox session sends `bot` or `human`, a production session sends its body without it for both outcomes, a session that names no environment is not a sandbox.

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.OpenVerifyAndroid*' --tests 'dev.openverify.sdk.events.*' \
    --tests 'dev.openverify.sdk.MainThreadDeliveryTest' --tests 'dev.openverify.sdk.OpenVerifyInquiryActivityComponentsTest' --tests 'dev.openverify.sdk.signals.SandboxSignalOutcomeTest'
50 tests completed, 28 failed           (rc=1, 57 s, load 0.14 -> 2.30)
FAIL MainThreadDeliveryTest a delivery from another thread runs on the main thread: expected:<[Looper (SDK 36 Main Thread ...)]> but was:<[null]>
FAIL OpenVerifyAndroidTransportTest the derived client follows no redirect, plain or to https(): expected: <false> but was: <true>
FAIL OpenVerifyInquiryActivityComponentsTest an installed transport carries every flow request ...: expected:<[/api/v1/flow/session]> but was:<[]>
FAIL OpenVerifyInquiryActivityComponentsTest an installed listener hears the flow start ...: expected:<[Started(...), StepShown(stepType=consent)]> but was:<[]>
FAIL OpenVerifyInquiryActivityComponentsTest in a sandbox the installed outcome rides on the signals body: Key sandbox-outcome is missing in the map.
FAIL FlowEventsTest (11 of 13), e.g. the flow starts once(): expected: <[Started(...)]> but was: <[]>
FAIL ObservedFlowApiTest (4 of 6), e.g. a consent, a verification submit and a screen submission ...: expected: <1> but was: <0>
FAIL SandboxSignalOutcomeTest (5 of 9), e.g. a sandbox session sends the outcome(): expected: <[bot]> but was: <[null]>
```

### GREEN `03f2ab83`, README `12008fa9`

- `OkHttpFlowTransport.client = hostClient.newBuilder().followRedirects(false).followSslRedirects(false).build()`, and `httpClient` (Ktor over it, through `okHttpFlowClient`, made once per transport).
- The factory: with an installed `OkHttpFlowTransport`, `FlowApiClient(apiBaseUrl, token, httpClient)` and `OneTimeLinkClient(apiBaseUrl, httpClient)`; otherwise the shared client. With a scope, the coordinator's API is an `ObservedFlowApi` whose sessions go to `InquiryLaunchScope.session` and whose accepted submissions become `Submitted` with the type of the coordinator's state at that moment; `InquiryLaunchScope.attach` starts the tracker in the view model's scope (`Started`, then each state, then `Ended` on the result). Both view models live in the activity's store, so a rotation makes neither again.
- `FlowEvents.emit` builds the event only with a listener and delivers it through `MainThreadDelivery` (at once on the main thread, else posted to it); a listener's `Exception` is dropped with the constant code `events.listener_failed`.
- The activity reads `OpenVerifyAndroid.installed()` once, makes `InquiryLaunchScope`, passes `components.sandboxSignalOutcome` to `AndroidDeviceSignals`, wraps the camera in `EventingCaptureCamera` and the actions so `cameraReady` tells `CameraPermission(granted = true)`.
- Borrowed edits (rule 1, named): `AndroidDeviceSignals.collect` sends `sandbox-outcome` (`bot`, `human`) beside the tier; `FlowCoordinator.sendSignalsBeside` drops it unless `session.environment.kind` is `SANDBOX`.
- `android/openverify-sdk/README.md`: the sandbox outcome (rule 22: what the SDK sends).

```
$ ./gradlew ... --tests 'dev.openverify.sdk.OpenVerify*' --tests 'dev.openverify.sdk.events.*' --tests 'dev.openverify.sdk.MainThreadDeliveryTest' \
    --tests 'dev.openverify.sdk.signals.*' --tests 'dev.openverify.sdk.privacy.*' --tests 'dev.openverify.sdk.InquiryViewModelTest'
rc=0, 215 tests, 105 s (load 0.27 -> 3.24)
```

### Checkpoint 2 gate, at `12008fa9`

| Step | Call | Exit | Wall (lock wait) | Load before -> after |
|---|---|---|---|---|
| (a) | `:openverify-sdk:testAndroidHostTest` | 0: 1,899 tests, 0 failed, 0 skipped | 102 s (0 s) | 1.73 -> 2.83 |
| (b) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | 0 | 36 s (0 s) | 2.83 -> 2.71 |
| (c) | `koverVerify checkKotlinAbi` | 0 | 55 s (0 s) | 2.71 -> 3.71 |
| (d1) | `testDebugUnitTest assembleDebug` | 0 | 30 s (0 s) | 2.66 -> 3.23 |
| (d2) | `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 67 s (0 s) | 3.23 -> 5.31 |
| (e1) | `:openverify-sdk:assemble` | 0 | 45 s (0 s) | 5.31 -> 6.96 |
| (e2) | `lint` | 0 | 130 s (0 s) | 6.96 -> 4.22 |
| (f) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 27 s (0 s) | 4.22 -> 4.99 |

The iOS klibs were rebuilt with `events/FlowEvents.kt` (klib 00:20:43, after the source's 00:13:46).

## Checkpoint 3: consent digests

### Stub `b63b0164`

`consent/ConsentDigests.kt`: `ConsentValues`, `ConsentText` (`Shown(key, logical, display, custom)`, `Unavailable(key)`), `consentText` (always unavailable) and `consentCatalogVersion` (empty) beside foundation-10a's `consentEvidence` hook (still `NONE`); a test tag per consent text on the consent screen (`ConsentTags.text(key)`).

### RED `613c5ca4`

- `commonTest consent/ConsentTextTest`: a built-in text is the SDK's own in each of the five languages; `{{days}}` filled in ASCII and isolated only when displayed; a text naming the days without them is unavailable; the agreement's label (`consent.checkbox`) is a consent text; a key with no text is unavailable; the operator's text replaces the SDK's with `{organization}` and `{days}` filled; an operator's text naming the organisation without `organization-display-name` is unavailable; an operator's text in another language leaves the SDK's; the evidence is each text's digest in the body's order (`text-keys`, then the ticked optional keys), `built-in`, the catalog version; every text the operator's is `custom`; mixed names no source; a text the screen could not show gives `NONE`; the catalog version is `android-<OPENVERIFY_SDK_VERSION>-<16 hex>` and is the version of the 40 Android rows of `consent-texts.json`, whose texts are the SDK's; every case of `android-consent-digests.json` (83) is the SHA-256 of the text `consentText` resolves.
- `consent/ConsentDeviceLocaleTest`: under `ar-EG`, `fa-IR`, `bn-BD`, `mr-IN` and `my-MM` (with a control that the device's own format is not ASCII), the filled days stay ASCII in `ar` and `en`, and an Arabic operator text's digest is the server's.
- `consent/ConsentRequestFixturesTest` (MockEngine, assert-only, rule 21): `consent-built-in.json`, `consent-optional.json` (es, one optional ticked) and `consent-custom.json` (operator copy with the organisation) are the bodies `FlowApiClient` sends with the hook's evidence; `index.json` lists each for `/api/v1/flow/consent`, `flowConsentBodySchema`, owner android-sdk-api.
- `ui/ConsentDigestScreenTest` (Robolectric): each of the 83 cases rendered through the real consent screen inside `OpenVerifyTheme` in its language, retention and organisation name shows the text (isolates removed, NFC asserted) whose SHA-256 is the case's; through `InquiryFlowScreen` and the coordinator in Arabic, the evidence sent is the digests of the texts shown, `built-in` and the catalog version; operator copy is shown with the organisation's name and sent as `custom`; a legal operator text naming the organisation without its name shows the unsupported screen and no agreement.
- `OpenVerifyInquiryActivityConsentTest`: the activity shows the session's operator copy with the organisation's name; a 422 `consent_text_mismatch` shows the retry screen, the retry reads the session and shows the consent again (3 requests: session, consent, session), and the log has `consent.text_mismatch` and no text.
- `flow/StateHooksTest` (its android-sdk-api case, replaced by its owner): the hook's evidence has a digest per key, `built-in`, and is what the coordinator hands to the API. `commonTest consent/ConsentEvidenceBodyTest`: its placeholder catalog version became `consentCatalogVersion()` (api-android-10a's follow-up); its assertions are unchanged.

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.consent.*' --tests 'dev.openverify.sdk.ui.ConsentDigestScreenTest' \
    --tests 'dev.openverify.sdk.OpenVerifyInquiryActivityConsentTest' --tests 'dev.openverify.sdk.flow.StateHooksTest'
37 tests completed, 25 failed           (rc=1, 116 s, load 0.67 -> 2.12)
FAIL ConsentTextTest (10 of 14), e.g. aBuiltInTextIsTheSdksOwnInTheChosenLanguage(): Expected value to be of type <ConsentText$Shown>, actual <ConsentText$Unavailable>
FAIL ConsentTextTest everyExportedDigestIsTheTextTheScreenShows(): expected: <> but was: <android-0.1.0-75ddea08ad090412>
FAIL ConsentDeviceLocaleTest [1..5]: ClassCastException: ConsentText$Unavailable cannot be cast to ConsentText$Shown
FAIL ConsentRequestFixturesTest consent-built-in.json (and the two others): FileNotFoundException
FAIL ConsentDigestScreenTest every Android row shows ...: could not find (TestTag = 'openverify-consent-text-consent.checkbox')
FAIL ConsentDigestScreenTest the coordinator sends the digests ...: expected:<ConsentEvidence(textSha256=[326366a7..., ...]> but was ...
FAIL ConsentDigestScreenTest operator copy is shown, named custom ...: expected:<[Example Verification Ltd asks you ...]> but was:<[To confirm your identity, ...]>
FAIL ConsentDigestScreenTest an operator's legal text naming the organisation without its name ...: could not find 'This step is not available here...'
FAIL OpenVerifyInquiryActivityConsentTest (both): ComposeTimeoutException
FAIL StateHooksTest android-sdk-api - the consent hook reports the digests ...: expected: <3> but was: <null>
```

### GREEN `8a12c2e9`

- `CONSENT_TEXT_RESOURCES`: the key map's entries with a flow key and a `consent` or `notice` mark (`SDK_COPY_KEYS` with `COPY_KEY_RULES`), the eight of the server's table.
- `consentText(key, language, copy, defaultLanguage, values)`: `OperatorCopy.forResource` (android-logic's, `{name}` filled, display isolated), else the SDK's own text from the generated table (`sdkStringIn`) with each `{{name}}` filled in one pass; any value missing, or an operator's legal text that cannot be filled, is `Unavailable`.
- `consentCatalogVersion()`: computed once from the SDK's own tables as `exportConsentTexts` computes it (`<locale>\t<flow key>\t<SHA-256>\n`, locales en, es, fr, de, ar, flow keys sorted): `android-0.1.0-75ddea08ad090412`, the version of the committed rows.
- `consentEvidence`: the digests through android-logic's `Sha256.hexOfUtf8` over each logical text, `custom` / `built-in` / none when mixed, the catalog version; `NONE` when a text is unavailable.
- `ConsentScreen`: every text, the agreement's label and the optional texts through `consentText` in `LocalSdkLanguage` (else its `openverify_locale`), with `LocalSessionLook`'s copy, default language and organisation, and the state's retention; the title and Continue take the operator's words when the copy has them; a required text or the label that is unavailable shows `UnsupportedScreen` (close cancels); the saved state is still exactly `agreed` and `ticked`.
- The activity gives `OpenVerifyTheme` the session's look (`SessionLook.of` the last session the scope saw), `InquiryLaunchScope.language` (the selector's choice, in memory, kept across a rotation) and `themeAssets` (the observed API's `fetchThemeAsset`).
- `ObservedFlowApi.acceptConsent`: a 422 `consent_text_mismatch` is logged as `consent.text_mismatch` and rethrown as a conflict, which the coordinator shows as the retry screen whose retry reads the session (see the contract deviation).
- Existing tests changed (rule 12): `ConsentScreenTest`'s optional-text assertion expects the days isolated in the displayed text (C199.5); `OpenVerifyInquiryActivityConsentTest`'s two texts (new in RED) expect the organisation's name isolated.
- The three request fixtures written by `UPDATE_CONTRACT_FIXTURES=1 ./gradlew ... --tests 'dev.openverify.sdk.consent.ConsentRequestFixturesTest'` (rc 0, 48 s), Prettier-clean (`pnpm exec prettier --check contracts/fixtures/flow-requests/android/consent-*.json`, rc 0); `pnpm --filter @openverify/api exec vitest run src/routes/flow/flow-requests.android.test.ts --coverage.enabled=false`: rc 0, 6 tests ("parses every committed fixture with its route schema").

```
$ ./gradlew ... --tests 'dev.openverify.sdk.consent.*' --tests 'dev.openverify.sdk.ui.Consent*' --tests 'dev.openverify.sdk.OpenVerifyInquiry*' --tests 'dev.openverify.sdk.flow.*' \
    --tests 'dev.openverify.sdk.events.*' --tests 'dev.openverify.sdk.privacy.*' --tests 'dev.openverify.sdk.ui.InquiryFlowScreenTest' --tests 'dev.openverify.sdk.i18n.*'
616 tests completed, 4 failed           (rc=1, 140 s: the three fixtures not written yet; the activity's copy test looked for the name without its isolates)
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest      (after the fixtures and the test's isolates)
rc=0, 1,930 tests, 0 skipped, 102 s (load 2.06 -> 2.81)
```

### Checkpoint 3 gate (the final gate), at `8a12c2e9`

| Step | Call | Exit | Wall (lock wait) | Load before -> after |
|---|---|---|---|---|
| (a) | `:openverify-sdk:testAndroidHostTest` | 0: 1,930 tests, 0 failed, 0 skipped | 102 s (0 s) | 2.06 -> 2.81 |
| (b) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | 0 | 36 s (0 s) | 2.07 -> 2.78 |
| (c) | `koverVerify checkKotlinAbi` | 0 | 55 s (0 s) | 2.78 -> 4.97 |
| (d1) | `testDebugUnitTest assembleDebug` | 0 | 31 s (0 s) | 4.97 -> 5.08 |
| (d2) | `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 66 s (0 s) | 5.08 -> 5.42 |
| (e1) | `:openverify-sdk:assemble` (iOS klibs rebuilt 00:50:07, after `ConsentScreen.kt` 00:41:07) | 0 | 46 s (0 s) | 3.02 -> 4.95 |
| (e2) | `lint` | 0 | 125 s (0 s) | 4.95 -> 4.19 |
| (f) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 26 s (0 s) | 4.19 -> 4.21 |

`pnpm format:check`: rc 0, 100 s (load 3.08 -> 1.47). The zod parse test: rc 0, 6 tests, 3 s.

## Host-test counts

1,796 at the base (`9286d0df`), 1,849 at checkpoint 1, 1,899 at checkpoint 2, 1,930 at checkpoint 3; none removed, none skipped. android-sdk-api's tests rewrote `OpenVerifyInquiryOneTimeLinkTest` (the same cases on the required API) and replaced StateHooksTest's android-sdk-api case; it added no Kover exclusion (`kover-excludes/android-sdk-api.txt` is still empty).
