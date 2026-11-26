/**
 * C152.8 (Workflow 9A): one row per entry of a flow `action` step. Owner: `api-flow-actions`; frozen
 * by `foundation-9a` (S). PII-free: ids, keys and codes. The inquiry's redaction reads the copy
 * targets through `flowActionCopyTargets` (`apps/api/src/flow-actions/copies.ts`) before
 * `redactInquiryRecords` deletes the rows.
 *
 * An entry is written exactly once (its key is the primary key, and a repeat inserts nothing) and
 * finished once (only a `running` row finishes), so a retried transaction or a racing sweep never
 * runs an entry twice or overwrites how it ended.
 */
import type { FlowActionRowStatus } from '@openverify/core';
import { and, asc, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { inquiryFlowActions, type InquiryFlowActionRow } from '../schema.js';

export type InquiryFlowAction = InquiryFlowActionRow;

/** An action step entered (status `running` until it finishes). */
export interface NewInquiryFlowAction {
  inquiryId: string;
  stepId: string;
  entry: number;
  workflowRunId?: string | null;
  enteredAt: Date;
}

/** How an entry finished; `targetAccountId` and `copiedKeys` once per entry (C152.4, V08). */
export interface InquiryFlowActionFinish {
  status: Exclude<FlowActionRowStatus, 'running'>;
  errorType: string | null;
  finishedAt: Date;
  targetAccountId?: string | null;
  copiedKeys?: readonly string[];
}

/** The account an `update_account_fields` entry wrote to, and the keys it wrote (V08). */
export interface InquiryFlowActionCopy {
  stepId: string;
  entry: number;
  targetAccountId: string;
  copiedKeys: readonly string[];
}

/** The key of one entry of an action step. */
export interface InquiryFlowActionKey {
  inquiryId: string;
  stepId: string;
  entry: number;
}

const entryIs = (environmentId: string, key: InquiryFlowActionKey) =>
  and(
    eq(inquiryFlowActions.environmentId, environmentId),
    eq(inquiryFlowActions.inquiryId, key.inquiryId),
    eq(inquiryFlowActions.stepId, key.stepId),
    eq(inquiryFlowActions.entry, key.entry),
  );

/**
 * Records the entry, exactly once: `null` when the entry already has a row (a repeat of the entry,
 * which runs nothing again).
 */
export async function insertInquiryFlowActionInTx(
  tx: Db,
  environmentId: string,
  input: NewInquiryFlowAction,
): Promise<InquiryFlowAction | null> {
  const [row] = await tx
    .insert(inquiryFlowActions)
    .values({
      environmentId,
      inquiryId: input.inquiryId,
      stepId: input.stepId,
      entry: input.entry,
      workflowRunId: input.workflowRunId ?? null,
      status: 'running',
      enteredAt: input.enteredAt,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

/** Finishes a `running` entry; `null` when it is not running (it finished already). */
export async function finishInquiryFlowActionInTx(
  tx: Db,
  environmentId: string,
  key: InquiryFlowActionKey,
  finish: InquiryFlowActionFinish,
): Promise<InquiryFlowAction | null> {
  const [row] = await tx
    .update(inquiryFlowActions)
    .set({
      status: finish.status,
      errorType: finish.errorType,
      finishedAt: finish.finishedAt,
      ...(finish.targetAccountId === undefined ? {} : { targetAccountId: finish.targetAccountId }),
      ...(finish.copiedKeys === undefined ? {} : { copiedKeys: [...finish.copiedKeys] }),
    })
    .where(and(entryIs(environmentId, key), eq(inquiryFlowActions.status, 'running')))
    .returning();
  return row ?? null;
}

/** C152.2: the running entries entered before `enteredBefore`, oldest first, for the sweep. */
export function listRunningInquiryFlowActions(
  db: Db,
  options: { enteredBefore: Date; limit: number },
): Promise<(InquiryFlowAction & { environmentId: string })[]> {
  return db
    .select()
    .from(inquiryFlowActions)
    .where(
      and(
        eq(inquiryFlowActions.status, 'running'),
        lt(inquiryFlowActions.enteredAt, options.enteredBefore),
      ),
    )
    .orderBy(
      asc(inquiryFlowActions.enteredAt),
      asc(inquiryFlowActions.environmentId),
      asc(inquiryFlowActions.inquiryId),
      asc(inquiryFlowActions.stepId),
      asc(inquiryFlowActions.entry),
    )
    .limit(options.limit);
}

/** One entry's row, or `null`. */
export async function getInquiryFlowAction(
  db: Db,
  environmentId: string,
  key: InquiryFlowActionKey,
): Promise<InquiryFlowAction | null> {
  const [row] = await db
    .select()
    .from(inquiryFlowActions)
    .where(entryIs(environmentId, key))
    .limit(1);
  return row ?? null;
}

/** C152.2: the latest entry of each action step of the inquiry, by step id. */
export function listLatestInquiryFlowActions(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<InquiryFlowAction[]> {
  return db
    .selectDistinctOn([inquiryFlowActions.stepId])
    .from(inquiryFlowActions)
    .where(
      and(
        eq(inquiryFlowActions.environmentId, environmentId),
        eq(inquiryFlowActions.inquiryId, inquiryId),
      ),
    )
    .orderBy(asc(inquiryFlowActions.stepId), desc(inquiryFlowActions.entry));
}

/** C152.8 (V08): every account copy the inquiry's flow actions made, by step and entry. */
export async function listInquiryFlowActionCopies(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<InquiryFlowActionCopy[]> {
  const rows = await db
    .select({
      stepId: inquiryFlowActions.stepId,
      entry: inquiryFlowActions.entry,
      targetAccountId: inquiryFlowActions.targetAccountId,
      copiedKeys: inquiryFlowActions.copiedKeys,
    })
    .from(inquiryFlowActions)
    .where(
      and(
        eq(inquiryFlowActions.environmentId, environmentId),
        eq(inquiryFlowActions.inquiryId, inquiryId),
        isNotNull(inquiryFlowActions.targetAccountId),
        sql`cardinality(${inquiryFlowActions.copiedKeys}) > 0`,
      ),
    )
    .orderBy(asc(inquiryFlowActions.stepId), asc(inquiryFlowActions.entry));
  return rows.flatMap(({ targetAccountId, ...row }) =>
    targetAccountId === null ? [] : [{ ...row, targetAccountId }],
  );
}
