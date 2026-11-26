/**
 * `id_tamper_detection` (H, fraud, beta): digital edits (`tamperScore`, the strongest weighted
 * component). Every component whose weighted score is above the threshold is named
 * (`editing_software_detected`, `error_level_anomaly`, `double_compression_detected`,
 * `copy_move_detected`, `portrait_boundary_anomaly`). The software name never leaves the vision
 * response.
 */
import type { CheckResult } from '@openverify/core';
import type { GovernmentIdContext } from './context.js';
import { judgeHeuristic } from './h-tier.js';
import { TAMPER_WEIGHTS, tamperScore, type TamperComponent } from './scores.js';

const REASONS: Readonly<Record<TamperComponent, string>> = {
  'editing-software': 'editing_software_detected',
  'error-level': 'error_level_anomaly',
  'double-compression': 'double_compression_detected',
  'copy-move': 'copy_move_detected',
  'portrait-boundary': 'portrait_boundary_anomaly',
};

export function idTamperDetection(context: GovernmentIdContext): CheckResult {
  return judgeHeuristic(context, {
    checkId: 'id_tamper_detection',
    key: 'max-tamper-score',
    measured: tamperScore(context.input.analysis),
    reasons: (score, threshold) => {
      const named = (Object.entries(REASONS) as [TamperComponent, string][])
        .filter(
          ([component]) =>
            TAMPER_WEIGHTS[component] * (score.components[component] ?? 0) > threshold,
        )
        .map(([, reason]) => reason);
      return named.length > 0 ? named : ['tampering_suspected'];
    },
    metadata: (score) => ({ 'editing-software': (score.components['editing-software'] ?? 0) > 0 }),
  });
}
