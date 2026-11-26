/**
 * Phase 7, Workflow 7B (C101, C102): the account graph and its queries.
 *
 * - `graph_attributes` (C101.1): one row per account, value and source. `kind` is the frozen
 *   `smallint` code of `GRAPH_KIND_REGISTRY`; `value_key` a 64-hex HMAC under the kind's identifier
 *   label (F10), `key_id` the blind-index key it was made with. No degree table (F24): fan-out is a
 *   capped count on the primary key when a query reads. No account-account edge is stored.
 *   `inquiry_id` names the inquiry a row came from (an inquiry, one of its sessions or
 *   verifications), so redacting the inquiry deletes its rows with one indexed statement (C101.4).
 * - `graph_index_jobs` (C101.3): the outbox row of an inquiry's first move out of `pending`; the
 *   `graph-index-sweep` enqueues it and the `graph-index` job indexes what the inquiry holds.
 * - `graph_index_state` (C101.5, H10): one row per environment and kind; `complete` until a switch
 *   starts writing the kind again. A kind with no row reads complete since the environment began:
 *   migration 0024 writes an incomplete row of every kind for each environment that predates it, so
 *   the `graph-backfill` job indexes what was there before.
 * - `graph_components` (C101.6): the nightly union-find over strong kinds, opt-in.
 * - `graph_query_templates`, `graph_query_template_versions` (C102.1): as C71.
 * - `graph_queries` (C102.4): `params` sealed for the row (`graph_queries.params#<id>`); the result
 *   holds account ids, random node ids local to the result, and the node map from a node id to its
 *   kind and value key on the server (P17), never a value. Retention empties it (C102.7).
 *
 * Plaintext by decision (C107.5): kinds, value keys and key ids (64-hex HMACs and key ids, as on
 * `devices`), account ids, component sizes, template configs (bound `{{param}}` names, no value).
 */
import {
  GRAPH_KINDS,
  GRAPH_KIND_REGISTRY,
  GRAPH_LIMITS,
  GRAPH_QUERY_STATUSES,
  GRAPH_TEMPLATE_STATUSES,
  GRAPH_TEMPLATE_VERSION_STATUSES,
  type GraphQueryStatus,
  type GraphTemplateStatus,
  type GraphTemplateVersionStatus,
} from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { idPattern, type IdPrefix } from '../ids.js';
import { sealedColumn } from '../sealed.js';
import { accounts } from './accounts.js';
import {
  createdAt,
  hexDigest,
  idFormat,
  oneOf,
  timestamptz,
  updatedAt,
  workflowRunStepId,
  workflowRunStepKey,
} from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';

/**
 * C101.1: what a `graph_attributes` row came from: the account's own fields and reference id, or an
 * inquiry, one of its sessions (the IP rows of the session start) or one of its verifications.
 */
export const GRAPH_SOURCE_TYPES = [
  'account',
  'inquiry',
  'inquiry-session',
  'verification',
] as const;
export type GraphSourceType = (typeof GRAPH_SOURCE_TYPES)[number];

const SOURCE_PREFIXES: Readonly<Record<GraphSourceType, IdPrefix>> = {
  account: 'acc',
  inquiry: 'inq',
  'inquiry-session': 'iqse',
  verification: 'ver',
};

/** C101.3: the moves that write a `graph_index_jobs` row: the first into a terminal status. */
export const GRAPH_INDEX_TRIGGER_VALUES = ['completed', 'failed', 'expired'] as const;
export type GraphIndexTrigger = (typeof GRAPH_INDEX_TRIGGER_VALUES)[number];

/**
 * C101.3: an index job's states. `skipped`: the inquiry was redacted after its row was written, or
 * `graph-indexing` was off when the job ran (owner decision 5 after Workflow 6C).
 */
export const GRAPH_INDEX_JOB_STATUSES = ['pending', 'completed', 'skipped', 'errored'] as const;
export type GraphIndexJobStatus = (typeof GRAPH_INDEX_JOB_STATUSES)[number];

/** Every frozen kind code, for the CHECKs. */
const KIND_CODES = GRAPH_KINDS.map((kind) => GRAPH_KIND_REGISTRY[kind].code);
const KIND_CODE_LIST = sql.raw(KIND_CODES.join(', '));

/** A key id, as `devices.key_id` holds it (`blindIndexKeyId`). */
const keyIdFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[A-Za-z0-9_-]{11}$'`);

const lastErrorCodeFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[a-z][a-z0-9_]{0,63}$'`);

/** C101.1: one row per account, value and source. */
export const graphAttributes = pgTable(
  'graph_attributes',
  {
    environmentId: environmentId(),
    /** `GRAPH_KIND_REGISTRY[kind].code`; frozen once written. */
    kind: smallint('kind').notNull(),
    /** 64-hex HMAC of the kind's key input under its identifier label (F10). */
    valueKey: text('value_key').notNull(),
    /** The blind-index key the HMAC was made with; a row under another key is re-keyed or dropped. */
    keyId: text('key_id').notNull(),
    accountId: text('account_id').notNull(),
    sourceType: text('source_type').$type<GraphSourceType>().notNull(),
    sourceId: text('source_id').notNull(),
    /** The inquiry the source belongs to; `null` for an account's own fields. */
    inquiryId: text('inquiry_id'),
    firstSeenAt: timestamptz('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
  },
  (table) => [
    // C101.1: the `(environment_id, kind, value_key)` index of the plan is this key's prefix; the
    // fan-out count reads it with `limit cap + 1`.
    primaryKey({
      name: 'graph_attributes_pkey',
      columns: [
        table.environmentId,
        table.kind,
        table.valueKey,
        table.accountId,
        table.sourceType,
        table.sourceId,
      ],
    }),
    foreignKey({
      name: 'graph_attributes_account_fk',
      columns: [table.environmentId, table.accountId],
      foreignColumns: [accounts.environmentId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'graph_attributes_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    // C102.3: one statement per hop reads an account's values of the connect kinds.
    index('graph_attributes_environment_id_account_id_kind_idx').on(
      table.environmentId,
      table.accountId,
      table.kind,
      table.valueKey,
    ),
    // C101.4: an inquiry's redaction deletes the rows it contributed.
    index('graph_attributes_environment_id_inquiry_id_idx')
      .on(table.environmentId, table.inquiryId)
      .where(sql`${table.inquiryId} is not null`),
    check('graph_attributes_kind_valid', sql`${table.kind} in (${KIND_CODE_LIST})`),
    hexDigest('graph_attributes_value_key_format', table.valueKey),
    keyIdFormat('graph_attributes_key_id_format', table.keyId),
    check('graph_attributes_source_type_valid', oneOf(table.sourceType, GRAPH_SOURCE_TYPES)),
    check(
      'graph_attributes_source_id_format',
      sql.join(
        GRAPH_SOURCE_TYPES.map(
          (type) =>
            sql`(${table.sourceType} = ${sql.raw(`'${type}'`)} and ${table.sourceId} ~ ${sql.raw(
              `'${idPattern(SOURCE_PREFIXES[type])}'`,
            )})`,
        ),
        sql` or `,
      ),
    ),
    check(
      'graph_attributes_inquiry_of_source',
      sql`(${table.sourceType} = 'account') = (${table.inquiryId} is null)`,
    ),
    check(
      'graph_attributes_inquiry_source_id',
      sql`${table.sourceType} <> 'inquiry' or ${table.sourceId} = ${table.inquiryId}`,
    ),
    check('graph_attributes_seen_order', sql`${table.lastSeenAt} >= ${table.firstSeenAt}`),
  ],
);

/** C101.3: the outbox row of an inquiry's first move into `completed`, `failed` or `expired`. */
export const graphIndexJobs = pgTable(
  'graph_index_jobs',
  {
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    /** The status the inquiry moved into when the row was written. */
    triggerStatus: text('trigger_status').$type<GraphIndexTrigger>().notNull(),
    status: text('status').$type<GraphIndexJobStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** The last failure's or skip's code (a snake-case name, never a value). */
    lastErrorCode: text('last_error_code'),
    /** When the sweep last enqueued the row. */
    enqueuedAt: timestamptz('enqueued_at'),
    /** When the job ended the row. */
    indexedAt: timestamptz('indexed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: 'graph_index_jobs_pkey',
      columns: [table.environmentId, table.inquiryId],
    }),
    foreignKey({
      name: 'graph_index_jobs_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    // The 15 s sweep: pending rows, oldest first.
    index('graph_index_jobs_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    check('graph_index_jobs_trigger_valid', oneOf(table.triggerStatus, GRAPH_INDEX_TRIGGER_VALUES)),
    check('graph_index_jobs_status_valid', oneOf(table.status, GRAPH_INDEX_JOB_STATUSES)),
    check('graph_index_jobs_attempts_non_negative', sql`${table.attempts} >= 0`),
    check(
      'graph_index_jobs_ended_has_time',
      sql`(${table.status} = 'pending') = (${table.indexedAt} is null)`,
    ),
    lastErrorCodeFormat('graph_index_jobs_last_error_code_format', table.lastErrorCode),
  ],
);

/**
 * C101.5 (H10, V11): what the index holds per environment and kind. `indexed_since` is when the kind
 * last started being written; `complete` once its backfill reached everything written before.
 */
export const graphIndexState = pgTable(
  'graph_index_state',
  {
    environmentId: environmentId(),
    kind: smallint('kind').notNull(),
    indexedSince: timestamptz('indexed_since').notNull().defaultNow(),
    complete: boolean('complete').notNull().default(false),
    /** Where the resumable `graph-backfill` stopped: ids and times only (`api-graph`'s shape). */
    backfillCursor: jsonb('backfill_cursor').$type<Record<string, unknown>>(),
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: 'graph_index_state_pkey', columns: [table.environmentId, table.kind] }),
    // The backfill's pick: the kinds still to do.
    index('graph_index_state_incomplete_idx')
      .on(table.environmentId)
      .where(sql`not ${table.complete}`),
    check('graph_index_state_kind_valid', sql`${table.kind} in (${KIND_CODE_LIST})`),
    check(
      'graph_index_state_completed_at',
      sql`${table.complete} = (${table.completedAt} is not null)`,
    ),
  ],
);

/** C101.6: an account's component over strong kinds, from the last nightly run. */
export const graphComponents = pgTable(
  'graph_components',
  {
    environmentId: environmentId(),
    accountId: text('account_id').notNull(),
    /** The run's own label of the component; ids only, never a value. */
    componentId: text('component_id').notNull(),
    size: integer('size').notNull(),
    computedAt: timestamptz('computed_at').notNull(),
  },
  (table) => [
    primaryKey({ name: 'graph_components_pkey', columns: [table.environmentId, table.accountId] }),
    foreignKey({
      name: 'graph_components_account_fk',
      columns: [table.environmentId, table.accountId],
      foreignColumns: [accounts.environmentId, accounts.id],
    }).onDelete('cascade'),
    index('graph_components_environment_id_component_id_idx').on(
      table.environmentId,
      table.componentId,
    ),
    check(
      'graph_components_component_id_length',
      sql`char_length(${table.componentId}) between 1 and 64`,
    ),
    check('graph_components_size_positive', sql`${table.size} >= 1`),
  ],
);

/** C102.1: a graph query template (`grqt_`); its config lives in its versions. */
export const graphQueryTemplates = pgTable(
  'graph_query_templates',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    /** An archived template runs no new query. */
    status: text('status').$type<GraphTemplateStatus>().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('graph_query_templates_environment_id_id_key').on(table.environmentId, table.id),
    index('graph_query_templates_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('graph_query_templates', table.id, 'grqt'),
    check('graph_query_templates_status_valid', oneOf(table.status, GRAPH_TEMPLATE_STATUSES)),
    check('graph_query_templates_name_length', sql`char_length(${table.name}) between 1 and 255`),
  ],
);

/**
 * C102.1: a version (`grqtv_`) of a template: its `graphQueryTemplateConfigSchema` config. Drafts
 * change; one version per template is published, under the template lock (C71).
 */
export const graphQueryTemplateVersions = pgTable(
  'graph_query_template_versions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    graphQueryTemplateId: text('graph_query_template_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').$type<GraphTemplateVersionStatus>().notNull().default('draft'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    publishedAt: timestamptz('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'graph_query_template_versions_template_fk',
      columns: [table.environmentId, table.graphQueryTemplateId],
      foreignColumns: [graphQueryTemplates.environmentId, graphQueryTemplates.id],
    }).onDelete('cascade'),
    unique('graph_query_template_versions_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('graph_query_template_versions_template_id_version_key').on(
      table.graphQueryTemplateId,
      table.version,
    ),
    uniqueIndex('graph_query_template_versions_one_published_key')
      .on(table.graphQueryTemplateId)
      .where(sql`${table.status} = 'published'`),
    index('graph_query_template_versions_env_template_created_at_id_idx').on(
      table.environmentId,
      table.graphQueryTemplateId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('graph_query_template_versions', table.id, 'grqtv'),
    check('graph_query_template_versions_version_positive', sql`${table.version} >= 1`),
    check(
      'graph_query_template_versions_status_valid',
      oneOf(table.status, GRAPH_TEMPLATE_VERSION_STATUSES),
    ),
    check(
      'graph_query_template_versions_published_at',
      sql`(${table.status} = 'draft') = (${table.publishedAt} is null)`,
    ),
  ],
);

/**
 * C102.4: a graph query (`grphq_`) and its stored result. `params` is sealed for the row and `null`
 * once redacted; the result holds ids, random node ids and value keys, never a value (P17).
 */
export const graphQueries = pgTable(
  'graph_queries',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    graphQueryTemplateId: text('graph_query_template_id').notNull(),
    graphQueryTemplateVersionId: text('graph_query_template_version_id').notNull(),
    status: text('status').$type<GraphQueryStatus>().notNull().default('submitted'),
    /** The `parameter-map` as bound, sealed JSON (`graph_queries.params#<id>`). */
    paramsSealed: sealedColumn('params'),
    timeoutSeconds: integer('timeout_seconds')
      .notNull()
      .default(GRAPH_LIMITS.defaultTimeoutSeconds),
    /** `meta.run-sync` (P25). */
    runSync: boolean('run_sync').notNull().default(false),
    /** `GraphNode[]`: account ids and random node ids local to this result. */
    nodes: jsonb('nodes').$type<unknown[]>().notNull().default([]),
    /** `GraphLink[]` between node ids. */
    links: jsonb('links').$type<unknown[]>().notNull().default([]),
    /** A node id to its kind and value key, on the server only (C102.6). */
    nodeMap: jsonb('node_map').$type<Record<string, unknown>>().notNull().default({}),
    /** The result's accounts: the `accounts` relationship, and the scrub of a redaction (C101.4). */
    accountIds: text('account_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** H10: the kind codes the index lacked for the window. */
    kindsNotIndexed: smallint('kinds_not_indexed')
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    skippedHubValues: integer('skipped_hub_values').notNull().default(0),
    nodeLimitReached: boolean('node_limit_reached').notNull().default(false),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    /** When the sweep last enqueued the query. */
    enqueuedAt: timestamptz('enqueued_at'),
    erroredAt: timestamptz('errored_at'),
    completedAt: timestamptz('completed_at'),
    redactedAt: timestamptz('redacted_at'),
    /** C117.5: the run's step that created it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    ...workflowRunStepKey('graph_queries', table.environmentId, table.workflowRunStepId),
    unique('graph_queries_environment_id_id_key').on(table.environmentId, table.id),
    foreignKey({
      name: 'graph_queries_template_fk',
      columns: [table.environmentId, table.graphQueryTemplateId],
      foreignColumns: [graphQueryTemplates.environmentId, graphQueryTemplates.id],
    }),
    foreignKey({
      name: 'graph_queries_template_version_fk',
      columns: [table.environmentId, table.graphQueryTemplateVersionId],
      foreignColumns: [graphQueryTemplateVersions.environmentId, graphQueryTemplateVersions.id],
    }),
    index('graph_queries_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('graph_queries_environment_id_template_created_at_id_idx').on(
      table.environmentId,
      table.graphQueryTemplateId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // The 15 s sweep: submitted queries, oldest first.
    index('graph_queries_submitted_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'submitted'`),
    // C102.7: the retention walk.
    index('graph_queries_unredacted_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.redactedAt} is null`),
    // C101.4: a redacted account leaves every stored result.
    index('graph_queries_account_ids_idx').using('gin', table.accountIds),
    idFormat('graph_queries', table.id, 'grphq'),
    check('graph_queries_status_valid', oneOf(table.status, GRAPH_QUERY_STATUSES)),
    check(
      'graph_queries_timeout_range',
      sql`${table.timeoutSeconds} between 1 and ${sql.raw(String(GRAPH_LIMITS.timeoutSeconds))}`,
    ),
    check(
      'graph_queries_completed_at',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
    check(
      'graph_queries_errored_at',
      sql`(${table.status} = 'errored') = (${table.erroredAt} is not null)`,
    ),
    check(
      'graph_queries_params_until_redacted',
      sql`${table.redactedAt} is not null or ${table.paramsSealed} is not null`,
    ),
    check(
      'graph_queries_redacted_empty',
      sql`${table.redactedAt} is null or (${table.paramsSealed} is null
        and ${table.nodes} = '[]'::jsonb and ${table.links} = '[]'::jsonb
        and ${table.nodeMap} = '{}'::jsonb and cardinality(${table.accountIds}) = 0)`,
    ),
    check(
      'graph_queries_kinds_not_indexed_valid',
      sql`${table.kindsNotIndexed} <@ array[${KIND_CODE_LIST}]::smallint[]`,
    ),
    check('graph_queries_skipped_hub_values_non_negative', sql`${table.skippedHubValues} >= 0`),
    check('graph_queries_attempts_non_negative', sql`${table.attempts} >= 0`),
    lastErrorCodeFormat('graph_queries_last_error_code_format', table.lastErrorCode),
  ],
);

export type GraphAttributeRow = typeof graphAttributes.$inferSelect;
export type GraphIndexJobRow = typeof graphIndexJobs.$inferSelect;
export type GraphIndexStateRow = typeof graphIndexState.$inferSelect;
export type GraphComponentRow = typeof graphComponents.$inferSelect;
export type GraphQueryTemplateRow = typeof graphQueryTemplates.$inferSelect;
export type GraphQueryTemplateVersionRow = typeof graphQueryTemplateVersions.$inferSelect;
export type GraphQueryRow = typeof graphQueries.$inferSelect;
