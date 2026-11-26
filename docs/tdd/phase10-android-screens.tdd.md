# Phase 10, Workflow 10A: android-screens (TDD evidence)

Owner: `android-screens` (Stage 3, family R). Scope: C195 (the `screen` step and C148's catalogue in
Compose), C197.3 (the failure screen with the contest route), android-screens' part of C213.1, and
`prefillFrom` with C195.2's flags in the verification steps of `ui/steps/`. Base: foundation-10a's
checkpoint 4 (`38342eb5`) and android-logic's checkpoints 1–4.

Every Gradle call ran as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon …)`.
While other Stage 3 agents' work in progress kept the shared tree's host tests from compiling, the
narrow RED/GREEN calls ran in a scratch worktree (`git worktree add --detach /tmp/screens-wt`, under
the git lock), with my files copied in; it is removed at the end (rule 2). The checkpoint and final
gates ran in the shared tree.

## Commits

| Step | Commit | What |
|---|---|---|
| stub | `534b6ba8` | the screen model, field input policy, protections (Android and iOS actuals), the screen environment seam, `strings_screen.xml` ×5 and their `review-status.json` keys (borrowed edit) |
| RED | `0c5ed5bd` | `ScreenModelTest` (19) |
| GREEN | `cba3b7de` | the screen model |
| stub | `563128ef` | `ScreenTags`, the required text keys, the https-only link rule |
| RED | `1e4ce46f` | `ScreenStepScreenTest`, `ScreenFieldInputTest`, `ScreenProtectionsTest`, `FailureScreenTest`, `ScreenTextsTest`, `VerificationStepFieldsTest` |
| RED, corrected | `c558d0ae` | secrets take a plain text or number keyboard (below); the contest heading found as the heading |
| GREEN | `9bb86a04` | the renderer, the components, the failure screen's contest route, `ui/steps/` |
| test | `12ad721c` | `ScreenDeviceLocaleTest` (30), shown failing with the normalisation removed |
| RED | `acc1ffd8` | the heading stays first, the error summary after it (found in the first goldens) |
| GREEN | `5121a5b5` | heading first; supporting text style |
| goldens | `a1ded9eb` | 35 goldens and their tests |
| fix | `a0bc42b7` | the date picker's opt-in, experimental in Compose Multiplatform's iOS Material 3 (the iOS klibs failed to compile at the checkpoint gate) |
| test | `d8bdd7fa` | `ScreenEnvironmentTest` (5), `ScreenComponentsTest` (7) |
| fix | `d6c69bb6` | commonTest names without commas or parentheses, which Kotlin/Native refuses (the iOS test klibs failed at the final gate's (e1)) |

## RED and GREEN, as run

**The screen model** (`ui.screen.ScreenModelTest`), stubs in place, 296 s (load 4.12):

```
19 tests completed, 16 failed
FAIL dates are real calendar days, within the component's range() | expected: <FieldError(code=DATE, limit=null)> but was: <null>
FAIL a rule outside the strict subset is refused and renders the whole screen unsupported (C196 | Expected an exception of class …VisibilityRuleRefused
FAIL the submission holds the visible values, digits normalised where they mean digits, a numbe | expected: <{nickname=FlowValue.Text(<redacted>), …
```

GREEN (worktree, 259 s, load 4.32): `ScreenModelTest 19 0 0 0`.

**The renderer** (`ui.screen.*`, `ui.FailureScreenTest`, `ui.steps.VerificationStepFieldsTest`), stubs in
place, 170 s (load 3.37): `87 tests completed, 58 failed`, each for the stub's reason, for example

```
FAIL components render in order, the first title is the heading … | Expected exactly '1' node but could not find any node that satisfies: (TestTag = 'openverify:screen-heading')
FAIL on API 28 a tap through an obscuring window never presses a submit control | expected:<0> but was:<1>
FAIL the OTP code is a secret … | Failed to assert the following: (ContentType is NOT defined)
FAIL a contest route shows its words … | The component with Text … contains 'Ask for a review'
```

First GREEN attempt: 162 run, 6 failed. Two were defects in the tests' selectors (the contest heading
and link share their English words; the screen heading carried two test tags). Four showed a platform
fact that changed the design, recorded below and in the corrected RED commit `c558d0ae`: Compose 1.11
declares `ContentType.Password` for any `Password` or `NumberPassword` keyboard. GREEN after the
correction: `total 162 failed 0` (149 s, load 3.27), every Phase 5 suite of `ui.steps` included.

**Heading order** (`acc1ffd8`): RED 126 s, `ScreenStepScreenTest 22 1` (the summary rendered above the
heading); GREEN `5121a5b5`: 192 of 192 in `ui.screen`, `ui.FailureScreenTest`, `ui.steps`.

**Device locales** (`ScreenDeviceLocaleTest`, 30 = 5 device locales × 2 SDK languages × 3 cases):
30 of 30 pass. Shown able to fail: with `normalizeTyped` reduced to the identity, `30 tests completed,
20 failed` (`an error's bound is named in ASCII digits[ar-EG device, SDK ar]`, `typed digits in another
script are sent as ASCII[ar-EG device, SDK ar] | List is empty`).

## C195.2 and C213.1: the flags per field kind and API level

Checked by `ScreenFieldInputTest` (the focused field's `EditorInfo` through `onCreateInputConnection`, and
the `ContentType` semantics Compose populates the autofill `ViewStructure` from), `ScreenTextsTest`
(`fieldInputOf`), `VerificationStepFieldsTest` and `ScreenProtectionsTest`.

| Field | `inputType` | Autocorrect | Autofill content type | Data-sensitive (API 34+) |
|---|---|---|---|---|
| `text_input` | TEXT | off | none | yes |
| `text_area` | TEXT, MULTI_LINE, CAP_SENTENCES | on (free text) | none | yes |
| `number` | NUMBER, DECIMAL | off | none | yes |
| `date` | NUMBER | off | `BirthDateFull` for a field named for a birth date, else none | yes |
| `email` | TEXT, EMAIL_ADDRESS | off | `EmailAddress` | yes |
| `phone` | PHONE | off | `PhoneNumber` | yes |
| `url` | TEXT, URI | off | none | yes |
| `masked_text` (secret) | TEXT, masked display | off | **none** | yes |
| address parts | TEXT (postal code CAP_CHARACTERS, the rest CAP_WORDS) | off | `AddressStreet`, `AddressAuxiliaryDetails`, `AddressLocality`, `AddressRegion`, `PostalCode` | yes |
| OTP code (`OtpStep.kt`, secret) | NUMBER | off | **none** (was `SmsOtpCode`) | yes |
| document number (`InputForm.kt`, secret) | TEXT | off | **none** | yes |
| OTP destination, form fields, wallet address and signature | unchanged | unchanged | unchanged | yes |

Submit controls that drop obscured touches on API 26–30 (`ObscuredTouchesFiltered`): the screen's
`submit` buttons and the cancel confirmation's "stop", the OTP send and confirm, the form's continue,
the wallet's two submit buttons, the document's submit.

**What Compose 1.11 could not set** (review P07), each found in the bytecode of
`androidx.compose.foundation` 1.11.4 and confirmed by the tests:

1. `IME_FLAG_NO_PERSONALIZED_LEARNING`: `EditorInfo_androidKt.update` writes `imeOptions` from the
   `ImeAction`, `IME_FLAG_NO_FULLSCREEN`, and `IME_FLAG_FORCE_ASCII` for `KeyboardType.Ascii`, and never
   this flag; `PlatformImeOptions` carries only `privateImeOptions`. The tests assert the flag is absent.
2. A keyboard type that implies no learning: the password variations do, but
   `CoreTextFieldSemanticsModifierNode` then sets `ContentType.Password` (and `EmailAddress` for an email
   keyboard, `PhoneNumber` for a phone one), which tells every autofill service the field holds a password
   and invites it to save the value, the exposure C195.2 rules out first. So the secrets take a plain
   text or number keyboard with autocorrect off, and a keyboard may still learn what is typed.
3. "Not important for autofill" for one node: Compose populates every text field into the autofill
   structure with `ContentDataType` text, `FillableData` and `OnFillData` (inner semantics, which an outer
   modifier cannot override), and has no per-node `setImportantForAutofill`. A secret carries no content
   type, so Compose leaves it out of the auto-commit (save) set it builds from content types, but the
   node is still in the structure without a hint.

API 34+ data sensitivity is Compose's `isSensitiveData` semantics, which its accessibility delegate maps
to `setAccessibilityDataSensitive` and to dropping the node for services that are not accessibility tools.
API 26–30 obscured-touch filtering is `Modifier.dropObscuredTouches()` (androidMain), consuming events whose
`MotionEvent.FLAG_WINDOW_IS_OBSCURED` is set in the initial pass; the test dispatches real
`MotionEvent`s with and without the flag. Robolectric's only offline platform jar is API 36 (rule 9 forbids
fetching others in a test), so the API levels are covered through the injected `LocalPlatformApiLevel`
and the pure tables (`filtersObscuredTouches`, `marksDataSensitive`, 21–36); the real level on the host
(36) marks data and leaves touches to the platform. The suites that the next release runs on the iOS
simulator: `ScreenModelTest`, `ScreenTextsTest` (commonTest).

## Goldens (C219.3)

35 goldens in `android/openverify-sdk/src/androidHostTest/screenshots/android-screens/`, 2,162,178 bytes,
360 dp wide at mdpi, synthetic content only, each with the accessibility checks of `verifyGolden` (ATF's
latest preset, failing on errors; all passed):

- every state in English, built-in light, 1.0 (9): `screen-content`, `screen-form-empty`,
  `screen-form-filled`, `screen-form-errors`, `screen-form-submitting`, `screen-form-refused`,
  `screen-cancel-confirm`, `failure-plain`, `failure-contest-contact`;
- one state per screen in Arabic, dark, 2.0 (2): `screen-form-errors-ar-dark-2x`, `failure-contest-link-ar-dark-2x`;
- the text-heavy screens in the five languages at 1.0 and 2.0 (20): `screen-form-matrix-<lang>[-2x]`,
  `failure-contest-link-<lang>[-2x]`;
- a non-default operator palette that passes the gate (each text pair ≥ 5.2:1, each control pair
  ≥ 4.1:1, measured when written), light and dark (4): `screen-form-errors-operator-{light,dark}`,
  `failure-contest-link-operator-{light,dark}`.

Recorded only by `:openverify-sdk:screenshotTest -Proborazzi.test.record=true --tests "dev.openverify.sdk.ui.screen.ScreenGoldens*"`
(95 s). Verified by `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true`: 37 tests (with the
wiring golden) in 105 s, load 4.0 to 4.7; in the shared tree with the other owners' goldens, 266 s
including a 230 s lock wait.

## Kover

No exclusion was needed (`kover-excludes/android-screens.txt` has none). At the checkpoint gate:
`ui/screen` 90.05% of lines (ScreenModel 98.37%, ScreenRenderer 96.88%, FieldInput, ScreenTexts,
ScreenTags and the protections 100%); `ui/steps` 97.41%; `FailureScreen.kt` 100%; the module 97.09%.
`ScreenEnvironmentTest` and `ScreenComponentsTest` were then added for the environment builder and the
choice, date, phone and image components.

## Host tests

1,555 at foundation-10a's close (the base of Stage 3). android-screens adds 129 host tests and removes
none: `ScreenModelTest` 19, `ScreenTextsTest` 5, `ScreenStepScreenTest` 22, `ScreenFieldInputTest` 10,
`ScreenProtectionsTest` 9, `FailureScreenTest` 5, `VerificationStepFieldsTest` 17, `ScreenDeviceLocaleTest`
30, `ScreenEnvironmentTest` 5, `ScreenComponentsTest` 7; plus 35 screenshot tests in `screenshotTest`. No
existing test was changed.

## The final Android gate (rule 17, foundation-10a's split)

Run on the committed tree at `d8bdd7fa` (with `d6c69bb6`'s renames) in the scratch worktree, because
other Stage 3 agents' uncommitted work kept the shared tree from compiling at the time; each its own
foreground call under the Gradle lock.

| Step | Command | Exit | Time (lock wait) | Load |
|---|---|---|---|---|
| (a) | `:openverify-sdk:testAndroidHostTest` | 0 | 189 s (28 s) | 3.47 → 3.17 |
| (b) | `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | 0 | 121 s (76 s) | 3.31 → 3.86 |
| (c) | `koverVerify checkKotlinAbi` | 0 | 23 s (0 s) | 3.86 → 4.43 |
| (d1) | `testDebugUnitTest assembleDebug` | 0 | 40 s (0 s) | 4.43 → 5.57 |
| (d2) | `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 78 s (0 s) | 4.71 → 5.70 |
| (e1) | `:openverify-sdk:assemble` (first run exit 1: commonTest names; after `d6c69bb6`) | 0 | 146 s (118 s) | 5.70 → 3.86 |
| (e2) | `lint` | 0 | 141 s (0 s) | 3.27 → 3.92 |
| (f) | `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 221 s (185 s) | 3.92 → 5.39 |

(a): 1,740 host tests, 0 failed, 0 skipped (1,555 at Stage 3's start; android-screens' 129 among the
rest). The renamed commonTest suites ran again after `d6c69bb6`: 24 of 24. (b): 43 screenshot tests (the
wiring, android-theme's six and android-screens' 35), 0 failed. `pnpm format:check`: exit 0, 123 s. An
earlier checkpoint gate in the shared tree (at `a1ded9eb`): (a) 1,728 tests green in 302 s with a 121 s
lock wait; (b) green in 266 s with a 230 s lock wait; (c) found the iOS opt-in (`a0bc42b7`), then green
in 173 s with Kover's report above.
