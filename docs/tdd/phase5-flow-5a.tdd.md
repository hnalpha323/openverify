# TDD evidence: Phase 5, Workflow 5A Stage 2, `flow-5a`

The web flow's screens for the phone and email one-time codes, the crypto wallet, the database form
and the AAMVA form and silent step (plan C64.1, owned path `apps/flow`). Every slice landed as a stub
(when the test needed a name), a RED test commit that compiles and typechecks and fails at run time
for the intended reason, then a GREEN commit. Commands ran from `apps/flow` after
`source scripts/env.sh`; outputs are abbreviated to the lines that matter.

## 1. The Phase 5 flow API calls (C55, C52.3, C57.2)

`sendOtp`, `confirmOtp`, `enterInputs` and `createCryptoChallenge` on `FlowApiClient`, each body
checked against its contract schema before any request, each answer parsed; `withFinalOutcomes`
reports a final answer (C19) of each.

- **Stub** (`chore(flow)`): the four methods on the interface, rejecting `… is not built yet`; the
  wrapper passing them through unguarded; the fakes and fixtures serving every verification type.
- **RED**:

  ```
  $ pnpm exec vitest run src/api/flow-api-client.test.ts src/api/final-outcome.test.ts --coverage.enabled=false
   ❯ src/api/final-outcome.test.ts (34 tests | 4 failed)
       × reports a final answer to sendOtp, then still rejects with it
       … confirmOtp, enterInputs, createCryptoChallenge
   ❯ src/api/flow-api-client.test.ts (69 tests | 10 failed)
       × POSTs the phone number as JSON and returns the verification with its open code
       × keeps the wait of a resend asked for too soon (C52.7 otp_resend_too_soon)
       × keeps the attempts left after a wrong code (C52.7 otp_incorrect)
       × keeps the JSON Pointer of each refused member
       × POSTs the chain and the address and returns the message to sign
       …
  AssertionError: promise rejected "Error: sendOtp is not built yet" instead of resolving
  AssertionError: expected "vi.fn()" to be called with arguments: [ 'redacted' ]
        Tests  14 failed | 89 passed (103)
  ```

  The "refuses … without calling the API" cases and the wrapper's pass-through case already held
  against the stub (it rejects without a request, and passed arguments through); they pin that
  behaviour for GREEN.
- **GREEN** (`feat(flow)`): each call parses its body with `flowOtpSendBodySchema`,
  `flowOtpConfirmBodySchema`, `flowInputsBodySchema` or `createCryptoChallengeBodySchema`, posts to
  its frozen route (C54.2) and parses `flowVerificationDocumentSchema` or, for the 201 challenge,
  `flowCryptoChallengeResponseSchema`; the wrapper guards each. The challenge call first threw
  synchronously (its arrow was not `async`), so the "refuses a chain id" case failed until it
  became an `async` function.

  ```
  $ pnpm exec vitest run src/api/flow-api-client.test.ts src/api/final-outcome.test.ts --coverage.enabled=false
   Test Files  2 passed (2)
        Tests  103 passed (103)
  ```

## 2. Where the user is in a Phase 5 step (C64.1, C50.2, C50.5, C59.6)

`resolveFlowPosition` runs the phone, email, crypto wallet, database and AAMVA-form steps as one
verification attempt at a time, with `stepMaxAttempts` (C50.2: phone and email 5, wallet 3,
database and AAMVA 1); resumes an initiated attempt with its resource (its open code's guidance);
submits a `confirmed` OTP attempt at once (`kind: 'confirmed'`); offers "start again" after a
canceled wallet attempt (`restarted: true`); and waits on a silent AAMVA step (`kind: 'silent'`)
until the server has created and decided, or skipped, its attempt. The test that listed every
Phase 5 step as unsupported now lists only the ones whose screens are not this agent's (NFC, KYB,
website, document, form): a test the plan changes.

- **RED** (no stub needed: the expected positions are plain objects):

  ```
  $ pnpm exec vitest run src/flow/flow-position.test.ts --coverage.enabled=false
         × asks for a first attempt of a phone_otp step, with 5 attempts
         × resumes an initiated phone verification with its open code
         × submits a confirmed phone_number verification at once instead of waiting on it (C64.1 resume)
         × offers to start again after a canceled wallet attempt (C64.1, C57.2)
         × waits for the inquiry once the single database attempt has failed
           × waits on the server with no AAMVA verification yet, never creating one
           × waits for the inquiry once its attempt has failed: it has no retry
         …
  -   "kind": "capture",
  +   "kind": "unsupported",
        Tests  23 failed | 37 passed (60)
  ```
- **GREEN** (`feat(flow)`): `verificationPosition` counts a step's attempts through
  `verificationTypeForStep` and `stepMaxAttempts`; a Phase 5 initiated attempt carries
  `verification`; `confirmed` resumes an OTP step as `kind: 'confirmed'` (other types still wait on
  it, as before); a canceled wallet attempt sets `restarted`; `silentPosition` judges the latest
  AAMVA attempt only. The renderer switches on the capture step's type and shows the unsupported
  screen for the new positions until their screens land (slices 4-7), so no user-visible change
  yet.

  ```
  $ pnpm exec vitest run src --coverage.enabled=false
   Test Files  55 passed (55)
        Tests  778 passed (778)
  ```

## 3. The phone and email code step (C55, C64.1)

`OneTimeCodeStep` (`src/steps/otp/`) runs one attempt of a `phone_otp` or `email_otp` step: the
destination, then the code sent to it; `ConfirmedStep` submits a confirmed code at once, on
confirm and when the session resumes on a `confirmed` verification. Messages live in the step's
own locale modules (`steps/otp/locales/{en,es}.ts`, under `otp`). The earlier run had left those
two modules as uncommitted drafts; the Spanish one was typed against an `otp` key that did not
exist yet, so it broke `tsc` until it was retyped (`Widen<typeof otpEn>`). Both were finished and
committed with this slice's GREEN, after its RED; two unused keys (`sentToYou`, `sendsLeft`) were
dropped and two added (`expiredFinal`, `startAgain`).

- **Stub** (`chore(flow)`, `10d15c7`): `OneTimeCodeStep` rendering the unsupported screen,
  `ConfirmedStep` rendering nothing; `FlowEnvironment.currentTime` (the wall clock, `Date.now`)
  and `countdownIntervalMs` (1000); the fake API sending and confirming codes under the C55 rules
  on its own clock (five sends, the 30/60/120/240 s cooldowns, five tries per code, 600 s, ten
  wrong entries, `failures` queuing golden problems and applying their server effects) and
  serving the phone and email guidance; `goldenFlowError(code, members)`.
- **RED** (`test(flow)`, `b76d827`):

  ```
  $ pnpm exec vitest run src/steps/otp/one-time-code-step.test.tsx src/steps/confirmed-step.test.tsx src/flow/flow-renderer.test.tsx src/flow/flow-environment.test.tsx --coverage.enabled=false
       × runs a phone step from the number to the completion screen
       × submits a confirmed email code when the flow resumes on it
       × submits a confirmed code at once, then reloads the session
       × asks for the number with a country chosen from the step’s allowed countries
       × counts down to the next code on the clock, then sends a new one
       × offers to continue for review after a limit refused a send
       … (54 in all)
  TestingLibraryElementError: Unable to find an accessible element with the role "heading" and name "Your code was confirmed"
  TestingLibraryElementError: Unable to find an accessible element with the role "combobox" and name "Country"
   Test Files  3 failed | 1 passed (4)
        Tests  54 failed | 38 passed (92)
  ```

  The environment-default case (`currentTime` reads `Date.now`, a countdown ticks every second)
  held against the stub, which already carried the two defaults; it pins them.
- **GREEN** (`feat(flow)`, `b961bab`): the entry views (a `SelectField` of the allowed countries
  sorted by their `Intl.DisplayNames` name, `+<calling code>` from libphonenumber; an email
  field), the browser checks (`parsePhoneEntry` with libphonenumber's min metadata, whose
  `isValid()` is looser than the server's max metadata; `emailProblem`, looser than C55.8), the
  code entry (`autocomplete="one-time-code"`, `inputmode="numeric"`, spaces and dashes stripped,
  the length described), tries left from `attempts-remaining`, the expiry, the resend counted down
  on `useNow()` with the wait as the button's description and a single status once a new code
  may be asked for, each refusal mapped (`otp_delivery_failed`, `otp_destination_*` and
  `otp_not_sent` back to the destination; `otp_incorrect`, `otp_expired`, `otp_code_exhausted` at
  the code; `otp_resend_too_soon` with its `resend-available-at`; `otp_rate_limited`, 429 or 503,
  to "continue for review"; `otp_already_confirmed` to the submit; `otp_not_confirmed`,
  `otp_attempts_exhausted` and other 409s to a session reload), focus on each new view's heading.
  Two RED expectations were corrected, each noted in the GREEN commit's evidence here:
  - the code field was asserted to carry `maxlength`, which would cut a pasted `246 810` to
    `246 81` while another RED case required that paste to work; it now carries no `maxlength`
    (`spellcheck="false"` is asserted instead), as security-code guidance advises;
  - the renderer cases kept the default flow's transitions after removing its ID and selfie
    steps, so the session fixture refused the flow (`unknown step id "government_id"`); the
    helper now drops them.

  ```
  $ pnpm exec vitest run src/steps src/flow --coverage.enabled=false
   Test Files  18 passed (18)
        Tests  329 passed (329)
  $ pnpm test
   Test Files  57 passed (57)
        Tests  833 passed (833)
  All files          |   96.11 |    89.95 |   96.81 |   96.13 |
  ```

  Before committing, two branches no test asked for were removed rather than kept untested
  (confirming or continuing without a verification id, which no view can reach; a successful
  confirm whose status is not `confirmed`, which the submit's own 409 already covers), and
  `SelectField` was cut back to its label and options until the forms need more.
- **Pins** (`test(flow)`, `1136c02`): a send to a changed number inside the wait says to wait,
  and a send that opened no code reads the session again. Both are behaviour GREEN wrote without
  a RED case; the tests passed on their first run.

## 4. The crypto wallet step (C57, C64.1)

`CryptoWalletStep` (`src/steps/crypto-wallet/`): the step's networks (named in both languages;
an EVM network without a name by its number), the wallet path through EIP-6963 announcements or
an injected `window.ethereum` (`eth_requestAccounts`, the server's challenge, `personal_sign` over
the message's UTF-8 bytes, submitted with `scheme: eip191`), and the paste path (address, the
message read-only with a copy button and its expiry, the signature, a Solana signed message).
The browser loads no crypto library and verifies nothing; the CSP is unchanged.

- **Stub** (`chore(flow)`, `ded16d9`): the component rendering the unsupported screen; the fake
  API's challenges under C57.2 (chains offered, EVM address shape, `expectedWalletAddress`,
  supersede, the eleventh cancels) and its submit rule (the open, unexpired challenge, C57.3).
- **RED** (`test(flow)`, `0194fd8`), a fake EIP-1193 provider (fixed account and signature, no
  key anywhere) announced through `eip6963:requestProvider`, or set as `window.ethereum`:

  ```
  $ pnpm exec vitest run src/steps/crypto-wallet --coverage.enabled=false
       × explains the step and names its one network
       × offers the step’s networks to choose from
         × signs the server’s message in an announced wallet, then submits the signature (EIP-6963)
         × uses an injected window.ethereum when no wallet announces itself
         × explains a personal_sign that ended with error 4001, then tries again
         × gets the message for the address, copies it, and submits the pasted signature
         × gets a new message when the server refuses the signed one
         … (29 in all)
  TestingLibraryElementError: Unable to find an accessible element with the role "heading" and name "Prove that you control your crypto wallet"
  TestingLibraryElementError: Unable to find role="button" and name "Connect Test Wallet"
        Tests  29 failed (29)
  ```
- **GREEN** (`feat(flow)`, `d430dec`): `useBrowserWallets` (EIP-6963, each `uuid` once, malformed
  announcements ignored, names cut to 64 characters, `window.ethereum` only without one),
  `walletRequest` (a wallet failure is a `WalletRequestError`, `declined` for 4001, never a flow
  API error), `chainName`, a local `TextAreaField`, the caps read from the contract schemas
  (`createCryptoChallengeBodySchema`, `flowCryptoSubmitSchema`) since core is not a runtime
  dependency of the flow. The renderer's routing was held back from this commit because no RED
  case asked for it.

  ```
  $ pnpm exec vitest run src/steps/crypto-wallet --coverage.enabled=false
        Tests  29 passed (29)
  $ pnpm test
   Test Files  58 passed (58)
        Tests  864 passed (864)
  All files          |   95.87 |    89.12 |   97.22 |   95.87 |
  ```
- **Pins** (`test(flow)`, `09c50c9`): answers GREEN gives beyond the RED cases (an address refusal
  on the wallet path, a wallet answer that is no signature, an address with a space or over 128
  characters, a signature over 1,024, a submit that never arrived, announcements without detail
  or uuid), and `chains.test.ts`, which fails if `CRYPTO_CHAINS` gains a chain without a name.
  All passed on their first run: they pin behaviour, they did not drive it.
- **Renderer RED** (`b2a1b00`) and **GREEN** (`b7711f3`): the renderer runs the step (a pasted
  signature to the completion screen; "start again" after a canceled attempt).

  ```
  $ pnpm exec vitest run src/flow/flow-renderer.test.tsx --coverage.enabled=false
       × runs a wallet step by pasting a signature, to the completion screen
       × offers to start again after a canceled wallet attempt
  TestingLibraryElementError: Unable to find role="heading" and name "Prove that you control your crypto wallet"
        Tests  2 failed | 32 passed (34)
  (GREEN)
        Tests  34 passed (34)
  ```

## 5. The database and AAMVA forms and the silent AAMVA wait (C64.1, C52.3, C59.6)

`EnteredValuesStep` (`src/steps/forms/`), `SilentStep` and their renderer cases. This slice was
started by `flow-5a`'s second run, which ended on "Output blocked by content filtering policy"
after its RED commit, and finished by `integration-5a`. This section cites those commits and the
output `integration-5a` recorded (`docs/tdd/phase5-integration-5a.tdd.md`, section 1); the
completion run did not run these commands itself and adds no output of its own here.

- **Stub** (`chore(flow)`, `58f0da0`, `flow-5a`): `EnteredValuesStep` and `SilentStep` rendering
  placeholders; the fake flow API taking entered values under the C52.3 rules (only the step's
  fields, its required ones, a 422 with a JSON Pointer per member), refusing a form submit before
  its values (`inputs_required`) and serving the database and AAMVA guidance.
- **RED** (`test(flow)`, `d4d1f60`, `flow-5a`): the database form (fields in order, address
  grouped, required marks, autofill tokens, the C52.3 checks, the values sent without the empty
  ones then submitted, each 400 or 422 JSON Pointer at its field, received values sent for
  checking), the AAMVA form (the license with its state and ZIP), the silent step, the renderer
  cases, and the code and wallet steps' "no photo words" cases. `flow-5a` recorded no output
  before its run ended. `integration-5a` found the suite red on `main` at `150059a0` with these
  cases failing:

  ```
  $ (cd apps/flow && pnpm exec vitest run --coverage.enabled=false)
   Test Files  5 failed | 56 passed (61)
        Tests  26 failed | 876 passed (902)
  ```

  (as `integration-5a` recorded it: 18 form cases, 3 silent-step cases, 3 renderer cases, and one
  "no photo words" case each in the code and wallet steps).
- **RED corrected for an amendment** (`test(flow)`, `fb2b50e`, `integration-5a`): `api-database`
  made every database body carry the step's `requiredFields` and always `name-first`,
  `name-last` and `address-country-code` (C52.3, Stage 3 amendment 3). Seven RED cases that left
  the country empty now choose one, and the fake flow API requires the same set; no assertion
  about what the form does changed. Its recorded failing run of those seven cases:
  `Tests  7 failed | 166 passed (173)`.
- **GREEN** (`feat(flow)`, `993d967`, `integration-5a`): `fields.ts` (each value checked with its
  member's contract schema), `regions.ts` (countries named by `Intl.DisplayNames` over
  libphonenumber's region list, the 56 `US_JURISDICTIONS` in English with the Spanish names that
  differ), `FormField` and `SelectField` with the `*` beside the label, `EnteredValuesStep`,
  `SilentStep`, and `entryErrorMessageKey`. Its recorded output:

  ```
  $ (cd apps/flow && pnpm exec vitest run --coverage.enabled=false)
   Test Files  61 passed (61)
        Tests  908 passed (908)
  $ (cd apps/flow && pnpm test)
  All files          |   96.46 |     89.9 |   97.18 |   96.49 |
   src/steps/forms   |     100 |    89.74 |     100 |     100 |
  ```

  `integration-5a` then landed two flow wording slices on its own evidence (its section 10):
  `784abf5`/`4801b3d` ("Checking your verification") and `3130727`/`e56106a` ("Your last attempt
  did not go through").

## 6. A refused value takes focus (C64.1, WCAG 2.2 AA 3.3.1 and 4.1.3)

The completion run checked C64.1's accessibility items against the screens and found one gap: a
field's error is its description (`aria-describedby`, with `aria-invalid`), not a live region,
yet after a refused phone number, email address, code, wallet address or signature focus stayed
on the button, so a screen reader heard nothing. The forms already moved focus to the first
marked field, but a refusal whose pointers named no field on the screen left focus on Continue.
Commands ran from `apps/flow`.

- **RED** (`test(flow)`, `8f80775`): twelve cases in the three step test files: the code step
  (a number the browser or the server refuses, the number after a resend cannot be delivered, a
  code the browser refuses, a wrong code, an email address the browser refuses), the wallet step
  (an address the browser or the server refuses, a signature the browser refuses), the forms (a
  pointer's field, and the summary when no pointer names a field on the screen), and one case
  that going back to change the number leaves focus on the heading. The first run had one
  failure for the wrong reason (`userEvent.type` with an empty string: `Expected key descriptor
  but found ""`), fixed in the test before the commit. Then:

  ```
  $ pnpm exec vitest run src/steps/otp/one-time-code-step.test.tsx src/steps/crypto-wallet/crypto-wallet-step.test.tsx src/steps/forms/entered-values-step.test.tsx --coverage.enabled=false
       × moves focus to an address the browser refuses
       × moves focus to an address the server refuses
       × moves focus to a signature the browser refuses
       × moves focus to the summary when no pointer names a field on the screen (WCAG 2.2 AA)
       × moves focus to a number the browser refuses
       × moves focus to a number the server refuses
       × moves focus to the number when a new code cannot be delivered to it
       × moves focus to a code the browser refuses
       × moves focus to a wrong code, whose tries left are said
       × moves focus to an email address the browser refuses
  Received element with focus:
    <button      (nine times)
    <h1          (the resend whose delivery failed: the entry view's heading)
   Test Files  3 failed (3)
        Tests  10 failed | 107 passed (117)
  ```

  Two new cases passed at once and pin what already held: a pointer's field takes focus in the
  forms, and "Change phone number" leaves focus on the heading.
- **GREEN** (`fix(flow)`, `9d9cd5e`): the code step and the wallet step bump a focus request with
  each refusal they show at a field, and an effect focuses the `[aria-invalid="true"]` control
  once it is rendered (after `useScreenFocus` moved focus to a new view's heading, so a refusal
  that changes the view still ends on its field); the forms' effect falls back to the summary,
  which takes `tabIndex={-1}`.

  ```
  $ pnpm exec vitest run src/steps/otp/one-time-code-step.test.tsx src/steps/crypto-wallet/crypto-wallet-step.test.tsx src/steps/forms/entered-values-step.test.tsx --coverage.enabled=false
   Test Files  3 passed (3)
        Tests  117 passed (117)
  $ pnpm test
   Test Files  61 passed (61)
        Tests  922 passed (922)
  All files          |   96.49 |    89.98 |   97.23 |   96.52 |
  ```

## 7. The mocked Playwright specs of the Phase 5 steps (C64.1)

One spec per new step in `apps/flow/e2e`, run by the package's `e2e` script against the built
flow (its CSP included) with the API mocked by `page.route`. They walk built behaviour, so most of
them pin it; where they assert the focus rules of section 6, they were shown to fail without
them (below).

- **The mock** (`e2e/support/mock-flow-api.ts`, `1d23358`): the Phase 5 routes (`/otp`,
  `/otp/confirm`, `/inputs`, `/crypto-challenges`, the submit rules) under the C52, C55 and C57.2
  rules, on its own clock (`clockMs`) that a spec moves with the page's; refusals are the golden
  problems of `contracts/fixtures/problems/flow/` (`refusals`, and `refusedInputs` for a 422 with
  pointers); a silent AAMVA attempt made by the "server" (`silentAamva`, one move per session
  read); the inquiry settled over the flow's verification steps; `pendingPolls` to hold a
  decision. It imports no workspace package at run time (the suite runs without building them):
  its numbers are typed against `@openverify/contracts` with `satisfies`, so a changed contract
  fails the typecheck. Checked by changing two of them:

  ```
  $ pnpm exec tsc --noEmit -p e2e      # with maxSends 6 and database 2, then restored
  e2e/support/mock-flow-api.ts(118,15): error TS1360: Type '6' does not satisfy the expected type '5'.
  e2e/support/mock-flow-api.ts(132,3): error TS2322: Type '2' is not assignable to type '1'.
  ```

  The 38 earlier specs passed on the extended mock: `38 passed (11.5s)`.
- **Helpers** (`e2e/support/phase5.ts`): `freezeClock`/`advanceClock` (`page.clock.setFixedTime`,
  so `Date.now` is frozen while timers run, and the mock's clock moves with it),
  `collectUnexpectedErrors` (console and page errors, CSP violations included, except the error
  answers a spec queued), `inLiveRegion`, `expectTargetSize` (WCAG 2.5.8, 24 by 24 CSS pixels),
  `expectRequiredMark`, and `installFakeWallet` (an EIP-1193 provider installed before the page
  loads, announced through EIP-6963 or injected as `window.ethereum`, answering a fixed synthetic
  65-byte signature; no key, no cryptography).
- **`phone-otp.spec.ts`** (`1d23358`): first run `3 passed, 1 failed`, a strict-mode locator
  (`getByText('No more codes can be sent.')` matched the expiry alert too), made exact; then
  `4 passed (9.3s)`. To check that the spec reads the focus rule rather than pinning anything, the
  GREEN of section 6 was reversed in the working tree for the code step only (`git diff 8f80775
  9d9cd5e -- …/one-time-code-step.tsx | git apply -R`), the spec run, and the diff applied again:

  ```
  $ pnpm exec playwright test --config e2e/playwright.config.ts phone-otp -g "confirms a phone number"
    ✘  1 [chromium] › e2e/phone-otp.spec.ts:39:1 › confirms a phone number: …
      Error: expect(locator).toBeFocused() failed
      Locator:  getByRole('textbox', { name: 'Phone number' })
      Expected: focused
      Received: inactive
      > 66 |   await expect(number).toBeFocused();
    1 failed
  ```
- **`email-otp.spec.ts`** (`eb100fc`): first run `3 passed, 1 failed`: the console check counted
  `Failed to load resource: … status of 502 (Bad Gateway)`, the golden `otp_delivery_failed`
  being a 502; the helper now accepts any 4xx or 5xx the spec queued. Then `8 passed (10.0s)`
  with the phone spec.
- **`crypto-wallet.spec.ts`** (`9fbd225`): `7 passed (5.2s)` on its first run. Its last case
  reads every built chunk in `dist/assets` for secp256k1's field prime and group order and
  ed25519's field prime (the strings `@noble/curves` carries); the bundle names the scheme
  `solana-ed25519`, so the scheme name is not a fingerprint.
- **`database.spec.ts`** (`4e4c8b9`): `4 passed (7.1s)` on its first run.
- **`aamva.spec.ts`** (`ad53dcc`, `c1a0df9`): `2 passed (4.1s)` on its first run. The silent case
  installs the clock and pauses it before the flow loads, so the second poll runs only at
  `page.clock.runFor(2000)`.
- **The suite**: `59 passed (16.0s)` (38 earlier, 21 new).

## 8. A refused code's description names the tries left (C64.1, WCAG 2.2 AA 4.1.3)

Writing the phone spec showed a second gap: after a wrong code, focus is on the code field and its
error is read, but "Tries left for this code: 4" is a plain paragraph, so its change is never
announced.

- **RED** (`test(flow)`, `52f3f8d`):

  ```
  $ pnpm exec vitest run src/steps/otp/one-time-code-step.test.tsx --coverage.enabled=false
       × says the tries left with a refused code, so they are read with its error (WCAG 4.1.3)
       × says the tries left with a code the browser refuses
  Expected element to have accessible description:
    The code has 6 digits. That code is not correct. Check it and try again. Tries left for this code: 4
  Received:
    The code has 6 digits. That code is not correct. Check it and try again.
   Test Files  1 failed (1)
        Tests  2 failed | 57 passed (59)
  ```
- **GREEN** (`fix(flow)`, `9aeb099`): while the field shows an error, `CodeEntry` adds the
  tries-left paragraph to its `aria-describedby`; without an error the description is the code's
  length alone, as before. The phone spec's assertion of that description follows it, in the
  same commit.

  ```
  $ pnpm exec vitest run src/steps/otp src/flow/flow-renderer.test.tsx --coverage.enabled=false
   Test Files  2 passed (2)
        Tests  98 passed (98)
  $ pnpm exec playwright test --config e2e/playwright.config.ts phone-otp email-otp
    8 passed (9.8s)
  ```

## 9. Final gates (completion run, in the foreground, on `c1a0df9`)

Commands ran from the repository root after `source scripts/env.sh`.

```
$ pnpm --filter @openverify/flow typecheck        # tsc --noEmit && tsc --noEmit -p e2e: clean
$ pnpm --filter @openverify/flow lint             # eslint .: clean
$ pnpm --filter @openverify/flow test
 Test Files  61 passed (61)
      Tests  924 passed (924)
Statements   : 96.49% ( 2619/2714 )
Branches     : 89.99% ( 1754/1949 )
Functions    : 97.23% ( 632/650 )
Lines        : 96.52% ( 2530/2621 )
$ pnpm format:check                               # All matched files use Prettier code style! (32.7 s)
$ flock /tmp/openverify-e2e.lock pnpm e2e         # 7m36.6s wall
@openverify/flow:e2e:   59 passed (16.2s)
@openverify/e2e:e2e:    60 passed (7.3m)
 Tasks:    9 successful, 9 total
```

The Phase 5 full-stack specs passed in that run: `crypto-wallet` 3.1, 3.2 and 3.0 s; `database`
3.2, 1.3, 1.3, 3.5 and 1.2 s; `email-otp` 4.5 s; `phone-otp` 5.5 s.
