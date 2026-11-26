/**
 * C118.1 (Workflow 8A): `workflow_triggers`, the publish-time index, and what a workflow runs now.
 * Owner: `api-triggers`.
 *
 * `api-workflows` rebuilds a workflow's rows in the publish transaction, under the workflow's row
 * lock. `stage()` reads them with one indexed lookup, so nothing here evaluates a condition.
 */
import type { WorkflowTriggerType } from '@openverify/core';
import { and, desc, eq, inArray, lte, ne } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  workflowDeployments,
  workflowTriggers,
  workflowVersions,
  workflows,
  type WorkflowDeploymentRow,
  type WorkflowRow,
  type WorkflowTriggerRow,
  type WorkflowVersionRow,
} from '../schema.js';

/** C118.1, C118.6: a verification trigger is an event trigger held to `verification.*`. */
const EVENT_TRIGGER_KINDS: readonly WorkflowTriggerType[] = [
  'trigger-event',
  'trigger-verification',
];

export interface NewWorkflowTrigger {
  kind: WorkflowTriggerType;
  eventName: string | null;
  workflowVersionId?: string | null | undefined;
  workflowDeploymentId?: string | null | undefined;
  filter?: Readonly<Record<string, unknown>> | null | undefined;
}

/** C116.1: rebuilt in the publish transaction, under the workflow's row lock. */
export async function replaceWorkflowTriggers(
  tx: Db,
  environmentId: string,
  workflowId: string,
  triggers: readonly NewWorkflowTrigger[],
): Promise<void> {
  await tx
    .delete(workflowTriggers)
    .where(
      and(
        eq(workflowTriggers.environmentId, environmentId),
        eq(workflowTriggers.workflowId, workflowId),
      ),
    );
  if (triggers.length === 0) {
    return;
  }
  await tx.insert(workflowTriggers).values(
    triggers.map((trigger) => ({
      environmentId,
      workflowId,
      kind: trigger.kind,
      eventName: trigger.eventName,
      workflowVersionId: trigger.workflowVersionId ?? null,
      workflowDeploymentId: trigger.workflowDeploymentId ?? null,
      filter:
        trigger.filter === undefined || trigger.filter === null ? null : { ...trigger.filter },
    })),
  );
}

/** C118.1: `stage()`'s one indexed lookup of `(environment_id, kind, event_name)`. */
export async function listEventWorkflowTriggers(
  tx: Db,
  environmentId: string,
  eventName: string,
): Promise<WorkflowTriggerRow[]> {
  return tx
    .select()
    .from(workflowTriggers)
    .where(
      and(
        eq(workflowTriggers.environmentId, environmentId),
        inArray(workflowTriggers.kind, [...EVENT_TRIGGER_KINDS]),
        eq(workflowTriggers.eventName, eventName),
      ),
    )
    .orderBy(workflowTriggers.id);
}

/** C116.3: what a workflow runs now, for everything that starts a run. */
export interface WorkflowLiveTarget {
  workflow: WorkflowRow;
  /** The latest published version; `null` before one is published. */
  version: WorkflowVersionRow | null;
  /** The active rollout, or `null`. */
  deployment: WorkflowDeploymentRow | null;
  /** The rollout's versions, or the live one. */
  versions: WorkflowVersionRow[];
}

/** The token of each `{ token, percentage, label }` of a deployment (`wfv_` ids). */
function deploymentTokens(deployment: WorkflowDeploymentRow): string[] {
  return deployment.versions.flatMap((version) => {
    const token = (version as { token?: unknown }).token;
    return typeof token === 'string' ? [token] : [];
  });
}

export async function getWorkflowLiveTarget(
  db: Db,
  environmentId: string,
  workflowId: string,
): Promise<WorkflowLiveTarget | null> {
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.environmentId, environmentId), eq(workflows.id, workflowId)))
    .limit(1);
  if (workflow === undefined) {
    return null;
  }
  const deployments =
    workflow.activeDeploymentId === null
      ? []
      : await db
          .select()
          .from(workflowDeployments)
          .where(
            and(
              eq(workflowDeployments.environmentId, environmentId),
              eq(workflowDeployments.id, workflow.activeDeploymentId),
              eq(workflowDeployments.status, 'active'),
            ),
          )
          .limit(1);
  const deployment = deployments[0] ?? null;
  const live = workflow.latestPublishedVersionId;
  const wanted = [
    ...(live === null ? [] : [live]),
    ...(deployment === null ? [] : deploymentTokens(deployment)),
  ];
  const versions =
    wanted.length === 0
      ? []
      : await db
          .select()
          .from(workflowVersions)
          .where(
            and(
              eq(workflowVersions.environmentId, environmentId),
              inArray(workflowVersions.id, wanted),
            ),
          );
  return {
    workflow,
    version: versions.find((version) => version.id === live) ?? null,
    deployment,
    versions,
  };
}

/** C118.1: the version live at `at`, so an event never starts a version newer than itself. */
export async function getWorkflowVersionLiveAt(
  db: Db,
  environmentId: string,
  workflowId: string,
  at: Date,
): Promise<WorkflowVersionRow | null> {
  const [version] = await db
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.environmentId, environmentId),
        eq(workflowVersions.workflowId, workflowId),
        ne(workflowVersions.status, 'draft'),
        lte(workflowVersions.publishedAt, at),
      ),
    )
    .orderBy(desc(workflowVersions.publishedAt), desc(workflowVersions.versionNumber))
    .limit(1);
  return version ?? null;
}
