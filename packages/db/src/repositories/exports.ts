/**
 * C166.1-C166.4, C166.6 (Workflow 9B): `exports`. Owner: `api-exports`: the create, the job's claim
 * and finish, the creator's list and read, the expiry that `export-sweep` and the C16 pass run, and
 * the unfinished exports the sweep enqueues again, as Phase 8's `case-exports.ts` does for case
 * exports; and the verification rows an export of verifications reads (no list route reads them).
 *
 * The request (the filter with its values, personal data in a list's filter) is sealed for its row
 * and kept exactly while the export is `pending` or `running` (review P19; the table's CHECK); only
 * its keys stay (`filter_keys`). The file is kept 24 hours, then the sweep deletes the object and the
 * row reads `expired` with its count and times.
 */
import type { ExportObjectType, ExportStatus, VerificationType } from '@openverify/core';
import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptionalJson, sealJson } from '../sealed.js';
import type { ExportCreatorType, ExportRow } from '../schema.js';
import { dataExports } from '../tables/exports.js';
import { inquiries } from '../tables/inquiries.js';
import { verificationChecks, verifications } from '../tables/verifications.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { firstOrNull, inserted } from './rows.js';

/** An export with its request opened: `null` once it finished (P19). */
export interface ExportRecord extends Omit<ExportRow, 'requestSealed'> {
  request: Readonly<Record<string, unknown>> | null;
}

/** The principal an export belongs to (C166.1: only it lists, reads and downloads it). */
export interface ExportCreator {
  type: ExportCreatorType;
  id: string;
}

/** What `POST /exports` writes; the request is sealed for the row (`SEALED.exportRequest`). */
export interface NewExport {
  id: string;
  creator: ExportCreator;
  objectType: ExportObjectType;
  format: 'csv';
  includePersonalData: boolean;
  request: Readonly<Record<string, unknown>>;
  /** The filter's keys, never a value (C166.6). */
  filterKeys: readonly string[];
  savedViewId: string | null;
  at: Date;
}

/** What a cut export keeps: its file while it is kept, 24 hours. */
export interface CompletedExport {
  rowCount: number;
  byteSize: number;
  storageKey: string;
  wrappedDek: string;
  cutAt: Date;
  completedAt: Date;
  expiresAt: Date;
}

/** An expired export's file, which the sweep deletes. */
export interface ExportObject {
  id: string;
  environmentId: string;
  storageKey: string;
}

function toExport(row: ExportRow): ExportRecord {
  const { requestSealed, ...rest } = row;
  return {
    ...rest,
    request: openOptionalJson(SEALED.exportRequest, row.id, requestSealed) as Readonly<
      Record<string, unknown>
    > | null,
  };
}

const exportIn = (environmentId: string, id: string) =>
  and(eq(dataExports.environmentId, environmentId), eq(dataExports.id, id));

const cursor = environmentCursor(dataExports);

/** C166.1: writes a pending export. */
export async function createExportRow(
  tx: Db,
  environmentId: string,
  input: NewExport,
): Promise<ExportRecord> {
  return toExport(
    inserted(
      await tx
        .insert(dataExports)
        .values({
          id: input.id,
          environmentId,
          creatorType: input.creator.type,
          creatorId: input.creator.id,
          objectType: input.objectType,
          format: input.format,
          includePersonalData: input.includePersonalData,
          requestSealed: sealJson(SEALED.exportRequest, input.id, input.request),
          filterKeys: [...input.filterKeys],
          savedViewId: input.savedViewId,
          createdAt: input.at,
          updatedAt: input.at,
        })
        .returning(),
      'createExportRow',
    ),
  );
}

/** One export of the environment, or `null`; the service answers 404 to anyone but its creator. */
export async function getExportRow(
  db: Db,
  environmentId: string,
  exportId: string,
): Promise<ExportRecord | null> {
  const row = firstOrNull(
    await db.select().from(dataExports).where(exportIn(environmentId, exportId)),
  );
  return row === null ? null : toExport(row);
}

/** C166.4: the creator's exports, newest first (`exports_creator_created_at_idx`). */
export async function listExportRows(
  db: Db,
  environmentId: string,
  options: {
    creator: ExportCreator;
    statuses?: readonly ExportStatus[] | undefined;
    objectTypes?: readonly ExportObjectType[] | undefined;
    page: PageRequest;
  },
): Promise<Page<ExportRecord>> {
  const { creator, statuses, objectTypes } = options;
  const page = await paginate(db, cursor, environmentId, options.page, (after, limit) =>
    db
      .select()
      .from(dataExports)
      .where(
        and(
          eq(dataExports.environmentId, environmentId),
          eq(dataExports.creatorType, creator.type),
          eq(dataExports.creatorId, creator.id),
          statuses === undefined ? undefined : inArray(dataExports.status, [...statuses]),
          objectTypes === undefined ? undefined : inArray(dataExports.objectType, [...objectTypes]),
          after,
        ),
      )
      .orderBy(...newestFirst(cursor))
      .limit(limit),
  );
  return { items: page.items.map(toExport), next: page.next };
}

/**
 * How long a running export is held by the job that claimed it. Past it the export is taken as left
 * by a stopped worker, and the job the sweep enqueued again may claim it. Provisional, as Phase 8's
 * case exports (K8-28): 50,000 rows are cut well within it.
 */
export const EXPORT_CLAIM_LEASE_MS = 15 * 60_000;

/**
 * The job's claim, `FOR UPDATE SKIP LOCKED`, marked running: a pending export, or a running one whose
 * claim is older than the lease; `null` otherwise, so one job holds an export at a time.
 */
export async function claimExportRow(
  tx: Db,
  environmentId: string,
  exportId: string,
  options: { now: Date; leaseMs?: number },
): Promise<ExportRecord | null> {
  const lapsed = new Date(options.now.getTime() - (options.leaseMs ?? EXPORT_CLAIM_LEASE_MS));
  const row = firstOrNull(
    await tx
      .select({ id: dataExports.id })
      .from(dataExports)
      .where(
        and(
          exportIn(environmentId, exportId),
          or(
            eq(dataExports.status, 'pending'),
            and(eq(dataExports.status, 'running'), lt(dataExports.updatedAt, lapsed)),
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
      .update(dataExports)
      .set({ status: 'running', updatedAt: options.now })
      .where(exportIn(environmentId, exportId))
      .returning(),
  );
  return running === null ? null : toExport(running);
}

/** Cut: the file kept, the request dropped (P19); `null` when no running export was there. */
export async function completeExportRow(
  tx: Db,
  environmentId: string,
  exportId: string,
  done: CompletedExport,
): Promise<ExportRecord | null> {
  const row = firstOrNull(
    await tx
      .update(dataExports)
      .set({
        status: 'completed',
        requestSealed: null,
        rowCount: done.rowCount,
        byteSize: done.byteSize,
        storageKey: done.storageKey,
        wrappedDek: done.wrappedDek,
        cutAt: done.cutAt,
        completedAt: done.completedAt,
        expiresAt: done.expiresAt,
        updatedAt: done.completedAt,
      })
      .where(and(exportIn(environmentId, exportId), eq(dataExports.status, 'running')))
      .returning(),
  );
  return row === null ? null : toExport(row);
}

/** Failed with its problem code (`export_too_large`), the request dropped. */
export async function failExportRow(
  tx: Db,
  environmentId: string,
  exportId: string,
  errorCode: string,
  at: Date,
): Promise<ExportRecord | null> {
  const row = firstOrNull(
    await tx
      .update(dataExports)
      .set({ status: 'failed', requestSealed: null, errorCode, updatedAt: at })
      .where(
        and(exportIn(environmentId, exportId), inArray(dataExports.status, ['pending', 'running'])),
      )
      .returning(),
  );
  return row === null ? null : toExport(row);
}

/** C174.3: completed exports whose 24 hours ran out by `now`, oldest first, across environments. */
export async function listExpiredExports(
  db: Db,
  now: Date,
  limit: number,
): Promise<ExportObject[]> {
  const rows = await db
    .select({
      id: dataExports.id,
      environmentId: dataExports.environmentId,
      storageKey: dataExports.storageKey,
    })
    .from(dataExports)
    .where(and(eq(dataExports.status, 'completed'), lte(dataExports.expiresAt, now)))
    .orderBy(asc(dataExports.expiresAt), asc(dataExports.id))
    .limit(limit);
  return rows.filter((row): row is ExportObject => row.storageKey !== null);
}

/** The file of an expired export was deleted: it reads `expired`, keeping its count and times. */
export async function expireExportRow(
  db: Db,
  environmentId: string,
  exportId: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(dataExports)
    .set({ status: 'expired', storageKey: null, wrappedDek: null, byteSize: null, updatedAt: at })
    .where(and(exportIn(environmentId, exportId), eq(dataExports.status, 'completed')))
    .returning({ id: dataExports.id });
  return rows.length > 0;
}

/**
 * The exports made before `before` that are still `pending` or `running` (a lost enqueue, a stopped
 * worker), oldest first, across environments, for the sweep to enqueue again.
 */
export async function listUnfinishedExports(
  db: Db,
  before: Date,
  limit: number,
): Promise<{ id: string; environmentId: string }[]> {
  return db
    .select({ id: dataExports.id, environmentId: dataExports.environmentId })
    .from(dataExports)
    .where(
      and(inArray(dataExports.status, ['pending', 'running']), lt(dataExports.createdAt, before)),
    )
    .orderBy(asc(dataExports.createdAt), asc(dataExports.id))
    .limit(limit);
}

/** The filters an export of verifications takes (C166.1: `filter[type]` is required). */
export interface ExportVerificationFilters {
  types: readonly VerificationType[];
  statuses?: readonly string[] | undefined;
  inquiryIds?: readonly string[] | undefined;
  createdAtStart?: Date | undefined;
  createdAtEnd?: Date | undefined;
}

/** One verification as an export reads it: its row, its inquiry's redaction and its checks. */
export interface ExportVerification {
  id: string;
  type: VerificationType;
  status: string;
  inquiryId: string;
  country: string | null;
  idClass: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
  /** The inquiry's redaction, which is the verification's (C16). */
  redactedAt: Date | null;
  /** `name:status`, by name. */
  checks: string[];
}

const verificationCursor = environmentCursor(verifications);

/** C166.1: one page of the environment's verifications of the filter, newest first. */
export async function listExportVerifications(
  db: Db,
  environmentId: string,
  filters: ExportVerificationFilters,
  page: PageRequest,
): Promise<Page<ExportVerification>> {
  const conditions: (SQL | undefined)[] = [
    eq(verifications.environmentId, environmentId),
    inArray(verifications.type, [...filters.types]),
    filters.statuses === undefined
      ? undefined
      : sql`${verifications.status}::text in (${sql.join(
          filters.statuses.map((status) => sql`${status}`),
          sql`, `,
        )})`,
    filters.inquiryIds === undefined
      ? undefined
      : inArray(verifications.inquiryId, [...filters.inquiryIds]),
    filters.createdAtStart === undefined
      ? undefined
      : gte(verifications.createdAt, filters.createdAtStart),
    filters.createdAtEnd === undefined
      ? undefined
      : lt(verifications.createdAt, filters.createdAtEnd),
  ];
  const found = await paginate(db, verificationCursor, environmentId, page, (after, limit) =>
    db
      .select({
        id: verifications.id,
        type: verifications.type,
        status: verifications.status,
        inquiryId: verifications.inquiryId,
        country: verifications.country,
        idClass: verifications.idClass,
        createdAt: verifications.createdAt,
        submittedAt: verifications.submittedAt,
        completedAt: verifications.completedAt,
        redactedAt: inquiries.redactedAt,
      })
      .from(verifications)
      .innerJoin(
        inquiries,
        and(
          eq(inquiries.environmentId, verifications.environmentId),
          eq(inquiries.id, verifications.inquiryId),
        ),
      )
      .where(and(...conditions, after))
      .orderBy(desc(verifications.createdAt), desc(verifications.id))
      .limit(limit),
  );
  const ids = found.items.map(({ id }) => id);
  const checks =
    ids.length === 0
      ? []
      : await db
          .select({
            verificationId: verificationChecks.verificationId,
            name: verificationChecks.name,
            status: verificationChecks.status,
          })
          .from(verificationChecks)
          .where(
            and(
              eq(verificationChecks.environmentId, environmentId),
              inArray(verificationChecks.verificationId, ids),
            ),
          )
          .orderBy(asc(verificationChecks.verificationId), asc(verificationChecks.name));
  const byVerification = new Map<string, string[]>();
  for (const check of checks) {
    byVerification.set(check.verificationId, [
      ...(byVerification.get(check.verificationId) ?? []),
      `${check.name}:${check.status}`,
    ]);
  }
  return {
    items: found.items.map((row) => ({
      ...row,
      idClass: row.idClass ?? null,
      checks: byVerification.get(row.id) ?? [],
    })),
    next: found.next,
  };
}
