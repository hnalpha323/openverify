/**
 * C73.3: the install-wide watchlist tables. They hold no `environment_id`: list data is public
 * and not sealed, but it is personal data all the same, so C76.8 limits how long removed entries
 * stay. Nothing here is committed or shipped (ADR 0005): the operator's `watchlists:sync` and
 * `pep:sync` fill them, and `seed:dev` imports the two synthetic sandbox lists.
 *
 * - `watchlist_sources`: one row per manifest source (`watchlists/sources.json`), reconciled at
 *   every startup (C76.4): `enabled` and `sandbox_only` are written by the reconciliation alone;
 *   the rest records the last check, the last applied sync and the keys version (V04).
 * - `watchlist_syncs`: the audit of every sync, refusal and re-key, with the re-screen state of
 *   an applied sync (C74.4, V05).
 * - `watchlist_entries`, `_names`, `_identifiers`, `_crypto_addresses`: the normalised records
 *   (C77.1) and what retrieval reads (C78.3); `watchlist_key_df` the key document frequencies.
 *
 * The values each text column takes are spelled out here, so drizzle-kit loads this file
 * without building another package; the API's tests compare them with `@openverify/contracts`
 * and `@openverify/watchlist`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, hexDigest, timestamptz, updatedAt } from './columns.js';

const oneOf = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

/** C73.3: what a sync ended with (`WATCHLIST_SYNC_OUTCOMES` in `@openverify/contracts`). */
export const WATCHLIST_SYNC_OUTCOME_VALUES = [
  'applied',
  'unchanged',
  'rekeyed',
  'busy',
  'refused_rollback',
  'refused_future',
  'refused_mass_removal',
  'refused_schema',
  'refused_size',
  'refused_matcher_data',
  'error',
] as const;
export const WATCHLIST_SYNC_ACTOR_VALUES = ['cli', 'job', 'seed'] as const;
export const WATCHLIST_ORIGIN_VALUES = ['publisher', 'import'] as const;
export const WATCHLIST_SYNC_OVERRIDE_VALUES = [
  'allow-mass-removal',
  'accept-older-publication',
  'allow-normalised',
] as const;
export const WATCHLIST_RESCREEN_STATE_VALUES = ['none', 'pending', 'done'] as const;
/** C77.1 (`WATCHLIST_ENTRY_KINDS` in `@openverify/watchlist`). */
export const WATCHLIST_ENTRY_KIND_VALUES = ['individual', 'entity', 'vessel', 'aircraft'] as const;
export const WATCHLIST_NAME_QUALITY_VALUES = ['strong', 'weak'] as const;
/** C77.1 (`IDENTIFIER_KINDS` in `@openverify/watchlist`). */
export const WATCHLIST_IDENTIFIER_KIND_VALUES = [
  'passport',
  'national_id',
  'tax_id',
  'registration_number',
  'lei',
  'swift_bic',
  'imo',
  'mmsi',
  'aircraft_serial',
  'aircraft_tail',
  'website',
  'email',
  'other',
] as const;

/** A manifest source id, such as `ofac-sdn` (`watchlistSourceIdSchema`). */
const sourceIdFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and char_length(${column}) <= 64`);

/** A code such as `source_not_configured`. */
const codeFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[a-z][a-z0-9_]{0,63}$'`);

/** A partial date as C77.1 writes it: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
const partialDateFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$'`);

/** C254.2: how a source's file was last validated (`WATCHLIST_VALIDATED_BY` in contracts). */
export const WATCHLIST_VALIDATED_BY_VALUES = ['http-304', 'sha256'] as const;

export const watchlistSources = pgTable(
  'watchlist_sources',
  {
    id: text('id').primaryKey(),
    /** The manifest's `enabled_by_default`, less `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`. */
    enabled: boolean('enabled').notNull().default(false),
    sandboxOnly: boolean('sandbox_only').notNull().default(false),
    /** The `keysVersion()` the stored keys were built with (C78.3, V04). */
    keysVersion: text('keys_version'),
    lastSyncId: bigint('last_sync_id', { mode: 'number' }),
    lastPublishedAt: timestamptz('last_published_at'),
    lastSha256: text('last_sha256'),
    lastAppliedAt: timestamptz('last_applied_at'),
    /** The last successful check, which freshness counts from (C76.3). */
    lastCheckedAt: timestamptz('last_checked_at'),
    lastOrigin: text('last_origin').$type<(typeof WATCHLIST_ORIGIN_VALUES)[number]>(),
    /** `source_not_configured` among them (C76.2); `null` after a successful check. */
    lastErrorCode: text('last_error_code'),
    /**
     * Owner decision 6 (K6A-11): checks that failed since the last successful one (a download
     * error or a refusal), which the refresh tick's back-off doubles on; a good check resets it.
     */
    checkFailures: integer('check_failures').notNull().default(0),
    /** When the last of those failures happened; `null` after a successful check. */
    lastFailedAt: timestamptz('last_failed_at'),
    /**
     * C254.2 (Workflow 11B Stage 1b (D)): the last validation of the publisher's file, how it was
     * made (`http-304`: the publisher's statement; `sha256`: the platform's own digest comparison)
     * and the last full download and comparison, which runs at least every
     * `watchlist-full-check-hours` whatever the 304s say. `null` until known.
     */
    lastValidatedAt: timestamptz('last_validated_at'),
    validatedBy: text('validated_by').$type<(typeof WATCHLIST_VALIDATED_BY_VALUES)[number]>(),
    lastFullCheckAt: timestamptz('last_full_check_at'),
    /** C254.2: the validators the last full download carried, sent on a conditional request. */
    lastEtag: text('last_etag'),
    lastModified: text('last_modified'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    sourceIdFormat('watchlist_sources_id_format', table.id),
    hexDigest('watchlist_sources_last_sha256_hex', table.lastSha256),
    check('watchlist_sources_last_origin_valid', oneOf(table.lastOrigin, WATCHLIST_ORIGIN_VALUES)),
    codeFormat('watchlist_sources_last_error_code_format', table.lastErrorCode),
    check('watchlist_sources_check_failures_non_negative', sql`${table.checkFailures} >= 0`),
    check(
      'watchlist_sources_validated_by_valid',
      oneOf(table.validatedBy, WATCHLIST_VALIDATED_BY_VALUES),
    ),
    check(
      'watchlist_sources_validators_size',
      sql`(${table.lastEtag} is null or char_length(${table.lastEtag}) <= 256)
        and (${table.lastModified} is null or char_length(${table.lastModified}) <= 64)`,
    ),
  ],
);

export const watchlistSyncs = pgTable(
  'watchlist_syncs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    sourceId: text('source_id').notNull(),
    startedAt: timestamptz('started_at').notNull(),
    finishedAt: timestamptz('finished_at'),
    outcome: text('outcome').$type<(typeof WATCHLIST_SYNC_OUTCOME_VALUES)[number]>().notNull(),
    publishedAt: timestamptz('published_at'),
    sha256: text('sha256'),
    entryCount: integer('entry_count').notNull().default(0),
    added: integer('added').notNull().default(0),
    changed: integer('changed').notNull().default(0),
    removed: integer('removed').notNull().default(0),
    actor: text('actor').$type<(typeof WATCHLIST_SYNC_ACTOR_VALUES)[number]>().notNull(),
    origin: text('origin').$type<(typeof WATCHLIST_ORIGIN_VALUES)[number]>(),
    override: text('override').$type<(typeof WATCHLIST_SYNC_OVERRIDE_VALUES)[number]>(),
    keysVersion: text('keys_version'),
    /** C74.4 (V05): `pending` once an applied sync added or changed entries. */
    rescreenState: text('rescreen_state')
      .$type<(typeof WATCHLIST_RESCREEN_STATE_VALUES)[number]>()
      .notNull()
      .default('none'),
    rescreenEnqueuedAt: timestamptz('rescreen_enqueued_at'),
  },
  (table) => [
    foreignKey({
      name: 'watchlist_syncs_source_fk',
      columns: [table.sourceId],
      foreignColumns: [watchlistSources.id],
    }),
    index('watchlist_syncs_source_id_started_at_idx').on(
      table.sourceId,
      table.startedAt.desc().nullsFirst(),
    ),
    // C74.3 (c): the sweep's pending re-screens.
    index('watchlist_syncs_rescreen_pending_idx')
      .on(table.rescreenEnqueuedAt)
      .where(sql`${table.rescreenState} = 'pending'`),
    check('watchlist_syncs_outcome_valid', oneOf(table.outcome, WATCHLIST_SYNC_OUTCOME_VALUES)),
    check('watchlist_syncs_actor_valid', oneOf(table.actor, WATCHLIST_SYNC_ACTOR_VALUES)),
    check('watchlist_syncs_origin_valid', oneOf(table.origin, WATCHLIST_ORIGIN_VALUES)),
    check('watchlist_syncs_override_valid', oneOf(table.override, WATCHLIST_SYNC_OVERRIDE_VALUES)),
    check(
      'watchlist_syncs_rescreen_state_valid',
      oneOf(table.rescreenState, WATCHLIST_RESCREEN_STATE_VALUES),
    ),
    check(
      'watchlist_syncs_counts_non_negative',
      sql`${table.entryCount} >= 0 and ${table.added} >= 0 and ${table.changed} >= 0 and ${table.removed} >= 0`,
    ),
    hexDigest('watchlist_syncs_sha256_hex', table.sha256),
  ],
);

export const watchlistEntries = pgTable(
  'watchlist_entries',
  {
    sourceId: text('source_id').notNull(),
    /** The publisher's id of the entry. */
    entryId: text('entry_id').notNull(),
    kind: text('kind').$type<(typeof WATCHLIST_ENTRY_KIND_VALUES)[number]>().notNull(),
    /** C77.3: the SHA-256 of what matching reads (lower-case hex). */
    contentHash: text('content_hash').notNull(),
    /** C77.3 (V06): the SHA-256 of the programmes, listing date, positions and relations. */
    riskDataHash: text('risk_data_hash').notNull(),
    /** The normalised record (C77.1, snake_case). */
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    programs: text('programs')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    listedAt: text('listed_at'),
    firstSeenSyncId: bigint('first_seen_sync_id', { mode: 'number' }).notNull(),
    lastSeenSyncId: bigint('last_seen_sync_id', { mode: 'number' }).notNull(),
    /** The sync that added it or last changed its content or risk-data hash (V05). */
    changedSyncId: bigint('changed_sync_id', { mode: 'number' }).notNull(),
    removedAt: timestamptz('removed_at'),
  },
  (table) => [
    primaryKey({ name: 'watchlist_entries_pkey', columns: [table.sourceId, table.entryId] }),
    foreignKey({
      name: 'watchlist_entries_source_fk',
      columns: [table.sourceId],
      foreignColumns: [watchlistSources.id],
    }),
    index('watchlist_entries_source_id_changed_sync_id_idx').on(
      table.sourceId,
      table.changedSyncId,
    ),
    // C74.4 (Workflow 6D review): a page of a sync's live changed entries, in "C" order, is an
    // index range (`listChangedWatchlistEntries`), not a sort of the whole changed set.
    index('watchlist_entries_changed_page_idx')
      .on(table.sourceId, table.changedSyncId, sql`${table.entryId} collate "C"`)
      .where(sql`${table.removedAt} is null`),
    index('watchlist_entries_source_id_removed_at_idx').on(table.sourceId, table.removedAt),
    check('watchlist_entries_kind_valid', oneOf(table.kind, WATCHLIST_ENTRY_KIND_VALUES)),
    check(
      'watchlist_entries_entry_id_length',
      sql`char_length(${table.entryId}) between 1 and 200`,
    ),
    hexDigest('watchlist_entries_content_hash_hex', table.contentHash),
    hexDigest('watchlist_entries_risk_data_hash_hex', table.riskDataHash),
    partialDateFormat('watchlist_entries_listed_at_format', table.listedAt),
  ],
);

/** The parts of an entry (names, identifiers, crypto addresses) go with it. */
const entryKey = (name: string, sourceId: AnyPgColumn, entryId: AnyPgColumn) =>
  foreignKey({
    name,
    columns: [sourceId, entryId],
    foreignColumns: [watchlistEntries.sourceId, watchlistEntries.entryId],
  }).onDelete('cascade');

export const watchlistNames = pgTable(
  'watchlist_names',
  {
    sourceId: text('source_id').notNull(),
    entryId: text('entry_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    name: text('name').notNull(),
    normalised: text('normalised').notNull(),
    /** A C58 writing system. */
    script: text('script').notNull(),
    quality: text('quality').$type<(typeof WATCHLIST_NAME_QUALITY_VALUES)[number]>().notNull(),
    primary: boolean('primary').notNull().default(false),
    /** C78.3: `t:`, `s:`, `g:` and `j:` keys of the source's `keys_version`. */
    keys: text('keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (table) => [
    primaryKey({
      name: 'watchlist_names_pkey',
      columns: [table.sourceId, table.entryId, table.ordinal],
    }),
    entryKey('watchlist_names_entry_fk', table.sourceId, table.entryId),
    index('watchlist_names_keys_idx').using('gin', table.keys),
    // C78.3: the trigram path for single-token queries and empty key sets.
    index('watchlist_names_normalised_trgm_idx').using('gin', table.normalised.op('gin_trgm_ops')),
    // C78.3: weak aliases are looked up by exact normalised equality only.
    index('watchlist_names_normalised_idx').on(table.normalised),
    check('watchlist_names_ordinal_non_negative', sql`${table.ordinal} >= 0`),
    check('watchlist_names_quality_valid', oneOf(table.quality, WATCHLIST_NAME_QUALITY_VALUES)),
    check('watchlist_names_name_length', sql`char_length(${table.name}) between 1 and 300`),
  ],
);

export const watchlistIdentifiers = pgTable(
  'watchlist_identifiers',
  {
    sourceId: text('source_id').notNull(),
    entryId: text('entry_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    kind: text('kind').$type<(typeof WATCHLIST_IDENTIFIER_KIND_VALUES)[number]>().notNull(),
    valueNormalised: text('value_normalised').notNull(),
    /** ISO 3166-1 alpha-2, when the list states one. */
    country: text('country'),
  },
  (table) => [
    primaryKey({
      name: 'watchlist_identifiers_pkey',
      columns: [table.sourceId, table.entryId, table.ordinal],
    }),
    entryKey('watchlist_identifiers_entry_fk', table.sourceId, table.entryId),
    index('watchlist_identifiers_kind_value_normalised_idx').on(table.kind, table.valueNormalised),
    check('watchlist_identifiers_kind_valid', oneOf(table.kind, WATCHLIST_IDENTIFIER_KIND_VALUES)),
    check('watchlist_identifiers_country_format', sql`${table.country} ~ '^[A-Z]{2}$'`),
    check(
      'watchlist_identifiers_value_length',
      sql`char_length(${table.valueNormalised}) between 1 and 100`,
    ),
  ],
);

export const watchlistCryptoAddresses = pgTable(
  'watchlist_crypto_addresses',
  {
    sourceId: text('source_id').notNull(),
    entryId: text('entry_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    /** CAIP-2, or `unknown` when the format names no chain (C79.3). */
    chain: text('chain').notNull(),
    canonical: text('canonical').notNull(),
    raw: text('raw').notNull(),
    /** The list's ticker, as metadata only (OFAC tickers name no chain). */
    ticker: text('ticker'),
  },
  (table) => [
    primaryKey({
      name: 'watchlist_crypto_addresses_pkey',
      columns: [table.sourceId, table.entryId, table.ordinal],
    }),
    entryKey('watchlist_crypto_addresses_entry_fk', table.sourceId, table.entryId),
    index('watchlist_crypto_addresses_canonical_idx').on(table.canonical),
    check(
      'watchlist_crypto_addresses_chain_format',
      sql`${table.chain} = 'unknown' or ${table.chain} ~ '^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$'`,
    ),
    check(
      'watchlist_crypto_addresses_length',
      sql`char_length(${table.raw}) between 1 and 256 and char_length(${table.canonical}) between 1 and 256`,
    ),
  ],
);

/** C78.3: how many of a source's names carry each key, rebuilt with each applied sync. */
export const watchlistKeyDf = pgTable(
  'watchlist_key_df',
  {
    sourceId: text('source_id').notNull(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [
    primaryKey({ name: 'watchlist_key_df_pkey', columns: [table.sourceId, table.key] }),
    foreignKey({
      name: 'watchlist_key_df_source_fk',
      columns: [table.sourceId],
      foreignColumns: [watchlistSources.id],
    }).onDelete('cascade'),
    check('watchlist_key_df_count_positive', sql`${table.count} >= 1`),
  ],
);

export type WatchlistSourceRow = typeof watchlistSources.$inferSelect;
export type WatchlistSyncRow = typeof watchlistSyncs.$inferSelect;
export type WatchlistEntryRow = typeof watchlistEntries.$inferSelect;
export type WatchlistNameRow = typeof watchlistNames.$inferSelect;
export type WatchlistIdentifierRow = typeof watchlistIdentifiers.$inferSelect;
export type WatchlistCryptoAddressRow = typeof watchlistCryptoAddresses.$inferSelect;
export type WatchlistKeyDfRow = typeof watchlistKeyDf.$inferSelect;
