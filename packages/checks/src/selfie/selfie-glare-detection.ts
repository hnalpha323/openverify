/**
 * `selfie_glare_detection` (R, user behaviour, C43): the saturated share of the centre face region
 * without the eye regions (C41.1 `face_quality.glare_ratio`) above `max-face-glare-ratio` fails
 * (`face_glare`). Without a centre face or its measured region: `input_missing`.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import {
  numberIn,
  poseAnalysisOf,
  selfieCheckConfig,
  selfieModelsOf,
  selfieResultOptions,
  type SelfieContext,
} from './context.js';
import { round4 } from './values.js';

const CHECK_ID = 'selfie_glare_detection';
const KEY = 'max-face-glare-ratio';

export function selfieGlareDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const models = selfieModelsOf(context, ['faceDetector']);
  const options = selfieResultOptions(config, [KEY], models === undefined ? {} : { models });
  const center = poseAnalysisOf(context, 'center');
  const region = center?.face == null ? null : (center.face_quality ?? null);
  const max = numberIn(config, KEY);
  if (region === null || max === undefined) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const metadata = { 'face-glare-ratio': round4(region.glare_ratio) };
  return region.glare_ratio > max
    ? checkResult(CHECK_ID, 'failed', ['face_glare'], metadata, options)
    : checkResult(CHECK_ID, 'passed', [], metadata, options);
}
