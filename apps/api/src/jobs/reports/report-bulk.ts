/**
 * C166.5, C166.6 (Workflow 9B; K13): the `report-bulk` job, one per `report_bulk_jobs` row. Owner:
 * `api-exports`; `foundation-9b` (Stage 1b (X)) froze the queue (`jobs/export-queues.ts`) and the
 * worker's registration.
 *
 * - The job claims the row (`FOR UPDATE SKIP LOCKED`, a 15-minute lease), opens the CSV (sealed to the
 *   job) and reads it again with the upload's rules (`readReportBulkCsv`).
 * - Each data row (numbered from 1; the header is row 0) becomes a `POST /reports` body of the
 *   template's type (empty cells left out, a list member's values separated by `|`) and is created
 *   through Phase 6's create service with `origin: bulk`, its outcome written in the same transaction
 *   (`report_bulk_job_rows`), so a retried job never creates a row's report twice; a row already
 *   recorded is skipped as done. A row that fails is recorded failed with a code (the problem's own
 *   code, such as 7B's `report_lists_required`, or `report_query_invalid`, `not_found`, `redacted`,
 *   `report_create_failed`), never skipped. Each created report's events are dispatched and its
 *   initial run enqueued after its commit.
 * - The job ends `completed`, deletes the CSV and clears its columns; a CSV that is gone or no longer
 *   readable ends it `failed` with a whole-file code. A delete that fails leaves the columns for
 *   `export-sweep`. Nothing here logs a value.
 *
 * The create service is typed by `ApiDependencies`, of which it reads the clock, ids, report limits,
 * events, audit, accounts (an account made for a report) and the `report-run` producer: the job builds
 * those from its own deps, as the workflow actions do (`apiDepsOf`).
 */
import { stripNeutraliser } from '@openverify/checks';
import { createReportBodySchema, toReportResourceType } from '@openverify/contracts';
import {
  claimReportBulkJobRow,
  finishReportBulkJobRow,
  getEnvironment,
  getReportTemplate,
  listReportBulkJobRows,
  recordReportBulkRow,
  type Db,
  type ReportBulkJobRecord,
} from '@openverify/db';
import { UNMASKED } from '../../auth/pii.js';
import type { ReportLimits } from '../../config.js';
import { AppError } from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import { ulidIdGenerator, type ReportBulkJob, type ReportRunQueue } from '../../ports.js';
import { createAccountsService } from '../../services/accounts.js';
import { createAuditLogger } from '../../services/audit-log.js';
import {
  ObjectUnreadableError,
  openSealedObject,
} from '../../services/cases/attachments/objects.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  readReportBulkCsv,
  REPORT_BULK_LINK_COLUMNS,
  REPORT_BULK_LIST_MEMBERS,
} from '../../services/exports/report-bulk.js';
import type { Acting } from '../../services/inquiries.js';
import { createReportInTx, enqueueRun } from '../../services/reports/reports.js';
import { listReportRuns } from '@openverify/db';
import type { ExportJobDeps } from '../exports/export.js';

/** What the `report-bulk` job reads: the export job's, and the report settings and run producer. */
export interface ReportBulkJobDeps extends ExportJobDeps {
  /** C74: the report limits and the `report-run` producer the create service enqueues on. */
  reports?: { limits: ReportLimits; runs: ReportRunQueue } | undefined;
}

export type ProcessReportBulk = (job: ReportBulkJob, deps: ReportBulkJobDeps) => Promise<void>;

/** The `reason` the stub failed with, kept for the worker's tests. */
export const REPORT_BULK_NOT_BUILT = 'report_bulk_not_built';

/** Whole-file codes. */
export const REPORT_BULK_FILE_CODES = Object.freeze({
  /** The CSV is gone (the sweep deleted a day-old job's) or no longer opens. */
  unreadable: 'report_bulk_file_unreadable',
  /** The CSV no longer reads as it did at the upload (the template's type changed). */
  refused: 'report_bulk_file_refused',
  /** The worker runs no reports, so no report can be created. */
  reportsUnavailable: 'report_runs_unavailable',
} as const);

const BY_STATUS: Readonly<Record<number, string>> = {
  404: 'not_found',
  409: 'conflict',
  410: 'redacted',
  422: 'report_query_invalid',
};

/** A row's failure as a code, never a value. */
export function rowErrorCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code ?? BY_STATUS[error.status] ?? 'report_create_failed';
  }
  return 'report_create_failed';
}

/** One row as a create body of `type`. */
function bodyOf(type: string, templateId: string, cells: Readonly<Record<string, string>>) {
  const query: Record<string, unknown> = {};
  const attributes: Record<string, unknown> = { 'report-template-id': templateId, query };
  for (const [column, raw] of Object.entries(cells)) {
    const cell = stripNeutraliser(raw).trim();
    if (cell === '') {
      continue;
    }
    if (column in REPORT_BULK_LINK_COLUMNS) {
      attributes[column] = cell;
    } else if (REPORT_BULK_LIST_MEMBERS.includes(column)) {
      query[column] = cell.split('|').map((part) => part.trim());
    } else {
      query[column] = cell;
    }
  }
  return createReportBodySchema.safeParse({
    data: { type: toReportResourceType(type as never), attributes },
  });
}

/** The create service's dependencies, from the job's (see the module comment). */
function serviceDeps(
  deps: ReportBulkJobDeps,
  reports: NonNullable<ReportBulkJobDeps['reports']>,
): ApiDependencies {
  return {
    db: deps.db,
    clock: deps.clock,
    ids: ulidIdGenerator,
    events: deps.events,
    audit: createAuditLogger(),
    accounts: createAccountsService({ events: deps.events }),
    reportLimits: reports.limits,
    reportRuns: reports.runs,
  } as unknown as ApiDependencies;
}

async function actingOf(db: Db, job: ReportBulkJobRecord): Promise<Acting | null> {
  const environment = await getEnvironment(db, job.environmentId);
  if (environment === null) {
    return null;
  }
  return {
    ctx: { organizationId: environment.organizationId, environmentId: job.environmentId },
    actor: { type: job.creatorType, id: job.creatorId },
    mask: UNMASKED,
    environmentKind: environment.kind,
  };
}

async function end(
  deps: ReportBulkJobDeps,
  job: ReportBulkJobRecord,
  status: 'completed' | 'failed',
  errorCode: string | null,
): Promise<void> {
  let fileDeleted = job.storageKey === null;
  if (job.storageKey !== null) {
    fileDeleted = await deps.storage.delete(job.storageKey).then(
      () => true,
      () => false,
    );
  }
  await deps.db.transaction((tx) =>
    finishReportBulkJobRow(tx, job.environmentId, job.id, {
      status,
      errorCode,
      at: deps.clock.now(),
      fileDeleted,
    }),
  );
}

/** Creates one row's report and records it, or records its failure. */
async function runRow(
  deps: ReportBulkJobDeps,
  api: ApiDependencies,
  acting: Acting,
  job: ReportBulkJobRecord,
  type: string,
  row: { rowNumber: number; cells: Readonly<Record<string, string>> },
): Promise<void> {
  const { environmentId } = job;
  const parsed = bodyOf(type, job.reportTemplateId, row.cells);
  if (!parsed.success) {
    await recordReportBulkRow(deps.db, environmentId, job.id, {
      rowNumber: row.rowNumber,
      outcome: 'failed',
      errorCode: 'report_query_invalid',
    });
    return;
  }
  const staged: StagedEvent[] = [];
  try {
    const report = await deps.db.transaction(async (tx) => {
      const created = await createReportInTx(tx, api, acting, parsed.data, 'bulk', staged);
      const written = await recordReportBulkRow(tx, environmentId, job.id, {
        rowNumber: row.rowNumber,
        outcome: 'created',
        reportId: created.id,
      });
      if (!written) {
        throw new RowDoneError();
      }
      return created;
    });
    await deps.events.dispatch(staged);
    const [run] = await listReportRuns(deps.db, environmentId, report.id);
    if (run !== undefined) {
      await enqueueRun(api, environmentId, report.id, run.id);
    }
  } catch (error) {
    if (error instanceof RowDoneError) {
      return;
    }
    await recordReportBulkRow(deps.db, environmentId, job.id, {
      rowNumber: row.rowNumber,
      outcome: 'failed',
      errorCode: rowErrorCode(error),
    });
  }
}

/** Another run of the job recorded the row first: what this one made is rolled back. */
class RowDoneError extends Error {
  override name = 'RowDoneError';
}

/** Runs one job; one already claimed, ended or gone is left as it is. */
export async function runReportBulk(
  deps: ReportBulkJobDeps,
  environmentId: string,
  jobId: string,
): Promise<void> {
  const job = await deps.db.transaction((tx) =>
    claimReportBulkJobRow(tx, environmentId, jobId, { now: deps.clock.now() }),
  );
  if (job === null) {
    return;
  }
  const acting = await actingOf(deps.db, job);
  const template = await getReportTemplate(deps.db, environmentId, job.reportTemplateId);
  if (deps.reports === undefined || acting === null || template === null) {
    await end(deps, job, 'failed', REPORT_BULK_FILE_CODES.reportsUnavailable);
    return;
  }
  if (job.storageKey === null || job.wrappedDek === null) {
    await end(deps, job, 'failed', REPORT_BULK_FILE_CODES.unreadable);
    return;
  }
  let bytes: Buffer;
  try {
    bytes = await openSealedObject(deps, {
      storageKey: job.storageKey,
      wrappedDek: job.wrappedDek,
      context: job.id,
    });
  } catch (error) {
    if (!(error instanceof ObjectUnreadableError)) {
      throw error;
    }
    await end(deps, job, 'failed', REPORT_BULK_FILE_CODES.unreadable);
    return;
  }
  const reading = readReportBulkCsv(template.reportType, bytes);
  if (reading.refused) {
    await end(deps, job, 'failed', REPORT_BULK_FILE_CODES.refused);
    return;
  }
  const done = new Set(
    (await listReportBulkJobRows(deps.db, environmentId, job.id)).map((row) => row.rowNumber),
  );
  // Data rows and refused rows in the file's order: the n-th is row n.
  const entries = [
    ...reading.rows.map((row) => ({ line: row.row, cells: row.cells, code: null })),
    ...reading.errors.map((problem) => ({
      line: problem.row ?? 0,
      cells: null,
      code: problem.code,
    })),
  ].sort((a, b) => a.line - b.line);
  const api = serviceDeps(deps, deps.reports);
  for (const [index, entry] of entries.entries()) {
    const rowNumber = index + 1;
    if (done.has(rowNumber)) {
      continue;
    }
    if (entry.cells === null) {
      await recordReportBulkRow(deps.db, environmentId, job.id, {
        rowNumber,
        outcome: 'failed',
        errorCode: entry.code,
      });
      continue;
    }
    await runRow(deps, api, acting, job, template.reportType, {
      rowNumber,
      cells: entry.cells,
    });
  }
  await end(deps, job, 'completed', null);
}

export const processReportBulk: ProcessReportBulk = (job, deps) =>
  runReportBulk(deps, job.environmentId, job.reportBulkJobId);
