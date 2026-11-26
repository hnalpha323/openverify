/**
 * `selfie_pose_repeat_detection` (R, fraud, model-based, C43): a static replay (a held photo or
 * screen, or one still fed through a virtual camera) on the side poses whose pose and quality
 * passed (the cascade's `judgedSides`), each against the centre (research §7):
 * - the median homography residual of the tracked face points below `min-planarity-residual`
 *   (a share of face width) is planar motion (`planar_motion`); it counts only with at least
 *   `min-tracked-points`, else the planarity is recorded as unmeasured;
 * - an SFace cosine to the centre at or above `max-pose-cosine` is the same frame
 *   (`pose_frames_identical`);
 * - vision's duplicate flag is a duplicate frame (`duplicate_frame`).
 *
 * A centre-only step: `not_applicable`/`not_requested`. No side judged (its pose failed), the
 * centre's quality failed (its reference frame is unusable; the failed user-behaviour check gives
 * the retry), or a judged side with no measurement: `input_missing`.
 *
 * Confidence: a failure, the strongest signal (a duplicate 1; identical frames
 * `marginConfidence(cosine, max-pose-cosine)`; planar motion the residual's distance below the
 * threshold as a share of it); a pass, `0.5 + 0.5 x` the share of the three signals measured on the
 * judged sides.
 */
import type { CheckResult } from '@openverify/core';
import { marginConfidence } from '../government-id/heuristic.js';
import { checkResult } from '../result.js';
import {
  consistencyOf,
  numberIn,
  selfieCheckConfig,
  selfieModelsOf,
  selfieResultOptions,
  type SelfieContext,
} from './context.js';
import type { SidePose } from './inputs.js';
import { byPose, clamp01, round4 } from './values.js';

const CHECK_ID = 'selfie_pose_repeat_detection';
const KEYS = ['min-planarity-residual', 'min-tracked-points', 'max-pose-cosine'] as const;
const REASONS = ['planar_motion', 'pose_frames_identical', 'duplicate_frame'] as const;
type Reason = (typeof REASONS)[number];

interface SideSignals {
  reasons: Reason[];
  confidences: number[];
  measured: number;
  planarityMeasured: boolean;
}

export function selfiePoseRepeatDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const models = selfieModelsOf(context, ['faceDetector', 'faceRecognizer']);
  const options = selfieResultOptions(config, KEYS, models === undefined ? {} : { models });
  const { cascade } = context;
  if (cascade.sidePrompts.length === 0) {
    return checkResult(CHECK_ID, 'not_applicable', ['not_requested'], {}, options);
  }
  const judged = cascade.centerQualityPassed ? cascade.judgedSides : [];
  const minResidual = numberIn(config, 'min-planarity-residual') ?? 0;
  const minPoints = numberIn(config, 'min-tracked-points') ?? 0;
  const maxCosine = numberIn(config, 'max-pose-cosine') ?? 1;
  const consistency = (pose: SidePose) => consistencyOf(context, pose);

  const signals = new Map<SidePose, SideSignals>();
  for (const side of judged) {
    const entry = consistency(side);
    const result: SideSignals = {
      reasons: [],
      confidences: [],
      measured: 0,
      planarityMeasured: false,
    };
    const cosine = entry?.face_cosine_to_center ?? null;
    if (cosine !== null) {
      result.measured += 1;
      if (cosine >= maxCosine) {
        result.reasons.push('pose_frames_identical');
        result.confidences.push(marginConfidence(cosine, maxCosine));
      }
    }
    const duplicate = entry?.duplicate_of_center ?? null;
    if (duplicate !== null) {
      result.measured += 1;
      if (duplicate) {
        result.reasons.push('duplicate_frame');
        result.confidences.push(1);
      }
    }
    const planarity = entry?.planarity ?? null;
    if (planarity !== null && planarity.tracked_points >= minPoints) {
      result.measured += 1;
      result.planarityMeasured = true;
      if (planarity.median_residual_ratio < minResidual) {
        result.reasons.push('planar_motion');
        result.confidences.push(
          round4(clamp01((minResidual - planarity.median_residual_ratio) / minResidual)),
        );
      }
    }
    signals.set(side, result);
  }

  const sideMetadata = <Value>(valueOf: (side: SidePose) => Value | null | undefined) =>
    byPose(judged, (pose) => valueOf(pose as SidePose));
  const duplicates = judged.filter((side) => consistency(side)?.duplicate_of_center === true);
  const unmeasuredPlanarity = judged.filter(
    (side) => signals.get(side)?.planarityMeasured !== true,
  );
  const metadata = {
    'judged-poses': [...judged],
    'face-cosines': sideMetadata((side) => {
      const cosine = consistency(side)?.face_cosine_to_center;
      return cosine == null ? null : round4(cosine);
    }),
    'planarity-residuals': sideMetadata((side) => {
      const residual = consistency(side)?.planarity?.median_residual_ratio;
      return residual == null ? null : round4(residual);
    }),
    'tracked-points': sideMetadata((side) => consistency(side)?.planarity?.tracked_points),
    'registered-ssim': sideMetadata((side) => {
      const ssim = consistency(side)?.registered_ssim;
      return ssim == null ? null : round4(ssim);
    }),
    ...(duplicates.length === 0 ? {} : { 'duplicate-poses': duplicates }),
    ...(unmeasuredPlanarity.length === 0 ? {} : { 'planarity-unmeasured': unmeasuredPlanarity }),
  };

  const all = [...signals.values()];
  const failing = new Set(all.flatMap((side) => side.reasons));
  if (failing.size > 0) {
    return checkResult(
      CHECK_ID,
      'failed',
      REASONS.filter((reason) => failing.has(reason)),
      metadata,
      { ...options, confidence: Math.max(...all.flatMap((side) => side.confidences)) },
    );
  }
  if (judged.length === 0 || all.some((side) => side.measured === 0)) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], metadata, options);
  }
  const coverage = all.reduce((sum, side) => sum + side.measured, 0) / (3 * all.length);
  return checkResult(CHECK_ID, 'passed', [], metadata, {
    ...options,
    confidence: round4(0.5 + 0.5 * coverage),
  });
}
