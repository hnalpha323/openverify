/**
 * C105.2, C105.7 (Workflow 7B): `transaction_objects` and `transaction_relations`. Owner:
 * `api-transactions`. Both are idempotent: a repeat writes nothing.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { InvalidCursorError } from '../errors.js';
import {
  accounts,
  inquiries,
  reports,
  transactionObjects,
  transactionRelations,
  transactions,
  verifications,
  type TransactionObjectRow,
  type TransactionRelationRow,
} from '../schema.js';
import { pageSize, type Page, type PageRequest } from './pagination.js';

/** An object by its id: `acc_`, `inq_`, `rep_` or `ver_` names its column. */
export type TransactionObjectId = string;

/** The column an object id names, by its prefix. */
function objectColumns(id: string) {
  switch (id.slice(0, id.indexOf('_'))) {
    case 'acc':
      return { accountId: id };
    case 'inq':
      return { inquiryId: id };
    case 'rep':
      return { reportId: id };
    case 'ver':
      return { verificationId: id };
    default:
      throw new RangeError('not an object id a transaction takes');
  }
}

/** Attaches the objects; returns the ids it wrote. Ids of another environment fail the key. */
export async function addTransactionObjects(
  tx: Db,
  environmentId: string,
  transactionId: string,
  objectIds: readonly TransactionObjectId[],
): Promise<string[]> {
  if (objectIds.length === 0) {
    return [];
  }
  const rows = await tx
    .insert(transactionObjects)
    .values(objectIds.map((id) => ({ environmentId, transactionId, ...objectColumns(id) })))
    .onConflictDoNothing()
    .returning({ objectId: transactionObjects.objectId });
  return rows.map((row) => row.objectId);
}

export async function removeTransactionObjects(
  tx: Db,
  environmentId: string,
  transactionId: string,
  objectIds: readonly TransactionObjectId[],
): Promise<string[]> {
  if (objectIds.length === 0) {
    return [];
  }
  const rows = await tx
    .delete(transactionObjects)
    .where(
      and(
        eq(transactionObjects.environmentId, environmentId),
        eq(transactionObjects.transactionId, transactionId),
        inArray(transactionObjects.objectId, [...objectIds]),
      ),
    )
    .returning({ objectId: transactionObjects.objectId });
  return rows.map((row) => row.objectId);
}

/** Each transaction's objects, in the order they were attached. */
export async function listTransactionObjects(
  db: Db,
  environmentId: string,
  transactionIds: readonly string[],
): Promise<ReadonlyMap<string, TransactionObjectRow[]>> {
  const grouped = new Map<string, TransactionObjectRow[]>();
  if (transactionIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .select()
    .from(transactionObjects)
    .where(
      and(
        eq(transactionObjects.environmentId, environmentId),
        inArray(transactionObjects.transactionId, [...transactionIds]),
      ),
    )
    .orderBy(asc(transactionObjects.createdAt), asc(transactionObjects.objectId));
  for (const row of rows) {
    const list = grouped.get(row.transactionId) ?? [];
    list.push(row);
    grouped.set(row.transactionId, list);
  }
  return grouped;
}

/**
 * A position in a transaction's relations: `<created_at>~<key>~<target>`, the order's three columns.
 * A key is `[a-z0-9_-]` and a target an id, so `~` is in neither. The time keeps the row's
 * microseconds, which a JavaScript date would lose, so it comes from the query as text.
 */
const relationPosition = sql<string>`to_char(${transactionRelations.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The row condition of a page after `after`; `undefined` for a first page. */
function afterRelation(after: string | undefined): SQL | undefined {
  if (after === undefined) {
    return undefined;
  }
  const [at, key, target, ...rest] = after.split('~');
  if (at === undefined || key === undefined || target === undefined || rest.length > 0) {
    throw new InvalidCursorError();
  }
  return sql`(${transactionRelations.createdAt}, ${transactionRelations.relationSchemaKey}, ${transactionRelations.targetId}) < (${at}::timestamptz, ${key}::text, ${target}::text)`;
}

/**
 * `GET /transactions/:id/relations`: `created_at DESC, relation_schema_key DESC, target_id DESC`,
 * a total order, as the primary key is the transaction, the key and the target. The table has no
 * `id` for `paginate`, and unlike the append-only history a row can be removed, so the cursor is a
 * position rather than a row to look up: the row it came from may be gone by the next page, and a
 * row added since sorts before it, so neither moves a reader's place.
 */
export async function listTransactionRelationsPage(
  db: Db,
  environmentId: string,
  transactionId: string,
  page: PageRequest = {},
): Promise<Page<TransactionRelationRow>> {
  const size = pageSize(page.size);
  const rows = await db
    .select({ row: transactionRelations, position: relationPosition })
    .from(transactionRelations)
    .where(
      and(
        eq(transactionRelations.environmentId, environmentId),
        eq(transactionRelations.transactionId, transactionId),
        afterRelation(page.after),
      ),
    )
    .orderBy(
      desc(transactionRelations.createdAt),
      desc(transactionRelations.relationSchemaKey),
      desc(transactionRelations.targetId),
    )
    .limit(size + 1);
  const last = rows.at(size - 1);
  return {
    items: rows.slice(0, size).map(({ row }) => row),
    next:
      rows.length > size && last !== undefined
        ? `${last.position}~${last.row.relationSchemaKey}~${last.row.targetId}`
        : null,
  };
}

/** C105.7: the latest transaction each object was attached to; an object with none is absent. */
export async function latestTransactionsOfObjects(
  db: Db,
  environmentId: string,
  objectIds: readonly TransactionObjectId[],
): Promise<ReadonlyMap<string, string>> {
  if (objectIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([transactionObjects.objectId], {
      objectId: transactionObjects.objectId,
      transactionId: transactionObjects.transactionId,
    })
    .from(transactionObjects)
    .where(
      and(
        eq(transactionObjects.environmentId, environmentId),
        inArray(transactionObjects.objectId, [...objectIds]),
      ),
    )
    .orderBy(
      transactionObjects.objectId,
      desc(transactionObjects.createdAt),
      desc(transactionObjects.transactionId),
    );
  return new Map(rows.map((row) => [row.objectId, row.transactionId]));
}

export interface TransactionRelationInput {
  transactionId: string;
  relationSchemaKey: string;
  /** `acc_` or `txn_`. */
  targetId: string;
}

const targetColumns = (targetId: string) =>
  targetId.startsWith('acc_') ? { accountId: targetId } : { relatedTransactionId: targetId };

/** `false` when the relation was already there. */
export async function addTransactionRelation(
  tx: Db,
  environmentId: string,
  input: TransactionRelationInput,
): Promise<boolean> {
  const rows = await tx
    .insert(transactionRelations)
    .values({
      environmentId,
      transactionId: input.transactionId,
      relationSchemaKey: input.relationSchemaKey,
      ...targetColumns(input.targetId),
    })
    .onConflictDoNothing()
    .returning({ targetId: transactionRelations.targetId });
  return rows.length > 0;
}

/** `false` when there was no such relation. */
export async function removeTransactionRelation(
  tx: Db,
  environmentId: string,
  input: TransactionRelationInput,
): Promise<boolean> {
  const rows = await tx
    .delete(transactionRelations)
    .where(
      and(
        eq(transactionRelations.environmentId, environmentId),
        eq(transactionRelations.transactionId, input.transactionId),
        eq(transactionRelations.relationSchemaKey, input.relationSchemaKey),
        eq(transactionRelations.targetId, input.targetId),
      ),
    )
    .returning({ targetId: transactionRelations.targetId });
  return rows.length > 0;
}

/** The transaction's relations, oldest first. */
export async function listTransactionRelations(
  db: Db,
  environmentId: string,
  transactionId: string,
): Promise<TransactionRelationRow[]> {
  return db
    .select()
    .from(transactionRelations)
    .where(
      and(
        eq(transactionRelations.environmentId, environmentId),
        eq(transactionRelations.transactionId, transactionId),
      ),
    )
    .orderBy(
      asc(transactionRelations.createdAt),
      asc(transactionRelations.relationSchemaKey),
      asc(transactionRelations.targetId),
    );
}

/** C105.1: an attached object, with the subtype its resource identifier needs. */
export interface TransactionRelatedObject {
  id: string;
  kind: 'account' | 'inquiry' | 'report' | 'verification';
  /** `verifications.type` or `reports.report_type`; `null` for an account or an inquiry. */
  subtype: string | null;
}

/** C105.1: each transaction's objects with their subtypes, in the order they were attached. */
export async function listTransactionRelatedObjects(
  db: Db,
  environmentId: string,
  transactionIds: readonly string[],
): Promise<ReadonlyMap<string, TransactionRelatedObject[]>> {
  const grouped = new Map<string, TransactionRelatedObject[]>();
  if (transactionIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .select({
      transactionId: transactionObjects.transactionId,
      accountId: transactionObjects.accountId,
      inquiryId: transactionObjects.inquiryId,
      reportId: transactionObjects.reportId,
      verificationId: transactionObjects.verificationId,
      verificationType: verifications.type,
      reportType: reports.reportType,
    })
    .from(transactionObjects)
    .leftJoin(
      verifications,
      and(
        eq(verifications.environmentId, transactionObjects.environmentId),
        eq(verifications.id, transactionObjects.verificationId),
      ),
    )
    .leftJoin(
      reports,
      and(
        eq(reports.environmentId, transactionObjects.environmentId),
        eq(reports.id, transactionObjects.reportId),
      ),
    )
    .where(
      and(
        eq(transactionObjects.environmentId, environmentId),
        inArray(transactionObjects.transactionId, [...transactionIds]),
      ),
    )
    .orderBy(asc(transactionObjects.createdAt), asc(transactionObjects.objectId));
  for (const row of rows) {
    const object: TransactionRelatedObject | null =
      row.accountId !== null
        ? { id: row.accountId, kind: 'account', subtype: null }
        : row.inquiryId !== null
          ? { id: row.inquiryId, kind: 'inquiry', subtype: null }
          : row.reportId !== null
            ? { id: row.reportId, kind: 'report', subtype: row.reportType }
            : row.verificationId === null
              ? null
              : { id: row.verificationId, kind: 'verification', subtype: row.verificationType };
    if (object !== null) {
      const list = grouped.get(row.transactionId) ?? [];
      list.push(object);
      grouped.set(row.transactionId, list);
    }
  }
  return grouped;
}

/** C107.4: the attached inquiries' templates and the related accounts' types of each transaction. */
export interface TransactionFilterLinks {
  inquiryTemplateIds: string[];
  accountTypeIds: string[];
}

export async function listTransactionFilterLinks(
  db: Db,
  environmentId: string,
  transactionIds: readonly string[],
): Promise<ReadonlyMap<string, TransactionFilterLinks>> {
  const links = new Map<string, { templates: Set<string>; types: Set<string> }>(
    transactionIds.map((id) => [id, { templates: new Set(), types: new Set() }]),
  );
  if (transactionIds.length > 0) {
    const ids = [...transactionIds];
    const templates = await db
      .select({
        transactionId: transactionObjects.transactionId,
        id: inquiries.inquiryTemplateId,
      })
      .from(transactionObjects)
      .innerJoin(
        inquiries,
        and(
          eq(inquiries.environmentId, transactionObjects.environmentId),
          eq(inquiries.id, transactionObjects.inquiryId),
        ),
      )
      .where(
        and(
          eq(transactionObjects.environmentId, environmentId),
          inArray(transactionObjects.transactionId, ids),
        ),
      );
    const attached = db
      .select({
        transactionId: transactionObjects.transactionId,
        accountId: sql<string>`${transactionObjects.accountId}`.as('account_id'),
      })
      .from(transactionObjects)
      .where(
        and(
          eq(transactionObjects.environmentId, environmentId),
          inArray(transactionObjects.transactionId, ids),
          isNotNull(transactionObjects.accountId),
        ),
      );
    const related = db
      .select({
        transactionId: transactionRelations.transactionId,
        accountId: sql<string>`${transactionRelations.accountId}`.as('account_id'),
      })
      .from(transactionRelations)
      .where(
        and(
          eq(transactionRelations.environmentId, environmentId),
          inArray(transactionRelations.transactionId, ids),
          isNotNull(transactionRelations.accountId),
        ),
      );
    const linked = attached.union(related).as('linked');
    const types = await db
      .select({ transactionId: linked.transactionId, id: accounts.accountTypeId })
      .from(linked)
      .innerJoin(
        accounts,
        and(eq(accounts.environmentId, environmentId), eq(accounts.id, linked.accountId)),
      );
    for (const row of templates) {
      links.get(row.transactionId)?.templates.add(row.id);
    }
    for (const row of types) {
      links.get(row.transactionId)?.types.add(row.id);
    }
  }
  return new Map(
    [...links].map(([id, { templates, types }]) => [
      id,
      { inquiryTemplateIds: [...templates].sort(), accountTypeIds: [...types].sort() },
    ]),
  );
}

/**
 * C107.6: the transactions related to an account (attached, or under a relation schema), newest
 * first, at most `limit`.
 */
export async function listAccountTransactions(
  db: Db,
  environmentId: string,
  accountId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.environmentId, environmentId),
        sql`(exists (select 1 from ${transactionObjects}
              where ${transactionObjects.environmentId} = ${transactions.environmentId}
                and ${transactionObjects.transactionId} = ${transactions.id}
                and ${transactionObjects.accountId} = ${accountId})
          or exists (select 1 from ${transactionRelations}
              where ${transactionRelations.environmentId} = ${transactions.environmentId}
                and ${transactionRelations.transactionId} = ${transactions.id}
                and ${transactionRelations.accountId} = ${accountId}))`,
      ),
    )
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .limit(limit);
  return rows.map((row) => row.id);
}
