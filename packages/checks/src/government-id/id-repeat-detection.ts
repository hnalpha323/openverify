/**
 * `id_repeat_detection` (R, fraud): the ID number or the front image was used before by another
 * account in the same environment (C34). The worker looks the candidates up (the blind index, and
 * the pHash bands within `max-phash-distance`) and passes them in; this check judges them.
 * - `id_repeat_detected`: a candidate of another account with the same number, or a front pHash
 *   within `max-phash-distance` bits. The pHash half runs only once `max-phash-distance` is set:
 *   it ships without a default until the calibration report shows a margin (C34).
 * - `input_missing`: the worker did not look the history up, or could run neither lookup.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { checkConfigOf, type GovernmentIdContext } from './context.js';
import { numberOf } from './values.js';

const CHECK_ID = 'id_repeat_detection';

export function idRepeatDetection(context: GovernmentIdContext): CheckResult {
  const maxDistance = numberOf(checkConfigOf(context, CHECK_ID), 'max-phash-distance');
  const thresholds =
    maxDistance === undefined ? { 'phash-matching': false } : { 'max-phash-distance': maxDistance };
  const history = context.input.history?.repeat;
  const number = context.extraction.consolidated.fields['identification-number'];
  const phash = context.input.analysis.sides.front.phash ?? null;
  const byNumber = history?.identificationNumberLookup === true && number !== null;
  const byImage = history?.phashLookup === true && maxDistance !== undefined && phash !== null;
  if (history === undefined || (!byNumber && !byImage)) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, { thresholds });
  }
  const lookups = [...(byNumber ? ['identification-number'] : []), ...(byImage ? ['image'] : [])];
  const matchedBy = new Set<string>();
  const matches = history.candidates.filter((candidate) => {
    if (candidate.sameAccount) {
      return false;
    }
    const sameNumber = byNumber && candidate.sameIdentificationNumber;
    const sameImage =
      byImage && candidate.phashDistance !== null && candidate.phashDistance <= maxDistance;
    if (sameNumber) {
      matchedBy.add('identification-number');
    }
    if (sameImage) {
      matchedBy.add('image');
    }
    return sameNumber || sameImage;
  });
  if (matches.length === 0) {
    return checkResult(CHECK_ID, 'passed', [], { matches: 0, lookups }, { thresholds });
  }
  return checkResult(
    CHECK_ID,
    'failed',
    ['id_repeat_detected'],
    {
      matches: matches.length,
      lookups,
      'matched-by': ['identification-number', 'image'].filter((name) => matchedBy.has(name)),
      'matched-verification-ids': matches.map((candidate) => candidate.verificationId),
    },
    { thresholds },
  );
}
