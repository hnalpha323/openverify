/**
 * `selfie_similar_background_detection` (R, fraud, model-based, C43, C42.8): a fraud farm's room,
 * the same background behind different faces. The worker searches the nearest background rows
 * within `window-days` (other accounts) and compares up to five through `/v1/compare/background`;
 * here a candidate is verified when it meets both ORB limits (`min-orb-inliers`,
 * `min-inlier-ratio`) and its face differs from the current one (cosine below the 1:1 threshold,
 * recorded as `face-threshold`). At least `min-distinct-faces` distinct verified faces:
 * `background_seen_with_other_faces`. Advisory only (shared backdrops are common, virtual
 * backgrounds defeat it).
 *
 * Needs the matching consent (`not_consented`); a centre face, a background layout covering at
 * least `min-coverage`, and the search, else `input_missing`; a failed search: `execution_error`.
 */
import { FACE_MATCH_DEFAULTS, type CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import {
  numberIn,
  poseAnalysisOf,
  selfieCheckConfig,
  selfieModelsOf,
  selfieResultOptions,
  type SelfieContext,
} from './context.js';
import { oneToOneFaceThreshold } from './selfie-id-comparison.js';
import { round4 } from './values.js';

const CHECK_ID = 'selfie_similar_background_detection';
const KEYS = [
  'min-orb-inliers',
  'min-inlier-ratio',
  'window-days',
  'min-distinct-faces',
  'min-coverage',
] as const;

export function selfieSimilarBackgroundDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const face = oneToOneFaceThreshold(context);
  const faceThreshold = numberIn(face, 'threshold') ?? FACE_MATCH_DEFAULTS.threshold;
  const models = selfieModelsOf(context, ['faceDetector', 'faceRecognizer']);
  const options = selfieResultOptions(config, KEYS, {
    ...(models === undefined ? {} : { models }),
    thresholds: { 'face-threshold': faceThreshold },
    thresholdBasis:
      face.basis.threshold === undefined ? {} : { 'face-threshold': face.basis.threshold },
  });
  if (context.input.matchingConsent !== true) {
    return checkResult(CHECK_ID, 'not_applicable', ['not_consented'], {}, options);
  }
  const center = poseAnalysisOf(context, 'center');
  const background = center?.background ?? null;
  const search = context.input.history?.background;
  const coverage = background === null ? null : round4(background.coverage);
  const metadata: Record<string, unknown> = { coverage };
  if (
    center?.face == null ||
    background === null ||
    background.coverage < (numberIn(config, 'min-coverage') ?? 0) ||
    search === undefined
  ) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], metadata, options);
  }
  if (search.kind === 'error') {
    return checkResult(CHECK_ID, 'not_applicable', ['execution_error'], metadata, options);
  }
  const minInliers = numberIn(config, 'min-orb-inliers') ?? 0;
  const minRatio = numberIn(config, 'min-inlier-ratio') ?? 0;
  const verified = search.candidates.filter(
    (candidate) =>
      candidate.inliers >= minInliers &&
      candidate.inlierRatio >= minRatio &&
      candidate.faceCosine < faceThreshold,
  );
  const distinctFaces = new Set(verified.map((candidate) => candidate.faceGroup)).size;
  Object.assign(metadata, {
    compared: search.candidates.length,
    skipped: search.skipped,
    verified: verified.length,
    'distinct-faces': distinctFaces,
  });
  return distinctFaces >= (numberIn(config, 'min-distinct-faces') ?? 1)
    ? checkResult(CHECK_ID, 'failed', ['background_seen_with_other_faces'], metadata, options)
    : checkResult(CHECK_ID, 'passed', [], metadata, options);
}
