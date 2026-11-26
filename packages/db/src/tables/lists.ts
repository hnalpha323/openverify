/**
 * Phase 7, Workflow 7B (C97-C100): lists, their items and match keys, list matches, screenings and
 * importers.
 *
 * - `lists`: thirteen kinds in one table. `version` is bumped by every item write and named by a
 *   report's provenance (C106.2); the kind-specific members are held to their kind by CHECKs.
 * - `list_items`: `value` is the item as entered, sealed for its row (`list_items.value#<id>`).
 *   `match_key` is a 64-hex HMAC (`identifierKey`, F10), never `bytea(32)`; the partial unique index
 *   dedups a list's live rows. `normaliser_version` is text and "outdated" means not equal to the
 *   process's `LIST_KEYS_VERSION`; `key_id` is the blind-index key of a fingerprint item (C94.4).
 * - `list_item_keys`: the extra probe keys of the multi-key kinds, environment first.
 * - The side tables, one row per item (two for a box crossing the antimeridian):
 *   `list_item_ip_ranges` with an SP-GiST `inet_ops` index (a default GiST class on `cidr` silently
 *   falls back to a sequential scan once `btree_gist` is installed, C98.1), `list_item_geo` with a
 *   GiST `box_ops` index (the plaintext box is rounded outward to 0.01°; the sealed item keeps the
 *   exact point), `list_item_faces` (the item's own sealed copy of a template, C99.7) and
 *   `list_item_backgrounds` (no ANN index, so the Phase 4 privacy finding stands). A biometric side
 *   row is written with the item, `pending`, and the embed job fills it.
 * - `list_matches`: one record per inquiry, item and probe source; the compared value and the
 *   dismissal's reason are sealed. `list_screenings`: the outbox of C99.4, keyed by inquiry, which
 *   also holds the count the API merges into `inquiry/list_match_count` when it serves it (V06).
 * - `importers`: the storage key and wrapped DEK live here because `files` requires a verification
 *   (C100.2). `list_import_rows` is the per-import staging table, each value sealed under
 *   `importRowKey(importer id, row)`, and its rows are deleted when the import ends.
 *   `list_import_errors` holds a code and a line, never a value (C100.4).
 *
 * Plaintext by decision (C107.5): an item's `country_code` (C97.6, C98.2: matched on this column,
 * the HMAC dedups), CIDR ranges, coarse boxes and the layout vector. Migration 0024 runs
 * `CREATE EXTENSION IF NOT EXISTS vector` itself.
 */
import {
  IMPORT_ERROR_CODES,
  IMPORTER_MODES,
  IMPORTER_STATUSES,
  LIST_ITEM_ARCHIVE_REASONS,
  LIST_ITEM_STATUSES,
  LIST_KEY_KINDS,
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  LIST_MATCH_METHODS,
  LIST_MATCH_STATUSES,
  LIST_MATCH_TIERS,
  LIST_PROBE_SOURCES,
  LIST_REVIEW_CAUSES,
  LIST_SCREENING_STATUSES,
  LIST_PURPOSES,
  LIST_STATUSES,
  DEFAULT_LIST_PURPOSE,
  type ImportErrorCode,
  type ImporterMode,
  type ImporterStatus,
  type ListItemStatus,
  type ListKeyKind,
  type ListKind,
  type ListMatchMethod,
  type ListMatchStatus,
  type ListMatchTier,
  type ListProbeSource,
  type ListPurpose,
  type ListReviewCause,
  type ListScreeningStatus,
  type ListStatus,
} from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  cidr,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { accounts } from './accounts.js';
import {
  countryCodeFormat,
  createdAt,
  hexDigest,
  idColumnFormat,
  idFormat,
  oneOf,
  timestamptz,
  updatedAt,
  workflowRunStepId,
  workflowRunStepKey,
} from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';
import { BACKGROUND_LAYOUT_DIMENSIONS } from './selfie.js';

/** Who created an item (C97.2, C121.1): a user, an API key, an importer or a workflow run. */
export const LIST_ITEM_CREATOR_TYPES = ['user', 'api-key', 'importer', 'workflow-run'] as const;
export type ListItemCreatorType = (typeof LIST_ITEM_CREATOR_TYPES)[number];

/** C99.4: the first moves that write a screening, the same as the signals outbox (V17). */
export const LIST_SCREENING_TRIGGER_VALUES = ['completed', 'failed', 'expired'] as const;

/** The item id prefixes, one per kind (C97.1). */
export const LIST_ITEM_ID_PATTERN = `^(${LIST_KINDS.map((kind) => LIST_KIND_REGISTRY[kind].itemPrefix).join('|')})_[0-9A-HJKMNP-TV-Z]{26}$`;

/** The kinds a biometric list holds: their retention is required (C97.2, P08). */
const BIOMETRIC_KINDS = LIST_KINDS.filter((kind) => LIST_KIND_REGISTRY[kind].biometric);

/** Postgres `box`; drizzle has no column type for it. Written and read as text. */
const box = customType<{ data: string }>({
  dataType: () => 'box',
});

/** The row key an import row's sealed value is bound to: its importer and line (C100.2). */
export const importRowKey = (importerId: string, row: number): string =>
  `${importerId}/${String(row)}`;

export const lists = pgTable(
  'lists',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    type: text('type').$type<ListKind>().notNull(),
    /** Not PII; the docs warn against putting personal data in it (C97.6). */
    name: text('name').notNull(),
    status: text('status').$type<ListStatus>().notNull().default('active'),
    archivedAt: timestamptz('archived_at'),
    /** Bumped by every item write (C97.2). */
    version: integer('version').notNull().default(1),
    /** C122.1: `block` makes an add adverse; `allow` and `watch` do not. */
    purpose: text('purpose').$type<ListPurpose>().notNull().default(DEFAULT_LIST_PURPOSE),
    /** The items that count against the limits (C97.5). */
    itemCount: integer('item_count').notNull().default(0),
    /** `null` keeps items until they are removed (C98.4). */
    itemRetentionDays: integer('item_retention_days'),
    /** C99.5: whether `list-config.screen: all` reads the list. */
    screenAtCompletion: boolean('screen_at_completion').notNull().default(true),
    /** Fields lists only: the key of the inquiry's `fields` they compare. */
    fieldKey: text('field_key'),
    /** Strings lists only. Never changes: the stored keys depend on it. */
    caseSensitive: boolean('case_sensitive').notNull().default(false),
    /** Phones lists only: ISO alpha-2. */
    defaultRegion: text('default_region'),
    /** C99.9: government ID number lists only. */
    useForCompromisedIds: boolean('use_for_compromised_ids').notNull().default(false),
    /** Names lists only. Never changes: the stored keys depend on it. */
    allowFuzzyNameFirst: boolean('allow_fuzzy_name_first').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('lists_environment_id_id_key').on(table.environmentId, table.id),
    index('lists_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // C99.5: what `screen: all` and `POST /lists/match` read.
    index('lists_environment_id_type_active_idx')
      .on(table.environmentId, table.type)
      .where(sql`${table.status} = 'active'`),
    idFormat('lists', table.id, 'lst'),
    check('lists_type_valid', oneOf(table.type, LIST_KINDS)),
    check('lists_status_valid', oneOf(table.status, LIST_STATUSES)),
    check('lists_version_positive', sql`${table.version} >= 1`),
    check('lists_purpose_valid', oneOf(table.purpose, LIST_PURPOSES)),
    check('lists_item_count_non_negative', sql`${table.itemCount} >= 0`),
    check('lists_item_retention_days_range', sql`${table.itemRetentionDays} between 1 and 3650`),
    check(
      'lists_archived_at_fits_status',
      sql`(${table.status} = 'archived') = (${table.archivedAt} is not null)`,
    ),
    check(
      'lists_field_key_fits_type',
      sql`(${table.type} = 'field') = (${table.fieldKey} is not null)`,
    ),
    check(
      'lists_default_region_fits_type',
      sql`${table.defaultRegion} is null or ${table.type} = 'phone-number'`,
    ),
    countryCodeFormat('lists_default_region_format', table.defaultRegion),
    check(
      'lists_compromised_fits_type',
      sql`not ${table.useForCompromisedIds} or ${table.type} = 'government-id-number'`,
    ),
    check('lists_fuzzy_fits_type', sql`not ${table.allowFuzzyNameFirst} or ${table.type} = 'name'`),
    check(
      'lists_case_sensitive_fits_type',
      sql`not ${table.caseSensitive} or ${table.type} = 'string'`,
    ),
    check(
      'lists_biometric_retention',
      sql`not ${oneOf(table.type, BIOMETRIC_KINDS)} or ${table.itemRetentionDays} is not null`,
    ),
  ],
);

export const listItems = pgTable(
  'list_items',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    listId: text('list_id').notNull(),
    /** The item as entered, sealed JSON; `null` once redacted, and on a biometric item. */
    valueSealed: sealedColumn('value'),
    /** 64 hex (`identifierKey`); `null` once redacted, and on a biometric item. */
    matchKey: text('match_key'),
    /** Country lists only: not PII (C97.6), and what a country probe matches (C98.2). */
    countryCode: text('country_code'),
    /** The process's `LIST_KEYS_VERSION` when the keys were computed (C98.2). */
    normaliserVersion: text('normaliser_version').notNull(),
    /** C94.4 (P09): the blind-index key id of a fingerprint item. */
    keyId: text('key_id'),
    status: text('status').$type<ListItemStatus>().notNull().default('active'),
    /** Why the item was archived without an operator's request (C99.7). */
    archiveReason: text('archive_reason').$type<(typeof LIST_ITEM_ARCHIVE_REASONS)[number]>(),
    matchCount: integer('match_count').notNull().default(0),
    createdByType: text('created_by_type').$type<ListItemCreatorType>(),
    createdById: text('created_by_id'),
    archivedAt: timestamptz('archived_at'),
    redactedAt: timestamptz('redacted_at'),
    /** C117.5: the run's step that created it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    /** C251.1 (Workflow 11B Stage 1b (P)): when the queue's cap admitted this row's job; `null` while held. */
    admittedAt: timestamptz('admitted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    ...workflowRunStepKey('list_items', table.environmentId, table.workflowRunStepId),
    unique('list_items_environment_id_id_key').on(table.environmentId, table.id),
    foreignKey({
      name: 'list_items_list_fk',
      columns: [table.environmentId, table.listId],
      foreignColumns: [lists.environmentId, lists.id],
    }).onDelete('cascade'),
    // C98.1: the dedup key, and the exact matching index (environment first, F10).
    uniqueIndex('list_items_active_match_key_key')
      .on(table.environmentId, table.listId, table.matchKey)
      .where(sql`${table.archivedAt} is null and ${table.redactedAt} is null`),
    // C98.2: a country probe, on live rows.
    index('list_items_environment_id_country_code_idx')
      .on(table.environmentId, table.countryCode)
      .where(sql`${table.countryCode} is not null and ${table.archivedAt} is null`),
    // C97.1: `GET /list-items?filter[list-id]=`, newest first; item retention walks it from the end.
    index('list_items_environment_id_list_id_created_at_id_idx').on(
      table.environmentId,
      table.listId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('list_items_id_format', sql`${table.id} ~ ${sql.raw(`'${LIST_ITEM_ID_PATTERN}'`)}`),
    hexDigest('list_items_match_key_hex', table.matchKey),
    countryCodeFormat('list_items_country_code_format', table.countryCode),
    check('list_items_status_valid', oneOf(table.status, LIST_ITEM_STATUSES)),
    check('list_items_archive_reason_valid', oneOf(table.archiveReason, LIST_ITEM_ARCHIVE_REASONS)),
    check('list_items_key_id_format', sql`${table.keyId} ~ '^[A-Za-z0-9_-]{11}$'`),
    check('list_items_match_count_non_negative', sql`${table.matchCount} >= 0`),
    check('list_items_created_by_type_valid', oneOf(table.createdByType, LIST_ITEM_CREATOR_TYPES)),
    check(
      'list_items_created_by_complete',
      sql`(${table.createdByType} is null) = (${table.createdById} is null)`,
    ),
    check(
      'list_items_archived_at_fits_status',
      sql`(${table.status} = 'archived') = (${table.archivedAt} is not null)`,
    ),
    // C98.4: redaction archives the item, and nulls its value and key.
    check(
      'list_items_redacted_is_archived',
      sql`${table.redactedAt} is null or ${table.status} = 'archived'`,
    ),
    check(
      'list_items_redacted_holds_nothing',
      sql`${table.redactedAt} is null
        or (${table.valueSealed} is null and ${table.matchKey} is null
            and ${table.countryCode} is null)`,
    ),
  ],
);

export const listItemKeys = pgTable(
  'list_item_keys',
  {
    environmentId: environmentId(),
    itemId: text('item_id').notNull(),
    keyKind: text('key_kind').$type<ListKeyKind>().notNull(),
    matchKey: text('match_key').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'list_item_keys_pkey',
      columns: [table.environmentId, table.itemId, table.keyKind, table.matchKey],
    }),
    foreignKey({
      name: 'list_item_keys_item_fk',
      columns: [table.environmentId, table.itemId],
      foreignColumns: [listItems.environmentId, listItems.id],
    }).onDelete('cascade'),
    index('list_item_keys_environment_id_key_kind_match_key_idx').on(
      table.environmentId,
      table.keyKind,
      table.matchKey,
    ),
    check('list_item_keys_key_kind_valid', oneOf(table.keyKind, LIST_KEY_KINDS)),
    hexDigest('list_item_keys_match_key_hex', table.matchKey),
  ],
);

export const listItemIpRanges = pgTable(
  'list_item_ip_ranges',
  {
    itemId: text('item_id').primaryKey(),
    environmentId: environmentId(),
    /** Plaintext by decision 28: a range matches by containment (`range >>= $probe`). */
    range: cidr('range').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'list_item_ip_ranges_item_fk',
      columns: [table.environmentId, table.itemId],
      foreignColumns: [listItems.environmentId, listItems.id],
    }).onDelete('cascade'),
    index('list_item_ip_ranges_range_idx').using('spgist', table.range.op('inet_ops')),
  ],
);

export const listItemGeo = pgTable(
  'list_item_geo',
  {
    environmentId: environmentId(),
    itemId: text('item_id').notNull(),
    /** Rounded outward to 0.01°; plaintext by C107.5. The sealed item keeps the exact point. */
    bbox: box('bbox').notNull(),
    /** 0, or 1 for the second box of an item that crosses ±180° (C98.1). */
    part: smallint('part').notNull().default(0),
  },
  (table) => [
    primaryKey({ name: 'list_item_geo_pkey', columns: [table.itemId, table.part] }),
    foreignKey({
      name: 'list_item_geo_item_fk',
      columns: [table.environmentId, table.itemId],
      foreignColumns: [listItems.environmentId, listItems.id],
    }).onDelete('cascade'),
    index('list_item_geo_bbox_idx').using('gist', table.bbox.op('box_ops')),
    check('list_item_geo_part_valid', sql`${table.part} in (0, 1)`),
  ],
);

export const listItemFaces = pgTable(
  'list_item_faces',
  {
    itemId: text('item_id').primaryKey(),
    environmentId: environmentId(),
    /** The item's own sealed copy (Phase 4 deletes a declined inquiry's template, C99.7). */
    templateSealed: sealedColumn('template'),
    /** The embedding model; `null` while the item is `pending`. */
    model: text('model'),
    sourceInquiryId: text('source_inquiry_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'list_item_faces_item_fk',
      columns: [table.environmentId, table.itemId],
      foreignColumns: [listItems.environmentId, listItems.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'list_item_faces_source_inquiry_fk',
      columns: [table.environmentId, table.sourceInquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }),
    // C98.4: redacting an inquiry redacts the items it was the source of.
    index('list_item_faces_environment_id_source_inquiry_id_idx').on(
      table.environmentId,
      table.sourceInquiryId,
    ),
    check(
      'list_item_faces_embedded_complete',
      sql`(${table.templateSealed} is null) = (${table.model} is null)`,
    ),
  ],
);

export const listItemBackgrounds = pgTable(
  'list_item_backgrounds',
  {
    itemId: text('item_id').primaryKey(),
    environmentId: environmentId(),
    /** `null` while the item is `pending`. No ANN index (C99.7). */
    layout: vector('layout', { dimensions: BACKGROUND_LAYOUT_DIMENSIONS }),
    validCells: text('valid_cells'),
    coverage: doublePrecision('coverage'),
    /** The person-masked image, an envelope object; `files` requires a verification (C98.1). */
    maskedFileKey: text('masked_file_key'),
    maskedFileWrappedDek: text('masked_file_wrapped_dek'),
    sourceInquiryId: text('source_inquiry_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'list_item_backgrounds_item_fk',
      columns: [table.environmentId, table.itemId],
      foreignColumns: [listItems.environmentId, listItems.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'list_item_backgrounds_source_inquiry_fk',
      columns: [table.environmentId, table.sourceInquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }),
    index('list_item_backgrounds_environment_id_source_inquiry_id_idx').on(
      table.environmentId,
      table.sourceInquiryId,
    ),
    check('list_item_backgrounds_valid_cells_format', sql`${table.validCells} ~ '^[01]{48}$'`),
    check(
      'list_item_backgrounds_coverage_unit_interval',
      sql`${table.coverage} >= 0 and ${table.coverage} <= 1`,
    ),
    check(
      'list_item_backgrounds_layout_complete',
      sql`(${table.layout} is null) = (${table.validCells} is null)
        and (${table.layout} is null) = (${table.coverage} is null)`,
    ),
    check(
      'list_item_backgrounds_mask_complete',
      sql`(${table.maskedFileKey} is null) = (${table.maskedFileWrappedDek} is null)`,
    ),
  ],
);

export const listMatches = pgTable(
  'list_matches',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    listId: text('list_id').notNull(),
    /** `null` once the item was redacted (the served relationship reads `null`). */
    listItemId: text('list_item_id'),
    inquiryId: text('inquiry_id').notNull(),
    accountId: text('account_id'),
    source: text('source').$type<ListProbeSource>().notNull(),
    method: text('method').$type<ListMatchMethod>().notNull(),
    /** C99.1 (H15): the tier of the evidence. */
    tier: text('tier').$type<ListMatchTier>().notNull(),
    /** H only. */
    confidence: doublePrecision('confidence'),
    approximate: boolean('approximate').notNull().default(false),
    score: doublePrecision('score'),
    distanceMeters: integer('distance_meters'),
    listVersion: integer('list_version').notNull(),
    /** The value compared, sealed; shown only with `pii:view` (C99.3). */
    matchedValueSealed: sealedColumn('matched_value'),
    status: text('status').$type<ListMatchStatus>().notNull().default('open'),
    dismissedAt: timestamptz('dismissed_at'),
    /** The dismissal's free text, sealed (C99.3). */
    reasonSealed: sealedColumn('reason'),
    redactedAt: timestamptz('redacted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'list_matches_list_fk',
      columns: [table.environmentId, table.listId],
      foreignColumns: [lists.environmentId, lists.id],
    }),
    foreignKey({
      name: 'list_matches_item_fk',
      columns: [table.environmentId, table.listItemId],
      foreignColumns: [listItems.environmentId, listItems.id],
    }),
    foreignKey({
      name: 'list_matches_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'list_matches_account_fk',
      columns: [table.environmentId, table.accountId],
      foreignColumns: [accounts.environmentId, accounts.id],
    }),
    // A retried job and the C99.9 record write one match per inquiry, item and source.
    uniqueIndex('list_matches_inquiry_item_source_key')
      .on(table.environmentId, table.inquiryId, table.listItemId, table.source)
      .where(sql`${table.listItemId} is not null`),
    index('list_matches_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('list_matches_environment_id_inquiry_id_created_at_id_idx').on(
      table.environmentId,
      table.inquiryId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('list_matches_environment_id_account_id_created_at_id_idx').on(
      table.environmentId,
      table.accountId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('list_matches_environment_id_list_id_created_at_id_idx').on(
      table.environmentId,
      table.listId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('list_matches', table.id, 'lmt'),
    idColumnFormat('list_matches_list_id_format', table.listId, 'lst'),
    check('list_matches_source_valid', oneOf(table.source, LIST_PROBE_SOURCES)),
    check('list_matches_method_valid', oneOf(table.method, LIST_MATCH_METHODS)),
    check('list_matches_tier_valid', oneOf(table.tier, LIST_MATCH_TIERS)),
    check('list_matches_status_valid', oneOf(table.status, LIST_MATCH_STATUSES)),
    check(
      'list_matches_confidence_unit_interval',
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
    check('list_matches_score_unit_interval', sql`${table.score} >= 0 and ${table.score} <= 1`),
    check('list_matches_distance_non_negative', sql`${table.distanceMeters} >= 0`),
    check('list_matches_list_version_positive', sql`${table.listVersion} >= 1`),
    check(
      'list_matches_dismissed_at_fits_status',
      sql`(${table.status} = 'dismissed') = (${table.dismissedAt} is not null)`,
    ),
    check(
      'list_matches_redacted_holds_nothing',
      sql`${table.redactedAt} is null
        or (${table.matchedValueSealed} is null and ${table.reasonSealed} is null)`,
    ),
  ],
);

export const listScreenings = pgTable(
  'list_screenings',
  {
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    /** The status the inquiry moved into when the row was written. */
    triggerStatus: text('trigger_status')
      .$type<(typeof LIST_SCREENING_TRIGGER_VALUES)[number]>()
      .notNull(),
    status: text('status').$type<ListScreeningStatus>().notNull().default('pending'),
    /** The open matches a `completed` screening recorded (V06). */
    matchCount: integer('match_count'),
    /** `[{ list-id, reason }]`: ids and closed reasons, no value (C99.1). */
    unscreened: jsonb('unscreened').$type<unknown[]>().notNull().default([]),
    /** `[{ list-id, reason }]`: lists the subject has no value for (H16). */
    notApplicable: jsonb('not_applicable').$type<unknown[]>().notNull().default([]),
    /** C99.6: why the screening moved the inquiry, or left it alone. */
    reviewCause: text('review_cause').$type<ListReviewCause>(),
    attempts: integer('attempts').notNull().default(0),
    /** The last failure's code (a snake-case name, never a value). */
    lastErrorCode: text('last_error_code'),
    /** When the sweep last enqueued the row. */
    enqueuedAt: timestamptz('enqueued_at'),
    /** When the screening ended; the merged signal's `computed-at` (C99.4). */
    screenedAt: timestamptz('screened_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: 'list_screenings_pkey',
      columns: [table.environmentId, table.inquiryId],
    }),
    foreignKey({
      name: 'list_screenings_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    // The 15 s sweep: pending rows, oldest first.
    index('list_screenings_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    check(
      'list_screenings_trigger_valid',
      oneOf(table.triggerStatus, LIST_SCREENING_TRIGGER_VALUES),
    ),
    check('list_screenings_status_valid', oneOf(table.status, LIST_SCREENING_STATUSES)),
    check('list_screenings_review_cause_valid', oneOf(table.reviewCause, LIST_REVIEW_CAUSES)),
    check('list_screenings_attempts_non_negative', sql`${table.attempts} >= 0`),
    check('list_screenings_match_count_non_negative', sql`${table.matchCount} >= 0`),
    check(
      'list_screenings_completed_has_count',
      sql`${table.status} <> 'completed' or ${table.matchCount} is not null`,
    ),
    check(
      'list_screenings_ended_has_time',
      sql`${table.status} = 'pending' or ${table.screenedAt} is not null`,
    ),
    check(
      'list_screenings_last_error_code_format',
      sql`${table.lastErrorCode} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
  ],
);

export const importers = pgTable(
  'importers',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    listId: text('list_id').notNull(),
    status: text('status').$type<ImporterStatus>().notNull().default('pending'),
    mode: text('mode').$type<ImporterMode>().notNull().default('all-or-nothing'),
    /** The WHATWG label the job decodes with (C100.2). */
    encoding: text('encoding').notNull().default('utf-8'),
    rowCount: integer('row_count').notNull().default(0),
    successfulCount: integer('successful_count').notNull().default(0),
    /** Rows repeated within the file (H30). */
    duplicateCount: integer('duplicate_count').notNull().default(0),
    /** Rows already active in the list (H30). */
    alreadyPresentCount: integer('already_present_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    fileSha256: text('file_sha256').notNull(),
    fileBytes: integer('file_bytes').notNull(),
    /** The envelope object; both go when it is purged, 7 days after the import ends. */
    storageKey: text('storage_key'),
    wrappedDek: text('wrapped_dek'),
    objectDeletedAt: timestamptz('object_deleted_at'),
    attempts: integer('attempts').notNull().default(0),
    /** The last failure's code (a snake-case name, never a value). */
    lastErrorCode: text('last_error_code'),
    /** When the sweep last enqueued the row. */
    enqueuedAt: timestamptz('enqueued_at'),
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('importers_environment_id_id_key').on(table.environmentId, table.id),
    foreignKey({
      name: 'importers_list_fk',
      columns: [table.environmentId, table.listId],
      foreignColumns: [lists.environmentId, lists.id],
    }).onDelete('cascade'),
    index('importers_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('importers_environment_id_list_id_created_at_id_idx').on(
      table.environmentId,
      table.listId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // C100.5: the same list, mode and SHA-256 within 24 h answers the existing importer.
    index('importers_file_idempotency_idx').on(
      table.environmentId,
      table.listId,
      table.mode,
      table.fileSha256,
      table.createdAt.desc().nullsFirst(),
    ),
    // The 15 s sweep: pending imports, oldest first.
    index('importers_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    // C100.2: the C16 pass purges objects 7 days after the import ends.
    index('importers_object_purge_idx')
      .on(table.completedAt)
      .where(sql`${table.storageKey} is not null and ${table.status} <> 'pending'`),
    idFormat('importers', table.id, 'mprt'),
    check('importers_status_valid', oneOf(table.status, IMPORTER_STATUSES)),
    check('importers_mode_valid', oneOf(table.mode, IMPORTER_MODES)),
    hexDigest('importers_file_sha256_hex', table.fileSha256),
    check(
      'importers_counts_non_negative',
      sql`${table.rowCount} >= 0 and ${table.successfulCount} >= 0 and ${table.duplicateCount} >= 0
        and ${table.alreadyPresentCount} >= 0 and ${table.errorCount} >= 0
        and ${table.attempts} >= 0 and ${table.fileBytes} >= 0`,
    ),
    check(
      'importers_object_complete',
      sql`(${table.storageKey} is null) = (${table.wrappedDek} is null)`,
    ),
    check(
      'importers_object_deleted',
      sql`${table.objectDeletedAt} is null or ${table.storageKey} is null`,
    ),
    check(
      'importers_completed_at_fits_status',
      sql`(${table.status} = 'pending') = (${table.completedAt} is null)`,
    ),
    check(
      'importers_last_error_code_format',
      sql`${table.lastErrorCode} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
  ],
);

export const listImportRows = pgTable(
  'list_import_rows',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    importerId: text('importer_id').notNull(),
    /** The file's line, as an error names it. */
    row: integer('row').notNull(),
    /** The parsed row, sealed for `importRowKey(importer id, row)` (P18). */
    valueSealed: sealedColumn('value').notNull(),
    /** The row's dedup key (64 hex), so a repeat within the file is counted without opening it. */
    matchKey: text('match_key'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'list_import_rows_importer_fk',
      columns: [table.environmentId, table.importerId],
      foreignColumns: [importers.environmentId, importers.id],
    }).onDelete('cascade'),
    uniqueIndex('list_import_rows_importer_row_key').on(table.importerId, table.row),
    index('list_import_rows_importer_match_key_idx').on(table.importerId, table.matchKey),
    check('list_import_rows_row_positive', sql`${table.row} >= 1`),
    hexDigest('list_import_rows_match_key_hex', table.matchKey),
  ],
);

export const listImportErrors = pgTable(
  'list_import_errors',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    importerId: text('importer_id').notNull(),
    /** `null` for an error of the whole file. */
    row: integer('row'),
    /** A column header of C100.3, never a value. */
    column: text('column'),
    code: text('code').$type<ImportErrorCode>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'list_import_errors_importer_fk',
      columns: [table.environmentId, table.importerId],
      foreignColumns: [importers.environmentId, importers.id],
    }).onDelete('cascade'),
    // `GET /importers/:id/errors`: in row order; `page[after]` is a row.
    index('list_import_errors_importer_row_idx').on(table.importerId, table.row, table.id),
    check('list_import_errors_row_positive', sql`${table.row} >= 1`),
    check('list_import_errors_code_valid', oneOf(table.code, IMPORT_ERROR_CODES)),
    check('list_import_errors_column_format', sql`${table.column} ~ '^[a-z][a-z_]{0,31}$'`),
  ],
);

/**
 * C127.12 (V03): the outbox of the `list-rescreen` job, written with `list.updated` in the list
 * write's transaction: one row per list version, so a retry or a second sweep repeats nothing. The
 * job adds one `list_update` run for each monitored custom-list report that selects the list.
 */
export const listRescreenRequests = pgTable(
  'list_rescreen_requests',
  {
    environmentId: environmentId(),
    listId: text('list_id').notNull(),
    listVersion: integer('list_version').notNull(),
    /** When the sweep last enqueued it. */
    enqueuedAt: timestamptz('enqueued_at'),
    processedAt: timestamptz('processed_at'),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'list_rescreen_requests_pkey',
      columns: [table.environmentId, table.listId, table.listVersion],
    }),
    foreignKey({
      name: 'list_rescreen_requests_list_fk',
      columns: [table.environmentId, table.listId],
      foreignColumns: [lists.environmentId, lists.id],
    }).onDelete('cascade'),
    // The sweep's rows, oldest first.
    index('list_rescreen_requests_unprocessed_idx')
      .on(table.createdAt)
      .where(sql`${table.processedAt} is null`),
    check('list_rescreen_requests_version_positive', sql`${table.listVersion} >= 1`),
  ],
);

export type ListRow = typeof lists.$inferSelect;
export type ListItemRow = typeof listItems.$inferSelect;
export type ListItemKeyRow = typeof listItemKeys.$inferSelect;
export type ListItemFaceRow = typeof listItemFaces.$inferSelect;
export type ListItemBackgroundRow = typeof listItemBackgrounds.$inferSelect;
export type ListMatchRow = typeof listMatches.$inferSelect;
export type ListScreeningRow = typeof listScreenings.$inferSelect;
export type ImporterRow = typeof importers.$inferSelect;
export type ListImportRowRow = typeof listImportRows.$inferSelect;
export type ListImportErrorRow = typeof listImportErrors.$inferSelect;
export type ListRescreenRequestRow = typeof listRescreenRequests.$inferSelect;
