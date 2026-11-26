/**
 * Phase 7, Workflow 7B (C104, C105): transaction types with their versions, and transactions.
 *
 * - `transaction_types` and `transaction_type_versions`: as C71, a draft changes, one version per
 *   type is published, and publishing supersedes the published one. A transaction pins the version
 *   it was created under, so its stored values stay readable under their own schema (C104.6).
 * - `transactions`: `fields` is sealed JSON for its row (`transactions.fields#<id>`); `null` only
 *   once redacted with no `never` field left. `reference_id` is plaintext and not unique (C105.1).
 * - `transaction_status_history` and `transaction_labels` are append-only (migration 0024's
 *   `openverify_transaction_history_append_only` trigger, the C73 pattern): an UPDATE is refused
 *   except a transaction redaction (`openverify.transaction_redaction = 'on'`) that nulls the free
 *   text and stamps `redacted_at`, every other column unchanged, and a DELETE except with
 *   `openverify.environment_deletion = 'on'`. Neither holds a sealed value: statuses and labels are
 *   not PII, and the docs say not to put personal data in them (C105.8).
 * - `transaction_objects` and `transaction_relations`: one nullable column per kind of target, each
 *   with a composite foreign key, and a generated `object_id` or `target_id`, so one index serves
 *   every kind and C105.7's latest transaction is one query.
 * - `transaction_field_keys`: 64-hex HMACs of `searchable` fields under
 *   `openverify/identifier-transaction-field/v1` (F10), recomputed by `blind-index:rebuild`.
 * - `transaction_files`: `file` fields' content. `files` requires a verification, so these get
 *   their own table with the same envelope (`encryptBytes` with the row's id as its context, the
 *   wrapped DEK on the row); the filename is sealed (`transaction_files.filename#<id>`).
 *
 * Plaintext by decision (C107.5): the reference, statuses, tags, labels and scores (C105.8), field
 * keys, MIME types, sizes and SHA-256 digests.
 */
import {
  FIELD_KEY_PATTERN,
  TRANSACTION_LIMITS,
  TRANSACTION_RESERVED_STATUS,
  TRANSACTION_STATUS_PATTERN,
  TRANSACTION_TYPE_STATUSES,
  TRANSACTION_TYPE_VERSION_STATUSES,
  DECISION_ACTOR_TYPES,
  type DecisionActorType,
  type TransactionTypeStatus,
  type TransactionTypeVersionStatus,
} from '@openverify/core';
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
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { idPattern } from '../ids.js';
import { sealedColumn } from '../sealed.js';
import { accounts } from './accounts.js';
import {
  createdAt,
  hexDigest,
  deciderIdFormat,
  idColumnFormat,
  idFormat,
  lowerTags,
  oneOf,
  timestamptz,
  updatedAt,
  validTags,
  workflowRunStepId,
  workflowRunStepKey,
} from './columns.js';
import { auditActorType } from './enums.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';
import { reports } from './reports.js';
import { verifications } from './verifications.js';
import { hydratedFieldsColumn, hydratedFieldsList } from './connect-columns.js';

/** `<column> ~ '<pattern>'`; the patterns are constants of core, never input. */
const matches = (column: AnyPgColumn, pattern: RegExp) =>
  sql`${column} ~ ${sql.raw(`'${pattern.source}'`)}`;

/** A field or relation-schema key (C104.2): every key column holds one. */
const fieldKeyFormat = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`${matches(column, FIELD_KEY_PATTERN)}
      and char_length(${column}) <= ${sql.raw(String(TRANSACTION_LIMITS.fieldKeyLength))}`,
  );

/** A status of a type (C104.5). */
const statusFormat = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`${matches(column, TRANSACTION_STATUS_PATTERN)}
      and char_length(${column}) <= ${sql.raw(String(TRANSACTION_LIMITS.statusLength))}`,
  );

/** C104.1: a transaction type (`txntp_`); its content lives in its versions. */
export const transactionTypes = pgTable(
  'transaction_types',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    /** An archived type takes no new transaction. */
    status: text('status').$type<TransactionTypeStatus>().notNull().default('active'),
    /** C122.1 (a C104 amendment): a status here makes `update_transaction_status` adverse. */
    adverseStatuses: text('adverse_statuses')
      .array()
      .notNull()
      .default(sql`'{declined}'::text[]`),
    /** C128.3 (a C104 amendment): how a person contests a decision on this type. */
    contestRoute: jsonb('contest_route').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'transaction_types_contest_route_object',
      sql`${table.contestRoute} is null or jsonb_typeof(${table.contestRoute}) = 'object'`,
    ),
    unique('transaction_types_environment_id_id_key').on(table.environmentId, table.id),
    index('transaction_types_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('transaction_types', table.id, 'txntp'),
    check('transaction_types_status_valid', oneOf(table.status, TRANSACTION_TYPE_STATUSES)),
    check('transaction_types_name_length', sql`char_length(${table.name}) between 1 and 255`),
  ],
);

/**
 * C104.1: a version (`txntpv_`) of a type: its field schemas, statuses and relation schemas. Drafts
 * change; one version per type is published; publishing supersedes the published one.
 */
export const transactionTypeVersions = pgTable(
  'transaction_type_versions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    transactionTypeId: text('transaction_type_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').$type<TransactionTypeVersionStatus>().notNull().default('draft'),
    /** `FieldSchema[]`; checked by the engine at publish (C104.3). */
    fieldSchemas: jsonb('field_schemas').$type<unknown[]>().notNull().default([]),
    /** C104.5: `created` is reserved and always first. */
    statuses: text('statuses').array().notNull(),
    /** `RelationSchema[]`. */
    relationSchemas: jsonb('relation_schemas').$type<unknown[]>().notNull().default([]),
    /** C104.4: lifts the card-number guard for this version's fields only. */
    allowCardLikeStrings: boolean('allow_card_like_strings').notNull().default(false),
    publishedAt: timestamptz('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'transaction_type_versions_type_fk',
      columns: [table.environmentId, table.transactionTypeId],
      foreignColumns: [transactionTypes.environmentId, transactionTypes.id],
    }).onDelete('cascade'),
    unique('transaction_type_versions_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('transaction_type_versions_transaction_type_id_version_key').on(
      table.transactionTypeId,
      table.version,
    ),
    uniqueIndex('transaction_type_versions_one_published_key')
      .on(table.transactionTypeId)
      .where(sql`${table.status} = 'published'`),
    index('transaction_type_versions_env_type_created_at_id_idx').on(
      table.environmentId,
      table.transactionTypeId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('transaction_type_versions', table.id, 'txntpv'),
    check('transaction_type_versions_version_positive', sql`${table.version} >= 1`),
    check(
      'transaction_type_versions_status_valid',
      oneOf(table.status, TRANSACTION_TYPE_VERSION_STATUSES),
    ),
    check(
      'transaction_type_versions_published_at',
      sql`(${table.status} = 'draft') = (${table.publishedAt} is null)`,
    ),
    check(
      'transaction_type_versions_created_first',
      sql`${table.statuses}[1] is not distinct from ${sql.raw(`'${TRANSACTION_RESERVED_STATUS}'`)}`,
    ),
    check(
      'transaction_type_versions_statuses_count',
      sql`cardinality(${table.statuses}) <= ${sql.raw(String(TRANSACTION_LIMITS.statuses))}`,
    ),
    check(
      'transaction_type_versions_field_schemas_array',
      sql`jsonb_typeof(${table.fieldSchemas}) = 'array'`,
    ),
    check(
      'transaction_type_versions_relation_schemas_array',
      sql`jsonb_typeof(${table.relationSchemas}) = 'array'`,
    ),
  ],
);

/** C105.1, C105.4: a transaction (`txn_`), pinned to the version it was created under. */
export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    transactionTypeId: text('transaction_type_id').notNull(),
    transactionTypeVersionId: text('transaction_type_version_id').notNull(),
    /** The customer's reference for the account: not unique, not PII (C105.1). */
    referenceId: text('reference_id'),
    status: text('status').notNull(),
    /**
     * Each key to `{ type, value }`, sealed JSON. Null only once redacted with no `never` field
     * left.
     */
    fieldsSealed: sealedColumn('fields'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    redactedAt: timestamptz('redacted_at'),
    biometricsRedactedAt: timestamptz('biometrics_redacted_at'),
    /** C127.7 (V27): who last moved the status, set by `setTransactionReviewerInTx`. */
    reviewerType: text('reviewer_type').$type<DecisionActorType>(),
    reviewerId: text('reviewer_id'),
    /** C117.5: the run's step that created it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    /** C230.5, C235.1 (Workflow 11A): the keys hydrated from a share, with their token; never a value. */
    hydratedFields: hydratedFieldsColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    hydratedFieldsList('transactions_hydrated_fields_list', table.hydratedFields),
    ...workflowRunStepKey('transactions', table.environmentId, table.workflowRunStepId),
    check(
      'transactions_reviewer_is_whole',
      sql`(${table.reviewerType} is null) = (${table.reviewerId} is null)`,
    ),
    check('transactions_reviewer_type_valid', oneOf(table.reviewerType, DECISION_ACTOR_TYPES)),
    deciderIdFormat('transactions_reviewer_id_format', table.reviewerType, table.reviewerId),
    foreignKey({
      name: 'transactions_type_fk',
      columns: [table.environmentId, table.transactionTypeId],
      foreignColumns: [transactionTypes.environmentId, transactionTypes.id],
    }),
    foreignKey({
      name: 'transactions_version_fk',
      columns: [table.environmentId, table.transactionTypeVersionId],
      foreignColumns: [transactionTypeVersions.environmentId, transactionTypeVersions.id],
    }),
    unique('transactions_environment_id_id_key').on(table.environmentId, table.id),
    index('transactions_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('transactions_environment_id_type_status_created_at_id_idx').on(
      table.environmentId,
      table.transactionTypeId,
      table.status,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // `filter[reference-id]`, newest first.
    index('transactions_environment_id_reference_id_idx')
      .on(
        table.environmentId,
        table.referenceId,
        table.createdAt.desc().nullsFirst(),
        table.id.desc().nullsFirst(),
      )
      .where(sql`${table.referenceId} is not null`),
    // C105.5: the retention walks the unredacted rows, oldest first.
    index('transactions_unredacted_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.redactedAt} is null`),
    index('transactions_lower_tags_idx').using('gin', lowerTags(table.tags)),
    validTags('transactions_tags_valid', table.tags),
    idFormat('transactions', table.id, 'txn'),
    idColumnFormat('transactions_transaction_type_id_format', table.transactionTypeId, 'txntp'),
    idColumnFormat(
      'transactions_transaction_type_version_id_format',
      table.transactionTypeVersionId,
      'txntpv',
    ),
    statusFormat('transactions_status_format', table.status),
    check(
      'transactions_reference_id_length',
      sql`char_length(${table.referenceId}) between 1 and ${sql.raw(String(TRANSACTION_LIMITS.referenceIdLength))}`,
    ),
    check(
      'transactions_fields_until_redacted',
      sql`${table.fieldsSealed} is not null or ${table.redactedAt} is not null`,
    ),
  ],
);

/** C105.4: one status move, append-only (file header). The first row's `from_status` is `null`. */
export const transactionStatusHistory = pgTable(
  'transaction_status_history',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    transactionId: text('transaction_id').notNull(),
    /** Free text under an operator's control: nulled by the redaction (C105.5). */
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    actorType: auditActorType('actor_type').notNull(),
    /** A `usr_`, `key_` or `wfr_` id; `null` for `system`. */
    actorId: text('actor_id'),
    redactedAt: timestamptz('redacted_at'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'transaction_status_history_transaction_fk',
      columns: [table.environmentId, table.transactionId],
      foreignColumns: [transactions.environmentId, transactions.id],
    }).onDelete('cascade'),
    index('transaction_status_history_transaction_created_at_id_idx').on(
      table.environmentId,
      table.transactionId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    statusFormat('transaction_status_history_from_status_format', table.fromStatus),
    statusFormat('transaction_status_history_to_status_format', table.toStatus),
    check(
      'transaction_status_history_status_until_redacted',
      sql`${table.toStatus} is not null or ${table.redactedAt} is not null`,
    ),
    // K8-14 (Workflow 8D, migration 0029): every clause but the system's reads `actor_id is not null`
    // first, because a pattern answers null on a null id, and a null check passes.
    check(
      'transaction_status_history_actor_valid',
      sql`(${table.actorType} = 'system' and ${table.actorId} is null)
        or (${table.actorType} = 'user' and ${table.actorId} is not null
          and ${table.actorId} ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        or (${table.actorType} = 'api_key' and ${table.actorId} is not null
          and ${table.actorId} ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
        or (${table.actorType}::text = 'workflow_run' and ${table.actorId} is not null
          and ${table.actorId} ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')`,
    ),
  ],
);

/** C105.2: a label (`txnl_`), append-only history (file header); the latest is served. */
export const transactionLabels = pgTable(
  'transaction_labels',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    transactionId: text('transaction_id').notNull(),
    /** Nulled by the redaction, with the model version (C105.5). */
    label: text('label'),
    modelVersion: text('model_version'),
    score: doublePrecision('score'),
    redactedAt: timestamptz('redacted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'transaction_labels_transaction_fk',
      columns: [table.environmentId, table.transactionId],
      foreignColumns: [transactions.environmentId, transactions.id],
    }).onDelete('cascade'),
    unique('transaction_labels_environment_id_id_key').on(table.environmentId, table.id),
    index('transaction_labels_transaction_created_at_id_idx').on(
      table.environmentId,
      table.transactionId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('transaction_labels', table.id, 'txnl'),
    check(
      'transaction_labels_label_until_redacted',
      sql`${table.label} is not null or ${table.redactedAt} is not null`,
    ),
    check(
      'transaction_labels_label_length',
      sql`char_length(${table.label}) between 1 and ${sql.raw(String(TRANSACTION_LIMITS.labelLength))}`,
    ),
    check(
      'transaction_labels_model_version_length',
      sql`char_length(${table.modelVersion}) between 1 and ${sql.raw(String(TRANSACTION_LIMITS.modelVersionLength))}`,
    ),
  ],
);

/** C105.2: what `add-objects` attached, and the account `reference-id` named at creation. */
export const transactionObjects = pgTable(
  'transaction_objects',
  {
    environmentId: environmentId(),
    transactionId: text('transaction_id').notNull(),
    accountId: text('account_id'),
    inquiryId: text('inquiry_id'),
    reportId: text('report_id'),
    verificationId: text('verification_id'),
    /** The one target, whatever its kind: an id says what it is by its prefix. */
    objectId: text('object_id')
      .notNull()
      .generatedAlwaysAs(sql`coalesce("account_id", "inquiry_id", "report_id", "verification_id")`),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'transaction_objects_pkey',
      columns: [table.environmentId, table.transactionId, table.objectId],
    }),
    foreignKey({
      name: 'transaction_objects_transaction_fk',
      columns: [table.environmentId, table.transactionId],
      foreignColumns: [transactions.environmentId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transaction_objects_account_fk',
      columns: [table.environmentId, table.accountId],
      foreignColumns: [accounts.environmentId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transaction_objects_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transaction_objects_report_fk',
      columns: [table.environmentId, table.reportId],
      foreignColumns: [reports.environmentId, reports.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transaction_objects_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    // C105.7: the latest transaction an object was attached to.
    index('transaction_objects_environment_id_object_id_idx').on(
      table.environmentId,
      table.objectId,
      table.createdAt.desc().nullsFirst(),
      table.transactionId.desc().nullsFirst(),
    ),
    check(
      'transaction_objects_one_target',
      sql`num_nonnulls(${table.accountId}, ${table.inquiryId}, ${table.reportId},
        ${table.verificationId}) = 1`,
    ),
  ],
);

/** C105.2: a relation under one of the version's relation schemas; `add-relation` is idempotent. */
export const transactionRelations = pgTable(
  'transaction_relations',
  {
    environmentId: environmentId(),
    transactionId: text('transaction_id').notNull(),
    relationSchemaKey: text('relation_schema_key').notNull(),
    accountId: text('account_id'),
    relatedTransactionId: text('related_transaction_id'),
    /** The one target, whatever its kind. */
    targetId: text('target_id')
      .notNull()
      .generatedAlwaysAs(sql`coalesce("account_id", "related_transaction_id")`),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'transaction_relations_pkey',
      columns: [table.environmentId, table.transactionId, table.relationSchemaKey, table.targetId],
    }),
    foreignKey({
      name: 'transaction_relations_owner_fk',
      columns: [table.environmentId, table.transactionId],
      foreignColumns: [transactions.environmentId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transaction_relations_account_fk',
      columns: [table.environmentId, table.accountId],
      foreignColumns: [accounts.environmentId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transaction_relations_transaction_fk',
      columns: [table.environmentId, table.relatedTransactionId],
      foreignColumns: [transactions.environmentId, transactions.id],
    }).onDelete('cascade'),
    index('transaction_relations_environment_id_target_id_idx').on(
      table.environmentId,
      table.targetId,
    ),
    // K7C-2: `GET /transactions/:id/relations` reads a page of an uncapped `many` relation.
    index('transaction_relations_transaction_created_at_key_target_idx').on(
      table.environmentId,
      table.transactionId,
      table.createdAt.desc().nullsFirst(),
      table.relationSchemaKey.desc().nullsFirst(),
      table.targetId.desc().nullsFirst(),
    ),
    fieldKeyFormat('transaction_relations_key_format', table.relationSchemaKey),
    check(
      'transaction_relations_one_target',
      sql`num_nonnulls(${table.accountId}, ${table.relatedTransactionId}) = 1`,
    ),
  ],
);

/** C105.4: the equality index of `searchable` fields, one row per value (F10). */
export const transactionFieldKeys = pgTable(
  'transaction_field_keys',
  {
    environmentId: environmentId(),
    transactionId: text('transaction_id').notNull(),
    fieldKey: text('field_key').notNull(),
    /** 64 hex (`identifierKey`, kind `identifier-transaction-field`). */
    valueKey: text('value_key').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'transaction_field_keys_pkey',
      columns: [table.environmentId, table.transactionId, table.fieldKey, table.valueKey],
    }),
    foreignKey({
      name: 'transaction_field_keys_transaction_fk',
      columns: [table.environmentId, table.transactionId],
      foreignColumns: [transactions.environmentId, transactions.id],
    }).onDelete('cascade'),
    // `filter[identifier][key]` with `[value]`.
    index('transaction_field_keys_lookup_idx').on(
      table.environmentId,
      table.fieldKey,
      table.valueKey,
      table.transactionId,
    ),
    fieldKeyFormat('transaction_field_keys_field_key_format', table.fieldKey),
    hexDigest('transaction_field_keys_value_key_hex', table.valueKey),
  ],
);

/**
 * C165.3 (Workflow 9B Stage 1b (X); contracts B18): the plaintext projection of a transaction's
 * `filterable` choices, boolean, integer, number and date fields, one row per value in its canonical
 * text, read by `filter[fields.<key>]` (equality). A `filterable` string field is read through
 * `transaction_field_keys` instead, so no second HMAC index exists. Written beside the field keys by
 * `writeTransactionFilterValuesInTx` (`api-exports`), deleted with the transaction and by its
 * redaction (but for the kept fields), and never rebuilt by `blind-index:rebuild` (no key).
 */
export const transactionFilterValues = pgTable(
  'transaction_filter_values',
  {
    environmentId: environmentId(),
    transactionId: text('transaction_id').notNull(),
    fieldKey: text('field_key').notNull(),
    /** The canonical text of one value: a choice, `true`/`false`, a number, a date. */
    value: text('value').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'transaction_filter_values_pkey',
      columns: [table.environmentId, table.transactionId, table.fieldKey, table.value],
    }),
    foreignKey({
      name: 'transaction_filter_values_transaction_fk',
      columns: [table.environmentId, table.transactionId],
      foreignColumns: [transactions.environmentId, transactions.id],
    }).onDelete('cascade'),
    // `filter[fields.<key>]`.
    index('transaction_filter_values_lookup_idx').on(
      table.environmentId,
      table.fieldKey,
      table.value,
      table.transactionId,
    ),
    fieldKeyFormat('transaction_filter_values_field_key_format', table.fieldKey),
    // A filter value's own bound (`listTransactionsQuerySchema`'s dynamic filters).
    check(
      'transaction_filter_values_value_length',
      sql`char_length(${table.value}) between 1 and 1024`,
    ),
  ],
);

/**
 * C105.4: a `file` field's content (`txnf_`), an envelope object written only by
 * `PUT /transactions/:id/files/:field-key` (P22). The redaction nulls the filename; the row stays
 * with `deleted_at` once the object is gone, as `files` does.
 */
export const transactionFiles = pgTable(
  'transaction_files',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    transactionId: text('transaction_id').notNull(),
    fieldKey: text('field_key').notNull(),
    /** PII, sealed; `null` once redacted. */
    filenameSealed: sealedColumn('filename'),
    /** Sniffed from the bytes, never taken from the client (C104.2). */
    mimeType: text('mime_type').notNull(),
    /** Plaintext size in bytes. */
    byteSize: integer('byte_size').notNull(),
    /** SHA-256 of the plaintext, lowercase hex. */
    sha256: text('sha256').notNull(),
    /** S3 object key of the ciphertext. */
    storageKey: text('storage_key').notNull(),
    /** `ov1.<kid>.<wrapped DEK>` from `encryptBytes`. */
    wrappedDek: text('wrapped_dek').notNull(),
    /** The object was deleted from storage; the content answers 410. */
    deletedAt: timestamptz('deleted_at'),
    redactedAt: timestamptz('redacted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'transaction_files_transaction_fk',
      columns: [table.environmentId, table.transactionId],
      foreignColumns: [transactions.environmentId, transactions.id],
    }).onDelete('cascade'),
    unique('transaction_files_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('transaction_files_storage_key_key').on(table.storageKey),
    // C105.2: one `file` field holds one object. A replacement redacts the last one, whose row
    // stays until its object is gone, because it holds the wrapped key (owner decision 9).
    uniqueIndex('transaction_files_one_live_per_field_key')
      .on(table.environmentId, table.transactionId, table.fieldKey)
      .where(sql`${table.deletedAt} is null and ${table.redactedAt} is null`),
    // The C16 pass deletes what a redaction could not (`purgeRedactedTransactionFiles`).
    index('transaction_files_undeleted_redacted_idx')
      .on(table.redactedAt)
      .where(sql`${table.redactedAt} is not null and ${table.deletedAt} is null`),
    idFormat('transaction_files', table.id, 'txnf'),
    fieldKeyFormat('transaction_files_field_key_format', table.fieldKey),
    hexDigest('transaction_files_sha256_hex', table.sha256),
    check('transaction_files_byte_size_non_negative', sql`${table.byteSize} >= 0`),
    check(
      'transaction_files_filename_until_redacted',
      sql`${table.filenameSealed} is not null or ${table.redactedAt} is not null`,
    ),
  ],
);

/**
 * C127.7 (the Phase 7 deferral): what a run triggered by a transaction created (`case` arrives with
 * Workflow 8B, and needs no change here), and what a transaction's redaction reaches
 * (`redactTransactionChildrenInTx`). Polymorphic, so the child has no foreign key.
 */
export const TRANSACTION_CHILD_TYPES = ['inquiry', 'verification', 'report', 'case'] as const;
export type TransactionChildType = (typeof TRANSACTION_CHILD_TYPES)[number];

export const transactionChildren = pgTable(
  'transaction_children',
  {
    environmentId: environmentId(),
    transactionId: text('transaction_id').notNull(),
    childType: text('child_type').$type<TransactionChildType>().notNull(),
    childId: text('child_id').notNull(),
    workflowRunId: text('workflow_run_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'transaction_children_pkey',
      columns: [table.environmentId, table.transactionId, table.childId],
    }),
    foreignKey({
      name: 'transaction_children_transaction_fk',
      columns: [table.environmentId, table.transactionId],
      foreignColumns: [transactions.environmentId, transactions.id],
    }).onDelete('cascade'),
    // A child's redaction stops at `no_change` by reading this way (outcome 28).
    index('transaction_children_child_idx').on(table.environmentId, table.childId),
    check('transaction_children_child_type_valid', oneOf(table.childType, TRANSACTION_CHILD_TYPES)),
    check(
      'transaction_children_child_id_format',
      sql`(${table.childType} = 'inquiry' and ${table.childId} ~ ${sql.raw(`'${idPattern('inq')}'`)})
        or (${table.childType} = 'verification' and ${table.childId} ~ ${sql.raw(`'${idPattern('ver')}'`)})
        or (${table.childType} = 'report' and ${table.childId} ~ ${sql.raw(`'${idPattern('rep')}'`)})
        or (${table.childType} = 'case' and ${table.childId} ~ '^case_[0-9A-HJKMNP-TV-Z]{26}$')
        or ${table.childType} not in ('inquiry', 'verification', 'report', 'case')`,
    ),
    idColumnFormat('transaction_children_workflow_run_id_format', table.workflowRunId, 'wfr'),
  ],
);

export type TransactionTypeRow = typeof transactionTypes.$inferSelect;
export type TransactionTypeVersionRow = typeof transactionTypeVersions.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type TransactionChildRow = typeof transactionChildren.$inferSelect;
export type TransactionStatusHistoryRow = typeof transactionStatusHistory.$inferSelect;
export type TransactionLabelRow = typeof transactionLabels.$inferSelect;
export type TransactionObjectRow = typeof transactionObjects.$inferSelect;
export type TransactionRelationRow = typeof transactionRelations.$inferSelect;
export type TransactionFieldKeyRow = typeof transactionFieldKeys.$inferSelect;
export type TransactionFilterValueRow = typeof transactionFilterValues.$inferSelect;
export type TransactionFileRow = typeof transactionFiles.$inferSelect;
