# TDD evidence: Workflow 5C Stage 1 dashboard-people (C66 for phone, email and crypto wallet; the shared console files)

- **Slice owner:** `dashboard-people` (Workflow 5C, Stage 1, in parallel with `dashboard-records` and `dashboard-documents`).
- **Date:** 2026-10-24.
- **Paths owned:**
  - per type (`phone-number`, `email-address`, `crypto-wallet`): `apps/dashboard/src/lib/<type>-evidence.ts`, `lib/<type>-words.ts`, `lib/reason-words/<type>.ts` and its test, `components/evidence/<type>.tsx`, `testing/fixtures/<type>.ts`;
  - `apps/dashboard/src/testing/routes/people.ts`, `e2e/tests/support/people.ts`, `e2e/tests/ui-people.spec.ts`;
  - every shared dashboard file (the verification card and view, `components/evidence/index.ts`, `components/nav-items.ts`, the check display, the settings page, the shared word modules and testing helpers, the README);
  - this file.
- **Input:** `docs/plans/phase-5.plan.md` (C51.2, C52.8, C53.7, C55, C56, C57, C66, every Workflow 5A and 5B amendment, the owner-delegated decisions), ADR 0002, `docs/checks/contact.md` and `crypto-wallet.md` (their "What a pass means"), and the Workflow 5A and 5B entries of `docs/PROGRESS.md`. The API side is built and was not changed.

Each slice follows the same cycle:
1. A stub commit (`chore`) when the tests need a name that does not exist yet, so the RED commit compiles and type-checks (the full-stack e2e runs `next build`, which type-checks every dashboard test).
2. The tests, run to see them fail for the intended reason (RED, `test` commit).
3. The smallest change that passes them (GREEN, `feat` commit).
4. A refactor with the suite green, where one was worth making.

All commands ran after `source scripts/env.sh`. "vitest run … --coverage.enabled=false" stands for `pnpm exec vitest run <files> --coverage.enabled=false` in `apps/dashboard`. Output is trimmed to the lines that matter.

**Nothing in the console unmasks.** Every value the evidence shows is the verification answer's own attribute or check metadata, exactly as the API sent it to this operator (C53.7): a phone number, an email address or a wallet address the API masked arrives as `null` and reads "Hidden"; after a redaction it reads "Redacted". No component reads a personal value from the inquiry document or anywhere else (the page takes only the file resources' kinds from it, slice 6).

## Slice 1: every phone, email and crypto wallet reason in words

`src/testing/phase5-reasons.ts` (`checkReasonsOfType(type)`) reads the `[check, code]` pairs of one type's checks from `PHASE5_CHECK_REASONS` (the contracts), through the registry's `verificationType`. Each module's test iterates them first, so a reason the contracts add without words fails it:
- `lib/reason-words/phone-number.test.ts`: every reason of `phone_number_otp_comparison` says words through `reasonText(code, check)`; the three OTP codes are worded by the module itself with a sentence; ten wrong codes (`OTP_MAX_WRONG_ENTRIES`) and the limit refusal going to review are said.
- `lib/reason-words/email-address.test.ts`: the three email checks; the OTP, disposable and MX codes worded by the module; a null MX and a missing list explained; both OTP types word a shared code the same.
- `lib/reason-words/crypto-wallet.test.ts`: the four crypto checks; the eleven own codes worded; a contract wallet, an unprovable address and an unverifiable form say "a reviewer decides"; a missing allowlist "never blocks"; an unbound EVM RPC keeps "Not configured" (ADR 0002 §3e) and explains why it goes to review (decision 51).

GREEN: `lib/otp-words.ts` (`OTP_REASON_WORDS`, shared by the two OTP types, the number of wrong codes read from `OTP_MAX_WRONG_ENTRIES`), and the three modules. `input_missing` keeps the shared words; the crypto module words `provider_not_configured` and `execution_error` with the EVM RPC's meaning, the email module `execution_error` with the DNS lookup's.

Commits: `1e42c126` (RED), `1b06f65a` (GREEN).

```text
RED   $ vitest run src/lib/reason-words/phone-number.test.ts src/lib/reason-words/email-address.test.ts src/lib/reason-words/crypto-wallet.test.ts --coverage.enabled=false
     × says phone_number_otp_comparison otp_attempts_exhausted in short English words
     × says email_address_mx_detection domain_rejects_mail in short English words
     × words contract_wallet_not_allowed itself, with a sentence saying what happened
     × keeps "Not configured" for an unbound EVM RPC, and says why it goes to review (ADR 0002 §3e, decision 51)
     … (50 in all)
TypeError: .toMatch() expects to receive a string, but got undefined
AssertionError: expected 'No provider is bound to this check in…' to match /EVM RPC.*reviewer decides/
 Test Files  3 failed (3)
      Tests  50 failed | 16 passed (66)
GREEN $ vitest run src/lib/reason-words/{phone-number,email-address,crypto-wallet,index}.test.ts src/lib/reason-words/lookup.test.tsx src/lib/check-reasons.test.ts src/components/check-results.test.tsx --coverage.enabled=false
 Test Files  7 passed (7)
      Tests  247 passed (247)
```

The 16 that passed in RED are the rows of codes the shared words already cover (`input_missing`, and `execution_error` and `provider_not_configured` for their words only), the three list-reading cases, and "says the same words for a code both OTP types give", which passed only because both sides were `undefined`. Before the RED commit that case was tightened to require the phone words first, so in the committed RED it fails too.

## Slice 2: the category on every check row, and advisory checks said as advisory

`components/check-results.tsx` (the shared check display) gains a "Category" column beside the requirement: `CHECK_CATEGORY_LABELS` (`lib/labels.ts`, a `Record` over core's `CheckCategory`, so a new category fails the typecheck) says Biometrics, Fraud, User action required, Validity (C50.8); a row an earlier server served without a category reads "Not reported". The requirement column says "Advisory" (C51.1's word) for a check the template does not require, and an advisory failure adds "Does not decide the verification" (C30.1), so its "Failed" never reads as the verification's outcome (team rule 10).

Existing tests changed because the plan's vocabulary changed what they check: `components/verification-card.test.tsx` and `app/verifications/[id]/page.test.tsx` expected "Optional" for a not-required check and now expect "Advisory".

Commits: `029cec14` (RED), `fbc90f71` (GREEN). The RED case for a missing category said "Not recorded", which a Phase 1 row's provenance cell already says, so the two collided ("Found multiple elements with the text: Not recorded"); the GREEN commit words it "Not reported" and corrects that one RED expectation, as its body says.

```text
RED   $ vitest run src/components/check-results.test.tsx src/components/verification-card.test.tsx src/app/verifications/[id]/page.test.tsx --coverage.enabled=false
     × lists every check with its status, requirement and reasons
     × says each check category in words, in a column of its own beside the requirement
     × says "Not recorded" for a result an earlier server stored without one
     × says a check the template does not require is advisory
     × says an advisory failure does not decide the verification
     × lists every check with its status, requirement, reasons and metadata
AssertionError: expected [ 'Check', 'Status', …(3) ] to deeply equal [ 'Check', 'Status', …(4) ]
TestingLibraryElementError: Unable to find an element with the text: Advisory.
      Tests  6 failed | 97 passed (103)
GREEN $ vitest run src/components/check-results.test.tsx src/components/verification-card.test.tsx src/app/verifications/[id]/page.test.tsx src/components/selfie-evidence.test.tsx src/lib/reason-words/lookup.test.tsx src/app/inquiries/[id]/page.test.tsx --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  177 passed (177)
```

**A shared test made independent of the other agents' words** (`909776d2`): `lib/reason-words/lookup.test.tsx` asserted that the real AAMVA module has no words for `record_not_found` and `execution_error`. Once `dashboard-records` worded them (C66), it failed (`expected { …(2) } to be undefined`). The test checks the lookup, not the AAMVA words, so it now replaces the AAMVA module with an empty one, as it already replaced the database module.

## Slice 3: the phone, email and crypto wallet vocabulary in words

Stub `41c329ff` (the names over empty tables), RED `486410b9`, GREEN `f4b8b5fc`.

Two shared test helpers, in the RED commit:
- `src/testing/checks-source.ts`: the evaluators' own source (`packages/checks/src`, which the console does not depend on) with `arrayOf`, `unionOf` and `valuesOf`, so a value an evaluator records without words here fails its test (the pattern `selfie-words.test.ts` set).
- `src/testing/check-docs.ts`: the "What a pass means" section of a `docs/checks/<page>.md` as plain words, so a console line that stops saying what the docs say fails.

What the modules say:
- `lib/otp-words.ts`: the two channels; the five limits that refuse a user (read from `OTP_LIMITED_REASONS` in `packages/checks/src/contact/inputs.ts`), each with the C55.7 limits it stands for (api-otp amendment 3). Every limit name in `OTP_LIMIT_NAMES` but `otp-ip-hour`, whose refusal is never recorded, is named.
- `lib/phone-number-words.ts`, `lib/email-address-words.ts`, `lib/crypto-wallet-words.ts`: the pass lines, each sentence found in `docs/checks/contact.md` or `crypto-wallet.md` (the closing "does not establish who the person is" sentence of the OTP lines is checked against the page's "Neither establishes who the person is"); the disposable matches and the MX routes (read from the evaluators' `match:` and `route:` values); the chains by core's `CRYPTO_CHAINS` names and an EVM chain as "EVM network <n>" (no EVM chain list is written out); the six schemes (a `Record` over core's `CryptoSignatureScheme`); the ten address types and three checksum states (read from the `CryptoAddressKind` and `CryptoAddressChecksum` unions); the flags `high-s`, `bip137-loose`, `contract-wallet`, `on-curve` (both values) and the Solana `envelope` (versions 0 and 1). A low-s signature raises no flag.

```text
RED   $ vitest run src/lib/otp-words.test.ts src/lib/phone-number-words.test.ts src/lib/email-address-words.test.ts src/lib/crypto-wallet-words.test.ts --coverage.enabled=false
     × says what the docs say a phone pass shows, sentence by sentence
     × says the MX route null_mx in words, with what it means
     × names each chain Phase 5 knows, and an EVM chain by its number
     × says the flag contract-wallet = true in words, with what it means
     × names every limit whose refusal is recorded, and not otp-ip-hour, which none records (C55.7)
     … (51 in all)
AssertionError: expected 'bip122:000000000019d6689c085ae165831e…' to be 'Bitcoin' // Object.is equality
AssertionError: otp-destination-hour: expected '    ' to contain 'otp-destination-hour'
AssertionError: expected '0' to be 'The address\'s own domain' // Object.is equality
 Test Files  4 failed (4)
      Tests  51 failed | 21 passed (72)
GREEN $ vitest run src/lib/{otp,phone-number,email-address,crypto-wallet}-words.test.ts src/lib/reason-words/{phone-number,email-address,crypto-wallet}.test.ts --coverage.enabled=false
 Test Files  7 passed (7)
      Tests  138 passed (138)
```

The 21 that passed in RED read the lists from the evaluators (which hold) or check that an unknown value gets no words (which the empty tables also gave).

## Slice 4: reading the evidence from the verification answer

Stub `e8f2d24e`, RED `3fe5a744` with the per-type fixtures, a type fix `e08d63f2`, GREEN `d91ad6ff`.

- `lib/otp-evidence.ts` (`otpEvidenceOf`, phone and email): the destination exactly as the API sent it (`null` when masked or redacted), `confirmed-at` (`null` until confirmed, `undefined` when an earlier server did not say), `sends`, `failed-attempts`, and from the OTP comparison `channel` and `limited-reason`. `metadataString` is shared with the two other readers.
- `lib/email-address-evidence.ts` (`emailDomainEvidenceOf`): the disposable check's `match` and `match-depth`, the MX check's `route` and `record-count`.
- `lib/crypto-wallet-evidence.ts` (`cryptoWalletEvidenceOf`): both addresses as the API sent them, the chain, the consumed challenge's scheme (else the address check's), `address-type`, `checksum`, and every flag in a fixed order, each from the check that records it and only with the value type it records.
- Metadata is `unknown` in the contract, so a value of the wrong shape counts as not recorded.
- Fixtures: `src/testing/fixtures/phone-number.ts`, `email-address.ts`, `crypto-wallet.ts`, built on the golden fixtures through `phase5Verification`, with the checks' metadata as the evaluators write it (the golden email and crypto fixtures carry Stage 1a's guessed metadata for the domain checks). Every value is synthetic: a NANP 555-01xx number, `example.test`, EIP-55's published example, the sandbox RPC's documented contract wallet, invented Bitcoin and Solana strings that are not valid addresses.

**A RED committed with a type error.** `3fe5a744` typed the crypto fixture's check name as `string` (TS2322); my check piped `tsc` through `tail`, which hid its exit status. `e08d63f2` fixes it with no behaviour change. Since then every commit goes through a script that runs eslint, prettier and `tsc` with `set -o pipefail` and commits only when all pass.

```text
RED   $ vitest run src/lib/otp-evidence.test.ts src/lib/email-address-evidence.test.ts src/lib/crypto-wallet-evidence.test.ts --coverage.enabled=false
AssertionError: expected { walletAddress: null, …(6) } to deeply equal { …(7) }
AssertionError: expected { disposable: null, mx: null } to deeply equal { disposable: { …(2) }, mx: { …(2) } }
AssertionError: expected { destination: null, …(5) } to deeply equal { destination: '+15555550100', …(5) }
 Test Files  3 failed (3)
      Tests  16 failed | 4 passed (20)
GREEN $ vitest run src/lib/otp-evidence.test.ts src/lib/email-address-evidence.test.ts src/lib/crypto-wallet-evidence.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  20 passed (20)
```

The 4 that passed in RED are the "nothing recorded" cases, which the stub's nulls also satisfied.

## Slice 5: the three evidence views

RED `20ec0411` (the placeholders render the generic view, so the tests compile and fail on its terms), GREEN `1ca64c5c`, pins `9c112fb5`.

- `components/evidence/parts.tsx` (shared, for any type view): `PersonalValue` ("Hidden" when the API masked a value, "Redacted" after a redaction, "None" when there is none), `NotRecorded` ("Not recorded yet" before the checks ran, "Not recorded" after), `Code`, `Words` (words with their explanation, or the code itself when the console has no words), `PassMeans`.
- `components/evidence/otp-details.tsx` (phone and email): Confirmed (UTC) or "Not confirmed", Sends, Failed attempts, Channel, and "Refused by" with the limit in words only when a limit refused the user.
- `phone-number.tsx`, `email-address.tsx` (plus the disposable-domain lists with where the match was, and the mail domain with its record count), `crypto-wallet.tsx` (wallet and expected address, chain and scheme in words with their codes, address type, checksum, the flags raised, "None raised" for a low-s signature).
- Each is one `role="group"` named "<title> evidence" whose terms sit directly in one `<dl>`, so the phone e2e helper `evidenceValue` (`e2e/tests/support/phase5.ts`) still reads the number by its term, and the card's and page's shared tests (one group per evidence region, every PII value in the text with `pii:view`, none in the RSC payload without it) hold for these types.
- The pins (written after the code, so never RED): a verification of another type reaches the generic view, never these.

```text
RED   $ vitest run src/components/evidence/{phone-number,email-address,crypto-wallet}.test.tsx --coverage.enabled=false
TestingLibraryElementError: Unable to find an element with the text: Confirmed (UTC), which matches selector 'dt'.
TestingLibraryElementError: Unable to find an element with the text: Disposable-domain lists, which matches selector 'dt'.
TestingLibraryElementError: Unable to find an element with the text: Chain, which matches selector 'dt'.
 Test Files  3 failed (3)
      Tests  22 failed | 7 passed (29)
GREEN $ vitest run src/components/evidence/{phone-number,email-address,crypto-wallet,index,generic}.test.tsx src/components/verification-card.test.tsx src/app/verifications/[id]/page.test.tsx src/app/inquiries/[id]/page.test.tsx --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  188 passed (188)
```

The 7 that passed in RED are what the generic view already did right: "Hidden" and "Redacted" for the phone number, the group's name, the expected address, no limit named, and one term per row.

## Slice 6: the evidence views get their verification's files (a shared hook for dashboard-documents)

`dashboard-documents`' document view takes `files` and `media` beside its props (`4dbe0778`), which only the shared card and page can pass. Stub `6e5554f7` (the two optional members on `EvidenceProps`), RED `2cad4b77` (`components/evidence/props.test.tsx`, which replaces the document view with one that prints what it got), GREEN `110c4f09`: the card passes the verification's files and media; the page passes the verification's own files as the inquiry document names them (none when the inquiry could not be read) and its media.

```text
RED   $ vitest run src/components/evidence/props.test.tsx --coverage.enabled=false
     × gets the verification files and their media from the card
     × gets the verification files from the page, and no file of another verification
     × gets the media and the state as hidden on the page without pii:view, and redacted after a redaction
     × gets no file on the page when the inquiry, which names their kinds, could not be read
TestingLibraryElementError: Unable to find an element with the text: Files: file_01JB0000000000000000000020 file_01JB0000000000000000000021; media: visible; state: visible.
      Tests  4 failed (4)
GREEN $ vitest run src/components/evidence/props.test.tsx src/components/verification-card.test.tsx src/app/verifications/[id]/page.test.tsx src/app/inquiries/[id]/page.test.tsx src/components/evidence/index.test.tsx --coverage.enabled=false
 Test Files  5 passed (5)
      Tests  146 passed (146)
```

## Slice 7: the text message budget on the settings page

RED `d5ad8dca`, GREEN `05e60ab3`, a type fix `e9c327fc` (the GREEN was committed with two type errors, TS2353 and TS2345, hidden the same way as in slice 4; no behaviour change).

- `components/operators/settings-fields.ts`: `OTP_FIELD` (`otp-sms-max-per-hour`, "Text messages per hour", from `OTP_SMS_MAX_PER_HOUR.min` to the installation's ceiling, `OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING`, 1,000 unless the operator set another; the form's own bound is the contract's 1,000,000).
- `components/operators/budget-tripped.tsx`: "Budget last tripped (UTC)", read-only: the time, "Never", or "Not reported" by an older server.
- The form (only for `settings:write`; the page already chose the form or the view by it) has a "Text message codes in <environment>" fieldset: the field, and the tripped time as a term, never an input. A refusal shows on the field by its JSON Pointer `/otp-sms-max-per-hour`. A server that does not report the budget gets no field ("Not reported by this server.").
- The read-only view (`settings:read` alone) shows both.
- `app/settings/actions.ts` reads the budget only when the form carries it: a whole number from 1 to 1,000,000 (else one field error saying the ceiling may be lower), sent only when changed. A budget above the ceiling is the API's to refuse (422 at `/otp-sms-max-per-hour`), and its pointer comes back to the field.

```text
RED   $ vitest run src/app/settings src/components/operators/settings-form.test.tsx --coverage.enabled=false
     × sends a changed text message budget, and nothing for the read-only tripped time (C55.7)
     × refuses a text message budget of "0" on its field, without calling the API (C55.7)
     × shows the API's refusal of a budget above the installation ceiling on its field (C55.7)
     × shows the text message budget and when it last tripped, read-only with settings:read alone (C55.7)
     × shows the budget of the environment, bounded from 1, naming the installation ceiling
     × asks for no budget a server does not report
     … (16 in all)
 Test Files  3 failed | 1 passed (4)
      Tests  16 failed | 37 passed (53)
GREEN $ vitest run src/app/settings src/components/operators --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  91 passed (91)
```

"sends no unchanged text message budget" passed in RED too (nothing was sent either way).

## Slice 8: the navigation entry of the chip trust store

RED `ca0fc01a`, GREEN `ebc84c62`. `components/nav-items.ts` links "Chip trust store" at `/trust-anchors` under Organization after Settings, gated by `settings:read` (the scope of `GET /dashboard/trust-anchors`); it is a section of its own, never marked as Settings. `dashboard-documents` owns the page (its `app/trust-anchors` route folder).

Existing tests changed because the plan adds the entry: `components/nav-items.test.ts` (the route list and the admin's count, 12 to 13) and `components/nav.test.tsx` (the link count, 12 to 13).

```text
RED   $ vitest run src/components/nav-items.test.ts src/components/nav.test.tsx src/components/console-layout.test.tsx --coverage.enabled=false
     × lists every C23 console route, each gated by the permission that reads it
     × is linked under Organization after Settings, read with settings:read as its API route is
     × is shown to a role that reads settings, and hidden from one that does not
     × shows an admin everything
     × is the console navigation, with a labelled list per group
      Tests  5 failed | 22 passed (27)
GREEN $ vitest run src/components/nav-items.test.ts src/components/nav.test.tsx src/components/console-layout.test.tsx --coverage.enabled=false
      Tests  27 passed (27)
```

## Slice 9: the people verification pages, through their own mock routes (pins)

`src/testing/routes/people.ts` (`servePeopleVerification`) answers the verification page's two reads on `routeApi`: the verification, and the dashboard inquiry document carrying it or another copy of it (`seen`), so a test proves the page shows only the verification answer. `app/verifications/[id]/people.test.tsx` (`d9a76a7c`) pins, on the real page: a limit refusal named in the evidence and in "Why it needs review", the comparison row "Not applicable" with its category; an advisory email failure as advisory, with its reason and category; a contract wallet with its flag, reason and explanation; and, for a viewer, no phone number and no wallet address in the page text or the RSC payload (`rscPayloadOf`) even though the inquiry document carries them unmasked; and "Redacted" after a redaction. These were written after the views, so they never failed first.

```text
$ vitest run src/app/verifications/[id]/people.test.tsx --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## Slice 10: the README section on the Phase 5 console

`apps/dashboard/README.md` (`eb2b7e84`): "Phase 5 verifications in the console": how a type's evidence view is built (the view, its evidence reader, its words with the pass line, its reason words, its fixtures) and the tests that bind each to the contracts, the evaluators and `docs/checks`; the rules every view keeps (the answer only, never unmasking, one group with its terms in one list, codes for values without words, no colour alone, no alt text naming the person); the check rows' category and advisory wording; the people types with what a pass means for each; the text message budget setting; the trust store link; the per-area mock routes and specs. The "Shared components" table gains `VerificationEvidence` and the evidence parts.

## Slice 11: the full-stack spec `ui-people`

`e2e/tests/ui-people.spec.ts` (`372acbf5`, extended in `5ed5c5ad`) with its helpers `e2e/tests/support/people.ts` (`peopleFlow`: consent, create, send and confirm a code, a crypto challenge, submit, wait for the decision; `evidenceTerm`, `checkRowOnPage`, `openFoldedChecks`). Each test makes its own template, inquiry and verification through the flow API with the stack's sandbox providers (C63), so it depends on no other spec's data:
1. **Phone:** a code to `+12025550163` (NANP 555-01xx, another number than `phone-otp.spec.ts`'s), read from the sandbox SMS sink with the seeded `sandbox:read` key, one wrong code, then the right one, submitted, passed. A reviewer reads the number, Confirmed (UTC), Sends 1, Failed attempts 1, the channel, the sandbox sender labelled as sending nothing, what a pass means, and the comparison row Passed, Required, User action required; no code on the page. A viewer sees the number "Hidden".
2. **Email:** a code to `ui-people-<run>@denied.test` through Mailpit, the template denying `denied.test` on the advisory disposable check: the verification passed; the reviewer reads the deny-list match on the address's own domain, the reserved mail domain, and the disposable row Failed, Advisory, "Does not decide the verification", "Disposable email domain", Fraud.
3. **Crypto:** the sandbox RPC's contract wallet `0x…0c0de5`, the challenge signed with EIP-191 by its owner key (derived from its label, as the API and checks tests do): needs review. The reviewer reads the address, "EVM network 1" with `eip155:1`, "EIP-191 personal message", "EVM account", "Absent", the contract wallet flag and its explanation, the sandbox RPC labelled, what a pass means, "Why it needs review" naming `crypto_wallet_address_comparison (Contract wallet, not allowed)`, and the row Not applicable, Fraud. A viewer sees the address "Hidden".
4. **Settings:** an admin reads the budget and its tripped time ("Never", or the time the API reports), enters 1,000,000 (within the contract, above the installation's ceiling), and the API's 422 lands on the field ("must be at most …") with nothing saved; then saves another value ("Settings saved.", read back through the dashboard API). A viewer reads it, read-only, with no spinbutton, and is offered the "Chip trust store" link (`/trust-anchors`); a reviewer, without `settings:read`, is not. The original is restored in `finally` through the dashboard API and read back.

The spec was written after the views it checks, so it never failed first. It sends two codes from 127.0.0.1 (C65.5), to its own destinations.

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test tests/ui-people.spec.ts'
[e2e +43.7s] stack ready; logs in e2e/.artifacts/logs
Running 4 tests using 1 worker
✓  1 [chromium] › tests/ui-people.spec.ts:62:1 › a reviewer reads a phone number verification: … (4.0s)
✓  2 [chromium] › tests/ui-people.spec.ts:121:1 › a reviewer reads an email address verification: … (3.6s)
✓  3 [chromium] › tests/ui-people.spec.ts:175:1 › a reviewer reads a contract wallet sent to review, … (3.5s)
✓  4 [chromium] › tests/ui-people.spec.ts:241:1 › an admin changes the text message budget, … (3.1s)
4 passed (1.0m)
```

## Slice 12: the sandbox providers labelled in the evidence

Team rule 10 and ADR 0002 §3d: a sandbox provider is labelled sandbox. The check rows named the provider only inside each result's provenance disclosure, so the people evidence now names it beside the values. Stub `3f3f2362`, RED `2587b87c`, GREEN `819a391c`.
- `otpEvidenceOf` reads `sender`, the provider the OTP comparison's provenance names; `cryptoWalletEvidenceOf` reads `rpc`, the provider the address check names, which it does only when it asked the EVM RPC about a contract wallet.
- The phone and email views show "Sent through" (the provider id, and for a sandbox one `OTP_SANDBOX_SENDER_TEXT`: it sends no text message, keeps the code for tests, and is refused in production; email's sender is the API's mailer, `smtp`, never a sandbox); the crypto view shows "Contract checked by" only when an RPC was asked (`SANDBOX_RPC_TEXT` for the sandbox one).
- The readers' two whole-object cases (`toEqual`) gained the new member in the RED commit.

```text
RED   $ vitest run src/lib/{otp,crypto-wallet}-evidence.test.ts src/lib/{otp,crypto-wallet}-words.test.ts src/components/evidence/{phone-number,email-address,crypto-wallet}.test.tsx --coverage.enabled=false
     × says the sandbox EVM RPC answers for a test contract, never a real chain (ADR 0002 §3d, C57.5)
     × reads the sender the comparison names, and whether it is a sandbox provider (C56, ADR 0002 §3d)
     × names the sender, and says a sandbox sender sent nothing (ADR 0002 §3d)
     × names the EVM RPC asked about a contract wallet, and says when it is the sandbox one (C57.5, ADR 0002 §3d)
     … (9 in all)
 Test Files  7 failed (7)
      Tests  9 failed | 99 passed (108)
GREEN $ vitest run (the same, with src/app/verifications/[id]/people.test.tsx and src/components/evidence/index.test.tsx) --coverage.enabled=false
 Test Files  9 passed (9)
      Tests  135 passed (135)
```

## Final gates (in the foreground)

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/dashboard typecheck`, `lint`, `test` | pass: 225 files, 3,025 tests; coverage 98.64% statements, 93.98% branches, 99.14% functions, 98.63% lines (gate 80%); 3 min 30 s |
| `pnpm typecheck && pnpm lint && pnpm format:check` | pass (13 + 13 tasks; every file formatted). A first run failed only on `dashboard-records`' then-uncommitted `e2e/tests/support/records.ts` (`no-unnecessary-type-assertion`); the rerun after it landed passed |
| Mocked flow suite: `flock /tmp/openverify-e2e.lock pnpm turbo run e2e --filter=@openverify/flow` | 68 passed (25.2 s) |
| Full stack, shard 1: `flock /tmp/openverify-e2e.lock sh -c 'pnpm turbo run build --filter=@openverify/e2e^... && pnpm --filter @openverify/e2e exec playwright test --shard=1/2'` | 44 passed (2.7 min). A first run, before `dashboard-documents` committed `ui-documents.spec.ts`, failed only its 3 in-progress tests (41 passed) |
| Full stack, shard 2 (same, `--shard=2/2`) | 38 passed (7.9 min), `ui-people` (4) and `ui-records` among them |

`pnpm e2e` is `turbo run e2e`: the mocked flow suite, then the full-stack suite with its dependencies built. Run whole, it takes longer than one 10-minute foreground call, so it ran as these three parts, each under the e2e lock. The full-stack suite holds 82 tests (44 + 38); with the 68 mocked ones, every test of `pnpm e2e` passed.
