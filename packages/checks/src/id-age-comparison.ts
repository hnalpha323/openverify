import type { CheckResult } from '@openverify/core';
import { z } from 'zod';
import { ageOn, daysBetween, parseIsoDate, utcToday } from './dates.js';
import { checkResult, parseCheckConfig, presentText } from './result.js';

const CHECK_ID = 'id_age_comparison';

export const idAgeComparisonOptionsSchema = z
  .strictObject({
    /** Minimum age in completed years (inclusive). */
    minAge: z.int().min(0).max(150).optional(),
    /** Maximum age in completed years (inclusive). */
    maxAge: z.int().min(0).max(150).optional(),
    /** Evaluation instant; defaults to the current time. Compared as a UTC calendar date. */
    now: z.date().optional(),
  })
  .refine(
    ({ minAge, maxAge }) => minAge === undefined || maxAge === undefined || minAge <= maxAge,
    { message: 'minAge must not exceed maxAge', path: ['minAge'] },
  );
export type IdAgeComparisonOptions = z.input<typeof idAgeComparisonOptionsSchema>;

export interface IdAgeComparisonInput {
  /** `YYYY-MM-DD`. */
  birthDate?: string | null | undefined;
}

/**
 * `id_age_comparison`: the holder's age must be within the template limits.
 * Not applicable without limits (`age_limits_not_configured`). With limits, an
 * invalid or future birth date fails; a missing one leaves the check without
 * evidence (`input_missing`, C29.6), which sends a required check to review.
 */
export function idAgeComparison(
  input: IdAgeComparisonInput,
  config: IdAgeComparisonOptions = {},
): CheckResult {
  const {
    minAge,
    maxAge,
    now = new Date(),
  } = parseCheckConfig(CHECK_ID, idAgeComparisonOptionsSchema, config);
  if (minAge === undefined && maxAge === undefined) {
    return checkResult(CHECK_ID, 'not_applicable', ['age_limits_not_configured']);
  }
  const limits = {
    ...(minAge === undefined ? {} : { minAge }),
    ...(maxAge === undefined ? {} : { maxAge }),
  };

  const thresholds = {
    ...(minAge === undefined ? {} : { 'min-age': minAge }),
    ...(maxAge === undefined ? {} : { 'max-age': maxAge }),
  };
  const raw = presentText(input.birthDate);
  if (raw === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], limits, { thresholds });
  }
  const birth = parseIsoDate(raw);
  if (!birth) {
    return checkResult(CHECK_ID, 'failed', ['birth_date_invalid'], limits, { thresholds });
  }
  const today = utcToday(now);
  if (daysBetween(today, birth) > 0) {
    return checkResult(CHECK_ID, 'failed', ['birth_date_in_future'], limits, { thresholds });
  }

  const age = ageOn(birth, today);
  const reasons: string[] = [];
  if (minAge !== undefined && age < minAge) {
    reasons.push('below_minimum_age');
  }
  if (maxAge !== undefined && age > maxAge) {
    reasons.push('above_maximum_age');
  }
  return checkResult(
    CHECK_ID,
    reasons.length > 0 ? 'failed' : 'passed',
    reasons,
    { age, ...limits },
    { thresholds },
  );
}
