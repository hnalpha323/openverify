/**
 * `id_portrait_clarity_detection` (R, user behaviour, model-based): the ID portrait is large,
 * sharp and unobstructed enough to compare (C32.1 `portrait_clarity`): its face box width
 * (`portrait_too_small`), the Laplacian variance of the face crop (`portrait_blurry`) and the
 * landmark score, low when part of the face is hidden (`portrait_obstructed`). An unmeasured
 * portrait has no evidence (`input_missing`); `id_portrait_detection` reports a missing one.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { checkConfigOf, modelsOf, type GovernmentIdContext } from './context.js';
import { numberOf, thresholdsOf } from './values.js';

const CHECK_ID = 'id_portrait_clarity_detection';

export function idPortraitClarityDetection(context: GovernmentIdContext): CheckResult {
  const config = checkConfigOf(context, CHECK_ID);
  const thresholds = thresholdsOf(config, [
    'min-face-width-px',
    'min-sharpness',
    'min-landmarks-score',
  ]);
  const models = modelsOf(context, ['faceDetector']);
  const options = { thresholds, ...(models === undefined ? {} : { models }) };
  const clarity = context.input.analysis.sides.front.portrait_clarity ?? null;
  if (clarity === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const below = (value: number, key: string): boolean => {
    const minimum = numberOf(config, key);
    return minimum !== undefined && value < minimum;
  };
  const reasons = [
    ...(below(clarity.face_width_px, 'min-face-width-px') ? ['portrait_too_small'] : []),
    ...(below(clarity.sharpness, 'min-sharpness') ? ['portrait_blurry'] : []),
    ...(below(clarity.landmarks_score, 'min-landmarks-score') ? ['portrait_obstructed'] : []),
  ];
  return checkResult(
    CHECK_ID,
    reasons.length === 0 ? 'passed' : 'failed',
    reasons,
    {
      'face-width-px': clarity.face_width_px,
      sharpness: clarity.sharpness,
      'landmarks-score': clarity.landmarks_score,
    },
    options,
  );
}
