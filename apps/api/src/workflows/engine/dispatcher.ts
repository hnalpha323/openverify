/**
 * C117.8, C117.9: admission. BullMQ's round-robin groups are commercial, so fairness is here: a step
 * is enqueued only while its environment has fewer than its cap of steps running or enqueued, counted
 * through the partial indexes. The count is approximate and needs no hot row and no recovery. The
 * sweep serves environments in rotation by `last_served_at`, and each completion pulls its own
 * environment's next steps, so a busy environment never waits for the sweep or starves a quiet one.
 * Only the sweep writes `last_served_at`: a completion that wrote it would make the slot a hot row.
 */
import { QUEUE_IN_FLIGHT_CAP } from '@openverify/contracts';
import {
  countInFlightWorkflowSteps,
  countRunningWorkflowActions,
  getEnvironment,
  getWorkflowEnvironmentCap,
  listEnvironmentsWithReadySteps,
  listReadyWorkflowRunSteps,
  listWorkflowRunTriggerTypes,
  markWorkflowStepsEnqueued,
  resolveWorkflowSettings,
  touchWorkflowEnvironmentSlot,
  type Db,
  type WorkflowRunStepRow,
} from '@openverify/db';
import type { WorkflowTriggerType } from '@openverify/core';
import type { WorkflowStepEnqueueOptions, WorkflowStepJob } from '../../ports.js';
import { databaseNow, type EngineDeps } from './deps.js';

/** C117.8 (ours, provisional): each may hold at most this many slots of its environment. */
export const ACTION_CONCURRENCY: Readonly<Record<string, number>> = Object.freeze({
  evaluate_code: 5,
  make_https_request: 5,
});

/** C117.8: schedules, recurring ticks and fan-outs never hold up a person's run. */
const BATCH_TRIGGERS: ReadonlySet<WorkflowTriggerType> = new Set([
  'trigger-schedule',
  'trigger-recurring',
  'trigger-direct',
]);

const ROTATION_LIMIT = 500;

/**
 * An environment's own override, then its setting, then the install's; never above the install's
 * queue ceiling `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX` (C251.2, Workflow 11B Stage 1a amendment 17:
 * clamped on read, never refused; integration-11b).
 */
async function capOf(db: Db, deps: EngineDeps, environmentId: string): Promise<number> {
  const ceiling =
    deps.queueInFlightCapMax ??
    deps.services?.queueInFlightCapMax ??
    QUEUE_IN_FLIGHT_CAP.ceilingDefault;
  return Math.min(await storedCapOf(db, deps, environmentId), ceiling);
}

async function storedCapOf(db: Db, deps: EngineDeps, environmentId: string): Promise<number> {
  const own = await getWorkflowEnvironmentCap(db, environmentId);
  if (own !== null) {
    return own;
  }
  const environment = await getEnvironment(db, environmentId);
  const settings = environment?.settings ?? {};
  if (settings['workflow-in-flight-cap'] !== undefined) {
    return settings['workflow-in-flight-cap'];
  }
  return deps.inFlightCap ?? resolveWorkflowSettings(settings)['workflow-in-flight-cap'];
}

function withinActionCaps(
  steps: readonly WorkflowRunStepRow[],
  running: Readonly<Record<string, number>>,
  room: number,
): WorkflowRunStepRow[] {
  const taken: Record<string, number> = { ...running };
  const admitted: WorkflowRunStepRow[] = [];
  for (const step of steps) {
    if (admitted.length >= room) {
      break;
    }
    const key = step.actionKey;
    const cap = key === null ? undefined : ACTION_CONCURRENCY[key];
    if (key === null || cap === undefined || (taken[key] ?? 0) < cap) {
      admitted.push(step);
      if (key !== null) {
        taken[key] = (taken[key] ?? 0) + 1;
      }
    }
  }
  return admitted;
}

interface Admitted {
  job: WorkflowStepJob;
  options: WorkflowStepEnqueueOptions;
}

async function admit(
  deps: EngineDeps,
  environmentId: string,
  rotate: boolean,
): Promise<Admitted[]> {
  return deps.db.transaction(async (tx) => {
    const now = await databaseNow(tx);
    // R004: the sweep's visit is its turn, admitted or not, so a capped environment goes to the back
    // and never holds the head of the window. Only the sweep rotates (no hot row).
    if (rotate) {
      await touchWorkflowEnvironmentSlot(tx, environmentId, now);
    }
    const room =
      (await capOf(tx, deps, environmentId)) -
      (await countInFlightWorkflowSteps(tx, environmentId));
    if (room <= 0) {
      return [];
    }
    // Over-read: a capped action's steps must not hide the steps behind them.
    const ready = await listReadyWorkflowRunSteps(tx, { environmentId, now, limit: room * 2 });
    const running = await countRunningWorkflowActions(tx, environmentId);
    const admitted = withinActionCaps(ready, running, room);
    if (admitted.length === 0) {
      return [];
    }
    await markWorkflowStepsEnqueued(
      tx,
      environmentId,
      admitted.map(({ id }) => id),
      now,
    );
    const triggers = await listWorkflowRunTriggerTypes(tx, environmentId, [
      ...new Set(admitted.map(({ runId }) => runId)),
    ]);
    return admitted.map(({ id, runId, attempt }) => {
      const trigger = triggers.get(runId);
      return {
        job: { environmentId, runId, stepId: id, attempt: attempt + 1 },
        options: trigger !== undefined && BATCH_TRIGGERS.has(trigger) ? { batch: true } : {},
      };
    });
  });
}

/** Enqueues what an environment has room for. A failed enqueue goes back to the sweep. */
export async function dispatchEnvironment(
  deps: EngineDeps,
  environmentId: string,
  options: { rotate?: boolean } = {},
): Promise<void> {
  const { steps } = deps;
  if (steps === undefined) {
    return;
  }
  for (const { job, options: enqueue } of await admit(
    deps,
    environmentId,
    options.rotate === true,
  )) {
    try {
      await steps.enqueueWorkflowStep(job, enqueue);
    } catch {
      await markWorkflowStepsEnqueued(deps.db, environmentId, [job.stepId], null);
    }
  }
}

/** C117.8: the sweep's turn: every environment with ready steps, longest unserved first. */
export async function dispatchReadySteps(deps: EngineDeps): Promise<void> {
  const now = await databaseNow(deps.db);
  const environments = await listEnvironmentsWithReadySteps(deps.db, {
    now,
    limit: ROTATION_LIMIT,
  });
  for (const environmentId of environments) {
    await dispatchEnvironment(deps, environmentId, { rotate: true });
  }
}
