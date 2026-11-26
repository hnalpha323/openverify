/**
 * C116.3: which side of a rollout a subject takes. Each subject is assigned by
 * `hash(deployment id, subject id) mod 100 < percentage`, so one object always gets one side and a
 * retried trigger gets the same side, and a new rollout deals again.
 */
import { createHash } from 'node:crypto';
import type { WorkflowRolloutLabel } from '@openverify/core';
import type { WorkflowDeploymentRow, WorkflowVersionRow } from '@openverify/db';

const BUCKETS = 100;

interface DeploymentSide {
  token: string;
  percentage: number;
  label: WorkflowRolloutLabel;
}

export interface RolloutChoice {
  version: WorkflowVersionRow;
  /** `null` outside a rollout. */
  label: WorkflowRolloutLabel | null;
  deploymentId: string | null;
}

/** The subject's bucket, 0 to 99. */
function bucketOf(deploymentId: string, subjectKey: string): number {
  const digest = createHash('sha256').update(`${deploymentId}/${subjectKey}`).digest();
  return digest.readUInt32BE(0) % BUCKETS;
}

/**
 * The version a subject runs: the live one, or its side of the active rollout. A rollout's treatment
 * that cannot be read falls to its control side, the version that was live before it.
 */
export function chooseRolloutVersion(
  live: WorkflowVersionRow | null,
  deployment: WorkflowDeploymentRow | null,
  versions: readonly WorkflowVersionRow[],
  subjectKey: string,
): RolloutChoice | null {
  if (deployment === null) {
    return live === null ? null : { version: live, label: null, deploymentId: null };
  }
  const sides = deployment.versions as readonly DeploymentSide[];
  const treatment = sides.find(({ label }) => label === 'treatment');
  const control = sides.find(({ label }) => label === 'control');
  const versionOf = (side: DeploymentSide | undefined) =>
    versions.find(({ id }) => id === side?.token);
  const treated = versionOf(treatment);
  if (
    treated !== undefined &&
    treatment !== undefined &&
    bucketOf(deployment.id, subjectKey) < treatment.percentage
  ) {
    return { version: treated, label: 'treatment', deploymentId: deployment.id };
  }
  const version = versionOf(control) ?? live;
  return version === null ? null : { version, label: 'control', deploymentId: deployment.id };
}
