# Phase 10, Workflow 10A Stage 4: integration-10a

Run alone, after every other 10A agent, on 2026-11-09, from `2b6c0e60` (android-sdk-api's last checkpoint). Every command ran after `source scripts/env.sh`; every Gradle call under `flock -E 75 -w 240 /tmp/openverify-gradle.lock`, every e2e call under the e2e lock, the heavy calls through `/tmp/openverify-heavy.sh` with `OPENVERIFY_HEAVY_RESERVED=1`. No lock wait exceeded a second (no other agent ran).

## 1. The integration hooks and the theme defect (C195, C193.2, C198.2)

Stub `5b128e77`: `InquiryViewModel.screenDrafts` (memory only), nothing provides or clears it.

RED `bf90fcb9` (`IntegrationHooksTest.kt`: three classes; `ThemeMappingTest`: one new test, one table row):

```
./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.IntegrationHooksTest' \
  --tests 'dev.openverify.sdk.IntegrationDispatchTest' --tests 'dev.openverify.sdk.IntegrationScreenDraftsTest' \
  --tests 'dev.openverify.sdk.ui.theme.ThemeMappingTest'          # rc=1, 132 s, load 0.12 -> 3.09
14 tests completed, 5 failed
IntegrationHooksTest      ComposeTimeoutException: Condition still not satisfied after 10000 ms   (no LocalScreenEnvironment: the screen rendered unsupported)
IntegrationDispatchTest   Expected exactly '1' node ... 'The verification service this app connects to is older than the app. ...'
IntegrationScreenDraftsTest  expected null, but was:<ScreenFormState(<0 redacted>, set=0)>
ThemeMappingTest          text on surface ==> expected: <#101828> but was: <#c10007>   (danger red, android-theme's finding)
ThemeMappingTest          everyRoleIsSetFromATokenAsTheTableStates: errorContainer=canvas expected, surface found
```

GREEN `5dde1aab`: the activity provides `LocalScreenEnvironment` (`screenEnvironmentOf(session, LocalSdkLanguage, drafts = viewModel.screenDrafts)`); the dispatcher passes `reason = state.reason`; `screenDrafts` is cleared with `drafts`; `errorContainer` takes `canvas`.

```
./gradlew ... --tests (the four above) --tests 'dev.openverify.sdk.ui.theme.*' --tests 'dev.openverify.sdk.InquiryViewModelTest' \
  --tests 'dev.openverify.sdk.OpenVerifyInquiryActivity*' --tests 'dev.openverify.sdk.ui.StatusScreensTest'   # rc=0, 137 s
./gradlew --no-daemon -q :openverify-sdk:screenshotTest -Proborazzi.test.verify=true                       # rc=1, 48 s
43 tests completed, 21 failed   (ThemeScreenshotTest 6, ScreenGoldensTest 9, ScreenGoldensLargeTextTest 6)
```

The 21 comparison images were read: each reference drew body text in `danger` red (`chrome-builtin-dark-ar`: the consent title red, now ink) or the error summary card on `surface` (now `canvas`). Recorded again by the explicit record call only, then verified:

```
./gradlew --no-daemon -q :openverify-sdk:screenshotTest -Proborazzi.test.record=true \
  --tests 'dev.openverify.sdk.ui.scaffold.ThemeScreenshotTest' --tests 'dev.openverify.sdk.ui.screen.ScreenGoldens*'   # rc=0, 44 s
./gradlew --no-daemon -q :openverify-sdk:screenshotTest -Proborazzi.test.verify=true                              # rc=0, 36 s
```

Goldens: 42 PNGs, 2,331,957 bytes (foundation 1, android-screens 35, android-theme 6); 43 screenshot tests.

## 2. The web consent's copy source (C162.9; android-sdk-api's finding)

RED `f1797a3f` (`apps/flow/src/steps/consent-step.test.tsx`; the existing "says the words were the operator copy when the session replaced one" became "leaves the copy source out when only some of the words were the operator copy", and a test for a wholly custom consent was added):

```
(cd apps/flow && pnpm exec vitest run src/steps/consent-step.test.tsx --coverage.enabled=false)   # rc=1
× leaves the copy source out when only some of the words were the operator copy
AssertionError: expected { accepted: true, …(5) } to not have property "copy-source"
Tests  1 failed | 17 passed (18)
```

GREEN `96f626e0`: `custom` only when every text shown was the operator's, `built-in` when none was, left out when mixed. `Tests 18 passed (18)`; `tsc --noEmit` rc=0.

## 3. The preview banner's Android line (C221.9, named borrowed edit)

RED `60fc516f`:

```
(cd apps/dashboard && pnpm exec vitest run src/components/flow-preview/preview-banner.test.tsx --coverage.enabled=false)   # rc=1
× says the Android app draws the screens with the system font and Material components
TypeError: .toMatch() expects to receive a string, but got undefined
```

GREEN `fee07a1e`: `PREVIEW_COPY.banner.items.android` in `lib/copy/preview.ts`. With the preview page test and the copy tests: `Tests 13 passed (13)`. Lint later refused an unnecessary optional chain in the new test; fixed in its own commit.

## 4. The 10A full-stack spec (C224.3) and stackTest (C224.4)

`e2e/src/android-flow.ts` builds the 10A flow (consent; a sandbox `database` step, since a version needs a verification step and the sandbox database decides with no camera; the screen `hello`; the branch `by_language` on `session.locale` with route `spanish`; the screen `hola`; the completion `done`). `e2e/src/android-flow.test.ts` holds `e2e/fixtures/android-10a/flow.json` to it (assert-only; `UPDATE_CONTRACT_FIXTURES=1` writes it, then Prettier formats it).

`e2e/tests/flow-android.spec.ts` (2 tests, 90 s budget each) passed at once on a fresh stack (`5.5 s`), since it covers server and SDK behaviour Stages 2 and 3 built: there is no RED for it. It drives the flow API with `User-Agent: OpenVerify-Android/0.1.0` and `OpenVerify-Flow-Spec: 2`; a wrong digest is refused 422 `consent_text_mismatch` with no consent recorded; the Android digests of `android-consent-digests.json` (the session's retention days) are accepted; Spanish takes `route:spanish` to `hola`; English takes `else`; the inquiry session's `mobile-sdk-name` is `openverify-android`.

`android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/stack/AndroidFlowStackTest.kt` (Robolectric, `@Category(StackTests::class)`): publishes the fixture's template with the stack's API key and the seeded admin (read from `e2e/.artifacts/stack.json`, never printed), starts an inquiry with the sandbox nickname record, then runs the real `FlowApiClient` and `FlowCoordinator` with the real `AndroidDeviceSignals(context, SandboxSignalOutcome.BOT)`: consent in Spanish with the SDK's own digests, the database step through `submitInputs`, `hello`, `hola`, `Completed(completed)`; then on the server: `signals-collected` holds `session-integrity`, `device-type` is set and `inquiry/bot_score` is 95. Three runs failed for the test's own code before it ran the flow (a colon in a test name; a type the compiler could not infer; OkHttp refusing a body-less POST); the fourth passed:

```
flock -E 75 -w 240 /tmp/openverify-e2e.lock sh -c 'cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon -q :openverify-sdk:stackTest'   # rc=0, 47 s
tests="1" failures="0" time="22.056"
```

`build.gradle.kts`: `stackTest` gains the two system properties and never counts as up to date; `failOnNoDiscoveredTests = false` is removed.

## 5. CI (C220.1, C219.6)

RED `8ca93ece` `infra/tests/ci-workflow.test.sh` (`bash infra/tests/ci-workflow.test.sh`, rc=1):

```
FAIL - android: runs ./gradlew :openverify-sdk:screenshotTest -Proborazzi.test.verify=true checkKotlinAbi :demo-app:bundleRelease (C220.1)
FAIL - android: the screenshot, ABI and bundle step runs after the host tests' Gradle step
FAIL - android: the uploaded reports include Roborazzi's comparison images
FAIL - android: the test-count floor fails with one test fewer than 10A's floor (1933) (exit 0: ...; the floor is 1366)
FAIL - android: the test-count floor fails at Workflow 9B's earlier floor of 1366 (exit 0: ...)
```

GREEN `a36a7990` `.github/workflows/ci.yml`: the step "Screenshots with comparison, the ABI check and the release bundle", the Roborazzi outputs in the reports upload, the floor 1934. `bash infra/tests/ci-workflow.test.sh`: rc=0, 264 checks (258 at carry-10a's end).

**The floor's arithmetic** (C219.6): 1,366 at the base (`ci.yml`, 9B) − 78 (android-driver's deleted invocations, named in `docs/tdd/phase10-android-driver.tdd.md`) = 1,288; + 646 added by 10A = **1,934**, the count measured at this Stage's gate with 0 skipped and 0 failed. integration-10a's own share: 4 (`IntegrationHooksTest`, `IntegrationDispatchTest`, `IntegrationScreenDraftsTest`, `ThemeMappingTest.textOnTheSurfaceFamilyIsInkNotDanger`).

## 6. Docs and records

`docs/android/` (README, integration, migration, events, failure reasons, themes and languages), `docs/PLAN.md` (C222's 10A corrections), `docs/research/persona-surface.md` (Android rows), `docs/checks/sandbox-providers.md` (C90.9's Android control, named borrowed edit), the header comment of `apps/api/src/routes/flow/theme-assets.ts`, and the plan's Stage 2, 3 and 4 amendments.

## 7. Validation (Phase 9's order), each call's exit code read from the command

| Step | Command | Result | Time | Load (1 min) |
|---|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile`; `pnpm format:check` | 0; 0 | 0 s; 100 s | 0.1–1.1 |
| 2 | forced typecheck; forced lint: api / dashboard+contracts / the other 14 | 0 (17 of 17); 0 / 1 then 0 / 1 then 0 | 140 s; 185 / 205+209 / 304+304 | 1.0–5.0 |
| 3 | `fetch_models.py`, `fetch_data.py` | 0, 0 | 1 s, 0 s | 1.8 |
| 4 | `build:variant-groups` | 0 | 6 s | 1.8 |
| 5 | units: watchlist+e2e+db; dashboard; the other 12; `@openverify/js` | 0; 0; 0; 0 | 356; 373; 147; 5 s | 1.4–16.0 |
| 5 | API: 8 blob shards (each exits 1 on partial coverage alone), merge | merge 0: 696 files, 9,472 tests, 94.39% | 130–161 s each; 33 s | 7.2–12.5 |
| 6 | `benchmark:typecheck`, `benchmark:test` | 0, 0 | 44, 9 s | 3.3 |
| 7 | integration: db; graph; api 1/3, 2/3, 3/3 | 0 (78); 0 (13, template 15.4 s of 180); 0 (93, 104, 88) | 89; 34; 71, 167, 83 s | 3.2–16.1 |
| 8 | vision static; pytest ≤ file 58; > 58 with `--cov-append` | 0; 0 (1,471); 0 (1,130, 97.48%) | 2; 258; 313 s | 1.2–15.6 |
| 9 (a) | `:openverify-sdk:testAndroidHostTest --rerun` | 0: 1,934, 0 skipped | 113 s | 1.1–2.6 |
| 9 (b) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | 0: 43 | 46 s | 3.0 |
| 9 (c) | `koverVerify checkKotlinAbi` | 0 | 66 s | 2.7 |
| 9 (d1), (d2) | `testDebugUnitTest assembleDebug`; `:demo-app:assembleRelease :demo-app:bundleRelease` | 0; 0 | 36; 78 s | 4.1–4.4 |
| 9 (e1), (e2) | `:openverify-sdk:assemble`; `lint` | 0; 0 | 55; 147 s | 5.1–6.3 |
| 9 (f) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 26 s | 4.4 |
| 10 | `openapi:write` + diff; `workflow-docs:write` + diff | 0, no diff (sha256 `4b53b129…cf52`); 0, no diff | 20; 1 s | — |
| 11 | mocked flow suite | 0: 328 | 112 s | 2.9–14.0 |
| 11 | stack down + build; stack up | 0; 0 | 0; 93 s | 12.9 → 5.7 |
| 11 | chromium shards 1–4 | 0: 49, 45, 49, 44 (187) | 232, 329, 277, 352 s | 2.0–5.3 |
| 11 | console sweep (`--no-deps`) | 0: 104 | 292 s | 3.9 |
| 11 | `:openverify-sdk:stackTest`; stack down | 0: 1 (21.0 s in the test); 0 | 35; 4 s | 2.9 |
| 11b | Docker WebKit `theme-csp.spec.ts` | 0: 7 of 7 | 18 s | 3.4 |
| 12 | apps image; vision image; code-runner image | 0; 0; 0 | 149; 3; 38 s | 3.1–3.4 |
| 13 | the 11 `infra/tests/*.test.sh`, each its own run | all 0 (ci-workflow 264, flow-headers 21 with its live half, flow-server 38, install-gitleaks 31) | 0–17 s each | 1.9 |
| 14 | workflow benchmark (reported) | effectful 19 / 50 / 48 and control-flow 96 / 206 / 205 steps/s at 1 / 8 / 32 clients | 123 s | 1.6–2.5 |
| 14 | `analytics:benchmark --measure` (reported) | build 399,988 ms; refresh-5-minute 1,985 ms; after midnight 31,122 ms; reads at 400 days 184 / 111 / 182 / 408 / 11 / 272 ms | 453 s | 2.1–2.5 |
| 15 | `gitleaks git --redact .` | 0: 6,213 commits, no leaks | 7 s | — |
| end | forced typecheck; `pnpm format:check` again | 0; 0 | 126; 99 s | 2.1–4.2 |

The CI one-call forms of the Android gate were not run: foundation-10a measured (d) at 448 s and (e) at 326 s under load 25–40, which with the 240 s lock wait would pass 10 minutes, so the split calls (a)–(f) stand for them (Stage 1b amendment 1). Not applicable to 10A (10C on): `python3 -I scripts/fetch_bundletool.py`, `check-elf-alignment.py` and `check-size.py`, `publishAllPublicationsToStagingRepository` with the consumer check: none exists yet.
