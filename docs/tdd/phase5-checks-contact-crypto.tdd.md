# Phase 5, Workflow 5A Stage 2: `checks-contact-crypto` (TDD evidence)

Owner: `checks-contact-crypto`. Paths: `packages/checks/src/contact/`, `packages/checks/src/crypto/`, the contact and crypto wallet reasons files in `packages/contracts` (fraud amendments only), and `packages/core/src/check-config/{contact,crypto-wallet}.ts`. Contracts: C55.8 and C55.9 (the destination rules and the organization name, as pure functions the API calls), C56 (the contact evaluators), C57 (the crypto wallet libraries and evaluators, with every published vector).

Every command ran after `source scripts/env.sh`, from the repository root unless a `cd` is shown. Output is abbreviated with `…`.

## Resumption (2026-10-23)

An earlier run of this area stopped at about 01:10 on 2026-10-23 with no commit. It left untracked drafts under `packages/checks/src/contact/` (every file a `throw new Error('not implemented')` stub with its documentation) and a modified `contact/index.ts`, and nothing under `crypto/`.

- `git status`, `git diff packages/checks/src/contact/index.ts` and `git log 232bfdd..HEAD -- packages/checks/src/contact packages/checks/src/crypto` showed the drafts and no commit of this area.
- Each draft was read against C55.8, C55.9 and C56 and kept, with these changes:
  - the stubs now call one `notImplemented(...args)` helper, so the stub commit lints (an unused parameter fails `@typescript-eslint/no-unused-vars` for every agent's `pnpm lint`);
  - a non-geographic number (`no_region`) answers `otp_destination_not_allowed`, not `otp_destination_invalid`: it is a valid number that no allowed country holds;
  - the phone mask shows the last four digits, as the contracts example `+1 ••• ••• 0100` does, not two;
  - the shared Phase 5 config helpers (`phase5-config.ts`) are new, because `phase1/evaluate.ts` keeps `enabledChecks` private to government ID and selfie and is not this area's file.
- `packages/checks/data/nicknames-authored.tsv` is the `checks-matching` agent's file and was left alone; so was `apps/flow/src/steps/otp/` (`flow-5a`).

## 1. Contact: stub

`7b3ad00 chore(checks): stub the contact checks …`: the drafts as stubs, `tsc --noEmit` and `eslint packages/checks/src/contact` clean, exported from `contact/index.ts` only (the package index already re-exports it).

## 2. Contact: RED

Tests: `phone-destination`, `email-destination` (the three 2026-10-19 nodemailer advisory payloads quoted from GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w and GHSA-85x2-q946-cp5h), `organization-name`, `disposable-domains`, `mail-domain`, `otp-comparison`, `email-address-disposable-detection`, `email-address-mx-detection`, `evaluate` (the reasons contract over every OTP state and email outcome, the runners, the decision on the registry default templates) and `phase5-config`; builders in `contact/testing.ts`.

```
$ (cd packages/checks && pnpm exec tsc --noEmit)            # clean
$ pnpm exec eslint packages/checks/src/contact             # clean
$ cd packages/checks && pnpm exec vitest run src/contact --coverage.enabled=false
 FAIL  src/contact/phone-destination.test.ts > validatePhoneDestination (C55.8) > accepts a valid number …
Error: not implemented (2 arguments)
 ❯ notImplemented src/contact/not-implemented.ts:3:9
 …
 Test Files  10 failed (10)
      Tests  172 failed (172)
```

Every failure is the stub's `not implemented` (94 thrown at the stub, the rest inside `toThrow` expectations that received it instead of `InvalidCheckConfigError`).

## 3. Contact: GREEN

- `phone-destination.ts`: a strict international-form pre-check (`+`, a digit, digits and `( ).-`, at most 32 characters and 15 digits), then `parsePhoneNumberFromString(text, { extract: false })` on the `/max` metadata, `isValid()`, the region read from the digits, the refused types and VoIP; the mask keeps the calling code and the last four digits of `formatInternational()`.
- `email-destination.ts`: a linear trim of ASCII whitespace, one `@`, an ASCII dot-string local part of at most 64 octets, a domain of ASCII letters, digits, hyphens and dots (or another script) before `domainToASCII` (which otherwise decodes `%2e` and reads `0x7f.1` as `127.0.0.1`), LDH labels after it, a non-numeric last label, then the 255 and 254 octet limits.
- `organization-name.ts`: NFKC, control and separator characters to spaces, format, surrogate, private-use and unassigned characters removed, URL and host-name words dropped, `@`, `#` and runs of four or more `\p{Nd}` digits removed, cut to 40 code points.
- The OTP comparison's order: confirmed with a destination, exhausted, limited, missing evidence, not confirmed. A limit refusal before any challenge stored the destination still answers `otp_delivery_unavailable`.
- `phase5-config.ts` mirrors the selfie config helper over `phase5ConfigDefaults` and `phase5ThresholdBasis`.
- `not-implemented.ts` deleted.

```
$ cd packages/checks && pnpm exec vitest run src/contact --coverage.enabled=false
 Test Files  10 passed (10)
      Tests  172 passed (172)
$ pnpm exec eslint packages/checks/src/contact             # clean (the first trim regex failed regexp/no-super-linear-move and became a loop)
$ (cd packages/checks && pnpm exec tsc --noEmit)            # clean
$ cd packages/checks && pnpm exec vitest run src/contact --coverage.include='src/contact/**'
All files          |   98.88 |    95.87 |     100 |   98.85 |
```

## 4. Crypto wallets: stub

The C57 library as stubs, each module documented with its rule: byte helpers (`bytes.ts`), EIP-55, address validity per chain (`addresses.ts`), the challenge builder and a strict sign-in parser (`messages.ts`), Solana off-chain envelopes, EIP-191, TRON `signMessageV2`, BIP-137, BIP-322 simple, Solana ed25519, one signature dispatch (`verify.ts`, with the `EvmContractCheck` the job asks `evmRpc`), the inputs, context, the four evaluators, reasons and runner. `tsc --noEmit` and `eslint packages/checks/src/crypto` clean.

## 5. Crypto wallets: RED

Published vectors, transcribed by a script from files fetched at pinned commits (private keys, witness scripts and other signer-only fields left out), each file naming its source, commit, SHA-256 where useful, and licence:

| File | Source | Licence |
|---|---|---|
| `vectors/segwit-addresses.ts` | BIP-350 valid (8) and invalid (15) segwit addresses, BIP-173 invalid v0 addresses (10), bitcoin/bips `24e96e870fff` | BSD-2-Clause |
| `vectors/bip322.ts` | `basic-test-vectors.json` and `generated-test-vectors.json` at bitcoin/bips `d77863fb9e9b`: 3 transaction hashes, 8 simple, 10 full, 3 proof-of-funds, 36 error vectors | CC0-1.0 |
| `vectors/ethereum.ts` | EIP-55's 8 addresses (ethereum/ERCs `8dd085d159cb`), EIP-4361's 3 example messages (`faa49e076526`) | CC0-1.0 |
| `vectors/bip137.ts` | Bitcoin Core `rpc_signmessagewithprivkey.py` at `fa5f29774872` (1 signature); bitcoinjs-message `test/fixtures.json` at `281289ef04ad` (5 signatures, 4 refusals, 5 magic hashes, 3 malformed encodings) | MIT |

Also asserted from published sources: TRON's zero account `T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb`, the XRP Ledger's genesis, ACCOUNT_ZERO and ACCOUNT_ONE addresses (xrpl.org), and RFC 8032 §7.1 test 1 (its public key, message and signature only).

`crypto/testing.ts` holds the deterministic wallets (keys are SHA-256 of a fixed label, never committed) and signers that build their digests on their own; the BIP-322 signer signs `to_sign` through `@scure/btc-signer`. The dev-only oracles cross-check them: `micro-eth-signer@0.20.1` (addresses, EIP-191 digests and signatures) and `bitcoin-address-validation@4.0.0` (every single-key address type on mainnet and testnet, and a typo of each). A throwaway probe (deleted, never committed) confirmed the signers against both oracles before this commit.

```
$ (cd packages/checks && pnpm exec tsc --noEmit)            # clean
$ pnpm exec eslint packages/checks/src/crypto              # clean
$ cd packages/checks && pnpm exec vitest run src/crypto --coverage.enabled=false
 FAIL  src/crypto/eip191.test.ts > EIP-191 (C57.1) > digests "Grüße, 世界 ✓" as the oracle does
Error: not implemented (1 arguments)
 …
 Test Files  16 failed (16)
      Tests  308 failed (308)
```

The first run had 10 passing: the builder's refusals expected only `toThrow(Error)`, which the stub's `not implemented` satisfies. They now expect the field in the message (`/nonce/`, `/origin/`, …) and fail on the stub.

Two facts about this RED, checked afterwards by re-running the RED commit's tests from `git archive 09d95c4` into the scratchpad (with the repository's `node_modules` linked):
- 14 files failed test by test with `not implemented`; `crypto-wallet-statement-comparison.test.ts` and `evaluate.test.ts` failed at collection, also with `not implemented` (their `it.each` tables call the stubbed `utf8`), so their 19 tests were not counted: 308 counted, 327 in all;
- gitleaks refused the first RED commit: its `generic-api-key` rule took a variable named `key` followed by a quoted header name in `bip137.test.ts` for a secret, a false positive. The variable was renamed to `wallet` and the commit retried; nothing was added to `.gitleaksignore`.

## 6. Crypto wallets: GREEN

- `bytes.ts`: hex that must be even and capped, base64 that must re-encode to itself, CompactSize, double SHA-256 and HASH160.
- `eip55.ts` over Keccak-256; `addresses.ts`: one decoder per family, every input capped at 128 characters before decoding:
  - for segwit, the program and witness version are checked before the bech32-or-bech32m variant, so BIP-173's v1+ vectors stay `address_invalid` and BIP-350's wrong-variant ones are `address_checksum_invalid`;
  - TRON addresses must start with `T` and XRP Ledger ones with `r` (their version bytes always encode so); without that, a Bitcoin address read in the Ripple alphabet failed only its checksum.
- `eip191.ts`, `tron.ts`: noble `Signature.fromBytes(…,'compact').addRecoveryBit(v).recoverPublicKey(digest)`, with high-s reported.
- `bip137.ts`: the header range decides the key serialisation; `strict` requires the address's own range, `loose` derives the claimed type from the key and flags it; a P2SH address the key's P2SH-P2WPKH does not match is `inconclusive`.
- `bip322.ts`: `to_spend` and `to_sign` built with `@scure/btc-signer`'s `Transaction` (outputs before the final-scriptSig input), `preimageWitnessV0` and `preimageWitnessV1` for the sighashes. P2WPKH needs exactly `[DER ‖ 0x01, 33-byte key]`, low s and canonical DER; P2TR a lone 64-byte or `…‖0x01` signature. The `ful` and `pof` prefixes are inconclusive before any length cap, so long proof-of-funds vectors stay inconclusive.
- `solana.ts`, `solana-offchain.ts`: strict RFC 8032; v0 and v1 envelopes, with v1 signatories ascending and unique.
- `messages.ts`: the builder validates every field (an error naming it), writes the EVM address in EIP-55 and folds the statement to the EIP-4361 character set. The parser splits lines and compares prefixes, with no backtracking regex over a whole line.
- `verify.ts`, `context.ts`, the four evaluators, `reasons.ts`, `evaluators.ts`, `evaluate.ts`; `not-implemented.ts` deleted.
- A test corrected during GREEN: `eip55.test.ts` "finds a single wrong letter case" replaced `Ed` with `ED`, but the vector has no `Ed`, so the case was a no-op; it now flips the final `d`.
- Lint during GREEN: the bech32 alphabet as a regex character class failed `regexp/prefer-range` and became a string lookup.

```
$ cd packages/checks && pnpm exec vitest run src/crypto --coverage.enabled=false
 Test Files  16 passed (16)
      Tests  327 passed (327)
$ pnpm exec eslint packages/checks/src/crypto packages/checks/src/contact   # clean
$ (cd packages/checks && pnpm exec tsc --noEmit)                         # clean
$ cd packages/checks && pnpm exec vitest run src/crypto src/contact --coverage.include='src/crypto/**' --coverage.include='src/contact/**'
      Tests  499 passed (499)
All files          |   97.69 |     93.4 |   99.43 |   97.62 |
```

## 7. Refactor and the reasons cross-check

- `recoverPublicKey` became `recoverSecp256k1Key`: the package index re-exports every folder with `export *`, so a generic name could collide with another area's export (TS2308). Suite green before and after (499 tests).
- One-off comparison with the contracts lists, outside any test (`tsx` from `apps/api`, a scratchpad script importing both packages' sources): `CONTACT_EVALUATOR_REASONS` equals `CONTACT_CHECK_REASONS` and `CRYPTO_WALLET_EVALUATOR_REASONS` equals `CRYPTO_WALLET_CHECK_REASONS`, order included. The lasting contract test belongs in `apps/api/src/jobs/<type>-contract.test.ts` (api-otp, api-crypto), because `packages/checks` cannot import `@openverify/contracts`.

```
$ (cd apps/api && pnpm exec tsx --conditions=@openverify/source <scratchpad>/compare.ts)
contact equal (order too): true
crypto equal (order too): true
```

## 8. Final gates (foreground, on 59bb7cf with the other Stage 2 agents' work in the tree)

```
$ pnpm --filter @openverify/checks typecheck                 # tsc --noEmit: clean (14 s)
$ pnpm --filter @openverify/checks lint                      # eslint .: clean (35 s)
$ pnpm --filter @openverify/checks test
 Test Files  115 passed (115)
      Tests  2088 passed (2088)
All files          |   98.42 |    90.29 |   99.33 |   98.37 |
$ pnpm --filter @openverify/core test
 Test Files  16 passed (16)
      Tests  711 passed (711)
All files          |     100 |    96.61 |     100 |     100 |
$ pnpm typecheck                                             # Tasks: 12 successful, 12 total
$ pnpm lint                                                  # Tasks: 12 successful, 12 total
$ pnpm format:check                                          # All matched files use Prettier code style!
$ flock -w 60 /tmp/openverify-e2e.lock pnpm e2e              # exit 0 after 458 s
@openverify/flow:e2e:   38 passed (24.7s)
@openverify/e2e:e2e:   50 passed (7.2m)
```

- The first `pnpm --filter @openverify/checks test` failed on 28 tests in `src/matching/business-names.test.ts` and `identifiers.test.ts`: the `checks-matching` agent's committed RED step (9488dbb). Its GREEN landed in the tree minutes later, and the run above passed. None of this area's files were involved.
- The first `pnpm format:check` failed on `packages/checks/.vitest/json/output.json`. An earlier run of mine with `--reporter=json` and no output file wrote it, untracked; it was deleted and the check passed.
