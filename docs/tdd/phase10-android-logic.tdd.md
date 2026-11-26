# Phase 10, Workflow 10A Stage 2: android-logic

Built beside foundation-10a, android-i18n and api-android-10a, on the Stage 1a tree (`04cfac9c`). Every Gradle call ran as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)` in the foreground; each timing below is the whole call, with the lock wait and `/proc/loadavg` beside it. The working tree is shared, so a full host-test count includes other agents' tests in it at that moment.

Everything here is pure and in `commonMain`, with its suites in `commonTest` (run by `testAndroidHostTest` on the JVM now and on the iOS simulator in the next release) unless a test needs the JVM (`Locale.setDefault`, reflection, the source scans), which is in `androidHostTest`.

## Checkpoint 1: visibility and patterns (C196.1, C196.2, C196.4)

### Stubs (`cf86dd17`)

`flow/logic/Visibility.kt`: `VisibilityRuleLimits`, `VisibilityRuleRefused(code)`, `evaluateVisibility` answering `true`, `visibilityValueOf` answering JSON `null`. `flow/logic/pattern/Patterns.kt`: the limits, `CompiledPattern`, `PatternCompilation`, `PatternRun`, and `compilePattern` refusing everything (`syntax`), `matchPattern`, `runPattern`, `matchPatternSource` matching nothing, `programLength` 0.

### RED (`4623b1a9`)

Hand cases from Phase 9's rules (`visibility.ts`, `pattern/parse.ts`, `vm.ts` and their tests), before the vectors landed: `VisibilityTest` (10) and `PatternTest` (10) in `commonTest/.../flow/logic/`.

`./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests "dev.openverify.sdk.flow.logic.*"`: exit 1 in 175 s (lock wait 76 s, load 11.29), `20 tests completed, 18 failed`, each for the intended reason:
- `VisibilityTest`: `Expected an exception of class dev.openverify.sdk.flow.logic.VisibilityRuleRefused to be thrown, but was completed`, `Expected value to be false.`, `expected: <"US"> but was: <null>` (the stub's answers). `anAbsentRuleHolds` and `readsAFieldWithNoValueAsNull…` pass on the stub's `true`.
- `PatternTest`: `refused abc: syntax at null`, `refused (?:a|a)*: syntax at null` and the refusal table `expected: <[]> but was: <[: (syntax, null), expected (empty, null), …`.

### GREEN (`95d3f04c`)

- `Visibility.kt`: the port. `checkVisibilityRule(rule, screenFields)` (the codes in Phase 9's order), `evaluateVisibility(rule, values)` over `JsonElement`s with ECMAScript's types (strict equality, numbers by value, JSONLogic truthiness, `in` over a list or a string), `screen.<field>` checked by hand because a JVM `Regex` `$` matches before a final line feed where ECMAScript's does not, and `visibilityValueOf(FlowValue)` as the web's `visibilityValues` reads a value (an empty text is `null`, a held `{set: true}` an object).
- `pattern/PatternParser.kt`, `pattern/PatternVm.kt`, `pattern/Patterns.kt`: the grammar into a tree (code points as ECMAScript's `codePointAt` reads them, bounds read as `Number` reads them so `{99999999999999999999}` is `quantifier_too_large`), the Pike VM over `IntArray`s with a step count (each stack pop and each look at a live instruction), the 2,048-instruction cap, the 500-character source and 10,000-character input caps. No `Regex` is built from a pattern's text.
- One RED hand case was wrong and is corrected in the same commit: `{"in": [["music"], [["music"]]]}` is refused by Phase 9's checker (a literal list holds scalars only), so the case now asserts that refusal, and a field's list as the needle is the non-member case.

`… --tests "dev.openverify.sdk.flow.logic.*"`: exit 0 in 117 s (lock wait 21 s, load 5.51); `VisibilityTest` 10, `PatternTest` 10, none skipped or failed.

### The vector suites (`f00597ceb`)

api-android-10a's checkpoint 2 landed `contracts/fixtures/flow-spec/{visibility,pattern,digits}-vectors.json` (`786c56e1`). `VisibilityVectorsTest` (2) and `PatternVectorsTest` (3), in `commonTest`, read them through `readContractFixture`:
- visibility: all 47 cases give the server's answer and all 23 refusals throw `VisibilityRuleRefused` (asserted at least 40 and 20);
- patterns: all 579 match vectors and all 49 refusals with their reasons (asserted more than 500 and at least 40; every reason is one of `PATTERN_REFUSAL_REASONS`); the 8 pathological vectors stay within `4 x (input length + 1) x (program length + 1)` VM steps (asserted at least 6).

They passed at once: `… --tests "dev.openverify.sdk.flow.logic.*"`, exit 0 in 75 s (lock wait 5 s, load 3.98), 25 tests.

The step budget is a count of the algorithm (rule 6), in `commonTest`; no CPU-time guard was added on the JVM (the plan allows one at most, and the count is the deterministic proof).

### Checkpoint gate

- `:openverify-sdk:testAndroidHostTest`: exit 0 in 105 s (lock wait 27 s, load 6.57 to 5.36); 1,461 tests, 0 skipped, 0 failed (the base's 1,416, my 25, and 20 of other Stage 2 agents' tests then in the tree).
- `:openverify-sdk:assemble :openverify-sdk:compileTestKotlinIosSimulatorArm64` (the AAR and the iOS main and test klibs): exit 0 in 116 s (lock wait 25 s, load 5.55 to 10.33).

Which suites run on the iOS simulator in the next release: `VisibilityTest`, `VisibilityVectorsTest`, `PatternTest`, `PatternVectorsTest` (all `commonTest`).

## Checkpoint 2: the theme mapping (C198.2, C198.5)

### Stubs (`a34838ec`)

`ui/theme/ThemeMapping.kt`: `ThemeToken`, `ThemePalette.of` answering null, `ThemeVariant`, `RoleSource`, an empty `COLOR_SCHEME_ROLES`, `colorSchemeOf` answering Material's `lightColorScheme()`, `shapesOf` Material's default `Shapes()`, `themeVariantOf` always light, an empty `BUILTIN_PALETTES`, `MappedTheme` and `mappedThemeOf` answering the baseline.

### RED (`04cb2c54`)

- `commonTest/.../ui/theme/ThemeMappingTest.kt` (10): the palette's twelve lower-case tokens, the built-in palettes against `contracts/fixtures/theme/builtin-palettes.json` (api-android-10a's checkpoint 1, `7fe8fbfd`), the role table, every role from the palette, radius onto `Shapes`, the variant table, and `mappedThemeOf` with no theme, its own theme, a dark or forced dark, and the fail-closed fallback.
- `commonTest/.../ui/theme/ThemeContrastTest.kt` (4): the boundary palettes pass the gate (a test copy of `packages/core/src/contrast`) with a pair within 0.15 of 4.5:1 and of 3:1; every pair the SDK draws (34 rows: text, non-text, focus, pressed; decorative and disabled stated) meets its minimum through the mapped scheme; the built-in palettes too.
- `commonTest/.../ui/theme/SchemeRoles.kt`: the 48 roles by name, and `androidHostTest/.../ui/theme/ColorSchemeRolesTest.kt` (2), which enumerates `ColorScheme`'s public `long` getters by reflection and holds the role table and `schemeRoles` to them, value by value.

`… --tests "dev.openverify.sdk.ui.theme.*"`: exit 1 in 240 s (lock wait 151 s, load 22.84), `16 tests completed, 16 failed`: `java.lang.NullPointerException` (the stub's null palette), `Key LIGHT is missing in the map.`, `expected: <RoundedCornerShape(… 6.0.dp …)> but was: <…>`, `expected: <DARK> but was: <LIGHT>`, the role table `expected: <{primary=primary, onPrimary=on-primary, …` against an empty map.

### GREEN (`1b7d9139`)

`ThemeMapping.kt`: `ThemePalette.of` (exactly the twelve tokens, each `^#[0-9a-f]{6}$`, parsed by hand); `COLOR_SCHEME_ROLES` for all 48 roles of material3 1.4.0 / CMP material3 1.9.0 and `colorSchemeOf` built from it; `shapesOf` (the web scale: `r - 2`, `r`, `r`, `r + 2`, `r + 6`; outside 0 to 24 the built-in 6); `themeVariantOf` (as the web's `chooseVariant` for `SYSTEM`, forced for `LIGHT` and `DARK`); `BUILTIN_PALETTES`; `mappedThemeOf`.

The role choice the contrast test drove: `surfaceContainerLow`, `High` and `Highest` are `surface`, not `canvas`. Material 3 draws `primary` text on them (dialog and date-picker buttons, sheets, elevated buttons, cards, filled fields), and the gate checks `primary` on `surface` only: on the light boundary palette `primary` (`#767676`, 4.54:1 on white) is 3.71:1 on its `canvas` (`#e8e8e8`), so a `canvas` container would fail the "dialog and date picker buttons" row. `surfaceContainer` (menus, `onSurface` text) stays `canvas`, as C198.2 names it.

`… --tests "dev.openverify.sdk.ui.theme.*"`: exit 0 in 130 s (lock wait 14 s, load 5.75); 16 tests, none skipped or failed.

### Checkpoint gate

- `:openverify-sdk:testAndroidHostTest`: exit 0 in 91 s (lock wait 14 s, load 5.97 to 4.87); 1,477 tests, 0 skipped, 0 failed.
- `:openverify-sdk:assemble :openverify-sdk:compileTestKotlinIosSimulatorArm64`: exit 0 in 90 s (lock wait 15 s, load 4.63 to 10.64).

On the iOS simulator in the next release: `ThemeMappingTest`, `ThemeContrastTest` (`commonTest`). `ColorSchemeRolesTest` is the JVM's reflection and stays in `androidHostTest`.

## Checkpoint 3: digits and SHA-256 (C196.3, C196.4, C200.2)

### Stubs (`e2a604de`)

`flow/logic/Digits.kt`: `normalizeDigits` answering its input. `flow/logic/Sha256.kt`: `Sha256.digest` answering 32 zero bytes, `hex` and `hexOfUtf8` answering "".

### RED (`70e450e7`)

- `commonTest`: `DigitsTest` (4, Phase 9's own cases with digits built from code points, a surrogate pair kept whole, other scripts' digits and the code points either side of both ranges unchanged), `DigitsVectorsTest` (1, all 17 cases of `contracts/fixtures/flow-spec/digits-vectors.json`, asserted at least 15), `Sha256Test` (3: FIPS 180-2's `abc`, empty, 448-bit and 896-bit messages and the one-million-`a` message; the padding boundaries 55, 56, 63, 64, 65, 119, 120 and 128 bytes, whose digests are CPython's `hashlib`; a UTF-8 text with two-, three- and four-byte sequences).
- `androidHostTest/.../flow/logic/DeviceLocaleDigitsTest.kt` (10): under `Locale.setDefault` for `ar-EG`, `fa-IR`, `bn-BD`, `mr-IN` and `my-MM`, `normalizeDigits` and `Sha256` answer as under `en-US`; the control shows the hazard on this JVM (Temurin 21, CLDR): a locale-less `String.format("%d", 30)` is not ASCII under each of the five, measured, so `DeviceLocales.digitLocales()` is all five.
- `androidHostTest/.../flow/logic/LocaleFormatScanTest.kt` (2): the matcher over 12 refused and 13 allowed synthetic lines, and the scan over `api/`, `flow/`, `consent/`, `ui/screen/`, `ui/steps/` and `mrz/` in `commonMain`, `androidMain` and `iosMain`. The matcher was a stub answering no line.

`… --tests "dev.openverify.sdk.flow.logic.*"`: exit 1 in 182 s (lock wait 47 s, load 14.05), `45 tests completed, 13 failed`: `ar-EG ==> expected: <0123456789> but was: <٠١٢٣٤٥٦٧٨٩>` (and the four others), `expected: <code 12-34 56 ٫ x> but was: <code ١٢-۳۴ 56 ٫ x>`, the vectors' names, `expected: <ba7816bf…> but was: <>`, the matcher's `expected: <[1, 2, …, 12]> but was: <[]>`. The scan over the real sources and the five controls passed (no hit at this point).

### GREEN (`15b373ab`)

- `Digits.kt`: U+0660-U+0669 and U+06F0-U+06F9 to `'0' + n`, nothing else touched, no locale read.
- `Sha256.kt`: FIPS 180-4 over `IntArray`s; the 64 round constants and 8 initial words were checked against their derivation (the first 32 bits of the fractional parts of the cube and square roots of the first primes) by a one-off Python check before the commit; hex built by hand.
- `LocaleFormatScanTest.kt`'s `localeLessFormatting`: comments left out with line numbers kept (a `//` after `:` is a URL); `String.format(` and `"…".format(` refused unless the first argument is `Locale.ROOT`, `Locale.US` or `Locale.ENGLISH` (`Locale.getDefault()` is the hazard itself); a line naming `DateTimeFormatter`, `NumberFormat`, `DecimalFormat`, `SimpleDateFormat` or `Formatter` refused unless it passes such a locale or is a fixed `ISO_` formatter; imports are not uses.

`… --tests "dev.openverify.sdk.flow.logic.*"`: exit 0 in 274 s (lock wait 15 s, load 6.53); 45 tests, none skipped or failed. The scan finds no hit in today's sources.

### Checkpoint gate

- `:openverify-sdk:testAndroidHostTest`: exit 0 in 318 s (lock wait 110 s, load 15.01 to 18.20); 1,497 tests, 0 skipped, 0 failed.
- `:openverify-sdk:assemble :openverify-sdk:compileTestKotlinIosSimulatorArm64`: exit 0 in 222 s (lock wait 42 s, load 19.56 to 20.14).

On the iOS simulator in the next release: `DigitsTest`, `DigitsVectorsTest`, `Sha256Test`. `DeviceLocaleDigitsTest` and `LocaleFormatScanTest` need the JVM.

## Checkpoint 4: locale and copy resolution (C199.2, C199.6, C199.7)

### Stubs (`bdac9a88`)

`i18n/LanguageChoice.kt`: `SDK_LANGUAGES`, `SDK_DEFAULT_LANGUAGE`, `LanguageChoice`, `canonicalLanguageTag` and `lookupLanguage` answering null, `availableLanguages` every bundled language, `chooseLanguage` English, `isRightToLeft` false. `i18n/OperatorCopy.kt`: `LegalKind`, `CopyKeyRule`, empty `COPY_KEY_RULES`, `COMPONENT_COPY_ATTRIBUTES` and `SDK_COPY_KEYS`, `CopyKeyPlacement`, `placeCopyKey` ignoring everything, `CopyReview`, `reviewCopy` empty, `FilledText`, `fillCopyPlaceholders` null, `ResolvedText`, `ComponentText`, `OperatorCopy` answering built-in, null and false.

### RED (`97534e4f`)

- `commonTest`: `LanguageChoiceTest` (7: canonical tags and the refused ones, RFC 4647 lookup with whole subtags, the enabled locales the SDK bundles, the priority order, the fallback chain, right to left), `OperatorCopyTest` (9: the `COPY_KEYS` rules, the key map's placement, ignored and unsupported keys, the one-pass fill with display isolates and every unfillable form, the chosen language's text or the SDK's own, legal texts failing closed, component fallbacks, `copy-source`), `CopyKeysFixtureTest` (2: every key of `contracts/fixtures/i18n/copy-keys.json`, api-android-10a's `7fe8fbfd`, runs through the mapping; the rules, legal kinds and component attributes are the export's).
- `androidHostTest`: `SdkCopyKeysTest` (1: `SDK_COPY_KEYS` is exactly `i18n/key-map.json`'s entries with a flow key, android-i18n's file), `DeviceLocaleResolversTest` (11: the chooser and the resolver under the five device locales, with the chosen locale equal to the device's and different from it, and a Turkish default that never changes a tag's case).

`… --tests` on the five classes: exit 1 in 342 s (lock wait 47 s, load 27.50), `30 tests completed, 26 failed`: `Key completion.title is missing in the map.`, `expected: <es-MX> but was: <null>`, `ar-EG ==> expected: <LanguageChoice(language=ar, locale=ar-EG)> but was: <LanguageChoice(language=en, locale=en)>`, `expected: <FilledText(logical=Hello Synthetic Bank, 30 days, display=Hello ⁨Synthetic Bank⁩, ⁨30⁩ days)> but was: <null>`, `expected: <Unsupported(legal=RETENTION)> but was: <Ignored>`, `a consent text never falls back to the SDK's words ==> expected: <Unsupported> but was: <BuiltIn>`.

### GREEN (`efc00f1e`, then `a6d4db64`)

- `LanguageChoice.kt`: a syntactic BCP 47 check with canonical case (no alias mapping, which no bundled language needs), Phase 9's `lookupLanguage`, `chooseLanguage` over the selector, the request and the device's locales against the enabled locales the SDK bundles, then the version's default, English, the first available; `isRightToLeft` for Arabic.
- `OperatorCopy.kt`: `COPY_KEY_RULES` (Phase 9's 20 keys), `SDK_COPY_KEYS` (the key map's 10 entries with a flow key), `placeCopyKey`, `reviewCopy`, `fillCopyPlaceholders` (one pass, braces only around a name of the key's closed list with a value, else null), `OperatorCopy.forResource` (the chosen language's custom text, else the SDK's own; an unfillable custom text is unsupported for a legal key and built-in otherwise), `component` (the chosen language's, then the default's, never a raw key) and `isCustom`.
- `a6d4db64` (fix): the Android gate's iOS test-klib compile refused `toSortedMap`, which is JVM-only, in `CopyKeysFixtureTest`; the test now compares the two maps directly (equality ignores order). No assertion changed.

On the five classes: exit 0 in 208 s (lock wait 69 s, load 26.69); 30 tests, none skipped or failed.

On the iOS simulator in the next release: `LanguageChoiceTest`, `OperatorCopyTest`, `CopyKeysFixtureTest`. `SdkCopyKeysTest` (a repository file) and `DeviceLocaleResolversTest` need the JVM.

## The final gate (the Android gate of rule 17, and format)

foundation-10a had not yet registered `screenshotTest` or the ABI checks, so steps (b) and (c)'s `$ABI_CHECKS` were skipped; (c) ran `koverVerify` alone. Each is its own foreground call under the Gradle lock.

| Step | Command | Exit | Time | Lock wait | Load |
|---|---|---|---|---|---|
| (a) | `:openverify-sdk:testAndroidHostTest` | 0 | 239 s | 108 s | 24.50 to 11.80 |
| (b) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | not registered yet | | | |
| (c) | `koverVerify` | 0 | 60 s | 21 s | 10.00 to 19.17 |
| (d) | `testDebugUnitTest assembleDebug :demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 73 s | 0 s | 10.75 to 7.97 |
| (e) | `:openverify-sdk:assemble :openverify-sdk:compileTestKotlinIosSimulatorArm64 :openverify-sdk:compileTestKotlinIosArm64 lint` | 1, then 0 after `a6d4db64` | 213 s, then 274 s | 0 s, 14 s | 7.18 to 8.88, 9.63 to 6.03 |
| (f) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 170 s | 81 s | 5.52 to 11.51 |

- (a): 1,527 tests, 0 skipped, 0 failed (the base's 1,416, android-logic's 91, the rest other Stage 2 agents' then in the tree).
- (a) again after `a6d4db64`: exit 1 in 134 s (lock wait 38 s, load 5.26 to 5.50), `1529 tests completed, 1 failed`: `ConsentEvidenceBodyTest > evidenceIsSentAsTheConsentBodysThreeMembers()`, another agent's committed RED (`dba329f3`, `commonTest/.../consent/`, not android-logic's), failing for its own intended reason. Every android-logic class passed. Re-run below once that owner's GREEN lands.
- Line coverage (`:openverify-sdk:koverXmlReport`, exit 0 in 79 s, lock wait 57 s): `flow/logic` 98.47% (193 of 196 lines), `flow/logic/pattern` 100% (331), `i18n` 100% (150), `ui/theme` 100% (191); the module 95.53%.
- `pnpm format:check`: exit 0 in 134 s; `pnpm exec prettier --check docs/tdd/phase10-android-logic.tdd.md` (Markdown is outside `format:check`): clean.
- (a) once more after that owner's GREEN (`cf399887`): exit 0 in 247 s (lock wait 0 s, load 6.09 to 10.49); 1,533 tests, 0 skipped, 0 failed.

## Commits

Checkpoint 1 `2dd9d099` (stubs `cf86dd17`, RED `4623b1a9`, GREEN `95d3f04c`, vectors `f00597ce`); checkpoint 2 `605c4d9c` (`a34838ec`, `04cb2c54`, `1b7d9139`); checkpoint 3 `79d54c30` (`e2a604de`, `70e450e7`, `15b373ab`); checkpoint 4 `293681b5` (`bdac9a88`, `97534e4f`, `efc00f1e`, fix `a6d4db64`).
