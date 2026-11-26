/**
 * C152.2 (Workflow 9A): a `run_workflow` step's target, resolved the same way at the template's
 * publish and on each entry: a workflow of the inquiry's environment (only workflows of the same
 * environment), its published version (`latest-published` resolved now, or the pinned `wfv_`, which
 * must be a published version of that workflow), whose trigger type is `trigger-flow`. On entry the
 * workflow must also be running; a paused one may still be published against. Owner:
 * `api-flow-actions`.
 */
import {
  getWorkflowRunWorkflow,
  getWorkflowVersion,
  latestPublishedWorkflowRunVersion,
  type Db,
} from '@openverify/db';
import type { FlowAction } from '@openverify/flow-spec';
import type { RunGrant } from '../workflows/engine/action-port.js';
import { grantOf } from '../workflows/engine/authority.js';

export type RunWorkflowAction = Extract<FlowAction, { kind: 'run_workflow' }>;

/** A resolved target: the version a run starts on, its frozen grant and its egress steps. */
export interface FlowRunTarget {
  workflowId: string;
  versionId: string;
  grant: RunGrant;
  /** The step ids of the version's egress marks (C121.4), never a path's value. */
  egress: readonly string[];
}

/** Why a target cannot run, as a step's `error-type` (C152.2). */
export type FlowRunTargetRefusal =
  | 'workflow_not_found'
  | 'workflow_not_running'
  | 'workflow_not_published'
  | 'workflow_trigger_invalid';

const stepIdsOf = (egress: readonly unknown[]): string[] =>
  egress.flatMap((mark) => {
    const step = (mark as { 'step-id'?: unknown } | null)?.['step-id'];
    return typeof step === 'string' ? [step] : [];
  });

/** Resolves the step's target; `running` asks that the workflow be running (on entry). */
export async function resolveFlowRunTarget(
  db: Db,
  environmentId: string,
  action: RunWorkflowAction,
  options: { running: boolean },
): Promise<FlowRunTarget | FlowRunTargetRefusal> {
  const workflow = await getWorkflowRunWorkflow(db, environmentId, action.workflowId);
  if (workflow === null) {
    return 'workflow_not_found';
  }
  if (options.running && workflow.status !== 'running') {
    return 'workflow_not_running';
  }
  const versionId =
    action.version === 'latest-published'
      ? (await latestPublishedWorkflowRunVersion(db, environmentId, action.workflowId))?.id
      : action.version;
  const version =
    versionId === undefined ? null : await getWorkflowVersion(db, environmentId, versionId);
  if (version?.workflowId !== action.workflowId || version.status !== 'published') {
    return 'workflow_not_published';
  }
  if (version.triggerType !== 'trigger-flow') {
    return 'workflow_trigger_invalid';
  }
  return {
    workflowId: workflow.id,
    versionId: version.id,
    grant: grantOf(version.grant ?? {}),
    egress: stepIdsOf(version.egress),
  };
}
