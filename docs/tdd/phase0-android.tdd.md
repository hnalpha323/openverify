# TDD evidence: Phase 0, android

Slice owner: android agent. Date: 2026-10-20.

## Plan task

PLAN §6, Phase 0, step 4 (Android half): the `android/` Gradle build. Its parts are:
- a Gradle wrapper;
- three modules: `:openverify-sdk`, the Apache-2.0 Compose library; `:openverify-nfc`, the optional LGPL module, with no dependencies yet; and `:demo-app`;
- the first piece of tested SDK logic: ICAO 9303 check digits and the BAC `MRZ_information` string, which Phase 10 NFC reading builds on;
- a Kover line-coverage gate of at least 80% on `:openverify-sdk` (PLAN §5 and §7).

Validation command (CLAUDE.md): `(cd android && ./gradlew testDebugUnitTest koverVerify assembleDebug)`.

### Toolchain versions

All versions were checked on 2026-10-20 against Google Maven, Maven Central and services.gradle.org.

| Tool | Version | Notes |
|---|---|---|
| Gradle (wrapper, `bin`) | 9.8.2 | The zip matched the published `.sha256` (`21bd5da2…e389607`), which is pinned as `distributionSha256Sum`. `gradle-wrapper.jar` matched `gradle-9.8.2-wrapper.jar.sha256` (`3b8a2577…ce68e98`). |
| Android Gradle Plugin | 9.4.1 | Latest stable. AGP 9.4 needs Gradle 9.6.0 or later. |
| Kotlin | 2.4.21 | Uses AGP 9 **built-in Kotlin**. `org.jetbrains.kotlin.android` is not applied, as the AGP 9.0 release notes and the "Migrate to built-in Kotlin" guide direct. AGP 9.4.1 depends on KGP 2.2.10 at runtime; a root `buildscript` classpath entry raises it, as the release notes describe. `buildEnvironment` shows `kotlin-gradle-plugin:2.2.10 -> 2.4.21`. |
| Compose compiler plugin | 2.4.21 | `org.jetbrains.kotlin.plugin.compose`, which is versioned with Kotlin. |
| Compose BOM | 2026.06.01 | **Not the latest BOM.** See Deviations. |
| activity-compose | 1.13.0 | `minCompileSdk=36`. |
| Kover | 0.9.11 | AGP 9 support was fixed in 0.9.5. |
| JUnit Jupiter | 5.14.4 | JUnit 5 line, test scope only. See Deviations. |
| SDK levels | compileSdk 36, targetSdk 36 (app), minSdk 26 | |
| JVM toolchain | 21 | Sets `java.toolchain`. AGP did not require Java target 17: classes compile to major version 65 and D8 dexes them. |

## Tests (written first)

The test vectors are ICAO Doc 9303 specimen data from the Eighth Edition (2021). They were read from the official PDFs at icao.int, and I checked the arithmetic against an independent oracle before writing the tests.

`android/openverify-sdk/src/test/kotlin/dev/openverify/sdk/mrz/MrzTest.kt` has 17 test cases for `Mrz.checkDigit`:
- Part 3, Appendix A, Example 1: `520727` → 3.
- Part 3, Appendix A, Example 2: `AB2134<<<` → 5.
- The field check digits printed in the Example 3 and Example 4 MRZ lines: `HA672242<` → 6, `580225` → 4, `960108` → 6, `<<<<<<<<<<<<<<` → 0, `D23145890` → 7, `340712` → 7, `950712` → 2.
- Composite check digits, built from the documented character positions:
  - TD3 (Example 3) → 8;
  - TD1 (Example 4) → 2;
  - TD2 (Example 5) → 8.
- Rejects characters outside `0-9 A-Z <`: lower case, space, `-`, `Ä`.
- The error message does not echo the field value, because MRZ data is PII.

`android/openverify-sdk/src/test/kotlin/dev/openverify/sdk/mrz/BacKeySeedTest.kt` has 13 test cases for `BacKeySeed.mrzInformation`:
- Part 11, Appendix D.2: `L898902C` / `690806` / `940623` → `L898902C<369080619406236`. The document number is padded with `<` to 9 characters.
- The same document number already padded (`L898902C<`) gives the same result.
- Part 11, Appendix D.2, "document number exceeds 9 characters": `D23145890734` / `340712` / `950712` → `D23145890734934071279507122`. The full number is used.
- Part 3 §4.8: unknown date-of-birth positions are `<` and count as 0. `69<<<<` gives `L898902C<369<<<<99406236`.
- Rejects an empty document number, a lower-case document number, and dates that are not 6 characters of `0-9`/`<`. That covers 6 cases: too short, too long, the letter O, a letter, and punctuation.
- The error message does not echo the date.

To make the tests fail for the intended reason (behavior missing) and not on compilation, `Mrz` and `BacKeySeed` were committed as `TODO()` stubs.

## RED

Command (from `android/`):

```
./gradlew :openverify-sdk:testDebugUnitTest --console=plain
```

Output excerpt:

```
MrzTest > Part 3 Example 1 - date 520727 has check digit 3() FAILED
    kotlin.NotImplementedError at MrzTest.kt:19

BacKeySeedTest > Part 11 D-2 - 9-character document number is padded with a filler() FAILED
    kotlin.NotImplementedError at BacKeySeedTest.kt:21

BacKeySeedTest > rejects an empty document number() FAILED
    org.opentest4j.AssertionFailedError at BacKeySeedTest.kt:103
        Caused by: kotlin.NotImplementedError at BacKeySeedTest.kt:54
...
30 tests completed, 30 failed
> Task :openverify-sdk:testDebugUnitTest FAILED
BUILD FAILED in 9s
```

All 30 failures trace back to `kotlin.NotImplementedError` from the stubs. The validation tests fail because `assertThrows<IllegalArgumentException>` received `NotImplementedError` instead.

RED commit: `d5b4485 test(android): ICAO 9303 check digit and BAC MRZ_information specs (RED)`.

## GREEN

Implementation:
- `Mrz.checkDigit`: modulus 10 with a repeating 7-3-1 weighting. Values are `0-9` → 0–9, `A-Z` → 10–35, `<` → 0. Any other character throws `IllegalArgumentException`, and the message gives only the position.
- `BacKeySeed.mrzInformation`: validates its inputs, pads the document number to 9 characters with `<` (`padEnd`, so longer numbers pass through unchanged), and appends a check digit to each of the three fields.

Command (from `android/`, after `./gradlew clean`, with the build cache disabled):

```
./gradlew testDebugUnitTest koverVerify assembleDebug --no-build-cache --console=plain
```

Output excerpt:

```
> Task :openverify-nfc:testDebugUnitTest NO-SOURCE
> Task :openverify-nfc:assembleDebug
> Task :openverify-sdk:assembleDebug
> Task :demo-app:testDebugUnitTest NO-SOURCE
> Task :openverify-sdk:testDebugUnitTest
> Task :openverify-sdk:koverVerify
> Task :demo-app:assembleDebug
BUILD SUCCESSFUL in 14s
112 actionable tasks: 102 executed, 10 up-to-date
```

JUnit XML results: `dev.openverify.sdk.mrz.BacKeySeedTest` tests="13" failures="0" errors="0"; `dev.openverify.sdk.mrz.MrzTest` tests="17" failures="0" errors="0".

GREEN commit: `5d67139 feat(android): implement ICAO 9303 check digit and BAC MRZ_information (GREEN)`.

## Refactor

- `14b2188 refactor(android): drop unused Compose tooling deps from openverify-sdk`. The SDK has no previews. As an `implementation` dependency, `ui-tooling-preview` would have reached consumers' runtime classpath. Re-ran the clean build above: still 30/30 and 100%.
- `6bf4c57 chore(android): keep demo app data out of backups and device transfer`. This is a lint follow-up, not part of the TDD cycle. It adds `dataExtractionRules` (Android 12+) and `fullBackupContent` rules that exclude every domain, plus a default icon.

## Coverage

Gate: `kover { reports { verify { rule("openverify-sdk line coverage") { bound { minValue = 80; LINE; COVERED_PERCENTAGE } } } } }`. The gate excludes `@Composable`/`@Preview`-annotated code, `ComposableSingletons`, and Android-generated classes. Compose UI gets Robolectric/Compose UI tests in Phase 10.

`./gradlew :openverify-sdk:koverLog`:

```
application line coverage: 100%
```

`openverify-sdk/build/reports/kover/report.xml` (totals; the classes measured are `Mrz` and `BacKeySeed`):

```
<counter type="INSTRUCTION" missed="0" covered="168"/>
<counter type="BRANCH" missed="0" covered="24"/>
<counter type="LINE" missed="0" covered="17"/>
<counter type="METHOD" missed="0" covered="6"/>
<counter type="CLASS" missed="0" covered="2"/>
```

To show the gate is enforced, I temporarily removed the Compose exclusions from `openverify-sdk/build.gradle.kts` and ran `./gradlew :openverify-sdk:koverVerify :openverify-sdk:koverLog`. The file was restored afterwards, and `git diff` was empty.

```
> Task :openverify-sdk:koverVerify FAILED
application line coverage: 70.8333%
> Rule 'openverify-sdk line coverage' violated: lines covered percentage is 70.833300, but expected minimum is 80
BUILD FAILED in 4s
```

## Other checks

- `./gradlew lint`: 0 errors in every module. The warnings left are the deliberate pins: compileSdk/targetSdk 36 while 37 is available, Compose BOM 2026.09.00 available, and JUnit 6.1.3 available.
- `gitleaks git --log-opts="9504a64..HEAD -- android"` (8.30.1): `5 commits scanned … no leaks found`. `gitleaks dir docs/tdd/phase0-android.tdd.md`: `no leaks found`. The repo's `.githooks/pre-commit` is not enabled in this clone (`core.hooksPath` is unset), so these manual scans are the only secret check on these commits.
- `git check-ignore`: `android/local.properties`, `android/.gradle` and `android/*/build` are ignored. `ANDROID_HOME` comes from `scripts/env.sh`.

## Deviations and decisions

1. **The Compose BOM is 2026.06.01, not the latest (2026.09.00).** BOM 2026.08.00 and later ship Compose UI 1.12.x. The AAR metadata of `ui-android` 1.12.0 and 1.12.1 declares `minCompileSdk=37`, and the Compose compiler docs say Compose 1.12.0 requires compileSdk 37. That conflicts with the required compileSdk 36. 2026.06.01 (Compose 1.11.4, `minCompileSdk=35`) is the newest compatible BOM.
2. **JUnit is EPL-2.0**, and EPL is not on the permissive list in CLAUDE.md. The task offered JUnit 5 or JUnit 4 (EPL-1.0), so both options are EPL. It is used only in test scope and is never shipped in the AAR or APK. JUnit 6.1.3 is the newest Jupiter release; 5.14.4 follows the task's "JUnit 5" and PLAN §5.
3. **Java target 21**, the toolchain default. AGP 9.4.1 accepted it: bytecode major version is 65, and `assembleDebug` dexes it. If the SDK is published to third parties, consider pinning `compileOptions` to 17 for older consumer toolchains.
4. On the first build, AGP auto-installed **build-tools 36.0.0**, its default, into `~/Android/Sdk` (outside the repo). Before that, only 36.1.0 was present.
5. A Gradle 10 deprecation warning (`Configuration.setVisible`) comes from AGP 9.4.1 internals (`BasePlugin.kt:362`, `SourceSetManager.kt:124`), not from our build scripts.
6. Kotlin sources use PascalCase file names (`Mrz.kt`), following the Kotlin convention. Module and directory names are kebab-case.
7. The namespace and applicationId are `dev.openverify.*`. Confirm them before publishing to Maven Central.
