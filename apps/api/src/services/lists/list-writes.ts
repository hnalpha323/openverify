/**
 * C127.12, C128.1 (F20, V25): what every list item redaction owes, whoever ran it: the decision
 * comments of the items it took, and `list.updated` for the lists it changed. The repositories name
 * both, because they cannot reach either hook.
 */
import type { Db, ListItemRedaction } from '@openverify/db';
import type { StagedEvent } from '../../events/index.js';
import {
  stageListUpdated,
  type ListUpdatedDeps,
} from '../../workflows/actions/lists/list-updated.js';
import { redactDecisionCommentsInTx } from '../decisions/redaction.js';

export async function afterListItemsRedactedInTx(
  tx: Db,
  deps: ListUpdatedDeps,
  environmentId: string,
  redaction: Pick<ListItemRedaction, 'changedLists' | 'redactedItemIds'>,
  at: Date,
): Promise<StagedEvent[]> {
  const { changedLists, redactedItemIds } = redaction;
  if (redactedItemIds.length > 0) {
    await redactDecisionCommentsInTx(tx, { environmentId, subjectIds: redactedItemIds, at });
  }
  if (changedLists.length === 0) {
    return [];
  }
  return stageListUpdated(
    tx,
    deps,
    environmentId,
    changedLists.map(({ listId, items }) => ({ listId, changeKind: 'items-redacted', items })),
  );
}
