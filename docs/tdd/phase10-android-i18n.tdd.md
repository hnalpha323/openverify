# Phase 10, Workflow 10A: android-i18n (TDD evidence)

Area: C199.1 (the key map, `generateLocaleStrings`, `values-fr`, `values-de` and `values-ar`, the review status with per-key digests), C199.5's resource half, C199.8 (plural completeness), C200.2's build-time NFC and placeholder-boundary test, and `ResourcesTest` over five locales. Base `04cfac9c` (Stage 1a's final gates). Every Gradle call ran as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)`, in the foreground, with the lock wait and `cat /proc/loadavg` beside its time.

## Slice 1: five locales (RED)

Tests written first:

- `ui/ResourcesTest.kt`: `LANGUAGES` is the five folders; new tests: "French, German and Arabic name exactly the strings and plurals English names (C199_1)", "each locale folder names its own language for the consent record", "each French, German and Arabic text is its own, but for the listed ones its language writes as English does", "no text carries a bidi control, an isolate or a mark, or draws a direction with an arrow (C199_5)"; the Spanish placeholder test became "each translated text has the same placeholders as its English text" over the five locales, with the web's `{{name}}` placeholders counted too.
- `i18n/KeyMapCatalogTest.kt`: "the English and Spanish catalogs hold exactly the key-mapped strings, in the web's words" became "every locale's catalog holds exactly the key-mapped strings, in the web's words (C199_1)", over the five folders and in the key map's order.
- New `i18n/PluralCompletenessTest.kt` (CLDR's integer rules for the five locales as code, with CLDR's examples; every category, Arabic six; French and Spanish `many` only where the range cannot reach it), `i18n/NfcResourcesTest.kt` (every text NFC; each placeholder of a consent or notice text followed by its end or a stable boundary; the boundary predicate on marks, a Quick_Check=No letter and the conjoining jamo), `i18n/SdkResourceTexts.kt` (the shared reader).

Command (narrow, rule 6):

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.i18n.*' --tests 'dev.openverify.sdk.ui.ResourcesTest'
```

Exit 1 in 276 s wall, of which about 171 s waiting for the Gradle lock (BUILD FAILED in 1m 45s); load 6.04 before, 5.85 after. 32 tests, 11 failed, each for the intended reason (the three new locales do not exist yet); abbreviated:

```
KeyMapCatalogTest > every locale's catalog holds exactly the key-mapped strings ... FAILED
  but was: <[values-fr/strings_catalog.xml is missing, values-de/strings_catalog.xml is missing, values-ar/strings_catalog.xml is missing]>
NfcResourcesTest > every SDK string and generated catalog entry in every locale folder is NFC FAILED
  expected: <[values, values-ar, values-de, values-es, values-fr]> but was: <[values, values-es]>
PluralCompletenessTest > every plural defines each category its language selects, Arabic six FAILED
  but was: <[values-fr/openverify_crypto_expires_in: [one, other], values-fr/openverify_document_pages: [one, other], ...
ResourcesTest > each locale folder names its own language for the consent record FAILED
  expected: <{values=[en], values-es=[es], values-fr=[fr], values-de=[de], values-ar=[ar]}> but was: <{..., values-fr=null, values-de=null, values-ar=null}>
ResourcesTest > French, German and Arabic name exactly the strings and plurals English names FAILED
ResourcesTest > each French, German and Arabic text is its own, but for the listed ones ... FAILED
ResourcesTest > each translated text has the same placeholders as its English text FAILED
```

The other four failures in that run were slice 2's REDs, below.

## Slice 2: review status and the legal key map (RED)

- New `i18n/LocaleReviewStatus.kt` (the record's parser, `keyDigests`, `catalogSha256`, and `effective`, stubbed to return the declared status) and `i18n/LocaleReviewStatusTest.kt` (the digests, the downgrade of a reviewed locale, the partially-reviewed merge, fail closed without digests, `source` and `machine-drafted` unchanged, the committed file equal to each locale's effective status).
- New `i18n/LegalKeyMapTest.kt` over `contracts/fixtures/i18n/copy-keys.json` (api-android-10a checkpoint 1, `fdc00e29`), its check `legalKeyProblems` stubbed to find nothing.

Same run as slice 1; abbreviated:

```
LocaleReviewStatusTest > a text changed or added since the review downgrades the locale ... FAILED
  expected: <PartiallyReviewed(unreviewedKeys=[openverify_added, openverify_business_title], by=A fluent reviewer, ...
LocaleReviewStatusTest > a partially reviewed locale keeps its unreviewed keys that still exist ... FAILED
LocaleReviewStatusTest > without its digests a partially reviewed locale has every key unreviewed (fail closed) FAILED
LegalKeyMapTest > the check finds an unmapped legal key, a mapped key with another mark and a flow key that is not a copy key FAILED
  expected: <[notice.b: mapped as consent, but its copy key is notice, retention.d: a retention copy key the key map does not map, screen.z: not a copy key]> but was: <[]>
```

## Slices 1 and 2 (GREEN)

- Slice 2 (`2a311305`): `LocaleReviewStatus.effective` mirrors Phase 9's `effectiveReviewStatus` over the record's own `keySha256`; `legalKeyProblems` names an unmapped legal copy key, a mark that is not its copy key's and a flow key that is not a copy key.
- Slice 1 (`6a0aea9a`): `values-fr`, `values-de` and `values-ar` hold the seven hand-written files of `values/` (298 strings and plurals each, machine-drafted: 211 take the web flow's words where its English text is the same, 87 drafted here), each with its `openverify_locale`, and the generated `strings_catalog.xml` of the five folders. The key map gained the five contest words (`openverify_contest_{heading,intro,host,link,contact}`, `contest.*`, `legal: decision`, `flowKey: null`) so that the failure screen's contest route (C197.3) shows the web's words rather than drafted ones; `review-status.json` lists them with `strings_catalog.xml`. The catalogs were written by a byte-for-byte prototype of `scripts/generate-locale-strings.gradle.kts` until foundation-10a's task stub exists; checkpoint 1 records the Gradle task rewriting them with no change.

Command:

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.i18n.*' --tests 'dev.openverify.sdk.ui.ResourcesTest' --tests 'dev.openverify.sdk.ui.SpanishMessagesTest' --tests 'dev.openverify.sdk.ui.MessagesTest'
```

Exit 0 in 130 s wall, about 98 s of it waiting for the lock (BUILD SUCCESSFUL in 32s); load 4.77 before, 3.87 after. KeyMapCatalogTest 4, LegalKeyMapTest 2, LocaleReviewStatusTest 7, NfcResourcesTest 3, PluralCompletenessTest 4, SdkStringsSourceTest 1, ResourcesTest 11, SpanishMessagesTest 4, MessagesTest 20: 56 tests, 0 failures.

## The generator wired (checkpoint 1)

foundation-10a's stub (`97b15c84`, `android/openverify-sdk/build.gradle.kts`) registers `generateLocaleStrings` and applies `scripts/generate-locale-strings.gradle.kts` (`81d3e19d`) when it exists; the script configures the task by name.

- Before the stub, in a discarded worktree (`git worktree add --detach /tmp/ov-i18n-spike`, removed with `git worktree remove --force` and `git worktree prune`) with a one-line stub registration: with the five catalogs deleted, the task rewrote them byte for byte (`git status --porcelain` clean but for the stub), stored its configuration-cache entry (38 s wall, load 6.25); with `contest.host` removed from `fr.json` it failed with `generateLocaleStrings: fr has no text for contest.host` (98 s); after the change that builds every catalog before writing any, a deleted `values-ar` catalog was rewritten identically (70 s).
- In the main tree: `./gradlew --no-daemon :openverify-sdk:generateLocaleStrings` exit 0, 92 s wall with about 53 s of lock wait (BUILD SUCCESSFUL in 39s), load 11.10 to 16.15; `git status --porcelain` then showed no change to any catalog (only other agents' untracked files).
- `./gradlew --no-daemon :openverify-sdk:testAndroidHostTest`: exit 0, 122 s wall with about 31 s of lock wait (BUILD SUCCESSFUL in 1m 31s), load 17.52 to 5.98: 1,533 tests, 0 failures, 0 skipped (1,416 at Stage 1a's end; android-i18n's share is +20: ResourcesTest 7 to 11, PluralCompletenessTest 4, NfcResourcesTest 3, LegalKeyMapTest 2, LocaleReviewStatusTest 7).
- Run earlier on this content, each exit 0: `:openverify-sdk:assemble lint` (the AAR and the iOS klibs) 422 s wall, about 58 s of it lock wait, load 13 to 17; `testDebugUnitTest assembleDebug :demo-app:assembleRelease :demo-app:bundleRelease` 397 s, about 156 s lock wait, load 21 to 26; `koverVerify` 61 s, about 51 s lock wait; `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` 194 s, about 58 s lock wait (one earlier try exited 75 after 240 s: lock busy, run again). `screenshotTest` and the ABI check did not exist yet.

## The review status (checkpoint 2)

`android/openverify-sdk/i18n/review-status.json` keeps Phase 9's `LOCALE_REVIEW_STATUS` form: `en` `source`, `es`, `fr`, `de` and `ar` `machine-drafted` (no review is recorded, so no record carries digests: the schema allows `keySha256` only on a `reviewed` or `partially-reviewed` record), and `keys` lists all 317 SDK strings with their files (the five contest words added in `strings_catalog.xml`). The per-key digests and the downgrade are `LocaleReviewStatus` (`keyDigests`: SHA-256 of each NFC text, a plural over its `quantity<TAB>text<LF>` lines sorted by quantity; `catalogSha256`: SHA-256 of the sorted `key<TAB>digest<LF>` lines, as the web's; `effective`: Phase 9's `effectiveReviewStatus` over the record's own `keySha256`), proved by `LocaleReviewStatusTest`'s seven tests (RED `e0473f4d`, GREEN `2a311305`), whose last one holds the committed file to each locale's effective status. All seven passed in checkpoint 1's 1,533-test run.

## The five locales, plurals, NFC and ResourcesTest (checkpoint 3) and the final gates

The three new locales, `PluralCompletenessTest`, `NfcResourcesTest`, `LegalKeyMapTest` and `ResourcesTest` over five locales landed with slices 1 and 2 (a folder that showed French consent words without its own `openverify_locale` would record the consent as English, Stage 1a amendment 11, so each new folder arrived whole). Final calls on the tree after foundation-10a's screenshot wiring (`9e925a10`), each in the foreground, each exit 0:

| Call                                                                                                         | Wall  | Lock wait   | Load before, after |
| ------------------------------------------------------------------------------------------------------------ | ----- | ----------- | ------------------ |
| `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true`                                                | 168 s | about 158 s | 5.66, 10.91        |
| `:openverify-sdk:testAndroidHostTest` (UP-TO-DATE on checkpoint 1's run: 1,533 tests, 0 failures, 0 skipped) | 192 s | about 182 s | 9.31, 7.15         |
| `koverVerify` (no ABI check is wired yet, so `$ABI_CHECKS` is empty)                                         | 54 s  | about 43 s  | 6.58, 7.75         |
| `testDebugUnitTest assembleDebug :demo-app:assembleRelease :demo-app:bundleRelease`                          | 24 s  | 0 s         | 6.80, 6.03         |
| `:openverify-sdk:assemble lint` (the AAR, the iOS main and test klibs)                                       | 38 s  | about 14 s  | 5.64, 4.63         |
| `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest`                                    | 38 s  | about 17 s  | 4.63, 4.55         |
| `pnpm format:check`                                                                                          | 125 s | none        |                    |
| `:openverify-sdk:generateLocaleStrings`, then `git status --porcelain`                                       | 168 s | about 140 s | 6.76               |

After the last call, `git status --porcelain` listed only other agents' work in progress (`android/openverify-sdk/build.gradle.kts`, `api/FlowHttp.kt`, an untracked owner note): no `strings_catalog.xml` changed, so the committed catalogs are what the generator writes.
