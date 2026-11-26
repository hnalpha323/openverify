/**
 * C105.4 (Workflow 7B): `rebuildTransactionFieldKeys`, which `blind-index:rebuild` calls after the
 * list keys. It recomputes the `transaction_field_keys` rows of every unredacted transaction from
 * its sealed fields and the `searchable` fields of its pinned version, under
 * `identifierKey(key, { environmentId, kind: 'identifier-transaction-field', input })`, so a key
 * change does not leave `filter[identifier]` answering nothing. Each transaction is rewritten under
 * its row lock, so a concurrent write or redaction waits; one whose keys are current is left alone,
 * so a second run updates nothing. It logs nothing; the script prints the counts. Owner:
 * `api-transactions`.
 */
import type { FieldSchema } from '@openverify/core';
import {
  listTransactionFieldKeys,
  listTransactionsForRebuild,
  lockTransaction,
  replaceTransactionFieldKeys,
  type Db,
  type RebuildIndexesResult,
} from '@openverify/db';
import { searchableFieldKeys, searchableKeysOf } from './write-checks.js';

export interface RebuildTransactionFieldKeysOptions {
  batchSize: number;
}

export type RebuildTransactionFieldKeys = (
  db: Db,
  key: Uint8Array,
  options: RebuildTransactionFieldKeysOptions,
) => Promise<RebuildIndexesResult>;

const sameKeys = (left: readonly { fieldKey: string; valueKey: string }[], right: typeof left) =>
  JSON.stringify([...left].sort(compare)) === JSON.stringify([...right].sort(compare));

function compare(
  left: { fieldKey: string; valueKey: string },
  right: { fieldKey: string; valueKey: string },
): number {
  const byField = left.fieldKey.localeCompare(right.fieldKey);
  return byField === 0 ? left.valueKey.localeCompare(right.valueKey) : byField;
}

export const rebuildTransactionFieldKeys: RebuildTransactionFieldKeys = async (
  db,
  key,
  { batchSize },
) => {
  let afterId: string | null = null;
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const page = await listTransactionsForRebuild(db, { afterId, limit: batchSize });
    for (const row of page) {
      scanned += 1;
      const fieldSchemas = row.fieldSchemas as readonly FieldSchema[];
      const changed = await db.transaction(async (tx) => {
        const locked = await lockTransaction(tx, row.environmentId, row.id);
        if (locked?.redactedAt !== null) {
          return false;
        }
        const keys = searchableFieldKeys(key, row.environmentId, fieldSchemas, locked.fields ?? {});
        const held = await listTransactionFieldKeys(tx, row.environmentId, row.id);
        if (sameKeys(keys, held)) {
          return false;
        }
        await replaceTransactionFieldKeys(
          tx,
          row.environmentId,
          row.id,
          [...new Set([...searchableKeysOf(fieldSchemas), ...held.map((held) => held.fieldKey)])],
          keys,
        );
        return true;
      });
      if (changed) {
        updated += 1;
      }
    }
    const last = page.at(-1);
    if (page.length < batchSize || last === undefined) {
      return { scanned, updated };
    }
    afterId = last.id;
  }
};
