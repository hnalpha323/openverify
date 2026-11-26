/**
 * `id_electronic_replica_detection` (H, fraud, beta): a card photographed from a screen, by the
 * moiré and pixel-grid scores (`electronicReplicaScore`).
 */
import type { CheckResult } from '@openverify/core';
import type { GovernmentIdContext } from './context.js';
import { judgeHeuristic } from './h-tier.js';
import { electronicReplicaScore } from './scores.js';

export function idElectronicReplicaDetection(context: GovernmentIdContext): CheckResult {
  return judgeHeuristic(context, {
    checkId: 'id_electronic_replica_detection',
    key: 'max-electronic-replica-score',
    measured: electronicReplicaScore(context.input.analysis),
    reasons: () => ['screen_recapture_suspected'],
  });
}
