/**
 * `id_age_inconsistency_detection` (A/H, fraud, model-based): the portrait's apparent age, from
 * an age-estimation provider (C35; no permissive model ships in Phase 3), against the age from
 * the birth date. A gap above `max-age-difference-years` fails (`apparent_age_inconsistent`); the
 * provider's own confidence is kept. No provider: `provider_not_configured`; a failed one:
 * `execution_error`; no birth date or portrait: `input_missing`. The ages stay out of the result;
 * only their difference is kept.
 */
import type { CheckResult } from '@openverify/core';
import { ageOn, parseIsoDate, utcToday } from '../dates.js';
import { checkResult } from '../result.js';
import { checkConfigOf, modelsOf, type GovernmentIdContext } from './context.js';
import { isCheckResult, providerResult } from './provider.js';
import { numberOf } from './values.js';

const CHECK_ID = 'id_age_inconsistency_detection';
const DEFAULT_MAX_DIFFERENCE = 10;

export function idAgeInconsistencyDetection(context: GovernmentIdContext): CheckResult {
  const maxDifference =
    numberOf(checkConfigOf(context, CHECK_ID), 'max-age-difference-years') ??
    DEFAULT_MAX_DIFFERENCE;
  const thresholds = { 'max-age-difference-years': maxDifference };
  const outcome = providerResult(CHECK_ID, context.input.providers?.ageEstimate, { thresholds });
  if (isCheckResult(outcome)) {
    return outcome;
  }
  const models = modelsOf(context, ['faceDetector']);
  const options = {
    thresholds,
    provider: outcome.provider,
    ...(models === undefined ? {} : { models }),
  };
  const birthdate = context.extraction.consolidated.fields.birthdate;
  const birth = birthdate === null ? null : parseIsoDate(birthdate);
  if (birth === null || context.input.analysis.sides.front.portrait === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const difference = Math.abs(outcome.result.estimatedAge - ageOn(birth, utcToday(context.now)));
  const metadata = { 'age-difference-years': Math.round(difference * 10) / 10 };
  const confidence = outcome.result.confidence ?? null;
  return difference > maxDifference
    ? checkResult(CHECK_ID, 'failed', ['apparent_age_inconsistent'], metadata, {
        ...options,
        confidence,
      })
    : checkResult(CHECK_ID, 'passed', [], metadata, { ...options, confidence });
}
