/**
 * C53.3, C61.1: the registry record one business verification was judged against. Its summary
 * (record id, legal name, status, jurisdiction, registered address; never officers or PSCs) is
 * sealed to the row (`business_registry_records.record#<verification id>`), because a sole
 * trader's name is personal data.
 */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, timestamptz } from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';
import { verifications } from './verifications.js';

export const BUSINESS_REGISTRY_SOURCE_VALUES = [
  'gleif',
  'companies-house',
  'sec-edgar',
  'sandbox',
] as const;

export const businessRegistryRecords = pgTable(
  'business_registry_records',
  {
    environmentId: environmentId(),
    verificationId: text('verification_id').primaryKey(),
    inquiryId: text('inquiry_id').notNull(),
    source: text('source').$type<(typeof BUSINESS_REGISTRY_SOURCE_VALUES)[number]>().notNull(),
    /** The sealed summary; `null` once redacted. */
    recordSealed: sealedColumn('record'),
    fetchedAt: timestamptz('fetched_at').notNull(),
    createdAt: createdAt(),
    redactedAt: timestamptz('redacted_at'),
  },
  (table) => [
    foreignKey({
      name: 'business_registry_records_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'business_registry_records_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    unique('business_registry_records_environment_id_verification_id_key').on(
      table.environmentId,
      table.verificationId,
    ),
    index('business_registry_records_environment_id_inquiry_id_idx').on(
      table.environmentId,
      table.inquiryId,
    ),
    check(
      'business_registry_records_source_valid',
      sql`${table.source} in (${sql.raw(BUSINESS_REGISTRY_SOURCE_VALUES.map((value) => `'${value}'`).join(', '))})`,
    ),
  ],
);

export type BusinessRegistryRecordRowData = typeof businessRegistryRecords.$inferSelect;
