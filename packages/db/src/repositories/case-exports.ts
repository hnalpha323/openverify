/**
 * C138.1 (Workflow 8B, checkpoint (F)): case exports, read by their creating principal alone (P26).
 * Owner `api-case-files`; `foundation-8b` froze the names, and the owner adds what else it needs here
 * (the job's claim, the sweep's batch of expired files).
 *
 * The request (a filter or a search, which can name a field's value) is sealed for its row and kept
 * only while the export is pending or running (P19); a finished export names no filter. Its file is
 * kept 24 hours: the sweep deletes the object, and the row reads `expired` with its count and times.
 */
import type { CaseExportStatus } from '@openverify/core';
import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptionalJson, sealJson } from '../sealed.js';
import { caseExports, type CaseExportRow } from '../tables/case-files.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { firstOrNull, inserted } from './rows.js';

/** An export with its request opened: `null` once it finished (P19). */
export interface CaseExport extends Omit<CaseExportRow, 'requestSealed'> {
  request: Readonly<Record<string, unknown>> | null;
}

/** The principal that created an export: only it lists, reads and downloads it (P26). */
export interface CaseExportCreator {
  type: 'user' | 'api-key';
  id: string;
}

/** What `POST /case-exports` writes; the request is sealed for the row (`SEALED.caseExportRequest`). */
export interface NewCaseExport {
  id: string;
  creator: CaseExportCreator;
  format: 'csv' | 'json';
  includePersonalData: boolean;
  request: Readonly<Record<string, unknown>>;
}

/** What a finished export keeps: its file while it is kept, 24 hours (decision 69). */
export interface CompletedCaseExport {
  caseCount: number;
  byteSize: number;
  storageKey: string;
  wrappedDek: string;
  completedAt: Date;
  expiresAt: Date;
}

/** An expired export's file, which the sweep deletes. */
export interface CaseExportObject {
  id: string;
  environmentId: string;
  storageKey: string;
}

function toExport(row: CaseExportRow): CaseExport {
  const { requestSealed, ...rest } = row;
  return {
    ...rest,
    request: openOptionalJson(SEALED.caseExportRequest, row.id, requestSealed) as Readonly<
      Record<string, unknown>
    > | null,
  };
}

const exportIn = (environmentId: string, id: string) =>
  and(eq(caseExports.environmentId, environmentId), eq(caseExports.id, id));

const cursor = environmentCursor(caseExports);

/** C138.1: writes a pending export. */
export async function createCaseExportRow(
  tx: Db,
  environmentId: string,
  input: NewCaseExport,
): Promise<CaseExport> {
  return toExport(
    inserted(
      await tx
        .insert(caseExports)
        .values({
          id: input.id,
          environmentId,
          creatorType: input.creator.type,
          creatorId: input.creator.id,
          format: input.format,
          includePersonalData: input.includePersonalData,
          requestSealed: sealJson(SEALED.caseExportRequest, input.id, input.request),
        })
        .returning(),
      'createCaseExportRow',
    ),
  );
}

/** One export of the environment, or `null`; the service answers 404 to anyone but its creator. */
export async function getCaseExportRow(
  db: Db,
  environmentId: string,
  exportId: string,
): Promise<CaseExport | null> {
  const row = firstOrNull(
    await db.select().from(caseExports).where(exportIn(environmentId, exportId)),
  );
  return row === null ? null : toExport(row);
}

/** P26: the creator's exports, newest first (`case_exports_creator_created_at_idx`). */
export async function listCaseExports(
  db: Db,
  environmentId: string,
  options: {
    creator: CaseExportCreator;
    statuses?: readonly CaseExportStatus[] | undefined;
    page: PageRequest;
  },
): Promise<Page<CaseExport>> {
  const { creator, statuses } = options;
  const page = await paginate(db, cursor, environmentId, options.page, (after, limit) =>
    db
      .select()
      .from(caseExports)
      .where(
        and(
          eq(caseExports.environmentId, environmentId),
          eq(caseExports.creatorType, creator.type),
          eq(caseExports.creatorId, creator.id),
          statuses === undefined ? undefined : inArray(caseExports.status, [...statuses]),
          after,
        ),
      )
      .orderBy(...newestFirst(cursor))
      .limit(limit),
  );
  return { items: page.items.map(toExport), next: page.next };
}

/**
 * K8-28 (Workflow 8D): how long a running export is held by the job that claimed it. Past it the
 * export is taken as left by a stopped worker, and the job the sweep enqueued again may claim it.
 * Provisional: an export of 10,000 cases is written well within it.
 */
export const CASE_EXPORT_CLAIM_LEASE_MS = 15 * 60_000;

/**
 * The job's claim, `FOR UPDATE SKIP LOCKED`, marked running: a pending export, or (K8-28) a running
 * one whose claim is older than the lease, which a stopped worker left; `null` otherwise, so one job
 * holds an export at a time.
 */
export async function claimCaseExportRow(
  tx: Db,
  environmentId: string,
  exportId: string,
  options: { now?: Date; leaseMs?: number } = {},
): Promise<CaseExport | null> {
  const now = options.now ?? new Date();
  const lapsed = new Date(now.getTime() - (options.leaseMs ?? CASE_EXPORT_CLAIM_LEASE_MS));
  const row = firstOrNull(
    await tx
      .select({ id: caseExports.id })
      .from(caseExports)
      .where(
        and(
          exportIn(environmentId, exportId),
          or(
            eq(caseExports.status, 'pending'),
            and(eq(caseExports.status, 'running'), lt(caseExports.updatedAt, lapsed)),
          ),
        ),
      )
      .for('update', { skipLocked: true }),
  );
  if (row === null) {
    return null;
  }
  const running = firstOrNull(
    await tx
      .update(caseExports)
      .set({ status: 'running', updatedAt: now })
      .where(exportIn(environmentId, exportId))
      .returning(),
  );
  return running === null ? null : toExport(running);
}

/** Done: the file kept, its request dropped (P19). */
export async function completeCaseExportRow(
  tx: Db,
  environmentId: string,
  exportId: string,
  done: CompletedCaseExport,
): Promise<CaseExport | null> {
  const row = firstOrNull(
    await tx
      .update(caseExports)
      .set({
        status: 'completed',
        requestSealed: null,
        caseCount: done.caseCount,
        byteSize: done.byteSize,
        storageKey: done.storageKey,
        wrappedDek: done.wrappedDek,
        completedAt: done.completedAt,
        expiresAt: done.expiresAt,
      })
      .where(and(exportIn(environmentId, exportId), eq(caseExports.status, 'running')))
      .returning(),
  );
  return row === null ? null : toExport(row);
}

/** Failed with its problem code (`export_too_large`), its request dropped. */
export async function failCaseExportRow(
  tx: Db,
  environmentId: string,
  exportId: string,
  errorCode: string,
): Promise<CaseExport | null> {
  const row = firstOrNull(
    await tx
      .update(caseExports)
      .set({ status: 'failed', requestSealed: null, errorCode })
      .where(
        and(exportIn(environmentId, exportId), inArray(caseExports.status, ['pending', 'running'])),
      )
      .returning(),
  );
  return row === null ? null : toExport(row);
}

/** C143.1: completed exports whose 24 hours ran out by `now`, oldest first, across environments. */
export async function listExpiredCaseExports(
  db: Db,
  now: Date,
  limit: number,
): Promise<CaseExportObject[]> {
  const rows = await db
    .select({
      id: caseExports.id,
      environmentId: caseExports.environmentId,
      storageKey: caseExports.storageKey,
    })
    .from(caseExports)
    .where(and(eq(caseExports.status, 'completed'), lte(caseExports.expiresAt, now)))
    .orderBy(asc(caseExports.expiresAt), asc(caseExports.id))
    .limit(limit);
  return rows.filter((row): row is CaseExportObject => row.storageKey !== null);
}

/** The file of an expired export was deleted: it reads `expired`, keeping its count and times. */
export async function expireCaseExportRow(
  db: Db,
  environmentId: string,
  exportId: string,
): Promise<boolean> {
  const rows = await db
    .update(caseExports)
    .set({ status: 'expired', storageKey: null, wrappedDek: null, byteSize: null })
    .where(and(exportIn(environmentId, exportId), eq(caseExports.status, 'completed')))
    .returning({ id: caseExports.id });
  return rows.length > 0;
}

/** One object a case holds, by its kind: what an export's row and bundle name (C138.2). */
export interface CaseHeldObjectId {
  caseId: string;
  objectType:
    | 'account'
    | 'inquiry'
    | 'report'
    | 'report-run'
    | 'transaction'
    | 'verification'
    | 'document'
    | 'graph-query';
  objectId: string;
}

/**
 * C138.2: every object the given cases hold, by case, kind and id: ids and kinds alone, read from the
 * seven join tables (a document is a verification held as one).
 */
export async function listHeldObjectIdsOfCases(
  db: Db,
  environmentId: string,
  caseIds: readonly string[],
): Promise<CaseHeldObjectId[]> {
  if (caseIds.length === 0) {
    return [];
  }
  const ids = sql`(${sql.join(
    caseIds.map((id) => sql`${id}`),
    sql`, `,
  )})`;
  const of = (table: string, column: string, type: string) =>
    sql`select case_id, ${type}::text as object_type, ${sql.identifier(column)} as object_id,
          created_at
        from ${sql.identifier(table)}
        where environment_id = ${environmentId} and case_id in ${ids}`;
  const result = await db.execute<{
    case_id: string;
    object_type: CaseHeldObjectId['objectType'];
    object_id: string;
  }>(sql`
    select case_id, object_type, object_id from (
      ${of('case_accounts', 'account_id', 'account')}
      union all ${of('case_inquiries', 'inquiry_id', 'inquiry')}
      union all ${of('case_reports', 'report_id', 'report')}
      union all ${of('case_report_runs', 'report_run_id', 'report-run')}
      union all ${of('case_transactions', 'transaction_id', 'transaction')}
      union all select case_id, held_as::text as object_type, verification_id as object_id,
          created_at
        from case_verifications
        where environment_id = ${environmentId} and case_id in ${ids}
      union all ${of('case_graph_queries', 'graph_query_id', 'graph-query')}
    ) as held
    order by case_id, object_type, created_at, object_id`);
  const rows = (
    result as {
      rows: { case_id: string; object_type: CaseHeldObjectId['objectType']; object_id: string }[];
    }
  ).rows;
  return rows.map((row) => ({
    caseId: row.case_id,
    objectType: row.object_type,
    objectId: row.object_id,
  }));
}

/**
 * K8-28 (Workflow 8D): the exports made before `before` that are still `pending` or `running` (a lost
 * enqueue, a crashed worker), oldest first, across environments, for the sweep to enqueue again.
 */
export async function listUnfinishedCaseExports(
  db: Db,
  before: Date,
  limit: number,
): Promise<{ id: string; environmentId: string }[]> {
  return db
    .select({ id: caseExports.id, environmentId: caseExports.environmentId })
    .from(caseExports)
    .where(
      and(inArray(caseExports.status, ['pending', 'running']), lt(caseExports.createdAt, before)),
    )
    .orderBy(asc(caseExports.createdAt), asc(caseExports.id))
    .limit(limit);
}
