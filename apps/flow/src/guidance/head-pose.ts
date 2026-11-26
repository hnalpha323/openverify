/**
 * The yaw ratio of a face (C41.1), as the vision service measures it: the nose tip's offset from
 * the eye midpoint along the eye line, divided by the inter-ocular distance. Rolling the head
 * does not change it. In the raw, unmirrored camera image a turn to the user's own left moves
 * the nose toward the image's right, so the ratio grows.
 */
import type { Point } from './yunet-decode';

/** YuNet's five landmarks. */
const LANDMARKS = 5;

/** Below this inter-ocular distance (pixels) the eyes count as coinciding. */
const EYE_DISTANCE_EPSILON = 1e-6;

/** The yaw ratio of five YuNet landmarks, or `null` without them or when the eyes coincide. */
export function yawRatio(landmarks: readonly Point[]): number | null {
  const [rightEye, leftEye, nose] = landmarks;
  if (landmarks.length !== LANDMARKS || !rightEye || !leftEye || !nose) {
    return null;
  }
  const dx = leftEye[0] - rightEye[0];
  const dy = leftEye[1] - rightEye[1];
  const distance = Math.hypot(dx, dy);
  if (distance < EYE_DISTANCE_EPSILON) {
    return null;
  }
  // The nose's offset from the eye midpoint, projected on the eye line (the de-rolled x axis).
  const mx = (rightEye[0] + leftEye[0]) / 2;
  const my = (rightEye[1] + leftEye[1]) / 2;
  return ((nose[0] - mx) * dx + (nose[1] - my) * dy) / (distance * distance);
}
