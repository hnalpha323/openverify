/**
 * C105.4 (Workflow 7B): `transaction_field_keys`, the equality index of `searchable` fields. Owner:
 * `api-transactions`.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { transactionFieldKeys } from '../schema.js';

/** One searchable value of a field: the key is `identifierKey`'s 64 hex. */
export interface TransactionFieldKey {
  fieldKey: string;
  valueKey: string;
}

/** Replaces the rows of the given fields with `keys`, in the transaction's write. */
export async function replaceTransactionFieldKeys(
  tx: Db,
  environmentId: string,
  transactionId: string,
  fieldKeys: readonly string[],
  keys: readonly TransactionFieldKey[],
): Promise<void> {
  if (fieldKeys.length > 0) {
    await tx
      .delete(transactionFieldKeys)
      .where(
        and(
          eq(transactionFieldKeys.environmentId, environmentId),
          eq(transactionFieldKeys.transactionId, transactionId),
          inArray(transactionFieldKeys.fieldKey, [...fieldKeys]),
        ),
      );
  }
  if (keys.length > 0) {
    await tx
      .insert(transactionFieldKeys)
      .values(keys.map((key) => ({ environmentId, transactionId, ...key })))
      .onConflictDoNothing();
  }
}

/** The keyed values a transaction holds, by field key then value key (the rebuild compares them). */
export async function listTransactionFieldKeys(
  db: Db,
  environmentId: string,
  transactionId: string,
): Promise<TransactionFieldKey[]> {
  return db
    .select({ fieldKey: transactionFieldKeys.fieldKey, valueKey: transactionFieldKeys.valueKey })
    .from(transactionFieldKeys)
    .where(
      and(
        eq(transactionFieldKeys.environmentId, environmentId),
        eq(transactionFieldKeys.transactionId, transactionId),
      ),
    )
    .orderBy(asc(transactionFieldKeys.fieldKey), asc(transactionFieldKeys.valueKey));
}
