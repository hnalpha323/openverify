/**
 * C152.2, C150.9, C174.3 (Workflow 9A; V09): `flow-action-sweep`, every 15 s: it ends the
 * `run_workflow` waits past their timeout (canceling the run through Phase 8's cancellation) and the
 * branch waits past their deadline, advancing each under the inquiry's row lock. Owner:
 * `api-flow-actions`; registered by `foundation-9a` (Stage 1b (S)) in `jobs/repeatable/index.ts`
 * whenever the worker runs the flow's jobs.
 *
 * One pass: the running `run_workflow` entries entered before now, oldest first, each settled in
 * its own transaction under the inquiry's row lock (`settleFlowActionInTx`): a run that ended
 * finishes the entry, which is advanced (`action-finished`); a run past its timeout is canceled
 * after that transaction commits (a run's step locks the run, then the inquiry, so cancelling under
 * the inquiry's lock would invert the order), and a second transaction takes `error` (`timeout`).
 * Then the waiting branch entries whose `waitFor.maxSeconds` has passed are advanced
 * (`wait-elapsed`), the step record and the position re-read under the lock, so a wait the session
 * poll or the snapshot job ended meanwhile is left. A redacted inquiry is never touched (Phase 6's
 * guard); an entry that fails is logged with its ids and a code, never a value, and tried again on
 * the next pass. The worker's repeatable deps carry no event producer, so events are written to the
 * outbox and the delivery sweep sends them (`createOutboxOnlyPublisher`).
 */
import {
  getWaitingBranchEntry,
  listRunningInquiryFlowActions,
  listWaitingBranchEntries,
  lockInquiry,
  type Db,
  type InquiryFlowAction,
  type WaitingBranchEntry,
} from '@openverify/db';
import {
  createOutboxOnlyPublisher,
  type StagedEvent,
  type TransactionalEventPublisher,
} from '../../events/index.js';
import { pinnedFlowV2 } from '../../flow-actions/pinned.js';
import {
  settleFlowActionInTx,
  type FlowActionDeps,
  type FlowActionOutcome,
} from '../../flow-actions/run-action.js';
import {
  advanceFlowInTx,
  runFlowAfterCommit,
  type FlowAdvance,
  type FlowInquiryRef,
} from '../../flow-engine/advance.js';
import type { Clock, IdGenerator, WorkflowStepQueue } from '../../ports.js';
import type { RepeatableJob } from '../../worker.js';
import type { WorkerLogger } from '../logger.js';
import { FLOW_ACTION_SWEEP_INTERVAL_MS, FLOW_ACTION_SWEEP_QUEUE } from '../flow-queues.js';
import type { RepeatableJobDeps } from './index.js';

/** What one pass reads; without `events` it writes the outbox only and the delivery sweep sends. */
export interface FlowActionSweepDeps {
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  events?: TransactionalEventPublisher | undefined;
  ids?: IdGenerator | undefined;
  workflowSteps?: WorkflowStepQueue | undefined;
}

/** Counts only, never a value. */
export interface FlowActionSweepResult {
  /** `run_workflow` entries whose run ended, finished and advanced. */
  settled: number;
  /** Runs canceled at their timeout (C152.2). */
  canceled: number;
  /** Branch waits past their deadline, advanced (C150.9, V09). */
  waitsEnded: number;
  /** Entries a pass could not settle; each is logged and tried again on the next pass. */
  failed: number;
}

/**
 * Entries per list per pass (ours, provisional): a pass every 15 s settles up to 100 run waits and
 * 100 branch waits; what is left waits for the next pass, and the session poll settles its own.
 */
export const FLOW_ACTION_SWEEP_LIMIT = 100;

/** The stable code a failed entry is logged with. */
export const FLOW_ACTION_SWEEP_FAILED = 'flow_action_sweep_failed';

interface Pass {
  deps: FlowActionDeps & { db: Db };
  events: TransactionalEventPublisher;
  result: FlowActionSweepResult;
}

/** Dispatches what a committed transaction staged, then runs the advance's after-commit work. */
async function afterCommit(
  pass: Pass,
  staged: readonly StagedEvent[],
  advance: FlowAdvance | null,
): Promise<void> {
  await pass.events.dispatch([...staged, ...(advance?.staged ?? [])]);
  await runFlowAfterCommit(advance);
}

type Settled = { outcome: FlowActionOutcome; advance: FlowAdvance | null } | null;

/** One settle of a running entry under the inquiry's lock; advances it once it is done. */
function settleOnce(pass: Pass, ref: FlowInquiryRef, row: InquiryFlowAction): Promise<Settled> {
  return pass.deps.db.transaction(async (tx) => {
    await lockInquiry(tx, ref.environmentId, ref.inquiryId);
    const pinned = await pinnedFlowV2(tx, ref);
    const step = pinned?.flow.steps.find(({ id }) => id === row.stepId);
    if (step?.type !== 'action') {
      return null;
    }
    const entry = { stepId: row.stepId, entry: row.entry, action: step.action };
    const outcome = await settleFlowActionInTx(tx, pass.deps, ref, entry);
    const advance =
      outcome.state === 'done'
        ? await advanceFlowInTx(tx, pass.deps, ref, {
            kind: 'action-finished',
            stepId: row.stepId,
            entry: row.entry,
            port: outcome.port,
          })
        : null;
    return { outcome, advance };
  });
}

/** Settles one running entry: once, or, past its timeout, cancel then settle again. */
async function sweepAction(pass: Pass, row: InquiryFlowAction): Promise<void> {
  const ref = { environmentId: row.environmentId, inquiryId: row.inquiryId };
  const first = await settleOnce(pass, ref, row);
  if (first === null) {
    return;
  }
  await afterCommit(pass, first.outcome.staged, first.advance);
  if (first.outcome.state === 'done') {
    pass.result.settled += 1;
    return;
  }
  if (first.outcome.cancelDue !== true) {
    return;
  }
  await first.outcome.after?.();
  pass.result.canceled += 1;
  const second = await settleOnce(pass, ref, row);
  if (second !== null) {
    await afterCommit(pass, second.outcome.staged, second.advance);
    if (second.outcome.state === 'done') {
      pass.result.settled += 1;
    }
  }
}

/** Ends one branch wait past its deadline, re-read under the lock. */
async function sweepWait(pass: Pass, waiting: WaitingBranchEntry): Promise<void> {
  const ref = { environmentId: waiting.environmentId, inquiryId: waiting.inquiryId };
  const now = pass.deps.clock.now().getTime();
  const advance = await pass.deps.db.transaction(async (tx) => {
    await lockInquiry(tx, ref.environmentId, ref.inquiryId);
    const pinned = await pinnedFlowV2(tx, ref);
    const step = pinned?.flow.steps.find(({ id }) => id === waiting.stepId);
    const current = await getWaitingBranchEntry(tx, ref.environmentId, {
      inquiryId: ref.inquiryId,
      stepRecordSeq: waiting.stepRecordSeq,
    });
    if (step?.type !== 'branch' || current === null) {
      return null;
    }
    // A waiting branch without waitFor waits for nothing: its deadline is its entry.
    const deadline = current.enteredAt.getTime() + (step.waitFor?.maxSeconds ?? 0) * 1_000;
    if (now < deadline) {
      return null;
    }
    return advanceFlowInTx(tx, pass.deps, ref, {
      kind: 'wait-elapsed',
      stepRecordSeq: waiting.stepRecordSeq,
    });
  });
  if (advance !== null) {
    await afterCommit(pass, [], advance);
    pass.result.waitsEnded += 1;
  }
}

async function each<T extends { environmentId: string; inquiryId: string }>(
  pass: Pass,
  logger: WorkerLogger,
  items: readonly T[],
  stepIdOf: (item: T) => string,
  work: (item: T) => Promise<void>,
): Promise<void> {
  for (const item of items) {
    try {
      await work(item);
    } catch {
      pass.result.failed += 1;
      logger.error(
        {
          'inquiry-id': item.inquiryId,
          'environment-id': item.environmentId,
          'step-id': stepIdOf(item),
          reason: FLOW_ACTION_SWEEP_FAILED,
        },
        'A flow wait could not be settled; the next pass tries it again.',
      );
    }
  }
}

/** One pass of the sweep (C152.2, C150.9). */
export async function runFlowActionSweep(
  deps: FlowActionSweepDeps,
  options: { limit?: number } = {},
): Promise<FlowActionSweepResult> {
  const { db, clock, logger } = deps;
  const events = deps.events ?? createOutboxOnlyPublisher(db);
  const limit = options.limit ?? FLOW_ACTION_SWEEP_LIMIT;
  const pass: Pass = {
    deps: {
      db,
      clock,
      events,
      ids: deps.ids,
      workflowSteps: deps.workflowSteps,
    },
    events,
    result: { settled: 0, canceled: 0, waitsEnded: 0, failed: 0 },
  };
  const now = clock.now();
  const running = await listRunningInquiryFlowActions(db, { enteredBefore: now, limit });
  await each(
    pass,
    logger,
    running,
    (row) => row.stepId,
    (row) => sweepAction(pass, row),
  );
  const waits = await listWaitingBranchEntries(db, { enteredBefore: now, limit });
  await each(
    pass,
    logger,
    waits,
    (wait) => wait.stepId,
    (wait) => sweepWait(pass, wait),
  );
  return pass.result;
}

/** The flow's sweep (C152.2, C150.9), every 15 s. */
export function flowActionSweepJob(
  deps: RepeatableJobDeps,
  producers: Pick<FlowActionSweepDeps, 'events' | 'workflowSteps'> = {},
  runPass: (passDeps: FlowActionSweepDeps) => Promise<FlowActionSweepResult> = runFlowActionSweep,
): RepeatableJob {
  return {
    name: FLOW_ACTION_SWEEP_QUEUE,
    repeat: { every: FLOW_ACTION_SWEEP_INTERVAL_MS },
    run: () =>
      runPass({
        db: deps.db,
        clock: deps.clock,
        logger: deps.logger,
        // C152.2 (Workflow 9A Stage 4): the worker's publisher delivers at once; without it the
        // events wait in the outbox for the delivery sweep.
        ...(producers.events === undefined ? {} : { events: producers.events }),
        ...(producers.workflowSteps === undefined
          ? {}
          : { workflowSteps: producers.workflowSteps }),
      }),
  };
}
