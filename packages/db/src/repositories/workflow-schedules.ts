/**
 * C118.3, C118.4 (Workflow 8A): `workflow_schedules` and `scheduled_runs`. Owner: `api-triggers`.
 *
 * `scheduled_runs.inputs` is sealed for the row (`SEALED.scheduledRunInputs`).
 */
import type { WorkflowObjectType } from '@openverify/core';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  accounts,
  inquiries,
  reports,
  scheduledRuns,
  transactions,
  workflowSchedules,
  type ScheduledRunDirection,
  type ScheduledRunRow,
  type ScheduledRunUnit,
  type WorkflowScheduleRow,
} from '../schema.js';
import { openJson, sealJson } from '../sealed.js';
import { listCasesAfter } from './cases.js';
import { inserted } from './rows.js';

export interface NewWorkflowSchedule {
  id: string;
  workflowId: string;
  cron: string | null;
  everyMinutes: number | null;
  timeZone: string;
  objectType: WorkflowObjectType;
  filter: Readonly<Record<string, unknown>> | null;
  onNull: string | null;
  batchCap: number;
  nextFireAt: Date;
}

export interface NewScheduledRun {
  id: string;
  targetWorkflowId: string;
  sourceRunId: string | null;
  subjectId: string | null;
  baseAt: Date;
  offsetValue: number;
  offsetUnit: ScheduledRunUnit;
  offsetDirection: ScheduledRunDirection;
  fireAt: Date;
  inputs: Readonly<Record<string, unknown>> | null;
}

/** C116.1: rebuilt with the trigger index when a recurring version goes live. */
export async function replaceWorkflowSchedule(
  tx: Db,
  environmentId: string,
  workflowId: string,
  schedule: NewWorkflowSchedule | null,
): Promise<void> {
  await tx
    .delete(workflowSchedules)
    .where(
      and(
        eq(workflowSchedules.environmentId, environmentId),
        eq(workflowSchedules.workflowId, workflowId),
      ),
    );
  if (schedule === null) {
    return;
  }
  await tx.insert(workflowSchedules).values({
    id: schedule.id,
    environmentId,
    workflowId,
    cron: schedule.cron,
    everyMinutes: schedule.everyMinutes,
    timeZone: schedule.timeZone,
    objectType: schedule.objectType,
    filter: schedule.filter === null ? null : { ...schedule.filter },
    onNull: schedule.onNull,
    batchCap: schedule.batchCap,
    nextFireAt: schedule.nextFireAt,
  });
}

/** `FOR UPDATE SKIP LOCKED`, due first. */
export async function listDueWorkflowSchedules(
  tx: Db,
  options: { limit: number; now: Date },
): Promise<WorkflowScheduleRow[]> {
  return tx
    .select()
    .from(workflowSchedules)
    .where(lte(workflowSchedules.nextFireAt, options.now))
    .orderBy(asc(workflowSchedules.nextFireAt), asc(workflowSchedules.id))
    .limit(options.limit)
    .for('update', { skipLocked: true });
}

/** C118.4: one catch-up tick after an outage, then the next fire. */
export async function advanceWorkflowSchedule(
  tx: Db,
  environmentId: string,
  id: string,
  update: { nextFireAt: Date; lastFiredAt: Date; cursor: string | null },
): Promise<void> {
  await tx
    .update(workflowSchedules)
    .set(update)
    .where(and(eq(workflowSchedules.environmentId, environmentId), eq(workflowSchedules.id, id)));
}

export async function createScheduledRun(
  tx: Db,
  environmentId: string,
  input: NewScheduledRun,
): Promise<ScheduledRunRow> {
  const rows = await tx
    .insert(scheduledRuns)
    .values({
      id: input.id,
      environmentId,
      targetWorkflowId: input.targetWorkflowId,
      sourceRunId: input.sourceRunId,
      subjectId: input.subjectId,
      baseAt: input.baseAt,
      offsetValue: input.offsetValue,
      offsetUnit: input.offsetUnit,
      offsetDirection: input.offsetDirection,
      fireAt: input.fireAt,
      inputsSealed:
        input.inputs === null ? null : sealJson(SEALED.scheduledRunInputs, input.id, input.inputs),
    })
    .returning();
  return inserted(rows, 'createScheduledRun');
}

/** C118.3: the row's sealed inputs, or `null`. */
export function scheduledRunInputs(row: ScheduledRunRow): Record<string, unknown> | null {
  return row.inputsSealed === null
    ? null
    : (openJson(SEALED.scheduledRunInputs, row.id, row.inputsSealed) as Record<string, unknown>);
}

/** `FOR UPDATE SKIP LOCKED`, due first. */
export async function listDueScheduledRuns(
  tx: Db,
  options: { limit: number; now: Date },
): Promise<ScheduledRunRow[]> {
  return tx
    .select()
    .from(scheduledRuns)
    .where(and(eq(scheduledRuns.status, 'pending'), lte(scheduledRuns.fireAt, options.now)))
    .orderBy(asc(scheduledRuns.fireAt), asc(scheduledRuns.id))
    .limit(options.limit)
    .for('update', { skipLocked: true });
}

export async function finishScheduledRun(
  tx: Db,
  environmentId: string,
  id: string,
  outcome: { status: 'run_created' | 'canceled'; workflowRunId?: string; reasonCode?: string },
): Promise<void> {
  await tx
    .update(scheduledRuns)
    .set({
      status: outcome.status,
      workflowRunId: outcome.workflowRunId ?? null,
      reasonCode: outcome.reasonCode ?? null,
      // A canceled run's values have no reader left (C118.3, C120.9).
      ...(outcome.status === 'canceled' ? { inputsSealed: null } : {}),
    })
    .where(
      and(
        eq(scheduledRuns.environmentId, environmentId),
        eq(scheduledRuns.id, id),
        eq(scheduledRuns.status, 'pending'),
      ),
    );
}

async function cancelPending(
  tx: Db,
  environmentId: string,
  match: ReturnType<typeof eq>,
  reasonCode: string,
): Promise<number> {
  const rows = await tx
    .update(scheduledRuns)
    .set({ status: 'canceled', reasonCode, inputsSealed: null })
    .where(
      and(
        eq(scheduledRuns.environmentId, environmentId),
        eq(scheduledRuns.status, 'pending'),
        match,
      ),
    )
    .returning({ id: scheduledRuns.id });
  return rows.length;
}

/** C118.3: with its subject's redaction. */
export async function cancelScheduledRunsForSubjects(
  tx: Db,
  environmentId: string,
  subjectIds: readonly string[],
): Promise<number> {
  return subjectIds.length === 0
    ? 0
    : cancelPending(
        tx,
        environmentId,
        inArray(scheduledRuns.subjectId, [...subjectIds]),
        'subject_redacted',
      );
}

/** C118.3: when its target workflow is archived. */
export async function cancelScheduledRunsForWorkflow(
  tx: Db,
  environmentId: string,
  workflowId: string,
): Promise<number> {
  return cancelPending(
    tx,
    environmentId,
    eq(scheduledRuns.targetWorkflowId, workflowId),
    'workflow_archived',
  );
}

/** The tables a tick reads, each with `id`, `environment_id`, `created_at` and `redacted_at`. */
const OBJECT_TABLES = {
  account: accounts,
  inquiry: inquiries,
  report: reports,
  transaction: transactions,
} as const;

/**
 * C118.4: an environment's objects of a type, oldest first, after `cursor`, leaving out what was
 * redacted. A cursor that no longer names an object starts over, so an object deleted between two
 * ticks cannot stop a schedule. A case is Workflow 8B's.
 */
export async function listWorkflowObjectsAfter(
  db: Db,
  environmentId: string,
  objectType: WorkflowObjectType,
  options: { cursor: string | null; limit: number },
): Promise<string[]> {
  if (objectType === 'case') {
    // Workflow 8B: a case is `api-cases`' to read (orchestrator decision 5 after Workflow 8A).
    return listCasesAfter(db, environmentId, options);
  }
  const table = OBJECT_TABLES[objectType];
  const { cursor } = options;
  const held =
    cursor !== null &&
    (
      await db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, cursor), eq(table.environmentId, environmentId)))
        .limit(1)
    ).length > 0;
  // The position is read inside the query, so a timestamp never loses its microseconds.
  const after = held
    ? sql`(${table.createdAt}, ${table.id}) > (
        select c.created_at, c.id from ${table} as c
         where c.id = ${cursor} and c.environment_id = ${environmentId})`
    : undefined;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.environmentId, environmentId), isNull(table.redactedAt), after))
    .orderBy(asc(table.createdAt), asc(table.id))
    .limit(options.limit);
  return rows.map(({ id }) => id);
}
