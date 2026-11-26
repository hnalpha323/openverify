/**
 * What the selfie checks measured on a fake-camera clip or still triple, kept with the test
 * result (an annotation, and one log line) so a run shows the margins against the provisional
 * thresholds (C39.3): yaw ratios and their changes, passive liveness per pose, the side poses'
 * cosines to the centre, planarity, and the similarity to the ID portrait. Scores and ratios
 * only (C39.4): never an embedding, a landmark set or a face box.
 */
import type { VerificationCheck } from '@openverify/contracts';
import { test } from '@playwright/test';

type Check = Pick<VerificationCheck, 'name' | 'metadata'>;

export function recordSelfieMeasurements(label: string, checks: readonly Check[]): void {
  const metadata = (name: string): Record<string, unknown> =>
    checks.find((check) => check.name === name)?.metadata ?? {};
  const pose = metadata('selfie_pose_detection');
  const liveness = metadata('selfie_liveness_detection');
  const measured = {
    'yaw-ratios': pose['yaw-ratios'] ?? null,
    'yaw-ratio-changes': pose['yaw-ratio-changes'] ?? null,
    'passive-scores': liveness['passive-scores'] ?? null,
    'face-cosines': liveness['face-cosines'] ?? null,
    'planarity-residuals': metadata('selfie_pose_repeat_detection')['planarity-residuals'] ?? null,
    'document-similarity': metadata('selfie_id_comparison').similarity ?? null,
  };
  const description = JSON.stringify(measured);
  test.info().annotations.push({ type: 'selfie-measurements', description });
  process.stdout.write(`[selfie measurements] ${label}: ${description}\n`);
}
