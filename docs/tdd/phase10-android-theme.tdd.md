# Phase 10, Workflow 10A: android-theme (TDD evidence)

Owner: `android-theme` (Stage 3; families R and L). Contracts: C198 (themes), C197.4 (the help slot and the language selector), C199.4 (the per-composition language behind `sdkString` and `sdkPlural`), C199.5's layout half (right to left, mirroring, bidi isolation). Base: the Stage 1b checkpoint 4 `38342eb5`, with android-logic's theme-mapping and locale checkpoints and android-i18n's checkpoint 3 in.

Every Gradle call ran as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)`, in the foreground; the wall time includes the lock wait, written beside it with `cat /proc/loadavg` before and after.

## Slice 1: the per-composition language behind the facade (C199.4, C199.5, C199.8)

Spike (a)'s answer (inventory section 5): Compose Multiplatform 1.11.1 has no public per-composition locale, so the facade resolves generated per-locale tables.

- Stub `65ce729e`: `LocalSdkLanguage`, `sdkText`, `SdkPluralCategory` with `sdkPluralCategory` (always `OTHER`), `SdkStringTable` with `sdkStringIn`/`sdkPluralIn` (null) and an empty `sdkStringTable` in `i18n/SdkStringTables.kt`.
- RED `01d2e5e6`: `commonTest i18n/SdkPluralRulesTest` (CLDR samples per category, five languages, negative counts), `androidHostTest i18n/SdkStringTablesTest` (the committed tables equal the resource files; Compose and the tables agree for every string raw and filled, every plural over 18 counts, in each of the five locales; the five tables and no other), `androidHostTest i18n/SdkStringsFacadeTest` (French in an English process, Arabic in a German one with Arabic plural categories, Compose's own reading without a chosen language, isolates only in the displayed text).

  ```
  $ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.i18n.SdkStringTablesTest" --tests "dev.openverify.sdk.i18n.SdkStringsFacadeTest" --tests "dev.openverify.sdk.i18n.SdkPluralRulesTest"
  13 tests completed, 12 failed            (wall 123 s, lock wait 0 s, load 0.25 -> 3.71)
  FAIL SdkPluralRulesTest arabicHasAllSixCategories: ar 0 ==> expected: <ZERO> but was: <OTHER>
  FAIL SdkStringTablesTest the committed tables are exactly what the resource files produce: i18n/SdkStringTables.kt is stale ...
  FAIL SdkStringTablesTest every string resolves to the same text ...: [en openverify_aamva_intro, ...]
  FAIL SdkStringsFacadeTest a chosen language reads its own words ...: could not find any node ... 'Annuler'
  FAIL SdkStringsFacadeTest the displayed text isolates ...: expected:<EVM network [⁨8453⁩]> but was:<EVM network [8453]>
  ok   SdkStringsFacadeTest without a chosen language the facade reads as Compose does, by the process locale
  ```
- GREEN `881f877b`: the CLDR rules as code (`sdkPluralCategory`), the lookup with Compose's default-text fallback and positional fill (`sdkStringIn`, `sdkPluralIn`), the facade reading `LocalSdkLanguage`, `sdkText`/`sdkPluralText` with U+2068/U+2069 around each argument, and the tables written by the test's update mode (218,491 bytes, five languages):

  ```
  $ UPDATE_SDK_STRING_TABLES=1 ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.i18n.SdkStringTablesTest" --rerun
  (writes i18n/SdkStringTables.kt; the other cases still ran against the compiled stub)   wall 155 s, lock wait 0 s, load 2.62
  $ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.i18n.SdkStringTablesTest" --tests "dev.openverify.sdk.i18n.SdkStringsFacadeTest" --tests "dev.openverify.sdk.i18n.SdkPluralRulesTest"
  exit 0, tests=13 failed=0 skipped=0      (wall 229 s, lock wait 0 s, load 3.95 -> 3.25)
  ```
  Compose's CLDR data and the rules written here agree on every count, `many` for Spanish and French millions included.

## Slice 2: the session theme on Material 3, the logo, the bars, the language at the root (C198.1-C198.7, C199.2, C199.5)

- Stub `0a81cb57`: `SessionLook` (theme, locales, links, organisation name, copy) with its composition locals, `LanguageSelection`, `OpenVerifyColors`; `checkLogo`, `decodeLogo`, `loadLogo`, `ThemeBrand`; `SystemBarIcons` (`expect`, Android and iOS actuals); `SessionTheme.usable` and `REFUSED`; `OpenVerifyTheme(look, appearance, requestedLocale, language, themeAssets, systemDark, content)` applying nothing yet.
- RED `2cffb2e9`: `SessionThemeTest` (contract cases, one constant code once, no value logged, the coordinator publishes the theme, `SessionLook.of`), `ThemeLogoTest` (commonTest: PNG IHDR and JPEG SOFn read without decoding, 2,048 px, 256 KiB, WebP/GIF/SVG refused, truncated headers, an oversized header never decoded), `ThemeLogoDecodeTest` (synthetic PNG and JPEG decode at their size; a real PNG whose IHDR says 4,096 px never reaches the decoder), `OpenVerifyThemeTest` (palette, radius and extras; built-in palettes; `auto`, `light`, `LIGHT`, `DARK`, `DARK` without a dark palette; the bars; the language order and its change at once; right to left for Arabic in an English process; the brand), `ThemeFixturesTest` (the goldens' palettes pass C160.4's sixteen pairs).

  The first attempt stopped at compilation in another agent's uncommitted `ui/screen/ScreenComponents.kt` (not a test failure); the rerun:
  ```
  $ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.ui.theme.*" --tests "dev.openverify.sdk.ui.OpenVerifyThemeTest"
  tests=57 failed=33                       (wall 204 s, lock wait 0 s, load 3.48 -> 3.52)
  FAIL SessionThemeTest a theme that meets its contract is the theme the SDK applies: expected same:<FlowTheme(...)> but was null
  FAIL SessionThemeTest a theme outside its contract ...: an upper-case colour expected:<[theme.session_theme_refused]> but was:<[]>
  FAIL ThemeLogoTest aPngHeaderIsReadWithoutDecoding(): expected <Accepted(...PNG, 640, 216)> but was <Refused(NOT_PNG_OR_JPEG)>
  FAIL ThemeLogoDecodeTest a real PNG whose header claims 4096 px ...: expected <Refused(TOO_MANY_PIXELS)> but was <Refused(NOT_PNG_OR_JPEG)>
  FAIL OpenVerifyThemeTest the operator palette and radius are what Material draws: expected Color(0.043, 0.431, 0.310) but was Color(0.404, 0.314, 0.643)
  FAIL OpenVerifyThemeTest Arabic lays out right to left in an English process: expected:<Rtl> but was:<Ltr>
  FAIL OpenVerifyThemeTest the host's locale chooses the language ...: expected:<fr> but was:<null>
  ```
- Strings `77b4ff26`: `strings_theme.xml` in the five folders (the web's own words for "Language", "Get help", "Privacy notice"; the rest drafted, machine-drafted outside English) and their five keys in `review-status.json` (borrowed edit, rule 20, made when `git status` showed the file clean).
- GREEN `e33a9f7f`, run in a scratch worktree (`/tmp/theme-wt`, detached at `77b4ff26` with this slice's files copied in), because the shared tree held other agents' uncommitted test files that did not compile:
  ```
  $ UPDATE_SDK_STRING_TABLES=1 ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.i18n.SdkStringTablesTest"   (tables + 25 entries; wall 199 s, lock 0 s, load 3.74)
  $ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.ui.theme.*" --tests "dev.openverify.sdk.ui.OpenVerifyThemeTest" --tests "dev.openverify.sdk.i18n.*"
  exit 0, tests=125 failed=0 skipped=0     (wall 160 s, lock wait 0 s, load 4.51 -> 3.05)
  ```

## Slice 3: the scaffold, the help slot, the selector and right to left (C197.4, C198.3, C198.10, C199.3, C199.5)

- Stub `ddcc8b0f`: `ChromeTags`, `isAllowedLink` (refuses all), `HelpSlot` (nothing), `SDK_LANGUAGE_NAMES` (empty).
- RED `b51d2a23`: `commonTest ui/help/HelpLinksTest` (`https:` only; each language named in itself) and `androidHostTest ui/scaffold/StepScaffoldTest` (15 cases: content alone outside `OpenVerifyTheme`; links in the web's words opened through the `UriHandler`; operator words in the chosen language with the organisation isolated; an `http:` link left out; the selector among enabled bundled languages, one `DropdownList` control reading "Language, English" with the click label "Change language"; a choice changing every string at once; no slot for one language and no link; the brand header with alt text, decorative with the name, the name alone on a failed fetch; left to right in English, right to left for Arabic in an English host and under `@Config(qualifiers = "ar")`; the logo never mirrored in Arabic).
  ```
  $ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.ui.scaffold.*" --tests "dev.openverify.sdk.ui.help.*"   (worktree)
  tests=18 failed=15                       (wall 84 s after one exit 75 at 240 s, load 3.50 -> 3.95)
  FAIL HelpLinksTest eachLanguageIsNamedInItself(): expected <{en=English, ...}> but was <{}>
  FAIL StepScaffoldTest the help and privacy links show in the web's words ...: could not find ... (TestTag = 'openverify-help-link')
  FAIL StepScaffoldTest the selector is one control ...: (Role = 'DropdownList') ... could not find
  FAIL StepScaffoldTest the brand header shows the logo with its alt text: ComposeTimeoutException
  ```
- GREEN `176a8ddb`: `HelpSlot`, `LanguageSelector`, `BrandHeader`, `StepScaffold`. The one RED case that read pixels through `captureToImage` timed out in Robolectric's `forceRedraw` (the logo had loaded); it now reads the window drawn into a bitmap, with its assertion (the left eighth is the logo's left colour, the right eighth its right colour) unchanged.
  ```
  $ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.ui.scaffold.*"   (worktree)
  exit 0, tests=15 failed=0                (wall 121 s, lock wait 0 s, load 3.77 -> 2.59)
  ```

## Slice 4: the goldens (C219.3, C198.8, C199.5)

- RED `e785c8e6`: `ui/scaffold/ThemeScreenshotTest` (`@Category(ScreenshotTests)`, `w320dp-h480dp-xhdpi`), six goldens of the chrome around a synthetic step, each with `verifyGolden`'s accessibility checks:
  ```
  $ ./gradlew --no-daemon -q :openverify-sdk:screenshotTest -Proborazzi.test.verify=true --tests "dev.openverify.sdk.ui.scaffold.ThemeScreenshotTest"
  tests=6 failed=6: Roborazzi: The original file(.../screenshots/android-theme/chrome-operator-light.png) was not found   (wall 156 s, load 4.55)
  ```
- GREEN `657e0cd9`: recorded once with `-Proborazzi.test.record=true` (165 s), then verified (exit 0, 6 of 6, 32 s). Six PNGs, 640 x 960, 189,642 bytes in all: `chrome-operator-light`, `chrome-operator-dark`, `chrome-operator-light-ar`, `chrome-operator-dark-ar`, `chrome-builtin-light`, `chrome-builtin-dark-ar`.
- **Defect seen in the goldens, in another owner's file (reported, not fixed here):** the step's title is drawn in `danger`. `ThemeMapping.kt` maps `errorContainer` to `surface`; Material 3's `contentColorFor(surface)` tests `errorContainer` before `surface`, so every `Surface` (and every Material container on a `surface`-family colour) takes `onErrorContainer` = `danger` as its content colour, in the operator and the built-in palettes alike. Fix: `errorContainer` from `canvas` (`contentColorFor(canvas)` meets `background` first, so it stays `ink`; `danger` on `canvas` is a gated pair), with `ThemeContrastTest`'s `errorContainer` row moved to `canvas`; then these six goldens are re-recorded. The integration agent owns the fix (rule 1).

## StateHooksTest

- `7df2eb91`: the `android-theme` case replaced by its owner: a coordinator publishes a session theme within its contract, and null (the built-in theme) without one. It passed at once: the GREEN of slice 2 already filled the hook.

## Final gate (rule 17 as split by foundation-10a)

Run in a scratch worktree detached at `d6c69bb6` (the committed tree with every android-theme commit, without other agents' uncommitted files), each call under the Gradle lock in the foreground:

| Step | Call | Exit | Wall (lock wait) | Load before -> after |
|---|---|---|---|---|
| (a) | `:openverify-sdk:testAndroidHostTest` | 0: 1,781 tests, 0 failed, 0 skipped | 272 s (0 s) | 7.93 -> 3.04 |
| (b) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | 0: 43 tests | 211 s (0 s) | 3.10 -> 4.26 |
| (c) | `koverVerify checkKotlinAbi` | 0 | 207 s (0 s) | 4.26 -> 3.24 |
| (d1) | `testDebugUnitTest assembleDebug` | 0 | 85 s (0 s) | 3.24 -> 4.02 |
| (d2) | `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 131 s (0 s) | 3.86 -> 6.06 |
| (e1) | `:openverify-sdk:assemble` (iOS main and test klibs, boundary check) | 0 | 213 s (0 s) | 3.96 -> 8.53 |
| (e2) | `lint` | 0 | 190 s (0 s) | 6.06 -> 4.24 |
| (f) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 74 s (0 s) | 4.24 -> 5.43 |

Earlier runs of (c) and (e1) at `657e0cd9` and `a0bc42b7` failed only in android-screens' files (`ui/screen/ScreenComponents.kt`: Material 3's date picker is experimental for the iOS klibs; `commonTest ui/screen/ScreenModelTest.kt`: test names with commas, which Kotlin/Native refuses); their owner fixed both (`a0bc42b7`, `d6c69bb6`) and the steps passed. `pnpm format:check` in the shared tree: exit 0 (167 s, load 3.87 -> 10.35).

Coverage (Kover XML at `657e0cd9`): `:openverify-sdk` 97.09% of lines; `ui/theme` 97.96%, `ui/help` 97.14%, `ui/scaffold` 100%, `i18n` 99.95%.
