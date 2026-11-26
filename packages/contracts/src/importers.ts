/**
 * List importers (plan C100): `importer/list-item/<kind>` (`mprt_`), the JSON body with its base64
 * file, and the error rows. Routes (frozen by `foundation-7b`, built by `api-importers`):
 * `POST /api/v1/importer/list-item/<plural>` as multipart or JSON, at most 20 MB either way (scopes
 * `importers:write` with `lists:write`; policy `importers`), `GET /api/v1/importers`,
 * `GET /api/v1/importers/:id` and, ours, `GET /api/v1/importers/:id/errors` (`importers:read`).
 *
 * A value is never echoed: an importer error is a code, a row and a column (C100.4). The JSON
 * `file` member is PII, so a stored API log keeps its length and SHA-256 only, as it keeps a
 * multipart part's (F23).
 */
import {
  IMPORT_LIMITS,
  importErrorCodeSchema,
  importerModeSchema,
  importerStatusSchema,
  toImporterResourceType,
  toListResourceType,
  type ImporterMode,
  type ImporterResourceType,
  type ImporterStatus,
  type ListKind,
} from '@openverify/core';
import { z } from 'zod';
import { idSchema } from './ids.js';
import { listIdentifierSchema } from './identifiers.js';
import {
  listDocumentSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';

export {
  IMPORT_ERROR_CODES,
  IMPORT_LIMITS,
  IMPORTER_MODES,
  IMPORTER_STATUSES,
  importErrorCodeSchema,
  importerModeSchema,
  type ImportErrorCode,
  type ImporterMode,
  type ImporterStatus,
} from '@openverify/core';

/** The longest base64 text of a 20 MB file. */
const MAX_BASE64_LENGTH = Math.ceil(IMPORT_LIMITS.fileBytes / 3) * 4;

/** C100.2: a WHATWG label for a legacy single-byte file; UTF-16 is refused. */
export const importerEncodingSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_:.-]*$/i, 'must be a WHATWG encoding label')
  .max(32)
  .refine((label) => !/^(?:utf-?16|ucs-?2|unicode)/i.test(label), 'UTF-16 is refused');

/** C100.1: public `status` and counts, then ours. */
export const importerAttributesSchema = z
  .strictObject({
    status: importerStatusSchema,
    'successful-count': z.int().min(0),
    /** Rows repeated within the file (H30). */
    'duplicate-count': z.int().min(0),
    'error-count': z.int().min(0),
    'created-at': timestampSchema,
    'completed-at': timestampSchema.nullable(),
    mode: importerModeSchema,
    'row-count': z.int().min(0),
    /** Rows already active in the list (H30). */
    'already-present-count': z.int().min(0),
    encoding: importerEncodingSchema,
    'file-sha256': z.string().regex(/^[0-9a-f]{64}$/, 'must be a lower-case SHA-256'),
  })
  .refine(
    (attributes) => (attributes.status === 'pending') === (attributes['completed-at'] === null),
    { message: 'an importer completes exactly when it is no longer pending', path: ['status'] },
  );

export const importerRelationshipsSchema = z.strictObject({
  list: z.strictObject({ data: listIdentifierSchema }),
});

function importerResource<const Kind extends ListKind>(kind: Kind) {
  return resourceWithRelationshipsSchema(
    toImporterResourceType(kind) as `importer/list-item/${Kind}`,
    'mprt',
    importerAttributesSchema,
    importerRelationshipsSchema,
  );
}

/** Every importer resource schema, in `IMPORTER_LIST_KINDS` order. */
export const IMPORTER_RESOURCE_SCHEMAS = [
  importerResource('browser-fingerprint'),
  importerResource('device-fingerprint'),
  importerResource('country'),
  importerResource('email-address'),
  importerResource('geolocation'),
  importerResource('government-id-number'),
  importerResource('field'),
  importerResource('ip-address'),
  importerResource('name'),
  importerResource('phone-number'),
  importerResource('string'),
] as const;

export const importerResourceSchema = z.discriminatedUnion('type', IMPORTER_RESOURCE_SCHEMAS);
export type ImporterResource = z.infer<typeof importerResourceSchema>;

export const importerDocumentSchema = singleDocumentSchema(importerResourceSchema);
export type ImporterDocument = z.infer<typeof importerDocumentSchema>;
export const importerListDocumentSchema = listDocumentSchema(importerResourceSchema);

/** `GET /api/v1/importers`: newest first. */
export const listImportersQuerySchema = listQuerySchema('mprt', {
  'filter[list-id]': filterListSchema(idSchema('lst')).optional(),
  'filter[status]': filterListSchema(importerStatusSchema).optional(),
});

/**
 * `POST /api/v1/importer/list-item/<plural>` as JSON: `file` is base64 of at most 20 MB. As
 * multipart, the parts are `data[attributes][file]` and `data[attributes][list-id]`, and `mode` and
 * `encoding` take the same names.
 */
export const createImporterBodySchema = z.strictObject({
  data: z.strictObject({
    attributes: z.strictObject({
      'list-id': idSchema('lst'),
      file: z
        .string()
        .min(1)
        .max(MAX_BASE64_LENGTH)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64')
        .meta({ pii: true }),
      mode: importerModeSchema.optional(),
      encoding: importerEncodingSchema.optional(),
    }),
  }),
});
export type CreateImporterBody = z.infer<typeof createImporterBodySchema>;

/** C100.1 (F12): one stored error. `row` and `column` are `null` for an error of the whole file. */
export const importerErrorSchema = z.strictObject({
  row: z.int().min(1).nullable(),
  column: z
    .string()
    .regex(/^[a-z][a-z_]*$/, 'must be a column header of C100.3')
    .max(32)
    .nullable(),
  code: importErrorCodeSchema,
});
export type ImporterError = z.infer<typeof importerErrorSchema>;

/** `GET /api/v1/importers/:id/errors`: in row order, at most 1,000 per import. */
export const importerErrorListDocumentSchema = listDocumentSchema(importerErrorSchema);
export type ImporterErrorListDocument = z.infer<typeof importerErrorListDocumentSchema>;

/** `page[after]` is the last row seen: an error row has no id of its own. */
export const listImporterErrorsQuerySchema = z.strictObject({
  'page[after]': z.coerce.number().int().min(0).optional(),
  'page[size]': z.coerce.number().int().min(1).max(100).optional(),
});

/** C107.5: the PII name of the importer's body. */
export const PII_IMPORTER_ATTRIBUTES: readonly string[] = Object.freeze(['file']);

export interface ImporterRecord {
  id: string;
  kind: ListKind;
  listId: string;
  status: ImporterStatus;
  mode: ImporterMode;
  successfulCount: number;
  duplicateCount: number;
  alreadyPresentCount: number;
  errorCount: number;
  rowCount: number;
  encoding: string;
  fileSha256: string;
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Builds an importer resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildImporterResource(record: ImporterRecord): ImporterResource {
  return importerResourceSchema.parse({
    type: toImporterResourceType(record.kind) satisfies ImporterResourceType,
    id: record.id,
    attributes: {
      status: record.status,
      'successful-count': record.successfulCount,
      'duplicate-count': record.duplicateCount,
      'error-count': record.errorCount,
      'created-at': toTimestamp(record.createdAt),
      'completed-at': toNullableTimestamp(record.completedAt),
      mode: record.mode,
      'row-count': record.rowCount,
      'already-present-count': record.alreadyPresentCount,
      encoding: record.encoding,
      'file-sha256': record.fileSha256,
    },
    relationships: {
      list: { data: { type: toListResourceType(record.kind), id: record.listId } },
    },
  });
}
