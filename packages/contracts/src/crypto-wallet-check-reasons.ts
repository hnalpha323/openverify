/**
 * The reason codes of the crypto wallet checks (C51.2, C57). `checks-contact-crypto` owns this
 * file from 5A Stage 2 and may add fraud reasons only, recorded as plan amendments; the
 * user-behaviour failure reasons are frozen.
 */
import type { CheckId } from '@openverify/core';
import { checkReasonsOf, outcome, type CheckOutcomeTable } from './check-outcome-reasons.js';

export const CRYPTO_WALLET_CHECK_IDS = Object.freeze([
  'crypto_wallet_validity_detection',
  'crypto_wallet_disallowed_chain_detection',
  'crypto_wallet_statement_comparison',
  'crypto_wallet_address_comparison',
] as const satisfies readonly CheckId[]);

export type CryptoWalletCheckId = (typeof CRYPTO_WALLET_CHECK_IDS)[number];

export const CRYPTO_WALLET_CHECK_OUTCOMES: CheckOutcomeTable<CryptoWalletCheckId> = Object.freeze({
  crypto_wallet_validity_detection: outcome(['address_invalid', 'address_checksum_invalid']),
  // `no_allowlist` is non-blocking: the template allows every offered chain.
  crypto_wallet_disallowed_chain_detection: outcome(['chain_not_allowed'], ['no_allowlist']),
  // `input_missing`: no verified signature over exactly the challenge bytes (C57.4).
  crypto_wallet_statement_comparison: outcome(['statement_mismatch'], ['input_missing']),
  // C57.4: a contract wallet or an unknown envelope is never a fraud failure; without a bound
  // RPC an EVM signature that needs one answers provider_not_configured (shared).
  crypto_wallet_address_comparison: outcome(
    ['signature_invalid', 'signature_address_mismatch', 'expected_address_mismatch'],
    ['signature_inconclusive', 'ownership_proof_unsupported', 'contract_wallet_not_allowed'],
  ),
});

export const CRYPTO_WALLET_CHECK_REASONS = checkReasonsOf(CRYPTO_WALLET_CHECK_OUTCOMES);
