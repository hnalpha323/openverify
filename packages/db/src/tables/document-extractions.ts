/**
 * C53.3, C60: the extraction of one document verification. The extracted values are sealed to
 * the row (`document_extractions.fields#<verification id>`); the class, its confidence, the page
 * count and the media type are not personal data.
 */
import { DOCUMENT_TYPES } from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, timestamptz } from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';
import { verifications } from './verifications.js';

/** C60.5: the document classes, and what the classifier answers when none is established. */
export const DOCUMENT_CLASSIFICATION_VALUES = [...DOCUMENT_TYPES, 'other', 'unknown'] as const;

/** C52.4: the media types a document may be. */
export const DOCUMENT_MIME_TYPE_VALUES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const documentExtractions = pgTable(
  'document_extractions',
  {
    environmentId: environmentId(),
    /** One extraction per verification; also the row id the values are sealed to. */
    verificationId: text('verification_id').primaryKey(),
    inquiryId: text('inquiry_id').notNull(),
    documentType: text('document_type')
      .$type<(typeof DOCUMENT_CLASSIFICATION_VALUES)[number]>()
      .notNull(),
    /** The top class probability, uncalibrated (C60.6); `null` when not classified. */
    typeConfidence: doublePrecision('type_confidence'),
    /** The C52.8 `fields` (attribute names), sealed; `null` once redacted. */
    fieldsSealed: sealedColumn('fields'),
    pageCount: smallint('page_count').notNull(),
    mimeType: text('mime_type').$type<(typeof DOCUMENT_MIME_TYPE_VALUES)[number]>().notNull(),
    createdAt: createdAt(),
    redactedAt: timestamptz('redacted_at'),
  },
  (table) => [
    foreignKey({
      name: 'document_extractions_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'document_extractions_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    unique('document_extractions_environment_id_verification_id_key').on(
      table.environmentId,
      table.verificationId,
    ),
    index('document_extractions_environment_id_inquiry_id_idx').on(
      table.environmentId,
      table.inquiryId,
    ),
    check(
      'document_extractions_document_type_valid',
      sql`${table.documentType} in (${listed(DOCUMENT_CLASSIFICATION_VALUES)})`,
    ),
    check(
      'document_extractions_type_confidence_unit_interval',
      sql`${table.typeConfidence} between 0 and 1`,
    ),
    check('document_extractions_page_count_range', sql`${table.pageCount} between 1 and 50`),
    check(
      'document_extractions_mime_type_valid',
      sql`${table.mimeType} in (${listed(DOCUMENT_MIME_TYPE_VALUES)})`,
    ),
  ],
);

export type DocumentExtractionRow = typeof documentExtractions.$inferSelect;
