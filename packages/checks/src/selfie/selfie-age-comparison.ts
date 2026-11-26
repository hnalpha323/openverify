/**
 * `selfie_age_comparison` (A/H, fraud, C43, C44): an age-estimation provider's estimate of the
 * centre image, against the template's `min-age`/`max-age` and the age by the compared ID's
 * birthdate. Phase 4 ships only the adapter part: no age model with permissive weights and data
 * exists (research §4). The estimate fails only when it lies outside a limit by more than
 * `buffer-years` (`age_outside_limits`), or differs from the birthdate's age by more than
 * `buffer-years` (`age_inconsistent_with_birthdate`): estimators err by several years.
 *
 * No provider: `provider_not_configured`; a failed one: `execution_error`; no centre face:
 * `input_missing`; no limits and no birthdate: `no_reference_data`. The estimate itself stays out
 * of the result: only its distance beyond the limits and from the birthdate's age is kept.
 */
import type { CheckResult } from '@openverify/core';
import { ageOn, parseIsoDate, utcToday } from '../dates.js';
import { checkResult } from '../result.js';
import {
  numberIn,
  poseAnalysisOf,
  selfieCheckConfig,
  selfieResultOptions,
  type SelfieContext,
} from './context.js';

const CHECK_ID = 'selfie_age_comparison';
const KEYS = ['min-age', 'max-age', 'buffer-years'] as const;

const round1 = (value: number) => Math.round(value * 10) / 10;

export function selfieAgeComparison(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const options = selfieResultOptions(config, KEYS);
  const outcome = context.input.providers?.selfieAgeEstimate;
  if (outcome === undefined || outcome.kind === 'not_configured') {
    return checkResult(CHECK_ID, 'not_applicable', ['provider_not_configured'], {}, options);
  }
  if (outcome.kind === 'error') {
    return checkResult(CHECK_ID, 'not_applicable', ['execution_error'], {}, options);
  }
  const providerOptions = { ...options, provider: outcome.provider };
  if (poseAnalysisOf(context, 'center')?.face == null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, providerOptions);
  }
  const minAge = numberIn(config, 'min-age');
  const maxAge = numberIn(config, 'max-age');
  const buffer = numberIn(config, 'buffer-years') ?? 0;
  const birth = context.input.idBirthdate == null ? null : parseIsoDate(context.input.idBirthdate);
  if (minAge === undefined && maxAge === undefined && birth === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['no_reference_data'], {}, providerOptions);
  }
  const estimate = outcome.result.age;
  const reasons: string[] = [];
  const metadata: Record<string, number> = {};
  if (minAge !== undefined || maxAge !== undefined) {
    const beyond = Math.max(
      0,
      minAge === undefined ? 0 : minAge - estimate,
      maxAge === undefined ? 0 : estimate - maxAge,
    );
    metadata['years-beyond-limits'] = round1(beyond);
    if (beyond > buffer) {
      reasons.push('age_outside_limits');
    }
  }
  if (birth !== null) {
    const difference = Math.abs(estimate - ageOn(birth, utcToday(context.now)));
    metadata['age-difference-years'] = round1(difference);
    if (difference > buffer) {
      reasons.push('age_inconsistent_with_birthdate');
    }
  }
  return reasons.length > 0
    ? checkResult(CHECK_ID, 'failed', reasons, metadata, providerOptions)
    : checkResult(CHECK_ID, 'passed', [], metadata, providerOptions);
}
