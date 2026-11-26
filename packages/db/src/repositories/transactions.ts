/**
 * C105 (Workflow 7B): `transactions`. Owner: `api-transactions`; `foundation-7b` (Stage 1b (T))
 * built {@link toTransaction}, which the redaction reads through.
 *
 * `fields` is sealed for its row, as `transactions.fields#<id>`.
 */
import { and, asc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptionalJson, sealJson } from '../sealed.js';
import {
  transactionFieldKeys,
  transactionTypeVersions,
  transactions,
  type TransactionRow,
} from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, createdAtRange, equalsAny, firstOrNull, inserted } from './rows.js';

/** A transaction with its fields opened: each key to `{ type, value }`. */
export interface Transaction extends Omit<TransactionRow, 'fieldsSealed'> {
  /** `null` once redacted with no `never` field left. */
  fields: Readonly<Record<string, unknown>> | null;
}

export interface NewTransaction {
  id: string;
  transactionTypeId: string;
  transactionTypeVersionId: string;
  referenceId: string | null;
  status: string;
  fields: Readonly<Record<string, unknown>>;
  tags: readonly string[];
}

export interface TransactionChanges {
  fields?: Readonly<Record<string, unknown>>;
  status?: string;
  referenceId?: string | null;
  tags?: readonly string[];
}

export interface TransactionFilters {
  referenceId?: string | undefined;
  transactionTypeIds?: readonly string[] | undefined;
  statuses?: readonly string[] | undefined;
  /** `filter[identifier]`: the field's key and the keyed value (C105.2). */
  identifier?: { fieldKey: string; valueKey: string } | undefined;
  createdAtStart?: Date | undefined;
  createdAtEnd?: Date | undefined;
  /**
   * C165.3 (Workflow 9B Stage 1b (X)): the conditions the list filter hook answers
   * (`transactionListFilters`, `api-exports`), on `transactions`, ANDed with the rest.
   */
  where?: readonly SQL[] | undefined;
}

/** The transaction of a row, its fields opened. */
export function toTransaction(row: TransactionRow): Transaction {
  const { fieldsSealed, ...rest } = row;
  return {
    ...rest,
    fields: openOptionalJson(SEALED.transactionFields, row.id, fieldsSealed) as Readonly<
      Record<string, unknown>
    > | null,
  };
}

const transactionCursor = environmentCursor(transactions);

const inEnvironment = (environmentId: string, id: string) =>
  and(eq(transactions.environmentId, environmentId), eq(transactions.id, id));

export async function createTransaction(
  tx: Db,
  environmentId: string,
  input: NewTransaction,
): Promise<Transaction> {
  return toTransaction(
    inserted(
      await tx
        .insert(transactions)
        .values({
          id: input.id,
          environmentId,
          transactionTypeId: input.transactionTypeId,
          transactionTypeVersionId: input.transactionTypeVersionId,
          referenceId: input.referenceId,
          status: input.status,
          fieldsSealed: sealJson(SEALED.transactionFields, input.id, input.fields),
          tags: [...input.tags],
        })
        .returning(),
      'createTransaction',
    ),
  );
}

export async function getTransaction(
  db: Db,
  environmentId: string,
  id: string,
): Promise<Transaction | null> {
  const row = firstOrNull(
    await db.select().from(transactions).where(inEnvironment(environmentId, id)).limit(1),
  );
  return row === null ? null : toTransaction(row);
}

/** The row under `FOR UPDATE`: what every write and its `write_once` check run under (C111.3). */
export async function lockTransaction(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<Transaction | null> {
  const row = firstOrNull(
    await tx.select().from(transactions).where(inEnvironment(environmentId, id)).for('update'),
  );
  return row === null ? null : toTransaction(row);
}

/** `GET /transactions`: `created_at DESC, id DESC`. */
export async function listTransactions(
  db: Db,
  environmentId: string,
  filters: TransactionFilters,
  page: PageRequest,
): Promise<Page<Transaction>> {
  const { identifier } = filters;
  const conditions = allFilters([
    eq(transactions.environmentId, environmentId),
    filters.referenceId === undefined
      ? undefined
      : eq(transactions.referenceId, filters.referenceId),
    equalsAny(transactions.transactionTypeId, filters.transactionTypeIds),
    equalsAny(transactions.status, filters.statuses),
    identifier === undefined
      ? undefined
      : sql`exists (select 1 from ${transactionFieldKeys}
          where ${transactionFieldKeys.environmentId} = ${transactions.environmentId}
            and ${transactionFieldKeys.transactionId} = ${transactions.id}
            and ${transactionFieldKeys.fieldKey} = ${identifier.fieldKey}
            and ${transactionFieldKeys.valueKey} = ${identifier.valueKey})`,
    ...createdAtRange(transactions.createdAt, filters),
    ...(filters.where ?? []),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  const result = await paginate(db, transactionCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(transactions)
      .where(and(...conditions, after))
      .orderBy(...newestFirst(transactionCursor))
      .limit(limit),
  );
  return { items: result.items.map(toTransaction), next: result.next };
}

/** C105.4: an unredacted transaction with its pinned version's field schemas (the rebuild). */
export interface TransactionForRebuild {
  id: string;
  environmentId: string;
  fields: Readonly<Record<string, unknown>> | null;
  fieldSchemas: readonly unknown[];
}

/** `blind-index:rebuild`: the unredacted transactions of every environment, by id. */
export async function listTransactionsForRebuild(
  db: Db,
  options: { afterId: string | null; limit: number },
): Promise<TransactionForRebuild[]> {
  const rows = await db
    .select({ row: transactions, fieldSchemas: transactionTypeVersions.fieldSchemas })
    .from(transactions)
    .innerJoin(
      transactionTypeVersions,
      and(
        eq(transactionTypeVersions.environmentId, transactions.environmentId),
        eq(transactionTypeVersions.id, transactions.transactionTypeVersionId),
      ),
    )
    .where(
      and(
        isNull(transactions.redactedAt),
        options.afterId === null ? undefined : gt(transactions.id, options.afterId),
      ),
    )
    .orderBy(asc(transactions.id))
    .limit(options.limit);
  return rows.map(({ row, fieldSchemas }) => ({
    id: row.id,
    environmentId: row.environmentId,
    fields: toTransaction(row).fields,
    fieldSchemas,
  }));
}

export async function updateTransaction(
  tx: Db,
  environmentId: string,
  id: string,
  changes: TransactionChanges,
): Promise<Transaction | null> {
  const row = firstOrNull(
    await tx
      .update(transactions)
      .set({
        ...(changes.fields === undefined
          ? {}
          : { fieldsSealed: sealJson(SEALED.transactionFields, id, changes.fields) }),
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(changes.referenceId === undefined ? {} : { referenceId: changes.referenceId }),
        ...(changes.tags === undefined ? {} : { tags: [...changes.tags] }),
        updatedAt: sql`now()`,
      })
      .where(inEnvironment(environmentId, id))
      .returning(),
  );
  return row === null ? null : toTransaction(row);
}
