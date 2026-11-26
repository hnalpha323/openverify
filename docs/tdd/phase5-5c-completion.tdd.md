# TDD evidence: Workflow 5C completion (the last agent of Phase 5)

- **Slice owner:** the Workflow 5C completion agent, running alone after the 5C review fixes.
- **Date:** 2026-10-24.
- **Items:** C66's chip portrait beside the selfie (the console), and four LOW review findings: P026 (flow, crypto wallet), P027 (flow, one-time code), P028 (Android phone entry and the crypto limits) and P019 (the vision-container test in CI).

Each item follows the same cycle:
1. A stub where a name was missing.
2. A regression test, run to see it fail for the intended reason (RED), committed first.
3. The smallest change that passes it (GREEN), then a refactor with the suite green.

Every command ran after `source scripts/env.sh`. Vitest runs of single files pass `--coverage.enabled=false`, because each package's 80% gate applies to its whole suite, which the final gates run. The output is trimmed to the lines that matter.

## Item 1. C66: the chip portrait beside the selfie (the console)

**Confirmed.** `components/evidence/government-id-nfc.tsx` shows the selfie centre photo only when it receives `inquiryFiles`. Neither the card nor the page passed it, so the console always showed "Shown with the selfie verification <id>" beside the chip portrait (`dashboard-documents` amendment 2).

**Stub** (`a486611c`): `EvidenceProps.inquiryFiles?: readonly FileResource[] | undefined` in `components/evidence/generic.tsx`, documented as unknown when `undefined`. Nothing passed it yet.

**RED** (`524763dc`):
- `components/evidence/government-id-nfc.test.tsx`:
  - a new "on its card" group: side by side with the inquiry's files, the pointer without them, and hidden without `pii:view` or redacted;
  - three page tests: side by side from the inquiry document, the pointer when the inquiry cannot be read, and hidden or redacted.
- `components/evidence/props.test.tsx`: what the card and the page hand over as `inquiryFiles`. The card hands over the files it holds and nothing otherwise. The page hands over the inquiry document's files, or nothing when the inquiry could not be read.

```text
$ pnpm --filter @openverify/dashboard typecheck
✓ Types generated successfully
$ pnpm exec vitest run src/components/evidence/props.test.tsx src/components/evidence/government-id-nfc.test.tsx
     × gets the inquiry’s files from the card when it holds them, and none given otherwise (C66)
     × gets the inquiry’s files from the page when the inquiry document is known, and none given otherwise (C66)
     × shows the chip portrait beside the selfie centre photo, from the inquiry’s files
     × hides both images without pii:view, and says Redacted after a redaction
     × shows the selfie centre photo beside the chip portrait, from the inquiry document
     × hides the selfie photo without pii:view, and says Redacted after a redaction
TestingLibraryElementError: Unable to find an accessible element with the role "img" and name "Selfie centre photo the portrait was compared with"
Expected element to have text content:
  Hidden
Received:
  Shown with the selfie verificationver_01M5CK3M4N5P6Q7R8S9T0V1W2X
TestingLibraryElementError: Unable to find an element with the text: Inquiry files: file_01JB…020 file_01JB…021 file_01JB…022.
      Tests  6 failed | 28 passed (34)
```

The two pointer tests passed at RED: they pin the pointer, which must stay when the files are unknown.

**GREEN** (`bb935907`):
- `VerificationCard` passes its `referenceFiles` as `inquiryFiles`. Its default of `[]` is gone, so a card given none hands over `undefined` and the pointer stays; the selfie sections still take `referenceFiles ?? []`.
- `VerificationView` passes the inquiry document's file resources, and `undefined` when the inquiry is not ready.
- The image goes through `VerificationImage`: the file route, its `media`, "Hidden" without `pii:view`, "Redacted" after a redaction. The alt text "Selfie centre photo the portrait was compared with" names the image, never the person.

```text
$ pnpm exec vitest run --coverage.enabled=false src/components/evidence/props.test.tsx src/components/evidence/government-id-nfc.test.tsx
 Test Files  2 passed (2)
      Tests  34 passed (34)
$ pnpm exec vitest run --coverage.enabled=false src/components/evidence/ src/components/verification-card.test.tsx src/app/verifications src/components/lifecycle
 Test Files  34 passed (34)
      Tests  451 passed (451)
```

**Refactor** (`e249fe0b`): `ChipEvidenceProps` is now `EvidenceProps` itself, which carries `inquiryFiles`.

```text
$ pnpm exec vitest run --coverage.enabled=false src/components/evidence src/lib/government-id-nfc-evidence.test.ts
 Test Files  13 passed (13)
      Tests  231 passed (231)
```

**End to end** (`9f36b3fc`, written after the fix):
- The chip test in `e2e/tests/ui-documents.spec.ts` now loads both images inside their terms, on the verification page and on the inquiry's card: "Chip portrait", and "Selfie centre photo the portrait was compared with" in "Selfie photo".
- Its pointer assertion on the selfie verification id is gone, since the photo replaces the pointer.
- The shared `expectImageLoaded` now checks that the image is visible before scrolling to it. A missing image then fails by name within the expect timeout, not at the 300 s test timeout.

It was shown failing against a mutation of both call sites to `inquiryFiles={undefined}`. The mutation was restored afterwards, and `git diff -- apps/dashboard` was empty.

```text
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm --filter @openverify/e2e exec playwright test tests/ui-documents.spec.ts -g "chip verification" --reporter=line'
# first run, before the helper change: Test timeout of 300000ms exceeded; the page snapshot shows
#   - term: Selfie photo / definition: Shown with the selfie verification ver_01M5QCV2XXXG9EWS8A0VT8EF86
# second run, with the helper change:
    Error: expect(locator).toBeVisible() failed
    Locator: getByRole('group', { name: 'Government ID chip evidence' }).locator('dt:text-is("Selfie photo") + dd').getByRole('img', { name: 'Selfie centre photo the portrait was compared with' })
    Error: element(s) not found
  1 failed
# the mutation restored:
$ flock /tmp/openverify-e2e.lock sh -c 'pnpm --filter @openverify/e2e exec playwright test tests/ui-documents.spec.ts --reporter=line'
  3 passed (1.0m)
```

## Item 2. P026 (LOW): the wallet path read the eleventh message as an expired one

**Confirmed.** `signWithWallet` in `apps/flow/src/steps/crypto-wallet/crypto-wallet-step.tsx` sent every non-wallet error to `submitRefused`, including the errors of `createCryptoChallenge`. The eleventh challenge cancels the attempt and answers 409 `crypto_challenge_invalid` (C57.2). `submitRefused` read that as an expired message and never called `onSubmitted()`, so the screen kept offering Connect on a canceled verification. The paste path (`getMessage` → `refused`) already reloaded.

**RED** (`66a9de46`), in the wallet group of `crypto-wallet-step.test.tsx`:
- the eleventh message on Connect reloads the session once, says nothing of an expired message, and never asks the wallet to sign;
- a pin: the submit's own `crypto_challenge_invalid` still asks for a new message without reloading.

```text
$ pnpm --filter @openverify/flow typecheck
$ tsc --noEmit && tsc --noEmit -p e2e
$ pnpm exec vitest run --coverage.enabled=false src/steps/crypto-wallet/crypto-wallet-step.test.tsx
       × reloads the session when connecting asks for the attempt’s eleventh message (C57.2, Workflow 5C review P026)
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
      Tests  1 failed | 41 passed (42)
```

**GREEN** (`3e6b4483`): `signWithWallet` notes when it reaches the submit. A refusal from that point goes to `submitRefused`, and any earlier one (the challenge, the verification's creation) to `refused`, which reloads the session on a 409, as the paste path does.

```text
$ pnpm exec vitest run --coverage.enabled=false src/steps/crypto-wallet/
 Test Files  2 passed (2)
      Tests  45 passed (45)
```

## Item 3. P027 (LOW): "Send a new code" after a resume refused an empty destination

**Confirmed.** A resumed verification with an open code starts in the code view with an empty destination: the API serves only the masked one. "Send a new code" called `send('code')`, and `sendBody()` failed with `required`. The screen then switched to the entry with an error and moved focus to the field, although the user had typed nothing. Android's `resendOtp` asks for the destination without an error.

**RED** (`e9ed50a0`), in `one-time-code-step.test.tsx`:
- a phone resume test: after a resume, the screen goes to the entry with focus on its heading, the field has no `aria-invalid` and no "Enter your phone number." description, and nothing is sent until the number is entered;
- an email resume test, for the other channel.

```text
$ pnpm exec vitest run --coverage.enabled=false src/steps/otp/one-time-code-step.test.tsx
       × asks for the number again, without an error, when a new code is asked for after a resume (Workflow 5C review P027)
     × asks for the address again, without an error, when a new code is asked for after a resume (Workflow 5C review P027)
Error: expect(element).toHaveFocus()
Expected element with focus:
  <h1 …
Received element with focus:
  <input aria-describedby="_r_6_-description _r_6_-error" aria-invalid="true" autocomplete="tel-national" … value="" />
      Tests  2 failed | 59 passed (61)
```

**GREEN** (`8bc33bf4`): `send('code')` goes to the entry without an error (`showEntry(null)`, focus on the heading through `useScreenFocus`) when the destination was not entered in this screen. A code sent from there supersedes the open one, as "Change number" already did.

```text
$ pnpm exec vitest run --coverage.enabled=false src/steps/otp/
 Test Files  1 passed (1)
      Tests  61 passed (61)
```

## Item 4. P028 (LOW): Android bounded the phone number only in the API client, and the crypto limits said nothing

**Confirmed.**
- `FlowApiClient.sendOtp` ends in `require(phoneNumber.length in 1..32)` (and `3..254` for an email address). The phone entry has no cap and sends `+<code> <typed>`, so a pasted note after the number made `require()` throw. `otpRequest` turned the `IllegalArgumentException` into the terminal `FlowError.INVALID_RESPONSE` with no retry.
- `createCryptoChallenge` returned silently for an address over 128 characters, and `submitCryptoSignature` did the same for a signature over 1,024 characters or a signed message over 4,096 bytes. The buttons did nothing and the screen said nothing. The signed message is the same defect in the same function, so it is fixed with the others.

**Stub** (`edb85858`):
- `OtpError.DESTINATION_TOO_LONG`, `CryptoError.SIGNATURE_TOO_LONG` and `CryptoError.SIGNED_MESSAGE_TOO_LONG`;
- their English and Spanish words in `strings_otp.xml` and `strings_crypto_wallet.xml`. Each Spanish text differs from its English one, which `SpanishMessagesTest` checks.

The `when`s mapped the new values to existing words until the fix. Nothing produced them yet.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests '*FlowCoordinatorOtpTest*' --tests '*FlowCoordinatorCryptoTest*' --tests '*OtpStepScreenTest*' --tests '*CryptoWalletStepScreenTest*' --tests '*ResourcesTest*' --tests '*SpanishMessagesTest*'
tests 104 failed 0 skipped 0
```

**RED** (`e6aa90c2`). The tests compile against the stub.
- `FlowCoordinatorOtpTest`:
  - a 36-character pasted phone number is never sent and the entry shows `DESTINATION_TOO_LONG`, while a 32-character one is sent;
  - a 255-character email address is never sent either.
- `FlowCoordinatorCryptoTest`:
  - a 129-character address is never sent, and the entry shows `ADDRESS_INVALID`, as the web flow does;
  - a 1,025-character signature and a 4,098-byte Solana signed message are never sent, and the message screen shows which.
- `OtpStepScreenTest`: the phone and email words of `DESTINATION_TOO_LONG` on the entry.
- `CryptoWalletStepScreenTest`: the message screen shows the signature's and the signed message's words, and none without an error.
- Two existing tests lose their overlong cases (now in the new tests) and their names drop "too long": `a chain the step does not offer, or a blank address, is never sent` and `a blank signature, or one without a message, is never sent`.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests '*FlowCoordinatorOtpTest*' --tests '*FlowCoordinatorCryptoTest*' --tests '*OtpStepScreenTest*' --tests '*CryptoWalletStepScreenTest*'
FAILED OtpStepScreenTest > a destination over its limit is said on the entry, in the words of its channel (Workflow 5C review P028)
    java.lang.AssertionError: Failed: assertExists. … could not find any node that satisfies: (Text … contains 'This number is too long. Enter only the phone number, with no other text.'
FAILED CryptoWalletStepScreenTest > a signature or signed message over its limit is said on the message screen
    java.lang.AssertionError: Action performScrollTo() failed. … contains 'This signature is too long. Paste only the signature.'
FAILED FlowCoordinatorOtpTest > an email address over the 254 characters the server takes is never sent, and the entry says so (Workflow 5C review P028)()
    expected: <Otp(… error=DESTINATION_TOO_LONG …)> but was: <Otp(… code=OtpCode(maskedDestination=<redacted>, … sendsRemaining=4 …), error=null …)>
FAILED FlowCoordinatorOtpTest > a number over the 32 characters the server takes is never sent, and the entry says so, keeping the step (Workflow 5C review P028)()
    expected: <Otp(… error=DESTINATION_TOO_LONG …)> but was: <Otp(… code=OtpCode(… sendsRemaining=4 …), error=null …)>
FAILED FlowCoordinatorCryptoTest > an address over the 128 characters C57_1 allows is never sent, and the entry says it is not an address (Workflow 5C review P028)()
    expected: <CryptoWallet(… error=ADDRESS_INVALID …)> but was: <CryptoWallet(… challenge=null, retryHints=[], error=null …)>
FAILED FlowCoordinatorCryptoTest > a signature or signed message over its C57_1 limit is never sent, and the message screen says which (Workflow 5C review P028)()
    expected: <CryptoWallet(… error=SIGNATURE_TOO_LONG …)> but was: <CryptoWallet(… challenge=CryptoChallenge(id=cwc_01M5CK16P0D13FXHZSS4TCFB01 …), error=null …)>
tests 99 failed 6 skipped 0
```

The fake server takes any destination, so the OTP RED shows the overlong number sent. Against the real client that send is the `require()` and the dead end.

**GREEN** (`2c634156`):
- `OtpLimits.PHONE_MAX_LENGTH` (32), `EMAIL_LENGTHS` (3..254) and `tooLong(destination)` in `model/Otp.kt` (commonMain).
- `FlowCoordinator.sendOtp` sets `DESTINATION_TOO_LONG` on the entry instead of sending.
- `createCryptoChallenge` sets `ADDRESS_INVALID` for an overlong address.
- `submitCryptoSignature` sets `SIGNATURE_TOO_LONG` or `SIGNED_MESSAGE_TOO_LONG`, and keeps the shown state without the error for a later refusal.
- The message screen shows `state.error` above the busy row. The words map to their own strings.
- `require()` in the API client stays as the last guard.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests '*FlowCoordinator*' --tests '*OtpStepScreenTest*' --tests '*CryptoWalletStepScreenTest*' --tests '*ResourcesTest*' --tests '*SpanishMessagesTest*' --tests '*FlowApiClient*'
exit=0
tests 383 failed 0 skipped 0
```

**Refactor** (`db21bb65`): `FlowApiClient.OTP_PHONE_MAX_LENGTH` and `OTP_EMAIL_LENGTHS` read `OtpLimits`, so the client and the coordinator share one bound.

```text
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests '*FlowApiClient*' --tests '*FlowCoordinatorOtpTest*'
exit=0
tests 152 failed 0
```

## Item 5. P019 (LOW): the container and network layers were checked only by hand

**Confirmed.**
- `grep -n 'vision-container\|infra/tests' .github/workflows/ci.yml` matched only the header comment that names `ci-workflow.test.sh`. No job ran `infra/tests/vision-container.test.sh`, not even its `--static-only` half.
- The live probe imported pypdf and pypdfium2 and printed process facts. It never started the guarded worker inside the image, so nothing automated showed that the guard works there.

### The static half in CI

**RED** (`8ebd2b6f`): `infra/tests/ci-workflow.test.sh` requires a job `infra` with three checks:
- it runs exactly `bash infra/tests/vision-container.test.sh --static-only`;
- every call it makes to that script passes `--static-only`;
- no other job runs the script.

```text
$ bash infra/tests/ci-workflow.test.sh
FAIL - job 'infra' exists
FAIL - infra: runs the vision isolation contract's static half (bash infra/tests/vision-container.test.sh --static-only) ([])
FAIL - infra: never runs the contract's live half, which builds and starts the vision image ([])
# 175 passed, 3 failed, 0 skipped
```

**GREEN** (`42d17669`): `.github/workflows/ci.yml` gains the `infra` job, on `ubuntu-latest` with a 10-minute timeout. It checks out the repository without persisted credentials (the pinned `actions/checkout`), prints the Docker Compose and jq versions, and runs the static half.

```text
$ bash infra/tests/ci-workflow.test.sh
ok   - job 'infra' exists
ok   - job 'infra' sets timeout-minutes
ok   - job 'infra' runs on an ubuntu runner
ok   - infra: runs the vision isolation contract's static half (bash infra/tests/vision-container.test.sh --static-only)
ok   - infra: never runs the contract's live half, which builds and starts the vision image
ok   - infra: no other job runs the vision isolation contract (one place to read its result)
ok   - actionlint 1.7.12 reports no problems
# 180 passed, 0 failed, 0 skipped
```

The static half needs only `docker compose config`, jq and `.env.example`. It passes with an empty environment:

```text
$ env -i PATH="$PATH" HOME="$HOME" bash infra/tests/vision-container.test.sh --static-only
# 24 passed, 0 failed
```

It catches the three changes the finding names. Each was a one-line mutation of `infra/docker-compose.yml`, restored afterwards (`git diff --stat` empty):

```text
== mutation: networks: [vision] -> [vision, default]
FAIL - vision is on the vision network only (expected '["vision"]', got '["default","vision"]')
# 23 passed, 1 failed
== mutation: cap_drop: [ALL] -> []
FAIL - vision drops every capability (expected '["ALL"]', got '[]')
# 23 passed, 1 failed
== mutation: read_only: true -> false
FAIL - vision's root filesystem is read-only
# 23 passed, 1 failed
```

### The live half: the guard inside the image and a real PDF

**Test** (`4f6f5d5f`). It pins built behaviour, so it passed when written. A second probe runs in a vision container of the test's own compose project:
- `protect_parent()` first, as `create_app` does;
- then `run_guarded("probe", {"import_tasks": true, "read_parent": true})`, the real `python -I -B -m openverify_vision.guarded.worker` with `env={}` on the read-only root as uid 10001.

The checks:
- the C60.2 rlimits, exactly: `as` 1,610,612,736 both ways, `cpu` 20 and 21, `fsize`, `core` and `nproc` 0, `nofile` 64;
- `NoNewPrivs` 1, an empty initial environment, no fork and no thread;
- none of pydantic, NumPy, OpenCV or onnxruntime loaded with every task module;
- none of the parent's `environ`, the token's name or its `fds` readable (P018).

Then the probe POSTs a one-page born-digital PDF that it writes itself to `http://vision:8000/v1/analyze/document`, with the service token from its own environment. It checks:
- a 200 answer, `source` `pdf` and a `page_count` of 1;
- the visible text layer `["OpenVerify isolation probe"]`;
- an OCR agreement, so vision's OCR read the line.

The live half stays out of CI: no CI job builds the vision image, and it needs the model weights.

```text
$ bash infra/tests/vision-container.test.sh
ok   - the guarded probe and a PDF analysis run from inside a vision container
ok   - the guarded child reads back its C60.2 rlimits in the image
ok   - the guarded child runs with no-new-privileges in the image
ok   - the guarded child starts with an empty environment in the image
ok   - the guarded child cannot fork in the image
ok   - the guarded child cannot start a thread in the image
ok   - the guarded child loads no pydantic, NumPy, OpenCV or onnxruntime with every task
ok   - the guarded child cannot read its non-dumpable parent's environ or fds (P018)
ok   - the running vision analyses a real PDF (200)
ok   - the analysis reads it as a PDF
ok   - the analysis counts its one page
ok   - the guarded child reads its visible text layer
ok   - vision's OCR reads the line the text layer drew
# 55 passed, 0 failed
real	0m47.134s
```

**Mutation checks**, each a one-line change rebuilt into the image and restored afterwards (`git diff --stat` empty; a clean rerun passed 55 of 55):

```text
== guarded/runner.py: env={} -> env=None (the child inherits the container's environment)
FAIL - the guarded child starts with an empty environment in the image (expected '[]', got '["GPG_KEY", "HOME", "HOSTNAME", "LANG", …, "OPENVERIFY_VISION_SERVICE_TOKEN", …]')
# 54 passed, 1 failed
== guarded/__init__.py: address_space_bytes 1536 MiB -> 48 MiB (a guard that cannot run in the image)
FAIL - the guarded probe and a PDF analysis run from inside a vision container (Traceback … runner.py", line 244, in run_guarded     raise GuardedWorkerError("exit_status" …)
# 42 passed, 1 failed
```

`docs/checks/document.md` (`184dc96c`) now says which half checks what: the static half in the CI `infra` job, and the live half by hand. Its "What a pass means" section is unchanged, and `lib/document-words.test.ts`, which reads it, still passes (62 of 62).

## Final gates

Run in the foreground on `main` after the last code commit, each in one call:

| Gate | Result |
|---|---|
| `pnpm --filter @openverify/dashboard typecheck` and `lint` | pass |
| `pnpm --filter @openverify/dashboard test` | 225 files, 3,042 tests passed; coverage 98.64% statements, 94.03% branches, 99.14% functions, 98.64% lines (gate 80%) |
| `pnpm --filter @openverify/flow typecheck` and `lint` | pass |
| `pnpm --filter @openverify/flow test` | 65 files, 1,012 tests passed; coverage 96.35% statements, 89.91% branches, 96.96% functions, 96.39% lines (gate 80%) |
| `pnpm typecheck && pnpm lint && pnpm format:check` | 13 of 13 typecheck tasks and 13 of 13 lint tasks; Prettier clean |
| `pnpm --filter @openverify/flow e2e` (mocked flow suite, under the e2e lock) | 69 passed (20.8 s) |
| `(cd android && ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)` | BUILD SUCCESSFUL in 2 m 53 s; SDK host tests 1,264 in 70 classes, none failed or skipped (CI floor 1,256) |
| `bash infra/tests/ci-workflow.test.sh` | 180 passed, 0 failed, 0 skipped; actionlint 1.7.12 clean; the action pins verified against GitHub |
| `bash infra/tests/vision-container.test.sh` (static and live) | 55 passed, 0 failed (14.9 s with the image cached); `--static-only` 24 passed |
| Full-stack e2e, `playwright test --shard=1/2`, then `--shard=2/2`, each under the e2e lock after the `^build` | 42 passed (3.2 m); 40 passed (6.1 m); 82 of the suite's 82 tests (`playwright test --list`) |

`pnpm e2e` as one command (the mocked suite, the build and the 82 full-stack tests, about 10 minutes) does not fit one 10-minute foreground call. So it ran as its parts, as Workflow 5C Stage 1 did: the mocked suite, then the two shards, each under the lock.

Both compose projects these runs started, `openverify-e2e` and `openverify-vision-isolation`, removed themselves and their volumes at the end. No other container or volume was touched.

## Orchestrator, 2026-10-27: three tests that failed only with every package running at once

The full validation on `675b1ce6` (2026-10-24) failed only its unit-test step, in two tests. Each had passed in the agents' own runs:

```text
FAIL  src/document/classify.test.ts > classifyDocument > classifies four pages of 600 long near-matching lines within two seconds (C58.7)
AssertionError: expected 2576.946 to be less than 2000
FAIL  src/repositories/events-v2.test.ts > events by inquiry (C25.7, Workflow 2E) > combines with the other filters and the cursor
-   "evt_01M5QGQ0HB6ZE15RQ3SCYSQTZT",
+   "evt_01M5QGQ0GYDGDSPJXRRSEVBPFZ",
```

Both were reproduced under load before any change. The reproduction ran `pnpm turbo run test --force --continue` on the unchanged `675b1ce6` (896 s). Beside it ran a sampler that timed the classifier case in a separate process every 5 s, and a probe that read `Date.now()` in a loop. The probe kept one core busy, so this load was heavier than the validation's. It also failed a third test, `components/totp-enrolment.test.tsx` "drops the secret when the operator closes the dialog", a real race fixed below. The other failures in that run were timeouts that only this heavier load produced: two 20 s test timeouts in `flow` and four 60 s `beforeAll` hooks in `db` and `api`. The validation after the fixes is the check on those; see the Phase 5 PROGRESS entry.

```text
@openverify/checks:test: AssertionError: expected 2018.474 to be less than 2000
classifier case, CPU ms in a separate process under that load: n 80, min 929, median 1203, p90 1339, max 1742 (idle: 410-560)
Date.now() backward steps during the run: 10, the largest 11 ms
```

No test was retried, skipped or given a longer budget.

### The C58.7 classifier budget: the same work, made cheaper

**Cause.** `cpuMilliseconds` already measures process CPU time, not the wall clock (`72937dda`). On this Hyper-V guest that still varies with load. Twenty-four busy processes on 12 vCPUs doubled the case's CPU time in a plain Node process, and the validation's mixed load raised it four to six times. The guest has no steal-time accounting, the clock frequency drops under all-core load, a busy SMT sibling slows each core, and the GC threads are counted. No measurement inside the process can stay independent of that. So the budget stays at two seconds, and the work became cheaper.

A CPU profile of the case (`node --cpu-prof`, eight runs) put a third of the time in folding. `documentTokens` called `foldDocumentToken` for every token of every line. That called `foldText`, which builds the simplified rendering, the expanded one, a plain comparison and a Unicode test, and only the simplified one was kept. The lines of a document repeat their words, and this case repeats ten words 96,000 times.

**Stub** (`3a8b95e9`): `documentTokens(text, folds = new Map())` fills the map and does not read it yet.

**RED** (`cfe7dae5`), `text.test.ts` "folds each printed token once per map, so the lines of a document share the work (C58.7)": a map seeded with `Balance → already-folded` must be read, and a token not yet in it is added.

```text
$ pnpm --filter @openverify/checks exec vitest run src/document/text.test.ts --coverage.enabled=false
FAIL  src/document/text.test.ts > documentTokens > folds each printed token once per map, so the lines of a document share the work (C58.7)
AssertionError: expected [ 'balance', 'board', 'balance' ] to deeply equal [ 'already-folded', 'board', …(1) ]
      Tests  1 failed | 13 passed (14)
```

**GREEN** (`3730245c`): `documentTokens` reads the map first, and `documentLines` gives all the lines of one document one map. The map is bounded by C58.7's caps: four pages of 600 lines of 300 code points. **Refactor** (`0f01b90a`): `foldDocumentToken` is now `foldedTokens(token).join('')`, the same simplified fold without the three renderings it threw away. Its existing tests are unchanged and pass.

```text
$ pnpm --filter @openverify/checks exec vitest run src/document src/matching --coverage.enabled=false
 Test Files  28 passed (28)
      Tests  770 passed (770)
classifier case, a separate Node process, idle: documentLines 260 -> 24 ms, classifyDocument about 120-140 ms (unchanged), CPU 410-560 -> 236-246 ms
the test under Vitest with v8 coverage, as pnpm test runs it: 463-487 ms, fixture building included
```

The classifier's output is unchanged. Every document, lexicon, golden and classification test passes as before, so no plan amendment is needed.

### The events timeline: the test trusted the wall clock

**Cause.** The listing orders by `created_at DESC, id DESC` (C1, `repositories/pagination.ts`), and that is correct: keyset paging on the pair never skips or repeats an event. The test assumed the order the fixture wrote its events in. In the unit tests `created_at` is PGlite's `now()`, which reads `Date.now()` (emscripten's `_emscripten_date_now`), so to the millisecond. Two measurements on this machine showed what that means:
- **Ties:** 3,000 single-row inserts one after another tied on `now()` 1,440 times. A tie falls to the id, whose ULID is random within a millisecond.
- **Steps back:** the wall clock (`hyperv_clocksource_tsc_page`) went back twice in 90 s under CPU load, by up to 6 ms, and 10 times, by up to 11 ms, in the reproduction above.

The validation's failure needed a step back: the expected id is 13 ms newer than the one listed in its place. Commit `7e803519` fixed the same class of test in the API.

**RED** (`49d6fc36`), "keeps the timeline newest first when the wall clock runs backwards as it is written": the fixture writes its timeline while `Date.now` returns a millisecond less on every read, which PGlite's `now()` follows.

```text
$ pnpm --filter @openverify/db exec vitest run src/repositories/events-v2.test.ts --coverage.enabled=false
FAIL  src/repositories/events-v2.test.ts > events by inquiry (C25.7, Workflow 2E) > keeps the timeline newest first when the wall clock runs backwards as it is written
-   "evt_01M5YYD1AGF1BH2RYYCQWAXWP7",  (the listing is the fixture's order reversed)
      Tests  1 failed | 7 passed (8)
```

**GREEN** (`682dab04`), test only, as in `webhooks-v2.test.ts`: every event a test orders gets its own `created_at` from the file's clock, a second after the one before, through `stamped()`. It covers:
- the C12 filter test;
- the inquiry timeline, including the failing cursor test and the "newest first" test;
- the C40.1 selfie events.

```text
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

### The authenticator dialog ignored Escape on the secret step

**Cause.** `useFormAction` runs `onSuccess` inside the action, after its `await` and outside its transition. So the start action's answer renders the secret step one commit before `pending` clears. `TotpEnrolment` passed `dismissible={!starting && !confirming}`, so in that gap the secret step ignored Escape and the backdrop. The test pressed Escape as soon as the secret showed, and under load the gap was long enough. The other dialogs close themselves in `onSuccess`, so only this two-step dialog had the gap.

**RED** (`b404501c`), the new `components/totp-enrolment-pending.test.tsx`: its `useFormAction` stays pending after the answer, so the gap never closes. "closes on Escape once the secret shows, and drops the secret" fails. "stays open on Escape until the start action answers" passes before and after.

```text
$ pnpm --filter @openverify/dashboard exec vitest run src/components/totp-enrolment-pending.test.tsx --coverage.enabled=false
     × closes on Escape once the secret shows, and drops the secret 329ms
Error: expect(element).not.toBeInTheDocument()
      Tests  1 failed | 1 passed (2)
```

**GREEN** (`d410b04a`): `starting` is `starter.pending && enrolment === null`, so the start action holds the dialog only until its answer is in. Nothing can set the secret again after that, so closing then drops it for good.

```text
$ pnpm --filter @openverify/dashboard exec vitest run src/components/totp-enrolment-pending.test.tsx src/components/totp-enrolment.test.tsx src/components/kept-values.test.tsx src/app/account --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  109 passed (109)
```

Each RED commit typechecks and lints. Each change ran `eslint`, `typecheck` and `prettier --check` on its files before the commit. The full validation then ran on `d410b04a`.

### After the push: two checks that a random string could fail

CI run 40536008063, on the push of `92ea5ec7`, failed its `node` job in one `db` test. Every other job passed.

```text
FAIL  src/repositories/verification-inputs.test.ts > putEnteredVerificationInputs (C52.3) > writes the entered values sealed, with their names, from the flow
AssertionError: expected 'ov1.J56q-1Vb7HU.hgbE7AouUS_Dkjq6BltUi…' not to contain 'US'
```

**Cause.** The test looked for each entered value in the sealed column, and one value is the country code `US`. A sealed column is base64url ciphertext, and its random segments spell a given two-letter value about once in 30 seals. `apps/api/src/jobs/process-database.test.ts` already skips values of two letters or fewer for that reason. A search for the same class found one more. `routes/flow/otp.test.ts` checked that a refused phone number is not echoed with `not.toContain('202')` on the whole problem body, and the body's `requestId` is a random UUID. A UUID spells 202 in about one request in 140, so that file failed about one run in 35.

**RED** (`767801d2`): the check moved into `expectNoValueInTheClear`, unchanged. Its new test seals the values until a real ciphertext spells `US` (bounded at 10,000 seals), and the check fails on it. A second test checks that a column holding the values in the clear still fails.

```text
$ pnpm --filter @openverify/db exec vitest run src/repositories/verification-inputs.test.ts --coverage.enabled=false
FAIL  src/repositories/verification-inputs.test.ts > expectNoValueInTheClear > passes a sealed column whose ciphertext happens to spell a short value
AssertionError: expected 'ov1.FD3t0zESGiY.MTPhU6tba-DyZau1-ziKF…' not to contain 'US'
      Tests  1 failed | 9 passed (10)
```

**GREEN** (`922c4909`): the column must be one `ov1` envelope, using the pattern of `crypto.test.ts`, which is base64url segments only, and no value may appear as the JSON string it would be stored as (`"US"`). A plaintext column fails both checks, and no ciphertext can contain a quote.

```text
      Tests  10 passed (10)   (three runs)
```

**RED** (`640b90de`): the refusals send `x-request-id: trace-202-from-the-edge`, a well-formed client id that the API echoes as `requestId`.

```text
$ pnpm --filter @openverify/api exec vitest run src/routes/flow/otp.test.ts --coverage.enabled=false -t refuses
     × refuses {"phone-number":"+1 202 555 01"} with otp_destination_invalid, sending nothing
AssertionError: expected '{"type":"about:blank","title":"Unproc…' not to contain '202'
      Tests  4 failed | 7 passed | 32 skipped (43)
```

**GREEN** (`ace1c8e2`): the number is looked for in the problem without its `requestId`. The other short-literal `not.toContain` checks in the tests compare fixed values (`mx1` in a serialized check result, `GBR` in a constant list), not random ones.

```text
      Tests  43 passed (43)
```

Both fixes were checked on CI through the branch `ci/phase5-chance-matches` and `workflow_dispatch` before Workflow 6A started.
