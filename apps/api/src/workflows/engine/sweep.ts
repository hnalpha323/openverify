/**
 * C143.1, C117.4, C117.9: `workflow-step-sweep` and `workflow-wait-match-sweep`. Postgres is the only
 * record, so everything a lost Valkey could lose is found here: ready steps nobody enqueued, leases
 * that lapsed, timers, waits past their timeout and runs past their deadline. Each row is taken in a
 * transaction of its own, conditionally, so two sweepers do it once. No sweep holds a step row while
 * it wants a run row: the run's lock always comes first (`advance-run.ts`).
 */
import {
  appendWorkflowJournal,
  clearStaleWorkflowStepEnqueues,
  listDueWorkflowTimers,
  listExpiredWorkflowStepClaims,
  listTimedOutWorkflowWaits,
  listUnprocessedWaitCandidates,
  listWorkflowRunsPastDeadline,
  lockWorkflowRun,
  markWorkflowStepsEnqueued,
  reclaimWorkflowRunStep,
  settleWorkflowRunStep,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
} from '@openverify/db';
import { stepKey, workflowErrorTypeOf, type JsonRecord } from '@openverify/workflow-engine';
import type { WorkflowWaitMatchQueue } from '../../ports.js';
import {
  applyCompletion,
  emptyAfterCommit,
  finishRun,
  flushAfterCommit,
  openSession,
  type AfterCommit,
} from './advance-run.js';
import { databaseNow, type EngineDeps } from './deps.js';
import { dispatchReadySteps } from './dispatcher.js';
import { loadRun } from './run-frame.js';
import { TIMER_HORIZON_MS } from './wait-resolution.js';

const BATCH = 500;
/** C117.9 (ours): an enqueue older than this was lost with Valkey. */
const STALE_ENQUEUE_MS = 300_000;

/** C119.3: a timed-out wait's output says so; C128.2 reads it. */
export const TIMED_OUT_OUTPUT: JsonRecord = {
  'resolved-by': 'timeout',
  'event-id': null,
  'event-name': null,
  'resolver-type': null,
  'resolver-id': null,
  'resolved-via': null,
  'resolver-held-inquiries-write': null,
};

/** C119.3: the event and the timeout race on one row, and a conditional update leaves one winner. */
export async function timeOutWait(
  deps: EngineDeps,
  step: WorkflowRunStepRow,
  after: AfterCommit,
): Promise<void> {
  const { environmentId, runId, nodeId, iterationPath } = step;
  await deps.db.transaction(async (tx) => {
    const run = await lockWorkflowRun(tx, environmentId, runId);
    if (run?.status !== 'in_progress') {
      return;
    }
    const now = await databaseNow(tx);
    const loaded = await loadRun(tx, run, now);
    const session = await openSession(tx, deps, loaded, after);
    const wait = loaded.frame.actionWaits[stepKey(iterationPath, nodeId)];
    const code = wait?.timeoutCode ?? null;
    const settled = await settleWorkflowRunStep(tx, environmentId, {
      stepId: step.id,
      status: code === null ? 'timed_out' : 'failed',
      output: TIMED_OUT_OUTPUT,
      errorType: code === null ? null : workflowErrorTypeOf(code),
      errorCode: code,
      at: session.now,
      from: ['waiting'],
    });
    if (settled === null) {
      return;
    }
    session.journal.push({ runId, kind: 'wait_timed_out', stepId: step.id, nodeId, iterationPath });
    await applyCompletion(
      session,
      code === null
        ? { kind: 'step', nodeId, iterationPath, outcome: 'timed_out', output: TIMED_OUT_OUTPUT }
        : { kind: 'step', nodeId, iterationPath, outcome: 'failed', code },
    );
  });
}

async function reclaimLapsed(deps: EngineDeps, step: WorkflowRunStepRow): Promise<void> {
  const { claimedBy } = step;
  if (claimedBy === null) {
    return;
  }
  await deps.db.transaction(async (tx) => {
    const reclaimed = await reclaimWorkflowRunStep(tx, step.environmentId, {
      stepId: step.id,
      claimedBy,
    });
    if (reclaimed !== null) {
      await appendWorkflowJournal(tx, step.environmentId, [
        {
          runId: step.runId,
          kind: 'step_reclaimed',
          stepId: step.id,
          nodeId: step.nodeId,
          iterationPath: step.iterationPath,
          attempt: step.attempt,
        },
      ]);
    }
  });
}

/** C117.7: `run-failure`, nothing absorbs it, and a resume cannot take it back. */
async function endPastDeadline(
  deps: EngineDeps,
  past: WorkflowRunRow,
  after: AfterCommit,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const run = await lockWorkflowRun(tx, past.environmentId, past.id);
    if (run?.status !== 'in_progress') {
      return;
    }
    const now = await databaseNow(tx);
    const loaded = await loadRun(tx, run, now);
    const session = await openSession(tx, deps, loaded, after);
    loaded.state = {
      ...loaded.state,
      status: 'errored',
      failures: [
        { nodeId: null, iterationPath: '', code: 'run_deadline_exceeded' },
        ...loaded.state.failures,
      ],
    };
    await finishRun(session);
  });
}

/** C117.9: a timer becomes a delayed job within the hour, and a due one a job at once. */
async function enqueueTimers(deps: EngineDeps, now: Date): Promise<void> {
  const { steps } = deps;
  if (steps === undefined) {
    return;
  }
  const horizon = new Date(now.getTime() + TIMER_HORIZON_MS);
  const due = await deps.db.transaction(async (tx) => {
    const timers = await listDueWorkflowTimers(tx, { now, horizon, limit: BATCH });
    for (const { environmentId, id } of timers) {
      await markWorkflowStepsEnqueued(tx, environmentId, [id], now);
    }
    return timers;
  });
  for (const step of due) {
    const delayMs = Math.max(0, (step.dueAt?.getTime() ?? 0) - now.getTime());
    try {
      await steps.enqueueWorkflowStep(
        {
          environmentId: step.environmentId,
          runId: step.runId,
          stepId: step.id,
          attempt: step.attempt + 1,
        },
        delayMs === 0 ? {} : { delayMs },
      );
    } catch {
      await markWorkflowStepsEnqueued(deps.db, step.environmentId, [step.id], null);
    }
  }
}

/**
 * R002 (Workflow 8C review): one row's failure is logged by its ids and the error's name alone, and the
 * sweep goes on; the row stays as it was, for a later sweep.
 */
async function eachRow<Row extends { id: string; environmentId: string }>(
  deps: EngineDeps,
  phase: string,
  rows: readonly Row[],
  ids: (row: Row) => Record<string, string>,
  work: (row: Row) => Promise<void>,
): Promise<void> {
  for (const row of rows) {
    try {
      await work(row);
    } catch (error) {
      deps.logger?.warn(
        {
          phase,
          environmentId: row.environmentId,
          ...ids(row),
          error: error instanceof Error ? error.name : 'unknown',
        },
        'a workflow sweep row failed; a later sweep will take it',
      );
    }
  }
}

/** C143.1: `workflow-step-sweep`. */
export async function sweepWorkflowSteps(deps: EngineDeps): Promise<void> {
  const now = await databaseNow(deps.db);
  const after = emptyAfterCommit();
  try {
    await clearStaleWorkflowStepEnqueues(deps.db, {
      before: new Date(now.getTime() - STALE_ENQUEUE_MS),
    });
    const stepIds = (step: WorkflowRunStepRow) => ({ runId: step.runId, stepId: step.id });
    await eachRow(
      deps,
      'reclaim',
      await listExpiredWorkflowStepClaims(deps.db, { now, limit: BATCH }),
      stepIds,
      (step) => reclaimLapsed(deps, step),
    );
    await enqueueTimers(deps, now);
    await eachRow(
      deps,
      'wait-timeout',
      await listTimedOutWorkflowWaits(deps.db, { now, limit: BATCH }),
      stepIds,
      (step) => timeOutWait(deps, step, after),
    );
    await eachRow(
      deps,
      'run-deadline',
      await listWorkflowRunsPastDeadline(deps.db, { now, limit: BATCH }),
      (run: WorkflowRunRow) => ({ runId: run.id }),
      (run) => endPastDeadline(deps, run, after),
    );
  } finally {
    // What the rows that went through committed, and every environment's ready steps, whatever the
    // rest of the sweep met.
    try {
      await flushAfterCommit(deps, after);
    } finally {
      await dispatchReadySteps(deps);
    }
  }
}

/** C119.3: `workflow-wait-match-sweep`, the outbox behind every candidate. */
export async function sweepWaitCandidates(
  deps: EngineDeps,
  queue: WorkflowWaitMatchQueue,
): Promise<void> {
  for (const candidate of await listUnprocessedWaitCandidates(deps.db, { limit: BATCH })) {
    await queue.enqueueWorkflowWaitMatch({
      environmentId: candidate.environmentId,
      eventId: candidate.eventId,
    });
  }
}
