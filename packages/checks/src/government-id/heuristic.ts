/**
 * The confidence of a heuristic (H-tier) result (C29.2, ADR 0002 §3c): uncalibrated and
 * margin-based, 0 at the decision threshold, rising linearly to 1 at the far end of the score
 * scale: a score of 1 for a failure, 0 for a pass. Calibration on labelled data is Phase 4 work,
 * which is why every H-tier check stays `beta`.
 */
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** A check fails when its score is above the threshold; this is how far from it the score sits. */
export function marginConfidence(score: number, threshold: number): number {
  const failed = score > threshold;
  const span = failed ? 1 - threshold : threshold;
  const margin = Math.abs(score - threshold);
  return round4(span <= 0 ? 1 : Math.min(1, margin / span));
}

/**
 * The confidence of a heuristic result: the margin confidence, scaled down when only part of the
 * score's components could be measured (`coverage` in [0, 1]): half the margin with none, all of
 * it with every component.
 */
export function heuristicConfidence(score: number, threshold: number, coverage: number): number {
  const scale = 0.5 + 0.5 * Math.min(1, Math.max(0, coverage));
  return Math.round(marginConfidence(score, threshold) * scale * 10_000) / 10_000;
}
