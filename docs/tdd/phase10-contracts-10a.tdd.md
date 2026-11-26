# Phase 10, Workflow 10A Stage 1a: contracts-10a

Run alone, on the base `c60d51b9` with the 10A decisions `c7bc6f49`. Every Gradle call ran as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)`, in the foreground; the lock wait was 0 s unless stated (contracts-10a runs alone).

## Preconditions and the inventory

- `docs/PROGRESS.md:19` records Phase 9 done; `git cat-file -t` of `c60d51b98` and `c7bc6f494` is `commit`; the plan holds the 10A decisions at :1055.
- CI 42476248527 (`gh run view 42476248527 --json jobs,conclusion`): `failure` on `c60d51b9`; `infra` failed with `curl: (22) The requested URL returned error: 504` (KP10-2), `e2e` with `✘ 73 [chromium] › tests/ui-a11y-focus.spec.ts:55:1 › 2.4.11: with a toast on screen, no focused control is covered (C171.3)` and `182 passed (20.5m)` (KP10-1). Every other job passed. Recorded, not fixed (carry-10a's).
- Baseline: `:openverify-sdk:testAndroidHostTest` exit 0 in 15 s (cached), 1,366 tests, 0 skipped, 0 failed, load 0.10.
- Inventory: `docs/research/phase10-inventory.md`, committed in `0064fffb` with ADR 0009.

## Spike (a)

In `/tmp/spike-a-contracts10a` (`git worktree add --detach`, removed with `git worktree remove --force` and `git worktree prune`):
- `:openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.spike.*'` with a `LocalComposeEnvironment` provider: exit 1 in 54 s, `e: … Cannot access 'val LocalComposeEnvironment: ProvidableCompositionLocal<ComposeEnvironment>': it is internal in file.` and `Cannot access 'constructor(language: LanguageQualifier, …): ResourceEnvironment': it is internal`.
- The same with only an overridden `LocalConfiguration` (`setLocales(LocaleList(es))`): exit 0 in 70 s, printed `SPIKE LocalConfiguration route: [(Continuar, false), (Continue, true)]`.
- Outcome: no public per-composition locale; the facade's fallback (generated tables) is android-theme's.

## Checkpoint 1 (common)

### Stubs (`944148a7`)

`i18n/SdkStrings.kt` (the facade, delegating to Compose Multiplatform), the three `FlowProblemCodes` engine constants as `""`, `readContractFixture` with stub actuals answering `""`, `FakeFlowServer` serving nothing, `FakeFlowApi` made `open`.

### RED

`./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.FailureReasonTableTest' --tests 'dev.openverify.sdk.PublicSurfaceTest' --tests 'dev.openverify.sdk.i18n.SdkStringsSourceTest' --tests 'dev.openverify.sdk.flow.FakeFlowServerTest' --tests 'dev.openverify.sdk.fixtures.ReadContractFixtureTest' --tests 'dev.openverify.sdk.model.ContractFixturesTest'`: exit 1 in 85 s, load 0.03, `113 tests completed, 12 failed`, each for its intended reason:
- `FailureReasonTableTest`: `expected: <[INQUIRY_FAILED, …, STILL_PROCESSING, FLOW_HALTED]>` but the enum has eleven.
- `PublicSurfaceTest`: the expected six top-level declarations against the base's whole wire model, API and UI theme.
- `SdkStringsSourceTest`: twelve main files call `stringResource` or `pluralStringResource` directly.
- `ContractFixturesTest` "every flow-engine code the driver answers …": `expected: <3> but was: <1>` (the stub codes are all `""`).
- `ReadContractFixtureTest` (commonTest): `a JSON object`, and `Expected an exception of class java.lang.IllegalStateException`.
- `FakeFlowServerTest` (six): `List is empty.` (nothing served) and `expected: <FlowSessionSignals(integrity=true, …)> but was: <null>`.

### GREEN and refactor

- `74864a47` (feat): `FailureReason.FLOW_HALTED`; the three engine codes; `readContractFixture` from the context class loader (host) and `platform.posix` (iOS); `FakeFlowServer`.
- `5574f762` (refactor, mechanical): ten main files' `stringResource(`/`pluralStringResource(` calls became `sdkString(`/`sdkPlural(` (169 call lines), imports swapped; no other change.
- `c936f8d3` (refactor): 108 top-level declarations made `internal` (the wire model, `OpenVerifyJson`, `FlowApi`, `FlowApiClient`, `FlowApiException`, `CapturedImage`, `CameraLens`, `Mrz`, `DeviceSignals`, `OpenVerifyTheme`); `WireValue` internal, the serializer reading the wire value through a function; the demo's own `MaterialTheme`. Existing tests changed (no assertion): `FlowApiClientTest`, `CameraFactsTest` and `ContractFixturesTest` became `internal class`, because a public member of each names a now-internal type ("'public' function exposes its 'internal' parameter type 'CaptureMethod'").
- Then `InquiryStatus.wireValue` and `FileKind.wireValue` stay public: the demo reads `result.inquiryStatus.wireValue` (`DemoForm.kt:37`, "Cannot access 'val wireValue: String': it is internal"). The demo's preview, which builds a throwaway view model, carries `@Suppress("ViewModelConstructorInComposable")`: lint flagged it once the theme became the demo's own composable (`MainActivity.kt:142`, 1 error).

### Gate at checkpoint 1

- `:openverify-sdk:testAndroidHostTest`: exit 0, 110 s, load 2.99; **1,385** tests, 0 skipped, 0 failed (1,366 + 19 new).
- `koverVerify testDebugUnitTest assembleDebug :demo-app:assembleRelease :demo-app:bundleRelease`: exit 0, 139 s, load 6.60.
- `:openverify-sdk:assemble lint :openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest`: exit 0, 38 s, load 4.33 (the iOS main and test klibs compile, `ContractFixtures.ios.kt` included).
- Not yet existing: the screenshot task and the ABI check (foundation-10a).

## Checkpoint 2 (P)

### Stubs

The declarations of C190–C192 and the seams, with KDoc and samples, as stubs: `toString` and `equals` left to their defaults, `mrzInformation = ""`, `ChipReadException` without a message, `YunetOutputs.tensor` answering `null` and `NAMES` empty. Two compile findings shaped them:
- `@ExperimentalOpenVerifyApi` on the `ChipReader` interface made every `OpenVerifyComponents(...)` need the opt-in ("e: …/OpenVerifyAndroid.kt:19:52 This OpenVerify API may change before it is stable.", even with `@OptIn` on the constructor), so the marker sits on `ChipReader.read` and the value types (ADR 0009 says so).
- `fun interface` cannot hold a `suspend` member, so `IntegrityTokenProvider` is a plain interface.

### RED

`--tests 'dev.openverify.sdk.PublicApiShapeTest' --tests 'dev.openverify.sdk.PublicSurfaceTest' --tests 'dev.openverify.sdk.mrz.*' --tests 'dev.openverify.sdk.OpenVerifyInquiry*'`: exit 1 in 74 s, `130 tests completed, 5 failed`: the request's and the link's text without `locale=` (and the link equal whatever its locale), the seed's `mrzInformation` empty and its text and the CAN's showing their values, the chip read's text showing `[B@…` and its exception's message `null`, and the YuNet names empty. `PublicSurfaceTest` passed: the expected list matches the sources.

### GREEN

The texts of `Request` and `OneTimeLink` show `locale` and `appearance` (the link's equality includes them); `BacKeySeed.mrzInformation` from the companion's function and a redacted text; `ChipAccess.Mrz`, `ChipAccess.Can` and `ChipRead` redacted; `ChipReadException`'s fixed message `Chip read failed: <failure>`; `YunetOutputs.tensor` and `NAMES`. The whole suite then failed on two exact texts the plan changes (`OpenVerifyInquiryRequestTest` "toString never shows the session token", `OpenVerifyInquiryOneTimeLinkTest` "errors and toString never show the token": `expected: <Request(…, apiBaseUrl=https://verify.example.com)> but was: <… locale=null, appearance=SYSTEM)>`); each expected string gained `, locale=null, appearance=SYSTEM`, the redaction assertions unchanged.

### Gate at checkpoint 2

`:openverify-sdk:testAndroidHostTest koverVerify testDebugUnitTest assembleDebug :demo-app:assembleRelease :demo-app:bundleRelease :openverify-sdk:assemble lint :openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest`: exit 0 in 205 s, load 2.25 to 9.96; **1,394** host tests, 0 skipped, 0 failed.

## Checkpoint 3 (R)

### The export (packages/contracts)

`client-view-members.export.test.ts` against a placeholder `{}`: `pnpm --filter @openverify/contracts exec vitest run src/client-view-members.export.test.ts --coverage.enabled=false` → `Tests 1 failed | 1 passed (2)` ("is the committed file"). Written once with `UPDATE_CONTRACT_FIXTURES=1`, then `Tests 2 passed (2)` without it. Its printer matches the repository's Prettier (`prettier --check` passes on the file) so no Prettier import enters the package; `tsc --noEmit` and `eslint` exit 0 (one `non-nullable-type-assertion-style` finding fixed by iterating entries).

### Stubs (`1879e403`) and RED (`2c662d6f`)

The declarations with stub states: the component table empty, the header not sent, `Halted` mapped to `UNSUPPORTED_FLOW`, the members file treating nothing. `--tests 'dev.openverify.sdk.flow.FlowSpecMembersTest' --tests 'dev.openverify.sdk.model.Phase9WireModelTest' --tests 'dev.openverify.sdk.api.FlowSpecHeaderTest'`: exit 1 in 71 s, `15 tests completed, 6 failed` (every component of the every-step screen unsupported; `Failed(…, UNSUPPORTED_FLOW)` for `Halted`; the header `null`; the three member tests). The other nine passed as shape pins of the declarations (the golden v2 session decodes, values redacted, an unknown state, the registry skeleton, the not-built calls).

A finding while writing them: the every-step screen holds all 22 kinds once nested components count (`expected: <21> but was: <22>`), so the test asserts the whole catalogue.

### GREEN

The component table, the header, `Halted` → `FLOW_HALTED`, and `flow-spec-members.json` with every member: 20 session members (their object members too), 76 step-type members, 183 component members; validated against `flow-spec-members.schema.json` with ajv (and a copy without `embed.reason` refused).

### Gate at checkpoint 3

`:openverify-sdk:testAndroidHostTest koverVerify testDebugUnitTest assembleDebug :demo-app:assembleRelease :demo-app:bundleRelease :openverify-sdk:assemble lint :openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest`: exit 0 in 202 s, load 2.43 to 8.75; **1,409** host tests, 0 skipped, 0 failed.

### After checkpoint 3: FakeFlowServer serves the spec-2 members

RED: `--tests 'dev.openverify.sdk.flow.FakeFlowServerTest'` → `7 tests completed, 1 failed` (the session carried no position). GREEN: each read's session carries `position`, `step` (the step's client view), `spec-version: 2` and an optional `handoff-context`; `--tests 'dev.openverify.sdk.flow.*'` exit 0.

## Checkpoint 4 (L)

### The web catalogs (`169aab70`)

Comparing every SDK legal string with the web's words (en and es) found two that differ: `openverify_notice_session_integrity` (the app wording, "this app … whether a debugger is attached", against the web's "this page … whether a browser is automated") and `openverify_consent_processing` ("closing this screen" against "closing this page"). Both, and the three optional-consent checkbox labels, which no web key had, joined the five web catalogs as the group `nativeApp` (en and es copied unchanged from the SDK, fr, de and ar machine-drafted). `pnpm --filter @openverify/flow i18n:export` rewrote the five locale exports; the catalog version `web-03a9d4e06ed93f3e` and `consent-texts.json` are unchanged because `nativeApp` is not a consent or notice group. `pnpm --filter @openverify/flow exec vitest run src/i18n --coverage.enabled=false`: 16 files, 222 tests passed.

### RED (`d35eaa49`)

`i18n/key-map.json` (14 entries) and `i18n/review-status.json` (312 keys) with their JSON Schemas (both validated with ajv). `--tests 'dev.openverify.sdk.i18n.KeyMapCatalogTest'`: exit 1 in 33 s, `4 tests completed, 3 failed`: `values-es/strings.xml: openverify_consent_automated_decision, …` defined by hand; `values/strings_catalog.xml is missing`; the review status naming `strings_catalog.xml` for the fourteen that `strings.xml` still held. The legal-mark test passed (it reads only the key map and `COPY_KEYS`).

### GREEN

The fourteen strings moved, unchanged, from `values/strings.xml` and `values-es/strings.xml` into a `strings_catalog.xml` in each folder, with the generated-file header. `values-fr`, `values-de` and `values-ar` get theirs from android-i18n's generator with each locale's full catalog and `openverify_locale`: a folder with only the consent texts would make the consent screen record `openverify_locale = en` beside French words.

### Gate at checkpoint 4

`:openverify-sdk:testAndroidHostTest koverVerify testDebugUnitTest assembleDebug :demo-app:assembleRelease :demo-app:bundleRelease :openverify-sdk:assemble lint :openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest`: exit 0 in 215 s, load 7.93; **1,414** host tests, 0 skipped, 0 failed.

## Checkpoint 5 (S)

### RED (`11ec634f`, after the stub `489ede4d`)

- `pnpm --filter @openverify/contracts exec vitest run src/phase10a-contracts.test.ts src/fixtures.test.ts --coverage.enabled=false`: 3 failed in `fixtures.test.ts` ("are exactly the C8 and C20 lists": `expected [ …(191) ] to deeply equal [ …(192) ]`; the new fixture's two checks `ENOENT … flow-session-organization.json`) and `phase10a-contracts.test.ts` failed to load on the same `ENOENT`.
- `--tests 'dev.openverify.sdk.flow.FlowSpecMembersTest' --tests 'dev.openverify.sdk.model.Phase9WireModelTest' --tests 'dev.openverify.sdk.model.ContractFixturesTest'`: exit 1 in 88 s, `115 tests completed, 3 failed` (the members file lists `organization-display-name`, which the export lacked; the fixture list; the decode).
- The JSON Schemas of the exported files and the request table, compiled with ajv; the committed `consent-texts.json` validates against its schema, a pattern case with both `input` and `repeat` is refused.

### GREEN (`a16ecaab`)

`organization-display-name: organizationDisplayNameSchema.nullable().optional()` on `flowSessionResponseSchema`; `contracts/fixtures/api/flow-session-organization.json` (the v2 session with `"Example Org"`); the members export rewritten with `UPDATE_CONTRACT_FIXTURES=1`. Contracts: `Tests 631 passed (631)` over the three files. Kotlin: the three classes exit 0. `pnpm --filter @openverify/api openapi:write`: exit 0 in 20 s, sha256 `4b53b129432152f76f0dc22a72507a3fd39e50016b1833436e5e8bed8e71cf52` (from `e229bd12…`); a second run changed nothing.

### Gate at checkpoint 5

`:openverify-sdk:testAndroidHostTest koverVerify testDebugUnitTest assembleDebug :demo-app:assembleRelease :demo-app:bundleRelease :openverify-sdk:assemble lint :openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest`: exit 0 in 191 s, load 0.42 to 8.83; **1,416** host tests, 0 skipped, 0 failed. The plan's "## Workflow 10A Stage 1a amendments (contracts-10a)" (16 items) is written.

## Final gates (on `915666a6`, after the last code change; contracts-10a alone, heavy calls on the reserved slot)

- `pnpm install --frozen-lockfile`: exit 0. `pnpm format:check`: first exit 1 on `packages/contracts/src/phase10a-contracts.test.ts` (fixed in `915666a6`), then exit 0 in 98 s.
- Forced typecheck `pnpm turbo run typecheck --force`: exit 0, 17 of 17, 125 s, load 1.46 to 5.70.
- Forced lint (`NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=1`): api exit 0 (182 s); dashboard and contracts exit 0 (202 s); the other 14 exit 0 (294 s).
- Unit outside the API (`pnpm turbo run test --force`): watchlist, e2e, db exit 0 (354 s); dashboard exit 0 (6,715 tests, 378 s); the other 11 exit 0 (153 s, load up to 14.3); `pnpm --filter @openverify/js test` exit 0 (19). Counts: contracts 4,401, checks 3,826, db 2,178, workflow-engine 1,984, core 1,655, flow 1,490, watchlist 820, node 486, flow-spec 432, emrtd 318, config 290, signals 192, e2e 131, ui 55, js 19.
- API (`apps/api`, 8 blob shards, each exit 1 on partial coverage alone, 131 to 165 s, load 7.4 to 9.0), merge exit 0 in 33 s: 692 files, **9,428** tests, 94.39% statements, 85.02% branches. Unit total 34,420 (34,412 at the base plus 8 contracts tests).
- Integration: db 78 (90 s); graph 13 (34 s); api shards 89, 99, 79 (66, 166, 81 s); each exit 0, load up to 15.6.
- Android gate (checkpoint 5, unchanged since): exit 0, 1,416 host tests. Screenshot and ABI steps do not exist yet (foundation-10a).
- `pnpm --filter @openverify/api openapi:write` twice: the second changed nothing (sha256 `4b53b129…cf52`).
- `bash infra/tests/ci-workflow.test.sh`: exit 0, 250 passed.
- e2e gate: the mocked flow suite 328 passed (115 s, load 6.8 to 10.3); down and build 20 s; stack up 103 s; chromium shards 47, 46, 46, 44 passed (228, 309, 260, 386 s, load 1.7 to 2.6); console sweep 104 passed (295 s); `stackTest` does not exist yet (integration-10a); stack down. About 28 minutes in all. WebKit is not claimed from this run.
