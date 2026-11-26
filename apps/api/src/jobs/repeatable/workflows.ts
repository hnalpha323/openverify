/**
 * C143.1: the trigger side's repeatable jobs. Owner: `api-triggers`. Each is the outbox of what a
 * wake-up or a clock missed, and takes its rows `FOR UPDATE SKIP LOCKED`, so two workers never fight
 * over one.
 *
 * - `workflow-trigger-sweep`: re-enqueues pending deliveries (C118.1);
 * - `workflow-schedule-sweep`: fires the due recurring schedules, one catch-up tick after an outage
 *   (C118.4);
 * - `workflow-scheduled-runs`: creates the runs of the due `scheduled_runs` (C118.3).
 */
import {
  listDueScheduledRuns,
  listDueWorkflowSchedules,
  listPendingWorkflowDeliveries,
} from '@openverify/db';
import { wakeStartedRun, type StartedWorkflowRun } from '../../workflows/engine/start-run.js';
import { engineDepsOf } from '../../workflows/engine/worker-deps.js';
import { fireScheduledRun } from '../../workflows/triggers/scheduled-runs.js';
import { tickWorkflowSchedule } from '../../workflows/triggers/schedules.js';
import type { WorkflowWorkerDeps } from '../../workflows/worker.js';
import { describeJobError } from '../error-description.js';

/** C54.1: a sweep's batch. */
const DELIVERY_BATCH = 500;
const SCHEDULED_RUN_BATCH = 100;
/** One sweep's share: a tick can start 1,000 runs. */
const SCHEDULES_PER_SWEEP = 50;

async function wake(deps: WorkflowWorkerDeps, started: readonly StartedWorkflowRun[]) {
  const engine = engineDepsOf(deps);
  for (const run of started) {
    await wakeStartedRun(engine, run);
  }
}

export async function runWorkflowTriggerSweep(deps: WorkflowWorkerDeps): Promise<void> {
  const now = deps.clock.now();
  const rows = await deps.db.transaction((tx) =>
    listPendingWorkflowDeliveries(tx, { limit: DELIVERY_BATCH, now }),
  );
  for (const { environmentId, id: deliveryId } of rows) {
    try {
      await deps.triggers.enqueueWorkflowTrigger({ environmentId, deliveryId });
    } catch (error) {
      deps.logger.warn(
        { deliveryId, error: describeJobError(error) },
        'workflow delivery not enqueued; a later sweep will take it',
      );
    }
  }
}

export async function runWorkflowScheduleSweep(deps: WorkflowWorkerDeps): Promise<void> {
  const now = deps.clock.now();
  const failed = new Set<string>();
  for (let turn = 0; turn < SCHEDULES_PER_SWEEP; turn += 1) {
    const taken = await deps.db.transaction(async (tx) => {
      const rows = await listDueWorkflowSchedules(tx, {
        limit: failed.size + 1,
        now,
      });
      const schedule = rows.find(({ id }) => !failed.has(id));
      if (schedule === undefined) {
        return null;
      }
      try {
        return await tx.transaction(async (savepoint) =>
          tickWorkflowSchedule(savepoint, deps, schedule, now),
        );
      } catch (error) {
        failed.add(schedule.id);
        deps.logger.error(
          {
            scheduleId: schedule.id,
            workflowId: schedule.workflowId,
            error: describeJobError(error),
          },
          'a recurring tick failed; a later sweep will take it',
        );
        return [];
      }
    });
    if (taken === null) {
      return;
    }
    await wake(deps, taken);
  }
}

export async function runScheduledRunsSweep(deps: WorkflowWorkerDeps): Promise<void> {
  const now = deps.clock.now();
  const started = await deps.db.transaction(async (tx) => {
    const rows = await listDueScheduledRuns(tx, { limit: SCHEDULED_RUN_BATCH, now });
    const runs: StartedWorkflowRun[] = [];
    for (const row of rows) {
      try {
        const run = await tx.transaction(async (savepoint) =>
          fireScheduledRun(savepoint, deps, row),
        );
        if (run?.created === true) {
          runs.push(run);
        }
      } catch (error) {
        deps.logger.error(
          { scheduledRunId: row.id, error: describeJobError(error) },
          'a scheduled run failed; a later sweep will take it',
        );
      }
    }
    return runs;
  });
  await wake(deps, started);
}
