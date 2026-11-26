/**
 * C31.7: the extraction of one government ID verification, and the lookup keys the repeat
 * checks use (C34). PII lives only in `fields`, sealed to its row; `field_sources` names fields
 * and sources, never values.
 */
import type { ExtractionFieldSources } from '@openverify/core';
import type { IdClassGroup } from '../blind-index.js';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, hexDigest, timestamptz } from './columns.js';
import { idClass } from './enums.js';
import { environmentId } from './environment-id.js';
import { verifications } from './verifications.js';

/** Number of 8-bit bands of the 64-bit perceptual hash (C34 pigeonhole lookup). */
export const PHASH_BANDS = 8;

/**
 * Band `band` (0-7) of a 16-hex-character perceptual hash: its byte at that position, as an
 * integer 0-255, or `null` when the hash is `null` (redacted or never computed).
 */
const phashBand = (column: AnyPgColumn, band: number): SQL =>
  sql`(('x' || substr(${column}, ${sql.raw(String(band * 2 + 1))}, 2))::bit(8)::integer)::smallint`;

export const governmentIdExtractions = pgTable(
  'government_id_extractions',
  {
    environmentId: environmentId(),
    /** One extraction per verification; also the row id the fields are sealed to. */
    verificationId: text('verification_id').primaryKey(),
    /** C31.5 fields (`ExtractedFields`), sealed with context `government_id_extractions.fields#<verification id>`; `null` once redacted. */
    fieldsSealed: sealedColumn('fields'),
    /** Per field, the sources that agreed. Field and source names only. */
    fieldSources: jsonb('field_sources').$type<ExtractionFieldSources>().notNull().default({}),
    /** C31.8 HMAC-SHA-256 blind index (64 lowercase hex), environment-scoped by its index. */
    identificationNumberIndex: text('identification_number_index'),
    /** 64-bit DCT perceptual hash of the rectified front, 16 lowercase hex characters. */
    frontPhash: text('front_phash'),
    frontPhashBand0: smallint('front_phash_band_0').generatedAlwaysAs((): SQL =>
      phashBand(governmentIdExtractions.frontPhash, 0),
    ),
    frontPhashBand1: smallint('front_phash_band_1').generatedAlwaysAs((): SQL =>
      phashBand(governmentIdExtractions.frontPhash, 1),
    ),
    frontPhashBand2: smallint('front_phash_band_2').generatedAlwaysAs((): SQL =>
      phashBand(governmentIdExtractions.frontPhash, 2),
    ),
    frontPhashBand3: smallint('front_phash_band_3').generatedAlwaysAs((): SQL =>
      phashBand(governmentIdExtractions.frontPhash, 3),
    ),
    frontPhashBand4: smallint('front_phash_band_4').generatedAlwaysAs((): SQL =>
      phashBand(governmentIdExtractions.frontPhash, 4),
    ),
    frontPhashBand5: smallint('front_phash_band_5').generatedAlwaysAs((): SQL =>
      phashBand(governmentIdExtractions.frontPhash, 5),
    ),
    frontPhashBand6: smallint('front_phash_band_6').generatedAlwaysAs((): SQL =>
      phashBand(governmentIdExtractions.frontPhash, 6),
    ),
    frontPhashBand7: smallint('front_phash_band_7').generatedAlwaysAs((): SQL =>
      phashBand(governmentIdExtractions.frontPhash, 7),
    ),
    /**
     * The C31.8 class group the blind index was computed with: the ID class the document
     * established, or `unknown`. Not PII; kept so `blind-index:rebuild` can recompute the index.
     */
    idClassGroup: text('id_class_group').$type<IdClassGroup>().notNull().default('unknown'),
    redactedAt: timestamptz('redacted_at'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'government_id_extractions_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    hexDigest(
      'government_id_extractions_identification_number_index_hex',
      table.identificationNumberIndex,
    ),
    check('government_id_extractions_front_phash_hex', sql`${table.frontPhash} ~ '^[0-9a-f]{16}$'`),
    check(
      'government_id_extractions_id_class_group_valid',
      sql`${table.idClassGroup} in (${sql.raw(
        ['unknown', ...idClass.enumValues].map((value) => `'${value}'`).join(', '),
      )})`,
    ),
    index('government_id_extractions_environment_id_identification_number_index_idx')
      .on(table.environmentId, table.identificationNumberIndex)
      .where(sql`${table.identificationNumberIndex} is not null`),
    ...[
      table.frontPhashBand0,
      table.frontPhashBand1,
      table.frontPhashBand2,
      table.frontPhashBand3,
      table.frontPhashBand4,
      table.frontPhashBand5,
      table.frontPhashBand6,
      table.frontPhashBand7,
    ].map((band, position) =>
      index(`government_id_extractions_environment_id_front_phash_band_${String(position)}_idx`)
        .on(table.environmentId, band)
        .where(sql`${band} is not null`),
    ),
  ],
);

export type GovernmentIdExtractionRow = typeof governmentIdExtractions.$inferSelect;
