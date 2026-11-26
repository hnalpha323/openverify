# Phase 11, Workflow 11A: `clients-connect` (family U)

The share-consent step on the web (C238.6, C237.4, C237.6) and on Android (C238.7, C256.1,
C256.2), with KP11-2. Every command below ran in the main tree, in the foreground, after
`source scripts/env.sh`. Times are wall times; the load is `cat /proc/loadavg`'s first figure.
Other Stage 3 agents ran beside this one throughout (rule 23), so the load is high.

## Web checkpoint

### Stubs (`6a6caabc8`)

`FlowApiClient.acceptShareConsent`, `declineShareConsent` and `withdrawShareConsent` (rejecting),
passed through by `withFinalOutcomes`; the verification fake's three members
(`flow/submit-verification.test.ts`); `ShareConsentStep` and `WithdrawableShareConsents` rendering
nothing; the step's catalogs in `steps/share-consent/locales/{en,es,fr,de,ar}.ts`, not joined.

```
$ cd apps/flow && pnpm exec tsc --noEmit            -> rc=0
$ pnpm exec eslint src/steps/share-consent ...       -> rc=0
```

### RED (`e7484117d`)

Tests in `apps/flow/src/steps/share-consent/`: `share-consent-client.test.ts` (the three exits),
`share-consent-texts.test.ts` (the eight `share.consent.*` keys in five catalogs, categories in
words, `{withdraw}` never composed empty through `connect-logic`'s `composeShareConsentText`,
`counsel-unreviewed`, the locale export), `share-consent-step.test.tsx` (the screen),
`withdrawable-share-consents.test.tsx` (the affordance), `share-consent-flow.test.tsx` (the position,
the renderer, the affordance on a later screen and on the completion screen), with the fake's
answers in `testing.ts`.

```
$ pnpm exec vitest run src/steps/share-consent --coverage.enabled=false     (load 4.27)
 Test Files  5 failed (5)
      Tests  74 failed | 10 passed (84)
   AssertionError: share.consent.title: expected undefined to deeply equal Any<String>
   TestingLibraryElementError: Unable to find an accessible element with the role "heading" ...
$ pnpm exec vitest run src/steps/share-consent/share-consent-client.test.ts --coverage.enabled=false
      Tests  5 failed | 1 passed (6)     (the stubs reject: "acceptShareConsent is not built yet")
```

79 of 90 failed for the intended reason (nothing built, no catalog joined); the 11 that passed
assert absences the stubs already satisfy (nothing sent before a choice, a malformed body refused).

### GREEN (`d65840940`)

The exits (`api/flow-api-client.ts`, async, the step id checked against `stepIdSchema` before it
reaches a URL), the `share-consent` position (`flow/flow-position.ts`), its dispatch and the
withdrawal hook line (`flow/flow-renderer.tsx`), the screen and the affordance, the catalogs joined
(one import and one member line in each of `i18n/locales/{en,es,fr,de,ar}.ts`), and
`CONSENT_TEXT_GROUPS` widened with `share.consent` (`i18n/locale-export.ts`) so the export carries
the texts into `consent-texts.json`. `locale-export.test.ts`'s group rule was widened by one line,
because the behaviour it checks changed.

```
$ pnpm exec vitest run src/steps/share-consent src/i18n src/flow src/api --coverage.enabled=false  (load 5.88)
 Test Files  1 failed | 41 passed (42)
      Tests  9 failed | 699 passed (708)       (locale-export: the exports not re-run yet)
$ pnpm --filter @openverify/flow i18n:export
 Wrote contracts/fixtures/i18n/{en,es,fr,de,ar}.json, consent-texts.json, apps/flow/src/i18n/catalog-version.ts.
   consent-texts.json: +105 entries under web-f753624327cec872 (21 keys x 5 locales), none changed
$ pnpm exec vitest run src/i18n src/steps/share-consent --coverage.enabled=false
      Tests  326 passed (326)
```

The unknown-category case (`shows the unsupported screen for a category it has no words for`) was
written beside the implementation, not run RED on its own: the stub would have failed it, but it
was added after the RED commit. It is green since `d65840940`.

Consumers of the re-exported fixtures, each green on the new files:

```
$ (apps/api) vitest run consent-texts.android.test.ts locale-review.test.ts session-copy.test.ts  -> 12 passed
$ (apps/dashboard) vitest run src/components/translations/copy-key-catalog.test.ts             -> 6 passed
$ (packages/flow-spec) vitest run src/export-vectors.test.ts                                   -> 18 passed
$ (android) flock gradle ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest \
    --tests '*ConsentTextsTableTest' --tests '*LegalKeyMapTest' --tests '*CopyKeysFixtureTest' \
    --tests '*ConsentDigestScreenTest'                                      (load 8.85, lock wait 0 s)
 BUILD SUCCESSFUL in 1m 41s
```

### The accessibility matrix and the preview (RED `95ada6892`, GREEN `374044676`)

`share_consent` joins the mocked suite's `CLIENT_STEP_TYPES` (`e2e/support/a11y-matrix.ts`) with
its arrival and a `share_consent:withdrawable` state, each with a recipe (`a11y-states.ts`), and the
step registry's split (`src/screens/step-registry.test.tsx`), each a named borrowed edit.

```
$ pnpm exec vitest run src/a11y-matrix.test.ts src/screens/step-registry.test.tsx --coverage.enabled=false
      Tests  2 failed | 13 passed (15)
   × names the web flow’s client step types, as the step registry renders them
   × splits every client step type between the live components and the preview placeholders
```

GREEN: `share_consent` in `PREVIEW_PLACEHOLDER_TYPES` (its accept and decline post to the flow
API, so the preview draws a placeholder).

```
$ pnpm exec vitest run src/a11y-matrix.test.ts src/screens src/preview src/steps/share-consent
      Tests  156 passed (156)
$ flock e2e: playwright test --config e2e/playwright.config.ts --project=chromium step-matrix -g share_consent
  10 passed (28.5s)                                           (load 17.74, lock wait 0 s, 37 s)
```

### The mocked spec (`92c3b3aa2`) and the accessibility tree (`b346bb68c`)

`apps/flow/e2e/share-consent-step.spec.ts`, six tests, written after the screen (so not run RED):
accept with the digests and the tick, the tick asked for first, decline, a destination accept
waiting, a digest mismatch never reported, the withdrawal under the completion screen, Arabic.

```
$ flock e2e: playwright test --config e2e/playwright.config.ts --project=chromium share-consent-step
  6 passed (30.3s)                                            (load 13.14, lock wait 0 s, 43 s)
```

The first whole mocked run found no snapshot for the new type in `wcag-steps.spec.ts` (C171.3),
which iterates every client step type; the written tree
(`e2e/wcag-steps.spec.ts-snapshots/share-consent.aria.yml`) was read, found right and committed.
The buttons now sit in their DOM order at every width (decline, then agree), so focus follows what
is seen.

### Checkpoint gates (web)

```
$ pnpm --filter @openverify/flow typecheck                       rc=0  162 s  (load 19.20)
$ pnpm --filter @openverify/flow lint                            rc=0  189 s
$ (apps/flow) vitest run --coverage --coverage.reportsDirectory=<scratch>/cov-flow/web
 Test Files  134 passed (134)
      Tests  1625 passed (1625)
 All files          |   94.95 |    88.26 |    95.8 |   95.21 |
 .../share-consent  |   98.19 |    94.36 |     100 |   98.14 |      rc=0  408 s  (load 12.49 -> 26.19)
$ flock e2e: pnpm --filter @openverify/flow e2e                  rc=0  219 s  (load 18.40, lock wait 0 s)
  349 passed (3.6m)     (332 before 11A, + 6 share-consent-step, + 10 step-matrix, + 1 wcag-steps)
$ pnpm exec prettier --check <every file touched>                rc=0
```

An earlier whole mocked run, at load 25 to 34, failed two tests outside this area, each green when
re-run at once with the same build: `e2e/screens.spec.ts:37` (axe's `analyze` passed the 30 s test
timeout) and `e2e/selfie-capture.spec.ts:127` (the guidance message had not changed within 5 s).
Neither file is this agent's; both are reported in the handoff, not called flaky.

## Android checkpoint

Every Gradle call below ran in the foreground as `(cd android && flock -E 75 -w 240
/tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)`, after `fetch_models.py --only
face_detection_yunet` and `fetch_fixtures.py --only person_a_id`; the lock wait was 0 s on every
call. The load average stayed between 7 and 35 throughout (other Stage 3 agents' suites).

### Stubs (`ea6d757c5`)

`model/ShareConsent.kt` (the wire models: `ShareConsentStep`, `ShareConsentSide`, `ShareConsentText`,
`ShareConsentBiometric`, `FlowWithdrawableShareConsent`, `FlowShareConsentAcceptBody`), the
serializer's encoding branch (`model/Flow.kt`), the session's `withdrawableShareConsents` as a
`@Transient` member (`model/Resources.kt`), `FlowApi.acceptShareConsent`, `declineShareConsent` and
`withdrawShareConsent` (`FlowApiClient` delegating to a `TODO` in `flow/ShareConsent.kt`,
`OneTimeLinkFlowApi` forwarding, the test fake `FakeFlowApi` answering), the coordinator's and
`FlowActions`' exits as no-ops, `ShareConsentView`, `ShareConsentWithdrawals` and the screens drawing
nothing (`ui/steps/ShareConsentStep.kt`).

```
$ ./gradlew :openverify-sdk:compileAndroidHostTest :openverify-sdk:compileCommonMainKotlinMetadata
BUILD SUCCESSFUL in 9m 58s            (load 15.42)
```

### RED (`6c34f3deb`)

`model/ShareConsentWireModelTest`, `api/ShareConsentRequestFixturesTest`, `flow/ShareConsentFlowTest`,
`ui/steps/ShareConsentStepScreenTest`, and the three exits in `WireDataSafetyTableTest`'s and
`ExceptionCanaryTest`'s call tables (named borrowed edits).

```
$ ./gradlew :openverify-sdk:testAndroidHostTest --tests '*ShareConsent*' \
    --tests '*WireDataSafetyTableTest' --tests '*ExceptionCanaryTest'          (load 12.24, 148 s)
93 tests completed, 29 failed
  ShareConsentWireModelTest > the client view decodes as the share_consent step with every member() FAILED
  ShareConsentRequestFixturesTest > each share-consent exit is its committed fixture ... > share-consent-accept.json FAILED
  ShareConsentFlowTest > the step the server composed is shown as served() FAILED
  ShareConsentStepScreenTest > the screen shows the served text, the names and the categories in words FAILED
  WireDataSafetyTableTest > every call reaches its route, the NFC calls included() FAILED
```

The ShareConsentFlowTest cases that passed already (a digest mismatch, an unknown category, no
withdrawal offered) hold absences the stub's `else -> unsupported` already gave.

### GREEN (`87f08349c`)

The decoding (the step registered in `FlowStepSerializer`, `withdrawable-share-consents` decoded),
the renderer in `StepRegistry` (`"share_consent" -> shareConsentRenderer`), `ShareConsentController`
behind the coordinator's three exits and its `adopt` line, the view model's three actions and its
withdrawals flow, `InquiryOutcomes`' branch, the dispatch in `InquiryFlowScreen` with the
withdrawals provided to `StepScaffold`'s one hook line, the screen and the bounded withdrawal card;
the 19 key-map entries with `generateLocaleStrings` re-run alone and their `review-status.json`
rows; the three request fixtures written with `UPDATE_CONTRACT_FIXTURES=1`, their `index.json`
entries and `docs/android/privacy.md` rows in the same commit; KP11-2's catalog states, goldens and
documents.

```
$ ./gradlew :openverify-sdk:generateLocaleStrings                         (load 7.39, 37 s)
  strings_catalog.xml changed in the five folders: +19 strings each, the web's words
$ UPDATE_CONTRACT_FIXTURES=1 ./gradlew :openverify-sdk:testAndroidHostTest --tests '*ShareConsentRequestFixturesTest'
  wrote share-consent-accept.json, share-consent-decline.json ({}), share-consent-withdraw.json ({})
$ (apps/api) vitest run src/routes/flow/flow-requests.android.test.ts --coverage.enabled=false
      Tests  8 passed (8)
$ ./gradlew :openverify-sdk:screenshotTest -Proborazzi.test.record=true \
    --tests '*ShareConsentScreenshotTest' --tests '*ShareConsentLargeFontScreenshotTest'
  12 goldens in screenshots/clients-connect/, 700 KB
```

What the checks found on the way, each fixed before the GREEN commit:

- The English text on an Arabic screen was laid out right to left, its full stop moved to the
  start of the line (seen on the first `-ar-dark-2x` golden): the served texts now take their own
  direction (`TextDirection.Content`). Goldens re-recorded.
- `DataAtRestScanTest`: the biometric tick was `rememberSaveable`. It is now held in memory only,
  so after a rotation it is asked for again, unticked; no saved-state row was added.
- `ProtectionScanTest`: the five controls had no rows; added (the tick, accept, decline and the
  withdrawal protected, the box shown only), and the protected count 27 became 31.
- `A11ySweepTest` at font scale 2.0 (fr, de, es, en-XA): the withdrawal card, between the screen and
  the help slot, pushed the help slot off the window. It now scrolls within at most 200 dp.
  Goldens re-recorded.
- `A11yInventoryTest`: the audit's table and counts were written from
  `build/a11y/inventory-table.md`.

```
$ ./gradlew :openverify-sdk:testAndroidHostTest --tests '*ShareConsent*' --tests '*A11yInventoryTest' \
    --tests 'dev.openverify.sdk.docs.*' --tests 'dev.openverify.sdk.i18n.*' --tests '*FlowSpecMembersTest' \
    --tests '*ContractFixturesTest'                                          (load 27.51, 321 s)
BUILD SUCCESSFUL
```

### The pinning recipe (`f76e5ca4b`)

`CertificatePinningRecipeTest` (3 tests) over a TLS `mockwebserver3` server with okhttp-tls
`HeldCertificate`s: pinned and reached, refused outside its pins with no request read, reached
without pins. It holds behaviour 10A built (`OpenVerifyAndroidTransport.okHttp` keeps the host's
pinner), so it passed on its first run; it was not run RED.

```
$ ./gradlew :openverify-sdk:testAndroidHostTest --tests '*CertificatePinningRecipeTest'   (load 30.03, 176 s)
tests="3" skipped="0" failures="0" errors="0"
```

### Checkpoint gates (Android): the eleven calls, in order, in this session

Lock wait 0 s on every call. Several calls ran past 600 s at a load of 25 to 35 (other agents'
suites); the tool moved each to the background and this agent waited for it in the foreground before
the next call, reading its own exit status. Those are recorded as overruns, not as splits.

| Call                  | Tasks                                                                                                     | Wall              | Load before  | Result                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ----------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| (1) ui                | `testAndroidHostTest -PhostTestGroup=ui`                                                                  | 611 s (overran)   | 26.4         | 532 tests, 0 skipped, 0 failed                                                                                                    |
| (1) flow              | `-PhostTestGroup=flow`                                                                                    | 201 s             | 19.3         | 427, 0, 0                                                                                                                         |
| (1) rest, first part  | `-PhostTestGroup=rest` with `api camera capture consent docs events fixtures i18n`                        | 275 s             | 23.0         | 860, 0, 0                                                                                                                         |
| (1) rest, second part | `-PhostTestGroup=rest` with `log model mrz nfc privacy signals testing` and the root classes by file name | 327 s             | 27.4         | 911, 0, 0 (the split missed `IntegrationScreenDraftsTest`, 2 tests, whose file has another name; call (3)'s whole run holds them) |
| (2)                   | `screenshotTest -Proborazzi.test.verify=true`                                                             | 232 s             | 34.8         | 97 screenshot tests, 0 failed; 217 goldens on disk                                                                                |
| (3)                   | `koverVerify checkKotlinAbi`                                                                              | 1,067 s (overran) | 32.0         | exit 0; its whole host-test run: **2,732 tests**, 0 skipped, 0 failed; the ABI dumps unchanged                                    |
| (4)                   | `testDebugUnitTest assembleDebug`                                                                         | 170 s             | 14.9         | demo 97 + 9 smoke twins, openverify-nfc 116, openverify-face 51                                                                   |
| (5)                   | the release AARs and the demo bundle                                                                      | 471 s             | 16.8         | exit 0                                                                                                                            |
| (6)                   | `:openverify-sdk:assemble` (the AAR and the iOS klibs)                                                    | 180 s             | 31.9         | exit 0                                                                                                                            |
| (7)                   | `lint`                                                                                                    | 631 s (overran)   | 22.7         | exit 0                                                                                                                            |
| (8)                   | the four device-test compilations                                                                         | 755 s (overran)   | 24.5         | exit 0                                                                                                                            |
| (9)                   | `fetch_bundletool.py`; the release checks' tests; the three static checks                                 | 113 s             | 25.0         | 98 tests OK; elf alignment, consumer rules and sizes pass                                                                         |
| (10)                  | `publishAllPublicationsToStagingRepository`, then `-p consumer-check build`                               | 250 s, 373 s      | 33.9, 28.5   | exit 0, exit 0                                                                                                                    |
| (11)                  | `-PopenverifyDemoArtifacts=sdk,nfc`, `sdk,face`, `sdk,nfc,face` `:demo-app:testDebugUnitTest`             | 265, 243, 283 s   | 21.0 to 25.2 | exit 0 each                                                                                                                       |

The SDK's host tests: **2,732** (ui 532, flow 427, rest 1,773), from 2,696 at `contracts-11a`'s close
and the floor's 2,691: +10 `ShareConsentStepScreenTest`, +11 `ShareConsentFlowTest`, +3
`ShareConsentWireModelTest`, +6 `ShareConsentRequestFixturesTest`, +3 `CertificatePinningRecipeTest`,
+3 `ExceptionCanaryTest` calls, and the rest are tests over the new catalog states and sources.
Screenshot tests 95 to 97; goldens 205 to 217 (12 in `clients-connect/`, 700 KB). No device test was
added.

```
$ ./gradlew :openverify-sdk:generateLocaleStrings     (re-run alone)   exit 0; git status clean
$ pnpm --filter @openverify/flow i18n:export          "The locale exports are up to date."
$ (apps/api) vitest run src/routes/flow/flow-requests.android.test.ts  8 passed
```
