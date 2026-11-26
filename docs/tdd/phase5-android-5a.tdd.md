# TDD evidence: Phase 5, Workflow 5A Stage 2, `android-5a`

C64.2 for the phone, email, crypto wallet (paste only), database and AAMVA steps in the Kotlin
Multiplatform SDK (`android/openverify-sdk`, ADR 0004): wire models, `FlowApi` methods against the
frozen route schemas and golden fixtures, the flow engine, Compose Multiplatform screens in
`commonMain/kotlin/dev/openverify/sdk/ui/steps/`, English and Spanish strings, and the retry hints.

Every command ran from the repository root after `source scripts/env.sh`; Android commands ran in
`android/`. Output is abbreviated to the lines that matter.

## 0. Resume

An earlier run of this area stopped at an account usage limit (2026-10-23, about 01:10) after one
commit, `090eb99` (a stub of the Phase 5 wire models: the five steps, the per-type guidance, the
OTP problem members, the OTP, inputs and crypto request bodies). It left nothing uncommitted and no
evidence file. Checked on resume:

```
$ git status --short            # only other agents' files (packages/checks/src/contact/, apps/flow/src/steps/otp/)
$ git log --oneline 232bfdd..HEAD -- android/
090eb99 chore(android): stub the Phase 5 wire models: ... (C50.3, C52.2, C52.3, C52.7, C55, C57, stub)
```

The stub was read against the plan and the contracts (`flow-spec/src/flow.ts`, `contracts/src/otp.ts`,
`verification-inputs.ts`, `verification-attributes.ts`, `crypto-challenges.ts`) and kept: its step
classes, guidance shapes and bodies match. Its `OtpLimits` were reshaped to the values the flow
uses (the code length bounds and default, section 1).

Baseline before any change (the stub tree):

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest
BUILD SUCCESSFUL
tests 972 failures 0 errors 0 skipped 0 classes 48
```

## 1. Wire models (C50.1, C50.2, C50.3, C52.2, C52.3, C52.7, C55.2, C57.1-C57.3)

Stub (`chore`): `flow/StepAttempts.kt` (`DEFAULT_MAX_ATTEMPTS`, `stepMaxAttempts`, both empty) and
`OtpLimits` with the code length bounds, all `0`.

RED (`test`): `model/Phase5WireModelTest.kt` (26 cases) and `model/ContractSources.kt`, which reads
the constants from the TypeScript sources (`DEFAULT_MAX_ATTEMPTS`, `OTP_CODE_LENGTH`,
`US_JURISDICTIONS`, `DATABASE_FIELDS`, `AAMVA_SOURCES`, `CRYPTO_SIGNING_METHODS`,
`CRYPTO_SIGNATURE_SCHEMES`) so the SDK's copies are checked against the server's.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.model.Phase5WireModelTest'
26 tests completed, 18 failed
  the phone, email, database, AAMVA and crypto wallet steps decode as their own steps (C50_3): expected <[PhoneOtpStep(...)...]> but was <[UnsupportedStep...]>
  a phone verification's guidance gives its countries, code length and open code (C52_2): expected <PhoneNumberGuidance(...)> but was: <null>
  a wrong code's problem says how many tries are left (C52_7): expected: <4> but was: <null>
  a resend that is too soon says when the next one is allowed (C52_7): expected: <2026-10-20T12:01:00.000Z> but was: <null>
  a destination never prints the number or the address (C53_8): Phone(phoneNumber=+15555550100) ==> expected: <false> but was: <true>
  entered values never print (C53_8): DatabaseInputs(nameFirst=Jane, ...
  a wallet challenge decodes from its 201 answer, and never prints its message or the signature (C57_2): FlowCryptoChallenge(... message=... 0xSynthetic ...)
  a wallet challenge whose id breaks the contract does not decode: Expected java.lang.IllegalArgumentException to be thrown, but nothing was thrown.
  the AAMVA issuing authorities are the contracts' US_JURISDICTIONS, in order: expected: <[AL, AK, ...]> but was: <[]>
  each Phase 5 type's default attempts are the contracts' DEFAULT_MAX_ATTEMPTS (C50_1): expected: <{document=3, database=1, ...}> but was: <{}>
  the code lengths are the contracts' OTP_CODE_LENGTH (C55_2): expected: <6> but was: <0>
  ... (the other guidance and attempts cases: null instead of the decoded value)
```

The 8 that pass pin parts of the stub that already matched: the body encodings, the signature
scheme values, the unknown-value fallback and the flow round trip.

GREEN (`feat`): the five steps join `FlowStepSerializer.known`; `guidance`, `inputs-received`,
`attempts-remaining` and `resend-available-at` decode (no longer `@Transient`); `guidanceAs` reads
the guidance as the type's shape or answers `null`; `OtpLimits` holds 6, 10 and 6;
`US_JURISDICTIONS` the 56 codes; `DEFAULT_MAX_ATTEMPTS` and `stepMaxAttempts` mirror C50.1 and
C50.2; a wallet challenge refuses an id other than `cwc_` and a ULID. Destinations, entered values,
challenge messages, signatures, the OTP state's masked destination and a flow view's guidance are
left out of `toString` (C53.8).

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.model.*'
BUILD SUCCESSFUL
tests 147 failures 0 errors 0 skipped 0 classes 4
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest
BUILD SUCCESSFUL
tests 998 failures 0 errors 0 skipped 0 classes 49
```

## 2. The flow API's Phase 5 calls (C52.3, C52.7, C55, C57.1-C57.3)

Stubs (`chore`, two commits): `FlowApi.sendOtp`, `confirmOtp`, `enterInputs`,
`createCryptoChallenge` and `submitCryptoSignature`, each throwing in `FlowApiClient`,
`OneTimeLinkFlowApi` and the test `FakeFlowApi`; `model/InputRules.kt` (`InputField`,
`InputProblem`, `InputRules.problems`, empty); `model/CryptoChains.kt` (the C57.1 table, empty).

RED (`test`):
- `commonTest/.../model/InputRulesTest.kt` (11): the C52.3 lengths, forms and presence, with zod
  4.6.7's email and ISO date rules (read from `node_modules/.pnpm/zod@4.6.7/.../regexes.js`);
- `commonTest/.../api/FlowApiClientContractTest.kt` (+13, MockEngine): each route, body and answer,
  and every id, destination, code, value, chain, address, signature and message outside its
  contract refused before any request;
- `androidHostTest/.../api/FlowApiClientTest.kt` (+2, OkHttp and MockWebServer): the same on the
  wire, with the golden `problems/flow/` answers mapped to the exceptions the flow branches on;
- `androidHostTest/.../api/OneTimeLinkFlowApiTest.kt` (+1): each call reaches the session's client;
- `androidHostTest/.../model/CryptoChainsTest.kt` (5): the fixed chains and the EVM pattern read
  from core's `crypto-chains.ts`.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.api.*' \
    --tests 'dev.openverify.sdk.model.InputRulesTest' --tests 'dev.openverify.sdk.model.CryptoChainsTest'
375 tests completed, 30 failed
  FlowApiClientContractTest > sendOtpPostsThePhoneNumberOrTheEmailAddressToItsRoute(): java.lang.UnsupportedOperationException: stub: C55 send
  FlowApiClientContractTest > aDestinationOrCodeOutsideItsBodyIsRefusedBeforeAnyRequest(): Phone(phoneNumber=<redacted>). Expected an exception of class java.lang.IllegalArgumentException ...
  FlowApiClientContractTest > aWalletChallengeAnswerThatBreaksTheContractIsAnInvalidResponse(): ... Expected ... InvalidResponse ...
  FlowApiClientTest > a code is sent and confirmed as JSON, and the golden OTP problems map to ... (C52_7)(): UnsupportedOperationException: stub: C55 send
  OneTimeLinkFlowApiTest > the Phase 5 calls reach the session's client with every argument ...: UnsupportedOperationException: stub: C55 send
  CryptoChainsTest > only a known chain in its canonical form is a chain id(): tron:0x2b6653dc ==> expected: <false> but was: <true>
  InputRulesTest > aBirthdateIsADayThatExistsInTheGregorianCalendar(): 1900-02-29 ==> expected: <{BIRTHDATE=INVALID}> but was: <{}>
  ... (the other 23: the same stubs)
```

GREEN (`feat`): `FlowApiClient` posts `{phone-number}` or `{email-address}` to `.../otp`,
`{code}` to `.../otp/confirm`, the kebab-case values to `.../inputs`, `{chain-id, wallet-address}`
to `.../crypto-challenges` (reading the 201 challenge itself) and `{crypto}` to `.../submit`. Before
any request it refuses an id that is not `ver_` and a ULID, a destination outside the send body's
bounds, a code that is not six to ten ASCII digits, values that break `InputRules`, a chain id the
contracts do not know (`CryptoChains.isChainId`, core's table and EVM pattern), and an address,
signature or signed message beyond `CryptoLimits` (core `CRYPTO_INPUT_LIMITS`); no message repeats
a value. A challenge whose id or message breaks the contract is an `InvalidResponse`.
`OneTimeLinkFlowApi` forwards each call. `url()` takes several action segments (`otp/confirm`).

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest :openverify-sdk:compileKotlinIosArm64
BUILD SUCCESSFUL
tests 1030 failures 0 errors 0 skipped 0 classes 51
```

## 3. The phone and email steps in the flow engine (C50.7, C52.7, C55, C64.1, C64.2)

Stub (`chore`): `FlowState.Otp` (destination entry or open code, retry hints, the refusal shown, busy,
limited), `OtpChannel`, `OtpCode` (its masked destination left out of `toString`), `OtpError`; no-op
`FlowCoordinator.sendOtp`, `resendOtp`, `confirmOtp`, `changeOtpDestination`, `continueAfterLimit`;
placeholder branches in `InquiryFlowScreen` (the unsupported screen) and `InquiryOutcomes` (a failure).

RED (`test`): `flow/FlowCoordinatorOtpTest.kt` (31) against `FakeFlowApi`, which now keeps an open
code per verification, counts sends, refuses a wrong code with `attempts-remaining`, submits only a
confirmed or limit-refused verification, and can submit a verification and answer 409 on the next
send or confirm (`submitOnNext`); `InquiryResultsTest` (+1: leaving the step cancels).

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.*' \
    --tests 'dev.openverify.sdk.InquiryResultsTest' --tests 'dev.openverify.sdk.api.*'
577 tests completed, 32 failed
  FlowCoordinatorOtpTest > a phone step opens on the number entry with the step's countries and a six-digit code, creating nothing yet(): expected: <Otp(step=PhoneOtpStep(id=phone, ...> but was: <Unsupported(reason=step phone_otp)>
  FlowCoordinatorOtpTest > a limit refusal lets the user continue, and continuing submits the verification for review(): java.util.NoSuchElementException: List is empty.
  FlowCoordinatorOtpTest > when the last attempt failed, the flow waits for the inquiry to fail(): [Loading, Unsupported(reason=step phone_otp)] ==> expected: <true> but was: <false>
  InquiryResultsTest > Otp(step=PhoneOtpStep(id=phone, ...)): expected: <Canceled(...)> but was: <Failed(... UNSUPPORTED_FLOW)>
  ... (the other 28: Unsupported(reason=step phone_otp) or the email step's, instead of the expected state)
```

GREEN (`feat`): `flow/EntrySteps.kt` builds the step's screen from the verification's guidance,
else the step (`otpState`, `parseInstant`, and an undescribed code for a server that sends no
guidance yet). `FlowCoordinator` resolves a phone or email step: done when passed, skipped or in
review; a submitted attempt is polled; a confirmed one submitted at once; an initiated one resumed
(its open code, and the destination when this process sent it); a failed or canceled one started
again with its hints while attempts remain, else the inquiry is waited on. `sendOtp` creates the
verification once and sends; `resendOtp` sends to the remembered destination or asks for it;
`confirmOtp` takes only a full code of digits, then submits; `changeOtpDestination` returns to the
entry; `continueAfterLimit` submits for review, or says it could not when the server kept no record.
Each C52.7 code maps to its screen; `otp_already_confirmed`, `otp_not_confirmed` and
`otp_attempts_exhausted` re-read the session and continue from where the verification stands; other
failures show the error screen, whose retry re-reads the session instead of sending again.
`OtpCode`'s members are nullable, so a member the server does not describe is left out.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.*' --tests 'dev.openverify.sdk.InquiryResultsTest'
BUILD SUCCESSFUL
tests 218 failures 0 errors 0 skipped 0 classes 6
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest :openverify-sdk:compileKotlinIosArm64
BUILD SUCCESSFUL
tests 1062 failures 0 errors 0 skipped 0 classes 52
```

## 4. The database and AAMVA steps in the flow engine (C50.1, C50.3, C50.5, C52.2, C52.3, C59.6, C64.2)

Stub (`chore`): `FlowState.Form` (the fields in order, the required ones, each field's objection, a
refusal no field shows, submitting), `InputProblem.REFUSED` (a 422 pointer), a no-op
`FlowCoordinator.submitInputs`, placeholder branches in `InquiryFlowScreen` and `InquiryOutcomes`.

RED (`test`): `flow/FlowCoordinatorFormTest.kt` (19) against `FakeFlowApi`, which now keeps each
verification's values, marks them received, refuses a form submit without them (`inputs_required`),
refuses a client create of a silent AAMVA attempt (`verification_created_by_server`) and can create
that attempt itself after some session reads (`createAfter`); `InquiryResultsTest` (+1).

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.*' --tests 'dev.openverify.sdk.InquiryResultsTest'
238 tests completed, 20 failed
  FlowCoordinatorFormTest > a database step opens its form with the step's fields in order and the ones it requires, creating nothing yet(): expected: <Form(step=DatabaseStep(...> but was: <Unsupported(reason=step database)>
  FlowCoordinatorFormTest > a silent AAMVA step waits while the server has not created its attempt, then waits for its decision, never creating it(): expected: <Completed(...)> but was: <Unsupported(reason=step aamva)>
  FlowCoordinatorFormTest > the AAMVA form sends the card's details as printed(): java.util.NoSuchElementException: Collection is empty.
  InquiryResultsTest > Form(step=AamvaStep(...)): expected: <Canceled(...)> but was: <Failed(... UNSUPPORTED_FLOW)>
  ... (the other 16: the unsupported database or AAMVA step instead of the expected state)
```

GREEN (`feat`): `EntrySteps.kt` gains `formState` (a database step's fields and required fields
from the server's guidance, else the step's, else the three every database step collects; the AAMVA
form's eight details, five required), `formInputs`, `inputFieldAt` (the last segment of a JSON
Pointer) and `DatabaseField.inputField`. The coordinator's phone, email and form steps share
`entryResolution` (done, waited on, submitted at once when confirmed or when the server holds the
form's values, resumed, or started again with the failure's hints, or saying it was canceled);
`submitInputs` checks the values with the step's required fields and `InputRules` before anything is
sent; `enter` creates the verification once, enters the values (a 422's pointers back to their
fields, a refusal no field shows said as such), then submits; a silent AAMVA step is never created:
`silentAamvaResolution` waits (`Resolution.Await`, `awaitServer`) for the attempt the server creates
or skips, polls a submitted one, and waits for the inquiry after a failure.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest :openverify-sdk:compileKotlinIosArm64
BUILD SUCCESSFUL
tests 1082 failures 0 errors 0 skipped 0 classes 53
```

## 5. The crypto wallet step in the flow engine, by pasting (C57, C64.1, C64.2)

Stub (`chore`): `FlowState.CryptoWallet` (the chains offered, the message to sign, the hints, the
refusal shown, busy, restarted), `CryptoChallenge` (its message left out of `toString`),
`CryptoError`; no-op `createCryptoChallenge`, `submitCryptoSignature`, `changeCryptoWallet`;
placeholder branches.

RED (`test`): `flow/FlowCoordinatorCryptoTest.kt` (19) against `FakeFlowApi`, which now builds a
message per challenge, supersedes the open one, cancels the verification at the challenge cap with
409 `crypto_challenge_invalid`, and refuses a submit over a challenge that is not open;
`InquiryResultsTest` (+1).

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.*' --tests 'dev.openverify.sdk.InquiryResultsTest'
258 tests completed, 20 failed
  FlowCoordinatorCryptoTest > a wallet step opens on the chain and address entry with the chains it offers, creating nothing yet(): expected: <CryptoWallet(...)> but was: <Unsupported(reason=step crypto_wallet)>
  FlowCoordinatorCryptoTest > the message that cancels the attempt starts the step again, saying why, on a new verification(): expected: <CryptoWallet(... restarted=true)> but was: <Unsupported(...)>
  InquiryResultsTest > CryptoWallet(...): expected: <Canceled(...)> but was: <Failed(... UNSUPPORTED_FLOW)>
  ... (the other 17: the unsupported wallet step instead of the expected state)
```

GREEN (`feat`): `cryptoState` lists the chains offered (guidance, else step) that `CryptoChains`
knows. `cryptoResolution` runs the step through `entryResolution` (a canceled attempt starts again,
`restarted`), and shows it as unsupported only when it would have to ask the user to sign without
paste signing or a known chain; a submitted attempt is still waited on. `createCryptoChallenge` sends
an offered chain and the trimmed address (creating the verification once) and shows the message;
`crypto_chain_not_offered`, `crypto_address_invalid` and `crypto_expected_address_mismatch` stay on
the entry with their reason, and the cap's 409 re-reads the session. `submitCryptoSignature` sends the
trimmed signature (and the trimmed signed message on Solana only) through `process`, whose 409
`crypto_challenge_invalid` goes back to the entry for a new message on the same attempt
(`cryptoRefused`). `changeCryptoWallet` returns to the entry.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest :openverify-sdk:compileKotlinIosArm64
BUILD SUCCESSFUL
tests 1102 failures 0 errors 0 skipped 0 classes 54
```

## 6. The screens, strings and actions (C55, C52.3, C57, C64.1, C64.2)

Stubs (`chore`, two commits): the English and Spanish strings (`composeResources/values{,-es}/
strings_otp.xml`, `strings_form.xml`, `strings_crypto_wallet.xml`, final texts, so the resource tests
check them at once); the `FlowActions` of the five steps, no-op in `InquiryViewModel`, recorded by
the test `RecordingActions`; `InputDrafts` (empty); the test tags; empty `OtpStepScreen`,
`DatabaseStepScreen`, `AamvaStepScreen`, `CryptoWalletStepScreen` in `ui/steps/`; `PhoneNumbers`,
`secondsUntil`, `minutesUntil`, `US_JURISDICTION_NAMES`; the `countryName` and `rememberTextCopier`
seams (`expect`, an Android actual answering `null`, and iOS placeholders that claim nothing).

RED (`test`):
- `commonTest/.../ui/steps/PhoneNumbersTest.kt` (7), `TimingTest.kt` (3);
- `androidHostTest/.../ui/CountryNamesTest.kt` (2), `ui/steps/UsJurisdictionsTest.kt` (1);
- `ui/steps/OtpStepScreenTest.kt` (22), `FormStepScreenTest.kt` (7), `CryptoWalletStepScreenTest.kt` (9);
- `InquiryFlowScreenTest` (+2: each step's screen; typing lands in the drafts);
- `InquiryViewModelTest` (+5: each action reaches the coordinator; drafts kept on the step and
  cleared once the flow leaves it).

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.*' --tests 'dev.openverify.sdk.InquiryViewModelTest'
194 tests completed, 55 failed
  OtpStepScreenTest > the phone entry offers the step's countries ...: Failed: assertExists. ... contains 'Confirm your phone number'
  FormStepScreenTest > the database form labels each field ...: Failed: assertExists. ... contains 'Enter your details'
  CryptoWalletStepScreenTest > the entry offers the networks by name ...: Failed: assertExists. ... contains 'Prove you control your wallet'
  InquiryFlowScreenTest > each Phase 5 step the SDK runs gets its own screen (C64_2): ... contains 'Confirm your phone number'
  InquiryViewModelTest > the wallet screen's actions reach the coordinator (C64_2)(): expected: <2> but was: <0>
  CountryNamesTest > a country is named in English or Spanish(): expected: <United States> but was: <null>
  PhoneNumbersTest > eachRegionHasItsCountryCallingCode(): expected: <{US=1, ...}> but was: <{US=null, ...}>
  ... (the other 48: the same empty stubs)
```

GREEN (`feat`):
- `ui/steps/OtpStep.kt`: the destination entry (the allowed countries named in the screen's
  language with their calling codes, the number sent as `+code number`; a loose email shape check,
  the server checks the rest), the code entry (the masked destination, digits only up to the code
  length, tries and sends left, a countdown to the next send and to the expiry, "Continue without
  a code" when neither a code nor a send is left), and the limit screen;
- `InputForm.kt` with `DatabaseStep.kt` and `AamvaStep.kt`: each collected field labelled, optional
  ones marked, dates and the phone number with their form, the country (every region with a
  calling code) and the issuing state (`US_JURISDICTION_NAMES`) chosen by name, each objection on
  its field, autofill hints;
- `CryptoWalletStep.kt`: the network by name (an EVM chain by its number), the address, the message
  selectable with a copy button where the platform has a clipboard, the signature, and the signed
  message on Solana only;
- `StepParts.kt`: the layout, the attempt's hints, refusals as polite live regions, busy rows, the
  selector, and `rememberNow`, which ticks only for as many seconds as the countdown has left;
- `PhoneNumbers` (245 regions' ITU-T E.164 calling codes, checked against libphonenumber-js
  1.13.14's metadata when written), `secondsUntil` and `minutesUntil` (rounded up), the Android
  `countryName` (CLDR through `java.util.Locale`) and `rememberTextCopier` (the system clipboard);
- `InputDrafts` is snapshot state; `InquiryViewModel` forwards the nine actions and clears the
  drafts whenever the flow shows anything but the step's screens, an error or loading;
- `InquiryFlowScreen` routes `Otp`, `Form` (database or AAMVA) and `CryptoWallet` to their screens.

RED test corrected during GREEN: `FormStepScreenTest.choose` scrolls to an option before clicking it,
as the country menu lists every region and Robolectric's screen clips it. The AAMVA options show
the state's name alone, as the test reads them.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest :openverify-sdk:compileKotlinIosArm64 :openverify-sdk:compileKotlinIosSimulatorArm64
BUILD SUCCESSFUL
tests 1160 failures 0 errors 0 skipped 0 classes 61
```

## 7. The problem codes the flow branches on, against the golden problems (C52.7)

Refactor (`refactor`, suite green): the OTP and wallet problem codes move from `FlowCoordinator`'s
private companion to `flow/FlowProblemCodes.kt`, so a contract test can read them. No behaviour
changes:

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.*' :openverify-sdk:compileKotlinIosArm64
BUILD SUCCESSFUL
tests 231 failures 0 errors 0 skipped 0 classes 7
```

Test (`test`, a pin of codes already in place, so it never failed first; written after the
refactor that made the codes readable): `ContractFixturesTest` checks that each code in
`FlowProblemCodes` is a golden `problems/flow/` problem with the status the flow expects it with.
A mutation check showed it is not vacuous: with `OTP_EXPIRED` misspelled `otp_expire` it failed,
and passed again once restored.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.model.ContractFixturesTest'
BUILD SUCCESSFUL
tests 80 failures 0 errors 0 skipped 0 classes 1
# with OTP_EXPIRED = "otp_expire" (reverted):
80 tests completed, 1 failed
  ContractFixturesTest > every Phase 5 problem code the flow branches on is a golden problem, with the status it expects (C52_7)(): expected: <{otp_destination_invalid=422, ...
```

## 8. The processing screen of a step without photos (C64.2)

Found in review: after a phone or email code, a form or a wallet signature, the shared processing
screen said "Checking your photos". Stub (`chore`): `openverify_processing_verification_title` in
English and Spanish, and `ProcessingScreen(photos = true)`, unused.

RED (`test`): `InquiryFlowScreenTest` (+1).

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.InquiryFlowScreenTest'
19 tests completed, 1 failed
  InquiryFlowScreenTest > a step without photos is checked in its own words, never as photos (C64_2): Failed: assertExists. ... contains 'Checking your verification'
```

GREEN (`fix`): `InquiryFlowScreen` passes `photos` only for a government ID or selfie step, and
`ProcessingScreen` titles the others "Checking your verification" ("Comprobando tu verificación").

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.*'
BUILD SUCCESSFUL
tests 174 failures 0 errors 0 skipped 0 classes 19
```

## 9. A new code clears the digits typed for the old one (C55.4, C64.2)

Found in review. RED (`test`): `OtpStepScreenTest` (+1).

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.steps.OtpStepScreenTest'
23 tests completed, 1 failed
  OtpStepScreenTest > asking for a new code, or sending to another destination, clears the digits typed for the old one: expected:<[]> but was:<[111111]>
```

GREEN (`fix`): the send, "Send a new code" and "Continue without a code" buttons clear the code's
draft before the request.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.ui.*'
BUILD SUCCESSFUL
tests 175 failures 0 errors 0 skipped 0 classes 19
```

## 10. Pins for the paths the slices' tests left out (after the code)

Kover's line report (`:openverify-sdk:koverXmlReport`) showed defensive branches of the flow engine
that were written in the GREEN steps above without a test of their own. These tests were written
after that code, so they never failed first; they pin behaviour already in place (`test`):
- `FlowCoordinatorOtpTest` (+6): an unknown verification status stops the step; continuing after
  a limit refusal the server meanwhile submitted continues from there; a failure while continuing
  shows the error screen, whose retry re-reads the session; a value the client refuses is an
  invalid response; a send answered without guidance opens an undescribed code entry (the fake's
  new `describesCodes = false`); an open code whose times cannot be read leaves them out;
- `FlowCoordinatorFormTest` (+3): every database field is asked as the body member of its name;
  an unknown silent AAMVA status stops the step; a refusal of the values other than a 422 shows
  the error screen;
- `FlowCoordinatorCryptoTest` (+3): a passed wallet step is done whatever its signing; an
  unexpected refusal of a challenge, and an answer the client cannot use, show the error screen.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.*'
BUILD SUCCESSFUL
tests 243 failures 0 errors 0 skipped 0 classes 7
```

## 11. Drafts are forgotten when another step's screen shows (C53.8, C64.2)

Found in review: the view model cleared the drafts only on a state other than a step screen, and a
`StateFlow` may skip the processing state between two steps' screens. RED (`test`):
`InquiryViewModelTest` (+1: a resumed flow goes from loading straight to the email step; the phone
step's draft must go).

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.InquiryViewModelTest'
22 tests completed, 1 failed
  InquiryViewModelTest > the drafts of one step are forgotten as soon as another step's screen shows (C53_8)(): expected: <> but was: <555 555 0100>
```

GREEN (`fix`): the view model remembers which step's screen it last showed; another step's screen,
or any state but an error or loading, clears the drafts.

```
$ ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.InquiryViewModelTest' --tests 'dev.openverify.sdk.ui.*'
BUILD SUCCESSFUL
tests 197 failures 0 errors 0 skipped 0 classes 20
```

## 12. Final gate

On `bce543d`, in the foreground:

```
$ (cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 2m 21s
191 actionable tasks: 41 executed, 150 up-to-date
  (executed: compileKotlinIosArm64, compileKotlinIosSimulatorArm64, compileTestKotlinIosArm64,
   compileTestKotlinIosSimulatorArm64, koverVerify, lintAnalyzeAndroidMain, ...)
SDK host tests (testAndroidHostTest): 1176, 0 failures, 0 errors, 0 skipped, 61 classes
demo-app unit tests: 18, 0 failures
$ ./gradlew --no-daemon :openverify-sdk:koverXmlReport
LINE 97.92% (2925 covered, 62 missed); BRANCH 73.95%   (gate: 80% of lines)
```

Lint reports only the existing dependency-version warnings (`GradleDependency`,
`NewerVersionAvailable`, `OldTargetApi`), none in a file this area added. The SDK host tests went
from 972 (the stub tree) to 1176: +204.
