# Phase 5, Workflow 5A Stage 3: `api-crypto` (TDD evidence)

Owner: `api-crypto`.

**Paths:**
- `apps/api/src/routes/flow/crypto-wallet.ts`
- `apps/api/src/services/crypto-challenges/`
- `apps/api/src/services/{guidance,attributes,submit,sub-resources}/crypto-wallet.ts`
- `apps/api/src/providers/evm-rpc/`
- `apps/api/src/jobs/types/crypto-wallet.ts`
- `packages/db/src/repositories/crypto-challenges.ts`
- tests beside them, plus `apps/api/src/jobs/crypto-wallet-contract.test.ts`

**Contracts:** C57.2 to C57.5:
- the challenge route and service: the server-built messages, single use, expiry, supersede and the cap;
- the submit guard;
- the crypto job over the `checks-contact-crypto` evaluators;
- the `evmRpc` providers (`json-rpc` through the outbound client, and `sandbox`);
- the guidance, attribute and cancel hooks.

Every command ran after `source scripts/env.sh`, from the repository root unless a `cd` is shown. Output is abbreviated with `…`. The other Stage 3 agents (`api-otp`, `api-database`) were editing the same tree at the same time, so the package-wide runs below name the failures that were theirs.

## 1. Repository writes (`packages/db`)

**Stub:** `745f530 chore(db): stub the crypto challenge writes …`.
- Added `canonicalCryptoAddress`, `createCryptoChallenge`, `countCryptoChallenges`, `supersedeOpenCryptoChallenges`, `consumeCryptoChallenge` and `markCryptoChallengeProcessed`.
- Each stub throws `not implemented (n arguments)`, through one helper that uses every argument, so the stub commit lints.
- `tsc --noEmit`, `eslint` and `prettier --check` were clean.

**RED:** `9221f05 test(db): …`. The test file is `repositories/crypto-challenges.test.ts`, on PGlite. It covers:
- the canonical form: EVM and bech32 lower-cased, base58 exact;
- create seals the claimed address and the message, and indexes the canonical address; no plaintext in the row;
- one `initiated` per verification;
- the count;
- supersede, or expire past the expiry;
- consume once (another verification, an expired, superseded, redacted or unknown challenge, or another environment match nothing);
- `processed` with the scheme;
- the rebuild indexes the canonical form.

```
$ cd packages/db && pnpm exec vitest run src/repositories/crypto-challenges.test.ts --coverage.enabled=false
 FAIL  src/repositories/crypto-challenges.test.ts > createCryptoChallenge (C57.2) > writes an initiated challenge, seals …
Error: not implemented (3 arguments)
 …
 Test Files  1 failed (1)
      Tests  21 failed (21)
```

**GREEN:** `bed9d9f feat(db): …`.
- The writes are conditional updates.
- `supersedeOpenCryptoChallenges` sets `expired` when `expires_at <= now`.
- `consumeCryptoChallenge` requires `status = 'initiated'`, the verification, `redacted_at is null` and `expires_at > now`.
- `markCryptoChallengeProcessed` keeps the submit's scheme when the job names none.
- The rebuild selects `chain_id` and indexes `canonicalCryptoAddress(chain, opened address)`.

```
$ cd packages/db && pnpm exec vitest run src/repositories/crypto-challenges.test.ts src/repositories/phase5-repositories.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  30 passed (30)
```

## 2. The EVM RPC providers (`providers/evm-rpc/`)

**Stub:** `b9f805a chore(api): stub the EVM RPC providers …`.
- `erc1271.ts`:
  - `ERC1271_MAGIC_VALUE`, `ERC1271_CALL_GAS`;
  - encode and decode `isValidSignature`;
  - `isErc1271MagicResult`, `holdsContractCode`.
- `json-rpc.ts`: `createJsonRpcEvmProvider`, with the caps and timeout constants.
- `sandbox.ts`:
  - `SANDBOX_CONTRACT_WALLET`, `SANDBOX_CONTRACT_WALLET_OWNER_LABEL`;
  - `SANDBOX_CONTRACT_WALLET_OWNER` = `0x0e956ba07dc897863a2413a7130e9183a0a991b1`, the address of `sha256("openverify/test-wallet/sandbox/contract-wallet-owner")`, computed once with `@noble/curves` from `packages/checks` (a throwaway script, deleted);
  - `createSandboxEvmRpcProvider`.

**RED:** `74aedd4 test(api): …`. Four test files, plus `services/crypto-challenges/testing.ts`.

`testing.ts` holds the labelled test wallets. `apps/api` has no curve library, and only Stage 1b adds dependencies, so it carries a small textbook secp256k1 ECDSA over `bigint`, for tests only:
- deterministic nonces, low s, `v` 27 or 28;
- the key is the SHA-256 of `openverify/test-wallet/<label>`, as the checks package's test wallets derive it.

Before it was used, a throwaway probe (deleted) checked it against the checks package's independent recovery:
- 20 signatures recovered with `recoverEvmSigner`;
- the owner label gave the address `@noble/curves` gave.

The tests:
- `erc1271.test.ts`: the call data, word by word.
- `json-rpc.test.ts`:
  - through a recording outbound client: the JSON-RPC 2.0 bodies, the URL per chain, the client options (name `evm-rpc`, `application/json`, 64 KiB for code and 4 KiB for calls, 10 s, private networks and `http:` only with the flag);
  - the failures: `chain_not_configured`, `invalid_request`, 429 and 5xx as retryable `rpc_unavailable`, 3xx and 4xx as `rpc_refused`, a JSON-RPC error (a revert) as `rpc_error`, eight malformed answers as `rpc_malformed`, and each outbound failure code;
  - no URL, key or address in an error;
  - through the real outbound client to a loopback server: reached only with the flag and through the vetted lookup; a 302 comes back as a refusal and is never followed; without the flag, `blocked` and nothing connects.
- `sandbox.test.ts` and `index.test.ts`.

```
$ cd apps/api && pnpm exec vitest run src/providers/evm-rpc --coverage.enabled=false
     37  FAIL  src/providers/evm-rpc/json-rpc.test.ts
     17  FAIL  src/providers/evm-rpc/erc1271.test.ts
      6  FAIL  src/providers/evm-rpc/sandbox.test.ts
      3  FAIL  src/providers/evm-rpc/index.test.ts
     19 Error: not implemented (2 arguments)
 …
      Tests  63 failed | 1 passed (64)
```

Notes on the RED run:
- The one passing test ("binds json-rpc without an outbound client, every call then refused") pins what Stage 1b's stub already did.
- A first RED draft built the sandbox provider at module level, so its file failed at collection. It was moved into each test before the commit, so each test fails on its own.

**GREEN:** `e0089812 feat(api): …`.
- One outbound client per answer cap, made on first use.
- Answers are checked against the request's id; results must be `0x` hex.
- The sandbox recovers the owner with the checks package's `recoverEvmSigner`, and rejects (never throws) off EVM chains.
- One RED case was corrected during GREEN, as the commit says: a 66-byte length over a 65-byte signature padded to 96 bytes is itself a valid encoding of a 66-byte signature. The case now names a length (200) past the data.

```
$ cd apps/api && pnpm exec vitest run src/providers --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  190 passed (190)
```

## 3. The challenge route and service, the guidance and the cancel hook

**Stub:** `632c98e chore(api): stub the wallet challenge service …`. It adds `rules.ts`, `create.ts` and `index.ts`.

**RED:** `20f7d3a test(api): …`. Three test files.

`rules.test.ts`:
- the offered chains within `allowed-chains`;
- `require-evm-checksum` only from the enabled validity check;
- the expected address field;
- the base62 nonce drawn from the CSPRNG;
- the four problems with their golden details.

`routes/flow/crypto-wallet.test.ts`:
- **messages:**
  - EIP-4361 exactly, line by line;
  - a lower-case address written in its EIP-55 form, with `Chain ID: 8453`;
  - Sign-In with Solana with `Chain ID: mainnet`;
  - the CAIP-122 wording for Bitcoin and TRON;
  - the domain from `OPENVERIFY_FLOW_PUBLIC_URL` even with a hostile `Host` and `Origin`.
- **storage:** sealed, the canonical index, supersede and expiry.
- **refusals:** the golden 422s, the checksum rule, the expected address canonicalised (EVM in any case, bech32 in upper case), an expected address of another chain, wrong type 422, not `initiated` 409.
- **the cap:** cancel with attempts left; fail the inquiry with none.
- **guidance:** the offered chains and signing methods.

`services/sub-resources/crypto-wallet.test.ts`:
- the hook supersedes the open challenge;
- it runs through `POST /inquiries/:id/expire`.

```
$ cd apps/api && pnpm exec vitest run src/routes/flow/crypto-wallet.test.ts src/services/sub-resources/crypto-wallet.test.ts src/services/crypto-challenges/rules.test.ts --coverage.enabled=false
Error: expected HTTP 201, got 501: {"…","status":501,"detail":"Wallet challenges are not built yet.",…}
AssertionError: expected 501 to be 422 // Object.is equality
AssertionError: expected 'initiated' to be 'superseded' // Object.is equality
AssertionError: expected { status: 'initiated', …(4) } to match object { Object (guidance) }
Error: not implemented (1 arguments)
 …
      Tests  41 failed | 1 passed (42)
```

The one passing test ("refuses another verification type (422) and a verification no longer initiated (409)") pins what Stage 1b's preconditions already answered.

**GREEN:** `bacbb59 feat(api): …`.
- `createFlowCryptoChallenge`:
  - `requireFlowVerification`;
  - the pinned step and configuration;
  - the chain, address and expected-address rules before any write;
  - then one transaction: `requireFlowVerificationUnderLock`, the count, then either the cap cancel or supersede and create.
- The cap cancel mirrors Phase 4's capture cap: the cancel hook, `verification.canceled`, and `inquiry.failed` when the step has no attempt left.
- The guidance hook, the cancel hook, and the route (201).

```
$ cd apps/api && pnpm exec vitest run src/routes/flow/crypto-wallet.test.ts src/services/sub-resources/crypto-wallet.test.ts src/services/crypto-challenges/rules.test.ts --coverage.enabled=false
 Test Files  3 passed (3)
      Tests  42 passed (42)
$ cd apps/api && pnpm exec vitest run src/routes/flow/verification-mutations.contract.test.ts src/routes/flow/phase5-guidance.test.ts src/routes/flow/phase5-submit.test.ts src/services/cancel-confirmed.test.ts src/jobs/inquiry-expiry.test.ts src/services/sub-resources src/services/guidance src/openapi.test.ts --coverage.enabled=false
 Test Files  11 passed (11)
      Tests  80 passed (80)
```

The OpenAPI snapshot did not change: the route's schemas are Stage 1b's, frozen.

## 4. The submit guard and the attributes

**RED:** `bfe5e2f test(api): …`. No stub was needed: both hooks existed as Stage 1b stubs.

`services/submit/crypto-wallet.test.ts`:
- consume once, with the signature, the signed message and the scheme sealed;
- a pasted signature without a scheme;
- one golden 409 `crypto_challenge_invalid` for each of: a missing member, an empty body, an unknown, foreign, superseded or expired challenge;
- a repeat only for the challenge that submitted the verification.

`services/attributes/crypto-wallet.test.ts`:
- the hook: null before any challenge; the newest challenge before a submit; the consumed one beside a newer one; the scheme named by the submit; the mask;
- every exit with real rows: `GET /verifications/:id` (a key, a user with `pii:view`, a user without), `?include=verifications`, the `verification.*` payload through the Events API, a stored API log body, and the dashboard inquiry document (reviewer and viewer);
- `null` after `redactInquiryRecords`.

```
$ cd apps/api && pnpm exec vitest run src/services/attributes/crypto-wallet.test.ts src/services/submit/crypto-wallet.test.ts --coverage.enabled=false
      7 AssertionError: expected {} to deeply equal { …(4) }
      3 AssertionError: expected 202 to be 409 // Object.is equality
 …
      Tests  15 failed | 1 passed (16)
```

The one passing test (the mask) pins what the stub's `mask.attributes` already did.

**GREEN:** `55b4e35 feat(api): …`.

```
$ cd apps/api && pnpm exec vitest run src/services/attributes/crypto-wallet.test.ts src/services/submit/crypto-wallet.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  16 passed (16)
$ cd apps/api && pnpm exec vitest run src/routes/flow/phase5-submit.test.ts src/phase5-masking.test.ts src/routes/dashboard/phase5-masking.test.ts src/services/attributes src/services/submit src/routes/flow/crypto-wallet.test.ts src/routes/flow/verification-mutations.contract.test.ts src/services/redaction.test.ts --coverage.enabled=false
 Test Files  13 passed (13)
      Tests  196 passed (196)
```

## 5. The job

**RED:** `54c7556 test(api): …`.

`jobs/types/crypto-wallet.test.ts`, on PGlite:
- a genuine EVM signature passes with no RPC call;
- the challenge is `processed` with its scheme, and the `verification.passed` payload carries the attributes;
- another key's signature: review without an RPC, `signature_address_mismatch` once `eth_getCode` finds no code;
- the contract wallet: one `eth_getCode` and one `eth_call` with gas 500,000; review unless `allow-contract-wallets`; pass with it, with the provider in provenance;
- a signature the contract does not accept: `signature_invalid`;
- `chain_not_configured`: `provider_not_configured`;
- a permanent RPC failure: `execution_error`;
- a transient one: thrown, then `execution_error` on the last attempt;
- Solana: passes;
- other bytes signed: never passes;
- the expected address at judgement: `expected_address_mismatch`;
- no challenge: `input_missing` and review;
- the results parse, and no address or message is logged;
- `failVerificationAfterError` processes the challenge.

`jobs/crypto-wallet-contract.test.ts`: the evaluators' reasons equal `CRYPTO_WALLET_CHECK_REASONS`, and cover the registry.

```
$ cd apps/api && pnpm exec vitest run src/jobs/types/crypto-wallet.test.ts src/jobs/crypto-wallet-contract.test.ts --coverage.enabled=false
     13 PermanentJobError: The job cannot succeed (unsupported_verification)
      1 AssertionError: expected PermanentJobError: … to be an instance of ProviderError
      1 AssertionError: expected 'submitted' to be 'processed' // Object.is equality
 …
      Tests  15 failed | 2 passed (17)
```

The two passing tests are the reasons contract: the two lists were already equal (Stage 2 checked them with a one-off script); the test now pins it.

**GREEN:** `ee44f50 feat(api): …`. The job:
- reads the submitted challenge and its evidence;
- asks `evmRpc` only when `cryptoWalletContractCheck` returns a check and the address or statement check is enabled, through `attemptProvider`; `chain_not_configured` is a sentinel for `not_configured`;
- evaluates;
- in the decision transaction, marks the challenge `processed` with the established scheme before the verification event;
- on a processing failure, marks it `processed` too;
- is `runnable: true`.

```
$ cd apps/api && pnpm exec vitest run src/jobs/types/crypto-wallet.test.ts src/jobs/crypto-wallet-contract.test.ts --coverage.enabled=false
 Test Files  2 passed (2)
      Tests  17 passed (17)
```

## 6. Tests written after the code (each passed on its first run)

- **`7fd856a`, the race tests** (`services/crypto-challenges/crypto-challenge-races.integration.test.ts`, Testcontainers Postgres 17, 11 tests):
  - create, its cap cancel and submit each wait for a redaction and write nothing;
  - a create waits for a submit; a submit waits for a superseding create, and for the inquiry's expiry;
  - two creates leave one open challenge;
  - the job's decision and its processing-failure update wait for a redaction, and a redaction waits for a decision;
  - the index rebuild leaves a row redacted meanwhile unindexed.

  Each was shown to fail for the intended reason by a local mutation, never committed. With the create taking only the verification's lock, not the inquiry's:

  ```
  $ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/crypto-challenges/crypto-challenge-races.integration.test.ts -t "a create waits for the redaction"
       × a create waits for the redaction, then refuses (410) and writes no challenge 1593ms
  AssertionError: expected { …(3) } to be an instance of RedactedError
  ```

  The file was restored from a scratch copy; `git diff` shows no change. The full run:

  ```
  $ cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts src/services/crypto-challenges/crypto-challenge-races.integration.test.ts
   Test Files  1 passed (1)
        Tests  11 passed (11)
  ```

- **`a58c896`, end to end through the flow API and the job:** created with its guidance, challenged, signed, submitted, judged `passed`, served with its attributes, and polled without them.
- **`be05f1d`:** the index's canonical form (`packages/db`) agrees with the route's comparison (`packages/checks`) over 12 addresses of every family, pairwise.
- **`8444826`:** the guidance hook on its own, and the C57.6 Safe-shaped owner signature without an RPC (`provider_not_configured`, review).

## 7. Final gates

All gates ran in the foreground, except the full e2e. Its 11.3 minutes passed the 10-minute command limit, so it finished in the background, and its result was waited for before this report. The other Stage 3 agents were committing at the same time, so some runs were repeated once their work landed.

- **Typecheck, lint and format.**
  - `pnpm typecheck`: 12 of 12 tasks, every time.
  - `pnpm lint`: the first run failed only on `apps/api/src/jobs/types/email-address.ts` (`api-otp`, then in progress); the re-run was clean, 12 of 12.
  - `pnpm format:check`: clean.
- **`pnpm --filter @openverify/db test`:** 60 files and 768 tests passed; 98.71% statements, 92.12% branches, 99.37% functions, 98.64% lines.
- **`pnpm --filter @openverify/api test`:** the last run had 3,319 passed and 2 failed, both in `src/services/attributes/database-exits.test.ts` (`api-database`). That test checks that a masked body does not contain a two-letter synthetic value (`CA`); a random ULID in the body (`ver_01M5MYNQF59Z6NRCAFSWWNYM7Z`) happened to contain it, so the failure depends on the generated ids. It is not in this area's paths. The same suite without that file, with coverage: 195 files and 3,309 tests passed; 97.44% statements, 90.38% branches, 98.9% functions, 97.45% lines. This area's files:

  | File | Statements | Branches |
  |---|---|---|
  | `jobs/types/crypto-wallet.ts` | 100% | 95.34% |
  | `providers/evm-rpc/sandbox.ts` | 98.59% | 86.27% |
  | `erc1271.ts` | 94.44% | 83.33% |
  | `json-rpc.ts` | 98.3% | 95.34% |
  | `services/crypto-challenges/create.ts` | 94.64% | 71.87% |
  | `rules.ts` | 100% | 93.75% |
  | `services/submit/crypto-wallet.ts` | 93.33% | 82.35% |

- **`pnpm test:integration`:** api 20 files and 102 tests, db 10 files and 52 tests, all passed. This area's race file is 11 of them.
- **`flock /tmp/openverify-e2e.lock pnpm e2e`:** the mocked flow suite passed 38 of 38. The full stack passed 48 and failed 2, in 11.3 minutes:
  - `reload-between-uploads.spec.ts`
  - `selfie-repeat.spec.ts`

  Both stopped on the hosted flow's selfie retry screen ("We could not use your last photos", with the pose hints: look straight at the camera, or turn further to the left). The auto-shutter of the fake camera's head-turn clip took off-pose stills. The load average was 10 to 13 on 12 cores, from the other agents' test runs.

  To diagnose (never to make the gate green), the two specs were run once more alone: `reload-between-uploads` passed, and `selfie-repeat` failed again the same way. Neither spec has a crypto step: both use the default government ID and selfie template. They are Phase 4 specs in `e2e/` (`integration-5a`'s paths), so they were not changed here. Their timing under load is a follow-up in the report.
