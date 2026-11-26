/**
 * C100 (Workflow 7B): the importer rows, staged rows and errors. Owner: `api-importers`.
 *
 * An importer lives through one run at a time: {@link beginImportAttempt} counts it in its own
 * statement, so a rollback keeps the count, and the run stages, applies and ends the import in one
 * transaction under {@link lockPendingImporter}. A crash therefore leaves no staged row, and a
 * second run of one job finds the row held, or ended, and leaves it without waiting.
 */
import { IMPORT_LIMITS } from '@openverify/core';
import type {
  ImportErrorCode,
  ImporterMode,
  ImporterStatus,
  ListKind,
  ListStatus,
} from '@openverify/core';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  importers,
  importRowKey,
  listImportErrors,
  listImportRows,
  lists,
  type ImporterRow,
} from '../schema.js';
import { openJson, sealJson } from '../sealed.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import type { DeleteOptions } from './retention.js';
import { allFilters, equalsAny, firstOrNull, inserted } from './rows.js';

export interface NewImporter {
  id: string;
  listId: string;
  mode: ImporterMode;
  encoding: string;
  fileSha256: string;
  fileBytes: number;
  storageKey: string;
  wrappedDek: string;
  /** Defaults to the database's clock. */
  createdAt?: Date | undefined;
}

/** An importer with its list's kind, which its resource type names. */
export type StoredImporter = ImporterRow & { kind: ListKind };

/** What the route and the job read of the list an import fills. */
export interface ImportList {
  id: string;
  kind: ListKind;
  status: ListStatus;
  fieldKey: string | null;
  caseSensitive: boolean;
  defaultRegion: string | null;
}

export interface ImporterFilters {
  listIds?: readonly string[] | undefined;
  statuses?: readonly ImporterStatus[] | undefined;
}

/** One staged row: sealed for `importRowKey(importer id, row)`. */
export interface StagedImportRow {
  row: number;
  value: Readonly<Record<string, unknown>>;
  matchKey: string | null;
}

/** One stored error: a code and a line, never a value. `row` is `null` for the whole file. */
export interface StoredImportError {
  row: number | null;
  column: string | null;
  code: ImportErrorCode;
}

/** How the job ends an import, with the staged rows deleted in the same transaction. */
export interface ImporterOutcome {
  status: Exclude<ImporterStatus, 'pending'>;
  rowCount: number;
  successfulCount: number;
  duplicateCount: number;
  alreadyPresentCount: number;
  errorCount: number;
  at: Date;
  /** Why it ended without a verdict on the file: a snake-case name, never a value. */
  lastErrorCode?: string | undefined;
}

const importerCursor = environmentCursor(importers);

const ownImporter = (environmentId: string, id: string): SQL | undefined =>
  and(eq(importers.environmentId, environmentId), eq(importers.id, id));

const STORED_IMPORTER = { ...getTableColumns(importers), kind: lists.type };

const joinList = and(
  eq(lists.environmentId, importers.environmentId),
  eq(lists.id, importers.listId),
);

export async function createImporter(
  tx: Db,
  environmentId: string,
  input: NewImporter,
): Promise<ImporterRow> {
  const rows = await tx
    .insert(importers)
    .values({ ...input, environmentId })
    .returning();
  return inserted(rows, 'importer');
}

/** The list an import fills, in this environment. */
export async function getImportList(
  db: Db,
  environmentId: string,
  listId: string,
): Promise<ImportList | null> {
  const rows = await db
    .select({
      id: lists.id,
      kind: lists.type,
      status: lists.status,
      fieldKey: lists.fieldKey,
      caseSensitive: lists.caseSensitive,
      defaultRegion: lists.defaultRegion,
    })
    .from(lists)
    .where(and(eq(lists.environmentId, environmentId), eq(lists.id, listId)));
  return firstOrNull(rows);
}

/** C100.5: serialises two uploads of one file, so the second reads the first's row. */
export async function lockImportFile(
  tx: Db,
  environmentId: string,
  input: { listId: string; mode: ImporterMode; encoding: string; fileSha256: string },
): Promise<void> {
  const key = [environmentId, input.listId, input.mode, input.encoding, input.fileSha256].join('/');
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`openverify/importer-file/${key}`}, 0))`,
  );
}

export async function getImporter(
  db: Db,
  environmentId: string,
  id: string,
): Promise<StoredImporter | null> {
  const rows = await db
    .select(STORED_IMPORTER)
    .from(importers)
    .innerJoin(lists, joinList)
    .where(ownImporter(environmentId, id));
  return firstOrNull(rows);
}

/** `GET /importers`: `created_at DESC, id DESC`. */
export async function listImporters(
  db: Db,
  environmentId: string,
  filters: ImporterFilters,
  page: PageRequest,
): Promise<Page<StoredImporter>> {
  const conditions = allFilters([
    eq(importers.environmentId, environmentId),
    equalsAny(importers.listId, filters.listIds),
    equalsAny(importers.status, filters.statuses),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, importerCursor, environmentId, page, (after, limit) =>
    db
      .select(STORED_IMPORTER)
      .from(importers)
      .innerJoin(lists, joinList)
      .where(and(...conditions, after))
      .orderBy(...newestFirst(importerCursor))
      .limit(limit),
  );
}

/**
 * C100.5: the same list, mode, encoding and SHA-256 since `since`, newest first. An import that
 * ended `errored` with no error row said nothing about the file (its object was lost, or its
 * attempts ran out), so it does not answer for the file: a retry runs.
 */
export async function findRecentImporter(
  db: Db,
  environmentId: string,
  input: {
    listId: string;
    mode: ImporterMode;
    encoding: string;
    fileSha256: string;
    since: Date;
  },
): Promise<ImporterRow | null> {
  const rows = await db
    .select()
    .from(importers)
    .where(
      and(
        eq(importers.environmentId, environmentId),
        eq(importers.listId, input.listId),
        eq(importers.mode, input.mode),
        eq(importers.fileSha256, input.fileSha256),
        eq(importers.encoding, input.encoding),
        sql`${importers.createdAt} >= ${input.since.toISOString()}::timestamptz`,
        sql`not (${importers.status} = 'errored' and ${importers.errorCount} = 0)`,
      ),
    )
    .orderBy(desc(importers.createdAt), desc(importers.id))
    .limit(1);
  return firstOrNull(rows);
}

/** The sweep: pending imports not enqueued since `olderThan`, oldest first. */
export async function listPendingImporters(
  db: Db,
  input: { olderThan: Date; limit: number },
): Promise<ImporterRow[]> {
  return db
    .select()
    .from(importers)
    .where(
      and(
        eq(importers.status, 'pending'),
        or(isNull(importers.enqueuedAt), lt(importers.enqueuedAt, input.olderThan)),
      ),
    )
    .orderBy(asc(importers.createdAt), asc(importers.id))
    .limit(input.limit);
}

/**
 * Records when the rows' jobs were added; `null` clears it for an enqueue that was lost. A producer
 * records it before it adds the job: the job takes its row with `SKIP LOCKED`, so a write after it
 * could make the job skip its own import.
 */
export async function markImportersEnqueued(
  db: Db,
  rows: readonly { environmentId: string; id: string }[],
  at: Date | null,
): Promise<void> {
  for (const { environmentId, id } of rows) {
    await db
      .update(importers)
      .set({ enqueuedAt: at })
      .where(and(ownImporter(environmentId, id), eq(importers.status, 'pending')));
  }
}

/**
 * Counts one run of the job, in its own statement so a rollback keeps it. `null` once the import
 * ended, and while another run holds the row: that run owns it, and a worker slot does not wait.
 */
export async function beginImportAttempt(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ImporterRow | null> {
  const free = db
    .select({ id: importers.id })
    .from(importers)
    .where(and(ownImporter(environmentId, id), eq(importers.status, 'pending')))
    .for('update', { skipLocked: true });
  const rows = await db
    .update(importers)
    .set({ attempts: sql`${importers.attempts} + 1` })
    .where(and(eq(importers.environmentId, environmentId), inArray(importers.id, free)))
    .returning();
  return firstOrNull(rows);
}

/** The row a run works under, or `null` when it ended or another run holds it. */
export async function lockPendingImporter(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<ImporterRow | null> {
  const rows = await tx
    .select()
    .from(importers)
    .where(and(ownImporter(environmentId, id), eq(importers.status, 'pending')))
    .for('update', { skipLocked: true });
  return firstOrNull(rows);
}

/** Records why a run failed: a snake-case name, never a value. */
export async function recordImportFailure(
  db: Db,
  environmentId: string,
  id: string,
  code: string,
): Promise<void> {
  await db
    .update(importers)
    .set({ lastErrorCode: code })
    .where(and(ownImporter(environmentId, id), eq(importers.status, 'pending')));
}

export async function stageImportRows(
  tx: Db,
  environmentId: string,
  importerId: string,
  rows: readonly StagedImportRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await tx.insert(listImportRows).values(
    rows.map(({ row, value, matchKey }) => ({
      environmentId,
      importerId,
      row,
      valueSealed: sealJson(SEALED.listImportRowValue, importRowKey(importerId, row), value),
      matchKey,
    })),
  );
}

/** The staged rows in file order, opened, a batch after `afterRow`. */
export async function listStagedImportRows(
  db: Db,
  environmentId: string,
  importerId: string,
  input: { afterRow: number; limit: number },
): Promise<StagedImportRow[]> {
  const rows = await db
    .select({
      row: listImportRows.row,
      valueSealed: listImportRows.valueSealed,
      matchKey: listImportRows.matchKey,
    })
    .from(listImportRows)
    .where(
      and(
        eq(listImportRows.environmentId, environmentId),
        eq(listImportRows.importerId, importerId),
        gt(listImportRows.row, input.afterRow),
      ),
    )
    .orderBy(asc(listImportRows.row))
    .limit(input.limit);
  return rows.map(({ row, valueSealed, matchKey }) => ({
    row,
    value: openJson(
      SEALED.listImportRowValue,
      importRowKey(importerId, row),
      valueSealed,
    ) as StagedImportRow['value'],
    matchKey,
  }));
}

/** C100.1 (F12): at most 1,000 per import; a code and a line, never a value. */
export async function recordImportErrors(
  tx: Db,
  environmentId: string,
  importerId: string,
  errors: readonly StoredImportError[],
): Promise<void> {
  if (errors.length === 0) {
    return;
  }
  const held = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(listImportErrors)
    .where(
      and(
        eq(listImportErrors.environmentId, environmentId),
        eq(listImportErrors.importerId, importerId),
      ),
    );
  const room = IMPORT_LIMITS.errorsPerImport - (held[0]?.count ?? 0);
  const kept = errors.slice(0, Math.max(0, room));
  if (kept.length === 0) {
    return;
  }
  await tx
    .insert(listImportErrors)
    .values(kept.map((error) => ({ ...error, environmentId, importerId })));
}

/**
 * `GET /importers/:id/errors`: in row order; `afterRow` is `page[after]`. The first page (`afterRow`
 * 0) leads with every error of the whole file, which has no row to page by and is never more than a
 * few; `limit` counts the numbered rows after them.
 */
export async function listImporterErrors(
  db: Db,
  environmentId: string,
  importerId: string,
  input: { afterRow: number; limit: number },
): Promise<StoredImportError[]> {
  const own = and(
    eq(listImportErrors.environmentId, environmentId),
    eq(listImportErrors.importerId, importerId),
  );
  const columns = {
    row: listImportErrors.row,
    column: listImportErrors.column,
    code: listImportErrors.code,
  };
  const whole =
    input.afterRow > 0
      ? []
      : await db
          .select(columns)
          .from(listImportErrors)
          .where(and(own, isNull(listImportErrors.row)))
          .orderBy(asc(listImportErrors.id));
  const numbered = await db
    .select(columns)
    .from(listImportErrors)
    .where(and(own, gt(listImportErrors.row, input.afterRow)))
    .orderBy(asc(listImportErrors.row), asc(listImportErrors.id))
    .limit(input.limit);
  return [...whole, ...numbered];
}

/** C100.2: ends the import in `tx` and deletes its staged rows, whatever the outcome. */
export async function completeImporter(
  tx: Db,
  environmentId: string,
  id: string,
  outcome: ImporterOutcome,
): Promise<ImporterRow | null> {
  await tx
    .delete(listImportRows)
    .where(and(eq(listImportRows.environmentId, environmentId), eq(listImportRows.importerId, id)));
  const rows = await tx
    .update(importers)
    .set({
      status: outcome.status,
      rowCount: outcome.rowCount,
      successfulCount: outcome.successfulCount,
      duplicateCount: outcome.duplicateCount,
      alreadyPresentCount: outcome.alreadyPresentCount,
      errorCount: outcome.errorCount,
      completedAt: outcome.at,
      lastErrorCode: outcome.lastErrorCode ?? null,
    })
    .where(and(ownImporter(environmentId, id), eq(importers.status, 'pending')))
    .returning();
  return firstOrNull(rows);
}

/**
 * C100.2 (C16 pass): the importers whose object is due for deletion, oldest first: 7 days after the
 * import ended, or sooner when the list keeps its items for less, because the file holds the same
 * values. The caller deletes the object and then {@link markImportObjectDeleted}.
 */
export async function listImportObjectsDue(
  db: Db,
  options: DeleteOptions = {},
): Promise<{ id: string; environmentId: string; storageKey: string }[]> {
  const now = (options.now ?? new Date()).toISOString();
  const days = sql`least(coalesce(${lists.itemRetentionDays}, ${IMPORT_LIMITS.objectRetentionDays}), ${IMPORT_LIMITS.objectRetentionDays})`;
  const rows = await db
    .select({
      id: importers.id,
      environmentId: importers.environmentId,
      storageKey: importers.storageKey,
    })
    .from(importers)
    .innerJoin(lists, joinList)
    .where(
      and(
        sql`${importers.storageKey} is not null`,
        sql`${importers.status} <> 'pending'`,
        sql`${importers.completedAt} + make_interval(days => ${days}::int) <= ${now}::timestamptz`,
      ),
    )
    .orderBy(asc(importers.completedAt), asc(importers.id))
    .limit(options.limit ?? 500);
  return rows.flatMap(({ storageKey, ...row }) =>
    storageKey === null ? [] : [{ ...row, storageKey }],
  );
}

export async function markImportObjectDeleted(
  db: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<void> {
  await db
    .update(importers)
    .set({ storageKey: null, wrappedDek: null, objectDeletedAt: at })
    .where(ownImporter(environmentId, id));
}
