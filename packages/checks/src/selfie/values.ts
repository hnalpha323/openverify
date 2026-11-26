/** Small helpers the selfie evaluators share. */
import type { PoseJudgementStatus } from './cascade.js';
import type { SelfiePose } from './inputs.js';

/** Rounded to four decimals, as every score in a result. */
export const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** An object of the poses that have a value, in the order given. */
export function byPose<Value>(
  poses: readonly SelfiePose[],
  valueOf: (pose: SelfiePose) => Value | null | undefined,
): Partial<Record<SelfiePose, Value>> {
  return Object.fromEntries(
    poses.flatMap((pose) => {
      const value = valueOf(pose);
      return value == null ? [] : [[pose, value]];
    }),
  );
}

/** The poses of the judgements with `status`, in judgement order. */
export function posesWith(
  judgements: readonly { pose: SelfiePose; status: PoseJudgementStatus }[],
  status: PoseJudgementStatus,
): SelfiePose[] {
  return judgements.filter((judgement) => judgement.status === status).map(({ pose }) => pose);
}

/** `missing-poses` and `unmeasured-poses` metadata, each only when not empty. */
export function gapsMetadata(
  judgements: readonly { pose: SelfiePose; status: PoseJudgementStatus }[],
): Record<string, SelfiePose[]> {
  const missing = posesWith(judgements, 'missing');
  const unmeasured = posesWith(judgements, 'unmeasured');
  return {
    ...(missing.length === 0 ? {} : { 'missing-poses': missing }),
    ...(unmeasured.length === 0 ? {} : { 'unmeasured-poses': unmeasured }),
  };
}
