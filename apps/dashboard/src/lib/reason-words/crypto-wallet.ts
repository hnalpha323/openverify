/**
 * C54.5, C66: the reason codes of the `verification/crypto-wallet` checks in words (C51.2, C57.4),
 * for operators. A contract wallet, an address whose control cannot be proven here, a form the
 * server cannot verify and an unbound EVM RPC go to review, never to a failure, and their words
 * say so. `input_missing` keeps the shared words.
 */
import type { ReasonWords } from './types';

export const CRYPTO_WALLET_REASON_WORDS: ReasonWords = Object.freeze({
  // Validity (user behaviour, category fraud).
  address_invalid: {
    words: 'Not an address of this chain',
    explanation: 'The claimed address is not a well-formed address of the chosen chain.',
  },
  address_checksum_invalid: {
    words: 'Address checksum wrong',
    explanation:
      "The address's checksum does not hold (a typo), or the template requires an EIP-55 checksum and the address carries none.",
  },
  // Disallowed chain.
  chain_not_allowed: {
    words: 'Chain not allowed',
    explanation: "The chain is not among the template's allowed chains.",
  },
  no_allowlist: {
    words: 'No chain allowlist set',
    explanation:
      'The template sets no allowed chains, so every chain the step offers is allowed; this never blocks.',
  },
  // Statement.
  statement_mismatch: {
    words: 'Signed text differs from the challenge',
    explanation:
      'The signature verified, but not over exactly the message the server issued for this verification.',
  },
  // Address comparison (user behaviour, category fraud).
  signature_invalid: {
    words: 'Signature invalid',
    explanation: 'The signature is malformed, or does not verify for the claimed address.',
  },
  signature_address_mismatch: {
    words: 'Signed by another address',
    explanation: "The signature is valid, but was made by a key other than the claimed address's.",
  },
  expected_address_mismatch: {
    words: 'Not the expected address',
    explanation: 'The claimed address differs from the wallet address the inquiry expected.',
  },
  signature_inconclusive: {
    words: 'Signature cannot be verified here',
    explanation:
      'The signature is of a form the server cannot verify, such as BIP-322 full, a script address or an ERC-6492 envelope; a reviewer decides.',
  },
  ownership_proof_unsupported: {
    words: 'No ownership proof for this address',
    explanation:
      'No signature can prove control of this address here (an XRP Ledger account, or a Solana program account off the ed25519 curve); a reviewer decides.',
  },
  contract_wallet_not_allowed: {
    words: 'Contract wallet, not allowed',
    explanation:
      'A smart-contract wallet accepted the signature (ERC-1271), which proves control of a contract, not of a person; the template does not allow contract wallets, so a reviewer decides.',
  },
  // ADR 0002 §3e, decision 51: an EVM signature that needs an RPC with none bound.
  provider_not_configured: {
    words: 'Not configured',
    explanation:
      "No EVM RPC provider is bound in this environment, so a signature from another account cannot be told apart from a contract wallet's; a reviewer decides.",
  },
  execution_error: {
    words: 'Could not run',
    explanation:
      'The EVM RPC failed after its retries or answered an error, a revert included; a reviewer decides.',
  },
});
