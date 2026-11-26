/**
 * Phase 8, Workflow 8B Stage 1b, checkpoint (F) (C135, C138): a case's attachments, the renditions
 * readers see instead of an original, and case exports.
 *
 * - `case_attachments` (`catt_`, C135.2): an object in storage sealed with `encryptBytes` (its wrapped
 *   data key here), one of four types by its magic bytes, at most 10 MiB, its original filename sealed
 *   for its row (`case_attachments.original_filename#<id>`). Redaction (C139.1, P34) keeps the row with
 *   its id, type, size and scan status: it nulls the name and the digest in its transaction, and once
 *   the object is deleted the storage key and the wrapped key go with `deleted_at`, which the C16 pass
 *   retries. The scan (C135.5, H20) names its provider, and a verdict the time it was given; the
 *   rendition's state is the one C135.3 serves.
 * - `file_renditions` (C135.3): the rendition state of an inquiry's `files` row, with its foreign key
 *   on `files(id)`. It goes with its file.
 * - `rendition_pages` (C135.3): the sealed page images of a file's or an attachment's rendition,
 *   keyed `<source id>/<page>`. No foreign key on the source, by decision (Stage 1a amendment 9):
 *   three paths delete a `files` row outright, and a page row that went with it would leave its
 *   object in storage. So a page outlives its source until `deleteRenditionsForFilesInTx` discards
 *   it, or the C16 pass finds it without a source, and the pass deletes its object, then the row.
 * - `case_exports` (`cexp_`, C138.1): the creating principal's (P26), its request sealed
 *   (`case_exports.request#<id>`, because a search can name a field's value) until it finishes, its
 *   file in storage while it is kept, 24 hours.
 *
 * Plaintext by decision (C143.5): types, sizes, digests, statuses, providers, counts, codes, page
 * geometry, ids and timestamps. Their forms are listed in `docs/tdd/phase8-foundation-8b.tdd.md`.
 */
import {
  CASE_ATTACHMENT_MEDIA_TYPES,
  CASE_ATTACHMENT_SCAN_PROVIDERS,
  CASE_ATTACHMENT_SCAN_STATUSES,
  CASE_EXPORT_FORMATS,
  CASE_EXPORT_STATUSES,
  CASE_LIMITS,
  CASE_RENDITION_MEDIA_TYPES,
  CASE_RENDITION_STATUSES,
  type CaseAttachmentScanProvider,
  type CaseAttachmentScanStatus,
  type CaseExportFormat,
  type CaseExportStatus,
  type CaseRenditionMediaType,
  type CaseRenditionStatus,
} from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { idPattern } from '../ids.js';
import { sealedColumn } from '../sealed.js';
import { cases } from './cases.js';
import { createdAt, hexDigest, idFormat, oneOf, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';
import { files } from './verifications.js';

const limit = (name: keyof typeof CASE_LIMITS) => sql.raw(String(CASE_LIMITS[name].value));

/** `encryptBytes`' wrapped data key, as `files.wrapped_dek` reads. */
const wrappedDekFormat = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`${column} is null or ${column} ~ '^ov1\\.[A-Za-z0-9_-]{11}\\.[A-Za-z0-9_-]{80}$'`,
  );

/** C135.2: who uploaded an attachment (a user, a key, or a run through `PATCH /cases/:id`). */
export const CASE_ATTACHMENT_UPLOADER_TYPES = ['user', 'api-key', 'workflow-run'] as const;
export type CaseAttachmentUploaderType = (typeof CASE_ATTACHMENT_UPLOADER_TYPES)[number];

/** C138.1 (P26): who created an export; a run never exports. */
export const CASE_EXPORT_CREATOR_TYPES = ['user', 'api-key'] as const;
export type CaseExportCreatorType = (typeof CASE_EXPORT_CREATOR_TYPES)[number];

/** The state of an inquiry file's rendition (C135.3); `deleted` once its source is redacted. */
export type FileRenditionStatus = CaseRenditionStatus;

/** An actor pair whose two columns are required: its type from `types`, its id with the prefix. */
function creatorChecks(
  table: string,
  name: string,
  typeColumn: AnyPgColumn,
  idColumn: AnyPgColumn,
  prefixes: Readonly<Record<string, 'usr' | 'key' | 'wfr'>>,
) {
  return [
    check(`${table}_${name}_type_valid`, oneOf(typeColumn, Object.keys(prefixes))),
    check(
      `${table}_${name}_id_format`,
      sql.join(
        Object.entries(prefixes).map(
          ([type, prefix]) =>
            sql`(${typeColumn} is distinct from ${sql.raw(`'${type}'`)}
              or ${idColumn} ~ ${sql.raw(`'${idPattern(prefix)}'`)})`,
        ),
        sql`
      and `,
      ),
    ),
  ];
}

/** C135.2: one attachment of a case. */
export const caseAttachments = pgTable(
  'case_attachments',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    caseId: text('case_id').notNull(),
    /** Sniffed from the magic bytes, never the client's word: JPEG, PNG, WebP or PDF. */
    mimeType: text('mime_type').notNull(),
    /** Plaintext size in bytes, at most 10 MiB; kept after redaction (P34). */
    byteSize: integer('byte_size').notNull(),
    /** PII, sealed for the row; `null` once redacted (P34). */
    originalFilenameSealed: sealedColumn('original_filename'),
    /** SHA-256 of the plaintext, lowercase hex; `null` once redacted (P34). */
    sha256: text('sha256'),
    /** S3 object key of the ciphertext; `null` once the object is deleted. */
    storageKey: text('storage_key'),
    /** `ov1.<kid>.<wrapped DEK>` from `encryptBytes`; `null` once the object is deleted. */
    wrappedDek: text('wrapped_dek'),
    uploaderType: text('uploader_type').$type<CaseAttachmentUploaderType>().notNull(),
    uploaderId: text('uploader_id').notNull(),
    /** C135.5: `not_scanned` with no scanner bound, else `pending` until the scan job answers. */
    scanStatus: text('scan_status').$type<CaseAttachmentScanStatus>().notNull(),
    scanProvider: text('scan_provider').$type<CaseAttachmentScanProvider>(),
    scannedAt: timestamptz('scanned_at'),
    /** C135.5: an `error` is retried up to 3 times, then stays `error`. */
    scanAttempts: integer('scan_attempts').notNull().default(0),
    /** C135.3: made on the `case-rendition` queue at upload. */
    renditionStatus: text('rendition_status')
      .$type<CaseRenditionStatus>()
      .notNull()
      .default('pending'),
    renditionPageCount: integer('rendition_page_count'),
    /** A PDF of more than 20 pages is rendered up to 20 and marked so (Stage 1a amendment 43). */
    renditionTruncated: boolean('rendition_truncated').notNull().default(false),
    /** A rendition vision could not make: its code (`rendition_unavailable`). */
    renditionErrorCode: text('rendition_error_code'),
    renditionAttempts: integer('rendition_attempts').notNull().default(0),
    renderedAt: timestamptz('rendered_at'),
    redactedAt: timestamptz('redacted_at'),
    /** The object (and every rendition page) was deleted from storage. */
    deletedAt: timestamptz('deleted_at'),
    /** C251.1 (Workflow 11B Stage 1b (P)): when the queue's cap admitted this row's job; `null` while held. */
    scanAdmittedAt: timestamptz('scan_admitted_at'),
    /** C251.1 (Workflow 11B Stage 1b (P)): when the queue's cap admitted this row's job; `null` while held. */
    renditionAdmittedAt: timestamptz('rendition_admitted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'case_attachments_case_fk',
      columns: [table.environmentId, table.caseId],
      foreignColumns: [cases.environmentId, cases.id],
    }).onDelete('cascade'),
    unique('case_attachments_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('case_attachments_storage_key_key').on(table.storageKey),
    // A case's attachments in upload order (C135.2's cap of 20 counts them).
    index('case_attachments_case_created_at_idx').on(
      table.environmentId,
      table.caseId,
      table.createdAt,
      table.id,
    ),
    // C135.5: the scans the `case-attachment-scan` job still owes, oldest first.
    index('case_attachments_scan_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.scanStatus} = 'pending'`),
    // K8-28 (Workflow 8D, migration 0029): the renditions left pending, which `case-export-sweep`
    // enqueues again, oldest change first.
    index('case_attachments_rendition_pending_idx')
      .on(table.updatedAt)
      .where(sql`${table.renditionStatus} = 'pending' and ${table.redactedAt} is null`),
    // C139.1, C16: the objects a redaction could not delete, for the leftover pass.
    index('case_attachments_undeleted_redacted_idx')
      .on(table.redactedAt)
      .where(sql`${table.redactedAt} is not null and ${table.deletedAt} is null`),
    idFormat('case_attachments', table.id, 'catt'),
    check(
      'case_attachments_mime_type_valid',
      oneOf(table.mimeType, Object.values(CASE_ATTACHMENT_MEDIA_TYPES)),
    ),
    check(
      'case_attachments_byte_size_range',
      sql`${table.byteSize} between 1 and ${limit('attachment-bytes')}`,
    ),
    hexDigest('case_attachments_sha256_hex', table.sha256),
    check(
      'case_attachments_filename_until_redacted',
      sql`${table.originalFilenameSealed} is not null or ${table.redactedAt} is not null`,
    ),
    check(
      'case_attachments_sha256_until_redacted',
      sql`${table.sha256} is not null or ${table.redactedAt} is not null`,
    ),
    // The object's key and its wrapped data key go together, exactly when the object is gone.
    check(
      'case_attachments_object_until_deleted',
      sql`(${table.storageKey} is null) = (${table.deletedAt} is not null)
        and (${table.wrappedDek} is null) = (${table.deletedAt} is not null)`,
    ),
    check(
      'case_attachments_deleted_after_redaction',
      sql`${table.deletedAt} is null or ${table.redactedAt} is not null`,
    ),
    wrappedDekFormat('case_attachments_wrapped_dek_format', table.wrappedDek),
    ...creatorChecks('case_attachments', 'uploader', table.uploaderType, table.uploaderId, {
      user: 'usr',
      'api-key': 'key',
      'workflow-run': 'wfr',
    }),
    check(
      'case_attachments_scan_status_valid',
      oneOf(table.scanStatus, CASE_ATTACHMENT_SCAN_STATUSES),
    ),
    check(
      'case_attachments_scan_provider_valid',
      sql`${table.scanProvider} is null or ${oneOf(table.scanProvider, CASE_ATTACHMENT_SCAN_PROVIDERS)}`,
    ),
    // H20: a scan names its provider, and an attachment not scanned names none.
    check(
      'case_attachments_scan_provider_with_status',
      sql`(${table.scanStatus} = 'not_scanned') = (${table.scanProvider} is null)`,
    ),
    // A verdict has the time it was given, and nothing else but an error does.
    check(
      'case_attachments_scanned_at_with_verdict',
      sql`${table.scanStatus} = 'error'
        or (${table.scanStatus} in ('clean', 'infected')) = (${table.scannedAt} is not null)`,
    ),
    check(
      'case_attachments_scan_attempts_range',
      sql`${table.scanAttempts} between 0 and ${limit('scan-attempts')}`,
    ),
    check(
      'case_attachments_rendition_status_valid',
      oneOf(table.renditionStatus, CASE_RENDITION_STATUSES),
    ),
    check(
      'case_attachments_rendition_pages_when_ready',
      sql`(${table.renditionStatus} = 'ready') = (${table.renditionPageCount} is not null)`,
    ),
    check(
      'case_attachments_rendition_page_count_range',
      sql`${table.renditionPageCount} is null
        or ${table.renditionPageCount} between 1 and ${limit('rendition-pages')}`,
    ),
    check('case_attachments_rendition_attempts_non_negative', sql`${table.renditionAttempts} >= 0`),
  ],
);

/** C135.3: the rendition of an inquiry's file, made on first request or at processing. */
export const fileRenditions = pgTable(
  'file_renditions',
  {
    fileId: text('file_id').primaryKey(),
    environmentId: environmentId(),
    status: text('status').$type<FileRenditionStatus>().notNull().default('pending'),
    pageCount: integer('page_count'),
    truncated: boolean('truncated').notNull().default(false),
    /** A rendition vision could not make: its code (`rendition_unavailable`). */
    errorCode: text('error_code'),
    attempts: integer('attempts').notNull().default(0),
    renderedAt: timestamptz('rendered_at'),
    /** C251.1 (Workflow 11B Stage 1b (P)): when the queue's cap admitted this row's job; `null` while held. */
    admittedAt: timestamptz('admitted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // C135.3: the foreign key on `files(id)`. The state goes with its file; its pages do not
    // (`rendition_pages`), so their objects are still found.
    foreignKey({
      name: 'file_renditions_file_fk',
      columns: [table.fileId],
      foreignColumns: [files.id],
    }).onDelete('cascade'),
    index('file_renditions_environment_id_idx').on(table.environmentId),
    // K8-28 (Workflow 8D, migration 0029): the renditions left pending, enqueued again by the sweep.
    index('file_renditions_pending_idx')
      .on(table.updatedAt)
      .where(sql`${table.status} = 'pending'`),
    idFormat('file_renditions', table.fileId, 'file'),
    check('file_renditions_status_valid', oneOf(table.status, CASE_RENDITION_STATUSES)),
    check(
      'file_renditions_pages_when_ready',
      sql`(${table.status} = 'ready') = (${table.pageCount} is not null)
        and (${table.status} = 'ready') = (${table.renderedAt} is not null)`,
    ),
    check(
      'file_renditions_page_count_range',
      sql`${table.pageCount} is null or ${table.pageCount} between 1 and ${limit('rendition-pages')}`,
    ),
    check(
      'file_renditions_error_when_failed',
      sql`(${table.status} = 'failed') = (${table.errorCode} is not null)`,
    ),
    check('file_renditions_attempts_non_negative', sql`${table.attempts} >= 0`),
  ],
);

/** C135.3: one sealed page image of a rendition, a file's or an attachment's. */
export const renditionPages = pgTable(
  'rendition_pages',
  {
    /** `<source id>/<page>`: a rendition has no id prefix of its own (Stage 1a amendment 42). */
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    /** The `file_` or `catt_` id it renders; no foreign key, by decision (see the header). */
    sourceId: text('source_id').notNull(),
    page: integer('page').notNull(),
    mediaType: text('media_type').$type<CaseRenditionMediaType>().notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size').notNull(),
    /** S3 object key of the ciphertext. */
    storageKey: text('storage_key').notNull(),
    /** `ov1.<kid>.<wrapped DEK>` from `encryptBytes`. */
    wrappedDek: text('wrapped_dek').notNull(),
    /** Discarded with its source: no longer served, its object left for the C16 pass to delete. */
    discardedAt: timestamptz('discarded_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('rendition_pages_storage_key_key').on(table.storageKey),
    index('rendition_pages_source_idx').on(table.environmentId, table.sourceId),
    index('rendition_pages_discarded_idx')
      .on(table.discardedAt)
      .where(sql`${table.discardedAt} is not null`),
    check(
      'rendition_pages_source_id_format',
      sql`${table.sourceId} ~ ${sql.raw(`'${idPattern('file')}'`)}
        or ${table.sourceId} ~ ${sql.raw(`'${idPattern('catt')}'`)}`,
    ),
    check(
      'rendition_pages_id_format',
      sql`${table.id} = ${table.sourceId} || '/' || ${table.page}`,
    ),
    check(
      'rendition_pages_page_range',
      sql`${table.page} between 1 and ${limit('rendition-pages')}`,
    ),
    check('rendition_pages_media_type_valid', oneOf(table.mediaType, CASE_RENDITION_MEDIA_TYPES)),
    check(
      'rendition_pages_size_range',
      sql`${table.width} between 1 and ${limit('rendition-image-side-px')}
        and ${table.height} between 1 and ${limit('rendition-image-side-px')}
        and ${table.byteSize} between 1 and ${limit('rendition-bytes')}`,
    ),
    wrappedDekFormat('rendition_pages_wrapped_dek_format', table.wrappedDek),
  ],
);

/** C138.1: an asynchronous export of a creator's cases. */
export const caseExports = pgTable(
  'case_exports',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    creatorType: text('creator_type').$type<CaseExportCreatorType>().notNull(),
    creatorId: text('creator_id').notNull(),
    format: text('format').$type<CaseExportFormat>().notNull(),
    includePersonalData: boolean('include_personal_data').notNull().default(false),
    status: text('status').$type<CaseExportStatus>().notNull().default('pending'),
    /** The filter or search, sealed for the row; `null` once the export finished (P19). */
    requestSealed: sealedColumn('request'),
    caseCount: integer('case_count'),
    byteSize: integer('byte_size'),
    /** A failure's problem code, such as `export_too_large`; nothing else. */
    errorCode: text('error_code'),
    /** S3 object key of the file's ciphertext, while it is kept. */
    storageKey: text('storage_key'),
    /** `ov1.<kid>.<wrapped DEK>` from `encryptBytes`, while the file is kept. */
    wrappedDek: text('wrapped_dek'),
    completedAt: timestamptz('completed_at'),
    /** When the file is deleted: 24 hours after it completed (decision 69). */
    expiresAt: timestamptz('expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('case_exports_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('case_exports_storage_key_key').on(table.storageKey),
    // P26: `GET /case-exports` lists the caller's own, newest first.
    index('case_exports_creator_created_at_idx').on(
      table.environmentId,
      table.creatorType,
      table.creatorId,
      table.createdAt,
      table.id,
    ),
    // C143.1: `case-export-sweep` deletes the files that expired.
    index('case_exports_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'completed'`),
    // The exports the `case-export` job still owes, oldest first.
    index('case_exports_unfinished_idx')
      .on(table.createdAt)
      .where(sql`${table.status} in ('pending', 'running')`),
    idFormat('case_exports', table.id, 'cexp'),
    ...creatorChecks('case_exports', 'creator', table.creatorType, table.creatorId, {
      user: 'usr',
      'api-key': 'key',
    }),
    check('case_exports_format_valid', oneOf(table.format, CASE_EXPORT_FORMATS)),
    check('case_exports_status_valid', oneOf(table.status, CASE_EXPORT_STATUSES)),
    check(
      'case_exports_request_until_finished',
      sql`${table.requestSealed} is not null or ${table.status} in ('completed', 'failed', 'expired')`,
    ),
    check(
      'case_exports_finished_with_times',
      sql`(${table.status} in ('completed', 'expired')) = (${table.completedAt} is not null
        and ${table.expiresAt} is not null and ${table.caseCount} is not null)`,
    ),
    // The file, its key and its size exactly while it is kept.
    check(
      'case_exports_file_while_completed',
      sql`(${table.status} = 'completed') = (${table.storageKey} is not null)
        and (${table.storageKey} is null) = (${table.wrappedDek} is null)
        and (${table.status} <> 'completed' or ${table.byteSize} is not null)`,
    ),
    check(
      'case_exports_error_when_failed',
      sql`(${table.status} = 'failed') = (${table.errorCode} is not null)`,
    ),
    check(
      'case_exports_counts',
      sql`(${table.caseCount} is null or ${table.caseCount} between 0 and ${limit('export-cases')})
        and (${table.byteSize} is null or ${table.byteSize} >= 0)`,
    ),
    wrappedDekFormat('case_exports_wrapped_dek_format', table.wrappedDek),
  ],
);

export type CaseAttachmentRow = typeof caseAttachments.$inferSelect;
export type FileRenditionRow = typeof fileRenditions.$inferSelect;
export type RenditionPageRow = typeof renditionPages.$inferSelect;
export type CaseExportRow = typeof caseExports.$inferSelect;
