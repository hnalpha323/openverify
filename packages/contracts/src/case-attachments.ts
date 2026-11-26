/**
 * Case attachments and renditions (plan C135). An attachment is a JPEG, PNG, WebP or PDF by its
 * magic bytes, at most 10 MiB, 20 a case (decision 62), stored sealed with its sealed original
 * filename. What a reader sees is a **rendition**: an EXIF-upright image without metadata, or a PDF's
 * pages as PNG images, made asynchronously by the vision service (decisions 62, 63; F25). The sealed
 * original is served only to `cases:redact` with `pii:view`, audited (P23).
 *
 * Serving (C135.5; P23, H20): with a scanner bound only `clean` is served, `pending` answers 409
 * `attachment_scan_pending`, and `infected` and `error` are never served; with the `none` provider an
 * attachment is `not_scanned`, served behind a warning. The contract refuses `clean` without the
 * provider that said so.
 *
 * PII (C143.5): the bytes and the filename. The attachment as a case serves it names a filename,
 * which is `null` without `pii:view` and once redacted (P34); the bytes are never in a resource. A
 * PATCH body carries `{ data, filename }` items: `CASE_ATTACHMENT_BODY_PII_MEMBERS` names both for the
 * stored API log, which masks them inside an `attachments` item only, because `data` names every
 * JSON:API body.
 *
 * Routes (frozen by `foundation-8b`, built by `api-case-files`): `POST /cases/:id/attachments`
 * (multipart, `cases:write`), `GET /cases/:id/attachments/:attachmentId/content` (`cases:read` and
 * `pii:view`; the rendition) and `.../original` (`cases:redact` and `pii:view`), and the public
 * `PATCH /cases/:id` with `data.attributes.attachments`. A route parameter is camelCase (Stage 1b
 * amendment 50).
 */
import {
  caseAttachmentScanProviderSchema,
  caseAttachmentScanStatusSchema,
  caseAttachmentTypeSchema,
  caseRenditionStatusSchema,
  type CaseAttachmentScanProvider,
  type CaseAttachmentScanStatus,
  type CaseAttachmentType,
  type CaseRenditionStatus,
} from '@openverify/core';
import { z } from 'zod';
import { caseLimit } from './case-templates.js';
import { idSchema } from './ids.js';
import { timestampSchema, toNullableTimestamp, toTimestamp } from './json-api.js';

const ID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const CONTENT_PATH = new RegExp(`^/api/v1/cases/case_${ID}/attachments/catt_${ID}/content$`);

/** The route that serves an attachment's rendition, which is the public `url`. */
export function caseAttachmentContentPath(caseId: string, attachmentId: string): string {
  return `/api/v1/cases/${caseId}/attachments/${attachmentId}/content`;
}

/**
 * C129.2, C135: one attachment as a case serves it. The public members (`id`, `filename`, `url`,
 * `byte-size`) come first. `url` is the content route, relative to the API, never a storage URL:
 * stored objects are ciphertext (C135.4).
 */
export const caseAttachmentSchema = z
  .strictObject({
    id: idSchema('catt'),
    /** `null` without `pii:view`, and once the case is redacted (P34). */
    filename: z
      .string()
      .min(1)
      .max(caseLimit('filename-characters'))
      .nullable()
      .meta({ pii: true }),
    url: z.string().regex(CONTENT_PATH, 'must be the attachment content route'),
    'byte-size': z.int().min(1).max(caseLimit('attachment-bytes')),
    /** By the magic bytes, never the client's word. */
    'attachment-type': caseAttachmentTypeSchema,
    'scan-status': caseAttachmentScanStatusSchema,
    'scan-provider': caseAttachmentScanProviderSchema.nullable(),
    'scanned-at': timestampSchema.nullable(),
    'rendition-status': caseRenditionStatusSchema,
    /** Rendered pages: 1 for an image; a PDF's first 20 at most. `null` until rendered. */
    'page-count': z.int().min(1).max(caseLimit('rendition-pages')).nullable(),
    'created-at': timestampSchema,
  })
  .refine(
    ({ 'scan-status': status, 'scan-provider': provider }) =>
      (status === 'not_scanned') === (provider === null),
    {
      message: 'a scan names its provider, and an attachment not scanned names none (H20)',
      path: ['scan-provider'],
    },
  )
  .refine(
    ({ 'scan-status': status, 'scanned-at': at }) =>
      (status === 'clean' || status === 'infected') === (at !== null) || status === 'error',
    { message: 'a verdict has the time it was given, and nothing else does', path: ['scanned-at'] },
  )
  .refine(
    ({ 'rendition-status': status, 'page-count': pages }) =>
      (status === 'ready') === (pages !== null),
    { message: 'a ready rendition has its pages, and nothing else does', path: ['page-count'] },
  );
export type CaseAttachment = z.infer<typeof caseAttachmentSchema>;

/** At most 20 a case (C135.2). */
export const caseAttachmentsSchema = z
  .array(caseAttachmentSchema)
  .max(caseLimit('attachments-per-case'));

/** `base64` of `bytes`: four characters for every three bytes, padded. */
const base64Length = (bytes: number): number => 4 * Math.ceil(bytes / 3);

/** The bytes a base64 string decodes to, from its length and padding alone. */
export function base64DecodedLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

/** C135.1 (public): one attachment of a `PATCH /cases/:id`. */
export const caseAttachmentUploadSchema = z.strictObject({
  data: z
    .base64()
    .min(4)
    .max(base64Length(caseLimit('attachment-bytes')))
    .meta({ pii: true }),
  filename: z.string().min(1).max(caseLimit('filename-characters')).meta({ pii: true }),
});
export type CaseAttachmentUpload = z.infer<typeof caseAttachmentUploadSchema>;

/**
 * C135.1 (H31): an array within one request's 10 MiB decoded total. The route's body limit is 14 MiB
 * for this route alone, and the handler hands the items to `acceptPatchAttachments` (F15).
 */
export const caseAttachmentUploadsSchema = z
  .array(caseAttachmentUploadSchema)
  .min(1)
  .max(caseLimit('attachments-per-case'))
  .refine(
    (uploads) =>
      uploads.reduce((sum, { data }) => sum + base64DecodedLength(data), 0) <=
      caseLimit('patch-attachment-bytes'),
    'must decode to 10 MiB or less in all',
  )
  .meta({ pii: true });

/** The members a PATCH item carries that a stored API log masks (C143.5, P21). */
export const CASE_ATTACHMENT_BODY_PII_MEMBERS: readonly string[] = Object.freeze([
  'data',
  'filename',
]);

/** C143.5: the attachment's PII name as a case serves it; the bytes are never in a resource. */
export const PII_CASE_ATTACHMENT_ATTRIBUTES: readonly string[] = Object.freeze(['filename']);

/** `:id` and `:attachmentId` of the attachment routes. */
export const caseAttachmentParamsSchema = z.strictObject({
  id: idSchema('case'),
  attachmentId: idSchema('catt'),
});

/** A page of a PDF's rendition, 1-based; an image has page 1 alone. */
export const renditionPageQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(caseLimit('rendition-pages')).optional(),
});
export type RenditionPageQuery = z.infer<typeof renditionPageQuerySchema>;

/**
 * C135.3: a rendition not made yet answers 202 with this, and `Retry-After`; the console shows
 * "preparing" and asks again. A rendition vision could not make answers 422
 * `rendition_unavailable`, and a deleted or redacted source 404.
 */
export const renditionPendingDocumentSchema = z.strictObject({
  meta: z.strictObject({
    'rendition-status': z.literal('pending'),
    'retry-after-seconds': z.int().min(1).max(60),
  }),
});
export type RenditionPendingDocument = z.infer<typeof renditionPendingDocumentSchema>;

/** `:id` of `GET /api/v1/dashboard/files/:id/rendition`: an inquiry's file (C135.3). */
export const fileRenditionParamsSchema = z.strictObject({ id: idSchema('file') });

export interface CaseAttachmentRecord {
  id: string;
  caseId: string;
  /** As the principal may see it: `null` without `pii:view` and once redacted. */
  filename: string | null;
  byteSize: number;
  attachmentType: CaseAttachmentType;
  scanStatus: CaseAttachmentScanStatus;
  scanProvider: CaseAttachmentScanProvider | null;
  scannedAt: Date | null;
  renditionStatus: CaseRenditionStatus;
  pageCount: number | null;
  createdAt: Date;
}

/** @throws {z.ZodError} when the record does not satisfy the contract. */
export function buildCaseAttachment(record: CaseAttachmentRecord): CaseAttachment {
  return caseAttachmentSchema.parse({
    id: record.id,
    filename: record.filename,
    url: caseAttachmentContentPath(record.caseId, record.id),
    'byte-size': record.byteSize,
    'attachment-type': record.attachmentType,
    'scan-status': record.scanStatus,
    'scan-provider': record.scanProvider,
    'scanned-at': toNullableTimestamp(record.scannedAt),
    'rendition-status': record.renditionStatus,
    'page-count': record.pageCount,
    'created-at': toTimestamp(record.createdAt),
  });
}
