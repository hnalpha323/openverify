/**
 * Workflow 9A Stage 1b (H): theme sets, their revisions and their assets (C160.1, C160.5, C160.6),
 * environment-scoped (decision 24). Frozen through 9A (V15): `api-themes` builds their repositories
 * and routes in Workflow 9B.
 */
import { sql } from 'drizzle-orm';
import {
  check,
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
  TEMPLATE_RECORD_ACTOR_TYPES,
  THEME_RECORD_ASSET_KINDS,
  THEME_RECORD_ASSET_MEDIA_TYPES,
  THEME_RECORD_STATUSES,
  type TemplateRecordActorType,
  type ThemeRecordAssetKind,
  type ThemeRecordAssetMediaType,
  type ThemeRecordStatus,
} from '@openverify/core';
import { idPattern } from '../ids.js';
import { createdAt, hexDigest, idFormat, oneOf, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';

/**
 * C160.1: a theme set (`theset_`): its name, status and styles tree (`themeStylesSchema`; colours
 * are `#rrggbb` only, so nothing in it can make a request), and the revision its last save wrote.
 * Archiving detaches it (public); it is never deleted, so a revision always has its set.
 */
export const themeSets = pgTable(
  'theme_sets',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    status: text('status').$type<ThemeRecordStatus>().notNull().default('active'),
    styles: jsonb('styles').$type<Record<string, unknown>>().notNull().default({}),
    /** C160.5: the revision the last save wrote, from 1. */
    revision: integer('revision').notNull().default(1),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('theme_sets_environment_id_id_key').on(table.environmentId, table.id),
    // C160.1: `GET /theme-sets` lists newest first, by status.
    index('theme_sets_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('theme_sets_name_length', sql`char_length(${table.name}) between 1 and 100`),
    check('theme_sets_status_valid', oneOf(table.status, THEME_RECORD_STATUSES)),
    check('theme_sets_revision_positive', sql`${table.revision} >= 1`),
    check(
      'theme_sets_archived_coherent',
      sql`(${table.status} = 'archived') = (${table.archivedAt} is not null)`,
    ),
    idFormat('theme_sets', table.id, 'theset'),
  ],
);

/**
 * C160.5: each save of a theme set, immutable, kept for audit and restore: the name and styles it
 * wrote, who wrote it, and the revision a restore copied (`null` for an edit).
 */
export const themeSetRevisions = pgTable(
  'theme_set_revisions',
  {
    environmentId: environmentId(),
    themeSetId: text('theme_set_id').notNull(),
    revision: integer('revision').notNull(),
    name: text('name').notNull(),
    styles: jsonb('styles').$type<Record<string, unknown>>().notNull(),
    creatorType: text('creator_type').$type<TemplateRecordActorType>().notNull(),
    creatorId: text('creator_id').notNull(),
    restoredFrom: integer('restored_from'),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.environmentId, table.themeSetId, table.revision] }),
    foreignKey({
      name: 'theme_set_revisions_theme_set_fk',
      columns: [table.environmentId, table.themeSetId],
      foreignColumns: [themeSets.environmentId, themeSets.id],
    }).onDelete('cascade'),
    check('theme_set_revisions_revision_positive', sql`${table.revision} >= 1`),
    check(
      'theme_set_revisions_restored_from_earlier',
      sql`${table.restoredFrom} is null or (${table.restoredFrom} >= 1 and ${table.restoredFrom} < ${table.revision})`,
    ),
    check(
      'theme_set_revisions_creator_valid',
      oneOf(table.creatorType, TEMPLATE_RECORD_ACTOR_TYPES),
    ),
    check(
      'theme_set_revisions_creator_id_format',
      sql`(${table.creatorType} = 'user' and ${table.creatorId} ~ ${sql.raw(`'${idPattern('usr')}'`)})
        or (${table.creatorType} = 'api-key' and ${table.creatorId} ~ ${sql.raw(`'${idPattern('key')}'`)})`,
    ),
  ],
);

/**
 * C160.6: a theme asset (`tsa_`): a logo's rendition (re-encoded through the vision rendition
 * endpoint, so no metadata reaches a browser) or a WOFF2 font, stored through `FileStorage` under
 * its envelope (`wrapped_dek`, rewrap-listed). A font carries the operator's licence attestation and
 * may carry a `unicode-range`; a logo carries its size in pixels.
 */
export const themeAssets = pgTable(
  'theme_assets',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    kind: text('kind').$type<ThemeRecordAssetKind>().notNull(),
    mediaType: text('media_type').$type<ThemeRecordAssetMediaType>().notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** S3 object key of the ciphertext. */
    storageKey: text('storage_key').notNull(),
    /** SHA-256 of the stored bytes, lowercase hex. */
    sha256: text('sha256').notNull(),
    /** `ov1.<kid>.<wrapped DEK>` from `encryptBytes`, the asset id as its context. */
    wrappedDek: text('wrapped_dek').notNull(),
    /** C160.6: the user who attested a font's licence, and when; a font only. */
    licenceAttestedBy: text('licence_attested_by'),
    licenceAttestedAt: timestamptz('licence_attested_at'),
    /** A font's `unicode-range` descriptor, held to the strict CSS pattern by the API. */
    unicodeRange: text('unicode_range'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('theme_assets_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('theme_assets_storage_key_key').on(table.storageKey),
    check('theme_assets_kind_valid', oneOf(table.kind, THEME_RECORD_ASSET_KINDS)),
    check('theme_assets_media_type_valid', oneOf(table.mediaType, THEME_RECORD_ASSET_MEDIA_TYPES)),
    check(
      'theme_assets_kind_coherent',
      sql`(${table.kind} = 'logo' and ${table.mediaType} in ('image/png', 'image/jpeg')
            and ${table.width} between 1 and 2048 and ${table.height} between 1 and 2048
            and ${table.licenceAttestedBy} is null and ${table.licenceAttestedAt} is null
            and ${table.unicodeRange} is null and ${table.byteSize} between 1 and 262144)
        or (${table.kind} = 'font' and ${table.mediaType} = 'font/woff2'
            and ${table.width} is null and ${table.height} is null
            and ${table.licenceAttestedBy} ~ ${sql.raw(`'${idPattern('usr')}'`)}
            and ${table.licenceAttestedAt} is not null and ${table.byteSize} between 1 and 524288)`,
    ),
    check(
      'theme_assets_unicode_range_length',
      sql`${table.unicodeRange} is null or char_length(${table.unicodeRange}) <= 1000`,
    ),
    hexDigest('theme_assets_sha256_hex', table.sha256),
    check(
      'theme_assets_wrapped_dek_format',
      sql`${table.wrappedDek} ~ '^ov1\\.[A-Za-z0-9_-]{11}\\.[A-Za-z0-9_-]{80}$'`,
    ),
    idFormat('theme_assets', table.id, 'tsa'),
  ],
);

export type ThemeSetRow = typeof themeSets.$inferSelect;
export type ThemeSetRevisionRow = typeof themeSetRevisions.$inferSelect;
export type ThemeAssetRow = typeof themeAssets.$inferSelect;
