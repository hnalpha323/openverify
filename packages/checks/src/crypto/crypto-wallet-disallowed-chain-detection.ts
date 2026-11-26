/**
 * `crypto_wallet_disallowed_chain_detection` (R, fraud, required, C57.4): the chain is in the
 * template's type-level `allowed-chains`. Without the option every offered chain is allowed:
 * `not_applicable` with the non-blocking `no_allowlist`. A chain outside it fails
 * `chain_not_allowed`; no chain answers `input_missing`. The allowlist is recorded as the result's
 * `allowed-chains` threshold.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import type { CryptoWalletContext } from './context.js';

const CHECK_ID = 'crypto_wallet_disallowed_chain_detection';

export function cryptoWalletDisallowedChainDetection(context: CryptoWalletContext): CheckResult {
  const allowed = context.template['allowed-chains'];
  const options = allowed === undefined ? {} : { thresholds: { 'allowed-chains': [...allowed] } };
  const { chainId } = context.input;
  if (chainId === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  if (allowed === undefined) {
    return checkResult(CHECK_ID, 'not_applicable', ['no_allowlist'], {}, options);
  }
  return allowed.includes(chainId)
    ? checkResult(CHECK_ID, 'passed', [], {}, options)
    : checkResult(CHECK_ID, 'failed', ['chain_not_allowed'], {}, options);
}
