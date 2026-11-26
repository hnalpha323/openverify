/**
 * C118.3: a scheduled run coming due. The sweeper starts it at its time with creator `scheduled-run`.
 * Its grant is checked again here, because the target can have widened since the step wrote the row
 * (C121.3). One that can no longer start is canceled with its reason, never left pending. Only the
 * limiter leaves one pending, for the next sweep (C117.8).
 */
import {
  finishScheduledRun,
  getWorkflowLiveTarget,
  getWorkflowRun,
  scheduledRunInputs,
  type Db,
  type ScheduledRunRow,
  type WorkflowRunRow,
} from '@openverify/db';
import { WORKFLOW_RUN_LIMITS, type JsonRecord } from '@openverify/workflow-engine';
import { grantOf, missingFromGrant } from '../engine/authority.js';
import { startWorkflowRunInTx, type StartedWorkflowRun } from '../engine/start-run.js';
import { engineDepsOf } from '../engine/worker-deps.js';
import type { WorkflowWorkerDeps } from '../worker.js';
import { deferredUntil, runGuard } from './admission.js';
import { inputsFit } from './inputs.js';
import { chooseRolloutVersion } from './rollout.js';
import { isScheduled } from './schedule-workflow.js';
import { readRunTarget, type RunTarget } from './start-target.js';

const MAX_DEPTH = WORKFLOW_RUN_LIMITS['run-depth'].value;

const OBJECT_TYPE_BY_PREFIX: Readonly<Record<string, string>> = {
  acc: 'account',
  case: 'case',
  inq: 'inquiry',
  rep: 'report',
  txn: 'transaction',
};

const typeOfId = (id: string): string => OBJECT_TYPE_BY_PREFIX[id.split('_')[0] ?? ''] ?? 'object';

/** Why a scheduled run cannot start, or `null`. */
function refusalOf(source: WorkflowRunRow | null, target: RunTarget | null): string | null {
  if (source === null) {
    return 'source_run_missing';
  }
  if (target === null) {
    return 'definition_unreadable';
  }
  if (!isScheduled(target)) {
    return 'workflow_trigger_mismatch';
  }
  if (source.depth + 1 > MAX_DEPTH) {
    return 'run_depth_exceeded';
  }
  return missingFromGrant(grantOf(source.effectiveGrant), target.grant).length > 0
    ? 'run_grant_insufficient'
    : null;
}

/**
 * Starts a due scheduled run, under its row lock. `null` when it started nothing: it was canceled, or
 * the limiter holds it for the next sweep.
 */
export async function fireScheduledRun(
  tx: Db,
  deps: WorkflowWorkerDeps,
  row: ScheduledRunRow,
): Promise<StartedWorkflowRun | null> {
  const { environmentId, id, targetWorkflowId, subjectId } = row;
  const cancel = async (reasonCode: string) => {
    await finishScheduledRun(tx, environmentId, id, { status: 'canceled', reasonCode });
    return null;
  };
  const live = await getWorkflowLiveTarget(tx, environmentId, targetWorkflowId);
  if (live?.workflow.status !== 'running') {
    return cancel('workflow_not_running');
  }
  const choice = chooseRolloutVersion(
    live.version,
    live.deployment,
    live.versions,
    subjectId ?? id,
  );
  if (choice === null) {
    return cancel('workflow_not_running');
  }
  const target = readRunTarget(choice.version, choice.deploymentId, choice.label);
  const source =
    row.sourceRunId === null ? null : await getWorkflowRun(tx, environmentId, row.sourceRunId);
  const refusal = refusalOf(source, target);
  if (refusal !== null || source === null || target === null) {
    return cancel(refusal ?? 'source_run_missing');
  }
  const inputs = (scheduledRunInputs(row) ?? {}) as JsonRecord;
  if (!inputsFit(target.definition.inputs, inputs)) {
    return cancel('trigger_input_invalid');
  }
  const held = await deferredUntil(deps.services.rateLimiter, deps.clock.now(), [
    runGuard(environmentId),
  ]);
  if (held !== null) {
    return null;
  }
  const started = await startWorkflowRunInTx(tx, engineDepsOf(deps), {
    environmentId,
    workflowId: targetWorkflowId,
    workflowVersionId: target.version.id,
    deploymentId: target.deploymentId,
    rolloutLabel: target.rolloutLabel,
    triggerType: 'trigger-schedule',
    scheduledRunId: id,
    creator: { type: 'scheduled-run', id },
    trigger: subjectId === null ? null : { id: subjectId, type: typeOfId(subjectId) },
    inputs,
    subjectIds: subjectId === null ? [] : [subjectId],
    causedByPrincipal: source.causedByPrincipal,
    grant: target.grant,
    rootRunId: source.rootRunId ?? source.id,
    depth: source.depth + 1,
    triggerDepth: source.triggerDepth,
    oneRunPerSubject:
      subjectId !== null && target.definition.trigger?.['one-run-per-subject'] === true
        ? subjectId
        : null,
  });
  await finishScheduledRun(tx, environmentId, id, {
    status: 'run_created',
    workflowRunId: started.run.id,
  });
  return started;
}
