/**
 * C165.3 (Workflow 9B; contracts B18): `transaction_filter_values`, the plaintext projection of a
 * transaction's `filterable` choices, boolean, integer, number and date fields, and the field types
 * the list's `filter[fields.<key>]` reads. Owner: `api-exports`. `writeTransactionFilterValuesInTx`
 * (`apps/api/src/services/list-filters/transaction-values.ts`) runs the replace beside the field keys;
 * a `filterable` string field is read through `transaction_field_keys` (`transaction-field-keys.ts`).
 * The transaction's redaction deletes these rows but for the kept fields (`transaction-redaction.ts`).
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../client.js';
import { transactionFilterValues, transactionTypeVersions } from '../tables/transactions.js';

/** One projected value: the field and its canonical text (`true`, `42`, `2026-11-06`, a choice). */
export interface TransactionFilterValue {
  fieldKey: string;
  value: string;
}

/**
 * Replaces the projected values of `fieldKeys` on one transaction with `values` (each of which names
 * one of `fieldKeys`), in the caller's transaction.
 */
export async function replaceTransactionFilterValues(
  tx: Db,
  environmentId: string,
  transactionId: string,
  fieldKeys: readonly string[],
  values: readonly TransactionFilterValue[],
): Promise<void> {
  if (fieldKeys.length > 0) {
    await tx
      .delete(transactionFilterValues)
      .where(
        and(
          eq(transactionFilterValues.environmentId, environmentId),
          eq(transactionFilterValues.transactionId, transactionId),
          inArray(transactionFilterValues.fieldKey, [...fieldKeys]),
        ),
      );
  }
  if (values.length > 0) {
    await tx
      .insert(transactionFilterValues)
      .values(values.map((value) => ({ environmentId, transactionId, ...value })))
      .onConflictDoNothing();
  }
}

/** A transaction's projected values, by field key then value (tests and the export read them). */
export async function listTransactionFilterValues(
  db: Db,
  environmentId: string,
  transactionId: string,
): Promise<TransactionFilterValue[]> {
  const rows = await db
    .select({ fieldKey: transactionFilterValues.fieldKey, value: transactionFilterValues.value })
    .from(transactionFilterValues)
    .where(
      and(
        eq(transactionFilterValues.environmentId, environmentId),
        eq(transactionFilterValues.transactionId, transactionId),
      ),
    );
  return rows.sort(
    (a, b) => a.fieldKey.localeCompare(b.fieldKey) || a.value.localeCompare(b.value),
  );
}

/**
 * The field schemas of the environment's transaction type versions a transaction can pin (every
 * version but a draft), of `transactionTypeIds` when given: what `filter[fields.<key>]` is checked
 * against.
 */
export async function listPinnableTransactionFieldSchemas(
  db: Db,
  environmentId: string,
  transactionTypeIds?: readonly string[],
): Promise<unknown[][]> {
  const rows = await db
    .select({ fieldSchemas: transactionTypeVersions.fieldSchemas })
    .from(transactionTypeVersions)
    .where(
      and(
        eq(transactionTypeVersions.environmentId, environmentId),
        ne(transactionTypeVersions.status, 'draft'),
        transactionTypeIds === undefined
          ? undefined
          : inArray(transactionTypeVersions.transactionTypeId, [...transactionTypeIds]),
      ),
    );
  return rows.map((row) => row.fieldSchemas);
}

/**
 * Every field schema of the environment's transaction type versions, drafts included: a saved view
 * reads every string field among them as personal data (C165.2), failing closed.
 */
export async function listAllTransactionFieldSchemas(
  db: Db,
  environmentId: string,
): Promise<unknown[][]> {
  const rows = await db
    .select({ fieldSchemas: transactionTypeVersions.fieldSchemas })
    .from(transactionTypeVersions)
    .where(eq(transactionTypeVersions.environmentId, environmentId));
  return rows.map((row) => row.fieldSchemas);
}
