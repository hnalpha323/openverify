/**
 * C53.3, C62.7: the install-wide CSCA trust store. Nothing here is personal data, and nothing is
 * committed or shipped: the operator's `trust-anchors:sync` fills it from verified master lists,
 * and `seed:dev` adds the deterministic Utopia test CSCA as a `sandbox_only` anchor (C62.8).
 *
 * An anchor is withdrawn when no enabled source still lists it (`trust_anchor_memberships` with
 * `withdrawn_at` null); Passive Authentication then answers `trust_anchor_withdrawn`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { createdAt, hexDigest, timestamptz } from './columns.js';

/** `bytea` read and written as a `Buffer`. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** A source id, such as `bsi-de` (C62.7 `trust-anchors/manifest.json`). */
const SOURCE_ID = `'^[a-z0-9][a-z0-9-]{1,31}$'`;

export const trustAnchorSources = pgTable(
  'trust_anchor_sources',
  {
    id: text('id').primaryKey(),
    enabled: boolean('enabled').notNull().default(true),
    /** The CMS `signingTime` of the last list accepted (rollback refusal, C62.7). */
    lastSigningTime: timestamptz('last_signing_time'),
    lastListSha256: text('last_list_sha256'),
    lastSyncedAt: timestamptz('last_synced_at'),
    createdAt: createdAt(),
  },
  (table) => [
    check('trust_anchor_sources_id_format', sql`${table.id} ~ ${sql.raw(SOURCE_ID)}`),
    hexDigest('trust_anchor_sources_last_list_sha256_hex', table.lastListSha256),
  ],
);

export const trustAnchors = pgTable(
  'trust_anchors',
  {
    /** The certificate's SHA-256, lower-case hex: the anchor's key. */
    sha256: text('sha256').primaryKey(),
    /** ISO 3166-1 alpha-2 of the CSCA (`UT` for Utopia). */
    country: text('country').notNull(),
    subjectDn: text('subject_dn').notNull(),
    ski: text('ski'),
    aki: text('aki'),
    certificate: bytea('certificate').notNull(),
    notBefore: timestamptz('not_before').notNull(),
    notAfter: timestamptz('not_after').notNull(),
    isLink: boolean('is_link').notNull().default(false),
    /** C62.8: given only to sandbox environments (the loader filters it out in SQL). */
    sandboxOnly: boolean('sandbox_only').notNull().default(false),
    firstSeenAt: timestamptz('first_seen_at').notNull().defaultNow(),
  },
  (table) => [
    hexDigest('trust_anchors_sha256_hex', table.sha256),
    check('trust_anchors_country_format', sql`${table.country} ~ '^[A-Z]{2}$'`),
    check('trust_anchors_ski_hex', sql`${table.ski} ~ '^[0-9a-f]{2,128}$'`),
    check('trust_anchors_aki_hex', sql`${table.aki} ~ '^[0-9a-f]{2,128}$'`),
    index('trust_anchors_country_idx').on(table.country),
    index('trust_anchors_ski_idx')
      .on(table.ski)
      .where(sql`${table.ski} is not null`),
  ],
);

export const trustAnchorMemberships = pgTable(
  'trust_anchor_memberships',
  {
    sourceId: text('source_id').notNull(),
    anchorId: text('anchor_id').notNull(),
    /** The `signingTime` of the list that last carried it. */
    listSigningTime: timestamptz('list_signing_time').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull(),
    /** Set when a newer list of the source no longer carries it (C62.7). */
    withdrawnAt: timestamptz('withdrawn_at'),
  },
  (table) => [
    primaryKey({
      name: 'trust_anchor_memberships_pkey',
      columns: [table.sourceId, table.anchorId],
    }),
    foreignKey({
      name: 'trust_anchor_memberships_source_fk',
      columns: [table.sourceId],
      foreignColumns: [trustAnchorSources.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'trust_anchor_memberships_anchor_fk',
      columns: [table.anchorId],
      foreignColumns: [trustAnchors.sha256],
    }).onDelete('cascade'),
    index('trust_anchor_memberships_anchor_id_idx').on(table.anchorId),
  ],
);

export const trustCrls = pgTable(
  'trust_crls',
  {
    /** The CRL's SHA-256, lower-case hex. */
    sha256: text('sha256').primaryKey(),
    issuerCountry: text('issuer_country').notNull(),
    issuerKeyId: text('issuer_key_id'),
    der: bytea('der').notNull(),
    thisUpdate: timestamptz('this_update').notNull(),
    nextUpdate: timestamptz('next_update'),
    /** `cRLNumber`, decimal; never below the stored one (C62.7). */
    crlNumber: text('crl_number'),
    /** Where the sync fetched it; operator configuration, not personal data. */
    url: text('url'),
    fetchedAt: timestamptz('fetched_at').notNull().defaultNow(),
  },
  (table) => [
    hexDigest('trust_crls_sha256_hex', table.sha256),
    check('trust_crls_issuer_country_format', sql`${table.issuerCountry} ~ '^[A-Z]{2}$'`),
    check('trust_crls_issuer_key_id_hex', sql`${table.issuerKeyId} ~ '^[0-9a-f]{2,128}$'`),
    check('trust_crls_crl_number_decimal', sql`${table.crlNumber} ~ '^[0-9]{1,48}$'`),
    index('trust_crls_issuer_country_issuer_key_id_idx').on(table.issuerCountry, table.issuerKeyId),
  ],
);

export const TRUST_ANCHOR_SYNC_OUTCOME_VALUES = ['accepted', 'refused', 'failed'] as const;

/** C62.7: one row per sync of a source, or per import, with its outcome (the audit trail). */
export const trustAnchorSyncs = pgTable(
  'trust_anchor_syncs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** `null` for an operator `--import` without a configured source. */
    sourceId: text('source_id'),
    outcome: text('outcome').$type<(typeof TRUST_ANCHOR_SYNC_OUTCOME_VALUES)[number]>().notNull(),
    /** Why a list or CRL was refused, as a code (`rollback`, `signature_invalid`, …). */
    reason: text('reason'),
    listSha256: text('list_sha256'),
    listSigningTime: timestamptz('list_signing_time'),
    anchorsSeen: integer('anchors_seen').notNull().default(0),
    anchorsWithdrawn: integer('anchors_withdrawn').notNull().default(0),
    crlsUpdated: integer('crls_updated').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      'trust_anchor_syncs_outcome_valid',
      sql`${table.outcome} in (${sql.raw(TRUST_ANCHOR_SYNC_OUTCOME_VALUES.map((value) => `'${value}'`).join(', '))})`,
    ),
    check('trust_anchor_syncs_reason_format', sql`${table.reason} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    hexDigest('trust_anchor_syncs_list_sha256_hex', table.listSha256),
    index('trust_anchor_syncs_source_id_created_at_idx').on(table.sourceId, table.createdAt),
  ],
);
