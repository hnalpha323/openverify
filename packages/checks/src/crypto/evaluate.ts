/**
 * Runs the crypto wallet checks a template enables for one verification (C57.4), in configuration
 * order, over one shared context. Every check has an evaluator; disabled checks give no result.
 */
import type { CheckResult, VerificationTemplateConfig } from '@openverify/core';
import { enabledChecksOf } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import { cryptoWalletContext } from './context.js';
import { CRYPTO_WALLET_EVALUATORS } from './evaluators.js';
import type { CryptoWalletCheckInput } from './inputs.js';

/**
 * Evaluates the enabled `crypto_wallet` checks.
 * @throws {InvalidCheckConfigError} when the configuration names an unknown check or one of
 * another verification type, or a check's config breaks its schema.
 */
export function evaluateCryptoWalletChecks(
  input: CryptoWalletCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  const checks = enabledChecksOf('crypto_wallet', config);
  const context = cryptoWalletContext(input, config);
  return checks.map((checkId) => {
    const evaluate = Object.hasOwn(CRYPTO_WALLET_EVALUATORS, checkId)
      ? CRYPTO_WALLET_EVALUATORS[checkId as keyof typeof CRYPTO_WALLET_EVALUATORS]
      : undefined;
    // Every registry check of the type has an evaluator; a missing one would be pending, never passed.
    return evaluate === undefined
      ? checkResult(checkId, 'pending', ['not_implemented'])
      : evaluate(context);
  });
}
