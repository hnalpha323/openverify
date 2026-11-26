/**
 * C127.12 (F20, V03): `list.updated` and the `list_rescreen_requests` row, written in the list write's
 * transaction, one each per list and transaction (coalesced here, so a write that touches a list twice
 * stages once, and a repeat at one version stages nothing). `dispatch()` enqueues the `list-rescreen`
 * job, and the sweep is the outbox. `foundation-8a` placed a call at each Phase 7 list write path
 * (`services/list-writes.test.ts` fails a bump that stages nothing).
 */
import type { ListUpdateChangeKind } from '@openverify/contracts';
import { createListRescreenRequest, getList, type Db } from '@openverify/db';
import type { StagedEvent, TransactionalEventPublisher } from '../../../events/index.js';
import { listResource } from '../../../services/lists/resources.js';

/** One list a write changed. */
export interface ListUpdate {
  listId: string;
  changeKind: ListUpdateChangeKind;
  /** How many items changed; 0 for an archive of an empty list. */
  items: number;
}

export interface ListUpdatedDeps {
  events: TransactionalEventPublisher;
}

function coalesced(updates: readonly ListUpdate[]): ListUpdate[] {
  const byList = new Map<string, ListUpdate>();
  for (const update of updates) {
    const seen = byList.get(update.listId);
    byList.set(
      update.listId,
      seen === undefined ? update : { ...seen, items: seen.items + update.items },
    );
  }
  return [...byList.values()];
}

export async function stageListUpdated(
  tx: Db,
  deps: ListUpdatedDeps,
  environmentId: string,
  updates: readonly ListUpdate[],
): Promise<StagedEvent[]> {
  const staged: StagedEvent[] = [];
  for (const { listId, changeKind, items } of coalesced(updates)) {
    const list = await getList(tx, environmentId, listId);
    if (list === null) {
      continue;
    }
    const key = { listId, listVersion: list.version };
    if (await createListRescreenRequest(tx, environmentId, key)) {
      const event = await deps.events.stage(tx, {
        environmentId,
        name: 'list.updated',
        payload: {
          data: listResource(list),
          meta: {
            'change-kind': changeKind,
            counts: { 'items-changed': items },
            'list-version': list.version,
          },
        },
      });
      staged.push({ ...event, listRescreens: [{ environmentId, ...key }] });
    }
  }
  return staged;
}
