/**
 * Runs the database and AAMVA checks a template enables for one verification (C59), in
 * configuration order, over one shared context. Every check of both types has an evaluator, so
 * none answers `pending` or `not_implemented`; disabled checks produce no result.
 */
import {
  getCheckDefinition,
  type CheckId,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { InvalidCheckConfigError, checkResult } from '../result.js';
import { databaseCheckConfig } from './config.js';
import { aamvaContext, databaseContext } from './context.js';
import { AAMVA_EVALUATORS, DATABASE_EVALUATORS } from './evaluators.js';
import type { AamvaCheckInput, DatabaseCheckInput } from './inputs.js';

/** The reason of a check without an evaluator: none of these two types has one. */
const NOT_IMPLEMENTED = 'not_implemented';

/**
 * The enabled checks of a configuration, in configuration order.
 * @throws {InvalidCheckConfigError} for an unknown check or one of another verification type.
 */
function enabledChecks(
  verificationType: 'database' | 'aamva',
  config: VerificationTemplateConfig,
): CheckId[] {
  const enabled: CheckId[] = [];
  for (const [name, { enabled: on }] of Object.entries(config.checks)) {
    const definition = getCheckDefinition(name);
    if (definition?.verificationType !== verificationType) {
      throw new InvalidCheckConfigError(name as CheckId, [
        {
          path: `checks.${name}`,
          message:
            definition === undefined
              ? 'unknown check'
              : `belongs to ${definition.verificationType} verifications`,
        },
      ]);
    }
    if (on) {
      enabled.push(definition.id as CheckId);
    }
  }
  return enabled;
}

function run<Context>(
  ids: readonly CheckId[],
  evaluators: Readonly<Record<string, ((context: Context) => CheckResult) | undefined>>,
  context: Context,
): CheckResult[] {
  return ids.map((id) => {
    const evaluate = evaluators[id];
    return evaluate === undefined
      ? checkResult(id, 'pending', [NOT_IMPLEMENTED])
      : evaluate(context);
  });
}

/**
 * Evaluates the enabled `database` checks.
 * @throws {InvalidCheckConfigError} when the configuration names an unknown check or one of
 * another verification type, or a check's config breaks its schema.
 */
export function evaluateDatabaseChecks(
  input: DatabaseCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  return run(
    enabledChecks('database', config),
    DATABASE_EVALUATORS,
    databaseContext(input, config),
  );
}

/**
 * Evaluates the enabled `aamva` checks.
 * @throws {InvalidCheckConfigError} as {@link evaluateDatabaseChecks}.
 */
export function evaluateAamvaChecks(
  input: AamvaCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  return run(enabledChecks('aamva', config), AAMVA_EVALUATORS, aamvaContext(input, config));
}

/**
 * C50.7, C59.5, C59.6: whether the AAMVA job moves the verification `submitted -> skipped`: the
 * jurisdiction does not take part in DLDV, and the values came from the government ID (the
 * silent step) or the template sets `on-jurisdiction-not-participating: skip`.
 */
export function aamvaSkipsVerification(
  input: AamvaCheckInput,
  config: VerificationTemplateConfig,
): boolean {
  const answer = input.providers?.aamva;
  if (answer?.kind !== 'result' || answer.result.outcome !== 'jurisdiction_not_participating') {
    return false;
  }
  return (
    input.source === 'government_id' ||
    databaseCheckConfig(config, 'aamva_identity_comparison').values[
      'on-jurisdiction-not-participating'
    ] === 'skip'
  );
}
