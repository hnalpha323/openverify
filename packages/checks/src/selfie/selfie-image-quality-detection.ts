/**
 * `selfie_image_quality_detection` (v2, R, user behaviour, C43): whether every prompted pose is
 * usable (the cascade's `judgePoseQuality`). Each pose shows a face (`face_not_present`, the pose named in
 * metadata) whose region is sharp enough (`image_blurry`); the centre also passes the Phase 1
 * whole-image blur and brightness, the face size (`face_too_small`) and the image's short side
 * (`resolution_too_low`). A missing file or a measurement vision did not return answers
 * `not_applicable`/`input_missing` unless a pose failed: never `passed` without its input.
 *
 * Metadata keeps the Phase 1 centre keys (`blur_score`, `brightness`, `face_present`), each pose's
 * face blur, and the centre face box normalised to [0, 1] (`face-box`, `[x, y, width, height]`),
 * the one box C39.4 allows (C40.10 derives `center-photo-face-coordinates` from it).
 */
import type { CheckResult } from '@openverify/core';
import type { SelfiePoseAnalysisInput } from '../phase1/inputs.js';
import { checkResult } from '../result.js';
import { SELFIE_QUALITY_REASONS } from './cascade.js';
import {
  poseAnalysisOf,
  selfieCheckConfig,
  selfieModelsOf,
  selfieResultOptions,
  type SelfieContext,
} from './context.js';
import { byPose, clamp01, gapsMetadata, round4 } from './values.js';

const CHECK_ID = 'selfie_image_quality_detection';
const KEYS = [
  'min-blur-score',
  'min-brightness',
  'max-brightness',
  'min-face-blur-score',
  'min-face-width-px',
  'min-face-height-ratio',
  'min-image-short-side-px',
] as const;

/** The centre face box as shares of the image, `[x, y, width, height]`; `null` without both. */
function normalisedFaceBox(center: SelfiePoseAnalysisInput | null): number[] | null {
  const image = center?.image ?? null;
  const box = center?.face == null ? null : (center.face_quality?.box ?? center.face.bbox);
  if (image == null || box == null || image.width <= 0 || image.height <= 0) {
    return null;
  }
  const [x = 0, y = 0, width = 0, height = 0] = box;
  return [x / image.width, y / image.height, width / image.width, height / image.height].map(
    (value) => round4(clamp01(value)),
  );
}

export function selfieImageQualityDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const { prompts, quality: judgements } = context.cascade;
  const center = poseAnalysisOf(context, 'center');
  const faceBox = normalisedFaceBox(center);
  const models = selfieModelsOf(context, ['faceDetector']);
  const options = selfieResultOptions(config, KEYS, models === undefined ? {} : { models });
  const metadata: Record<string, unknown> = {
    blur_score: center?.quality.blur_score ?? null,
    brightness: center?.quality.brightness ?? null,
    face_present: center?.face != null,
    'face-blur-scores': byPose(prompts, (pose) => {
      const entry = poseAnalysisOf(context, pose);
      const score = entry?.face == null ? null : entry.face_quality?.blur_score;
      return score == null ? null : round4(score);
    }),
    ...(faceBox === null ? {} : { 'face-box': faceBox }),
  };
  const failed = judgements.filter((judgement) => judgement.status === 'failed');
  if (failed.length > 0) {
    const reasons = SELFIE_QUALITY_REASONS.filter((reason) =>
      failed.some((judgement) => judgement.reasons.includes(reason)),
    );
    metadata['pose-reasons'] = byPose(
      failed.map(({ pose }) => pose),
      (pose) => failed.find((judgement) => judgement.pose === pose)?.reasons,
    );
    return checkResult(CHECK_ID, 'failed', reasons, metadata, options);
  }
  const gaps = gapsMetadata(judgements);
  if (Object.keys(gaps).length > 0) {
    return checkResult(
      CHECK_ID,
      'not_applicable',
      ['input_missing'],
      { ...metadata, ...gaps },
      options,
    );
  }
  return checkResult(CHECK_ID, 'passed', [], metadata, options);
}
