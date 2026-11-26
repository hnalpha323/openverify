/**
 * `id_color_inconsistency_detection` (H, fraud, beta): a grayscale print or photocopy, or a
 * regional colour cast (C32.1 chroma and colour-cast scores; `colorInconsistencyScore`).
 */
import type { CheckResult } from '@openverify/core';
import type { GovernmentIdContext } from './context.js';
import { judgeHeuristic } from './h-tier.js';
import { colorInconsistencyScore } from './scores.js';

export function idColorInconsistencyDetection(context: GovernmentIdContext): CheckResult {
  return judgeHeuristic(context, {
    checkId: 'id_color_inconsistency_detection',
    key: 'max-color-inconsistency-score',
    measured: colorInconsistencyScore(context.input.analysis),
    reasons: (score, threshold) => [
      ...((score.components.grayscale ?? 0) > threshold ? ['grayscale_image'] : []),
      ...((score.components['color-cast'] ?? 0) > threshold ? ['color_cast_detected'] : []),
    ],
  });
}
