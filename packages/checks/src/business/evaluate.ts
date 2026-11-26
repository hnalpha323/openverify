/**
 * Runs the business registry and business website checks a template enables for one verification
 * (C61.7), in configuration order, over one shared context. Every check of both types has an
 * evaluator, so none answers `pending` or `not_implemented`; disabled checks produce no result.
 */
import type { CheckId, CheckResult, VerificationTemplateConfig } from '@openverify/core';
import { enabledChecksOf } from '../contact/phase5-config.js';
import { businessWebsiteContext, databaseBusinessContext } from './context.js';
import { BUSINESS_WEBSITE_EVALUATORS, DATABASE_BUSINESS_EVALUATORS } from './evaluators.js';
import type { BusinessWebsiteCheckInput, DatabaseBusinessCheckInput } from './inputs.js';

function run<Context>(
  ids: readonly CheckId[],
  evaluators: Readonly<Record<string, ((context: Context) => CheckResult) | undefined>>,
  context: Context,
): CheckResult[] {
  return ids.flatMap((id) => {
    const evaluate = evaluators[id];
    return evaluate === undefined ? [] : [evaluate(context)];
  });
}

/**
 * Evaluates the enabled `database_business` checks.
 * @throws {InvalidCheckConfigError} when the configuration names an unknown check or one of
 * another verification type, or a check's config breaks its schema.
 */
export function evaluateDatabaseBusinessChecks(
  input: DatabaseBusinessCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  const ids = enabledChecksOf('database_business', config);
  return run(ids, DATABASE_BUSINESS_EVALUATORS, databaseBusinessContext(input, config));
}

/**
 * Evaluates the enabled `business_website` checks.
 * @throws {InvalidCheckConfigError} as {@link evaluateDatabaseBusinessChecks}.
 */
export function evaluateBusinessWebsiteChecks(
  input: BusinessWebsiteCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  const ids = enabledChecksOf('business_website', config);
  return run(ids, BUSINESS_WEBSITE_EVALUATORS, businessWebsiteContext(input, config));
}
