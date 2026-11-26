/**
 * C166.5, C166.6 (Phase 9, Workflow 9B Stage 1a, (X); K13, Phase 6's G7): bulk report creation, ours
 * (the public `batch-jobs` resource is deferred, C177, review H24). `POST /api/v1/reports/bulk`
 * (multipart: `report-template-id` and the CSV in the part `REPORT_BULK_FILE_FIELD`) needs
 * `reports:write` plus each link's scope (Phase 6 decision 39); the CSV's header names the template's
 * query sources, at most `REPORT_BULK_LIMITS.rows` rows and `REPORT_BULK_LIMITS.bytes`, read by
 * `readCsv`. An asynchronous `report-bulk` job (`rbulk_`) creates each report through Phase 6's
 * create service with `origin: bulk` and records each row's outcome as a code
 * (`GET /api/v1/reports/bulk/:id`): a row that failed is reported failed, never skipped. The CSV holds
 * third-party personal data, so it is stored through `FileStorage`, deleted when the job ends, swept
 * after 24 hours, covered by redaction and masked in API logs (`PII_REPORT_BULK_ATTRIBUTES`, review
 * P24). Rate limit `report-bulk`.
 */
import { REPORT_BULK_JOB_STATUSES, REPORT_BULK_ROW_OUTCOMES } from '@openverify/core';
import { z } from 'zod';
import { idSchema } from './ids.js';
import { resourceSchema, singleDocumentSchema, timestampSchema } from './json-api.js';

/** C166.5 (ours, provisional): at most 1,000 rows and 2 MiB, as the translations CSV's bytes. */
export const REPORT_BULK_LIMITS = Object.freeze({ rows: 1000, bytes: 2_097_152 } as const);

/** The multipart part that carries the CSV. */
export const REPORT_BULK_FILE_FIELD = 'file';

/** The multipart fields beside the file. */
export const createReportBulkJobFieldsSchema = z.strictObject({
  'report-template-id': idSchema('rptp'),
});
export type CreateReportBulkJobFields = z.infer<typeof createReportBulkJobFieldsSchema>;

export const reportBulkJobStatusSchema = z.enum(REPORT_BULK_JOB_STATUSES);
export const reportBulkRowOutcomeSchema = z.enum(REPORT_BULK_ROW_OUTCOMES);

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const problemCode = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'must be a code');

/** One CSV row's outcome: its number (the header is row 0), the report or the code, never a value. */
export const reportBulkRowSchema = z
  .strictObject({
    row: z.int().min(1).max(REPORT_BULK_LIMITS.rows),
    outcome: reportBulkRowOutcomeSchema,
    'report-id': idSchema('rep').nullable(),
    'error-code': problemCode.nullable(),
  })
  .refine((row) => (row.outcome === 'created') === (row['report-id'] !== null), {
    message: 'a created row names its report, and a failed one none',
    path: ['report-id'],
  })
  .refine((row) => (row.outcome === 'failed') === (row['error-code'] !== null), {
    message: 'a failed row has its code, and a created one none',
    path: ['error-code'],
  });

export const reportBulkJobAttributesSchema = z
  .strictObject({
    status: reportBulkJobStatusSchema,
    'report-template-id': idSchema('rptp'),
    'row-count': z.int().min(0).max(REPORT_BULK_LIMITS.rows).nullable(),
    'created-count': z.int().min(0).max(REPORT_BULK_LIMITS.rows),
    'failed-count': z.int().min(0).max(REPORT_BULK_LIMITS.rows),
    /** The rows done so far, in row order. */
    rows: z.array(reportBulkRowSchema).max(REPORT_BULK_LIMITS.rows),
    /** A whole-file refusal's code (a header or size problem); per-row failures are in `rows`. */
    'error-code': problemCode.nullable(),
    'created-at': timestampSchema,
    'completed-at': timestampSchema.nullable(),
  })
  .refine(
    (a) =>
      a['created-count'] === a.rows.filter((row) => row.outcome === 'created').length &&
      a['failed-count'] === a.rows.filter((row) => row.outcome === 'failed').length,
    { message: 'the counts are the rows', path: ['created-count'] },
  )
  .refine(
    (a) => (a.status === 'completed' || a.status === 'failed') === (a['completed-at'] !== null),
    {
      message: 'an ended job has its time',
      path: ['completed-at'],
    },
  );

export const reportBulkJobResourceSchema = resourceSchema(
  'report-bulk-job',
  'rbulk',
  reportBulkJobAttributesSchema,
);
export type ReportBulkJobResource = z.infer<typeof reportBulkJobResourceSchema>;
export const reportBulkJobDocumentSchema = singleDocumentSchema(reportBulkJobResourceSchema);

/** C174.5: the uploaded CSV is third-party personal data, masked in API logs. */
export const PII_REPORT_BULK_ATTRIBUTES: readonly string[] = Object.freeze(['file']);
