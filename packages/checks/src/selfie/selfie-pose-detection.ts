/**
 * `selfie_pose_detection` (R, user behaviour, C43): alone judges whether each prompted pose was
 * taken as prompted (the cascade's `judgePoseDirection`). The centre is frontal (`pose_not_center`);
 * each side pose shows a face whose yaw ratio changed from the centre's by at least
 * `min-side-yaw-ratio-change` in its direction (`pose_not_left`, `pose_not_right`), the sign flipped
 * for a mirrored image. With `poses: ["center"]` only the centre is judged.
 *
 * `input_missing` for a missing file, and for a head pose vision did not measure (no landmarks):
 * never `passed` without its input. Results record the canonical face points' source among the
 * models (C39.1).
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import {
  poseAnalysisOf,
  selfieCheckConfig,
  selfieModelsOf,
  selfieResultOptions,
  type SelfieContext,
} from './context.js';
import { byPose, gapsMetadata, round4 } from './values.js';

const CHECK_ID = 'selfie_pose_detection';
const KEYS = ['max-center-yaw-ratio', 'min-side-yaw-ratio-change'] as const;
const REASONS = ['pose_not_center', 'pose_not_left', 'pose_not_right'] as const;

export function selfiePoseDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const models = selfieModelsOf(context, ['faceDetector', 'canonicalFaceMesh']);
  const options = selfieResultOptions(config, KEYS, models === undefined ? {} : { models });
  const { prompts, pose: judgements, imageMirrored } = context.cascade;
  const judged = (pose: string) => judgements.find((judgement) => judgement.pose === pose);
  const method = poseAnalysisOf(context, 'center')?.head_pose?.method ?? null;
  const metadata = {
    poses: [...prompts],
    'yaw-ratios': byPose(prompts, (pose) => {
      const yaw = judged(pose)?.yawRatio;
      return yaw == null ? null : round4(yaw);
    }),
    'yaw-ratio-changes': byPose(prompts, (pose) => {
      const change = judged(pose)?.yawRatioChange;
      return change == null ? null : round4(change);
    }),
    'image-mirrored': imageMirrored,
    ...(method === null ? {} : { 'head-pose-method': method }),
  };
  const failing = new Set(judgements.flatMap((judgement) => judgement.reason ?? []));
  if (failing.size > 0) {
    const reasons = REASONS.filter((reason) => failing.has(reason));
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
