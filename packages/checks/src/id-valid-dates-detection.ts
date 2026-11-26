import type { CheckResult } from '@openverify/core';
import { z } from 'zod';
import { ageOn, daysBetween, parseIsoDate, utcToday, type CalendarDate } from './dates.js';
import { checkResult, parseCheckConfig, presentText } from './result.js';

const CHECK_ID = 'id_valid_dates_detection';

export const idValidDatesOptionsSchema = z.strictObject({
  /** Holders this old or older are implausible. */
  maxAgeYears: z.int().min(1).max(200).default(130),
  /** Longest plausible span from issue to expiry (C29.5 `max-validity-years`). */
  maxValidityYears: z.int().min(1).max(20).optional(),
  /** Evaluation instant; defaults to the current time. Compared as a UTC calendar date. */
  now: z.date().optional(),
});
export type IdValidDatesOptions = z.input<typeof idValidDatesOptionsSchema>;

export interface IdValidDatesInput {
  /** `YYYY-MM-DD`. */
  birthDate?: string | null | undefined;
  /** `YYYY-MM-DD`. */
  issueDate?: string | null | undefined;
  /** `YYYY-MM-DD`. */
  expirationDate?: string | null | undefined;
}

type DateField = 'birth_date' | 'issue_date' | 'expiration_date';

/**
 * `id_valid_dates_detection`: every date present must be a real calendar
 * date, birth < issue < expiration, neither birth nor issue in the future, the
 * holder younger than `maxAgeYears`, and, with `maxValidityYears` (C29.5
 * `max-validity-years`), the span from issue to expiry no longer than that.
 * Rules involving an absent or invalid date are skipped. Without any date the
 * check has no evidence (`input_missing`, C29.6).
 */
export function idValidDatesDetection(
  input: IdValidDatesInput,
  config: IdValidDatesOptions = {},
): CheckResult {
  const {
    maxAgeYears,
    maxValidityYears,
    now = new Date(),
  } = parseCheckConfig(CHECK_ID, idValidDatesOptionsSchema, config);
  const raw: [DateField, string | null][] = [
    ['birth_date', presentText(input.birthDate)],
    ['issue_date', presentText(input.issueDate)],
    ['expiration_date', presentText(input.expirationDate)],
  ];
  const thresholds = {
    'max-age-years': maxAgeYears,
    ...(maxValidityYears === undefined ? {} : { 'max-validity-years': maxValidityYears }),
  };
  if (raw.every(([, value]) => value === null)) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, { thresholds });
  }

  const reasons: string[] = [];
  const dates = new Map<DateField, CalendarDate>();
  for (const [field, value] of raw) {
    if (value !== null) {
      const date = parseIsoDate(value);
      if (date) {
        dates.set(field, date);
      } else {
        reasons.push(`${field}_invalid`);
      }
    }
  }

  const today = utcToday(now);
  const birth = dates.get('birth_date');
  const issue = dates.get('issue_date');
  const expiration = dates.get('expiration_date');
  const before = (a: CalendarDate, b: CalendarDate): boolean => daysBetween(a, b) > 0;

  if (birth && before(today, birth)) {
    reasons.push('birth_date_in_future');
  }
  if (issue && before(today, issue)) {
    reasons.push('issue_date_in_future');
  }
  if (birth && issue && !before(birth, issue)) {
    reasons.push('birth_date_not_before_issue_date');
  }
  if (issue && expiration && !before(issue, expiration)) {
    reasons.push('issue_date_not_before_expiration_date');
  }
  if (birth && expiration && !issue && !before(birth, expiration)) {
    reasons.push('birth_date_not_before_expiration_date');
  }
  if (birth && ageOn(birth, today) >= maxAgeYears) {
    reasons.push('age_exceeds_maximum');
  }
  if (issue && expiration && maxValidityYears !== undefined) {
    // The same calendar day `maxValidityYears` later; 29 February rolls to 1 March.
    const latest = parseIsoDate(
      `${String(issue.year + maxValidityYears).padStart(4, '0')}-${String(issue.month).padStart(2, '0')}-${String(issue.day).padStart(2, '0')}`,
    ) ?? { year: issue.year + maxValidityYears, month: 3, day: 1 };
    if (before(latest, expiration)) {
      reasons.push('validity_period_too_long');
    }
  }

  return checkResult(
    CHECK_ID,
    reasons.length > 0 ? 'failed' : 'passed',
    reasons,
    { maxAgeYears },
    { thresholds },
  );
}
