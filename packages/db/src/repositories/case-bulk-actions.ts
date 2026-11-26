/**
 * C137.4 (Workflow 8B): bulk actions, read by their creating principal alone. Owner `api-cases`;
 * `foundation-8b` froze the names. The request is sealed (`SEALED.caseBulkActionRequest`) until the
 * job has done, and then dropped: the outcomes are case ids and codes.
 */
import { and, asc, eq, lt, ne } from 'drizzle-orm';
import type { CaseBulkAction as CaseBulkActionName, CaseBulkOutcome } from '@openverify/core';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptionalJson, sealJson } from '../sealed.js';
import { caseBulkActions, type CaseBulkActionRow } from '../tables/cases.js';
import { firstOrNull, inserted } from './rows.js';

/** One case's outcome, as the row keeps it. */
export interface CaseBulkOutcomeRow {
  caseId: string;
  outcome: CaseBulkOutcome;
  code: string | null;
}

/** A bulk action with its request opened (`null` once done). */
export interface CaseBulkActionRecordRow extends Omit<
  CaseBulkActionRow,
  'requestSealed' | 'outcomes'
> {
  request: Readonly<Record<string, unknown>> | null;
  outcomes: CaseBulkOutcomeRow[];
}

function toBulk(row: CaseBulkActionRow): CaseBulkActionRecordRow {
  const { requestSealed, outcomes, ...rest } = row;
  return {
    ...rest,
    request: openOptionalJson(SEALED.caseBulkActionRequest, row.id, requestSealed) as Readonly<
      Record<string, unknown>
    > | null,
    outcomes: (
      outcomes as { 'case-id': string; outcome: CaseBulkOutcome; code: string | null }[]
    ).map((each) => ({ caseId: each['case-id'], outcome: each.outcome, code: each.code })),
  };
}

const bulkIn = (environmentId: string, id: string) =>
  and(eq(caseBulkActions.environmentId, environmentId), eq(caseBulkActions.id, id));

export async function getCaseBulkActionRow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseBulkActionRecordRow | null> {
  const row = firstOrNull(
    await db.select().from(caseBulkActions).where(bulkIn(environmentId, id)).limit(1),
  );
  return row === null ? null : toBulk(row);
}

export interface NewCaseBulkAction {
  id: string;
  action: CaseBulkActionName;
  creatorType: CaseBulkActionRow['creatorType'];
  creatorId: string;
  /** The selection and the action's `meta`; sealed by the repository. */
  request: Readonly<Record<string, unknown>>;
  requestedCount: number;
}

export async function createCaseBulkActionRow(
  tx: Db,
  environmentId: string,
  input: NewCaseBulkAction,
): Promise<CaseBulkActionRecordRow> {
  return toBulk(
    inserted(
      await tx
        .insert(caseBulkActions)
        .values({
          id: input.id,
          environmentId,
          action: input.action,
          creatorType: input.creatorType,
          creatorId: input.creatorId,
          requestSealed: sealJson(SEALED.caseBulkActionRequest, input.id, input.request),
          requestedCount: input.requestedCount,
        })
        .returning(),
      'createCaseBulkActionRow',
    ),
  );
}

/**
 * The job's claim: a pending or running action `FOR UPDATE SKIP LOCKED`, marked running; `null` when
 * it is done, held by another job, or not here.
 */
export async function claimCaseBulkActionRow(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<CaseBulkActionRecordRow | null> {
  const row = firstOrNull(
    await tx
      .select()
      .from(caseBulkActions)
      .where(and(bulkIn(environmentId, id), ne(caseBulkActions.status, 'completed')))
      .for('update', { skipLocked: true }),
  );
  if (row === null) {
    return null;
  }
  const [running] = await tx
    .update(caseBulkActions)
    .set({ status: 'running' })
    .where(bulkIn(environmentId, id))
    .returning();
  return running === undefined ? null : toBulk(running);
}

/** Done: the outcomes and counts kept, the request dropped (C137.4). */
export async function completeCaseBulkActionRow(
  tx: Db,
  environmentId: string,
  id: string,
  outcomes: readonly CaseBulkOutcomeRow[],
  at: Date,
): Promise<CaseBulkActionRecordRow | null> {
  const count = (outcome: CaseBulkOutcome) =>
    outcomes.filter((each) => each.outcome === outcome).length;
  const row = firstOrNull(
    await tx
      .update(caseBulkActions)
      .set({
        status: 'completed',
        completedAt: at,
        requestSealed: null,
        appliedCount: count('applied'),
        noChangeCount: count('no_change'),
        refusedCount: count('refused'),
        outcomes: outcomes.map((each) => ({
          'case-id': each.caseId,
          outcome: each.outcome,
          code: each.code,
        })),
      })
      .where(bulkIn(environmentId, id))
      .returning(),
  );
  return row === null ? null : toBulk(row);
}

/** Unfinished actions made before `before`, oldest first: what a sweep re-enqueues. */
export async function listUnfinishedCaseBulkActions(
  db: Db,
  before: Date,
  limit: number,
): Promise<{ id: string; environmentId: string }[]> {
  return db
    .select({ id: caseBulkActions.id, environmentId: caseBulkActions.environmentId })
    .from(caseBulkActions)
    .where(and(ne(caseBulkActions.status, 'completed'), lt(caseBulkActions.createdAt, before)))
    .orderBy(asc(caseBulkActions.createdAt))
    .limit(limit);
}
