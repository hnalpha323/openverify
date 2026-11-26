/**
 * C98.2 (Workflow 7B): `rebuildListIndexes`, which `blind-index:rebuild` calls after the device
 * indexes. It recomputes every list key from the sealed values with `listKeyInputs`, which is why
 * it lives here and not in `packages/db` as `rebuildDeviceIndexes` does: the key inputs are
 * `packages/checks`' and `packages/watchlist`'s, and `packages/db` depends only on core. Owner:
 * `api-lists`.
 *
 * - An item whose keys and version are already current is left alone, so a second run updates
 *   nothing and a list's `version` only moves for what changed.
 * - A fingerprint item whose `key_id` is not current cannot be re-derived: its value is an HMAC
 *   under the old key, so it stays unmatched and its list answers `key_rotated`.
 * - A value the normaliser no longer reads stays at its old version, so its list answers
 *   `normaliser_outdated` rather than losing the item without a word.
 * - A row whose new key meets a live one is merged: the older stays, and this one is archived.
 *
 * It logs nothing here; the script prints the counts.
 */
import { LIST_KEYS_VERSION, ListKeyInputError } from '@openverify/checks';
import { LIST_KIND_REGISTRY } from '@openverify/core';
import {
  blindIndexKeyId,
  listListItemsForRebuild,
  rewriteListItemKeys,
  type Db,
  type ListItemForRebuild,
  type RebuildIndexesResult,
} from '@openverify/db';
import { createOutboxOnlyPublisher, type TransactionalEventPublisher } from '../../events/index.js';
import { stageListUpdated } from '../../workflows/actions/lists/list-updated.js';
import { storedKeysOf, type StoredKeys } from './keys.js';

export interface RebuildListIndexesOptions {
  /**
   * C127.12: a rewritten key can change what a list matches, so a monitored report re-screens. A CLI
   * has no queues, so by default the rows wait for their sweeps.
   */
  events?: TransactionalEventPublisher;
  batchSize: number;
}

export type RebuildListIndexes = (
  db: Db,
  key: Uint8Array,
  options: RebuildListIndexesOptions,
) => Promise<RebuildIndexesResult>;

/** The item's keys under `key`, or `null` for a row that stays as it is. */
function keysOf(row: ListItemForRebuild, key: Uint8Array, keyId: string): StoredKeys | null {
  const { kind, value } = row;
  const { biometric, keyed } = LIST_KIND_REGISTRY[kind];
  if (value === null || biometric || (keyed && row.keyId !== keyId)) {
    return null;
  }
  try {
    return storedKeysOf(key, row.environmentId, { ...row, type: kind }, value);
  } catch (error) {
    if (error instanceof ListKeyInputError) {
      return null;
    }
    throw error;
  }
}

/** C127.12: the lists one page rewrote, by environment. */
type RewrittenLists = Map<string, Map<string, number>>;

/** One event per list and page, however many items it rewrote, each environment in its own. */
async function stageRewrittenLists(
  db: Db,
  events: TransactionalEventPublisher,
  rewritten: RewrittenLists,
): Promise<void> {
  for (const [environmentId, lists] of rewritten) {
    const staged = await db.transaction((tx) =>
      stageListUpdated(
        tx,
        { events },
        environmentId,
        [...lists].map(([listId, items]) => ({ listId, changeKind: 'items-rewritten', items })),
      ),
    );
    await events.dispatch(staged);
  }
}

export const rebuildListIndexes: RebuildListIndexes = async (db, key, options) => {
  const { batchSize } = options;
  const events = options.events ?? createOutboxOnlyPublisher(db);
  const keyId = blindIndexKeyId(key);
  let afterId: string | null = null;
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const page: ListItemForRebuild[] = await listListItemsForRebuild(db, {
      afterId,
      limit: batchSize,
    });
    const rewritten: RewrittenLists = new Map();
    for (const row of page) {
      scanned += 1;
      const keys = keysOf(row, key, keyId);
      const current =
        keys?.matchKey === row.matchKey && row.normaliserVersion === LIST_KEYS_VERSION;
      if (keys !== null && !current) {
        await rewriteListItemKeys(db, row.environmentId, {
          id: row.id,
          listId: row.listId,
          matchKey: keys.matchKey,
          normaliserVersion: keys.normaliserVersion,
          keys: keys.keys,
          range: keys.range,
          boxes: keys.boxes,
        });
        updated += 1;
        const lists = rewritten.get(row.environmentId) ?? new Map<string, number>();
        lists.set(row.listId, (lists.get(row.listId) ?? 0) + 1);
        rewritten.set(row.environmentId, lists);
      }
    }
    await stageRewrittenLists(db, events, rewritten);
    const last = page.at(-1);
    if (last === undefined) {
      return { scanned, updated };
    }
    afterId = last.id;
  }
};
