/**
 * C119.9, C121.3: Run Workflow starts a separate run of another workflow with mapped inputs. The
 * child's grant must be a subset of the parent run's effective grant, checked here and now, because
 * `latest-published` can have changed since the parent was published. Depth is at most 5 and a lineage
 * never repeats a workflow. A step that waits for its child waits for the child's run events, so a
 * child's end never touches its parent's rows: a cancel locks parent then child, and an end that locked
 * the parent would invert that.
 */
import {
  getWorkflowRun,
  getWorkflowRunVersion,
  getWorkflowRunWorkflow,
  latestPublishedWorkflowRunVersion,
  openWorkflowRunValues,
  type Db,
} from '@openverify/db';
import { WORKFLOW_RUN_LIMITS, type JsonRecord, type JsonValue } from '@openverify/workflow-engine';
import type {
  ActionContext,
  ActionResolution,
  ActionResult,
  TransactionActionHandler,
} from './action-port.js';
import { grantOf, missingFromGrant } from './authority.js';
import { flushAfterCommit } from './advance-run.js';
import { startWorkflowRunInTx } from './start-run.js';

const MAX_DEPTH = WORKFLOW_RUN_LIMITS['run-depth'].value;
/** C119.9: as long as a wait may be. */
const CHILD_WAIT_SECONDS = WORKFLOW_RUN_LIMITS['wait-seconds'].value;

export const CHILD_RUN_EVENTS = [
  'workflow-run.completed',
  'workflow-run.errored',
  'workflow-run.canceled',
] as const;

const failed = (code: string): ActionResult => ({ kind: 'failed', code });

/** C119.9: `true` when this workflow is already in the run's lineage. */
async function inLineage(tx: Db, context: ActionContext, workflowId: string): Promise<boolean> {
  let current: string | null = context.runId;
  for (let hops = 0; current !== null && hops <= MAX_DEPTH + 1; hops += 1) {
    const run = await getWorkflowRun(tx, context.environmentId, current);
    if (run === null) {
      return false;
    }
    if (run.workflowId === workflowId) {
      return true;
    }
    current = run.parentRunId;
  }
  return false;
}

async function execute(tx: Db, context: ActionContext): Promise<ActionResult> {
  const { config, environmentId } = context;
  const workflowId = config['workflow-id'] as string;
  const pinned = config.version as string;
  if (context.depth + 1 > MAX_DEPTH) {
    return failed('run_depth_exceeded');
  }
  if (await inLineage(tx, context, workflowId)) {
    return failed('run_depth_exceeded');
  }
  const workflow = await getWorkflowRunWorkflow(tx, environmentId, workflowId);
  const version =
    pinned === 'latest-published'
      ? await latestPublishedWorkflowRunVersion(tx, environmentId, workflowId)
      : await getWorkflowRunVersion(tx, environmentId, pinned);
  if (workflow === null || version?.workflowId !== workflowId) {
    return failed('workflow_not_running');
  }
  if (workflow.status !== 'running') {
    return failed('workflow_not_running');
  }
  const grant = grantOf(version.grant ?? {});
  if (missingFromGrant(context.grant, grant).length > 0) {
    return failed('run_grant_insufficient');
  }
  const parent = await getWorkflowRun(tx, environmentId, context.runId);
  // C119.9: a repeat of this step finds the child by its key, so one step makes one child.
  const { engine } = context;
  const started = await startWorkflowRunInTx(tx, engine, {
    environmentId,
    workflowId,
    workflowVersionId: version.id,
    triggerType: 'trigger-direct',
    creator: { type: 'workflow-run', id: context.runId },
    trigger: context.state.trigger,
    inputs: (config.inputs ?? {}) as JsonRecord,
    subjectIds: [],
    causedByPrincipal: parent?.causedByPrincipal ?? null,
    grant,
    rootRunId: context.rootRunId,
    parentRunId: context.runId,
    depth: context.depth + 1,
    triggerDepth: context.triggerDepth,
    idempotencyKey: context.effectKey,
  });
  const childId = started.run.id;
  const subjects = [{ subjectId: childId, source: 'written' as const }];
  const afterCommit = () => flushAfterCommit(engine, started.after);
  if (config['wait-for-completion'] !== true) {
    return {
      kind: 'succeeded',
      output: { 'workflow-run-id': childId, status: started.run.status, outputs: null },
      subjects,
      afterCommit,
    };
  }
  return {
    kind: 'waiting',
    correlationKey: childId,
    events: CHILD_RUN_EVENTS,
    timeoutSeconds: CHILD_WAIT_SECONDS,
    timeoutCode: 'wait_timed_out',
    carry: { 'workflow-run-id': childId },
    subjects,
    afterCommit,
  };
}

async function resume(
  tx: Db,
  context: ActionContext,
  resolution: ActionResolution,
): Promise<ActionResult> {
  const childId = resolution.carry['workflow-run-id'] as string;
  const child = await getWorkflowRun(tx, context.environmentId, childId);
  if (child === null || child.status === 'in_progress') {
    return failed('execution_error');
  }
  if (child.status !== 'completed') {
    return failed(child.errorCode ?? 'run_failed');
  }
  const outputs = (openWorkflowRunValues(child).outputs ?? null) as JsonValue;
  return {
    kind: 'succeeded',
    output: { 'workflow-run-id': childId, status: child.status, outputs },
  };
}

export const RUN_WORKFLOW_HANDLER: TransactionActionHandler = {
  key: 'run_workflow',
  version: 1,
  shape: 'transaction',
  execute,
  resume,
};
