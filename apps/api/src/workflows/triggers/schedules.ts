/**
 * C118.4: a recurring schedule's tick. A tick starts one run per matching object, oldest first, at
 * most its batch cap, and keeps a cursor so the next tick goes on; an object past the end wraps round
 * to the oldest. `advanceSchedule` gives one catch-up tick after an outage. A run's `schedule_fire`,
 * `<schedule id>/<fire time>/<object id>`, is unique, so a repeated tick starts nothing twice.
 *
 * The filter is a C114 condition over `trigger`, with its `on-null`, because the C137.2 grammar is
 * Workflow 8B's. A filter that errors leaves that object out with its code in the log: there is no
 * delivery row to hold it, and an unknown never reads as a match.
 */
import {
  advanceWorkflowSchedule,
  getWorkflowLiveTarget,
  listWorkflowObjectsAfter,
  type Db,
  type WorkflowLiveTarget,
  type WorkflowScheduleRow,
} from '@openverify/db';
import {
  ScheduleError,
  advanceSchedule,
  decideTrigger,
  parseCondition,
  type Expression,
  type JsonRecord,
  type ScheduleConfig,
  type ScheduleTick,
} from '@openverify/workflow-engine';
import { startWorkflowRunInTx, type StartedWorkflowRun } from '../engine/start-run.js';
import { engineDepsOf } from '../engine/worker-deps.js';
import type { WorkflowWorkerDeps } from '../worker.js';
import { deferredUntil, runGuard } from './admission.js';
import { snapshotFits, triggerDocumentOf, triggerViewOf } from './objects.js';
import { chooseRolloutVersion } from './rollout.js';
import { readRunTarget } from './start-target.js';

const DAY_MS = 86_400_000;
/** The most objects one tick reads past those it starts runs for. */
const OBJECTS_READ_PER_TICK = 1_000;

function configOf(schedule: WorkflowScheduleRow): ScheduleConfig {
  return {
    ...(schedule.cron === null ? {} : { cron: schedule.cron }),
    ...(schedule.everyMinutes === null ? {} : { everyMinutes: schedule.everyMinutes }),
    timeZone: schedule.timeZone,
  };
}

/** The tick due now, or `null`; one that cannot be read moves the schedule on a day. */
function tickOf(schedule: WorkflowScheduleRow, now: Date): ScheduleTick | 'unreadable' | null {
  try {
    return advanceSchedule(
      configOf(schedule),
      schedule.nextFireAt.toISOString(),
      now.toISOString(),
    );
  } catch (error) {
    if (error instanceof ScheduleError) {
      return 'unreadable';
    }
    throw error;
  }
}

function filterOf(schedule: WorkflowScheduleRow): Expression | null | 'unreadable' {
  if (schedule.filter === null) {
    return null;
  }
  const parsed = parseCondition(schedule.filter);
  return parsed.ok ? parsed.expression : 'unreadable';
}

interface TickContext {
  tx: Db;
  deps: WorkflowWorkerDeps;
  schedule: WorkflowScheduleRow;
  live: WorkflowLiveTarget;
  filter: Expression | null;
  fireTime: string;
  now: Date;
}

/** Whether the filter admits this view. */
function admitted(context: TickContext, view: JsonRecord): boolean {
  const { schedule, filter, now, deps } = context;
  const decision = decideTrigger(filter, schedule.onNull, {
    roots: { trigger: view },
    now: now.toISOString(),
  });
  if (decision.kind === 'error') {
    deps.logger.warn(
      { scheduleId: schedule.id, workflowId: schedule.workflowId, reason: decision.code },
      'a recurring filter left an object out',
    );
  }
  return decision.kind === 'admit';
}

/** One object of a tick: the run, or `null` when it starts none. */
async function startFor(
  context: TickContext,
  objectId: string,
): Promise<StartedWorkflowRun | null> {
  const { tx, deps, schedule, live, fireTime } = context;
  const { environmentId, workflowId, objectType } = schedule;
  const choice = chooseRolloutVersion(live.version, live.deployment, live.versions, objectId);
  const target =
    choice === null ? null : readRunTarget(choice.version, choice.deploymentId, choice.label);
  const document = await triggerDocumentOf(tx, environmentId, objectType, objectId);
  if (target === null || document === null) {
    return null;
  }
  const view = await triggerViewOf(tx, environmentId, target.definition, document);
  if (!admitted(context, view) || !snapshotFits(view)) {
    return null;
  }
  return startWorkflowRunInTx(tx, engineDepsOf(deps), {
    environmentId,
    workflowId,
    workflowVersionId: target.version.id,
    deploymentId: target.deploymentId,
    rolloutLabel: target.rolloutLabel,
    triggerType: 'trigger-recurring',
    scheduleFire: `${schedule.id}/${fireTime}/${objectId}`,
    creator: null,
    trigger: view,
    inputs: {},
    subjectIds: [objectId],
    grant: target.grant,
    oneRunPerSubject: target.definition.trigger?.['one-run-per-subject'] === true ? objectId : null,
  });
}

/** The objects of a tick and where the next one starts. */
async function runTick(context: TickContext): Promise<{
  started: StartedWorkflowRun[];
  cursor: string | null;
}> {
  const { tx, deps, schedule, now } = context;
  const started: StartedWorkflowRun[] = [];
  const page = await listWorkflowObjectsAfter(tx, schedule.environmentId, schedule.objectType, {
    cursor: schedule.cursor,
    limit: OBJECTS_READ_PER_TICK,
  });
  let cursor = schedule.cursor;
  for (const objectId of page) {
    if (started.length >= schedule.batchCap) {
      return { started, cursor };
    }
    const held = await deferredUntil(deps.services.rateLimiter, now, [
      runGuard(schedule.environmentId),
    ]);
    if (held !== null) {
      return { started, cursor };
    }
    const run = await startFor(context, objectId);
    if (run?.created === true) {
      started.push(run);
    }
    cursor = objectId;
  }
  return { started, cursor: page.length === OBJECTS_READ_PER_TICK ? cursor : null };
}

/**
 * Takes one due schedule, under its row lock. Each run it answers is woken after the commit.
 */
export async function tickWorkflowSchedule(
  tx: Db,
  deps: WorkflowWorkerDeps,
  schedule: WorkflowScheduleRow,
  now: Date,
): Promise<readonly StartedWorkflowRun[]> {
  const { environmentId, id, workflowId, cursor } = schedule;
  const tick = tickOf(schedule, now);
  if (tick === null) {
    return [];
  }
  if (tick === 'unreadable') {
    await advanceWorkflowSchedule(tx, environmentId, id, {
      nextFireAt: new Date(now.getTime() + DAY_MS),
      lastFiredAt: now,
      cursor,
    });
    deps.logger.error({ scheduleId: id, workflowId }, 'a recurring schedule cannot be read');
    return [];
  }
  const advance = (lastCursor: string | null) =>
    advanceWorkflowSchedule(tx, environmentId, id, {
      nextFireAt: new Date(tick.nextFireAt),
      lastFiredAt: new Date(tick.fireTime),
      cursor: lastCursor,
    });
  const live = await getWorkflowLiveTarget(tx, environmentId, workflowId);
  const filter = filterOf(schedule);
  if (live?.workflow.status !== 'running' || filter === 'unreadable') {
    await advance(cursor);
    return [];
  }
  const { started, cursor: next } = await runTick({
    tx,
    deps,
    schedule,
    live,
    filter,
    fireTime: tick.fireTime,
    now,
  });
  await advance(next);
  return started;
}
