/**
 * `id_entity_detection` (H, fraud, beta): the composite risk that the document is not a genuine
 * entity, aggregating the other fraud signals (`entityScore`). A failure is `entity_risk_high`;
 * `signals` names the components at or above half the threshold.
 */
import type { CheckResult } from '@openverify/core';
import type { GovernmentIdContext } from './context.js';
import { judgeHeuristic } from './h-tier.js';
import { entityScore } from './scores.js';

export function idEntityDetection(context: GovernmentIdContext): CheckResult {
  return judgeHeuristic(context, {
    checkId: 'id_entity_detection',
    key: 'max-entity-score',
    measured: entityScore(context),
    reasons: () => ['entity_risk_high'],
    metadata: (score, threshold) => ({
      signals: Object.entries(score.components)
        .filter(([, value]) => value >= threshold / 2)
        .map(([name]) => name),
    }),
  });
}
