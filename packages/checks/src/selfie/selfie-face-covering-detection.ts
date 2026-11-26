/**
 * `selfie_face_covering_detection` (v2, H, user behaviour, C43): a mask, scarf or hand over the
 * lower face, from vision's landmark-region covering score on the centre (C41.1 `occlusion`,
 * research §6: the lower face's skin share, texture and colour against the same person's
 * forehead). A score above `max-face-covering-score` fails (`face_covered`), with a retry hint,
 * since the user can remove the covering. Without a valid forehead reference, a centre face or the
 * measurement: `input_missing`. Beta, with a margin-based confidence.
 */
import type { CheckResult } from '@openverify/core';
import { heuristicConfidence } from '../government-id/heuristic.js';
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

const CHECK_ID = 'selfie_face_covering_detection';
const KEY = 'max-face-covering-score';

export function selfieFaceCoveringDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const models = selfieModelsOf(context, ['faceDetector']);
  const options = selfieResultOptions(config, [KEY], models === undefined ? {} : { models });
  const center = poseAnalysisOf(context, 'center');
  const covering = center?.face == null ? null : (center.occlusion?.covering ?? null);
  const threshold = numberIn(config, KEY);
  if (covering === null || !covering.forehead_valid || threshold === undefined) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const metadata = {
    score: round4(covering.score),
    components: {
      'skin-fraction-ratio': round4(covering.skin_fraction_ratio),
      'texture-ratio': round4(covering.texture_ratio),
      'delta-e': round4(covering.delta_e),
    },
  };
  const confidence = heuristicConfidence(covering.score, threshold, 1);
  return covering.score > threshold
    ? checkResult(CHECK_ID, 'failed', ['face_covered'], metadata, { ...options, confidence })
    : checkResult(CHECK_ID, 'passed', [], metadata, { ...options, confidence });
}
