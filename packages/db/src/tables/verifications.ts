/** Verifications, their check results, and the encrypted files they were run on. */
import {
  FILE_CAPTURE_METHODS,
  FILE_CAPTURE_TRIGGERS,
  type CheckProvenance,
  type CheckStage,
  type FileCaptureMethod,
  type FileCaptureTrigger,
} from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  hexDigest,
  idFormat,
  oneOf,
  timestamptz,
  updatedAt,
  workflowRunStepId,
  workflowRunStepKey,
} from './columns.js';
import {
  checkRequirement,
  checkStatus,
  checkType,
  fileKind,
  idClass,
  verificationStatus,
  verificationType,
} from './enums.js';
import { inquiries, inquirySessions } from './inquiries.js';
import { selfieCaptures } from './selfie.js';
import { environmentId } from './environment-id.js';
import { connectProvenanceColumn, provenanceKindValid } from './connect-columns.js';

/** A user retry creates a new verification (C7), so an inquiry can have several per type. */
export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    type: verificationType('type').notNull(),
    status: verificationStatus('status').notNull().default('initiated'),
    /** ISO 3166-1 alpha-2, for government ID verifications. */
    country: text('country'),
    idClass: idClass('id_class'),
    submittedAt: timestamptz('submitted_at'),
    /** When the verification reached `passed`, `failed` or `needs_review`. */
    completedAt: timestamptz('completed_at'),
    /**
     * C40.7: a selfie verification created since Phase 4 needs a capture to be submitted. The
     * migration set it false for the rows that existed before (they are evaluated without one).
     */
    selfieCaptureRequired: boolean('selfie_capture_required').notNull().default(true),
    /**
     * C91.1 (Workflow 7A, V02): the flow session that created the attempt; `null` for one the
     * server created and for rows from before Phase 7.
     */
    createdBySessionId: text('created_by_session_id'),
    /**
     * C96.3 (V02, ours): created by a phone session the desktop rejected ("this was not me") after
     * it was submitted; excluded from list probes, graph indexing and the signals.
     */
    fromRejectedHandoff: boolean('from_rejected_handoff').notNull().default(false),
    /** C117.5: the run's step that created it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    /** C230.5, C235.1 (Workflow 11A): a copy's Connect provenance; `null` on every row not copied. */
    provenance: connectProvenanceColumn(),
    /** C251.1 (Workflow 11B Stage 1b (P)): when the queue's cap admitted this row's job; `null` while held. */
    admittedAt: timestamptz('admitted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    provenanceKindValid('verifications_provenance_kind_valid', table.provenance),
    ...workflowRunStepKey('verifications', table.environmentId, table.workflowRunStepId),
    foreignKey({
      name: 'verifications_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    // V02 (Workflow 7A): a rejection finds the verifications its phone session created.
    foreignKey({
      name: 'verifications_created_by_session_fk',
      columns: [table.environmentId, table.createdBySessionId],
      foreignColumns: [inquirySessions.environmentId, inquirySessions.id],
    }),
    unique('verifications_environment_id_id_key').on(table.environmentId, table.id),
    index('verifications_environment_id_inquiry_id_created_at_idx').on(
      table.environmentId,
      table.inquiryId,
      table.createdAt,
    ),
    // Workflow 5C review K1: the repair sweep reads submitted verifications by submission time.
    index('verifications_submitted_at_idx')
      .on(table.submittedAt)
      .where(sql`${table.status} = 'submitted'`),
    // C163.4 (Workflow 9B Stage 1b (A), B2): the analytics rollup's dirty-day scan.
    index('verifications_environment_id_updated_at_idx').on(table.environmentId, table.updatedAt),
    check('verifications_country_iso2', sql`${table.country} ~ '^[A-Z]{2}$'`),
    idFormat('verifications', table.id, 'ver'),
  ],
);

/**
 * One row per check and verification (C2 `checks: [{ name, status, reasons, requirement,
 * metadata }]`). `reasons` are snake_case codes. `metadata` holds scores and flags only:
 * never PII, and never biometric embeddings, which Phase 1 does not persist (C6).
 */
export const verificationChecks = pgTable(
  'verification_checks',
  {
    environmentId: environmentId(),
    verificationId: text('verification_id').notNull(),
    name: text('name').notNull(),
    status: checkStatus('status').notNull(),
    type: checkType('type').notNull(),
    requirement: checkRequirement('requirement').notNull(),
    reasons: text('reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    /**
     * C29.2: the registry stage when the result was written (`ga`, `beta`, `sunset`). `null` for
     * rows written before Phase 3; the API then serves the registry's current stage.
     */
    stage: text('stage').$type<CheckStage>(),
    /** C29.2: in [0, 1], or `null`. Double precision, so a confidence reads back exactly. */
    confidence: doublePrecision('confidence'),
    /** C29.2: implementation version, models, provider and thresholds; `null` before Phase 3. */
    provenance: jsonb('provenance').$type<CheckProvenance>(),
    /**
     * C230.5, C235.2 (Workflow 11A): a cloned check's Connect provenance, beside ADR 0002's
     * `provenance` (which keeps the source's labels); `null` on every check not copied.
     */
    connectProvenance: connectProvenanceColumn('connect_provenance'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    provenanceKindValid(
      'verification_checks_connect_provenance_kind_valid',
      table.connectProvenance,
    ),
    primaryKey({ name: 'verification_checks_pkey', columns: [table.verificationId, table.name] }),
    // C163.4 (Workflow 9B Stage 1b (A), B2): the analytics rollup's dirty-day scan.
    index('verification_checks_environment_id_updated_at_idx').on(
      table.environmentId,
      table.updatedAt,
    ),
    check(
      'verification_checks_stage_valid',
      sql`${table.stage} is null or ${table.stage} in ('ga', 'beta', 'sunset')`,
    ),
    check(
      'verification_checks_confidence_unit_interval',
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
    foreignKey({
      name: 'verification_checks_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    check(
      'verification_checks_name_snake_case',
      sql`${table.name} ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'`,
    ),
  ],
);

/**
 * Uploaded images. The bytes live in S3-compatible storage as `encryptBytes` ciphertext
 * under `storage_key`; this row keeps the wrapped DEK needed to decrypt them, plus the
 * plaintext's size and SHA-256 for integrity checks after decryption.
 */
export const files = pgTable(
  'files',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    verificationId: text('verification_id').notNull(),
    kind: fileKind('kind').notNull(),
    /** S3 object key of the ciphertext. */
    storageKey: text('storage_key').notNull(),
    /** Sniffed from magic bytes, never taken from the client (C3). */
    mimeType: text('mime_type').notNull(),
    /** Plaintext size in bytes. */
    byteSize: integer('byte_size').notNull(),
    /** SHA-256 of the plaintext, lowercase hex. */
    sha256: text('sha256').notNull(),
    /** `ov1.<kid>.<wrapped DEK>` from `encryptBytes`. */
    wrappedDek: text('wrapped_dek').notNull(),
    /** C16: the object was deleted from storage by redaction; the content answers 410. */
    deletedAt: timestamptz('deleted_at'),
    /** C40.3: the capture a selfie pose was uploaded under; `null` for other kinds. */
    selfieCaptureId: text('selfie_capture_id'),
    /** C40.3: the client's milliseconds since the capture was created (0-600,000). */
    clientElapsedMs: integer('client_elapsed_ms'),
    /** C40.3: the server clock inside the write transaction. */
    receivedAt: timestamptz('received_at'),
    /**
     * C153.2 (Workflow 9A Stage 1b (F)): how the file was captured, as the upload named it;
     * `null` when the client did not say (every client before Phase 9).
     */
    captureMethod: text('capture_method').$type<FileCaptureMethod>(),
    /**
     * C206.2 (Workflow 10B Stage 1b (C)): whether the shutter or the auto-capture took the photo, as
     * the upload named it; client-reported, `null` when the client did not say.
     */
    captureTrigger: text('capture_trigger').$type<FileCaptureTrigger>(),
    /** C230.5, C235.1 (Workflow 11A): a copy's Connect provenance; `null` on every row not copied. */
    provenance: connectProvenanceColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    provenanceKindValid('files_provenance_kind_valid', table.provenance),
    foreignKey({
      name: 'files_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    // C40.3: a pose file belongs to its capture; a superseded capture's files are deleted with it.
    foreignKey({
      name: 'files_selfie_capture_fk',
      columns: [table.environmentId, table.selfieCaptureId],
      foreignColumns: [selfieCaptures.environmentId, selfieCaptures.id],
    }).onDelete('cascade'),
    uniqueIndex('files_storage_key_key').on(table.storageKey),
    index('files_environment_id_verification_id_idx').on(table.environmentId, table.verificationId),
    // One file per kind: a re-upload replaces the earlier file (`replaceVerificationFile`).
    uniqueIndex('files_environment_id_verification_id_kind_key').on(
      table.environmentId,
      table.verificationId,
      table.kind,
    ),
    check('files_byte_size_non_negative', sql`${table.byteSize} >= 0`),
    // C43: replay detection looks files up by their SHA-256 within an environment.
    index('files_environment_id_sha256_idx').on(table.environmentId, table.sha256),
    check(
      'files_client_elapsed_ms_range',
      sql`${table.clientElapsedMs} is null or (${table.clientElapsedMs} >= 0 and ${table.clientElapsedMs} <= 600000)`,
    ),
    check(
      'files_capture_method_valid',
      sql`${table.captureMethod} is null or ${oneOf(table.captureMethod, FILE_CAPTURE_METHODS)}`,
    ),
    check(
      'files_capture_trigger_valid',
      sql`${table.captureTrigger} is null or ${oneOf(table.captureTrigger, FILE_CAPTURE_TRIGGERS)}`,
    ),
    check('files_mime_type_format', sql`${table.mimeType} ~ '^[a-z]+/[a-z0-9.+-]+$'`),
    hexDigest('files_sha256_hex', table.sha256),
    check(
      'files_wrapped_dek_format',
      sql`${table.wrappedDek} ~ '^ov1\\.[A-Za-z0-9_-]{11}\\.[A-Za-z0-9_-]{80}$'`,
    ),
    idFormat('files', table.id, 'file'),
  ],
);

export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
export type VerificationCheck = typeof verificationChecks.$inferSelect;
export type NewVerificationCheck = typeof verificationChecks.$inferInsert;
export type StoredFile = typeof files.$inferSelect;
export type NewStoredFile = typeof files.$inferInsert;
