/**
 * The evaluator of every crypto wallet check of PLAN §4.3 (C57.4): a function of the shared
 * context. `evaluateCryptoWalletChecks` runs the enabled ones.
 */
import type { CheckResult } from '@openverify/core';
import type { CryptoWalletContext } from './context.js';
import { cryptoWalletAddressComparison } from './crypto-wallet-address-comparison.js';
import { cryptoWalletDisallowedChainDetection } from './crypto-wallet-disallowed-chain-detection.js';
import { cryptoWalletStatementComparison } from './crypto-wallet-statement-comparison.js';
import { cryptoWalletValidityDetection } from './crypto-wallet-validity-detection.js';

export type CryptoWalletEvaluator = (context: CryptoWalletContext) => CheckResult;

/** Every `crypto_wallet` check, by id. */
export const CRYPTO_WALLET_EVALUATORS = Object.freeze({
  crypto_wallet_validity_detection: cryptoWalletValidityDetection,
  crypto_wallet_disallowed_chain_detection: cryptoWalletDisallowedChainDetection,
  crypto_wallet_statement_comparison: cryptoWalletStatementComparison,
  crypto_wallet_address_comparison: cryptoWalletAddressComparison,
}) satisfies Readonly<Record<string, CryptoWalletEvaluator>>;
