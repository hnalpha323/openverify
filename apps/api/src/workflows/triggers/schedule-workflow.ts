/**
 * C118.3: Schedule Workflow. The action writes a `scheduled_runs` row (`srrun_`) in its effect's
 * transaction, so it is exactly once. Scheduled runs are the answer to waits beyond 30 days.
 *
 * A child's grant must be a subset of the parent run's effective grant, checked when the child is
 * created (C121.3), so it is checked here and again when the run comes due.
 *
 * This file reads no worker wiring, so the engine's handler table can import it.
 */
import { createScheduledRun, getWorkflowLiveTarget, type Db } from '@openverify/db';
import {
  WORKFLOW_RUN_LIMITS,
  scheduledRunTime,
  type ScheduleOffsetUnit,
} from '@openverify/workflow-engine';
import type {
  ActionContext,
  ActionResult,
  RunGrant,
  TransactionActionHandler,
} from '../engine/action-port.js';
import { missingFromGrant } from '../engine/authority.js';
import { readRunTarget, type RunTarget } from './start-target.js';

const MAX_DEPTH = WORKFLOW_RUN_LIMITS['run-depth'].value;
const RUN_TIME = 'run-time';

/** Whether a version starts from a scheduled run. */
export const isScheduled = (target: RunTarget): boolean =>
  target.definition.trigger?.type === 'trigger-schedule';

const failed = (code: string): ActionResult => ({ kind: 'failed', code });
const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** What the target says about a run of `context`, checked when the step runs. */
async function targetRefusal(
  tx: Db,
  context: ActionContext,
  workflowId: string,
  grant: RunGrant,
): Promise<string | null> {
  const live = await getWorkflowLiveTarget(tx, context.environmentId, workflowId);
  if (live?.workflow.status !== 'running' || live.version === null) {
    return 'workflow_not_running';
  }
  const target = readRunTarget(live.version, null, null);
  if (target === null || !isScheduled(target)) {
    return 'workflow_trigger_mismatch';
  }
  return missingFromGrant(grant, target.grant).length > 0 ? 'run_grant_insufficient' : null;
}

/** The step's base as an instant; `null` when it is no date. */
function baseOf(baseTime: unknown, now: Date): Date | null {
  if (baseTime === RUN_TIME) {
    return now;
  }
  const at = new Date(String(baseTime));
  return Number.isNaN(at.getTime()) ? null : at;
}

async function execute(tx: Db, context: ActionContext): Promise<ActionResult> {
  const { config, environmentId, runId, now, services } = context;
  if (context.depth + 1 > MAX_DEPTH) {
    return failed('run_depth_exceeded');
  }
  const workflowId = textOf(config['workflow-id']);
  if (workflowId === null) {
    return failed('workflow_not_running');
  }
  const refusal = await targetRefusal(tx, context, workflowId, context.grant);
  if (refusal !== null) {
    return failed(refusal);
  }
  const baseAt = baseOf(config['base-time'], now);
  if (baseAt === null) {
    return failed('schedule_base_invalid');
  }
  const offset = Number(config.offset);
  const units = config.units as ScheduleOffsetUnit;
  const direction = config.direction as 'before' | 'after';
  const runAt = scheduledRunTime(baseAt.toISOString(), offset, units, direction);
  const id = services.ids.newId('srrun');
  const subjectId = textOf(config['subject-id']);
  await createScheduledRun(tx, environmentId, {
    id,
    targetWorkflowId: workflowId,
    sourceRunId: runId,
    subjectId,
    baseAt,
    offsetValue: offset,
    offsetUnit: units,
    offsetDirection: direction,
    fireAt: new Date(runAt),
    inputs: (config.inputs ?? null) as Readonly<Record<string, unknown>> | null,
  });
  return {
    kind: 'succeeded',
    output: { 'scheduled-run-id': id, 'run-at': runAt },
    subjects: subjectId === null ? [] : [{ subjectId, source: 'read' }],
  };
}

export const SCHEDULE_WORKFLOW_HANDLER: TransactionActionHandler = {
  key: 'schedule_workflow',
  version: 1,
  shape: 'transaction',
  execute,
};
