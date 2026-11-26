/**
 * Network data (plan C91.3, C92, C93; ADR 0006), Workflow 7A Stage 1b checkpoint (N).
 *
 * - `network_sources` and `network_syncs` are install-wide, as `watchlist_sources` and
 *   `watchlist_syncs` are: the operator-synced publications (DB-IP Lite, the Tor exit list, the
 *   cloud providers' ranges, the sandbox source) are public data, never about a subject.
 *   `network_sources` holds one row per manifest source (`network/sources.json`), reconciled at
 *   every startup (C92.5); `network_syncs` audits every check, apply and refusal, with the sizes the
 *   mass-change guards compare (C92.2) and when an applied snapshot was superseded and purged
 *   (C92.3). The snapshot object itself is `network/<source>/<sha256>` in object storage,
 *   unenveloped (decision 44), its SHA-256 re-checked at every load.
 * - `networks` is environment-scoped: one row per evaluation of a session's address (C93.2), the
 *   public `network` resource (`net_`). The address and the City Lite location are sealed for the
 *   row; country, ASN, the flags and the reasons are derived facts without the address, kept plain
 *   and kept after redaction (C91.4).
 *
 * Every value set is spelled out here, so drizzle-kit loads this file without building another
 * package; the API's tests compare them with `@openverify/contracts`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import {
  countryCodeFormat,
  createdAt,
  hexDigest,
  idFormat,
  oneOf,
  timestamptz,
  trueOrNull,
  updatedAt,
} from './columns.js';
import { environmentId } from './environment-id.js';
import { inquirySessions } from './inquiries.js';

/**
 * C92.2: what a network sync ended with (`network-data`'s and `api-network`'s outcome names). The
 * sync refuses rather than applies on a rollback, a future publication, a mass removal or
 * addition, a bad schema, an oversize body or a publisher digest that does not match; `error` is a
 * failed check (download or parse), with `error_code`.
 */
export const NETWORK_SYNC_OUTCOME_VALUES = [
  'applied',
  'unchanged',
  'busy',
  'refused_rollback',
  'refused_future',
  'refused_mass_removal',
  'refused_mass_addition',
  'refused_schema',
  'refused_size',
  'refused_digest',
  'error',
] as const;
export const NETWORK_SYNC_ACTOR_VALUES = ['cli', 'job', 'seed'] as const;
export const NETWORK_ORIGIN_VALUES = ['publisher', 'import'] as const;
/** C92.2: the audited overrides of the guards, any of which one sync may carry. */
export const NETWORK_SYNC_OVERRIDE_VALUES = [
  'allow-mass-removal',
  'allow-mass-addition',
  'accept-older-publication',
] as const;
/** C91.3: the network's threat level; the public vocabulary has `unknown` where a session has `null`. */
export const NETWORK_THREAT_LEVEL_VALUES = ['unknown', 'low', 'medium', 'high'] as const;
/** C93.1 (P05): how the API resolved the address it judged (`CLIENT_ADDRESS_SOURCES`). */
export const CLIENT_ADDRESS_SOURCE_VALUES = [
  'socket',
  'trusted-list',
  'hop-count',
  'trust-all',
] as const;

/** A manifest source id, such as `dbip-country-lite`. */
const sourceIdFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and char_length(${column}) <= 64`);

/** A code such as `download_failed`. */
const codeFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[a-z][a-z0-9_]{0,63}$'`);

export const networkSources = pgTable(
  'network_sources',
  {
    id: text('id').primaryKey(),
    /**
     * The manifest's `enabled_by_default`, less `OPENVERIFY_NETWORK_SOURCES_DISABLED`, plus
     * `OPENVERIFY_NETWORK_SOURCES_ENABLED` (C92.5); written by the reconciliation alone.
     */
    enabled: boolean('enabled').notNull().default(false),
    /** The sandbox source: never read for a production environment, never stale (C92.3, C92.4). */
    sandboxOnly: boolean('sandbox_only').notNull().default(false),
    /** The applied sync whose snapshot the processes load (`network_syncs.id`). */
    lastSyncId: bigint('last_sync_id', { mode: 'number' }),
    lastPublishedAt: timestamptz('last_published_at'),
    /** The SHA-256 of the applied snapshot, which every load re-checks (decision 44). */
    lastSha256: text('last_sha256'),
    lastAppliedAt: timestamptz('last_applied_at'),
    /** The last successful check, which freshness counts from (C92.4, as C76.3). */
    lastCheckedAt: timestamptz('last_checked_at'),
    lastOrigin: text('last_origin').$type<(typeof NETWORK_ORIGIN_VALUES)[number]>(),
    /** `source_not_configured` among them; `null` after a successful check. */
    lastErrorCode: text('last_error_code'),
    /** Checks failed since the last successful one, which the refresh tick backs off on. */
    checkFailures: integer('check_failures').notNull().default(0),
    lastFailedAt: timestamptz('last_failed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    sourceIdFormat('network_sources_id_format', table.id),
    hexDigest('network_sources_last_sha256_hex', table.lastSha256),
    check('network_sources_last_origin_valid', oneOf(table.lastOrigin, NETWORK_ORIGIN_VALUES)),
    codeFormat('network_sources_last_error_code_format', table.lastErrorCode),
    check('network_sources_check_failures_non_negative', sql`${table.checkFailures} >= 0`),
  ],
);

export const networkSyncs = pgTable(
  'network_syncs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    sourceId: text('source_id').notNull(),
    startedAt: timestamptz('started_at').notNull(),
    finishedAt: timestamptz('finished_at'),
    outcome: text('outcome').$type<(typeof NETWORK_SYNC_OUTCOME_VALUES)[number]>().notNull(),
    /** Why a check failed (`outcome` `error`), as a code; never a message or a URL. */
    errorCode: text('error_code'),
    /** C92.2: the MMDB `build_epoch`, a range file's own time, or the exit list's newest entry. */
    publishedAt: timestamptz('published_at'),
    sha256: text('sha256'),
    /** The snapshot object's size: the MMDB guard refuses one under half the applied size. */
    snapshotBytes: bigint('snapshot_bytes', { mode: 'number' }),
    /** Merged intervals, exit addresses or MMDB records, as the source's parser counts them. */
    entryCount: integer('entry_count').notNull().default(0),
    /** IPv4 addresses the range set covers (at most 2^32), for the mass-change guards. */
    coveredIpv4: bigint('covered_ipv4', { mode: 'number' }),
    /** IPv6 addresses it covers (up to 2^128), as a decimal string. */
    coveredIpv6: numeric('covered_ipv6', { precision: 39, scale: 0 }),
    actor: text('actor').$type<(typeof NETWORK_SYNC_ACTOR_VALUES)[number]>().notNull(),
    origin: text('origin').$type<(typeof NETWORK_ORIGIN_VALUES)[number]>(),
    /** The guards this sync was told to pass (`--allow-mass-removal` and the others). */
    overrides: text('overrides')
      .array()
      .$type<(typeof NETWORK_SYNC_OVERRIDE_VALUES)[number][]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** When a later applied sync of the source replaced this one's snapshot (C92.3). */
    supersededAt: timestamptz('superseded_at'),
    /** When the purge deleted the snapshot object, 7 days after supersession (C92.3, P27). */
    snapshotDeletedAt: timestamptz('snapshot_deleted_at'),
  },
  (table) => [
    foreignKey({
      name: 'network_syncs_source_fk',
      columns: [table.sourceId],
      foreignColumns: [networkSources.id],
    }),
    index('network_syncs_source_id_started_at_idx').on(
      table.sourceId,
      table.startedAt.desc().nullsFirst(),
    ),
    // C92.3 (P27): the purge's superseded snapshots that are still stored.
    index('network_syncs_superseded_snapshot_idx')
      .on(table.supersededAt)
      .where(
        sql`${table.outcome} = 'applied' and ${table.snapshotDeletedAt} is null and ${table.supersededAt} is not null`,
      ),
    check('network_syncs_outcome_valid', oneOf(table.outcome, NETWORK_SYNC_OUTCOME_VALUES)),
    check('network_syncs_actor_valid', oneOf(table.actor, NETWORK_SYNC_ACTOR_VALUES)),
    check('network_syncs_origin_valid', oneOf(table.origin, NETWORK_ORIGIN_VALUES)),
    check(
      'network_syncs_overrides_valid',
      sql`${table.overrides} <@ array[${sql.raw(NETWORK_SYNC_OVERRIDE_VALUES.map((value) => `'${value}'`).join(', '))}]::text[]`,
    ),
    codeFormat('network_syncs_error_code_format', table.errorCode),
    hexDigest('network_syncs_sha256_hex', table.sha256),
    check(
      'network_syncs_sizes_non_negative',
      sql`${table.entryCount} >= 0 and ${table.snapshotBytes} >= 0 and ${table.coveredIpv6} >= 0
        and ${table.coveredIpv4} between 0 and 4294967296`,
    ),
  ],
);

export const networks = pgTable(
  'networks',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    inquirySessionId: text('inquiry_session_id').notNull(),
    /** The evaluated address (`request.ip`, IPv4-mapped folded), sealed for the row (C91.6). */
    ipSealed: sealedColumn('ip'),
    /** `NetworkLocation` from City Lite, sealed for the row; `null` without it (C91.6). */
    locationSealed: sealedColumn('location'),
    /** The AS organisation (DB-IP ASN Lite). */
    serviceProvider: text('service_provider'),
    /** `datacenter` from provider ranges only, or an adapter's value (H13). */
    serviceType: text('service_type'),
    /** `tor`, `vpn`, an adapter's value, or `null`. */
    proxyType: text('proxy_type'),
    threatLevel: text('threat_level')
      .$type<(typeof NETWORK_THREAT_LEVEL_VALUES)[number]>()
      .notNull()
      .default('unknown'),
    countryCode: text('country_code'),
    countryName: text('country_name'),
    asn: bigint('asn', { mode: 'number' }),
    /** Ours, H (`beta`): `true` or `null`, with its confidence. */
    hostingAsn: boolean('hosting_asn'),
    hostingAsnConfidence: doublePrecision('hosting_asn_confidence'),
    /** C92.1: in Apple's egress list when that source is enabled; never raises a level. */
    privacyRelay: boolean('privacy_relay'),
    /** C93.1 (P05): how the address was resolved; `trust-all` in production nulls every fact. */
    clientAddressSource: text('client_address_source')
      .$type<(typeof CLIENT_ADDRESS_SOURCE_VALUES)[number]>()
      .notNull(),
    evaluatedAt: timestamptz('evaluated_at').notNull(),
    /** C90.3: `{ field, reason }` for each `null` fact and each limit (`networkReasonSchema`). */
    reasons: jsonb('reasons')
      .$type<{ field: string; reason: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** C90.3 provenance: each source read (`signalSourceSchema`): sync id, publication, SHA-256. */
    sources: jsonb('sources')
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'networks_inquiry_session_fk',
      columns: [table.environmentId, table.inquirySessionId],
      foreignColumns: [inquirySessions.environmentId, inquirySessions.id],
    }).onDelete('cascade'),
    // C93.2: one evaluation per session; its facts are frozen, never re-evaluated.
    uniqueIndex('networks_environment_id_inquiry_session_id_key').on(
      table.environmentId,
      table.inquirySessionId,
    ),
    // The C16 retention steps (C91.7) walk an environment's networks oldest first or by age.
    index('networks_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('networks', table.id, 'net'),
    check('networks_threat_level_valid', oneOf(table.threatLevel, NETWORK_THREAT_LEVEL_VALUES)),
    check(
      'networks_client_address_source_valid',
      oneOf(table.clientAddressSource, CLIENT_ADDRESS_SOURCE_VALUES),
    ),
    check('networks_asn_range', sql`${table.asn} between 0 and 4294967295`),
    countryCodeFormat('networks_country_code_format', table.countryCode),
    trueOrNull('networks_hosting_asn_true_or_null', table.hostingAsn),
    trueOrNull('networks_privacy_relay_true_or_null', table.privacyRelay),
    check(
      'networks_hosting_asn_confidence_range',
      sql`${table.hostingAsnConfidence} between 0 and 1`,
    ),
  ],
);

export type NetworkSourceRow = typeof networkSources.$inferSelect;
export type NetworkSyncRow = typeof networkSyncs.$inferSelect;
export type NetworkRow = typeof networks.$inferSelect;
