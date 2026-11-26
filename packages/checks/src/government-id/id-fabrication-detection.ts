/**
 * `id_fabrication_detection` (H, fraud, beta, model-based): layout conformance from the quad, the
 * text boxes, the MRZ box and the portrait box against the ICAO geometry of MRZ classes
 * (`fabricationScore`, C32.2). A failure names its nonconformant components.
 */
import type { CheckResult } from '@openverify/core';
import { modelsOf, type GovernmentIdContext } from './context.js';
import { judgeHeuristic } from './h-tier.js';
import { fabricationScore, nearestLayout } from './scores.js';

export function idFabricationDetection(context: GovernmentIdContext): CheckResult {
  const front = context.input.analysis.sides.front.document;
  return judgeHeuristic(context, {
    checkId: 'id_fabrication_detection',
    key: 'max-fabrication-score',
    measured: fabricationScore(context),
    reasons: () => ['layout_nonconformant'],
    metadata: (score, threshold) => ({
      layout:
        context.extraction.document.layout ??
        (front?.aspect_ratio == null ? null : nearestLayout(front.aspect_ratio)),
      'nonconformant-components': Object.entries(score.components)
        .filter(([, value]) => value > threshold)
        .map(([name]) => name),
    }),
    models: modelsOf(context, ['faceDetector', 'textDetector', 'textRecognizer']),
  });
}
