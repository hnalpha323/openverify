/**
 * Phase 4 selfie storage: the capture sessions (C40.5), the sealed face templates (C42.1) and
 * the background layouts (C42.5). Every value that can identify a person is sealed to its row
 * (`sealed.ts`): the device snapshot of a capture and the face template.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  doublePrecision,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, idColumnFormat, idFormat, timestamptz } from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries, inquirySessions } from './inquiries.js';
import { verifications } from './verifications.js';

/** `bytea` read and written as a `Buffer`. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** The C40.1 statuses, methods and error codes, as stored. */
export const SELFIE_CAPTURE_STATUS_VALUES = [
  'initiated',
  'submitted',
  'processed',
  'errored',
] as const;
export type StoredSelfieCaptureStatus = (typeof SELFIE_CAPTURE_STATUS_VALUES)[number];
const ERROR_CODES = ['superseded', 'expired', 'canceled', 'processing_failed'] as const;
export type StoredSelfieCaptureErrorCode = (typeof ERROR_CODES)[number];
export type StoredSelfiePose = 'center' | 'left' | 'right';

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/** C40.5: one camera or upload session of a selfie verification. */
export const selfieCaptures = pgTable(
  'selfie_captures',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    verificationId: text('verification_id').notNull(),
    inquiryId: text('inquiry_id').notNull(),
    status: text('status').$type<StoredSelfieCaptureStatus>().notNull().default('initiated'),
    method: text('method').$type<'camera' | 'upload'>().notNull(),
    liveness: text('liveness').$type<'passive' | 'active'>().notNull(),
    /** The ordered pose prompts, `center` first. */
    prompts: jsonb('prompts').$type<StoredSelfiePose[]>().notNull(),
    /** SHA-256 of the nonce; the nonce itself is returned once and never stored. */
    nonceSha256: bytea('nonce_sha256').notNull(),
    /** The C40.4 device snapshot, sealed with context `selfie_captures.device#<id>`. */
    deviceSealed: sealedColumn('device'),
    createdAt: createdAt(),
    expiresAt: timestamptz('expires_at').notNull(),
    submittedAt: timestamptz('submitted_at'),
    processedAt: timestamptz('processed_at'),
    errorCode: text('error_code').$type<StoredSelfieCaptureErrorCode>(),
    redactedAt: timestamptz('redacted_at'),
    /**
     * C94.6 (Workflow 7A, V02, V03): the flow session that created the capture, whose effective
     * consent the matching gate reads (`getEffectiveConsent`); `null` before Phase 7.
     */
    createdBySessionId: text('created_by_session_id'),
  },
  (table) => [
    foreignKey({
      name: 'selfie_captures_created_by_session_fk',
      columns: [table.environmentId, table.createdBySessionId],
      foreignColumns: [inquirySessions.environmentId, inquirySessions.id],
    }),
    foreignKey({
      name: 'selfie_captures_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'selfie_captures_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    unique('selfie_captures_environment_id_id_key').on(table.environmentId, table.id),
    // Newest first per verification (the selfies relationship, the cap, the newest submitted).
    index('selfie_captures_environment_id_verification_id_created_at_idx').on(
      table.environmentId,
      table.verificationId,
      table.createdAt.desc().nullsFirst(),
    ),
    index('selfie_captures_environment_id_inquiry_id_idx').on(table.environmentId, table.inquiryId),
    // C40.2: at most one open capture per verification (a create supersedes the previous one).
    uniqueIndex('selfie_captures_one_initiated_per_verification_key')
      .on(table.environmentId, table.verificationId)
      .where(sql`${table.status} = 'initiated'`),
    check(
      'selfie_captures_status_valid',
      sql`${table.status} in (${listed(SELFIE_CAPTURE_STATUS_VALUES)})`,
    ),
    check('selfie_captures_method_valid', sql`${table.method} in ('camera', 'upload')`),
    check('selfie_captures_liveness_valid', sql`${table.liveness} in ('passive', 'active')`),
    check(
      'selfie_captures_error_code_valid',
      sql`${table.errorCode} is null or ${table.errorCode} in (${listed(ERROR_CODES)})`,
    ),
    check(
      'selfie_captures_error_code_iff_errored',
      sql`(${table.status} = 'errored') = (${table.errorCode} is not null)`,
    ),
    check('selfie_captures_nonce_sha256_length', sql`octet_length(${table.nonceSha256}) = 32`),
    check('selfie_captures_prompts_array', sql`jsonb_typeof(${table.prompts}) = 'array'`),
    idFormat('selfie_captures', table.id, 'self'),
  ],
);

/**
 * C42.1: the L2-normalised SFace embedding of a passed selfie with matching consent, as base64
 * float32, sealed with context `face_templates.template#<id>`. Biometric data: deleted with its
 * inquiry's redaction, an operator decline or a failed inquiry, and after
 * `face-template-retention-days`.
 */
export const faceTemplates = pgTable(
  'face_templates',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    verificationId: text('verification_id').notNull(),
    inquiryId: text('inquiry_id').notNull(),
    source: text('source').$type<'selfie'>().notNull().default('selfie'),
    model: text('model').notNull(),
    templateSealed: sealedColumn('template').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'face_templates_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'face_templates_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    unique('face_templates_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('face_templates_verification_id_key').on(table.verificationId),
    // C42.4: the scan reads an environment's templates newest first.
    index('face_templates_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('face_templates_environment_id_inquiry_id_idx').on(table.environmentId, table.inquiryId),
    check('face_templates_source_valid', sql`${table.source} in ('selfie')`),
    idFormat('face_templates', table.id, 'ftpl'),
  ],
);

/** The number of values in a background layout: 48 cells x mean Lab (research §8). */
export const BACKGROUND_LAYOUT_DIMENSIONS = 144;

/**
 * C42.5: the centre's background layout, written with its face template. Not biometric, but
 * personal data: environment-scoped, redacted and retained with its template.
 */
export const selfieBackgrounds = pgTable(
  'selfie_backgrounds',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    verificationId: text('verification_id').notNull(),
    inquiryId: text('inquiry_id').notNull(),
    faceTemplateId: text('face_template_id').notNull(),
    layout: vector('layout', { dimensions: BACKGROUND_LAYOUT_DIMENSIONS }).notNull(),
    validCells: text('valid_cells').notNull(),
    coverage: doublePrecision('coverage').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'selfie_backgrounds_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'selfie_backgrounds_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'selfie_backgrounds_face_template_fk',
      columns: [table.environmentId, table.faceTemplateId],
      foreignColumns: [faceTemplates.environmentId, faceTemplates.id],
    }).onDelete('cascade'),
    uniqueIndex('selfie_backgrounds_verification_id_key').on(table.verificationId),
    index('selfie_backgrounds_environment_id_created_at_idx').on(
      table.environmentId,
      table.createdAt,
    ),
    index('selfie_backgrounds_layout_hnsw_idx').using('hnsw', table.layout.op('vector_l2_ops')),
    check('selfie_backgrounds_valid_cells_format', sql`${table.validCells} ~ '^[01]{48}$'`),
    check(
      'selfie_backgrounds_coverage_unit_interval',
      sql`${table.coverage} >= 0 and ${table.coverage} <= 1`,
    ),
    idFormat('selfie_backgrounds', table.id, 'sbg'),
    idColumnFormat('selfie_backgrounds_face_template_id_format', table.faceTemplateId, 'ftpl'),
  ],
);

export type SelfieCaptureRow = typeof selfieCaptures.$inferSelect;
export type FaceTemplateRow = typeof faceTemplates.$inferSelect;
export type SelfieBackgroundRow = typeof selfieBackgrounds.$inferSelect;
