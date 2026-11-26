/**
 * Runs the contact checks a template enables for one verification (C56), in configuration order,
 * over one shared context. Every contact check has an evaluator, so none answers `pending` or
 * `not_implemented`; disabled checks produce no result.
 */
import type { CheckId, CheckResult, VerificationTemplateConfig } from '@openverify/core';
import { checkResult } from '../result.js';
import { emailAddressContext, phoneNumberContext } from './context.js';
import { EMAIL_ADDRESS_EVALUATORS, PHONE_NUMBER_EVALUATORS } from './evaluators.js';
import type { EmailAddressCheckInput, PhoneNumberCheckInput } from './inputs.js';
import { enabledChecksOf } from './phase5-config.js';

/**
 * Evaluates the enabled `phone_number` checks.
 * @throws {InvalidCheckConfigError} when the configuration names an unknown check or one of
 * another verification type, or a check's config breaks its schema.
 */
export function evaluatePhoneNumberChecks(
  input: PhoneNumberCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  const context = phoneNumberContext(input, config);
  return enabledChecksOf('phone_number', config).map((checkId) =>
    run(PHONE_NUMBER_EVALUATORS, checkId, (evaluate) => evaluate(context)),
  );
}

/**
 * Evaluates the enabled `email_address` checks.
 * @throws {InvalidCheckConfigError} when the configuration names an unknown check or one of
 * another verification type, or a check's config breaks its schema.
 */
export function evaluateEmailAddressChecks(
  input: EmailAddressCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  const context = emailAddressContext(input, config);
  return enabledChecksOf('email_address', config).map((checkId) =>
    run(EMAIL_ADDRESS_EVALUATORS, checkId, (evaluate) => evaluate(context)),
  );
}

/**
 * One check's result: its evaluator's, or `pending`/`not_implemented` should a registry entry of
 * the type ever lack one (never a pass; the decision engine sends a required one to review).
 */
function run<Evaluator>(
  evaluators: Readonly<Record<string, Evaluator>>,
  checkId: CheckId,
  call: (evaluate: Evaluator) => CheckResult,
): CheckResult {
  const evaluate = Object.hasOwn(evaluators, checkId) ? evaluators[checkId] : undefined;
  return evaluate === undefined
    ? checkResult(checkId, 'pending', ['not_implemented'])
    : call(evaluate);
}
