/**
 * C127.7, C117.5: what a run owes an object it created. The object carries its step, so the unique
 * `(environment_id, workflow_run_step_id)` holds beside the effect row. Under a transaction's trigger
 * the object is that transaction's child and joins its related objects, at most 100.
 */
import {
  addTransactionObjects,
  listTransactionObjects,
  recordTransactionChild,
  stampObjectRunStep,
  type Db,
  type RunStepObjectTable,
  type TransactionChildType,
} from '@openverify/db';
import { TRANSACTION_LIMITS } from '@openverify/core';
import { isJsonRecord } from '@openverify/workflow-engine';
import { ActionStepError, type ActionContext } from '../engine/action-port.js';

/** The transaction that started this run, or `null`. */
export function triggerTransactionOf({ state }: Pick<ActionContext, 'state'>): string | null {
  const id = isJsonRecord(state.trigger) ? state.trigger.id : undefined;
  return typeof id === 'string' && id.startsWith('txn_') ? id : null;
}

/** @throws {ActionStepError} `related_objects_limit` for the 101st related object (outcome 33). */
export async function recordCreatedObjectInTx(
  tx: Db,
  context: ActionContext,
  table: RunStepObjectTable,
  created: { id: string; childType?: TransactionChildType },
): Promise<void> {
  const { environmentId, stepId, runId } = context;
  await stampObjectRunStep(tx, table, environmentId, created.id, stepId);
  const transactionId = triggerTransactionOf(context);
  if (transactionId === null || created.childType === undefined) {
    return;
  }
  const held = (await listTransactionObjects(tx, environmentId, [transactionId])).get(
    transactionId,
  );
  if ((held ?? []).length >= TRANSACTION_LIMITS.relatedObjects) {
    throw new ActionStepError('related_objects_limit');
  }
  await recordTransactionChild(tx, environmentId, {
    transactionId,
    childType: created.childType,
    childId: created.id,
    workflowRunId: runId,
  });
  await addTransactionObjects(tx, environmentId, transactionId, [created.id]);
}
