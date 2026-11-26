/**
 * C165.3 (Workflow 9B; contracts B18): the plaintext projection of a transaction's `filterable`
 * choices, boolean, integer, number and date fields (`transaction_filter_values`), written in the
 * transaction's own write. Owner: `api-exports`; `foundation-9b` (Stage 1b (X)) calls it from the
 * transaction create and update (`services/transactions/transactions.ts`), beside the searchable
 * field keys. A searchable string field needs no row here: it is read through `transaction_field_keys`.
 *
 * The rows of the changed fields (all of them at creation, `changedFieldKeys: null`) are replaced by
 * each value's canonical text ({@link canonicalFilterText}); a field set to `null`, or a value whose
 * text is empty or longer than the filter value's own bound (1,024), has no row, so no filter can
 * match it.
 *
 * No backfill: `filterable` came with Workflow 9B (contracts-9b, Stage 1a), and this hook was placed
 * in the same unreleased Workflow, so no released tree ever wrote a filterable field without it.
 */
import { FIELD_TYPES_FILTERABLE, type FieldSchema, type FieldSchemaType } from '@openverify/core';
import {
  replaceTransactionFilterValues,
  type Db,
  type TransactionFilterValue,
} from '@openverify/db';

export interface TransactionFilterValuesWrite {
  environmentId: string;
  transactionId: string;
  /** The pinned version's field schemas; only top-level `filterable` fields are projected. */
  fieldSchemas: readonly FieldSchema[];
  /** The transaction's fields after the write, as stored: each a typed `{ type, value }`. */
  fields: Readonly<Record<string, unknown>>;
  /** The fields the write changed; `null` at creation (every field). */
  changedFieldKeys: readonly string[] | null;
}

export type WriteTransactionFilterValuesInTx = (
  tx: Db,
  write: TransactionFilterValuesWrite,
) => Promise<void>;

/** The bound of one filter value (`listTransactionsQuerySchema`) and of a projected row. */
const MAX_FILTER_TEXT = 1024;

/** Whether `field` is projected: a top-level `filterable` field of `FIELD_TYPES_FILTERABLE`. */
export function isProjectedField(field: FieldSchema): boolean {
  return (
    field.config?.filterable === true &&
    FIELD_TYPES_FILTERABLE.includes(field.type as FieldSchemaType)
  );
}

/**
 * The canonical text of a stored value of a filterable `type`, or `null` when it has none: a number
 * as JavaScript writes it (`42`, `4.5`), `true` or `false`, a date or a choice as stored.
 */
export function canonicalFilterText(type: string, value: unknown): string | null {
  let text: string | null = null;
  if ((type === 'integer' || type === 'number') && typeof value === 'number') {
    text = Number.isFinite(value) ? String(value) : null;
  } else if (type === 'boolean' && typeof value === 'boolean') {
    text = String(value);
  } else if ((type === 'date' || type === 'choices') && typeof value === 'string') {
    text = value;
  }
  return text === null || text.length === 0 || text.length > MAX_FILTER_TEXT ? null : text;
}

/** The stored value of a typed field (`{ type, value }`), or the value itself. */
function storedValue(field: unknown): unknown {
  return field !== null && typeof field === 'object' && 'value' in field ? field.value : field;
}

export const writeTransactionFilterValuesInTx: WriteTransactionFilterValuesInTx = async (
  tx,
  write,
) => {
  const changed = write.changedFieldKeys === null ? null : new Set(write.changedFieldKeys);
  const projected = write.fieldSchemas.filter(
    (field) => isProjectedField(field) && (changed === null || changed.has(field.key)),
  );
  if (projected.length === 0) {
    return;
  }
  const values: TransactionFilterValue[] = [];
  for (const field of projected) {
    const text = canonicalFilterText(field.type, storedValue(write.fields[field.key]));
    if (text !== null) {
      values.push({ fieldKey: field.key, value: text });
    }
  }
  await replaceTransactionFilterValues(
    tx,
    write.environmentId,
    write.transactionId,
    projected.map((field) => field.key),
    values,
  );
};
