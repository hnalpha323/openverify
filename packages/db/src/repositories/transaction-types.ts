/**
 * C104.1 (Workflow 7B): `transaction_types`. Owner: `api-transactions`. An archived type takes no
 * new transaction; types are never deleted.
 */
import type { TransactionTypeStatus } from '@openverify/core';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { transactionTypes, type TransactionTypeRow } from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted } from './rows.js';

export type TransactionType = TransactionTypeRow;

export interface NewTransactionType {
  id: string;
  name: string;
  adverseStatuses?: readonly string[];
  contestRoute?: Record<string, unknown> | null;
}

/** C122.1, C128.3: the members that are the type's, not a version's. */
export interface TransactionTypeChanges {
  adverseStatuses?: readonly string[];
  contestRoute?: Record<string, unknown> | null;
}

export interface TransactionTypeFilters {
  statuses?: readonly TransactionTypeStatus[] | undefined;
}

const typeCursor = environmentCursor(transactionTypes);

const inEnvironment = (environmentId: string, id: string) =>
  and(eq(transactionTypes.environmentId, environmentId), eq(transactionTypes.id, id));

export async function createTransactionType(
  tx: Db,
  environmentId: string,
  input: NewTransactionType,
): Promise<TransactionType> {
  return inserted(
    await tx
      .insert(transactionTypes)
      .values({
        id: input.id,
        environmentId,
        name: input.name,
        ...(input.adverseStatuses === undefined
          ? {}
          : { adverseStatuses: [...input.adverseStatuses] }),
        contestRoute: input.contestRoute ?? null,
      })
      .returning(),
    'createTransactionType',
  );
}

export async function getTransactionType(
  db: Db,
  environmentId: string,
  id: string,
): Promise<TransactionType | null> {
  return firstOrNull(
    await db.select().from(transactionTypes).where(inEnvironment(environmentId, id)).limit(1),
  );
}

/** The type under `FOR UPDATE`: publishing and creating versions run under it (C104.1, as C71). */
export async function lockTransactionType(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<TransactionType | null> {
  return firstOrNull(
    await tx.select().from(transactionTypes).where(inEnvironment(environmentId, id)).for('update'),
  );
}

/** `GET /transaction-types`: `created_at DESC, id DESC`. */
export async function listTransactionTypes(
  db: Db,
  environmentId: string,
  filters: TransactionTypeFilters,
  page: PageRequest,
): Promise<Page<TransactionType>> {
  const conditions = allFilters([
    eq(transactionTypes.environmentId, environmentId),
    equalsAny(transactionTypes.status, filters.statuses),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, typeCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(transactionTypes)
      .where(and(...conditions, after))
      .orderBy(...newestFirst(typeCursor))
      .limit(limit),
  );
}

/** `PATCH /transaction-types/:id`: the name only; everything else is a version's. */
/** Writes what is the type's and not a version's; `null` when it is not in this environment. */
export async function updateTransactionType(
  db: Db,
  environmentId: string,
  id: string,
  changes: TransactionTypeChanges,
): Promise<TransactionType | null> {
  const values = {
    ...(changes.adverseStatuses === undefined
      ? {}
      : { adverseStatuses: [...changes.adverseStatuses] }),
    ...(changes.contestRoute === undefined ? {} : { contestRoute: changes.contestRoute }),
  };
  if (Object.keys(values).length === 0) {
    return getTransactionType(db, environmentId, id);
  }
  return firstOrNull(
    await db
      .update(transactionTypes)
      .set(values)
      .where(inEnvironment(environmentId, id))
      .returning(),
  );
}

export async function renameTransactionType(
  db: Db,
  environmentId: string,
  id: string,
  name: string,
): Promise<TransactionType | null> {
  return firstOrNull(
    await db
      .update(transactionTypes)
      .set({ name })
      .where(inEnvironment(environmentId, id))
      .returning(),
  );
}

/** `DELETE /transaction-types/:id`: archives; a second call changes nothing. */
export async function archiveTransactionType(
  db: Db,
  environmentId: string,
  id: string,
): Promise<TransactionType | null> {
  const archived = firstOrNull(
    await db
      .update(transactionTypes)
      .set({ status: 'archived' })
      .where(and(inEnvironment(environmentId, id), eq(transactionTypes.status, 'active')))
      .returning(),
  );
  return archived ?? getTransactionType(db, environmentId, id);
}
