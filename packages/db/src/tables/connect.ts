/**
 * Phase 11, Workflow 11A (C230.5; ADR 0010): Connect, sharing a verified person's data between
 * organisations on one install. Declared by `foundation-11a` (Stage 1b); the repositories that write
 * them are `api-connect`'s (`repositories/connect-*.ts`, with their `*.cross-env.ts` twins).
 *
 * - `connect_connections`: organisation-scoped (a connection carries both environment kinds' tokens),
 *   one per ordered pair of organisations, a self-connection allowed (C230.2). Never deleted (C231.7).
 *   `agreement_reference` is the destination's data-sharing agreement reference at activation, sealed
 *   for the row (`connect_connections.agreement_reference#<id>`; C231.3). `current_policy_id` is set
 *   in the create transaction, after its version 1 is written (the two tables reference each other).
 * - `connect_share_policies`: a connection's policy versions, numbered from 1, frozen per version
 *   (C230.3, C231.6): the repository never updates a row.
 * - `connect_share_tokens`: scoped to the source environment; `destination_environment_id` is the
 *   destination organisation's environment of the same kind. The id is a handle, not a secret, so it
 *   is not hashed (C232.8). `data_categories` and `explicit_biometric` are fixed at creation (C230.4,
 *   review H04). One consent record authorises one token (C232.1): the unique index on
 *   `consent_record_id`. The inbound-list index and the partial index the minute expiry sweep reads
 *   (C232.5) are below.
 *
 * The value lists mirror `@openverify/contracts` (`CONNECTION_STATUSES`, `SHARE_TOKEN_STATUSES`, ...);
 * `apps/api`'s parity test holds them equal, since this package does not depend on the contracts.
 */
import { SHARE_CATEGORIES } from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
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
import { sealedColumn } from '../sealed.js';
import {
  createdAt,
  hexDigest,
  idColumnFormat,
  idFormat,
  oneOf,
  timestamptz,
  updatedAt,
} from './columns.js';
import { environmentId } from './environment-id.js';
import { environments, organizations } from './tenancy.js';

/** C230.2: `archived` is in the enum for parity and set by nothing in this release. */
export const CONNECTION_STATUS_VALUES = ['pending', 'active', 'inactive', 'archived'] as const;
/** Who created a connection or a policy version: a user or an API key (C230.2). */
export const CONNECTION_CREATOR_TYPE_VALUES = ['user', 'api-key'] as const;
export const CONNECT_SIDE_VALUES = ['source', 'destination'] as const;
/** C232.6: the vendor's statuses without `ready` (decision 21). */
export const SHARE_TOKEN_STATUS_VALUES = [
  'created',
  'pending',
  'redeemed',
  'expired',
  'failed',
] as const;
export const SHARE_TOKEN_FAILURE_REASON_VALUES = [
  'source_not_found',
  'source_redacted',
  'import_failed',
  'unrecoverable_error',
  'connection_inactive',
  'consent_withdrawn',
  'consent_expired',
  'consent_scope_exceeded',
  'source_is_copy',
] as const;
export const SHARE_TOKEN_EXPIRY_REASON_VALUES = [
  'time',
  'source_expired',
  'connection_deactivated',
  'consent_withdrawn',
] as const;
export const SHARE_SOURCE_TYPE_VALUES = [
  'inquiry',
  'account',
  'transaction',
  'verification',
] as const;
/** C234.1, C234.11: `fill-inquiry` is internal, never a route mode. */
export const SHARE_REDEEM_MODE_VALUES = ['clone', 'hydrate', 'fill-inquiry'] as const;
/** C243.1: a workflow creates and redeems tokens too. */
export const SHARE_TOKEN_CREATOR_TYPE_VALUES = ['user', 'api-key', 'workflow'] as const;
const ENVIRONMENT_KIND_VALUES = ['sandbox', 'production'] as const;

/** The id prefix each source type's id carries (C232.1). */
const SOURCE_ID_PREFIX = {
  inquiry: 'inq',
  account: 'acc',
  transaction: 'txn',
  verification: 'ver',
};

const textArrayOf = (values: readonly string[]) =>
  sql.raw(`array[${values.map((value) => `'${value}'`).join(', ')}]::text[]`);

export const connectConnections = pgTable(
  'connect_connections',
  {
    id: text('id').primaryKey(),
    sourceOrganizationId: text('source_organization_id')
      .notNull()
      .references(() => organizations.id),
    destinationOrganizationId: text('destination_organization_id')
      .notNull()
      .references(() => organizations.id),
    status: text('status').$type<(typeof CONNECTION_STATUS_VALUES)[number]>().notNull(),
    creatorType: text('creator_type')
      .$type<(typeof CONNECTION_CREATOR_TYPE_VALUES)[number]>()
      .notNull(),
    creatorId: text('creator_id').notNull(),
    /** The newest policy version; set in the create transaction once version 1 exists. */
    currentPolicyId: text('current_policy_id'),
    /** The version the destination last accepted at activation, or null (C230.2). */
    acceptedPolicyId: text('accepted_policy_id'),
    /** C231.3: the agreement reference, sealed for this row; null until the first activation. */
    agreementReference: sealedColumn('agreement_reference'),
    activatedAt: timestamptz('activated_at'),
    activatedByUserId: text('activated_by_user_id'),
    deactivatedAt: timestamptz('deactivated_at'),
    deactivatedBy: text('deactivated_by').$type<(typeof CONNECT_SIDE_VALUES)[number]>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('connect_connections_source_destination_key').on(
      table.sourceOrganizationId,
      table.destinationOrganizationId,
    ),
    index('connect_connections_destination_idx').on(table.destinationOrganizationId),
    foreignKey({
      name: 'connect_connections_current_policy_fk',
      columns: [table.id, table.currentPolicyId],
      foreignColumns: [connectSharePolicies.connectionId, connectSharePolicies.id],
    }),
    foreignKey({
      name: 'connect_connections_accepted_policy_fk',
      columns: [table.id, table.acceptedPolicyId],
      foreignColumns: [connectSharePolicies.connectionId, connectSharePolicies.id],
    }),
    idFormat('connect_connections', table.id, 'cxn'),
    check('connect_connections_status_valid', oneOf(table.status, CONNECTION_STATUS_VALUES)),
    check(
      'connect_connections_creator_type_valid',
      oneOf(table.creatorType, CONNECTION_CREATOR_TYPE_VALUES),
    ),
    check(
      'connect_connections_deactivated_by_valid',
      sql`${table.deactivatedBy} is null or ${oneOf(table.deactivatedBy, CONNECT_SIDE_VALUES)}`,
    ),
    check(
      'connect_connections_deactivated',
      sql`(${table.deactivatedAt} is null) = (${table.deactivatedBy} is null)`,
    ),
    check(
      'connect_connections_activated',
      sql`${table.activatedByUserId} is null or ${table.activatedAt} is not null`,
    ),
  ],
);

export const connectSharePolicies = pgTable(
  'connect_share_policies',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references((): AnyPgColumn => connectConnections.id),
    version: integer('version').notNull(),
    /** The policy body of this version (`sharePolicySchema`), frozen. */
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    createdByType: text('created_by_type')
      .$type<(typeof CONNECTION_CREATOR_TYPE_VALUES)[number]>()
      .notNull(),
    createdById: text('created_by_id').notNull(),
  },
  (table) => [
    unique('connect_share_policies_connection_id_version_key').on(
      table.connectionId,
      table.version,
    ),
    unique('connect_share_policies_connection_id_id_key').on(table.connectionId, table.id),
    idFormat('connect_share_policies', table.id, 'cxnp'),
    check('connect_share_policies_version_positive', sql`${table.version} >= 1`),
    check(
      'connect_share_policies_created_by_type_valid',
      oneOf(table.createdByType, CONNECTION_CREATOR_TYPE_VALUES),
    ),
  ],
);

export const connectShareTokens = pgTable(
  'connect_share_tokens',
  {
    /** The source environment. */
    environmentId: environmentId(),
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connectConnections.id),
    /** The policy version the token was created under, and redeems under (C231.6). */
    policyId: text('policy_id').notNull(),
    environmentKind: text('environment_kind')
      .$type<(typeof ENVIRONMENT_KIND_VALUES)[number]>()
      .notNull(),
    /** The destination organisation's environment of the same kind (C232.1, C234.1). */
    destinationEnvironmentId: text('destination_environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').$type<(typeof SHARE_SOURCE_TYPE_VALUES)[number]>().notNull(),
    sourceId: text('source_id').notNull(),
    /** The source-side consent record (C232.1); one record authorises one token. */
    consentRecordId: text('consent_record_id').notNull(),
    /** C230.4 (review H04): the categories computed at creation; the redeem job copies none else. */
    dataCategories: text('data_categories').array().notNull(),
    explicitBiometric: boolean('explicit_biometric').notNull().default(false),
    /** C233.5: peeks so far, counted under the token row lock (cap 10, provisional). */
    peekCount: integer('peek_count').notNull().default(0),
    status: text('status').$type<(typeof SHARE_TOKEN_STATUS_VALUES)[number]>().notNull(),
    expiryReason: text('expiry_reason').$type<(typeof SHARE_TOKEN_EXPIRY_REASON_VALUES)[number]>(),
    failureReason:
      text('failure_reason').$type<(typeof SHARE_TOKEN_FAILURE_REASON_VALUES)[number]>(),
    redeemMode: text('redeem_mode').$type<(typeof SHARE_REDEEM_MODE_VALUES)[number]>(),
    destinationType: text('destination_type').$type<(typeof SHARE_SOURCE_TYPE_VALUES)[number]>(),
    destinationId: text('destination_id'),
    /** C234.1: the destination-side consent record a redemption cited. */
    destinationConsentRecordId: text('destination_consent_record_id'),
    /** C238.5: the destination inquiry created with `meta.share-token-id` (one per token). */
    reservedInquiryId: text('reserved_inquiry_id'),
    /** C234.8: counts and keys only, never a value. */
    redeemSummary: jsonb('redeem_summary').$type<Record<string, unknown>>(),
    creatorType: text('creator_type')
      .$type<(typeof SHARE_TOKEN_CREATOR_TYPE_VALUES)[number]>()
      .notNull(),
    creatorId: text('creator_id').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    pendingAt: timestamptz('pending_at'),
    redeemedAt: timestamptz('redeemed_at'),
    expiredAt: timestamptz('expired_at'),
    failedAt: timestamptz('failed_at'),
    /** C251.1 (Workflow 11B Stage 1b (P)): when the queue's cap admitted this row's job; `null` while held. */
    admittedAt: timestamptz('admitted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('connect_share_tokens_environment_id_id_key').on(table.environmentId, table.id),
    foreignKey({
      name: 'connect_share_tokens_policy_fk',
      columns: [table.connectionId, table.policyId],
      foreignColumns: [connectSharePolicies.connectionId, connectSharePolicies.id],
    }),
    uniqueIndex('connect_share_tokens_consent_record_id_key').on(table.consentRecordId),
    // (K) C232.1: the source-side record the token cites, in the token's (source) environment.
    foreignKey({
      name: 'connect_share_tokens_consent_record_fk',
      columns: [table.environmentId, table.consentRecordId],
      foreignColumns: [consentRecords.environmentId, consentRecords.id],
    }),
    // (K) C234.1: the destination-side record a redemption cited, in the destination environment.
    foreignKey({
      name: 'connect_share_tokens_destination_consent_record_fk',
      columns: [table.destinationEnvironmentId, table.destinationConsentRecordId],
      foreignColumns: [consentRecords.environmentId, consentRecords.id],
    }),
    uniqueIndex('connect_share_tokens_destination_consent_record_id_key')
      .on(table.destinationConsentRecordId)
      .where(sql`${table.destinationConsentRecordId} is not null`),
    uniqueIndex('connect_share_tokens_reserved_inquiry_id_key')
      .on(table.reservedInquiryId)
      .where(sql`${table.reservedInquiryId} is not null`),
    // C232.2: outbound lists of the source environment, newest first (C1).
    index('connect_share_tokens_outbound_idx').on(table.environmentId, table.createdAt, table.id),
    // C232.2: inbound lists of the destination environment.
    index('connect_share_tokens_inbound_idx').on(
      table.destinationEnvironmentId,
      table.status,
      table.createdAt,
      table.id,
    ),
    // C232.5: the minute sweep reads created tokens past their expiry only.
    index('connect_share_tokens_expires_at_created_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'created'`),
    // C231.4: deactivation expires a connection's created tokens.
    index('connect_share_tokens_connection_id_status_idx').on(table.connectionId, table.status),
    // C241.1, C253.2: the redaction hook and the access export find a source's tokens.
    index('connect_share_tokens_source_idx').on(
      table.environmentId,
      table.sourceType,
      table.sourceId,
    ),
    idFormat('connect_share_tokens', table.id, 'cnst'),
    idColumnFormat('connect_share_tokens_consent_record_id_format', table.consentRecordId, 'cnsr'),
    check(
      'connect_share_tokens_destination_consent_record_id_format',
      sql`${table.destinationConsentRecordId} is null or ${table.destinationConsentRecordId} ~ '^cnsr_[0-9A-HJKMNP-TV-Z]{26}$'`,
    ),
    check(
      'connect_share_tokens_environment_kind_valid',
      oneOf(table.environmentKind, ENVIRONMENT_KIND_VALUES),
    ),
    check(
      'connect_share_tokens_source_type_valid',
      oneOf(table.sourceType, SHARE_SOURCE_TYPE_VALUES),
    ),
    check(
      'connect_share_tokens_source_id_format',
      sql.raw(
        `case source_type ${Object.entries(SOURCE_ID_PREFIX)
          .map(
            ([type, prefix]) =>
              `when '${type}' then source_id ~ '^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$'`,
          )
          .join(' ')} else false end`,
      ),
    ),
    check(
      'connect_share_tokens_data_categories_valid',
      sql`${table.dataCategories} <@ ${textArrayOf(SHARE_CATEGORIES)}`,
    ),
    check('connect_share_tokens_peek_count_non_negative', sql`${table.peekCount} >= 0`),
    check('connect_share_tokens_status_valid', oneOf(table.status, SHARE_TOKEN_STATUS_VALUES)),
    check(
      'connect_share_tokens_expiry_reason_valid',
      sql`${table.expiryReason} is null or ${oneOf(table.expiryReason, SHARE_TOKEN_EXPIRY_REASON_VALUES)}`,
    ),
    check(
      'connect_share_tokens_failure_reason_valid',
      sql`${table.failureReason} is null or ${oneOf(table.failureReason, SHARE_TOKEN_FAILURE_REASON_VALUES)}`,
    ),
    check(
      'connect_share_tokens_redeem_mode_valid',
      sql`${table.redeemMode} is null or ${oneOf(table.redeemMode, SHARE_REDEEM_MODE_VALUES)}`,
    ),
    check(
      'connect_share_tokens_destination_type_valid',
      sql`${table.destinationType} is null or ${oneOf(table.destinationType, SHARE_SOURCE_TYPE_VALUES)}`,
    ),
    check(
      'connect_share_tokens_creator_type_valid',
      oneOf(table.creatorType, SHARE_TOKEN_CREATOR_TYPE_VALUES),
    ),
    // C232.6: each final status carries its time and its reason, and only it does.
    check(
      'connect_share_tokens_expired',
      sql`(${table.status} = 'expired') = (${table.expiredAt} is not null) and (${table.expiredAt} is null) = (${table.expiryReason} is null)`,
    ),
    check(
      'connect_share_tokens_failed',
      sql`(${table.status} = 'failed') = (${table.failedAt} is not null) and (${table.failedAt} is null) = (${table.failureReason} is null)`,
    ),
    check(
      'connect_share_tokens_redeemed',
      sql`(${table.status} = 'redeemed') = (${table.redeemedAt} is not null)`,
    ),
  ],
);

/** C236.1: who consents to what. */
export const CONSENT_OUTCOME_VALUES = ['accepted', 'declined'] as const;
export const CONSENT_METHOD_VALUES = ['flow', 'attested'] as const;
/** C230.3: the closed list of purposes, one value this release. */
export const SHARE_PURPOSE_VALUES = ['share.reuse-kyc'] as const;
/**
 * C236.1, C236.10: a source record's subject is an inquiry, account or transaction; a destination
 * record's the share token until redemption, then the destination object (a cloned verification
 * included).
 */
export const CONSENT_SUBJECT_TYPE_VALUES = [
  'inquiry',
  'account',
  'transaction',
  'verification',
  'share-token',
] as const;
/** C237.1, C237.6: how a record was withdrawn, and why (the closed list). */
export const CONSENT_WITHDRAWN_VIA_VALUES = ['api', 'operator', 'flow'] as const;
export const CONSENT_WITHDRAWAL_REASON_VALUES = [
  'subject-request',
  'operator-decision',
  'other',
] as const;
/** C236.5: who attested a record. */
export const CONSENT_ATTESTED_BY_TYPE_VALUES = ['user', 'api-key'] as const;

/**
 * C230.5, C236 (Workflow 11A Stage 1b (K)): consent records on both sides of a share. A `flow` record
 * comes only from the `share_consent` step (the session, the time and the sealed IP and user agent);
 * an `attested` record is the operator's statement, with its sealed evidence reference and its own
 * sealed text (`attested_text_body`, the operator's words, so the record's redaction deletes it). A
 * `flow` text is stored once per digest in `consent_texts`. Every sealed column is bound to the
 * record's id. A record's redaction clears its sealed evidence, its text keys and its subject link
 * (`redacted_at`), keeping the bare fact for `consent-proof-retention-days` (C241.3); `api-consent`
 * writes them (`repositories/consent-records.ts`).
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    environmentId: environmentId(),
    id: text('id').primaryKey(),
    side: text('side').$type<(typeof CONNECT_SIDE_VALUES)[number]>().notNull(),
    outcome: text('outcome').$type<(typeof CONSENT_OUTCOME_VALUES)[number]>().notNull(),
    purpose: text('purpose').$type<(typeof SHARE_PURPOSE_VALUES)[number]>().notNull(),
    subjectType: text('subject_type').$type<(typeof CONSENT_SUBJECT_TYPE_VALUES)[number]>(),
    /** Cleared by the record's redaction (C241.3). */
    subjectId: text('subject_id'),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connectConnections.id),
    /** C236.10: the token, kept as a plain string after the destination record follows the copy. */
    shareTokenId: text('share_token_id'),
    recipientOrganizationId: text('recipient_organization_id')
      .notNull()
      .references(() => organizations.id),
    /** C236.1: the recipient's name as shown, NFC. */
    recipientName: text('recipient_name').notNull(),
    dataCategories: text('data_categories').array().notNull(),
    explicitBiometric: boolean('explicit_biometric').notNull().default(false),
    textLocale: text('text_locale'),
    /** C236.3: the copy keys of the text; cleared by the record's redaction. */
    textKeys: text('text_keys').array(),
    /** C236.3: SHA-256 of the exact text presented (placeholders filled, NFC), lowercase hex. */
    textSha256: text('text_sha256').notNull(),
    biometricTextSha256: text('biometric_text_sha256'),
    /** C236.5: an attested record's own text, sealed for the row. */
    attestedTextBody: sealedColumn('attested_text_body'),
    method: text('method').$type<(typeof CONSENT_METHOD_VALUES)[number]>().notNull(),
    /** C236.4: the flow session that witnessed it; `null` for an attestation. */
    sessionId: text('session_id'),
    evidenceIp: sealedColumn('evidence_ip'),
    evidenceUserAgent: sealedColumn('evidence_user_agent'),
    /** C236.5: the attestation's evidence reference, sealed. */
    evidenceReference: sealedColumn('evidence_reference'),
    acceptedAt: timestamptz('accepted_at'),
    attestedAt: timestamptz('attested_at'),
    attestedByType:
      text('attested_by_type').$type<(typeof CONSENT_ATTESTED_BY_TYPE_VALUES)[number]>(),
    attestedById: text('attested_by_id'),
    expiresAt: timestamptz('expires_at').notNull(),
    withdrawnAt: timestamptz('withdrawn_at'),
    withdrawnVia: text('withdrawn_via').$type<(typeof CONSENT_WITHDRAWN_VIA_VALUES)[number]>(),
    withdrawalReason:
      text('withdrawal_reason').$type<(typeof CONSENT_WITHDRAWAL_REASON_VALUES)[number]>(),
    redactedAt: timestamptz('redacted_at'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('consent_records_environment_id_id_key').on(table.environmentId, table.id),
    // C236.2: the subject's records (and the decline guard of C236.5 over a subject and its account).
    index('consent_records_subject_idx').on(
      table.environmentId,
      table.subjectType,
      table.subjectId,
    ),
    index('consent_records_connection_idx').on(table.environmentId, table.connectionId),
    index('consent_records_created_idx').on(table.environmentId, table.createdAt, table.id),
    index('consent_records_share_token_idx').on(table.shareTokenId),
    // C241.3: the retention pass finds the texts no record cites, and the bare facts past their term.
    index('consent_records_text_sha256_idx').on(table.environmentId, table.textSha256),
    index('consent_records_redacted_at_idx')
      .on(table.redactedAt)
      .where(sql`${table.redactedAt} is not null`),
    idFormat('consent_records', table.id, 'cnsr'),
    check('consent_records_side_valid', oneOf(table.side, CONNECT_SIDE_VALUES)),
    check('consent_records_outcome_valid', oneOf(table.outcome, CONSENT_OUTCOME_VALUES)),
    check('consent_records_purpose_valid', oneOf(table.purpose, SHARE_PURPOSE_VALUES)),
    check('consent_records_method_valid', oneOf(table.method, CONSENT_METHOD_VALUES)),
    check(
      'consent_records_subject_type_valid',
      sql`${table.subjectType} is null or ${oneOf(table.subjectType, CONSENT_SUBJECT_TYPE_VALUES)}`,
    ),
    check(
      'consent_records_data_categories_valid',
      sql`${table.dataCategories} <@ ${textArrayOf(SHARE_CATEGORIES)}`,
    ),
    check(
      'consent_records_share_token_id_format',
      sql`${table.shareTokenId} is null or ${table.shareTokenId} ~ '^cnst_[0-9A-HJKMNP-TV-Z]{26}$'`,
    ),
    hexDigest('consent_records_text_sha256_hex', table.textSha256),
    hexDigest('consent_records_biometric_text_sha256_hex', table.biometricTextSha256),
    // C236.11: only the flow witnesses a decline; no attestation is one.
    check(
      'consent_records_declined_in_flow',
      sql`${table.outcome} = 'accepted' or ${table.method} = 'flow'`,
    ),
    // C236.5: an attestation names its time and who attested.
    check(
      'consent_records_attested',
      sql`${table.method} <> 'attested' or (${table.attestedAt} is not null and ${table.attestedByType} is not null and ${table.attestedById} is not null)`,
    ),
    check(
      'consent_records_attested_by_type_valid',
      sql`${table.attestedByType} is null or ${oneOf(table.attestedByType, CONSENT_ATTESTED_BY_TYPE_VALUES)}`,
    ),
    // C237.1: a withdrawal names its channel, and its reason comes from the closed list.
    check(
      'consent_records_withdrawn',
      sql`(${table.withdrawnAt} is null) = (${table.withdrawnVia} is null)`,
    ),
    check(
      'consent_records_withdrawn_via_valid',
      sql`${table.withdrawnVia} is null or ${oneOf(table.withdrawnVia, CONSENT_WITHDRAWN_VIA_VALUES)}`,
    ),
    check(
      'consent_records_withdrawal_reason_valid',
      sql`${table.withdrawalReason} is null or ${oneOf(table.withdrawalReason, CONSENT_WITHDRAWAL_REASON_VALUES)}`,
    ),
  ],
);

/**
 * C230.5, C236.3 (Workflow 11A Stage 1b (K); review P11): a server-composed `flow` text, stored once
 * per environment and digest (insert-if-absent, never updated), its body sealed with the row AAD
 * `consent_texts.body#<environment id>:<sha256>`. The retention pass deletes a text no record cites
 * (C241.3). An attested text is never here (it is on its record).
 */
export const consentTexts = pgTable(
  'consent_texts',
  {
    environmentId: environmentId(),
    sha256: text('sha256').notNull(),
    locale: text('locale').notNull(),
    body: sealedColumn('body').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: 'consent_texts_pkey', columns: [table.environmentId, table.sha256] }),
    hexDigest('consent_texts_sha256_hex', table.sha256),
  ],
);

/** P11: the row id `consent_texts.body` is sealed with. */
export const consentTextRowId = (environmentId: string, sha256: string): string =>
  `${environmentId}:${sha256}`;

export type ConnectConsentRecord = typeof consentRecords.$inferSelect;
export type NewConnectConsentRecord = typeof consentRecords.$inferInsert;
export type ConnectConsentText = typeof consentTexts.$inferSelect;
export type NewConnectConsentText = typeof consentTexts.$inferInsert;

export type ConnectConnection = typeof connectConnections.$inferSelect;
export type NewConnectConnection = typeof connectConnections.$inferInsert;
export type ConnectSharePolicy = typeof connectSharePolicies.$inferSelect;
export type NewConnectSharePolicy = typeof connectSharePolicies.$inferInsert;
export type ConnectShareToken = typeof connectShareTokens.$inferSelect;
export type NewConnectShareToken = typeof connectShareTokens.$inferInsert;
