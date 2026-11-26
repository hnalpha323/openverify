/**
 * `selfie_glasses_detection` (H, user behaviour, C43): glasses on the centre face, from vision's
 * multi-cue glasses score (C41.1 `occlusion`, research §6: bridge edges, lower-rim edges and lens
 * highlights; no single nose-bridge statistic, plan decision 12). A score above
 * `max-glasses-score` fails (`glasses_detected`), with a retry hint. Without a centre face or the
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

const CHECK_ID = 'selfie_glasses_detection';
const KEY = 'max-glasses-score';

export function selfieGlassesDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const models = selfieModelsOf(context, ['faceDetector']);
  const options = selfieResultOptions(config, [KEY], models === undefined ? {} : { models });
  const center = poseAnalysisOf(context, 'center');
  const glasses = center?.face == null ? null : (center.occlusion?.glasses ?? null);
  const threshold = numberIn(config, KEY);
  if (glasses === null || threshold === undefined) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const metadata = {
    score: round4(glasses.score),
    components: {
      'rim-edge-energy': round4(glasses.rim_edge_energy),
      'lens-highlight-ratio': round4(glasses.lens_highlight_ratio),
      'bridge-edge-density': round4(glasses.bridge_edge_density),
    },
  };
  const confidence = heuristicConfidence(glasses.score, threshold, 1);
  return glasses.score > threshold
    ? checkResult(CHECK_ID, 'failed', ['glasses_detected'], metadata, { ...options, confidence })
    : checkResult(CHECK_ID, 'passed', [], metadata, { ...options, confidence });
}
