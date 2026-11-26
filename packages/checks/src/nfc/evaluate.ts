/**
 * Runs the government ID NFC checks a template enables for one verification (C62), in
 * configuration order, over one shared context. Every NFC check has an evaluator, so none
 * answers `pending` or `not_implemented`; disabled checks produce no result.
 */
import type { CheckResult, VerificationTemplateConfig } from '@openverify/core';
import { enabledChecksOf } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import { nfcContext } from './context.js';
import { NFC_EVALUATORS, type NfcEvaluator } from './evaluators.js';
import type { GovernmentIdNfcCheckInput } from './inputs.js';

/**
 * Evaluates the enabled `government_id_nfc` checks.
 * @throws {InvalidCheckConfigError} when the configuration names an unknown check or one of
 * another verification type, or a check's config breaks its schema.
 */
export function evaluateGovernmentIdNfcChecks(
  input: GovernmentIdNfcCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  const context = nfcContext(input, config);
  const evaluators: Readonly<Record<string, NfcEvaluator | undefined>> = NFC_EVALUATORS;
  return enabledChecksOf('government_id_nfc', config).map((checkId) => {
    const evaluate = evaluators[checkId];
    return evaluate === undefined
      ? checkResult(checkId, 'pending', ['not_implemented'])
      : evaluate(context);
  });
}
