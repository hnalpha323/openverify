# Crypto address watchlist report (`report/crypto-address-watchlist`)

Screens one crypto address against the addresses the selected sanctions lists publish (OFAC and the UK list carry them). **Tier:** R, exact matching only; the optional exposure block is A. **Stage:** `ga`: every row of the format table below has passing test vectors (`packages/watchlist/src/crypto/canonical.test.ts`). See [the reports overview](README.md) for what every type shares.

## What a result means

- `ready` with `has-match: true`: a listed address has exactly the query's canonical form. `result` lists the entries with the matched addresses and their tickers.
- `ready` with `has-match: false`: no listed address has that canonical form on any selected list that was screened.
- An address in no known format is compared as its trimmed text and `coverage.limits` holds `unclassified_format`. An address whose checksum fails is still compared; its format is reported in `crypto-address-format`.
- A match says the address is listed, not who controls it now.

## Query

`crypto-address` (up to 256 characters) and `chain-id`? (a CAIP-2 id, for an EVM address on a named chain). Surrounding spaces and a URI scheme with its query (`bitcoin:`, `ethereum:`, `litecoin:`, `dogecoin:`) are removed first. A completion report takes the passed crypto wallet verification's address and chain.

## Canonical forms

| Format | Canonical form |
|---|---|
| EVM (any chain), Bitcoin and its testnet, Litecoin, Dogecoin, Solana, TRON, XRPL | as the Phase 5 wallet checks read them: EVM lower-cased hex (an EVM address matches on every EVM chain), bech32 lower-cased, base58 exact |
| Bitcoin Cash CashAddr | lower-cased, `bitcoincash:` removed |
| Monero, Dash, Zcash t-addresses, Bitcoin Gold, Bitcoin SV, Verge, BNB Beacon `bnb1` | the trimmed text |
| anything else | the trimmed text, with `unclassified_format` |

List addresses go through the same table when a list is synced; their tickers (USDT appears in TRON, Ethereum and Omni formats) are metadata, never a chain.

## Exposure

With a `cryptoExposure` provider bound, the result also holds an `exposure` block (direct and indirect shares by category). Indirect exposure is reported as at least one hop, and `risk-score` is always `null`: no score is synthesised. Unbound, `exposure` is `null` with `provider_not_configured`; an address the provider cannot rate gives `undetermined`, a provider failure `execution_error`, and the screening result stands either way. Only a sandbox provider exists in Phase 6.

## Configuration

`search-lists` (the enabled sanctions sources, resolved and pinned), `max-list-age-hours` (48) and the monitoring keys. Crypto screening compares only the crypto normaliser's version of a source's keys, so it does not need the name variant groups.

## Sandbox

The synthetic list's party "Sandbox Listed Party" (`SBX-2002`) holds the EIP-55 example address `0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed` (ETH), the BIP-173 example address (XBT) and a TRON-format address (USDT): published test vectors, not any party's wallet. The sandbox exposure provider answers indirect exposure for an EVM address ending in `dead`, direct exposure for one ending in `beef`, none for any other EVM address, and "unavailable" for other chains.

## Events

`report/crypto-address-watchlist.ready`, `.errored`, `.matched`, `.dismissed`, `.reviewed`, `.redacted` (dismissal is ours; the public type has none).
