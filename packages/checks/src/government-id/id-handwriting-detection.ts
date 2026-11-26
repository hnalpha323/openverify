/**
 * `id_handwriting_detection` (H, fraud, beta, model-based): a printed field written by hand, from
 * the stroke-width variation and the OCR confidence of its line (`handwritingScore`). A failure
 * names the C31.5 fields whose line scores above the threshold, never their values.
 */
import type { CheckResult } from '@openverify/core';
import { modelsOf, type GovernmentIdContext } from './context.js';
import { judgeHeuristic } from './h-tier.js';
import { handwritingScore } from './scores.js';

export function idHandwritingDetection(context: GovernmentIdContext): CheckResult {
  return judgeHeuristic(context, {
    checkId: 'id_handwriting_detection',
    key: 'max-handwriting-score',
    measured: handwritingScore(context),
    reasons: () => ['handwriting_suspected'],
    metadata: (score, threshold) => ({
      'suspected-fields': Object.entries(score.fieldScores)
        .filter(([, value]) => value > threshold)
        .map(([field]) => field),
    }),
    models: modelsOf(context, ['textDetector', 'textRecognizer']),
  });
}
