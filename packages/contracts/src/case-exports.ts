/**
 * Case exports (plan C138.1, C138.2). An export is an asynchronous job of at most 10,000 cases
 * (decision 69; `export_too_large`), its file encrypted into storage and downloadable for 24 hours.
 * **Only the creating principal** lists, reads and downloads it (P26): another principal gets 404,
 * and each download re-checks `cases:export`, and `pii:view` when personal data was included.
 *
 * CSV goes through Phase 7's neutralising writer (`packages/checks/src/csv/`), one row per case with
 * the columns of {@link CASE_EXPORT_CSV_COLUMNS}; sealed fields only with personal data on, and
 * comments never. JSON is a per-case bundle ({@link caseExportBundleSchema}), masked by the
 * requester's permissions. No escape is safe in every spreadsheet, and the docs say so.
 *
 * The audit entry of an export records its filter's **shape** only (P19), never a value, and an
 * export resource names no filter at all.
 *
 * Routes (frozen by `foundation-8b`, built by `api-case-files`): `POST /case-exports`, `GET
 * /case-exports` (the caller's own), `GET /case-exports/:id` and `GET /case-exports/:id/download`,
 * under `cases:export`; the policy `case-exports` (10 an hour per environment, C143.3).
 */
import {
  caseExportFormatSchema,
  caseExportStatusSchema,
  caseSlaStateSchema,
  caseStatusCategorySchema,
  type CaseExportFormat,
  type CaseExportStatus,
} from '@openverify/core';
import { z } from 'zod';
import { caseCommentResourceSchema } from './case-comments.js';
import { caseLimit, caseStatusKeySchema } from './case-templates.js';
import {
  CASE_SEARCH_SORT_ATTRIBUTES,
  caseHistoryEntryResourceSchema,
  caseResourceSchema,
  caseSearchQuerySchema,
} from './cases.js';
import { referenceIdSchema } from './identifiers.js';
import { anyIdSchema, idSchema } from './ids.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';

const ids = (prefix: Parameters<typeof idSchema>[0]) => z.array(idSchema(prefix)).min(1).max(100);

/**
 * C138.1: what an export takes, as `GET /cases` filters (C129.5) without their `filter[...]` wrapper.
 * With no member, every case the requester can see.
 */
export const caseExportFilterSchema = z.strictObject({
  status: z.array(caseStatusKeySchema).min(1).max(caseLimit('statuses')).optional(),
  'case-template-id': ids('ctmpl').optional(),
  'account-id': ids('acc').optional(),
  'reference-id': referenceIdSchema.optional(),
  'inquiry-id': ids('inq').optional(),
  'report-id': ids('rep').optional(),
  'case-queue-id': ids('cqueue').optional(),
  'assignee-id': ids('usr').optional(),
  'status-category': z.array(caseStatusCategorySchema).min(1).optional(),
  'sla-state': z.array(caseSlaStateSchema).min(1).optional(),
});
export type CaseExportFilter = z.infer<typeof caseExportFilterSchema>;

/**
 * `POST /api/v1/case-exports` (`cases:export`): a filter or a search body, never both.
 * `include-personal-data` needs `pii:view`, and a search with a `fields.*` leaf needs it too (P25).
 */
export const createCaseExportBodySchema = requestDocumentSchema(
  'case-export',
  z
    .strictObject({
      format: caseExportFormatSchema,
      'include-personal-data': z.boolean().optional(),
      filter: caseExportFilterSchema.optional(),
      search: z
        .strictObject({
          /** Leaves can hold a field's value, so a stored log masks it whole (C143.5, P25). */
          query: caseSearchQuerySchema.meta({ pii: true }),
          sort: z
            .strictObject({
              attribute: z.enum(CASE_SEARCH_SORT_ATTRIBUTES),
              direction: z.enum(['asc', 'desc']),
            })
            .optional(),
        })
        .optional(),
    })
    .refine(
      (attributes) => attributes.filter === undefined || attributes.search === undefined,
      'takes a filter or a search, never both',
    ),
);
export type CreateCaseExportBody = z.infer<typeof createCaseExportBodySchema>;

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const problemCode = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'must be a code');

/**
 * C138.1: an export as its creator reads it. `case-count` and `byte-size` are set once it has
 * completed; `expires-at` is when its file is deleted, 24 hours after.
 */
export const caseExportAttributesSchema = z
  .strictObject({
    status: caseExportStatusSchema,
    format: caseExportFormatSchema,
    'include-personal-data': z.boolean(),
    'case-count': z.int().min(0).max(caseLimit('export-cases')).nullable(),
    'byte-size': z.int().min(0).nullable(),
    /** A failure's problem code, such as `export_too_large`; nothing else. */
    'error-code': problemCode.nullable(),
    'created-at': timestampSchema,
    'completed-at': timestampSchema.nullable(),
    'expires-at': timestampSchema.nullable(),
  })
  .refine(
    (a) =>
      (a.status === 'completed' || a.status === 'expired') ===
      (a['completed-at'] !== null && a['expires-at'] !== null && a['case-count'] !== null),
    { message: 'a finished export has its count, its time and its expiry', path: ['status'] },
  )
  .refine((a) => (a.status === 'completed') === (a['byte-size'] !== null), {
    message: 'only a file still kept has a size',
    path: ['byte-size'],
  })
  .refine((a) => (a.status === 'failed') === (a['error-code'] !== null), {
    message: 'a failure has its code, and nothing else does',
    path: ['error-code'],
  });

export const caseExportResourceSchema = resourceSchema(
  'case-export',
  'cexp',
  caseExportAttributesSchema,
);
export type CaseExportResource = z.infer<typeof caseExportResourceSchema>;
export const caseExportDocumentSchema = singleDocumentSchema(caseExportResourceSchema);
export type CaseExportDocument = z.infer<typeof caseExportDocumentSchema>;
export const caseExportListDocumentSchema = listDocumentSchema(caseExportResourceSchema);
export type CaseExportListDocument = z.infer<typeof caseExportListDocumentSchema>;

/** `GET /api/v1/case-exports`: the caller's own, newest first. */
export const listCaseExportsQuerySchema = listQuerySchema('cexp', {
  'filter[status]': filterListSchema(caseExportStatusSchema).optional(),
});
export type ListCaseExportsQuery = z.infer<typeof listCaseExportsQuerySchema>;

/**
 * C138.2: the CSV's columns, in order: ids, enums, dates and tags; the held objects' ids are
 * space-separated in one cell each. `fields` follows, as one JSON cell, only with personal data on.
 */
export const CASE_EXPORT_CSV_COLUMNS = [
  'id',
  'name',
  'case-template-id',
  'status',
  'status-category',
  'resolution',
  'case-queue-id',
  'assignee-id',
  'created-at',
  'assigned-at',
  'resolved-at',
  'sla-state',
  'sla-expires-at',
  'tags',
  'account-ids',
  'inquiry-ids',
  'report-ids',
  'report-run-ids',
  'transaction-ids',
  'verification-ids',
  'graph-query-ids',
] as const;

/** C138.2: the column that holds the sealed fields, only with personal data on. */
export const CASE_EXPORT_PERSONAL_DATA_COLUMNS = ['fields'] as const;

/**
 * C138.2: one case of a JSON export: the case as the API returns it, its timeline, its comments and
 * the ids and types of what it holds. Attachment metadata is the case's `attachments`; no bytes.
 */
export const caseExportBundleEntrySchema = z.strictObject({
  case: caseResourceSchema,
  history: z.array(caseHistoryEntryResourceSchema),
  comments: z.array(caseCommentResourceSchema),
  'held-objects': z.array(z.strictObject({ type: z.string().min(1).max(64), id: anyIdSchema })),
});
export type CaseExportBundleEntry = z.infer<typeof caseExportBundleEntrySchema>;

/** C138.2: the JSON file of an export. Redacted content reads as redacted (`null`), never empty. */
export const caseExportBundleSchema = z.strictObject({
  data: z.array(caseExportBundleEntrySchema).max(caseLimit('export-cases')),
  meta: z.strictObject({
    'case-export-id': idSchema('cexp'),
    'exported-at': timestampSchema,
    'include-personal-data': z.boolean(),
    'case-count': z.int().min(0).max(caseLimit('export-cases')),
  }),
});
export type CaseExportBundle = z.infer<typeof caseExportBundleSchema>;

export interface CaseExportRecord {
  id: string;
  status: CaseExportStatus;
  format: CaseExportFormat;
  includePersonalData: boolean;
  caseCount: number | null;
  byteSize: number | null;
  errorCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseExportResource(record: CaseExportRecord): CaseExportResource {
  return caseExportResourceSchema.parse({
    type: 'case-export',
    id: record.id,
    attributes: {
      status: record.status,
      format: record.format,
      'include-personal-data': record.includePersonalData,
      'case-count': record.caseCount,
      'byte-size': record.byteSize,
      'error-code': record.errorCode,
      'created-at': toTimestamp(record.createdAt),
      'completed-at': toNullableTimestamp(record.completedAt),
      'expires-at': toNullableTimestamp(record.expiresAt),
    },
  });
}
