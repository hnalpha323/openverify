/**
 * C166.5, C166.6 (Workflow 9B; K13): bulk report creation, ours (`rbulk_`). Owner: `api-exports`. The
 * route has already checked `reports:write` and counted the `report-bulk` policy.
 *
 * - `POST /reports/bulk` (202) reads the buffered multipart body: `report-template-id` and the CSV in
 *   the part `REPORT_BULK_FILE_FIELD`, at most `REPORT_BULK_LIMITS.bytes` (413) and
 *   `REPORT_BULK_LIMITS.rows` (422). The template must be active with a published version (422
 *   `report_template_not_published`). The header names the template type's query members
 *   (`REPORT_QUERY_FIELDS`) and, optionally, the links `account-id` and `inquiry-id`, each needing its
 *   own scope (Phase 6 decision 39: `accounts:read`, `inquiries:write`; 403); any other column, a
 *   repeated one or a file `readCsv` refuses answers 422, naming a column and never a cell. The CSV is
 *   stored through `FileStorage` as an envelope object bound to the job (third-party personal data,
 *   review P24), the job is audited with its counts only, and `report-bulk` is enqueued after the
 *   commit.
 * - `GET /reports/bulk/:id` (`reports:read`): the job with each row created (its report) or failed
 *   (its code), in row order; a job of another environment is 404.
 */
import { readCsv } from '@openverify/checks';
import {
  REPORT_BULK_FILE_FIELD,
  REPORT_BULK_LIMITS,
  REPORT_QUERY_FIELDS,
  idSchema,
  type ReportBulkJobResource,
  type reportBulkJobDocumentSchema,
} from '@openverify/contracts';
import type { ReportType } from '@openverify/core';
import {
  createReportBulkJobRow,
  encryptBytes,
  getReportBulkJobRow,
  getReportTemplate,
  listReportBulkJobRows,
  type ReportBulkJobRecord,
} from '@openverify/db';
import type { z } from 'zod';
import {
  BadRequestError,
  NotFoundError,
  PayloadTooLargeError,
  PermissionDeniedError,
  ReportProblemError,
  UnprocessableContentError,
} from '../../errors.js';
import { authorizePrincipal } from '../../plugins/principal-auth.js';
import type { Permission } from '@openverify/core';
import { newStorageKey } from '../../storage/index.js';
import type { WorkflowActing } from '../../workflows/acting.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';

export type ReportBulkJobDocument = z.infer<typeof reportBulkJobDocumentSchema>;

/** The upload as the route buffered it: the multipart bytes and their content type. */
export interface ReportBulkUpload {
  body: Uint8Array;
  contentType: string;
}

export type CreateReportBulkJob = (
  deps: ApiDependencies,
  acting: WorkflowActing,
  upload: ReportBulkUpload,
) => Promise<ReportBulkJobDocument>;
export type GetReportBulkJob = (
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
) => Promise<ReportBulkJobDocument>;

/** The link columns a CSV may carry beside the query members, with the scope each needs. */
export const REPORT_BULK_LINK_COLUMNS: Readonly<Record<string, Permission>> = Object.freeze({
  'account-id': 'accounts:read',
  'inquiry-id': 'inquiries:write',
});

/** Query members that hold a list: their cell's values are separated by `|`. */
export const REPORT_BULK_LIST_MEMBERS: readonly string[] = Object.freeze([
  'additional-names',
  'list-ids',
]);

/** The characters one CSV record may hold (ours, provisional: 64 KiB, beside the 2 MiB file). */
export const REPORT_BULK_MAX_RECORD_CHARACTERS = 65_536;

/** The columns a CSV of `type` may name. */
export function reportBulkColumns(type: ReportType): string[] {
  return [...REPORT_QUERY_FIELDS[type], ...Object.keys(REPORT_BULK_LINK_COLUMNS)];
}

/** The CSV of `bytes` as the job reads it: refused whole, or its rows. */
export function readReportBulkCsv(type: ReportType, bytes: Uint8Array) {
  const allowed = reportBulkColumns(type);
  return readCsv(bytes, {
    maxRows: REPORT_BULK_LIMITS.rows,
    maxRecordCharacters: REPORT_BULK_MAX_RECORD_CHARACTERS,
    headerProblems: (header) => {
      const names = header.map((name) => name.trim());
      return [
        ...names
          .filter((name) => !allowed.includes(name))
          .map(() => ({ row: 0, column: null, code: 'unknown_column' as const })),
        ...allowed
          .filter((name) => names.filter((other) => other === name).length > 1)
          .map((name) => ({ row: 0, column: name, code: 'duplicate_column' as const })),
      ];
    },
  });
}

async function formOf(upload: ReportBulkUpload): Promise<{ templateId: string; file: File }> {
  let form: FormData;
  try {
    const response = new Response(new Uint8Array(upload.body), {
      headers: { 'content-type': upload.contentType },
    });
    // The body is buffered and bounded by the route's body limit.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    form = await response.formData();
  } catch {
    throw new BadRequestError('The request body is not a multipart form.');
  }
  let templateId: string | null = null;
  let file: File | null = null;
  for (const [name, value] of form.entries()) {
    if (name === REPORT_BULK_FILE_FIELD && file === null && typeof value !== 'string') {
      file = value;
    } else if (name === 'report-template-id' && templateId === null && typeof value === 'string') {
      templateId = value;
    } else {
      throw new BadRequestError('The form holds a part this route does not take, or repeats one.');
    }
  }
  const parsed = idSchema('rptp').safeParse(templateId);
  if (file === null || !parsed.success) {
    throw new BadRequestError(
      `The form needs a report-template-id and a CSV part named ${REPORT_BULK_FILE_FIELD}.`,
    );
  }
  return { templateId: parsed.data, file };
}

const FILE_POINTER = `/${REPORT_BULK_FILE_FIELD}`;

/** The job's resource with its rows, in row order. */
export async function reportBulkJobResource(
  deps: Pick<ApiDependencies, 'db'>,
  job: ReportBulkJobRecord,
): Promise<ReportBulkJobResource> {
  const rows = await listReportBulkJobRows(deps.db, job.environmentId, job.id);
  return {
    type: 'report-bulk-job',
    id: job.id,
    attributes: {
      status: job.status,
      'report-template-id': job.reportTemplateId,
      'row-count': job.rowCount,
      'created-count': rows.filter((row) => row.outcome === 'created').length,
      'failed-count': rows.filter((row) => row.outcome === 'failed').length,
      rows: rows.map((row) => ({
        row: row.rowNumber,
        outcome: row.outcome,
        'report-id': row.reportId,
        'error-code': row.errorCode,
      })),
      'error-code': job.errorCode,
      'created-at': job.createdAt.toISOString(),
      'completed-at': job.completedAt?.toISOString() ?? null,
    },
  };
}

export const createReportBulkJob: CreateReportBulkJob = async (deps, acting, upload) => {
  const { environmentId } = acting.ctx;
  if (acting.actor.type === 'workflow-run') {
    throw new PermissionDeniedError('A workflow run does not upload reports in bulk.');
  }
  const creator = { type: acting.actor.type, id: acting.actor.id };
  const { templateId, file } = await formOf(upload);
  if (file.size > REPORT_BULK_LIMITS.bytes) {
    throw new PayloadTooLargeError('A bulk report CSV holds at most 2 MiB.');
  }
  const template = await getReportTemplate(deps.db, environmentId, templateId);
  if (template?.status !== 'active') {
    throw new ReportProblemError(
      'report_template_not_published',
      'The report template is unknown, archived or has no published version.',
      {
        errors: [
          {
            location: 'body',
            pointer: '/report-template-id',
            detail: 'must name an active report template with a published version',
          },
        ],
      },
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const reading = readReportBulkCsv(template.reportType, bytes);
  if (reading.refused) {
    throw new UnprocessableContentError(
      'The CSV is refused whole: its header must name the template’s query members.',
      reading.errors.map((problem) => ({
        location: 'body',
        pointer: FILE_POINTER,
        detail: problem.column === null ? problem.code : `${problem.code}: ${problem.column}`,
        code: problem.code,
      })),
    );
  }
  const header = Object.keys(reading.rows[0]?.cells ?? {});
  const links = Object.entries(REPORT_BULK_LINK_COLUMNS)
    .filter(([column]) => header.includes(column))
    .map(([, scope]) => scope);
  authorizePrincipal(acting.principal, links);
  const id = deps.ids.newId('rbulk');
  const sealed = encryptBytes(bytes, deps.keyring, { context: id });
  const storageKey = newStorageKey(environmentId);
  await deps.storage.put(storageKey, sealed.ciphertext);
  let job: ReportBulkJobRecord;
  try {
    job = await deps.db.transaction(async (tx) => {
      const made = await createReportBulkJobRow(tx, environmentId, {
        id,
        creator,
        reportTemplateId: template.id,
        rowCount: reading.rowCount,
        storageKey,
        wrappedDek: sealed.wrappedDek,
        at: deps.clock.now(),
      });
      await deps.audit.record(
        tx,
        auditEntryOf(acting.ctx, acting.actor, {
          action: 'report-bulk-job.created',
          resourceType: 'report-bulk-job',
          resourceId: id,
          metadata: { 'report-template-id': template.id, 'row-count': reading.rowCount },
        }),
      );
      return made;
    });
  } catch (error) {
    await deps.storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
  try {
    await deps.reportBulk?.enqueueReportBulk({ environmentId, reportBulkJobId: id });
  } catch {
    // The job is pending, so the sweep enqueues it again.
  }
  return { data: await reportBulkJobResource(deps, job) };
};

export const getReportBulkJob: GetReportBulkJob = async (deps, acting, id) => {
  const job = await getReportBulkJobRow(deps.db, acting.ctx.environmentId, id);
  if (job === null) {
    throw new NotFoundError(`Bulk report job ${id} was not found.`);
  }
  return { data: await reportBulkJobResource(deps, job) };
};
