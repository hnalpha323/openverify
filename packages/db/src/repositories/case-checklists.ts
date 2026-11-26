/**
 * C172.2 (Workflow 9B): `case_checklist_states`. Owner: `api-cases-reports`, which reads a case's
 * items and checks or unchecks one item under the case's row lock (Phase 8's `lock-version`), beside
 * its `checklist-item-checked` or `-unchecked` history row. `foundation-9b` (Stage 1b (C)) declared
 * the record.
 *
 * Keys and ids only: no row here or in the history names a value (C131.4, C172.7).
 */
import type { CaseChecklistHistoryKind } from '@openverify/core';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  caseChecklistStates,
  caseHistory,
  type CaseChecklistActorType,
  type CaseHistoryActorType,
} from '../tables/cases.js';
import type { CaseChecklistStateRow } from '../schema.js';

/**
 * One item's state: a checked item names who checked it (`user` or `workflow-run`) and when, an
 * unchecked one neither (`case_checklist_states_checked_whole`).
 */
export type CaseChecklistStateRecord = CaseChecklistStateRow;

/** The items of a case that were ever set, by checklist then item key. */
export async function listCaseChecklistStates(
  db: Db,
  environmentId: string,
  caseId: string,
): Promise<CaseChecklistStateRecord[]> {
  return db
    .select()
    .from(caseChecklistStates)
    .where(
      and(
        eq(caseChecklistStates.environmentId, environmentId),
        eq(caseChecklistStates.caseId, caseId),
      ),
    )
    .orderBy(asc(caseChecklistStates.checklistKey), asc(caseChecklistStates.itemKey));
}

export interface SetCaseChecklistItem {
  caseId: string;
  checklistKey: string;
  itemKey: string;
  /** Who checks it; `null` unchecks it, naming no one. */
  checkedBy: { type: CaseChecklistActorType; id: string } | null;
  at: Date;
}

/**
 * Checks or unchecks one item, under the caller's lock on the case. `null` when the item already
 * held that state (nothing written); the stored state otherwise.
 */
export async function setCaseChecklistItemState(
  tx: Db,
  environmentId: string,
  input: SetCaseChecklistItem,
): Promise<CaseChecklistStateRecord | null> {
  const key = and(
    eq(caseChecklistStates.environmentId, environmentId),
    eq(caseChecklistStates.caseId, input.caseId),
    eq(caseChecklistStates.checklistKey, input.checklistKey),
    eq(caseChecklistStates.itemKey, input.itemKey),
  );
  const [current] = await tx.select().from(caseChecklistStates).where(key).limit(1);
  const checked = input.checkedBy !== null;
  if ((current?.checked ?? false) === checked) {
    return null;
  }
  const state = {
    checked,
    checkedByType: input.checkedBy?.type ?? null,
    checkedById: input.checkedBy?.id ?? null,
    checkedAt: checked ? input.at : null,
    updatedAt: input.at,
  };
  const [stored] =
    current === undefined
      ? await tx
          .insert(caseChecklistStates)
          .values({
            environmentId,
            caseId: input.caseId,
            checklistKey: input.checklistKey,
            itemKey: input.itemKey,
            ...state,
          })
          .returning()
      : await tx.update(caseChecklistStates).set(state).where(key).returning();
  if (stored === undefined) {
    throw new Error('setCaseChecklistItemState: the state was not written');
  }
  return stored;
}

export interface NewCaseChecklistHistoryRow {
  caseId: string;
  kind: CaseChecklistHistoryKind;
  actorType: CaseHistoryActorType;
  actorId: string | null;
  checklistKey: string;
  itemKey: string;
  requestId?: string | null;
}

/** The item's history row: its keys and the actor, never a value (C131.4). */
export async function appendCaseChecklistHistory(
  tx: Db,
  environmentId: string,
  row: NewCaseChecklistHistoryRow,
): Promise<void> {
  await tx.insert(caseHistory).values({
    environmentId,
    caseId: row.caseId,
    kind: row.kind,
    actorType: row.actorType,
    actorId: row.actorId,
    from: null,
    to: { 'checklist-key': row.checklistKey, 'item-key': row.itemKey },
    requestId: row.requestId ?? null,
  });
}
