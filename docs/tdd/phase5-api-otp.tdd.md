# Phase 5, Workflow 5A Stage 3: `api-otp` (TDD evidence)

Owner: `api-otp`. Contracts: C55 in full (send, confirm, the server's own submit, supersede, the HMAC under the HKDF key, attempts, sends and cooldowns on the application clock, the fail-closed limits, the SMS budget and its trip record, the Twilio and sandbox senders, the sandbox SMS search, the channel guard at publish), C56 (the phone and email jobs, `MxResolver` with its cache and the reserved-domain rule, the disposable list loader), and the phone and email guidance, attributes, submit guards and cancel hooks (C52.2, C52.6, C52.8, C54.1).

Paths: `apps/api/src/routes/flow/otp.ts` (the one OTP route file of the Stage 1b deviation 1), `routes/server/sandbox-sms.ts`, `services/otp/`, `services/{guidance,attributes,submit,publish,sub-resources}/{phone-number,email-address}.ts`, `providers/sms/`, `jobs/types/{phone-number,email-address}.ts`, `apps/api/src/contact/`, `packages/db/src/repositories/{otp-challenges,otp-verification-states}.ts`, and their tests.

Every command ran after `source scripts/env.sh`, from the repository root unless a `cd` is shown. Output is abbreviated with `…`. While this stage ran, the `api-crypto` and `api-database` agents committed to the same tree; where their in-progress files broke a package-wide command, the output below is filtered to this area's files, and the reason is said.

## Working notes

- The shared scratchpad helper `commit.sh` was rewritten by another agent during the run (it stopped taking `--`). This area used its own copy, `scratchpad/otp/commit.sh`, with the same rule: Prettier on the paths, then `flock /tmp/openverify-git.lock`, a clean index check, a path-scoped `git add` and `git commit`, and `git reset` of the paths if the commit is refused.
- At 12:13 the crypto agent's RED `crypto-challenges.test.ts` broke `tsc --noEmit` in `packages/db`; this area's typechecks were filtered to its own files until the final gates.

## 1. Database writes: stub, RED, GREEN

- `b3ae416 chore(db)`: the write signatures as stubs (`insertOtpChallenge`, `reserveOtpChallengeAttempt`, `confirmOtpChallenge`, `closeOtpChallenge`, `closeOpenOtpChallenges`, `recordOtpDelivery`, `markOtpChallengeErrored`; `reserveOtpSend`, `releaseOtpSend`, `recordOtpWrongEntry`, `recordOtpLimited`, `lockOtpSmsBudget`).
- `097de07 test(db)` RED:

```
$ cd packages/db && pnpm exec vitest run src/repositories/otp-challenges.test.ts src/repositories/otp-verification-states.test.ts --coverage.enabled=false
 × stores the code as the open challenge, its destination sealed to the row
 …
Error: not implemented (3 arguments)
 Test Files  2 failed (2)
      Tests  19 failed (19)
```

- `10dce78 feat(db)` GREEN. The first GREEN run failed two cases: PGlite reads a `bytea` as a `Uint8Array` and `pg` as a `Buffer`, so `toEqual(Buffer)` failed on equal bytes. The repository now hands back plain bytes, and the RED test compares bytes (noted in the commit).

```
$ cd packages/db && pnpm exec vitest run src/repositories/otp-challenges.test.ts src/repositories/otp-verification-states.test.ts src/repositories/phase5-repositories.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  28 passed (28)
```

## 2. The SMS senders: stub, RED, GREEN

- `fc2906e chore(api)`: `providers/sms/sandbox.ts` (`sandboxSmsSinkKey`, `createSandboxSmsSender`, `readSandboxSmsSink`) and `providers/sms/twilio.ts` (`createTwilioSmsSender`, `TWILIO_API_BASE_URL`) as stubs.
- `0ab421e test(api)` RED: the sandbox sink (one environment and destination index, newest first, 100 entries for 900 s, no number kept, no claimed send without the sink), and the Twilio sender against an in-process stub of the outbound client (one form-encoded POST under HTTP Basic, the message id kept only when well-formed, 3xx, 4xx, 429, 5xx and every outbound failure mapped to an `SmsSendError` code and `retryable`, nothing personal in a failure), plus the real outbound client with an injected resolver returning a private address, which the vetted lookup refuses.

```
$ cd apps/api && pnpm exec vitest run src/providers/sms --coverage.enabled=false
 Test Files  3 failed (3)
      Tests  25 failed (25)
     13 Error: not implemented (1 arguments)
      1 AssertionError: expected ProviderError: The SMS sender is not buil… to be an instance of SmsSendError
      1 AssertionError: expected [Function] to throw an error
```

- `f10a3147 feat(api)` GREEN:

```
$ cd apps/api && pnpm exec vitest run src/providers/sms src/providers/index.test.ts src/sandbox-sms-sink.test.ts src/container.test.ts --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  69 passed (69)
```

## 3. The OTP core: stub, RED, GREEN

- `fe381bf2` and `c2ad1bad chore(api)`: `services/otp/{codes,messages,limits,state}.ts` as stubs (the second gives the guess budget the application clock).
- `f4a0a4e5 test(api)` RED: codes (CSPRNG bounds, padding, 6-10 digits, `RangeError` otherwise), the HMAC against an oracle built from the documented layout and its binding, the SMS and email texts in English and Spanish, the limits (order, keys, sizes, reasons, the country share only for several countries, fail closed, the guess marker), the code state (cooldowns 30/60/120/240 s, the no-dead-end rule, `guidance.otp`), and the limits against a real Valkey with a short rule.

```
$ cd apps/api && pnpm exec vitest run src/services/otp --coverage.enabled=false
 Test Files  4 failed (4)
      Tests  62 failed (62)
     15 Error: not implemented (1 arguments)
     14 Error: not implemented (3 arguments)
      … (each a stub)
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/otp/limits.integration.test.ts
 × otp-ip-hour refuses past its size
 …
 Test Files  1 failed (1)
      Tests  9 failed (9)
```

- `76ed261e feat(api)` GREEN:

```
$ cd apps/api && pnpm exec vitest run src/services/otp --coverage.enabled=false
 Test Files  4 passed (4)
      Tests  62 passed (62)
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/otp/limits.integration.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  6.93s
```

The Valkey test shows each send limit refusing past its size, the country share and the budget, recovery after a two-second window on Valkey's own clock, the guess marker until its rule would allow one again, and fail closed against `redis://127.0.0.1:1`.

## 4. Send, confirm, the sink and the guidance: stub, RED, GREEN

- `05fa804e chore(api)`: `sendOtp`, `confirmOtp` and `searchSandboxSmsSink` as stubs, called from `routes/flow/otp.ts` and `routes/server/sandbox-sms.ts` after the C52.1 preconditions, schemas unchanged.
- `86942ad9 test(api)` RED: `routes/flow/otp.test.ts` (send: the six-digit SMS, the configured flow host with a forged `Host` and `Origin`, Spanish, email as `{ address }`, refused numbers and the nodemailer advisory payloads, the other channel's member, cooldown and supersede, a 502 that counts no send, the sixth send submitting, each limit's 429 and its record, the per-IP refusal unrecorded, 503 while the store is down, one budget trip entry, `otp_already_confirmed`; confirm: the right code, a wrong one counted before the compare, exhaustion at five, expiry at ten minutes, `otp_not_sent`, a key gone from the keyring, the tenth wrong entry submitting, no code and no send left submitting, the guess budget, 503 without the guess store; the send-time channel guard; the flow view) and `routes/server/sandbox-sms.test.ts`; helpers in `services/otp/testing.ts`.

```
$ cd apps/api && pnpm exec vitest run src/routes/flow/otp.test.ts src/routes/server/sandbox-sms.test.ts --coverage.enabled=false
 Test Files  2 failed (2)
      Tests  42 failed (42)
     10 Error: no code was sent
      4 AssertionError: expected 500 to be 422
      4 AssertionError: expected 500 to be 200
      … (the stubs answer 500; the guidance stub answers null)
```

- `1dd90118 feat(api)` GREEN. Two RED tests were corrected, noted in the commit: the guess-budget test tripped the shared test number for every later test (it now uses a number of its own), and a seeded code lacked the blind index every stored code has.

```
$ cd apps/api && pnpm exec vitest run src/routes/flow/otp.test.ts src/routes/server/sandbox-sms.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  42 passed (42)
$ cd apps/api && pnpm exec vitest run src/routes/flow src/sandbox-sms-sink.test.ts src/openapi.test.ts src/services/otp src/providers/sms --coverage.enabled=false
 Test Files  26 passed (26)
      Tests  415 passed (415)
```

## 5. The hooks: stub, RED, GREEN, and the tests the channel guard changes

- `c16223be chore(api)`: `services/otp/evidence.ts` (`loadOtpEvidence`) as a stub.
- `27804771 test(api)` RED (`services/otp/hooks.test.ts`): the attributes across `GET /verifications/:id`, `?include=verifications`, the `verification.submitted` payload as the Events API serves it, and the stored API log, masked without `pii:view` and the destination gone after redaction; the submit guard; the cancel hook; the channel guard at publish.

```
$ cd apps/api && pnpm exec vitest run src/services/otp/hooks.test.ts --coverage.enabled=false
 Test Files  1 failed (1)
      Tests  11 failed | 4 passed (15)
      3 AssertionError: expected {} to match object { 'phone-number': '+12025550100' }
      2 AssertionError: expected 201 to be 422
      1 AssertionError: expected 202 to be 409
      …
```

The four that passed hold under the Stage 1b stubs already: a confirmed verification submits, the stub guard lets an initiated one submit (the no-dead-end case), the stub cancel hook stages nothing, and publishing works where both channels are bound.

- `c85641f2 test(api)`: seven Stage 1a and 1b tests publish `phase5TemplateAttributes()` (with a phone step) in a harness that binds no SMS sender. C55.10 now refuses that, so each binds the sandbox sender as `.env.example` does for sandbox environments (`sandboxSmsProviders()`); they pass before and after the guard. Running the full suite with the guard, before this commit, failed them:

```
$ cd apps/api && pnpm exec vitest run --coverage.enabled=false
 FAIL  src/routes/flow/phase5-create-upload.test.ts … (and six more)
Error: expected HTTP 201, got 422: {…"code":"otp_channel_not_configured"…}
```

- `ade91e96 feat(api)` GREEN:

```
$ cd apps/api && pnpm exec vitest run src/services/otp/hooks.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  15 passed (15)
$ cd apps/api && pnpm exec vitest run --coverage.enabled=false
 Test Files  3 failed | 185 passed (188)
```

The three failing files then were the `api-database` agent's own work in progress (`jobs/silent-aamva.test.ts` RED, a `zz-silent-probe.test.ts` probe, and one `inputs.test.ts` case that published the Phase 5 template without a sender, which that agent later rewrote in its own file).

## 6. The jobs, MX and the disposable list: stub, RED, GREEN

- `e10df9c3` and `e8ad7016 chore(api)`: `contact/disposable-list.ts` (with `DISPOSABLE_LIST_PIN`, and the pin as a parameter), `contact/mx-resolver.ts` and the email job factory as stubs.
- `0562d532 test(api)` RED: the loader (pinned as `data/manifest.json` pins it, read from `data/`, a synthetic file under its own digest, a changed or missing file giving no list, loaded once), the MX resolver (records without host names, the implicit MX, NXDOMAIN, a retryable failure thrown, the 1 h and 5 min cache by SHA-256), both jobs through `processVerification` on PGlite, the C51.2 contract, and creation through the flow.

```
$ cd apps/api && pnpm exec vitest run src/contact src/jobs/types/phone-number.test.ts src/jobs/types/email-address.test.ts src/routes/flow/otp.test.ts --coverage.enabled=false
 Test Files  5 failed | 1 passed (6)
      Tests  28 failed | 43 passed (71)
     13 PermanentJobError: The job cannot succeed (unsupported_verification)
      6 Error: not implemented (1 arguments)
      1 AssertionError: expected 422 to be 201
      …
```

`contact-contract.test.ts` passed at once: it pins that `CONTACT_EVALUATOR_REASONS` (checks) equals `CONTACT_CHECK_REASONS` (contracts), which `checks-contact-crypto` built, and that every result over the grid of OTP states and email outcomes carries listed reasons only.

- `34661436 feat(api)` GREEN:

```
$ cd apps/api && pnpm exec vitest run src/contact src/jobs/types/phone-number.test.ts src/jobs/types/email-address.test.ts src/routes/flow/otp.test.ts --coverage.enabled=false
 Test Files  6 passed (6)
      Tests  71 passed (71)
$ cd apps/api && pnpm exec vitest run --coverage.enabled=false
 Test Files  195 passed (195)
      Tests  3314 passed (3314)
```

## 7. Races on Postgres, and the tests written after the code

- `05461167 test(api)` (`services/otp/otp-races.integration.test.ts`, Testcontainers `pgvector/pgvector:pg17`): a send or a confirm waits for a redaction and refuses (410); a delivery recorded after a redaction committed keeps no provider id; a confirm waits for a cancel and refuses (409); two right codes at once confirm once; six wrong ones count five and exhaust the code; three sends store one code and send once; a limit record waits for a redaction; concurrent budget trips write one entry. They were written after the writers, so they passed on their first run:

```
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/otp/otp-races.integration.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  24.49s
```

To show they fail when the lock order breaks, `send.ts` was changed for one run to lock only the verification (the inquiry not first), then restored from a saved copy (`git diff` empty afterwards):

```
$ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/otp/otp-races.integration.test.ts -t "a send waits for the redaction"
 × a send waits for the redaction, then refuses (410) and stores no code
AssertionError: expected { …(3) } to be an instance of RedactedError
      Tests  1 failed | 8 skipped (9)
```

- `7b12f6ef` and `6da295f9 test(api)`, written after the code and passing on their first run: the dashboard inquiry document as the fourth attribute exit, a real (non-sandbox) sender getting the message alone with its id kept, a mail failure (502, no send counted), a flow without the type's step (422), and a phone or email verification failed by `failVerificationAfterError`.

Coverage of this area's files (`--coverage.include` on them, 182 tests): statements 95.19%, branches 89.97%, functions 97.22%, lines 95.26%.

## 8. Final gates

All run in the foreground on the tree after `6da295f9` (with the other Stage 3 agents' commits up to then):

```
$ pnpm typecheck
 Tasks:    12 successful, 12 total
Cached:    11 cached, 12 total          # @openverify/api ran; the others' inputs were unchanged
real	1m5.682s
$ pnpm lint
 Tasks:    12 successful, 12 total
Cached:    11 cached, 12 total
real	2m5.946s
$ pnpm format:check
All matched files use Prettier code style!
$ pnpm --filter @openverify/api test
 Test Files  196 passed (196)
      Tests  3321 passed (3321)
All files          |   97.44 |    90.39 |    98.9 |   97.45 |
real	6m23.726s
$ pnpm --filter @openverify/db test
 Test Files  60 passed (60)
      Tests  768 passed (768)
All files          |   98.71 |    92.12 |   99.37 |   98.64 |
real	1m16.701s
$ pnpm test:integration
@openverify/api:test:integration:  Test Files  20 passed (20)
@openverify/api:test:integration:       Tests  102 passed (102)
@openverify/db:test:integration:  Test Files  10 passed (10)
@openverify/db:test:integration:       Tests  52 passed (52)
real	1m37.206s
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   38 passed (12.0s)
@openverify/e2e:e2e:   50 passed (7.2m)
real	7m23.354s
```
