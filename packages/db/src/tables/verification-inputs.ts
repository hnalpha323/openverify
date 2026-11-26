/**
 * C52.3, C53.2, C59.6: the values entered for a database, AAMVA form, business registry or
 * business website verification, or copied by a silent AAMVA attempt from a government ID.
 * One row per verification; the values are sealed to it (`verification_inputs.values#<id>`).
 */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, idColumnFormat, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';
import { verifications } from './verifications.js';

export const verificationInputs = pgTable(
  'verification_inputs',
  {
    environmentId: environmentId(),
    /** One row per verification; also the row id the values are sealed to. */
    verificationId: text('verification_id').primaryKey(),
    inquiryId: text('inquiry_id').notNull(),
    /** The values as the inputs body names them; `null` once redacted. */
    valuesSealed: sealedColumn('values'),
    /** The members received, names only. */
    fieldNames: text('field_names')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: text('source').$type<'flow' | 'government_id'>().notNull(),
    /** C59.6: the government ID verification a silent AAMVA attempt copied. */
    sourceVerificationId: text('source_verification_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    redactedAt: timestamptz('redacted_at'),
  },
  (table) => [
    foreignKey({
      name: 'verification_inputs_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'verification_inputs_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'verification_inputs_source_verification_fk',
      columns: [table.environmentId, table.sourceVerificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    unique('verification_inputs_environment_id_verification_id_key').on(
      table.environmentId,
      table.verificationId,
    ),
    index('verification_inputs_environment_id_inquiry_id_idx').on(
      table.environmentId,
      table.inquiryId,
    ),
    check('verification_inputs_source_valid', sql`${table.source} in ('flow', 'government_id')`),
    // Only a copy from a government ID names the verification it came from.
    check(
      'verification_inputs_source_verification_iff_copied',
      sql`(${table.source} = 'government_id') = (${table.sourceVerificationId} is not null)`,
    ),
    idColumnFormat(
      'verification_inputs_source_verification_id_format',
      table.sourceVerificationId,
      'ver',
    ),
  ],
);

export type VerificationInputsRow = typeof verificationInputs.$inferSelect;
