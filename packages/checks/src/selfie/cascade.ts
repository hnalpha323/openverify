/**
 * The C43 cascade: one user mistake fails one user-behaviour check, so `decideVerification` keeps
 * the verification retryable (C30.1).
 * - `selfie_pose_detection` alone judges whether each pose was taken as prompted
 *   ({@link judgePoseDirection});
 * - `selfie_image_quality_detection` judges whether each pose is usable
 *   ({@link judgePoseQuality});
 * - `selfie_liveness_detection` and `selfie_pose_repeat_detection` judge only the side poses whose
 *   pose and face-region quality passed (`judgedSides`).
 *
 * The judgements are computed from the measurements and the two checks' effective config, whether
 * or not the template enables those checks, so liveness can never pass on an unjudged side.
 */
import type { VerificationTemplateConfig } from '@openverify/core';
import type { SelfieAnalysisInput, SelfiePoseAnalysisInput } from '../phase1/inputs.js';
import { orientedYawRatio } from './capture-signals.js';
import { numberIn, selfieCheckConfig, type SelfieCheckConfig } from './config.js';
import { SELFIE_POSES, type SelfieCaptureInput, type SelfiePose, type SidePose } from './inputs.js';

/**
 * - `passed`: judged and fine;
 * - `failed`: judged and wrong (the user's mistake);
 * - `unmeasured`: the file is there but vision did not measure what the judgement needs;
 * - `missing`: no file for a prompted pose.
 */
export type PoseJudgementStatus = 'passed' | 'failed' | 'unmeasured' | 'missing';

/** Whether a pose is usable (`selfie_image_quality_detection`'s reasons for this pose). */
export interface PoseQualityJudgement {
  pose: SelfiePose;
  status: PoseJudgementStatus;
  reasons: readonly string[];
}

/** Whether a pose was taken as prompted (`selfie_pose_detection`). */
export interface PoseDirectionJudgement {
  pose: SelfiePose;
  status: PoseJudgementStatus;
  /** `pose_not_center`, `pose_not_left` or `pose_not_right` when failed. */
  reason: string | null;
  /** The pose's yaw ratio, oriented for a mirrored image; `null` when not measured. */
  yawRatio: number | null;
  /** A side pose's yaw-ratio change from the centre; `null` for the centre or unmeasured. */
  yawRatioChange: number | null;
}

export interface SelfieCascade {
  /** The prompted poses: the capture's, else the poses analysed. */
  prompts: readonly SelfiePose[];
  sidePrompts: readonly SidePose[];
  quality: readonly PoseQualityJudgement[];
  pose: readonly PoseDirectionJudgement[];
  centerQualityPassed: boolean;
  /** Prompted side poses whose pose and face-region quality passed. */
  judgedSides: readonly SidePose[];
  imageMirrored: boolean;
}

/** The `selfie_image_quality_detection` reasons, in the order a result lists them. */
export const SELFIE_QUALITY_REASONS = Object.freeze([
  'face_not_present',
  'image_blurry',
  'image_too_dark',
  'image_too_bright',
  'face_too_small',
  'resolution_too_low',
] as const);

const isSide = (pose: SelfiePose): pose is SidePose => pose !== 'center';

const poseOf = (analysis: SelfieAnalysisInput, pose: SelfiePose): SelfiePoseAnalysisInput | null =>
  analysis.poses[pose] ?? null;

/** The prompted poses: the capture's prompts, else the poses present in the analysis. */
export function promptedPoses(
  analysis: SelfieAnalysisInput,
  capture: SelfieCaptureInput | null,
): readonly SelfiePose[] {
  if (capture !== null) {
    return [...capture.prompts];
  }
  return SELFIE_POSES.filter((pose) => pose === 'center' || poseOf(analysis, pose) !== null);
}

/** At or above a set minimum; `true` when no minimum is set. */
const atLeast = (value: number, minimum: number | undefined) =>
  minimum === undefined || value >= minimum;

/**
 * Judges whether `pose` is usable, with the image quality check's effective config (C43):
 * - every pose: a face is present (`face_not_present`) and its region is sharp enough
 *   (`min-face-blur-score`, `image_blurry`);
 * - the centre also: the Phase 1 whole-image blur and brightness (vision's verdicts, or the
 *   configured `min-blur-score`, `min-brightness`, `max-brightness`), the face size
 *   (`min-face-width-px`, `min-face-height-ratio`: `face_too_small`) and the image's short side
 *   (`min-image-short-side-px`: `resolution_too_low`).
 *
 * A measurement vision did not return leaves the pose `unmeasured` unless another reason failed it.
 */
export function judgePoseQuality(
  analysis: SelfieAnalysisInput,
  pose: SelfiePose,
  config: SelfieCheckConfig,
): PoseQualityJudgement {
  const entry = poseOf(analysis, pose);
  if (entry === null) {
    return { pose, status: 'missing', reasons: [] };
  }
  const failed = new Set<string>();
  let unmeasured = false;
  const faceQuality = entry.face === null ? null : (entry.face_quality ?? null);
  if (entry.face === null) {
    failed.add('face_not_present');
  } else if (faceQuality === null) {
    unmeasured = true;
  } else if (!atLeast(faceQuality.blur_score, numberIn(config, 'min-face-blur-score'))) {
    failed.add('image_blurry');
  }
  if (pose === 'center') {
    const { quality } = entry;
    const minBlur = numberIn(config, 'min-blur-score');
    const minBrightness = numberIn(config, 'min-brightness');
    const maxBrightness = numberIn(config, 'max-brightness');
    if (minBlur === undefined ? quality.is_blurry : quality.blur_score < minBlur) {
      failed.add('image_blurry');
    }
    if (minBrightness === undefined ? quality.is_too_dark : quality.brightness < minBrightness) {
      failed.add('image_too_dark');
    }
    if (maxBrightness === undefined ? quality.is_too_bright : quality.brightness > maxBrightness) {
      failed.add('image_too_bright');
    }
    if (
      faceQuality !== null &&
      (!atLeast(faceQuality.width_px, numberIn(config, 'min-face-width-px')) ||
        !atLeast(faceQuality.height_ratio, numberIn(config, 'min-face-height-ratio')))
    ) {
      failed.add('face_too_small');
    }
    const image = entry.image ?? null;
    if (image === null) {
      unmeasured = true;
    } else if (
      !atLeast(Math.min(image.width, image.height), numberIn(config, 'min-image-short-side-px'))
    ) {
      failed.add('resolution_too_low');
    }
  }
  const reasons = SELFIE_QUALITY_REASONS.filter((reason) => failed.has(reason));
  return {
    pose,
    status: reasons.length > 0 ? 'failed' : unmeasured ? 'unmeasured' : 'passed',
    reasons,
  };
}

/** The oriented yaw ratio of a pose with a face and a measured head pose, else `null`. */
function yawOf(entry: SelfiePoseAnalysisInput | null, imageMirrored: boolean): number | null {
  const head = entry?.face == null ? null : (entry.head_pose ?? null);
  return head === null ? null : orientedYawRatio(head.yaw_ratio, imageMirrored);
}

/**
 * Judges whether `pose` was taken as prompted, with the pose check's effective config (C43):
 * the centre is frontal (`|yaw_ratio|` at most `max-center-yaw-ratio`, else `pose_not_center`);
 * a side pose's yaw ratio changed from the centre's by at least `min-side-yaw-ratio-change` in its
 * direction (the user's left is positive, C41.1; the sign flips for a mirrored image), else
 * `pose_not_left`/`pose_not_right`. A pose without a face fails; a missing file is `missing`; a
 * head pose vision did not measure, or a side without a centre to compare with, is `unmeasured`.
 */
export function judgePoseDirection(
  analysis: SelfieAnalysisInput,
  pose: SelfiePose,
  config: SelfieCheckConfig,
  imageMirrored: boolean,
): PoseDirectionJudgement {
  const entry = poseOf(analysis, pose);
  const reason = `pose_not_${pose}`;
  const judgement = (
    status: PoseJudgementStatus,
    yawRatio: number | null = null,
    yawRatioChange: number | null = null,
  ): PoseDirectionJudgement => ({
    pose,
    status,
    reason: status === 'failed' ? reason : null,
    yawRatio,
    yawRatioChange,
  });
  if (entry === null) {
    return judgement('missing');
  }
  if (entry.face === null) {
    return judgement('failed');
  }
  const yaw = yawOf(entry, imageMirrored);
  if (yaw === null) {
    return judgement('unmeasured');
  }
  if (pose === 'center') {
    const max = numberIn(config, 'max-center-yaw-ratio');
    if (max === undefined) {
      return judgement('unmeasured', yaw);
    }
    return judgement(Math.abs(yaw) <= max ? 'passed' : 'failed', yaw);
  }
  const centerYaw = yawOf(poseOf(analysis, 'center'), imageMirrored);
  const min = numberIn(config, 'min-side-yaw-ratio-change');
  if (centerYaw === null || min === undefined) {
    return judgement('unmeasured', yaw);
  }
  const change = yaw - centerYaw;
  const turned = pose === 'left' ? change >= min : -change >= min;
  return judgement(turned ? 'passed' : 'failed', yaw, change);
}

/**
 * The cascade of one verification.
 * @throws {InvalidCheckConfigError} when the pose or image quality check's config breaks its
 * schema.
 */
export function selfieCascade(
  analysis: SelfieAnalysisInput,
  capture: SelfieCaptureInput | null,
  template: VerificationTemplateConfig,
): SelfieCascade {
  const prompts = promptedPoses(analysis, capture);
  const imageMirrored = capture?.device?.imageMirrored === true;
  const qualityConfig = selfieCheckConfig(template, 'selfie_image_quality_detection');
  const poseConfig = selfieCheckConfig(template, 'selfie_pose_detection');
  const quality = prompts.map((pose) => judgePoseQuality(analysis, pose, qualityConfig));
  const pose = prompts.map((entry) =>
    judgePoseDirection(analysis, entry, poseConfig, imageMirrored),
  );
  const passed = (
    judgements: readonly { pose: SelfiePose; status: PoseJudgementStatus }[],
    of: SelfiePose,
  ) => judgements.find((judgement) => judgement.pose === of)?.status === 'passed';
  const sidePrompts = prompts.filter(isSide);
  return {
    prompts,
    sidePrompts,
    quality,
    pose,
    centerQualityPassed: passed(quality, 'center'),
    judgedSides: sidePrompts.filter((side) => passed(quality, side) && passed(pose, side)),
    imageMirrored,
  };
}
