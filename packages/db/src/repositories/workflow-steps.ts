/**
 * C117.2-C117.4, C119 (Workflow 8A): `workflow_run_steps`. Owner: `api-engine`.
 *
 * `input`, `output` and `console` are sealed for the row (`SEALED.workflowStepInput` and its
 * neighbours). Completion writes only `WHERE id = $step AND claimed_by = $token AND status =
 * 'running'` (C74.1, C117.3).
 */
import type { WorkflowNodeType, WorkflowStepStatus } from '@openverify/core';
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptionalJson, sealOptionalJson } from '../sealed.js';
import {
  queueSlots,
  workflowRunSteps,
  workflowWaitCandidates,
  workflowWaitIndex,
  type WorkflowRunStepRow,
} from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';

export interface NewWorkflowRunStep {
  id: string;
  runId: string;
  nodeId: string;
  iterationPath: string;
  nodeType: WorkflowNodeType;
  actionKey?: string | null | undefined;
  actionVersion?: number | null | undefined;
  status: WorkflowStepStatus;
  dueAt?: Date | null | undefined;
  joinRemaining?: number | null | undefined;
  input?: Readonly<Record<string, unknown>> | null | undefined;
}

export interface WorkflowStepClaim {
  stepId: string;
  claimedBy: string;
  claimedUntil: Date;
}

export interface WorkflowStepCompletion {
  stepId: string;
  claimedBy: string;
  status: Exclude<WorkflowStepStatus, 'pending' | 'ready' | 'running' | 'waiting'>;
  output?: Readonly<Record<string, unknown>> | null | undefined;
  errorType?: string | null | undefined;
  errorCode?: string | null | undefined;
  /** C120.7: a test run's step that made no effect. */
  simulated?: boolean | undefined;
  /** C120.7, C123.4: a sandbox test run's capture. */
  console?: readonly string[] | undefined;
  at: Date;
}

export interface WorkflowStepSweepOptions {
  limit: number;
  now: Date;
  /** One environment's turn (C117.8); every environment when left out. */
  environmentId?: string | undefined;
}

/** C117.6: a retry, or a claim given back before rethrowing (C117.4). */
export interface WorkflowStepRelease {
  stepId: string;
  claimedBy: string;
  dueAt: Date | null;
}

/** A step's sealed values, opened. */
export interface WorkflowStepValues {
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  console: string[] | null;
}

type StepRecord = Record<string, unknown>;

/** The sealed values of a step, for the engine and for the masked read routes (C120.6). */
export function openWorkflowStepValues(step: WorkflowRunStepRow): WorkflowStepValues {
  return {
    input: openOptionalJson(
      SEALED.workflowStepInput,
      step.id,
      step.inputSealed,
    ) as StepRecord | null,
    output: openOptionalJson(
      SEALED.workflowStepOutput,
      step.id,
      step.outputSealed,
    ) as StepRecord | null,
    console: openOptionalJson(SEALED.workflowStepConsole, step.id, step.consoleSealed) as
      string[] | null,
  };
}

const stepIn = (environmentId: string, id: string) =>
  and(eq(workflowRunSteps.environmentId, environmentId), eq(workflowRunSteps.id, id));

const held = (environmentId: string, stepId: string, claimedBy: string) =>
  and(
    stepIn(environmentId, stepId),
    eq(workflowRunSteps.claimedBy, claimedBy),
    eq(workflowRunSteps.status, 'running'),
  );

/**
 * C117.2: a step row per node and iteration path. A row that exists is left as it is and answered,
 * so a re-entered step (a resume, C120.3) keeps its attempts: {@link readyWorkflowRunStep} moves it.
 */
export async function createWorkflowRunSteps(
  tx: Db,
  environmentId: string,
  steps: readonly NewWorkflowRunStep[],
): Promise<WorkflowRunStepRow[]> {
  if (steps.length === 0) {
    return [];
  }
  const created = await tx
    .insert(workflowRunSteps)
    .values(
      steps.map((step) => ({
        id: step.id,
        environmentId,
        runId: step.runId,
        nodeId: step.nodeId,
        iterationPath: step.iterationPath,
        nodeType: step.nodeType,
        actionKey: step.actionKey ?? null,
        actionVersion: step.actionVersion ?? null,
        status: step.status,
        dueAt: step.dueAt ?? null,
        joinRemaining: step.joinRemaining ?? null,
        inputSealed: sealOptionalJson(SEALED.workflowStepInput, step.id, step.input),
      })),
    )
    .onConflictDoNothing()
    .returning();
  return created;
}

/** The row of a node at an iteration path. */
export async function findWorkflowRunStep(
  db: Db,
  environmentId: string,
  input: { runId: string; nodeId: string; iterationPath: string },
): Promise<WorkflowRunStepRow | null> {
  const [row] = await db
    .select()
    .from(workflowRunSteps)
    .where(
      and(
        eq(workflowRunSteps.environmentId, environmentId),
        eq(workflowRunSteps.runId, input.runId),
        eq(workflowRunSteps.nodeId, input.nodeId),
        eq(workflowRunSteps.iterationPath, input.iterationPath),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getWorkflowRunStep(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowRunStepRow | null> {
  const [row] = await db.select().from(workflowRunSteps).where(stepIn(environmentId, id)).limit(1);
  return row ?? null;
}

const stepCursor = environmentCursor(workflowRunSteps);

/** Served newest first by `GET /workflow-runs/:id/steps`. */
export async function listWorkflowRunSteps(
  db: Db,
  environmentId: string,
  runId: string,
  page: PageRequest,
): Promise<Page<WorkflowRunStepRow>> {
  return paginate(db, stepCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(workflowRunSteps)
      .where(
        and(
          eq(workflowRunSteps.environmentId, environmentId),
          eq(workflowRunSteps.runId, runId),
          after,
        ),
      )
      .orderBy(...newestFirst(stepCursor))
      .limit(limit),
  );
}

/** C117.1: every row of a run, for its state's outputs. */
export async function listAllWorkflowRunSteps(
  db: Db,
  environmentId: string,
  runId: string,
): Promise<WorkflowRunStepRow[]> {
  return db
    .select()
    .from(workflowRunSteps)
    .where(
      and(eq(workflowRunSteps.environmentId, environmentId), eq(workflowRunSteps.runId, runId)),
    )
    .orderBy(asc(workflowRunSteps.createdAt), asc(workflowRunSteps.id));
}

/** C117.3: `WHERE id = $step AND status = 'ready'`; `null` when another worker got there first. */
export async function claimWorkflowRunStep(
  tx: Db,
  environmentId: string,
  claim: WorkflowStepClaim,
): Promise<WorkflowRunStepRow | null> {
  const [row] = await tx
    .update(workflowRunSteps)
    .set({
      status: 'running',
      claimedBy: claim.claimedBy,
      claimedUntil: claim.claimedUntil,
      attempt: sql`${workflowRunSteps.attempt} + 1`,
      claims: sql`${workflowRunSteps.claims} + 1`,
      startedAt: sql`coalesce(${workflowRunSteps.startedAt}, now())`,
      enqueuedAt: null,
    })
    .where(and(stepIn(environmentId, claim.stepId), eq(workflowRunSteps.status, 'ready')))
    .returning();
  return row ?? null;
}

/** C117.4: a heartbeat; `false` when the claim is no longer held. */
export async function extendWorkflowStepClaim(
  tx: Db,
  environmentId: string,
  claim: WorkflowStepClaim,
): Promise<boolean> {
  const rows = await tx
    .update(workflowRunSteps)
    .set({ claimedUntil: claim.claimedUntil })
    .where(held(environmentId, claim.stepId, claim.claimedBy))
    .returning({ id: workflowRunSteps.id });
  return rows.length > 0;
}

/** C117.4, C117.6: gives a claim back, for the sweep or a retry's `due_at`. */
export async function releaseWorkflowStepClaim(
  tx: Db,
  environmentId: string,
  release: WorkflowStepRelease,
): Promise<WorkflowRunStepRow | null> {
  const [row] = await tx
    .update(workflowRunSteps)
    .set({
      status: 'ready',
      claimedBy: null,
      claimedUntil: null,
      enqueuedAt: null,
      dueAt: release.dueAt,
    })
    .where(held(environmentId, release.stepId, release.claimedBy))
    .returning();
  return row ?? null;
}

/** C117.4: a sweeper takes a lapsed claim back. Conditional, so two sweepers reclaim it once. */
export async function reclaimWorkflowRunStep(
  tx: Db,
  environmentId: string,
  input: { stepId: string; claimedBy: string },
): Promise<WorkflowRunStepRow | null> {
  return releaseWorkflowStepClaim(tx, environmentId, { ...input, dueAt: null });
}

/** C117.3: fenced by the claim token; `null` when the claim was lost. */
export async function completeWorkflowRunStep(
  tx: Db,
  environmentId: string,
  completion: WorkflowStepCompletion,
): Promise<WorkflowRunStepRow | null> {
  const [row] = await tx
    .update(workflowRunSteps)
    .set({
      ...finished(completion),
      ...(completion.simulated === undefined ? {} : { simulated: completion.simulated }),
      ...(completion.console === undefined
        ? {}
        : {
            consoleSealed: sealOptionalJson(
              SEALED.workflowStepConsole,
              completion.stepId,
              completion.console,
            ),
          }),
      outputSealed: sealOptionalJson(
        SEALED.workflowStepOutput,
        completion.stepId,
        completion.output,
      ),
    })
    .where(held(environmentId, completion.stepId, completion.claimedBy))
    .returning();
  return row ?? null;
}

const finished = (completion: {
  status: WorkflowStepStatus;
  errorType?: string | null | undefined;
  errorCode?: string | null | undefined;
  at: Date;
}) => ({
  status: completion.status,
  claimedBy: null,
  claimedUntil: null,
  enqueuedAt: null,
  errorType: completion.errorType ?? null,
  errorCode: completion.errorCode ?? null,
  completedAt: completion.at,
});

/** A step's row written by the run's lock holder: control flow, a wait's end, a fail before a claim. */
export async function settleWorkflowRunStep(
  tx: Db,
  environmentId: string,
  settlement: {
    stepId: string;
    status: WorkflowStepStatus;
    output?: Readonly<Record<string, unknown>> | null | undefined;
    errorType?: string | null | undefined;
    errorCode?: string | null | undefined;
    at: Date;
    /** Only from these statuses: a race with a timeout or a cancel leaves one winner (C119.3). */
    from?: readonly WorkflowStepStatus[] | undefined;
    /** C120.7: a test run's override, or a step it only simulated. */
    overridden?: boolean | undefined;
    simulated?: boolean | undefined;
  },
): Promise<WorkflowRunStepRow | null> {
  const [row] = await tx
    .update(workflowRunSteps)
    .set({
      ...finished(settlement),
      ...(settlement.overridden === undefined ? {} : { overridden: settlement.overridden }),
      ...(settlement.simulated === undefined ? {} : { simulated: settlement.simulated }),
      ...(settlement.output === undefined
        ? {}
        : {
            outputSealed: sealOptionalJson(
              SEALED.workflowStepOutput,
              settlement.stepId,
              settlement.output,
            ),
          }),
    })
    .where(
      and(
        stepIn(environmentId, settlement.stepId),
        settlement.from === undefined
          ? undefined
          : inArray(workflowRunSteps.status, [...settlement.from]),
      ),
    )
    .returning();
  return row ?? null;
}

/** C120.3: a finished row becomes ready again, its attempts carrying on. */
export async function readyWorkflowRunStep(
  tx: Db,
  environmentId: string,
  stepId: string,
): Promise<WorkflowRunStepRow | null> {
  const [row] = await tx
    .update(workflowRunSteps)
    .set({
      status: 'ready',
      claimedBy: null,
      claimedUntil: null,
      enqueuedAt: null,
      dueAt: null,
      errorType: null,
      errorCode: null,
      completedAt: null,
    })
    .where(stepIn(environmentId, stepId))
    .returning();
  return row ?? null;
}

/** The fields of a wait (C119.2, C119.3). A time wait has none of the event members. */
export interface WorkflowWaitEntry {
  stepId: string;
  dueAt?: Date | null | undefined;
  timeoutAt?: Date | null | undefined;
  eventNames?: readonly string[] | undefined;
  correlationKey?: string | undefined;
  filter?: Readonly<Record<string, unknown>> | null | undefined;
  filterOnNull?: string | null | undefined;
  /** An action's own wait keeps its claim until here (C127.2). */
  claimedBy?: string | undefined;
  /**
   * K8-6: an action's wait takes the snapshot of {@link currentWorkflowSnapshot} from before the
   * action read its object, so what finished after that read resolves it. Absent: now.
   */
  snapshot?: string | undefined;
}

/** K8-6: the transaction's snapshot now, as text, for a wait entered later. */
export async function currentWorkflowSnapshot(tx: Db): Promise<string> {
  const result = await tx.execute(sql`select pg_current_snapshot()::text as snapshot`);
  const [row] = (result as { rows: { snapshot: string }[] }).rows;
  if (row === undefined) {
    throw new Error('pg_current_snapshot answered no row');
  }
  return row.snapshot;
}

/**
 * C119.2, C119.3: a step enters `waiting`. The snapshot and the transaction id are taken here, so the
 * caller takes the advisory lock first: what committed before this statement is visible in the
 * snapshot and never resolves the wait.
 */
export async function enterWorkflowWait(
  tx: Db,
  environmentId: string,
  entry: WorkflowWaitEntry,
): Promise<WorkflowRunStepRow | null> {
  const [row] = await tx
    .update(workflowRunSteps)
    .set({
      status: 'waiting',
      claimedBy: null,
      claimedUntil: null,
      enqueuedAt: null,
      dueAt: entry.dueAt ?? null,
      timeoutAt: entry.timeoutAt ?? null,
      waitEventNames: entry.eventNames === undefined ? null : [...entry.eventNames],
      waitCorrelationKey: entry.correlationKey ?? null,
      waitFilter: entry.filter === undefined || entry.filter === null ? null : { ...entry.filter },
      waitFilterOnNull: entry.filterOnNull ?? null,
      waitingSnapshot:
        entry.snapshot === undefined
          ? sql`pg_current_snapshot()`
          : sql`${entry.snapshot}::pg_snapshot`,
      waitingXact: sql`pg_current_xact_id()`,
      resolvedByEventId: null,
      errorType: null,
      errorCode: null,
      completedAt: null,
    })
    .where(
      and(
        stepIn(environmentId, entry.stepId),
        entry.claimedBy === undefined ? undefined : eq(workflowRunSteps.claimedBy, entry.claimedBy),
      ),
    )
    .returning();
  return row ?? null;
}

/** C119.3: `waiting` to `ready`, recording the event. Under Read Committed one of two callers wins. */
export async function resolveWorkflowWait(
  tx: Db,
  environmentId: string,
  stepId: string,
  eventId: string,
): Promise<WorkflowRunStepRow | null> {
  const [row] = await tx
    .update(workflowRunSteps)
    .set({
      status: 'ready',
      resolvedByEventId: eventId,
      dueAt: null,
      enqueuedAt: null,
    })
    .where(and(stepIn(environmentId, stepId), eq(workflowRunSteps.status, 'waiting')))
    .returning();
  return row ?? null;
}

/** C119.2: a time wait that came due moves to `ready`, once. */
export async function readyDueWorkflowTimer(
  tx: Db,
  environmentId: string,
  stepId: string,
  now: Date,
): Promise<WorkflowRunStepRow | null> {
  const [row] = await tx
    .update(workflowRunSteps)
    .set({ status: 'ready', dueAt: null, enqueuedAt: null })
    .where(
      and(
        stepIn(environmentId, stepId),
        eq(workflowRunSteps.status, 'waiting'),
        lte(workflowRunSteps.dueAt, now),
      ),
    )
    .returning();
  return row ?? null;
}

/** C119.3: the same advisory lock on both sides, taken only in the engine's own transactions. */
export async function takeWorkflowCorrelationLock(
  tx: Db,
  environmentId: string,
  correlationKey: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${environmentId}/${correlationKey}`}, 0))`,
  );
}

export interface WaitCandidate {
  eventId: string;
  environmentId: string;
  eventName: string;
  subjectIds: string[];
  xact: string;
  processedAt: Date | null;
}

/** C119.3: in the event's own transaction, with no lock. */
export async function hasWorkflowWaitIndex(
  tx: Db,
  environmentId: string,
  eventName: string,
): Promise<boolean> {
  const rows = await tx
    .select({ eventName: workflowWaitIndex.eventName })
    .from(workflowWaitIndex)
    .where(
      and(
        eq(workflowWaitIndex.environmentId, environmentId),
        eq(workflowWaitIndex.eventName, eventName),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function insertWorkflowWaitCandidate(
  tx: Db,
  candidate: {
    eventId: string;
    environmentId: string;
    eventName: string;
    subjectIds: readonly string[];
  },
): Promise<void> {
  await tx
    .insert(workflowWaitCandidates)
    .values({ ...candidate, subjectIds: [...candidate.subjectIds] })
    .onConflictDoNothing();
}

export async function getWaitCandidate(
  db: Db,
  environmentId: string,
  eventId: string,
): Promise<WaitCandidate | null> {
  const [row] = await db
    .select()
    .from(workflowWaitCandidates)
    .where(
      and(
        eq(workflowWaitCandidates.environmentId, environmentId),
        eq(workflowWaitCandidates.eventId, eventId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** C119.3: the outbox behind the job: unprocessed candidates, oldest first. */
export async function listUnprocessedWaitCandidates(
  db: Db,
  options: { limit: number },
): Promise<WaitCandidate[]> {
  return db
    .select()
    .from(workflowWaitCandidates)
    .where(isNull(workflowWaitCandidates.processedAt))
    .orderBy(asc(workflowWaitCandidates.createdAt))
    .limit(options.limit);
}

export async function markWaitCandidateProcessed(
  db: Db,
  environmentId: string,
  eventId: string,
  at: Date,
): Promise<void> {
  await db
    .update(workflowWaitCandidates)
    .set({ processedAt: at })
    .where(
      and(
        eq(workflowWaitCandidates.environmentId, environmentId),
        eq(workflowWaitCandidates.eventId, eventId),
      ),
    );
}

/** C119.3: deleted once processed and older than the longest wait. */
export async function deleteProcessedWaitCandidates(
  db: Db,
  options: { before: Date; limit: number },
): Promise<number> {
  const due = db
    .select({ eventId: workflowWaitCandidates.eventId })
    .from(workflowWaitCandidates)
    .where(lte(workflowWaitCandidates.processedAt, options.before))
    .limit(options.limit);
  const rows = await db
    .delete(workflowWaitCandidates)
    .where(inArray(workflowWaitCandidates.eventId, due))
    .returning({ eventId: workflowWaitCandidates.eventId });
  return rows.length;
}

/**
 * C119.3: the registration's check: committed candidates for this wait's key and names that its
 * snapshot does not see, leaving out what its own transaction staged. The lock is held, so a candidate
 * committed later waits for it and goes through the job.
 */
export async function listUnseenWaitCandidates(
  tx: Db,
  environmentId: string,
  stepId: string,
): Promise<WaitCandidate[]> {
  return tx
    .select({
      eventId: workflowWaitCandidates.eventId,
      environmentId: workflowWaitCandidates.environmentId,
      eventName: workflowWaitCandidates.eventName,
      subjectIds: workflowWaitCandidates.subjectIds,
      xact: workflowWaitCandidates.xact,
      processedAt: workflowWaitCandidates.processedAt,
    })
    .from(workflowWaitCandidates)
    .innerJoin(
      workflowRunSteps,
      and(
        eq(workflowRunSteps.environmentId, workflowWaitCandidates.environmentId),
        eq(workflowRunSteps.id, stepId),
      ),
    )
    .where(
      and(
        eq(workflowWaitCandidates.environmentId, environmentId),
        sql`${workflowWaitCandidates.eventName} = any(${workflowRunSteps.waitEventNames})`,
        sql`${workflowRunSteps.waitCorrelationKey} = any(${workflowWaitCandidates.subjectIds})`,
        sql`not pg_visible_in_snapshot(${workflowWaitCandidates.xact}, ${workflowRunSteps.waitingSnapshot})`,
        sql`${workflowWaitCandidates.xact} <> ${workflowRunSteps.waitingXact}`,
      ),
    )
    .orderBy(asc(workflowWaitCandidates.createdAt), asc(workflowWaitCandidates.eventId));
}

/**
 * C119.3: the job's side: every `waiting` step with this key and name whose snapshot does not see the
 * candidate. The caller holds the lock, so a registration in flight has committed or has not begun.
 */
export async function listWaitsForCandidate(
  tx: Db,
  environmentId: string,
  correlationKey: string,
  candidate: { eventName: string; xact: string },
): Promise<WorkflowRunStepRow[]> {
  return tx
    .select()
    .from(workflowRunSteps)
    .where(
      and(
        eq(workflowRunSteps.environmentId, environmentId),
        eq(workflowRunSteps.status, 'waiting'),
        eq(workflowRunSteps.waitCorrelationKey, correlationKey),
        sql`${candidate.eventName} = any(${workflowRunSteps.waitEventNames})`,
        sql`not pg_visible_in_snapshot(${candidate.xact}::xid8, ${workflowRunSteps.waitingSnapshot})`,
        sql`${workflowRunSteps.waitingXact} <> ${candidate.xact}::xid8`,
      ),
    );
}

/** C120.1: what a run's steps are doing, for `waiting-on`. */
export interface WorkflowRunStepStates {
  active: number;
  timers: number;
  events: number;
  childRuns: number;
}

export async function countWorkflowRunStepStates(
  tx: Db,
  environmentId: string,
  runId: string,
): Promise<WorkflowRunStepStates> {
  const [row] = await tx
    .select({
      active: sql<number>`count(*) filter (where ${workflowRunSteps.status} in ('ready', 'running'))::int`,
      timers: sql<number>`count(*) filter (where ${workflowRunSteps.status} = 'waiting' and ${workflowRunSteps.dueAt} is not null)::int`,
      events: sql<number>`count(*) filter (where ${workflowRunSteps.status} = 'waiting' and ${workflowRunSteps.waitCorrelationKey} is not null)::int`,
      childRuns: sql<number>`count(*) filter (where ${workflowRunSteps.status} = 'waiting' and ${workflowRunSteps.actionKey} = 'run_workflow')::int`,
    })
    .from(workflowRunSteps)
    .where(
      and(eq(workflowRunSteps.environmentId, environmentId), eq(workflowRunSteps.runId, runId)),
    );
  return row ?? { active: 0, timers: 0, events: 0, childRuns: 0 };
}

/** C117.9: an enqueue lost with Valkey: the step counts as in flight no longer, and goes round. */
export async function clearStaleWorkflowStepEnqueues(
  db: Db,
  options: { before: Date },
): Promise<number> {
  const rows = await db
    .update(workflowRunSteps)
    .set({ enqueuedAt: null })
    .where(
      and(eq(workflowRunSteps.status, 'ready'), lte(workflowRunSteps.enqueuedAt, options.before)),
    )
    .returning({ id: workflowRunSteps.id });
  return rows.length;
}

/** C117.3, C117.8: ready and due, due first, `FOR UPDATE SKIP LOCKED`, not yet enqueued. */
export async function listReadyWorkflowRunSteps(
  tx: Db,
  options: WorkflowStepSweepOptions,
): Promise<WorkflowRunStepRow[]> {
  return tx
    .select()
    .from(workflowRunSteps)
    .where(
      and(
        eq(workflowRunSteps.status, 'ready'),
        options.environmentId === undefined
          ? undefined
          : eq(workflowRunSteps.environmentId, options.environmentId),
        or(isNull(workflowRunSteps.dueAt), lte(workflowRunSteps.dueAt, options.now)),
        isNull(workflowRunSteps.enqueuedAt),
      ),
    )
    .orderBy(sql`${workflowRunSteps.dueAt} asc nulls first`, asc(workflowRunSteps.id))
    .limit(options.limit)
    .for('update', { skipLocked: true });
}

/**
 * The environments with ready steps nobody enqueued, oldest served first (C117.8). R004: it reads one
 * entry per environment, never the backlog: a skip scan of `workflow_run_steps_ready_idx` walks the
 * distinct environments with a ready step, one index probe each, and two probes per environment ask
 * whether one is due (`due_at <= now`, or none) and not enqueued; enqueued rows a probe passes over
 * are bounded by the environment's in-flight cap. Ties go by environment id.
 */
export async function listEnvironmentsWithReadySteps(
  db: Db,
  options: WorkflowStepSweepOptions,
): Promise<string[]> {
  const result = await db.execute(sql`
    with recursive ready_environments(environment_id) as (
      (select environment_id from workflow_run_steps
        where status = 'ready' order by environment_id limit 1)
      union all
      select (select s.environment_id from workflow_run_steps s
               where s.status = 'ready' and s.environment_id > r.environment_id
               order by s.environment_id limit 1)
        from ready_environments r
       where r.environment_id is not null
    )
    select r.environment_id
      from ready_environments r
      left join queue_slots slot
        on slot.environment_id = r.environment_id and slot.queue = 'workflow-step'
     where r.environment_id is not null
       and ((select s.id from workflow_run_steps s
              where s.environment_id = r.environment_id and s.status = 'ready'
                and s.due_at <= ${options.now.toISOString()}::timestamptz
                and s.enqueued_at is null
              order by s.environment_id, s.due_at limit 1) is not null
         or (select s.id from workflow_run_steps s
              where s.environment_id = r.environment_id and s.status = 'ready'
                and s.due_at is null and s.enqueued_at is null
              order by s.environment_id, s.due_at limit 1) is not null)
     order by slot.last_served_at asc nulls first, r.environment_id asc
     limit ${options.limit}`);
  const { rows } = result as { rows: { environment_id: string }[] };
  return rows.map((row) => row.environment_id);
}

/** C117.9: stamps steps as enqueued; a failed enqueue clears it for the next sweep. */
export async function markWorkflowStepsEnqueued(
  tx: Db,
  environmentId: string,
  stepIds: readonly string[],
  at: Date | null,
): Promise<void> {
  if (stepIds.length > 0) {
    await tx
      .update(workflowRunSteps)
      .set({ enqueuedAt: at })
      .where(
        and(
          eq(workflowRunSteps.environmentId, environmentId),
          inArray(workflowRunSteps.id, [...stepIds]),
        ),
      );
  }
}

/** C117.4: `running` past `claimed_until`. */
export async function listExpiredWorkflowStepClaims(
  tx: Db,
  options: WorkflowStepSweepOptions,
): Promise<WorkflowRunStepRow[]> {
  return tx
    .select()
    .from(workflowRunSteps)
    .where(
      and(
        eq(workflowRunSteps.status, 'running'),
        options.environmentId === undefined
          ? undefined
          : eq(workflowRunSteps.environmentId, options.environmentId),
        lte(workflowRunSteps.claimedUntil, options.now),
      ),
    )
    .orderBy(asc(workflowRunSteps.claimedUntil))
    .limit(options.limit);
}

/** C119.3: `waiting` past `timeout_at`. */
export async function listTimedOutWorkflowWaits(
  tx: Db,
  options: WorkflowStepSweepOptions,
): Promise<WorkflowRunStepRow[]> {
  return tx
    .select()
    .from(workflowRunSteps)
    .where(
      and(
        eq(workflowRunSteps.status, 'waiting'),
        options.environmentId === undefined
          ? undefined
          : eq(workflowRunSteps.environmentId, options.environmentId),
        isNotNull(workflowRunSteps.timeoutAt),
        lte(workflowRunSteps.timeoutAt, options.now),
      ),
    )
    .orderBy(asc(workflowRunSteps.timeoutAt))
    .limit(options.limit);
}

/** C119.2, C117.9: time waits due by `horizon` and not yet enqueued: the sweep's delayed jobs. */
export async function listDueWorkflowTimers(
  tx: Db,
  options: WorkflowStepSweepOptions & { horizon: Date },
): Promise<WorkflowRunStepRow[]> {
  return tx
    .select()
    .from(workflowRunSteps)
    .where(
      and(
        eq(workflowRunSteps.status, 'waiting'),
        isNotNull(workflowRunSteps.dueAt),
        lte(workflowRunSteps.dueAt, options.horizon),
        or(isNull(workflowRunSteps.enqueuedAt), lte(workflowRunSteps.dueAt, options.now)),
      ),
    )
    .orderBy(asc(workflowRunSteps.dueAt))
    .limit(options.limit)
    .for('update', { skipLocked: true });
}

/** C120.5, C120.9: every unfinished step of a run ends; a running one's claim goes, fencing it out. */
export async function cancelWorkflowRunSteps(
  tx: Db,
  environmentId: string,
  runId: string,
  input: { at: Date; errorType?: string | undefined; errorCode?: string | undefined },
): Promise<WorkflowRunStepRow[]> {
  return tx
    .update(workflowRunSteps)
    .set({
      status: 'canceled',
      claimedBy: null,
      claimedUntil: null,
      enqueuedAt: null,
      errorType: input.errorType ?? null,
      errorCode: input.errorCode ?? null,
      completedAt: input.at,
    })
    .where(
      and(
        eq(workflowRunSteps.environmentId, environmentId),
        eq(workflowRunSteps.runId, runId),
        inArray(workflowRunSteps.status, ['pending', 'ready', 'running', 'waiting']),
      ),
    )
    .returning();
}

/** C117.8: running or enqueued steps of an environment, through the partial indexes. */
export async function countInFlightWorkflowSteps(db: Db, environmentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflowRunSteps)
    .where(
      and(
        eq(workflowRunSteps.environmentId, environmentId),
        or(
          eq(workflowRunSteps.status, 'running'),
          and(eq(workflowRunSteps.status, 'ready'), isNotNull(workflowRunSteps.enqueuedAt)),
        ),
      ),
    );
  return row?.count ?? 0;
}

/** C117.8: the per-action caps read this. */
export async function countRunningWorkflowActions(
  db: Db,
  environmentId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ key: workflowRunSteps.actionKey, count: sql<number>`count(*)::int` })
    .from(workflowRunSteps)
    .where(
      and(
        eq(workflowRunSteps.environmentId, environmentId),
        eq(workflowRunSteps.status, 'running'),
        ne(workflowRunSteps.nodeType, 'wait'),
        isNotNull(workflowRunSteps.actionKey),
      ),
    )
    .groupBy(workflowRunSteps.actionKey);
  return Object.fromEntries(rows.flatMap(({ key, count }) => (key === null ? [] : [[key, count]])));
}

/** Phase 8's slots are the `workflow-step` rows of `queue_slots` (C251.1, Workflow 11B). */
const WORKFLOW_STEP_SLOT = 'workflow-step';

/** C117.8: the rotation. */
export async function touchWorkflowEnvironmentSlot(
  db: Db,
  environmentId: string,
  at: Date,
): Promise<void> {
  // C251.1 (Workflow 11B Stage 1b (P)): the workflow-step queue's slot of `queue_slots`.
  await db
    .insert(queueSlots)
    .values({ environmentId, queue: WORKFLOW_STEP_SLOT, lastServedAt: at })
    .onConflictDoUpdate({
      target: [queueSlots.environmentId, queueSlots.queue],
      set: { lastServedAt: at },
    });
}

/** C117.8: an environment's own cap, when it has one. */
export async function getWorkflowEnvironmentCap(
  db: Db,
  environmentId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ cap: queueSlots.inFlightCap })
    .from(queueSlots)
    .where(
      and(eq(queueSlots.environmentId, environmentId), eq(queueSlots.queue, WORKFLOW_STEP_SLOT)),
    )
    .limit(1);
  return row?.cap ?? null;
}
