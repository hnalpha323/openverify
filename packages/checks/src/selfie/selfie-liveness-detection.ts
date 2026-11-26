/**
 * `selfie_liveness_detection` (R, fraud, model-based, C43). Three components, each `passed`,
 * `failed`, `not_requested` or `not_executed`, always in `metadata.components`:
 * - **passive:** the centre's MiniFASNet mean P(real) at or above `min-passive-score`, else
 *   `passive_liveness_low`. Not executed when the centre fails `selfie_image_quality_detection`
 *   (any reason) or vision measured none. The side poses' scores are recorded, not judged
 *   (decision 19).
 * - **active** (with side prompts): each side pose whose pose and quality passed has an SFace
 *   cosine to the centre of at least `min-side-identity-cosine`, else `pose_identity_mismatch` (the
 *   same person throughout). Order and timing are recorded as flags and only lower the confidence
 *   of a pass: a scripted client controls them.
 * - **integrity:** in production a file-path camera label or `webdriver: true` fails
 *   (`automated_capture`), and bytes equal to another capture's or inquiry's file fail
 *   (`capture_replayed`). In a sandbox those are recorded (`test-capture-device: true`) and do not
 *   fail; the component is then not executed. A label on the virtual-camera list is a flag that,
 *   when nothing failed, answers `not_applicable`/`capture_device_suspicious` (review). Without a
 *   device snapshot or the replay lookup it is not executed.
 *
 * **Outcome:** `failed` when any executed component failed; `not_applicable`/`capture_not_live`
 * without a capture or for an upload; `passed` needs the passive component passed and, with side
 * prompts, the active component passed on every prompted side; otherwise `input_missing`. Liveness
 * never fails on turn size, order, timing or image quality: an unjudged side leaves it
 * `input_missing`, and the failed user-behaviour check outranks it in the decision.
 *
 * **Confidence:** a passive failure or a pass `heuristicConfidence(1 - mean, 1 - min-passive-score,
 * coverage)`, coverage being the share of the three components executed (a sandbox-waived
 * integrity counts as not executed); an identity failure `marginConfidence(1 - cosine,
 * 1 - min-side-identity-cosine) x coverage` on the lowest cosine; an integrity failure 1; several
 * failures the highest. A pass is scaled down by 0.1 per timing flag and for a broken order (at
 * least half kept), then capped at {@link LIVENESS_PASS_CONFIDENCE_CAP} until a real
 * presentation-attack evaluation exists.
 */
import type { CheckResult } from '@openverify/core';
import { heuristicConfidence, marginConfidence } from '../government-id/heuristic.js';
import { checkResult } from '../result.js';
import { captureTimingFlags, promptOrderFollowed } from './capture-signals.js';
import {
  consistencyOf,
  numberIn,
  poseAnalysisOf,
  selfieCheckConfig,
  selfieModelsOf,
  selfieResultOptions,
  type SelfieContext,
} from './context.js';
import type { SidePose } from './inputs.js';
import { byPose, round4 } from './values.js';

const CHECK_ID = 'selfie_liveness_detection';
const KEYS = ['min-passive-score', 'min-side-identity-cosine'] as const;

/** C43: a `passed` liveness result's confidence stays at or below this. */
export const LIVENESS_PASS_CONFIDENCE_CAP = 0.6;
/** How much each timing flag, and a broken prompt order, scales down a pass (provisional). */
export const LIVENESS_TIMING_PENALTY = 0.1;
const LIVENESS_TIMING_FLOOR = 0.5;

export type LivenessComponentStatus = 'passed' | 'failed' | 'not_requested' | 'not_executed';
export interface LivenessComponents {
  passive: LivenessComponentStatus;
  active: LivenessComponentStatus;
  integrity: LivenessComponentStatus;
}

/** The integrity flags, in this order. */
const INTEGRITY_FLAGS = [
  'file-path-label',
  'webdriver',
  'virtual-camera',
  'replayed-bytes',
] as const;

const executed = (status: LivenessComponentStatus) => status === 'passed' || status === 'failed';

export function selfieLivenessDetection(context: SelfieContext): CheckResult {
  const config = selfieCheckConfig(context.template, CHECK_ID);
  const models = selfieModelsOf(context, [
    'faceDetector',
    'faceRecognizer',
    'antiSpoofV2',
    'antiSpoofV1se',
  ]);
  const options = selfieResultOptions(config, KEYS, models === undefined ? {} : { models });
  const { cascade, capture } = context;
  const center = poseAnalysisOf(context, 'center');
  const passiveMean = center?.face == null ? null : (center.passive_liveness?.mean ?? null);
  const effectiveScales = center?.passive_liveness?.effective_scales;
  const measured: Record<string, unknown> = {
    'liveness-score': passiveMean === null ? null : round4(passiveMean),
    'passive-scores': byPose(cascade.prompts, (pose) => {
      const mean = poseAnalysisOf(context, pose)?.passive_liveness?.mean;
      return mean == null ? null : round4(mean);
    }),
    ...(effectiveScales === undefined ? {} : { 'passive-effective-scales': effectiveScales }),
    'face-cosines': byPose(cascade.sidePrompts, (pose) => {
      const cosine = consistencyOf(context, pose as SidePose)?.face_cosine_to_center;
      return cosine == null ? null : round4(cosine);
    }),
    'capture-method': capture?.method ?? null,
  };
  if (capture === null || capture.method === 'upload') {
    const components: LivenessComponents = {
      passive: 'not_executed',
      active: 'not_executed',
      integrity: 'not_executed',
    };
    return checkResult(
      CHECK_ID,
      'not_applicable',
      ['capture_not_live'],
      { components, ...measured },
      options,
    );
  }

  // Passive: the centre frame, once its quality passed.
  const minPassive = numberIn(config, 'min-passive-score') ?? 0.5;
  const passive: LivenessComponentStatus =
    !cascade.centerQualityPassed || passiveMean === null
      ? 'not_executed'
      : passiveMean >= minPassive
        ? 'passed'
        : 'failed';

  // Active: the same person on every judged side pose.
  const minCosine = numberIn(config, 'min-side-identity-cosine') ?? 0.4;
  const judgedCosines = cascade.judgedSides.flatMap((side) => {
    const cosine = consistencyOf(context, side)?.face_cosine_to_center;
    return cosine == null ? [] : [cosine];
  });
  const lowestCosine = judgedCosines.length === 0 ? null : Math.min(...judgedCosines);
  let active: LivenessComponentStatus;
  if (cascade.sidePrompts.length === 0) {
    active = 'not_requested';
  } else if (lowestCosine !== null && lowestCosine < minCosine) {
    active = 'failed';
  } else {
    active = judgedCosines.length === cascade.sidePrompts.length ? 'passed' : 'not_executed';
  }

  // Integrity: the device flags and the byte replays, waived in a sandbox.
  const device = capture.device ?? null;
  const replayed = capture.replayedPoses ?? null;
  const flags = new Set<(typeof INTEGRITY_FLAGS)[number]>();
  if (device?.labelIsFilePath === true) flags.add('file-path-label');
  if (device?.webdriver === true) flags.add('webdriver');
  if (device?.virtualCamera === true) flags.add('virtual-camera');
  if (replayed !== null && replayed.length > 0) flags.add('replayed-bytes');
  const automated = flags.has('file-path-label') || flags.has('webdriver');
  const replay = flags.has('replayed-bytes');
  const sandboxWaived = context.environment === 'sandbox' && (automated || replay);
  let integrity: LivenessComponentStatus;
  const integrityReasons: string[] = [];
  if (sandboxWaived) {
    integrity = 'not_executed';
  } else if (automated || replay) {
    integrity = 'failed';
    if (automated) integrityReasons.push('automated_capture');
    if (replay) integrityReasons.push('capture_replayed');
  } else {
    integrity = device === null || replayed === null ? 'not_executed' : 'passed';
  }

  const components: LivenessComponents = { passive, active, integrity };
  const coverage = Object.values(components).filter(executed).length / 3;
  const orderFollowed = promptOrderFollowed(capture.prompts, capture.promptTimings);
  const timingFlags = captureTimingFlags(capture);
  const metadata: Record<string, unknown> = {
    components,
    ...measured,
    'judged-poses': [...cascade.judgedSides],
    'order-followed': orderFollowed,
    'timing-flags': timingFlags,
    ...(flags.size === 0
      ? {}
      : { 'integrity-flags': INTEGRITY_FLAGS.filter((flag) => flags.has(flag)) }),
    ...(replay ? { 'replayed-poses': [...(replayed ?? [])] } : {}),
    ...(sandboxWaived ? { 'test-capture-device': true } : {}),
  };
  const passiveConfidence = (mean: number) =>
    heuristicConfidence(1 - mean, 1 - minPassive, coverage);

  const reasons: string[] = [];
  const confidences: number[] = [];
  if (passive === 'failed' && passiveMean !== null) {
    reasons.push('passive_liveness_low');
    confidences.push(passiveConfidence(passiveMean));
  }
  if (active === 'failed' && lowestCosine !== null) {
    reasons.push('pose_identity_mismatch');
    confidences.push(round4(marginConfidence(1 - lowestCosine, 1 - minCosine) * coverage));
  }
  if (integrity === 'failed') {
    reasons.push(...integrityReasons);
    confidences.push(1);
  }
  if (reasons.length > 0) {
    return checkResult(CHECK_ID, 'failed', reasons, metadata, {
      ...options,
      confidence: Math.max(...confidences),
    });
  }
  const notApplicable = [
    ...(passive !== 'passed' || (cascade.sidePrompts.length > 0 && active !== 'passed')
      ? ['input_missing']
      : []),
    ...(flags.has('virtual-camera') ? ['capture_device_suspicious'] : []),
  ];
  if (notApplicable.length > 0 || passiveMean === null) {
    return checkResult(CHECK_ID, 'not_applicable', notApplicable, metadata, options);
  }
  const penalties = timingFlags.length + (orderFollowed === false ? 1 : 0);
  const timingFactor = Math.max(LIVENESS_TIMING_FLOOR, 1 - LIVENESS_TIMING_PENALTY * penalties);
  const confidence = Math.min(
    LIVENESS_PASS_CONFIDENCE_CAP,
    round4(passiveConfidence(passiveMean) * timingFactor),
  );
  return checkResult(CHECK_ID, 'passed', [], metadata, { ...options, confidence });
}
