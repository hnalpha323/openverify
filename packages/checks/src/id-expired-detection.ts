import type { CheckId, CheckResult } from '@openverify/core';
import { z } from 'zod';
import type { DocumentFeatures } from './data/feature-table.js';
import { daysBetween, parseIsoDate, utcToday } from './dates.js';
import { checkResult, parseCheckConfig, presentText } from './result.js';

const CHECK_ID = 'id_expired_detection';

/** Internal options; templates set the kebab-case `grace-days` (C29.5). */
export const idExpiredOptionsSchema = z.strictObject({
  /** Days after expiration during which the document is still accepted. */
  graceDays: z.int().min(0).max(3650).default(0),
  /** Evaluation instant; defaults to the current time. Compared as a UTC calendar date. */
  now: z.date().optional(),
});
export type IdExpiredOptions = z.input<typeof idExpiredOptionsSchema>;

export interface IdExpiredInput {
  /** `YYYY-MM-DD`. */
  expirationDate?: string | null | undefined;
  /** The feature row of the established class (C33), or `null` without one. */
  features?: DocumentFeatures | null | undefined;
}

export interface ExpiryJudgement {
  checkId: CheckId;
  expirationDate: string | null | undefined;
  graceDays: number;
  now: Date;
  /** The reason without an expiration date. */
  missing: 'input_missing' | 'feature_absent';
  metadata: (daysPast: number) => Record<string, unknown>;
}

/**
 * Judges an expiration date: valid through its day, then `grace-days` more
 * (`expired_within_grace_period`), then `expired`; an unreadable date fails; none answers
 * `missing`. Shared by `id_expired_detection` and `id_nfc_expired_detection`.
 */
export function judgeExpiry(judgement: ExpiryJudgement): CheckResult {
  const { checkId, graceDays, now, metadata } = judgement;
  const thresholds = { 'grace-days': graceDays };
  const raw = presentText(judgement.expirationDate);
  if (raw === null) {
    return checkResult(checkId, 'not_applicable', [judgement.missing], {}, { thresholds });
  }
  const expiration = parseIsoDate(raw);
  if (!expiration) {
    return checkResult(checkId, 'failed', ['expiration_date_invalid'], {}, { thresholds });
  }
  const daysPast = daysBetween(expiration, utcToday(now));
  const details = metadata(Math.max(0, daysPast));
  if (daysPast <= 0) {
    return checkResult(checkId, 'passed', [], details, { thresholds });
  }
  if (daysPast <= graceDays) {
    return checkResult(checkId, 'passed', ['expired_within_grace_period'], details, { thresholds });
  }
  return checkResult(checkId, 'failed', ['expired'], details, { thresholds });
}

/**
 * `id_expired_detection`: fails once the document is past its expiration date plus the grace
 * period. A document is valid through its expiration day. Without an expiration date (C29.6):
 * `feature_absent` for an established class the C33 feature table marks as having none,
 * otherwise `input_missing`. An unreadable one fails.
 */
export function idExpiredDetection(
  input: IdExpiredInput,
  options: IdExpiredOptions = {},
): CheckResult {
  const { graceDays, now = new Date() } = parseCheckConfig(
    CHECK_ID,
    idExpiredOptionsSchema,
    options,
  );
  return judgeExpiry({
    checkId: CHECK_ID,
    expirationDate: input.expirationDate,
    graceDays,
    now,
    missing: input.features?.expiry === false ? 'feature_absent' : 'input_missing',
    metadata: (daysPast) => ({ graceDays, daysPastExpiration: daysPast }),
  });
}
