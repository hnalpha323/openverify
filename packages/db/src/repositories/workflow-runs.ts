/**
 * C117.2, C120 (Workflow 8A): `workflow_runs`, the journal and `workflow_run_subjects`. Owner:
 * `api-engine`.
 *
 * `trigger_snapshot`, `inputs`, `variables` and `outputs` are sealed for the row
 * (`SEALED.workflowRunTriggerSnapshot` and its neighbours); the journal holds no value.
 */
import type {
  WorkflowRunStatus,
  WorkflowRunWaitingOn,
  WorkflowTriggerType,
} from '@openverify/core';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptionalJson, sealOptionalJson } from '../sealed.js';
import {
  environments,
  events,
  workflowRunFiles,
  workflowRunJournal,
  workflowRunSteps,
  workflowRunSubjects,
  workflowRuns,
  workflowStepEffects,
  workflowTriggerDeliveries,
  workflowVersions,
  workflows,
  type WorkflowJournalKind,
  type WorkflowRunRow,
  type WorkflowRunSubjectSource,
} from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import type { DeleteOptions } from './retention.js';
import { DEFAULT_SWEEP_LIMIT } from './sweeps.js';

/** C117.7, C120.9: past this a run is marked `subjects_overflow`. */
export const WORKFLOW_RUN_SUBJECTS_LIMIT = 1_000;

export interface NewWorkflowRun {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  workflowDeploymentId?: string | null | undefined;
  rolloutLabel?: 'treatment' | 'control' | null | undefined;
  triggerType: WorkflowTriggerType;
  triggerDeliveryId?: string | null | undefined;
  scheduleFire?: string | null | undefined;
  scheduledRunId?: string | null | undefined;
  idempotencyKey?: string | null | undefined;
  creatorType: string | null;
  creatorId: string | null;
  rootRunId?: string | null | undefined;
  parentRunId?: string | null | undefined;
  rerunOfId?: string | null | undefined;
  /** C118.9: `earlier-run`, with the run it waits for. */
  waitingOn?: WorkflowRunWaitingOn | null | undefined;
  waitingOnRunId?: string | null | undefined;
  depth?: number | undefined;
  triggerDepth?: number | undefined;
  deadlineAt: Date;
  causedByPrincipal?: string | null | undefined;
  effectiveGrant: Readonly<Record<string, unknown>>;
  isTestRun?: boolean | undefined;
  overriddenSteps?: readonly string[] | undefined;
  triggerSnapshot: Readonly<Record<string, unknown>> | null;
  inputs: Readonly<Record<string, unknown>> | null;
  variables: Readonly<Record<string, unknown>> | null;
}

export interface WorkflowRunFilters {
  workflowIds?: readonly string[] | undefined;
  workflowVersionIds?: readonly string[] | undefined;
  statuses?: readonly WorkflowRunStatus[] | undefined;
  subjectIds?: readonly string[] | undefined;
  hasStepErrors?: boolean | undefined;
}

export interface WorkflowRunEnd {
  status: Exclude<WorkflowRunStatus, 'in_progress'>;
  errorType?: string | null | undefined;
  errorCode?: string | null | undefined;
  errorNodeId?: string | null | undefined;
  outputs?: Readonly<Record<string, unknown>> | null | undefined;
  at: Date;
}

export interface WorkflowJournalEntry {
  runId: string;
  kind: WorkflowJournalKind;
  stepId?: string | null | undefined;
  nodeId?: string | null | undefined;
  iterationPath?: string | null | undefined;
  attempt?: number | null | undefined;
  durationMs?: number | null | undefined;
  errorType?: string | null | undefined;
  errorCode?: string | null | undefined;
}

export interface WorkflowRunSubject {
  subjectId: string;
  source: WorkflowRunSubjectSource;
}

/** C117.2, C120.1: what an advance changed on the run row, under its lock. */
export interface WorkflowRunStateUpdate {
  /** The sealed run state (the engine's frame around the variables). */
  variables: Readonly<Record<string, unknown>>;
  stepExecutions: number;
  stepOutcomes: Readonly<Record<string, number>>;
}

/** A run's sealed values, opened. */
export interface WorkflowRunValues {
  triggerSnapshot: Record<string, unknown> | null;
  inputs: Record<string, unknown> | null;
  variables: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
}

type Record_ = Record<string, unknown>;

const opened = (column: string, id: string, sealed: WorkflowRunRow['inputsSealed']) =>
  openOptionalJson(column, id, sealed) as Record_ | null;

/** The sealed values of a run, for the engine and for the masked read routes (C120.6). */
export function openWorkflowRunValues(run: WorkflowRunRow): WorkflowRunValues {
  return {
    triggerSnapshot: opened(SEALED.workflowRunTriggerSnapshot, run.id, run.triggerSnapshotSealed),
    inputs: opened(SEALED.workflowRunInputs, run.id, run.inputsSealed),
    variables: opened(SEALED.workflowRunVariables, run.id, run.variablesSealed),
    outputs: opened(SEALED.workflowRunOutputs, run.id, run.outputsSealed),
  };
}

const runIn = (environmentId: string, id: string) =>
  and(eq(workflowRuns.environmentId, environmentId), eq(workflowRuns.id, id));

/** C118: the key that already holds this run, for the repeat of a start. */
function keyOf(input: NewWorkflowRun, environmentId: string): SQL | undefined {
  return or(
    input.triggerDeliveryId == null
      ? undefined
      : eq(workflowRuns.triggerDeliveryId, input.triggerDeliveryId),
    input.scheduleFire == null
      ? undefined
      : and(
          eq(workflowRuns.environmentId, environmentId),
          eq(workflowRuns.scheduleFire, input.scheduleFire),
        ),
    input.scheduledRunId == null
      ? undefined
      : eq(workflowRuns.scheduledRunId, input.scheduledRunId),
    input.idempotencyKey == null
      ? undefined
      : and(
          eq(workflowRuns.workflowId, input.workflowId),
          eq(workflowRuns.idempotencyKey, input.idempotencyKey),
        ),
  );
}

/**
 * C118: a run, or the one its delivery, fire, scheduled run or idempotency key already made: compare
 * `id` with what was asked for to tell them apart. The key outlives the 24-hour idempotency store.
 */
export async function createWorkflowRun(
  tx: Db,
  environmentId: string,
  input: NewWorkflowRun,
): Promise<WorkflowRunRow> {
  const { id } = input;
  const [created] = await tx
    .insert(workflowRuns)
    .values({
      id,
      environmentId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      workflowDeploymentId: input.workflowDeploymentId ?? null,
      rolloutLabel: input.rolloutLabel ?? null,
      triggerType: input.triggerType,
      triggerDeliveryId: input.triggerDeliveryId ?? null,
      scheduleFire: input.scheduleFire ?? null,
      scheduledRunId: input.scheduledRunId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      creatorType: input.creatorType,
      creatorId: input.creatorId,
      rootRunId: input.rootRunId ?? null,
      parentRunId: input.parentRunId ?? null,
      rerunOfId: input.rerunOfId ?? null,
      waitingOn: input.waitingOn ?? null,
      waitingOnRunId: input.waitingOnRunId ?? null,
      depth: input.depth ?? 0,
      triggerDepth: input.triggerDepth ?? 0,
      deadlineAt: input.deadlineAt,
      causedByPrincipal: input.causedByPrincipal ?? null,
      effectiveGrant: { ...input.effectiveGrant },
      isTestRun: input.isTestRun ?? false,
      overriddenSteps: [...(input.overriddenSteps ?? [])],
      triggerSnapshotSealed: sealOptionalJson(
        SEALED.workflowRunTriggerSnapshot,
        id,
        input.triggerSnapshot,
      ),
      inputsSealed: sealOptionalJson(SEALED.workflowRunInputs, id, input.inputs),
      variablesSealed: sealOptionalJson(SEALED.workflowRunVariables, id, input.variables),
    })
    .onConflictDoNothing()
    .returning();
  if (created !== undefined) {
    return created;
  }
  const [existing] = await tx
    .select()
    .from(workflowRuns)
    .where(keyOf(input, environmentId))
    .limit(1);
  if (existing === undefined) {
    throw new Error('a run conflicted with no key');
  }
  return existing;
}

export async function getWorkflowRun(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowRunRow | null> {
  const [row] = await db.select().from(workflowRuns).where(runIn(environmentId, id)).limit(1);
  return row ?? null;
}

/**
 * C117.3: an advance holds the run's row, because the variables and counters are read-modify-write.
 * `FOR NO KEY UPDATE`, which serialises advances but not a foreign key's share lock: an effect's
 * insert holds that on the run before a transaction-shaped action's run lock, so two branches on
 * `FOR UPDATE` would each wait for the other's share.
 */
export async function lockWorkflowRun(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowRunRow | null> {
  const [row] = await tx
    .select()
    .from(workflowRuns)
    .where(runIn(environmentId, id))
    .limit(1)
    .for('no key update');
  return row ?? null;
}

const runCursor = environmentCursor(workflowRuns);

/** C118.9: who a run waits for; `null` releases it. */
export async function saveWorkflowRunWaiter(
  tx: Db,
  environmentId: string,
  id: string,
  earlierRunId: string | null,
): Promise<WorkflowRunRow | null> {
  const [row] = await tx
    .update(workflowRuns)
    .set({ waitingOn: earlierRunId === null ? null : 'earlier-run', waitingOnRunId: earlierRunId })
    .where(and(runIn(environmentId, id), eq(workflowRuns.status, 'in_progress')))
    .returning();
  return row ?? null;
}

/** C117.8: how each run started, for its steps' queue. */
export async function listWorkflowRunTriggerTypes(
  db: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<Map<string, WorkflowTriggerType>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: workflowRuns.id, triggerType: workflowRuns.triggerType })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.environmentId, environmentId), inArray(workflowRuns.id, [...ids])));
  return new Map(rows.map(({ id, triggerType }) => [id, triggerType]));
}

/** C120.1: the filter of an empty list matches nothing, as every list route's does. */
const inList = (
  column: Parameters<typeof eq>[0],
  values: readonly string[] | undefined,
): SQL | undefined => (values === undefined ? undefined : inArray(column, [...values]));

/** `created_at DESC, id DESC` (C1). */
export async function listWorkflowRuns(
  db: Db,
  environmentId: string,
  filters: WorkflowRunFilters,
  page: PageRequest,
): Promise<Page<WorkflowRunRow>> {
  const conditions = [
    eq(workflowRuns.environmentId, environmentId),
    inList(workflowRuns.workflowId, filters.workflowIds),
    inList(workflowRuns.workflowVersionId, filters.workflowVersionIds),
    inList(workflowRuns.status, filters.statuses),
    filters.hasStepErrors === undefined
      ? undefined
      : eq(workflowRuns.hasStepErrors, filters.hasStepErrors),
    filters.subjectIds === undefined
      ? undefined
      : sql`exists (select 1 from ${workflowRunSubjects}
          where ${workflowRunSubjects.environmentId} = ${workflowRuns.environmentId}
            and ${workflowRunSubjects.runId} = ${workflowRuns.id}
            and ${inArray(workflowRunSubjects.subjectId, [...filters.subjectIds])})`,
  ];
  return paginate(db, runCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(workflowRuns)
      .where(and(...conditions, after))
      .orderBy(...newestFirst(runCursor))
      .limit(limit),
  );
}

export async function setWorkflowRunWaitingOn(
  tx: Db,
  environmentId: string,
  id: string,
  waitingOn: WorkflowRunWaitingOn | null,
): Promise<WorkflowRunRow | null> {
  const [row] = await tx
    .update(workflowRuns)
    .set({ waitingOn })
    .where(and(runIn(environmentId, id), eq(workflowRuns.status, 'in_progress')))
    .returning();
  return row ?? null;
}

/** C120.1 (H32): a step error shows even on a run that completed. */
const hadStepErrors = (outcomes: Readonly<Record<string, number>>): boolean =>
  (outcomes['failed-continued'] ?? 0) > 0 ||
  (outcomes['timed-out'] ?? 0) > 0 ||
  (outcomes['unknown-effect'] ?? 0) > 0;

export async function saveWorkflowRunState(
  tx: Db,
  environmentId: string,
  id: string,
  update: WorkflowRunStateUpdate,
): Promise<void> {
  await tx
    .update(workflowRuns)
    .set({
      variablesSealed: sealOptionalJson(SEALED.workflowRunVariables, id, update.variables),
      stepExecutions: update.stepExecutions,
      stepOutcomes: { ...update.stepOutcomes },
      hasStepErrors: hadStepErrors(update.stepOutcomes),
    })
    .where(runIn(environmentId, id));
}

/** C120: only a run in progress ends, so a late completion changes nothing. */
export async function endWorkflowRun(
  tx: Db,
  environmentId: string,
  id: string,
  end: WorkflowRunEnd,
): Promise<WorkflowRunRow | null> {
  const [row] = await tx
    .update(workflowRuns)
    .set({
      status: end.status,
      waitingOn: null,
      waitingOnRunId: null,
      errorType: end.status === 'errored' ? (end.errorType ?? null) : null,
      errorCode: end.status === 'errored' ? (end.errorCode ?? null) : null,
      errorNodeId: end.status === 'errored' ? (end.errorNodeId ?? null) : null,
      ...(end.outputs === undefined
        ? {}
        : { outputsSealed: sealOptionalJson(SEALED.workflowRunOutputs, id, end.outputs) }),
      completedAt: end.at,
    })
    .where(and(runIn(environmentId, id), eq(workflowRuns.status, 'in_progress')))
    .returning();
  return row ?? null;
}

/** C120.3: an errored run back in progress; its attempt counters carry on. */
export async function reopenWorkflowRun(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowRunRow | null> {
  const [row] = await tx
    .update(workflowRuns)
    .set({
      status: 'in_progress',
      errorType: null,
      errorCode: null,
      errorNodeId: null,
      completedAt: null,
    })
    .where(and(runIn(environmentId, id), eq(workflowRuns.status, 'errored')))
    .returning();
  return row ?? null;
}

/** C120.1: each run's subject ids, for a list's resources. */
export async function listWorkflowRunSubjectIds(
  db: Db,
  environmentId: string,
  runIds: readonly string[],
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (runIds.length === 0) {
    return found;
  }
  const rows = await db
    .select({ runId: workflowRunSubjects.runId, subjectId: workflowRunSubjects.subjectId })
    .from(workflowRunSubjects)
    .where(
      and(
        eq(workflowRunSubjects.environmentId, environmentId),
        inArray(workflowRunSubjects.runId, [...runIds]),
      ),
    )
    .orderBy(asc(workflowRunSubjects.createdAt), asc(workflowRunSubjects.subjectId));
  for (const { runId, subjectId } of rows) {
    found.set(runId, [...(found.get(runId) ?? []), subjectId]);
  }
  return found;
}

/** C118.9: the oldest run still in progress for this workflow and subject, other than `runId`. */
export async function findEarlierWorkflowRun(
  tx: Db,
  environmentId: string,
  input: { workflowId: string; subjectId: string; runId: string },
): Promise<WorkflowRunRow | null> {
  const [row] = await tx
    .select({ run: workflowRuns })
    .from(workflowRuns)
    .innerJoin(
      workflowRunSubjects,
      and(
        eq(workflowRunSubjects.environmentId, workflowRuns.environmentId),
        eq(workflowRunSubjects.runId, workflowRuns.id),
      ),
    )
    .where(
      and(
        eq(workflowRuns.environmentId, environmentId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.status, 'in_progress'),
        eq(workflowRunSubjects.subjectId, input.subjectId),
        sql`${workflowRuns.id} <> ${input.runId}`,
      ),
    )
    .orderBy(asc(workflowRuns.createdAt), asc(workflowRuns.id))
    .limit(1);
  return row?.run ?? null;
}

/** C118.9: the runs that wait for `runId`, oldest first. */
export async function listRunsWaitingOnRun(
  tx: Db,
  environmentId: string,
  runId: string,
): Promise<WorkflowRunRow[]> {
  return tx
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.environmentId, environmentId),
        eq(workflowRuns.waitingOnRunId, runId),
        eq(workflowRuns.status, 'in_progress'),
      ),
    )
    .orderBy(asc(workflowRuns.createdAt), asc(workflowRuns.id));
}

/** C120.5: a run's children still in progress. */
export async function listChildWorkflowRuns(
  tx: Db,
  environmentId: string,
  parentRunId: string,
): Promise<WorkflowRunRow[]> {
  return tx
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.environmentId, environmentId),
        eq(workflowRuns.parentRunId, parentRunId),
        eq(workflowRuns.status, 'in_progress'),
      ),
    );
}

/** C116.2: the unfinished runs of a workflow's versions numbered before `versionNumber`. */
export async function listUnfinishedRunsBeforeVersion(
  db: Db,
  environmentId: string,
  input: { workflowId: string; versionNumber: number },
): Promise<WorkflowRunRow[]> {
  const rows = await db
    .select({ run: workflowRuns })
    .from(workflowRuns)
    .innerJoin(
      workflowVersions,
      and(
        eq(workflowVersions.environmentId, workflowRuns.environmentId),
        eq(workflowVersions.id, workflowRuns.workflowVersionId),
      ),
    )
    .where(
      and(
        eq(workflowRuns.environmentId, environmentId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.status, 'in_progress'),
        sql`${workflowVersions.versionNumber} < ${input.versionNumber}`,
      ),
    );
  return rows.map(({ run }) => run);
}

/** C116.2: a version's number, if it is a version of this workflow. */
export async function readDefinitionVersionNumber(
  db: Db,
  environmentId: string,
  input: { workflowId: string; versionId: string },
): Promise<number | null> {
  const [row] = await db
    .select({ versionNumber: workflowVersions.versionNumber })
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.environmentId, environmentId),
        eq(workflowVersions.workflowId, input.workflowId),
        eq(workflowVersions.id, input.versionId),
      ),
    )
    .limit(1);
  return row?.versionNumber ?? null;
}

/** C117.7: runs past their 90-day deadline, oldest first. */
export async function listWorkflowRunsPastDeadline(
  db: Db,
  options: { limit: number; now: Date },
): Promise<WorkflowRunRow[]> {
  return db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.status, 'in_progress'), lte(workflowRuns.deadlineAt, options.now)))
    .orderBy(asc(workflowRuns.deadlineAt))
    .limit(options.limit);
}

/** C118.2, C120.9: a run's cause, for the check of C121.3 and a wait's output (C119.3). */
export interface WorkflowEventFacts {
  name: string;
  payload: unknown;
  causedByRunId: string | null;
  causedByPrincipal: string | null;
  causedByBulkId: string | null;
  principalHeldInquiriesWrite: boolean | null;
}

/** An event as the engine reads it; `null` once C16 has deleted it. */
export async function getEventCause(
  db: Db,
  environmentId: string,
  eventId: string,
): Promise<WorkflowEventFacts | null> {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.environmentId, environmentId), eq(events.id, eventId)))
    .limit(1);
  return row === undefined
    ? null
    : {
        name: row.name,
        payload: row.payload,
        causedByRunId: row.causedByRunId,
        causedByPrincipal: row.causedByPrincipal,
        causedByBulkId: row.causedByBulkId,
        principalHeldInquiriesWrite: row.causedByPrincipalHeldInquiriesWrite,
      };
}

/** C117.2: never a value. A trigger refuses every change to a written row. */
export async function appendWorkflowJournal(
  tx: Db,
  environmentId: string,
  entries: readonly WorkflowJournalEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  await tx.insert(workflowRunJournal).values(
    entries.map((entry) => ({
      environmentId,
      runId: entry.runId,
      kind: entry.kind,
      stepId: entry.stepId ?? null,
      nodeId: entry.nodeId ?? null,
      iterationPath: entry.iterationPath ?? null,
      attempt: entry.attempt ?? null,
      durationMs: entry.durationMs ?? null,
      errorType: entry.errorType ?? null,
      errorCode: entry.errorCode ?? null,
    })),
  );
}

/**
 * C120.9: at most 1,000 per run; past that the run is marked `subjects_overflow`. The caller holds the
 * run's row, so two advances never count past the cap between them.
 */
export async function recordWorkflowRunSubjects(
  tx: Db,
  environmentId: string,
  runId: string,
  subjects: readonly WorkflowRunSubject[],
): Promise<void> {
  if (subjects.length === 0) {
    return;
  }
  const unique = [...new Map(subjects.map((subject) => [subject.subjectId, subject])).values()];
  const held = await tx
    .select({ subjectId: workflowRunSubjects.subjectId })
    .from(workflowRunSubjects)
    .where(
      and(
        eq(workflowRunSubjects.environmentId, environmentId),
        eq(workflowRunSubjects.runId, runId),
        inArray(
          workflowRunSubjects.subjectId,
          unique.map(({ subjectId }) => subjectId),
        ),
      ),
    );
  const known = new Set(held.map(({ subjectId }) => subjectId));
  const fresh = unique.filter(({ subjectId }) => !known.has(subjectId));
  if (fresh.length === 0) {
    return;
  }
  const [count] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(workflowRunSubjects)
    .where(
      and(
        eq(workflowRunSubjects.environmentId, environmentId),
        eq(workflowRunSubjects.runId, runId),
      ),
    );
  const room = Math.max(0, WORKFLOW_RUN_SUBJECTS_LIMIT - (count?.count ?? 0));
  const taken = fresh.slice(0, room);
  if (taken.length > 0) {
    await tx
      .insert(workflowRunSubjects)
      .values(taken.map((subject) => ({ environmentId, runId, ...subject })))
      .onConflictDoNothing();
  }
  if (taken.length < fresh.length) {
    await tx
      .update(workflowRuns)
      .set({ subjectsOverflow: true })
      .where(runIn(environmentId, runId));
  }
}

/** C120.9: the runs recorded against any of these ids, plus every run that overflowed (P33). */
export async function listWorkflowRunsForSubjects(
  tx: Db,
  environmentId: string,
  subjectIds: readonly string[],
): Promise<WorkflowRunRow[]> {
  if (subjectIds.length === 0) {
    return [];
  }
  return tx
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.environmentId, environmentId),
        isNull(workflowRuns.valuesPurgedAt),
        isNull(workflowRuns.redactedAt),
        or(
          sql`exists (select 1 from ${workflowRunSubjects}
            where ${workflowRunSubjects.environmentId} = ${workflowRuns.environmentId}
              and ${workflowRunSubjects.runId} = ${workflowRuns.id}
              and ${inArray(workflowRunSubjects.subjectId, [...subjectIds])})`,
          eq(workflowRuns.subjectsOverflow, true),
        ),
      ),
    );
}

/** A run's sealed columns, and its steps' and effects', go to null. */
async function nullWorkflowRunValues(
  tx: Db,
  environmentId: string,
  runIds: readonly string[],
): Promise<void> {
  await tx
    .update(workflowRunSteps)
    .set({ inputSealed: null, outputSealed: null, consoleSealed: null })
    .where(
      and(
        eq(workflowRunSteps.environmentId, environmentId),
        inArray(workflowRunSteps.runId, [...runIds]),
      ),
    );
  await tx
    .update(workflowStepEffects)
    .set({ resultSealed: null })
    .where(
      and(
        eq(workflowStepEffects.environmentId, environmentId),
        inArray(workflowStepEffects.runId, [...runIds]),
      ),
    );
}

const NO_VALUES = {
  triggerSnapshotSealed: null,
  inputsSealed: null,
  variablesSealed: null,
  outputsSealed: null,
} as const;

/** C120.9: nulls one run's sealed columns, its steps' and its effects', and stamps `redacted_at`. */
export async function redactWorkflowRunValues(
  tx: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx
    .update(workflowRuns)
    .set({ ...NO_VALUES, redactedAt: at })
    .where(and(runIn(environmentId, id), isNull(workflowRuns.redactedAt)))
    .returning({ id: workflowRuns.id });
  if (rows.length === 0) {
    return false;
  }
  await nullWorkflowRunValues(tx, environmentId, [id]);
  return true;
}

const days = (key: string, fallback: number): SQL =>
  sql`coalesce((${environments.settings} ->> ${key})::integer, ${fallback}::integer)`;

const instant = (options: DeleteOptions): string => (options.now ?? new Date()).toISOString();

const VALUE_DAYS = 30;
const HISTORY_DAYS = 365;

/**
 * C120.8: runs past `workflow-run-retention-days`: their values go, and their files lose their key
 * and name, which the C16 pass's file step then deletes. Unfinished runs are never reached.
 */
export async function purgeExpiredWorkflowRunValues(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const at = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: workflowRuns.id, environmentId: workflowRuns.environmentId })
      .from(workflowRuns)
      .innerJoin(environments, eq(environments.id, workflowRuns.environmentId))
      .where(
        and(
          isNotNull(workflowRuns.completedAt),
          isNull(workflowRuns.valuesPurgedAt),
          sql`${workflowRuns.completedAt} <= ${instant(options)}::timestamptz
            - make_interval(days => ${days('workflow-run-retention-days', VALUE_DAYS)})`,
        ),
      )
      .orderBy(asc(workflowRuns.completedAt))
      .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
      .for('update', { of: workflowRuns, skipLocked: true });
    for (const { id, environmentId } of due) {
      await tx
        .update(workflowRuns)
        .set({ ...NO_VALUES, valuesPurgedAt: at })
        .where(runIn(environmentId, id));
      await nullWorkflowRunValues(tx, environmentId, [id]);
      await tx
        .update(workflowRunFiles)
        .set({ wrappedDek: null, filenameSealed: null, redactedAt: at })
        .where(
          and(
            eq(workflowRunFiles.environmentId, environmentId),
            eq(workflowRunFiles.runId, id),
            isNull(workflowRunFiles.redactedAt),
          ),
        );
    }
    return due.length;
  });
}

/**
 * C120.8, P27: runs past `workflow-run-history-retention-days`: the skeleton and its deliveries go.
 * The journal's trigger lets the delete through only under `openverify.retention`, set for this
 * transaction alone (F12).
 */
export async function deleteExpiredWorkflowRunSkeletons(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('openverify.retention', 'on', true)`);
    const due = await tx
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .innerJoin(environments, eq(environments.id, workflowRuns.environmentId))
      .where(
        and(
          isNotNull(workflowRuns.completedAt),
          sql`${workflowRuns.completedAt} <= ${instant(options)}::timestamptz
            - make_interval(days => ${days('workflow-run-history-retention-days', HISTORY_DAYS)})`,
        ),
      )
      .orderBy(asc(workflowRuns.completedAt))
      .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
      .for('update', { of: workflowRuns, skipLocked: true });
    if (due.length === 0) {
      return 0;
    }
    const ids = due.map(({ id }) => id);
    await tx
      .delete(workflowTriggerDeliveries)
      .where(inArray(workflowTriggerDeliveries.workflowRunId, ids));
    await tx.delete(workflowRuns).where(inArray(workflowRuns.id, ids));
    return ids.length;
  });
}

/** C120.1: the version a run reads; the definition is configuration, never subject data. */
export interface WorkflowRunVersion {
  id: string;
  workflowId: string;
  status: string;
  versionNumber: number;
  definition: unknown;
  grant: Record<string, unknown> | null;
  publishedById: string | null;
}

/** The newest published version of a workflow of `kind`, for `latest-published` (C119.8, C120.4). */
export async function latestPublishedWorkflowRunVersion(
  db: Db,
  environmentId: string,
  workflowId: string,
): Promise<WorkflowRunVersion | null> {
  const [row] = await db
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.environmentId, environmentId),
        eq(workflowVersions.workflowId, workflowId),
        eq(workflowVersions.status, 'published'),
      ),
    )
    .orderBy(desc(workflowVersions.versionNumber))
    .limit(1);
  return row === undefined ? null : toRunVersion(row);
}

/** The version a run is pinned to, in its own environment. */
export async function getWorkflowRunVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowRunVersion | null> {
  const [row] = await db
    .select()
    .from(workflowVersions)
    .where(and(eq(workflowVersions.environmentId, environmentId), eq(workflowVersions.id, id)))
    .limit(1);
  return row === undefined ? null : toRunVersion(row);
}

function toRunVersion(row: typeof workflowVersions.$inferSelect): WorkflowRunVersion {
  return {
    id: row.id,
    workflowId: row.workflowId,
    status: row.status,
    versionNumber: row.versionNumber,
    definition: row.definition,
    grant: row.grant,
    publishedById: row.publishedById,
  };
}

/** C121.5: a workflow's status, for the executor's checks. */
export async function getWorkflowRunWorkflow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<typeof workflows.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.environmentId, environmentId), eq(workflows.id, id)))
    .limit(1);
  return row ?? null;
}
