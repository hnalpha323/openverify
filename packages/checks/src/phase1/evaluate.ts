/**
 * Runs the checks a template enables for one verification (contracts C7, C29 and C43). Every
 * government ID check of §4.1 has an evaluator (`GOVERNMENT_ID_EVALUATORS`), evaluated over one
 * shared context, and so has every selfie check of §4.2 (`SELFIE_EVALUATORS`, over the C43 selfie
 * context and its cascade). An enabled check without an evaluator would be reported as `pending`
 * with reason `not_implemented`, never as passed: when it is required, the decision engine sends
 * the verification to review (C30.1). Disabled checks produce no result.
 */
import {
  getCheckDefinition,
  type CheckId,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { governmentIdContext, type GovernmentIdContext } from '../government-id/context.js';
import { GOVERNMENT_ID_EVALUATORS } from '../government-id/evaluators.js';
import { InvalidCheckConfigError, checkResult } from '../result.js';
import type { GovernmentIdCheckInput } from '../government-id/inputs.js';
import { selfieContext, type SelfieContext } from '../selfie/context.js';
import { SELFIE_EVALUATORS } from '../selfie/evaluators.js';
import type { SelfieCheckInput } from '../selfie/inputs.js';

/** Reason of the `pending` result of an enabled check that has no evaluator yet. */
export const NOT_IMPLEMENTED_CHECK_REASON = 'not_implemented';

/** Reason of a check that could not run because the vision service could not read an image. */
export const IMAGE_UNREADABLE_CHECK_REASON = 'image_unreadable';

export type { GovernmentIdCheckInput } from '../government-id/inputs.js';

export type { SelfieCheckInput } from '../selfie/inputs.js';

type Evaluators<Input> = Readonly<Partial<Record<CheckId, (input: Input) => CheckResult>>>;

/** The checks Phase 1 evaluated, by verification type (C7); Phase 3 evaluates every §4.1 one. */
export const PHASE1_EVALUATED_CHECKS = Object.freeze({
  government_id: Object.freeze([
    'id_blur_detection',
    'id_glare_detection',
    'id_portrait_detection',
    'id_double_side_detection',
  ] as CheckId[]),
  selfie: Object.freeze([
    'selfie_image_quality_detection',
    'selfie_multiple_faces_detection',
    'selfie_id_comparison',
  ] as CheckId[]),
});

type Phase1VerificationType = 'government_id' | 'selfie';

/**
 * The enabled checks of a configuration, in configuration order.
 * @throws {InvalidCheckConfigError} for an unknown check or one of another verification type.
 */
function enabledChecks(
  verificationType: Phase1VerificationType,
  config: VerificationTemplateConfig,
): CheckId[] {
  const enabledIds: CheckId[] = [];
  for (const [name, { enabled }] of Object.entries(config.checks)) {
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
    if (enabled) {
      enabledIds.push(definition.id as CheckId);
    }
  }
  return enabledIds;
}

function evaluateEnabled<Input>(
  verificationType: Phase1VerificationType,
  evaluators: Evaluators<Input>,
  input: Input,
  config: VerificationTemplateConfig,
): CheckResult[] {
  return enabledChecks(verificationType, config).map((checkId) => {
    const evaluate = Object.hasOwn(evaluators, checkId) ? evaluators[checkId] : undefined;
    return evaluate === undefined
      ? checkResult(checkId, 'pending', [NOT_IMPLEMENTED_CHECK_REASON])
      : evaluate(input);
  });
}

/** The checks that judge whether an image can be read at all. */
const IMAGE_QUALITY_CHECKS: ReadonlySet<CheckId> = new Set<CheckId>([
  'id_blur_detection',
  'id_glare_detection',
  'selfie_image_quality_detection',
]);

/**
 * The results when the vision service could not read an uploaded image (not a supported
 * image, corrupt, or too many pixels), in configuration order. No check that needs the image
 * can run, and none is reported as passed: each enabled image quality check fails with
 * `image_unreadable` (a `user_behavior` failure, so the user is asked for a new photo), every
 * other enabled check that reads a vision measurement stays `pending` with the same reason, and a
 * check that needs only the extraction has no evidence (`not_applicable`/`input_missing`, C29.4).
 * @throws {InvalidCheckConfigError} when the configuration names an unknown check or one of
 * another verification type.
 */
export function unreadableImageChecks(
  verificationType: Phase1VerificationType,
  config: VerificationTemplateConfig,
): CheckResult[] {
  return enabledChecks(verificationType, config).map((checkId) => {
    if (IMAGE_QUALITY_CHECKS.has(checkId)) {
      return checkResult(checkId, 'failed', [IMAGE_UNREADABLE_CHECK_REASON]);
    }
    return getCheckDefinition(checkId)?.inputs.includes('vision') === true
      ? checkResult(checkId, 'pending', [IMAGE_UNREADABLE_CHECK_REASON])
      : checkResult(checkId, 'not_applicable', ['input_missing']);
  });
}

/**
 * Evaluates the enabled government ID checks of a template, in configuration order, over one
 * shared context: the extraction the worker passes, or one derived from the analysis (C31).
 * @throws {InvalidCheckConfigError} when the configuration names an unknown check or one of
 * another verification type, or a check's config breaks its schema.
 */
export function evaluateGovernmentIdChecks(
  input: GovernmentIdCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  const context = governmentIdContext(input, config);
  return evaluateEnabled<GovernmentIdContext>(
    'government_id',
    GOVERNMENT_ID_EVALUATORS,
    context,
    config,
  );
}

/**
 * Evaluates the enabled selfie checks of a template, in configuration order, over one shared
 * context (C43): the capture, the environment kind, the history and the providers the worker
 * passes, and the cascade built once from the measurements.
 * @throws {InvalidCheckConfigError} when the configuration names an unknown check or one of
 * another verification type, or a check's config breaks its schema.
 * @throws {InvalidFaceEmbeddingError} for a malformed embedding.
 */
export function evaluateSelfieChecks(
  input: SelfieCheckInput,
  config: VerificationTemplateConfig,
): CheckResult[] {
  const context = selfieContext(input, config);
  return evaluateEnabled<SelfieContext>('selfie', SELFIE_EVALUATORS, context, config);
}
