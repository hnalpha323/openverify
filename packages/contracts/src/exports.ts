/**
 * C166.1-C166.4, C166.6 (Phase 9, Workflow 9B Stage 1a, (X); decision 43): generic exports, ours,
 * mirroring Phase 8's case exports (C138). `POST /exports` cuts one CSV of a list's filter or a saved
 * view as an asynchronous job of at most `EXPORT_LIMITS.rows` rows (`export_too_large` past it, never
 * truncated); `GET /exports` lists the caller's own, `GET /exports/:id` reads one and
 * `GET /exports/:id/download` serves the file (`Content-Disposition: attachment`, `private,
 * no-store`). Only the creating principal sees an export (others 404), every download re-checks the
 * permissions, the file is sealed for 24 hours and then deleted, and the audit entries record the
 * filter's shape only. The permission is the object type's `:export` (`EXPORT_PERMISSIONS`), and
 * personal columns need `pii:view` (masked otherwise). Rate limit `exports`; no event.
 */
import {
  EXPORT_FORMATS,
  EXPORT_LIMITS,
  EXPORT_OBJECT_TYPES,
  EXPORT_STATUSES,
} from '@openverify/core';
import { z } from 'zod';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';

export const exportObjectTypeSchema = z.enum(EXPORT_OBJECT_TYPES);
export const exportFormatSchema = z.enum(EXPORT_FORMATS);
export const exportStatusSchema = z.enum(EXPORT_STATUSES);

/** A filter as the list route takes it: each key's value, or values. */
export const exportFilterSchema = z.record(
  z.string().regex(/^filter\[[a-z0-9_.\-[\]]{1,96}\]$/, 'must be a filter of the list'),
  z.union([z.string().min(1).max(1024), z.array(z.string().min(1).max(1024)).min(1).max(100)]),
);

/** The filter each object type needs (C166.1): a verification type, a list. */
const REQUIRED_FILTER: Readonly<Partial<Record<string, string>>> = Object.freeze({
  verifications: 'filter[type]',
  lists: 'filter[list-id]',
});

/**
 * `POST /exports` (`<type>:export`). `filter` (the list route's filters, validated by its query
 * schema) or `saved-view-id`, never both; neither is the whole list. The filter's values are personal
 * data in logs (`PII_EXPORT_ATTRIBUTES`); only its keys are audited.
 */
export const createExportBodySchema = requestDocumentSchema(
  'export',
  z
    .strictObject({
      'object-type': exportObjectTypeSchema,
      format: exportFormatSchema,
      filter: exportFilterSchema.meta({ pii: true }).optional(),
      'saved-view-id': idSchema('svw').optional(),
      /** C166.1: needs `pii:view`; personal columns are masked otherwise. */
      'include-personal-data': z.boolean().optional(),
    })
    .refine((a) => a.filter === undefined || a['saved-view-id'] === undefined, {
      message: 'takes a filter or a saved view, never both',
      path: ['saved-view-id'],
    })
    .refine(
      (a) => {
        const required = REQUIRED_FILTER[a['object-type']];
        return (
          required === undefined ||
          a['saved-view-id'] !== undefined ||
          a.filter?.[required] !== undefined
        );
      },
      { message: 'verifications need filter[type] and lists filter[list-id]', path: ['filter'] },
    ),
);
export type CreateExportBody = z.infer<typeof createExportBodySchema>;

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const problemCode = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'must be a code');

/**
 * C166.6: the export records its filter's shape (`filter-keys`, never a value), the saved view it
 * used, the time it was cut, its row count and whether personal data was included; the CSV itself
 * stays plain.
 */
export const exportAttributesSchema = z
  .strictObject({
    'object-type': exportObjectTypeSchema,
    format: exportFormatSchema,
    status: exportStatusSchema,
    'filter-keys': z.array(z.string().max(100)).max(100),
    'saved-view-id': idSchema('svw').nullable(),
    'include-personal-data': z.boolean(),
    'row-count': z.int().min(0).max(EXPORT_LIMITS.rows).nullable(),
    'byte-size': z.int().min(0).nullable(),
    /** A failure's problem code, such as `export_too_large`; nothing else. */
    'error-code': problemCode.nullable(),
    'created-at': timestampSchema,
    /** When the rows were read (the export's point in time; C166.1, review P36). */
    'cut-at': timestampSchema.nullable(),
    'completed-at': timestampSchema.nullable(),
    'expires-at': timestampSchema.nullable(),
  })
  .refine(
    (a) =>
      (a.status === 'completed' || a.status === 'expired') ===
      (a['completed-at'] !== null &&
        a['cut-at'] !== null &&
        a['expires-at'] !== null &&
        a['row-count'] !== null),
    { message: 'a finished export has its count, its times and its expiry', path: ['status'] },
  )
  .refine((a) => (a.status === 'completed') === (a['byte-size'] !== null), {
    message: 'only a file still kept has a size',
    path: ['byte-size'],
  })
  .refine((a) => (a.status === 'failed') === (a['error-code'] !== null), {
    message: 'a failure has its code, and nothing else does',
    path: ['error-code'],
  });

export const exportResourceSchema = resourceSchema('export', 'exp', exportAttributesSchema);
export type ExportResource = z.infer<typeof exportResourceSchema>;
export const exportDocumentSchema = singleDocumentSchema(exportResourceSchema);
export const exportListDocumentSchema = listDocumentSchema(exportResourceSchema);

/** `GET /exports`: the caller's own, newest first. */
export const listExportsQuerySchema = listQuerySchema('exp', {
  'filter[status]': filterListSchema(exportStatusSchema).optional(),
  'filter[object-type]': filterListSchema(exportObjectTypeSchema).optional(),
});
export type ListExportsQuery = z.infer<typeof listExportsQuerySchema>;

/** C174.5: the members of an export body that are personal data in logs. */
export const PII_EXPORT_ATTRIBUTES: readonly string[] = Object.freeze(['filter']);

/** One documented column: its header and whether it holds personal data (masked without pii:view). */
export interface ExportColumn {
  readonly name: string;
  readonly pii: boolean;
}

const column = (name: string, pii = false): ExportColumn => Object.freeze({ name, pii });

/**
 * C166.3: the documented columns of each type, written through Phase 7's formula-neutralising writer
 * in this order. Never included (Phase 8 C138.4): secrets, tokens, storage keys, wrapped keys, face
 * templates, embeddings, raw fingerprints, EXIF, other environments' data. Redacted content exports
 * as "redacted"; a `pii` column is masked unless `include-personal-data` was asked with `pii:view`.
 * A list item's value is third-party personal data (K9); a list's columns are its kind's import
 * columns, so `lists` has no entry here (K9-29).
 */
export const EXPORT_CSV_COLUMNS: Readonly<Record<string, readonly ExportColumn[]>> = Object.freeze({
  inquiries: Object.freeze([
    column('id'),
    column('status'),
    column('reference-id', true),
    column('inquiry-template-id'),
    column('inquiry-template-version-id'),
    column('account-id'),
    column('tags'),
    column('next-step-name', true),
    column('created-at'),
    column('started-at'),
    column('completed-at'),
    column('failed-at'),
    column('expired-at'),
    column('decisioned-at'),
    column('redacted-at'),
    column('fields', true),
  ]),
  verifications: Object.freeze([
    column('id'),
    column('type'),
    column('status'),
    column('inquiry-id'),
    column('country'),
    column('id-class'),
    column('checks'),
    column('created-at'),
    column('submitted-at'),
    column('completed-at'),
    column('redacted-at'),
    column('extracted-fields', true),
  ]),
  accounts: Object.freeze([
    column('id'),
    column('account-type-id'),
    column('status'),
    column('reference-id', true),
    column('tags'),
    column('created-at'),
    column('updated-at'),
    column('redacted-at'),
    column('fields', true),
  ]),
  reports: Object.freeze([
    column('id'),
    column('type'),
    column('status'),
    column('report-template-id'),
    column('inquiry-id'),
    column('account-id'),
    column('reference-id', true),
    column('has-match'),
    column('created-at'),
    column('redacted-at'),
    column('query', true),
  ]),
  // K9-29 (Workflow 9D): no fixed columns for lists. A list's items are written under exactly the
  // importer's columns of its kind (`importColumns`, `@openverify/checks`), each personal, so the
  // file imports again unchanged (C166.3).
  transactions: Object.freeze([
    column('id'),
    column('transaction-type-id'),
    column('transaction-type-version-id'),
    column('status'),
    column('reference-id', true),
    column('created-at'),
    column('updated-at'),
    column('redacted-at'),
    column('fields', true),
  ]),
});
