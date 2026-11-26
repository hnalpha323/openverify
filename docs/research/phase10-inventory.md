# Phase 10 inventory (Workflow 10A Stage 1a, contracts-10a)

Taken on 2026-11-08 at the Phase 10 base `c60d51b987eea2d1163805bea343f842890c7e27`, with the 10A decisions commit `c7bc6f494ede085f9a1ca048d7f5f310be23ec64` above it (it adds only the plan's "## Orchestrator decisions before Workflow 10A"). Every claim names its `path:line` at the base. Drift from the plan is recorded in the plan's "## Workflow 10A Stage 1a amendments (contracts-10a)".

## 0. Preconditions

- `docs/PROGRESS.md:19` records Phase 9 **done** (2026-11-08, Workflows 9A–9D); the entry "2026-11-08: Phase 9 done (Workflow 9D: audit, review, fixes)" is the newest (`docs/PROGRESS.md:21`). The last Phase 9 push is `c60d51b9`.
- `git log` holds `c60d51b98` and `c7bc6f494`; `docs/plans/phase-10.plan.md:1055` holds "## Orchestrator decisions before Workflow 10A (2026-11-08)".
- **CI 42476248527 on `c60d51b9`** (read with `gh run view`, never re-run): 16 of 18 jobs green. The two failures are exactly the known items:
  - `infra`: "Install gitleaks for the pre-commit hook test" ended with `curl: (22) The requested URL returned error: 504` (GitHub's release host) — **KP10-2**.
  - `e2e`: the mocked suite passed (335 in 5.4 min); the full stack ran 182 passed and 1 failed, `tests/ui-a11y-focus.spec.ts:55` ("2.4.11: with a toast on screen, no focused control is covered", 6.3 s) — **KP10-1**; the console sweep did not run.
  - No other failure, so contracts-10a has no unassigned CI fix. Both items are carry-10a's.

## 1. The Starting point, re-verified

| Row | At the base | Drift from the plan's table |
|---|---|---|
| Build | `android/gradle/libs.versions.toml`: AGP 9.4.1 (:12), Kotlin 2.4.21 (:13), Kover 0.9.11 (:14), compileSdk/targetSdk 36 (:17-18), minSdk 26 (:19), JVM 21 (:20), Compose BOM 2026.06.01 (:25), activity-compose 1.13.0, kotlinx.serialization 1.11.0, coroutines 1.11.0, OkHttp 5.4.0, CameraX 1.6.2, Robolectric 4.17, lifecycle 2.9.4, CMP 1.11.1, CMP Material3 1.9.0, JetBrains lifecycle 2.9.6, Ktor 3.5.2. Gradle wrapper 9.8.2. `:openverify-sdk` applies `com.android.kotlin.multiplatform.library` with `iosArm64()` and `iosSimulatorArm64()` (`android/openverify-sdk/build.gradle.kts:47-48`); Kover's 80% line gate with CameraX glue excluded (`build.gradle.kts:146-178`). `lifecycle-viewmodel-compose` still in `androidMain` (`build.gradle.kts:70`). OkHttp is an `implementation` dependency (`build.gradle.kts:79`). | Pins unchanged. OkHttp moves to `api` in this Stage (C214.4). |
| Public API | `OpenVerifyInquiry` (`androidMain/.../OpenVerifyInquiry.kt:11`), `Request` a `data class` of three members (:22-35), `OneTimeLink` (:60-83), `fromOneTimeLink(url, apiBaseUrl: String? = null)` (:97-102), both contracts; `InquiryResult` with three kinds and 11 `FailureReason`s (`commonMain/.../InquiryResult.kt:6-67`). | — |
| Public surface | 167 explicitly `public` declaration lines in `commonMain` and `androidMain`, plus three top-level declarations with no modifier: `object Mrz` (`mrz/Mrz.kt:4`), `object BacKeySeed` (`mrz/BacKeySeed.kt:4`), `fun OpenVerifyTheme` (`ui/OpenVerifyTheme.kt:14`). The whole wire model (`model/`), `FlowApi` (`api/FlowApi.kt:28`), `FlowApiClient`, `FlowApiException`, `CapturedImage`, `CameraLens`, `DeviceSignals` (`signals/DeviceSignals.kt:15`) are public. The demo imports `OpenVerifyInquiry`, `InquiryResult`, `FailureReason`, `model.InquiryStatus` and `ui.OpenVerifyTheme` (`demo-app/src/main/kotlin/dev/openverify/demo/MainActivity.kt:32-33`). | The plan says 161; the base has 167 explicit lines and three defaults (the count is by declaration line, so it differs from an ABI count). |
| Flow rendering | `FlowCoordinator.kt` is 1,422 lines; it walks `session.flow.steps` with `FlowNavigator` (45 lines) and `JsonLogic` (102 lines). `model/Flow.kt`'s `known` map is at :439; `uploadAllowed` at `FlowCoordinator.kt:618`. `FlowMetadata.specVersion: Int` (`Flow.kt:37`). `OpenVerifyJson` has `ignoreUnknownKeys = true` (`model/OpenVerifyJson.kt:10`). | As the 10A decisions say (1,422; :439; :618). |
| Strings | 312 `<string>`/`<plurals>` entries in seven files of `composeResources/values/`: `strings.xml` 119, `strings_business.xml` 28, `strings_crypto_wallet.xml` 25, `strings_document.xml` 33, `strings_form.xml` 34, `strings_otp.xml` 48, `strings_retry.xml` 25; `values-es/` has the same seven files and counts. The six `strings_<area>.xml` files predate the key map: none is key-mapped. 169 `stringResource`/`pluralStringResource` call lines in twelve main files. | Matches the decisions (312, seven files). |
| Theme | `OpenVerifyTheme(darkTheme = isSystemInDarkTheme())` over Material 3's default schemes (`ui/OpenVerifyTheme.kt:14-22`). | — |
| Tests | 70 files under `androidHostTest` (65 with tests), 674 `@Test`, 55 `@ParameterizedTest`, 12 `@TestFactory`; 16 `commonTest` files, 4 `iosTest`. Host tests at the base: **1,366** run, 0 skipped, 0 failed (`./gradlew :openverify-sdk:testAndroidHostTest`, 15 s from the build cache, load 0.10). CI floor 1,366 (`.github/workflows/ci.yml:450-468`). | Floor 1,366 as the decisions say. |
| `User-Agent` | `FlowHttp.SDK_VERSION = "0.1.0"` (`api/FlowHttp.kt:117`), `OpenVerify-$PLATFORM_NAME/$SDK_VERSION` (:120). | — |

## 2. Phase 9 as built

### 2.1 The session (`packages/contracts/src/flow-api.ts:115-171`)

Every Phase 9 member is optional (`flow-api.ts:149`):
- `position` (`flowSessionPositionSchema`, :48-53): `step-id` (nullable), `state` (`active`, `waiting`, `halted`, `ended`, :47), `previous-step-id` (nullable), `retry-after-ms` (0–30,000, optional).
- `step` (`clientStepViewSchema`, `packages/flow-spec/src/v2/schemas/client-view.ts:41-58`), built by `clientViewOf` (`packages/flow-spec/src/v2/client-view.ts:16-31`); sent only to a client that declared spec 2.
- `values` (`flowSessionValueSchema`, :59-66): string, number, boolean, null, string list, or `{set: true}`.
- `theme` (`flowThemeSchema`, `packages/contracts/src/flow-theme.ts:91-101`): `theme-set-id`, `revision`, `mode` (`light`, `dark`, `auto`, :86), `light` and `dark` (the twelve tokens of :12-25, `#rrggbb`), `radius` (0–24), `font` (`system` or `uploaded` with `asset-id`, each with `platforms`), `logo` (`asset-id`, `alt-key`, `decorative`), `placement` (`header` only, :87).
- `copy` (`templateCopySchema`, `packages/contracts/src/template-fields.ts:107-112`): `messages` by locale.
- `locales` `{enabled, default}` (:157-162), over `BUILT_IN_LOCALES` (`packages/flow-spec/src/locale-review-status.ts:9`).
- `embed` (:164), `completion` `{redirect-url}` (:166), `spec-version` (1 or 2, :168), `links` `{help-url, privacy-url}` (:170, 9B).
- Earlier members: `signals` (:132, Phase 7), `handoff` (:137), `handoff-context` (:139, `handoffContextSchema`, `handoffs.ts:81-89`), `decision-contest-route` (:144, `flowDecisionContestRouteSchema`, `decisions.ts:256-269`), `face-template-retention-days` (:127), `environment` (:122).
- **No `organization-display-name`** member at the base: Phase 9's P5 before 9D deferred it (10A decision 6).
- The session builder is `getFlowSession` in `apps/api/src/services/flow.ts:200-307`; the engine's members come from `flowSessionMembers` (`apps/api/src/flow-engine/session.ts:235-297`, `locales` :279, `links` :280, `spec-version` :296).

### 2.2 Client views per step type (from the zod shapes)

| Type | Members |
|---|---|
| `consent` | id, type, textKeys, optionalTextKeys, required |
| `government_id` | id, type, sides, allowedCountries, allowedIdClasses, maxAttempts, captureMethods, captureMethodsByDevice |
| `selfie` | id, type, poses, liveness, maxAttempts |
| `document` | id, type, documentTypes, captureMethods, maxAttempts, captureMethodsByDevice |
| `phone_otp` | id, type, allowedCountries, codeLength, allowVoip, maxAttempts |
| `email_otp` | id, type, codeLength, maxAttempts |
| `database` | id, type, fields, requiredFields, maxAttempts |
| `aamva` | id, type, source, maxAttempts |
| `nfc` | id, type, androidOnly, maxAttempts (no `fallbackAvailable` until 10C) |
| `crypto_wallet` | id, type, chains, signing, maxAttempts |
| `database_business` | id, type, collectAssociatedPersons, maxAttempts |
| `business_website` | id, type, maxAttempts |
| `device_handoff` | id, type, methods, qrTtlSeconds, linkTtlSeconds, confirmationCode, skipOnMobile, allowContinueHere |
| `completion`, `failure` | id, type, messageKey |
| `screen` | id, type, components (1–40, `FLOW_V2_CAPS.componentsPerScreen`) |

Components (`packages/flow-spec/src/v2/schemas/components.ts`, the 22 `COMPONENT_KINDS` of :325-348): every one has `id`, `visibleWhen`, `enabledWhen`; the form ones add `field`, `labelKey`, `hintKey`, `required`; `text` (variant, copyKey), `image` (assetId, altKey, decorative), `spacer` (size), `container` (direction, children), `footer` (children), `stepper` (labelKeys, current), `text_input`/`text_area`/`masked_text` (minLength, maxLength, pattern), `number` (min, max), `date` (min, max as ISO dates), `email`, `url`, `checkbox`, `phone` and `country_select` (allowedCountries), `select`/`radio_group`/`multi_select`/`checkbox_group` (options of `{key, value, labelKey}`), `address` (labelKey, hintKey, required, fields {street1, street2, city, subdivision, postalCode, country}, allowedCountries), `button` (labelKey, action `submit`/`cancel`/`link`, port, link `help-url`/`privacy-url`). **No component has a `style` member**: per-component style overrides are dormant (10A decision 4, K9-4), and `flow-spec-members.json` records the member as absent.

### 2.3 Members added after Phase 9's spec 2, classified (C194.4)

- `links` (session, Workflow 9B, `flow-api.ts:170`): **not appearance-only**. It is the help and privacy links shown in the fixed slot (C162.3); without it the person is not offered the privacy link. Added within spec 2 before C151.7's Phase 10 amendment; recorded as such, and honoured by the SDK (C197.4).
- `organization-display-name` (session, added by this Stage, 10A decision 6): **not appearance-only**. It fills `{organization}` in operator copy; a client without it cannot show a custom text that names the organisation. It is additive within spec 2 by the 10A decisions because no built-in text uses it and a client that cannot fill a placeholder shows the text unsupported (C199.6), never a different text.
- No client-view or component member was added after 9A's spec 2 (`git log e56e4e9c..c60d51b9 -- packages/flow-spec/src/v2/schemas/{components,client-view,steps}.ts` shows only 9A's Stage 1a commits `b66b540e`, `967711f9` and `376cff7f`).

### 2.4 Negotiation, routes

- `OpenVerify-Flow-Spec` is `FLOW_SPEC_HEADER` (`packages/contracts/src/flow-embed.ts:17`), parsed by `parseFlowSpecHeader` (:20-27): absent means `[1]`; the session route reads it and answers the version served in the same header (`apps/api/src/routes/flow/index.ts:247-270`). CORS allows and exposes it (:210-211). `FLOW_SPEC_VERSIONS = [1, 2]` (`packages/flow-spec/src/v2/schemas/versions.ts:9`).
- Screen submission: `POST /api/v1/flow/screens/:stepId/submit` (`routes/flow/screens.ts:27`), body `submitFlowScreenBodySchema` `{values, button?}` (`flow-embed.ts:43-62`), answering the session.
- Selfie-capture extension: `POST /api/v1/flow/selfie-captures/:id/extend` (`routes/flow/index.ts:463`, `flow-embed.ts:72`), answering the selfie capture.
- Theme assets: `GET /api/v1/flow/theme-assets/:id` (`routes/flow/theme-assets.ts:36`, `flow-embed.ts:75`), the bytes of an asset of the session's environment (R002, carry-10a, narrows it to the session's theme).
- Problems the driver meets (golden fixtures in `contracts/fixtures/problems/flow-engine/`): `flow_step_not_current`, `consent_text_mismatch`, `selfie_capture_not_extendable`, `field_unknown`, `field_write_once`, `fields_too_large`. `ContractFixturesTest` read only `problems/` and `problems/flow/` at the base (`ContractFixturesTest.kt:296-327`).

### 2.5 Copy, locales, consent texts

- `COPY_KEYS` (`packages/flow-spec/src/v2/copy-keys.ts:71-91`): 20 keys; legal marks `consent` (consent.biometric, .biometric-matching, .processing, .device-recognition, .automated-decision, .checkbox) and `notice` (notice.session-integrity, notice.device-recognition). **No key for the SDK's three optional-consent checkbox labels and no app-wording notice key** (C199.1 additions, made by this Stage, §6).
- `LOCALE_REVIEW_STATUS` (`packages/flow-spec/src/locale-review-status.ts:35-42`): `en` source, `es`, `fr`, `de`, `ar` machine-drafted.
- The web catalogs are `apps/flow/src/i18n/locales/{en,es,fr,de,ar}.ts`; the exporter `apps/flow/scripts/export-flow-locales.ts` (the `i18n:export` script, `apps/flow/package.json:13`) runs `exportFiles` of `apps/flow/src/i18n/locale-export.ts:162`, which writes `contracts/fixtures/i18n/<locale>.json` (`{locale, catalog-version, catalog-sha256, review-status, messages}`) and appends to `consent-texts.json` (`appendConsentTexts`, :112) every text of the `consent` and `notice` groups under `client: 'web'` (`CONSENT_TEXTS_CLIENT`, :35). Its test is `apps/flow/src/i18n/locale-export.test.ts`. At the base the catalog version is `web-03a9d4e06ed93f3e`.
- The digest check is `checkConsentTextsInTx` (`apps/api/src/services/templates/consent-texts.ts:74`): every released entry of the key and locale is a candidate, **whatever its `client`** (:44-55, :112-120), its `{{name}}` placeholders filled (:60-66) with `days` and `organization` (`organization-display-name`, :103-105), NFC-normalised and hashed (:57-58). Android rows therefore need no change of the check; api-android-10a adds only its Testcontainers test.

### 2.6 Logic with golden cases

- Pattern matcher: `packages/flow-spec/src/v2/pattern/` (`parse.ts`, `vm.ts`, `limits.ts`), golden cases in `pattern/vectors.json` with `pattern.test.ts`.
- Visibility: `packages/flow-spec/src/v2/visibility.ts` with `visibility.test.ts`.
- Digits: `packages/flow-spec/src/v2/digits.ts` (18 lines) with `digits.test.ts`.
- Built-in palettes: `packages/ui/src/styles.css:21-34` (light) and :41-55 (dark, `data-openverify-variant='dark'`); the contrast gate's `BUILTIN_PALETTES` is in `packages/core/src/contrast/`.
- Projection fixtures: `contracts/fixtures/flows/v2/` (9 flows) and `contracts/fixtures/api/flow-projections/` (16 files, a directory `Fixtures.list("api")` does not descend into). `FlowCoordinatorProjectionTest.kt` exists (317 lines, decision 73).

### 2.7 The session's language (C193.9, D2)

`GET /api/v1/flow/session` takes no query and no language header (`apps/api/src/routes/flow/index.ts:247-270`). The engine's `session.locale` is the latest consent's `locale` (`apps/api/src/flow-engine/scope.ts:266`), which the consent body's `locale` sets for every client (`packages/contracts/src/flow-api.ts:186`). **That is the mechanism** (10A decision 5): no `language` query is frozen, no migration.

## 3. Phase 7 as built (Android)

- `FlowSignals`, `AndroidIntegritySignals`, `AndroidRecognitionSignals`, `FlowSessionSignals`, `FlowHandoff` in `commonMain/.../model/FlowSignals.kt:14-75` (`@EncodeDefault platform`, :49). `FlowSession.signals` and `.handoff` (`model/Resources.kt:259-262`); `handoff-context` is not modelled (ignored).
- `FlowApi.sendSignals` with an empty default (`api/FlowApi.kt:116`); `FlowApiClient.sendSignals` (`api/FlowApiClient.kt:92`); `OneTimeLinkFlowApi` delegates (`api/OneTimeLinkFlowApi.kt:61`). `sendSignalsBeside` (`flow/FlowCoordinator.kt:486-500`), called after a consented load (:454) and after consent (:466).
- `DeviceSignals` and `DeviceSignals.None` are **public** at the base (`signals/DeviceSignals.kt:15`, :24). This Stage makes both internal (C210.1, review F30). `AndroidSignalContract` is internal (`signals/AndroidSignalContract.kt:10`).
- The signal registry: `packages/core/src/signal-registry.ts` (`SIGNAL_LAYERS` :23, `SIGNAL_TIERS` :38); `SIGNAL_NULL_REASONS` and `ON_NULL_DEFAULTS` in `packages/contracts/src/signals.ts:40` and :135.
- K7A-6's hint-less failure wait is `Resolution.Finalize` (`FlowCoordinator.kt:668-671`, :714-717; handled at :525); K7A-7's `next-sequence` is `FlowSessionSignals.nextSequence` (`FlowSignals.kt:37`).
- **The handoff skip.** `skipsHandoff` (`apps/api/src/services/handoff/steps.ts:94`) skips every session with `mobile-sdk-name`, but only `flowSessionHandoffOf` (`services/handoff/flow-session.ts:45`, called from `services/flow.ts:257`) uses it, to serve the state `skipped`. Nothing in `apps/api/src/flow-engine/` calls it: the engine leaves a `device_handoff` step only on `continued-here` or `redeemed` (`flow-engine/exits.ts:100-104`), so an SDK session at such a step stays there and receives its client view. C221.13's engine change is **required** (10A decision 7).

## 4. Paths of the borrowed edits

- api-android-10a (C221.12, C221.13, C200.3):
  - the flow session route: `apps/api/src/routes/flow/index.ts:247-270`;
  - the session builder that serves `organization-display-name` (D3): `apps/api/src/services/flow.ts:200-307` (`getFlowSession`'s return object);
  - the organisation settings service that saves the display name: `apps/api/src/services/settings.ts` (`organization-display-name` is a per-environment setting, :74 and :159), whose schema is `organizationDisplayNameSchema` (`packages/contracts/src/handoffs.ts:72`, used by `dashboard-api.ts:491` and :587);
  - the consent digest check: `apps/api/src/services/templates/consent-texts.ts:74-121` (no change needed for Android rows, §2.5);
  - the engine's `device_handoff` skip: `apps/api/src/flow-engine/engine.ts` (`enter` :189, `apply` :362, `moveOn` :313), with the reporting session's facts of `flow-engine/scope.ts:240-266` and `skipsHandoff` of `services/handoff/steps.ts:94`;
  - Phase 9's locale exporter: `apps/flow/src/i18n/locale-export.ts` and `locale-export.test.ts` (`apps/flow/scripts/export-flow-locales.ts` runs it).
- integration-10a (C221.9): the preview's differences are the banner, `apps/dashboard/src/components/flow-preview/preview-banner.tsx` with `apps/dashboard/src/lib/copy/preview.ts:20-29`; no console view or API serves a consent record's `client` or digests (D4), so that label is carried.
- api-android-10a's own test paths fit the tree: `packages/flow-spec/src/export-vectors.test.ts`, `packages/ui/src/export-palettes.test.ts` (`packages/ui/src/` exists), `apps/api/src/services/templates/consent-texts.android.test.ts`, `apps/api/src/routes/flow/flow-requests.android.test.ts`.

## 5. Spike (a): a per-composition locale in Compose Multiplatform 1.11.1 (C199.4)

Run in a discarded scratch worktree (`git worktree add --detach /tmp/spike-a-contracts10a`), each call under the Gradle lock (no wait, load 0.21 to 2.94):
- `org.jetbrains.compose.resources.LocalComposeEnvironment`, the `ComposeEnvironment` interface and `ResourceEnvironment`'s constructor are **Kotlin-internal** in `components-resources` 1.11.1: a host test that provides its own environment does not compile ("Cannot access 'val LocalComposeEnvironment': it is internal in file"; 54 s, exit 1). `LanguageQualifier` is `@InternalResourceApi`.
- The only public per-composition lever on Android, an overridden `LocalConfiguration` with `setLocales(LocaleList(es))`, **does not change** what `stringResource(Res.string.openverify_consent_continue)` resolves to: the node reads "Continue", not "Continuar" (70 s, exit 0, the test printed `[(Continuar, false), (Continue, true)]`). Resources follow the process locale.
- **Outcome: no public API.** android-theme implements `sdkString` and `sdkPlural` over generated per-locale tables with CLDR plural rules for the five locales, and `ResourcesTest` asserts both paths agree (C199.4's fallback). The JVM default and the host's configuration are never changed.

## 6. Desk check: NFCPassportReader (C207.3, review H22)

Read from the project's README and `Sources/NFCPassportReader/PassportReader.swift` on its default branch (no build):
- **External Active Authentication challenge: yes.** `readPassport(mrzKey:tags:aaChallenge: [UInt8]? = nil, skipSecureElements:skipCA:skipPACE:useExtendedMode:customDisplayMessage:)`; a `nil` challenge makes the reader draw 8 random bytes, a given one is sent in INTERNAL AUTHENTICATE.
- **MRZ key fields: yes.** `mrzKey` is the document number, birth date and expiry, each with its check digit (the README's example `12345678898012772508315`), which is `BacKeySeed.mrzInformation`.
- **CAN access: no.** PACE runs with the MRZ key only (`paceHandler.doPACE(mrzKey:)`, Generic Mapping only); no parameter names a card access number.
- The version read is the default branch, not a tag named 2.3.3, so 2.3.3's exact API is **unclear** too.
- **Result:** the seam's iOS fit is unverified for `ChipAccess.Can`. ADR 0009 says so, and `ChipReader` with its types carries `@ExperimentalOpenVerifyApi` until the iOS release.

## 7. What this Stage freezes (summary; the handoff names each exactly)

The public surface narrowed to C190.7's list with `android/openverify-sdk/api/expected-public.txt`; the string facade; `readContractFixture`; `FakeFlowServer`; the public API and seams; the wire models, `FlowState` variants, stubs and `StepRegistry`; `flow-spec-members.json`; the key map and review status shapes with the generated `strings_catalog.xml`; the exported files' names and schemas; `organization-display-name`.

## 8. Spikes (b) and (c) and the local gate (foundation-10a, Workflow 10A Stage 1b)

Run by foundation-10a in a discarded scratch worktree (`/tmp/fnd10a-base`), each Gradle call under the Gradle lock, the plugins resolved through the existing `pluginManagement`; the commands, timings and outputs are in `docs/tdd/phase10-foundation-10a.tdd.md`.

- **Spike (b), ABI validation (C214.2, review F23).** KGP 2.4.21's `abiValidation` covers `:openverify-sdk` on `com.android.kotlin.multiplatform.library`: `updateKotlinAbi` writes `api/android/openverify-sdk.api` (the Android target) and `api/openverify-sdk.klib.api` (the iOS klibs), `checkKotlinAbi` compares them. The Compose compiler's generated `ComposableSingletons$<File>Kt` classes and `$stableprop`/`$stableprop_getter` declarations are excluded by name, since they are not API and their names change with every composable. KGP does **not** cover an AGP 9 built-in-Kotlin `com.android.library` (`openverify-nfc`): its dump task gets no Android variant and `updateKotlinAbi` fails with "Cannot query the value of this provider". BCV 0.18.2's plugin registers nothing there either (it hooks only the `org.jetbrains.kotlin.android`, `.jvm` and `.multiplatform` plugins). BCV 0.18.2's own `KotlinApiBuildTask` and `KotlinApiCompareTask`, wired by hand over `compileReleaseKotlin`'s output, do cover it. So `$ABI_CHECKS` is `checkKotlinAbi` in both modules.
- **Spike (c), Roborazzi and accessibility checks (C212.2, C219.3).** Roborazzi 1.76.0's plugin applies on the KMP library plugin, and `captureRoboImage` works under `@GraphicsMode(NATIVE)`. Roborazzi's accessibility module runs Google's Accessibility Test Framework 4.1.1 under Robolectric: it fails a 10 dp unlabelled target (`SpeakableTextPresentCheck`, `TouchTargetSizeCheck`) and passes a labelled 48 dp one. Compose's own `enableAccessibilityChecks()` raises nothing under Robolectric, so it is kept for device tests only. Since the plugin's tasks drive `testAndroidHostTest`, which must exclude screenshots, the build uses Roborazzi's runtime libraries in a tagged `screenshotTest` task (C219.3's fallback), verify by default and record only with `-Proborazzi.test.record=true`, and the ATF checks run with every screenshot test on the host (C212.2's first route).
- **The local gate at the base.** Rule 17's six calls each fit 10 minutes with the 240 s lock wait (the longest, `:openverify-sdk:assemble lint`, 201 s from scratch); 1,416 host tests.

## 9. Workflow 10B (contracts-10b, Stage 1a; at 7d985a77 with c539508d, the 10B decisions bf3a87e3)

Line numbers are of `main` at the start of 10B Stage 1a unless a commit is named; `FlowCoordinator.kt` lines are after the known items (KP10-6 to KP10-11), which moved them.

**10A as built (re-verified).**
- Driver: `flow/ServerPosition.kt:45` `drives` (spec 2 and a position), `:48` `decided`, `:62` `render` (copy review, decided, requirement, then the position state); `flow/StepRegistry.kt:72` `renderers` (all 16 `CLIENT_STEP_TYPES`). The hooks in `flow/FlowCoordinator.kt`: `ServerPosition.drives` and `sendSignalsBeside` on a consented load (`:488-489`), `consentEvidence` (`:497`), `sendSignalsBeside` after consent (`:518`, defined `:553`), `SessionTheme.of` in `adopt` (`:1435-1439`); the uploads at `:817` (`uploadDocument`), `:1170` (a selfie pose, with `capture.upload(kind)`) and `:1253` (an ID side); the selfie protocol creates its capture at `:1141` (camera) and `:1192` (upload). Each 10A stub is replaced; `flow/StateHooksTest.kt` pins the owners' cases.
- `FlowState.Waiting` (`flow/FlowState.kt:125`, after the KP10-6 member), `Halted` (`:131`); `WaitingScreen` at `ui/StatusScreens.kt:223` (no `keepScreenOn` yet: KP10-13, foundation-10b).
- Events: `events/FlowEvents.kt:62` `FlowEventTracker`, `:146` `ObservedFlowApi` (its consent mapping removed by KP10-6); `InquiryLaunchScope` at `androidMain/.../InquiryViewModelFactory.kt:89`, which now also holds `screenAssets` (KP10-11).
- Screens' environment: `ui/screen/ScreenEnvironment.kt:59` `screenEnvironmentOf(session, language, asset, drafts)`; the activity provides it (`OpenVerifyInquiryActivity.kt`, `asset = { id -> assets?.asset(id) }` since KP10-11).
- Seams (public, `expected-public.txt`): `face/FaceDetector.kt:11` `FaceDetectorFactory`, `:21` `FaceDetector : AutoCloseable` (`suspend detect(input: FloatArray, width, height): YunetOutputs`), `:32` `YunetOutputs`; `integrity/IntegrityTokenProvider.kt:16` `IntegrityTokenProvider { suspend token(requestHash): String? }`; delivered by `OpenVerifyComponents.kt:30-38` (`chipReader`, `faceDetectorFactory`, `integrityTokenProvider`, `eventListener`, `transport`, `sandboxSignalOutcome`), read once per launch through `OpenVerifyAndroid.installed()`. No 10A code reads `faceDetectorFactory` or `integrityTokenProvider` (C191.3: 10B reads them).
- Camera: `camera/CaptureCamera.kt:11` `internal interface CaptureCamera` (no `frames()` before 10B's (C)); `androidMain/.../camera/CameraXCaptureCamera.kt:61` binds `Preview` and `ImageCapture`; fakes `androidHostTest/.../ui/UiTestDoubles.kt:24` `FakeCaptureCamera`; device test `androidDeviceTest/.../camera/CameraXCaptureCameraTest.kt:32`.
- Multipart writer: `api/FlowApiClient.kt:155` `uploadFile(verificationId, kind, image, capture)` writes `kind`, the C40.3 capture fields and the file; `:177` `uploadDocument` writes `kind` and the file; neither writes `capture-method` (C206.1; 10B decisions item 7), which the server takes since 9A (`apps/api/src/services/flow.ts:509`, stored as `files.capture_method`).
- `FlowApi.extendSelfieCapture` (`api/FlowApi.kt:137`) answers `FlowSelfieCaptureExtension(id, expiresAt)` (`api/SelfieCaptureExtension.kt:8`); `FlowApiClient.kt:127` builds it.
- Strings: `sdkString`/`sdkText`/`sdkPlural` (`i18n/SdkStrings.kt`); the per-locale tables are a build output since KP10-5 (`generateSdkStringTables`, `build/generated/openverify/sdkStringTables/…`; `SdkStringTablesTest`). `strings_<area>.xml` per owner in five folders. `i18n/key-map.json` holds 26 entries after KP10-8/KP10-10 (was 19); `SDK_COPY_KEYS` in `i18n/OperatorCopy.kt`; `generateLocaleStrings` writes `strings_catalog.xml` (run alone); `i18n/review-status.json` lists every SDK string with its file.
- Members: `flow-spec-members.json` with `contracts/fixtures/flow-spec/client-view-members.json` (written by `packages/contracts/src/client-view-members.export.test.ts`).
- ABI: `api/android/openverify-sdk.api`, `api/openverify-sdk.klib.api`, `api/expected-public.txt`, `AbiDumpTest` (a sixth case since KP10-12: no kotlinx-serialization type in any dump).
- Goldens: `testing/Goldens.kt:14` `GoldenOwner` {FOUNDATION, DRIVER, SDK_API, SCREENS, THEME}; folders under `src/androidHostTest/screenshots/` (`android-driver/`, `android-sdk-api/` empty); 10B's four owners join through foundation-10b (10B decisions item 10).
- Kover: `kover-excludes/<owner>.txt` (seven files); `CameraXCaptureCamera*` excluded in the build file itself.
- Logs and scans: `log/SdkLog.kt` (constant codes), `privacy/LogScanTest`, `privacy/DataAtRestScanTest`.
- Requests: `contracts/fixtures/flow-requests/android/index.json` (10A's entries, `index.schema.json`), parsed by `apps/api/src/routes/flow/flow-requests.android.test.ts`; `packages/contracts/src/phase10a-contracts.test.ts`.
- Gate: rule 17's eight calls; lockfiles `android/{openverify-sdk,openverify-nfc,demo-app}/gradle.lockfile`, `android/settings-gradle.lockfile`; `android/gradle/verification-metadata.xml` (written from a cold home since `c539508d`); the SDK host-test floor `.github/workflows/ci.yml:466` (1934).

**Phase 7's signals as built.** Route `apps/api/src/routes/flow/signals.ts`, service `apps/api/src/services/signals/flow-signals.ts` (`keptSignals` :55, `recordFlowSignals` :100); `collectionTiersOf` at `apps/api/src/services/signals/flow-session.ts:59`; the job `apps/api/src/jobs/signals/process.ts`; `computeInquirySignals` at `packages/checks/src/signals/compute.ts:539`; the registry `packages/core/src/signal-registry.ts` (`SIGNAL_REGISTRY` :338, entry builder `signal()` :311, `bot_score` :339 v2 inputs `integrity, behaviour, request-headers`, `automation_artefact_count` :366 R-tier inputs `integrity`); `SIGNAL_NULL_REASONS` (`packages/contracts/src/signals.ts:40`), `SIGNAL_EVIDENCE_REASONS` (:82), `ON_NULL_DEFAULTS` (:135), mirrored in `packages/checks/src/signals/vocabulary.ts`; the console's words `apps/dashboard/src/lib/signal-words.ts`. The wire: `flowSignalsSchema` (`packages/contracts/src/flow-signals.ts:160`) with Android's `android-integrity` (`flowAndroidIntegritySignalsSchema` :147: `debugger-connected`, `app-debuggable`), never `integrity.android`; `SESSION_INTEGRITY_NOTICE_TEXT_KEY` (:315). `signalConfigPublishProblems` in `apps/api/src/services/publish/signal-config.ts`. The SDK's signals: `commonMain/.../signals/{DeviceSignals.kt (collect :20, not suspend at the base), AndroidSignalContract.kt}`, `androidMain/.../signals/AndroidDeviceSignals.kt`, `iosMain/.../signals/IosDeviceSignals.kt`.

**Phase 5 providers (C63).** `apps/api/src/providers/index.ts:121` `PROVIDER_KINDS` (camelCase kinds, per-phase lists such as `PHASE7_PROVIDER_KINDS` :112, `PROVIDER_ENV_PREFIXES` :133), `providers/sandbox.ts`, the bindings read in `apps/api/src/config.ts` (production refuses a sandbox binding). The device-integrity kind is named `deviceIntegrity` (env prefix `OPENVERIFY_PROVIDER_DEVICE_INTEGRITY`) to fit that table.

**Named for the later agents.**
- Compliance guide: `docs/compliance/` holds only `automated-decisions.md`; integration-10b writes **`docs/compliance/session-integrity.md`** (the strictly-necessary template with C210.1's probe list), linked from `docs/checks/signals.md` (orchestrator decision 10B D4 (a)).
- Computation files (api-integrity): `packages/checks/src/signals/` (a new `device-integrity.ts` beside `compute.ts`), the registry entries' declarations in `packages/core/src/signal-registry.ts` (this Stage).
- Session-response builder: `getFlowSession` (`apps/api/src/services/flow.ts:205`; the theme at :273, `organization-display-name` at :313); foundation-10b adds the `integrity` member's hook there.
- Publish checks: `packages/flow-spec/src/v2/analyses.ts` (`isHeuristic` :462, `checkBranchAcknowledgements`), compared in `apps/api/src/services/publish/flow-v2.ts`; Phase 8's `packages/workflow-engine/src/graph/analysis.ts` (`heuristicSteps` :50, :348, :389) and `apps/api/src/workflows/publish/rules.ts` (`isAdverse` :104, `checkAdverseSteps` :189).
- Upload service: `uploadFile` in `apps/api/src/services/flow.ts:560` writes the `files` row (`capture-method` at :509).
- Migrations: `packages/db/drizzle/`; the last is `0032_phase9d.sql`, so 10B's one migration is **`0033`**.
- Outbound client: `createOutboundHttp` (`apps/api/src/http/index.ts:398`); the decode runs in a job (`integrity-decode`, foundation-10b).
- Rate policies: `apps/api/src/plugins/rate-limit.ts` (`flow-session` at :199); `flow-integrity` joins there (foundation-10b).
- Identifiers: `packages/contracts/src/ids.ts:11` and `packages/db/src/ids.ts:8` (`ich` joins both, with `packages/db/src/ids.test.ts`).

**The session's `integrity` member** is **not appearance-only** (C194.4; Phase 9 C151.7 as amended): it changes what the device does (a challenge and a token call to Google's service through the host's provider), so a client that ignores it would silently skip a collection the operator asked for; `flow-spec-members.json` treats it `honoured` (its member `request` too), and the SDK decodes it.

## 10. Workflow 10C (contracts-10c, Stage 1a; at f71b0f6d with the 10C decisions 4e2a0c32)

Taken on 2026-11-10. Paths and lines are as contracts-10c left them at its last checkpoint, so they include what Stage 1a added.

### 10.1 Preconditions

- `docs/PROGRESS.md` holds "Phase 10, Workflow 10B done"; `git log -1 -S "Phase 10, Workflow 10B done" -- docs/PROGRESS.md` answers `f71b0f6d89fb428117d61e503a872f4ad3a6999c`, which `origin/main` contains; `4e2a0c32` is in the log and the plan holds "## Orchestrator decisions before Workflow 10C (2026-11-10)" (`docs/plans/phase-10.plan.md:1401`).
- **CI 42762952128 on `f71b0f6d`** (read with `gh run view`, never re-run): 17 of 18 runs green. The one failure is `android-instrumented (emulator)`, on two device tests, both known items of carry-10c: `the barcode side is read at 1,280 px when the camera has it: 640x480, largest (1856, 1392)` (KP10-21) and `the probes took 520.0 ms, over the 500 ms bound` (KP10-22). No other job or test failed, so contracts-10c had no CI fix of its own. No run of a later commit exists, and none is waited for (rule 28).
- **Owner items** (`docs/plans/phase-10.plan.md:1067-1073`; no later section changes them): P1 granted narrowly, P2 granted narrowly, P3 declined, P4 pending (group `dev.openverify`, provisional), P5 declined.

### 10.2 10A and 10B as built, where 10C hooks in

| What | Where |
|---|---|
| The driver's step resolution, and the NFC hook in it | `flow/FlowCoordinator.kt:708` (`resolve`), `:729` (`is NfcStep`) |
| The single-use 409 rule of C193.5 | `flow/FlowCoordinator.kt:1495` (`failed`), `:1504` (`readAndRender`) |
| The NFC step's controller, made by the coordinator | `flow/FlowCoordinator.kt:1471`, `:1488` (`nfc(event)`), constructor parameter `nfcEnvironment` at `:128` |
| `FlowState.Nfc` | `flow/FlowState.kt:139` |
| The registry, and the client step types | `flow/StepRegistry.kt:78` (`nfc` runs), `:98` (`CLIENT_STEP_TYPES`) |
| The exhaustive dispatch | `ui/InquiryFlowScreen.kt:138` |
| The actions' NFC entry | `ui/FlowActions.kt:119`, `InquiryViewModel.nfc` |
| The observed API (an accepted chip submit is a submission) | `events/FlowEvents.kt:179` |
| `FlowApi`'s NFC signatures, and their delegation | `api/FlowApi.kt:168`, `api/FlowApiClient.kt:156` |
| `NfcStep` and its serializer entry | `model/Flow.kt:227`, `:515`; the other wire models in `model/Nfc.kt` |
| `NfcPlatform` | `nfc/NfcPlatform.kt:21`; the actuals in `androidMain/.../nfc/NfcPlatform.android.kt` and `iosMain/.../nfc/NfcPlatform.ios.kt` |
| The launch's wiring | `androidMain/.../InquiryViewModelFactory.kt:85`, `OpenVerifyInquiryActivity.kt:75` |
| The chip seam (10A) | `chip/ChipReader.kt:22` (`ChipReader`), `:107` (`ChipReadException`); `@ExperimentalOpenVerifyApi` marks `read` and the value types, not the interface |
| `KeepScreenOn` (10B), which nfc-sdk calls from the tap screen | `ui/KeepScreenOn.kt:12` |
| `GoldenOwner.NFC_SDK` | `androidHostTest/.../testing/Goldens.kt:28` |
| The boundary check and its extension point | `android/openverify-sdk/build.gradle.kts:331` |
| The request fixtures' table and parse test | `contracts/fixtures/flow-requests/android/index.json` (25 entries, 12 of them 10C's), `apps/api/src/routes/flow/flow-requests.android.test.ts` |

Unchanged from 10B and re-read: `BacKeySeed` (`mrz/BacKeySeed.kt`: the document number, and both dates as YYMMDD), `Mrz.kt`, the string facade with `generateSdkStringTables`, `key-map.json` (27 entries), `review-status.json`, `SdkLog`, the source scans with their allowlists, `AbiDumpTest` over `api/expected-public.txt`, `screenshotTest` (60 tests over 59 goldens), `stackTest`, the SDK manifest (INTERNET, CAMERA, HIDE_OVERLAY_WINDOWS; no NFC), and `docs/android/` (eight pages).

### 10.3 Phase 5's chip routes and services

- `apps/api/src/routes/flow/government-id-nfc.ts`: `POST /verifications/:id/chip-challenges` over `services/chip-challenges/create.ts`. A challenge is taken on an `initiated` verification of type `government_id_nfc` after consent (`requireFlowVerification`), whether or not a file exists. The count is checked at `create.ts:133`: the request that finds ten challenges cancels the verification and answers 409 `chip_challenge_invalid`.
- `services/chip-challenges/chip-files.ts`: the latest upload of each kind counts; DG1, DG2, DG14 and DG15 with the SOD, card security, card access and COM are the eight kinds (`packages/contracts/src/files.ts:49-58`), DG2 at most 1 MiB and the others 64 KiB (`files.ts:196-210`).
- **C207.2 confirmed.** `services/chip-challenges/challenge-before-upload.integration.test.ts` (Testcontainers, Postgres 17): a challenge taken on an `initiated` verification that holds no file is created and stays open; the files stored after it and the submit that names it are accepted (`submitted`).
- `apps/api/src/trust-anchors/sandbox.ts:26` (`installSandboxTrustAnchor`) is what `seed:dev` calls. **The house pattern for commands** is a thin `apps/api/scripts/<name>.ts` entry (some hold their logic, some sit over `src/`), named in `apps/api/package.json`; `trust:sandbox-utopia` follows it: `scripts/trust-sandbox-utopia.ts` over `src/commands/trust-sandbox-utopia.ts`.

### 10.4 Phase 9 where 10C hooks in

- `flowSessionMembers` (`apps/api/src/flow-engine/session.ts`) builds the step view at `:280` (`clientViewOf(current, flow)`) and calls `nfcSessionMembers` at `:287`. Its input holds no stored session; it gained `sessionId` and `environmentKind` (`:90`), which `getFlowSession` passes (`services/flow.ts:296-297`), so api-nfc reads the session's `mobile-sdk-name` itself.
- `advanceFlowInTx`'s `FlowExit` gained `client-unable` (`flow-engine/advance.ts:75`); its case is `flow-engine/exits.ts:84`.
- **The always-review rule needs no new settlement code path.** `flowOutcome` (`packages/flow-spec/src/v2/next-position.ts`) already sends a step left through `exhausted` without the note `fallback-continue` to review. What it lacks is a decided outcome for the step: a canceled attempt reads `pending`, and a completion with a pending step never settles. So the hook is in `decideOutcome` (`flow-engine/engine.ts:603`): `clientUnableStepOutcomes(record, outcomes)`.
- `leaveIfDecided` is at `engine.ts:494`; it takes `exhausted` only with no attempts left, which is why client-unable has its own exit.
- `ACKNOWLEDGEMENT_KINDS` (`packages/flow-spec/src/v2/analyses.ts:124`) and `TEMPLATE_ACKNOWLEDGEMENT_KINDS` (`packages/contracts/src/inquiry-template-versions.ts`) each gained `client-unable`; the console's words are in `apps/dashboard/src/lib/copy/flow-builder.ts`.
- The step record's `notes` is `text[]` with no format constraint (`packages/db/drizzle/0030_phase9a.sql:165`), so the client-unable note needs no migration: `FLOW_STEP_NOTES.clientUnable` with `CLIENT_UNABLE_NOTE_PREFIXES`.
- **The verification has no metadata column.** `sandbox-chip: <scenario>` therefore lives on the challenge the chip was built for: migration `0034_phase10c.sql` adds `chip_challenges.sandbox_scenario`, and the verification's attributes serve it as `sandbox-chip`.
- The web flow's nfc case is `apps/flow/src/flow/flow-position.ts:345`, rendered at `flow-renderer.tsx:461`.
- The API log stores no session-token request, so no flow session answer is stored today; `prefillMrz` joins `MASKED_MEMBERS` (`services/api-logs.ts:264`) all the same.
- `flow-requests.android.test.ts`'s multipart rule (`fields.kind` names the file part) fits a chip upload as it is (`chip-sod.bin`); no extension was needed.

### 10.5 The three new nfc client-view members (C194.4)

| Member | Appearance-only? | Why | Filled by |
|---|---|---|---|
| `fallbackAvailable` | No | It decides whether the person is offered "use another way" | `clientViewOf`, from the flow's edges alone |
| `sandboxChipAvailable` | No | It decides whether the person is offered the "Test chip (sandbox)" reader | `nfcSessionMembers` |
| `prefillMrz` | No; personal data | With it the person is not asked to type the document number, birth date and expiry | `nfcSessionMembers`, for an SDK client only |

**Spec 2 carries all three; no version change is needed.** No client released or built before Workflow 10C renders an `nfc` step: the 10A and 10B SDK showed it as unsupported, and the web flow ships with the server. The members are camelCase, as every `step` member is.

### 10.6 Spike (d): publishing and Dokka

Run in a scratch worktree under `/tmp`, removed afterwards. The build pins AGP 9.4.1, Kotlin 2.4.21 and Gradle 9.8.2 (`android/gradle/libs.versions.toml`, the wrapper).

- `com.vanniktech.maven.publish` 0.37.0 and `org.jetbrains.dokka` 2.2.0 resolve through the existing `pluginManagement` and apply to `:openverify-sdk` (the KMP library plugin) and `openverify-nfc` (AGP 9 built-in Kotlin).
- `publishToMavenLocal` (exit 0, 246 s with a cold configuration) wrote `openverify-sdk` (the root module, with its Gradle metadata), `openverify-sdk-android` (AAR, sources, a Dokka javadoc jar of 446 entries, POM, module) and `openverify-nfc`. Dokka read the KGP 2.4.21 metadata; its only output was unresolved-link warnings in KDoc.
- OkHttp is in the Android POM with scope `compile` (as `okhttp-android`), as C214.4 requires.
- The plugin also publishes the two iOS targets by default. The build disables their publish tasks by name, so the staged repository holds the root module, the Android target and `openverify-nfc` only. The root module's Gradle metadata still names the iOS variants as available elsewhere; release-checks' consumer check is what proves an Android consumer resolves without them.
- Setting the Maven group changes the klib's unique name, so `api/openverify-sdk.klib.api`'s header line changed from `<openverify-android:openverify-sdk>` to `<dev.openverify:openverify-sdk>`; no declaration changed.

**Outcome:** the publishing plugin and Dokka 2.2.0, neither fallback.

## 11. Workflow 10E (contracts-10e, Stage 1a): the owner-gated artifacts

Taken on 2026-11-11 at `0e5a5ec68` (10E's start; base `b826da9b5`), by reading the code. Lines are as Stage 1a leaves them unless a line says "at the start".

### 11.1 Owner items and the base

- **Phase 10 P1-P5**, as recorded: P1 granted narrowly, P2 granted narrowly, P3 declined, P4 pending, P5 declined (`docs/plans/phase-10.plan.md`, "Orchestrator decisions before Workflow 10A", item 2; `docs/PROGRESS.md`, the 10D entry's last release-gate line and the 10C entry's "Owner items"). No "Owner decisions after Workflow ..." section exists. They match the launch.
- **Base and start** are ancestors of HEAD; the base's PROGRESS holds "Phase 10, Workflow 10D done" as a heading; the plan holds "Orchestrator decisions before Workflow 10E". `origin/main` holds the base.
- **CI:** run 43018061783 on the base ended within three seconds: 15 jobs "failed" with no step run and 3 skipped (the account's spending limit). It spent nothing and proves nothing, as the 10E decisions' item 2 says. The last run with steps is 42937477615 (the 10C push). `android-release.yml` has never run. Nothing here rests on a run.
- **Left unproved on a device or an emulator by 10D** (the plan's "Device proofs open", items 7 to 13, and "Validation as run", item 8): on an emulator, `CaptureScreenLayoutDeviceTest` (both methods), `MinifiedSmokeTest` (both), `IntegrityProbesDeviceTest` with `openverifyDeviceKind=emulator`, `CameraXFramePipelineTest`'s 1,280 px barcode side, all 14 and 2 tests for the result check, and the release matrix's API 26, 34 and 16 KB API 35 legs; on an emulator or a phone with NFC off, `NfcPlatformDeviceTest` (both) and the off-or-absent branch of `NfcTapLifecycleDeviceTest`; on a serial without a colon, that Gradle's exit follows the tests (KP10-31); on the phone, the demo through a capture step and an nfc step with the sandbox chip; by a person, the manual accessibility pass and the real-document read.

### 11.2 The seams 10E plugs into

- **Chip reader** (`android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/chip/ChipReader.kt`): `ChipReader` :22 (the interface is not experimental); `read(access, challenge, progress): ChipRead` :31 is `@ExperimentalOpenVerifyApi` (level ERROR), as are `ChipAccess` :36 (`Mrz(seed: BacKeySeed)`, `Can(can)`, both redacted in `toString`), `ChipRead` :53, `ChipDeviceReport` :68 (`Attempt`, `Protocol` with five values, `Outcome` with three), `ChipProgress` :84 (five values), `ChipReadFailure` :103 (six values) and `ChipReadException(failure)` :107 with the fixed message `Chip read failed: <failure in lower case>`. An implementing module opts in; `openverify-nfc` does so once, in its build file.
- **How the step calls it:** `NfcStepController.read` (`nfc/NfcStepController.kt:338`) calls `reader.read(key, nonce) { progress -> ... }` at :366, only while the tap screen is resumed: `NfcStepScreen.kt:39` wraps the read in `WhileResumed`, whose Android actual follows the activity's `ON_RESUME` and `ON_PAUSE` (`androidMain/.../nfc/NfcResumed.android.kt`), and a pause cancels the read's coroutine. At most nine challenges per run of the step (`MAX_CHALLENGES`, :730).
- **How a failure lands on what 10C draws** (:441-450): `ACCESS_DENIED` returns to the key entry; `NFC_DISABLED` shows the cannot-read view; `UNSUPPORTED_DOCUMENT`, `TIMEOUT`, `READER_BUSY` and `TAG_LOST` show the tap view with a notice. The client-unable request takes one of five reasons (`packages/contracts/src/flow-nfc.ts:21-27`; mapped at `NfcStepController.kt:764-768`), served by `apps/api/src/routes/flow/client-unable.ts` over `services/client-unable.ts`. The reader's closed failure set therefore needs no new state.
- **The route from an installed reader to the resumed activity, with no public change:** `OpenVerifyNfc.chipReader(context)` keeps the application context; the reader registers `Application.ActivityLifecycleCallbacks` and holds, weakly, the activity that is resumed; `read` is called only while the SDK's flow activity (`dev.openverify.sdk.OpenVerifyInquiryActivity`, the name in every manifest allowlist) is resumed, so that activity is the one `NfcAdapter.enableReaderMode` takes. No signature changes.
- **`SandboxChipReader`** (`nfc/SandboxChipReader.kt:29`) answers from the server's sandbox chip and throws `ChipReadException(UNSUPPORTED_DOCUMENT)` for a file kind outside the list (:44): the same fixed-message rule.
- **Face detector** (`face/FaceDetector.kt`): `FaceDetectorFactory.create()` :11, `FaceDetector : AutoCloseable` :21 with `suspend fun detect(input: FloatArray, width: Int, height: Int): YunetOutputs` :23, `YunetOutputs` :32 with twelve `FloatArray`s (`cls`, `obj`, `bbox`, `kps` at strides 8, 16, 32; `NAMES` :65), each flattened row-major as `apps/flow/src/guidance/yunet-decode.ts:10-15` names them.
- **How a detector is consumed** (`capture/selfie/SelfieGuidance.kt`): `detectors.create()` runs off the main thread (:148); an exception there is logged as `selfie.detector_unavailable` and leaves the shutter, as without a detector (C204.6); a `detect` that throws is logged as `selfie.detector_failed` and ends detection for that prompt; the detector is closed with the prompt. The shutter becomes primary after 10 s (`SelfieGuidanceConstants.MANUAL_SHUTTER_AFTER_MS`, :25; `contracts/fixtures/flow/selfie-capture.json:21`). The vectors are `contracts/fixtures/flow/selfie-guidance-vectors.json`, compared within 1e-9 pixels and 1e-12 for a yaw ratio (`commonTest/.../selfie/SelfieGuidanceVectorsTest.kt:27-28`).
- **Integrity token provider** (`integrity/IntegrityTokenProvider.kt:16-18`): a plain interface; the SDK calls `token(requestHash)` at most once per launch (`signals/Integrity.kt:76`), and since 10D only when the session's consent showed `notice.play-integrity`. P3 is declined: nothing implements it here.
- **The registry:** `OpenVerifyAndroid.install` (`androidMain/.../OpenVerifyAndroid.kt:22`) and `OpenVerifyComponents` (`commonMain/.../OpenVerifyComponents.kt:28`) with `chipReader`, `faceDetectorFactory`, `integrityTokenProvider`, `eventListener`, `transport`, `sandboxSignalOutcome`.
- **Logging:** `SdkLog` is an internal object (`log/SdkLog.kt:13`, `log` :15), so another module cannot call it, and 10B to 10D gave optional artifacts no route. Each artifact therefore has one logger of its own with the same grammar and the debuggable-host rule: `openverify-nfc/.../NfcLog.kt` and `openverify-face/.../FaceLog.kt`, held by `LogScanTest`.

### 11.3 The build, as it was and as Stage 1a leaves it

- **Modules** (`android/settings.gradle.kts`): `openverify-sdk`, `openverify-nfc`, `openverify-face` (new), `demo-app`. Gradle 9.8.2, AGP 9.4.1, KGP 2.4.21.
- **ABI:** KGP's `abiValidation` on `:openverify-sdk`; BCV 0.18.2's tasks wired by hand under `checkKotlinAbi` and `updateKotlinAbi` on `openverify-nfc` and, copied, on `openverify-face`. The dumps are `api/openverify-nfc.api` and `api/openverify-face.api`, one factory each. The SDK's dumps are unchanged.
- **`explicitApi()` and Kover at 80%** are now on both optional modules. Each reads one exclusion pattern from `kover-excludes/<builder>.txt` and refuses a second.
- **Locking and verification:** one lockfile per project, and for the demo one per configuration (`gradle.lockfile` for `sdk`; `gradle-sdk-nfc.lockfile`, `gradle-sdk-face.lockfile`, `gradle-sdk-nfc-face.lockfile`), because Gradle's default lock mode fails both on an unlocked module and on a locked one that is not resolved. `android/gradle/verification-metadata.xml` gained 34 components, none removed.
- **The boundary check** (`:openverify-sdk:checkDependencyBoundary`, `openverify-sdk/build.gradle.kts`) refuses every included module but the SDK and the demo and the six reserved groups. A probe that gave the SDK both modules and five of the libraries failed with each named (section 11.6); it needed no extension.
- **The privacy checks' module table** is `SdkModule.ALL` (`androidHostTest/.../privacy/SourceScan.kt`), now four entries; `SHIPPED` is the SDK and the two optional artifacts. `ExceptionCanaryTest` holds each optional artifact's exception table to its sources (section 11.5).
- **The demo** (`android/demo-app/build.gradle.kts`): `openverifyDemoArtifacts` accepts `sdk`, `sdk,nfc`, `sdk,face` and `sdk,nfc,face`; `BuildConfig.OPENVERIFY_DEMO_ARTIFACTS` is `sdk`, `sdk-nfc`, `sdk-face` or `sdk-nfc-face`; `DemoComponents.of` passes what the hooks gave `DemoComponents.attach`.
- **The release checks** (`android/scripts/`, 89 tests): `check-consumer-rules.py` reads a table of libraries (`LIBRARIES`) and `check-staged-repository.py` expects four modules and holds each POM to the libraries reserved for its artifact (`RESERVED_FOR`). `check-size.py` still knows `sdk` and `sdk,nfc` and tells them apart by the NFC permission only; `check-elf-alignment.py` reads the native libraries of each module's AAR and of the demo's APK, and `openverify-face`'s AAR holds none (ONNX Runtime's arrive by coordinates).
- **The workflows:** `ci.yml`'s second Gradle step and `android-release.yml`'s gate now also build `:openverify-face:assembleRelease`, because the consumer-rules check reads that AAR. Everything else in them is as 10D left it.
- **The synthetic chip:** `packages/emrtd/src/testing/` (`chip.ts`, `utopia.ts`, `keys.ts` with `testSignDigest`, which the server's sandbox chip signs with) now has `utopia-chip-export.test.ts`, which writes `contracts/fixtures/emrtd/utopia-chip.json`.
- **Accessibility records:** `A11yCatalog` holds 180 states of 20 screens after K10A-1; the audit and the statement say 180.

### 11.4 The pins, read on 2026-11-11

| Coordinates | Version | Published | Age, days | Licence, read from | Scope |
|---|---|---|---|---|---|
| `com.microsoft.onnxruntime:onnxruntime-android` | 1.31.0 | 2026-10-09 | 33 | MIT (POM); Eigen MPL-2.0 inside the native library (ORT's notices at the tag) | `openverify-face`, shipped |
| `com.microsoft.onnxruntime:onnxruntime` | 1.31.0 | 2026-10-09 | 33 | MIT (POM) | `openverify-face`, test |
| `org.jmrtd:jmrtd` | 0.8.9 | 2026-10-03 | 39 | LGPL-2.1-or-later (157 of 159 source headers) | `openverify-nfc`, shipped |
| `net.sf.scuba:scuba-sc-android` | 0.0.27 | 2026-08-23 | 80 | LGPL-2.1-or-later (source headers) | `openverify-nfc`, shipped |
| `net.sf.scuba:scuba-smartcards` | 0.0.21 | 2026-08-22 | 81 | LGPL-2.1-or-later; two files GPL-2.0-only WITH Classpath-exception-2.0 (source headers) | `openverify-nfc`, shipped |
| `org.ejbca.cvc:cert-cvc` | 1.4.13 | 2021-06-23 | 1,967 | LGPL-2.1-or-later (source headers) | `openverify-nfc`, shipped |
| `org.bouncycastle:bcprov-jdk18on`, `bcutil-jdk18on` | 1.86 | 2026-09-11 | 61 | MIT (`META-INF/LICENSE.md`) | `openverify-nfc`, shipped |
| `com.android.tools.build:manifest-merger` | 32.4.1 | 2026-09-18 | 54 | Apache-2.0 (POM) | `openverify-face`, test |
| `androidx.test.espresso:espresso-core`, `espresso-idling-resource` | 3.7.0 | 2025-07-30 | 469 | Apache-2.0 (POM) | device tests (KP10-47) |

- ONNX Runtime 1.31.1 exists (2026-10-26, 16 days old). The plan's pin stays: 1.31.0 is not withdrawn. Whether 1.31.1 fixes something that matters here was not read.
- Bouncy Castle 1.87 exists; 1.86 is what JMRTD 0.8.9's POM names, so it stays.
- **Not adopted, with the reason:** the AndroidX test orchestrator (a second process declared in the device test's own manifest gives the telemetry test its restart without changing how every device test of the module runs and reports); a test-only library module for the manifest test (AGP's own merger in test scope adds no artifact the build does not already resolve); the Play Integrity library (P3 declined).

### 11.5 What ONNX Runtime's AAR holds, and what the manifest merger does

Read from `onnxruntime-android-1.31.0.aar` (55,138,854 bytes, SHA-256 `72683787…40a7`):

- **Manifest package: `ai.onnxruntime`** (not the Maven group). It declares `ACCESS_NETWORK_STATE`, `INTERNET`, and the provider `ai.onnxruntime.TelemetryInitializer` (authorities `${applicationId}.onnxruntime_telemetry_initializer`, not exported, `initOrder` 100). `minSdkVersion` 24.
- **Classes:** `ai.onnxruntime.*` with a `telemetry` package (an HTTP client and its request types) and `META-INF/LICENSE-1DS` (Apache-2.0).
- **Its own consumer rules** (`proguard.txt`) keep `TelemetryInitializer` and the telemetry `HttpClient` types.
- **Native libraries:** `libonnxruntime.so` is 34,208,680 bytes for arm64-v8a, 24,182,012 for armeabi-v7a, 40,741,404 for x86 and 40,827,944 for x86_64, uncompressed in the AAR, with `libonnxruntime4j_jni.so` beside each (about 0.1 MB).
- **No third-party notices file.** The plan expected to copy ORT's notices from the AAR; they are copied from the `v1.31.0` tag instead (`android/openverify-face/licenses/onnxruntime/`).
- **Eigen:** `cmake/deps.txt` at the tag names revision `1d8b82b0740839c0de7f1242a3585e3390ff5f33` of `https://github.com/eigen-mirror/eigen`.

**The merger (AGP 9.4.1), measured on the demo's release manifest:**

| Marker | Where | Result in the app's merged manifest |
|---|---|---|
| `tools:node="remove"` with `tools:selector="ai.onnxruntime"`, on the provider and the permission | the library's manifest | ORT's elements are rejected, but **the markers stay as declarations**: a provider with no authorities (Robolectric's package parser refused the app: "provider does not include authorities attribute") and the permission |
| the same, on the permission | the app's manifest | the permission stays declared |
| `tools:node="remove"`, **no selector**, on the provider and the permission | the library's manifest | both are gone |
| the same, and the app declares the permission itself | both | the app keeps its permission |

So the plan's two selector-scoped markers cannot work. `openverify-face` removes the provider with a marker that has no selector (no other library declares that provider), and leaves the permission to the host: a library's marker without a selector would also take the permission from another library of the host merged after it (review P10's concern), and one with a selector keeps it declared. The demo, as a host, removes the permission in `demo-app/src/face/AndroidManifest.xml`. With both, the `sdk-face` allowlist equals the `sdk` one.

### 11.6 Other things measured in Stage 1a

- **The boundary probe** (a scratch tree; the SDK given both modules, ONNX Runtime, JMRTD, SCUBA, cert-cvc and Bouncy Castle): `checkDependencyBoundary` failed and named each of the ten components on `androidRuntimeClasspath`.
- **cert-cvc brings `bcprov-jdk15on` 1.68**, the same classes as `bcprov-jdk18on`. It is excluded on `jmrtd` and `cert-cvc`, and the exclusions are in the staged POM.
- **Bouncy Castle's two jars both carry `META-INF/LICENSE.md`** (identical bytes), and Android's packager refuses two files at one path. `openverify-nfc`, the demo and the consumer check each keep one copy (`pickFirsts`). A host app needs the same line; a library cannot give it.
- **R8** minified the demo with both artifacts (`sdk,nfc,face`, 147 s) and the consumer check with both, with no rule beyond what exists. Neither stand-in is reached from kept code, so this says nothing yet about the rules the reader or the detector needs.
- **Maven Central answered 429 (too many requests)** once, to the second cold Gradle home in a row; the same call passed a few minutes later. It is a throttle, not a failure of the build.
