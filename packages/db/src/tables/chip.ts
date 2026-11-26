/**
 * C53.3, C62: the Active Authentication challenges of an NFC verification and what it read from
 * the chip once its integrity was established.
 *
 * - `chip_challenges`: only the nonce's SHA-256 is stored; the AA response and the device report
 *   are sealed to the row (`chip_challenges.<column>#<id>`) and cleared when processing ends.
 * - `chip_reads`: the DG1 fields and the SOD signature are sealed to the row
 *   (`chip_reads.<column>#<verification id>`, so `blind-index:rebuild` can recompute both
 *   indexes); DG2, the SOD itself and the portrait are files.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, hexDigest, idFormat, timestamptz } from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';
import { verifications } from './verifications.js';

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * C208.1 (Phase 10, Workflow 10C): the sandbox test chip's scenarios, as `@openverify/contracts`'
 * `SANDBOX_CHIP_SCENARIOS` names them (the API's `sandbox-chip-scenarios.test.ts` holds the two
 * lists together).
 */
export const CHIP_SANDBOX_SCENARIO_VALUES = [
  'match',
  'mrz-mismatch',
  'face-mismatch',
  'no-active-authentication',
  'tampered-dg1',
] as const;
export type ChipSandboxScenario = (typeof CHIP_SANDBOX_SCENARIO_VALUES)[number];

export const CHIP_CHALLENGE_STATUS_VALUES = [
  'initiated',
  'submitted',
  'processed',
  'expired',
  'superseded',
] as const;

export const CHIP_INTEGRITY_VALUES = ['established', 'broken', 'not_established'] as const;

export const chipChallenges = pgTable(
  'chip_challenges',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    verificationId: text('verification_id').notNull(),
    inquiryId: text('inquiry_id').notNull(),
    /** Lower-case hex SHA-256 of the 8 nonce bytes (C62.5). */
    nonceSha256: text('nonce_sha256').notNull(),
    status: text('status').$type<(typeof CHIP_CHALLENGE_STATUS_VALUES)[number]>().notNull(),
    aaResponseSealed: sealedColumn('aa_response'),
    deviceReportSealed: sealedColumn('device_report'),
    createdAt: createdAt(),
    expiresAt: timestamptz('expires_at').notNull(),
    submittedAt: timestamptz('submitted_at'),
    redactedAt: timestamptz('redacted_at'),
    /** C208.1 (Workflow 10C): the sandbox test chip's scenario the server built for this challenge. */
    sandboxScenario: text('sandbox_scenario').$type<ChipSandboxScenario>(),
  },
  (table) => [
    foreignKey({
      name: 'chip_challenges_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'chip_challenges_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    unique('chip_challenges_environment_id_id_key').on(table.environmentId, table.id),
    index('chip_challenges_environment_id_verification_id_created_at_idx').on(
      table.environmentId,
      table.verificationId,
      table.createdAt.desc().nullsFirst(),
    ),
    index('chip_challenges_environment_id_inquiry_id_idx').on(table.environmentId, table.inquiryId),
    // C62.5: a new challenge supersedes the open one.
    uniqueIndex('chip_challenges_one_initiated_per_verification_key')
      .on(table.environmentId, table.verificationId)
      .where(sql`${table.status} = 'initiated'`),
    check(
      'chip_challenges_status_valid',
      sql`${table.status} in (${listed(CHIP_CHALLENGE_STATUS_VALUES)})`,
    ),
    check(
      'chip_challenges_sandbox_scenario_valid',
      sql`${table.sandboxScenario} is null or ${table.sandboxScenario} in (${listed(CHIP_SANDBOX_SCENARIO_VALUES)})`,
    ),
    hexDigest('chip_challenges_nonce_sha256_hex', table.nonceSha256),
    idFormat('chip_challenges', table.id, 'chc'),
  ],
);

export type ChipChallengeRow = typeof chipChallenges.$inferSelect;

export const chipReads = pgTable(
  'chip_reads',
  {
    environmentId: environmentId(),
    /** One read per verification; also the row id the values are sealed to. */
    verificationId: text('verification_id').primaryKey(),
    inquiryId: text('inquiry_id').notNull(),
    /** DG1's fields only (C52.8 attribute names), sealed; `null` once redacted. */
    fieldsSealed: sealedColumn('fields'),
    /** The SOD signature value (base64), sealed; `null` once redacted. */
    sodSignatureSealed: sealedColumn('sod_signature'),
    /** `openverify/chip-sod/v1`: the C62.6 sighting key; `null` once redacted. */
    sodSignatureIndex: text('sod_signature_index'),
    /** `openverify/chip-document-number/v1`; `null` once redacted. */
    documentNumberIndex: text('document_number_index'),
    integrity: text('integrity').$type<(typeof CHIP_INTEGRITY_VALUES)[number]>().notNull(),
    /** Set in the decision transaction once the NFC selfie comparison passed (C62.6). */
    selfieBound: boolean('selfie_bound').notNull().default(false),
    /** DG1's issuing state, ICAO alpha-3 (`UTO`, `D<<`); `null` once redacted. */
    issuingCountry: text('issuing_country'),
    /** The non-PII Passive Authentication summary. */
    paSummary: jsonb('pa_summary').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    redactedAt: timestamptz('redacted_at'),
  },
  (table) => [
    foreignKey({
      name: 'chip_reads_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'chip_reads_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    unique('chip_reads_environment_id_verification_id_key').on(
      table.environmentId,
      table.verificationId,
    ),
    index('chip_reads_environment_id_inquiry_id_idx').on(table.environmentId, table.inquiryId),
    // C62.6: the sighting lookup reads selfie-bound reads of one SOD signature.
    index('chip_reads_environment_id_sod_signature_index_idx')
      .on(table.environmentId, table.sodSignatureIndex)
      .where(sql`${table.sodSignatureIndex} is not null`),
    index('chip_reads_environment_id_document_number_index_idx')
      .on(table.environmentId, table.documentNumberIndex)
      .where(sql`${table.documentNumberIndex} is not null`),
    check(
      'chip_reads_integrity_valid',
      sql`${table.integrity} in (${listed(CHIP_INTEGRITY_VALUES)})`,
    ),
    check('chip_reads_issuing_country_format', sql`${table.issuingCountry} ~ '^[A-Z<]{3}$'`),
    hexDigest('chip_reads_sod_signature_index_hex', table.sodSignatureIndex),
    hexDigest('chip_reads_document_number_index_hex', table.documentNumberIndex),
  ],
);

export type ChipReadRow = typeof chipReads.$inferSelect;
