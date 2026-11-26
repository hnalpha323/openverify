/**
 * C166.5, C166.6 (Workflow 9B): `report_bulk_jobs` and `report_bulk_job_rows`. Owner: `api-exports`:
 * the create, the job's claim, one row's outcome (written in the transaction that creates the report,
 * so a retried job never creates a row's report twice), the read with its rows, the end, and the
 * CSV's deletion that the job and `export-sweep` run.
 */
import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { ExportCreatorType } from '../schema.js';
import {
  reportBulkJobRows,
  reportBulkJobs,
  type ReportBulkJobRow,
  type ReportBulkJobRowRow,
} from '../tables/exports.js';
import { firstOrNull, inserted } from './rows.js';

/** A `report_bulk_jobs` row; the CSV is an envelope object named by `storageKey`. */
export type ReportBulkJobRecord = ReportBulkJobRow;

/** One CSV row's outcome: created with its report, or failed with its code (C166.6). */
export type ReportBulkJobRowRecord = ReportBulkJobRowRow;

export interface NewReportBulkJob {
  id: string;
  creator: { type: ExportCreatorType; id: string };
  reportTemplateId: string;
  rowCount: number;
  storageKey: string;
  wrappedDek: string;
  at: Date;
}

/** One row's outcome as the job writes it. */
export type ReportBulkRowResult =
  | { rowNumber: number; outcome: 'created'; reportId: string }
  | { rowNumber: number; outcome: 'failed'; errorCode: string };

/** A CSV the sweep deletes: an ended job's, or a job's older than its day. */
export interface ReportBulkFile {
  id: string;
  environmentId: string;
  storageKey: string;
}

const jobIn = (environmentId: string, id: string) =>
  and(eq(reportBulkJobs.environmentId, environmentId), eq(reportBulkJobs.id, id));

export async function createReportBulkJobRow(
  tx: Db,
  environmentId: string,
  input: NewReportBulkJob,
): Promise<ReportBulkJobRecord> {
  return inserted(
    await tx
      .insert(reportBulkJobs)
      .values({
        id: input.id,
        environmentId,
        creatorType: input.creator.type,
        creatorId: input.creator.id,
        reportTemplateId: input.reportTemplateId,
        rowCount: input.rowCount,
        storageKey: input.storageKey,
        wrappedDek: input.wrappedDek,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning(),
    'createReportBulkJobRow',
  );
}

export async function getReportBulkJobRow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ReportBulkJobRecord | null> {
  return firstOrNull(await db.select().from(reportBulkJobs).where(jobIn(environmentId, id)));
}

/** The rows done so far, in row order. */
export async function listReportBulkJobRows(
  db: Db,
  environmentId: string,
  jobId: string,
): Promise<ReportBulkJobRowRecord[]> {
  return db
    .select()
    .from(reportBulkJobRows)
    .where(
      and(eq(reportBulkJobRows.environmentId, environmentId), eq(reportBulkJobRows.jobId, jobId)),
    )
    .orderBy(asc(reportBulkJobRows.rowNumber));
}

/** How long a running job is held by the job that claimed it (provisional, as exports). */
export const REPORT_BULK_CLAIM_LEASE_MS = 15 * 60_000;

/**
 * The job's claim, `FOR UPDATE SKIP LOCKED`, marked running: a pending job, or a running one whose
 * claim is older than the lease; `null` otherwise.
 */
export async function claimReportBulkJobRow(
  tx: Db,
  environmentId: string,
  id: string,
  options: { now: Date; leaseMs?: number },
): Promise<ReportBulkJobRecord | null> {
  const lapsed = new Date(options.now.getTime() - (options.leaseMs ?? REPORT_BULK_CLAIM_LEASE_MS));
  const row = firstOrNull(
    await tx
      .select({ id: reportBulkJobs.id })
      .from(reportBulkJobs)
      .where(
        and(
          jobIn(environmentId, id),
          or(
            eq(reportBulkJobs.status, 'pending'),
            and(eq(reportBulkJobs.status, 'running'), lt(reportBulkJobs.updatedAt, lapsed)),
          ),
        ),
      )
      .for('update', { skipLocked: true }),
  );
  if (row === null) {
    return null;
  }
  return firstOrNull(
    await tx
      .update(reportBulkJobs)
      .set({ status: 'running', updatedAt: options.now })
      .where(jobIn(environmentId, id))
      .returning(),
  );
}

/**
 * Writes one row's outcome once, in the caller's transaction; `false` when the row already has one
 * (a retried job), so the caller rolls back what it made for it.
 */
export async function recordReportBulkRow(
  tx: Db,
  environmentId: string,
  jobId: string,
  outcome: ReportBulkRowResult,
): Promise<boolean> {
  const written = await tx
    .insert(reportBulkJobRows)
    .values({
      environmentId,
      jobId,
      rowNumber: outcome.rowNumber,
      outcome: outcome.outcome,
      reportId: outcome.outcome === 'created' ? outcome.reportId : null,
      errorCode: outcome.outcome === 'failed' ? outcome.errorCode : null,
    })
    .onConflictDoNothing()
    .returning({ rowNumber: reportBulkJobRows.rowNumber });
  return written.length > 0;
}

/**
 * Ends a running job: `completed`, or `failed` with a whole-file code; the CSV's columns are cleared
 * when `fileDeleted` (the caller deleted the object), else kept for the sweep.
 */
export async function finishReportBulkJobRow(
  tx: Db,
  environmentId: string,
  id: string,
  end: { status: 'completed' | 'failed'; errorCode: string | null; at: Date; fileDeleted: boolean },
): Promise<ReportBulkJobRecord | null> {
  return firstOrNull(
    await tx
      .update(reportBulkJobs)
      .set({
        status: end.status,
        errorCode: end.errorCode,
        completedAt: end.at,
        updatedAt: end.at,
        ...(end.fileDeleted ? { storageKey: null, wrappedDek: null } : {}),
      })
      .where(and(jobIn(environmentId, id), inArray(reportBulkJobs.status, ['pending', 'running'])))
      .returning(),
  );
}

/**
 * C166.5: the CSVs to delete: an ended job's, or the CSV of a job created at or before `dayAgo` (a
 * failed, retried or killed job included), oldest first, across environments.
 */
export async function listReportBulkFilesDue(
  db: Db,
  dayAgo: Date,
  limit: number,
): Promise<ReportBulkFile[]> {
  const rows = await db
    .select({
      id: reportBulkJobs.id,
      environmentId: reportBulkJobs.environmentId,
      storageKey: reportBulkJobs.storageKey,
    })
    .from(reportBulkJobs)
    .where(
      and(
        sql`${reportBulkJobs.storageKey} is not null`,
        or(
          inArray(reportBulkJobs.status, ['completed', 'failed']),
          lte(reportBulkJobs.createdAt, dayAgo),
        ),
      ),
    )
    .orderBy(asc(reportBulkJobs.createdAt), asc(reportBulkJobs.id))
    .limit(limit);
  return rows.filter((row): row is ReportBulkFile => row.storageKey !== null);
}

/**
 * The job's CSV was deleted: its columns cleared, and a job that had not ended fails with
 * `report_bulk_expired` (its CSV is gone, so it can never run).
 */
export async function dropReportBulkFile(
  db: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<void> {
  await db
    .update(reportBulkJobs)
    .set({
      storageKey: null,
      wrappedDek: null,
      status: sql`case when ${reportBulkJobs.status} in ('pending', 'running') then 'failed'
        else ${reportBulkJobs.status} end`,
      errorCode: sql`case when ${reportBulkJobs.status} in ('pending', 'running')
        then 'report_bulk_expired' else ${reportBulkJobs.errorCode} end`,
      completedAt: sql`coalesce(${reportBulkJobs.completedAt}, ${at.toISOString()}::timestamptz)`,
      updatedAt: at,
    })
    .where(jobIn(environmentId, id));
}

/** The jobs made before `before` still `pending` or `running`, for the sweep to enqueue again. */
export async function listUnfinishedReportBulkJobs(
  db: Db,
  before: Date,
  limit: number,
): Promise<{ id: string; environmentId: string }[]> {
  return db
    .select({ id: reportBulkJobs.id, environmentId: reportBulkJobs.environmentId })
    .from(reportBulkJobs)
    .where(
      and(
        inArray(reportBulkJobs.status, ['pending', 'running']),
        lt(reportBulkJobs.createdAt, before),
        sql`${reportBulkJobs.storageKey} is not null`,
      ),
    )
    .orderBy(asc(reportBulkJobs.createdAt), asc(reportBulkJobs.id))
    .limit(limit);
}
