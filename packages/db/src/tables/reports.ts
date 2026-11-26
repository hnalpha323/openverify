/**
 * C71, C73.2: the environment-scoped report tables. Each references its parents through
 * `(environment_id, <parent id>)`, so a row never points at another environment's data.
 *
 * Personal data is sealed to the row (`<table>.<column>#<id>`): a report's query and its
 * non-match result, a match's snapshot (the readable entry key, the entry's content and
 * risk-data hashes at match time, the list values and the components) and an action's details
 * (reason, comment, the affected match ids). Only ids, statuses, scores, counts and codes stay
 * plain; the entry key and the evidence of a match are HMACs under the environment's blind-index
 * subkey (`openverify/report-match-entry/v1`, `openverify/report-match-evidence/v1`), and the
 * crypto address of a report is one too (`openverify/report-crypto-address/v1`). Redaction
 * nulls every sealed value and every index (C73.5).
 *
 * `report_actions` is append-only (migration 0020's `report_actions_append_only` trigger): an
 * UPDATE is refused except a KEK rewrap that only re-wraps `details`
 * (`openverify.kek_rewrap = 'on'`) and a redaction that only nulls it
 * (`openverify.report_redaction = 'on'`), and a DELETE except with
 * `openverify.environment_deletion = 'on'` (P02, F03).
 */
import {
  REPORT_PAUSED_REASONS,
  REPORT_RUN_NOTES,
  REPORT_RUN_STATUSES,
  REPORT_TYPES,
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
import { sealedColumn } from '../sealed.js';
import { accounts } from './accounts.js';
import { lists } from './lists.js';
import {
  createdAt,
  hexDigest,
  idColumnFormat,
  idFormat,
  lowerTags,
  timestamptz,
  updatedAt,
  validTags,
  workflowRunStepId,
  workflowRunStepKey,
} from './columns.js';
import {
  auditActorType,
  reportActionType,
  reportMatchStatus,
  reportOrigin,
  reportReviewStatus,
  reportRiskLevel,
  reportRunType,
  reportStatus,
} from './enums.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';

/** `<column> in ('a', 'b', ...)` over a fixed list of values. */
const oneOf = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

/** `<column> <@ array['a', 'b', ...]`: every element of a text array is one of the values. */
const allOf = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} <@ array[${sql.raw(values.map((value) => `'${value}'`).join(', '))}]::text[]`;

export const REPORT_TEMPLATE_STATUS_VALUES = ['active', 'archived'] as const;
export const REPORT_TEMPLATE_VERSION_STATUS_VALUES = ['draft', 'published', 'superseded'] as const;

/** C71.1: a report template (`rptp_`), of one report type. */
export const reportTemplates = pgTable(
  'report_templates',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    reportType: text('report_type').$type<(typeof REPORT_TYPES)[number]>().notNull(),
    /** An archived template takes no new API report (C71.1). */
    status: text('status')
      .$type<(typeof REPORT_TEMPLATE_STATUS_VALUES)[number]>()
      .notNull()
      .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('report_templates_environment_id_id_key').on(table.environmentId, table.id),
    index('report_templates_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('report_templates_report_type_valid', oneOf(table.reportType, REPORT_TYPES)),
    check('report_templates_status_valid', oneOf(table.status, REPORT_TEMPLATE_STATUS_VALUES)),
    check('report_templates_name_length', sql`char_length(${table.name}) between 1 and 200`),
    idFormat('report_templates', table.id, 'rptp'),
  ],
);

/**
 * C71.1: a version (`rptpv_`) of a report template: its resolved configuration
 * (`reportTemplateConfigSchema(type)`, the source lists pinned, C71.2). Drafts change; one
 * version per template is published; publishing supersedes the published one.
 */
export const reportTemplateVersions = pgTable(
  'report_template_versions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    reportTemplateId: text('report_template_id').notNull(),
    version: integer('version').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status')
      .$type<(typeof REPORT_TEMPLATE_VERSION_STATUS_VALUES)[number]>()
      .notNull()
      .default('draft'),
    publishedAt: timestamptz('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'report_template_versions_template_fk',
      columns: [table.environmentId, table.reportTemplateId],
      foreignColumns: [reportTemplates.environmentId, reportTemplates.id],
    }).onDelete('cascade'),
    unique('report_template_versions_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('report_template_versions_report_template_id_version_key').on(
      table.reportTemplateId,
      table.version,
    ),
    uniqueIndex('report_template_versions_one_published_key')
      .on(table.reportTemplateId)
      .where(sql`${table.status} = 'published'`),
    index('report_template_versions_env_template_created_at_id_idx').on(
      table.environmentId,
      table.reportTemplateId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('report_template_versions_version_positive', sql`${table.version} >= 1`),
    check(
      'report_template_versions_status_valid',
      oneOf(table.status, REPORT_TEMPLATE_VERSION_STATUS_VALUES),
    ),
    check(
      'report_template_versions_published_at',
      sql`(${table.status} = 'draft') = (${table.publishedAt} IS NULL)`,
    ),
    idFormat('report_template_versions', table.id, 'rptpv'),
  ],
);

/**
 * C70, C73.2: a report (`rep_`). Its status is its latest completed run's (C69.2); the run
 * writes the denormalised result columns (`coverage`, `has_match`, `errors`,
 * `unavailable_fields`, `sources`, `matcher_version`, `provider`, `thresholds`, `notices`).
 */
export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    reportType: text('report_type').$type<(typeof REPORT_TYPES)[number]>().notNull(),
    reportTemplateId: text('report_template_id').notNull(),
    reportTemplateVersionId: text('report_template_version_id').notNull(),
    origin: reportOrigin('origin').notNull(),
    status: reportStatus('status').notNull().default('pending'),
    /** The inputs as sent (C70.2), sealed; `null` once redacted. */
    querySealed: sealedColumn('query'),
    /** The query's member names only, never values. */
    queryFields: text('query_fields')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** C84.2: each query field's source kind (`request`, `government_id`, ...). */
    querySources: jsonb('query_sources').$type<Record<string, string>>().notNull().default({}),
    /** The non-match outputs and the per-name coverage detail (C78.5), sealed. */
    resultSealed: sealedColumn('result'),
    /** C78.5: `{ complete, limits }`, no names or scripts; `null` before a matching run. */
    coverage: jsonb('coverage').$type<{ complete: boolean; limits: string[] }>(),
    /** Some match is `open` (C75.8); `false` for types without review. */
    hasMatch: boolean('has_match').notNull().default(false),
    /** C69.3: `[{ code, source? }]`, codes only. */
    errors: jsonb('errors').$type<{ code: string; source?: string }[]>().notNull().default([]),
    /**
     * C69.4 (Stage 1a amendment 15): `[{ field, reason }]`, a field name and a closed reason
     * code, so a `null` field always says why.
     */
    unavailableFields: jsonb('unavailable_fields')
      .$type<{ field: string; reason: string }[]>()
      .notNull()
      .default([]),
    /** C69.4, C70.2: the provenance of each source the latest completed run used. */
    sources: jsonb('sources').$type<Record<string, unknown>[]>().notNull().default([]),
    matcherVersion: text('matcher_version'),
    /** Stage 1a amendment 15: `{ id, sandbox }` of the provider that answered. */
    provider: jsonb('provider').$type<{ id: string; sandbox: boolean }>(),
    /** ADR 0002 §3f: the preset and thresholds applied. */
    thresholds: jsonb('thresholds').$type<Record<string, string | number | boolean>>(),
    notices: text('notices')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    inquiryId: text('inquiry_id'),
    /** The home account (C84.4); every link is in `report_accounts`. */
    accountId: text('account_id'),
    /** Copied from the pinned version at creation; `null` when not recurring (C72.5, V09). */
    recurrenceIntervalDays: integer('recurrence_interval_days'),
    nextRunAt: timestamptz('next_run_at'),
    pausedAt: timestamptz('paused_at'),
    pausedReason: text('paused_reason').$type<(typeof REPORT_PAUSED_REASONS)[number]>(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** `openverify/report-crypto-address/v1` (crypto type only), written by the run. */
    cryptoAddressIndex: text('crypto_address_index'),
    /** C117.5: the run's step that created it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    createdAt: createdAt(),
    completedAt: timestamptz('completed_at'),
    redactedAt: timestamptz('redacted_at'),
  },
  (table) => [
    ...workflowRunStepKey('reports', table.environmentId, table.workflowRunStepId),
    foreignKey({
      name: 'reports_template_fk',
      columns: [table.environmentId, table.reportTemplateId],
      foreignColumns: [reportTemplates.environmentId, reportTemplates.id],
    }),
    foreignKey({
      name: 'reports_template_version_fk',
      columns: [table.environmentId, table.reportTemplateVersionId],
      foreignColumns: [reportTemplateVersions.environmentId, reportTemplateVersions.id],
    }),
    foreignKey({
      name: 'reports_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'reports_account_fk',
      columns: [table.environmentId, table.accountId],
      foreignColumns: [accounts.environmentId, accounts.id],
    }).onDelete('cascade'),
    unique('reports_environment_id_id_key').on(table.environmentId, table.id),
    index('reports_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // C74.3 (b): the sweep's due recurring reports.
    index('reports_due_idx')
      .on(table.nextRunAt)
      .where(
        sql`${table.nextRunAt} is not null and ${table.pausedAt} is null and ${table.redactedAt} is null`,
      ),
    // C72.5: the recurring counts per environment and type.
    index('reports_recurring_idx')
      .on(table.environmentId, table.reportType)
      .where(sql`${table.nextRunAt} is not null`),
    index('reports_environment_id_inquiry_id_idx').on(table.environmentId, table.inquiryId),
    index('reports_environment_id_account_id_idx').on(table.environmentId, table.accountId),
    // C79.3: monitoring re-screens crypto reports by the blind index.
    index('reports_environment_id_crypto_address_index_idx')
      .on(table.environmentId, table.cryptoAddressIndex)
      .where(sql`${table.cryptoAddressIndex} is not null`),
    index('reports_lower_tags_idx').using('gin', lowerTags(table.tags)),
    validTags('reports_tags_valid', table.tags),
    check('reports_report_type_valid', oneOf(table.reportType, REPORT_TYPES)),
    check(
      'reports_recurrence_interval_days_range',
      sql`${table.recurrenceIntervalDays} between 1 and 365`,
    ),
    check('reports_paused_reason_valid', oneOf(table.pausedReason, REPORT_PAUSED_REASONS)),
    check(
      'reports_paused_reason_with_paused_at',
      sql`(${table.pausedAt} is null) = (${table.pausedReason} is null)`,
    ),
    check('reports_errors_array', sql`jsonb_typeof(${table.errors}) = 'array'`),
    check(
      'reports_unavailable_fields_array',
      sql`jsonb_typeof(${table.unavailableFields}) = 'array'`,
    ),
    check('reports_sources_array', sql`jsonb_typeof(${table.sources}) = 'array'`),
    hexDigest('reports_crypto_address_index_hex', table.cryptoAddressIndex),
    idColumnFormat('reports_report_template_id_format', table.reportTemplateId, 'rptp'),
    idColumnFormat(
      'reports_report_template_version_id_format',
      table.reportTemplateVersionId,
      'rptpv',
    ),
    idFormat('reports', table.id, 'rep'),
  ],
);

/** C84.4: every account a report is linked to (the home account among them). */
export const reportAccounts = pgTable(
  'report_accounts',
  {
    environmentId: environmentId(),
    reportId: text('report_id').notNull(),
    accountId: text('account_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'report_accounts_pkey',
      columns: [table.environmentId, table.reportId, table.accountId],
    }),
    foreignKey({
      name: 'report_accounts_report_fk',
      columns: [table.environmentId, table.reportId],
      foreignColumns: [reports.environmentId, reports.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'report_accounts_account_fk',
      columns: [table.environmentId, table.accountId],
      foreignColumns: [accounts.environmentId, accounts.id],
    }).onDelete('cascade'),
    index('report_accounts_environment_id_account_id_idx').on(table.environmentId, table.accountId),
  ],
);

/**
 * C74.1: one execution of a report (`rpr_`). A worker claims it with one conditional update
 * (`claimed_by`, `claimed_until`, `attempt`), completes it fenced by its claim, and a
 * `list_update` run names the sync it screens (unique per report, V05), or for a custom-list report
 * the list and version (C127.12, unique per report and version).
 */
export const reportRuns = pgTable(
  'report_runs',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    reportId: text('report_id').notNull(),
    runType: reportRunType('run_type').notNull(),
    status: text('status')
      .$type<(typeof REPORT_RUN_STATUSES)[number]>()
      .notNull()
      .default('pending'),
    scheduledFor: timestamptz('scheduled_for').notNull().defaultNow(),
    /** A budget or retry wait (C74.1, C81.2). */
    notBefore: timestamptz('not_before'),
    /** When the sweep last enqueued it (C74.3 (a)). */
    enqueuedAt: timestamptz('enqueued_at'),
    /** Claims made (C74.1); an eleventh ends the run `errored`. */
    attempt: integer('attempt').notNull().default(0),
    /** The claim token; the run completes only `WHERE claimed_by = $token`. */
    claimedBy: text('claimed_by'),
    claimedUntil: timestamptz('claimed_until'),
    /** The `watchlist_syncs` row a `list_update` run screens (C74.4). */
    triggerSyncId: bigint('trigger_sync_id', { mode: 'number' }),
    /** C127.12: the custom list and version a `list_update` run screens, in place of a sync. */
    triggerListId: text('trigger_list_id'),
    triggerListVersion: integer('trigger_list_version'),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    matchCount: integer('match_count').notNull().default(0),
    newMatchCount: integer('new_match_count').notNull().default(0),
    /** C69.4: the provenance of each source used, non-PII. */
    sources: jsonb('sources').$type<Record<string, unknown>[]>().notNull().default([]),
    coverage: jsonb('coverage').$type<{ complete: boolean; limits: string[] }>(),
    errors: jsonb('errors').$type<{ code: string; source?: string }[]>().notNull().default([]),
    /** C74.1, C84.3: codes only (`inquiry_already_decided`, `recurring_limit`, ...). */
    notes: text('notes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** C251.1 (Workflow 11B Stage 1b (P)): when the queue's cap admitted this row's job; `null` while held. */
    admittedAt: timestamptz('admitted_at'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'report_runs_report_fk',
      columns: [table.environmentId, table.reportId],
      foreignColumns: [reports.environmentId, reports.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'report_runs_trigger_list_fk',
      columns: [table.environmentId, table.triggerListId],
      foreignColumns: [lists.environmentId, lists.id],
    }).onDelete('cascade'),
    unique('report_runs_environment_id_id_key').on(table.environmentId, table.id),
    // C127.12: one run per report and list version.
    uniqueIndex('report_runs_report_id_trigger_list_key')
      .on(table.reportId, table.triggerListId, table.triggerListVersion)
      .where(sql`${table.triggerListId} is not null`),
    // C74.4 (V05): a repeated re-screen inserts each run once.
    uniqueIndex('report_runs_report_id_trigger_sync_id_key')
      .on(table.reportId, table.triggerSyncId)
      .where(sql`${table.triggerSyncId} is not null`),
    // C74.3 (a): the sweep's claimable runs, oldest `scheduled_for` first.
    index('report_runs_claimable_idx')
      .on(table.scheduledFor)
      .where(sql`${table.status} in ('pending', 'running')`),
    index('report_runs_environment_id_report_id_created_at_idx').on(
      table.environmentId,
      table.reportId,
      table.createdAt.desc().nullsFirst(),
    ),
    check('report_runs_status_valid', oneOf(table.status, REPORT_RUN_STATUSES)),
    check('report_runs_attempt_non_negative', sql`${table.attempt} >= 0`),
    check(
      'report_runs_counts_non_negative',
      sql`${table.matchCount} >= 0 and ${table.newMatchCount} >= 0`,
    ),
    check('report_runs_notes_valid', allOf(table.notes, REPORT_RUN_NOTES)),
    check('report_runs_errors_array', sql`jsonb_typeof(${table.errors}) = 'array'`),
    check(
      'report_runs_trigger_sync_with_list_update',
      sql`(${table.runType} = 'list_update') =
          (${table.triggerSyncId} is not null or ${table.triggerListId} is not null
           or ${table.triggerListVersion} is not null)
        and (${table.triggerSyncId} is null or ${table.triggerListId} is null)
        and (${table.triggerListId} is null) = (${table.triggerListVersion} is null)`,
    ),
    idFormat('report_runs', table.id, 'rpr'),
  ],
);

/** C74.2, C73.2: one action in a report's history (`ract_`). Append-only (file header). */
export const reportActions = pgTable(
  'report_actions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    reportId: text('report_id').notNull(),
    actionType: reportActionType('action_type').notNull(),
    actorType: auditActorType('actor_type').notNull(),
    /** A `usr_` or `key_` id; `null` for `system`. */
    actorId: text('actor_id'),
    /** Reason, comment and the affected match ids, sealed; `null` once redacted. */
    detailsSealed: sealedColumn('details'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'report_actions_report_fk',
      columns: [table.environmentId, table.reportId],
      foreignColumns: [reports.environmentId, reports.id],
    }).onDelete('cascade'),
    unique('report_actions_environment_id_id_key').on(table.environmentId, table.id),
    index('report_actions_environment_id_report_id_created_at_idx').on(
      table.environmentId,
      table.reportId,
      table.createdAt.desc().nullsFirst(),
    ),
    // K8-14 (Workflow 8D, migration 0029): every clause but the system's reads `actor_id is not null`
    // first, because a pattern answers null on a null id, and a null check passes.
    check(
      'report_actions_actor_valid',
      sql`(${table.actorType} = 'system' and ${table.actorId} is null)
        or (${table.actorType} = 'user' and ${table.actorId} is not null
          and ${table.actorId} ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        or (${table.actorType} = 'api_key' and ${table.actorId} is not null
          and ${table.actorId} ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
        or (${table.actorType}::text = 'workflow_run' and ${table.actorId} is not null
          and ${table.actorId} ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')`,
    ),
    idFormat('report_actions', table.id, 'ract'),
  ],
);

/**
 * C73.2, C75: a match (`rpm_`) of a report with review. Only `source_id`, `score` and the
 * statuses stay plain; the entry key and the evidence are HMACs, and everything readable is in
 * the sealed snapshot, because a readable key, plain qualifiers or a plain content hash would
 * join to the public list and name the person the subject resembles (P01).
 */
export const reportMatches = pgTable(
  'report_matches',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    reportId: text('report_id').notNull(),
    /** `null` for an article (the media types). */
    sourceId: text('source_id'),
    /** HMAC of `<source>:<publisher id>` or the article key; `null` once redacted. */
    entryIndex: text('entry_index'),
    /** HMAC of the evidence (C75.3); `null` once redacted. */
    evidenceHash: text('evidence_hash'),
    score: doublePrecision('score').notNull(),
    snapshotSealed: sealedColumn('snapshot'),
    status: reportMatchStatus('status').notNull().default('open'),
    reviewStatus: reportReviewStatus('review_status').notNull().default('pending'),
    riskLevel: reportRiskLevel('risk_level'),
    notifyOnChange: boolean('notify_on_change').notNull().default(false),
    /** C75.8: false for an open match the last run did not find. */
    presentInLastRun: boolean('present_in_last_run').notNull().default(true),
    firstRunId: text('first_run_id').notNull(),
    lastRunId: text('last_run_id').notNull(),
    /** The dismissed match this one lapsed from (C75.4). */
    lapsedFrom: text('lapsed_from'),
    reviewedAt: timestamptz('reviewed_at'),
    delistedAt: timestamptz('delisted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'report_matches_report_fk',
      columns: [table.environmentId, table.reportId],
      foreignColumns: [reports.environmentId, reports.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'report_matches_first_run_fk',
      columns: [table.environmentId, table.firstRunId],
      foreignColumns: [reportRuns.environmentId, reportRuns.id],
    }),
    foreignKey({
      name: 'report_matches_last_run_fk',
      columns: [table.environmentId, table.lastRunId],
      foreignColumns: [reportRuns.environmentId, reportRuns.id],
    }),
    foreignKey({
      name: 'report_matches_lapsed_from_fk',
      columns: [table.environmentId, table.lapsedFrom],
      foreignColumns: [table.environmentId, table.id],
    }),
    unique('report_matches_environment_id_id_key').on(table.environmentId, table.id),
    // C75.3, V07: suppression is an existence check; an entry that returns to content dismissed
    // before gives two rows with one hash, so the index is not unique.
    index('report_matches_report_id_entry_index_evidence_hash_idx').on(
      table.reportId,
      table.entryIndex,
      table.evidenceHash,
    ),
    // C75.8: at most one open or delisted row per entry.
    uniqueIndex('report_matches_one_live_per_entry_key')
      .on(table.reportId, table.entryIndex)
      .where(sql`${table.status} in ('open', 'delisted')`),
    index('report_matches_environment_id_report_id_created_at_idx').on(
      table.environmentId,
      table.reportId,
      table.createdAt.desc().nullsFirst(),
    ),
    check('report_matches_score_unit_interval', sql`${table.score} between 0 and 1`),
    check(
      'report_matches_delisted_at',
      sql`${table.status} <> 'delisted' or ${table.delistedAt} is not null`,
    ),
    hexDigest('report_matches_entry_index_hex', table.entryIndex),
    hexDigest('report_matches_evidence_hash_hex', table.evidenceHash),
    idFormat('report_matches', table.id, 'rpm'),
  ],
);

export type ReportTemplateRow = typeof reportTemplates.$inferSelect;
export type ReportTemplateVersionRow = typeof reportTemplateVersions.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type ReportAccountRow = typeof reportAccounts.$inferSelect;
export type ReportRunRow = typeof reportRuns.$inferSelect;
export type ReportActionRow = typeof reportActions.$inferSelect;
export type ReportMatchRow = typeof reportMatches.$inferSelect;
