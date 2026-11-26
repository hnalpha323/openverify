# Crypto wallet checks

This page describes the `crypto_wallet` verification type as Phase 5 ships it: the chains it knows, the single-use challenge a wallet signs, the signature schemes the server verifies, the four checks, and what a pass means. The binding contract is C57 of `docs/plans/phase-5.plan.md`; the tiers and the honesty rules are ADR 0002.

## Contents

- [What a pass means](#what-a-pass-means)
- [The step](#the-step)
- [Chains](#chains)
- [The challenge](#the-challenge)
- [Submitting a signature](#submitting-a-signature)
- [The checks](#the-checks)
- [Contract wallets and the EVM RPC](#contract-wallets-and-the-evm-rpc)
- [Configuration](#configuration)
- [Privacy](#privacy)
- [Clients](#clients)
- [Known limits](#known-limits)

## What a pass means

A pass means that whoever answered the challenge controlled the claimed address's key **at signing time**: the signature verifies, over exactly the message our server issued for this verification, for the address the user claimed, within ten minutes, once.

- It is **not** proof of who the person is, nor that they still control the key, nor that the wallet holds any funds. A key can be shared or sold, and signing moves nothing.
- A **contract wallet** (ERC-1271, such as a multisig) proves control of a contract, not of a person: the contract decides which signatures it accepts. It passes only when the template allows contract wallets, or the inquiry's expected address equals it (decision 20); otherwise it goes to review.
- **Without an EVM RPC** bound, an EVM signature that recovers to another account cannot be told apart from a contract wallet's, so it goes to review (`provider_not_configured`), never to a failure (decision 51).
- An address whose ownership cannot be proven here (the XRP Ledger, a Solana program account, a Bitcoin script other than a single key) goes to review, never to a failure.

## The step

| Step (flow-spec) | Verification type | Default attempts | Settings |
|---|---|---|---|
| `crypto_wallet` | `crypto_wallet` (`crypto-wallet`) | 3 | `chains` (canonical CAIP-2 ids, unique), `signing` (`wallet`, `paste`), `maxAttempts` |

Publishing refuses (C50.4) a step whose `chains` are not all within the type's `allowed-chains`, and `xrpl:0` while `crypto_wallet_address_comparison` is required (nothing can prove control of an XRP Ledger account here).

## Chains

`CRYPTO_CHAINS` (`packages/core`, C57.1), checked against the ChainAgnostic namespaces at a pinned commit. TRON's CAIP-2 id is the decimal `tron:728126428`; the deprecated `tron:0x2b6653dc` is converted to it.

| Chain id | Name | Address validity | Ownership proof |
|---|---|---|---|
| `eip155:<n>` | EVM chains | `0x` and 40 hex digits; EIP-55 checked when the address mixes case | EIP-191 `personal_sign` over an EIP-4361 message; ERC-1271 through the EVM RPC |
| `bip122:000000000019d6689c085ae165831e93` | Bitcoin | base58check P2PKH and P2SH; bech32 v0 and bech32m v1+; mixed case refused | BIP-137 (and BIP-322 legacy for P2PKH); BIP-322 simple for P2WPKH and the P2TR key path |
| `bip122:000000000933ea01ad0ee984209779ba` | Bitcoin testnet | as Bitcoin, testnet prefixes | as Bitcoin |
| `bip122:12a765e31ffd4059bada1e25190f6e98` | Litecoin | Litecoin prefixes, `ltc1` | BIP-137 with Litecoin's magic |
| `bip122:1a91e3dace36e2be3bf030a65679fe82` | Dogecoin | Dogecoin prefixes | BIP-137 with Dogecoin's magic |
| `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | Solana | base58, exactly 32 bytes; `on-curve` recorded | ed25519 (RFC 8032 strict) over a Sign-In with Solana message; off-chain message envelopes v0 and v1 unwrapped |
| `tron:728126428` | TRON | base58check, `0x41` version, starts with `T` | TronWeb `signMessageV2` |
| `xrpl:0` | XRP Ledger | Ripple alphabet and checksum, starts with `r` | none (`ownership_proof_unsupported`) |

Bounds: an address at most 128 characters, a signature at most 1,024, a message at most 4 KiB.

## The challenge

`POST /api/v1/flow/verifications/:id/crypto-challenges` with `{ "chain-id", "wallet-address" }` (C57.2):

- **Refusals, before anything is written**, each a 422 with its code: a chain outside the step's `chains` or the type's `allowed-chains` (`crypto_chain_not_offered`); an invalid address, or an EVM address without its EIP-55 checksum when `require-evm-checksum` is set (`crypto_address_invalid`); an address other than the inquiry's field `crypto_wallet_address` once both are canonicalised (EVM ignores case, bech32 is lower-cased, base58 must match exactly) (`crypto_expected_address_mismatch`).
- **The message**, built by the server, never by the client:
  - EVM: EIP-4361 (Sign-In with Ethereum), the address in its EIP-55 form;
  - Solana: Sign-In with Solana, `Chain ID: mainnet`;
  - the other chains: the same fields in the CAIP-122 wording (`<host> wants you to sign in with your <chain> account:`), the full CAIP-2 id as `Chain ID`.

  The domain and `URI` come from `OPENVERIFY_FLOW_PUBLIC_URL`, never from a request header. The statement is `<org> asks you to prove you control this wallet. Signing is free and moves no funds.`, with the organization name sanitised as for SMS (C55.9) and folded to the EIP-4361 character set. Then `Version: 1`, a 16-character base62 `Nonce`, `Issued At`, `Expiration Time` (600 seconds later) and the verification id as `Request ID`.
- 201 `{ id, message, expires-at }`. A new challenge supersedes the open one. **The eleventh challenge cancels the verification** (409 `crypto_challenge_invalid`, a retryable attempt, as the selfie capture cap is), so a user cannot ask for messages forever; when the step has no attempt left, the inquiry fails.

The address is sealed as the user claimed it (so the job still sees whether an EVM address carried its checksum), and blind-indexed in its canonical form.

## Submitting a signature

`POST /api/v1/flow/verifications/:id/submit` with `{ "crypto": { "challenge-id", "signature", "signed-message"?, "scheme"? } }` (C57.3). The named challenge must be open and unexpired; it is consumed by a conditional update, once. Every refusal, a missing `crypto` member included, is the same 409 `crypto_challenge_invalid`. A repeated submit must name the challenge that submitted the verification.

Encodings of `signature`:

| Scheme | Encoding |
|---|---|
| `eip191` | `0x` hex, 65 bytes (`v` 27, 28, 0 or 1) |
| `tron-v2` | hex, `0x` optional |
| `bip137`, `bip322-legacy` | base64 of 65 bytes |
| `bip322-simple` | `smp` and the base64 of the consensus-encoded witness, or the base64 alone |
| `solana-ed25519` | base58, or padded base64, of 64 bytes |

`signed-message` is the padded base64 of the exact bytes the wallet signed, sent only when the wallet wrapped the message (a Solana off-chain envelope). Without it, the challenge's UTF-8 bytes are taken as signed. Without a `scheme`, it is inferred from the chain (and, for Bitcoin, from the signature's prefix or header byte); a scheme the chain does not take is `signature_invalid`.

## The checks

| Check | Type | Category | Default | Passes when | Fails with | `not_applicable` with |
|---|---|---|---|---|---|---|
| `crypto_wallet_validity_detection` | user behaviour | fraud | required | the claimed address is an address of its chain | `address_invalid`, `address_checksum_invalid` | `input_missing` |
| `crypto_wallet_disallowed_chain_detection` | fraud | fraud | required | the chain is in `allowed-chains` | `chain_not_allowed` | `no_allowlist` (non-blocking), `input_missing` |
| `crypto_wallet_address_comparison` | user behaviour | fraud | required | the signature over our challenge proves control of the claimed address | `signature_invalid`, `signature_address_mismatch`, `expected_address_mismatch` | `signature_inconclusive`, `ownership_proof_unsupported`, `contract_wallet_not_allowed`, `provider_not_configured`, `execution_error`, `input_missing` |
| `crypto_wallet_statement_comparison` | fraud | fraud | required | the verified signature covers exactly the bytes of our challenge | `statement_mismatch` | `input_missing` (no verified signature) |

- **Validity** metadata: `checksum` (`valid`, `absent` or `none`), `address-type` (`evm`, `p2pkh`, `p2sh`, `p2wpkh`, `p2wsh`, `p2tr`, `witness_unknown`, `solana`, `tron`, `xrpl`) and, for Solana, `on-curve`. An all-lower-case or all-upper-case EVM address carries no checksum (`absent`), which passes unless `require-evm-checksum` is set.
- **Address comparison.** The validity and address checks are user behaviour (category `fraud`): a pasted slip or a wrong account is the user's to fix, and a retry still needs the key (decision 21), so the flow shows a hint (`signature_invalid`, `signature_address_mismatch`, `expected_address_mismatch`, `address_invalid`, `address_checksum_invalid`). Metadata: `scheme`, and the flags `high-s` (ECDSA schemes), `bip137-loose` and `contract-wallet`. A form the server cannot verify answers `signature_inconclusive` (review): BIP-322 full and proof of funds, P2WSH and P2SH scripts other than P2SH-P2WPKH, segwit v2 to v16, a script-path spend, an ERC-6492 envelope. The signed bytes must be our challenge, or a Solana off-chain envelope of it that names the claimed key: a valid signature over any other bytes (a message signed elsewhere, then pasted with its `signed-message`) fails `signature_invalid`, so ownership is bound to this challenge even when a template makes the statement check advisory or disables it; the statement check still reports such a replay as `statement_mismatch`.
- **BIP-137.** `bip137-mode: loose` (the default) takes any header byte and derives the claimed address's own script type from the recovered key, flagged `bip137-loose`; `strict` needs the header range of the address's type. BIP-322 legacy is BIP-137 restricted to P2PKH. BIP-322 simple always needs a low-s signature, as BIP-322 says.
- **Statement.** It passes only when the address check verified the signature over exactly the bytes compared with the challenge (after a Solana off-chain unwrap), or when a contract wallet's ERC-1271 answer accepted them. Metadata: `envelope` (`solana-offchain-v0` or `-v1`) when one was unwrapped.
- **Disallowed chain.** The type-level `allowed-chains` is recorded as its threshold. Without it every offered chain is allowed, `no_allowlist`, which never blocks.

No result copies an address, a signature or a message.

## Contract wallets and the EVM RPC

When an EVM signature recovers to no matching key, the worker asks the `evmRpc` provider once (C57.4, C57.5):

1. `eth_getCode(address)`. No code: the signature was made by another key, `signature_address_mismatch` (or `signature_invalid` for bytes no key could have made).
2. Code: ERC-1271 `isValidSignature(digest, signature)` with gas 500,000. Exactly the 32-byte magic value `0x1626ba7e` (padded) passes, with `allow-contract-wallets` or an equal expected address, else `contract_wallet_not_allowed` (review). Any other result fails `signature_invalid`.
3. A JSON-RPC error (a revert included) is `execution_error` (review): it can come from our gas cap or the node. A 429, a 5xx, a timeout or a network failure is retried with the job, then `execution_error`. A chain without a configured node is `provider_not_configured`.

Binding (C63): `OPENVERIFY_PROVIDER_EVM_RPC_SANDBOX` and `OPENVERIFY_PROVIDER_EVM_RPC_PRODUCTION` take `json-rpc`, `sandbox` (sandbox environments only) or empty. `json-rpc` reads `OPENVERIFY_EVM_RPC_URLS`, a comma-separated list of `eip155:<n>=https://…` entries (no user and password in the URL; a key in the path is kept secret and never echoed). Calls go through the outbound HTTP client with a 10 s timeout, no redirect followed, and response caps of 4 KiB for a call and 64 KiB for code (EIP-170 allows 24,576 bytes of code). Private and loopback addresses and plain `http` are refused unless `OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS=true`, for an operator's own node (decision 22). No public RPC ships (decision 23). The sandbox provider is described in [the sandbox providers](sandbox-providers.md#evm-rpc).

## Configuration

| Key | Where | Default | What it does |
|---|---|---|---|
| `allowed-chains` | type option (`crypto-wallet`) | unset | chains the template accepts; recorded by the disallowed-chain check |
| `require-evm-checksum` | `crypto_wallet_validity_detection` | `false` | an EVM address must carry its EIP-55 checksum, at challenge creation and in the check |
| `bip137-mode` | `crypto_wallet_address_comparison` | `loose` | `strict` or `loose` header handling |
| `allow-high-s` | `crypto_wallet_address_comparison` | `true` | a high-s ECDSA signature passes, flagged (EIP-2 binds transactions only) |
| `allow-contract-wallets` | `crypto_wallet_address_comparison` | `false` | an ERC-1271 contract wallet passes |

Every default is provisional (C51.3). The inquiry field `crypto_wallet_address` is the expected address: a challenge for another address is refused, and the verification's `expected-address` attribute shows it.

## Privacy

- `wallet-address` and `expected-address` are PII attributes: masked without `pii:view`, null once the inquiry is redacted. `chain-id` and `signature-scheme` are not.
- The address, the message, the signature and the signed message are sealed to the challenge row and nulled by redaction. No address, signature or message appears in a log (except under the `pii` key), an event, a problem or check metadata.
- Signing never sends a transaction: the wallet signs a text message, and nothing is broadcast.

## Clients

- **Web flow:** the network choice; with `wallet` signing on an EVM chain and a browser wallet (EIP-6963 announcements, else `window.ethereum`), connect, create the challenge, `personal_sign`, submit as `eip191`; otherwise the paste path (the address, the message with a copy button and its expiry, the signature, and a Solana signed message). No crypto library runs in the browser and the CSP is unchanged: the server verifies.
- **Android SDK:** the paste path only (C64.2). A step whose `signing` lacks `paste`, or which offers no chain the SDK knows, is shown as unsupported on Android.

## Known limits

- One ownership proof per chain family; no transaction-based proofs, no proof of funds, no BIP-322 full or multisig scripts (they answer `signature_inconclusive`).
- An EVM wallet deployed later (ERC-6492 counterfactual) is inconclusive; its signature still costs one `eth_getCode` call.
- Ownership is proven at signing time only; nothing watches the address afterwards.
