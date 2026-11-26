/** C112.3, C112.4, C116.3: rows as the contract's resources. */
import {
  buildWorkflowDeploymentResource,
  buildWorkflowResource,
  buildWorkflowVersionResource,
  type WorkflowAcknowledgement,
  type WorkflowDefinitionIssue,
  type WorkflowDeploymentResource,
  type WorkflowEgressMark,
  type WorkflowGrant,
  type WorkflowVersionResource,
} from '@openverify/contracts';
import type { WorkflowRolloutLabel } from '@openverify/core';
import {
  getWorkflowDeployment,
  type Db,
  type WorkflowDeploymentRow,
  type WorkflowRow,
  type WorkflowVersionRow,
} from '@openverify/db';
import { readDefinition } from '@openverify/workflow-engine';

export const workflowResource = buildWorkflowResource;

interface DeploymentVersion {
  token: string;
  percentage: number;
  label: WorkflowRolloutLabel;
}

export const deploymentVersions = (deployment: WorkflowDeploymentRow) =>
  deployment.versions as readonly DeploymentVersion[];

export function workflowDeploymentResource(row: WorkflowDeploymentRow): WorkflowDeploymentResource {
  return buildWorkflowDeploymentResource({ ...row, versions: deploymentVersions(row) });
}

/** The workflow's rollout, or `null` with none. */
export async function activeDeployment(
  db: Db,
  environmentId: string,
  workflow: WorkflowRow,
): Promise<WorkflowDeploymentRow | null> {
  const { activeDeploymentId } = workflow;
  return activeDeploymentId === null
    ? null
    : getWorkflowDeployment(db, environmentId, activeDeploymentId);
}

/**
 * The version as served. During a rollout both sides are live, each with its label and percentage.
 * @param options.withDefinition `false` in an event, which never carries one.
 */
export function workflowVersionResource(
  row: WorkflowVersionRow,
  workflow: WorkflowRow,
  deployment: WorkflowDeploymentRow | null,
  options: { withDefinition: boolean } = { withDefinition: true },
): WorkflowVersionResource {
  const side =
    deployment === null
      ? undefined
      : deploymentVersions(deployment).find(({ token }) => token === row.id);
  const definition = readDefinition(row.definition);
  return buildWorkflowVersionResource({
    ...row,
    live:
      row.status === 'published' &&
      (side !== undefined || workflow.latestPublishedVersionId === row.id),
    rolloutLabel: side?.label ?? null,
    rolloutPercentage: side?.percentage ?? null,
    definition: options.withDefinition ? definition : null,
    inputs: definition.inputs.map(({ name, type, required }) => ({
      name,
      type,
      required,
    })),
    outputs: definition.outputs.map(({ name }) => ({ name })),
    grant: row.grant as WorkflowGrant | null,
    egress: row.egress as readonly WorkflowEgressMark[],
    acknowledgements: row.acknowledgements as readonly WorkflowAcknowledgement[],
    warnings: row.warnings as readonly WorkflowDefinitionIssue[],
  });
}
